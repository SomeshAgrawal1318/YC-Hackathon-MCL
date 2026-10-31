import { rawEventCount } from '../data/scenario';
import type { Recording } from '../data/schema';
import { useFrameClock } from '../lib/hooks';
import type { State } from '../lib/store';
import { IconCheck } from './Icons';

/** `pastOrders`: past orders matched to their emails (src/data/history.ts), which answer questions. */
export function buildSteps(rec: Recording, pastOrders = 0): string[] {
  const targets = new Set(rec.events.map((e) => e.target?.tid).filter(Boolean)).size;
  const apps = new Set(rec.events.map((e) => e.app).filter((a) => a !== 'desktop')).size;
  return [
    `Read ${rawEventCount(rec)} raw events from the recording`,
    `Grouped them into ${rec.events.length} actions across ${apps} apps`,
    `Matched ${targets} screen elements by their accessibility names`,
    'Found 6 values that change from order to order',
    pastOrders
      ? `Checked ${pastOrders} past orders and their emails for what the recording couldn’t show`
      : 'Drafted 5 steps and 1 question for you',
  ];
}

export function useBuildProgress(build: State['build']): number {
  const now = useFrameClock(build.status === 'building', 20);
  if (build.status === 'ready') return 1;
  if (build.status === 'idle') return 0;
  return Math.min(0.999, (now - build.startedAt) / build.ms);
}

/** The step-by-step "how the workflow gets built" list. */
export function BuildChecklist({ rec, progress, pastOrders = 0 }: { rec: Recording; progress: number; pastOrders?: number }) {
  const steps = buildSteps(rec, pastOrders);
  const doneCount = Math.floor(progress * steps.length + 0.0001);
  return (
    <ol className="build-list">
      {steps.map((s, i) => {
        const state = i < doneCount ? 'done' : i === doneCount ? 'active' : 'todo';
        return (
          <li key={i} className={`build-step is-${state}`}>
            <span className="build-mark">{state === 'done' ? <IconCheck size={14} /> : state === 'active' ? <i className="spinner" /> : null}</span>
            {s}
          </li>
        );
      })}
    </ol>
  );
}

export function BuildMeter({ progress }: { progress: number }) {
  return (
    <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <i style={{ width: `${progress * 100}%` }} />
    </div>
  );
}
