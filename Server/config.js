'use strict';
// ============================================================
// إعدادات اللعبة. كل القيم هنا قابلة للتعديل.
// القيم المعلّمة (مقترحة) لسه محتاجة موافقتك عليها.
// ممكن تغيّرها هنا، أو من ملف .env (PORT / START_BUDGET / AUCTION_SECONDS ...).
// ============================================================
const fs = require('fs');
const path = require('path');

// تحميل بسيط لملف .env (بدون أي مكتبة خارجية)
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2];
      }
    }
  }
} catch (e) {
  console.warn('تعذّرت قراءة .env:', e.message);
}

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

module.exports = {
  PORT: num('PORT', 3000),

  // ---- قيم مقترحة (محتاجة موافقتك) ----
  START_BUDGET: num('START_BUDGET', 300),          // ميزانية كل لاعب (بالمليون)
  AUCTION_SECONDS: num('AUCTION_SECONDS', 20),     // مدة المزايدة على كل بطاقة
  EXTEND_WINDOW_SECONDS: num('EXTEND_WINDOW_SECONDS', 5), // لو المزايدة جت في آخر X ثانية يتمدد الوقت
  EXTEND_SECONDS: num('EXTEND_SECONDS', 5),        // الوقت المتبقي بعد التمديد
  MIN_BID_INCREMENT: num('MIN_BID_INCREMENT', 5),  // أقل زيادة عن أعلى مزايدة
  RESULT_DELAY_SECONDS: num('RESULT_DELAY_SECONDS', 4), // مدة عرض نتيجة البطاقة قبل التالية

  // مفيش سعر ابتدائي للبطاقات. اللاعب اللي عليه الدور يفتح المزايدة بأي مبلغ >= الحد ده
  MIN_OPENING_BID: num('MIN_OPENING_BID', 5),

  // ---- ثابتة حسب وصف المشروع ----
  TEAM_SIZE: 5,
  MAX_PLAYERS_PER_ROOM: 2,

  // ---- حدود التقييم لتصنيف الندرة ----
  TIER_LEGEND: num('TIER_LEGEND', 95),
  TIER_EPIC: num('TIER_EPIC', 90),
  TIER_RARE: num('TIER_RARE', 85),

  // ---- حماية وتنظيف ----
  MAX_ROOMS: num('MAX_ROOMS', 200),                       // أقصى عدد غرف في نفس الوقت
  WAITING_GRACE_SECONDS: num('WAITING_GRACE_SECONDS', 20), // لو لاعب انقطع في غرفة الانتظار، يتشال بعد المدة دي
  CREATE_PER_MINUTE: num('CREATE_PER_MINUTE', 10),        // أقصى إنشاء غرف في الدقيقة لكل IP
  JOIN_PER_MINUTE: num('JOIN_PER_MINUTE', 30),            // أقصى محاولات انضمام في الدقيقة لكل IP
  REJOIN_PER_MINUTE: num('REJOIN_PER_MINUTE', 60),
  TRUST_PROXY: process.env.TRUST_PROXY === '1',           // شغّله (1) لو السيرفر ورا proxy زي Render
  EMPTY_ROOM_TTL_MINUTES: num('EMPTY_ROOM_TTL_MINUTES', 10),
  CURRENCY_LABEL: 'م'
};
