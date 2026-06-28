import { render, screen } from "@testing-library/react";
import { it, expect, beforeEach } from "vitest";
import App from "./App";
import { useInboxStore } from "./store/useInboxStore";

beforeEach(() => useInboxStore.getState().reset());

it("renders the three-pane shell with brand wordmark", () => {
  render(<App />);
  expect(screen.getByText(/brinteva/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/buscar/i)).toBeInTheDocument();
});
