// The database tables, and how the app's saved data maps onto them.
//
// The app saves its whole library as one object (see src/lib/store.ts). The
// server splits it into the tables below and puts it back together on load
// (server/library.mjs). Each table lists its columns as
//   [column, field in the app's object, type]
// where the field may be nested ("grades.bronze"). Anything the app saves that
// has no column here (a field added later, or a value of an unexpected type)
// is kept in the row's other_fields, so nothing is ever lost; give it a column
// here when it should be queryable.

/** Column types: Postgres type, and what a value must look like to go in. */
export const TYPES = {
  text: { sql: 'text', fits: (v) => typeof v === 'string' },
  int: { sql: 'integer', fits: (v) => Number.isInteger(v) && Math.abs(v) < 2 ** 31 },
  num: { sql: 'double precision', fits: (v) => typeof v === 'number' && Number.isFinite(v) },
  bool: { sql: 'boolean', fits: (v) => typeof v === 'boolean' },
  texts: { sql: 'text[]', fits: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string') },
  ts: {
    sql: 'timestamptz',
    fits: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)),
  },
  date: { sql: 'date', fits: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) },
};

/**
 * One row per user: the save revision and the single values. `keepNull`
 * columns give back null rather than leaving the field out.
 */
export const USER_DATA = {
  table: 'user_data',
  columns: [
    ['show_apps', 'showApps', 'bool'],
    ['achievements_sync', 'achievementsSync', 'ts'],
    ['history_since', 'history.since', 'ts'],
    ['history_recorded_at', 'history.recordedAt', 'ts'],
    ['avatar', 'profile.avatar', 'text'],
    ['favorite_genres', 'profile.favoriteGenres', 'texts'],
    ['favorite_franchises', 'profile.favoriteFranchises', 'texts'],
    ['vendors', 'vendors', 'texts'],
  ],
};

/**
 * Collections. Shapes:
 *   list       an array of objects (row order kept)
 *   map        { key: object }, the key in `key`
 *   map2       { key: { key2: object } } (achievements per game and platform)
 *   values     { key: number } or an array of strings, wrapped as { value }
 */
