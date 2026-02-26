const fs = require('fs');
const path = require('path');
const axios = require('axios');

const GUIDEBOOK_BASE_URL = 'https://aion2.plaync.com/ko-kr/guidebook';
const OUTPUT_PATH = path.join(__dirname, '..', 'guidebook_official_seed.json');
const CATEGORIES = [
  { id: '4227', name: "Beginner's Guide", nameEn: "Beginner's Guide" },
  { id: '4234', name: 'Class', nameEn: 'Class' },
  { id: '4235', name: 'Skill', nameEn: 'Skill' },
  { id: '4236', name: 'Items', nameEn: 'Items' },
  { id: '4237', name: 'Journal', nameEn: 'Journal' },
  { id: '4238', name: 'Regions', nameEn: 'Regions' },
  { id: '4239', name: 'Growth & Collection', nameEn: 'Growth & Collection' },
  { id: '4240', name: 'PK & Duel', nameEn: 'PK & Duel' },
  { id: '4241', name: 'Monsters & Dungeons', nameEn: 'Monsters & Dungeons' },
  { id: '4242', name: 'Community', nameEn: 'Community' },
  { id: '4243', name: 'Main Systems', nameEn: 'Main Systems' },
  { id: '4244', name: 'Gathering & Crafting', nameEn: 'Gathering & Crafting' }
];

// Canonical English labels for frequently-used guide routes.
const TITLE_EN_OVERRIDES = {
  '클래스 소개': 'Class Overview',
  '검성': 'Gladiator',
  '수호성': 'Templar',
  '살성': 'Assassin',
  '궁성': 'Ranger',
  '마도성': 'Sorcerer',
  '정령성': 'Spiritmaster',
  '치유성': 'Cleric',
  '호법성': 'Chanter',
  '스킬 소개': 'Skill Overview',
  '검성 스킬': 'Gladiator Skills',
  '수호성 스킬': 'Templar Skills',
  '살성 스킬': 'Assassin Skills',
  '궁성 스킬': 'Ranger Skills',
  '마도성 스킬': 'Sorcerer Skills',
  '정령성 스킬': 'Spiritmaster Skills',
  '치유성 스킬': 'Cleric Skills',
  '호법성 스킬': 'Chanter Skills',
  '아이템 기본 안내': 'Item Basics',
  '장비': 'Equipment',
  '기타 아이템': 'Misc Items',
  '저널 소개': 'Journal Overview',
  '퀘스트 종류': 'Quest Types',
  '마계': 'Asmodae',
  '천계': 'Elysea',
  '어비스 에레슈란타': 'Abyss: Reshanta',
  '통합 강화': 'Unified Enhancement',
  '봉혼석 시스템': 'Soulstone System',
  '업적': 'Achievements',
  'PK 및 결투': 'PK and Duel',
  '원정': 'Expedition',
  '봉인 던전 및 주둔지': 'Sealed Dungeons and Garrisons',
  '성역': 'Sanctuary',
  '전장': 'Battlefield',
  '각성전': 'Awakening Battle',
  '토벌전': 'Subjugation Battle',
  '파티 및 포스 시스템': 'Party and Force System',
  '레기온': 'Legion',
  '만신전': 'Pantheon',
  '친구 관리': 'Friend Management',
  '우편': 'Mail',
  '채팅': 'Chat',
  '감정표현': 'Emotes',
  '거래소': 'Trading Post',
  '교환소': 'Exchange Center',
  '스타일 샵': 'Style Shop',
  '구독 및 패스': 'Subscriptions and Passes',
  '사망 및 부활': 'Death and Resurrection',
  '활강 및 비행 시스템': 'Gliding and Flight System',
  '바람길 및 용오름 시스템': 'Wind Path and Updraft System',
  '옷장': 'Wardrobe',
  '랭킹': 'Ranking',
  '보급 의뢰': 'Supply Request',
  '정기추출': 'Aether Extraction',
  '제작 관리': 'Crafting Management',
  '물질 변환': 'Material Transformation'
};

function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function hasHangul(text) {
  return /[\u3131-\u318E\uAC00-\uD7A3]/.test(String(text || ''));
}

function stripHtml(html) {
  return normalizeText(
    String(html || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
  );
}

function pickGuidebookUrl(item) {
  if (item && typeof item.url === 'string' && item.url.trim()) return item.url.trim();
  if (item && typeof item.name === 'string' && item.name.trim()) {
    return `${GUIDEBOOK_BASE_URL}/view?title=${encodeURIComponent(item.name.trim())}`;
  }
  return `${GUIDEBOOK_BASE_URL}/list`;
}

function extractImages(item) {
  const out = [];
  const candidates = [item.thumbnailUrl, item.backgroundUrl];
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('http') && !out.includes(c)) out.push(c);
  }
  return out.slice(0, 6);
}

function collectGuidebooksRecursively(categoryNode, sink = []) {
  if (!categoryNode || typeof categoryNode !== 'object') return sink;
  const guides = Array.isArray(categoryNode.guidebooks) ? categoryNode.guidebooks : [];
  for (const g of guides) sink.push(g);
  const children = Array.isArray(categoryNode.children) ? categoryNode.children : [];
  for (const child of children) collectGuidebooksRecursively(child, sink);
  return sink;
}

