import { useEffect, useState } from 'react';
import { BuildChecklist, BuildMeter, useBuildProgress } from '../components/BuildProgress';
import { Flowchart } from '../components/Flowchart';
import { IconCheck, IconLink, IconVm, IconWorkflow } from '../components/Icons';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { FIELD_LABEL, VAR_KEYS } from '../data/desktop';
import { VAR_SOURCE, inboxFor } from '../data/scenario';
import type { Recording, VarKey, WfNode, Workflow } from '../data/schema';
import { mappingRows, sampleValues, sourceEvents, sourceRange } from '../data/workflow';
import { fmt } from '../lib/format';
import { useLoop } from '../lib/hooks';
import {
  answerQuestion,
  approveWorkflow,
  currentRecording,
  currentWorkflow,
  setState,
  showNodeInRecording,
  skipBuild,
  updateEdits,
  useStore,
} from '../lib/store';

export function WorkflowsScreen() {
  const s = useStore();
  const rec = currentRecording(s);
  const progress = useBuildProgress(s.build);

  if (!rec) {
    return (
      <div className="screen empty">
        <IconWorkflow size={40} />
        <h1>No workflows yet</h1>
        <p>Record a task with Trace. The workflow is built from the recording.</p>
        <button type="button" className="btn" onClick={() => setState({ tab: 'recordings' })}>Go to recordings</button>
      </div>
    );
  }

  if (s.build.status !== 'ready') {
    return (
      <div className="screen building">
        <div className="building-card panel">
          <h1>Building the workflow from your recording</h1>
          <BuildMeter progress={progress} />
          <BuildChecklist rec={rec} progress={progress} />
          <button type="button" className="btn is-quiet is-small" onClick={skipBuild}>Skip ahead</button>
        </div>
      </div>
    );
  }

  return <WorkflowView rec={rec} wf={currentWorkflow(s)} selected={s.selectedNode} />;
}

const revealedFor = new Set<string>();

function WorkflowView({ rec, wf, selected }: { rec: Recording; wf: Workflow; selected: string | null }) {
  // One orchestrated reveal the first time a recording's flowchart appears.
  const [revealed, setRevealed] = useState(() => (revealedFor.has(rec.id) ? 99 : 0));
  useEffect(() => {
    if (revealedFor.has(rec.id)) {
      setRevealed(99);
      return;
    }
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setRevealed(n);
      if (n >= 7) {
        window.clearInterval(id);
        revealedFor.add(rec.id);
      }
    }, 280);
    return () => window.clearInterval(id);
  }, [rec.id]);
  const shown = Math.max(revealed, revealed >= 6 ? 99 : 0);

  const node = wf.nodes.find((n) => n.id === selected) ?? null;
  const unanswered = wf.edits.answer === null;
  const steps = wf.nodes.filter((n) => n.kind !== 'end').length;

  const sourceLabel = (n: WfNode) => {
    const r = sourceRange(n, rec);
    return r ? `From the recording, ${fmt(r[0], false)} to ${fmt(r[1], false)}` : null;
  };

  return (
    <div className="screen wf">
      <header className="screen-head">
        <div>
          <h1>{wf.name}</h1>
          <dl className="facts">
            <div><dt>Status</dt><dd><span className={`pill ${wf.edits.approved ? 'is-ok' : 'is-draft'}`}>{wf.edits.approved ? 'Approved' : 'Draft'}</span></dd></div>
            <div><dt>Steps</dt><dd>{steps}</dd></div>
            <div><dt>Values per order</dt><dd>6</dd></div>
            <div><dt>Questions</dt><dd>{unanswered ? <span className="pill is-ask">1 to answer</span> : 'All answered'}</dd></div>
          </dl>
        </div>
        <div className="head-side">
          {wf.edits.approved ? (
            <button type="button" className="btn is-primary" onClick={() => setState({ tab: 'tests' })}>
              <IconVm size={16} /> Test in VM
            </button>
          ) : (
            <button type="button" className="btn is-primary" disabled={unanswered} onClick={approveWorkflow} title={unanswered ? 'Answer the question first' : undefined}>
              <IconCheck size={16} /> Approve workflow
            </button>
          )}
        </div>
      </header>

      <div className="wf-main">
        <div className="wf-canvas panel">
          <Flowchart
            wf={wf}
            selected={selected}
            revealed={shown}
            sourceLabel={sourceLabel}
            onSelect={(id) => setState({ selectedNode: id })}
            onMove={(id, x, y) => updateEdits((e) => ({ ...e, positions: { ...e.positions, [id]: { x, y } }, approved: false }))}
            onAnswer={(p) => answerQuestion(p)}
            onShowSource={(id) => {
              const n = wf.nodes.find((x) => x.id === id);
              const r = n && sourceRange(n, rec);
              if (n && r) showNodeInRecording(id, r, sourceEvents(n, rec).map((e) => e.id));
            }}
          />
          <p className="canvas-hint">Drag steps to rearrange. Click a step to edit it.</p>
        </div>
        <aside className="wf-inspector panel">
          {node ? <Inspector node={node} wf={wf} rec={rec} /> : <Overview wf={wf} rec={rec} />}
        </aside>
      </div>
    </div>
  );
}

