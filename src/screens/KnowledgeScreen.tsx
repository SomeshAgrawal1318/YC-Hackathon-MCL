import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, LinkObject, NodeObject } from 'react-force-graph-2d';
import { IconKnowledge, IconX } from '../components/Icons';
import { ShapeIcon, drawInner, tracePath } from '../components/KbShapes';
import { TYPE_COLOR, TYPE_LABEL, factsAbout, graphData } from '../data/knowledge';
import type { EntityType, GraphLink, GraphNode, KbEntity, KbSource, Knowledge } from '../data/knowledge';
import { isElectron } from '../lib/bus';
import { askKnowledge, resetKnowledge, syncKnowledge, useStore } from '../lib/store';

type View = 'graph' | 'list';
type FNode = NodeObject<GraphNode>;
type FLink = LinkObject<GraphNode, GraphLink>;

const KINDS: Array<EntityType> = ['supplier', 'product', 'person', 'team', 'system', 'rule', 'process', 'shipper', 'other'];
/** New knowledge pulses for this long, so the audience sees it arrive. */
const NEW_MS = 15000;

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleString();
};

function sourceLabel(src: KbSource | undefined) {
  if (!src) return 'Unknown source';
  if (src.kind === 'email') return `Email${src.from ? ` from ${src.from}` : ''}: “${src.title}”`;
  if (src.kind === 'recording') return `Trace recording: ${src.title}`;
  return src.title;
}

export function KnowledgeScreen() {
  const s = useStore();
  const k = s.knowledge;
  const kb = k.data;
  const [view, setView] = useState<View>('graph');
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [showSources, setShowSources] = useState(false);
  const [query, setQuery] = useState('');

  const entities = Object.values(kb.entities);
  const facts = kb.facts.filter((f) => !f.supersededBy);
  const sources = Object.values(kb.sources);
  const counts = {
    emails: sources.filter((x) => x.kind === 'email').length,
    recordings: sources.filter((x) => x.kind === 'recording').length,
  };
  const sel = selected ? kb.entities[selected] ?? null : null;

  if (!isElectron) {
    return (
      <div className="screen empty">
        <IconKnowledge size={40} />
        <h1>Knowledge</h1>
        <p>The knowledge base reads Gmail, Odoo and Trace recordings, so it needs the desktop app (npm run app).</p>
      </div>
    );
  }

  return (
    <div className="screen kb">
      <header className="screen-head">
        <div>
          <h1>Knowledge</h1>
          <dl className="facts">
            <div><dt>Things known</dt><dd>{entities.length}</dd></div>
            <div><dt>Facts</dt><dd>{facts.length}</dd></div>
            <div><dt>Learned from</dt><dd>{counts.emails} emails, {counts.recordings} recordings, Odoo</dd></div>
            <div><dt>Last sync</dt><dd>{kb.syncedAt ? ago(kb.syncedAt) : 'never'}</dd></div>
          </dl>
        </div>
        <div className="head-side">
          <div className="seg-toggle" role="group" aria-label="View">
            <button type="button" className={view === 'graph' ? 'is-on' : ''} onClick={() => setView('graph')}>Graph</button>
            <button type="button" className={view === 'list' ? 'is-on' : ''} onClick={() => setView('list')}>List</button>
          </div>
          <button type="button" className="btn is-primary" onClick={syncKnowledge} disabled={k.syncing}>
            {k.syncing ? <><i className="spinner is-light" /> Syncing</> : 'Sync from Gmail and Odoo'}
          </button>
        </div>
      </header>

      {(k.syncing || (k.progress?.stage === 'done' && k.hasKey)) && k.progress && <p className="kb-progress">{k.syncing && <i className="spinner" />} {k.progress.detail}</p>}
      {k.error && <div className="notice" role="alert"><span>{k.error}</span></div>}
      {!k.hasKey && !k.error && (
        <div className="notice" role="status">
          <span>Odoo facts work now. To learn from emails and Trace recordings, add <code>ANTHROPIC_API_KEY</code> to <code>.env.local</code>, then sync again.</span>
        </div>
      )}

      {!entities.length ? (
        <div className="kb-empty panel">
          <IconKnowledge size={40} />
          <h2>Nothing learned yet</h2>
          <p className="muted">Sync reads your suppliers, products and past orders from Odoo, then every new email in the Gmail inbox. Each Trace recording adds how the work is done. Every fact links back to where it came from.</p>
          <button type="button" className="btn is-primary" onClick={syncKnowledge} disabled={k.syncing}>Build the knowledge base</button>
        </div>
      ) : (
        <div className="kb-main">
          <section className={`kb-canvas ${view === 'graph' ? 'is-graph' : 'panel'}`}>
            {view === 'graph' && (
              <div className="kb-filters">
                {KINDS.filter((t) => entities.some((e) => e.type === t)).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`kb-chip${hidden.has(t) ? ' is-off' : ''}`}
                    onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; })}
                  >
                    <ShapeIcon kind={t} /> {TYPE_LABEL[t]}
                  </button>
                ))}
                <button type="button" className={`kb-chip${showSources ? '' : ' is-off'}`} onClick={() => setShowSources((v) => !v)}>
                  <ShapeIcon kind="source" /> Sources
                </button>
                <input className="kb-search" placeholder="Find…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find in the graph" />
              </div>
            )}
            {view === 'graph' ? (
              <KbGraph kb={kb} hidden={hidden} showSources={showSources} selected={selected} query={query} onSelect={setSelected} />
            ) : (
              <KbList kb={kb} onSelect={setSelected} />
            )}
          </section>
          <aside className="kb-side panel">
            {sel ? <EntityDetail kb={kb} e={sel} onSelect={setSelected} onClose={() => setSelected(null)} /> : <Overview kb={kb} onSelect={setSelected} />}
          </aside>
        </div>
      )}
      {entities.length > 0 && (
        <p className="muted small kb-foot">
          Stored on this PC in the app's data folder.{' '}
          <button type="button" className="link-btn" onClick={() => { if (window.confirm('Forget everything the knowledge base has learned?')) void resetKnowledge(); }}>Clear the knowledge base</button>
        </p>
      )}
    </div>
  );
}

