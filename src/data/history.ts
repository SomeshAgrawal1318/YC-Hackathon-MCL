// The order history as recordings nobody had to make: each past purchase order in Odoo, matched to
// the supplier email it came from, shows what the email said and what the buyer entered and did.
// From the pairs: whether the workflow's field mappings hold, what buyers did when a price changed
// or the email lacked a PO number, and a backtest of the workflow against those decisions.
// Pure, so it is unit-tested (history.test.ts). The data comes from the knowledge base sync.
import { FIELD_LABEL, VAR_KEYS } from './desktop';
import { extractOrder } from './extract';
import type { Extracted } from './extract';
import type { KbSource, Knowledge, OdooOrder } from './knowledge';
import type { VarKey, WorkflowEdits } from './schema';

/** What the buyer did with the email. `checked`: something was missing, so they checked with the supplier first. */
export type BuyerAction = 'saved' | 'approval' | 'checked';

export interface PastCase {
  order: OdooOrder;
  email: KbSource;
  /** What the email says. */
  read: Extracted;
  /** What the buyer entered in Odoo. */
  entered: Partial<Record<VarKey, string>>;
  /** The previous order for the same item, which the price is compared with. */
  prev: { order: OdooOrder; price: number } | null;
  /** Unit price change in percent against `prev`. */
  change: number | null;
  action: BuyerAction;
  approver: string | null;
  /** The buyer's note that explains the action, if any. */
  note: string | null;
}

export interface OrderHistory {
  cases: PastCase[];
  /** Past orders in Odoo the workflow could learn from, matched to an email or not. */
  orders: number;
  /** Supplier order emails kept by the sync. */
  emails: number;
}

const REQUIRED: VarKey[] = ['po_number', 'item_sku', 'quantity'];

const num = (s?: string) => (s === undefined || s === '' ? NaN : Number(String(s).replace(/,/g, '')));
const fmtNum = (n: number) => String(Number(n.toFixed(4)));

