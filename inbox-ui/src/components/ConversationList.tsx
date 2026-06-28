import { MagnifyingGlass } from "@phosphor-icons/react";
import { useInboxStore } from "../store/useInboxStore";
import { filterConversations, type StatusFilter } from "../lib/filters";
import { ConversationRow } from "./ConversationRow";
import { cn } from "../lib/cn";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "needs_human", label: "Necesita agente" },
  { value: "ai_handling", label: "IA" },
  { value: "open", label: "Abierto" },
  { value: "resolved", label: "Resuelto" },
];

export function ConversationList() {
  const {
    contacts,
    conversations,
    messages,
    selectedId,
    statusFilter,
    query,
    setStatusFilter,
    setQuery,
    selectConversation,
  } = useInboxStore();

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const visible = filterConversations(conversations, contacts, statusFilter, query);
  const lastMessageOf = (convId: string) =>
    [...messages].reverse().find((m) => m.conversationId === convId);

  return (
    <div className="flex h-full flex-col bg-[var(--surface-elevated)]">
      <div className="border-b border-[var(--border)] p-3">
        <label htmlFor="convo-search" className="sr-only">
          Buscar conversaciones
        </label>
        <div className="relative">
          <MagnifyingGlass
            size={16}
            weight="bold"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            id="convo-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar nombre o número"
            className={cn(
              "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)]",
              "placeholder:text-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]",
            )}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                statusFilter === f.value
                  ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
            Sin resultados.
          </p>
        ) : (
          visible.map((conv) => {
            const contact = contactById.get(conv.contactId);
            if (!contact) return null;
            return (
              <ConversationRow
                key={conv.id}
                conversation={conv}
                contact={contact}
                lastMessage={lastMessageOf(conv.id)}
                selected={conv.id === selectedId}
                onSelect={() => selectConversation(conv.id)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
