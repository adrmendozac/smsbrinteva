import { render, screen } from "@testing-library/react";
import { it, expect, beforeEach } from "vitest";
import { useInboxStore } from "../store/useInboxStore";
import { ContactPanel } from "./ContactPanel";

beforeEach(() => useInboxStore.getState().reset());

it("shows contact context for the selection", () => {
  const conv = useInboxStore.getState().conversations[0];
  useInboxStore.getState().selectConversation(conv.id);
  const contact = useInboxStore
    .getState()
    .contacts.find((c) => c.id === conv.contactId)!;
  render(<ContactPanel />);
  expect(screen.getByText(contact.phone)).toBeInTheDocument();
});
