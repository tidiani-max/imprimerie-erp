-- The "Bâches & autocollants" page lists only support orders: keep it fast with a partial index.
CREATE INDEX IF NOT EXISTS idx_orders_support ON orders (order_date DESC, id DESC) WHERE support_type IS NOT NULL;
