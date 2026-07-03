import { submitMutation } from '../../../lib/apiClient.js';
import { useKdsIdentityStore } from '../../../store/kdsIdentityStore.js';
import { runtime } from '../../../runtime/index.ts';
import { useKitchenOrdersProjection } from '../../../store/projections/kitchenOrdersProjection.js';
import { useRuntimeIdentityStore } from '../../../store/runtimeIdentityStore.js';

// State machine validation
const VALID_TRANSITIONS = {
  'NEW': ['PREPARING', 'REJECTED'],
  'PENDING': ['PREPARING', 'REJECTED', 'ACCEPTED'],
  'ACCEPTED': ['PREPARING', 'READY'],
  'PREPARING': ['READY'],
  'READY': ['EXPO_COMPLETE'],
  'EXPO_COMPLETE': ['SERVED'],
  // No transition from SERVED, CLOSED, etc.
};

function isValidTransition(currentStatus, targetStatus) {
  const allowed = VALID_TRANSITIONS[currentStatus];
  return allowed ? allowed.includes(targetStatus) : false;
}

export function useKitchenMutations() {
  // The kitchen projection uses ticketId/orderId, not order.id
  const resolveId = (order) => order.ticketId || order.orderId || order.id || '';

  const triggerProjectionRebuild = () => {
    const { branchId } = useRuntimeIdentityStore.getState();
    const { stationId } = useKdsIdentityStore.getState();
    useKitchenOrdersProjection.getState().rebuild(branchId, stationId);
    runtime.projection.handleInvalidation('orders').catch(() => {});
  };

  return {
    markPreparing: async (order) => {
      if (!isValidTransition(order.status?.toUpperCase(), 'PREPARING') && !order.isNew) {
        console.warn(`[KDS] Invalid transition from ${order.status} to PREPARING`);
      }
      
      const { runtimeSessionId, kitchenDeviceId } = useKdsIdentityStore.getState();
      const id = resolveId(order);
      
      console.log('[KDS] markPreparing called with:', {
        orderId: id,
        orderStatus: order.status,
        runtimeSessionId,
        kitchenDeviceId
      });
      
      const ts = Date.now();
      const result = await submitMutation('/api/v1/mutations', {
        mutation_id: `KITCHEN_MARK_PREPARING_${id}_${ts}`,
        idempotency_key: `KITCHEN_MARK_PREPARING_${id}_${ts}`,
        payload: {
          type: 'KITCHEN_MARK_PREPARING',
          orderId: id,
          runtimeSessionId,
          kitchenDeviceId
        }
      });
      triggerProjectionRebuild();
      return result;
    },
    
    markReady: async (order) => {
      if (!isValidTransition(order.status?.toUpperCase(), 'READY')) {
        console.warn(`[KDS] Invalid transition from ${order.status} to READY`);
      }
      
      const { runtimeSessionId, kitchenDeviceId } = useKdsIdentityStore.getState();
      const id = resolveId(order);
      
      const ts = Date.now();
      const result = await submitMutation('/api/v1/mutations', {
        mutation_id: `KITCHEN_MARK_READY_${id}_${ts}`,
        idempotency_key: `KITCHEN_MARK_READY_${id}_${ts}`,
        payload: {
          type: 'KITCHEN_MARK_READY',
          orderId: id,
          runtimeSessionId,
          kitchenDeviceId
        }
      });
      triggerProjectionRebuild();
      return result;
    },
    
    bumpOrder: async (order) => {
      const { runtimeSessionId, kitchenDeviceId, stationId } = useKdsIdentityStore.getState();
      const id = resolveId(order);
      
      const ts = Date.now();
      const result = await submitMutation('/api/v1/mutations', {
        mutation_id: `KITCHEN_BUMP_TICKET_${id}_${stationId}_${ts}`,
        idempotency_key: `KITCHEN_BUMP_TICKET_${id}_${stationId}_${ts}`,
        payload: {
          type: 'KITCHEN_BUMP_TICKET',
          orderId: id,
          stationId,
          runtimeSessionId,
          kitchenDeviceId
        }
      });
      triggerProjectionRebuild();
      return result;
    },

    recallTicket: async (order) => {
      const { runtimeSessionId, kitchenDeviceId } = useKdsIdentityStore.getState();
      const id = resolveId(order);
      
      const result = await submitMutation('/api/v1/mutations', {
        mutation_id: `KITCHEN_RECALL_TICKET_${id}_${Date.now()}`,
        idempotency_key: `KITCHEN_RECALL_TICKET_${id}`,
        payload: {
          type: 'KITCHEN_RECALL_TICKET',
          orderId: id,
          runtimeSessionId,
          kitchenDeviceId
        }
      });
      triggerProjectionRebuild();
      return result;
    },
  };
}

