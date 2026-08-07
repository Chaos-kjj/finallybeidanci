const assert = require('node:assert/strict');
require('../src/core/normalization.js');
require('../src/storage/secure-key-store.js');
require('../src/ai/prompt-template.js');
const { AiClient, AiError, createCacheKey } = require('../src/ai/ai-client.js');
const { renderTemplate, defaultActions } = require('../src/ai/prompt-template.js');
const backup = require('../src/storage/backup.js');

async function clientWith(result, options = {}) {
  return new AiClient({
    config: { baseUrl: 'https://api.example.test/v1/chat/completions', model: 'deepseek-chat' },
    nativeBridge: { request: async ({ signal }) => {
      if (options.wait) await new Promise((resolve, reject) => { const timer = setTimeout(resolve, options.wait); signal?.addEventListener('abort', () => { clearTimeout(timer); const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }); });
      return result;
    } }
  });
}

(async () => {
  assert.equal(renderTemplate('{{selection}} / {{bookTitle}}', { selection: 'word', bookTitle: 'book' }), 'word / book');
  assert.equal(defaultActions().length, 5);
  assert((await createCacheKey('a', { system: 's', user: 'u' }, 'm')).length > 10);
  const success = await clientWith({ status: 200, body: { choices: [{ message: { content: 'ok' } }] } });
  assert.equal((await success.request(defaultActions()[1], { selection: 'hello' })).text, 'ok');

  for (const [status, code] of [[401, 'UNAUTHORIZED'], [429, 'RATE_LIMITED'], [500, 'SERVER_ERROR']]) {
    const client = await clientWith({ status, body: { error: { message: 'hidden' } } });
    await assert.rejects(() => client.request(defaultActions()[1], { selection: 'x' }), error => error instanceof AiError && error.code === code);
  }
  const malformed = await clientWith({ status: 200, body: { choices: [] } });
  await assert.rejects(() => malformed.request(defaultActions()[1], { selection: 'x' }), error => error.code === 'MALFORMED_RESPONSE');
  const timeout = await clientWith({ status: 200, body: { choices: [{ message: { content: 'late' } }] } }, { wait: 20 });
  timeout.config.timeoutMs = 5_000;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => timeout.request(defaultActions()[1], { selection: 'x' }, { signal: controller.signal }), error => error.code === 'CANCELLED');

  let cancelCalls = 0;
  const hanging = new AiClient({
    config: { baseUrl: 'https://api.example.test/v1/chat/completions' },
    nativeBridge: {
      request: () => new Promise(() => {}),
      cancel: async () => { cancelCalls += 1; }
    }
  });
  const nativeController = new AbortController();
  const nativeRequest = hanging.request(defaultActions()[1], { selection: 'cancel-me' }, { signal: nativeController.signal });
  await new Promise(resolve => setTimeout(resolve, 10));
  nativeController.abort();
  await assert.rejects(() => nativeRequest, error => error.code === 'CANCELLED');
  assert.equal(cancelCalls, 1, '原生桥取消必须结束挂起的 JS 请求');

  const payload = backup.buildBackupPayload({ state: { allWords: [], aiConfig: { apiKey: 'never' } }, settings: {}, books: [{ id: 'b', title: 'Book', text: 'secret正文', blob: new Blob(['secret']) }], dictionaries: [], actions: defaultActions() });
  const json = JSON.stringify(payload);
  assert(!json.includes('never'));
  assert(!json.includes('secret正文'));
  backup.validateBackupPayload(payload);
  assert.throws(() => backup.validateBackupPayload({ ...payload, state: { apiKey: 'bad' } }), /敏感字段/);
  console.log('AI and backup checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
