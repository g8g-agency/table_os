-- Update guest_select_orders policy to allow customers to view orders in active and completed states
DROP POLICY IF EXISTS "guest_select_orders" ON public.orders;

CREATE POLICY "guest_select_orders" ON public.orders
  FOR SELECT TO anon, public
  USING (status IN ('pending', 'accepted', 'preparing', 'ready', 'delivered', 'completed'));
