const assert = require('node:assert/strict');

const studyStats = require('../src/core/study-stats.js');
const { HardwareKeyService } = require('../src/eink/hardware-key-service.js');
const { TextEngine, PdfEngine } = require('../src/reader/reader-engine.js');

function makePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 44 >>\nstream\nBT /F1 18 Tf 72 700 Td (Hello PDF reader) Tj ET\nendstream'
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets[index + 1] = Buffer.byteLength(output, 'binary');
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output, 'binary');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { output += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(output, 'binary'));
}

(async () => {
  let stats = studyStats.emptyStats();
  stats = studyStats.recordDuration(stats, 15_000, 'reader', new Date('2026-08-04T12:00:00Z'));
  assert.equal(stats.daily['2026-08-04'].minutes, 0, '15 seconds must not become a minute');
  assert.equal(stats.daily['2026-08-04'].readerActiveMs, 15_000);
  stats = studyStats.recordDuration(stats, 45_000, 'reader', new Date('2026-08-04T12:00:01Z'));
  assert.equal(stats.daily['2026-08-04'].minutes, 1);
  assert.equal(stats.daily['2026-08-04'].readerMinutes, 1);

  const events = [];
  const service = new HardwareKeyService({
    documentRef: { addEventListener() {}, removeEventListener() {} },
    onKey: (_action, details) => events.push(details)
  });
  service.handleDomKey({ key: 'a', keyCode: 65, target: { matches: selector => selector.includes('input') } });
  assert.equal(events.length, 0, 'typing in a form control must not become a hardware-key event');
  service.handleDomKey({ key: 'Enter', keyCode: 13, target: { matches: selector => selector.includes('button') } });
  assert.equal(events.length, 0, '点击设置按钮时不应误触发翻页键');
  service.handleDomKey({ key: 'ArrowRight', keyCode: 22, target: { matches: () => false } });
  assert.equal(events.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(events[0], 'key'), false, 'debug details must not contain printable key text');

  const textEngine = await new TextEngine('first paragraph\n\nsecond paragraph').open();
  assert((await textEngine.getChapter(0)).text.includes('second paragraph'));

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfEngine = await new PdfEngine(makePdf(), { pdfjsLib: pdfjs, disableWorker: true }).open();
  assert.equal(pdfEngine.pageCount, 1);
  assert.equal((await pdfEngine.getTextPage(1)).includes('Hello PDF reader'), true);
  assert.equal((await pdfEngine.search('PDF')).length, 1);
  await pdfEngine.close();
  console.log('Reader platform regression checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
