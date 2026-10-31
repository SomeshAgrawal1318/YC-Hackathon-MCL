// Runs the approved workflow on this PC: for each test email, the app decides each step and the
// Electron "hands" (electron/hands.cjs) carry it out in the real Gmail and Odoo. The same steps
// could later be carried out by an agent on a VM.
import { FIELD_LABEL, VAR_KEYS } from '../data/desktop';
import { extractOrder } from '../data/extract';
import type { LiveRun, Outcome, RunPlan, RunStep, VarKey, Variation, Workflow } from '../data/schema';
import { actorCall } from './actors';

type Shot = { shot?: string | null };

/** Calls one of the hands. With a runId it acts in that test's VM, otherwise on this PC. */
export function exec<T = Record<string, unknown>>(op: string, args: Record<string, unknown> = {}, runId?: string): Promise<T> {
  const bridge = window.mclBridge;
  if (!bridge?.invoke) return Promise.reject(new Error('Running tests needs the desktop app (npm run app).'));
  return bridge.invoke('hands', op, args, runId).catch((e: Error) => {
    // Electron prefixes errors from the main process; keep the readable part.
    const msg = String(e.message)
      .replace(/^Error invoking remote method 'hands': (Error: |TimeoutError: )?/, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;]*m/g, '')
      .split('\n')[0]
      .replace(/^locator\.(\w+): Timeout (\d+)ms exceeded\.?$/, 'An Odoo or Gmail element did not respond ($1 timed out after $2 ms).');
    throw new Error(msg);
  }) as Promise<T>;
}

const REQUIRED: Array<[VarKey, string]> = [['po_number', 'PO number'], ['item_sku', 'item'], ['quantity', 'quantity']];

export interface RunCallbacks {
  update: (variationId: string, patch: Partial<LiveRun>) => void;
  cancelled: () => boolean;
}

type Exec = <T = Record<string, unknown>>(op: string, args?: Record<string, unknown>) => Promise<T>;
type AskBuyer = (request: Record<string, unknown>) => Promise<unknown>;

/**
 * Puts a paused order on Dana's approval desk (the ApprovalDesk actor), which confirms or cancels it
 * in the local Odoo later. Never fails the run: without the actors server the order just stays a draft.
 */
const askBuyer: AskBuyer = (request) => actorCall('approvalOpen', request).catch((e) => console.warn('[actors] approval not opened:', (e as Error).message));

export async function runOnPc(wf: Workflow, variations: Variation[], cb: RunCallbacks) {
  try {
    // finish (below) also runs when prepare fails, so Trace stops ignoring input either way.
    const prep = await exec<{ vendors: string[]; skus: string[] }>('prepare');
    for (const v of variations) {
      if (cb.cancelled()) break;
      await runOne(wf, v, prep, cb, exec, askBuyer);
    }
  } finally {
    await exec('finish').catch(() => undefined);
  }
}

/** One fresh Freestyle VM per test, all running at once. */
export async function runInVms(wf: Workflow, variations: Variation[], cb: RunCallbacks) {
  const invoke = window.mclBridge?.invoke;
  if (!invoke) throw new Error('Running tests in VMs needs the desktop app (npm run app).');
  const stamp = Date.now().toString(36);
  const runIds = variations.map((v) => `${v.id}-${stamp}`);
  try {
    await Promise.all(
      variations.map(async (v, i) => {
        const runId = runIds[i];
        const t0 = Date.now();
        cb.update(v.id, { status: 'running', startedAt: t0, steps: [], active: { nodeId: 'boot', label: 'Starting a fresh VM', t0: 0 }, values: {}, shot: null, plan: null });
        try {
          const info = (await invoke('vm:start', { runId, label: v.id })) as NonNullable<LiveRun['vm']>;
          cb.update(v.id, { vm: info, active: { nodeId: 'boot', label: `VM ready in ${(info.readyMs / 1000).toFixed(1)} s`, t0: Date.now() - t0 } });
        } catch (e) {
          const msg = String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
          const plan: RunPlan = { variationId: v.id, events: [], steps: [], outcome: 'flagged', outcomeNote: `Stopped by an error: ${msg}`, duration: 0, entered: {}, bootMs: 0, error: msg };
          cb.update(v.id, { status: 'error', active: null, error: msg, plan });
          return;
        }
        const ex: Exec = (op, args = {}) => exec(op, args, runId);
        try {
          const prep = await ex<{ vendors: string[]; skus: string[] }>('prepare');
          await runOne(wf, v, prep, cb, ex);
        } catch (e) {
          const msg = (e as Error).message;
          const plan: RunPlan = { variationId: v.id, events: [], steps: [], outcome: 'flagged', outcomeNote: `Stopped by an error: ${msg}`, duration: 0, entered: {}, bootMs: 0, error: msg };
          cb.update(v.id, { status: 'error', active: null, error: msg, plan });
        }
      }),
    );
  } finally {
    await invoke('vm:release', runIds).catch(() => undefined);
  }
}

