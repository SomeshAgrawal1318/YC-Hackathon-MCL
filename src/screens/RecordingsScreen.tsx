import { useEffect, useState } from 'react';
import { BuildMeter, useBuildProgress } from '../components/BuildProgress';
import { IconDesktop, IconLink, IconPause, IconPlay, IconRecordings } from '../components/Icons';
import { ReplayPlayer } from '../components/ReplayPlayer';
import { VideoReplay } from '../components/VideoReplay';
import { KIND_LABEL, Timeline } from '../components/Timeline';
import { APP_NAME } from '../data/desktop';
import { inboxFor, rawEventCount } from '../data/scenario';
import type { EventKind, Recording, TraceEvent } from '../data/schema';
import { nodeForEvent } from '../data/workflow';
import { isElectron, bus } from '../lib/bus';
import { fmt } from '../lib/format';
import { usePlayback } from '../lib/hooks';
import { currentRecording, currentWorkflow, exportRecording, setSettings, setState, showEventInWorkflow, useStore } from '../lib/store';

export function RecordingsScreen() {
  const s = useStore();
  const rec = currentRecording(s);
  if (!rec) return <EmptyRecordings />;
  return <RecordingView rec={rec} />;
}

function EmptyRecordings() {
  const s = useStore();
  return (
    <div className="screen empty">
      <IconRecordings size={40} />
      <h1>{s.capture.processing ? 'Building the recording…' : 'No recordings yet'}</h1>
      <p>Start Trace from the system tray, do the task once in Gmail and Odoo, then stop recording. The recording opens here.</p>
      <p className={`trace-status${s.trace.os ? ' is-on' : ''}`}><i aria-hidden /> {s.trace.reason}</p>
      <div className="row">
        {isElectron ? (
          <button type="button" className="btn" onClick={() => bus.send('shell:open-real-apps')}>Open Gmail and Odoo</button>
        ) : (
          <button type="button" className="btn" onClick={() => setState({ view: 'desktop' })}>
            <IconDesktop size={16} /> Open the desktop simulator
          </button>
        )}
      </div>
      {s.notice && <div className="notice" role="status">{s.notice}</div>}
    </div>
  );
}

const COUNTED: EventKind[] = ['click', 'type', 'copy', 'paste', 'save', 'app_switch'];

