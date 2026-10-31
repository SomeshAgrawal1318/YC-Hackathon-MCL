import { describe, expect, it } from 'vitest';
import { seededKnowledge } from './fixtures/seededKnowledge';
import { backtest, fieldChecks, incompleteCases, orderHistory, pricePolicyFromHistory } from './history';
import { emptyKnowledge } from './knowledge';
import { PAST_ORDERS } from './pastOrders';
import { defaultEdits } from './workflow';

describe('order history', () => {
  const h = orderHistory(seededKnowledge());
  const byRef = (ref: string) => h.cases.find((c) => c.order.ref === ref)!;

  it('pairs every past order with the email it came from', () => {
    expect(h.cases).toHaveLength(PAST_ORDERS.length);
    // The phone order's email has no PO number; the buyer's note names its acknowledgment.
    expect(byRef('PO-4437').email.title).toBe('Order acknowledgment BW-20114');
    expect(byRef('PO-4437').read.po_number).toBeUndefined();
  });

  it('works out what the buyer did', () => {
    expect(byRef('PO-4433')).toMatchObject({ action: 'approval', approver: 'Dana Ortiz' });
    expect(byRef('PO-4452').action).toBe('approval');
    expect(byRef('PO-4437').action).toBe('checked');
    expect(byRef('PO-4459').action).toBe('saved');
    expect(byRef('PO-4459').change).toBeCloseTo(4.05, 1);
    expect(byRef('PO-4433').prev?.order.ref).toBe('PO-4405');
  });

  it('confirms the field mappings, except where the buyer changed a date by phone', () => {
    const checks = fieldChecks(h);
    for (const c of checks.filter((x) => x.field !== 'delivery_date')) expect(c.agree, c.field).toBe(c.total);
    const date = checks.find((c) => c.field === 'delivery_date')!;
    expect(date.differ.map((d) => d.c.order.ref)).toEqual(['PO-4427']);
    expect(date.total).toBe(PAST_ORDERS.length - 1);
  });

  it('learns the price threshold from what buyers did', () => {
    const p = pricePolicyFromHistory(h)!;
    expect(p.threshold).toBe(5);
    expect(p.approver).toBe('Dana Ortiz');
    expect(p.asked.map((c) => c.order.ref)).toEqual(['PO-4433', 'PO-4452']);
    expect(p.maxSaved).toBeLessThan(5);
  });

  it('finds the past email that had no PO number', () => {
    expect(incompleteCases(h).map((c) => c.order.ref)).toEqual(['PO-4437']);
  });

  it('backtests the workflow against the buyers’ decisions', () => {
    const noRule = backtest(h, defaultEdits());
    // Without a price rule the workflow would have saved the two orders buyers sent to Dana.
    expect(noRule.rows.filter((r) => !r.agree).map((r) => r.c.order.ref)).toEqual(['PO-4433', 'PO-4452']);
    const withRule = backtest(h, { ...defaultEdits(), answer: 'ask', threshold: 5 });
    expect(withRule.decisionsAgree).toBe(PAST_ORDERS.length);
    // One value differs: PO-4427's Expected Arrival, moved by phone after the email.
    expect(withRule.valuesTotal - withRule.valuesAgree).toBe(1);
    const tooLoose = backtest(h, { ...defaultEdits(), answer: 'ask', threshold: 10 });
    expect(tooLoose.decisionsAgree).toBe(PAST_ORDERS.length - 2);
  });

  it('ignores orders made by workflow test runs, and works with no history', () => {
    const kb = seededKnowledge();
    kb.orders = kb.orders!.map((o) => ({ ...o, origin: 'MCL test' }));
    expect(orderHistory(kb).cases).toHaveLength(0);
    expect(pricePolicyFromHistory(orderHistory(emptyKnowledge()))).toBeNull();
  });
});
