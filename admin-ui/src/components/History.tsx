import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise, CaretDown } from "@phosphor-icons/react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import type { Campaign } from "../types";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { formatDateTime } from "../lib/format";
import { Button, Card, Spinner, StatusPill } from "./ui";
import { Recipients } from "./Recipients";

export function History({
  refreshSignal,
  onLoaded,
}: {
  refreshSignal: number;
  onLoaded?: (c: Campaign[]) => void;
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // One campaign open at a time -- recipient lists are long, and comparing two
  // at once is not something this screen is for.
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listCampaigns();
      setCampaigns(list);
      onLoaded?.(list);
      setError("");
    } catch {
      setError("No se pudo cargar el historial. Pulsa Actualizar para reintentar.");
    } finally {
      setLoading(false);
    }
  }, [onLoaded]);

  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  // Poll while anything is in flight so live counts update.
  const inFlight = campaigns.some(
    (c) => c.status === "sending" || c.status === "scheduled"
  );
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [inFlight, load]);

  if (loading) {
    return (
      <div className="flex justify-center py-12 text-[var(--text-muted)]">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Row centres on mobile to match the rail above it; the cards below stay
          left-aligned so the data keeps a single reading edge. */}
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
        <h2 className="text-sm font-medium text-[var(--text-muted)]">
          {campaigns.length} campaña{campaigns.length === 1 ? "" : "s"}
        </h2>
        <Button variant="ghost" onClick={load} type="button">
          <ArrowClockwise size={16} weight="light" aria-hidden="true" /> Actualizar
        </Button>
      </div>

      {error && (
        <p className="text-center text-sm text-[var(--status-failed)] sm:text-left">
          {error}
        </p>
      )}

      {campaigns.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">
            Aún no hay campañas.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => (
            <li key={c.id}>
              <CampaignRow
                campaign={c}
                expanded={expandedId === c.id}
                onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignRow({
  campaign: c,
  expanded,
  onToggle,
}: {
  campaign: Campaign;
  expanded: boolean;
  onToggle: () => void;
}) {
  const live = c.status === "sending";
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const caret = useRef<SVGSVGElement>(null);

  // The panel mounts/unmounts with `expanded`, so animate height from 0 to auto
  // on open. CSS cannot interpolate to auto; GSAP measures it.
  useGSAP(
    () => {
      // Weighted spring-like curve rather than a stock ease; motion should read
      // as mass settling, not a linear slide.
      // Registered in main.tsx; GSAP will not parse a raw cubic-bezier string.
      const EASE = "mass";

      gsap.matchMedia().add(
        {
          motion: "(prefers-reduced-motion: no-preference)",
          reduced: "(prefers-reduced-motion: reduce)",
        },
        (ctx) => {
          const { reduced } = ctx.conditions as { reduced: boolean };

          gsap.to(caret.current, {
            rotate: expanded ? 180 : 0,
            duration: reduced ? 0 : 0.4,
            ease: EASE,
          });

          if (!expanded || !panel.current) return;

          // Height cannot be interpolated to `auto` in CSS, so GSAP measures it.
          // The trade-off is a layout-triggering property -- acceptable here
          // because it animates one small panel, not a scrolling surface.
          gsap.fromTo(
            panel.current,
            { height: 0, opacity: 0 },
            {
              height: "auto",
              opacity: 1,
              duration: reduced ? 0 : 0.5,
              ease: EASE,
            }
          );
        }
      );
    },
    { dependencies: [expanded], scope: root }
  );

  return (
    <Card ref={root} padded={false}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`recipients-${c.id}`}
        className="flex w-full touch-manipulation items-start gap-4 p-5 text-left outline-none transition-[background-color] duration-300 ease-[var(--ease-mass)] hover:bg-[var(--surface-sunken)]/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
      >
        <CaretDown
          ref={caret}
          size={16}
          weight="light"
          aria-hidden="true"
          className="mt-1 shrink-0 text-[var(--text-muted)] [transform-box:fill-box] [transform-origin:center]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{c.name}</span>
            <StatusPill status={c.status} />
          </div>
          <p className="mt-1 truncate text-sm text-[var(--text-muted)]">{c.body}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
            <span>Creada {formatDateTime(c.created_at)}</span>
            {c.scheduled_at && <span>Programada {formatDateTime(c.scheduled_at)}</span>}
            {c.created_by && <span>por {c.created_by}</span>}
          </div>
        </div>
        <Counts campaign={c} />
      </button>

      {expanded && (
        <div
          ref={panel}
          id={`recipients-${c.id}`}
          className="overflow-hidden border-t border-[var(--border)]"
        >
          <Recipients campaignId={c.id} live={live} />
        </div>
      )}
    </Card>
  );
}

function Counts({ campaign }: { campaign: Campaign }) {
  const { sent_count, failed_count, total_count } = campaign;
  return (
    <div className="shrink-0 text-right">
      <div className="text-lg font-semibold tabular-nums">
        {sent_count}
        <span className="text-sm font-normal text-[var(--text-muted)]">
          /{total_count}
        </span>
      </div>
      <div className="text-xs text-[var(--text-muted)]">enviados</div>
      {failed_count > 0 && (
        <div className="text-xs text-[var(--status-failed)]">
          {failed_count} fallidos
        </div>
      )}
    </div>
  );
}
