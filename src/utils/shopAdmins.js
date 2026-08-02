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
  syncShopAdminAssignment,
  attachAdminShopFields,
}
