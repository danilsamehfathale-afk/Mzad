'use strict';
// منطق الغرفة والمزاد كله هنا. السيرفر هو المسؤول عن الوقت والمزايدات والفائز.
const crypto = require('crypto');

const MAX_LOG = 60;
const err = (error) => ({ ok: false, error });

class Room {
  constructor({ code, type, deck, settings, onChange, logger }) {
    this.code = code;
    this.type = type;
    this.deck = deck;
    this.s = settings;
    this.onChange = typeof onChange === 'function' ? onChange : () => {};
    this.logger = logger || { info() {}, warn() {}, error() {} };
    // أقل مبلغ ممكن تتباع بيه بطاقة (حد فتح المزايدة): بنحتفظ بيه لكل خانة فاضلة في الفريق
    this.minCardPrice = this.s.minOpeningBid || this.s.minIncrement || 1;
    this.turn = 0; // عدد البطاقات اللي اتعرضت، بيحدد مين يفتح المزايدة (بالدور)
    this.players = [];
    this.status = 'waiting'; // waiting | running | finished
    this.phase = 'idle'; // idle | bidding | result
    this.index = -1;
    this.current = null;
    this.lastResult = null;
    this.log = [];
    this.autoFilled = []; // [{ name, count }] اللاعبين اللي اتكمّل فريقهم تلقائيًا
    this.finalResult = null;
    this.timer = null;
    this.lastActivity = Date.now();
  }

  // ---------- أدوات داخلية ----------
  emit() {
    this.lastActivity = Date.now();
    this.onChange(this);
  }

  schedule(ms, fn) {
    clearTimeout(this.timer);
    this.timer = setTimeout(fn, Math.max(0, ms));
  }

  addLog(entry) {
    this.log.push({ at: Date.now(), ...entry });
    if (this.log.length > MAX_LOG) this.log.shift();
  }

  getPlayer(token) {
    if (typeof token !== 'string' || !token) return undefined;
    return this.players.find((p) => p.id === token);
  }

  // أقصى مبلغ يقدر اللاعب يزايد بيه: لازم يفضل معاه حد أدنى يكفي باقي خانات فريقه
  maxBid(player) {
    const slotsAfter = Math.max(0, this.s.teamSize - player.team.length - 1);
    return Math.max(0, player.budget - slotsAfter * this.minCardPrice);
  }

  canBid(player, amount) {
    return player.team.length < this.s.teamSize && this.maxBid(player) >= amount;
  }

  bothFull() {
    return this.players.length > 0 && this.players.every((p) => p.team.length >= this.s.teamSize);
  }

  minNextBid() {
    if (!this.current) return 0;
    return this.current.highBid
      ? this.current.highBid.amount + this.s.minIncrement
      : this.minCardPrice;
  }

  hasConnectedPlayers() {
    return this.players.some((p) => p.connected);
  }

  destroy() {
    clearTimeout(this.timer);
    this.timer = null;
    this.players.forEach((p) => clearTimeout(p.dropTimer));
  }

  // ---------- اللاعبين ----------
  addPlayer(name, socketId) {
    if (this.status !== 'waiting') return err('بدأ المزاد في هذه الغرفة بالفعل');
    if (this.players.length >= this.s.maxPlayers) return err('الغرفة ممتلئة (لاعبان فقط)');
    if (this.players.some((p) => p.name === name)) {
      return err('هذا الاسم مستخدم في الغرفة، اختر اسمًا آخر');
    }
    const player = {
      id: crypto.randomBytes(24).toString('hex'),
      name,
      budget: this.s.startBudget,
      team: [],
      socketId: socketId || null,
      connected: true,
    };
    this.players.push(player);
    this.logger.info(`room ${this.code}: ${name} joined (${this.players.length}/${this.s.maxPlayers})`);
    this.emit();
    return { ok: true, token: player.id };
  }

  reconnect(token, socketId) {
    const p = this.getPlayer(token);
    if (!p) return err('الجلسة غير صالحة');
    clearTimeout(p.dropTimer);
    // لو فيه اتصال تاني (تبويب تاني) لنفس اللاعب، بنرجّع رقمه عشان السيرفر يبلّغه
    const replaced = p.connected && p.socketId && p.socketId !== socketId ? p.socketId : null;
    p.socketId = socketId || null;
    p.connected = true;
    this.logger.info(`room ${this.code}: ${p.name} reconnected`);
    this.emit();
    return { ok: true, replaced };
  }

  disconnect(socketId) {
    const p = this.players.find((x) => x.socketId && x.socketId === socketId);
    if (!p) return;
    p.socketId = null;
    p.connected = false;
    if (this.status === 'waiting') {
      // لاعب انقطع وهو في الانتظار: نديله مهلة يرجع، وبعدها نشيله عشان ما يحجزش المكان
      clearTimeout(p.dropTimer);
      const grace = (this.s.waitingGraceSeconds == null ? 20 : this.s.waitingGraceSeconds) * 1000;
      p.dropTimer = setTimeout(() => {
        if (!p.connected && this.status === 'waiting' && this.players.includes(p)) {
          this.players = this.players.filter((x) => x !== p);
          this.logger.info(`room ${this.code}: ${p.name} removed after disconnect`);
          this.emit();
        }
      }, grace);
      if (p.dropTimer.unref) p.dropTimer.unref();
    }
    this.emit();
  }

