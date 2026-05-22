"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Brush,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
} from "docx";

/* ─────────── Types ─────────── */
interface TrendRow {
  datetime: string;
  date: string;
  time: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dow: number;
  dowName: string;
  quarter: number;
  weekend: boolean;
  hits: number;
}

type Frequency =
  | "1min"
  | "5min"
  | "15min"
  | "30min"
  | "1hour"
  | "4hour"
  | "daily"
  | "weekly";

type SortField = keyof TrendRow;
type SortDir = "asc" | "desc";

const COUNTRIES: Record<string, string> = {
  "": "Worldwide",
  US: "United States",
  GB: "United Kingdom",
  PK: "Pakistan",
  IN: "India",
  DE: "Germany",
  FR: "France",
  CA: "Canada",
  AU: "Australia",
  JP: "Japan",
  BR: "Brazil",
  CN: "China",
  KR: "South Korea",
  IT: "Italy",
  ES: "Spain",
  MX: "Mexico",
  RU: "Russia",
  SA: "Saudi Arabia",
  AE: "UAE",
  TR: "Turkey",
  NG: "Nigeria",
  ZA: "South Africa",
};

const FREQ_OPTIONS: { value: Frequency; label: string }[] = [
  { value: "1min", label: "1 min" },
  { value: "5min", label: "5 min" },
  { value: "15min", label: "15 min" },
  { value: "30min", label: "30 min" },
  { value: "1hour", label: "1 hour" },
  { value: "4hour", label: "4 hour" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ─────────── Helpers ─────────── */
function freqMinutes(f: Frequency): number {
  const map: Record<Frequency, number> = {
    "1min": 1,
    "5min": 5,
    "15min": 15,
    "30min": 30,
    "1hour": 60,
    "4hour": 240,
    daily: 1440,
    weekly: 10080,
  };
  return map[f];
}

function generateSimulatedData(
  keyword: string,
  start: Date,
  end: Date,
  freq: Frequency,
  _geo: string
): TrendRow[] {
  const rows: TrendRow[] = [];
  const stepMs = freqMinutes(freq) * 60000;
  const spanMs = Math.max(stepMs, end.getTime() - start.getTime());
  const totalSteps = Math.floor(spanMs / stepMs);

  // Simulate realistic-looking trend data with patterns
  const seed = keyword.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 30 + (seed % 40);
  const trendSlope = ((seed % 20) - 10) / totalSteps;

  for (let i = 0; i < totalSteps; i++) {
    const dt = new Date(start.getTime() + i * stepMs);
    const hour = dt.getHours();
    const dow = dt.getDay();

    // Daily cycle: higher during 9am-11pm
    const dailyCycle =
      hour >= 9 && hour <= 23
        ? 15 * Math.sin(((hour - 9) / 14) * Math.PI)
        : -10;

    // Weekly cycle: dip on weekends
    const weekCycle = dow === 0 || dow === 6 ? -8 : 3;

    // Trend + noise
    const trend = trendSlope * i;
    const noise = (Math.sin(seed * i * 0.01) * 7 + Math.cos(i * 0.003) * 12);
    const spikes = Math.random() < 0.005 ? 20 + Math.random() * 30 : 0;

    let hits = Math.round(base + dailyCycle + weekCycle + trend + noise + spikes);
    hits = Math.max(0, Math.min(100, hits));

    const dateStr = dt.toISOString().slice(0, 10);
    const timeStr = `${String(dt.getHours()).padStart(2, "0")}:${String(
      dt.getMinutes()
    ).padStart(2, "0")}`;

    rows.push({
      datetime: `${dateStr} ${timeStr}`,
      date: dateStr,
      time: timeStr,
      year: dt.getFullYear(),
      month: dt.getMonth() + 1,
      day: dt.getDate(),
      hour: dt.getHours(),
      minute: dt.getMinutes(),
      dow,
      dowName: DOW_NAMES[dow],
      quarter: Math.floor(dt.getMonth() / 3) + 1,
      weekend: dow === 0 || dow === 6,
      hits,
    });
  }
  return rows;
}

type DateMode = "relative" | "range";

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* Resolve the active time window from either the relative period or an
   explicit start/end range. End is pushed to end-of-day so the chosen
   end date is fully included; start/end are swapped if reversed. */
function effectiveRange(
  mode: DateMode,
  days: number,
  startDate: string,
  endDate: string
): { start: Date; end: Date } {
  if (mode === "range" && startDate && endDate) {
    let start = new Date(`${startDate}T00:00:00`);
    let end = new Date(`${endDate}T23:59:59`);
    if (start.getTime() > end.getTime()) [start, end] = [end, start];
    return { start, end };
  }
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  return { start, end };
}

function rangeDays(start: Date, end: Date): number {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function formatAxisDate(val: string) {
  if (!val) return "";
  const parts = val.split(" ");
  if (parts.length < 2) return val;
  return `${parts[0].slice(5)} ${parts[1]}`;
}

/* ─────────── R Script Generator ─────────── */
function generateRScript(
  keyword: string,
  startDate: string,
  endDate: string,
  freq: Frequency,
  geo: string
): string {
  const fMin = freqMinutes(freq);
  const fileBase = keyword.replace(/\s+/g, "_");
  return `# ══════════════════════════════════════════════════
# Trend Pulse — gtrendsR Script (intraday + daily)
# Keyword: "${keyword}" | Range: ${startDate} → ${endDate}
# Intraday freq: ${freq} (${fMin} min) | Geo: ${geo || "worldwide"}
# Outputs TWO files: ${fileBase}_${freq}.csv and ${fileBase}_daily.csv
# ══════════════════════════════════════════════════

library(gtrendsR)
library(dplyr)
library(lubridate)

keyword    <- "${keyword}"
geo        <- ${geo ? `"${geo}"` : "NULL"}
freq_min   <- ${fMin}
start_date <- as.Date("${startDate}")
end_date   <- as.Date("${endDate}")

# Adds the same time-component columns used by the Trend Pulse app.
add_components <- function(df) {
  df %>% mutate(
    date     = as.Date(datetime),
    time     = format(datetime, "%H:%M"),
    year     = year(datetime),
    month    = month(datetime),
    day      = day(datetime),
    hour     = hour(datetime),
    minute   = minute(datetime),
    dow      = wday(datetime, week_start = 7) - 1,
    dow_name = weekdays(datetime, abbreviate = TRUE),
    quarter  = quarter(datetime),
    weekend  = dow %in% c(0, 6)
  )
}

# ══════════════════════════════════════════════════
# PART 1 — Intraday (${freq}) via 24h windows
# Google Trends only returns sub-daily resolution for short
# windows, so we loop day-by-day with overlap then stitch.
# ══════════════════════════════════════════════════
windows <- list()
d <- start_date
while (d < end_date) {
  w_start <- d
  w_end   <- min(d + 1, end_date)
  windows[[length(windows) + 1]] <- c(w_start, w_end)
  d <- d + hours(20)  # 4h overlap
}
cat(sprintf("Intraday windows: %d\\n", length(windows)))

intraday <- data.frame()
for (i in seq_along(windows)) {
  w <- windows[[i]]
  time_str <- sprintf("%sT00 %sT00",
    format(w[1], "%Y-%m-%d"), format(w[2], "%Y-%m-%d"))
  cat(sprintf("[%d/%d] %s\\n", i, length(windows), time_str))
  tryCatch({
    res <- gtrends(keyword, geo = geo, time = time_str)
    iot <- res$interest_over_time
    if (!is.null(iot) && nrow(iot) > 0) {
      iot$date <- ymd_hms(iot$date)
      iot$hits <- as.numeric(gsub("[^0-9]", "", iot$hits))
      intraday <- bind_rows(intraday, iot)
    }
  }, error = function(e) {
    cat(sprintf("  ERROR: %s\\n", e$message))
  })
  Sys.sleep(runif(1, 1.5, 3.5))  # Rate limiting
}

# Normalize overlaps, then global-scale to 0-100
intraday <- intraday %>%
  group_by(date) %>%
  summarise(hits = mean(hits, na.rm = TRUE)) %>%
  ungroup() %>%
  arrange(date)
max_hits <- max(intraday$hits, na.rm = TRUE)
if (is.finite(max_hits) && max_hits > 0)
  intraday$hits <- round(intraday$hits / max_hits * 100)

# Aggregate to the chosen intraday frequency
intraday <- intraday %>%
  mutate(bucket = floor_date(date, unit = paste0(freq_min, " mins"))) %>%
  group_by(bucket) %>%
  summarise(hits = round(mean(hits, na.rm = TRUE))) %>%
  rename(datetime = bucket) %>%
  ungroup() %>%
  add_components()

write.csv(intraday, "${fileBase}_${freq}.csv", row.names = FALSE)
cat(sprintf("Intraday file: %d rows -> ${fileBase}_${freq}.csv\\n", nrow(intraday)))

# ══════════════════════════════════════════════════
# PART 2 — Daily series (single call over full range)
# Google returns its own daily index for multi-week ranges,
# which is more accurate than averaging the intraday series.
# ══════════════════════════════════════════════════
daily_time <- sprintf("%s %s",
  format(start_date, "%Y-%m-%d"), format(end_date, "%Y-%m-%d"))
cat(sprintf("Daily range: %s\\n", daily_time))

daily <- data.frame()
tryCatch({
  res <- gtrends(keyword, geo = geo, time = daily_time)
  iot <- res$interest_over_time
  if (!is.null(iot) && nrow(iot) > 0) {
    daily <- data.frame(
      datetime = as.POSIXct(as.Date(iot$date)),
      hits = as.numeric(gsub("[^0-9]", "", iot$hits))
    )
  }
}, error = function(e) {
  cat(sprintf("  ERROR: %s\\n", e$message))
})

# Fallback: if the daily call returned nothing, roll up the intraday series
if (nrow(daily) == 0 && nrow(intraday) > 0) {
  daily <- intraday %>%
    group_by(datetime = as.POSIXct(as.Date(datetime))) %>%
    summarise(hits = round(mean(hits, na.rm = TRUE))) %>%
    ungroup()
}

daily <- daily %>% arrange(datetime) %>% add_components()
write.csv(daily, "${fileBase}_daily.csv", row.names = FALSE)
cat(sprintf("Daily file: %d rows -> ${fileBase}_daily.csv\\n", nrow(daily)))

cat("\\nDone! Wrote intraday (${freq}) and daily CSVs.\\n")
`;
}

/* ─────────── Stata .do Generator ─────────── */
function generateStataDoFile(
  keyword: string,
  freq: Frequency
): string {
  const fname = `${keyword.replace(/\s+/g, "_")}_trends`;
  const deltaMs = freqMinutes(freq) * 60000;
  return `* ══════════════════════════════════════════════════
* Trend Pulse — Stata Import & Time-Series Setup
* Keyword: "${keyword}" | Freq: ${freq}
* ══════════════════════════════════════════════════

clear all
set more off

* ── Import CSV ──
import delimited "${fname}.csv", clear

* ── Create Stata datetime ──
gen double stata_dt = clock(datetime, "YMDhms#")
format stata_dt %tcCCYY-NN-DD_HH:MM:SS

* ── Time components ──
gen int s_year    = year(dofC(stata_dt))
gen byte s_month  = month(dofC(stata_dt))
gen byte s_day    = day(dofC(stata_dt))
gen byte s_hour   = hh(stata_dt)
gen byte s_minute = mm(stata_dt)
gen byte s_dow    = dow(dofC(stata_dt))

* ── Clock time for intraday plots ──
gen double clock_time = (s_hour * 3600 + s_minute * 60) * 1000
format clock_time %tcHH:MM

* ── Weekend flag ──
gen byte is_weekend = (s_dow == 0 | s_dow == 6)
label define wknd 0 "Weekday" 1 "Weekend"
label values is_weekend wknd

* ── Set time series ──
tsset stata_dt, delta(${deltaMs})

* ── Moving averages ──
gen double ma6  = (L3.hits + L2.hits + L1.hits + hits + F1.hits + F2.hits) / 6
gen double ma12 = (L6.hits + L5.hits + L4.hits + L3.hits + L2.hits + L1.hits ///
                 + hits + F1.hits + F2.hits + F3.hits + F4.hits + F5.hits) / 12
label var ma6  "6-period MA"
label var ma12 "12-period MA"

* ── Basic plots ──
tsline hits, title("${keyword} — Google Trends") ///
  ytitle("Interest (0-100)") xtitle("") ///
  lcolor(emerald) lwidth(thin)

twoway (tsline hits, lcolor(gs12) lwidth(vthin)) ///
       (tsline ma6, lcolor(emerald) lwidth(medthick)) ///
       (tsline ma12, lcolor(orange) lwidth(medthick)), ///
  title("${keyword} — with Moving Averages") ///
  legend(order(1 "Raw" 2 "MA-6" 3 "MA-12"))

* ── Hourly pattern ──
collapse (mean) avg_hits=hits, by(s_hour)
twoway bar avg_hits s_hour, ///
  barwidth(0.8) fcolor(emerald) lcolor(none) ///
  title("Average Interest by Hour") ///
  xtitle("Hour of Day") ytitle("Avg Interest")
`;
}

/* ─────────── Descriptive Statistics ─────────── */
interface FullStats {
  n: number;
  mean: number;
  median: number;
  variance: number;
  stdDev: number;
  skewness: number;
  kurtosis: number; // excess kurtosis
  min: number;
  max: number;
}

function computeStats(hits: number[]): FullStats | null {
  const n = hits.length;
  if (n === 0) return null;
  const mean = hits.reduce((a, b) => a + b, 0) / n;
  const sorted = [...hits].sort((a, b) => a - b);
  const median =
    n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
  const variance = hits.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const skewness =
    stdDev === 0
      ? 0
      : hits.reduce((a, b) => a + ((b - mean) / stdDev) ** 3, 0) / n;
  const kurtosis =
    stdDev === 0
      ? 0
      : hits.reduce((a, b) => a + ((b - mean) / stdDev) ** 4, 0) / n - 3;
  return { n, mean, median, variance, stdDev, skewness, kurtosis, min: sorted[0], max: sorted[n - 1] };
}

/* ─────────── DOCX Report Generator ─────────── */
function docCell(text: string, bold = false, bg?: string): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text, bold, size: bold ? 22 : 20, color: bold ? "1a1a2e" : "2d2d4a" }),
        ],
      }),
    ],
    shading: bg ? { fill: bg, type: "clear", color: "auto" } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  });
}

