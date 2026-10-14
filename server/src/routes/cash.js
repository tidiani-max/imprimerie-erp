import { Router } from 'express';
import { z } from 'zod';
import { likeParam, money, parse } from '../http.js';
import { logCash } from '../cash.js';

const router = Router();

const txSchema = z.object({
  type: z.enum(['IN', 'OUT']),
  amount: money.refine((v) => v > 0, 'doit être > 0'),
  description: z.string().trim().min(1).max(255),
  payment_method: z.enum(['Espèces', 'Carte', 'Virement', 'Chèque', 'Prélèvement']).default('Espèces'),
});

router.get('/', async (req, res) => {
  const { db } = req.app.locals;
  const like = likeParam(req.query.q);
  const period = ['today', 'week', 'month'].includes(req.query.period) ? req.query.period : 'all';
  const since = { today: 'CURRENT_DATE', week: "date_trunc('week', CURRENT_DATE)", month: "date_trunc('month', CURRENT_DATE)", all: null }[period];
  const entries = await db.query(
    `SELECT id, description, type, amount, running_balance, payment_method, created_at FROM cash_register
     WHERE ($1::text IS NULL OR description ILIKE $1) ${since ? `AND created_at >= ${since}` : ''}
     ORDER BY id DESC LIMIT 500`, [like]);
  const [s] = await db.query(`
    SELECT COALESCE((SELECT running_balance FROM cash_register ORDER BY id DESC LIMIT 1), 0) AS balance,
           COALESCE(SUM(amount) FILTER (WHERE type = 'IN'),  0) AS today_in,
           COALESCE(SUM(amount) FILTER (WHERE type = 'OUT'), 0) AS today_out
    FROM cash_register WHERE created_at >= CURRENT_DATE`);
  res.json({ entries, balance: s.balance, today: { in: s.today_in, out: s.today_out, net: Math.round((s.today_in - s.today_out) * 100) / 100 } });
});

router.post('/transaction', async (req, res) => {
  const b = parse(txSchema, req.body);
  const entry = await req.app.locals.db.tx((t) =>
    logCash(t, { description: b.description, type: b.type, amount: b.amount, method: b.payment_method }));
  res.status(201).json({ entry });
});

export default router;
