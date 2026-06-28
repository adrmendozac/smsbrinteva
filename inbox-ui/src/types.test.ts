import { describe, it, expect } from "vitest";
import { CONVERSATION_STATUSES, type Conversation } from "./types";

describe("types", () => {
  it("exposes the four conversation statuses", () => {
    expect(CONVERSATION_STATUSES).toEqual([
      "ai_handling",
      "needs_human",
      "open",
      "resolved",
    ]);
  });
  it("a conversation references a contact and messages", () => {
    const c: Conversation = {
      id: "c1",
      contactId: "p1",
      status: "open",
      unread: 2,
      lastMessageAt: "2026-06-22T15:00:00Z",
    };
    expect(c.unread).toBe(2);
  });
});
