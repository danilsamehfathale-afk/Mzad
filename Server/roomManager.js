'use strict';
const crypto = require('crypto');
const config = require('./config');
const Room = require('./room');
const { getDeck } = require('./cards');
const logger = require('./logger');

const rooms = new Map();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون حروف متشابهة

function settingsFromConfig() {
  return {
    teamSize: config.TEAM_SIZE,
    maxPlayers: config.MAX_PLAYERS_PER_ROOM,
    startBudget: config.START_BUDGET,
    auctionSeconds: config.AUCTION_SECONDS,
    extendWindowSeconds: config.EXTEND_WINDOW_SECONDS,
    extendSeconds: config.EXTEND_SECONDS,
    minIncrement: config.MIN_BID_INCREMENT,
    minOpeningBid: config.MIN_OPENING_BID,
    resultDelaySeconds: config.RESULT_DELAY_SECONDS,
    currency: config.CURRENCY_LABEL,
    waitingGraceSeconds: config.WAITING_GRACE_SECONDS,
  };
}

function genCode() {
  for (let tries = 0; tries < 50; tries++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('تعذّر إنشاء رمز غرفة');
}

function createRoom(type, onChange) {
  if (rooms.size >= config.MAX_ROOMS) {
    logger.warn(`وصلنا للحد الأقصى للغرف (${config.MAX_ROOMS})`);
    throw new Error('السيرفر ممتلئ حاليًا، جرّب بعد شوية');
  }
  const room = new Room({
    code: genCode(),
    type,
    deck: getDeck(type),
    settings: settingsFromConfig(),
    onChange,
    logger,
  });
  rooms.set(room.code, room);
  logger.info(`room ${room.code}: created (${type}), total rooms=${rooms.size}`);
  return room;
}

function getRoom(code) {
  if (typeof code !== 'string') return undefined;
  return rooms.get(code.trim().toUpperCase());
}

function removeRoom(code) {
  const room = rooms.get(code);
  if (room) {
    room.destroy();
    rooms.delete(code);
    logger.info(`room ${code}: removed, total rooms=${rooms.size}`);
  }
}

function removeAll() {
  for (const code of [...rooms.keys()]) removeRoom(code);
}

// تنظيف الغرف الفاضية (محدش متصل فيها) بعد فترة
function startCleanup() {
  const ttl = config.EMPTY_ROOM_TTL_MINUTES * 60 * 1000;
  const handle = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (!room.hasConnectedPlayers() && now - room.lastActivity > ttl) removeRoom(code);
    }
  }, 60 * 1000);
  handle.unref();
}

module.exports = { createRoom, getRoom, removeRoom, removeAll, startCleanup, size: () => rooms.size };
