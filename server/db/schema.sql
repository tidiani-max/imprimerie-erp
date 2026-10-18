-- Imprimerie ERP/CRM — PostgreSQL schema (version 1)
-- Applied automatically at startup by server/src/migrate.js (idempotent).

-- USERS & AUTH
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- SHOP SETTINGS (shop name collected at first sign-up, etc.)
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL
);

-- CLIENTS (CRM)
CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    total_spent NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients (lower(name));

-- STOCK / RAW MATERIALS (ERP)
CREATE TABLE IF NOT EXISTS inventory (
    id SERIAL PRIMARY KEY,
    ref VARCHAR(50) UNIQUE NOT NULL,
    item VARCHAR(255) NOT NULL,
    initial_stock NUMERIC(10, 2) NOT NULL DEFAULT 0,
    current_stock NUMERIC(10, 2) NOT NULL DEFAULT 0,
    purchase_price NUMERIC(10, 2) NOT NULL,
    alert_threshold NUMERIC(10, 2) NOT NULL DEFAULT 5,
    unit VARCHAR(20) NOT NULL DEFAULT 'pcs',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ORDERS / SALES (ERP)
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001;

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(50) UNIQUE NOT NULL,            -- e.g. CMD-1048
    client_id INT REFERENCES clients(id) ON DELETE SET NULL,
    product_service VARCHAR(255) NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
    total_amount NUMERIC(12, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    payment_method VARCHAR(50) NOT NULL DEFAULT 'Espèces',
    status VARCHAR(20) NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Paid', 'Partial', 'Unpaid')),
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    -- additions needed by the automated order workflow / CRM screens:
    due_date DATE,                                        -- payment due date (client "Échéance")
    inventory_id INT REFERENCES inventory(id) ON DELETE SET NULL, -- raw material consumed by this order
    material_used NUMERIC(10, 2),                         -- quantity of that material consumed
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders (client_id);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders (order_date);

-- EXPENSES (ERP)
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    category VARCHAR(100) NOT NULL,                       -- 'Encre', 'Bâche', 'Électricité', 'Salaire', etc.
    supplier VARCHAR(255),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50) NOT NULL DEFAULT 'Espèces',
    observation TEXT,
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date);

-- CASH REGISTER LOGS (Caisse)
CREATE TABLE IF NOT EXISTS cash_register (
    id SERIAL PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('IN', 'OUT')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    running_balance NUMERIC(12, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL DEFAULT 'Espèces',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
