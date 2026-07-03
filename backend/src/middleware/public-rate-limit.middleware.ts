// import rateLimit from 'express-rate-limit';
// import { logger } from '../shared/utils/logger';

export const publicOrderLimiter = (_req: any, _res: any, next: any) => {
  next();
};
