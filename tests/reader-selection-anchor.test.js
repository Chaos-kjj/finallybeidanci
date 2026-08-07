const assert = require('node:assert/strict');
const Reader = require('../src/reader/reader-engine.js');
const Storage = require('../src/storage/local-store.js');

const identity = { bookId: 'book-test', sourceFingerprint: 'fingerprint-test', documentFormat: 'epub' };
const chapterA = { text: 'Chapter A: alpha starts here.\nThe second line crosses a page.', spineIndex: 0, documentIndex: 0, href: 'text/a.xhtml' };
const chapterB = { text: 'Chapter B: beta continues after the chapter boundary.', spineIndex: 1, documentIndex: 1, href: 'text/b.xhtml' };
const chapters = [chapterA, chapterB];

const origin = Reader.createPosition(chapterB.text, 15, { ...identity, spineIndex: 1, documentIndex: 1, href: chapterB.href });
const focus = Reader.createPosition(chapterA.text, 11, { ...identity, spineIndex: 0, documentIndex: 0, href: chapterA.href });
const reverse = Reader.createSelection(origin, focus, identity);
assert.equal(Reader.comparePositions(reverse.start, reverse.end), -1);
assert.equal(reverse.origin.offset, 15);
assert.equal(reverse.focus.offset, 11);
assert.equal(Reader.extractRange(reverse, chapters, identity).text, 'alpha starts here.\nThe second line crosses a page.\n\nChapter B: beta');

const serialized = Reader.serializeSelection(reverse);
const parsed = Reader.parseSelection(serialized);
assert.equal(parsed.start.href, chapterA.href);
assert.equal(parsed.end.href, chapterB.href);
assert.throws(() => Reader.parseSelection(JSON.stringify({ ...parsed, schemaVersion: 99 })), /版本不兼容/);
assert.equal(Reader.recoverPosition(focus, chapterA.text.replace('second line', 'second  line'), identity).ok, true, 'whitespace reflow must recover');
assert.equal(Reader.recoverPosition(focus, 'unrelated text', identity).ok, false, 'failed context must not attach to an offset guess');
assert.equal(Reader.recoverPosition(focus, chapterA.text, { ...identity, sourceFingerprint: 'other' }).ok, false);

const pdfModels = [
  Reader.pdfTextModelFromItems([{ str: 'Page one begins' }, { str: 'with text' }], 1),
  Reader.pdfTextModelFromItems([{ str: 'Page two continues' }], 2),
  Reader.pdfTextModelFromItems([{ str: 'Page three ends' }], 3)
];
const pdfIdentity = { bookId: 'pdf-book', sourceFingerprint: 'pdf-fingerprint', documentFormat: 'pdf' };
const pdfStart = Reader.createPosition(pdfModels[0].text, 5, { ...pdfIdentity, pageNumber: 1, documentIndex: 0, itemIndex: 0, itemOffset: 5 });
const pdfEnd = Reader.createPosition(pdfModels[2].text, 10, { ...pdfIdentity, pageNumber: 3, documentIndex: 2, itemIndex: 0, itemOffset: 10 });
const pdfSelection = Reader.createSelection(pdfEnd, pdfStart, pdfIdentity);
const pdfExtracted = Reader.extractRange(pdfSelection, pdfModels.map((model, index) => ({ ...model, pageNumber: index + 1, documentIndex: index })), pdfIdentity);
assert.equal(pdfExtracted.ok, true);
assert.equal(pdfExtracted.text, 'one begins with text\n\nPage two continues\n\nPage three');
assert.equal(pdfModels[1].items[0].itemIndex, 0);
assert.equal(pdfModels[1].items[0].start, 0);
assert.deepEqual(Reader.parseCurrentPageRect([{ left: -2, top: 2, right: 18, bottom: 22, width: 20, height: 20 }], { pageRect: { left: 0, top: 0, width: 10, height: 10 } }), [{ left: 0, top: 2, right: 10, bottom: 10, width: 10, height: 8 }]);

const fakePdfjs = {
  getDocument() {
    return {
      promise: Promise.resolve({
        numPages: 3,
        getPage: async pageNumber => ({
          getTextContent: async () => ({ items: pageNumber === 2 ? [] : [{ str: `page ${pageNumber} text` }] }),
          cleanup() {}
        }),
        getOutline: async () => [],
        destroy() {}
      })
    };
  }
};
(async () => {
  const pdf = await new Reader.PdfEngine(new Uint8Array([1, 2, 3]), { pdfjsLib: fakePdfjs }).open();
  assert.equal((await pdf.getTextLayerStatus(2)).selectable, false);
  assert.match((await pdf.getTextLayerStatus(2)).message, /没有可选文本层/);
  const p1 = await pdf.createPdfPosition(1, 0);
  const p3 = await pdf.createPdfPosition(3, (await pdf.getTextPageModel(3)).text.length);
  const selected = pdf.createSelection(p3, p1, { selectedText: '' });
  const extracted = await pdf.extractSelectionText(selected);
  assert.equal(extracted.ok, true);
  assert.match(extracted.text, /page 1 text/);
  assert.match(extracted.text, /page 3/);
  await pdf.close();

  let advances = 0;
  let release;
  const controller = new Reader.ContinuousSelectionController({ edgeDelay: 80, edgeDebounce: 40, onAdvance: async () => { advances += 1; await new Promise(resolve => { release = resolve; }); } });
  controller.begin(Reader.createPosition('abcdef', 0, { format: 'text' }));
  controller.update(Reader.createPosition('abcdef', 2, { format: 'text' }));
  assert.equal(controller.scheduleEdge(1), true);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(advances, 1);
  assert.equal(controller.scheduleEdge(1), false, 'render lock blocks a second page turn');
  release();
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.cancel();

  const legacy = Storage.normalizeReaderAnnotation({ selectedText: 'old words', pageIndex: 4 }, { id: 'legacy-book' }, 'note');
  assert.equal(legacy.anchor, null, 'old notes remain display-only instead of guessing a new anchor');
  assert.equal(legacy.selectedText, 'old words');
  console.log('Stable reader selection checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
