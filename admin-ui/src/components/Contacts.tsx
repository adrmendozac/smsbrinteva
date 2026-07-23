import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { MagnifyingGlass, Plus, Trash, CaretRight, X } from "@phosphor-icons/react";
import type { Contact } from "../types";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/cn";
import { normalizeUsPhone, formatUsPhone } from "../lib/phone";
import { Button, Card, Field, Spinner, inputClass } from "./ui";

/**
 * Contact manager: the whole book, opted-in or not, with a side-drawer editor.
 * Distinct from the audience picker — here you maintain names and numbers, so
 * the list intentionally includes people you can no longer message and tags
 * them, rather than hiding them the way the picker does.
 */
export function Contacts({ onCount }: { onCount: (n: number | null) => void }) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  // null = drawer closed, "new" = adding, a Contact = editing that row.
  const [editing, setEditing] = useState<Contact | "new" | null>(null);

  useEffect(() => {
    api
      .getAllContacts()
      .then((list) => {
        setContacts(list);
        onCount(list.length);
      })
      .catch(() =>
        setError(
          "No se pudieron cargar los contactos. Recarga la página para reintentar."
        )
      );
    // onCount is a stable setState; loading once on mount is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!contacts) return [];
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.phone.includes(q) || (c.name ?? "").toLowerCase().includes(q)
    );
  }, [contacts, query]);

  // Fold a saved contact (created or edited) back into the list without a refetch.
  function upsert(saved: Contact) {
    setContacts((prev) => {
      const next = prev ? [...prev] : [];
      const i = next.findIndex((c) => c.id === saved.id);
      if (i === -1) next.push(saved);
      else next[i] = saved;
      next.sort((a, b) =>
        (a.name ?? "￿").localeCompare(b.name ?? "￿")
      );
      onCount(next.length);
      return next;
    });
  }

  function removed(id: number) {
    setContacts((prev) => {
      const next = (prev ?? []).filter((c) => c.id !== id);
      onCount(next.length);
      return next;
    });
  }

  if (error) {
    return <p className="py-4 text-sm text-[var(--status-failed)]">{error}</p>;
  }

  if (!contacts) {
    return (
      <div className="flex justify-center py-16 text-[var(--text-muted)]">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <Card padded={false}>
        <div className="flex items-center gap-3 p-4">
          <div className="relative flex-1">
            <MagnifyingGlass
              size={16}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o número…"
              className={cn(inputClass, "pl-8")}
            />
          </div>
          <Button
            variant="brand"
            className="shrink-0 px-4 py-2"
            onClick={() => setEditing("new")}
          >
            <Plus size={16} weight="bold" aria-hidden="true" />
            Agregar
          </Button>
        </div>

        {filtered.length === 0 ? (
          <p className="border-t border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
            {query.trim()
              ? "Ningún contacto coincide con la búsqueda."
              : "Aún no hay contactos. Agrega el primero."}
          </p>
        ) : (
          <ul className="max-h-[32rem] overflow-y-auto border-t border-[var(--border)]">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setEditing(c)}
                  className="flex w-full touch-manipulation items-center gap-3 border-b border-[var(--border)] px-4 py-3 text-left outline-none transition-colors last:border-b-0 hover:bg-[var(--surface-sunken)] focus-visible:bg-[var(--surface-sunken)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {c.name || (
                          <span className="text-[var(--text-muted)]">Sin nombre</span>
                        )}
                      </span>
                      {c.opted_in === false && (
                        <span className="shrink-0 rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
                          sin consentimiento
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block font-mono text-sm text-[var(--text-muted)]">
                      {formatUsPhone(c.phone)}
                    </span>
                  </span>
                  <CaretRight
                    size={16}
                    weight="light"
                    aria-hidden="true"
                    className="shrink-0 text-[var(--text-muted)]"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing !== null && (
        <Drawer
          contact={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            upsert(saved);
            setEditing(null);
          }}
          onDeleted={(id) => {
            removed(id);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Right-side editor. Slides in over a scrim; Escape or a scrim click closes it.
 * Handles both adding (contact = null) and editing an existing row.
 */
function Drawer({
  contact,
  onClose,
  onSaved,
  onDeleted,
}: {
  contact: Contact | null;
  onClose: () => void;
  onSaved: (c: Contact) => void;
  onDeleted: (id: number) => void;
}) {
  const [name, setName] = useState(contact?.name ?? "");
  const [phone, setPhone] = useState(contact ? formatUsPhone(contact.phone) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const scrim = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    gsap.matchMedia().add(
      {
        motion: "(prefers-reduced-motion: no-preference)",
        reduced: "(prefers-reduced-motion: reduce)",
      },
      (ctx) => {
        const { reduced } = ctx.conditions as { reduced: boolean };
        gsap.from(scrim.current, { autoAlpha: 0, duration: reduced ? 0 : 0.3 });
        gsap.from(panel.current, {
          xPercent: reduced ? 0 : 100,
          autoAlpha: reduced ? 0 : 1,
          duration: reduced ? 0 : 0.5,
          ease: "mass",
        });
      }
    );
  });

  // Escape closes, matching the scrim click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    const normalized = normalizeUsPhone(phone);
    if (!normalized) {
      setError("Escribe un número de EE. UU. de 10 dígitos (con o sin el 1).");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const cleanName = name.trim();
      const saved = contact
        ? await api.updateContact(contact.id, { name: cleanName, phone: normalized })
        : await api.createContact({ name: cleanName, phone: normalized });
      onSaved(saved);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "No se pudo guardar. Intenta de nuevo."
      );
      setSaving(false);
    }
  }

  async function del() {
    if (!contact) return;
    setSaving(true);
    setError("");
    try {
      await api.deleteContact(contact.id);
      onDeleted(contact.id);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "No se pudo eliminar. Intenta de nuevo."
      );
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        ref={scrim}
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={contact ? "Editar contacto" : "Agregar contacto"}
        className="relative flex h-full w-full max-w-sm flex-col bg-[var(--surface-elevated)] shadow-[var(--shadow-lifted)]"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight">
            {contact ? "Editar contacto" : "Nuevo contacto"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex size-9 items-center justify-center rounded-full text-[var(--text-muted)] outline-none transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <X size={18} weight="light" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <Field label="Nombre">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Ana Ruiz"
              className={inputClass}
            />
          </Field>

          <Field label="Teléfono" required>
            <input
              value={phone}
              inputMode="tel"
              onChange={(e) => {
                setPhone(e.target.value);
                if (error) setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
              placeholder="Ej. 925 339 8990"
              className={cn(inputClass, "font-mono")}
            />
          </Field>

          {contact?.opted_in === false && (
            <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--text-muted)]">
              Este contacto no tiene consentimiento activo. Guardar lo reactiva —
              hazlo solo si tienes permiso para enviarle mensajes.
            </p>
          )}

          {error && (
            <p className="text-sm text-[var(--status-failed)]">{error}</p>
          )}
        </div>

        <div className="border-t border-[var(--border)] p-5">
          {contact && (
            <div className="mb-3">
              {confirmDelete ? (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-sm">
                  <span className="text-[var(--text-muted)]">¿Eliminar contacto?</span>
                  <span className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={del}
                      disabled={saving}
                      className="font-medium text-[var(--status-failed)] hover:underline disabled:opacity-50"
                    >
                      Sí, eliminar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      Cancelar
                    </button>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--status-failed)]"
                >
                  <Trash size={16} weight="light" aria-hidden="true" />
                  Eliminar contacto
                </button>
              )}
            </div>
          )}

          <Button
            variant="brand"
            loading={saving}
            onClick={save}
            className="w-full"
          >
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
