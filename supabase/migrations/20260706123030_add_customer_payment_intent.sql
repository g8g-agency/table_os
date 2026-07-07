-- 20260706123030_add_customer_payment_intent.sql
-- Add customer payment intent columns and audit trail

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_payment_intent TEXT
    CHECK (customer_payment_intent IN ('cash', 'upi', NULL)),
  ADD COLUMN IF NOT EXISTS payment_intent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS confirmed_from TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Index so POS/staff queries for pending cash pickups are fast
CREATE INDEX IF NOT EXISTS idx_orders_payment_intent
  ON orders(branch_id, customer_payment_intent)
  WHERE status = 'awaiting_payment'
    AND customer_payment_intent IS NOT NULL;
