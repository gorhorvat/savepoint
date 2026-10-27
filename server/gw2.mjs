// Guild Wars 2 stats from ArenaNet's official API (https://api.guildwars2.com/v2).
// Each account connects with its own API key (created at
// https://account.arena.net/applications), kept encrypted in game_connections
// like the PlayStation and Xbox connections. Endpoints the key has no
// permission for are left out instead of failing the whole read.
import express from 'express';
import { query } from './db.mjs';
import { decrypt, encrypt } from './platformLogins.mjs';

const API = 'https://api.guildwars2.com/v2';
const REFRESH_MS = 5 * 60 * 1000; // ArenaNet caches account data for about 5 minutes.
const KEY =
  /^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{20}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/i;

export class Gw2Error extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

async function get(path, key) {
  const url = `${API}/${path}${path.includes('?') ? '&' : '?'}v=latest`;
  let r;
  try {
    r = await fetch(url, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Gw2Error("Couldn't reach the Guild Wars 2 API. Try again in a moment.");
  }
  if (r.status === 401 || r.status === 403) {
    const body = await r.json().catch(() => ({}));
    throw new Gw2Error(
      /invalid/i.test(body.text ?? '') ? 'That API key is not valid.' : 'The API key is missing a permission.',
      r.status,
    );
  }
  if (r.status === 503) throw new Gw2Error('The Guild Wars 2 API is down for maintenance. Try again later.', 503);
  if (!r.ok && r.status !== 206) throw new Gw2Error(`The Guild Wars 2 API answered ${r.status}.`);
  return r.json();
}

/** The same request, or null when the key lacks its permission (or it fails). */
const maybe = (path, key) => get(path, key).catch(() => null);

// Public lists (all skins, minis, ...) change only with game updates.
const publicCache = new Map(); // path -> { at, value }
async function cached(path) {
  const hit = publicCache.get(path);
  if (hit && Date.now() - hit.at < 12 * 3600 * 1000) return hit.value;
  const value = await maybe(path);
  if (value) publicCache.set(path, { at: Date.now(), value });
  return value;
}

const EXPANSIONS = {
  PlayForFree: 'Free to Play',
  GuildWars2: 'Guild Wars 2',
  HeartOfThorns: 'Heart of Thorns',
  PathOfFire: 'Path of Fire',
  EndOfDragons: 'End of Dragons',
  SecretsOfTheObscure: 'Secrets of the Obscure',
  JanthirWilds: 'Janthir Wilds',
  VisionsOfEternity: 'Visions of Eternity',
};
const spaced = (s) =>
  String(s)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/ (Of|The) /g, (m) => m.toLowerCase());

// Collections: [label, the account's unlocks, everything in the game]
const COLLECTIONS = [
  ['Skins', 'account/skins', 'skins'],
  ['Dyes', 'account/dyes', 'colors'],
  ['Miniatures', 'account/minis', 'minis'],
  ['Mount skins', 'account/mounts/skins', 'mounts/skins'],
  ['Gliders', 'account/gliders', 'gliders'],
  ['Outfits', 'account/outfits', 'outfits'],
  ['Finishers', 'account/finishers', 'finishers'],
  ['Novelties', 'account/novelties', 'novelties'],
  ['Titles', 'account/titles', 'titles'],
  ['Mail carriers', 'account/mailcarriers', 'mailcarriers'],
  ['Legendary armory', 'account/legendaryarmory', 'legendaryarmory'],
];

// Wallet currencies worth showing, in this order (ids from /v2/currencies).
const WALLET = [1, 4, 2, 3, 23, 7, 15, 30, 32, 45, 63];

