// End-to-end API test on a throwaway embedded Postgres. Run: pnpm run test:api
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/app.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-'));
const { port, close, db } = await startServer({ dataDir, port: 0, jwtSecret: 'test-secret', staticDir: '/nonexistent' });
console.log(`db: ${db.kind}`);
const base = `http://127.0.0.1:${port}/api`;
let cookie = '';

async function api(method, url, body, { auth = true } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set && auth) cookie = set.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

try {
  // --- auth ---
  assert.equal((await api('GET', '/clients', null, { auth: false })).status, 401); ok('protected routes need auth');
  assert.equal((await api('GET', '/auth/status', null, { auth: false })).data.needsSetup, true); ok('fresh install needs setup');
  let r = await api('POST', '/auth/signup', { shopName: 'Imprimerie Test', name: 'Youssef M', email: 'Owner@Test.com', password: 'password123', role: 'staff' });
  assert.equal(r.status, 201); assert.equal(r.data.user.role, 'owner'); ok('first signup is forced to owner (even if staff requested)');
  assert.equal((await api('GET', '/auth/me')).data.user.email, 'owner@test.com'); ok('cookie session works, email normalised');
  r = await api('POST', '/auth/signup', { shopName: 'Shop', name: 'Intruder', email: 'in@test.com', password: 'password123', role: 'owner' }, { auth: false });
  assert.equal(r.status, 403); ok('public signup closed after first user');
  const ownerCookie = cookie;
  r = await api('POST', '/auth/signup', { shopName: 'Shop', name: 'Employe', email: 'staff@test.com', password: 'password123', role: 'staff' });
  assert.equal(r.status, 201); assert.equal(r.data.loggedIn, false); cookie = ownerCookie; ok('owner can create staff accounts without being logged out');
  assert.equal((await api('POST', '/auth/login', { email: 'owner@test.com', password: 'wrong' }, { auth: false })).status, 401); ok('bad password rejected');
  assert.equal((await api('POST', '/auth/login', { email: 'staff@test.com', password: 'password123' })).status, 200); ok('login works');
  cookie = ownerCookie;

  // --- setup data ---
  const client = (await api('POST', '/clients', { name: 'Agence Atlas', phone: '+212 661 24 18 90' })).data.client;
  const mat = (await api('POST', '/stock', { ref: 'MAT-001', item: 'Bâche 510g', initial_stock: 100, purchase_price: 38, alert_threshold: 30, unit: 'm²' })).data.item;
  assert.equal((await api('POST', '/stock', { ref: 'MAT-001', item: 'dup', purchase_price: 1 })).status, 409); ok('duplicate stock ref -> 409');

  // --- order transaction ---
  r = await api('POST', '/orders', { client_id: client.id, product_service: 'Bâche 510g', quantity: 24, unit_price: 160, amount_paid: 1500, payment_method: 'Virement', inventory_id: mat.id });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const o1 = r.data.order;
  assert.equal(o1.total_amount, 3840); assert.equal(o1.status, 'Partial'); assert.equal(o1.amount_due, 2340); assert.match(o1.order_number, /^CMD-\d+$/); ok('order created: generated total, Partial status');
  let c = (await api('GET', '/clients')).data.clients[0];
  assert.equal(c.total_spent, 3840); assert.equal(c.debt, 2340); assert.equal(c.status, 'debt'); ok('client total_spent + debt updated');
  let cash = (await api('GET', '/cash')).data;
  assert.equal(cash.balance, 1500); assert.equal(cash.entries[0].type, 'IN'); assert.equal(cash.entries[0].payment_method, 'Virement'); ok('cash register IN logged with running balance');
  let st = (await api('GET', '/stock')).data;
  assert.equal(st.items[0].current_stock, 76); assert.equal(st.items[0].movement, -24); ok('inventory decremented (100 -> 76)');

  // atomicity: insufficient stock must roll back EVERYTHING
  r = await api('POST', '/orders', { client_id: client.id, product_service: 'Bâche 510g', quantity: 500, unit_price: 10, amount_paid: 100, inventory_id: mat.id });
  assert.equal(r.status, 409); assert.equal(r.data.code, 'INSUFFICIENT_STOCK');
  assert.equal((await api('GET', '/orders')).data.total, 1);
  assert.equal((await api('GET', '/cash')).data.balance, 1500);
  assert.equal((await api('GET', '/clients')).data.clients[0].total_spent, 3840);
  assert.equal((await api('GET', '/stock')).data.items[0].current_stock, 76); ok('insufficient stock -> 409 and nothing was written');
  r = await api('POST', '/orders', { client_id: client.id, product_service: 'x', quantity: 1, unit_price: 10, amount_paid: 50 });
  assert.equal(r.status, 400); assert.equal(r.data.code, 'OVERPAYMENT'); ok('overpayment rejected');
  r = await api('POST', '/orders', { client_id: client.id, product_service: 'Bâche 510g', quantity: 500, unit_price: 1, inventory_id: mat.id, allow_negative_stock: true });
  assert.equal(r.status, 201); assert.equal(r.data.order.status, 'Unpaid'); ok('allow_negative_stock override works (Unpaid, no cash entry)');
  assert.equal((await api('GET', '/cash')).data.balance, 1500);

  // --- payments ---
  r = await api('PUT', `/orders/${o1.id}`, { amount_paid: 3840 });
  assert.equal(r.data.order.status, 'Paid');
  assert.equal((await api('GET', '/cash')).data.balance, 3840); ok('PUT payment -> Paid, cash IN for the delta only (2340)');
  r = await api('POST', `/clients/${client.id}/payments`, { amount: 600 });
  assert.equal(r.status, 400); assert.equal(r.data.code, 'OVERPAYMENT'); ok('client payment above debt (500) rejected');
  r = await api('POST', `/clients/${client.id}/payments`, { amount: 200, payment_method: 'Espèces' });
  assert.equal(r.status, 200); assert.equal(r.data.client.debt, 300); assert.equal(r.data.applied[0].amount, 200);
  assert.equal((await api('GET', '/cash')).data.balance, 4040); ok('client payment applied to oldest unpaid order + cash IN');
  r = await api('GET', `/clients/${client.id}/debts`);
  assert.equal(r.data.total_debt, 300); assert.equal(r.data.unpaid_orders.length, 1); assert.equal(r.data.unpaid_orders[0].status, 'Partial'); ok('GET /clients/:id/debts');

  // --- expenses, cash, stock ---
  r = await api('POST', '/expenses', { category: 'Encre', supplier: 'Color Supply', amount: 540.5, payment_method: 'Espèces' });
  assert.equal(r.status, 201);
  cash = (await api('GET', '/cash')).data;
  assert.equal(cash.balance, 3499.5); assert.equal(cash.entries[0].type, 'OUT'); ok('expense logged as cash OUT, balance 4040 - 540.50');
  r = await api('POST', '/cash/transaction', { type: 'OUT', amount: 99.5, description: 'Transport' });
  assert.equal(r.data.entry.running_balance, 3400); ok('manual cash transaction');
  assert.equal((await api('POST', '/cash/transaction', { type: 'IN', amount: -5, description: 'x' })).status, 400); ok('negative amount rejected');
  r = await api('PATCH', `/stock/${mat.id}`, { delta: 100 });
  assert.equal(r.data.item.current_stock, -324);
  assert.equal((await api('PATCH', `/stock/${mat.id}`, { delta: -1 })).status, 400); ok('restock a negative item OK; making it more negative -> 400');
  r = await api('PATCH', `/stock/${mat.id}`, { current_stock: 12 });
  assert.equal(r.data.item.low, true); assert.equal((await api('GET', '/alerts')).data.low_stock.length, 1); ok('absolute stock + low-stock alert');

  // --- dashboard ---
  const d = (await api('GET', '/dashboard')).data;
  assert.equal(d.today_revenue, 4340); assert.equal(d.monthly_revenue, 4340);
  assert.equal(d.monthly_expenses, 540.5); assert.equal(d.net_profit, 3799.5);
  assert.equal(d.unpaid_debts, 300); assert.equal(d.series.length, 12); assert.equal(d.top_items[0].name, 'Bâche 510g'); ok('dashboard metrics');

  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
} finally {
  await close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
