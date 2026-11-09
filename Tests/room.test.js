'use strict';
// اختبارات منطق الغرفة والمزاد (بدون شبكة). التشغيل: npm test
const assert = require('assert');
const Room = require('../server/room');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fast = {
  teamSize: 2, maxPlayers: 2, startBudget: 100,
  auctionSeconds: 0.3, extendWindowSeconds: 0.15, extendSeconds: 0.25,
  minIncrement: 5, minOpeningBid: 10, resultDelaySeconds: 0.05, currency: 'م',
};
const mkDeck = () => [
  { id: 'c1', nameAr: 'أ', nameEn: 'A', rating: 90 },
  { id: 'c2', nameAr: 'ب', nameEn: 'B', rating: 80 },
  { id: 'c3', nameAr: 'ج', nameEn: 'C', rating: 70 },
  { id: 'c4', nameAr: 'د', nameEn: 'D', rating: 60 },
  { id: 'c5', nameAr: 'هـ', nameEn: 'E', rating: 50 },
];
function setup(overrides) {
  const room = new Room({ code: 'TEST1', type: 'football', deck: mkDeck(), settings: { ...fast, ...overrides } });
  const a = room.addPlayer('علي', 's1');
  const b = room.addPlayer('Bob', 's2');
  return { room, a: a.token, b: b.token };
}

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
}

