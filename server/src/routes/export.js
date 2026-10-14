import { Router } from 'express';
import ExcelJS from 'exceljs';
import { likeParam } from '../http.js';
import { getDashboard } from '../dashboardData.js';
import { readSettings } from './settings.js';

// Excel (.xlsx) exports. Same filters as the screens; every authenticated user may export what they can already see.
const router = Router();
const MAX_ROWS = 100_000; // keeps memory sane on a shop PC; the sheet says so when it cuts
const STATUS_FR = { Paid: 'Payé', Partial: 'Partiel', Unpaid: 'Impayé' };
const FMT = { money: '#,##0.00', qty: '#,##0.##', int: '0', date: 'dd/mm/yyyy' };
const day = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00Z`) : null); // DATE strings -> real Excel dates
const one = (v) => (typeof v === 'string' && v ? v : null);

function newWorkbook(shop, title, filters) {
  const wb = new ExcelJS.Workbook();
  wb.creator = shop.shop_name || 'Imprimerie ERP';
  wb.created = new Date();
  return { wb, title, filters };
}

function header(ws) {
  const row = ws.getRow(1);
  row.height = 22;
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    c.alignment = { vertical: 'middle', horizontal: 'left' };
  });
}

// columns: [{ header, key, type: 'text'|'money'|'qty'|'int'|'date', width, total? }]
function addTable(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16, style: FMT[c.type] ? { numFmt: FMT[c.type] } : {} }));
  header(ws);
  const truncated = rows.length > MAX_ROWS;
  const data = truncated ? rows.slice(0, MAX_ROWS) : rows;
  ws.addRows(data);
  columns.forEach((c, i) => {
    if (c.type === 'money' || c.type === 'qty') ws.getColumn(i + 1).alignment = { horizontal: 'right' };
  });
  if (data.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const totalCols = columns.filter((c) => c.total);
  if (totalCols.length && data.length) {
    const r = ws.addRow({});
    r.getCell(1).value = 'TOTAL';
    for (const c of totalCols) {
      const col = ws.getColumn(c.key);
      r.getCell(c.key).value = { formula: `SUM(${col.letter}2:${col.letter}${data.length + 1})`, result: data.reduce((s, x) => s + (Number(x[c.key]) || 0), 0) };
    }
    r.eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true }; c.border = { top: { style: 'thin' } }; });
  }
  if (truncated) ws.addRow([`Export limité aux ${MAX_ROWS.toLocaleString('fr-FR')} lignes les plus récentes.`]).font = { italic: true, color: { argb: 'FFB91C1C' } };
  return { ws, truncated };
}

function addInfo(ctx, shop, count, truncated) {
  const ws = ctx.wb.addWorksheet('Infos');
  ws.columns = [{ width: 24 }, { width: 60 }];
  const lines = [
    ['Imprimerie', shop.shop_name || '—'],
    ['Export', ctx.title],
    ['Date de l\'export', new Date().toLocaleString('fr-FR')],
    ['Filtres', ctx.filters || 'Aucun (toutes les données)'],
    ['Lignes exportées', truncated ? `${MAX_ROWS} (limite atteinte)` : count],
    ['Devise', shop.currency],
  ];
  lines.forEach((l) => { const r = ws.addRow(l); r.getCell(1).font = { bold: true }; });
}

async function send(res, wb, slug) {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

const PERIOD_SQL = { today: 'CURRENT_DATE', week: "date_trunc('week', CURRENT_DATE)::date", month: "date_trunc('month', CURRENT_DATE)::date" };
const PERIOD_FR = { today: "Aujourd'hui", week: 'Cette semaine', month: 'Ce mois' };

router.get('/orders.xlsx', async (req, res) => {
  const { db } = req.app.locals;
  const shop = await readSettings(db);
  const where = ['NOT o.is_opening'], params = [], filters = [];
  const add = (v) => (params.push(v), `$${params.length}`);
  const like = likeParam(req.query.q);
  if (like) {
    const p = add(like);
    where.push(`o.id IN (SELECT id FROM orders WHERE order_number ILIKE ${p} UNION SELECT id FROM orders WHERE product_service ILIKE ${p}
      UNION SELECT o2.id FROM orders o2 JOIN clients c2 ON c2.id = o2.client_id WHERE c2.name ILIKE ${p})`);
    filters.push(`recherche « ${req.query.q} »`);
  }
  if (['Paid', 'Partial', 'Unpaid'].includes(req.query.status)) { where.push(`o.status = ${add(req.query.status)}`); filters.push(`statut ${STATUS_FR[req.query.status]}`); }
  if (PERIOD_SQL[req.query.period]) { where.push(`o.order_date >= ${PERIOD_SQL[req.query.period]}`); filters.push(PERIOD_FR[req.query.period]); }
  if (one(req.query.method)) { where.push(`o.payment_method = ${add(req.query.method)}`); filters.push(`paiement ${req.query.method}`); }
  if (one(req.query.service)) { where.push(`o.product_service = ${add(req.query.service)}`); filters.push(`service ${req.query.service}`); }
  const rows = await db.query(
    `SELECT o.order_number, o.order_date, c.name AS client, o.product_service, o.quantity, o.unit_price, o.total_amount, o.amount_paid,
            (o.total_amount - o.amount_paid) AS due, o.payment_method, o.status, o.due_date,
            o.support_type, o.width_cm, o.height_cm, ROUND(o.width_cm * o.height_cm / 10000, 4) AS surface_m2, o.extra_fees
     FROM orders o LEFT JOIN clients c ON c.id = o.client_id WHERE ${where.join(' AND ')}
     ORDER BY o.order_date DESC, o.id DESC LIMIT ${MAX_ROWS + 1}`, params);
  const cur = shop.currency;
  const ctx = newWorkbook(shop, 'Ventes / commandes', filters.join(' · '));
  const { truncated } = addTable(ctx.wb, 'Commandes', [
    { header: 'N° commande', key: 'order_number', width: 14 }, { header: 'Date', key: 'order_date', type: 'date', width: 12 },
    { header: 'Client', key: 'client', width: 26 }, { header: 'Service', key: 'product_service', width: 28 },
    { header: 'Quantité', key: 'quantity', type: 'qty', width: 11 }, { header: `Prix unitaire (${cur})`, key: 'unit_price', type: 'money', width: 16 },
    { header: `Total (${cur})`, key: 'total_amount', type: 'money', width: 15, total: true }, { header: `Payé (${cur})`, key: 'amount_paid', type: 'money', width: 15, total: true },
    { header: `Reste à payer (${cur})`, key: 'due', type: 'money', width: 18, total: true }, { header: 'Mode de paiement', key: 'payment_method', width: 17 },
    { header: 'Statut', key: 'status', width: 10 }, { header: 'Échéance', key: 'due_date', type: 'date', width: 12 },
    { header: 'Support', key: 'support_type', width: 14 }, { header: 'Largeur (cm)', key: 'width_cm', type: 'qty', width: 13 },
    { header: 'Hauteur (cm)', key: 'height_cm', type: 'qty', width: 13 }, { header: 'Surface (m²)', key: 'surface_m2', type: 'qty', width: 13 },
    { header: `Frais suppl. par pièce (${cur})`, key: 'extra_fees', type: 'money', width: 24 },
  ], rows.map((r) => ({ ...r, order_date: day(r.order_date), due_date: day(r.due_date), status: STATUS_FR[r.status] ?? r.status, extra_fees: r.support_type ? r.extra_fees : null })));
  addInfo(ctx, shop, Math.min(rows.length, MAX_ROWS), truncated);
  await send(res, ctx.wb, 'commandes');
});

router.get('/clients.xlsx', async (req, res) => {
  const { db } = req.app.locals;
  const shop = await readSettings(db);
  const like = likeParam(req.query.q);
  const rows = await db.query(
    `SELECT c.name, c.phone, c.email, COUNT(o.id) FILTER (WHERE NOT o.is_opening) AS orders_count, c.total_spent,
            COALESCE(SUM(o.total_amount - o.amount_paid), 0) AS debt,
            COALESCE(SUM(o.total_amount - o.amount_paid) FILTER (WHERE o.is_opening), 0) AS opening_due,
            MIN(o.due_date) FILTER (WHERE o.total_amount > o.amount_paid) AS next_due,
            COALESCE(BOOL_OR(o.total_amount > o.amount_paid AND o.due_date < CURRENT_DATE), false) AS overdue,
            to_char(c.created_at, 'YYYY-MM-DD') AS created
     FROM clients c LEFT JOIN orders o ON o.client_id = c.id
     WHERE ($1::text IS NULL OR c.name ILIKE $1 OR c.phone ILIKE $1) GROUP BY c.id ORDER BY lower(c.name) LIMIT ${MAX_ROWS + 1}`, [like]);
  const cur = shop.currency;
  const ctx = newWorkbook(shop, 'Clients & dettes', req.query.q ? `recherche « ${req.query.q} »` : '');
  const { truncated } = addTable(ctx.wb, 'Clients', [
    { header: 'Client', key: 'name', width: 28 }, { header: 'Téléphone', key: 'phone', width: 18 }, { header: 'E-mail', key: 'email', width: 26 },
    { header: 'Commandes', key: 'orders_count', type: 'int', width: 12 }, { header: `Total acheté (${cur})`, key: 'total_spent', type: 'money', width: 18, total: true },
    { header: `Dette actuelle (${cur})`, key: 'debt', type: 'money', width: 18, total: true },
    { header: `dont dette antérieure (${cur})`, key: 'opening_due', type: 'money', width: 22, total: true },
    { header: 'Prochaine échéance', key: 'next_due', type: 'date', width: 18 }, { header: 'Statut', key: 'status', width: 12 },
    { header: 'Client depuis', key: 'created', type: 'date', width: 14 },
  ], rows.map((r) => ({ ...r, next_due: day(r.next_due), created: day(r.created), status: r.debt <= 0 ? 'À jour' : r.overdue ? 'En retard' : 'Dette' })));
  addInfo(ctx, shop, Math.min(rows.length, MAX_ROWS), truncated);
  await send(res, ctx.wb, 'clients');
});

router.get('/stock.xlsx', async (req, res) => {
  const { db } = req.app.locals;
  const shop = await readSettings(db);
  const like = likeParam(req.query.q);
  const onlyLow = req.query.low === '1' || req.query.low === 'true';
  const rows = await db.query(
    `SELECT ref, item, unit, initial_stock, current_stock, (current_stock - initial_stock) AS movement, purchase_price,
            ROUND(current_stock * purchase_price, 2) AS value, alert_threshold, (current_stock <= alert_threshold) AS low
     FROM inventory WHERE ($1::text IS NULL OR ref ILIKE $1 OR item ILIKE $1) AND ($2::boolean = false OR current_stock <= alert_threshold)
     ORDER BY ref LIMIT ${MAX_ROWS + 1}`, [like, onlyLow]);
  const cur = shop.currency;
  const ctx = newWorkbook(shop, 'Stock / matières premières', [req.query.q && `recherche « ${req.query.q} »`, onlyLow && 'stock bas uniquement'].filter(Boolean).join(' · '));
  const { truncated } = addTable(ctx.wb, 'Stock', [
    { header: 'Réf.', key: 'ref', width: 14 }, { header: 'Article', key: 'item', width: 30 }, { header: 'Unité', key: 'unit', width: 9 },
    { header: 'Stock initial', key: 'initial_stock', type: 'qty', width: 13 }, { header: 'Stock actuel', key: 'current_stock', type: 'qty', width: 13 },
    { header: 'Mouvement', key: 'movement', type: 'qty', width: 12 }, { header: `Prix d'achat (${cur})`, key: 'purchase_price', type: 'money', width: 17 },
    { header: `Valeur du stock (${cur})`, key: 'value', type: 'money', width: 20, total: true }, { header: "Seuil d'alerte", key: 'alert_threshold', type: 'qty', width: 14 },
    { header: 'Alerte', key: 'alert', width: 10 },
  ], rows.map((r) => ({ ...r, alert: r.low ? 'Stock bas' : '' })));
  addInfo(ctx, shop, Math.min(rows.length, MAX_ROWS), truncated);
  await send(res, ctx.wb, 'stock');
});

