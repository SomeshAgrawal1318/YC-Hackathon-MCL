// Builds the workflow from a recording plus what the company's records already say.
//
// The recording shows the "what": which email value the buyer put into which Odoo field. It can't
// show the "what if": a price that changed, an email with no PO number. Those come from the
// knowledge base (a rule someone wrote down, like Dana's price email) and from the order history
// (past emails matched to the orders buyers entered: src/data/history.ts). Only what neither
// answers is left as a question for the reviewer.
//
// Fallback: whatever can't be worked out comes from the prebuilt workflow (defaultEdits in
// src/data/workflow.ts): a field the recording didn't show, or showed with a value that isn't in the
// email, gets the prebuilt mapping; with fewer than 2 fields from the email the whole mapping is
// prebuilt; with no rule and no history the prebuilt price question stays for the reviewer. If the
// builder fails outright, the store uses the prebuilt workflow (src/lib/store.ts, startBuild).
//
// What a recording gives you:
//   rec.events  workflow-level actions (opened email, copied value, pasted into a field, saved),
//               each with the real UI Automation target (role, name, path, AutomationId, screen rect)
//   rec.raw     everything trace-helper reported (clicks, values, shortcuts, clipboard, focus)
//   rec.video   the screen video (rec.video.blob) and how its time lines up with the events
import { FIELD_LABEL, VAR_KEYS } from '../data/desktop';
import { bodyText, extractOrder } from '../data/extract';
import { backtest, fieldChecks, incompleteCases, orderHistory, pricePolicyFromHistory, sameValue } from '../data/history';
import type { OrderHistory } from '../data/history';
import { priceRule } from '../data/knowledge';
import type { Knowledge } from '../data/knowledge';
import { RECORDED_EMAIL, inboxFor } from '../data/scenario';
import type { PricePolicy, Recording, VarKey, WfNode, WorkflowEdits } from '../data/schema';
import { PRICE_QUESTION, defaultEdits } from '../data/workflow';

// ---------- From the recording ----------

export interface SeenField {
  field: VarKey;
  how: 'pasted' | 'typed';
  value: string;
  /** The email value it matches, or null when it wasn't in the email. */
  from: VarKey | null;
}

/** The values in the email the buyer opened in the recording. */
function recordedEmailValues(rec: Recording): Partial<Record<VarKey, string>> {
  const opened = rec.events.find((e) => e.kind === 'click' && e.messageId)?.messageId;
  const msg = inboxFor(rec.inboxId).find((m) => m.id === opened) ?? RECORDED_EMAIL;
  const out: Partial<Record<VarKey, string>> = extractOrder(bodyText(msg), { vendors: [msg.company] });
  // Marked spans in the email (the demo's own data) win over the extractor.
  for (const p of msg.body) if (typeof p !== 'string' && !out[p.key]) out[p.key] = p.text;
  return out;
}

/** Which email value went into which Odoo field, as the recording shows it. */
export function mappingsFromRecording(rec: Recording): { mappings: WorkflowEdits['mappings']; seen: SeenField[] } {
  const mappings = { ...defaultEdits().mappings };
  const email = recordedEmailValues(rec);
  const seen = new Map<VarKey, SeenField>();
  for (const e of rec.events) {
    if ((e.kind !== 'paste' && e.kind !== 'type') || !e.field || e.field === 'notes' || !e.value) continue;
    const field = e.field;
    // A paste of a copied email value; otherwise whichever email value the typed text matches.
    const copied = e.kind === 'paste' ? rec.events.find((c) => c.kind === 'copy' && c.varKey && c.value?.trim() === e.value!.trim() && c.t < e.t)?.varKey : undefined;
    const matches = VAR_KEYS.filter((k) => sameValue(k, email[k], e.value));
    const from = copied ?? (matches.includes(field) ? field : matches[0]) ?? null;
    seen.set(field, { field, how: e.kind === 'paste' ? 'pasted' : 'typed', value: e.value, from });
    if (from) mappings[field] = from;
  }
  return { mappings, seen: VAR_KEYS.map((k) => seen.get(k)).filter((s): s is SeenField => !!s) };
}

/** The prebuilt workflow's settings: each field takes the email value of the same name, price question open. */
export const prebuiltEdits = (): WorkflowEdits => defaultEdits();

/** Fewer fields than this matched to the email and the recording's mapping isn't trusted at all. */
const MIN_MATCHED_FIELDS = 2;

