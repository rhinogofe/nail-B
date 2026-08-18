function optionDateFilter(bookingDate, paramIndex) {
  if (!bookingDate) return ''
  return `
    AND (show_from_date IS NULL OR show_from_date <= $${paramIndex})
    AND (show_to_date IS NULL OR show_to_date >= $${paramIndex})
  `
}

async function syncBookingOptions(db, bookingId, optionIds) {
  await db.query(`DELETE FROM booking_nailoptions WHERE booking_id = $1`, [bookingId])

  if (!optionIds.length) return

  const values = []
  const params = [bookingId]
  optionIds.forEach((id, idx) => {
    params.push(id)
    values.push(`($1, $${idx + 2})`)
  })

  await db.query(
    `INSERT INTO booking_nailoptions (booking_id, nailoption_id) VALUES ${values.join(', ')}`,
    params
  )
}

async function validateOptionIds(db, shopId, optionIds, bookingDate) {
  if (!optionIds.length) return true
  const placeholders = optionIds.map((_, idx) => `$${idx + 2}`).join(', ')
  const dateParam = bookingDate ? optionIds.length + 2 : null
  const dateFilter = bookingDate ? optionDateFilter(bookingDate, dateParam) : ''
  const params = bookingDate ? [shopId, ...optionIds, bookingDate] : [shopId, ...optionIds]
  const result = await db.query(
    `SELECT id FROM nailoption
     WHERE shop_id = $1 AND is_active = true AND id IN (${placeholders}) ${dateFilter}`,
    params
  )
  return result.rows.length === optionIds.length
}

async function validateRequiredOptions(db, shopId, optionIds, bookingDate) {
  const params = bookingDate ? [shopId, bookingDate] : [shopId]
  const dateFilter = bookingDate ? optionDateFilter(bookingDate, 2) : ''
  const result = await db.query(
    `
      SELECT id, option_name
      FROM nailoption
      WHERE shop_id = $1
        AND is_active = true
        AND is_required = true
        ${dateFilter}
    `,
    params
  )
  const selected = new Set(optionIds.map(String))
  const missing = result.rows.filter((row) => !selected.has(String(row.id)))
  if (!missing.length) return null
  return `กรุณาเลือกบริการที่จำเป็น: ${missing.map((row) => row.option_name).join(', ')}`
}

function normalizeOptionIds(raw) {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map((id) => String(id).trim()).filter(Boolean))]
}

async function sumOptionDurationMinutes(db, shopId, optionIds) {
  if (!optionIds?.length) return 0
  const placeholders = optionIds.map((_, idx) => `$${idx + 2}`).join(', ')
  const result = await db.query(
    `
      SELECT COALESCE(SUM(duration_min), 0)::int AS total
      FROM nailoption
      WHERE shop_id = $1
        AND is_active = true
        AND id IN (${placeholders})
    `,
    [shopId, ...optionIds]
  )
  return Number(result.rows[0]?.total) || 0
}

module.exports = {
  syncBookingOptions,
  validateOptionIds,
  validateRequiredOptions,
  normalizeOptionIds,
  sumOptionDurationMinutes,
}
