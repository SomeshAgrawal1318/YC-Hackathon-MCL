// The demo's Odoo data: vendors, products and past purchase orders (which set each item's "last
// price"). Shared by `npm run odoo:seed` (local Odoo in WSL) and `npm run vm:image` (the VM image).
import { LAST_PRICE } from '../../src/data/scenario';
import { SHADOW_BUYER_REFS, SHADOW_CASES } from '../../src/data/shadowEmails';
import { PAST_ORDERS } from '../../src/data/pastOrders';

type Odoo = ReturnType<typeof import('../../electron/odoo.cjs')['createOdoo']>;

export const VENDORS = [
  { name: 'Ridgeline Steel Co.', email: 'orders@ridgeline-steel.example' },
  { name: 'Brightwater Plastics', email: 'orderdesk@brightwater.example' },
  { name: 'Fernwood Fasteners', email: 'sales@fernwood-fasteners.example' },
];

export const PRODUCTS = [
  { code: 'HRC-2MM', name: 'Hot-rolled steel sheet 2 mm, 4 x 8 ft', cost: LAST_PRICE['HRC-2MM'] },
  { code: 'HRC-3MM', name: 'Hot-rolled steel sheet 3 mm, 4 x 8 ft', cost: 52.2 },
  { code: 'PP-PEL-25', name: 'Polypropylene pellets, 25 kg bag', cost: LAST_PRICE['PP-PEL-25'] },
  { code: 'HXB-M8-40', name: 'Hex bolt M8 x 40', cost: LAST_PRICE['HXB-M8-40'] },
];

/**
 * Past orders (src/data/pastOrders.ts): the newest per item sets the "last price" the workflow
 * compares against. The workflow builder also learns from them, with the supplier emails.
 */
export const HISTORY = PAST_ORDERS;

/** Plain text of an Odoo chatter body (HTML). */
const plain = (html: string) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Posts the buyer's notes that the order doesn't have yet. */
async function addNotes(odoo: Odoo, id: number, notes: string[] = []) {
  if (!notes.length) return 0;
  const msgs: Array<{ body: string }> = await odoo.searchRead('mail.message', [['model', '=', 'purchase.order'], ['res_id', '=', id]], ['body']);
  const have = msgs.map((m) => plain(m.body));
  let added = 0;
  for (const text of notes) {
    if (have.some((h) => h.includes(text.slice(0, 40)))) continue;
    await odoo.call('purchase.order', 'message_post', [[id]], { body: text, message_type: 'comment', subtype_xmlid: 'mail.mt_note' });
    added++;
  }
  return added;
}

async function findOrCreate(odoo: Odoo, model: string, domain: unknown[], values: Record<string, unknown>): Promise<number> {
  const ids: number[] = await odoo.search(model, domain, { limit: 1, context: { active_test: false } });
  if (ids.length) return ids[0];
  return odoo.create(model, values);
}

