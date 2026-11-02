import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  buildMoveBookingSlotSelectOptions,
  parseSlotKey,
  slotKey,
  bookingRowToSlot,
} from '../../Frontend/src/utils/bookingSlots.js'

const require = createRequire(import.meta.url)
const { validateBookingSlot } = require('../src/utils/bookingHours.js')
const { finalizeBookingSlotWithServices } = require('../src/utils/bookingServiceDuration.js')
const { createMockBookingDb } = require('./helpers/mockBookingDb.js')

const SHOP_ID = 1
const DATE = '2026-11-03'

function booking(id, startHour, startMinute, endHour, endMinute) {
  return {
    id,
    shop_id: SHOP_ID,
    booking_date: DATE,
    start_hour: startHour,
    start_minute: startMinute,
    end_hour: endHour,
    end_minute: endMinute,
    status: 'pending',
    staff_id: null,
  }
}

async function serverRejectionsForMoveOptions({ extend, own, others = [] }) {
  const bookings = [own, ...others]
  const client = createMockBookingDb({
    settings: { extend_booking_by_services: extend ? 'true' : 'false' },
    bookings,
  })
  const options = buildMoveBookingSlotSelectOptions({
    openHour: 9,
    lastBookingHour: 18,
    extras: [],
    dayWindows: [],
    blocks: [],
    bookings,
    displayMode: 'slots_2h',
    slotHours: 2,
    extendByServices: extend,
    minGapMinutes: 60,
  }, {
    movingBookingId: own.id,
    excludeSlotKey: slotKey(bookingRowToSlot(own, 2)),
  })
  assert.ok(options.length > 0, 'dropdown should offer at least one time')

  const rejected = []
  for (const opt of options) {
    const slot = parseSlotKey(opt.key)
    const body = {
      start_hour: slot.startHour,
      start_minute: slot.startMinute,
      end_hour: slot.endHour,
      end_minute: slot.endMinute,
    }
    const slotError = await validateBookingSlot(client, SHOP_ID, DATE, body, 2, own.id, null)
    const finalized = slotError ? null : await finalizeBookingSlotWithServices(client, SHOP_ID, DATE, body, [1], own.id, null)
    const error = slotError || finalized?.error
    if (error) rejected.push(`${opt.label}: ${error}`)
  }
  return { rejected, labels: options.map((o) => o.label) }
}

test('ย้ายคิว: คิวเดิมยาว 1.5 ชม. (ขยายตามบริการ) ทุกเวลาที่เสนอต้องผ่านการตรวจของเซิร์ฟเวอร์', async () => {
  const { rejected, labels } = await serverRejectionsForMoveOptions({
    extend: true,
    own: booking(501, 10, 0, 11, 30),
  })
  assert.deepEqual(rejected, [], `dropdown offered: ${labels.join(', ')}`)
})

test('ย้ายคิว: มีคิวลูกค้าอื่นในวันเดียวกัน ทุกเวลาที่เสนอต้องผ่านการตรวจของเซิร์ฟเวอร์', async () => {
  const { rejected, labels } = await serverRejectionsForMoveOptions({
    extend: true,
    own: booking(501, 10, 0, 11, 30),
    others: [booking(502, 14, 0, 15, 30)],
  })
  assert.deepEqual(rejected, [], `dropdown offered: ${labels.join(', ')}`)
  assert.equal(labels.some((l) => l.startsWith('14:00')), false, 'ไม่ควรเสนอเวลาที่ลูกค้าอื่นจองอยู่')
})

test('ย้ายคิว: ปิดขยายตามบริการ ทุกเวลาที่เสนอต้องผ่านการตรวจของเซิร์ฟเวอร์', async () => {
  const { rejected, labels } = await serverRejectionsForMoveOptions({
    extend: false,
    own: booking(501, 11, 0, 13, 0),
    others: [booking(502, 15, 0, 17, 0)],
  })
  assert.deepEqual(rejected, [], `dropdown offered: ${labels.join(', ')}`)
})
