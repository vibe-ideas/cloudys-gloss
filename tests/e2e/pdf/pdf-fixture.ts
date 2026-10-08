/** Original text-only PDF fixture. Xref offsets are generated rather than storing
 * a binary fixture; page 3 is intentionally image-only, page 20 is never eager. */
export function createPdfFixture(pages = 20): Buffer {
  const objects: string[] = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pageIds: number[] = [];
  for (let page = 1; page <= pages; page++) {
    const pageId = objects.length + 1; const streamId = pageId + 1; pageIds.push(pageId);
    const stream = page === 3 ? '0.85 0.87 0.91 rg 40 100 520 650 re f'
      : `BT /F1 21 Tf 48 738 Td (Reading page ${page}) Tj /F1 13 Tf 0 -44 Td (Page ${page} explains how language can connect people.) Tj 0 -18 Td (A calm layout keeps original ideas close to their translation.) Tj 0 -36 Td (A second paragraph belongs to page ${page} only.) Tj 0 -18 Td (Readers can move between pages without loading the whole book.) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;
  let pdf = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
export const pdfFixture = createPdfFixture();
