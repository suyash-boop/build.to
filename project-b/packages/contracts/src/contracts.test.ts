import { describe, expect, it } from "vitest";
import { can, canAssignRole } from "./permissions.ts";
import { slugify, suggestProjectKey } from "./format.ts";
import { Username } from "./inputs.ts";

describe("permissions", () => {
  it("hides private projects from non-members entirely", () => {
    expect(can("project.view", { role: null, visibility: "PRIVATE" })).toBe(false);
    expect(can("activity.view", { role: null, visibility: "PRIVATE" })).toBe(false);
  });
  it("lets the public read but not write public projects", () => {
    expect(can("project.view", { role: null, visibility: "PUBLIC" })).toBe(true);
    expect(can("tasks.view", { role: null, visibility: "PUBLIC" })).toBe(false);
    expect(can("tasks.create", { role: null, visibility: "PUBLIC" })).toBe(false);
  });
  it("applies role thresholds", () => {
    expect(can("tasks.create", { role: "VIEWER", visibility: "PRIVATE" })).toBe(false);
    expect(can("tasks.create", { role: "CONTRIBUTOR", visibility: "PRIVATE" })).toBe(true);
    expect(can("project.ship", { role: "CONTRIBUTOR", visibility: "PUBLIC" })).toBe(false);
    expect(can("project.ship", { role: "MAINTAINER", visibility: "PUBLIC" })).toBe(true);
    expect(can("project.delete", { role: "MAINTAINER", visibility: "PUBLIC" })).toBe(false);
  });
  it("prevents maintainers from promoting peers or creating owners", () => {
    expect(canAssignRole("MAINTAINER", "CONTRIBUTOR")).toBe(true);
    expect(canAssignRole("MAINTAINER", "MAINTAINER")).toBe(false);
    expect(canAssignRole("OWNER", "MAINTAINER")).toBe(true);
    expect(canAssignRole("OWNER", "OWNER")).toBe(false);
  });
});

describe("formatting", () => {
  it("suggests project keys", () => {
    expect(suggestProjectKey("Relay API")).toBe("RELAY");
    expect(suggestProjectKey("inkwell")).toBe("INK");
    expect(suggestProjectKey("open source design system")).toBe("OSDS");
    expect(suggestProjectKey("3")).toMatch(/^[A-Z][A-Z0-9]{1,9}$/);
  });
  it("slugifies names", () => {
    expect(slugify("Relay API v2")).toBe("relay-api-v2");
    expect(slugify("Café Önder")).toBe("cafe-onder");
    expect(slugify("!!!")).toBe("project");
  });
  it("validates usernames", () => {
    expect(Username.safeParse("Maya_Chen").data).toBe("maya_chen");
    expect(Username.safeParse("maya-chen").success).toBe(false);
    expect(Username.safeParse("projects").success).toBe(false);
    expect(Username.safeParse("settings").success).toBe(false);
    expect(Username.safeParse("a--b").success).toBe(false);
    expect(Username.safeParse("-ab").success).toBe(false);
  });
});
