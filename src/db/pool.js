const sql = require('mssql')

const config = {
  server:   process.env.DB_HOST || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_NAME || 'nail_booking',
  user:     process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
}

let poolPromise

const getPool = () => {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then(pool => {
        console.log('✅ MSSQL connected:', config.database)
        return pool
      })
      .catch(err => {
        console.error('❌ DB Error:', err.message)
        poolPromise = null
        throw err
      })
  }
  return poolPromise
}

module.exports = { sql, getPool }
