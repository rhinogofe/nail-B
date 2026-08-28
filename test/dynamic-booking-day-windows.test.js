const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildDynamicBookableSlots,
  shouldUseDynamicCustomDaySlots,
} = require('../src/utils/dynamicBookingSlots')

test('dynamic slots merge touching day windows and chain from actual booking end', () => {
  const dayWindows = [
    { start_hour: 13, start_minute: 0, end_hour: 14, end_minute: 0 },
    { start_hour: 14, start_minute: 0, end_hour: 15, end_minute: 0 },
    { start_hour: 15, start_minute: 0, end_hour: 16, end_minute: 0 },
    { start_hour: 16, start_minute: 0, end_hour: 17, end_minute: 0 },
  ]
  const bookings = [
    { id: 1, start_hour: 13, start_minute: 0, end_hour: 14, end_minute: 20, status: 'pending' },
  ]
  const slots = buildDynamicBookableSlots({
    slotHours: 1,
    bookings,
    blocks: [],
    dayWindows,
    openHour: 9,
    lastBookingHour: 18,
  })

  assert.ok(
    slots.some((s) => s.startM === 14 * 60 + 20 && s.endM === 15 * 60 + 20),
    'next slot should be 14:20–15:20'
  )
  assert.equal(
    slots.some((s) => s.startM === 15 * 60 && s.endM === 16 * 60),
    false,
    'should not jump back to the next hour wall at 15:00'
  )
})

test('dynamic slots chain again after a second extended booking', () => {
  const dayWindows = [
    { start_hour: 13, start_minute: 0, end_hour: 14, end_minute: 0 },
    { start_hour: 14, start_minute: 0, end_hour: 15, end_minute: 0 },
    { start_hour: 15, start_minute: 0, end_hour: 16, end_minute: 0 },
    { start_hour: 16, start_minute: 0, end_hour: 17, end_minute: 0 },
  ]
  const slots = buildDynamicBookableSlots({
    slotHours: 1,
    bookings: [
      { id: 1, start_hour: 13, start_minute: 0, end_hour: 14, end_minute: 20, status: 'pending' },
      { id: 2, start_hour: 14, start_minute: 20, end_hour: 15, end_minute: 38, status: 'pending' },
    ],
    blocks: [],
    dayWindows,
    openHour: 9,
    lastBookingHour: 18,
  })

  assert.ok(
    slots.some((s) => s.startM === 15 * 60 + 38 && s.endM === 16 * 60 + 38),
    'next slot should be 15:38–16:38'
  )
})

test('dynamic slots do not fill gaps between separate day windows', () => {
  const dayWindows = [
    { start_hour: 10, start_minute: 0, end_hour: 12, end_minute: 0 },
    { start_hour: 14, start_minute: 0, end_hour: 16, end_minute: 0 },
  ]
  const slots = buildDynamicBookableSlots({
    slotHours: 2,
    bookings: [],
    blocks: [],
    dayWindows,
    openHour: 9,
    lastBookingHour: 18,
  })

  assert.ok(slots.some((s) => s.startM === 10 * 60))
  assert.ok(slots.some((s) => s.startM === 14 * 60))
  assert.equal(
    slots.some((s) => s.startM >= 12 * 60 && s.startM < 14 * 60),
    false,
    'should not offer slots in the lunch gap'
  )
})

test('shouldUseDynamicCustomDaySlots requires active bookings when extend is on', () => {
  const dayWindows = [{ start_hour: 10, start_minute: 0, end_hour: 20, end_minute: 0 }]

  assert.equal(
    shouldUseDynamicCustomDaySlots({ dayWindows, extendByServices: true, bookings: [] }),
    false
  )
  assert.equal(
    shouldUseDynamicCustomDaySlots({
      dayWindows,
      extendByServices: true,
      bookings: [{ id: 1, status: 'pending' }],
    }),
    true
  )
  assert.equal(
    shouldUseDynamicCustomDaySlots({
      dayWindows,
      extendByServices: true,
      bookings: [{ id: 1, status: 'cancelled' }],
    }),
    false
  )
})
