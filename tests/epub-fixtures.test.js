const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEpubFixture, fixtureFiles } = require('./fixtures/epub-fixtures.js');
const { parseEpubBook } = require('../reader-epub-parser.js');

const root = path.resolve(__dirname, '..');

(async () => {
  for (const kind of ['epub3', 'ncx', 'damaged', 'rtl-vertical', 'fixed', 'large']) {
    const fixture = createEpubFixture(kind);
    const book = await parseEpubBook(fixture);
    assert(book.chapters.length >= 2, `${kind} should have readable chapters`);
    assert(book.chapters[0].text.includes(kind === 'large' ? 'large epub content' : '正文'), `${kind} should preserve chapter text`);
    assert(book.chapters[0].html.includes('script') === false, `${kind} should strip embedded scripts in the legacy parser`);
    assert.equal(book.toc.length, book.chapters.length);
    if (kind === 'ncx' || kind === 'damaged') assert.equal(book.chapters[0].title, '第 1 章');
    if (kind === 'damaged') assert(book.title.includes('Damaged'));
    if (kind === 'large') assert.equal(book.chapters.length, 80);
  }

  const broken = createEpubFixture('epub3').subarray(0, 32);
  await assert.rejects(() => parseEpubBook(broken), /EPUB ZIP 文件不完整|中央目录损坏/);

  const fixtureSource = fs.readFileSync(path.join(root, 'tests/fixtures/epub-fixtures.js'), 'utf8');
  assert(fixtureSource.includes('vertical-rl'));
  assert(fixtureSource.includes('rendition:layout'));
  assert(fixtureSource.includes('footnote'));
  assert(fixtureSource.includes('https://example.com'));
  assert(Object.keys(fixtureFiles('epub3')).some(name => /images\/pixel\.svg$/.test(name)));
  console.log('EPUB compatibility fixtures passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
