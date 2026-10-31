import { FIELD_LABEL, T, materialize } from './desktop';
import type { Action, MailMessage, Recording, Variation, VarKey } from './schema';

// All companies, people and addresses below are fictional (.example domains).

// ---------- The email recorded in the demo ----------

export const RECORDED_EMAIL: MailMessage = {
  id: 'm-4471',
  fromName: 'Priya Nair',
  fromEmail: 'orders@ridgeline-steel.example',
  company: 'Ridgeline Steel Co.',
  subject: 'Order confirmation for PO-4471',
  received: '8:42 AM',
  preview: 'Thanks for the order. Here are the confirmed details…',
  unread: true,
  body: [
    'Hi team,\n\nThanks for the order. Here are the confirmed details:\n\nPO number: ',
    { key: 'po_number', text: 'PO-4471' },
    '\nItem: ',
    { key: 'item_sku', text: 'HRC-2MM' },
    ' hot-rolled steel sheet, 2 mm, 4 x 8 ft\nQuantity: ',
    { key: 'quantity', text: '500' },
    ' sheets\nUnit price: $',
    { key: 'unit_price', text: '38.50' },
    '\nDelivery date: ',
    { key: 'delivery_date', text: '2026-11-12' },
    '\n\nBest,\nPriya Nair\n',
    { key: 'supplier', text: 'Ridgeline Steel Co.' },
  ],
};

const DISTRACTORS: MailMessage[] = [
  {
    id: 'm-kestrel',
    fromName: 'Kestrel Freight',
    fromEmail: 'tracking@kestrel-freight.example',
    company: 'Kestrel Freight',
    subject: 'Shipment 88213 picked up',
    received: '8:15 AM',
    preview: 'Your shipment from Fernwood Fasteners is on its way…',
    body: ['Your shipment from Fernwood Fasteners was picked up at 7:58 AM.\nEstimated arrival: Nov 3.\n\nKestrel Freight'],
  },
  {
    id: 'm-dana',
    fromName: 'Dana Ortiz',
    fromEmail: 'dana.ortiz@plant.example',
    company: 'Planning',
    subject: 'Re: Q4 safety stock levels',
    received: 'Yesterday',
    preview: 'Let’s keep HRC-2MM at two weeks of cover through December…',
    body: ['Let’s keep HRC-2MM at two weeks of cover through December. I’ll update the plan on Monday.\n\nDana'],
  },
  {
    id: 'm-it',
    fromName: 'Plant IT',
    fromEmail: 'it@plant.example',
    company: 'Plant IT',
    subject: 'Scheduled maintenance on Saturday',
    received: 'Yesterday',
    preview: 'NorthStar ERP will be unavailable from 6 to 8 AM…',
    body: ['NorthStar ERP will be unavailable from 6 to 8 AM on Saturday for updates.\n\nPlant IT'],
  },
];

export const RECORDING_INBOX: MailMessage[] = [RECORDED_EMAIL, ...DISTRACTORS];

/** Last purchase price per item, as the ERP knows it. */
export const LAST_PRICE: Record<string, number> = {
  'HRC-2MM': 38.5,
  'PP-PEL-25': 61.1,
  'HXB-M8-40': 0.18,
};

export const RECENT_POS = [
  { po: 'PO-4468', supplier: 'Fernwood Fasteners', item: 'HXB-M8-40', qty: '2,000', status: 'Received' },
  { po: 'PO-4466', supplier: 'Brightwater Plastics', item: 'PP-PEL-25', qty: '100', status: 'Open' },
  { po: 'PO-4459', supplier: 'Ridgeline Steel Co.', item: 'HRC-2MM', qty: '400', status: 'Received' },
  { po: 'PO-4452', supplier: 'Ridgeline Steel Co.', item: 'HRC-3MM', qty: '250', status: 'Received' },
];

// ---------- The scripted recording (used when no live capture is available) ----------

type Step = Action & { t: number; dur?: number };

function scriptedSteps(): Step[] {
  const m = RECORDED_EMAIL;
  const copy = (t: number, key: VarKey, text: string): Step => ({ t, kind: 'copy', app: 'mail', target: T.value(key, text), varKey: key, value: text });
  const paste = (t: number, field: VarKey, value: string): Step => ({ t, kind: 'paste', app: 'erp', target: T.field(field), field, value });
  const click = (t: number, field: VarKey): Step => ({ t, kind: 'click', app: 'erp', target: T.field(field), field });
  const type = (t: number, field: VarKey, value: string, dur: number): Step => ({ t, dur, kind: 'type', app: 'erp', target: T.field(field), field, value });
  const toMail = (t: number): Step => ({ t, kind: 'app_switch', app: 'mail', target: T.task('mail') });
  const toErp = (t: number): Step => ({ t, kind: 'app_switch', app: 'erp', target: T.task('erp') });
  return [
    toMail(700),
    { t: 1600, kind: 'click', app: 'mail', target: T.message(m), messageId: m.id },
    copy(3300, 'po_number', 'PO-4471'),
    toErp(4300),
    { t: 5200, kind: 'click', app: 'erp', target: T.newPo() },
    click(6300, 'supplier'),
    type(6600, 'supplier', 'Ridgeline Steel Co.', 1700),
    paste(8800, 'po_number', 'PO-4471'),
    toMail(9800),
    copy(10700, 'item_sku', 'HRC-2MM'),
    toErp(11600),
    paste(12300, 'item_sku', 'HRC-2MM'),
    click(13300, 'quantity'),
    type(13500, 'quantity', '500', 600),
    toMail(14700),
    copy(15600, 'unit_price', '38.50'),
    toErp(16500),
    paste(17200, 'unit_price', '38.50'),
    click(18300, 'delivery_date'),
    type(18500, 'delivery_date', '2026-11-12', 1400),
    { t: 20800, kind: 'save', app: 'erp', target: T.save() },
  ];
}

