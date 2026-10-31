import { describe, expect, it } from 'vitest';
import gmailTexts from './fixtures/gmail-texts.json';
import { bodyText, extractOrder, parseDate } from './extract';
import { RECORDED_EMAIL, VARIATIONS } from './scenario';

const vendors = ['Ridgeline Steel Co.', 'Brightwater Plastics', 'Fernwood Fasteners'];
const skus = ['HRC-2MM', 'HRC-3MM', 'PP-PEL-25', 'HXB-M8-40'];
const today = new Date('2026-10-30T09:00:00');

describe('extractOrder', () => {
  it('reads the recorded email', () => {
    expect(extractOrder(bodyText(RECORDED_EMAIL), { vendors, skus, today })).toEqual({
      supplier: 'Ridgeline Steel Co.',
      po_number: 'PO-4471',
      item_sku: 'HRC-2MM',
      quantity: '500',
      unit_price: '38.50',
      delivery_date: '2026-11-12',
    });
  });

  for (const v of VARIATIONS) {
    it(`reads "${v.title}" like a careful buyer would`, () => {
      expect(extractOrder(bodyText(v.message), { vendors, skus, today })).toEqual(v.expected);
    });
  }

  it('works without known vendors and SKUs', () => {
    const got = extractOrder(bodyText(VARIATIONS[0].message));
    expect(got.item_sku).toBe('HRC-2MM');
    expect(got.supplier).toBeUndefined();
  });
});

describe('parseDate', () => {
  it.each([
    ['2026-11-12', '2026-11-12'],
    ['3 Dec 2026', '2026-12-03'],
    ['Nov 30', '2026-11-30'],
    ['November 30, 2026', '2026-11-30'],
    ['Jan 5', '2027-01-05'],
  ])('%s', (input, want) => {
    expect(parseDate(input, today)).toBe(want);
  });
});

describe('extractOrder on the text Gmail shows', () => {
  // Read from the demo inbox with electron/hands.cjs (gmailOpen) on 2026-10-30.
  for (const v of VARIATIONS) {
    it(`reads "${v.title}"`, () => {
      const text = (gmailTexts as Record<string, string>)[v.message.subject];
      expect(text, 'missing from the fixture').toBeTruthy();
      expect(extractOrder(text, { vendors, skus, today })).toEqual(v.expected);
    });
  }
});
