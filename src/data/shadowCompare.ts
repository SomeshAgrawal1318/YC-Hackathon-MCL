// Shadow mode logic: what the workflow would have entered for an order email, and how that draft
// compares with what the buyer actually entered in Odoo. Pure, so it is unit-tested and shared
// with the ShadowDeployment actor (actors/src/actors.ts). Imports use .js extensions for that project.
import { extractOrder, type Extracted } from './extract.js';
import type { VarKey, WorkflowEdits } from './schema.js';

export const SHADOW_FIELDS: VarKey[] = ['supplier', 'po_number', 'item_sku', 'quantity', 'unit_price', 'delivery_date'];

const FIELD_NAME: Record<VarKey, string> = {
  supplier: 'vendor',
  po_number: 'vendor reference',
  item_sku: 'item',
  quantity: 'quantity',
  unit_price: 'unit price',
  delivery_date: 'expected arrival',
};

/** The parts of the approved workflow that shadow mode needs. */
export type ShadowEdits = Pick<WorkflowEdits, 'answer' | 'threshold' | 'mappings'>;

export interface Catalog {
  vendors: string[];
  skus: string[];
}

/** waiting: drafted, the buyer has not entered the order yet. skipped: not an order email. */
export type ShadowStatus = 'waiting' | 'matched' | 'different' | 'escalated' | 'skipped';

export type Values = Partial<Record<VarKey, string>>;

export interface Draft {
  /** What the email says. */
  extracted: Extracted;
  /** What the workflow would type into Odoo (after the approved field mappings). */
  draft: Values;
  /** Required values the email did not have. */
  missing: string[];
  /** False for emails that are not supplier orders (no item and no PO number). */
  isOrder: boolean;
}

const REQUIRED: Array<[VarKey, string]> = [['po_number', 'PO number'], ['item_sku', 'item'], ['quantity', 'quantity']];

export function draftFromEmail(text: string, catalog: Catalog, edits: ShadowEdits, today?: Date): Draft {
  const extracted = extractOrder(text, { vendors: catalog.vendors, skus: catalog.skus, today });
  const draft: Values = {};
  for (const field of SHADOW_FIELDS) {
    const src = edits.mappings[field];
    const value = src ? extracted[src] : undefined;
    if (value) draft[field] = value;
  }
  const missing = REQUIRED.filter(([k]) => !extracted[k]).map(([, label]) => label);
  return { extracted, draft, missing, isOrder: !!(extracted.item_sku || extracted.po_number) };
}

export interface PriceCheck {
  over: boolean;
  /** Percent change against the last confirmed price; 0 when there is none. */
  change: number;
}

/** The workflow's price question, the same rule as the decision step in src/lib/runner.ts. */
export function priceCheck(unitPrice: string | undefined, lastPrice: number | null, edits: ShadowEdits): PriceCheck {
  const price = Number(unitPrice);
  const change = lastPrice && Number.isFinite(price) ? ((price - lastPrice) / lastPrice) * 100 : 0;
  const asks = edits.answer === 'ask' || edits.answer === 'flag';
  return { over: asks && !!lastPrice && Math.abs(change) > edits.threshold, change };
}

function norm(field: VarKey, v: string | undefined): string {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (field === 'quantity' || field === 'unit_price') {
    const n = Number(s.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n.toFixed(field === 'unit_price' ? 2 : 3) : s;
  }
  return s.toLowerCase();
}

export interface FieldDiff {
  field: VarKey;
  draft: string;
  buyer: string;
}

/** Fields where the draft and the buyer's entry disagree. Only fields the draft filled count. */
export function compare(draft: Values, buyer: Values): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const field of SHADOW_FIELDS) {
    if (!draft[field]) continue;
    if (norm(field, draft[field]) !== norm(field, buyer[field])) out.push({ field, draft: draft[field]!, buyer: buyer[field] ?? '(empty)' });
  }
  return out;
}

export function describeDiffs(diffs: FieldDiff[]): string {
  if (!diffs.length) return 'All fields matched the buyer’s entry';
  return diffs.map((d) => `${FIELD_NAME[d.field]}: draft ${d.draft}, buyer ${d.buyer}`).join('; ');
}

export interface ShadowItem {
  status: ShadowStatus;
  /** When the result was decided (ms). */
  resolvedAt: number | null;
}

export interface ShadowTotals {
  handled: number;
  matched: number;
  different: number;
  escalated: number;
  streak: number;
  streakGoal: number;
  goalRate: number;
}

export interface ShadowDay {
  day: string;
  handled: number;
  matched: number;
}

export const STREAK_GOAL = 50;
export const GOAL_RATE = 95;

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Totals over resolved items, in the shape of SHADOW_TOTALS (src/data/shadow.ts).
 * The streak counts matches in a row, newest first: a difference ends it, a price change sent to
 * a buyer neither counts nor ends it.
 */
export function totals(items: ShadowItem[]): ShadowTotals {
  const done = items.filter((i) => i.status === 'matched' || i.status === 'different' || i.status === 'escalated');
  const count = (s: ShadowStatus) => done.filter((i) => i.status === s).length;
  let streak = 0;
  for (const i of [...done].sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))) {
    if (i.status === 'different') break;
    if (i.status === 'matched') streak++;
  }
  return { handled: done.length, matched: count('matched'), different: count('different'), escalated: count('escalated'), streak, streakGoal: STREAK_GOAL, goalRate: GOAL_RATE };
}

/** Handled and matched per day for the last `days` days (oldest first), by resolve time. */
export function dailyBuckets(items: ShadowItem[], now: number, days = 7): ShadowDay[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const out: Array<ShadowDay & { from: number; to: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const from = new Date(start);
    from.setDate(start.getDate() - i);
    const to = new Date(from);
    to.setDate(from.getDate() + 1);
    out.push({ day: DAY[from.getDay()], handled: 0, matched: 0, from: from.getTime(), to: to.getTime() });
  }
  for (const i of items) {
    if (!i.resolvedAt || (i.status !== 'matched' && i.status !== 'different' && i.status !== 'escalated')) continue;
    const b = out.find((d) => i.resolvedAt! >= d.from && i.resolvedAt! < d.to);
    if (!b) continue;
    b.handled++;
    if (i.status === 'matched') b.matched++;
  }
  return out.map(({ day, handled, matched }) => ({ day, handled, matched }));
}
