const assert = require('node:assert/strict');
const { zipSync } = require('fflate');
require('../src/core/normalization.js');
require('../src/ai/prompt-template.js');
const { TextEngine, PdfEngine, markdownToHtml } = require('../src/reader/reader-engine.js');
const { parseEpubBook } = require('../reader-epub-parser.js');
const security = require('../src/core/sanitize-html.js');
const { ActiveTimeTracker, recordEvent, trend } = require('../src/core/study-stats.js');
const { AiClient } = require('../src/ai/ai-client.js');
const { defaultActions } = require('../src/ai/prompt-template.js');
const backup = require('../src/storage/backup.js');
const { StarDictProvider } = require('../src/dictionary/stardict-provider.js');
const { PROFILES, EinkRenderScheduler } = require('../src/eink/profile.js');
const { HardwareKeyService } = require('../src/eink/hardware-key-service.js');

function bytes(value) { return new TextEncoder().encode(value); }

function makeComplexEpub() {
  const cover = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return zipSync({
    'META-INF/container.xml': bytes('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OPS/package.opf': bytes('<package version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Complex</dc:title><dc:creator>Author</dc:creator><meta name="cover" content="cover-img"/></metadata><manifest><item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="inline-img" href="images/inline.png" media-type="image/png"/><item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>'),
    'OPS/images/cover.png': cover,
    'OPS/images/inline.png': cover,
    'OPS/text/one.xhtml': bytes('<html><body><h1 id="start">One</h1><p>First chapter with a footnote<a href="two.xhtml#foot">[1]</a>.</p><p><img src="../images/inline.png" alt="inline"/></p></body></html>'),
    'OPS/text/two.xhtml': bytes('<html><body><h1>Two</h1><p>Second chapter has the target.</p><aside id="foot">Footnote text</aside></body></html>'),
    'OPS/nav.xhtml': bytes('<nav epub:type="toc"><ol><li><a href="text/one.xhtml#start">Part One</a><ol><li><a href="text/two.xhtml">Part Two</a></li></ol></li></ol></nav>')
  });
}

async function testReaderCoverage() {
  const text = await new TextEngine({ text: 'Paragraph one.\n\nParagraph two target.\n\nParagraph three.', type: 'text', title: 'Text' }).open();
  const chapter = await text.getChapter(0);
  assert.equal(text.paragraphs.length, 3);
  assert.equal((await text.search('target'))[0].paragraphIndex, 1);
  assert.match(chapter.html, /data-paragraph-index="2"/);
  const markdown = markdownToHtml('# Heading\n\n**bold** paragraph\n\n- one\n- two');
  assert.match(markdown, /<h1/);
  assert.match(markdown, /<strong>bold<\/strong>/);
  assert.match(markdown, /<li>two<\/li>/);
  assert.match(security.sanitizeHtml('<audio controls src="data:audio/mpeg;base64,YQ=="></audio>'), /<audio/);
  const html = await new TextEngine({ html: '<p>HTML first</p><p>HTML target</p>', type: 'html' }).open();
  assert.equal((await html.search('target'))[0].paragraphIndex, 1, 'HTML without a separately supplied text field must remain searchable');

  const epub = await parseEpubBook(makeComplexEpub());
  assert.equal(epub.chapters.length, 2);
  assert.equal(epub.toc[0].children.length, 1);
  assert.match(epub.chapters[0].html, /data:image\/png;base64/);
  assert.match(epub.chapters[0].html, /#epub-chapter-1-foot/);
  assert.match(epub.cover.dataUrl, /^data:image\/png;base64/);
  const epubEngine = await new (require('../src/reader/reader-engine.js').EpubEngine)(makeComplexEpub()).open();
  assert.equal((await epubEngine.search('target'))[0].matchText, 'target');
}

async function testPdfLazyPagesAndSearch() {
  const requested = [];
  const pages = ['page one', 'page two', 'page three target', 'page four'];
  const fakePdf = {
    numPages: pages.length,
    async getOutline() { return [{ title: 'Three', dest: [2], items: [] }]; },
    async getPageIndex(ref) { return ref; },
    async getPage(number) {
      requested.push(number);
      return {
        async getTextContent() { return { items: [{ str: pages[number - 1], transform: [1, 0, 0, 1, 0, 10] }] }; },
        cleanup() {},
        getViewport({ scale }) { return { width: 100 * scale, height: 100 * scale, scale, transform: [scale, 0, 0, scale, 0, 0] }; },
        render() { return { promise: Promise.resolve() }; }
      };
    },
    destroy() {}
  };
  const engine = await new PdfEngine(new Uint8Array([1]), { pdfjsLib: { getDocument: () => ({ promise: Promise.resolve(fakePdf) }) }, maxTextCache: 2, maxPageCache: 2 }).open();
  assert.deepEqual(requested, [1], 'open probes one page only');
  const results = await engine.search('target');
  assert.equal(results[0].pageNumber, 3);
  assert.equal((await engine.getToc())[0].pageNumber, 3);
  assert.ok(engine.textCache.size <= engine.maxTextCache);
  assert.ok(engine.pageCache.size <= engine.maxPageCache);
  await engine.close();
}

function testStudyTimingAndTrend() {
  const tracker = new ActiveTimeTracker({ idleMs: 60000, maxGapMs: 30000 });
  tracker.touch(0);
  assert.equal(tracker.tick({ when: 15000 }), 0.25);
  assert.equal(tracker.tick({ when: 30000 }), 0.25);
  assert.equal(tracker.tick({ when: 90000, visible: false }), 0);
  tracker.touch(105000);
  assert.equal(tracker.tick({ when: 105000 }), 0.25);
  let stats = recordEvent({}, { minutes: 0.25, section: 'reader' }, new Date('2026-08-01T12:00:00Z'));
  assert.equal(stats.daily['2026-08-01'].readerMinutes, 0.25);
  assert.equal(trend(stats, 7, new Date('2026-08-01T12:00:00Z')).length, 7);
}

async function testCacheAndBackupSafety() {
  let calls = 0;
  const cache = new Map();
  const client = new AiClient({
    config: { baseUrl: 'https://api.example.test/v1/chat/completions', model: 'model-a' },
    cache: { get: key => cache.get(key), put: (key, value) => { cache.set(key, value); } },
    nativeBridge: { request: async () => { calls += 1; return { status: 200, body: { choices: [{ message: { content: 'cached answer' } }] } }; } }
  });
  const action = defaultActions()[1];
  await client.request(action, { selection: 'one' });
  const hit = await client.request(action, { selection: 'one' });
  assert.equal(calls, 1);
  assert.equal(hit.cached, true);
  client.setConfig({ baseUrl: 'https://other.example.test/v1/chat/completions' });
  await client.request(action, { selection: 'one' });
  assert.equal(calls, 2, 'cache is isolated by provider URL');

  const currentBlob = new Blob(['local book']);
  const dataOnly = backup.buildBackupPayload({ books: [{ id: 'book', title: 'Backup', blob: new Blob(['backup']), text: 'private text' }], includeFiles: false });
  const merged = backup.mergeBookRecord({ id: 'book', blob: currentBlob, text: 'local text' }, dataOnly.books[0], { complete: false, now: 123 });
  assert.equal(await merged.blob.text(), 'local book');
  assert.equal(merged.text, 'local text');
  const complete = backup.buildBackupPayload({ includeFiles: true, books: [{ id: 'book', title: 'Backup', fileData: 'YmFja3Vw', mime: 'text/plain' }], files: [{ id: 'font-custom', role: 'font', mime: 'font/ttf', data: 'Zm9udA==' }], dictionaryFiles: [{ id: 'd:idx', dictionaryId: 'd', role: 'idx', mime: 'application/octet-stream', data: 'aWR4' }] });
  const decoded = await backup.decodeBackup(await backup.encodeBackup(complete));
  assert.equal(decoded.dictionaryFiles[0].dictionaryId, 'd');
  assert.equal(decoded.dictionaryFiles[0].role, 'idx');
  assert.equal(decoded.dictionaryFiles[0].data, 'aWR4');
  assert.equal(decoded.files[0].id, 'font-custom');
  assert.equal(await backup.mergeBookRecord(null, decoded.books[0], { complete: true, decodeFile: value => new Blob([Buffer.from(value, 'base64')]) }).blob.text(), 'backup');
  const mergedFile = backup.mergeFileRecord(null, decoded.dictionaryFiles[0], { complete: true, decodeFile: value => Buffer.from(value, 'base64') });
  assert.equal(mergedFile.dictionaryId, 'd');
  assert.equal(mergedFile.role, 'idx');
  assert.equal(mergedFile.data.toString(), 'idx');
  assert.throws(() => backup.validateBackupPayload({ ...dataOnly, version: 99 }), /版本/);
  await assert.rejects(() => backup.decodeBackup(new Uint8Array([1, 2, 3]), require('fflate').unzipSync), /备份 ZIP 损坏/);
}

function testStarDict64SameType() {
  const definition = bytes('<b>sixty-four</b>');
  const pronunciation = bytes('/s/');
  const raw = new Uint8Array(definition.length + 1 + pronunciation.length);
  raw.set(definition); raw[definition.length] = 0; raw.set(pronunciation, definition.length + 1);
  const word = bytes('sixty');
  const idx = new Uint8Array(word.length + 1 + 8 + 4);
  idx.set(word); idx[word.length] = 0;
  const view = new DataView(idx.buffer); view.setBigUint64(word.length + 1, 0n); view.setUint32(word.length + 9, raw.length);
  const provider = new StarDictProvider({ metadata: { id: '64', name: '64-bit' }, ifo: new Blob(['wordcount=1\nidxoffsetbits=64\nsametypesequence=mx']), idx, dict: raw });
  return provider.lookup('SIXTY').then(result => {
    assert.equal(result[0].headword, 'sixty');
    assert.equal(result[0].pronunciation, '/s/');
    assert.match(result[0].html, /sixty-four/);
  });
}

async function testEinkSchedulerProfiles() {
  assert.notEqual(PROFILES.fast.progressDebounceMs, PROFILES.quality.progressDebounceMs);
  assert.equal(PROFILES.fast.prefetchPages, 0);
  assert.ok(PROFILES.quality.prefetchPages > PROFILES.balanced.prefetchPages);
  assert.equal(PROFILES.quality.updateMode, 'full');
  const timers = [];
  const scheduler = new EinkRenderScheduler('fast', { setTimeoutRef: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeoutRef: () => {} });
  const pending = scheduler.schedule(() => 'rendered', { key: 'page-1' });
  assert.equal(timers[0].delay, PROFILES.fast.progressDebounceMs);
  await timers[0].fn();
  assert.deepEqual(await pending, { result: 'rendered', skipped: false, refresh: 'partial' });
}

function testHardwareBackBoundary() {
  let action = '';
  const service = new HardwareKeyService({ documentRef: null, mapping: { next: [], previous: [], menu: [], back: [] }, onKey: value => { action = value; } });
  service.handleNativeKey({ keyCode: 4 });
  assert.equal(action, 'back', 'Android system Back remains layered even when editable mappings omit code 4');
}

(async () => {
  await testReaderCoverage();
  await testPdfLazyPagesAndSearch();
  testStudyTimingAndTrend();
  await testCacheAndBackupSafety();
  await testStarDict64SameType();
  await testEinkSchedulerProfiles();
  testHardwareBackBoundary();
  console.log('Release integration checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
