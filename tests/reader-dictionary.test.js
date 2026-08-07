const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { zipSync } = require('fflate');
const { parseEpubBook } = require('../reader-epub-parser.js');
require('../src/core/normalization.js');
const security = require('../src/core/sanitize-html.js');
const reader = require('../src/reader/reader-engine.js');
const { StarDictProvider, parseIdx } = require('../src/dictionary/stardict-provider.js');
const { MdxProvider } = require('../src/dictionary/mdx-provider.js');
const { BuiltinDictionaryProvider, DictionaryManager } = require('../src/dictionary/dictionary-provider.js');
const { DictionaryImportService } = require('../src/dictionary/import-service.js');
const { LocalStore, MemoryBackend } = require('../src/storage/local-store.js');
globalThis.parseEpubBook = parseEpubBook;

(async () => {
  const epub = zipSync({
    'META-INF/container.xml': new TextEncoder().encode('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': new TextEncoder().encode('<package><metadata><dc:title>Test Book</dc:title><dc:creator>A. Author</dc:creator></metadata><manifest><item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/></spine></package>'),
    'OEBPS/chapter.xhtml': new TextEncoder().encode('<html><body><h1>Chapter One</h1><p>Hello <strong>world</strong>.</p><script>evil()</script><a href="javascript:alert(1)">bad</a></body></html>'),
    'OEBPS/nav.xhtml': new TextEncoder().encode('<nav><ol><li><a href="chapter.xhtml">Chapter One</a></li></ol></nav>')
  });
  const book = await parseEpubBook(epub);
  assert.equal(book.title, 'Test Book');
  assert.equal(book.chapters.length, 1);
  assert.equal(book.chapters[0].html, '', 'EPUB parser should keep chapter markup lazy');
  const parsedChapter = await book.loadChapterHtml(0);
  assert(parsedChapter.includes('Hello'));
  assert(!parsedChapter.includes('<script'));
  assert(!parsedChapter.includes('javascript:'));
  const engine = await new reader.EpubEngine(epub).open();
  assert.equal((await engine.getToc()).length, 1);
  assert((await engine.search('world')).length === 1);

  const unsafe = security.sanitizeHtml('<img src="https://evil.example/x"><script>alert(1)</script><p onclick="x()">ok</p>');
  assert(!unsafe.includes('script'));
  assert(!unsafe.includes('evil.example'));
  assert(!unsafe.includes('onclick'));

  const dictBytes = new TextEncoder().encode('alpha definition');
  const wordBytes = new TextEncoder().encode('alpha');
  const idx = new Uint8Array(wordBytes.length + 1 + 8); idx.set(wordBytes); idx[wordBytes.length] = 0; new DataView(idx.buffer).setUint32(wordBytes.length + 1, 0); new DataView(idx.buffer).setUint32(wordBytes.length + 5, dictBytes.length);
  assert.equal(parseIdx(idx)[0].word, 'alpha');
  const star = new StarDictProvider({ metadata: { id: 'star-test', name: 'Star test' }, ifo: new Blob(['wordcount=1\nidxfilesize=14']), idx, dict: dictBytes });
  const starResult = await star.lookup('ALPHAS');
  assert.equal(starResult[0].headword, 'alpha');
  assert(starResult[0].text.includes('definition'));

  const dz = new StarDictProvider({ metadata: { id: 'star-dz', name: 'Star DZ' }, ifo: new Blob(['wordcount=1\nidxfilesize=14']), idx, dictDz: new Blob([zlib.gzipSync(dictBytes)]) });
  assert((await dz.lookup('alpha'))[0].text.includes('definition'));

  const utf16be = value => { const bytes = new Uint8Array(value.length * 2); [...value].forEach((char, index) => { const code = char.charCodeAt(0); bytes[index * 2] = code >> 8; bytes[index * 2 + 1] = code & 255; }); return bytes; };
  const mdxHeader = utf16be('<Dictionary><Key>value</Key><Description>test</Description><Format>Html</Format><Encoding>UTF-8</Encoding><Version>2</Version></Dictionary>');
  const mdxText = new TextEncoder().encode('<b>压缩释义</b>'); const compressed = zlib.deflateSync(mdxText); const key = utf16be('compressed');
  const mdxBytes = new Uint8Array(4 + mdxHeader.length + 4 + 8 + 8 + 4 + key.length + 8 + 8 + compressed.length);
  const mdxView = new DataView(mdxBytes.buffer); let mdxCursor = 0;
  mdxView.setUint32(mdxCursor, mdxHeader.length); mdxCursor += 4; mdxBytes.set(mdxHeader, mdxCursor); mdxCursor += mdxHeader.length; mdxCursor += 4;
  mdxView.setUint32(mdxCursor, 1); mdxCursor += 4; mdxView.setUint32(mdxCursor, 1); mdxCursor += 4;
  mdxView.setUint32(mdxCursor, 1); mdxCursor += 4; mdxView.setUint32(mdxCursor, compressed.length + 8); mdxCursor += 4;
  mdxView.setUint32(mdxCursor, key.length); mdxCursor += 4; mdxBytes.set(key, mdxCursor); mdxCursor += key.length; mdxView.setUint32(mdxCursor, 0); mdxCursor += 4; mdxView.setUint32(mdxCursor, mdxText.length); mdxCursor += 4;
  mdxView.setUint32(mdxCursor, 2); mdxCursor += 4; mdxCursor += 4; mdxBytes.set(compressed, mdxCursor);
  const compressedMdx = new MdxProvider({ metadata: { id: 'mdx-compressed' }, mdx: mdxBytes });
  assert.equal((await compressedMdx.lookup('compressed'))[0].text, '<b>压缩释义</b>');
  const resourceBytes = new Uint8Array([0, 1, 2, 255]);
  const resourceCompressed = zlib.deflateSync(resourceBytes);
  const resourceKey = utf16be('sound.mp3');
  const mddBytes = new Uint8Array(4 + mdxHeader.length + 4 + 8 + 8 + 4 + resourceKey.length + 8 + 8 + resourceCompressed.length);
  const mddView = new DataView(mddBytes.buffer); let mddCursor = 0;
  mddView.setUint32(mddCursor, mdxHeader.length); mddCursor += 4; mddBytes.set(mdxHeader, mddCursor); mddCursor += mdxHeader.length; mddCursor += 4;
  mddView.setUint32(mddCursor, 1); mddCursor += 4; mddView.setUint32(mddCursor, 1); mddCursor += 4;
  mddView.setUint32(mddCursor, 1); mddCursor += 4; mddView.setUint32(mddCursor, resourceCompressed.length + 8); mddCursor += 4;
  mddView.setUint32(mddCursor, resourceKey.length); mddCursor += 4; mddBytes.set(resourceKey, mddCursor); mddCursor += resourceKey.length; mddView.setUint32(mddCursor, 0); mddCursor += 4; mddView.setUint32(mddCursor, resourceBytes.length); mddCursor += 4;
  mddView.setUint32(mddCursor, 2); mddCursor += 8; mddBytes.set(resourceCompressed, mddCursor);
  const mdd = new MdxProvider({ metadata: { id: 'mdd-test' }, mdd: mddBytes });
  const resource = await mdd.getResource('sound.mp3');
  assert.equal(resource.type, 'audio/mpeg');
  assert.deepEqual(new Uint8Array(await resource.arrayBuffer()), resourceBytes);

  const mdx = new MdxProvider({ metadata: { id: 'mdx-test', name: 'MDX test' }, entries: [{ word: 'running', html: '<b>跑</b>' }] });
  assert.deepEqual(await mdx.lookup('ran'), []);
  assert.equal((await mdx.lookup('running'))[0].word, 'running');
  const manager = new DictionaryManager([mdx]);
  assert.equal((await manager.lookup('RUNNING'))[0].word, 'running');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function browserLikeFetch(url) {
    assert.equal(this, globalThis, '浏览器 fetch 必须保留 window/globalThis receiver');
    if (String(url).endsWith('manifest.json')) return { ok: true, json: async () => ({ shards: { ab: { file: 'ab.json' } } }) };
    return { ok: true, json: async () => ({ alpha: { w: 'alpha', d: '阿尔法' } }) };
  };
  try {
    const builtin = new BuiltinDictionaryProvider({ basePath: './dict/' });
    assert.equal((await builtin.lookup('alpha'))[0].text, '阿尔法');
  } finally {
    globalThis.fetch = originalFetch;
  }

  const appZip = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify({ name: 'App dict', format: 'app-zip' })), 'entries.json': new TextEncoder().encode(JSON.stringify([{ word: 'hello', definition: '<script>x</script>你好' }])) });
  const service = new DictionaryImportService({ readZip: async bytes => require('fflate').unzipSync(bytes) });
  const imported = await service.importFiles([new File([appZip], 'test.zip')]);
  const result = await imported.provider.lookup('hello');
  assert(!result[0].html.includes('script'));

  const starZip = zipSync({
    'sample.ifo': new TextEncoder().encode('wordcount=1\nidxfilesize=14'),
    'sample.idx': idx,
    'sample.dict': dictBytes
  });
  const importedStarZip = await service.importFiles([new File([starZip], 'sample.zip')]);
  assert.equal(importedStarZip.metadata.format, 'stardict');
  assert.equal((await importedStarZip.provider.lookup('alpha'))[0].headword, 'alpha');

  const persistentStore = new LocalStore({ backend: new MemoryBackend() });
  const persistentService = new DictionaryImportService({ store: persistentStore });
  const persisted = await persistentService.importFiles([
    new File([new TextEncoder().encode('wordcount=1\nidxfilesize=14')], 'persisted.ifo'),
    new File([idx], 'persisted.idx'),
    new File([dictBytes], 'persisted.dict')
  ]);
  assert.equal((await persistentStore.getAll('dictionaries')).length, 1);
  assert.equal((await persistentStore.getAll('dictionaryEntries')).length, 1);
  assert.equal((await persistentStore.getAll('files')).length, 3);
  assert.equal((await persisted.provider.lookup('alpha'))[0].headword, 'alpha');
  console.log('Reader and dictionary checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
