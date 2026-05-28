const { getPool } = require('./pool')

async function ensureBookingBlocksTable() {
  const pool = await getPool()
  await pool.request().batch(`
    IF OBJECT_ID('dbo.booking_blocks', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.booking_blocks (
        id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        block_date DATE NOT NULL,
        start_hour TINYINT NULL,
        end_hour TINYINT NULL,
        is_full_day BIT NOT NULL DEFAULT 0,
        note NVARCHAR(255) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
      );
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID('dbo.booking_blocks')
        AND name = 'CK_booking_blocks_hours'
    )
    BEGIN
      ALTER TABLE dbo.booking_blocks WITH CHECK ADD CONSTRAINT CK_booking_blocks_hours
      CHECK (
        (is_full_day = 1 AND start_hour IS NULL AND end_hour IS NULL)
        OR
        (is_full_day = 0 AND start_hour IS NOT NULL AND end_hour IS NOT NULL AND start_hour < end_hour)
      );
    END;
  `)
}

module.exports = { ensureBookingBlocksTable }
