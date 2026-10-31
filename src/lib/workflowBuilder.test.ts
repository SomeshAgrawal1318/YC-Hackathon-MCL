import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seededKnowledge } from '../data/fixtures/seededKnowledge';
import { orderHistory } from '../data/history';
import { emptyKnowledge } from '../data/knowledge';
import type { Knowledge } from '../data/knowledge';
import { demoRecording } from '../data/scenario';
import { buildWorkflow, defaultEdits } from '../data/workflow';
import type { Recording } from '../data/schema';
import { answeredByRecords, buildQuestions, mappingsFromRecording, nodeEvidence, planMappings, prebuiltEdits, priceSuggestion, workflowFromRecording } from './workflowBuilder';

const require = createRequire(import.meta.url);
const { createKnowledge } = require('../../electron/knowledge.cjs');

/** Dana's price rule, as the knowledge base stores it after reading her email. */
function withDanasRule(kb: Knowledge, threshold = 5): Knowledge {
  const dir = mkdtempSync(join(tmpdir(), 'mcl-wb-'));
  const k = createKnowledge({ file: join(dir, 'kb.json'), hands: { exec: async () => ({}) }, broadcast: () => undefined });
  k._storeHistory({ orders: kb.orders, emails: Object.values(kb.sources).map((s) => ({ subject: s.title, from: s.from, text: s.text })) });
  return k._learnResult({ id: 'email:price', kind: 'email', title: 'Price changes on supplier orders', from: 'Dana Ortiz', at: 1 }, {
    entities: [{ name: 'Dana Ortiz', type: 'person', summary: 'Planning Manager.' }],
    facts: [],
    rules: [{ name: 'Price change approval', statement: `Orders more than ${threshold}% above the last price need Dana's approval.`, topic: 'price_change', threshold_percent: threshold, action: 'ask', approver: 'Dana Ortiz', quote: `more than ${threshold}% above our last order` }],
  });
}

describe('workflow builder', () => {
  const rec = demoRecording();

  it('reads the field mappings from the recording', () => {
    const { mappings, seen } = mappingsFromRecording(rec);
    expect(mappings).toEqual(defaultEdits().mappings);
    expect(seen).toHaveLength(6);
    expect(seen.find((s) => s.field === 'po_number')).toMatchObject({ how: 'pasted', from: 'po_number' });
    expect(seen.find((s) => s.field === 'quantity')).toMatchObject({ how: 'typed', from: 'quantity' });
  });

  it('leaves the price question open when nothing answers it', async () => {
    const edits = await workflowFromRecording(rec, emptyKnowledge());
    expect(edits?.answer).toBeNull();
    const qs = buildQuestions(rec, emptyKnowledge(), edits!);
    expect(qs.find((q) => q.id === 'price')!.open).toBe(true);
    expect(answeredByRecords(qs)).toBe(0);
  });

  it('answers the price question from the order history alone', async () => {
    const kb = seededKnowledge();
    const edits = (await workflowFromRecording(rec, kb))!;
    expect(edits).toMatchObject({ answer: 'ask', threshold: 5 });
    const qs = buildQuestions(rec, kb, edits);
    const price = qs.find((q) => q.id === 'price')!;
    expect(price.open).toBe(false);
    expect(price.suggestion).toMatchObject({ by: 'history', applied: true, approver: 'Dana Ortiz' });
    expect(price.evidence.find((e) => e.by === 'history')!.text).toContain('PO-4433 (+6.4%) and PO-4452 (+7.4%) went to Dana Ortiz');
    expect(answeredByRecords(qs)).toBe(3);
  });

  it('prefers the written rule, and says when the history disagrees with it', () => {
    const kb = withDanasRule(seededKnowledge(), 8);
    expect(priceSuggestion(kb)).toMatchObject({ by: 'knowledge', threshold: 8 });
    const price = buildQuestions(rec, kb, { ...defaultEdits(), answer: 'ask', threshold: 8 }).find((q) => q.id === 'price')!;
    expect(price.evidence.map((e) => e.by)).toEqual(['recording', 'knowledge', 'history']);
    expect(price.evidence[2].text).toContain('points to 5%, but the written rule says 8%');
  });

  it('cites the phone order for missing PO numbers', () => {
    const missing = buildQuestions(rec, seededKnowledge(), defaultEdits()).find((q) => q.id === 'missing')!;
    expect(missing.evidence.some((e) => e.by === 'history' && e.text.includes('BW-20114'))).toBe(true);
  });

  it('marks how well the history backs each step', () => {
    const kb = seededKnowledge();
    const h = orderHistory(kb);
    const edits = { ...defaultEdits(), answer: 'ask' as const, threshold: 5 };
    const wf = buildWorkflow(edits);
    const ev = (id: string) => nodeEvidence(wf.nodes.find((n) => n.id === id)!, h, edits);
    expect(ev('fill')).toMatchObject({ weak: false });
    expect(ev('decision')).toMatchObject({ text: '8/8 match', weak: false });
    expect(ev('approval')?.detail).toBe('2 past orders went for approval to Dana Ortiz');
    // A threshold that is too loose shows as weak.
    const loose = { ...edits, threshold: 10 };
    expect(nodeEvidence(buildWorkflow(loose).nodes.find((n) => n.id === 'decision')!, h, loose)?.weak).toBe(true);
    expect(nodeEvidence(wf.nodes[0], orderHistory(emptyKnowledge()), edits)).toBeNull();
  });
});

