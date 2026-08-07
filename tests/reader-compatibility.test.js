const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { zipSync, unzipSync } = require('fflate');

require('../src/core/normalization.js');
const learning = require('../src/core/learning.js');
const backup = require('../src/storage/backup.js');
const locator = require('../src/reader/reader-locator.js');
const reader = require('../src/reader/reader-engine.js');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const keyEvents = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/kangkang/beidanci/MainActivity.java'), 'utf8');
const readerEngine = fs.readFileSync(path.join(root, 'src/reader/reader-engine.js'), 'utf8');

(async () => {
const cfi = 'epubcfi(/6/2[chapter-1]!/4/1:0)';
const nextLocator = locator.buildEpubLocator({ cfi, href: 'chapter-1.xhtml', fraction: 0.25, sectionIndex: 0 });
assert.deepEqual(locator.restoreCandidates({ locator: nextLocator, chapterIndex: 4, pageIndex: 3 }).map(item => item.kind), ['cfi', 'href', 'legacy', 'start']);
assert.deepEqual(locator.restoreCandidates({ cfi, chapterIndex: 4 }).slice(0, 2).map(item => item.kind), ['cfi', 'href']);
assert.equal(locator.restoreCandidates({ chapterIndex: 4, pageIndex: 3 })[0].kind, 'legacy');
assert.equal(locator.normalizeLocator({ value: 'not-a-cfi' }), null);
const merged = locator.mergeProgress({ chapterIndex: 1, pageIndex: 2, percent: 40 }, { locator: nextLocator, cfi, href: 'chapter-1.xhtml' });
assert.equal(merged.chapterIndex, 1);
assert.equal(merged.pageIndex, 2);
assert.equal(merged.locator.value, cfi);

const oldBook = {
  id: 'old-book',
  title: '旧书',
  progress: { chapterIndex: 2, pageIndex: 4, pageCount: 8, percent: 32 },
  bookmarks: [{ id: 'b1', chapterIndex: 2, pageIndex: 4, text: '旧书签' }],
  notes: [{ id: 'n1', chapterIndex: 2, pageIndex: 4, text: '旧笔记' }]
};
const newBook = {
  id: 'new-book',
  title: '新书',
  progress: { chapterIndex: 0, pageIndex: 0, pageCount: 1, percent: 25, locator: nextLocator, cfi, href: 'chapter-1.xhtml' },
  bookmarks: [{ id: 'b2', chapterIndex: 0, pageIndex: 0, text: '新书签', locator: nextLocator, cfi, href: 'chapter-1.xhtml' }],
  notes: [{ id: 'n2', chapterIndex: 0, pageIndex: 0, text: '新笔记', locator: nextLocator, cfi, href: 'chapter-1.xhtml' }]
};
const payload = backup.buildBackupPayload({ state: { allWords: [learning.createWordRecord('alpha')] }, books: [oldBook, newBook] });
assert.equal(payload.books[0].progress.locator, undefined, '旧备份记录应保持无新增定位字段');
assert.equal(payload.books[1].progress.locator.value, cfi);
const encoded = await backup.encodeBackup(payload, zipSync);
const restored = await backup.decodeBackup(encoded, unzipSync);
  assert.equal(restored.books.length, 2);
  assert.equal(restored.books[0].progress.pageIndex, 4);
  assert.equal(restored.books[1].bookmarks[0].locator.value, cfi);
  assert.equal(restored.books[1].notes[0].href, 'chapter-1.xhtml');

assert(main.includes("import './reader/reader-locator.js'"));
assert(main.includes('createEpubEngine'));
assert(main.includes('registerPlugin(\'NativeTts\')'));
assert(main.includes('dictionaryManager.lookup'));
assert(main.includes('addBookmark'));
assert(main.includes('addNoteFromCurrentSelection'));
assert(main.includes('advanceReader'));
assert(main.includes("page === 'reader'"));
assert(keyEvents.includes('isReaderMode'));
assert(keyEvents.includes('dispatchKeyEvent'));
assert(readerEngine.includes('class PdfEngine') || readerEngine.includes('PdfEngine'));
assert(readerEngine.includes('class TextEngine') || readerEngine.includes('TextEngine'));
assert(main.includes("endsWith('.html')") && main.includes("type === 'html' ? Security.stripHtmlToText"));

const textEngine = await new reader.TextEngine('markdown\n\ncontent', { title: 'MD' }).open();
assert.equal((await textEngine.getChapter(0)).text, 'markdown');
assert.equal((await textEngine.getChapter(1)).text, 'content');
const fakePdf = {
  getDocument: () => ({ promise: Promise.resolve({
    numPages: 1,
    getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'pdf text' }] }), cleanup() {} }),
    destroy() {}
  }) })
};
const pdfEngine = await new reader.PdfEngine(new Uint8Array([1]), { pdfjsLib: fakePdf }).open();
assert.equal(pdfEngine.pageCount, 1);
assert.equal(pdfEngine.metadata.hasText, true);
await pdfEngine.close();

const upstreamMarker = fs.readFileSync(path.join(root, 'vendor/foliate-js/UPSTREAM_COMMIT'), 'utf8').trim();
assert.equal(upstreamMarker, locator.FOLIATE_REVISION);
assert(fs.existsSync(path.join(root, 'vendor/foliate-js/view.js')));
assert(fs.existsSync(path.join(root, 'vendor/foliate-js/epub.js')));
assert(fs.existsSync(path.join(root, 'vendor/foliate-js/paginator.js')));

console.log('Reader compatibility, locator, backup, and hardware contracts passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
