// Reads the order values out of a supplier email. Used by the workflow run (executor) on the text
// it reads from Gmail, and by the email sender to render bodies. Pure, so it is unit-tested.
// The .js extension lets the Durable Actors project (NodeNext) import this file too; Vite resolves it to schema.ts.
import type { MailMessage, VarKey } from './schema.js';

export type Extracted = Partial<Record<VarKey, string>>;

export interface ExtractOptions {
  /** Supplier names to look for (Odoo vendors). The first one found in the text wins. */
  vendors?: string[];
  /** Known product codes. When given, only these count as an item. */
  skus?: string[];
  /** Used to fill in the year for dates like "Nov 30". */
  today?: Date;
}

/** The email body as plain text. */
export function bodyText(m: MailMessage): string {
  return m.body.map((p) => (typeof p === 'string' ? p : p.text)).join('');
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function month(word: string): number | null {
  const i = MONTHS.indexOf(word.slice(0, 3).toLowerCase());
  return i < 0 ? null : i + 1;
}

/** Turns "2026-11-12", "3 Dec 2026", "Nov 30" or "November 30, 2026" into YYYY-MM-DD. */
export function parseDate(text: string, today = new Date()): string | null {
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (m && month(m[2])) return `${m[3]}-${pad(month(m[2])!)}-${pad(Number(m[1]))}`;
  m = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if (m && month(m[1])) {
    const mo = month(m[1])!;
    const day = Number(m[2]);
    let year = m[3] ? Number(m[3]) : today.getFullYear();
    // No year given and the date is well in the past: it means next year.
    if (!m[3] && new Date(year, mo - 1, day).getTime() < today.getTime() - 60 * 86400000) year += 1;
    return `${year}-${pad(mo)}-${pad(day)}`;
  }
  return null;
}

const firstMatch = (text: string, patterns: RegExp[]) => {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m;
  }
  return null;
};

export function extractOrder(raw: string, opts: ExtractOptions = {}): Extracted {
  // Only the newest message counts: drop quoted lines and anything after an "On … wrote:" line.
  const lines: string[] = [];
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    if (/^\s*On .+wrote:\s*$/.test(line) || /^\s*>?\s*On .+wrote:\s*$/.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    lines.push(line);
  }
  const text = lines.join('\n');
  const out: Extracted = {};

  const po = text.match(/\bPO-\d{3,}\b/);
  if (po) out.po_number = po[0];

  const skuPattern = /\b[A-Z]{2,5}(?:-[A-Z0-9]{1,6}){1,3}\b/g;
  const candidates = [
    ...(text.match(/(?:Item|Product code|Product|SKU)\b[\s.:]*([A-Z0-9][A-Z0-9-]+)/)?.slice(1, 2) ?? []),
    ...(text.match(skuPattern) ?? []),
  ].filter((c) => !/^PO-/.test(c));
  const sku = opts.skus?.length ? candidates.find((c) => opts.skus!.includes(c)) : candidates[0];
  if (sku) out.item_sku = sku;

  const qty = firstMatch(text, [
    /\b(?:Quantity|Qty)\b[\s.:]*([\d,]+)/i,
    /\b([\d,]+)\s*(?:pcs|pieces|sheets|bags|units|ea|each)\b/i,
  ]);
  if (qty) out.quantity = qty[1].replace(/,/g, '');

  const price = firstMatch(text, [
    /\b(?:Unit price|Price per \w+|Price)\b[\s.:]*(?:USD|US\$|\$)?\s*([\d,]*\.?\d+)/i,
    /\bat\s*(?:USD|\$)\s*([\d,]*\.?\d+)/i,
    /\$\s*([\d,]*\.\d+)/,
  ]);
  if (price) out.unit_price = price[1].replace(/,/g, '');

  const dateLine = firstMatch(text, [/\b(?:Delivery date|Ship date|Delivery|Deliver(?:y)? on|deliver on|Arrival)\b[\s.:]*([^\n]+)/i]);
  const date = (dateLine && parseDate(dateLine[1], opts.today)) ?? null;
  if (date) out.delivery_date = date;

  const vendor = opts.vendors?.find((v) => text.toLowerCase().includes(v.toLowerCase()));
  if (vendor) out.supplier = vendor;

  return out;
}