  leave(token) {
    const p = this.getPlayer(token);
    if (!p) return err('غير مصرح');
    this.logger.info(`room ${this.code}: ${p.name} left (${this.status})`);
    if (this.status === 'waiting') {
      clearTimeout(p.dropTimer);
      this.players = this.players.filter((x) => x !== p);
    } else if (this.status === 'running') {
      // الانسحاب أثناء المزاد = خسارة، والمنافس يفوز
      p.socketId = null;
      p.connected = false;
      this.finish({ forfeitBy: p });
      return { ok: true };
    } else {
      p.socketId = null;
      p.connected = false;
    }
    this.emit();
    return { ok: true };
  }

  // ---------- بدء المزاد ----------
  start(token) {
    const p = this.getPlayer(token);
    if (!p) return err('غير مصرح');
    if (p !== this.players[0]) return err('منشئ الغرفة فقط يقدر يبدأ المزاد');
    if (this.status !== 'waiting') return err('المزاد بدأ بالفعل');
    if (this.players.length < this.s.maxPlayers) return err('لازم ينضم لاعب تاني قبل البدء');
    this.status = 'running';
    this.logger.info(`room ${this.code}: auction started (${this.type})`);
    this.nextCard();
    return { ok: true };
  }

  // لو فريق لاعب اكتمل ولاعب تاني لسه ناقص: نكمّل خانات الناقص ببطاقات عشوائية مجانية (من غير خصم ميزانية)
  // والبطاقات دي ثابتة، اللاعب ما يقدرش يغيّرها.
  autoFillIfOneFull() {
    const size = this.s.teamSize;
    const full = this.players.filter((p) => p.team.length >= size);
    if (full.length === 0 || full.length === this.players.length) return;
    const owned = new Set(this.players.flatMap((p) => p.team.map((c) => c.id)));
    const pool = this.deck.filter((c) => !owned.has(c.id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (const p of this.players) {
      const need = size - p.team.length;
      if (need <= 0) continue;
      const picked = pool.splice(0, need).map((c) => ({ ...c, auto: true }));
      if (!picked.length) continue;
      p.team.push(...picked);
      this.autoFilled.push({ name: p.name, count: picked.length });
      this.addLog({ kind: 'autofill', player: p.name, count: picked.length });
      this.logger.info(`room ${this.code}: auto-filled ${picked.length} cards for ${p.name}`);
    }
  }

  nextCard() {
    clearTimeout(this.timer);
    this.current = null;
    this.lastResult = null;
    this.phase = 'idle';
    this.autoFillIfOneFull();

    while (true) {
      if (this.bothFull() || this.index + 1 >= this.deck.length) {
        this.finish();
        return;
      }
      this.index += 1;
      const card = this.deck[this.index];
      // اللاعب اللي عليه الدور يفتح المزايدة، ولو ما يقدرش (ميزانية) الدور يروح للتاني
      const n = this.players.length;
      const first = this.players[this.turn % n];
      const opener = [first, ...this.players.filter((p) => p !== first)]
        .find((p) => this.canBid(p, this.minCardPrice));
      this.turn += 1;
      if (!opener) {
        // محدش يقدر يفتح المزايدة على البطاقة دي: نتخطاها
        this.addLog({ kind: 'skipped', cardNameAr: card.nameAr });
        continue;
      }
      this.current = {
        card,
        opener: opener.id,
        openerName: opener.name,
        highBid: null,
        endsAt: Date.now() + this.s.auctionSeconds * 1000,
      };
      this.phase = 'bidding';
      this.schedule(this.current.endsAt - Date.now(), () => this.closeCard());
      break;
    }
    this.emit();
  }

  // ---------- المزايدة ----------
  placeBid(token, amount) {
    const p = this.getPlayer(token);
    if (!p) return err('غير مصرح لك بالمزايدة في هذه الغرفة');
    if (this.status !== 'running' || this.phase !== 'bidding' || !this.current) {
      return err('لا يوجد مزاد جارٍ الآن');
    }
    const now = Date.now();
    if (now >= this.current.endsAt) return err('انتهى وقت المزايدة على هذه البطاقة');
    if (!Number.isInteger(amount) || amount <= 0) return err('مبلغ غير صالح');
    if (p.team.length >= this.s.teamSize) return err('فريقك مكتمل');
    if (!this.current.highBid && this.current.opener !== p.id) {
      return err(`دور ${this.current.openerName} يفتح المزايدة على هذه البطاقة`);
    }
    if (this.current.highBid && this.current.highBid.playerId === p.id) {
      return err('أنت صاحب أعلى مزايدة بالفعل');
    }
    const min = this.minNextBid();
    if (amount < min) return err(`أقل مزايدة مسموحة الآن ${min}`);
    if (amount > p.budget) return err('المبلغ أكبر من ميزانيتك');
    const max = this.maxBid(p);
    if (amount > max) {
      return err(`أقصى مبلغ تقدر تزايد به ${max} (لازم تحتفظ بميزانية لباقي بطاقات فريقك)`);
    }

    this.current.highBid = { playerId: p.id, name: p.name, amount, at: now };
    this.addLog({ kind: 'bid', cardNameAr: this.current.card.nameAr, player: p.name, amount });

    // تمديد الوقت لو المزايدة في اللحظات الأخيرة
    if (this.current.endsAt - now <= this.s.extendWindowSeconds * 1000) {
      this.current.endsAt = Math.max(this.current.endsAt, now + this.s.extendSeconds * 1000);
    }
    this.schedule(this.current.endsAt - Date.now(), () => this.closeCard());
    this.emit();
    return { ok: true };
  }

  closeCard() {
    if (this.phase !== 'bidding' || !this.current) return;
    const remaining = this.current.endsAt - Date.now();
    if (remaining > 0) {
      this.schedule(remaining + 5, () => this.closeCard());
      return;
    }
    const { card, highBid } = this.current;
    let result;
    if (highBid) {
      const winner = this.players.find((p) => p.id === highBid.playerId);
      // حماية إضافية: السيرفر يتأكد تاني قبل الخصم
      if (winner && winner.budget >= highBid.amount && winner.team.length < this.s.teamSize) {
        winner.budget -= highBid.amount;
        winner.team.push(card);
        result = { sold: true, winner: winner.name, amount: highBid.amount };
        this.addLog({ kind: 'sold', cardNameAr: card.nameAr, player: winner.name, amount: highBid.amount });
      }
    }
    if (!result) {
      result = { sold: false, winner: null, amount: 0 };
      this.addLog({ kind: 'unsold', cardNameAr: card.nameAr });
    }
    this.lastResult = { cardId: card.id, nameAr: card.nameAr, nameEn: card.nameEn, ...result };
    this.phase = 'result';
    this.schedule(this.s.resultDelaySeconds * 1000, () => this.nextCard());
    this.emit();
  }

  // ---------- النهاية ----------
  finish({ forfeitBy } = {}) {
    clearTimeout(this.timer);
    this.status = 'finished';
    this.phase = 'idle';
    this.current = null;
    const rows = this.players.map((p) => ({
      name: p.name,
      total: p.team.reduce((sum, c) => sum + c.rating, 0),
      budgetLeft: p.budget,
    }));
    let winnerName = null;
    let reason = 'draw';
    if (forfeitBy && this.players.length === 2) {
      winnerName = this.players.find((x) => x !== forfeitBy).name;
      reason = 'forfeit';
    } else if (rows.length === 2) {
      const [a, b] = rows;
      if (a.total !== b.total) {
        winnerName = a.total > b.total ? a.name : b.name;
        reason = 'rating';
      } else if (a.budgetLeft !== b.budgetLeft) {
        // لو التقييم متساوي: الأعلى ميزانية متبقية يفوز
        winnerName = a.budgetLeft > b.budgetLeft ? a.name : b.name;
        reason = 'budget';
      }
    }
    this.finalResult = { players: rows, winnerName, reason, autoFilled: this.autoFilled };
    this.logger.info(`room ${this.code}: finished, winner=${winnerName || 'none'} (${reason})`);
    this.emit();
  }

  // ---------- الحالة المُرسلة للاعبين ----------
  stateFor(token) {
    const me = this.getPlayer(token);
    const cur = this.current;
    return {
      code: this.code,
      type: this.type,
      status: this.status,
      phase: this.phase,
      serverNow: Date.now(),
      settings: {
        teamSize: this.s.teamSize,
        startBudget: this.s.startBudget,
        minIncrement: this.s.minIncrement,
        auctionSeconds: this.s.auctionSeconds,
        currency: this.s.currency,
      },
      players: this.players.map((p, i) => ({
        name: p.name,
        budget: p.budget,
        connected: p.connected,
        maxBid: this.maxBid(p),
        isHost: i === 0,
        isYou: p === me,
        team: p.team,
        total: p.team.reduce((sum, c) => sum + c.rating, 0),
      })),
      progress: { number: Math.max(0, this.index + 1), total: this.deck.length },
      current: cur
        ? {
            card: cur.card,
            opener: { name: cur.openerName, isYou: cur.opener === (me && me.id) },
            minNextBid: this.minNextBid(),
            endsAt: cur.endsAt,
            highBid: cur.highBid
              ? { name: cur.highBid.name, amount: cur.highBid.amount, isYou: cur.highBid.playerId === (me && me.id) }
              : null,
          }
        : null,
      lastResult: this.lastResult,
      log: this.log.slice(-40),
      finalResult: this.finalResult,
    };
  }
}

module.exports = Room;
