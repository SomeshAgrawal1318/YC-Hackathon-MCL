import { useEffect, useState } from 'react';
import { T, applyAction, initialDesktop } from '../data/desktop';
import { RECORDING_INBOX } from '../data/scenario';
import type { Action, DesktopState } from '../data/schema';
import { bus } from '../lib/bus';
import { MockErp } from './MockErp';
import { MockMail } from './MockMail';

/**
 * A mock app in its own OS window (Electron) or browser tab.
 * Every action goes to the MCL main window over the bus, which records it while Trace is on.
 */
export function MockWindow({ app }: { app: 'mail' | 'erp' }) {
  const [state, setState] = useState<DesktopState>(() => ({ ...initialDesktop(), focus: app }));

  useEffect(() => {
    document.title = app === 'mail' ? 'Mailbox' : 'NorthStar ERP';
    const onFocus = () => bus.send('trace:event', { kind: 'app_switch', app, target: T.task(app) } satisfies Action);
    window.addEventListener('focus', onFocus);
    const off = bus.on('demo:reset', () => setState({ ...initialDesktop(), focus: app }));
    return () => {
      window.removeEventListener('focus', onFocus);
      off();
    };
  }, [app]);

  const onAction = (a: Action) => {
    setState((s) => applyAction(s, a));
    bus.send('trace:event', a);
  };

  return (
    <div className={`standalone is-${app}`}>
      {app === 'mail' ? (
        <MockMail messages={RECORDING_INBOX} state={state.mail} interactive onAction={onAction} />
      ) : (
        <MockErp state={state.erp} interactive onAction={onAction} />
      )}
    </div>
  );
}
