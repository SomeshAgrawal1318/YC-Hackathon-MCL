import { useMemo } from 'react';
import { IconCheck, IconFlag, IconHand, IconReport, IconVm } from '../components/Icons';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { ApprovalControls } from '../components/ApprovalControls';
import { FIELD_LABEL, VAR_KEYS } from '../data/desktop';
import { VARIATIONS, inboxFor } from '../data/scenario';
import type { LiveRun, Outcome, RunPlan, Variation, Workflow } from '../data/schema';
import { expectedOutcome, planRun } from '../data/runs';
import { isElectron } from '../lib/bus';
import { fmt } from '../lib/format';
import { useFrameClock } from '../lib/hooks';
import { RUN_STAGGER, currentRecording, currentWorkflow, refreshVmStatus, runSimulated, runTests, setState, setTestTarget, stopTests, useStore } from '../lib/store';
import { useEffect } from 'react';

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

export function openInOdoo(url: string) {
  if (window.mclBridge?.invoke) void window.mclBridge.invoke('shell:open-url', url);
  else window.open(url, '_blank');
}

export function TestsScreen() {
  const s = useStore();
  const wf = currentWorkflow(s);

  if (!currentRecording(s) || !wf.edits.approved) {
    return (
      <div className="screen empty">
        <IconVm size={40} />
        <h1>Approve the workflow first</h1>
        <p>Tests run the approved version of the workflow on this PC, in the real Gmail and Odoo.</p>
        <button type="button" className="btn" onClick={() => setState({ tab: 'workflows' })}>Go to the workflow</button>
      </div>
    );
  }
  if (s.tests.status === 'idle') return <TestPlan wf={wf} />;
  if (s.tests.mode === 'simulated') return <SimulatedRun wf={wf} />;
  return <LiveRunView wf={wf} />;
}

// ---------- Before running ----------

function TestPlan({ wf }: { wf: Workflow }) {
  const s = useStore();
  const inVms = s.tests.preferred === 'vm' && s.vm.available;
  useEffect(() => {
    void refreshVmStatus();
  }, []);
  return (
    <div className="screen tests">
      <header className="screen-head">
        <div>
          <h1>{inVms ? 'Test in VMs' : 'Test on this PC'}</h1>
          <p className="lede">
            {inVms
              ? 'Each test starts its own fresh VM with a clean Odoo, reads one supplier email from the demo inbox, and runs the approved workflow. All six run at once, and you can watch every VM screen live.'
              : 'Each test opens one supplier email in Gmail and runs the approved workflow in Odoo, on this PC. Chrome takes over the screen while the tests run, and this window comes back when they finish.'}
          </p>
        </div>
        <div className="head-side">
          {isElectron && (
            <div className="seg-toggle" role="group" aria-label="Where the tests run">
              <button type="button" className={!inVms ? 'is-on' : ''} onClick={() => setTestTarget('pc')}>On this PC</button>
              <button type="button" className={inVms ? 'is-on' : ''} onClick={() => setTestTarget('vm')} disabled={!s.vm.available} title={s.vm.available ? 'One Freestyle VM per test' : s.vm.reason}>In VMs</button>
            </div>
          )}
          <button type="button" className="btn is-primary" onClick={() => runTests()}>
            <IconVm size={16} /> Run {VARIATIONS.length} tests
          </button>
        </div>
      </header>
      {isElectron && !s.vm.available && <p className="muted small">VM runs: {s.vm.reason}</p>}
      {s.tests.error && (
        <div className="notice" role="alert">
          {s.tests.error}
          <div className="row">
            <button type="button" className="btn is-small" onClick={() => runTests()}>Try again</button>
            <button type="button" className="btn is-quiet is-small" onClick={runSimulated}>Run simulated instead</button>
          </div>
        </div>
      )}
      {!isElectron && <p className="muted">In the browser the tests are simulated. Run the desktop app (npm run app) to run them for real.</p>}
      <ol className="variation-list">
        {VARIATIONS.map((v, i) => {
          const exp = expectedOutcome(wf, v);
          return (
            <li key={v.id} className="variation panel">
              <span className="variation-n">Test {i + 1}</span>
              <div>
                <h3>{v.title}</h3>
                <p className="muted">{v.whatsDifferent}</p>
              </div>
              <span className={`pill is-${exp}`}><OutcomeIcon o={exp} /> {EXPECT_LABEL[exp]}</span>
              {isElectron && <button type="button" className="btn is-quiet is-small" onClick={() => runTests([v.id])}>Run this one</button>}
            </li>
          );
        })}
      </ol>
      <p className="muted small">The test emails must be in the demo inbox first: <code>npm run email:send -- --tests</code></p>
    </div>
  );
}

