// node scripts/badge-icons.mjs
//
// Copies the game-icons.net icons that badges use (every gi('…') in
// src/lib/badges.ts) from @iconify-json/game-icons into
// src/data/badgeIcons.json, so the app ships only those, not all 4,000.
// Icons by Lorc, Delapouite and contributors, CC BY 3.0 (credited on the
// Badges page).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const set = require('@iconify-json/game-icons/icons.json');
const source = readFileSync(new URL('../src/lib/badges.ts', import.meta.url), 'utf8');
const names = [...new Set([...source.matchAll(/gi\('([a-z0-9-]+)'\)/g)].map((m) => m[1]))].sort();

const icons = {};
const missing = [];
for (const name of names) {
  const icon = set.icons[name] ?? set.icons[set.aliases?.[name]?.parent];
  if (icon) icons[name] = icon.body;
  else missing.push(name);
}
if (missing.length) {
  console.error(`Not in game-icons: ${missing.join(', ')}`);
  process.exit(1);
}
const out = { size: set.width ?? 512, icons };
writeFileSync(new URL('../src/data/badgeIcons.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`${names.length} icons written to src/data/badgeIcons.json`);
