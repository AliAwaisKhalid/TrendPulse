/**
 * Diagnostics for Google Trends series.
 *
 * Why this exists: Google Trends serves ~hourly data for windows of up to about
 * 7 days, so a 30-minute (or finer) series built from it contains no new
 * information. Values are repeated or interpolated between hourly points,
 * which inflates short-lag autocorrelation and shrinks the effective sample,
 * and so overstates the significance of Granger-type tests. Stitching windows
 * that were each scaled to 0-100 on their own is also not validated unless it
 * is compared with an independent benchmark (here: the daily series for the
 * same keyword, term and region).
 */

export interface RowLike {
  datetime: string;
  date: string;
  time: string;
  hits: number;
}

const tsOf = (r: RowLike) => new Date(`${r.date}T${r.time}:00Z`).getTime();

export function mean(x: number[]): number {
  return x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN;
}

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

function ranks(x: number[]): number[] {
  const idx = x.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(x.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));

/** Lag-1 autocorrelation. */
export function acf1(x: number[]): number | null {
  if (x.length < 4) return null;
  return pearson(x.slice(1), x.slice(0, -1));
}

/** Share of consecutive observations that are exactly equal. */
export function identicalShare(x: number[]): number {
  if (x.length < 2) return 0;
  let k = 0;
  for (let i = 1; i < x.length; i++) if (x[i] === x[i - 1]) k++;
  return k / (x.length - 1);
}

/** AR(1) approximation of the effective number of independent observations. */
export function effectiveN(n: number, rho: number | null): number {
  if (rho === null || rho >= 0.9999) return n > 0 ? 1 : 0;
  if (rho <= 0) return n;
  return Math.max(1, (n * (1 - rho)) / (1 + rho));
}

/** Median spacing between consecutive timestamps, in minutes. */
export function nativeStepMinutes(rows: RowLike[]): number {
  if (rows.length < 2) return NaN;
  const d: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const g = (tsOf(rows[i]) - tsOf(rows[i - 1])) / 60000;
    if (g > 0) d.push(g);
  }
  d.sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)] : NaN;
}

export interface SeriesDiagnostics {
  keyword: string;
  nativeStepMin: number;
  outputStepMin: number;
  /** Output observations per native observation (1 = no inflation). */
  inflationFactor: number;
  nNative: number;
  nOutput: number;
  identicalNative: number;
  identicalOutput: number;
  acf1Native: number | null;
  acf1Output: number | null;
  /** Effective independent observations implied by the native series, AR(1) approximation. */
  nEffNative: number;
  nEffOutput: number;
  /** True when the output grid is finer than the native step. */
  oversampled: boolean;
}

export function seriesDiagnostics(
  keyword: string, native: RowLike[], output: RowLike[], outputStepMin: number
): SeriesDiagnostics {
  const nHits = native.map((r) => r.hits), oHits = output.map((r) => r.hits);
  const step = nativeStepMinutes(native);
  const a1n = acf1(nHits), a1o = acf1(oHits);
  return {
    keyword,
    nativeStepMin: step,
    outputStepMin,
    inflationFactor: Number.isFinite(step) ? Math.max(1, step / outputStepMin) : 1,
    nNative: native.length,
    nOutput: output.length,
    identicalNative: identicalShare(nHits),
    identicalOutput: identicalShare(oHits),
    acf1Native: a1n,
    acf1Output: a1o,
    nEffNative: effectiveN(native.length, a1n),
    // Output carries no more information than the native series.
    nEffOutput: Math.min(effectiveN(output.length, a1o), effectiveN(native.length, a1n)),
    oversampled: Number.isFinite(step) && outputStepMin < step * 0.9,
  };
}

/* ───────────── Window stitching with seam diagnostics ───────────── */

export interface SeamInfo {
  window: number;          // index of the later window (>= 1)
  overlapN: number;
  scale: number;           // multiplicative factor applied to the later window
  cumulativeScale: number; // factor mapping this window onto window 0's scale (the overlap is already in that frame)
  overlapCorr: number | null;
  flag: string | null;
}

