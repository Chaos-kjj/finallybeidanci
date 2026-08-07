const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync } = require('fflate');
const { calculateSourceFingerprint, root } = require('./build-fingerprint.js');
const { releaseContext } = require('./release-context.js');

const apkPath = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const dist = path.join(root, 'dist');
const androidPublic = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public');
const PRODUCT_CONTRACT = 'bookshelf-settings-v2';
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
const expectedVersionCode = Number(gradle.match(/\bversionCode\s+(\d+)/)?.[1]);
const expectedVersionName = gradle.match(/\bversionName\s+["']([^"']+)["']/)?.[1] || '';
const expectedChannel = releaseContext(root).canonical ? 'canonical' : 'preview';

function fail(message) {
  throw new Error(`${message}\nRun \`npm run build\` to regenerate and verify the APK.`);
}

function collectFiles(directory, base = directory) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...collectFiles(absolute, base));
    else if (entry.isFile()) output.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return output.sort();
}

function digest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function readJson(data, label) {
  try {
    return JSON.parse(Buffer.from(data).toString('utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function verifyInfo(info, label, source) {
  if (info.sourceFingerprint !== source.fingerprint) {
    fail(`${label} is stale: expected ${source.fingerprint}, found ${info.sourceFingerprint || 'no fingerprint'}`);
  }
  if (info.sourceFileCount !== source.files.length) {
    fail(`${label} has the wrong source file count: expected ${source.files.length}, found ${info.sourceFileCount}`);
  }
  if (info.productContract !== PRODUCT_CONTRACT) fail(`${label} has the wrong product contract: ${info.productContract || 'missing'}`);
  if (info.versionCode !== expectedVersionCode || info.versionName !== expectedVersionName || info.versionName !== packageInfo.version) {
    fail(`${label} version does not match package/Android metadata`);
  }
  if (info.deliveryChannel !== expectedChannel) fail(`${label} delivery channel must be ${expectedChannel}, found ${info.deliveryChannel || 'missing'}`);
}

function main() {
  if (!fs.existsSync(apkPath)) fail(`APK is missing: ${apkPath}`);
  const source = calculateSourceFingerprint();
  const distInfoPath = path.join(dist, 'build-info.json');
  const androidInfoPath = path.join(androidPublic, 'build-info.json');
  if (!fs.existsSync(distInfoPath)) fail('dist/build-info.json is missing');
  if (!fs.existsSync(androidInfoPath)) fail('Android build-info.json is missing');

  const apk = unzipSync(new Uint8Array(fs.readFileSync(apkPath)));
  const apkInfoEntry = apk['assets/public/build-info.json'];
  if (!apkInfoEntry) fail('APK does not contain assets/public/build-info.json');

  const distInfo = readJson(fs.readFileSync(distInfoPath), 'dist/build-info.json');
  const androidInfo = readJson(fs.readFileSync(androidInfoPath), 'Android build-info.json');
  const apkInfo = readJson(apkInfoEntry, 'APK build-info.json');
  verifyInfo(distInfo, 'dist/build-info.json', source);
  verifyInfo(androidInfo, 'Android build-info.json', source);
  verifyInfo(apkInfo, 'APK build-info.json', source);
  if (JSON.stringify(distInfo) !== JSON.stringify(androidInfo) || JSON.stringify(distInfo) !== JSON.stringify(apkInfo)) {
    fail('Build metadata differs between dist, Android assets, and APK');
  }

  for (const file of collectFiles(dist)) {
    const distData = fs.readFileSync(path.join(dist, file));
    const androidPath = path.join(androidPublic, file);
    if (!fs.existsSync(androidPath)) fail(`Android assets are missing dist file: ${file}`);
    const androidData = fs.readFileSync(androidPath);
    if (digest(distData) !== digest(androidData)) fail(`Android asset differs from dist: ${file}`);
  }

  const androidFiles = collectFiles(androidPublic);
  for (const file of androidFiles) {
    const androidData = fs.readFileSync(path.join(androidPublic, file));
    const apkEntry = apk[`assets/public/${file}`];
    if (!apkEntry) fail(`APK is missing Android asset: ${file}`);
    if (digest(androidData) !== digest(apkEntry)) fail(`APK asset is stale: ${file}`);
  }

  const htmlEntry = apk['assets/public/index.html'];
  if (!htmlEntry) fail('APK does not contain assets/public/index.html');
  const html = Buffer.from(htmlEntry).toString('utf8');
  for (const marker of ['造句挑战', '翻译挑战', 'vocab-view-challenge', 'vocab-view-translation', 'id="book-grid"', 'reader-library-surface', 'AI 高级设置', '实体翻页键设置', 'id="build-identity"']) {
    if (!html.includes(marker)) fail(`APK index.html is missing required feature marker: ${marker}`);
  }
  const scriptMatch = html.match(/<script[^>]+src="\.\/assets\/([^"]+\.js)"/);
  if (!scriptMatch || !apk[`assets/public/assets/${scriptMatch[1]}`]) {
    fail('APK index.html does not reference an embedded JavaScript bundle');
  }

  const builtAt = Date.parse(apkInfo.builtAt);
  const apkMtime = fs.statSync(apkPath).mtimeMs;
  if (!Number.isFinite(builtAt) || apkMtime + 2000 < builtAt || apkMtime + 2000 < source.newestSourceMtimeMs) {
    fail('APK timestamp predates its build metadata or current workspace files');
  }

  console.log('APK freshness verification passed');
  console.log(`Fingerprint: ${source.fingerprint}`);
  console.log(`Built at: ${apkInfo.builtAt}`);
  console.log(`Verified ${androidFiles.length} packaged web assets including bookshelf/settings v2`);
  console.log(`APK: ${apkPath}`);
}

try {
  main();
} catch (error) {
  console.error(`APK freshness verification failed: ${error.message}`);
  process.exitCode = 1;
}
