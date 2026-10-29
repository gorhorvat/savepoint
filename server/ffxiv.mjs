// FINAL FANTASY XIV character stats from the official Lodestone
// (https://na.finalfantasyxiv.com/lodestone/), the character's public pages:
// profile, jobs, achievements, mounts and minions. Square Enix has no API, and
// XIVAPI dropped its Lodestone endpoints in v2, so Savepoint reads the pages
// itself with XIVAPI's selector files (server/lodestone).
//
// Each account connects one character (its Lodestone link or ID, or found by
// name and world); the result is kept in game_connections and refreshed on
// request at most every 30 minutes, to go easy on the Lodestone.
//
// A read covers the profile (with gear and attributes), jobs, mounts, minions,
// the Free Company's page, and the achievement history, which is paged: each
// refresh reads ACHIEVEMENT_PAGES more pages until it has all of them.
import express from 'express';
import { parseHTML } from 'linkedom';
import { query } from './db.mjs';
import { parsePage } from './lodestone/parser.mjs';
import achievementSelectors from './lodestone/selectors/achievements.json' with { type: 'json' };
import attributes from './lodestone/selectors/attributes.json' with { type: 'json' };
import character from './lodestone/selectors/character.json' with { type: 'json' };
import classjob from './lodestone/selectors/classjob.json' with { type: 'json' };
import fcFocus from './lodestone/selectors/fcfocus.json' with { type: 'json' };
import fcReputation from './lodestone/selectors/fcreputation.json' with { type: 'json' };
import freecompany from './lodestone/selectors/freecompany.json' with { type: 'json' };
import gearset from './lodestone/selectors/gearset.json' with { type: 'json' };
import minion from './lodestone/selectors/minion.json' with { type: 'json' };
import mount from './lodestone/selectors/mount.json' with { type: 'json' };
import search from './lodestone/selectors/search.json' with { type: 'json' };
import { saveSnapshot } from './snapshots.mjs';

// Static imports, so Vercel bundles the selector files with the function.
const selectors = structuredClone({
  character,
  classjob,
  achievements: achievementSelectors,
  mount,
  minion,
  search,
  gearset,
  attributes,
  freecompany: { ...freecompany, FOCUS: fcFocus, REPUTATION: fcReputation },
});

// Gear icons: each slot's tooltip holds the item's picture.
for (const def of Object.values(selectors.gearset)) {
  const slot = /^(\.icon-c--\d+)/.exec(def?.NAME?.selector ?? '')?.[1];
  if (slot) def.ICON = { selector: `${slot} .db-tooltip__item__icon__item_image`, attribute: 'src' };
}
// The PvP team's name (the shipped selector only reads its link).
selectors.character.PVP_TEAM.TEAM_NAME = { selector: '.character__pvpteam__name > h4:nth-child(2) > a:nth-child(1)' };

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
  if (v == null || (typeof v === 'string' && !v.trim())) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const ACHIEVEMENT_PAGES = 10; // more pages of achievement history per refresh
const LEVEL_CAP = 100;
const GEAR_SLOTS = [
  ['MAINHAND', 'Main hand'],
  ['OFFHAND', 'Off hand'],
  ['HEAD', 'Head'],
  ['BODY', 'Body'],
  ['HANDS', 'Hands'],
  ['LEGS', 'Legs'],
  ['FEET', 'Feet'],
  ['EARRINGS', 'Earrings'],
  ['NECKLACE', 'Necklace'],
  ['BRACELETS', 'Bracelets'],
  ['RING1', 'Ring'],
  ['RING2', 'Ring'],
  ['SOULCRYSTAL', 'Soul crystal'],
];
const ATTRIBUTES = [
  ['STRENGTH', 'Strength', 'Attributes'],
  ['DEXTERITY', 'Dexterity', 'Attributes'],
  ['VITALITY', 'Vitality', 'Attributes'],
  ['INTELLIGENCE', 'Intelligence', 'Attributes'],
  ['MIND', 'Mind', 'Attributes'],
  ['CRITICAL_HIT_RATE', 'Critical hit', 'Offensive properties'],
  ['DETERMINATION', 'Determination', 'Offensive properties'],
  ['DIRECT_HIT_RATE', 'Direct hit rate', 'Offensive properties'],
  ['DEFENSE', 'Defense', 'Defensive properties'],
  ['MAGIC_DEFENSE', 'Magic defense', 'Defensive properties'],
  ['ATTACK_POWER', 'Attack power', 'Physical properties'],
  ['SKILL_SPEED', 'Skill speed', 'Physical properties'],
  ['ATTACK_MAGIC_POTENCY', 'Attack magic potency', 'Mental properties'],
  ['HEALING_MAGIC_POTENCY', 'Healing magic potency', 'Mental properties'],
  ['SPELL_SPEED', 'Spell speed', 'Mental properties'],
  ['TENACITY', 'Tenacity', 'Role'],
  ['PIETY', 'Piety', 'Role'],
];