/**
 * Chain-rescale consecutive windows on their overlap, average the overlapping
 * observations, then renormalise the whole series to a 0-100 maximum.
 * Each seam is reported so the stitching can be audited; nothing here proves
 * the result is correct, which is what validateAgainstDaily is for.
 */
export function stitchWindows<T extends RowLike>(windows: T[][]): { rows: T[]; seams: SeamInfo[] } {
  const ws = windows.filter((w) => w.length);
  if (!ws.length) return { rows: [], seams: [] };
  const aligned = new Map<string, { sum: number; n: number; row: T }>();
  const seams: SeamInfo[] = [];
  ws.forEach((w, k) => {
    let scale = 1;
    if (k > 0) {
      const ov = w.filter((r) => aligned.has(r.datetime));
      const prevSum = ov.reduce((s, r) => { const a = aligned.get(r.datetime)!; return s + a.sum / a.n; }, 0);
      const curSum = ov.reduce((s, r) => s + r.hits, 0);
      let flag: string | null = null;
      if (ov.length < 2) { flag = "overlap shorter than 2 observations"; }
      else if (curSum <= 0 || prevSum <= 0) { flag = "zero overlap signal; scale set to 1"; }
      else {
        scale = prevSum / curSum;
        if (Math.min(prevSum, curSum) < 20) flag = "very low overlap signal; scale unreliable";
        else if (scale > 5 || scale < 0.2) flag = "extreme scale factor";
      }
      const corr = pearson(
        ov.map((r) => r.hits),
        ov.map((r) => { const a = aligned.get(r.datetime)!; return a.sum / a.n; })
      );
      seams.push({ window: k, overlapN: ov.length, scale, cumulativeScale: scale, overlapCorr: corr, flag });
    }
    for (const r of w) {
      const v = r.hits * scale;
      const ex = aligned.get(r.datetime);
      if (ex) { ex.sum += v; ex.n++; } else aligned.set(r.datetime, { sum: v, n: 1, row: { ...r } });
    }
  });

  const merged = [...aligned.values()]
    .sort((a, b) => a.row.datetime.localeCompare(b.row.datetime))
    .map(({ sum, n, row }) => ({ ...row, hits: sum / n }));
  const mx = Math.max(...merged.map((r) => r.hits), 1e-9);
  return { rows: merged.map((r) => ({ ...r, hits: Math.round((r.hits / mx) * 1000) / 10 })), seams };
}

/* ───────────── Validation against an independent benchmark ───────────── */

export interface BenchmarkValidation {
  keyword: string;
  nDays: number;
  corrLevels: number | null;
  spearmanLevels: number | null;
  corrDiffs: number | null;
  /** Mean absolute deviation after least-squares scaling to the daily series, in index points. */
  maeScaled: number | null;
  maxSeamScale: number | null;
  verdict: "consistent" | "weak" | "inconclusive";
}

/**
 * Compare the stitched sub-daily series, averaged to days, with the standard
 * daily Google Trends series for the same keyword, region and period.
 * Thresholds are heuristic screening rules, not a statistical test.
 */
