// Dana's decision on a paused order, live from the ApprovalDesk actor: Approve / Reject while it
// waits, then who decided and what happened in Odoo. Renders nothing without the actors server or
// when the order was never put on the desk (for example a test run in a VM).
import { useState } from 'react';
import { APPROVALS, APPROVER, decideApproval, useActorState, type Approval, type ApprovalState } from '../lib/actors';
import { IconCheck, IconHand, IconX } from './Icons';

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function useApproval(record: { id: number; name: string } | undefined): Approval | null {
  const { state, connected } = useActorState<ApprovalState>(APPROVALS);
  if (!connected || !record || !state) return null;
  return state.items.find((i) => i.poId === record.id && i.poName === record.name) ?? null;
}

export function ApprovalStatus({ item, compact = false }: { item: Approval; compact?: boolean }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = (d: 'approve' | 'reject') => {
    setBusy(d);
    setError(null);
    decideApproval(item.poId, d)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  if (item.status !== 'waiting') {
    const ok = item.status === 'approved';
    return (
      <div className={`approval is-${item.status}`}>
        <span className={`pill is-${ok ? 'completed' : 'flagged'}`}>{ok ? <IconCheck size={13} /> : <IconX size={13} />} {ok ? 'Approved' : 'Rejected'}</span>
        <span className="muted small">
          by {item.decidedBy ?? APPROVER}{item.decidedAt ? ` at ${clock(item.decidedAt)}` : ''}{item.note ? ` · ${item.note}` : ''}
        </span>
      </div>
    );
  }
  return (
    <div className="approval is-waiting">
      <span className="pill is-paused"><IconHand size={13} /> Waiting for {APPROVER.split(' ')[0]}</span>
      {!compact && <span className="muted small">{item.reason}{item.remindedAt ? ' · reminder sent' : ''}</span>}
      <span className="approval-actions">
        <button type="button" className="btn is-small is-primary" disabled={!!busy} onClick={() => decide('approve')}>
          {busy === 'approve' ? 'Confirming…' : 'Approve'}
        </button>
        <button type="button" className="btn is-small" disabled={!!busy} onClick={() => decide('reject')}>
          {busy === 'reject' ? 'Cancelling…' : 'Reject'}
        </button>
      </span>
      {error && <p className="run-error">{error}</p>}
    </div>
  );
}

/** For a run's saved order: the approval, if one is open on Dana's desk. */
export function ApprovalControls({ record }: { record: { id: number; name: string } | undefined }) {
  const item = useApproval(record);
  return item ? <ApprovalStatus item={item} /> : null;
}
