// Run: node tests/secrets.test.js
// Fails if anything shaped like a real GitHub token is in the files git tracks (this repo is public).
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const PATTERNS = [
  /github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}/, // fine-grained personal access token
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,             // classic / OAuth / app tokens
];

let files;
try {
  files = execSync('git ls-files -co --exclude-standard', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
} catch (e) {
  console.log('  skip (not a git checkout)');
  process.exit(0);
}

const hits = [];
for (const f of files) {
  let text;
  try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
  for (const re of PATTERNS) if (re.test(text)) hits.push(f);
}

console.log('secrets');
if (hits.length) {
  console.log('  FAIL token-like string found in: ' + [...new Set(hits)].join(', '));
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}
console.log(`  ok   no GitHub tokens in ${files.length} tracked files`);
console.log('\n1 passed, 0 failed');