export function validateAgainstDaily(
  keyword: string, stitched: RowLike[], daily: RowLike[], seams: SeamInfo[]
): BenchmarkValidation {
  const byDay = new Map<string, number[]>();
  for (const r of stitched) { const a = byDay.get(r.date) ?? []; a.push(r.hits); byDay.set(r.date, a); }
  const x: number[] = [], y: number[] = [];
  for (const d of daily) {
    const a = byDay.get(d.date);
    if (a && a.length >= 12) { x.push(mean(a)); y.push(d.hits); }
  }
  const dx = x.slice(1).map((v, i) => v - x[i]);
  const dy = y.slice(1).map((v, i) => v - y[i]);
  const cl = pearson(x, y), cd = pearson(dx, dy);
  let mae: number | null = null;
  if (x.length >= 3) {
    const sxy = x.reduce((s, v, i) => s + v * y[i], 0), sxx = x.reduce((s, v) => s + v * v, 0);
    const b = sxx > 0 ? sxy / sxx : 1;
    mae = mean(x.map((v, i) => Math.abs(b * v - y[i])));
  }
  const verdict: BenchmarkValidation["verdict"] =
    x.length < 7 || cl === null || cd === null ? "inconclusive"
    : cl >= 0.9 && cd >= 0.5 ? "consistent" : "weak";
  return {
    keyword, nDays: x.length, corrLevels: cl, spearmanLevels: spearman(x, y), corrDiffs: cd, maeScaled: mae,
    maxSeamScale: seams.length ? Math.max(...seams.map((s) => Math.max(s.cumulativeScale, 1 / Math.max(s.cumulativeScale, 1e-9)))) : null,
    verdict,
  };
}

/** Agreement between two independent downloads of the same window (sampling noise). */
export function redownloadAgreement(a: RowLike[], b: RowLike[]): { n: number; corr: number | null; mae: number | null } {
  const mb = new Map(b.map((r) => [r.datetime, r.hits] as const));
  const x: number[] = [], y: number[] = [];
  for (const r of a) { const v = mb.get(r.datetime); if (v !== undefined) { x.push(r.hits); y.push(v); } }
  return { n: x.length, corr: pearson(x, y), mae: x.length ? mean(x.map((v, i) => Math.abs(v - y[i]))) : null };
}

/* ───────────── Noise and sparsity of raw keyword series ───────────── */

export interface SparsityStats {
  keyword: string;
  n: number;
  mean: number;
  sd: number;
  /** Coefficient of variation (sd / mean); high values signal spiky, low-volume series. */
  cv: number | null;
  zeroShare: number;
  /** Share of observations at or below 5 on the 0-100 scale (near the floor). */
  lowShare: number;
  maxZeroRun: number;
  acf1: number | null;
  identicalShare: number;
  flag: string | null;
}

