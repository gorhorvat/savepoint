// Quests: three daily, three weekly and three monthly goals that earn XP.
//
// Platforms only report running totals (minutes played, achievements earned),
// so the app sends a small snapshot of those totals (src/lib/quests.ts) and
// progress is "totals now minus totals when the period started". When a new
// day, week or month starts, the last totals saved before it become its
// starting point, so play from before the app was opened still counts.
// Periods follow Europe/Zagreb time: days at midnight, weeks on Monday,
// months on the 1st.
//
// Quests are picked from a seed of the account and the period, one easy, one
// medium and one hard, and only from quests the account can do (no
// achievement quest without achievements). The third monthly quest is shared
// by everyone on Savepoint. XP is added as soon as a check finds a quest done.
//
//   POST /api/quests/check   { snapshot }  -> quests, XP, streak, what just finished
//   POST /api/quests/reroll  { slot }      -> the same, with one daily quest swapped
//   GET  /api/quests                       -> the same, from the last saved snapshot
import express from 'express';
import { createHash } from 'node:crypto';
import { query } from './db.mjs';

const TZ = 'Europe/Zagreb';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Minutes in a game that count as having played it (for "different games" and the like). */
const SESSION = 15;

// ---------------------------------------------------------------- periods

const zoneFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Calendar date and time in Zagreb for an instant. */
function zoned(ms) {
  const p = Object.fromEntries(zoneFormat.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}

/** The instant a Zagreb calendar date starts (midnight there). */
function zonedMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const z = zoned(ms);
    const offset = Date.UTC(z.y, z.m - 1, z.d, z.h, z.min) - ms;
    ms = guess - offset;
  }
  return ms;
}

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Start, end and key of the current day, week and month. */
export function periodsAt(now = Date.now()) {
  const z = zoned(now);
  const dayStart = zonedMidnight(z.y, z.m, z.d);
  // Calendar arithmetic on a UTC date of the same y/m/d avoids DST surprises.
  const cal = new Date(Date.UTC(z.y, z.m - 1, z.d));
  const next = new Date(cal.getTime() + DAY_MS);
  const weekday = (cal.getUTCDay() + 6) % 7; // Monday 0
  const monday = new Date(cal.getTime() - weekday * DAY_MS);
  const nextMonday = new Date(monday.getTime() + 7 * DAY_MS);
  const nextMonth = new Date(Date.UTC(z.y, z.m, 1));
  const at = (c) => zonedMidnight(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate());
  return {
    day: { key: dateKey(z.y, z.m, z.d), start: dayStart, end: at(next) },
    week: {
      key: `W${dateKey(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate())}`,
      start: at(monday),
      end: at(nextMonday),
    },
    month: { key: `${z.y}-${pad(z.m)}`, start: zonedMidnight(z.y, z.m, 1), end: at(nextMonth) },
  };
}

// ---------------------------------------------------------------- the quests

const hours = (min) => Math.round(min / 60);

/**
 * Every quest: its period, difficulty, XP and target, a title, what unit its
 * progress is counted in, what the account needs for it to be possible, and how
 * progress is measured from the period's numbers (see measure() below).
 * `games` names the quests that only count some games (shown on those games' pages).
 */
