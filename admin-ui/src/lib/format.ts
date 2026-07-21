// Brinteva operates out of Pittsburg, CA. Times are pinned to Pacific rather
// than the viewer's machine so a screen shared with a seller elsewhere still
// shows the hours the office actually works in.
const TZ = "America/Los_Angeles";

// The API returns UTC. Bare MySQL datetimes ("2026-07-21 19:42:10") carry no
// zone and would otherwise be parsed as local time -- 7 hours off in Pacific --
// so normalise them to UTC before formatting.
function parseUTC(value: string | null): Date | null {
  if (!value) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const d = new Date(hasZone ? value : `${value.replace(" ", "T")}Z`);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(iso: string | null): string {
  const d = parseUTC(iso);
  if (!d) return "—";
  return d.toLocaleString("es-MX", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_ES: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  sending: "Enviando",
  completed: "Completada",
  failed: "Fallida",
};

export function statusLabel(status: string): string {
  return STATUS_ES[status] ?? status;
}

const RECIPIENT_STATUS_ES: Record<string, string> = {
  pending: "Pendiente",
  sent: "Enviado",
  failed: "Fallido",
  opted_out: "Dado de baja",
};

export function recipientStatusLabel(status: string): string {
  return RECIPIENT_STATUS_ES[status] ?? status;
}

// Stored as digits (19254355511). Grouped so a person can read it aloud.
// Sending is not US-only -- 10DLC only governs US traffic -- so anything that
// is not a US number falls back to plain E.164 rather than being forced into a
// (555) 555-5555 shape that would misrepresent it.
export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return d ? `+${d}` : phone;
}

export function formatTime(iso: string | null): string {
  const d = parseUTC(iso);
  if (!d) return "—";
  return d.toLocaleTimeString("es-MX", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}
