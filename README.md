# MonteCarlo Labs demo

A scripted prototype of the hackathon demo. Record a chore once with Trace, review the workflow built from it, test it on Windows VMs, read the report, then deploy it in shadow mode.

Everything runs on fake data, so it's safe to rehearse. The pieces are split so the real Trace recorder and Grokbot can replace the scripted parts later (see "Swapping in the real pieces").

## Run it (Windows, PowerShell, not WSL)

The tray icon and the separate Mailbox and ERP windows need native Windows, so run this outside WSL.

```powershell
npm install
npm run app:dev     # dev mode with hot reload
npm run app         # build once and run the built app (use this on stage)
```

Browser-only preview, no Electron: `npm run dev`, then open http://localhost:5173. In the browser, the tray and the two app windows are replaced by the desktop simulator (see below).

Needs Node 20 or newer.

## What's on screen

| Window | What it is |
|---|---|
| **MonteCarlo Labs** | The main app: Recordings, Workflows, Test runs, Reports, Deployments |
| **Trace** (system tray) | Behind the `^` "Show hidden icons" arrow. Start / Stop recording, open the app, open the mock apps |
| **Mailbox** | Mock email client with the supplier order email |
| **NorthStar ERP** | Mock ERP with the purchase order form |

Open Mailbox and NorthStar ERP from the tray menu or the link at the bottom of the app's sidebar. They tile left and right on the main screen.

## The 2-minute run

1. **Start Trace (0:00–0:05).** Click `^` in the taskbar, then Trace, then **Start recording**. Talk about the problem while you do it.
2. **Do the chore (0:05–0:25).** In Mailbox, open *Order confirmation for PO-4471*. Copy the PO number (double-click selects the whole value), switch to NorthStar ERP, click **New purchase order**, and fill Supplier, PO number, Item SKU, Quantity, Unit price and Delivery date by pasting or typing. Click **Save**. Stop recording from the tray. The app comes to the front.
3. **Recording and timeline (0:25–0:40).** The recording replays at 2x. Click a marker to show the exact element and its accessibility path. Meanwhile the Workflows tab shows it's building.
4. **Workflow (0:40–1:05).** Click a step's "From the recording" link to show the part of the recording it came from. Answer the question with **Ask me first** to add the price check, then click **Approve workflow**.
5. **Test in VM (1:05–1:30).** Click **Test in VM**, then **Run 6 tests**. Click a tile to watch that VM.
6. **Report (1:30–1:45).** Click **View the report**. Click the "Price went up 8.8%" row to show it paused for a buyer, as you asked.
7. **Shadow mode (1:45–2:00).** Click **Deploy in shadow mode** twice. The dashboard is labeled as a simulated first week.

If capture misses something (fewer than 6 actions or 2 filled fields), the app falls back to the built-in demo recording, which matches the steps above.

## Presenter controls

- **Ctrl+Shift+D** opens the demo controls: reset, load the demo recording, finish the build early, open the desktop simulator, and change build time (4s, 9s or 14s) and VM test speed (1x to 4x).
- **Ctrl+Shift+R** resets everything, including the Mailbox and ERP windows.
- **Esc** closes the controls or leaves the desktop simulator.
- Closing the main window hides it. Quit from the tray menu.

**Desktop simulator.** A full-screen fake Windows desktop with the same Mailbox, ERP and Trace tray inside the app. Use it in the browser, for rehearsing, or as a backup if the real windows misbehave on stage.

## What's real and what's scripted

| Part | Now | Later |
|---|---|---|
| Capture | Real clicks, typing, copy and paste in the mock apps, with accessibility names | Trace's event store and accessibility tree |
| Replay | Re-rendered from the captured events (no video) | Trace's screen recording, with the same markers on top |
| Workflow | Cached template; the values shown come from your recording | The workflow builder's output, in the same JSON shape |
| Test runs | Simulated agent runs, deterministic | Grokbot on real Windows VMs |
| Report | Computed from the simulated runs | Computed from real run results |
| Shadow mode | Simulated week, labeled as a preview | Real comparisons |

## Swapping in the real pieces

The contract between the pieces is in `src/data/schema.ts`:

- **Trace to recording.** Produce `TraceEvent[]`: `kind`, `t` (ms), `app`, `target` (`role`, `name`, `path` from the accessibility tree), and `value`. Feed it to `materialize()` in `src/data/desktop.ts` or replace the replay with a `<video>` plus the same `Timeline`.
- **Workflow builder.** Return a `Workflow` (nodes, edges, question). Each node's `source.tidPrefixes` links it back to the recording events it came from.
- **Grokbot test runs.** Return a `RunPlan` per variation: steps with start and end times, the outcome (`completed`, `paused`, `flagged`) and the values entered. The Tests and Reports screens read only that.

## Files

```
electron/main.cjs        Windows shell: main window, tray (Trace), Mailbox and ERP windows, message relay
electron/preload.cjs     Message bus bridge
src/data/                Schema, scenario (emails, variations), workflow layout, simulated runs, shadow data
src/lib/store.ts         App state: capture, build, edits, tests, deploy
src/lib/bus.ts           Message bus (Electron IPC, or BroadcastChannel in a browser)
src/components/          Mock desktop, Mailbox, ERP, replay player, timeline, flowchart
src/screens/             Recordings, Workflows, Tests, Reports, Deploy, desktop simulator
scripts/make-icons.cjs   Regenerates the PNG icons in assets/
```

All companies, people and email addresses in the demo are fictional.
