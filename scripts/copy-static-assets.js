const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
for (const name of ['dict', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'sw.js']) {
  const source = path.join(root, name);
  const target = path.join(dist, name);
  fs.cpSync(source, target, { recursive: true });
}
const standardFontsSource = path.join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts');
const standardFontsTarget = path.join(dist, 'standard_fonts');
if (fs.existsSync(standardFontsSource)) fs.cpSync(standardFontsSource, standardFontsTarget, { recursive: true });
console.log('Copied offline assets to dist');
