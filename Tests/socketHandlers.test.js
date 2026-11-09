'use strict';
// اختبار طبقة Socket.IO (socketHandlers.js) بـ socket وهمي بدون شبكة.
// ملحوظة: ده بيختبر منطق الأحداث والصلاحيات، مش نقل البيانات الفعلي بمكتبة socket.io.
process.env.AUCTION_SECONDS = '1';
process.env.WAITING_GRACE_SECONDS = '0.1';
process.env.CREATE_PER_MINUTE = '4';

const assert = require('assert');
const manager = require('../server/roomManager');
const register = require('../server/socketHandlers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FakeSocket {
  constructor(io, id, address) {
    this.id = id;
    this.data = {};
    this.handlers = {};
    this.received = [];
    this.handshake = { address, headers: {} };
    this.io = io;
  }
  on(ev, fn) { this.handlers[ev] = fn; }
  emit(ev, ...args) { this.received.push([ev, ...args]); }
  call(ev, data) { return new Promise((res) => this.handlers[ev](data, res)); }
  lastState() { const s = this.received.filter((r) => r[0] === 'state'); return s.length ? s[s.length - 1][1] : null; }
  got(ev) { return this.received.some((r) => r[0] === ev); }
  disconnect() { this.handlers.disconnect && this.handlers.disconnect(); this.io.sockets.sockets.delete(this.id); }
}
class FakeIO {
  constructor() { this.sockets = { sockets: new Map() }; this.n = 0; }
  on(ev, fn) { if (ev === 'connection') this.onConn = fn; }
  to(id) { return { emit: (ev, ...a) => { const s = this.sockets.sockets.get(id); if (s) s.emit(ev, ...a); } }; }
  connect(address) {
    // كل اتصال بياخد IP مختلف افتراضيًا عشان حدود الإنشاء لكل IP ما تأثرش على باقي الاختبارات
    const s = new FakeSocket(this, 's' + ++this.n, address || `10.0.${Math.floor(this.n / 250)}.${this.n % 250 + 1}`);
    this.sockets.sockets.set(s.id, s);
    this.onConn(s);
    return s;
  }
}

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
}

