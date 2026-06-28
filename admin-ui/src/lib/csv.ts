// Forgiving CSV phone extractor (parsing happens client-side).
// Accepts a header with a phone-like column (phone/telefono/celular/movil/
// number/msisdn); otherwise falls back to the first column. Normalizes to
// digits and dedupes. Anything under 7 digits is ignored as noise.
export function parsePhonesFromCsv(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const headerCols = lines[0].split(/[,;\t]/).map((c) => c.trim().toLowerCase());
  const phoneRe = /phone|tel|telefono|teléfono|celular|movil|móvil|number|numero|número|msisdn/;
  const headerIdx = headerCols.findIndex((c) => phoneRe.test(c));

  let colIdx = 0;
  let start = 0;
  if (headerIdx >= 0) {
    colIdx = headerIdx;
    start = 1;
  }

  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(/[,;\t]/);
    const raw = (cols[colIdx] ?? cols[0] ?? "").trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 7) out.push(digits);
  }
  return Array.from(new Set(out));
}
