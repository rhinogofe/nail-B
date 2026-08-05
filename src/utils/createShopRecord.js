const { ensureShopSettings } = require('./shopSettings')
const { ensureUiSettings, setUiSettings } = require('./shopUiSettings')
const { computeBookUntilDate, todayYmdBangkok } = require('./bookingWindow')

const DEFAULT_SETTINGS = {
  deposit_amount: '300',
  shop_open_hour: '9',
  shop_last_booking_hour: '18',
  book_advance_days: '30',
  booking_display_mode: 'normal',
  unpaid_auto_cancel_enabled: 'true',
  unpaid_expire_hours: '24',
  line_push_enabled: 'false',
  booking_slot_hours: '2',
  coupon_discount_percent: '20',
  coupon_required_points: '100',
  coupon_completion_points: '10',
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

async function createShopRecord(client, { slug, name, uiSettings = null, usageLimitDays = null }) {
  const shopSlug = String(slug || '').trim().toLowerCase()
  const shopName = String(name || '').trim()

  if (!shopName) {
    const err = new Error('ต้องระบุชื่อร้าน')
    err.status = 400
    throw err
  }
  if (!shopSlug || !SLUG_RE.test(shopSlug)) {
    const err = new Error('slug ใช้ได้เฉพาะ a-z, 0-9 และ -')
    err.status = 400
    throw err
  }
  if (shopSlug === 'default') {
    const err = new Error('ไม่สามารถใช้ slug นี้ได้')
    err.status = 400
    throw err
  }

  const limitDays = usageLimitDays != null && usageLimitDays !== ''
    ? Number(usageLimitDays)
    : null
  const parsedLimit = limitDays != null && Number.isFinite(limitDays) && limitDays > 0
    ? Math.min(Math.floor(limitDays), 3650)
    : null

  const created = await client.query(
    parsedLimit
      ? `INSERT INTO shops (slug, name, usage_limit_days, usage_started_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, slug, name, is_active, created_at, usage_limit_days, usage_started_at`
      : `INSERT INTO shops (slug, name) VALUES ($1, $2)
         RETURNING id, slug, name, is_active, created_at, usage_limit_days, usage_started_at`,
    parsedLimit ? [shopSlug, shopName, parsedLimit] : [shopSlug, shopName]
  )
  const shop = created.rows[0]

  await ensureShopSettings(client, shop.id, {
    ...DEFAULT_SETTINGS,
    book_until_date: computeBookUntilDate(30, todayYmdBangkok()),
  })
  await ensureUiSettings(client, shop.id)
  if (uiSettings && Object.keys(uiSettings).length) {
    await setUiSettings(client, shop.id, uiSettings)
  }

  await client.query(
    `INSERT INTO service_locations (shop_id, name, color, description, sort_order)
     VALUES
       ($1, 'จุฬา', '#3b82f6', 'สถานที่ให้บริการ จุฬา', 1),
       ($1, 'เกษตร', '#22c55e', 'สถานที่ให้บริการ เกษตร', 2)
     ON CONFLICT DO NOTHING`,
    [shop.id]
  )

  return shop
}

module.exports = {
  SLUG_RE,
  createShopRecord,
}
