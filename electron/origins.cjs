// Exact-origin boundary inspired by Arcada's contract and vault destination checks.
// HTTP is permitted only for explicitly configured local demo ERP instances.
function trustedOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password) throw new Error('URL credentials are not allowed');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Use HTTPS, or HTTP on a loopback address for the local demo');
  }
  return url.origin;
}
function isOdoo(env, value) {
  try { return trustedOrigin(value) === trustedOrigin(env.ODOO_URL); } catch { return false; }
}
function isGmail(value) {
  try { return ['https://mail.google.com', 'https://accounts.google.com'].includes(trustedOrigin(value)); } catch { return false; }
}
function assertOdoo(env, value) {
  if (!isOdoo(env, value)) throw new Error('Odoo navigation left the configured origin; automation stopped');
}
module.exports = { trustedOrigin, isOdoo, isGmail, assertOdoo };
