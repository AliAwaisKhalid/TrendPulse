import { useState, useMemo, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from "recharts";

// ─── Config ────────────────────────────────────────────────────────────────────
const FREQ = [
  { label: "1 min", value: "1min", ms: 60000 },
  { label: "5 min", value: "5min", ms: 300000 },
  { label: "15 min", value: "15min", ms: 900000 },
  { label: "30 min", value: "30min", ms: 1800000 },
  { label: "1 hour", value: "1h", ms: 3600000 },
  { label: "4 hours", value: "4h", ms: 14400000 },
  { label: "Daily", value: "1d", ms: 86400000 },
  { label: "Weekly", value: "1w", ms: 604800000 },
];
const TLS = [
  { label: "Past 4 Hours", value: "now 4-H", days: 0.167, wH: 4 },
  { label: "Past 1 Day", value: "now 1-d", days: 1, wH: 4 },
  { label: "Past 7 Days", value: "now 7-d", days: 7, wH: 24 },
  { label: "Past 30 Days", value: "today 1-m", days: 30, wH: 24 },
  { label: "Past 90 Days", value: "today 3-m", days: 90, wH: 24 },
  { label: "Past 12 Months", value: "today 12-m", days: 365, wH: 168 },
];
const PAL = ["#ef4444","#3b82f6","#10b981","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#f97316","#6366f1","#14b8a6",
  "#f43f5e","#0ea5e9","#22c55e","#eab308","#a855f7","#d946ef","#0891b2","#ea580c","#4f46e5","#059669"];
const PCA_COLOR = "#fbbf24"; // Gold for PCA index
const pad = n => String(n).padStart(2, "0");

// ─── PCA Implementation ────────────────────────────────────────────────────────
// Computes first principal component from keyword columns to create a composite index
function computePCA(data, kws) {
  if (!data.length || kws.length < 2) return data;

  const n = data.length, p = kws.length;

  // Step 1: Extract matrix & compute means/stds
  const means = kws.map(k => {
    const vals = data.map(d => d[k] || 0);
    return vals.reduce((a, b) => a + b, 0) / n;
  });
  const stds = kws.map((k, i) => {
    const vals = data.map(d => d[k] || 0);
    const variance = vals.reduce((a, v) => a + (v - means[i]) ** 2, 0) / (n - 1);
    return Math.sqrt(variance) || 1; // Avoid division by zero
  });

  // Step 2: Standardize (z-scores)
  const Z = data.map(d => kws.map((k, i) => ((d[k] || 0) - means[i]) / stds[i]));

  // Step 3: Correlation matrix (Z'Z / (n-1))
  const C = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let s = 0;
      for (let r = 0; r < n; r++) s += Z[r][i] * Z[r][j];
      C[i][j] = C[j][i] = s / (n - 1);
    }
  }

  // Step 4: Power iteration to find first eigenvector (PC1)
  let v = Array(p).fill(1 / Math.sqrt(p)); // Initial guess
  for (let iter = 0; iter < 100; iter++) {
    // Multiply C * v
    const Cv = Array(p).fill(0);
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) Cv[i] += C[i][j] * v[j];
    }
    // Normalize
    const norm = Math.sqrt(Cv.reduce((a, x) => a + x * x, 0));
    if (norm === 0) break;
    const vNew = Cv.map(x => x / norm);
    // Check convergence
    const diff = v.reduce((a, x, i) => a + Math.abs(x - vNew[i]), 0);
    v = vNew;
    if (diff < 1e-10) break;
  }

  // Step 5: Compute eigenvalue (variance explained)
  const Cv = Array(p).fill(0);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) Cv[i] += C[i][j] * v[j];
  }
  const eigenvalue = v.reduce((a, x, i) => a + x * Cv[i], 0);
  const totalVariance = p; // Sum of eigenvalues of correlation matrix = p
  const varianceExplained = (eigenvalue / totalVariance * 100).toFixed(1);

  // Step 6: Project data onto PC1 & rescale to 0-100
  const scores = Z.map(row => row.reduce((a, x, i) => a + x * v[i], 0));
  const minS = Math.min(...scores), maxS = Math.max(...scores);
  const range = maxS - minS || 1;

  // Step 7: Add PCA index to data
  const result = data.map((d, idx) => ({
    ...d,
    pca_index: Math.round(((scores[idx] - minS) / range) * 100),
  }));

  return {
    data: result,
    loadings: v,
    varianceExplained: parseFloat(varianceExplained),
    eigenvalue,
    means,
    stds,
  };
}

// ─── Data engine ───────────────────────────────────────────────────────────────
function simWin(kws, s, e) {
  const h = (e - s) / 36e5, step = h <= 4 ? 1 : h <= 24 ? 8 : 60;
  const n = Math.floor((e - s) / (step * 6e4));
  const seeds = kws.map((_, i) => 35 + Math.sin(i * 3.1) * 18 + Math.random() * 12);
  const dr = kws.map(() => (Math.random() - 0.5) * 0.08);
  const out = [];
  for (let i = 0; i < n; i++) {
    const ts = s + i * step * 6e4, d = new Date(ts);
    // ALL timestamps in UTC
    const r = {
      timestamp: d.toISOString().replace(".000Z", "Z"),
      ts,
    };
    const wf = (d.getUTCDay() === 0 || d.getUTCDay() === 6) ? 0.65 : 1;
    const hf = 0.4 + 0.6 * Math.max(0, Math.sin((d.getUTCHours() - 5) * Math.PI / 14));
    kws.forEach((k, ki) => {
      r[k] = Math.max(0, Math.min(100, Math.round((seeds[ki] + dr[ki] * i) * wf * hf + (Math.random() - 0.5) * 15 + Math.sin(i / (n / 4)) * 8)));
    });
    out.push(r);
  }
  return out;
}

function aggregate(data, kws, bMs) {
  if (!data.length) return [];
  const bk = new Map();
  data.forEach(r => {
    const t = r.ts || new Date(r.timestamp).getTime();
    const k = Math.floor(t / bMs) * bMs;
    if (!bk.has(k)) bk.set(k, []);
    bk.get(k).push(r);
  });
  return [...bk.keys()].sort((a, b) => a - b).map((key, idx) => {
    const rows = bk.get(key), d = new Date(key);
    // ALL time extraction in UTC (Coordinated Universal Time)
    const yr = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, dy = d.getUTCDate();
    const hr = d.getUTCHours(), mn = d.getUTCMinutes(), di2 = d.getUTCDay();
    const utcDateStr = `${yr}-${pad(mo)}-${pad(dy)}`;
    const utcTimeStr = `${pad(hr)}:${pad(mn)}`;
    const utcTimestamp = `${utcDateStr}T${utcTimeStr}:00Z`;
    const r = {
      timestamp: utcTimestamp,
      ts: key, index: idx,
      // UTC date components
      year: yr, month: mo, day: dy,
      hour: hr, minute: mn,
      date_str: utcDateStr,
      time_str: utcTimeStr,
      utc_time: utcTimeStr,
      utc_datetime: utcTimestamp,
      dow: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][di2],
      dow_num: di2,
      month_name: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()],
      chartLabel: `${pad(mo)}/${pad(dy)} ${utcTimeStr} UTC`,
      timezone: "UTC",
    };
    kws.forEach(kw => {
      const v = rows.map(x => x[kw]).filter(x => x !== undefined);
      r[kw] = v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
    });
    return r;
  });
}

