import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, beforeEach } from "vitest";
import { useInboxStore } from "../store/useInboxStore";
import { Thread } from "./Thread";

beforeEach(() => {
  useInboxStore.getState().reset();
  useInboxStore
    .getState()
    .selectConversation(useInboxStore.getState().conversations[0].id);
});

it("sending a reply appends a human outbound message", async () => {
  render(<Thread />);
  const before = useInboxStore.getState().messages.length;
  await userEvent.type(screen.getByRole("textbox"), "On it, thanks");
  await userEvent.click(screen.getByRole("button", { name: /enviar/i }));
  const msgs = useInboxStore.getState().messages;
  expect(msgs.length).toBe(before + 1);
  const last = msgs[msgs.length - 1];
  expect(last.sender).toBe("human");
  expect(last.body).toBe("On it, thanks");
});

it("send is disabled for empty input", () => {
  render(<Thread />);
  expect(screen.getByRole("button", { name: /enviar/i })).toBeDisabled();
});
