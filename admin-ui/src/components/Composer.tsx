import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkle,
  PaperPlaneTilt,
  CheckCircle,
  WarningCircle,
  Image as ImageIcon,
  X,
} from "@phosphor-icons/react";
import type { Contact, UploadedMedia } from "../types";
import { api, ApiError, MediaConflictError } from "../lib/api";
import { sanitizeForSMS, smsSegments } from "../lib/sms";
import { cn } from "../lib/cn";
import { Button, Card, Field, Spinner, inputClass } from "./ui";
import { AudiencePicker } from "./AudiencePicker";
import { SchedulePicker } from "./SchedulePicker";
import { fromPacific, nowPacific, type WallClock } from "../lib/datetime";
import { suggestCampaignName } from "../lib/campaignName";

type Mode = "now" | "later";
type Result = { kind: "ok"; text: string } | { kind: "err"; text: string } | null;

// Vonage caps an MMS image caption at 300 characters.
const MMS_CAPTION_MAX = 300;
// Past this a plain-text send concatenates into multiple carrier-billed SMS
// segments — capped to keep a long body from silently tripling the send cost.
const SMS_SEGMENT_MAX = 160;

function kb(bytes: number) {
  return `${Math.round(bytes / 1024)} KB`;
}

export function Composer({
  contacts,
  onCreated,
  balance,
  pricePerSegment,
  balanceError,
  preselectContactId,
  onConsumePreselect,
}: {
  contacts: Contact[];
  onCreated: () => void;
  balance: string | null;
  pricePerSegment: string | null;
  balanceError: boolean;
  preselectContactId?: number | null;
  onConsumePreselect?: () => void;
}) {
  const [name, setName] = useState("");
  // Once the admin writes their own name, the suggestion stops following the
  // message. Reset on a successful send, and when the field is left empty.
  const [nameTouched, setNameTouched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [csvPhones, setCsvPhones] = useState<string[]>([]);
  // Hand-typed numbers. Kept apart from csvPhones so clearing a file doesn't
  // drop numbers you typed by hand (and vice versa); merged only at send.
  const [manualPhones, setManualPhones] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<Mode>("now");
  // Pacific wall-clock, not a browser-local string: see lib/datetime.ts.
  const [scheduledAt, setScheduledAt] = useState<WallClock | null>(null);

  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const [media, setMedia] = useState<UploadedMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  // Set when /api/media returns 409; holds the file so the retry can resend it.
  const [conflict, setConflict] = useState<{ file: File; filename: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;

  useEffect(() => {
    if (preselectContactId == null) return;
    const contact = contactsRef.current.find((c) => c.id === preselectContactId);
    if (contact) {
      setManualPhones((prev) =>
        prev.includes(contact.phone) ? prev : [...prev, contact.phone]
      );
    }
    onConsumePreselect?.();
  }, [preselectContactId, onConsumePreselect]);

  const sanitized = useMemo(() => sanitizeForSMS(message), [message]);

  // Dates the empty-message fallback. Fixed per mount so the name does not
  // change under the cursor if the composer is left open past midnight.
  const mountedAt = useMemo(() => nowPacific(), []);
  const suggestedName = useMemo(
    () => suggestCampaignName(message, scheduledAt ?? mountedAt),
    [message, scheduledAt, mountedAt]
  );

  // The field holds a real value, not a placeholder: broadcasts.name is NOT
  // NULL, so a placeholder alone would still need something typed before the
  // insert could succeed.
  useEffect(() => {
    if (!nameTouched) setName(suggestedName);
  }, [suggestedName, nameTouched]);
  const segments = smsSegments(sanitized.length);
  const overCaption = media !== null && sanitized.length > MMS_CAPTION_MAX;
  const overOneSegment = media === null && sanitized.length > SMS_SEGMENT_MAX;
  const approxRecipients =
    selectedIds.size + csvPhones.length + manualPhones.length;

  // MMS pricing isn't covered by the SMS pricing endpoint, so the flair only
  // estimates plain-text sends — media !== null skips it rather than showing
  // a number that understates the real cost.
  const estimatedCost =
    media === null && pricePerSegment !== null && approxRecipients > 0 && segments > 0
      ? approxRecipients * segments * Number(pricePerSegment)
      : null;
  const overBalance =
    estimatedCost !== null && balance !== null && estimatedCost > Number(balance);

  async function doUpload(file: File, onConflict?: "copy" | "replace") {
    setResult(null);
    setConflict(null);
    setUploading(true);
    try {
      setMedia(await api.uploadMedia(file, onConflict));
    } catch (e) {
      if (e instanceof MediaConflictError) {
        setConflict({ file, filename: e.detail.filename });
      } else {
        setResult({
          kind: "err",
          text: e instanceof ApiError ? e.message : "No se pudo subir la imagen.",
        });
      }
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function removeMedia() {
    setMedia(null);
    setConflict(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function toggleContact(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Bulk select/deselect. Scoped to whatever the picker passes in — which is the
  // filtered list, not every contact — so a search followed by "select all"
  // never quietly picks up people the user cannot see.
  function setContactsSelected(ids: number[], selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) selected ? next.add(id) : next.delete(id);
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

  // The instant the chosen Pacific wall-clock corresponds to, or null.
  const scheduledInstant = useMemo(
    () => (scheduledAt ? fromPacific(scheduledAt) : null),
    [scheduledAt]
  );

  // Nothing validates the schedule here: SchedulePicker greys out every past
  // day and hour, so an unreachable time cannot be produced in the first place.
  // lib/campaigns.js still rejects one on the way in, for direct API calls.
  const canSend =
    name.trim() !== "" &&
    sanitized !== "" &&
    approxRecipients > 0 &&
    !uploading &&
    !overCaption &&
    !overOneSegment &&
    (mode === "now" || scheduledInstant !== null);

  async function send() {
    setResult(null);
    setSubmitting(true);
    try {
      const scheduledIso =
        mode === "later" && scheduledInstant ? scheduledInstant.toISOString() : null;
      const { id, total } = await api.createCampaign({
        name: name.trim(),
        body: message,
        contactIds: [...selectedIds],
        // CSV upload and hand-typed numbers are both just phone strings to the
        // backend, which upserts, dedupes, and drops opt-outs.
        phones: [...csvPhones, ...manualPhones],
        scheduledAt: scheduledIso,
        mediaUrl: media?.url ?? null,
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

      // Reset the form, keep the audience tools cleared. Clearing nameTouched
      // lets the next campaign pick up its own suggestion.
      setName("");
      setNameTouched(false);
      setMessage("");
      setSelectedIds(new Set());
      setCsvPhones([]);
      setManualPhones([]);
      setScheduledAt(null);
      removeMedia();
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
      <Card className="space-y-7">
        <Field label="Nombre de la campaña" required>
          <input
            value={name}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            // Clearing the field and clicking away hands it back to the
            // suggestion. Checked on blur rather than on change so holding
            // backspace does not refill the box mid-edit.
            onBlur={() => {
              if (name.trim() === "") setNameTouched(false);
            }}
            placeholder="Ej. Promo Italia · Junio"
            // broadcasts.name is varchar(200) NOT NULL; stop at the column
            // width rather than letting MySQL truncate on insert.
            maxLength={200}
            required
            className={inputClass}
          />
        </Field>

        {/* Naming the campaign and choosing who receives it are separate steps,
            so the audience block starts further down than the card's own rhythm. */}
        <Field
          className="pt-5"
          label="Audiencia"
          hint={`${approxRecipients} destinatario${approxRecipients === 1 ? "" : "s"}`}
        >
          <AudiencePicker
            contacts={contacts}
            selectedIds={selectedIds}
            onToggleContact={toggleContact}
            onSetContactsSelected={setContactsSelected}
            csvPhones={csvPhones}
            onCsvPhones={setCsvPhones}
            manualPhones={manualPhones}
            onManualPhones={setManualPhones}
            preselectContactId={preselectContactId}
          />
        </Field>
      </Card>

      <Card className="space-y-3">
        <Field
          label={media ? "Mensaje (pie de foto)" : "Mensaje"}
          hint={
            <span className={overCaption || overOneSegment ? "text-[var(--status-failed)]" : undefined}>
              {media
                ? `${sanitized.length}/${MMS_CAPTION_MAX} car. · MMS`
                : `${sanitized.length}/${SMS_SEGMENT_MAX} car. · ${segments} SMS`}
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

        {overCaption && (
          <p className="text-xs text-[var(--status-failed)]">
            Con imagen el mensaje es el pie de foto y no puede pasar de{" "}
            {MMS_CAPTION_MAX} caracteres. Quita la imagen o acorta el texto.
          </p>
        )}

        {overOneSegment && (
          <p className="text-xs text-[var(--status-failed)]">
            El mensaje no puede pasar de {SMS_SEGMENT_MAX} caracteres (1 segmento SMS) —
            son {segments} segmentos y cada uno se cobra por separado. Acorta el texto.
          </p>
        )}

        {message !== sanitized && (
          <p className="text-xs text-[var(--text-muted)]">
            Se enviará sin acentos ni emojis:{" "}
            <span className="font-mono">{sanitized.slice(0, 80)}</span>
            {sanitized.length > 80 ? "…" : ""}
          </p>
        )}

        {/* Wrapper carries the top spacing: the card's space-y-* wins over a
            margin set on the button itself, and padding here leaves the
            button's own dimensions alone. */}
        <div className="flex flex-wrap items-center gap-3 pt-5">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doUpload(f);
            }}
          />
          <Button
            variant="secondary"
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading || media !== null}
          >
            <ImageIcon size={16} weight="fill" /> Agregar imagen
          </Button>

          <Button
            variant="secondary"
            onClick={suggest}
            loading={suggesting}
            type="button"
            className="ml-auto"
          >
            <Sparkle size={16} weight="fill" /> Sugerir con IA
          </Button>

          {uploading && (
            <span className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <Spinner /> Optimizando imagen…
            </span>
          )}
        </div>

        {/* Same name as a previous upload: the user decides, nothing is overwritten silently. */}
        {conflict && (
          <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
            <p className="text-sm">
              Ya subiste una imagen llamada{" "}
              <span className="font-mono">{conflict.filename}</span>.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => doUpload(conflict.file, "copy")}
              >
                Guardar como copia
              </Button>
              <Button
                variant="secondary"
                type="button"
                onClick={() => doUpload(conflict.file, "replace")}
              >
                Reemplazar
              </Button>
              <Button variant="secondary" type="button" onClick={() => setConflict(null)}>
                Cancelar
              </Button>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Reemplazar cambia también la imagen en las campañas anteriores que la usaron.
            </p>
          </div>
        )}

        {media && (
          <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3">
            <img
              src={media.url}
              alt=""
              className="h-16 w-16 shrink-0 rounded object-cover"
            />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-mono">{media.filename}</p>
              <p className="text-xs text-[var(--text-muted)]">
                {kb(media.bytes)}
                {media.originalBytes > media.bytes &&
                  ` · comprimida desde ${kb(media.originalBytes)}`}
              </p>
            </div>
            <button
              type="button"
              onClick={removeMedia}
              aria-label="Quitar imagen"
              className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <X size={16} weight="bold" />
            </button>
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        {/* Two tabs rather than radios: choosing Programar reveals a whole panel,
            which is a change of view, not a field. Same pill tablist as the
            Activos/Archivados split in Contactos. */}
        <div
          role="tablist"
          aria-label="Cuándo enviar"
          className="inline-flex rounded-full bg-[var(--surface-sunken)] p-1"
        >
          {(
            [
              ["now", "Enviar ahora"],
              ["later", "Programar"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              type="button"
              id={`when-tab-${key}`}
              aria-selected={mode === key}
              // Optional on role=tab, and only Programar has a panel to point at.
              aria-controls={key === "later" ? "when-panel-later" : undefined}
              onClick={() => setMode(key)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
                mode === key
                  ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-[var(--shadow-ambient)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Only Programar has a panel; Enviar ahora needs no further input, so it
            drops straight through to the send button. */}
        {mode === "later" && (
          // pt, not mt: Card's space-y-4 sets margin-top through a `> * + *`
          // selector, which outranks a plain mt-* class and would swallow it.
          // Padding stacks on top of that 16px instead of fighting it.
          <div
            role="tabpanel"
            id="when-panel-later"
            aria-labelledby="when-tab-later"
            className="pt-4"
          >
            <SchedulePicker value={scheduledAt} onChange={setScheduledAt} />
          </div>
        )}

        {balanceError && media === null && approxRecipients > 0 && segments > 0 && (
          <p className="text-xs text-[var(--status-failed)]">
            No se pudo cargar el saldo — no se puede estimar el costo
          </p>
        )}

        {estimatedCost !== null && (
          <p
            className={cn(
              "text-xs",
              overBalance ? "text-[var(--status-failed)]" : "text-[var(--text-muted)]"
            )}
          >
            Costo estimado: ~${estimatedCost.toFixed(2)}
            {balance !== null && ` (saldo: $${Number(balance).toFixed(2)})`}
            {overBalance && " — supera el saldo disponible"}
          </p>
        )}

        <div className="flex items-center gap-3 pt-5">
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