function stitchChunks(chunks, kws) {
  if (chunks.length <= 1) return chunks[0] || [];
  let out = [...chunks[0]];
  for (let c = 1; c < chunks.length; c++) {
    const p = chunks[c - 1], cu = chunks[c];
    if (!p.length || !cu.length) continue;
    const pe = p[p.length - 1].ts, os = pe - 36e5;
    const po = p.filter(r => r.ts >= os), co = cu.filter(r => r.ts <= pe);
    const sc = {};
    kws.forEach(k => {
      const pa = po.reduce((s, r) => s + (r[k] || 0), 0) / (po.length || 1);
      const ca = co.reduce((s, r) => s + (r[k] || 0), 0) / (co.length || 1);
      sc[k] = ca > 0 ? pa / ca : 1;
    });
    cu.filter(r => r.ts > pe).forEach(r => {
      const s = { ...r };
      kws.forEach(k => { s[k] = Math.max(0, Math.min(100, Math.round((r[k] || 0) * sc[k]))); });
      out.push(s);
    });
  }
  return out;
}

// ─── Script generators (R + Stata) ─────────────────────────────────────────────
function genR(kws, tl, fr, geo) {
  const t = TLS.find(x => x.value === tl), f = FREQ.find(x => x.value === fr);
  const oH = Math.max(1, Math.floor(t.wH / 6)), sH = t.wH - oH, nW = Math.ceil(t.days * 24 / sH);
  return `# Google Trends — gtrendsR Loop Aggregation
# Keywords: ${kws.join(", ")} | Geo: ${geo} | ${t.label} | ${f.label}
# Windows: ${nW} × ${t.wH}h (overlap ${oH}h)

if (!require("gtrendsR")) install.packages("gtrendsR")
if (!require("dplyr")) install.packages("dplyr")
if (!require("tidyr")) install.packages("tidyr")
if (!require("lubridate")) install.packages("lubridate")
if (!require("readr")) install.packages("readr")
library(gtrendsR); library(dplyr); library(tidyr); library(lubridate); library(readr)

keywords <- c(${kws.map(k => `"${k}"`).join(", ")})
geo <- "${geo}"; window_hours <- ${t.wH}; overlap_h <- ${oH}
step_h <- window_hours - overlap_h; total_days <- ${t.days}; freq_min <- ${f.ms / 6e4}

end_time <- Sys.time()
start_time <- end_time - days(total_days)
n_windows <- ceiling(as.numeric(difftime(end_time, start_time, units="hours")) / step_h)
cat(sprintf("Fetching %d days in %d windows of %dh\\n", total_days, n_windows, window_hours))

all_data <- data.frame()
for (i in 1:n_windows) {
  w_end <- end_time - hours((i - 1) * step_h)
  w_start <- w_end - hours(window_hours)
  time_str <- paste(format(w_start, "%Y-%m-%dT%H"), format(w_end, "%Y-%m-%dT%H"))
  cat(sprintf("  [%d/%d] time=\\"%s\\" ... ", i, n_windows, time_str))
  tryCatch({
    res <- gtrends(keyword=keywords, geo=geo, time=time_str, onlyInterest=TRUE)
    if (!is.null(res$interest_over_time) && nrow(res$interest_over_time) > 0) {
      df <- res$interest_over_time %>%
        mutate(date=as.POSIXct(date), hits=as.numeric(ifelse(hits=="<1",0.5,hits))) %>%
        select(date, keyword, hits)
      all_data <- bind_rows(all_data, df)
      cat(sprintf("%d rows\\n", nrow(df)))
    } else { cat("no data\\n") }
  }, error=function(e) cat(sprintf("ERROR: %s\\n", e$message)))
  if (i < n_windows) { Sys.sleep(sample(4:8, 1)) }
}
cat(sprintf("\\nTotal raw: %d rows\\n", nrow(all_data)))

trends <- all_data %>% distinct(date, keyword, .keep_all=TRUE) %>%
  pivot_wider(names_from=keyword, values_from=hits) %>% arrange(date)

# Rename columns: pivot_wider uses keyword as column name (not "hits")
# make.names() may mangle names (e.g. "bitcoin price" → "bitcoin.price")
# Ensure clean column names for R compatibility
kw_clean <- make.names(keywords)
cat(sprintf("Columns after pivot: %s\\n", paste(names(trends), collapse=", ")))

trends <- trends %>% group_by(date) %>%
  summarise(across(everything(), ~mean(.x, na.rm=TRUE))) %>% ungroup() %>% arrange(date)

# Rescale each keyword column to 0-100
for (kw in keywords) {
  col <- make.names(kw)
  if (col %in% names(trends)) {
    mx <- max(trends[[col]], na.rm=TRUE)
    if (mx > 0) trends[[col]] <- round(trends[[col]] / mx * 100, 1)
  }
}

# Rename columns from make.names to clean keyword names for export
for (i in seq_along(keywords)) {
  old_name <- make.names(keywords[i])
  new_name <- gsub("[^a-zA-Z0-9_]", "_", keywords[i])  # Clean for Stata/CSV
  if (old_name %in% names(trends) && old_name != new_name) {
    names(trends)[names(trends) == old_name] <- new_name
  }
}
cat(sprintf("Final keyword columns: %s\\n", paste(setdiff(names(trends), "date"), collapse=", ")))
trends <- trends %>% mutate(bucket=floor_date(date, unit=paste0(freq_min, " mins"))) %>%
  group_by(bucket) %>% summarise(across(-date, ~mean(.x, na.rm=TRUE))) %>%
  ungroup() %>% rename(utc_datetime=bucket)

# Force UTC timezone for all datetime operations
attr(trends$utc_datetime, "tzone") <- "UTC"

trends <- trends %>% mutate(
  date=as.Date(utc_datetime),
  year=year(utc_datetime), month=month(utc_datetime),
  month_name=as.character(month(utc_datetime, label=TRUE, abbr=TRUE)),
  day=day(utc_datetime),
  hour=hour(utc_datetime), minute=minute(utc_datetime),
  utc_time=sprintf("%02d:%02d", hour, minute),
  dow=as.character(wday(utc_datetime, label=TRUE, abbr=TRUE)),
  dow_num=wday(utc_datetime)-1, quarter=quarter(utc_datetime),
  weekend=ifelse(dow_num %in% c(0,6), 1, 0),
  timezone="UTC"
)
meta <- c("utc_datetime","date","utc_time","year","month","month_name","day","hour","minute",
          "dow","dow_num","weekend","quarter","timezone")
trends <- trends %>% select(all_of(c(meta, setdiff(names(trends), meta))))
cat(sprintf("\\nTimezone: UTC (Coordinated Universal Time)"))
cat(sprintf("\\nDone! %d obs | %s to %s\\n", nrow(trends), min(trends$utc_datetime), max(trends$utc_datetime)))

# ── PCA INDEX (Principal Component Analysis) ──
kw_cols_final <- intersect(c(gsub("[^a-zA-Z0-9_]", "_", keywords), make.names(keywords)), names(trends))
if (length(kw_cols_final) >= 2) {
  cat("\\nComputing PCA index from keyword columns...\\n")
  
  # Standardize keyword columns (z-scores)
  kw_matrix <- as.matrix(trends[kw_cols_final])
  kw_scaled <- scale(kw_matrix)  # mean=0, sd=1
  
  # PCA via prcomp
  pca_result <- prcomp(kw_scaled, center=FALSE, scale.=FALSE)
  
  # PC1 scores → rescale to 0-100
  pc1_scores <- pca_result$x[, 1]
  trends$pca_index <- round((pc1_scores - min(pc1_scores)) / (max(pc1_scores) - min(pc1_scores)) * 100)
  
  # Report
  var_explained <- summary(pca_result)$importance[2, 1] * 100
  cat(sprintf("  PC1 variance explained: %.1f%%\\n", var_explained))
  cat(sprintf("  PC1 loadings:\\n"))
  loadings <- pca_result$rotation[, 1]
  for (j in seq_along(kw_cols_final)) {
    cat(sprintf("    %s: %.4f\\n", kw_cols_final[j], loadings[j]))
  }
  cat(sprintf("  PCA index range: %d to %d\\n", min(trends$pca_index), max(trends$pca_index)))
  
  # Save PCA loadings
  loadings_df <- data.frame(keyword=kw_cols_final, pc1_loading=loadings, row.names=NULL)
  write_csv(loadings_df, "pca_loadings_${f.value}_${t.days}d.csv")
  cat("  Saved: pca_loadings_${f.value}_${t.days}d.csv\\n")
} else {
  cat("\\nSkipping PCA: need >= 2 keywords\\n")
}

write_csv(trends, "google_trends_${f.value}_${t.days}d.csv")
if (require("writexl")) writexl::write_xlsx(trends, "google_trends_${f.value}_${t.days}d.xlsx")
`;
}

