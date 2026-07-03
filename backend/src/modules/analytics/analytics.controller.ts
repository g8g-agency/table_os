/* eslint-disable */
import type { Response, NextFunction } from 'express';
import { getDailyAnalytics, getAnalyticsAnalysis } from './analytics.repository';
import { z } from 'zod';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';

export async function getDailySummary(req: any, res: Response, next: NextFunction) {
  try {
    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      res.status(400).json({ success: false, error: { message: 'Missing tenant context.' } });
      return;
    }
    const { date, branchId, branch_id, tz_offset_mins } = req.query;
    const effectiveBranchId = (branchId || branch_id) as string | undefined;
    const tzOffset = tz_offset_mins ? parseInt(tz_offset_mins as string, 10) : 0;

    if (!date || typeof date !== 'string') {
      res.status(400).json({ success: false, error: { message: 'Missing or invalid date parameter' } });
      return;
    }

    const data = await getDailyAnalytics(tenantId, date, effectiveBranchId, tzOffset);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getAnalysis(req: any, res: Response, next: NextFunction) {
  try {
    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      res.status(400).json({ success: false, error: { message: 'Missing tenant context.' } });
      return;
    }

    const schema = z.object({
      branch_id: z.string().uuid('branch_id must be a valid UUID'),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start_date must be YYYY-MM-DD'),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end_date must be YYYY-MM-DD'),
      tz_offset_mins: z.string().optional(),
    });

    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('Validation failed', 400, ErrorCode.VALIDATION_ERROR, true, parsed.error.format());
    }

    const { branch_id, start_date, end_date, tz_offset_mins } = parsed.data;
    const tzOffset = tz_offset_mins ? parseInt(tz_offset_mins, 10) : 0;

    const data = await getAnalyticsAnalysis(tenantId, branch_id, start_date, end_date, tzOffset);

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}
