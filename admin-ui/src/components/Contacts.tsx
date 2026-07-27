import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  MagnifyingGlass,
  Plus,
  PencilSimple,
  Archive,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import type { Contact } from "../types";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/cn";
import { normalizeUsPhone, formatUsPhone } from "../lib/phone";
import { Button, Card, Spinner, inputClass } from "./ui";

type SubTab = "active" | "archived";

const reduceMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Contact manager. Two sub-tabs — Activos and Archivados — mirror Historial.
 * Editing happens in place; "Archivar" soft-archives a contact (it drops out of
 * Activos and the campaign audience picker but keeps its send history), and
 * "Restaurar" brings it back.
 */
export function Contacts({ onCount }: { onCount: (n: number | null) => void }) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<SubTab>("active");

  useEffect(() => {
    api
      .getAllContacts()
      .then(setContacts)
      .catch(() =>
        setError(
          "No se pudieron cargar los contactos. Recarga la página para reintentar."
        )
      );
  }, []);

  // The rail counts reachable (active) contacts.
  useEffect(() => {
    if (contacts) onCount(contacts.filter((c) => !c.archived_at).length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts]);

  const active = useMemo(
    () => (contacts ?? []).filter((c) => !c.archived_at),
    [contacts]
  );
  const archived = useMemo(
    () => (contacts ?? []).filter((c) => c.archived_at),
    [contacts]
  );

  const filtered = useMemo(() => {
    const base = tab === "active" ? active : archived;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (c) => c.phone.includes(q) || (c.name ?? "").toLowerCase().includes(q)
    );
  }, [tab, active, archived, query]);

  // Replace a contact in place (after edit or archive/restore). Archiving flips
  // archived_at, so the row simply falls out of the current tab's filter.
  function replace(updated: Contact) {
    setContacts((prev) =>
      (prev ?? []).map((c) => (c.id === updated.id ? updated : c))
    );
  }

  // A freshly created contact lands at the top of Activos. Clear any search so
  // the new row is visible instead of hidden behind a non-matching filter.
  function addContact(created: Contact) {
    setContacts((prev) => [created, ...(prev ?? [])]);
    setAdding(false);
    setQuery("");
    setTab("active");
  }

  const listRef = useRef<HTMLUListElement>(null);
  useGSAP(
    () => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        const rows = listRef.current?.querySelectorAll(":scope > li");
        if (!rows?.length) return;
        gsap.from(rows, {
          autoAlpha: 0,
          y: 8,
          duration: 0.45,
          ease: "mass",
          stagger: { each: 0.03, amount: Math.min(0.03 * rows.length, 0.5) },
          onStart: () => gsap.set(rows, { willChange: "transform, opacity" }),
          onComplete: () => gsap.set(rows, { clearProps: "willChange" }),
        });
      });
    },
    { dependencies: [query, tab], scope: listRef }
  );

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
    <Card padded={false}>
      <div className="space-y-3 p-4">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Sub-tabs live inside Contactos, the same way Historial splits
              active from archived — a view of this screen, not a nav change. */}
          <div
            role="tablist"
            className="inline-flex rounded-full bg-[var(--surface-sunken)] p-1"
          >
            {(
              [
                ["active", "Activos", active.length],
                ["archived", "Archivados", archived.length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  tab === key
                    ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-[var(--shadow-ambient)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                )}
              >
                {label} ({count})
              </button>
            ))}
          </div>

          {tab === "active" && !adding && (
            <Button
              variant="brand"
              className="shrink-0 px-4 py-2"
              onClick={() => {
                setEditingId(null);
                setAdding(true);
              }}
            >
              <Plus size={16} weight="bold" aria-hidden="true" />
              Agregar
            </Button>
          )}
        </div>

        {adding && (
          <AddContactForm
            onAdded={addContact}
            onCancel={() => setAdding(false)}
          />
        )}

        <div className="relative">
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
      </div>

      {filtered.length === 0 ? (
        <p className="border-t border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
          {query.trim()
            ? "Ningún contacto coincide con la búsqueda."
            : tab === "archived"
              ? "No hay contactos archivados."
              : "Aún no hay contactos. Agrega el primero."}
        </p>
      ) : (
        <ul
          ref={listRef}
          className="max-h-[32rem] overflow-y-auto border-t border-[var(--border)]"
        >
          {filtered.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              archived={tab === "archived"}
              isEditing={editingId === c.id}
              dimmed={editingId !== null && editingId !== c.id}
              onEnter={() => setEditingId(c.id)}
              onCancel={() => setEditingId(null)}
              onSaved={(u) => {
                replace(u);
                setEditingId(null);
              }}
              onArchived={replace}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Inline "new contact" form dropped in under the header when the user hits
 * Agregar. Mirrors the edit row — same inputs, same brand Guardar — so adding
 * and editing feel like one gesture. New contacts are asserted opted-in server
 * side, matching the contact-manager consent model.
 */
function AddContactForm({
  onAdded,
  onCancel,
}: {
  onAdded: (c: Contact) => void;
  onCancel: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useGSAP(
    () => {
      if (reduceMotion()) return;
      gsap.from(root.current, {
        autoAlpha: 0,
        y: -8,
        duration: 0.35,
        ease: "mass",
      });
    },
    { scope: root }
  );

  async function submit() {
    const normalized = normalizeUsPhone(phone);
    if (!normalized) {
      setError("Escribe un número de EE. UU. de 10 dígitos (con o sin el 1).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await api.createContact({
        name: name.trim(),
        phone: normalized,
      });
      // onAdded unmounts this form, so no need to reset busy on success.
      onAdded(created);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo agregar.");
      setBusy(false);
    }
  }

  return (
    <div
      ref={root}
      className="space-y-2.5 rounded-2xl bg-[var(--surface-sunken)] p-3"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre"
        className={inputClass}
      />
      <input
        value={phone}
        inputMode="tel"
        onChange={(e) => {
          setPhone(e.target.value);
          if (error) setError("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Teléfono"
        className={cn(inputClass, "font-mono")}
      />
      {error && <p className="text-xs text-[var(--status-failed)]">{error}</p>}
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-1.5 text-xs font-medium text-white outline-none transition-[filter,transform] duration-200 ease-[var(--ease-mass)] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--focus)] active:scale-[0.96] disabled:opacity-60"
        >
          {busy && <Spinner className="size-3.5" />}
          Agregar
        </button>
      </div>
    </div>
  );
}

function ContactRow({
  contact,
  archived,
  isEditing,
  dimmed,
  onEnter,
  onCancel,
  onSaved,
  onArchived,
}: {
  contact: Contact;
  archived: boolean;
  isEditing: boolean;
  dimmed: boolean;
  onEnter: () => void;
  onCancel: () => void;
  onSaved: (c: Contact) => void;
  onArchived: (c: Contact) => void;
}) {
  const root = useRef<HTMLLIElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const fields = useRef<HTMLDivElement>(null);
  const collapsedH = useRef(0);
  const firstDim = useRef(true);

  const [name, setName] = useState(contact.name ?? "");
  const [phone, setPhone] = useState(formatUsPhone(contact.phone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useGSAP(
    () => {
      if (!isEditing) return;
      if (reduceMotion()) return;
      gsap.from(inner.current, {
        height: collapsedH.current,
        duration: 0.4,
        ease: "mass",
      });
      gsap.set(root.current, { position: "relative", zIndex: 10 });
      gsap.fromTo(
        root.current,
        { scale: 1, boxShadow: "0 0 0 0 rgba(0,0,0,0)" },
        {
          scale: 1.02,
          boxShadow: "var(--shadow-lifted)",
          backgroundColor: "var(--surface-elevated)",
          duration: 0.4,
          ease: "mass",
        }
      );
      gsap.from(fields.current, {
        autoAlpha: 0,
        y: 6,
        duration: 0.3,
        delay: 0.08,
      });
    },
    { dependencies: [isEditing], scope: root }
  );

  useGSAP(
    () => {
      if (firstDim.current) {
        firstDim.current = false;
        return;
      }
      gsap.to(root.current, {
        opacity: dimmed ? 0.35 : 1,
        duration: 0.3,
        ease: "mass",
        overwrite: "auto",
      });
      gsap.set(root.current, { pointerEvents: dimmed ? "none" : "auto" });
    },
    { dependencies: [dimmed] }
  );

  function startEdit() {
    collapsedH.current = inner.current?.offsetHeight ?? 0;
    setName(contact.name ?? "");
    setPhone(formatUsPhone(contact.phone));
    setError("");
    onEnter();
  }

  function collapse(): Promise<void> {
    return new Promise((resolve) => {
      if (reduceMotion() || !root.current || !inner.current) return resolve();
      gsap
        .timeline({
          onComplete: () => {
            gsap.set([root.current, inner.current], { clearProps: "all" });
            resolve();
          },
        })
        .to(inner.current, { height: collapsedH.current, duration: 0.35, ease: "mass" }, 0)
        .to(
          root.current,
          {
            scale: 1,
            boxShadow: "0 0 0 0 rgba(0,0,0,0)",
            backgroundColor: "rgba(0,0,0,0)",
            duration: 0.35,
            ease: "mass",
          },
          0
        );
    });
  }

  async function save() {
    const normalized = normalizeUsPhone(phone);
    if (!normalized) {
      setError("Escribe un número de EE. UU. de 10 dígitos (con o sin el 1).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await api.updateContact(contact.id, {
        name: name.trim(),
        phone: normalized,
      });
      await collapse();
      onSaved(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    await collapse();
    onCancel();
  }

  // Archive (from Activos) or restore (from Archivados): the row swipes out of
  // the current tab, then its archived_at flips so it lands in the other one.
  async function toggleArchive() {
    setBusy(true);
    setError("");
    let updated: Contact;
    try {
      updated = await api.archiveContact(contact.id, !archived);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : archived
            ? "No se pudo restaurar."
            : "No se pudo archivar."
      );
      setBusy(false);
      return;
    }
    if (reduceMotion() || !root.current) {
      onArchived(updated);
      return;
    }
    gsap
      .timeline({ onComplete: () => onArchived(updated) })
      .to(root.current, {
        xPercent: -110,
        autoAlpha: 0,
        duration: 0.4,
        ease: "power2.in",
      })
      .set(root.current, { overflow: "hidden" })
      .to(root.current, {
        height: 0,
        paddingTop: 0,
        paddingBottom: 0,
        duration: 0.25,
        ease: "power2.inOut",
      });
  }

  return (
    <li ref={root} className="border-b border-[var(--border)] last:border-b-0">
      <div ref={inner} className="overflow-hidden px-4 py-3">
        {isEditing ? (
          <div ref={fields} className="space-y-2.5">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre"
              className={inputClass}
            />
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
              placeholder="Teléfono"
              className={cn(inputClass, "font-mono")}
            />
            {error && (
              <p className="text-xs text-[var(--status-failed)]">{error}</p>
            )}
            <div className="flex items-center justify-end gap-2 pt-0.5">
              <button
                type="button"
                onClick={cancel}
                disabled={busy}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-1.5 text-xs font-medium text-white outline-none transition-[filter,transform] duration-200 ease-[var(--ease-mass)] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--focus)] active:scale-[0.96] disabled:opacity-60"
              >
                {busy && <Spinner className="size-3.5" />}
                Guardar
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {contact.name || (
                      <span className="text-[var(--text-muted)]">Sin nombre</span>
                    )}
                  </span>
                  {contact.opted_in === false && (
                    <span className="shrink-0 rounded-full bg-[var(--brand)] px-2 py-0.5 text-[11px] font-medium text-white">
                      no recibe mensajes
                    </span>
                  )}
                </div>
                <span className="mt-0.5 block font-mono text-sm text-[var(--text-muted)]">
                  {formatUsPhone(contact.phone)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {archived ? (
                  <RowButton
                    tone="navy"
                    onClick={toggleArchive}
                    disabled={busy}
                    icon={
                      busy ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <ArrowCounterClockwise size={15} weight="bold" />
                      )
                    }
                  >
                    Restaurar
                  </RowButton>
                ) : (
                  <>
                    <RowButton
                      tone="navy"
                      onClick={startEdit}
                      icon={<PencilSimple size={15} weight="bold" />}
                    >
                      Editar
                    </RowButton>
                    <RowButton
                      tone="red"
                      onClick={toggleArchive}
                      disabled={busy}
                      icon={
                        busy ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <Archive size={15} weight="bold" />
                        )
                      }
                    >
                      Archivar
                    </RowButton>
                  </>
                )}
              </div>
            </div>
            {error && (
              <p className="mt-2 text-xs text-[var(--status-failed)]">{error}</p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** Per-row action pill: navy for edit/restore, red for archive; white type. */
function RowButton({
  tone,
  icon,
  children,
  onClick,
  disabled,
}: {
  tone: "navy" | "red";
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex touch-manipulation items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white outline-none transition-[filter,transform] duration-200 ease-[var(--ease-mass)] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-1 active:scale-[0.96] disabled:opacity-50",
        tone === "navy" ? "bg-[var(--primary)]" : "bg-[var(--status-failed)]"
      )}
    >
      {icon}
      {children}
    </button>
  );
}