export function demoRecording(): Recording {
  return {
    id: 'rec-demo',
    title: 'Supplier order to purchase order',
    source: 'demo',
    createdAt: Date.now(),
    duration: 22500,
    events: materialize(scriptedSteps()),
    inboxId: 'recording',
  };
}

/** Rough count of the low-level input events behind the semantic ones (keystrokes, mouse samples). */
export function rawEventCount(rec: Recording): number {
  let n = Math.round((rec.duration / 1000) * 6); // mouse-move samples
  for (const e of rec.events) {
    if (e.kind === 'type') n += (e.value ?? '').length * 2;
    else if (e.kind === 'copy' || e.kind === 'paste') n += 4;
    else n += 3;
  }
  return n;
}

// ---------- Test variations ----------

function msg(id: string, fromName: string, fromEmail: string, company: string, subject: string, preview: string, body: MailMessage['body']): MailMessage {
  return { id, fromName, fromEmail, company, subject, received: 'Just now', preview, body, unread: true };
}

export const VARIATIONS: Variation[] = [
  {
    id: 'v-same',
    title: 'Same supplier, new order',
    whatsDifferent: 'A new PO number, quantity and date from Ridgeline.',
    message: msg('m-4502', 'Priya Nair', 'orders@ridgeline-steel.example', 'Ridgeline Steel Co.', 'Order confirmation for PO-4502',
      'Thanks for the order. Here are the confirmed details…', [
        'Hi team,\n\nThanks for the order. Here are the confirmed details:\n\nPO number: ', { key: 'po_number', text: 'PO-4502' },
        '\nItem: ', { key: 'item_sku', text: 'HRC-2MM' }, ' hot-rolled steel sheet, 2 mm, 4 x 8 ft\nQuantity: ', { key: 'quantity', text: '750' },
        ' sheets\nUnit price: $', { key: 'unit_price', text: '38.50' }, '\nDelivery date: ', { key: 'delivery_date', text: '2026-11-19' },
        '\n\nBest,\nPriya Nair\n', { key: 'supplier', text: 'Ridgeline Steel Co.' },
      ]),
    expected: { supplier: 'Ridgeline Steel Co.', po_number: 'PO-4502', item_sku: 'HRC-2MM', quantity: '750', unit_price: '38.50', delivery_date: '2026-11-19' },
  },
  {
    id: 'v-layout',
    title: 'Different supplier and layout',
    whatsDifferent: 'Brightwater lays out its emails as a table and writes dates as "3 Dec 2026".',
    message: msg('m-4489', 'Marcus Lee', 'orderdesk@brightwater.example', 'Brightwater Plastics', 'Order acknowledgment BW-20931',
      'Order acknowledgment for your PO ref PO-4489…', [
        'Order acknowledgment\n\nYour PO ref ........ ', { key: 'po_number', text: 'PO-4489' },
        '\nProduct code ...... ', { key: 'item_sku', text: 'PP-PEL-25' }, ' (polypropylene pellets, 25 kg bag)\nQty ............... ',
        { key: 'quantity', text: '120' }, ' bags\nPrice per bag ..... USD ', { key: 'unit_price', text: '61.40' },
        '\nShip date ......... ', { key: 'delivery_date', text: '3 Dec 2026' }, '\n\n', { key: 'supplier', text: 'Brightwater Plastics' }, ', Order Desk',
      ]),
    expected: { supplier: 'Brightwater Plastics', po_number: 'PO-4489', item_sku: 'PP-PEL-25', quantity: '120', unit_price: '61.40', delivery_date: '2026-12-03' },
  },
  {
    id: 'v-thread',
    title: 'Reply quoting an older order',
    whatsDifferent: 'The email quotes PO-4471 below the new details. Only the newest order counts.',
    message: msg('m-4511', 'Priya Nair', 'orders@ridgeline-steel.example', 'Ridgeline Steel Co.', 'Re: Order confirmation for PO-4511',
      'Quick correction from yesterday, confirmed details below…', [
        'Hi, quick correction from yesterday. Confirmed details below.\n\nPO number: ', { key: 'po_number', text: 'PO-4511' },
        '\nItem: ', { key: 'item_sku', text: 'HRC-2MM' }, '\nQuantity: ', { key: 'quantity', text: '300' }, ' sheets\nUnit price: $',
        { key: 'unit_price', text: '38.75' }, '\nDelivery date: ', { key: 'delivery_date', text: '2026-11-26' },
        '\n\nPriya\n', { key: 'supplier', text: 'Ridgeline Steel Co.' },
        '\n\n> On Oct 29, Priya Nair wrote:\n> PO number: PO-4471\n> Quantity: 500 sheets\n> Unit price: $38.50',
      ]),
    expected: { supplier: 'Ridgeline Steel Co.', po_number: 'PO-4511', item_sku: 'HRC-2MM', quantity: '300', unit_price: '38.75', delivery_date: '2026-11-26' },
  },
  {
    id: 'v-units',
    title: 'Quantity written with units',
    whatsDifferent: 'Fernwood writes "1,200 pcs" and "Nov 30" in a single sentence.',
    message: msg('m-4517', 'Sam Okafor', 'sales@fernwood-fasteners.example', 'Fernwood Fasteners', 'PO-4517 confirmed',
      'Confirming PO-4517 for 1,200 pcs of HXB-M8-40…', [
        'Hello,\n\nConfirming ', { key: 'po_number', text: 'PO-4517' }, ' for ', { key: 'quantity', text: '1,200 pcs' }, ' of ',
        { key: 'item_sku', text: 'HXB-M8-40' }, ' (hex bolt M8 x 40) at $', { key: 'unit_price', text: '0.18' }, ' each. We will deliver on ',
        { key: 'delivery_date', text: 'Nov 30' }, '.\n\nSam Okafor\n', { key: 'supplier', text: 'Fernwood Fasteners' },
      ]),
    expected: { supplier: 'Fernwood Fasteners', po_number: 'PO-4517', item_sku: 'HXB-M8-40', quantity: '1200', unit_price: '0.18', delivery_date: '2026-11-30' },
  },
  {
    id: 'v-price',
    title: 'Price went up 8.8%',
    whatsDifferent: 'Same item, but $41.90 a sheet instead of $38.50 last time.',
    message: msg('m-4520', 'Priya Nair', 'orders@ridgeline-steel.example', 'Ridgeline Steel Co.', 'Order confirmation for PO-4520',
      'Thanks for the order. Here are the confirmed details…', [
        'Hi team,\n\nThanks for the order. Here are the confirmed details:\n\nPO number: ', { key: 'po_number', text: 'PO-4520' },
        '\nItem: ', { key: 'item_sku', text: 'HRC-2MM' }, ' hot-rolled steel sheet, 2 mm, 4 x 8 ft\nQuantity: ', { key: 'quantity', text: '400' },
        ' sheets\nUnit price: $', { key: 'unit_price', text: '41.90' }, '\nDelivery date: ', { key: 'delivery_date', text: '2026-12-01' },
        '\n\nNote: mill surcharge applies from November.\n\nBest,\nPriya Nair\n', { key: 'supplier', text: 'Ridgeline Steel Co.' },
      ]),
    expected: { supplier: 'Ridgeline Steel Co.', po_number: 'PO-4520', item_sku: 'HRC-2MM', quantity: '400', unit_price: '41.90', delivery_date: '2026-12-01' },
  },
  {
    id: 'v-missing',
    title: 'No PO number in the email',
    whatsDifferent: 'The order was placed by phone, so the email has no PO reference.',
    message: msg('m-bw-phone', 'Marcus Lee', 'orderdesk@brightwater.example', 'Brightwater Plastics', 'Order acknowledgment BW-20977',
      'We received your order by phone this morning…', [
        'Order acknowledgment\n\nWe received your order by phone this morning.\n\nProduct code ...... ', { key: 'item_sku', text: 'PP-PEL-25' },
        '\nQty ............... ', { key: 'quantity', text: '80' }, ' bags\nPrice per bag ..... USD ', { key: 'unit_price', text: '61.40' },
        '\nShip date ......... ', { key: 'delivery_date', text: '10 Dec 2026' }, '\n\n', { key: 'supplier', text: 'Brightwater Plastics' }, ', Order Desk',
      ]),
    expected: { supplier: 'Brightwater Plastics', item_sku: 'PP-PEL-25', quantity: '80', unit_price: '61.40', delivery_date: '2026-12-10' },
  },
];

export function inboxFor(id: string): MailMessage[] {
  if (id === 'recording') return RECORDING_INBOX;
  const v = VARIATIONS.find((x) => x.id === id);
  return v ? [v.message, ...DISTRACTORS] : RECORDING_INBOX;
}

export const VAR_SOURCE: Record<VarKey, string> = {
  supplier: 'Email signature',
  po_number: 'Email body',
  item_sku: 'Email body',
  quantity: 'Email body, digits only',
  unit_price: 'Email body, number only',
  delivery_date: 'Email body, as YYYY-MM-DD',
};

export const fieldLabel = (k: VarKey) => FIELD_LABEL[k];
