import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built app loads from Electron's app:// protocol as well as a web server.
export default defineConfig({
  base: './',
  plugins: [react()],
});