export interface MappingPlan {
  mappings: WorkflowEdits['mappings'];
  seen: SeenField[];
  /** Fields that use the prebuilt mapping, and why. */
  prebuilt: Array<{ field: VarKey; reason: string }>;
  /** Set when the whole mapping is the prebuilt one. */
  whole: string | null;
}

/** Agreement of one field's mapping with what buyers entered on past orders (null without history). */
function agreement(h: OrderHistory | undefined, field: VarKey, src: VarKey | null): number | null {
  if (!h?.cases.length) return null;
  const m = { ...defaultEdits().mappings, [field]: src };
  const c = fieldChecks(h, m).find((x) => x.field === field)!;
  return c.total ? c.agree / c.total : null;
}

/**
 * The field mappings to use: the recording's where it clearly shows them, the prebuilt ones where it
 * doesn't, or where past orders back the prebuilt mapping better than the recorded one.
 */
export function planMappings(rec: Recording, h?: OrderHistory): MappingPlan {
  const prebuilt = prebuiltEdits().mappings;
  let fromRec: ReturnType<typeof mappingsFromRecording>;
  try {
    fromRec = mappingsFromRecording(rec);
  } catch (e) {
    return { mappings: prebuilt, seen: [], prebuilt: VAR_KEYS.map((field) => ({ field, reason: 'the recording couldn’t be read' })), whole: `The recording couldn’t be read (${(e as Error).message}).` };
  }
  const { seen } = fromRec;
  const matched = seen.filter((s) => s.from);
  if (matched.length < MIN_MATCHED_FIELDS) {
    const whole = matched.length
      ? `Only ${matched.length} field in the recording matched a value in the email.`
      : seen.length ? 'None of the fields filled in the recording matched a value in the email.' : 'The recording didn’t show any fields being filled.';
    return { mappings: prebuilt, seen, prebuilt: VAR_KEYS.map((field) => ({ field, reason: 'the recording didn’t show enough' })), whole };
  }
  const mappings = { ...prebuilt };
  const out: MappingPlan['prebuilt'] = [];
  for (const field of VAR_KEYS) {
    const s = seen.find((x) => x.field === field);
    if (!s) {
      out.push({ field, reason: 'not seen in the recording' });
      continue;
    }
    if (!s.from) {
      out.push({ field, reason: `“${s.value}” isn’t in the email` });
      continue;
    }
    const recorded = agreement(h, field, s.from);
    const standard = agreement(h, field, prebuilt[field]);
    if (s.from !== prebuilt[field] && recorded !== null && standard !== null && standard > recorded) {
      out.push({ field, reason: `past orders match {${prebuilt[field]}} (${Math.round(standard * 100)}%) better than the recorded {${s.from}} (${Math.round(recorded * 100)}%)` });
      continue;
    }
    mappings[field] = s.from;
  }
  return { mappings, seen, prebuilt: out, whole: null };
}

// ---------- The price question ----------

export type AnswerSource = 'recording' | 'knowledge' | 'history' | 'prebuilt' | 'you';

export interface PriceSuggestion {
  answer: PricePolicy;
  threshold: number;
  by: 'knowledge' | 'history';
  approver: string | null;
}

/** The company's answer to the price question: a written rule first, else what buyers did. */
export function priceSuggestion(kb: Knowledge, h: OrderHistory = orderHistory(kb)): PriceSuggestion | null {
  const rule = priceRule(kb);
  if (rule) return { answer: rule.action, threshold: rule.threshold, by: 'knowledge', approver: rule.approver || null };
  const p = pricePolicyFromHistory(h);
  if (p) return { answer: 'ask', threshold: p.threshold, by: 'history', approver: p.approver };
  return null;
}

export async function workflowFromRecording(rec: Recording, kb: Knowledge): Promise<WorkflowEdits | null> {
  const edits = prebuiltEdits();
  // A broken or half-synced knowledge base counts as no organisation context: prebuilt answers then.
  let h: OrderHistory | undefined;
  let s: PriceSuggestion | null = null;
  try {
    h = orderHistory(kb);
    s = priceSuggestion(kb, h);
  } catch {
    h = undefined;
  }
  edits.mappings = planMappings(rec, h).mappings;
  if (s) {
    edits.answer = s.answer;
    edits.threshold = s.threshold;
  }
  return edits;
}

// ---------- What the reviewer sees ----------

export interface Evidence {
  by: AnswerSource;
  text: string;
  quote?: string;
  /** Odoo orders this is based on. */
  orders?: Array<{ label: string; url?: string }>;
}

