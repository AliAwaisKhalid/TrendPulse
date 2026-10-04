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

export const KEYWORD_PRESETS: { id: string; label: string; entries: KeywordEntry[] }[] = [
  { id: "hormuz-table2", label: "Strait of Hormuz (Table 2, 11 keywords)", entries: HORMUZ_TABLE2 },
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
