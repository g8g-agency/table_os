import { CreateMenuItemSchema, UpdateMenuItemSchema } from './src/modules/menu/menu.validators';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ PASSED: ${message}`);
}

async function runTests() {
  console.log('Testing Menu Item Recommendation Metadata Schemas & Normalization...');

  // Test 1: Defaults
  const validMinimalInput = {
    category_id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Tandoori Roti',
    slug: 'tandoori-roti',
    base_price: 45.0,
  };

  const parsed1 = CreateMenuItemSchema.parse(validMinimalInput);
  assert(parsed1.recommendation_enabled === true, 'Default recommendation_enabled is true');
  assert(Array.isArray(parsed1.recommendation_tags) && parsed1.recommendation_tags.length === 0, 'Default recommendation_tags is empty array');

  // Test 2: Normalization (lowercase, trim, dedup, remove empty)
  const inputWithTags = {
    ...validMinimalInput,
    recommendation_enabled: false,
    recommendation_tags: ['  Paneer ', 'Tandoori', 'paneer', '  ', 'CLAY-OVEN'],
  };

  const parsed2 = CreateMenuItemSchema.parse(inputWithTags);
  assert(parsed2.recommendation_enabled === false, 'recommendation_enabled can be explicitly false');
  assert(parsed2.recommendation_tags.length === 3, 'Tags are deduplicated and trimmed');
  assert(parsed2.recommendation_tags[0] === 'paneer', 'Tags are lowercased');
  assert(parsed2.recommendation_tags[1] === 'tandoori', 'Tags are lowercased');
  assert(parsed2.recommendation_tags[2] === 'clay-oven', 'Tags are lowercased');

  // Test 3: Update schema
  const updateInput = {
    version_num: 2,
    recommendation_enabled: true,
    recommendation_tags: ['  BREAD ', 'bread', 'NAAN '],
  };

  const parsedUpdate = UpdateMenuItemSchema.parse(updateInput);
  assert(parsedUpdate.recommendation_enabled === true, 'Update recommendation_enabled parsed');
  assert(parsedUpdate.recommendation_tags !== undefined && parsedUpdate.recommendation_tags.length === 2, 'Update tags normalized and deduplicated');
  assert(parsedUpdate.recommendation_tags![0] === 'bread', 'Update tag 1 normalized');
  assert(parsedUpdate.recommendation_tags![1] === 'naan', 'Update tag 2 normalized');

  console.log('\nAll Menu Item Recommendation Metadata tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  throw err;
});
