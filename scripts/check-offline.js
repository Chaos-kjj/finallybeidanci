const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function collectRuntimeFiles(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectRuntimeFiles(absolute, output);
    else if (entry.isFile() && /\.(?:js|mjs|html|json|java)$/i.test(entry.name)) output.push(path.relative(root, absolute));
  }
  return output;
}
const files = ['index.html', 'sw.js', 'reader-epub-parser.js', ...collectRuntimeFiles(path.join(root, 'src')), ...collectRuntimeFiles(path.join(root, 'android', 'app', 'src', 'main', 'java'))];
const forbidden = [/supabase/i, /cdn\.jsdelivr\.net/i, /gist\.githubusercontent\.com/i, /dictionaryapi\.dev/i];
const failures = [];
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  forbidden.forEach(pattern => { if (pattern.test(text)) failures.push(`${file}: ${pattern}`); });
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Offline runtime scan passed');
}