export const QUESTS = {
  // Daily
  'd.play30': {
    period: 'day',
    tier: 'easy',
    xp: 5,
    target: 30,
    unit: 'minutes',
    title: 'Play any game for 30 minutes',
    of: (c) => c.minutes,
  },
  'd.ach1': {
    period: 'day',
    tier: 'easy',
    xp: 5,
    target: 1,
    unit: 'count',
    title: 'Unlock an achievement',
    needs: 'achievements',
    of: (c) => c.achievements,
  },
  'd.backlog30': {
    period: 'day',
    tier: 'medium',
    xp: 10,
    target: 30,
    unit: 'minutes',
    title: 'Play a Backlog game for 30 minutes',
    needs: 'backlog',
    games: 'backlog',
    of: (c) => c.backlogMinutes,
  },
  'd.dusty': {
    period: 'day',
    tier: 'medium',
    xp: 10,
    target: 1,
    unit: 'count',
    title: "Play a game you haven't touched in 30 days",
    needs: 'dusty',
    games: 'dusty',
    of: (c) => Math.min(1, c.dustyPlayed),
  },
  'd.ach3one': {
    period: 'day',
    tier: 'hard',
    xp: 20,
    target: 3,
    unit: 'count',
    title: 'Unlock 3 achievements in one game',
    needs: 'achievements',
    of: (c) => c.mostInOneGame,
  },
  'd.play120': {
    period: 'day',
    tier: 'hard',
    xp: 20,
    target: 120,
    unit: 'minutes',
    title: 'Play for 2 hours in total',
    of: (c) => c.minutes,
  },
  // Weekly
  'w.games3': {
    period: 'week',
    tier: 'easy',
    xp: 30,
    target: 3,
    unit: 'count',
    title: 'Play 3 different games',
    of: (c) => c.gamesPlayed,
  },
  'w.dailies3': {
    period: 'week',
    tier: 'easy',
    xp: 30,
    target: 3,
    unit: 'count',
    title: 'Finish daily quests on 3 days',
    // Counted from the quests table, not from play totals (see dailyDays()).
    of: (c) => c.dailyDays,
  },
  'w.oneGame180': {
    period: 'week',
    tier: 'easy',
    xp: 30,
    target: 180,
    unit: 'minutes',
    title: 'Play one game for 3 hours',
    of: (c) => c.mostMinutesInOneGame,
  },
  'w.play360': {
    period: 'week',
    tier: 'medium',
    xp: 60,
    target: 360,
    unit: 'minutes',
    title: 'Play for 6 hours in total',
    of: (c) => c.minutes,
  },
  'w.ach10': {
    period: 'week',
    tier: 'medium',
    xp: 60,
    target: 10,
    unit: 'count',
    title: 'Unlock 10 achievements',
    needs: 'achievements',
    of: (c) => c.achievements,
  },
  'w.backlog120': {
    period: 'week',
    tier: 'medium',
    xp: 60,
    target: 120,
    unit: 'minutes',
    title: 'Play Backlog games for 2 hours',
    needs: 'backlog',
    games: 'backlog',
    of: (c) => c.backlogMinutes,
  },
  'w.ach5one': {
    period: 'week',
    tier: 'hard',
    xp: 100,
    target: 5,
    unit: 'count',
    title: 'Unlock 5 achievements in one game',
    needs: 'achievements',
    of: (c) => c.mostInOneGame,
  },
  'w.games4h': {
    period: 'week',
    tier: 'hard',
    xp: 100,
    target: 4,
    unit: 'count',
    title: 'Play 4 different games for an hour each',
    of: (c) => c.gamesPlayedHour,
  },
  'w.ach20': {
    period: 'week',
    tier: 'hard',
    xp: 100,
    target: 20,
    unit: 'count',
    title: 'Unlock 20 achievements',
    needs: 'achievements',
    of: (c) => c.achievements,
  },
  // Monthly
  'm.play1200': {
    period: 'month',
    tier: 'easy',
    xp: 100,
    target: 1200,
    unit: 'minutes',
    title: 'Play for 20 hours in total',
    of: (c) => c.minutes,
  },
  'm.games5': {
    period: 'month',
    tier: 'easy',
    xp: 100,
    target: 5,
    unit: 'count',
    title: 'Play 5 different games',
    of: (c) => c.gamesPlayed,
  },
  'm.ach40': {
    period: 'month',
    tier: 'hard',
    xp: 200,
    target: 40,
    unit: 'count',
    title: 'Unlock 40 achievements',
    needs: 'achievements',
    of: (c) => c.achievements,
  },
  'm.backlogHalf': {
    period: 'month',
    tier: 'hard',
    xp: 200,
    target: 100,
    unit: 'percent',
    title: 'Play a Backlog game for half its main story length',
    needs: 'backlogLength',
    games: 'backlogLength',
    of: (c) => c.bestBacklogShare,
  },
  'm.complete': {
    period: 'month',
    tier: 'hard',
    xp: 200,
    target: 1,
    unit: 'count',
    title: 'Reach 100%, a platinum or a mastery in a game',
    needs: 'achievements',
    of: (c) => c.completed,
  },
};

