// Suppliers: money the imprimerie OWES (shops, other workshops, anyone). Run: node server/test/suppliers.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { startServer } from '../src/app.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-sup-'));
const { port, close, db } = await startServer({ dataDir, port: 0, jwtSecret: 'test-secret', staticDir: '/nonexistent' });
const base = `http://127.0.0.1:${port}/api`;
const jar = () => ({ c: '' });
async function api(method, url, body, j) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(j?.c ? { cookie: j.c } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie'); if (set && j) j.c = set.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function xlsx(url, j) {
  const res = await fetch(base + url, { headers: j?.c ? { cookie: j.c } : {} });
  if (res.status !== 200) return { status: res.status };
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); return { status: 200, wb };
}
const rows = (ws) => { const out = []; ws.eachRow((r, i) => { if (i > 1) out.push(r.values.slice(1)); }); return out; };
const colOf = (ws, h) => { let k = -1; ws.getRow(1).eachCell((c, i) => { if (String(c.value).startsWith(h)) k = i - 1; }); assert.ok(k >= 0, `no column ${h}`); return k; };
const val = (c) => (c && typeof c === 'object' && 'result' in c ? c.result : c);
const r2 = (n) => Math.round(n * 100) / 100;
let passed = 0; const ok = (n) => { passed++; console.log('  ✓', n); };

