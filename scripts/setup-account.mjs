// npm run setup-account
//
// Creates a Savepoint account (or sets a new password for an existing one),
// and can copy a library saved in VerBuddy, where Savepoint used to keep its
// data, into that account. Uses DATABASE_URL from .env.
import { stdin, stdout } from 'node:process';
import readline from 'node:readline';
import { closeDb, dbConfigured, query } from '../server/db.mjs';
import { loadLibrary, saveLibrary } from '../server/library.mjs';
import { hashPassword, passwordProblem } from '../server/passwords.mjs';

const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
// While a password is typed, readline shows asterisks instead of the letters.
let secretPrompt = null;
const write = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => {
  if (secretPrompt === null) return write(s);
  if (/[\r\n]/.test(s)) return write('\r\n');
  if (s.startsWith(secretPrompt)) return write(secretPrompt + '*'.repeat(rl.line.length));
  write('*'.repeat(s.length));
};

const ask = (question) => new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
const askSecret = async (question) => {
  const answer = new Promise((resolve) => rl.question(question, resolve));
  secretPrompt = question;
  try {
    return await answer;
  } finally {
    secretPrompt = null;
  }
};
const yes = async (question) => /^y(es)?$/i.test(await ask(`${question} (y/N) `));

async function newPassword() {
  for (;;) {
    const password = await askSecret('Password: ');
    const problem = passwordProblem(password);
    if (problem) {
      console.log(problem);
      continue;
    }
    if ((await askSecret('Password again: ')) !== password) {
      console.log("They don't match. Try again.");
      continue;
    }
    return hashPassword(password);
  }
}

async function account() {
  let username = '';
  while (!/^[\w.-]{2,40}$/.test(username)) {
    username = await ask('Savepoint username: ');
    if (!/^[\w.-]{2,40}$/.test(username)) console.log('Use 2-40 letters, digits, dots, dashes or underscores.');
  }
  const existing = (
    await query('SELECT "id", "username", "is_owner" FROM users WHERE lower("username") = lower($1)', [username])
  ).rows[0];
  if (existing) {
    console.log(`The account "${existing.username}" already exists.`);
    if (await yes('Set a new password for it?')) {
      await query('UPDATE users SET "password_hash" = $2 WHERE "id" = $1', [existing.id, await newPassword()]);
      console.log('Password changed.');
    }
    return existing;
  }
  const hasOwner = (await query('SELECT 1 FROM users WHERE "is_owner" LIMIT 1')).rows.length > 0;
  const owner =
    !hasOwner || (await yes("Make it an owner account (can use the owner's PlayStation, Xbox and alerts)?"));
  const hash = await newPassword();
  const created = (
    await query(
      'INSERT INTO users ("username", "password_hash", "is_owner") VALUES ($1, $2, $3) RETURNING "id", "username", "is_owner"',
      [username, hash, owner],
    )
  ).rows[0];
  console.log(`Created "${created.username}"${owner ? ', the owner account' : ''}.`);
  return created;
}

async function fromVerBuddy(user) {
  let url = (process.env.VERBUDDY_API_URL ?? '').trim();
  url = (await ask(`VerBuddy's backend address${url ? ` [${url}]` : ''}: `)) || url;
  url = url.replace(/\/+$/, '');
  const name = await ask('VerBuddy username: ');
  const password = await askSecret('VerBuddy password: ');
  console.log('Logging in to VerBuddy (it may need half a minute to wake up)...');
  const login = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!login.ok) throw new Error(`VerBuddy refused the login (${login.status}).`);
  const { token } = await login.json();
  const r = await fetch(`${url}/api/savepoint/state`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (r.status === 404) {
    console.log('VerBuddy has no Savepoint library for that account. Nothing copied.');
    return;
  }
  if (!r.ok) throw new Error(`VerBuddy answered ${r.status}.`);
  const saved = await r.json();

  const current = await loadLibrary(user.id);
  if (
    current &&
    !(await yes(`"${user.username}" already has a library in the database. Replace it with VerBuddy's?`))
  ) {
    console.log('Nothing copied.');
    return;
  }
  const result = await saveLibrary(
    user.id,
    { baseRev: 0, version: saved.version, state: saved.state },
    { force: true },
  );
  const s = saved.state;
  console.log(
    `Copied: ${s.entries?.length ?? 0} play entries, ${Object.keys(s.customGames ?? {}).length} games, ` +
      `${s.wishlist?.length ?? 0} wishlist items, ${s.physical?.length ?? 0} physical copies (saved as rev ${result.rev}).`,
  );
  // Check it reads back the same.
  const back = await loadLibrary(user.id);
  if (back.state.entries.length !== (s.entries?.length ?? 0))
    throw new Error('The copy reads back differently. Run it again.');
}

try {
  if (!dbConfigured()) throw new Error('Add DATABASE_URL to .env first.');
  console.log('Connecting to the database...');
  await query('SELECT 1');
  const user = await account();
  if (await yes('Copy your library from VerBuddy into this account?')) await fromVerBuddy(user);
  console.log('Done. Log in to Savepoint with this username and password.');
} catch (err) {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
  await closeDb();
}
