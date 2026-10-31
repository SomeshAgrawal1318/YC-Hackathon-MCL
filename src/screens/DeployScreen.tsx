import { useState } from 'react';
import { IconCheck, IconDeploy, IconFlag, IconHand } from '../components/Icons';
import { SHADOW_DAYS, SHADOW_FEED, SHADOW_TOTALS } from '../data/shadow';
import type { ShadowResult } from '../data/shadow';
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

const RESULT_LABEL: Record<ShadowResult, string> = { matched: 'Matched', different: 'Different', escalated: 'Asked a buyer' };

function ShadowDashboard() {
  const t = SHADOW_TOTALS;
  const rate = (t.matched / t.handled) * 100;
  return (
    <div className="screen deploy">
      <header className="screen-head">
        <div>
          <h1>Shadow mode is on</h1>
          <p className="preview-note">Preview: a simulated first week, so you can see what this page will show.</p>
        </div>
        <div className="head-side">
          <button type="button" className="btn" disabled title={`Needs ${t.streakGoal - t.streak} more matching orders in a row`}>
            Switch to live
          </button>
        </div>
      </header>

      <div className="kpis">
        <div className="kpi panel">
          <span className="kpi-n">{rate.toFixed(1)}%</span>
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
          <MatchChart />
        </div>
        <div className="panel feed-card">
          <h2>Latest comparisons</h2>
          <ul className="feed">
            {SHADOW_FEED.map((f) => (
              <li key={f.po} className={`is-${f.result}`}>
                <span className={`pill is-${f.result === 'matched' ? 'completed' : f.result === 'escalated' ? 'paused' : 'flagged'}`}>
                  {f.result === 'matched' ? <IconCheck size={13} /> : f.result === 'escalated' ? <IconHand size={13} /> : <IconFlag size={13} />}
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

/** One series (match rate per day) against the go-live goal. Hover a day for its numbers. */
function MatchChart() {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 230, L = 44, R = 20, T = 18, B = 34;
  const lo = 85, hi = 100;
  const xs = (i: number) => L + (i * (W - L - R)) / (SHADOW_DAYS.length - 1);
  const ys = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const pts = SHADOW_DAYS.map((d, i) => ({ ...d, rate: (d.matched / d.handled) * 100, x: xs(i) }));
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${ys(p.rate)}`).join(' ');
  const goal = SHADOW_TOTALS.goalRate;
  const h = hover !== null ? pts[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily match rate, Monday to Sunday" onMouseLeave={() => setHover(null)}>
        {[85, 90, 95, 100].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={ys(v)} y2={ys(v)} className="grid" />
            <text x={L - 8} y={ys(v) + 4} className="axis" textAnchor="end">{v}%</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={ys(goal)} y2={ys(goal)} className="goal" />
        <text x={W - R} y={ys(goal) - 6} className="goal-label" textAnchor="end">Go-live goal {goal}%</text>
        {h && <line x1={h.x} x2={h.x} y1={T} y2={H - B} className="crosshair" />}
        <path d={path} className="series" />
        {pts.map((p, i) => (
          <g key={p.day}>
            <circle cx={p.x} cy={ys(p.rate)} r={hover === i ? 5.5 : 4} className="dot" />
            <text x={p.x} y={H - 12} className="axis" textAnchor="middle">{p.day}</text>
            <rect x={p.x - 30} y={T} width={60} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
        <text x={pts[pts.length - 1].x - 8} y={ys(pts[pts.length - 1].rate) - 10} className="direct-label" textAnchor="end">
          {pts[pts.length - 1].rate.toFixed(0)}%
        </text>
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(h.x / W) * 100}%` }}>
          <b>{h.day}</b> {h.rate.toFixed(1)}% matched
          <span className="muted">{h.matched} of {h.handled} orders</span>
        </div>
      )}
      <table className="sr-only">
        <caption>Daily match rate</caption>
        <thead><tr><th>Day</th><th>Orders</th><th>Matched</th></tr></thead>
        <tbody>{SHADOW_DAYS.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.handled}</td><td>{d.matched}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
