'use strict';
const config = require('./config');
const manager = require('./roomManager');
const { TYPES } = require('./cards');
const { createLimiter } = require('./rateLimiter');

const MIN_BID_GAP_MS = 120; // حماية بسيطة من الضغط المتكرر
const MINUTE = 60 * 1000;

function cleanName(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
}

function clientIp(socket) {
  const h = socket.handshake || {};
  if (config.TRUST_PROXY && h.headers && h.headers['x-forwarded-for']) {
    return String(h.headers['x-forwarded-for']).split(',')[0].trim();
  }
  return h.address || 'unknown';
}

module.exports = function registerSocketHandlers(io) {
  const createLimit = createLimiter({ max: config.CREATE_PER_MINUTE, windowMs: MINUTE });
  const joinLimit = createLimiter({ max: config.JOIN_PER_MINUTE, windowMs: MINUTE });
  const rejoinLimit = createLimiter({ max: config.REJOIN_PER_MINUTE, windowMs: MINUTE });
  const sweeper = setInterval(() => {
    createLimit.sweep();
    joinLimit.sweep();
    rejoinLimit.sweep();
  }, MINUTE);
  sweeper.unref();

  function broadcast(room) {
    for (const p of room.players) {
      if (p.socketId) io.to(p.socketId).emit('state', room.stateFor(p.id));
    }
  }

  io.on('connection', (socket) => {
    socket.data.roomCode = null;
    socket.data.token = null;
    let lastBidAt = 0;

    const reply = (ack) => (typeof ack === 'function' ? ack : () => {});

    // يرجّع الغرفة واللاعب لو الـ socket ده هو المرتبط فعلًا بلاعب في الغرفة
    function bound() {
      const room = manager.getRoom(socket.data.roomCode);
      if (!room) return null;
      const player = room.getPlayer(socket.data.token);
      if (!player || player.socketId !== socket.id) return null;
      return { room, player };
    }

    function bind(room, token) {
      socket.data.roomCode = room.code;
      socket.data.token = token;
    }

    socket.on('room:create', (data, ack) => {
      const done = reply(ack);
      if (bound()) return done({ ok: false, error: 'أنت داخل غرفة بالفعل، اخرج منها أولًا' });
      if (!createLimit.allow(clientIp(socket))) return done({ ok: false, error: 'محاولات كتير، استنى شوية' });
      const name = cleanName(data && data.name);
      const type = data && data.type;
      if (!name) return done({ ok: false, error: 'اكتب اسمك أولًا' });
      if (!TYPES.includes(type)) return done({ ok: false, error: 'اختر نوع المزاد' });
      let room;
      try {
        room = manager.createRoom(type, broadcast);
      } catch (e) {
        return done({ ok: false, error: e.message });
      }
      const res = room.addPlayer(name, socket.id);
      if (!res.ok) {
        manager.removeRoom(room.code);
        return done(res);
      }
      bind(room, res.token);
      done({ ok: true, code: room.code, token: res.token });
    });

    socket.on('room:join', (data, ack) => {
      const done = reply(ack);
      if (bound()) return done({ ok: false, error: 'أنت داخل غرفة بالفعل، اخرج منها أولًا' });
      if (!joinLimit.allow(clientIp(socket))) return done({ ok: false, error: 'محاولات كتير، استنى شوية' });
      const name = cleanName(data && data.name);
      if (!name) return done({ ok: false, error: 'اكتب اسمك أولًا' });
      const room = manager.getRoom(data && data.code);
      if (!room) return done({ ok: false, error: 'رمز الغرفة غير صحيح' });
      const res = room.addPlayer(name, socket.id);
      if (!res.ok) return done(res);
      bind(room, res.token);
      done({ ok: true, code: room.code, token: res.token });
    });

    socket.on('room:rejoin', (data, ack) => {
      const done = reply(ack);
      if (!rejoinLimit.allow(clientIp(socket))) return done({ ok: false, error: 'محاولات كتير، استنى شوية' });
      const room = manager.getRoom(data && data.code);
      if (!room) return done({ ok: false, error: 'الغرفة لم تعد موجودة' });
      const res = room.reconnect(data && data.token, socket.id);
      if (!res.ok) return done(res);
      bind(room, data.token);
      if (res.replaced) {
        // تبويب تاني كان فاتح نفس الجلسة: نفصله ونبلّغه
        const old = io.sockets && io.sockets.sockets && io.sockets.sockets.get(res.replaced);
        if (old) {
          old.data.roomCode = null;
          old.data.token = null;
          old.emit('session:replaced');
        }
      }
      done({ ok: true, code: room.code });
    });

    socket.on('game:start', (_data, ack) => {
      const done = reply(ack);
      const b = bound();
      if (!b) return done({ ok: false, error: 'غير مصرح' });
      done(b.room.start(b.player.id));
    });

    socket.on('bid:place', (data, ack) => {
      const done = reply(ack);
      const b = bound();
      if (!b) return done({ ok: false, error: 'غير مصرح' });
      const now = Date.now();
      if (now - lastBidAt < MIN_BID_GAP_MS) return done({ ok: false, error: 'بطّئ شوية' });
      lastBidAt = now;
      const amount = Number(data && data.amount);
      done(b.room.placeBid(b.player.id, amount));
    });

    socket.on('room:leave', (_data, ack) => {
      const done = reply(ack);
      const b = bound();
      if (!b) return done({ ok: true });
      const { room, player } = b;
      room.leave(player.id);
      socket.data.roomCode = null;
      socket.data.token = null;
      if (room.players.length === 0) manager.removeRoom(room.code);
      done({ ok: true });
    });

    socket.on('disconnect', () => {
      const room = manager.getRoom(socket.data.roomCode);
      if (room) room.disconnect(socket.id);
    });
  });
};
