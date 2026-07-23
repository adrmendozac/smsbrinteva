import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { MagnifyingGlass, Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import type { Contact } from "../types";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { formatUsPhone } from "../lib/phone";
import { Button, Card, Spinner, inputClass } from "./ui";

/**
 * Contact manager: the whole book, opted-in or not. Each row carries its own
 * Edit and Delete actions on the right, so maintaining a contact never leaves
 * the list. Distinct from the audience picker, which hides opted-out people;
 * here they stay, tagged.
 */
export function Contacts({ onCount }: { onCount: (n: number | null) => void }) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

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

  // Deal the rows in behind the card, capped so a long book does not crawl.
  // Skipped under prefers-reduced-motion; will-change is promoted for the tween
  // only, then released.
  const listRef = useRef<HTMLUListElement>(null);
  useGSAP(
    () => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        const rows = listRef.current?.querySelectorAll("li");
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
    { dependencies: [filtered.length], scope: listRef }
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
        <ul ref={listRef} className="max-h-[32rem] overflow-y-auto border-t border-[var(--border)]">
          {filtered.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0"
            >
              {/* Identity on the far left. */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
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
                </div>
                <span className="mt-0.5 block font-mono text-sm text-[var(--text-muted)]">
                  {formatUsPhone(c.phone)}
                </span>
              </div>

              {/* Actions on the far right. Not wired yet — visual only. */}
              <div className="flex shrink-0 items-center gap-2">
                <RowButton tone="navy" icon={<PencilSimple size={15} weight="bold" />}>
                  Editar
                </RowButton>
                <RowButton tone="red" icon={<Trash size={15} weight="bold" />}>
                  Eliminar
                </RowButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Per-row action pill. Navy for edit, red for delete, white type on both. A
 * small press-scale + weighted ease so the control feels physical, matching the
 * app's primary Button. No handler yet — these are placeholders for the edit
 * and delete flows.
 */
function RowButton({
  tone,
  icon,
  children,
}: {
  tone: "navy" | "red";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex touch-manipulation items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white outline-none transition-[filter,transform] duration-200 ease-[var(--ease-mass)] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-1 active:scale-[0.96]",
        tone === "navy"
          ? "bg-[var(--primary)]"
          : "bg-[var(--status-failed)]"
      )}
    >
      {icon}
      {children}
    </button>
  );
}
