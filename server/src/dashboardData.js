const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

// Single source of truth for the dashboard AND the Excel report, so they can never disagree.
// Revenue = billed turnover (orders.total_amount by order_date), excluding previous-debt rows (they are not sales).
// Debts = everything still owed on orders, previous-debt rows included.
export async function getDashboard(db) {
  const [k] = await db.query(`
    WITH b AS (SELECT CURRENT_DATE AS today, date_trunc('month', CURRENT_DATE)::date AS m0,
                      (date_trunc('month', CURRENT_DATE) - interval '1 month')::date AS pm0)
    SELECT
      COALESCE((SELECT SUM(total_amount) FROM orders, b WHERE NOT is_opening AND order_date = b.today), 0) AS rev_today,
      COALESCE((SELECT SUM(total_amount) FROM orders, b WHERE NOT is_opening AND order_date = b.today - 1), 0) AS rev_yesterday,
      COALESCE((SELECT SUM(total_amount) FROM orders, b WHERE NOT is_opening AND order_date >= b.m0), 0) AS rev_month,
      COALESCE((SELECT SUM(total_amount) FROM orders, b WHERE NOT is_opening AND order_date >= b.pm0 AND order_date < b.m0), 0) AS rev_prev_month,
      COALESCE((SELECT SUM(amount) FROM expenses, b WHERE expense_date >= b.m0), 0) AS exp_month,
      COALESCE((SELECT SUM(amount) FROM expenses, b WHERE expense_date >= b.pm0 AND expense_date < b.m0), 0) AS exp_prev_month,
      COALESCE((SELECT SUM(total_amount - amount_paid) FROM orders), 0) AS unpaid_total,
      (SELECT COUNT(*) FROM orders WHERE total_amount > amount_paid) AS unpaid_count,
      (SELECT COUNT(*) FROM orders, b WHERE NOT is_opening AND order_date >= b.m0) AS orders_month,
      (SELECT COUNT(*) FROM orders, b WHERE NOT is_opening AND order_date >= b.pm0 AND order_date < b.m0) AS orders_prev_month,
      COALESCE((SELECT SUM(ROUND(current_stock * purchase_price, 2)) FROM inventory), 0) AS stock_value`);

  const top = await db.query(`
    SELECT product_service AS name, SUM(total_amount) AS amount
    FROM orders WHERE NOT is_opening AND order_date >= date_trunc('month', CURRENT_DATE)::date
    GROUP BY product_service ORDER BY 2 DESC LIMIT 4`);
  const topTotal = top.reduce((s, r) => s + r.amount, 0);

  const series = await db.query(`
    SELECT to_char(m, 'YYYY-MM') AS month,
           COALESCE((SELECT SUM(total_amount) FROM orders WHERE NOT is_opening AND order_date >= m::date AND order_date < (m + interval '1 month')::date), 0) AS sales,
           COALESCE((SELECT SUM(amount) FROM expenses WHERE expense_date >= m::date AND expense_date < (m + interval '1 month')::date), 0) AS expenses
    FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month') AS m
    ORDER BY m`);

  const recent = await db.query(`
    SELECT o.id, o.order_number, c.name AS client_name, o.product_service, o.quantity, o.total_amount, o.amount_paid,
           (o.total_amount - o.amount_paid) AS amount_due, o.status, o.order_date, o.created_at,
           o.support_type, o.width_cm, o.height_cm
    FROM orders o LEFT JOIN clients c ON c.id = o.client_id WHERE NOT o.is_opening ORDER BY o.order_date DESC, o.id DESC LIMIT 5`);

  return {
    today_revenue: k.rev_today, today_revenue_trend: pct(k.rev_today, k.rev_yesterday),
    monthly_revenue: k.rev_month, monthly_revenue_trend: pct(k.rev_month, k.rev_prev_month),
    monthly_expenses: k.exp_month, monthly_expenses_trend: pct(k.exp_month, k.exp_prev_month),
    net_profit: Math.round((k.rev_month - k.exp_month) * 100) / 100,
    unpaid_debts: k.unpaid_total, unpaid_count: k.unpaid_count,
    stock_value: k.stock_value,
    orders_month: k.orders_month, orders_month_trend: pct(k.orders_month, k.orders_prev_month),
    top_items: top.map((r) => ({ ...r, share: topTotal ? Math.round((r.amount / topTotal) * 100) : 0 })),
    top_items_total: topTotal,
    series, recent_orders: recent,
  };
}
