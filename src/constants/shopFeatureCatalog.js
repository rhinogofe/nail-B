/** Feature groups and items controllable per shop branch (super admin). */
const SHOP_FEATURE_CATALOG = [
  {
    key: 'customer_nav',
    label: 'เมนูลูกค้า',
    icon: 'ti-users',
    hint: 'เปิด/ปิดรายการในแถบเมนูล่าง — ตั้งค่าเนื้อหาในกลุ่ม "UI & ข้อความ" และ "เนื้อหา"',
    items: [
      { key: 'nav_reviews', label: 'รีวิว', default: true },
      { key: 'nav_location', label: 'ที่อยู่ร้าน', default: true },
      { key: 'nav_chat', label: 'แชท', default: true },
    ],
  },
  {
    key: 'admin_tabs',
    label: 'แท็บแอดมิน',
    icon: 'ti-layout-navbar',
    hint: 'เปิด/ปิดแท็บในหน้าแอดมิน — ตั้งค่ารายละเอียดในกลุ่มด้านล่าง',
    items: [
      { key: 'tab_bookings', label: 'จัดการคิว', default: true, locked: true },
      { key: 'tab_revenue', label: 'สรุปยอด', default: true },
      { key: 'tab_services', label: 'บริการ', default: true },
      { key: 'tab_settings', label: 'ตั้งค่า', default: true },
      { key: 'tab_ui', label: 'UI', default: true },
      { key: 'tab_blocks', label: 'เวลา', default: true },
      { key: 'tab_reviews', label: 'รีวิว', default: true },
      { key: 'tab_renewal', label: 'ต่ออายุ', default: true },
      { key: 'tab_manual', label: 'คู่มือ', default: true },
      { key: 'tab_users', label: 'ผู้ใช้', default: true },
    ],
  },
  {
    key: 'admin_settings',
    label: 'ตั้งค่าระบบ',
    icon: 'ti-settings',
    hint: 'หัวข้อในแท็บตั้งค่า — ต้องเปิดแท็บ "ตั้งค่า" ก่อน',
    items: [
      { key: 'settings_deposit', label: 'มัดจำ', default: true, setup: { tab: 'settings', settingsSection: 'deposit' } },
      { key: 'settings_coupon', label: 'คูปองแลกแต้ม', default: true, setup: { tab: 'settings', settingsSection: 'coupon' } },
      { key: 'settings_line', label: 'LINE แจ้งเตือน', default: true, setup: { tab: 'settings', settingsSection: 'line' } },
      { key: 'settings_chat_notify', label: 'แจ้งเตือนในแอป', default: true, setup: { tab: 'settings', settingsSection: 'chat-notify' } },
      { key: 'settings_unpaid', label: 'ยกเลิกอัตโนมัติ', default: true, setup: { tab: 'settings', settingsSection: 'unpaid' } },
      { key: 'settings_locations', label: 'สถานที่บริการในแต่ละวัน', default: true, setup: { tab: 'settings', settingsSection: 'locations' } },
      { key: 'settings_use_coupon', label: 'ใช้คูปอง', default: true, setup: { tab: 'settings', settingsSection: 'use-coupon' } },
    ],
  },
  {
    key: 'admin_ui',
    label: 'UI & ข้อความ',
    icon: 'ti-palette',
    hint: 'ข้อความและรูปแบบที่ลูกค้าเห็น — ต้องเปิดแท็บ "UI" ก่อน · ไม่ซ้ำกับตั้งค่าระบบ',
    items: [
      { key: 'ui_brand', label: 'แบรนด์ & รูปภาพ', configOnly: true, setup: { tab: 'ui', uiSectionTitle: 'แบรนด์ & รูปภาพ' } },
      { key: 'ui_payment', label: 'ชำระเงิน', configOnly: true, setup: { tab: 'ui', uiSectionTitle: 'ชำระเงิน' } },
      { key: 'ui_line', label: 'LINE (ปุ่ม & ข้อความ)', configOnly: true, setup: { tab: 'ui', uiSectionTitle: 'LINE' } },
      { key: 'ui_booking', label: 'ข้อความจองคิว', configOnly: true, setup: { tab: 'ui', uiSectionTitle: 'ข้อความจองคิว' } },
      { key: 'ui_pages', label: 'หน้าอื่นๆ', configOnly: true, setup: { tab: 'ui', uiSectionTitle: 'หน้าอื่นๆ' } },
      { key: 'ui_admin', label: 'แอดมิน', configOnly: true, setup: { tab: 'ui', uiSectionTitle: 'แอดมิน' } },
      { key: 'ui_theme', label: 'สีธีม', configOnly: true, setup: { tab: 'ui', uiSectionTitle: 'สีธีม' } },
    ],
  },
  {
    key: 'admin_content',
    label: 'เนื้อหา',
    icon: 'ti-photo',
    hint: 'ข้อมูลที่แสดงในแอป — คลิปรีวิวและรายการบริการ',
    items: [
      { key: 'content_reviews', label: 'คลิปรีวิว (TikTok / Instagram)', configOnly: true, setup: { tab: 'reviews' } },
      { key: 'content_services', label: 'รายการบริการ', configOnly: true, setup: { tab: 'services' } },
    ],
  },
  {
    key: 'admin_blocks',
    label: 'เวลา & คิว',
    icon: 'ti-calendar-off',
    hint: 'หัวข้อในแท็บเวลา — ต้องเปิดแท็บ "เวลา" ก่อน',
    items: [
      { key: 'blocks_shop_hours', label: 'เวลาเปิด-ปิดปกติ', default: true, setup: { tab: 'blocks', blocksSection: 'shop-hours' } },
      { key: 'blocks_day_hours', label: 'เวลาเปิด-ปิดเฉพาะวัน', default: true, setup: { tab: 'blocks', blocksSection: 'day-hours' } },
      { key: 'blocks_slot_display', label: 'ความยาวคิว & แสดงผล', default: true, setup: { tab: 'blocks', blocksSection: 'slot-display' } },
      { key: 'blocks_advance', label: 'จองล่วงหน้า', default: true, setup: { tab: 'blocks', blocksSection: 'advance' } },
      { key: 'blocks_bulk', label: 'ปิดหลายวัน', default: true, setup: { tab: 'blocks', blocksSection: 'bulk' } },
      { key: 'blocks_calendar', label: 'ปิดทีละวัน', default: true, setup: { tab: 'blocks', blocksSection: 'calendar' } },
    ],
  },
  {
    key: 'booking_features',
    label: 'ฟังก์ชันจอง/ชำระ',
    icon: 'ti-calendar-check',
    hint: 'เปิด/ปิดความสามารถใน flow จอง — รายละเอียดตั้งในกลุ่ม ตั้งค่าระบบ / UI & ข้อความ / เวลา & คิว',
    items: [
      {
        key: 'feat_payment_slip',
        label: 'อัปโหลดสลิปชำระเงิน',
        default: true,
        configNote: 'ตั้งค่า: UI & ข้อความ → ชำระเงิน · ตั้งค่าระบบ → มัดจำ',
      },
      {
        key: 'feat_coupon_points',
        label: 'สะสมแต้ม / คูปอง',
        default: true,
        configNote: 'ตั้งค่า: ตั้งค่าระบบ → คูปองแลกแต้ม · ใช้คูปอง',
      },
      {
        key: 'feat_extend_booking',
        label: 'ขยายเวลาตามบริการ',
        default: true,
        configNote: 'ตั้งค่า: เวลา & คิว → ความยาวคิว & แสดงผล · UI & ข้อความ → ข้อความจองคิว',
      },
    ],
  },
]

const FEATURE_ITEM_MAP = Object.fromEntries(
  SHOP_FEATURE_CATALOG.flatMap((group) =>
    group.items
      .filter((item) => !item.configOnly)
      .map((item) => [item.key, { ...item, groupKey: group.key, groupLabel: group.label }])
  )
)

const ALL_FEATURE_KEYS = Object.keys(FEATURE_ITEM_MAP)

function featureSettingKey(itemKey) {
  return `feature_${itemKey}`
}

function featureDefaultSettingKey(itemKey) {
  return `feature_default_${itemKey}`
}

function catalogDefaultEnabled(itemKey) {
  const item = FEATURE_ITEM_MAP[itemKey]
  if (!item) return true
  if (item.locked) return true
  return item.default !== false
}

module.exports = {
  SHOP_FEATURE_CATALOG,
  FEATURE_ITEM_MAP,
  ALL_FEATURE_KEYS,
  featureSettingKey,
  featureDefaultSettingKey,
  catalogDefaultEnabled,
}
