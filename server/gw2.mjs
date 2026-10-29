// Guild Wars 2 stats from ArenaNet's official API (https://api.guildwars2.com/v2).
// Each account connects with its own API key (created at
// https://account.arena.net/applications), kept encrypted in game_connections
// like the PlayStation and Xbox connections. Endpoints the key has no
// permission for are left out instead of failing the whole read.
//
// A refresh reads everything the key allows: every character with gear and
// build (one characters?ids=all request), wallet, achievements and points,
// this week's raids, dungeons, world bosses and Wizard's Vault, PvP games,
// and what the account's items are worth on the trading post. Names of gear,
// traits and skills are looked up when a character is opened.
import express from 'express';
import { query } from './db.mjs';
import { decrypt, encrypt } from './platformLogins.mjs';
import { saveSnapshot } from './snapshots.mjs';

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

async function get(path, key, timeout = 20000) {
  const url = `${API}/${path}${path.includes('?') ? '&' : '?'}v=latest`;
  let r;
  try {
    r = await fetch(url, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(timeout),
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

/** Public records by id (items, achievements, prices, ...), 200 per request, cached per id. */
const idCache = new Map(); // "endpoint:id" -> { at, value }
async function many(endpoint, ids, ttl = 12 * 3600 * 1000) {
  const out = new Map();
  const need = [];
  for (const id of new Set(ids)) {
    if (id == null) continue;
    const hit = idCache.get(`${endpoint}:${id}`);
    if (hit && Date.now() - hit.at < ttl) out.set(id, hit.value);
    else need.push(id);
  }
  const chunks = [];
  for (let i = 0; i < need.length; i += 200) chunks.push(need.slice(i, i + 200));
  for (let i = 0; i < chunks.length; i += 6) {
    const lists = await Promise.all(
      chunks.slice(i, i + 6).map((c) => maybe(`${endpoint}?ids=${c.map(encodeURIComponent).join(',')}`)),
    );
    for (const list of lists) {
      for (const v of Array.isArray(list) ? list : []) {
        idCache.set(`${endpoint}:${v.id}`, { at: Date.now(), value: v });
        out.set(v.id, v);
      }
    }
  }
  return out;
}

const titled = (id) =>
  String(id)
    .split('_')
    .map((w) => (['of', 'the', 'and', 'in'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

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
  ['Emotes', 'account/emotes', 'emotes'],
  ['Jade bots', 'account/jadebots', 'jadebots'],
  ['Skiffs', 'account/skiffs', 'skiffs'],
  ['Recipes', 'account/recipes', 'recipes'],
  ['Legendary armory', 'account/legendaryarmory', 'legendaryarmory'],
];

const TP_FEE = 0.85; // 5% listing fee + 10% exchange fee
const LIVE = 5 * 60 * 1000; // prices

/** Every stack of items on the account, by where it is. */
function stacks(bank, shared, materials, chars) {
  const out = { Bank: [], Materials: [], 'Shared slots': [], 'Character bags': [], 'Equipped gear': [] };
  const add = (where, slot) => {
    if (slot?.id) out[where].push({ id: slot.id, count: slot.count ?? 1, bound: !!slot.binding });
  };
  for (const s of bank ?? []) add('Bank', s);
  for (const s of materials ?? []) if (s.count) add('Materials', s);
  for (const s of shared ?? []) add('Shared slots', s);
  for (const c of chars ?? []) {
    for (const bag of c.bags ?? []) {
      if (!bag) continue;
      add('Character bags', { id: bag.id, count: 1 });
      for (const s of bag.inventory ?? []) add('Character bags', s);
    }
    for (const e of c.equipment ?? []) {
      if (e.location === 'LegendaryArmory' || e.location === 'EquippedFromLegendaryArmory') continue;
      add('Equipped gear', { ...e, count: 1 });
    }
  }
  return out;
}

/** What the account's items and coins are worth on the trading post right now. */
async function accountValue({ coins, bank, shared, materials, chars, selling, buying, delivery }) {
  const where = stacks(bank, shared, materials, chars);
  const tradeable = [
    ...Object.values(where).flat(),
    ...(selling ?? []).map((s) => ({ id: s.item_id, count: s.quantity })),
  ]
    .filter((s) => !s.bound)
    .map((s) => s.id);
  const prices = await many('commerce/prices', [...tradeable, ...(delivery?.items ?? []).map((i) => i.id)], LIVE);
  const worth = (id, count) => {
    const p = prices.get(id);
    return { buy: (p?.buys?.unit_price ?? 0) * count * TP_FEE, sell: (p?.sells?.unit_price ?? 0) * count * TP_FEE };
  };
  const totals = new Map(); // id -> count, for the most valuable items
  const parts = Object.entries(where).map(([label, list]) => {
    let buy = 0;
    let sell = 0;
    for (const s of list) {
      if (s.bound) continue;
      const w = worth(s.id, s.count);
      buy += w.buy;
      sell += w.sell;
      if (w.sell || w.buy) totals.set(s.id, (totals.get(s.id) ?? 0) + s.count);
    }
    return { label, buy: Math.round(buy), sell: Math.round(sell), stacks: list.length };
  });
  // Your sell listings sell at their own price, minus the 10% exchange fee.
  const listed = (selling ?? []).reduce((n, s) => n + s.price * s.quantity * 0.9, 0);
  // Buy orders hold coins that come back if cancelled.
  const ordered = (buying ?? []).reduce((n, b) => n + b.price * b.quantity, 0);
  const pickup = (delivery?.coins ?? 0) + (delivery?.items ?? []).reduce((n, i) => n + worth(i.id, i.count).buy, 0);
  parts.push(
    { label: 'Trading post: selling', buy: Math.round(listed), sell: Math.round(listed), stacks: selling?.length ?? 0 },
    { label: 'Trading post: buy orders', buy: ordered, sell: ordered, stacks: buying?.length ?? 0 },
    {
      label: 'Trading post: to pick up',
      buy: Math.round(pickup),
      sell: Math.round(pickup),
      stacks: delivery?.items?.length ?? 0,
    },
    { label: 'Wallet coins', buy: coins ?? 0, sell: coins ?? 0, stacks: 0 },
  );

  const ranked = [...totals]
    .map(([id, count]) => ({ id, count, ...worth(id, count) }))
    .sort((a, b) => b.sell - a.sell)
    .slice(0, 30);
  const items = await many(
    'items',
    ranked.map((r) => r.id),
  );
  return {
    buy: parts.reduce((n, p) => n + p.buy, 0),
    sell: parts.reduce((n, p) => n + p.sell, 0),
    parts: parts.filter((p) => p.buy || p.sell || p.stacks),
    top: ranked.map((r) => ({
      id: r.id,
      name: items.get(r.id)?.name ?? `Item ${r.id}`,
      icon: items.get(r.id)?.icon ?? null,
      rarity: items.get(r.id)?.rarity ?? null,
      count: r.count,
      buy: Math.round(r.buy),
      sell: Math.round(r.sell),
    })),
    tp: {
      selling: { count: selling?.length ?? 0, value: Math.round(listed) },
      buying: { count: buying?.length ?? 0, value: ordered },
    },
  };
}

/** Achievement points: daily and monthly points plus every tier reached. */
function achievementPoints(account, mine, defs) {
  let fromAchievements = 0;
  for (const a of mine ?? []) {
    const def = defs.get(a.id);
    if (!def?.tiers?.length) continue;
    const all = def.tiers.reduce((n, t) => n + (t.points ?? 0), 0);
    let earned = a.done ? all : def.tiers.filter((t) => (a.current ?? 0) >= t.count).reduce((n, t) => n + t.points, 0);
    if (a.repeated) earned += a.repeated * all;
    if (def.point_cap != null && def.flags?.includes('Repeatable')) earned = Math.min(earned, def.point_cap);
    fromAchievements += earned;
  }
  const daily = account.daily_ap ?? 0;
  const monthly = account.monthly_ap ?? 0;
  return { total: fromAchievements + daily + monthly, fromAchievements, daily, monthly };
}

/** The active build and gear of a character, as ids (names come later, on request). */
function characterGear(c) {
  const activeBuild = (c.build_tabs ?? []).find((t) => t.is_active)?.build;
  const activeGear = (c.equipment_tabs ?? []).find((t) => t.is_active);
  const equipment = activeGear?.equipment?.length
    ? activeGear.equipment
    : (c.equipment ?? []).filter((e) => !e.location || e.location.startsWith('Equipped'));
  const bagSlots = (c.bags ?? []).filter(Boolean);
  return {
    buildName: activeBuild?.name || null,
    gearName: activeGear?.name || null,
    buildTabs: c.build_tabs?.length ?? null,
    gearTabs: c.equipment_tabs?.length ?? null,
    specializations: (activeBuild?.specializations ?? c.specializations?.pve ?? [])
      .filter((s) => s?.id)
      .map((s) => ({ id: s.id, traits: (s.traits ?? []).filter(Boolean) })),
    skills: activeBuild?.skills ?? c.skills?.pve ?? null,
    legends: activeBuild?.legends?.filter(Boolean) ?? null,
    pets: activeBuild?.pets?.terrestrial?.filter(Boolean) ?? null,
    equipment: equipment
      .filter((e) => e?.id && e.slot)
      .map((e) => ({
        slot: e.slot,
        id: e.id,
        skin: e.skin ?? null,
        stats: e.stats?.id ?? null,
        upgrades: e.upgrades ?? [],
        infusions: e.infusions ?? [],
      })),
    bags: bagSlots.length
      ? {
          bags: bagSlots.length,
          slots: bagSlots.reduce((n, b) => n + (b.size ?? 0), 0),
          used: bagSlots.reduce((n, b) => n + (b.inventory ?? []).filter(Boolean).length, 0),
        }
      : null,
  };
}

/** An account's stats, read with its API key. */
export async function readAccount(key) {
  const token = await get('tokeninfo', key);
  const permissions = new Set(token.permissions ?? []);
  const account = await get('account', key);

  const has = (...p) => p.every((x) => permissions.has(x));
  const progression = has('progression');
  const [
    world,
    chars,
    masteryPoints,
    myMasteries,
    allMasteries,
    achievements,
    wallet,
    currencies,
    pvp,
    pvpGames,
    pvpStandings,
    progress,
    mountTypes,
    allMountTypes,
    professions,
    guilds,
    collections,
    legendaries,
    raids,
    allRaids,
    dungeons,
    allDungeons,
    worldBosses,
    allWorldBosses,
    mapChests,
    allMapChests,
    crafting,
    allCrafting,
    vaultDaily,
    vaultWeekly,
    vaultSpecial,
    homeNodes,
    allHomeNodes,
    homeCats,
    allHomeCats,
    groups,
    categories,
    wvwRanks,
    bank,
    shared,
    materials,
    selling,
    buying,
    delivery,
  ] = await Promise.all([
    account.world ? cached(`worlds?ids=${account.world}`) : null,
    has('characters') ? get('characters?ids=all', key, 60000).catch(() => null) : null,
    progression ? maybe('account/mastery/points', key) : null,
    progression ? maybe('account/masteries', key) : null,
    cached('masteries?ids=all'),
    progression ? maybe('account/achievements', key) : null,
    has('wallet') ? maybe('account/wallet', key) : null,
    cached('currencies?ids=all'),
    has('pvp') ? maybe('pvp/stats', key) : null,
    has('pvp') ? maybe('pvp/games?ids=all', key) : null,
    has('pvp') ? maybe('pvp/standings', key) : null,
    progression ? maybe('account/progression', key) : null,
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
    has('unlocks') ? maybe('account/legendaryarmory', key) : null,
    progression ? maybe('account/raids', key) : null,
    cached('raids?ids=all'),
    progression ? maybe('account/dungeons', key) : null,
    cached('dungeons?ids=all'),
    progression ? maybe('account/worldbosses', key) : null,
    cached('worldbosses'),
    progression ? maybe('account/mapchests', key) : null,
    cached('mapchests'),
    progression ? maybe('account/dailycrafting', key) : null,
    cached('dailycrafting'),
    maybe('account/wizardsvault/daily', key),
    maybe('account/wizardsvault/weekly', key),
    maybe('account/wizardsvault/special', key),
    progression ? maybe('account/home/nodes', key) : null,
    cached('home/nodes'),
    progression ? maybe('account/home/cats', key) : null,
    cached('home/cats'),
    cached('achievements/groups?ids=all'),
    cached('achievements/categories?ids=all'),
    cached('wvw/ranks?ids=all'),
    has('inventories') ? maybe('account/bank', key) : null,
    has('inventories') ? maybe('account/inventory', key) : null,
    has('inventories') ? maybe('account/materials', key) : null,
    has('tradingpost') ? maybe('commerce/transactions/current/sells', key) : null,
    has('tradingpost') ? maybe('commerce/transactions/current/buys', key) : null,
    has('tradingpost') ? maybe('commerce/delivery', key) : null,
  ]);

  const profIcons = Object.fromEntries((professions ?? []).map((p) => [p.id, p.icon ?? null]));
  const currencyById = new Map((currencies ?? []).map((c) => [c.id, c]));
  const mountNames = new Map((allMountTypes ?? []).map((m) => [m.id, m.name]));
  const doneIds = new Set((achievements ?? []).filter((a) => a.done).map((a) => a.id));
  const coins = (wallet ?? []).find((w) => w.id === 1)?.value ?? 0;

  // Achievement definitions for points and "almost done".
  const defs = Array.isArray(achievements)
    ? await many(
        'achievements',
        achievements.map((a) => a.id),
      )
    : new Map();
  const nearly = (achievements ?? [])
    .filter((a) => !a.done && a.max && a.current && defs.get(a.id))
    .map((a) => {
      const d = defs.get(a.id);
      const left = (d.tiers ?? []).filter((t) => (a.current ?? 0) < t.count).reduce((n, t) => n + t.points, 0);
      return {
        id: a.id,
        name: d.name,
        requirement: d.requirement ?? '',
        current: a.current,
        max: a.max,
        points: left,
        icon: d.icon ?? null,
      };
    })
    .sort((x, y) => y.current / y.max - x.current / x.max)
    .slice(0, 30);

  const catById = new Map((categories ?? []).map((c) => [c.id, c]));
  const achievementGroups = Array.isArray(achievements)
    ? (groups ?? [])
        .sort((x, y) => (x.order ?? 0) - (y.order ?? 0))
        .map((g) => ({
          name: g.name,
          categories: (g.categories ?? [])
            .map((id) => catById.get(id))
            .filter(Boolean)
            .sort((x, y) => (x.order ?? 0) - (y.order ?? 0))
            .map((c) => {
              const ids = (c.achievements ?? []).map((a) => (typeof a === 'object' ? a.id : a));
              return {
                id: c.id,
                name: c.name,
                icon: c.icon ?? null,
                done: ids.filter((id) => doneIds.has(id)).length,
                total: ids.length,
              };
            })
            .filter((c) => c.total > 0),
        }))
        .filter((g) => g.categories.length)
    : null;

  const legendaryItems = Array.isArray(legendaries)
    ? await many(
        'items',
        legendaries.map((l) => l.id),
      )
    : new Map();
  const masteryDefs = new Map((allMasteries ?? []).map((m) => [m.id, m]));
  const charList = Array.isArray(chars) ? chars : null;

  let value = null;
  if (has('inventories') || has('tradingpost')) {
    try {
      value = await accountValue({ coins, bank, shared, materials, chars: charList, selling, buying, delivery });
    } catch (err) {
      console.error('GW2 account value:', err);
    }
  }

  const wvwRank = account.wvw?.rank ?? account.wvw_rank ?? null;
  const wvwTitle =
    wvwRank != null
      ? ([...(wvwRanks ?? [])].filter((r) => r.min_rank <= wvwRank).sort((x, y) => y.min_rank - x.min_rank)[0]?.title ??
        null)
      : null;

  const vault = (v) =>
    v
      ? {
          current: v.meta_progress_current ?? null,
          complete: v.meta_progress_complete ?? null,
          claimed: !!v.meta_reward_claimed,
          objectives: (v.objectives ?? []).map((o) => ({
            title: o.title,
            track: o.track,
            acclaim: o.acclaim,
            progress: o.progress_current ?? 0,
            complete: o.progress_complete ?? 0,
            claimed: !!o.claimed,
          })),
        }
      : null;

  return {
    id: account.id,
    name: account.name,
    world: world?.[0]?.name ?? null,
    created: account.created ?? null,
    hours: account.age ? Math.round(account.age / 3600) : null,
    commander: !!account.commander,
    fractalLevel: account.fractal_level ?? null,
    wvwRank,
    wvwTitle,
    expansions: (account.access ?? []).filter((a) => a !== 'None').map((a) => EXPANSIONS[a] ?? spaced(a)),
    guilds: guilds.filter(Boolean).map((g) => ({ name: g.name, tag: g.tag })),
    permissions: [...permissions],
    characters: charList
      ? charList.map((c) => ({
          name: c.name,
          race: c.race ?? null,
          gender: c.gender ?? null,
          profession: c.profession ?? null,
          icon: profIcons[c.profession] ?? null,
          level: c.level ?? null,
          hours: c.age ? Math.round(c.age / 3600) : 0,
          deaths: c.deaths ?? 0,
          created: c.created ?? null,
          lastPlayed: c.last_modified ?? null,
          crafting: (c.crafting ?? []).map((x) => ({
            discipline: spaced(x.discipline),
            rating: x.rating,
            active: !!x.active,
          })),
          gear: characterGear(c),
        }))
      : null,
    mastery: masteryPoints?.totals
      ? masteryPoints.totals.map((t) => ({ region: spaced(t.region), earned: t.earned, spent: t.spent }))
      : null,
    masteryTracks: Array.isArray(myMasteries)
      ? myMasteries
          .map((m) => {
            const d = masteryDefs.get(m.id);
            return d
              ? {
                  name: d.name,
                  region: spaced(d.region ?? ''),
                  level: (m.level ?? -1) + 1,
                  max: d.levels?.length ?? null,
                }
              : null;
          })
          .filter(Boolean)
      : null,
    achievementsDone: Array.isArray(achievements) ? doneIds.size : null,
    ap: Array.isArray(achievements) ? achievementPoints(account, achievements, defs) : null,
    achievementGroups,
    nearlyDone: Array.isArray(achievements) ? nearly : null,
    luck: Array.isArray(progress) ? (progress.find((l) => l.id === 'luck')?.value ?? 0) : null,
    progression: Array.isArray(progress)
      ? progress.filter((p) => p.id !== 'luck').map((p) => ({ name: titled(p.id), value: p.value }))
      : null,
    wallet: wallet
      ? wallet
          .filter((w) => w.value)
          .map((w) => ({
            id: w.id,
            name: currencyById.get(w.id)?.name ?? `Currency ${w.id}`,
            icon: currencyById.get(w.id)?.icon ?? null,
            value: w.value,
            order: currencyById.get(w.id)?.order ?? 999,
          }))
          .sort((x, y) => x.order - y.order)
          .map(({ order: _order, ...w }) => w)
      : null,
    pvp: pvp
      ? {
          rank: (pvp.pvp_rank ?? 0) + (pvp.pvp_rank_rollovers ?? 0),
          wins: pvp.aggregate?.wins ?? 0,
          losses: pvp.aggregate?.losses ?? 0,
          desertions: pvp.aggregate?.desertions ?? 0,
          byes: pvp.aggregate?.byes ?? 0,
          forfeits: pvp.aggregate?.forfeits ?? 0,
          ladders: Object.entries(pvp.ladders ?? {}).map(([k, v]) => ({
            name: titled(k),
            wins: v.wins ?? 0,
            losses: v.losses ?? 0,
          })),
          professions: Object.entries(pvp.professions ?? {})
            .map(([k, v]) => ({
              name: titled(k),
              icon: profIcons[titled(k)] ?? null,
              wins: v.wins ?? 0,
              losses: v.losses ?? 0,
            }))
            .sort((x, y) => y.wins + y.losses - (x.wins + x.losses)),
          games: (Array.isArray(pvpGames) ? pvpGames : []).map((g) => ({
            id: g.id,
            map: g.map_id,
            started: g.started,
            ended: g.ended,
            result: g.result,
            team: g.team,
            profession: g.profession,
            scores: g.scores ?? null,
            type: g.rating_type ?? null,
            ratingChange: g.rating_change ?? null,
          })),
          standing:
            Array.isArray(pvpStandings) && pvpStandings.length
              ? (() => {
                  const s = [...pvpStandings].sort((x, y) => String(y.season_id).localeCompare(String(x.season_id)))[0];
                  return {
                    season: s.season_id,
                    rating: s.current?.rating ?? null,
                    division: s.current?.division ?? null,
                    tier: s.current?.tier ?? null,
                    best: s.best?.rating ?? null,
                  };
                })()
              : null,
        }
      : null,
    mounts: Array.isArray(mountTypes)
      ? { owned: mountTypes.map((id) => mountNames.get(id) ?? spaced(id)), total: allMountTypes?.length ?? null }
      : null,
    collections: collections.filter(Boolean),
    legendaries: Array.isArray(legendaries)
      ? legendaries.map((l) => ({
          id: l.id,
          count: l.count ?? 1,
          name: legendaryItems.get(l.id)?.name ?? `Item ${l.id}`,
          icon: legendaryItems.get(l.id)?.icon ?? null,
          type: legendaryItems.get(l.id)?.type ?? null,
        }))
      : null,
    weekly: progression
      ? {
          raids: Array.isArray(allRaids)
            ? allRaids.map((r) => ({
                name: titled(r.id),
                wings: (r.wings ?? []).map((w) => ({
                  name: titled(w.id),
                  events: (w.events ?? []).map((e) => ({
                    name: titled(e.id),
                    boss: e.type === 'Boss',
                    done: (raids ?? []).includes(e.id),
                  })),
                })),
              }))
            : null,
          dungeons: Array.isArray(allDungeons)
            ? allDungeons.map((d) => ({
                name: titled(d.id),
                paths: (d.paths ?? []).map((p) => ({ name: titled(p.id), done: (dungeons ?? []).includes(p.id) })),
              }))
            : null,
          worldBosses: Array.isArray(allWorldBosses)
            ? allWorldBosses.map((id) => ({ name: titled(id), done: (worldBosses ?? []).includes(id) }))
            : null,
          mapChests: Array.isArray(allMapChests)
            ? allMapChests.map((id) => ({ name: titled(id), done: (mapChests ?? []).includes(id) }))
            : null,
          crafting: Array.isArray(allCrafting)
            ? allCrafting.map((id) => ({ name: titled(id), done: (crafting ?? []).includes(id) }))
            : null,
          vault: { daily: vault(vaultDaily), weekly: vault(vaultWeekly), special: vault(vaultSpecial) },
          home: {
            nodes: Array.isArray(homeNodes) ? { owned: homeNodes.length, total: allHomeNodes?.length ?? null } : null,
            cats: Array.isArray(homeCats) ? { owned: homeCats.length, total: allHomeCats?.length ?? null } : null,
          },
        }
      : null,
    value,
  };
}

/** Today's numbers for the progress graphs. */
function snapshotOf(a) {
  const collection = (label) => a.collections.find((c) => c.label === label)?.owned ?? null;
  return {
    hours: a.hours,
    ap: a.ap?.total ?? null,
    achievements: a.achievementsDone,
    coins: a.wallet?.find((w) => w.id === 1)?.value ?? null,
    valueBuy: a.value?.buy ?? null,
    valueSell: a.value?.sell ?? null,
    fractal: a.fractalLevel,
    wvwRank: a.wvwRank,
    pvpRank: a.pvp?.rank ?? null,
    luck: a.luck,
    masteryPoints: a.mastery ? a.mastery.reduce((n, m) => n + m.earned, 0) : null,
    legendaries: a.legendaries?.length ?? null,
    skins: collection('Skins'),
    characters: a.characters?.length ?? null,
  };
}

/** Names and pictures for a character's gear and build. */
async function characterDetails(gear) {
  const eq = gear.equipment ?? [];
  const [items, skins, stats, specs] = await Promise.all([
    many(
      'items',
      eq.flatMap((e) => [e.id, ...e.upgrades, ...e.infusions]),
    ),
    many('skins', eq.map((e) => e.skin).filter(Boolean)),
    many('itemstats', eq.map((e) => e.stats).filter(Boolean)),
    many(
      'specializations',
      (gear.specializations ?? []).map((s) => s.id),
    ),
  ]);
  const skillIds = gear.skills
    ? [gear.skills.heal, ...(gear.skills.utilities ?? []), gear.skills.elite].filter(Boolean)
    : [];
  const [traits, skills] = await Promise.all([
    many(
      'traits',
      (gear.specializations ?? []).flatMap((s) => s.traits),
    ),
    many('skills', skillIds),
  ]);
  const thing = (map, id) => {
    const v = id != null ? map.get(id) : null;
    return v ? { id, name: v.name, icon: v.icon ?? null } : id != null ? { id, name: String(id), icon: null } : null;
  };
  return {
    equipment: eq.map((e) => {
      const item = items.get(e.id);
      const skin = e.skin ? skins.get(e.skin) : null;
      return {
        slot: e.slot,
        name: item?.name ?? `Item ${e.id}`,
        icon: skin?.icon ?? item?.icon ?? null,
        skin: skin?.name ?? null,
        rarity: item?.rarity ?? null,
        level: item?.level ?? null,
        stats: e.stats ? (stats.get(e.stats)?.name ?? null) : null,
        upgrades: e.upgrades.map((id) => thing(items, id)),
        infusions: e.infusions.map((id) => thing(items, id)),
      };
    }),
    specializations: (gear.specializations ?? []).map((s) => ({
      ...thing(specs, s.id),
      elite: !!specs.get(s.id)?.elite,
      traits: s.traits.map((id) => thing(traits, id)),
    })),
    skills: gear.skills
      ? {
          heal: thing(skills, gear.skills.heal),
          utilities: (gear.skills.utilities ?? []).map((id) => thing(skills, id)),
          elite: thing(skills, gear.skills.elite),
        }
      : null,
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
    const { rows } = await query(`SELECT "external_id" FROM game_connections WHERE "user_id" = $1 AND "game" = 'gw2'`, [
      req.userId,
    ]);
    // A different account starts new graphs.
    if (rows[0] && rows[0].external_id !== account.id) {
      await query(`DELETE FROM game_snapshots WHERE "user_id" = $1 AND "game" = 'gw2'`, [req.userId]);
    }
    const conn = await save(req.userId, account, await encrypt(key));
    await saveSnapshot(req.userId, 'gw2', snapshotOf(account));
    res.json(conn);
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
    const account = await readAccount(key);
    const conn = await save(req.userId, account, null);
    await saveSnapshot(req.userId, 'gw2', snapshotOf(account));
    res.json(conn);
  } catch (err) {
    failed(res, err, 'GW2 refresh:');
  }
});

// A character's gear and build with names and pictures. -> { equipment, specializations, skills }
gw2Router.get('/api/games/gw2/characters/:name', async (req, res) => {
  try {
    const { rows } = await query(`SELECT "data" FROM game_connections WHERE "user_id" = $1 AND "game" = 'gw2'`, [
      req.userId,
    ]);
    const c = rows[0]?.data?.characters?.find((x) => x.name === req.params.name);
    if (!c?.gear) return res.status(404).json({ error: 'Refresh to load this character’s gear.' });
    res.json(await characterDetails(c.gear));
  } catch (err) {
    failed(res, err, 'GW2 character:');
  }
});

gw2Router.delete('/api/games/gw2', async (req, res) => {
  try {
    await query(`DELETE FROM game_connections WHERE "user_id" = $1 AND "game" = 'gw2'`, [req.userId]);
    await query(`DELETE FROM game_snapshots WHERE "user_id" = $1 AND "game" = 'gw2'`, [req.userId]);
    res.status(204).end();
  } catch (err) {
    failed(res, err, 'GW2 disconnect:');
  }
});
