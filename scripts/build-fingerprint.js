const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const FINGERPRINT_SCHEMA_VERSION = 1;

function normalizeRelative(file) {
  return file.split(path.sep).join('/');
}

function isGeneratedOrLocal(relativePath) {
  const file = normalizeRelative(relativePath);
  const generatedPrefixes = [
    '.git/', '.agents/', '.codex/', '.cache/', 'node_modules/', 'dist/', 'coverage/',
    'android/.gradle/', 'android/app/src/main/assets/'
  ];
  if (generatedPrefixes.some(prefix => file === prefix.slice(0, -1) || file.startsWith(prefix))) return true;
  const segments = file.split('/');
  if (segments.some(segment => ['build', '.idea', '.cxx', '.externalNativeBuild'].includes(segment))) return true;
  if (file === 'android/local.properties' || file === '.env' || file.startsWith('.env.') || file.endsWith('/.DS_Store') || file === '.DS_Store') return true;
  return /\.(?:apk|aab|jks|keystore)$/i.test(file);
}

function collectSourceFiles(directory = root) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = normalizeRelative(path.relative(root, absolute));
    if (isGeneratedOrLocal(relative)) continue;
    if (entry.isDirectory()) output.push(...collectSourceFiles(absolute));
    else if (entry.isFile()) output.push(relative);
  }
  return output.sort();
}

function calculateSourceFingerprint() {
  const files = collectSourceFiles();
  const hash = crypto.createHash('sha256');
  hash.update(`kangkang-apk-source-v${FINGERPRINT_SCHEMA_VERSION}\0`);
  let newestSourceMtimeMs = 0;
  for (const file of files) {
    const absolute = path.join(root, file);
    const data = fs.readFileSync(absolute);
    const stat = fs.statSync(absolute);
    newestSourceMtimeMs = Math.max(newestSourceMtimeMs, stat.mtimeMs);
    hash.update(file);
    hash.update('\0');
    hash.update(String(data.length));
    hash.update('\0');
    hash.update(data);
    hash.update('\0');
  }
  return {
    fingerprint: hash.digest('hex'),
    files,
    newestSourceMtimeMs
  };
}

module.exports = {
  FINGERPRINT_SCHEMA_VERSION,
  calculateSourceFingerprint,
  collectSourceFiles,
  isGeneratedOrLocal,
  root
};
