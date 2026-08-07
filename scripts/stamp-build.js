const fs = require('node:fs');
const path = require('node:path');
const {
  FINGERPRINT_SCHEMA_VERSION,
  calculateSourceFingerprint,
  root
} = require('./build-fingerprint.js');

const dist = path.join(root, 'dist');
const androidPublic = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public');
const targets = [dist, androidPublic];

for (const directory of targets) {
  if (!fs.existsSync(directory)) throw new Error(`Build directory is missing: ${directory}`);
}

const source = calculateSourceFingerprint();
const buildInfo = {
  schemaVersion: FINGERPRINT_SCHEMA_VERSION,
  sourceFingerprint: source.fingerprint,
  sourceFileCount: source.files.length,
  builtAt: new Date().toISOString()
};
const serialized = `${JSON.stringify(buildInfo, null, 2)}\n`;

for (const directory of targets) {
  fs.writeFileSync(path.join(directory, 'build-info.json'), serialized);
  const workerPath = path.join(directory, 'sw.js');
  const worker = fs.readFileSync(workerPath, 'utf8');
  const stamped = worker.replace(
    /const BUILD_FINGERPRINT = ['"][^'"]+['"];/,
    `const BUILD_FINGERPRINT = '${source.fingerprint}';`
  );
  if (stamped === worker && !worker.includes(source.fingerprint)) {
    throw new Error(`Service Worker fingerprint placeholder is missing: ${workerPath}`);
  }
  fs.writeFileSync(workerPath, stamped);
}

console.log(`Stamped Android build ${source.fingerprint.slice(0, 16)} from ${source.files.length} workspace files`);