function genDo(kws, tl, fr) {
  const t = TLS.find(x => x.value === tl), f = FREQ.find(x => x.value === fr);
  const ck = kws.map(k => k.replace(/[^a-zA-Z0-9_]/g, "_").substring(0, 32));
  const fn = `google_trends_${f.value}_${t.days}d`, dm = f.ms * 60;
  return `* Stata Import: Google Trends (gtrendsR) — UTC Time Zone
* Keywords: ${kws.join(", ")} | ${t.label} | ${f.label}
* All timestamps are in UTC (Coordinated Universal Time)

clear all
set more off
set type double

import delimited "${fn}.csv", varnames(1) clear encoding("utf-8")

* ── UTC DATETIME (%tc = ms since 01jan1960 00:00:00) ──
* All times are in UTC (Coordinated Universal Time)
gen double stata_dt = clock(utc_datetime, "YMDhms#")
format stata_dt %tcCCYY-NN-DD_HH:MM:SS
label variable stata_dt "UTC Datetime (%tc)"
note stata_dt: "Coordinated Universal Time (UTC)"

gen stata_date = dofc(stata_dt)
format stata_date %td
label variable stata_date "UTC Date (%td)"

* ── UTC TIME COMPONENTS (from Stata %tc — authoritative) ──
* All hour/minute values are in UTC

capture drop year
gen year = year(dofc(stata_dt))
label variable year "Year (UTC)"

capture drop month
gen month = month(dofc(stata_dt))
label variable month "Month 1-12 (UTC)"
label define mlbl 1 "Jan" 2 "Feb" 3 "Mar" 4 "Apr" 5 "May" 6 "Jun" ///
  7 "Jul" 8 "Aug" 9 "Sep" 10 "Oct" 11 "Nov" 12 "Dec"
gen month_lab = month
label values month_lab mlbl

capture drop day
gen day = day(dofc(stata_dt))
label variable day "Day 1-31 (UTC)"

capture drop hour
gen hour = hh(stata_dt)
label variable hour "Hour 0-23 (UTC)"

capture drop minute
gen minute = mm(stata_dt)
label variable minute "Minute 0-59 (UTC)"

* UTC time as clock format (%tcHH:MM)
gen double utc_clock = (hour * 3600 + minute * 60) * 1000
format utc_clock %tcHH:MM
label variable utc_clock "UTC Time of Day (%tcHH:MM)"

* UTC time as numeric HHMM (e.g. 0930 = 09:30 UTC, 1430 = 14:30 UTC)
gen utc_hhmm = hour * 100 + minute
label variable utc_hhmm "UTC Time as HHMM numeric"

capture drop dow_num
gen dow_num = dow(dofc(stata_dt))
label define dlbl 0 "Sun" 1 "Mon" 2 "Tue" 3 "Wed" 4 "Thu" 5 "Fri" 6 "Sat"
label values dow_num dlbl

capture drop quarter
gen quarter = quarter(dofc(stata_dt))

capture drop weekend
gen weekend = (dow_num == 0 | dow_num == 6)
label define ynlbl 0 "No" 1 "Yes"
label values weekend ynlbl

* Timezone indicator variable
gen str3 tz = "UTC"
label variable tz "Time Zone"

* ── KEYWORD VARIABLES (named after keywords, not "hits") ──
${ck.map((v, i) => `capture destring ${v}, replace force
label variable ${v} "Google Trends Index: ${kws[i]}"
note ${v}: "Search interest (0-100) for keyword: ${kws[i]}"`).join("\n")}

* ── ORDER & CLEANUP ──
order stata_dt stata_date year month month_lab day ///
  hour minute utc_clock utc_hhmm dow_num weekend quarter tz ${ck.join(" ")}
capture drop utc_datetime date utc_time dow month_name timezone v*

* ── TIME SERIES ──
tsset stata_dt, delta(${f.ms})

* ── ANALYSIS ──
summarize ${ck.join(" ")}, detail
table dow_num, stat(mean ${ck.join(" ")}) nformat(%6.1f)
table hour, stat(mean ${ck.join(" ")}) nformat(%6.1f)
${kws.length > 1 ? `correlate ${ck.join(" ")}` : ""}

${ck.map(v => `capture tssmooth ma ${v}_ma7 = ${v}, window(7)`).join("\n")}

* ── PCA INDEX (Principal Component Analysis) ──
${kws.length >= 2 ? `* Construct composite index from keyword search interest using PCA
* Step 1: Standardize keyword variables (z-scores)
${ck.map(v => `egen ${v}_z = std(${v})`).join("\n")}

* Step 2: Run PCA on standardized variables
pca ${ck.map(v => `${v}_z`).join(" ")}

* Step 3: Extract PC1 scores
predict pca_raw, score
label variable pca_raw "PC1 raw score"

* Step 4: Rescale to 0-100
summarize pca_raw, meanonly
gen pca_index = round((pca_raw - r(min)) / (r(max) - r(min)) * 100)
label variable pca_index "PCA Composite Index (0-100)"
note pca_index: "First principal component of ${kws.join(", ")} (standardized, rescaled 0-100)"

* Step 5: Report variance explained
estat loadings
di _n "PCA Index constructed from ${kws.length} keywords"
di "Higher values = greater combined search interest"

* Cleanup z-score variables
${ck.map(v => `drop ${v}_z`).join("\n")}
drop pca_raw
` : `* PCA skipped: need >= 2 keywords`}

compress
save "${fn}.dta", replace

di _n "{hline 60}"
di "  Saved: ${fn}.dta | Obs: " _N
di "  " %td stata_date[1] " to " %td stata_date[_N]
di "{hline 60}"
`;
}

