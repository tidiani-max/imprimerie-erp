import { Router } from 'express';
import { z } from 'zod';
import { requireOwner } from '../auth.js';
import { logCash } from '../cash.js';
import { HttpError, idParam, likeParam, money, orderStatus, parse, round2 } from '../http.js';

// Money the imprimerie owes to others. Owner only: this is the shop's own financial position.
const router = Router();
router.use(requireOwner);

export const KINDS = ['Fournisseur', 'Sous-traitant', 'Autre'];
const METHODS = ['Espèces', 'Carte', 'Virement', 'Chèque', 'Prélèvement'];
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format AAAA-MM-JJ');
const positive = money.refine((v) => v > 0, 'doit être > 0');
const nonNegative = money.refine((v) => v >= 0, 'doit être >= 0');

const supplierSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(50).nullish().transform((v) => v || null),
  kind: z.enum(KINDS).default('Fournisseur'),
  notes: z.string().trim().max(1000).nullish().transform((v) => v || null),
  opening_debt: nonNegative.default(0), // what is already owed from before the app
  opening_date: dateStr.optional(),
});
const supplierPatch = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  phone: z.string().trim().max(50).nullish(),
  kind: z.enum(KINDS).optional(),
  notes: z.string().trim().max(1000).nullish(),
  opening_debt: nonNegative.optional(),
  opening_date: dateStr.optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), 'Rien à modifier');

const billSchema = z.object({
  description: z.string().trim().min(1).max(255),
  reference: z.string().trim().max(100).nullish().transform((v) => v || null),
  amount: positive,
  amount_paid: nonNegative.default(0), // already paid when recorded
  payment_method: z.enum(METHODS).default('Espèces'),
  bill_date: dateStr.optional(),
  due_date: dateStr.nullish(),
}).refine((v) => v.amount_paid <= v.amount, { message: 'Le montant payé dépasse le montant', path: ['amount_paid'] });
const billPatch = z.object({
  description: z.string().trim().min(1).max(255).optional(),
  reference: z.string().trim().max(100).nullish(),
  amount: positive.optional(),
  bill_date: dateStr.optional(),
  due_date: dateStr.nullish(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), 'Rien à modifier');
const paySchema = z.object({ amount: positive, payment_method: z.enum(METHODS).default('Espèces') });

// debt = what is still to pay; total_billed / total_paid cover every bill (previous debt included).
const SUPPLIER_SELECT = `
  SELECT s.id, s.name, s.phone, s.kind, s.notes, s.created_at,
         COUNT(b.id) FILTER (WHERE NOT b.is_opening) AS bills_count,
         COALESCE(SUM(b.amount), 0) AS total_billed,
         COALESCE(SUM(b.amount_paid), 0) AS total_paid,
         COALESCE(SUM(b.amount - b.amount_paid), 0) AS debt,
         COALESCE(SUM(b.amount) FILTER (WHERE b.is_opening), 0) AS opening_total,
         COALESCE(SUM(b.amount_paid) FILTER (WHERE b.is_opening), 0) AS opening_paid,
         MIN(b.due_date) FILTER (WHERE b.amount > b.amount_paid) AS next_due,
         COALESCE(BOOL_OR(b.amount > b.amount_paid AND b.due_date < CURRENT_DATE), false) AS overdue,
         MAX(b.bill_date) AS last_bill_date
  FROM suppliers s LEFT JOIN supplier_bills b ON b.supplier_id = s.id`;
const withStatus = (s) => ({ ...s, status: s.debt <= 0 ? 'ok' : s.overdue ? 'overdue' : 'debt' });
const getSupplier = async (t, id) => (await t.query(`${SUPPLIER_SELECT} WHERE s.id = $1 GROUP BY s.id`, [id]))[0];
const billStatus = (b) => orderStatus(b.amount, b.amount_paid);
const payLabel = (name, bill) => `Paiement fournisseur — ${name} (${bill.is_opening ? 'dette antérieure' : bill.description})`;

async function insertOpening(t, supplierId, amount, date) {
  await t.query(
    `INSERT INTO supplier_bills (supplier_id, description, amount, bill_date, is_opening)
     VALUES ($1, 'Dette antérieure', $2, COALESCE($3::date, CURRENT_DATE), TRUE)`, [supplierId, amount, date ?? null]);
}

router.get('/', async (req, res) => {
  const { db } = req.app.locals;
  const like = likeParam(req.query.q);
  const suppliers = await db.query(
    `${SUPPLIER_SELECT} WHERE ($1::text IS NULL OR s.name ILIKE $1 OR s.phone ILIKE $1) GROUP BY s.id ORDER BY lower(s.name)`, [like]);
  const [stats] = await db.query(`
    SELECT (SELECT COUNT(*) FROM suppliers) AS count,
           COALESCE((SELECT SUM(amount - amount_paid) FROM supplier_bills), 0) AS total_debt,
           (SELECT COUNT(*) FROM supplier_bills WHERE amount > amount_paid) AS unpaid_bills,
           COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE paid_at >= date_trunc('month', CURRENT_DATE)), 0) AS paid_month`);
  res.json({ suppliers: suppliers.map(withStatus), stats });
});

router.post('/', async (req, res) => {
  const { db } = req.app.locals;
  const b = parse(supplierSchema, req.body);
  const supplier = await db.tx(async (t) => {
    const [row] = await t.query('INSERT INTO suppliers (name, phone, kind, notes) VALUES ($1,$2,$3,$4) RETURNING id', [b.name, b.phone, b.kind, b.notes]);
    if (b.opening_debt > 0) await insertOpening(t, row.id, b.opening_debt, b.opening_date);
    return getSupplier(t, row.id);
  });
  res.status(201).json({ supplier: withStatus(supplier) });
});

router.get('/:id', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const supplier = await getSupplier(db, id);
  if (!supplier) throw new HttpError(404, 'Fournisseur introuvable');
  const bills = await db.query(
    `SELECT id, description, reference, amount, amount_paid, (amount - amount_paid) AS amount_due, bill_date, due_date, is_opening,
            (due_date < CURRENT_DATE AND amount > amount_paid) AS overdue
     FROM supplier_bills WHERE supplier_id = $1 ORDER BY bill_date DESC, id DESC`, [id]);
  const payments = await db.query(
    `SELECT p.id, p.amount, p.payment_method, to_char(p.paid_at, 'YYYY-MM-DD HH24:MI') AS paid_at,
            CASE WHEN b.is_opening THEN 'Dette antérieure' ELSE b.description END AS description
     FROM supplier_payments p LEFT JOIN supplier_bills b ON b.id = p.bill_id
     WHERE p.supplier_id = $1 ORDER BY p.id DESC LIMIT 30`, [id]);
  const opening = bills.find((x) => x.is_opening);
  res.json({
    supplier: withStatus(supplier),
    bills: bills.map((x) => ({ ...x, status: billStatus(x) })),
    payments,
    opening: opening ? { total: opening.amount, paid: opening.amount_paid, due: opening.amount_due, date: opening.bill_date } : null,
  });
});

