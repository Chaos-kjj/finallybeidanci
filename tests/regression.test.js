const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const aiClient = fs.readFileSync(path.join(root, 'src/ai/ai-client.js'), 'utf8');
const parser = require(path.join(root, 'reader-epub-parser.js'));
const cleaner = require(path.join(root, 'reader-text-cleaner.js'));
require(path.join(root, 'src/core/normalization.js'));
const learning = require(path.join(root, 'src/core/learning.js'));
const reader = require(path.join(root, 'src/reader/reader-engine.js'));

assert(index.includes('src/main.js'));
assert(index.includes('本机模式'));
assert(index.includes('reader-flow'));
assert(aiClient.includes('stream: false'));
assert(main.includes('仅在主动点击'));
assert.equal(typeof parser.parseEpubBook, 'function');
assert.equal(typeof cleaner.cleanImportedText, 'function');

const state = learning.normalizeState({
  allWords: [{ word: 'Alpha', status: 'known' }, { word: 'running', status: 'learning', srsLevel: 1 }],
  errata: { 阅读: ['Running', 'running', ''] }
});
assert.deepEqual(state.allWords.map(item => item.word), ['alpha', 'running']);
assert.deepEqual(state.knownWords, ['alpha']);
assert.deepEqual(state.errata, { 阅读: ['running'] });
assert.equal(learning.applyOutcome(state.allWords[1], 'known').status, 'known');

const cleaned = cleaner.cleanImportedText('Header\n\f\nHeader\n\f\nHeader\nChapter 1\nThis is a wrapped\nline.');
assert(!cleaned.includes('Header'));
assert(cleaned.includes('This is a wrapped line.'));

const pages = reader.paginateTextByViewport('one '.repeat(800), { width: 320, height: 400 }, { fontSize: 20, lineHeight: 1.6 });
assert(pages.pageCount > 1);
assert.equal(pages.pages[0].width, 320);
assert(!reader.paginateTextByViewport.toString().includes('1800'));

const filesToScan = [
  'index.html', 'src/main.js', 'sw.js', 'reader-epub-parser.js',
  'src/storage/local-store.js', 'src/ai/ai-client.js'
];
const forbiddenRuntime = [/supabase/i, /cdn\.jsdelivr\.net/i, /gist\.githubusercontent\.com/i, /dictionaryapi\.dev/i];
filesToScan.forEach(file => {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  forbiddenRuntime.forEach(pattern => assert(!pattern.test(text), `${file} contains runtime dependency ${pattern}`));
});

assert(!fs.existsSync(path.join(root, 'supabase-config.js')));
assert(!fs.existsSync(path.join(root, 'supabase-schema.sql')));
console.log('Regression checks passed');
