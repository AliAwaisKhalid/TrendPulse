"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Brush,
  ReferenceLine,
  ReferenceArea,
  Legend,
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
  keyword: string;
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
type DateMode = "relative" | "range";

/* 30-color palette — one colour per keyword */
const KW_COLORS = [
  "#00e5a0", "#7c5cff", "#ffb347", "#ff5c5c", "#2196F3",
  "#E91E63", "#00BCD4", "#8BC34A", "#FF9800", "#9C27B0",
  "#3F51B5", "#009688", "#F44336", "#FF5722", "#ff7043",
  "#607D8B", "#c6d600", "#FFC107", "#00E5FF", "#76FF03",
  "#FF4081", "#40C4FF", "#69F0AE", "#FFD740", "#FF6D00",
  "#651FFF", "#00B0FF", "#1DE9B6", "#F50057", "#EEFF41",
];

const MAX_KEYWORDS = 30;

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
    "1min": 1, "5min": 5, "15min": 15, "30min": 30,
    "1hour": 60, "4hour": 240, daily: 1440, weekly: 10080,
  };
  return map[f];
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function effectiveRange(
  mode: DateMode, days: number, startDate: string, endDate: string
): { start: Date; end: Date } {
  if (mode === "range" && startDate && endDate) {
    let s = new Date(`${startDate}T00:00:00`);
    let e = new Date(`${endDate}T23:59:59`);
    if (s.getTime() > e.getTime()) [s, e] = [e, s];
    return { start: s, end: e };
  }
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  return { start, end };
}

