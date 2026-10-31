// The purchasing team's order history from August to October: what each supplier emailed, and what
// the buyer then entered in Odoo (with the notes they left on the order). `npm run odoo:seed` creates
// the orders, `npm run email:send -- --history` sends the emails. The workflow builder learns from
// the pairs (src/data/history.ts): which value goes where, and what buyers did when something was off.
// All companies, people and addresses are fictional.
import type { MailMessage } from './schema';

export interface PastOrderSeed {
  /** Vendor Reference in Odoo: the PO number the buyer entered. */
  ref: string;
  vendor: string;
  code: string;
  qty: number;
  price: number;
  /** Order date (YYYY-MM-DD). */
  date: string;
  /** Expected Arrival in Odoo. */
  arrival: string;
  /** What the email said, when it differs from what the buyer entered. */
  email?: { arrival?: string; noPo?: boolean; ackRef?: string };
  /** Notes the buyer logged on the order, oldest first. */
  notes?: string[];
}

/** Oldest first. The newest order per item sets the "last price" (LAST_PRICE in scenario.ts). */
export const PAST_ORDERS: PastOrderSeed[] = [
  { ref: 'PO-4405', vendor: 'Brightwater Plastics', code: 'PP-PEL-25', qty: 100, price: 57.4, date: '2026-08-03', arrival: '2026-08-17', email: { ackRef: 'BW-19870' } },
  { ref: 'PO-4410', vendor: 'Ridgeline Steel Co.', code: 'HRC-2MM', qty: 300, price: 35.2, date: '2026-08-04', arrival: '2026-08-14' },
  { ref: 'PO-4414', vendor: 'Fernwood Fasteners', code: 'HXB-M8-40', qty: 1500, price: 0.18, date: '2026-08-07', arrival: '2026-08-21' },
  { ref: 'PO-4418', vendor: 'Ridgeline Steel Co.', code: 'HRC-3MM', qty: 200, price: 48.6, date: '2026-08-12', arrival: '2026-08-26' },
  {
    ref: 'PO-4427', vendor: 'Ridgeline Steel Co.', code: 'HRC-2MM', qty: 500, price: 36.1, date: '2026-08-25', arrival: '2026-09-08',
    email: { arrival: '2026-09-04' },
    notes: ['Priya called: the mill is running late, so delivery moves from Sep 4 to Sep 8. Updated Expected Arrival.'],
  },
  {
    ref: 'PO-4433', vendor: 'Brightwater Plastics', code: 'PP-PEL-25', qty: 120, price: 61.1, date: '2026-09-03', arrival: '2026-09-17',
    email: { ackRef: 'BW-20031' },
    notes: [
      'Unit price is 6.4% above the last order (PO-4405, $57.40). Saved as a draft and sent to Dana Ortiz for approval.',
      'Approved by Dana Ortiz. Resin prices are up across the market.',
    ],
  },
  {
    ref: 'PO-4437', vendor: 'Brightwater Plastics', code: 'PP-PEL-25', qty: 40, price: 61.1, date: '2026-09-08', arrival: '2026-09-22',
    email: { noPo: true, ackRef: 'BW-20114' },
    notes: ['Acknowledgment BW-20114 had no PO number (order placed by phone). Called Marcus Lee to confirm before entering; he gave PO-4437.'],
  },
  { ref: 'PO-4441', vendor: 'Ridgeline Steel Co.', code: 'HRC-2MM', qty: 350, price: 37.0, date: '2026-09-10', arrival: '2026-09-22' },
  { ref: 'PO-4446', vendor: 'Fernwood Fasteners', code: 'HXB-M8-40', qty: 2500, price: 0.18, date: '2026-09-14', arrival: '2026-09-28' },
  {
    ref: 'PO-4452', vendor: 'Ridgeline Steel Co.', code: 'HRC-3MM', qty: 250, price: 52.2, date: '2026-09-18', arrival: '2026-10-02',
    notes: [
      'Unit price is 7.4% above the last order (PO-4418, $48.60). Saved as a draft and sent to Dana Ortiz for approval.',
      'Approved by Dana Ortiz.',
    ],
  },
  { ref: 'PO-4459', vendor: 'Ridgeline Steel Co.', code: 'HRC-2MM', qty: 400, price: 38.5, date: '2026-10-02', arrival: '2026-10-12' },
  { ref: 'PO-4466', vendor: 'Brightwater Plastics', code: 'PP-PEL-25', qty: 100, price: 61.1, date: '2026-10-14', arrival: '2026-10-28', email: { ackRef: 'BW-20562' } },
  { ref: 'PO-4468', vendor: 'Fernwood Fasteners', code: 'HXB-M8-40', qty: 2000, price: 0.18, date: '2026-10-20', arrival: '2026-11-03' },
];