router.get('/expenses.xlsx', async (req, res) => {
  const { db } = req.app.locals;
  const shop = await readSettings(db);
  const like = likeParam(req.query.q);
  const category = one(req.query.category);
  const rows = await db.query(
    `SELECT expense_date, category, supplier, amount, payment_method, observation FROM expenses
     WHERE ($1::text IS NULL OR supplier ILIKE $1 OR observation ILIKE $1 OR category ILIKE $1) AND ($2::text IS NULL OR category = $2)
     ORDER BY expense_date DESC, id DESC LIMIT ${MAX_ROWS + 1}`, [like, category]);
  const cur = shop.currency;
  const ctx = newWorkbook(shop, 'Dépenses', [req.query.q && `recherche « ${req.query.q} »`, category && `catégorie ${category}`].filter(Boolean).join(' · '));
  const { truncated } = addTable(ctx.wb, 'Dépenses', [
    { header: 'Date', key: 'expense_date', type: 'date', width: 12 }, { header: 'Catégorie', key: 'category', width: 18 }, { header: 'Fournisseur', key: 'supplier', width: 26 },
    { header: `Montant (${cur})`, key: 'amount', type: 'money', width: 16, total: true }, { header: 'Mode de paiement', key: 'payment_method', width: 17 },
    { header: 'Observation', key: 'observation', width: 40 },
  ], rows.map((r) => ({ ...r, expense_date: day(r.expense_date) })));
  addInfo(ctx, shop, Math.min(rows.length, MAX_ROWS), truncated);
  await send(res, ctx.wb, 'depenses');
});

