import { describe, it, expect } from "vitest";
import { relativeTime } from "./format";

describe("relativeTime", () => {
  const now = new Date("2026-06-22T15:00:00Z");
  it("renders minutes ago", () => {
    expect(relativeTime("2026-06-22T14:57:00Z", now)).toBe("3m");
  });
  it("renders hours ago", () => {
    expect(relativeTime("2026-06-22T13:00:00Z", now)).toBe("2h");
  });
  it("renders days ago", () => {
    expect(relativeTime("2026-06-20T15:00:00Z", now)).toBe("2d");
  });
  it("renders now under a minute", () => {
    expect(relativeTime("2026-06-22T14:59:40Z", now)).toBe("now");
  });
});
