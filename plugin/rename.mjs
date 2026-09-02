// Rewrites bare identifier references X → state.X in src/main.js, skipping
// matches inside single/double/backtick quotes. Run with:
//   node rename.mjs name1 name2 name3 ...
// then `node build.mjs` to verify.

import { readFileSync, writeFileSync } from 'node:fs';

const names = process.argv.slice(2);
if (!names.length) { console.error('no names'); process.exit(1); }

const path = new URL('./src/main.js', import.meta.url);
let src = readFileSync(path, 'utf8');

for (const n of names) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) { console.error('bad name', n); process.exit(1); }
  const re = new RegExp(`(?<!['"\`.])\\b${n}\\b(?!['"\`:])`, 'g');
  const before = src;
  src = src.replace(re, `state.${n}`);
  const count = (before.match(re) || []).length;
  console.log(`${n}: ${count} replacements`);
}

// Collapse "let state.X =" → "state.X =" so prior declarations become assignments.
src = src.replace(/\blet state\.([A-Za-z_][A-Za-z0-9_]*)\b/g, 'state.$1');

// Bail-out checks: catch shadow-rename failures before they reach esbuild.
const shadows = [...src.matchAll(/\b(const|let|var)\s+state\.([A-Za-z_][A-Za-z0-9_]*)/g)];
if (shadows.length) {
  console.error('LOCAL SHADOW collisions — rename the local first:');
  for (const m of shadows) console.error('  ' + m[0]);
  process.exit(2);
}
const shorthand = [...src.matchAll(/^\s*state\.([A-Za-z_][A-Za-z0-9_]*)\s*,\s*$/gm)];
if (shorthand.length) {
  console.error('OBJECT-SHORTHAND breakage — expand "X," to "X: state.X,":');
  for (const m of shorthand) console.error('  ' + m[0].trim());
  process.exit(2);
}
// `state.X:` with no space before colon is almost certainly an object key.
const propKeys = [...src.matchAll(/\bstate\.([A-Za-z_][A-Za-z0-9_]*):/g)];
if (propKeys.length) {
  console.error('PROPERTY-KEY breakage — keep "X:" or rewrite to "[state.X]:":');
  for (const m of propKeys) console.error('  ' + m[0]);
  process.exit(2);
}

writeFileSync(path, src);
