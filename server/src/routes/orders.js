import { Router } from 'express';
import { z } from 'zod';
import { HttpError, idParam, likeParam, money, orderStatus, parse, qty, round2 } from '../http.js';
import { logCash } from '../cash.js';
import { SUPPORT_TYPES, getRates, supportUnitPrice } from '../supports.js';

const router = Router();
let servicesCache = null; // { at, rows }; reset when an order is created

const SELECT_ORDER = `
  SELECT o.id, o.order_number, o.client_id, c.name AS client_name, o.product_service,
         o.quantity, o.unit_price, o.total_amount, o.amount_paid,
         (o.total_amount - o.amount_paid) AS amount_due,
         o.payment_method, o.status, o.order_date, o.due_date, o.inventory_id, o.material_used, o.created_at,
         o.support_type, o.width_cm, o.height_cm, o.rate_cm2, o.extra_fees
  FROM orders o LEFT JOIN clients c ON c.id = o.client_id`;

const METHODS = ['Espèces', 'Carte', 'Virement', 'Chèque', 'Prélèvement'];
const method = z.enum(METHODS);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format AAAA-MM-JJ');

const dimension = z.number().positive('doit être > 0').max(100_000, 'trop grand');
// A "support" order (bâche, autocollant…) is priced by the server from width × height × rate; the caller sends sizes, not a price.
const createSchema = z.object({
  client_id: idParam,
  product_service: z.string().trim().min(1).max(255).optional(),
  quantity: qty.refine((v) => v > 0, 'doit être > 0'),
  unit_price: money.refine((v) => v >= 0, 'doit être >= 0').optional(),
  support_type: z.enum(SUPPORT_TYPES).nullish(),
  width_cm: dimension.nullish(),
  height_cm: dimension.nullish(),
  extra_fees: money.refine((v) => v >= 0, 'doit être >= 0').default(0), // per piece, added on top of the surface price
  amount_paid: money.refine((v) => v >= 0).default(0),
  payment_method: method.default('Espèces'),
  order_date: dateStr.optional(),
  due_date: dateStr.nullish(),
  inventory_id: idParam.nullish(),
  material_used: qty.refine((v) => v >= 0).nullish(), // defaults to `quantity`
  allow_negative_stock: z.boolean().default(false),
}).superRefine((v, ctx) => {
  if (v.support_type) {
    if (!v.width_cm) ctx.addIssue({ code: 'custom', path: ['width_cm'], message: 'la largeur est obligatoire' });
    if (!v.height_cm) ctx.addIssue({ code: 'custom', path: ['height_cm'], message: 'la hauteur est obligatoire' });
  } else {
    if (!v.product_service) ctx.addIssue({ code: 'custom', path: ['product_service'], message: 'obligatoire' });
    if (v.unit_price === undefined) ctx.addIssue({ code: 'custom', path: ['unit_price'], message: 'obligatoire' });
  }
});

const updateSchema = z.object({
  amount_paid: money.refine((v) => v >= 0).optional(),
  payment_method: method.optional(),
  product_service: z.string().trim().min(1).max(255).optional(),
  order_date: dateStr.optional(),
  due_date: dateStr.nullish(),
});

