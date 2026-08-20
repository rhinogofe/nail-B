const { getPool } = require('./pool')

async function ensureShopUsageColumns(pool) {
  const db = pool || await getPool()
  const exists = await db.query(`SELECT to_regclass('public.shops') AS reg`)
  if (!exists.rows[0]?.reg) return
  await db.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS usage_limit_days INT`)
  await db.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS usage_started_at TIMESTAMPTZ`)
}

async function ensureChatNotifySchema(pool) {
  const db = pool || await getPool()
  const chatExists = await db.query(`SELECT to_regclass('public.chat_messages') AS reg`)
  if (!chatExists.rows[0]?.reg) return

  await db.query(`
    DO $$
    DECLARE cname text;
    BEGIN
      FOR cname IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'chat_messages'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) LIKE '%sender_role%'
      LOOP
        EXECUTE format('ALTER TABLE chat_messages DROP CONSTRAINT %I', cname);
      END LOOP;
    END $$;
  `)

  const checkExists = await db.query(`
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'chat_messages'
      AND con.conname = 'chat_messages_sender_role_check'
    LIMIT 1
  `)
  if (!checkExists.rows.length) {
    await db.query(`
      ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_sender_role_check
        CHECK (sender_role IN ('admin', 'customer', 'system'));
    `)
  }

  const bookingsExists = await db.query(`SELECT to_regclass('public.bookings') AS reg`)
  if (bookingsExists.rows[0]?.reg) {
    await db.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS chat_admin_upcoming_sent_at TIMESTAMPTZ;
    `)
    await db.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS chat_customer_upcoming_sent_at TIMESTAMPTZ;
    `)
  }

  await db.query(`
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS related_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
  `)

  await db.query(`
    DO $$
    DECLARE cname text;
    BEGIN
      SELECT c.conname INTO cname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'users'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%provider%'
      LIMIT 1;
      IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', cname);
      END IF;
    END $$;
  `)
  await db.query(`
    ALTER TABLE users ADD CONSTRAINT users_provider_check
      CHECK (provider IN ('google', 'facebook', 'line', 'phone', 'system'));
  `)

  const shops = await db.query(`SELECT id FROM shops`)
  const { ensureSystemChatUser } = require('../utils/systemChatUser')
  for (const shop of shops.rows) {
    await ensureSystemChatUser(db, shop.id)
  }
}

