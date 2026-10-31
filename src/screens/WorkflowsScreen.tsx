import { useEffect, useMemo, useState } from 'react';
import { BuildChecklist, BuildMeter, useBuildProgress } from '../components/BuildProgress';
import { Flowchart } from '../components/Flowchart';
import { IconCheck, IconKnowledge, IconLink, IconVm, IconWorkflow } from '../components/Icons';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { VideoReplay } from '../components/VideoReplay';
import { FIELD_LABEL, VAR_KEYS } from '../data/desktop';
import { VAR_SOURCE, inboxFor } from '../data/scenario';
import type { PricePolicy, Recording, VarKey, WfNode, Workflow } from '../data/schema';
import { mappingRows, sampleValues, sourceEvents, sourceRange } from '../data/workflow';
import { BUYER_LABEL, DECISION_LABEL, backtest, fieldChecks, orderHistory } from '../data/history';
import type { OrderHistory } from '../data/history';
import { fmt } from '../lib/format';
import { useLoop } from '../lib/hooks';
import { answeredByRecords, buildQuestions, nodeEvidence } from '../lib/workflowBuilder';
import type { AnswerSource, BuildQuestion } from '../lib/workflowBuilder';
import { openInOdoo } from './TestsScreen';
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

  const kb = useStore().knowledge.data;
  const h = useMemo(() => orderHistory(kb), [kb]);
  const questions = buildQuestions(rec, kb, wf.edits, h);
  const byRecords = answeredByRecords(questions);
  const [openQ, setOpenQ] = useState<BuildQuestion['id'] | null>(null);
  useEffect(() => {
    if (selected) setOpenQ(null);
  }, [selected]);

  const node = wf.nodes.find((n) => n.id === selected) ?? null;
  const question = questions.find((q) => q.id === openQ) ?? null;
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
            <div>
              <dt>Questions</dt>
              <dd>
                {unanswered ? <span className="pill is-ask">1 to answer</span> : byRecords ? `${byRecords} of ${questions.length} answered by your records` : 'All answered'}
              </dd>
            </div>
          </dl>
        </div>
        <div className="head-side">
          {wf.edits.approved ? (
            <button type="button" className="btn is-primary" onClick={() => setState({ tab: 'tests' })}>
              <IconVm size={16} /> Test on this PC
            </button>
          ) : (
            <button type="button" className="btn is-primary" disabled={unanswered} onClick={approveWorkflow} title={unanswered ? 'Answer the question first' : undefined}>
              <IconCheck size={16} /> Approve workflow
            </button>
          )}
        </div>
      </header>

      <RecordsPanel
        questions={questions}
        wf={wf}
        openId={openQ}
        onOpen={(id) => {
          setOpenQ(id);
          setState({ selectedNode: null });
        }}
      />

      <div className="wf-main">
        <div className="wf-canvas panel">
          <Flowchart
            wf={wf}
            selected={selected}
            revealed={shown}
            sourceLabel={sourceLabel}
            evidence={(n) => nodeEvidence(n, h, wf.edits)}
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
          {node ? (
            <Inspector node={node} wf={wf} rec={rec} h={h} approver={questions.find((q) => q.id === 'price')?.suggestion?.approver ?? null} />
          ) : question ? (
            <QuestionDetail q={question} wf={wf} onClose={() => setOpenQ(null)} />
          ) : (
            <Overview wf={wf} rec={rec} h={h} />
          )}
        </aside>
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<AnswerSource, string> = {
  recording: 'Recording',
  knowledge: 'Knowledge base',
  history: 'Past orders',
  'built-in': 'Built in',
  you: 'You',
};

function SourceChips({ q }: { q: BuildQuestion }) {
  const seen = Array.from(new Set(q.evidence.map((e) => e.by)));
  return (
    <span className="src-chips">
      {seen.map((by) => <span key={by} className={`src-chip is-${by}`}>{SOURCE_LABEL[by]}</span>)}
    </span>
  );
}

/** What the workflow will do for a question, in one line. */
function answerLine(q: BuildQuestion, wf: Workflow, h: { approver: string | null }): string {
  if (q.id === 'mapping') return 'As in the recording';
  if (q.id === 'missing') return 'Stop and flag it for a person';
  const e = wf.edits;
  if (e.answer === null) return 'Needs your answer';
  if (e.answer === 'save') return 'Save it at any price';
  if (e.answer === 'flag') return `Flag it when the price is more than ${e.threshold}% off`;
  return `Ask ${h.approver ?? 'a buyer'} when the price is more than ${e.threshold}% off`;
}

