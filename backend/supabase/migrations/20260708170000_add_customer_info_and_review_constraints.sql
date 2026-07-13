-- Add customer_name to orders and order_snapshots
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS customer_name TEXT NULL;

ALTER TABLE public.order_snapshots
ADD COLUMN IF NOT EXISTS customer_name TEXT NULL;

-- Enforce one review per completed order
-- Note: Assuming order status is stored in orders.status and reviews already has order_id
-- Add a unique constraint to ensure one review per order
ALTER TABLE public.reviews
ADD CONSTRAINT uq_reviews_order_id UNIQUE (order_id);

-- Note: Enforcing that the order must be 'completed' can be done via a trigger
-- or handled entirely at the API application layer. Given the constraints of Supabase RLS,
-- handling it in the application layer or via a Postgres trigger is best.
-- We'll add a trigger to enforce this constraint at the DB layer as a safeguard.

CREATE OR REPLACE FUNCTION check_order_status_for_review()
RETURNS TRIGGER AS $$
DECLARE
    v_order_status TEXT;
BEGIN
    SELECT status INTO v_order_status FROM public.orders WHERE id = NEW.order_id;
    
    IF v_order_status != 'completed' THEN
        RAISE EXCEPTION 'Cannot review an order that is not completed. Current status: %', v_order_status;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_order_status_for_review ON public.reviews;
CREATE TRIGGER trg_check_order_status_for_review
BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION check_order_status_for_review();
