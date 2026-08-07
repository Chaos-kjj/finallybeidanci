const assert = require('node:assert/strict');
const readerUi = require('../src/reader/reader-ui.js');
require('../src/core/normalization.js');
const library = require('../src/reader/book-library.js');

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) { const next = force === undefined ? !this.values.has(name) : Boolean(force); if (next) this.values.add(name); else this.values.delete(name); return next; }
  contains(name) { return this.values.has(name); }
}

function fakeElement() {
  const listeners = {};
  return {
    classList: new FakeClassList(), style: {}, dataset: {}, children: [],
    addEventListener(type, handler) { listeners[type] ||= []; listeners[type].push(handler); },
    dispatch(type, event = {}) { (listeners[type] || []).forEach(handler => handler(event)); },
    querySelectorAll() { return []; }, textContent: '', value: ''
  };
}

const menu = fakeElement(); menu.classList.toggle('hidden', true);
const body = fakeElement();
const settings = fakeElement(); settings.classList.toggle('hidden', true);
const toc = fakeElement(); toc.classList.toggle('hidden', true);
const close = fakeElement(); const settingsButton = fakeElement();
readerUi.bindReaderMenu({ closeButton: close, settingsButton, menu, body, settingsPanel: settings, tocPanel: toc });
settingsButton.dispatch('click');
assert.equal(settings.classList.contains('hidden'), false, '阅读设置按钮应展开设置');
assert.equal(toc.classList.contains('hidden'), true, '展开设置时目录应收起');
close.dispatch('click');
assert.equal(menu.classList.contains('hidden'), true, '关闭按钮应真正关闭菜单');
assert.equal(body.classList.contains('reader-menu-open'), false, '关闭菜单应清除打开状态');
assert.equal(settings.classList.contains('hidden'), true, '关闭菜单应收起阅读设置');

const content = fakeElement(); const paragraph = fakeElement(); content.querySelectorAll = () => [paragraph];
readerUi.applyReflowStyles(content, { font: 'monospace', fontSize: 26, fontWeight: 600, letterSpacing: 1.5, lineHeight: 2, paragraphSpacing: 2, firstLineIndent: 1, margin: 40 });
assert.equal(content.style.fontFamily, 'monospace'); assert.equal(content.style.fontSize, '26px'); assert.equal(content.style.letterSpacing, '1.5px');
assert.equal(paragraph.style.marginBottom, '2em'); assert.equal(paragraph.style.textIndent, '1em');

const storage = { value: '', getItem() { return this.value; }, setItem(_key, value) { this.value = value; } };
const settingsStore = readerUi.createSettingsStorage(storage); settingsStore.save({ fontSize: 29, theme: 'warm' });
assert.deepEqual(settingsStore.load({ fontSize: 20 }), { fontSize: 29, theme: 'warm' }, '阅读设置应能持久化并恢复');
assert.deepEqual(readerUi.settingVisibility('pdf', 'pdf-original'), { format: 'pdf', typography: false, pdfLayout: true, pdfFlow: true, reflow: false });
assert.equal(readerUi.settingVisibility('pdf', 'pdf-reflow').typography, true);
assert.equal(readerUi.settingVisibility('epub', 'paged').pdfLayout, false);
assert.equal(readerUi.normalizeFlow('pdf', 'paged'), 'pdf-original', '旧的通用分页值打开 PDF 应迁移到原版面');
assert.equal(readerUi.normalizeFlow('epub', 'pdf-original'), 'paged', 'PDF 模式不得泄漏到重排格式');

(async () => {
  const fingerprintA = await library.fingerprintBytes(new TextEncoder().encode('same book'));
  const fingerprintB = await library.fingerprintBytes(new TextEncoder().encode('same book'));
  assert.equal(fingerprintA, fingerprintB, '相同文件内容必须得到相同指纹');
  assert.equal(library.stableBookId(fingerprintA), library.stableBookId(fingerprintB));
  assert.notEqual(await library.fingerprintBytes(new TextEncoder().encode('other book')), fingerprintA);
  assert.equal(library.normalizeFormat('markdown'), 'markdown');

  const existing = { 阅读摘录: ['alpha'] };
  const merged = library.mergeErrataWords({ errata: existing, allWords: [{ word: 'alpha' }], group: '阅读摘录', words: ['alpha', 'beta', 'beta'] });
  assert.deepEqual(merged.added, ['beta'], '重复词只应新增一次');
  assert.deepEqual([...merged.duplicates].sort(), ['alpha', 'beta'], '重复词应给出清晰结果');
  assert.deepEqual(merged.errata['阅读摘录'], ['alpha', 'beta']);
  assert.equal(merged.allWords.filter(item => item.word === 'beta').length, 1, '批量保存不得重复创建单词记录');

  const newGroup = library.mergeErrataWords({ errata: existing, allWords: [], group: '新分组', words: ['gamma', 'delta'] });
  assert.deepEqual(newGroup.errata['新分组'], ['gamma', 'delta'], '新建分组应一次加入全部勾选词');
  const books = Array.from({ length: 100 }, (_, index) => library.normalizeBookRecord({ id: `b-${index}`, title: `书 ${index}`, type: 'text', updatedAt: index + 1 }));
  assert.equal(library.sortBooksByRecent(books).length, 100, '书架至少应能稳定排序约 100 本书');
  assert.equal(library.deterministicTextCover({ title: '同一本书', type: 'text' }), library.deterministicTextCover({ title: '同一本书', type: 'text' }));
  assert.equal(library.normalizeBookRecord({ id: 'legacy', title: 'Legacy.txt', type: 'text', progress: { percent: 42 } }).progress.percent, 42);
  console.log('Product refactor behavior checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
