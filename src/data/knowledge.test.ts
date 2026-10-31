import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { graphData, priceRule, recordingSummary } from './knowledge';
import type { Knowledge } from './knowledge';
import { demoRecording } from './scenario';

const require = createRequire(import.meta.url);
const { createKnowledge } = require('../../electron/knowledge.cjs');

// Shaped like Claude's structured output for Dana's "Price changes on supplier orders" email.
const danaResult = {
  entities: [
    { name: 'Dana Ortiz', type: 'person', summary: 'Planning Manager.' },
    { name: 'Planning', type: 'team', summary: 'Plans stock and approves price exceptions.' },
    { name: 'Odoo', type: 'system', summary: 'Where purchase orders are saved.' },
  ],
  facts: [{ subject: 'Dana Ortiz', relation: 'works in', object: 'Planning', statement: 'Dana Ortiz is the Planning Manager.', quote: 'Dana Ortiz, Planning Manager' }],
  rules: [{
    name: 'Price change approval', statement: 'Orders more than 5% above the last price need Dana\'s approval before saving.',
    topic: 'price_change', threshold_percent: 5, action: 'ask', approver: 'Dana Ortiz', quote: 'more than 5% above our last order',
  }],
};

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'mcl-kb-'));
  return createKnowledge({ file: join(dir, 'kb.json'), hands: { exec: async () => ({}) }, broadcast: () => undefined });
}

describe('knowledge base', () => {
  it('learns a price rule the workflow can use', () => {
    const k = fresh();
    const kb: Knowledge = k._learnResult({ id: 'email:price', kind: 'email', title: 'Price changes on supplier orders', from: 'Dana Ortiz', at: 1 }, danaResult);
    const rule = priceRule(kb)!;
    expect(rule).not.toBeNull();
    expect(rule.threshold).toBe(5);
    expect(rule.action).toBe('ask');
    expect(rule.approver).toBe('Dana Ortiz');
    expect(rule.source?.title).toBe('Price changes on supplier orders');
  });

  it('merges the same thing from two sources into one node', () => {
    const k = fresh();
    k._learnResult({ id: 'email:a', kind: 'email', title: 'A', at: 1 }, danaResult);
    const kb: Knowledge = k._learnResult({ id: 'email:b', kind: 'email', title: 'B', at: 2 }, { entities: [{ name: 'dana ortiz', type: 'person', summary: '' }], facts: [], rules: [] });
    const danas = Object.values(kb.entities).filter((e) => e.name.toLowerCase() === 'dana ortiz');
    expect(danas).toHaveLength(1);
    expect(danas[0].sources).toEqual(['email:a', 'email:b']);
  });

  it('keeps a newer statement about the same link and marks the old one replaced', () => {
    const k = fresh();
    const fact = (statement: string) => ({ entities: [], rules: [], facts: [{ subject: 'Ridgeline Steel Co.', relation: 'supplies', object: 'HRC-2MM', statement, quote: '' }] });
    k._learnResult({ id: 's1', kind: 'email', title: '1', at: 1 }, fact('Ridgeline supplies HRC-2MM at $38.50.'));
    const kb: Knowledge = k._learnResult({ id: 's2', kind: 'email', title: '2', at: 2 }, fact('Ridgeline supplies HRC-2MM at $41.90 after the surcharge.'));
    const live = kb.facts.filter((f) => !f.supersededBy);
    expect(live).toHaveLength(1);
    expect(live[0].statement).toContain('41.90');
  });

  it('builds graph data with optional source nodes', () => {
    const k = fresh();
    const kb: Knowledge = k._learnResult({ id: 'email:price', kind: 'email', title: 'Price changes', at: 1 }, danaResult);
    const plain = graphData(kb, { hidden: new Set(), showSources: false });
    expect(plain.nodes.some((n) => n.type === 'rule')).toBe(true);
    expect(plain.links.some((l) => l.label === 'approves under')).toBe(true);
    const withSources = graphData(kb, { hidden: new Set(['team']), showSources: true });
    expect(withSources.nodes.some((n) => n.type === 'source')).toBe(true);
    expect(withSources.nodes.some((n) => n.type === 'team')).toBe(false);
  });

  it('summarises a recording as steps', () => {
    const text = recordingSummary(demoRecording());
    expect(text).toContain('opened the email "Order confirmation for PO-4471"');
    expect(text).toContain('pasted "PO-4471" into Vendor Reference');
  });
});
