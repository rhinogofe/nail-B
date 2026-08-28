const test = require('node:test')
const assert = require('node:assert/strict')
const {
  logoIconVersion,
  parseIconSize,
  shopIconPublicUrl,
} = require('../src/utils/shopIcon')

test('logoIconVersion uses filename for uploaded logos', () => {
  const version = logoIconVersion('/api/bookings/ui-images/logo/abc12345-uuid.png')
  assert.equal(version, 'abc12345-uui')
})

test('logoIconVersion is stable for external urls', () => {
  const a = logoIconVersion('https://cdn.example.com/logo.png')
  const b = logoIconVersion('https://cdn.example.com/logo.png')
  assert.equal(a, b)
  assert.notEqual(a, '0')
})

test('logoIconVersion returns 0 when logo missing', () => {
  assert.equal(logoIconVersion(''), '0')
  assert.equal(logoIconVersion(null), '0')
})

test('parseIconSize accepts supported sizes only', () => {
  assert.equal(parseIconSize('32'), 32)
  assert.equal(parseIconSize('180'), 180)
  assert.equal(parseIconSize('192'), 192)
  assert.equal(parseIconSize('512'), 512)
  assert.equal(parseIconSize('64'), null)
  assert.equal(parseIconSize('abc'), null)
})

test('shopIconPublicUrl includes cache-busting version', () => {
  const url = shopIconPublicUrl('https://api.example.com', 'namonstudio', 192, 'abc123')
  assert.equal(
    url,
    'https://api.example.com/api/shops/namonstudio/icon/192.png?v=abc123',
  )
})
