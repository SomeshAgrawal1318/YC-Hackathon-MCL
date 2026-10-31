import { describe, expect, it } from 'vitest';
import { normalize } from './normalize';
import { toRecording } from '../lib/store';
import { buildWorkflow, defaultEdits, sampleValues, sourceEvents } from './workflow';
import type { RawOsEvent } from './schema';
import userChore from './fixtures/user-chore-raw.json';

// Shaped like trace-helper output for the chore in Gmail + Odoo 18. Replace with a real capture
// (src/data/fixtures/gmail-odoo-capture.json) once one is recorded.
const T0 = 1_800_000_000_000;
let ts = T0;
const GMAIL = { process: 'chrome.exe', window: 'Inbox - demo@gmail.com - Gmail - Google Chrome', hwnd: 1, app: 'mail' as const, url: 'https://mail.google.com/mail/u/0/#inbox' };
const ODOO = { process: 'chrome.exe', window: 'New - Google Chrome', hwnd: 2, app: 'erp' as const, url: 'http://127.0.0.1:8069/odoo/purchase/new' };
const el = (role: string, name: string, automationId = '', value?: string, path: string[] = []) => ({
  role, name, automationId, className: '', path, rect: [100, 200, 300, 30] as [number, number, number, number], value,
});
const ev = (w: typeof GMAIL | typeof ODOO, kind: RawOsEvent['kind'], extra: Partial<RawOsEvent> = {}): RawOsEvent => {
  ts += 900;
  return { type: 'event', kind, ts, ...w, ...extra };
};

const raw: RawOsEvent[] = [
  ev(GMAIL, 'foreground'),
  ev(GMAIL, 'click', { element: el('Text', 'Order confirmation for PO-4471', '', undefined, ['Gmail', 'Inbox', 'unread, Priya Nair, Ridgeline Steel Co., Order confirmation for PO-4471']) }),
  ev(GMAIL, 'dblclick', { element: el('Text', 'PO-4471') }),
  ev(GMAIL, 'shortcut', { keys: 'Ctrl+C', element: el('Document', 'Gmail') }),
  ev(GMAIL, 'clipboard', { text: 'PO-4471' }),
  ev(ODOO, 'foreground'),
  ev(ODOO, 'click', { element: el('Button', 'New') }),
  ev(ODOO, 'click', { element: el('ComboBox', 'Vendor?', 'partner_id_0') }),
  ev(ODOO, 'value', { element: el('ComboBox', 'Vendor?', 'partner_id_0', 'Ridg') }),
  ev(ODOO, 'click', { element: el('ListItem', 'Ridgeline Steel Co.') }),
  ev(ODOO, 'click', { element: el('Edit', 'Vendor Reference?', 'partner_ref_0') }),
  ev(ODOO, 'shortcut', { keys: 'Ctrl+V', element: el('Edit', 'Vendor Reference?', 'partner_ref_0') }),
  ev(ODOO, 'value', { keys: 'Ctrl+V', element: el('Edit', 'Vendor Reference?', 'partner_ref_0', 'PO-4471') }),
  ev(GMAIL, 'foreground'),
  ev(GMAIL, 'dblclick', { element: el('Text', 'HRC-2MM') }),
  ev(GMAIL, 'clipboard', { text: 'HRC-2MM' }),
  ev(ODOO, 'foreground'),
  ev(ODOO, 'click', { element: el('Hyperlink', 'Add a product') }),
  ev(ODOO, 'value', { keys: 'Ctrl+V', element: el('ComboBox', '', 'product_id_1', 'HRC-2MM') }),
  ev(ODOO, 'click', { element: el('ListItem', '[HRC-2MM] Hot-rolled steel sheet 2 mm, 4 x 8 ft') }),
  ev(ODOO, 'value', { element: el('Edit', '', 'product_qty_1', '500') }),
  ev(ODOO, 'value', { element: el('Edit', '', 'price_unit_1', '38.50') }),
  ev(ODOO, 'value', { element: el('Edit', 'Expected Arrival?', 'date_planned_0', '11/12/2026 12:00:00') }),
  ev(ODOO, 'click', { element: el('Button', 'Save manually') }),
  { ...ev(ODOO, 'click', { element: el('Button', 'Start') }), app: 'other' },
];

