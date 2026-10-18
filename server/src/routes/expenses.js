import { Router } from 'express';
import { z } from 'zod';
import { likeParam, money, parse } from '../http.js';
import { logCash } from '../cash.js';

const router = Router();

const createSchema = z.object({
  category: z.string().trim().min(1).max(100),
  supplier: z.string().trim().max(255).nullish().transform((v) => v || null),
  amount: money.refine((v) => v > 0, 'doit être > 0'),
  payment_method: z.enum(['Espèces', 'Carte', 'Virement', 'Chèque', 'Prélèvement']).default('Espèces'),
  observation: z.string().trim().max(2000).nullish().transform((v) => v || null),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  log_to_cash: z.boolean().default(true), // also record the outflow in the cash register
});

router.get('/', async (req, res) => {
  const { db } = req.app.locals;
  const like = likeParam(req.query.q);
  const category = req.query.category ? String(req.query.category) : null;
  const expenses = await db.query(
    `SELECT id, category, supplier, amount, payment_method, observation, expense_date, created_at FROM expenses
     WHERE ($1::text IS NULL OR supplier ILIKE $1 OR observation ILIKE $1 OR category ILIKE $1) AND ($2::text IS NULL OR category = $2)
     ORDER BY expense_date DESC, id DESC LIMIT 500`, [like, category]);
  const categories = (await db.query('SELECT DISTINCT category FROM expenses ORDER BY 1')).map((r) => r.category);
  const [stats] = await db.query(`
    SELECT COALESCE(SUM(amount) FILTER (WHERE expense_date >= date_trunc('month', CURRENT_DATE)::date), 0) AS month_total,
           COALESCE(SUM(amount) FILTER (WHERE expense_date >= (date_trunc('month', CURRENT_DATE) - interval '1 month')::date
                                          AND expense_date <  date_trunc('month', CURRENT_DATE)::date), 0) AS prev_month_total,
           COUNT(*) FILTER (WHERE expense_date >= date_trunc('month', CURRENT_DATE)::date) AS month_count
    FROM expenses`);
  const [top] = await db.query(`
    SELECT category, SUM(amount) AS amount FROM expenses
    WHERE expense_date >= date_trunc('month', CURRENT_DATE)::date GROUP BY category ORDER BY 2 DESC LIMIT 1`);
  res.json({ expenses, categories, stats: { ...stats, top_category: top ?? null } });
});

router.post('/', async (req, res) => {
  const { db } = req.app.locals;
  const b = parse(createSchema, req.body);
  const expense = await db.tx(async (t) => {
    const rows = await t.query(
      `INSERT INTO expenses (category, supplier, amount, payment_method, observation, expense_date)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6::date, CURRENT_DATE)) RETURNING *`,
      [b.category, b.supplier, b.amount, b.payment_method, b.observation, b.expense_date ?? null]);
    if (b.log_to_cash) {
      await logCash(t, {
        description: `Dépense ${b.category}${b.supplier ? ' — ' + b.supplier : ''}`,
        type: 'OUT', amount: b.amount, method: b.payment_method,
      });
    }
    return rows[0];
  });
  res.status(201).json({ expense });
});

export default router;
