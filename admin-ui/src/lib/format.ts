export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", {
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
