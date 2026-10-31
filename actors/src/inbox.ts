// Reads new emails from the demo inbox over IMAP (Gmail), for shadow mode.
// Same account and App password as electron/mail-imap.cjs: GMAIL_INBOX, GMAIL_INBOX_APP_PASSWORD.
// Each call connects, reads and logs out, because an actor sleeps between alarm ticks.

import { ImapFlow } from "imapflow"
import { simpleParser } from "mailparser"

/** New supplier emails are sometimes filed as spam by Gmail, so both are watched. */
const MAILBOXES = ["INBOX", "[Gmail]/Spam"]

/** Highest UID already seen, per mailbox. */
export type Watermarks = Record<string, number>

export interface InboxEmail {
    /** Message-ID when there is one, else mailbox:uid. */
    id: string
    subject: string
    from: string
    receivedAt: number
    text: string
}

export function imapConfigured(): boolean {
    return !!(process.env.GMAIL_INBOX && process.env.GMAIL_INBOX_APP_PASSWORD)
}

async function withImap<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: { user: process.env.GMAIL_INBOX || "", pass: String(process.env.GMAIL_INBOX_APP_PASSWORD || "").replace(/\s+/g, "") },
        logger: false
    })
    try {
        await client.connect()
    } catch (e) {
        const err = e as Error & { responseText?: string }
        throw new Error(`Could not sign in to ${process.env.GMAIL_INBOX} over IMAP (${err.responseText || err.message}).`)
    }
    try {
        return await fn(client)
    } finally {
        await client.logout().catch(() => undefined)
    }
}

/** The current highest UID per mailbox: everything up to here counts as already seen. */
export async function currentWatermarks(): Promise<Watermarks> {
    return withImap(async client => {
        const out: Watermarks = {}
        for (const mailbox of MAILBOXES) {
            const status = await client.status(mailbox, { uidNext: true }).catch(() => null)
            if (status?.uidNext) out[mailbox] = status.uidNext - 1
        }
        return out
    })
}

/** Emails that arrived after the watermarks, oldest first, and the new watermarks. */
export async function fetchNew(seen: Watermarks): Promise<{ emails: InboxEmail[]; watermarks: Watermarks }> {
    return withImap(async client => {
        const emails: InboxEmail[] = []
        const watermarks: Watermarks = { ...seen }
        for (const mailbox of MAILBOXES) {
            const lock = await client.getMailboxLock(mailbox).catch(() => null)
            if (!lock) continue
            try {
                const from = (seen[mailbox] ?? 0) + 1
                for await (const msg of client.fetch(`${from}:*`, { uid: true, source: true }, { uid: true })) {
                    // "n:*" also returns the newest message when nothing is newer than n.
                    if (msg.uid < from || !msg.source) continue
                    const parsed = await simpleParser(msg.source)
                    const sender = parsed.from?.value?.[0]
                    emails.push({
                        id: parsed.messageId || `${mailbox}:${msg.uid}`,
                        subject: parsed.subject || "(no subject)",
                        from: sender?.name || sender?.address || "",
                        receivedAt: parsed.date ? parsed.date.getTime() : Date.now(),
                        text: parsed.text || ""
                    })
                    watermarks[mailbox] = Math.max(watermarks[mailbox] ?? 0, msg.uid)
                }
            } finally {
                lock.release()
            }
        }
        emails.sort((a, b) => a.receivedAt - b.receivedAt)
        return { emails, watermarks }
    })
}
