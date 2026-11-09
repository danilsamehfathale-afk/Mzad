'use strict';
// تحميل صور لاعبي كرة القدم من ويكيبيديا (صور الأنمي: scripts/fetch-anime-images.js)
// تحميل صور البطاقات من ويكيبيديا وحفظها محليًا داخل public/images
// التشغيل (محتاج إنترنت):  npm run images
// لإعادة تحميل كل الصور حتى اللي اتحملت قبل كده:  npm run images -- --force
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const UA = 'MazadGame/1.0 (personal hobby project; contact: none)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function titleFor(card) {
  return (card.wiki || card.nameEn).trim().replace(/\s+/g, '_');
}

function extFrom(url) {
  const m = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif)$/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

async function run({ fetchImpl = globalThis.fetch, force = false, delayMs = 300, types = ['football'] } = {}) {
  const stats = { ok: 0, skipped: 0, failed: [] };
  for (const type of types) {
    const file = path.join(ROOT, 'data', `${type}.json`);
    const cards = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const card of cards) {
      const hasReal = card.image && !card.image.endsWith('.svg');
      if (hasReal && !force) { stats.skipped++; continue; }
      const title = titleFor(card);
      try {
        const res = await fetchImpl(API + encodeURIComponent(title), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const info = await res.json();
        if (info.type === 'disambiguation') throw new Error('صفحة توضيح، حط الاسم الصحيح في حقل wiki');
        const src = info.thumbnail && info.thumbnail.source;
        if (!src) throw new Error('الصفحة مفيهاش صورة');
        const img = await fetchImpl(src, { headers: { 'User-Agent': UA } });
        if (!img.ok) throw new Error('تحميل الصورة HTTP ' + img.status);
        const rel = `images/${type}/${card.id}.${extFrom(src)}`;
        fs.writeFileSync(path.join(ROOT, 'public', rel), Buffer.from(await img.arrayBuffer()));
        card.image = rel;
        card.imageSource = `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
        stats.ok++;
        console.log('✓', type, card.id, card.nameEn);
      } catch (e) {
        stats.failed.push(`${type}/${card.id} ${card.nameEn}: ${e.message}`);
        console.log('✗', type, card.id, card.nameEn, '-', e.message);
      }
      await sleep(delayMs);
    }
    fs.writeFileSync(file, JSON.stringify(cards, null, 2) + '\n');
  }
  console.log(`\nتم: ${stats.ok} | متخطّى: ${stats.skipped} | فشل: ${stats.failed.length}`);
  if (stats.failed.length) console.log('اللي فشل هيفضل بالصورة البديلة:\n' + stats.failed.join('\n'));
  return stats;
}

module.exports = { run };
if (require.main === module) run({ force: process.argv.includes('--force') });
