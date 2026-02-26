const fs = require('fs');
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer-core');

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
const SHORT_CONTENT_THRESHOLD = 300;
const MAX_CONTENT_KO = 9000;
const MAX_CONTENT_EN = 3500;
const MIN_DETAIL_GAIN = 120;
const RETRY_DELAY_MS = 120;
const DETAIL_WAIT_MS = 2200;
const BROWSER_CANDIDATE_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);

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
  'UI 소개': 'UI Introduction',
  '타이틀': 'Title',
  '옷장': 'Wardrobe',
  '랭킹': 'Ranking',
  '보급 의뢰': 'Supply Request',
  '정기추출': 'Aether Extraction',
  '제작 관리': 'Crafting Management',
  '물질 변환': 'Material Transformation'
};
const NOISE_LINE_PATTERNS = [
  /^Open aion2$/i,
  /^aion2$/i,
  /^게임소개$/i,
  /^소식N$/i,
  /^이벤트ONN$/i,
  /^가이드북$/i,
  /^아이템$/i,
  /^커뮤니티N$/i,
  /^레기온아지트$/i,
  /^캐릭터정보실N$/i,
  /^스타일샵N$/i,
  /^CM 아지트N$/i,
  /^미디어$/i,
  /^퍼플온$/i,
  /^플레이external$/i,
  /^월렛Nexternal$/i,
  /^PLAYNC 서비스$/i,
  /^PLAYNC 게임$/i,
  /^로그인$/i,
  /^회원가입$/i,
  /^고객지원$/i,
  /^Download$/i,
  /^가이드 목록$/i,
  /^가이드북 검색$/i,
  /^최근검색어 내역이 없습니다\.$/i,
  /^최근 검색어 전체 삭제$/i,
  /^페이지 위로가기$/i,
  /^그만보기$/i,
  /^실시간 문의는 챗봇에서!?$/i,
  /^Table of Contents Close$/i,
  /^Close Table of Contents$/i,
  /^목차 닫기$/i,
  /^Youtube$/i,
  /^회사소개이용약관개인정보/i,
  /^회사소개$/i,
  /^이용약관$/i,
  /^개인정보/,
  /^\[Go to .*Service Policy.*\]$/i
];

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

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
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

