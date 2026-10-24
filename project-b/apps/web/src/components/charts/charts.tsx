"use client";

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Hand-rolled SVG charts. Specs: bars <= 24px with a 4px rounded data end and square baseline,
 * 2px lines, >= 8px end markers with a surface ring, hairline solid grid, a 10% area wash,
 * hover tooltips with hit targets larger than the marks, text in text tokens only, and an
 * equivalent data table for assistive technology.
 */

const H = 160;
const PAD = { top: 12, right: 12, bottom: 22, left: 28 };

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

function ticks(max: number, n = 4) {
  return Array.from({ length: n + 1 }, (_, i) => Math.round((max / n) * i * 100) / 100);
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  const observe = (el: HTMLDivElement | null) => {
    if (!el || ref.current === el) return;
    ref.current = el;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
  };
  return [observe, w] as const;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg shadow-pop"
      style={{ left, top: y - 8 }}
    >
      {children}
    </div>
  );
}

/* ── Column chart (single series) ──────────────────────────── */

export function ColumnChart({
  data,
  label,
  unit,
  highlightLast = true,
}: {
  /** x is an ISO date (week start). */
  data: { x: string; y: number }[];
  label: string;
  /** Word after the value in tooltips, e.g. "completed". Plain data so server pages can pass it. */
  unit: string;
  highlightLast?: boolean;
}) {
  const formatX = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  const valueLabel = (v: number) => `${v} ${unit}`;
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...data.map((d) => d.y)));
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / data.length;
  const barW = Math.min(24, band * 0.62);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={H} role="img" aria-label={label} className="block overflow-visible">
        {ticks(max).map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-faint text-[10px] tnum">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + band * i + band / 2;
          const top = y(d.y);
          const h = PAD.top + innerH - top;
          const r = Math.min(4, h / 2, barW / 2);
          const x0 = cx - barW / 2;
          const base = PAD.top + innerH;
          const muted = highlightLast && i < data.length - 1;
          return (
            <g key={d.x} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Hit target spans the whole band, taller than the bar. */}
              <rect x={PAD.left + band * i} y={PAD.top} width={band} height={innerH} fill="transparent" />
              {d.y > 0 && (
                <path
                  d={`M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${base} Z`}
                  fill="var(--series-1)"
                  opacity={hover === null ? (muted ? 0.55 : 1) : hover === i ? 1 : 0.35}
                  className="transition-opacity duration-150"
                />
              )}
              {(i === 0 || i === data.length - 1 || i % 3 === 0) && (
                <text x={cx} y={H - 6} textAnchor="middle" className="fill-faint text-[10px]">
                  {formatX(d.x)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Tooltip x={PAD.left + band * hover + band / 2} y={y(data[hover]!.y)} width={width}>
          <span className="text-muted">{formatX(data[hover]!.x)}</span> <span className="font-medium tnum">{valueLabel(data[hover]!.y)}</span>
        </Tooltip>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.x}>
              <th scope="row">{formatX(d.x)}</th>
              <td>{d.y}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Burn-up (two series: scope vs done) ───────────────────── */

export function BurnupChart({ data }: { data: { date: string; scope: number; done: number }[] }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId();
  const max = niceMax(Math.max(1, ...data.map((d) => d.scope)));
  const innerW = width - PAD.left - PAD.right - 44; // room for end labels
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? 0 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const path = (k: "scope" | "done") => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join("");
  const area = `${path("done")}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const last = data[data.length - 1];
  const fmt = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left) / box.width) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  return (
    <div ref={ref} className="relative">
      <div className="mb-2 flex gap-4 text-xs text-muted" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-(--series-2)" /> Scope</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-(--series-1)" /> Done</span>
      </div>
      <svg width={width} height={H} role="img" aria-label="Burn-up: total scope and completed tasks per day" className="block overflow-visible">
        <defs>
          <clipPath id={`${gid}-clip`}>
            <rect x={PAD.left} y={0} width={innerW} height={H} />
          </clipPath>
        </defs>
        {ticks(max).map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-faint text-[10px] tnum">{t}</text>
          </g>
        ))}
        <path d={area} fill="var(--series-1)" opacity={0.1} clipPath={`url(#${gid}-clip)`} />
        <path d={path("scope")} fill="none" stroke="var(--series-2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={path("done")} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {last && (
          <>
            <circle cx={x(data.length - 1)} cy={y(last.scope)} r={4} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2} />
            <circle cx={x(data.length - 1)} cy={y(last.done)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
            <text x={x(data.length - 1) + 9} y={y(last.scope)} dy="0.32em" className="fill-muted text-[11px] tnum">{last.scope} scope</text>
            {Math.abs(y(last.scope) - y(last.done)) > 12 && (
              <text x={x(data.length - 1) + 9} y={y(last.done)} dy="0.32em" className="fill-muted text-[11px] tnum">{last.done} done</text>
            )}
          </>
        )}
        {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i) =>
          data[i] ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="fill-faint text-[10px]">
              {fmt(data[i]!.date)}
            </text>
          ) : null,
        )}
        {hover !== null && data[hover] && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--border-strong)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(data[hover]!.scope)} r={4} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2} />
            <circle cx={x(hover)} cy={y(data[hover]!.done)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
        <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && data[hover] && (
        <Tooltip x={x(hover)} y={y(data[hover]!.scope)} width={width}>
          <span className="text-muted">{fmt(data[hover]!.date)}</span>
          <span className="ml-2 tnum">{data[hover]!.done} of {data[hover]!.scope} done</span>
        </Tooltip>
      )}
      <table className="sr-only">
        <caption>Burn-up by day</caption>
        <thead><tr><th>Date</th><th>Scope</th><th>Done</th></tr></thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}><td>{d.date}</td><td>{d.scope}</td><td>{d.done}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Forecast strip ────────────────────────────────────────── */

