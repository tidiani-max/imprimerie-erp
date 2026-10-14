-- Banners, stickers, labels…: orders priced by surface (width × height in cm × rate per cm²).
-- The rate used is stored on the order so a later tariff change never rewrites past orders or receipts.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS support_type VARCHAR(40);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS width_cm  NUMERIC(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS height_cm NUMERIC(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rate_cm2  NUMERIC(10, 4);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS extra_fees NUMERIC(12, 2) NOT NULL DEFAULT 0;
