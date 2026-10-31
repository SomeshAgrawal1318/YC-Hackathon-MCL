# MonteCarlo Labs demo

The hackathon demo, now on real apps. Record a chore once with Trace in real Gmail and a real ERP (Odoo), watch the recording with its timeline, review the workflow, run it on this PC against Gmail and Odoo, read the report, then deploy it in shadow mode.

- **Trace records for real.** `trace-helper.exe` hooks the mouse, keyboard shortcuts, window focus and the clipboard across Windows, and asks UI Automation which element each event touched (role, name, AutomationId, path, screen rectangle, value). The app records the screen as video at the same time. Raw keystrokes are never logged, and password fields are skipped.
- **The workflow is built from the recording plus the company's records.** The recording shows which email value goes into which Odoo field. What it can't show (a changed price, an email with no PO number) comes from the knowledge base (Dana's written rule) and the order history: past orders in Odoo matched to the supplier emails they came from (`src/data/history.ts`). The Workflows tab shows who answered each question, how well past orders back each step, and a backtest: the workflow's decisions on every past email next to what the buyer did. Only what neither answers is left as a question. **Export recording** saves the events, raw OS events and video for experiments.
- **Test runs are real.** The approved workflow runs **in Freestyle VMs** (one fresh Linux VM per test, all six at once, live screens on the Test runs tab) or **on this PC** (Chrome takes over Gmail and Odoo). It reads each test email, fills and saves a purchase order in Odoo (or pauses or flags it), and the report compares what Odoo has with what a careful buyer would enter.
- **Knowledge tab** builds an organisation knowledge base from Odoo (suppliers, products, last prices), every email in the Gmail inbox, and each Trace recording. Claude extracts the facts; each one links back to its source and a quote. An Obsidian-style graph, a list view and an Ask box sit on top. A learned price rule (Dana's "more than 5% needs my approval") can answer the workflow's price question.
- **Shadow mode and buyer approvals run on [Durable Actors](https://github.com/TerseAI/durable-actors)** (Terse's open-source stateful actors, in WSL next to Odoo). Shadow mode watches the demo inbox, drafts each new order without saving it, and compares the draft with the order the buyer entered in Odoo; the Deployments tab shows it live. The +8.8% test order waits on Dana's desk: **Approve** confirms it in Odoo, **Reject** cancels it, and a reminder note goes into Odoo if nobody answers. Both keep their state across app and server restarts. Without the actors server, shadow mode falls back to the simulated preview.

Plans: [docs/trace-plan-simple.md](docs/trace-plan-simple.md) (short) and [docs/trace-plan.md](docs/trace-plan.md) (build plan).

## One-time setup

Native Windows PowerShell (not WSL). Needs Node 20+, Google Chrome, WSL with Ubuntu-22.04, and Rust (MSVC) to build the helper.

```powershell
npm install
npm run odoo:setup      # installs PostgreSQL + Odoo 18 in WSL, creates database "mcl" with Purchase
npm run odoo:seed       # vendors, products and 13 past orders with the buyers' notes (sets the "last price" for each item)
npm run helper:build    # builds native/trace-helper (the Trace event sampler)
copy .env.example .env.local   # then fill in the Gmail lines and ANTHROPIC_API_KEY
npm run email:send -- --history   # once: the suppliers' emails for those past orders, which the workflow builder learns from
```

Gmail: make two free accounts, a demo buyer inbox and a "supplier". On the supplier account turn on 2-Step Verification and create an App password. Put both addresses and the App password in `.env.local`. Then open the app, click **Open Gmail and Odoo**, and sign in to the demo inbox once in the Chrome window on the left (it uses its own profile, `%LOCALAPPDATA%\mcl-demo-chrome`).

## Test VMs (Freestyle)

Plans: [docs/vm-plan-simple.md](docs/vm-plan-simple.md), [docs/vm-plan.md](docs/vm-plan.md). One-time setup:

1. `npx freestyle login`, then `npx freestyle tokens create "mcl-demo"` and put the key in `.env.local` as `FREESTYLE_API_KEY`.
2. Create an App password for the demo inbox account and put it in `.env.local` as `GMAIL_INBOX_APP_PASSWORD`. VMs read the test emails over IMAP rather than signing in to Gmail's website.
3. `npm run vm:image` (about 4 minutes) builds the image: Ubuntu, Google Chrome on a virtual screen (view-only noVNC, token-protected CDP), and Odoo 18 with the seed data. It writes `vm-image.json` (gitignored, holds the image's secrets).

Then pick **In VMs** on the Test runs screen. Each test boots a fresh VM from the image in about a second, with its own clean Odoo. VMs are deleted 10 minutes after a run, when the app quits, and by Freestyle after 40 minutes whatever happens.

## Durable Actors (shadow mode, Dana's approvals)

The actors live in `actors/` (a Bun project) and run in WSL, because the runtime has no Windows build. One-time setup:

```powershell
wsl -d Ubuntu-22.04 -u root -- apt-get install -y unzip
wsl -d Ubuntu-22.04 -- bash -lc "curl -fsSL https://bun.sh/install | bash"   # Bun 1.4.2+
npm run actors:dev        # installs actors/node_modules on first start, starts the server, generates actors/generated
```

Shadow mode reads the inbox with `GMAIL_INBOX_APP_PASSWORD` (the same App password as the test VMs). Without it, use **Inject a shadow email** in the presenter controls.

- `npm run actors:dev` starts the server on `http://127.0.0.1:7100` and leaves it running (the app also starts it if needed). Log: `~/.mcl-actors.log` in WSL. State: `~/.mcl-actors` in WSL.
- `npm run actors:stop` stops it. Do this after changing `.env.local`: the server reads its settings (`actors/.env`, written from `.env.local`) when it starts.
- `npm run actors:generate` after changing `actors/src` (the server reloads the code by itself; the app's client needs regenerating when methods change).
- `npm run actors:reset` stops the server and deletes all actor state.
- `wsl -d Ubuntu-22.04 -- bash -lc "cd /mnt/c/<path to repo>/actors && bunx durable-actors inspect"` lists the actors and their saved state; `bunx durable-actors observe` opens the runtime's observability UI.

If the runtime gets stuck ("activation session cannot be reused" in the log), the app restarts the server once by itself; `npm run actors:stop` then `npm run actors:dev` does the same by hand.

## Before each run

```powershell
npm run odoo:start                 # WSL stops Ubuntu when idle; this keeps Odoo up
npm run odoo:reset                 # removes purchase orders from earlier runs, keeps the seeded history and the buyer's shadow orders
npm run actors:dev                 # Durable Actors server in WSL (shadow mode, Dana's approvals)
npm run email:send                 # sends the team emails, the PO-4471 email and the 6 test emails to the demo inbox
npm run app                        # build once and run the app (use this on stage)
```

Send the shadow mode emails only after **Deploy in shadow mode**: `npm run email:send -- --shadow`. Shadow mode ignores everything already in the inbox when it starts.

`Start demo.cmd` does install, helper build, Odoo start, the actors server, build and launch in one go. `npm run app:dev` runs with hot reload.

## What's on screen

| Window | What it is |
|---|---|
| **MonteCarlo Labs** | The app: Recordings, Workflows, Test runs, Reports, Deployments |
| **Trace** (system tray) | Behind the `^` arrow. Start / Stop recording, Open Gmail and Odoo |
| **Gmail** (demo Chrome, left) | The demo inbox with the supplier emails |
| **Odoo** (demo Chrome, right) | Purchase app at `http://127.0.0.1:8069` (user admin / admin) |
| **Dana's approvals** | Tray → **Open Dana's approvals** (or the presenter controls). The buyer's view of the approval desk, live |

## The 2-minute run

1. **Start Trace (0:00–0:05).** Tray → **Start recording**. The sidebar counts events as they arrive.
2. **Do the chore (0:05–0:40).** In Gmail, open *Order confirmation for PO-4471*. Copy the PO number. In Odoo: **New**, pick the Vendor, paste the PO number into **Vendor Reference**, **Add a product** (HRC-2MM), set Quantity and Unit Price, set **Expected Arrival**, then **Save**. Tray → **Stop recording**. The app comes to the front.
3. **Recording and timeline (0:40–0:55).** The real screen video plays with the markers. Click a marker: the element is boxed on the video, with its accessibility path, AutomationId and position.
4. **Workflow (0:55–1:15).** The cards above the flowchart show what the recording couldn't show and who answered it: "Ask Dana Ortiz when the price is more than 5% off", from past orders (and Dana's rule, once synced). Click it for the evidence: PO-4433 (+6.4%) and PO-4452 (+7.4%) went to Dana; smaller changes were saved. The side panel's backtest reads "13 of 13 decisions match what buyers did". Try 10%: two rows turn red. Click a step's "From the recording" link, then **Approve workflow**. (Without a synced order history, answer the question with **Ask me first**.)
5. **Test on this PC (1:15–1:40).** Click **Run 6 tests** (or **Run this one** to keep it short on stage). Chrome takes over: Gmail search, read, Odoo fill, save. Expected: 4 saved, 1 asked a buyer (price +8.8%, a draft with a note in Odoo), 1 flagged (no PO number).
6. **Report and approval (1:40–1:50).** Click the "Price went up 8.8%" row: it is waiting for Dana. Open **Dana's approvals** next to it and click **Approve** there. The report updates at the same moment, and **Open … in Odoo** shows the order confirmed, with Dana's note.
7. **Shadow mode (1:50–2:00).** **Deploy in shadow mode**, then `npm run email:send -- --shadow` (or **Inject a shadow email** a few times). Within about 15 s the feed fills: 3 matched, 1 different (the buyer typed the wrong arrival date), 1 asked a buyer (+10.9%).

Before step 4 (or before recording): open **Knowledge** and click **Sync from Gmail and Odoo**. It reads the confirmed orders and their notes from Odoo and keeps the text of every supplier order email (over IMAP in one go when `GMAIL_INBOX_APP_PASSWORD` is set, otherwise in Gmail; no Claude key needed for these). Other emails go to Claude, and the graph grows as each is read. A build that runs after the sync answers the price question by itself; if you sync later, the price card offers the answer (**Use past orders** or **Use the rule**).

If capture misses the chore (fewer than 6 actions or 2 filled fields), the app shows the built-in demo recording instead.

## Presenter controls

- **Ctrl+Shift+D**: Trace status and a live feed of raw events, reset, Open Gmail and Odoo, finish the build early, run simulated tests, open Dana's approvals, inject a shadow email (feeds the next shadow mode email straight to the actor, for a slow inbox). Stage fallback: load the demo recording, open the mock Mailbox and ERP, or the desktop simulator.
- **Ctrl+Shift+R** resets everything, including shadow mode's results and Dana's desk. **Esc** closes the controls.
- Closing the main window hides it. Quit from the tray menu.

## What's real and what's scripted

| Part | Now | Later |
|---|---|---|
| Capture | Real: OS input events + UI Automation tree + screen video, from Gmail and Odoo | The same sampler inside `apps/trace` (`.evidence.json` next to each segment) |
| Replay | The real screen video with timeline markers and element boxes | Trace's segment video |
| Workflow | Template steps; field mappings from your recording, the price rule from the knowledge base or the order history, checked against past orders | Steps generated from the recording too, not just their settings |
| Test runs | Real: runs on this PC in Gmail and Odoo through Chrome | Grokbot on Windows VMs, same steps (`electron/hands.cjs`) |
| Report | Computed from the real runs and read back from Odoo | Same |
| Knowledge | Real: Odoo read directly; Gmail emails and recordings read by Claude (needs `ANTHROPIC_API_KEY`) | Slack/Teams via the monte-carlo connectors, on a schedule |
| Shadow mode | Real: a Durable Actor reads new inbox emails (IMAP), drafts each order and compares it with the buyer's Odoo entry, every 15 s. Simulated preview without the actors server | Weeks of real traffic; going live |
| Buyer approval | Real: a Durable Actor holds Dana's pending orders; Approve/Reject confirm or cancel them in Odoo, reminders after 2 min | Email or Slack to the approver |

## How the pieces fit

- `native/trace-helper/` (Rust): hooks + UI Automation → JSON lines on stdout. `npm run helper:print` prints events live, for checking what Trace sees.
- `electron/main.cjs`: starts the helper, labels each event Gmail / Odoo / other (from the page URL Chrome exposes), drops MCL's own clicks, records nothing while a test is running. Gives the app the screen for video.
- `src/data/normalize.ts` + `src/data/profiles.ts`: raw events → workflow actions (opened the email, copied a value, pasted into Vendor Reference, saved). A copied value takes the meaning of the field it is pasted into.
- `src/lib/runner.ts`: the workflow logic for a test run (read, decide, act). `electron/hands.cjs`: the actions on the real apps (Gmail search and read, Odoo fill, save, log note) plus Odoo lookups over JSON-RPC (`electron/odoo.cjs`).
- `src/data/extract.ts`: reads order values from email text; tested against all six test emails.
- `src/data/pastOrders.ts`: the order history (13 orders, Aug to Oct, with the buyers' notes) and the supplier emails behind them. `src/data/history.ts`: matches past emails to past orders, learns the price threshold and approver from what buyers did, and backtests the workflow. `src/lib/workflowBuilder.ts`: builds the workflow from the recording, the knowledge base and the history, and lists the questions with their evidence.
- `electron/knowledge.cjs`: the knowledge base (JSON in the app's data folder): Odoo sync, Gmail sync through the hands, Claude extraction with structured output (`claude-opus-5-5`, server-side fallbacks), Ask. `src/data/knowledge.ts`: graph data and the price rule. `src/screens/KnowledgeScreen.tsx`: graph (react-force-graph-2d), list, side panel.
- `actors/src/actors.ts`: the two Durable Actors. `ShadowDeployment/po-workflow` (alarm every `SHADOW_POLL_MS`, orders in its own SQLite table, totals and feed emitted to the app) and `ApprovalDesk/dana` (pending approvals, reminder alarm). `actors/src/odoo.ts` and `inbox.ts`: Odoo JSON-RPC and IMAP from WSL. `src/data/shadowCompare.ts`: the draft-and-compare logic, shared with the app and unit-tested; `src/data/shadowEmails.ts`: the shadow mode emails and the buyer's matching orders.
- `electron/actors.cjs`: starts the actors server in WSL, calls the actors for the app (IPC channel `actors`) and hands out WebSocket grants; `src/lib/actors.ts`: `useActorState` keeps an actor's state live in a screen. The dev runtime keeps alarms in memory, so the app re-arms them (`resume()`) whenever it connects.
- `scripts/`: Odoo setup, start, seed and reset; sending the emails; `actors-start.mjs` for the `actors:*` commands.

## Files

```
native/trace-helper/     Trace event sampler for Windows (Rust)
electron/main.cjs        Shell: main window, tray, helper, screen source, IPC
electron/hands.cjs       Actions on Gmail and Odoo during test runs (Playwright over CDP)
electron/chrome.cjs      The demo Chrome (own profile, debugging port, accessibility on)
electron/odoo.cjs        Odoo JSON-RPC client and the WSL keep-alive
src/data/                Schema, scenario, normalizer, profiles, extractor, workflow, simulated runs
src/lib/                 Store, runner, video, workflow builder slot, bus
src/screens/             Recordings, Workflows, Tests, Reports, Deploy, desktop simulator
scripts/                 Odoo setup/seed/reset, email sender
```

All companies, people and supplier addresses in the demo are fictional.
