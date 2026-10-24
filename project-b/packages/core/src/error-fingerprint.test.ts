import { describe, expect, it } from "vitest";
import { errorFingerprint, errorHeadline, normalizeError } from "./error-fingerprint.ts";

describe("errorHeadline", () => {
  it("finds the naming line in JS, Python, Rust and Go output", () => {
    expect(errorHeadline("\n  at foo (a.js:1:2)\nTypeError: x is not a function\n    at bar (b.js:3:4)")).toBe("TypeError: x is not a function");
    expect(errorHeadline('Traceback (most recent call last):\n  File "app.py", line 3, in <module>\nKeyError: \'user\'')).toBe("KeyError: 'user'");
    expect(errorHeadline("error[E0382]: borrow of moved value: `v`\n --> src/main.rs:5:20")).toBe("error[E0382]: borrow of moved value: `v`");
    expect(errorHeadline("panic: runtime error: index out of range [5] with length 3\n\ngoroutine 1 [running]:")).toBe("panic: runtime error: index out of range [5] with length 3");
  });
});

describe("errorFingerprint", () => {
  it("matches the same error from different machines, paths, lines and ids", () => {
    const a = `TypeError: Cannot read properties of undefined (reading 'id')
    at handler (/home/maya/relay/src/routes/user.ts:42:17)`;
    const b = `TypeError: Cannot read properties of undefined (reading 'id')
    at handler (C:\\Users\\raj\\code\\relay\\src\\routes\\user.ts:57:9)`;
    expect(errorFingerprint(a)).toBe(errorFingerprint(b));

    const c = "Error: connect ECONNREFUSED 127.0.0.1:5432";
    const d = "Error: connect ECONNREFUSED 10.0.0.12:6543";
    expect(errorFingerprint(c)).toBe(errorFingerprint(d));

    const e = "NotFoundError: Task 01a0f3b2-7c1e-7a9d-9d3b-2b0c9f6a1e22 not found";
    const f = "NotFoundError: Task 9b2e4c11-0f3a-4c8e-b1d2-7a6f5e4d3c2b not found";
    expect(errorFingerprint(e)).toBe(errorFingerprint(f));
  });

  it("keeps what identifies the failure apart", () => {
    expect(errorFingerprint("TypeError: Cannot read properties of undefined (reading 'id')")).not.toBe(errorFingerprint("TypeError: Cannot read properties of undefined (reading 'name')"));
    expect(errorFingerprint("Error: Cannot find module 'react-dom'")).not.toBe(errorFingerprint("Error: Cannot find module 'next'"));
    expect(errorFingerprint("KeyError: 'user'")).not.toBe(errorFingerprint("ValueError: 'user'"));
  });

  it("keeps a missing file's name but not its directory", () => {
    expect(normalizeError("Error: ENOENT: no such file or directory, open '/srv/app/config/settings.json'")).toBe("Error: ENOENT: no such file or directory, open 'settings.json'");
  });

  it("strips colour codes and long data values, and ignores empty input", () => {
    expect(errorFingerprint("\u001b[31mError: boom\u001b[0m")).toBe(errorFingerprint("Error: boom"));
    expect(normalizeError(`SyntaxError: Unexpected token in JSON at position 12: "${"x".repeat(80)}"`)).toBe('SyntaxError: Unexpected token in JSON at position <n>: "<value>"');
    expect(errorFingerprint("   \n  ")).toBeNull();
  });
});
