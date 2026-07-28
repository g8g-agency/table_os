/* eslint-disable */
// ============================================================
// src/modules/kitchen/kitchen.controller.ts
// Controller for KDS kitchen station operations.
// ============================================================

import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import * as kitchenService from './kitchen.service';
import type { KitchenOrderStatus } from './kitchen.repository';

// New service imports
import { OrderItemWorkflowService } from './order-item-workflow.service';
import { OperationalReadModelService } from './operational-read-model.service';
import { RealtimeReconciliationService } from './realtime-reconciliation.service';
import { KitchenSLAService } from './kitchen-sla.service';
import { KitchenQueueProjectionService } from './kitchen-queue-projection.service';

const routeOrderSchema = z.object({
  orderId: z.string().uuid(),
});

const transitionStatusSchema = z.object({
  targetStatus: z.enum(['pending', 'accepted', 'preparing', 'ready', 'delivered', 'completed']),
  versionNum: z.number().int().positive(),
});

const listQueueQuerySchema = z.object({
  branchId: z.string().uuid(),
  status: z.enum(['pending', 'accepted', 'preparing', 'ready', 'delivered', 'completed']).optional(),
  stationId: z.string().uuid().nullable().optional().or(z.literal('')),
});

export async function routeToKitchen(req: any, res: Response, next: any): Promise<void> {
  try {
    const parsed = routeOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Validation failed', 400, ErrorCode.VALIDATION_ERROR, true, parsed.error.format());
    }

    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      throw new AppError('Missing tenant context.', 400, ErrorCode.BAD_REQUEST);
    }

    const ticket = await kitchenService.routeOrderToKitchen(tenantId, parsed.data.orderId);

    res.status(201).json({
      status: 'success',
      data: { ticket },
    });
  } catch (err) {
    next(err);
  }
}

export async function transitionTicketStatus(req: any, res: Response, next: any): Promise<void> {
  try {
    const { id } = req.params;
    const parsed = transitionStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Validation failed', 400, ErrorCode.VALIDATION_ERROR, true, parsed.error.format());
    }

    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      throw new AppError('Missing tenant context.', 400, ErrorCode.BAD_REQUEST);
    }

    const ticket = await kitchenService.transitionKitchenOrderStatus({
      tenantId,
      ticketId: id,
      targetStatus: parsed.data.targetStatus as KitchenOrderStatus,
      versionNum: parsed.data.versionNum,
      userId: req.context?.id,
    });

    res.status(200).json({
      status: 'success',
      data: { ticket },
    });
  } catch (err) {
    next(err);
  }
}

export async function getTicketDetails(req: any, res: Response, next: any): Promise<void> {
  try {
    const { id } = req.params;
    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      throw new AppError('Missing tenant context.', 400, ErrorCode.BAD_REQUEST);
    }

    const ticket = await kitchenService.getKitchenOrderTicket(tenantId, id);

    res.status(200).json({
      status: 'success',
      data: { ticket },
    });
  } catch (err) {
    next(err);
  }
}

export async function listKitchenQueue(req: any, res: Response, next: any): Promise<void> {
  try {
    const parsed = listQueueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('Validation failed', 400, ErrorCode.VALIDATION_ERROR, true, parsed.error.format());
    }

    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      throw new AppError('Missing tenant context.', 400, ErrorCode.BAD_REQUEST);
    }

    const { branchId, status, stationId } = parsed.data;

    const queue = await kitchenService.getKitchenQueue(tenantId, branchId, {
      status: status as KitchenOrderStatus,
      stationId: stationId || undefined,
    });

    res.status(200).json({
      status: 'success',
      data: { queue },
    });
  } catch (err) {
    next(err);
  }
}

// ─── NEW KDS RUNTIME HANDLERS ─────────────────────────────────

