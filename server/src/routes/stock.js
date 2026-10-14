import { Router } from 'express';
import { z } from 'zod';
import { HttpError, idParam, likeParam, money, parse, qty } from '../http.js';

const router = Router();

const SELECT_ITEM = `
  SELECT id, ref, item, unit, initial_stock, current_stock,
         (current_stock - initial_stock) AS movement,
         purchase_price, alert_threshold,
         ROUND(current_stock * purchase_price, 2) AS value,
         (current_stock <= alert_threshold) AS low
  FROM inventory`;

const createSchema = z.object({
  ref: z.string().trim().min(1).max(50),
  item: z.string().trim().min(1).max(255),
  initial_stock: qty.refine((v) => v >= 0).default(0),
  purchase_price: money.refine((v) => v >= 0),
  alert_threshold: qty.refine((v) => v >= 0).default(5),
  unit: z.string().trim().min(1).max(20).default('pcs'),
});

const patchSchema = z.object({
  item: z.string().trim().min(1).max(255).optional(),
  purchase_price: money.refine((v) => v >= 0).optional(),
  alert_threshold: qty.refine((v) => v >= 0).optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  delta: z.coerce.number().finite().optional(),        // +10 restock / -3 correction
  current_stock: qty.refine((v) => v >= 0).optional(), // absolute count (after an inventory count)
}).refine((v) => !(v.delta !== undefined && v.current_stock !== undefined), 'Utilisez delta OU current_stock, pas les deux');

router.get('/', async (req, res) => {
  const { db } = req.app.locals;
  const like = likeParam(req.query.q);
  const onlyLow = req.query.low === '1' || req.query.low === 'true';
  const items = await db.query(
    `${SELECT_ITEM} WHERE ($1::text IS NULL OR ref ILIKE $1 OR item ILIKE $1) AND ($2::boolean = false OR current_stock <= alert_threshold) ORDER BY ref`,
    [like, onlyLow]);
  const [stats] = await db.query(
    'SELECT COUNT(*) FILTER (WHERE current_stock <= alert_threshold) AS low_count, COALESCE(SUM(ROUND(current_stock * purchase_price, 2)),0) AS total_value, COUNT(*) AS items FROM inventory');
  res.json({ items, stats });
});

router.post('/', async (req, res) => {
  const { db } = req.app.locals;
  const b = parse(createSchema, req.body);
  try {
    const rows = await db.query(
      `INSERT INTO inventory (ref, item, initial_stock, current_stock, purchase_price, alert_threshold, unit)
       VALUES ($1,$2,$3,$3,$4,$5,$6) RETURNING id`,
      [b.ref, b.item, b.initial_stock, b.purchase_price, b.alert_threshold, b.unit]);
    res.status(201).json({ item: (await db.query(`${SELECT_ITEM} WHERE id = $1`, [rows[0].id]))[0] });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, `La référence « ${b.ref} » existe déjà`, 'REF_TAKEN');
    throw e;
  }
});

router.patch('/:id', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const b = parse(patchSchema, req.body);
  const item = await db.tx(async (t) => {
    const cur = (await t.query('SELECT * FROM inventory WHERE id = $1 FOR UPDATE', [id]))[0];
    if (!cur) throw new HttpError(404, 'Article introuvable');
    let stock = cur.current_stock;
    if (b.delta !== undefined) stock = Math.round((stock + b.delta) * 100) / 100;
    if (b.current_stock !== undefined) stock = b.current_stock;
    // Never push stock further below zero (restocking an already-negative item is fine).
    if (stock < 0 && stock < cur.current_stock) throw new HttpError(400, `Le stock ne peut pas être négatif (actuel : ${cur.current_stock})`, 'NEGATIVE_STOCK');
    await t.query(
      `UPDATE inventory SET item=$1, purchase_price=$2, alert_threshold=$3, unit=$4, current_stock=$5 WHERE id=$6`,
      [b.item ?? cur.item, b.purchase_price ?? cur.purchase_price, b.alert_threshold ?? cur.alert_threshold, b.unit ?? cur.unit, stock, id]);
    return (await t.query(`${SELECT_ITEM} WHERE id = $1`, [id]))[0];
  });
  res.json({ item });
});

export default router;
