// npm run email:send                — send the recording email and the 6 test emails
// npm run email:send -- --recording — only the PO-4471 email you record the chore with
// npm run email:send -- --tests     — only the 6 test emails the workflow runs against
// npm run email:send -- --context   — only the team emails the Knowledge tab learns from
// npm run email:send -- --shadow    — the order emails for shadow mode (send after "Deploy in shadow mode";
//                                     never part of the default set)
// npm run email:send -- --history   — the suppliers' emails for the past orders in Odoo (src/data/pastOrders.ts),
//                                     which the workflow builder learns from. Send once, before the others.
//
// Sends from GMAIL_SENDER (the "supplier" account, using an App password) to GMAIL_INBOX
// (the demo buyer inbox). Settings come from .env.local.
import nodemailer from 'nodemailer';
import envMod from '../electron/env.cjs';
import { CONTEXT_EMAILS, RECORDED_EMAIL, VARIATIONS } from '../src/data/scenario';
import { SHADOW_EMAILS } from '../src/data/shadowEmails';
import { HISTORY_EMAILS } from '../src/data/pastOrders';
import { bodyText } from '../src/data/extract';
import type { MailMessage } from '../src/data/schema';

const env = (envMod as typeof import('../electron/env.cjs')).loadEnv();

const missing = ['GMAIL_SENDER', 'GMAIL_APP_PASSWORD', 'GMAIL_INBOX'].filter((k) => !env[k as keyof typeof env]);
if (missing.length) {
  console.error(`Fill in ${missing.join(', ')} in .env.local first (see .env.example).`);
  process.exit(1);
}

const args = process.argv.slice(2);
const picked = ['--recording', '--tests', '--context', '--shadow', '--history'].filter((f) => args.includes(f));
// Shadow and history emails are sent once, on purpose, so the default set leaves them out.
const want = (flag: string) => (!picked.length && flag !== '--shadow' && flag !== '--history') || picked.includes(flag);

const messages: MailMessage[] = [
  ...(want('--history') ? HISTORY_EMAILS : []),
  ...(want('--context') ? CONTEXT_EMAILS : []),
  ...(want('--recording') ? [RECORDED_EMAIL] : []),
  ...(want('--tests') ? VARIATIONS.map((v) => v.message) : []),
  ...(want('--shadow') ? SHADOW_EMAILS : []),
];

const transport = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: env.GMAIL_SENDER, pass: env.GMAIL_APP_PASSWORD.replace(/\s+/g, '') },
});

for (const m of messages) {
  await transport.sendMail({
    from: { name: `${m.fromName}, ${m.company}`, address: env.GMAIL_SENDER },
    to: env.GMAIL_INBOX,
    subject: m.subject,
    text: bodyText(m),
  });
  console.log(`Sent: ${m.subject}`);
  // Gmail shows them in order when they don't all land in the same second.
  await new Promise((r) => setTimeout(r, 1200));
}
console.log(`Done: ${messages.length} email(s) to ${env.GMAIL_INBOX}.`);
