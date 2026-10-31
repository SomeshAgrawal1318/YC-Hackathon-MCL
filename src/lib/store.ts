import { useSyncExternalStore } from 'react';
import { applyAction, initialDesktop, materialize } from '../data/desktop';
import { VARIATIONS, demoRecording } from '../data/scenario';
import { planRun } from '../data/runs';
import { buildWorkflow, defaultEdits } from '../data/workflow';
import type { Action, DesktopState, PricePolicy, Recording, WorkflowEdits } from '../data/schema';
import { bus } from './bus';

export type Tab = 'recordings' | 'workflows' | 'tests' | 'reports' | 'deploy';

export interface Settings {
  buildMs: number;
  runSpeed: number;
  playbackSpeed: number;
}

export interface State {
  view: 'app' | 'desktop';
  tab: Tab;
  capture: { recording: boolean; startedAt: number; actions: Array<Action & { t: number }> };
  /** Live state of the in-app desktop simulator. */
  sim: DesktopState;
  recordings: Recording[];
  recordingId: string | null;
  build: { status: 'idle' | 'building' | 'ready'; startedAt: number; ms: number };
  edits: WorkflowEdits;
  selectedNode: string | null;
  /** Set when jumping from a workflow node to the part of the recording it came from. */
  focus: { nodeId: string; range: [number, number]; ids: string[]; nonce: number } | null;
  /** Set when jumping from a recording event to its workflow node. */
  selectedEventId: string | null;
  tests: { status: 'idle' | 'running' | 'done'; startedAt: number; speed: number; focusId: string };
  deploy: 'none' | 'shadow';
  settings: Settings;
  controlsOpen: boolean;
  notice: string | null;
}

const initialSettings: Settings = { buildMs: 9000, runSpeed: 1, playbackSpeed: 2 };

function initial(settings = initialSettings): State {
  return {
    view: 'app',
    tab: 'recordings',
    capture: { recording: false, startedAt: 0, actions: [] },
    sim: initialDesktop(),
    recordings: [],
    recordingId: null,
    build: { status: 'idle', startedAt: 0, ms: settings.buildMs },
    edits: defaultEdits(),
    selectedNode: null,
    focus: null,
    selectedEventId: null,
    tests: { status: 'idle', startedAt: 0, speed: settings.runSpeed, focusId: VARIATIONS[0].id },
    deploy: 'none',
    settings,
    controlsOpen: false,
    notice: null,
  };
}

let state: State = initial();
const subs = new Set<() => void>();
let timers: number[] = [];

export function getState() {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  subs.forEach((f) => f());
}

