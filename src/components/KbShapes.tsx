// One shape per kind of thing in the knowledge graph, drawn on the canvas and as legend icons,
// so kinds stay distinguishable without relying on colour alone.
import { TYPE_COLOR } from '../data/knowledge';
import type { EntityType } from '../data/knowledge';

export type Kind = EntityType | 'source';

/** Traces the outline of `kind` centred on (x, y) with radius r. Caller fills or strokes. */
export function tracePath(ctx: CanvasRenderingContext2D, kind: Kind, x: number, y: number, r: number) {
  ctx.beginPath();
  switch (kind) {
    case 'supplier': {
      const s = r * 0.9;
      const k = s * 0.35;
      ctx.moveTo(x - s + k, y - s);
      ctx.arcTo(x + s, y - s, x + s, y + s, k);
      ctx.arcTo(x + s, y + s, x - s, y + s, k);
      ctx.arcTo(x - s, y + s, x - s, y - s, k);
      ctx.arcTo(x - s, y - s, x + s, y - s, k);
      break;
    }
    case 'product':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const px = x + r * Math.cos(a);
        const py = y + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      break;
    case 'rule':
      ctx.moveTo(x, y - r * 1.15);
      ctx.lineTo(x + r * 1.15, y);
      ctx.lineTo(x, y + r * 1.15);
      ctx.lineTo(x - r * 1.15, y);
      break;
    case 'process':
      ctx.moveTo(x - r * 0.8, y - r);
      ctx.lineTo(x + r * 1.05, y);
      ctx.lineTo(x - r * 0.8, y + r);
      break;
    case 'system':
      ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
      break;
    case 'shipper': {
      const w = r * 1.25;
      const h = r * 0.75;
      ctx.moveTo(x - w + h, y - h);
      ctx.arcTo(x + w, y - h, x + w, y + h, h);
      ctx.arcTo(x + w, y + h, x - w, y + h, h);
      ctx.arcTo(x - w, y + h, x - w, y - h, h);
      ctx.arcTo(x - w, y - h, x + w, y - h, h);
      break;
    }
    default:
      ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
  ctx.closePath();
}

/** Small inner marks that make a few kinds easier to tell apart up close. */
export function drawInner(ctx: CanvasRenderingContext2D, kind: Kind, x: number, y: number, r: number) {
  if (kind === 'team') {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.5, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(10, 14, 20, 0.55)';
    ctx.lineWidth = r * 0.18;
    ctx.stroke();
  } else if (kind === 'system') {
    ctx.fillStyle = 'rgba(10, 14, 20, 0.5)';
    ctx.fillRect(x - r * 0.35, y - r * 0.35, r * 0.7, r * 0.7);
  } else if (kind === 'person') {
    ctx.beginPath();
    ctx.arc(x, y - r * 0.18, r * 0.32, 0, 2 * Math.PI);
    ctx.moveTo(x - r * 0.55, y + r * 0.6);
    ctx.quadraticCurveTo(x, y + r * 0.05, x + r * 0.55, y + r * 0.6);
    ctx.fillStyle = 'rgba(10, 14, 20, 0.45)';
    ctx.fill();
  }
}

const SVG: Record<Kind, string> = {
  supplier: 'M3 3h10v10H3z',
  product: 'M8 1.5l5.6 3.25v6.5L8 14.5l-5.6-3.25v-6.5z',
  person: 'M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 0 1 0-13z',
  team: 'M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 0 1 0-13z',
  system: 'M2.5 2.5h11v11h-11z',
  rule: 'M8 1l7 7-7 7-7-7z',
  process: 'M3.5 2l10 6-10 6z',
  shipper: 'M4.5 4.5h7a3.5 3.5 0 0 1 0 7h-7a3.5 3.5 0 0 1 0-7z',
  other: 'M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 0 1 0-11z',
  source: 'M8 3a5 5 0 1 1 0 10A5 5 0 0 1 8 3z',
};

export function ShapeIcon({ kind, size = 11 }: { kind: Kind; size?: number }) {
  const color = TYPE_COLOR[kind];
  const hollow = kind === 'source';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden style={{ filter: `drop-shadow(0 0 3px ${color})` }}>
      <path d={SVG[kind]} fill={hollow ? 'none' : color} stroke={hollow ? color : 'none'} strokeWidth={hollow ? 2 : 0} strokeLinejoin="round" />
    </svg>
  );
}