const PRODUCT_TEXT: Record<string, string> = {
  'HRC-2MM': 'hot-rolled steel sheet, 2 mm, 4 x 8 ft',
  'HRC-3MM': 'hot-rolled steel sheet, 3 mm, 4 x 8 ft',
  'PP-PEL-25': 'polypropylene pellets, 25 kg bag',
  'HXB-M8-40': 'hex bolt M8 x 40',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, mon: MONTHS[m - 1], d };
};
const money = (n: number) => n.toFixed(2);
const thousands = (n: number) => n.toLocaleString('en-US');

/** The email the supplier sent for a past order, in that supplier's usual layout. */
export function pastOrderEmail(o: PastOrderSeed): MailMessage {
  const arrival = o.email?.arrival ?? o.arrival;
  const base = { id: `m-hist-${o.ref}`, received: o.date, unread: false };
  if (o.vendor === 'Ridgeline Steel Co.') {
    return {
      ...base, fromName: 'Priya Nair', fromEmail: 'orders@ridgeline-steel.example', company: o.vendor,
      subject: `Order confirmation for ${o.ref}`, preview: 'Thanks for the order. Here are the confirmed details…',
      body: [`Hi team,\n\nThanks for the order. Here are the confirmed details:\n\nPO number: ${o.ref}\nItem: ${o.code} ${PRODUCT_TEXT[o.code]}\nQuantity: ${o.qty} sheets\nUnit price: $${money(o.price)}\nDelivery date: ${arrival}\n\nBest,\nPriya Nair\n${o.vendor}`],
    };
  }
  if (o.vendor === 'Brightwater Plastics') {
    const a = parts(arrival);
    const ack = o.email?.ackRef ?? 'BW-20000';
    const head = o.email?.noPo ? 'Order acknowledgment\n\nWe received your order by phone this morning.\n\n' : `Order acknowledgment\n\nYour PO ref ........ ${o.ref}\n`;
    return {
      ...base, fromName: 'Marcus Lee', fromEmail: 'orderdesk@brightwater.example', company: o.vendor,
      subject: `Order acknowledgment ${ack}`, preview: o.email?.noPo ? 'We received your order by phone this morning…' : `Order acknowledgment for your PO ref ${o.ref}…`,
      body: [`${head}Product code ...... ${o.code} (${PRODUCT_TEXT[o.code]})\nQty ............... ${o.qty} bags\nPrice per bag ..... USD ${money(o.price)}\nShip date ......... ${a.d} ${a.mon} ${a.y}\n\n${o.vendor}, Order Desk`],
    };
  }
  const a = parts(arrival);
  return {
    ...base, fromName: 'Sam Okafor', fromEmail: 'sales@fernwood-fasteners.example', company: o.vendor,
    subject: `${o.ref} confirmed`, preview: `Confirming ${o.ref} for ${thousands(o.qty)} pcs of ${o.code}…`,
    body: [`Hello,\n\nConfirming ${o.ref} for ${thousands(o.qty)} pcs of ${o.code} (${PRODUCT_TEXT[o.code]}) at $${money(o.price)} each. We will deliver on ${a.mon} ${a.d}, ${a.y}.\n\nSam Okafor\n${o.vendor}`],
  };
}

export const HISTORY_EMAILS: MailMessage[] = PAST_ORDERS.map(pastOrderEmail);