describe('falling back to the prebuilt workflow', () => {
  const base = demoRecording();
  const prebuilt = prebuiltEdits().mappings;
  /** The demo recording with some events changed or dropped. */
  const variant = (fn: (events: Recording['events']) => Recording['events']): Recording => ({ ...base, events: fn(base.events) });

  it('uses the prebuilt mapping when the recording shows too few fields', async () => {
    const rec = variant((evs) => evs.filter((e) => e.kind !== 'paste' && e.kind !== 'type'));
    const plan = planMappings(rec);
    expect(plan.whole).toBe('The recording didn’t show any fields being filled.');
    expect(plan.mappings).toEqual(prebuilt);
    const edits = await workflowFromRecording(rec, emptyKnowledge());
    expect(edits).toEqual(prebuiltEdits());
    const mapping = buildQuestions(rec, emptyKnowledge(), edits!)[0];
    expect(mapping.prebuilt).toEqual({ whole: true, fields: 6 });
    expect(mapping.evidence.some((e) => e.by === 'prebuilt')).toBe(true);
  });

  it('falls back field by field: unseen, or a value that isn’t in the email', () => {
    const rec = variant((evs) => evs
      .filter((e) => e.field !== 'delivery_date')
      .map((e) => (e.kind === 'type' && e.field === 'quantity' ? { ...e, value: '999' } : e)));
    const plan = planMappings(rec);
    expect(plan.whole).toBeNull();
    expect(plan.prebuilt.map((p) => p.field)).toEqual(['quantity', 'delivery_date']);
    expect(plan.prebuilt[0].reason).toBe('“999” isn’t in the email');
    expect(plan.mappings).toEqual(prebuilt);
  });

  it('prefers the prebuilt mapping when past orders back it and not the recorded one', () => {
    // Pasting the item code into Vendor Reference: the recording maps PO number <- {item_sku}.
    const rec = variant((evs) => evs.map((e) => (e.kind === 'paste' && e.field === 'po_number' ? { ...e, value: 'HRC-2MM' } : e)));
    expect(planMappings(rec).mappings.po_number).toBe('item_sku');
    const withHistory = planMappings(rec, orderHistory(seededKnowledge()));
    expect(withHistory.mappings.po_number).toBe('po_number');
    expect(withHistory.prebuilt[0].reason).toContain('past orders match {po_number} (100%)');
  });

  it('treats unreadable organisation context as none', async () => {
    const broken = { ...emptyKnowledge(), orders: [{ junk: true }], sources: { x: { order: true, text: 42 } } } as unknown as Knowledge;
    const edits = await workflowFromRecording(base, broken);
    expect(edits).toMatchObject({ answer: null, mappings: prebuilt });
    const price = buildQuestions(base, broken, edits!).find((q) => q.id === 'price')!;
    expect(price.open).toBe(true);
    expect(price.evidence.at(-1)?.by).toBe('prebuilt');
  });
});
