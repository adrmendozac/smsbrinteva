import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { MagnifyingGlass, Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import type { Contact } from "../types";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/cn";
import { normalizeUsPhone, formatUsPhone } from "../lib/phone";
import { Button, Card, Spinner, inputClass } from "./ui";

const reduceMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Contact manager: the whole book, opted-in or not. Editing happens in place —
 * the chosen row grows and lifts while the rest recede; deleting swipes the row
 * out to the left. Distinct from the audience picker, which hides opted-out
 * people; here they stay, tagged.
 */
export function Contacts({ onCount }: { onCount: (n: number | null) => void }) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

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
    // Load once on mount; onCount is a stable setState.
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

  function saved(updated: Contact) {
    setContacts((prev) =>
      (prev ?? []).map((c) => (c.id === updated.id ? updated : c))
    );
    setEditingId(null);
  }

  function deleted(id: number) {
    setContacts((prev) => {
      const next = (prev ?? []).filter((c) => c.id !== id);
      onCount(next.length);
      return next;
    });
  }

  // Deal the rows in behind the card on load and when the search changes — but
  // not when a single row is edited or deleted (those keyed on `query`, which
  // neither touches). Reduced-motion skips it.
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
    { dependencies: [query], scope: listRef }
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
        <Button variant="brand" className="shrink-0 px-4 py-2">
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
        <ul
          ref={listRef}
          className="max-h-[32rem] overflow-y-auto border-t border-[var(--border)]"
        >
          {filtered.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              isEditing={editingId === c.id}
              dimmed={editingId !== null && editingId !== c.id}
              onEnter={() => setEditingId(c.id)}
              onCancel={() => setEditingId(null)}
              onSaved={saved}
              onDeleted={deleted}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ContactRow({
  contact,
  isEditing,
  dimmed,
  onEnter,
  onCancel,
  onSaved,
  onDeleted,
}: {
  contact: Contact;
  isEditing: boolean;
  dimmed: boolean;
  onEnter: () => void;
  onCancel: () => void;
  onSaved: (c: Contact) => void;
  onDeleted: (id: number) => void;
}) {
  const root = useRef<HTMLLIElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const fields = useRef<HTMLDivElement>(null);
  // Height the row had in display mode, captured the instant before it expands,
  // so the grow/collapse can animate between two real pixel heights.
  const collapsedH = useRef(0);
  const firstDim = useRef(true);

  const [name, setName] = useState(contact.name ?? "");
  const [phone, setPhone] = useState(formatUsPhone(contact.phone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Grow + lift when this row enters edit mode. The collapse back is run
  // imperatively from save/cancel so it can finish before React swaps the row
  // back to its display form.
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

  // Recede the other rows while one is being edited.
  useGSAP(
    () => {
      if (firstDim.current) {
        firstDim.current = false; // don't fight the entrance stagger on mount
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
    // Capture the resting height, then reset the draft to the live values.
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
      setBusy(false);
    }
  }

  async function cancel() {
    await collapse();
    onCancel();
  }

  async function del() {
    setBusy(true);
    setError("");
    try {
      await api.deleteContact(contact.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo eliminar.");
      setBusy(false);
      return;
    }
    if (reduceMotion() || !root.current) {
      onDeleted(contact.id);
      return;
    }
    // Swipe out to the left, then close the gap it leaves behind.
    gsap
      .timeline({ onComplete: () => onDeleted(contact.id) })
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
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">
                  {contact.name || (
                    <span className="text-[var(--text-muted)]">Sin nombre</span>
                  )}
                </span>
                {contact.opted_in === false && (
                  <span className="shrink-0 rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
                    sin consentimiento
                  </span>
                )}
              </div>
              <span className="mt-0.5 block font-mono text-sm text-[var(--text-muted)]">
                {formatUsPhone(contact.phone)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <RowButton
                tone="navy"
                onClick={startEdit}
                icon={<PencilSimple size={15} weight="bold" />}
              >
                Editar
              </RowButton>
              <RowButton
                tone="red"
                onClick={del}
                disabled={busy}
                icon={<Trash size={15} weight="bold" />}
              >
                Eliminar
              </RowButton>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

/** Per-row action pill: navy for edit, red for delete, white type on both. */
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
