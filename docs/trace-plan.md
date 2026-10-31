# Trace on real apps: build plan

## Context

`Desktop/mcl-hackathon-demo` fakes everything. Mock Mailbox and ERP windows report their own clicks over the bus (`src/components/MockWindow.tsx` → `trace:event` → `record()` in `src/lib/store.ts`). The replay is re-drawn (`ReplayPlayer`), and test runs are simulated against the mocks (`src/data/runs.ts`).

The real Trace (`Desktop/monte-carlo/apps/trace`, Rust) records only video. The user's research brief says Trace should also record input events and the accessibility tree.

Target: real capture (events + UIA + video) on real Gmail and Odoo, and real playback with markers. Workflow creation stays the predefined template, behind a seam for the user's experiments. Workflow execution drives the real apps on this PC through Chrome. Shadow mode stays simulated.

## Architecture

```
 Chrome, demo profile  (--user-data-dir, --force-renderer-accessibility, --remote-debugging-port=9222)
   ├─ Gmail (demo inbox)       ◀── scripts/send-emails.mjs (recording email + 6 test emails)
   └─ Odoo  (localhost:8069)   ◀── scripts/odoo-seed.mjs (vendors, products, last prices; --reset)

 CAPTURE   trace-helper.exe ──JSON lines──▶ electron/main.cjs ──bus trace:raw──▶ store → normalize() → Recording
           (hooks + UIA + clipboard)        tags app by window title           + screen video (desktopCapturer)

 PLAYBACK  RecordingsScreen: VideoReplay (<video> on usePlayback clock) + Timeline markers + UIA box overlay

 WORKFLOW  buildWorkflow(edits) as today (predefined) ← seam: workflowFromRecording(rec) returns the template
           Export recording → userData/exports/<id>/{recording.json, video.webm}

 EXECUTE   electron/executor.cjs ──CDP (playwright-core)──▶ the same Chrome: Gmail search → read body →
           extract → Odoo New RFQ → fill → price check (Odoo JSON-RPC) → save / log note / flag
           ──bus runs:step──▶ TestsScreen cards; results read back from Odoo → ReportsScreen
```

## Phase 0: environment

- **Odoo in WSL**: `scripts/wsl/odoo-setup.sh`, run as `wsl -d Ubuntu-22.04 -u root bash scripts/wsl/odoo-setup.sh` (no sudo password needed). It installs postgresql and Odoo (nightly apt repo, 18.0 or the newest that installs on 22.04), creates the db `mcl` without demo data, installs `purchase`, and sets the admin password from `.env.local`. `npm run odoo:start` starts both services.
- **`electron/odoo.cjs`**: JSON-RPC client (`/jsonrpc`, `execute_kw`: login, searchRead, create, write, read). It's shared by the seed script, the executor's price lookup and the read-back.
- **`scripts/odoo-seed.mjs`**: vendors (Ridgeline Steel Co., Brightwater Plastics, Fernwood Fasteners) and products by `default_code` (HRC-2MM, HRC-3MM, PP-PEL-25, HXB-M8-40). Past confirmed POs set `LAST_PRICE` and match `RECENT_POS` (`src/data/scenario.ts`). `--reset` deletes POs with `origin` in (`MCL demo`, `MCL test`) or created after seeding.
- **`scripts/send-emails.mjs`** (`nodemailer`): sends `RECORDED_EMAIL` and the 6 `VARIATIONS` from the supplier account to the demo inbox via SMTP and an app password, with bodies rendered from the existing `BodyPart`s. Flags: `--recording`, `--tests`.
- **`.env.local`** (gitignored, created with blanks): `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_PASSWORD`, `GMAIL_SENDER`, `GMAIL_APP_PASSWORD`, `GMAIL_INBOX`, optional `CHROME_PATH`.
- **Chrome launcher** in `electron/main.cjs`: tray item and sidebar link "Open Gmail and Odoo". It launches Chrome with the demo profile and flags above: two windows, Gmail left, Odoo Purchase right. The tray and sidebar entries for the mock apps go away.

## Phase 1: capture

