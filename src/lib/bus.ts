// One message bus for every window.
// In Electron it relays through the main process (see electron/preload.cjs).
// In a browser it uses BroadcastChannel, so separate tabs for #/mail and #/erp also work.

interface Msg {
  channel: string;
  data: unknown;
  from: string;
}

interface Bridge {
  isElectron: true;
  send: (msg: Msg) => void;
  onMessage: (cb: (msg: Msg) => void) => void;
}

declare global {
  interface Window {
    mclBridge?: Bridge;
  }
}

const ID = Math.random().toString(36).slice(2);
type Listener = (data: any) => void;
const listeners = new Map<string, Set<Listener>>();

function deliver(msg: Msg) {
  listeners.get(msg.channel)?.forEach((l) => l(msg.data));
}

const bridge = typeof window !== 'undefined' ? window.mclBridge : undefined;
let channel: BroadcastChannel | null = null;

if (bridge) {
  bridge.onMessage((m) => {
    if (m.from !== ID) deliver(m);
  });
} else if (typeof BroadcastChannel !== 'undefined') {
  channel = new BroadcastChannel('mcl-bus');
  channel.onmessage = (e) => {
    const m = e.data as Msg;
    if (m && m.from !== ID) deliver(m);
  };
}

export const isElectron = !!bridge;

export const bus = {
  /** Deliver to listeners in this window and every other window. */
  send(channelName: string, data: unknown = null) {
    const msg: Msg = { channel: channelName, data, from: ID };
    deliver(msg);
    bridge?.send(msg);
    channel?.postMessage(msg);
  },
  on(channelName: string, l: Listener) {
    if (!listeners.has(channelName)) listeners.set(channelName, new Set());
    listeners.get(channelName)!.add(l);
    return () => {
      listeners.get(channelName)?.delete(l);
    };
  },
};
