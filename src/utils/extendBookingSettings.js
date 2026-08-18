const { getShopSettings } = require('./shopSettings')

function isExtendByServicesEnabled(map = {}) {
  return map.extend_booking_by_services === 'true'
}

function isExtendPastCloseEnabled(map = {}) {
  return map.extend_booking_past_close === 'true'
}

async function getExtendByServicesSetting(poolOrClient, shopId) {
  const map = await getShopSettings(poolOrClient, shopId, ['extend_booking_by_services'])
  return isExtendByServicesEnabled(map)
}

async function getExtendPastCloseSetting(poolOrClient, shopId) {
  const map = await getShopSettings(poolOrClient, shopId, ['extend_booking_past_close'])
  return isExtendPastCloseEnabled(map)
}

async function getExtendBookingSettings(poolOrClient, shopId) {
  const map = await getShopSettings(poolOrClient, shopId, [
    'extend_booking_by_services',
    'extend_booking_past_close',
  ])
  return {
    enabled: isExtendByServicesEnabled(map),
    pastCloseEnabled: isExtendPastCloseEnabled(map),
  }
}

module.exports = {
  isExtendByServicesEnabled,
  isExtendPastCloseEnabled,
  getExtendByServicesSetting,
  getExtendPastCloseSetting,
  getExtendBookingSettings,
}
