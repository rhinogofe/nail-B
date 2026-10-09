import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVisibleBookingSlots,
  canBookVisibleSlot,
} from '../../Frontend/src/utils/bookingSlots.js'

const STAFF_A = 'staff-a'
const STAFF_B = 'staff-b'

function starts(slots) {
  return slots
    .filter((slot) => slot.status !== 'booked')
    .map((slot) => slot.startHour)
}

function visibleFor(staffId, { dayWindows, bookings, extendByServices }) {
  const ownBookings = bookings.filter((row) => row.staff_id === staffId)
  const params = {
    openHour: 9,
    lastBookingHour: 18,
    slotHours: 2,
    extras: [],
    blocks: [],
    dayWindows,
    bookings: ownBookings,
    extendByServices,
  }
  return buildVisibleBookingSlots(params).filter((slot) => canBookVisibleSlot(slot, params))
}

test('หน้าจอง: คนละช่วงเวลา เห็นคนละรายการ และคิวช่างเอไม่ทำให้ช่วงช่างบีหาย', () => {
  const hours = {
    [STAFF_A]: [{ start_hour: 10, start_minute: 0, end_hour: 12, end_minute: 0 }],
    [STAFF_B]: [{ start_hour: 14, start_minute: 0, end_hour: 18, end_minute: 0 }],
  }
  const bookings = [
    {
      id: 1,
      staff_id: STAFF_A,
      status: 'pending',
      start_hour: 10,
      start_minute: 0,
      end_hour: 12,
      end_minute: 0,
    },
  ]

  const a = visibleFor(STAFF_A, {
    dayWindows: hours[STAFF_A],
    bookings,
    extendByServices: false,
  })
  const b = visibleFor(STAFF_B, {
    dayWindows: hours[STAFF_B],
    bookings,
    extendByServices: false,
  })

  assert.deepEqual(starts(a), [])
  assert.deepEqual(starts(b), [14])
})

test('หน้าจองโหมดขยาย: ช่างที่ไม่มีคิวเริ่มตามช่วงตัวเอง ช่างที่มีคิวเลื่อนเฉพาะของตัวเอง', () => {
  const hours = {
    [STAFF_A]: [{ start_hour: 10, start_minute: 0, end_hour: 16, end_minute: 0 }],
    [STAFF_B]: [{ start_hour: 10, start_minute: 0, end_hour: 18, end_minute: 0 }],
  }
  const bookings = [
    {
      id: 7,
      staff_id: STAFF_A,
      status: 'pending',
      start_hour: 10,
      start_minute: 0,
      end_hour: 12,
      end_minute: 0,
    },
  ]

  const a = visibleFor(STAFF_A, {
    dayWindows: hours[STAFF_A],
    bookings,
    extendByServices: true,
  })
  const b = visibleFor(STAFF_B, {
    dayWindows: hours[STAFF_B],
    bookings,
    extendByServices: true,
  })

  assert.ok(starts(a).includes(12))
  assert.equal(starts(a).includes(10), false)
  assert.deepEqual(starts(b), [10])
  assert.equal(starts(a).includes(16), false)
})
