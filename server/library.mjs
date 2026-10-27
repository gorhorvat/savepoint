// Loading and saving a user's library in the tables from schema.mjs.
//
// The app sends its whole saved state; it's split into rows here and put back
// together on load. Saves carry the revision they're based on: a save from an
// out-of-date copy (another device saved since) is refused, so it can't
// overwrite newer data. Only collections that changed since the last save are
// rewritten.
import { createHash } from 'node:crypto';
import { query, transaction } from './db.mjs';
import { keyColumns, SECTIONS, TYPES, USER_DATA } from './schema.mjs';

const q = (name) => `"${name}"`;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (v) => isObject(v) && Object.keys(v).length === 0;

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (isObject(o) ? o[k] : undefined), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = isObject(o[k]) ? o[k] : (o[k] = {});
  o[keys.at(-1)] = value;
}

/** Removes a field, and any parent objects left empty by it. */
function deletePath(obj, path) {
  const keys = path.split('.');
  const parents = [obj];
  for (const k of keys.slice(0, -1)) {
    const next = parents.at(-1)[k];
    if (!isObject(next)) return;
    parents.push(next);
  }
  delete parents.at(-1)[keys.at(-1)];
  for (let i = keys.length - 2; i >= 0; i--) {
    if (isEmpty(parents[i + 1])) delete parents[i][keys[i]];
  }
}

/** Copies `extra` into `target`, merging nested objects; `extra` wins. */
function mergeInto(target, extra) {
  for (const [k, v] of Object.entries(extra)) {
    if (isObject(v) && isObject(target[k])) mergeInto(target[k], v);
    else target[k] = v;
  }
  return target;
}

/** Columns from one object; what doesn't fit a column goes to other_fields. */
function toRow(obj, columns) {
  const rest = structuredClone(obj);
  const row = {};
  for (const [col, field, type, opts] of columns) {
    const v = getPath(rest, field);
    if (v === undefined) continue;
    if (v === null && opts?.keepNull) {
      row[col] = null;
      deletePath(rest, field);
    } else if (TYPES[type].fits(v)) {
      row[col] = v;
      deletePath(rest, field);
    }
  }
  if (!isEmpty(rest)) row.other_fields = rest;
  return row;
}

function fromRow(row, columns) {
  const obj = {};
  for (const [col, field, , opts] of columns) {
    if (row[col] != null) setPath(obj, field, row[col]);
    else if (opts?.keepNull && !(row.other_fields && getPath(row.other_fields, field) !== undefined)) {
      setPath(obj, field, null);
    }
  }
  return row.other_fields ? mergeInto(obj, row.other_fields) : obj;
}

// A value that isn't the expected object (say null in a list of objects) is kept as it is.
const RAW = '$value';
// A map item whose own id isn't its key (doesn't happen in practice) is kept as it was.
const NO_ID = '$noId';

/** The rows of one collection, or null when the saved value isn't the expected shape. */
function sectionRows(s, value) {
  const rows = [];
  const push = (keys, item) => {
    let row;
    if (s.shape === 'values') row = toRow({ value: item }, s.columns);
    else if (item === null && s.nullColumn) row = { [s.nullColumn]: true };
    else if (!isObject(item)) row = { other_fields: { [RAW]: item } };
    else if (s.idField && item[s.idField] === keys[0]) {
      // The usual case: the id is the key. Stored once, given back on load.
      const { [s.idField]: _id, ...obj } = item;
      row = toRow(obj, s.columns);
    } else {
      row = toRow(item, s.columns);
      if (s.idField) row.other_fields = { ...row.other_fields, [NO_ID]: true };
    }
    if (s.nullColumn) row[s.nullColumn] ??= false;
    rows.push({ ...row, ...Object.fromEntries(keyColumns(s).map((k, i) => [k, keys[i]])), position: rows.length });
  };

  if (s.shape === 'list' || (s.shape === 'values' && !s.key)) {
    if (!Array.isArray(value)) return null;
    value.forEach((item) => push([], item));
  } else if (s.shape === 'map2') {
    if (!isObject(value) || !Object.values(value).every(isObject)) return null;
    for (const [k, inner] of Object.entries(value)) for (const [k2, item] of Object.entries(inner)) push([k, k2], item);
  } else {
    if (!isObject(value)) return null;
    for (const [k, item] of Object.entries(value)) push([k], item);
  }
  return rows;
}

function sectionValue(s, rows) {
  const item = (row) => {
    if (row.other_fields && RAW in row.other_fields) return row.other_fields[RAW];
    if (s.nullColumn && row[s.nullColumn]) return null;
    if (s.shape === 'values') return fromRow(row, s.columns).value;
    const obj = fromRow(row, s.columns);
    if (!s.idField) return obj;
    if (obj[NO_ID]) {
      delete obj[NO_ID];
      return obj;
    }
    return { [s.idField]: row[s.key], ...obj };
  };
  if (s.shape === 'list' || (s.shape === 'values' && !s.key)) return rows.map(item);
  const out = {};
  for (const row of rows) {
    if (s.shape === 'map2') (out[row[s.key]] ??= {})[row[s.key2]] = item(row);
    else out[row[s.key]] = item(row);
  }
  return out;
}

const hash = (v) =>
  createHash('sha1')
    .update(JSON.stringify(v ?? null))
    .digest('base64url');

/**
 * Splits a saved state into the user_data row and one set of rows per table.
 * Exported for tests and the account setup script.
 */
