import type { ReactNode } from 'react';
import { APP_NAME, T } from '../data/desktop';
import type { Action, DesktopState, FieldKey, MailMessage } from '../data/schema';
import { IconChevronUp, TraceGlyph } from './Icons';
import { MockErp } from './MockErp';
import { MockMail } from './MockMail';

export const DESK_W = 1280;
export const DESK_H = 760;

const RECTS = {
  mail: { x: 24, y: 18, w: 840, h: 654 },
  erp: { x: 416, y: 44, w: 840, h: 654 },
};

interface Props {
  state: DesktopState;
  messages: MailMessage[];
  agent?: boolean;
  interactive?: boolean;
  onAction?: (a: Action) => void;
  recording?: boolean;
  cursor?: { x: number; y: number } | null;
  ripple?: { x: number; y: number; p: number } | null;
  flash?: FieldKey | null;
  typing?: FieldKey | null;
  /** Content of the tray overflow flyout (desktop simulator only). */
  trayFlyout?: ReactNode;
  onChevron?: () => void;
  clock?: string;
}

function Win({ app, active, z, children, onActivate }: { app: 'mail' | 'erp'; active: boolean; z: number; children: ReactNode; onActivate?: () => void }) {
  const r = RECTS[app];
  return (
    <section
      className={`win is-${app}${active ? ' is-active' : ''}`}
      style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: z }}
      aria-label={APP_NAME[app]}
      onPointerDown={onActivate}
    >
      <div className="win-bar">
        <span className={`win-icon is-${app}`} aria-hidden />
        <span className="win-title">{APP_NAME[app]}</span>
        <span className="win-ctrls" aria-hidden><i>&#8211;</i><i>&#9633;</i><i>&#10005;</i></span>
      </div>
      <div className="win-body">{children}</div>
    </section>
  );
}

export function DesktopFrame(p: Props) {
  const { state } = p;
  const top = state.focus === 'erp' ? 'erp' : 'mail';
  const activate = (app: 'mail' | 'erp') => () => {
    if (p.interactive && state.focus !== app) p.onAction?.({ kind: 'app_switch', app, target: T.task(app) });
  };

  return (
    <div className={`desk${p.interactive ? ' is-live' : ''}`} style={{ width: DESK_W, height: DESK_H }}>
      <div className="desk-wall" aria-hidden />
      <Win app="mail" active={state.focus === 'mail'} z={top === 'mail' ? 3 : 2} onActivate={activate('mail')}>
        <MockMail messages={p.messages} state={state.mail} interactive={p.interactive} agent={p.agent} onAction={p.onAction} />
      </Win>
      <Win app="erp" active={state.focus === 'erp'} z={top === 'erp' ? 3 : 2} onActivate={activate('erp')}>
        <MockErp state={state.erp} interactive={p.interactive} flash={p.flash} typing={p.typing} onAction={p.onAction} />
      </Win>

      {state.note && (
        <div className={`desk-note is-${state.note.kind}`} role="status">
          <b>{state.note.title}</b>
          {state.note.detail && <span>{state.note.detail}</span>}
        </div>
      )}

      <div className="taskbar">
        <div className="taskbar-apps">
          <span className="tb-start" aria-hidden><i /><i /><i /><i /></span>
          {(['mail', 'erp'] as const).map((app) => (
            <button
              key={app}
              type="button"
              className={`tb-app is-${app}${state.focus === app ? ' is-active' : ''}`}
              data-tid={`task:${app}`}
              aria-label={APP_NAME[app]}
              onClick={activate(app)}
              tabIndex={p.interactive ? 0 : -1}
            >
              <span className={`win-icon is-${app}`} aria-hidden />
            </button>
          ))}
        </div>
        <div className="taskbar-tray">
          <button type="button" className="tb-chevron" aria-label="Show hidden icons" data-tid="tray:chevron" onClick={p.onChevron} tabIndex={p.interactive ? 0 : -1}>
            <IconChevronUp size={16} />
          </button>
          {p.recording && (
            <span className="tb-rec" title="Trace is recording"><TraceGlyph recording size={15} /></span>
          )}
          <span className="tb-clock">{p.clock ?? '8:47 AM'}</span>
        </div>
        {p.trayFlyout}
      </div>

      {p.ripple && (
        <span
          className="cursor-ripple"
          style={{ left: p.ripple.x, top: p.ripple.y, opacity: 1 - p.ripple.p, transform: `translate(-50%, -50%) scale(${0.4 + p.ripple.p})` }}
          aria-hidden
        />
      )}
      {p.cursor && (
        <svg className={`cursor${p.agent ? ' is-agent' : ''}`} style={{ left: p.cursor.x, top: p.cursor.y }} width="22" height="26" viewBox="0 0 22 26" aria-hidden>
          <path d="M2 2 L2 21 L7.2 16.4 L10.6 24 L14 22.5 L10.7 15 L18 15 Z" />
        </svg>
      )}
    </div>
  );
}
