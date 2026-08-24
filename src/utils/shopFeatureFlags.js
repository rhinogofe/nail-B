const { getShopSettings, setShopSettings, ensureShopSettings } = require('./shopSettings')
const {
  SHOP_FEATURE_CATALOG,
  FEATURE_ITEM_MAP,
  ALL_FEATURE_KEYS,
  featureSettingKey,
  featureDefaultSettingKey,
  catalogDefaultEnabled,
} = require('../constants/shopFeatureCatalog')

async function getDefaultShopId(poolOrClient) {
  const result = await poolOrClient.query(
    `SELECT id FROM shops WHERE slug = 'default' LIMIT 1`
  )
  return result.rows[0]?.id || null
}

function parseBoolSetting(value, fallback) {
  if (value == null || value === '') return fallback
  const v = String(value).trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes') return true
  if (v === '0' || v === 'false' || v === 'no') return false
  return fallback
}

function buildDefaultTemplateFromMap(map = {}) {
  const out = {}
  for (const key of ALL_FEATURE_KEYS) {
    const stored = map[featureDefaultSettingKey(key)]
    out[key] = parseBoolSetting(stored, catalogDefaultEnabled(key))
  }
  return out
}

function buildResolvedFeatures(shopMap = {}, templateMap = {}) {
  const out = {}
  for (const key of ALL_FEATURE_KEYS) {
    const item = FEATURE_ITEM_MAP[key]
    if (item?.locked) {
      out[key] = true
      continue
    }
    const shopVal = shopMap[featureSettingKey(key)]
    if (shopVal != null && shopVal !== '') {
      out[key] = parseBoolSetting(shopVal, catalogDefaultEnabled(key))
      continue
    }
    const templateVal = templateMap[featureDefaultSettingKey(key)]
    out[key] = parseBoolSetting(templateVal, catalogDefaultEnabled(key))
  }
  return out
}

function buildOverridesFromMap(map = {}) {
  const out = {}
  for (const key of ALL_FEATURE_KEYS) {
    const val = map[featureSettingKey(key)]
    if (val != null && val !== '') {
      out[key] = parseBoolSetting(val, catalogDefaultEnabled(key))
    }
  }
  return out
}

async function getNewShopDefaultTemplate(poolOrClient) {
  const defaultShopId = await getDefaultShopId(poolOrClient)
  if (!defaultShopId) {
    return Object.fromEntries(ALL_FEATURE_KEYS.map((k) => [k, catalogDefaultEnabled(k)]))
  }
  const defaultKeys = ALL_FEATURE_KEYS.map((k) => featureDefaultSettingKey(k))
  const map = await getShopSettings(poolOrClient, defaultShopId, defaultKeys)
  return buildDefaultTemplateFromMap(map)
}

async function getShopFeatureFlags(poolOrClient, shopId) {
  const shopKeys = ALL_FEATURE_KEYS.map((k) => featureSettingKey(k))
  const shopMap = await getShopSettings(poolOrClient, shopId, shopKeys)
  const template = await getNewShopDefaultTemplate(poolOrClient)
  const templateEntries = Object.fromEntries(
    ALL_FEATURE_KEYS.map((k) => [featureDefaultSettingKey(k), template[k] ? '1' : '0'])
  )
  return {
    features: buildResolvedFeatures(shopMap, templateEntries),
    overrides: buildOverridesFromMap(shopMap),
  }
}

async function setShopFeatureFlags(poolOrClient, shopId, partialFeatures = {}) {
  const entries = {}
  for (const [key, enabled] of Object.entries(partialFeatures)) {
    if (!ALL_FEATURE_KEYS.includes(key)) continue
    const item = FEATURE_ITEM_MAP[key]
    if (item?.locked) continue
    entries[featureSettingKey(key)] = enabled ? '1' : '0'
  }
  if (Object.keys(entries).length) {
    await setShopSettings(poolOrClient, shopId, entries)
  }
  return getShopFeatureFlags(poolOrClient, shopId)
}

async function setNewShopDefaultTemplate(poolOrClient, partialFeatures = {}) {
  const defaultShopId = await getDefaultShopId(poolOrClient)
  if (!defaultShopId) {
    const err = new Error('ไม่พบร้าน default')
    err.status = 500
    throw err
  }
  const entries = {}
  for (const [key, enabled] of Object.entries(partialFeatures)) {
    if (!ALL_FEATURE_KEYS.includes(key)) continue
    const item = FEATURE_ITEM_MAP[key]
    if (item?.locked) continue
    entries[featureDefaultSettingKey(key)] = enabled ? '1' : '0'
  }
  if (Object.keys(entries).length) {
    await setShopSettings(poolOrClient, defaultShopId, entries)
  }
  return getNewShopDefaultTemplate(poolOrClient)
}

async function applyDefaultFeaturesToNewShop(poolOrClient, shopId) {
  const template = await getNewShopDefaultTemplate(poolOrClient)
  const entries = {}
  for (const [key, enabled] of Object.entries(template)) {
    entries[featureSettingKey(key)] = enabled ? '1' : '0'
  }
  await ensureShopSettings(poolOrClient, shopId, entries)
}

function isFeatureEnabled(features, key) {
  if (!features || typeof features !== 'object') return catalogDefaultEnabled(key)
  if (features[key] === false) return false
  if (features[key] === true) return true
  return catalogDefaultEnabled(key)
}

module.exports = {
  SHOP_FEATURE_CATALOG,
  ALL_FEATURE_KEYS,
  buildResolvedFeatures,
  buildDefaultTemplateFromMap,
  getShopFeatureFlags,
  setShopFeatureFlags,
  getNewShopDefaultTemplate,
  setNewShopDefaultTemplate,
  applyDefaultFeaturesToNewShop,
  isFeatureEnabled,
}
