// A default name for a campaign, derived from what it says.
//
// Historial already prints "Creada 27 jul, 16:30" on every row, so naming a
// campaign after its date would repeat a column that is right there and leave
// the name carrying no information. The opening words of the message are what
// actually tell two campaigns apart, so that is what this builds from; the date
// is only a fallback for when there is no message yet.
//
// Deliberately reads the raw message, not the SMS-sanitised one: sanitizeForSMS
// strips accents and ñ for GSM-7, which is right for the wire and wrong for a
// label stored in utf8mb4 and read by people.

import { MONTHS, type WallClock } from "./datetime";

// Comfortably under the varchar(200) column, and short enough to sit on one line
// in Historial without truncating.
const MAX = 60;

// Every blast opens with a greeting, so it is the one part guaranteed not to
// distinguish this campaign from the last one. Longer forms first — "buenas"
// would otherwise match "buenas tardes" and leave "tardes" behind.
const GREETING =
  /^(buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|qu[eé]\s+tal|buenas|buenos|hola|saludos|hey)\b[\s,!¡.:;–-]*/i;

const URL = /\b(?:https?:\/\/|www\.)\S+/gi;

/** Trailing punctuation reads as a truncated sentence on a label. */
const TRAILING = /[\s,.;:!¡¿?–-]+$/;

export function suggestCampaignName(message: string, when: WallClock): string {
  const firstLine = message.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";

  let s = firstLine.replace(URL, " ").replace(/\s+/g, " ").trim();

  // Twice, so "Hola, buenas tardes" loses both halves rather than just the first.
  for (let i = 0; i < 2; i++) s = s.replace(GREETING, "").trim();

  s = s.replace(TRAILING, "");

  if (s.length > MAX) {
    const cut = s.slice(0, MAX + 1);
    const space = cut.lastIndexOf(" ");
    // Fall back to a hard cut only when there is no sensible word break — a
    // single 60-character token is not worth preserving whole.
    s = (space > MAX / 2 ? cut.slice(0, space) : cut.slice(0, MAX)).replace(TRAILING, "");
  }

  if (s === "") return `Campaña ${when.day} ${MONTHS[when.month].slice(0, 3)}`;

  return s.charAt(0).toUpperCase() + s.slice(1);
}
