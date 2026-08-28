const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs').promises
const path = require('path')
const os = require('os')
const { collectShopFileRefs, purgeShopUploadFiles } = require('../src/utils/deleteShopFiles')

test('collectShopFileRefs gathers slip filenames and upload dirs', async () => {
  const shopId = '11111111-1111-1111-1111-111111111111'
  const pool = {
    query(sql, params) {
      if (sql.includes('booking_payment_slips')) {
        assert.equal(params[0], shopId)
        return Promise.resolve({ rows: [{ slip_filename: 'slip-a.png' }] })
      }
      if (sql.includes('usage_renewal_submissions')) {
        return Promise.resolve({ rows: [{ slip_filename: 'renewal-b.jpg' }] })
      }
      return Promise.resolve({ rows: [] })
    },
  }

  const refs = await collectShopFileRefs(pool, shopId)
  assert.deepEqual(refs.bookingSlipFilenames, ['slip-a.png'])
  assert.deepEqual(refs.renewalSlipFilenames, ['renewal-b.jpg'])
  assert.match(refs.uiDir, new RegExp(`${shopId.replace(/-/g, '\\-')}$`))
  assert.match(refs.chatDir, new RegExp(`${shopId.replace(/-/g, '\\-')}$`))
})

test('purgeShopUploadFiles removes ui/chat dirs and slip files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nail-delete-shop-'))
  const prevUploadRoot = process.env.UPLOAD_ROOT
  process.env.UPLOAD_ROOT = root

  try {
    const shopId = '22222222-2222-2222-2222-222222222222'
    const uiDir = path.join(root, 'ui', shopId, 'logo')
    const chatDir = path.join(root, 'chat', shopId)
    const bookingSlip = path.join(root, 'booking-slips', 'pay-slip.png')
    const renewalSlip = path.join(root, 'renewal', 'renew-slip.png')

    await fs.mkdir(uiDir, { recursive: true })
    await fs.writeFile(path.join(uiDir, 'logo.png'), 'logo')
    await fs.mkdir(chatDir, { recursive: true })
    await fs.writeFile(path.join(chatDir, 'chat.png'), 'chat')
    await fs.mkdir(path.dirname(bookingSlip), { recursive: true })
    await fs.writeFile(bookingSlip, 'slip')
    await fs.mkdir(path.dirname(renewalSlip), { recursive: true })
    await fs.writeFile(renewalSlip, 'renew')

    const summary = await purgeShopUploadFiles({
      shopId,
      bookingSlipFilenames: ['pay-slip.png'],
      renewalSlipFilenames: ['renew-slip.png'],
      uiDir: path.join(root, 'ui', shopId),
      chatDir: path.join(root, 'chat', shopId),
    })

    assert.equal(summary.booking_slips, 1)
    assert.equal(summary.renewal_slips, 1)
    assert.equal(summary.ui_dir_removed, true)
    assert.equal(summary.chat_dir_removed, true)
    assert.equal(summary.errors.length, 0)

    await assert.rejects(() => fs.access(bookingSlip))
    await assert.rejects(() => fs.access(renewalSlip))
    await assert.rejects(() => fs.access(path.join(uiDir, 'logo.png')))
    await assert.rejects(() => fs.access(path.join(chatDir, 'chat.png')))
  } finally {
    if (prevUploadRoot == null) delete process.env.UPLOAD_ROOT
    else process.env.UPLOAD_ROOT = prevUploadRoot
    await fs.rm(root, { recursive: true, force: true })
  }
})
