const { getShopSettings, setShopSettings, ensureShopSettings } = require('./shopSettings')
const {
  enrichShopUsage,
  getUsageDaysRemaining,
  parseUsageLimitDays,
} = require('./shopUsageLimit')

const crypto = require('crypto')

const SETTING_KEYS = {
  promptpay: 'renewal_promptpay_id',
  description: 'renewal_description',
  prices: 'renewal_prices',
  options: 'renewal_options',
  priceNoLine: 'renewal_price_per_month_no_line',
  priceWithLine: 'renewal_price_per_month_with_line',
  bannerDaysBefore: 'renewal_banner_days_before',
}

const DEFAULT_PRICE_NO_LINE = 149
const DEFAULT_PRICE_WITH_LINE = 249
const DEFAULT_BANNER_DAYS_BEFORE = 7

const DEFAULT_DESCRIPTION =
  'เลือกแพ็ก (มี/ไม่มีแจ้งเตือน LINE) และจำนวนเดือน สแกน QR ชำระเงิน แล้วอัปโหลดสลิป — รอแอดมินหลักยืนยัน'

const DAYS_PER_MONTH = 30

function emptyPrices() {
  const prices = {}
  for (let m = 1; m <= 12; m += 1) prices[String(m)] = 0
  return prices
}

function parsePrices(raw) {
  const prices = emptyPrices()
  if (!raw) return prices
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object') return prices
    for (let m = 1; m <= 12; m += 1) {
      const n = Number(parsed[String(m)])
      prices[String(m)] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
    }
  } catch {
    /* keep defaults */
  }
  return prices
}

function parseOptionalBool(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  return null
}