// ---------- Graph ----------

function KbGraph({ kb, hidden, showSources, selected, query, onSelect }: { kb: Knowledge; hidden: Set<string>; showSources: boolean; selected: string | null; query: string; onSelect: (id: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<FNode, FLink> | undefined>(undefined);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [hover, setHover] = useState<string | null>(null);
  const fitted = useRef(false);
  // Keep node objects across updates so the layout doesn't jump when new knowledge arrives.
  const cache = useRef(new Map<string, FNode>());

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    const g = graphData(kb, { hidden, showSources });
    const nodes = g.nodes.map((n) => {
      const old = cache.current.get(n.id);
      const obj = old ? Object.assign(old, n) : ({ ...n } as FNode);
      cache.current.set(n.id, obj);
      return obj;
    });
    return { nodes, links: g.links.map((l) => ({ ...l })) as FLink[] };
  }, [kb, hidden, showSources]);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!m.has(a)) m.set(a, new Set());
      m.get(a)!.add(b);
    };
    for (const l of data.links) {
      const a = typeof l.source === 'object' ? (l.source as FNode).id : String(l.source);
      const b = typeof l.target === 'object' ? (l.target as FNode).id : String(l.target);
      add(a, b);
      add(b, a);
    }
    return m;
  }, [data]);

  /** Obsidian-style sizing: the more connected, the bigger. */
  const radius = (n: FNode) => (n.type === 'source' ? 3.2 : 4 + Math.sqrt((neighbors.get(String(n.id))?.size ?? 0) + 1) * 2.4);
  const colorOf = (end: FLink['source']) => {
    const id = typeof end === 'object' ? String((end as FNode).id) : String(end);
    const n = cache.current.get(id);
    return n ? TYPE_COLOR[n.type] : '#9aa5b5';
  };

  // Spread the graph out a little more than the library's default.
  useEffect(() => {
    const f = fg.current;
    if (!f) return;
    (f.d3Force('charge') as unknown as { strength?: (v: number) => void } | undefined)?.strength?.(-150);
    (f.d3Force('link') as unknown as { distance?: (v: number) => void } | undefined)?.distance?.(52);
    f.d3ReheatSimulation();
  }, [data]);

  const focus = hover ?? selected;
  const q = query.trim().toLowerCase();
  const isLit = (id: string) => !focus || id === focus || !!neighbors.get(focus)?.has(id);
  const endId = (end: FLink['source']) => (typeof end === 'object' ? (end as FNode).id : String(end));
  const linkLit = (l: FLink) => !!focus && (endId(l.source) === focus || endId(l.target) === focus);

  useEffect(() => {
    if (!q) return;
    const hit = data.nodes.find((n) => n.name.toLowerCase().includes(q));
    if (hit && hit.x !== undefined) fg.current?.centerAt(hit.x, hit.y, 500);
  }, [q]);

  useEffect(() => {
    if (!selected) return;
    const n = cache.current.get(selected);
    if (n?.x !== undefined) fg.current?.centerAt(n.x, n.y, 500);
  }, [selected]);

  return (
    <div ref={box} className="kb-graph">
      <ForceGraph2D<GraphNode, GraphLink>
        ref={fg}
        graphData={data}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        autoPauseRedraw={false}
        cooldownTicks={140}
        d3VelocityDecay={0.28}
        minZoom={0.4}
        maxZoom={6}
        onEngineStop={() => {
          if (!fitted.current) {
            fitted.current = true;
            fg.current?.zoomToFit(600, 70);
          }
        }}
        nodeLabel={(n) => `${n.name} · ${TYPE_LABEL[n.type]}`}
        onNodeHover={(n) => setHover(n ? String(n.id) : null)}
        onNodeClick={(n) => onSelect(String(n.id))}
        onBackgroundClick={() => onSelect(null)}
        linkLabel={(l) => l.label}
        linkCurvature={0.16}
        linkColor={(l) => {
          if (linkLit(l)) return colorOf(l.source);
          if (focus) return 'rgba(170,185,210,0.05)';
          return l.kind === 'source' ? 'rgba(170,185,210,0.08)' : 'rgba(170,185,210,0.2)';
        }}
        linkWidth={(l) => (linkLit(l) ? 1.6 : 0.7)}
        linkLineDash={(l) => (l.kind === 'source' ? [2, 3] : null)}
        linkDirectionalParticles={(l) => (linkLit(l) ? 3 : 0)}
        linkDirectionalParticleWidth={2.2}
        linkDirectionalParticleSpeed={0.006}
        linkDirectionalParticleColor={(l) => colorOf(l.source)}
        nodeCanvasObject={(node, ctx, scale) => {
          const n = node as FNode;
          const id = String(n.id);
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const r = radius(n);
          const lit = isLit(id);
          const hot = id === focus;
          const match = !!q && n.name.toLowerCase().includes(q);
          const color = TYPE_COLOR[n.type];
          const alpha = lit ? 1 : 0.14;
          const age = Date.now() - n.learnedAt;

          // New knowledge breathes out a halo for a few seconds.
          if (age < NEW_MS) {
            const k = (age % 1600) / 1600;
            ctx.globalAlpha = alpha * (1 - k) * 0.9;
            tracePath(ctx, n.type, x, y, r + 2 + k * 12);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2 / scale;
            ctx.stroke();
          }

          ctx.globalAlpha = alpha;
          ctx.shadowColor = color;
          ctx.shadowBlur = hot || match ? 22 : lit && focus ? 12 : 6;
          tracePath(ctx, n.type, x, y, r);
          if (n.type === 'source') {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.4 / scale;
            ctx.stroke();
          } else {
            ctx.fillStyle = color;
            ctx.fill();
          }
          ctx.shadowBlur = 0;
          if (n.type !== 'source') drawInner(ctx, n.type, x, y, r);
          if (id === selected || match) {
            tracePath(ctx, n.type, x, y, r + 3 / scale);
            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            ctx.lineWidth = 1.5 / scale;
            ctx.stroke();
          }

          const showLabel = n.type === 'source' ? hot : scale > 0.8 || hot || (!!focus && lit);
          if (showLabel) {
            const fs = Math.max(10.5 / scale, 2.4);
            ctx.font = `${n.type === 'rule' ? 600 : 500} ${fs}px "IBM Plex Sans", system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const label = n.name.length > 30 ? `${n.name.slice(0, 28)}…` : n.name;
            ctx.fillStyle = n.type === 'rule' ? '#ffb2a8' : hot ? '#ffffff' : 'rgba(214,223,236,0.86)';
            ctx.fillText(label, x, y + r * 1.25 + 3 / scale);
          }
          ctx.globalAlpha = 1;
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          const n = node as FNode;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, radius(n) + 4, 0, 2 * Math.PI);
          ctx.fill();
        }}
      />
    </div>
  );
}

// ---------- List ----------

function KbList({ kb, onSelect }: { kb: Knowledge; onSelect: (id: string) => void }) {
  const byType = KINDS.map((t) => ({ t, items: Object.values(kb.entities).filter((e) => e.type === t).sort((a, b) => b.mentions - a.mentions) })).filter((g) => g.items.length);
  return (
    <div className="kb-list">
      {byType.map(({ t, items }) => (
        <section key={t}>
          <h3><ShapeIcon kind={t} size={12} /> {TYPE_LABEL[t]} <span className="muted">{items.length}</span></h3>
          <table className="kb-table">
            <tbody>
              {items.map((e) => (
                <tr key={e.id} onClick={() => onSelect(e.id)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && onSelect(e.id)}>
                  <td className="kb-name">{e.name}</td>
                  <td className="muted">{e.summary}</td>
                  <td className="muted small">{factsAbout(kb, e.id).length} facts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

// ---------- Side panel ----------

function EntityDetail({ kb, e, onSelect, onClose }: { kb: Knowledge; e: KbEntity; onSelect: (id: string) => void; onClose: () => void }) {
  const list = factsAbout(kb, e.id);
  return (
    <div className="detail kb-detail">
      <div className="kb-detail-head">
        <span className="kb-type" style={{ background: TYPE_COLOR[e.type] }}>{TYPE_LABEL[e.type].replace(/s$/, '')}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><IconX size={16} /></button>
      </div>
      <h2>{e.name}</h2>
      {e.summary && <p>{e.summary}</p>}
      {e.type === 'rule' && e.props && (
        <dl className="detail-list">
          {e.props.threshold ? <div><dt>Threshold</dt><dd>{e.props.threshold}%</dd></div> : null}
          {e.props.action && e.props.action !== 'other' && <div><dt>Action</dt><dd>{e.props.action === 'ask' ? 'Pause and ask for approval' : e.props.action === 'flag' ? "Don't save, flag it" : 'Save'}</dd></div>}
          {e.props.approver && <div><dt>Approver</dt><dd>{e.props.approver}</dd></div>}
          {e.props.quote && <div><dt>In their words</dt><dd className="kb-quote">“{e.props.quote}”</dd></div>}
        </dl>
      )}
      <h3>What's known ({list.length})</h3>
      <ul className="kb-facts">
        {list.map((f) => {
          const other = f.subject === e.id ? { id: f.object, name: f.objectName } : { id: f.subject, name: f.subjectName };
          return (
            <li key={f.id}>
              <p>{f.statement}</p>
              <button type="button" className="link-btn" onClick={() => onSelect(other.id)}>{f.subject === e.id ? `${f.relation} → ${other.name}` : `${other.name} ${f.relation} this`}</button>
              <p className="muted small">{sourceLabel(kb.sources[f.sources[0]])}</p>
              {f.quote && <p className="kb-quote small">“{f.quote}”</p>}
            </li>
          );
        })}
      </ul>
      <h3>Learned from</h3>
      <ul className="kb-sources">
        {e.sources.map((id) => <li key={id} className="small">{sourceLabel(kb.sources[id])}</li>)}
      </ul>
    </div>
  );
}

function Overview({ kb, onSelect }: { kb: Knowledge; onSelect: (id: string) => void }) {
  const s = useStore();
  const k = s.knowledge;
  const [q, setQ] = useState('');
  const rules = Object.values(kb.entities).filter((e) => e.type === 'rule');
  const recent = kb.facts.filter((f) => !f.supersededBy).slice().sort((a, b) => b.learnedAt - a.learnedAt).slice(0, 6);
  const factById = new Map(kb.facts.map((f) => [f.id, f]));
  return (
    <div className="detail">
      <h2>Ask the knowledge base</h2>
      <form className="kb-ask" onSubmit={(e) => { e.preventDefault(); void askKnowledge(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Who approves price changes?" aria-label="Question" disabled={!k.hasKey} />
        <button type="submit" className="btn" disabled={!k.hasKey || k.asking || !q.trim()}>{k.asking ? <i className="spinner" /> : 'Ask'}</button>
      </form>
      {!k.hasKey && <p className="muted small">Asking needs a Claude API key in .env.local.</p>}
      {k.answer && (
        <div className="kb-answer">
          <p>{k.answer.answer}</p>
          {k.answer.citations.length > 0 && (
            <ul className="kb-cites">
              {k.answer.citations.map((c) => {
                const f = factById.get(c);
                const ruleId = c.startsWith('rule:') ? c.slice(5) : null;
                if (ruleId && kb.entities[ruleId]) return <li key={c}><button type="button" className="link-btn" onClick={() => onSelect(ruleId)}>{kb.entities[ruleId].name}</button></li>;
                return f ? <li key={c} className="small">{f.statement} <span className="muted">· {sourceLabel(kb.sources[f.sources[0]])}</span></li> : null;
              })}
            </ul>
          )}
        </div>
      )}

      <h3>Rules ({rules.length})</h3>
      {rules.length ? (
        <ul className="kb-facts">
          {rules.map((r) => (
            <li key={r.id}>
              <button type="button" className="link-btn kb-rule" onClick={() => onSelect(r.id)}>{r.name}</button>
              <p className="small">{r.props?.statement || r.summary}</p>
              <p className="muted small">{sourceLabel(kb.sources[r.props?.sourceId ?? r.sources[0]])}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No rules yet. They come from emails, like Dana's note on price changes.</p>
      )}

      <h3>Recently learned</h3>
      <ul className="kb-facts">
        {recent.map((f) => (
          <li key={f.id}>
            <p className="small">{f.statement}</p>
            <p className="muted small">{sourceLabel(kb.sources[f.sources[0]])} · {ago(f.learnedAt)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
