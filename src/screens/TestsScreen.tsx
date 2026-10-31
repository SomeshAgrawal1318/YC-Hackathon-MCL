import { useMemo } from 'react';
import { IconCheck, IconFlag, IconHand, IconReport, IconVm } from '../components/Icons';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { FIELD_LABEL } from '../data/desktop';
import { VARIATIONS, inboxFor } from '../data/scenario';
import type { Outcome, RunPlan, Variation, Workflow } from '../data/schema';
import { expectedOutcome, planRun } from '../data/runs';
import { useFrameClock } from '../lib/hooks';
import { RUN_STAGGER, currentRecording, currentWorkflow, runTests, setState, useStore } from '../lib/store';

export const OUTCOME_LABEL: Record<Outcome, string> = {
  completed: 'Saved',
  paused: 'Asked a buyer',
  flagged: 'Flagged',
};
export const EXPECT_LABEL: Record<Outcome, string> = {
  completed: 'Should save',
  paused: 'Should ask a buyer',
  flagged: 'Should flag, not save',
};

export function OutcomeIcon({ o, size = 14 }: { o: Outcome; size?: number }) {
  return o === 'completed' ? <IconCheck size={size} /> : o === 'paused' ? <IconHand size={size} /> : <IconFlag size={size} />;
}

export function TestsScreen() {
  const s = useStore();
  const wf = currentWorkflow(s);
  const plans = useMemo(() => VARIATIONS.map((v) => planRun(wf, v)), [s.edits]);

  if (!currentRecording(s) || !wf.edits.approved) {
    return (
      <div className="screen empty">
        <IconVm size={40} />
        <h1>Approve the workflow first</h1>
        <p>Tests run the approved version of the workflow on fresh Windows VMs.</p>
        <button type="button" className="btn" onClick={() => setState({ tab: 'workflows' })}>Go to the workflow</button>
      </div>
    );
  }
  if (s.tests.status === 'idle') return <TestPlan wf={wf} />;
  return <TestRun wf={wf} plans={plans} />;
}

