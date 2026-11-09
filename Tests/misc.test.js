'use strict';
// اختبارات محدد المعدّل ومدير الغرف
const assert = require('assert');
const { createLimiter } = require('../server/rateLimiter');
const manager = require('../server/roomManager');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
}

console.log('Limiter + Manager tests');

test('محدد المعدّل: يسمح بـ max ويرفض الزيادة ثم يسمح بعد انتهاء النافذة', () => {
  const l = createLimiter({ max: 3, windowMs: 1000 });
  assert.ok(l.allow('ip', 0) && l.allow('ip', 10) && l.allow('ip', 20));
  assert.strictEqual(l.allow('ip', 30), false);
  assert.ok(l.allow('other', 30), 'مفتاح تاني مش متأثر');
  assert.ok(l.allow('ip', 1100), 'بعد النافذة');
  l.sweep(5000);
  assert.strictEqual(l.size(), 0);
});

test('مدير الغرف: إنشاء وبحث (بدون حساسية لحالة الحروف) وحذف', () => {
  const room = manager.createRoom('anime', () => {});
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{5}$/);
  assert.strictEqual(manager.getRoom(room.code.toLowerCase()), room);
  assert.strictEqual(manager.getRoom(' ' + room.code + ' '), room);
  assert.strictEqual(manager.getRoom(null), undefined);
  manager.removeRoom(room.code);
  assert.strictEqual(manager.getRoom(room.code), undefined);
});

test('مدير الغرف: نوع مزاد غلط يرمي خطأ', () => {
  assert.throws(() => manager.createRoom('cars', () => {}));
});

test('removeAll بيمسح كل الغرف', () => {
  manager.createRoom('football', () => {});
  manager.createRoom('anime', () => {});
  manager.removeAll();
  assert.strictEqual(manager.size(), 0);
});

console.log(`\n${passed} اختبار نجح`);
