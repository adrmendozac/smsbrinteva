import { useMemo, useState } from "react";
import { Sparkle, PaperPlaneTilt, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import type { Contact } from "../types";
import { api, ApiError } from "../lib/api";
import { sanitizeForSMS, smsSegments } from "../lib/sms";
import { Button, Card, Field, inputClass } from "./ui";
import { AudiencePicker } from "./AudiencePicker";

type Mode = "now" | "later";
type Result = { kind: "ok"; text: string } | { kind: "err"; text: string } | null;

export function Composer({
  contacts,
  onCreated,
}: {
  contacts: Contact[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [csvPhones, setCsvPhones] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<Mode>("now");
  const [scheduledAt, setScheduledAt] = useState("");

  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const sanitized = useMemo(() => sanitizeForSMS(message), [message]);
  const segments = smsSegments(sanitized.length);
  const approxRecipients = selectedIds.size + csvPhones.length;

  function toggleContact(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function suggest() {
    if (!message.trim()) {
      setResult({
        kind: "err",
        text: "Escribe una idea breve y luego usa Sugerir con IA.",
      });
      return;
    }
    setResult(null);
    setSuggesting(true);
    try {
      const { text } = await api.suggest(message.trim());
      setMessage(text);
    } catch (e) {
      setResult({
        kind: "err",
        text: e instanceof ApiError ? e.message : "No se pudo sugerir.",
      });
    } finally {
      setSuggesting(false);
    }
  }

  const canSend =
    name.trim() !== "" &&
    sanitized !== "" &&
    approxRecipients > 0 &&
    (mode === "now" || scheduledAt !== "");

  async function send() {
    setResult(null);
    setSubmitting(true);
    try {
      const scheduledIso =
        mode === "later" && scheduledAt
          ? new Date(scheduledAt).toISOString()
          : null;
      const { id, total } = await api.createCampaign({
        name: name.trim(),
        body: message,
        contactIds: [...selectedIds],
        phones: csvPhones,
        scheduledAt: scheduledIso,
      });

      if (mode === "now") {
        await api.sendCampaign(id);
        setResult({
          kind: "ok",
          text: `Campaña creada y enviando a ${total} destinatario${total === 1 ? "" : "s"}.`,
        });
      } else {
        setResult({
          kind: "ok",
          text: `Campaña programada para ${total} destinatario${total === 1 ? "" : "s"}.`,
        });
      }

      // Reset the form, keep the audience tools cleared.
      setName("");
      setMessage("");
      setSelectedIds(new Set());
      setCsvPhones([]);
      setScheduledAt("");
      onCreated();
    } catch (e) {
      setResult({
        kind: "err",
        text: e instanceof ApiError ? e.message : "No se pudo enviar.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <Field label="Nombre de la campaña">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Promo Italia · Junio"
            className={inputClass}
          />
        </Field>

        <Field
          label="Audiencia"
          hint={`≈ ${approxRecipients} destinatario${approxRecipients === 1 ? "" : "s"}`}
        >
          <AudiencePicker
            contacts={contacts}
            selectedIds={selectedIds}
            onToggleContact={toggleContact}
            csvPhones={csvPhones}
            onCsvPhones={setCsvPhones}
          />
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            Se eliminan duplicados y quienes cancelaron (opt-out) al momento de enviar.
          </p>
        </Field>
      </Card>

      <Card className="space-y-3">
        <Field
          label="Mensaje"
          hint={
            <span>
              {sanitized.length} car. · {segments} SMS
            </span>
          }
        >
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="Escribe el mensaje, o una idea breve y pulsa “Sugerir con IA”."
            className={`${inputClass} resize-y`}
          />
        </Field>

        {message !== sanitized && (
          <p className="text-xs text-[var(--text-muted)]">
            Se enviará sin acentos ni emojis:{" "}
            <span className="font-mono">{sanitized.slice(0, 80)}</span>
            {sanitized.length > 80 ? "…" : ""}
          </p>
        )}

        <Button variant="secondary" onClick={suggest} loading={suggesting} type="button">
          <Sparkle size={16} weight="fill" /> Sugerir con IA
        </Button>
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <Radio
            checked={mode === "now"}
            onChange={() => setMode("now")}
            label="Enviar ahora"
          />
          <Radio
            checked={mode === "later"}
            onChange={() => setMode("later")}
            label="Programar"
          />
          {mode === "later" && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className={`${inputClass} max-w-xs`}
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={send} loading={submitting} disabled={!canSend}>
            <PaperPlaneTilt size={16} weight="fill" />
            {mode === "now" ? "Enviar" : "Programar"}
          </Button>
          {result && (
            <span
              className={`inline-flex items-center gap-1.5 text-sm ${
                result.kind === "ok"
                  ? "text-[var(--status-completed)]"
                  : "text-[var(--status-failed)]"
              }`}
            >
              {result.kind === "ok" ? (
                <CheckCircle size={16} weight="fill" />
              ) : (
                <WarningCircle size={16} weight="fill" />
              )}
              {result.text}
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}

function Radio({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="accent-[var(--primary)]"
      />
      {label}
    </label>
  );
}
