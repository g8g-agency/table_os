BEGIN;

ALTER TABLE public.table_runtime_projections
ADD COLUMN IF NOT EXISTS customer_payment_intent TEXT CHECK (customer_payment_intent IN ('cash', 'upi'));

COMMIT;
