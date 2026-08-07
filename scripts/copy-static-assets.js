const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const shardRoot = path.join(root, 'dict', 'shards');
const wordList = new Set();
for (const file of fs.readdirSync(shardRoot)) {
  if (!file.endsWith('.json')) continue;
  const shard = JSON.parse(fs.readFileSync(path.join(shardRoot, file), 'utf8'));
  Object.entries(shard).forEach(([key, value]) => wordList.add(String(value?.w || key).trim().toLowerCase()));
}
const generatedWordList = Array.from(wordList).filter(Boolean).sort((a, b) => a.localeCompare(b));
fs.mkdirSync(path.join(dist, 'dict'), { recursive: true });
fs.writeFileSync(path.join(dist, 'dict', 'word-list.json'), JSON.stringify({ source: 'bundled-collins', count: generatedWordList.length, words: generatedWordList }));
for (const name of ['dict', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'sw.js']) {
  const source = path.join(root, name);
  const target = path.join(dist, name);
  fs.cpSync(source, target, { recursive: true });
}
console.log('Copied offline assets to dist');
