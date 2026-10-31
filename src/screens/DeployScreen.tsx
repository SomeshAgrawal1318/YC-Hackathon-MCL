import { useEffect, useState } from 'react';
import { IconCheck, IconClock, IconDeploy, IconFlag, IconHand } from '../components/Icons';
import { SHADOW_DAYS, SHADOW_FEED, SHADOW_TOTALS } from '../data/shadow';
import type { ShadowResult } from '../data/shadow';
import type { ShadowDay } from '../data/shadowCompare';
import { SHADOW, useActorState, type ShadowState } from '../lib/actors';
import { deployShadow, setState, useStore } from '../lib/store';

export function DeployScreen() {
  const s = useStore();
  if (s.tests.status !== 'done') {
    return (
      <div className="screen empty">
        <IconDeploy size={40} />
        <h1>Test the workflow first</h1>
        <p>Deploying needs a passing test report.</p>
        <button type="button" className="btn" onClick={() => setState({ tab: 'tests' })}>Go to test runs</button>
      </div>
    );
  }
  return s.deploy === 'shadow' ? <ShadowDashboard /> : <DeployIntro />;
}

function DeployIntro() {
  return (
    <div className="screen deploy">
      <header className="screen-head">
        <div>
          <h1>Deploy in shadow mode</h1>
          <p className="lede">The workflow runs next to your buyers on real supplier emails, but never saves anything. It drafts what it would have entered and compares that with what the buyer actually entered.</p>
        </div>
      </header>
      <div className="deploy-cols">
        <div className="panel deploy-card">
          <h2>While in shadow mode</h2>
          <ul className="ticks">
            <li><IconCheck size={15} /> Reads every new order email, the same as a buyer would</li>
            <li><IconCheck size={15} /> Drafts the purchase order without saving it</li>
            <li><IconCheck size={15} /> Compares each draft with the buyer’s real entry, field by field</li>
            <li><IconCheck size={15} /> Sends price changes to the buyer, as you answered</li>
          </ul>
        </div>
        <div className="panel deploy-card">
          <h2>Going live</h2>
          <p>You can switch it to live once it matches the buyers on at least {SHADOW_TOTALS.goalRate}% of orders, {SHADOW_TOTALS.streakGoal} orders in a row.</p>
          <button type="button" className="btn is-primary is-big" onClick={deployShadow}>
            <IconDeploy size={18} /> Deploy in shadow mode
          </button>
        </div>
      </div>
    </div>
  );
}

type FeedResult = ShadowResult | 'waiting';

const RESULT_LABEL: Record<FeedResult, string> = { matched: 'Matched', different: 'Different', escalated: 'Asked a buyer', waiting: 'Waiting for the buyer' };
const RESULT_PILL: Record<FeedResult, string> = { matched: 'completed', different: 'flagged', escalated: 'paused', waiting: 'wait' };

