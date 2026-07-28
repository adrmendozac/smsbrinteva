// Wall-clock arithmetic in Pacific time, independent of where the admin's
// machine is set.
//
// format.ts already pins every *displayed* time to America/Los_Angeles, on the
// reasoning that Brinteva works Pacific hours. Scheduling has to agree: picking
// "9:00 AM" for a campaign means 9am at the office, not 9am on this laptop.
// The old datetime-local input read the browser zone, so an admin outside
// Pacific scheduled one time and saw a different one echoed back in Campañas.
//
// Everything here works in terms of a WallClock — bare calendar fields with no
// zone — and converts to a real instant only at the boundary.

const TZ = "America/Los_Angeles";

export interface WallClock {
  year: number;
  /** 0-indexed, like Date. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The Pacific calendar fields an instant lands on. */
export function toPacific(date: Date): WallClock {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(date)) p[type] = value;
  return {
    year: Number(p.year),
    month: Number(p.month) - 1,
    day: Number(p.day),
    // hourCycle h23 still emits "24" for midnight in some engines.
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
  };
}

/** Pacific's offset from UTC, in ms, at a given instant. */
function offsetAt(ms: number): number {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(ms))) p[type] = value;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
  // Drop sub-second precision on both sides so the difference is a clean offset.
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which Pacific clocks read these fields.
 *
 * Two passes: the offset is itself a function of the instant, so the first pass
 * uses the offset at the wrong moment and the second uses the offset at very
 * nearly the right one. That converges everywhere except inside the hour that
 * spring-forward skips, which is not a wall-clock time that exists.
 */
export function fromPacific(w: WallClock): Date {
  const target = Date.UTC(w.year, w.month, w.day, w.hour, w.minute);
  let ms = target - offsetAt(target);
  ms = target - offsetAt(ms);
  return new Date(ms);
}

export function nowPacific(): WallClock {
  return toPacific(new Date());
}

// Spanish, Monday-first — the convention the sellers reading this expect.
export const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Two letters is enough to tell martes from miércoles; one letter is not. */
export const WEEKDAYS = ["lu", "ma", "mi", "ju", "vi", "sá", "do"];

/** Monday=0 … Sunday=6, matching WEEKDAYS. */
function mondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

/**
 * The days of a month plus the leading blank count, for a 7-column grid.
 * Built from UTC dates purely as calendar maths — no instant is implied, so
 * this cannot drift with the viewer's zone.
 */
export function monthGrid(year: number, month: number): { blanks: number; days: number[] } {
  const first = new Date(Date.UTC(year, month, 1));
  const blanks = mondayIndex(first.getUTCDay());
  const total = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { blanks, days: Array.from({ length: total }, (_, i) => i + 1) };
}

/** Same calendar day, ignoring time. */
export function sameDay(a: WallClock, b: WallClock): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** Negative if a's calendar day precedes b's. */
export function compareDay(a: WallClock, b: WallClock): number {
  return (
    a.year - b.year || a.month - b.month || a.day - b.day
  );
}

export interface Clock12 {
  /** 1–12. */
  hour: number;
  minute: number;
  meridiem: "am" | "pm";
}

export function to12h(w: WallClock): Clock12 {
  const meridiem = w.hour >= 12 ? "pm" : "am";
  const hour = w.hour % 12 || 12;
  return { hour, minute: w.minute, meridiem };
}

export function to24h(c: Clock12): { hour: number; minute: number } {
  let hour = c.hour % 12;
  if (c.meridiem === "pm") hour += 12;
  return { hour, minute: c.minute };
}

export function formatClock(c: Clock12): string {
  return `${c.hour}:${String(c.minute).padStart(2, "0")} ${c.meridiem}`;
}

/** "lunes 27 de julio, 4:30 pm" — the trigger's label and the panel's echo. */
export function formatWallClock(w: WallClock): string {
  const weekdayNames = [
    "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo",
  ];
  const jsDay = new Date(Date.UTC(w.year, w.month, w.day)).getUTCDay();
  const weekday = weekdayNames[mondayIndex(jsDay)];
  return `${weekday} ${w.day} de ${MONTHS[w.month]}, ${formatClock(to12h(w))}`;
}

/**
 * Accepts what someone actually types into a time field: "4:30 pm", "16:30",
 * "430p", "9". Returns null rather than guessing when it cannot tell.
 */
export function parseClock(raw: string, fallbackMeridiem: "am" | "pm"): Clock12 | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  const explicit = /(a|p)\.?m?\.?\s*$/.exec(s);
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;

  let hour: number;
  let minute: number;
  if (s.includes(":")) {
    const [h, m = "0"] = s.split(":");
    hour = Number(h.replace(/\D/g, ""));
    minute = Number(m.replace(/\D/g, "").slice(0, 2) || 0);
  } else if (digits.length <= 2) {
    hour = Number(digits);
    minute = 0;
  } else {
    // "430" is 4:30, "1615" is 16:15 — minutes are always the last two digits.
    hour = Number(digits.slice(0, digits.length - 2));
    minute = Number(digits.slice(-2));
  }

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (minute > 59) return null;
  if (hour > 23) return null;

  // A 24-hour reading fixes the meridiem regardless of any a/p suffix.
  if (hour === 0) return { hour: 12, minute, meridiem: "am" };
  if (hour > 12) return { hour: hour - 12, minute, meridiem: "pm" };

  const meridiem = explicit ? (explicit[1] === "p" ? "pm" : "am") : fallbackMeridiem;
  return { hour, minute, meridiem };
}

/** Steps a wall clock by whole minutes, rolling hours, days and months. */
export function addMinutes(w: WallClock, delta: number): WallClock {
  const ms = Date.UTC(w.year, w.month, w.day, w.hour, w.minute) + delta * 60_000;
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}
