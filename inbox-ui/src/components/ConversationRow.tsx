import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import type { Contact, Conversation, Message } from "../types";
import { StatusPill } from "./StatusPill";
import { relativeTime } from "../lib/format";
import { cn } from "../lib/cn";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface Props {
  conversation: Conversation;
  contact: Contact;
  lastMessage?: Message;
  selected: boolean;
  onSelect: () => void;
}

export function ConversationRow({
  conversation,
  contact,
  lastMessage,
  selected,
  onSelect,
}: Props) {
  const hasUnread = conversation.unread > 0;
  const reduced = useReducedMotion();
  const dotRef = useRef<HTMLSpanElement>(null);
  const prevUnread = useRef(conversation.unread);

  useEffect(() => {
    const increased = conversation.unread > prevUnread.current;
    prevUnread.current = conversation.unread;
    if (reduced || !increased || !dotRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from(dotRef.current, {
        scale: 0.8,
        duration: 0.35,
        ease: "back.out(2)",
      });
    });
    return () => ctx.revert();
  }, [conversation.unread, reduced]);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={cn(
        "relative flex w-full flex-col gap-1 border-b border-[var(--border)] px-4 py-3 text-left transition-colors",
        "hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]",
        selected && "bg-[var(--surface-sunken)]",
      )}
    >
      {selected && (
        <span
          className="absolute left-0 top-0 h-full w-[3px] bg-[var(--brand)]"
          aria-hidden
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "truncate text-sm text-[var(--text-primary)]",
            hasUnread ? "font-semibold" : "font-medium",
          )}
        >
          {contact.name}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
          {relativeTime(conversation.lastMessageAt)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-[var(--text-muted)]">
          {lastMessage?.body ?? "Sin mensajes aún"}
        </span>
        {hasUnread && (
          <span
            ref={dotRef}
            data-testid="unread-dot"
            className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-[10px] font-semibold text-white"
          >
            {conversation.unread}
          </span>
        )}
      </div>
      <div className="mt-0.5">
        <StatusPill status={conversation.status} />
      </div>
    </button>
  );
}
