const fs = require('fs').promises
const path = require('path')
const { getUiUploadRoot, getChatUploadRoot } = require('./uploadPaths')
const { deleteBookingPaymentSlip } = require('./bookingPaymentSlips')
const { deleteRenewalSlip } = require('./usageRenewalSlips')

async function collectShopFileRefs(poolOrClient, shopId) {
  const [slips, renewals] = await Promise.all([
    poolOrClient.query(
      `SELECT slip_filename FROM booking_payment_slips WHERE shop_id = $1`,
      [shopId],
    ),
    poolOrClient.query(
      `SELECT slip_filename FROM usage_renewal_submissions WHERE shop_id = $1`,
      [shopId],
    ),
  ])

  return {
    shopId: String(shopId),
    bookingSlipFilenames: slips.rows.map((row) => row.slip_filename).filter(Boolean),
    renewalSlipFilenames: renewals.rows.map((row) => row.slip_filename).filter(Boolean),
    uiDir: path.join(getUiUploadRoot(), String(shopId)),
    chatDir: path.join(getChatUploadRoot(), String(shopId)),
  }
}

async function removeDirIfExists(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true })
    return true
  } catch (err) {
    if (err?.code === 'ENOENT') return false
    throw err
  }
}

async function purgeShopUploadFiles(refs) {
  const summary = {
    booking_slips: 0,
    renewal_slips: 0,
    ui_dir_removed: false,
    chat_dir_removed: false,
    errors: [],
  }

  for (const filename of refs.bookingSlipFilenames || []) {
    try {
      await deleteBookingPaymentSlip(filename)
      summary.booking_slips += 1
    } catch (err) {
      summary.errors.push({
        type: 'booking-slip',
        filename,
        error: err.message,
      })
    }
  }

  for (const filename of refs.renewalSlipFilenames || []) {
    try {
      await deleteRenewalSlip(filename)
      summary.renewal_slips += 1
    } catch (err) {
      summary.errors.push({
        type: 'renewal-slip',
        filename,
        error: err.message,
      })
    }
  }

  try {
    summary.ui_dir_removed = await removeDirIfExists(refs.uiDir)
  } catch (err) {
    summary.errors.push({
      type: 'ui-dir',
      path: refs.uiDir,
      error: err.message,
    })
  }

  try {
    summary.chat_dir_removed = await removeDirIfExists(refs.chatDir)
  } catch (err) {
    summary.errors.push({
      type: 'chat-dir',
      path: refs.chatDir,
      error: err.message,
    })
  }

  return summary
}

module.exports = {
  collectShopFileRefs,
  purgeShopUploadFiles,
}
