import { parse as parseToml } from "smol-toml";

export interface ManifestFile {
  path: string;
  content: string;
}

export interface DetectedTech {
  slug: string;
  /** Repo path that proves the detection, shown in the UI as evidence. */
  evidence: string;
}

/** Repository paths worth fetching for stack detection. Matched against the git tree. */
export function isManifestPath(path: string): boolean {
  if (/(^|\/)(node_modules|vendor|dist|build|\.next|target|venv|\.venv)\//.test(path)) return false;
  const depth = path.split("/").length - 1;
  if (path.startsWith(".github/workflows/")) return /\.ya?ml$/.test(path) && depth <= 2;
  if (/^(k8s|kubernetes|deploy|manifests)\/[^/]+\.ya?ml$/.test(path)) return true;
  if (depth > 2) return false;
  const name = path.split("/").pop() ?? "";
  return MANIFEST_NAMES.has(name) || /^docker-compose(\.[\w-]+)?\.ya?ml$/.test(name) || /\.tf$/.test(name);
}

const MANIFEST_NAMES = new Set([
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "pubspec.yaml",
  "mix.exs",
  "Dockerfile",
  "vercel.json",
  "fly.toml",
  "wrangler.toml",
  "wrangler.jsonc",
  "compose.yaml",
  "compose.yml",
]);

/** npm dependency name -> technology slug. Exact names or "@scope/" prefixes. */
const NPM: [string | RegExp, string][] = [
  ["next", "nextjs"],
  ["react-native", "react-native"],
  ["expo", "expo"],
  ["react", "react"],
  ["@remix-run/react", "remix"],
  ["@react-router/dev", "remix"],
  ["vue", "vuejs"],
  ["nuxt", "nuxt"],
  ["@sveltejs/kit", "sveltekit"],
  ["@angular/core", "angular"],
  ["solid-js", "solid"],
  ["electron", "electron"],
  ["@tauri-apps/api", "tauri"],
  ["tailwindcss", "tailwindcss"],
  ["express", "express"],
  ["fastify", "fastify"],
  ["@nestjs/core", "nestjs"],
  ["hono", "hono"],
  [/^@trpc\//, "trpc"],
  ["graphql", "graphql"],
  ["pg", "postgresql"],
  ["postgres", "postgresql"],
  ["mysql2", "mysql"],
  ["better-sqlite3", "sqlite"],
  ["mongodb", "mongodb"],
  ["mongoose", "mongodb"],
  ["ioredis", "redis"],
  ["redis", "redis"],
  ["prisma", "prisma"],
  ["@prisma/client", "prisma"],
  ["drizzle-orm", "drizzle"],
  ["@supabase/supabase-js", "supabase"],
  ["vite", "vite"],
  ["vitest", "vitest"],
  ["jest", "jest"],
  ["@playwright/test", "playwright"],
  ["storybook", "storybook"],
  [/^@storybook\//, "storybook"],
];

/** Python distribution name (normalized, lowercase) -> slug. */
const PY: Record<string, string> = {
  django: "django",
  flask: "flask",
  fastapi: "fastapi",
  torch: "pytorch",
  tensorflow: "tensorflow",
  sqlalchemy: "sqlalchemy",
  "psycopg2": "postgresql",
  "psycopg2-binary": "postgresql",
  psycopg: "postgresql",
  asyncpg: "postgresql",
  pymongo: "mongodb",
  redis: "redis",
  pytest: "pytest",
};

const GO: [string, string][] = [
  ["github.com/gin-gonic/gin", "gin"],
  ["github.com/labstack/echo", "echo"],
  ["github.com/jackc/pgx", "postgresql"],
  ["github.com/lib/pq", "postgresql"],
  ["github.com/redis/go-redis", "redis"],
  ["go.mongodb.org/mongo-driver", "mongodb"],
];

const CARGO: Record<string, string> = {
  axum: "axum",
  "actix-web": "actix",
  tokio: "tokio",
  sqlx: "postgresql",
  "tokio-postgres": "postgresql",
  redis: "redis",
  tauri: "tauri",
};

export function detectStack(files: ManifestFile[]): DetectedTech[] {
  const out = new Map<string, DetectedTech>();
  const add = (slug: string, evidence: string) => {
    if (!out.has(slug)) out.set(slug, { slug, evidence });
  };

  for (const f of files) {
    const name = f.path.split("/").pop() ?? f.path;
    try {
      if (name === "package.json") detectNpm(f, add);
      else if (name === "requirements.txt") detectRequirements(f, add);
      else if (name === "pyproject.toml") detectPyproject(f, add);
      else if (name === "Pipfile") detectPipfile(f, add);
      else if (name === "go.mod") {
        for (const [mod, slug] of GO) if (f.content.includes(mod)) add(slug, f.path);
      } else if (name === "Cargo.toml") detectCargo(f, add);
      else if (name === "Gemfile") {
        if (/^\s*gem\s+["']rails["']/m.test(f.content)) add("rails", f.path);
        if (/^\s*gem\s+["']pg["']/m.test(f.content)) add("postgresql", f.path);
      } else if (name === "composer.json") {
        const j = JSON.parse(f.content) as { require?: Record<string, string> };
        if (j.require?.["laravel/framework"]) add("laravel", f.path);
      } else if (name === "pom.xml" || name.startsWith("build.gradle")) {
        if (/org\.springframework/.test(f.content)) add("spring", f.path);
        if (/org\.postgresql/.test(f.content)) add("postgresql", f.path);
      } else if (name === "pubspec.yaml") {
        if (/^\s*flutter\s*:/m.test(f.content)) add("flutter", f.path);
      } else if (name === "mix.exs") {
        if (/:phoenix\b/.test(f.content)) add("phoenix", f.path);
      } else if (name === "Dockerfile") add("docker", f.path);
      else if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(name)) {
        add("docker", f.path);
        if (/image:\s*["']?postgres/.test(f.content)) add("postgresql", f.path);
        if (/image:\s*["']?redis/.test(f.content)) add("redis", f.path);
        if (/image:\s*["']?mongo/.test(f.content)) add("mongodb", f.path);
        if (/image:\s*["']?mysql/.test(f.content)) add("mysql", f.path);
      } else if (name === "vercel.json") add("vercel", f.path);
      else if (name === "fly.toml") add("fly", f.path);
      else if (name.startsWith("wrangler.")) add("cloudflare-workers", f.path);
      else if (name.endsWith(".tf")) add("terraform", f.path);
      else if (f.path.startsWith(".github/workflows/")) add("github-actions", f.path);

      if (/\bkind:\s*(Deployment|StatefulSet)\b/.test(f.content) && /apiVersion:/.test(f.content)) {
        add("kubernetes", f.path);
      }
    } catch {
      // A malformed manifest should never fail a sync; skip it.
    }
  }

  return [...out.values()];
}

type Add = (slug: string, evidence: string) => void;

function detectNpm(f: ManifestFile, add: Add) {
  const j = JSON.parse(f.content) as Record<string, Record<string, string> | undefined>;
  const names = [
    ...Object.keys(j.dependencies ?? {}),
    ...Object.keys(j.devDependencies ?? {}),
    ...Object.keys(j.peerDependencies ?? {}),
  ];
  for (const dep of names) {
    for (const [pattern, slug] of NPM) {
      if (typeof pattern === "string" ? dep === pattern : pattern.test(dep)) add(slug, f.path);
    }
  }
}

const normPy = (n: string) => n.toLowerCase().replace(/[-_.]+/g, "-");

function addPyDeps(deps: string[], f: ManifestFile, add: Add) {
  for (const raw of deps) {
    const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(raw);
    if (!m) continue;
    const name = normPy(m[1] as string);
    const slug = PY[name] ?? PY[name.replace(/-/g, "_")];
    if (slug) add(slug, f.path);
  }
}

function detectRequirements(f: ManifestFile, add: Add) {
  const lines = f.content.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("-"));
  addPyDeps(lines, f, add);
}

function detectPyproject(f: ManifestFile, add: Add) {
  const t = parseToml(f.content) as {
    project?: { dependencies?: string[]; "optional-dependencies"?: Record<string, string[]> };
    tool?: { poetry?: { dependencies?: Record<string, unknown>; "dev-dependencies"?: Record<string, unknown> } };
    "dependency-groups"?: Record<string, unknown[]>;
  };
  const deps: string[] = [
    ...(t.project?.dependencies ?? []),
    ...Object.values(t.project?.["optional-dependencies"] ?? {}).flat(),
    ...Object.keys(t.tool?.poetry?.dependencies ?? {}),
    ...Object.keys(t.tool?.poetry?.["dev-dependencies"] ?? {}),
    ...Object.values(t["dependency-groups"] ?? {})
      .flat()
      .filter((d): d is string => typeof d === "string"),
  ];
  addPyDeps(deps, f, add);
}

function detectPipfile(f: ManifestFile, add: Add) {
  const t = parseToml(f.content) as { packages?: Record<string, unknown>; "dev-packages"?: Record<string, unknown> };
  addPyDeps([...Object.keys(t.packages ?? {}), ...Object.keys(t["dev-packages"] ?? {})], f, add);
}

function detectCargo(f: ManifestFile, add: Add) {
  const t = parseToml(f.content) as {
    dependencies?: Record<string, unknown>;
    "dev-dependencies"?: Record<string, unknown>;
    workspace?: { dependencies?: Record<string, unknown> };
  };
  const names = [
    ...Object.keys(t.dependencies ?? {}),
    ...Object.keys(t["dev-dependencies"] ?? {}),
    ...Object.keys(t.workspace?.dependencies ?? {}),
  ];
  for (const n of names) {
    const slug = CARGO[n];
    if (slug) add(slug, f.path);
  }
}
