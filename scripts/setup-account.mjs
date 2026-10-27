// npm run setup-account
//
// Creates a Savepoint account, or sets a new password for an existing one
// (there's no "forgot password" email). Uses DATABASE_URL from .env.
import { stdin, stdout } from 'node:process';
import readline from 'node:readline';
import { createAccount, ROLES, usernameProblem } from '../server/accounts.mjs';
import { closeDb, dbConfigured, query } from '../server/db.mjs';
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
  for (;;) {
    username = await ask('Savepoint username: ');
    const problem = usernameProblem(username);
    if (!problem) break;
    console.log(problem);
  }
  const existing = (
    await query('SELECT "id", "username", "role" FROM users WHERE lower("username") = lower($1)', [username])
  ).rows[0];
  if (existing) {
    console.log(`The account "${existing.username}" already exists.`);
    if (await yes('Set a new password for it?')) {
      await query('UPDATE users SET "password_hash" = $2 WHERE "id" = $1', [existing.id, await newPassword()]);
      console.log('Password changed.');
    }
    return existing;
  }
  const hasSuperAdmin =
    (await query('SELECT 1 FROM users WHERE "role" = $1 LIMIT 1', [ROLES.superAdmin])).rows.length > 0;
  const superAdmin =
    !hasSuperAdmin ||
    (await yes('Make it a super admin (can use your PlayStation, Xbox and alerts, and change the invite code)?'));
  const hash = await newPassword();
  const created = await createAccount(username, hash, superAdmin ? ROLES.superAdmin : ROLES.user);
  console.log(`Created "${created.username}"${superAdmin ? ', a super admin' : ''}.`);
  return created;
}

try {
  if (!dbConfigured()) throw new Error('Add DATABASE_URL to .env first.');
  console.log('Connecting to the database...');
  await query('SELECT 1');
  await account();
  console.log('Done. Log in to Savepoint with this username and password.');
} catch (err) {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
  await closeDb();
}
