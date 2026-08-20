const router = require('express').Router()
const { getPool } = require('../db/pool')
const {
  getRenewalSettings,
  setRenewalSettings,
  priceForMonth,
  priceForOption,
  priceForTierMonths,
  buildTierLabel,
  tierOptionId,
  parseTier,
  tierIncludesLine,
  extendShopUsageByMonths,
  parsePrices,
  normalizeOptionsInput,
  findOption,
  findActiveOption,
  normalizePromptPay,
} = require('../utils/usageRenewal')
const { setLinePushSettings } = require('../utils/linePushSettings')
const {
  parseBase64Image,
  saveRenewalSlip,
  deleteRenewalSlip,
  readRenewalSlip,
  MIME_EXT,
} = require('../utils/usageRenewalSlips')
const { enrichShopUsage } = require('../utils/shopUsageLimit')

function requireSuperAdminDefault(req, res) {
  if (!req.isSuperAdmin || req.shop.slug !== 'default') {
    res.status(403).json({ error: 'เฉพาะแอดมินหลัก (default) เท่านั้น' })
    return false
  }
  return true
}

function requireBranchShop(req, res) {
  if (req.shop.slug === 'default') {
    res.status(400).json({ error: 'ร้าน default ไม่ต้องต่ออายุผ่านหน้านี้' })
    return false
  }
  return true
}

