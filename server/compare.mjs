// Comparing a game's stats with someone else: a friend on Savepoint (their
// saved connection, when they share their stats), or, for games with a public
// lookup, any player found by name. Looked-up players are read in a light way
// and kept in game_lookups for a day, so the same opponent isn't read from
// the game's site again and again.
//
//   GET /api/games/:game/compare/friends          { friends: [{ id, username, avatar, name, fetchedAt }] }
//   GET /api/games/:game/compare/search?q=&world= { results: [{ id, name, note, avatar }] } (lookup games only)
//   GET /api/games/:game/compare?with=user:<id>   { me, them: { kind: 'friend', user, ... }, history: { me, them } }
//   GET /api/games/:game/compare?with=lookup:<id> { me, them: { kind: 'lookup', ... } }
//   POST /api/account/share-stats { on }          friends may see my game stats (default on)
import express from 'express';
import { query } from './db.mjs';
import { forClient as ffxivForClient, LodestoneError, readCharacter, searchCharacters } from './ffxiv.mjs';

const GAMES = new Set(['lol', 'gw2', 'ffxiv', 'cs2', 'dota2', 'wow']);
const LOOKUP_TTL = 24 * 3600 * 1000;
const LOOKUPS_PER_HOUR = 20; // reads of other people's characters, per account

// Games where anyone can be looked up by name. search(q, extra) -> results;
// read(id) -> { name, data } with the same shape as a connection's data.
const LOOKUPS = {
  ffxiv: {
    label: 'Lodestone character',
    async search(q, { world }) {
      const list = await searchCharacters(q, world || undefined);
      return list.map((c) => ({
        id: c.id,
        name: c.name,
        note: [c.world, c.dataCenter].filter(Boolean).join(' · '),
        avatar: c.avatar,
      }));
    },
    async read(id) {
      const c = await readCharacter(id, null, { light: true });
      return { name: c.name, data: ffxivForClient(c) };
    },
  },
};

/** Fields that stay on the server even when stats are shared. */
function shared(game, data) {
  if (!data || typeof data !== 'object') return data;
  const { achievementList: _list, puuid: _puuid, ...rest } = data;
  return rest;
}

const lookupsByUser = new Map(); // userId -> [timestamps]
function allowLookup(userId) {
  const now = Date.now();
  const list = (lookupsByUser.get(userId) ?? []).filter((t) => t > now - 3600 * 1000);
  if (list.length >= LOOKUPS_PER_HOUR) return false;
  list.push(now);
  lookupsByUser.set(userId, list);
  return true;
}

async function myConnection(userId, game) {
  const { rows } = await query(
    `SELECT "external_id", "name", "data", "fetched_at" FROM game_connections WHERE "user_id" = $1 AND "game" = $2`,
    [userId, game],
  );
  const r = rows[0];
  return r ? { id: r.external_id, name: r.name, data: shared(game, r.data), fetchedAt: r.fetched_at } : null;
}

/** My side of a comparison: the connection plus who I am, for the heading. */
async function mySide(req, game) {
  const me = await myConnection(req.userId, game);
  if (!me) return null;
  const { rows } = await query(`SELECT "data"->>'avatar' AS avatar FROM public_profiles WHERE "user_id" = $1`, [
    req.userId,
  ]);
  return { ...me, user: { id: req.userId, username: req.username, avatar: rows[0]?.avatar ?? null } };
}

async function history(userId, game) {
  const { rows } = await query(
    `SELECT to_char("day", 'YYYY-MM-DD') AS day, "data" FROM game_snapshots
     WHERE "user_id" = $1 AND "game" = $2 ORDER BY "day"`,
    [userId, game],
  );
  return rows;
}

function failed(res, err, what) {
  if (err instanceof LodestoneError) return res.status(err.status ?? 502).json({ error: err.message });
  console.error(`${what}:`, err);
  res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
}

export const compareRouter = express.Router();

compareRouter.param('game', (req, res, next, game) => {
  if (!GAMES.has(game)) return res.status(404).json({ error: 'No such game.' });
  next();
});

