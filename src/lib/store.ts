import { useSyncExternalStore } from 'react';
import { FIELD_LABEL, VAR_KEYS, applyAction, initialDesktop, materialize } from '../data/desktop';
import { normalize } from '../data/normalize';
import { emptyKnowledge, recordingSummary } from '../data/knowledge';
import type { Knowledge } from '../data/knowledge';
import { VARIATIONS, demoRecording } from '../data/scenario';
import { planRun } from '../data/runs';
import { buildWorkflow, defaultEdits } from '../data/workflow';
import type { Action, DesktopState, LiveRun, PricePolicy, RawOsEvent, Recording, RecordingVideo, RunPlan, WorkflowEdits } from '../data/schema';
import { bus, isElectron } from './bus';
import { runInVms, runOnPc } from './runner';
import { actorCall } from './actors';
import { startVideo, stopVideo } from './video';
import { prebuiltEdits, workflowFromRecording } from './workflowBuilder';

export type Tab = 'recordings' | 'workflows' | 'tests' | 'reports' | 'deploy' | 'knowledge';

export interface Settings {
  buildMs: number;
  runSpeed: number;
  playbackSpeed: number;
}

/** Whether Trace can capture from Windows (trace-helper.exe is running), from Electron. */
export interface TraceCapability {
  os: boolean;
  reason: string;
  display?: { x: number; y: number; width: number; height: number; scaleFactor: number };
}

export interface State {
  view: 'app' | 'desktop';
  tab: Tab;
  capture: {
    recording: boolean;
    startedAt: number;
    /** From the mock apps or the desktop simulator (fallback when OS capture is off). */
    actions: Array<Action & { t: number }>;
    /** From trace-helper (real capture). */
    raw: RawOsEvent[];
    video: boolean;
    processing: boolean;
  };
  trace: TraceCapability;
  /** Live state of the in-app desktop simulator. */
  sim: DesktopState;
  recordings: Recording[];
  recordingId: string | null;
  /** fallback: why the prebuilt workflow was used instead of building from the recording, if it was. */
  build: { status: 'idle' | 'building' | 'ready'; startedAt: number; ms: number; fallback?: string | null };
  edits: WorkflowEdits;
  selectedNode: string | null;
  /** Set when jumping from a workflow node to the part of the recording it came from. */
  focus: { nodeId: string; range: [number, number]; ids: string[]; nonce: number } | null;
  /** Set when jumping from a recording event to its workflow node. */
  selectedEventId: string | null;
  tests: {
    status: 'idle' | 'running' | 'done';
    /** pc = runs in Gmail and Odoo on this PC; vm = one Freestyle VM per test; simulated = the old simulation. */
    mode: 'pc' | 'vm' | 'simulated';
    /** Where the next run goes, as picked on the Tests screen. */
    preferred: 'pc' | 'vm';
    startedAt: number;
    speed: number;
    focusId: string;
    runs: Record<string, LiveRun>;
    error: string | null;
  };
  deploy: 'none' | 'shadow';
  /** Whether test runs can use Freestyle VMs, from electron/vms.cjs. */
  vm: { available: boolean; reason: string };
  knowledge: {
    data: Knowledge;
    hasKey: boolean;
    syncing: boolean;
    progress: { stage: string; detail: string; at: number } | null;
    error: string | null;
    asking: boolean;
    answer: { question: string; answer: string; citations: string[] } | null;
  };
  settings: Settings;
  controlsOpen: boolean;
  notice: string | null;
}

const initialSettings: Settings = { buildMs: 9000, runSpeed: 1, playbackSpeed: 2 };

