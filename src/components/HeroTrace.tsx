"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Hero: a scrubbable sounding trace of real Google Trends data.
 * Daily search interest for "Strait of Hormuz", worldwide, 29 Dec 2025 to 26 Mar 2026
 * (standard daily series, downloaded 13 Oct 2026 through this app's API).
 */
const START = Date.UTC(2025, 11, 29);
const VALUES = [
  0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 2, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 3, 2, 2, 2, 2, 1, 2, 2, 42, 77, 66, 68, 57, 60, 57, 48, 46, 65, 71, 89, 100, 82,
  74, 75, 85, 62, 50, 46, 47, 46, 64, 63, 46, 48, 52,
];
const EVENT_INDEX = 61; // 28 Feb 2026

const W = 1000;
const H = 340;
const PAD = { l: 44, r: 16, t: 18, b: 34 };

function dayLabel(i: number, long = false) {
  const d = new Date(START + i * 86400000);
  return d.toLocaleDateString("en-GB", long ? { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" });
}

export default function HeroTrace() {
  const n = VALUES.length;
  const [idx, setIdx] = useState(VALUES.indexOf(100));
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const x = useCallback((i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r), [n]);
  const y = (v: number) => PAD.t + (1 - v / 100) * (H - PAD.t - PAD.b);

  const { line, area } = useMemo(() => {
    const pts = VALUES.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    return {
      line: "M" + pts.join(" L"),
      area: `M${x(0)},${y(0)} L` + pts.join(" L") + ` L${x(n - 1)},${y(0)} Z`,
    };
  }, [n, x]);

  const pick = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((sx - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
    setIdx(Math.max(0, Math.min(n - 1, i)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 7 : 1;
    if (e.key === "ArrowRight") setIdx((i) => Math.min(n - 1, i + step));
    else if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - step));
    else if (e.key === "Home") setIdx(0);
    else if (e.key === "End") setIdx(n - 1);
    else return;
    e.preventDefault();
  };

  const v = VALUES[idx];
  const before = idx < EVENT_INDEX;
  const tagX = Math.min(Math.max(x(idx), PAD.l + 70), W - PAD.r - 70);

  return (
    <section className="hero-trace relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:p-8">
        <div className="flex flex-col justify-between gap-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Daily search interest · “Strait of Hormuz” · worldwide
            </p>
            <h2 className="font-display mt-3 text-[clamp(2.6rem,6vw,4.6rem)] font-extrabold uppercase leading-[0.88] tracking-[0.01em] text-[var(--text-primary)]">
              Attention arrives <span className="text-[var(--accent-secondary)]">all at once.</span>
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[var(--text-secondary)]">
              Search interest sat near zero for two months, then jumped from 2 to 42 on 28 February 2026. Trend Pulse fetches
              series like this at Google&rsquo;s native hourly step, stitches long ranges window by window, checks them against
              the daily benchmark, and exports to CSV, Excel, Stata and R.
            </p>
          </div>
          <div aria-live="polite">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{dayLabel(idx, true)}</div>
            <div className="mt-1 flex items-end gap-3">
              <div className="font-display text-6xl font-extrabold leading-none tabular-nums text-[var(--accent)]">{v}</div>
              <div className="pb-1 text-[13px] leading-snug text-[var(--text-secondary)]">
                index points
                <br />
                <span className={before ? "text-[var(--text-muted)]" : "font-semibold text-[var(--accent-secondary)]"}>
                  {before ? `${EVENT_INDEX - idx} day${EVENT_INDEX - idx === 1 ? "" : "s"} before the blockade` : idx === EVENT_INDEX ? "the day the blockade began" : `day ${idx - EVENT_INDEX + 1} of the blockade`}
                </span>
              </div>
            </div>
          </div>
        </div>

        <figure className="m-0 flex flex-col justify-center">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="hero-svg block h-auto w-full cursor-ew-resize touch-none select-none rounded-xl outline-none"
            role="slider"
            tabIndex={0}
            aria-label="Daily search interest for Strait of Hormuz. Use the arrow keys to move between days."
            aria-valuemin={0}
            aria-valuemax={n - 1}
            aria-valuenow={idx}
            aria-valuetext={`${dayLabel(idx, true)}: ${v}`}
            onKeyDown={onKey}
            onPointerDown={(e) => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); pick(e.clientX); }}
            onPointerMove={(e) => { if (dragging.current || e.pointerType === "mouse") pick(e.clientX); }}
            onPointerUp={() => { dragging.current = false; }}
          >
            <defs>
              <linearGradient id="depth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.55" />
                <stop offset="55%" stopColor="var(--accent)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.04" />
              </linearGradient>
            </defs>
            {/* soundings grid: isobaths every 25 index points */}
            {[0, 25, 50, 75, 100].map((g) => (
              <g key={g}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeDasharray={g === 0 ? undefined : "2 6"} />
                <text x={PAD.l - 10} y={y(g) + 4} textAnchor="end" className="fill-[var(--text-muted)] font-mono text-[11px]">{g}</text>
              </g>
            ))}
            {[0, 33, 61, n - 1].map((i) => (
              <text key={i} x={x(i)} y={H - 10} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-[var(--text-muted)] font-mono text-[11px]">{dayLabel(i)}</text>
            ))}
            {/* blockade marker */}
            <line x1={x(EVENT_INDEX)} x2={x(EVENT_INDEX)} y1={PAD.t} y2={y(0)} stroke="var(--accent-secondary)" strokeOpacity="0.45" strokeDasharray="3 4" />
            <text x={x(EVENT_INDEX) - 8} y={PAD.t + 12} textAnchor="end" className="fill-[var(--accent-secondary)] font-mono text-[11px] uppercase tracking-wider">blockade →</text>

            <path d={area} fill="url(#depth)" className="hero-area" />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2.4} strokeLinejoin="round" pathLength={1} className="hero-line" />

            {/* scrubber: the sounding line */}
            <line x1={x(idx)} x2={x(idx)} y1={PAD.t - 6} y2={y(0)} stroke="var(--accent-secondary)" strokeWidth={1.5} />
            <circle cx={x(idx)} cy={y(v)} r={6} fill="var(--bg-card)" stroke="var(--accent-secondary)" strokeWidth={2.5} />
            <g transform={`translate(${tagX}, ${y(0) - 12})`}>
              <rect x={-66} y={-20} width={132} height={22} rx={11} fill="var(--accent-secondary)" />
              <text x={0} y={-5} textAnchor="middle" className="fill-white font-mono text-[11px]">{dayLabel(idx)} · {v}</text>
            </g>
          </svg>
          <figcaption className="mt-2 font-mono text-[11px] text-[var(--text-muted)]">
            Drag along the trace, or focus it and use the arrow keys (Shift for a week), to read any day. Source: Google Trends daily series, 29 Dec 2025 to 26 Mar 2026.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