function parseOptions(raw) {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    const seenIds = new Set()
    return parsed
      .map((item, index) => {
        const months = Math.floor(Number(item.months))
        const price = Math.floor(Number(item.price))
        const label = String(item.label || '').trim()
        let id = String(item.id || '').trim()
        if (!id) id = crypto.randomUUID()
        if (seenIds.has(id)) id = crypto.randomUUID()
        seenIds.add(id)
        const active = item.active !== false
        if (!Number.isInteger(months) || months < 1 || months > 12) return null
        if (!Number.isFinite(price) || price <= 0) return null
        if (!label) return null
        return {
          id,
          label,
          months,
          price,
          active,
          includes_line_push: parseOptionalBool(item.includes_line_push),
          sort_order: index,
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function optionsFromLegacyPrices(prices) {
  const opts = []
  for (let m = 1; m <= 12; m += 1) {
    const price = Number(prices[String(m)]) || 0
    if (price > 0) {
      opts.push({
        id: `months-${m}`,
        label: `${m} เดือน`,
        months: m,
        price,
        active: true,
      })
    }
  }
  return opts
}

function normalizeOptionsInput(raw) {
  const parsed = parseOptions(raw)
  return parsed.map((item, index) => ({ ...item, sort_order: index }))
}

function activeOptions(settings) {
  return (settings.options || []).filter((item) => item.active !== false)
}

function findOption(settings, optionId) {
  const id = String(optionId || '').trim()
  if (!id) return null
  return (settings.options || []).find((item) => item.id === id) || null
}

function findActiveOption(settings, optionId) {
  const option = findOption(settings, optionId)
  if (!option || option.active === false) return null
  return option
}

function parseTier(raw) {
  const t = String(raw || '').trim()
  if (t === 'with_line' || t === 'line') return 'with_line'
  if (t === 'no_line' || t === 'no-line') return 'no_line'
  return null
}

function tierIncludesLine(tier) {
  return tier === 'with_line'
}

function tierDisplayName(tier) {
  return tier === 'with_line' ? 'มีแจ้งเตือน LINE' : 'ไม่มีแจ้งเตือน LINE'
}

function parseMonthlyPrice(value, fallback) {
  const n = Math.floor(Number(value))
  if (Number.isFinite(n) && n > 0) return n
  return fallback
}

function parseBannerDaysBefore(value, fallback = DEFAULT_BANNER_DAYS_BEFORE) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(n, 365)
}

function pricePerMonthForTier(settings, tier) {
  const parsedTier = parseTier(tier)
  if (!parsedTier) return 0
  if (parsedTier === 'with_line') {
    return parseMonthlyPrice(settings.price_per_month_with_line, DEFAULT_PRICE_WITH_LINE)
  }
  return parseMonthlyPrice(settings.price_per_month_no_line, DEFAULT_PRICE_NO_LINE)
}

function priceForTierMonths(settings, tier, months) {
  const m = Math.floor(Number(months))
  const rate = pricePerMonthForTier(settings, tier)
  if (!rate || !Number.isInteger(m) || m < 1 || m > 12) return 0
  return rate * m
}

function buildTierLabel(tier, months) {
  const m = Math.floor(Number(months))
  return `${tierDisplayName(tier)} · ${m} เดือน`
}

function tierOptionId(tier) {
  const parsed = parseTier(tier)
  if (!parsed) return null
  return `tier:${parsed}`
}

function normalizePromptPay(value) {
  const id = String(value ?? '').trim()
  if (!id) return ''
  return id.replace(/\D/g, '')
}

async function getDefaultShopId(poolOrClient) {
  const result = await poolOrClient.query(
    `SELECT id FROM shops WHERE slug = 'default' LIMIT 1`
  )
  return result.rows[0]?.id || null
}

async function getRenewalSettings(poolOrClient) {
  const defaultShopId = await getDefaultShopId(poolOrClient)
  if (!defaultShopId) {
    return {
      promptpay_id: '',
      description: DEFAULT_DESCRIPTION,
      prices: emptyPrices(),
      options: [],
      price_per_month_no_line: DEFAULT_PRICE_NO_LINE,
      price_per_month_with_line: DEFAULT_PRICE_WITH_LINE,
      banner_days_before: DEFAULT_BANNER_DAYS_BEFORE,
    }
  }

  await ensureShopSettings(poolOrClient, defaultShopId, {
    [SETTING_KEYS.description]: DEFAULT_DESCRIPTION,
    [SETTING_KEYS.prices]: JSON.stringify(emptyPrices()),
    [SETTING_KEYS.options]: '[]',
    [SETTING_KEYS.promptpay]: '',
    [SETTING_KEYS.priceNoLine]: String(DEFAULT_PRICE_NO_LINE),
    [SETTING_KEYS.priceWithLine]: String(DEFAULT_PRICE_WITH_LINE),
    [SETTING_KEYS.bannerDaysBefore]: String(DEFAULT_BANNER_DAYS_BEFORE),
  })

  const map = await getShopSettings(poolOrClient, defaultShopId, Object.values(SETTING_KEYS))
  const prices = parsePrices(map[SETTING_KEYS.prices])
  let options = parseOptions(map[SETTING_KEYS.options])
  if (!options.length) {
    options = optionsFromLegacyPrices(prices)
  }
  return {
    promptpay_id: normalizePromptPay(map[SETTING_KEYS.promptpay]),
    description: String(map[SETTING_KEYS.description] || DEFAULT_DESCRIPTION).trim() || DEFAULT_DESCRIPTION,
    prices,
    options,
    price_per_month_no_line: parseMonthlyPrice(map[SETTING_KEYS.priceNoLine], DEFAULT_PRICE_NO_LINE),
    price_per_month_with_line: parseMonthlyPrice(map[SETTING_KEYS.priceWithLine], DEFAULT_PRICE_WITH_LINE),
    banner_days_before: parseBannerDaysBefore(map[SETTING_KEYS.bannerDaysBefore], DEFAULT_BANNER_DAYS_BEFORE),
  }
}

async function setRenewalSettings(poolOrClient, partial) {
  const defaultShopId = await getDefaultShopId(poolOrClient)
  if (!defaultShopId) throw new Error('ไม่พบร้าน default')

  const entries = {}
  if (Object.prototype.hasOwnProperty.call(partial, 'promptpay_id')) {
    entries[SETTING_KEYS.promptpay] = normalizePromptPay(partial.promptpay_id)
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'description')) {
    entries[SETTING_KEYS.description] = String(partial.description || '').trim() || DEFAULT_DESCRIPTION
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'prices')) {
    entries[SETTING_KEYS.prices] = JSON.stringify(parsePrices(partial.prices))
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'options')) {
    entries[SETTING_KEYS.options] = JSON.stringify(normalizeOptionsInput(partial.options))
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'price_per_month_no_line')) {
    entries[SETTING_KEYS.priceNoLine] = String(
      parseMonthlyPrice(partial.price_per_month_no_line, DEFAULT_PRICE_NO_LINE)
    )
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'price_per_month_with_line')) {
    entries[SETTING_KEYS.priceWithLine] = String(
      parseMonthlyPrice(partial.price_per_month_with_line, DEFAULT_PRICE_WITH_LINE)
    )
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'banner_days_before')) {
    entries[SETTING_KEYS.bannerDaysBefore] = String(
      parseBannerDaysBefore(partial.banner_days_before, DEFAULT_BANNER_DAYS_BEFORE)
    )
  }

  if (Object.keys(entries).length) {
    await setShopSettings(poolOrClient, defaultShopId, entries)
  }
  return getRenewalSettings(poolOrClient)
}