export async function seedOdoo(odoo: Odoo, log: (m: string) => void = console.log) {
  const vendorIds: Record<string, number> = {};
  for (const v of VENDORS) {
    vendorIds[v.name] = await findOrCreate(odoo, 'res.partner', [['name', '=', v.name]], { name: v.name, email: v.email, is_company: true, supplier_rank: 1 });
  }
  log(`Vendors: ${Object.keys(vendorIds).join(', ')}`);

  const productIds: Record<string, number> = {};
  for (const p of PRODUCTS) {
    productIds[p.code] = await findOrCreate(odoo, 'product.product', [['default_code', '=', p.code]], {
      name: p.name, default_code: p.code, purchase_ok: true, sale_ok: false, standard_price: p.cost,
    });
  }
  log(`Products: ${Object.keys(productIds).join(', ')}`);

  for (const h of HISTORY) {
    const arrival = `${h.arrival} 12:00:00`;
    const existing: number[] = await odoo.search('purchase.order', [['partner_ref', '=', h.ref]], { limit: 1 });
    if (existing.length) {
      // Seeded by an earlier version: bring its Expected Arrival and notes up to date.
      const id = existing[0];
      const [po] = await odoo.read('purchase.order', [id], ['date_planned', 'order_line']);
      if (String(po.date_planned || '').slice(0, 10) !== h.arrival) {
        await odoo.write('purchase.order.line', po.order_line, { date_planned: arrival }).catch((e: Error) => log(`Could not update ${h.ref}'s arrival: ${e.message}`));
      }
      const added = await addNotes(odoo, id, h.notes);
      if (added) log(`Past order ${h.ref}: added ${added} note(s)`);
      continue;
    }
    const [product] = await odoo.read('product.product', [productIds[h.code]], ['uom_id', 'display_name']);
    const id: number = await odoo.create('purchase.order', {
      partner_id: vendorIds[h.vendor],
      partner_ref: h.ref,
      origin: 'MCL seed',
      date_order: `${h.date} 09:00:00`,
      date_planned: arrival,
      order_line: [[0, 0, {
        product_id: productIds[h.code], name: product.display_name, product_qty: h.qty, price_unit: h.price,
        product_uom: product.uom_id[0], date_planned: arrival,
      }]],
    });
    await odoo.call('purchase.order', 'button_confirm', [[id]]);
    // Confirming can reset the order date to now; keep the historical one.
    await odoo.write('purchase.order', [id], { date_order: `${h.date} 09:00:00` }).catch(() => undefined);
    await addNotes(odoo, id, h.notes);
    log(`Past order ${h.ref}: ${h.qty} x ${h.code} at ${h.price} (confirmed${h.notes?.length ? `, ${h.notes.length} note(s)` : ''})`);
  }

  await seedShadowBuyerOrders(odoo, vendorIds, productIds, log);
}

/**
 * The orders "the buyer" entered for the shadow mode emails (src/data/shadowEmails.ts). Shadow mode
 * compares its drafts with these. Left as RFQs, so they don't change any item's last confirmed price.
 */
async function seedShadowBuyerOrders(odoo: Odoo, vendorIds: Record<string, number>, productIds: Record<string, number>, log: (m: string) => void) {
  for (const c of SHADOW_CASES) {
    const b = c.buyer;
    if (!b) continue;
    const existing: number[] = await odoo.search('purchase.order', [['partner_ref', '=', b.ref]], { limit: 1 });
    if (existing.length) continue;
    const [product] = await odoo.read('product.product', [productIds[b.code]], ['uom_id', 'display_name']);
    await odoo.create('purchase.order', {
      partner_id: vendorIds[b.vendor],
      partner_ref: b.ref,
      origin: 'Buyer',
      date_planned: `${b.date} 12:00:00`,
      order_line: [[0, 0, {
        product_id: productIds[b.code], name: product.display_name, product_qty: b.qty, price_unit: b.price,
        product_uom: product.uom_id[0], date_planned: `${b.date} 12:00:00`,
      }]],
    });
    log(`Buyer's order ${b.ref} (for shadow mode): ${b.qty} x ${b.code} at ${b.price}`);
  }
}

/** Deletes every purchase order except the seeded history and the buyer's shadow orders (keeps vendors and products). */
export async function resetOdoo(odoo: Odoo, log: (m: string) => void = console.log) {
  const keep = [...HISTORY.map((h) => h.ref), ...SHADOW_BUYER_REFS];
  const ids: number[] = await odoo.search('purchase.order', ['|', ['partner_ref', '=', false], ['partner_ref', 'not in', keep]]);
  if (!ids.length) return log('Nothing to reset.');
  await odoo.call('purchase.order', 'button_cancel', [ids]).catch(() => undefined);
  await odoo.unlink('purchase.order', ids);
  log(`Deleted ${ids.length} purchase order(s). The seeded history is kept.`);
}
