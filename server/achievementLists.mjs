// The achievement list on a game's page, for platforms whose counts come from
// elsewhere: Steam, PlayStation and Xbox. (Epic, GOG and RetroAchievements have
// theirs next to their imports.) Every list item has the same shape:
//   { name, description, icon, earnedAt: ISO | '' (earned, no date) | null (locked),
//     hidden, rarity: % of players | null, points?, grade? }
//
//   GET /api/steam/achievements/list?appid=
//   GET /api/psn/trophies/list?title=
//   GET /api/xbox/achievements/list?ref=<title id>
import express from 'express';
import { getTitleTrophies, getUserTitles, getUserTrophiesEarnedForTitle } from 'psn-api';
import { query } from './db.mjs';
import { NotConnected, psnAuthFor, resetPsnSession, xboxKeyFor } from './platformLogins.mjs';
import { xboxTitleAchievements } from './xbox.mjs';

const UA = 'Savepoint/0.1 (self-hosted game library app)';

async function steamGet(path, params) {
  const url = new URL(`https://api.steampowered.com/${path}`);
  url.search = new URLSearchParams({ key: process.env.STEAM_API_KEY ?? '', format: 'json', ...params });
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  return r.json().catch(() => ({}));
}

async function steamList(userId, appid) {
  const { rows } = await query('SELECT "steam_id" FROM users WHERE "id" = $1', [userId]);
  const steamid = rows[0]?.steam_id;
  if (!steamid) throw new NotConnected('Connect Steam first (Platforms page).');
  const [mine, schema, global] = await Promise.all([
    steamGet('ISteamUserStats/GetPlayerAchievements/v1/', { steamid, appid, l: 'english' }),
    steamGet('ISteamUserStats/GetSchemaForGame/v2/', { appid, l: 'english' }),
    steamGet('ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/', { gameid: appid }),
  ]);
  if (/not public/i.test(mine?.playerstats?.error ?? '')) {
    throw new NotConnected("Steam won't share achievements while your profile's Game details are private.");
  }
  const defs = new Map((schema?.game?.availableGameStats?.achievements ?? []).map((a) => [a.name, a]));
  const pct = new Map((global?.achievementpercentages?.achievements ?? []).map((a) => [a.name, Number(a.percent)]));
  return (mine?.playerstats?.achievements ?? []).map((a) => {
    const d = defs.get(a.apiname) ?? {};
    const earned = !!a.achieved;
    return {
      name: a.name || d.displayName || a.apiname,
      description: a.description || d.description || '',
      icon: (earned ? d.icon : d.icongray) || null,
      earnedAt: earned ? (a.unlocktime ? new Date(a.unlocktime * 1000).toISOString() : '') : null,
      hidden: !!d.hidden,
      rarity:
        pct.has(a.apiname) && Number.isFinite(pct.get(a.apiname)) ? Math.round(pct.get(a.apiname) * 10) / 10 : null,
    };
  });
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const titleLists = new Map(); // userId -> { at, titles }

async function psnTitles(userId, auth) {
  const hit = titleLists.get(userId);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.titles;
  const titles = [];
  for (let offset = 0, page = 0; page < 20; page++) {
    const r = await getUserTitles(auth, 'me', { limit: 800, offset });
    titles.push(...r.trophyTitles);
    if (!r.nextOffset || titles.length >= r.totalItemCount) break;
    offset = r.nextOffset;
  }
  titleLists.set(userId, { at: Date.now(), titles });
  return titles;
}

async function psnList(userId, title) {
  const auth = await psnAuthFor(userId);
  const want = norm(title);
  const t = (await psnTitles(userId, auth)).find((x) => norm(x.trophyTitleName) === want);
  if (!t) return [];
  const npServiceName = /PS5/.test(t.trophyTitlePlatform ?? '') ? 'trophy2' : 'trophy';
  const [defs, mine] = await Promise.all([
    getTitleTrophies(auth, t.npCommunicationId, 'all', { npServiceName }),
    getUserTrophiesEarnedForTitle(auth, 'me', t.npCommunicationId, 'all', { npServiceName }),
  ]);
  const earned = new Map((mine?.trophies ?? []).map((x) => [x.trophyId, x]));
  return (defs?.trophies ?? []).map((d) => {
    const e = earned.get(d.trophyId);
    return {
      name: d.trophyName ?? 'Trophy',
      description: d.trophyDetail ?? '',
      icon: d.trophyIconUrl ?? null,
      earnedAt: e?.earned ? (e.earnedDateTime ?? '') : null,
      hidden: !!d.trophyHidden,
      rarity: e?.trophyEarnedRate != null ? Number(e.trophyEarnedRate) : null,
      grade: d.trophyType,
    };
  });
}

export const achievementListRouter = express.Router();

const send = async (res, fn) => {
  try {
    res.json({ items: await fn() });
  } catch (err) {
    res.status(err instanceof NotConnected ? 409 : 502).json({ error: err.message });
  }
};

achievementListRouter.get('/api/steam/achievements/list', (req, res) => {
  const appid = String(req.query.appid ?? '');
  if (!/^\d{1,10}$/.test(appid)) return res.status(400).json({ error: 'Which game?' });
  if (!process.env.STEAM_API_KEY?.trim()) return res.status(501).json({ error: 'STEAM_API_KEY is not set.' });
  void send(res, () => steamList(req.userId, appid));
});

achievementListRouter.get('/api/psn/trophies/list', (req, res) => {
  const title = String(req.query.title ?? '').slice(0, 200);
  if (!title.trim()) return res.status(400).json({ error: 'Which game?' });
  void send(res, () =>
    psnList(req.userId, title).catch((err) => {
      resetPsnSession(req.userId);
      throw err;
    }),
  );
});

achievementListRouter.get('/api/xbox/achievements/list', (req, res) => {
  const ref = String(req.query.ref ?? '');
  if (!/^\d{1,12}$/.test(ref)) return res.status(400).json({ error: 'Which game?' });
  void send(res, async () => xboxTitleAchievements(await xboxKeyFor(req.userId), ref));
});
