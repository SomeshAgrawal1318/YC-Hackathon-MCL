# Test runs in Freestyle VMs: build plan

## Context

`Test on this PC` drives the local demo Chrome through `electron/hands.cjs` (Playwright over CDP), one variation at a time, and reads results back from the local Odoo in WSL. The workflow logic (`src/lib/runner.ts`) only talks to the hands through `exec(op, args)`, so the hands can be swapped for a remote browser without touching the logic.

Freestyle provides Linux microVMs (~65 ms boot, snapshots, live clone, per-port public HTTPS domains). Its Chromium guide builds a headed Chrome (Xvfb + openbox), x11vnc + noVNC on port 6080, and an nginx proxy on port 9333 for CDP, all as systemd units baked into a snapshot. External clients connect with `chromium.connectOverCDP(wss://<cdp-domain>/...)`. Sources: [Chromium guide](https://www.freestyle.sh/docs/guides/run-chromium-and-chrome-in-a-sandbox), [Quickstart](https://www.freestyle.sh/docs/quickstart.md), [Pricing](https://www.freestyle.sh/pricing).

Goal: a **Test in VMs** mode. It starts one VM per variation from a prebuilt snapshot (Chrome + Odoo 18 + seed data), runs all 6 in parallel, streams each VM's screen to the Tests tab, judges results from each VM's Odoo, and cleans up. `Test on this PC` stays as the fallback.

## Key decisions

- **Email in VMs: IMAP, not the Gmail website.** Six simultaneous Gmail web sign-ins from datacenter IPs risk Google challenges on stage, and a snapshotted session would carry the same cookies into every VM. Instead, Electron main fetches the variation email from the demo inbox over IMAP with the customer account's App password (`imapflow`). It then renders the email as a plain page in that VM's Chrome (`page.setContent`), so the screen still shows the email being read. The extraction (`src/data/extract.ts`) is unchanged. The Gmail website in VMs stays a later experiment.
- **Odoo per VM, baked into the snapshot.** Each VM gets a clean, already-seeded Odoo, so tests are isolated and parallel. Chrome inside the VM uses `http://localhost:8069`. The host reaches each VM's Odoo for RPC (last price, read-back) through a per-VM public domain on port 8069. The admin password is random per image, never `admin`.
- **Exposed ports are protected.** The guide's CDP and noVNC endpoints have no auth. Per VM:
  - random unguessable `*.style.dev` subdomains;
  - nginx requires a per-image secret token for CDP: a `?token=` query or header, checked with `if ($arg_token != "...") { return 403; }`;
  - x11vnc runs `-viewonly` with a password;
  - VMs are deleted after the run (10-minute grace for report links).
- **Snapshot availability.** The pricing page lists snapshots under Free but also says "Persistent VMs and snapshots are available on Hobby and Pro only". Phase 0 checks this on the real account. If Free lacks snapshots, recommend Hobby ($50/mo); installing Odoo per boot (several minutes) is not viable for a demo.

## Phase 0: spike (1–2 h)

- `scripts/vm-spike.ts` (vite-node):
  1. Create a VM, install Chromium headed + noVNC + nginx per the guide.
  2. `connectOverCDP` from Node, open a page, take a screenshot.
  3. Open the noVNC URL in a browser.
  4. Try `vm.snapshot()` and create a VM from it.
  5. Measure each step.
- Record: snapshot allowed on this plan, boot-from-snapshot time, CDP latency from the PC, noVNC usability inside an `<iframe>` from `app://mcl`. Decide on Hobby if needed.

### Phase 0 results (2026-10-31, `npm run vm:spike`)

| Step | Time |
|---|---|
| Create a VM | 0.7 s |
| Install Chrome + Xvfb/openbox/x11vnc/noVNC/nginx | 81 s (image build only) |
| Start services | 3.3 s |
| Drive Chrome over CDP from the PC | 0.7 s |
| Snapshot | 0.6 s, **allowed on the Free plan** |
| Boot from snapshot | 0.3 s, Chrome drivable 0.7 s later |

Findings that change the build:
- **Image:** the default is **Ubuntu 24.04** with 4 vCPU / 8 GiB / 32 GiB, not Debian. Ubuntu's `chromium` is a snap stub, so install the Google Chrome `.deb`.
- **User:** `vm.exec` runs as the uid-1000 user by default. Setup must pass `linuxUser: 'root'` and check `statusCode` (a failed `systemd-run` otherwise looks like a hang).
- **Token:** CDP without the token returns 403.
- **Live screen:** noVNC's full `vnc.html` fails inside an `<iframe>` (third-party `localStorage` is denied). **`vnc_lite.html` works embedded** (`?scale=true&path=websockify&password=...`). Use it for the tiles.
- **Chrome:** add `--test-type` to hide the "--no-sandbox" infobar.
- **Plan:** no Hobby plan needed.

## Phase 1: the VM image

`scripts/vm-build-image.ts` (vite-node), run once with `npm run vm:image`:

1. Builder VM (`idleTimeoutSeconds: null`, firewall: allow public egress). Use the guide's `runSetup` pattern (systemd-run plus a done-marker) for long installs.
2. Packages: Google Chrome (`.deb`, Ubuntu 24.04 image) + the headed stack (`xvfb openbox x11vnc novnc websockify xauth x11-utils dbus-x11 nginx`), PostgreSQL, Odoo 18 (nightly deb repo, Debian 12).
3. Systemd units from the guide: xvfb at 1440x900, openbox, chromium-headed (CDP on 127.0.0.1:9222, start URL `http://localhost:8069/odoo/purchase`), x11vnc (`-viewonly -rfbauth`), novnc on 6080, nginx on 9333 with the token check, odoo on 8069 with `dbfilter=^mcl$`, `list_db=False` and a random `admin_passwd`.
4. Create db `mcl` with `purchase` and no demo data, set a random admin password, then seed. The seed reuses `scripts/odoo-seed.ts` logic pointed at the builder's Odoo domain (refactor its `createOdoo` call to take a URL and credentials).
5. Log Chrome into Odoo once, so the session cookie is in the profile (Odoo only, no Google accounts).
6. Readiness check (CDP `/json/version`, noVNC page, Odoo `/web/login`), then `vm.snapshot()` and `builder.delete()`.
7. Write `vm-image.json` (gitignored): `snapshotId`, `cdpToken`, `vncPassword`, `odooAdminPassword`, created date.

## Phase 2: VM lifecycle (`electron/vms.cjs`)

- `startTestVm(label)`:
  1. `freestyle.vms.create({ snapshotId, firewall, idleTimeoutSeconds: 900 })`.
  2. Three `freestyle.tls.rules.create` routes with random subdomains: 6080 (noVNC), 9333 (CDP), 8069 (Odoo RPC).
  3. Poll readiness and return `{ vmId, cdpUrl, vncUrl, odooRpcUrl }`.
- `stopVm(vmId)` deletes the VM and its TLS rules. `stopAll()` runs on app quit and 10 minutes after a run.
- Errors are reported in plain words ("Freestyle refused: plan allows 10 VMs"), and the run falls back with an offer to use `Test on this PC`.
- Env: `FREESTYLE_API_KEY`, `GMAIL_INBOX_APP_PASSWORD`. Add `freestyle` and `imapflow` to dependencies.

## Phase 3: hands for a VM

Refactor `createHands(env, opts)` to take a target:
`{ kind: 'local' } | { kind: 'vm', cdpUrl, odooBrowserUrl: 'http://localhost:8069', odooRpc: { url, db, user, password }, mail: 'imap' }`.

- `getPages()`: for a VM, connect to `cdpUrl` (rewrite `ws://127.0.0.1:9222` to `wss://<cdp-domain>` as in the guide, add the token) and use the existing page for Odoo plus a second tab for mail. No window placement or `ensureWide` is needed, since the VM screen is fixed at 1440x900.
- `gmailOpen({ subject })` in VM mode:
  1. `imapflow` search `SUBJECT "<subject>"` in INBOX, then `[Gmail]/Spam` as a fallback.
  2. Parse the text body.
  3. `page.setContent()` renders a simple email view (from, subject, body) in the mail tab.
  4. Return `{ text, from, shot }`.
- `gmailFlag`: IMAP `\Flagged` on the message (a star in Gmail), which is a real effect on the inbox.
- Odoo ops reuse the existing selectors unchanged, against `odooBrowserUrl`. `odooLastPrice` and `odooReadPo` use `createOdoo(odooRpc)`. `recordUrl` points at the VM's Odoo domain.
- `prepare` in VM mode returns vendors and SKUs from the VM's Odoo. No Gmail sign-in check is needed.

## Phase 4: runner and store

- `runInVms(wf, variations, cb)` in `src/lib/runner.ts`:
  1. Ask main to start N VMs in parallel (`hands:vm-start` returns per-run handles).
  2. Run `runOne` for every variation concurrently, each with an `exec` bound to its VM (`invoke('hands', op, args, runId)`).
  3. `runOne` and `judge` stay as they are.
- Main keeps a `Map<runId, hands>`. `ipcMain.handle('hands', (e, op, args, runId))` routes to the right instance; no runId means local.
- Store: `tests.mode` becomes `'pc' | 'vm' | 'simulated'`. `LiveRun` gains `vm?: { vncUrl, odooUrl, bootMs }`. `runTests(only?, mode)`. Remember the last mode the user picked.
- Trace: nothing to ignore in VM mode (no local input), but keep the `executing` flag for PC mode only.

## Phase 5: screens

- Tests: a mode switch, `On this PC` / `In VMs`, with VMs as the default when `FREESTYLE_API_KEY` and `vm-image.json` exist.
  - The VM grid returns. Each tile is a view-only noVNC `<iframe>` (`vnc_lite.html?scale=true&path=websockify&password=...`), with "Starting VM…" and the measured boot time until ready.
  - The focus panel shows the selected VM large.
  - Each tile falls back to the latest CDP screenshot if the iframe fails.
- Report: unchanged maths. "Open in Odoo" uses the VM's Odoo domain, labeled "available for 10 minutes". Step screenshots are kept.
- README and the simple plan: setup steps (`npm run vm:image`), the stage run, and fallbacks.

## Files

New: `scripts/vm-spike.ts`, `scripts/vm-build-image.ts`, `electron/vms.cjs`, `electron/mail-imap.cjs`, `vm-image.json` (gitignored).
Changed: `electron/hands.cjs` (target option, IMAP mail ops), `electron/main.cjs` (VM IPC, cleanup on quit), `electron/odoo.cjs` (explicit target), `scripts/odoo-seed.ts` (target URL), `src/lib/runner.ts`, `src/lib/store.ts`, `src/data/schema.ts`, `src/screens/TestsScreen.tsx`, `src/screens/ReportsScreen.tsx`, `src/lib/bus.ts`, `electron/preload.cjs`, `.env.example`, `.gitignore`, `package.json` (`vm:image`, `vm:spike`), `README.md`.
Reused: `runOne`, `judge`, `expectedOutcome`, `extract.ts`, the Odoo selectors and waits in `hands.cjs`, `odoo-seed.ts` data.

## Verification

1. **Spike:** CDP screenshot from a VM, noVNC visible in an iframe from the app, snapshot create and boot timed. Plan decision recorded.
2. **Image:** a VM from the snapshot shows Odoo purchase at 1440x900, logged in. RPC to its Odoo domain returns the 4 seeded orders. CDP without the token is refused (403), and noVNC is view-only.
3. **IMAP:** fetching each of the 6 subjects returns text, and `extract.ts` yields `variation.expected` for all 6 (reuse the Gmail-texts fixture comparison).
4. **One VM run:** `Run this one` in VM mode gives the same outcome and read-back as PC mode.
5. **Full run:** 6 VMs in parallel give 4 saved, 1 paused (note in that VM's chatter), 1 flagged (starred in Gmail), and 6 of 6 as expected. Record wall-clock time, which should beat the ~58 s sequential PC run.
6. **Cleanup:** VMs are gone 10 minutes after the run and on app quit (check `freestyle vm list`).
7. **Fallbacks:** a wrong API key or plan limit gives a clear message plus "Run on this PC". PC mode is unchanged (6 of 6).
