const { getPool } = require('../db/pool')
const { canManageShop, isSuperAdmin } = require('../utils/shopAdmins')

module.exports = async function shopAdminAccess(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์แอดมิน' })
  }
  if (!req.shop?.id) {
    return res.status(400).json({ error: 'ต้องระบุร้าน (X-Shop-Slug)' })
  }

  try {
    const pool = getPool()
    const allowed = await canManageShop(pool, req.user.id, req.shop.id)
    if (!allowed) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์จัดการร้านนี้' })
    }
    req.isSuperAdmin = await isSuperAdmin(pool, req.user.id)
    next()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
