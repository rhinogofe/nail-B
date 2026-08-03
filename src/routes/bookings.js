const router = require('express').Router()
const auth   = require('../middleware/authMiddleware')
const resolveShop = require('../middleware/resolveShop')
const { getPool } = require('../db/pool')
const { getAdvanceSettings, validateBookingDateRange } = require('../utils/bookingWindow')
const {
  syncBookingOptions,
  validateOptionIds,
  validateRequiredOptions,
} = require('../utils/bookingOptions')
const { notifyShopNewBooking } = require('../utils/bookingLineNotify')
const { getShopHours, validateBookingSlot, getDayHoursForDate } = require('../utils/bookingHours')
const { getBookingSlotHours, bookingEndHour } = require('../utils/bookingSlotHours')
const { normalizeSlotInput, rangesOverlap, bookingRowToMinutes } = require('../utils/bookingSlotTimes')
const { getUiSettings } = require('../utils/shopUiSettings')
const { readUiImageFile, MIME_EXT, isAllowedKind } = require('../utils/shopUiImages')
const { getShopSetting } = require('../utils/shopSettings')
const {
  getUnpaidExpireSettings,
  isBookingExpired,
  expireUnpaidBookings,
} = require('../utils/unpaidExpire')

router.use(resolveShop)

router.get('/ui-settings', async (req, res) => {
  try {
    const pool = getPool()
    const settings = await getUiSettings(pool, req.shop.id)
    res.json(settings)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/ui-images/:kind/:filename', async (req, res) => {
  try {
    const kind = String(req.params.kind || '').toLowerCase()
    const filename = req.params.filename
    if (!isAllowedKind(kind)) {
      return res.status(404).json({ error: 'ไม่พบรูป' })
    }

    const buffer = await readUiImageFile(req.shop.id, kind, filename)
    if (!buffer) return res.status(404).json({ error: 'ไม่พบรูป' })

    const ext = filename.split('.').pop()?.toLowerCase()
    const mime = Object.entries(MIME_EXT).find(([, value]) => value === ext)?.[0] || 'application/octet-stream'
    res.set('Cache-Control', 'public, max-age=86400')
    res.type(mime)
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/shop-hours', auth, async (req, res) => {
  try {
    const pool = getPool()
    const hours = await getShopHours(pool, req.shop.id)
    res.json({
      open_hour: hours.openHour,
      last_booking_hour: hours.lastBookingHour,
      slot_hours: hours.slotHours,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/advance-days', auth, async (req, res) => {
  try {
    const pool = getPool()
    const settings = await getAdvanceSettings(pool, req.shop.id)
    res.json({
      advance_days: settings.advanceDays,
      book_until_date: settings.bookUntilDate,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/booking-display', auth, async (req, res) => {
  try {
    const pool = getPool()
    const value = await getShopSetting(pool, req.shop.id, 'booking_display_mode')
    const mode = value === 'slots_2h' ? 'slots_2h' : 'normal'
    res.json({ display_mode: mode })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/deposit-setting', auth, async (req, res) => {
  try {
    const pool = getPool()
    const value = await getShopSetting(pool, req.shop.id, 'deposit_amount')
    res.json({ deposit_amount: Number(value) || 300 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/unpaid-expire-setting', auth, async (req, res) => {
  try {
    const pool = getPool()
    const settings = await getUnpaidExpireSettings(pool, req.shop.id)
    res.json({
      enabled: settings.enabled,
      expire_hours: settings.expireHours,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/options', auth, async (req, res) => {
  const { date } = req.query
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ error: 'date ต้องเป็น YYYY-MM-DD' })
  }

  try {
    const pool = getPool()
    const params = [req.shop.id]
    let dateFilter = ''
    if (date) {
      params.push(String(date))
      dateFilter = `
        AND (show_from_date IS NULL OR show_from_date <= $${params.length})
        AND (show_to_date IS NULL OR show_to_date >= $${params.length})
      `
    }

    const result = await pool.query(
      `
        SELECT id, option_name, description, price, duration_min, is_active, is_required, color,
               show_from_date, show_to_date
        FROM nailoption
        WHERE shop_id = $1 AND is_active = true
        ${dateFilter}
        ORDER BY sort_order ASC, option_name ASC
      `,
      params
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/', auth, async (req, res) => {
  const { date } = req.query
  if (!date) return res.status(400).json({ error: 'ต้องระบุ date (YYYY-MM-DD)' })

  try {
    const pool = getPool()
    await expireUnpaidBookings(pool, req.shop.id)
    const result = await pool.query(
      `
        SELECT
          b.id,
          b.start_hour,
          b.start_minute,
          b.end_hour,
          b.end_minute,
          b.status,
          b.created_at,
          u.name        AS user_name,
          u.avatar_url  AS user_avatar,
          CASE WHEN b.user_id = $3 THEN true ELSE false END AS is_mine
        FROM bookings b
        JOIN users u ON u.id = b.user_id
        WHERE b.shop_id = $1
          AND b.booking_date = $2
          AND b.status != 'cancelled'
        ORDER BY b.start_hour, b.start_minute
      `,
      [req.shop.id, date, req.user.id]
    )

    const blocks = await pool.query(
      `
        SELECT id, block_date, start_hour, end_hour, is_full_day, note
        FROM booking_blocks
        WHERE shop_id = $1 AND block_date = $2
        ORDER BY is_full_day DESC, start_hour ASC
      `,
      [req.shop.id, date]
    )

    res.json({
      bookings: result.rows,
      blocks: blocks.rows,
      is_closed_day: blocks.rows.some((b) => b.is_full_day),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/blocks', auth, async (req, res) => {
  const { from, to } = req.query
  if (!from || !to) return res.status(400).json({ error: 'ต้องระบุ from และ to' })

  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT id, block_date, start_hour, end_hour, is_full_day, note
        FROM booking_blocks
        WHERE shop_id = $1 AND block_date BETWEEN $2 AND $3
        ORDER BY block_date ASC, is_full_day DESC, start_hour ASC
      `,
      [req.shop.id, from, to]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/extra-hours', auth, async (req, res) => {
  const { from, to } = req.query
  if (!from || !to) return res.status(400).json({ error: 'ต้องระบุ from และ to' })

  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT id, extra_date, start_hour, end_hour, note
        FROM booking_extra_hours
        WHERE shop_id = $1 AND extra_date BETWEEN $2 AND $3
        ORDER BY extra_date ASC, start_hour ASC
      `,
      [req.shop.id, from, to]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/day-hours', auth, async (req, res) => {
  const { from, to, date } = req.query
  try {
    const pool = getPool()
    if (date) {
      const rows = await getDayHoursForDate(pool, req.shop.id, date)
      return res.json(rows)
    }
    if (!from || !to) return res.status(400).json({ error: 'ต้องระบุ from และ to หรือ date' })
    const result = await pool.query(
      `
        SELECT id, schedule_date, start_hour, start_minute, end_hour, end_minute
        FROM booking_day_hours
        WHERE shop_id = $1 AND schedule_date BETWEEN $2 AND $3
        ORDER BY schedule_date ASC, start_hour ASC, start_minute ASC
      `,
      [req.shop.id, from, to]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', auth, async (req, res) => {
  const { booking_date, start_hour, option_ids } = req.body
  if (!booking_date || start_hour == null)
    return res.status(400).json({ error: 'ต้องระบุ booking_date และ start_hour' })
  if (!Array.isArray(option_ids) || option_ids.length === 0) {
    return res.status(400).json({ error: 'กรุณาเลือกบริการอย่างน้อย 1 รายการ' })
  }

  try {
    const pool = getPool()
    const shopId = req.shop.id
    await expireUnpaidBookings(pool, shopId)
    const { bookUntilDate } = await getAdvanceSettings(pool, shopId)
    const dateError = validateBookingDateRange(booking_date, bookUntilDate)
    if (dateError) return res.status(400).json({ error: dateError })

    const slotHours = await getBookingSlotHours(pool, shopId)
    const slotError = await validateBookingSlot(pool, shopId, booking_date, req.body, slotHours)
    if (slotError) return res.status(400).json({ error: slotError })

    const slot = normalizeSlotInput(req.body, slotHours)
    if (!slot) return res.status(400).json({ error: 'ช่วงเวลาไม่ถูกต้อง' })

    const uniqueOptionIds = [...new Set(option_ids.map(String))]
    const isValidOptions = await validateOptionIds(pool, shopId, uniqueOptionIds, booking_date)
    if (!isValidOptions) {
      return res.status(400).json({ error: 'รายการบริการที่เลือกไม่ถูกต้อง' })
    }

    const requiredError = await validateRequiredOptions(pool, shopId, uniqueOptionIds, booking_date)
    if (requiredError) {
      return res.status(400).json({ error: requiredError })
    }

    const overlap = await pool.query(
      `
        SELECT id, start_hour, start_minute, end_hour, end_minute
        FROM bookings
        WHERE shop_id = $1
          AND booking_date = $2
          AND status != 'cancelled'
      `,
      [shopId, booking_date]
    )
    const hasOverlap = overlap.rows.some((row) => {
      const existing = bookingRowToMinutes(row, slotHours)
      return rangesOverlap(slot.startM, slot.endM, existing.startM, existing.endM)
    })
    if (hasOverlap) {
      return res.status(409).json({ error: 'เวลานี้ทับกับคิวอื่น กรุณาเลือกเวลาใหม่' })
    }

    const blocked = await pool.query(
      `
        SELECT id, start_hour, end_hour, is_full_day
        FROM booking_blocks
        WHERE shop_id = $1 AND block_date = $2
      `,
      [shopId, booking_date]
    )
    const isBlocked = blocked.rows.some((row) => {
      if (row.is_full_day) return true
      const blockStart = Number(row.start_hour) * 60
      const blockEnd = Number(row.end_hour) * 60
      return rangesOverlap(slot.startM, slot.endM, blockStart, blockEnd)
    })
    if (isBlocked) {
      return res.status(409).json({ error: 'ช่วงเวลานี้ร้านปิดรับคิว' })
    }

    const result = await pool.query(
      `
        INSERT INTO bookings (
          shop_id, user_id, booking_date,
          start_hour, start_minute, end_hour, end_minute,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'awaiting_payment')
        RETURNING id, booking_date, start_hour, start_minute, end_hour, end_minute, status
      `,
      [
        shopId,
        req.user.id,
        booking_date,
        slot.startHour,
        slot.startMinute,
        slot.endHour,
        slot.endMinute,
      ]
    )
    await syncBookingOptions(pool, result.rows[0].id, uniqueOptionIds)
    const bookingId = result.rows[0].id
    res.status(201).json({ success: true, booking: result.rows[0] })
    notifyShopNewBooking(pool, shopId, bookingId).catch(() => null)
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'เวลานี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.get('/my', auth, async (req, res) => {
  try {
    const pool = getPool()
    await expireUnpaidBookings(pool, req.shop.id)
    const result = await pool.query(
      `
        SELECT
          b.id,
          b.booking_date,
          b.start_hour,
          b.end_hour,
          b.status,
          b.created_at,
          b.completed_at,
          b.total
        FROM bookings b
        WHERE b.shop_id = $1 AND b.user_id = $2
        ORDER BY b.booking_date DESC, b.start_hour DESC
      `,
      [req.shop.id, req.user.id]
    )

    const optionsResult = await pool.query(
      `
        SELECT b.id AS booking_id, n.id AS option_id, n.option_name
        FROM bookings b
        JOIN booking_nailoptions bn ON bn.booking_id = b.id
        JOIN nailoption n ON n.id = bn.nailoption_id
        WHERE b.shop_id = $1 AND b.user_id = $2
        ORDER BY b.booking_date DESC, b.start_hour DESC, n.option_name ASC
      `,
      [req.shop.id, req.user.id]
    )

    const optionsByBookingId = {}
    for (const row of optionsResult.rows) {
      if (!optionsByBookingId[row.booking_id]) optionsByBookingId[row.booking_id] = []
      optionsByBookingId[row.booking_id].push({
        id: row.option_id,
        option_name: row.option_name,
      })
    }

    res.json(result.rows.map((item) => ({
      ...item,
      nail_options: optionsByBookingId[item.id] || [],
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:id/payment-info', auth, async (req, res) => {
  try {
    const pool = getPool()
    await expireUnpaidBookings(pool, req.shop.id)
    const settings = await getUnpaidExpireSettings(pool, req.shop.id)

    const result = await pool.query(
      `
        SELECT id, booking_date, start_hour, end_hour, status, created_at
        FROM bookings
        WHERE id = $1 AND shop_id = $2 AND user_id = $3
      `,
      [req.params.id, req.shop.id, req.user.id]
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'ไม่พบคิว' })
    }

    const booking = result.rows[0]
    const expired = isBookingExpired(booking.created_at, settings.expireHours, settings.enabled)

    if (expired && booking.status === 'awaiting_payment') {
      await pool.query(
        `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'awaiting_payment'`,
        [booking.id]
      )
      booking.status = 'cancelled'
    }

    res.json({
      booking,
      unpaid_expire: {
        enabled: settings.enabled,
        expire_hours: settings.expireHours,
      },
      is_expired: booking.status === 'cancelled' && expired,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', auth, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        UPDATE bookings
        SET status = 'cancelled'
        WHERE id = $1
          AND shop_id = $2
          AND user_id = $3
          AND status = 'awaiting_payment'
      `,
      [req.params.id, req.shop.id, req.user.id]
    )

    if (result.rowCount === 0)
      return res.status(404).json({ error: 'ไม่พบคิว หรือไม่สามารถยกเลิกได้' })

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
