// MonteCarlo Labs actors (Durable Actors runtime, running in WSL next to Odoo).
//
// ShadowDeployment/po-workflow: shadow mode for real. An alarm wakes it every SHADOW_POLL_MS; it reads
//   new emails from the demo inbox, drafts what the workflow would enter, and compares the draft
//   with the order the buyer entered in Odoo. The app shows its emitted state live.
// ApprovalDesk/dana: price changes waiting for Dana. Approve confirms the order in Odoo, Reject
//   cancels it; a reminder note goes into Odoo if nobody answers within APPROVAL_REMIND_MS.
//
// The dev runtime keeps alarms in memory only, so the app calls resume() on start to re-arm them.


import { Actor, type ActorContext, Emittable, Persisted } from "durable-actors"

import {
    compare,
    dailyBuckets,
    describeDiffs,
    draftFromEmail,
    priceCheck,
    totals,
    type Catalog,
    type ShadowDay,
    type ShadowEdits,
    type ShadowItem,
    type ShadowStatus,
    type ShadowTotals,
    type Values
} from "../../src/data/shadowCompare.js"
import { currentWatermarks, fetchNew, imapConfigured, type InboxEmail } from "./inbox.js"
import * as odoo from "./odoo.js"

const num = (v: string | undefined, fallback: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback)
const pollMs = () => num(process.env.SHADOW_POLL_MS, 15_000)
const remindMs = () => num(process.env.APPROVAL_REMIND_MS, 120_000)
/** Stop waiting for the buyer's entry after this many checks. */
const MAX_CHECKS = 40

// ---------- Shadow mode ----------

export interface FeedEntry {
    id: string
    time: number
    supplier: string
    po: string
    result: ShadowStatus
    note: string
}

export interface IncomingEmail {
    id: string
    subject: string
    from: string
    receivedAt: number
    text: string
}

interface OrderRow {
    id: string
    received_at: number
    subject: string
    supplier: string
    po: string
    draft: string
    status: ShadowStatus
    note: string
    resolved_at: number | null
    checks: number
}

export class ShadowDeployment extends Actor {
    @Persisted @Emittable status: "off" | "watching" = "off"
    @Persisted @Emittable source: "imap" | "injected only" = "injected only"
    @Persisted @Emittable totals: ShadowTotals = totals([])
    @Persisted @Emittable days: ShadowDay[] = dailyBuckets([], Date.now())
    @Persisted @Emittable feed: FeedEntry[] = []
    @Persisted @Emittable lastCheck: number | null = null
    @Persisted @Emittable lastError: string | null = null
    @Persisted edits: ShadowEdits | null = null
    @Persisted catalog: Catalog = { vendors: [], skus: [] }
    /** Highest IMAP UID already seen, per mailbox (inline type: the client types must not pull in inbox.ts). */
    @Persisted watermarks: Record<string, number> = {}

    constructor(context: ActorContext) {
        super(context)
        this.db.exec(`CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY, received_at INTEGER, subject TEXT, supplier TEXT, po TEXT, draft TEXT,
            status TEXT, note TEXT, resolved_at INTEGER, checks INTEGER DEFAULT 0)`)
    }

    /** Starts shadow mode with the approved workflow's answers. Earlier results are cleared. */
    async deploy(edits: ShadowEdits): Promise<{ source: string; error: string | null }> {
        this.db.exec("DELETE FROM orders")
        this.edits = edits
        this.catalog = await odoo.catalog()
        this.lastError = null
        this.watermarks = {}
        this.source = "injected only"
        if (imapConfigured()) {
            try {
                // Everything already in the inbox (the test and recording emails) counts as seen.
                this.watermarks = await currentWatermarks()
                this.source = "imap"
            } catch (e) {
                this.lastError = (e as Error).message
            }
        }
        this.status = "watching"
        this.lastCheck = Date.now()
        refresh(this)
        this.alarm.set(Date.now() + 1000)
        return { source: this.source, error: this.lastError }
    }

    /** Re-arms the alarm after a runtime restart (the dev runtime keeps alarms in memory). */
    async resume(): Promise<string> {
        if (this.status === "watching" && this.alarm.get() === null) this.alarm.set(Date.now() + 1000)
        return this.status
    }