(async () => {
  console.log('Room tests');

  await test('لاعبان فقط في الغرفة', () => {
    const { room } = setup();
    assert.strictEqual(room.addPlayer('Carl', 's3').ok, false);
    assert.strictEqual(room.players.length, 2);
  });

  await test('نفس الاسم مرفوض', () => {
    const room = new Room({ code: 'T', type: 'anime', deck: mkDeck(), settings: fast });
    room.addPlayer('Sam', 's1');
    assert.strictEqual(room.addPlayer('Sam', 's2').ok, false);
  });

  await test('منشئ الغرفة فقط يبدأ، ويلزم لاعبين', () => {
    const room = new Room({ code: 'T', type: 'anime', deck: mkDeck(), settings: fast });
    const a = room.addPlayer('A', 's1').token;
    assert.strictEqual(room.start(a).ok, false);
    const b = room.addPlayer('B', 's2').token;
    assert.strictEqual(room.start(b).ok, false);
    assert.strictEqual(room.start(a).ok, true);
    room.destroy();
  });

  await test('لا مزايدة قبل البدء ولا من غريب', () => {
    const { room, a } = setup();
    assert.strictEqual(room.placeBid(a, 50).ok, false);
    room.start(a);
    assert.strictEqual(room.placeBid('fake-token', 50).ok, false);
    room.destroy();
  });

  await test('قواعد المزايدة: حد أدنى، ميزانية، مبلغ غير صالح، نفس اللاعب', () => {
    const { room, a, b } = setup();
    room.start(a);
    const start = room.minNextBid();
    assert.strictEqual(room.placeBid(a, start - 1).ok, false);
    assert.strictEqual(room.placeBid(a, 101).ok, false);
    assert.strictEqual(room.placeBid(a, 25.5).ok, false);
    assert.strictEqual(room.placeBid(a, NaN).ok, false);
    assert.strictEqual(room.placeBid(a, start).ok, true);
    assert.strictEqual(room.placeBid(a, start + 5).ok, false, 'نفس اللاعب');
    assert.strictEqual(room.placeBid(b, start + 4).ok, false, 'أقل من الزيادة الدنيا');
    assert.strictEqual(room.placeBid(b, start + 5).ok, true);
    room.destroy();
  });

  await test('الفائز يُحدد تلقائيًا وتُخصم الميزانية ويتحرك للبطاقة التالية', async () => {
    const { room, a, b } = setup({ resultDelaySeconds: 0.4 });
    room.start(a);
    const first = room.current.card.id;
    room.placeBid(a, 50);
    room.placeBid(b, 60);
    await sleep(380);
    assert.strictEqual(room.phase, 'result');
    assert.strictEqual(room.lastResult.winner, 'Bob');
    assert.strictEqual(room.players[1].budget, 40);
    assert.strictEqual(room.players[1].team[0].id, first);
    assert.strictEqual(room.placeBid(a, 70).ok, false, 'بعد انتهاء الوقت');
    await sleep(400);
    assert.strictEqual(room.phase, 'bidding');
    assert.notStrictEqual(room.current.card.id, first);
    room.destroy();
  });

  await test('تمديد الوقت عند مزايدة في اللحظات الأخيرة', async () => {
    const { room, a } = setup();
    room.start(a);
    await sleep(200); // باقي ~100ms وهو أقل من نافذة التمديد
    const before = room.current.endsAt;
    assert.strictEqual(room.placeBid(a, room.minNextBid()).ok, true);
    assert.ok(room.current.endsAt > before, 'لازم الوقت يتمدد');
    room.destroy();
  });

  await test('بطاقة بدون مزايدات لا تُباع ويكمل المزاد', async () => {
    const { room, a } = setup({ resultDelaySeconds: 0.4 });
    room.start(a);
    await sleep(380);
    assert.strictEqual(room.lastResult.sold, false);
    assert.strictEqual(room.players[0].team.length + room.players[1].team.length, 0);
    room.destroy();
  });

  await test('نهاية المزاد: اللي عليه الدور يفتح المزايدة، وفريقين كاملين وإعلان الفائز بالتقييم', async () => {
    const { room, a, b } = setup();
    room.start(a);
    for (let i = 0; i < 6 && room.status === 'running'; i++) {
      const res = room.placeBid(room.current.opener, room.minNextBid());
      assert.strictEqual(res.ok, true, res.error);
      await sleep(450);
      await sleep(120);
    }
    assert.strictEqual(room.status, 'finished');
    const f = room.finalResult;
    assert.ok(f.players.every((p) => Number.isFinite(p.total)));
    const [x, y] = f.players;
    if (x.total !== y.total) assert.strictEqual(f.winnerName, x.total > y.total ? x.name : y.name);
    room.destroy();
  });

  await test('الدور في فتح المزايدة بيتبدّل: الأول للاعب 1 والتاني للاعب 2', async () => {
    const { room, a, b } = setup({ resultDelaySeconds: 0.05 });
    room.start(a);
    assert.strictEqual(room.current.opener, a);
    const res = room.placeBid(b, room.minNextBid());
    assert.strictEqual(res.ok, false, 'اللاعب 2 ما يفتحش على بطاقة دور اللاعب 1');
    assert.ok(res.error.includes('علي'));
    await sleep(380); // البطاقة خلصت من غير مزايدات
    await sleep(120);
    assert.strictEqual(room.phase, 'bidding');
    assert.strictEqual(room.current.opener, b, 'البطاقة التانية دور اللاعب 2');
    assert.strictEqual(room.placeBid(a, room.minNextBid()).ok, false);
    assert.strictEqual(room.placeBid(b, room.minNextBid()).ok, true);
    // بعد الفتح، اللاعب 1 يقدر يرد
    assert.strictEqual(room.placeBid(a, room.minNextBid()).ok, true);
    room.destroy();
  });

  await test('مفيش سعر ابتدائي للبطاقة: أقل فتح = حد فتح المزايدة العام', () => {
    const { room, a } = setup();
    room.start(a);
    assert.strictEqual(room.minNextBid(), 10);
    assert.strictEqual(room.placeBid(a, 9).ok, false);
    assert.strictEqual(room.placeBid(a, 10).ok, true);
    assert.strictEqual(room.minNextBid(), 15);
    assert.strictEqual('startPrice' in room.stateFor(a).current, false);
    room.destroy();
  });

  await test('إعادة الاتصال تحافظ على حالة اللاعب والمزاد', () => {
    const { room, a } = setup();
    room.start(a);
    room.placeBid(a, room.minNextBid());
    room.disconnect('s1');
    assert.strictEqual(room.players[0].connected, false);
    assert.strictEqual(room.reconnect(a, 's1-new').ok, true);
    const st = room.stateFor(a);
    assert.strictEqual(st.players[0].isYou, true);
    assert.strictEqual(st.current.highBid.isYou, true);
    assert.strictEqual(room.reconnect('bad', 'x').ok, false);
    room.destroy();
  });

  await test('الحالة المُرسلة لا تحتوي توكنات ولا ترتيب المجموعة', () => {
    const { room, a } = setup();
    room.start(a);
    const json = JSON.stringify(room.stateFor(a));
    assert.ok(!json.includes(a), 'التوكن ظاهر');
    assert.ok(!('deck' in room.stateFor(a)));
    room.destroy();
  });


  await test('حجز الميزانية: ما ينفعش اللاعب يصرف كل ميزانيته ويسيب باقي الفريق', () => {
    // الفريق = 2 وأرخص بطاقة = 10 → أقصى مزايدة على أول بطاقة = 100 - 10 = 90
    const { room, a } = setup();
    room.start(a);
    assert.strictEqual(room.maxBid(room.players[0]), 90);
    const r = room.placeBid(a, 95);
    assert.strictEqual(r.ok, false);
    assert.ok(r.error.includes('90'));
    assert.strictEqual(room.placeBid(a, 90).ok, true);
    assert.strictEqual(room.stateFor(a).players[0].maxBid, 90);
    room.destroy();
  });

  await test('آخر خانة في الفريق: الحد الأقصى = الميزانية كلها', async () => {
    const { room, a } = setup({ resultDelaySeconds: 0.05 });
    room.start(a);
    room.placeBid(a, 20); // اشترى البطاقة الأولى
    await sleep(450);
    assert.strictEqual(room.players[0].team.length, 1);
    assert.strictEqual(room.maxBid(room.players[0]), 80);
    room.destroy();
  });

  await test('لاعب انقطع في الانتظار يتشال بعد المهلة ويفضّي المكان', async () => {
    const room = new Room({ code: 'T', type: 'anime', deck: mkDeck(), settings: { ...fast, waitingGraceSeconds: 0.1 } });
    room.addPlayer('A', 's1');
    room.addPlayer('B', 's2');
    room.disconnect('s2');
    assert.strictEqual(room.players.length, 2, 'لسه جوه المهلة');
    await sleep(200);
    assert.strictEqual(room.players.length, 1);
    assert.strictEqual(room.addPlayer('C', 's3').ok, true);
    room.destroy();
  });

  await test('لو اللاعب رجع قبل المهلة ما يتشالش', async () => {
    const room = new Room({ code: 'T', type: 'anime', deck: mkDeck(), settings: { ...fast, waitingGraceSeconds: 0.1 } });
    room.addPlayer('A', 's1');
    const b = room.addPlayer('B', 's2').token;
    room.disconnect('s2');
    room.reconnect(b, 's2b');
    await sleep(200);
    assert.strictEqual(room.players.length, 2);
    room.destroy();
  });

  await test('اتصال تاني لنفس الجلسة: reconnect بترجّع الاتصال القديم', () => {
    const { room, a } = setup();
    const r = room.reconnect(a, 'new-socket');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.replaced, 's1');
    assert.strictEqual(room.reconnect(a, 'new-socket').replaced, null);
    room.destroy();
  });

  await test('الانسحاب أثناء المزاد = خسارة والمنافس يفوز', () => {
    const { room, a, b } = setup();
    room.start(a);
    room.leave(a);
    assert.strictEqual(room.status, 'finished');
    assert.strictEqual(room.finalResult.reason, 'forfeit');
    assert.strictEqual(room.finalResult.winnerName, 'Bob');
    assert.strictEqual(room.placeBid(b, 20).ok, false);
    room.destroy();
  });

  await test('الخروج من غرفة الانتظار يشيل اللاعب', () => {
    const { room, b } = setup();
    room.leave(b);
    assert.strictEqual(room.players.length, 1);
    room.destroy();
  });

  await test('لو فريق اكتمل: الناقص يتكمّل ببطاقات عشوائية مجانية والمزاد يخلص', async () => {
    const { room, a, b } = setup({ resultDelaySeconds: 0.05 });
    room.start(a);
    // البطاقة 1: دور a يفتحها ويكسبها
    assert.strictEqual(room.placeBid(a, room.minNextBid()).ok, true);
    await sleep(400); // بدأت البطاقة 2 ودور b يفتحها
    assert.strictEqual(room.current.opener, b);
    assert.strictEqual(room.placeBid(b, room.minNextBid()).ok, true);
    assert.strictEqual(room.placeBid(a, room.minNextBid()).ok, true); // a يرد ويكسبها
    await sleep(700);
    assert.strictEqual(room.status, 'finished');
    const [pa, pb] = room.players;
    assert.strictEqual(pa.team.length, 2);
    assert.strictEqual(pb.team.length, 2, 'الناقص اتكمّل');
    assert.ok(pb.team.every((c) => c.auto === true), 'بطاقات عشوائية معلّمة');
    assert.strictEqual(pb.budget, 100, 'مفيش خصم من الميزانية');
    const ids = [...pa.team, ...pb.team].map((c) => c.id);
    assert.strictEqual(new Set(ids).size, 4, 'مفيش بطاقة مكررة');
    assert.deepStrictEqual(room.finalResult.autoFilled, [{ name: 'Bob', count: 2 }]);
    assert.strictEqual(room.placeBid(b, 50).ok, false);
    room.destroy();
  });

  console.log(`\n${passed} اختبار نجح`);
})();
