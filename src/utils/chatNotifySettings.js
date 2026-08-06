const { getShopSettings, setShopSettings } = require('./shopSettings')

const SETTING_KEYS = [
  'chat_notify_new_booking_enabled',
  'chat_notify_upcoming_admin_enabled',
  'chat_notify_upcoming_customer_enabled',
  'chat_notify_upcoming_minutes',
  'chat_notify_cancel_admin_enabled',
  'chat_notify_cancel_customer_enabled',
  'chat_notify_paid_admin_enabled',
  'chat_notify_paid_customer_enabled',
  'chat_notify_new_booking_template',
  'chat_notify_upcoming_admin_template',
  'chat_notify_upcoming_customer_template',
  'chat_notify_cancel_admin_template',
  'chat_notify_cancel_customer_template',
  'chat_notify_paid_admin_template',
  'chat_notify_paid_customer_template',
]

const DEFAULT_NEW_BOOKING_TEMPLATE = `🔔 มีคิวจองใหม่ ({shop})
👤 {customer}
📅 {date} · {start}–{end}
💅 {services}
📋 สถานะ: {status}
🆔 {bookingId}`

const DEFAULT_UPCOMING_ADMIN_TEMPLATE = `⏰ มีคิวใน {minutesUntil} นาที ({shop})
👤 {customer}
📅 {date} · {start}–{end}
💅 {services}
📋 สถานะ: {status}`

const DEFAULT_UPCOMING_CUSTOMER_TEMPLATE = `⏰ อีก {minutesUntil} นาทีถึงคิวของคุณ
📅 {date} · {start}–{end}
💅 {services}
📍 {shop}`

const DEFAULT_CANCEL_ADMIN_TEMPLATE = `❌ คิวถูกยกเลิก ({shop})
👤 {customer}
📅 {date} · {start}–{end}
💅 {services}
🆔 {bookingId}`

const DEFAULT_CANCEL_CUSTOMER_TEMPLATE = `❌ คิวของคุณถูกยกเลิก
📅 {date} · {start}–{end}
💅 {services}
📍 {shop}`

const DEFAULT_PAID_ADMIN_TEMPLATE = `✅ ชำระเงินแล้ว ({shop})
👤 {customer}
📅 {date} · {start}–{end}
💅 {services}
📋 สถานะ: {status}
🆔 {bookingId}`

const DEFAULT_PAID_CUSTOMER_TEMPLATE = `✅ ชำระเงินแล้ว คิวพร้อมให้บริการ
📅 {date} · {start}–{end}
💅 {services}
📍 {shop}`

function parseEnabled(value, defaultTrue = true) {
  if (value == null || value === '') return defaultTrue
  return value !== 'false'
}

function parseMinutes(value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) return 30
  if (n > 24 * 60) return 24 * 60
  return n
}

async function getChatNotifySettings(poolOrClient, shopId) {
  const map = await getShopSettings(poolOrClient, shopId, SETTING_KEYS)
  return {
    newBookingEnabled: parseEnabled(map.chat_notify_new_booking_enabled),
    upcomingAdminEnabled: parseEnabled(map.chat_notify_upcoming_admin_enabled),
    upcomingCustomerEnabled: parseEnabled(map.chat_notify_upcoming_customer_enabled),
    upcomingMinutes: parseMinutes(map.chat_notify_upcoming_minutes),
    cancelAdminEnabled: parseEnabled(map.chat_notify_cancel_admin_enabled),
    cancelCustomerEnabled: parseEnabled(map.chat_notify_cancel_customer_enabled),
    paidAdminEnabled: parseEnabled(map.chat_notify_paid_admin_enabled, false),
    paidCustomerEnabled: parseEnabled(map.chat_notify_paid_customer_enabled),
    newBookingTemplate: map.chat_notify_new_booking_template || DEFAULT_NEW_BOOKING_TEMPLATE,
    upcomingAdminTemplate: map.chat_notify_upcoming_admin_template || DEFAULT_UPCOMING_ADMIN_TEMPLATE,
    upcomingCustomerTemplate: map.chat_notify_upcoming_customer_template || DEFAULT_UPCOMING_CUSTOMER_TEMPLATE,
    cancelAdminTemplate: map.chat_notify_cancel_admin_template || DEFAULT_CANCEL_ADMIN_TEMPLATE,
    cancelCustomerTemplate: map.chat_notify_cancel_customer_template || DEFAULT_CANCEL_CUSTOMER_TEMPLATE,
    paidAdminTemplate: map.chat_notify_paid_admin_template || DEFAULT_PAID_ADMIN_TEMPLATE,
    paidCustomerTemplate: map.chat_notify_paid_customer_template || DEFAULT_PAID_CUSTOMER_TEMPLATE,
  }
}

