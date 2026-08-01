import axios from 'axios';
import { RuntimeAuthService } from './src/modules/auth/services/runtime-auth.service';
import { ROLES } from './src/types/rbac.types';
import { v4 as uuidv4 } from 'uuid';

async function run() {
  const tenantId = '11111111-1111-1111-1111-111111111111'; // Dummy
  const branchId = '22222222-2222-2222-2222-222222222222';
  const tableId = '33333333-3333-3333-3333-333333333333';

  // Issue staff token
  const staffToken = RuntimeAuthService.issueRuntimeSession({
    userId: uuidv4(),
    role: ROLES.MANAGER,
    tenantId,
    branchId,
    permissions: [],
    deviceSessionId: uuidv4()
  });

  try {
    const res = await axios.post('http://localhost:3001/api/v1/cart/items', {
      mutation_id: 'test',
      mutation_sequence: 0,
      runtime_version: 1,
      session_id: uuidv4(),
      tenant_id: tenantId,
      branch_id: branchId,
      idempotency_key: 'test',
      expected_cart_revision: 0,
      payload: {
        menu_item_id: uuidv4(),
        quantity: 1,
        selected_modifiers: []
      }
    }, {
      headers: {
        'Authorization': `Bearer ${staffToken}`,
        'X-Tenant-Id': tenantId,
      }
    });
    console.log('Success!', res.data);
  } catch (err: any) {
    console.error('Error:', err.response?.status, err.response?.data);
  }
}
run();
