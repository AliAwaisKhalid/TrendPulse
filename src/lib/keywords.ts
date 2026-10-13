/** Keyword presets and keyword-file parsing (with optional category column). */

export interface KeywordEntry {
  keyword: string;
  category?: string;
}

/** Table 2: List of Keywords (Strait of Hormuz attention study). */
export const HORMUZ_TABLE2: KeywordEntry[] = [
  { keyword: "Strait of Hormuz", category: "Geopolitical / Location" },
  { keyword: "Hormuz blockade", category: "Geopolitical / Blockade" },
  { keyword: "Hormuz closure", category: "Geopolitical / Blockade" },
  { keyword: "Hormuz blocked", category: "Geopolitical / Blockade" },
  { keyword: "Hormuz shipping", category: "Shipping / Trade" },
  { keyword: "Persian Gulf shipping", category: "Shipping / Trade" },
  { keyword: "Persian Gulf blockade", category: "Geopolitical / Blockade" },
  { keyword: "Gulf oil shipping", category: "Shipping / Oil Trade" },
  { keyword: "Hormuz tanker", category: "Shipping / Oil Trade" },
  { keyword: "Iran Strait of Hormuz", category: "Geopolitical / Location" },
  { keyword: "Hormuz oil supply", category: "Shipping / Oil Trade" },
];

/**
 * Placebo keywords for the SoH attention index (manuscript Section 4.3.4, Response to Comment 1.13;
 * see docs/Placebo_Keywords_Selection.docx). Group A: everyday terms with no link to shipping, oil
 * or the Gulf, which should show no association with herding. Group B: other maritime chokepoints, a
 * same-domain comparison rather than a pure placebo, because Red Sea or Suez news can co-move with Hormuz news.
 */
export const PLACEBO_A: KeywordEntry[] = [
  { keyword: "weather forecast", category: "Placebo A / Everyday" },
  { keyword: "football scores", category: "Placebo A / Everyday" },
  { keyword: "pizza delivery", category: "Placebo A / Everyday" },
  { keyword: "recipe", category: "Placebo A / Everyday" },
  { keyword: "tax return", category: "Placebo A / Everyday" },
  { keyword: "public holidays", category: "Placebo A / Everyday" },
  { keyword: "train timetable", category: "Placebo A / Everyday" },
  { keyword: "hotel booking", category: "Placebo A / Everyday" },
];
export const PLACEBO_B: KeywordEntry[] = [
  { keyword: "Panama Canal", category: "Placebo B / Other chokepoint" },
  { keyword: "Suez Canal", category: "Placebo B / Other chokepoint" },
  { keyword: "Bab el-Mandeb", category: "Placebo B / Other chokepoint" },
  { keyword: "Strait of Malacca", category: "Placebo B / Other chokepoint" },
  { keyword: "Bosphorus", category: "Placebo B / Other chokepoint" },
];
export const PLACEBO_ALL: KeywordEntry[] = [...PLACEBO_A, ...PLACEBO_B];

export const KEYWORD_PRESETS: { id: string; label: string; entries: KeywordEntry[] }[] = [
  { id: "hormuz-table2", label: "Strait of Hormuz (Table 2, 11 keywords)", entries: HORMUZ_TABLE2 },
  { id: "placebo-a", label: "Placebo A: everyday terms (8 keywords)", entries: PLACEBO_A },
  { id: "placebo-b", label: "Placebo B: other chokepoints (5 keywords)", entries: PLACEBO_B },
];

/** Split one CSV/TSV line, honouring double quotes. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse pasted text or an imported file.
 * Accepted: (a) "keyword,category" / tab-separated table with or without header,
 * (b) plain list separated by commas or new lines (no categories).
 */
export function parseKeywordEntries(text: string): KeywordEntry[] {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const delim = lines.every((l) => l.includes("\t")) ? "\t"
    : /^"?(keyword|term|query)"?\s*[,;]\s*"?(category|group|type|theme)/i.test(lines[0]) ? (lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",")
    : null;

  let entries: KeywordEntry[];
  if (delim) {
    let rows = lines.map((l) => splitLine(l, delim));
    if (/^(keyword|term|query)$/i.test(rows[0][0])) rows = rows.slice(1);
    entries = rows
      .filter((r) => r[0])
      .map((r) => ({ keyword: r[0], category: r[1] || undefined }));
  } else {
    entries = clean.split(/[\n,]+/).map((k) => k.trim()).filter(Boolean).map((k) => ({ keyword: k }));
  }
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.keyword) ? false : (seen.add(e.keyword), true)));
}

export function entriesToCSV(entries: KeywordEntry[]): string {
  return "keyword,category\r\n" + entries.map((e) => `"${e.keyword}","${e.category ?? ""}"`).join("\r\n") + "\r\n";
}
