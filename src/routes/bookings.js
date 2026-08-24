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
const { finalizeBookingSlotWithServices } = require('../utils/bookingServiceDuration')
const { notifyShopNewBooking } = require('../utils/bookingLineNotify')
const { notifyAdminNewBookingChat, notifyBookingCancelledChat, notifyAdminPaymentSlipChat } = require('../utils/bookingChatNotify')
const { emitBookingChanged } = require('../utils/bookingEvents')
const { getShopHours, validateBookingSlot, getDayHoursForDate } = require('../utils/bookingHours')
const { getBookingSlotHours, bookingEndHour, normalizeBookingDisplayMode } = require('../utils/bookingSlotHours')
const { normalizeSlotInput, rangesOverlap, bookingRowToMinutes } = require('../utils/bookingSlotTimes')
const { getUiSettings } = require('../utils/shopUiSettings')
const { resolveShopMapEmbedUrlDetailed } = require('../utils/googleMapEmbed')
const { readUiImageFile, MIME_EXT, isAllowedKind } = require('../utils/shopUiImages')
const { getShopSetting } = require('../utils/shopSettings')
const {
  getUnpaidExpireSettings,
  isBookingExpired,
  expireUnpaidBookings,
} = require('../utils/unpaidExpire')
const {
  parseBase64Image,
  saveBookingPaymentSlip,
  deleteBookingPaymentSlip,
  deletePaymentSlipByBookingId,
  isPaymentSlipUploadEnabled,
  readBookingPaymentSlip,
  MIME_EXT: SLIP_MIME_EXT,
} = require('../utils/bookingPaymentSlips')

