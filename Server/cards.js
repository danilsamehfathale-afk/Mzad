'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

const EXPECTED_COUNTS = { football: 35, anime: 40 };
const TYPES = Object.keys(EXPECTED_COUNTS);
const cache = {};

function tierFor(rating) {
  if (rating >= config.TIER_LEGEND) return 'legend';
  if (rating >= config.TIER_EPIC) return 'epic';
  if (rating >= config.TIER_RARE) return 'rare';
  return 'common';
}

const PLACEHOLDER = 'images/placeholder.svg';

function imageOrPlaceholder(card) {
  if (!card.image) return PLACEHOLDER;
  const file = path.join(__dirname, '..', 'public', card.image);
  if (!fs.existsSync(file)) {
    console.warn(`تنبيه: صورة ${card.id} (${card.image}) مش موجودة، هتتستخدم الصورة البديلة`);
    return PLACEHOLDER;
  }
  return card.image;
}

function load(type) {
  if (cache[type]) return cache[type];
  const file = path.join(__dirname, '..', 'data', `${type}.json`);
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(list)) throw new Error(`${type}.json لازم يكون قائمة`);
  const ids = new Set();
  for (const c of list) {
    if (!c.id || !c.nameAr || !c.nameEn || !Number.isFinite(c.rating)) {
      throw new Error(`بطاقة ناقصة في ${type}.json: ${JSON.stringify(c)}`);
    }
    if (ids.has(c.id)) throw new Error(`id مكرر في ${type}.json: ${c.id}`);
    ids.add(c.id);
  }
  if (list.length !== EXPECTED_COUNTS[type]) {
    console.warn(`تنبيه: عدد بطاقات ${type} = ${list.length} والمتوقع ${EXPECTED_COUNTS[type]}`);
  }
  cache[type] = list.map((c) => ({
    ...c,
    type,
    image: imageOrPlaceholder(c),
    tier: tierFor(c.rating),
  }));
  return cache[type];
}

function loadAll() {
  TYPES.forEach(load);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getDeck(type) {
  if (!TYPES.includes(type)) throw new Error('نوع مزاد غير صحيح');
  return shuffle(load(type));
}

module.exports = { TYPES, EXPECTED_COUNTS, loadAll, getDeck, tierFor };
