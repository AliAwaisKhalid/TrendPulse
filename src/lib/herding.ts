/**
 * Alignment of Google Trends series to the 30-minute bins of the 40-firm shipping herding panel
 * (Dynamic_Herding_Shipping.dta, 1,543 bins, 29 Dec 2025 to 26 Mar 2026).
 *
 * The herding bins are defined in exchange-local time (date_exchange x interval_30), and each bin
 * carries the UTC time of its first observation (datetime_utc). Because firms trade on exchanges in
 * different time zones, several bins share one UTC time and the UTC times are not monotonic in bin
 * order. Alignment therefore uses the bin's datetime_utc exactly as stored in the panel.
 */

export interface HerdingBin {
  t_con: number;
  period_id: number;
  date_exchange: string;
  interval_30: number;
  /** "YYYY-MM-DD HH:MM", UTC */
  datetime_utc: string;
}

export const HERDING_BINS_URL = "/herding_bins_40firms.csv";

export function parseHerdingBins(text: string): HerdingBin[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const ix = (n: string) => head.indexOf(n);
  const iDt = ix("datetime_utc");
  if (iDt < 0) throw new Error("Herding file needs a datetime_utc column (YYYY-MM-DD HH:MM, UTC).");
  return lines.slice(1).map((l, k) => {
    const c = l.split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
    return {
      t_con: ix("t_con") >= 0 ? Number(c[ix("t_con")]) : k + 1,
      period_id: ix("period_id") >= 0 ? Number(c[ix("period_id")]) : k + 1,
      date_exchange: ix("date_exchange") >= 0 ? c[ix("date_exchange")] : c[iDt].slice(0, 10),
      interval_30: ix("interval_30") >= 0 ? Number(c[ix("interval_30")]) : NaN,
      datetime_utc: c[iDt].slice(0, 16),
    };
  });
}

const toMs = (dt: string) => Date.parse(dt.replace(" ", "T").slice(0, 16) + ":00Z");

export type MatchType = "exact" | "asof" | "none";

export interface AlignedRow {
  bin: HerdingBin;
  values: Record<string, number | null>;
  match: MatchType;
  /** Minutes between the bin time and the Trends observation used (0 when exact). */
  gapMin: number | null;
}

export interface AlignmentSummary {
  nBins: number;
  exact: number;
  asof: number;
  none: number;
  uniqueUtcTimes: number;
  nonMonotonic: number;
  firstBin: string;
  lastBin: string;
  seriesStart: string;
  seriesEnd: string;
}

/**
 * For each bin: use the Trends value stamped at the bin's UTC time when it exists; otherwise the latest
 * value at or before the bin time, if it is no more than maxGapMin earlier (as-of match). Values are
 * never taken from the future, so attention is never matched to an earlier herding bin.
 */
export function alignToHerding(
  bins: HerdingBin[],
  series: Record<string, { datetime: string; value: number | null }[]>,
  maxGapMin = 60,
): { rows: AlignedRow[]; summary: AlignmentSummary } {
  const keys = Object.keys(series);
  const sorted: Record<string, { t: number[]; v: (number | null)[] }> = {};
  let sStart = Infinity, sEnd = -Infinity;
  for (const k of keys) {
    const pts = series[k].map((p) => ({ t: toMs(p.datetime), v: p.value })).filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
    sorted[k] = { t: pts.map((p) => p.t), v: pts.map((p) => p.v) };
    if (pts.length) { sStart = Math.min(sStart, pts[0].t); sEnd = Math.max(sEnd, pts[pts.length - 1].t); }
  }
  const lookup = (k: string, t: number): { v: number | null; gap: number | null } => {
    const { t: ts, v } = sorted[k];
    let lo = 0, hi = ts.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (ts[mid] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    if (best < 0) return { v: null, gap: null };
    const gap = (t - ts[best]) / 60000;
    return gap <= maxGapMin ? { v: v[best], gap } : { v: null, gap: null };
  };
  let exact = 0, asof = 0, none = 0, nonMono = 0;
  const rows = bins.map((b, i) => {
    const t = toMs(b.datetime_utc);
    if (i > 0 && t < toMs(bins[i - 1].datetime_utc)) nonMono++;
    const values: Record<string, number | null> = {};
    let maxGap: number | null = null;
    for (const k of keys) {
      const r = lookup(k, t);
      values[k] = r.v;
      if (r.gap !== null) maxGap = Math.max(maxGap ?? 0, r.gap);
    }
    const anyVal = keys.some((k) => values[k] !== null);
    const match: MatchType = !anyVal ? "none" : maxGap === 0 ? "exact" : "asof";
    if (match === "exact") exact++; else if (match === "asof") asof++; else none++;
    return { bin: b, values, match, gapMin: anyVal ? maxGap : null };
  });
  const iso = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "");
  return {
    rows,
    summary: {
      nBins: bins.length, exact, asof, none,
      uniqueUtcTimes: new Set(bins.map((b) => b.datetime_utc)).size,
      nonMonotonic: nonMono,
      firstBin: bins.reduce((m, b) => (b.datetime_utc < m ? b.datetime_utc : m), bins[0]?.datetime_utc ?? ""),
      lastBin: bins.reduce((m, b) => (b.datetime_utc > m ? b.datetime_utc : m), bins[0]?.datetime_utc ?? ""),
      seriesStart: iso(sStart), seriesEnd: iso(sEnd),
    },
  };
}
