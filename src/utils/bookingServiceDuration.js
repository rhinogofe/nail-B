const { getDayHoursForDate } = require('./bookingDayHours')
const { getShopHours } = require('./bookingHours')
const { normalizeBookingSlotHours } = require('./bookingSlotHours')
const { getExtendByServicesSetting, getExtendPastCloseSetting } = require('./extendBookingSettings')
const {
  normalizeSlotInput,
  matchesDayWindowStart,
  matchesDayWindowSlot,
} = require('./bookingSlotTimes')
const { sumOptionDurationMinutes } = require('./bookingOptions')

function minutesToHm(totalMinutes) {
  const mins = Math.max(0, Math.floor(Number(totalMinutes)))
  const hour = Math.floor(mins / 60)
  const minute = mins % 60
  if (hour > 23 || (hour === 23 && minute > 59)) return null
  return { hour, minute }
}

function getOfferedSlotMinutes(baseSlot, slotHours = 2) {
  if (baseSlot?.endM > baseSlot?.startM) {
    return baseSlot.endM - baseSlot.startM
  }
  return normalizeBookingSlotHours(slotHours) * 60
}

function applyServiceDurationToSlot(baseSlot, totalServiceMinutes, slotHours = 2) {
  if (!baseSlot) return null
  const minMinutes = getOfferedSlotMinutes(baseSlot, slotHours)
  const serviceMinutes = Math.max(0, Number(totalServiceMinutes) || 0)
  const effectiveMinutes = Math.max(minMinutes, serviceMinutes)
  const endM = baseSlot.startM + effectiveMinutes
  if (endM > 24 * 60) return null
  const end = minutesToHm(endM)
  if (!end) return null
  return {
    ...baseSlot,
    endHour: end.hour,
    endMinute: end.minute,
    endM,
    serviceDurationMinutes: serviceMinutes,
    effectiveDurationMinutes: effectiveMinutes,
  }
}

async function validateBookingEndWithinDay(poolOrClient, shopId, bookingDate, slot) {
  const allowPastClose = await getExtendPastCloseSetting(poolOrClient, shopId)
  if (allowPastClose) return null

  const dayWindows = await getDayHoursForDate(poolOrClient, shopId, bookingDate)
  if (dayWindows.length) {
    const maxEnd = Math.max(
      ...dayWindows.map((w) => toMinutes(Number(w.end_hour), normalizeMinute(w.end_minute)))
    )
    if (slot.endM > maxEnd) {
      return 'บริการที่เลือกยาวเกินเวลาเปิดรับวันนี้'
    }
    return null
  }

  const { lastBookingHour, slotHours } = await getShopHours(poolOrClient, shopId)
  const maxEndM = toMinutes(lastBookingHour + normalizeBookingSlotHours(slotHours), 0)
  if (slot.endM > maxEndM) {
    return 'บริการที่เลือกยาวเกินเวลาเปิดรับของร้าน'
  }
  return null
}

async function validateBookingStartSlot(
  poolOrClient,
  shopId,
  bookingDate,
  baseSlot,
  slotHours,
  excludeBookingId = null
) {
  const extendEnabled = await getExtendByServicesSetting(poolOrClient, shopId)
  if (extendEnabled) {
    const { validateDynamicBookingStart } = require('./dynamicBookingSlots')
    return validateDynamicBookingStart(
      poolOrClient,
      shopId,
      bookingDate,
      baseSlot,
      slotHours,
      excludeBookingId
    )
  }

  const dayWindows = await getDayHoursForDate(poolOrClient, shopId, bookingDate)
  if (dayWindows.length) {
    if (!matchesDayWindowStart(baseSlot, dayWindows)) {
      return 'ช่วงเวลานี้ไม่ตรงกับเวลาที่เปิดรับวันนี้'
    }
    return null
  }

  if (baseSlot.startMinute !== 0 || baseSlot.endMinute !== 0) {
    return 'วันนี้ใช้เวลาเปิด-ปิดปกติ (เต็มชั่วโมง)'
  }

  const { getExtraHoursForDate, isWithinExtraWindow, isWithinNormalHours } = require('./bookingHours')
  const { openHour, lastBookingHour } = await getShopHours(poolOrClient, shopId)
  if (isWithinNormalHours(baseSlot.startHour, openHour, lastBookingHour)) {
    return null
  }
  const extras = await getExtraHoursForDate(poolOrClient, shopId, bookingDate)
  if (isWithinExtraWindow(baseSlot.startHour, normalizeBookingSlotHours(slotHours), extras)) {
    return null
  }
  return `start_hour ต้องอยู่ระหว่าง ${openHour}-${lastBookingHour} หรือในช่วงเปิดเพิ่มของวันนี้`
}

async function finalizeBookingSlotWithServices(
  poolOrClient,
  shopId,
  bookingDate,
  body,
  optionIds,
  excludeBookingId = null
) {
  const { getBookingSlotHours } = require('./bookingSlotHours')
  const slotHours = await getBookingSlotHours(poolOrClient, shopId)
  const extendEnabled = await getExtendByServicesSetting(poolOrClient, shopId)

  const baseSlot = normalizeSlotInput(body, slotHours)
  if (!baseSlot) {
    return { error: 'ช่วงเวลาไม่ถูกต้อง' }
  }

  const startError = await validateBookingStartSlot(
    poolOrClient,
    shopId,
    bookingDate,
    baseSlot,
    slotHours,
    excludeBookingId
  )
  if (startError) return { error: startError }

  if (!extendEnabled) {
    const strictSlot = normalizeSlotInput(body, slotHours)
    if (!strictSlot) return { error: 'ช่วงเวลาไม่ถูกต้อง' }

    const dayWindows = await getDayHoursForDate(poolOrClient, shopId, bookingDate)
    if (dayWindows.length) {
      if (!matchesDayWindowSlot(strictSlot, dayWindows)) {
        return { error: 'ช่วงเวลานี้ไม่ตรงกับเวลาที่เปิดรับวันนี้' }
      }
      return { slot: strictSlot, slotHours, totalServiceMinutes: 0 }
    }

    const expectedEnd = baseSlot.startHour + normalizeBookingSlotHours(slotHours)
    if (strictSlot.endHour !== expectedEnd || strictSlot.endMinute !== 0) {
      return { error: `ช่วงเวลาต้องยาว ${normalizeBookingSlotHours(slotHours)} ชั่วโมง` }
    }
    return { slot: strictSlot, slotHours, totalServiceMinutes: 0 }
  }

  const totalServiceMinutes = await sumOptionDurationMinutes(poolOrClient, shopId, optionIds)
  const slot = applyServiceDurationToSlot(baseSlot, totalServiceMinutes, slotHours)
  if (!slot) {
    return { error: 'บริการที่เลือกยาวเกินเวลาเปิดรับ' }
  }

  const endError = await validateBookingEndWithinDay(poolOrClient, shopId, bookingDate, slot)
  if (endError) return { error: endError }

  return { slot, slotHours, totalServiceMinutes }
}

module.exports = {
  applyServiceDurationToSlot,
  validateBookingStartSlot,
  validateBookingEndWithinDay,
  finalizeBookingSlotWithServices,
}
