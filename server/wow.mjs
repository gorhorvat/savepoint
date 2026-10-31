// World of Warcraft in My Stats: characters added by region, realm and name
// (no Battle.net sign-in), read from two sources that fill each other in:
//
// - Blizzard's official API, with the app's own keys (BLIZZARD_CLIENT_ID and
//   BLIZZARD_CLIENT_SECRET, free from https://develop.battle.net): profile,
//   renders, gear, stats, Mythic+ rating, raid kills, PvP, professions and
//   collections. Blizzard updates a character when its player logs out.
// - Raider.IO's free public API (no key): Mythic+ score with its colour, best
//   and recent runs, world/region/realm ranks, raid progress, and gear icons.
//
// Without the Blizzard keys the tab still works from Raider.IO alone, and the
// Blizzard-only sections stay hidden. Up to 8 characters per account.
//
//   GET    /api/games/wow/setup                    { blizzard, regions }
//   GET    /api/games/wow/realms?region=eu         [{ name, slug }] (needs the Blizzard keys)
//   POST   /api/games/wow/characters               { region, realm, name } -> connection
//   POST   /api/games/wow/refresh                  reads every character again -> connection
//   DELETE /api/games/wow/characters/:key          removes one character -> connection or 204
//   DELETE /api/games/wow                          removes them all
import express from 'express';
import { query } from './db.mjs';
import { saveSnapshot } from './snapshots.mjs';

const REGIONS = [
  { value: 'eu', label: 'Europe' },
  { value: 'us', label: 'Americas & Oceania' },
  { value: 'kr', label: 'Korea' },
  { value: 'tw', label: 'Taiwan' },
];
const MAX_CHARACTERS = 8;
const REFRESH_MS = 5 * 60_000;

export class WowError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const blizzardConfigured = () =>
  Boolean(process.env.BLIZZARD_CLIENT_ID?.trim() && process.env.BLIZZARD_CLIENT_SECRET?.trim());

