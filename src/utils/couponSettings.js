const { getShopSettings, setShopSettings } = require('./shopSettings')

const DEFAULT_DISCOUNT = 20
const DEFAULT_REQUIRED_POINTS = 100
const DEFAULT_COMPLETION_POINTS = 10

async function getCouponSettings(poolOrClient, shopId) {
  const map = await getShopSettings(poolOrClient, shopId, [
    'coupon_discount_percent',
    'coupon_required_points',
    'coupon_completion_points',
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
  return { discountPercent, requiredPoints, completionPoints }
}

async function setCouponSettings(poolOrClient, shopId, { discountPercent, requiredPoints, completionPoints }) {
  const payload = {
    coupon_discount_percent: discountPercent,
    coupon_required_points: requiredPoints,
  }
  if (completionPoints != null) {
    payload.coupon_completion_points = completionPoints
  }
  await setShopSettings(poolOrClient, shopId, payload)
  return getCouponSettings(poolOrClient, shopId)
}

async function awardCompletionPoints(client, shopId, userId, bookingId) {
  const { completionPoints } = await getCouponSettings(client, shopId)
  if (completionPoints <= 0) return 0
  await client.query(
    `INSERT INTO point_logs (user_id, booking_id, points) VALUES ($1, $2, $3)`,
    [userId, bookingId, completionPoints]
  )
  await client.query(
    `UPDATE users SET total_points = total_points + $1 WHERE id = $2`,
    [completionPoints, userId]
  )
  return completionPoints
}

module.exports = {
  DEFAULT_DISCOUNT,
  DEFAULT_REQUIRED_POINTS,
  DEFAULT_COMPLETION_POINTS,
  getCouponSettings,
  setCouponSettings,
  awardCompletionPoints,
}
