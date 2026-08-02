async function getShopSetting(poolOrClient, shopId, key) {
  const result = await poolOrClient.query(
    `SELECT setting_value FROM shop_settings WHERE shop_id = $1 AND setting_key = $2`,
    [shopId, key]
  )
  return result.rows[0]?.setting_value ?? null
}

async function getShopSettings(poolOrClient, shopId, keys) {
  const result = await poolOrClient.query(
    `SELECT setting_key, setting_value FROM shop_settings
     WHERE shop_id = $1 AND setting_key = ANY($2::text[])`,
    [shopId, keys]
  )
  return Object.fromEntries(result.rows.map((row) => [row.setting_key, row.setting_value]))
}

async function setShopSetting(poolOrClient, shopId, key, value) {
  await poolOrClient.query(
    `INSERT INTO shop_settings (shop_id, setting_key, setting_value)
     VALUES ($1, $2, $3)
     ON CONFLICT (shop_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
    [shopId, key, String(value)]
  )
}

async function setShopSettings(poolOrClient, shopId, entries) {
  for (const [key, value] of Object.entries(entries)) {
    await setShopSetting(poolOrClient, shopId, key, value)
  }
}

async function ensureShopSettings(poolOrClient, shopId, defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    await poolOrClient.query(
      `INSERT INTO shop_settings (shop_id, setting_key, setting_value)
       VALUES ($1, $2, $3)
       ON CONFLICT (shop_id, setting_key) DO NOTHING`,
      [shopId, key, String(value)]
    )
  }
}

module.exports = {
  getShopSetting,
  getShopSettings,
  setShopSetting,
  setShopSettings,
  ensureShopSettings,
}