router.get('/cash.xlsx', async (req, res) => {
  const { db } = req.app.locals;
  const shop = await readSettings(db);
  const like = likeParam(req.query.q);
  const period = PERIOD_SQL[req.query.period] ? req.query.period : null;
  const rows = await db.query(
    `SELECT to_char(created_at, 'YYYY-MM-DD HH24:MI') AS at, description, type, amount, running_balance, payment_method FROM cash_register
     WHERE ($1::text IS NULL OR description ILIKE $1) ${period ? `AND created_at >= ${PERIOD_SQL[period]}` : ''}
     ORDER BY id DESC LIMIT ${MAX_ROWS + 1}`, [like]);
  const cur = shop.currency;
  const ctx = newWorkbook(shop, 'Caisse', [req.query.q && `recherche « ${req.query.q} »`, period && PERIOD_FR[period]].filter(Boolean).join(' · '));
  const { truncated } = addTable(ctx.wb, 'Caisse', [
    { header: 'Date et heure', key: 'at', width: 18 }, { header: 'Description', key: 'description', width: 46 },
    { header: `Entrée (${cur})`, key: 'in', type: 'money', width: 16, total: true }, { header: `Sortie (${cur})`, key: 'out', type: 'money', width: 16, total: true },
    { header: `Solde (${cur})`, key: 'running_balance', type: 'money', width: 16 }, { header: 'Mode de paiement', key: 'payment_method', width: 17 },
  ], rows.map((r) => ({ ...r, in: r.type === 'IN' ? r.amount : null, out: r.type === 'OUT' ? r.amount : null })));
  addInfo(ctx, shop, Math.min(rows.length, MAX_ROWS), truncated);
  await send(res, ctx.wb, 'caisse');
});

