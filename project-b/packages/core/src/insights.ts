/**
 * Delivery analytics: pure functions over task and pull request timestamps. Everything here is
 * deterministic (seeded randomness) so numbers do not jitter between page loads.
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Linear-interpolated percentile (same definition as Postgres percentile_cont). */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}

export interface Distribution {
  count: number;
  p50: number | null;
  p85: number | null;
  /** Hours, for display. */
  unit: "hours";
}

export function distribution(durationsMs: number[]): Distribution {
  const hours = durationsMs.filter((d) => d >= 0).map((d) => d / 3_600_000);
  return { count: hours.length, p50: round1(percentile(hours, 0.5)), p85: round1(percentile(hours, 0.85)), unit: "hours" };
}

const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

/**
 * Items completed per week for the last `weeks` whole weeks ending at `now`.
 * Index 0 is the oldest week. Weeks with zero completions are kept: they are real data.
 */
export function weeklyThroughput(completedAt: Date[], now: Date, weeks: number): number[] {
  const end = now.getTime();
  const start = end - weeks * WEEK;
  const buckets = new Array<number>(weeks).fill(0);
  for (const d of completedAt) {
    const t = d.getTime();
    if (t < start || t >= end) continue;
    buckets[Math.min(weeks - 1, Math.floor((t - start) / WEEK))]! += 1;
  }
  return buckets;
}

/** Mulberry32: small, fast, good enough distribution for Monte Carlo; seedable for stable output. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Forecast {
  remaining: number;
  /** Weeks of history the simulation sampled from. */
  sampleWeeks: number;
  simulations: number;
  /** Completion dates at the given confidence levels (ISO dates), or null if unreachable. */
  p50: string | null;
  p85: string | null;
  p95: string | null;
  /** Probability (0..1) of finishing on or before the due date, when one is set. */
  onTimeProbability: number | null;
  /** Why a forecast could not be made, when it could not. */
  reason: "done" | "no_history" | "no_throughput" | null;
}

/**
 * Monte Carlo forecast: repeatedly sample a historical week's throughput until the remaining
 * work is exhausted, and read completion dates off the resulting distribution. Makes no
 * assumption that throughput is normal or steady, which real teams never are.
 */
