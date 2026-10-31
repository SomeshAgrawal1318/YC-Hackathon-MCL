import { T, VAR_KEYS, applyAction, initialDesktop } from './desktop';
import { LAST_PRICE } from './scenario';
import type { Action, Banner, DesktopState, Outcome, RunPlan, RunStep, TraceEvent, VarKey, Variation, Workflow } from './schema';

const REQUIRED: VarKey[] = ['po_number', 'item_sku', 'quantity'];
const READ_ORDER: VarKey[] = ['po_number', 'item_sku', 'quantity', 'unit_price', 'delivery_date', 'supplier'];

export const BOOT_MS = 1800;

/** Plan what the agent does on one VM for one variation. Deterministic, so the replay can be scrubbed. */
export function planRun(wf: Workflow, v: Variation): RunPlan {
  const events: TraceEvent[] = [];
  const steps: RunStep[] = [];
  let state: DesktopState = initialDesktop();
  let t = BOOT_MS;
  let n = 0;

  const push = (a: Action, dur?: number, after?: (s: DesktopState) => void) => {
    state = applyAction(state, a);
    if (after) after(state);
    events.push({ ...a, id: `${v.id}-${n++}`, t, dur, snap: state });
  };
  const note = (b: Banner) => {
    state = { ...state, note: b };
    events.push({ kind: 'read', app: state.focus, id: `${v.id}-${n++}`, t, snap: state });
  };

  const spans = new Map<VarKey, string>();
  for (const part of v.message.body) if (typeof part !== 'string') spans.set(part.key, part.text);
  const supplierName = v.message.company;

  // Trigger: the email arrives, open it.
  let s0 = t;
  push({ kind: 'app_switch', app: 'mail', target: T.task('mail') });
  t += 700;
  push({ kind: 'click', app: 'mail', target: T.message(v.message), messageId: v.message.id });
  t += 600;
  steps.push({ nodeId: 'trigger', label: `Opened the email from ${supplierName}`, t0: s0, t1: t, state: 'done' });

  // Extract: read each value.
  s0 = t;
  for (const key of READ_ORDER) {
    const text = spans.get(key);
    if (!text) continue;
    push({ kind: 'read', app: 'mail', target: T.value(key, text), varKey: key, value: text });
    t += 420;
  }
  const missing = REQUIRED.filter((k) => !v.expected[k]);
  if (missing.length) {
    t += 300;
    const what = missing.map((k) => (k === 'po_number' ? 'PO number' : k === 'item_sku' ? 'item' : 'quantity')).join(', ');
    note({ kind: 'flagged', title: 'Flagged for review', detail: `No ${what} in the email. Nothing was entered in the ERP.` });
    steps.push({ nodeId: 'extract', label: `No ${what} found, stopped`, t0: s0, t1: t, state: 'flagged' });
    return finish('flagged', `Stopped: no ${what} in the email`, {});
  }
  steps.push({ nodeId: 'extract', label: `Read ${READ_ORDER.filter((k) => spans.has(k)).length} values`, t0: s0, t1: t, state: 'done' });

  // Open the ERP and a new PO.
  s0 = t;
  t += 300;
  push({ kind: 'app_switch', app: 'erp', target: T.task('erp') });
  t += 700;
  push({ kind: 'click', app: 'erp', target: T.newPo() });
  t += 700;
  steps.push({ nodeId: 'open', label: 'Opened a new purchase order', t0: s0, t1: t, state: 'done' });

  // Fill each mapped field with the extracted (normalized) value.
  s0 = t;
  const entered: Partial<Record<VarKey, string>> = {};
  for (const field of VAR_KEYS) {
    const src = wf.edits.mappings[field];
    if (!src) continue;
    const value = v.expected[src] ?? '';
    entered[field] = value;
    const dur = Math.max(320, value.length * 42);
    push({ kind: 'type', app: 'erp', target: T.field(field), field, value }, dur);
    t += dur + 220;
  }
  steps.push({ nodeId: 'fill', label: `Filled ${Object.keys(entered).length} fields`, t0: s0, t1: t, state: 'done' });

  // Price check, if the reviewer asked for one.
  const policy = wf.edits.answer;
  if (policy === 'ask' || policy === 'flag') {
    s0 = t;
    t += 500;
    const last = LAST_PRICE[v.expected.item_sku ?? ''];
    const price = Number(v.expected.unit_price);
    const change = last ? ((price - last) / last) * 100 : 0;
    const label = last ? `Price ${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs last order` : 'No earlier order to compare';
    const over = Math.abs(change) > wf.edits.threshold;
    steps.push({ nodeId: 'decision', label, t0: s0, t1: t, state: 'done' });
    if (over) {
      const detail = `Unit price $${price.toFixed(2)} is ${change.toFixed(1)}% above the last order ($${last.toFixed(2)}).`;
      if (policy === 'ask') {
        note({ kind: 'paused', title: 'Waiting for a buyer to approve', detail });
        steps.push({ nodeId: 'approval', label: 'Sent to the buyer on duty', t0: t, t1: t + 600, state: 'paused' });
        t += 600;
        return finish('paused', 'Paused for buyer approval (price change)', entered);
      }
      note({ kind: 'flagged', title: 'Flagged for review', detail });
      steps.push({ nodeId: 'flag', label: 'Flagged, not saved', t0: t, t1: t + 600, state: 'flagged' });
      t += 600;
      return finish('flagged', 'Flagged: price change', entered);
    }
  }

  // Save.
  s0 = t;
  t += 300;
  push({ kind: 'save', app: 'erp', target: T.save() });
  t += 900;
  steps.push({ nodeId: 'save', label: `Saved ${entered.po_number ?? 'the purchase order'}`, t0: s0, t1: t, state: 'done' });
  steps.push({ nodeId: 'end', label: 'Done', t0: t, t1: t + 200, state: 'done' });
  t += 200;
  return finish('completed', 'Saved the purchase order', entered);

  function finish(outcome: Outcome, outcomeNote: string, ent: Partial<Record<VarKey, string>>): RunPlan {
    return { variationId: v.id, events, steps, outcome, outcomeNote, duration: t + 400, entered: ent, bootMs: BOOT_MS };
  }
}