function rangeDays(start: Date, end: Date): number {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function fileBase(keywords: string[]): string {
  if (!keywords.length) return "trends";
  const first = keywords[0].replace(/\s+/g, "_");
  return keywords.length === 1 ? first : `${first}_+${keywords.length - 1}more`;
}

function formatAxisDate(val: string) {
  if (!val) return "";
  const parts = val.split(" ");
  if (parts.length < 2) return val;
  return `${parts[0].slice(5)} ${parts[1]}`;
}

/* ─────────── Data Generation ─────────── */
function generateSimulatedData(
  keyword: string, start: Date, end: Date, freq: Frequency, _geo: string
): TrendRow[] {
  const rows: TrendRow[] = [];
  const stepMs = freqMinutes(freq) * 60000;
  const spanMs = Math.max(stepMs, end.getTime() - start.getTime());
  const totalSteps = Math.floor(spanMs / stepMs);
  const seed = keyword.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 30 + (seed % 40);
  const trendSlope = ((seed % 20) - 10) / totalSteps;

  for (let i = 0; i < totalSteps; i++) {
    const dt = new Date(start.getTime() + i * stepMs);
    const hour = dt.getHours();
    const dow = dt.getDay();
    const dailyCycle = hour >= 9 && hour <= 23 ? 15 * Math.sin(((hour - 9) / 14) * Math.PI) : -10;
    const weekCycle = dow === 0 || dow === 6 ? -8 : 3;
    const trend = trendSlope * i;
    const noise = Math.sin(seed * i * 0.01) * 7 + Math.cos(i * 0.003) * 12;
    const spikes = Math.random() < 0.005 ? 20 + Math.random() * 30 : 0;
    let hits = Math.round(base + dailyCycle + weekCycle + trend + noise + spikes);
    hits = Math.max(0, Math.min(100, hits));
    const dateStr = dt.toISOString().slice(0, 10);
    const timeStr = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
    rows.push({
      keyword,
      datetime: `${dateStr} ${timeStr}`,
      date: dateStr, time: timeStr,
      year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate(),
      hour: dt.getHours(), minute: dt.getMinutes(),
      dow, dowName: DOW_NAMES[dow],
      quarter: Math.floor(dt.getMonth() / 3) + 1,
      weekend: dow === 0 || dow === 6,
      hits,
    });
  }
  return rows;
}

/* ─────────── R Script Generator ─────────── */
function generateRScript(
  keywords: string[], startDate: string, endDate: string, freq: Frequency, geo: string
): string {
  const fMin = freqMinutes(freq);
  const kwList = keywords.map((k) => `"${k}"`).join(", ");
  return `# ══════════════════════════════════════════════════
# Trend Pulse — gtrendsR Multi-Keyword Script
# Keywords: c(${kwList})
# Range: ${startDate} → ${endDate} | Freq: ${freq} (${fMin} min) | Geo: ${geo || "worldwide"}
# Outputs per-keyword intraday (${freq}) + daily CSVs, plus combined daily.
# ══════════════════════════════════════════════════

library(gtrendsR)
library(dplyr)
library(lubridate)

keywords   <- c(${kwList})
geo        <- ${geo ? `"${geo}"` : "NULL"}
freq_min   <- ${fMin}
start_date <- as.Date("${startDate}")
end_date   <- as.Date("${endDate}")

add_components <- function(df) {
  df %>% mutate(
    date     = as.Date(datetime),
    time     = format(datetime, "%H:%M"),
    year     = year(datetime), month = month(datetime), day = day(datetime),
    hour     = hour(datetime), minute = minute(datetime),
    dow      = wday(datetime, week_start = 7) - 1,
    dow_name = weekdays(datetime, abbreviate = TRUE),
    quarter  = quarter(datetime), weekend = dow %in% c(0, 6)
  )
}

all_daily <- data.frame()

for (keyword in keywords) {
  cat(sprintf("\\n=== %s ===\\n", keyword))
  fname <- gsub("\\\\s+", "_", keyword)

  # ── Intraday via 24h windows ──
  windows <- list()
  d <- start_date
  while (d < end_date) {
    windows[[length(windows) + 1]] <- c(d, min(d + 1, end_date))
    d <- d + hours(20)
  }
  cat(sprintf("Intraday windows: %d\\n", length(windows)))
  intraday <- data.frame()
  for (i in seq_along(windows)) {
    w <- windows[[i]]
    time_str <- sprintf("%sT00 %sT00", format(w[1], "%Y-%m-%d"), format(w[2], "%Y-%m-%d"))
    cat(sprintf("[%d/%d] %s\\n", i, length(windows), time_str))
    tryCatch({
      res <- gtrends(keyword, geo = geo, time = time_str)
      iot <- res$interest_over_time
      if (!is.null(iot) && nrow(iot) > 0) {
        iot$date <- ymd_hms(iot$date)
        iot$hits <- as.numeric(gsub("[^0-9]", "", iot$hits))
        intraday <- bind_rows(intraday, iot)
      }
    }, error = function(e) cat(sprintf("  ERROR: %s\\n", e$message)))
    Sys.sleep(runif(1, 1.5, 3.5))
  }
  intraday <- intraday %>%
    group_by(date) %>% summarise(hits = mean(hits, na.rm = TRUE)) %>% ungroup() %>% arrange(date)
  mx <- max(intraday$hits, na.rm = TRUE)
  if (is.finite(mx) && mx > 0) intraday$hits <- round(intraday$hits / mx * 100)
  intraday <- intraday %>%
    mutate(keyword = keyword, bucket = floor_date(date, unit = paste0(freq_min, " mins"))) %>%
    group_by(keyword, bucket) %>% summarise(hits = round(mean(hits, na.rm = TRUE))) %>%
    rename(datetime = bucket) %>% ungroup() %>% add_components()
  write.csv(intraday, paste0(fname, "_${freq}.csv"), row.names = FALSE)
  cat(sprintf("Intraday: %d rows -> %s_${freq}.csv\\n", nrow(intraday), fname))

  # ── Daily via single call ──
  daily_time <- sprintf("%s %s", format(start_date, "%Y-%m-%d"), format(end_date, "%Y-%m-%d"))
  tryCatch({
    res <- gtrends(keyword, geo = geo, time = daily_time)
    iot <- res$interest_over_time
    if (!is.null(iot) && nrow(iot) > 0) {
      daily <- data.frame(
        keyword = keyword, datetime = as.POSIXct(as.Date(iot$date)),
        hits = as.numeric(gsub("[^0-9]", "", iot$hits))
      ) %>% arrange(datetime) %>% add_components()
      all_daily <- bind_rows(all_daily, daily)
      write.csv(daily, paste0(fname, "_daily.csv"), row.names = FALSE)
      cat(sprintf("Daily: %d rows -> %s_daily.csv\\n", nrow(daily), fname))
    }
  }, error = function(e) cat(sprintf("  ERROR daily: %s\\n", e$message)))
}

# Combined daily across all keywords
write.csv(all_daily, "all_keywords_daily.csv", row.names = FALSE)
cat(sprintf("\\nCombined daily: %d rows -> all_keywords_daily.csv\\n", nrow(all_daily)))
cat("Done!\\n")
`;
}

/* ─────────── Stata .do Generator ─────────── */
function generateStataDoFile(keywords: string[], freq: Frequency): string {
  const keyword = keywords[0] ?? "keyword";
  const fname = `${keyword.replace(/\s+/g, "_")}_trends`;
  const deltaMs = freqMinutes(freq) * 60000;
  return `* ══════════════════════════════════════════════════
* Trend Pulse — Stata Import & Time-Series Setup
* Keywords: ${keywords.join(", ")} | Freq: ${freq}
* Note: script uses the first keyword CSV. Run separately for each keyword.
* ══════════════════════════════════════════════════

clear all
set more off

* ── Import CSV (first keyword) ──
import delimited "${fname}_${freq}.csv", clear

* ── Create Stata datetime ──
gen double stata_dt = clock(datetime, "YMDhms#")
format stata_dt %tcCCYY-NN-DD_HH:MM:SS

* ── Time components ──
gen int s_year = year(dofC(stata_dt))
gen byte s_month = month(dofC(stata_dt))
gen byte s_day = day(dofC(stata_dt))
gen byte s_hour = hh(stata_dt)
gen byte s_minute = mm(stata_dt)
gen byte s_dow = dow(dofC(stata_dt))

gen double clock_time = (s_hour * 3600 + s_minute * 60) * 1000
format clock_time %tcHH:MM

gen byte is_weekend = (s_dow == 0 | s_dow == 6)
label define wknd 0 "Weekday" 1 "Weekend"
label values is_weekend wknd

tsset stata_dt, delta(${deltaMs})

gen double ma6  = (L3.hits + L2.hits + L1.hits + hits + F1.hits + F2.hits) / 6
gen double ma12 = (L6.hits + L5.hits + L4.hits + L3.hits + L2.hits + L1.hits ///
                 + hits + F1.hits + F2.hits + F3.hits + F4.hits + F5.hits) / 12
label var ma6  "6-period MA"
label var ma12 "12-period MA"

tsline hits, title("${keyword} — Google Trends") ///
  ytitle("Interest (0-100)") xtitle("") lcolor(emerald) lwidth(thin)

twoway (tsline hits, lcolor(gs12) lwidth(vthin)) ///
       (tsline ma6, lcolor(emerald) lwidth(medthick)) ///
       (tsline ma12, lcolor(orange) lwidth(medthick)), ///
  title("${keyword} — with Moving Averages") ///
  legend(order(1 "Raw" 2 "MA-6" 3 "MA-12"))
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
  kurtosis: number;
  min: number;
  max: number;
}

function computeStats(hits: number[]): FullStats | null {
  const n = hits.length;
  if (n === 0) return null;
  const mean = hits.reduce((a, b) => a + b, 0) / n;
  const sorted = [...hits].sort((a, b) => a - b);
  const median =
    n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const variance = hits.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const skewness =
    stdDev === 0 ? 0 : hits.reduce((a, b) => a + ((b - mean) / stdDev) ** 3, 0) / n;
  const kurtosis =
    stdDev === 0 ? 0 : hits.reduce((a, b) => a + ((b - mean) / stdDev) ** 4, 0) / n - 3;
  return { n, mean, median, variance, stdDev, skewness, kurtosis, min: sorted[0], max: sorted[n - 1] };
}

/* ─────────── Saved Analyses ─────────── */
interface SavedAnalysis {
  id: string;
  name: string;
  savedAt: string;
  keywords: string[];
  freq: Frequency;
  geo: string;
  dateMode: DateMode;
  days: number;
  startDate: string;
  endDate: string;
  cutoffDate: string;
  dataByKeyword: Record<string, TrendRow[]>;
}

/* ─────────── DOCX Report ─────────── */
function docCell(text: string, bold = false, bg?: string): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: bold ? 22 : 20, color: bold ? "1a1a2e" : "2d2d4a" })] })],
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
      new TableRow({ children: r.map((cell, ci) => docCell(cell, i === 0, i === 0 ? "c8f0e0" : ci % 2 === 0 ? "f5f5f8" : "ffffff")) })
    ),
  });
}

async function generateDocxReport(params: {
  keywords: string[];
  startDate: string;
  endDate: string;
  freq: Frequency;
  geo: string;
  flatData: TrendRow[];
  cutoffDate: string;
  kwStats: Record<string, FullStats>;
  fullStats: FullStats;
  beforeStats: FullStats | null;
  afterStats: FullStats | null;
}): Promise<Blob> {
  const { keywords, startDate, endDate, freq, geo, flatData, cutoffDate, kwStats, fullStats, beforeStats, afterStats } = params;
  const country = COUNTRIES[geo] || "Worldwide";
  const now = new Date().toLocaleString();

  const h = (text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel]) =>
    new Paragraph({ text, heading: level, spacing: { before: 300, after: 120 } });
  const p = (text: string, spacing = 120) =>
    new Paragraph({ children: [new TextRun({ text, size: 20, color: "2d2d4a" })], spacing: { after: spacing } });
  const divider = () =>
    new Paragraph({ spacing: { before: 100, after: 100 }, children: [new TextRun({ text: "─".repeat(60), color: "ccccdd", size: 16 })] });

  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "TREND PULSE", bold: true, size: 48, color: "007a50" })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "Google Trends Analysis Report", size: 28, color: "5555aa" })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: `Generated: ${now}`, size: 18, color: "888899" })] }),

    h("1. Analysis Overview", HeadingLevel.HEADING_1),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        ["Keywords Added", keywords.join(", ")],
        ["Total Keywords", String(keywords.length)],
        ["Date Range", `${startDate} → ${endDate}`],
        ["Frequency", `${freq} (${freqMinutes(freq)} minutes)`],
        ["Region", country],
        ["Total Data Points", fullStats.n.toLocaleString()],
        ["Cutoff Date", cutoffDate || "Not set"],
      ].map(([label, val]) =>
        new TableRow({ children: [docCell(label, true, "e8f5ee"), docCell(val, false, "ffffff")] })
      ),
    }),

    divider(),

    h("2. Data Collection Process", HeadingLevel.HEADING_1),
    p(
      "Google Trends provides a normalized search interest index (0–100) where 100 represents the peak " +
      "popularity for a keyword in the selected time period. The API restricts high-resolution (sub-hourly) " +
      "data to short windows of ≤ 7 days."
    ),
    p(
      `To overcome this limitation, Trend Pulse uses an overlapping 24-hour window strategy: the date ` +
      `range (${startDate} → ${endDate}) is divided into consecutive 24-hour windows, each overlapping ` +
      `the previous by 4 hours. Within each window, Google returns approximately one data point per minute. ` +
      `This process runs independently for each of the ${keywords.length} keyword(s).`
    ),
    p(
      "Overlapping observations are averaged to smooth seam artefacts. The full series is globally " +
      `re-normalized to 0–100, then aggregated to the target frequency (${freq}) by averaging within each ` +
      "time bucket. A separate direct daily call over the full date range produces the daily series. " +
      "Both files are written for each keyword."
    ),

    divider(),

    h("3. Timeline", HeadingLevel.HEADING_1),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        ["Start Date", startDate],
        ["End Date", endDate],
        ["Duration", `${Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)} days`],
        ["Data Resolution", `${freq} intervals (${freqMinutes(freq)} min)`],
        ["Keywords", String(keywords.length)],
        ["First Observation", flatData[0]?.datetime ?? "—"],
        ["Last Observation", flatData[flatData.length - 1]?.datetime ?? "—"],
        ["Collection Method", "Overlapping 24h windows (4h overlap) + direct daily call per keyword"],
      ].map(([label, val]) =>
        new TableRow({ children: [docCell(label, true, "e8f5ee"), docCell(val, false, "ffffff")] })
      ),
    }),

    divider(),

    h("4. Descriptive Statistics — Per Keyword", HeadingLevel.HEADING_1),
    p(
      "Statistics computed on the Google Trends interest index (0–100 scale). " +
      "Skewness: asymmetry of distribution (0 = symmetric). " +
      "Excess kurtosis: tail heaviness vs normal (0 = normal, >0 = heavy-tailed, <0 = light-tailed)."
    ),
    ...keywords.flatMap((kw) => {
      const s = kwStats[kw];
      if (!s) return [];
      return [
        h(kw, HeadingLevel.HEADING_2),
        statsTable(s),
        new Paragraph({ text: "", spacing: { after: 150 } }),
      ];
    }),

    h("4b. Aggregate Statistics (All Keywords Combined)", HeadingLevel.HEADING_2),
    statsTable(fullStats),
  ];

  if (cutoffDate && beforeStats && afterStats) {
    children.push(
      divider(),
      h("5. Cutoff Date Analysis", HeadingLevel.HEADING_1),
      p(
        `The combined series is split at ${cutoffDate}. ` +
        `Before: ${beforeStats.n.toLocaleString()} observations. After: ${afterStats.n.toLocaleString()} observations.`
      ),
      h("Before Cutoff", HeadingLevel.HEADING_2),
      statsTable(beforeStats),
      new Paragraph({ text: "", spacing: { after: 200 } }),
      h("After Cutoff", HeadingLevel.HEADING_2),
      statsTable(afterStats),
      new Paragraph({ text: "", spacing: { after: 200 } }),
      h("Change Summary (Δ After − Before)", HeadingLevel.HEADING_2),
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
          new TableRow({ children: r.map((cell, ci) => docCell(cell, i === 0, i === 0 ? "c8f0e0" : ci % 2 === 0 ? "f5f5f8" : "ffffff")) })
        ),
      })
    );
  }

  const varSection = cutoffDate ? "6" : "5";
  children.push(
    divider(),
    h(`${varSection}. Notes on Variance Extraction`, HeadingLevel.HEADING_1),
    p(
      "Variance measures temporal dispersion of search interest around its mean. High variance indicates " +
      "large swings — typical of trending events, viral content, or seasonal products. Low variance " +
      "indicates stable, consistent search behaviour."
    ),
    p(
      "The windowed collection preserves intraday variance that is lost in Google's standard daily view. " +
      "Each 24h window captures the full intraday cycle (0–100 within that window), and global " +
      "re-normalization stitches windows into a single comparable series."
    ),
    p(
      `Aggregate variance: ${fullStats.variance.toFixed(3)} (std dev: ${fullStats.stdDev.toFixed(3)}). ` +
      (cutoffDate && beforeStats && afterStats
        ? `Before cutoff: ${beforeStats.variance.toFixed(3)};  after: ${afterStats.variance.toFixed(3)}. ` +
          (afterStats.variance > beforeStats.variance
            ? "Variance increased after the cutoff — greater fluctuation in the later period."
            : "Variance decreased after the cutoff — more stable interest in the later period.")
        : "")
    )
  );

  const doc = new Document({
    creator: "Trend Pulse",
    title: `${keywords.join(", ")} — Google Trends Analysis Report`,
    description: `Multi-keyword analysis from ${startDate} to ${endDate}`,
    sections: [{ children }],
  });
  return await Packer.toBlob(doc);
}

/* ─────────── UI Components ─────────── */
function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "accent" | "muted" }) {
  const cls =
    variant === "accent"
      ? "bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30"
      : variant === "muted"
      ? "bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border)]"
      : "bg-[var(--accent-secondary)]/15 text-[var(--accent-secondary)] border-[var(--accent-secondary)]/30";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase rounded-full border ${cls}`}>
      {children}
    </span>
  );
}

