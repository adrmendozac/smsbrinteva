import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { TypingIndicator } from "./TypingIndicator";

it("renders an accessible typing status when active", () => {
  render(<TypingIndicator active />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByText(/escribiendo/i)).toBeInTheDocument();
});

it("renders nothing when inactive", () => {
  const { container } = render(<TypingIndicator active={false} />);
  expect(container).toBeEmptyDOMElement();
});
