const { getPool } = require('./pool')

async function ensureSchema() {
  const pool = await getPool()

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      avatar_url TEXT,
      provider TEXT NOT NULL CHECK (provider IN ('google', 'facebook', 'line', 'phone')),
      provider_id TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT false,
      total_points INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, provider_id)
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      booking_date DATE NOT NULL,
      start_hour SMALLINT NOT NULL,
      end_hour SMALLINT,
      status TEXT NOT NULL DEFAULT 'awaiting_payment'
        CHECK (status IN ('awaiting_payment', 'pending', 'done', 'cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      UNIQUE (booking_date, start_hour)
    );

    CREATE TABLE IF NOT EXISTS point_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      booking_id UUID REFERENCES bookings(id),
      points INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS booking_blocks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      block_date DATE NOT NULL,
      start_hour SMALLINT,
      end_hour SMALLINT,
      is_full_day BOOLEAN NOT NULL DEFAULT false,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (is_full_day = true AND start_hour IS NULL AND end_hour IS NULL)
        OR (is_full_day = false AND start_hour IS NOT NULL AND end_hour IS NOT NULL AND start_hour < end_hour)
      )
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS nailoption (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      option_name TEXT NOT NULL,
      description TEXT,
      price NUMERIC(10, 2) NOT NULL DEFAULT 0,
      duration_min INT NOT NULL DEFAULT 60,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_nailoption_option_name
      ON nailoption (option_name);

    CREATE TABLE IF NOT EXISTS booking_nailoptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      nailoption_id UUID NOT NULL REFERENCES nailoption(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (booking_id, nailoption_id)
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      coupon_code TEXT NOT NULL,
      discount_percent INT NOT NULL DEFAULT 20,
      required_points INT NOT NULL DEFAULT 100,
      is_used BOOLEAN NOT NULL DEFAULT false,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_coupons_coupon_code
      ON coupons (coupon_code);
  `)

  await pool.query(`
    INSERT INTO app_settings (setting_key, setting_value)
    VALUES ('deposit_amount', '300')
    ON CONFLICT (setting_key) DO NOTHING
  `)

  const seed = await pool.query(`SELECT COUNT(*)::int AS n FROM nailoption`)
  if (seed.rows[0].n === 0) {
    await pool.query(`
      INSERT INTO nailoption (option_name, description, price, duration_min, is_active)
      VALUES
        ('ทาสีเจลมือ', 'เจลพื้นฐาน 1 สี', 299, 60, true),
        ('ต่อเล็บเจล', 'ต่อเล็บเจลเต็มชุด', 799, 120, true),
        ('สปามือ', 'สปามือ + บำรุง', 399, 45, true)
    `)
  }

  console.log('✅ PostgreSQL schema ready')
}

module.exports = { ensureSchema }
