const USAGE_PRESET_DAYS = [10, 15, 30]

function parseUsageLimitDays(value) {
  if (value == null || value === '') return null
  const days = Number(value)
  if (!Number.isFinite(days) || days <= 0) return null
  return Math.min(Math.floor(days), 3650)
}

function getUsageStartedAt(shop) {
  return shop.usage_started_at || shop.created_at || null
}

function getUsageExpiresAt(shop) {
  const limitDays = parseUsageLimitDays(shop.usage_limit_days)
  if (!limitDays) return null
  const startedAt = getUsageStartedAt(shop)
  if (!startedAt) return null
  const expires = new Date(startedAt)
  expires.setDate(expires.getDate() + limitDays)
  return expires
}

function isShopUsageExpired(shop) {
  if (!shop || shop.slug === 'default') return false
  const expires = getUsageExpiresAt(shop)
  if (!expires) return false
  return Date.now() >= expires.getTime()
}

function getUsageDaysRemaining(shop) {
  const expires = getUsageExpiresAt(shop)
  if (!expires) return null
  const ms = expires.getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86400000))
}

function enrichShopUsage(shop) {
  if (!shop) return shop
  const usage_limit_days = parseUsageLimitDays(shop.usage_limit_days)
  const usage_started_at = getUsageStartedAt(shop)
  const expires = getUsageExpiresAt(shop)
  const usage_expired = isShopUsageExpired(shop)
  const usage_days_remaining = usage_limit_days ? getUsageDaysRemaining(shop) : null

  return {
    ...shop,
    usage_limit_days,
    usage_started_at,
    usage_expires_at: expires ? expires.toISOString() : null,
    usage_expired,
    usage_days_remaining,
  }
}

module.exports = {
  USAGE_PRESET_DAYS,
  parseUsageLimitDays,
  getUsageStartedAt,
  getUsageExpiresAt,
  isShopUsageExpired,
  getUsageDaysRemaining,
  enrichShopUsage,
}