router.patch('/:id', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const b = parse(supplierPatch, req.body);
  const supplier = await db.tx(async (t) => {
    if (!(await t.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [id]))[0]) throw new HttpError(404, 'Fournisseur introuvable');
    const sets = [], params = [];
    const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
    if (b.name !== undefined) set('name', b.name);
    if (b.phone !== undefined) set('phone', b.phone || null);
    if (b.kind !== undefined) set('kind', b.kind);
    if (b.notes !== undefined) set('notes', b.notes || null);
    if (sets.length) await t.query(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = $${params.length + 1}`, [...params, id]);
    if (b.opening_debt !== undefined) {
      const [op] = await t.query('SELECT id, amount_paid FROM supplier_bills WHERE supplier_id = $1 AND is_opening FOR UPDATE', [id]);
      if (!op) { if (b.opening_debt > 0) await insertOpening(t, id, b.opening_debt, b.opening_date); }
      else {
        if (b.opening_debt < op.amount_paid) {
          throw new HttpError(400, `La dette antérieure ne peut pas être inférieure à ce qui a déjà été payé dessus (${op.amount_paid}).`, 'OPENING_BELOW_PAID');
        }
        if (b.opening_debt === 0) await t.query('DELETE FROM supplier_bills WHERE id = $1', [op.id]);
        else await t.query('UPDATE supplier_bills SET amount = $1, bill_date = COALESCE($2::date, bill_date) WHERE id = $3', [b.opening_debt, b.opening_date ?? null, op.id]);
      }
    }
    return getSupplier(t, id);
  });
  res.json({ supplier: withStatus(supplier) });
});

// Record something the imprimerie must pay: a purchase, a job passed to another workshop… Optionally already (partly) paid.
router.post('/:id/bills', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const b = parse(billSchema, req.body);
  const out = await db.tx(async (t) => {
    const s = (await t.query('SELECT id, name FROM suppliers WHERE id = $1 FOR UPDATE', [id]))[0];
    if (!s) throw new HttpError(404, 'Fournisseur introuvable');
    const [bill] = await t.query(
      `INSERT INTO supplier_bills (supplier_id, description, reference, amount, amount_paid, bill_date, due_date)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6::date, CURRENT_DATE), $7) RETURNING *`,
      [id, b.description, b.reference, b.amount, b.amount_paid, b.bill_date ?? null, b.due_date ?? null]);
    if (b.amount_paid > 0) {
      await t.query('INSERT INTO supplier_payments (supplier_id, bill_id, amount, payment_method) VALUES ($1,$2,$3,$4)', [id, bill.id, b.amount_paid, b.payment_method]);
      await logCash(t, { description: payLabel(s.name, bill), type: 'OUT', amount: b.amount_paid, method: b.payment_method });
    }
    return { bill, supplier: await getSupplier(t, id) };
  });
  res.status(201).json({ bill: { ...out.bill, status: billStatus(out.bill) }, supplier: withStatus(out.supplier) });
});

router.patch('/:id/bills/:billId', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const billId = parse(idParam, req.params.billId);
  const b = parse(billPatch, req.body);
  const out = await db.tx(async (t) => {
    const cur = (await t.query('SELECT * FROM supplier_bills WHERE id = $1 AND supplier_id = $2 FOR UPDATE', [billId, id]))[0];
    if (!cur) throw new HttpError(404, 'Ligne introuvable');
    if (cur.is_opening) throw new HttpError(400, 'Modifiez la dette antérieure depuis la fiche du fournisseur.', 'OPENING_ROW');
    if (b.amount !== undefined && b.amount < cur.amount_paid) {
      throw new HttpError(400, `Le montant ne peut pas être inférieur à ce qui est déjà payé (${cur.amount_paid}).`, 'BELOW_PAID');
    }
    const sets = [], params = [];
    const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
    if (b.description !== undefined) set('description', b.description);
    if (b.reference !== undefined) set('reference', b.reference || null);
    if (b.amount !== undefined) set('amount', b.amount);
    if (b.bill_date !== undefined) set('bill_date', b.bill_date);
    if (b.due_date !== undefined) set('due_date', b.due_date || null);
    const [bill] = await t.query(`UPDATE supplier_bills SET ${sets.join(', ')} WHERE id = $${params.length + 1} RETURNING *`, [...params, billId]);
    return { bill, supplier: await getSupplier(t, id) };
  });
  res.json({ bill: { ...out.bill, status: billStatus(out.bill) }, supplier: withStatus(out.supplier) });
});

// Only a line nothing was paid on can be removed (an entry typed by mistake); money that already left the till stays on record.
router.delete('/:id/bills/:billId', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const billId = parse(idParam, req.params.billId);
  const supplier = await db.tx(async (t) => {
    const cur = (await t.query('SELECT * FROM supplier_bills WHERE id = $1 AND supplier_id = $2 FOR UPDATE', [billId, id]))[0];
    if (!cur) throw new HttpError(404, 'Ligne introuvable');
    if (cur.is_opening) throw new HttpError(400, 'Modifiez la dette antérieure depuis la fiche du fournisseur.', 'OPENING_ROW');
    if (cur.amount_paid > 0) throw new HttpError(400, `Impossible de supprimer : ${cur.amount_paid} ont déjà été payés sur cette ligne.`, 'ALREADY_PAID');
    await t.query('DELETE FROM supplier_bills WHERE id = $1', [billId]);
    return getSupplier(t, id);
  });
  res.json({ supplier: withStatus(supplier) });
});

// Pay a supplier: applied to the oldest unpaid lines first; the money leaves the cash register.
router.post('/:id/payments', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const b = parse(paySchema, req.body);
  const applied = await db.tx(async (t) => {
    const s = (await t.query('SELECT id, name FROM suppliers WHERE id = $1 FOR UPDATE', [id]))[0];
    if (!s) throw new HttpError(404, 'Fournisseur introuvable');
    const unpaid = await t.query('SELECT * FROM supplier_bills WHERE supplier_id = $1 AND amount > amount_paid ORDER BY bill_date, id FOR UPDATE', [id]);
    const debt = round2(unpaid.reduce((sum, x) => sum + (x.amount - x.amount_paid), 0));
    if (b.amount > debt) throw new HttpError(400, `Le montant (${b.amount}) dépasse ce que vous devez à ce fournisseur (${debt})`, 'OVERPAYMENT');
    let left = b.amount;
    const done = [];
    for (const x of unpaid) {
      if (left <= 0) break;
      const part = Math.min(left, round2(x.amount - x.amount_paid));
      await t.query('UPDATE supplier_bills SET amount_paid = $1 WHERE id = $2', [round2(x.amount_paid + part), x.id]);
      await t.query('INSERT INTO supplier_payments (supplier_id, bill_id, amount, payment_method) VALUES ($1,$2,$3,$4)', [id, x.id, part, b.payment_method]);
      await logCash(t, { description: payLabel(s.name, x), type: 'OUT', amount: part, method: b.payment_method });
      done.push({ description: x.is_opening ? 'Dette antérieure' : x.description, amount: part, is_opening: x.is_opening });
      left = round2(left - part);
    }
    return done;
  });
  res.json({ applied, supplier: withStatus(await getSupplier(db, id)) });
});

export default router;
