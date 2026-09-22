const { getShopSettings, setShopSettings } = require('./shopSettings')

const DEFAULT_DISCOUNT = 20
const DEFAULT_REQUIRED_POINTS = 100
const DEFAULT_COMPLETION_POINTS = 10

function parseManualCompletionPoints(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

async function getCouponSettings(poolOrClient, shopId) {
  const map = await getShopSettings(poolOrClient, shopId, [
    'coupon_discount_percent',
    'coupon_required_points',
    'coupon_completion_points',
    'coupon_manual_completion_points',
  ])
  let discountPercent = Number(map.coupon_discount_percent)
  let requiredPoints = Number(map.coupon_required_points)
  let completionPoints = Number(map.coupon_completion_points)
  if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
    discountPercent = DEFAULT_DISCOUNT
  }
  if (!Number.isInteger(requiredPoints) || requiredPoints < 1) {
    requiredPoints = DEFAULT_REQUIRED_POINTS
  }
  if (!Number.isInteger(completionPoints) || completionPoints < 0) {
    completionPoints = DEFAULT_COMPLETION_POINTS
  }
  const manualCompletionPoints = parseManualCompletionPoints(map.coupon_manual_completion_points)
  return { discountPercent, requiredPoints, completionPoints, manualCompletionPoints }
}

async function setCouponSettings(poolOrClient, shopId, {
  discountPercent,
  requiredPoints,
  completionPoints,
  manualCompletionPoints,
}) {
  const payload = {
    coupon_discount_percent: discountPercent,
    coupon_required_points: requiredPoints,
  }
  if (completionPoints != null) {
    payload.coupon_completion_points = completionPoints
  }
  if (manualCompletionPoints != null) {
    payload.coupon_manual_completion_points = manualCompletionPoints ? 'true' : 'false'
  }
  await setShopSettings(poolOrClient, shopId, payload)
  return getCouponSettings(poolOrClient, shopId)
}

async function awardCompletionPoints(client, shopId, userId, bookingId, completionPointsOverride = undefined) {
  const settings = await getCouponSettings(client, shopId)
  let points
  if (settings.manualCompletionPoints) {
    const override = Number(completionPointsOverride)
    if (!Number.isInteger(override) || override < 0) return 0
    points = override
  } else {
    points = settings.completionPoints
  }
  if (points <= 0) return 0
  await client.query(
    `INSERT INTO point_logs (user_id, booking_id, points) VALUES ($1, $2, $3)`,
    [userId, bookingId, points]
  )
  await client.query(
    `UPDATE users SET total_points = total_points + $1 WHERE id = $2`,
    [points, userId]
  )
  return points
}

module.exports = {
  DEFAULT_DISCOUNT,
  DEFAULT_REQUIRED_POINTS,
  DEFAULT_COMPLETION_POINTS,
  getCouponSettings,
  setCouponSettings,
  awardCompletionPoints,
}
