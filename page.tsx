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
} from "recharts";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";

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
  days: number,
  freq: Frequency,
  _geo: string
): TrendRow[] {
  const rows: TrendRow[] = [];
  const now = new Date();
  const start = new Date(now.getTime() - days * 86400000);
  const stepMs = freqMinutes(freq) * 60000;
  const totalSteps = Math.floor((days * 86400000) / stepMs);

  // Simulate realistic-looking trend data with patterns
  const seed = keyword.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  let base = 30 + (seed % 40);
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

function formatAxisDate(val: string) {
  if (!val) return "";
  const parts = val.split(" ");
  if (parts.length < 2) return val;
  return `${parts[0].slice(5)} ${parts[1]}`;
}

/* ─────────── R Script Generator ─────────── */
function generateRScript(
  keyword: string,
  days: number,
  freq: Frequency,
  geo: string
): string {
  const fMin = freqMinutes(freq);
  return `# ══════════════════════════════════════════════════
# Trend Pulse — gtrendsR Loop Script
# Keyword: "${keyword}" | Days: ${days} | Freq: ${freq} | Geo: ${geo || "worldwide"}
# ══════════════════════════════════════════════════

library(gtrendsR)
library(dplyr)
library(lubridate)

keyword   <- "${keyword}"
days      <- ${days}
geo       <- ${geo ? `"${geo}"` : "NULL"}
freq_min  <- ${fMin}

end_date   <- Sys.Date()
start_date <- end_date - days

# ── Build 24h windows with 4h overlap ──
windows <- list()
d <- start_date
while (d < end_date) {
  w_start <- d
  w_end   <- min(d + 1, end_date)
  windows[[length(windows) + 1]] <- c(w_start, w_end)
  d <- d + hours(20)  # 4h overlap
}

cat(sprintf("Total windows: %d\\n", length(windows)))

# ── Fetch each window ──
all_data <- data.frame()
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
      all_data <- bind_rows(all_data, iot)
    }
  }, error = function(e) {
    cat(sprintf("  ERROR: %s\\n", e$message))
  })

  Sys.sleep(runif(1, 1.5, 3.5))  # Rate limiting
}

# ── Normalize overlaps ──
all_data <- all_data %>%
  group_by(date) %>%
  summarise(hits = mean(hits, na.rm = TRUE)) %>%
  ungroup() %>%
  arrange(date)

# Global normalize to 0-100
max_hits <- max(all_data$hits, na.rm = TRUE)
if (max_hits > 0) all_data$hits <- round(all_data$hits / max_hits * 100)

# ── Aggregate to desired frequency ──
all_data <- all_data %>%
  mutate(
    bucket = floor_date(date, unit = paste0(freq_min, " mins"))
  ) %>%
  group_by(bucket) %>%
  summarise(hits = round(mean(hits, na.rm = TRUE))) %>%
  rename(datetime = bucket) %>%
  ungroup()

# ── Extract time components ──
all_data <- all_data %>%
  mutate(
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

# ── Export ──
write.csv(all_data, "${keyword.replace(/\s+/g, "_")}_trends.csv", row.names = FALSE)
cat(sprintf("\\nDone! %d rows exported.\\n", nrow(all_data)))
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
  const [freq, setFreq] = useState<Frequency>("30min");
  const [geo, setGeo] = useState("");
  const [data, setData] = useState<TrendRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

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
      const result = generateSimulatedData(keyword, days, freq, geo);
      setData(result);
      setLoading(false);
      setFetched(true);
      setPage(0);
      setActiveTab("chart");
    }, 1800);
  }, [keyword, days, freq, geo]);

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

  const stats = useMemo(() => {
    if (!data.length) return null;
    const hits = data.map((d) => d.hits);
    const avg = hits.reduce((a, b) => a + b, 0) / hits.length;
    const max = Math.max(...hits);
    const min = Math.min(...hits);
    const maxRow = data.find((d) => d.hits === max);
    return { avg: avg.toFixed(1), max, min, maxRow, total: data.length };
  }, [data]);

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
    const script = generateRScript(keyword, days, freq, geo);
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
            <div className="md:col-span-4">
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

            {/* Days */}
            <div className="md:col-span-2">
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

            {/* Frequency */}
            <div className="md:col-span-2">
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
            <div className="md:col-span-2">
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
            <div className="md:col-span-2">
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

          {/* Info bar */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              {days} days × {freq} intervals
            </span>
            <span>
              ≈{" "}
              {Math.floor(
                (days * 1440) / freqMinutes(freq)
              ).toLocaleString()}{" "}
              data points
            </span>
            <span className="ml-auto text-[var(--text-muted)]">
              Simulated data • Use exported R script for real Google Trends
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
              <div
                className="animate-fade-in-up rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6"
                style={{ animationDelay: "80ms" }}
              >
                <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4 uppercase tracking-widest">
                  Interest Over Time — &ldquo;{keyword}&rdquo;
                </h3>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={data}
                      margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                    >
                      <defs>
                        <linearGradient
                          id="areaGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="var(--accent)"
                            stopOpacity={0.35}
                          />
                          <stop
                            offset="100%"
                            stopColor="var(--accent)"
                            stopOpacity={0}
                          />
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
                      <Area
                        type="monotone"
                        dataKey="hits"
                        stroke="var(--accent)"
                        strokeWidth={1.5}
                        fill="url(#areaGrad)"
                        dot={false}
                        activeDot={{
                          r: 4,
                          fill: "var(--accent)",
                          stroke: "var(--bg-primary)",
                          strokeWidth: 2,
                        }}
                      />
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
                    desc: "Complete gtrendsR loop with rate limiting, overlap normalization, and time extraction.",
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
