import { describe, it, expect } from "vitest";
import { contacts, conversations, messages } from "./mockData";
import { CONVERSATION_STATUSES } from "../types";

describe("mockData", () => {
  it("has several contacts with both languages represented", () => {
    expect(contacts.length).toBeGreaterThanOrEqual(6);
    const langs = new Set(contacts.map((c) => c.language));
    expect(langs.has("en")).toBe(true);
    expect(langs.has("es")).toBe(true);
  });
  it("every conversation points to a real contact and a valid status", () => {
    const ids = new Set(contacts.map((c) => c.id));
    for (const conv of conversations) {
      expect(ids.has(conv.contactId)).toBe(true);
      expect(CONVERSATION_STATUSES).toContain(conv.status);
    }
  });
  it("every message points to a real conversation", () => {
    const ids = new Set(conversations.map((c) => c.id));
    for (const m of messages) expect(ids.has(m.conversationId)).toBe(true);
  });
  it("uses no placeholder names", () => {
    const bad = /john doe|jane doe|acme|test user/i;
    for (const c of contacts) expect(bad.test(c.name)).toBe(false);
  });
});
