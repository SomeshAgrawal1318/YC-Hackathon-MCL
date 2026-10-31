import { bodyText } from '../data/extract';
import { SHADOW_EMAILS } from '../data/shadowEmails';
import { actorCall } from '../lib/actors';
import { bus, isElectron } from '../lib/bus';
import { loadDemoRecording, resetDemo, runSimulated, setSettings, setState, skipBuild, useStore } from '../lib/store';
import { IconX } from './Icons';

let injected = 0;

/** Stage fallback for a slow inbox: the next shadow email goes to the ShadowDeployment actor directly. */
function injectShadowEmail() {
  const m = SHADOW_EMAILS[injected % SHADOW_EMAILS.length];
  const round = Math.floor(injected / SHADOW_EMAILS.length);
  injected++;
  actorCall('shadowInject', { email: { id: `inject-${m.id}-${round}`, subject: m.subject, from: m.company, receivedAt: Date.now(), text: bodyText(m) } })
    .catch((e: Error) => setState({ notice: `Could not inject the email: ${e.message}` }));
}

/** Presenter-only panel. Toggle with Ctrl+Shift+D. */
export function DemoControls() {
  const s = useStore();
  if (!s.controlsOpen) return null;
  const close = () => setState({ controlsOpen: false });
  const recent = s.capture.raw.slice(-6).reverse();
  return (
    <div className="controls" role="dialog" aria-label="Demo controls">
      <div className="controls-head">
        <b>Demo controls</b>
        <button type="button" className="icon-btn" onClick={close} aria-label="Close"><IconX size={16} /></button>
      </div>
      <p className={`trace-status${s.trace.os ? ' is-on' : ''}`}><i aria-hidden /> {s.trace.reason}</p>
      {s.capture.recording && s.trace.os && (
        <div className="raw-feed" aria-label="Latest events from Trace">
          {recent.length ? recent.map((e, i) => (
            <div key={`${e.ts}-${i}`}>
              {e.app} · {e.kind}{e.keys ? ` ${e.keys}` : ''} · {e.element ? `${e.element.role} "${e.element.name}"` : e.window}{e.element?.value ? ` = ${e.element.value}` : ''}{e.text ? ` "${e.text.slice(0, 30)}"` : ''}
            </div>
          )) : <div>Waiting for events…</div>}
        </div>
      )}
      <div className="controls-row">
        <button type="button" className="btn is-small" onClick={() => { resetDemo(); }}>Reset everything</button>
        {isElectron && <button type="button" className="btn is-small" onClick={() => bus.send('shell:open-real-apps')}>Open Gmail and Odoo</button>}
      </div>
      <div className="controls-row">
        <button type="button" className="btn is-small" onClick={skipBuild} disabled={s.build.status !== 'building'}>Finish the build now</button>
        <button type="button" className="btn is-small" onClick={runSimulated} disabled={!s.edits.approved || s.tests.status === 'running'}>Run simulated tests</button>
      </div>
      {isElectron && (
        <>
          <p className="muted small">Durable Actors (shadow mode, Dana’s approvals):</p>
          <div className="controls-row">
            <button type="button" className="btn is-small" onClick={() => bus.send('shell:open-dana')}>Open Dana’s approvals</button>
            <button type="button" className="btn is-small" onClick={injectShadowEmail} disabled={s.deploy !== 'shadow'} title="Feeds the next shadow mode email straight to the actor, without Gmail">
              Inject a shadow email
            </button>
          </div>
        </>
      )}
      <p className="muted small">Stage fallback (mock apps):</p>
      <div className="controls-row">
        <button type="button" className="btn is-small" onClick={loadDemoRecording}>Load demo recording</button>
        {isElectron ? (
          <button type="button" className="btn is-small" onClick={() => bus.send('shell:open-mock-apps')}>Open mock Mailbox and ERP</button>
        ) : null}
        <button type="button" className="btn is-small" onClick={() => setState({ view: 'desktop', controlsOpen: false })}>Desktop simulator</button>
      </div>
      <Choice label="Workflow build time" value={s.settings.buildMs} options={[[4000, '4s'], [9000, '9s'], [14000, '14s']]} onPick={(v) => setSettings({ buildMs: v })} />
      <Choice label="Simulated test speed" value={s.settings.runSpeed} options={[[1, '1x'], [1.5, '1.5x'], [2, '2x'], [4, '4x']]} onPick={(v) => setSettings({ runSpeed: v })} />
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