function statsTable(s: FullStats): Table {
  const rows = [
    ["Metric", "Value", "Metric", "Value"],
    ["N (observations)", s.n.toLocaleString(), "Std Dev", s.stdDev.toFixed(3)],
    ["Mean", s.mean.toFixed(3), "Skewness", s.skewness.toFixed(4)],
    ["Median", s.median.toFixed(3), "Kurtosis (excess)", s.kurtosis.toFixed(4)],
    ["Variance", s.variance.toFixed(3), "Min / Max", `${s.min} / ${s.max}`],
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r, i) =>
      new TableRow({
        children: r.map((cell, ci) =>
          docCell(cell, i === 0, i === 0 ? "c8f0e0" : ci % 2 === 0 ? "f5f5f8" : "ffffff")
        ),
      })
    ),
  });
}

async function generateDocxReport(params: {
  keyword: string;
  startDate: string;
  endDate: string;
  freq: Frequency;
  geo: string;
  data: TrendRow[];
  cutoffDate: string;
  fullStats: FullStats;
  beforeStats: FullStats | null;
  afterStats: FullStats | null;
}): Promise<Blob> {
  const { keyword, startDate, endDate, freq, geo, data, cutoffDate, fullStats, beforeStats, afterStats } = params;
  const country = COUNTRIES[geo] || "Worldwide";
  const now = new Date().toLocaleString();

  const h = (text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel]) =>
    new Paragraph({ text, heading: level, spacing: { before: 300, after: 120 } });

  const p = (text: string, spacing = 120) =>
    new Paragraph({
      children: [new TextRun({ text, size: 20, color: "2d2d4a" })],
      spacing: { after: spacing },
    });

  const divider = () =>
    new Paragraph({
      text: "─".repeat(60),
      spacing: { before: 100, after: 100 },
      children: [new TextRun({ text: "─".repeat(60), color: "ccccdd", size: 16 })],
    });

  const children = [
    /* ── Title ── */
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: "TREND PULSE", bold: true, size: 48, color: "007a50" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: "Google Trends Analysis Report", size: 28, color: "5555aa" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: `Generated: ${now}`, size: 18, color: "888899" })],
    }),

    /* ── Overview ── */
    h("1. Analysis Overview", HeadingLevel.HEADING_1),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        ["Keyword Added", keyword],
        ["Date Range", `${startDate} → ${endDate}`],
        ["Frequency", `${freq} (${freqMinutes(freq as Frequency)} minutes)`],
        ["Region", country],
        ["Total Data Points", fullStats.n.toLocaleString()],
        ["Cutoff Date", cutoffDate || "Not set"],
      ].map(([label, val]) =>
        new TableRow({
          children: [
            docCell(label, true, "e8f5ee"),
            docCell(val, false, "ffffff"),
          ],
        })
      ),
    }),

    divider(),

    /* ── Data Collection Process ── */
    h("2. Data Collection Process", HeadingLevel.HEADING_1),
    p(
      "Google Trends provides a normalized search interest index (0–100) where 100 represents " +
      "the peak popularity for the keyword in the given time period. The API restricts high-resolution " +
      "(sub-hourly) data to short windows of ≤ 7 days."
    ),
    p(
      `To overcome this limitation, Trend Pulse uses an overlapping 24-hour window strategy: ` +
      `the date range (${startDate} → ${endDate}) is divided into consecutive 24-hour windows, ` +
      `each overlapping the previous by 4 hours. Within each window, Google returns approximately ` +
      `one observation per minute, yielding the maximum available resolution.`
    ),
    p(
      "Each window's index is scaled 0–100 independently by Google. After collection, overlapping " +
      "observations at the same timestamp are averaged to smooth seam artefacts. The full series is " +
      `then globally re-normalized to 0–100, and aggregated to the target frequency (${freq}) ` +
      "by averaging within each bucket. This produces a continuous, uniformly-spaced time series " +
      "suitable for econometric and statistical analysis."
    ),
    p(
      "A second, separate API call retrieves the official daily series over the full date range. " +
      "Google returns this directly as daily aggregates when the window exceeds approximately 7 days, " +
      "providing an independent cross-check on the intraday series."
    ),

    divider(),

    /* ── Timeline ── */
    h("3. Timeline", HeadingLevel.HEADING_1),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        ["Start Date", startDate],
        ["End Date", endDate],
        ["Duration", `${Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)} days`],
        ["Data Resolution", `${freq} intervals (${freqMinutes(freq as Frequency)} min)`],
        ["First Observation", data[0]?.datetime ?? "—"],
        ["Last Observation", data[data.length - 1]?.datetime ?? "—"],
        ["Collection Method", "Overlapping 24h windows (4h overlap) + direct daily call"],
      ].map(([label, val]) =>
        new TableRow({
          children: [docCell(label, true, "e8f5ee"), docCell(val, false, "ffffff")],
        })
      ),
    }),

    divider(),

    /* ── Descriptive Statistics ── */
    h("4. Descriptive Statistics — Full Series", HeadingLevel.HEADING_1),
    p(
      "Statistics computed on the Google Trends interest index (0–100 scale). " +
      "Skewness measures asymmetry of the distribution; values near 0 are symmetric. " +
      "Excess kurtosis measures tail heaviness relative to a normal distribution (0 = normal, " +
      "> 0 = heavy-tailed leptokurtic, < 0 = light-tailed platykurtic)."
    ),
    statsTable(fullStats),
  ];

  /* ── Cutoff Analysis ── */
  if (cutoffDate && beforeStats && afterStats) {
    children.push(
      divider(),
      h("5. Cutoff Date Analysis", HeadingLevel.HEADING_1),
      p(
        `The series is split at cutoff date ${cutoffDate} to examine structural changes in search interest. ` +
        `The "Before" period covers ${beforeStats.n.toLocaleString()} observations ` +
        `and the "After" period covers ${afterStats.n.toLocaleString()} observations.`
      ),
      h("Before Cutoff", HeadingLevel.HEADING_2),
      statsTable(beforeStats),
      new Paragraph({ text: "", spacing: { after: 200 } }),
      h("After Cutoff", HeadingLevel.HEADING_2),
      statsTable(afterStats),
      new Paragraph({ text: "", spacing: { after: 200 } }),
      h("Change Summary", HeadingLevel.HEADING_2),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          ["Metric", "Before", "After", "Δ Change"],
          ["Mean", beforeStats.mean.toFixed(2), afterStats.mean.toFixed(2), (afterStats.mean - beforeStats.mean).toFixed(2)],
          ["Median", beforeStats.median.toFixed(2), afterStats.median.toFixed(2), (afterStats.median - beforeStats.median).toFixed(2)],
          ["Variance", beforeStats.variance.toFixed(2), afterStats.variance.toFixed(2), (afterStats.variance - beforeStats.variance).toFixed(2)],
          ["Std Dev", beforeStats.stdDev.toFixed(3), afterStats.stdDev.toFixed(3), (afterStats.stdDev - beforeStats.stdDev).toFixed(3)],
          ["Skewness", beforeStats.skewness.toFixed(4), afterStats.skewness.toFixed(4), (afterStats.skewness - beforeStats.skewness).toFixed(4)],
          ["Kurtosis", beforeStats.kurtosis.toFixed(4), afterStats.kurtosis.toFixed(4), (afterStats.kurtosis - beforeStats.kurtosis).toFixed(4)],
        ].map((r, i) =>
          new TableRow({
            children: r.map((cell, ci) =>
              docCell(cell, i === 0, i === 0 ? "c8f0e0" : ci % 2 === 0 ? "f5f5f8" : "ffffff")
            ),
          })
        ),
      })
    );
  }

  /* ── Variance Extraction Notes ── */
  const varSection = cutoffDate ? "6" : "5";
  children.push(
    divider(),
    h(`${varSection}. Notes on Variance Extraction`, HeadingLevel.HEADING_1),
    p(
      "Variance in this context measures the temporal dispersion of search interest around its mean. " +
      "A high variance indicates large swings in public interest — typical of trending news events, " +
      "viral content, or seasonal products. A low variance indicates stable, consistent search behaviour."
    ),
    p(
      "The windowed collection approach preserves intraday variance that is lost in Google's standard " +
      "daily view. Each 24-hour window captures the full intraday cycle (0–100 within the window), " +
      "and the global re-normalization stitches windows into a single comparable series. " +
      "The resulting variance therefore reflects both intraday rhythms (hourly, daily patterns) and " +
      "longer-term trends (weekly cycles, event spikes)."
    ),
    p(
      `Full-series variance: ${fullStats.variance.toFixed(3)} (std dev: ${fullStats.stdDev.toFixed(3)}). ` +
      (cutoffDate && beforeStats && afterStats
        ? `Variance before cutoff: ${beforeStats.variance.toFixed(3)}; ` +
          `after cutoff: ${afterStats.variance.toFixed(3)}. ` +
          (afterStats.variance > beforeStats.variance
            ? "Variance increased after the cutoff date, suggesting greater fluctuation in the later period."
            : "Variance decreased after the cutoff date, suggesting more stable search interest in the later period.")
        : "")
    )
  );

  const doc = new Document({
    creator: "Trend Pulse",
    title: `${keyword} — Google Trends Analysis Report`,
    description: `Analysis report for keyword "${keyword}" from ${startDate} to ${endDate}`,
    sections: [{ children }],
  });
  return await Packer.toBlob(doc);
}

