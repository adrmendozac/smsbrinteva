import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, beforeEach } from "vitest";
import { ConversationList } from "./ConversationList";
import { useInboxStore } from "../store/useInboxStore";

beforeEach(() => useInboxStore.getState().reset());

it("filters rows by search query", async () => {
  render(<ConversationList />);
  const name = useInboxStore.getState().contacts[0].name;
  await userEvent.type(screen.getByPlaceholderText(/buscar/i), name);
  expect(screen.getByText(name)).toBeInTheDocument();
});

it("clicking a row selects the conversation", async () => {
  render(<ConversationList />);
  const rows = screen.getAllByRole("button");
  // first buttons are filter chips; click a conversation row (has aria-current)
  const row = rows.find((b) => b.getAttribute("aria-current") !== null)!;
  await userEvent.click(row);
  expect(useInboxStore.getState().selectedId).not.toBeNull();
});
