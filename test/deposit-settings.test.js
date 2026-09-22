const test = require('node:test')
const assert = require('node:assert/strict')
const {
  getDepositSettings,
  resolveBookingPaymentAmount,
} = require('../src/utils/depositSettings')

function mockPool(settingsRows, sumPrice = 0) {
  const map = Object.fromEntries(settingsRows)
  return {
    query: async (sql, params) => {
      if (sql.includes('shop_settings')) {
        const keys = Array.isArray(params?.[1]) ? params[1] : [params?.[1]]
        const rows = keys
          .filter((key) => map[key] != null)
          .map((key) => ({ setting_key: key, setting_value: map[key] }))
        return { rows }
      }
      if (sql.includes('SUM(n.price)')) {
        return { rows: [{ total: sumPrice }] }
      }
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`)
    },
  }
}

test('resolveBookingPaymentAmount uses deposit when full payment is off', async () => {
  const pool = mockPool([
    ['deposit_amount', '300'],
    ['deposit_full_payment_enabled', 'false'],
  ])
  const result = await resolveBookingPaymentAmount(pool, 'shop-1', 'booking-1')
  assert.equal(result.fullPaymentEnabled, false)
  assert.equal(result.paymentAmount, 300)
})

test('resolveBookingPaymentAmount sums service prices when full payment is on', async () => {
  const pool = mockPool(
    [
      ['deposit_amount', '300'],
      ['deposit_full_payment_enabled', 'true'],
    ],
    1250
  )
  const result = await resolveBookingPaymentAmount(pool, 'shop-1', 'booking-1')
  assert.equal(result.fullPaymentEnabled, true)
  assert.equal(result.paymentAmount, 1250)
  assert.equal(result.serviceTotal, 1250)
})

test('resolveBookingPaymentAmount falls back to deposit when service total is zero', async () => {
  const pool = mockPool(
    [
      ['deposit_amount', '300'],
      ['deposit_full_payment_enabled', 'true'],
    ],
    0
  )
  const result = await resolveBookingPaymentAmount(pool, 'shop-1', 'booking-1')
  assert.equal(result.paymentAmount, 300)
})

test('getDepositSettings parses full payment flag', async () => {
  const pool = mockPool([
    ['deposit_amount', '250'],
    ['deposit_full_payment_enabled', 'true'],
  ])
  const settings = await getDepositSettings(pool, 'shop-1')
  assert.equal(settings.depositAmount, 250)
  assert.equal(settings.fullPaymentEnabled, true)
})
