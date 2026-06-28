import { useState, type KeyboardEvent } from "react";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { useInboxStore } from "../store/useInboxStore";
import { cn } from "../lib/cn";

export function ReplyBox({ conversationId }: { conversationId: string }) {
  const [draft, setDraft] = useState("");
  const sendReply = useInboxStore((s) => s.sendReply);
  const trimmed = draft.trim();
  const canSend = trimmed.length > 0;

  const send = () => {
    if (!canSend) return;
    sendReply(conversationId, trimmed);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface-elevated)] p-3">
      <label htmlFor="reply" className="sr-only">
        Mensaje de respuesta
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="reply"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Escribe una respuesta. Enter para enviar, Shift+Enter para nueva línea."
          className={cn(
            "max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]",
            "placeholder:text-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]",
          )}
        />
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label="Enviar respuesta"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full transition-opacity",
            "bg-[var(--primary)] text-[var(--primary-fg)]",
            "disabled:cursor-not-allowed disabled:opacity-40",
            "focus-visible:outline-2 focus-visible:outline-[var(--focus)]",
          )}
        >
          <PaperPlaneRight size={18} weight="fill" />
        </button>
      </div>
    </div>
  );
}
