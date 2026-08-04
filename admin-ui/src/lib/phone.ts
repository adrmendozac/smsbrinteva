
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