/** "Twisting Nether" -> "twisting-nether", "Kel'Thuzad" -> "kelthuzad". */
export function realmSlug(realm) {
  const t = realm.trim();
  // Already a slug (from the realm list): keep it, accents and all ("pozzo-delleternità").
  if (/^[^\sA-Z'’]+$/.test(t)) return t;
  return t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------- Blizzard

let token = null; // { value, until }

async function blizzardToken() {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const basic = Buffer.from(
    `${process.env.BLIZZARD_CLIENT_ID.trim()}:${process.env.BLIZZARD_CLIENT_SECRET.trim()}`,
  ).toString('base64');
  const r = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new WowError('Blizzard didn’t accept the app’s keys (BLIZZARD_CLIENT_ID and SECRET).', 503);
  const data = await r.json();
  token = { value: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return token.value;
}

/** A Blizzard API read; null when it isn't there (404) or fails. */
async function blizzard(region, path, namespace = 'profile') {
  const url = `https://${region}.api.blizzard.com${path}${path.includes('?') ? '&' : '?'}namespace=${namespace}-${region}&locale=en_US`;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${await blizzardToken()}` },
      signal: AbortSignal.timeout(12000),
    });
    if (r.status === 401) token = null;
    if (!r.ok) return null;
    return await r.json();
  } catch (err) {
    if (err instanceof WowError) throw err;
    return null;
  }
}

const realmCache = new Map(); // region -> { at, list }

export async function realms(region) {
  const hit = realmCache.get(region);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.list;
  const data = await blizzard(region, '/data/wow/realm/index', 'dynamic');
  const list = (data?.realms ?? [])
    .map((r) => ({ name: r.name, slug: r.slug }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (list.length) realmCache.set(region, { at: Date.now(), list });
  return list;
}

const statValue = (s) => (typeof s === 'number' ? s : (s?.effective ?? s?.value ?? null));
const round1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : null);

async function readBlizzard(region, slug, name) {
  const base = `/profile/wow/character/${encodeURIComponent(slug)}/${encodeURIComponent(name.toLowerCase())}`;
  const profile = await blizzard(region, base);
  if (!profile) return null;
  const [media, equipment, stats, keystone, raids, pvp, professions, mounts, pets, toys, titles] = await Promise.all(
    [
      '/character-media',
      '/equipment',
      '/statistics',
      '/mythic-keystone-profile',
      '/encounters/raids',
      '/pvp-summary',
      '/professions',
      '/collections/mounts',
      '/collections/pets',
      '/collections/toys',
      '/titles',
    ].map((p) => blizzard(region, base + p)),
  );

  // PvP ratings live one request per bracket; the summary says which exist.
  const bracketNames = (pvp?.brackets ?? [])
    .map((b) => /pvp-bracket\/([^?/]+)/.exec(b.href ?? '')?.[1])
    .filter(Boolean)
    .slice(0, 6);
  const brackets = (await Promise.all(bracketNames.map((b) => blizzard(region, `${base}/pvp-bracket/${b}`))))
    .map((b, i) =>
      b
        ? {
            bracket: bracketNames[i],
            rating: b.rating ?? null,
            played: b.season_match_statistics?.played ?? 0,
            won: b.season_match_statistics?.won ?? 0,
          }
        : null,
    )
    .filter((b) => b && (b.rating || b.played));

  const asset = (key) => media?.assets?.find((a) => a.key === key)?.value ?? null;
  // The newest expansion with any raid kills, else the newest one.
  const expansions = raids?.expansions ?? [];
  const current =
    [...expansions]
      .reverse()
      .find((e) => e.instances?.some((i) => i.modes?.some((m) => m.progress?.completed_count))) ?? expansions.at(-1);

  return {
    name: profile.name,
    realm: profile.realm?.name ?? null,
    level: profile.level ?? null,
    race: profile.race?.name ?? null,
    className: profile.character_class?.name ?? null,
    spec: profile.active_spec?.name ?? null,
    faction: profile.faction?.name ?? null,
    gender: profile.gender?.name ?? null,
    guild: profile.guild?.name ?? null,
    title: profile.active_title?.display_string?.replace('{name}', profile.name) ?? null,
    itemLevel: profile.equipped_item_level ?? profile.average_item_level ?? null,
    achievementPoints: profile.achievement_points ?? null,
    lastLogin: profile.last_login_timestamp ? new Date(profile.last_login_timestamp).toISOString() : null,
    images: { avatar: asset('avatar'), inset: asset('inset'), main: asset('main-raw') ?? asset('main') },
    gear: (equipment?.equipped_items ?? [])
      .filter((i) => !['SHIRT', 'TABARD'].includes(i.slot?.type))
      .map((i) => ({
        slot: i.slot?.name ?? '',
        itemId: i.item?.id ?? null,
        name: i.name ?? '',
        itemLevel: i.level?.value ?? null,
        quality: (i.quality?.type ?? 'COMMON').toLowerCase(),
        enchant: i.enchantments?.map((e) => e.display_string?.replace(/^Enchanted: /, '')).find(Boolean) ?? null,
        gems: (i.sockets ?? []).map((s) => s.item?.name).filter(Boolean),
        icon: null,
      })),
    stats: stats
      ? {
          health: stats.health ?? null,
          primary:
            [
              ['Strength', statValue(stats.strength)],
              ['Agility', statValue(stats.agility)],
              ['Intellect', statValue(stats.intellect)],
            ]
              .filter(([, v]) => v)
              .sort((a, b) => b[1] - a[1])[0] ?? null,
          stamina: statValue(stats.stamina),
          crit: round1(
            Math.max(stats.melee_crit?.value ?? 0, stats.spell_crit?.value ?? 0, stats.ranged_crit?.value ?? 0),
          ),
          haste: round1(
            Math.max(stats.melee_haste?.value ?? 0, stats.spell_haste?.value ?? 0, stats.ranged_haste?.value ?? 0),
          ),
          mastery: round1(stats.mastery?.value),
          versatility: round1(stats.versatility_damage_done_bonus),
          leech: round1(stats.lifesteal?.value),
          speed: round1(stats.speed?.value),
          avoidance: round1(stats.avoidance?.value),
          armor: statValue(stats.armor),
        }
      : null,
    mythicRating: keystone?.current_mythic_rating?.rating ?? null,
    raids: current
      ? {
          expansion: current.expansion?.name ?? null,
          instances: (current.instances ?? []).map((i) => ({
            name: i.instance?.name ?? '',
            modes: (i.modes ?? []).map((m) => ({
              difficulty: m.difficulty?.name ?? m.difficulty?.type ?? '',
              killed: m.progress?.completed_count ?? 0,
              total: m.progress?.total_count ?? 0,
            })),
          })),
        }
      : null,
    pvp: pvp ? { honor: pvp.honor_level ?? null, brackets } : null,
    professions: [...(professions?.primaries ?? []), ...(professions?.secondaries ?? [])]
      .map((p) => {
        const tier = (p.tiers ?? []).at(-1);
        return {
          name: p.profession?.name ?? '',
          tier: tier?.tier?.name ?? null,
          skill: tier?.skill_points ?? p.skill_points ?? null,
          max: tier?.max_skill_points ?? p.max_skill_points ?? null,
        };
      })
      .filter((p) => p.name),
    collections:
      mounts || pets || toys || titles
        ? {
            mounts: mounts?.mounts?.length ?? null,
            pets: pets?.pets?.length ?? null,
            toys: toys?.toys?.length ?? null,
            titles: titles?.titles?.length ?? null,
          }
        : null,
  };
}

// ---------------------------------------------------------------- Raider.IO

const RIO_FIELDS = [
  'gear',
  'guild',
  'mythic_plus_scores_by_season:current',
  'mythic_plus_ranks',
  'mythic_plus_best_runs',
  'mythic_plus_recent_runs',
  'raid_progression',
].join(',');

const RIO_SLOTS = {
  shoulder: 'Shoulders',
  finger1: 'Ring 1',
  finger2: 'Ring 2',
  trinket1: 'Trinket 1',
  trinket2: 'Trinket 2',
  mainhand: 'Main Hand',
  offhand: 'Off Hand',
};

const QUALITY = ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'artifact', 'heirloom'];

const run = (r) => ({
  dungeon: r.dungeon ?? '',
  short: r.short_name ?? null,
  level: r.mythic_level ?? null,
  upgrades: r.num_keystone_upgrades ?? 0,
  minutes: r.clear_time_ms ? Math.round(r.clear_time_ms / 600) / 100 : null,
  parMinutes: r.par_time_ms ? Math.round(r.par_time_ms / 600) / 100 : null,
  score: r.score ?? null,
  at: r.completed_at ?? null,
  affixes: (r.affixes ?? []).map((a) => a.name).filter(Boolean),
  url: r.url ?? null,
});

async function readRaiderIo(region, realm, name) {
  const qs = new URLSearchParams({ region, realm, name, fields: RIO_FIELDS });
  let r;
  try {
    r = await fetch(`https://raider.io/api/v1/characters/profile?${qs}`, { signal: AbortSignal.timeout(12000) });
  } catch {
    return null;
  }
  if (!r.ok) return null;
  const p = await r.json().catch(() => null);
  if (!p?.name) return null;
  const season = p.mythic_plus_scores_by_season?.[0];
  const ranks = p.mythic_plus_ranks ?? {};
  const gearItems = Object.entries(p.gear?.items ?? {}).map(([slot, i]) => ({ slot, ...i }));
  return {
    name: p.name,
    realm: p.realm ?? null,
    race: p.race ?? null,
    className: p.class ?? null,
    spec: p.active_spec_name ?? null,
    role: p.active_spec_role ?? null,
    faction: p.faction ? p.faction.charAt(0).toUpperCase() + p.faction.slice(1) : null,
    guild: p.guild?.name ?? null,
    achievementPoints: p.achievement_points ?? null,
    thumbnail: p.thumbnail_url ?? null,
    itemLevel: p.gear?.item_level_equipped ?? null,
    gear: gearItems
      .filter((i) => i.slot !== 'shirt' && i.slot !== 'tabard')
      .map((i) => ({
        slot: RIO_SLOTS[i.slot] ?? i.slot.charAt(0).toUpperCase() + i.slot.slice(1),
        itemId: i.item_id ?? null,
        name: i.name ?? '',
        itemLevel: i.item_level ?? null,
        quality: QUALITY[i.item_quality] ?? 'common',
        icon: i.icon ?? null,
        enchant: null,
        gems: [],
      })),
    mythic: {
      season: season?.season ?? null,
      score: season?.scores?.all ?? null,
      color: season?.segments?.all?.color ?? null,
      roles: season
        ? { tank: season.scores?.tank ?? 0, healer: season.scores?.healer ?? 0, dps: season.scores?.dps ?? 0 }
        : null,
      ranks: ranks.overall
        ? {
            world: ranks.overall.world ?? null,
            region: ranks.overall.region ?? null,
            realm: ranks.overall.realm ?? null,
            classWorld: ranks.class?.world ?? null,
            classRealm: ranks.class?.realm ?? null,
          }
        : null,
      best: (p.mythic_plus_best_runs ?? []).map(run),
      recent: (p.mythic_plus_recent_runs ?? []).map(run),
    },
    raidProgress: Object.entries(p.raid_progression ?? {}).map(([slug, v]) => ({
      slug,
      name: slug
        .split('-')
        .map((w) => (['of', 'the'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' '),
      summary: v.summary ?? null,
      total: v.total_bosses ?? 0,
      normal: v.normal_bosses_killed ?? 0,
      heroic: v.heroic_bosses_killed ?? 0,
      mythic: v.mythic_bosses_killed ?? 0,
    })),
    url: p.profile_url ?? null,
    crawled: p.last_crawled_at ?? null,
  };
}

// ---------------------------------------------------------------- one character

const iconUrl = (icon) => (icon ? `https://render.worldofwarcraft.com/us/icons/56/${icon}.jpg` : null);

export async function readCharacter(region, realm, name) {
  const slug = realmSlug(realm);
  const [bz, rio] = await Promise.all([
    blizzardConfigured() ? readBlizzard(region, slug, name) : null,
    readRaiderIo(region, slug, name),
  ]);
  if (!bz && !rio) {
    throw new WowError(
      `No character called ${name} on ${realm} (${region.toUpperCase()}). Check the spelling and region; characters that haven't logged in for a long time aren't found.`,
      404,
    );
  }
  // Gear: Blizzard's (with enchants and gems) where there is it, Raider.IO's icons on top.
  const icons = new Map((rio?.gear ?? []).map((g) => [g.itemId, g.icon]));
  const gear = (bz?.gear?.length ? bz.gear : (rio?.gear ?? [])).map((g) => ({
    ...g,
    icon: iconUrl(g.icon ?? icons.get(g.itemId) ?? null),
  }));
  const displayName = bz?.name ?? rio?.name ?? name;
  const realmName = bz?.realm ?? rio?.realm ?? realm;
  return {
    key: `${region}/${slug}/${displayName.toLowerCase()}`,
    region,
    realm: { name: realmName, slug },
    name: displayName,
    level: bz?.level ?? null,
    race: bz?.race ?? rio?.race ?? null,
    className: bz?.className ?? rio?.className ?? null,
    spec: bz?.spec ?? rio?.spec ?? null,
    role: rio?.role ?? null,
    faction: bz?.faction ?? rio?.faction ?? null,
    guild: bz?.guild ?? rio?.guild ?? null,
    title: bz?.title ?? null,
    itemLevel: bz?.itemLevel ?? rio?.itemLevel ?? null,
    achievementPoints: bz?.achievementPoints ?? rio?.achievementPoints ?? null,
    lastLogin: bz?.lastLogin ?? null,
    images: {
      avatar: bz?.images.avatar ?? rio?.thumbnail ?? null,
      inset: bz?.images.inset ?? null,
      main: bz?.images.main ?? null,
    },
    gear,
    stats: bz?.stats ?? null,
    mythic: {
      score: rio?.mythic.score ?? bz?.mythicRating ?? null,
      color: rio?.mythic.color ?? null,
      season: rio?.mythic.season ?? null,
      roles: rio?.mythic.roles ?? null,
      ranks: rio?.mythic.ranks ?? null,
      best: rio?.mythic.best ?? [],
      recent: rio?.mythic.recent ?? [],
    },
    raids: bz?.raids ?? null,
    raidProgress: rio?.raidProgress ?? [],
    pvp: bz?.pvp ?? null,
    professions: bz?.professions ?? [],
    collections: bz?.collections ?? null,
    sources: { blizzard: !!bz, raiderio: !!rio },
    links: {
      armory: `https://worldofwarcraft.blizzard.com/en-gb/character/${region}/${encodeURIComponent(slug)}/${encodeURIComponent(displayName.toLowerCase())}`,
      raiderio: rio?.url ?? null,
    },
  };
}

// ---------------------------------------------------------------- routes

const row = (r) => ({ game: 'wow', externalId: r.external_id, name: r.name, data: r.data, fetchedAt: r.fetched_at });

/** Today's numbers per character, for the progress graphs. */
const snapshotOf = (characters) => ({
  characters: Object.fromEntries(
    characters.map((c) => [
      c.key,
      {
        itemLevel: c.itemLevel,
        mythic: c.mythic.score,
        achievements: c.achievementPoints,
        mounts: c.collections?.mounts ?? null,
      },
    ]),
  ),
});

async function load(userId) {
  const { rows } = await query(
    `SELECT "external_id", "name", "data", "fetched_at" FROM game_connections WHERE "user_id" = $1 AND "game" = 'wow'`,
    [userId],
  );
  return rows[0] ?? null;
}

async function save(userId, characters) {
  if (!characters.length) {
    await query(`DELETE FROM game_connections WHERE "user_id" = $1 AND "game" = 'wow'`, [userId]);
    return null;
  }
  const main = characters[0];
  const { rows } = await query(
    `INSERT INTO game_connections ("user_id", "game", "external_id", "name", "data", "fetched_at")
     VALUES ($1, 'wow', $2, $3, $4, now())
     ON CONFLICT ("user_id", "game") DO UPDATE SET "external_id" = EXCLUDED."external_id",
       "name" = EXCLUDED."name", "data" = EXCLUDED."data", "fetched_at" = now()
     RETURNING "external_id", "name", "data", "fetched_at"`,
    [userId, main.key, main.name, JSON.stringify({ characters })],
  );
  await saveSnapshot(userId, 'wow', snapshotOf(characters));
  return row(rows[0]);
}

function failed(res, err, what) {
  if (err instanceof WowError) return res.status(err.status).json({ error: err.message });
  console.error(what, err);
  res.status(502).json({ error: "Couldn't read the character. Try again in a moment." });
}

export const wowRouter = express.Router();

wowRouter.get('/api/games/wow/setup', (_req, res) => {
  res.json({ blizzard: blizzardConfigured(), regions: REGIONS });
});

wowRouter.get('/api/games/wow/realms', async (req, res) => {
  const region = String(req.query.region ?? '');
  if (!REGIONS.some((r) => r.value === region)) return res.status(400).json({ error: 'Pick a region.' });
  if (!blizzardConfigured()) return res.json({ realms: [] });
  try {
    res.json({ realms: await realms(region) });
  } catch (err) {
    failed(res, err, 'WoW realms:');
  }
});

wowRouter.post('/api/games/wow/characters', express.json({ limit: '10kb' }), async (req, res) => {
  const region = String(req.body?.region ?? '');
  const realm = typeof req.body?.realm === 'string' ? req.body.realm.trim().slice(0, 60) : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 24) : '';
  if (!REGIONS.some((r) => r.value === region)) return res.status(400).json({ error: 'Pick a region.' });
  if (!realm || !name) return res.status(400).json({ error: 'Enter the realm and the character’s name.' });
  try {
    const current = (await load(req.userId))?.data?.characters ?? [];
    const character = await readCharacter(region, realm, name);
    const others = current.filter((c) => c.key !== character.key);
    if (others.length >= MAX_CHARACTERS) {
      return res.status(400).json({ error: `Up to ${MAX_CHARACTERS} characters. Remove one first.` });
    }
    res.json(await save(req.userId, [...others, character]));
  } catch (err) {
    failed(res, err, 'WoW add:');
  }
});

wowRouter.post('/api/games/wow/refresh', async (req, res) => {
  try {
    const current = await load(req.userId);
    if (!current) return res.status(404).json({ error: 'Add a character first.' });
    if (Date.now() - new Date(current.fetched_at).getTime() < REFRESH_MS) return res.json(row(current));
    const old = current.data?.characters ?? [];
    // A character that can't be read right now keeps its last numbers.
    const fresh = await Promise.all(old.map((c) => readCharacter(c.region, c.realm.slug, c.name).catch(() => c)));
    res.json(await save(req.userId, fresh));
  } catch (err) {
    failed(res, err, 'WoW refresh:');
  }
});

wowRouter.delete('/api/games/wow/characters/:key', async (req, res) => {
  try {
    const current = (await load(req.userId))?.data?.characters ?? [];
    const conn = await save(
      req.userId,
      current.filter((c) => c.key !== req.params.key),
    );
    if (!conn) return res.status(204).end();
    res.json(conn);
  } catch (err) {
    failed(res, err, 'WoW remove:');
  }
});

wowRouter.delete('/api/games/wow', async (req, res) => {
  try {
    await save(req.userId, []);
    res.status(204).end();
  } catch (err) {
    failed(res, err, 'WoW disconnect:');
  }
});
