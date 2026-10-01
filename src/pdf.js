// Dependency-free PDF export. Each canvas becomes one page, embedded as a
// full-page JPEG (DCTDecode) at print DPI, so the physical page size matches
// the render (e.g. 2048px @ 300dpi ≈ 6.8in).

export async function canvasesToPdfBlob(canvases, dpi = 300, quality = 0.92) {
  const enc = new TextEncoder();
  const parts = [];
  let offset = 0;
  const offsets = [];
  const push = (s) => {
    const b = typeof s === 'string' ? enc.encode(s) : s;
    parts.push(b);
    offset += b.length;
  };
  const obj = (n, body) => {
    offsets[n] = offset;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  const n = canvases.length;
  const pageId = (i) => 3 + i * 3, imgId = (i) => 4 + i * 3, contentId = (i) => 5 + i * 3;

  push('%PDF-1.4\n%\xB5\xB5\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${canvases.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${n} >>`);

  for (let i = 0; i < n; i++) {
    const c = canvases[i];
    const jpeg = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    const img = new Uint8Array(await jpeg.arrayBuffer());
    const wPt = (c.width / dpi) * 72, hPt = (c.height / dpi) * 72;

    obj(pageId(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] ` +
      `/Resources << /XObject << /Im${i} ${imgId(i)} 0 R >> >> /Contents ${contentId(i)} 0 R >>`);

    offsets[imgId(i)] = offset;
    push(`${imgId(i)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`);
    push(img);
    push('\nendstream\nendobj\n');

    const content = `q ${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm /Im${i} Do Q`;
    obj(contentId(i), `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }

  const size = 3 + n * 3;
  const xrefStart = offset;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(xref);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return new Blob(parts, { type: 'application/pdf' });
}

export function canvasToPdfBlob(canvas, dpi = 300, quality = 0.92) {
  return canvasesToPdfBlob([canvas], dpi, quality);
}
