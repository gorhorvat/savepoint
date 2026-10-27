// FINAL FANTASY XIV character stats from the official Lodestone
// (https://na.finalfantasyxiv.com/lodestone/), the character's public pages:
// profile, jobs, achievements, mounts and minions. Square Enix has no API, and
// XIVAPI dropped its Lodestone endpoints in v2, so Savepoint reads the pages
// itself with XIVAPI's selector files (server/lodestone).
//
// Each account connects one character (its Lodestone link or ID, or found by
// name and world); the result is kept in game_connections and refreshed on
// request at most every 30 minutes, to go easy on the Lodestone.
import express from 'express';
import { query } from './db.mjs';
import { parsePage } from './lodestone/parser.mjs';
import achievementSelectors from './lodestone/selectors/achievements.json' with { type: 'json' };
import character from './lodestone/selectors/character.json' with { type: 'json' };
import classjob from './lodestone/selectors/classjob.json' with { type: 'json' };
import minion from './lodestone/selectors/minion.json' with { type: 'json' };
import mount from './lodestone/selectors/mount.json' with { type: 'json' };
import search from './lodestone/selectors/search.json' with { type: 'json' };

// Static imports, so Vercel bundles the selector files with the function.
const selectors = structuredClone({ character, classjob, achievements: achievementSelectors, mount, minion, search });

// Grand Company names have spaces ("Order of the Twin Adder"); the shipped
// pattern only takes the last word.
selectors.character.GRAND_COMPANY.regex = '(?P<Name>.+?) / (?P<Rank>.*)';

// Job icons: the selector files have none, but each job's <li> on the
// class_job page starts with its icon, so it's read from the same <li> as the level.
for (const def of Object.values(selectors.classjob)) {
  const level = def?.LEVEL?.selector;
  if (level?.includes(' > li:') && level.endsWith(' > div:nth-child(2)')) {
    def.ICON = { selector: `${level.slice(0, -' > div:nth-child(2)'.length)} img`, attribute: 'src' };
  }
}

const BASE = 'https://na.finalfantasyxiv.com/lodestone';
// From the selector files' meta.json: mounts and minions only list their names
// on the mobile pages.
const DESKTOP_UA = 'curl/7.73.0';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU OS 10_15_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.1 Mobile/14E304 Safari/605.1.15';
const REFRESH_MS = 30 * 60 * 1000;

export class LodestoneError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

