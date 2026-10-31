// Simulated week of shadow mode. Shown on screen as a preview, not as live data.

export const SHADOW_DAYS = [
  { day: 'Mon', handled: 31, matched: 28 },
  { day: 'Tue', handled: 34, matched: 32 },
  { day: 'Wed', handled: 29, matched: 28 },
  { day: 'Thu', handled: 36, matched: 35 },
  { day: 'Fri', handled: 33, matched: 31 },
  { day: 'Sat', handled: 22, matched: 22 },
  { day: 'Sun', handled: 27, matched: 27 },
];

export const SHADOW_TOTALS = (() => {
  const handled = SHADOW_DAYS.reduce((a, d) => a + d.handled, 0);
  const matched = SHADOW_DAYS.reduce((a, d) => a + d.matched, 0);
  return { handled, matched, escalated: 6, different: handled - matched - 6, streak: 43, streakGoal: 50, goalRate: 95 };
})();

export type ShadowResult = 'matched' | 'different' | 'escalated';

export const SHADOW_FEED: Array<{ time: string; supplier: string; po: string; result: ShadowResult; note: string }> = [
  { time: '4:52 PM', supplier: 'Ridgeline Steel Co.', po: 'PO-4561', result: 'matched', note: 'All 6 fields matched the buyer’s entry' },
  { time: '4:31 PM', supplier: 'Fernwood Fasteners', po: 'PO-4559', result: 'matched', note: 'All 6 fields matched the buyer’s entry' },
  { time: '3:58 PM', supplier: 'Brightwater Plastics', po: 'PO-4556', result: 'escalated', note: 'Price +6.2%. The buyer approved it, as the draft suggested' },
  { time: '2:14 PM', supplier: 'Ridgeline Steel Co.', po: 'PO-4553', result: 'different', note: 'The buyer entered the contract price $37.90, the email said $38.50' },
  { time: '1:40 PM', supplier: 'Fernwood Fasteners', po: 'PO-4550', result: 'matched', note: 'All 6 fields matched the buyer’s entry' },
  { time: '11:22 AM', supplier: 'Brightwater Plastics', po: 'PO-4548', result: 'matched', note: 'All 6 fields matched the buyer’s entry' },
];
