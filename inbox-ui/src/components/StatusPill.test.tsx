import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { StatusPill } from "./StatusPill";

it("renders a label for needs_human", () => {
  render(<StatusPill status="needs_human" />);
  expect(screen.getByText(/necesita agente/i)).toBeInTheDocument();
});

it("renders a label for resolved", () => {
  render(<StatusPill status="resolved" />);
  expect(screen.getByText(/resuelto/i)).toBeInTheDocument();
});
