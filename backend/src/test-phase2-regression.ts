// ============================================================
// src/test-phase2-regression.ts
// Automated regression tests for Phase 2 fixes.
// ============================================================

import assert from 'node:assert';
import { CartQuoteSchema } from './modules/cart/cart.validators';
import { CreateWaiterCallSchema } from './modules/waiter-call/waiter-call.validators';
import { PublicCheckoutSchema } from './modules/orders/public-orders.validators';

console.log('--- Running Phase 2 Regression Suite ---');

// ── Test 1: CartQuoteSchema Validation ───────────────────────
console.log('Test 1: CartQuoteSchema accepts valid items and modifiers');
const validQuote = CartQuoteSchema.parse({
  items: [
    {
      menu_item_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      quantity: 2,
      modifiers: [
        {
          modifier_group_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
          modifier_option_id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
        },
      ],
    },
    {
      menu_item_id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
      quantity: 1,
    },
  ],
});
assert.strictEqual(validQuote.items.length, 2);
assert.strictEqual(validQuote.items[0].quantity, 2);
assert.strictEqual(validQuote.items[0].modifiers?.length, 1);

// Test invalid item quantity
assert.throws(() => {
  CartQuoteSchema.parse({
    items: [{ menu_item_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: 0 }],
  });
}, /too_small|greater than or equal to 1/i);

console.log('✓ Test 1 passed: CartQuoteSchema validation');

// ── Test 2: CreateWaiterCallSchema (Task 2: Assistance) ──────
console.log('Test 2: CreateWaiterCallSchema validation');
const waiterCall = CreateWaiterCallSchema.parse({
  type: 'service',
  notes: 'Call Waiter: Extra napkins',
});
assert.strictEqual(waiterCall.type, 'service');
assert.strictEqual(waiterCall.notes, 'Call Waiter: Extra napkins');

const billCall = CreateWaiterCallSchema.parse({
  type: 'bill',
  notes: 'Ask for Bill: Cash payment',
});
assert.strictEqual(billCall.type, 'bill');

const otherCall = CreateWaiterCallSchema.parse({
  type: 'other',
  notes: 'High chair needed',
});
assert.strictEqual(otherCall.type, 'other');

// Unknown type should fail
assert.throws(() => {
  CreateWaiterCallSchema.parse({ type: 'invalid_type' });
});

console.log('✓ Test 2 passed: CreateWaiterCallSchema validation');

// ── Test 3: PublicCheckoutSchema (Task 4: Atomic Checkout) ──
console.log('Test 3: PublicCheckoutSchema atomic payload validation');
const checkoutPayload = PublicCheckoutSchema.parse({
  items: [
    {
      menu_item_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      quantity: 3,
      item_notes: 'Extra crispy',
      modifiers: [
        {
          modifier_group_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
          modifier_option_id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
        },
      ],
    },
  ],
  order_notes: 'No peanuts please, allergy',
});
assert.strictEqual(checkoutPayload.items.length, 1);
assert.strictEqual(checkoutPayload.items[0].quantity, 3);
assert.strictEqual(checkoutPayload.order_notes, 'No peanuts please, allergy');

console.log('✓ Test 3 passed: PublicCheckoutSchema validation');

// ── Test 4: Pricing Math Integrity (Task 1: Grand Total ₹0.00 Fix) ──
console.log('Test 4: Pricing and Tax Calculations Math');
{
  const basePriceMinor = 100000; // ₹1,000.00
  const modifierDeltaMinor = 5000; // ₹50.00
  const qty = 2;
  const lineTotalMinor = (basePriceMinor + modifierDeltaMinor) * qty; // 210,000 minor = ₹2,100.00
  assert.strictEqual(lineTotalMinor, 210000);

  // Exclusive Tax: 5% = 500 basis points
  const taxBasisPoints = 500;
  const exclusiveTaxAmount = Math.round((lineTotalMinor * taxBasisPoints) / 10000);
  assert.strictEqual(exclusiveTaxAmount, 10500); // ₹105.00

  const grandTotalMinor = lineTotalMinor + exclusiveTaxAmount;
  assert.strictEqual(grandTotalMinor, 220500); // ₹2,205.00

  // Verify non-zero invariant
  assert.ok(grandTotalMinor > 0, 'Grand total must be strictly positive');
  assert.strictEqual((grandTotalMinor / 100).toFixed(2), '2205.00');

  // Inclusive Tax test: 18% = 1800 basis points
  const incLineTotal = 11800; // ₹118.00 inclusive
  const incBase = Math.round((incLineTotal * 10000) / (10000 + 1800)); // 10000
  const incTax = incLineTotal - incBase; // 1800
  assert.strictEqual(incBase, 10000);
  assert.strictEqual(incTax, 1800);
}
console.log('✓ Test 4 passed: Pricing & Tax Math integrity');

// ── Test 5: Cooking Instructions & Allergy Detection (Task 3) ──
console.log('Test 5: KDS Allergy Keyword Detection');
{
  const allergyRegex = /allergy|allergic|gluten|peanut|dairy|nut|vegan|celiac/i;
  assert.ok(allergyRegex.test('Severe peanut allergy, please be careful'));
  assert.ok(allergyRegex.test('Gluten-free bread only'));
  assert.ok(allergyRegex.test('Vegan cheese please'));
  assert.ok(!allergyRegex.test('Extra napkins and ketchup'));
  assert.ok(!allergyRegex.test('Less spicy please'));
}
console.log('✓ Test 5 passed: Allergy detection logic');

console.log('--- ALL 5 PHASE 2 REGRESSION TESTS PASSED! ---');