function initial(settings = initialSettings, trace?: TraceCapability): State {
  return {
    view: 'app',
    tab: 'recordings',
    capture: { recording: false, startedAt: 0, actions: [], raw: [], video: false, processing: false },
    trace: trace ?? { os: false, reason: isElectron ? 'Connecting to Trace…' : 'Trace capture needs the desktop app.' },
    sim: initialDesktop(),
    recordings: [],
    recordingId: null,
    build: { status: 'idle', startedAt: 0, ms: settings.buildMs },
    edits: defaultEdits(),
    selectedNode: null,
    focus: null,
    selectedEventId: null,
    tests: { status: 'idle', mode: isElectron ? 'pc' : 'simulated', preferred: 'pc', startedAt: 0, speed: settings.runSpeed, focusId: VARIATIONS[0].id, runs: {}, error: null },
    deploy: 'none',
    vm: { available: false, reason: isElectron ? 'Checking Freestyle…' : 'VM runs need the desktop app.' },
    knowledge: { data: emptyKnowledge(), hasKey: false, syncing: false, progress: null, error: null, asking: false, answer: null },
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

export async function startRecording() {
  if (state.capture.recording) return;
  const os = state.trace.os;
  setState({ capture: { recording: true, startedAt: Date.now(), actions: [], raw: [], video: false, processing: false }, sim: initialDesktop() });
  bus.send('trace:state', { recording: true });
  // Real capture also records the screen. The events start flowing as soon as the helper is told.
  if (os && isElectron) {
    const ok = await startVideo();
    if (state.capture.recording) setState({ capture: { ...state.capture, video: ok } });
  }
}

/** From the mock apps and the desktop simulator, used only when OS capture is off. */
export function record(a: Action) {
  const c = state.capture;
  if (!c.recording || state.trace.os) return;
  setState({ capture: { ...c, actions: [...c.actions, { ...a, t: Date.now() - c.startedAt }] } });
}

function recordRaw(ev: RawOsEvent) {
  const c = state.capture;
  if (!c.recording) return;
  setState({ capture: { ...c, raw: [...c.raw, ev] } });
}

/** Coalesce raw keystroke actions into typing spans and drop no-op app switches. Returns t0, the shift applied. */
export function toRecording(actions: Array<Action & { t: number }>, min = { actions: 6, fills: 2 }): { rec: Recording; t0: number } | null {
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
      merged.push({ kind: 'app_switch', app: a.app, t: Math.max(0, a.t - 1), target: { tid: `task:${a.app}`, role: 'Window', name: a.app === 'mail' ? 'Gmail' : 'Odoo', path: [] } });
      focus = a.app;
    }
    if ((a.kind === 'type' || a.kind === 'paste') && last && last.kind === 'type' && last.field && last.field === a.field) {
      last.value = a.value;
      if (a.kind === 'paste') last.kind = 'paste';
      last.dur = Math.max(250, a.t - last.t);
      continue;
    }
    if (a.kind === 'click' && last && last.kind === 'click' && last.target?.tid === a.target?.tid && a.t - last.t < 400) continue;
    merged.push({ ...a, dur: a.kind === 'type' ? 250 : undefined });
  }
  const fills = merged.filter((m) => (m.kind === 'type' || m.kind === 'paste') && m.field).length;
  if (merged.length < min.actions || fills < min.fills) return null;
  const t0 = Math.max(0, merged[0].t - 600);
  const shifted = merged.map((m) => ({ ...m, t: m.t - t0 }));
  const last = shifted[shifted.length - 1];
  return {
    t0,
    rec: {
      id: `rec-${Date.now().toString(36)}`,
      title: 'Supplier order to purchase order',
      source: 'live',
      createdAt: Date.now(),
      duration: last.t + (last.dur ?? 0) + 1200,
      events: materialize(shifted),
      inboxId: 'recording',
    },
  };
}