interface FeedRow {
  key: string;
  time: string;
  supplier: string;
  po: string;
  result: FeedResult;
  note: string;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Re-renders every second, for "last check 12 s ago". */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Live from the ShadowDeployment actor when the actors server runs (npm run actors:dev); otherwise
 * the simulated first week, labeled as a preview.
 */
function ShadowDashboard() {
  const { state: live, connected } = useActorState<ShadowState>(SHADOW);
  const now = useNow();
  const isLive = connected && live?.status === 'watching';
  const t = isLive ? live.totals : SHADOW_TOTALS;
  const days = isLive ? live.days : SHADOW_DAYS;
  const feed: FeedRow[] = isLive
    ? live.feed.filter((f) => f.result !== 'skipped').map((f) => ({ key: f.id, time: clock(f.time), supplier: f.supplier, po: f.po, result: f.result as FeedResult, note: f.note }))
    : SHADOW_FEED.map((f) => ({ key: f.po, ...f }));
  const rate = t.handled ? (t.matched / t.handled) * 100 : null;
  const ago = isLive && live.lastCheck ? Math.max(0, Math.round((now - live.lastCheck) / 1000)) : null;

  return (
    <div className="screen deploy">
      <header className="screen-head">
        <div>
          <h1>Shadow mode is on</h1>
          {isLive ? (
            <p className="live-note">
              <i className="live-dot" /> Live: {live.source === 'imap' ? 'watching the demo inbox' : 'waiting for order emails'}
              {ago !== null && <span className="muted"> · last check {ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`} ago</span>}
              {live.lastError && <span className="live-error" title={live.lastError}> · {live.lastError}</span>}
            </p>
          ) : (
            <p className="preview-note">Preview: a simulated first week, so you can see what this page will show.</p>
          )}
        </div>
        <div className="head-side">
          <button type="button" className="btn" disabled title={`Needs ${t.streakGoal - t.streak} more matching orders in a row`}>
            Switch to live
          </button>
        </div>
      </header>

      <div className="kpis">
        <div className="kpi panel">
          <span className="kpi-n">{rate === null ? '–' : `${rate.toFixed(1)}%`}</span>
          <span className="kpi-l">of drafts matched the buyer’s entry</span>
        </div>
        <div className="kpi panel">
          <span className="kpi-n">{t.handled}</span>
          <span className="kpi-l">order emails handled</span>
        </div>
        <div className="kpi panel">
          <span className="kpi-n">{t.escalated}</span>
          <span className="kpi-l">price changes sent to a buyer</span>
        </div>
        <div className="kpi panel">
          <span className="kpi-n">{t.streak} of {t.streakGoal}</span>
          <span className="kpi-l">matching orders in a row before going live</span>
          <div className="meter"><i style={{ width: `${(t.streak / t.streakGoal) * 100}%` }} /></div>
        </div>
      </div>

      <div className="deploy-cols">
        <div className="panel chart-card">
          <h2>Daily match rate</h2>
          <MatchChart days={days} goal={t.goalRate} />
        </div>
        <div className="panel feed-card">
          <h2>Latest comparisons</h2>
          {!feed.length && <p className="muted">Waiting for the first order email…</p>}
          <ul className="feed">
            {feed.map((f) => (
              <li key={f.key} className={`is-${f.result}`}>
                <span className={`pill is-${RESULT_PILL[f.result]}`}>
                  {f.result === 'matched' ? <IconCheck size={13} /> : f.result === 'escalated' ? <IconHand size={13} /> : f.result === 'waiting' ? <IconClock size={13} /> : <IconFlag size={13} />}
                  {RESULT_LABEL[f.result]}
                </span>
                <div>
                  <b>{f.po}</b> {f.supplier}
                  <div className="muted small">{f.note}</div>
                </div>
                <span className="muted small">{f.time}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** One series (match rate per day) against the go-live goal. Hover a day for its numbers. Days without orders have no dot. */
function MatchChart({ days, goal }: { days: ShadowDay[]; goal: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 230, L = 44, R = 20, T = 18, B = 34;
  const pts = days.map((d, i) => ({ ...d, rate: d.handled ? (d.matched / d.handled) * 100 : null, x: L + (i * (W - L - R)) / Math.max(1, days.length - 1) }));
  const rates = pts.flatMap((p) => (p.rate === null ? [] : [p.rate]));
  // The simulated week sits between 85% and 100%; live data can be anywhere.
  const lo = Math.min(85, Math.floor(Math.min(100, ...rates) / 10) * 10);
  const hi = 100;
  const ys = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const ticks = lo >= 85 ? [85, 90, 95, 100] : [lo, (lo + hi) / 2, hi].map((v) => Math.round(v));
  const withData = pts.filter((p) => p.rate !== null);
  const path = withData.map((p, i) => `${i ? 'L' : 'M'}${p.x},${ys(p.rate!)}`).join(' ');
  const h = hover !== null ? pts[hover] : null;
  const lastPt = withData[withData.length - 1];

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily match rate, ${days[0]?.day} to ${days[days.length - 1]?.day}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={ys(v)} y2={ys(v)} className="grid" />
            <text x={L - 8} y={ys(v) + 4} className="axis" textAnchor="end">{v}%</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={ys(goal)} y2={ys(goal)} className="goal" />
        <text x={W - R} y={ys(goal) - 6} className="goal-label" textAnchor="end">Go-live goal {goal}%</text>
        {h && <line x1={h.x} x2={h.x} y1={T} y2={H - B} className="crosshair" />}
        {withData.length > 1 && <path d={path} className="series" />}
        {pts.map((p, i) => (
          <g key={`${p.day}-${i}`}>
            {p.rate !== null && <circle cx={p.x} cy={ys(p.rate)} r={hover === i ? 5.5 : 4} className="dot" />}
            <text x={p.x} y={H - 12} className="axis" textAnchor="middle">{p.day}</text>
            <rect x={p.x - 30} y={T} width={60} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
        {lastPt && (
          <text x={lastPt.x - 8} y={ys(lastPt.rate!) - 10} className="direct-label" textAnchor="end">
            {lastPt.rate!.toFixed(0)}%
          </text>
        )}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(h.x / W) * 100}%` }}>
          <b>{h.day}</b> {h.rate === null ? 'no orders' : `${h.rate.toFixed(1)}% matched`}
          <span className="muted">{h.matched} of {h.handled} orders</span>
        </div>
      )}
      <table className="sr-only">
        <caption>Daily match rate</caption>
        <thead><tr><th>Day</th><th>Orders</th><th>Matched</th></tr></thead>
        <tbody>{days.map((d, i) => <tr key={`${d.day}-${i}`}><td>{d.day}</td><td>{d.handled}</td><td>{d.matched}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