const listSchema = z.object({
  q: z.string().optional(),
  status: z.enum(['Paid', 'Partial', 'Unpaid']).optional(),
  period: z.enum(['today', 'week', 'month']).optional(),
  support: z.string().optional(), // 'all' = only bâche/autocollant/… orders, or one support type
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get('/', async (req, res) => {
  const { db } = req.app.locals;
  const f = parse(listSchema, req.query);
  const where = ['NOT o.is_opening']; // previous-debt rows are not sales: they live on the client screen
  const params = [];
  const add = (v) => (params.push(v), `$${params.length}`);
  const like = likeParam(f.q);
  if (like) { const p = add(like); // UNION of three index-friendly lookups (an OR across two tables would force a full scan)
    where.push(`o.id IN (SELECT id FROM orders WHERE order_number ILIKE ${p}
      UNION SELECT id FROM orders WHERE product_service ILIKE ${p}
      UNION SELECT o2.id FROM orders o2 JOIN clients c2 ON c2.id = o2.client_id WHERE c2.name ILIKE ${p})`); }
  if (f.status) where.push(`o.status = ${add(f.status)}`);
  if (f.support === 'all') where.push('o.support_type IS NOT NULL');
  else if (SUPPORT_TYPES.includes(f.support)) where.push(`o.support_type = ${add(f.support)}`);
  if (f.period === 'today') where.push('o.order_date = CURRENT_DATE');
  if (f.period === 'week') where.push("o.order_date >= date_trunc('week', CURRENT_DATE)::date");
  if (f.period === 'month') where.push("o.order_date >= date_trunc('month', CURRENT_DATE)::date");
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orders = await db.query(`${SELECT_ORDER} ${w} ORDER BY o.order_date DESC, o.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`, params);
  const [{ total }] = await db.query(`SELECT COUNT(*) AS total FROM orders o LEFT JOIN clients c ON c.id = o.client_id ${w}`, params);
  // The dropdown of service names changes rarely: scanning every order for it on each list call is wasteful.
  if (!servicesCache || Date.now() - servicesCache.at > 60_000) {
    servicesCache = { at: Date.now(), rows: await db.query('SELECT DISTINCT product_service FROM orders WHERE NOT is_opening ORDER BY 1 LIMIT 100') };
  }
  const services = servicesCache.rows;
  // Month figures for the Bâches & autocollants page (all support orders, not just the rows shown).
  let stats;
  if (f.support) {
    const m = "order_date >= date_trunc('month', CURRENT_DATE)";
    [stats] = await db.query(`SELECT COUNT(*) FILTER (WHERE ${m}) AS orders_month,
        COALESCE(SUM(width_cm * height_cm * quantity / 10000) FILTER (WHERE ${m}), 0) AS area_m2_month,
        COALESCE(SUM(total_amount) FILTER (WHERE ${m}), 0) AS revenue_month,
        COALESCE(SUM(total_amount - amount_paid), 0) AS unpaid
      FROM orders WHERE support_type IS NOT NULL`);
    stats.area_m2_month = round2(stats.area_m2_month);
  }
  res.json({ orders, total, services: services.map((s) => s.product_service), ...(stats ? { stats } : {}) });
});

// Everything a receipt needs: the order, and where the client's account stands (all debts, previous debt included).
router.get('/:id/receipt', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const order = (await db.query(`${SELECT_ORDER} WHERE o.id = $1`, [id]))[0];
  if (!order) throw new HttpError(404, 'Commande introuvable');
  let client = null;
  if (order.client_id) {
    client = (await db.query(
      `SELECT c.id, c.name, c.phone,
              COALESCE(SUM(o.total_amount - o.amount_paid), 0) AS debt,
              COALESCE(SUM(o.total_amount - o.amount_paid) FILTER (WHERE o.is_opening), 0) AS opening_due
       FROM clients c LEFT JOIN orders o ON o.client_id = c.id WHERE c.id = $1 GROUP BY c.id`, [order.client_id]))[0] ?? null;
  }
  res.json({ order, client });
});

router.get('/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const rows = await req.app.locals.db.query(`${SELECT_ORDER} WHERE o.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Commande introuvable');
  res.json({ order: rows[0] });
});

/**
 * Create an order. ONE transaction does all of this, or none of it:
 *   1. insert the order (number CMD-xxxx from a sequence)
 *   2. clients.total_spent += order total
 *   3. cash_register IN for the amount paid now (if > 0)
 *   4. inventory.current_stock -= material consumed (if a material is linked)
 */