async function setChatNotifySettings(poolOrClient, shopId, partial) {
  const entries = {}
  if (typeof partial.newBookingEnabled === 'boolean') {
    entries.chat_notify_new_booking_enabled = partial.newBookingEnabled ? 'true' : 'false'
  }
  if (typeof partial.upcomingAdminEnabled === 'boolean') {
    entries.chat_notify_upcoming_admin_enabled = partial.upcomingAdminEnabled ? 'true' : 'false'
  }
  if (typeof partial.upcomingCustomerEnabled === 'boolean') {
    entries.chat_notify_upcoming_customer_enabled = partial.upcomingCustomerEnabled ? 'true' : 'false'
  }
  if (partial.upcomingMinutes != null) {
    entries.chat_notify_upcoming_minutes = String(parseMinutes(partial.upcomingMinutes))
  }
  if (typeof partial.cancelAdminEnabled === 'boolean') {
    entries.chat_notify_cancel_admin_enabled = partial.cancelAdminEnabled ? 'true' : 'false'
  }
  if (typeof partial.cancelCustomerEnabled === 'boolean') {
    entries.chat_notify_cancel_customer_enabled = partial.cancelCustomerEnabled ? 'true' : 'false'
  }
  if (typeof partial.paidAdminEnabled === 'boolean') {
    entries.chat_notify_paid_admin_enabled = partial.paidAdminEnabled ? 'true' : 'false'
  }
  if (typeof partial.paidCustomerEnabled === 'boolean') {
    entries.chat_notify_paid_customer_enabled = partial.paidCustomerEnabled ? 'true' : 'false'
  }
  if (partial.newBookingTemplate != null) {
    entries.chat_notify_new_booking_template = String(partial.newBookingTemplate)
  }
  if (partial.upcomingAdminTemplate != null) {
    entries.chat_notify_upcoming_admin_template = String(partial.upcomingAdminTemplate)
  }
  if (partial.upcomingCustomerTemplate != null) {
    entries.chat_notify_upcoming_customer_template = String(partial.upcomingCustomerTemplate)
  }
  if (partial.cancelAdminTemplate != null) {
    entries.chat_notify_cancel_admin_template = String(partial.cancelAdminTemplate)
  }
  if (partial.cancelCustomerTemplate != null) {
    entries.chat_notify_cancel_customer_template = String(partial.cancelCustomerTemplate)
  }
  if (partial.paidAdminTemplate != null) {
    entries.chat_notify_paid_admin_template = String(partial.paidAdminTemplate)
  }
  if (partial.paidCustomerTemplate != null) {
    entries.chat_notify_paid_customer_template = String(partial.paidCustomerTemplate)
  }
  if (Object.keys(entries).length) {
    await setShopSettings(poolOrClient, shopId, entries)
  }
  return getChatNotifySettings(poolOrClient, shopId)
}

module.exports = {
  SETTING_KEYS,
  DEFAULT_NEW_BOOKING_TEMPLATE,
  DEFAULT_UPCOMING_ADMIN_TEMPLATE,
  DEFAULT_UPCOMING_CUSTOMER_TEMPLATE,
  DEFAULT_CANCEL_ADMIN_TEMPLATE,
  DEFAULT_CANCEL_CUSTOMER_TEMPLATE,
  DEFAULT_PAID_ADMIN_TEMPLATE,
  DEFAULT_PAID_CUSTOMER_TEMPLATE,
  getChatNotifySettings,
  setChatNotifySettings,
}