try {
  const owner = jar(), staff = jar();
  await api('POST', '/auth/signup', { shopName: 'Imprimerie Atlas', name: 'Youssef M', email: 'o@test.com', password: 'password123' }, owner);
  await api('POST', '/auth/signup', { name: 'Employe', email: 's@test.com', password: 'staffpass1', role: 'staff' }, owner);
  await api('POST', '/auth/login', { email: 's@test.com', password: 'staffpass1' }, staff);
  const dash = async () => (await api('GET', '/dashboard', null, owner)).data;
  const cash = async () => (await api('GET', '/cash', null, owner)).data;
  const supplier = async (id) => (await api('GET', `/suppliers/${id}`, null, owner)).data;

  // a sale and an expense so the profit figures have a starting point
  const cl = (await api('POST', '/clients', { name: 'Client Test' }, owner)).data.client.id;
  await api('POST', '/orders', { client_id: cl, product_service: 'Affiches', quantity: 100, unit_price: 1000, amount_paid: 100000 }, owner);
  await api('POST', '/expenses', { category: 'Encre', supplier: 'X', amount: 1000, payment_method: 'Espèces' }, owner);
  let D = await dash(); const D0 = D;
  assert.deepEqual([D.monthly_revenue, D.monthly_expenses, D.net_profit, D.supplier_debts], [100000, 1000, 99000, 0]);
  assert.equal((await cash()).balance, 99000); ok('starting point: revenue 100 000, expenses 1 000, profit 99 000, cash 99 000, owes nobody');

  // ---------- access ----------
  assert.equal((await api('GET', '/suppliers', null, jar())).status, 401);
  for (const [m, u, b] of [['GET', '/suppliers'], ['POST', '/suppliers', { name: 'x' }], ['GET', '/suppliers/1'], ['POST', '/suppliers/1/payments', { amount: 1 }]]) assert.equal((await api(m, u, b, staff)).status, 403);
  assert.equal((await xlsx('/export/suppliers.xlsx', staff)).status, 403); ok('suppliers are owner-only: employees get 403 (API and Excel)');

  // ---------- create ----------
  for (const [name, body] of [['bad kind', { name: 'A', kind: 'Banane' }], ['empty name', { name: '' }], ['negative debt', { name: 'A', opening_debt: -1 }]]) assert.equal((await api('POST', '/suppliers', body, owner)).status, 400, name);
  let r = await api('POST', '/suppliers', { name: 'Atelier Diallo', kind: 'Sous-traitant', phone: '+223 70 11 22 33', opening_debt: 20000 }, owner);
  assert.equal(r.status, 201); const A = r.data.supplier;
  assert.deepEqual([A.debt, A.opening_total, A.bills_count, A.status, A.kind], [20000, 20000, 0, 'debt', 'Sous-traitant']); ok('another workshop added with 20 000 already owed from before the app');
  const B = (await api('POST', '/suppliers', { name: 'Boutique Keïta' }, owner)).data.supplier;
  assert.deepEqual([B.debt, B.kind, B.status], [0, 'Fournisseur', 'ok']); ok('a shop added with nothing owed (type defaults to Fournisseur)');
  D = await dash();
  assert.deepEqual([D.supplier_debts, D.monthly_expenses, D.net_profit], [20000, 1000, 99000]); assert.equal((await cash()).balance, 99000);
  ok('dashboard: you owe 20 000; expenses, profit and cash unchanged (an old debt is not a cost of this month, and no money moved)');

  // ---------- something to pay: work passed to another workshop ----------
  r = await api('POST', `/suppliers/${A.id}/bills`, { description: 'Impression bâche 3 m', reference: 'CMD-1001', amount: 30000, due_date: '2099-01-31' }, owner);
  assert.equal(r.status, 201); assert.equal(r.data.bill.status, 'Unpaid'); const billA = r.data.bill; assert.equal(r.data.supplier.debt, 50000);
  D = await dash();
  assert.deepEqual([D.supplier_debts, D.monthly_expenses, D.net_profit, D.supplier_costs_month], [50000, 31000, 69000, 30000]);
  assert.equal((await cash()).balance, 99000); ok('work passed on, 30 000 not paid: you owe 50 000; it counts as a cost now (expenses 31 000, profit 69 000); cash unchanged');
  assert.equal(D.series.at(-1).expenses, 31000); ok('this month in the monthly chart also shows expenses 31 000');
  for (const [name, body] of [['zero amount', { description: 'x', amount: 0 }], ['no description', { amount: 5 }], ['paid more than amount', { description: 'x', amount: 5, amount_paid: 6 }]]) assert.equal((await api('POST', `/suppliers/${A.id}/bills`, body, owner)).status, 400, name);
  ok('refused: zero amount, missing description, paying more than the amount');

  // ---------- products taken from a shop, partly paid at once ----------
  r = await api('POST', `/suppliers/${B.id}/bills`, { description: 'Papier A3', amount: 5000, amount_paid: 2000, payment_method: 'Espèces' }, owner);
  assert.equal(r.status, 201); assert.equal(r.data.bill.status, 'Partial'); assert.equal(r.data.supplier.debt, 3000);
  D = await dash(); assert.deepEqual([D.supplier_debts, D.monthly_expenses, D.net_profit], [53000, 36000, 64000]);
  let c = await cash(); assert.equal(c.balance, 97000); assert.ok(c.entries[0].description.includes('Paiement fournisseur — Boutique Keïta') && c.entries[0].type === 'OUT');
  ok('shop products 5 000, 2 000 paid now: cash −2 000, you owe the shop 3 000, expenses +5 000');

  // ---------- paying a supplier ----------
  r = await api('POST', `/suppliers/${A.id}/payments`, { amount: 10000, payment_method: 'Espèces' }, owner);
  assert.equal(r.status, 200); assert.equal(r.data.applied.length, 1); assert.equal(r.data.applied[0].is_opening, true); assert.equal(r.data.supplier.debt, 40000);
  D = await dash(); assert.deepEqual([D.supplier_debts, D.monthly_expenses, D.net_profit], [43000, 36000, 64000]);
  c = await cash(); assert.equal(c.balance, 87000); assert.ok(c.entries[0].description.includes('dette antérieure')); ok('paying 10 000 goes to the oldest debt first; cash −10 000; expenses and profit unchanged (paying is not a second cost)');
  r = await api('POST', `/suppliers/${A.id}/payments`, { amount: 25000, payment_method: 'Virement' }, owner);
  assert.equal(r.data.applied.length, 2); assert.deepEqual(r.data.applied.map((x) => x.amount), [10000, 15000]); assert.equal(r.data.supplier.debt, 15000);
  assert.equal((await cash()).balance, 62000); ok('a 25 000 payment is split over the two oldest debts (10 000 + 15 000); debt now 15 000');
  for (const [name, body, id, code] of [['overpay', { amount: 15001 }, A.id, 400], ['zero', { amount: 0 }, A.id, 400], ['unknown', { amount: 1 }, 99999, 404]]) assert.equal((await api('POST', `/suppliers/${id}/payments`, body, owner)).status, code, name);
  ok('refused: paying more than owed, paying 0, unknown supplier');

  // ---------- editing ----------
  r = await api('PATCH', `/suppliers/${A.id}`, { name: 'Atelier Diallo & Fils', phone: '+223 70 99 99 99', kind: 'Autre', notes: 'Livre le jeudi' }, owner);
  assert.deepEqual([r.data.supplier.name, r.data.supplier.kind, r.data.supplier.notes, r.data.supplier.debt], ['Atelier Diallo & Fils', 'Autre', 'Livre le jeudi', 15000]); ok('name, type, phone and notes can be edited; debt kept');
  assert.equal((await api('PATCH', `/suppliers/${A.id}`, {}, owner)).status, 400); assert.equal((await api('PATCH', '/suppliers/99999', { name: 'x' }, owner)).status, 404);
  assert.equal((await api('PATCH', `/suppliers/${A.id}`, { opening_debt: 15000 }, owner)).status, 400);
  assert.equal((await api('PATCH', `/suppliers/${A.id}`, { opening_debt: 0 }, owner)).status, 400); ok('the previous debt cannot be set below what was already paid on it (20 000)');
  r = await api('PATCH', `/suppliers/${A.id}`, { opening_debt: 30000 }, owner);
  assert.equal(r.data.supplier.debt, 25000); D = await dash(); assert.deepEqual([D.supplier_debts, D.monthly_expenses], [28000, 36000]); ok('previous debt raised to 30 000: you owe +10 000 more; expenses unchanged');
  assert.equal((await api('PATCH', `/suppliers/${A.id}/bills/${billA.id}`, { amount: 12000 }, owner)).status, 400); ok('a line cannot go below what is already paid on it (15 000)');
  r = await api('PATCH', `/suppliers/${A.id}/bills/${billA.id}`, { amount: 40000 }, owner);
  assert.equal(r.status, 200); D = await dash(); assert.deepEqual([D.supplier_debts, D.monthly_expenses, D.net_profit], [38000, 46000, 54000]); ok('correcting a line to 40 000: you owe +10 000 and the cost +10 000 (profit −10 000)');
  await api('PATCH', `/suppliers/${A.id}/bills/${billA.id}`, { amount: 30000, description: 'Impression bâche 3 m (corrigé)' }, owner);
  D = await dash(); assert.deepEqual([D.supplier_debts, D.monthly_expenses], [28000, 36000]);
  const detail = await supplier(A.id); const openId = detail.bills.find((x) => x.is_opening).id;
  assert.equal((await api('PATCH', `/suppliers/${A.id}/bills/${openId}`, { amount: 5 }, owner)).status, 400);
  assert.equal((await api('DELETE', `/suppliers/${A.id}/bills/${openId}`, null, owner)).status, 400);
  assert.equal((await api('DELETE', `/suppliers/${A.id}/bills/${billA.id}`, null, owner)).status, 400); ok('lines already (partly) paid cannot be deleted; the previous debt is edited only from the supplier sheet');
  const tmp = (await api('POST', `/suppliers/${B.id}/bills`, { description: 'Saisi par erreur', amount: 7000 }, owner)).data.bill;
  D = await dash(); assert.deepEqual([D.supplier_debts, D.monthly_expenses], [35000, 43000]);
  assert.equal((await api('DELETE', `/suppliers/${B.id}/bills/${tmp.id}`, null, owner)).status, 200);
  D = await dash(); assert.deepEqual([D.supplier_debts, D.monthly_expenses], [28000, 36000]); ok('a line typed by mistake (nothing paid) can be deleted: debts and costs go back');

  // ---------- everything adds up ----------
  const list = (await api('GET', '/suppliers', null, owner)).data;
  const sumDebt = r2(list.suppliers.reduce((s, x) => s + x.debt, 0));
  assert.equal(sumDebt, D.supplier_debts); assert.equal(list.stats.total_debt, D.supplier_debts); assert.equal(list.stats.count, 2);
  assert.equal(list.stats.paid_month, 37000); assert.equal(list.stats.unpaid_bills, (await dash()).supplier_unpaid_count); ok('dashboard debts = sum of every supplier = the Fournisseurs page total; paid this month = 37 000');
  const sheetSum = r2((await Promise.all(list.suppliers.map((x) => supplier(x.id)))).reduce((s, d) => s + d.bills.reduce((q, b) => q + b.amount_due, 0), 0));
  assert.equal(sheetSum, D.supplier_debts); ok('…and = the unpaid lines inside the supplier sheets');
  assert.equal((await api('GET', '/suppliers?q=Boutique', null, owner)).data.suppliers.length, 1); ok('search by name works');
  const bad = await db.query(`SELECT count(*)::int AS n FROM (SELECT running_balance, amount, type, COALESCE(LAG(running_balance) OVER (ORDER BY id), 0) AS prev FROM cash_register) x
    WHERE round(x.running_balance - (x.prev + CASE WHEN x.type='IN' THEN x.amount ELSE -x.amount END), 2) <> 0`);
  assert.equal(bad[0].n, 0); ok('the cash register chain is still exact after all supplier payments');
  const hist = (await supplier(A.id)).payments; assert.deepEqual(hist.map((x) => x.amount).sort((a, b) => a - b), [10000, 10000, 15000]);
  assert.equal((await supplier(B.id)).payments.length, 1); ok('payment history kept: workshop 10 000 + 10 000 + 15 000, shop 2 000');

  // ---------- Excel ----------
  let x = await xlsx('/export/suppliers.xlsx', owner);
  assert.equal(x.status, 200); assert.deepEqual(x.wb.worksheets.map((w) => w.name), ['Fournisseurs', 'Achats et travaux', 'Paiements', 'Infos']);
  let ws = x.wb.getWorksheet('Fournisseurs'); let tr = rows(ws).at(-1); assert.equal(tr[0], 'TOTAL'); assert.equal(val(tr[colOf(ws, 'Reste à payer')]), D.supplier_debts); assert.equal(rows(ws).length, 3);
  ws = x.wb.getWorksheet('Achats et travaux'); tr = rows(ws).at(-1); assert.equal(val(tr[colOf(ws, 'Reste')]), D.supplier_debts);
  ws = x.wb.getWorksheet('Paiements'); tr = rows(ws).at(-1); assert.equal(val(tr[colOf(ws, 'Montant')]), 37000); ok('Excel: suppliers (debt = dashboard), lines (same), payments (37 000)');
  x = await xlsx('/export/report.xlsx', owner);
  const sum = Object.fromEntries(rows(x.wb.getWorksheet('Résumé')).map((row) => [row[0], row[1]]));
  assert.equal(sum['Dettes fournisseurs (ce que vous devez)'], D.supplier_debts); assert.equal(sum['Dépenses du mois'], D.monthly_expenses); assert.ok(x.wb.getWorksheet('Dettes fournisseurs'));
  ok('Excel report (owner): supplier debts and expenses equal the dashboard');
  x = await xlsx('/export/report.xlsx', staff);
  assert.equal(x.status, 200); assert.equal(x.wb.getWorksheet('Dettes fournisseurs'), undefined);
  assert.ok(!rows(x.wb.getWorksheet('Résumé')).some((row) => String(row[0]).includes('fournisseurs'))); ok('Excel report (employee): no supplier debts, no supplier names');

  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error('\nFAILED:', e.stack?.split('\n').slice(0, 5).join('\n') ?? e.message); process.exitCode = 1;
} finally { await close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
