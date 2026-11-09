'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const config = require('./config');
const logger = require('./logger');
const { loadAll } = require('./cards');
const manager = require('./roomManager');
const registerSocketHandlers = require('./socketHandlers');

loadAll(); // يتأكد من سلامة ملفات البطاقات قبل التشغيل

const app = express();
app.disable('x-powered-by');
if (config.TRUST_PROXY) app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: manager.size() }));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });
registerSocketHandlers(io);
manager.startCleanup();

server.listen(config.PORT, '0.0.0.0', () => {
  logger.info(`Mazad Game شغّال على المنفذ ${config.PORT}`);
  logger.info(`افتح: http://localhost:${config.PORT}`);
});

// ---------- إيقاف نظيف ----------
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`استلمت ${signal}، جاري إيقاف السيرفر...`);
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();
  manager.removeAll();
  io.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => logger.error('unhandledRejection:', e));
process.on('uncaughtException', (e) => {
  logger.error('uncaughtException:', e);
  shutdown('uncaughtException');
});
