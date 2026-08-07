const { strToU8, zipSync } = require('fflate');

const chapter = ({ title, body, dir = 'ltr', writingMode = '' }) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" dir="${dir}">
  <head><title>${title}</title><link rel="stylesheet" href="../style.css" /></head>
  <body${writingMode ? ` style="writing-mode:${writingMode}"` : ''}>
    <h1>${title}</h1>
    <p>${body}</p>
    <p><a href="chapter2.xhtml#footnote">内部链接</a> <a href="https://example.com">外部链接</a></p>
    <aside id="footnote">脚注内容</aside>
    <img src="../images/pixel.svg" alt="图片" />
    <script>window.shouldNeverRun = true</script>
  </body>
</html>`;

function fixtureFiles(kind = 'epub3') {
  const isNcx = kind === 'ncx';
  const isDamaged = kind === 'damaged';
  const isFixed = kind === 'fixed' || kind === 'rtl-vertical';
  const isVertical = kind === 'rtl-vertical';
  const chapterName = isDamaged ? 'chapter & one.xhtml' : 'chapter1.xhtml';
  const opfName = isDamaged ? 'book & space.opf' : 'book.opf';
  const count = kind === 'large' ? 80 : 2;
  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/${opfName}" media-type="application/oebps-package+xml" /></rootfiles>
</container>`),
    'OPS/style.css': strToU8('@import url("https://example.com/remote.css"); body { font-family: serif; }'),
    'OPS/images/pixel.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" /></svg>')
  };

  const manifest = [
    `<item id="style" href="style.css" media-type="text/css" />`,
    `<item id="image" href="images/pixel.svg" media-type="image/svg+xml" properties="cover-image" />`
  ];
  const spine = [];
  const tocPoints = [];
  for (let index = 0; index < count; index += 1) {
    const id = `chapter${index + 1}`;
    const href = index === 0 ? chapterName : `chapter${index + 1}.xhtml`;
    const title = `第 ${index + 1} 章`;
    const body = kind === 'large'
      ? `${'large epub content '.repeat(80)}${index}`
      : index === 0 ? '第一章正文 & 未转义文本' : '第二章正文';
    manifest.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml" />`);
    spine.push(`<itemref idref="${id}" />`);
    tocPoints.push(`<navPoint id="nav-${id}" playOrder="${index + 1}"><navLabel><text>${title}</text></navLabel><content src="${href}" /></navPoint>`);
    files[`OPS/${href}`] = strToU8(chapter({ title, body, dir: isVertical ? 'rtl' : 'ltr', writingMode: isVertical ? 'vertical-rl' : '' }));
  }

  if (isNcx || isDamaged) {
    manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />');
    files['OPS/toc.ncx'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>${tocPoints.join('')}</navMap>
</ncx>`);
  } else {
    manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />');
    files['OPS/nav.xhtml'] = strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc"><ol>${tocPoints.map(point => point.match(/<content src="([^"]+)"/)[1]).map((href, index) => `<li><a href="${href}">第 ${index + 1} 章</a></li>`).join('')}</ol></nav></body></html>`);
  }

  const metadataExtra = isFixed ? '<meta property="rendition:layout">pre-paginated</meta>' : '';
  const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${isNcx ? '2.0' : '3.0'}" unique-identifier="BookId"${isVertical ? ' dir="rtl"' : ''}>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">fixture-${kind}</dc:identifier>
    <dc:title>${isDamaged ? 'Damaged & title' : `Fixture ${kind}`}</dc:title>
    <dc:creator>Test Author</dc:creator><dc:language>en</dc:language>${metadataExtra}
  </metadata>
  <manifest>${manifest.join('')}</manifest>
  <spine${isNcx ? ' toc="ncx"' : ''}>${spine.join('')}</spine>
</package>`;
  files[`OPS/${opfName}`] = strToU8(packageXml);
  return files;
}

function createEpubFixture(kind = 'epub3') {
  return zipSync(fixtureFiles(kind), { level: 0 });
}

module.exports = { createEpubFixture, fixtureFiles };
