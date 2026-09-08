-- 20260809000000_remove_split_bill.sql
-- Safely drops split_allocations table and parent_bill_id column from bills.

-- 1. Drop index on parent_bill_id
DROP INDEX IF EXISTS public.idx_bills_parent;

-- 2. Drop the parent_bill_id column
ALTER TABLE public.bills
DROP COLUMN IF EXISTS parent_bill_id;

-- 3. Drop split_allocations table and its policies
DROP POLICY IF EXISTS "split_allocations_tenant_isolation" ON public.split_allocations;
DROP TABLE IF EXISTS public.split_allocations;
