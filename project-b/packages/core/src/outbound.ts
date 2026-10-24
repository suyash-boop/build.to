import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { WEBHOOK_CATEGORIES, type WebhookCategory } from "@bldt/contracts";

/**
 * Outbound webhooks: the public event contract, payload envelope, Slack and Discord formatting,
 * and request signing. Delivery (network, retries) lives in the worker.
 */

export { WEBHOOK_CATEGORIES, type WebhookCategory };
export type WebhookFormatName = "JSON" | "SLACK" | "DISCORD";

/** Internal activity type -> public event name. Public names are a stable contract; internal ones may change. */
const PUBLIC_EVENTS: Record<string, { type: string; category: WebhookCategory }> = {
  "task.created": { type: "task.created", category: "task" },
  "task.completed": { type: "task.completed", category: "task" },
  "task.status_changed": { type: "task.status_changed", category: "task" },
  "task.due_changed": { type: "task.due_changed", category: "task" },
  "milestone.completed": { type: "milestone.completed", category: "milestone" },
  "release.published": { type: "release.published", category: "release" },
  "project.shipped": { type: "project.shipped", category: "release" },
  "project.stage_changed": { type: "project.stage_changed", category: "project" },
  "member.joined": { type: "member.joined", category: "member" },
  "member.left": { type: "member.left", category: "member" },
  "github.pr_opened": { type: "pull_request.opened", category: "pull_request" },
  "github.pr_merged": { type: "pull_request.merged", category: "pull_request" },
  "github.pr_closed": { type: "pull_request.closed", category: "pull_request" },
  "github.review": { type: "pull_request.reviewed", category: "pull_request" },
  "github.push": { type: "push", category: "push" },
  "github.deployment": { type: "deployment.succeeded", category: "deployment" },
};

export function publicEvent(internalType: string) {
  return PUBLIC_EVENTS[internalType] ?? null;
}

export function wantsCategory(subscribed: string[], category: WebhookCategory) {
  return subscribed.length === 0 || subscribed.includes(category);
}

/** Attempt n (1-based) failed: wait RETRY_DELAYS_MS[n-1] before the next. Eight attempts over about ten hours. */
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000, 10_800_000, 21_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** Consecutive failed deliveries (not attempts) before an endpoint is switched off. */
export const AUTO_DISABLE_AFTER = 15;
export const MAX_ENDPOINTS_PER_PROJECT = 10;

export interface WebhookEnvelope {
  /** Stable per event; receivers dedupe on it (redeliveries reuse it). */
  id: string;
  type: string;
  createdAt: string;
  project: { id: string; name: string; slug: string; owner: string; url: string };
  actor: { username: string | null; name: string | null; githubLogin: string | null } | null;
  /** Best link for a human: the task, pull request, release, or project page. */
  url: string | null;
  data: Record<string, unknown>;
}

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export function projectUrl(origin: string, owner: string, slug: string) {
  return `${origin.replace(/\/$/, "")}/${owner}/${slug}`;
}

