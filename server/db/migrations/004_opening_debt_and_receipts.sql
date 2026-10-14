-- A client's debt from BEFORE the app was used ("dette antérieure") is stored as one special order row per client:
-- it counts as a debt (client screen, payments, dashboard "dettes") but never as a sale (revenue, order counts,
-- best sellers) and never touches stock or cash until the client actually pays.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_opening BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_opening_client ON orders (client_id) WHERE is_opening;
