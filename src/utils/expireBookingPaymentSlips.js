const { deleteBookingPaymentSlip } = require('./bookingPaymentSlips')
const { getBookingSlipRetentionDays } = require('./bookingPaymentSlipSettings')

async function expireBookingPaymentSlips(poolOrClient) {
  const shopsResult = await poolOrClient.query(`SELECT id FROM shops`)
  let deleted = 0

  for (const shop of shopsResult.rows) {
    const retentionDays = await getBookingSlipRetentionDays(poolOrClient, shop.id)
    const result = await poolOrClient.query(
      `
        SELECT id, slip_filename
        FROM booking_payment_slips
        WHERE shop_id = $1
          AND created_at < NOW() - ($2::int * INTERVAL '1 day')
      `,
      [shop.id, retentionDays]
    )

    for (const row of result.rows) {
      await deleteBookingPaymentSlip(row.slip_filename)
      await poolOrClient.query(`DELETE FROM booking_payment_slips WHERE id = $1`, [row.id])
      deleted += 1
    }
  }

  return deleted
}

module.exports = { expireBookingPaymentSlips }