**`native/trace-helper/`** (Rust; the MSVC toolchain is installed; it ports to `apps/trace` later):
- `windows` crate (`Win32_UI_WindowsAndMessaging`, `Win32_UI_Accessibility`, `Win32_System_Com`, `Win32_System_DataExchange`, `Win32_UI_Input_KeyboardAndMouse`, `Win32_UI_HiDpi`, `Win32_Foundation`), `serde`, `serde_json`.
- Hook thread with a message loop: `WH_MOUSE_LL` (down, point, double-click), `WH_KEYBOARD_LL` (shortcuts Ctrl+C/V/S, Enter, Tab, plus a key-free "typed" ping), `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`, and a hidden window with `AddClipboardFormatListener`. Callbacks only queue signals.
- UIA worker (COM MTA, `IUIAutomation`): `ElementFromPoint` / `GetFocusedElement`, ancestor walk to the top-level window (cap 12) for `path`, `ValuePattern` (skipped if `IsPassword`), and a debounced `value` 300 ms after typing.
- Per-monitor DPI aware. Stdin `start` / `stop` / `quit`. Stdout JSON lines: `{type:"event", kind, ts, hwnd, process, window, element:{role,name,automationId,className,path,rect,value}, point, keys, text}`. `--print` mode for calibration.

**`electron/main.cjs`**:
- Spawn the helper (`TRACE_HELPER` override). Tag the app from the window title (`/Gmail/` → `mail`, `/Odoo/` → `erp`); drop MCL's own windows; anything else becomes `other`. Broadcast `trace:raw` and `trace:capability`; forward tray start/stop to the helper.
- Also tell the helper to ignore input while the executor is running, so test runs are never recorded.
- Video: `setDisplayMediaRequestHandler` returns the primary-screen `desktopCapturer` source. Set `backgroundThrottling: false` on the main window.
- IPC `trace:export` writes `userData/exports/<id>/recording.json` and `video.webm`.

**`package.json`**: `helper:build`, `odoo:start`, `odoo:seed`, `odoo:reset`, `email:send`, `test`. Gitignore `native/trace-helper/target` and `.env.local`.

## Phase 2: recording and playback

- **`src/data/schema.ts`**: `RawOsEvent`. `A11yTarget` gains `automationId?`, `rect?`, `process?`. `Recording` gains `capture: 'os' | 'demo'`, `raw?`, `video?: { url, offsetMs, width, height }`.
- **`src/data/profiles/{gmail,odoo}.ts`**: friendly names and stable `tid`s, so markers read "Pasted PO-4471 into Vendor Reference" and the predefined workflow's "From the recording" links (`tidPrefixes`) still find events. Unknown elements still show as generic markers with the raw UIA role and name.
  - Odoo: Vendor / `partner_id` → supplier; Vendor Reference / `partner_ref` → po_number; Product / `product_id` → item_sku; Quantity / `product_qty`; Unit Price / `price_unit`; Expected Arrival / `date_planned`. Buttons "New", "Save manually", "Confirm Order", "Discard".
  - Gmail: an order-subject row click → open message; clipboard while Gmail is focused → copy.
  - Calibrate the names with `--print` during the user's step A8.
- **`src/data/normalize.ts`** (pure): raw → `Action & { t }`. A value within 600 ms after Ctrl+V on the same element becomes paste, otherwise type. The real `path`, `rect` and `automationId` are kept. Then the existing `toRecording()` merge and `materialize()` run. Keep the fallback to the demo recording when too little is captured.
- **`src/lib/store.ts`**: `capture.raw`, `capture.os`, video. `startRecording()` starts `getDisplayMedia` + `MediaRecorder` (15 fps) and notes the epoch at `onstart`. `stopRecording()` builds the Recording with `offsetMs = videoStart − captureStart − t0` (return `t0` from `toRecording()`). Remove the mock `trace:event` path from the main flow.
- **`src/components/VideoReplay.tsx`**: a `<video>` driven by `usePlayback` (play, pause, speed, re-seek on drift over 250 ms) with the selected event's rectangle overlaid.
- **`src/screens/RecordingsScreen.tsx`**: VideoReplay for OS recordings (ReplayPlayer only for the demo fallback). `EventDetail` adds process, AutomationId and rectangle, plus an **Export recording** button. `WorkflowsScreen` uses VideoReplay for the node's time range.

## Phase 3: workflow (predefined) and execution on this PC