    /** One email, from IMAP or injected by the presenter controls. */
    async ingest(email: IncomingEmail): Promise<FeedEntry | null> {
        if (!this.edits) throw new Error("Deploy shadow mode first.")
        await ingestOne(this, email)
        await checkWaiting(this).catch(e => (this.lastError = (e as Error).message))
        refresh(this)
        return this.feed.find(f => f.id === email.id) ?? null
    }

    async reset(): Promise<void> {
        this.db.exec("DELETE FROM orders")
        this.alarm.delete()
        this.status = "off"
        this.edits = null
        this.watermarks = {}
        this.lastError = null
        this.lastCheck = null
        refresh(this)
    }

    async onAlarm(): Promise<void> {
        if (this.status !== "watching") return
        const errors: string[] = []
        if (this.source === "imap") {
            try {
                const { emails, watermarks } = await fetchNew(this.watermarks)
                for (const email of emails) await ingestOne(this, email)
                this.watermarks = watermarks
            } catch (e) {
                errors.push((e as Error).message)
            }
        }
        try {
            await checkWaiting(this)
        } catch (e) {
            errors.push((e as Error).message)
        }
        this.lastError = errors.length ? errors.join(" ") : null
        this.lastCheck = Date.now()
        refresh(this)
        this.alarm.set(Date.now() + pollMs())
    }
}

async function ingestOne(actor: ShadowDeployment, email: InboxEmail | IncomingEmail) {
    if (!actor.edits) return
    if (actor.db.exec("SELECT id FROM orders WHERE id = ?", email.id).length) return
    const d = draftFromEmail(email.text, actor.catalog, actor.edits, new Date())
    const now = Date.now()
    let status: ShadowStatus = "waiting"
    let note = "Drafted. Waiting for the buyer’s entry"
    let resolved: number | null = null
    if (!d.isOrder) {
        status = "skipped"
        note = "Not an order email"
    } else if (d.missing.length) {
        status = "escalated"
        note = `No ${d.missing.join(", ")} in the email, so the workflow would flag it for a buyer`
        resolved = now
    } else {
        const last = await odoo.lastPrice(d.draft.item_sku)
        const check = priceCheck(d.draft.unit_price, last.price, actor.edits)
        if (check.over) {
            status = "escalated"
            const sign = check.change >= 0 ? "+" : ""
            note = `Price ${sign}${check.change.toFixed(1)}% vs the last order (${last.order}). The workflow would ask a buyer`
            resolved = now
        }
    }
    actor.db.exec(
        "INSERT INTO orders (id, received_at, subject, supplier, po, draft, status, note, resolved_at, checks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
        email.id,
        email.receivedAt || now,
        email.subject,
        d.draft.supplier ?? email.from,
        d.draft.po_number ?? "",
        JSON.stringify(d.draft),
        status,
        note,
        resolved
    )
}

/** Compares each waiting draft with the buyer's order in Odoo, once the buyer has entered it. */
async function checkWaiting(actor: ShadowDeployment) {
    const rows = actor.db.exec("SELECT * FROM orders WHERE status = 'waiting'") as unknown as OrderRow[]
    for (const row of rows) {
        const buyer = row.po ? await odoo.findBuyerPo(row.po) : null
        if (buyer) {
            const diffs = compare(JSON.parse(row.draft) as Values, buyer.values)
            const status: ShadowStatus = diffs.length ? "different" : "matched"
            actor.db.exec("UPDATE orders SET status = ?, note = ?, resolved_at = ? WHERE id = ?", status, describeDiffs(diffs), Date.now(), row.id)
        } else if (row.checks + 1 >= MAX_CHECKS) {
            actor.db.exec("UPDATE orders SET status = 'different', note = ?, resolved_at = ? WHERE id = ?", "The buyer never entered this order in Odoo", Date.now(), row.id)
        } else {
            actor.db.exec("UPDATE orders SET checks = checks + 1 WHERE id = ?", row.id)
        }
    }
}

