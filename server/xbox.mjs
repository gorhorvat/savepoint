// Xbox, through OpenXBL (https://xbl.io): Microsoft has no public API for
// reading someone's games, so an Xbox owner signs in at xbl.io with their
// Microsoft account and creates a personal API key (free tier: 150 requests
// an hour). Set it as OPENXBL_API_KEY.
//
// One request gives every game played with its achievements and gamerscore
// (Xbox's title history). Play time is a separate request per game and Xbox
// doesn't always have it, so it's fetched only for recently played games and
// remembered per game until it's played again.
import { diskCache } from './diskCache.mjs';

const BASE = 'https://xbl.io/api/v2';
const MAX_STATS_PER_SYNC = 30;
const minutesCache = diskCache('xbox-minutes', 0);

export const xboxKey = () => process.env.OPENXBL_API_KEY?.trim() || '';

async function xbl(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { 'X-Authorization': xboxKey(), Accept: 'application/json', 'Accept-Language': 'en-US' },
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 401 || r.status === 403) throw new Error('OpenXBL refused the API key. Check OPENXBL_API_KEY.');
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

async function minutesFor(title) {
  const key = `${title.titleId}`;
  const cached = await minutesCache.get(key);
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

export async function xboxLibrary() {
  const history = await xbl('/achievements');
  const titles = toGames(history.titles);

  // Play time for the most recently played games whose time isn't known yet.
  const byRecent = [...titles]
    .filter((t) => !t.isApp)
    .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''));
  const minutes = new Map();
  let requests = 0;
  for (const t of byRecent) {
    const m = await minutesFor(t);
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
      const value = findMinutes(await xbl(`/achievements/stats/${encodeURIComponent(t.titleId)}`)) ?? 0;
      minutes.set(t.titleId, value);
      await minutesCache.set(t.titleId, { minutes: value, lastPlayed: t.lastPlayed });
    } catch {
      if (m.cached) minutes.set(t.titleId, m.cached.minutes);
    }
  }

  return titles.map(({ titleId, ...t }) => ({ ...t, externalId: titleId, minutes: minutes.get(titleId) ?? 0 }));
}
