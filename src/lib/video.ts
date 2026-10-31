// Screen video for Trace, recorded in the main window while it is hidden.
// Electron hands getDisplayMedia the primary screen without a picker (see electron/main.cjs).

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let startedAt = 0;
let size = { width: 0, height: 0 };

/**
 * In Electron, ask for the primary screen by its desktopCapturer id: unlike getDisplayMedia this
 * works without a click in this window, so recording can start from the tray.
 */
async function captureScreen(): Promise<MediaStream> {
  const bridge = window.mclBridge;
  if (bridge?.invoke) {
    const sourceId: string | null = await bridge.invoke('trace:screen-source');
    if (sourceId) {
      const constraints = {
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxFrameRate: 15, minWidth: 640, maxWidth: 3840, maxHeight: 2160 } },
      } as unknown as MediaStreamConstraints;
      return navigator.mediaDevices.getUserMedia(constraints);
    }
  }
  return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
}

export async function startVideo(): Promise<boolean> {
  if (recorder) return true;
  try {
    stream = await captureScreen();
    const s = stream.getVideoTracks()[0].getSettings();
    size = { width: s.width ?? 0, height: s.height ?? 0 };
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    await new Promise<void>((resolve) => {
      rec.onstart = () => {
        startedAt = Date.now();
        resolve();
      };
      rec.start(1000);
    });
    recorder = rec;
    return true;
  } catch (e) {
    console.warn('Trace: screen video unavailable', e);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    return false;
  }
}

export interface VideoResult {
  blob: Blob;
  url: string;
  startedAt: number;
  width: number;
  height: number;
}

export async function stopVideo(): Promise<VideoResult | null> {
  const rec = recorder;
  if (!rec) return null;
  recorder = null;
  await new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
    rec.stop();
  });
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
  chunks = [];
  if (!blob.size) return null;
  return { blob, url: URL.createObjectURL(blob), startedAt, ...size };
}

export const videoRecording = () => !!recorder;
