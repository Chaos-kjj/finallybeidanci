const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = ['index.html', 'src/main.js', 'sw.js', 'reader-epub-parser.js'];
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
