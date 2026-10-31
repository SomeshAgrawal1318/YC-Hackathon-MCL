// npm run odoo:start — start Odoo in WSL and keep it running in the background.
// npm run odoo:stop runs "wsl --terminate" to stop it.
import odoo from '../electron/odoo.cjs';
import envMod from '../electron/env.cjs';

const env = envMod.loadEnv();
const up = await odoo.ensureOdoo({ env, detach: true, log: console.log });
if (up) {
  console.log(`Odoo is up: ${env.ODOO_URL}  (database "${env.ODOO_DB}", user "${env.ODOO_USER}")`);
  process.exit(0);
}
console.error('Odoo did not come up within 90 s. Inside WSL, check: journalctl -u odoo -n 50');
process.exit(1);
