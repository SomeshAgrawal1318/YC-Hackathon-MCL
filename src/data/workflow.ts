import { FIELD_LABEL, VAR_KEYS } from './desktop';
import type { NodeKind, Question, Recording, TraceEvent, VarKey, WfEdge, WfNode, Workflow, WorkflowEdits } from './schema';

export const WORKFLOW_NAME = 'Supplier order email to purchase order';

export const NODE_W = 300;
const H: Record<NodeKind, number> = {
  trigger: 118,
  extract: 190,
  open: 118,
  fill: 222,
  decision: 136,
  approval: 118,
  flag: 118,
  save: 106,
  end: 48,
};
const GAP = 32;
const COL_GAP = 80;
// Two columns for the main flow (it reads like a snake), a third for branches added by answers.
const COL_B = NODE_W + COL_GAP;
const BRANCH_X = COL_B + NODE_W + COL_GAP;

export const PRICE_QUESTION: Question = {
  id: 'q-price',
  nodeId: 'save',
  text: 'What should happen if the unit price is different from the last order for this item?',
  why: 'In your recording the price matched the last order, so I couldn’t tell what you’d do if it didn’t.',
  options: [
    { id: 'ask', label: 'Ask me first', hint: 'Pause and send it to a buyer when the price is more than 5% off' },
    { id: 'save', label: 'Save anyway', hint: 'Any price is fine' },
    { id: 'flag', label: 'Don’t save, flag it', hint: 'Stop and put the email in the review queue' },
  ],
};

export function defaultEdits(): WorkflowEdits {
  return {
    answer: null,
    threshold: 5,
    titles: {},
    positions: {},
    mappings: { supplier: 'supplier', po_number: 'po_number', item_sku: 'item_sku', quantity: 'quantity', unit_price: 'unit_price', delivery_date: 'delivery_date' },
    approved: false,
  };
}

/** Derive the flowchart from the reviewer's edits. */
export function buildWorkflow(edits: WorkflowEdits): Workflow {
  const nodes: WfNode[] = [];
  const edges: WfEdge[] = [];
  let y = 0;
  let colX = 0;
  const add = (n: Omit<WfNode, 'x' | 'y' | 'w' | 'h'>, x?: number, at?: number) => {
    const h = H[n.kind];
    const pos = edits.positions[n.id];
    const node: WfNode = { ...n, title: edits.titles[n.id] ?? n.title, x: pos?.x ?? x ?? colX, y: pos?.y ?? at ?? y, w: NODE_W, h };
    nodes.push(node);
    if (at === undefined) y += h + GAP;
    return node;
  };
  const link = (from: string, to: string, label?: string) => edges.push({ id: `${from}-${to}`, from, to, label });

  add({
    id: 'trigger', kind: 'trigger', title: 'New order email from a supplier',
    detail: 'Starts when an order confirmation lands in the Gmail inbox.',
    source: { tidPrefixes: ['task:mail', 'mail:msg:'] },
  });
  add({
    id: 'extract', kind: 'extract', title: 'Read the order details', ai: true,
    detail: 'Stops and flags the email if the PO number, item or quantity is missing.',
    vars: VAR_KEYS, source: { tidPrefixes: ['mail:val:'] },
  });
  add({
    id: 'open', kind: 'open', title: 'Open a new purchase order',
    detail: 'Odoo, Purchase, New request for quotation',
    source: { tidPrefixes: ['task:erp', 'erp:new-po'] },
  });
  colX = COL_B;
  y = 0;
  add({
    id: 'fill', kind: 'fill', title: 'Fill in the purchase order',
    detail: 'Terms and conditions stay empty, like in the recording.',
    source: { tidPrefixes: ['erp:field:'] },
  });
  link('trigger', 'extract');
  link('extract', 'open');
  link('open', 'fill');

  const policy = edits.answer;
  const over = `Over ${edits.threshold}%`;
  const saveNode = {
    id: 'save', kind: 'save' as const, title: 'Save the purchase order',
    detail: 'Clicks Save and checks that Odoo saved it.',
    source: { tidPrefixes: ['erp:save'] }, questionId: policy ? undefined : PRICE_QUESTION.id,
  };
  const flagNode = {
    id: 'flag', kind: 'flag' as const, title: 'Flag for review and stop',
    detail: 'Nothing is saved. The email goes to the review queue.',
  };
  if (policy === 'ask' || policy === 'flag') {
    const rowY = y;
    add({
      id: 'decision', kind: 'decision', title: `Is the unit price within ${edits.threshold}% of the last order?`,
      detail: 'Compares with the last purchase order for the same item.',
    });
    link('fill', 'decision');
    link('decision', 'save', `Within ${edits.threshold}%`);
    if (policy === 'ask') {
      add({
        id: 'approval', kind: 'approval', title: 'Ask a buyer to approve',
        detail: 'Sends the draft and the price change to the buyer on duty, then waits.',
      }, BRANCH_X, rowY);
      const saveY = y;
      add(saveNode);
      // Below the save row, so the "Approved" line into Save stays clear.
      add(flagNode, BRANCH_X, saveY + H.save + 24);
      link('decision', 'approval', over);
      link('approval', 'save', 'Approved');
      link('approval', 'flag', 'Rejected');
    } else {
      add(flagNode, BRANCH_X, rowY + (H.decision - H.flag) / 2);
      add(saveNode);
      link('decision', 'flag', over);
    }
  } else {
    add(saveNode);
    link('fill', 'save');
  }
  add({ id: 'end', kind: 'end', title: 'Done', detail: '' });
  link('save', 'end');

  return { name: WORKFLOW_NAME, nodes, edges, question: PRICE_QUESTION, edits };
}

/** Events in the recording that taught us a node. Trigger and Open only use their first occurrences. */
export function sourceEvents(node: WfNode, rec: Recording): TraceEvent[] {
  if (!node.source?.tidPrefixes) return [];
  const prefixes = node.source.tidPrefixes;
  const matches = rec.events.filter((e) => e.target && prefixes.some((p) => e.target!.tid.startsWith(p)));
  if (node.kind === 'trigger' || node.kind === 'open') {
    // First switch into the app plus the first click there.
    const out: TraceEvent[] = [];
    for (const p of prefixes) {
      const hit = matches.find((e) => e.target!.tid.startsWith(p));
      if (hit) out.push(hit);
    }
    return out.sort((a, b) => a.t - b.t);
  }
  return matches;
}

export function sourceRange(node: WfNode, rec: Recording): [number, number] | null {
  const evs = sourceEvents(node, rec);
  if (!evs.length) return null;
  const start = Math.max(0, evs[0].t - 500);
  const last = evs[evs.length - 1];
  const end = Math.min(rec.duration, last.t + (last.dur ?? 0) + 700);
  return [start, end];
}

/** Which workflow node an event belongs to (for the Recordings detail panel). */
export function nodeForEvent(ev: TraceEvent, wf: Workflow, rec: Recording): WfNode | null {
  for (const n of wf.nodes) {
    if (sourceEvents(n, rec).some((e) => e.id === ev.id)) return n;
  }
  return null;
}

/** Values the person entered for each field during the recording. */
export function sampleValues(rec: Recording): Partial<Record<VarKey, string>> {
  const out: Partial<Record<VarKey, string>> = {};
  for (const e of rec.events) {
    if ((e.kind === 'type' || e.kind === 'paste') && e.field && e.field !== 'notes') out[e.field] = e.value ?? '';
  }
  return out;
}

export const mappingRows = (wf: Workflow) =>
  VAR_KEYS.map((field) => ({ field, label: FIELD_LABEL[field], v: wf.edits.mappings[field] }));