function Overview({ wf, rec }: { wf: Workflow; rec: Recording }) {
  const sample = sampleValues(rec);
  return (
    <div className="detail">
      <h2>Values it pulls from each email</h2>
      <p className="muted">These change from order to order. Everything else in the recording stays the same every time.</p>
      <VarTable sample={sample} />
      {wf.edits.answer && (
        <p className="answered">
          <IconCheck size={14} /> Price changes: {wf.question.options.find((o) => o.id === wf.edits.answer)?.label}
        </p>
      )}
    </div>
  );
}

function VarTable({ sample }: { sample: Partial<Record<VarKey, string>> }) {
  return (
    <table className="var-table">
      <thead>
        <tr><th>Value</th><th>In the recording</th><th>Comes from</th></tr>
      </thead>
      <tbody>
        {VAR_KEYS.map((k) => (
          <tr key={k}>
            <td><code className="var">{`{${k}}`}</code></td>
            <td>{sample[k] ?? <span className="muted">not seen</span>}</td>
            <td className="muted">{VAR_SOURCE[k]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Inspector({ node, wf, rec }: { node: WfNode; wf: Workflow; rec: Recording }) {
  const range = sourceRange(node, rec);
  const loopT = useLoop(range);
  const targets = Array.from(new Map(sourceEvents(node, rec).filter((e) => e.target).map((e) => [e.target!.tid, e.target!])).values());

  return (
    <div className="detail">
      <label className="edit-title">
        <span className="muted">Step name</span>
        <input
          value={node.title}
          onChange={(e) => {
            const v = e.target.value;
            updateEdits((ed) => ({ ...ed, titles: { ...ed.titles, [node.id]: v }, approved: false }));
          }}
        />
      </label>

      {range ? (
        <section className="learned">
          <h3>Learned from this part of the recording</h3>
          <ReplayPlayer events={rec.events} messages={inboxFor(rec.inboxId)} t={loopT} className="is-mini" recording />
          <button type="button" className="link-btn" onClick={() => showNodeInRecording(node.id, range, sourceEvents(node, rec).map((e) => e.id))}>
            <IconLink size={14} /> Open {fmt(range[0], false)} to {fmt(range[1], false)} in the recording
          </button>
        </section>
      ) : node.kind !== 'end' ? (
        <p className="muted">Added from your answer to the question. It has no part of the recording behind it.</p>
      ) : null}

      {node.kind === 'extract' && <VarTable sample={sampleValues(rec)} />}

      {node.kind === 'fill' && (
        <section>
          <h3>Fields</h3>
          <ul className="map-edit">
            {mappingRows(wf).map((r) => (
              <li key={r.field}>
                <span>{r.label}</span>
                <select
                  value={r.v ?? ''}
                  onChange={(e) => {
                    const v = (e.target.value || null) as VarKey | null;
                    updateEdits((ed) => ({ ...ed, mappings: { ...ed.mappings, [r.field]: v }, approved: false }));
                  }}
                  aria-label={`Value for ${r.label}`}
                >
                  {VAR_KEYS.map((k) => <option key={k} value={k}>{`{${k}}`}</option>)}
                  <option value="">Leave empty</option>
                </select>
              </li>
            ))}
            <li><span>{FIELD_LABEL.notes}</span><em className="muted">Left empty</em></li>
          </ul>
        </section>
      )}

      {node.kind === 'decision' && (
        <section>
          <h3>Rule</h3>
          <label className="threshold">
            Ask when the price is more than
            <input
              type="number"
              min={1}
              max={50}
              value={wf.edits.threshold}
              onChange={(e) => {
                const v = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                updateEdits((ed) => ({ ...ed, threshold: v, approved: false }));
              }}
            />
            % away from the last order
          </label>
        </section>
      )}

      {node.kind === 'approval' && (
        <dl className="detail-list">
          <div><dt>Who approves</dt><dd>The buyer on duty</dd></div>
          <div><dt>If nobody replies</dt><dd>Flags the email after 4 hours</dd></div>
        </dl>
      )}

      {targets.length > 0 && (
        <section>
          <h3>Screen elements it uses</h3>
          <ul className="targets">
            {targets.map((t) => (
              <li key={t.tid}><span className="muted">{t.role}</span> {t.name}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
