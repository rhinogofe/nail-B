const test = require('node:test')
const assert = require('node:assert/strict')
const { buildDynamicBookableSlots } = require('../src/utils/dynamicBookingSlots')
const {
  normalizeBookingMinGapMinutes,
  DEFAULT_MIN_GAP_MINUTES,
} = require('../src/utils/bookingMinGapSettings')

test('normalizeBookingMinGapMinutes clamps 15-120', () => {
  assert.equal(normalizeBookingMinGapMinutes(30), 30)
  assert.equal(normalizeBookingMinGapMinutes(10), 15)
  assert.equal(normalizeBookingMinGapMinutes(999), 120)
})

test('min gap 30 opens 45-minute tail slot', () => {
  const bookings = [
    { id: 1, start_hour: 9, start_minute: 0, end_hour: 10, end_minute: 15, status: 'pending' },
    { id: 2, start_hour: 11, start_minute: 0, end_hour: 13, end_minute: 0, status: 'pending' },
  ]
  const available = buildDynamicBookableSlots({
    slotHours: 2,
    bookings,
    blocks: [],
    dayWindows: [{ start_hour: 9, start_minute: 0, end_hour: 18, end_minute: 0 }],
    openHour: 9,
    lastBookingHour: 18,
    minGapMinutes: 30,
  })
  const tail = available.find((s) => s.startHour === 10 && s.startMinute === 15)
  assert.ok(tail, 'should offer 10:15–11:00')
  assert.equal(tail.endHour, 11)
  assert.equal(tail.endMinute, 0)
})

test('min gap 60 skips 45-minute tail slot', () => {
  const bookings = [
    { id: 1, start_hour: 9, start_minute: 0, end_hour: 10, end_minute: 15, status: 'pending' },
    { id: 2, start_hour: 11, start_minute: 0, end_hour: 13, end_minute: 0, status: 'pending' },
  ]
  const available = buildDynamicBookableSlots({
    slotHours: 2,
    bookings,
    blocks: [],
    dayWindows: [{ start_hour: 9, start_minute: 0, end_hour: 18, end_minute: 0 }],
    openHour: 9,
    lastBookingHour: 18,
    minGapMinutes: DEFAULT_MIN_GAP_MINUTES,
  })
  assert.equal(available.some((s) => s.startHour === 10 && s.startMinute === 15), false)
})
