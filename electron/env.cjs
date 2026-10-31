// Loads .env.local (KEY=value lines) from the repo root into a plain object.
// Values already set in the real environment win, so a shell can override any of them.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const DEFAULTS = {
  ODOO_URL: 'http://127.0.0.1:8069',
  ODOO_DB: 'mcl',
  ODOO_USER: 'admin',
  ODOO_PASSWORD: 'admin',
  WSL_DISTRO: 'Ubuntu-22.04',
  GMAIL_SENDER: '',
  GMAIL_APP_PASSWORD: '',
  GMAIL_INBOX: '',
  CHROME_PATH: '',
  CDP_PORT: '9222',
  ANTHROPIC_API_KEY: '',
  FREESTYLE_API_KEY: '',
  GMAIL_INBOX_APP_PASSWORD: '',
  ACTORS_URL: 'http://127.0.0.1:7100',
  SHADOW_POLL_MS: '15000',
  APPROVAL_REMIND_MS: '120000',
};

function loadEnv() {
  const env = { ...DEFAULTS };
  const file = path.join(ROOT, '.env.local');
  if (fs.existsSync(file)) {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      env[key] = value;
    }
  }
  for (const key of Object.keys(env)) if (process.env[key]) env[key] = process.env[key];
  return env;
}

module.exports = { loadEnv, ROOT };
