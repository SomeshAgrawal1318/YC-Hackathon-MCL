import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent, ReactElement } from 'react';
import { FIELD_LABEL } from '../data/desktop';
import type { PricePolicy, VarKey, WfEdge, WfNode, Workflow } from '../data/schema';
import { mappingRows } from '../data/workflow';
import { IconFlag, IconHand, IconLink, IconQuestion, IconSpark } from './Icons';

interface Props {
  wf: Workflow;
  selected: string | null;
  revealed: number;
  sourceLabel: (n: WfNode) => string | null;
  /** How well past orders back a step; weak ones are marked for review. */
  evidence?: (n: WfNode) => { text: string; detail: string; weak: boolean } | null;
  /** Footer for steps that came from the price answer rather than the recording. */
  addedLabel?: string;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onAnswer: (p: PricePolicy) => void;
  onShowSource: (id: string) => void;
}

const Q_W = 330;
const Q_H = 252;

function anchorPath(f: WfNode, t: WfNode): { d: string; lx: number; ly: number; anchor: 'start' | 'middle' } {
  const fcx = f.x + f.w / 2;
  const tcx = t.x + t.w / 2;
  // Target in a column to the right: right side to left side.
  if (t.x > f.x + f.w - 10) {
    const sx = f.x + f.w, sy = f.y + f.h / 2, ex = t.x, ey = t.y + t.h / 2;
    return { d: `M${sx},${sy} C${sx + 40},${sy} ${ex - 40},${ey} ${ex},${ey}`, lx: (sx + ex) / 2, ly: Math.min(sy, ey) - 9, anchor: 'middle' };
  }
  // Below, same column.
  if (Math.abs(tcx - fcx) < 40) {
    const sy = f.y + f.h, ey = t.y;
    return { d: `M${fcx},${sy} L${tcx},${ey}`, lx: fcx + 10, ly: (sy + ey) / 2 + 4, anchor: 'start' };
  }
  // Below and to the left: leave from the bottom-left corner, come into the target's right side.
  if (t.x + t.w < f.x + 20) {
    const sx = f.x + 34, sy = f.y + f.h, ex = t.x + t.w, ey = t.y + t.h / 2;
    return { d: `M${sx},${sy} C${sx},${ey} ${sx},${ey} ${ex},${ey}`, lx: sx + 10, ly: sy + 20, anchor: 'start' };
  }
  const sy = f.y + f.h, ey = t.y;
  return { d: `M${fcx},${sy} C${fcx},${(sy + ey) / 2} ${tcx},${(sy + ey) / 2} ${tcx},${ey}`, lx: (fcx + tcx) / 2, ly: (sy + ey) / 2, anchor: 'middle' };
}

const KIND_ICON: Partial<Record<WfNode['kind'], ReactElement>> = {
  extract: <IconSpark size={16} />,
  approval: <IconHand size={16} />,
  flag: <IconFlag size={16} />,
};