function StatCard({ label, value, sub, delay }: { label: string; value: string | number; sub?: string; delay: number }) {
  return (
    <div className="animate-fade-in-up rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 hover:border-[var(--border-accent)] transition-colors" style={{ animationDelay: `${delay}ms` }}>
      <div className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-2 font-semibold">{label}</div>
      <div className="text-2xl font-bold text-[var(--text-primary)]" style={{ fontFamily: "'Space Mono', monospace" }}>{value}</div>
      {sub && <div className="text-xs text-[var(--text-secondary)] mt-1">{sub}</div>}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border-accent)] bg-[var(--bg-card)]/95 backdrop-blur-sm px-4 py-3 shadow-xl min-w-[160px]">
      <div className="text-[11px] text-[var(--text-muted)] mb-2 font-mono">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mt-1">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-xs flex-1 truncate max-w-[120px]" style={{ color: p.color }}>{p.dataKey}</span>
          <span className="font-bold text-sm ml-auto font-mono" style={{ color: p.color }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ─────────── Main App ─────────── */
export default function TrendPulse() {
  /* ── Input state ── */
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [days, setDays] = useState(90);
  const [dateMode, setDateMode] = useState<DateMode>("relative");
  const [startDate, setStartDate] = useState(() => toISODate(new Date(Date.now() - 90 * 86400000)));
  const [endDate, setEndDate] = useState(() => toISODate(new Date()));
  const [freq, setFreq] = useState<Frequency>("30min");
  const [geo, setGeo] = useState("");

  /* ── Data state ── */
  const [dataByKeyword, setDataByKeyword] = useState<Record<string, TrendRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  /* ── Analysis state ── */
  const [cutoffDate, setCutoffDate] = useState("");

  /* ── Table state ── */
  const [sortField, setSortField] = useState<SortField>("datetime");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const pageSize = 25;

  /* ── Tab state ── */
  const [activeTab, setActiveTab] = useState<"chart" | "table" | "exports">("chart");

  /* ── Saved analyses ── */
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem("trendpulse_saves") ?? "[]"); }
    catch { return []; }
  });
  const [saveNameInput, setSaveNameInput] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [showSaved, setShowSaved] = useState(true);

  /* ── Keyword management ── */
  const addKeyword = useCallback((raw: string) => {
    const kw = raw.trim().replace(/,$/, "");
    if (!kw || keywords.includes(kw) || keywords.length >= MAX_KEYWORDS) return;
    setKeywords((prev) => [...prev, kw]);
    setKeywordInput("");
  }, [keywords]);

  const removeKeyword = useCallback((kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }, []);

  /* ── Fetch ── */
  const handleFetch = useCallback(() => {
    if (!keywords.length) return;
    setLoading(true);
    setFetched(false);
    setTimeout(() => {
      const { start, end } = effectiveRange(dateMode, days, startDate, endDate);
      const newData: Record<string, TrendRow[]> = {};
      for (const kw of keywords) {
        newData[kw] = generateSimulatedData(kw, start, end, freq, geo);
      }
      setDataByKeyword(newData);
      setLoading(false);
      setFetched(true);
      setPage(0);
      setActiveTab("chart");
    }, 1000 + keywords.length * 150);
  }, [keywords, days, dateMode, startDate, endDate, freq, geo]);

  /* ── Save / Load / Delete analyses ── */
  const handleSave = useCallback(() => {
    const name = saveNameInput.trim() || keywords.slice(0, 3).join(", ").slice(0, 50);
    if (!name || !fetched) return;
    const entry: SavedAnalysis = {
      id: Date.now().toString(), name, savedAt: new Date().toISOString(),
      keywords, freq, geo, dateMode, days, startDate, endDate, cutoffDate, dataByKeyword,
    };
    setSavedAnalyses((prev) => {
      const next = [entry, ...prev].slice(0, 15);
      try {
        localStorage.setItem("trendpulse_saves", JSON.stringify(next));
        return next;
      } catch {
        /* Storage full — save config only (no raw data) */
        const lite = next.map((s) => ({ ...s, dataByKeyword: {} }));
        try { localStorage.setItem("trendpulse_saves", JSON.stringify(lite)); return lite; }
        catch { return prev; }
      }
    });
    setSaveNameInput("");
    setShowSaveInput(false);
  }, [saveNameInput, keywords, fetched, freq, geo, dateMode, days, startDate, endDate, cutoffDate, dataByKeyword]);

  const handleLoadAnalysis = useCallback((saved: SavedAnalysis) => {
    setKeywords(saved.keywords);
    setFreq(saved.freq); setGeo(saved.geo);
    setDateMode(saved.dateMode); setDays(saved.days);
    setStartDate(saved.startDate); setEndDate(saved.endDate);
    setCutoffDate(saved.cutoffDate);
    const hasData = Object.keys(saved.dataByKeyword).length > 0;
    if (hasData) {
      setDataByKeyword(saved.dataByKeyword);
      setFetched(true); setPage(0); setActiveTab("chart");
    } else {
      /* Config-only save — regenerate data using saved params */
      setDataByKeyword({}); setFetched(false);
      setLoading(true);
      setTimeout(() => {
        const { start, end } = effectiveRange(saved.dateMode, saved.days, saved.startDate, saved.endDate);
        const newData: Record<string, TrendRow[]> = {};
        for (const kw of saved.keywords) newData[kw] = generateSimulatedData(kw, start, end, saved.freq, saved.geo);
        setDataByKeyword(newData); setLoading(false); setFetched(true); setPage(0); setActiveTab("chart");
      }, 1000 + saved.keywords.length * 150);
    }
  }, []);

  const handleDeleteAnalysis = useCallback((id: string) => {
    setSavedAnalyses((prev) => {
      const next = prev.filter((s) => s.id !== id);
      try { localStorage.setItem("trendpulse_saves", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  /* ── Derived data ── */
  const flatData = useMemo(
    () => Object.values(dataByKeyword).flat(),
    [dataByKeyword]
  );

  /* Chart data: pivot by datetime, one column per keyword */
  const chartData = useMemo(() => {
    const kws = Object.keys(dataByKeyword);
    if (!kws.length) return [];
    const base = dataByKeyword[kws[0]];
    return base.map((row, i) => {
      const out: Record<string, unknown> = { datetime: row.datetime, date: row.date };
      for (const kw of kws) out[kw] = dataByKeyword[kw]?.[i]?.hits ?? 0;
      return out;
    });
  }, [dataByKeyword]);

  /* Per-keyword stats */
  const kwStats = useMemo(() => {
    const out: Record<string, FullStats> = {};
    for (const [kw, rows] of Object.entries(dataByKeyword)) {
      const s = computeStats(rows.map((r) => r.hits));
      if (s) out[kw] = s;
    }
    return out;
  }, [dataByKeyword]);

  /* Aggregate stats across all keywords */
  const fullStats = useMemo(
    () => computeStats(flatData.map((d) => d.hits)),
    [flatData]
  );

  /* Cutoff stats on combined data */
  const cutoffStats = useMemo(() => {
    if (!flatData.length || !cutoffDate) return null;
    const before = computeStats(flatData.filter((d) => d.date < cutoffDate).map((d) => d.hits));
    const after = computeStats(flatData.filter((d) => d.date >= cutoffDate).map((d) => d.hits));
    return { before, after };
  }, [flatData, cutoffDate]);

  const cutoffXValue = useMemo(
    () => (cutoffDate ? chartData.find((d) => (d.date as string) >= cutoffDate)?.datetime as string ?? null : null),
    [chartData, cutoffDate]
  );

  /* Quick stat summary */
  const stats = useMemo(() => {
    if (!fullStats) return null;
    const maxRow = flatData.find((d) => d.hits === fullStats.max);
    return { avg: fullStats.mean.toFixed(1), max: fullStats.max, min: fullStats.min, maxRow, total: fullStats.n };
  }, [flatData, fullStats]);

  /* Effective range for display */
  const range = useMemo(
    () => effectiveRange(dateMode, days, startDate, endDate),
    [dateMode, days, startDate, endDate]
  );
  const effDays = rangeDays(range.start, range.end);
  const estPoints = Math.floor((effDays * 1440) / freqMinutes(freq));

  /* ── Table ── */
  const sortedData = useMemo(() => {
    const sorted = [...flatData].sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      if (typeof av === "number" && typeof bv === "number")
        return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return sorted;
  }, [flatData, sortField, sortDir]);

  const pagedData = useMemo(
    () => sortedData.slice(page * pageSize, (page + 1) * pageSize),
    [sortedData, page]
  );
  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
    setPage(0);
  };

  /* ── Exports ── */
  const exportCSV = () => {
    const header = "keyword,datetime,date,time,year,month,day,hour,minute,dow,dow_name,quarter,weekend,hits\n";
    const rows = flatData.map((r) =>
      `${r.keyword},${r.datetime},${r.date},${r.time},${r.year},${r.month},${r.day},${r.hour},${r.minute},${r.dow},${r.dowName},${r.quarter},${r.weekend ? 1 : 0},${r.hits}`
    ).join("\n");
    saveAs(new Blob([header + rows], { type: "text/csv;charset=utf-8" }), `${fileBase(keywords)}_trends.csv`);
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const toRow = (r: TrendRow) => ({
      keyword: r.keyword, datetime: r.datetime, date: r.date, time: r.time,
      year: r.year, month: r.month, day: r.day, hour: r.hour, minute: r.minute,
      dow: r.dow, dow_name: r.dowName, quarter: r.quarter, weekend: r.weekend ? 1 : 0, hits: r.hits,
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flatData.map(toRow)), "Combined");
    for (const [kw, rows] of Object.entries(dataByKeyword)) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(toRow)), kw.slice(0, 31));
    }
    XLSX.writeFile(wb, `${fileBase(keywords)}_trends.xlsx`);
  };

  const exportRScript = () => {
    const { start, end } = effectiveRange(dateMode, days, startDate, endDate);
    const script = generateRScript(keywords, toISODate(start), toISODate(end), freq, geo);
    saveAs(new Blob([script], { type: "text/plain;charset=utf-8" }), `${fileBase(keywords)}_trends.R`);
  };

  const exportStata = () => {
    exportCSV();
    const doFile = generateStataDoFile(keywords, freq);
    saveAs(new Blob([doFile], { type: "text/plain;charset=utf-8" }), `${fileBase(keywords)}_trends.do`);
  };

  const exportDocx = async () => {
    if (!fullStats) return;
    const { start, end } = effectiveRange(dateMode, days, startDate, endDate);
    const blob = await generateDocxReport({
      keywords, startDate: toISODate(start), endDate: toISODate(end),
      freq, geo, flatData, cutoffDate, kwStats, fullStats,
      beforeStats: cutoffStats?.before ?? null,
      afterStats: cutoffStats?.after ?? null,
    });
    saveAs(blob, `${fileBase(keywords)}_trends_report.docx`);
  };

  /* ── Table columns ── */
  const TABLE_COLS: { key: SortField; label: string; mono?: boolean }[] = [
    { key: "keyword", label: "Keyword" },
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

  const isSingle = keywords.length === 1;

  /* ─────────────── Render ─────────────── */
  return (
    <div className="relative z-10 min-h-screen">

      {/* Header */}
      <header className="border-b border-[var(--border)] bg-[var(--bg-secondary)]/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent)] flex items-center justify-center pulse-glow">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="var(--bg-primary)" strokeWidth={2.5}>
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Trend Pulse</h1>
              <p className="text-[11px] text-[var(--text-muted)] tracking-wide uppercase">Sub-hourly Google Trends</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="accent">v3.0</Badge>
            <Badge variant="muted">gtrendsR</Badge>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* Controls */}
        <section className="animate-fade-in-up rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6" style={{ animationDelay: "100ms" }}>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">

            {/* Keywords tag-input */}
            <div className="md:col-span-5">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] font-semibold">
                  Keywords
                </label>
                <span className={`text-[11px] font-mono ${keywords.length >= MAX_KEYWORDS ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>
                  {keywords.length}/{MAX_KEYWORDS}
                </span>
              </div>
              {/* Tag pills */}
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {keywords.map((kw, i) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ background: KW_COLORS[i] + "22", color: KW_COLORS[i], border: `1px solid ${KW_COLORS[i]}55` }}
                    >
                      {kw}
                      <button
                        onClick={() => removeKeyword(kw)}
                        className="ml-0.5 hover:opacity-60 transition-opacity font-bold leading-none"
                        title="Remove"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {/* Text input */}
              <input
                type="text"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === ",") && keywordInput.trim()) {
                    e.preventDefault();
                    addKeyword(keywordInput);
                  } else if (e.key === "Backspace" && !keywordInput && keywords.length > 0) {
                    removeKeyword(keywords[keywords.length - 1]);
                  }
                }}
                onBlur={() => { if (keywordInput.trim()) addKeyword(keywordInput); }}
                disabled={keywords.length >= MAX_KEYWORDS}
                placeholder={
                  keywords.length === 0
                    ? "Type keyword, press Enter to add…"
                    : keywords.length >= MAX_KEYWORDS
                    ? "Max 30 keywords reached"
                    : "Add another keyword…"
                }
                className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors font-medium disabled:opacity-40"
              />
              <p className="text-[10px] text-[var(--text-muted)] mt-1">Enter or comma to add · Backspace to remove last</p>
            </div>

            {/* Date mode toggle */}
            <div className="md:col-span-3">
              <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-2 font-semibold">
                Time window
              </label>
              <div className="flex rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-1">
                {([{ key: "relative", label: "Last N days" }, { key: "range", label: "Date range" }] as const).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setDateMode(m.key)}
                    className={`flex-1 px-3 py-2 rounded-md text-xs font-semibold tracking-wide transition-colors ${dateMode === m.key ? "bg-[var(--accent)] text-[var(--bg-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Period inputs */}
              <div className="mt-3">
                {dateMode === "relative" ? (
                  <input
                    type="number"
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    min={1} max={365}
                    className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors font-mono"
                    placeholder="Days"
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 block">Start</label>
                      <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors font-mono text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 block">End</label>
                      <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors font-mono text-sm" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Frequency */}
            <div className="md:col-span-2">
              <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-2 font-semibold">Frequency</label>
              <select value={freq} onChange={(e) => setFreq(e.target.value as Frequency)}
                className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors cursor-pointer">
                {FREQ_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Region */}
            <div className="md:col-span-2">
              <label className="block text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-2 font-semibold">Region</label>
              <select value={geo} onChange={(e) => setGeo(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors cursor-pointer">
                {Object.entries(COUNTRIES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </div>

          </div>

          {/* Fetch button */}
          <div className="mt-4">
            <button
              onClick={handleFetch}
              disabled={loading || !keywords.length}
              className="w-full py-3 px-5 rounded-lg font-semibold text-sm tracking-wide transition-all bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-dim)] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97]"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
                  </svg>
                  Fetching {keywords.length} keyword{keywords.length > 1 ? "s" : ""}…
                </span>
              ) : (
                `Fetch Trends${keywords.length > 0 ? ` (${keywords.length} keyword${keywords.length > 1 ? "s" : ""})` : ""}`
              )}
            </button>
          </div>

          {/* Save / Saved toggle row */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {fetched && !showSaveInput && (
              <button
                onClick={() => { setSaveNameInput(keywords.slice(0, 3).join(", ").slice(0, 50)); setShowSaveInput(true); }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)] transition-colors"
              >
                💾 Save Analysis
              </button>
            )}
            {showSaveInput && (
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  value={saveNameInput}
                  onChange={(e) => setSaveNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setShowSaveInput(false); }}
                  placeholder="Analysis name…"
                  autoFocus
                  className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--accent)]/50 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors text-sm"
                />
                <button onClick={handleSave}
                  className="px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] text-sm font-semibold hover:bg-[var(--accent-dim)] transition-colors whitespace-nowrap">
                  Save
                </button>
                <button onClick={() => setShowSaveInput(false)}
                  className="px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] text-sm hover:text-[var(--danger)] hover:border-[var(--danger)]/40 transition-colors">
                  ✕
                </button>
              </div>
            )}
            {savedAnalyses.length > 0 && (
              <button
                onClick={() => setShowSaved((v) => !v)}
                className={`ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${showSaved ? "border-[var(--accent)]/40 text-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
              >
                📂 Saved ({savedAnalyses.length}) {showSaved ? "▲" : "▼"}
              </button>
            )}
          </div>

          {/* Cutoff date */}
          <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <label className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] font-semibold whitespace-nowrap">
                Analysis cutoff
              </label>
              <input
                type="date"
                value={cutoffDate}
                onChange={(e) => setCutoffDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border text-[var(--text-primary)] focus:outline-none transition-colors font-mono text-sm"
                style={{ borderColor: cutoffDate ? "#ffb347" : "var(--border)" }}
              />
              {cutoffDate && (
                <button onClick={() => setCutoffDate("")}
                  className="px-3 py-2 rounded-lg text-xs text-[var(--text-muted)] border border-[var(--border)] hover:text-[var(--danger)] hover:border-[var(--danger)]/40 transition-colors">
                  Clear
                </button>
              )}
            </div>
            {cutoffDate && <span className="text-xs font-mono" style={{ color: "#ffb347" }}>◀ Before {cutoffDate} | After ▶</span>}
          </div>

          {/* Info bar */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              {effDays} days × {freq}
            </span>
            {dateMode === "range" && (
              <span className="font-mono">{toISODate(range.start)} → {toISODate(range.end)}</span>
            )}
            <span>≈ {(estPoints * Math.max(1, keywords.length)).toLocaleString()} data points</span>
            <span className="ml-auto">Simulated data • R script exports {freq} + daily CSVs per keyword</span>
          </div>
        </section>

        {/* Saved Analyses Panel */}
        {savedAnalyses.length > 0 && showSaved && (
          <section className="animate-fade-in-up rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5" style={{ animationDelay: "150ms" }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] font-semibold">📂 Saved Analyses</span>
                <span className="text-[10px] text-[var(--text-muted)] normal-case tracking-normal">· click to restore</span>
              </div>
              <button onClick={() => setShowSaved(false)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs transition-colors">Hide ✕</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {savedAnalyses.map((saved) => (
                <div key={saved.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 hover:border-[var(--border-accent)] transition-all group flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-sm text-[var(--text-primary)] truncate leading-snug">{saved.name}</span>
                    <button
                      onClick={() => handleDeleteAnalysis(saved.id)}
                      className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors leading-none opacity-0 group-hover:opacity-100"
                      title="Delete save"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {saved.keywords.slice(0, 4).map((kw, i) => (
                      <span key={kw} className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background: KW_COLORS[i] + "22", color: KW_COLORS[i], border: `1px solid ${KW_COLORS[i]}44` }}>
                        {kw}
                      </span>
                    ))}
                    {saved.keywords.length > 4 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full text-[var(--text-muted)] border border-[var(--border)]">
                        +{saved.keywords.length - 4}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] font-mono">
                    {saved.freq} · {(COUNTRIES[saved.geo] ?? saved.geo) || "Worldwide"} · {new Date(saved.savedAt).toLocaleDateString()}
                  </div>
                  <button
                    onClick={() => handleLoadAnalysis(saved)}
                    className="mt-auto w-full py-1.5 rounded-lg text-xs font-semibold transition-colors border border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20"
                  >
                    {Object.keys(saved.dataByKeyword).length > 0 ? "⚡ Load Analysis" : "🔄 Load & Fetch"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Loading */}
        {loading && (
          <div className="space-y-4">
            <div className="h-4 w-48 rounded shimmer-loading" />
            <div className="h-[350px] rounded-2xl shimmer-loading" />
          </div>
        )}

        {/* Results */}
        {fetched && flatData.length > 0 && !loading && (
          <>
            {/* Quick stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatCard label="Data Points" value={stats!.total.toLocaleString()} sub={`${keywords.length} keyword${keywords.length > 1 ? "s" : ""} × ${freq}`} delay={0} />
              <StatCard label="Avg Interest" value={stats!.avg} sub="aggregate 0–100" delay={60} />
              <StatCard label="Peak" value={stats!.max} sub={stats!.maxRow?.keyword} delay={120} />
              <StatCard label="Low" value={stats!.min} sub="minimum observed" delay={180} />
              <StatCard label="Region" value={geo || "🌍"} sub={COUNTRIES[geo] || "Worldwide"} delay={240} />
            </div>

            {/* Descriptive stats panel */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <div className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] mb-4 font-semibold">
                Descriptive Statistics — Interest (0–100)
              </div>
              {isSingle ? (
                /* Single keyword: 8-metric grid */
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3">
                  {fullStats && [
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
              ) : (
                /* Multi-keyword: comparison table */
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        {["Keyword", "N", "Mean", "Median", "Std Dev", "Variance", "Skewness", "Kurtosis", "Min", "Max"].map((h) => (
                          <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-widest text-[var(--text-muted)] font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {keywords.map((kw, i) => {
                        const s = kwStats[kw];
                        if (!s) return null;
                        return (
                          <tr key={kw} className="border-b border-[var(--border)]/40 hover:bg-[var(--bg-card-hover)] transition-colors">
                            <td className="px-3 py-2 font-medium whitespace-nowrap" style={{ color: KW_COLORS[i] }}>
                              <span className="inline-flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: KW_COLORS[i] }} />
                                {kw}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{s.n.toLocaleString()}</td>
                            <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{s.mean.toFixed(2)}</td>
                            <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{s.median.toFixed(2)}</td>
                            <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{s.stdDev.toFixed(3)}</td>
                            <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{s.variance.toFixed(2)}</td>
                            <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{s.skewness.toFixed(4)}</td>
                            <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{s.kurtosis.toFixed(4)}</td>
                            <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{s.min}</td>
                            <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{s.max}</td>
                          </tr>
                        );
                      })}
                      {/* Aggregate row */}
                      {fullStats && (
                        <tr className="border-t-2 border-[var(--border-accent)] bg-[var(--bg-secondary)]">
                          <td className="px-3 py-2 font-semibold text-[var(--text-primary)] text-[11px] uppercase tracking-wider">All combined</td>
                          <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">{fullStats.n.toLocaleString()}</td>
                          <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">{fullStats.mean.toFixed(2)}</td>
                          <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">{fullStats.median.toFixed(2)}</td>
                          <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">{fullStats.stdDev.toFixed(3)}</td>
                          <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">{fullStats.variance.toFixed(2)}</td>
                          <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">{fullStats.skewness.toFixed(4)}</td>
                          <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">{fullStats.kurtosis.toFixed(4)}</td>
                          <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">{fullStats.min}</td>
                          <td className="px-3 py-2 font-mono font-bold text-[var(--accent)]">{fullStats.max}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-[var(--border)]">
              {([
                { key: "chart", label: "Chart", icon: "📈" },
                { key: "table", label: "Data Table", icon: "📊" },
                { key: "exports", label: "Exports", icon: "📦" },
              ] as const).map((tab) => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={`px-5 py-3 text-sm font-medium tracking-wide transition-colors border-b-2 -mb-px ${activeTab === tab.key ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* Chart tab */}
            {activeTab === "chart" && (
              <>
                <div className="animate-fade-in-up rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6" style={{ animationDelay: "80ms" }}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-widest">
                      Interest Over Time — {keywords.join(", ")}
                    </h3>
                    {cutoffXValue && (
                      <span className="text-xs font-mono px-2 py-1 rounded-full border" style={{ color: "#ffb347", borderColor: "#ffb347", background: "#ffb34711" }}>
                        Cutoff: {cutoffDate}
                      </span>
                    )}
                  </div>

                  <div className="h-[420px]">
                    <ResponsiveContainer width="100%" height="100%">
                      {isSingle ? (
                        /* Single keyword — AreaChart */
                        <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                          <defs>
                            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={KW_COLORS[0]} stopOpacity={0.35} />
                              <stop offset="100%" stopColor={KW_COLORS[0]} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                          <XAxis dataKey="datetime" tickFormatter={formatAxisDate} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={60} />
                          <YAxis domain={[0, 100]} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={35} />
                          <Tooltip content={<CustomTooltip />} />
                          {cutoffXValue && <ReferenceArea x1={cutoffXValue} fill="#7c5cff" fillOpacity={0.07} />}
                          <Area type="monotone" dataKey={keywords[0]} stroke={KW_COLORS[0]} strokeWidth={1.5} fill="url(#areaGrad)" dot={false} activeDot={{ r: 4, fill: KW_COLORS[0], stroke: "var(--bg-primary)", strokeWidth: 2 }} />
                          {cutoffXValue && <ReferenceLine x={cutoffXValue} stroke="#ffb347" strokeWidth={2} strokeDasharray="6 3" label={{ value: cutoffDate, position: "insideTopRight", fill: "#ffb347", fontSize: 10, fontFamily: "monospace" }} />}
                          <Brush dataKey="datetime" height={28} stroke="var(--border-accent)" fill="var(--bg-secondary)" tickFormatter={formatAxisDate} />
                        </AreaChart>
                      ) : (
                        /* Multiple keywords — LineChart with Legend */
                        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                          <XAxis dataKey="datetime" tickFormatter={formatAxisDate} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={60} />
                          <YAxis domain={[0, 100]} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={35} />
                          <Tooltip content={<CustomTooltip />} />
                          {cutoffXValue && <ReferenceArea x1={cutoffXValue} fill="#7c5cff" fillOpacity={0.07} />}
                          {keywords.map((kw, i) => (
                            <Line key={kw} type="monotone" dataKey={kw} stroke={KW_COLORS[i]} strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: KW_COLORS[i], strokeWidth: 0 }} />
                          ))}
                          {cutoffXValue && <ReferenceLine x={cutoffXValue} stroke="#ffb347" strokeWidth={2} strokeDasharray="6 3" label={{ value: cutoffDate, position: "insideTopRight", fill: "#ffb347", fontSize: 10, fontFamily: "monospace" }} />}
                          {keywords.length <= 15 && <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />}
                          <Brush dataKey="datetime" height={28} stroke="var(--border-accent)" fill="var(--bg-secondary)" tickFormatter={formatAxisDate} />
                        </LineChart>
                      )}
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
                      <div key={label} className="rounded-2xl border bg-[var(--bg-card)] p-5" style={{ borderColor: color + "55" }}>
                        <div className="flex items-center gap-2 mb-4">
                          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color }}>{label}</span>
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

            {/* Table tab */}
            {activeTab === "table" && (
              <div className="animate-fade-in-up rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden" style={{ animationDelay: "80ms" }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        {TABLE_COLS.map((col) => (
                          <th key={col.key} onClick={() => handleSort(col.key)}
                            className="px-3 py-3 text-left text-[10px] uppercase tracking-widest text-[var(--text-muted)] font-semibold cursor-pointer hover:text-[var(--accent)] transition-colors whitespace-nowrap select-none">
                            {col.label}
                            {sortField === col.key && <span className="ml-1 text-[var(--accent)]">{sortDir === "asc" ? "↑" : "↓"}</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedData.map((row, i) => {
                        const kwIdx = keywords.indexOf(row.keyword);
                        const kwColor = KW_COLORS[kwIdx >= 0 ? kwIdx : 0];
                        return (
                          <tr key={i} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-card-hover)] transition-colors">
                            {TABLE_COLS.map((col) => (
                              <td key={col.key} className={`px-3 py-2.5 whitespace-nowrap ${col.mono ? "font-mono text-xs" : "text-sm"} ${col.key === "hits" ? "font-bold" : "text-[var(--text-secondary)]"}`}
                                style={col.key === "keyword" ? { color: kwColor, fontWeight: 600 } : col.key === "hits" ? { color: kwColor } : undefined}>
                                {col.key === "weekend" ? (row.weekend ? "✓" : "") : String(row[col.key])}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
                  <span className="text-xs text-[var(--text-muted)]">
                    {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sortedData.length)} of {sortedData.length.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                      className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                      ← Prev
                    </button>
                    <span className="text-xs text-[var(--text-muted)] font-mono">{page + 1}/{totalPages}</span>
                    <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                      className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                      Next →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Exports tab */}
            {activeTab === "exports" && (
              <div className="animate-fade-in-up grid grid-cols-1 md:grid-cols-2 gap-4" style={{ animationDelay: "80ms" }}>
                {[
                  { title: "CSV", desc: `All keywords in one file with keyword column. ${flatData.length.toLocaleString()} rows.`, icon: "📄", ext: ".csv", handler: exportCSV, color: "var(--accent)" },
                  { title: "Excel", desc: `Combined sheet + one sheet per keyword. ${keywords.length} keyword sheet${keywords.length > 1 ? "s" : ""}.`, icon: "📊", ext: ".xlsx", handler: exportExcel, color: "#4CAF50" },
                  { title: "R Script", desc: `gtrendsR loop for all ${keywords.length} keyword${keywords.length > 1 ? "s" : ""} — writes intraday (${freq}) + daily CSVs per keyword plus combined daily.`, icon: "📐", ext: ".R", handler: exportRScript, color: "#2196F3" },
                  { title: "Stata", desc: "CSV + .do file with tsset, moving averages, and plots (first keyword).", icon: "📈", ext: ".do + .csv", handler: exportStata, color: "#FF9800" },
                  { title: "Word Report", desc: `Full .docx report: ${keywords.length} keyword${keywords.length > 1 ? "s" : ""}, collection process, timeline, per-keyword stats (mean, median, variance, skewness, kurtosis), and cutoff comparison if set.`, icon: "📝", ext: ".docx", handler: exportDocx, color: "#2B579A" },
                ].map((exp) => (
                  <button key={exp.title} onClick={exp.handler}
                    className="group text-left rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 hover:border-[var(--border-accent)] hover:bg-[var(--bg-card-hover)] transition-all active:scale-[0.98]">
                    <div className="flex items-start gap-4">
                      <span className="text-3xl">{exp.icon}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-[var(--text-primary)]">{exp.title}</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border" style={{ color: exp.color, borderColor: exp.color + "44", background: exp.color + "11" }}>{exp.ext}</span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] leading-relaxed">{exp.desc}</p>
                      </div>
                      <span className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors text-lg">↓</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!fetched && !loading && (
          <div className="animate-fade-in-up text-center py-24" style={{ animationDelay: "200ms" }}>
            <div className="text-6xl mb-6 opacity-20">📈</div>
            <h2 className="text-xl font-semibold text-[var(--text-secondary)] mb-2">Add keywords to begin</h2>
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
              Type a keyword and press <kbd className="px-1.5 py-0.5 rounded text-xs bg-[var(--bg-secondary)] border border-[var(--border)]">Enter</kbd> to add it.
              Add up to 30 keywords for side-by-side comparison.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 text-xs">
              {["Bitcoin", "Ethereum", "ChatGPT", "Climate Change", "Taylor Swift", "Dogecoin"].map((s) => (
                <button key={s} onClick={() => addKeyword(s)}
                  className="px-4 py-2 rounded-full border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40 transition-colors">
                  + {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-6 mt-16">
        <div className="max-w-7xl mx-auto px-6 flex flex-wrap items-center justify-between text-xs text-[var(--text-muted)]">
          <span>
            Trend Pulse by{" "}
            <a href="https://github.com/AliAwaisKhalid" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
              Ali Awais Khalid
            </a>
          </span>
          <span>MIT License • 2026</span>
        </div>
      </footer>
    </div>
  );
}
