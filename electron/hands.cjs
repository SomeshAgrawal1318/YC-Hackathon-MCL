// The "hands" of a workflow run: small actions on the real apps in the demo Chrome (Gmail, Odoo),
// plus a few Odoo lookups over JSON-RPC. The workflow logic itself (what to read, when to pause)
// runs in the app (src/lib/runner.ts) and calls these one at a time. A VM agent can implement the
// same operations later.

const { chromium } = require('playwright-core');
const { openDemoApps, connect, isGmail, isOdoo, odooLogin, ensureWide, GMAIL_URL } = require('./chrome.cjs');
const { createOdoo, ensureOdoo } = require('./odoo.cjs');
const mail = require('./mail-imap.cjs');

const TYPE_DELAY = 25; // ms per key, so typing is visible on screen
const ITEM = '.o-autocomplete--dropdown-menu .o-autocomplete--dropdown-item';

const escapeHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** How a VM's Chrome shows an email it fetched over IMAP: a plain message view. */
function emailPage(msg, inbox) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(msg.subject)} — ${escapeHtml(inbox)}</title>
<style>body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#f3f5f8;color:#16202b}
header{background:#fff;border-bottom:1px solid #dde3ea;padding:14px 28px;display:flex;gap:10px;align-items:center;font-size:13px;color:#5b6876}
header b{color:#16202b}main{max-width:820px;margin:28px auto;background:#fff;border:1px solid #dde3ea;border-radius:12px;padding:26px 30px}
h1{font-size:22px;margin:0 0 8px}.meta{color:#5b6876;font-size:13px;margin-bottom:20px}pre{white-space:pre-wrap;font:inherit;margin:0}</style></head>
<body><header><b>${escapeHtml(inbox)}</b> · Inbox, read over IMAP</header><main><h1>${escapeHtml(msg.subject)}</h1>
<div class="meta">From ${escapeHtml(msg.from)}${msg.fromEmail ? ` &lt;${escapeHtml(msg.fromEmail)}&gt;` : ''} · ${escapeHtml(msg.date ? new Date(msg.date).toLocaleString() : '')}</div>
<pre>${escapeHtml(msg.text)}</pre></main></body></html>`;
}

/**
 * target: { kind: 'local' } drives the demo Chrome on this PC (Gmail website, local Odoo).
 *         { kind: 'vm', cdpWs, odooUrl, odoo: { db, user, password } } drives a Freestyle VM's Chrome:
 *         its own Odoo at localhost:8069 inside the VM, and email fetched over IMAP.
 */
function createHands(env, { area, onBusy = () => {}, target = { kind: 'local' } }) {
  const vm = target.kind === 'vm';
  const odooEnv = vm ? { ...env, ODOO_URL: target.odooUrl, ODOO_DB: target.odoo.db, ODOO_USER: target.odoo.user, ODOO_PASSWORD: target.odoo.password } : env;
  const odoo = createOdoo(odooEnv);
  const odooWeb = vm ? 'http://localhost:8069' : env.ODOO_URL.replace(/\/$/, '');
  let pages = null;
  let vmBrowser = null;
  let lastEmail = null;
  let dateFormat = { date: '%m/%d/%Y', time: '%H:%M:%S' };

  async function getPages() {
    if (vm) {
      if (pages && vmBrowser?.isConnected() && !pages.odoo.isClosed()) return pages;
      vmBrowser = await chromium.connectOverCDP(target.cdpWs);
      const ctx = vmBrowser.contexts()[0];
      const odooPage = ctx.pages()[0] ?? (await ctx.newPage());
      const mailPage = ctx.pages()[1] ?? (await ctx.newPage());
      pages = { gmail: mailPage, odoo: odooPage };
    } else {
      const b = await connect(env).catch(() => null);
      if (pages && b && !pages.gmail.isClosed() && !pages.odoo.isClosed()) return pages;
      const opened = await openDemoApps(env, area(), { place: true });
      pages = { gmail: opened.gmail, odoo: opened.odoo };
    }
    // Fail in seconds, not half a minute, when the page isn't what we expect.
    pages.gmail.setDefaultTimeout(12000);
    pages.odoo.setDefaultTimeout(12000);
    return pages;
  }

  async function shot(page) {
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 55, scale: 'css', timeout: 5000 });
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }

  /** Waits until Odoo has no request in flight (it shows a loading indicator meanwhile). */
  async function settle(page, ms = 250) {
    await page.waitForTimeout(ms);
    await page
      .waitForFunction(() => !document.querySelector('.o_loading_indicator, .o_blockUI, .o-main-components-container .o_loading'), null, { timeout: 8000 })
      .catch(() => undefined);
  }

  async function typeInto(locator, value) {
    await locator.click();
    await locator.fill('');
    await locator.pressSequentially(String(value), { delay: TYPE_DELAY });
  }

  async function pickFromDropdown(page, input, text, match = text) {
    await typeInto(input, text);
    const item = page.locator(ITEM, { hasText: match }).first();
    await item.waitFor({ state: 'visible', timeout: 10000 });
    await item.click();
    await page.locator('.o-autocomplete--dropdown-menu').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    await settle(page);
  }

  function formatDate(iso) {
    const [y, m, d] = iso.split('-');
    const date = dateFormat.date.replace('%Y', y).replace('%m', m).replace('%d', d).replace('%y', y.slice(2));
    const time = dateFormat.time.replace('%H', '12').replace('%M', '00').replace('%S', '00').replace('%I', '12').replace('%p', 'PM');
    return `${date} ${time}`;
  }

  const ops = {
    /** Starts Odoo and the demo Chrome, signs in to Odoo, checks Gmail. Returns lookup data. */
    async prepare() {
      if (vm) {
        if (!env.GMAIL_INBOX || !env.GMAIL_INBOX_APP_PASSWORD) throw new Error('VM runs read email over IMAP: add GMAIL_INBOX and GMAIL_INBOX_APP_PASSWORD to .env.local.');
        const p = await getPages();
        await odooLogin(odooEnv, p.odoo).catch(() => undefined);
      } else {
        onBusy(true);
        if (!(await ensureOdoo({ env }))) throw new Error('Odoo is not running and did not start. Run "npm run odoo:start" and try again.');
        const p = await getPages();
        await odooLogin(env, p.odoo);
        if (!/mail\.google\.com\/mail/.test(p.gmail.url())) {
          await p.gmail.goto(GMAIL_URL).catch(() => undefined);
          await p.gmail.waitForTimeout(1500);
        }
        if (/accounts\.google\.com|ServiceLogin|workspace\.google\.com/.test(p.gmail.url())) {
          throw new Error('Gmail is not signed in. Sign in to the demo inbox in the Chrome window on the left, then run the tests again.');
        }
        await ops.gmailRescueSpam().catch(() => undefined);
      }
      const uid = await odoo.login();
      const [user] = await odoo.read('res.users', [uid], ['lang']);
      const [lang] = await odoo.searchRead('res.lang', [['code', '=', user.lang]], ['date_format', 'time_format'], { limit: 1 });
      if (lang) dateFormat = { date: lang.date_format, time: lang.time_format };
      const vendors = await odoo.searchRead('res.partner', [['supplier_rank', '>', 0]], ['name']);
      const products = await odoo.searchRead('product.product', [['purchase_ok', '=', true], ['default_code', '!=', false]], ['default_code']);
      return { vendors: vendors.map((v) => v.name), skus: products.map((x) => x.default_code) };
    },

    /**
     * New Gmail accounts often file the supplier's order emails as spam. Moves any of them back
     * to the inbox, so the workflow (and the person recording) finds them where expected.
     */
    async gmailRescueSpam() {
      const { gmail } = await getPages();
      await gmail.goto('https://mail.google.com/mail/u/0/#spam');
      await gmail.waitForTimeout(3000);
      // Only the supplier's order emails; anything else in Spam stays there.
      const rows = gmail.locator('div[role=main] tr.zA:visible').filter({ hasText: /Order confirmation|Order acknowledg|PO-\d+ confirmed|Priya Nair|Marcus Lee|Sam Okafor|Dana Ortiz|Plant IT|Kestrel Freight/i });
      const n = await rows.count();
      if (!n) return { moved: 0 };
      for (let i = 0; i < n; i++) await rows.nth(i).locator('[role=checkbox]').first().click();
      await gmail.locator('div[gh="tm"] [role=button][data-tooltip="Not spam"]:visible').first().click();
      await gmail.waitForTimeout(2000);
      return { moved: n };
    },

    /** The emails in the inbox list: sender, subject and date, newest first. */
    async gmailList({ max = 40 } = {}) {
      const { gmail } = await getPages();
      await gmail.bringToFront();
      await gmail.goto('https://mail.google.com/mail/u/0/#inbox');
      await gmail.locator('div[role=main] tr.zA:visible').first().waitFor({ timeout: 15000 }).catch(() => undefined);
      await gmail.waitForTimeout(500);
      const rows = await gmail.$$eval('div[role=main] tr.zA', (trs) =>
        trs
          .filter((r) => r.offsetParent)
          .map((r) => {
            const from = r.querySelector('span[email]');
            const subject = r.querySelector('span.bog') || r.querySelector('.y6 span');
            const date = r.querySelector('td.xW span[title], .xW span[title]');
            return {
              from: (from && (from.getAttribute('name') || from.textContent)) || '',
              email: (from && from.getAttribute('email')) || '',
              subject: ((subject && subject.textContent) || '').trim(),
              date: (date && date.getAttribute('title')) || '',
            };
          }),
      );
      return { rows: rows.filter((r) => r.subject).slice(0, max), shot: await shot(gmail) };
    },

    /** Marks the start of automated work, so Trace ignores it. finish() ends it. */
    async begin() {
      onBusy(true);
      return {};
    },

    /** Finds the email with this subject in Gmail, opens it and returns its text. */
    async gmailOpen({ subject }) {
      const { gmail } = await getPages();
      await gmail.bringToFront();
      if (vm) {
        const msg = await mail.fetchBySubject(env, subject);
        if (!msg) throw new Error(`No email "${subject}" in ${env.GMAIL_INBOX}. Send the test emails with "npm run email:send -- --tests".`);
        lastEmail = msg;
        await gmail.setContent(emailPage(msg, env.GMAIL_INBOX));
        await gmail.waitForTimeout(500);
        return { text: msg.text, from: msg.from, shot: await shot(gmail) };
      }
      const row = gmail.locator('div[role=main] tr.zA:visible', { hasText: subject }).first();
      let found = false;
      // The inbox first; then everywhere, in case Gmail filed it as spam.
      for (const scope of ['', 'in:anywhere ']) {
        await gmail.goto(`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`${scope}subject:"${subject}"`)}`);
        found = await row.waitFor({ state: 'visible', timeout: scope ? 15000 : 8000 }).then(() => true, () => false);
        if (found) break;
      }
      if (!found) throw new Error(`No email "${subject}" in Gmail. Send the test emails with "npm run email:send -- --tests".`);
      await row.click();
      const body = gmail.locator('div[role=main] div.a3s:visible').last();
      await body.waitFor({ state: 'visible', timeout: 15000 });
      await gmail.waitForTimeout(400);
      const text = await body.innerText();
      const from = await gmail.locator('div[role=main] span.gD').last().getAttribute('name').catch(() => null);
      return { text, from, shot: await shot(gmail) };
    },

    /** Marks the open email for review (stars it). Best effort: Gmail's UI changes often. */
    async gmailFlag() {
      const { gmail } = await getPages();
      if (vm) {
        // A real effect on the inbox: the email is starred in Gmail.
        const done = lastEmail ? await mail.flag(env, lastEmail).then(() => true, () => false) : false;
        if (done) await gmail.evaluate(() => document.querySelector('header')?.insertAdjacentHTML('beforeend', ' · <b style="color:#b8860b">★ Flagged for review</b>')).catch(() => undefined);
        return { done, shot: await shot(gmail) };
      }
      try {
        const star = gmail.locator('div[role=main] [aria-label="Not starred"]').last();
        await star.click({ timeout: 4000 });
        return { done: true, shot: await shot(gmail) };
      } catch {
        return { done: false, shot: await shot(gmail) };
      }
    },

    /** Opens a new request for quotation in Odoo. */
    async odooNewPo() {
      const { odoo: page } = await getPages();
      await page.bringToFront();
      if (!vm) await ensureWide(env, page, area());
      await page.goto(`${odooWeb}/odoo/purchase/new`);
      await odooLogin(odooEnv, page);
      const vendor = page.locator('.o_form_view .o_field_widget[name=partner_id] input');
      await vendor.waitFor({ state: 'visible', timeout: 20000 });
      await settle(page);
      if (!(await vendor.isEditable())) {
        throw new Error('Odoo opened the order in its phone layout (window too narrow). Make the Odoo window wider and run the tests again.');
      }
      return { shot: await shot(page) };
    },

    /** Fills one purchase order field. field is a workflow key (supplier, po_number, …). */
    async odooFill({ field, value }) {
      const { odoo: page } = await getPages();
      const form = '.o_form_view';
      switch (field) {
        case 'supplier':
          await pickFromDropdown(page, page.locator(`${form} .o_field_widget[name=partner_id] input`), value);
          break;
        case 'po_number':
          await typeInto(page.locator(`${form} .o_field_widget[name=partner_ref] input`), value);
          break;
        case 'item_sku': {
          if (!(await page.locator('.o_selected_row .o_field_widget[name=product_id] input').count())) {
            await page.locator('.o_field_x2many_list_row_add a', { hasText: 'Add a product' }).first().click();
          }
          const input = page.locator('.o_selected_row .o_field_widget[name=product_id] input');
          await input.waitFor({ state: 'visible', timeout: 8000 });
          await pickFromDropdown(page, input, value, `[${value}]`);
          break;
        }
        case 'quantity':
          await typeInto(page.locator('.o_selected_row .o_field_widget[name=product_qty] input'), value);
          break;
        case 'unit_price':
          await typeInto(page.locator('.o_selected_row .o_field_widget[name=price_unit] input'), value);
          break;
        case 'delivery_date': {
          const input = page.locator(`${form} .o_field_widget[name=date_planned] input`);
          await typeInto(input, formatDate(value));
          await input.press('Enter');
          await page.keyboard.press('Escape').catch(() => undefined);
          break;
        }
        default:
          throw new Error(`Unknown field ${field}`);
      }
      await settle(page, 150);
      return { shot: await shot(page) };
    },

    /** Saves the open purchase order. Returns its id, Odoo name and link. */
    async odooSave() {
      const { odoo: page } = await getPages();
      // Leave the order line so Odoo commits it, then save.
      await page.locator('.o_form_view .o_field_widget[name=partner_ref] input').click();
      await settle(page);
      await page.locator('.o_form_button_save').click();
      await page.waitForURL(/\/purchase\/\d+/, { timeout: 15000 });
      await page.locator('.o_form_button_save').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
      await settle(page);
      const id = Number(page.url().match(/\/purchase\/(\d+)/)[1]);
      await odoo.write('purchase.order', [id], { origin: 'MCL test' });
      const [po] = await odoo.read('purchase.order', [id], ['name']);
      return { id, name: po.name, url: page.url(), shot: await shot(page) };
    },

    /** Posts an internal note on the open purchase order, for the buyer who must approve it. */
    async odooLogNote({ id, text }) {
      const { odoo: page } = await getPages();
      try {
        await page.getByRole('button', { name: 'Log note', exact: true }).click({ timeout: 5000 });
        const box = page.locator('.o-mail-Composer-input').first();
        await box.waitFor({ state: 'visible', timeout: 5000 });
        await box.pressSequentially(text, { delay: 10 });
        await page.locator('.o-mail-Composer').getByRole('button', { name: 'Log', exact: true }).click({ timeout: 5000 });
        await page.locator('.o-mail-Message', { hasText: text.slice(0, 30) }).first().waitFor({ timeout: 8000 });
      } catch {
        await odoo.call('purchase.order', 'message_post', [[id]], { body: text, message_type: 'comment', subtype_xmlid: 'mail.mt_note' });
        await page.goto(`${odooWeb}/odoo/purchase/${id}`);
        await settle(page, 600);
      }
      return { shot: await shot(page) };
    },

    /** Discards the unsaved purchase order (used when a run flags instead of saving). */
    async odooDiscard() {
      const { odoo: page } = await getPages();
      const discard = page.locator('.o_form_button_cancel');
      if (await discard.isVisible().catch(() => false)) await discard.click();
      await settle(page);
      return { shot: await shot(page) };
    },

    /** Last confirmed purchase price for a product, or null. */
    async odooLastPrice({ sku }) {
      // The newest order by order date, not by id: past orders can be entered (or seeded) late.
      const [po] = await odoo.searchRead(
        'purchase.order',
        [['state', 'in', ['purchase', 'done']], ['order_line.product_id.default_code', '=', sku]],
        ['name'],
        { order: 'date_order desc, id desc', limit: 1 },
      );
      if (!po) return { price: null };
      const lines = await odoo.searchRead('purchase.order.line', [['order_id', '=', po.id], ['product_id.default_code', '=', sku]], ['price_unit'], { limit: 1 });
      return lines.length ? { price: lines[0].price_unit, order: po.name } : { price: null };
    },

    /** Reads a saved purchase order back, as workflow values. */
    async odooReadPo({ id }) {
      const [po] = await odoo.read('purchase.order', [id], ['partner_id', 'partner_ref', 'date_planned', 'order_line', 'name']);
      const out = {
        supplier: po.partner_id ? po.partner_id[1] : undefined,
        po_number: po.partner_ref || undefined,
        delivery_date: po.date_planned ? String(po.date_planned).slice(0, 10) : undefined,
      };
      if (po.order_line.length) {
        const [line] = await odoo.read('purchase.order.line', [po.order_line[0]], ['product_id', 'product_qty', 'price_unit']);
        const code = line.product_id ? (String(line.product_id[1]).match(/^\[([^\]]+)\]/) || [])[1] : undefined;
        out.item_sku = code;
        out.quantity = String(Number(line.product_qty));
        out.unit_price = Number(line.price_unit).toFixed(2);
      }
      return { values: out, name: po.name, url: odoo.recordUrl('purchase.order', id) };
    },

    async finish() {
      if (vm) {
        // Disconnects only; the VM's Chrome keeps running for anyone watching its screen.
        await vmBrowser?.close().catch(() => undefined);
        vmBrowser = null;
        pages = null;
      } else onBusy(false);
      return {};
    },
  };

  return {
    async exec(op, args = {}) {
      if (!ops[op]) throw new Error(`Unknown operation: ${op}`);
      return ops[op](args);
    },
  };
}

module.exports = { createHands, isGmail, isOdoo };
