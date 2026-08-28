const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeRegisterPhone,
  isValidRegisterPhone,
} = require('../src/utils/registerShopPin')

test('normalizeRegisterPhone accepts Thai mobile formats', () => {
  assert.equal(normalizeRegisterPhone('081-234-5678'), '0812345678')
  assert.equal(normalizeRegisterPhone('66812345678'), '0812345678')
  assert.equal(isValidRegisterPhone('0812345678'), true)
  assert.equal(isValidRegisterPhone('081234567'), false)
})