/** Whether two values for a field are the same (numbers compared as numbers, text ignoring case). */
export function sameValue(field: VarKey, a?: string, b?: string): boolean {
  if (a === undefined || b === undefined) return false;
  if (field === 'quantity' || field === 'unit_price') return Math.abs(num(a) - num(b)) < 1e-6;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Orders a buyer entered: confirmed, with a line, and not made by a workflow test run. */
const humanOrders = (kb: Knowledge) =>
  (kb.orders ?? [])
    .filter((o) => o.lines.length && o.lines[0].sku && !/^MCL test/i.test(o.origin))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

const APPROVER = [/Approved by ([A-Z][a-z]+(?: [A-Z][a-z'-]+)+)/, /sent to ([A-Z][a-z]+(?: [A-Z][a-z'-]+)+) for approval/i];

function buyerAction(read: Extracted, notes: string[]): { action: BuyerAction; approver: string | null; note: string | null } {
  const approval = notes.find((n) => /approv/i.test(n));
  if (approval) {
    let approver: string | null = null;
    for (const n of notes) {
      for (const p of APPROVER) {
        const m = n.match(p);
        if (m) approver = m[1];
      }
    }
    return { action: 'approval', approver, note: notes.find((n) => /Approved by/i.test(n)) ?? approval };
  }
  if (REQUIRED.some((k) => !read[k])) return { action: 'checked', approver: null, note: notes[0] ?? null };
  return { action: 'saved', approver: null, note: notes[0] ?? null };
}

/** Pairs each past order with its email and works out what the buyer did. */
export function orderHistory(kb: Knowledge): OrderHistory {
  const orders = humanOrders(kb);
  const emails = Object.values(kb.sources).filter((s) => s.order && s.text);
  const vendors = Array.from(new Set([...orders.map((o) => o.vendor), ...Object.values(kb.entities).filter((e) => e.type === 'supplier').map((e) => e.name)])).filter(Boolean);
  const skus = Array.from(new Set(orders.map((o) => o.lines[0].sku!)));
  const read = new Map(emails.map((e) => [e.id, extractOrder(e.text!, { vendors, skus: skus.length ? skus : undefined })]));

  const cases: PastCase[] = [];
  for (const order of orders) {
    // By PO number; else an email whose reference (e.g. "BW-20114") the buyer's note mentions.
    let email = order.ref ? emails.find((e) => read.get(e.id)!.po_number === order.ref) : undefined;
    if (!email) {
      email = emails.find((e) => {
        const refs = (e.title.match(/\b[A-Z]{2,}-\d{3,}\b/g) ?? []).filter((r) => !r.startsWith('PO-'));
        return refs.some((r) => order.notes.some((n) => n.includes(r)));
      });
    }
    if (!email) continue;
    const line = order.lines[0];
    const prevOrder = [...orders].reverse().find((o) => o !== order && o.lines[0].sku === line.sku && (o.date < order.date || (o.date === order.date && o.id < order.id)));
    const prev = prevOrder ? { order: prevOrder, price: prevOrder.lines[0].price } : null;
    const r = read.get(email.id)!;
    cases.push({
      order,
      email,
      read: r,
      entered: {
        supplier: order.vendor || undefined,
        po_number: order.ref ?? undefined,
        item_sku: line.sku ?? undefined,
        quantity: fmtNum(line.qty),
        unit_price: fmtNum(line.price),
        delivery_date: order.arrival ?? undefined,
      },
      prev,
      change: prev && prev.price ? ((line.price - prev.price) / prev.price) * 100 : null,
      ...buyerAction(r, order.notes),
    });
  }
  return { cases, orders: orders.length, emails: emails.length };
}

// ---------- What the history says ----------

export interface FieldCheck {
  field: VarKey;
  agree: number;
  total: number;
  differ: Array<{ c: PastCase; email?: string; odoo?: string }>;
}

/** For each Odoo field: how often the email value it is mapped to is what the buyer entered. */
export function fieldChecks(h: OrderHistory, mappings?: WorkflowEdits['mappings']): FieldCheck[] {
  return VAR_KEYS.map((field) => {
    const src = mappings ? mappings[field] : field;
    const out: FieldCheck = { field, agree: 0, total: 0, differ: [] };
    for (const c of h.cases) {
      if (c.action === 'checked') continue; // The email was incomplete; the buyer filled in the rest by phone.
      const odoo = c.entered[field];
      if (odoo === undefined) continue;
      const email = src ? c.read[src] : undefined;
      out.total++;
      if (sameValue(field, email, odoo)) out.agree++;
      else out.differ.push({ c, email, odoo });
    }
    return out;
  });
}

export interface HistoryPricePolicy {
  /** A round threshold that separates the changes buyers saved from the ones they sent for approval. */
  threshold: number;
  approver: string | null;
  asked: PastCase[];
  saved: PastCase[];
  /** Largest change saved without approval, smallest change sent for approval (percent). */
  maxSaved: number;
  minAsked: number;
}

const ROUND = [1, 2, 3, 5, 10, 15, 20, 25, 30, 50];

/** What buyers did when a price changed: the threshold above which they asked for approval. */
export function pricePolicyFromHistory(h: OrderHistory): HistoryPricePolicy | null {
  const changed = h.cases.filter((c) => c.change !== null && Math.abs(c.change) > 0.05);
  const asked = changed.filter((c) => c.action === 'approval');
  const saved = changed.filter((c) => c.action === 'saved');
  if (!asked.length) return null;
  const maxSaved = Math.max(0, ...saved.map((c) => Math.abs(c.change!)));
  const minAsked = Math.min(...asked.map((c) => Math.abs(c.change!)));
  if (maxSaved >= minAsked) return null; // Buyers weren't consistent, so there is no threshold to learn.
  const fits = ROUND.filter((t) => t >= maxSaved && t < minAsked);
  const threshold = fits.length ? fits[fits.length - 1] : Math.max(1, Math.floor(minAsked));
  const names = asked.map((c) => c.approver).filter((n): n is string => !!n);
  return { threshold, approver: names[0] ?? null, asked, saved, maxSaved, minAsked };
}

/** Past emails that lacked a PO number, item or quantity, and what the buyer did about them. */
export const incompleteCases = (h: OrderHistory) => h.cases.filter((c) => c.action === 'checked');

// ---------- Backtest ----------

export type Decision = 'saved' | 'approval' | 'flagged';

export const DECISION_LABEL: Record<Decision, string> = {
  saved: 'Saved it',
  approval: 'Asked for approval',
  flagged: 'Stopped for a person',
};

export const BUYER_LABEL: Record<BuyerAction, string> = {
  saved: 'Saved it',
  approval: 'Asked for approval',
  checked: 'Checked with the supplier first',
};

export interface BacktestRow {
  c: PastCase;
  workflow: Decision;
  buyer: Decision;
  agree: boolean;
  why: string;
  fields: Array<{ field: VarKey; workflow?: string; buyer?: string; ok: boolean }>;
}

export interface Backtest {
  rows: BacktestRow[];
  decisionsAgree: number;
  valuesAgree: number;
  valuesTotal: number;
}

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

/** Runs the workflow's logic (read, map, decide) on every past email and compares with what the buyer did. */
export function backtest(h: OrderHistory, edits: WorkflowEdits): Backtest {
  const rows = h.cases.map((c): BacktestRow => {
    const missing = REQUIRED.filter((k) => !c.read[k]);
    let workflow: Decision = 'saved';
    let why: string;
    if (missing.length) {
      workflow = 'flagged';
      why = `No ${missing.map((k) => (k === 'po_number' ? 'PO number' : FIELD_LABEL[k].toLowerCase())).join(', ')} in the email`;
    } else if (c.change === null || !c.prev) {
      why = 'No earlier order to compare the price with';
    } else {
      const over = Math.abs(c.change) > edits.threshold;
      const vs = `${pct(c.change)} vs ${c.prev.order.ref ?? c.prev.order.name}`;
      if (over && (edits.answer === 'ask' || edits.answer === 'flag')) {
        workflow = edits.answer === 'ask' ? 'approval' : 'flagged';
        why = `Price ${vs}, over ${edits.threshold}%`;
      } else {
        why = over ? `Price ${vs}; no price rule yet, so it saves` : `Price ${vs}, within ${edits.threshold}%`;
      }
    }
    const buyer: Decision = c.action === 'approval' ? 'approval' : c.action === 'checked' ? 'flagged' : 'saved';
    const fields = workflow === 'flagged'
      ? []
      : VAR_KEYS.filter((f) => c.entered[f] !== undefined).map((field) => {
          const src = edits.mappings[field];
          const w = src ? c.read[src] : undefined;
          return { field, workflow: w, buyer: c.entered[field], ok: sameValue(field, w, c.entered[field]) };
        });
    return { c, workflow, buyer, agree: workflow === buyer, why, fields };
  });
  const values = rows.flatMap((r) => r.fields);
  return {
    rows,
    decisionsAgree: rows.filter((r) => r.agree).length,
    valuesAgree: values.filter((v) => v.ok).length,
    valuesTotal: values.length,
  };
}