/** The monthly quest everyone shares. The target grows with how many people are playing. */
export const SHARED = {
  's.hours': {
    period: 'month',
    tier: 'shared',
    xp: 150,
    perPerson: 25 * 60,
    unit: 'minutes',
    title: (t) => `Everyone's goal: ${hours(t)} hours this month`,
    note: "Any game on any platform. Everyone's hours count toward one total.",
    of: (c) => c.minutes,
  },
  's.ach': {
    period: 'month',
    tier: 'shared',
    xp: 150,
    perPerson: 60,
    unit: 'count',
    title: (t) => `Everyone's goal: ${t} achievements this month`,
    note: "Any achievement in any game. Everyone's unlocks count toward one total.",
    // Only people who can earn achievements set the target.
    needs: 'achievements',
    of: (c) => c.achievements,
  },
};

/** Which difficulty goes in which slot. */
const SLOTS = {
  day: ['easy', 'medium', 'hard'],
  week: ['easy', 'medium', 'hard'],
  month: ['easy', 'hard'],
};
const SHARED_SLOT = 2;

/**
 * Quests that are no longer handed out. An unfinished one is swapped for a new
 * quest at the next check (see ensureQuests()); a finished one keeps its title.
 */
const RETIRED = {
  'w.plats2': { period: 'week', tier: 'easy', unit: 'count', title: 'Play on 2 different platforms', of: () => 0 },
  'w.nearly': {
    period: 'week',
    tier: 'hard',
    unit: 'count',
    title: "Unlock 3 achievements in a game that's 75% done",
    of: () => 0,
  },
};

export const questInfo = (key) => QUESTS[key] ?? SHARED[key] ?? RETIRED[key];

// ---------------------------------------------------------------- snapshots
//
// A snapshot (sent by the app):
//   { platforms: ['steam', …],                      connected platforms
//     games: { [gameId]: {
//       l?: '2026-10-30T…',                          last played, as the platform reports it
//       b?: 1,                                       in Backlog
//       h?: 12.5,                                    HowLongToBeat main story, hours
//       p: { [platform]: { m, e?, t?, d? } } } } }   minutes, achievements earned / total, done

const MAX_GAMES = 20000;
const num = (v, max = 1e9) => (Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : 0);
const PLATFORM = /^[a-z]{2,12}$/;

/** A snapshot from the app, kept to the expected shape and sizes. */
export function cleanSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || !raw.games || typeof raw.games !== 'object') return null;
  const platforms = Array.isArray(raw.platforms) ? raw.platforms.filter((p) => PLATFORM.test(p)).slice(0, 20) : [];
  const games = {};
  let n = 0;
  for (const [id, g] of Object.entries(raw.games)) {
    if (++n > MAX_GAMES) break;
    if (typeof id !== 'string' || id.length > 200 || !g || typeof g !== 'object' || !g.p) continue;
    const p = {};
    for (const [platform, v] of Object.entries(g.p)) {
      if (!PLATFORM.test(platform) || !v || typeof v !== 'object') continue;
      const row = { m: num(v.m) };
      if (v.t) {
        row.t = num(v.t, 100000);
        row.e = Math.min(num(v.e, 100000), row.t);
        if (v.d) row.d = 1;
      }
      p[platform] = row;
    }
    if (!Object.keys(p).length) continue;
    const game = { p };
    if (typeof g.l === 'string' && !Number.isNaN(Date.parse(g.l))) game.l = g.l;
    if (g.b) game.b = 1;
    if (Number.isFinite(g.h) && g.h > 0 && g.h < 10000) game.h = Math.round(g.h * 10) / 10;
    games[id] = game;
  }
  return { platforms, games };
}

