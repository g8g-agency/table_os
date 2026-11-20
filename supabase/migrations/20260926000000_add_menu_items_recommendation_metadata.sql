-- ============================================================
-- Migration: 20260926000000_add_menu_items_recommendation_metadata.sql
-- Description: Adds recommendation_enabled and recommendation_tags to menu_items
-- Phase: 1 (Admin & Recommendation Shared Contract)
-- ============================================================

ALTER TABLE public.menu_items
ADD COLUMN IF NOT EXISTS recommendation_enabled BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS recommendation_tags TEXT[] NOT NULL DEFAULT '{}';

-- Performance index for recommendation candidate generation (filtering enabled items per tenant)
CREATE INDEX IF NOT EXISTS idx_menu_items_recommendation_enabled
ON public.menu_items(tenant_id, recommendation_enabled)
WHERE deleted_at IS NULL;

-- GIN index for recommendation tags matching and scoring
CREATE INDEX IF NOT EXISTS idx_menu_items_recommendation_tags
ON public.menu_items USING GIN (recommendation_tags)
WHERE deleted_at IS NULL;
