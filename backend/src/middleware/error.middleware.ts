/* eslint-disable */
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors/AppError';
import { ErrorCode } from '../shared/errors/error-codes';
import { ResponseFormatter } from '../shared/utils/response-formatter';
import { logger } from '../shared/utils/logger';
import { Sentry } from '../config/sentry';

/**
 * Centralized error handling middleware.
 */
export const errorMiddleware = (
  err: Error | AppError | any,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  let statusCode = 500;
  let errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
  let message = 'Internal Server Error';
  let details = undefined;

  if (err instanceof AppError || err.isOperational) {
    statusCode = err.statusCode || 500;
    errorCode = err.code as ErrorCode;
    message = err.message;
    details = err.fields ?? err.details;
  } else if (err.name === 'ZodError') {
    statusCode = 422;
    errorCode = ErrorCode.VALIDATION_ERROR;
    message = 'Validation failed';
    details = err.errors;
  }

  // Log error — NEVER include req.body (may contain passwords/PII)
  if (statusCode >= 500) {
    Sentry.withScope((scope) => {
      scope.setTag("service", "backend");

      const anyReq = req as any;
      const tenantId = (req.headers['x-tenant-id'] as string) || anyReq.tenantId || anyReq.tenant?.id;
      const branchId = (req.headers['x-branch-id'] as string) || anyReq.branchId || anyReq.branch?.id;
      const requestId = (req.headers['x-request-id'] as string) || req.id;
      const qrSessionId = req.headers['x-qr-session-token'] as string;
      
      const user = anyReq.user || anyReq.staff || anyReq.auth;
      const userId = user?.id || user?.sub || user?.userId;
      const userRole = user?.role || user?.user_role;
      const staffId = user?.staff_id || (userRole ? userId : undefined);
      const staffName = user?.name || user?.username || user?.full_name;
      
      const orderId = anyReq.params?.orderId || anyReq.body?.orderId || anyReq.body?.order_id;
      const tableId = anyReq.params?.tableId || anyReq.body?.tableId || anyReq.body?.table_id;

      let authType = 'Unauthenticated';
      if (qrSessionId) authType = 'QR';
      else if (userRole === 'admin' || userRole === 'superadmin') authType = 'Admin';
      else if (staffId || userId) authType = 'Staff';

      if (tenantId) scope.setTag('tenant_id', tenantId);
      if (branchId) scope.setTag('branch_id', branchId);
      if (staffId) scope.setTag('staff_id', staffId);
      if (userRole) scope.setTag('user_role', userRole);
      if (requestId) scope.setTag('request_id', requestId);
      scope.setTag('route', req.route?.path || req.path);

      scope.setContext('Request', {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        user_agent: req.headers['user-agent'],
        request_id: requestId,
      });

      if (tenantId || branchId) {
        scope.setContext('Restaurant', { tenant_id: tenantId, branch_id: branchId });
      }

      if (userId || userRole) {
        scope.setContext('Authentication', { user_id: userId, role: userRole, auth_type: authType });
      }

      if (orderId || tableId || qrSessionId) {
        scope.setContext('Order', { order_id: orderId, table_id: tableId, qr_session_id: qrSessionId });
      }

      if (userId) {
        Sentry.setUser({ id: userId, username: staffName ?? undefined });
      }

      Sentry.captureException(err);
    });

    logger.error({ 
      err: { message: err.message, code: err.code, stack: err.stack },
      req: { method: req.method, url: req.url }
    }, 'Unhandled Exception');
    try {
      require('fs').appendFileSync(
        require('path').join(__dirname, '../../scratch/error.log'),
        `[${new Date().toISOString()}] ${req.method} ${req.url}\n${err.stack}\n\n`
      );
    } catch (e) {}
  } else {
    logger.warn({ 
      err: { message, errorCode, details }, 
      req: { method: req.method, url: req.url } 
    }, 'Operational Error');
  }

  const response = ResponseFormatter.error(
    errorCode,
    message,
    details,
    err.stack
  );

  res.status(statusCode).json(response);
};
