import { afterEach, describe, expect, it, vi } from "vitest";
import { branchName, coalesce, errorTitle, identifierFromBranch, normalizeBaseUrl, parseGithubRemote, relativePath, slugify, snippet } from "../src/util.ts";

describe("normalizeBaseUrl", () => {
  it.each([
    ["https://bld.example.com", "https://bld.example.com"],
    ["  https://bld.example.com/  ", "https://bld.example.com"],
    ["https://example.com/bldt/", "https://example.com/bldt"],
    ["HTTPS://Bld.Example.com:8443", "https://bld.example.com:8443"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:3000/", "http://127.0.0.1:3000"],
  ])("accepts %s", (input, expected) => expect(normalizeBaseUrl(input)).toEqual({ url: expected }));

  it.each([
    "",
    "bld.example.com",
    "http://bld.example.com",
    "http://localhost.evil.example",
    "http://192.168.1.5:3000",
    "ftp://bld.example.com",
    "https://user:pass@bld.example.com",
    "https://bld.example.com/?next=x",
    "https://bld.example.com/#top",
  ])("refuses %s", (input) => expect(normalizeBaseUrl(input)).toHaveProperty("error"));
});

describe("coalesce", () => {
  afterEach(() => void vi.useRealTimers());

  it("runs once after a burst settles, and not again within the minimum gap", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const run = coalesce(fn, 2_000, 15_000);
    run();
    vi.advanceTimersByTime(1_000);
    run();
    vi.advanceTimersByTime(1_999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    // A new burst right away waits out the 15 second gap from the last run.
    run();
    vi.advanceTimersByTime(14_999);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    run();
    run.cancel();
    vi.advanceTimersByTime(60_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("parseGithubRemote", () => {
  it.each([
    ["https://github.com/maya/relay.git", "maya/relay"],
    ["https://github.com/maya/relay", "maya/relay"],
    ["https://token@github.com/maya/relay.git/", "maya/relay"],
    ["git@github.com:bld-t/bld.to.git", "bld-t/bld.to"],
    ["ssh://git@github.com:22/maya/relay.git", "maya/relay"],
    ["ssh://git@github.com/maya/relay", "maya/relay"],
  ])("%s", (url, expected) => expect(parseGithubRemote(url)).toBe(expected));

  it("ignores other hosts and malformed URLs", () => {
    expect(parseGithubRemote("https://gitlab.com/maya/relay.git")).toBeNull();
    expect(parseGithubRemote("https://github.com.evil.example/maya/relay")).toBeNull();
    expect(parseGithubRemote("not a url")).toBeNull();
  });
});

describe("branch names", () => {
  it("carries the task id so the pull request links itself", () => {
    expect(branchName("raj-3200", "RELAY-7", "Dashboard: live request rate chart")).toBe("raj-3200/relay-7-dashboard-live-request-rate-chart");
  });
  it("stays short, ascii, and git-safe", () => {
    const b = branchName("raj", "LDG-12", "Ünïcode títle with  spaces, symbols!! and a very very long tail that keeps going");
    expect(b.length).toBeLessThanOrEqual(60);
    expect(b).toMatch(/^raj\/ldg-12-unicode-title-with-spaces-symbols/);
    expect(b).not.toMatch(/-$/);
    expect(slugify("---")).toBe("");
    expect(branchName("raj", "LDG-1", "!!!")).toBe("raj/ldg-1");
  });
  it("finds the task in a branch only for the project's own key", () => {
    expect(identifierFromBranch("raj/relay-7-dashboard", ["RELAY"])).toEqual({ key: "RELAY", number: 7 });
    expect(identifierFromBranch("feature/RELAY-12", ["RELAY"])).toEqual({ key: "RELAY", number: 12 });
    expect(identifierFromBranch("fix/utf-8-handling", ["RELAY"])).toBeNull();
    expect(identifierFromBranch("main", ["RELAY"])).toBeNull();
    expect(identifierFromBranch("raj/xrelay-7", ["RELAY"])).toBeNull();
  });
});

describe("error capture", () => {
  it("titles from the first meaningful line", () => {
    expect(errorTitle("\n\nTypeError: x is not a function\n  at y")).toBe("TypeError: x is not a function");
    expect(errorTitle("E".repeat(200))).toHaveLength(120);
  });
  it("makes repository-relative paths and refuses files outside", () => {
    expect(relativePath("/home/raj/relay", "/home/raj/relay/src/bucket.ts")).toBe("src/bucket.ts");
    expect(relativePath("/home/raj/relay", "/home/raj/relay-other/x.ts")).toBeNull();
    expect(relativePath(String.raw`C:\code\relay`, String.raw`C:\code\relay\src\a.ts`)).toBe("src/a.ts");
  });
  it("numbers the snippet and marks the line", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const s = snippet(text, 10, 2).split("\n");
    expect(s).toEqual([" 8   line 8", " 9   line 9", "10 > line 10", "11   line 11", "12   line 12"]);
  });
});
