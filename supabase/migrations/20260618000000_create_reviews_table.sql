-- Migration: Create Reviews System Table
-- Purpose: Store customer ratings and feedback, strictly validating uniqueness per order and preventing public writes.

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  guest_session_id UUID NOT NULL REFERENCES guest_sessions(id) ON DELETE CASCADE,
  
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  food_rating INTEGER CHECK (food_rating BETWEEN 1 AND 5),
  service_rating INTEGER CHECK (service_rating BETWEEN 1 AND 5),
  is_flagged BOOLEAN NOT NULL DEFAULT false,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- In case the table already existed from a previous attempt, add the new columns safely
ALTER TABLE reviews 
  ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES guest_sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS food_rating INTEGER CHECK (food_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS service_rating INTEGER CHECK (service_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES staff(id) ON DELETE SET NULL;

-- If guest_session_id was added as nullable (because table had data), and we need it to be NOT NULL, 
-- we would do it here, but skipping strict NOT NULL enforcement on ALTER to avoid breaking existing rows.


-- Indices
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_order_unique ON reviews(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_branch_id ON reviews(branch_id);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant_id ON reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_guest_session_id ON reviews(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at DESC);

-- Enable RLS
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Block all public inserts — only backend (service role) can write
CREATE POLICY reviews_no_public_insert ON reviews
FOR INSERT TO anon, authenticated
WITH CHECK (false);

-- Block public/guest selects
CREATE POLICY reviews_no_public_select ON reviews
FOR SELECT TO anon
USING (false);

-- Allow admin select using the existing role pattern
CREATE POLICY reviews_admin_select ON reviews
FOR SELECT TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM staff 
    WHERE staff.user_id = auth.uid() 
      AND staff.role IN ('SUPER_ADMIN', 'RESTAURANT_ADMIN', 'MANAGER')
  )
);
