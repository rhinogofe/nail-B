const test = require('node:test')
const assert = require('node:assert/strict')
const { validateBookingSlot } = require('../src/utils/bookingHours')
const { finalizeBookingSlotWithServices } = require('../src/utils/bookingServiceDuration')
const { fetchBookingsForDynamicSlots } = require('../src/utils/dynamicBookingSlots')
const { createMockBookingDb } = require('./helpers/mockBookingDb')

const SHOP_ID = 1
const DATE = '2026-10-09'
const STAFF_A = '11111111-1111-1111-1111-111111111111'
const STAFF_B = '22222222-2222-2222-2222-222222222222'

function clientWithStaffABooked() {
  return createMockBookingDb({
    settings: { extend_booking_by_services: 'true' },
    dayHours: {
      [DATE]: [{ start_hour: 10, start_minute: 0, end_hour: 20, end_minute: 0 }],
    },
    bookings: [
      {
        id: 1,
        shop_id: SHOP_ID,
        booking_date: DATE,
        start_hour: 10,
        start_minute: 0,
        end_hour: 11,
        end_minute: 0,
        status: 'pending',
        staff_id: STAFF_A,
      },
    ],
    options: { 1: { duration_min: 60 } },
  })
}

test('staff: ช่างคนที่สองจองเวลาเดียวกับช่างคนแรกได้', async () => {
  const client = clientWithStaffABooked()
  const body = { start_hour: 10, start_minute: 0 }

  const blocked = await validateBookingSlot(client, SHOP_ID, DATE, body, 2, null, STAFF_A)
  assert.equal(typeof blocked, 'string')
  assert.match(blocked, /ไม่เปิดรับจอง|ไม่ตรงกับเวลา/)

  const open = await validateBookingSlot(client, SHOP_ID, DATE, body, 2, null, STAFF_B)
  assert.equal(open, null)

  const finalized = await finalizeBookingSlotWithServices(
    client,
    SHOP_ID,
    DATE,
    body,
    [1],
    null,
    STAFF_B
  )
  assert.equal(finalized.error, undefined)
  assert.equal(finalized.slot.startHour, 10)
  assert.equal(finalized.slot.startMinute, 0)
})

test('staff: ไม่ระบุช่างแล้วคิวที่มีอยู่ยังล็อกเวลาทั้งร้าน', async () => {
  const client = clientWithStaffABooked()
  const body = { start_hour: 10, start_minute: 0 }
  const shopWide = await validateBookingSlot(client, SHOP_ID, DATE, body, 2, null, null)
  assert.equal(typeof shopWide, 'string')
})

test('staff: ดึงคิวสำหรับคำนวณช่วงเวลาเฉพาะช่างที่เลือก', async () => {
  const client = clientWithStaffABooked()
  const onlyA = await fetchBookingsForDynamicSlots(client, SHOP_ID, DATE, STAFF_A)
  const onlyB = await fetchBookingsForDynamicSlots(client, SHOP_ID, DATE, STAFF_B)
  const all = await fetchBookingsForDynamicSlots(client, SHOP_ID, DATE, null)
  assert.equal(onlyA.length, 1)
  assert.equal(onlyB.length, 0)
  assert.equal(all.length, 1)
})

test('staff: ร้านไม่มีช่าง คิวเดิมยังทับกันในเวลาเดียวกัน', async () => {
  const client = createMockBookingDb({
    settings: { extend_booking_by_services: 'false' },
    bookings: [
      {
        id: 9,
        shop_id: SHOP_ID,
        booking_date: DATE,
        start_hour: 10,
        start_minute: 0,
        end_hour: 12,
        end_minute: 0,
        status: 'pending',
        staff_id: null,
      },
    ],
  })
  const rows = await fetchBookingsForDynamicSlots(client, SHOP_ID, DATE, null)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].start_hour, 10)
})
