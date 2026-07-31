import { useEffect, useMemo, useRef, useState } from "react";
import { UploadSimple, MagnifyingGlass, X } from "@phosphor-icons/react";
import type { Contact } from "../types";
import { parsePhonesFromFile, ImportError } from "../lib/importPhones";
import { normalizeUsPhone, formatUsPhone } from "../lib/phone";
import { cn } from "../lib/cn";
import { inputClass, Spinner } from "./ui";

type Source = "contacts" | "manual" | "csv";

export function AudiencePicker({
  contacts,
  selectedIds,
  onToggleContact,
  onSetContactsSelected,
  csvPhones,
  onCsvPhones,
  manualPhones,
  onManualPhones,
  preselectContactId,
}: {
  contacts: Contact[];
  selectedIds: Set<number>;
  onToggleContact: (id: number) => void;
  onSetContactsSelected: (ids: number[], selected: boolean) => void;
  csvPhones: string[];
  onCsvPhones: (phones: string[]) => void;
  manualPhones: string[];
  onManualPhones: (phones: string[]) => void;
  preselectContactId?: number | null;
}) {
  const [source, setSource] = useState<Source>("manual");
  const lastPreselect = useRef<number | null>(null);
  useEffect(() => {
    if (preselectContactId != null && preselectContactId !== lastPreselect.current) {
      lastPreselect.current = preselectContactId;
      setSource("manual");
    }
  }, [preselectContactId]);
  const [query, setQuery] = useState("");
  const [csvName, setCsvName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.phone.includes(q) || (c.name ?? "").toLowerCase().includes(q)
    );
  }, [contacts, query]);

  // "Select all" acts on what is on screen. With a search active that is the
  // matches, not the whole book — selecting people the user cannot see would
  // mean sending them a real SMS.
  const filteredIds = useMemo(() => filtered.map((c) => c.id), [filtered]);
  const allFilteredSelected =
    filtered.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const searching = query.trim() !== "";

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(null);
    setReading(true);
    try {
      const phones = await parsePhonesFromFile(file);
      if (phones.length === 0) {
        setCsvError("No se encontro ningun telefono en el archivo.");
        onCsvPhones([]);
        setCsvName(null);
      } else {
        onCsvPhones(phones);
        setCsvName(file.name);
      }
    } catch (err) {
      setCsvError(
        err instanceof ImportError
          ? err.message
          : "No se pudo leer el archivo. Intenta de nuevo.",
      );
      onCsvPhones([]);
      setCsvName(null);
    } finally {
      setReading(false);
      // Let the same file be picked again after an error.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function clearCsv() {
    onCsvPhones([]);
    setCsvName(null);
    setCsvError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      {/* Two sources of numbers, one at a time. Same pill tabs as Historial so
          the app has a single tab language. Each tab shows how many numbers it
          contributes, because the other source is hidden while you're here and
          both still count toward the send. */}
      <div
        role="tablist"
        className="inline-flex rounded-full bg-[var(--surface-sunken)] p-1"
      >
        {(
          [
            ["manual", "Individual", manualPhones.length],
            ["contacts", "Mensajes masivos", selectedIds.size],
            ["csv", "Importar contactos", csvPhones.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={source === key}
            onClick={() => setSource(key)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              source === key
                ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-[var(--shadow-ambient)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            )}
          >
            {label}
            {count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  source === key
                    ? "bg-[var(--brand)] text-white"
                    : "bg-[var(--border)] text-[var(--text-muted)]"
                )}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {source === "manual" && (
        <div className="space-y-3">
          <ContactSearch
            contacts={contacts}
            phones={manualPhones}
            onAddPhone={(p) => {
              if (!manualPhones.includes(p)) onManualPhones([...manualPhones, p]);
            }}
          />
          <ManualEntry phones={manualPhones} onPhones={onManualPhones} />
        </div>
      )}

      {source === "contacts" && (
        <div className="rounded-lg border border-[var(--border)]">
          <div className="border-b border-[var(--border)] p-2">
            <div className="relative">
              <MagnifyingGlass
                size={16}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar contactos…"
                className={cn(inputClass, "pl-8")}
              />
            </div>
          </div>
          {/* The running total counts every selection, including any made under
              a previous search, so a filtered "select all" can never read as
              "everyone". */}
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
            <span className="text-xs text-[var(--text-muted)]">
              {selectedIds.size} de {contacts.length} seleccionado
              {selectedIds.size === 1 ? "" : "s"}
              {searching && ` · ${filtered.length} en la búsqueda`}
            </span>
            <button
              type="button"
              disabled={filtered.length === 0}
              onClick={() =>
                onSetContactsSelected(filteredIds, !allFilteredSelected)
              }
              className="shrink-0 text-xs font-medium text-[var(--focus)] hover:underline disabled:pointer-events-none disabled:opacity-40"
            >
              {allFilteredSelected
                ? "Quitar selección"
                : searching
                  ? `Seleccionar ${filtered.length}`
                  : "Seleccionar todos"}
            </button>
          </div>
          <ul className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                Sin contactos
              </li>
            )}
            {filtered.map((c) => {
              const checked = selectedIds.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onToggleContact(c.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                      checked
                        ? "bg-[var(--surface-sunken)]"
                        : "hover:bg-[var(--surface-sunken)]"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded border",
                        checked
                          ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-fg)]"
                          : "border-[var(--border)]"
                      )}
                    >
                      {checked && "✓"}
                    </span>
                    <span className="font-phone">{c.phone}</span>
                    {c.name && (
                      <span className="truncate text-[var(--text-muted)]">
                        {c.name}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {source === "csv" && (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onFile}
            className="hidden"
          />
          {!csvName ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={reading}
              className="flex w-full flex-col items-center justify-center gap-2 py-6 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-60"
            >
              {reading ? (
                <>
                  <Spinner />
                  <span className="text-xs">Leyendo archivo…</span>
                </>
              ) : (
                <>
                  <UploadSimple size={28} />
                  <span className="font-medium text-[var(--text-primary)]">
                    Subir CSV o Excel
                  </span>
                  <span className="text-xs">
                    Detecta la columna de teléfono automáticamente
                  </span>
                </>
              )}
            </button>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{csvName}</div>
                <div className="text-xs text-[var(--text-muted)]">
                  {csvPhones.length} teléfono
                  {csvPhones.length === 1 ? "" : "s"} detectado
                  {csvPhones.length === 1 ? "" : "s"}
                </div>
              </div>
              <button
                type="button"
                onClick={clearCsv}
                aria-label="Quitar archivo"
                className="shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--status-failed)]"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {csvError && (
            <p className="mt-2 text-center text-xs text-[var(--status-failed)]">
              {csvError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ContactSearch({
  contacts,
  phones,
  onAddPhone,
}: {
  contacts: Contact[];
  phones: string[];
  onAddPhone: (phone: string) => void;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return contacts.filter(
      (c) => c.phone.includes(q) || (c.name ?? "").toLowerCase().includes(q)
    );
  }, [contacts, query]);

  return (
    <div>
      <div className="relative">
        <MagnifyingGlass
          size={16}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar contacto existente…"
          className={cn(inputClass, "pl-8")}
        />
      </div>
      {query.trim() && results.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
          {results.map((c) => {
            const alreadyAdded = phones.includes(c.phone);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={alreadyAdded}
                  onClick={() => onAddPhone(c.phone)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--surface-sunken)] disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <span className="shrink-0 rounded border border-[var(--border)] px-1 text-xs text-[var(--text-muted)]">
                    {alreadyAdded ? "✓" : "+"}
                  </span>
                  <span className="font-phone text-xs">{c.phone}</span>
                  {c.name && (
                    <span className="truncate text-[var(--text-muted)]">
                      {c.name}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {query.trim() && results.length === 0 && (
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Sin contactos que coincidan
        </p>
      )}
    </div>
  );
}

// iOS-style recipient field: type a number, press Enter to turn it into a chip,
// keep going. Numbers are normalized to the canonical 11-digit form, so "925…"
// and "1925…" both land as one entry. Backspace on an empty field lifts the
// last chip; the whole thing is one send to a handful of specific people.
function ManualEntry({
  phones,
  onPhones,
}: {
  phones: string[];
  onPhones: (phones: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    const raw = draft.trim();
    if (!raw) return;
    const normalized = normalizeUsPhone(raw);
    if (!normalized) {
      setError("Escribe un número de EE. UU. de 10 dígitos (con o sin el 1).");
      return;
    }
    if (phones.includes(normalized)) {
      setError("Ese número ya está en la lista.");
      setDraft("");
      return;
    }
    onPhones([...phones, normalized]);
    setDraft("");
    setError(null);
  }

  function remove(target: string) {
    onPhones(phones.filter((p) => p !== target));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && phones.length > 0) {
      remove(phones[phones.length - 1]);
    }
  }

  return (
    <div>
      {/* The field wraps chips inline with the input, so it reads as one
          growing "to:" line rather than a list plus a box. Clicking anywhere
          focuses the input. */}
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-[3rem] flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 focus-within:border-[var(--brand)] focus-within:ring-2 focus-within:ring-[var(--brand)]/30"
      >
        {phones.map((p) => (
          <span
            key={p}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--brand)] py-1 pl-2.5 pr-1 text-sm text-white"
          >
            <span className="font-phone">{formatUsPhone(p)}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(p);
              }}
              aria-label={`Quitar ${formatUsPhone(p)}`}
              className="rounded-full p-0.5 text-white/70 transition-colors hover:text-white"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          inputMode="numeric"
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder={phones.length === 0 ? "Ej. 925 339 8990" : "Agregar otro…"}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-[var(--text-muted)]"
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
        <span className={error ? "text-[var(--status-failed)]" : "text-[var(--text-muted)]"}>
          {error ??
            `${phones.length} número${phones.length === 1 ? "" : "s"} · Enter para agregar`}
        </span>
        {phones.length > 0 && (
          <button
            type="button"
            onClick={() => onPhones([])}
            className="shrink-0 font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Quitar todos
          </button>
        )}
      </div>
    </div>
  );
}
