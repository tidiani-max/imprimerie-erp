// Business tests: previous client debt, client editing, dashboard consistency, shop settings + logo, Excel exports.
// Every figure on the dashboard must follow from what was entered. Run: node server/test/business.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { startServer } from '../src/app.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-biz-'));
const { port, close } = await startServer({ dataDir, port: 0, jwtSecret: 'test-secret', staticDir: '/nonexistent' });
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
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  return { status: 200, type: res.headers.get('content-type'), disp: res.headers.get('content-disposition'), wb };
}
const sheetRows = (ws) => { const rows = []; ws.eachRow((r, i) => { if (i > 1) rows.push(r.values.slice(1)); }); return rows; };
const colIndex = (ws, header) => { let idx = -1; ws.getRow(1).eachCell((c, i) => { if (String(c.value).startsWith(header)) idx = i - 1; }); assert.ok(idx >= 0, `no column ${header}`); return idx; };
const r2 = (n) => Math.round(n * 100) / 100;
let passed = 0; const ok = (n) => { passed++; console.log('  ✓', n); };

try {
  const owner = jar(), staff = jar();
  await api('POST', '/auth/signup', { shopName: 'Imprimerie Atlas', name: 'Youssef M', email: 'o@test.com', password: 'password123' }, owner);
  await api('POST', '/auth/signup', { name: 'Employe', email: 's@test.com', password: 'staffpass1', role: 'staff' }, owner);
  await api('POST', '/auth/login', { email: 's@test.com', password: 'staffpass1' }, staff);
  const dash = async () => (await api('GET', '/dashboard', null, owner)).data;
  const cash = async () => (await api('GET', '/cash', null, owner)).data;
  const D0 = await dash();

  // ---------- shop settings, logo ----------
  let r = await api('GET', '/settings', null, staff);
  assert.equal(r.status, 200); assert.equal(r.data.currency, 'DH'); assert.equal(r.data.logo, null); assert.equal(r.data.shop_name, 'Imprimerie Atlas'); ok('everyone can read the shop settings (defaults ok)');
  assert.equal((await api('PUT', '/settings', { currency: 'FCFA' }, staff)).status, 403); ok('an employee cannot change them');
  r = await api('PUT', '/settings', { shop_address: '12 rue du Marché, Bamako', shop_phone: '+223 67 88 89 99', receipt_footer: 'Merci de votre confiance', currency: 'FCFA', receipt_format: 'ticket' }, owner);
  assert.equal(r.status, 200); assert.equal(r.data.currency, 'FCFA'); assert.equal(r.data.receipt_format, 'ticket'); assert.equal(r.data.shop_name, 'Imprimerie Atlas'); ok('owner saves address, phone, footer, currency and receipt format');
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  r = await api('PUT', '/settings', { logo: PNG }, owner); assert.equal(r.status, 200); assert.equal(r.data.logo, PNG);
  assert.equal((await api('GET', '/settings', null, staff)).data.logo, PNG); ok('logo saved and readable by employees (for printing receipts)');
  assert.equal((await api('PUT', '/settings', { logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }, owner)).status, 400);
  assert.equal((await api('PUT', '/settings', { logo: 'data:image/png;base64,' + Buffer.from('not an image at all').toString('base64') }, owner)).status, 400);
  const big = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(450_000, 1)]).toString('base64');
  assert.equal((await api('PUT', '/settings', { logo: big }, owner)).status, 400); ok('SVG, fake image and oversized logos are refused');
  assert.equal((await api('GET', '/settings', null, owner)).data.logo, PNG); ok('a refused logo does not replace the good one');

  // ---------- client with a debt from before the app ----------
  r = await api('POST', '/clients', { name: 'Fatou Traoré', phone: '+223 70 00 00 01', opening_debt: 50000 }, owner);
  assert.equal(r.status, 201); const A = r.data.client;
  assert.equal(A.debt, 50000); assert.equal(A.orders_count, 0); assert.equal(A.total_spent, 0); assert.equal(A.opening_total, 50000); assert.equal(A.status, 'debt');
  ok('new client can be created with a previous debt (a debt, not a sale)');
  let D = await dash();
  assert.equal(D.unpaid_debts, D0.unpaid_debts + 50000); assert.equal(D.monthly_revenue, D0.monthly_revenue); assert.equal(D.today_revenue, D0.today_revenue);
  assert.equal(D.orders_month, D0.orders_month); assert.equal(D.recent_orders.length, 0); assert.equal(D.top_items.length, 0); assert.equal(D.net_profit, D0.net_profit);
  ok('dashboard: debts +50 000; revenue, orders, best sellers and profit unchanged');
  assert.equal((await cash()).balance, 0); ok('cash register untouched: no money moved');
  assert.equal((await api('GET', '/orders', null, owner)).data.total, 0); ok('the previous debt is not listed as a sale');
  let debts = (await api('GET', `/clients/${A.id}/debts`, null, owner)).data;
  assert.deepEqual([debts.opening.total, debts.opening.paid, debts.opening.due], [50000, 0, 50000]); assert.equal(debts.unpaid_orders[0].is_opening, true);
  assert.equal((await api('PUT', `/orders/${debts.unpaid_orders[0].id}`, { amount_paid: 10 }, owner)).status, 400); ok('the previous debt cannot be edited as an ordinary order');

  // ---------- editing the client ----------
  r = await api('PATCH', `/clients/${A.id}`, { name: 'Fatou Traoré-Diallo', phone: '+223 70 99 99 99', email: 'fatou@mail.test' }, owner);
  assert.equal(r.status, 200); assert.equal(r.data.client.name, 'Fatou Traoré-Diallo'); assert.equal(r.data.client.email, 'fatou@mail.test'); assert.equal(r.data.client.debt, 50000); ok('name, phone and e-mail can be edited; debt kept');
  assert.equal((await api('PATCH', `/clients/${A.id}`, {}, owner)).status, 400);
  assert.equal((await api('PATCH', '/clients/9999', { name: 'x' }, owner)).status, 404);
  assert.equal((await api('PATCH', `/clients/${A.id}`, { email: 'not-an-email' }, owner)).status, 400); ok('empty edit, unknown client and bad e-mail are refused');
  assert.equal((await api('PATCH', `/clients/${A.id}`, { phone: '' }, owner)).data.client.phone, null); await api('PATCH', `/clients/${A.id}`, { phone: '+223 70 99 99 99' }, owner); ok('a phone number can be cleared');
  r = await api('PATCH', `/clients/${A.id}`, { opening_debt: 70000 }, owner);
  assert.equal(r.data.client.debt, 70000); D = await dash(); assert.equal(D.unpaid_debts, D0.unpaid_debts + 70000); ok('raising the previous debt to 70 000 moves the dashboard debts by exactly +20 000');

  // ---------- the client pays part of it ----------
  r = await api('POST', `/clients/${A.id}/payments`, { amount: 30000, payment_method: 'Espèces' }, owner);
  assert.equal(r.status, 200); assert.equal(r.data.client.debt, 40000); assert.equal(r.data.applied[0].is_opening, true);
  let c = await cash(); assert.equal(c.balance, 30000); assert.ok(c.entries[0].description.includes('REP-') && c.entries[0].type === 'IN'); ok('payment lowers the debt and the cash register receives exactly that money');
  D = await dash(); assert.equal(D.unpaid_debts, D0.unpaid_debts + 40000); assert.equal(D.monthly_revenue, D0.monthly_revenue); ok('dashboard debts −30 000 while revenue stays the same (collecting an old debt is not a new sale)');
  assert.equal((await api('PATCH', `/clients/${A.id}`, { opening_debt: 20000 }, owner)).status, 400);
  assert.equal((await api('PATCH', `/clients/${A.id}`, { opening_debt: 0 }, owner)).status, 400); ok('the previous debt cannot be set below what was already paid on it');
  assert.equal((await api('POST', `/clients/${A.id}/payments`, { amount: 40001 }, owner)).status, 400); ok('overpaying a debt is refused');

  // ---------- zero / add later ----------
  const B = (await api('POST', '/clients', { name: 'Ibrahim Keita', opening_debt: 1000 }, owner)).data.client;
  r = await api('PATCH', `/clients/${B.id}`, { opening_debt: 0 }, owner);
  assert.equal(r.data.client.debt, 0); assert.equal(r.data.client.opening_total, 0); assert.equal((await api('GET', `/clients/${B.id}/debts`, null, owner)).data.opening, null); ok('a previous debt with nothing paid can be removed (set to 0)');
  r = await api('PATCH', `/clients/${B.id}`, { opening_debt: 2500 }, owner);
  assert.equal(r.data.client.debt, 2500); ok('a previous debt can be added later to an existing client');
  const Cc = (await api('POST', '/clients', { name: 'Sans Dette' }, owner)).data.client;
  assert.equal(Cc.debt, 0); assert.equal((await api('POST', '/clients', { name: 'Neg', opening_debt: -5 }, owner)).status, 400); ok('no debt by default; negative debt refused');

  // ---------- real activity must flow into the same numbers ----------
  const stock = (await api('POST', '/stock', { ref: 'PAP-A3', item: 'Papier A3', initial_stock: 500, purchase_price: 2, alert_threshold: 10, unit: 'pcs' }, owner)).data;
  const stockId = (stock.item ?? stock).id;
  const o1 = (await api('POST', '/orders', { client_id: A.id, product_service: 'Affiche A3', quantity: 10, unit_price: 100, amount_paid: 400, inventory_id: stockId }, owner)).data.order; // 1000, paid 400
  const o2 = (await api('POST', '/orders', { client_id: Cc.id, product_service: 'Bâche 2x1', quantity: 2, unit_price: 750, amount_paid: 1500 }, owner)).data.order; // 1500 fully paid
  await api('POST', '/expenses', { category: 'Encre', supplier: 'Fournisseur X', amount: 250, payment_method: 'Espèces' }, owner);
  D = await dash();
  assert.equal(D.monthly_revenue, 2500); assert.equal(D.today_revenue, 2500); assert.equal(D.orders_month, 2); assert.equal(D.monthly_expenses, 250); assert.equal(D.net_profit, 2250);
  assert.equal(D.unpaid_debts, 40000 + 2500 + 600); ok('dashboard: revenue 2 500, expenses 250, profit 2 250, debts = 40 000 + 2 500 + 600');
  const cl = (await api('GET', '/clients', null, owner)).data;
  const sumDebt = r2(cl.clients.reduce((s, x) => s + x.debt, 0));
  assert.equal(sumDebt, D.unpaid_debts); assert.equal(cl.stats.total_debt, D.unpaid_debts); ok('dashboard debts = sum of every client\'s debt = Clients page total');
  let unpaidSum = 0; for (const x of cl.clients) unpaidSum += (await api('GET', `/clients/${x.id}/debts`, null, owner)).data.unpaid_orders.reduce((s, o) => s + o.amount_due, 0);
  assert.equal(r2(unpaidSum), D.unpaid_debts); ok('…and = the sum of all unpaid lines in the client sheets');
  c = await cash(); assert.equal(c.balance, 30000 + 400 + 1500 - 250); ok('cash balance = 30 000 + 400 + 1 500 − 250');
  r = await api('PUT', `/orders/${o1.id}`, { amount_paid: 1000 }, owner);
  assert.equal(r.status, 200); D = await dash(); assert.equal(D.unpaid_debts, 40000 + 2500); assert.equal((await cash()).balance, 30000 + 400 + 1500 - 250 + 600); ok('paying the rest of an order: debts −600 and cash +600 together');
  assert.equal((await api('GET', '/orders', null, owner)).data.orders.find((o) => o.id === o1.id).client_name, 'Fatou Traoré-Diallo'); ok('the corrected client name shows on orders (same record everywhere)');
  assert.equal(D.recent_orders.find((o) => o.id === o1.id).client_name, 'Fatou Traoré-Diallo'); ok('…and in the dashboard\'s recent orders');
  const alerts = (await api('GET', '/dashboard/alerts', null, owner)).data; assert.ok(Array.isArray(alerts.low_stock)); ok('alerts endpoint still works');

  // ---------- Excel exports ----------
  assert.equal((await xlsx('/export/orders.xlsx', jar())).status, 401); ok('exports need a login');
  let x = await xlsx('/export/orders.xlsx', staff);
  assert.equal(x.status, 200); assert.ok(x.type.includes('spreadsheetml')); assert.match(x.disp, /attachment; filename="commandes-\d{4}-\d{2}-\d{2}\.xlsx"/); ok('employees can export; correct Excel content type and file name');
  let ws = x.wb.getWorksheet('Commandes'); let rows = sheetRows(ws);
  assert.equal(rows.length, 3); // 2 orders + TOTAL row (previous-debt row not included)
  const totCol = colIndex(ws, 'Total (FCFA)'), dueCol = colIndex(ws, 'Reste à payer (FCFA)'), stCol = colIndex(ws, 'Statut');
  assert.equal(rows.at(-1)[0], 'TOTAL'); assert.equal(rows.at(-1)[totCol].result ?? rows.at(-1)[totCol], 2500);
  assert.ok(rows.slice(0, 2).every((row) => ['Payé', 'Partiel', 'Impayé'].includes(row[stCol]))); ok('orders sheet: 2 sales only, FCFA headers, French statuses, TOTAL = 2 500');
  assert.equal(r2(rows.slice(0, 2).reduce((s, row) => s + row[dueCol], 0)), 0); // both fully paid now
  x = await xlsx('/export/orders.xlsx?status=Unpaid', owner); assert.equal(sheetRows(x.wb.getWorksheet('Commandes')).length, 0); ok('the status filter applies to the export');
  x = await xlsx('/export/orders.xlsx?q=' + encodeURIComponent('Bâche') + '', owner); assert.equal(sheetRows(x.wb.getWorksheet('Commandes')).length, 2); ok('the search filter applies to the export (1 order + total)');
  assert.equal(x.wb.getWorksheet('Infos').getRow(1).getCell(2).value, 'Imprimerie Atlas'); ok('"Infos" sheet carries the shop name');

  x = await xlsx('/export/clients.xlsx', owner); ws = x.wb.getWorksheet('Clients'); rows = sheetRows(ws);
  const debtCol = colIndex(ws, 'Dette actuelle'), openCol = colIndex(ws, 'dont dette antérieure');
  assert.equal(rows.at(-1)[0], 'TOTAL'); const t = rows.at(-1);
  assert.equal(t[debtCol].result ?? t[debtCol], D.unpaid_debts); assert.equal(t[openCol].result ?? t[openCol], 40000 + 2500); assert.equal(rows.length - 1, cl.clients.length); ok('clients sheet: debt total = dashboard debts; previous-debt column = 42 500');

  x = await xlsx('/export/stock.xlsx', owner); assert.equal(sheetRows(x.wb.getWorksheet('Stock')).length, 2); ok('stock sheet exported (1 item + total)');
  x = await xlsx('/export/expenses.xlsx', owner); ws = x.wb.getWorksheet('Dépenses'); rows = sheetRows(ws); const amt = colIndex(ws, 'Montant');
  assert.equal(rows.length, 2); assert.equal(rows.at(-1)[amt].result ?? rows.at(-1)[amt], 250); ok('expenses sheet: 1 expense, total 250');
  x = await xlsx('/export/cash.xlsx', owner); ws = x.wb.getWorksheet('Caisse'); rows = sheetRows(ws);
  const inC = colIndex(ws, 'Entrée'), outC = colIndex(ws, 'Sortie'); const ct = rows.at(-1);
  assert.equal((ct[inC].result ?? ct[inC]) - (ct[outC].result ?? ct[outC]), (await cash()).balance); ok('cash sheet: total in − total out = the cash balance on screen');

  x = await xlsx('/export/report.xlsx', owner);
  const summary = Object.fromEntries(sheetRows(x.wb.getWorksheet('Résumé')).map((row) => [row[0], row[1]]));
  D = await dash();
  assert.equal(summary["Chiffre d'affaires du mois"], D.monthly_revenue); assert.equal(summary['Bénéfice estimé du mois'], D.net_profit);
  assert.equal(summary['Dettes clients impayées'], D.unpaid_debts); assert.equal(summary['Solde de la caisse'], (await cash()).balance); ok('Excel report summary = dashboard + cash, to the cent');
  const debtorsSum = r2(sheetRows(x.wb.getWorksheet('Dettes clients')).slice(0, -1).reduce((s, row) => s + row[2], 0)); assert.equal(debtorsSum, D.unpaid_debts); ok('report: the list of debtors adds up to the dashboard debts');

  // ---------- banners, stickers, labels: priced by surface ----------
  const RATES = { 'Bâche': 0.3, 'Autocollant': 0.3, 'Perforé': 0.45, 'Étiquettes': 0.45, 'Transparents': 0.45 };
  assert.deepEqual((await api('GET', '/settings', null, staff)).data.print_rates, RATES); ok('default tariffs per cm²: bâche & autocollant 0,30; perforé, étiquettes & transparents 0,45');
  const mk = (body, j = owner) => api('POST', '/orders', { client_id: Cc.id, ...body }, j);
  r = await mk({ support_type: 'Bâche', width_cm: 200, height_cm: 100, quantity: 2 });
  assert.equal(r.status, 201); const bache = r.data.order;
  assert.deepEqual([bache.product_service, bache.unit_price, bache.total_amount, bache.width_cm, bache.height_cm, bache.rate_cm2, bache.extra_fees], ['Bâche', 6000, 12000, 200, 100, 0.3, 0]);
  ok('bâche 200 × 100 cm = 20 000 cm² × 0,30 = 6 000 per piece; 2 pieces = 12 000');
  r = await mk({ support_type: 'Autocollant', width_cm: 50, height_cm: 30, quantity: 1, extra_fees: 500 });
  assert.equal(r.data.order.unit_price, 950); ok('autocollant 50 × 30 = 1 500 × 0,30 = 450, plus 500 extra fees = 950');
  r = await mk({ support_type: 'Étiquettes', width_cm: 10, height_cm: 5, quantity: 100 });
  assert.equal(r.data.order.unit_price, 22.5); assert.equal(r.data.order.total_amount, 2250); ok('étiquettes 10 × 5 = 50 × 0,45 = 22,50 per label; 100 labels = 2 250');
  assert.equal((await mk({ support_type: 'Transparents', width_cm: 30, height_cm: 20, quantity: 1 })).data.order.unit_price, 270);
  assert.equal((await mk({ support_type: 'Perforé', width_cm: 100, height_cm: 50, quantity: 1 })).data.order.unit_price, 2250); ok('transparents 30 × 20 = 270 and perforé 100 × 50 = 2 250 (rate 0,45)');
  assert.equal((await mk({ support_type: 'Bâche', width_cm: 10, height_cm: 10, quantity: 1, unit_price: 1 })).data.order.unit_price, 30); ok('a price sent by the screen is ignored: the server always calculates');
  for (const [name, body] of [
    ['unknown support', { support_type: 'Banane', width_cm: 10, height_cm: 10, quantity: 1 }], ['no height', { support_type: 'Bâche', width_cm: 10, quantity: 1 }],
    ['width 0', { support_type: 'Bâche', width_cm: 0, height_cm: 10, quantity: 1 }], ['negative fees', { support_type: 'Bâche', width_cm: 10, height_cm: 10, quantity: 1, extra_fees: -5 }],
    ['standard item without a price', { product_service: 'Flyers', quantity: 1 }], ['quantity 0', { support_type: 'Bâche', width_cm: 10, height_cm: 10, quantity: 0 }],
  ]) assert.equal((await mk(body)).status, 400, name);
  ok('refused: unknown support, missing/zero size, negative fees, item without price, zero quantity');
  assert.equal((await mk({ product_service: 'Flyers A5', quantity: 100, unit_price: 5 })).status, 201); ok('ordinary items (free text + price) still work');

  assert.equal((await api('PUT', '/settings', { print_rates: { 'Bâche': 0.5 } }, staff)).status, 403); ok('an employee cannot change the tariffs');
  assert.equal((await api('PUT', '/settings', { print_rates: { 'Bâche': -1 } }, owner)).status, 400);
  r = await api('PUT', '/settings', { print_rates: { 'Bâche': 0.5 } }, owner);
  assert.equal(r.data.print_rates['Bâche'], 0.5); assert.equal(r.data.print_rates['Étiquettes'], 0.45); ok('owner changes the bâche tariff to 0,50; the others stay');
  r = await mk({ support_type: 'Bâche', width_cm: 200, height_cm: 100, quantity: 1 });
  assert.equal(r.data.order.unit_price, 10000); assert.equal(r.data.order.rate_cm2, 0.5);
  const old = (await api('GET', `/orders/${bache.id}`, null, owner)).data.order;
  assert.equal(old.unit_price, 6000); assert.equal(old.rate_cm2, 0.3); ok('new orders use 0,50 (10 000); the earlier order keeps its 0,30 price (6 000)');
  await api('PUT', '/settings', { print_rates: { 'Bâche': 0.3 } }, owner);
  D = await dash(); assert.ok(D.top_items.some((t) => t.name === 'Bâche')); ok('best sellers group by support type ("Bâche"), not by every size');

  // receipt: the order plus where the client's account stands (all debts, previous debt included)
  const ar = await mk({ client_id: A.id, support_type: 'Bâche', width_cm: 200, height_cm: 100, quantity: 1, amount_paid: 1000 });
  assert.equal(ar.status, 201);
  r = await api('GET', `/orders/${ar.data.order.id}/receipt`, null, staff);
  const aNow = (await api('GET', '/clients', null, owner)).data.clients.find((x) => x.id === A.id);
  const aOpen = (await api('GET', `/clients/${A.id}/debts`, null, owner)).data.opening;
  assert.equal(r.status, 200); assert.equal(r.data.client.debt, aNow.debt); assert.equal(r.data.client.opening_due, aOpen.due);
  assert.equal(r.data.client.debt, aOpen.due + 5000); assert.equal(r.data.order.amount_due, 5000); ok('receipt data: total client debt = previous debt 40 000 + 5 000 left on this order = 45 000');
  assert.equal((await api('GET', '/orders/999999/receipt', null, owner)).status, 404); ok('unknown order: 404');

  x = await xlsx('/export/orders.xlsx', owner); ws = x.wb.getWorksheet('Commandes');
  const sup = colIndex(ws, 'Support'), wid = colIndex(ws, 'Largeur'), sur = colIndex(ws, 'Surface'), fee = colIndex(ws, 'Frais suppl.');
  const bandRow = sheetRows(ws).find((row) => row[sup] === 'Bâche' && row[wid] === 200 && row[colIndex(ws, 'Total (FCFA)')] === 12000);
  assert.ok(bandRow); assert.equal(bandRow[sur], 2); assert.equal(bandRow[fee], 0); ok('Excel orders sheet: Support, width, height, surface (2 m²) and extra-fee columns');

  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error('\nFAILED:', e.stack?.split('\n').slice(0, 4).join('\n') ?? e.message); process.exitCode = 1;
} finally { await close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
