-- Speed for large data (hundreds of thousands of orders and more).
-- List screens sort by date then id; text search uses trigram indexes (pg_trgm) so "contains" searches stay fast.
CREATE INDEX IF NOT EXISTS idx_orders_date_id ON orders (order_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_date ON orders (status, order_date DESC, id DESC);
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_orders_number_trgm  ON orders  USING gin (order_number   gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_orders_service_trgm ON orders  USING gin (product_service gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_clients_name_trgm   ON clients USING gin (name            gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_clients_phone_trgm  ON clients USING gin (phone           gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm unavailable (%): text search will be slower on very large data', SQLERRM;
END $$;
