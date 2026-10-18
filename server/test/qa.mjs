// QA suite: ACCURACY with many devices on one account + SPEED with large data volumes.
// Pure Node, same code on Windows / macOS / Linux.
//
//   pnpm qa                      quick run  (100 000 orders)
//   pnpm qa:full                 full run   (1 000 000 orders)
//   node server/test/qa.mjs --rows=250000 --devices=12 --workers=20 --seconds=20 --out=qa-report.md
//
// Exit code 1 = a data-accuracy check failed. Slow timings only warn (add --strict to fail on them).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { startServer } from '../src/app.js';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};
const ROWS = Number(arg('rows', 100_000));
const DEVICES = Number(arg('devices', 12)); // separate logins of the SAME account (login limit is 20 / 15 min)
const WORKERS = Number(arg('workers', 20)); // parallel users in the mixed-load phase
const SECONDS = Number(arg('seconds', 15));
const STRICT = process.argv.includes('--strict');
const OUT = arg('out', 'qa-report.md');
const FAST_MS = 300, SLOW_MS = 1500; // p95 thresholds for an interactive screen

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-qa-'));
const t0 = performance.now();
const { port, close, db } = await startServer({ dataDir, port: 0, jwtSecret: 'qa-secret', staticDir: '/nonexistent' });
const base = `http://127.0.0.1:${port}/api`;

const lines = []; // report
const say = (s = '') => { console.log(s); lines.push(s); };
let accuracyFailures = 0;
const speedRows = [];