function setPricePolicy(answer: PricePolicy, threshold: number) {
  answerQuestion(answer);
  updateEdits((e) => ({ ...e, threshold }));
}

/**
 * What the recording couldn't show, and who answered it: the recording, the knowledge base, the
 * order history, or the reviewer. Each card opens its evidence in the side panel.
 */
function RecordsPanel({ questions, wf, openId, onOpen }: { questions: BuildQuestion[]; wf: Workflow; openId: string | null; onOpen: (id: BuildQuestion['id']) => void }) {
  const price = questions.find((q) => q.id === 'price');
  const s = price?.suggestion;
  return (
    <section className="rec-qs" aria-label="Questions the recording couldn't answer">
      {questions.map((q) => (
        <div key={q.id} className={`rec-q panel${q.open ? ' is-open' : ''}${openId === q.id ? ' is-active' : ''}`}>
          <button type="button" className="rec-q-main" onClick={() => onOpen(q.id)}>
            <span className="rec-q-text">{q.text}</span>
            <span className="rec-q-answer">{answerLine(q, wf, { approver: q.suggestion?.approver ?? null })}</span>
            <SourceChips q={q} />
          </button>
          {q.id === 'price' && s && !s.applied && (
            <button type="button" className="btn is-primary is-small rec-q-use" onClick={() => setPricePolicy(s.answer, s.threshold)}>
              Use {s.by === 'knowledge' ? 'the rule' : 'past orders'}: {s.answer === 'ask' ? 'ask' : s.answer} over {s.threshold}%
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function QuestionDetail({ q, wf, onClose }: { q: BuildQuestion; wf: Workflow; onClose: () => void }) {
  return (
    <div className="detail">
      <button type="button" className="link-btn rec-back" onClick={onClose}>Back to the overview</button>
      <h2>{q.text}</h2>
      <ul className="evidence">
        {q.evidence.map((e, i) => (
          <li key={i}>
            <span className={`src-chip is-${e.by}`}>{SOURCE_LABEL[e.by]}</span>
            <p>{e.text}</p>
            {e.quote && <p className="kb-quote">{e.quote}</p>}
            {e.orders?.some((o) => o.url) && (
              <p className="evidence-links">
                {e.orders.filter((o) => o.url).map((o) => (
                  <button key={o.label} type="button" className="link-btn" onClick={() => openInOdoo(o.url!)}>
                    <IconLink size={13} /> {o.label} in Odoo
                  </button>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
      {q.id === 'price' && (
        <section>
          <h3>What the workflow does</h3>
          <div className="policy-pick" role="radiogroup" aria-label="Price change policy">
            {wf.question.options.map((o) => (
              <label key={o.id} className={wf.edits.answer === o.id ? 'is-on' : ''}>
                <input type="radio" name="price-policy" checked={wf.edits.answer === o.id} onChange={() => setPricePolicy(o.id, wf.edits.threshold)} />
                {o.label}
              </label>
            ))}
          </div>
          {(wf.edits.answer === 'ask' || wf.edits.answer === 'flag') && <ThresholdInput wf={wf} />}
        </section>
      )}
    </div>
  );
}

function ThresholdInput({ wf }: { wf: Workflow }) {
  return (
    <label className="threshold">
      {wf.edits.answer === 'flag' ? 'Flag' : 'Ask'} when the price is more than
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
  );
}

/** The workflow's logic run on every past email, next to what the buyer did. Updates as the reviewer edits. */
function Backtest({ wf, h }: { wf: Workflow; h: OrderHistory }) {
  if (!h.cases.length) {
    return (
      <section>
        <h3>Checked against past orders</h3>
        <p className="muted">No order history yet. Seed it (npm run odoo:seed, npm run email:send -- --history), then sync the Knowledge tab.</p>
      </section>
    );
  }
  const bt = backtest(h, wf.edits);
  const off = bt.rows.filter((r) => !r.agree || r.fields.some((f) => !f.ok));
  return (
    <section>
      <h3>Checked against past orders</h3>
      <p className={`bt-score${bt.decisionsAgree === bt.rows.length ? ' is-ok' : ' is-off'}`}>
        <strong>{bt.decisionsAgree} of {bt.rows.length}</strong> decisions match what buyers did · {bt.valuesAgree} of {bt.valuesTotal} values
      </p>
      <table className="var-table bt-table">
        <thead>
          <tr><th>Order</th><th>Buyer</th><th>Workflow</th></tr>
        </thead>
        <tbody>
          {bt.rows.map((r) => {
            const wrong = r.fields.filter((f) => !f.ok);
            return (
              <tr key={r.c.order.id} className={r.agree && !wrong.length ? '' : 'is-off'} title={r.why}>
                <td>
                  {r.c.order.url ? (
                    <button type="button" className="link-btn" onClick={() => openInOdoo(r.c.order.url!)}>{r.c.order.ref ?? r.c.order.name}</button>
                  ) : (r.c.order.ref ?? r.c.order.name)}
                </td>
                <td>{BUYER_LABEL[r.c.action]}</td>
                <td>
                  {r.agree ? <IconCheck size={12} /> : null} {DECISION_LABEL[r.workflow]}
                  {wrong.map((f) => (
                    <span key={f.field} className="bt-diff">{FIELD_LABEL[f.field]}: {f.workflow ?? 'empty'}, buyer entered {f.buyer}</span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {off.length > 0 && <p className="muted bt-note">Hover a row for the reason. Differences in red.</p>}
    </section>
  );
}

function PriceBacktest({ wf, h }: { wf: Workflow; h: OrderHistory }) {
  const rows = backtest(h, wf.edits).rows.filter((r) => r.c.change !== null && r.workflow !== 'flagged');
  return (
    <ul className="price-bt">
      {rows.map((r) => (
        <li key={r.c.order.id} className={r.agree ? '' : 'is-off'}>
          <span>{r.c.order.ref ?? r.c.order.name}</span>
          <span className="muted">{r.why.replace(/^Price /, '')}</span>
          <span>{r.agree ? <IconCheck size={12} /> : 'Buyer: '}{r.agree ? '' : BUYER_LABEL[r.c.action].toLowerCase()}</span>
        </li>
      ))}
    </ul>
  );
}

function Overview({ wf, rec, h }: { wf: Workflow; rec: Recording; h: OrderHistory }) {
  const sample = sampleValues(rec);
  return (
    <div className="detail">
      <h2>Values it pulls from each email</h2>
      <p className="muted">These change from order to order. Everything else in the recording stays the same every time.</p>
      <VarTable sample={sample} />
      {wf.edits.answer && (
        <p className="answered">
          <IconCheck size={14} /> Price changes: {wf.question.options.find((o) => o.id === wf.edits.answer)?.label}
          {wf.edits.answer !== 'save' && ` over ${wf.edits.threshold}%`}
        </p>
      )}
      <Backtest wf={wf} h={h} />
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

function Inspector({ node, wf, rec, h, approver }: { node: WfNode; wf: Workflow; rec: Recording; h: OrderHistory; approver: string | null }) {
  const range = sourceRange(node, rec);
  const checks = h.cases.length ? new Map(fieldChecks(h, wf.edits.mappings).map((c) => [c.field, c])) : null;
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
          {rec.video ? (
            <VideoReplay video={rec.video} events={rec.events} t={loopT} playing speed={1.25} className="is-mini" />
          ) : (
            <ReplayPlayer events={rec.events} messages={inboxFor(rec.inboxId)} t={loopT} className="is-mini" recording />
          )}
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
                {checks?.get(r.field) && (() => {
                  const c = checks.get(r.field)!;
                  return (
                    <span className={`map-check${c.agree < c.total ? ' is-off' : ''}`} title={c.differ.map((d) => `${d.c.order.ref ?? d.c.order.name}: email ${d.email ?? 'empty'}, buyer entered ${d.odoo}`).join('
') || undefined}>
                      {c.agree}/{c.total} past
                    </span>
                  );
                })()}
              </li>
            ))}
            <li><span>{FIELD_LABEL.notes}</span><em className="muted">Left empty</em></li>
          </ul>
        </section>
      )}

      {node.kind === 'decision' && (
        <section>
          <h3>Rule</h3>
          <ThresholdInput wf={wf} />
          {h.cases.length > 0 && <PriceBacktest wf={wf} h={h} />}
        </section>
      )}

      {node.kind === 'approval' && (
        <dl className="detail-list">
          <div><dt>Who approves</dt><dd>{approver ? `${approver}, as in past orders and the knowledge base` : 'The buyer on duty'}</dd></div>
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