/** What a careful buyer would want for this variation, under the reviewer's chosen policy. */
export function expectedOutcome(wf: Workflow, v: Variation): Outcome {
  if (REQUIRED.some((k) => !v.expected[k])) return 'flagged';
  const policy = wf.edits.answer;
  const last = LAST_PRICE[v.expected.item_sku ?? ''];
  const change = last ? ((Number(v.expected.unit_price) - last) / last) * 100 : 0;
  if (Math.abs(change) > wf.edits.threshold) {
    if (policy === 'ask') return 'paused';
    if (policy === 'flag') return 'flagged';
  }
  return 'completed';
}

export interface RunResult {
  plan: RunPlan;
  expected: Outcome;
  fieldsOk: boolean;
  mismatches: VarKey[];
  passed: boolean;
}

/** Quantities and prices match as numbers ("750" and "750.00" are the same); the rest as text. */
export function sameValue(k: VarKey, a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (k === 'quantity' || k === 'unit_price') return Number(a.replace(/,/g, '')) === Number(b.replace(/,/g, ''));
  return a.trim() === b.trim();
}

export function judge(wf: Workflow, v: Variation, plan: RunPlan): RunResult {
  const expected = expectedOutcome(wf, v);
  const mismatches = Object.keys(plan.entered).filter((k) => !sameValue(k as VarKey, plan.entered[k as VarKey], v.expected[k as VarKey])) as VarKey[];
  const fieldsOk = mismatches.length === 0;
  return { plan, expected, fieldsOk, mismatches, passed: !plan.error && expected === plan.outcome && fieldsOk };
}
