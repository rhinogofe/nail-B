const test = require('node:test')
const assert = require('node:assert/strict')

test('demoteOrphanShopAdmins is exported', () => {
  const { demoteOrphanShopAdmins } = require('../src/utils/shopAdmins')
  assert.equal(typeof demoteOrphanShopAdmins, 'function')
})

test('demoteOrphanShopAdmins returns empty array for empty user list', async () => {
  const { demoteOrphanShopAdmins } = require('../src/utils/shopAdmins')
  const result = await demoteOrphanShopAdmins({ query: async () => ({ rows: [] }) }, [])
  assert.deepEqual(result, [])
})