export async function stopRecording() {
  const c = state.capture;
  if (!c.recording) return;
  setState({ capture: { ...c, recording: false, processing: true } });
  bus.send('trace:state', { recording: false });
  const video = await stopVideo();
  const raw = state.capture.raw;
  const actions = state.trace.os ? normalize(raw, c.startedAt) : c.actions;
  // A real capture is kept even when it's partial: the video is worth seeing. The mock path keeps the old bar.
  const built = state.trace.os ? toRecording(actions, { actions: 3, fills: 1 }) : toRecording(actions);
  let rec: Recording;
  if (built) {
    rec = { ...built.rec, raw: state.trace.os ? raw : undefined };
    if (video && state.trace.display) {
      const v: RecordingVideo = {
        url: video.url,
        blob: video.blob,
        offsetMs: c.startedAt + built.t0 - video.startedAt,
        width: video.width,
        height: video.height,
        display: state.trace.display,
      };
      rec.video = v;
      // The video may run longer than the last action.
      rec.duration = Math.max(rec.duration, Math.min(rec.duration + 4000, Date.now() - c.startedAt - built.t0));
    }
  } else {
    rec = demoRecording();
    if (video) URL.revokeObjectURL(video.url);
  }
  setState({
    capture: { ...state.capture, processing: false },
    notice: built
      ? missingNotice(built.rec)
      : state.trace.os
        ? `Trace saw ${raw.length} event${raw.length === 1 ? "" : "s"} but not enough of the chore (open the email, then fill at least 2 fields in Odoo). The demo recording is shown instead.`
        : 'Not enough was captured, so the demo recording is shown instead.',
  });
  addRecording(rec);
  if (built && rec.raw) learnFromRecording(rec);
}

/** Names the workflow values a live recording didn't show being entered. */
function missingNotice(rec: Recording): string | null {
  if (rec.source !== 'live') return null;
  const seen = new Set(rec.events.filter((e) => (e.kind === 'type' || e.kind === 'paste') && e.field).map((e) => e.field));
  const missing = VAR_KEYS.filter((k) => !seen.has(k)).map((k) => FIELD_LABEL[k]);
  return missing.length ? `Recorded. Trace didn't see these Odoo fields being filled: ${missing.join(', ')}. The workflow still uses its predefined steps for them.` : null;
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
    tests: { ...s.tests, status: 'idle', runs: {}, error: null },
    deploy: 'none',
  }));
  startBuild(rec);
}

/** Saves the recording (events + raw OS events + video) to a folder, for workflow-building experiments. */
export async function exportRecording(rec: Recording): Promise<string | null> {
  const { video, ...rest } = rec;
  const json = JSON.stringify({ ...rest, video: video ? { offsetMs: video.offsetMs, width: video.width, height: video.height, display: video.display, file: 'video.webm' } : undefined }, null, 2);
  const buf = video?.blob ? await video.blob.arrayBuffer() : null;
  if (window.mclBridge?.invoke) return window.mclBridge.invoke('trace:export', { id: rec.id, json, video: buf });
  // Browser: download the JSON.
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = `${rec.id}.json`;
  a.click();
  return null;
}

// ---------- Workflow ----------

