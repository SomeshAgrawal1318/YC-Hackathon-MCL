// The knowledge base as a sync leaves it after `npm run odoo:seed` and `npm run email:send -- --history`.
import { bodyText } from '../extract';
import { emptyKnowledge } from '../knowledge';
import type { Knowledge, OdooOrder } from '../knowledge';
import { HISTORY_EMAILS, PAST_ORDERS } from '../pastOrders';

export function seededKnowledge(): Knowledge {
  const kb = emptyKnowledge();
  kb.orders = PAST_ORDERS.map((o, i): OdooOrder => ({
    id: 100 + i,
    name: `P${String(i + 1).padStart(5, '0')}`,
    ref: o.ref,
    vendor: o.vendor,
    date: o.date,
    arrival: o.arrival,
    origin: 'MCL seed',
    lines: [{ sku: o.code, qty: o.qty, price: o.price }],
    notes: o.notes ?? [],
  })).reverse();
  for (const m of HISTORY_EMAILS) {
    const id = `email:${m.subject}`;
    kb.sources[id] = { id, kind: 'email', title: m.subject, from: m.fromName, at: 1, text: bodyText(m), order: true };
  }
  return kb;
}
