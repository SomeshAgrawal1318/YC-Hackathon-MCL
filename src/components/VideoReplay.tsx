import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RecordingVideo, TraceEvent } from '../data/schema';

interface Props {
  video: RecordingVideo;
  events: TraceEvent[];
  /** Playhead in recording time (ms). */
  t: number;
  playing: boolean;
  speed: number;
  /** The event picked on the timeline: its element stays boxed. */
  selected?: TraceEvent | null;
  className?: string;
}

/** How long an event's element stays boxed during playback. */
const BOX_MS = 1400;

/**
 * Plays Trace's screen video in step with the timeline playhead and boxes the element each event
 * touched, using the UI Automation rectangle (physical pixels) placed on the recorded display.
 */
export function VideoReplay({ video, events, t, playing, speed, selected, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const vw = video.width || video.display.width;
  const vh = video.height || video.display.height;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const k = Math.min(r.width / vw, r.height / vh);
      if (k > 0) setSize({ w: Math.floor(vw * k), h: Math.floor(vh * k) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vw, vh]);

  // MediaRecorder files carry no duration, so Chrome can't seek until it has scanned to the end once.
  const onMeta = () => {
    const v = ref.current;
    if (!v) return;
    if (Number.isFinite(v.duration)) return setReady(true);
    const done = () => {
      v.removeEventListener('timeupdate', done);
      v.currentTime = 0;
      setReady(true);
    };
    v.addEventListener('timeupdate', done);
    v.currentTime = 1e101;
  };

  useEffect(() => {
    const v = ref.current;
    if (!v || !ready) return;
    const target = Math.max(0, (t + video.offsetMs) / 1000);
    v.playbackRate = speed;
    if (playing) {
      if (v.paused) v.play().catch(() => undefined);
      if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
    }
  }, [t, playing, speed, ready, video.offsetMs]);

  let current: TraceEvent | null = selected ?? null;
  if (!current) {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.t > t) continue;
      if (t - (e.t + (e.dur ?? 0)) < BOX_MS && e.target?.rect && e.kind !== 'app_switch') current = e;
      break;
    }
  }
  const rect = current?.target?.rect;
  const d = video.display;
  const boxStyle = rect && size.w
    ? {
        left: ((rect[0] - d.x) / d.width) * size.w - 3,
        top: ((rect[1] - d.y) / d.height) * size.h - 3,
        width: (rect[2] / d.width) * size.w + 6,
        height: (rect[3] / d.height) * size.h + 6,
      }
    : null;
  const offScreen = rect && (rect[0] + rect[2] < d.x || rect[0] > d.x + d.width || rect[1] > d.y + d.height);

  return (
    <div ref={box} className={`vreplay ${className ?? ''}`}>
      <div className="vreplay-inner" style={{ width: size.w, height: size.h }}>
        <video ref={ref} src={video.url} muted playsInline preload="auto" onLoadedMetadata={onMeta} />
        {boxStyle && !offScreen && (
          <div className={`vbox is-${current!.kind}${selected ? ' is-selected' : ''}`} style={boxStyle}>
            <span>{current!.target!.name}</span>
          </div>
        )}
        {!ready && <div className="vreplay-wait"><i className="spinner is-light" /> Loading the screen video</div>}
      </div>
    </div>
  );
}
