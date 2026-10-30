const router = require('express').Router()
const auth = require('../middleware/authMiddleware')
const admin = require('../middleware/adminMiddleware')
const { getPool } = require('../db/pool')
const { isSuperAdmin, demoteOrphanShopAdmins } = require('../utils/shopAdmins')
const { collectShopFileRefs, purgeShopUploadFiles } = require('../utils/deleteShopFiles')
const { createShopRecord } = require('../utils/createShopRecord')
const { listShopPresets, getShopPreset } = require('../utils/shopPresets')
const { isShopSlugFormat, normalizeShopSlugParam, slugifyShopName, isCreatableShopSlug } = require('../utils/shopSlug')
const { getUiSettings, UI_DEFAULTS } = require('../utils/shopUiSettings')
const { enrichShopUsage, parseUsageLimitDays } = require('../utils/shopUsageLimit')
const {
  parseIconSize,
  renderShopIconPng,
  buildShopBranding,
} = require('../utils/shopIcon')
const { resolvePublicApiBase } = require('../utils/publicApiBase')
const { getBookingSiteContent } = require('../utils/bookingSite')
const { isShopFeatureOn } = require('../utils/shopFeatureFlags')
const { isAllowedFolder, isAllowedFilename, readFolderImage, mimeForFilename } = require('../utils/bookingSiteImages')

const SHOP_RETURN = 'id, slug, name, is_active, created_at, usage_limit_days, usage_started_at'

function frontendBaseUrl() {
  return String(process.env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '')
}

function apiBaseUrl(req) {
  return resolvePublicApiBase(req)
}

