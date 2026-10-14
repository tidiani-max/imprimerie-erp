import { Router } from 'express';
import { getDashboard } from '../dashboardData.js';

const router = Router();


// Revenue = billed turnover (orders.total_amount by order_date). Cash actually collected is on the Caisse page.
router.get('/', async (req, res) => {
  res.json(await getDashboard(req.app.locals.db));
});

// Powers the sidebar card + notification bell.
router.get('/alerts', async (req, res) => {
  const { db } = req.app.locals;
  const low = await db.query('SELECT id, ref, item, current_stock, alert_threshold, unit FROM inventory WHERE current_stock <= alert_threshold ORDER BY ref');
  const overdue = await db.query(`
    SELECT c.id, c.name, SUM(o.total_amount - o.amount_paid) AS debt, MIN(o.due_date) AS due_date
    FROM orders o JOIN clients c ON c.id = o.client_id
    WHERE o.total_amount > o.amount_paid AND o.due_date < CURRENT_DATE GROUP BY c.id ORDER BY MIN(o.due_date)`);
  res.json({ low_stock: low, overdue_clients: overdue });
});

export default router;
