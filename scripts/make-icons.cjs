// Renders the PNG icons in /assets from inline SVG. Needs `sharp` (npm i -D sharp) if you want to re-run it.
const path = require('node:path');
const sharp = require('sharp');

const out = (name) => path.join(__dirname, '..', 'assets', name);

const icons = {
  // Trace tray icon, idle: an outlined lens.
  'tray-idle.png': [64, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="22" fill="none" stroke="#8A97A8" stroke-width="7"/>
    <circle cx="32" cy="32" r="9" fill="#8A97A8"/></svg>`],
  // Trace tray icon, recording: solid red.
  'tray-rec.png': [64, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="22" fill="none" stroke="#FF5A4A" stroke-width="7"/>
    <circle cx="32" cy="32" r="12" fill="#FF5A4A"/></svg>`],
  // MonteCarlo Labs app icon: a die showing five, on navy.
  'icon.png': [256, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
    <rect x="16" y="16" width="224" height="224" rx="52" fill="#17202E"/>
    <rect x="58" y="58" width="140" height="140" rx="30" fill="#FFFFFF"/>
    <g fill="#2450D8"><circle cx="92" cy="92" r="13"/><circle cx="164" cy="92" r="13"/>
    <circle cx="128" cy="128" r="13"/><circle cx="92" cy="164" r="13"/><circle cx="164" cy="164" r="13"/></g></svg>`],
  'mail.png': [256, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
    <rect x="16" y="16" width="224" height="224" rx="48" fill="#5B4BC4"/>
    <rect x="56" y="80" width="144" height="100" rx="12" fill="none" stroke="#fff" stroke-width="14"/>
    <path d="M60 88 L128 140 L196 88" fill="none" stroke="#fff" stroke-width="14" stroke-linejoin="round"/></svg>`],
  'erp.png': [256, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
    <rect x="16" y="16" width="224" height="224" rx="48" fill="#0C6B63"/>
    <path d="M128 52 L146 110 L204 128 L146 146 L128 204 L110 146 L52 128 L110 110 Z" fill="#fff"/></svg>`],
};

(async () => {
  for (const [name, [size, svg]] of Object.entries(icons)) {
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(out(name));
    console.log('wrote', name);
  }
})();
