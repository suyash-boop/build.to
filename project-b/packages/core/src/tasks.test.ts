import { describe, expect, it } from "vitest";
import { positionBetween } from "./positions.ts";
import { impliedStatus, statusPatch } from "./tasks.ts";

describe("impliedStatus", () => {
  const open = { state: "OPEN" as const, isDraft: false };
  const draft = { state: "OPEN" as const, isDraft: true };
  const merged = { state: "MERGED" as const, isDraft: false };

  it("moves todo work into review when a ready PR opens", () => {
    expect(impliedStatus("TODO", open, false)).toBe("IN_REVIEW");
  });
  it("moves todo work into progress for draft PRs", () => {
    expect(impliedStatus("TODO", draft, false)).toBe("IN_PROGRESS");
  });
  it("completes tasks only when the merged PR used a closing keyword", () => {
    expect(impliedStatus("IN_REVIEW", merged, true)).toBe("DONE");
    expect(impliedStatus("IN_REVIEW", merged, false)).toBeNull();
  });
  it("never moves work backwards or reopens canceled tasks", () => {
    expect(impliedStatus("IN_REVIEW", draft, false)).toBeNull();
    expect(impliedStatus("DONE", open, false)).toBeNull();
    expect(impliedStatus("CANCELED", merged, true)).toBeNull();
  });
});

describe("statusPatch", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  it("stamps start and completion times", () => {
    expect(statusPatch({ status: "TODO", startedAt: null }, "IN_PROGRESS", now)).toEqual({ status: "IN_PROGRESS", startedAt: now });
    expect(statusPatch({ status: "IN_PROGRESS", startedAt: now }, "DONE", now)).toEqual({ status: "DONE", completedAt: now });
  });
  it("clears completion when reopened", () => {
    expect(statusPatch({ status: "DONE", startedAt: now }, "IN_PROGRESS", now)).toEqual({ status: "IN_PROGRESS", completedAt: null });
  });
});

describe("positionBetween", () => {
  it("handles ends and middles", () => {
    expect(positionBetween(null, null)).toBe(1024);
    expect(positionBetween(1024, null)).toBe(2048);
    expect(positionBetween(null, 1024)).toBe(0);
    expect(positionBetween(1024, 2048)).toBe(1536);
  });
});
