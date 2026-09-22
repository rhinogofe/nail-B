const { getShopSettings, setShopSettings } = require('./shopSettings')

const DEFAULT_DEPOSIT_AMOUNT = 300

function parseFullPaymentEnabled(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function normalizeDepositAmount(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) return DEFAULT_DEPOSIT_AMOUNT
  return Math.round(amount)
}

async function getDepositSettings(poolOrClient, shopId) {
  const map = await getShopSettings(poolOrClient, shopId, [
    'deposit_amount',
    'deposit_full_payment_enabled',
  ])
  return {
    depositAmount: normalizeDepositAmount(map.deposit_amount),
    fullPaymentEnabled: parseFullPaymentEnabled(map.deposit_full_payment_enabled),
  }
}

async function setDepositSettings(poolOrClient, shopId, { depositAmount, fullPaymentEnabled }) {
  const payload = {}
  if (depositAmount != null) {
    payload.deposit_amount = normalizeDepositAmount(depositAmount)
  }
  if (fullPaymentEnabled != null) {
    payload.deposit_full_payment_enabled = fullPaymentEnabled ? 'true' : 'false'
  }
  if (Object.keys(payload).length) {
    await setShopSettings(poolOrClient, shopId, payload)
  }
  return getDepositSettings(poolOrClient, shopId)
}

async function sumBookingServicePrices(poolOrClient, shopId, bookingId) {
  const result = await poolOrClient.query(
    `
      SELECT COALESCE(SUM(n.price), 0) AS total
      FROM booking_nailoptions bn
      JOIN nailoption n ON n.id = bn.nailoption_id AND n.shop_id = $2
      WHERE bn.booking_id = $1
    `,
    [bookingId, shopId]
  )
  return Number(result.rows[0]?.total) || 0
}

async function resolveBookingPaymentAmount(poolOrClient, shopId, bookingId) {
  const settings = await getDepositSettings(poolOrClient, shopId)
  if (!settings.fullPaymentEnabled) {
    return {
      paymentAmount: settings.depositAmount,
      fullPaymentEnabled: false,
      serviceTotal: null,
    }
  }
  const serviceTotal = await sumBookingServicePrices(poolOrClient, shopId, bookingId)
  const rounded = Math.max(0, Math.round(serviceTotal))
  const paymentAmount = rounded > 0 ? rounded : settings.depositAmount
  return {
    paymentAmount,
    fullPaymentEnabled: true,
    serviceTotal: rounded,
  }
}

module.exports = {
  DEFAULT_DEPOSIT_AMOUNT,
  getDepositSettings,
  setDepositSettings,
  resolveBookingPaymentAmount,
}
