const test = require('node:test')
const assert = require('node:assert/strict')
const { validateBookingSlot } = require('../src/utils/bookingHours')
const { finalizeBookingSlotWithServices } = require('../src/utils/bookingServiceDuration')
const { createMockBookingDb } = require('./helpers/mockBookingDb')

const SHOP_ID = 1
const DATE = '2026-10-09'
const STAFF_A = '11111111-1111-1111-1111-111111111111'
const STAFF_B = '22222222-2222-2222-2222-222222222222'

function db(config) {
  return createMockBookingDb({ shopId: SHOP_ID, ...config })
}

test('คนละช่วง: ช่างเอจองนอกช่วงตัวเองไม่ได้ และช่างบียังจองช่วงของตัวเองได้', async () => {
  const client = db({
    settings: { extend_booking_by_services: 'false' },
    dayHours: {
      [DATE]: [
        { staff_id: STAFF_A, start_hour: 10, start_minute: 0, end_hour: 12, end_minute: 0 },
        { staff_id: STAFF_B, start_hour: 14, start_minute: 0, end_hour: 16, end_minute: 0 },
      ],
    },
    bookings: [
      {
        id: 1,
        shop_id: SHOP_ID,
        booking_date: DATE,
        start_hour: 10,
        start_minute: 0,
        end_hour: 12,
        end_minute: 0,
        status: 'pending',
        staff_id: STAFF_A,
      },
    ],
  })

  const aAt14 = await validateBookingSlot(
    client, SHOP_ID, DATE, { start_hour: 14, start_minute: 0 }, 2, null, STAFF_A
  )
  assert.equal(typeof aAt14, 'string')

  const bAt14 = await validateBookingSlot(
    client, SHOP_ID, DATE, { start_hour: 14, start_minute: 0 }, 2, null, STAFF_B
  )
  assert.equal(bAt14, null)

  const bAt10 = await validateBookingSlot(
    client, SHOP_ID, DATE, { start_hour: 10, start_minute: 0 }, 2, null, STAFF_B
  )
  assert.equal(typeof bAt10, 'string')

  const aAt10 = await finalizeBookingSlotWithServices(
    client, SHOP_ID, DATE, { start_hour: 10, start_minute: 0 }, [1], null, STAFF_A
  )
  assert.equal(aAt10.error, undefined)
  assert.equal(aAt10.slot.startHour, 10)
  assert.equal(aAt10.slot.endHour, 12)
})

test('ขยายตามบริการ: บริการที่เกินเวลาช่างถูกปฏิเสธ แต่ช่างที่เวลาปิดช้ากว่าจองได้', async () => {
  const client = db({
    settings: {
      extend_booking_by_services: 'true',
      extend_booking_past_close: 'false',
    },
    dayHours: {
      [DATE]: [
        { start_hour: 10, start_minute: 0, end_hour: 20, end_minute: 0 },
        { staff_id: STAFF_A, start_hour: 14, start_minute: 0, end_hour: 16, end_minute: 0 },
      ],
    },
    options: { 1: { duration_min: 150 } },
  })

  const tooLong = await finalizeBookingSlotWithServices(
    client, SHOP_ID, DATE, { start_hour: 14, start_minute: 0 }, [1], null, STAFF_A
  )
  assert.match(tooLong.error || '', /ยาวเกินเวลาเปิดรับวันนี้/)

  const fitsShop = await finalizeBookingSlotWithServices(
    client, SHOP_ID, DATE, { start_hour: 10, start_minute: 0 }, [1], null, STAFF_B
  )
  assert.equal(fitsShop.error, undefined)
  assert.equal(fitsShop.slot.endHour, 12)
  assert.equal(fitsShop.slot.endMinute, 30)
})

test('โหมดขยายและมีคิวแล้ว: คิวช่างเอไม่เลื่อนช่วงของช่างบี และไม่ให้จองนอกช่วงของตัวเอง', async () => {
  const client = db({
    settings: { extend_booking_by_services: 'true' },
    dayHours: {
      [DATE]: [
        { staff_id: STAFF_A, start_hour: 10, start_minute: 0, end_hour: 16, end_minute: 0 },
        { staff_id: STAFF_B, start_hour: 10, start_minute: 0, end_hour: 18, end_minute: 0 },
      ],
    },
    bookings: [
      {
        id: 7,
        shop_id: SHOP_ID,
        booking_date: DATE,
        start_hour: 10,
        start_minute: 0,
        end_hour: 12,
        end_minute: 0,
        status: 'pending',
        staff_id: STAFF_A,
      },
    ],
    options: { 1: { duration_min: 60 } },
  })

  const aAt10 = await validateBookingSlot(
    client, SHOP_ID, DATE, { start_hour: 10, start_minute: 0 }, 2, null, STAFF_A
  )
  assert.equal(typeof aAt10, 'string')

  const bAt10 = await validateBookingSlot(
    client, SHOP_ID, DATE, { start_hour: 10, start_minute: 0 }, 2, null, STAFF_B
  )
  assert.equal(bAt10, null)

  const aAt12 = await validateBookingSlot(
    client, SHOP_ID, DATE, { start_hour: 12, start_minute: 0 }, 2, null, STAFF_A
  )
  assert.equal(aAt12, null)

  const aAt16 = await validateBookingSlot(
    client, SHOP_ID, DATE, { start_hour: 16, start_minute: 0 }, 2, null, STAFF_A
  )
  assert.equal(typeof aAt16, 'string')

  const bAt16 = await validateBookingSlot(
    client, SHOP_ID, DATE, { start_hour: 16, start_minute: 0 }, 2, null, STAFF_B
  )
  assert.equal(typeof bAt16, 'string')

  const bSameTime = await finalizeBookingSlotWithServices(
    client, SHOP_ID, DATE, { start_hour: 10, start_minute: 0 }, [1], null, STAFF_B
  )
  assert.equal(bSameTime.error, undefined)
  assert.equal(bSameTime.slot.startHour, 10)
})
