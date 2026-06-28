import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import type { Campaign } from "../types";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Button, Card, Spinner, StatusPill } from "./ui";

export function History({ refreshSignal }: { refreshSignal: number }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setCampaigns(await api.listCampaigns());
      setError("");
    } catch {
      setError("No se pudo cargar el historial.");
    } finally {
      setLoading(false);
    }
  }, []);

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
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--text-muted)]">
          {campaigns.length} campaña{campaigns.length === 1 ? "" : "s"}
        </h2>
        <Button variant="ghost" onClick={load} type="button">
          <ArrowClockwise size={16} /> Actualizar
        </Button>
      </div>

      {error && (
        <p className="text-sm text-[var(--status-failed)]">{error}</p>
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
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <StatusPill status={c.status} />
                    </div>
                    <p className="mt-1 truncate text-sm text-[var(--text-muted)]">
                      {c.body}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                      <span>Creada {formatDateTime(c.created_at)}</span>
                      {c.scheduled_at && (
                        <span>Programada {formatDateTime(c.scheduled_at)}</span>
                      )}
                      {c.created_by && <span>por {c.created_by}</span>}
                    </div>
                  </div>
                  <Counts campaign={c} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
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
