/** 12345 ms -> "0:12.3" (or "0:12" when tenths are off). */
export function fmt(ms: number, tenths = true): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const sec = tenths ? rest.toFixed(1).padStart(4, '0') : String(Math.floor(rest)).padStart(2, '0');
  return `${m}:${sec}`;
}

export const pctStr = (n: number, d = 1) => `${n.toFixed(d)}%`;