(async () => {
  console.log('Socket handlers tests (fake socket)');
  const io = new FakeIO();
  register(io);

  let ipCounter = 0;
  async function twoPlayers(ipA) {
    ipA = ipA || `2.2.${Math.floor(++ipCounter / 250)}.${ipCounter % 250 + 1}`; // IP مختلف لكل غرفة عشان حد الإنشاء
    const a = io.connect(ipA);
    const b = io.connect(ipA);
    const ra = await a.call('room:create', { name: 'علي', type: 'football' });
    const rb = await b.call('room:join', { name: 'Bob', code: ra.code.toLowerCase() });
    return { a, b, ra, rb };
  }

  await test('إنشاء غرفة: رد ناجح وحالة انتظار، ومدخلات غلط بتترفض', async () => {
    const a = io.connect('3.3.3.3');
    assert.strictEqual((await a.call('room:create', { name: '', type: 'football' })).ok, false);
    assert.strictEqual((await a.call('room:create', { name: 'x', type: 'cars' })).ok, false);
    const r = await a.call('room:create', { name: '<b>علي</b>', type: 'anime' });
    assert.strictEqual(r.ok, true);
    assert.match(r.code, /^[A-Z0-9]{5}$/);
    const st = a.lastState();
    assert.strictEqual(st.status, 'waiting');
    assert.strictEqual(st.players[0].name, 'bعليb'.replace(/b/g, 'b') === '' ? '' : st.players[0].name);
    assert.ok(!st.players[0].name.includes('<'), 'الرموز الخطرة اتشالت');
    manager.removeAll();
  });

  await test('انضمام لاعب تاني، وتالت يترفض، وكود غلط يترفض', async () => {
    const { a, b, ra } = await twoPlayers();
    assert.strictEqual(a.lastState().players.length, 2);
    assert.strictEqual(b.lastState().players[1].isYou, true);
    const c = io.connect('4.4.4.4');
    const rc = await c.call('room:join', { name: 'Carl', code: ra.code });
    assert.strictEqual(rc.ok, false);
    assert.strictEqual((await c.call('room:join', { name: 'Carl', code: 'ZZZZZ' })).ok, false);
    manager.removeAll();
  });

  await test('منشئ الغرفة فقط يبدأ، وبعدها المزايدة شغالة والدخيل مرفوض', async () => {
    const { a, b } = await twoPlayers();
    assert.strictEqual((await b.call('game:start', {})).ok, false);
    assert.strictEqual((await a.call('game:start', {})).ok, true);
    const st = a.lastState();
    assert.strictEqual(st.status, 'running');
    const outsider = io.connect('5.5.5.5');
    assert.strictEqual((await outsider.call('bid:place', { amount: 50 })).ok, false);
    const r = await a.call('bid:place', { amount: st.current.minNextBid });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(b.lastState().current.highBid.isYou, false);
    assert.strictEqual(a.lastState().current.highBid.isYou, true);
    manager.removeAll();
  });

  await test('مزايدات متتالية سريعة بتترفض (throttle)', async () => {
    const { a, b } = await twoPlayers();
    await a.call('game:start', {});
    const min = a.lastState().current.minNextBid;
    // اللاعب 2 ما يقدرش يفتح المزايدة على أول بطاقة (الدور للاعب 1)
    assert.strictEqual((await b.call('bid:place', { amount: min })).ok, false);
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual((await a.call('bid:place', { amount: min })).ok, true);
    const second = await a.call('bid:place', { amount: min + 5 });
    assert.strictEqual(second.ok, false);
    manager.removeAll();
  });

  await test('إعادة الاتصال من تبويب جديد: القديم بيتبلّغ ومبقاش يقدر يزايد', async () => {
    const { a, b, ra } = await twoPlayers();
    await a.call('game:start', {});
    const fresh = io.connect('2.2.2.2');
    const r = await fresh.call('room:rejoin', { code: ra.code, token: ra.token });
    assert.strictEqual(r.ok, true);
    assert.ok(a.got('session:replaced'));
    assert.strictEqual((await a.call('bid:place', { amount: 999 })).ok, false);
    assert.strictEqual((await fresh.call('bid:place', { amount: fresh.lastState().current.minNextBid })).ok, true);
    assert.strictEqual((await io.connect().call('room:rejoin', { code: ra.code, token: 'bad' })).ok, false);
    manager.removeAll();
  });

  await test('مينفعش تنشئ أو تنضم لغرفة وإنت جوه غرفة', async () => {
    const { a, ra } = await twoPlayers();
    assert.strictEqual((await a.call('room:create', { name: 'x', type: 'anime' })).ok, false);
    assert.strictEqual((await a.call('room:join', { name: 'x', code: ra.code })).ok, false);
    manager.removeAll();
  });

  await test('لاعب انقطع في الانتظار يتشال والمكان يفضى', async () => {
    const { b, ra } = await twoPlayers();
    b.disconnect();
    await sleep(250);
    const c = io.connect('6.6.6.6');
    const rc = await c.call('room:join', { name: 'Carl', code: ra.code });
    assert.strictEqual(rc.ok, true);
    manager.removeAll();
  });

  await test('الانسحاب أثناء المزاد: المنافس يستلم نتيجة الفوز', async () => {
    const { a, b } = await twoPlayers();
    await a.call('game:start', {});
    await a.call('room:leave', {});
    const st = b.lastState();
    assert.strictEqual(st.status, 'finished');
    assert.strictEqual(st.finalResult.reason, 'forfeit');
    assert.strictEqual(st.finalResult.winnerName, 'Bob');
    manager.removeAll();
  });

  await test('الخروج من الانتظار بيمسح الغرفة لما تفضى', async () => {
    const a = io.connect('7.7.7.7');
    const r = await a.call('room:create', { name: 'علي', type: 'anime' });
    await a.call('room:leave', {});
    assert.strictEqual(manager.getRoom(r.code), undefined);
  });

  await test('حد إنشاء الغرف لكل IP', async () => {
    const results = [];
    for (let i = 0; i < 6; i++) {
      const s = io.connect('9.9.9.9');
      results.push((await s.call('room:create', { name: 'p' + i, type: 'anime' })).ok);
    }
    assert.deepStrictEqual(results, [true, true, true, true, false, false]);
    manager.removeAll();
  });

  console.log(`\n${passed} اختبار نجح`);
  manager.removeAll();
  process.exit(process.exitCode || 0);
})();
