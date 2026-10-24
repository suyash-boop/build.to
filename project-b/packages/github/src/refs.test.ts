import { describe, expect, it } from "vitest";
import { parseTaskReferences } from "./refs.ts";

const keys = ["RELAY", "INK"];

describe("parseTaskReferences", () => {
  it("finds references in title and body", () => {
    const refs = parseTaskReferences({ title: "RELAY-12: tighten token bucket", body: "Also touches INK-3." }, keys);
    expect(refs).toEqual([
      { key: "RELAY", number: 12, closes: false },
      { key: "INK", number: 3, closes: false },
    ]);
  });

  it("detects closing keywords", () => {
    const refs = parseTaskReferences({ body: "Fixes RELAY-12\nresolves: RELAY-13\nsee RELAY-14" }, keys);
    expect(refs).toEqual([
      { key: "RELAY", number: 12, closes: true },
      { key: "RELAY", number: 13, closes: true },
      { key: "RELAY", number: 14, closes: false },
    ]);
  });

  it("ignores keys that do not belong to linked projects", () => {
    expect(parseTaskReferences({ title: "Handle UTF-8 and ISO-8601 dates" }, keys)).toEqual([]);
  });

  it("ignores references inside code", () => {
    const refs = parseTaskReferences({ body: "Example: `RELAY-1`\n```\nfixes RELAY-2\n```\nreal RELAY-3" }, keys);
    expect(refs).toEqual([{ key: "RELAY", number: 3, closes: false }]);
  });

  it("does not match inside longer tokens or paths", () => {
    expect(parseTaskReferences({ body: "XRELAY-5 and /docs/RELAY-6 and RELAY-7x" }, keys)).toEqual([]);
  });

  it("reads lowercase branch names", () => {
    expect(parseTaskReferences({ branch: "maya/relay-42-timeouts" }, keys)).toEqual([
      { key: "RELAY", number: 42, closes: false },
    ]);
    expect(parseTaskReferences({ branch: "ink-7" }, keys)).toEqual([{ key: "INK", number: 7, closes: false }]);
  });

  it("deduplicates and keeps the strongest closes flag", () => {
    const refs = parseTaskReferences({ title: "RELAY-9", body: "closes RELAY-9", branch: "relay-9" }, keys);
    expect(refs).toEqual([{ key: "RELAY", number: 9, closes: true }]);
  });

  it("returns nothing when no keys are linked", () => {
    expect(parseTaskReferences({ title: "RELAY-1" }, [])).toEqual([]);
  });
});
