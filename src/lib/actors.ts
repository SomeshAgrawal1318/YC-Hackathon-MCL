// The app's view of the Durable Actors backend (actors/, see electron/actors.cjs).
// Calls go through the main process; live state comes over a WebSocket the main process grants.
import { useEffect, useState } from 'react';
import type { ShadowDay, ShadowStatus, ShadowTotals } from '../data/shadowCompare';
import { isElectron } from './bus';

export const SHADOW = { actor: 'ShadowDeployment', id: 'po-workflow' } as const;
export const APPROVALS = { actor: 'ApprovalDesk', id: 'dana' } as const;
export const APPROVER = 'Dana Ortiz';

export interface ShadowFeedEntry {
  id: string;
  time: number;
  supplier: string;
  po: string;
  result: ShadowStatus;
  note: string;
}

/** The emitted state of ShadowDeployment (actors/src/actors.ts). */
export interface ShadowState {
  status: 'off' | 'watching';
  source: 'imap' | 'injected only';
  totals: ShadowTotals;
  days: ShadowDay[];
  feed: ShadowFeedEntry[];
  lastCheck: number | null;
  lastError: string | null;
}

export interface Approval {
  poId: number;
  poName: string;
  url: string;
  supplier: string;
  poNumber: string;
  sku: string;
  qty: string;
  unitPrice: string;
  lastPrice: number | null;
  changePct: number;
  reason: string;
  status: 'waiting' | 'approved' | 'rejected';
  openedAt: number;
  remindedAt: number | null;
  decidedAt: number | null;
  decidedBy: string | null;
  note: string | null;
}

/** The emitted state of ApprovalDesk. */
export interface ApprovalState {
  items: Approval[];
  pending: number;
}

export function actorCall<T = unknown>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const bridge = window.mclBridge;
  if (!bridge?.invoke) return Promise.reject(new Error('Durable Actors need the desktop app (npm run app).'));
  return bridge.invoke('actors', op, args).catch((e: Error) => {
    throw new Error(String(e.message).replace(/^Error invoking remote method 'actors': (Error: )?/, '').split('\n')[0]);
  }) as Promise<T>;
}

type Msg = { type: 'state'; state: Record<string, unknown> } | { type: 'state_update'; changes: Record<string, unknown>; removed?: string[] };

/**
 * An actor's emitted state, kept live over a WebSocket. Reconnects with a fresh grant when the
 * socket closes (for example when the actors server restarts). `connected` is false outside Electron
 * or while the server is down, so callers can fall back.
 */
export function useActorState<T>(target: { actor: string; id: string }): { state: T | null; connected: boolean } {
  const [state, setState] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!isElectron) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const retry = (ms: number) => {
      setConnected(false);
      if (!stopped) timer = setTimeout(connect, ms);
    };
    async function connect() {
      try {
        const grant = await actorCall<{ websocketUrl: string }>('grant', { actor: target.actor, id: target.id });
        if (stopped) return;
        ws = new WebSocket(grant.websocketUrl);
        ws.onopen = () => setConnected(true);
        ws.onmessage = (e) => {
          const m = JSON.parse(String(e.data)) as Msg;
          if (m.type === 'state') setState(m.state as T);
          else if (m.type === 'state_update') {
            setState((prev) => {
              const next: Record<string, unknown> = { ...(prev as Record<string, unknown> | null), ...m.changes };
              for (const k of m.removed ?? []) delete next[k];
              return next as T;
            });
          }
        };
        ws.onclose = () => retry(2000);
      } catch {
        retry(5000);
      }
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [target.actor, target.id]);
  return { state, connected };
}

/** Approve or reject a paused order as Dana: the actor confirms or cancels it in Odoo. */
export function decideApproval(poId: number, decision: 'approve' | 'reject') {
  return actorCall<Approval>('approvalDecide', { poId, decision, by: APPROVER });
}
