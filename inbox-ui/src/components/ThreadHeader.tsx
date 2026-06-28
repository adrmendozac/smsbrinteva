import type { Contact, Conversation } from "../types";
import { StatusPill } from "./StatusPill";

interface Props {
  contact: Contact;
  conversation: Conversation;
}

export function ThreadHeader({ contact, conversation }: Props) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-elevated)] px-5 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">
          {contact.name}
        </h2>
        <p className="font-mono text-xs text-[var(--text-muted)]">{contact.phone}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
          SMS
        </span>
        <StatusPill status={conversation.status} />
      </div>
    </header>
  );
}
