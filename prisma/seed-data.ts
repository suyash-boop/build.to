// Demo content for the seed script (PRD §11). Realistic posts with actual
// Markdown — code blocks, headings, lists, links — so the app demos against a
// believable state rather than lorem ipsum.

export interface SeedUser {
  username: string;
  name: string;
  email: string;
  bio: string;
  location: string;
  brandColor: string;
  work?: string;
  skills?: string;
  githubUsername?: string;
  pronouns?: string;
}

export const seedUsers: SeedUser[] = [
  {
    username: "ada",
    name: "Ada Okonkwo",
    email: "ada@example.com",
    bio: "Backend engineer who thinks about databases more than is healthy.",
    location: "Lagos, Nigeria",
    brandColor: "#0e7490",
    work: "Staff Engineer @ Ledgerline",
    skills: "PostgreSQL, Go, Kafka, distributed systems",
    githubUsername: "torvalds",
    pronouns: "she/her",
  },
  {
    username: "mateo",
    name: "Mateo Rossi",
    email: "mateo@example.com",
    bio: "Frontend by day, synth patches by night. Accessibility matters.",
    location: "Milan, Italy",
    brandColor: "#7c3aed",
    work: "UI Engineer @ Northwind",
    skills: "TypeScript, React, CSS, a11y",
    githubUsername: "gaearon",
    pronouns: "he/him",
  },
  {
    username: "priya",
    name: "Priya Nair",
    email: "priya@example.com",
    bio: "ML engineer. I like small models that do one thing well.",
    location: "Bengaluru, India",
    brandColor: "#059669",
    work: "ML Engineer @ Vellum AI",
    skills: "Python, PyTorch, ONNX, inference optimization",
    pronouns: "she/her",
  },
  {
    username: "sam",
    name: "Sam Whitfield",
    email: "sam@example.com",
    bio: "Infra plumber. Terraform whisperer. On-call survivor.",
    location: "Austin, TX",
    brandColor: "#b45309",
    work: "SRE @ Cirroform",
    skills: "Kubernetes, Terraform, Prometheus, AWS",
  },
  {
    username: "yuki",
    name: "Yuki Tanaka",
    email: "yuki@example.com",
    bio: "Rustacean writing systems tools nobody asked for.",
    location: "Osaka, Japan",
    brandColor: "#dc2626",
    work: "Systems Engineer @ Kernelworks",
    skills: "Rust, C, WebAssembly, CLIs",
    pronouns: "they/them",
  },
  {
    username: "lena",
    name: "Lena Fischer",
    email: "lena@example.com",
    bio: "Security researcher. I read your dependencies so you don't have to.",
    location: "Berlin, Germany",
    brandColor: "#4f46e5",
    work: "AppSec @ Halden",
    skills: "AppSec, fuzzing, threat modeling",
    pronouns: "she/her",
  },
  {
    username: "diego",
    name: "Diego Herrera",
    email: "diego@example.com",
    bio: "Full-stack generalist. Ships small, ships often.",
    location: "Mexico City, Mexico",
    brandColor: "#be185d",
    work: "Founding Engineer @ Tallo",
    skills: "Node, Next.js, SQLite, product",
  },
  {
    username: "nadia",
    name: "Nadia Haddad",
    email: "nadia@example.com",
    bio: "Data engineer turning swamps back into lakes.",
    location: "Toronto, Canada",
    brandColor: "#0891b2",
    work: "Data Engineer @ Brightpath",
    skills: "dbt, Spark, Airflow, SQL",
    pronouns: "she/her",
  },
];

export interface SeedPost {
  authorUsername: string;
  title: string;
  tags: string[];
  body: string;
}

const md = String.raw;

