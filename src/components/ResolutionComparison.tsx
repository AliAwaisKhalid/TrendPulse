"use client";

import React, { useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { saveAs } from "file-saver";
import { compareResolutions, type RowLike, type CI } from "@/lib/diagnostics";

export interface ResolutionData { hourly: RowLike[]; m30: RowLike[]; daily: RowLike[]; anchored?: boolean }

const f2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : v.toFixed(3));
const ci = (c: CI | null) => (c ? `[${c[0].toFixed(3)}, ${c[1].toFixed(3)}]` : "n/a");
const th = "px-3 py-2 text-left font-semibold text-[var(--text-muted)] uppercase tracking-wider text-[10px]";
const td = "px-3 py-2 font-mono text-[var(--text-secondary)]";
const axis = { fill: "var(--text-muted)", fontSize: 11 };

export default function ResolutionComparison({ data, keywords }: { data: Record<string, ResolutionData>; keywords: string[] }) {
  const available = keywords.filter((k) => data[k]);
  const [kw, setKw] = useState<string>(available[0] ?? "");
  const cur = available.includes(kw) ? kw : available[0];
  const res = useMemo(() => (cur ? compareResolutions(data[cur].hourly, data[cur].m30, data[cur].daily) : null), [cur, data]);

  if (!available.length || !res || !cur) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-sm text-[var(--text-muted)] leading-relaxed">
        The comparison needs the daily benchmark. Tick &quot;Validate stitching and compare resolutions&quot;, use a date range of
        8 to 260 days, choose a sub-daily frequency (1 hour is fine) and fetch again.
      </div>
    );
  }

  const exportCSV = () => {
    const head = "keyword,pair,grid,n,n_eff,r_levels,ci_low,ci_high,ci_adj_low,ci_adj_high,r_changes,ci_changes_low,ci_changes_high,ci_changes_adj_low,ci_changes_adj_high,r_changes_trimmed,n_trimmed\n";
    const body = available.flatMap((k) =>
      compareResolutions(data[k].hourly, data[k].m30, data[k].daily).pairs.map((p) =>
        [`"${k}"`, p.pair, p.grid, p.n, p.nEff.toFixed(1), p.r ?? "", p.ci?.[0] ?? "", p.ci?.[1] ?? "", p.ciAdj?.[0] ?? "", p.ciAdj?.[1] ?? "",
          p.rDiff ?? "", p.ciDiff?.[0] ?? "", p.ciDiff?.[1] ?? "", p.ciDiffAdj?.[0] ?? "", p.ciDiffAdj?.[1] ?? "", p.rDiffTrim ?? "", p.nTrim].join(","))
    ).join("\n");
    saveAs(new Blob([head + body], { type: "text/csv;charset=utf-8" }), "resolution_comparison.csv");
  };

  const dayData = res.days.map((d) => ({
    ...d,
    hourlyBand: d.hourlyLo !== null && d.hourlyHi !== null ? [d.hourlyLo, d.hourlyHi] : null,
    m30Band: d.m30Lo !== null && d.m30Hi !== null ? [d.m30Lo, d.m30Hi] : null,
  }));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] font-semibold">
            Resolution comparison: 30-minute, hourly and daily
          </div>
          <select value={cur} onChange={(e) => setKw(e.target.value)}
            className="ml-auto px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)]">
            {available.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button onClick={exportCSV} className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--accent)]">
            Download correlations (CSV)
          </button>
        </div>

        {data[cur]?.anchored && (
          <p className="text-[11px] text-amber-400 leading-relaxed">
            This series was anchored to the daily benchmark, so its agreement with the daily series is partly by construction and is not an independent check.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-[var(--border)]">
              <th className={th}>Pair</th><th className={th}>Grid</th><th className={th}>N</th><th className={th}>N<sub>eff</sub></th>
              <th className={th}>r (levels)</th><th className={th}>95% CI, independent</th><th className={th}>95% CI, autocorr.-adjusted</th>
              <th className={th}>r (changes)</th><th className={th}>95% CI (changes), adjusted</th><th className={th}>r (changes, 5% largest jumps dropped)</th>
            </tr></thead>
            <tbody>
              {res.pairs.map((p) => (
                <tr key={p.pair} className="border-b border-[var(--border)]/50">
                  <td className="px-3 py-2 text-[var(--text-primary)]">{p.pair}</td>
                  <td className={td}>{p.grid}</td><td className={td}>{p.n}</td><td className={td}>{Math.round(p.nEff)}</td>
                  <td className={td}>{f2(p.r)}</td><td className={td}>{ci(p.ci)}</td><td className={td}>{ci(p.ciAdj)}</td>
                  <td className={td}>{f2(p.rDiff)}</td><td className={td}>{ci(p.ciDiffAdj)}</td><td className={td}>{f2(p.rDiffTrim)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
          The 30-minute series is interpolated from the hourly data, so its agreement with the hourly series is a
          property of the construction, not independent evidence. The hourly and 30-minute comparisons with the daily
          series are the informative ones. Confidence intervals use the Fisher z transform. The &quot;independent&quot; interval
          treats every observation as independent and is too narrow for autocorrelated series; the adjusted interval uses an
          AR(1) effective sample size, which is itself an approximation. Correlation in changes (first differences) is
          the stricter test, because shared trends and a single regime jump inflate correlation in levels. The last column drops the 5% largest changes of the daily benchmark: if it is much lower than the full-sample value, the agreement is driven by a few jump days.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <div className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-1 font-semibold">
          Daily means by resolution, with confidence bands
        </div>
        <p className="text-[10px] text-[var(--text-muted)] mb-3">
          Sub-daily series are averaged to days and rescaled to the daily series (least squares through the origin). Bands are
          95% intervals for the within-day mean (mean ± 1.96 SD/√n), clipped to the 0 to 100 range of the index. The 30-minute band is narrower only because it counts
          interpolated points as extra observations.
        </p>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dayData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={axis} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={40} />
              <YAxis domain={[0, "auto"]} tick={axis} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="m30Band" name="30-min 95% band (naive)" stroke="none" fill="#f59e0b" fillOpacity={0.15} isAnimationActive={false} />
              <Area type="monotone" dataKey="hourlyBand" name="Hourly 95% band" stroke="none" fill="#38bdf8" fillOpacity={0.22} isAnimationActive={false} />
              <Line type="monotone" dataKey="m30" name="30-min (daily mean)" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="hourly" name="Hourly (daily mean)" stroke="#38bdf8" strokeWidth={1.8} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="daily" name="Daily (Google benchmark)" stroke="#34d399" strokeWidth={1.8} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <div className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-1 font-semibold">
          Rolling 14-day correlation with the daily benchmark (95% CI)
        </div>
        <p className="text-[10px] text-[var(--text-muted)] mb-3">
          Shows whether agreement between the stitched sub-daily series and the daily series holds throughout the
          sample or breaks down in particular weeks (for example at window seams). Short windows give wide, optimistic
          Fisher intervals because they ignore autocorrelation.
        </p>
        {res.rolling.length ? (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={res.rolling.map((r) => ({ ...r, band: r.lo !== null && r.hi !== null ? [r.lo, r.hi] : null }))} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={axis} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={40} />
                <YAxis domain={[-1, 1]} tick={axis} axisLine={false} tickLine={false} width={35} />
                <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="var(--border-accent)" />
                <Area type="monotone" dataKey="band" name="95% CI (hourly vs daily)" stroke="none" fill="#38bdf8" fillOpacity={0.22} isAnimationActive={false} />
                <Line type="monotone" dataKey="rHourly" name="Hourly vs daily" stroke="#38bdf8" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="rM30" name="30-min vs daily" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-xs text-[var(--text-muted)]">Not enough overlapping days for a 14-day rolling correlation.</div>
        )}
      </div>
    </div>
  );
}