/** An account's stats, read with its API key. */
export async function readAccount(key) {
  const token = await get('tokeninfo', key);
  const permissions = new Set(token.permissions ?? []);
  const account = await get('account', key);

  const has = (...p) => p.every((x) => permissions.has(x));
  const [
    world,
    names,
    mastery,
    achievements,
    wallet,
    currencies,
    pvp,
    luck,
    mountTypes,
    allMountTypes,
    professions,
    guilds,
    collections,
  ] = await Promise.all([
    account.world ? cached(`worlds?ids=${account.world}`) : null,
    has('characters') ? maybe('characters', key) : null,
    has('progression') ? maybe('account/mastery/points', key) : null,
    has('progression') ? maybe('account/achievements', key) : null,
    has('wallet') ? maybe('account/wallet', key) : null,
    cached('currencies?ids=all'),
    has('pvp') ? maybe('pvp/stats', key) : null,
    has('progression', 'unlocks') ? maybe('account/luck', key) : null,
    has('unlocks') ? maybe('account/mounts/types', key) : null,
    cached('mounts/types?ids=all'),
    cached('professions?ids=all'),
    Promise.all((account.guilds ?? []).slice(0, 5).map((id) => cached(`guild/${id}`))),
    has('unlocks')
      ? Promise.all(
          COLLECTIONS.map(async ([label, mine, all]) => {
            const [owned, total] = await Promise.all([maybe(mine, key), cached(all)]);
            if (!Array.isArray(owned)) return null;
            return { label, owned: owned.length, total: Array.isArray(total) ? total.length : null };
          }),
        )
      : [],
  ]);

  // Characters: the core details and crafting of each (a few small requests
  // instead of ids=all, which also sends every bag and piece of gear).
  const characters = Array.isArray(names)
    ? (
        await Promise.all(
          names.slice(0, 70).map(async (name) => {
            const n = encodeURIComponent(name);
            const [core, crafting] = await Promise.all([
              maybe(`characters/${n}/core`, key),
              maybe(`characters/${n}/crafting`, key),
            ]);
            if (!core) return null;
            return {
              name: core.name,
              race: core.race ?? null,
              gender: core.gender ?? null,
              profession: core.profession ?? null,
              level: core.level ?? null,
              hours: core.age ? Math.round(core.age / 3600) : 0,
              deaths: core.deaths ?? 0,
              created: core.created ?? null,
              lastPlayed: core.last_modified ?? null,
              crafting: (crafting?.crafting ?? []).map((c) => ({
                discipline: spaced(c.discipline),
                rating: c.rating,
                active: !!c.active,
              })),
            };
          }),
        )
      ).filter(Boolean)
    : null;

  const profIcons = Object.fromEntries((professions ?? []).map((p) => [p.id, p.icon ?? null]));
  const currencyById = new Map((currencies ?? []).map((c) => [c.id, c]));
  const walletById = new Map((wallet ?? []).map((w) => [w.id, w.value]));
  const mountNames = new Map((allMountTypes ?? []).map((m) => [m.id, m.name]));
  const done = Array.isArray(achievements) ? achievements.filter((a) => a.done).length : null;

  return {
    id: account.id,
    name: account.name,
    world: world?.[0]?.name ?? null,
    created: account.created ?? null,
    hours: account.age ? Math.round(account.age / 3600) : null,
    commander: !!account.commander,
    fractalLevel: account.fractal_level ?? null,
    wvwRank: account.wvw?.rank ?? account.wvw_rank ?? null,
    expansions: (account.access ?? []).filter((a) => a !== 'None').map((a) => EXPANSIONS[a] ?? spaced(a)),
    guilds: guilds.filter(Boolean).map((g) => ({ name: g.name, tag: g.tag })),
    permissions: [...permissions],
    characters: characters?.map((c) => ({ ...c, icon: profIcons[c.profession] ?? null })) ?? null,
    mastery: mastery?.totals
      ? mastery.totals.map((t) => ({ region: spaced(t.region), earned: t.earned, spent: t.spent }))
      : null,
    achievementsDone: done,
    luck: Array.isArray(luck) ? (luck.find((l) => l.id === 'luck')?.value ?? 0) : null,
    wallet: wallet
      ? WALLET.filter((id) => walletById.has(id)).map((id) => ({
          id,
          name: currencyById.get(id)?.name ?? `Currency ${id}`,
          icon: currencyById.get(id)?.icon ?? null,
          value: walletById.get(id),
        }))
      : null,
    pvp: pvp
      ? {
          rank: (pvp.pvp_rank ?? 0) + (pvp.pvp_rank_rollovers ?? 0),
          wins: pvp.aggregate?.wins ?? 0,
          losses: pvp.aggregate?.losses ?? 0,
        }
      : null,
    mounts: Array.isArray(mountTypes)
      ? { owned: mountTypes.map((id) => mountNames.get(id) ?? spaced(id)), total: allMountTypes?.length ?? null }
      : null,
    collections: collections.filter(Boolean),
  };
}

// ---------------------------------------------------------------- routes

export const gw2Router = express.Router();

function failed(res, err, what) {
  if (err instanceof Gw2Error)
    return res.status(err.status === 401 || err.status === 403 ? 400 : err.status).json({ error: err.message });
  console.error(what, err);
  res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
}

const row = (r, data) => ({
  game: 'gw2',
  externalId: r.external_id,
  name: data.name,
  data,
  fetchedAt: r.fetched_at,
});

async function save(userId, account, secret) {
  const { rows } = await query(
    `INSERT INTO game_connections ("user_id", "game", "external_id", "name", "data", "fetched_at", "secret")
     VALUES ($1, 'gw2', $2, $3, $4, now(), $5)
     ON CONFLICT ("user_id", "game") DO UPDATE SET "external_id" = EXCLUDED."external_id", "name" = EXCLUDED."name",
       "data" = EXCLUDED."data", "fetched_at" = now(), "secret" = COALESCE(EXCLUDED."secret", game_connections."secret")
     RETURNING "external_id", "fetched_at"`,
    [userId, account.id, account.name, JSON.stringify(account), secret],
  );
  return row(rows[0], account);
}

// Body: { key } -> the connection
gw2Router.post('/api/games/gw2/connect', express.json({ limit: '10kb' }), async (req, res) => {
  const key = String(req.body?.key ?? '').trim();
  if (!KEY.test(key)) return res.status(400).json({ error: 'Paste the whole API key from your ArenaNet account.' });
  try {
    const account = await readAccount(key);
    res.json(await save(req.userId, account, await encrypt(key)));
  } catch (err) {
    failed(res, err, 'GW2 connect:');
  }
});

// Reads the account again (at most every 5 minutes). -> the connection
gw2Router.post('/api/games/gw2/refresh', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT "external_id", "data", "fetched_at", "secret" FROM game_connections WHERE "user_id" = $1 AND "game" = 'gw2'`,
      [req.userId],
    );
    const current = rows[0];
    if (!current?.secret) return res.status(404).json({ error: 'Connect your account first.' });
    if (Date.now() - new Date(current.fetched_at).getTime() < REFRESH_MS) return res.json(row(current, current.data));
    let key;
    try {
      key = await decrypt(current.secret);
    } catch {
      return res.status(409).json({ error: 'Connect your account again: the saved API key can no longer be read.' });
    }
    res.json(await save(req.userId, await readAccount(key), null));
  } catch (err) {
    failed(res, err, 'GW2 refresh:');
  }
});

gw2Router.delete('/api/games/gw2', async (req, res) => {
  try {
    await query(`DELETE FROM game_connections WHERE "user_id" = $1 AND "game" = 'gw2'`, [req.userId]);
    res.status(204).end();
  } catch (err) {
    failed(res, err, 'GW2 disconnect:');
  }
});
