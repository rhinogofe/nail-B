const { getPool } = require('./pool')

async function ensureAppSettingsTable() {
  const pool = await getPool()
  await pool.request().batch(`
    IF OBJECT_ID('dbo.app_settings', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.app_settings (
        setting_key NVARCHAR(100) NOT NULL PRIMARY KEY,
        setting_value NVARCHAR(255) NULL,
        updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
      );
    END;

    IF NOT EXISTS (
      SELECT 1 FROM dbo.app_settings WHERE setting_key = 'deposit_amount'
    )
    BEGIN
      INSERT INTO dbo.app_settings (setting_key, setting_value)
      VALUES ('deposit_amount', '300');
    END;
  `)
}

module.exports = { ensureAppSettingsTable }
