import { Router } from 'express';
import { getDailySummary, getAnalysis } from './analytics.controller';
import { authenticate } from '../../middleware/auth.middleware';

export const analyticsRouter = Router();

analyticsRouter.use(authenticate);

// Dashboard KPIs — lightweight summary for today
analyticsRouter.get('/daily', getDailySummary);

// Deep business analytics — revenue trends, top items, peak hours, order sources
analyticsRouter.get('/analysis', getAnalysis);
