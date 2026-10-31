import { useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { APP_NAME } from '../data/desktop';
import type { AppId, EventKind, Recording, TraceEvent } from '../data/schema';
import { fmt } from '../lib/format';

export const KIND_LABEL: Record<EventKind, string> = {
  app_switch: 'Switched app',
  click: 'Clicked',
  type: 'Typed',
  copy: 'Copied',
  paste: 'Pasted',
  save: 'Saved',
  read: 'Read',
};

const LANES: Array<{ id: string; label: string; kinds: EventKind[] }> = [
  { id: 'apps', label: 'App in focus', kinds: ['app_switch'] },
  { id: 'input', label: 'Clicks and typing', kinds: ['click', 'type'] },
  { id: 'data', label: 'Clipboard and saves', kinds: ['copy', 'paste', 'save'] },
];

interface Props {
  rec: Recording;
  t: number;
  onSeek: (t: number) => void;
  selectedId: string | null;
  onSelect: (ev: TraceEvent) => void;
  range?: [number, number] | null;
  /** Events behind a workflow step; they stay highlighted, everything else dims. */
  focusIds?: string[] | null;
}

function segments(rec: Recording) {
  const segs: Array<{ app: AppId; start: number; end: number }> = [];
  let cur: AppId = 'desktop';
  let start = 0;
  for (const e of rec.events) {
    if (e.snap.focus !== cur) {
      if (cur !== 'desktop') segs.push({ app: cur, start, end: e.t });
      cur = e.snap.focus;
      start = e.t;
    }
  }
  if (cur !== 'desktop') segs.push({ app: cur, start, end: rec.duration });
  return segs;
}

export function Timeline({ rec, t, onSeek, selectedId, onSelect, range, focusIds }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<TraceEvent | null>(null);
  const pct = (ms: number) => `${(Math.min(rec.duration, Math.max(0, ms)) / rec.duration) * 100}%`;

  const seekFrom = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    onSeek(Math.max(0, Math.min(rec.duration, ((clientX - r.left) / r.width) * rec.duration)));
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.mk')) return;
    dragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekFrom(e.clientX);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => dragging.current && seekFrom(e.clientX);
  const up = () => {
    dragging.current = false;
  };

  const ticks: number[] = [];
  for (let s = 0; s * 1000 <= rec.duration; s += 2) ticks.push(s * 1000);
  const segs = segments(rec);

  return (
    <div className="tl">
      <div className="tl-legend" aria-hidden>
        <span><i className="sh sh-app_switch" />App switch</span>
        <span><i className="sh sh-click" />Click</span>
        <span><i className="sh sh-type" />Typing</span>
        <span><i className="sh sh-copy" />Copy</span>
        <span><i className="sh sh-paste" />Paste</span>
        <span><i className="sh sh-save" />Save</span>
      </div>
      <div className="tl-grid">
        <div className="tl-labels">
          <div className="tl-ruler-label" />
          {LANES.map((l) => (
            <div key={l.id} className="tl-label">{l.label}</div>
          ))}
        </div>
        <div className="tl-track" ref={track} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="tl-ruler">
            {ticks.map((ms) => (
              <span key={ms} className="tl-tick" style={{ left: pct(ms) }}>{fmt(ms, false)}</span>
            ))}
          </div>
          {range && <div className="tl-range" style={{ left: pct(range[0]), width: `calc(${pct(range[1])} - ${pct(range[0])})` }} />}
          {LANES.map((lane) => (
            <div key={lane.id} className={`tl-lane is-${lane.id}`}>
              {lane.id === 'apps' &&
                segs.map((s, i) => (
                  <div key={i} className={`tl-seg is-${s.app}`} style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }}>
                    <span>{APP_NAME[s.app]}</span>
                  </div>
                ))}
              {rec.events
                .filter((e) => lane.kinds.includes(e.kind))
                .map((e) => {
                  const inFocus = focusIds ? focusIds.includes(e.id) : false;
                  const cls = `mk mk-${e.kind}${selectedId === e.id ? ' is-selected' : ''}${inFocus ? ' is-in-range' : ''}${focusIds && !inFocus ? ' is-dim' : ''}`;
                  const style =
                    e.kind === 'type'
                      ? { left: pct(e.t), width: `max(10px, calc(${pct(e.t + (e.dur ?? 0))} - ${pct(e.t)}))` }
                      : { left: pct(e.t) };
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className={cls}
                      style={style}
                      aria-label={`${KIND_LABEL[e.kind]} ${e.target?.name ?? ''} at ${fmt(e.t)}`}
                      onClick={() => onSelect(e)}
                      onMouseEnter={() => setHover(e)}
                      onMouseLeave={() => setHover((h) => (h?.id === e.id ? null : h))}
                    />
                  );
                })}
            </div>
          ))}
          <div className="tl-playhead" style={{ left: pct(t) }} aria-hidden><i /></div>
          {hover && (
            <div className="tl-tip" style={{ left: pct(hover.t) }} role="tooltip">
              <b>{KIND_LABEL[hover.kind]}</b> {hover.target ? `${hover.target.role} “${hover.target.name}”` : ''}
              {hover.value && hover.kind !== 'click' ? <span className="tl-tip-val">{hover.value}</span> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