/**
 * The numbers quests are measured by, between the period's starting point
 * (`base`) and now (`now`).
 */
export function measure(base, now, start, length) {
  const c = {
    minutes: 0,
    achievements: 0,
    gamesPlayed: 0,
    gamesPlayedHour: 0,
    mostMinutesInOneGame: 0,
    mostInOneGame: 0,
    backlogMinutes: 0,
    dustyPlayed: 0,
    completed: 0,
    bestBacklogShare: 0,
    // Days this period with a daily quest done. Not from play totals: evaluate() fills it in.
    dailyDays: 0,
  };
  if (!base) return c;
  const dusty = start - 30 * DAY_MS;
  for (const [id, g] of Object.entries(now.games)) {
    const before = base.games[id];
    let gameMinutes = 0;
    for (const [platform, v] of Object.entries(g.p)) {
      const was = before?.p[platform];
      let dm;
      let de;
      if (was) {
        dm = Math.max(0, v.m - was.m);
        de = Math.max(0, (v.e ?? 0) - (was.e ?? 0));
      } else if (base.platforms.includes(platform) && v.m <= length && g.l && Date.parse(g.l) >= start) {
        // New on a platform that was already connected and played this period (a game
        // bought this period): all of it is new. Lifetime totals from a newly connected
        // platform, or an old game turning up again, aren't.
        dm = v.m;
        de = v.e ?? 0;
      } else {
        continue;
      }
      gameMinutes += dm;
      c.achievements += de;
      if (de > c.mostInOneGame) c.mostInOneGame = de;
      if (v.d && was && !was.d) c.completed++;
    }
    c.minutes += gameMinutes;
    if (gameMinutes >= SESSION) c.gamesPlayed++;
    if (gameMinutes >= 60) c.gamesPlayedHour++;
    if (gameMinutes > c.mostMinutesInOneGame) c.mostMinutesInOneGame = gameMinutes;
    if (!before) continue;
    if (before.b) {
      c.backlogMinutes += gameMinutes;
      if (before.h)
        c.bestBacklogShare = Math.max(c.bestBacklogShare, Math.floor((gameMinutes / (before.h * 30)) * 100));
    }
    if (gameMinutes >= SESSION && (!before.l || Date.parse(before.l) < dusty)) c.dustyPlayed++;
  }
  return c;
}

/** Which quests the account can do, from its snapshot. */
function abilities(snap, start) {
  const a = {
    achievements: false,
    backlog: false,
    backlogLength: false,
    dusty: false,
  };
  const dusty = start - 30 * DAY_MS;
  for (const g of Object.values(snap.games)) {
    if (g.b) a.backlog = true;
    if (g.b && g.h) a.backlogLength = true;
    if (!g.l || Date.parse(g.l) < dusty) a.dusty = true;
    if (Object.values(g.p).some((v) => v.t)) a.achievements = true;
  }
  return a;
}

/** The games a game-specific quest counts, for the "counts for a quest" note on game pages. */
function questGames(kind, snap, start) {
  if (!snap) return [];
  const dusty = start - 30 * DAY_MS;
  const out = [];
  for (const [id, g] of Object.entries(snap.games)) {
    const yes =
      kind === 'backlog'
        ? g.b
        : kind === 'backlogLength'
          ? g.b && g.h
          : kind === 'dusty' && (!g.l || Date.parse(g.l) < dusty);
    if (yes) out.push(id);
    if (out.length >= 2000) break;
  }
  return out;
}

// ---------------------------------------------------------------- picking

