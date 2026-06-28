import type { Message } from "../types";
import { relativeTime } from "../lib/format";
import { cn } from "../lib/cn";

export function MessageBubble({ message }: { message: Message }) {
  if (message.sender === "system") {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-[var(--surface-sunken)] px-3 py-1 text-[11px] text-[var(--text-muted)]">
          {message.body}
        </span>
      </div>
    );
  }

  const isOutbound = message.direction === "outbound";
  const isAI = message.sender === "ai";

  return (
    <div className={cn("flex flex-col gap-1", isOutbound ? "items-end" : "items-start")}>
      {isAI && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--status-ai)]">
          IA
        </span>
      )}
      <div
        className={cn(
          "max-w-[78%] rounded-xl px-3.5 py-2 text-sm leading-relaxed",
          !isOutbound && "bg-[var(--surface-sunken)] text-[var(--text-primary)]",
          isOutbound && !isAI && "bg-[var(--primary)] text-[var(--primary-fg)]",
          isOutbound &&
            isAI &&
            "border border-[var(--primary)] text-[var(--text-primary)]",
        )}
      >
        {message.body}
      </div>
      <span className="font-mono text-[10px] text-[var(--text-muted)]">
        {relativeTime(message.createdAt)}
      </span>
    </div>
  );
}
