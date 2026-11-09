'use strict';
// اختبارات بيانات البطاقات (data/*.json) وصورها
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cards = require('../server/cards');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
}

console.log('Cards tests');
const football = cards.getDeck('football');
const anime = cards.getDeck('anime');

test('35 لاعب كرة قدم و40 شخصية أنمي', () => {
  assert.strictEqual(football.length, 35);
  assert.strictEqual(anime.length, 40);
});

test('توزيع الأنمي: 7/7/7/7/6/6', () => {
  const counts = {};
  anime.forEach((c) => { counts[c.series] = (counts[c.series] || 0) + 1; });
  assert.deepStrictEqual(counts, { onepiece: 7, naruto: 7, aot: 7, jjk: 7, demonslayer: 6, blackclover: 6 });
});

test('كل بطاقة فيها الحقول المطلوبة وتصنيف (ومن غير سعر ابتدائي)', () => {
  for (const c of [...football, ...anime]) {
    assert.ok(c.id && c.nameAr && c.nameEn && c.info, c.id);
    assert.ok(Number.isFinite(c.rating) && c.rating > 0 && c.rating <= 100, c.id);
    assert.ok(c.startPrice === undefined, 'مفيش سعر ابتدائي: ' + c.id);
    assert.ok(['legend', 'epic', 'rare', 'common'].includes(c.tier), c.id);
  }
});

test('الـ id مش مكرر بين كل البطاقات', () => {
  const ids = [...football, ...anime].map((c) => c.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('كل ملفات الصور موجودة فعلًا', () => {
  for (const c of [...football, ...anime]) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', c.image)), c.id + ' ' + c.image);
  }
});

test('الخلط عشوائي ومش بيغيّر المحتوى', () => {
  const a = cards.getDeck('football').map((c) => c.id).sort().join();
  const b = football.map((c) => c.id).sort().join();
  assert.strictEqual(a, b);
});

test('نوع غير صحيح يترفض', () => {
  assert.throws(() => cards.getDeck('cars'));
});

test('حدود التصنيف', () => {
  assert.strictEqual(cards.tierFor(95), 'legend');
  assert.strictEqual(cards.tierFor(85), 'rare');
  assert.strictEqual(cards.tierFor(80), 'common');
});

console.log(`\n${passed} اختبار نجح`);
