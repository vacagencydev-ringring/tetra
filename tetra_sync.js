// ── 환경변수 로드 (.env 파일)
try { require('dotenv').config(); } catch (_) {}

// ── Render 생존 신고용 웹 서버 (UptimeRobot Ping)
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('TETRA Agency Bot is Online and Dominating.'));
app.listen(PORT, () => console.log(`[TETRA] Keep-alive server on port ${PORT}`));

const {
    Client,
    ChannelType,
    GatewayIntentBits,
    PermissionFlagsBits,
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    REST,
    Routes
} = require('discord.js');
const { google } = require('googleapis');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

// ═══════════════════════════════════════════════════════════
// [1] 설정
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const CONFIG = {
    REPORT_CHANNEL: process.env.REPORT_CHANNEL || '1475500753089990746',
    SALARY_CHANNEL: process.env.SALARY_CHANNEL || '1475449233757966438',
    SHEET_ID: process.env.SHEET_ID || '1-SscA750TuYUd6BcGQF-hXXO_5HI5HxpGkmYo_JXnR8',
    TOKEN: process.env.DISCORD_TOKEN,
    CREDENTIALS_PATH: path.join(__dirname, 'credentials.json.json'),
    PANEL_STATE_PATH: path.join(__dirname, 'panel_state.json'),
    KINAH_STATE_PATH: path.join(__dirname, 'kinah_state.json'),
    NOTICE_STATE_PATH: path.join(__dirname, 'notice_state.json'),
    KINAH_TICKER_MS: Math.max(60_000, parseInt(process.env.KINAH_TICKER_MS || '300000', 10) || 300_000),
    NOTICE_TICKER_MS: Math.max(60_000, parseInt(process.env.NOTICE_TICKER_MS || '600000', 10) || 600_000),
    AON_TRANSLATE_STATE_PATH: path.join(__dirname, 'aon_translate_state.json'),
    AON_SOURCE_BOT_ID: process.env.AON_SOURCE_BOT_ID || '1436590099235340410',
    PANEL_IMAGES: {
        salary: path.join(__dirname, 'panels', 'salary.png')
    }
};

function loadPanelState() { try { return JSON.parse(fs.readFileSync(CONFIG.PANEL_STATE_PATH, 'utf8')); } catch { return {}; } }
function savePanelState(s) { fs.writeFileSync(CONFIG.PANEL_STATE_PATH, JSON.stringify(s, null, 2)); }

// ── 시세 크롤러 상태
const KINAH_PRESET_TYPES = ['itembay_aion2', 'itemmania_aion2', 'dual_market_aion2'];
const KINAH_PRESET_DEFAULTS = {
    itembay_aion2: { primaryUrl: 'https://www.itembay.com/item/sell/game-3603/type-3', sourceKeyword: '아이온2 키나' },
    itemmania_aion2: { primaryUrl: 'https://trade.itemmania.com/list/search.html?searchString=%EC%95%84%EC%9D%B4%EC%98%A82%20%ED%82%A4%EB%82%98', sourceKeyword: '아이온2 키나' },
    dual_market_aion2: { primaryUrl: 'https://www.itembay.com/item/sell/game-3603/type-3', secondaryUrl: 'https://trade.itemmania.com/list/search.html?searchString=%EC%95%84%EC%9D%B4%EC%98%A82%20%ED%82%A4%EB%82%98', sourceKeyword: '아이온2 키나' }
};

function createDefaultKinahWatch(seed = null) {
    const base = { enabled: false, sourcePreset: null, sourceKeyword: '아이온2 키나', channelId: null, sourceUrl: null, secondarySourceUrl: null, selector: null, valueRegex: null, pollMinutes: 5, mentionRoleId: null, lastRate: null, lastRawText: null, lastSourceSummary: null, lastCheckedAt: null, lastPostedAt: null, lastError: null };
    if (!seed || typeof seed !== 'object') return { ...base };
    return {
        ...base,
        enabled: Boolean(seed.enabled),
        sourcePreset: typeof seed.sourcePreset === 'string' && KINAH_PRESET_TYPES.includes(seed.sourcePreset) ? seed.sourcePreset : null,
        sourceKeyword: typeof seed.sourceKeyword === 'string' && seed.sourceKeyword.length ? seed.sourceKeyword : base.sourceKeyword,
        channelId: typeof seed.channelId === 'string' && seed.channelId.length ? seed.channelId : null,
        sourceUrl: typeof seed.sourceUrl === 'string' && seed.sourceUrl.length ? seed.sourceUrl : null,
        secondarySourceUrl: typeof seed.secondarySourceUrl === 'string' && seed.secondarySourceUrl.length ? seed.secondarySourceUrl : null,
        selector: typeof seed.selector === 'string' && seed.selector.length ? seed.selector : null,
        valueRegex: typeof seed.valueRegex === 'string' && seed.valueRegex.length ? seed.valueRegex : null,
        pollMinutes: Math.max(1, Math.min(60, parseInt(String(seed.pollMinutes || 5), 10) || 5)),
        mentionRoleId: typeof seed.mentionRoleId === 'string' && seed.mentionRoleId.length ? seed.mentionRoleId : null,
        lastRate: Number.isFinite(Number(seed.lastRate)) ? Number(seed.lastRate) : null,
        lastRawText: typeof seed.lastRawText === 'string' && seed.lastRawText.length ? seed.lastRawText : null,
        lastSourceSummary: typeof seed.lastSourceSummary === 'string' && seed.lastSourceSummary.length ? seed.lastSourceSummary : null,
        lastCheckedAt: Number.isFinite(Number(seed.lastCheckedAt)) ? Number(seed.lastCheckedAt) : null,
        lastPostedAt: Number.isFinite(Number(seed.lastPostedAt)) ? Number(seed.lastPostedAt) : null,
        lastError: typeof seed.lastError === 'string' && seed.lastError.length ? seed.lastError : null
    };
}

function loadKinahState() {
    try {
        const raw = fs.readFileSync(CONFIG.KINAH_STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { guilds: {} };
        parsed.guilds = parsed.guilds || {};
        return parsed;
    } catch { return { guilds: {} }; }
}
const kinahState = loadKinahState();
function saveKinahState() { fs.writeFileSync(CONFIG.KINAH_STATE_PATH, JSON.stringify(kinahState, null, 2)); }

function ensureKinahGuildState(guildId) {
    if (!kinahState.guilds[guildId]) kinahState.guilds[guildId] = { kinah: createDefaultKinahWatch() };
    const g = kinahState.guilds[guildId];
    g.kinah = createDefaultKinahWatch(g.kinah);
    return g;
}

function hasManageGuild(interaction) { return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)); }
async function safeEphemeral(interaction, content) {
    if (interaction.replied || interaction.deferred) return interaction.followUp({ content, ephemeral: true }).catch(() => {});
    return interaction.reply({ content, ephemeral: true }).catch(() => {});
}
function toDiscordTime(epochMs) { return `<t:${Math.floor(epochMs / 1000)}:F> (<t:${Math.floor(epochMs / 1000)}:R>)`; }

// ── 공지 크롤러 (AION2 INFO: #NEWS, #Update_Note, #EVENT)
const NOTICE_LANG = (process.env.NOTICE_LANG || 'ko-kr').toLowerCase();
const NOTICE_BASE = NOTICE_LANG === 'en' || NOTICE_LANG === 'en-us' ? 'https://aion2.plaync.com/en-us/news' : 'https://aion2.plaync.com/ko-kr/news';
const DEFAULT_NOTICE_SOURCES = [
    { category: 'notice', url: `${NOTICE_BASE}/notice` },
    { category: 'update', url: `${NOTICE_BASE}/update` },
    { category: 'event', url: `${NOTICE_BASE}/event` },
    { category: 'maintenance', url: `${NOTICE_BASE}/maintenance` },
];
const NOTICE_CATEGORIES = ['notice', 'update', 'event', 'maintenance'];

function createNoticeChannelMap(seed = null) {
    const map = { notice: null, update: null, event: null, maintenance: null };
    if (!seed || typeof seed !== 'object') return map;
    for (const c of NOTICE_CATEGORIES) map[c] = typeof seed[c] === 'string' && seed[c].length ? seed[c] : null;
    return map;
}

function loadNoticeState() {
    try {
        const raw = fs.readFileSync(CONFIG.NOTICE_STATE_PATH, 'utf8');
        const p = JSON.parse(raw);
        if (!p || typeof p !== 'object') return { seenBySource: {}, guilds: {} };
        p.seenBySource = p.seenBySource || {};
        p.guilds = p.guilds || {};
        return p;
    } catch { return { seenBySource: {}, guilds: {} }; }
}
const noticeState = loadNoticeState();
function saveNoticeState() { fs.writeFileSync(CONFIG.NOTICE_STATE_PATH, JSON.stringify(noticeState, null, 2)); }

function ensureNoticeGuildState(guildId) {
    if (!noticeState.guilds[guildId]) noticeState.guilds[guildId] = { channelId: null, categories: ['notice', 'update', 'event', 'maintenance'], channelsByCategory: createNoticeChannelMap() };
    const g = noticeState.guilds[guildId];
    g.channelsByCategory = createNoticeChannelMap(g.channelsByCategory);
    g.categories = Array.isArray(g.categories) ? g.categories.filter(c => NOTICE_CATEGORIES.includes(c)) : NOTICE_CATEGORIES;
    if (!g.categories.length) g.categories = [...NOTICE_CATEGORIES];
    return g;
}

function noticeCategoryEnabled(categories, category) {
    if (!Array.isArray(categories) || !categories.length) return false;
    if (categories.includes('all')) return true;
    return categories.includes(category);
}
function getNoticeTargetChannelId(noticeConfig, category) {
    const routes = createNoticeChannelMap(noticeConfig?.channelsByCategory);
    return routes[category] || noticeConfig?.channelId || null;
}

function buildNoticeSourceKey(source) { return `${source.category}|${source.url}`; }

async function translateToEn(text) {
    if (!text || text.length < 2) return text;
    try {
        const { data } = await axios.get('https://api.mymemory.translated.net/get', {
            params: { q: String(text).slice(0, 500), langpair: 'ko|en' },
            timeout: 6000,
        });
        const translated = data?.responseData?.translatedText;
        return (translated && translated.trim()) || text;
    } catch (_) { return text; }
}

