// RetroAchievements (https://retroachievements.org): achievements for retro
// games played in emulators. Its Web API is official and free. Each user
// connects their own account: their username and the Web API key from their
// RetroAchievements settings, kept encrypted in platform_logins like a sign-in.
// There's no server-wide key.
//
//   POST   /api/retro/connect      { username, key } -> { account }
//   DELETE /api/retro/connect
//   GET    /api/retro/library      -> { games: [{ externalId, name, minutes, lastPlayed, imageUrl, achievements }] }
//   GET    /api/retro/achievements?ref=<game id>  -> { items }
//
// Play time is RetroAchievements' own record per game (one request per game),
// fetched for games played since the last check and remembered otherwise.
import express from 'express';
import { diskCache } from './diskCache.mjs';
import { mapLimit } from './epic.mjs';
import { loadLogin, NotConnected, removeLogin, saveLogin } from './platformLogins.mjs';

const API = 'https://retroachievements.org/API';
const MEDIA = 'https://media.retroachievements.org';
const MAX_PLAYTIME_GAMES = 40; // per sync; the rest come from the cache or later syncs
const playtimeCache = diskCache('retro-playtime', 0); // user:game -> { marker, minutes }

export class RetroError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** One Web API call with the user's own key. */
async function ra(endpoint, params, key) {
  const qs = new URLSearchParams({ ...params, y: key });
  let r;
  try {
    r = await fetch(`${API}/${endpoint}.php?${qs}`, {
      headers: { 'User-Agent': 'Savepoint/0.1 (self-hosted game library app)', Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new RetroError("Couldn't reach RetroAchievements. Try again in a moment.");
  }
  if (r.status === 401 || r.status === 403) throw new RetroError("RetroAchievements didn't accept the API key.", 400);
  if (r.status === 404) return null;
  if (r.status === 429) throw new RetroError('RetroAchievements is busy. Try again in a minute.');
  if (!r.ok) throw new RetroError(`RetroAchievements answered ${r.status}`);
  return r.json();
}

/** RetroAchievements writes "Legend of Zelda, The: A Link to the Past"; and marks hacks with ~Hack~. */
export function cleanRetroTitle(title) {
  let t = String(title ?? '')
    .replace(/^(~[^~]+~\s*)+/, '')
    .replace(/\s*\[Subset[^\]]*\]\s*$/i, '')
    .trim();
  const m = /^(.+?), (The|A|An)\b(.*)$/.exec(t);
  if (m) t = `${m[2]} ${m[1]}${m[3]}`;
  return t;
}

/** "2023-10-27 00:30:04" (UTC) -> ISO, or null. */
const raDate = (s) => {
  if (!s) return null;
  const d = new Date(/[TZ+]/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** The account's own RetroAchievements user and key. */
async function credsFor(userId) {
  const stored = await loadLogin(userId, 'retro');
  if (!stored) throw new NotConnected('Connect RetroAchievements first (Platforms page).');
  try {
    const { user, key } = JSON.parse(stored.secret);
    if (user && key) return { user, key };
  } catch {
    // An older connection without a key of its own.
  }
  throw new NotConnected('Connect RetroAchievements again with your own API key (Platforms page).');
}

async function allProgress({ user, key }) {
  const out = [];
  for (let offset = 0, page = 0; page < 40; page++, offset += 500) {
    const j = await ra('API_GetUserCompletionProgress', { u: user, c: '500', o: String(offset) }, key);
    const results = j?.Results ?? [];
    out.push(...results);
    if (results.length < 500 || out.length >= (j?.Total ?? 0)) break;
  }
  return out;
}

/** The user's RetroAchievements games with play time and achievements. */
export async function retroLibrary(userId) {
  const creds = await credsFor(userId);
  const [progress, recent] = await Promise.all([
    allProgress(creds),
    ra('API_GetUserRecentlyPlayedGames', { u: creds.user, c: '50' }, creds.key).catch(() => []),
  ]);
  const games = new Map();
  for (const p of progress) {
    games.set(String(p.GameID), {
      id: String(p.GameID),
      title: p.Title,
      console: p.ConsoleName,
      icon: p.ImageIcon,
      earned: Number(p.NumAwarded) || 0,
      total: Number(p.MaxPossible) || 0,
      mastered: /mastered|completed/.test(p.HighestAwardKind ?? ''),
      // The last unlock, until the recently played list gives the real date.
      lastPlayed: raDate(p.MostRecentAwardedDate),
      marker: p.MostRecentAwardedDate ?? p.HighestAwardDate ?? '',
    });
  }
  // Recently played games carry the last-played date, and games without unlocks yet.
  for (const r of Array.isArray(recent) ? recent : []) {
    const id = String(r.GameID);
    const g = games.get(id) ?? {
      id,
      title: r.Title,
      console: r.ConsoleName,
      icon: r.ImageIcon,
      earned: Number(r.NumAchieved) || 0,
      total: Number(r.AchievementsTotal ?? r.NumPossibleAchievements) || 0,
      mastered: false,
      marker: '',
    };
    g.lastPlayed = raDate(r.LastPlayed);
    g.marker = r.LastPlayed || g.marker;
    games.set(id, g);
  }

  // Play time: asked again only for games played (or unlocked in) since last time.
  const list = [...games.values()].sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''));
  const cached = await Promise.all(list.map((g) => playtimeCache.get(`${userId}:${g.id}`)));
  const due = list.filter((g, i) => cached[i]?.marker !== g.marker).slice(0, MAX_PLAYTIME_GAMES);
  await mapLimit(due, 4, async (g) => {
    const info = await ra('API_GetGameInfoAndUserProgress', { u: creds.user, g: g.id }, creds.key);
    // UserTotalPlaytime is RetroAchievements' running total for the game, in seconds.
    const minutes = Math.round((Number(info?.UserTotalPlaytime) || 0) / 60);
    await playtimeCache.set(`${userId}:${g.id}`, { marker: g.marker, minutes });
    cached[list.indexOf(g)] = { minutes };
  });

  return list.map((g, i) => ({
    externalId: g.id,
    name: cleanRetroTitle(g.title),
    console: g.console,
    minutes: cached[i]?.minutes ?? 0,
    lastPlayed: g.lastPlayed,
    imageUrl: g.icon ? `${MEDIA}${g.icon}` : undefined,
    achievements: g.total ? { earned: g.earned, total: g.total } : undefined,
  }));
}

/** The game page's list: every achievement with its points and unlock date. */
export async function retroAchievementItems(userId, gameId) {
  const { user, key } = await credsFor(userId);
  const info = await ra('API_GetGameInfoAndUserProgress', { u: user, g: gameId }, key);
  const players = Number(info?.NumDistinctPlayers) || 0;
  return Object.values(info?.Achievements ?? {})
    .sort((a, b) => (Number(a.DisplayOrder) || 0) - (Number(b.DisplayOrder) || 0))
    .map((a) => {
      const earned = a.DateEarnedHardcore || a.DateEarned || null;
      return {
        name: a.Title,
        description: a.Description ?? '',
        icon: a.BadgeName ? `${MEDIA}/Badge/${a.BadgeName}${earned ? '' : '_lock'}.png` : null,
        earnedAt: raDate(earned),
        hardcore: !!a.DateEarnedHardcore,
        points: Number(a.Points) || 0,
        hidden: false,
        rarity: players ? Math.round(((Number(a.NumAwarded) || 0) / players) * 1000) / 10 : null,
      };
    });
}

export const retroRouter = express.Router();

retroRouter.post('/api/retro/connect', express.json({ limit: '5kb' }), async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const key = String(req.body?.key ?? '').trim();
  if (!/^[\w.-]{2,40}$/.test(username)) return res.status(400).json({ error: 'Type your RetroAchievements username.' });
  if (!/^\w{16,64}$/.test(key))
    return res.status(400).json({ error: 'Paste the Web API key from your RetroAchievements settings.' });
  let profile;
  try {
    profile = await ra('API_GetUserProfile', { u: username }, key);
  } catch (err) {
    return res.status(err.status ?? 502).json({ error: err.message });
  }
  if (!profile?.User) {
    return res.status(404).json({ error: `No RetroAchievements user called ${username}. Check the spelling.` });
  }
  try {
    // The ULID stays the same if the username changes.
    await saveLogin(req.userId, 'retro', JSON.stringify({ user: profile.ULID || profile.User, key }), profile.User);
    res.json({ account: profile.User });
  } catch {
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

retroRouter.delete('/api/retro/connect', async (req, res) => {
  try {
    await removeLogin(req.userId, 'retro');
    res.status(204).end();
  } catch {
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

const sendError = (res, err, what) =>
  res.status(err instanceof NotConnected ? 409 : (err.status ?? 502)).json({
    error: err instanceof NotConnected || err instanceof RetroError ? err.message : `${what}: ${err.message}`,
  });

retroRouter.get('/api/retro/library', async (req, res) => {
  try {
    res.json({ games: await retroLibrary(req.userId) });
  } catch (err) {
    sendError(res, err, 'RetroAchievements import failed');
  }
});

retroRouter.get('/api/retro/achievements', async (req, res) => {
  const ref = String(req.query.ref ?? '');
  if (!/^\d{1,10}$/.test(ref)) return res.status(400).json({ error: 'Which game?' });
  try {
    res.json({ items: await retroAchievementItems(req.userId, ref) });
  } catch (err) {
    sendError(res, err, 'RetroAchievements failed');
  }
});