/**
 * A date axis from today to the 95% date, marking 50/85/95% completion dates and the due date.
 * Confidence is shown as a band that darkens toward certainty, not as a single fake-precise date.
 */
export function ForecastStrip({ today, p50, p85, p95, due }: { today: string; p50: string; p85: string; p95: string; due: string | null }) {
  const t = (s: string) => new Date(s + "T00:00:00Z").getTime();
  const start = t(today);
  const end = Math.max(t(p95), due ? t(due) : 0) + 86_400_000 * 2;
  const frac = (s: string) => (t(s) - start) / (end - start);
  const pos = (s: string) => `${(frac(s) * 100).toFixed(2)}%`;
  // Labels near either edge anchor inward so they never spill outside the card.
  const anchor = (s: string) => (frac(s) < 0.12 ? "translate-x-0" : frac(s) > 0.88 ? "-translate-x-full" : "-translate-x-1/2");
  const fmt = (s: string) => new Date(s + "T00:00:00Z").toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  const marks = useMemo(() => [
    { label: "50%", date: p50 },
    { label: "85%", date: p85 },
    { label: "95%", date: p95 },
  ], [p50, p85, p95]);

  return (
    <div className="relative pb-6 pt-6" role="img" aria-label={`Forecast: 50% likely by ${fmt(p50)}, 85% by ${fmt(p85)}, 95% by ${fmt(p95)}${due ? `, due ${fmt(due)}` : ""}`}>
      <div className="relative h-2 rounded-sm bg-surface-2">
        <div className="absolute inset-y-0 rounded-sm bg-(--series-1) opacity-20" style={{ left: pos(p50), right: `calc(100% - ${pos(p95)})` }} />
        <div className="absolute inset-y-0 rounded-sm bg-(--series-1) opacity-45" style={{ left: pos(p50), right: `calc(100% - ${pos(p85)})` }} />
        {marks.map((m) => (
          <div key={m.label} className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--series-1) ring-2 ring-surface" style={{ left: pos(m.date) }} />
        ))}
        {due && <div className="absolute -top-2 -bottom-2 w-px -translate-x-1/2 bg-fg" style={{ left: pos(due) }} />}
      </div>
      {marks.map((m, i) => (
        <span
          key={m.label}
          className={cn("absolute top-0 whitespace-nowrap text-2xs text-muted tnum", anchor(m.date), i === 1 && "hidden sm:inline")}
          style={{ left: pos(m.date) }}
        >
          {m.label}
        </span>
      ))}
      {marks.map((m) => (
        <span key={m.date + m.label} className={cn("absolute bottom-0 whitespace-nowrap text-2xs text-faint tnum", anchor(m.date))} style={{ left: pos(m.date) }}>
          {fmt(m.date)}
        </span>
      ))}
      {due && (
        <span className={cn("absolute -bottom-0 hidden translate-y-full whitespace-nowrap pt-1 text-2xs font-medium text-fg sm:inline", anchor(due))} style={{ left: pos(due) }}>
          Due {fmt(due)}
        </span>
      )}
    </div>
  );
}
