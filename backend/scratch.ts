import { RuntimeAuthService } from './src/modules/auth/services/runtime-auth.service';
import { ROLES } from './src/types/rbac.types';

const token = RuntimeAuthService.issueRuntimeSession({
  userId: '11111111-1111-1111-1111-111111111111',
  role: ROLES.MANAGER,
  tenantId: '22222222-2222-2222-2222-222222222222',
  branchId: '33333333-3333-3333-3333-333333333333',
  permissions: [],
  deviceSessionId: '44444444-4444-4444-4444-444444444444'
});
console.log(token);
