// The knowledge base as the app sees it (built and stored by electron/knowledge.cjs), plus the
// helpers the Knowledge tab and the workflow use: graph data, the price rule, recording summaries.
import { APP_NAME, FIELD_LABEL } from './desktop';
import type { Recording } from './schema';

export type EntityType = 'supplier' | 'product' | 'person' | 'team' | 'system' | 'rule' | 'process' | 'shipper' | 'other';

export interface KbEntity {
  id: string;
  name: string;
  type: EntityType;
  summary: string;
  sources: string[];
  mentions: number;
  learnedAt: number;
  props?: { topic?: string; threshold?: number; action?: string; approver?: string; quote?: string; statement?: string; sourceId?: string };
}

export interface KbFact {
  id: string;
  subject: string;
  relation: string;
  object: string;
  statement: string;
  quote: string;
  sources: string[];
  learnedAt: number;
  supersededBy?: string;
}

export interface KbSource {
  id: string;
  kind: 'email' | 'recording' | 'odoo';
  title: string;
  from?: string;
  at: number;
  ref?: string;
  learnedAt?: number;
  /** Supplier order emails: the email text, kept for the order history (not sent to Claude). */
  text?: string;
  order?: boolean;
}

/** A confirmed purchase order in Odoo, with the notes the buyer logged on it. */
export interface OdooOrder {
  id: number;
  /** Odoo's own number, e.g. P00012. */
  name: string;
  /** Vendor Reference: the supplier's PO number. */
  ref: string | null;
  vendor: string;
  /** Order date, YYYY-MM-DD. */
  date: string;
  /** Expected Arrival, YYYY-MM-DD. */
  arrival: string | null;
  origin: string;
  lines: Array<{ sku: string | null; qty: number; price: number }>;
  notes: string[];
  url?: string;
}

export interface Knowledge {
  version: number;
  entities: Record<string, KbEntity>;
  facts: KbFact[];
  sources: Record<string, KbSource>;
  /** Confirmed purchase orders from Odoo, newest first. */
  orders?: OdooOrder[];
  syncedAt: number | null;
}

export const emptyKnowledge = (): Knowledge => ({ version: 1, entities: {}, facts: [], sources: {}, orders: [], syncedAt: null });

export const TYPE_LABEL: Record<EntityType | 'source', string> = {
  supplier: 'Suppliers',
  product: 'Products',
  person: 'People',
  team: 'Teams',
  system: 'Systems',
  rule: 'Rules',
  process: 'Processes',
  shipper: 'Shippers',
  other: 'Other',
  source: 'Sources',
};

/** One colour per kind, readable on the dark graph background. */
export const TYPE_COLOR: Record<EntityType | 'source', string> = {
  supplier: '#7d95ff',
  product: '#52d6a8',
  person: '#ffc15e',
  team: '#f59cc4',
  system: '#b9a3ff',
  rule: '#ff7262',
  process: '#62d4e8',
  shipper: '#cbe37f',
  other: '#9aa5b5',
  source: '#6c7889',
};

export interface GraphNode {
  id: string;
  name: string;
  type: EntityType | 'source';
  val: number;
  learnedAt: number;
}

export interface GraphLink {
  source: string;
  target: string;
  label: string;
  kind: 'fact' | 'source';
  factId?: string;
}

/** Entities and their facts as a graph. Sources are optional, faint nodes linked to what they taught. */
export function graphData(kb: Knowledge, opts: { hidden: Set<string>; showSources: boolean }): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const keep = new Set<string>();
  for (const e of Object.values(kb.entities)) {
    if (opts.hidden.has(e.type)) continue;
    keep.add(e.id);
    nodes.push({ id: e.id, name: e.name, type: e.type, val: 2 + Math.min(10, e.mentions), learnedAt: e.learnedAt });
  }
  const links: GraphLink[] = [];
  for (const f of kb.facts) {
    if (f.supersededBy || !keep.has(f.subject) || !keep.has(f.object)) continue;
    links.push({ source: f.subject, target: f.object, label: f.relation, kind: 'fact', factId: f.id });
  }
  if (opts.showSources) {
    for (const s of Object.values(kb.sources)) {
      const taught = Object.values(kb.entities).filter((e) => keep.has(e.id) && e.sources.includes(s.id));
      if (!taught.length) continue;
      nodes.push({ id: s.id, name: s.title, type: 'source', val: 1, learnedAt: s.learnedAt ?? s.at });
      for (const e of taught) links.push({ source: s.id, target: e.id, label: 'taught', kind: 'source' });
    }
  }
  return { nodes, links };
}

/** Facts about one entity, newest first, with the names on both ends. */
export function factsAbout(kb: Knowledge, id: string) {
  return kb.facts
    .filter((f) => !f.supersededBy && (f.subject === id || f.object === id))
    .sort((a, b) => b.learnedAt - a.learnedAt)
    .map((f) => ({ ...f, subjectName: kb.entities[f.subject]?.name ?? f.subject, objectName: kb.entities[f.object]?.name ?? f.object }));
}

export interface PriceRule {
  entity: KbEntity;
  threshold: number;
  action: 'ask' | 'flag';
  approver: string;
  quote: string;
  source: KbSource | null;
}

/** The rule about price changes on supplier orders, if the knowledge base has learned one. */
export function priceRule(kb: Knowledge): PriceRule | null {
  const rules = Object.values(kb.entities)
    .filter((e) => e.type === 'rule' && e.props?.topic === 'price_change' && (e.props.threshold ?? 0) > 0 && (e.props.action === 'ask' || e.props.action === 'flag'))
    .sort((a, b) => b.learnedAt - a.learnedAt);
  const e = rules[0];
  if (!e?.props) return null;
  return {
    entity: e,
    threshold: e.props.threshold!,
    action: e.props.action as 'ask' | 'flag',
    approver: e.props.approver ?? '',
    quote: e.props.quote ?? e.summary,
    source: (e.props.sourceId && kb.sources[e.props.sourceId]) || null,
  };
}

/** A Trace recording as plain text, for the knowledge base to learn the process from. */
export function recordingSummary(rec: Recording): string {
  const lines = [`A buyer recorded this task with Trace (${Math.round(rec.duration / 1000)} s, ${rec.events.length} steps).`];
  for (const e of rec.events) {
    const app = APP_NAME[e.app];
    const t = `${(e.t / 1000).toFixed(1)}s`;
    if (e.kind === 'app_switch') lines.push(`${t} switched to ${app}`);
    else if (e.kind === 'click' && e.messageId) lines.push(`${t} opened the email "${e.target?.name}" in ${app}`);
    else if (e.kind === 'copy') lines.push(`${t} copied "${e.value}" from the email in ${app}`);
    else if ((e.kind === 'paste' || e.kind === 'type') && e.field) lines.push(`${t} ${e.kind === 'paste' ? 'pasted' : 'entered'} "${e.value}" into ${FIELD_LABEL[e.field]} in ${app}`);
    else if (e.kind === 'save') lines.push(`${t} saved the purchase order in ${app} (${e.target?.name})`);
    else if (e.kind === 'click' && e.target) lines.push(`${t} clicked ${e.target.role} "${e.target.name}" in ${app}`);
  }
  return lines.join('\n');
}
