import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 18): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
});

export const IconRecordings = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="5" width="13" height="14" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>
);
export const IconWorkflow = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="3" width="7" height="5" rx="1.2" /><rect x="14" y="16" width="7" height="5" rx="1.2" /><rect x="3" y="16" width="7" height="5" rx="1.2" /><path d="M6.5 8v8M6.5 12h11v4" /></svg>
);
export const IconVm = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
);
export const IconReport = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h5" /></svg>
);
export const IconDeploy = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 12h4l3-7 4 14 3-7h2" /></svg>
);
export const IconPlay = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} fill="currentColor" stroke="none"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
);
export const IconPause = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
);
export const IconCheck = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} strokeWidth={2.4}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const IconFlag = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>
);
export const IconHand = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
);
export const IconSpark = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></svg>
);
export const IconClock = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const IconChevronUp = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 15l6-6 6 6" /></svg>
);
export const IconQuestion = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14M12 17.5v.01" /></svg>
);
export const IconLink = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></svg>
);
export const IconX = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconDesktop = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="13" rx="1.5" /><path d="M3 14h18M9 20h6" /></svg>
);

/** The MonteCarlo Labs mark: a die showing five. */
export const Mark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--ink)" />
    <rect x="7" y="7" width="18" height="18" rx="4.5" fill="#fff" />
    <g fill="var(--agent)">
      <circle cx="11.5" cy="11.5" r="1.8" /><circle cx="20.5" cy="11.5" r="1.8" /><circle cx="16" cy="16" r="1.8" />
      <circle cx="11.5" cy="20.5" r="1.8" /><circle cx="20.5" cy="20.5" r="1.8" />
    </g>
  </svg>
);

/** Trace's tray icon. */
export const TraceGlyph = ({ recording, size = 16 }: { recording?: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
    <circle cx="32" cy="32" r="22" fill="none" stroke={recording ? '#FF5A4A' : '#C9D3DF'} strokeWidth="7" />
    <circle cx="32" cy="32" r={recording ? 12 : 9} fill={recording ? '#FF5A4A' : '#C9D3DF'} />
  </svg>
);
