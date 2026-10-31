// Turns what trace-helper reported (raw OS events) into workflow actions: opened the email, copied
// a value, pasted it into a field, saved. Only Gmail and Odoo count; other apps stay in the raw log.
import { APP_NAME } from './desktop';
import { DROPDOWN_FIELDS, gmailMeaning, messageIn, odooMeaning } from './profiles';
import { RECORDING_INBOX } from './scenario';
import type { A11yTarget, Action, FieldKey, RawOsEvent, VarKey } from './schema';

export type TimedAction = Action & { t: number };

const VAR_KEYS: VarKey[] = ['supplier', 'po_number', 'item_sku', 'quantity', 'unit_price', 'delivery_date'];
const isVar = (f?: FieldKey): f is VarKey => !!f && (VAR_KEYS as string[]).includes(f);

function target(ev: RawOsEvent, tid: string, name: string): A11yTarget {
  const el = ev.element;
  return {
    tid,
    role: el?.role ?? 'Window',
    name,
    path: el?.path?.length ? el.path : [ev.window],
    automationId: el?.automationId || undefined,
    rect: el?.rect,
    process: ev.process,
  };
}

/** "[HRC-2MM] Hot-rolled steel…" → "HRC-2MM", anything else unchanged. */
const productCode = (s: string) => s.match(/^\s*\[([^\]]+)\]/)?.[1] ?? s.trim();

export function normalize(raw: RawOsEvent[], t0: number): TimedAction[] {
  const out: TimedAction[] = [];
  /** The last Odoo field typed into, to complete it when an item is picked from its dropdown. */
  let lastField: { field: FieldKey; at: number; tid: string } | null = null;
  /** A Gmail click that may turn out to have opened an email (see below). */
  let lastMailClick: { action: TimedAction; at: number } | null = null;
  const opened = new Set<string>();

  for (const ev of [...raw].sort((a, b) => a.ts - b.ts)) {
    if (ev.app !== 'mail' && ev.app !== 'erp') continue;
    const t = Math.max(0, ev.ts - t0);
    const app = ev.app;
    const el = ev.element;

    // Gmail names an inbox row after the sender; the subject shows up in the window title once
    // the email is open. Credit the click just before with opening it.
    if (app === 'mail' && lastMailClick && ev.ts - lastMailClick.at < 6000) {
      const m = messageIn(ev.window) ?? (el ? messageIn(el.path.join(' ')) : null);
      if (m && !opened.has(m.id)) {
        opened.add(m.id);
        Object.assign(lastMailClick.action, { messageId: m.id, target: { ...lastMailClick.action.target!, tid: `mail:msg:${m.id}`, name: m.subject } });
        lastMailClick = null;
      }
    }

    if (ev.kind === 'foreground') {
      out.push({ t, kind: 'app_switch', app, target: target(ev, `task:${app}`, APP_NAME[app]) });
      continue;
    }

    if ((ev.kind === 'click' || ev.kind === 'dblclick') && el) {
      if (app === 'erp') {
        const m = odooMeaning(el);
        // Picking a vendor or product from Odoo's dropdown completes the field typed into just before.
        if (!m.field && lastField && DROPDOWN_FIELDS.includes(lastField.field) && ev.ts - lastField.at < 15000 && !m.save && m.tid.startsWith('erp:el:')) {
          const value = lastField.field === 'item_sku' ? productCode(el.name) : el.name.trim();
          if (value) {
            out.push({ t, kind: 'type', app, field: lastField.field, value, target: { ...target(ev, lastField.tid, m.name), name: m.name } });
            lastField = null;
            continue;
          }
        }
        if (m.save) out.push({ t, kind: 'save', app, target: target(ev, m.tid, m.name) });
        else out.push({ t, kind: 'click', app, field: m.field, target: target(ev, m.tid, m.name) });
      } else {
        const m = gmailMeaning(el);
        // Only the first click into an email opens it; later clicks inside it are reading.
        const opens = m.messageId && !opened.has(m.messageId);
        if (opens) opened.add(m.messageId!);
        const a: TimedAction = opens
          ? { t, kind: 'click', app, messageId: m.messageId, target: target(ev, m.tid, m.name) }
          : { t, kind: 'click', app, target: target(ev, m.messageId ? 'mail:body' : m.tid, m.messageId ? 'Message body' : m.name) };
        out.push(a);
        if (!opens && !m.messageId) lastMailClick = { action: a, at: ev.ts };
      }
      continue;
    }

    if (ev.kind === 'value' && el && el.value !== undefined) {
      if (app === 'erp') {
        const m = odooMeaning(el);
        if (m.field) {
          const pasted = ev.keys === 'Ctrl+V';
          const value = m.field === 'item_sku' ? productCode(el.value) : el.value;
          out.push({ t, kind: pasted ? 'paste' : 'type', app, field: m.field, value, target: target(ev, m.tid, m.name) });
          lastField = { field: m.field, at: ev.ts, tid: m.tid };
        }
      } else {
        const m = gmailMeaning(el);
        out.push({ t, kind: 'type', app, value: el.value, target: target(ev, m.tid, m.name) });
      }
      continue;
    }

    if (ev.kind === 'clipboard' && app === 'mail' && ev.text?.trim()) {
      const text = ev.text.trim().slice(0, 200);
      out.push({ t, kind: 'copy', app, value: text, target: target(ev, 'mail:body', text.slice(0, 40)) });
      continue;
    }

    if (ev.kind === 'shortcut' && app === 'erp' && ev.keys === 'Ctrl+S') {
      out.push({ t, kind: 'save', app, target: target(ev, 'erp:save', 'Save (Ctrl+S)') });
    }
  }

  labelCopies(out);
  return out;
}

/**
 * A copied value means whatever field it was pasted into. Falls back to matching the text
 * against the values in the recorded supplier email.
 */
function labelCopies(actions: TimedAction[]) {
  const spans = new Map<string, VarKey>();
  for (const m of RECORDING_INBOX) for (const p of m.body) if (typeof p !== 'string') spans.set(p.text.trim(), p.key);
  actions.forEach((a, i) => {
    if (a.kind !== 'copy' || !a.value) return;
    const pasted = actions.slice(i + 1).find((b) => (b.kind === 'paste' || b.kind === 'type') && b.app === 'erp' && b.value?.trim() === a.value);
    const key = isVar(pasted?.field) ? pasted!.field as VarKey : spans.get(a.value);
    if (key) {
      a.varKey = key;
      a.target = { ...a.target!, tid: `mail:val:${key}`, name: a.value };
    }
  });
}
