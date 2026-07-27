// Phone extraction for the campaign audience import. CSV/TSV text and Excel
// workbooks converge on the same column sniffing and normalization, so the same
// list imports identically whichever format it arrives in.
import { normalizeUsPhone } from "./phone";

// Mirrors read-excel-file's CellValue, which declares `typeof Date` (the
// constructor) where it means a Date instance — accept either.
type Cell = string | number | boolean | Date | typeof Date | null | undefined;

const PHONE_HEADER =
  /phone|tel|telefono|teléfono|celular|movil|móvil|number|numero|número|msisdn/;

const XLSX = /\.xlsx$/i;
const LEGACY_XLS = /\.(xls|xlsm|xlsb)$/i;

// Excel gives back numbers for numeric cells, so a phone can arrive as
// 9253398990 rather than "9253398990". A date cell is never a phone.
function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date || typeof cell === "function") return "";
  return String(cell).trim();
}

// US numbers land on the canonical 11-digit form via the same helper the
// hand-entry field uses, so a 10-digit column can't create a second contact for
// someone already stored as 1XXXXXXXXXX. Non-US numbers keep their digits:
// 10DLC governs US traffic only, and the app renders the rest as plain E.164.
function normalize(raw: string): string | null {
  const us = normalizeUsPhone(raw);
  if (us) return us;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

// Accepts a header with a phone-like column; otherwise falls back to the first
// column. Dedupes, and drops anything too short to be a number.
export function phonesFromRows(rows: Cell[][]): string[] {
  if (rows.length === 0) return [];

  const header = rows[0].map((c) => cellText(c).toLowerCase());
  const headerIdx = header.findIndex((c) => PHONE_HEADER.test(c));
  const colIdx = headerIdx >= 0 ? headerIdx : 0;
  const start = headerIdx >= 0 ? 1 : 0;

  const out: string[] = [];
  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const raw = cellText(row[colIdx]) || cellText(row[0]);
    const phone = normalize(raw);
    if (phone) out.push(phone);
  }
  return Array.from(new Set(out));
}

export function parsePhonesFromCsv(text: string): string[] {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/[,;\t]/));
  return phonesFromRows(rows);
}

// Thrown for problems worth showing the user verbatim.
export class ImportError extends Error {}

export async function parsePhonesFromFile(file: File): Promise<string[]> {
  if (XLSX.test(file.name)) {
    // Loaded on demand so the spreadsheet parser stays out of the main bundle.
    // readSheet, not the default export: the latter returns one { sheet, data }
    // wrapper per sheet, not rows.
    const { readSheet } = await import("read-excel-file/browser");
    try {
      const rows = await readSheet(file);
      return phonesFromRows(rows);
    } catch {
      throw new ImportError(
        "No se pudo leer el archivo. Verifica que sea un Excel valido.",
      );
    }
  }

  // read-excel-file handles the .xlsx zip format only, so say so rather than
  // failing on a file the user has no reason to think is different.
  if (LEGACY_XLS.test(file.name)) {
    throw new ImportError(
      "Ese formato de Excel no es compatible. Guarda el archivo como .xlsx o .csv.",
    );
  }

  return parsePhonesFromCsv(await file.text());
}