export const SECTIONS = [
  {
    table: 'games',
    path: 'customGames',
    shape: 'map',
    key: 'id',
    // Each game also carries its own id; it's the key, so it isn't stored twice.
    idField: 'id',
    columns: [
      ['title', 'title', 'text'],
      ['year', 'year', 'int'],
      ['developer', 'developer', 'text'],
      ['steam_app_id', 'steamAppId', 'int'],
      ['genres', 'genres', 'texts'],
      ['subgenres', 'subgenres', 'texts'],
      ['tags', 'tags', 'texts'],
      ['available_on', 'availableOn', 'texts'],
      ['blurb', 'blurb', 'text'],
      ['base_price', 'basePrice', 'num'],
      ['image_url', 'imageUrl', 'text'],
      ['custom', 'custom', 'bool'],
      ['kind', 'kind', 'text'],
      ['genre_source', 'genreSource', 'text'],
      ['nsuid', 'nsuid', 'text'],
      ['switch_versions', 'switchVersions', 'texts'],
      ['release_date', 'releaseDate', 'ts'],
      ['release_label', 'releaseLabel', 'text'],
      ['coming_soon', 'comingSoon', 'bool'],
    ],
  },
  {
    table: 'genre_overrides',
    path: 'genreOverrides',
    shape: 'map',
    key: 'game_id',
    columns: [
      ['genres', 'genres', 'texts'],
      ['subgenres', 'subgenres', 'texts'],
    ],
  },
  {
    table: 'game_details',
    path: 'details',
    shape: 'map',
    key: 'game_id',
    columns: [
      ['image_url', 'imageUrl', 'text'],
      ['release_date', 'releaseDate', 'ts'],
      ['release_label', 'releaseLabel', 'text'],
      ['coming_soon', 'comingSoon', 'bool'],
      ['checked_at', 'checkedAt', 'ts'],
      ['lookup_version', 'v', 'int'],
    ],
  },
  {
    table: 'play_entries',
    path: 'entries',
    shape: 'list',
    index: 'game_id',
    columns: [
      ['game_id', 'gameId', 'text'],
      ['platform', 'platform', 'text'],
      ['minutes', 'minutes', 'num'],
      ['last_played', 'lastPlayed', 'ts', { keepNull: true }],
      ['source', 'source', 'text'],
    ],
  },
  {
    table: 'progress',
    path: 'progress',
    shape: 'map',
    key: 'game_id',
    columns: [
      ['status', 'status', 'text'],
      ['rating', 'rating', 'int'],
      ['finished_at', 'finishedAt', 'date'],
    ],
  },
  {
    table: 'play_log',
    path: 'history.log',
    shape: 'list',
    index: 'game_id',
    columns: [
      ['day', 'date', 'date'],
      ['game_id', 'gameId', 'text'],
      ['minutes', 'minutes', 'num'],
    ],
  },
  {
    // Each game's total play time at the last recording, for working out the log.
    table: 'play_totals',
    path: 'history.base',
    shape: 'values',
    key: 'game_id',
    columns: [['minutes', 'value', 'num']],
  },
  {
    table: 'achievements',
    path: 'achievements',
    shape: 'map2',
    key: 'game_id',
    key2: 'platform',
    columns: [
      ['earned', 'earned', 'int'],
      ['total', 'total', 'int'],
      ['platinum', 'platinum', 'bool'],
      ['bronze', 'grades.bronze', 'int'],
      ['silver', 'grades.silver', 'int'],
      ['gold', 'grades.gold', 'int'],
      ['platinum_trophies', 'grades.platinum', 'int'],
      ['gamerscore', 'gamerscore', 'int'],
      ['total_gamerscore', 'totalGamerscore', 'int'],
      ['minutes_at', 'minutesAt', 'num'],
      ['checked_at', 'checkedAt', 'ts'],
    ],
  },
  {
    // HowLongToBeat; not_found = looked up, nothing there.
    table: 'game_lengths',
    path: 'lengths',
    shape: 'map',
    key: 'game_id',
    nullColumn: 'not_found',
    columns: [
      ['main_hours', 'main', 'num'],
      ['extra_hours', 'extra', 'num'],
      ['complete_hours', 'complete', 'num'],
      ['url', 'url', 'text'],
      ['checked_at', 'checkedAt', 'ts'],
    ],
  },
  {
    table: 'wishlist',
    path: 'wishlist',
    shape: 'list',
    index: 'game_id',
    columns: [
      ['game_id', 'gameId', 'text'],
      ['added_at', 'addedAt', 'ts'],
      ['target_price', 'targetPrice', 'num'],
      ['note', 'note', 'text'],
      ['source', 'source', 'text'],
    ],
  },
  {
    table: 'dismissed_games',
    path: 'dismissed',
    shape: 'values',
    columns: [['game_id', 'value', 'text']],
  },
  {
    table: 'physical_items',
    path: 'physical',
    shape: 'list',
    columns: [
      ['id', 'id', 'text'],
      ['game_id', 'gameId', 'text'],
      ['title', 'title', 'text'],
      ['platform', 'platform', 'text'],
      ['condition', 'condition', 'text'],
      ['edition', 'edition', 'text'],
      ['price_paid', 'pricePaid', 'num'],
      ['acquired_at', 'acquiredAt', 'date'],
      ['notes', 'notes', 'text'],
      ['added_at', 'addedAt', 'ts'],
    ],
  },
  {
    table: 'physical_wants',
    path: 'physicalWants',
    shape: 'list',
    columns: [
      ['id', 'id', 'text'],
      ['game_id', 'gameId', 'text'],
      ['title', 'title', 'text'],
      ['platform', 'platform', 'text'],
      ['max_price', 'maxPrice', 'num'],
      ['edition', 'edition', 'text'],
      ['notes', 'notes', 'text'],
      ['added_at', 'addedAt', 'ts'],
    ],
  },
  {
    table: 'platform_connections',
    path: 'connections',
    shape: 'map',
    key: 'platform',
    columns: [
      ['last_sync', 'lastSync', 'ts'],
      ['wishlist_sync', 'wishlistSync', 'ts'],
      ['game_count', 'count', 'int'],
      ['account', 'account', 'text'],
    ],
  },
  {
    table: 'chat_messages',
    path: 'chat',
    shape: 'list',
    columns: [
      ['role', 'role', 'text'],
      ['content', 'content', 'text'],
    ],
  },
];

const q = (name) => `"${name}"`;
const columnSql = ([name, , type]) => `${q(name)} ${TYPES[type].sql}`;

/** Key columns of a collection table, besides user_id. */
export function keyColumns(section) {
  if (section.shape === 'map2') return [section.key, section.key2];
  if (section.key) return [section.key];
  return [];
}

function sectionTable(s) {
  const keys = keyColumns(s);
  // Lists are keyed by their position; maps by their key (position keeps their order).
  const pk = keys.length ? keys : ['position'];
  const lines = [
    `"user_id" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE`,
    `"position" integer NOT NULL`,
    ...keys.map((k) => `${q(k)} text NOT NULL`),
    ...(s.nullColumn ? [`${q(s.nullColumn)} boolean NOT NULL DEFAULT false`] : []),
    ...s.columns.map(columnSql),
    `"other_fields" jsonb`,
    `PRIMARY KEY ("user_id", ${pk.map(q).join(', ')})`,
  ];
  const index = s.index
    ? `\nCREATE INDEX IF NOT EXISTS ${s.table}_${s.index} ON ${s.table} (user_id, ${q(s.index)});`
    : '';
  return `CREATE TABLE IF NOT EXISTS ${s.table} (\n  ${lines.join(',\n  ')}\n);${index}`;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "username" text NOT NULL,
  "password_hash" text,
  -- 'superadmin' (can use the super admin's own PlayStation, Xbox and alerts,
  -- and manage the invite code) or 'user'.
  "role" text NOT NULL DEFAULT 'user',
  "steam_id" text UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower("username"));