/** Recomputes the emitted totals, days and feed from the orders table. */
function refresh(actor: ShadowDeployment) {
    const rows = actor.db.exec("SELECT * FROM orders WHERE status != 'skipped' ORDER BY received_at DESC") as unknown as OrderRow[]
    const items: ShadowItem[] = rows.map(r => ({ status: r.status, resolvedAt: r.resolved_at }))
    actor.totals = totals(items)
    actor.days = dailyBuckets(items, Date.now())
    actor.feed = rows.slice(0, 20).map(r => ({ id: r.id, time: r.received_at, supplier: r.supplier, po: r.po || "(no PO number)", result: r.status, note: r.note }))
}

// ---------- Buyer approvals ----------

export interface ApprovalRequest {
    poId: number
    poName: string
    url: string
    supplier: string
    poNumber: string
    sku: string
    qty: string
    unitPrice: string
    lastPrice: number | null
    changePct: number
    reason: string
}

export interface Approval extends ApprovalRequest {
    status: "waiting" | "approved" | "rejected"
    openedAt: number
    remindedAt: number | null
    decidedAt: number | null
    decidedBy: string | null
    note: string | null
}

export class ApprovalDesk extends Actor {
    @Persisted @Emittable items: Approval[] = []
    @Persisted @Emittable pending = 0

    /** A paused order now waits for this approver. Opening the same order again is a no-op. */
    async open(request: ApprovalRequest): Promise<Approval> {
        const existing = this.items.find(i => i.poId === request.poId)
        if (existing?.status === "waiting") return existing
        const item: Approval = { ...request, status: "waiting", openedAt: Date.now(), remindedAt: null, decidedAt: null, decidedBy: null, note: null }
        this.items = [item, ...this.items.filter(i => i.poId !== request.poId)].slice(0, 50)
        settle(this)
        return item
    }

    /** Approve confirms the order in Odoo, Reject cancels it; both leave a note in its chatter. */
    async decide(poId: number, decision: "approve" | "reject", by: string): Promise<Approval> {
        const item = this.items.find(i => i.poId === poId)
        if (!item) throw new Error(`No approval for order ${poId}.`)
        if (item.status !== "waiting") return item
        let status: Approval["status"] = decision === "approve" ? "approved" : "rejected"
        let note: string
        if (!(await odoo.exists(poId))) {
            status = "rejected"
            note = "This order is no longer in Odoo"
        } else if (decision === "approve") {
            await odoo.confirmPo(poId)
            await odoo.postNote(poId, `Approved by ${by} in MonteCarlo Labs (${item.reason}). Confirmed.`)
            note = "Confirmed in Odoo"
        } else {
            await odoo.cancelPo(poId)
            await odoo.postNote(poId, `Rejected by ${by} in MonteCarlo Labs (${item.reason}). Cancelled.`)
            note = "Cancelled in Odoo"
        }
        const decided: Approval = { ...item, status, note, decidedAt: Date.now(), decidedBy: by }
        this.items = this.items.map(i => (i.poId === poId ? decided : i))
        settle(this)
        return decided
    }

    /** Re-arms the reminder alarm after a runtime restart. */
    async resume(): Promise<number> {
        settle(this)
        return this.pending
    }

    async clear(): Promise<void> {
        this.items = []
        settle(this)
    }

    async onAlarm(): Promise<void> {
        const now = Date.now()
        const due = this.items.filter(i => i.status === "waiting" && !i.remindedAt && i.openedAt + remindMs() <= now)
        for (const item of due) {
            await odoo.postNote(item.poId, `Reminder: still waiting for buyer approval (${item.reason}).`).catch(() => undefined)
        }
        if (due.length) {
            const ids = new Set(due.map(i => i.poId))
            this.items = this.items.map(i => (ids.has(i.poId) ? { ...i, remindedAt: now } : i))
        }
        settle(this)
    }
}

/** Updates the pending count and sets the alarm for the next reminder that is due. */
function settle(desk: ApprovalDesk) {
    const waiting = desk.items.filter(i => i.status === "waiting")
    desk.pending = waiting.length
    const next = waiting.filter(i => !i.remindedAt).map(i => i.openedAt + remindMs())
    if (next.length) desk.alarm.set(Math.max(Date.now() + 1000, Math.min(...next)))
    else desk.alarm.delete()
}