function parseNoticeFromHtml(html, sourceUrl) {
    const $ = cheerio.load(html);
    const entries = [];
    const seen = new Set();
    const source = new URL(sourceUrl);
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        const title = $(el).text().replace(/\s+/g, ' ').trim();
        if (!href || !title || title.length < 4 || title.length > 140) return;
        if (href.startsWith('#') || href.startsWith('javascript:')) return;
        let absolute;
        try { absolute = new URL(href, source).toString(); } catch (_) { return; }
        const parsed = new URL(absolute);
        if (parsed.pathname === source.pathname) return;
        if (!absolute.includes('/news/') && !absolute.includes('/board/') && !absolute.includes('/notice')) return;
        if (seen.has(absolute)) return;
        seen.add(absolute);
        entries.push({ id: absolute, title, url: absolute });
    });
    return entries.slice(0, 20);
}

async function fetchNoticeEntriesWithPuppeteer(sourceUrl) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 25000 });
        await new Promise(r => setTimeout(r, 2000));
        const html = await page.content();
        return parseNoticeFromHtml(html, sourceUrl);
    } finally {
        if (browser) await browser.close();
    }
}

async function fetchNoticeEntries(sourceUrl) {
    let entries = [];
    try {
        const { data } = await axios.get(sourceUrl, {
            timeout: 20000, maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            },
        });
        entries = parseNoticeFromHtml(data, sourceUrl);
    } catch (err) {
        console.error('[notice] axios', sourceUrl, err.message);
    }
    if (entries.length === 0) {
        try {
            entries = await fetchNoticeEntriesWithPuppeteer(sourceUrl);
            if (entries.length > 0) console.log('[notice] Puppeteer fallback OK:', sourceUrl);
        } catch (err) {
            console.error('[notice] puppeteer', sourceUrl, err.message);
        }
    }
    return entries;
}

let noticeTickerActive = false;
async function runNoticeTicker(client) {
    if (noticeTickerActive || !DEFAULT_NOTICE_SOURCES.length) return;
    noticeTickerActive = true;
    try {
        let changed = false;
        for (const source of DEFAULT_NOTICE_SOURCES) {
            let entries = [];
            try { entries = await fetchNoticeEntries(source.url); } catch (err) { console.error('[notice]', source.url, err.message); continue; }
            if (!entries.length) continue;
            const key = buildNoticeSourceKey(source);
            const previous = noticeState.seenBySource[key] || [];
            const seenSet = new Set(previous);
            if (previous.length === 0) {
                noticeState.seenBySource[key] = entries.map(e => e.id).slice(0, 200);
                changed = true;
                continue;
            }
            const fresh = entries.filter(e => !seenSet.has(e.id)).reverse();
            if (!fresh.length) continue;
            for (const guildId of Object.keys(noticeState.guilds || {})) {
                const noticeConfig = noticeState.guilds[guildId];
                if (!noticeCategoryEnabled(noticeConfig.categories, source.category)) continue;
                const targetChannelId = getNoticeTargetChannelId(noticeConfig, source.category);
                if (!targetChannelId) continue;
                const channel = await client.channels.fetch(targetChannelId).catch(() => null);
                if (!channel || !channel.isTextBased()) continue;
                const categoryLabel = source.category === 'notice' ? 'NEWS' : source.category === 'update' ? 'Update' : source.category === 'maintenance' ? 'Maintenance' : 'EVENT';
                for (const item of fresh) {
                    const titleEn = await translateToEn(item.title);
                    await new Promise(r => setTimeout(r, 400));
                    const embed = new EmbedBuilder()
                        .setTitle(`[${categoryLabel}] ${titleEn}`)
                        .setDescription(`[Go to Announcements](${item.url})`)
                        .setColor(0x0ea5e9)
                        .setTimestamp();
                    await channel.send({ embeds: [embed] }).catch(() => {});
                }
            }
            noticeState.seenBySource[key] = [...new Set([...fresh.map(f => f.id), ...previous])].slice(0, 200);
            changed = true;
        }
        if (changed) saveNoticeState();
    } finally { noticeTickerActive = false; }
}

function buildNoticeStatusEmbed(guildState) {
    const n = guildState?.notices || {};
    const routes = createNoticeChannelMap(n.channelsByCategory);
    const lines = NOTICE_CATEGORIES.map(c => {
        const ch = routes[c] || n.channelId;
        const label = c === 'notice' ? 'NEWS' : c === 'update' ? 'Update_Note' : c === 'maintenance' ? 'Maintenance' : 'EVENT';
        return `${label}: ${ch ? `<#${ch}>` : 'Not set'}`;
    });
    return new EmbedBuilder()
        .setTitle('AION2 Notice Relay Status')
        .setDescription(['**Channels by category:**', ...lines, '', `Sources: ${DEFAULT_NOTICE_SOURCES.length} (${NOTICE_LANG})`].join('\n'))
        .setColor(0x0ea5e9);
}

const panelUpdateLocks = new Set();

function createAonRouteMap(seed = null) {
    const map = { notice: null, update: null, event: null };
    if (!seed || typeof seed !== 'object') return map;
    for (const k of Object.keys(map)) {
        map[k] = typeof seed[k] === 'string' && seed[k].length ? seed[k] : null;
    }
    return map;
}

function loadAonTranslateState() {
    try {
        const raw = fs.readFileSync(CONFIG.AON_TRANSLATE_STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { guilds: {} };
        parsed.guilds = parsed.guilds || {};
        return parsed;
    } catch {
        return { guilds: {} };
    }
}
const aonTranslateState = loadAonTranslateState();
function saveAonTranslateState() { fs.writeFileSync(CONFIG.AON_TRANSLATE_STATE_PATH, JSON.stringify(aonTranslateState, null, 2)); }

function ensureAonTranslateGuildState(guildId) {
    if (!aonTranslateState.guilds[guildId]) {
        aonTranslateState.guilds[guildId] = {
            enabled: false,
            sourceBotId: CONFIG.AON_SOURCE_BOT_ID,
            routes: createAonRouteMap(),
            translatedMessageIds: []
        };
    }
    const g = aonTranslateState.guilds[guildId];
    g.enabled = Boolean(g.enabled);
    g.sourceBotId = typeof g.sourceBotId === 'string' && g.sourceBotId.length ? g.sourceBotId : CONFIG.AON_SOURCE_BOT_ID;
    g.routes = createAonRouteMap(g.routes);
    g.translatedMessageIds = Array.isArray(g.translatedMessageIds) ? g.translatedMessageIds.slice(-1000) : [];
    return g;
}

function splitForTranslation(text, max = 450) {
    const input = String(text || '').trim();
    if (!input) return [];
    const lines = input.split('\n');
    const chunks = [];
    let buf = '';
    for (const line of lines) {
        const candidate = buf ? `${buf}\n${line}` : line;
        if (candidate.length <= max) {
            buf = candidate;
        } else {
            if (buf) chunks.push(buf);
            if (line.length <= max) {
                buf = line;
            } else {
                // hard wrap long single line
                for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
                buf = '';
            }
        }
    }
    if (buf) chunks.push(buf);
    return chunks;
}

async function translateKoToEn(text) {
    const input = String(text || '').trim();
    if (!input) return input;
    if (!/[가-힣]/.test(input)) return input;
    try {
        const { data } = await axios.get('https://api.mymemory.translated.net/get', {
            params: { q: input.slice(0, 450), langpair: 'ko|en' },
            timeout: 7000
        });
        const translated = data?.responseData?.translatedText;
        return translated && translated.trim() ? translated.trim() : input;
    } catch {
        return input;
    }
}

async function translateKoToEnLong(text) {
    const chunks = splitForTranslation(text, 450);
    if (!chunks.length) return '';
    const translated = [];
    for (const chunk of chunks) translated.push(await translateKoToEn(chunk));
    return translated.join('\n');
}

function buildAonTranslateStatusEmbed(guildState) {
    const routes = createAonRouteMap(guildState.routes);
    const routeLine = Object.entries(routes).map(([k, v]) => `- ${k}: ${v ? `<#${v}>` : 'Not set'}`).join('\n');
    return new EmbedBuilder()
        .setTitle('AON -> EN Auto Translation')
        .setDescription([
            `Enabled: ${guildState.enabled ? 'Yes' : 'No'}`,
            `Source bot ID: \`${guildState.sourceBotId}\``,
            `Translated cache: ${guildState.translatedMessageIds.length} message(s)`,
            '',
            'Routes',
            routeLine
        ].join('\n'))
        .setColor(0x4F46E5);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ═══════════════════════════════════════════════════════════
// [2] 구글 시트 기록
// ═══════════════════════════════════════════════════════════
/** Region(PH/ID) → 타임존 & 시트 범위 */
function getRegionConfig(regionInput) {
    const r = (regionInput || '').trim().toLowerCase();
    if (r === 'ph' || r === 'philippines') return { timeZone: 'Asia/Manila', sheetRange: 'Daily_Log_PH!A:G', salarySheetRange: 'Salary_Log_PH!A:D', code: 'PH' };
    if (r === 'id' || r === 'indonesia') return { timeZone: 'Asia/Jakarta', sheetRange: 'Daily_Log_ID!A:G', salarySheetRange: 'Salary_Log_ID!A:D', code: 'ID' };
    return null;
}

async function appendToSheet(range, values) {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: CONFIG.CREDENTIALS_PATH,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: CONFIG.SHEET_ID,
            range,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [values] },
        });
        console.log(`✅ [${range}] 시트 기록: ${values[1]} (Worker)`);
        return { ok: true };
    } catch (err) {
        console.error('❌ 시트 기록 에러:', range, err.message);
        return { ok: false, error: err.message };
    }
}

/** 시트 범위 읽기 */
async function readSheetData(range) {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: CONFIG.CREDENTIALS_PATH,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const { data } = await sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SHEET_ID,
            range,
        });
        return data.values || [];
    } catch (err) {
        console.error('❌ 시트 읽기 에러:', range, err.message);
        return [];
    }
}

/** Kinah 수치 파싱 (1,500,000 → 1500000) */
function parseKinahProfit(str) {
    if (str == null || str === '') return null;
    const v = parseFloat(String(str).replace(/,/g, '').replace(/\s/g, ''));
    return Number.isFinite(v) && v >= 0 ? v : null;
}

/** 주차 범위 (월요일 00:00 UTC 기준, weekOffset: 0=이번주 -1=지난주) */
function getWeekBounds(weekOffset = 0) {
    const d = new Date();
    const day = d.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const thisMonday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + mondayOffset + weekOffset * 7, 0, 0, 0, 0));
    const nextMonday = new Date(thisMonday.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { start: thisMonday.getTime(), end: nextMonday.getTime() };
}

/** 날짜 문자열에서 YYYY-MM-DD 추출 */
function parseSheetDate(ts) {
    if (!ts) return null;
    const s = String(ts).trim();
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})/) || s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (!m) return null;
    const [_, y, mo, d] = m;
    const t = Date.UTC(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10));
    return Number.isFinite(t) ? t : null;
}