const text = (v) => (v == null || v === '' ? null : String(v));

/**
 * The character profile text, unless it's only a verification code that a
 * site like FFXIV Collect or Lalachievements asked the player to paste there.
 */
function bioOf(raw) {
  const bio = raw == null ? '' : String(raw).trim();
  if (!bio || bio === '-') return null;
  const code = /^[a-z0-9_-]+:[a-z0-9_-]{16,}$/i.test(bio) || (!/\s/.test(bio) && /[0-9a-f]{24,}/i.test(bio));
  return code ? null : bio;
}
const when = (ts) => (num(ts) ? new Date(num(ts) * 1000).toISOString() : null);

/** Each gear slot's number on the Lodestone (`.icon-c--N`). */
const GEAR_SLOT_NUMBER = Object.fromEntries(
  Object.entries(selectors.gearset).map(([key, def]) => [key, /^\.icon-c--(\d+)/.exec(def?.NAME?.selector ?? '')?.[1]]),
);

/**
 * The character's gear and the item level worked out from it. The profile
 * page only has each slot's icon; the item itself (its tooltip) is loaded on
 * demand from .../equipment/tooltip/N, so those are read here, one per slot.
 */
async function readGear(id, html) {
  const { document } = parseHTML(html);
  const slots = GEAR_SLOTS.map(([key, slot]) => {
    const n = GEAR_SLOT_NUMBER[key];
    const box = n != null ? document.querySelector(`.icon-c--${n}`) : null;
    if (!box) return null;
    // The URL is site-relative (/lodestone/character/<id>/equipment/tooltip/N); page() adds BASE.
    const lazy = box.getAttribute('data-lazy_load_url')?.replace(/^\/lodestone(?=\/)/, '') || null;
    return {
      key,
      slot,
      n,
      icon: box.querySelector('img')?.getAttribute('src') ?? null,
      // Older pages had the tooltip inline; newer ones give a URL to load it from.
      tooltip: lazy ? null : box.innerHTML,
      url: lazy && !box.querySelector('.db-tooltip') ? lazy : null,
    };
  }).filter(Boolean);
  const loaded = await Promise.all(
    slots.map(async (x) => {
      const inner = x.url ? await page(x.url).catch(() => null) : x.tooltip;
      if (!inner) return null;
      // The tooltip is parsed with the slot's own selectors (`.icon-c--N > .db-tooltip ...`).
      const d = parsePage(`<div class="icon-c--${x.n}">${inner}</div>`, { [x.key]: selectors.gearset[x.key] })[x.key];
      if (!d?.NAME) return null;
      return {
        key: x.key,
        slot: x.slot,
        name: String(d.NAME),
        itemLevel: num(String(d.ITEM_LEVEL ?? '').replace(/\D+/g, '')),
        icon: text(d.ICON) ?? x.icon,
        glamour: text(d.MIRAGE_NAME),
        dye: text(d.STAIN),
        crafter: text(d.CREATOR_NAME),
        classes: text(d.CLASS_LIST),
        materia: [1, 2, 3, 4, 5].map((i) => d[`MATERIA_${i}`]?.Name).filter(Boolean),
      };
    }),
  );
  const gear = loaded.filter(Boolean);
  // Average item level: the 12 slots other than the soul crystal; a weapon
  // with no off hand counts twice.
  const levels = Object.fromEntries(gear.map((x) => [x.key, x.itemLevel ?? 0]));
  const slotKeys = GEAR_SLOTS.map(([k]) => k).filter((k) => k !== 'SOULCRYSTAL' && k !== 'OFFHAND');
  const sum = slotKeys.reduce((n, k) => n + (levels[k] ?? 0), 0) + (levels.OFFHAND ?? levels.MAINHAND ?? 0);
  return { gear, itemLevel: gear.some((x) => x.itemLevel) ? Math.round(sum / 12) : null };
}

