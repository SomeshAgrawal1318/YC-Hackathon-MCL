import { useMemo, useState } from 'react';
import { IconCheck, IconDeploy, IconReport, IconX } from '../components/Icons';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { ApprovalControls } from '../components/ApprovalControls';
import { FIELD_LABEL, VAR_KEYS } from '../data/desktop';
import { VARIATIONS, inboxFor } from '../data/scenario';
import { judge } from '../data/runs';
import type { RunResult } from '../data/runs';
import { fmt } from '../lib/format';
import { currentWorkflow, runPlans, setState, useStore } from '../lib/store';
import { EXPECT_LABEL, OUTCOME_LABEL, OutcomeIcon, openInOdoo } from './TestsScreen';

export function ReportsScreen() {
  const s = useStore();
  const wf = currentWorkflow(s);
  const results = useMemo(
    () => runPlans(s).map((p) => judge(wf, VARIATIONS.find((v) => v.id === p.variationId)!, p)),
    [s.edits, s.tests.runs, s.tests.mode],
  );
  const [openId, setOpenId] = useState<string>(VARIATIONS[0].id);
  const pc = s.tests.mode === 'pc' || s.tests.mode === 'vm';

  if (s.tests.status !== 'done' || !results.length) {
    return (
      <div className="screen empty">
        <IconReport size={40} />
        <h1>No report yet</h1>
        <p>The report appears when the test runs have finished.</p>
        <button type="button" className="btn" onClick={() => setState({ tab: 'tests' })}>Go to test runs</button>
      </div>
    );
  }

  const passed = results.filter((r) => r.passed).length;
  const count = (o: string) => results.filter((r) => r.plan.outcome === o).length;
  const avg = results.reduce((a, r) => a + r.plan.duration - r.plan.bootMs, 0) / results.length;
  const open = results.find((r) => r.plan.variationId === openId) ?? results[0];

  return (
    <div className="screen report">
      <header className="screen-head">
        <div>
          <h1 className="report-headline">
            {passed} of {results.length} behaved as expected
          </h1>
          <dl className="facts">
            <div><dt>Saved</dt><dd>{count('completed')}</dd></div>
            <div><dt>Asked a buyer</dt><dd>{count('paused')}</dd></div>
            <div><dt>Flagged</dt><dd>{count('flagged')}</dd></div>
            <div><dt>Average run</dt><dd>{fmt(avg, false)} {s.tests.mode === 'vm' ? 'per email, each in a fresh VM' : pc ? 'per email, on this PC' : 'after the VM starts'}</dd></div>
          </dl>
        </div>
        <div className="head-side">
          <button type="button" className="btn is-primary" onClick={() => setState({ tab: 'deploy' })}>
            <IconDeploy size={16} /> Deploy in shadow mode
          </button>
        </div>
      </header>

      <div className="report-main">
        <div className="panel report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Test</th>
                <th>Expected</th>
                <th>What happened</th>
                <th>Odoo fields</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const v = VARIATIONS.find((x) => x.id === r.plan.variationId)!;
                return (
                  <tr key={v.id} className={openId === v.id ? 'is-open' : ''} onClick={() => setOpenId(v.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(v.id)}>
                    <td>
                      <span className={`verdict ${r.passed ? 'is-pass' : 'is-fail'}`} aria-label={r.passed ? 'As expected' : 'Not as expected'}>
                        {r.passed ? <IconCheck size={13} /> : <IconX size={13} />}
                      </span>
                      <b>{v.title}</b>
                      <div className="muted small">{v.whatsDifferent}</div>
                    </td>
                    <td>{EXPECT_LABEL[r.expected]}</td>
                    <td><span className={`pill is-${r.plan.outcome}`}><OutcomeIcon o={r.plan.outcome} /> {OUTCOME_LABEL[r.plan.outcome]}</span></td>
                    <td>{Object.keys(r.plan.entered).length ? (r.fieldsOk ? `${Object.keys(r.plan.entered).length} of ${Object.keys(r.plan.entered).length} correct` : `${r.mismatches.length} wrong`) : 'None entered'}</td>
                    <td>{fmt(r.plan.duration - r.plan.bootMs, false)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <aside className="panel report-detail">
          <RunDetail r={open} />
        </aside>
      </div>
    </div>
  );
}

function RunDetail({ r }: { r: RunResult }) {
  const v = VARIATIONS.find((x) => x.id === r.plan.variationId)!;
  return (
    <div className="detail">
      <h2>{v.title}</h2>
      <p className="muted">{r.plan.outcomeNote}.</p>
      {r.plan.record && (
        <button type="button" className="link-btn odoo-link" onClick={() => openInOdoo(r.plan.record!.url)}>Open {r.plan.record.name} in Odoo</button>
      )}
      {r.plan.outcome === 'paused' && <ApprovalControls record={r.plan.record} />}
      <table className="cmp-table">
        <thead>
          <tr><th>Field</th><th>Expected</th><th>Entered</th></tr>
        </thead>
        <tbody>
          {VAR_KEYS.map((k) => {
            const exp = v.expected[k];
            const got = r.plan.entered[k];
            const ok = got === undefined ? null : got === exp;
            return (
              <tr key={k} className={ok === false ? 'is-wrong' : ''}>
                <td>{FIELD_LABEL[k]}</td>
                <td>{exp ?? <span className="muted">not in the email</span>}</td>
                <td>{got ?? <span className="muted">nothing</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>Step by step</h3>
      <ol className="shots">
        {r.plan.steps.filter((st) => st.nodeId !== 'end').map((st) => (
          <li key={st.nodeId} className={`shot is-${st.state}`}>
            <div className="shot-img">
              {st.shot ? (
                <img src={st.shot} alt={st.label} />
              ) : r.plan.events.length ? (
                <ReplayPlayer events={r.plan.events} messages={inboxFor(v.id)} t={Math.max(r.plan.bootMs, st.t1 - 60)} agent />
              ) : null}
            </div>
            <span>{st.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
