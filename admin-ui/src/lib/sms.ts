// Mirrors the backend sanitizeForSMS so the admin sees exactly what will send.
export function sanitizeForSMS(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .replace(/[^\x00-\x7F]/g, "") // emoji / non-ASCII
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// GSM-7 segmentation: 160 chars single, 153 per part when concatenated.
export function smsSegments(length: number): number {
  if (length === 0) return 0;
  if (length <= 160) return 1;
  return Math.ceil(length / 153);
}