async function ensureServiceCategoriesSchema(pool) {
  const db = pool || await getPool()
  const shopsExists = await db.query(`SELECT to_regclass('public.shops') AS reg`)
  if (!shopsExists.rows[0]?.reg) return

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const nailoptionExists = await db.query(`SELECT to_regclass('public.nailoption') AS reg`)
  if (nailoptionExists.rows[0]?.reg) {
    await db.query(`
      ALTER TABLE nailoption
      ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL
    `)
  }

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_service_categories_shop_name
      ON service_categories (shop_id, name)
  `)

  if (nailoptionExists.rows[0]?.reg) {
    await db.query(`
      CREATE INDEX IF NOT EXISTS ix_nailoption_category_id
        ON nailoption (category_id)
        WHERE category_id IS NOT NULL
    `)
  }
}

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
      total NUMERIC(10, 2)
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

    CREATE TABLE IF NOT EXISTS booking_extra_hours (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      extra_date DATE NOT NULL,
      start_hour SMALLINT NOT NULL,
      end_hour SMALLINT NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (start_hour >= 0 AND end_hour <= 24 AND start_hour < end_hour)
    );

    CREATE TABLE IF NOT EXISTS booking_day_hours (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      schedule_date DATE NOT NULL,
      start_hour SMALLINT NOT NULL,
      start_minute SMALLINT NOT NULL DEFAULT 0,
      end_hour SMALLINT NOT NULL,
      end_minute SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (start_hour >= 0 AND start_hour <= 23),
      CHECK (start_minute >= 0 AND start_minute <= 59),
      CHECK (end_hour >= 0 AND end_hour <= 23),
      CHECK (end_minute >= 0 AND end_minute <= 59),
      CHECK (start_hour * 60 + start_minute < end_hour * 60 + end_minute)
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
      show_from_date DATE,
      show_to_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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

    CREATE TABLE IF NOT EXISTS showcase_clips (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tiktok_url TEXT NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (video_id)
    );
  `)

  await pool.query(`
    ALTER TABLE nailoption ADD COLUMN IF NOT EXISTS show_from_date DATE;
    ALTER TABLE nailoption ADD COLUMN IF NOT EXISTS show_to_date DATE;
    ALTER TABLE nailoption ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE nailoption ADD COLUMN IF NOT EXISTS color TEXT;
    ALTER TABLE nailoption ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total NUMERIC(10, 2);
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS start_minute SMALLINT NOT NULL DEFAULT 0;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_minute SMALLINT NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_note TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS receive_all_shop_push BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE showcase_clips ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
    ALTER TABLE showcase_clips ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'tiktok';
  `)

  await pool.query(`
    ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_booking_date_start_hour_key;
  `)

  // Phone login: same number + different name = separate accounts
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_provider_provider_id_key`)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_users_oauth_provider
      ON users (provider, provider_id)
      WHERE provider <> 'phone'
  `)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_users_phone_identity
      ON users (provider, provider_id, lower(trim(name)))
      WHERE provider = 'phone'
  `)

  // Legacy index — superseded by ux_bookings_active_shop_date_slot; may fail on duplicate rows.
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_active_date_hour
        ON bookings (booking_date, start_hour)
        WHERE status != 'cancelled';
    `)
  } catch (err) {
    console.warn('⚠️ Skip legacy index ux_bookings_active_date_hour:', err.message)
  }

  await pool.query(`DROP INDEX IF EXISTS ux_nailoption_option_name`)

  const orderCheck = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE sort_order > 0)::int AS ordered
    FROM nailoption
  `)
  if (orderCheck.rows[0].total > 0 && orderCheck.rows[0].ordered === 0) {
    await pool.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, option_name ASC) AS rn
        FROM nailoption
      )
      UPDATE nailoption n
      SET sort_order = ranked.rn
      FROM ranked
      WHERE n.id = ranked.id
    `)
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      description TEXT,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  await pool.query(`
    INSERT INTO app_settings (setting_key, setting_value)
    VALUES
      ('deposit_amount',         '300'),
      ('shop_open_hour',         '9'),
      ('shop_last_booking_hour', '18'),
      ('book_advance_days',      '30'),
      ('booking_display_mode',   'slots_2h'),
      ('unpaid_auto_cancel_enabled', 'true'),
      ('unpaid_expire_hours',        '24')
    ON CONFLICT (setting_key) DO NOTHING
  `)

  // ── Multi-shop (tenant) schema ─────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shops (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shop_admins (
      shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (shop_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS shop_settings (
      shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      setting_key TEXT NOT NULL,
      setting_value TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (shop_id, setting_key)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_role TEXT NOT NULL CHECK (sender_role IN ('admin', 'customer')),
      sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ix_chat_messages_shop_user_created
      ON chat_messages (shop_id, user_id, created_at ASC);

    CREATE INDEX IF NOT EXISTS ix_chat_messages_unread_customer
      ON chat_messages (shop_id, user_id)
      WHERE sender_role = 'customer' AND read_at IS NULL;
  `)

  await pool.query(`
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS image_url TEXT;
  `)

  await ensureChatNotifySchema(pool)
  await ensureShopUsageColumns(pool)
  await ensureServiceCategoriesSchema(pool)

  await pool.query(`
    INSERT INTO shops (slug, name)
    VALUES ('default', 'Nail Thuean')
    ON CONFLICT (slug) DO NOTHING
  `)

  const defaultShopRow = await pool.query(`SELECT id FROM shops WHERE slug = 'default' LIMIT 1`)
  const defaultShopId = defaultShopRow.rows[0]?.id
  if (!defaultShopId) throw new Error('Default shop missing after migration')

  const tenantTables = [
    'bookings',
    'booking_blocks',
    'booking_extra_hours',
    'booking_day_hours',
    'nailoption',
    'showcase_clips',
    'service_locations',
  ]
  for (const table of tenantTables) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id) ON DELETE CASCADE`)
    await pool.query(
      `UPDATE ${table} SET shop_id = $1 WHERE shop_id IS NULL`,
      [defaultShopId]
    )
  }

  await pool.query(`
    INSERT INTO shop_settings (shop_id, setting_key, setting_value)
    SELECT $1, setting_key, setting_value
    FROM app_settings
    ON CONFLICT (shop_id, setting_key) DO NOTHING
  `, [defaultShopId])

  await pool.query(`
    INSERT INTO shop_settings (shop_id, setting_key, setting_value)
    SELECT s.id, d.setting_key, d.setting_value
    FROM shops s
    CROSS JOIN (VALUES
      ('deposit_amount', '300'),
      ('shop_open_hour', '9'),
      ('shop_last_booking_hour', '18'),
      ('book_advance_days', '30'),
      ('booking_display_mode', 'slots_2h'),
      ('unpaid_auto_cancel_enabled', 'true'),
      ('unpaid_expire_hours', '24'),
      ('coupon_discount_percent', '20'),
      ('coupon_required_points', '100'),
      ('coupon_completion_points', '10'),
      ('line_push_enabled', 'false'),
      ('booking_slot_hours', '2'),
      ('extend_booking_by_services', 'false'),
      ('extend_booking_past_close', 'false'),
      ('shop_register_pin', '')
    ) AS d(setting_key, setting_value)
    ON CONFLICT (shop_id, setting_key) DO NOTHING
  `)

  for (const table of tenantTables) {
    await pool.query(`ALTER TABLE ${table} ALTER COLUMN shop_id SET NOT NULL`)
  }

  await pool.query(`DROP INDEX IF EXISTS ux_bookings_active_date_hour`)
  await pool.query(`DROP INDEX IF EXISTS ux_bookings_active_shop_date_hour`)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_active_shop_date_slot
      ON bookings (shop_id, booking_date, start_hour, start_minute)
      WHERE status != 'cancelled'
  `)

  await pool.query(`ALTER TABLE service_locations DROP CONSTRAINT IF EXISTS service_locations_name_key`)
  await pool.query(`ALTER TABLE service_locations ADD COLUMN IF NOT EXISTS map_url TEXT`)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_service_locations_shop_name
      ON service_locations (shop_id, name)
  `)

  await pool.query(`DROP INDEX IF EXISTS ux_showcase_clips_video_id`)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_showcase_clips_shop_video_id
      ON showcase_clips (shop_id, video_id)
  `)

  // Existing DBs may have shop_id FK without ON DELETE CASCADE — repair on startup.
  const shopChildTables = [
    'bookings',
    'booking_blocks',
    'booking_extra_hours',
    'booking_day_hours',
    'nailoption',
    'showcase_clips',
    'service_locations',
  ]
  for (const table of shopChildTables) {
    await pool.query(`
      DO $$
      DECLARE cname text;
      BEGIN
        SELECT c.conname INTO cname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
        WHERE t.relname = '${table}'
          AND a.attname = 'shop_id'
          AND c.contype = 'f'
        LIMIT 1;
        IF cname IS NOT NULL THEN
          EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', '${table}', cname);
        END IF;
      END $$;
    `)
    await pool.query(`
      ALTER TABLE ${table}
      DROP CONSTRAINT IF EXISTS ${table}_shop_id_fkey
    `)
    await pool.query(`
      ALTER TABLE ${table}
      ADD CONSTRAINT ${table}_shop_id_fkey
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
    `)
  }

  // Legacy backfill: admins linked to every shop → keep only default (super admin)
  await pool.query(`
    DELETE FROM shop_admins sa
    USING shop_admins sa_default, shops s_default
    WHERE sa_default.user_id = sa.user_id
      AND sa_default.shop_id = s_default.id
      AND s_default.slug = 'default'
      AND sa.shop_id != sa_default.shop_id
  `)

  // New admins without shop assignment → default shop (super admin)
  await pool.query(`
    INSERT INTO shop_admins (shop_id, user_id)
    SELECT s.id, u.id
    FROM shops s
    CROSS JOIN users u
    WHERE s.slug = 'default' AND u.is_admin = true
      AND NOT EXISTS (SELECT 1 FROM shop_admins sa WHERE sa.user_id = u.id)
    ON CONFLICT DO NOTHING
  `)

  const { ensureUiSettings } = require('../utils/shopUiSettings')
  const allShops = await pool.query(`SELECT id FROM shops`)
  for (const row of allShops.rows) {
    await ensureUiSettings(pool, row.id)
  }

  const { computeBookUntilDate, todayYmdBangkok } = require('../utils/bookingWindow')
  const advanceRow = await pool.query(
    `SELECT setting_value FROM shop_settings
     WHERE shop_id = $1 AND setting_key = 'book_advance_days'`,
    [defaultShopId]
  )
  const untilRow = await pool.query(
    `SELECT setting_value FROM shop_settings
     WHERE shop_id = $1 AND setting_key = 'book_until_date'`,
    [defaultShopId]
  )
  const advanceDays = Number(advanceRow.rows[0]?.setting_value || 30)
  const untilDate = untilRow.rows[0]?.setting_value
  if (!untilDate) {
    const bookUntil = computeBookUntilDate(advanceDays, todayYmdBangkok())
    await pool.query(
      `INSERT INTO shop_settings (shop_id, setting_key, setting_value)
       VALUES ($1, 'book_until_date', $2)
       ON CONFLICT (shop_id, setting_key) DO NOTHING`,
      [defaultShopId, bookUntil]
    )
  }

  const seed = await pool.query(`SELECT COUNT(*)::int AS n FROM nailoption WHERE shop_id = $1`, [defaultShopId])
  if (seed.rows[0].n === 0) {
    await pool.query(`
      INSERT INTO nailoption (shop_id, option_name, description, price, duration_min, is_active)
      VALUES
        ($1, 'ทาสีเจลมือ', 'เจลพื้นฐาน 1 สี', 299, 60, true),
        ($1, 'ต่อเล็บเจล', 'ต่อเล็บเจลเต็มชุด', 799, 120, true),
        ($1, 'สปามือ', 'สปามือ + บำรุง', 399, 45, true)
    `, [defaultShopId])
  }

  console.log('✅ PostgreSQL schema ready')
}

async function ensureFcmTokensSchema(pool) {
  const { ensureFcmTokensSchema: ensureTable } = require('../utils/fcmTokens')
  await ensureTable(pool)
}

module.exports = {
  ensureSchema,
  ensureShopUsageColumns,
  ensureServiceCategoriesSchema,
  ensureChatNotifySchema,
  ensureFcmTokensSchema,
}
