import type { A11yTarget, Action, AppId, DesktopState, FieldKey, MailMessage, TraceEvent, VarKey } from './schema';

/** Field names as Odoo's purchase order form shows them. */
export const FIELD_LABEL: Record<FieldKey, string> = {
  supplier: 'Vendor',
  po_number: 'Vendor Reference',
  item_sku: 'Product',
  quantity: 'Quantity',
  unit_price: 'Unit Price',
  delivery_date: 'Expected Arrival',
  notes: 'Terms and conditions',
};

export const FORM_FIELDS: FieldKey[] = ['supplier', 'po_number', 'item_sku', 'quantity', 'unit_price', 'delivery_date', 'notes'];
export const VAR_KEYS: VarKey[] = ['supplier', 'po_number', 'item_sku', 'quantity', 'unit_price', 'delivery_date'];

export const APP_NAME: Record<AppId, string> = {
  desktop: 'Desktop',
  mail: 'Gmail',
  erp: 'Odoo',
};

/** Accessibility targets, named the way the Windows UI Automation tree would name them. */
export const T = {
  task: (app: Exclude<AppId, 'desktop'>): A11yTarget => ({
    tid: `task:${app}`,
    role: 'Button',
    name: APP_NAME[app],
    path: ['Taskbar', 'Running applications'],
  }),
  message: (m: MailMessage): A11yTarget => ({
    tid: `mail:msg:${m.id}`,
    role: 'ListItem',
    name: m.subject,
    path: ['Mailbox', 'Inbox', 'Message list'],
  }),
  value: (key: VarKey, text: string): A11yTarget => ({
    tid: `mail:val:${key}`,
    role: 'Text',
    name: text,
    path: ['Mailbox', 'Reading pane', 'Message body'],
  }),
  newPo: (): A11yTarget => ({
    tid: 'erp:new-po',
    role: 'Button',
    name: 'New purchase order',
    path: ['NorthStar ERP', 'Purchasing', 'Purchase orders'],
  }),
  field: (key: FieldKey): A11yTarget => ({
    tid: `erp:field:${key}`,
    role: 'Edit',
    name: FIELD_LABEL[key],
    path: ['NorthStar ERP', 'Purchasing', 'New purchase order'],
  }),
  save: (): A11yTarget => ({
    tid: 'erp:save',
    role: 'Button',
    name: 'Save',
    path: ['NorthStar ERP', 'Purchasing', 'New purchase order'],
  }),
  cancel: (): A11yTarget => ({
    tid: 'erp:cancel',
    role: 'Button',
    name: 'Cancel',
    path: ['NorthStar ERP', 'Purchasing', 'New purchase order'],
  }),
};

export function initialDesktop(): DesktopState {
  return {
    focus: 'desktop',
    mail: { selectedId: null, selection: null },
    erp: { screen: 'list', fields: {}, focused: null, saved: false, banner: null },
    note: null,
  };
}

const clone = <V,>(v: V): V => JSON.parse(JSON.stringify(v));

/** Pure reducer: desktop state after an action. Used by live capture, the scripted recording and agent runs. */
export function applyAction(prev: DesktopState, a: Action): DesktopState {
  const s = clone(prev);
  if (a.app !== 'desktop') s.focus = a.app;
  switch (a.kind) {
    case 'app_switch':
      s.focus = a.app;
      break;
    case 'click':
      if (a.app === 'mail' && a.messageId) {
        s.mail.selectedId = a.messageId;
        s.mail.selection = null;
      } else if (a.target?.tid === 'erp:new-po') {
        s.erp = { screen: 'form', fields: {}, focused: null, saved: false, banner: null };
      } else if (a.target?.tid === 'erp:cancel') {
        s.erp = { screen: 'list', fields: {}, focused: null, saved: false, banner: null };
      } else if (a.field) {
        s.erp.focused = a.field;
      }
      break;
    case 'type':
    case 'paste':
      if (a.field) {
        s.erp.screen = 'form';
        s.erp.fields[a.field] = a.value ?? '';
        s.erp.focused = a.field;
        s.erp.banner = null;
        s.erp.saved = false;
      }
      break;
    case 'copy':
    case 'read':
      if (a.varKey) s.mail.selection = a.varKey;
      break;
    case 'save': {
      const po = s.erp.fields.po_number || 'draft';
      s.erp.saved = true;
      s.erp.focused = null;
      s.erp.banner = { kind: 'saved', title: `Purchase order ${po} saved` };
      break;
    }
  }
  return s;
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Turn timed actions into events with a desktop snapshot after each one. */
export function materialize(steps: Array<Action & { t: number; dur?: number }>, start = initialDesktop()): TraceEvent[] {
  let state = start;
  return steps.map((step, i) => {
    state = applyAction(state, step);
    return { ...step, id: `e${i}`, snap: state };
  });
}

/** Desktop state at time t (ms), including partially typed text and cursor-free details. */
export function stateAt(events: TraceEvent[], t: number, start = initialDesktop()): { state: DesktopState; index: number } {
  let index = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i].t <= t) index = i;
    else break;
  }
  if (index < 0) return { state: start, index };
  const ev = events[index];
  let state = ev.snap;
  if (ev.kind === 'type' && ev.field && ev.dur && t < ev.t + ev.dur) {
    const value = ev.value ?? '';
    const shown = value.slice(0, Math.max(1, Math.ceil((value.length * (t - ev.t)) / ev.dur)));
    state = { ...state, erp: { ...state.erp, fields: { ...state.erp.fields, [ev.field]: shown } } };
  }
  return { state, index };
}
