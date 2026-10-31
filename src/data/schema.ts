// Shared data model for the demo.
// The workflow JSON shape here is the contract the real pieces should produce later:
// Trace -> TraceEvent[], workflow builder -> Workflow, Grokbot test runs -> RunPlan.

export type AppId = 'desktop' | 'mail' | 'erp';

export type FieldKey =
  | 'supplier'
  | 'po_number'
  | 'item_sku'
  | 'quantity'
  | 'unit_price'
  | 'delivery_date'
  | 'notes';

export type VarKey = Exclude<FieldKey, 'notes'>;

/** What Trace captures. `read` is only used by the agent during test runs. */
export type EventKind = 'app_switch' | 'click' | 'type' | 'copy' | 'paste' | 'save' | 'read';

/** An element as the accessibility tree names it. `tid` is our stable handle for it. */
export interface A11yTarget {
  tid: string;
  role: string;
  name: string;
  path: string[];
  /** From real capture: UI Automation AutomationId (the HTML id in Chrome). */
  automationId?: string;
  /** From real capture: screen rectangle in physical pixels [x, y, width, height]. */
  rect?: [number, number, number, number];
  /** From real capture: the process that owns the window. */
  process?: string;
}

/** One line from trace-helper.exe, tagged by Electron with the app it came from. */
export interface RawOsEvent {
  type: 'event';
  kind: 'click' | 'dblclick' | 'value' | 'shortcut' | 'clipboard' | 'foreground' | 'title';
  ts: number;
  hwnd: number;
  process: string;
  window: string;
  app: 'mail' | 'erp' | 'other';
  url?: string;
  element?: {
    role: string;
    name: string;
    automationId: string;
    className: string;
    path: string[];
    rect: [number, number, number, number];
    value?: string;
    isPassword?: boolean;
  };
  point?: [number, number];
  keys?: string;
  text?: string;
  button?: 'left' | 'right';
}

/** Screen video recorded alongside the events. */
export interface RecordingVideo {
  url: string;
  /** Recording time t (ms) is at video time (t + offsetMs) / 1000 s. */
  offsetMs: number;
  width: number;
  height: number;
  /** Physical-pixel bounds of the recorded display, to place UI Automation rectangles on the video. */
  display: { x: number; y: number; width: number; height: number };
  blob?: Blob;
}

/** One user (or agent) action, as emitted by the mock apps or the scripted recording. */
export interface Action {
  kind: EventKind;
  app: AppId;
  target?: A11yTarget;
  value?: string;
  /** For copy/read: which value in the email was selected. */
  varKey?: VarKey;
  /** For click on an email in the list. */
  messageId?: string;
  /** For typing into / pasting into an ERP field. */
  field?: FieldKey;
}

export interface MailState {
  selectedId: string | null;
  selection: VarKey | null;
}

export interface Banner {
  kind: 'saved' | 'paused' | 'flagged';
  title: string;
  detail?: string;
}

export interface ErpState {
  screen: 'list' | 'form';
  fields: Partial<Record<FieldKey, string>>;
  focused: FieldKey | null;
  saved: boolean;
  banner: Banner | null;
}

export interface DesktopState {
  focus: AppId;
  mail: MailState;
  erp: ErpState;
  /** Agent status shown over the desktop during test runs (paused, flagged). */
  note: Banner | null;
}

export interface TraceEvent extends Action {
  id: string;
  /** ms from the start of the recording / run */
  t: number;
  /** ms, for typing spans */
  dur?: number;
  /** Desktop state right after this event. */
  snap: DesktopState;
}

export interface Recording {
  id: string;
  title: string;
  /** live = captured from Windows (Gmail + Odoo), demo = the built-in scripted recording. */
  source: 'live' | 'demo';
  createdAt: number;
  duration: number;
  events: TraceEvent[];
  inboxId: string;
  /** Everything the helper reported, before turning it into actions. */
  raw?: RawOsEvent[];
  video?: RecordingVideo;
}

// ---------- Mail content ----------

/** Body text with marked spans for values the workflow cares about. */
export type BodyPart = string | { key: VarKey; text: string };

export interface MailMessage {
  id: string;
  fromName: string;
  fromEmail: string;
  company: string;
  subject: string;
  received: string;
  preview: string;
  body: BodyPart[];
  unread?: boolean;
}

// ---------- Workflow ----------

export type NodeKind = 'trigger' | 'extract' | 'open' | 'fill' | 'decision' | 'approval' | 'flag' | 'save' | 'end';

export interface NodeSource {
  /** Recording events that taught us this step: matched by target tid prefix and/or kind. */
  tidPrefixes?: string[];
  kinds?: EventKind[];
  apps?: AppId[];
}

export interface WfNode {
  id: string;
  kind: NodeKind;
  title: string;
  detail: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ai?: boolean;
  source?: NodeSource;
  vars?: VarKey[];
  questionId?: string;
}

export interface WfEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export type PricePolicy = 'save' | 'ask' | 'flag';

export interface QuestionOption {
  id: PricePolicy;
  label: string;
  hint: string;
}

export interface Question {
  id: string;
  nodeId: string;
  text: string;
  why: string;
  options: QuestionOption[];
}

/** Everything the reviewer can change. The flowchart is derived from this. */
export interface WorkflowEdits {
  answer: PricePolicy | null;
  threshold: number;
  titles: Record<string, string>;
  positions: Record<string, { x: number; y: number }>;
  mappings: Record<Exclude<FieldKey, 'notes'>, VarKey | null>;
  approved: boolean;
}

export interface Workflow {
  name: string;
  nodes: WfNode[];
  edges: WfEdge[];
  question: Question;
  edits: WorkflowEdits;
}

// ---------- Tests ----------

export type Outcome = 'completed' | 'paused' | 'flagged';

export interface Variation {
  id: string;
  title: string;
  whatsDifferent: string;
  message: MailMessage;
  /** The values a careful buyer would enter. */
  expected: Partial<Record<VarKey, string>>;
}

export interface RunStep {
  nodeId: string;
  label: string;
  t0: number;
  t1: number;
  state: 'done' | 'paused' | 'flagged';
  note?: string;
  /** Screenshot of the app after this step (runs on this PC). */
  shot?: string;
}

export interface RunPlan {
  variationId: string;
  events: TraceEvent[];
  steps: RunStep[];
  outcome: Outcome;
  outcomeNote: string;
  duration: number;
  entered: Partial<Record<VarKey, string>>;
  bootMs: number;
  /** Runs on this PC: the purchase order created in Odoo, if any. */
  record?: { id: number; name: string; url: string };
  /** Runs on this PC: why the run stopped early, if it did. */
  error?: string;
}

/** A workflow run on this PC, as it progresses. */
export interface LiveRun {
  variationId: string;
  status: 'queued' | 'running' | 'done' | 'error';
  startedAt: number;
  steps: RunStep[];
  /** The step in progress. */
  active: { nodeId: string; label: string; t0: number } | null;
  values: Partial<Record<VarKey, string>>;
  shot: string | null;
  plan: RunPlan | null;
  error?: string;
  /** Runs in a Freestyle VM: its live screen and Odoo. */
  vm?: { vncUrl: string; odooUrl: string; bootMs: number; readyMs: number };
}