-- Databases from before roles had an is_owner flag instead.
ALTER TABLE users ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_owner') THEN
    UPDATE users SET "role" = 'superadmin' WHERE "is_owner";
    ALTER TABLE users DROP COLUMN "is_owner";
  END IF;
END $$;

-- Each account's own PlayStation and Xbox sign-ins (PlayStation refresh token,
-- OpenXBL key), encrypted (server/platformLogins.mjs).
CREATE TABLE IF NOT EXISTS platform_logins (
  "user_id" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "platform" text NOT NULL,
  "secret" text NOT NULL,
  "account_name" text,
  "expires_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "platform")
);

-- Price alerts: each account's ntfy topic, and the games it watches with
-- their target prices (server/alerts.mjs).
CREATE TABLE IF NOT EXISTS alert_topics (
  "user_id" integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  "topic" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS price_alerts (
  "user_id" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "game_id" text NOT NULL,
  "title" text NOT NULL,
  "steam_app_id" integer,
  "nsuid" text,
  "pc" boolean NOT NULL DEFAULT false,
  "switch" boolean NOT NULL DEFAULT false,
  "target" double precision NOT NULL,
  -- The price last notified about, so the same drop isn't sent twice.
  "last_sent_price" double precision,
  PRIMARY KEY ("user_id", "game_id")
);

-- Administration (server/admin.mjs): disabled accounts, when each was last
-- active, and a session version that a password reset bumps (logging out every
-- session from before). Reset links store only a hash of their token.
ALTER TABLE users ADD COLUMN IF NOT EXISTS "disabled_at" timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "session_version" integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS password_resets (
  "token_hash" text PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Free game and big deal alerts (server/dealAlerts.mjs): each account's
-- choices, and what was already sent so nothing is sent twice.
CREATE TABLE IF NOT EXISTS deal_alert_settings (
  "user_id" integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  "data" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS deal_alerts_sent (
  "user_id" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "item_key" text NOT NULL,
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "item_key")
);

-- Game keys sent to friends (server/gifts.mjs). "secret" is the key,
-- encrypted like platform_logins.secret.
CREATE TABLE IF NOT EXISTS gifts (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "from_id" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "to_id" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "title" text NOT NULL,
  "platform" text NOT NULL,
  "secret" text NOT NULL,
  "message" text,
  "game_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "opened_at" timestamptz,
  "redeemed_at" timestamptz
);
CREATE INDEX IF NOT EXISTS gifts_to ON gifts ("to_id");
CREATE INDEX IF NOT EXISTS gifts_from ON gifts ("from_id");

-- PlayStation's internal account id, for looking up its online status.
ALTER TABLE platform_logins ADD COLUMN IF NOT EXISTS "account_id" text;

-- Friends (server/friends.mjs). A request is a row from requester to
-- addressee; accepting it makes them friends both ways.
ALTER TABLE users ADD COLUMN IF NOT EXISTS "friend_code" text UNIQUE;
CREATE TABLE IF NOT EXISTS friendships (
  "requester_id" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "addressee_id" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "accepted_at" timestamptz,
  PRIMARY KEY ("requester_id", "addressee_id"),
  CHECK ("requester_id" <> "addressee_id")
);
CREATE INDEX IF NOT EXISTS friendships_addressee ON friendships ("addressee_id");

-- What friends see of an account: level, rank, picture, favourites, top games,
-- hours and wishlist, as the app worked them out (sent whenever they change).
CREATE TABLE IF NOT EXISTS public_profiles (
  "user_id" integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  "data" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Game-specific stats (server/ffxiv.mjs): one connected account or character
-- per game, with what was last read for it.
CREATE TABLE IF NOT EXISTS game_connections (
  "user_id" integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "game" text NOT NULL,
  "external_id" text NOT NULL,
  "name" text,
  "data" jsonb,
  "fetched_at" timestamptz,
  PRIMARY KEY ("user_id", "game")
);
-- An API key for the game, when it needs one (Guild Wars 2), encrypted like
-- platform_logins.secret.
ALTER TABLE game_connections ADD COLUMN IF NOT EXISTS "secret" text;

-- App-wide settings, such as the invite code for sign-up.
CREATE TABLE IF NOT EXISTS app_settings (
  "key" text PRIMARY KEY,
  "value" text NOT NULL
);

CREATE TABLE IF NOT EXISTS ${USER_DATA.table} (
  "user_id" integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  "rev" integer NOT NULL,
  "version" integer NOT NULL,
  "saved_at" timestamptz NOT NULL,
  ${USER_DATA.columns.map(columnSql).join(',\n  ')},
  "other_fields" jsonb,
  "section_hashes" jsonb
);

${SECTIONS.map(sectionTable).join('\n\n')}
`;