let buildToken = 0;
export function startBuild(rec: Recording | null = currentRecording()) {
  const token = ++buildToken;
  const ms = state.settings.buildMs;
  setState({ build: { status: 'building', startedAt: Date.now(), ms, fallback: null } });
  const done = (edits: WorkflowEdits | null, fallback: string | null = null) => {
    if (token !== buildToken) return;
    setState((s) => ({ build: { ...s.build, status: 'ready', fallback }, edits: edits ?? s.edits }));
  };
  // src/lib/workflowBuilder.ts: field mappings from the recording, the price rule from the
  // knowledge base or the order history. If it fails or hangs, the prebuilt workflow is used.
  const built: Promise<WorkflowEdits | null> = rec
    ? Promise.race([
        Promise.resolve().then(() => workflowFromRecording(rec, state.knowledge.data)),
        new Promise<never>((_, reject) => later(ms + 5000, () => reject(new Error('it took too long')))),
      ])
    : Promise.resolve(null);
  Promise.all([built, new Promise((r) => later(ms, () => r(null)))])
    .then(([edits]) => (edits ? done(edits) : rec ? done(prebuiltEdits(), 'the builder returned nothing') : done(null)))
    .catch((e: Error) => {
      console.error('Workflow builder failed, using the prebuilt workflow:', e);
      done(prebuiltEdits(), e.message || 'the builder failed');
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
let runToken = 0;

const queued = (id: string): LiveRun => ({ variationId: id, status: 'queued', startedAt: 0, steps: [], active: null, values: {}, shot: null, plan: null });

export function setTestTarget(preferred: 'pc' | 'vm') {
  setState((s) => ({ tests: { ...s.tests, preferred } }));
}

export async function refreshVmStatus() {
  const invoke = window.mclBridge?.invoke;
  if (!invoke) return;
  try {
    const vm = (await invoke('vm:status')) as State['vm'];
    setState((s) => ({ vm, tests: { ...s.tests, preferred: s.tests.preferred === 'pc' && vm.available && !s.tests.runs[VARIATIONS[0].id] ? 'vm' : s.tests.preferred } }));
  } catch (e) {
    setState({ vm: { available: false, reason: (e as Error).message } });
  }
}

/** Runs the approved workflow for real: on this PC or in Freestyle VMs (desktop app), or simulates it (browser). */
export function runTests(only?: string[], target: 'pc' | 'vm' = state.tests.preferred) {
  if (!isElectron) return runSimulated();
  const mode = target === 'vm' && state.vm.available ? 'vm' : 'pc';
  const wf = currentWorkflow();
  const variations = only ? VARIATIONS.filter((v) => only.includes(v.id)) : VARIATIONS;
  const token = ++runToken;
  const runs: Record<string, LiveRun> = {};
  for (const v of variations) runs[v.id] = queued(v.id);
  setState({ tab: 'tests', tests: { ...state.tests, status: 'running', mode, startedAt: Date.now(), runs, error: null, focusId: variations[0].id } });
  const update = (id: string, patch: Partial<LiveRun>) => {
    if (token !== runToken) return;
    setState((s) => {
      const prev = s.tests.runs[id] ?? queued(id);
      // On this PC tests run one at a time, so follow the one running; VMs run together, so stay put.
      const focusId = patch.status === 'running' && s.tests.mode === 'pc' ? id : s.tests.focusId;
      return { tests: { ...s.tests, focusId, runs: { ...s.tests.runs, [id]: { ...prev, ...patch } } } };
    });
  };
  const run = mode === 'vm' ? runInVms : runOnPc;
  run(wf, variations, { update, cancelled: () => token !== runToken })
    .then(() => {
      if (token === runToken) setState((s) => ({ tests: { ...s.tests, status: 'done' } }));
    })
    .catch((e: Error) => {
      if (token === runToken) setState((s) => ({ tests: { ...s.tests, status: 'idle', runs: {}, error: e.message } }));
    });
}

export function stopTests() {
  runToken++;
  setState((s) => ({ tests: { ...s.tests, status: Object.values(s.tests.runs).some((r) => r.plan) ? 'done' : 'idle' } }));
}

/** The old simulated VM runs, kept as a fallback when the real apps aren't available. */
export function runSimulated() {
  const wf = currentWorkflow();
  const speed = state.settings.runSpeed;
  const total = Math.max(...VARIATIONS.map((v, i) => planRun(wf, v).duration + i * RUN_STAGGER));
  setState({ tests: { ...state.tests, status: 'running', mode: 'simulated', startedAt: Date.now(), speed, runs: {}, error: null }, tab: 'tests' });
  later(total / speed + 300, () => {
    if (state.tests.status === 'running' && state.tests.mode === 'simulated') setState({ tests: { ...state.tests, status: 'done' } });
  });
}

/** Results for the report: real runs on this PC, or the simulation. */
export function runPlans(s: State = state): RunPlan[] {
  if (s.tests.mode === 'pc' || s.tests.mode === 'vm') return VARIATIONS.map((v) => s.tests.runs[v.id]?.plan).filter((p): p is RunPlan => !!p);
  const wf = buildWorkflow(s.edits);
  return VARIATIONS.map((v) => planRun(wf, v));
}

// ---------- Knowledge base ----------

const kbPatch = (p: Partial<State['knowledge']>) => setState((s) => ({ knowledge: { ...s.knowledge, ...p } }));
const invoke = (channel: Parameters<NonNullable<NonNullable<typeof window.mclBridge>['invoke']>>[0], ...args: unknown[]) => {
  const bridge = window.mclBridge;
  if (!bridge?.invoke) return Promise.reject(new Error('The knowledge base needs the desktop app (npm run app).'));
  return bridge.invoke(channel, ...args).catch((e: Error) => {
    throw new Error(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  });
};

export async function loadKnowledge() {
  if (!isElectron) return;
  try {
    const r = (await invoke('kb:get')) as { kb: Knowledge; hasKey: boolean };
    kbPatch({ data: r.kb, hasKey: r.hasKey });
  } catch (e) {
    kbPatch({ error: (e as Error).message });
  }
}

/** Reads Odoo, then (with a Claude key) the Gmail inbox, and learns from what's new. */
export async function syncKnowledge() {
  if (state.knowledge.syncing) return;
  kbPatch({ syncing: true, error: null });
  try {
    await invoke('kb:sync');
  } catch (e) {
    kbPatch({ error: (e as Error).message });
  } finally {
    kbPatch({ syncing: false });
    void loadKnowledge();
  }
}

export async function askKnowledge(question: string) {
  if (!question.trim()) return;
  kbPatch({ asking: true, error: null, answer: null });
  try {
    const r = (await invoke('kb:ask', question)) as { answer: string; citations: string[] };
    kbPatch({ answer: { question, ...r } });
  } catch (e) {
    kbPatch({ error: (e as Error).message });
  } finally {
    kbPatch({ asking: false });
  }
}

export async function resetKnowledge() {
  try {
    await invoke('kb:reset');
    kbPatch({ answer: null, error: null, progress: null });
  } catch (e) {
    kbPatch({ error: (e as Error).message });
  }
}

/** A finished live recording teaches the knowledge base how the task is done (needs a Claude key). */
function learnFromRecording(rec: Recording) {
  if (!isElectron || !state.knowledge.hasKey) return;
  invoke('kb:ingest-recording', { id: rec.id, title: rec.title, summary: recordingSummary(rec) }).catch((e: Error) => kbPatch({ error: e.message }));
}

/**
 * Starts real shadow mode in the ShadowDeployment actor with the approved answers. Without the actors
 * server the dashboard falls back to the simulated preview.
 */
export function deployShadow() {
  setState({ deploy: 'shadow', tab: 'deploy' });
  if (!isElectron) return;
  const { answer, threshold, mappings } = state.edits;
  actorCall('shadowDeploy', { edits: { answer, threshold, mappings } }).catch((e: Error) =>
    setState({ notice: `Shadow mode could not start live (${e.message}). Showing the simulated preview.` }),
  );
}

// ---------- Demo plumbing ----------

export function resetDemo() {
  timers.forEach((id) => clearTimeout(id));
  timers = [];
  buildToken++;
  runToken++;
  void stopVideo();
  const knowledge = state.knowledge;
  state = { ...initial(state.settings, state.trace), knowledge };
  subs.forEach((f) => f());
  bus.send('demo:reset');
  bus.send('trace:state', { recording: false });
  if (isElectron) {
    // Shadow results and pending approvals belong to the demo run being reset.
    actorCall('shadowReset').catch(() => undefined);
    actorCall('approvalClear').catch(() => undefined);
  }
}

export function setSettings(p: Partial<Settings>) {
  setState((s) => ({ settings: { ...s.settings, ...p } }));
}

/** Desktop simulator: apply an action to the simulated desktop and record it. */
export function simAction(a: Action) {
  setState((s) => ({ sim: applyAction(s.sim, a) }));
  record(a);
}

/** Wire up messages from the tray, the Trace helper and (fallback) the mock app windows. */
export function connectMainWindow() {
  const offs = [
    bus.on('trace:event', (a: Action) => record(a)),
    bus.on('trace:raw', (ev: RawOsEvent) => recordRaw(ev)),
    bus.on('trace:capability', (c: TraceCapability) => setState({ trace: c })),
    bus.on('shell:error', (d: { message: string }) => setState({ notice: d.message })),
    bus.on('trace:command', (d: { cmd: 'start' | 'stop' }) => (d.cmd === 'start' ? startRecording() : stopRecording())),
    bus.on('kb:updated', (data: Knowledge) => kbPatch({ data })),
    bus.on('kb:progress', (progress: State['knowledge']['progress']) => kbPatch({ progress })),
  ];
  bus.send('trace:hello');
  void loadKnowledge();
  void refreshVmStatus();
  return () => offs.forEach((f) => f());
}