async function page(path, { mobile = false } = {}) {
  let r;
  try {
    r = await fetch(`${BASE}${path}`, {
      headers: { 'User-Agent': mobile ? MOBILE_UA : DESKTOP_UA, 'Accept-Language': 'en-US,en' },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new LodestoneError("Couldn't reach the Lodestone. Try again in a moment.");
  }
  if (r.status === 404) throw new LodestoneError('No character with that ID on the Lodestone.', 404);
  if (r.status === 403) return null; // A private section (achievements, for example).
  if (r.status === 503) throw new LodestoneError('The Lodestone is under maintenance. Try again later.', 503);
  if (!r.ok) throw new LodestoneError(`The Lodestone answered ${r.status}.`);
  return r.text();
}

// Jobs in the order the Lodestone lists them, with their role.
const JOBS = [
  ['PALADIN', 'Paladin', 'Tank'],
  ['WARRIOR', 'Warrior', 'Tank'],
  ['DARKKNIGHT', 'Dark Knight', 'Tank'],
  ['GUNBREAKER', 'Gunbreaker', 'Tank'],
  ['WHITEMAGE', 'White Mage', 'Healer'],
  ['SCHOLAR', 'Scholar', 'Healer'],
  ['ASTROLOGIAN', 'Astrologian', 'Healer'],
  ['SAGE', 'Sage', 'Healer'],
  ['MONK', 'Monk', 'Melee'],
  ['DRAGOON', 'Dragoon', 'Melee'],
  ['NINJA', 'Ninja', 'Melee'],
  ['SAMURAI', 'Samurai', 'Melee'],
  ['REAPER', 'Reaper', 'Melee'],
  ['VIPER', 'Viper', 'Melee'],
  ['BEASTMASTER', 'Beastmaster', 'Limited'],
  ['BARD', 'Bard', 'Ranged'],
  ['MACHINIST', 'Machinist', 'Ranged'],
  ['DANCER', 'Dancer', 'Ranged'],
  ['BLACKMAGE', 'Black Mage', 'Caster'],
  ['SUMMONER', 'Summoner', 'Caster'],
  ['REDMAGE', 'Red Mage', 'Caster'],
  ['PICTOMANCER', 'Pictomancer', 'Caster'],
  ['BLUEMAGE', 'Blue Mage', 'Limited'],
  ['CARPENTER', 'Carpenter', 'Crafter'],
  ['BLACKSMITH', 'Blacksmith', 'Crafter'],
  ['ARMORER', 'Armorer', 'Crafter'],
  ['GOLDSMITH', 'Goldsmith', 'Crafter'],
  ['LEATHERWORKER', 'Leatherworker', 'Crafter'],
  ['WEAVER', 'Weaver', 'Crafter'],
  ['ALCHEMIST', 'Alchemist', 'Crafter'],
  ['CULINARIAN', 'Culinarian', 'Crafter'],
  ['MINER', 'Miner', 'Gatherer'],
  ['BOTANIST', 'Botanist', 'Gatherer'],
  ['FISHER', 'Fisher', 'Gatherer'],
];

const num = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** A character's public Lodestone pages, read and tidied into one object. */
export async function readCharacter(id) {
  const [profileHtml, jobsHtml, achievementsHtml, mountsHtml, minionsHtml] = await Promise.all([
    page(`/character/${id}/`),
    page(`/character/${id}/class_job/`),
    page(`/character/${id}/achievement/`),
    page(`/character/${id}/mount/`, { mobile: true }),
    page(`/character/${id}/minion/`, { mobile: true }),
  ]);
  if (!profileHtml) throw new LodestoneError("That character's profile is private.", 403);
  const p = parsePage(profileHtml, selectors.character);
  if (!p.NAME) throw new LodestoneError("Couldn't read that character's Lodestone page.", 502);

  const j = jobsHtml ? parsePage(jobsHtml, selectors.classjob) : {};
  const jobs = JOBS.map(([key, name, role]) => {
    const d = j[key] ?? {};
    const level = num(d.LEVEL);
    return {
      key,
      name,
      role,
      level: level ?? 0,
      icon: typeof d.ICON === 'string' ? d.ICON : null,
      exp: d.EXP && num(d.EXP.MaxEXP) ? { current: num(d.EXP.CurrentEXP) ?? 0, max: num(d.EXP.MaxEXP) } : null,
    };
  });

  let achievements = { public: false, total: null, points: null, recent: [] };
  if (achievementsHtml) {
    const a = parsePage(achievementsHtml, selectors.achievements);
    const isPrivate = !a.ENTRY?.length && !a.ACHIEVEMENT_POINTS && !a.TOTAL_ACHIEVEMENTS;
    achievements = {
      public: !isPrivate,
      total: num(a.TOTAL_ACHIEVEMENTS?.TotalAchievements),
      points: num(a.ACHIEVEMENT_POINTS),
      recent: (a.ENTRY ?? [])
        .map((e) => ({
          id: num(e.ID?.ID),
          name: e.NAME?.Name ?? e.NAME?.NameDE ?? null,
          time: num(e.TIME?.Timestamp) ? new Date(num(e.TIME.Timestamp) * 1000).toISOString() : null,
        }))
        .filter((e) => e.name)
        .slice(0, 20),
    };
  }

  const collection = (html, sel, listKey) => {
    if (!html) return { public: false, count: 0, list: [] };
    const d = parsePage(html, sel);
    const list = (d[listKey] ?? []).filter((m) => m.NAME).map((m) => ({ name: String(m.NAME), icon: m.ICON ?? null }));
    return { public: true, count: num(d.TOTAL) ?? list.length, list };
  };

  return {
    id: String(id),
    name: String(p.NAME),
    title: p.TITLE ? String(p.TITLE) : null,
    world: p.SERVER?.World ?? null,
    dataCenter: p.SERVER?.DC ?? null,
    race: p.RACE_CLAN_GENDER?.Race ?? null,
    clan: p.RACE_CLAN_GENDER?.Tribe ?? null,
    gender: p.RACE_CLAN_GENDER?.Gender ?? null,
    nameday: p.NAMEDAY ? String(p.NAMEDAY) : null,
    guardian: p.GUARDIAN_DEITY?.NAME ? String(p.GUARDIAN_DEITY.NAME) : null,
    cityState: p.TOWN?.NAME ? String(p.TOWN.NAME) : null,
    grandCompany: p.GRAND_COMPANY?.Name ? { name: p.GRAND_COMPANY.Name, rank: p.GRAND_COMPANY.Rank } : null,
    freeCompany: p.FREE_COMPANY?.NAME ? { id: p.FREE_COMPANY.ID?.ID ?? null, name: String(p.FREE_COMPANY.NAME) } : null,
    avatar: p.AVATAR ?? null,
    portrait: p.PORTRAIT ?? null,
    activeJob: { icon: p.ACTIVE_CLASSJOB ?? null, level: num(p.ACTIVE_CLASSJOB_LEVEL?.Level) },
    jobs,
    fieldOperations: {
      bozja: j.BOZJA?.NAME
        ? { name: String(j.BOZJA.NAME), level: num(j.BOZJA.LEVEL), mettle: num(j.BOZJA.METTLE?.Mettle) }
        : null,
      eureka: j.EUREKA?.NAME
        ? {
            name: String(j.EUREKA.NAME),
            level: num(j.EUREKA.LEVEL),
            exp: j.EUREKA.EXP ? { current: num(j.EUREKA.EXP.CurrentEXP), max: num(j.EUREKA.EXP.MaxEXP) } : null,
          }
        : null,
    },
    achievements,
    mounts: collection(mountsHtml, selectors.mount, 'MOUNTS'),
    minions: collection(minionsHtml, selectors.minion, 'MINIONS'),
  };
}

/** Characters matching a name, optionally on one world. */
export async function searchCharacters(name, world) {
  const qs = new URLSearchParams({ q: name, ...(world ? { worldname: world } : {}) });
  const html = await page(`/character/?${qs}`);
  const d = html ? parsePage(html, selectors.search) : {};
  return (d.ENTRY ?? [])
    .filter((e) => e.ID?.ID && e.NAME)
    .slice(0, 20)
    .map((e) => ({
      id: String(e.ID.ID),
      name: String(e.NAME),
      world: e.SERVER?.World ?? null,
      dataCenter: e.SERVER?.DC ?? null,
      avatar: e.AVATAR ?? null,
    }));
}

/** A Lodestone character link or a bare ID -> the ID, or null. */
export function characterId(input) {
  const s = String(input ?? '').trim();
  const m = /lodestone\/character\/(\d{1,12})/.exec(s) ?? /^(\d{1,12})$/.exec(s);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- routes

export const gameStatsRouter = express.Router();

function failed(res, err, what) {
  if (err instanceof LodestoneError) return res.status(err.status).json({ error: err.message });
  console.error(what, err);
  res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
}

async function save(userId, character) {
  await query(
    `INSERT INTO game_connections ("user_id", "game", "external_id", "name", "data", "fetched_at")
     VALUES ($1, 'ffxiv', $2, $3, $4, now())
     ON CONFLICT ("user_id", "game") DO UPDATE SET "external_id" = EXCLUDED."external_id",
       "name" = EXCLUDED."name", "data" = EXCLUDED."data", "fetched_at" = now()`,
    [userId, character.id, character.name, JSON.stringify(character)],
  );
}

// -> { connections: [{ game, externalId, name, data, fetchedAt }] }
gameStatsRouter.get('/api/games/connections', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT "game", "external_id", "name", "data", "fetched_at" FROM game_connections WHERE "user_id" = $1',
      [req.userId],
    );
    res.json({
      connections: rows.map((r) => ({
        game: r.game,
        externalId: r.external_id,
        name: r.name,
        data: r.data,
        fetchedAt: r.fetched_at,
      })),
    });
  } catch (err) {
    failed(res, err, 'Game stats:');
  }
});