// The same numbers as the dashboard (shared calculation), plus cash and the biggest debtors.
router.get('/report.xlsx', async (req, res) => {
  const { db } = req.app.locals;
  const shop = await readSettings(db);
  const d = await getDashboard(db);
  const [cash] = await db.query(`SELECT COALESCE((SELECT running_balance FROM cash_register ORDER BY id DESC LIMIT 1), 0) AS balance,
      COALESCE(SUM(amount) FILTER (WHERE type = 'IN'), 0) AS today_in, COALESCE(SUM(amount) FILTER (WHERE type = 'OUT'), 0) AS today_out
    FROM cash_register WHERE created_at >= CURRENT_DATE`);
  const debtors = await db.query(
    `SELECT c.name, c.phone, SUM(o.total_amount - o.amount_paid) AS debt, MIN(o.due_date) AS oldest_due
     FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.total_amount > o.amount_paid GROUP BY c.id ORDER BY 3 DESC LIMIT 1000`);
  const cur = shop.currency;
  const ctx = newWorkbook(shop, 'Rapport (tableau de bord)', '');
  addTable(ctx.wb, 'Résumé', [
    { header: 'Indicateur', key: 'k', width: 34 }, { header: `Valeur (${cur})`, key: 'v', type: 'money', width: 20 },
  ], [
    { k: "Chiffre d'affaires du jour", v: d.today_revenue }, { k: "Chiffre d'affaires du mois", v: d.monthly_revenue },
    { k: 'Dépenses du mois', v: d.monthly_expenses }, { k: 'Bénéfice estimé du mois', v: d.net_profit },
    { k: 'Dettes clients impayées', v: d.unpaid_debts }, { k: 'Valeur du stock', v: d.stock_value },
    { k: 'Solde de la caisse', v: cash.balance }, { k: "Encaissé aujourd'hui", v: cash.today_in }, { k: "Dépensé aujourd'hui (caisse)", v: cash.today_out },
    { k: 'Commandes ce mois (nombre)', v: d.orders_month }, { k: 'Factures impayées (nombre)', v: d.unpaid_count },
  ]);
  addTable(ctx.wb, 'Ventes par mois', [
    { header: 'Mois', key: 'month', width: 12 }, { header: `Ventes (${cur})`, key: 'sales', type: 'money', width: 16, total: true },
    { header: `Dépenses (${cur})`, key: 'expenses', type: 'money', width: 16, total: true }, { header: `Résultat (${cur})`, key: 'net', type: 'money', width: 16, total: true },
  ], d.series.map((s) => ({ ...s, net: Math.round((s.sales - s.expenses) * 100) / 100 })));
  addTable(ctx.wb, 'Meilleures ventes du mois', [
    { header: 'Service / produit', key: 'name', width: 34 }, { header: `Montant (${cur})`, key: 'amount', type: 'money', width: 16, total: true }, { header: 'Part (%)', key: 'share', type: 'int', width: 10 },
  ], d.top_items);
  addTable(ctx.wb, 'Dettes clients', [
    { header: 'Client', key: 'name', width: 28 }, { header: 'Téléphone', key: 'phone', width: 18 },
    { header: `Dette (${cur})`, key: 'debt', type: 'money', width: 16, total: true }, { header: 'Plus ancienne échéance', key: 'oldest_due', type: 'date', width: 22 },
  ], debtors.map((r) => ({ ...r, oldest_due: day(r.oldest_due) })));
  addInfo(ctx, shop, d.series.length, false);
  await send(res, ctx.wb, 'rapport');
});

export default router;