async function fetchJson(url) {
  const { data } = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      'Accept': 'application/json'
    }
  });
  return data;
}

async function translateKoToEnViaMyMemory(text) {
  const input = String(text || '').trim();
  if (!input) return null;
  try {
    const { data } = await axios.get('https://api.mymemory.translated.net/get', {
      params: { q: input.slice(0, 450), langpair: 'ko|en' },
      timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const translated = normalizeText(data?.responseData?.translatedText || '');
    if (!translated) return null;
    return translated;
  } catch {
    return null;
  }
}

async function translateKoToEnViaGoogle(text) {
  const input = String(text || '').trim();
  if (!input) return null;
  try {
    const { data } = await axios.get('https://translate.googleapis.com/translate_a/single', {
      params: { client: 'gtx', sl: 'ko', tl: 'en', dt: 't', q: input.slice(0, 2000) },
      timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
    const translated = normalizeText(data[0].map(part => (Array.isArray(part) ? String(part[0] || '') : '')).join(' '));
    return translated || null;
  } catch {
    return null;
  }
}

async function translateKoToEn(text) {
  const input = String(text || '').trim();
  if (!input) return '';
  if (!hasHangul(input)) return input;
  const tryOne = await translateKoToEnViaMyMemory(input);
  if (tryOne && !hasHangul(tryOne)) return tryOne;
  const tryTwo = await translateKoToEnViaGoogle(input);
  if (tryTwo && !hasHangul(tryTwo)) return tryTwo;
  return input;
}

async function translateKoToEnLong(text, maxOutput = 3500) {
  const input = String(text || '').trim();
  if (!input) return '';
  if (!hasHangul(input)) return input.slice(0, maxOutput);
  const chunks = [];
  for (let i = 0; i < input.length; i += 450) chunks.push(input.slice(i, i + 450));
  const out = [];
  for (const chunk of chunks) {
    const translated = await translateKoToEn(chunk);
    out.push(translated || chunk);
  }
  return normalizeText(out.join(' ')).slice(0, maxOutput);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function toGuideEntry(item) {
  const title = normalizeText(item?.name || 'Guide');
  const summary = normalizeText(item?.summary || '');
  const bodyText = stripHtml(item?.content || '');
  const desc = (summary || bodyText || 'Official guide entry').slice(0, 260);
  const content = (bodyText || summary || '').slice(0, 9000);
  let titleEn = await translateKoToEn(title);
  if (TITLE_EN_OVERRIDES[title]) titleEn = TITLE_EN_OVERRIDES[title];
  const descEn = await translateKoToEn(desc);
  const contentEn = await translateKoToEnLong(content, 3500);
  return {
    title,
    titleEn,
    url: pickGuidebookUrl(item),
    desc,
    descEn,
    content,
    contentEn,
    images: extractImages(item)
  };
}

async function main() {
  try {
    const result = { fetchedAt: new Date().toISOString(), categories: [] };
    const byId = new Map(CATEGORIES.map(c => [String(c.id), c]));

    const topCategories = await fetchJson('https://aion2.plaync.com/api/v2/aion2/categories');
    const topArray = Array.isArray(topCategories) ? topCategories : [];

    for (const category of topArray) {
      const key = String(category?.id || '');
      if (!byId.has(key)) continue;
      console.log(`[guidebook] category ${key} collecting from API...`);
      const detail = await fetchJson(`https://aion2.plaync.com/api/v2/aion2/category/${key}`);
      const rawGuides = collectGuidebooksRecursively(detail, []);
      const dedup = new Map();
      for (const g of rawGuides) {
        const idKey = String(g?.id || '') || `${g?.name || ''}|${g?.categoryId || ''}`;
        if (!dedup.has(idKey)) dedup.set(idKey, g);
      }
      const guides = [];
      for (const g of Array.from(dedup.values())) {
        guides.push(await toGuideEntry(g));
        await sleep(120);
      }
      const meta = byId.get(key);
      result.categories.push({
        id: meta.id,
        name: meta.name,
        nameEn: meta.nameEn,
        guides
      });
      console.log(`[guidebook] category ${key} guides: ${guides.length}`);
    }

    // Ensure output order matches desired 12-category grid
    const ordered = [];
    for (const c of CATEGORIES) {
      const hit = result.categories.find(x => String(x.id) === String(c.id));
      ordered.push(hit || { id: c.id, name: c.name, nameEn: c.nameEn, guides: [] });
    }
    result.categories = ordered;

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
    const total = result.categories.reduce((n, c) => n + (c.guides?.length || 0), 0);
    console.log(`[guidebook] done. categories=${result.categories.length}, guides=${total}`);
    console.log(`[guidebook] output: ${OUTPUT_PATH}`);
  } finally {}
}

main().catch(err => {
  console.error('[guidebook] failed:', err);
  process.exit(1);
});