// ?name=&world= -> { results: [{ id, name, world, dataCenter, avatar }] }
gameStatsRouter.get('/api/games/ffxiv/search', async (req, res) => {
  const name = String(req.query.name ?? '').trim();
  const world = String(req.query.world ?? '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Type at least two letters of the name.' });
  try {
    res.json({ results: await searchCharacters(name, world) });
  } catch (err) {
    failed(res, err, 'FFXIV search:');
  }
});

// Body: { character: "<Lodestone link or ID>" } -> the connection
gameStatsRouter.post('/api/games/ffxiv/connect', express.json({ limit: '10kb' }), async (req, res) => {
  const id = characterId(req.body?.character);
  if (!id) return res.status(400).json({ error: 'Paste the character’s Lodestone link, or its ID.' });
  try {
    const character = await readCharacter(id);
    await save(req.userId, character);
    res.json({
      game: 'ffxiv',
      externalId: id,
      name: character.name,
      data: character,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    failed(res, err, 'FFXIV connect:');
  }
});

// Reads the Lodestone again (at most every 30 minutes). -> the connection
gameStatsRouter.post('/api/games/ffxiv/refresh', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT "external_id", "name", "data", "fetched_at" FROM game_connections WHERE "user_id" = $1 AND "game" = 'ffxiv'`,
      [req.userId],
    );
    const current = rows[0];
    if (!current) return res.status(404).json({ error: 'Connect a character first.' });
    // Data read before job icons were added is refreshed right away.
    const hasIcons = current.data?.jobs?.some((j) => 'icon' in j);
    const fresh = hasIcons && Date.now() - new Date(current.fetched_at).getTime() < REFRESH_MS;
    if (fresh) {
      return res.json({
        game: 'ffxiv',
        externalId: current.external_id,
        name: current.name,
        data: current.data,
        fetchedAt: current.fetched_at,
      });
    }
    const character = await readCharacter(current.external_id);
    await save(req.userId, character);
    res.json({
      game: 'ffxiv',
      externalId: current.external_id,
      name: character.name,
      data: character,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    failed(res, err, 'FFXIV refresh:');
  }
});

gameStatsRouter.delete('/api/games/ffxiv', async (req, res) => {
  try {
    await query(`DELETE FROM game_connections WHERE "user_id" = $1 AND "game" = 'ffxiv'`, [req.userId]);
    res.status(204).end();
  } catch (err) {
    failed(res, err, 'FFXIV disconnect:');
  }
});