function subscribe(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
const snapshot = () => state;

export function useStore(): State {
  return useSyncExternalStore(subscribe, snapshot);
}

const later = (ms: number, fn: () => void) => {
  timers.push(window.setTimeout(fn, ms));
};

export const currentRecording = (s: State = state) => s.recordings.find((r) => r.id === s.recordingId) ?? null;
export const currentWorkflow = (s: State = state) => buildWorkflow(s.edits);

// ---------- Capture ----------

export function startRecording() {
  if (state.capture.recording) return;
  setState({ capture: { recording: true, startedAt: Date.now(), actions: [] }, sim: initialDesktop() });
  bus.send('trace:state', { recording: true });
}

export function record(a: Action) {
  const c = state.capture;
  if (!c.recording) return;
  setState({ capture: { ...c, actions: [...c.actions, { ...a, t: Date.now() - c.startedAt }] } });
}

/** Coalesce raw keystroke actions into typing spans and drop no-op app switches. */
function toRecording(actions: Array<Action & { t: number }>): Recording | null {
  const merged: Array<Action & { t: number; dur?: number }> = [];
  let focus: string = 'desktop';
  for (const a of actions) {
    const last = merged[merged.length - 1];
    if (a.kind === 'app_switch') {
      if (a.app === focus) continue;
      focus = a.app;
      merged.push({ ...a });
      continue;
    }
    if (a.app !== 'desktop' && a.app !== focus) {
      merged.push({ kind: 'app_switch', app: a.app, t: Math.max(0, a.t - 1), target: { tid: `task:${a.app}`, role: 'Button', name: a.app === 'mail' ? 'Mailbox' : 'NorthStar ERP', path: ['Taskbar', 'Running applications'] } });
      focus = a.app;
    }
    if (a.kind === 'type' && last && last.kind === 'type' && last.field === a.field) {
      last.value = a.value;
      last.dur = Math.max(250, a.t - last.t);
      continue;
    }
    if (a.kind === 'click' && last && last.kind === 'click' && last.target?.tid === a.target?.tid && a.t - last.t < 400) continue;
    merged.push({ ...a, dur: a.kind === 'type' ? 250 : undefined });
  }
  const fills = merged.filter((m) => (m.kind === 'type' || m.kind === 'paste') && m.field).length;
  if (merged.length < 6 || fills < 2) return null;
  const t0 = Math.max(0, merged[0].t - 600);
  const shifted = merged.map((m) => ({ ...m, t: m.t - t0 }));
  const last = shifted[shifted.length - 1];
  return {
    id: `rec-${Date.now().toString(36)}`,
    title: 'Supplier order to purchase order',
    source: 'live',
    createdAt: Date.now(),
    duration: last.t + (last.dur ?? 0) + 1200,
    events: materialize(shifted),
    inboxId: 'recording',
  };
}

export function stopRecording() {
  if (!state.capture.recording) return;
  const live = toRecording(state.capture.actions);
  const rec = live ?? demoRecording();
  setState({
    capture: { ...state.capture, recording: false },
    notice: live ? null : 'Not enough was captured, so the demo recording is shown instead.',
  });
  bus.send('trace:state', { recording: false });
  addRecording(rec);
}

export function loadDemoRecording() {
  addRecording(demoRecording());
}

function addRecording(rec: Recording) {
  setState((s) => ({
    recordings: [rec, ...s.recordings.filter((r) => r.source !== rec.source || r.source === 'live')],
    recordingId: rec.id,
    view: 'app',
    tab: 'recordings',
    edits: defaultEdits(),
    selectedNode: null,
    focus: null,
    selectedEventId: null,
    tests: { ...s.tests, status: 'idle' },
    deploy: 'none',
  }));
  startBuild();
}

// ---------- Workflow ----------

let buildToken = 0;
export function startBuild() {
  const token = ++buildToken;
  const ms = state.settings.buildMs;
  setState({ build: { status: 'building', startedAt: Date.now(), ms } });
  later(ms, () => {
    if (token === buildToken) setState({ build: { ...state.build, status: 'ready' } });
  });
}

export function skipBuild() {
  buildToken++;
  setState({ build: { ...state.build, status: 'ready' } });
}

export function updateEdits(fn: (e: WorkflowEdits) => WorkflowEdits) {
  setState((s) => ({ edits: fn(s.edits) }));
}

export function answerQuestion(answer: PricePolicy) {
  updateEdits((e) => {
    // Nodes below the fill step move when the branch is added, so drop their manual positions.
    const positions = { ...e.positions };
    for (const id of ['decision', 'approval', 'flag', 'save', 'end']) delete positions[id];
    return { ...e, answer, positions, approved: false };
  });
}

export function approveWorkflow() {
  updateEdits((e) => ({ ...e, approved: true }));
}

export function showNodeInRecording(nodeId: string, range: [number, number], ids: string[]) {
  setState({ tab: 'recordings', focus: { nodeId, range, ids, nonce: Date.now() }, selectedEventId: null });
}

export function showEventInWorkflow(nodeId: string) {
  setState({ tab: 'workflows', selectedNode: nodeId });
}

// ---------- Tests ----------

export const RUN_STAGGER = 450;

export function runTests() {
  const wf = currentWorkflow();
  const speed = state.settings.runSpeed;
  const total = Math.max(...VARIATIONS.map((v, i) => planRun(wf, v).duration + i * RUN_STAGGER));
  setState({ tests: { status: 'running', startedAt: Date.now(), speed, focusId: state.tests.focusId }, tab: 'tests' });
  later(total / speed + 300, () => {
    if (state.tests.status === 'running') setState({ tests: { ...state.tests, status: 'done' } });
  });
}

export function deployShadow() {
  setState({ deploy: 'shadow', tab: 'deploy' });
}

// ---------- Demo plumbing ----------

export function resetDemo() {
  timers.forEach((id) => clearTimeout(id));
  timers = [];
  buildToken++;
  state = initial(state.settings);
  subs.forEach((f) => f());
  bus.send('demo:reset');
  bus.send('trace:state', { recording: false });
}

export function setSettings(p: Partial<Settings>) {
  setState((s) => ({ settings: { ...s.settings, ...p } }));
}

/** Desktop simulator: apply an action to the simulated desktop and record it. */
export function simAction(a: Action) {
  setState((s) => ({ sim: applyAction(s.sim, a) }));
  record(a);
}

/** Wire up messages from the tray (Electron) and the separate Mailbox / ERP windows. */
export function connectMainWindow() {
  const offs = [
    bus.on('trace:event', (a: Action) => record(a)),
    bus.on('trace:command', (d: { cmd: 'start' | 'stop' }) => (d.cmd === 'start' ? startRecording() : stopRecording())),
  ];
  return () => offs.forEach((f) => f());
}
