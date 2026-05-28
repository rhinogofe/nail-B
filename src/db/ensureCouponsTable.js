const { getPool } = require('./pool')

async function ensureCouponsTable() {
  const pool = await getPool()
  await pool.request().batch(`
    IF OBJECT_ID('dbo.coupons', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.coupons (
        id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        user_id UNIQUEIDENTIFIER NOT NULL,
        coupon_code NVARCHAR(10) NOT NULL,
        discount_percent INT NOT NULL DEFAULT 20,
        required_points INT NOT NULL DEFAULT 100,
        is_used BIT NOT NULL DEFAULT 0,
        used_at DATETIME2 NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
      );
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.coupons')
        AND name = 'UX_coupons_coupon_code'
    )
    BEGIN
      CREATE UNIQUE INDEX UX_coupons_coupon_code
      ON dbo.coupons(coupon_code);
    END;

    IF NOT EXISTS (
      SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_coupons_users'
    )
    BEGIN
      ALTER TABLE dbo.coupons
      ADD CONSTRAINT FK_coupons_users
      FOREIGN KEY (user_id) REFERENCES dbo.users(id);
    END;
  `)
}

module.exports = { ensureCouponsTable }
