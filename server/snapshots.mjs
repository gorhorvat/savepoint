// Daily snapshots of each connected game's numbers, for the progress graphs in
// My Stats. Every read of a game overwrites that day's snapshot, so a day keeps
// its last value. The client turns them into lines.
//
//   GET /api/games/:game/history  -> { days: [{ day: "2026-10-29", data }] }
import express from 'express';
import { query } from './db.mjs';

const GAMES = new Set(['lol', 'gw2', 'ffxiv', 'cs2', 'dota2', 'wow']);

/** Saves today's numbers for a game. Never fails the read it belongs to. */
export async function saveSnapshot(userId, game, data) {
  try {
    await query(
      `INSERT INTO game_snapshots ("user_id", "game", "day", "data") VALUES ($1, $2, CURRENT_DATE, $3)
       ON CONFLICT ("user_id", "game", "day") DO UPDATE SET "data" = EXCLUDED."data"`,
      [userId, game, JSON.stringify(data)],
    );
  } catch (err) {
    console.error('Game snapshot:', err);
  }
}

export const snapshotRouter = express.Router();

snapshotRouter.get('/api/games/:game/history', async (req, res) => {
  if (!GAMES.has(req.params.game)) return res.status(404).json({ error: 'No such game.' });
  try {
    const { rows } = await query(
      `SELECT to_char("day", 'YYYY-MM-DD') AS day, "data" FROM game_snapshots
       WHERE "user_id" = $1 AND "game" = $2 ORDER BY "day"`,
      [req.userId, req.params.game],
    );
    res.json({ days: rows });
  } catch (err) {
    console.error('Game history:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});
