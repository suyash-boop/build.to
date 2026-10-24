import { describe, expect, it } from "vitest";
import { detectStack, isManifestPath } from "./stack.ts";

const slugs = (files: { path: string; content: string }[]) => detectStack(files).map((d) => d.slug).sort();

describe("isManifestPath", () => {
  it("accepts root and shallow manifests", () => {
    expect(isManifestPath("package.json")).toBe(true);
    expect(isManifestPath("apps/web/package.json")).toBe(true);
    expect(isManifestPath(".github/workflows/ci.yml")).toBe(true);
    expect(isManifestPath("docker-compose.dev.yml")).toBe(true);
    expect(isManifestPath("infra/main.tf")).toBe(true);
  });
  it("rejects vendored, deep, or unrelated files", () => {
    expect(isManifestPath("node_modules/react/package.json")).toBe(false);
    expect(isManifestPath("a/b/c/package.json")).toBe(false);
    expect(isManifestPath("src/index.ts")).toBe(false);
  });
});

describe("detectStack", () => {
  it("detects JS frameworks with evidence paths", () => {
    const result = detectStack([
      {
        path: "apps/web/package.json",
        content: JSON.stringify({
          dependencies: { next: "16", react: "19", "@trpc/server": "11", "@prisma/client": "7" },
          devDependencies: { tailwindcss: "4", vitest: "5" },
        }),
      },
    ]);
    expect(result.map((r) => r.slug).sort()).toEqual(["nextjs", "prisma", "react", "tailwindcss", "trpc", "vitest"]);
    expect(result.every((r) => r.evidence === "apps/web/package.json")).toBe(true);
  });

  it("detects Python from requirements and pyproject", () => {
    expect(
      slugs([
        { path: "requirements.txt", content: "# deps\nDjango==5.1\npsycopg2-binary>=2.9\n-r dev.txt\n" },
        {
          path: "pyproject.toml",
          content: '[project]\nname="x"\ndependencies=["fastapi>=0.110", "SQLAlchemy[asyncio]"]\n',
        },
      ]),
    ).toEqual(["django", "fastapi", "postgresql", "sqlalchemy"]);
  });

  it("detects Rust and Go dependencies", () => {
    expect(
      slugs([
        { path: "Cargo.toml", content: '[dependencies]\naxum = "0.8"\ntokio = { version = "1", features = ["full"] }\n' },
        { path: "go.mod", content: "module x\nrequire github.com/gin-gonic/gin v1.10.0\n" },
      ]),
    ).toEqual(["axum", "gin", "tokio"]);
  });

  it("detects infrastructure files", () => {
    expect(
      slugs([
        { path: "Dockerfile", content: "FROM node:24" },
        { path: "docker-compose.yml", content: "services:\n  db:\n    image: postgres:17\n" },
        { path: ".github/workflows/ci.yml", content: "on: push" },
        { path: "vercel.json", content: "{}" },
      ]),
    ).toEqual(["docker", "github-actions", "postgresql", "vercel"]);
  });

  it("survives malformed manifests", () => {
    expect(slugs([{ path: "package.json", content: "{not json" }, { path: "Dockerfile", content: "" }])).toEqual([
      "docker",
    ]);
  });
});
