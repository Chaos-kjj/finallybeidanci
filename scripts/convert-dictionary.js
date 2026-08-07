#!/usr/bin/env node
/*
 * Convert a legal, user-owned UTF-8 JSON/JSONL word list to the app's
 * deterministic offline ZIP format. This is the documented fallback for MDX
 * variants that use encryption/LZO or an incompatible record-block layout.
 *
 * Usage:
 *   node scripts/convert-dictionary.js input.json output.zip
 *
 * Accepted input: an array of entries, {entries:[...]}, an object keyed by
 * headword, or one JSON object per line. Each entry needs word/headword and
 * may provide html, definition, or text.
 */
const fs = require('node:fs');
const path = require('node:path');
const { zipSync } = require('fflate');

const [, , inputName, outputName] = process.argv;
if (!inputName || !outputName) {
  console.error('用法：node scripts/convert-dictionary.js input.json output.zip');
  process.exit(2);
}

function readEntries(fileName) {
  const raw = fs.readFileSync(fileName, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.entries)) return parsed.entries;
    if (parsed && typeof parsed === 'object') return Object.entries(parsed).map(([word, value]) => ({ word, ...(value && typeof value === 'object' ? value : { definition: value }) }));
  } catch (_) {
    return raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  }
  return [];
}

const entries = readEntries(inputName).map(raw => {
  const word = String(raw?.word || raw?.headword || '').trim();
  const html = String(raw?.html || raw?.definition || raw?.text || '').trim();
  return { word, html, text: String(raw?.text || html).trim() };
}).filter(entry => entry.word && (entry.html || entry.text));
const unique = new Map(entries.map(entry => [entry.word.toLocaleLowerCase(), entry]));
const outputEntries = Array.from(unique.values()).sort((a, b) => a.word.localeCompare(b.word));
if (!outputEntries.length) throw new Error('没有可转换的词条；每条记录需要 word/headword 和 html/definition/text');

const manifest = {
  format: 'app-zip',
  version: 1,
  name: path.basename(outputName, path.extname(outputName)),
  source: 'converted-json',
  entryCount: outputEntries.length,
  generatedAt: new Date().toISOString()
};
const bytes = zipSync({
  'manifest.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  'entries.json': new TextEncoder().encode(JSON.stringify(outputEntries))
});
fs.writeFileSync(outputName, Buffer.from(bytes));
console.log(`已生成 ${outputName}：${outputEntries.length} 条词条`);