function readAttributes(html) {
  const a = parsePage(html, selectors.attributes);
  const list = ATTRIBUTES.map(([key, name, group]) => ({ name, group, value: num(a[key]) })).filter(
    (x) => x.value != null,
  );
  const resourceName = text(a.MP_GP_CP_PARAMETER_NAME);
  return {
    hp: num(a.HP),
    resource: num(a.MP_GP_CP) != null ? { name: resourceName ?? 'MP', value: num(a.MP_GP_CP) } : null,
    list,
  };
}

/** The Free Company's public page. */
async function readFreeCompany(fcId) {
  const html = await page(`/freecompany/${fcId}/`).catch(() => null);
  if (!html) return null;
  const f = parsePage(html, selectors.freecompany);
  if (!f.NAME) return null;
  const crest = f.CREST_LAYERS
    ? [f.CREST_LAYERS.BOTTOM, f.CREST_LAYERS.MIDDLE, f.CREST_LAYERS.TOP].filter(Boolean)
    : [];
  const focus = Object.entries(f.FOCUS ?? {})
    .filter(([k, v]) => k !== 'NOT_SPECIFIED' && v?.NAME)
    .map(([, v]) => ({ name: String(v.NAME), icon: text(v.ICON), on: v.STATUS?.Status !== 'off' }));
  const reputation = Object.values(f.REPUTATION ?? {})
    .filter((v) => v?.NAME)
    .map((v) => ({ name: String(v.NAME), rank: text(v.RANK), progress: num(v.PROGRESS?.Progress) }));
  return {
    id: String(fcId),
    name: String(f.NAME),
    tag: text(f.TAG),
    slogan: text(f.SLOGAN),
    crest,
    formed: when(f.FORMED?.Timestamp),
    rank: num(f.RANK),
    members: num(f.ACTIVE_MEMBER_COUNT),
    active: text(f.ACTIVE_STATE?.ActiveState),
    recruiting: text(f.RECRUITMENT?.ActiveState),
    grandCompany: f.GRAND_COMPANY?.Name ? { name: f.GRAND_COMPANY.Name, rank: f.GRAND_COMPANY.Rank ?? null } : null,
    world: f.SERVER?.World ?? null,
    estate:
      f.ESTATE && !f.ESTATE.NO_ESTATE && f.ESTATE.NAME
        ? { name: text(f.ESTATE.NAME), plot: text(f.ESTATE.PLOT), greeting: text(f.ESTATE.GREETING) }
        : null,
    ranking: { weekly: num(f.RANKING?.WEEKLY), monthly: num(f.RANKING?.MONTHLY) },
    focus,
    reputation,
  };
}

const entries = (a) =>
  (a.ENTRY ?? [])
    .map((e) => ({ id: num(e.ID?.ID), name: e.NAME?.Name ?? e.NAME?.NameDE ?? null, time: when(e.TIME?.Timestamp) }))
    .filter((e) => e.name);

/**
 * The achievement history, newest first. Each read takes the first page and up
 * to ACHIEVEMENT_PAGES pages past what was read before, 4 at a time.
 */