- **Seam**: `src/lib/workflowBuilder.ts` exports `workflowFromRecording(rec): Workflow`. Today it returns `buildWorkflow(defaultEdits())` after the existing fake build delay; that's the user's experiment slot. `src/data/workflow.ts` node text switches to Gmail and Odoo wording. The structure, price question and edits stay unchanged.
- **Extractor**: `src/data/extract.ts` (pure, shared with tests) parses the values from email text. Rules cover all 6 variations: `PO-\d+`, SKU codes, "1,200 pcs" → 1200, "3 Dec 2026" / "Nov 30" → ISO date, and ignoring the quoted older order.
- **Executor**: `electron/executor.cjs` uses `playwright-core` `chromium.connectOverCDP('http://localhost:9222')` to drive the visible demo Chrome. Per test email it runs the workflow nodes in order:
  1. **trigger**: Gmail tab → search URL `#search/subject:"<subject>"` → open the first result.
  2. **extract**: read the message body text → `extract.ts`. Missing PO, item or quantity → flagged: apply the Gmail label "MCL review" and stop.
  3. **open**: Odoo tab → Purchase → New.
  4. **fill**: fill fields using Odoo's stable `name` selectors (`.o_field_widget[name=partner_id] input` and so on; order line via "Add a product").
  5. **decision**: last price via `odoo.cjs` JSON-RPC.
  6. **approval**: save as draft and post a chatter "Log note" with the price change → paused.
  7. **flag**: discard and apply the Gmail label → flagged.
  8. **save**: click Save, set `origin` to `MCL test` via RPC, and wait for the saved state → completed.

  It emits `runs:step` with real timings and Odoo ids, then reads each PO back over RPC to fill `entered`. The result is `RunPlan`-shaped, so the existing `judge()` and `expectedOutcome()` work. Runs go one at a time. Chrome comes to the front while running and MCL returns at the end.
- **Screens**: `TestsScreen` "Test in VM" becomes **Test on this PC**: run cards with steps ticking, outcome and "Open in Odoo", plus "Run one" / "Run all 6". `ReportsScreen` uses the same maths on real results, and the paused row links to the PO in Odoo. If Chrome or Odoo is unreachable, show a clear error and a "Run simulated" fallback (today's `planRun`, labelled).

## Phase 4: cleanup

- The mock apps, `DesktopSim` and the demo recording are reachable only from Ctrl+Shift+D, as the stage fallback.
- Update the README: setup, the new 2-minute run, and the "What's real" table.

## Files

New: `native/trace-helper/*`, `scripts/wsl/odoo-setup.sh`, `scripts/odoo-seed.mjs`, `scripts/send-emails.mjs`, `electron/odoo.cjs`, `electron/executor.cjs`, `src/data/normalize.ts`, `src/data/profiles/*`, `src/data/extract.ts`, `src/lib/workflowBuilder.ts`, `src/components/VideoReplay.tsx`, tests and fixtures, `docs/trace-plan*.md`.
Changed: `electron/main.cjs`, `electron/preload.cjs`, `src/data/{schema,desktop,workflow}.ts`, `src/lib/store.ts`, `src/screens/{Recordings,Workflows,Tests,Reports}Screen.tsx`, `src/components/DemoControls.tsx`, `src/App.tsx`, `package.json`, `.gitignore`, `README.md`.
Reused: `toRecording()`, `materialize()`, `Timeline`, `usePlayback`, `buildWorkflow()`, `judge()` / `expectedOutcome()`, `VARIATIONS`, `LAST_PRICE`, the bus.

## Verification

1. `npm run odoo:start`; `localhost:8069` loads; `npm run odoo:seed`; check the vendors, products and past POs; `odoo:reset` removes only MCL POs.
2. `npm run email:send -- --recording --tests`; 7 emails arrive in the demo inbox.
3. `npm run helper:build`; `trace-helper.exe --print` during the user's chore shows correct names and paths. Save it as the fixture and fix the profiles.
4. `npm test` (normalizer, extractor across all 6 emails) and `npm run typecheck`.
5. `npm run app`: record the chore. The video plays with markers in sync, the box lands on the clicked element, the accessibility path is the real one, MCL's own clicks are absent, and Export writes both files.
6. Approve with "Ask me first" and run all 6 on this PC. Chrome is driven visibly. Expect 4 completed, 1 paused (note in Odoo chatter) and 1 flagged (Gmail label), and the report matches Odoo. Then `odoo:reset`.
7. Fallbacks: Odoo down → clear error + simulated option; helper missing → "OS capture off" and the demo recording is still available from Ctrl+Shift+D.
