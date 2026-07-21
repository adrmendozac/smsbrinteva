import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Check, Copy, Warning } from "@phosphor-icons/react";
import type { CampaignDetail, Recipient, RecipientStatus } from "../types";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { formatPhone, formatTime, recipientStatusLabel } from "../lib/format";
import { Spinner } from "./ui";

type Filter = "all" | RecipientStatus;

const STATUS_COLOR: Record<RecipientStatus, string> = {
  delivered: "var(--status-completed)",
  sent: "var(--status-scheduled)",
  failed: "var(--status-failed)",
  pending: "var(--status-sending)",
  opted_out: "var(--status-draft)",
};

// Delivered first: it is the outcome that actually answers "did it arrive?".
// "sent" now means accepted by the carrier but no receipt back yet.
const ORDER: RecipientStatus[] = [
  "delivered",
  "sent",
  "failed",
  "pending",
  "opted_out",
];

/**
 * Which numbers a campaign actually reached. Loads on expand rather than with
 * the history list, so opening one campaign never pulls every recipient row.
 */
export function Recipients({ campaignId, live }: { campaignId: number; live: boolean }) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getCampaign(campaignId)
        .then((d) => {
          if (!cancelled) setDetail(d);
        })
        .catch(() => {
          if (!cancelled)
            setError(
              "No se pudo cargar la lista de destinatarios. Cierra y vuelve a abrir la campaña para reintentar."
            );
        });

    load();
    if (!live) return () => { cancelled = true; };
    // Keep the list moving while the campaign is still going out.
    const t = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [campaignId, live]);

  const recipients = useMemo(() => detail?.recipients ?? [], [detail]);

  const tallies = useMemo(() => {
    const t: Partial<Record<RecipientStatus, number>> = {};
    for (const r of recipients) t[r.status] = (t[r.status] ?? 0) + 1;
    return t;
  }, [recipients]);

  const shown = filter === "all" ? recipients : recipients.filter((r) => r.status === filter);

  // Stagger the rows in behind the panel opening. Capped so a 500-recipient
  // campaign does not spend three seconds dealing itself out, and skipped
  // entirely under prefers-reduced-motion.
  const listRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("tbody tr", {
          opacity: 0,
          y: -4,
          duration: 0.25,
          ease: "mass",
          stagger: { each: 0.02, amount: Math.min(0.02 * shown.length, 0.4) },
        });
      });
    },
    { dependencies: [filter, shown.length], scope: listRef }
  );

  async function copyNumbers() {
    try {
      await navigator.clipboard.writeText(shown.map((r) => r.phone).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
        setError(
        "El navegador bloqueó el portapapeles. Selecciona los números en la tabla y cópialos manualmente."
      );
    }
  }

  if (error) {
    return <p className="px-5 py-4 text-sm text-[var(--status-failed)]">{error}</p>;
  }

  if (!detail) {
    return (
      <div className="flex justify-center py-8 text-[var(--text-muted)]">
        <Spinner />
      </div>
    );
  }

  if (recipients.length === 0) {
    return (
      <p className="px-5 py-4 text-sm text-[var(--text-muted)]">
        Esta campaña todavía no tiene destinatarios.
      </p>
    );
  }

  return (
    <div ref={listRef}>
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          Todos {recipients.length}
        </Chip>
        {ORDER.filter((s) => tallies[s]).map((s) => (
          <Chip
            key={s}
            active={filter === s}
            onClick={() => setFilter(s)}
            color={STATUS_COLOR[s]}
          >
            {recipientStatusLabel(s)} {tallies[s]}
          </Chip>
        ))}

        <button
          type="button"
          onClick={copyNumbers}
          className="ml-auto inline-flex touch-manipulation items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-muted)] outline-none transition-[color,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] active:scale-[0.98]"
        >
          {copied ? (
            <Check size={14} weight="light" aria-hidden="true" />
          ) : (
            <Copy size={14} weight="light" aria-hidden="true" />
          )}
          <span aria-live="polite">{copied ? "Copiados" : "Copiar números"}</span>
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-[var(--text-muted)]">
          Ningún destinatario con este estado.
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto overscroll-contain border-t border-[var(--border)]">
          <table className="w-full text-sm tabular-nums">
            <thead className="sticky top-0 z-10 bg-[var(--surface-sunken)] text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-5 py-2 font-medium">Número</th>
                <th className="px-5 py-2 font-medium">Estado</th>
                <th className="px-5 py-2 text-right font-medium">Hora</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Row key={r.id} recipient={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ recipient: r }: { recipient: Recipient }) {
  const color = STATUS_COLOR[r.status];
  return (
    // content-visibility lets the browser skip layout for off-screen rows, so a
    // 500-recipient campaign scrolls without virtualising the table.
    <tr
      className="border-t border-[var(--border)] [content-visibility:auto] [contain-intrinsic-size:auto_37px]"
    >
      <td className="px-5 py-2 whitespace-nowrap">
        <span className="font-mono tabular-nums">{formatPhone(r.phone)}</span>
        {r.name && (
          <span className="ml-2 text-xs text-[var(--text-muted)]">{r.name}</span>
        )}
      </td>
      <td className="px-5 py-2">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap" style={{ color }}>
          <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
          {recipientStatusLabel(r.status)}
        </span>
        {r.error && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <Warning size={12} /> {r.error}
          </span>
        )}
      </td>
      <td className="px-5 py-2 text-right tabular-nums whitespace-nowrap text-[var(--text-muted)]">
        {formatTime(r.sent_at)}
      </td>
    </tr>
  );
}

function Chip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
        active
          ? "border-transparent bg-[var(--primary)] text-[var(--primary-fg)]"
          : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
      )}
    >
      {color && !active && (
        <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      )}
      {children}
    </button>
  );
}
