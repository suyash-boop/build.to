import type { TechCategory } from "./generated/client.ts";

export interface TechnologyDef {
  slug: string;
  name: string;
  category: TechCategory;
  /// Language colors follow GitHub Linguist so they match what developers already recognize.
  color?: string;
  /// Exact GitHub language name, when this is a language.
  linguist?: string;
}

const lang = (slug: string, name: string, color: string, linguist = name): TechnologyDef => ({
  slug,
  name,
  category: "LANGUAGE",
  color,
  linguist,
});

export const TECHNOLOGIES: TechnologyDef[] = [
  lang("typescript", "TypeScript", "#3178c6"),
  lang("javascript", "JavaScript", "#f1e05a"),
  lang("python", "Python", "#3572a5"),
  lang("go", "Go", "#00add8"),
  lang("rust", "Rust", "#dea584"),
  lang("java", "Java", "#b07219"),
  lang("kotlin", "Kotlin", "#a97bff"),
  lang("swift", "Swift", "#f05138"),
  lang("c", "C", "#555555"),
  lang("cpp", "C++", "#f34b7d"),
  lang("csharp", "C#", "#178600"),
  lang("ruby", "Ruby", "#701516"),
  lang("php", "PHP", "#4f5d95"),
  lang("dart", "Dart", "#00b4ab"),
  lang("elixir", "Elixir", "#6e4a7e"),
  lang("scala", "Scala", "#c22d40"),
  lang("shell", "Shell", "#89e051"),
  lang("html", "HTML", "#e34c26"),
  lang("css", "CSS", "#663399"),
  lang("scss", "SCSS", "#c6538c"),
  lang("vue", "Vue", "#41b883"),
  lang("svelte", "Svelte", "#ff3e00"),
  lang("astro", "Astro", "#ff5a03"),
  lang("lua", "Lua", "#000080"),
  lang("haskell", "Haskell", "#5e5086"),
  lang("zig", "Zig", "#ec915c"),
  lang("solidity", "Solidity", "#aa6746"),
  lang("jupyter", "Jupyter Notebook", "#da5b0b"),
  lang("hcl", "HCL", "#844fba"),
  lang("ocaml", "OCaml", "#ef7a08"),
  lang("clojure", "Clojure", "#db5855"),
  lang("r", "R", "#198ce7"),
  lang("julia", "Julia", "#a270ba"),
  lang("nix", "Nix", "#7e7eff"),
  lang("objective-c", "Objective-C", "#438eff"),
  lang("gleam", "Gleam", "#ffaff3"),

  // Frameworks and libraries
  { slug: "react", name: "React", category: "FRAMEWORK" },
  { slug: "nextjs", name: "Next.js", category: "FRAMEWORK" },
  { slug: "remix", name: "Remix", category: "FRAMEWORK" },
  { slug: "vuejs", name: "Vue.js", category: "FRAMEWORK" },
  { slug: "nuxt", name: "Nuxt", category: "FRAMEWORK" },
  { slug: "sveltekit", name: "SvelteKit", category: "FRAMEWORK" },
  { slug: "angular", name: "Angular", category: "FRAMEWORK" },
  { slug: "solid", name: "Solid", category: "FRAMEWORK" },
  { slug: "react-native", name: "React Native", category: "FRAMEWORK" },
  { slug: "expo", name: "Expo", category: "FRAMEWORK" },
  { slug: "electron", name: "Electron", category: "FRAMEWORK" },
  { slug: "tauri", name: "Tauri", category: "FRAMEWORK" },
  { slug: "tailwindcss", name: "Tailwind CSS", category: "FRAMEWORK" },
  { slug: "express", name: "Express", category: "FRAMEWORK" },
  { slug: "fastify", name: "Fastify", category: "FRAMEWORK" },
  { slug: "nestjs", name: "NestJS", category: "FRAMEWORK" },
  { slug: "hono", name: "Hono", category: "FRAMEWORK" },
  { slug: "trpc", name: "tRPC", category: "FRAMEWORK" },
  { slug: "graphql", name: "GraphQL", category: "FRAMEWORK" },
  { slug: "django", name: "Django", category: "FRAMEWORK" },
  { slug: "flask", name: "Flask", category: "FRAMEWORK" },
  { slug: "fastapi", name: "FastAPI", category: "FRAMEWORK" },
  { slug: "pytorch", name: "PyTorch", category: "FRAMEWORK" },
  { slug: "tensorflow", name: "TensorFlow", category: "FRAMEWORK" },
  { slug: "rails", name: "Ruby on Rails", category: "FRAMEWORK" },
  { slug: "laravel", name: "Laravel", category: "FRAMEWORK" },
  { slug: "spring", name: "Spring", category: "FRAMEWORK" },
  { slug: "gin", name: "Gin", category: "FRAMEWORK" },
  { slug: "echo", name: "Echo", category: "FRAMEWORK" },
  { slug: "axum", name: "Axum", category: "FRAMEWORK" },
  { slug: "actix", name: "Actix Web", category: "FRAMEWORK" },
  { slug: "tokio", name: "Tokio", category: "FRAMEWORK" },
  { slug: "flutter", name: "Flutter", category: "FRAMEWORK" },
  { slug: "phoenix", name: "Phoenix", category: "FRAMEWORK" },

  // Data
  { slug: "postgresql", name: "PostgreSQL", category: "DATABASE" },
  { slug: "mysql", name: "MySQL", category: "DATABASE" },
  { slug: "sqlite", name: "SQLite", category: "DATABASE" },
  { slug: "mongodb", name: "MongoDB", category: "DATABASE" },
  { slug: "redis", name: "Redis", category: "DATABASE" },
  { slug: "prisma", name: "Prisma", category: "DATABASE" },
  { slug: "drizzle", name: "Drizzle", category: "DATABASE" },
  { slug: "sqlalchemy", name: "SQLAlchemy", category: "DATABASE" },
  { slug: "supabase", name: "Supabase", category: "DATABASE" },

  // Infrastructure
  { slug: "docker", name: "Docker", category: "INFRASTRUCTURE" },
  { slug: "kubernetes", name: "Kubernetes", category: "INFRASTRUCTURE" },
  { slug: "terraform", name: "Terraform", category: "INFRASTRUCTURE" },
  { slug: "github-actions", name: "GitHub Actions", category: "INFRASTRUCTURE" },
  { slug: "vercel", name: "Vercel", category: "INFRASTRUCTURE" },
  { slug: "cloudflare-workers", name: "Cloudflare Workers", category: "INFRASTRUCTURE" },
  { slug: "fly", name: "Fly.io", category: "INFRASTRUCTURE" },

  // Tooling
  { slug: "vite", name: "Vite", category: "TOOL" },
  { slug: "vitest", name: "Vitest", category: "TOOL" },
  { slug: "jest", name: "Jest", category: "TOOL" },
  { slug: "playwright", name: "Playwright", category: "TOOL" },
  { slug: "pytest", name: "pytest", category: "TOOL" },
  { slug: "storybook", name: "Storybook", category: "TOOL" },
];

export const LINGUIST_TO_SLUG = new Map(
  TECHNOLOGIES.filter((t) => t.linguist).map((t) => [t.linguist as string, t.slug]),
);