function mapCustomerSlipRow(row) {
  if (!row) return null
  return {
    id: row.id,
    booking_id: row.booking_id,
    status: row.status,
    slip_filename: row.slip_filename,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function fetchCustomerBookingSlip(pool, bookingId, shopId, userId) {
  const result = await pool.query(
    `
      SELECT bps.id, bps.booking_id, bps.status, bps.slip_filename, bps.created_at, bps.updated_at
      FROM booking_payment_slips bps
      JOIN bookings b ON b.id = bps.booking_id
      WHERE bps.booking_id = $1 AND bps.shop_id = $2 AND b.user_id = $3
      LIMIT 1
    `,
    [bookingId, shopId, userId]
  )
  return result.rows[0] || null
}

async function assertCustomerAwaitingPaymentBooking(pool, bookingId, shopId, userId) {
  await expireUnpaidBookings(pool, shopId)
  const settings = await getUnpaidExpireSettings(pool, shopId)
  const bookingRes = await pool.query(
    `
      SELECT id, status, created_at
      FROM bookings
      WHERE id = $1 AND shop_id = $2 AND user_id = $3
    `,
    [bookingId, shopId, userId]
  )
  const booking = bookingRes.rows[0]
  if (!booking) return { error: 'ไม่พบคิว', status: 404 }
  if (booking.status !== 'awaiting_payment') {
    return { error: 'คิวนี้ไม่อยู่ในสถานะรอชำระเงิน', status: 400 }
  }
  if (isBookingExpired(booking.created_at, settings.expireHours, settings.enabled)) {
    return { error: 'คิวหมดเวลาชำระแล้ว', status: 409 }
  }
  return { booking, settings }
}

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

router.get('/map-embed', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const shopSlug = req.shop.slug
    const settings = await getUiSettings(pool, shopId)
    const mapUrl = settings.ui_shop_map_url || ''
    const embedUrl = settings.ui_shop_map_embed_url || ''

    let debug = null
    if (!embedUrl && mapUrl) {
      const result = await resolveShopMapEmbedUrlDetailed(mapUrl, '')
      debug = result.debug
      console.log('[map-embed]', 'api_map_embed_empty', JSON.stringify({
        shop_id: shopId,
        shop_slug: shopSlug,
        map_url: mapUrl,
        steps: debug?.steps || [],
      }))
    } else {
      console.log('[map-embed]', 'api_map_embed', JSON.stringify({
        shop_id: shopId,
        shop_slug: shopSlug,
        has_map: !!mapUrl,
        has_embed: !!embedUrl,
      }))
    }

    res.json({
      map_url: mapUrl,
      embed_url: embedUrl,
      debug,
    })
  } catch (err) {
    console.error('[map-embed]', 'api_map_embed_error', err.message)
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
    const { getExtendBookingSettings } = require('../utils/extendBookingSettings')
    const extendSettings = await getExtendBookingSettings(pool, req.shop.id)
    res.json({
      open_hour: hours.openHour,
      last_booking_hour: hours.lastBookingHour,
      slot_hours: hours.slotHours,
      extend_booking_by_services: extendSettings.enabled,
      extend_booking_past_close: extendSettings.pastCloseEnabled,
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
    const mode = normalizeBookingDisplayMode(value)
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
    const shopId = req.shop.id
    const params = [shopId]
    let dateFilter = ''
    if (date) {
      params.push(String(date))
      dateFilter = `
        AND (n.show_from_date IS NULL OR n.show_from_date <= $${params.length})
        AND (n.show_to_date IS NULL OR n.show_to_date >= $${params.length})
      `
    }

    const [categoriesRes, optionsRes, locationsRes] = await Promise.all([
      pool.query(
        `
          SELECT id, name, description, sort_order
          FROM service_categories
          WHERE shop_id = $1 AND is_active = true
          ORDER BY sort_order ASC, name ASC
        `,
        [shopId]
      ),
      pool.query(
        `
          SELECT
            n.id, n.option_name, n.description, n.price, n.duration_min, n.is_active, n.is_required, n.color,
            n.show_from_date, n.show_to_date, n.category_id,
            c.name AS category_name, COALESCE(c.sort_order, 9999) AS category_sort_order
          FROM nailoption n
          LEFT JOIN service_categories c ON c.id = n.category_id AND c.shop_id = n.shop_id
          WHERE n.shop_id = $1 AND n.is_active = true
          ${dateFilter}
          ORDER BY category_sort_order ASC, n.sort_order ASC, n.option_name ASC
        `,
        params
      ),
      pool.query(
        `
          SELECT name, map_url, color, description
          FROM service_locations
          WHERE shop_id = $1 AND is_active = true
          ORDER BY sort_order ASC, name ASC
        `,
        [shopId]
      ),
    ])

    res.json({
      categories: categoriesRes.rows,
      options: optionsRes.rows,
      locations: locationsRes.rows,
    })
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

    const uniqueOptionIds = [...new Set(option_ids.map(String))]
    const isValidOptions = await validateOptionIds(pool, shopId, uniqueOptionIds, booking_date)
    if (!isValidOptions) {
      return res.status(400).json({ error: 'รายการบริการที่เลือกไม่ถูกต้อง' })
    }

    const requiredError = await validateRequiredOptions(pool, shopId, uniqueOptionIds, booking_date)
    if (requiredError) {
      return res.status(400).json({ error: requiredError })
    }

    const finalized = await finalizeBookingSlotWithServices(
      pool,
      shopId,
      booking_date,
      req.body,
      uniqueOptionIds
    )
    if (finalized.error) return res.status(400).json({ error: finalized.error })
    const slot = finalized.slot

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
    emitBookingChanged(shopId, { type: 'created', booking_id: bookingId, booking_date })
    notifyShopNewBooking(pool, shopId, bookingId).catch(() => null)
    notifyAdminNewBookingChat(pool, shopId, bookingId).catch(() => null)
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

    const locationRes = await pool.query(
      `
        SELECT sl.name, sl.map_url
        FROM booking_nailoptions bn
        JOIN nailoption n ON n.id = bn.nailoption_id AND n.shop_id = $2
        LEFT JOIN service_locations sl
          ON sl.shop_id = $2
         AND sl.name = n.option_name
         AND sl.is_active = true
        WHERE bn.booking_id = $1
          AND n.is_required = true
        ORDER BY n.option_name ASC
        LIMIT 1
      `,
      [booking.id, req.shop.id]
    )
    const locationRow = locationRes.rows[0] || null
    const locationMapUrl = String(locationRow?.map_url || '').trim()

    if (expired && booking.status === 'awaiting_payment') {
      await pool.query(
        `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'awaiting_payment'`,
        [booking.id]
      )
      booking.status = 'cancelled'
      await deletePaymentSlipByBookingId(pool, booking.id)
      notifyBookingCancelledChat(pool, req.shop.id, booking.id).catch(() => null)
      emitBookingChanged(req.shop.id, {
        type: 'auto_cancelled',
        booking_id: booking.id,
        booking_date: booking.booking_date,
      })
    }

    res.json({
      booking,
      location_name: locationRow?.name || null,
      location_map_url: locationMapUrl || null,
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

router.get('/:id/payment-slip', auth, async (req, res) => {
  try {
    const pool = getPool()
    const bookingId = req.params.id
    const slip = await fetchCustomerBookingSlip(pool, bookingId, req.shop.id, req.user.id)
    if (!slip) {
      const owned = await pool.query(
        `SELECT id FROM bookings WHERE id = $1 AND shop_id = $2 AND user_id = $3 LIMIT 1`,
        [bookingId, req.shop.id, req.user.id]
      )
      if (!owned.rows[0]) return res.status(404).json({ error: 'ไม่พบคิว' })
      return res.json({ slip: null })
    }
    res.json({ slip: mapCustomerSlipRow(slip) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:id/payment-slip/file', auth, async (req, res) => {
  try {
    const pool = getPool()
    const slip = await fetchCustomerBookingSlip(pool, req.params.id, req.shop.id, req.user.id)
    if (!slip?.slip_filename) return res.status(404).json({ error: 'ไม่พบสลิป' })

    const buffer = await readBookingPaymentSlip(slip.slip_filename)
    if (!buffer) return res.status(404).json({ error: 'ไม่พบไฟล์สลิป' })

    const ext = slip.slip_filename.split('.').pop()?.toLowerCase()
    const mime = Object.entries(SLIP_MIME_EXT).find(([, v]) => v === ext)?.[0] || 'image/jpeg'
    res.set('Cache-Control', 'private, max-age=3600')
    res.type(mime)
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id/payment-slip', auth, async (req, res) => {
  try {
    const pool = getPool()
    const bookingId = req.params.id
    const access = await assertCustomerAwaitingPaymentBooking(pool, bookingId, req.shop.id, req.user.id)
    if (access.error) return res.status(access.status || 400).json({ error: access.error })

    const slip = await fetchCustomerBookingSlip(pool, bookingId, req.shop.id, req.user.id)
    if (!slip) return res.status(404).json({ error: 'ไม่พบสลิป' })
    if (slip.status === 'confirmed') {
      return res.status(400).json({ error: 'ชำระเงินยืนยันแล้ว ไม่สามารถลบสลิปได้' })
    }
    if (slip.status !== 'pending' && slip.status !== 'cancelled') {
      return res.status(400).json({ error: 'ลบสลิปไม่ได้ในสถานะนี้' })
    }

    await pool.query(`DELETE FROM booking_payment_slips WHERE id = $1`, [slip.id])
    await deleteBookingPaymentSlip(slip.slip_filename)
    res.json({ success: true, message: 'ลบสลิปแล้ว — อัปโหลดใหม่ได้' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/:id/payment-slip', auth, async (req, res) => {
  const parsed = parseBase64Image(req.body?.image_data, req.body?.image_mime)
  if (!parsed) return res.status(400).json({ error: 'ต้องอัปโหลดสลิปการชำระ' })
  if (parsed.error) return res.status(400).json({ error: parsed.error })

  try {
    const pool = getPool()
    const bookingId = req.params.id
    const access = await assertCustomerAwaitingPaymentBooking(pool, bookingId, req.shop.id, req.user.id)
    if (access.error) return res.status(access.status || 400).json({ error: access.error })
    const booking = access.booking

    const uploadEnabled = await isPaymentSlipUploadEnabled(pool, req.shop.id)
    if (!uploadEnabled) {
      return res.status(403).json({ error: 'ร้านปิดการอัปโหลดสลิปในระบบ กรุณาส่งสลิปทาง LINE' })
    }

    const existing = await pool.query(
      `SELECT id, slip_filename, status FROM booking_payment_slips WHERE booking_id = $1 LIMIT 1`,
      [booking.id]
    )
    const prev = existing.rows[0]
    if (prev?.status === 'confirmed') {
      return res.status(400).json({ error: 'ชำระเงินยืนยันแล้ว ไม่ต้องอัปโหลดสลิปซ้ำ' })
    }
    if (prev?.status === 'pending') {
      return res.status(400).json({ error: 'มีสลิปรอตรวจอยู่แล้ว — กรุณาลบก่อนอัปโหลดใหม่' })
    }

    const slipFilename = await saveBookingPaymentSlip(parsed.buffer, parsed.ext)
    if (prev?.slip_filename && prev.slip_filename !== slipFilename) {
      await deleteBookingPaymentSlip(prev.slip_filename)
    }

    let row
    if (prev) {
      const updated = await pool.query(
        `
          UPDATE booking_payment_slips
          SET
            slip_filename = $1,
            status = 'pending',
            uploaded_by_user_id = $2,
            reviewed_by_user_id = NULL,
            reviewed_at = NULL,
            created_at = NOW(),
            updated_at = NOW()
          WHERE booking_id = $3
          RETURNING *
        `,
        [slipFilename, req.user.id, booking.id]
      )
      row = updated.rows[0]
    } else {
      const inserted = await pool.query(
        `
          INSERT INTO booking_payment_slips (
            booking_id, shop_id, slip_filename, status, uploaded_by_user_id
          )
          VALUES ($1, $2, $3, 'pending', $4)
          RETURNING *
        `,
        [booking.id, req.shop.id, slipFilename, req.user.id]
      )
      row = inserted.rows[0]
    }

    emitBookingChanged(req.shop.id, {
      type: 'payment_slip_uploaded',
      booking_id: booking.id,
      booking_date: booking.booking_date,
    })
    notifyAdminPaymentSlipChat(pool, req.shop.id, booking.id).catch(() => null)

    res.status(201).json({
      success: true,
      message: 'อัปโหลดสลิปแล้ว — รอแอดมินยืนยัน',
      slip: mapCustomerSlipRow(row),
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
        RETURNING id, booking_date
      `,
      [req.params.id, req.shop.id, req.user.id]
    )

    if (result.rowCount === 0)
      return res.status(404).json({ error: 'ไม่พบคิว หรือไม่สามารถยกเลิกได้' })

    await deletePaymentSlipByBookingId(pool, req.params.id)

    res.json({ success: true })
    const row = result.rows[0]
    emitBookingChanged(req.shop.id, {
      type: 'cancelled',
      booking_id: row.id,
      booking_date: row.booking_date,
    })
    notifyBookingCancelledChat(pool, req.shop.id, req.params.id).catch(() => null)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
