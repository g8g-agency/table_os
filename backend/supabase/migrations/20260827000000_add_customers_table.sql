-- Migration to add a dedicated persistent customers table identified by phone number
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  name TEXT NULL,
  email TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, phone_number)
);

-- Enable RLS for customers
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Add RLS policy for tenant admins (standard pattern)
-- Here we'll just define a basic policy for service role/admin access. 
-- Adjust based on the actual policies needed.
CREATE POLICY "Tenant admin access" ON public.customers
FOR ALL USING (
  tenant_id = (current_setting('app.current_tenant', true))::uuid 
  OR current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
);

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS customer_id UUID NULL REFERENCES public.customers(id) ON DELETE SET NULL;