/** 주간 Kinah 파밍량 Top10 (PH+ID 통합) */
async function getWeeklyKinahRanking(weekOffset = 0) {
    const { start, end } = getWeekBounds(weekOffset);
    const totals = {}; // worker -> sum

    for (const cfg of [getRegionConfig('ph'), getRegionConfig('id')]) {
        if (!cfg) continue;
        const rows = await readSheetData(cfg.sheetRange.replace('!A:G', '!A2:G'));
        for (const row of rows) {
            const teamType = (row[2] || '').trim();
            if (teamType !== 'Kinah') continue;
            const rowTime = parseSheetDate(row[0]);
            if (rowTime == null || rowTime < start || rowTime >= end) continue;
            const worker = (row[1] || 'Unknown').trim();
            const profit = parseKinahProfit(row[5]);
            if (profit == null) continue;
            totals[worker] = (totals[worker] || 0) + profit;
        }
    }

    return Object.entries(totals)
        .map(([worker, total]) => ({ worker, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
}

// ═══════════════════════════════════════════════════════════
// [2.5] 시세 크롤러 (Kinah Rate)
// ═══════════════════════════════════════════════════════════
function extractNumericTokens(text) { return String(text || '').match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)?.map(t => t.trim()) || []; }
function parseNumericValue(token) { const v = parseFloat(String(token || '').replace(/,/g, '')); return Number.isFinite(v) ? v : null; }
function pickMedian(values) { if (!Array.isArray(values) || values.length === 0) return null; const s = [...values].sort((a, b) => a - b); const mid = Math.floor(s.length / 2); return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]; }
function pickTrimmedMedian(values) { if (!Array.isArray(values) || values.length === 0) return null; const s = [...values].sort((a, b) => a - b); if (s.length <= 4) return pickMedian(s); const trimCount = Math.floor(s.length * 0.1); const trimmed = trimCount > 0 && s.length - trimCount * 2 >= 3 ? s.slice(trimCount, s.length - trimCount) : s; return pickMedian(trimmed); }
function collectJsonNodes(value, out = []) { if (value == null) return out; if (Array.isArray(value)) { for (const item of value) collectJsonNodes(item, out); return out; } if (typeof value === 'object') { out.push(value); for (const child of Object.values(value)) if (child && typeof child === 'object') collectJsonNodes(child, out); } return out; }
function parseJsonLdBlocks($) { const parsed = []; $('script[type="application/ld+json"]').each((_, el) => { try { const raw = $(el).contents().text().trim(); if (raw) parsed.push(JSON.parse(raw)); } catch (_) {} }); return parsed; }
function formatKrw(v) { return Number.isFinite(v) ? `${Math.round(v).toLocaleString()} KRW` : 'N/A'; }

async function fetchItembayAion2Snapshot(sourceUrl) {
    const url = sourceUrl || KINAH_PRESET_DEFAULTS.itembay_aion2.primaryUrl;
    const { data } = await axios.get(url, { timeout: 20000, maxRedirects: 5, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html,application/xhtml+xml' } });
    const $ = cheerio.load(data);
    const canonical = $('link[rel="canonical"]').attr('href') || url;
    const nodes = parseJsonLdBlocks($).flatMap(b => collectJsonNodes(b));
    const aggregateOffer = nodes.find(n => n['@type'] === 'AggregateOffer' && parseNumericValue(n.lowPrice) != null && parseNumericValue(n.highPrice) != null);
    const lowPrice = aggregateOffer ? parseNumericValue(aggregateOffer.lowPrice) : null;
    const highPrice = aggregateOffer ? parseNumericValue(aggregateOffer.highPrice) : null;
    const offerCount = aggregateOffer ? parseNumericValue(aggregateOffer.offerCount) : null;
    const listItems = nodes.filter(n => n['@type'] === 'ListItem' && n.item).map(n => n.item).filter(item => /아이온2|aion2/i.test(`${item.name || ''} ${item.category || ''}`));
    const kinahItems = listItems.filter(item => /키나|kinah|게임머니|game.?money/i.test(`${item.name || ''} ${item.description || ''}`));
    let prices = (kinahItems.length ? kinahItems : listItems).map(item => parseNumericValue(item?.offers?.price)).filter(v => v != null);
    if (prices.length > 4) {
        const med = pickMedian(prices);
        const cap = med != null ? med * 2.5 : 150000;
        prices = prices.filter(v => v <= cap);
    }
    const representative = pickTrimmedMedian(prices) ?? lowPrice ?? pickMedian(prices) ?? highPrice;
    if (!Number.isFinite(representative)) throw new Error('ItemBay AION2 parser could not find numeric price.');
    const sorted = [...prices].sort((a, b) => a - b);
    const trimCount = sorted.length > 4 ? Math.floor(sorted.length * 0.1) : 0;
    const trimmed = trimCount > 0 && sorted.length - trimCount * 2 >= 2 ? sorted.slice(trimCount, sorted.length - trimCount) : sorted;
    const displayLow = trimmed.length ? trimmed[0] : lowPrice;
    const displayHigh = trimmed.length ? trimmed[trimmed.length - 1] : highPrice;
    const safeRep = displayHigh != null && representative > displayHigh * 1.2 ? Math.round((representative + displayHigh) / 2) : representative;
    return { token: formatKrw(safeRep), numeric: Math.round(safeRep), snippet: `ItemBay AION2 game-money low ${formatKrw(displayLow)} / high ${formatKrw(displayHigh)} / offers ${offerCount ? offerCount.toLocaleString() : 'N/A'}`, sourceUrl: canonical, sourceName: 'ItemBay AION2', sourceSummary: `ItemBay:${formatKrw(safeRep)}` };
}

async function fetchItemmaniaAion2Snapshot(sourceUrl, sourceKeyword) {
    const url = sourceUrl || KINAH_PRESET_DEFAULTS.itemmania_aion2.primaryUrl;
    const { data } = await axios.get(url, { timeout: 20000, maxRedirects: 5, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html,application/xhtml+xml' } });
    const $ = cheerio.load(data);
    const bodyText = $('body').text().replace(/\r/g, '\n');
    const keyword = String(sourceKeyword || '아이온2 키나').trim();
    const keywordLines = bodyText.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).filter(line => { if (!keyword) return true; return keyword.split(/\s+/).filter(Boolean).every(w => line.toLowerCase().includes(w.toLowerCase())); });
    const candidateText = keywordLines.length ? keywordLines.slice(0, 100).join('\n') : bodyText;
    const candidates = extractNumericTokens(candidateText).map(t => parseNumericValue(t)).filter(v => v != null).filter(v => v >= 10 && v <= 500000000);
    const representative = pickTrimmedMedian(candidates) ?? pickMedian(candidates);
    if (!Number.isFinite(representative)) throw new Error('ItemMania parser could not find numeric price.');
    return { token: formatKrw(representative), numeric: Math.round(representative), snippet: `ItemMania keyword: ${keyword || 'AION2'} (${candidates.length} candidates)`, sourceUrl: url, sourceName: 'ItemMania AION2', sourceSummary: `ItemMania:${formatKrw(representative)}` };
}

async function fetchKinahRateByPreset(watchConfig) {
    const preset = watchConfig?.sourcePreset;
    if (!KINAH_PRESET_TYPES.includes(preset)) throw new Error('Unknown kinah preset.');
    if (preset === 'itembay_aion2') return fetchItembayAion2Snapshot(watchConfig?.sourceUrl || KINAH_PRESET_DEFAULTS.itembay_aion2.primaryUrl);
    if (preset === 'itemmania_aion2') return fetchItemmaniaAion2Snapshot(watchConfig?.sourceUrl || KINAH_PRESET_DEFAULTS.itemmania_aion2.primaryUrl, watchConfig?.sourceKeyword);
    const calls = [fetchItembayAion2Snapshot(watchConfig?.sourceUrl || KINAH_PRESET_DEFAULTS.dual_market_aion2.primaryUrl), fetchItemmaniaAion2Snapshot(watchConfig?.secondarySourceUrl || KINAH_PRESET_DEFAULTS.dual_market_aion2.secondaryUrl, watchConfig?.sourceKeyword)];
    const results = await Promise.allSettled(calls);
    const success = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (!success.length) throw new Error('Dual market fetch failed: ' + results.filter(r => r.status === 'rejected').map(r => r.reason?.message || String(r.reason)).join(' / '));
    if (success.length === 1) return success[0];
    const average = success.reduce((sum, item) => sum + Number(item.numeric || 0), 0) / success.length;
    return { token: formatKrw(average), numeric: Math.round(average), snippet: `Dual market avg from ${success.length} sources`, sourceUrl: success[0].sourceUrl, sourceName: 'Dual Market AION2', sourceSummary: success.map(i => i.sourceSummary).join(' | '), sourceValues: success.map(i => ({ name: i.sourceName, token: i.token, numeric: i.numeric, sourceUrl: i.sourceUrl })) };
}

function extractKinahValueFromText(text) {
    const lines = String(text || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!lines.length) return null;
    const keywordLines = lines.filter(l => /(kinah|키나|시세|rate|exchange|market)/i.test(l));
    const candidates = keywordLines.length ? keywordLines : lines.slice(0, 50);
    const tokens = extractNumericTokens(candidates.join('\n'));
    if (!tokens.length) return null;
    const ranked = tokens.map(t => ({ token: t, numeric: parseNumericValue(t) })).filter(item => item.numeric != null).sort((a, b) => b.numeric - a.numeric);
    if (!ranked.length) return null;
    return { token: ranked[0].token, numeric: ranked[0].numeric, snippet: candidates.slice(0, 3).join('\n') };
}

async function fetchKinahRateSnapshot(watchConfig) {
    const sourcePreset = String(watchConfig?.sourcePreset || '').trim();
    if (sourcePreset) return fetchKinahRateByPreset(watchConfig);
    const sourceUrl = String(watchConfig?.sourceUrl || '').trim();
    if (!sourceUrl) throw new Error('Source URL is not configured.');
    let parsedUrl; try { parsedUrl = new URL(sourceUrl); } catch (_) { throw new Error('Source URL is invalid.'); }
    if (!['https:', 'http:'].includes(parsedUrl.protocol)) throw new Error('Source URL must start with http(s).');
    const { data } = await axios.get(sourceUrl, { timeout: 15000, maxRedirects: 5, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html,application/xhtml+xml' } });
    const $ = cheerio.load(data);
    const selector = String(watchConfig?.selector || '').trim();
    const regexRaw = String(watchConfig?.valueRegex || '').trim();
    let targetText = '';
    if (selector) targetText = $(selector).slice(0, 20).map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean).join('\n');
    if (!targetText) targetText = $('body').text().replace(/\r/g, '\n');
    if (regexRaw) {
        let regex; try { regex = new RegExp(regexRaw, 'i'); } catch (err) { throw new Error('Invalid regex: ' + err.message); }
        const match = targetText.match(regex) || $('body').text().match(regex);
        if (!match) throw new Error('Regex did not match any value.');
        const picked = match[1] || match[0];
        const token = String(picked).trim();
        const numeric = parseNumericValue(token);
        if (numeric == null) throw new Error('Matched value is not numeric.');
        return { token, numeric, snippet: targetText.split('\n').slice(0, 3).join('\n'), sourceUrl };
    }
    const parsed = extractKinahValueFromText(targetText);
    if (!parsed) throw new Error('Could not extract kinah rate. Configure selector or value_regex.');
    return { token: parsed.token, numeric: parsed.numeric, snippet: parsed.snippet, sourceUrl };
}

function buildKinahStatusEmbed(guildState) {
    const watch = createDefaultKinahWatch(guildState?.kinah);
    const presetLabel = watch.sourcePreset || 'custom';
    return new EmbedBuilder()
        .setTitle('Kinah Rate Crawler Status')
        .setDescription([`Enabled: ${watch.enabled ? 'Yes' : 'No'}`, `Post channel: ${watch.channelId ? `<#${watch.channelId}>` : 'Not set'}`, `Preset: ${presetLabel}`, `Keyword: ${watch.sourceKeyword || 'N/A'}`, `Source URL: ${watch.sourceUrl || 'Not set'}`, `Secondary URL: ${watch.secondarySourceUrl || 'N/A'}`, `Selector: ${watch.selector || 'Auto detect'}`, `Regex: ${watch.valueRegex || 'Auto detect'}`, `Poll interval: ${watch.pollMinutes} minute(s)`, `Mention role: ${watch.mentionRoleId ? `<@&${watch.mentionRoleId}>` : 'None'}`, `Last value: ${watch.lastRawText || 'N/A'}`, `Last sources: ${watch.lastSourceSummary || 'N/A'}`, `Last check: ${watch.lastCheckedAt ? toDiscordTime(watch.lastCheckedAt) : 'N/A'}`, `Last error: ${watch.lastError || 'None'}`].join('\n'))
        .setColor(0x14b8a6);
}

function buildKinahRateEmbed(snapshot, previousValue = null) {
    const isFirst = previousValue == null;
    const diff = previousValue == null ? null : Number(snapshot.numeric) - Number(previousValue);
    const diffLine = diff == null ? 'Initial baseline captured.' : `${diff >= 0 ? '+' : ''}${diff.toLocaleString()} vs previous`;
    return new EmbedBuilder()
        .setTitle('💰 Kinah Rate Update')
        .setDescription([`Current: **${snapshot.token}**`, `Change: ${diffLine}`, snapshot.sourceName ? `Source: ${snapshot.sourceName}` : null, snapshot.sourceSummary ? `Source summary: ${snapshot.sourceSummary}` : null, snapshot.snippet ? `Snapshot: \`${(snapshot.snippet || '').slice(0, 220)}\`` : null, `[Source link](${snapshot.sourceUrl})`].filter(Boolean).join('\n'))
        .addFields(...(Array.isArray(snapshot.sourceValues) && snapshot.sourceValues.length ? [{ name: 'Source breakdown', value: snapshot.sourceValues.map(i => `- ${i.name}: ${i.token}`).join('\n').slice(0, 1000) }] : []))
        .setColor(isFirst ? 0x0ea5e9 : diff >= 0 ? 0x22c55e : 0xef4444)
        .setTimestamp();
}

let kinahTickerActive = false;
async function runKinahTicker(client) {
    if (kinahTickerActive) return;
    kinahTickerActive = true;
    try {
        const now = Date.now();
        let changed = false;
        for (const guildId of Object.keys(kinahState.guilds || {})) {
            const guildState = ensureKinahGuildState(guildId);
            const watch = guildState.kinah;
            if (!watch.enabled || !watch.sourceUrl || !watch.channelId) continue;
            const intervalMs = Math.max(60000, watch.pollMinutes * 60000);
            if (watch.lastCheckedAt && now - watch.lastCheckedAt < intervalMs) continue;
            watch.lastCheckedAt = now;
            changed = true;
            let snapshot;
            try { snapshot = await fetchKinahRateSnapshot(watch); watch.lastError = null; } catch (err) { watch.lastError = err.message || 'Fetch failed'; changed = true; continue; }
            const isChanged = watch.lastRate == null || snapshot.numeric !== watch.lastRate;
            watch.lastRawText = snapshot.token;
            watch.lastSourceSummary = snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null;
            if (!isChanged) continue;
            const channel = await client.channels.fetch(watch.channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) { watch.lastError = 'Post channel is missing or not text-based.'; changed = true; continue; }
            const content = watch.mentionRoleId ? `<@&${watch.mentionRoleId}>` : undefined;
            await channel.send({ content, embeds: [buildKinahRateEmbed(snapshot, watch.lastRate)] }).catch(() => {});
            watch.lastRate = snapshot.numeric;
            watch.lastPostedAt = Date.now();
            changed = true;
        }
        if (changed) saveKinahState();
    } finally { kinahTickerActive = false; }
}

// ═══════════════════════════════════════════════════════════
// [3] 슬래시 커맨드 등록
// ═══════════════════════════════════════════════════════════
const commands = [
    new SlashCommandBuilder()
        .setName('report_kinah')
        .setDescription('Submit Kinah Team daily report')
        .addStringOption(o => o.setName('region').setDescription('Your region').setRequired(true).addChoices(
            { name: 'Philippines (PH)', value: 'ph' }, { name: 'Indonesia (ID)', value: 'id' }
        ))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('report_levelup')
        .setDescription('Submit Level-Up Team daily report')
        .addStringOption(o => o.setName('region').setDescription('Your region').setRequired(true).addChoices(
            { name: 'Philippines (PH)', value: 'ph' }, { name: 'Indonesia (ID)', value: 'id' }
        ))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('salary_confirm')
        .setDescription('Confirm salary receipt (1-click, select PH or ID)')
        .addStringOption(o => o
            .setName('region')
            .setDescription('Your region')
            .setRequired(true)
            .addChoices(
                { name: 'Philippines (PH)', value: 'ph' },
                { name: 'Indonesia (ID)', value: 'id' }
            ))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Post report/salary panel to this channel')
        .addStringOption(o => o
            .setName('type')
            .setDescription('Panel type')
            .setRequired(true)
            .addChoices(
                { name: 'Daily Report', value: 'report' },
                { name: 'Salary Confirm', value: 'salary' }
            ))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('kinah_watch_preset')
        .setDescription('Quick setup for ItemBay/ItemMania AION2 presets')
        .addStringOption(o => o.setName('preset').setDescription('Market preset').setRequired(true).addChoices(
            { name: 'ItemBay AION2', value: 'itembay_aion2' },
            { name: 'ItemMania AION2', value: 'itemmania_aion2' },
            { name: 'Dual Market AION2', value: 'dual_market_aion2' }
        ))
        .addChannelOption(o => o.setName('channel').setDescription('Channel where kinah updates are posted').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addIntegerOption(o => o.setName('poll_minutes').setDescription('How often to check (1-60)').setRequired(false).setMinValue(1).setMaxValue(60))
        .addRoleOption(o => o.setName('mention_role').setDescription('Optional role mention on updates').setRequired(false))
        .addStringOption(o => o.setName('source_keyword').setDescription('Keyword hint (default: 아이온2 키나)').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('kinah_watch_set')
        .setDescription('Configure kinah rate crawler and target channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel where kinah updates are posted').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption(o => o.setName('source_url').setDescription('Market/source page URL').setRequired(true))
        .addStringOption(o => o.setName('selector').setDescription('Optional CSS selector for price text').setRequired(false))
        .addStringOption(o => o.setName('value_regex').setDescription('Optional regex (capture group #1 preferred)').setRequired(false))
        .addIntegerOption(o => o.setName('poll_minutes').setDescription('How often to check (1-60)').setRequired(false).setMinValue(1).setMaxValue(60))
        .addRoleOption(o => o.setName('mention_role').setDescription('Optional role mention on updates').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('kinah_watch_now')
        .setDescription('Fetch kinah rate immediately')
        .addBooleanOption(o => o.setName('public_post').setDescription('Post result publicly to configured channel').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('kinah_watch_stop')
        .setDescription('Stop kinah rate crawler for this guild')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('kinah_watch_status')
        .setDescription('Show kinah rate crawler settings and last state')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('mvp_calc')
        .setDescription('Calculate weekly Kinah farming Top10 (from Google Sheets Daily_Log)')
        .addIntegerOption(o => o.setName('week').setDescription('0=this week, -1=last week').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('notice_set')
        .setDescription('Set channel for AION2 notice relay (NEWS / Update_Note / EVENT)')
        .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption(o => o.setName('category').setDescription('Category').setRequired(true).addChoices(
            { name: 'NEWS', value: 'notice' },
            { name: 'Update_Note', value: 'update' },
            { name: 'EVENT', value: 'event' },
            { name: 'Maintenance', value: 'maintenance' }
        ))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('notice_status')
        .setDescription('Show notice relay settings')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('notice_post')
        .setDescription('Fetch and post latest notices (no notice_set needed if channel given)')
        .addStringOption(o => o.setName('category').setDescription('Category to post').setRequired(true).addChoices(
            { name: 'NEWS', value: 'notice' },
            { name: 'Update_Note', value: 'update' },
            { name: 'EVENT', value: 'event' },
            { name: 'Maintenance', value: 'maintenance' },
            { name: 'All', value: 'all' }
        ))
        .addChannelOption(o => o.setName('channel').setDescription('Post to this channel (optional, overrides notice_set)').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addIntegerOption(o => o.setName('count').setDescription('How many to post (1-5)').setRequired(false).setMinValue(1).setMaxValue(5))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('aon_translate_set')
        .setDescription('Set channel route for AON Korean->English translation')
        .addStringOption(o => o
            .setName('category')
            .setDescription('Source category to monitor')
            .setRequired(true)
            .addChoices(
                { name: 'NEWS', value: 'notice' },
                { name: 'Update_Note', value: 'update' },
                { name: 'EVENT', value: 'event' }
            ))
        .addChannelOption(o => o
            .setName('channel')
            .setDescription('Channel where AON bot posts this category')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption(o => o
            .setName('enabled')
            .setDescription('Enable/disable translation globally for this guild')
            .setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('aon_translate_source')
        .setDescription('Set source bot id to translate from (default AON bot)')
        .addStringOption(o => o
            .setName('bot_id')
            .setDescription('Discord bot user ID')
            .setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('aon_translate_status')
        .setDescription('Show AON translation routes and status')
        .toJSON(),
];

// ═══════════════════════════════════════════════════════════
// [4] 모달 (버튼 클릭 시)
// ═══════════════════════════════════════════════════════════
function createKinahModal(region) {
    return new ModalBuilder()
        .setCustomId(`modal_kinah_${region}`)
        .setTitle('Kinah Team Daily Report')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('login').setLabel('Login Time').setPlaceholder('09:00 (local)').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('logout').setLabel('Logout Time').setPlaceholder('18:00 (local)').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('profit').setLabel("Kinah Profit (Kinah)").setPlaceholder('35,000,000').setStyle(TextInputStyle.Short).setRequired(true)
            ),
        );
}

function createLevelUpModal(region) {
    return new ModalBuilder()
        .setCustomId(`modal_levelup_${region}`)
        .setTitle('Level-Up Team Daily Report')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('login').setLabel('Login Time').setPlaceholder('09:00 (local)').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('logout').setLabel('Logout Time').setPlaceholder('18:00 (local)').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('level').setLabel('Level Progress').setPlaceholder('Lv.40 -> Lv.45').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('cp').setLabel('CP Progress').setPlaceholder('1800 -> 2100').setStyle(TextInputStyle.Short).setRequired(true)
            ),
        );
}

// ═══════════════════════════════════════════════════════════
// [5] 이벤트 핸들러
// ═══════════════════════════════════════════════════════════
client.once('ready', async () => {
    console.log(`🚀 TETRA Sync 봇 가동: ${client.user.tag}`);
    try {
        const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
        // 서버별 등록 (즉시 반영)
        for (const guild of client.guilds.cache.values()) {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
            console.log(`   슬래시 커맨드 등록: ${guild.name}`);
        }
    } catch (e) {
        console.error('   슬래시 커맨드 등록 실패:', e.message);
    }
    // 시세 크롤러 티커
    setInterval(() => runKinahTicker(client).catch(err => console.error('[kinah-ticker]', err.message)), CONFIG.KINAH_TICKER_MS);
    runKinahTicker(client).catch(() => {});
    // 공지 크롤러 티커 (NEWS / Update_Note / EVENT)
    setInterval(() => runNoticeTicker(client).catch(err => console.error('[notice-ticker]', err.message)), CONFIG.NOTICE_TICKER_MS);
    runNoticeTicker(client).catch(() => {});
});

client.on('interactionCreate', async (interaction) => {
    try {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'report_kinah') {
            const r = interaction.options.getString('region') || 'ph';
            await interaction.showModal(createKinahModal(r));
        } else if (interaction.commandName === 'report_levelup') {
            const r = interaction.options.getString('region') || 'ph';
            await interaction.showModal(createLevelUpModal(r));
        } else if (interaction.commandName === 'salary_confirm') {
            if (interaction.user.bot) return;
            const regionOpt = interaction.options.getString('region');
            const regionCfg = getRegionConfig(regionOpt);
            if (!regionCfg) {
                await interaction.reply({ content: '❌ Region must be PH or ID.', ephemeral: true });
                return;
            }
            const worker = (interaction.member?.displayName || interaction.user.globalName || interaction.user.username || 'Unknown').trim();
            const timestamp = new Date().toLocaleString('sv-SE', { timeZone: regionCfg.timeZone }).slice(0, 16);
            const data = [timestamp, worker, 'Confirmed', ''];
            const res = await appendToSheet(regionCfg.salarySheetRange, data);
            await interaction.reply({
                content: res.ok ? `✅ Salary confirmation submitted (${worker}) → ${regionCfg.code}` : `❌ Failed to save (${regionCfg.code}). Create **Salary_Log_${regionCfg.code}** sheet in Google Sheets.`,
                ephemeral: true
            });
        } else if (interaction.commandName === 'aon_translate_set') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const g = ensureAonTranslateGuildState(interaction.guildId);
            const category = interaction.options.getString('category', true);
            const channel = interaction.options.getChannel('channel', true);
            const enabled = interaction.options.getBoolean('enabled');
            g.routes[category] = channel.id;
            if (enabled !== null && enabled !== undefined) g.enabled = enabled;
            else g.enabled = true;
            saveAonTranslateState();
            await interaction.reply({ embeds: [buildAonTranslateStatusEmbed(g)], ephemeral: true });
        } else if (interaction.commandName === 'aon_translate_source') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const botId = String(interaction.options.getString('bot_id', true)).trim();
            if (!/^\d{17,20}$/.test(botId)) { await safeEphemeral(interaction, 'Invalid bot_id format.'); return; }
            const g = ensureAonTranslateGuildState(interaction.guildId);
            g.sourceBotId = botId;
            g.enabled = true;
            saveAonTranslateState();
            await interaction.reply({ embeds: [buildAonTranslateStatusEmbed(g)], ephemeral: true });
        } else if (interaction.commandName === 'aon_translate_status') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            const g = ensureAonTranslateGuildState(interaction.guildId);
            await interaction.reply({ embeds: [buildAonTranslateStatusEmbed(g)], ephemeral: true });
        } else if (interaction.commandName === 'panel') {
            await interaction.deferReply({ ephemeral: true });
            if (!interaction.guild) {
                await interaction.editReply({ content: '❌ /panel은 서버 내 채널에서만 사용 가능합니다. (DM 불가)' });
                return;
            }
            const kind = interaction.options.getString('type');
            let channel = interaction.channel;
            if (!channel && interaction.channelId) {
                channel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
                if (!channel) channel = await client.channels.fetch(interaction.channelId, { force: true }).catch(() => null);
            }
            if (!channel?.send) {
                await interaction.editReply({ content: '❌ 채널을 찾을 수 없습니다. 일반 채팅 채널에서 /panel을 실행해 주세요.' });
                return;
            }
            const lockKey = `${kind}_${channel.id}`;
            if (panelUpdateLocks.has(lockKey)) {
                await interaction.editReply({ content: '⏳ 패널 업데이트 중입니다. 2초 후 다시 시도해 주세요.' });
                return;
            }
            panelUpdateLocks.add(lockKey);
            try {
            if (kind === 'report') {
                const embed = new EmbedBuilder()
                    .setTitle('📋 DAILY WORK LOG')
                    .setDescription(
                        '**Operational Excellence: TETRA Management**\n\n' +
                        'All personnel must submit daily report before finishing shift.\n\n' +
                        '**How to submit:** Select your region + team below → fill the form → done.\n' +
                        '• **Kinah** (💰) — Login, Logout, Profit (Kinah)\n' +
                        '• **Level-Up** (📈) — Login, Logout, Level, CP\n\n' +
                        '**Rules:** Select Philippines or Indonesia, enter timestamps in your local time.\n' +
                        '_Data syncs to management database automatically._'
                    )
                    .setColor(0x5865F2);
                const kinahPh = new ButtonBuilder().setCustomId('btn_kinah_ph').setLabel('Kinah (PH)').setStyle(ButtonStyle.Primary).setEmoji('🇵🇭');
                const kinahId = new ButtonBuilder().setCustomId('btn_kinah_id').setLabel('Kinah (ID)').setStyle(ButtonStyle.Primary).setEmoji('🇮🇩');
                const levelUpPh = new ButtonBuilder().setCustomId('btn_levelup_ph').setLabel('Level-Up (PH)').setStyle(ButtonStyle.Danger).setEmoji('🇵🇭');
                const levelUpId = new ButtonBuilder().setCustomId('btn_levelup_id').setLabel('Level-Up (ID)').setStyle(ButtonStyle.Danger).setEmoji('🇮🇩');
                const row = new ActionRowBuilder().addComponents(kinahPh, kinahId, levelUpPh, levelUpId);
                const files = [];
                const state = loadPanelState();
                const payload = { embeds: [embed], components: [row], files: files.length ? files : undefined };
                const isReportPanel = m => m.author?.id === client.user?.id && (m.embeds[0]?.title?.includes('DAILY WORK LOG') || m.components?.some(c => c.components?.some(b => b.customId?.startsWith('btn_kinah') || b.customId?.startsWith('btn_levelup'))));
                let allReportPanels = (await channel.messages.fetch({ limit: 100 })).filter(isReportPanel);
                for (const m of allReportPanels.values()) await m.delete().catch(() => {});
                const sent = await channel.send(payload);
                allReportPanels = (await channel.messages.fetch({ limit: 100 })).filter(isReportPanel);
                for (const m of allReportPanels.values()) {
                    if (m.id !== sent.id) await m.delete().catch(() => {});
                }
                savePanelState({ ...state, reportMsgId: sent.id, reportChannelId: channel.id });
                await interaction.editReply({ content: '✅ Daily Report panel updated (1 only).' });
            } else if (kind === 'salary') {
                const embed = new EmbedBuilder()
                    .setTitle('💰 Salary Verification Notice')
                    .setDescription(
                        '**Attention to all TETRA Staff:**\n' +
                        'Your salary for this period has been officially processed.\n\n' +
                        '**How to confirm (1-click, no typing):**\n' +
                        '• Check your bank/wallet balance.\n' +
                        '• Click **Philippines** 🇵🇭 or **Indonesia** 🇮🇩 below — no form, no typing.\n\n' +
                        'Thank you for your excellent performance.'
                    )
                    .setColor(0x57F287);
                const confirmPhBtn = new ButtonBuilder().setCustomId('btn_salary_ph').setLabel('🇵🇭 Philippines (1-Click)').setStyle(ButtonStyle.Success);
                const confirmIdBtn = new ButtonBuilder().setCustomId('btn_salary_id').setLabel('🇮🇩 Indonesia (1-Click)').setStyle(ButtonStyle.Success);
                const row = new ActionRowBuilder().addComponents(confirmPhBtn, confirmIdBtn);
                const files = [];
                if (fs.existsSync(CONFIG.PANEL_IMAGES.salary)) {
                    files.push(new AttachmentBuilder(CONFIG.PANEL_IMAGES.salary, { name: 'salary.png' }));
                    embed.setImage('attachment://salary.png');
                }
                const state = loadPanelState();
                const payload = { embeds: [embed], components: [row], files: files.length ? files : undefined };
                const isSalaryPanel = m => m.author?.id === client.user?.id && (m.embeds[0]?.title?.includes('Salary') || m.components?.some(c => c.components?.some(b => ['btn_salary','btn_salary_ph','btn_salary_id'].includes(b.customId))));
                let allPanels = (await channel.messages.fetch({ limit: 100 })).filter(isSalaryPanel);
                for (const m of allPanels.values()) await m.delete().catch(() => {});
                const sent = await channel.send(payload);
                allPanels = (await channel.messages.fetch({ limit: 100 })).filter(isSalaryPanel);
                for (const m of allPanels.values()) {
                    if (m.id !== sent.id) await m.delete().catch(() => {});
                }
                savePanelState({ ...state, salaryMsgId: sent.id, salaryChannelId: channel.id });
                await interaction.editReply({ content: '✅ Salary panel updated (1 only).' });
            }
            } finally {
                await new Promise(r => setTimeout(r, 2000));
                panelUpdateLocks.delete(lockKey);
            }
        } else if (interaction.commandName.startsWith('kinah_watch_')) {
            const guildId = interaction.guildId;
            if (!guildId) {
                await safeEphemeral(interaction, 'This command can only be used in a guild.');
                return;
            }
            const guildState = ensureKinahGuildState(guildId);

            if (interaction.commandName === 'kinah_watch_preset') {
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                const preset = interaction.options.getString('preset', true);
                const presetConfig = KINAH_PRESET_DEFAULTS[preset];
                if (!presetConfig) { await safeEphemeral(interaction, 'Invalid preset value.'); return; }
                const channel = interaction.options.getChannel('channel', true);
                const pollMinutes = interaction.options.getInteger('poll_minutes') ?? 5;
                const mentionRole = interaction.options.getRole('mention_role');
                const sourceKeyword = (interaction.options.getString('source_keyword') || '').trim() || presetConfig.sourceKeyword || '아이온2 키나';
                const watch = guildState.kinah;
                watch.enabled = true;
                watch.sourcePreset = preset;
                watch.sourceKeyword = sourceKeyword;
                watch.channelId = channel.id;
                watch.sourceUrl = presetConfig.primaryUrl || null;
                watch.secondarySourceUrl = presetConfig.secondaryUrl || null;
                watch.selector = null;
                watch.valueRegex = null;
                watch.pollMinutes = Math.max(1, Math.min(60, pollMinutes));
                watch.mentionRoleId = mentionRole ? mentionRole.id : null;
                watch.lastError = null;
                let snapshot = null;
                try { snapshot = await fetchKinahRateSnapshot(watch); watch.lastRate = snapshot.numeric; watch.lastRawText = snapshot.token; watch.lastSourceSummary = snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null; watch.lastCheckedAt = Date.now(); } catch (err) { watch.lastError = err.message || 'Initial preset fetch failed.'; }
                guildState.kinah = watch;
                saveKinahState();
                const embeds = [buildKinahStatusEmbed(guildState)];
                if (snapshot) embeds.push(buildKinahRateEmbed(snapshot, null));
                await interaction.reply({ embeds, ephemeral: true });
            } else if (interaction.commandName === 'kinah_watch_set') {
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                const channel = interaction.options.getChannel('channel', true);
                const sourceUrl = interaction.options.getString('source_url', true).trim();
                const selector = (interaction.options.getString('selector') || '').trim();
                const valueRegex = (interaction.options.getString('value_regex') || '').trim();
                const pollMinutes = interaction.options.getInteger('poll_minutes') ?? 5;
                const mentionRole = interaction.options.getRole('mention_role');
                try { const u = new URL(sourceUrl); if (!['https:', 'http:'].includes(u.protocol)) { await safeEphemeral(interaction, 'source_url must be http(s).'); return; } } catch (_) { await safeEphemeral(interaction, 'source_url is invalid.'); return; }
                if (valueRegex) { try { new RegExp(valueRegex, 'i'); } catch (err) { await safeEphemeral(interaction, 'Invalid value_regex: ' + err.message); return; } }
                const watch = guildState.kinah;
                watch.enabled = true;
                watch.sourcePreset = null;
                watch.channelId = channel.id;
                watch.sourceUrl = sourceUrl;
                watch.secondarySourceUrl = null;
                watch.selector = selector || null;
                watch.valueRegex = valueRegex || null;
                watch.pollMinutes = Math.max(1, Math.min(60, pollMinutes));
                watch.mentionRoleId = mentionRole ? mentionRole.id : null;
                watch.lastError = null;
                let snapshot = null;
                try { snapshot = await fetchKinahRateSnapshot(watch); watch.lastRate = snapshot.numeric; watch.lastRawText = snapshot.token; watch.lastSourceSummary = snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null; watch.lastCheckedAt = Date.now(); } catch (err) { watch.lastError = err.message || 'Initial fetch failed.'; }
                guildState.kinah = watch;
                saveKinahState();
                const embeds = [buildKinahStatusEmbed(guildState)];
                if (snapshot) embeds.push(buildKinahRateEmbed(snapshot, null));
                await interaction.reply({ embeds, ephemeral: true });
            } else if (interaction.commandName === 'kinah_watch_status') {
                await interaction.reply({ embeds: [buildKinahStatusEmbed(guildState)], ephemeral: true });
            } else if (interaction.commandName === 'kinah_watch_stop') {
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                guildState.kinah.enabled = false;
                saveKinahState();
                await interaction.reply({ content: 'Kinah rate crawler stopped for this guild.', ephemeral: true });
            } else if (interaction.commandName === 'kinah_watch_now') {
                const watch = guildState.kinah;
                if (!watch.sourceUrl) { await safeEphemeral(interaction, 'Kinah crawler is not configured. Run `/kinah_watch_preset` or `/kinah_watch_set` first.'); return; }
                await interaction.deferReply({ ephemeral: true });
                let snapshot;
                try { snapshot = await fetchKinahRateSnapshot(watch); } catch (err) { watch.lastError = err.message || 'Fetch failed'; guildState.kinah = watch; saveKinahState(); await interaction.editReply({ content: 'Failed to fetch kinah rate: ' + watch.lastError }); return; }
                const previousRate = watch.lastRate;
                watch.lastRate = snapshot.numeric;
                watch.lastRawText = snapshot.token;
                watch.lastSourceSummary = snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null;
                watch.lastCheckedAt = Date.now();
                watch.lastError = null;
                guildState.kinah = watch;
                saveKinahState();
                const embed = buildKinahRateEmbed(snapshot, previousRate);
                const publicPost = interaction.options.getBoolean('public_post') ?? false;
                if (publicPost) {
                    const postChannelId = watch.channelId || interaction.channelId;
                    const postChannel = await interaction.guild.channels.fetch(postChannelId).catch(() => null);
                    if (postChannel && postChannel.isTextBased()) {
                        const mention = watch.mentionRoleId ? `<@&${watch.mentionRoleId}>` : undefined;
                        await postChannel.send({ content: mention, embeds: [embed] }).catch(() => {});
                        watch.lastPostedAt = Date.now();
                        guildState.kinah = watch;
                        saveKinahState();
                    }
                }
                await interaction.editReply({ embeds: [embed, buildKinahStatusEmbed(guildState)] });
            }
        } else if (interaction.commandName === 'mvp_calc') {
            const weekOffset = interaction.options.getInteger('week') ?? 0;
            await interaction.deferReply({ ephemeral: true });
            const ranking = await getWeeklyKinahRanking(weekOffset);
            const { start, end } = getWeekBounds(weekOffset);
            const weekLabel = weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : `${weekOffset > 0 ? '+' : ''}${weekOffset}w`;
            const medals = ['🥇', '🥈', '🥉'];
            let desc = ranking.length === 0
                ? 'No Kinah team daily reports for this week.\n(Check Daily_Log_PH, Daily_Log_ID sheets)'
                : ranking.map((r, i) => `${medals[i] || `${i + 1}.`} **${r.worker}**: ${r.total.toLocaleString()}`).join('\n');
            const embed = new EmbedBuilder()
                .setTitle(`🏆 TETRA Weekly MVP (${weekLabel})`)
                .setDescription(desc)
                .addFields({ name: '📅 Period', value: `${new Date(start).toLocaleDateString('en-US')} ~ ${new Date(end - 1).toLocaleDateString('en-US')} (Mon~Sun)`, inline: false })
                .setColor(0xF59E0B)
                .setFooter({ text: 'Daily_Log_PH + Daily_Log_ID Kinah team total' })
                .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
        } else if (interaction.commandName === 'notice_set' || interaction.commandName === 'notice_status' || interaction.commandName === 'notice_post') {
            const guildId = interaction.guildId;
            if (!guildId) { await safeEphemeral(interaction, 'This command can only be used in a guild.'); return; }
            const noticeConfig = ensureNoticeGuildState(guildId);
            if (interaction.commandName === 'notice_status') {
                await interaction.reply({ embeds: [buildNoticeStatusEmbed(noticeConfig)], ephemeral: true });
                return;
            }
            if (interaction.commandName === 'notice_post') {
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                const catOpt = interaction.options.getString('category', true);
                const channelOpt = interaction.options.getChannel('channel');
                const count = interaction.options.getInteger('count') ?? 3;
                await interaction.deferReply({ ephemeral: true });
                try {
                    const sources = catOpt === 'all' ? DEFAULT_NOTICE_SOURCES : DEFAULT_NOTICE_SOURCES.filter(s => s.category === catOpt);
                    let posted = 0;
                    let fetchErr = null;
                    for (const source of sources) {
                        let channel = channelOpt;
                        if (!channel) {
                            const id = getNoticeTargetChannelId(noticeConfig, source.category);
                            if (!id) continue;
                            channel = await interaction.client.channels.fetch(id).catch(() => null);
                        }
                        if (!channel || !channel.isTextBased()) continue;
                        let entries = [];
                        try { entries = await fetchNoticeEntries(source.url); } catch (err) { fetchErr = err.message; console.error('[notice_post] fetch', source.url, err.message); continue; }
                        const toPost = entries.slice(0, count);
                        const categoryLabel = source.category === 'notice' ? 'NEWS' : source.category === 'update' ? 'Update' : source.category === 'maintenance' ? 'Maintenance' : 'EVENT';
                        for (const item of toPost) {
                            const titleEn = await translateToEn(item.title).catch(() => item.title);
                            await new Promise(r => setTimeout(r, 300));
                            const embed = new EmbedBuilder()
                                .setTitle(`[${categoryLabel}] ${titleEn}`)
                                .setDescription(`[Go to Announcements](${item.url})`)
                                .setColor(0x0ea5e9)
                                .setTimestamp();
                            await channel.send({ embeds: [embed] }).catch(e => console.error('[notice_post] send', e.message));
                            posted++;
                        }
                    }
                    let msg = posted > 0 ? `Posted ${posted} notice(s).` : '';
                    if (posted === 0) {
                        if (!channelOpt && !getNoticeTargetChannelId(noticeConfig, sources[0]?.category)) {
                            msg = 'No channel. Add `channel` option, e.g. `/notice_post category:Update_Note channel:#공지`';
                        } else if (fetchErr) {
                            msg = `Fetch failed (site may be down). Try again later.`;
                        } else {
                            msg = 'No entries found or fetch failed. Try with `channel` option.';
                        }
                    }
                    await interaction.editReply({ content: msg });
                } catch (err) {
                    console.error('[notice_post]', err);
                    await interaction.editReply({ content: `Error: ${err.message}. Try \`/notice_post category:Update_Note channel:#your-channel\`` }).catch(() => {});
                }
                return;
            }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const channel = interaction.options.getChannel('channel', true);
            const category = interaction.options.getString('category', true);
            noticeConfig.channelsByCategory[category] = channel.id;
            noticeConfig.channelId = channel.id;
            if (!noticeConfig.categories.includes(category)) noticeConfig.categories.push(category);
            noticeConfig.categories = [...new Set(noticeConfig.categories)].filter(c => NOTICE_CATEGORIES.includes(c));
            saveNoticeState();
            await interaction.reply({ embeds: [buildNoticeStatusEmbed(noticeConfig)], ephemeral: true });
        }
        return;
    }

    // 버튼 클릭
    if (interaction.isButton()) {
        try {
            const id = interaction.customId;
            if (id === 'btn_kinah_ph') await interaction.showModal(createKinahModal('ph'));
            else if (id === 'btn_kinah_id') await interaction.showModal(createKinahModal('id'));
            else if (id === 'btn_levelup_ph') await interaction.showModal(createLevelUpModal('ph'));
            else if (id === 'btn_levelup_id') await interaction.showModal(createLevelUpModal('id'));
            else if (id === 'btn_salary') {
                await interaction.reply({
                    content: '⚠️ 이 버튼은 더 이상 사용되지 않습니다. `/panel type:salary` 로 패널을 새로 고친 후 **Philippines** 또는 **Indonesia** 버튼을 클릭하세요. (작성 없이 1클릭)',
                    ephemeral: true
                });
            } else if (id === 'btn_salary_ph' || id === 'btn_salary_id') {
                if (interaction.user.bot) return;
                if (interaction.user.id === client.user?.id) return;
                const region = id === 'btn_salary_ph' ? 'ph' : 'id';
                const regionCfg = getRegionConfig(region);
                if (!regionCfg) return;
                const username = (interaction.member?.displayName || interaction.user.globalName || interaction.user.username || 'Unknown').trim();
                const timestamp = new Date().toLocaleString('sv-SE', { timeZone: regionCfg.timeZone }).slice(0, 16);
                const data = [timestamp, username, 'Confirmed', ''];
                const res = await appendToSheet(regionCfg.salarySheetRange, data);
                await interaction.reply({
                    content: res.ok ? `✅ Salary confirmation submitted (${username}) → ${regionCfg.code}` : `❌ Failed to save (${regionCfg.code}). Create **Salary_Log_${regionCfg.code}** sheet in Google Sheets.`,
                    ephemeral: true
                });
            }
        } catch (err) {
            console.error('Button interaction error:', err);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: 'Interaction failed. Please try again or use `/salary_confirm` (choose PH or ID).',
                        ephemeral: true
                    });
                }
            } catch (_) {}
        }
        return;
    }

    // 모달 제출 → 시트 기록
    if (interaction.isModalSubmit()) {
        if (interaction.user.bot) return;
        if (interaction.user.id === client.user?.id) return;
        const customId = interaction.customId;
        const worker = (interaction.member?.displayName || interaction.user.globalName || interaction.user.username || 'Unknown').trim();
        const region = customId.endsWith('_ph') ? 'ph' : customId.endsWith('_id') ? 'id' : null;
        const regionCfg = region ? getRegionConfig(region) : null;
        if (!regionCfg) {
            await interaction.reply({ content: '❌ Invalid region.', ephemeral: true });
            return;
        }
        const timestamp = new Date().toLocaleString('sv-SE', { timeZone: regionCfg.timeZone }).slice(0, 16);
        if (customId.startsWith('modal_kinah')) {
            const login = interaction.fields.getTextInputValue('login');
            const logout = interaction.fields.getTextInputValue('logout');
            const profit = interaction.fields.getTextInputValue('profit');
            const data = [timestamp, worker, 'Kinah', login, logout, profit, ''];
            const res = await appendToSheet(regionCfg.sheetRange, data);
            await interaction.reply({ content: res.ok ? `✅ Kinah report submitted (${worker}) → ${regionCfg.code}` : `❌ Failed. Create **Daily_Log_${regionCfg.code}** sheet.`, ephemeral: true });
        } else if (customId.startsWith('modal_levelup')) {
            const login = interaction.fields.getTextInputValue('login');
            const logout = interaction.fields.getTextInputValue('logout');
            const level = interaction.fields.getTextInputValue('level');
            const cp = interaction.fields.getTextInputValue('cp');
            const progress = `${level} / ${cp}`;
            const data = [timestamp, worker, 'LevelUp', login, logout, progress, ''];
            const res = await appendToSheet(regionCfg.sheetRange, data);
            await interaction.reply({ content: res.ok ? `✅ Level-Up report submitted (${worker}) → ${regionCfg.code}` : `❌ Failed. Create **Daily_Log_${regionCfg.code}** sheet.`, ephemeral: true });
        }
    }

    } catch (err) {
        console.error('Interaction error:', err);
    }
});

// ═══════════════════════════════════════════════════════════
// [6] 캐릭터 검색 (!search) — Live Scraping (Puppeteer) + Fallback
// ═══════════════════════════════════════════════════════════
const PLAYNC_CHAR_URL = /aion2\.plaync\.com\/ko-kr\/characters\/\d+\/[\w%-]+/i;
const SEARCH_API = 'https://aion2.plaync.com/ko-kr/api/search/aion2/search/v2/character';
const PROFILE_IMG_BASE = 'https://profileimg.plaync.com';

// pcId → Class name (EN, cached)
let pcDataCache = null;
async function getPcData() {
    if (pcDataCache) return pcDataCache;
    const { data } = await axios.get('https://aion2.plaync.com/api/gameinfo/pcdata?lang=en', { timeout: 5000 });
    pcDataCache = Object.fromEntries((data.pcDataList || []).map(p => [p.id, p.classText]));
    return pcDataCache;
}

// serverId → Server name (EN, cached). KO names mapped to EN romanization.
const SERVER_KO_TO_EN = {
    '시엘':'Siel','네자칸':'Nezekan','바이젤':'Vaizel','카이시넬':'Kaisinel','유스티엘':'Ustiel',
    '아리엘':'Ariel','프레기온':'Pregion','메스람타에다':'Meslamtaeda','히타니에':'Hithanya','나니아':'Nania',
    '타하바타':'Tahabbata','루터스':'Luther','페르노스':'Pernos','다미누':'Daminu','카사카':'Kasaka',
    '바카르마':'Bakarma','챈가룽':'Changang','코치룽':'Kochirung','이슈타르':'Ishtar','티아마트':'Tiamat',
    '포에타':'Poeta','이스라펠':'Israphel','지켈':'Zikel','트리니엘':'Triniel','루미엘':'Lumiel',
    '마르쿠탄':'Marchutan','아스펠':'Asphel','에레슈키갈':'Ereshkigal','브리트라':'Beritra','네몬':'Nemon',
    '하달':'Hadal','루드라':'Rudra','울고른':'Ulgorn','무닌':'Munin','오다르':'Odar','젠카카':'Zenkaka',
    '크로메데':'Chromede','콰이링':'Kuailing','바바룽':'Bavalung','파프니르':'Fafnir','인드나흐':'Indnah','이스할겐':'Ishalgen'
};
let serverCache = null;
async function getServerNameEn(serverId) {
    if (!serverCache) {
        const { data } = await axios.get('https://aion2.plaync.com/api/gameinfo/servers?lang=ko', { timeout: 5000 });
        const koMap = Object.fromEntries((data.serverList || []).map(s => [s.serverId, s.serverName]));
        serverCache = Object.fromEntries(
            Object.entries(koMap).map(([id, ko]) => [id, SERVER_KO_TO_EN[ko] || ko])
        );
    }
    return serverCache[serverId] || null;
}

async function searchPlayncByName(charName) {
    const { data } = await axios.get(SEARCH_API, {
        params: { keyword: charName.trim() },
        timeout: 8000,
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
    });
    const list = data?.list || [];
    if (list.length === 0) return null;
    const [pcMap, serverEn] = await Promise.all([getPcData(), getServerNameEn(list[0].serverId)]);
    const first = list[0];
    const charUrl = `https://aion2.plaync.com/ko-kr/characters/${first.serverId}/${first.characterId}`;
    return {
        name: first.name.trim(),
        level: String(first.level),
        server: serverEn || SERVER_KO_TO_EN[first.serverName] || first.serverName || 'N/A',
        race: first.race === 1 ? 'Elyos' : first.race === 2 ? 'Asmodian' : 'N/A',
        job: pcMap[first.pcId] || 'N/A',
        img: first.profileImageUrl ? PROFILE_IMG_BASE + first.profileImageUrl : null,
        link: charUrl,
        resultCount: list.length
    };
}

async function scrapePlayncCharacter(pageUrl) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 15000 });
        await new Promise(r => setTimeout(r, 2500));

        const serverId = parseInt((pageUrl.match(/\/characters\/(\d+)\//) || [])[1], 10);
        const serverEn = serverId ? await getServerNameEn(serverId) : null;
        const raw = await page.evaluate(() => {
            const txt = document.body?.innerText || '';
            const lines = txt.split('\n').map(s => s.trim()).filter(Boolean);
            let name = '', level = '', server = '', race = '', cp = '', job = '';
            const servers = ['포에타', '네자칸', '바이젤', '지켈', '트리니엘', '아스펠', '아리엘'];
            for (let i = 0; i < lines.length; i++) {
                const L = lines[i];
                if (/^\d{1,2}$/.test(L) && parseInt(L) >= 1 && parseInt(L) <= 99 && !level) level = L;
                if (L === '천족' || L === '마족') race = L;
                if (servers.includes(L)) server = server || L;
                if (/^\[.+\]$/.test(L)) job = L.replace(/^\[|\]$/g, '');
                if (L.length >= 2 && L.length <= 8 && !/^\d+$/.test(L) && !L.startsWith('[') &&
                    !['캐릭터', '랭킹', '종합정보', '천족', '마족', '장비', '스킬', '스티그마', '타이틀', '데바니온'].includes(L) && !servers.includes(L)) {
                    if (!name && i > 2 && lines[i - 1]?.match(/^\[.+\]$/)) name = L;
                }
            }
            const cpMatch = txt.match(/전투력[^\d]*(\d{3,5})/) || txt.match(/(\d{3,5})/);
            if (cpMatch) cp = cpMatch[1];
            const img = document.querySelector('img[src*="plaync"], img[src*="aion"]')?.src || '';
            return { name: name || 'Unknown', level: level || 'N/A', server, race, cp: cp || '0', job: job || 'N/A', img, link: window.location.href };
        });
        if (raw) raw.server = serverEn || SERVER_KO_TO_EN[raw.server] || raw.server;
        return raw;
    } finally {
        if (browser) await browser.close();
    }
}

function buildLinkFallbackEmbed(charName, addUrlHint = false) {
    const encoded = encodeURIComponent(charName);
    const armoryLink = `https://talentbuilds.com/aion2/armory?search=${encoded}&region=korea`;
    const shugoLink = `https://shugo.gg/?q=${encoded}`;
    const playncLink = 'https://aion2.plaync.com/ko-kr/characters/index';
    let desc = `**AION 2 Character Lookup**\n\nCheck search results for "${charName}" below:\n\n` +
        `🔗 [Talentbuilds Armory](${armoryLink})\n` +
        `🔗 [Shugo.GG](${shugoLink})\n` +
        `🔗 [Official Character Info](${playncLink})`;
    if (addUrlHint) desc += '\n\n💡 **Tip:** Paste the character page URL with `!char [URL]` to view full details here.';
    return new EmbedBuilder()
        .setTitle(`🔍 TETRA Intelligence: ${charName}`)
        .setDescription(desc)
        .setColor(0xFF0055)
        .setFooter({ text: 'TETRA Streamer Portal | Character Search' })
        .setTimestamp();
}

async function handleAonBotNewsTranslation(message) {
    if (!message.guild || !message.author?.bot) return;
    const guildCfg = ensureAonTranslateGuildState(message.guild.id);
    if (!guildCfg.enabled) return;
    if (message.author.id !== guildCfg.sourceBotId) return;
    const matched = Object.entries(guildCfg.routes || {}).find(([, channelId]) => channelId && channelId === message.channelId);
    if (!matched) return;
    if (guildCfg.translatedMessageIds.includes(message.id)) return;

    const category = matched[0];
    const sourceEmbed = message.embeds?.[0];
    const sourceTitle = sourceEmbed?.title || `AION2 ${String(category).toUpperCase()}`;
    const sourceDescription = sourceEmbed?.description || message.content || '';
    const sourceFields = Array.isArray(sourceEmbed?.fields) ? sourceEmbed.fields.slice(0, 5) : [];

    const translatedTitle = await translateKoToEnLong(sourceTitle);
    let translatedDescription = await translateKoToEnLong(sourceDescription);
    if (!translatedDescription) translatedDescription = 'No translatable text found.';

    const translatedFields = [];
    for (const f of sourceFields) {
        const name = await translateKoToEnLong(f.name || '');
        const value = await translateKoToEnLong(f.value || '');
        translatedFields.push({
            name: (name || f.name || 'Field').slice(0, 256),
            value: (value || f.value || '-').slice(0, 1024),
            inline: Boolean(f.inline)
        });
    }

    const out = new EmbedBuilder()
        .setTitle(`🇬🇧 EN | ${(translatedTitle || sourceTitle || '').slice(0, 256)}`)
        .setDescription([`[Open original post](${message.url})`, '', translatedDescription].join('\n').slice(0, 4096))
        .setColor(sourceEmbed?.color || 0x4F46E5)
        .setFooter({ text: `Auto-translated from AION bot (${String(category).toUpperCase()})` })
        .setTimestamp();

    if (sourceEmbed?.url) out.setURL(sourceEmbed.url);
    if (sourceEmbed?.image?.url) out.setImage(sourceEmbed.image.url);
    if (sourceEmbed?.thumbnail?.url) out.setThumbnail(sourceEmbed.thumbnail.url);
    if (translatedFields.length) out.addFields(translatedFields);

    const sent = await message.channel.send({ embeds: [out] }).catch(() => null);
    if (!sent) return;

    guildCfg.translatedMessageIds.push(message.id);
    guildCfg.translatedMessageIds = guildCfg.translatedMessageIds.slice(-1000);
    saveAonTranslateState();
}

client.on('messageCreate', async (message) => {
    await handleAonBotNewsTranslation(message).catch(() => {});
    if (message.author?.bot) return;
    const content = message.content?.trim() || '';

    // ── !confirm 금액 / 내용 (회원 입금 확인, 스크린샷 필수)
    if (content.startsWith('!confirm ')) {
        const raw = content.slice(9).trim();
        const parts = raw.split('/').map(s => s.trim());
        const amount = parts[0];
        const reason = parts[1] || 'N/A';
        const attachment = message.attachments?.first();

        if (!amount) {
            return message.reply('⚠️ **Usage:** `!confirm [Amount] / [Reason]` (스크린샷 선택)\nExample: `!confirm 500,000 / Weekly Settlement`');
        }

        try {
            const row = [new Date().toLocaleString('ko-KR'), 'MEMBER_CONFIRM', message.author.tag, amount, reason, 'Pending Verification'];
            const res = await appendToSheet("'Payment Log'!A:F", row);
            if (!res.ok) throw new Error(res.error);

            const proofEmbed = new EmbedBuilder()
                .setTitle('💎 MEMBER PAYMENT VERIFIED')
                .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                .setColor(0x7289DA)
                .addFields(
                    { name: '💵 Amount Received', value: `\`${amount} KRW\``, inline: true },
                    { name: '📝 Description', value: reason || 'No details provided', inline: true }
                )
                .setFooter({ text: 'TETRA Agency Public Ledger' })
                .setTimestamp();
            if (attachment) proofEmbed.setImage(attachment.url);

            await message.delete().catch(() => {});
            await message.channel.send({ content: `✅ **입금 확인 제출됨 — ${message.author}**`, embeds: [proofEmbed] });
        } catch (err) {
            console.error('[!confirm]', err);
            message.reply('❌ 기록 중 오류가 발생했습니다. Google Sheet(Payment Log) 설정을 확인해 주세요.');
        }
        return;
    }

    // ── !char [name]
    const prefix = '!char ';
    if (!content.toLowerCase().startsWith(prefix)) return;

    const input = content.slice(prefix.length).trim();
    if (!input) {
        await message.reply({
            content: '❌ Usage: `!char [character name]`\nExample: `!char Drau`',
            allowedMentions: { repliedUser: false }
        });
        return;
    }

    const urlMatch = input.match(PLAYNC_CHAR_URL);
    const charUrl = urlMatch ? (input.startsWith('http') ? input : 'https://' + urlMatch[0]) : null;

    let searchMsg;
    try {
        searchMsg = await message.reply({
            content: charUrl ? `🔍 **Loading character info...** (up to 15 sec)` : `🔍 **Searching for ${input}**...`,
            allowedMentions: { repliedUser: false }
        });
    } catch (_) {}

    try {
        let charInfo;
        if (charUrl) {
            charInfo = await scrapePlayncCharacter(charUrl);
            charInfo.cp = charInfo.cp || '0';
        } else {
            charInfo = await searchPlayncByName(input);
            if (!charInfo) {
                const embed = buildLinkFallbackEmbed(input, true);
                if (searchMsg) await searchMsg.edit({ content: '❌ No results found.', embeds: [embed] }).catch(() => {});
                return;
            }
            charInfo.cp = null;
        }

        const toEnRace = (r) => (r === '천족' ? 'Elyos' : r === '마족' ? 'Asmodian' : r) || 'N/A';
        const buildEmbed = (info) => {
            const enc = encodeURIComponent(info.name || input);
            const linkLine = `[Full Profile](${info.link}) · [Talentbuilds](https://talentbuilds.com/aion2/armory?search=${enc}&region=korea) · [Shugo.GG](https://shugo.gg/?q=${enc})`;
            return new EmbedBuilder()
                .setTitle(`🛡️ TETRA INTEL: ${info.name}`)
                .setDescription(`**${linkLine}**`)
                .setThumbnail(info.img || 'https://i.imgur.com/8fXU89V.png')
                .addFields(
                    { name: '👤 Class', value: `\`${info.job}\``, inline: true },
                    { name: '📊 Level', value: `\`Lv.${info.level}\``, inline: true },
                    ...(info.cp != null ? [{ name: '⚔️ Combat Power', value: `\`${info.cp}\``, inline: true }] : []),
                    { name: '🌐 Server', value: info.server || 'N/A', inline: true },
                    { name: '🏹 Race', value: toEnRace(info.race) || info.race || 'N/A', inline: true }
                )
                .setColor(0xFF0055)
                .setTimestamp()
                .setFooter({ text: (info.resultCount && info.resultCount > 1) ? `#1 of ${info.resultCount} with same name` : 'TETRA Streamer Portal | TETRA Intelligence Unit' });
        };

        if (searchMsg) await searchMsg.edit({ content: '', embeds: [buildEmbed(charInfo)] }).catch(() => {});
        else await message.channel.send({ embeds: [buildEmbed(charInfo)], allowedMentions: { repliedUser: false } });

        if (!charInfo.cp && charInfo.link && searchMsg) {
            scrapePlayncCharacter(charInfo.link).then(scraped => {
                if (scraped?.cp) {
                    charInfo.cp = scraped.cp;
                    searchMsg.edit({ embeds: [buildEmbed(charInfo)] }).catch(() => {});
                }
            }).catch(() => {});
        }
    } catch (err) {
        console.error('[!char] Error:', err.message);
        const embed = buildLinkFallbackEmbed(input);
        try {
            if (searchMsg) {
                await searchMsg.edit({
                    content: '❌ **Failed to load.** ' + (charUrl ? 'Could not reach page. ' : '') + 'Check links below.',
                    embeds: [embed]
                });
            } else {
                await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
            }
        } catch (_) {
            await message.channel.send({ embeds: [embed] }).catch(() => {});
        }
    }
});

if (!CONFIG.TOKEN) {
    console.error('❌ DISCORD_TOKEN이 설정되지 않았습니다. .env 파일에 DISCORD_TOKEN=봇토큰 을 추가하세요.');
    process.exit(1);
}
client.login(CONFIG.TOKEN);