export function activityEnvelope(input: {
  id: string;
  type: string;
  payload: P;
  occurredAt: Date;
  project: WebhookEnvelope["project"];
  actor: WebhookEnvelope["actor"];
}): WebhookEnvelope | null {
  const pub = publicEvent(input.type);
  if (!pub) return null;
  const p = input.payload;
  const base = input.project.url;
  let url: string | null = null;
  const taskNo = /-(\d+)$/.exec(str(p.identifier))?.[1];
  if (pub.category === "task" && taskNo) url = `${base}/tasks?task=${taskNo}`;
  else if (pub.category === "milestone") url = `${base}/milestones`;
  else if (pub.category === "member") url = `${base}/people`;
  else if (pub.category === "push") url = str(p.compareUrl) || null;
  else if (typeof p.url === "string" && /^https?:\/\//.test(p.url)) url = p.url;
  else if (pub.category === "release" || pub.category === "project") url = `${base}/releases`;
  return { id: `evt_${input.id}`, type: pub.type, createdAt: input.occurredAt.toISOString(), project: input.project, actor: input.actor, url, data: p };
}

/** A human sentence for chat formats. Subject is the linked part. */
export function describe(e: WebhookEnvelope): { actor: string; verb: string; subject: string; detail: string | null } {
  const d = e.data;
  const actor = e.actor?.name || e.actor?.username || e.actor?.githubLogin || "Someone";
  const task = `${str(d.identifier)} ${str(d.title)}`.trim();
  const pr = `#${str(d.number)} ${str(d.title)}`.trim();
  const status = (s: unknown) => str(s).toLowerCase().replace(/_/g, " ");
  switch (e.type) {
    case "task.created":
      return { actor, verb: "created", subject: task, detail: null };
    case "task.completed":
      return { actor, verb: "completed", subject: task, detail: null };
    case "task.status_changed":
      return { actor, verb: `moved to ${status(d.to)}:`, subject: task, detail: null };
    case "task.due_changed":
      return { actor, verb: d.dueOn ? `set a due date (${str(d.dueOn)}) on` : "cleared the due date on", subject: task, detail: null };
    case "milestone.completed":
      return { actor, verb: "completed milestone", subject: str(d.title), detail: d.total != null ? `${str(d.done)} of ${str(d.total)} tasks done` : null };
    case "release.published":
      return { actor, verb: "published", subject: [str(d.title), str(d.version)].filter(Boolean).join(" "), detail: null };
    case "project.shipped":
      return { actor, verb: "shipped", subject: [str(d.title), str(d.version)].filter(Boolean).join(" "), detail: null };
    case "project.stage_changed":
      return { actor, verb: "moved the project to", subject: status(d.to), detail: null };
    case "member.joined":
      return { actor, verb: "joined as", subject: status(d.role) || "member", detail: null };
    case "member.left":
      return { actor, verb: d.removedBy ? "was removed from" : "left", subject: e.project.name, detail: null };
    case "pull_request.opened":
      return { actor, verb: "opened", subject: pr, detail: null };
    case "pull_request.merged":
      return { actor, verb: "merged", subject: pr, detail: d.additions != null ? `+${str(d.additions)} -${str(d.deletions)}` : null };
    case "pull_request.closed":
      return { actor, verb: "closed", subject: pr, detail: null };
    case "pull_request.reviewed":
      return { actor, verb: d.state === "approved" ? "approved" : d.state === "changes_requested" ? "requested changes on" : "reviewed", subject: pr, detail: null };
    case "push": {
      const n = Number(d.count ?? 0);
      const msgs = Array.isArray(d.messages) ? (d.messages as unknown[]).map(str) : [];
      return { actor, verb: `pushed to ${str(d.branch)}:`, subject: n === 1 ? "1 commit" : `${n} commits`, detail: msgs.at(-1) ?? null };
    }
    case "deployment.succeeded":
      return { actor, verb: `deployed ${str(d.sha).slice(0, 7)} to`, subject: str(d.environment), detail: null };
    case "signal.raised":
      return { actor: str(d.severity) === "CRITICAL" ? "Critical" : "Warning", verb: "", subject: str(d.title), detail: null };
    case "ping":
      return { actor: "bld.t", verb: "sent a test event to", subject: "this endpoint", detail: "If you can read this, the webhook works." };
    default:
      return { actor, verb: e.type, subject: "", detail: null };
  }
}

const COLORS: Record<string, number> = { CRITICAL: 0xd93636, WARNING: 0xd99a1e, default: 0x2a78d6, shipped: 0x2f9e5c };

/** Slack mrkdwn: & < > are control characters and must be escaped in user text. */
const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function formatBody(format: WebhookFormatName, e: WebhookEnvelope): string {
  // Fixed key order: stored envelopes come back from jsonb reordered, and receivers read these by eye.
  if (format === "JSON") return JSON.stringify({ id: e.id, type: e.type, createdAt: e.createdAt, project: e.project, actor: e.actor, url: e.url, data: e.data });
  const t = describe(e);
  const sentence = [t.actor, t.verb].filter(Boolean).join(" ");
  if (format === "SLACK") {
    const subject = t.subject ? (e.url ? `<${e.url}|${slackEscape(t.subject).replace(/\|/g, "¦")}>` : `*${slackEscape(t.subject)}*`) : "";
    const lines = [`*${slackEscape(e.project.name)}* · ${slackEscape(sentence)} ${subject}`.trim()];
    if (t.detail) lines.push(`> ${slackEscape(t.detail)}`);
    return JSON.stringify({ text: lines.join("\n"), unfurl_links: false, unfurl_media: false });
  }
  // Discord: one embed; mentions disabled so event text can never ping @everyone or a role.
  const color = e.type === "signal.raised" ? (COLORS[str(e.data.severity)] ?? COLORS.default) : /merged|shipped|completed|published|succeeded/.test(e.type) ? COLORS.shipped : COLORS.default;
  return JSON.stringify({
    username: "bld.t",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: (t.subject || e.type).slice(0, 256),
        ...(e.url ? { url: e.url } : {}),
        description: [sentence, t.detail].filter(Boolean).join("\n").slice(0, 2000),
        color,
        timestamp: e.createdAt,
        footer: { text: `${e.project.owner}/${e.project.slug} · ${e.type}`.slice(0, 2048) },
      },
    ],
  });
}

export function generateWebhookSecret() {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. The timestamp is signed to stop replays. */
export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

/** Reference verifier for receivers (documented in settings). Rejects signatures older than the tolerance. */
export function verifyWebhookSignature(secret: string, body: string, header: string, toleranceSec = 300, now = Math.floor(Date.now() / 1000)) {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > toleranceSec || !parts.v1) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function signalEnvelope(input: {
  id: string;
  notifiedAt: Date;
  signalType: string;
  severity: string;
  title: string;
  data: P;
  project: WebhookEnvelope["project"];
}): WebhookEnvelope {
  const d = input.data;
  const taskNo = typeof d.number === "number" ? d.number : null;
  const url =
    taskNo != null
      ? `${input.project.url}/tasks?task=${taskNo}`
      : typeof d.url === "string" && /^https:\/\//.test(d.url)
        ? d.url
        : input.signalType === "milestone.at_risk"
          ? `${input.project.url}/milestones`
          : input.project.url;
  return {
    // Escalation is a new event; the same occurrence at the same severity is not.
    id: `sig_${input.id}_${input.notifiedAt.getTime()}`,
    type: "signal.raised",
    createdAt: input.notifiedAt.toISOString(),
    project: input.project,
    actor: null,
    url,
    data: { signalType: input.signalType, severity: input.severity, title: input.title, ...d },
  };
}

export function pingEnvelope(id: string, project: WebhookEnvelope["project"], actor: WebhookEnvelope["actor"]): WebhookEnvelope {
  return { id: `ping_${id}`, type: "ping", createdAt: new Date().toISOString(), project, actor, url: project.url, data: { message: "Test event from bld.t" } };
}