// ---------- helpers ----------
async function http(method, url, body, cookie) {
  const start = performance.now();
  const send = () => fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  // A keep-alive socket that sat idle can be closed by the server just as we reuse it: retry once on a fresh one.
  const res = await send().catch((e) => (e?.cause?.code === 'ECONNRESET' ? send() : Promise.reject(e)));
  const text = await res.text();
  const ms = performance.now() - start;
  let data = null;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, data, ms, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
async function pool(n, tasks) { // run task functions with n in flight
  const results = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < tasks.length) { const k = i++; results[k] = await tasks[k](); }
  }));
  return results;
}
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };
const r2 = (n) => Math.round(Number(n) * 100) / 100;
function check(name, ok, detail = '') {
  if (!ok) accuracyFailures++;
  say(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

// ---------- environment ----------
say('# QA report — Imprimerie ERP');
say();
say(`- Date: ${new Date().toISOString()}`);
say(`- Machine: ${os.type()} ${os.release()} ${os.arch()}, ${os.cpus().length} × ${os.cpus()[0]?.model ?? 'cpu'}, ${(os.totalmem() / 2 ** 30).toFixed(1)} GB RAM`);
say(`- Node ${process.version}, database: ${db.kind}`);
say(`- Settings: ${ROWS.toLocaleString()} orders, ${DEVICES} devices on one account, ${WORKERS} parallel users × ${SECONDS}s`);

// ================= PART 1: ACCURACY =================
say();
say('## 1. Accuracy — many devices, one account, same time');

let r = await http('POST', '/auth/signup', { shopName: 'QA Imprimerie', name: 'Owner QA', email: 'owner@qa.test', password: 'password123', role: 'owner' });
check('owner account created', r.status === 201, `status ${r.status}`);
const cookies = [r.cookie];
for (let i = 1; i < DEVICES; i++) {
  const l = await http('POST', '/auth/login', { email: 'owner@qa.test', password: 'password123' });
  cookies.push(l.cookie);
}
check(`${DEVICES} devices logged in with the SAME account`, cookies.every(Boolean));
const ck = (i) => cookies[i % cookies.length];

// shared data set up from device 0
const clientIds = [];
for (let i = 0; i < 5; i++) clientIds.push((await http('POST', '/clients', { name: `Client QA ${i}`, phone: `06000000${i}` }, ck(0))).data.client.id);
const stock = (await http('POST', '/stock', { ref: 'QA-PAPER', item: 'Papier QA', initial_stock: 5000, purchase_price: 2, alert_threshold: 5, unit: 'pcs' }, ck(0))).data;
const stockId = (stock.item ?? stock).id;

// 1a. 600 orders created at once from all devices (each pays 10 of 20)
const N_ORD = 600;
const t1 = performance.now();
const created = await pool(WORKERS, Array.from({ length: N_ORD }, (_, i) => () =>
  http('POST', '/orders', { client_id: clientIds[i % 5], product_service: 'Affiche QA', quantity: 1, unit_price: 20, amount_paid: 10, inventory_id: stockId }, ck(i))));
const okOrders = created.filter((x) => x.status === 201);
say(`  ${N_ORD} orders sent in parallel from ${DEVICES} devices: ${okOrders.length} accepted in ${((performance.now() - t1) / 1000).toFixed(1)}s`);
check('every order accepted', okOrders.length === N_ORD, `${okOrders.length}/${N_ORD}`);
const numbers = okOrders.map((x) => x.data.order.order_number);
check('no duplicate order numbers', new Set(numbers).size === numbers.length);
const [stk] = await db.query('SELECT current_stock FROM inventory WHERE id=$1', [stockId]);
check('stock decreased exactly once per order', stk.current_stock === 5000 - okOrders.length, `stock ${stk.current_stock}, expected ${5000 - okOrders.length}`);

// 1b. two devices pay the SAME order at the same time (60 orders)
const sample = okOrders.slice(0, 60).map((x) => x.data.order);
await pool(WORKERS, sample.flatMap((o, i) => [
  () => http('PUT', `/orders/${o.id}`, { amount_paid: 15 }, ck(i)),
  () => http('PUT', `/orders/${o.id}`, { amount_paid: 20 }, ck(i + 1)),
]));
const settled = await db.query('SELECT amount_paid, status, total_amount FROM orders WHERE id = ANY($1)', [sample.map((o) => o.id)]);
check('simultaneous payments on one order end in a valid state',
  settled.every((o) => (o.amount_paid === 15 || o.amount_paid === 20) && o.status === (o.amount_paid >= o.total_amount ? 'Paid' : 'Partial')));

// 1c. oversell: 10 units of stock, 50 devices each ask for 1
const small = (await http('POST', '/stock', { ref: 'QA-RARE', item: 'Matière rare', initial_stock: 10, purchase_price: 1, alert_threshold: 1, unit: 'pcs' }, ck(0))).data;
const smallId = (small.item ?? small).id;
const race = await pool(WORKERS, Array.from({ length: 50 }, (_, i) => () =>
  http('POST', '/orders', { client_id: clientIds[0], product_service: 'Rare', quantity: 1, unit_price: 1, amount_paid: 0, inventory_id: smallId }, ck(i))));
const won = race.filter((x) => x.status === 201).length, refused = race.filter((x) => x.status === 409).length;
const [rare] = await db.query('SELECT current_stock FROM inventory WHERE id=$1', [smallId]);
check('overselling impossible: exactly 10 of 50 orders accepted', won === 10 && refused === 40, `accepted ${won}, refused ${refused}`);
check('stock never negative', rare.current_stock === 0, `stock ${rare.current_stock}`);

// 1d. concurrent expenses + manual cash entries mixed in
await pool(WORKERS, Array.from({ length: 100 }, (_, i) => () =>
  i % 2
    ? http('POST', '/expenses', { category: 'Encre', supplier: 'QA', amount: 7.5, payment_method: 'Espèces', observation: 'qa' }, ck(i))
    : http('POST', '/cash/transaction', { description: 'Ajustement QA', type: i % 4 ? 'IN' : 'OUT', amount: 3, payment_method: 'Espèces' }, ck(i))));

// final invariants, straight from the database
const bad = await db.query(`
  SELECT count(*)::int AS n FROM (
    SELECT running_balance, amount, type,
           COALESCE(LAG(running_balance) OVER (ORDER BY id), 0) AS prev
    FROM cash_register) x
  WHERE round(x.running_balance - (x.prev + CASE WHEN x.type='IN' THEN x.amount ELSE -x.amount END), 2) <> 0`);
check('cash register: every running balance = previous balance ± amount (no gaps, no double counting)', bad[0].n === 0, `${bad[0].n} broken rows`);
const [cash] = await db.query(`SELECT COALESCE(SUM(CASE WHEN type='IN' THEN amount ELSE -amount END),0) AS net,
  COALESCE((SELECT running_balance FROM cash_register ORDER BY id DESC LIMIT 1),0) AS last FROM cash_register`);
check('cash register: last balance = total in − total out', r2(cash.net) === r2(cash.last), `${r2(cash.net)} vs ${r2(cash.last)}`);
const [ord] = await db.query(`SELECT COALESCE(SUM(amount_paid),0) AS paid FROM orders`);
const [orderCash] = await db.query(`SELECT COALESCE(SUM(CASE WHEN type='IN' THEN amount ELSE -amount END),0) AS net FROM cash_register WHERE description ILIKE '%CMD-%'`);
check('money collected on orders = cash entries for orders', r2(ord.paid) === r2(orderCash.net), `${r2(ord.paid)} vs ${r2(orderCash.net)}`);
const drift = await db.query(`SELECT count(*)::int AS n FROM clients c WHERE round(c.total_spent - COALESCE((SELECT SUM(total_amount) FROM orders o WHERE o.client_id=c.id AND NOT o.is_opening),0),2) <> 0`);
check('every client total = sum of that client\'s orders', drift[0].n === 0, `${drift[0].n} clients off`);
const badStatus = await db.query(`SELECT count(*)::int AS n FROM orders WHERE status <> CASE WHEN amount_paid >= total_amount THEN 'Paid' WHEN amount_paid > 0 THEN 'Partial' ELSE 'Unpaid' END`);
check('every order status matches its payments', badStatus[0].n === 0, `${badStatus[0].n} mismatches`);
const [seen] = (await http('GET', '/orders?limit=1', null, ck(7))).data.orders.length ? [1] : [0];
check('a different device sees the data entered by the others', seen === 1);

// ================= PART 2: SPEED AT SCALE =================
say();
say(`## 2. Speed — ${ROWS.toLocaleString()} orders in the database`);

const nClients = Math.max(100, Math.round(ROWS / 20));
const nExpenses = Math.max(100, Math.round(ROWS / 10));
const nCash = Math.max(100, Math.round(ROWS / 10));
const seedStart = performance.now();
await db.exec(`INSERT INTO clients (name, phone, email)
  SELECT 'Client ' || g, '06' || lpad((g % 100000000)::text, 8, '0'), 'client' || g || '@mail.test' FROM generate_series(1, ${nClients}) g`);
const [{ base_id }] = await db.query(`SELECT (max(id) - ${nClients} + 1)::int AS base_id FROM clients`);
await db.exec(`INSERT INTO inventory (ref, item, initial_stock, current_stock, purchase_price, alert_threshold, unit)
  SELECT 'REF-' || g, 'Matière ' || g, 1000, 1000 - (g % 900), 1 + g % 50, 50, 'pcs' FROM generate_series(1, 200) g`);
const CHUNK = 50_000;
for (let lo = 1; lo <= ROWS; lo += CHUNK) {
  const hi = Math.min(ROWS, lo + CHUNK - 1);
  await db.exec(`
    INSERT INTO orders (order_number, client_id, product_service, quantity, unit_price, amount_paid, payment_method, status, order_date, due_date)
    SELECT 'S-' || g, (${base_id} + (g * 7919) % ${nClients})::int,
           (ARRAY['Affiche A3','Bâche 2x1m','Carte de visite','Flyer A5','Brochure','Autocollant','Banderole','Tampon'])[1 + g % 8],
           1 + g % 20, 5 + g % 40,
           CASE g % 3 WHEN 0 THEN (1 + g % 20) * (5 + g % 40) WHEN 1 THEN round(((1 + g % 20) * (5 + g % 40)) / 2.0, 2) ELSE 0 END,
           (ARRAY['Espèces','Carte','Virement','Chèque'])[1 + g % 4],
           CASE g % 3 WHEN 0 THEN 'Paid' WHEN 1 THEN 'Partial' ELSE 'Unpaid' END,
           CURRENT_DATE - ((${ROWS} - g) * 730 / ${ROWS})::int,
           CASE WHEN g % 3 = 0 THEN NULL ELSE CURRENT_DATE - ((${ROWS} - g) * 730 / ${ROWS})::int + 30 END
    FROM generate_series(${lo}::bigint, ${hi}::bigint) g`);
  if (ROWS >= 200_000) process.stdout.write(`\r  seeding orders ${hi.toLocaleString()} / ${ROWS.toLocaleString()}   `);
}
if (ROWS >= 200_000) process.stdout.write('\n');
await db.exec(`UPDATE clients c SET total_spent = s.t FROM (SELECT client_id, SUM(total_amount) t FROM orders WHERE order_number LIKE 'S-%' GROUP BY client_id) s WHERE s.client_id = c.id`);
await db.exec(`INSERT INTO expenses (category, supplier, amount, payment_method, observation, expense_date)
  SELECT (ARRAY['Encre','Bâche','Électricité','Salaire','Loyer'])[1 + g % 5], 'Fournisseur ' || (g % 300), 10 + g % 900, 'Espèces', 'obs ' || g,
         CURRENT_DATE - ((${nExpenses} - g) * 730 / ${nExpenses})::int FROM generate_series(1, ${nExpenses}) g`);
const [{ last }] = await db.query(`SELECT COALESCE((SELECT running_balance FROM cash_register ORDER BY id DESC LIMIT 1), 0)::float AS last`);
await db.exec(`INSERT INTO cash_register (description, type, amount, payment_method, running_balance)
  SELECT 'Mouvement ' || g, CASE WHEN g % 4 < 3 THEN 'IN' ELSE 'OUT' END, 10 + g % 500, 'Espèces',
         ${last} + SUM(CASE WHEN g % 4 < 3 THEN 10 + g % 500 ELSE -(10 + g % 500) END) OVER (ORDER BY g)
  FROM generate_series(1, ${nCash}) g`);
await db.exec('ANALYZE');
say(`  loaded ${ROWS.toLocaleString()} orders, ${nClients.toLocaleString()} clients, ${nExpenses.toLocaleString()} expenses, ${nCash.toLocaleString()} cash entries in ${((performance.now() - seedStart) / 1000).toFixed(0)}s`);
say();

async function timeIt(label, fn, runs = 15) {
  await fn(); // warm-up
  const ms = [];
  let failed = 0;
  for (let i = 0; i < runs; i++) { const x = await fn(); ms.push(x.ms); if (x.status >= 400) failed++; }
  const row = { label, p50: pct(ms, 50), p95: pct(ms, 95), max: Math.max(...ms), failed };
  speedRows.push(row);
  const verdict = failed ? 'ERROR' : row.p95 <= FAST_MS ? 'FAST' : row.p95 <= SLOW_MS ? 'OK' : 'SLOW';
  say(`  ${verdict.padEnd(5)} ${label.padEnd(44)} median ${row.p50.toFixed(0).padStart(5)} ms   p95 ${row.p95.toFixed(0).padStart(5)} ms${failed ? `   (${failed} errors)` : ''}`);
  row.verdict = verdict;
}
const A = ck(0);
await timeIt('Dashboard', () => http('GET', '/dashboard', null, A));
await timeIt('Orders — first page (200)', () => http('GET', '/orders?limit=200', null, A));
await timeIt('Orders — page in the middle of the data', () => http('GET', `/orders?limit=200&offset=${Math.max(0, Math.floor(ROWS / 2))}`, null, A), 8);
await timeIt('Orders — filter "Impayé"', () => http('GET', '/orders?status=Unpaid&limit=200', null, A));
await timeIt('Orders — this month', () => http('GET', '/orders?period=month&limit=200', null, A));
await timeIt('Orders — search by text', () => http('GET', '/orders?q=Bache&limit=200', null, A), 6);
await timeIt('Orders — search by order number', () => http('GET', `/orders?q=S-${Math.floor(ROWS / 3)}&limit=200`, null, A), 6);
await timeIt('Clients — full list', () => http('GET', '/clients', null, A), 6);
await timeIt('Clients — search', () => http('GET', '/clients?q=Client 1234', null, A), 6);
await timeIt('Client — debt detail', () => http('GET', `/clients/${base_id + 50}/debts`, null, A));
await timeIt('Stock — list', () => http('GET', '/stock', null, A));
await timeIt('Cash — list + balance', () => http('GET', '/cash', null, A));
await timeIt('Expenses — list', () => http('GET', '/expenses', null, A));
await timeIt('Create an order (full transaction)', () =>
  http('POST', '/orders', { client_id: base_id + 7, product_service: 'Affiche', quantity: 2, unit_price: 15, amount_paid: 10, inventory_id: 1, allow_negative_stock: true }, A), 25);
await timeIt('Record a payment on an order', async () => {
  const id = (await db.query(`SELECT id FROM orders WHERE order_number LIKE 'CMD-%' ORDER BY id DESC LIMIT 1`))[0].id;
  const cur = (await db.query('SELECT amount_paid FROM orders WHERE id=$1', [id]))[0].amount_paid;
  return http('PUT', `/orders/${id}`, { amount_paid: cur === 20 ? 25 : 20 }, A);
}, 20);

// mixed load: WORKERS users busy for SECONDS seconds
say();
say(`  Mixed load: ${WORKERS} people working at once for ${SECONDS}s (70% reading, 30% writing)`);
const lat = [], errs = { n: 0 }, byKind = { read: [], write: [] };
const end = performance.now() + SECONDS * 1000;
let seq = 0;
await Promise.all(Array.from({ length: WORKERS }, (_, w) => (async () => {
  while (performance.now() < end) {
    const n = seq++;
    const dice = n % 10;
    let x, kind = 'read';
    if (dice < 2) x = await http('GET', '/dashboard', null, ck(w));
    else if (dice < 4) x = await http('GET', `/orders?limit=100&offset=${(n * 997) % Math.max(1, ROWS - 100)}`, null, ck(w));
    else if (dice < 5) x = await http('GET', '/stock', null, ck(w));
    else if (dice < 6) x = await http('GET', '/cash', null, ck(w));
    else if (dice < 7) x = await http('GET', `/clients/${base_id + (n % nClients)}/debts`, null, ck(w));
    else if (dice < 9) { kind = 'write'; x = await http('POST', '/orders', { client_id: base_id + (n % nClients), product_service: 'Flyer', quantity: 1, unit_price: 12, amount_paid: 12, inventory_id: 2, allow_negative_stock: true }, ck(w)); }
    else { kind = 'write'; x = await http('POST', '/expenses', { category: 'Encre', supplier: 'QA', amount: 5, payment_method: 'Espèces', observation: 'load' }, ck(w)); }
    lat.push(x.ms); byKind[kind].push(x.ms);
    if (x.status >= 400) errs.n++;
  }
})()));
const rps = lat.length / SECONDS;
const mixed = { requests: lat.length, rps, p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), errors: errs.n, readP95: pct(byKind.read, 95), writeP95: pct(byKind.write, 95) };
say(`  ${lat.length} requests, ${rps.toFixed(0)} per second, errors ${errs.n}`);
say(`  response time: median ${mixed.p50.toFixed(0)} ms, p95 ${mixed.p95.toFixed(0)} ms, p99 ${mixed.p99.toFixed(0)} ms  (reads p95 ${mixed.readP95.toFixed(0)} ms, writes p95 ${mixed.writeP95.toFixed(0)} ms)`);
check('no request failed under mixed load', errs.n === 0, `${errs.n} errors`);

// accuracy again AFTER the heavy load, on top of the big dataset
say();
say('## 3. Accuracy re-check after the heavy load');
const bad2 = await db.query(`
  SELECT count(*)::int AS n FROM (
    SELECT running_balance, amount, type, COALESCE(LAG(running_balance) OVER (ORDER BY id), 0) AS prev FROM cash_register) x
  WHERE round(x.running_balance - (x.prev + CASE WHEN x.type='IN' THEN x.amount ELSE -x.amount END), 2) <> 0`);
check('cash register chain still exact', bad2[0].n === 0, `${bad2[0].n} broken rows`);
const drift2 = await db.query(`SELECT count(*)::int AS n FROM (
  SELECT c.id, c.total_spent, COALESCE(SUM(o.total_amount) FILTER (WHERE NOT o.is_opening),0) AS s FROM clients c LEFT JOIN orders o ON o.client_id=c.id GROUP BY c.id) x WHERE round(x.total_spent - x.s, 2) <> 0`);
check('every client total still equals the sum of their orders', drift2[0].n === 0, `${drift2[0].n} clients off`);
const dup = await db.query(`SELECT count(*)::int AS n FROM (SELECT order_number FROM orders GROUP BY 1 HAVING count(*) > 1) d`);
check('order numbers still unique', dup[0].n === 0);
const [dbSize] = await db.query(`SELECT pg_database_size(current_database())::float AS b`);
say(`  database size on disk: ${(dbSize.b / 2 ** 20).toFixed(0)} MB; memory used by this test: ${(process.memoryUsage().rss / 2 ** 20).toFixed(0)} MB`);

// ---------- verdict ----------
const slow = speedRows.filter((x) => x.verdict === 'SLOW' || x.verdict === 'ERROR');
say();
say('## Verdict');
say(`- Accuracy: ${accuracyFailures === 0 ? 'ALL CHECKS PASSED' : `${accuracyFailures} CHECK(S) FAILED`}`);
say(`- Speed: ${slow.length === 0 ? 'every screen answers within limits' : `${slow.length} screen(s) too slow: ${slow.map((x) => x.label).join('; ')}`}`);
say(`- Total test time: ${((performance.now() - t0) / 1000).toFixed(0)}s`);
say(`- Thresholds: FAST ≤ ${FAST_MS} ms, OK ≤ ${SLOW_MS} ms, SLOW above (95th percentile).`);

fs.writeFileSync(OUT, lines.join('\n') + '\n');
await close();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`\nReport written to ${OUT}`);
process.exit(accuracyFailures > 0 || (STRICT && slow.length > 0) ? 1 : 0);
