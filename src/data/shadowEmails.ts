// Order emails for the shadow mode demo, and the purchase orders "the buyer" entered for them.
// npm run email:send -- --shadow sends the emails; npm run odoo:seed creates the buyer's orders.
// The workflow drafts each email in shadow mode and compares the draft with the buyer's order.
// All companies, people and addresses are fictional (.example domains).
import type { MailMessage } from './schema';

function msg(id: string, fromName: string, fromEmail: string, company: string, subject: string, preview: string, body: MailMessage['body']): MailMessage {
  return { id, fromName, fromEmail, company, subject, received: 'Just now', preview, body, unread: true };
}

const ridgeline = (id: string, po: string, sku: string, desc: string, qty: string, price: string, date: string): MailMessage =>
  msg(id, 'Priya Nair', 'orders@ridgeline-steel.example', 'Ridgeline Steel Co.', `Order confirmation for ${po}`,
    'Thanks for the order. Here are the confirmed details…', [
      'Hi team,\n\nThanks for the order. Here are the confirmed details:\n\nPO number: ', { key: 'po_number', text: po },
      '\nItem: ', { key: 'item_sku', text: sku }, ` ${desc}\nQuantity: `, { key: 'quantity', text: qty },
      ' sheets\nUnit price: $', { key: 'unit_price', text: price }, '\nDelivery date: ', { key: 'delivery_date', text: date },
      '\n\nBest,\nPriya Nair\n', { key: 'supplier', text: 'Ridgeline Steel Co.' },
    ]);

const brightwater = (id: string, ack: string, po: string, qty: string, price: string, date: string): MailMessage =>
  msg(id, 'Marcus Lee', 'orderdesk@brightwater.example', 'Brightwater Plastics', `Order acknowledgment ${ack}`,
    `Order acknowledgment for your PO ref ${po}…`, [
      'Order acknowledgment\n\nYour PO ref ........ ', { key: 'po_number', text: po },
      '\nProduct code ...... ', { key: 'item_sku', text: 'PP-PEL-25' }, ' (polypropylene pellets, 25 kg bag)\nQty ............... ',
      { key: 'quantity', text: qty }, ' bags\nPrice per bag ..... USD ', { key: 'unit_price', text: price },
      '\nShip date ......... ', { key: 'delivery_date', text: date }, '\n\n', { key: 'supplier', text: 'Brightwater Plastics' }, ', Order Desk',
    ]);

export interface ShadowCase {
  message: MailMessage;
  /** What shadow mode should report for it (with the "ask" or "flag" price answer). */
  expect: 'matched' | 'different' | 'escalated';
  /** The order the buyer entered in Odoo, or null when the buyer has not entered one. */
  buyer: null | { vendor: string; ref: string; code: string; qty: number; price: number; date: string };
}

export const SHADOW_CASES: ShadowCase[] = [
  {
    // HRC-3MM, not HRC-2MM: approving the +8.8% test order (PO-4520) confirms a new HRC-2MM price,
    // which would turn this into a price question when shadow mode runs after the approval.
    message: ridgeline('m-4531', 'PO-4531', 'HRC-3MM', 'hot-rolled steel sheet, 3 mm, 4 x 8 ft', '300', '52.20', '2026-12-04'),
    expect: 'matched',
    buyer: { vendor: 'Ridgeline Steel Co.', ref: 'PO-4531', code: 'HRC-3MM', qty: 300, price: 52.2, date: '2026-12-04' },
  },
  {
    message: brightwater('m-4533', 'BW-21004', 'PO-4533', '90', '61.10', '8 Dec 2026'),
    expect: 'matched',
    buyer: { vendor: 'Brightwater Plastics', ref: 'PO-4533', code: 'PP-PEL-25', qty: 90, price: 61.1, date: '2026-12-08' },
  },
  {
    // The buyer typed the wrong arrival date: shadow mode shows the difference.
    message: msg('m-4536', 'Sam Okafor', 'sales@fernwood-fasteners.example', 'Fernwood Fasteners', 'PO-4536 confirmed',
      'Confirming PO-4536 for 5,000 pcs of HXB-M8-40…', [
        'Hello,\n\nConfirming ', { key: 'po_number', text: 'PO-4536' }, ' for ', { key: 'quantity', text: '5,000 pcs' }, ' of ',
        { key: 'item_sku', text: 'HXB-M8-40' }, ' (hex bolt M8 x 40) at $', { key: 'unit_price', text: '0.18' }, ' each. We will deliver on ',
        { key: 'delivery_date', text: 'Dec 2' }, '.\n\nSam Okafor\n', { key: 'supplier', text: 'Fernwood Fasteners' },
      ]),
    expect: 'different',
    buyer: { vendor: 'Fernwood Fasteners', ref: 'PO-4536', code: 'HXB-M8-40', qty: 5000, price: 0.18, date: '2026-12-09' },
  },
  {
    // HRC-3MM last cost $52.20 (PO-4452): +10.9%, so the workflow would ask a buyer.
    message: ridgeline('m-4538', 'PO-4538', 'HRC-3MM', 'hot-rolled steel sheet, 3 mm, 4 x 8 ft', '200', '57.90', '2026-12-11'),
    expect: 'escalated',
    buyer: null,
  },
  {
    message: brightwater('m-4540', 'BW-21019', 'PO-4540', '150', '61.10', '15 Dec 2026'),
    expect: 'matched',
    buyer: { vendor: 'Brightwater Plastics', ref: 'PO-4540', code: 'PP-PEL-25', qty: 150, price: 61.1, date: '2026-12-15' },
  },
];

export const SHADOW_EMAILS: MailMessage[] = SHADOW_CASES.map((c) => c.message);

/** Odoo vendor references of the buyer's shadow orders (kept by npm run odoo:reset). */
export const SHADOW_BUYER_REFS: string[] = SHADOW_CASES.flatMap((c) => (c.buyer ? [c.buyer.ref] : []));