async function readAchievements(id, firstHtml, previous) {
  const a = parsePage(firstHtml, selectors.achievements);
  const isPrivate = !a.ENTRY?.length && !a.ACHIEVEMENT_POINTS && !a.TOTAL_ACHIEVEMENTS;
  if (isPrivate) return { summary: { public: false, total: null, points: null, recent: [] }, list: null };
  const pages = num(a.PAGE_INFO?.NumPages) ?? 1;
  const upTo = Math.min(pages, Math.max(1, previous?.pagesRead ?? 0) + ACHIEVEMENT_PAGES);
  const got = [entries(a)];
  const wanted = [];
  for (let n = 2; n <= upTo; n++) wanted.push(n);
  for (let i = 0; i < wanted.length; i += 4) {
    const htmls = await Promise.all(
      wanted.slice(i, i + 4).map((n) => page(`/character/${id}/achievement/?page=${n}`).catch(() => null)),
    );
    for (const h of htmls) if (h) got.push(entries(parsePage(h, selectors.achievements)));
  }
  const byId = new Map();
  for (const e of [...(previous?.list ?? []), ...got.flat()]) if (e.id != null) byId.set(e.id, e);
  const list = [...byId.values()].sort((x, y) => String(y.time ?? '').localeCompare(String(x.time ?? '')));
  return {
    summary: {
      public: true,
      total: num(a.TOTAL_ACHIEVEMENTS?.TotalAchievements),
      points: num(a.ACHIEVEMENT_POINTS),
      recent: got[0].slice(0, 20),
      pages,
      pagesRead: upTo,
      listed: list.length,
    },
    list,
  };
}

/** A character's public Lodestone pages, read and tidied into one object. */
export async function readCharacter(id, previous = null) {
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

  const samePerson = previous?.id === String(id);
  const history = achievementsHtml
    ? await readAchievements(
        id,
        achievementsHtml,
        samePerson ? { pagesRead: previous.achievements?.pagesRead, list: previous.achievementList } : null,
      ).catch((err) => {
        console.error('Lodestone achievements:', err);
        return null;
      })
    : null;
  const achievements = history?.summary ?? { public: false, total: null, points: null, recent: [] };

  const collection = (html, sel, listKey) => {
    if (!html) return { public: false, count: 0, list: [] };
    const d = parsePage(html, sel);
    const list = (d[listKey] ?? []).filter((m) => m.NAME).map((m) => ({ name: String(m.NAME), icon: m.ICON ?? null }));
    return { public: true, count: num(d.TOTAL) ?? list.length, list };
  };

  const fcId = p.FREE_COMPANY?.ID?.ID ?? null;
  const freeCompanyPage = fcId ? await readFreeCompany(fcId) : null;
  const { gear, itemLevel } = await readGear(id, profileHtml);
  const fcCrest = p.FREE_COMPANY?.ICON_LAYERS
    ? [p.FREE_COMPANY.ICON_LAYERS.BOTTOM, p.FREE_COMPANY.ICON_LAYERS.MIDDLE, p.FREE_COMPANY.ICON_LAYERS.TOP].filter(
        Boolean,
      )
    : [];

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
    freeCompany: p.FREE_COMPANY?.NAME ? { id: fcId, name: String(p.FREE_COMPANY.NAME), crest: fcCrest } : null,
    freeCompanyPage,
    pvpTeam: p.PVP_TEAM?.TEAM_NAME
      ? {
          id: p.PVP_TEAM.NAME?.ID ?? null,
          name: String(p.PVP_TEAM.TEAM_NAME),
          crest: p.PVP_TEAM.ICON_LAYERS
            ? [p.PVP_TEAM.ICON_LAYERS.BOTTOM, p.PVP_TEAM.ICON_LAYERS.MIDDLE, p.PVP_TEAM.ICON_LAYERS.TOP].filter(Boolean)
            : [],
        }
      : null,
    bio: bioOf(p.BIO),
    avatar: p.AVATAR ?? null,
    portrait: p.PORTRAIT ?? null,
    activeJob: { icon: p.ACTIVE_CLASSJOB ?? null, level: num(p.ACTIVE_CLASSJOB_LEVEL?.Level) },
    gear,
    itemLevel,
    attributes: readAttributes(profileHtml),
    jobs,
    levelCap: Math.max(LEVEL_CAP, ...jobs.map((x) => x.level)),
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
    // Kept on the server; sent by /api/games/ffxiv/achievements.
    achievementList: history?.list ?? (samePerson ? (previous.achievementList ?? null) : null),
    mounts: collection(mountsHtml, selectors.mount, 'MOUNTS'),
    minions: collection(minionsHtml, selectors.minion, 'MINIONS'),
  };
}

