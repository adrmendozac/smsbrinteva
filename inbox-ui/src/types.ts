export const CONVERSATION_STATUSES = [
  "ai_handling",
  "needs_human",
  "open",
  "resolved",
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export type Language = "en" | "es";
export type MessageDirection = "inbound" | "outbound";
export type MessageSender = "contact" | "ai" | "human" | "system";

export interface Contact {
  id: string;
  name: string;
  phone: string; // display format, e.g. "+1 (412) 555-0173"
  language: Language;
  optedIn: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  sender: MessageSender;
  body: string;
  createdAt: string; // ISO
}

export interface Conversation {
  id: string;
  contactId: string;
  status: ConversationStatus;
  unread: number;
  lastMessageAt: string; // ISO
}
