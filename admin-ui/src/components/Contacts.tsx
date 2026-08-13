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
  PaperPlaneTilt,
} from "@phosphor-icons/react";
import { countContacts, type Contact, type ContactCounts } from "../types";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/cn";
import { normalizeUsPhone, formatUsPhone } from "../lib/phone";
import { Button, Card, Spinner, inputClass } from "./ui";

type SubTab = "active" | "archived";

// The list is a 32rem scroller showing about seven rows, but every mounted row
// costs 11 hooks including two gsap contexts. Rendering the whole directory to
// show seven was what made switching to this tab stutter, so rows come in a
// page at a time as you scroll. The first page is smaller than the rest: it is
// the one the tab switch has to pay for, while later pages arrive during a
// scroll that is already in motion.
const FIRST_PAGE = 15;
const PAGE = 20;

// How many rows get the entrance stagger — the whole first page, so no row can
// pop in at full opacity next to one still animating. Later pages arrive
// already visible.
const REVEAL_ROWS = FIRST_PAGE;

const reduceMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Contact manager. Two sub-tabs — Activos and Archivados — mirror Historial.
 * Editing happens in place; "Archivar" soft-archives a contact (it drops out of
 * Activos and the campaign audience picker but keeps its send history), and
 * "Restaurar" brings it back.
 */
export function Contacts({
  onCounts,
  onSendSms,
}: {
  onCounts: (c: ContactCounts | null) => void;
  onSendSms?: (contactId: number) => void;
}) {
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

  // The rail counts active contacts, and separately how many of them opted out.
  // Archived contacts are excluded from both: they are out of play entirely.
  useEffect(() => {
    if (contacts) onCounts(countContacts(contacts));
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
  const sentinel = useRef<HTMLLIElement>(null);
  const [limit, setLimit] = useState(FIRST_PAGE);

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
  const hasMore = limit < filtered.length;

  // A new filter or tab is a new list; start counting again from the top.
  useEffect(() => {
    setLimit(FIRST_PAGE);
  }, [query, tab]);

  // Grow as the sentinel scrolls into the list's own scrollport. rootMargin
  // loads the next page slightly early so scrolling never lands on a gap.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLimit((l) => l + PAGE);
        }
      },
      { root: listRef.current, rootMargin: "200px" }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, visible.length]);

  // Entrance stagger, on mount and tab switch only. Two things matter here:
  // fromTo rather than from, because from() animates towards whatever opacity a
  // row happens to have, so restarting it mid-tween pinned rows at that partial
  // value instead of 1; and `query` is not a dependency, because re-running a
  // 0.45s stagger on every keystroke both caused that and flickered.
  useGSAP(
    () => {
      const all = listRef.current?.querySelectorAll(":scope > li:not([data-sentinel])");
      if (!all?.length) return;
      // Only the rows that can plausibly be on screen are animated. Tweening all
      // 300 would set will-change on 300 elements at once — 300 compositor
      // layers — for rows nobody can see. The rest simply start visible.
      const rows = Array.from(all).slice(0, REVEAL_ROWS);
      if (reduceMotion()) {
        gsap.set(rows, { autoAlpha: 1, y: 0 });
        return;
      }
      gsap.fromTo(
        rows,
        { autoAlpha: 0, y: 8 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.45,
          ease: "mass",
          overwrite: "auto",
          stagger: { each: 0.03, amount: Math.min(0.03 * rows.length, 0.5) },
          onStart: () => gsap.set(rows, { willChange: "transform, opacity" }),
          onComplete: () => gsap.set(rows, { clearProps: "willChange" }),
        }
      );
    },
    { dependencies: [tab], scope: listRef }
  );

  // Filtering re-keys the list, so rows can mount while the stagger above still
  // holds earlier ones at partial opacity. Snap whatever is on screen to
  // visible; the search results appear instantly rather than animating.
  useGSAP(
    () => {
      const rows = listRef.current?.querySelectorAll(
        ":scope > li:not([data-sentinel])"
      );
      if (rows?.length) gsap.set(rows, { autoAlpha: 1, y: 0 });
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
          {visible.map((c) => (
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
              onSendSms={onSendSms}
            />
          ))}
          {/* Only while more rows remain, so a fully-loaded list keeps
              last:border-b-0 on its real last row. */}
          {hasMore && <li ref={sentinel} data-sentinel aria-hidden="true" />}
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
        onChange={(e) => setName(e.target.value.replace(/\d/g, ""))}
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
        className={cn(inputClass, "font-phone")}
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
  onSendSms,
}: {
  contact: Contact;
  archived: boolean;
  isEditing: boolean;
  dimmed: boolean;
  onEnter: () => void;
  onCancel: () => void;
  onSaved: (c: Contact) => void;
  onArchived: (c: Contact) => void;
  onSendSms?: (contactId: number) => void;
}) {
  const root = useRef<HTMLLIElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const fields = useRef<HTMLDivElement>(null);
  const firstDim = useRef(true);

  const [name, setName] = useState(contact.name ?? "");
  const [phone, setPhone] = useState(formatUsPhone(contact.phone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useGSAP(
    () => {
      if (!isEditing) return;
      if (reduceMotion()) return;
      gsap.set(root.current, { position: "relative", zIndex: 10 });
      gsap.fromTo(
        root.current,
        { scale: 0.99, autoAlpha: 0.7 },
        {
          scale: 1,
          autoAlpha: 1,
          duration: 0.25,
          ease: "mass",
          overwrite: "auto",
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
    setName(contact.name ?? "");
    setPhone(formatUsPhone(contact.phone));
    setError("");
    onEnter();
  }

  function collapse(): Promise<void> {
    // Do not tween height/shadow here: those properties force a layout/paint
    // pass every frame in a scrollable directory. Saving/cancelling swaps the
    // inline form immediately; its parent uses transform/opacity only on entry.
    return Promise.resolve();
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
    gsap.to(root.current, {
      xPercent: -110,
      autoAlpha: 0,
      duration: 0.25,
      ease: "power2.in",
      onComplete: () => onArchived(updated),
    });
  }

  return (
    // content-visibility lets the browser skip layout and paint for off-screen
    // rows, which is what keeps a 300-row directory smooth. It is dropped while
    // editing: the mode carries paint containment, and that would clip the
    // expanded row's scale and box-shadow to its own bounds.
    <li
      ref={root}
      className={cn(
        "border-b border-[var(--border)] last:border-b-0",
        !isEditing && "[content-visibility:auto] [contain-intrinsic-size:auto_67px]"
      )}
    >
      <div ref={inner} className="overflow-hidden px-4 py-3">
        {isEditing ? (
          <div ref={fields} className="space-y-2.5">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\d/g, ""))}
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
              className={cn(inputClass, "font-phone")}
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
                <span className="mt-0.5 block font-phone text-sm text-[var(--text-muted)]">
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
                      tone="green"
                      onClick={() => onSendSms?.(contact.id)}
                      icon={<PaperPlaneTilt size={15} weight="bold" />}
                    >
                      Enviar SMS
                    </RowButton>
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

/** Per-row action pill: navy for edit/restore, red for archive, green for send; white type. */
function RowButton({
  tone,
  icon,
  children,
  onClick,
  disabled,
}: {
  tone: "navy" | "red" | "green";
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
        tone === "navy" ? "bg-[var(--primary)]" : tone === "green" ? "bg-[var(--status-completed)]" : "bg-[var(--status-failed)]"
      )}
    >
      {icon}
      {children}
    </button>
  );
}
