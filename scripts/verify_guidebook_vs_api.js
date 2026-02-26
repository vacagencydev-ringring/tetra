/**
 * Verify guidebook_official_seed.json against PlayNC API.
 * Run: node scripts/verify_guidebook_vs_api.js
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SEED_PATH = path.join(__dirname, '..', 'guidebook_official_seed.json');
const CATEGORY_IDS = ['4227', '4234', '4235', '4236', '4237', '4238', '4239', '4240', '4241', '4242', '4243', '4244'];

function collectGuides(node, out = []) {
  const guides = node?.guidebooks || [];
  for (const g of guides) out.push(g);
  for (const c of node?.children || []) collectGuides(c, out);
  return out;
}

async function fetchApiGuides() {
  const byCat = {};
  for (const id of CATEGORY_IDS) {
    try {
      const { data } = await axios.get(`https://aion2.plaync.com/api/v2/aion2/category/${id}`, { timeout: 15000 });
      byCat[id] = collectGuides(data);
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.error(`[API] category ${id} failed:`, e.message);
      byCat[id] = [];
    }
  }
  return byCat;
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function main() {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const api = await fetchApiGuides();

  const report = { missing: [], extra: [], mismatch: [], typos: [], apiCount: 0, seedCount: 0 };

  const seedById = new Map();
  for (const cat of seed.categories || []) {
    for (const g of cat.guides || []) {
      report.seedCount++;
      seedById.set(g.id, { ...g, categoryId: String(cat.id) });
    }
  }

  const apiById = new Map();
  for (const [cid, guides] of Object.entries(api)) {
    for (const g of guides) {
      report.apiCount++;
      apiById.set(g.id, { ...g, categoryId: cid });
    }
  }

  for (const [id, apiGuide] of apiById) {
    const seedGuide = seedById.get(id);
    if (!seedGuide) {
      report.missing.push({ id, title: apiGuide.name, categoryId: apiGuide.categoryId });
      continue;
    }
    const apiTitle = (apiGuide.name || '').trim();
    const seedTitleKo = (seedGuide.title || '').trim();
    if (apiTitle && seedTitleKo && apiTitle !== seedTitleKo) {
      report.mismatch.push({ id, api: apiTitle, seed: seedTitleKo });
    }
  }

  for (const [id, seedGuide] of seedById) {
    if (!apiById.has(id)) {
      report.extra.push({ id, title: seedGuide.title });
    }
  }

  const knownTypos = [
    { pattern: /서택/g, fix: '선택', desc: '서택 → 선택 (오타)' },
    { pattern: /뱡향/g, fix: '방향', desc: '뱡향 → 방향 (오타)' },
  ];

  for (const cat of seed.categories || []) {
    for (const g of cat.guides || []) {
      const text = (g.content || '') + (g.contentEn || '');
      for (const t of knownTypos) {
        if (t.pattern.test(text)) {
          report.typos.push({ id: g.id, title: g.title, desc: t.desc });
        }
      }
    }
  }

  console.log('═══════════════════════════════════════');
  console.log('Guidebook verification report');
  console.log('═══════════════════════════════════════');
  console.log('API guides:', report.apiCount);
  console.log('Seed guides:', report.seedCount);
  console.log('');
  if (report.missing.length) {
    console.log('❌ MISSING in seed (exist in API):', report.missing.length);
    report.missing.slice(0, 10).forEach(x => console.log('  -', x.id, x.title));
  }
  if (report.extra.length) {
    console.log('⚠️ EXTRA in seed (not in API):', report.extra.length);
    report.extra.slice(0, 10).forEach(x => console.log('  -', x.id, x.title));
  }
  if (report.mismatch.length) {
    console.log('⚠️ TITLE MISMATCH:', report.mismatch.length);
    report.mismatch.slice(0, 5).forEach(x => console.log('  -', x.id, 'API:', x.api, '| Seed:', x.seed));
  }
  if (report.typos.length) {
    console.log('📝 TYPOS found:', report.typos.length);
    report.typos.forEach(x => console.log('  -', x.title, ':', x.desc));
  }
  const truncation = [];
  const shortContent = [];
  for (const cat of seed.categories || []) {
    for (const g of cat.guides || []) {
      const en = (g.contentEn || '').trim();
      if (en.length < 100) shortContent.push({ id: g.id, title: g.title, len: en.length });
      const lastCh = en.slice(-1);
      const endsWell = /[.!?")]\s*$/.test(en) || en.endsWith('OFF');
      if (en.length > 200 && !endsWell && /[a-z]$/i.test(lastCh)) truncation.push({ id: g.id, title: g.title, end: en.slice(-40) });
    }
  }
  if (shortContent.length) {
    console.log('⚠️ SHORT contentEn (<100 chars):', shortContent.length);
    shortContent.forEach(x => console.log('  -', x.title, '(', x.len, 'chars)'));
  }
  if (truncation.length) {
    console.log('⚠️ Possible TRUNCATION (ends without period):', truncation.length);
    truncation.slice(0, 5).forEach(x => console.log('  -', x.title, '...', x.end));
  }

  if (!report.missing.length && !report.extra.length && !report.mismatch.length && !report.typos.length && !shortContent.length && !truncation.length) {
    console.log('✅ No issues found.');
  }
  return report;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
