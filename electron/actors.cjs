// The Durable Actors backend (actors/, runs in WSL next to Odoo): starts it, and calls the two actors
// for the app. The renderer can't reach the actors server directly (no CORS), so it asks here, over
// IPC, for method calls and for WebSocket grants, then opens the socket itself.
//
// ShadowDeployment/po-workflow: real shadow mode.  ApprovalDesk/dana: price changes waiting for Dana.

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { loadEnv, ROOT } = require('./env.cjs');

const ACTORS_DIR = path.join(ROOT, 'actors');
const GENERATED = path.join(ACTORS_DIR, 'generated', 'index.js');
const SHADOW_ID = 'po-workflow';
const APPROVER_ID = 'dana';

/** C:\Users\x\repo → /mnt/c/Users/x/repo */
function toWsl(p) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(path.resolve(p));
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/');
}

async function isUp(env = loadEnv()) {
  try {
    await fetch(env.ACTORS_URL, { signal: AbortSignal.timeout(2000) });
    return true; // any HTTP answer (the root path is a 404) means the server is listening
  } catch {
    return false;
  }
}

/** actors/.env: the settings the actors read (Bun loads it when the server starts). */
function writeActorsEnv(env) {
  const keys = ['ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_PASSWORD', 'GMAIL_INBOX', 'GMAIL_INBOX_APP_PASSWORD', 'SHADOW_POLL_MS', 'APPROVAL_REMIND_MS'];
  const lines = ['# Written by electron/actors.cjs from .env.local. Restart the actors server after changes (npm run actors:stop).'];
  for (const k of keys) lines.push(`${k}=${env[k] ?? ''}`);
  fs.writeFileSync(path.join(ACTORS_DIR, '.env'), lines.join('\n') + '\n');
}

function wsl(env, args, opts = {}) {
  return spawnSync('wsl.exe', ['-d', env.WSL_DISTRO, '--exec', ...args], { encoding: 'utf8', windowsHide: true, ...opts });
}

/** Regenerates actors/generated (the typed client) from the running server. */
function generate(env = loadEnv()) {
  const script = `export PATH="$HOME/.bun/bin:$PATH"; cd '${toWsl(ACTORS_DIR)}' && bunx durable-actors generate`;
  const r = wsl(env, ['bash', '-c', script], { timeout: 180000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.replace(/\0/g, '').trim();
  if (r.status !== 0) throw new Error(`Could not generate the actors client: ${out || r.error?.message || 'unknown error'}`);
  return out;
}

/**
 * Starts the actors server in WSL if it isn't up, and waits for it. The server keeps running after
 * the app quits (like Odoo); "npm run actors:stop" stops it.
 */
async function ensureActors({ env = loadEnv(), timeoutMs = 120000, log = () => {} } = {}) {
  if (await isUp(env)) return true;
  if (process.platform !== 'win32') return false;
  if (!fs.existsSync(path.join(ACTORS_DIR, 'package.json'))) throw new Error('The actors/ project is missing.');
  writeActorsEnv(env);
  log('Starting the Durable Actors server in WSL…');
  const child = spawn('wsl.exe', ['-d', env.WSL_DISTRO, '--exec', 'bash', toWsl(path.join(ROOT, 'scripts', 'wsl', 'actors-dev.sh'))], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await isUp(env)) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function stopActors(env = loadEnv()) {
  wsl(env, ['pkill', '-f', 'durable-actors'], { timeout: 20000 });
}

function createActors({ broadcast = () => {} } = {}) {
  let client = null;
  let starting = null;

  async function ready() {
    const env = loadEnv();
    if (!starting) starting = ensureActors({ env }).finally(() => { starting = null; });
    if (!(await starting)) throw new Error('The actors server is not running. Start it with "npm run actors:dev".');
    if (!client) {
      if (!fs.existsSync(GENERATED)) generate(env);
      process.env.DURABLE_ACTORS_CONTROL_PLANE_URL = env.ACTORS_URL;
      client = (await import(pathToFileURL(GENERATED).href)).actors;
    }
    return client;
  }

  /** Retries briefly: right after a start or a code change the actors may still be building. */
  async function withActors(fn) {
    let last;
    for (let i = 0; i < 4; i++) {
      try {
        return await fn(await ready());
      } catch (e) {
        last = e;
        if (/not running/.test(e.message)) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw last;
  }

  const shadow = (a) => a.ShadowDeployment.get(SHADOW_ID);
  const desk = (a) => a.ApprovalDesk.get(APPROVER_ID);

  const ops = {
    status: async () => ({ up: await isUp(), url: loadEnv().ACTORS_URL }),
    /** A WebSocket URL for one actor; the renderer opens it and gets the actor's emitted state. */
    grant: ({ actor, id }) => withActors(async (a) => {
      if (!['ShadowDeployment', 'ApprovalDesk'].includes(actor)) throw new Error(`Unknown actor ${actor}`);
      // Alarms live in the dev runtime's memory: re-arm them whenever the app connects.
      await (actor === 'ShadowDeployment' ? shadow(a) : desk(a)).resume().catch(() => undefined);
      const g = await a[actor].prepareWebsocket({ actorId: id, metadata: null });
      return { websocketUrl: g.websocketUrl, connectByMs: g.connectByMs };
    }),
    shadowDeploy: ({ edits }) => withActors((a) => shadow(a).deploy({ answer: edits.answer, threshold: edits.threshold, mappings: edits.mappings })),
    shadowInject: ({ email }) => withActors((a) => shadow(a).ingest(email)),
    shadowReset: () => withActors((a) => shadow(a).reset()),
    approvalOpen: (request) => withActors((a) => desk(a).open(request)),
    approvalDecide: ({ poId, decision, by }) => withActors((a) => desk(a).decide(poId, decision, by || 'Dana Ortiz')),
    approvalClear: () => withActors((a) => desk(a).clear()),
  };

  async function exec(op, args = {}) {
    const fn = ops[op];
    if (!fn) throw new Error(`Unknown actors operation: ${op}`);
    return fn(args || {});
  }

  /** On app start: make sure the server runs and re-arm the alarms (lost when the server restarts). */
  async function warmUp() {
    try {
      await withActors(async (a) => {
        await shadow(a).resume();
        await desk(a).resume();
      });
      broadcast('actors:status', { up: true });
    } catch (e) {
      broadcast('actors:status', { up: false, message: e.message });
    }
  }

  return { exec, warmUp };
}

module.exports = { createActors, ensureActors, stopActors, generate, isUp, toWsl, ACTORS_DIR };
