import { CustomerRepository } from './customer.repository';
import { AppError } from '../../shared/errors/AppError';
import { supabaseAdmin } from '../../config/supabase';
import { parsePhoneNumber } from 'libphonenumber-js';

export class CustomerService {
  static async getGuestOrderConfirmation(orderId: string, tenantId: string, tableId: string) {
    if (!orderId || !tenantId || !tableId) {
      throw new AppError('Missing required parameters for order lookup', 400, 'BAD_REQUEST');
    }

    const order = await CustomerRepository.getGuestOrder(orderId, tenantId, tableId);

    if (!order) {
      throw new AppError('Order could not be located or is no longer available.', 404, 'ORDER_NOT_FOUND');
    }

    return order;
  }

  static async identifyCustomer(payload: { tenant_id: string; phone_number: string; name?: string; email?: string }) {
    if (!payload.tenant_id || !payload.phone_number) {
      throw new AppError('Missing required fields: tenant_id and phone_number', 400, 'BAD_REQUEST');
    }

    // Normalization
    let normalizedPhone: string;
    try {
      // Default to IN as many Indian numbers are common, but libphonenumber handles + prefixes automatically
      const phoneObj = parsePhoneNumber(payload.phone_number, 'IN');
      if (!phoneObj.isValid()) {
        throw new Error('Invalid phone number');
      }
      normalizedPhone = phoneObj.format('E.164');
    } catch {
      throw new AppError('Invalid phone number format', 400, 'INVALID_PHONE');
    }

    // Atomic Upsert
    const { data, error } = await supabaseAdmin
      .from('customers')
      .upsert(
        {
          tenant_id: payload.tenant_id,
          phone_number: normalizedPhone,
          name: payload.name || null,
          email: payload.email || null,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'tenant_id,phone_number', ignoreDuplicates: false }
      )
      .select('*')
      .single();

    if (error) {
      console.log('SUPABASE ERROR:', error);
      if (error.code === '23503' && error.message.includes('customers_tenant_id_fkey')) {
        throw new AppError('Invalid tenant ID', 400, 'INVALID_TENANT');
      }
      throw new AppError(`Failed to identify customer: ${error.message}`, 500, 'INTERNAL_SERVER_ERROR');
    }

    return data;
  }
}