function RecordingView({ rec }: { rec: Recording }) {
  const s = useStore();
  const wf = currentWorkflow(s);
  const progress = useBuildProgress(s.build);
  const pb = usePlayback(rec.duration, s.settings.playbackSpeed, !s.focus, rec.id);
  const selected = rec.events.find((e) => e.id === s.selectedEventId) ?? null;
  const range = s.focus?.range ?? null;

  // Jumping in from a workflow step: play just that part.
  useEffect(() => {
    if (!s.focus) return;
    pb.seek(s.focus.range[0]);
    pb.play();
  }, [s.focus?.nonce]);
  useEffect(() => {
    if (range && pb.playing && pb.t >= range[1]) pb.pause();
  }, [pb.t]);

  const select = (ev: TraceEvent) => {
    setState({ selectedEventId: ev.id, focus: null });
    pb.pause();
    // Land just after the event so the replay shows its result.
    pb.seek(Math.min(rec.duration, ev.t + (ev.dur ?? 0) + 250));
  };

  const apps = Array.from(new Set(rec.events.map((e) => e.app).filter((a) => a !== 'desktop')));
  const [exported, setExported] = useState<string | null>(null);
  const focusNode = s.focus ? wf.nodes.find((n) => n.id === s.focus!.nodeId) : null;

  return (
    <div className="screen rec">
      <header className="screen-head">
        <div>
          <h1>{rec.title}</h1>
          <dl className="facts">
            <div><dt>Length</dt><dd>{fmt(rec.duration, false)}</dd></div>
            <div><dt>Apps</dt><dd>{apps.map((a) => APP_NAME[a]).join(', ')}</dd></div>
            <div><dt>Actions</dt><dd>{rec.events.length}</dd></div>
            <div><dt>Raw events</dt><dd>{rec.raw?.length ?? rawEventCount(rec)}</dd></div>
            <div><dt>Source</dt><dd>{rec.source === 'live' ? (rec.raw ? 'Captured by Trace from Windows' : 'Captured in the app') : 'Demo recording'}</dd></div>
          </dl>
        </div>
        <div className="head-side">
          {rec.source === 'live' && (
            <button type="button" className="btn is-quiet" onClick={() => exportRecording(rec).then((dir) => setExported(dir ?? 'Downloaded'))} title={exported ?? 'Save the events, raw OS events and video to a folder'}>
              {exported ? 'Exported' : 'Export recording'}
            </button>
          )}
          {s.build.status === 'building' ? (
            <div className="build-chip">
              <span><i className="spinner" /> Building the workflow</span>
              <BuildMeter progress={progress} />
            </div>
          ) : s.build.status === 'ready' ? (
            <button type="button" className="btn is-primary" onClick={() => setState({ tab: 'workflows' })}>Review the workflow</button>
          ) : null}
        </div>
      </header>

      {s.notice && (
        <div className="notice" role="status">
          {s.notice}
          <button type="button" className="btn is-quiet is-small" onClick={() => setState({ notice: null })}>Dismiss</button>
        </div>
      )}

      <div className="rec-main">
        <div className="rec-player">
          {rec.video ? (
            <VideoReplay video={rec.video} events={rec.events} t={pb.t} playing={pb.playing} speed={s.settings.playbackSpeed} selected={selected} />
          ) : rec.raw ? (
            <div className="live-shot"><span className="empty-shot">No screen video was recorded this time. The timeline below still has every event.</span></div>
          ) : (
            <ReplayPlayer events={rec.events} messages={inboxFor(rec.inboxId)} t={pb.t} recording />
          )}
        </div>
        <aside className="rec-detail panel">
          {selected ? (
            <EventDetail ev={selected} nodeTitle={s.build.status === 'ready' ? nodeForEvent(selected, wf, rec)?.title ?? null : null} nodeId={nodeForEvent(selected, wf, rec)?.id ?? null} />
          ) : focusNode && range ? (
            <div className="detail">
              <h2>Where “{focusNode.title}” came from</h2>
              <p className="muted">These {s.focus!.ids.length} actions, between {fmt(range[0])} and {fmt(range[1])}, taught this step.</p>
              <ul className="detail-events">
                {rec.events.filter((e) => s.focus!.ids.includes(e.id)).map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => select(e)}>
                      <span className={`sh sh-${e.kind}`} aria-hidden />
                      <span>{KIND_LABEL[e.kind]} {e.target ? `“${e.target.name}”` : ''}</span>
                      <span className="muted">{fmt(e.t)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn" onClick={() => showEventInWorkflow(focusNode.id)}>Back to the workflow</button>
            </div>
          ) : (
            <div className="detail">
              <h2>What Trace captured</h2>
              <p className="muted">Click a marker on the timeline to see the exact element and value.</p>
              <ul className="kind-counts">
                {COUNTED.map((k) => {
                  const n = rec.events.filter((e) => e.kind === k).length;
                  return n ? (
                    <li key={k}><span className={`sh sh-${k}`} aria-hidden /> {KIND_LABEL[k]} <b>{n}</b></li>
                  ) : null;
                })}
              </ul>
            </div>
          )}
        </aside>
      </div>

      <div className="transport">
        <button type="button" className="btn-round" onClick={pb.playing ? pb.pause : pb.play} aria-label={pb.playing ? 'Pause' : 'Play'}>
          {pb.playing ? <IconPause size={16} /> : <IconPlay size={16} />}
        </button>
        <span className="transport-time">{fmt(pb.t)} <span className="muted">/ {fmt(rec.duration)}</span></span>
        <div className="seg-toggle" role="group" aria-label="Playback speed">
          {[1, 2].map((sp) => (
            <button key={sp} type="button" className={s.settings.playbackSpeed === sp ? 'is-on' : ''} onClick={() => setSettings({ playbackSpeed: sp })}>
              {sp}x
            </button>
          ))}
        </div>
      </div>
      <Timeline rec={rec} t={pb.t} onSeek={(ms) => { pb.pause(); pb.seek(ms); }} selectedId={s.selectedEventId} onSelect={select} range={range} focusIds={s.focus?.ids ?? null} />
    </div>
  );
}

function EventDetail({ ev, nodeTitle, nodeId }: { ev: TraceEvent; nodeTitle: string | null; nodeId: string | null }) {
  return (
    <div className="detail">
      <div className="detail-kind">
        <span className={`sh sh-${ev.kind}`} aria-hidden />
        <h2>{KIND_LABEL[ev.kind]}</h2>
        <span className="muted">{fmt(ev.t)}</span>
      </div>
      <dl className="detail-list">
        <div><dt>App</dt><dd>{APP_NAME[ev.app]}</dd></div>
        {ev.target && (
          <>
            <div><dt>Element</dt><dd>{ev.target.role} “{ev.target.name}”</dd></div>
            <div>
              <dt>Accessibility path</dt>
              <dd className="a11y-path">
                {ev.target.path.map((p, i) => <span key={i}>{p}</span>)}
                <span className="is-leaf">{ev.target.role} “{ev.target.name}”</span>
              </dd>
            </div>
          </>
        )}
        {ev.value && ev.kind !== 'click' && (
          <div><dt>Value</dt><dd><code className="value">{ev.value}</code></dd></div>
        )}
        {ev.target?.process && <div><dt>Process</dt><dd>{ev.target.process}</dd></div>}
        {ev.target?.automationId && <div><dt>AutomationId</dt><dd><code className="value">{ev.target.automationId}</code></dd></div>}
        {ev.target?.rect && <div><dt>On screen</dt><dd>{ev.target.rect[2]} × {ev.target.rect[3]} px at ({ev.target.rect[0]}, {ev.target.rect[1]})</dd></div>}
      </dl>
      {nodeTitle && nodeId && (
        <button type="button" className="link-btn" onClick={() => showEventInWorkflow(nodeId)}>
          <IconLink size={14} /> Used in the workflow step “{nodeTitle}”
        </button>
      )}
    </div>
  );
}
