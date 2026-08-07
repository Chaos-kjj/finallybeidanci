const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const selection = require('../src/reader/reader-selection.js');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const nativeReaderSource = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'kangkang', 'beidanci', 'ReaderWindowPlugin.java'), 'utf8');

assert.deepEqual(
  selection.tokenizeWords("Read don't stop—re-enter" ).map(token => token.normalized),
  ['read', "don't", 'stop', 're-enter'],
  '英文正文必须能稳定拆成可点击词 token'
);
assert.equal(selection.isSingleWord('reader'), true);
assert.equal(selection.isSingleWord('reader book'), false);
assert.equal(selection.isSingleWord('中文'), false);
assert.deepEqual(selection.actionIdsForSelection('word'), [], '单词选择不应显示长句 AI 操作栏');
assert.deepEqual(selection.actionIdsForSelection('range'), ['explain', 'translate', 'copy', 'note']);
assert.deepEqual(selection.tokenizeLogicalWords('下一页 déjà-vu 2026').map(token => token.text), ['下一页', 'déjà-vu', '2026'], '逻辑选区必须覆盖 EPUB/PDF 中的 Unicode 词');

const anchorWord = {
  start: selection.logicalPoint('epub', 2, 10),
  end: selection.logicalPoint('epub', 2, 15)
};
const forwardWord = {
  start: selection.logicalPoint('epub', 4, 3),
  end: selection.logicalPoint('epub', 4, 8)
};
const backwardWord = {
  start: selection.logicalPoint('epub', 1, 2),
  end: selection.logicalPoint('epub', 1, 7)
};
assert.deepEqual(selection.normalizeLogicalRange(anchorWord, forwardWord), {
  start: anchorWord.start,
  end: forwardWord.end,
  direction: 1
}, '向后跨章节时必须形成稳定的正序逻辑范围');
assert.deepEqual(selection.normalizeLogicalRange(anchorWord, backwardWord), {
  start: backwardWord.start,
  end: anchorWord.end,
  direction: -1
}, '反向跨章节时也必须保留起始词的完整边界');
assert.equal(selection.extractLogicalText(
  { start: selection.logicalPoint('epub', 0, 2), end: selection.logicalPoint('epub', 2, 3) },
  new Map([['epub:0', 'abcdef'], ['epub:1', 'middle'], ['epub:2', 'xyzxyz']])
), 'cdef\n\nmiddle\n\nxyz', '跨任意多个逻辑页面/章节的文本必须按顺序拼接');

