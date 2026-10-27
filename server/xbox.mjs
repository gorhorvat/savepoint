// Xbox, through OpenXBL (https://xbl.io): Microsoft has no public API for
// reading someone's games, so each user signs in at xbl.io with their own
// Microsoft account, creates a personal API key (free tier: 150 requests an
// hour) and connects it in Settings (server/platformLogins.mjs).
//
// One request gives every game played with its achievements and gamerscore
// (Xbox's title history). Play time is a separate request per game and Xbox
// doesn't always have it, so it's fetched only for recently played games and
// remembered per game until it's played again.
import { diskCache } from './diskCache.mjs';

const BASE = 'https://xbl.io/api/v2';
const MAX_STATS_PER_SYNC = 30;
const minutesCache = diskCache('xbox-minutes', 0);

async function xbl(key, path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { 'X-Authorization': key, Accept: 'application/json', 'Accept-Language': 'en-US' },
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 401 || r.status === 403) {
    throw new Error('OpenXBL refused the API key. Check it on xbl.io, then disconnect and connect again.');
  }
  if (r.status === 429) throw new Error("OpenXBL's hourly limit is used up. Try again in an hour.");
  if (!r.ok) throw new Error(`OpenXBL answered ${r.status}`);
  return r.json();
}

/** Finds the MinutesPlayed stat wherever the stats response nests it. */
export function findMinutes(data) {
  let found = null;
  const walk = (v) => {
    if (found != null || !v || typeof v !== 'object') return;
    if (typeof v.name === 'string' && v.name.toLowerCase() === 'minutesplayed' && v.value != null) {
      const n = Number(v.value);
      if (Number.isFinite(n)) found = n;
      return;
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x);
  };
  walk(data);
  return found;
}

async function minutesFor(scope, title) {
  const cached = await minutesCache.get(`${scope}:${title.titleId}`);
  // Unchanged since last time: no request needed.
  if (cached && cached.lastPlayed === title.lastPlayed) return { minutes: cached.minutes, fetched: false };
  return { minutes: null, fetched: true, cached };
}

/** Converts Xbox title history into Savepoint's import shape. */
export function toGames(titles) {
  return (titles ?? [])
    .filter((t) => t && t.name && t.titleId != null)
    .map((t) => {
      const a = t.achievement ?? {};
      return {
        titleId: String(t.titleId),
        name: t.name,
        lastPlayed: t.titleHistory?.lastTimePlayed ?? null,
        imageUrl: t.displayImage || undefined,
        // Title history lists apps too (e.g. YouTube); only games count.
        isApp: typeof t.type === 'string' && t.type.toLowerCase() !== 'game',
        achievements:
          a.totalAchievements || a.totalGamerscore
            ? {
                earned: Number(a.currentAchievements) || 0,
                total: Number(a.totalAchievements) || 0,
                gamerscore: Number(a.currentGamerscore) || 0,
                totalGamerscore: Number(a.totalGamerscore) || 0,
              }
            : undefined,
      };
    });
}

/**
 * Finds the gamertag wherever the answer keeps it: Xbox profile settings
 * ({ id: "Gamertag", value }) or a plain gamertag field.
 */
export function findGamertag(data) {
  let found = null;
  const walk = (v, depth) => {
    if (found || !v || typeof v !== 'object' || depth > 8) return;
    if (/^(modern)?gamertag$/i.test(String(v.id ?? '')) && typeof v.value === 'string' && v.value) {
      found = v.value;
      return;
    }
    for (const k of ['gamertag', 'Gamertag', 'modernGamertag']) {
      if (typeof v[k] === 'string' && v[k]) {
        found = v[k];
        return;
      }
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, depth + 1);
  };
  walk(data, 0);
  return found;
}

/** The shape of an answer (its keys, no values), for logs. */
const shape = (v, depth = 0) =>
  !v || typeof v !== 'object' || depth > 2
    ? typeof v
    : Array.isArray(v)
      ? [v.length ? shape(v[0], depth + 1) : 'empty']
      : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));

/** The gamertag the key belongs to, or null; throws when OpenXBL refuses the key. */
export async function xboxAccount(key) {
  const data = await xbl(key, '/account');
  const name = findGamertag(data);
  if (!name) console.warn('[name lookup] Xbox: no gamertag in /account. Its shape:', JSON.stringify(shape(data)));
  return name;
}

/** The games of the Xbox account `key` belongs to. `scope` keeps each account's play times apart. */
export async function xboxLibrary(key, scope) {
  const history = await xbl(key, '/achievements');
  const titles = toGames(history.titles);

  // Play time for the most recently played games whose time isn't known yet.
  const byRecent = [...titles]
    .filter((t) => !t.isApp)
    .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''));
  const minutes = new Map();
  let requests = 0;
  for (const t of byRecent) {
    const m = await minutesFor(scope, t);
    if (!m.fetched) {
      minutes.set(t.titleId, m.minutes);
      continue;
    }
    if (requests >= MAX_STATS_PER_SYNC) {
      // Over this sync's budget: keep the last known value, refresh next time.
      if (m.cached) minutes.set(t.titleId, m.cached.minutes);
      continue;
    }
    requests++;
    try {
      const value = findMinutes(await xbl(key, `/achievements/stats/${encodeURIComponent(t.titleId)}`)) ?? 0;
      minutes.set(t.titleId, value);
      await minutesCache.set(`${scope}:${t.titleId}`, { minutes: value, lastPlayed: t.lastPlayed });
    } catch {
      if (m.cached) minutes.set(t.titleId, m.cached.minutes);
    }
  }

  return titles.map(({ titleId, ...t }) => ({ ...t, externalId: titleId, minutes: minutes.get(titleId) ?? 0 }));
}

/**
 * Whether the key's Xbox account is online and what it's playing. OpenXBL's
 * /presence answers with Xbox's presence record(s); read defensively.
 */
export async function xboxPresence(key) {
  const data = await xbl(key, '/presence');
  const record = [data, ...(Array.isArray(data) ? data : []), data?.content, ...(data?.content ?? [])].find(
    (r) => r && typeof r === 'object' && typeof r.state === 'string',
  );
  if (!record) return { online: false, playing: null };
  const online = record.state.toLowerCase() === 'online';
  const titles = (record.devices ?? []).flatMap((d) => d.titles ?? []);
  // The dashboard ("Home") and apps aren't games being played.
  const game = titles.find((t) => t.name && t.placement === 'Full' && !/^(home|online)$/i.test(t.name));
  return { online, playing: online ? (game?.name ?? null) : null };
}
