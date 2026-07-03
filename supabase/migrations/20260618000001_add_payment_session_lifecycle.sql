-- 20260618000001_add_payment_session_lifecycle.sql

-- 1. Add payment fields to orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'completed', 'refunded', 'failed')),
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- 2. Add closed_reason to guest_sessions (ended_at already exists)
ALTER TABLE guest_sessions
  ADD COLUMN IF NOT EXISTS closed_reason TEXT
    CHECK (closed_reason IN (
      'payment_completed', 
      'dev_fake_payment', 
      'manual_close', 
      'session_timeout'
    ));

-- 3. Index for payment status queries
CREATE INDEX IF NOT EXISTS idx_orders_payment_status 
  ON orders(payment_status);

CREATE INDEX IF NOT EXISTS idx_orders_session_payment 
  ON orders(session_id, payment_status);
