import { bus, isElectron } from '../lib/bus';
import { loadDemoRecording, resetDemo, setSettings, setState, skipBuild, useStore } from '../lib/store';
import { IconX } from './Icons';

/** Presenter-only panel. Toggle with Ctrl+Shift+D. */
export function DemoControls() {
  const s = useStore();
  if (!s.controlsOpen) return null;
  const close = () => setState({ controlsOpen: false });
  return (
    <div className="controls" role="dialog" aria-label="Demo controls">
      <div className="controls-head">
        <b>Demo controls</b>
        <button type="button" className="icon-btn" onClick={close} aria-label="Close"><IconX size={16} /></button>
      </div>
      <div className="controls-row">
        <button type="button" className="btn is-small" onClick={() => { resetDemo(); }}>Reset everything</button>
        <button type="button" className="btn is-small" onClick={loadDemoRecording}>Load demo recording</button>
      </div>
      <div className="controls-row">
        <button type="button" className="btn is-small" onClick={skipBuild} disabled={s.build.status !== 'building'}>Finish the build now</button>
        {isElectron ? (
          <button type="button" className="btn is-small" onClick={() => bus.send('shell:open-mock-apps')}>Open Mailbox and ERP</button>
        ) : null}
        <button type="button" className="btn is-small" onClick={() => setState({ view: 'desktop', controlsOpen: false })}>Desktop simulator</button>
      </div>
      <Choice label="Workflow build time" value={s.settings.buildMs} options={[[4000, '4s'], [9000, '9s'], [14000, '14s']]} onPick={(v) => setSettings({ buildMs: v })} />
      <Choice label="Test run speed" value={s.settings.runSpeed} options={[[1, '1x'], [1.5, '1.5x'], [2, '2x'], [4, '4x']]} onPick={(v) => setSettings({ runSpeed: v })} />
      <p className="muted small">Ctrl+Shift+R resets. Esc closes this panel.</p>
    </div>
  );
}

function Choice({ label, value, options, onPick }: { label: string; value: number; options: Array<[number, string]>; onPick: (v: number) => void }) {
  return (
    <div className="controls-choice">
      <span>{label}</span>
      <div className="seg-toggle" role="group" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" className={value === v ? 'is-on' : ''} onClick={() => onPick(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}