export const seedPosts: SeedPost[] = [
  {
    authorUsername: "ada",
    title: "Denormalized counters are a cache, so treat them like one",
    tags: ["databases", "architecture", "postgres"],
    body: md`Every time you store a \`likes_count\` column next to a \`likes\` table,
you have created a cache. The moment you accept that, a lot of confusion goes away.

## The fast path may lie

A \`COUNT(*)\` is always correct and always slower than reading an integer. So we
denormalize:

\`\`\`sql
UPDATE posts SET reactions_count = reactions_count + 1 WHERE id = $1;
\`\`\`

The catch: this number can drift. A failed transaction, a manual edit, a bug —
any of them leave the counter and the truth disagreeing.

## The slow path tells the truth

Rather than pretend drift can't happen, assume it and repair on a schedule:

\`\`\`sql
UPDATE posts p
SET reactions_count = (
  SELECT COUNT(*) FROM reactions r WHERE r.reactable_id = p.id
);
\`\`\`

Run that periodically and the counter self-heals. The demo that convinces
skeptics: corrupt a counter by hand, wait, watch it correct itself.

That's the whole trick. Fast path for reads, slow path for truth.`,
  },
  {
    authorUsername: "mateo",
    title: "Dark mode without the flash of wrong theme",
    tags: ["css", "webdev", "frontend"],
    body: md`You ship dark mode, and on every load there's a jarring white flash
before the dark theme kicks in. Here's why, and how to kill it.

## The cause

If you read the theme in a \`useEffect\`, the server rendered light, the browser
painted light, and only *then* your JS switched to dark. That gap is the flash.

## The fix: decide before paint

Store the theme in a cookie so the **server** knows it and renders the right
theme immediately:

\`\`\`tsx
const theme = cookies().get("theme")?.value ?? "light";
return <html data-theme={theme}>...</html>;
\`\`\`

No client round-trip, no flash. The toggle just writes the cookie and flips the
attribute.

## Why not the media query alone?

\`prefers-color-scheme\` is a great default, but users want to override it. A
cookie lets you respect the OS preference *and* remember an explicit choice.`,
  },
  {
    authorUsername: "priya",
    title: "Your model is fine. Your tokenizer is the bottleneck.",
    tags: ["ai", "python", "performance"],
    body: md`I spent a week optimizing a model's inference and got a 4% speedup. Then
I looked at the tokenizer and got 40%.

## Measure the whole pipeline

Everyone profiles the forward pass. Almost nobody profiles preprocessing:

\`\`\`python
import time

t0 = time.perf_counter()
tokens = tokenizer(texts, padding=True, truncation=True)
t1 = time.perf_counter()
print(f"tokenize: {(t1 - t0) * 1000:.1f}ms")
\`\`\`

On a batch of short texts, tokenization was 60% of wall-clock time. The GPU was
starving while a single Python thread chopped strings.

## What actually helped

- Use the fast (Rust) tokenizer, not the Python one
- Batch aggressively — per-request tokenization wastes everything
- Cache tokenized prompts that repeat

None of this touches the model. That's the point.`,
  },
  {
    authorUsername: "yuki",
    title: "Writing a tiny CLI in Rust that starts instantly",
    tags: ["rust", "cli", "performance"],
    body: md`Node CLIs are lovely to write and painful to wait for. A cold \`node\`
start is ~50ms before your code runs. For a tool you call fifty times an hour,
that adds up. Rust starts in under a millisecond.

## A minimal argument parse

\`\`\`rust
use std::env;

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("hello") => println!("hi!"),
        _ => eprintln!("usage: mytool hello"),
    }
}
\`\`\`

## The real win

It's not just speed — it's the single static binary. No runtime to install, no
\`node_modules\`, no version drift. You \`scp\` one file and it runs.

For anything you'll type at a prompt daily, that tradeoff is worth the borrow
checker's occasional scolding.`,
  },
  {
    authorUsername: "sam",
    title: "The Terraform state file is not a place for secrets",
    tags: ["devops", "terraform", "security"],
    body: md`Friendly reminder that your Terraform state stores every resource
attribute in plaintext — including that database password you passed in as a
variable.

## What ends up in state

\`\`\`hcl
resource "aws_db_instance" "main" {
  password = var.db_password  # now in state, in the clear
}
\`\`\`

Anyone who can read the state file can read the password. If that state is in an
unencrypted S3 bucket, so can anyone who finds the bucket.

## Do this instead

- Store state in an **encrypted** backend with tight IAM
- Generate secrets *outside* Terraform (or with \`random_password\` + a secrets
  manager) and reference them, don't pass them
- Never commit \`terraform.tfstate\` — it belongs in \`.gitignore\`

State is infrastructure metadata, but it leaks like a credential store. Treat it
like one.`,
  },
  {
    authorUsername: "lena",
    title: "A transitive dependency shipped a backdoor. Here's the trail.",
    tags: ["security", "webdev", "opensource"],
    body: md`Your app has maybe 40 direct dependencies and 1,400 transitive ones.
You audit the 40. The attack came through the 1,400.

## The shape of it

A popular package's maintainer handed off to a "helpful" new contributor. Three
minor releases later, a build step fetched and ran a remote script — only in
production, only when certain env vars existed.

\`\`\`js
if (process.env.CI && process.env.NODE_ENV === "production") {
  // innocuous-looking postinstall that wasn't
}
\`\`\`

## Practical defenses

- **Lockfiles, always.** Pin exact versions and review lockfile diffs.
- **\`--ignore-scripts\`** in CI unless a package genuinely needs them.
- Watch for maintainer changes on critical packages.
- Prefer fewer, boring dependencies over many clever ones.

You can't read 1,400 packages. You can shrink the number and slow down the
update pipeline enough to notice.`,
  },
  {
    authorUsername: "diego",
    title: "SQLite is a real database and probably enough for your app",
    tags: ["databases", "webdev", "sqlite"],
    body: md`I keep meeting teams running a managed Postgres cluster for an app with
200 daily users. SQLite would serve them faster and cost nothing.

## The objections, addressed

**"It doesn't handle concurrency."** WAL mode handles concurrent reads fine, and
most apps are read-heavy. One writer at a time is not the bottleneck you think.

\`\`\`sql
PRAGMA journal_mode = WAL;
\`\`\`

**"It won't scale."** It'll scale further than your traffic. When you outgrow it,
migrating to Postgres is a known, boring path.

**"No network access."** That's a feature. The database is a file next to your
app — no connection pool, no latency, no separate thing to operate.

## When not to use it

Multiple app servers that all need to write? Then yes, reach for Postgres. But a
single server — which is most apps — is squarely SQLite's home turf.`,
  },
  {
    authorUsername: "nadia",
    title: "Idempotent pipelines, or how I stopped fearing reruns",
    tags: ["dataengineering", "architecture", "sql"],
    body: md`The scariest words in data engineering are "can you just rerun it?"
They shouldn't be. If a pipeline is idempotent, rerunning is free.

## Non-idempotent: the trap

\`\`\`sql
INSERT INTO daily_totals SELECT ... FROM events WHERE day = '2026-07-01';
\`\`\`

Run this twice and you've double-counted. Now every rerun is a risk and every
failure is a 2am judgment call.

## Idempotent: the fix

Make the write *replace* the partition, not append to it:

\`\`\`sql
DELETE FROM daily_totals WHERE day = '2026-07-01';
INSERT INTO daily_totals SELECT ... FROM events WHERE day = '2026-07-01';
\`\`\`

Or \`MERGE\`, or \`INSERT ... ON CONFLICT\`. The shape is always the same: the
output depends only on the input, not on how many times you ran it.

Get this right and reruns stop being scary. That alone is worth the refactor.`,
  },
  {
    authorUsername: "ada",
    title: "Read your query plans before you add an index",
    tags: ["databases", "postgres", "performance"],
    body: md`Adding indexes by vibes is how you end up with a table that has twelve
of them and still runs slow. \`EXPLAIN ANALYZE\` tells you what's actually
happening.

\`\`\`sql
EXPLAIN ANALYZE
SELECT * FROM posts WHERE published = true ORDER BY published_at DESC LIMIT 20;
\`\`\`

If you see a \`Seq Scan\` followed by a \`Sort\` on a big table, *that's* your
index — one that matches both the filter and the order:

\`\`\`sql
CREATE INDEX ON posts (published, published_at DESC);
\`\`\`

Now the planner can walk the index in order and stop after 20 rows. No scan, no
sort. Measure again to confirm — the plan doesn't lie, and neither does the
timing.`,
  },
  {
    authorUsername: "mateo",
    title: "Stop making everything a client component",
    tags: ["react", "nextjs", "webdev"],
    body: md`The fastest React component is the one that never ships to the browser.
Server components make that the default — if you let them.

## The reflex to unlearn

You need one \`onClick\`, so you slap \`"use client"\` at the top of a 300-line
page. Now the whole thing — data fetching, formatting, all of it — runs on the
client.

## Push the interactivity down

Keep the page a server component. Extract just the interactive bit into a small
client leaf:

\`\`\`tsx
// page.tsx — server component
import { LikeButton } from "./LikeButton"; // "use client", tiny

export default async function Page() {
  const post = await getPost();
  return <article>{post.body}<LikeButton id={post.id} /></article>;
}
\`\`\`

The article stays on the server. Only the button's handful of KB reaches the
browser. Do this consistently and your bundles shrink without you thinking about
it.`,
  },
  {
    authorUsername: "yuki",
    title: "WebAssembly is not a JavaScript replacement, and that's fine",
    tags: ["webassembly", "rust", "performance"],
    body: md`Every few months someone declares Wasm will kill JavaScript. It won't,
and wanting it to misunderstands what it's for.

## What Wasm is good at

Tight, compute-heavy loops with no DOM: image processing, parsing, crypto,
simulation. Ship those as a \`.wasm\` module and call them from JS.

\`\`\`js
const { instance } = await WebAssembly.instantiateStreaming(
  fetch("filter.wasm"),
);
instance.exports.blur(ptr, width, height);
\`\`\`

## What it's bad at

Touching the DOM. Every DOM call from Wasm crosses back into JS anyway, so a
"pure Wasm" UI is slower, not faster.

The right mental model: JavaScript orchestrates, Wasm does the number crunching.
They're teammates, not rivals.`,
  },
  {
    authorUsername: "priya",
    title: "Quantization explained without the scary math",
    tags: ["ai", "performance", "python"],
    body: md`Your model's weights are 32-bit floats. Most of that precision is
wasted. Quantization throws the waste away and your model gets smaller and
faster for almost no accuracy cost.

## The core idea

A weight of \`0.4823917\` doesn't need 32 bits. Map the whole range of weights
onto 256 buckets (8 bits) and store the bucket number:

\`\`\`python
scale = (w_max - w_min) / 255
q = round((w - w_min) / scale)   # an int in [0, 255]
\`\`\`

Four times smaller, and integer math runs faster than float on most hardware.

## The tradeoff

You lose a little precision. For most models that's a fraction of a percent of
accuracy — invisible in practice, huge in deployment cost. Start with 8-bit,
measure, and only chase 4-bit if you actually need it.`,
  },
];
