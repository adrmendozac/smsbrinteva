import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import type { LogEntry, LogLevel } from "../types";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { formatDateTime } from "../lib/format";
import { Button, Card, Spinner } from "./ui";

// Mirror of lib/logs.js CATEGORIES, so the picker offers exactly what the
// server can emit.
const CATEGORIES = [
  "send",
  "dlr",
  "inbound",
  "kommo",
  "voice",
  "auth",
  "campaign",
  "contact",
  "media",
  "system",
] as const;

const LEVELS: { key: LogLevel | "all"; label: string }[] = [
  { key: "all", label: "Todo" },
  { key: "info", label: "Info" },
  { key: "warn", label: "Advertencias" },
  { key: "error", label: "Errores" },
];

// Same pill idiom as StatusPill, but for log levels.
function LevelPill({ level }: { level: LogLevel }) {
  const color =
    level === "error"
      ? "var(--status-failed)"
      : level === "warn"
        ? "var(--status-sending)"
        : "var(--status-completed)";
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {level === "error" ? "Error" : level === "warn" ? "Advertencia" : "Info"}
    </span>
  );
}

export function Logs({ onLoaded }: { onLoaded?: (entries: LogEntry[]) => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [category, setCategory] = useState<string>("all");
  const [nextBefore, setNextBefore] = useState<number | null>(null);

  // Mirrors `entries` for the load callback. Without it, load would depend on
  // entries and change identity on every page, restarting the fetch effect.
  const entriesRef = useRef<LogEntry[]>([]);

  const load = useCallback(async (before?: number) => {
    try {
      const page = await api.getLogs({
        level: level === "all" ? undefined : level,
        category: category === "all" ? undefined : category,
        before,
      });
      // onLoaded gets the merged list, not the new page: the rail count must
      // reflect every entry currently on screen, paging included.
      const merged = before ? [...entriesRef.current, ...page.logs] : page.logs;
      entriesRef.current = merged;
      setEntries(merged);
      setNextBefore(page.nextBefore);
      onLoaded?.(merged);
      setError("");
    } catch {
      setError("No se pudo cargar el registro. Pulsa Actualizar para reintentar.");
    } finally {
      setLoading(false);
    }
  }, [level, category, onLoaded]);

  useEffect(() => {
    // A filter change restarts from the newest page.
    entriesRef.current = [];
    setEntries([]);
    setNextBefore(null);
    setLoading(true);
    load();
  }, [load]);

  if (loading && entries.length === 0) {
    return (
      <div className="flex justify-center py-12 text-[var(--text-muted)]">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters mirror the History sub-tabs: a segmented control for level,
          a select for category. */}
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            className="inline-flex rounded-full bg-[var(--surface-sunken)] p-1"
          >
            {LEVELS.map(({ key, label }) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={level === key}
                onClick={() => setLevel(key)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  level === key
                    ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-[var(--shadow-ambient)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            aria-label="Categoría"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <option value="all">Todas las categorías</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <Button variant="ghost" onClick={() => load()} type="button">
          <ArrowClockwiseIcon size={16} weight="light" aria-hidden="true" /> Actualizar
        </Button>
      </div>

      {error && (
        <p className="text-center text-sm text-[var(--status-failed)] sm:text-left">
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">
            No hay registros.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id}>
              <Card padded={false}>
                <div className="flex items-start gap-3 p-4">
                  <LevelPill level={e.level} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="truncate font-medium">{e.message}</span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {formatDateTime(e.created_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                        {e.category}
                      </span>
                      {e.meta && Object.keys(e.meta).length > 0 && (
                        <details className="group">
                          <summary className="cursor-pointer text-xs text-[var(--text-muted)] outline-none transition-colors hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
                            contexto
                          </summary>
                          <pre className="mt-2 max-w-full overflow-x-auto rounded-lg bg-[var(--surface-sunken)] p-2.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
                            {JSON.stringify(e.meta, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {nextBefore !== null && (
        <div className="flex justify-center pt-1">
          <Button
            variant="ghost"
            onClick={() => load(nextBefore)}
            loading={loading}
            type="button"
          >
            Cargar más
          </Button>
        </div>
      )}
    </div>
  );
}