export function Flowchart({ wf, selected, revealed, sourceLabel, evidence, addedLabel = 'Added from your answer', onSelect, onMove, onAnswer, onShowSource }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 700 });
  const drag = useRef<{ id: string; sx: number; sy: number; nx: number; ny: number; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const order = new Map(wf.nodes.map((n, i) => [n.id, i]));
  const visible = (id: string) => (order.get(id) ?? 0) < revealed;
  const qNode = wf.nodes.find((n) => n.questionId);

  // Fit everything (nodes + question card) into the canvas.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of wf.nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
  }
  if (qNode) {
    maxX = Math.max(maxX, qNode.x + qNode.w + 36 + Q_W);
    minY = Math.min(minY, qNode.y - Q_H + qNode.h);
  }
  const pad = 36;
  const bw = maxX - minX, bh = maxY - minY;
  const scale = Math.min(1, (size.w - pad * 2) / bw, (size.h - pad * 2) / bh);
  const ox = (size.w - bw * scale) / 2 - minX * scale;
  const oy = pad - minY * scale;

  const onDown = (n: WfNode) => (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, nx: n.x, ny: n.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMoveP = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale, dy = (e.clientY - d.sy) / scale;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    onMove(d.id, Math.round(d.nx + dx), Math.round(d.ny + dy));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onSelect(d.id);
  };

  const edge = (e: WfEdge) => {
    const f = byId.get(e.from), t = byId.get(e.to);
    if (!f || !t) return null;
    const { d, lx, ly, anchor } = anchorPath(f, t);
    const show = visible(e.from) && visible(e.to);
    const hot = selected === e.from || selected === e.to;
    return (
      <g key={e.id} className={`fc-edge${hot ? ' is-hot' : ''}${show ? '' : ' is-hidden'}`}>
        <path d={d} markerEnd="url(#fc-arrow)" />
        {e.label && (
          <text x={lx} y={ly} className="fc-edge-label" textAnchor={anchor}>{e.label}</text>
        )}
      </g>
    );
  };

  return (
    <div className="fc" ref={box} onPointerDown={(e) => e.target === e.currentTarget && onSelect(null)}>
      <div className="fc-inner" style={{ transform: `translate(${ox}px, ${oy}px) scale(${scale})` }}>
        <svg className="fc-edges" width="1" height="1" aria-hidden>
          <defs>
            <marker id="fc-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" />
            </marker>
          </defs>
          {wf.edges.map(edge)}
        </svg>

        {wf.nodes.map((n, i) => {
          const src = sourceLabel(n);
          const ev = evidence?.(n) ?? null;
          return (
            <div
              key={n.id}
              className={`fc-node is-${n.kind}${selected === n.id ? ' is-selected' : ''}${visible(n.id) ? '' : ' is-hidden'}`}
              style={{ left: n.x, top: n.y, width: n.w, height: n.h, transitionDelay: visible(n.id) ? `${Math.min(i, 3) * 20}ms` : '0ms' }}
              onPointerDown={onDown(n)}
              onPointerMove={onMoveP}
              onPointerUp={onUp}
              role="button"
              tabIndex={0}
              aria-label={n.title}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(n.id)}
            >
              {n.kind === 'end' ? (
                <div className="fc-end">{n.title}</div>
              ) : (
                <>
                  <div className="fc-head">
                    {KIND_ICON[n.kind] && <span className="fc-kind-icon">{KIND_ICON[n.kind]}</span>}
                    <span className="fc-title">{n.title}</span>
                    {n.ai && <span className="fc-ai">Uses AI</span>}
                  </div>
                  {n.kind === 'extract' && (
                    <div className="fc-vars">
                      {n.vars?.map((v) => <code key={v} className="var">{`{${v}}`}</code>)}
                    </div>
                  )}
                  {n.kind === 'fill' ? (
                    <ul className="fc-map">
                      {mappingRows(wf).map((r) => (
                        <li key={r.field}>
                          <span>{r.label}</span>
                          {r.v ? <code className="var">{`{${r.v}}`}</code> : <em>left empty</em>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    n.detail && <p className="fc-detail">{n.detail}</p>
                  )}
                  <div className="fc-foot">
                    {src ? (
                      <button type="button" className="fc-src" onClick={() => onShowSource(n.id)}>
                        <IconLink size={13} /> {src}
                      </button>
                    ) : (
                      <span className="fc-src is-added">{addedLabel}</span>
                    )}
                    {ev && <span className={`fc-ev${ev.weak ? ' is-weak' : ''}`} title={`${ev.detail}${ev.weak ? '. Check this step.' : ''}`}>{ev.text}</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {qNode && visible(qNode.id) && (
          <div
            className="fc-question"
            style={{ left: qNode.x + qNode.w + 36, top: qNode.y + qNode.h - Q_H, width: Q_W, height: Q_H }}
            role="group"
            aria-label="Question about this step"
          >
            <svg className="fc-q-tail" style={{ top: Q_H - qNode.h / 2 - 10 }} width="36" height="20" aria-hidden><path d="M36,10 L2,10" /></svg>
            <div className="fc-q-head"><IconQuestion size={17} /> One question before you approve</div>
            <p className="fc-q-text">{wf.question.text}</p>
            <p className="fc-q-why">{wf.question.why}</p>
            <div className="fc-q-options">
              {wf.question.options.map((o) => (
                <button key={o.id} type="button" className="fc-q-opt" onClick={() => onAnswer(o.id)} title={o.hint}>
                  {o.id === 'ask' ? o.label.replace('5%', `${wf.edits.threshold}%`) : o.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const varLabel = (v: VarKey) => FIELD_LABEL[v];