/** Summary statistics for the noise and sparsity of one raw keyword series, before any PCA. */
export function sparsityStats(keyword: string, hits: number[]): SparsityStats {
  const n = hits.length;
  const m = mean(hits);
  const sd = n > 1 ? Math.sqrt(hits.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : NaN;
  let run = 0, maxRun = 0, zeros = 0, low = 0;
  for (const v of hits) {
    if (v === 0) { zeros++; run++; maxRun = Math.max(maxRun, run); } else run = 0;
    if (v <= 5) low++;
  }
  const zeroShare = n ? zeros / n : 0;
  const cv = m > 0 && Number.isFinite(sd) ? sd / m : null;
  let flag: string | null = null;
  if (zeroShare > 0.3) flag = "sparse: more than 30% zero observations";
  else if (cv !== null && cv > 1.5) flag = "spiky: coefficient of variation above 1.5";
  return {
    keyword, n, mean: m, sd, cv, zeroShare, lowShare: n ? low / n : 0, maxZeroRun: maxRun,
    acf1: acf1(hits), identicalShare: identicalShare(hits), flag,
  };
}

/* ───────────── PC1 composition by query category ───────────── */

export interface CategoryShare {
  group: string;
  nKeywords: number;
  /** Sum of squared PC1 loadings in the group (the loadings are unit-norm, so shares sum to 1). */
  share: number;
  /** Share if every keyword loaded equally. */
  equalWeight: number;
  meanAbsLoading: number;
}

/**
 * Which kinds of query dominate a principal component? Groups keywords by
 * category (full label, or the part before " / "), so generic location queries
 * can be compared with commercial/shipping queries.
 */
export function componentShareByCategory(
  labels: string[], loadings: number[], categories: Record<string, string>, topLevel: boolean
): CategoryShare[] {
  const groups = new Map<string, number[]>();
  labels.forEach((kw, j) => {
    const raw = categories[kw] || "Uncategorised";
    const g = topLevel ? raw.split(" / ")[0] : raw;
    const a = groups.get(g) ?? []; a.push(loadings[j]); groups.set(g, a);
  });
  const norm = loadings.reduce((s, v) => s + v * v, 0) || 1;
  return [...groups.entries()]
    .map(([group, v]) => ({
      group, nKeywords: v.length,
      share: v.reduce((s, x) => s + x * x, 0) / norm,
      equalWeight: v.length / labels.length,
      meanAbsLoading: mean(v.map(Math.abs)),
    }))
    .sort((a, b) => b.share - a.share);
}

/* ───────────── Cross-resolution comparison (30-min, hourly, daily) ───────────── */

export type CI = [number, number];

/** Fisher-z confidence interval for a Pearson correlation. Returns null when n <= 3. */
export function fisherCI(r: number | null, n: number, z = 1.96): CI | null {
  if (r === null || !Number.isFinite(r) || n <= 3) return null;
  const rc = Math.max(-0.999999, Math.min(0.999999, r));
  const zr = Math.atanh(rc), se = 1 / Math.sqrt(n - 3);
  return [Math.tanh(zr - z * se), Math.tanh(zr + z * se)];
}

export interface PairStat {
  pair: string;
  grid: string;
  n: number;
  /** Effective sample size after AR(1) adjustment of the (more persistent) series. */
  nEff: number;
  r: number | null;
  ci: CI | null;      // treats observations as independent (too narrow for autocorrelated series)
  ciAdj: CI | null;   // uses the effective sample size
  rDiff: number | null;
  ciDiff: CI | null;
  ciDiffAdj: CI | null;
}

export interface DailyCompareRow {
  date: string;
  daily: number | null;
  hourly: number | null; hourlyLo: number | null; hourlyHi: number | null;
  m30: number | null; m30Lo: number | null; m30Hi: number | null;
}

export interface RollingRow {
  date: string;
  rHourly: number | null; lo: number | null; hi: number | null;
  rM30: number | null;
}

interface Bucket { mean: number; sd: number; n: number }

function bucketize(rows: RowLike[], key: (r: RowLike) => string): Map<string, Bucket> {
  const g = new Map<string, number[]>();
  for (const r of rows) { const k = key(r); const a = g.get(k) ?? []; a.push(r.hits); g.set(k, a); }
  const out = new Map<string, Bucket>();
  for (const [k, a] of g) {
    const m = mean(a);
    const sd = a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) : 0;
    out.set(k, { mean: m, sd, n: a.length });
  }
  return out;
}

const hourKey = (r: RowLike) => r.datetime.slice(0, 13);
const dayKey = (r: RowLike) => r.date;

function pairStat(pair: string, grid: string, keys: string[], xs: number[], ys: number[]): PairStat {
  const n = xs.length;
  const r = pearson(xs, ys);
  const rho = Math.max(acf1(xs) ?? 0, acf1(ys) ?? 0);
  const nEff = effectiveN(n, rho);
  const dx = xs.slice(1).map((v, i) => v - xs[i]), dy = ys.slice(1).map((v, i) => v - ys[i]);
  const rd = pearson(dx, dy);
  const rhoD = Math.max(acf1(dx) ?? 0, acf1(dy) ?? 0);
  const nEffD = effectiveN(dx.length, rhoD);
  void keys;
  return {
    pair, grid, n, nEff, r, ci: fisherCI(r, n), ciAdj: fisherCI(r, nEff),
    rDiff: rd, ciDiff: fisherCI(rd, dx.length), ciDiffAdj: fisherCI(rd, nEffD),
  };
}

/**
 * Compare the same keyword at three resolutions: the 30-minute series (derived from the hourly
 * data by interpolation), the native hourly series, and the standard daily series.
 * Correlation confidence intervals are given with and without an autocorrelation adjustment.
 * Daily means of the sub-daily series are rescaled to the daily series by least squares through
 * the origin for plotting only; correlations do not depend on that scaling.
 */
