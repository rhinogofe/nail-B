const { getShopSetting, setShopSetting } = require('./shopSettings')

const SETTING_KEY = 'shop_register_pin'

function normalizePin(raw) {
  return String(raw || '').replace(/\D/g, '').slice(0, 4)
}

function isValidPin(pin) {
  return /^\d{4}$/.test(String(pin || ''))
}

function normalizeRegisterPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '')
  if (digits.startsWith('66') && digits.length === 11) {
    digits = `0${digits.slice(2)}`
  }
  if (digits.length > 10) {
    digits = digits.slice(-10)
  }
  return digits
}

function isValidRegisterPhone(phone) {
  return /^0\d{9}$/.test(String(phone || ''))
}

async function isRegisterOwnerPhoneTaken(poolOrClient, phone) {
  const normalized = normalizeRegisterPhone(phone)
  if (!isValidRegisterPhone(normalized)) return false

  const result = await poolOrClient.query(
    `
      SELECT 1
      FROM users
      WHERE provider = 'phone'
        AND provider_id = $1
      LIMIT 1
    `,
    [normalized],
  )
  return result.rows.length > 0
}

async function getDefaultShopId(poolOrClient) {
  const result = await poolOrClient.query(
    `SELECT id FROM shops WHERE slug = 'default' LIMIT 1`
  )
  return result.rows[0]?.id || null
}

async function getRegisterShopPin(poolOrClient) {
  const shopId = await getDefaultShopId(poolOrClient)
  if (!shopId) return ''
  const value = await getShopSetting(poolOrClient, shopId, SETTING_KEY)
  return normalizePin(value)
}

async function isRegisterShopEnabled(poolOrClient) {
  const pin = await getRegisterShopPin(poolOrClient)
  return isValidPin(pin)
}

async function verifyRegisterShopPin(poolOrClient, input) {
  const pin = await getRegisterShopPin(poolOrClient)
  if (!isValidPin(pin)) {
    return { ok: false, error: 'ยังไม่เปิดรับสมัครร้าน กรุณาติดต่อผู้ดูแลระบบ' }
  }
  const attempt = normalizePin(input)
  if (!isValidPin(attempt)) {
    return { ok: false, error: 'กรุณากรอกรหัส 4 หลัก' }
  }
  if (attempt !== pin) {
    return { ok: false, error: 'รหัสไม่ถูกต้อง' }
  }
  return { ok: true }
}

async function setRegisterShopPin(poolOrClient, rawPin) {
  const pin = normalizePin(rawPin)
  const shopId = await getDefaultShopId(poolOrClient)
  if (!shopId) {
    const err = new Error('ไม่พบร้าน default')
    err.status = 500
    throw err
  }
  if (!pin) {
    await setShopSetting(poolOrClient, shopId, SETTING_KEY, '')
    return ''
  }
  if (!isValidPin(pin)) {
    const err = new Error('รหัสต้องเป็นตัวเลข 4 หลัก')
    err.status = 400
    throw err
  }
  await setShopSetting(poolOrClient, shopId, SETTING_KEY, pin)
  return pin
}

module.exports = {
  SETTING_KEY,
  normalizePin,
  isValidPin,
  normalizeRegisterPhone,
  isValidRegisterPhone,
  isRegisterOwnerPhoneTaken,
  getRegisterShopPin,
  isRegisterShopEnabled,
  verifyRegisterShopPin,
  setRegisterShopPin,
}