export interface BuildQuestion {
  id: 'mapping' | 'price' | 'missing';
  text: string;
  evidence: Evidence[];
  /** Still needs the reviewer. */
  open: boolean;
  suggestion?: PriceSuggestion & { applied: boolean };
  /** Mapping question: how much of it came from the prebuilt workflow. */
  prebuilt?: { whole: boolean; fields: number };
}

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const orderRef = (o: { ref: string | null; name: string; url?: string }) => ({ label: o.ref ?? o.name, url: o.url });
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The questions a recording can't answer by itself, and what the recording, rules and history say. */
export function buildQuestions(rec: Recording, kb: Knowledge, edits: WorkflowEdits, h: OrderHistory = orderHistory(kb)): BuildQuestion[] {
  const out: BuildQuestion[] = [];

  // Which value goes where.
  const plan = planMappings(rec, h);
  const { seen } = plan;
  const pasted = seen.filter((s) => s.how === 'pasted').length;
  const mapping: BuildQuestion = {
    id: 'mapping',
    text: 'Which email value goes into each Odoo field?',
    open: false,
    evidence: [{
      by: 'recording',
      text: seen.length
        ? `You filled ${seen.length} of ${VAR_KEYS.length} fields: ${pasted} pasted from the email, ${seen.length - pasted} typed.`
        : 'The recording didn’t show the fields being filled.',
    }],
  };
  mapping.prebuilt = { whole: !!plan.whole, fields: plan.prebuilt.length };
  if (plan.whole) {
    mapping.evidence.push({ by: 'prebuilt', text: `${plan.whole} So every field uses the prebuilt workflow’s mapping.` });
  } else if (plan.prebuilt.length) {
    mapping.evidence.push({ by: 'prebuilt', text: `From the prebuilt workflow: ${plan.prebuilt.map((p) => `${FIELD_LABEL[p.field]} (${p.reason})`).join('; ')}.` });
  }
  if (h.cases.length) {
    const checks = fieldChecks(h, edits.mappings);
    const agree = checks.reduce((n, c) => n + c.agree, 0);
    const total = checks.reduce((n, c) => n + c.total, 0);
    const differ = checks.flatMap((c) => c.differ.map((d) => ({ ...d, field: c.field })));
    const unseen = VAR_KEYS.filter((k) => !seen.some((s) => s.field === k));
    const parts = [`${agree} of ${total} values match what buyers entered on ${h.cases.length} past orders.`];
    if (unseen.length && seen.length && !plan.whole) parts.push(`That covers ${list(unseen.map((k) => FIELD_LABEL[k]))}, which the recording didn’t show.`);
    for (const d of differ.slice(0, 2)) {
      parts.push(`${d.c.order.ref ?? d.c.order.name}: ${FIELD_LABEL[d.field]} was ${d.odoo ?? 'empty'}, the email said ${d.email ?? 'nothing'}${d.c.note ? ` (“${d.c.note}”)` : ''}.`);
    }
    mapping.evidence.push({ by: 'history', text: parts.join(' '), orders: differ.slice(0, 2).map((d) => orderRef(d.c.order)) });
  }
  out.push(mapping);

  // Price changes.
  const rule = priceRule(kb);
  const hp = pricePolicyFromHistory(h);
  const s = priceSuggestion(kb, h);
  const price: BuildQuestion = {
    id: 'price',
    text: PRICE_QUESTION.text,
    open: edits.answer === null,
    evidence: [{ by: 'recording', text: 'In the recording the price matched the last order, so it couldn’t show what you’d do otherwise.' }],
  };
  if (rule) {
    const where = rule.source ? `${rule.source.from ? `${rule.source.from}, ` : ''}“${rule.source.title}”` : 'the knowledge base';
    price.evidence.push({ by: 'knowledge', text: rule.entity.props?.statement || rule.entity.summary, quote: `“${rule.quote}” · ${where}` });
  }
  if (hp) {
    const asked = hp.asked.map((c) => `${c.order.ref ?? c.order.name} (${pct(c.change!)})`);
    const who = hp.approver ?? 'a buyer';
    let text = `${list(asked)} went to ${who} for approval. ${hp.saved.length} smaller change${hp.saved.length === 1 ? ' was' : 's were'} saved straight away (up to ${pct(hp.maxSaved)}).`;
    if (rule && rule.threshold !== hp.threshold) text += ` That points to ${hp.threshold}%, but the written rule says ${rule.threshold}%.`;
    price.evidence.push({ by: 'history', text, orders: hp.asked.map((c) => orderRef(c.order)) });
  }
  if (s) price.suggestion = { ...s, applied: edits.answer === s.answer && edits.threshold === s.threshold };
  else price.evidence.push({ by: 'prebuilt', text: 'No price rule in the knowledge base and no past price changes to learn from, so this is the prebuilt workflow’s question.' });
  if (edits.answer && !price.suggestion?.applied) {
    const label = PRICE_QUESTION.options.find((o) => o.id === edits.answer)?.label ?? edits.answer;
    price.evidence.push({ by: 'you', text: `You chose “${label}”${edits.answer === 'save' ? '' : ` over ${edits.threshold}%`}.` });
  }
  out.push(price);

  // Missing values.
  const incomplete = incompleteCases(h);
  const missing: BuildQuestion = {
    id: 'missing',
    text: 'What if the email has no PO number, item or quantity?',
    open: false,
    evidence: [{ by: 'recording', text: 'The recorded email had all of them.' }],
  };
  for (const c of incomplete.slice(0, 2)) {
    missing.evidence.push({ by: 'history', text: `“${c.email.title}” had no PO number. ${c.note ? `The buyer’s note: “${c.note}”` : 'The buyer checked with the supplier before entering it.'}`, orders: [orderRef(c.order)] });
  }
  missing.evidence.push({ by: 'prebuilt', text: incomplete.length ? 'So the workflow stops and flags the email for a person, as the buyer did.' : 'The workflow stops and flags the email for a person.' });
  out.push(missing);

  return out;
}

