const { getPool } = require('./pool')

async function ensureNailoptionTable() {
  const pool = await getPool()
  await pool.request().batch(`
    IF OBJECT_ID('dbo.Nailoption', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.Nailoption (
        id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        option_name NVARCHAR(120) NOT NULL,
        description NVARCHAR(255) NULL,
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        duration_min INT NOT NULL DEFAULT 60,
        is_active BIT NOT NULL DEFAULT 1,
        created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
      );
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'UX_Nailoption_option_name'
        AND object_id = OBJECT_ID('dbo.Nailoption')
    )
    BEGIN
      CREATE UNIQUE INDEX UX_Nailoption_option_name
      ON dbo.Nailoption(option_name);
    END;

    IF NOT EXISTS (
      SELECT 1 FROM dbo.Nailoption
    )
    BEGIN
      INSERT INTO dbo.Nailoption (option_name, description, price, duration_min, is_active)
      VALUES
        (N'ทาสีเจลมือ', N'เจลพื้นฐาน 1 สี', 299, 60, 1),
        (N'ต่อเล็บเจล', N'ต่อเล็บเจลเต็มชุด', 799, 120, 1),
        (N'สปามือ', N'สปามือ + บำรุง', 399, 45, 1);
    END;
  `)
}

module.exports = { ensureNailoptionTable }