describe('normalize', () => {
  const actions = normalize(raw, T0);

  it('turns the chore into workflow actions', () => {
    const kinds = actions.map((a) => `${a.kind}${a.field ? `:${a.field}` : ''}${a.varKey ? `<${a.varKey}` : ''}`);
    expect(kinds).toContain('copy<po_number');
    expect(kinds).toContain('copy<item_sku');
    expect(kinds).toContain('paste:po_number');
    expect(kinds).toContain('type:supplier');
    expect(kinds).toContain('save');
    expect(actions.some((a) => a.kind === 'click' && a.messageId === 'm-4471')).toBe(true);
  });

  it('completes dropdown fields with the picked item', () => {
    const supplier = actions.filter((a) => a.field === 'supplier' && a.kind === 'type').pop();
    expect(supplier?.value).toBe('Ridgeline Steel Co.');
    const sku = actions.filter((a) => a.field === 'item_sku').pop();
    expect(sku?.value).toBe('HRC-2MM');
  });

  it('keeps the real UI Automation details and drops other apps', () => {
    const paste = actions.find((a) => a.kind === 'paste')!;
    expect(paste.target?.automationId).toBe('partner_ref_0');
    expect(paste.target?.name).toBe('Vendor Reference');
    expect(paste.target?.rect).toEqual([100, 200, 300, 30]);
    expect(actions.some((a) => a.target?.name === 'Start')).toBe(false);
  });

  it('builds a recording the predefined workflow can point into', () => {
    const built = toRecording(actions)!;
    expect(built).not.toBeNull();
    const values = sampleValues(built.rec);
    expect(values).toMatchObject({ supplier: 'Ridgeline Steel Co.', po_number: 'PO-4471', item_sku: 'HRC-2MM', quantity: '500', unit_price: '38.50' });
    const wf = buildWorkflow(defaultEdits());
    for (const id of ['trigger', 'extract', 'open', 'fill', 'save']) {
      expect(sourceEvents(wf.nodes.find((n) => n.id === id)!, built.rec).length, id).toBeGreaterThan(0);
    }
  });
});

describe('normalize on a real capture', () => {
  // The first chore recorded on this PC, before the helper tracked picked values.
  const fx = userChore as unknown as { startedAt: number; raw: RawOsEvent[] };
  const actions = normalize(fx.raw, fx.startedAt);

  it('credits the inbox row click with opening the email', () => {
    const open = actions.find((a) => a.messageId === 'm-4471');
    expect(open?.kind).toBe('click');
    expect(open?.t).toBeLessThan(6000);
  });

  it('sees the quantity, the Odoo switch and the save on leaving the form', () => {
    expect(actions.some((a) => a.kind === 'type' && a.field === 'quantity' && a.value === '500')).toBe(true);
    expect(actions.some((a) => a.kind === 'app_switch' && a.app === 'erp')).toBe(true);
    expect(actions.some((a) => a.kind === 'save' && a.target?.tid === 'erp:save:auto')).toBe(true);
  });

  it('keeps the partial recording', () => {
    expect(toRecording(actions, { actions: 3, fills: 1 })).not.toBeNull();
  });
});

describe('opening an email from the inbox list', () => {
  it('credits the row click when the window title then shows the subject', () => {
    const base = { type: 'event' as const, process: 'chrome.exe', hwnd: 1, app: 'mail' as const };
    const raw: RawOsEvent[] = [
      { ...base, kind: 'click', ts: T0 + 1000, window: 'Inbox (1) - customermontecarlo@gmail.com - Gmail - Google Chrome', element: el('DataItem', 'Priya Nair, Ridgeli.', '', undefined, ['Inbox (1)', 'Primary']) },
      { ...base, kind: 'title', ts: T0 + 1600, window: 'Order confirmation for PO-4471 - customermontecarlo@gmail.com - Gmail - Google Chrome' },
    ];
    const a = normalize(raw, T0);
    expect(a).toHaveLength(1);
    expect(a[0].messageId).toBe('m-4471');
    expect(a[0].target?.name).toBe('Order confirmation for PO-4471');
  });
});