export function forecastCompletion(opts: {
  remaining: number;
  history: number[];
  now: Date;
  dueOn?: Date | null;
  seed: number;
  simulations?: number;
  maxWeeks?: number;
}): Forecast {
  const simulations = opts.simulations ?? 5000;
  const maxWeeks = opts.maxWeeks ?? 104;
  const base = { remaining: opts.remaining, sampleWeeks: opts.history.length, simulations, p50: null, p85: null, p95: null, onTimeProbability: null };
  if (opts.remaining <= 0) return { ...base, reason: "done" };
  if (opts.history.length < 3) return { ...base, reason: "no_history" };
  if (opts.history.every((w) => w === 0)) return { ...base, reason: "no_throughput" };

  const rand = rng(opts.seed);
  const weeksNeeded: number[] = [];
  for (let s = 0; s < simulations; s++) {
    let left = opts.remaining;
    let w = 0;
    while (left > 0 && w < maxWeeks) {
      left -= opts.history[Math.floor(rand() * opts.history.length)]!;
      w++;
    }
    // Interpolate within the final week so dates are not all quantised to week boundaries.
    weeksNeeded.push(left > 0 ? Infinity : w - 1 + rand());
  }
  weeksNeeded.sort((a, b) => a - b);
  const at = (p: number) => {
    const v = weeksNeeded[Math.min(weeksNeeded.length - 1, Math.floor(p * weeksNeeded.length))]!;
    return Number.isFinite(v) ? isoDate(new Date(opts.now.getTime() + v * WEEK)) : null;
  };
  let onTime: number | null = null;
  if (opts.dueOn) {
    const budgetWeeks = (opts.dueOn.getTime() + DAY - opts.now.getTime()) / WEEK;
    onTime = budgetWeeks <= 0 ? 0 : weeksNeeded.filter((w) => w <= budgetWeeks).length / weeksNeeded.length;
    onTime = Math.round(onTime * 100) / 100;
  }
  return { ...base, p50: at(0.5), p85: at(0.85), p95: at(0.95), onTimeProbability: onTime, reason: null };
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const HISTORY_WEEKS = 12;

export interface ProjectMilestoneForecast extends Forecast {
  milestone: { id: string; title: string; dueOn: Date | null; status: string };
  done: number;
}

/**
 * Forecast every open milestone of a project from its last 12 weeks of completions. One
 * implementation shared by the Insights page and the signals scan, so they never disagree.
 */
export async function projectMilestoneForecasts(
  db: {
    task: {
      findMany(args: { where: object; select: { completedAt: true } }): Promise<{ completedAt: Date | null }[]>;
      groupBy(args: object): Promise<unknown>;
    };
    milestone: { findMany(args: object): Promise<{ id: string; title: string; dueOn: Date | null; status: string }[]> };
  },
  projectId: string,
  now: Date,
): Promise<{ history: number[]; forecasts: ProjectMilestoneForecast[] }> {
  const historyStart = new Date(now.getTime() - HISTORY_WEEKS * WEEK);
  const [done, milestones] = await Promise.all([
    db.task.findMany({ where: { projectId, status: "DONE", completedAt: { gte: historyStart } }, select: { completedAt: true } }),
    db.milestone.findMany({ where: { projectId, status: { in: ["ACTIVE", "PLANNED"] } }, orderBy: { position: "asc" } }),
  ]);
  const history = weeklyThroughput(done.map((d) => d.completedAt!).filter(Boolean), now, HISTORY_WEEKS);
  if (milestones.length === 0) return { history, forecasts: [] };

  const counts = (await db.task.groupBy({
    by: ["milestoneId", "status"],
    where: { milestoneId: { in: milestones.map((m) => m.id) } },
    _count: true,
  })) as { milestoneId: string | null; status: string; _count: number }[];

  // Weeks before the team's first completion are not "zero pace"; they are before the project
  // was delivering at all. Trim them so young projects are not forecast pessimistically.
  const firstActive = history.findIndex((w) => w > 0);
  const pace = firstActive === -1 ? history : history.slice(firstActive);

  const forecasts = milestones.map((m) => {
    const rows = counts.filter((c) => c.milestoneId === m.id);
    const remaining = rows.filter((c) => c.status !== "DONE" && c.status !== "CANCELED").reduce((a, c) => a + c._count, 0);
    const doneCount = rows.filter((c) => c.status === "DONE").reduce((a, c) => a + c._count, 0);
    const f = forecastCompletion({
      remaining,
      history: pace,
      now,
      dueOn: m.dueOn,
      // Stable within a day; reruns on the same data give the same answer.
      seed: hashSeed(`${m.id}:${isoDate(now)}:${remaining}`),
    });
    return { ...f, milestone: m, done: doneCount };
  });
  return { history, forecasts };
}

/** Daily cumulative created vs. completed (burn-up) over the last `days` days. */
export function burnup(tasks: { createdAt: Date; completedAt: Date | null }[], now: Date, days: number) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY;
  const start = end - days * DAY;
  const points: { date: string; scope: number; done: number }[] = [];
  const created = tasks.map((t) => t.createdAt.getTime()).sort((a, b) => a - b);
  const completed = tasks.map((t) => t.completedAt?.getTime()).filter((t): t is number => t != null).sort((a, b) => a - b);
  let ci = 0;
  let di = 0;
  for (let day = start; day < end; day += DAY) {
    const cut = day + DAY;
    while (ci < created.length && created[ci]! < cut) ci++;
    while (di < completed.length && completed[di]! < cut) di++;
    points.push({ date: isoDate(new Date(day)), scope: ci, done: di });
  }
  return points;
}
