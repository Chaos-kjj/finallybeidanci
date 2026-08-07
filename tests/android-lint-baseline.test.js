const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const mainActivitySource = fs.readFileSync(path.join(
  root,
  'android', 'app', 'src', 'main', 'java', 'com', 'kangkang', 'beidanci', 'MainActivity.java'
), 'utf8');
const nativeAiSource = fs.readFileSync(path.join(
  root,
  'android', 'app', 'src', 'main', 'java', 'com', 'kangkang', 'beidanci', 'NativeAiPlugin.java'
), 'utf8');
const mainJsSource = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

function extractBlock(source, pattern, label) {
  const match = pattern.exec(source);
  if (!match) assert.fail(`${label}: declaration or control block was not found`);
  const open = source.indexOf('{', match.index + match[0].length - 1);
  if (open === -1) assert.fail(`${label}: opening brace was not found`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) {
      return {
        body: source.slice(open + 1, index),
        close: index,
        open
      };
    }
  }
  assert.fail(`${label}: closing brace was not found`);
}

function assertInOrder(source, fragments, label) {
  let cursor = 0;
  for (const fragment of fragments) {
    const index = source.indexOf(fragment, cursor);
    assert.notEqual(index, -1, `${label}: missing ${fragment}`);
    cursor = index + fragment.length;
  }
}

test('B1 routes every native Back entry through one behavior-preserving contract', () => {
  const onCreate = extractBlock(
    mainActivitySource,
    /public\s+void\s+onCreate\s*\(\s*Bundle\s+savedInstanceState\s*\)\s*\{/,
    'MainActivity.onCreate'
  );
  assert.match(
    onCreate.body,
    /registerOnBackInvokedCallback\s*\(\s*OnBackInvokedDispatcher\.PRIORITY_OVERLAY\s*,\s*this::onBackPressed\s*\)/,
    'Android 13+ Back callback must retain PRIORITY_OVERLAY and enter onBackPressed'
  );

  const dispatchKeyEvent = extractBlock(
    mainActivitySource,
    /public\s+boolean\s+dispatchKeyEvent\s*\(\s*KeyEvent\s+event\s*\)\s*\{/,
    'MainActivity.dispatchKeyEvent'
  );
  const hardwareBack = extractBlock(
    dispatchKeyEvent.body,
    /if\s*\(\s*plugin\s*!=\s*null\s*&&\s*code\s*==\s*KeyEvent\.KEYCODE_BACK\s*&&\s*event\.getAction\(\)\s*==\s*KeyEvent\.ACTION_UP\s*\)\s*\{/,
    'MainActivity.dispatchKeyEvent hardware Back branch'
  );
  assertInOrder(
    hardwareBack.body,
    ['onBackPressed();', 'return true;'],
    'hardware Back branch'
  );

  const onBackPressed = extractBlock(
    mainActivitySource,
    /public\s+void\s+onBackPressed\s*\(\s*\)\s*\{/,
    'MainActivity.onBackPressed'
  );
  const readerBack = extractBlock(
    onBackPressed.body,
    /if\s*\(\s*plugin\s*!=\s*null\s*&&\s*plugin\.isReaderMode\(\)\s*\)\s*\{/,
    'MainActivity.onBackPressed reader branch'
  );
  assertInOrder(
    readerBack.body,
    ['plugin.emitBackPressed();', 'return;'],
    'reader Back branch'
  );
  const fallback = onBackPressed.body.indexOf('super.onBackPressed();', readerBack.close + 1);
  assert.notEqual(fallback, -1, 'non-reader Back must fall back to a real super.onBackPressed() call');

  assert.match(
    mainJsSource,
    /NativeKeyEvents\?\.addListener\?\.\(\s*['"]backPressed['"]\s*,\s*handleReaderBack\s*\)/,
    'native backPressed event must remain connected to handleReaderBack'
  );
});

test('B2 cleanup remains API-23-compatible and replacement-safe', () => {
  const declaration = nativeAiSource.match(
    /private\s+final\s+(\w+)\s*<\s*String\s*,\s*RequestHandle\s*>\s+activeRequests\s*=\s*new\s+ConcurrentHashMap\s*<>\s*\(\s*\)\s*;/
  );
  assert(declaration, 'NativeAiPlugin.activeRequests declaration was not found');
  assert.equal(
    declaration[1],
    'ConcurrentMap',
    'activeRequests must use the API-23-compatible ConcurrentMap contract'
  );

  const request = extractBlock(
    nativeAiSource,
    /public\s+void\s+request\s*\(\s*PluginCall\s+call\s*\)\s*\{/,
    'NativeAiPlugin.request'
  );
  const cleanup = extractBlock(request.body, /finally\s*\{/, 'NativeAiPlugin.request cleanup');
  assert.match(
    cleanup.body,
    /activeRequests\.remove\s*\(\s*activeRequestId\s*,\s*handle\s*\)\s*;/,
    'worker cleanup must remove only its own request handle'
  );
  assert.doesNotMatch(
    cleanup.body,
    /activeRequests\.remove\s*\(\s*activeRequestId\s*\)\s*;/,
    'worker cleanup must not remove a replacement request by ID alone'
  );

  const cancel = extractBlock(
    nativeAiSource,
    /public\s+void\s+cancel\s*\(\s*PluginCall\s+call\s*\)\s*\{/,
    'NativeAiPlugin.cancel'
  );
  assertInOrder(
    cancel.body,
    ['activeRequests.remove(requestId)', 'handle.cancel();'],
    'explicit cancellation'
  );
});
