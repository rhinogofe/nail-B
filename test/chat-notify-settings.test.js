const test = require('node:test')
const assert = require('node:assert/strict')
const {
  SETTING_KEYS,
  DEFAULT_SLIP_ADMIN_TEMPLATE,
} = require('../src/utils/chatNotifySettings')

test('chat notify settings include slip admin keys', () => {
  assert.ok(SETTING_KEYS.includes('chat_notify_slip_admin_enabled'))
  assert.ok(SETTING_KEYS.includes('chat_notify_slip_admin_template'))
})

test('default slip admin template mentions slip review', () => {
  assert.match(DEFAULT_SLIP_ADMIN_TEMPLATE, /สลิป/)
  assert.match(DEFAULT_SLIP_ADMIN_TEMPLATE, /\{bookingId\}/)
})
