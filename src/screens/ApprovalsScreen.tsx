// Dana's approvals (#/dana): the buyer's own window on the ApprovalDesk actor. It shares one live
// actor with the report in the main window, so a decision in either shows in both at once.
import { ApprovalStatus } from '../components/ApprovalControls';
import { IconHand } from '../components/Icons';
import { APPROVALS, APPROVER, useActorState, type ApprovalState } from '../lib/actors';
import { openInOdoo } from './TestsScreen';

const when = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function ApprovalsScreen() {
  const { state, connected } = useActorState<ApprovalState>(APPROVALS);
  const items = state?.items ?? [];
  const waiting = items.filter((i) => i.status === 'waiting');
  const decided = items.filter((i) => i.status !== 'waiting');

  return (
    <div className="dana">
      <header className="dana-head">
        <div className="dana-avatar" aria-hidden>{APPROVER.split(' ').map((w) => w[0]).join('')}</div>
        <div>
          <h1>{APPROVER}</h1>
          <p className="muted small">Planning Manager · approves price changes over the threshold</p>
        </div>
        <span className={`dana-conn${connected ? ' is-on' : ''}`}>{connected ? 'Live' : 'Connecting…'}</span>
      </header>

      <h2>Waiting for you {waiting.length > 0 && <span className="nav-count">{waiting.length}</span>}</h2>
      {!waiting.length && (
        <div className="dana-empty">
          <IconHand size={28} />
          <p>Nothing to approve right now.</p>
          {!connected && <p className="muted small">Start the actors server with “npm run actors:dev”.</p>}
        </div>
      )}
      {waiting.map((i) => <ApprovalCard key={i.poId} item={i} />)}

      {decided.length > 0 && <h2>Decided</h2>}
      {decided.map((i) => <ApprovalCard key={i.poId} item={i} />)}
    </div>
  );
}

function ApprovalCard({ item }: { item: ApprovalState['items'][number] }) {
  return (
    <article className={`panel dana-card is-${item.status}`}>
      <div className="dana-card-head">
        <b>{item.poName}</b>
        <span className="muted small">{item.supplier} · {item.poNumber} · asked at {when(item.openedAt)}</span>
      </div>
      <p className="dana-price">
        {item.qty} × {item.sku} at <b>${Number(item.unitPrice).toFixed(2)}</b>
        {item.lastPrice !== null && <span className="muted"> (last order ${item.lastPrice.toFixed(2)}, {item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(1)}%)</span>}
      </p>
      <ApprovalStatus item={item} compact />
      <button type="button" className="link-btn odoo-link" onClick={() => openInOdoo(item.url)}>Open {item.poName} in Odoo</button>
    </article>
  );
}
