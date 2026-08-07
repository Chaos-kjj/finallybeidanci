const assert = require('node:assert/strict');
const fs = require('node:fs');
const { zipSync } = require('fflate');

require('../src/core/normalization.js');
require('../src/core/sanitize-html.js');
const { DB_VERSION, upgradeDatabase, LocalStore, MemoryBackend, classifyOpenFailure } = require('../src/storage/local-store.js');
const backup = require('../src/storage/backup.js');
require('../src/dictionary/dictionary-provider.js');
const { DictionaryImportService } = require('../src/dictionary/import-service.js');
const { IndexedDictionaryProvider, repairBuiltinHeadword } = require('../src/dictionary/dictionary-provider.js');
const reader = require('../src/reader/reader-engine.js');
const { writeText } = require('../src/core/clipboard.js');
require('../src/ai/prompt-template.js');
const { AiClient, AiError } = require('../src/ai/ai-client.js');
const { ReaderStateMachine, scrollProgression, restoreScrollTop } = require('../src/controllers/reader-controller.js');

function fakeDb(names) {
  const stores = new Map(names.map(name => [name, { name }]));
  return { objectStoreNames: { contains: name => stores.has(name) }, createObjectStore(name) { stores.set(name, { name }); return stores.get(name); }, stores };
}

(async () => {
  assert.equal(DB_VERSION, 6);
  const v5 = fakeDb(['meta', 'state', 'books', 'annotations', 'dictionaries', 'dictionaryEntries', 'files', 'aiCache']);
  const existingBook = { id: 'book-v5', title: '存量', progress: { percent: 42 }, notes: [{ content: 'keep' }] };
  v5.stores.get('books').record = existingBook;
  upgradeDatabase(v5, 5);
  assert.equal(v5.stores.size, 8, 'v5 fixture must upgrade without removing stores');
  assert.deepEqual(v5.stores.get('books').record, existingBook, 'v5 fixture data must remain untouched');
  assert.equal(classifyOpenFailure(Object.assign(new Error('requested version (6) is less than existing version (7)'), { name: 'VersionError' })).code, 'HIGHER_SCHEMA_VERSION');

  const appZip = zipSync({
    'manifest.json': new TextEncoder().encode(JSON.stringify({ name: '重启词典' })),
    'entries.json': new TextEncoder().encode(JSON.stringify([{ word: 'hello', definition: '<p>Hello</p>' }]))
  });
  const store = new LocalStore({ backend: new MemoryBackend() });
  const service = new DictionaryImportService({ store, readZip: async bytes => require('fflate').unzipSync(bytes) });
  const imported = await service.importFiles([new File([appZip], 'restart.zip')]);
  assert.equal(imported.metadata.entryCount, 1);
  assert.equal((await imported.provider.lookup('hello'))[0].word, 'hello');
  const savedEntries = await store.getAll('dictionaryEntries');
  assert.equal(savedEntries[0].entry.word, 'hello');
  const restarted = new IndexedDictionaryProvider(savedEntries.map(item => item.entry), imported.metadata);
  assert.equal((await restarted.lookup('hello'))[0].word, 'hello');
  imported.provider.metadata.enabled = false;
  await store.put('dictionaries', imported.provider.metadata);
  assert.equal((await store.get('dictionaries', imported.metadata.id)).enabled, false);
  await service.deleteDictionary(imported.metadata.id);
  assert.equal((await store.get('dictionaries', imported.metadata.id)), null);
  assert.equal((await store.getAll('dictionaryEntries')).length, 0);

  const complete = backup.buildBackupPayload({
    state: { allWords: [{ word: 'alpha' }], apiKey: 'must-not-export' },
    settings: { reader: { font: 'User-font' } },
    books: [{ id: 'book-1', title: '书', blob: new Blob(['正文']), text: '正文', fileData: '5Yiw5paH', progress: { percent: 50 } }],
    dictionaries: [{ id: 'dict-1', name: '词典' }], dictionaryEntries: [{ id: 'dict-1:0', dictionaryId: 'dict-1', entry: { word: 'alpha' } }],
    dictionaryFiles: [{ id: 'dict-1:ifo', dictionaryId: 'dict-1', role: 'ifo', name: 'a.ifo', mime: 'text/plain', data: 'YQ==' }],
    files: [{ id: 'font:1', role: 'font', family: 'User-font', name: 'font.ttf', mime: 'font/ttf', data: 'Yg==' }],
    actions: [{ id: 'custom', label: '自定义', validationMessage: 'do not backup' }], includeFiles: true
  });
  assert.equal(complete.version, 2);
  assert.equal(complete.dictionaryFiles[0].dictionaryId, 'dict-1');
  assert.equal(complete.dictionaryFiles[0].role, 'ifo');
  assert.equal(complete.files[0].family, 'User-font');
  assert.equal(backup.previewRestore(complete).integrityStatus, 'unverified');
  assert.equal(Object.prototype.hasOwnProperty.call(complete.aiActions[0], 'validationMessage'), false);
  assert.throws(() => backup.validateBackupPayload({ ...complete, state: { apiKey: 'no' } }), /敏感字段/);
  const oldV1 = { ...complete, version: 1, dictionaryFiles: [{ id: 'old', name: 'old.ifo', mime: 'text/plain', data: 'YQ==' }] };
  const normalized = backup.normalizeBackupPayload(oldV1);
  assert.equal(normalized.version, 2);
  assert.equal(normalized.dictionaryFiles[0].role, 'unknown');
  assert.equal(backup.previewRestore(complete).includesBookFiles, true);
  const dataset = backup.buildRestoreDataset(complete, { base64ToBlob: value => new Blob([value]) });
  assert.equal(dataset.files.find(file => file.role === 'font').family, 'User-font');

  const atomic = new LocalStore({ backend: new MemoryBackend() });
  await atomic.put('books', { id: 'old', title: '旧书' });
  await atomic.put('aiCache', { key: 'stale', data: { text: 'old' } });
  await atomic.put('meta', { id: 'dictionary-settings', data: { stale: true } });
  await assert.rejects(() => atomic.applyBackupDataset({ state: {}, books: [{ title: '缺 id' }] }, { mode: 'overwrite' }));
  assert.equal((await atomic.get('books', 'old')).title, '旧书');
  await atomic.applyBackupDataset({ state: { allWords: [] }, settings: {}, actions: [], books: [] }, { mode: 'overwrite' });
  assert.equal(await atomic.get('aiCache', 'stale'), null, '覆盖恢复必须清理不可导出的旧 AI 缓存');
  assert.equal(await atomic.get('meta', 'dictionary-settings'), null, '覆盖恢复不能残留旧词典排序配置');

  const merged = backup.mergeRestoreState(
    { allWords: [{ word: 'alpha', status: 'known', updatedAt: '2026-08-05T10:00:00Z' }] },
    { allWords: [{ word: 'alpha', status: 'new', updatedAt: '2026-08-04T10:00:00Z' }, { word: 'beta', status: 'new' }] }
  );
  assert.equal(merged.allWords.find(item => item.word === 'alpha').status, 'known', '合并恢复应保留较新的词条状态');
  assert.equal(merged.allWords.some(item => item.word === 'beta'), true);

  const markdown = reader.markdownToHtml('# 标题\n\n- 第一项\n- 第二项\n\n[安全链接](https://example.com)\n<script>alert(1)</script>');
  assert(markdown.includes('<h1 id="heading-0">标题</h1>'));
  assert(markdown.includes('<ul>') && markdown.includes('<li>第一项</li>'));
  assert(markdown.includes('href="https://example.com"'));
  assert(!markdown.includes('<script') && !markdown.includes('javascript:'));
  const htmlEngine = await new reader.HtmlEngine('<h1>HTML</h1><p onclick="bad()">正文</p><script>bad()</script>').open();
  assert.equal((await htmlEngine.getToc())[0].title, 'HTML');
  assert(!htmlEngine.html.includes('script') && !htmlEngine.html.includes('onclick'));
  const epubSafe = globalThis.KangkangSecurity.sanitizeHtml('<p><a href="https://outside.example">外链</a><a href="chapter.xhtml#p1">内部</a></p>', { allowExternalLinks: false, allowInternalLinks: true, allowRelativeLinks: true });
  assert(!epubSafe.includes('https://outside.example'), 'EPUB 清洗不得保留外部链接');
  assert(epubSafe.includes('chapter.xhtml#p1'), 'EPUB 清洗应保留可定位的内部链接');

  const textarea = { value: '', select() {}, setSelectionRange() {}, setAttribute() {}, style: {}, remove() {} };
  const body = { appendChild() {}, }; const documentRef = { body, createElement() { return textarea; }, execCommand(command) { return command === 'copy'; } };
  const clipboardResult = await writeText('复制正文', { navigatorRef: { clipboard: { writeText: async () => { throw new DOMException('blocked', 'NotAllowedError'); } } }, documentRef });
  assert.equal(clipboardResult.method, 'execCommand');

  let attempts = 0; const client = new AiClient({ config: { baseUrl: 'https://tokenrhythm.studio/v1/chat/completions', maxRetries: 2, timeoutMs: 5000 }, nativeBridge: null, sleep: async () => {}, transport: async () => { attempts += 1; if (attempts === 1) return { status: 429, body: {} }; return { choices: [{ message: { content: '成功' } }] }; } });
  const aiResult = await client.request({ id: 'test', enabled: true, systemPrompt: '', userPrompt: '{{selection}}' }, { selection: 'alpha' });
  assert.equal(aiResult.text, '成功');
  assert.equal(attempts, 2);
  let serverAttempts = 0; const serverRetry = new AiClient({ config: { maxRetries: 1 }, sleep: async () => {}, transport: async () => { serverAttempts += 1; return serverAttempts === 1 ? { status: 503, body: {} } : { status: 200, body: { choices: [{ message: { content: '恢复' } }] } }; } });
  assert.equal((await serverRetry.request({ id: 'server-retry', enabled: true, systemPrompt: '', userPrompt: 'x' })).text, '恢复');
  assert.equal(serverAttempts, 2);
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(() => client.request({ id: 'test-abort', enabled: true, systemPrompt: '', userPrompt: 'x' }, {}, { signal: aborted.signal }), error => error instanceof AiError && error.code === 'CANCELLED');

  const nativeAiSource = fs.readFileSync(require('node:path').join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'kangkang', 'beidanci', 'NativeAiPlugin.java'), 'utf8');
  assert(nativeAiSource.includes('Math.min(120000, requestedTimeout)'), '原生 AI 桥必须允许慢推理模型使用 120 秒上限');
  assert(!nativeAiSource.includes('newSingleThreadExecutor()'), '每次 AI 请求不得泄漏一个新的线程池');
  assert(nativeAiSource.includes('settled.compareAndSet(false, true)'), '取消的原生 AI PluginCall 必须只结算一次，不能泄漏未完成回调');
  assert(nativeAiSource.includes('setInstanceFollowRedirects(false)'), '原生 AI 桥不得跟随重定向绕过 HTTPS 边界');
  assert(nativeAiSource.includes('MAX_RESPONSE_BYTES'), '原生 AI 桥必须限制响应体大小');
  const indexSource = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert(indexSource.includes('value="https://tokenrhythm.studio/v1/chat/completions"'), '静态 AI Base URL 必须与运行时默认值一致');
  assert(indexSource.includes('id="ai-model" value="deepseek-v4-flash-0731"'), '静态 AI 模型必须与运行时默认值一致');
  assert(!indexSource.includes('value="https://api.deepseek.com/v1/chat/completions"'), '旧 AI Base URL 不得残留在初始设置表单');
  assert(nativeAiSource.includes('public void cancel(PluginCall call)'), '原生 AI 桥必须支持超时/取消时断开请求');

  const machine = new ReaderStateMachine(); machine.transition('opening'); machine.transition('reading'); machine.transition('menu'); machine.transition('reading'); assert.equal(machine.state, 'reading');
  const mainSource = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(mainSource.includes("show('reader-settings', panel.classList.contains('hidden'))"), '阅读设置按钮必须以当前 hidden 状态作为下一步可见状态');
  assert(!mainSource.includes("show('reader-settings', !$('reader-settings').classList.contains('hidden'))"), '不得再次引入永远隐藏阅读设置的反向布尔逻辑');
  assert.equal((mainSource.match(/setReaderNotice\(''\); setText\('reader-progress-overlay', ''\)/g) || []).length, 2, '两条删除路径都必须清除旧书进度提示');
  assert.equal(scrollProgression(400, 1200, 800), 1); assert.equal(restoreScrollTop(.5, 1200, 800), 200);
  assert.equal(repairBuiltinHeadword('ability', '-ability'), 'ability');
  const abilityShard = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '..', 'dict', 'shards', '91.json'), 'utf8'));
  assert.equal(repairBuiltinHeadword('ability', abilityShard.ability.w), 'ability', '内置 Collins ability 冲突必须按键名修复');
  console.log('Diagnosed regression checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
