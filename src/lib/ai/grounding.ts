/**
 * Grounding checks for LLM output. The language model may only restate numbers
 * that appear in the validated analytical payload it was given.
 */

const FORBIDDEN = [
  /guarantee/i,
  /will (definitely |surely )?be profitable/i,
  /next trade will/i,
  /\b(you should|i recommend you) (buy|sell|short)\b/i,
  /\bsure[- ]shot\b/i,
  /risk[- ]free/i,
];

/** Collect every number in a JSON-able payload (and common roundings of it). */
export function allowedNumbers(payload: unknown): Set<string> {
  const out = new Set<string>();
  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    const a = Math.abs(n);
    for (const d of [0, 1, 2]) out.add(a.toFixed(d));
    out.add(String(a));
  };
  const walk = (v: unknown) => {
    if (typeof v === "number") add(v);
    else if (typeof v === "string") for (const m of v.matchAll(/\d[\d,]*(?:\.\d+)?/g)) add(Number(m[0].replace(/,/g, "")));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(payload);
  return out;
}

export interface GroundingResult {
  ok: boolean;
  ungrounded: string[];
  forbidden: string[];
}

/**
 * Every currency amount, percentage and multi-digit number in `text` must be
 * present in the allowed set. Small integers (0-10) used in prose are permitted.
 */
export function checkGrounding(text: string, allowed: Set<string>): GroundingResult {
  const ungrounded: string[] = [];
  for (const m of text.matchAll(/(?:₹|rs\.?\s?|inr\s?)?\s?(\d[\d,]*(?:\.\d+)?)\s?(%|x)?/gi)) {
    const raw = m[1].replace(/,/g, "");
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const isMoney = /₹|rs|inr/i.test(m[0]);
    const isPct = m[2] === "%";
    if (!isMoney && !isPct && n <= 10 && Number.isInteger(n)) continue; // "3 trades", "2 losses"
    if (/^(19|20)\d{2}$/.test(raw) && !isMoney && !isPct) continue; // years
    const candidates = [raw, n.toFixed(0), n.toFixed(1), n.toFixed(2)];
    if (!candidates.some((c) => allowed.has(c))) ungrounded.push(m[0].trim());
  }
  const forbidden = FORBIDDEN.filter((r) => r.test(text)).map((r) => r.source);
  return { ok: ungrounded.length === 0 && forbidden.length === 0, ungrounded, forbidden };
}