let clock = 0;
let timerId = 0;
let timerReceiver = null;
const timers = new Map();
const commits = [];
const gate = new selection.SelectionDwellGate({
  delayMs: 1000,
  reentryDistance: 56,
  setTimer(callback, delay) { timerReceiver = this; const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
  clearTimer(id) { timers.delete(id); },
  onCommit(payload) { commits.push(payload); }
});
const advanceClock = milliseconds => {
  clock += milliseconds;
  [...timers.entries()].filter(([, timer]) => timer.at <= clock).forEach(([id, timer]) => { timers.delete(id); timer.callback(); });
};
assert.equal(gate.arm('last-word', { direction: 1 }), true);
assert.equal(timerReceiver, globalThis, 'WebView 原生计时器必须以 globalThis 为 receiver，不能作为 gate 对象方法调用');
assert.equal(gate.arm('last-word', { direction: 1 }), false, '同一末词上的细微移动不得重置一秒计时');
advanceClock(999);
assert.equal(commits.length, 0, '停留不足一秒不得翻页');
advanceClock(1);
assert.deepEqual(commits, [{ direction: 1 }], '末词停留整一秒必须且只能触发一次翻页');
gate.markTurned(100, 100);
assert.equal(gate.canReenter(156, 100, true), false, '翻页后手指仍落在末词区时不得静止连跳');
assert.equal(gate.canReenter(155, 100, false), false, '翻页后必须离开至少 56px 才能继续扩展');
assert.equal(gate.canReenter(156, 100, false), true, '不抬手移出重入区后必须能继续下一页框选');

assert(indexSource.includes('.reader-menu { position:fixed; z-index:80; top:0; left:0; right:0; height:20vh;'), '普通阅读菜单必须是顶部 20% 面板');
assert(indexSource.includes('.reader-menu.reader-menu-settings-open { height:33.333vh;'), '深入阅读设置必须限制在 1/3 高度内');
assert(!indexSource.includes('.reader-menu { position:fixed; inset:0;'), '阅读菜单不得恢复为全屏遮罩');
assert(indexSource.includes('display:flex; flex-direction:column;') && indexSource.includes('overflow:hidden; border-bottom:3px solid var(--line);'), '阅读菜单必须固定布局且不得依靠滚动容器展示');
assert(indexSource.includes('.reader-settings { display:grid; grid-template-columns:repeat(3,minmax(0,1fr));') && indexSource.includes('.reader-settings .reader-settings-compat { display:none !important; }'), '排版设置必须用紧凑三列核心区，兼容细项不得挤占可视区');
assert(mainSource.includes('id="reader-menu-library" class="reader-menu-icon"') && mainSource.includes('aria-label="返回书库"'), '返回书库必须是左侧小图标');
assert(mainSource.includes('id="reader-menu-settings" type="button">排版</button>'), '阅读菜单必须使用排版入口');
assert(mainSource.includes('id="reader-menu-toc" type="button">目录</button>'), '阅读菜单必须保留目录入口');
assert(mainSource.includes('id="reader-menu-bookmark" type="button">添加书签</button>'), '阅读菜单必须保留添加书签入口');
assert(mainSource.includes('id="reader-menu-notes" type="button">书签/笔记</button>'), '阅读菜单必须保留书签/笔记入口');
assert(indexSource.includes('id="reader-side-panel" class="reader-side-panel hidden"'), '目录和书签/笔记必须有独立左侧抽屉');
assert(indexSource.includes('--reader-side-panel-width:clamp(280px,25vw,640px);'), '左侧抽屉宽度必须约为页面四分之一');
assert(indexSource.includes('.reader-side-panel-body { flex:1 1 auto; min-height:0; overflow-x:hidden; overflow-y:auto;'), '左侧抽屉内容必须支持独立纵向滚动');
assert(indexSource.includes('body.reader-immersive.reader-side-panel-open #reader-stage { left:var(--reader-side-panel-width); width:calc(100% - var(--reader-side-panel-width)); }'), '打开侧栏时阅读正文必须保留右侧可视区域');
assert(mainSource.includes("openReaderSidePanel('reader-toc', '目录')"), '目录入口必须打开左侧抽屉');
assert(mainSource.includes("openReaderSidePanel('reader-annotations-panel', '书签与笔记')"), '书签/笔记入口必须打开左侧抽屉');
assert(mainSource.includes('closeReaderSidePanel({ restoreReader: false })'), '从标注定位后必须关闭左侧抽屉并恢复阅读布局');
['reader-menu-prev', 'reader-menu-next', 'reader-menu-refresh', 'reader-menu-page-input', 'reader-menu-search-input'].forEach(id => {
  assert(!indexSource.includes(`id="${id}"`) && !mainSource.includes(`'${id}'`), `${id} 不得再出现在阅读菜单`);
});
assert(indexSource.includes('id="reader-word-popup"'), '阅读页必须有单词释义弹层');
assert(indexSource.includes('id="reader-word-errata"'), '单词释义弹层必须同时提供加入错词本');
assert(indexSource.includes('.reader-word-popup-body { flex:1 1 auto; min-height:0; max-height:18dvh;'), '长词典条目必须在释义正文内部滚动');
assert(indexSource.includes('.reader-word-popup-actions { flex:0 0 auto;'), '加入错词本操作区必须始终固定在释义弹层可视区');
assert(indexSource.includes('.reader-action-bar { position:fixed; z-index:90; left:50%; bottom:max(7rem,'), '长句操作栏必须避开 Android 系统选择工具条');

assert(mainSource.includes('ReaderSelection.wrapWordTokens(content)'), '正文渲染必须生成可点击词 token');
assert(mainSource.includes("readerSelection = readerSelectionContext('word'"), '单击单词必须进入独立 word 选择态');
assert(mainSource.includes("ReaderSelection.actionIdsForSelection('range')"), '长句操作栏必须由 range 选择态统一生成');
assert(!mainSource.includes("const labels = { lookup:"), '长句操作栏不得重新暴露查词按钮');
assert(mainSource.includes('new ReaderSelection.TextUnitIndex'), '阅读渲染必须建立不依赖 DOM 生命周期的逻辑文本索引');
assert(mainSource.includes('new ReaderSelection.SelectionDwellGate({') && mainSource.includes('delayMs: 1000'), '末词停留翻页必须由精确的一秒门控器驱动');
assert(mainSource.includes('turnReaderPageForSelection') && mainSource.includes('continuousSelectionTurn: true'), 'EPUB 章节和 PDF 页重建必须走保留逻辑选区的专用翻页路径');
assert(mainSource.includes('ReaderSelection.extractLogicalText'), '抬手后必须从跨页逻辑范围还原完整句子');
assert(mainSource.includes('forceOverlay: isNativeAndroid'), 'Android 多栏 WebView 必须使用可覆盖全部 Range rect 的稳定高亮层');
assert(mainSource.includes("config.flow === 'paged' || config.flow === 'pdf-reflow'"), 'PDF 文本重排必须与 EPUB 一样真正分页');
assert(mainSource.includes("addEventListener('pointermove', handleReaderPointerMove, { passive: false })"), 'Pointer move 必须可取消，避免 Android WebView 抢走手势');
assert(mainSource.includes("index.root?.classList?.contains('textLayer') && rootHasUsableBounds"), '横向多栏 EPUB 不得用首栏根节点边界拒绝后续页面命中');
assert(mainSource.includes('rect.width > 1 && rect.height > 1'), 'Android PDF.js 的零尺寸 textLayer 根节点不得拒绝拥有有效子矩形的文字命中');
assert(!mainSource.includes('appendReaderSelectionChapter') && !mainSource.includes('appendReaderSelectionPdfPage'), '不得再通过追加临时 DOM 假装跨页选区');
assert(indexSource.includes('touch-action:none; overscroll-behavior:contain;'), '阅读面必须在 pointerdown 前声明自定义触控手势所有权');
assert(indexSource.includes('::highlight(reader-cross-page-selection)'), '跨页逻辑范围必须拥有独立高亮层');
assert(nativeReaderSource.includes('setSelectionGuard') && nativeReaderSource.includes('setOnLongClickListener(view -> true)'), 'Android WebView 必须拦截会触发 pointercancel 的原生长按 ActionMode');

const forcedPainter = new selection.SelectionPainter({ documentRef: null, forceOverlay: true });
assert.equal(forcedPainter.forceOverlay, true, '高亮器必须允许 Android 强制绕过不完整的 Custom Highlight 绘制');
assert(mainSource.includes('renderReader({ preserveViewport: true })'), '调整排版后必须保留阅读视口作为实时预览锚点');
assert(mainSource.includes("if (readerSelection?.kind === 'range' || (nativeSelection && !nativeSelection.isCollapsed"), '已有文字选区时点击页面不得触发翻页或打开菜单');
const pointerUpSource = mainSource.slice(mainSource.indexOf('function handleReaderPointerUp'), mainSource.indexOf('function handleReaderPointerCancel'));
assert(pointerUpSource.includes("const surfaceTap = pointer.phase === 'arming' && !pointer.moved && !tappedWord;"), '未移动的非单词触摸必须识别为菜单或翻页点击');
const clearPointerIndex = pointerUpSource.indexOf('readerSelectionPointer = null;');
const surfaceTapIndex = pointerUpSource.indexOf('if (surfaceTap) activateReaderSurfaceTap');
const compatibilityClickGuardIndex = pointerUpSource.indexOf('readerIgnoreSurfaceClickUntil = Date.now() + 300;');
assert(clearPointerIndex >= 0 && clearPointerIndex < surfaceTapIndex && surfaceTapIndex < compatibilityClickGuardIndex, '普通触摸必须先释放选区指针并执行菜单/翻页，再屏蔽 WebView 后续兼容 click');
assert(mainSource.includes("const wordPopup = $('reader-word-popup');"), '返回键必须识别单词释义弹层');
assert(mainSource.includes('if (next && readerSelection) clearReaderSelection();'), '菜单打开时必须清理词选区与单词弹层');

console.log('Reader selection interaction checks passed');