/** How many of the questions the company's records (knowledge base or order history) answered. */
export const answeredByRecords = (qs: BuildQuestion[]) => qs.filter((q) => q.evidence.some((e) => e.by === 'knowledge' || e.by === 'history')).length;

/**
 * A short badge for a flowchart step: how well the order history backs it (`detail` says it in full).
 * `weak` steps need a look.
 */
export function nodeEvidence(node: WfNode, h: OrderHistory, edits: WorkflowEdits): { text: string; detail: string; weak: boolean } | null {
  if (!h.cases.length) return null;
  const s = (n: number) => (n === 1 ? '' : 's');
  switch (node.kind) {
    case 'trigger':
      return { text: `${h.emails} past emails`, detail: `${h.emails} supplier order emails in the inbox, ${h.cases.length} of them matched to orders in Odoo`, weak: false };
    case 'extract': {
      const complete = h.cases.filter((c) => c.action !== 'checked');
      const read = complete.reduce((n, c) => n + VAR_KEYS.filter((k) => c.read[k]).length, 0);
      const total = complete.length * VAR_KEYS.length;
      return { text: `${read}/${total} read`, detail: `Read ${read} of ${total} values in ${complete.length} past emails`, weak: read < total };
    }
    case 'fill': {
      const checks = fieldChecks(h, edits.mappings);
      const agree = checks.reduce((n, c) => n + c.agree, 0);
      const total = checks.reduce((n, c) => n + c.total, 0);
      return { text: `${agree}/${total} match`, detail: `${agree} of ${total} values match what buyers entered on past orders`, weak: total > 0 && agree / total < 0.95 };
    }
    case 'decision': {
      const rows = backtest(h, edits).rows.filter((r) => r.c.change !== null && r.workflow !== 'flagged');
      const ok = rows.filter((r) => r.agree).length;
      return { text: `${ok}/${rows.length} match`, detail: `${ok} of ${rows.length} past price decisions match what buyers did`, weak: ok < rows.length };
    }
    case 'approval': {
      const p = pricePolicyFromHistory(h);
      return p
        ? { text: `${p.asked.length} past approval${s(p.asked.length)}`, detail: `${p.asked.length} past order${s(p.asked.length)} went for approval${p.approver ? ` to ${p.approver}` : ''}`, weak: false }
        : { text: 'Not in past orders', detail: 'No past order went for approval', weak: true };
    }
    case 'save': {
      const saved = h.cases.filter((c) => c.action === 'saved').length;
      return { text: `${saved} past saves`, detail: `Buyers saved ${saved} past orders straight away`, weak: false };
    }
    case 'flag': {
      const n = incompleteCases(h).length;
      return n ? { text: `${n} past case${s(n)}`, detail: `${n} past email${s(n)} lacked a PO number and went to a person`, weak: false } : null;
    }
    default:
      return null;
  }
}
