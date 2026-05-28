const { getPool } = require('./pool')

async function ensureBookingStatusConstraint() {
  const pool = await getPool()

  const check = await pool.request().query(`
    SELECT TOP 1 name, definition
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.bookings')
      AND definition LIKE '%status%'
    ORDER BY name
  `)

  const row = check.recordset[0]
  if (!row) return

  const definition = (row.definition || '').toLowerCase()
  if (definition.includes('awaiting_payment')) return

  const constraintName = row.name.replace(/]/g, ']]')
  const alterSql = `
    ALTER TABLE dbo.bookings DROP CONSTRAINT [${constraintName}];
    ALTER TABLE dbo.bookings
    WITH CHECK ADD CONSTRAINT [CK_bookings_status]
    CHECK ([status] IN ('awaiting_payment', 'pending', 'done', 'cancelled'));
  `

  await pool.request().batch(alterSql)
  console.log('✅ Updated bookings.status CHECK constraint')
}

module.exports = { ensureBookingStatusConstraint }