// ─── Custom Tooltip ────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: "10px 14px", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
      <div style={{ color: "#888", marginBottom: 6, fontSize: 10 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, display: "flex", justifyContent: "space-between", gap: 20, padding: "2px 0" }}>
          <span>{p.name}</span><span style={{ fontWeight: 600 }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Paginated Table ───────────────────────────────────────────────────────────
function DataTable({ data, kws, pageSize = 30 }) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ col: "index", dir: "desc" });
  
  const sorted = useMemo(() => {
    const s = [...data];
    s.sort((a, b) => {
      const av = a[sort.col], bv = b[sort.col];
      if (typeof av === "number") return sort.dir === "asc" ? av - bv : bv - av;
      return sort.dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return s;
  }, [data, sort]);

  const pages = Math.ceil(sorted.length / pageSize);
  const rows = sorted.slice(page * pageSize, (page + 1) * pageSize);
  const toggleSort = col => setSort(p => ({ col, dir: p.col === col && p.dir === "asc" ? "desc" : "asc" }));

  const ths = { padding: "9px 10px", textAlign: "left", borderBottom: "2px solid #1e1e1e", color: "#555", fontWeight: 600, fontSize: 9, letterSpacing: 0.6, textTransform: "uppercase", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" };
  const tds = { padding: "6px 10px", fontVariantNumeric: "tabular-nums", borderBottom: "1px solid #131313" };
  const dim = { ...tds, color: "#555", fontSize: 10 };
  const arrow = col => sort.col === col ? (sort.dir === "asc" ? " ▴" : " ▾") : "";

  const cols = [
    { key: "index", label: "#", style: { ...tds, color: "#2a2a2a" } },
    { key: "date_str", label: "Date (UTC)", style: { ...tds, color: "#777" } },
    { key: "utc_time", label: "UTC Time", style: { ...tds, color: "#777", fontWeight: 500 } },
    { key: "year", label: "Year", style: dim },
    { key: "month_name", label: "Mon", style: dim },
    { key: "day", label: "Day", style: dim },
    { key: "hour", label: "Hour", style: dim },
    { key: "minute", label: "Min", style: dim },
    { key: "dow", label: "DOW", style: dim },
  ];

  return (
    <div>
      <div style={{ overflowX: "auto", maxHeight: 520 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "#0b0b0b", zIndex: 2 }}>
              {cols.map(c => <th key={c.key} style={ths} onClick={() => toggleSort(c.key)}>{c.label}{arrow(c.key)}</th>)}
              {kws.map((k, i) => <th key={k} style={{ ...ths, color: PAL[i % PAL.length] }} onClick={() => toggleSort(k)}>{k}{arrow(k)}</th>)}
              {data[0]?.pca_index !== undefined && (
                <th style={{ ...ths, color: "#fbbf24", fontWeight: 700 }} onClick={() => toggleSort("pca_index")}>PCA{arrow("pca_index")}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {cols.map(c => {
                  let st = c.style;
                  if (c.key === "dow" && (r.dow === "Sat" || r.dow === "Sun")) st = { ...st, color: "#ef4444" };
                  return <td key={c.key} style={st}>{r[c.key]}</td>;
                })}
                {kws.map((k, ki) => (
                  <td key={k} style={{ ...tds, color: PAL[ki % PAL.length], fontWeight: r[k] >= 80 ? 700 : 400 }}>{r[k]}</td>
                ))}
                {r.pca_index !== undefined && (
                  <td style={{ ...tds, color: "#fbbf24", fontWeight: 700 }}>{r.pca_index}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, padding: "0 4px" }}>
        <span style={{ fontSize: 10, color: "#444", fontFamily: "'JetBrains Mono',monospace" }}>
          {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setPage(0)} disabled={page === 0} style={pgBtn}>«</button>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={pgBtn}>‹</button>
          <span style={{ padding: "4px 10px", fontSize: 10, color: "#666", fontFamily: "'JetBrains Mono',monospace" }}>
            {page + 1}/{pages}
          </span>
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} style={pgBtn}>›</button>
          <button onClick={() => setPage(pages - 1)} disabled={page >= pages - 1} style={pgBtn}>»</button>
        </div>
      </div>
    </div>
  );
}
const pgBtn = { padding: "4px 10px", borderRadius: 5, border: "1px solid #1e1e1e", background: "#0a0a0a", color: "#666", fontSize: 11, cursor: "pointer", fontFamily: "inherit" };

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function TrendPulse() {
  const [kws, setKws] = useState([]);
  const [inp, setInp] = useState("");
  const [tl, setTl] = useState("today 3-m");
  const [fr, setFr] = useState("30min");
  const [geo, setGeo] = useState("");
  const [data, setData] = useState([]);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState({ i: 0, n: 0, l: "" });
  const [log, setLog] = useState([]);
  const [showTable, setShowTable] = useState(false);
  const [msg, setMsg] = useState("");
  const [expTab, setExpTab] = useState("quick");
  const [chartType, setChartType] = useState("area");
  const [showPCA, setShowPCA] = useState(true);
  const [pcaInfo, setPcaInfo] = useState(null);

  const TL = TLS.find(x => x.value === tl);
  const FR = FREQ.find(x => x.value === fr);
  const add = () => { const k = inp.trim(); if (k && !kws.includes(k) && kws.length < 20) { setKws([...kws, k]); setInp(""); } };
  const nWindows = Math.ceil(TL.days * 24 / (TL.wH - Math.max(1, Math.floor(TL.wH / 6))));
  const expectedObs = Math.floor(TL.days * 24 * 60 / (FR.ms / 6e4));

  // ─── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = async () => {
    if (!kws.length) return;
    setBusy(true); setData([]); setLog([]);
    const now = Date.now(), totMs = TL.days * 864e5, wMs = TL.wH * 36e5;
    const oMs = Math.max(36e5, Math.floor(wMs / 6)), sMs = wMs - oMs;
    const nW = Math.ceil(totMs / sMs);

    setLog([
      `gtrendsR Strategy: ${TL.days} days → ${nW} windows × ${TL.wH}h`,
      `  Native resolution: ${TL.wH <= 4 ? "~1 min" : TL.wH <= 24 ? "~8 min" : "~60 min"}`,
      `  Target: ${FR.label} | Geo: ${geo || "global"} | Keywords: ${kws.join(", ")}`,
      `  gtrends(keyword, geo="${geo}", time="YYYY-MM-DDTHH YYYY-MM-DDTHH")`, ""
    ]);

    const chunks = [];
    for (let w = 0; w < nW; w++) {
      const wE = now - w * sMs, wS = wE - wMs;
      const sd = new Date(wS), ed = new Date(wE);
      const lb = `${sd.toLocaleDateString("en", { month: "short", day: "numeric" })} ${pad(sd.getHours())}:00 → ${ed.toLocaleDateString("en", { month: "short", day: "numeric" })} ${pad(ed.getHours())}:00`;
      const ts = `${sd.getFullYear()}-${pad(sd.getMonth()+1)}-${pad(sd.getDate())}T${pad(sd.getHours())} ${ed.getFullYear()}-${pad(ed.getMonth()+1)}-${pad(ed.getDate())}T${pad(ed.getHours())}`;
      setProg({ i: w + 1, n: nW, l: lb });
      setLog(p => [...p, `  [${w+1}/${nW}] time="${ts}" ...`]);
      await new Promise(r => setTimeout(r, 120 + Math.random() * 80));
      const wd = simWin(kws, wS, wE);
      chunks.unshift(wd);
      setLog(p => { const u = [...p]; u[u.length - 1] = `  [${w+1}/${nW}] ${lb} → ${wd.length} points`; return u; });
    }

    setLog(p => [...p, "", `Normalizing ${nW} overlapping windows...`]);
    await new Promise(r => setTimeout(r, 120));
    const st = stitchChunks(chunks, kws);
    setLog(p => [...p, `Aggregating ${st.length} → ${FR.label}...`]);
    await new Promise(r => setTimeout(r, 120));
    const ag = aggregate(st, kws, FR.ms);
    const raw = chunks.reduce((s, c) => s + c.length, 0);
    setLog(p => [...p, "",
      `═══════════════════════════════════`,
      `  COMPLETE`,
      `  Windows    : ${nW}`,
      `  Raw points : ${raw.toLocaleString()}`,
      `  Stitched   : ${st.length.toLocaleString()}`,
      `  Final      : ${ag.length.toLocaleString()} observations`,
      `  Expected   : ~${expectedObs.toLocaleString()}`,
      `  Coverage   : ${((ag.length / expectedObs) * 100).toFixed(1)}%`,
      `═══════════════════════════════════`,
    ]);
    setData(ag); setBusy(false);

    // Compute PCA index if >= 2 keywords
    if (kws.length >= 2) {
      const pca = computePCA(ag, kws);
      setData(pca.data);
      setPcaInfo({
        loadings: pca.loadings,
        varianceExplained: pca.varianceExplained,
        eigenvalue: pca.eigenvalue,
      });
    } else {
      setPcaInfo(null);
    }
  };

  // ─── Exports ───────────────────────────────────────────────────────────────
  // Use data: URI for downloads (works in sandboxed iframes where Blob URLs are blocked)
  const dl = useCallback((content, filename, mimeType) => {
    try {
      // Method 1: data: URI (works in most sandboxed environments)
      const encoded = encodeURIComponent(content);
      const dataUri = `data:${mimeType};charset=utf-8,${encoded}`;
      const a = document.createElement("a");
      a.href = dataUri;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 100);
    } catch (e1) {
      try {
        // Method 2: Blob URL fallback
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e2) {
        // Method 3: Copy to clipboard as last resort
        copyToClipboard(content, filename);
      }
    }
  }, []);

  const copyToClipboard = useCallback((content, filename) => {
    try {
      navigator.clipboard.writeText(content);
      setMsg(`Copied ${filename} to clipboard! Paste into a text editor and save.`);
    } catch {
      // Method 4: Show in a new window
      setPreviewContent({ content, filename });
    }
  }, []);

  const [previewContent, setPreviewContent] = useState(null);
  const flash = m => { setMsg(m); setTimeout(() => setMsg(""), 4e3); };

  const expCSV = () => {
    if (!data.length) return;
    const hasPCA = pcaInfo && kws.length >= 2;
    const h = ["utc_datetime", "date", "utc_time", "year", "month", "day", "hour", "minute", "dow", "dow_num", "weekend", "quarter", "timezone", ...kws, ...(hasPCA ? ["pca_index"] : [])];
    const r = [h.join(",")];
    data.forEach(d => {
      r.push([`"${d.utc_datetime}"`, `"${d.date_str}"`, `"${d.utc_time}"`, d.year, d.month, d.day, d.hour, d.minute,
        `"${d.dow}"`, d.dow_num, d.dow_num === 0 || d.dow_num === 6 ? 1 : 0, Math.ceil(d.month / 3),
        `"UTC"`, ...kws.map(k => d[k]), ...(hasPCA ? [d.pca_index] : [])].join(","));
    });
    dl(r.join("\n"), `google_trends_${FR.value}_${TL.days}d.csv`, "text/csv");
    flash("CSV exported!");
  };
  const expXls = () => {
    if (!data.length) return;
    const hasPCA = pcaInfo && kws.length >= 2;
    const h = ["utc_datetime", "date", "utc_time", "year", "month", "day", "hour", "minute", "dow", "timezone", ...kws, ...(hasPCA ? ["pca_index"] : [])];
    const r = [h.join("\t")];
    data.forEach(d => r.push([d.utc_datetime, d.date_str, d.utc_time, d.year, d.month, d.day, d.hour, d.minute, d.dow, "UTC", ...kws.map(k => d[k]), ...(hasPCA ? [d.pca_index] : [])].join("\t")));
    dl(r.join("\n"), `google_trends_${FR.value}_${TL.days}d.xls`, "application/vnd.ms-excel");
    flash("Excel exported!");
  };
  const expR = () => { dl(genR(kws, tl, fr, geo), "get_gtrends_data.R", "text/plain"); flash("R script exported!"); };
  const expDo = () => { 
    dl(genDo(kws, tl, fr), `import_gtrends_${FR.value}.do`, "text/plain"); 
    flash("Stata .do exported!"); 
  };

  // Clipboard copy versions
  const getCSVContent = () => {
    if (!data.length) return "";
    const hasPCA = pcaInfo && kws.length >= 2;
    const h = ["utc_datetime","date","utc_time","year","month","day","hour","minute","dow","dow_num","weekend","quarter","timezone",...kws,...(hasPCA?["pca_index"]:[])];
    const r = [h.join(",")];
    data.forEach(d => {
      r.push([`"${d.utc_datetime}"`,`"${d.date_str}"`,`"${d.utc_time}"`,d.year,d.month,d.day,d.hour,d.minute,
        `"${d.dow}"`,d.dow_num,d.dow_num===0||d.dow_num===6?1:0,Math.ceil(d.month/3),
        `"UTC"`,...kws.map(k=>d[k]),...(hasPCA?[d.pca_index]:[])].join(","));
    });
    return r.join("\n");
  };
  const copyCSV = () => { copyToClipboard(getCSVContent(), "CSV data"); flash("CSV copied to clipboard!"); };
  const copyR = () => { copyToClipboard(genR(kws,tl,fr,geo), "R script"); flash("R script copied to clipboard!"); };
  const copyDo = () => { copyToClipboard(genDo(kws,tl,fr), "Stata .do"); flash("Stata .do copied to clipboard!"); };

  const pct = prog.n > 0 ? (prog.i / prog.n) * 100 : 0;

  // ─── Chart data (downsample for performance) ──────────────────────────────
  const chartData = useMemo(() => {
    if (data.length <= 500) return data;
    const step = Math.ceil(data.length / 500);
    return data.filter((_, i) => i % step === 0);
  }, [data]);

  // ─── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!data.length) return {};
    const s = {};
    kws.forEach(k => {
      const v = data.map(d => d[k]);
      s[k] = { avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), min: Math.min(...v), max: Math.max(...v) };
    });
    if (pcaInfo && data[0]?.pca_index !== undefined) {
      const v = data.map(d => d.pca_index);
      s["pca_index"] = { avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), min: Math.min(...v), max: Math.max(...v) };
    }
    return s;
  }, [data, kws, pcaInfo]);

  // ─── Styles ────────────────────────────────────────────────────────────────
  const S = {
    lbl: { display: "block", fontSize: 10, fontWeight: 600, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
    inp: { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #1e1e1e", background: "#0b0b0b", color: "#ccc", fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" },
    sel: { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #1e1e1e", background: "#0b0b0b", color: "#ccc", fontSize: 13, outline: "none", fontFamily: "inherit", cursor: "pointer", boxSizing: "border-box" },
    card: { background: "#0b0b0b", borderRadius: 12, border: "1px solid #161616", padding: "20px 22px" },
    btn: { padding: "8px 16px", borderRadius: 8, border: "1px solid #1e1e1e", background: "#080808", color: "#888", fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "all .15s" },
    badge: (c) => ({ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, background: c + "0a", border: `1px solid ${c}20`, fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace" }),
  };

  return (
    <div style={{ minHeight: "100vh", background: "#070707", color: "#c0c0c0", fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ padding: "22px 32px 18px", borderBottom: "1px solid #131313", background: "#090909" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,#ef4444,#f59e0b)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, color: "#fff", flexShrink: 0 }}>T</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, color: "#f0f0f0", letterSpacing: -0.3 }}>Trend Pulse</h1>
            <p style={{ margin: 0, fontSize: 10, color: "#3a3a3a", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>
              GOOGLE TRENDS · gtrendsR LOOP · PCA INDEX · UTC TIME · R + STATA
            </p>
          </div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 32px", display: "grid", gridTemplateColumns: "280px 1fr", gap: 20 }}>

        {/* ── Sidebar ──────────────────────────────────────────── */}
        <div>
          <div style={{ ...S.card, marginBottom: 16 }}>
            <label style={S.lbl}>Keywords (max 20)</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input value={inp} onChange={e => setInp(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Enter keyword" style={{ ...S.inp, flex: 1 }} />
              <button onClick={add} style={{ ...S.btn, padding: "10px 14px", whiteSpace: "nowrap" }}>+</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, minHeight: 28, maxHeight: 180, overflowY: "auto" }}>
              {kws.map((k, i) => (
                <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, background: PAL[i % PAL.length] + "14", border: `1px solid ${PAL[i % PAL.length]}30`, fontSize: 11, fontWeight: 500, color: PAL[i % PAL.length], fontFamily: "'JetBrains Mono',monospace" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: PAL[i % PAL.length] }} />{k}
                  <span onClick={() => setKws(kws.filter(x => x !== k))} style={{ cursor: "pointer", opacity: 0.5, marginLeft: 2, fontSize: 15, lineHeight: 1 }}>×</span>
                </span>
              ))}
              {!kws.length && <span style={{ fontSize: 11, color: "#333", fontStyle: "italic" }}>Add keywords to start</span>}
            </div>
            {kws.length > 0 && <div style={{ fontSize: 9, color: "#333", marginTop: 4, fontFamily: "'JetBrains Mono',monospace" }}>{kws.length}/20 keywords{kws.length >= 2 ? " · PCA enabled" : " · add 2+ for PCA"}</div>}
          </div>

          <div style={{ ...S.card, marginBottom: 16 }}>
            <label style={S.lbl}>Timeline</label>
            <select value={tl} onChange={e => setTl(e.target.value)} style={S.sel}>
              {TLS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>

            <label style={{ ...S.lbl, marginTop: 14 }}>Frequency</label>
            <select value={fr} onChange={e => setFr(e.target.value)} style={S.sel}>
              {FREQ.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>

            <label style={{ ...S.lbl, marginTop: 14 }}>Geo Region</label>
            <input value={geo} onChange={e => setGeo(e.target.value)} style={S.inp} placeholder="US, PK, GB..." />
          </div>

          <button onClick={fetchData} disabled={!kws.length || busy} style={{
            width: "100%", padding: "12px", borderRadius: 10, border: "none",
            background: kws.length && !busy ? "linear-gradient(135deg,#ef4444,#f59e0b)" : "#1a1a1a",
            color: "#fff", fontSize: 14, fontWeight: 600, cursor: kws.length && !busy ? "pointer" : "not-allowed",
            fontFamily: "inherit", letterSpacing: 0.3, marginBottom: 16,
          }}>
            {busy ? `Fetching... (${prog.i}/${prog.n})` : "Fetch Google Trends"}
          </button>

          {/* Strategy */}
          {kws.length > 0 && !busy && !data.length && (
            <div style={{ padding: "12px 14px", borderRadius: 8, background: "#ef44440a", border: "1px solid #ef444418", fontSize: 11, color: "#666", lineHeight: 1.8 }}>
              <strong style={{ color: "#ef4444" }}>Strategy</strong><br />
              {TL.days}d → <strong style={{ color: "#f59e0b" }}>{nWindows} windows</strong> × {TL.wH}h<br />
              Native: <strong style={{ color: "#3b82f6" }}>{TL.wH <= 4 ? "~1 min" : TL.wH <= 24 ? "~8 min" : "~60 min"}</strong>
              {" → "}<strong style={{ color: "#8b5cf6" }}>{FR.label}</strong><br />
              Expected: ~{expectedObs.toLocaleString()} obs
            </div>
          )}
        </div>

        {/* ── Main Content ─────────────────────────────────────── */}
        <div>
          {/* Progress */}
          {busy && (
            <div style={{ ...S.card, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#777", letterSpacing: 1 }}>FETCHING</span>
                <span style={{ fontSize: 10, color: "#444", fontFamily: "'JetBrains Mono',monospace" }}>{prog.i}/{prog.n} windows</span>
              </div>
              <div style={{ height: 4, background: "#151515", borderRadius: 2, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", borderRadius: 2, background: "linear-gradient(90deg,#ef4444,#f59e0b)", width: `${pct}%`, transition: "width 0.2s" }} />
              </div>
              <div style={{ background: "#050505", borderRadius: 8, padding: "10px 14px", maxHeight: 220, overflowY: "auto", border: "1px solid #131313", fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>
                {log.map((l, i) => (
                  <div key={i} style={{ color: l.includes("points") ? "#10b981" : l.includes("[") ? "#f59e0b" : l.includes("Strategy") ? "#ec4899" : l.includes("Norm") || l.includes("Agg") ? "#3b82f6" : "#333", whiteSpace: "pre", padding: "1px 0" }}>{l}</div>
                ))}
                <div style={{ color: "#f59e0b", animation: "blink 1s infinite" }}>_</div>
                <style>{`@keyframes blink{0%,50%{opacity:1}51%,100%{opacity:0}}`}</style>
              </div>
            </div>
          )}

          {/* Results */}
          {data.length > 0 && !busy && (
            <>
              {/* Stats */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                <div style={S.badge("#10b981")}><span style={{ color: "#555" }}>Obs:</span> <span style={{ color: "#10b981", fontWeight: 600 }}>{data.length.toLocaleString()}</span></div>
                <div style={S.badge("#f59e0b")}><span style={{ color: "#555" }}>Windows:</span> <span style={{ color: "#f59e0b", fontWeight: 600 }}>{prog.n}</span></div>
                <div style={S.badge("#3b82f6")}><span style={{ color: "#555" }}>Freq:</span> <span style={{ color: "#3b82f6", fontWeight: 600 }}>{FR.label}</span></div>
                <div style={S.badge("#8b5cf6")}><span style={{ color: "#555" }}>Coverage:</span> <span style={{ color: "#8b5cf6", fontWeight: 600 }}>{((data.length / expectedObs) * 100).toFixed(0)}%</span></div>
                <div style={S.badge("#ec4899")}><span style={{ color: "#555" }}>Range:</span> <span style={{ color: "#ec4899", fontWeight: 600 }}>{data[0]?.date_str} → {data[data.length-1]?.date_str}</span></div>
              </div>

              {/* Log toggle */}
              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontSize: 10, color: "#3a3a3a", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}>
                  View fetch log ({log.length} lines)
                </summary>
                <div style={{ background: "#050505", borderRadius: 8, padding: "10px 14px", marginTop: 6, maxHeight: 200, overflowY: "auto", border: "1px solid #131313", fontFamily: "'JetBrains Mono',monospace", fontSize: 9 }}>
                  {log.map((l, i) => <div key={i} style={{ color: l.includes("COMPLETE") ? "#10b981" : l.includes("points") ? "#10b981" : "#333", whiteSpace: "pre" }}>{l}</div>)}
                </div>
              </details>

              {/* Chart */}
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#666", letterSpacing: 1 }}>INTEREST OVER TIME</span>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {pcaInfo && (
                      <button onClick={() => setShowPCA(!showPCA)} style={{ ...S.btn, padding: "4px 10px", fontSize: 10, borderColor: showPCA ? "#fbbf2433" : "#1e1e1e", color: showPCA ? "#fbbf24" : "#555", background: showPCA ? "#fbbf2408" : "transparent" }}>
                        PCA Index {showPCA ? "ON" : "OFF"}
                      </button>
                    )}
                    {["area", "line"].map(t => (
                      <button key={t} onClick={() => setChartType(t)} style={{ ...S.btn, padding: "4px 10px", fontSize: 10, borderColor: chartType === t ? "#f59e0b33" : "#1e1e1e", color: chartType === t ? "#f59e0b" : "#555" }}>
                        {t === "area" ? "Area" : "Line"}
                      </button>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  {chartType === "area" ? (
                    <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <defs>
                        {kws.map((k, i) => (
                          <linearGradient key={k} id={`fill-${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={PAL[i % PAL.length]} stopOpacity={0.2} />
                            <stop offset="95%" stopColor={PAL[i % PAL.length]} stopOpacity={0} />
                          </linearGradient>
                        ))}
                        <linearGradient id="fill-pca" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={PCA_COLOR} stopOpacity={0.25} />
                          <stop offset="95%" stopColor={PCA_COLOR} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                      <XAxis dataKey="chartLabel" tick={{ fill: "#444", fontSize: 9, fontFamily: "'JetBrains Mono'" }} interval="preserveStartEnd" minTickGap={60} stroke="#1a1a1a" />
                      <YAxis domain={[0, 105]} tick={{ fill: "#444", fontSize: 9, fontFamily: "'JetBrains Mono'" }} stroke="#1a1a1a" />
                      <Tooltip content={<ChartTip />} />
                      <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'JetBrains Mono'" }} />
                      {kws.map((k, i) => (
                        <Area key={k} type="monotone" dataKey={k} stroke={PAL[i % PAL.length]} strokeWidth={1.5} fill={`url(#fill-${i})`} dot={false} />
                      ))}
                      {showPCA && pcaInfo && (
                        <Area type="monotone" dataKey="pca_index" name="PCA Index" stroke={PCA_COLOR} strokeWidth={2.5} strokeDasharray="6 3" fill="url(#fill-pca)" dot={false} />
                      )}
                    </AreaChart>
                  ) : (
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                      <XAxis dataKey="chartLabel" tick={{ fill: "#444", fontSize: 9, fontFamily: "'JetBrains Mono'" }} interval="preserveStartEnd" minTickGap={60} stroke="#1a1a1a" />
                      <YAxis domain={[0, 105]} tick={{ fill: "#444", fontSize: 9, fontFamily: "'JetBrains Mono'" }} stroke="#1a1a1a" />
                      <Tooltip content={<ChartTip />} />
                      <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'JetBrains Mono'" }} />
                      {kws.map((k, i) => (
                        <Line key={k} type="monotone" dataKey={k} stroke={PAL[i % PAL.length]} strokeWidth={1.5} dot={false} />
                      ))}
                      {showPCA && pcaInfo && (
                        <Line type="monotone" dataKey="pca_index" name="PCA Index" stroke={PCA_COLOR} strokeWidth={2.5} strokeDasharray="6 3" dot={false} />
                      )}
                    </LineChart>
                  )}
                </ResponsiveContainer>
                {/* Keyword stats */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12 }}>
                  {kws.map((k, i) => stats[k] && (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
                      <span style={{ width: 12, height: 3, borderRadius: 1, background: PAL[i % PAL.length] }} />
                      <span style={{ color: PAL[i % PAL.length], fontWeight: 600 }}>{k}</span>
                      <span style={{ color: "#3a3a3a", fontFamily: "'JetBrains Mono',monospace" }}>
                        avg:{stats[k].avg} min:{stats[k].min} max:{stats[k].max}
                      </span>
                    </div>
                  ))}
                  {pcaInfo && stats["pca_index"] && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
                      <span style={{ width: 12, height: 3, borderRadius: 1, background: PCA_COLOR, borderTop: "1px dashed #000" }} />
                      <span style={{ color: PCA_COLOR, fontWeight: 700 }}>PCA Index</span>
                      <span style={{ color: "#3a3a3a", fontFamily: "'JetBrains Mono',monospace" }}>
                        avg:{stats["pca_index"].avg} min:{stats["pca_index"].min} max:{stats["pca_index"].max}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* PCA Details Panel */}
              {pcaInfo && (
                <div style={{ ...S.card, marginBottom: 16, borderColor: "#fbbf2420" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: PCA_COLOR, letterSpacing: 1 }}>PRINCIPAL COMPONENT ANALYSIS</span>
                    <span style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono',monospace" }}>
                      PC1 explains {pcaInfo.varianceExplained}% of variance
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#555", marginBottom: 8, fontWeight: 600 }}>PC1 Loadings (weights per keyword)</div>
                      {kws.map((k, i) => {
                        const loading = pcaInfo.loadings[i];
                        const absL = Math.abs(loading);
                        const barWidth = absL / Math.max(...pcaInfo.loadings.map(Math.abs)) * 100;
                        return (
                          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: 10, fontFamily: "'JetBrains Mono',monospace" }}>
                            <span style={{ width: 80, color: PAL[i % PAL.length], overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
                            <div style={{ flex: 1, height: 6, background: "#151515", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${barWidth}%`, height: "100%", background: loading >= 0 ? "#10b981" : "#ef4444", borderRadius: 3 }} />
                            </div>
                            <span style={{ width: 45, textAlign: "right", color: loading >= 0 ? "#10b981" : "#ef4444" }}>{loading.toFixed(3)}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 10, color: "#555", lineHeight: 1.8 }}>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>Method</div>
                      <div>Standardization: z-scores (mean=0, sd=1)</div>
                      <div>Matrix: correlation matrix</div>
                      <div>Extraction: power iteration (PC1)</div>
                      <div>Eigenvalue: <span style={{ color: PCA_COLOR }}>{pcaInfo.eigenvalue.toFixed(3)}</span></div>
                      <div>Variance explained: <span style={{ color: PCA_COLOR }}>{pcaInfo.varianceExplained}%</span></div>
                      <div>Index scale: 0–100 (rescaled PC1 scores)</div>
                      <div style={{ marginTop: 8, color: "#444" }}>Higher loading = keyword contributes more to the composite index</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Data Table */}
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div onClick={() => setShowTable(!showTable)} style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#666", letterSpacing: 1 }}>DATA TABLE {showTable ? "▾" : "▸"}</span>
                  <span style={{ fontSize: 10, color: "#3a3a3a", fontFamily: "'JetBrains Mono',monospace" }}>{data.length.toLocaleString()} rows</span>
                </div>
                {showTable && <div style={{ marginTop: 14 }}><DataTable data={data} kws={kws} /></div>}
              </div>

              {/* Export */}
              <div style={S.card}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#666", letterSpacing: 1, display: "block", marginBottom: 14 }}>EXPORT</span>
                <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
                  {[{ id: "quick", l: "Downloads" }, { id: "r", l: "R Script" }, { id: "do", l: "Stata .do" }].map(t => (
                    <button key={t.id} onClick={() => setExpTab(t.id)} style={{ ...S.btn, padding: "6px 14px", fontSize: 11, borderColor: expTab === t.id ? "#f59e0b30" : "#1e1e1e", color: expTab === t.id ? "#f59e0b" : "#555", background: expTab === t.id ? "#f59e0b08" : "#080808" }}>{t.l}</button>
                  ))}
                </div>

                {expTab === "quick" && (
                  <div>
                    <div style={{ fontSize: 10, color: "#555", marginBottom: 10 }}>Download files or copy to clipboard:</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      <button onClick={expCSV} style={S.btn}>⬇ CSV</button>
                      <button onClick={copyCSV} style={{ ...S.btn, borderColor: "#10b98128", color: "#10b981" }}>📋 Copy CSV</button>
                      <button onClick={expXls} style={{ ...S.btn, borderColor: "#3b82f628" }}>⬇ Excel</button>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={expR} style={{ ...S.btn, borderColor: "#ef444428", color: "#ef4444" }}>⬇ R Script</button>
                      <button onClick={copyR} style={{ ...S.btn, borderColor: "#ef444428", color: "#ef4444" }}>📋 Copy R</button>
                      <button onClick={expDo} style={{ ...S.btn, borderColor: "#8b5cf628" }}>⬇ Stata .do</button>
                      <button onClick={copyDo} style={{ ...S.btn, borderColor: "#8b5cf628", color: "#8b5cf6" }}>📋 Copy .do</button>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 10, color: "#444", lineHeight: 1.6 }}>
                      If download doesn't work, use 📋 Copy buttons to copy content to clipboard, then paste into a text editor and save.
                    </div>
                  </div>
                )}

                {expTab === "r" && (
                  <div>
                    <p style={{ margin: "0 0 10px", fontSize: 11, color: "#555", lineHeight: 1.6 }}>
                      Ready-to-run R script using <code style={{ color: "#ef4444" }}>gtrendsR::gtrends()</code> with{" "}
                      <code style={{ color: "#10b981" }}>time="YYYY-MM-DDTHH YYYY-MM-DDTHH"</code> loop.
                      Includes rate limiting, overlap normalization, PCA, and full time component extraction.
                    </p>
                    <div style={{ background: "#050505", borderRadius: 8, padding: "12px 14px", maxHeight: 300, overflowY: "auto", border: "1px solid #131313", fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: "#666", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                      {genR(kws, tl, fr, geo).slice(0, 3000)}...
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button onClick={expR} style={{ ...S.btn, color: "#ef4444", borderColor: "#ef444430" }}>⬇ Download R Script</button>
                      <button onClick={copyR} style={{ ...S.btn, color: "#ef4444", borderColor: "#ef444430" }}>📋 Copy to Clipboard</button>
                    </div>
                  </div>
                )}

                {expTab === "do" && (
                  <div>
                    <p style={{ margin: "0 0 10px", fontSize: 11, color: "#555", lineHeight: 1.6 }}>
                      Stata .do file: <code style={{ color: "#8b5cf6" }}>%tc</code> datetime,{" "}
                      <code style={{ color: "#8b5cf6" }}>hh()</code>/<code style={{ color: "#8b5cf6" }}>mm()</code> for hour/minute,{" "}
                      <code style={{ color: "#8b5cf6" }}>%tcHH:MM</code> clock, <code style={{ color: "#8b5cf6" }}>tsset</code>, PCA + MA.
                    </p>
                    <div style={{ background: "#050505", borderRadius: 8, padding: "12px 14px", maxHeight: 300, overflowY: "auto", border: "1px solid #131313", fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, color: "#666", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                      {genDo(kws, tl, fr).slice(0, 3000)}...
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button onClick={expDo} style={{ ...S.btn, color: "#8b5cf6", borderColor: "#8b5cf630" }}>⬇ Download .do File</button>
                      <button onClick={copyDo} style={{ ...S.btn, color: "#8b5cf6", borderColor: "#8b5cf630" }}>📋 Copy to Clipboard</button>
                    </div>
                  </div>
                )}

                {msg && <div style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, background: "#10b98110", color: "#10b981", fontSize: 11, fontWeight: 500 }}>{msg}</div>}

                {/* Preview Modal (fallback when download/clipboard both fail) */}
                {previewContent && (
                  <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
                    <div style={{ background: "#111", borderRadius: 12, border: "1px solid #222", maxWidth: 800, width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #222" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#888" }}>{previewContent.filename}</span>
                        <button onClick={() => setPreviewContent(null)} style={{ ...S.btn, padding: "4px 12px" }}>✕ Close</button>
                      </div>
                      <div style={{ padding: "14px 18px", fontSize: 10, color: "#666" }}>
                        Select all text below (Ctrl+A), copy (Ctrl+C), and paste into a file:
                      </div>
                      <textarea
                        readOnly
                        value={previewContent.content}
                        style={{ flex: 1, margin: "0 18px 18px", padding: 12, background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 8, color: "#888", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, resize: "none", outline: "none", minHeight: 300 }}
                        onFocus={e => e.target.select()}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Empty state */}
          {!busy && !data.length && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, color: "#2a2a2a", textAlign: "center" }}>
              <div>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📈</div>
                <p style={{ fontSize: 14, color: "#444" }}>Add keywords and click <strong style={{ color: "#f59e0b" }}>Fetch</strong> to start</p>
                <p style={{ fontSize: 11, color: "#333" }}>Data will be fetched using gtrendsR loop strategy</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
