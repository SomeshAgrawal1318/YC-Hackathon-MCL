# Trace on real apps: what we are building (simple version)

## What we're building

1. **Trace records for real.** While you do the chore in real Gmail and real Odoo, Trace records your screen as video. It also records what you click, copy, paste and type, plus the exact on-screen element for each action (its name, type and where it sits in the app).
2. **The app plays it back.** The Recordings tab plays the real screen video with the timeline and markers. Click a marker and a box highlights the element on the video, with its details on the side.
3. **Workflow creation stays predefined.** It's still the ready-made "supplier email → purchase order" workflow, so you can experiment with building it from recordings later. I'll leave a clean plug-in point for that, plus an **Export recording** button that saves the video and the event data as files for your experiments.
4. **The workflow runs on your PC, not a VM.** Press **Test on this PC** and the app takes over Chrome on your screen. It opens each test email in Gmail, reads the order details, and fills in and saves a purchase order in Odoo (or pauses or flags it, depending on your answer to the price question). You watch it happen. The report shows what actually got created in Odoo.
5. **Shadow mode** stays simulated, as now.

The apps we use, all free:
- **Gmail** in Chrome, on a demo account.
- **Odoo**, a free open-source ERP, running on your PC inside WSL Ubuntu. You open it in the browser like a website.

## What I need you to do by hand

These are things I can't do for you (accounts, passwords, sign-ins) or that need your hands on the mouse.

| # | When | What | Time |
|---|---|---|---|
| 1 | Before I start | Create **two free Gmail accounts**. One is the demo buyer inbox. The other is the "supplier" that sends the order emails. | 10 min |
| 2 | Before I start | On the **supplier** account, turn on 2-Step Verification, then create an **App password** (Google Account → Security → App passwords). The send script needs it. | 5 min |
| 3 | Before I start | Make sure **Google Chrome** is installed. | 1 min |
| 4 | After I set up Odoo | Open `http://localhost:8069` once and check that Odoo loads. I'll give you the login I set. | 2 min |
| 5 | After I add the launcher | In the Chrome window the app opens (a separate demo profile), **sign in to the demo buyer Gmail** once. Google may ask for 2-step codes, which only you can enter. | 3 min |
| 6 | After I add the launcher | Paste the two Gmail addresses and the App password into `.env.local`. I'll create the file with blanks. | 2 min |
| 7 | When Windows asks | Click **Allow** if Windows Defender or SmartScreen warns about `trace-helper.exe`. It watches the mouse and keyboard, which antivirus sometimes flags. | 1 min |
| 8 | After the helper is built | **Do the chore once** while Trace runs in test mode: open the email, copy and paste into a new Odoo purchase order, save. I use that run to tune how Trace names Odoo's fields. | 5 min |
| 9 | At the end | Do the full 2-minute demo run and tell me what looks off. | 10 min |

If the Rust build fails because of a missing linker, you may also need to install **Visual Studio Build Tools → "Desktop development with C++"** (about 15 minutes). I'll tell you if that happens.

## Not in scope yet

- Building the workflow from the recording. That's yours to experiment with; I'll only provide the hook and the exports.
- Running in a VM (Grokbot). Execution on your PC uses the same steps, so moving it to a VM later is a swap.
- Real shadow mode.

---