export function compareResolutions(
  hourly: RowLike[], m30: RowLike[], daily: RowLike[], rollWindow = 14
): { pairs: PairStat[]; days: DailyCompareRow[]; rolling: RollingRow[] } {
  const hH = bucketize(hourly, hourKey), mH = bucketize(m30, hourKey);
  const hD = bucketize(hourly, dayKey), mD = bucketize(m30, dayKey);
  const dD = new Map(daily.map((r) => [r.date, r.hits] as const));

  const pairs: PairStat[] = [];
  const hourKeys = [...hH.keys()].filter((k) => mH.has(k)).sort();
  if (hourKeys.length >= 5) {
    pairs.push(pairStat("30-min vs hourly", "hours", hourKeys, hourKeys.map((k) => mH.get(k)!.mean), hourKeys.map((k) => hH.get(k)!.mean)));
  }
  const dayKeysH = [...hD.keys()].filter((k) => dD.has(k) && hD.get(k)!.n >= 12).sort();
  if (dayKeysH.length >= 5) {
    pairs.push(pairStat("Hourly vs daily", "days", dayKeysH, dayKeysH.map((k) => hD.get(k)!.mean), dayKeysH.map((k) => dD.get(k)!)));
  }
  const dayKeysM = [...mD.keys()].filter((k) => dD.has(k) && mD.get(k)!.n >= 24).sort();
  if (dayKeysM.length >= 5) {
    pairs.push(pairStat("30-min vs daily", "days", dayKeysM, dayKeysM.map((k) => mD.get(k)!.mean), dayKeysM.map((k) => dD.get(k)!)));
  }

  const scaleTo = (keys: string[], src: Map<string, Bucket>) => {
    const sxy = keys.reduce((s, k) => s + src.get(k)!.mean * dD.get(k)!, 0);
    const sxx = keys.reduce((s, k) => s + src.get(k)!.mean ** 2, 0);
    return sxx > 0 ? sxy / sxx : 1;
  };
  const bH = dayKeysH.length ? scaleTo(dayKeysH, hD) : 1;
  const bM = dayKeysM.length ? scaleTo(dayKeysM, mD) : 1;
  const allDays = [...new Set([...hD.keys(), ...dD.keys()])].sort();
  const days: DailyCompareRow[] = allDays.map((d) => {
    const h = hD.get(d), m = mD.get(d);
    const band = (b: Bucket | undefined, s: number) =>
      b ? { v: b.mean * s, lo: (b.mean - 1.96 * b.sd / Math.sqrt(b.n)) * s, hi: (b.mean + 1.96 * b.sd / Math.sqrt(b.n)) * s } : null;
    const hb = band(h, bH), mb = band(m, bM);
    return {
      date: d, daily: dD.get(d) ?? null,
      hourly: hb?.v ?? null, hourlyLo: hb?.lo ?? null, hourlyHi: hb?.hi ?? null,
      m30: mb?.v ?? null, m30Lo: mb?.lo ?? null, m30Hi: mb?.hi ?? null,
    };
  });

  const rolling: RollingRow[] = [];
  for (let i = rollWindow - 1; i < dayKeysH.length; i++) {
    const ks = dayKeysH.slice(i - rollWindow + 1, i + 1);
    const r = pearson(ks.map((k) => hD.get(k)!.mean), ks.map((k) => dD.get(k)!));
    const ci = fisherCI(r, ks.length);
    const km = ks.filter((k) => mD.has(k));
    const rm = km.length >= rollWindow - 2 ? pearson(km.map((k) => mD.get(k)!.mean), km.map((k) => dD.get(k)!)) : null;
    rolling.push({ date: dayKeysH[i], rHourly: r, lo: ci?.[0] ?? null, hi: ci?.[1] ?? null, rM30: rm });
  }
  return { pairs, days, rolling };
}
