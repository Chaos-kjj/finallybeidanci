const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
const { collectSourceFiles } = require('../scripts/build-fingerprint.js');
const fingerprintedFiles = collectSourceFiles();

assert.equal(pkg.scripts.build, 'npm run android:apk', '默认 build 必须生成 APK');
assert(pkg.scripts['android:apk'].includes('verify:apk'), 'APK 构建必须执行新鲜度校验');
assert(pkg.scripts.test.includes('verify:apk'), '默认测试必须拒绝旧 APK');
assert(pkg.scripts['android:sync'].includes('stamp-build.js'), 'Android 同步必须写入源码指纹');
assert(worker.includes('__APP_BUILD_FINGERPRINT__'), 'Service Worker 必须按构建指纹隔离缓存');
assert(worker.includes("request.mode === 'navigate'"), '页面导航必须优先读取新包资源');
assert(main.includes('await configureOfflineWorker()'), '应用启动必须处理旧 Service Worker');
assert(main.includes('registration.unregister()'), 'Android 版本必须注销多余 Service Worker');
assert(agents.includes('npm run build'), 'Codex 仓库规则必须要求构建最终 APK');
assert(fingerprintedFiles.includes('README.md'), '文档修改也必须使 APK 指纹过期');
assert(fingerprintedFiles.includes('src/main.js'), '运行时代码必须进入 APK 指纹');
assert(!fingerprintedFiles.some(file => file.startsWith('dist/')), '构建产物不能形成循环指纹');
assert(!fingerprintedFiles.some(file => file.startsWith('android/app/src/main/assets/')), '同步资源不能形成循环指纹');

console.log('APK delivery guard checks passed');
