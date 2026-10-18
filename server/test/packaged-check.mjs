// Boots the REAL server code and exercises everything that depends on third-party libraries:
// login cookies, JSON bodies, the database, logo upload, receipts and every Excel export.
// It runs inside the packaged app (see scripts/smoke-packaged.mjs), so a missing or wrong library in an installer is caught
// before the installer is published. It also works from source:  node server/test/packaged-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { startServer } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-packaged-'));
let failed = 0;
const ok = (n) => console.log('  ok   ', n);
const bad = (n, d = '') => { failed++; console.log('  FAIL ', n, String(d).slice(0, 300)); };
const check = (cond, name, detail) => (cond ? ok(name) : bad(name, detail));

let server;
try {
  server = await startServer({ dataDir, port: 0, host: '127.0.0.1', staticDir: path.join(here, '..', '..', 'dist') });
  ok('server and embedded database started');
  const base = `http://127.0.0.1:${server.port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return res;
  };
  const json = async (...a) => { const r = await call(...a); return { status: r.status, data: await r.json().catch(() => ({})) }; };

  let r = await call('GET', '/');
  check(r.status === 200 && (await r.text()).includes('id="root"'), 'the app screens are served (dist)');
  r = await json('POST', '/api/auth/signup', { shopName: 'Imprimerie Test', name: 'Owner Test', email: 'o@test.com', password: 'password123' });
  check(r.status === 201 && !!cookie, 'owner signup sets a login cookie', JSON.stringify(r));
  r = await json('GET', '/api/auth/me');
  check(r.status === 200 && r.data.user?.email === 'o@test.com', 'the cookie is read back on the next request (cookie libraries)', JSON.stringify(r));
  r = await json('POST', '/api/clients', { name: 'Fatou Traoré', opening_debt: 40000 });
  check(r.status === 201, 'create a client with a previous debt (JSON body, database)', JSON.stringify(r));
  const clientId = r.data.client?.id;
  r = await json('POST', '/api/orders', { client_id: clientId, support_type: 'Bâche', width_cm: 200, height_cm: 100, quantity: 2, amount_paid: 5000 });
  check(r.status === 201 && r.data.order?.unit_price === 6000, 'bâche 200 × 100 is priced 6 000 per piece', JSON.stringify(r));
  const orderId = r.data.order?.id;
  await json('POST', '/api/expenses', { category: 'Encre', supplier: 'X', amount: 250, payment_method: 'Espèces' });
  r = await json('GET', `/api/orders/${orderId}/receipt`);
  check(r.status === 200 && r.data.client?.debt === 47000, 'receipt data: client debt 47 000', JSON.stringify(r));
  r = await json('GET', '/api/dashboard');
  check(r.status === 200 && r.data.unpaid_debts === 47000, 'dashboard debts 47 000', JSON.stringify(r).slice(0, 200));
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  r = await json('PUT', '/api/settings', { currency: 'FCFA', logo: PNG });
  check(r.status === 200 && r.data.logo === PNG, 'shop settings and logo are saved', JSON.stringify(r).slice(0, 200));

  for (const kind of ['orders', 'clients', 'stock', 'expenses', 'cash', 'report']) {
    const res = await call('GET', `/api/export/${kind}.xlsx`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let files = {};
    try { files = unzipSync(bytes); } catch (e) { /* reported below */ }
    const sheet = files['xl/worksheets/sheet1.xml'];
    check(res.status === 200 && bytes[0] === 0x50 && bytes[1] === 0x4b && !!files['xl/workbook.xml'] && !!sheet && new TextDecoder().decode(sheet).includes('<sheetData>'),
      `Excel export "${kind}" is a valid .xlsx (${bytes.length} bytes)`, `status ${res.status}`);
  }
} catch (e) {
  bad('unexpected error', e?.stack || e);
} finally {
  try { await server?.close(); } catch { /* already closed */ }
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(failed ? `\nPACKAGED CHECK FAILED (${failed})` : '\nPACKAGED CHECK PASSED');
process.exit(failed ? 1 : 0);
