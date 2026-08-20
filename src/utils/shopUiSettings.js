const { getShopSettings, setShopSettings, ensureShopSettings } = require('./shopSettings')

const UI_DEFAULTS = {
  ui_brand_main: 'Nail',
  ui_brand_accent: 'Thuean',
  ui_tagline: 'จองคิวง่าย · สะสมแต้ม',
  ui_page_title: 'Nail Thuean',
  ui_logo_url: '',
  ui_hero_image_url: '',
  ui_shop_map_url: '',
  ui_shop_map_embed_url: '',
  ui_shop_address_detail: '',
  ui_shop_location_nav_label: 'ที่อยู่ร้าน',
  ui_shop_location_page_title: 'ที่อยู่ร้าน',
  ui_shop_open_maps_btn: 'เปิดใน Google Maps',

  ui_line_chat_url: 'https://line.me',
  ui_bank_name: 'ธนาคารกสิกรไทย',
  ui_bank_account_name: 'Nail Studio',
  ui_bank_account_no: '',
  ui_promptpay_id: '',
  ui_kshop_qr_url: '',
  ui_thai_qr_label: 'สแกน Thai QR เพื่อชำระมัดจำ',
  ui_line_button_label: 'ส่งสลิปทาง LINE',
  ui_line_message_template:
    'ส่งสลิปมัดจำคิว\nBooking: {bookingId}\nวันที่: {date}\nเวลา: {start} – {end}\nยอด: {amount} บาท',
  ui_payment_page_title: 'ชำระเงินมัดจำ',
  ui_payment_slip_upload_enabled: '0',
  ui_payment_notice_off: 'กรุณาชำระมัดจำและส่งสลิปให้แอดมินยืนยัน',
  ui_payment_notice_timer:
    'กรุณาชำระภายใน {hours} ชม. นับจากเวลาจอง มิฉะนั้นคิวจะถูกยกเลิกอัตโนมัติ',
  ui_payment_hint:
    'หลังส่งสลิป แอดมินจะยืนยันการชำระเงิน และคิวจะเปลี่ยนเป็นพร้อมให้บริการ',
  ui_payment_expired: 'คิวนี้หมดเวลาชำระแล้ว ถูกยกเลิกอัตโนมัติ',
  ui_payment_not_awaiting: 'คิวนี้ไม่อยู่ในสถานะรอชำระเงินแล้ว',
  ui_qr_not_configured: 'ยังไม่ได้ตั้งค่า PromptPay ID',
  ui_qr_generate_failed: 'สร้าง QR ไม่สำเร็จ กรุณาตรวจสอบ PromptPay ID',
  ui_copy_account_hint: 'แตะเพื่อคัดลอก',
  ui_copy_success: 'คัดลอกแล้ว',

  ui_booking_success_title: 'จองแล้ว รอชำระเงิน',
  ui_booking_success_text: 'กรุณาโอนและส่งสลิปทาง LINE เพื่อรอแอดมินยืนยัน',
  ui_booking_success_btn: 'ไปหน้าชำระเงิน',
  ui_booking_fail_title: 'จองไม่สำเร็จ',
  ui_cancel_confirm_title: 'ยืนยันการยกเลิก',
  ui_cancel_confirm_text: 'ต้องการยกเลิกคิวนี้ใช่ไหม',
  ui_cancel_success_title: 'ยกเลิกสำเร็จ',
  ui_cancel_fail_title: 'ยกเลิกไม่สำเร็จ',
  ui_points_banner: 'เมื่อช่างทำเสร็จ คุณจะได้รับ <strong>+{points} แต้ม</strong>',
  ui_closed_day_error: 'ช่วงนี้ร้านปิดรับคิวทั้งวัน กรุณาเลือกวันอื่น',
  ui_no_services_today: 'ไม่มีบริการให้เลือกในวันนี้',
  ui_date_nav_hint: 'ลากเลื่อนหรือกด … เพื่อดูวันถัดไป',
  ui_no_open_days: 'ไม่มีวันเปิดรับคิวในช่วงที่เปิดจอง',
  ui_slot_taken_error: 'เวลานี้เพิ่งถูกจองแล้ว กรุณาเลือกช่วงเวลาอื่น',
  ui_extend_blocked_next_booking:
    'เวลารวมบริการของท่านยาวกว่าเวลาคิวเนื่องจากมีคิวต่อถัดไปไม่สามารถขยายเวลาได้',
  ui_extend_blocked_closing:
    'เวลารวมบริการของท่านยาวกว่าเวลาคิวเนื่องจากชนเวลาปิดร้านไม่สามารถขยายเวลาได้',

  ui_profile_title: 'บัญชีของฉัน',
  ui_profile_subtitle: 'แก้ไขข้อมูลและดูประวัติการจอง',

  ui_reviews_title: 'รีวิว',
  ui_reviews_subtitle: 'ผลงานจาก TikTok และ Instagram',
  ui_reviews_empty: 'ยังไม่มีคลิปรีวิว',
  ui_reviews_empty_hint: 'รอแอดมินเพิ่มลิงก์ TikTok หรือ Instagram',

  ui_shop_picker_title: 'เลือกร้าน',
  ui_shop_picker_subtitle: 'เลือกสาขาที่ต้องการจองคิว',

  ui_admin_add_staff_btn: 'เพิ่มช่าง',

  ui_color_primary: '#C4847A',
  ui_color_primary_dark: '#A66B62',
  ui_color_primary_light: '#F5E8E6',
}

const UI_KEYS = Object.keys(UI_DEFAULTS)

function mergeUiSettings(raw = {}) {
  const merged = { ...UI_DEFAULTS }
  for (const key of UI_KEYS) {
    if (raw[key] != null && String(raw[key]).trim() !== '') {
      merged[key] = String(raw[key])
    }
  }
  return merged
}

async function getUiSettings(poolOrClient, shopId) {
  const map = await getShopSettings(poolOrClient, shopId, UI_KEYS)
  return mergeUiSettings(map)
}

async function setUiSettings(poolOrClient, shopId, partial) {
  const entries = {}
  for (const key of UI_KEYS) {
    if (Object.prototype.hasOwnProperty.call(partial, key)) {
      entries[key] = partial[key] == null ? '' : String(partial[key])
    }
  }
  if (Object.keys(entries).length) {
    await setShopSettings(poolOrClient, shopId, entries)
  }
  return getUiSettings(poolOrClient, shopId)
}

async function ensureUiSettings(poolOrClient, shopId) {
  await ensureShopSettings(poolOrClient, shopId, UI_DEFAULTS)
}

module.exports = {
  UI_DEFAULTS,
  UI_KEYS,
  mergeUiSettings,
  getUiSettings,
  setUiSettings,
  ensureUiSettings,
}
