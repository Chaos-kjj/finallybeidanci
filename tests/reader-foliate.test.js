const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../src/reader/reader-locator.js');

if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this.detail = init.detail;
    }
  };
}

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/reader/foliate-epub-engine.mjs'), 'utf8');

(async () => {
  const { ReaderEngineAdapter, sanitizeMarkup, FOLIATE_REVISION } = await import('../src/reader/foliate-epub-engine.mjs');
  assert.equal(FOLIATE_REVISION, 'df623dbe6610fd98a7c2d5d7a5c23bfcfc7d19f3');
  assert(source.includes("setAttribute('eink', '')"));
  assert(source.includes("setAttribute('no-swipe', '')"));
  assert(source.includes("script-src 'none'"));

  class FakeView extends EventTarget {
    constructor() {
      super();
      this.style = {};
      this.calls = [];
      this.renderer = {
        style: {},
        attrs: {},
        setAttribute: (key, value) => { this.renderer.attrs[key] = value; },
        removeAttribute: key => { delete this.renderer.attrs[key]; },
        setStyles: css => { this.renderer.styles = css; }
      };
      this.transformTarget = new EventTarget();
      this.book = {
        sections: [
          { id: 'chapter-1.xhtml', loadText: async () => 'one', loadContent: async () => '<p>one</p>' },
          { id: 'chapter-2.xhtml', loadText: async () => 'two', loadContent: async () => '<p>two</p>' }
        ],
        toc: [{ id: 'toc-1', label: '第一章', href: 'chapter-1.xhtml' }],
        metadata: { title: '测试书', author: '作者', language: 'zh' },
        transformTarget: this.transformTarget,
        destroy: async () => { this.destroyed = true; }
      };
      this.search = async function* () {
        yield { cfi: 'epubcfi(/6/2[chapter-1]!/4/1:0)', excerpt: 'one' };
        yield { progress: 1 };
      };
    }

    async open() { this.calls.push(['open']); }
    async init() { this.calls.push(['init']); }
    async next(distance) { this.calls.push(['next', distance]); }
    async prev(distance) { this.calls.push(['prev', distance]); }
    async goTo(target) { this.calls.push(['goTo', target]); }
    async goToFraction(fraction) { this.calls.push(['goToFraction', fraction]); }
    resolveNavigation(target) {
      if (String(target).includes('chapter-1') || String(target).includes('epubcfi')) return { index: 0 };
      if (String(target).includes('chapter-2')) return { index: 1 };
      return null;
    }
    getCFI(index) { return `epubcfi(/6/${index + 2}[chapter-${index + 1}]!/4/1:0)`; }
    close() { this.calls.push(['close']); }
    remove() { this.removed = true; this.parentNode = null; }
  }

  const view = new FakeView();
  const host = {
    child: null,
    appendChild(child) { this.child = child; child.parentNode = this; return child; },
    replaceChildren(child) { this.child = child; child.parentNode = this; },
    get clientWidth() { return 800; },
    get clientHeight() { return 1000; }
  };
  const adapter = new ReaderEngineAdapter(new Uint8Array([1, 2, 3]), {
    viewFactory: async () => view,
    title: '测试书'
  });
  const selections = [];
  adapter.addEventListener('selection', event => selections.push(event.detail));
  await adapter.open();
  assert.equal(adapter.isFoliate, true);
  assert.equal(adapter.engine, 'foliate-js');
  assert.equal((await adapter.getMetadata()).title, '测试书');
  assert.equal((await adapter.mount(host, { flow: 'paged', fontSize: 22, margin: 20 })).valueOf(), true);
  assert.equal(host.child, view);
  assert.equal(view.renderer.attrs.eink, '');
  assert.equal(view.renderer.attrs['no-swipe'], '');
  assert.equal(view.renderer.attrs.flow, 'paginated');
  assert(view.renderer.styles.includes('font-size:22px'));
  assert(view.calls.some(call => call[0] === 'init'));

  const securityLoad = new CustomEvent('load', { detail: { isScript: true, allow: true } });
  view.transformTarget.dispatchEvent(securityLoad);
  assert.equal(securityLoad.detail.allow, false);
  const securityData = new CustomEvent('data', { detail: { type: 'text/css', data: '@import url(https://example.com/x.css); body { background: url(https://example.com/x.png) }' } });
  view.transformTarget.dispatchEvent(securityData);
  securityData.detail.data = await securityData.detail.data;
  assert(!securityData.detail.data.includes('https://'));

  const doc = new EventTarget();
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => 'selected words',
    getRangeAt: () => ({ startContainer: { parentElement: { closest: () => ({ textContent: 'paragraph text' }) } } })
  };
  doc.getSelection = () => selection;
  doc.defaultView = { getSelection: () => selection, frameElement: { isConnected: true } };
  view.dispatchEvent(new CustomEvent('load', { detail: { doc, index: 0 } }));
  doc.dispatchEvent(new Event('selectionchange'));
  assert.equal(selections.length, 1);
  assert.equal(selections[0].text, 'selected words');
  assert.equal(selections[0].locator.value, 'epubcfi(/6/2[chapter-1]!/4/1:0)');
  assert.equal(adapter.hasSelection(), true);

  view.dispatchEvent(new CustomEvent('relocate', { detail: { index: 0, cfi: selections[0].locator.value, fraction: 0.25 } }));
  assert.equal(adapter.getProgress().percent, 25);
  assert.equal(adapter.getProgress().locator.href, 'chapter-1.xhtml');

  const toc = adapter.getToc();
  assert.equal(toc[0].title, '第一章');
  assert.equal((await adapter.search('one'))[0].locator.type, 'epubcfi');
  await adapter.goTo(adapter.getProgress().locator);
  await adapter.next(1);
  await adapter.prev(1);
  assert(view.calls.some(call => call[0] === 'goTo' && call[1] === 'epubcfi(/6/2[chapter-1]!/4/1:0)'));
  assert(view.calls.some(call => call[0] === 'next' && call[1] === 1));
  assert(view.calls.some(call => call[0] === 'prev' && call[1] === 1));

  const beforeClose = selections.length;
  await adapter.close();
  doc.dispatchEvent(new Event('selectionchange'));
  assert.equal(selections.length, beforeClose, '关闭引擎后应清理 iframe selectionchange 监听器');
  assert.equal(view.removed, true);

  const fallbackCalls = [];
  const fallback = {
    async open() { fallbackCalls.push('open'); },
    async next() { fallbackCalls.push('next'); },
    async prev() { fallbackCalls.push('prev'); },
    async goTo() { fallbackCalls.push('goTo'); },
    getProgress() { return { percent: 10 }; },
    getToc() { return [{ title: '旧目录' }]; },
    async getMetadata() { return { title: '旧引擎' }; },
    async close() { fallbackCalls.push('close'); }
  };
  const fallbackAdapter = new ReaderEngineAdapter('legacy-source', {
    viewFactory: async () => { throw new Error('模拟 Foliate 初始化失败'); },
    fallbackFactory: async () => fallback
  });
  await fallbackAdapter.open();
  assert.equal(fallbackAdapter.isFoliate, false);
  assert.equal(fallbackAdapter.engine, 'legacy');
  assert.equal(fallbackAdapter.metadata.fallbackReason, '模拟 Foliate 初始化失败');
  await fallbackAdapter.next();
  assert(fallbackCalls.includes('next'));
  assert.equal(fallbackAdapter.getProgress().percent, 10);
  await fallbackAdapter.close();
  assert(fallbackCalls.includes('close'));

  const mountFallbackView = new FakeView();
  const mountFallbackAdapter = new ReaderEngineAdapter('mount-fallback', {
    viewFactory: async () => mountFallbackView,
    fallbackFactory: async () => fallback
  });
  await mountFallbackAdapter.open();
  assert.equal(await mountFallbackAdapter.mount({}, {}), false);
  assert.equal(mountFallbackAdapter.isFoliate, false);
  assert(mountFallbackView.calls.some(call => call[0] === 'close'));
  assert.equal(mountFallbackView.destroyed, true);
  await mountFallbackAdapter.close();

  console.log('Foliate adapter and fallback checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
