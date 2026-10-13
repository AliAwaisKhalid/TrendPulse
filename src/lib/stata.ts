/**
 * Minimal Stata .dta writer (format 114, readable by Stata 10 and later, R haven, Python pandas).
 * Numeric columns are stored as doubles, string columns as fixed-width str1..str244.
 * Datetime columns are stored as Stata %tc values (milliseconds since 01jan1960 00:00:00 UTC).
 */

export interface DtaColumn {
  /** Stata variable name (sanitised by sanitizeStataName if needed). */
  name: string;
  /** Variable label, up to 80 characters. */
  label?: string;
  kind: "double" | "string" | "datetime";
  values: (number | string | null | undefined)[];
}

const STATA_EPOCH_MS = Date.UTC(1960, 0, 1, 0, 0, 0);
/** Stata system missing for doubles (2^1023). */
const DOUBLE_MISSING = Math.pow(2, 1023);

/** Milliseconds since 01jan1960, the Stata %tc clock, from "YYYY-MM-DD HH:MM[:SS]" (UTC) or epoch ms. */
export function toStataClock(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  let ms: number;
  if (typeof v === "number") ms = v;
  else {
    const s = String(v).trim().replace(" ", "T");
    ms = Date.parse(s.length === 10 ? s + "T00:00:00Z" : s.length === 16 ? s + ":00Z" : s.endsWith("Z") ? s : s + "Z");
  }
  return Number.isFinite(ms) ? ms - STATA_EPOCH_MS : null;
}

const RESERVED = new Set([
  "_all", "_b", "byte", "_coef", "_cons", "double", "float", "if", "in", "int", "long", "_n", "_N", "_pi",
  "_pred", "_rc", "_skip", "strl", "using", "with",
]);

/** Valid, unique Stata variable names (lower case, [a-z0-9_], max 32 characters). */
export function sanitizeStataNames(raw: string[], prefix = ""): string[] {
  const used = new Set<string>();
  return raw.map((r) => {
    let n = (prefix + r).toLowerCase().normalize("NFKD").replace(/[^\x00-\x7f]/g, "")
      .replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    if (!n || /^[0-9]/.test(n)) n = "v_" + n;
    if (RESERVED.has(n)) n = n + "_";
    n = n.slice(0, 32);
    let cand = n;
    let i = 2;
    while (used.has(cand)) { const suf = `_${i++}`; cand = n.slice(0, 32 - suf.length) + suf; }
    used.add(cand);
    return cand;
  });
}

function ascii(s: string): string {
  return s.normalize("NFKD").replace(/[^\x20-\x7e]/g, "?");
}

/** Build a format-114 .dta file. All columns must have the same length. */
export function writeDta(columns: DtaColumn[], dataLabel = ""): Uint8Array {
  const nvar = columns.length;
  const nobs = nvar ? columns[0].values.length : 0;
  if (columns.some((c) => c.values.length !== nobs)) throw new Error("writeDta: columns differ in length");
  if (nvar > 32767) throw new Error("writeDta: too many variables");

  const strWidth = columns.map((c) => {
    if (c.kind !== "string") return 0;
    const w = c.values.reduce<number>((m, v) => Math.max(m, ascii(String(v ?? "")).length), 1);
    return Math.min(244, Math.max(1, w));
  });
  const obsBytes = columns.reduce((s, c, j) => s + (c.kind === "string" ? strWidth[j] : 8), 0);
  const headerBytes = 4 + 2 + 4 + 81 + 18;
  const descBytes = nvar + nvar * 33 + (nvar + 1) * 2 + nvar * 49 + nvar * 33 + nvar * 81 + 5;
  const buf = new ArrayBuffer(headerBytes + descBytes + nobs * obsBytes);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let o = 0;
  const putStr = (s: string, len: number) => {
    const a = ascii(s).slice(0, len - 1);
    for (let i = 0; i < a.length; i++) u8[o + i] = a.charCodeAt(i);
    o += len; // remaining bytes stay 0 (null padding)
  };

  // Header
  dv.setUint8(o++, 114); dv.setUint8(o++, 2); dv.setUint8(o++, 1); dv.setUint8(o++, 0);
  dv.setInt16(o, nvar, true); o += 2;
  dv.setInt32(o, nobs, true); o += 4;
  putStr(dataLabel, 81);
  const now = new Date();
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][now.getUTCMonth()];
  const ts = `${String(now.getUTCDate()).padStart(2, "0")} ${mon} ${now.getUTCFullYear()} ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  putStr(ts, 18);

  // Descriptors
  columns.forEach((c, j) => { dv.setUint8(o++, c.kind === "string" ? strWidth[j] : 255); });
  columns.forEach((c) => putStr(c.name, 33));
  o += (nvar + 1) * 2; // srtlist: no sort order
  columns.forEach((c, j) => putStr(c.kind === "string" ? `%-${Math.min(strWidth[j], 40)}s` : c.kind === "datetime" ? "%tcCCYY-NN-DD_HH:MM" : "%10.0g", 49));
  o += nvar * 33; // lbllist: no value labels
  columns.forEach((c) => putStr(c.label ?? "", 81));
  o += 5; // expansion fields terminator (type 0, length 0)

  // Data
  for (let i = 0; i < nobs; i++) {
    columns.forEach((c, j) => {
      const v = c.values[i];
      if (c.kind === "string") {
        // str fields are exactly strWidth bytes, null-padded, no terminator required
        const a = ascii(String(v ?? "")).slice(0, strWidth[j]);
        for (let k = 0; k < a.length; k++) u8[o + k] = a.charCodeAt(k);
        o += strWidth[j];
      } else {
        const num = c.kind === "datetime" ? toStataClock(v as string | number) : (typeof v === "number" ? v : v === null || v === undefined || v === "" ? NaN : Number(v));
        dv.setFloat64(o, num === null || !Number.isFinite(num) ? DOUBLE_MISSING : num, true);
        o += 8;
      }
    });
  }
  return u8;
}