// Friends who have this game connected and share their stats.
compareRouter.get('/api/games/:game/compare/friends', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u."id", u."username", p."data"->>'avatar' AS avatar, c."name", c."fetched_at"
       FROM friendships f
       JOIN users u ON u."id" = CASE WHEN f."requester_id" = $1 THEN f."addressee_id" ELSE f."requester_id" END
       JOIN game_connections c ON c."user_id" = u."id" AND c."game" = $2
       LEFT JOIN public_profiles p ON p."user_id" = u."id"
       WHERE f."status" = 'accepted' AND (f."requester_id" = $1 OR f."addressee_id" = $1)
         AND u."share_stats" AND u."disabled_at" IS NULL
       ORDER BY lower(u."username")`,
      [req.userId, req.params.game],
    );
    res.json({
      lookup: req.params.game in LOOKUPS ? LOOKUPS[req.params.game].label : null,
      friends: rows.map((r) => ({
        id: r.id,
        username: r.username,
        avatar: r.avatar ?? null,
        name: r.name,
        fetchedAt: r.fetched_at,
      })),
    });
  } catch (err) {
    failed(res, err, 'Compare friends');
  }
});

compareRouter.get('/api/games/:game/compare/search', async (req, res) => {
  const lookup = LOOKUPS[req.params.game];
  if (!lookup) return res.status(404).json({ error: 'This game has no public search; compare with a friend instead.' });
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Type at least two letters.' });
  try {
    const results = await lookup.search(q, { world: String(req.query.world ?? '').trim() });
    res.json({ results });
  } catch (err) {
    failed(res, err, 'Compare search');
  }
});

compareRouter.get('/api/games/:game/compare', async (req, res) => {
  const game = req.params.game;
  const [kind, id] = String(req.query.with ?? '').split(':');
  if (!['user', 'lookup'].includes(kind) || !id) {
    return res.status(400).json({ error: 'Say who to compare with: with=user:<id> or with=lookup:<id>.' });
  }
  try {
    const me = await mySide(req, game);
    if (!me) return res.status(404).json({ error: 'Connect your own account for this game first.' });

    if (kind === 'user') {
      const friendId = Number(id);
      if (!Number.isInteger(friendId)) return res.status(400).json({ error: 'No such friend.' });
      const { rows } = await query(
        `SELECT u."id", u."username", u."share_stats", p."data"->>'avatar' AS avatar,
                c."external_id", c."name", c."data", c."fetched_at"
         FROM friendships f
         JOIN users u ON u."id" = $2
         LEFT JOIN public_profiles p ON p."user_id" = u."id"
         LEFT JOIN game_connections c ON c."user_id" = u."id" AND c."game" = $3
         WHERE f."status" = 'accepted'
           AND ((f."requester_id" = $1 AND f."addressee_id" = $2) OR (f."requester_id" = $2 AND f."addressee_id" = $1))`,
        [req.userId, friendId, game],
      );
      const r = rows[0];
      if (!r) return res.status(404).json({ error: "That's not one of your friends." });
      if (!r.share_stats) return res.status(403).json({ error: `${r.username} keeps their game stats private.` });
      if (!r.data) return res.status(404).json({ error: `${r.username} hasn't connected this game.` });
      const [mine, theirs] = await Promise.all([history(req.userId, game), history(friendId, game)]);
      return res.json({
        game,
        me,
        them: {
          kind: 'friend',
          user: { id: r.id, username: r.username, avatar: r.avatar ?? null },
          id: r.external_id,
          name: r.name,
          data: shared(game, r.data),
          fetchedAt: r.fetched_at,
        },
        history: { me: mine, them: theirs },
      });
    }

    const lookup = LOOKUPS[game];
    if (!lookup) return res.status(404).json({ error: 'This game only compares with friends.' });
    if (id === me.id) return res.status(400).json({ error: "That's you." });
    const { rows } = await query(
      `SELECT "name", "data", "fetched_at" FROM game_lookups WHERE "game" = $1 AND "external_id" = $2`,
      [game, id],
    );
    let hit = rows[0];
    if (!hit || Date.now() - new Date(hit.fetched_at).getTime() > LOOKUP_TTL) {
      if (!allowLookup(req.userId)) {
        return res.status(429).json({ error: 'That is a lot of lookups for one hour. Try again later.' });
      }
      const read = await lookup.read(id);
      hit = { name: read.name, data: read.data, fetched_at: new Date().toISOString() };
      await query(
        `INSERT INTO game_lookups ("game", "external_id", "name", "data", "fetched_at") VALUES ($1, $2, $3, $4, now())
         ON CONFLICT ("game", "external_id") DO UPDATE
         SET "name" = EXCLUDED."name", "data" = EXCLUDED."data", "fetched_at" = EXCLUDED."fetched_at"`,
        [game, id, hit.name, JSON.stringify(hit.data)],
      ).catch((err) => console.error('Compare lookup save:', err));
    }
    res.json({
      game,
      me,
      them: { kind: 'lookup', id, name: hit.name, data: shared(game, hit.data), fetchedAt: hit.fetched_at },
      history: { me: await history(req.userId, game), them: null },
    });
  } catch (err) {
    failed(res, err, 'Compare');
  }
});

compareRouter.post('/api/account/share-stats', express.json({ limit: '1kb' }), async (req, res) => {
  const on = req.body?.on;
  if (typeof on !== 'boolean') return res.status(400).json({ error: 'Expected { on: true | false }.' });
  try {
    await query('UPDATE users SET "share_stats" = $2 WHERE "id" = $1', [req.userId, on]);
    res.json({ shareStats: on });
  } catch (err) {
    failed(res, err, 'Share stats');
  }
});