router.post('/', async (req, res) => {
  const { db } = req.app.locals;
  const b = parse(createSchema, req.body);
  let rate = null;
  if (b.support_type) {
    rate = (await getRates(db))[b.support_type];
    b.product_service = b.support_type;
    b.unit_price = supportUnitPrice(b.width_cm, b.height_cm, rate, b.extra_fees); // the server is the source of truth
  } else { b.extra_fees = 0; b.width_cm = b.height_cm = null; }
  const total = round2(b.quantity * b.unit_price);
  if (b.amount_paid > total) throw new HttpError(400, `Le montant payé (${b.amount_paid}) dépasse le total (${total})`, 'OVERPAYMENT');
  const status = orderStatus(total, b.amount_paid);

  const order = await db.tx(async (t) => {
    const client = await t.query('SELECT id, name FROM clients WHERE id = $1 FOR UPDATE', [b.client_id]);
    if (!client[0]) throw new HttpError(404, 'Client introuvable');

    if (b.inventory_id) {
      const used = b.material_used ?? b.quantity;
      const inv = await t.query('SELECT id, item, current_stock FROM inventory WHERE id = $1 FOR UPDATE', [b.inventory_id]);
      if (!inv[0]) throw new HttpError(404, 'Matière introuvable');
      if (inv[0].current_stock < used && !b.allow_negative_stock) {
        throw new HttpError(409, `Stock insuffisant pour « ${inv[0].item} » (disponible : ${inv[0].current_stock}, nécessaire : ${used})`, 'INSUFFICIENT_STOCK');
      }
      await t.query('UPDATE inventory SET current_stock = current_stock - $1 WHERE id = $2', [used, b.inventory_id]);
    }

    const [{ n }] = await t.query("SELECT nextval('order_number_seq') AS n");
    const orderNumber = `CMD-${n}`;
    const dueDate = b.due_date ?? null;
    const ins = await t.query(
      `INSERT INTO orders (order_number, client_id, product_service, quantity, unit_price, amount_paid, payment_method,
                           status, order_date, due_date, inventory_id, material_used, support_type, width_cm, height_cm, rate_cm2, extra_fees)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9::date, CURRENT_DATE),
               COALESCE($10::date, CASE WHEN $8::varchar = 'Paid' THEN NULL ELSE COALESCE($9::date, CURRENT_DATE) + 30 END),
               $11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [orderNumber, b.client_id, b.product_service, b.quantity, b.unit_price, b.amount_paid, b.payment_method,
       status, b.order_date ?? null, dueDate, b.inventory_id ?? null, b.inventory_id ? (b.material_used ?? b.quantity) : null,
       b.support_type ?? null, b.width_cm ?? null, b.height_cm ?? null, rate, b.extra_fees],
    );

    await t.query('UPDATE clients SET total_spent = total_spent + $1 WHERE id = $2', [total, b.client_id]);
    if (b.amount_paid > 0) {
      await logCash(t, {
        description: `${status === 'Paid' ? 'Règlement' : 'Acompte'} ${orderNumber} — ${client[0].name}`,
        type: 'IN', amount: b.amount_paid, method: b.payment_method,
      });
    }
    return (await t.query(`${SELECT_ORDER} WHERE o.id = $1`, [ins[0].id]))[0];
  });
  servicesCache = null;
  res.status(201).json({ order });
});

/**
 * Update an order. Quantity / unit price are intentionally NOT editable: they would
 * invalidate stock, client totals and cash entries already booked. Payment changes are
 * allowed and mirrored in the cash register (increase => IN, decrease => OUT refund).
 */
router.put('/:id', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const b = parse(updateSchema, req.body);
  const order = await db.tx(async (t) => {
    const cur = (await t.query(
      `SELECT o.*, c.name AS client_name FROM orders o LEFT JOIN clients c ON c.id = o.client_id WHERE o.id = $1 FOR UPDATE OF o`, [id]))[0];
    if (!cur) throw new HttpError(404, 'Commande introuvable');
    if (cur.is_opening) throw new HttpError(400, 'Cette ligne est une dette antérieure : modifiez-la depuis la fiche du client.', 'OPENING_ROW');
    const newPaid = b.amount_paid ?? cur.amount_paid;
    if (newPaid > cur.total_amount) throw new HttpError(400, `Le montant payé dépasse le total (${cur.total_amount})`, 'OVERPAYMENT');
    const newMethod = b.payment_method ?? cur.payment_method;
    const status = orderStatus(cur.total_amount, newPaid);
    await t.query(
      `UPDATE orders SET amount_paid=$1, payment_method=$2, status=$3, product_service=$4,
              order_date=COALESCE($5::date, order_date), due_date=CASE WHEN $6::boolean THEN $7::date ELSE due_date END
       WHERE id=$8`,
      [newPaid, newMethod, status, b.product_service ?? cur.product_service, b.order_date ?? null,
       b.due_date !== undefined, b.due_date ?? null, id],
    );
    const delta = round2(newPaid - cur.amount_paid);
    if (delta > 0) await logCash(t, { description: `Règlement ${cur.order_number} — ${cur.client_name ?? ''}`, type: 'IN', amount: delta, method: newMethod });
    if (delta < 0) await logCash(t, { description: `Remboursement ${cur.order_number} — ${cur.client_name ?? ''}`, type: 'OUT', amount: -delta, method: newMethod });
    return (await t.query(`${SELECT_ORDER} WHERE o.id = $1`, [id]))[0];
  });
  res.json({ order });
});

export default router;
