// Whether friends are online, on which platform, and what they're playing:
// Steam (public profile status, for every account with Steam connected), and
// PlayStation and Xbox through each friend's own connection. Each answer is
// kept for a minute, so a friends list that refreshes doesn't hammer the
// platforms (OpenXBL allows 150 requests an hour per key).
import { getBasicPresence } from 'psn-api';
import { psnAccountIdFor, psnAuthFor, xboxKeyFor } from './platformLogins.mjs';
import { query } from './db.mjs';
import { xboxPresence } from './xbox.mjs';

const TTL = 60_000;
const cache = new Map(); // key -> { at, value }

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - TTL) return hit.value;
  const value = await fn().catch(() => null);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** steamId -> { online, status, playing } for up to 100 Steam accounts in one request. */
async function steamPresence(steamIds) {
  const out = new Map();
  const missing = [];
  for (const id of steamIds) {
    const hit = cache.get(`steam:${id}`);
    if (hit && hit.at > Date.now() - TTL) out.set(id, hit.value);
    else missing.push(id);
  }
  const key = process.env.STEAM_API_KEY?.trim();
  if (!missing.length || !key) return out;
  try {
    const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
    url.search = new URLSearchParams({ key, steamids: missing.slice(0, 100).join(',') });
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const players = (await r.json()).response?.players ?? [];
    // personastate: 0 offline, 1 online, 2 busy, 3 away, 4 snooze, 5/6 looking to trade/play.
    const STATUS = { 1: 'online', 2: 'busy', 3: 'away', 4: 'snooze', 5: 'online', 6: 'online' };
    for (const p of players) {
      const value = {
        online: p.personastate > 0 || !!p.gameextrainfo,
        status: STATUS[p.personastate] ?? (p.gameextrainfo ? 'online' : 'offline'),
        playing: p.gameextrainfo ?? null,
      };
      out.set(p.steamid, value);
      cache.set(`steam:${p.steamid}`, { at: Date.now(), value });
    }
  } catch {
    // Unknown is shown as offline.
  }
  return out;
}

async function psnPresence(userId) {
  return cached(`psn:${userId}`, async () => {
    const auth = await psnAuthFor(userId);
    const accountId = await psnAccountIdFor(userId, auth);
    const p = (await getBasicPresence(auth, accountId)).basicPresence;
    const online = p?.primaryPlatformInfo?.onlineStatus === 'online' || p?.availability === 'availableToPlay';
    const platform = p?.primaryPlatformInfo?.platform?.toUpperCase();
    return {
      online,
      device: platform === 'PS5' || platform === 'PS4' ? platform : null,
      playing: online ? (p?.gameTitleInfoList?.[0]?.titleName ?? null) : null,
    };
  });
}

async function xboxStatus(userId) {
  return cached(`xbox:${userId}`, async () => xboxPresence(await xboxKeyFor(userId)));
}

/**
 * userId -> [{ platform: 'steam'|'playstation'|'xbox', online, status?, device?, playing }]
 * for the platforms each account has connected.
 */
export async function presenceFor(userIds) {
  if (!userIds.length) return new Map();
  const { rows: users } = await query('SELECT "id", "steam_id" FROM users WHERE "id" = ANY($1)', [userIds]);
  // Only the platforms with a presence (platform_logins also holds the Twitch sign-in).
  const { rows: logins } = await query(
    `SELECT "user_id", "platform" FROM platform_logins WHERE "user_id" = ANY($1) AND "platform" IN ('playstation', 'xbox')`,
    [userIds],
  );
  const steam = await steamPresence(users.map((u) => u.steam_id).filter(Boolean));
  const result = new Map(userIds.map((id) => [id, []]));
  for (const u of users) {
    const s = u.steam_id && steam.get(u.steam_id);
    if (s) result.get(u.id).push({ platform: 'steam', ...s });
  }
  await Promise.all(
    logins.map(async ({ user_id: id, platform }) => {
      const value = platform === 'playstation' ? await psnPresence(id) : await xboxStatus(id);
      if (value) result.get(id).push({ platform, ...value });
    }),
  );
  return result;
}
