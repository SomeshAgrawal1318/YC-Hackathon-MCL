// App profiles: what an element in Gmail or Odoo means for the workflow.
// They name elements the way a person would ("Vendor Reference" field, "Save" button) and give each
// a stable tid, so the predefined workflow can point back at the events it learned from.
// Calibrated against Odoo 18 (purchase order form) and Gmail in Chrome.
import { FIELD_LABEL } from './desktop';
import { RECORDING_INBOX, VARIATIONS } from './scenario';
import type { FieldKey, MailMessage, RawOsEvent } from './schema';

type El = NonNullable<RawOsEvent['element']>;

export interface Meaning {
  tid: string;
  name: string;
  field?: FieldKey;
  messageId?: string;
  save?: boolean;
}

/** Odoo field ids look like "partner_ref_0": the field name plus a counter. */
const ODOO_FIELD_BY_ID: Record<string, FieldKey> = {
  partner_id: 'supplier',
  partner_ref: 'po_number',
  product_id: 'item_sku',
  product_qty: 'quantity',
  price_unit: 'unit_price',
  date_planned: 'delivery_date',
  notes: 'notes',
};

const ODOO_FIELD_BY_LABEL: Record<string, FieldKey> = Object.fromEntries(
  (Object.entries(FIELD_LABEL) as Array<[FieldKey, string]>).map(([k, label]) => [label.toLowerCase(), k]),
);

/** Odoo appends a "?" tooltip marker to some labels. */
const clean = (s: string) => s.replace(/\s*\?\s*$/, '').trim();

export function odooField(el: El): FieldKey | null {
  const id = el.automationId.replace(/_\d+$/, '');
  if (ODOO_FIELD_BY_ID[id]) return ODOO_FIELD_BY_ID[id];
  if (['Edit', 'ComboBox'].includes(el.role)) {
    const byLabel = ODOO_FIELD_BY_LABEL[clean(el.name).toLowerCase()];
    if (byLabel) return byLabel;
  }
  return null;
}

/** Fields filled by picking from a search dropdown. */
export const DROPDOWN_FIELDS: FieldKey[] = ['supplier', 'item_sku'];

export function odooMeaning(el: El): Meaning {
  const field = odooField(el);
  if (field) return { tid: `erp:field:${field}`, name: FIELD_LABEL[field], field };
  const name = clean(el.name);
  // Odoo saves the record when you leave the form with the back arrow or a breadcrumb.
  if (/o_back_button/.test(el.className) || (el.role === 'Hyperlink' && el.path.some((p) => /breadcrumb/i.test(p)))) {
    return { tid: 'erp:save:auto', name: 'Back (Odoo saves the order)', save: true };
  }
  if (el.role === 'Button' && name === 'Add' && /kanban/i.test(el.className)) return { tid: 'erp:catalog-add', name: 'Add from the catalog' };
  if (el.role === 'Button' || el.role === 'Hyperlink') {
    if (name === 'New') return { tid: 'erp:new-po', name: 'New' };
    if (/^save manually$/i.test(name) || name === 'Save') return { tid: 'erp:save', name: 'Save', save: true };
    if (/^confirm order$/i.test(name)) return { tid: 'erp:save:confirm', name: 'Confirm Order', save: true };
    if (/^discard/i.test(name)) return { tid: 'erp:cancel', name: 'Discard' };
    if (/^add a product$/i.test(name)) return { tid: 'erp:add-line', name: 'Add a product' };
  }
  return { tid: `erp:el:${el.role}:${name.slice(0, 40)}`, name: name || el.role };
}

const KNOWN_MESSAGES: MailMessage[] = [...RECORDING_INBOX, ...VARIATIONS.map((v) => v.message)];

/** A known supplier email named by this text (a window title, say). */
export function messageIn(text: string): MailMessage | null {
  return KNOWN_MESSAGES.find((m) => text.includes(m.subject)) ?? null;
}

/** The supplier email a Gmail element belongs to, from its own name or its ancestors'. */
export function gmailMessage(el: El): MailMessage | null {
  const texts = [el.name, ...el.path];
  for (const m of KNOWN_MESSAGES) {
    if (texts.some((t) => t.includes(m.subject))) return m;
  }
  return null;
}

export function gmailMeaning(el: El): Meaning {
  const m = gmailMessage(el);
  if (m && ['ListItem', 'DataItem', 'Text', 'Hyperlink', 'Custom', 'Group', 'Element'].includes(el.role)) {
    return { tid: `mail:msg:${m.id}`, name: m.subject, messageId: m.id };
  }
  const name = el.name.trim();
  return { tid: `mail:el:${el.role}:${name.slice(0, 40)}`, name: name.slice(0, 80) || el.role };
}
