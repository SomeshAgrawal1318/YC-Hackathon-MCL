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
import { answeredByRecords, buildQuestions, mappingsFromRecording, nodeEvidence, priceSuggestion, workflowFromRecording } from './workflowBuilder';

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
    expect(ev('decision')).toMatchObject({ text: '8/8 past decisions match', weak: false });
    expect(ev('approval')?.text).toBe('2 past approvals by Dana Ortiz');
    // A threshold that is too loose shows as weak.
    const loose = { ...edits, threshold: 10 };
    expect(nodeEvidence(buildWorkflow(loose).nodes.find((n) => n.id === 'decision')!, h, loose)?.weak).toBe(true);
    expect(nodeEvidence(wf.nodes[0], orderHistory(emptyKnowledge()), edits)).toBeNull();
  });
});
