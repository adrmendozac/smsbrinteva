// US phone normalization for hand-entered numbers.
//
// Everything downstream — contacts, CSV, Vonage — uses the 11-digit form
// "1" + 10-digit US number (e.g. 19253398990). Accept the number with or
// without the leading 1 and always return that canonical form, so a number
// typed here is indistinguishable from one that came off a CSV or the DB.
//
// Returns null when the input can't be a US number, so the caller can explain
// why instead of sending to something malformed.
export function normalizeUsPhone(input: string): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  if (digits.length === 10) return "1" + digits; // area code + line, add the 1
  if (digits.length === 11 && digits[0] === "1") return digits;
  return null;
}

// Pretty form for display only. Chips show this; state stores the raw 11 digits.
export function formatUsPhone(n: string): string {
  if (!/^1\d{10}$/.test(n)) return n;
  return `+1 (${n.slice(1, 4)}) ${n.slice(4, 7)}-${n.slice(7)}`;
}
