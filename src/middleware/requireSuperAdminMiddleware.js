module.exports = function requireSuperAdmin(req, res, next) {
  if (!req.isSuperAdmin) {
    return res.status(403).json({ error: 'เฉพาะแอดมินหลัก (default) เท่านั้น' })
  }
  next()
}
