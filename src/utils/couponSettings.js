const { getShopSettings, setShopSettings } = require('./shopSettings')

const DEFAULT_DISCOUNT = 20
const DEFAULT_REQUIRED_POINTS = 100

async function getCouponSettings(poolOrClient, shopId) {
  const map = await getShopSettings(poolOrClient, shopId, [
    'coupon_discount_percent',
    'coupon_required_points',
  ])
  let discountPercent = Number(map.coupon_discount_percent)
  let requiredPoints = Number(map.coupon_required_points)
  if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
    discountPercent = DEFAULT_DISCOUNT
  }
  if (!Number.isInteger(requiredPoints) || requiredPoints < 1) {
    requiredPoints = DEFAULT_REQUIRED_POINTS
  }
  return { discountPercent, requiredPoints }
}

async function setCouponSettings(poolOrClient, shopId, { discountPercent, requiredPoints }) {
  await setShopSettings(poolOrClient, shopId, {
    coupon_discount_percent: discountPercent,
    coupon_required_points: requiredPoints,
  })
  return getCouponSettings(poolOrClient, shopId)
}

module.exports = {
  DEFAULT_DISCOUNT,
  DEFAULT_REQUIRED_POINTS,
  getCouponSettings,
  setCouponSettings,
}
