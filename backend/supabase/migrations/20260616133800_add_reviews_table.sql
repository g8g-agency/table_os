CREATE TABLE reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  order_id UUID NOT NULL REFERENCES orders(id),
  phone TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can insert reviews" ON reviews
  FOR INSERT TO anon WITH CHECK (true);

CREATE INDEX idx_reviews_tenant_id ON reviews(tenant_id);
CREATE INDEX idx_reviews_order_id ON reviews(order_id);
