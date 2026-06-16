import { allocateSequenceNumber } from './src/modules/orders/sequence-allocator.service';

async function run() {
  const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';
  
  for (let i = 0; i < 35; i++) {
    const seq = await allocateSequenceNumber({
      tenantId,
      branchId,
      sequenceType: 'orders',
      prefix: 'ORD',
      dailyReset: true
    });
    console.log('Bumped to:', seq);
  }
}
run();
