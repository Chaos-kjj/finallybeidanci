const assert = require('node:assert/strict');
require('../src/core/normalization.js');
require('../src/storage/secure-key-store.js');
require('../src/ai/prompt-template.js');
const { AiClient, AiError, createCacheKey, normalizeConfig, extractResponse, isRetryableError, validateBaseUrl } = require('../src/ai/ai-client.js');
const { renderTemplate, defaultActions } = require('../src/ai/prompt-template.js');
const backup = require('../src/storage/backup.js');

async function clientWith(result, options = {}) {
  return new AiClient({
    config: { baseUrl: 'https://api.example.test/v1/chat/completions', model: 'deepseek-chat' },
    sleep: options.sleep || (async () => {}),
    nativeBridge: { request: async ({ signal }) => {
      if (options.wait) await new Promise((resolve, reject) => { const timer = setTimeout(resolve, options.wait); signal?.addEventListener('abort', () => { clearTimeout(timer); const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }); });
      return result;
    } }
  });
}

(async () => {
  assert.equal(renderTemplate('{{selection}} / {{bookTitle}}', { selection: 'word', bookTitle: 'book' }), 'word / book');
  assert.equal(defaultActions().length, 5);
  assert.equal(normalizeConfig({}).baseUrl, 'https://tokenrhythm.studio/v1/chat/completions');
  assert.equal(normalizeConfig({}).model, 'deepseek-v4-flash-0731');
  assert.equal(normalizeConfig({}).maxTokens, 512);
  assert.equal(normalizeConfig({}).timeoutMs, 60_000);
  assert.throws(() => validateBaseUrl('http://example.test'), error => error.code === 'INVALID_URL');
  assert.throws(() => validateBaseUrl('https://'), error => error.code === 'INVALID_URL');
  assert.equal(normalizeConfig({ temperature: 0 }).temperature, 0);
  assert.equal(isRetryableError(new AiError('retry', 'SERVER_ERROR')), true);
  assert((await createCacheKey('a', { system: 's', user: 'u' }, 'm')).length > 10);
  assert.notEqual(
    await createCacheKey('a', { system: 's', user: 'u' }, 'm', { baseUrl: 'https://one.example', temperature: 0.2, maxTokens: 128 }),
    await createCacheKey('a', { system: 's', user: 'u' }, 'm', { baseUrl: 'https://two.example', temperature: 0.2, maxTokens: 128 }),
    '切换 AI 服务地址不能命中旧缓存'
  );
  assert.notEqual(
    await createCacheKey('a', { system: 's', user: 'u' }, 'm', {}, { bookId: 'book-a' }),
    await createCacheKey('a', { system: 's', user: 'u' }, 'm', {}, { bookId: 'book-b' }),
    '不同书籍不能共享同一选区的 AI 缓存'
  );
  const success = await clientWith({ status: 200, body: { choices: [{ message: { content: 'ok' } }] } });
  assert.equal((await success.request(defaultActions()[1], { selection: 'hello' })).text, 'ok');

  for (const [status, code] of [[401, 'UNAUTHORIZED'], [429, 'RATE_LIMITED'], [500, 'SERVER_ERROR']]) {
    const client = await clientWith({ status, body: { error: { message: 'hidden' } } });
    await assert.rejects(() => client.request(defaultActions()[1], { selection: 'x' }), error => error instanceof AiError && error.code === code);
  }
  const malformed = await clientWith({ status: 200, body: { choices: [] } });
  await assert.rejects(() => malformed.request(defaultActions()[1], { selection: 'x' }), error => error.code === 'MALFORMED_RESPONSE');
  assert.throws(() => extractResponse({ choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'thinking' } }], usage: { completion_tokens_details: { reasoning_tokens: 128 } } }), error => error.code === 'TRUNCATED_RESPONSE' && error.reasoningTokens === 128);
  assert.throws(() => extractResponse({ choices: [{ finish_reason: 'length', message: { content: 'partial answer' } }] }), error => error.code === 'TRUNCATED_RESPONSE');
  const reasoningOnly = await clientWith({ status: 200, body: { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'thinking' } }], usage: { completion_tokens_details: { reasoning_tokens: 128 } } } });
  assert.equal((await reasoningOnly.testConnection()).reasoningOnly, true);
  const timeout = await clientWith({ status: 200, body: { choices: [{ message: { content: 'late' } }] } }, { wait: 30 });
  timeout.config.timeoutMs = 5;
  await assert.rejects(() => timeout.request(defaultActions()[1], { selection: 'x' }), error => error.code === 'TIMEOUT');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => timeout.request(defaultActions()[1], { selection: 'x' }, { signal: controller.signal }), error => error.code === 'CANCELLED');
  let nativeCancelled = false;
  const cancellable = new AiClient({ config: { timeoutMs: 5, maxRetries: 0 }, nativeBridge: {
    request: async () => new Promise(() => {}),
    cancel: async () => { nativeCancelled = true; }
  } });
  cancellable.config.timeoutMs = 5;
  await assert.rejects(() => cancellable.request(defaultActions()[1], { selection: 'x' }), error => error.code === 'TIMEOUT');
  assert.equal(nativeCancelled, true, '原生超时必须触发请求取消');

  const payload = backup.buildBackupPayload({ state: { allWords: [], aiConfig: { apiKey: 'never' } }, settings: {}, books: [{ id: 'b', title: 'Book', text: 'secret正文', blob: new Blob(['secret']) }], dictionaries: [], actions: defaultActions() });
  const json = JSON.stringify(payload);
  assert(!json.includes('never'));
  assert(!json.includes('secret正文'));
  backup.validateBackupPayload(payload);
  assert.throws(() => backup.validateBackupPayload({ ...payload, state: { apiKey: 'bad' } }), /敏感字段/);
  const encoded = await backup.encodeBackup(payload);
  const sealed = JSON.parse(new TextDecoder().decode(encoded));
  assert.match(sealed.integrity.digest, /^[a-f0-9]{64}$/);
  assert.equal(backup.previewRestore(await backup.decodeBackup(encoded)).integrityStatus, 'verified');
  const reordered = { integrity: sealed.integrity, ...Object.fromEntries(Object.entries(sealed).filter(([key]) => key !== 'integrity').reverse()) };
  assert.equal(backup.previewRestore(await backup.decodeBackup(new TextEncoder().encode(JSON.stringify(reordered)))).integrityStatus, 'verified', '摘要应基于规范化内容而非对象键顺序');
  await assert.rejects(() => backup.decodeBackup(new TextEncoder().encode(JSON.stringify({ ...payload, version: 2 }))), /缺少 SHA-256/);
  const legacyWithFakeDigest = { ...payload, version: 1, integrity: { algorithm: 'SHA-256', digest: '0'.repeat(64) } };
  const legacyDecoded = await backup.decodeBackup(new TextEncoder().encode(JSON.stringify(legacyWithFakeDigest)));
  assert.equal(backup.previewRestore(legacyDecoded).integrityStatus, 'unverified');
  assert.equal(Object.prototype.hasOwnProperty.call(legacyDecoded, 'integrity'), false);
  sealed.state.allWords.push({ word: 'tampered' });
  await assert.rejects(() => backup.decodeBackup(new TextEncoder().encode(JSON.stringify(sealed))), /完整性校验失败/);
  console.log('AI and backup checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