function seededRandom(seed) {
  let s = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One quest key for a slot, from those the account can do, avoiding `taken`. */
function pickQuest(period, tier, can, taken, random) {
  const fits = (k, q) => q.period === period && !taken.has(k) && (!q.needs || can[q.needs]);
  let pool = Object.entries(QUESTS).filter(([k, q]) => q.tier === tier && fits(k, q));
  // Nothing at this difficulty the account can do: any other quest of the period.
  if (!pool.length) pool = Object.entries(QUESTS).filter(([k, q]) => fits(k, q));
  if (!pool.length) return null;
  return pool[Math.floor(random() * pool.length)][0];
}

// ---------------------------------------------------------------- storage

async function loadTotals(userId) {
  const { rows } = await query(`SELECT "totals" FROM quest_totals WHERE "user_id" = $1`, [userId]);
  return rows[0]?.totals ?? null;
}

async function saveTotals(userId, totals) {
  await query(
    `INSERT INTO quest_totals ("user_id", "totals", "updated_at") VALUES ($1, $2, now())
     ON CONFLICT ("user_id") DO UPDATE SET "totals" = EXCLUDED."totals", "updated_at" = now()`,
    [userId, JSON.stringify(totals)],
  );
}

/**
 * The starting point of each current period. A period seen for the first time
 * starts from the last totals saved before it (or, for a first check ever, from now).
 */
async function baselines(userId, periods, previous, now) {
  const { rows } = await query(`SELECT "period", "period_key", "totals" FROM quest_baselines WHERE "user_id" = $1`, [
    userId,
  ]);
  const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r]));
  const out = {};
  for (const [period, p] of Object.entries(periods)) {
    const row = byPeriod[period];
    if (row?.period_key === p.key) {
      out[period] = row.totals;
      continue;
    }
    const start = previous ?? now;
    await query(
      `INSERT INTO quest_baselines ("user_id", "period", "period_key", "totals") VALUES ($1, $2, $3, $4)
       ON CONFLICT ("user_id", "period") DO UPDATE SET "period_key" = EXCLUDED."period_key", "totals" = EXCLUDED."totals"`,
      [userId, period, p.key, JSON.stringify(start)],
    );
    out[period] = start;
  }
  return out;
}

