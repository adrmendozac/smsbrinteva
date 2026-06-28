import { renderHook } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { useReducedMotion } from "./useReducedMotion";

it("reports reduced motion from matchMedia", () => {
  window.matchMedia = ((q: string) => ({
    matches: true,
    media: q,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  const { result } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(true);
});