export function splitState(state) {
  const rest = structuredClone(state);
  delete rest.suggested; // Re-fetched by the app, never saved.
  const sections = {};
  const hashes = {};
  for (const s of SECTIONS) {
    const value = getPath(rest, s.path);
    if (value === undefined) {
      sections[s.table] = [];
    } else {
      const rows = sectionRows(s, value);
      if (!rows) continue; // Not the expected shape: kept in other_fields below.
      sections[s.table] = rows;
      deletePath(rest, s.path);
    }
    hashes[s.table] = hash(value);
  }
  const user = toRow(rest, USER_DATA.columns);
  for (const [col, field] of USER_DATA.columns) if (col in user) deletePath(rest, field);
  // Whatever's left (fields without a column) stays with the user's row.
  user.other_fields = isEmpty(rest) ? null : rest;
  return { user, sections, hashes };
}

/** Puts the saved state back together. */
export function joinState(userRow, sectionRowsByTable) {
  const state = fromRow({ ...userRow, other_fields: null }, USER_DATA.columns);
  for (const s of SECTIONS) setPath(state, s.path, sectionValue(s, sectionRowsByTable[s.table] ?? []));
  return userRow.other_fields ? mergeInto(state, userRow.other_fields) : state;
}

function selectSql(s) {
  const cols = ['position', ...keyColumns(s), ...(s.nullColumn ? [s.nullColumn] : []), ...s.columns.map((c) => c[0])];
  return `SELECT ${cols.map(q).join(', ')}, "other_fields" FROM ${s.table} WHERE "user_id" = $1 ORDER BY "position"`;
}

function insertSql(s) {
  const cols = [
    ['position', 'integer'],
    ...keyColumns(s).map((k) => [k, 'text']),
    ...(s.nullColumn ? [[s.nullColumn, 'boolean']] : []),
    ...s.columns.map(([name, , type]) => [name, TYPES[type].sql]),
    ['other_fields', 'jsonb'],
  ];
  const names = cols.map(([n]) => q(n)).join(', ');
  return (
    `INSERT INTO ${s.table} ("user_id", ${names}) ` +
    `SELECT $1, ${names} FROM jsonb_to_recordset($2::jsonb) AS x(${cols.map(([n, t]) => `${q(n)} ${t}`).join(', ')})`
  );
}

/** { rev, savedAt, version, state } or null when nothing is saved yet. */
export async function loadLibrary(userId) {
  const { rows } = await query(`SELECT * FROM ${USER_DATA.table} WHERE "user_id" = $1`, [userId]);
  if (!rows.length) return null;
  const user = rows[0];
  const results = await Promise.all(SECTIONS.map((s) => query(selectSql(s), [userId])));
  const sections = Object.fromEntries(SECTIONS.map((s, i) => [s.table, results[i].rows]));
  return { rev: user.rev, savedAt: user.saved_at, version: user.version, state: joinState(user, sections) };
}

/** { rev, savedAt }; savedAt is null when nothing is saved yet. */
export async function libraryRev(userId) {
  const { rows } = await query(`SELECT "rev", "saved_at" FROM ${USER_DATA.table} WHERE "user_id" = $1`, [userId]);
  return rows.length ? { rev: rows[0].rev, savedAt: rows[0].saved_at } : { rev: 0, savedAt: null };
}

/**
 * Saves a new state if `baseRev` is still the latest. Returns
 * { ok: true, rev, savedAt } or { ok: false, rev, savedAt } for a conflict.
 * `force` replaces whatever is saved (the account setup script's import).
 */
export async function saveLibrary(userId, { baseRev, version, state }, { force = false } = {}) {
  const { user, sections, hashes } = splitState(state);
  return transaction(async (db) => {
    const current = (
      await db.query(
        `SELECT "rev", "saved_at", "section_hashes" FROM ${USER_DATA.table} WHERE "user_id" = $1 FOR UPDATE`,
        [userId],
      )
    ).rows[0];
    const currentRev = current?.rev ?? 0;
    if (!force && currentRev !== baseRev) {
      return { ok: false, rev: currentRev, savedAt: current?.saved_at ?? null };
    }
    const rev = currentRev + 1;
    const savedAt = new Date().toISOString();
    const userCols = [...USER_DATA.columns.map((c) => c[0]), 'other_fields'];
    const values = [rev, version, savedAt, ...userCols.map((c) => user[c] ?? null), hashes];
    const all = ['rev', 'version', 'saved_at', ...userCols, 'section_hashes'];
    const inserted = await db.query(
      `INSERT INTO ${USER_DATA.table} ("user_id", ${all.map(q).join(', ')}) ` +
        `VALUES ($1, ${all.map((_, i) => `$${i + 2}`).join(', ')}) ` +
        `ON CONFLICT ("user_id") DO UPDATE SET ${all.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ')}` +
        (force ? '' : ` WHERE ${USER_DATA.table}."rev" = ${currentRev}`),
      [userId, ...values],
    );
    // Two first saves at once: the other one won.
    if (inserted.rowCount !== 1) return { ok: false, ...(await libraryRevWith(db, userId)) };

    const before = current?.section_hashes ?? {};
    for (const s of SECTIONS) {
      if (!(s.table in sections)) {
        // Saved in other_fields this time: clear the table.
        await db.query(`DELETE FROM ${s.table} WHERE "user_id" = $1`, [userId]);
        continue;
      }
      if (!force && before[s.table] === hashes[s.table]) continue; // Unchanged.
      await db.query(`DELETE FROM ${s.table} WHERE "user_id" = $1`, [userId]);
      if (sections[s.table].length) await db.query(insertSql(s), [userId, JSON.stringify(sections[s.table])]);
    }
    return { ok: true, rev, savedAt };
  });
}

async function libraryRevWith(db, userId) {
  const { rows } = await db.query(`SELECT "rev", "saved_at" FROM ${USER_DATA.table} WHERE "user_id" = $1`, [userId]);
  return rows.length ? { rev: rows[0].rev, savedAt: rows[0].saved_at } : { rev: 0, savedAt: null };
}