/** Today's numbers for the progress graphs. */
function snapshotOf(c) {
  const fighting = c.jobs.filter((x) => !['Crafter', 'Gatherer'].includes(x.role));
  return {
    achievements: c.achievements.total,
    points: c.achievements.points,
    mounts: c.mounts.public ? c.mounts.count : null,
    minions: c.minions.public ? c.minions.count : null,
    itemLevel: c.itemLevel,
    levels: c.jobs.reduce((n, x) => n + x.level, 0),
    maxed: c.jobs.filter((x) => x.level >= c.levelCap).length,
    combatMaxed: fighting.filter((x) => x.level >= c.levelCap).length,
  };
}

/** The connection as sent to the browser: the achievement history stays behind. */
const forClient = (data) => {
  if (!data || typeof data !== 'object') return data;
  const { achievementList: _list, ...rest } = data;
  return rest;
};

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
        data: r.game === 'ffxiv' ? forClient(r.data) : r.data,
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
    const { rows } = await query(
      `SELECT "external_id" FROM game_connections WHERE "user_id" = $1 AND "game" = 'ffxiv'`,
      [req.userId],
    );
    // A different character starts new graphs.
    if (rows[0] && rows[0].external_id !== id) {
      await query(`DELETE FROM game_snapshots WHERE "user_id" = $1 AND "game" = 'ffxiv'`, [req.userId]);
    }
    const character = await readCharacter(id);
    await save(req.userId, character);
    await saveSnapshot(req.userId, 'ffxiv', snapshotOf(character));
    res.json({
      game: 'ffxiv',
      externalId: id,
      name: character.name,
      data: forClient(character),
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
    // Data read before job icons or gear were added, or whose gear came back
    // empty (every character has at least a main hand), is refreshed right away.
    const complete = current.data?.jobs?.some((j) => 'icon' in j) && current.data?.gear?.length > 0;
    const fresh = complete && Date.now() - new Date(current.fetched_at).getTime() < REFRESH_MS;
    if (fresh) {
      return res.json({
        game: 'ffxiv',
        externalId: current.external_id,
        name: current.name,
        data: forClient(current.data),
        fetchedAt: current.fetched_at,
      });
    }
    const character = await readCharacter(current.external_id, current.data);
    await save(req.userId, character);
    await saveSnapshot(req.userId, 'ffxiv', snapshotOf(character));
    res.json({
      game: 'ffxiv',
      externalId: current.external_id,
      name: character.name,
      data: forClient(character),
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    failed(res, err, 'FFXIV refresh:');
  }
});

// -> { achievements: [{ id, name, time }], complete } (newest first)
gameStatsRouter.get('/api/games/ffxiv/achievements', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT "data"->'achievementList' AS list, "data"->'achievements' AS summary
       FROM game_connections WHERE "user_id" = $1 AND "game" = 'ffxiv'`,
      [req.userId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Connect a character first.' });
    const s = rows[0].summary ?? {};
    res.json({ achievements: rows[0].list ?? [], complete: !!s.pages && s.pagesRead >= s.pages });
  } catch (err) {
    failed(res, err, 'FFXIV achievements:');
  }
});

gameStatsRouter.delete('/api/games/ffxiv', async (req, res) => {
  try {
    await query(`DELETE FROM game_connections WHERE "user_id" = $1 AND "game" = 'ffxiv'`, [req.userId]);
    await query(`DELETE FROM game_snapshots WHERE "user_id" = $1 AND "game" = 'ffxiv'`, [req.userId]);
    res.status(204).end();
  } catch (err) {
    failed(res, err, 'FFXIV disconnect:');
  }
});
