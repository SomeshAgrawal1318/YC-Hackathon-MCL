import { useLayoutEffect, useRef, useState } from 'react';
import { DESK_H, DESK_W, DesktopFrame } from '../components/DesktopFrame';
import { TraceGlyph } from '../components/Icons';
import { RECORDING_INBOX } from '../data/scenario';
import { fmt } from '../lib/format';
import { useFrameClock } from '../lib/hooks';
import { setState, simAction, startRecording, stopRecording, useStore } from '../lib/store';

/**
 * A rehearsal desktop: the same Mailbox and ERP as the Electron windows, inside one page,
 * with Trace in the taskbar's hidden-icons tray. Works in a plain browser and as a stage backup.
 */
export function DesktopSim() {
  const s = useStore();
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.8);
  const [fly, setFly] = useState<'none' | 'icons' | 'menu'>('none');
  const recording = s.capture.recording;
  const now = useFrameClock(recording, 4);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / DESK_W, el.clientHeight / DESK_H));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const flyout =
    fly === 'none' ? null : (
      <>
        <div className="tray-fly" role="menu" aria-label="Hidden icons">
          <button type="button" className="tray-ico" aria-label="Trace" onClick={() => setFly(fly === 'menu' ? 'icons' : 'menu')}>
            <TraceGlyph recording={recording} size={20} />
          </button>
          <span className="tray-ico is-fake" aria-hidden><i /></span>
          <span className="tray-ico is-fake is-b" aria-hidden><i /></span>
        </div>
        {fly === 'menu' && (
          <div className="trace-menu" role="menu" aria-label="Trace">
            <header>
              <TraceGlyph recording={recording} size={18} /> Trace
              <span className="muted">{recording ? `Recording ${fmt(now - s.capture.startedAt, false)}` : 'Not recording'}</span>
            </header>
            {recording ? (
              <button type="button" className="is-rec-action" onClick={() => { setFly('none'); stopRecording(); }}>Stop recording</button>
            ) : (
              <button type="button" onClick={() => { setFly('none'); startRecording(); }}>Start recording</button>
            )}
            <button type="button" onClick={() => { setFly('none'); setState({ view: 'app' }); }}>Open MonteCarlo Labs</button>
          </div>
        )}
      </>
    );

  return (
    <div className="sim">
      <div className="sim-bar">
        {recording ? (
          <span className="sim-rec"><TraceGlyph recording size={14} /> Recording. Do the task, then stop from the Trace menu.</span>
        ) : (
          <span>Rehearsal desktop. Click the arrow in the taskbar, then Trace, to start recording.</span>
        )}
        {!recording && (
          <button type="button" className="link-btn is-light" onClick={() => setState({ view: 'app' })}>Back to MonteCarlo Labs</button>
        )}
      </div>
      <div className="sim-stage" ref={stage}>
        <div className="sim-inner" style={{ width: DESK_W * scale, height: DESK_H * scale }}>
          <div className="replay-frame" style={{ transform: `scale(${scale})` }}>
            <DesktopFrame
              state={s.sim}
              messages={RECORDING_INBOX}
              interactive
              onAction={simAction}
              recording={recording}
              onChevron={() => setFly((f) => (f === 'none' ? 'icons' : 'none'))}
              trayFlyout={flyout}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
