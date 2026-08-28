const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeOptionIds } = require('../src/utils/bookingOptions')
const { emitBookingChanged, emitShopLive, subscribeBookingEvents } = require('../src/utils/bookingEvents')

test('normalizeOptionIds deduplicates and stringifies', () => {
  assert.deepEqual(normalizeOptionIds(['1', '2', '1', '']), ['1', '2'])
  assert.deepEqual(normalizeOptionIds(null), [])
})

test('booking events emit and subscribe', () => {
  const shopId = `test-shop-${Date.now()}`
  const events = []
  const unsubscribe = subscribeBookingEvents(shopId, (payload) => {
    events.push(payload)
  })
  emitBookingChanged(shopId, {
    type: 'payment_confirmed',
    booking_id: 42,
    booking_date: '2026-05-01',
  })
  unsubscribe()
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'payment_confirmed')
  assert.equal(events[0].booking_id, 42)
})

test('shop live events isolate shops and include schedule/options types', () => {
  const shopA = `test-shop-a-${Date.now()}`
  const shopB = `test-shop-b-${Date.now()}`
  const eventsA = []
  const eventsB = []
  const offA = subscribeBookingEvents(shopA, (payload) => eventsA.push(payload))
  const offB = subscribeBookingEvents(shopB, (payload) => eventsB.push(payload))

  emitShopLive(shopA, 'schedule', { booking_date: '2026-08-28' })
  emitShopLive(shopA, 'options')
  emitShopLive(shopB, 'settings')

  offA()
  offB()

  assert.equal(eventsA.length, 2)
  assert.equal(eventsA[0].type, 'schedule')
  assert.equal(eventsA[0].booking_date, '2026-08-28')
  assert.equal(eventsA[1].type, 'options')
  assert.equal(eventsB.length, 1)
  assert.equal(eventsB[0].type, 'settings')
})
