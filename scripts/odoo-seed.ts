// npm run odoo:seed  — create the demo vendors, products and past purchase orders in Odoo.
// npm run odoo:reset — delete every purchase order except the seeded history (keeps vendors and products).
// Safe to run again: existing records are found and reused.
import odooMod from '../electron/odoo.cjs';
import { resetOdoo, seedOdoo } from './lib/seed';

const { createOdoo, ensureOdoo } = odooMod as typeof import('../electron/odoo.cjs');

const up = await ensureOdoo({ detach: true, log: console.log });
if (!up) {
  console.error('Odoo is not running. Try "npm run odoo:start".');
  process.exit(1);
}
try {
  const odoo = createOdoo();
  if (process.argv.includes('--reset')) await resetOdoo(odoo);
  else {
    await seedOdoo(odoo);
    console.log('Seed done.');
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
