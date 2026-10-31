import { memo, useLayoutEffect, useRef, useState } from 'react';
import { stateAt } from '../data/desktop';
import type { FieldKey, MailMessage, TraceEvent } from '../data/schema';
import { DESK_H, DESK_W, DesktopFrame } from './DesktopFrame';

interface Props {
  events: TraceEvent[];
  messages: MailMessage[];
  t: number;
  agent?: boolean;
  recording?: boolean;
  className?: string;
}

const HOME = { x: 660, y: 430 };
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/**
 * Re-renders the mock desktop from recorded events at time t (ms).
 * The cursor flies to each event's element, found by its data-tid, so it lines up for any layout.
 */
function ReplayPlayerImpl({ events, messages, t, agent, recording, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const [scale, setScale] = useState(0.5);
  const [, bump] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setScale(Math.min(r.width / DESK_W, r.height / DESK_H));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { state, index } = stateAt(events, t);

  // Measure where every addressable element sits in desktop coordinates.
  useLayoutEffect(() => {
    const f = frame.current;
    if (!f) return;
    const fr = f.getBoundingClientRect();
    let added = false;
    f.querySelectorAll<HTMLElement>('[data-tid]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const tid = el.dataset.tid!;
      const isField = tid.startsWith('erp:field:');
      const pos = {
        x: (r.left - fr.left + (isField ? Math.min(r.width * 0.3, 90) : r.width / 2)) / scale,
        y: (r.top - fr.top + r.height / 2) / scale,
      };
      const prev = positions.current.get(tid);
      if (!prev || Math.abs(prev.x - pos.x) > 1 || Math.abs(prev.y - pos.y) > 1) {
        positions.current.set(tid, pos);
        added = true;
      }
    });
    if (added) bump((n) => n + 1);
  }, [index, scale, state.focus, state.mail.selectedId, state.erp.screen]);

  const pos = positions.current;
  const at = (e?: TraceEvent) => (e?.target ? pos.get(e.target.tid) : undefined);
  const P = index >= 0 ? events[index] : undefined;
  const N = events[index + 1];

  let from = at(P);
  for (let i = index - 1; !from && i >= 0; i--) from = at(events[i]);
  from = from ?? HOME;
  let cursor = from;
  if (N) {
    const to = at(N) ?? from;
    const hold = P ? P.t + (P.dur ?? 0) + 120 : 0;
    const start = Math.max(hold, N.t - 700);
    if (t > start && N.t > start) {
      const k = ease(Math.min(1, (t - start) / (N.t - start)));
      cursor = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    }
  }

  let ripple: { x: number; y: number; p: number } | null = null;
  if (P && ['click', 'save', 'app_switch', 'copy', 'paste'].includes(P.kind) && t - P.t < 450) {
    const rp = at(P);
    if (rp) ripple = { ...rp, p: (t - P.t) / 450 };
  }

  let flash: FieldKey | null = null;
  let typing: FieldKey | null = null;
  if (P?.field) {
    const end = P.t + (P.dur ?? 0);
    if (P.kind === 'type' && t < end) typing = P.field;
    else if ((P.kind === 'type' || P.kind === 'paste') && t - end < 700) flash = P.field;
  }

  const showCursor = !agent || index >= 0;

  return (
    <div ref={box} className={`replay ${className ?? ''}`}>
      <div className="replay-inner" style={{ width: DESK_W * scale, height: DESK_H * scale }}>
        <div ref={frame} className="replay-frame" style={{ transform: `scale(${scale})` }}>
          <DesktopFrame
            state={state}
            messages={messages}
            agent={agent}
            recording={recording}
            cursor={showCursor ? cursor : null}
            ripple={ripple}
            flash={flash}
            typing={typing}
          />
        </div>
      </div>
    </div>
  );
}

export const ReplayPlayer = memo(ReplayPlayerImpl);
