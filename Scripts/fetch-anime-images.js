'use strict';
// تحميل صور شخصيات الأنمي من AniList وحفظها محليًا في public/images/anime
// التشغيل (محتاج إنترنت):  npm run images:anime
// لإعادة تحميل الكل:       npm run images:anime -- --force
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const URL_API = 'https://graphql.anilist.co';
const UA = 'MazadGame/1.0 (personal hobby project)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// كلمات بنتأكد إنها موجودة في اسم العمل اللي الشخصية تابعة له (عشان منجيبش شخصية بنفس الاسم من أنمي تاني)
const SERIES_KEYWORDS = {
  onepiece: ['one piece'],
  naruto: ['naruto'],
  aot: ['shingeki no kyojin', 'attack on titan'],
  jjk: ['jujutsu kaisen'],
  demonslayer: ['kimetsu no yaiba', 'demon slayer'],
  blackclover: ['black clover'],
};

const QUERY = `query ($search: String) {
  Page(perPage: 6) {
    characters(search: $search) {
      id siteUrl
      name { full }
      image { large }
      media(perPage: 6) { nodes { title { romaji english } } }
    }
  }
}`;

function extFrom(url) {
  const m = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif)$/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

function pick(characters, series) {
  const keys = SERIES_KEYWORDS[series] || [];
  return characters.find((c) =>
    c.image && c.image.large &&
    c.media.nodes.some((n) => {
      const t = `${n.title.romaji || ''} ${n.title.english || ''}`.toLowerCase();
      return keys.some((k) => t.includes(k));
    })
  );
}

async function search(fetchImpl, name) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(URL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query: QUERY, variables: { search: name } }),
    });
    if (res.status === 429 && attempt === 0) {
      const wait = Number(res.headers && res.headers.get && res.headers.get('Retry-After')) || 30;
      console.log(`... انتظار ${wait} ثانية (حد الطلبات)`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return (json.data && json.data.Page && json.data.Page.characters) || [];
  }
  throw new Error('حد الطلبات');
}

async function run({ fetchImpl = globalThis.fetch, force = false, delayMs = 800 } = {}) {
  const file = path.join(ROOT, 'data', 'anime.json');
  const cards = JSON.parse(fs.readFileSync(file, 'utf8'));
  const stats = { ok: 0, skipped: 0, failed: [] };
  for (const card of cards) {
    if (card.image && !card.image.endsWith('.svg') && !force) { stats.skipped++; continue; }
    try {
      const found = pick(await search(fetchImpl, card.anilist || card.nameEn), card.series);
      if (!found) throw new Error('ما لقيتش شخصية مطابقة (جرّب حقل anilist باسم تاني)');
      const img = await fetchImpl(found.image.large, { headers: { 'User-Agent': UA } });
      if (!img.ok) throw new Error('تحميل الصورة HTTP ' + img.status);
      const rel = `images/anime/${card.id}.${extFrom(found.image.large)}`;
      fs.writeFileSync(path.join(ROOT, 'public', rel), Buffer.from(await img.arrayBuffer()));
      card.image = rel;
      card.imageSource = found.siteUrl;
      stats.ok++;
      console.log('✓', card.id, card.nameEn, '←', found.name.full);
    } catch (e) {
      stats.failed.push(`${card.id} ${card.nameEn}: ${e.message}`);
      console.log('✗', card.id, card.nameEn, '-', e.message);
    }
    await sleep(delayMs);
  }
  fs.writeFileSync(file, JSON.stringify(cards, null, 2) + '\n');
  console.log(`\nتم: ${stats.ok} | متخطّى: ${stats.skipped} | فشل: ${stats.failed.length}`);
  if (stats.failed.length) console.log('اللي فشل هيفضل بالصورة البديلة:\n' + stats.failed.join('\n'));
  return stats;
}

module.exports = { run, pick };
if (require.main === module) run({ force: process.argv.includes('--force') });
