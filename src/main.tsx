import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { App } from './App';
import { getState } from './lib/store';
import './styles.css';

// Read-only handle for debugging from DevTools: mcl.getState()
(window as unknown as { mcl: unknown }).mcl = { getState };

// In the desktop app on Windows the window is acrylic glass: let it show through.
if (window.mclBridge && /Windows/.test(navigator.userAgent) && !/#\/(mail|erp|dana)$/.test(location.hash)) {
  document.documentElement.classList.add('glass');
}

createRoot(document.getElementById('root')!).render(<App />);
