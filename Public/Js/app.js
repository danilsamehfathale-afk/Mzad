// الاتصال بالسيرفر وربط الأزرار. العرض كله في ui.js
(function () {
  const MZ = window.MZ;
  const ui = MZ.ui;
  const $ = ui.$;
  const KEY = 'mazad_session';
  const NAME_KEY = 'mazad_name';

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* تجاهل */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* تجاهل */ } },
  };

  if (typeof io !== 'function') {
    document.body.insertAdjacentHTML('afterbegin',
      '<p style="padding:20px;text-align:center">لازم تفتح اللعبة من خلال السيرفر (http://localhost:3000)، مش من الملف مباشرة.</p>');
    return;
  }

  const socket = io({ reconnection: true });
  let selectedType = null;
  let busy = false;
  let replaced = false; // الجلسة اتاخدت من تبويب تاني

  const savedName = store.get(NAME_KEY);
  if (savedName) $('nameInput').value = savedName;

  function homeError(msg) {
    const e = $('homeError');
    e.textContent = msg || '';
    e.classList.toggle('hidden', !msg);
  }

  // ---------- أحداث السيرفر ----------
  function rejoin() {
    const ses = store.get(KEY);
    if (!(ses && ses.code && ses.token)) return;
    socket.emit('room:rejoin', { code: ses.code, token: ses.token }, (res) => {
      if (!res || !res.ok) {
        store.del(KEY);
        MZ.state = null;
        ui.showView('home');
        if (res && res.error) ui.toast(res.error);
      }
    });
  }

  socket.on('connect', () => {
    ui.setConn(true);
    if (!replaced) rejoin();
  });
  socket.on('disconnect', () => ui.setConn(false));
  socket.on('session:replaced', () => {
    replaced = true;
    MZ.state = null;
    ui.showView('replaced');
  });
  $('btnTakeover').addEventListener('click', () => {
    replaced = false;
    rejoin();
  });
  socket.on('state', (s) => {
    MZ.state = s;
    MZ.offset = s.serverNow - Date.now();
    ui.render(s);
  });

  // ---------- الشاشة الرئيسية ----------
  document.querySelectorAll('.type-btn').forEach((b) => {
    b.addEventListener('click', () => {
      selectedType = b.dataset.type;
      document.querySelectorAll('.type-btn').forEach((x) => x.classList.toggle('selected', x === b));
      homeError('');
    });
  });

  function afterJoin(res) {
    busy = false;
    if (!res || !res.ok) return homeError((res && res.error) || 'حصل خطأ');
    homeError('');
    store.set(KEY, { code: res.code, token: res.token });
  }

  $('btnCreate').addEventListener('click', () => {
    if (busy) return;
    const name = $('nameInput').value.trim();
    if (!name) return homeError('اكتب اسمك أولًا');
    if (!selectedType) return homeError('اختر نوع المزاد');
    store.set(NAME_KEY, name);
    busy = true;
    socket.emit('room:create', { name, type: selectedType }, afterJoin);
  });

  $('btnJoin').addEventListener('click', () => {
    if (busy) return;
    const name = $('nameInput').value.trim();
    const code = $('codeInput').value.trim().toUpperCase();
    if (!name) return homeError('اكتب اسمك أولًا');
    if (code.length !== 5) return homeError('رمز الغرفة 5 حروف');
    store.set(NAME_KEY, name);
    busy = true;
    socket.emit('room:join', { name, code }, afterJoin);
  });

  $('codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });

  // ---------- غرفة الانتظار ----------
  $('btnCopy').addEventListener('click', async () => {
    const code = $('lobbyCode').textContent;
    try { await navigator.clipboard.writeText(code); ui.toast('تم نسخ الرمز'); }
    catch (e) { ui.toast('الرمز: ' + code); }
  });
  $('btnStart').addEventListener('click', () => {
    socket.emit('game:start', {}, (res) => { if (res && !res.ok) ui.toast(res.error); });
  });

  function leave() {
    socket.emit('room:leave', {}, () => {});
    store.del(KEY);
    MZ.state = null;
    ui.showView('home');
  }
  $('btnLeaveLobby').addEventListener('click', leave);
  $('btnAgain').addEventListener('click', leave);

  // ---------- المزايدة ----------
  function bid(amount) {
    if (!Number.isInteger(amount) || amount <= 0) return ui.toast('اكتب مبلغًا صحيحًا');
    socket.emit('bid:place', { amount }, (res) => { if (res && !res.ok) ui.toast(res.error); });
  }
  $('btnBidMin').addEventListener('click', (e) => bid(Number(e.currentTarget.dataset.amount)));
  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => bid(Number(c.dataset.amount))));
  $('btnBidCustom').addEventListener('click', () => {
    bid(Number($('bidInput').value));
    $('bidInput').value = '';
  });
  $('bidInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnBidCustom').click(); });

  setInterval(ui.tick, 100);
})();
