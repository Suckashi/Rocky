// A tiny hand-built PDF for the CMap test (ADR 0005, finding 3).

/**
 * A PDF whose Chinese text uses a non-embedded font and the predefined CMap UniCNS-UCS2-H,
 * as older Taiwanese office software produces. Only a reader with the CMaps can decode it.
 */
export function cmapEncodedPdf(text: string): Uint8Array {
  const hex = [...text]
    .map((c) => c.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('');
  const stream = `BT /F1 24 Tf 72 720 Td <${hex}> Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /MingLiU /Encoding /UniCNS-UCS2-H /DescendantFonts [6 0 R] >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /MingLiU /CIDSystemInfo << /Registry (Adobe) /Ordering (CNS1) /Supplement 0 >> /FontDescriptor 7 0 R >>',
    '<< /Type /FontDescriptor /FontName /MingLiU /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