function TestPlan({ wf }: { wf: Workflow }) {
  return (
    <div className="screen tests">
      <header className="screen-head">
        <div>
          <h1>Test in VM</h1>
          <p className="lede">Each test starts a fresh Windows VM, drops one supplier email into the inbox and runs the approved workflow on it.</p>
        </div>
        <div className="head-side">
          <button type="button" className="btn is-primary" onClick={runTests}>
            <IconVm size={16} /> Run {VARIATIONS.length} tests
          </button>
        </div>
      </header>
      <ol className="variation-list">
        {VARIATIONS.map((v, i) => {
          const exp = expectedOutcome(wf, v);
          return (
            <li key={v.id} className="variation panel">
              <span className="variation-n">VM {i + 1}</span>
              <div>
                <h3>{v.title}</h3>
                <p className="muted">{v.whatsDifferent}</p>
              </div>
              <span className={`pill is-${exp}`}><OutcomeIcon o={exp} /> {EXPECT_LABEL[exp]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type Phase = 'queued' | 'booting' | 'running' | 'done';

function phaseOf(plan: RunPlan, local: number): Phase {
  if (local < 0) return 'queued';
  if (local < plan.bootMs) return 'booting';
  if (local < plan.duration) return 'running';
  return 'done';
}

function TestRun({ wf, plans }: { wf: Workflow; plans: RunPlan[] }) {
  const s = useStore();
  const running = s.tests.status === 'running';
  const now = useFrameClock(running, 60);
  const elapsed = running ? (now - s.tests.startedAt) * s.tests.speed : Number.POSITIVE_INFINITY;
  const local = (i: number) => Math.min(plans[i].duration, elapsed - i * RUN_STAGGER);

  const focusIdx = Math.max(0, VARIATIONS.findIndex((v) => v.id === s.tests.focusId));
  const fv = VARIATIONS[focusIdx];
  const fp = plans[focusIdx];
  const ft = local(focusIdx);
  const fphase = phaseOf(fp, ft);
  const finished = plans.filter((p, i) => phaseOf(p, local(i)) === 'done').length;

  return (
    <div className="screen tests is-running">
      <header className="screen-head">
        <div>
          <h1>Test runs</h1>
          <dl className="facts">
            <div><dt>VMs</dt><dd>{plans.length}</dd></div>
            <div><dt>Finished</dt><dd>{finished} of {plans.length}</dd></div>
            <div><dt>Workflow</dt><dd>Approved version</dd></div>
          </dl>
        </div>
        <div className="head-side">
          <button type="button" className="btn is-primary" disabled={s.tests.status !== 'done'} onClick={() => setState({ tab: 'reports' })}>
            <IconReport size={16} /> View the report
          </button>
        </div>
      </header>

      <div className="run-main">
        <section className="vm-focus panel" aria-label={`VM ${focusIdx + 1}`}>
          <div className="vm-focus-head">
            <h2>VM {focusIdx + 1}: {fv.title}</h2>
            <PhaseChip plan={fp} phase={fphase} t={ft} />
          </div>
          <div className="vm-screen">
            <ReplayPlayer events={fp.events} messages={inboxFor(fv.id)} t={Math.max(0, ft)} agent />
            {fphase !== 'running' && fphase !== 'done' && <BootCover phase={fphase} />}
          </div>
        </section>
        <aside className="vm-steps panel">
          <h2>Steps</h2>
          <StepList wf={wf} plan={fp} t={ft} />
          <h3>Values from this email</h3>
          <ValueList v={fv} plan={fp} t={ft} />
        </aside>
      </div>

      <div className="vm-grid" role="list">
        {plans.map((p, i) => {
          const v = VARIATIONS[i];
          const lt = local(i);
          const ph = phaseOf(p, lt);
          const qt = Math.max(0, Math.floor(lt / 90) * 90);
          return (
            <div
              key={v.id}
              role="listitem"
              tabIndex={0}
              aria-label={`VM ${i + 1}: ${v.title}`}
              className={`vm-tile${i === focusIdx ? ' is-focus' : ''} is-${ph === 'done' ? p.outcome : ph}`}
              onClick={() => setState({ tests: { ...s.tests, focusId: v.id } })}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setState({ tests: { ...s.tests, focusId: v.id } })}
            >
              <div className="vm-tile-screen">
                <ReplayPlayer events={p.events} messages={inboxFor(v.id)} t={qt} agent />
                {ph !== 'running' && ph !== 'done' && <BootCover phase={ph} small />}
              </div>
              <div className="vm-tile-label">
                <b>VM {i + 1}</b> {v.title}
              </div>
              <PhaseChip plan={p} phase={ph} t={lt} compact />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BootCover({ phase, small }: { phase: Phase; small?: boolean }) {
  return (
    <div className={`boot-cover${small ? ' is-small' : ''}`}>
      {phase === 'booting' ? (
        <><i className="spinner is-light" /> {small ? 'Starting' : 'Restoring a clean Windows snapshot'}</>
      ) : (
        <>{small ? 'Queued' : 'Waiting for a VM'}</>
      )}
    </div>
  );
}

function PhaseChip({ plan, phase, t, compact }: { plan: RunPlan; phase: Phase; t: number; compact?: boolean }) {
  if (phase === 'done') {
    return <span className={`pill is-${plan.outcome}`}><OutcomeIcon o={plan.outcome} /> {OUTCOME_LABEL[plan.outcome]}</span>;
  }
  if (phase === 'running') {
    const idx = plan.steps.findIndex((st) => t < st.t1);
    const step = plan.steps[idx >= 0 ? idx : plan.steps.length - 1];
    return <span className="pill is-run"><i className="spinner" /> {compact ? `Step ${idx + 1}` : step.label}</span>;
  }
  return <span className="pill is-wait">{phase === 'booting' ? 'Starting' : 'Queued'}</span>;
}

function StepList({ wf, plan, t }: { wf: Workflow; plan: RunPlan; t: number }) {
  const byNode = new Map(plan.steps.map((st) => [st.nodeId, st]));
  return (
    <ol className="step-list">
      {wf.nodes.map((n) => {
        const st = byNode.get(n.id);
        let state: 'todo' | 'active' | 'done' | 'paused' | 'flagged' | 'skipped' = 'todo';
        if (st && t >= st.t1) state = st.state === 'done' ? 'done' : st.state;
        else if (st && t >= st.t0) state = 'active';
        else if (!st && t >= plan.duration) state = 'skipped';
        return (
          <li key={n.id} className={`step is-${state}`}>
            <span className="step-mark">
              {state === 'done' ? <IconCheck size={13} /> : state === 'paused' ? <IconHand size={13} /> : state === 'flagged' ? <IconFlag size={13} /> : state === 'active' ? <i className="spinner" /> : null}
            </span>
            <span className="step-text">{st && state !== 'todo' ? st.label : n.title}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ValueList({ v, plan, t }: { v: Variation; plan: RunPlan; t: number }) {
  const read = new Set(plan.events.filter((e) => e.kind === 'read' && e.varKey && e.t <= t).map((e) => e.varKey));
  const keys = ['supplier', 'po_number', 'item_sku', 'quantity', 'unit_price', 'delivery_date'] as const;
  const extract = plan.steps.find((st) => st.nodeId === 'extract');
  const extracted = !!extract && t >= extract.t1;
  return (
    <dl className="value-list">
      {keys.map((k) => {
        const has = read.has(k) && v.expected[k];
        return (
          <div key={k} className={has ? 'is-read' : extracted ? 'is-missing' : ''}>
            <dt>{FIELD_LABEL[k]}</dt>
            <dd>{has ? v.expected[k] : extracted ? 'Not in the email' : <span className="muted">…</span>}</dd>
          </div>
        );
      })}
    </dl>
  );
}
