import { supabaseAdmin } from '../../config/supabase';

export interface Review {
  id: string;
  tenant_id: string;
  branch_id: string;
  order_id: string | null;
  guest_session_id: string;
  rating: number;
  comment?: string;
  food_rating?: number;
  service_rating?: number;
  is_flagged: boolean;
  staff_id?: string;
  created_at: string;
}

export type CreateReviewDto = Omit<Review, 'id' | 'created_at'>;

export async function createReview(dto: CreateReviewDto): Promise<Review> {
  const { data, error } = await supabaseAdmin
    .from('reviews')
    .insert(dto)
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

export async function getReviewByOrderId(tenantId: string, orderId: string): Promise<Review | null> {
  const { data, error } = await supabaseAdmin
    .from('reviews')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('order_id', orderId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

export async function listReviews(tenantId: string, branchId?: string, limit: number = 50, offset: number = 0): Promise<Review[]> {
  let query = supabaseAdmin
    .from('reviews')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (branchId) {
    query = query.eq('branch_id', branchId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data || [];
}

export async function getReviewAnalytics(tenantId: string, branchId?: string): Promise<any> {
  let query = supabaseAdmin
    .from('reviews')
    .select('rating', { count: 'exact' })
    .eq('tenant_id', tenantId);

  if (branchId) {
    query = query.eq('branch_id', branchId);
  }

  const { data, count, error } = await query;
  if (error) {
    throw error;
  }

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalRating = 0;

  if (data) {
    data.forEach(r => {
      if (r.rating >= 1 && r.rating <= 5) {
        distribution[r.rating as 1|2|3|4|5]++;
        totalRating += r.rating;
      }
    });
  }

  const average_rating = count && count > 0 ? totalRating / count : 0;

  return {
    average_rating,
    total_reviews: count,
    distribution,
  };
}