function mergeUnique(listA = [], listB = [], max = 8) {
  const out = [];
  for (const v of [...listA, ...listB]) {
    if (typeof v !== 'string' || !v.startsWith('http')) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function makeDesc(summary, content, fallback = 'Official guide entry') {
  const first = normalizeText(summary || '');
  if (first) return first.slice(0, 260);
  const body = normalizeText(String(content || '').split('\n')[0] || '');
  if (!body) return fallback;
  return body.slice(0, 260);
}

function isNoiseLine(line) {
  const value = normalizeText(line);
  if (!value) return true;
  return NOISE_LINE_PATTERNS.some(rx => rx.test(value));
}

function cleanGuideText(text, { titleHint = '' } = {}) {
  const raw = String(text || '').replace(/\r/g, '\n');
  const sourceLines = raw.split('\n').map(line => normalizeText(line));
  const cleaned = [];
  for (const line of sourceLines) {
    if (!line) continue;
    if (isNoiseLine(line)) continue;
    cleaned.push(line);
  }

  let merged = cleaned.join('\n');
  if (titleHint) {
    const hint = normalizeText(titleHint);
    const idx = merged.indexOf(hint);
    if (idx > 0 && idx < 500) merged = merged.slice(idx);
  }
  merged = merged
    .replace(/\b(Open aion2|Playexternal|WalletNexternal|Guidebook)\b/gi, ' ')
    .replace(/Table of Contents Close/gi, ' ')
    .replace(/Close Table of Contents/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  return merged.trim();
}

function trimToParagraphs(text, maxLen) {
  const paras = String(text || '')
    .split(/\n{2,}|\n/)
    .map(p => normalizeText(p))
    .filter(Boolean);
  if (paras.length === 0) return '';

  let out = '';
  for (const para of paras) {
    const candidate = out ? `${out}\n\n${para}` : para;
    if (candidate.length <= maxLen) {
      out = candidate;
      continue;
    }
    if (!out) {
      let first = para.slice(0, maxLen);
      const punct = Math.max(first.lastIndexOf('. '), first.lastIndexOf('! '), first.lastIndexOf('? '));
      if (punct > Math.floor(maxLen * 0.55)) first = first.slice(0, punct + 1);
      out = first;
    }
    break;
  }
  return out.trim();
}

async function forceEnglishText(text, fallbackSource = '', maxLen = MAX_CONTENT_EN) {
  let output = cleanGuideText(text);
  if (!output || hasHangul(output)) {
    const source = cleanGuideText(fallbackSource);
    if (source) {
      const translated = await translateKoToEnLong(source, maxLen * 2);
      output = cleanGuideText(translated);
    }
  }
  if (hasHangul(output)) {
    output = output.replace(/[ㄱ-ㅎㅏ-ㅣ가-힣]/g, ' ');
    output = normalizeText(output);
  }
  return trimToParagraphs(output, maxLen);
}

function getExecutablePath() {
  for (const p of BROWSER_CANDIDATE_PATHS) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

async function createBrowser() {
  const executablePath = getExecutablePath();
  if (!executablePath) {
    throw new Error('No local Chrome/Edge executable found. Set CHROME_PATH.');
  }
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ],
    defaultViewport: { width: 1440, height: 2000 }
  });
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
  const bodyText = cleanGuideText(stripHtmlToText(item?.content || ''), { titleHint: title });
  const desc = makeDesc(summary, bodyText, 'Official guide entry');
  const content = trimToParagraphs(bodyText || summary || '', MAX_CONTENT_KO);
  let titleEn = await translateKoToEn(title);
  if (TITLE_EN_OVERRIDES[title]) titleEn = TITLE_EN_OVERRIDES[title];
  if (!titleEn || /^title$/i.test(titleEn)) titleEn = TITLE_EN_OVERRIDES[title] || 'Guide';
  titleEn = normalizeText(titleEn);
  const descEn = await translateKoToEn(desc);
  const contentEnRaw = await translateKoToEnLong(content, MAX_CONTENT_EN * 2);
  const contentEn = await forceEnglishText(contentEnRaw, content, MAX_CONTENT_EN);
  const descEnFixed = await forceEnglishText(descEn, desc, 260);
  return {
    id: item?.id || null,
    categoryId: item?.categoryId || null,
    title,
    titleEn,
    url: pickGuidebookUrl(item),
    desc,
    descEn: descEnFixed,
    content,
    contentEn,
    images: extractImages(item)
  };
}

function needsDetailRetry(guide) {
  return normalizeText(guide?.content || '').length < SHORT_CONTENT_THRESHOLD;
}

async function scrapeRenderedGuideDetail(browser, guideUrl, expectedTitle = '') {
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
    await page.goto(guideUrl, { waitUntil: 'networkidle2', timeout: 35000 });
    await sleep(DETAIL_WAIT_MS);

    const data = await page.evaluate((titleHint) => {
      const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const trimNoise = (s) => {
        const lines = String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
        const noise = new Set([
          'Open aion2', '로그인', '회원가입', '고객지원', 'Download', 'PLAYNC 서비스',
          'PLAYNC 게임', '가이드 목록', '가이드북 검색', '최근검색어 내역이 없습니다.',
          '최근 검색어 전체 삭제', '페이지 위로가기', '그만보기', '실시간 문의는 챗봇에서!'
        ]);
        const filtered = lines.filter(line => !noise.has(line));
        return normalize(filtered.join('\n'));
      };

      const candidates = [];
      const selectors = [
        'main article',
        'main section',
        'article',
        'main [class*="guide"]',
        'main [class*="content"]',
        'main [class*="viewer"]',
        'main [class*="editor"]',
        'main'
      ];

      for (const sel of selectors) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const text = trimNoise(el.innerText || '');
          if (!text || text.length < 80) continue;
          const pCount = el.querySelectorAll('p,li,h2,h3,h4').length;
          const imgUrls = Array.from(el.querySelectorAll('img'))
            .map(img => img.src || img.getAttribute('src') || '')
            .filter(src => typeof src === 'string' && src.startsWith('http'));
          candidates.push({
            selector: sel,
            text,
            score: (pCount * 120) + text.length,
            images: imgUrls
          });
        }
      }

      if (candidates.length === 0) {
        const body = trimNoise(document.body?.innerText || '');
        return {
          title: normalize(document.querySelector('h1')?.innerText || titleHint || ''),
          content: body,
          images: []
        };
      }

      candidates.sort((a, b) => b.score - a.score);
      let best = candidates[0];
      const title = normalize(document.querySelector('h1')?.innerText || titleHint || '');
      if (title) {
        const hasTitleHit = candidates.find(c => c.text.includes(title));
        if (hasTitleHit) best = hasTitleHit;
      }

      let content = best.text;
      if (title && content.includes(title)) {
        const idx = content.indexOf(title);
        if (idx >= 0 && idx < 400) content = content.slice(idx);
      }

      return {
        title,
        content,
        images: Array.from(new Set(best.images)).slice(0, 6)
      };
    }, expectedTitle);

    return {
      title: normalizeText(data?.title || ''),
      content: normalizeText(data?.content || ''),
      images: Array.isArray(data?.images) ? data.images : []
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function enrichGuideDetailWithRetry(browser, guide) {
  if (!guide?.url || !needsDetailRetry(guide)) return guide;
  const currentLen = normalizeText(guide.content || '').length;
  try {
    const detail = await scrapeRenderedGuideDetail(browser, guide.url, guide.title || '');
    const detailContent = cleanGuideText(detail.content || '', { titleHint: guide.title || '' });
    const detailLen = normalizeText(detailContent || '').length;
    if (detailLen >= currentLen + MIN_DETAIL_GAIN) {
      guide.content = trimToParagraphs(detailContent, MAX_CONTENT_KO);
      guide.desc = makeDesc(guide.desc, guide.content, 'Official guide entry');
      guide.images = mergeUnique(guide.images || [], detail.images || [], 8);
      if (detail.title) guide.title = detail.title;

      let nextTitleEn = await translateKoToEn(guide.title);
      if (TITLE_EN_OVERRIDES[guide.title]) nextTitleEn = TITLE_EN_OVERRIDES[guide.title];
      if (!nextTitleEn || /^title$/i.test(nextTitleEn)) nextTitleEn = TITLE_EN_OVERRIDES[guide.title] || 'Guide';
      guide.titleEn = nextTitleEn;
      const nextDescEn = await translateKoToEn(guide.desc);
      const nextContentEn = await translateKoToEnLong(guide.content, MAX_CONTENT_EN * 2);
      guide.descEn = await forceEnglishText(nextDescEn, guide.desc, 260);
      guide.contentEn = await forceEnglishText(nextContentEn, guide.content, MAX_CONTENT_EN);
    }
  } catch (err) {
    console.warn(`[guidebook] detail retry failed for "${guide.title}": ${err.message}`);
  }
  return guide;
}

async function main() {
  let browser = null;
  try {
    const result = { fetchedAt: new Date().toISOString(), categories: [] };
    const byId = new Map(CATEGORIES.map(c => [String(c.id), c]));
    browser = await createBrowser();

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
        await sleep(80);
      }

      let shortBefore = guides.filter(needsDetailRetry).length;
      if (shortBefore > 0) {
        console.log(`[guidebook] category ${key} short guides before retry: ${shortBefore}`);
      }
      for (let i = 0; i < guides.length; i++) {
        if (!needsDetailRetry(guides[i])) continue;
        await enrichGuideDetailWithRetry(browser, guides[i]);
        await sleep(RETRY_DELAY_MS);
      }
      const shortAfter = guides.filter(needsDetailRetry).length;
      if (shortBefore > 0) {
        console.log(`[guidebook] category ${key} short guides after retry: ${shortAfter}`);
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
    const shortTotal = result.categories.reduce((n, c) => n + (c.guides || []).filter(needsDetailRetry).length, 0);
    console.log(`[guidebook] done. categories=${result.categories.length}, guides=${total}`);
    console.log(`[guidebook] short guides remaining (<${SHORT_CONTENT_THRESHOLD}): ${shortTotal}`);
    console.log(`[guidebook] output: ${OUTPUT_PATH}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch(err => {
  console.error('[guidebook] failed:', err);
  process.exit(1);
});
