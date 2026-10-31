import { useEffect, useRef, useState } from 'react';

/** Re-render every animation frame while active; returns Date.now() of the frame. */
export function useFrameClock(active: boolean, fps = 60): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    const step = (ts: number) => {
      if (ts - last >= 1000 / fps - 1) {
        last = ts;
        setNow(Date.now());
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, fps]);
  return now;
}

/** A playhead over [0, duration] with play/pause/seek. */
export function usePlayback(duration: number, speed: number, autoplay: boolean, resetKey: string) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const tRef = useRef(0);
  tRef.current = t;

  const autoRef = useRef(autoplay);
  autoRef.current = autoplay;
  useEffect(() => {
    setT(0);
    setPlaying(autoRef.current);
  }, [resetKey]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    const step = (now: number) => {
      const dt = now - prev;
      prev = now;
      const next = tRef.current + dt * speed;
      if (next >= duration) {
        setT(duration);
        setPlaying(false);
        return;
      }
      setT(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration]);

  return {
    t,
    playing,
    play: () => {
      if (tRef.current >= duration - 1) setT(0);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    seek: (ms: number) => setT(Math.max(0, Math.min(duration, ms))),
  };
}

/** Loops t through [start, end] with a short hold at the end. */
export function useLoop(range: [number, number] | null, speed = 1.25, hold = 900): number {
  const [t, setT] = useState(range ? range[0] : 0);
  useEffect(() => {
    if (!range) return;
    const [a, b] = range;
    const span = (b - a) / speed + hold;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = (now - t0) % span;
      setT(Math.min(b, a + k * speed));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [range?.[0], range?.[1], speed, hold]);
  return t;
}