/** The shared monthly quest, created by whoever checks first that month. */
async function sharedQuest(monthKey) {
  const { rows } = await query(`SELECT "quest_key", "target" FROM quest_shared WHERE "period_key" = $1`, [monthKey]);
  if (rows[0]) return rows[0];
  const keys = Object.keys(SHARED);
  const key = keys[Math.floor(seededRandom(`shared:${monthKey}`)() * keys.length)];
  // People who checked their quests in the last 30 days and can do this quest, counting at least two.
  const { rows: active } = await query(
    `SELECT "totals" FROM quest_totals WHERE "updated_at" > now() - interval '30 days'`,
  );
  const need = SHARED[key].needs;
  const people = active.filter((r) => !need || abilities(r.totals, Date.now())[need]).length;
  const target = SHARED[key].perPerson * Math.max(2, people);
  await query(
    `INSERT INTO quest_shared ("period_key", "quest_key", "target") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [monthKey, key, target],
  );
  const { rows: again } = await query(`SELECT "quest_key", "target" FROM quest_shared WHERE "period_key" = $1`, [
    monthKey,
  ]);
  return again[0];
}

/** Makes this period's quests if they don't exist yet. */
async function ensureQuests(userId, periods, snap) {
  const current = `"user_id" = $1 AND
       (("period" = 'day' AND "period_key" = $2) OR ("period" = 'week' AND "period_key" = $3) OR ("period" = 'month' AND "period_key" = $4))`;
  const keys = [userId, periods.day.key, periods.week.key, periods.month.key];
  // Unfinished quests that are no longer handed out make room for new ones.
  await query(`DELETE FROM quests WHERE ${current} AND "completed_at" IS NULL AND "quest_key" = ANY($5)`, [
    ...keys,
    Object.keys(RETIRED),
  ]);
  const { rows } = await query(`SELECT "period", "slot", "quest_key" FROM quests WHERE ${current}`, keys);
  const have = new Set(rows.map((r) => `${r.period}:${r.slot}`));
  for (const [period, tiers] of Object.entries(SLOTS)) {
    const p = periods[period];
    const missing = tiers.map((_, slot) => slot).filter((slot) => !have.has(`${period}:${slot}`));
    const needsShared = period === 'month' && !have.has(`month:${SHARED_SLOT}`);
    if (!missing.length && !needsShared) continue;
    const can = abilities(snap, p.start);
    const random = seededRandom(`${userId}:${period}:${p.key}`);
    // Quests already in this period's other slots aren't picked again.
    const taken = new Set(rows.filter((r) => r.period === period).map((r) => r.quest_key));
    // Pick every slot in order so the same seed gives the same quests.
    const picks = tiers.map((tier) => {
      const key = pickQuest(period, tier, can, taken, random);
      if (key) taken.add(key);
      return key;
    });
    for (const slot of missing) {
      const key = picks[slot];
      if (!key) continue;
      await query(
        `INSERT INTO quests ("user_id", "period", "period_key", "slot", "quest_key", "target", "xp")
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [userId, period, p.key, slot, key, QUESTS[key].target, QUESTS[key].xp],
      );
    }
    if (needsShared) {
      const shared = await sharedQuest(p.key);
      await query(
        `INSERT INTO quests ("user_id", "period", "period_key", "slot", "quest_key", "target", "xp")
         VALUES ($1, 'month', $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [userId, p.key, SHARED_SLOT, shared.quest_key, shared.target, SHARED[shared.quest_key].xp],
      );
    }
  }
}

async function currentQuests(userId, periods) {
  const { rows } = await query(
    `SELECT "period", "period_key", "slot", "quest_key", "target", "progress", "xp", "completed_at", "rerolled"
     FROM quests WHERE "user_id" = $1 AND
       (("period" = 'day' AND "period_key" = $2) OR ("period" = 'week' AND "period_key" = $3) OR ("period" = 'month' AND "period_key" = $4))
     ORDER BY CASE "period" WHEN 'day' THEN 0 WHEN 'week' THEN 1 ELSE 2 END, "slot"`,
    [userId, periods.day.key, periods.week.key, periods.month.key],
  );
  return rows;
}

/** Days in a row, up to today, with at least one daily quest done. */
async function dailyStreak(userId, todayKey) {
  const { rows } = await query(
    `SELECT DISTINCT "period_key" AS day FROM quests
     WHERE "user_id" = $1 AND "period" = 'day' AND "completed_at" IS NOT NULL
     ORDER BY "period_key" DESC LIMIT 400`,
    [userId],
  );
  const done = new Set(rows.map((r) => r.day));
  const day = new Date(`${todayKey}T00:00:00Z`);
  // Today not done yet doesn't break the streak.
  if (!done.has(todayKey)) day.setUTCDate(day.getUTCDate() - 1);
  let n = 0;
  while (done.has(day.toISOString().slice(0, 10))) {
    n++;
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return n;
}

/** Days from `fromKey` to `toKey` (both included) with at least one daily quest done. */
async function dailyDays(userId, fromKey, toKey) {
  const { rows } = await query(
    `SELECT count(DISTINCT "period_key")::int AS n FROM quests
     WHERE "user_id" = $1 AND "period" = 'day' AND "completed_at" IS NOT NULL
       AND "period_key" >= $2 AND "period_key" <= $3`,
    [userId, fromKey, toKey],
  );
  return rows[0].n;
}

// ---------------------------------------------------------------- checking

/**
 * Updates progress from the snapshot `now`, adds XP for quests that are done,
 * and returns what the app shows. `fresh` is false when nothing new was sent
 * (only the stored progress is read).
 */
async function evaluate(userId, now, { fresh }) {
  const time = Date.now();
  const periods = periodsAt(time);
  if (!now || !Object.keys(now.games).length) {
    return { periods: publicPeriods(periods), quests: [], xp: await questXp(userId), streak: 0, done: 0, empty: true };
  }

  let base = null;
  if (fresh) {
    const previous = await loadTotals(userId);
    base = await baselines(userId, periods, previous, now);
    await saveTotals(userId, now);
  } else {
    base = await baselines(userId, periods, now, now);
  }
  await ensureQuests(userId, periods, now);
  const rows = await currentQuests(userId, periods);

  const lengthOf = (p) => Math.round((p.end - p.start) / 60000);
  const numbers = Object.fromEntries(
    Object.entries(periods).map(([period, p]) => [period, measure(base[period], now, p.start, lengthOf(p))]),
  );
  // Week keys are "W" + Monday's date; day keys are dates, so they sort as text.
  const weekDays = () => dailyDays(userId, periods.week.key.slice(1), periods.day.key);
  const countsDailies = rows.some((r) => r.quest_key === 'w.dailies3' && !r.completed_at);
  if (countsDailies) numbers.week.dailyDays = await weekDays();

  const setProgress = async (r, value) => {
    const progress = Math.min(value, 1e9);
    if (progress === r.progress) return;
    await query(
      `UPDATE quests SET "progress" = $5 WHERE "user_id" = $1 AND "period" = $2 AND "period_key" = $3 AND "slot" = $4`,
      [userId, r.period, r.period_key, r.slot, progress],
    );
    r.progress = progress;
  };
  const finished = [];
  const markDone = async (r) => {
    const { rows: hit } = await query(
      `UPDATE quests SET "completed_at" = now()
       WHERE "user_id" = $1 AND "period" = $2 AND "period_key" = $3 AND "slot" = $4 AND "completed_at" IS NULL
       RETURNING "completed_at"`,
      [userId, r.period, r.period_key, r.slot],
    );
    if (!hit[0]) return;
    r.completed_at = hit[0].completed_at;
    finished.push({ title: titleOf(r), xp: r.xp });
  };

  for (const r of rows) {
    const q = questInfo(r.quest_key);
    // A finished quest keeps its progress (totals can drop when a game or platform is removed).
    if (!q || r.completed_at) continue;
    await setProgress(r, q.of(numbers[r.period]));
  }

  // The shared quest: everyone's progress added up.
  const sharedRow = rows.find((r) => SHARED[r.quest_key]);
  let sharedTotal = 0;
  if (sharedRow) {
    const { rows: sum } = await query(
      `SELECT COALESCE(sum("progress"), 0)::bigint AS total, count(*) FILTER (WHERE "progress" > 0)::int AS people
       FROM quests WHERE "period" = 'month' AND "period_key" = $1 AND "slot" = $2`,
      [sharedRow.period_key, SHARED_SLOT],
    );
    sharedTotal = Number(sum[0].total);
    sharedRow.people = sum[0].people;
  }

  for (const r of rows) {
    if (r.completed_at) continue;
    const isShared = !!SHARED[r.quest_key];
    const complete = isShared ? sharedTotal >= r.target && r.progress > 0 : r.progress >= r.target;
    if (complete) await markDone(r);
  }

  // A daily quest finished just now counts for "Finish daily quests on 3 days" straight away.
  const dailies = rows.find((r) => r.quest_key === 'w.dailies3' && !r.completed_at);
  if (dailies && finished.length) {
    await setProgress(dailies, await weekDays());
    if (dailies.progress >= dailies.target) await markDone(dailies);
  }

  const rerollUsed = rows.some((r) => r.period === 'day' && r.rerolled);
  const quests = rows.map((r) => {
    const q = questInfo(r.quest_key);
    const p = periods[r.period];
    const out = {
      period: r.period,
      slot: r.slot,
      key: r.quest_key,
      title: titleOf(r),
      tier: q.tier,
      ...(q.note && { note: q.note }),
      xp: r.xp,
      unit: q.unit,
      target: r.target,
      progress: r.completed_at && !SHARED[r.quest_key] ? r.target : Math.min(r.progress, r.target),
      done: !!r.completed_at,
      canReroll: r.period === 'day' && !rerollUsed && !r.completed_at,
    };
    if (SHARED[r.quest_key]) out.shared = { total: Math.min(sharedTotal, r.target), people: r.people ?? 0 };
    if (q.games && !r.completed_at) out.games = questGames(q.games, base[r.period], p.start);
    return out;
  });

  const [xp, done, streak] = await Promise.all([
    questXp(userId),
    questCount(userId),
    dailyStreak(userId, periods.day.key),
  ]);
  return { periods: publicPeriods(periods), quests, xp, done, streak, finished, rerollUsed };
}

function titleOf(r) {
  const q = questInfo(r.quest_key);
  return typeof q.title === 'function' ? q.title(r.target) : q.title;
}

const publicPeriods = (periods) =>
  Object.fromEntries(
    Object.entries(periods).map(([k, p]) => [k, { key: p.key, endsAt: new Date(p.end).toISOString() }]),
  );

async function questXp(userId) {
  const { rows } = await query(
    `SELECT COALESCE(sum("xp"), 0)::int AS xp FROM quests WHERE "user_id" = $1 AND "completed_at" IS NOT NULL`,
    [userId],
  );
  return rows[0].xp;
}

async function questCount(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM quests WHERE "user_id" = $1 AND "completed_at" IS NOT NULL`,
    [userId],
  );
  return rows[0].n;
}