function mapSubmissionRow(row) {
  return {
    id: row.id,
    shop_id: row.shop_id,
    shop_slug: row.shop_slug,
    shop_name: row.shop_name,
    months: row.months,
    amount_baht: row.amount_baht,
    option_id: row.option_id || null,
    option_label: row.option_label || null,
    includes_line_push: row.includes_line_push == null ? null : !!row.includes_line_push,
    slip_filename: row.slip_filename,
    status: row.status,
    admin_note: row.admin_note,
    created_by_user_id: row.created_by_user_id,
    reviewed_by_user_id: row.reviewed_by_user_id,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

router.get('/settings', async (req, res) => {
  try {
    const pool = getPool()
    const settings = await getRenewalSettings(pool)
    const isManager = req.isSuperAdmin && req.shop.slug === 'default'
    res.json({
      ...settings,
      can_edit: isManager,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/settings', async (req, res) => {
  if (!requireSuperAdminDefault(req, res)) return
  try {
    const pool = getPool()
    const body = req.body || {}
    const partial = {}
    if (Object.prototype.hasOwnProperty.call(body, 'promptpay_id')) {
      partial.promptpay_id = body.promptpay_id
    }
    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      partial.description = body.description
    }
    if (Object.prototype.hasOwnProperty.call(body, 'prices')) {
      partial.prices = parsePrices(body.prices)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'options')) {
      partial.options = normalizeOptionsInput(body.options)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'price_per_month_no_line')) {
      partial.price_per_month_no_line = body.price_per_month_no_line
    }
    if (Object.prototype.hasOwnProperty.call(body, 'price_per_month_with_line')) {
      partial.price_per_month_with_line = body.price_per_month_with_line
    }
    if (Object.prototype.hasOwnProperty.call(body, 'banner_days_before')) {
      partial.banner_days_before = body.banner_days_before
    }
    const settings = await setRenewalSettings(pool, partial)
    res.json({ success: true, settings })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/submissions', async (req, res) => {
  try {
    const pool = getPool()
    const isManager = req.isSuperAdmin && req.shop.slug === 'default'
    const params = []
    let where = ''
    if (!isManager) {
      if (!requireBranchShop(req, res)) return
      params.push(req.shop.id)
      where = `WHERE urs.shop_id = $1`
    }

    const result = await pool.query(
      `
        SELECT
          urs.*,
          s.slug AS shop_slug,
          s.name AS shop_name
        FROM usage_renewal_submissions urs
        JOIN shops s ON s.id = urs.shop_id
        ${where}
        ORDER BY urs.created_at DESC
      `,
      params
    )
    res.json(result.rows.map(mapSubmissionRow))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

async function applyRenewalConfirm(pool, shopId, months, includesLinePush) {
  await extendShopUsageByMonths(pool, shopId, months)
  if (includesLinePush != null) {
    await setLinePushSettings(pool, shopId, { enabled: !!includesLinePush })
  }
}

router.post('/submissions', async (req, res) => {
  if (!requireBranchShop(req, res)) return

  const tier = parseTier(req.body?.tier)
  const optionId = String(req.body?.option_id || '').trim()
  let months = null
  let amount = null
  let optionLabel = null
  let includesLinePush = null
  let storedOptionId = optionId || null

  const parsed = parseBase64Image(req.body?.image_data, req.body?.image_mime)
  if (!parsed) return res.status(400).json({ error: 'ต้องอัปโหลดสลิปการชำระ' })
  if (parsed.error) return res.status(400).json({ error: parsed.error })

  try {
    const pool = getPool()
    const settings = await getRenewalSettings(pool)

    if (tier) {
      months = Math.floor(Number(req.body?.months))
      if (!Number.isInteger(months) || months < 1 || months > 12) {
        return res.status(400).json({ error: 'เลือกจำนวนเดือน 1–12' })
      }
      amount = priceForTierMonths(settings, tier, months)
      includesLinePush = tierIncludesLine(tier)
      optionLabel = buildTierLabel(tier, months)
      storedOptionId = tierOptionId(tier)
    } else if (optionId) {
      const option = findActiveOption(settings, optionId)
      if (!option) {
        return res.status(400).json({ error: 'ตัวเลือกไม่ถูกต้องหรือปิดใช้งานแล้ว' })
      }
      months = option.months
      amount = option.price
      optionLabel = option.label
      includesLinePush = option.includes_line_push ?? null
    } else {
      months = Math.floor(Number(req.body?.months))
      if (!Number.isInteger(months) || months < 1 || months > 12) {
        return res.status(400).json({ error: 'เลือกแพ็กต่ออายุ' })
      }
      amount = priceForMonth(settings, months)
      const matched = (settings.options || []).find((item) => item.months === months && item.active !== false)
      optionLabel = matched?.label || `${months} เดือน`
    }

    if (!amount) {
      return res.status(400).json({ error: 'ยังไม่ได้ตั้งราคาสำหรับแพ็กนี้ ติดต่อแอดมินหลัก' })
    }
    if (!normalizePromptPay(settings.promptpay_id)) {
      return res.status(400).json({ error: 'แอดมินหลักยังไม่ได้ตั้ง PromptPay สำหรับต่ออายุ' })
    }

    const slipFilename = await saveRenewalSlip(parsed.buffer, parsed.ext)
    const result = await pool.query(
      `
        INSERT INTO usage_renewal_submissions (
          shop_id, months, amount_baht, option_id, option_label, includes_line_push,
          slip_filename, status, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
        RETURNING *
      `,
      [
        req.shop.id,
        months,
        amount,
        storedOptionId,
        optionLabel,
        includesLinePush,
        slipFilename,
        req.user.id,
      ]
    )

    const row = result.rows[0]
    const withShop = await pool.query(
      `
        SELECT urs.*, s.slug AS shop_slug, s.name AS shop_name
        FROM usage_renewal_submissions urs
        JOIN shops s ON s.id = urs.shop_id
        WHERE urs.id = $1
      `,
      [row.id]
    )
    res.status(201).json({ success: true, submission: mapSubmissionRow(withShop.rows[0]) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/submissions/:id', async (req, res) => {
  if (!requireSuperAdminDefault(req, res)) return

  const status = req.body?.status
  const allowed = ['pending', 'confirmed', 'cancelled']
  if (status != null && !allowed.includes(status)) {
    return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' })
  }

  const tier = req.body?.tier != null ? parseTier(req.body.tier) : null
  const optionId = req.body?.option_id != null ? String(req.body.option_id).trim() || null : null
  const months = req.body?.months != null ? Math.floor(Number(req.body.months)) : null
  if (months != null && (!Number.isInteger(months) || months < 1 || months > 12)) {
    return res.status(400).json({ error: 'จำนวนเดือน 1–12' })
  }

  try {
    const pool = getPool()
    const existing = await pool.query(
      `SELECT * FROM usage_renewal_submissions WHERE id = $1 LIMIT 1`,
      [req.params.id]
    )
    const row = existing.rows[0]
    if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' })

    const nextStatus = status ?? row.status
    let nextMonths = months ?? row.months
    let nextAmount = row.amount_baht
    let nextOptionId = row.option_id
    let nextOptionLabel = row.option_label
    let nextIncludesLinePush = row.includes_line_push

    const settings = await getRenewalSettings(pool)

    if (tier) {
      const tierMonths = months ?? row.months
      nextMonths = tierMonths
      nextAmount = priceForTierMonths(settings, tier, tierMonths)
      if (!nextAmount) {
        return res.status(400).json({ error: 'ราคาแพ็กไม่ถูกต้อง' })
      }
      nextOptionId = tierOptionId(tier)
      nextOptionLabel = buildTierLabel(tier, tierMonths)
      nextIncludesLinePush = tierIncludesLine(tier)
    } else if (optionId) {
      const option = findOption(settings, optionId)
      if (!option) {
        return res.status(400).json({ error: 'ตัวเลือกไม่ถูกต้อง' })
      }
      nextMonths = option.months
      nextAmount = option.price
      nextOptionId = option.id
      nextOptionLabel = option.label
      nextIncludesLinePush = option.includes_line_push ?? null
    } else if (months != null) {
      nextAmount = priceForMonth(settings, nextMonths)
      if (!nextAmount) {
        return res.status(400).json({ error: 'ยังไม่ได้ตั้งราคาสำหรับจำนวนเดือนนี้' })
      }
      const matched = (settings.options || []).find((item) => item.months === nextMonths)
      nextOptionLabel = matched?.label || `${nextMonths} เดือน`
    }

    const adminNote = Object.prototype.hasOwnProperty.call(req.body || {}, 'admin_note')
      ? (req.body.admin_note == null ? null : String(req.body.admin_note).trim() || null)
      : row.admin_note

    const wasConfirmed = row.status === 'confirmed'
    const willConfirm = nextStatus === 'confirmed' && row.status !== 'confirmed'

    if (wasConfirmed && nextStatus !== 'confirmed') {
      return res.status(400).json({
        error: 'รายการที่ยืนยันแล้วไม่สามารถเปลี่ยนสถานะได้ — ลบแล้วส่งใหม่ถ้าจำเป็น',
      })
    }

    await pool.query(
      `
        UPDATE usage_renewal_submissions
        SET
          months = $1,
          amount_baht = $2,
          option_id = $3,
          option_label = $4,
          includes_line_push = $5,
          status = $6,
          admin_note = $7,
          reviewed_by_user_id = $8,
          reviewed_at = CASE WHEN $6 IN ('confirmed', 'cancelled') THEN NOW() ELSE reviewed_at END,
          updated_at = NOW()
        WHERE id = $9
      `,
      [
        nextMonths,
        nextAmount,
        nextOptionId,
        nextOptionLabel,
        nextIncludesLinePush,
        nextStatus,
        adminNote,
        req.user.id,
        req.params.id,
      ]
    )

    if (willConfirm) {
      await applyRenewalConfirm(pool, row.shop_id, nextMonths, nextIncludesLinePush)
    }

    const withShop = await pool.query(
      `
        SELECT urs.*, s.slug AS shop_slug, s.name AS shop_name
        FROM usage_renewal_submissions urs
        JOIN shops s ON s.id = urs.shop_id
        WHERE urs.id = $1
      `,
      [req.params.id]
    )
    res.json({
      success: true,
      submission: mapSubmissionRow(withShop.rows[0]),
      shop: enrichShopUsage(
        (
          await pool.query(
            `SELECT id, slug, name, is_active, created_at, usage_limit_days, usage_started_at FROM shops WHERE id = $1`,
            [row.shop_id]
          )
        ).rows[0]
      ),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/submissions/:id', async (req, res) => {
  if (!requireSuperAdminDefault(req, res)) return
  try {
    const pool = getPool()
    const existing = await pool.query(
      `SELECT * FROM usage_renewal_submissions WHERE id = $1 LIMIT 1`,
      [req.params.id]
    )
    const row = existing.rows[0]
    if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' })

    await pool.query(`DELETE FROM usage_renewal_submissions WHERE id = $1`, [req.params.id])
    await deleteRenewalSlip(row.slip_filename)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/slips/:filename', async (req, res) => {
  try {
    const pool = getPool()
    const filename = String(req.params.filename || '').trim()
    const owned = await pool.query(
      `
        SELECT urs.shop_id, s.slug AS shop_slug
        FROM usage_renewal_submissions urs
        JOIN shops s ON s.id = urs.shop_id
        WHERE urs.slip_filename = $1
        LIMIT 1
      `,
      [filename]
    )
    const row = owned.rows[0]
    if (!row) return res.status(404).json({ error: 'ไม่พบสลิป' })

    const isManager = req.isSuperAdmin && req.shop.slug === 'default'
    if (!isManager && row.shop_id !== req.shop.id) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูสลิปนี้' })
    }

    const buffer = await readRenewalSlip(filename)
    if (!buffer) return res.status(404).json({ error: 'ไม่พบไฟล์สลิป' })

    const ext = filename.split('.').pop()?.toLowerCase()
    const mime = Object.entries(MIME_EXT).find(([, v]) => v === ext)?.[0] || 'image/jpeg'
    res.set('Cache-Control', 'private, max-age=3600')
    res.type(mime)
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
