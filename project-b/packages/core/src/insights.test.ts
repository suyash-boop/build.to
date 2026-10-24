import { describe, expect, it } from "vitest";
import { burnup, distribution, forecastCompletion, percentile, weeklyThroughput } from "./insights.ts";

const now = new Date("2026-10-03T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("percentile", () => {
  it("matches percentile_cont interpolation", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10], 0.85)).toBe(10);
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.85)).toBeCloseTo(8.65);
  });
  it("summarises durations in hours and ignores negative clock skew", () => {
    expect(distribution([3_600_000, 7_200_000, -5])).toEqual({ count: 2, p50: 1.5, p85: 1.9, unit: "hours" });
  });
});

describe("weeklyThroughput", () => {
  it("buckets completions into whole weeks, oldest first, keeping empty weeks", () => {
    const t = weeklyThroughput([daysAgo(1), daysAgo(2), daysAgo(9), daysAgo(30)], now, 4);
    expect(t).toEqual([0, 0, 1, 2]);
  });
});

describe("forecastCompletion", () => {
  it("is deterministic for a seed", () => {
    const a = forecastCompletion({ remaining: 20, history: [3, 5, 2, 6, 4, 0, 5], now, seed: 42 });
    const b = forecastCompletion({ remaining: 20, history: [3, 5, 2, 6, 4, 0, 5], now, seed: 42 });
    expect(a).toEqual(b);
  });

  it("orders confidence levels and lands near the arithmetic expectation", () => {
    const f = forecastCompletion({ remaining: 20, history: [4, 4, 4, 4, 4], now, seed: 1 });
    // Constant 4/week: exactly 5 weeks of work; interpolation lands it inside week 5.
    expect(f.p50! >= "2026-10-31" && f.p50! <= "2026-11-07").toBe(true);
    expect(f.p50! <= f.p85! && f.p85! <= f.p95!).toBe(true);
  });

  it("computes on-time probability against a due date", () => {
    const easy = forecastCompletion({ remaining: 2, history: [3, 4, 5], now, dueOn: daysAgo(-30), seed: 7 });
    expect(easy.onTimeProbability).toBe(1);
    const late = forecastCompletion({ remaining: 50, history: [1, 2, 1], now, dueOn: daysAgo(-7), seed: 7 });
    expect(late.onTimeProbability).toBe(0);
    const past = forecastCompletion({ remaining: 5, history: [3, 3, 3], now, dueOn: daysAgo(3), seed: 7 });
    expect(past.onTimeProbability).toBe(0);
  });

  it("explains when it cannot forecast", () => {
    expect(forecastCompletion({ remaining: 0, history: [1, 2, 3], now, seed: 1 }).reason).toBe("done");
    expect(forecastCompletion({ remaining: 5, history: [1, 2], now, seed: 1 }).reason).toBe("no_history");
    expect(forecastCompletion({ remaining: 5, history: [0, 0, 0], now, seed: 1 }).reason).toBe("no_throughput");
  });
});

describe("burnup", () => {
  it("accumulates scope and completion per day", () => {
    const pts = burnup(
      [
        { createdAt: daysAgo(3), completedAt: daysAgo(1) },
        { createdAt: daysAgo(2), completedAt: null },
        { createdAt: daysAgo(10), completedAt: daysAgo(9) },
      ],
      now,
      4,
    );
    expect(pts.map((p) => [p.scope, p.done])).toEqual([
      [2, 1],
      [3, 1],
      [3, 2],
      [3, 2],
    ]);
  });
});