/** Swaps one of today's quests for another of the same difficulty, once a day. */
async function reroll(userId, slot) {
  const periods = periodsAt();
  const snap = await loadTotals(userId);
  if (!snap) return { error: 'Check your quests first.' };
  const rows = await currentQuests(userId, periods);
  const today = rows.filter((r) => r.period === 'day');
  if (today.some((r) => r.rerolled))
    return { error: "You've already swapped a quest today. New ones come at midnight." };
  const row = today.find((r) => r.slot === slot);
  if (!row) return { error: 'That quest is gone. Reload the page.' };
  if (row.completed_at) return { error: 'That quest is already done.' };
  const can = abilities(snap, periods.day.start);
  const taken = new Set(today.map((r) => r.quest_key));
  const key = pickQuest('day', QUESTS[row.quest_key]?.tier ?? 'easy', can, taken, Math.random);
  if (!key) return { error: 'There is no other quest to swap in today.' };
  await query(
    `UPDATE quests SET "quest_key" = $5, "target" = $6, "xp" = $7, "progress" = 0, "rerolled" = true
     WHERE "user_id" = $1 AND "period" = $2 AND "period_key" = $3 AND "slot" = $4 AND "completed_at" IS NULL`,
    [userId, 'day', periods.day.key, slot, key, QUESTS[key].target, QUESTS[key].xp],
  );
  return null;
}