function buildShareImage(req, slug, ui) {
  const logo = String(ui.ui_logo_url || '').trim()
  if (!logo) return ''
  if (/^https?:\/\//i.test(logo)) return logo
  const path = logo.startsWith('/') ? logo : `/${logo}`
  return `${apiBaseUrl(req)}${path}?shop=${encodeURIComponent(slug)}`
}

async function requireSuperAdminUser(req, res, next) {
  try {
    const pool = getPool()
    const ok = await isSuperAdmin(pool, req.user.id)
    if (!ok) {
      return res.status(403).json({ error: 'เฉพาะแอดมินหลัก (default) เท่านั้นที่จัดการสาขาได้' })
    }
    next()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

router.get('/presets', (_req, res) => {
  res.json({ presets: listShopPresets() })
})

router.get('/', async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT ${SHOP_RETURN}
       FROM shops
       WHERE is_active = true
       ORDER BY name ASC`
    )
    const shops = result.rows
      .map(enrichShopUsage)
      .filter((shop) => !shop.usage_expired)
    res.json(shops)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:slug/share-preview', async (req, res) => {
  const slug = normalizeShopSlugParam(req.params.slug)
  if (!isShopSlugFormat(slug)) {
    return res.status(400).json({ error: 'slug ไม่ถูกต้อง' })
  }

  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT id, slug, name, is_active FROM shops WHERE slug = $1 LIMIT 1`,
      [slug]
    )
    const shop = result.rows[0]
    if (!shop || !shop.is_active) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }

    const ui = await getUiSettings(pool, shop.id)
    const pageTitle = String(ui.ui_page_title || '').trim()
    const title = pageTitle && pageTitle !== UI_DEFAULTS.ui_page_title ? pageTitle : shop.name
    const description = String(ui.ui_tagline || '').trim() || `จองคิว ${shop.name}`
    const image = buildShareImage(req, slug, ui)
    const siteBase = frontendBaseUrl()
    const url = siteBase ? `${siteBase}/${slug}/bookings` : `/${slug}/bookings`

    res.set('Cache-Control', 'public, max-age=300')
    res.json({ title, description, image, url })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:slug/branding', async (req, res) => {
  const slug = normalizeShopSlugParam(req.params.slug)
  if (!isShopSlugFormat(slug)) {
    return res.status(400).json({ error: 'slug ไม่ถูกต้อง' })
  }

  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT id, slug, name FROM shops WHERE slug = $1 LIMIT 1`,
      [slug],
    )
    const shop = result.rows[0]
    if (!shop) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }

    const ui = await getUiSettings(pool, shop.id)
    res.set('Cache-Control', 'public, max-age=300')
    res.json(buildShopBranding(req, shop, ui))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:slug/icon/:size.png', async (req, res) => {
  const slug = normalizeShopSlugParam(req.params.slug)
  const size = parseIconSize(req.params.size)
  if (!isShopSlugFormat(slug)) {
    return res.status(400).json({ error: 'slug ไม่ถูกต้อง' })
  }
  if (!size) {
    return res.status(400).json({ error: 'ขนาดไอคอนไม่รองรับ' })
  }

  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT id, slug, name FROM shops WHERE slug = $1 LIMIT 1`,
      [slug],
    )
    const shop = result.rows[0]
    if (!shop) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }

    const ui = await getUiSettings(pool, shop.id)
    const png = await renderShopIconPng({
      shopId: shop.id,
      shopName: shop.name,
      ui,
      size,
    })

    res.set('Content-Type', 'image/png')
    res.set('Cache-Control', 'public, max-age=86400')
    res.send(png)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:slug/booking-site', async (req, res) => {
  const slug = normalizeShopSlugParam(req.params.slug)
  if (!isShopSlugFormat(slug)) {
    return res.status(400).json({ error: 'slug ไม่ถูกต้อง' })
  }
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT ${SHOP_RETURN} FROM shops WHERE slug = $1 AND is_active = true LIMIT 1`,
      [slug]
    )
    const shop = enrichShopUsage(result.rows[0])
    if (!shop) return res.status(404).json({ error: 'ไม่พบร้าน' })
    if (shop.usage_expired) {
      return res.status(403).json({
        error: 'สาขานี้หมดระยะเวลาใช้งานแล้ว กรุณาติดต่อผู้ดูแลระบบ',
        code: 'SHOP_USAGE_EXPIRED',
      })
    }
    if (!(await isShopFeatureOn(pool, shop.id, 'feat_booking_site'))) {
      return res.status(403).json({ error: 'สาขานี้ปิดเว็บไซต์ไว้', code: 'BOOKING_SITE_DISABLED' })
    }
    const content = await getBookingSiteContent(pool, shop)
    let location = null
    try {
      const ui = await getUiSettings(pool, shop.id)
      location = {
        mapUrl: String(ui.ui_shop_map_url || '').trim(),
        embedUrl: String(ui.ui_shop_map_embed_url || '').trim(),
        addressDetail: String(ui.ui_shop_address_detail || '').trim(),
        openMapsLabel: String(ui.ui_shop_open_maps_btn || '').trim(),
      }
    } catch (err) {
      console.warn('[booking-site] location', err.message)
    }
    res.set('Cache-Control', 'private, no-store')
    res.json({ ...content, location })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:slug/booking-site/images/:folder/:filename', async (req, res) => {
  const slug = normalizeShopSlugParam(req.params.slug)
  const folder = String(req.params.folder || '')
  const filename = String(req.params.filename || '')
  if (!isShopSlugFormat(slug) || !isAllowedFolder(folder) || !isAllowedFilename(filename)) {
    return res.status(404).json({ error: 'ไม่พบรูป' })
  }
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT id, slug, is_active FROM shops WHERE slug = $1 LIMIT 1`,
      [slug]
    )
    const shop = result.rows[0]
    if (!shop || !shop.is_active) return res.status(404).json({ error: 'ไม่พบรูป' })
    if (!(await isShopFeatureOn(pool, shop.id, 'feat_booking_site'))) {
      return res.status(404).json({ error: 'ไม่พบรูป' })
    }
    const buffer = await readFolderImage(shop.id, folder, filename)
    if (!buffer) return res.status(404).json({ error: 'ไม่พบรูป' })
    res.set('Cache-Control', 'public, max-age=86400')
    res.type(mimeForFilename(filename))
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:slug', async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT ${SHOP_RETURN}
       FROM shops
       WHERE slug = $1 AND is_active = true
       LIMIT 1`,
      [normalizeShopSlugParam(req.params.slug)]
    )
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }
    res.json(enrichShopUsage(result.rows[0]))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', auth, admin, requireSuperAdminUser, async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const slug = slugifyShopName(req.body?.slug || req.body?.name || '')

  if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อร้าน' })
  if (!slug || !isShopSlugFormat(slug)) {
    return res.status(400).json({ error: 'slug ใช้ได้เฉพาะตัวอักษร ตัวเลข และ -' })
  }
  if (!isCreatableShopSlug(slug)) {
    return res.status(400).json({ error: 'ไม่สามารถใช้ slug นี้ได้' })
  }

  const usageLimitDays = parseUsageLimitDays(req.body?.usage_limit_days)
  const presetKey = String(req.body?.preset || '').trim().toLowerCase()
  if (presetKey && !getShopPreset(presetKey)) {
    return res.status(400).json({ error: 'ไม่พบเทมเพลตร้านนี้' })
  }

  try {
    const pool = getPool()
    const client = await pool.connect()
    let shop
    try {
      await client.query('BEGIN')
      shop = await createShopRecord(client, {
        slug,
        name,
        usageLimitDays,
        presetKey: presetKey || null,
      })
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    res.status(201).json({ success: true, shop: enrichShopUsage(shop) })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'slug นี้ถูกใช้แล้ว' })
    }
    if (err.status) return res.status(err.status).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

router.patch('/:slug', auth, admin, requireSuperAdminUser, async (req, res) => {
  const slug = normalizeShopSlugParam(req.params.slug)
  const name = req.body?.name != null ? String(req.body.name).trim() : null
  const isActive = req.body?.is_active
  const hasUsageLimit = Object.prototype.hasOwnProperty.call(req.body || {}, 'usage_limit_days')
  const usageLimitDays = hasUsageLimit ? parseUsageLimitDays(req.body.usage_limit_days) : undefined
  const resetUsagePeriod = req.body?.reset_usage_period === true

  if (name === '') return res.status(400).json({ error: 'ชื่อร้านไม่ถูกต้อง' })

  try {
    const pool = getPool()
    const fields = []
    const params = []

    if (name) {
      params.push(name)
      fields.push(`name = $${params.length}`)
    }
    if (typeof isActive === 'boolean') {
      params.push(isActive)
      fields.push(`is_active = $${params.length}`)
    }
    if (hasUsageLimit) {
      params.push(usageLimitDays)
      fields.push(`usage_limit_days = $${params.length}`)
      if (usageLimitDays != null) {
        fields.push('usage_started_at = NOW()')
      } else {
        fields.push('usage_started_at = NULL')
      }
    } else if (resetUsagePeriod) {
      fields.push('usage_started_at = NOW()')
    }
    if (!fields.length) {
      return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' })
    }

    params.push(slug)
    const result = await pool.query(
      `UPDATE shops SET ${fields.join(', ')}
       WHERE slug = $${params.length}
       RETURNING ${SHOP_RETURN}`,
      params
    )
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }
    res.json({ success: true, shop: enrichShopUsage(result.rows[0]) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:slug', auth, admin, requireSuperAdminUser, async (req, res) => {
  const slug = normalizeShopSlugParam(req.params.slug)
  if (slug === 'default') {
    return res.status(400).json({ error: 'ไม่สามารถลบร้าน default ได้' })
  }

  const force =
    req.query.force === 'true' ||
    req.query.force === '1' ||
    req.body?.force === true

  try {
    const pool = getPool()
    const existing = await pool.query(
      `SELECT id, slug, name, is_active FROM shops WHERE slug = $1 LIMIT 1`,
      [slug]
    )
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }

    const shopId = existing.rows[0].id
    const bookingCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM bookings WHERE shop_id = $1`,
      [shopId]
    )
    const bookingsTotal = bookingCount.rows[0]?.count || 0

    if (bookingsTotal > 0 && !force) {
      const result = await pool.query(
        `UPDATE shops SET is_active = false WHERE slug = $1
         RETURNING id, slug, name, is_active, created_at`,
        [slug]
      )
      return res.json({
        success: true,
        soft_deleted: true,
        message: 'ร้านมีข้อมูลการจอง — ปิดใช้งานแทนการลบถาวร (ส่ง ?force=true เพื่อลบถาวร)',
        shop: result.rows[0],
        booking_count: bookingsTotal,
      })
    }

    const client = await pool.connect()
    let fileRefs = null
    try {
      await client.query('BEGIN')
      fileRefs = await collectShopFileRefs(client, shopId)

      const branchAdmins = await client.query(
        `SELECT user_id FROM shop_admins WHERE shop_id = $1`,
        [shopId],
      )
      const branchAdminIds = branchAdmins.rows.map((row) => row.user_id)

      if (bookingsTotal > 0) {
        await client.query(
          `DELETE FROM point_logs
           WHERE booking_id IN (SELECT id FROM bookings WHERE shop_id = $1)`,
          [shopId]
        )
      }
      const deleted = await client.query(
        `DELETE FROM shops WHERE id = $1 RETURNING slug, name`,
        [shopId]
      )
      if (!deleted.rows[0]) {
        await client.query('ROLLBACK')
        fileRefs = null
        return res.status(404).json({ error: 'ไม่พบร้าน' })
      }

      const demotedAdminIds = await demoteOrphanShopAdmins(client, branchAdminIds)

      await client.query('COMMIT')

      let fileCleanup = null
      if (fileRefs) {
        try {
          fileCleanup = await purgeShopUploadFiles(fileRefs)
        } catch (err) {
          fileCleanup = { errors: [{ type: 'purge', error: err.message }] }
        }
      }

      res.json({
        success: true,
        soft_deleted: false,
        permanent: true,
        slug: deleted.rows[0].slug,
        name: deleted.rows[0].name,
        booking_count: bookingsTotal,
        demoted_admin_count: demotedAdminIds.length,
        file_cleanup: fileCleanup,
        message:
          bookingsTotal > 0
            ? `ลบสาขา ${deleted.rows[0].name} และข้อมูลจอง ${bookingsTotal} รายการถาวรแล้ว`
            : `ลบสาขา ${deleted.rows[0].name} ถาวรแล้ว`,
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
