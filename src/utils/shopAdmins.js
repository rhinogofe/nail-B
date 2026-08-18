const { getPool } = require('../db/pool')

async function isSuperAdmin(poolOrClient, userId) {
  const result = await poolOrClient.query(
    `
      SELECT 1
      FROM shop_admins sa
      JOIN shops s ON s.id = sa.shop_id
      WHERE sa.user_id = $1 AND s.slug = 'default'
      LIMIT 1
    `,
    [userId]
  )
  return result.rows.length > 0
}

async function canManageShop(poolOrClient, userId, shopId) {
  if (await isSuperAdmin(poolOrClient, userId)) return true
  const result = await poolOrClient.query(
    `SELECT 1 FROM shop_admins WHERE user_id = $1 AND shop_id = $2 LIMIT 1`,
    [userId, shopId]
  )
  return result.rows.length > 0
}

async function getManagedShopSlugs(poolOrClient, userId) {
  if (await isSuperAdmin(poolOrClient, userId)) {
    const result = await poolOrClient.query(
      `SELECT slug FROM shops WHERE is_active = true ORDER BY name ASC`
    )
    return result.rows.map((row) => row.slug)
  }
  const result = await poolOrClient.query(
    `
      SELECT s.slug
      FROM shop_admins sa
      JOIN shops s ON s.id = sa.shop_id
      WHERE sa.user_id = $1 AND s.is_active = true
      ORDER BY s.name ASC
    `,
    [userId]
  )
  return result.rows.map((row) => row.slug)
}

async function getAdminShopInfo(poolOrClient, userId) {
  const superAdmin = await isSuperAdmin(poolOrClient, userId)
  const managedShopSlugs = await getManagedShopSlugs(poolOrClient, userId)
  if (superAdmin) {
    return {
      is_super_admin: true,
      admin_shop_slug: 'default',
      managed_shop_slugs: managedShopSlugs,
    }
  }
  const result = await poolOrClient.query(
    `
      SELECT s.slug
      FROM shop_admins sa
      JOIN shops s ON s.id = sa.shop_id
      WHERE sa.user_id = $1
      ORDER BY s.slug ASC
    `,
    [userId]
  )
  const slugs = result.rows.map((row) => row.slug)
  return {
    is_super_admin: false,
    admin_shop_slug: slugs[0] || null,
    managed_shop_slugs: slugs,
  }
}

async function syncShopAdminAssignment(client, userId, { isAdmin, adminShopSlug }) {
  await client.query(`DELETE FROM shop_admins WHERE user_id = $1`, [userId])
  if (!isAdmin) return

  const slug = String(adminShopSlug || 'default').trim().toLowerCase()
  const shopRes = await client.query(
    `SELECT id, slug FROM shops WHERE slug = $1 LIMIT 1`,
    [slug]
  )
  if (!shopRes.rows[0]) {
    const err = new Error('ไม่พบสาขาที่เลือก')
    err.status = 400
    throw err
  }

  await client.query(
    `INSERT INTO shop_admins (shop_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [shopRes.rows[0].id, userId]
  )
}

async function getUserAdminShopSlug(poolOrClient, userId) {
  const result = await poolOrClient.query(
    `
      SELECT s.slug
      FROM shop_admins sa
      JOIN shops s ON s.id = sa.shop_id
      WHERE sa.user_id = $1
      ORDER BY CASE WHEN s.slug = 'default' THEN 0 ELSE 1 END, s.slug
      LIMIT 1
    `,
    [userId]
  )
  return result.rows[0]?.slug || null
}

async function userHasBookingAtShop(poolOrClient, userId, shopId) {
  const result = await poolOrClient.query(
    `SELECT 1 FROM bookings WHERE user_id = $1 AND shop_id = $2 LIMIT 1`,
    [userId, shopId]
  )
  return result.rows.length > 0
}

async function resolveAdminAssignmentPermission(poolOrClient, req, targetUserId, { grant, adminShopSlug }) {
  const slugInput = adminShopSlug != null && adminShopSlug !== ''
    ? String(adminShopSlug).trim().toLowerCase()
    : null

  if (req.isSuperAdmin) {
    const slug = slugInput || 'default'
    return { ok: true, slug }
  }

  const reqShopSlug = req.shop?.slug
  if (!reqShopSlug || reqShopSlug === 'default') {
    return {
      ok: false,
      status: 403,
      error: 'แอดมินสาขาไม่สามารถจัดการสิทธิ์ที่สาขาหลักได้',
    }
  }

  if (await isSuperAdmin(poolOrClient, targetUserId)) {
    return { ok: false, status: 403, error: 'ไม่สามารถจัดการแอดมินหลักได้' }
  }

  const targetSlug = await getUserAdminShopSlug(poolOrClient, targetUserId)

  if (grant) {
    const slug = slugInput || reqShopSlug
    if (slug === 'default' || slug !== reqShopSlug) {
      return {
        ok: false,
        status: 403,
        error: 'ให้สิทธิ์แอดมินได้เฉพาะสาขาของคุณเท่านั้น',
      }
    }
    if (targetSlug && targetSlug !== reqShopSlug) {
      return {
        ok: false,
        status: 403,
        error: 'ผู้ใช้นี้เป็นแอดมินสาขาอื่นอยู่แล้ว',
      }
    }
    const hasBooking = await userHasBookingAtShop(poolOrClient, targetUserId, req.shop.id)
    if (!hasBooking && !targetSlug) {
      return {
        ok: false,
        status: 400,
        error: 'ให้สิทธิ์ได้เฉพาะลูกค้าที่เคยจองที่สาขานี้',
      }
    }
    return { ok: true, slug }
  }

  if (targetSlug && targetSlug !== reqShopSlug) {
    return {
      ok: false,
      status: 403,
      error: 'จัดการได้เฉพาะแอดมินสาขาของคุณเท่านั้น',
    }
  }

  return { ok: true, slug: reqShopSlug }
}

async function attachAdminShopFields(poolOrClient, userRow) {
  if (!userRow?.is_admin) {
    return {
      ...userRow,
      is_super_admin: false,
      admin_shop_slug: null,
      managed_shop_slugs: [],
    }
  }
  const info = await getAdminShopInfo(poolOrClient, userRow.id)
  return { ...userRow, ...info }
}

module.exports = {
  isSuperAdmin,
  canManageShop,
  getManagedShopSlugs,
  getAdminShopInfo,
  getUserAdminShopSlug,
  userHasBookingAtShop,
  resolveAdminAssignmentPermission,
  syncShopAdminAssignment,
  attachAdminShopFields,
}