export async function transitionKdsItemStatus(req: any, res: Response, next: any): Promise<void> {
  try {
    const { preparationId } = req.params;
    const transitionSchema = z.object({
      branchId: z.string().uuid(),
      targetStatus: z.enum(['pending', 'preparing', 'completed', 'cancelled']),
      completedQuantity: z.number().int().nonnegative().optional(),
      versionNum: z.number().int().positive(),
    });

    const parsed = transitionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Validation failed', 400, ErrorCode.VALIDATION_ERROR, true, parsed.error.format());
    }

    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      throw new AppError('Missing tenant context.', 400, ErrorCode.BAD_REQUEST);
    }

    const result = await OrderItemWorkflowService.transitionItemStatus({
      tenantId,
      branchId: parsed.data.branchId,
      preparationId,
      targetStatus: parsed.data.targetStatus,
      completedQuantity: parsed.data.completedQuantity,
      versionNum: parsed.data.versionNum,
      userId: req.context?.id,
    });

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function getFloorState(req: any, res: Response, next: any): Promise<void> {
  try {
    const schema = z.object({
      branchId: z.string().uuid(),
    });

    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('Validation failed', 400, ErrorCode.VALIDATION_ERROR, true, parsed.error.format());
    }

    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      throw new AppError('Missing tenant context.', 400, ErrorCode.BAD_REQUEST);
    }

    const floor = await OperationalReadModelService.getFloorStateProjection(tenantId, parsed.data.branchId);

    res.status(200).json({
      status: 'success',
      data: { floor },
    });
  } catch (err) {
    next(err);
  }
}

export async function getWaiterDashboard(req: any, res: Response, next: any): Promise<void> {
  try {
    const schema = z.object({
      branchId: z.string().uuid(),
    });

    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('Validation failed', 400, ErrorCode.VALIDATION_ERROR, true, parsed.error.format());
    }

    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      throw new AppError('Missing tenant context.', 400, ErrorCode.BAD_REQUEST);
    }

    const waiterDashboard = await OperationalReadModelService.getWaiterDashboardProjection(tenantId, parsed.data.branchId);

    res.status(200).json({
      status: 'success',
      data: { waiterDashboard },
    });
  } catch (err) {
    next(err);
  }
}

export async function getCustomerTracking(req: any, res: Response, next: any): Promise<void> {
  try {
    const { orderId } = req.params;

    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      throw new AppError('Missing tenant context.', 400, ErrorCode.BAD_REQUEST);
    }

    const tracking = await OperationalReadModelService.getCustomerTrackingProjection(tenantId, orderId);

    res.status(200).json({
      status: 'success',
      data: { tracking },
    });
  } catch (err) {
    next(err);
  }
}

export async function reconcileRealtimeState(req: any, res: Response, next: any): Promise<void> {
  try {
    const schema = z.object({
      branchId: z.string().uuid(),
      lastSequenceNumber: z.number().int().nonnegative(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Validation failed', 400, ErrorCode.VALIDATION_ERROR, true, parsed.error.format());
    }

    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      throw new AppError('Missing tenant context.', 400, ErrorCode.BAD_REQUEST);
    }

    const syncState = await RealtimeReconciliationService.reconcileClientState({
      tenantId,
      branchId: parsed.data.branchId,
      lastKnownSequence: parsed.data.lastSequenceNumber,
    });

    res.status(200).json({
      status: 'success',
      data: { syncState },
    });
  } catch (err) {
    next(err);
  }
}

export async function evaluateQueueSLA(req: any, res: Response, next: any): Promise<void> {
  try {
    const schema = z.object({
      branchId: z.string().uuid(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Validation failed', 400, ErrorCode.VALIDATION_ERROR, true, parsed.error.format());
    }

    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      throw new AppError('Missing tenant context.', 400, ErrorCode.BAD_REQUEST);
    }

    const slaResults = await KitchenSLAService.evaluateActiveQueueSLA(tenantId, parsed.data.branchId);

    res.status(200).json({
      status: 'success',
      data: { slaResults },
    });
  } catch (err) {
    next(err);
  }
}

export async function getOperationalMetrics(req: any, res: Response, next: any): Promise<void> {
  try {
    const schema = z.object({
      branchId: z.string().uuid(),
    });

    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('Validation failed', 400, ErrorCode.VALIDATION_ERROR, true, parsed.error.format());
    }

    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenant_id;
    if (!tenantId) {
      throw new AppError('Missing tenant context.', 400, ErrorCode.BAD_REQUEST);
    }

    const metrics = await KitchenQueueProjectionService.aggregateOperationalMetrics(tenantId, parsed.data.branchId);

    const formattedMetrics = {
      totalOrdersToday: metrics?.totalTicketsToday || 0,
      averagePrepTimeSeconds: metrics?.averageTurnaroundSeconds || 0,
      delayedOrdersCount: metrics?.overdueTickets || 0,
      activeTicketsCount: metrics?.activeTickets || 0,
      slaComplianceRate: metrics?.slaComplianceRate || 95,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json({
      status: 'success',
      data: formattedMetrics,
    });
  } catch (err) {
    next(err);
  }
}
