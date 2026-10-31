# Test runs in VMs with Freestyle: simple version

## What we're building

Today, **Test on this PC** takes over your Chrome and runs the 6 test emails one after another. With Freestyle:

1. Pressing **Test in VMs** starts **6 fresh Linux VMs at once**, one per test email. Each boots from a saved image in well under a second and has its own clean Odoo with the same suppliers, products and past prices.
2. In each VM, the workflow runs the same steps as today:
   - It reads the supplier email from your demo Gmail inbox.
   - It opens a new purchase order in that VM's Odoo, fills it in, and saves it, pauses it for a buyer, or flags it.
3. The **Test runs** screen shows the **6 VM screens live, side by side**: you can watch each one fill in Odoo.
4. The **report** works as today: it checks what each VM's Odoo saved against what a careful buyer would enter. Links open that VM's Odoo, and the step screenshots stay.
5. After the run, the VMs stay up for 10 minutes so you can click into them, then delete themselves.

Your PC is free while the tests run, and **Test on this PC** stays as a fallback.

## One thing that works differently: reading the email

Signing in to the Gmail website inside 6 cloud VMs at once is likely to trigger Google's "verify it's you" checks, which could break on stage. So each VM **fetches the test email from your demo inbox directly** (through Gmail's IMAP connection, with an App password) and shows it on its screen. Odoo is still driven through its real screens, like a person would.

Trace itself doesn't change. It still records you on your Windows PC; VMs are only for test runs.

## What I need you to do by hand

| # | When | What | Time |
|---|---|---|---|
| 1 | Before I start | Create a Freestyle account at freestyle.sh. | 3 min |
| 2 | Before I start | Run `npx freestyle@latest tokens create "mcl-demo"` and paste the key after `FREESTYLE_API_KEY=` in `.env.local`. | 2 min |
| 3 | Before I start | On the **customer** Gmail account (customermontecarlo@gmail.com): turn on 2-Step Verification, create an **App password**, and paste it after `GMAIL_INBOX_APP_PASSWORD=` in `.env.local`. This is the same process you did for the supplier account. | 5 min |
| 4 | ~~After my first test~~ | ~~Decide the plan.~~ Done: the free plan allows saved VM images, and VMs boot from one in 0.3 s. No paid plan needed. | — |
| 5 | At the end | Do one full demo run with **Test in VMs** and tell me what looks off. | 10 min |

## Cost

On the free plan's monthly allowance, one full run of 6 VMs uses roughly 1% of it, so you could rehearse many times without paying. If we need Hobby, it's $50/month with usage included.

## Effort and order

About a day of work for me, in this order:

1. **Quick test (1–2 h):** one VM with Chrome and Odoo, controlled from the app, with its live screen visible. This is also where we find out whether the free plan is enough.
2. **The VM image:** Chrome, Odoo and the seed data baked into one saved image.
3. **Running in VMs:** the runner starts 6 VMs and runs the tests in parallel.
4. **Screens:** the live VM tiles on the Test runs screen, plus a switch between "On this PC" and "In VMs".

## Not in scope

- Gmail's website inside the VMs (possible later as an experiment, using a saved session).
- Windows VMs. Freestyle only runs Linux, which is fine because Gmail and Odoo are web apps.
- Shadow mode stays simulated.
