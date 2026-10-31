import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { DemoControls } from './components/DemoControls';
import { IconCheck, IconDeploy, IconKnowledge, IconRecordings, IconReport, IconVm, IconWorkflow, Mark, TraceGlyph } from './components/Icons';
import { MockWindow } from './components/MockWindow';
import { isElectron, bus } from './lib/bus';
import { fmt } from './lib/format';
import { useFrameClock } from './lib/hooks';
import { connectMainWindow, getState, resetDemo, setState, startRecording, stopRecording, useStore } from './lib/store';
import type { State, Tab } from './lib/store';
import { ApprovalsScreen } from './screens/ApprovalsScreen';
import { DeployScreen } from './screens/DeployScreen';
import { DesktopSim } from './screens/DesktopSim';
import { KnowledgeScreen } from './screens/KnowledgeScreen';
import { RecordingsScreen } from './screens/RecordingsScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { TestsScreen } from './screens/TestsScreen';
import { WorkflowsScreen } from './screens/WorkflowsScreen';

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  if (route === 'mail' || route === 'erp') return <MockWindow app={route} />;
  if (route === 'dana') return <ApprovalsScreen />;
  return <MainApp />;
}

function MainApp() {
  const s = useStore();

  useEffect(() => connectMainWindow(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = getState();
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setState({ controlsOpen: !st.controlsOpen });
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        resetDemo();
      } else if (e.key === 'Escape') {
        if (st.controlsOpen) setState({ controlsOpen: false });
        else if (st.view === 'desktop' && !st.capture.recording) setState({ view: 'app' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (s.view === 'desktop') {
    return (
      <>
        <DesktopSim />
        <DemoControls />
      </>
    );
  }

  const screens: Record<Tab, ReactNode> = {
    recordings: <RecordingsScreen />,
    workflows: <WorkflowsScreen />,
    tests: <TestsScreen />,
    reports: <ReportsScreen />,
    deploy: <DeployScreen />,
    knowledge: <KnowledgeScreen />,
  };

  return (
    <div className="shell">
      <Rail s={s} />
      <main className="content">{screens[s.tab]}</main>
      <DemoControls />
    </div>
  );
}

function Rail({ s }: { s: State }) {
  const recording = s.capture.recording;
  const now = useFrameClock(recording, 4);
  const answered = s.edits.answer !== null;
  const items: Array<{ id: Tab; label: string; icon: ReactNode; badge: ReactNode }> = [
    { id: 'recordings', label: 'Recordings', icon: <IconRecordings />, badge: s.recordings.length ? <span className="nav-count">{s.recordings.length}</span> : null },
    {
      id: 'workflows',
      label: 'Workflows',
      icon: <IconWorkflow />,
      badge:
        s.build.status === 'building' ? <i className="spinner" aria-label="Building" /> :
        s.build.status === 'ready' && s.edits.approved ? <span className="nav-ok"><IconCheck size={13} /></span> :
        s.build.status === 'ready' && !answered ? <span className="nav-ask" aria-label="1 question" /> : null,
    },
    {
      id: 'tests',
      label: 'Test runs',
      icon: <IconVm />,
      badge: s.tests.status === 'running' ? <i className="spinner" aria-label="Running" /> : s.tests.status === 'done' ? <span className="nav-ok"><IconCheck size={13} /></span> : null,
    },
    { id: 'reports', label: 'Reports', icon: <IconReport />, badge: s.tests.status === 'done' ? <span className="nav-count">1</span> : null },
    { id: 'deploy', label: 'Deployments', icon: <IconDeploy />, badge: s.deploy === 'shadow' ? <span className="nav-count">Shadow</span> : null },
    {
      id: 'knowledge',
      label: 'Knowledge',
      icon: <IconKnowledge />,
      badge: s.knowledge.syncing ? <i className="spinner" aria-label="Syncing" /> : Object.keys(s.knowledge.data.entities).length ? <span className="nav-count">{Object.keys(s.knowledge.data.entities).length}</span> : null,
    },
  ];

  return (
    <nav className="rail" aria-label="MonteCarlo Labs">
      <div className="brand"><Mark size={28} /> MonteCarlo Labs</div>
      {items.map((it) => (
        <button key={it.id} type="button" className={`nav-item${s.tab === it.id ? ' is-active' : ''}`} onClick={() => setState({ tab: it.id })} aria-current={s.tab === it.id ? 'page' : undefined}>
          {it.icon}
          <span>{it.label}</span>
          {it.badge && <span className="nav-badge">{it.badge}</span>}
        </button>
      ))}
      <div className="rail-foot">
        <div className="trace-row">
          <TraceGlyph recording={recording} size={16} />
          <span title={s.trace.reason}>
            {recording
              ? `Trace is recording, ${fmt(now - s.capture.startedAt, false)}${s.trace.os ? ` · ${s.capture.raw.length} event${s.capture.raw.length === 1 ? "" : "s"}` : ''}`
              : s.capture.processing
                ? 'Building the recording…'
                : s.trace.os
                  ? 'Trace is ready'
                  : 'Trace: OS capture off'}
          </span>
        </div>
        <button type="button" className={`trace-btn${recording ? ' is-rec' : ''}`} onClick={recording ? stopRecording : startRecording} disabled={s.capture.processing}>
          {recording ? 'Stop recording' : 'Start recording'}
        </button>
        {isElectron ? (
          <button type="button" className="rail-link" onClick={() => bus.send('shell:open-real-apps')}>Open Gmail and Odoo</button>
        ) : (
          <button type="button" className="rail-link" onClick={() => setState({ view: 'desktop' })}>Open the desktop simulator</button>
        )}
      </div>
    </nav>
  );
}
