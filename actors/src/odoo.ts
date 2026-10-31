// Odoo JSON-RPC from inside the actors (they run in WSL, next to Odoo).
// A typed port of electron/odoo.cjs, plus the purchase order helpers shadow mode and approvals use.
// The queries match electron/hands.cjs (prepare, odooLastPrice, odooReadPo).

import type { Catalog, Values } from "../../src/data/shadowCompare.js"

export class OdooError extends Error {}

type Domain = unknown[]

function settings() {
    return {
        base: (process.env.ODOO_URL || "http://127.0.0.1:8069").replace(/\/+$/, ""),
        db: process.env.ODOO_DB || "mcl",
        user: process.env.ODOO_USER || "admin",
        password: process.env.ODOO_PASSWORD || "admin"
    }
}

let rpcId = 0

async function rpc(service: string, method: string, args: unknown[]): Promise<any> {
    const { base } = settings()
    let res: Response
    try {
        res = await fetch(`${base}/jsonrpc`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: ++rpcId, params: { service, method, args } }),
            signal: AbortSignal.timeout(20_000)
        })
    } catch {
        throw new OdooError(`Odoo is not reachable at ${base}. Start it with "npm run odoo:start".`)
    }
    const body = (await res.json()) as { result?: unknown; error?: { data?: { message?: string }; message?: string } }
    if (body.error) throw new OdooError(body.error.data?.message || body.error.message || "Odoo error")
    return body.result
}

let uid: number | null = null

async function login(): Promise<number> {
    if (uid) return uid
    const s = settings()
    const id = await rpc("common", "authenticate", [s.db, s.user, s.password, {}])
    if (!id) throw new OdooError(`Odoo rejected the login for ${s.user}.`)
    uid = id as number
    return uid
}

export async function call(model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Promise<any> {
    const s = settings()
    const id = await login()
    return rpc("object", "execute_kw", [s.db, id, s.password, model, method, args, kwargs])
}

export const searchRead = (model: string, domain: Domain, fields: string[], opts: Record<string, unknown> = {}): Promise<any[]> =>
    call(model, "search_read", [domain], { fields, ...opts })
export const read = (model: string, ids: number[], fields: string[]): Promise<any[]> => call(model, "read", [ids, fields])
export const recordUrl = (model: string, id: number) => `${settings().base}/web#id=${id}&model=${model}&view_type=form`

/** Vendors and product codes, as the workflow's extractor knows them. */
export async function catalog(): Promise<Catalog> {
    const vendors = await searchRead("res.partner", [["supplier_rank", ">", 0]], ["name"])
    const products = await searchRead("product.product", [["purchase_ok", "=", true], ["default_code", "!=", false]], ["default_code"])
    return { vendors: vendors.map(v => String(v.name)), skus: products.map(p => String(p.default_code)) }
}

/** Last confirmed purchase price for a product. */
export async function lastPrice(sku: string | undefined): Promise<{ price: number | null; order?: string }> {
    if (!sku) return { price: null }
    // The newest order by order date, not by id: past orders can be entered (or seeded) late.
    const [po] = await searchRead(
        "purchase.order",
        [["state", "in", ["purchase", "done"]], ["order_line.product_id.default_code", "=", sku]],
        ["name"],
        { order: "date_order desc, id desc", limit: 1 }
    )
    if (!po) return { price: null }
    const lines = await searchRead("purchase.order.line", [["order_id", "=", po.id], ["product_id.default_code", "=", sku]], ["price_unit"], { limit: 1 })
    return lines.length ? { price: Number(lines[0].price_unit), order: String(po.name) } : { price: null }
}

export interface PoValues {
    id: number
    name: string
    state: string
    url: string
    values: Values
}

/** A purchase order as workflow values (the same reading as odooReadPo in electron/hands.cjs). */
export async function readPo(id: number): Promise<PoValues | null> {
    const [po] = await read("purchase.order", [id], ["partner_id", "partner_ref", "date_planned", "order_line", "name", "state"])
    if (!po) return null
    const values: Values = {
        supplier: po.partner_id ? String(po.partner_id[1]) : undefined,
        po_number: po.partner_ref || undefined,
        delivery_date: po.date_planned ? String(po.date_planned).slice(0, 10) : undefined
    }
    if (po.order_line.length) {
        const [line] = await read("purchase.order.line", [po.order_line[0]], ["product_id", "product_qty", "price_unit"])
        values.item_sku = line.product_id ? (String(line.product_id[1]).match(/^\[([^\]]+)\]/) || [])[1] : undefined
        values.quantity = String(Number(line.product_qty))
        values.unit_price = Number(line.price_unit).toFixed(2)
    }
    return { id, name: String(po.name), state: String(po.state), url: recordUrl("purchase.order", id), values }
}

/** The order a buyer entered for this vendor reference (not one made by a workflow test run). */
export async function findBuyerPo(ref: string): Promise<PoValues | null> {
    const ids: number[] = await call("purchase.order", "search", [
        [["partner_ref", "=", ref], ["origin", "!=", "MCL test"], ["state", "!=", "cancel"]]
    ], { limit: 1, order: "id desc" })
    return ids.length ? readPo(ids[0]) : null
}

export async function exists(id: number): Promise<boolean> {
    const ids: number[] = await call("purchase.order", "search", [[["id", "=", id]]], { limit: 1 })
    return ids.length > 0
}

export const confirmPo = (id: number) => call("purchase.order", "button_confirm", [[id]])
export const cancelPo = (id: number) => call("purchase.order", "button_cancel", [[id]])

/** An internal note in the order's chatter. */
export const postNote = (id: number, body: string) =>
    call("purchase.order", "message_post", [[id]], { body, message_type: "comment", subtype_xmlid: "mail.mt_note" })