function priceForOption(settings, optionId) {
  const option = findActiveOption(settings, optionId)
  return option ? option.price : 0
}

function priceForMonth(settings, months) {
  const m = Math.min(12, Math.max(1, Math.floor(Number(months))))
  const fromOptions = activeOptions(settings).find((item) => item.months === m)
  if (fromOptions) return fromOptions.price
  return Number(settings.prices[String(m)]) || 0
}

async function extendShopUsageByMonths(poolOrClient, shopId, months) {
  const shopRes = await poolOrClient.query(
    `SELECT id, slug, usage_limit_days, usage_started_at, created_at FROM shops WHERE id = $1 LIMIT 1`,
    [shopId]
  )
  const shop = enrichShopUsage(shopRes.rows[0])
  if (!shop || shop.slug === 'default') {
    throw new Error('ไม่สามารถต่ออายุร้าน default ได้')
  }

  const addDays = Math.floor(Number(months)) * DAYS_PER_MONTH
  if (!Number.isFinite(addDays) || addDays <= 0) {
    throw new Error('จำนวนเดือนไม่ถูกต้อง')
  }

  const remaining = shop.usage_expired ? 0 : (getUsageDaysRemaining(shop) ?? 0)
  const newLimitDays = remaining + addDays

  await poolOrClient.query(
    `
      UPDATE shops
      SET usage_limit_days = $1,
          usage_started_at = NOW()
      WHERE id = $2
    `,
    [newLimitDays, shopId]
  )

  const updated = await poolOrClient.query(
    `SELECT id, slug, name, is_active, created_at, usage_limit_days, usage_started_at FROM shops WHERE id = $1`,
    [shopId]
  )
  return enrichShopUsage(updated.rows[0])
}

module.exports = {
  SETTING_KEYS,
  DEFAULT_DESCRIPTION,
  DAYS_PER_MONTH,
  DEFAULT_PRICE_NO_LINE,
  DEFAULT_PRICE_WITH_LINE,
  DEFAULT_BANNER_DAYS_BEFORE,
  emptyPrices,
  parsePrices,
  parseBannerDaysBefore,
  parseOptions,
  parseTier,
  tierIncludesLine,
  tierDisplayName,
  pricePerMonthForTier,
  priceForTierMonths,
  buildTierLabel,
  tierOptionId,
  normalizeOptionsInput,
  optionsFromLegacyPrices,
  activeOptions,
  findOption,
  findActiveOption,
  getDefaultShopId,
  getRenewalSettings,
  setRenewalSettings,
  priceForMonth,
  priceForOption,
  extendShopUsageByMonths,
  normalizePromptPay,
}
