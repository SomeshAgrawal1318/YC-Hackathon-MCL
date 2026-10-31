// Reads the demo inbox over IMAP (used by test VMs, which don't sign in to the Gmail website).
// Needs GMAIL_INBOX and GMAIL_INBOX_APP_PASSWORD (an App password of that account) in .env.local.

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const MAILBOXES = ['INBOX', '[Gmail]/Spam'];

async function withImap(env, fn) {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: env.GMAIL_INBOX, pass: String(env.GMAIL_INBOX_APP_PASSWORD || '').replace(/\s+/g, '') },
    logger: false,
  });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(`Could not sign in to ${env.GMAIL_INBOX} over IMAP (${e.responseText || e.message}). Check GMAIL_INBOX_APP_PASSWORD in .env.local.`);
  }
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** The newest email whose subject is exactly `subject`, from the inbox or (if Gmail filed it there) spam. */
async function fetchBySubject(env, subject) {
  return withImap(env, async (client) => {
    for (const mailbox of MAILBOXES) {
      const lock = await client.getMailboxLock(mailbox).catch(() => null);
      if (!lock) continue;
      try {
        const uids = (await client.search({ subject }, { uid: true })) || [];
        for (const uid of [...uids].sort((a, b) => b - a)) {
          const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
          if (!msg || String(msg.envelope?.subject || '').trim() !== subject.trim()) continue;
          const parsed = await simpleParser(msg.source);
          const from = parsed.from?.value?.[0];
          return {
            mailbox,
            uid,
            subject: parsed.subject || subject,
            from: from?.name || from?.address || '',
            fromEmail: from?.address || '',
            date: parsed.date ? parsed.date.toISOString() : null,
            text: parsed.text || '',
          };
        }
      } finally {
        lock.release();
      }
    }
    return null;
  });
}

/** Stars the email in Gmail (IMAP \Flagged). */
async function flag(env, { mailbox, uid }) {
  return withImap(env, async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true });
    } finally {
      lock.release();
    }
  });
}

/** Every inbox email whose subject matches `test`, newest first, with its text. One IMAP session. */
async function listMatching(env, test, { max = 60 } = {}) {
  return withImap(env, async (client) => {
    const lock = await client.getMailboxLock('INBOX');
    const out = [];
    try {
      const uids = ((await client.search({ all: true }, { uid: true })) || []).sort((a, b) => b - a).slice(0, max * 3);
      for (const uid of uids) {
        if (out.length >= max) break;
        const head = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
        const subject = String(head?.envelope?.subject || '').trim();
        if (!subject || !test(subject)) continue;
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.value?.[0];
        out.push({ uid, subject, from: from?.name || from?.address || '', email: from?.address || '', date: parsed.date ? parsed.date.toISOString() : null, text: parsed.text || '' });
      }
    } finally {
      lock.release();
    }
    return out;
  });
}

module.exports = { fetchBySubject, flag, listMatching };
