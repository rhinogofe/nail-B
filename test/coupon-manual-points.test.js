const test = require('node:test')
const assert = require('node:assert/strict')
const { getCouponSettings } = require('../src/utils/couponSettings')

function mockPool(settingsRows) {
  const map = Object.fromEntries(settingsRows)
  return {
    query: async (sql, params) => {
      if (!sql.includes('shop_settings')) {
        throw new Error(`unexpected query: ${sql.slice(0, 80)}`)
      }
      const keys = Array.isArray(params?.[1]) ? params[1] : [params?.[1]]
      const rows = keys
        .filter((key) => map[key] != null)
        .map((key) => ({ setting_key: key, setting_value: map[key] }))
      return { rows }
    },
  }
}

test('getCouponSettings defaults manual completion points to false', async () => {
  const pool = mockPool([
    ['coupon_discount_percent', '20'],
    ['coupon_required_points', '100'],
    ['coupon_completion_points', '10'],
    ['coupon_manual_completion_points', null],
  ])
  const settings = await getCouponSettings(pool, 'shop-1')
  assert.equal(settings.manualCompletionPoints, false)
  assert.equal(settings.completionPoints, 10)
})

test('getCouponSettings reads manual completion points flag', async () => {
  const pool = mockPool([
    ['coupon_discount_percent', '20'],
    ['coupon_required_points', '100'],
    ['coupon_completion_points', '10'],
    ['coupon_manual_completion_points', 'true'],
  ])
  const settings = await getCouponSettings(pool, 'shop-1')
  assert.equal(settings.manualCompletionPoints, true)
})
