import { create } from "zustand";
import type { Contact, Conversation, Message } from "../types";
import type { StatusFilter } from "../lib/filters";
import {
  contacts as seedContacts,
  conversations as seedConversations,
  messages as seedMessages,
} from "../data/mockData";

let idCounter = 1000;
const nextId = (prefix: string) => `${prefix}${++idCounter}`;

interface InboxState {
  contacts: Contact[];
  conversations: Conversation[];
  messages: Message[];
  selectedId: string | null;
  statusFilter: StatusFilter;
  query: string;
  typingConversationId: string | null;

  selectConversation: (id: string) => void;
  setStatusFilter: (status: StatusFilter) => void;
  setQuery: (query: string) => void;
  setTyping: (conversationId: string | null) => void;
  sendReply: (conversationId: string, body: string) => void;
  receiveMessage: (conversationId: string, body: string) => void;
  reset: () => void;
}

const clone = <T>(v: T[]): T[] => v.map((x) => ({ ...x }));

export const useInboxStore = create<InboxState>((set) => ({
  contacts: clone(seedContacts),
  conversations: clone(seedConversations),
  messages: clone(seedMessages),
  selectedId: null,
  statusFilter: "all",
  query: "",
  typingConversationId: null,

  selectConversation: (id) =>
    set((s) => ({
      selectedId: id,
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, unread: 0 } : c,
      ),
    })),

  setStatusFilter: (status) => set({ statusFilter: status }),
  setQuery: (query) => set({ query }),
  setTyping: (conversationId) => set({ typingConversationId: conversationId }),

  sendReply: (conversationId, body) =>
    set((s) => {
      const now = new Date().toISOString();
      const msg: Message = {
        id: nextId("m"),
        conversationId,
        direction: "outbound",
        sender: "human",
        body,
        createdAt: now,
      };
      return {
        messages: [...s.messages, msg],
        conversations: s.conversations.map((c) =>
          c.id === conversationId ? { ...c, lastMessageAt: now } : c,
        ),
      };
    }),

  receiveMessage: (conversationId, body) =>
    set((s) => {
      const now = new Date().toISOString();
      const msg: Message = {
        id: nextId("m"),
        conversationId,
        direction: "inbound",
        sender: "contact",
        body,
        createdAt: now,
      };
      return {
        messages: [...s.messages, msg],
        typingConversationId:
          s.typingConversationId === conversationId ? null : s.typingConversationId,
        conversations: s.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                lastMessageAt: now,
                unread: s.selectedId === conversationId ? 0 : c.unread + 1,
              }
            : c,
        ),
      };
    }),

  reset: () =>
    set({
      contacts: clone(seedContacts),
      conversations: clone(seedConversations),
      messages: clone(seedMessages),
      selectedId: null,
      statusFilter: "all",
      query: "",
      typingConversationId: null,
    }),
}));
