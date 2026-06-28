import { vi, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useInboxStore } from "../store/useInboxStore";
import { useSimulatedPresence } from "./useSimulatedPresence";

afterEach(() => vi.useRealTimers());

it("delivers a simulated inbound message over time", () => {
  vi.useFakeTimers();
  useInboxStore.getState().reset();
  const before = useInboxStore.getState().messages.length;
  renderHook(() => useSimulatedPresence());
  vi.advanceTimersByTime(20000);
  expect(useInboxStore.getState().messages.length).toBeGreaterThan(before);
});
