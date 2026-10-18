import { Router } from 'express';
import { z } from 'zod';
import { HttpError, idParam, likeParam, money, orderStatus, parse, round2 } from '../http.js';
import { logCash } from '../cash.js';

const router = Router();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format AAAA-MM-JJ');
const emailField = z.union([z.literal(''), z.string().trim().email().max(255)]);

const clientSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(50).nullish().transform((v) => v || null),
  email: emailField.nullish().transform((v) => v || null),
  // Debt the client already owed BEFORE the app was used. Becomes a debt, never a sale.
  opening_debt: money.refine((v) => v >= 0, 'doit être >= 0').default(0),
  opening_date: dateStr.optional(),
});

// Fields left out stay as they are; '' or null clears phone / e-mail.
const patchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  phone: z.string().trim().max(50).nullish(),
  email: emailField.nullish(),
  opening_debt: money.refine((v) => v >= 0, 'doit être >= 0').optional(),
  opening_date: dateStr.optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), 'Rien à modifier');

// debt = what is still owed on orders (previous debt included); total_spent is the lifetime billed SALES amount.
const CLIENT_SELECT = `
  SELECT c.id, c.name, c.phone, c.email, c.total_spent, c.created_at,
         COUNT(o.id) FILTER (WHERE NOT o.is_opening) AS orders_count,
         COALESCE(SUM(o.total_amount - o.amount_paid), 0) AS debt,
         COALESCE(SUM(o.total_amount) FILTER (WHERE o.is_opening), 0) AS opening_total,
         COALESCE(SUM(o.amount_paid)  FILTER (WHERE o.is_opening), 0) AS opening_paid,
         MIN(o.due_date) FILTER (WHERE o.total_amount > o.amount_paid) AS next_due,
         COALESCE(BOOL_OR(o.total_amount > o.amount_paid AND o.due_date < CURRENT_DATE), false) AS overdue
  FROM clients c LEFT JOIN orders o ON o.client_id = c.id`;

const withStatus = (c) => ({ ...c, status: c.debt <= 0 ? 'ok' : c.overdue ? 'overdue' : 'debt' });
const getClient = async (t, id) => (await t.query(`${CLIENT_SELECT} WHERE c.id = $1 GROUP BY c.id`, [id]))[0];

async function insertOpening(t, clientId, amount, date) {
  await t.query(
    `INSERT INTO orders (order_number, client_id, product_service, quantity, unit_price, amount_paid, payment_method, status, order_date, is_opening)
     VALUES ($1, $2, 'Dette antérieure', 1, $3, 0, 'Espèces', 'Unpaid', COALESCE($4::date, CURRENT_DATE), TRUE)`,
    [`REP-${clientId}`, clientId, amount, date ?? null]);
}

router.get('/', async (req, res) => {
  const { db } = req.app.locals;
  const like = likeParam(req.query.q);
  const clients = await db.query(
    `${CLIENT_SELECT} WHERE ($1::text IS NULL OR c.name ILIKE $1 OR c.phone ILIKE $1) GROUP BY c.id ORDER BY lower(c.name)`, [like]);
  const [stats] = await db.query(`
    SELECT (SELECT COUNT(*) FROM clients) AS count,
           (SELECT COUNT(*) FROM clients WHERE created_at >= date_trunc('month', CURRENT_DATE)) AS new_this_month,
           COALESCE((SELECT SUM(total_amount - amount_paid) FROM orders), 0) AS total_debt,
           (SELECT COUNT(*) FROM orders WHERE total_amount > amount_paid) AS unpaid_orders`);
  res.json({ clients: clients.map(withStatus), stats });
});

router.post('/', async (req, res) => {
  const { db } = req.app.locals;
  const b = parse(clientSchema, req.body);
  const client = await db.tx(async (t) => {
    const [row] = await t.query('INSERT INTO clients (name, phone, email) VALUES ($1,$2,$3) RETURNING id', [b.name, b.phone, b.email]);
    if (b.opening_debt > 0) await insertOpening(t, row.id, b.opening_debt, b.opening_date);
    return getClient(t, row.id);
  });
  res.status(201).json({ client: withStatus(client) });
});

