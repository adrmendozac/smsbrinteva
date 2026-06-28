import { describe, it, expect } from "vitest";
import { filterConversations } from "./filters";
import type { Conversation, Contact } from "../types";

const contacts: Contact[] = [
  { id: "p1", name: "Ana Reyes", phone: "+1 (412) 555-0173", language: "es", optedIn: true },
  { id: "p2", name: "Marcus Bell", phone: "+1 (312) 555-0148", language: "en", optedIn: true },
];
const conversations: Conversation[] = [
  { id: "c1", contactId: "p1", status: "needs_human", unread: 1, lastMessageAt: "2026-06-22T15:00:00Z" },
  { id: "c2", contactId: "p2", status: "resolved", unread: 0, lastMessageAt: "2026-06-22T12:00:00Z" },
];

describe("filterConversations", () => {
  it("returns all with no filter and empty query", () => {
    expect(filterConversations(conversations, contacts, "all", "")).toHaveLength(2);
  });
  it("filters by status", () => {
    const r = filterConversations(conversations, contacts, "needs_human", "");
    expect(r.map((c) => c.id)).toEqual(["c1"]);
  });
  it("searches by contact name (case-insensitive)", () => {
    const r = filterConversations(conversations, contacts, "all", "marcus");
    expect(r.map((c) => c.id)).toEqual(["c2"]);
  });
  it("searches by phone digits", () => {
    const r = filterConversations(conversations, contacts, "all", "412");
    expect(r.map((c) => c.id)).toEqual(["c1"]);
  });
  it("sorts most-recent first", () => {
    const r = filterConversations(conversations, contacts, "all", "");
    expect(r[0].id).toBe("c1");
  });
});
