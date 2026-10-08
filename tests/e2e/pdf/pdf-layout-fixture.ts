/** Original, fictional report. No customer documents or personal financial data.
 * The table grid is deliberately painted AFTER its labels and numeric values. */
export const pdfLayoutTexts = {
  title: 'Cloudy Observatory Sample Report',
  body: 'Fictional readings help test bilingual page layout. Color bands and table lines must remain unchanged.',
  note: 'A short note.',
  end: 'End of the sample report.',
  clipped: 'Clipped text remains visible in the original.',
  clippingNote: 'This page uses a clipping path.',
  concealed: 'Concealed sample phrase must never be sent.',
  visible: 'Visible page summary.',
};
export const longPdfTranslation = `${'这是一段需要完整保留的详细说明。阅读者可以打开详情，逐句查看原文和中文，并继续滚动读完所有内容。'.repeat(20)}完整说明到此结束。`;
export const pdfLayoutTranslations: Record<string, string> = {
  [pdfLayoutTexts.title]: '云朵观测站示例报告',
  [pdfLayoutTexts.body]: '虚构观测用于测试双语页面。色带与表格线保持完整。',
  OBSERVATORY: '观测站', READINGS: '读数', QUALITY: '质量',
  'North Meadow': '北方草甸', 'River Station': '河流站',
  [pdfLayoutTexts.note]: longPdfTranslation,
  [pdfLayoutTexts.end]: '示例报告结束。',
  [pdfLayoutTexts.clipped]: '裁剪区域中的文字在原稿中保持可见。',
  [pdfLayoutTexts.clippingNote]: '此页使用了裁剪路径。',
  [pdfLayoutTexts.visible]: '可见页面摘要。',
};
export const pdfLayoutProbes = [
  { name: 'colored-header', x: 498, y: 46, width: 22, height: 22 },
  { name: 'decorative-square', x: 540, y: 55, width: 20, height: 20 },
  { name: 'numeric-readings', x: 306, y: 260, width: 104, height: 66 },
  { name: 'numeric-quality', x: 434, y: 260, width: 132, height: 66 },
  { name: 'email', x: 48, y: 356, width: 198, height: 25 },
  { name: 'late-table-grid', x: 299, y: 220, width: 3, height: 100 },
  { name: 'body-text', x: 48, y: 120, width: 510, height: 42 },
];

function documentFromStreams(streams: string[]) {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  const ids: number[] = [];
  for (const stream of streams) {
    const id = objects.length + 1; ids.push(id);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${ids.map(id => `${id} 0 R`).join(' ')}] /Count ${ids.length} >>`;
  let pdf = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const report = `0.94 0.97 1 rg 0 0 612 792 re f
0.10 0.20 0.36 rg 36 700 540 58 re f
0.95 0.70 0.24 rg 538 715 24 24 re f
1 1 1 rg BT /F2 21 Tf 52 726 Td (${pdfLayoutTexts.title}) Tj ET
0.10 0.16 0.23 rg BT /F1 13 Tf 52 660 Td (Fictional readings help test bilingual page layout.) Tj 0 -18 Td (Color bands and table lines must remain unchanged.) Tj ET
0.86 0.91 0.97 rg 40 540 532 32 re f
0.08 0.13 0.20 rg
BT /F2 12 Tf 52 550 Td (OBSERVATORY) Tj ET
BT /F2 12 Tf 310 550 Td (READINGS) Tj ET
BT /F2 12 Tf 438 550 Td (QUALITY) Tj ET
BT /F1 12 Tf 52 518 Td (North Meadow) Tj ET
BT /F1 12 Tf 310 518 Td (128) Tj ET
BT /F1 12 Tf 438 518 Td (97.5%) Tj ET
BT /F1 12 Tf 52 486 Td (River Station) Tj ET
BT /F1 12 Tf 310 486 Td (256) Tj ET
BT /F1 12 Tf 438 486 Td (99.0%) Tj ET
BT /F1 12 Tf 52 422 Td (reader@example.test) Tj ET
BT /F1 12 Tf 52 370 Td (${pdfLayoutTexts.note}) Tj ET
BT /F1 12 Tf 52 100 Td (${pdfLayoutTexts.end}) Tj ET
0.30 0.40 0.55 RG 1 w
40 472 532 100 re S
300 472 m 300 572 l S
425 472 m 425 572 l S
40 540 m 572 540 l S
40 508 m 572 508 l S`;
const clipped = `0.95 0.97 1 rg 0 0 612 792 re f
q 40 650 300 90 re W n 0.1 0.2 0.3 rg BT /F1 12 Tf 52 700 Td (${pdfLayoutTexts.clipped}) Tj ET Q
0.1 0.2 0.3 rg BT /F1 12 Tf 52 600 Td (${pdfLayoutTexts.clippingNote}) Tj ET`;
const scan = 'q 40 80 530 660 re W n 0.16 0.37 0.55 rg 0 0 612 792 re f 0.8 0.9 0.95 rg 85 180 400 470 re f Q';
const covered = `1 1 1 rg 0 0 612 792 re f
0 0 0 rg BT /F1 12 Tf 52 660 Td (${pdfLayoutTexts.concealed}) Tj ET
1 1 1 rg 40 635 520 45 re f
0 0 0 rg BT /F1 12 Tf 52 600 Td (${pdfLayoutTexts.visible}) Tj ET`;
export const pdfLayoutFixture = documentFromStreams([report, clipped, scan, covered]);
