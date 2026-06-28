import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { MessageBubble } from "./MessageBubble";

it("tags AI outbound messages", () => {
  render(
    <MessageBubble
      message={{
        id: "m1",
        conversationId: "c1",
        direction: "outbound",
        sender: "ai",
        body: "Hola",
        createdAt: "2026-06-22T15:00:00Z",
      }}
    />,
  );
  expect(screen.getByText("Hola")).toBeInTheDocument();
  expect(screen.getByText(/^IA$/)).toBeInTheDocument();
});

it("renders system messages without an AI tag", () => {
  render(
    <MessageBubble
      message={{
        id: "m2",
        conversationId: "c1",
        direction: "inbound",
        sender: "system",
        body: "Opted out",
        createdAt: "2026-06-22T15:00:00Z",
      }}
    />,
  );
  expect(screen.getByText("Opted out")).toBeInTheDocument();
  expect(screen.queryByText(/^IA$/)).toBeNull();
});
