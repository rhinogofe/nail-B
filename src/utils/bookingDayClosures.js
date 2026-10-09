function closureErrorFromRows(rows, staffId) {
  if (!rows?.length) return null
  if (rows.some((row) => !row.staff_id)) return 'วันนี้ร้านไม่รับคิว'
  if (staffId && rows.some((row) => String(row.staff_id) === String(staffId))) {
    return 'ช่างคนนี้ไม่รับคิววันนี้'
  }
  return null
}

async function getDayClosureRows(poolOrClient, shopId, date, staffId = null) {
  const result = await poolOrClient.query(
    `
      SELECT staff_id
      FROM booking_day_closures
      WHERE shop_id = $1
        AND schedule_date = $2
        AND (
          staff_id IS NULL
          OR staff_id = $3
        )
    `,
    [shopId, date, staffId || null]
  )
  return result.rows
}

async function getDayClosureError(poolOrClient, shopId, date, staffId = null) {
  const rows = await getDayClosureRows(poolOrClient, shopId, date, staffId)
  return closureErrorFromRows(rows, staffId)
}

async function getDayClosureStatus(poolOrClient, shopId, date, staffId = null) {
  const rows = await getDayClosureRows(poolOrClient, shopId, date, staffId)
  const shopClosed = rows.some((row) => !row.staff_id)
  const staffClosed = Boolean(
    staffId && rows.some((row) => row.staff_id && String(row.staff_id) === String(staffId))
  )
  return {
    closed: shopClosed || staffClosed,
    shop_closed: shopClosed,
    staff_closed: staffClosed,
  }
}

function monthRange(monthYm) {
  const [y, m] = String(monthYm || '').split('-').map(Number)
  if (!y || !m) return null
  const fromDate = new Date(y, m - 1, 1)
  const toDate = new Date(y, m, 0)
  const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`
  const to = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`
  return { from, to }
}

async function listDayClosuresForMonth(poolOrClient, shopId, monthYm, staffId = null) {
  const range = monthRange(monthYm)
  if (!range) return []
  const result = await poolOrClient.query(
    `
      SELECT id, schedule_date, staff_id
      FROM booking_day_closures
      WHERE shop_id = $1
        AND schedule_date BETWEEN $2 AND $3
        AND (
          staff_id IS NULL
          OR staff_id = $4
        )
      ORDER BY schedule_date ASC
    `,
    [shopId, range.from, range.to, staffId || null]
  )
  return result.rows
}

async function setDayClosure(poolOrClient, shopId, date, staffId, closed) {
  if (closed) {
    await poolOrClient.query(
      `
        INSERT INTO booking_day_closures (shop_id, schedule_date, staff_id)
        SELECT $1, $2, $3
        WHERE NOT EXISTS (
          SELECT 1 FROM booking_day_closures
          WHERE shop_id = $1
            AND schedule_date = $2
            AND staff_id IS NOT DISTINCT FROM $3
        )
      `,
      [shopId, date, staffId]
    )
    return
  }
  await poolOrClient.query(
    `
      DELETE FROM booking_day_closures
      WHERE shop_id = $1
        AND schedule_date = $2
        AND staff_id IS NOT DISTINCT FROM $3
    `,
    [shopId, date, staffId]
  )
}

module.exports = {
  getDayClosureError,
  getDayClosureStatus,
  listDayClosuresForMonth,
  setDayClosure,
}