// Edit a client, including the debt they already owed before using the app.
router.patch('/:id', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const b = parse(patchSchema, req.body);
  const client = await db.tx(async (t) => {
    if (!(await t.query('SELECT id FROM clients WHERE id = $1 FOR UPDATE', [id]))[0]) throw new HttpError(404, 'Client introuvable');
    const sets = [], params = [];
    const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
    if (b.name !== undefined) set('name', b.name);
    if (b.phone !== undefined) set('phone', b.phone || null);
    if (b.email !== undefined) set('email', b.email || null);
    if (sets.length) await t.query(`UPDATE clients SET ${sets.join(', ')} WHERE id = $${params.length + 1}`, [...params, id]);

    if (b.opening_debt !== undefined) {
      const [op] = await t.query('SELECT id, amount_paid FROM orders WHERE client_id = $1 AND is_opening FOR UPDATE', [id]);
      if (!op) {
        if (b.opening_debt > 0) await insertOpening(t, id, b.opening_debt, b.opening_date);
      } else {
        if (b.opening_debt < op.amount_paid) {
          throw new HttpError(400, `La dette antérieure ne peut pas être inférieure à ce qui a déjà été payé dessus (${op.amount_paid}).`, 'OPENING_BELOW_PAID');
        }
        if (b.opening_debt === 0) await t.query('DELETE FROM orders WHERE id = $1', [op.id]); // nothing paid on it: just remove it
        else await t.query(
          `UPDATE orders SET unit_price = $1, status = $2, order_date = COALESCE($3::date, order_date) WHERE id = $4`,
          [b.opening_debt, orderStatus(b.opening_debt, op.amount_paid), b.opening_date ?? null, op.id]);
      }
    }
    return getClient(t, id);
  });
  res.json({ client: withStatus(client) });
});

router.get('/:id/debts', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const client = await getClient(db, id);
  if (!client) throw new HttpError(404, 'Client introuvable');
  const unpaid = await db.query(
    `SELECT id, order_number, product_service, order_date, due_date, total_amount, amount_paid, is_opening,
            (total_amount - amount_paid) AS amount_due, status, (due_date < CURRENT_DATE) AS overdue
     FROM orders WHERE client_id = $1 AND total_amount > amount_paid ORDER BY order_date, id`, [id]);
  const recent = await db.query(
    `SELECT id, order_number, product_service, order_date, total_amount, amount_paid, status
     FROM orders WHERE client_id = $1 AND NOT is_opening ORDER BY order_date DESC, id DESC LIMIT 5`, [id]);
  const [opening] = await db.query('SELECT order_date, unit_price AS total, amount_paid AS paid FROM orders WHERE client_id = $1 AND is_opening', [id]);
  res.json({
    client: withStatus(client), total_debt: client.debt, unpaid_orders: unpaid, recent_orders: recent,
    opening: opening ? { total: opening.total, paid: opening.paid, due: round2(opening.total - opening.paid), date: opening.order_date } : null,
  });
});

const paySchema = z.object({
  amount: money.refine((v) => v > 0, 'doit être > 0'),
  payment_method: z.enum(['Espèces', 'Carte', 'Virement', 'Chèque', 'Prélèvement']).default('Espèces'),
});

// Settle a client's debt: applies the payment to the oldest unpaid orders first (previous debt included).
router.post('/:id/payments', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const b = parse(paySchema, req.body);
  const result = await db.tx(async (t) => {
    const client = (await t.query('SELECT id, name FROM clients WHERE id = $1 FOR UPDATE', [id]))[0];
    if (!client) throw new HttpError(404, 'Client introuvable');
    const unpaid = await t.query(
      'SELECT id, order_number, total_amount, amount_paid, is_opening FROM orders WHERE client_id = $1 AND total_amount > amount_paid ORDER BY order_date, id FOR UPDATE', [id]);
    const debt = round2(unpaid.reduce((s, o) => s + (o.total_amount - o.amount_paid), 0));
    if (b.amount > debt) throw new HttpError(400, `Le montant (${b.amount}) dépasse la dette du client (${debt})`, 'OVERPAYMENT');
    let left = b.amount;
    const applied = [];
    for (const o of unpaid) {
      if (left <= 0) break;
      const part = Math.min(left, round2(o.total_amount - o.amount_paid));
      const newPaid = round2(o.amount_paid + part);
      await t.query('UPDATE orders SET amount_paid=$1, status=$2, payment_method=$3 WHERE id=$4',
        [newPaid, orderStatus(o.total_amount, newPaid), b.payment_method, o.id]);
      await logCash(t, { description: `Règlement ${o.order_number}${o.is_opening ? ' (dette antérieure)' : ''} — ${client.name}`, type: 'IN', amount: part, method: b.payment_method });
      applied.push({ order_number: o.order_number, amount: part, is_opening: o.is_opening });
      left = round2(left - part);
    }
    return applied;
  });
  const client = await getClient(db, id);
  res.json({ applied: result, client: withStatus(client) });
});

export default router;
