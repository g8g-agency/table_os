-- ============================================================
-- Migration: 20260609000001_add_cancelled_to_kitchen_status.sql
-- Add cancelled state to kitchen order status enum.
-- ============================================================

BEGIN;

ALTER TYPE public.kitchen_order_status ADD VALUE IF NOT EXISTS 'cancelled';

COMMIT;
