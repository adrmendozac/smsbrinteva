import { describe, it, expect, beforeEach } from "vitest";
import { useInboxStore } from "./useInboxStore";

describe("useInboxStore", () => {
  beforeEach(() => useInboxStore.getState().reset());

  it("selecting a conversation clears its unread", () => {
    const s = useInboxStore.getState();
    const target = s.conversations.find((c) => c.unread > 0)!;
    s.selectConversation(target.id);
    const after = useInboxStore.getState();
    expect(after.selectedId).toBe(target.id);
    expect(after.conversations.find((c) => c.id === target.id)!.unread).toBe(0);
  });

  it("setStatusFilter and setQuery update state", () => {
    useInboxStore.getState().setStatusFilter("resolved");
    useInboxStore.getState().setQuery("ana");
    const s = useInboxStore.getState();
    expect(s.statusFilter).toBe("resolved");
    expect(s.query).toBe("ana");
  });

  it("sendReply appends a human outbound message", () => {
    const conv = useInboxStore.getState().conversations[0];
    const before = useInboxStore.getState().messages.length;
    useInboxStore.getState().sendReply(conv.id, "On it");
    const msgs = useInboxStore.getState().messages;
    expect(msgs.length).toBe(before + 1);
    expect(msgs[msgs.length - 1].sender).toBe("human");
  });

  it("receiveMessage bumps unread on a non-selected conversation", () => {
    const conv = useInboxStore.getState().conversations[1];
    const before = conv.unread;
    useInboxStore.getState().receiveMessage(conv.id, "Hello again");
    const after = useInboxStore
      .getState()
      .conversations.find((c) => c.id === conv.id)!;
    expect(after.unread).toBe(before + 1);
  });
});
