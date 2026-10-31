import { describe, expect, it } from 'vitest';
import { bodyText } from './extract';
import { compare, dailyBuckets, describeDiffs, draftFromEmail, priceCheck, totals, type ShadowEdits, type ShadowItem } from './shadowCompare';
import { CONTEXT_EMAILS, LAST_PRICE } from './scenario';
import { SHADOW_CASES } from './shadowEmails';
import { defaultEdits } from './workflow';

const catalog = {
  vendors: ['Ridgeline Steel Co.', 'Brightwater Plastics', 'Fernwood Fasteners'],
  skus: ['HRC-2MM', 'HRC-3MM', 'PP-PEL-25', 'HXB-M8-40'],
};
const today = new Date('2026-10-31T09:00:00');
const LAST: Record<string, number> = { ...LAST_PRICE, 'HRC-3MM': 52.2 };
const edits = (answer: ShadowEdits['answer']): ShadowEdits => ({ ...defaultEdits(), answer });

/** What shadow mode decides for one case, the same way the actor does. */
function decide(c: (typeof SHADOW_CASES)[number], e: ShadowEdits) {
  const d = draftFromEmail(bodyText(c.message), catalog, e, today);
  const check = priceCheck(d.draft.unit_price, LAST[d.draft.item_sku ?? ''] ?? null, e);
  if (check.over) return 'escalated';
  if (!c.buyer) return 'waiting';
  const buyer = {
    supplier: c.buyer.vendor, po_number: c.buyer.ref, item_sku: c.buyer.code,
    quantity: String(c.buyer.qty), unit_price: c.buyer.price.toFixed(2), delivery_date: c.buyer.date,
  };
  return compare(d.draft, buyer).length ? 'different' : 'matched';
}

describe('shadow mode', () => {
  for (const c of SHADOW_CASES) {
    it(`reports "${c.message.subject}" as ${c.expect}`, () => {
      const d = draftFromEmail(bodyText(c.message), catalog, edits('ask'), today);
      expect(d.isOrder).toBe(true);
      expect(d.missing).toEqual([]);
      expect(Object.keys(d.draft)).toHaveLength(6);
      expect(decide(c, edits('ask'))).toBe(c.expect);
    });
  }

  it('does not ask about the price when the answer is "save"', () => {
    const jump = SHADOW_CASES.find((c) => c.expect === 'escalated')!;
    expect(decide(jump, edits('save'))).toBe('waiting');
  });

  it('names the field that differs', () => {
    const c = SHADOW_CASES.find((x) => x.expect === 'different')!;
    const d = draftFromEmail(bodyText(c.message), catalog, edits('ask'), today);
    const diffs = compare(d.draft, { ...d.draft, delivery_date: '2026-12-09' });
    expect(diffs.map((x) => x.field)).toEqual(['delivery_date']);
    expect(describeDiffs(diffs)).toBe('expected arrival: draft 2026-12-02, buyer 2026-12-09');
  });

  it('treats 5000 and "5,000" and 0.18 and "0.180" as equal', () => {
    expect(compare({ quantity: '5000', unit_price: '0.18' }, { quantity: '5,000', unit_price: '0.180' })).toEqual([]);
  });

  it('skips emails that are not orders', () => {
    const team = CONTEXT_EMAILS[0];
    expect(draftFromEmail(bodyText(team), catalog, edits('ask'), today).isOrder).toBe(false);
  });

  it('counts the streak from the newest result', () => {
    const items: ShadowItem[] = [
      { status: 'matched', resolvedAt: 1 },
      { status: 'different', resolvedAt: 2 },
      { status: 'matched', resolvedAt: 3 },
      { status: 'escalated', resolvedAt: 4 },
      { status: 'matched', resolvedAt: 5 },
      { status: 'waiting', resolvedAt: null },
    ];
    expect(totals(items)).toMatchObject({ handled: 5, matched: 3, different: 1, escalated: 1, streak: 2 });
  });

  it('buckets results by day, oldest first', () => {
    const now = new Date('2026-10-31T15:00:00').getTime();
    const yesterday = new Date('2026-10-30T10:00:00').getTime();
    const days = dailyBuckets([
      { status: 'matched', resolvedAt: now - 1000 },
      { status: 'different', resolvedAt: now - 2000 },
      { status: 'matched', resolvedAt: yesterday },
    ], now);
    expect(days).toHaveLength(7);
    expect(days[6]).toEqual({ day: 'Sat', handled: 2, matched: 1 });
    expect(days[5]).toEqual({ day: 'Fri', handled: 1, matched: 1 });
  });
});
