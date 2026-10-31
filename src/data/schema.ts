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
  source: 'live' | 'demo';
  createdAt: number;
  duration: number;
  events: TraceEvent[];
  inboxId: string;
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
}
