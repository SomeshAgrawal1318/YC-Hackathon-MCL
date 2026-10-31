// Icons: Phosphor, duotone by default so they read as layered glass; small inline marks are bold.
// The rest of the app imports these names, so swapping the set happens here only.
import {
  ArrowSquareOutIcon,
  CaretUpIcon,
  CheckIcon,
  ClockIcon,
  DesktopIcon,
  FilmStripIcon,
  FlagPennantIcon,
  FlowArrowIcon,
  GhostIcon,
  GraphIcon,
  HandPalmIcon,
  MonitorPlayIcon,
  PauseIcon,
  PlayIcon,
  QuestionIcon,
  ReceiptIcon,
  SparkleIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { Icon as PhIcon, IconWeight } from '@phosphor-icons/react';

type P = { size?: number; className?: string; weight?: IconWeight };

const make = (I: PhIcon, weight: IconWeight = 'duotone') =>
  function Icon({ size = 18, weight: w, ...p }: P) {
    return <I size={size} weight={w ?? weight} aria-hidden {...p} />;
  };

export const IconRecordings = make(FilmStripIcon);
export const IconWorkflow = make(FlowArrowIcon);
export const IconVm = make(MonitorPlayIcon);
export const IconReport = make(ReceiptIcon);
/** Shadow mode: the workflow runs alongside people without acting. */
export const IconDeploy = make(GhostIcon);
export const IconKnowledge = make(GraphIcon);
export const IconPlay = make(PlayIcon, 'fill');
export const IconPause = make(PauseIcon, 'fill');
export const IconCheck = make(CheckIcon, 'bold');
export const IconFlag = make(FlagPennantIcon, 'fill');
export const IconHand = make(HandPalmIcon, 'fill');
export const IconSpark = make(SparkleIcon, 'fill');
export const IconClock = make(ClockIcon, 'bold');
export const IconChevronUp = make(CaretUpIcon, 'bold');
export const IconQuestion = make(QuestionIcon, 'bold');
export const IconLink = make(ArrowSquareOutIcon, 'bold');
export const IconX = make(XIcon, 'bold');
export const IconDesktop = make(DesktopIcon);

/** The MonteCarlo Labs mark: a die showing five, cut from glass. */
export const Mark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="mark">
    <defs>
      <linearGradient id="mark-glass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#3a55d6" />
        <stop offset="1" stopColor="#1b2a8f" />
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#mark-glass)" />
    <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" fill="none" stroke="rgba(255,255,255,0.35)" />
    <g fill="#fff">
      <circle cx="10.5" cy="10.5" r="2" /><circle cx="21.5" cy="10.5" r="2" /><circle cx="16" cy="16" r="2" />
      <circle cx="10.5" cy="21.5" r="2" /><circle cx="21.5" cy="21.5" r="2" />
    </g>
  </svg>
);

/** Trace's tally light: grey at rest, red while recording (like a camera's). */
export const TraceGlyph = ({ recording, size = 16 }: { recording?: boolean; size?: number }) => (
  <span className={`tally${recording ? ' is-rec' : ''}`} style={{ width: size, height: size }} aria-hidden />
);
