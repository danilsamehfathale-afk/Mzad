// واجهة المستخدم: كل دوال العرض (render). لا فيها اتصال بالسيرفر.
(function () {
  const MZ = (window.MZ = window.MZ || {});
  MZ.state = null;
  MZ.offset = 0; // فرق الساعة بين السيرفر والجهاز

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const money = (n, cur) => `${fmt(n)} ${cur}`;
  const tier = (c) => c.tier || 'common'; // التصنيف بييجي من السيرفر (حدوده في server/config.js)
  const bdi = (s) => `<bdi>${esc(s)}</bdi>`;
  const TYPE_AR = { football: 'مزاد كرة القدم ⚽', anime: 'مزاد الأنمي 🎌' };

  function imgTag(src) {
    return `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='images/placeholder.svg'">`;
  }

  function cardHtml(c) {
    const meta = c.type === 'football' ? `${esc(c.position)} · ${esc(c.country)}` : esc(c.seriesAr);
    return `<article class="card" data-tier="${tier(c)}">
      <div class="rating">${esc(c.rating)}</div>
      ${imgTag(c.image)}
      <h3>${esc(c.nameAr)}</h3>
      <div class="en" dir="ltr">${esc(c.nameEn)}</div>
      <div class="meta">${meta}</div>
      <p class="info">${esc(c.info)}</p>
    </article>`;
  }

  function tileHtml(c) {
    return `<div class="tile" data-tier="${tier(c)}" title="${esc(c.nameAr)}">
      <b>${esc(c.rating)}</b>${c.auto ? '<i class="auto" title="بطاقة عشوائية">🎲</i>' : ''}${imgTag(c.image)}<span>${esc(c.nameAr)}</span></div>`;
  }

  function teamHtml(p, s) {
    const slots = [];
    for (let i = 0; i < s.settings.teamSize; i++) {
      slots.push(p.team[i] ? tileHtml(p.team[i]) : '<div class="slot">+</div>');
    }
    return `<div class="team ${p.isYou ? 'you' : ''}">
      <div class="team-head">
        <span class="pname">${bdi(p.name)}${p.isYou ? ' (أنت)' : ''}${p.connected ? '' : ' ⚠ غير متصل'}</span>
        <span class="budget">${money(p.budget, s.settings.currency)}</span>
      </div>
      <div class="slots">${slots.join('')}</div>
      <div class="total">مجموع التقييم: <b>${fmt(p.total)}</b></div>
    </div>`;
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    window.scrollTo(0, 0);
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.h);
    toast.h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function setConn(ok) {
    $('conn').classList.toggle('off', !ok);
  }

  const youOf = (s) => s.players.find((p) => p.isYou);
  const remainingMs = (s) => (s.current ? s.current.endsAt - (Date.now() + MZ.offset) : 0);

  // ---------- غرفة الانتظار ----------
  function renderLobby(s) {
    $('lobbyCode').textContent = s.code;
    $('lobbyType').textContent = TYPE_AR[s.type] || '';
    const slots = [];
    for (let i = 0; i < 2; i++) {
      const p = s.players[i];
      slots.push(
        p
          ? `<div class="lobby-slot filled">${bdi(p.name)}${p.isHost ? ' 👑' : ''}${p.isYou ? ' (أنت)' : ''}${p.connected ? '' : ' ⚠ غير متصل'}</div>`
          : '<div class="lobby-slot muted">في انتظار لاعب...</div>'
      );
    }
    $('lobbyPlayers').innerHTML = slots.join('');
    const me = youOf(s);
    const host = me && me.isHost;
    $('btnStart').classList.toggle('hidden', !host);
    $('btnStart').disabled = s.players.length < 2;
    $('lobbyHint').textContent = host
      ? s.players.length < 2 ? 'شارك الرمز مع صديقك للانضمام' : 'الاتنين جاهزين، ابدأ المزاد!'
      : 'في انتظار منشئ الغرفة ليبدأ المزاد';
  }

  // ---------- شاشة المزاد ----------
  function logLine(e) {
    if (e.kind === 'bid') return `${bdi(e.player)} زايد بـ <b>${fmt(e.amount)}</b> على ${esc(e.cardNameAr)}`;
    if (e.kind === 'sold') return `✅ ${esc(e.cardNameAr)} ← ${bdi(e.player)} (${fmt(e.amount)})`;
    if (e.kind === 'unsold') return `⛔ ${esc(e.cardNameAr)} لم تُبَع`;
    if (e.kind === 'autofill') return `🎲 تم تكميل فريق ${bdi(e.player)} بـ ${fmt(e.count)} بطاقة عشوائية`;
    return `⏭ تم تخطي ${esc(e.cardNameAr)}`;
  }

  function renderAuction(s) {
    $('progress').textContent = `البطاقة ${s.progress.number} من ${s.progress.total}`;
    $('teams').innerHTML = s.players.map((p) => teamHtml(p, s)).join('');
    $('log').innerHTML = s.log
      .slice()
      .reverse()
      .map((e) => `<li>${logLine(e)}</li>`)
      .join('');

    const cur = s.current;
    if (!cur) return;
    const stage = $('stage');
    if (stage.dataset.cardId !== cur.card.id) {
      stage.innerHTML = cardHtml(cur.card);
      stage.dataset.cardId = cur.card.id;
      stage.classList.remove('enter');
      void stage.offsetWidth;
      stage.classList.add('enter');
    }

    const cc = s.settings.currency;
    const hb = $('highBid');
    const key = cur.highBid ? cur.highBid.name + ':' + cur.highBid.amount : 'none:' + cur.card.id;
    hb.innerHTML = cur.highBid
      ? `أعلى مزايدة: <b>${money(cur.highBid.amount, cc)}</b> — ${bdi(cur.highBid.name)}${cur.highBid.isYou ? ' (أنت)' : ''}`
      : `دور ${bdi(cur.opener.name)}${cur.opener.isYou ? ' (أنت)' : ''} يفتح المزايدة — أقل مبلغ <b>${money(cur.minNextBid, cc)}</b>`;
    if (hb.dataset.key !== key) {
      hb.dataset.key = key;
      hb.classList.remove('pulse');
      void hb.offsetWidth;
      hb.classList.add('pulse');
    }

    const rb = $('resultBanner');
    if (s.phase === 'result' && s.lastResult) {
      const r = s.lastResult;
      rb.innerHTML = r.sold
        ? `🎉 فاز ${bdi(r.winner)} بـ ${esc(r.nameAr)}<br>مقابل ${money(r.amount, cc)}`
        : `لم تُبَع ${esc(r.nameAr)} — لا توجد مزايدات`;
      rb.classList.remove('hidden');
    } else {
      rb.classList.add('hidden');
    }
    updateControls();
  }

  function updateControls() {
    const s = MZ.state;
    if (!s || s.status !== 'running' || !s.current) return;
    const me = youOf(s);
    if (!me) return;
    const cur = s.current;
    const cc = s.settings.currency;
    const bidding = s.phase === 'bidding' && remainingMs(s) > 0;
    const min = cur.minNextBid;
    let can = bidding;
    let hint = '';
    const maxBid = me.maxBid == null ? me.budget : me.maxBid;
    if (!bidding) hint = 'انتهت المزايدة على هذه البطاقة';
    else if (me.team.length >= s.settings.teamSize) { can = false; hint = 'فريقك مكتمل'; }
    else if (cur.highBid && cur.highBid.isYou) { can = false; hint = 'أنت صاحب أعلى مزايدة، انتظر منافسك'; }
    else if (!cur.highBid && !cur.opener.isYou) { can = false; hint = `استنى ${cur.opener.name} يفتح المزايدة`; }
    else if (min > me.budget) { can = false; hint = 'ميزانيتك لا تكفي للمزايدة'; }
    else if (min > maxBid) { can = false; hint = 'لازم تحتفظ بميزانية تكفي باقي بطاقات فريقك'; }
    else hint = `أقصى مبلغ تقدر تزايد به: ${money(maxBid, cc)}`;

    const btn = $('btnBidMin');
    btn.textContent = `زايد ${money(min, cc)}`;
    btn.dataset.amount = min;
    btn.disabled = !can;
    document.querySelectorAll('.chip').forEach((c) => {
      const amount = min + Number(c.dataset.add);
      c.textContent = fmt(amount);
      c.dataset.amount = amount;
      c.disabled = !can || amount > maxBid;
    });
    $('btnBidCustom').disabled = !can;
    $('bidInput').disabled = !can;
    $('bidHint').textContent = hint;
  }

  function tick() {
    const s = MZ.state;
    if (!s || s.status !== 'running' || !s.current) return;
    const left = remainingMs(s);
    const timer = document.querySelector('.timer');
    if (s.phase === 'bidding' && left > 0) {
      $('timerText').textContent = Math.ceil(left / 1000) + ' ث';
      $('timerBar').style.width = Math.min(100, (left / (s.settings.auctionSeconds * 1000)) * 100) + '%';
      timer.classList.toggle('urgent', left <= 5000);
    } else {
      $('timerText').textContent = '—';
      $('timerBar').style.width = '0%';
      timer.classList.remove('urgent');
    }
    updateControls();
  }

  // ---------- النتيجة النهائية ----------
  function renderFinal(s) {
    const f = s.finalResult;
    const me = youOf(s);
    let html;
    if (!f || !f.winnerName) {
      html = '🤝 تعادل!<small>تساوى اللاعبان في التقييم والميزانية</small>';
    } else {
      const won = me && me.name === f.winnerName;
      const why =
        f.reason === 'rating' ? 'بأعلى مجموع تقييم'
        : f.reason === 'forfeit' ? 'بعد انسحاب المنافس من المزاد'
        : 'تعادل في التقييم، وفاز بالميزانية المتبقية الأكبر';
      html = `🏆 الفائز: ${bdi(f.winnerName)}<small>${why}${me ? (won ? ' — مبروك!' : ' — حظ أوفر المرة الجاية') : ''}</small>`;
    }
    if (f && f.autoFilled && f.autoFilled.length) {
      html += f.autoFilled
        .map((a) => `<small>🎲 اتكمّل فريق ${bdi(a.name)} بـ ${fmt(a.count)} بطاقة عشوائية لأن المنافس أكمل فريقه</small>`)
        .join('');
    }
    $('finalBanner').innerHTML = html;
    $('finalTeams').innerHTML = s.players.map((p) => teamHtml(p, s)).join('');
  }

  function render(s) {
    if (s.status === 'waiting') { renderLobby(s); showView('lobby'); }
    else if (s.status === 'running') { renderAuction(s); showView('auction'); tick(); }
    else { renderFinal(s); showView('final'); }
  }

  MZ.ui = { $, render, tick, showView, toast, setConn };
})();
