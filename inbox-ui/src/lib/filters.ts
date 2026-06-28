import type { Conversation, Contact, ConversationStatus } from "../types";

export type StatusFilter = ConversationStatus | "all";

export function filterConversations(
  conversations: Conversation[],
  contacts: Contact[],
  status: StatusFilter,
  query: string,
): Conversation[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const q = query.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  return conversations
    .filter((c) => (status === "all" ? true : c.status === status))
    .filter((c) => {
      if (!q) return true;
      const contact = byId.get(c.contactId);
      if (!contact) return false;
      const nameHit = contact.name.toLowerCase().includes(q);
      const phoneHit =
        qDigits.length > 0 && contact.phone.replace(/\D/g, "").includes(qDigits);
      return nameHit || phoneHit;
    })
    .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt));
}