/* ─────────── Components ─────────── */

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "accent" | "muted" }) {
  const cls =
    variant === "accent"
      ? "bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30"
      : variant === "muted"
      ? "bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border)]"
      : "bg-[var(--accent-secondary)]/15 text-[var(--accent-secondary)] border-[var(--accent-secondary)]/30";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase rounded-full border ${cls}`}
    >
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  delay,
}: {
  label: string;
  value: string | number;
  sub?: string;
  delay: number;
}) {
  return (
    <div
      className="animate-fade-in-up rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 hover:border-[var(--border-accent)] transition-colors"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-2 font-semibold">
        {label}
      </div>
      <div className="text-2xl font-bold text-[var(--text-primary)]" style={{ fontFamily: "'Space Mono', monospace" }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs text-[var(--text-secondary)] mt-1">{sub}</div>
      )}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border-accent)] bg-[var(--bg-card)]/95 backdrop-blur-sm px-4 py-3 shadow-xl">
      <div className="text-[11px] text-[var(--text-muted)] mb-1 font-mono">
        {label}
      </div>
      <div className="text-lg font-bold text-[var(--accent)]">
        {payload[0].value}
        <span className="text-xs text-[var(--text-secondary)] ml-1 font-normal">
          / 100
        </span>
      </div>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ─────────── Main App ─────────── */
export default function TrendPulse() {
  const [keyword, setKeyword] = useState("");
  const [days, setDays] = useState(90);
  const [dateMode, setDateMode] = useState<DateMode>("relative");
  const [startDate, setStartDate] = useState(() =>
    toISODate(new Date(Date.now() - 90 * 86400000))
  );
  const [endDate, setEndDate] = useState(() => toISODate(new Date()));
  const [freq, setFreq] = useState<Frequency>("30min");
  const [geo, setGeo] = useState("");
  const [data, setData] = useState<TrendRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  // Cutoff date state
  const [cutoffDate, setCutoffDate] = useState("");

  // Table state
  const [sortField, setSortField] = useState<SortField>("datetime");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const pageSize = 25;

  // Tab state
  const [activeTab, setActiveTab] = useState<"chart" | "table" | "exports">(
    "chart"
  );

  const handleFetch = useCallback(() => {
    if (!keyword.trim()) return;
    setLoading(true);
    setFetched(false);

    // Simulate API delay for realism
    setTimeout(() => {
      const { start, end } = effectiveRange(dateMode, days, startDate, endDate);
      const result = generateSimulatedData(keyword, start, end, freq, geo);
      setData(result);
      setLoading(false);
      setFetched(true);
      setPage(0);
      setActiveTab("chart");
    }, 1800);
  }, [keyword, days, dateMode, startDate, endDate, freq, geo]);

  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === "number" && typeof bv === "number")
        return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return sorted;
  }, [data, sortField, sortDir]);

  const pagedData = useMemo(
    () => sortedData.slice(page * pageSize, (page + 1) * pageSize),
    [sortedData, page]
  );
  const totalPages = Math.ceil(sortedData.length / pageSize);

  const range = useMemo(
    () => effectiveRange(dateMode, days, startDate, endDate),
    [dateMode, days, startDate, endDate]
  );
  const effDays = rangeDays(range.start, range.end);
  const estPoints = Math.floor((effDays * 1440) / freqMinutes(freq));

  const fullStats = useMemo(
    () => computeStats(data.map((d) => d.hits)),
    [data]
  );

  const cutoffStats = useMemo(() => {
    if (!data.length || !cutoffDate) return null;
    const before = computeStats(
      data.filter((d) => d.date < cutoffDate).map((d) => d.hits)
    );
    const after = computeStats(
      data.filter((d) => d.date >= cutoffDate).map((d) => d.hits)
    );
    return { before, after };
  }, [data, cutoffDate]);

  /* First datetime >= cutoffDate — used by ReferenceLine */
  const cutoffXValue = useMemo(
    () => (cutoffDate ? data.find((d) => d.date >= cutoffDate)?.datetime ?? null : null),
    [data, cutoffDate]
  );

  const stats = useMemo(() => {
    if (!fullStats) return null;
    const maxRow = data.find((d) => d.hits === fullStats.max);
    return {
      avg: fullStats.mean.toFixed(1),
      max: fullStats.max,
      min: fullStats.min,
      maxRow,
      total: fullStats.n,
    };
  }, [data, fullStats]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(0);
  };

  /* ── Export handlers ── */
  const exportCSV = () => {
    const header =
      "datetime,date,time,year,month,day,hour,minute,dow,dow_name,quarter,weekend,hits\n";
    const rows = data
      .map(
        (r) =>
          `${r.datetime},${r.date},${r.time},${r.year},${r.month},${r.day},${r.hour},${r.minute},${r.dow},${r.dowName},${r.quarter},${r.weekend ? 1 : 0},${r.hits}`
      )
      .join("\n");
    const blob = new Blob([header + rows], {
      type: "text/csv;charset=utf-8",
    });
    saveAs(blob, `${keyword.replace(/\s+/g, "_")}_trends.csv`);
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      data.map((r) => ({
        datetime: r.datetime,
        date: r.date,
        time: r.time,
        year: r.year,
        month: r.month,
        day: r.day,
        hour: r.hour,
        minute: r.minute,
        dow: r.dow,
        dow_name: r.dowName,
        quarter: r.quarter,
        weekend: r.weekend ? 1 : 0,
        hits: r.hits,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Trends");
    XLSX.writeFile(wb, `${keyword.replace(/\s+/g, "_")}_trends.xlsx`);
  };

  const exportRScript = () => {
    const { start, end } = effectiveRange(dateMode, days, startDate, endDate);
    const script = generateRScript(
      keyword,
      toISODate(start),
      toISODate(end),
      freq,
      geo
    );
    const blob = new Blob([script], { type: "text/plain;charset=utf-8" });
    saveAs(blob, `${keyword.replace(/\s+/g, "_")}_trends.R`);
  };

  const exportStata = () => {
    // Export both CSV and .do file
    exportCSV();
    const doFile = generateStataDoFile(keyword, freq);
    const blob = new Blob([doFile], { type: "text/plain;charset=utf-8" });
    saveAs(blob, `${keyword.replace(/\s+/g, "_")}_trends.do`);
  };

  const exportDocx = async () => {
    if (!fullStats) return;
    const { start, end } = effectiveRange(dateMode, days, startDate, endDate);
    const blob = await generateDocxReport({
      keyword,
      startDate: toISODate(start),
      endDate: toISODate(end),
      freq,
      geo,
      data,
      cutoffDate,
      fullStats,
      beforeStats: cutoffStats?.before ?? null,
      afterStats: cutoffStats?.after ?? null,
    });
    saveAs(blob, `${keyword.replace(/\s+/g, "_")}_trends_report.docx`);
  };

  const TABLE_COLS: { key: SortField; label: string; mono?: boolean }[] = [
    { key: "datetime", label: "Datetime", mono: true },
    { key: "date", label: "Date", mono: true },
    { key: "time", label: "Time", mono: true },
    { key: "year", label: "Yr" },
    { key: "month", label: "Mo" },
    { key: "day", label: "Day" },
    { key: "hour", label: "Hr" },
    { key: "minute", label: "Min" },
    { key: "dow", label: "DOW" },
    { key: "dowName", label: "Day" },
    { key: "quarter", label: "Q" },
    { key: "weekend", label: "Wknd" },
    { key: "hits", label: "Hits" },
  ];

  return (
    <div className="relative z-10 min-h-screen">
      {/* ─── Header ─── */}
      <header className="border-b border-[var(--border)] bg-[var(--bg-secondary)]/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent)] flex items-center justify-center pulse-glow">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="w-5 h-5"
                stroke="var(--bg-primary)"
                strokeWidth={2.5}
              >
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Trend Pulse</h1>
              <p className="text-[11px] text-[var(--text-muted)] tracking-wide uppercase">
                Sub-hourly Google Trends
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="accent">v2.0</Badge>
            <Badge variant="muted">gtrendsR</Badge>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* ─── Controls ─── */}
        <section
          className="animate-fade-in-up rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6"
          style={{ animationDelay: "100ms" }}
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            {/* Keyword */}
            <div className="md:col-span-5">
              <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-2 font-semibold">
                Keyword
              </label>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFetch()}
                placeholder="e.g. Bitcoin, ChatGPT, Taylor Swift"
                className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors font-medium"
              />
            </div>

            {/* Date mode toggle */}
            <div className="md:col-span-3">
              <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-2 font-semibold">
                Time window
              </label>
              <div className="flex rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-1">
                {(
                  [
                    { key: "relative", label: "Last N days" },
                    { key: "range", label: "Date range" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setDateMode(m.key)}
                    className={`flex-1 px-3 py-2 rounded-md text-xs font-semibold tracking-wide transition-colors ${
                      dateMode === m.key
                        ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Period — relative days */}
            {dateMode === "relative" && (
              <div className="md:col-span-4">
                <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-2 font-semibold">
                  Period (days)
                </label>
                <input
                  type="number"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  min={1}
                  max={365}
                  className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors font-mono"
                />
              </div>
            )}

            {/* Period — explicit date range */}
            {dateMode === "range" && (
              <>
                <div className="md:col-span-2">
                  <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-2 font-semibold">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    max={endDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors font-mono"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-2 font-semibold">
                    End date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors font-mono"
                  />
                </div>
              </>
            )}

            {/* Frequency */}
            <div className="md:col-span-4">
              <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-2 font-semibold">
                Frequency
              </label>
              <select
                value={freq}
                onChange={(e) => setFreq(e.target.value as Frequency)}
                className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors cursor-pointer"
              >
                {FREQ_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Geo */}
            <div className="md:col-span-4">
              <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-2 font-semibold">
                Region
              </label>
              <select
                value={geo}
                onChange={(e) => setGeo(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors cursor-pointer"
              >
                {Object.entries(COUNTRIES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {/* Fetch */}
            <div className="md:col-span-4">
              <button
                onClick={handleFetch}
                disabled={loading || !keyword.trim()}
                className="w-full py-3 px-5 rounded-lg font-semibold text-sm tracking-wide transition-all
                  bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-dim)]
                  disabled:opacity-40 disabled:cursor-not-allowed
                  active:scale-[0.97]"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg
                      className="animate-spin w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                        className="opacity-25"
                      />
                      <path
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        fill="currentColor"
                        className="opacity-75"
                      />
                    </svg>
                    Fetching…
                  </span>
                ) : (
                  "Fetch Trends"
                )}
              </button>
            </div>
          </div>

          {/* Cutoff date row */}
          <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-[260px]">
              <label className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] font-semibold whitespace-nowrap">
                Analysis cutoff
              </label>
              <input
                type="date"
                value={cutoffDate}
                onChange={(e) => setCutoffDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--warning)] transition-colors font-mono text-sm"
                style={{ borderColor: cutoffDate ? "var(--warning)" : undefined }}
              />
              {cutoffDate && (
                <button
                  onClick={() => setCutoffDate("")}
                  className="px-3 py-2 rounded-lg text-xs text-[var(--text-muted)] border border-[var(--border)] hover:text-[var(--danger)] hover:border-[var(--danger)]/40 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            {cutoffDate && (
              <span className="text-xs text-[var(--warning)] font-mono">
                ◀ Before {cutoffDate} | After ▶
              </span>
            )}
          </div>

          {/* Info bar */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              {effDays} days × {freq} intervals
            </span>
            {dateMode === "range" && (
              <span className="font-mono">
                {toISODate(range.start)} → {toISODate(range.end)}
              </span>
            )}
            <span>≈ {estPoints.toLocaleString()} data points</span>
            <span className="ml-auto text-[var(--text-muted)]">
              Simulated data • Exported R script writes {freq} + daily CSVs
            </span>
          </div>
        </section>

        {/* ─── Loading Skeleton ─── */}
        {loading && (
          <div className="space-y-4">
            <div className="h-4 w-48 rounded shimmer-loading" />
            <div className="h-[350px] rounded-2xl shimmer-loading" />
          </div>
        )}

        {/* ─── Results ─── */}
        {fetched && data.length > 0 && !loading && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatCard
                label="Data Points"
                value={stats!.total.toLocaleString()}
                sub={`${freq} resolution`}
                delay={0}
              />
              <StatCard
                label="Avg Interest"
                value={stats!.avg}
                sub="out of 100"
                delay={60}
              />
              <StatCard
                label="Peak"
                value={stats!.max}
                sub={stats!.maxRow?.datetime}
                delay={120}
              />
              <StatCard
                label="Low"
                value={stats!.min}
                sub="minimum observed"
                delay={180}
              />
              <StatCard
                label="Region"
                value={geo || "🌍"}
                sub={COUNTRIES[geo] || "Worldwide"}
                delay={240}
              />
            </div>

            {/* Descriptive Statistics */}
            {fullStats && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
                <div className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-4 font-semibold">
                  Descriptive Statistics — Interest (0–100)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3">
                  {[
                    { label: "Mean", value: fullStats.mean.toFixed(2) },
                    { label: "Median", value: fullStats.median.toFixed(2) },
                    { label: "Std Dev", value: fullStats.stdDev.toFixed(3) },
                    { label: "Variance", value: fullStats.variance.toFixed(2) },
                    { label: "Skewness", value: fullStats.skewness.toFixed(4) },
                    { label: "Kurtosis", value: fullStats.kurtosis.toFixed(4) },
                    { label: "Min", value: String(fullStats.min) },
                    { label: "Max", value: String(fullStats.max) },
                  ].map((s) => (
                    <div key={s.label} className="text-center">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">{s.label}</div>
                      <div className="font-mono text-sm font-bold text-[var(--text-primary)]">{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-[var(--border)]">
              {(
                [
                  { key: "chart", label: "Chart", icon: "📈" },
                  { key: "table", label: "Data Table", icon: "📊" },
                  { key: "exports", label: "Exports", icon: "📦" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-5 py-3 text-sm font-medium tracking-wide transition-colors border-b-2 -mb-px ${
                    activeTab === tab.key
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* ─── Chart Tab ─── */}
            {activeTab === "chart" && (
              <>
                <div
                  className="animate-fade-in-up rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6"
                  style={{ animationDelay: "80ms" }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest">
                      Interest Over Time — &ldquo;{keyword}&rdquo;
                    </h3>
                    {cutoffXValue && (
                      <span className="text-xs font-mono px-2 py-1 rounded-full border"
                        style={{ color: "var(--warning)", borderColor: "var(--warning)", background: "var(--warning)11" }}>
                        Cutoff: {cutoffDate}
                      </span>
                    )}
                  </div>
                  <div className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={data}
                        margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="var(--border)"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="datetime"
                          tickFormatter={formatAxisDate}
                          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                          axisLine={{ stroke: "var(--border)" }}
                          tickLine={false}
                          minTickGap={60}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          width={35}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        {/* Shade the "after cutoff" region */}
                        {cutoffXValue && (
                          <ReferenceArea
                            x1={cutoffXValue}
                            fill="#7c5cff"
                            fillOpacity={0.07}
                          />
                        )}
                        <Area
                          type="monotone"
                          dataKey="hits"
                          stroke="var(--accent)"
                          strokeWidth={1.5}
                          fill="url(#areaGrad)"
                          dot={false}
                          activeDot={{ r: 4, fill: "var(--accent)", stroke: "var(--bg-primary)", strokeWidth: 2 }}
                        />
                        {/* Cutoff vertical line */}
                        {cutoffXValue && (
                          <ReferenceLine
                            x={cutoffXValue}
                            stroke="#ffb347"
                            strokeWidth={2}
                            strokeDasharray="6 3"
                            label={{
                              value: cutoffDate,
                              position: "insideTopRight",
                              fill: "#ffb347",
                              fontSize: 10,
                              fontFamily: "monospace",
                            }}
                          />
                        )}
                        <Brush
                          dataKey="datetime"
                          height={28}
                          stroke="var(--border-accent)"
                          fill="var(--bg-secondary)"
                          tickFormatter={formatAxisDate}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Before / After cutoff comparison */}
                {cutoffStats?.before && cutoffStats?.after && (
                  <div className="animate-fade-in-up grid grid-cols-1 md:grid-cols-2 gap-4" style={{ animationDelay: "120ms" }}>
                    {[
                      { label: "Before Cutoff", s: cutoffStats.before, color: "var(--accent)", prefix: `< ${cutoffDate}` },
                      { label: "After Cutoff", s: cutoffStats.after, color: "#7c5cff", prefix: `≥ ${cutoffDate}` },
                    ].map(({ label, s, color, prefix }) => (
                      <div key={label} className="rounded-2xl border bg-[var(--bg-card)] p-5"
                        style={{ borderColor: color + "55" }}>
                        <div className="flex items-center gap-2 mb-4">
                          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color }}>
                            {label}
                          </span>
                          <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">{prefix}</span>
                          <span className="font-mono text-[11px] text-[var(--text-muted)]">n={s.n.toLocaleString()}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { lbl: "Mean", val: s.mean.toFixed(2) },
                            { lbl: "Median", val: s.median.toFixed(2) },
                            { lbl: "Std Dev", val: s.stdDev.toFixed(3) },
                            { lbl: "Variance", val: s.variance.toFixed(2) },
                            { lbl: "Skewness", val: s.skewness.toFixed(4) },
                            { lbl: "Kurtosis", val: s.kurtosis.toFixed(4) },
                          ].map((m) => (
                            <div key={m.lbl} className="text-center py-2 rounded-lg bg-[var(--bg-secondary)]">
                              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">{m.lbl}</div>
                              <div className="font-mono text-sm font-bold" style={{ color }}>{m.val}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ─── Table Tab ─── */}
            {activeTab === "table" && (
              <div
                className="animate-fade-in-up rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden"
                style={{ animationDelay: "80ms" }}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        {TABLE_COLS.map((col) => (
                          <th
                            key={col.key}
                            onClick={() => handleSort(col.key)}
                            className="px-3 py-3 text-left text-[10px] uppercase tracking-widest text-[var(--text-muted)] font-semibold cursor-pointer hover:text-[var(--accent)] transition-colors whitespace-nowrap select-none"
                          >
                            {col.label}
                            {sortField === col.key && (
                              <span className="ml-1 text-[var(--accent)]">
                                {sortDir === "asc" ? "↑" : "↓"}
                              </span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedData.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-card-hover)] transition-colors"
                        >
                          {TABLE_COLS.map((col) => (
                            <td
                              key={col.key}
                              className={`px-3 py-2.5 whitespace-nowrap ${
                                col.mono
                                  ? "font-mono text-xs"
                                  : "text-sm"
                              } ${
                                col.key === "hits"
                                  ? "text-[var(--accent)] font-bold"
                                  : "text-[var(--text-secondary)]"
                              }`}
                            >
                              {col.key === "weekend"
                                ? row.weekend
                                  ? "✓"
                                  : ""
                                : String(row[col.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
                  <span className="text-xs text-[var(--text-muted)]">
                    {page * pageSize + 1}–
                    {Math.min((page + 1) * pageSize, sortedData.length)} of{" "}
                    {sortedData.length.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                      className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      ← Prev
                    </button>
                    <span className="text-xs text-[var(--text-muted)] font-mono">
                      {page + 1}/{totalPages}
                    </span>
                    <button
                      onClick={() =>
                        setPage(Math.min(totalPages - 1, page + 1))
                      }
                      disabled={page >= totalPages - 1}
                      className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ─── Exports Tab ─── */}
            {activeTab === "exports" && (
              <div
                className="animate-fade-in-up grid grid-cols-1 md:grid-cols-2 gap-4"
                style={{ animationDelay: "80ms" }}
              >
                {[
                  {
                    title: "CSV",
                    desc: "All columns with time components. Ready for pandas, R, or any tool.",
                    icon: "📄",
                    ext: ".csv",
                    handler: exportCSV,
                    color: "var(--accent)",
                  },
                  {
                    title: "Excel",
                    desc: "Formatted workbook with headers. Open in Excel, Sheets, or Numbers.",
                    icon: "📊",
                    ext: ".xlsx",
                    handler: exportExcel,
                    color: "#4CAF50",
                  },
                  {
                    title: "R Script",
                    desc: "gtrendsR script for the selected date range — writes both intraday (frequency) and daily CSVs.",
                    icon: "📐",
                    ext: ".R",
                    handler: exportRScript,
                    color: "#2196F3",
                  },
                  {
                    title: "Stata",
                    desc: "CSV + .do file with clock(), tsset, moving averages, and plots.",
                    icon: "📈",
                    ext: ".do + .csv",
                    handler: exportStata,
                    color: "#FF9800",
                  },
                  {
                    title: "Word Report",
                    desc: "Full .docx analysis report: keywords, collection process, timeline, variance extraction, and descriptive statistics (mean, median, skewness, kurtosis). Includes before/after cutoff comparison if a cutoff date is set.",
                    icon: "📝",
                    ext: ".docx",
                    handler: exportDocx,
                    color: "#2B579A",
                  },
                ].map((exp) => (
                  <button
                    key={exp.title}
                    onClick={exp.handler}
                    className="group text-left rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 hover:border-[var(--border-accent)] hover:bg-[var(--bg-card-hover)] transition-all active:scale-[0.98]"
                  >
                    <div className="flex items-start gap-4">
                      <span className="text-3xl">{exp.icon}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-[var(--text-primary)]">
                            {exp.title}
                          </span>
                          <span
                            className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
                            style={{
                              color: exp.color,
                              borderColor: exp.color + "44",
                              background: exp.color + "11",
                            }}
                          >
                            {exp.ext}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                          {exp.desc}
                        </p>
                      </div>
                      <span className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors text-lg">
                        ↓
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* ─── Empty State ─── */}
        {!fetched && !loading && (
          <div className="animate-fade-in-up text-center py-24" style={{ animationDelay: "200ms" }}>
            <div className="text-6xl mb-6 opacity-20">📈</div>
            <h2 className="text-xl font-semibold text-[var(--text-secondary)] mb-2">
              Enter a keyword to begin
            </h2>
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
              Trend Pulse generates simulated data matching Google Trends
              patterns. Export the generated <strong>R script</strong> to fetch
              real data via <code className="text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded text-xs font-mono">gtrendsR</code>.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 text-xs">
              {["Bitcoin", "ChatGPT", "Climate Change", "Taylor Swift"].map(
                (s) => (
                  <button
                    key={s}
                    onClick={() => setKeyword(s)}
                    className="px-4 py-2 rounded-full border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40 transition-colors"
                  >
                    {s}
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </main>

      {/* ─── Footer ─── */}
      <footer className="border-t border-[var(--border)] py-6 mt-16">
        <div className="max-w-7xl mx-auto px-6 flex flex-wrap items-center justify-between text-xs text-[var(--text-muted)]">
          <span>
            Trend Pulse by{" "}
            <a
              href="https://github.com/AliAwaisKhalid"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline"
            >
              Ali Awais Khalid
            </a>
          </span>
          <span>MIT License • 2026</span>
        </div>
      </footer>
    </div>
  );
}
