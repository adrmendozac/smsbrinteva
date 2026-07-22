import { useMemo, useRef, useState } from "react";
import { UploadSimple, MagnifyingGlass, X } from "@phosphor-icons/react";
import type { Contact } from "../types";
import { parsePhonesFromCsv } from "../lib/csv";
import { cn } from "../lib/cn";
import { inputClass } from "./ui";

export function AudiencePicker({
  contacts,
  selectedIds,
  onToggleContact,
  onSetContactsSelected,
  csvPhones,
  onCsvPhones,
}: {
  contacts: Contact[];
  selectedIds: Set<number>;
  onToggleContact: (id: number) => void;
  onSetContactsSelected: (ids: number[], selected: boolean) => void;
  csvPhones: string[];
  onCsvPhones: (phones: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [csvName, setCsvName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.phone.includes(q) || (c.name ?? "").toLowerCase().includes(q)
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
    const text = await file.text();
    onCsvPhones(parsePhonesFromCsv(text));
    setCsvName(file.name);
  }

  function clearCsv() {
    onCsvPhones([]);
    setCsvName(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Existing contacts */}
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
        {/* The running total counts every selection, including any made under a
            previous search, so a filtered "select all" can never read as
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
                  <span className="font-mono">{c.phone}</span>
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

      {/* CSV upload */}
      <div className="flex flex-col rounded-lg border border-dashed border-[var(--border)] p-4">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={onFile}
          className="hidden"
        />
        {!csvName ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <UploadSimple size={28} />
            <span>Subir CSV de teléfonos</span>
            <span className="text-xs">
              Detecta la columna de teléfono automáticamente
            </span>
          </button>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center text-sm">
            <div className="font-medium">{csvName}</div>
            <div className="text-[var(--text-muted)]">
              {csvPhones.length} teléfono{csvPhones.length === 1 ? "" : "s"} detectado
              {csvPhones.length === 1 ? "" : "s"}
            </div>
            <button
              type="button"
              onClick={clearCsv}
              className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--status-failed)]"
            >
              <X size={12} /> Quitar archivo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
