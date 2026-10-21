-- Money the imprimerie OWES to others: shops it buys from, other workshops it passes part of a job to, anyone else.
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  kind VARCHAR(20) NOT NULL DEFAULT 'Fournisseur',   -- 'Fournisseur' | 'Sous-traitant' | 'Autre'
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One row per purchase / subcontracted job / debt to pay. is_opening = a debt from before the app was used
-- (one per supplier): it is a debt, not a cost of this month.
CREATE TABLE IF NOT EXISTS supplier_bills (
  id SERIAL PRIMARY KEY,
  supplier_id INT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  description VARCHAR(255) NOT NULL,
  reference VARCHAR(100),                             -- e.g. the client order the work was subcontracted for
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
  bill_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  is_opening BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (amount_paid >= 0 AND amount_paid <= amount)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_opening ON supplier_bills (supplier_id) WHERE is_opening;
CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier ON supplier_bills (supplier_id, bill_date);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_date ON supplier_bills (bill_date);

-- Every payment made to a supplier (history). The matching cash-register line is written in the same transaction.
CREATE TABLE IF NOT EXISTS supplier_payments (
  id SERIAL PRIMARY KEY,
  supplier_id INT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  bill_id INT REFERENCES supplier_bills(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(50) NOT NULL DEFAULT 'Espèces',
  paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments ON supplier_payments (supplier_id, paid_at DESC);
