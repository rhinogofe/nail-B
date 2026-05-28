const { getPool } = require('./pool')

async function ensureUserProviderConstraint() {
  const pool = await getPool()

  const check = await pool.request().query(`
    SELECT TOP 1 name, definition
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.users')
      AND definition LIKE '%provider%'
    ORDER BY name
  `)

  const row = check.recordset[0]
  if (!row) return

  const definition = (row.definition || '').toLowerCase()
  if (definition.includes("'phone'")) return

  const constraintName = row.name.replace(/]/g, ']]')
  const alterSql = `
    ALTER TABLE dbo.users DROP CONSTRAINT [${constraintName}];
    ALTER TABLE dbo.users
    WITH CHECK ADD CONSTRAINT [CK_users_provider]
    CHECK ([provider] IN ('google', 'facebook', 'line', 'phone'));
  `

  await pool.request().batch(alterSql)
  console.log('✅ Updated users.provider CHECK constraint')
}

module.exports = { ensureUserProviderConstraint }