// ---------------------------------------------------------------- routes

export const questsRouter = express.Router();

const failed = (res, err) => {
  console.error('Quests:', err);
  res.status(502).json({ error: "Couldn't load your quests right now. Try again in a moment." });
};

questsRouter.get('/api/quests', async (req, res) => {
  try {
    res.json(await evaluate(req.userId, await loadTotals(req.userId), { fresh: false }));
  } catch (err) {
    failed(res, err);
  }
});

questsRouter.post('/api/quests/check', express.json({ limit: '4mb' }), async (req, res) => {
  const snap = cleanSnapshot(req.body?.snapshot);
  if (!snap) return res.status(400).json({ error: 'Expected { snapshot }.' });
  try {
    res.json(await evaluate(req.userId, snap, { fresh: true }));
  } catch (err) {
    failed(res, err);
  }
});

questsRouter.post('/api/quests/reroll', express.json({ limit: '1kb' }), async (req, res) => {
  const slot = req.body?.slot;
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) return res.status(400).json({ error: 'Expected { slot }.' });
  try {
    const problem = await reroll(req.userId, slot);
    if (problem) return res.status(409).json(problem);
    res.json(await evaluate(req.userId, await loadTotals(req.userId), { fresh: false }));
  } catch (err) {
    failed(res, err);
  }
});
