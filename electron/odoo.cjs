// Odoo JSON-RPC client, plus keeping the WSL instance (and so Odoo) running.
// Used by the Electron main process, the executor and the scripts in scripts/.

const { spawn } = require('node:child_process');
const { loadEnv } = require('./env.cjs');

class OdooError extends Error {}

function createOdoo(env = loadEnv()) {
  const base = env.ODOO_URL.replace(/\/$/, '');
  let uid = null;
  let seq = 0;

  async function rpc(service, method, args) {
    let res;
    try {
      res = await fetch(`${base}/jsonrpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++seq, params: { service, method, args } }),
      });
    } catch (e) {
      throw new OdooError(`Odoo is not reachable at ${base} (${e.cause?.code ?? e.message}). Start it with "npm run odoo:start".`);
    }
    const body = await res.json();
    if (body.error) {
      const msg = body.error.data?.message || body.error.message || 'Odoo error';
      throw new OdooError(msg);
    }
    return body.result;
  }

  async function login() {
    if (uid) return uid;
    uid = await rpc('common', 'authenticate', [env.ODOO_DB, env.ODOO_USER, env.ODOO_PASSWORD, {}]);
    if (!uid) throw new OdooError(`Odoo refused the login for "${env.ODOO_USER}" on database "${env.ODOO_DB}". Check ODOO_USER and ODOO_PASSWORD in .env.local.`);
    return uid;
  }

  async function call(model, method, args = [], kwargs = {}) {
    await login();
    return rpc('object', 'execute_kw', [env.ODOO_DB, uid, env.ODOO_PASSWORD, model, method, args, kwargs]);
  }

  return {
    base,
    login,
    call,
    searchRead: (model, domain, fields, opts = {}) => call(model, 'search_read', [domain], { fields, ...opts }),
    search: (model, domain, opts = {}) => call(model, 'search', [domain], opts),
    read: (model, ids, fields) => call(model, 'read', [ids], { fields }),
    create: (model, values) => call(model, 'create', [values]),
    write: (model, ids, values) => call(model, 'write', [ids, values]),
    unlink: (model, ids) => call(model, 'unlink', [ids]),
    /** Link to a record in the Odoo web client. */
    recordUrl: (model, id) => `${base}/web#id=${id}&model=${model}&view_type=form`,
  };
}

/** Is Odoo answering on its web port? */
async function isUp(env = loadEnv()) {
  try {
    const res = await fetch(`${env.ODOO_URL.replace(/\/$/, '')}/web/login`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

let keepAlive = null;

/**
 * WSL stops a distro when nothing on the Windows side keeps it open, and Odoo goes with it.
 * This starts PostgreSQL and Odoo and holds the distro open with a sleeping process.
 * detach=true leaves it running after this Node process exits (for npm scripts).
 */
async function ensureOdoo({ env = loadEnv(), detach = false, timeoutMs = 90000, log = () => {} } = {}) {
  if (process.platform !== 'win32' || (await isUp(env))) return isUp(env);
  if (!keepAlive || keepAlive.exitCode !== null) {
    log(`Starting Odoo in WSL (${env.WSL_DISTRO})…`);
    keepAlive = spawn(
      'wsl.exe',
      ['-d', env.WSL_DISTRO, '-u', 'root', '--', 'bash', '-c', 'systemctl start postgresql odoo; exec sleep infinity'],
      { detached: detach, stdio: 'ignore', windowsHide: true },
    );
    if (detach) keepAlive.unref();
  }
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await isUp(env)) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function stopKeepAlive() {
  if (keepAlive && keepAlive.exitCode === null) keepAlive.kill();
  keepAlive = null;
}

module.exports = { createOdoo, ensureOdoo, stopKeepAlive, isUp, OdooError };
