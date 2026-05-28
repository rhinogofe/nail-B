const { getPool } = require('./pool')

async function ensureBookingNailoptionTable() {
  const pool = await getPool()
  await pool.request().batch(`
    IF OBJECT_ID('dbo.booking_nailoptions', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.booking_nailoptions (
        id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        booking_id UNIQUEIDENTIFIER NOT NULL,
        nailoption_id UNIQUEIDENTIFIER NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSDATETIME()
      );
    END;

    IF NOT EXISTS (
      SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_booking_nailoptions_booking'
    )
    BEGIN
      ALTER TABLE dbo.booking_nailoptions
      ADD CONSTRAINT FK_booking_nailoptions_booking
      FOREIGN KEY (booking_id) REFERENCES dbo.bookings(id);
    END;

    IF NOT EXISTS (
      SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_booking_nailoptions_nailoption'
    )
    BEGIN
      ALTER TABLE dbo.booking_nailoptions
      ADD CONSTRAINT FK_booking_nailoptions_nailoption
      FOREIGN KEY (nailoption_id) REFERENCES dbo.Nailoption(id);
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'UX_booking_nailoptions_pair'
        AND object_id = OBJECT_ID('dbo.booking_nailoptions')
    )
    BEGIN
      CREATE UNIQUE INDEX UX_booking_nailoptions_pair
      ON dbo.booking_nailoptions(booking_id, nailoption_id);
    END;
  `)
}

module.exports = { ensureBookingNailoptionTable }