// ---------- Running on this PC ----------

function LiveRunView({ wf }: { wf: Workflow }) {
  const s = useStore();
  const variations = VARIATIONS.filter((v) => s.tests.runs[v.id]);
  const runs = variations.map((v) => s.tests.runs[v.id]);
  const finished = runs.filter((r) => r.status === 'done' || r.status === 'error').length;
  const focus = s.tests.runs[s.tests.focusId] ?? runs[0];
  const fv = VARIATIONS.find((v) => v.id === focus.variationId)!;
  const fi = VARIATIONS.indexOf(fv);
  const running = s.tests.status === 'running';
  const inVms = s.tests.mode === 'vm';

  return (
    <div className="screen tests is-running">
      <header className="screen-head">
        <div>
          <h1>Test runs</h1>
          <dl className="facts">
            <div><dt>Where</dt><dd>{inVms ? `${runs.length} Freestyle VMs, one per test` : 'This PC, Gmail and Odoo'}</dd></div>
            <div><dt>Finished</dt><dd>{finished} of {runs.length}</dd></div>
            <div><dt>Workflow</dt><dd>Approved version</dd></div>
          </dl>
        </div>
        <div className="head-side">
          {running && <button type="button" className="btn is-quiet" onClick={stopTests}>Stop after this test</button>}
          <button type="button" className="btn is-primary" disabled={running} onClick={() => setState({ tab: 'reports' })}>
            <IconReport size={16} /> View the report
          </button>
        </div>
      </header>

      <div className="run-main">
        <section className="vm-focus panel" aria-label={`Test ${fi + 1}`}>
          <div className="vm-focus-head">
            <h2>Test {fi + 1}: {fv.title}</h2>
            <LiveChip run={focus} />
          </div>
          <div className={`live-shot${focus.vm ? ' is-vm' : ''}`}>
            {focus.vm ? (
              <iframe className="vm-live" src={focus.vm.vncUrl} title={`Screen of the VM for test ${fi + 1}`} />
            ) : focus.shot ? (
              <img src={focus.shot} alt={`The screen during test ${fi + 1}`} />
            ) : (
              <span className="empty-shot">{focus.status === 'queued' ? 'Waiting for its turn' : <><i className="spinner is-light" /> Starting</>}</span>
            )}
          </div>
          {focus.plan?.record && !focus.vm && (
            <button type="button" className="link-btn odoo-link" onClick={() => openInOdoo(focus.plan!.record!.url)}>Open {focus.plan.record.name} in Odoo</button>
          )}
          {focus.plan?.outcome === 'paused' && !focus.vm && <ApprovalControls record={focus.plan.record} />}
          {focus.vm && (
            <p className="muted small vm-note">
              Fresh VM, ready in {(focus.vm.readyMs / 1000).toFixed(1)} s{focus.plan?.record ? ` · ${focus.plan.record.name} saved in this VM's Odoo` : ''} · the VM stays up 10 minutes after the run
            </p>
          )}
          {focus.error && <p className="run-error">{focus.error}</p>}
        </section>
        <aside className="vm-steps panel">
          <h2>Steps</h2>
          <LiveSteps wf={wf} run={focus} />
          <h3>Values from this email</h3>
          <dl className="value-list">
            {VAR_KEYS.map((k) => {
              const got = focus.values[k];
              const read = focus.steps.some((st) => st.nodeId === 'extract');
              return (
                <div key={k} className={got ? 'is-read' : read ? 'is-missing' : ''}>
                  <dt>{FIELD_LABEL[k]}</dt>
                  <dd>{got ?? (read ? 'Not in the email' : <span className="muted">…</span>)}</dd>
                </div>
              );
            })}
          </dl>
        </aside>
      </div>

      <div className="vm-grid" role="list">
        {runs.map((r) => {
          const v = VARIATIONS.find((x) => x.id === r.variationId)!;
          const i = VARIATIONS.indexOf(v);
          const cls = r.status === 'done' ? r.plan!.outcome : r.status === 'error' ? 'flagged' : r.status === 'running' ? 'running' : 'queued';
          return (
            <div
              key={v.id}
              role="listitem"
              tabIndex={0}
              aria-label={`Test ${i + 1}: ${v.title}`}
              className={`vm-tile${v.id === focus.variationId ? ' is-focus' : ''} is-${cls}`}
              onClick={() => setState({ tests: { ...s.tests, focusId: v.id } })}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setState({ tests: { ...s.tests, focusId: v.id } })}
            >
              <div className="run-card-shot">
                {r.vm ? (
                  <iframe className="vm-live is-tile" src={r.vm.vncUrl} title={`VM ${i + 1}`} tabIndex={-1} />
                ) : r.shot ? (
                  <img src={r.shot} alt="" />
                ) : (
                  <span className="muted small">{r.status === 'queued' ? 'Queued' : inVms ? 'Starting VM' : 'Starting'}</span>
                )}
              </div>
              <div className="vm-tile-label">
                <b>{inVms ? `VM ${i + 1}` : `Test ${i + 1}`}</b> {v.title}
              </div>
              <LiveChip run={r} compact />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiveChip({ run, compact }: { run: LiveRun; compact?: boolean }) {
  if (run.status === 'done' && run.plan) {
    return <span className={`pill is-${run.plan.outcome}`}><OutcomeIcon o={run.plan.outcome} /> {OUTCOME_LABEL[run.plan.outcome]}{run.plan.record && !compact ? `: ${run.plan.record.name}` : ''}</span>;
  }
  if (run.status === 'error') return <span className="pill is-flagged"><IconFlag size={14} /> Stopped by an error</span>;
  if (run.status === 'running') {
    const label = run.active?.label ?? run.steps[run.steps.length - 1]?.label ?? 'Starting';
    return <span className="pill is-run"><i className="spinner" /> {compact ? `Step ${run.steps.length + 1}` : label}</span>;
  }
  return <span className="pill is-wait">Queued</span>;
}

function LiveSteps({ wf, run }: { wf: Workflow; run: LiveRun }) {
  const finished = run.status === 'done' || run.status === 'error';
  return (
    <ol className="step-list">
      {wf.nodes.map((n) => {
        const st = run.steps.find((x) => x.nodeId === n.id);
        let state: 'todo' | 'active' | 'done' | 'paused' | 'flagged' | 'skipped' = 'todo';
        if (st) state = st.state;
        else if (run.active?.nodeId === n.id) state = 'active';
        else if (finished) state = 'skipped';
        const text = st ? st.label : state === 'active' ? run.active!.label : n.title;
        return (
          <li key={n.id} className={`step is-${state}`}>
            <span className="step-mark">
              {state === 'done' ? <IconCheck size={13} /> : state === 'paused' ? <IconHand size={13} /> : state === 'flagged' ? <IconFlag size={13} /> : state === 'active' ? <i className="spinner" /> : null}
            </span>
            <span className="step-text">{text}{st && st.t1 > st.t0 ? <span className="muted"> · {fmt(st.t1 - st.t0, false)}</span> : null}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Simulated runs (fallback) ----------

type Phase = 'queued' | 'booting' | 'running' | 'done';

function phaseOf(plan: RunPlan, local: number): Phase {
  if (local < 0) return 'queued';
  if (local < plan.bootMs) return 'booting';
  if (local < plan.duration) return 'running';
  return 'done';
}

function SimulatedRun({ wf }: { wf: Workflow }) {
  const s = useStore();
  const plans = useMemo(() => VARIATIONS.map((v) => planRun(wf, v)), [s.edits]);
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
          <h1>Test runs (simulated)</h1>
          <dl className="facts">
            <div><dt>Simulated VMs</dt><dd>{plans.length}</dd></div>
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
  const extract = plan.steps.find((st) => st.nodeId === 'extract');
  const extracted = !!extract && t >= extract.t1;
  return (
    <dl className="value-list">
      {VAR_KEYS.map((k) => {
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