async function runOne(wf: Workflow, v: Variation, prep: { vendors: string[]; skus: string[] }, cb: RunCallbacks, exec: Exec, ask?: AskBuyer) {
  const start = Date.now();
  const steps: RunStep[] = [];
  let shot: string | null = null;
  let values: Partial<Record<VarKey, string>> = {};
  let entered: Partial<Record<VarKey, string>> = {};
  let record: RunPlan['record'];
  const now = () => Date.now() - start;
  cb.update(v.id, { status: 'running', startedAt: start, steps: [], active: null, values: {}, shot: null, plan: null });

  async function step(nodeId: string, label: string, fn: () => Promise<Shot & { label?: string; state?: RunStep['state'] }>) {
    const t0 = now();
    cb.update(v.id, { active: { nodeId, label, t0 } });
    const r = await fn();
    if (r.shot) shot = r.shot;
    steps.push({ nodeId, label: r.label ?? label, t0, t1: now(), state: r.state ?? 'done', shot: r.shot ?? shot ?? undefined });
    cb.update(v.id, { steps: [...steps], active: null, shot });
  }

  function finish(outcome: Outcome, outcomeNote: string, error?: string) {
    steps.push({ nodeId: 'end', label: outcome === 'completed' ? 'Done' : outcomeNote, t0: now(), t1: now(), state: outcome === 'completed' ? 'done' : outcome, shot: shot ?? undefined });
    const plan: RunPlan = { variationId: v.id, events: [], steps, outcome, outcomeNote, duration: now(), entered, bootMs: 0, record, error };
    cb.update(v.id, { status: error ? 'error' : 'done', steps: [...steps], active: null, plan, error });
  }

  try {
    let text = '';
    await step('trigger', `Opening "${v.message.subject}" in Gmail`, async () => {
      const r = await exec<{ text: string } & Shot>('gmailOpen', { subject: v.message.subject });
      text = r.text;
      return { ...r, label: `Opened the email from ${v.message.company}` };
    });

    let missing: string[] = [];
    await step('extract', 'Reading the order details', async () => {
      values = extractOrder(text, { vendors: prep.vendors, skus: prep.skus });
      cb.update(v.id, { values });
      missing = REQUIRED.filter(([k]) => !values[k]).map(([, label]) => label);
      if (missing.length) {
        const r = await exec<Shot>('gmailFlag');
        return { ...r, label: `No ${missing.join(', ')} found, stopped`, state: 'flagged' };
      }
      return { label: `Read ${Object.keys(values).length} values` };
    });
    if (missing.length) return finish('flagged', `Stopped: no ${missing.join(', ')} in the email`);

    await step('open', 'Opening a new purchase order in Odoo', () => exec<Shot>('odooNewPo').then((r) => ({ ...r, label: 'Opened a new request for quotation' })));

    await step('fill', 'Filling in the purchase order', async () => {
      let last: Shot = {};
      for (const field of VAR_KEYS) {
        const src = wf.edits.mappings[field];
        const value = src ? values[src] : undefined;
        if (!value) continue;
        cb.update(v.id, { active: { nodeId: 'fill', label: `Typing ${FIELD_LABEL[field]}: ${value}`, t0: now() } });
        last = await exec<Shot>('odooFill', { field, value });
        if (last.shot) cb.update(v.id, { shot: last.shot });
        entered[field] = value;
      }
      return { ...last, label: `Filled ${Object.keys(entered).length} fields` };
    });

    const policy = wf.edits.answer;
    if (policy === 'ask' || policy === 'flag') {
      let over = false;
      let change = 0;
      let last: number | null = null;
      await step('decision', 'Comparing with the last order in Odoo', async () => {
        const r = await exec<{ price: number | null; order?: string }>('odooLastPrice', { sku: values.item_sku });
        last = r.price;
        const price = Number(values.unit_price);
        change = last ? ((price - last) / last) * 100 : 0;
        over = !!last && Math.abs(change) > wf.edits.threshold;
        return { label: last ? `Price ${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs last order (${r.order})` : 'No earlier order to compare' };
      });
      if (over) {
        const detail = `Unit price $${Number(values.unit_price).toFixed(2)} is ${change.toFixed(1)}% ${change >= 0 ? 'above' : 'below'} the last order ($${last!.toFixed(2)}).`;
        if (policy === 'ask') {
          await step('approval', 'Saving a draft and asking a buyer', async () => {
            const saved = await exec<{ id: number; name: string; url: string } & Shot>('odooSave');
            const note = await exec<Shot>('odooLogNote', { id: saved.id, text: `Waiting for buyer approval. ${detail}` });
            const back = await exec<{ values: Partial<Record<VarKey, string>>; name: string; url: string }>('odooReadPo', { id: saved.id });
            entered = back.values;
            record = { id: saved.id, name: saved.name, url: back.url };
            await ask?.({
              poId: saved.id, poName: saved.name, url: back.url, supplier: values.supplier ?? v.message.company, poNumber: values.po_number ?? '',
              sku: values.item_sku ?? '', qty: values.quantity ?? '', unitPrice: values.unit_price ?? '', lastPrice: last, changePct: Number(change.toFixed(1)),
              reason: `price ${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs the last order`,
            });
            return { ...note, label: `Saved draft ${saved.name}, waiting for a buyer`, state: 'paused' };
          });
          return finish('paused', 'Paused for buyer approval (price change)');
        }
        await step('flag', 'Flagging for review', async () => {
          await exec('odooDiscard');
          const r = await exec<Shot>('gmailFlag');
          return { ...r, label: 'Flagged, nothing saved in Odoo', state: 'flagged' };
        });
        return finish('flagged', 'Flagged: price change');
      }
    }

    await step('save', 'Saving the purchase order', async () => {
      const saved = await exec<{ id: number; name: string; url: string } & Shot>('odooSave');
      const back = await exec<{ values: Partial<Record<VarKey, string>>; name: string; url: string }>('odooReadPo', { id: saved.id });
      entered = back.values;
      record = { id: saved.id, name: saved.name, url: back.url };
      return { ...saved, label: `Saved ${saved.name} (${values.po_number})` };
    });
    finish('completed', `Saved purchase order ${record?.name ?? ''}`.trim());
  } catch (e) {
    finish('flagged', `Stopped by an error: ${(e as Error).message}`, (e as Error).message);
  }
}
