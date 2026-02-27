// ── 환경변수 로드 (.env 파일)
try { require('dotenv').config(); } catch (_) {}

// ── 크래시 방지: 미처리 예외/프로미스 시 로그만 남기고 종료 방지
process.on('uncaughtException', err => { console.error('[uncaughtException]', err?.message || err); });
process.on('unhandledRejection', (reason, p) => { console.error('[unhandledRejection]', reason); });

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
    MessageFlags,
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    AttachmentBuilder,
    REST,
    Routes
} = require('discord.js');
const { google } = require('googleapis');
const path = require('path');
const os = require('os');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const Tesseract = require('tesseract.js');

async function getPuppeteerLaunchOptions() {
    return {
        args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: await chromium.executablePath(),
        headless: IS_RENDER_ENV ? 'shell' : true
    };
}
const schedule = require('node-schedule');

// ═══════════════════════════════════════════════════════════
// [1] 설정
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const DEFAULT_STATE_DIR = path.join(__dirname, '.state');
const RENDER_PERSISTENT_STATE_DIR = '/var/data';
const RAW_ENV_STATE_DIR = String(process.env.STATE_DIR || '').trim();
const IS_RENDER_ENV = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_INSTANCE_ID);
const LEGACY_STATE_FILES = {
    panel: path.join(__dirname, 'panel_state.json'),
    kinah: path.join(__dirname, 'kinah_state.json'),
    aonTranslate: path.join(__dirname, 'aon_translate_state.json'),
};

function ensureDirectory(dirPath) {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
        return true;
    } catch (err) {
        console.error(`[state] failed to create directory: ${dirPath} -> ${err.message}`);
        return false;
    }
}

function canWriteDirectory(dirPath) {
    try {
        if (!ensureDirectory(dirPath)) return false;
        fs.accessSync(dirPath, fs.constants.W_OK);
        return true;
    } catch (err) {
        console.warn(`[state] directory is not writable: ${dirPath} -> ${err.message}`);
        return false;
    }
}

function readJsonFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
}

function loadJsonState(primaryPath, legacyPath, fallbackValue) {
    try {
        return readJsonFile(primaryPath);
    } catch (_) {}

    if (legacyPath && legacyPath !== primaryPath) {
        try {
            const migrated = readJsonFile(legacyPath);
            saveJsonState(primaryPath, migrated);
            console.log(`[state] migrated ${path.basename(legacyPath)} -> ${primaryPath}`);
            return migrated;
        } catch (_) {}
    }
    return fallbackValue;
}

function saveJsonState(primaryPath, value) {
    ensureDirectory(path.dirname(primaryPath));
    fs.writeFileSync(primaryPath, JSON.stringify(value, null, 2));
}

function resolveStateDir() {
    const candidates = [];
    if (RAW_ENV_STATE_DIR) candidates.push(path.resolve(RAW_ENV_STATE_DIR));
    if (IS_RENDER_ENV) candidates.push(RENDER_PERSISTENT_STATE_DIR);
    candidates.push(path.resolve(DEFAULT_STATE_DIR));
    candidates.push(path.join(os.tmpdir(), 'tetra-state'));

    const tried = new Set();
    for (const candidate of candidates) {
        if (!candidate || tried.has(candidate)) continue;
        tried.add(candidate);
        if (canWriteDirectory(candidate)) return candidate;
    }
    return path.join(os.tmpdir(), 'tetra-state');
}

const STATE_DIR = resolveStateDir();
ensureDirectory(STATE_DIR);
console.log(`[state] using state dir: ${STATE_DIR}`);
if (IS_RENDER_ENV && !STATE_DIR.startsWith(RENDER_PERSISTENT_STATE_DIR)) {
    console.warn('[state] warning: persistent disk is not active. Configure Render Disk mount `/var/data` and set STATE_DIR=/var/data.');
}

const CONFIG = {
    HOMEWORK_RESET_CHANNEL: process.env.HOMEWORK_RESET_CHANNEL || '1475500753089990746',
    REPORT_CHANNEL: process.env.REPORT_CHANNEL || '1475500753089990746',
    SALARY_CHANNEL: process.env.SALARY_CHANNEL || '1475449233757966438',
    SHEET_ID: process.env.SHEET_ID || '1-SscA750TuYUd6BcGQF-hXXO_5HI5HxpGkmYo_JXnR8',
    TOKEN: process.env.DISCORD_TOKEN,
    CREDENTIALS_PATH: path.join(__dirname, 'credentials.json.json'),
    STATE_DIR,
    PANEL_STATE_PATH: path.join(STATE_DIR, 'panel_state.json'),
    KINAH_STATE_PATH: path.join(STATE_DIR, 'kinah_state.json'),
    KINAH_TICKER_MS: Math.max(60_000, parseInt(process.env.KINAH_TICKER_MS || '300000', 10) || 300_000),
    AON_TRANSLATE_STATE_PATH: path.join(STATE_DIR, 'aon_translate_state.json'),
    AON_SOURCE_BOT_ID: process.env.AON_SOURCE_BOT_ID || '1445310764846940303',
    PANEL_IMAGES: {
        salary: path.join(__dirname, 'panels', 'salary.png')
    },
    MVP_SCHEDULE_PATH: path.join(STATE_DIR, 'mvp_schedule.json'),
    BOSS_STATE_PATH: path.join(STATE_DIR, 'boss_state.json'),
    VERIFY_PENDING_PATH: path.join(STATE_DIR, 'verify_pending.json'),
    GUIDEBOOK_STATE_PATH: path.join(STATE_DIR, 'guidebook_state.json'),
    GUIDEBOOK_OFFICIAL_SEED_PATH: path.join(__dirname, 'guidebook_official_seed.json'),
    GUIDEBOOK_ENABLE_SCRAPE: String(process.env.GUIDEBOOK_ENABLE_SCRAPE || 'false').toLowerCase() === 'true',
    BOSS_WARNING_MINUTES: Math.max(1, parseInt(process.env.BOSS_WARNING_MINUTES || '10', 10) || 10),
    BOSS_TICKER_MS: Math.max(10_000, parseInt(process.env.BOSS_TICKER_MS || '60000', 10) || 60_000),
    TELEGRAM_BOT_TOKEN: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    TELEGRAM_CHAT_ID: (process.env.TELEGRAM_CHAT_ID || '').trim(),
};

const RUNTIME_STATE_SHEET_NAME = process.env.RUNTIME_STATE_SHEET_NAME || 'Bot_Runtime_State';
const ENABLE_SHEETS_STATE = String(process.env.ENABLE_SHEETS_STATE || 'true').toLowerCase() !== 'false';
let runtimeStateSheetReady = false;
let runtimeStatePersistenceActive = false;
let runtimeStateFlushTimer = null;
let runtimeStateFlushInFlight = false;
let runtimeStateLastPayloadHash = '';

async function getSheetsApiForState() {
    const auth = new google.auth.GoogleAuth({
        keyFile: CONFIG.CREDENTIALS_PATH,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
}

async function ensureRuntimeStateSheet() {
    if (runtimeStateSheetReady) return true;
    try {
        const sheets = await getSheetsApiForState();
        const meta = await sheets.spreadsheets.get({
            spreadsheetId: CONFIG.SHEET_ID,
            fields: 'sheets.properties.title',
        });
        const titles = (meta.data?.sheets || []).map(s => s.properties?.title).filter(Boolean);
        if (!titles.includes(RUNTIME_STATE_SHEET_NAME)) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: CONFIG.SHEET_ID,
                requestBody: {
                    requests: [{ addSheet: { properties: { title: RUNTIME_STATE_SHEET_NAME } } }],
                },
            });
        }
        await sheets.spreadsheets.values.update({
            spreadsheetId: CONFIG.SHEET_ID,
            range: `${RUNTIME_STATE_SHEET_NAME}!A1:B1`,
            valueInputOption: 'RAW',
            requestBody: { values: [['key', 'json_or_value']] },
        });
        runtimeStateSheetReady = true;
        return true;
    } catch (err) {
        console.warn(`[state] runtime sheet init failed: ${err.message}`);
        return false;
    }
}

function buildRuntimeStateRows() {
    const panelStateSnapshot = loadPanelState();
    return [
        ['panel_state_json', JSON.stringify(panelStateSnapshot)],
        ['kinah_state_json', JSON.stringify(kinahState)],
        ['aon_translate_state_json', JSON.stringify(aonTranslateState)],
        ['boss_state_json', JSON.stringify(bossState)],
        ['mvp_schedule_state_json', JSON.stringify(mvpScheduleState)],
        ['updated_at', String(Date.now())],
    ];
}

async function loadRuntimeStateFromSheet() {
    if (!ENABLE_SHEETS_STATE) return null;
    const ready = await ensureRuntimeStateSheet();
    if (!ready) return null;
    try {
        const sheets = await getSheetsApiForState();
        const { data } = await sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SHEET_ID,
            range: `${RUNTIME_STATE_SHEET_NAME}!A2:B20`,
        });
        const rows = data?.values || [];
        const map = new Map(rows.map(row => [String(row[0] || '').trim(), String(row[1] || '').trim()]));
        const panelRaw = map.get('panel_state_json');
        const kinahRaw = map.get('kinah_state_json');
        const aonRaw = map.get('aon_translate_state_json');
        const bossRaw = map.get('boss_state_json');
        const mvpRaw = map.get('mvp_schedule_state_json');
        return {
            panel: panelRaw ? JSON.parse(panelRaw) : null,
            kinah: kinahRaw ? JSON.parse(kinahRaw) : null,
            aonTranslate: aonRaw ? JSON.parse(aonRaw) : null,
            boss: bossRaw ? JSON.parse(bossRaw) : null,
            mvp: mvpRaw ? JSON.parse(mvpRaw) : null,
        };
    } catch (err) {
        console.warn(`[state] runtime sheet load failed: ${err.message}`);
        return null;
    }
}

function buildRuntimeStateRowsWithMerge(loaded) {
    const our = loadPanelState();
    const base = loaded?.panel && typeof loaded.panel === 'object' ? loaded.panel : {};
    const mergedPanel = { ...base, ...our };
    mergedPanel.welcomeConfig = { ...(base.welcomeConfig || {}), ...(our.welcomeConfig || {}) };
    mergedPanel.verifyCategoryIdByGuild = { ...(base.verifyCategoryIdByGuild || {}), ...(our.verifyCategoryIdByGuild || {}) };
    mergedPanel.paymentChannelIdByGuild = { ...(base.paymentChannelIdByGuild || {}), ...(our.paymentChannelIdByGuild || {}) };
    mergedPanel.paymentOcrConfigByGuild = { ...(base.paymentOcrConfigByGuild || {}), ...(our.paymentOcrConfigByGuild || {}) };
    mergedPanel.marketConfigByGuild = { ...(base.marketConfigByGuild || {}), ...(our.marketConfigByGuild || {}) };
    mergedPanel.trustRoleMapByGuild = { ...(base.trustRoleMapByGuild || {}), ...(our.trustRoleMapByGuild || {}) };
    mergedPanel.trustScoresByGuild = { ...(base.trustScoresByGuild || {}) };
    for (const [gid, scores] of Object.entries(our.trustScoresByGuild || {})) {
        mergedPanel.trustScoresByGuild[gid] = { ...(mergedPanel.trustScoresByGuild[gid] || {}), ...(scores || {}) };
    }
    mergedPanel.marketListingsByGuild = { ...(base.marketListingsByGuild || {}) };
    for (const [gid, listings] of Object.entries(our.marketListingsByGuild || {})) {
        mergedPanel.marketListingsByGuild[gid] = { ...(mergedPanel.marketListingsByGuild[gid] || {}), ...(listings || {}) };
    }
    mergedPanel.marketOpenTicketsByGuild = { ...(base.marketOpenTicketsByGuild || {}) };
    for (const [gid, tickets] of Object.entries(our.marketOpenTicketsByGuild || {})) {
        mergedPanel.marketOpenTicketsByGuild[gid] = { ...(mergedPanel.marketOpenTicketsByGuild[gid] || {}), ...(tickets || {}) };
    }
    mergedPanel.reportSessionsByGuild = { ...(base.reportSessionsByGuild || {}) };
    for (const [gid, sessions] of Object.entries(our.reportSessionsByGuild || {})) {
        mergedPanel.reportSessionsByGuild[gid] = { ...(mergedPanel.reportSessionsByGuild[gid] || {}), ...(sessions || {}) };
    }

    const mergedKinah = { guilds: { ...(loaded?.kinah?.guilds || {}) } };
    for (const [gid, d] of Object.entries(kinahState.guilds || {})) mergedKinah.guilds[gid] = d;

    const mergedAon = { guilds: { ...(loaded?.aonTranslate?.guilds || {}) } };
    for (const [gid, d] of Object.entries(aonTranslateState.guilds || {})) mergedAon.guilds[gid] = d;

    const mergedBoss = { guilds: { ...(loaded?.boss?.guilds || {}) } };
    for (const [gid, d] of Object.entries(bossState.guilds || {})) mergedBoss.guilds[gid] = d;

    const mergedMvp = { guilds: { ...(loaded?.mvp?.guilds || {}) } };
    for (const [gid, d] of Object.entries(mvpScheduleState.guilds || {})) mergedMvp.guilds[gid] = d;

    return [
        ['panel_state_json', JSON.stringify(mergedPanel)],
        ['kinah_state_json', JSON.stringify(mergedKinah)],
        ['aon_translate_state_json', JSON.stringify(mergedAon)],
        ['boss_state_json', JSON.stringify(mergedBoss)],
        ['mvp_schedule_state_json', JSON.stringify(mergedMvp)],
        ['updated_at', String(Date.now())],
    ];
}

async function flushRuntimeStateToSheet(force = false) {
    if (!runtimeStatePersistenceActive || !ENABLE_SHEETS_STATE) return false;
    if (runtimeStateFlushInFlight) return false;
    runtimeStateFlushInFlight = true;
    try {
        const loaded = await loadRuntimeStateFromSheet();
        const rows = buildRuntimeStateRowsWithMerge(loaded);
        const payloadHash = JSON.stringify(rows);
        if (!force && payloadHash === runtimeStateLastPayloadHash) return true;
        const ready = await ensureRuntimeStateSheet();
        if (!ready) return false;
        const sheets = await getSheetsApiForState();
        await sheets.spreadsheets.values.update({
            spreadsheetId: CONFIG.SHEET_ID,
            range: `${RUNTIME_STATE_SHEET_NAME}!A2:B7`,
            valueInputOption: 'RAW',
            requestBody: { values: rows },
        });
        runtimeStateLastPayloadHash = payloadHash;
        console.log('[state] runtime state synced to Google Sheet.');
        return true;
    } catch (err) {
        console.warn(`[state] runtime sheet flush failed: ${err.message}`);
        return false;
    } finally {
        runtimeStateFlushInFlight = false;
    }
}

function scheduleRuntimeStateFlush(force = false) {
    if (!runtimeStatePersistenceActive || !ENABLE_SHEETS_STATE) return;
    if (runtimeStateFlushTimer) return;
    runtimeStateFlushTimer = setTimeout(() => {
        runtimeStateFlushTimer = null;
        flushRuntimeStateToSheet(force).catch(() => {});
    }, 2000);
}

async function hydrateRuntimeStateFromSheet() {
    if (!ENABLE_SHEETS_STATE) return false;
    const ready = await ensureRuntimeStateSheet();
    if (!ready) {
        runtimeStatePersistenceActive = false;
        return false;
    }
    runtimeStatePersistenceActive = true;
    const loaded = await loadRuntimeStateFromSheet();
    let hydrated = false;

    if (loaded?.kinah && typeof loaded.kinah === 'object') {
        const sheetGuilds = loaded.kinah.guilds && typeof loaded.kinah.guilds === 'object' ? loaded.kinah.guilds : {};
        const localGuilds = kinahState.guilds || {};
        const merged = { ...sheetGuilds };
        for (const guild of (client.guilds?.cache?.values() || [])) {
            const gid = guild.id;
            const fromSheet = sheetGuilds[gid];
            const fromLocal = localGuilds[gid];
            merged[gid] = fromSheet
                ? { ...fromLocal, ...fromSheet, kinah: createDefaultKinahWatch(fromSheet.kinah || fromSheet) }
                : (fromLocal ? { ...fromLocal, kinah: createDefaultKinahWatch(fromLocal.kinah || fromLocal) } : { kinah: createDefaultKinahWatch() });
        }
        kinahState.guilds = merged;
        hydrated = true;
    }
    if (loaded?.panel && typeof loaded.panel === 'object') {
        const local = loadPanelState();
        const sheet = loaded.panel;
        const merged = { ...sheet, ...local };
        merged.welcomeConfig = { ...(sheet.welcomeConfig || {}), ...(local.welcomeConfig || {}) };
        merged.verifyCategoryIdByGuild = { ...(sheet.verifyCategoryIdByGuild || {}), ...(local.verifyCategoryIdByGuild || {}) };
        merged.paymentChannelIdByGuild = { ...(sheet.paymentChannelIdByGuild || {}), ...(local.paymentChannelIdByGuild || {}) };
        merged.paymentOcrConfigByGuild = { ...(sheet.paymentOcrConfigByGuild || {}), ...(local.paymentOcrConfigByGuild || {}) };
        merged.marketConfigByGuild = { ...(sheet.marketConfigByGuild || {}), ...(local.marketConfigByGuild || {}) };
        merged.trustRoleMapByGuild = { ...(sheet.trustRoleMapByGuild || {}), ...(local.trustRoleMapByGuild || {}) };
        merged.trustScoresByGuild = { ...(sheet.trustScoresByGuild || {}) };
        for (const [gid, scores] of Object.entries(local.trustScoresByGuild || {})) {
            merged.trustScoresByGuild[gid] = { ...(merged.trustScoresByGuild[gid] || {}), ...(scores || {}) };
        }
        merged.marketListingsByGuild = { ...(sheet.marketListingsByGuild || {}) };
        for (const [gid, listings] of Object.entries(local.marketListingsByGuild || {})) {
            merged.marketListingsByGuild[gid] = { ...(merged.marketListingsByGuild[gid] || {}), ...(listings || {}) };
        }
        merged.marketOpenTicketsByGuild = { ...(sheet.marketOpenTicketsByGuild || {}) };
        for (const [gid, tickets] of Object.entries(local.marketOpenTicketsByGuild || {})) {
            merged.marketOpenTicketsByGuild[gid] = { ...(merged.marketOpenTicketsByGuild[gid] || {}), ...(tickets || {}) };
        }
        merged.reportSessionsByGuild = { ...(sheet.reportSessionsByGuild || {}) };
        for (const [gid, sessions] of Object.entries(local.reportSessionsByGuild || {})) {
            merged.reportSessionsByGuild[gid] = { ...(merged.reportSessionsByGuild[gid] || {}), ...(sessions || {}) };
        }
        merged.verifyCategoryId = local.verifyCategoryId || sheet.verifyCategoryId;
        saveJsonState(CONFIG.PANEL_STATE_PATH, merged);
        hydrated = true;
    }
    if (loaded?.aonTranslate && typeof loaded.aonTranslate === 'object') {
        const sheetG = loaded.aonTranslate.guilds && typeof loaded.aonTranslate.guilds === 'object' ? loaded.aonTranslate.guilds : {};
        const merged = { ...sheetG };
        for (const guild of (client.guilds?.cache?.values() || [])) {
            const gid = guild.id;
            const fromSheet = sheetG[gid];
            const fromLocal = aonTranslateState.guilds?.[gid];
            merged[gid] = fromSheet ? { ...fromLocal, ...fromSheet } : (fromLocal || { enabled: false, sourceBotId: CONFIG.AON_SOURCE_BOT_ID, routes: createAonRouteMap(), translatedMessageIds: [] });
        }
        aonTranslateState.guilds = merged;
        hydrated = true;
    }
    if (loaded?.boss && typeof loaded.boss === 'object' && loaded.boss.guilds) {
        const sheetG = loaded.boss.guilds;
        const merged = { ...sheetG };
        for (const guild of (client.guilds?.cache?.values() || [])) {
            const gid = guild.id;
            if (!merged[gid] && bossState.guilds?.[gid]) merged[gid] = bossState.guilds[gid];
            else if (sheetG[gid]) merged[gid] = sheetG[gid];
        }
        bossState.guilds = merged;
        saveBossState();
        hydrated = true;
    }
    if (loaded?.mvp && typeof loaded.mvp === 'object' && loaded.mvp.guilds) {
        const sheetG = loaded.mvp.guilds;
        const merged = { ...sheetG };
        for (const guild of (client.guilds?.cache?.values() || [])) {
            const gid = guild.id;
            if (!merged[gid] && mvpScheduleState.guilds?.[gid]) merged[gid] = mvpScheduleState.guilds[gid];
            else if (sheetG[gid]) merged[gid] = sheetG[gid];
        }
        mvpScheduleState.guilds = merged;
        saveMvpScheduleState();
        hydrated = true;
    }

    if (hydrated) {
        saveKinahState();
        saveAonTranslateState();
        console.log('[state] loaded runtime state from Google Sheet.');
    } else {
        console.log('[state] no remote runtime state found. Initializing sheet snapshot.');
    }
    await flushRuntimeStateToSheet(true);
    return hydrated;
}

function loadPanelState() {
    const parsed = loadJsonState(CONFIG.PANEL_STATE_PATH, LEGACY_STATE_FILES.panel, {});
    return parsed && typeof parsed === 'object' ? parsed : {};
}
function loadVerifyPendingState() {
    const parsed = loadJsonState(CONFIG.VERIFY_PENDING_PATH, null, { pending: {} });
    parsed.pending = parsed.pending && typeof parsed.pending === 'object' ? parsed.pending : {};
    return parsed;
}
function saveVerifyPendingState(state) {
    saveJsonState(CONFIG.VERIFY_PENDING_PATH, state || { pending: {} });
}
function savePanelState(s, immediateFlush = false) {
    saveJsonState(CONFIG.PANEL_STATE_PATH, s || {});
    if (immediateFlush && ENABLE_SHEETS_STATE && runtimeStatePersistenceActive) {
        flushRuntimeStateToSheet(true).catch(() => {});
    } else {
        scheduleRuntimeStateFlush(true);
    }
}

const panelUpdateLocks = new Set();
const MVP_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function loadMvpScheduleState() {
    try {
        const raw = fs.readFileSync(CONFIG.MVP_SCHEDULE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { guilds: {} };
        parsed.guilds = parsed.guilds || {};
        return parsed;
    } catch { return { guilds: {} }; }
}
const mvpScheduleState = loadMvpScheduleState();
function saveMvpScheduleState() {
    ensureDirectory(path.dirname(CONFIG.MVP_SCHEDULE_PATH));
    fs.writeFileSync(CONFIG.MVP_SCHEDULE_PATH, JSON.stringify(mvpScheduleState, null, 2));
    scheduleRuntimeStateFlush(true);
}
function ensureMvpGuildState(guildId) {
    if (!mvpScheduleState.guilds[guildId]) {
        mvpScheduleState.guilds[guildId] = { schedule: {}, channelId: null };
    }
    const g = mvpScheduleState.guilds[guildId];
    g.schedule = g.schedule && typeof g.schedule === 'object' ? g.schedule : {};
    return g;
}
function parseTime24(str) {
    const m = String(str || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return { hour: h, minute: min };
}

const BOSS_PRESETS = {
    elyos: [
        { name: 'Tahabata', respawnMinutes: 360 },
        { name: 'Bakarma', respawnMinutes: 300 },
        { name: 'Anuhart', respawnMinutes: 240 },
        { name: 'Kromede', respawnMinutes: 180 },
        { name: 'Asteria Guardian', respawnMinutes: 180 },
    ],
    asmodian: [
        { name: 'Padmarashka', respawnMinutes: 420 },
        { name: 'Debilkarim', respawnMinutes: 300 },
        { name: 'Lannok', respawnMinutes: 240 },
        { name: 'Flame Lord Calindi', respawnMinutes: 180 },
        { name: 'Miren Guardian', respawnMinutes: 180 },
    ],
};
function loadBossState() {
    try {
        const raw = fs.readFileSync(CONFIG.BOSS_STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { guilds: {} };
        parsed.guilds = parsed.guilds || {};
        return parsed;
    } catch { return { guilds: {} }; }
}
const bossState = loadBossState();
function saveBossState() {
    ensureDirectory(path.dirname(CONFIG.BOSS_STATE_PATH));
    fs.writeFileSync(CONFIG.BOSS_STATE_PATH, JSON.stringify(bossState, null, 2));
    scheduleRuntimeStateFlush(true);
}
function ensureBossGuildState(guildId) {
    if (!bossState.guilds[guildId]) {
        bossState.guilds[guildId] = {
            bosses: {},
            bossChannelId: null,
            bossSettings: { eventMultiplier: 1, dmSubscribers: [] },
        };
    }
    const g = bossState.guilds[guildId];
    g.bosses = g.bosses || {};
    g.bossSettings = g.bossSettings || { eventMultiplier: 1, dmSubscribers: [] };
    g.bossSettings.eventMultiplier = Number.isFinite(Number(g.bossSettings.eventMultiplier))
        ? Math.min(2, Math.max(0.1, Number(g.bossSettings.eventMultiplier)))
        : 1;
    g.bossSettings.dmSubscribers = Array.isArray(g.bossSettings.dmSubscribers) ? g.bossSettings.dmSubscribers : [];
    return g;
}
function normalizeBossName(name) {
    return String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}
function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}
function statusForBoss(boss, now = Date.now()) {
    if (!boss.nextSpawnAt) return 'Not tracked yet';
    const remaining = boss.nextSpawnAt - now;
    if (remaining <= 0) return 'Spawned';
    return `${formatDuration(remaining)} left`;
}
function resolveBoss(guildState, inputName) {
    const key = normalizeBossName(inputName);
    if (!key) return { error: 'empty' };
    if (guildState.bosses[key]) return { boss: guildState.bosses[key] };
    const matches = Object.values(guildState.bosses).filter(b =>
        normalizeBossName(b.name).includes(key)
    );
    if (matches.length === 1) return { boss: matches[0] };
    if (matches.length > 1) return { error: 'ambiguous', matches };
    return { error: 'missing' };
}
function listPreset(mode) {
    if (mode === 'combined') return [...BOSS_PRESETS.elyos, ...BOSS_PRESETS.asmodian];
    return BOSS_PRESETS[mode] || [];
}
/** Parse boss list from JSON. Returns { elyos: [], asmodian: [], all: [] } with location, description, image, level, faction */
function parseBossListFromJson(data) {
    if (!data || typeof data !== 'object') return null;
    const str = (v) => (v != null && String(v).trim()) ? String(v).trim() : null;
    const toBoss = (b, faction) => {
        const name = b?.name || b?.boss;
        const min = b?.respawnMinutes ?? b?.respawn ?? b?.minutes;
        if (!name || !Number.isFinite(Number(min))) return null;
        const location = str(b?.location || b?.zone || b?.map);
        const description = str(b?.description || b?.desc);
        const image = str(b?.image || b?.thumbnail || b?.thumbnailUrl || b?.icon);
        const level = b?.level != null ? (Number(b.level) || str(b.level)) : null;
        const f = faction || str(b?.faction) || null;
        return {
            name: String(name),
            respawnMinutes: Math.max(1, Math.min(10080, Math.round(Number(min)))),
            location: location || null,
            description: description || null,
            image: image || null,
            level: level != null ? (typeof level === 'number' ? level : String(level)) : null,
            faction: f ? (String(f).toLowerCase() === 'asmodian' ? 'asmodian' : 'elyos') : null,
        };
    };
    const elyos = [];
    const asmodian = [];
    if (Array.isArray(data.elyos)) for (const b of data.elyos) { const x = toBoss(b, 'elyos'); if (x) elyos.push(x); }
    if (Array.isArray(data.asmodian)) for (const b of data.asmodian) { const x = toBoss(b, 'asmodian'); if (x) asmodian.push(x); }
    if (Array.isArray(data.bosses) && !elyos.length && !asmodian.length) {
        for (const b of data.bosses) {
            const f = (b?.faction || '').toLowerCase();
            const x = toBoss(b, f === 'asmodian' ? 'asmodian' : 'elyos');
            if (!x) continue;
            if (f === 'asmodian') asmodian.push(x); else elyos.push(x);
        }
    }
    const all = [...elyos, ...asmodian];
    return all.length ? { elyos, asmodian, all } : null;
}
async function fetchBossListFromUrl(url) {
    const { data } = await axios.get(url, { timeout: 15_000 });
    const parsed = parseBossListFromJson(data);
    if (!parsed) return null;
    const translateName = async (name) => hasHangul(name) ? (await translateKoToEn(name) || name) : name;
    const translateDesc = async (desc) => desc && hasHangul(desc) ? (await translateKoToEn(desc) || desc) : desc;
    const translateLoc = async (loc) => loc && hasHangul(loc) ? (await translateKoToEn(loc) || loc) : loc;
    for (const b of parsed.elyos) {
        b.name = await translateName(b.name);
        if (b.description) b.description = await translateDesc(b.description);
        if (b.location) b.location = await translateLoc(b.location);
    }
    for (const b of parsed.asmodian) {
        b.name = await translateName(b.name);
        if (b.description) b.description = await translateDesc(b.description);
        if (b.location) b.location = await translateLoc(b.location);
    }
    return parsed;
}
const BOSS_FETCH_DEFAULT_URL = 'https://raw.githubusercontent.com/vacagencydev-ringring/tetra/main/boss_presets.json';
const BOSS_THUMBNAIL_DEFAULT = 'https://i.imgur.com/8fXU89V.png';

function getBossImageUrl(boss) {
    if (boss?.image) return boss.image;
    const seed = 'aion2-' + String(boss?.name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^\w가-힣-]/g, '') || 'boss';
    return `https://picsum.photos/seed/${encodeURIComponent(seed)}/128/128`;
}
function getBossEventMultiplier(guildState) {
    const value = Number(guildState?.bossSettings?.eventMultiplier ?? 1);
    if (!Number.isFinite(value) || value <= 0) return 1;
    return Math.min(2, Math.max(0.1, value));
}
function getEffectiveRespawnMinutes(guildState, boss) {
    return Math.max(1, Math.round(boss.respawnMinutes * getBossEventMultiplier(guildState)));
}
function buildBossListEmbed(guildState) {
    const bosses = Object.values(guildState.bosses || {});
    const now = Date.now();
    const multiplier = getBossEventMultiplier(guildState);
    const sorted = bosses.sort((a, b) =>
        (a.nextSpawnAt || Number.MAX_SAFE_INTEGER) - (b.nextSpawnAt || Number.MAX_SAFE_INTEGER)
    );
    const lines = sorted.map(boss => {
        const next = boss.nextSpawnAt ? toDiscordTime(boss.nextSpawnAt) : 'N/A';
        const effective = getEffectiveRespawnMinutes(guildState, boss);
        const respawnLabel = effective === boss.respawnMinutes
            ? `${boss.respawnMinutes}m`
            : `${boss.respawnMinutes}m -> ${effective}m`;
        let line = `- **${boss.name}** (${respawnLabel}) -> ${statusForBoss(boss, now)} | Next: ${next}`;
        if (boss.level) line += ` | ${boss.level}`;
        if (boss.location) line += ` | 📍 ${boss.location}`;
        if (boss.faction) line += ` | ${boss.faction === 'asmodian' ? 'Asmodian' : 'Elyos'}`;
        return line;
    });
    const thumb = sorted.length ? getBossImageUrl(sorted[0]) : BOSS_THUMBNAIL_DEFAULT;
    const embed = new EmbedBuilder()
        .setTitle('Field Boss Board')
        .setDescription(lines.join('\n').slice(0, 3600) || 'No bosses configured.')
        .addFields({ name: 'Event multiplier', value: `${multiplier}x`, inline: true })
        .setColor(0x2563eb)
        .setThumbnail(thumb)
        .setTimestamp();
    return embed;
}
function buildSingleBossEmbed(guildState, boss) {
    const next = boss.nextSpawnAt ? toDiscordTime(boss.nextSpawnAt) : 'N/A';
    const lastCut = boss.lastCutAt ? toDiscordTime(boss.lastCutAt) : 'N/A';
    const effective = getEffectiveRespawnMinutes(guildState, boss);
    const respawnLabel = effective === boss.respawnMinutes
        ? `${boss.respawnMinutes} minutes`
        : `${boss.respawnMinutes} minutes (event: ${effective} minutes)`;
    const parts = [
        `**Respawn:** ${respawnLabel}`,
        `**Status:** ${statusForBoss(boss)}`,
        `**Next Spawn:** ${next}`,
        `**Last Cut:** ${lastCut}`,
    ];
    if (boss.location) parts.push(`**Location:** ${boss.location}`);
    if (boss.level != null) parts.push(`**Level:** ${boss.level}`);
    if (boss.faction) parts.push(`**Faction:** ${boss.faction === 'asmodian' ? 'Asmodian' : 'Elyos'}`);
    if (boss.description) parts.push(`\n${boss.description}`);
    const embed = new EmbedBuilder()
        .setTitle(`Boss: ${boss.name}`)
        .setDescription(parts.join('\n').slice(0, 4000))
        .setColor(0x1d4ed8)
        .setTimestamp();
    embed.setThumbnail(getBossImageUrl(boss));
    return embed;
}
function parseHHmm(input) {
    const raw = String(input || '').trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hh = parseInt(match[1], 10);
    const mm = parseInt(match[2], 10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return { hh, mm };
}
function parseTodayTime(input, preferPast = false) {
    const parsed = parseHHmm(input);
    if (!parsed) return null;
    const d = new Date();
    d.setHours(parsed.hh, parsed.mm, 0, 0);
    if (preferPast && d.getTime() > Date.now() + 5 * 60_000) d.setDate(d.getDate() - 1);
    return d;
}
async function sendBossAlert(client, guildState, message) {
    const dmTargets = Array.isArray(guildState?.bossSettings?.dmSubscribers) ? guildState.bossSettings.dmSubscribers : [];
    let dmDelivered = false;
    for (const userId of dmTargets) {
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) await user.send(message).then(() => { dmDelivered = true; }).catch(() => {});
    }
    if (dmDelivered) return;
    if (!guildState.bossChannelId) return;
    const channel = await client.channels.fetch(guildState.bossChannelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send(message).catch(() => {});
}
let bossTickerActive = false;
async function runBossTicker(client) {
    if (bossTickerActive) return;
    bossTickerActive = true;
    try {
        const now = Date.now();
        let changed = false;
        for (const [guildId, guildState] of Object.entries(bossState.guilds)) {
            for (const boss of Object.values(guildState.bosses || {})) {
                if (!boss.nextSpawnAt) continue;
                const remaining = boss.nextSpawnAt - now;
                const target = boss.nextSpawnAt;
                if (remaining <= CONFIG.BOSS_WARNING_MINUTES * 60_000 && remaining > 0 && boss.warnedForSpawnAt !== target) {
                    await sendBossAlert(client, guildState, `Boss warning: **${boss.name}** spawns in about ${formatDuration(remaining)}.`);
                    boss.warnedForSpawnAt = target;
                    changed = true;
                }
                if (remaining <= 0 && boss.announcedForSpawnAt !== target) {
                    await sendBossAlert(client, guildState, `Boss alert: **${boss.name}** should be up now. Record with \`/cut boss_name:${boss.name}\` after kill.`);
                    boss.announcedForSpawnAt = target;
                    changed = true;
                }
            }
        }
        if (changed) saveBossState();
    } finally {
        bossTickerActive = false;
    }
}

const KINAH_PRESET_TYPES = ['itembay_aion2', 'itemmania_aion2', 'dual_market_aion2'];
const KINAH_PRESET_DEFAULTS = {
    itembay_aion2: {
        primaryUrl: 'https://www.itembay.com/item/sell/game-3603/type-3',
        sourceKeyword: 'AION2 kinah',
    },
    itemmania_aion2: {
        primaryUrl: 'https://trade.itemmania.com/list/search.html?searchString=%EC%95%84%EC%9D%B4%EC%98%A82%20%ED%82%A4%EB%82%98',
        sourceKeyword: 'AION2 kinah',
    },
    dual_market_aion2: {
        primaryUrl: 'https://www.itembay.com/item/sell/game-3603/type-3',
        secondaryUrl: 'https://trade.itemmania.com/list/search.html?searchString=%EC%95%84%EC%9D%B4%EC%98%A82%20%ED%82%A4%EB%82%98',
        sourceKeyword: 'AION2 kinah',
    },
};

function createAonRouteMap(seed = null) {
    const map = { notice: null, update: null, event: null };
    if (!seed || typeof seed !== 'object') return map;
    for (const k of Object.keys(map)) {
        map[k] = typeof seed[k] === 'string' && seed[k].length ? seed[k] : null;
    }
    return map;
}

function loadAonTranslateState() {
    const parsed = loadJsonState(CONFIG.AON_TRANSLATE_STATE_PATH, LEGACY_STATE_FILES.aonTranslate, { guilds: {} });
    if (!parsed || typeof parsed !== 'object') return { guilds: {} };
    parsed.guilds = parsed.guilds || {};
    return parsed;
}
const aonTranslateState = loadAonTranslateState();
function saveAonTranslateState() {
    saveJsonState(CONFIG.AON_TRANSLATE_STATE_PATH, aonTranslateState);
    scheduleRuntimeStateFlush(true);
}

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

function createDefaultKinahWatch(seed = null) {
    const base = {
        enabled: false,
        sourcePreset: null,
        sourceKeyword: 'AION2 kinah',
        channelId: null,
        sourceUrl: null,
        secondarySourceUrl: null,
        selector: null,
        valueRegex: null,
        pollMinutes: 5,
        mentionRoleId: null,
        lastRate: null,
        stableRate: null,
        rateHistory: [],
        lastRawText: null,
        lastSourceSummary: null,
        lastCheckedAt: null,
        lastPostedAt: null,
        lastError: null,
    };
    if (!seed || typeof seed !== 'object') return base;
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
        pollMinutes: Math.max(1, Math.min(60, Number.parseInt(String(seed.pollMinutes || 5), 10) || 5)),
        mentionRoleId: typeof seed.mentionRoleId === 'string' && seed.mentionRoleId.length ? seed.mentionRoleId : null,
        lastRate: Number.isFinite(Number(seed.lastRate)) ? Number(seed.lastRate) : null,
        stableRate: Number.isFinite(Number(seed.stableRate)) ? Number(seed.stableRate) : null,
        rateHistory: Array.isArray(seed.rateHistory)
            ? seed.rateHistory.map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0).slice(-10)
            : [],
        lastRawText: typeof seed.lastRawText === 'string' && seed.lastRawText.length ? seed.lastRawText : null,
        lastSourceSummary: typeof seed.lastSourceSummary === 'string' && seed.lastSourceSummary.length ? seed.lastSourceSummary : null,
        lastCheckedAt: Number.isFinite(Number(seed.lastCheckedAt)) ? Number(seed.lastCheckedAt) : null,
        lastPostedAt: Number.isFinite(Number(seed.lastPostedAt)) ? Number(seed.lastPostedAt) : null,
        lastError: typeof seed.lastError === 'string' && seed.lastError.length ? seed.lastError : null,
    };
}

function loadKinahState() {
    const parsed = loadJsonState(CONFIG.KINAH_STATE_PATH, LEGACY_STATE_FILES.kinah, { guilds: {} });
    if (!parsed || typeof parsed !== 'object') return { guilds: {} };
    parsed.guilds = parsed.guilds || {};
    return parsed;
}
const kinahState = loadKinahState();
function saveKinahState() {
    saveJsonState(CONFIG.KINAH_STATE_PATH, kinahState);
    scheduleRuntimeStateFlush(true);
}

function ensureKinahGuildState(guildId) {
    if (!kinahState.guilds[guildId]) kinahState.guilds[guildId] = { kinah: createDefaultKinahWatch() };
    const g = kinahState.guilds[guildId];
    g.kinah = createDefaultKinahWatch(g.kinah);
    return g;
}

function hasManageGuild(interaction) {
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

const EPHEMERAL_FLAGS = MessageFlags.Ephemeral;

const MARKET_LISTING_TYPES = ['WTS', 'WTB'];
const MARKET_CURRENCIES = ['USD', 'KRW', 'PHP', 'EUR', 'JPY'];
const TRUST_TIER_RULES = [
    { key: 'gold', min: 25, label: 'Gold Pilot', emoji: '🥇' },
    { key: 'silver', min: 10, label: 'Silver Pilot', emoji: '🥈' },
    { key: 'bronze', min: 3, label: 'Bronze Pilot', emoji: '🥉' },
];
const FX_FALLBACK_USD_RATES = {
    USD: 1,
    KRW: 1350,
    PHP: 56,
    EUR: 0.92,
    JPY: 150,
};
let fxRateCache = {
    base: 'USD',
    rates: { ...FX_FALLBACK_USD_RATES },
    fetchedAt: 0,
    source: 'fallback',
};

function clampNumber(value, min, max, fallback = min) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
}

function asSnowflake(value) {
    const id = String(value || '').trim();
    return /^\d{17,20}$/.test(id) ? id : null;
}

function ensureMarketCollections(state, guildId) {
    if (!state.marketListingsByGuild || typeof state.marketListingsByGuild !== 'object') state.marketListingsByGuild = {};
    if (!state.marketOpenTicketsByGuild || typeof state.marketOpenTicketsByGuild !== 'object') state.marketOpenTicketsByGuild = {};
    if (!state.trustScoresByGuild || typeof state.trustScoresByGuild !== 'object') state.trustScoresByGuild = {};
    if (!state.marketConfigByGuild || typeof state.marketConfigByGuild !== 'object') state.marketConfigByGuild = {};
    if (!state.trustRoleMapByGuild || typeof state.trustRoleMapByGuild !== 'object') state.trustRoleMapByGuild = {};

    if (!state.marketListingsByGuild[guildId] || typeof state.marketListingsByGuild[guildId] !== 'object') {
        state.marketListingsByGuild[guildId] = {};
    }
    if (!state.marketOpenTicketsByGuild[guildId] || typeof state.marketOpenTicketsByGuild[guildId] !== 'object') {
        state.marketOpenTicketsByGuild[guildId] = {};
    }
    if (!state.trustScoresByGuild[guildId] || typeof state.trustScoresByGuild[guildId] !== 'object') {
        state.trustScoresByGuild[guildId] = {};
    }
    if (!state.marketConfigByGuild[guildId] || typeof state.marketConfigByGuild[guildId] !== 'object') {
        state.marketConfigByGuild[guildId] = {};
    }
    if (!state.trustRoleMapByGuild[guildId] || typeof state.trustRoleMapByGuild[guildId] !== 'object') {
        state.trustRoleMapByGuild[guildId] = {};
    }

    return {
        listings: state.marketListingsByGuild[guildId],
        tickets: state.marketOpenTicketsByGuild[guildId],
        trustScores: state.trustScoresByGuild[guildId],
        marketConfigByGuild: state.marketConfigByGuild,
        trustRoleMapByGuild: state.trustRoleMapByGuild,
    };
}

function getMarketConfigForGuild(state, guildId) {
    const raw = state?.marketConfigByGuild?.[guildId] || {};
    return {
        marketChannelId: asSnowflake(raw.marketChannelId),
        ticketCategoryId: asSnowflake(raw.ticketCategoryId),
        adminRoleId: asSnowflake(raw.adminRoleId),
        feePercent: clampNumber(raw.feePercent, 0, 20, 3),
    };
}

function getTrustRoleMapForGuild(state, guildId) {
    const raw = state?.trustRoleMapByGuild?.[guildId] || {};
    return {
        bronze: asSnowflake(raw.bronze),
        silver: asSnowflake(raw.silver),
        gold: asSnowflake(raw.gold),
    };
}

function getTrustScore(state, guildId, userId) {
    const scores = state?.trustScoresByGuild?.[guildId];
    const score = scores ? Number.parseInt(String(scores[userId] || 0), 10) : 0;
    return Number.isFinite(score) ? Math.max(0, score) : 0;
}

function addTrustScore(state, guildId, userId, delta) {
    const collections = ensureMarketCollections(state, guildId);
    const current = Number.parseInt(String(collections.trustScores[userId] || 0), 10) || 0;
    const next = Math.max(0, current + Number.parseInt(String(delta || 0), 10));
    collections.trustScores[userId] = next;
    return { previous: current, current: next };
}

function getTrustTier(score) {
    const normalized = Math.max(0, Number.parseInt(String(score || 0), 10) || 0);
    for (const tier of TRUST_TIER_RULES) {
        if (normalized >= tier.min) return tier;
    }
    return null;
}

function formatTrustBadge(score) {
    const tier = getTrustTier(score);
    return tier ? `${tier.emoji} ${tier.label} (${score})` : `Unranked (${score})`;
}

async function syncTrustRolesForMember(guild, userId, roleMap, score) {
    if (!guild || !userId || !roleMap) return;
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    const allRoleIds = ['bronze', 'silver', 'gold']
        .map(k => asSnowflake(roleMap[k]))
        .filter(Boolean);
    if (!allRoleIds.length) return;
    const tier = getTrustTier(score);
    const targetRoleId = tier ? asSnowflake(roleMap[tier.key]) : null;
    for (const roleId of allRoleIds) {
        const hasRole = member.roles.cache.has(roleId);
        if (roleId === targetRoleId && !hasRole) {
            await member.roles.add(roleId, 'TETRA trust tier sync').catch(() => {});
        } else if (roleId !== targetRoleId && hasRole) {
            await member.roles.remove(roleId, 'TETRA trust tier sync').catch(() => {});
        }
    }
}

function isMarketAdmin(interaction, marketConfig) {
    if (hasManageGuild(interaction)) return true;
    const adminRoleId = asSnowflake(marketConfig?.adminRoleId);
    if (!adminRoleId) return false;
    return Boolean(interaction.member?.roles?.cache?.has(adminRoleId));
}

function createMarketListingId() {
    const left = Date.now().toString(36).slice(-6);
    const right = Math.random().toString(36).slice(2, 6);
    return `${left}${right}`;
}

function slugifyChannelToken(input, fallback = 'user') {
    const cleaned = String(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 12);
    return cleaned || fallback;
}

function formatCurrencyAmount(amount, currency) {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric)) return `N/A ${currency || ''}`.trim();
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: String(currency || 'USD').toUpperCase(),
            maximumFractionDigits: 2,
        }).format(numeric);
    } catch (_) {
        return `${numeric.toLocaleString()} ${String(currency || '').toUpperCase()}`.trim();
    }
}

function convertCurrencyWithUsdRates(amount, fromCurrency, toCurrency, rates) {
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum)) return null;
    const from = String(fromCurrency || '').toUpperCase();
    const to = String(toCurrency || '').toUpperCase();
    const fromRate = Number(rates?.[from]);
    const toRate = Number(rates?.[to]);
    if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) return null;
    const usd = amountNum / fromRate;
    return usd * toRate;
}

async function getFxRatesUsdBase() {
    const now = Date.now();
    if (fxRateCache?.rates && now - Number(fxRateCache.fetchedAt || 0) < 30 * 60_000) {
        return fxRateCache;
    }
    try {
        const { data } = await axios.get('https://open.er-api.com/v6/latest/USD', {
            timeout: 12_000,
            maxRedirects: 2,
            headers: { Accept: 'application/json' },
        });
        const rates = data?.rates;
        if (data?.result === 'success' && rates && Number.isFinite(Number(rates.USD)) && Number.isFinite(Number(rates.KRW))) {
            fxRateCache = {
                base: 'USD',
                rates,
                fetchedAt: now,
                source: 'open.er-api',
            };
            return fxRateCache;
        }
    } catch (_) {}
    return fxRateCache;
}

async function getMarketPriceConversions(totalPrice, currency) {
    const pack = await getFxRatesUsdBase();
    const rates = pack?.rates || FX_FALLBACK_USD_RATES;
    const curr = String(currency || 'USD').toUpperCase();
    return {
        usd: convertCurrencyWithUsdRates(totalPrice, curr, 'USD', rates),
        krw: convertCurrencyWithUsdRates(totalPrice, curr, 'KRW', rates),
        source: pack?.source || 'fallback',
    };
}

function buildEscrowMath(totalPrice, feePercent) {
    const amount = Number(totalPrice);
    const fee = Number.isFinite(amount) ? amount * (Number(feePercent) / 100) : 0;
    return {
        fee,
        net: Number.isFinite(amount) ? amount - fee : 0,
    };
}

function buildMarketListingEmbed({ listingType, amount, totalPrice, currency, note, ownerTag, trustScore, feePercent, conversions }) {
    const isWts = listingType === 'WTS';
    const fee = buildEscrowMath(totalPrice, feePercent);
    const title = isWts ? '💎 [WTS] Kinah for Sale' : '🛒 [WTB] Looking to Buy Kinah';
    const sideLabel = isWts ? 'Seller' : 'Buyer';
    const ccy = String(currency || 'USD').toUpperCase();
    return new EmbedBuilder()
        .setColor(isWts ? 0x00ffaa : 0x60a5fa)
        .setTitle(title)
        .setDescription(
            [
                `**${sideLabel}:** ${ownerTag}`,
                `**Anti-Scam Policy:** All deals must go through TETRA escrow ticket. External/off-platform settlement is prohibited.`,
            ].join('\n')
        )
        .addFields(
            { name: '📦 Amount', value: `**${Number(amount || 0).toLocaleString()}** Kinah`, inline: true },
            { name: '💰 Total Price', value: `**${formatCurrencyAmount(totalPrice, ccy)}**`, inline: true },
            { name: '🏅 Trust Rating', value: `**${formatTrustBadge(trustScore)}**`, inline: true },
            { name: '🛡️ Escrow Fee', value: `${feePercent.toFixed(1)}% (${formatCurrencyAmount(fee.fee, ccy)})`, inline: true },
            { name: '📥 Net to Seller', value: formatCurrencyAmount(fee.net, ccy), inline: true },
            { name: '🌐 FX Snapshot', value: `${formatCurrencyAmount(conversions?.usd, 'USD')} / ${formatCurrencyAmount(conversions?.krw, 'KRW')} (${conversions?.source || 'N/A'})`, inline: true },
            ...(note ? [{ name: '📝 Note', value: note.slice(0, 400), inline: false }] : [])
        )
        .setFooter({ text: 'TETRA Safe Trade System • Click button below to open escrow ticket' })
        .setTimestamp();
}

function buildMarketTicketEmbed({ listing, buyerId, sellerId, adminRoleId }) {
    const rolePing = adminRoleId ? `<@&${adminRoleId}>` : '`Admin`';
    return new EmbedBuilder()
        .setColor(0xff007f)
        .setTitle('🛡️ TETRA Safe Trade Room Initiated')
        .setDescription(
            [
                `**Buyer:** <@${buyerId}>`,
                `**Seller:** <@${sellerId}>`,
                `**Listing:** ${listing.type} • ${Number(listing.amount || 0).toLocaleString()} Kinah • ${formatCurrencyAmount(listing.price, listing.currency)}`,
                '',
                '### 4-Step Escrow Flow',
                `1) **Match / Ticket** — Buyer presses button, secure 3-party ticket is opened (${rolePing}, buyer, seller).`,
                '2) **Hold** — Seller sends Kinah to TETRA escrow admin account first.',
                '3) **Pay** — After admin hold confirmation, buyer sends payment (USD/KRW etc).',
                '4) **Complete** — Seller confirms payment, admin delivers Kinah to buyer, bot adds Trust +1 and closes ticket.',
                '',
                `⚠️ **Do NOT pay before admin hold confirmation by ${rolePing}.**`,
            ].join('\n')
        )
        .setFooter({ text: 'Anti-Scam / Zero Tolerance Policy Enforced' })
        .setTimestamp();
}

function buildMarketTicketControlRows(channelId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`market_hold_${channelId}`)
                .setLabel('1) Hold Confirmed (Admin)')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`market_pay_${channelId}`)
                .setLabel('2) Payment Confirmed (Seller)')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`market_complete_${channelId}`)
                .setLabel('3) Complete + Trust (Admin)')
                .setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`market_close_${channelId}`)
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger),
        ),
    ];
}

// ═══════════════════════════════════════════════════════════
// [TACTICS] Curated guides (ephemeral, user-only)
// ═══════════════════════════════════════════════════════════
const TACTICS_DATA = {
    dungeon: {
        label: 'Dungeon Guide',
        items: [
            { value: '361', label: 'Stagger Gauge & Wipe Mechanics', file: 'inven_361_english.txt' },
            { value: '249', label: 'Kaisinel (EP6 Final Boss)', file: 'inven_249_english.txt' },
            { value: '458', label: 'Krao Cave & Draupnir', file: 'inven_458_english.txt' },
            { value: '521', label: 'Urugugu & Barklon Sky Island', file: 'inven_521_english.txt' },
            { value: '655', label: 'Fire Temple', file: 'inven_655_english.txt' },
            { value: '803', label: 'Savage Horn Cave', file: 'inven_803_english.txt' },
            { value: '1249', label: 'Dead Dramata\'s Nest', file: 'inven_1249_english.txt' },
            { value: '695', label: 'Transcendence Stages 1–10', file: 'inven_695_english.txt' },
            { value: '1069', label: 'Ludra 1st & 2nd Named', file: 'inven_1069_english.txt' },
            { value: '1159', label: 'Ludra 3rd Named Tips', file: 'inven_1159_english.txt' }
        ]
    },
    pet: {
        label: 'Pet Guide',
        items: [
            { value: '518', label: 'Pet Progression Fundamentals', file: 'inven_pet_518_english.txt' },
            { value: '689', label: 'Pet Soul Acquisition Database', file: 'inven_pet_689_english.txt' },
            { value: '1077', label: 'Pet Stats & Understanding', file: 'inven_pet_1077_english.txt' }
        ]
    },
    class: {
        label: 'Class Guide',
        items: [
            { value: '58', label: 'Gladiator', file: 'inven_58_english.txt' },
            { value: '6625', label: 'Templar', file: 'inven_6625_english.txt' },
            { value: '3856', label: 'Assassin', file: 'inven_3856_english.txt' },
            { value: '4009', label: 'Ranger', file: 'inven_4009_english.txt' },
            { value: '116', label: 'Chanter', file: 'inven_116_english.txt' },
            { value: '657', label: 'Cleric', file: 'inven_657_english.txt' },
            { value: '66', label: 'Sorcerer', file: 'inven_66_english.txt' },
            { value: '2760', label: 'Spiritmaster PvE', file: 'inven_2760_english.txt' },
            { value: '965', label: 'Spiritmaster PvP', file: 'inven_965_english.txt' }
        ]
    },
    fast_leveling: {
        label: 'Fast Leveling Guide',
        items: [
            { value: '311570', label: 'Core Early-Game Leveling Tips', file: 'tactics_fast_leveling.txt' }
        ]
    },
    kinah_farming: {
        label: 'Kinah Farming Guide',
        items: [
            { value: '1067_kinah', label: '6-Character Weekly Income Plan', file: 'tactics_kinah_farming.txt' }
        ]
    },
    cp_boost_guide: {
        label: 'CP Boost Guide',
        items: [
            { value: 'cp_boost', label: 'Strike, Board, Medals, Gear Comparison', file: 'tactics_cp_boost_guide.txt' }
        ]
    },
    pantheon_guide: {
        label: 'Pantheon Guide',
        items: [
            { value: '311736', label: 'Abyss Point Acquisition Overview', file: 'tactics_pantheon_guide.txt' }
        ]
    },
    dungeon_tactics: {
        label: 'Dungeon Tactics Guide',
        items: [
            { value: 'dungeon_bundle', label: 'New Transcendence + Tier 4-6 Core Patterns', file: 'tactics_dungeon_tactics.txt' }
        ]
    },
    daily_checklist: {
        label: 'Daily Checklist Guide',
        items: [
            { value: 'daily_bundle', label: 'Daily/Weekly Tasks + Odd Energy Flow', file: 'tactics_daily_checklist.txt' }
        ]
    },
    pro_tips: {
        label: 'Pro Tips Guide',
        items: [
            { value: 'tips_bundle', label: 'Gear Reuse, Refinement, Rift, Mobile Setup', file: 'tactics_pro_tips.txt' }
        ]
    },
    wardrobe_guide: {
        label: 'Wardrobe Guide',
        items: [
            { value: 'wardrobe_bundle', label: 'Wardrobe Guide', file: 'tactics_wardrobe_guide.txt' }
        ]
    }
};

function buildTacticsCategorySelect(isPublic = false) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`select_tactics_category:${isPublic ? '1' : '0'}`)
            .setPlaceholder('Select category…')
            .addOptions(
                { label: '🏰 Dungeon Guide', value: 'dungeon', description: 'Conquest, Transcendence, Ludra guides' },
                { label: '🐾 Pet Guide', value: 'pet', description: 'Pet understanding, soul, stats' },
                { label: '⚔️ Class Guide', value: 'class', description: 'Gladiator, Templar, Assassin, Ranger, Chanter, Cleric, Sorcerer, Spiritmaster PvE/PvP' },
                { label: '🚀 Fast Leveling', value: 'fast_leveling', description: 'Core early-game leveling priorities' },
                { label: '💰 Kinah Farming', value: 'kinah_farming', description: 'Weekly kinah and resource farming routines' },
                { label: '⚔️ CP Boost Guide', value: 'cp_boost_guide', description: 'Strike, board, medals, and gear growth plan' },
                { label: '🏛️ Pantheon Guide', value: 'pantheon_guide', description: 'Abyss point and progression strategy' },
                { label: '👹 Dungeon Tactics', value: 'dungeon_tactics', description: 'New transcendence and tier 4-6 mechanics' },
                { label: '📅 Daily Checklist', value: 'daily_checklist', description: 'Daily/weekly tasks and resource control' },
                { label: '💡 Pro Tips', value: 'pro_tips', description: 'Optimization tips for setup and routine' },
                { label: '👔 Wardrobe Guide', value: 'wardrobe_guide', description: 'Wardrobe and appearance guide' }
            )
    );
}

function buildTacticsSubSelect(category, isPublic = false) {
    const cat = TACTICS_DATA[category];
    if (!cat) return null;
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`select_tactics_sub:${category}:${isPublic ? '1' : '0'}`)
            .setPlaceholder(`Select ${cat.label}…`)
            .addOptions(cat.items.map(i => ({
                label: i.label.slice(0, 100),
                value: i.value
            })))
    );
}

function loadTacticsContent(fileName) {
    const p = path.join(__dirname, fileName);
    try {
        return fs.readFileSync(p, 'utf8').trim();
    } catch {
        return null;
    }
}

function buildTacticsEmbeds(content, title) {
    const EMBED_DESC_MAX = 3800;
    const embeds = [];
    let text = String(content || '').trim();
    if (!text) return [new EmbedBuilder().setDescription('No content found.').setColor(0x5865F2)];
    const imageUrls = Array.from(
        new Set(
            (text.match(/https?:\/\/[^\s)]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s)]*)?/gi) || [])
        )
    );

    const parts = [];
    while (text.length > EMBED_DESC_MAX) {
        const chunk = text.slice(0, EMBED_DESC_MAX);
        const lastNewline = chunk.lastIndexOf('\n');
        const splitAt = lastNewline > EMBED_DESC_MAX * 0.5 ? lastNewline + 1 : EMBED_DESC_MAX;
        parts.push(text.slice(0, splitAt));
        text = text.slice(splitAt);
    }
    if (text) parts.push(text);

    for (let i = 0; i < parts.length; i++) {
        const emb = new EmbedBuilder()
            .setColor(0x5865F2)
            .setDescription(parts[i].slice(0, 4096));
        if (i === 0 && title) emb.setTitle(title);
        if (i === 0 && imageUrls[0]) emb.setImage(imageUrls[0]);
        if (i > 0) emb.setTitle(`${title || 'TACTICS'} (${i + 1}/${parts.length})`);
        embeds.push(emb);
    }
    for (let i = 1; i < imageUrls.length && embeds.length < 10; i++) {
        embeds.push(
            new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(`${title || 'TACTICS'} - Image ${i + 1}`)
                .setImage(imageUrls[i])
        );
    }
    return embeds.slice(0, 10);
}

async function safeEphemeral(interaction, content) {
    if (interaction.replied) return interaction.followUp({ content, flags: EPHEMERAL_FLAGS }).catch(() => {});
    if (interaction.deferred) return interaction.editReply({ content }).catch(() => {});
    return interaction.reply({ content, flags: EPHEMERAL_FLAGS }).catch(() => {});
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

function hasHangul(text) {
    return /[가-힣]/.test(String(text || ''));
}

function looksMostlyHangul(text) {
    const value = String(text || '');
    const letters = value.match(/[가-힣A-Za-z]/g) || [];
    if (!letters.length) return false;
    const hangulCount = (value.match(/[가-힣]/g) || []).length;
    return (hangulCount / letters.length) >= 0.5;
}

function isWeakKoToEnTranslation(source, candidate) {
    const src = String(source || '').trim();
    const out = String(candidate || '').trim();
    if (!out) return true;
    if (out.toLowerCase() === src.toLowerCase()) return true;
    if (hasHangul(src) && looksMostlyHangul(out) && !/[A-Za-z]/.test(out)) return true;
    return false;
}

async function translateKoToEnViaMyMemory(text) {
    const input = String(text || '').trim();
    if (!input) return null;
    try {
        const { data } = await axios.get('https://api.mymemory.translated.net/get', {
            params: { q: input.slice(0, 450), langpair: 'ko|en' },
            timeout: 10000
        });
        const translated = decodeXmlAttr(data?.responseData?.translatedText || '').trim();
        return translated || null;
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
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
        const translated = data[0]
            .map(part => (Array.isArray(part) ? String(part[0] || '') : ''))
            .join('')
            .trim();
        return translated || null;
    } catch {
        return null;
    }
}

async function translateKoToEn(text) {
    const input = String(text || '').trim();
    if (!input) return input;
    if (!hasHangul(input)) return input;

    const firstTry = await translateKoToEnViaMyMemory(input);
    if (firstTry && !isWeakKoToEnTranslation(input, firstTry)) return firstTry;

    const secondTry = await translateKoToEnViaGoogle(input);
    if (secondTry && !isWeakKoToEnTranslation(input, secondTry)) return secondTry;

    return input;
}

async function translateKoToEnLong(text) {
    const chunks = splitForTranslation(text, 450);
    if (!chunks.length) return '';
    const translated = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        let t = await translateKoToEn(chunk);
        if (!t || !String(t).trim() || hasHangul(t)) {
            t = await translateKoToEnViaGoogle(chunk) || await translateKoToEnViaMyMemory(chunk);
        }
        if (!t || !String(t).trim() || hasHangul(t)) {
            const smaller = splitForTranslation(chunk, 200);
            const parts = [];
            for (const s of smaller) {
                const p = await translateKoToEnViaGoogle(s) || await translateKoToEnViaMyMemory(s);
                parts.push((p && !hasHangul(p)) ? p : '');
            }
            t = parts.filter(Boolean).join(' ').trim() || '';
        }
        const fallback = chunk.replace(/[가-힣]/g, '').replace(/\s{2,}/g, ' ').trim();
        translated.push((t && !hasHangul(t)) ? t : (fallback || '—'));
        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
    }
    return translated.join('\n');
}

const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_HOST_ALLOWLIST = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'www.youtu.be',
]);

function extractYouTubeVideoId(input) {
    const value = String(input || '').trim();
    if (!value) return null;
    if (YOUTUBE_VIDEO_ID_PATTERN.test(value)) return value;

    let url;
    try {
        url = new URL(value);
    } catch (_) {
        return null;
    }
    const host = String(url.hostname || '').toLowerCase();
    if (!YOUTUBE_HOST_ALLOWLIST.has(host)) return null;

    let candidate = null;
    if (host.endsWith('youtu.be')) {
        candidate = url.pathname.split('/').filter(Boolean)[0] || null;
    } else if (url.pathname === '/watch') {
        candidate = url.searchParams.get('v');
    } else if (url.pathname.startsWith('/shorts/')) {
        candidate = url.pathname.split('/')[2] || null;
    } else if (url.pathname.startsWith('/embed/')) {
        candidate = url.pathname.split('/')[2] || null;
    } else if (url.pathname.startsWith('/live/')) {
        candidate = url.pathname.split('/')[2] || null;
    }

    return candidate && YOUTUBE_VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
}

function buildYouTubeWatchUrl(videoId, withEnglishCaption = false, tryAutoTranslate = false) {
    const url = new URL('https://www.youtube.com/watch');
    url.searchParams.set('v', videoId);
    if (withEnglishCaption) {
        url.searchParams.set('cc_load_policy', '1');
        url.searchParams.set('cc_lang_pref', 'en');
        url.searchParams.set('hl', 'en');
    }
    if (tryAutoTranslate) {
        // If EN track is missing, YouTube may still auto-translate when source captions exist.
        url.searchParams.set('tlang', 'en');
    }
    return url.toString();
}

function decodeXmlAttr(value) {
    return String(value || '')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function parseYouTubeEnglishCaptionInfo(captionListXml) {
    const xml = String(captionListXml || '');
    const none = { available: false, mode: null, languageCode: null, name: null };
    if (!xml.includes('<track')) return none;

    const trackRegex = /<track\b([^>]*)>/gi;
    let fallbackAuto = null;
    let match;
    while ((match = trackRegex.exec(xml))) {
        const attrs = match[1] || '';
        const languageCode = ((attrs.match(/\blang_code="([^"]+)"/i) || [])[1] || '').trim().toLowerCase();
        if (!/^en(?:[-_]|$)/i.test(languageCode)) continue;

        const kind = ((attrs.match(/\bkind="([^"]+)"/i) || [])[1] || '').trim().toLowerCase();
        const nameRaw = ((attrs.match(/\bname="([^"]*)"/i) || [])[1] || '').trim();
        const parsed = {
            available: true,
            mode: kind === 'asr' ? 'auto' : 'manual',
            languageCode,
            name: decodeXmlAttr(nameRaw) || 'English'
        };
        if (parsed.mode === 'manual') return parsed;
        fallbackAuto = parsed;
    }
    return fallbackAuto || none;
}

function extractTitleFromWatchHtml(watchHtml) {
    const html = String(watchHtml || '');
    if (!html) return '';
    try {
        const $ = cheerio.load(html);
        const title = $('title').first().text().trim();
        return title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
    } catch (_) {
        return '';
    }
}

async function fetchYouTubeVideoReadyInfo(videoInput) {
    const videoId = extractYouTubeVideoId(videoInput);
    if (!videoId) throw new Error('Please provide a valid YouTube URL or 11-character video ID.');

    const watchUrl = buildYouTubeWatchUrl(videoId, false);
    const readyUrlWithEnCaption = buildYouTubeWatchUrl(videoId, true, true);

    let title = '';
    try {
        const { data } = await axios.get('https://www.youtube.com/oembed', {
            params: { url: watchUrl, format: 'json' },
            timeout: 10_000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        title = String(data?.title || '').trim();
    } catch (_) {}

    if (!title) {
        try {
            const { data } = await axios.get(watchUrl, {
                timeout: 15_000,
                maxRedirects: 5,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept-Language': 'ko,en-US;q=0.9,en;q=0.8',
                }
            });
            title = extractTitleFromWatchHtml(data);
        } catch (_) {}
    }
    if (!title) title = `YouTube Video (${videoId})`;

    let captionInfo = { available: false, mode: null, languageCode: null, name: null };
    try {
        const { data } = await axios.get('https://www.youtube.com/api/timedtext', {
            params: { type: 'list', v: videoId },
            timeout: 10_000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        captionInfo = parseYouTubeEnglishCaptionInfo(data);
    } catch (_) {}

    const translatedTitle = await translateKoToEnLong(title);
    return {
        videoId,
        watchUrl,
        readyUrl: readyUrlWithEnCaption,
        title,
        englishTitle: translatedTitle || title,
        captionInfo,
    };
}

function buildYouTubeReadyEmbed(info) {
    const modeLabel = info.captionInfo.mode === 'manual'
        ? 'manual EN track'
        : info.captionInfo.mode === 'auto'
            ? 'auto-generated EN track'
            : null;
    const captionStatus = info.captionInfo.available
        ? `✅ English subtitle available (${modeLabel})`
        : '⚠️ English subtitle track not detected. Link will still try EN auto-translate.';
    const watchLine = info.captionInfo.available
        ? `▶️ [Open now (EN subtitle preset)](${info.readyUrl})`
        : `▶️ [Open now (EN subtitle/auto-translate attempt)](${info.readyUrl})`;

    return new EmbedBuilder()
        .setTitle('🎬 YouTube Quick Watch')
        .setDescription([
            `**Original title**\n${String(info.title || '').slice(0, 500)}`,
            '',
            `**English title**\n${String(info.englishTitle || '').slice(0, 500)}`,
            '',
            captionStatus,
            watchLine,
        ].join('\n').slice(0, 4096))
        .setColor(info.captionInfo.available ? 0x22c55e : 0xf59e0b)
        .setFooter({ text: 'Use /youtube_ready or !yt <youtube-url>' })
        .setTimestamp();
}

function buildYouTubeReadyCardMessage(info) {
    const modeLabel = info.captionInfo.available
        ? (info.captionInfo.mode === 'manual' ? 'EN subtitle preset' : 'EN auto subtitle preset')
        : 'EN subtitle/auto-translate attempt';
    const originalTitle = String(info.title || '').trim().slice(0, 160);
    const englishTitle = String(info.englishTitle || info.title || '').trim().slice(0, 160);
    return [
        `🎬 ${originalTitle}`,
        `🇬🇧 ${englishTitle}`,
        `▶️ ${modeLabel}`,
        info.readyUrl,
    ].join('\n');
}

function extractFirstYouTubeUrlFromText(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const match = raw.match(/https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/[^\s]+|youtu\.be\/[^\s]+)/i);
    if (!match) return null;
    return String(match[0] || '').replace(/[)\],.!?]+$/g, '');
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

const ENABLE_WELCOME_DM = String(process.env.ENABLE_WELCOME_DM || 'false').toLowerCase() === 'true';
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        ...(ENABLE_WELCOME_DM ? [GatewayIntentBits.GuildMembers] : []),
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ═══════════════════════════════════════════════════════════
// [2] 구글 시트 기록
// ═══════════════════════════════════════════════════════════
/** Region(PH/IN/NP/CH/TW) → 타임존 & 시트 범위 */
const REGION_CONFIGS = [
    { value: 'ph', code: 'PH', label: 'Philippines', timeZone: 'Asia/Manila', emoji: '🇵🇭', aliases: ['philippines'] },
    // Legacy compatibility: old "id/indonesia" values are mapped to IN.
    { value: 'in', code: 'IN', label: 'India', timeZone: 'Asia/Kolkata', emoji: '🇮🇳', aliases: ['india', 'id', 'indonesia'] },
    { value: 'np', code: 'NP', label: 'Nepal', timeZone: 'Asia/Kathmandu', emoji: '🇳🇵', aliases: ['nepal'] },
    { value: 'ch', code: 'CH', label: 'China', timeZone: 'Asia/Shanghai', emoji: '🇨🇳', aliases: ['china'] },
    { value: 'tw', code: 'TW', label: 'Taiwan', timeZone: 'Asia/Taipei', emoji: '🇹🇼', aliases: ['taiwan'] },
];
const SUPPORTED_REGION_CODES = REGION_CONFIGS.map(r => r.code).join('/');
const MEMBER_ORGANIZED_HEADERS = ['Country', 'User ID', 'Discord Tag', 'Display Name', 'Role', 'Joined At', 'Character Name', 'Source Sheet', 'Refreshed At'];
const REGION_LOOKUP = new Map();
for (const region of REGION_CONFIGS) {
    for (const key of [region.value, region.code.toLowerCase(), ...(region.aliases || [])]) {
        REGION_LOOKUP.set(String(key || '').toLowerCase(), region);
    }
}

function getRegionConfig(regionInput) {
    const region = REGION_LOOKUP.get(String(regionInput || '').trim().toLowerCase());
    if (!region) return null;
    return {
        ...region,
        sheetRange: `Daily_Log_${region.code}!A:G`,
        salarySheetRange: `Salary_Log_${region.code}!A:D`,
        memberSheetRange: `Member_List_${region.code}!A:G`,
    };
}

function getRegionChoices() {
    return REGION_CONFIGS.map(region => ({ name: `${region.label} (${region.code})`, value: region.value }));
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegramNotification(text) {
    const token = CONFIG.TELEGRAM_BOT_TOKEN;
    const chatId = CONFIG.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        }, { timeout: 5000 });
    } catch (err) {
        console.warn('[telegram] send failed:', err.message);
    }
}

function makeLocalTimestamp(timeZone) {
    return new Date().toLocaleString('sv-SE', { timeZone }).slice(0, 16);
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

async function readSheetRows(range) {
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
        return { ok: true, values: data.values || [] };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function updateSheetRows(range, values) {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: CONFIG.CREDENTIALS_PATH,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.update({
            spreadsheetId: CONFIG.SHEET_ID,
            range,
            valueInputOption: 'USER_ENTERED',
            resource: { values },
        });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function clearSheetRows(range) {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: CONFIG.CREDENTIALS_PATH,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.clear({
            spreadsheetId: CONFIG.SHEET_ID,
            range,
        });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function updateMemberListCharacterName(regionCode, userId, characterName) {
    const range = `Member_List_${regionCode}!A2:G`;
    const read = await readSheetRows(range);
    if (!read.ok) return { ok: false, error: read.error };
    const uid = String(userId || '').trim();
    const rowIndex = read.values.findIndex(row => String(row[0] || '').trim() === uid);
    if (rowIndex < 0) return { ok: false, found: false };
    const sheetRow = rowIndex + 2;
    const updateRange = `Member_List_${regionCode}!G${sheetRow}`;
    const up = await updateSheetRows(updateRange, [[String(characterName || '').trim()]]);
    return up.ok ? { ok: true, found: true } : { ok: false, error: up.error };
}

function buildJoinCountrySelectRow() {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('select_join_country')
        .setPlaceholder('Select your country')
        .addOptions(
            REGION_CONFIGS.map(region => ({
                label: `${region.label} (${region.code})`,
                value: region.value,
                emoji: region.emoji,
                description: `Register as ${region.label} member`,
            }))
        );
    return new ActionRowBuilder().addComponents(menu);
}

function buildGuideEmbedsKo() {
    const e1 = new EmbedBuilder()
        .setTitle('📖 TETRA Sync 사용법 가이드 (한글)')
        .setDescription('TETRA Sync 봇의 모든 기능을 한글로 상세 설명합니다.\n_※ Admin 전용 가이드 (Manage Server 권한 필요)_')
        .setColor(0x5865F2)
        .addFields(
            {
                name: '📌 패널 게시 (모든 타입)',
                value: '**`/panel type:<종류>`** — 아래 패널을 채널에 게시 (Admin)\n• `report` 일일 리포트 | `salary` 급여 | `join_verify` 가입 인증 | `payment` 입금 | `youtube` 정보 유튜브 | `link` 링크 요약·번역\n• `guide_ko` 전체 가이드(한글) | `guide_en` 전체 가이드(영어)\n• `guidebook_plaync` 공식 가이드북 | `tactics` 던전/펫 가이드',
                inline: false
            },
            {
                name: '📣 시작 순서 (신규 멤버)',
                value: '**1) Announcements 확인** → 공지 채널 최신 안내 확인\n**2) Join Verification** → `/join_verify` 로 가입 절차 진행\n**3) /help 확인** → `/help` 로 전체 명령어 빠르게 확인',
                inline: false
            },
            {
                name: '📋 1. 일일 리포트',
                value: '**`/report_kinah region:<지역> phase:start|end`** — 키나팀 시작/종료 보고\n**`/report_levelup region:<지역> phase:start|end`** — 레벨업팀 시작/종료 보고',
                inline: false
            },
            {
                name: '💰 2. 급여 확정',
                value: '**`/salary_confirm region:<지역>`** — 1클릭 급여 수령 확인',
                inline: false
            },
            {
                name: '✅ 3. 가입 인증',
                value: '**`/join_verify`** — 국가 선택 → Role 입력 (캐릭터 검증 없음)\n**`/myinfo_register character_name:<이름>`** — 스크린샷 업로드 → 스태프 Approve 시 회원목록정리에 **검증된** 캐릭터명 반영\n**`/panel type:join_verify`** — 가입 인증 패널 게시 (Admin)\n**`/verify_channel_set category:<카테고리>`** — 인증 채널 생성 위치 (Admin)',
                inline: false
            },
            {
                name: '💎 4. 입금 확인',
                value: '**`/panel type:payment`** — Submit Payment → 통화 선택(KRW/USD/PHP 등) → 금액·사유 입력 → Payment Log 시트 저장',
                inline: false
            },
            {
                name: '🎬 5. 정보 유튜브',
                value: '**`/panel type:youtube`** — Add Video로 URL 추가\n**`/youtube_ready video:<URL> post_card:true/false`** — 링크 생성 (KO→EN 제목, EN 자막)',
                inline: false
            },
            {
                name: '📰 6. 링크 요약·번역',
                value: '**`!link <url>`** — 기사 링크 요약·영문 번역·썸네일\n**`/panel type:link`** — Add Link 버튼 패널 (Admin)\n**`/link_channel_set category:<카테고리>`** — TACTICS 카테고리(dungeon, pet, class 등) 지정, parent로 Discord 카테고리 선택 (생략→현재 채널)\n지원: inven.co.kr/board/aion2/*, inven.co.kr/webzine/news/*',
                inline: false
            }
        )
        .setTimestamp();
    const e2 = new EmbedBuilder()
        .setTitle('⚔️ 7. 필드 보스 & MVP (Admin)')
        .setColor(0xef4444)
        .addFields(
            {
                name: '보스 설정·조회',
                value: '**`/preset mode:elyos|asmodian|combined`** — 보스 프리셋 적용\n**`/boss_fetch url:<JSON_URL> mode:elyos|asmodian|combined`** — URL에서 보스 목록 가져오기 (한글→영어 번역)\n**`/preset`** — 현재 보스 목록\n**`/boss`** — 보드 전체\n**`/boss boss_name:<이름>`** — 특정 보스 (자동완성)',
                inline: false
            },
            {
                name: '처치·관리',
                value: '**`/cut boss_name:<이름> killed_at:HH:mm`** — 처치 기록\n**`/server_open open_time:HH:mm`** — 전체 리셋\n**`/boss_add boss_name:<> respawn_minutes:<>`** — 커스텀 보스 추가\n**`/boss_remove boss_name:<>`** — 보스 제거',
                inline: false
            },
            {
                name: '알림·MVP',
                value: '**`/boss_alert_mode mode:channel|dm`** — 채널/DM 알림\n**`/boss_event_multiplier multiplier:0.1~2`** — 리스폰 배율\n**`/mvp`** — MVP 스케줄 조회\n**`/mvp_set day:Sunday time:20:00`** — 요일별 MVP 시간 설정',
                inline: false
            }
        )
        .setTimestamp();
    const e3 = new EmbedBuilder()
        .setTitle('📊 8. 키나 시세')
        .setColor(0x22c55e)
        .addFields(
            {
                name: '프리셋 설정',
                value: '**`/kinah_watch_preset preset:itembay_aion2|itemmania_aion2|dual_market_aion2`** — 채널, poll_minutes, mention_role (Admin)',
                inline: false
            },
            {
                name: '커스텀·조회',
                value: '**`/kinah_watch_set channel:<> source_url:<>`** — selector, value_regex, poll_minutes 선택 (Admin)\n**`/kinah_watch_now public_post:true/false`** — 즉시 조회\n**`/kinah_watch_status`** — 상태\n**`/kinah_watch_stop`** — 중지 (Admin)',
                inline: false
            }
        )
        .setTimestamp();
    const e4 = new EmbedBuilder()
        .setTitle('🔍 9. AION2 검색 (한/영 → 결과 영어)')
        .setColor(0x3b82f6)
        .addFields(
            {
                name: '캐릭터·아이템·빌드',
                value: '**`/character`** **`/item`** **`/collection`** **`/build`** — 검색 결과 본인만 보임 (ephemeral)\n**`!char <캐릭터명>`** — 결과 DM 전송',
                inline: false
            },
            {
                name: 'AON 번역',
                value: '**`/aon_translate_set category:notice|update|event channel:<> enabled:true/false`** — 한국어→영어 라우트 (Admin)\n**`/aon_translate_source bot_id:<>`** — 소스 봇 ID (Admin)\n**`/aon_translate_status`** — 설정 확인',
                inline: false
            }
        )
        .setTimestamp();
    const e5 = new EmbedBuilder()
        .setTitle('📖 10. TACTICS & 공식 가이드북')
        .setColor(0x8b5cf6)
        .addFields(
            {
                name: '던전/펫 가이드',
                value: '**`/tactics`** — 던전/펫 가이드 (인벤 번역, 기본 나만보기)\n**`/tactics public:true`** — 관리자만, 채널 전체 공개\n**패널** `tactics`: 버튼 클릭 → 카테고리·가이드 선택',
                inline: false
            },
            {
                name: '공식 가이드북',
                value: '**`/guidebook`** — PlayNC 공식 가이드북 (기본 나만보기)\n**`/guidebook public:true`** — 관리자만, 채널에 전체 공개\n**`/guidebook_fetch`** — 가이드북 갱신 (Admin, 2–5분)\n스크랩 실패/빈 데이터 시: **로컬 fallback(하이브리드)** 자동 로드',
                inline: false
            },
            {
                name: '환영/공지 설정',
                value: '**`/welcome_set announcements_channel:<채널> welcome_channel:<채널>`** — 환영 채널 + 공지 안내 채널 설정 (Admin)\n**`/welcome_send user:<유저>`** — 수동 환영 메시지 전송',
                inline: false
            },
            {
                name: '회원목록·프리픽스',
                value: '**`/member_list_organize`** — Member_List_* → 회원목록정리 시트 재구성 (Admin)\n**`/myinfo_register`** Approve 시 캐릭터명이 회원목록정리 G열에 반영\n**`!char <캐릭터명>`** — 캐릭터 검색 결과 DM 전송',
                inline: false
            }
        )
        .setFooter({ text: 'TETRA Sync | 문의: 관리자' })
        .setTimestamp();
    return [e1, e2, e3, e4, e5];
}

function buildGuideEmbedsEn() {
    const e1 = new EmbedBuilder()
        .setTitle('📖 TETRA Sync Usage Guide (English)')
        .setDescription('Complete guide to all TETRA Sync bot features.\n_※ Admin only (Manage Server required)_')
        .setColor(0x5865F2)
        .addFields(
            {
                name: '📌 Panel Types',
                value: '**`/panel type:<type>`** — Post a panel to this channel (Admin)\n• `report` Daily report | `salary` Salary | `join_verify` Join | `payment` Payment | `youtube` Info YouTube | `link` Link summarize & translate\n• `guide_ko` Full guide (KR) | `guide_en` Full guide (EN)\n• `guidebook_plaync` Official Guidebook | `tactics` Dungeon & Pet guides',
                inline: false
            },
            {
                name: '📣 Onboarding Order (New Members)',
                value: '**1) Announcements** — Check latest notices in your announcement channel\n**2) Join Verification** — Run `/join_verify` to start registration\n**3) /help** — Run `/help` for quick command overview',
                inline: false
            },
            {
                name: '📋 1. Daily Report',
                value: '**`/report_kinah region:<region> phase:start|end`** — Kinah team start/end report\n**`/report_levelup region:<region> phase:start|end`** — Level-Up team start/end report',
                inline: false
            },
            {
                name: '💰 2. Salary Confirmation',
                value: '**`/salary_confirm region:<region>`** — 1-click salary receipt confirmation',
                inline: false
            },
            {
                name: '✅ 3. Join Verification',
                value: '**`/join_verify`** — Country selection → Role (no character verification)\n**`/myinfo_register character_name:<name>`** — Upload screenshot → staff Approve → **verified** character name added to member list\n**`/panel type:join_verify`** — Post join verification panel (Admin)\n**`/verify_channel_set category:<cat>`** — Where verification channels are created (Admin)',
                inline: false
            },
            {
                name: '💎 4. Payment Confirmation',
                value: '**`/panel type:payment`** — Submit Payment → select currency (KRW/USD/PHP...) → amount & reason → Payment Log sheet',
                inline: false
            },
            {
                name: '🎬 5. Info YouTube',
                value: '**`/panel type:youtube`** — Add Video to add URLs\n**`/youtube_ready video:<URL> post_card:true/false`** — Generate link (KO→EN title, EN subtitle)',
                inline: false
            },
            {
                name: '📰 6. Link (Summarize & Translate)',
                value: '**`!link <url>`** — Summarize, translate to EN, attach thumbnail\n**`/panel type:link`** — Add Link button panel (Admin)\n**`/link_channel_set category:<tactics>`** — TACTICS category (dungeon, pet, class…), parent=Discord category. Omit → current channel\nSupported: inven.co.kr/board/aion2/*, inven.co.kr/webzine/news/*',
                inline: false
            }
        )
        .setTimestamp();
    const e2 = new EmbedBuilder()
        .setTitle('⚔️ 7. Field Boss & MVP (Admin)')
        .setColor(0xef4444)
        .addFields(
            {
                name: 'Boss Setup & View',
                value: '**`/preset mode:elyos|asmodian|combined`** — Apply boss preset\n**`/boss_fetch url:<JSON_URL> mode:elyos|asmodian|combined`** — Fetch boss list from URL (KO→EN)\n**`/preset`** — Current boss list\n**`/boss`** — Full board\n**`/boss boss_name:<name>`** — Specific boss (autocomplete)',
                inline: false
            },
            {
                name: 'Kill & Management',
                value: '**`/cut boss_name:<name> killed_at:HH:mm`** — Record kill\n**`/server_open open_time:HH:mm`** — Reset all\n**`/boss_add boss_name:<> respawn_minutes:<>`** — Add custom boss\n**`/boss_remove boss_name:<>`** — Remove boss',
                inline: false
            },
            {
                name: 'Alerts & MVP',
                value: '**`/boss_alert_mode mode:channel|dm`** — Channel or DM alerts\n**`/boss_event_multiplier multiplier:0.1~2`** — Respawn multiplier\n**`/mvp`** — View MVP schedule\n**`/mvp_set day:Sunday time:20:00`** — Set MVP time per day',
                inline: false
            }
        )
        .setTimestamp();
    const e3 = new EmbedBuilder()
        .setTitle('📊 8. Kinah Rate')
        .setColor(0x22c55e)
        .addFields(
            {
                name: 'Preset',
                value: '**`/kinah_watch_preset preset:itembay_aion2|itemmania_aion2|dual_market_aion2`** — Channel, poll_minutes, mention_role (Admin)',
                inline: false
            },
            {
                name: 'Custom & Fetch',
                value: '**`/kinah_watch_set channel:<> source_url:<>`** — selector, value_regex, poll_minutes optional (Admin)\n**`/kinah_watch_now public_post:true/false`** — Fetch now\n**`/kinah_watch_status`** — Status\n**`/kinah_watch_stop`** — Stop (Admin)',
                inline: false
            }
        )
        .setTimestamp();
    const e4 = new EmbedBuilder()
        .setTitle('🔍 9. AION2 Search (EN/KR → EN results)')
        .setColor(0x3b82f6)
        .addFields(
            {
                name: 'Character · Item · Build',
                value: '**`/character`** **`/item`** **`/collection`** **`/build`** — Results visible only to you (ephemeral)\n**`!char <name>`** — Results sent via DM',
                inline: false
            },
            {
                name: 'AON Translation',
                value: '**`/aon_translate_set category:notice|update|event channel:<> enabled:true/false`** — KO→EN route (Admin)\n**`/aon_translate_source bot_id:<>`** — Source bot ID (Admin)\n**`/aon_translate_status`** — Config',
                inline: false
            }
        )
        .setTimestamp();
    const e5 = new EmbedBuilder()
        .setTitle('📖 10. TACTICS & Official Guidebook')
        .setColor(0x8b5cf6)
        .addFields(
            {
                name: 'Dungeon & Pet Guides',
                value: '**`/tactics`** — Dungeon & pet guides (Inven translated, default ephemeral)\n**`/tactics public:true`** — Admin only, post selected guide to channel\n**Panel** `tactics`: Click button → select category & guide',
                inline: false
            },
            {
                name: 'Official Guidebook',
                value: '**`/guidebook`** — PlayNC official guidebook (default ephemeral)\n**`/guidebook public:true`** — Admin only, post to channel (everyone sees)\n**`/guidebook_fetch`** — Refresh guidebook (Admin, 2–5 min)\nIf scrape fails or returns empty: **local fallback (hybrid)** loads automatically',
                inline: false
            },
            {
                name: 'Welcome & Announcements Setup',
                value: '**`/welcome_set announcements_channel:<channel> welcome_channel:<channel>`** — Configure onboarding channels (Admin)\n**`/welcome_send user:<user>`** — Send welcome message manually',
                inline: false
            },
            {
                name: 'Member List · Prefix',
                value: '**`/member_list_organize`** — Rebuild member list from Member_List_* (Admin)\n**`/myinfo_register`** Approve adds character name to member list column G\n**`!char <name>`** — Character search results sent via DM',
                inline: false
            }
        )
        .setFooter({ text: 'TETRA Sync | Contact: Admin' })
        .setTimestamp();
    return [e1, e2, e3, e4, e5];
}

function buildGuideEmbedsUser() {
    const e1 = new EmbedBuilder()
        .setTitle('👤 TETRA Sync — Member Guide (English)')
        .setDescription('Commands you can use without Manage Server permission.\n_※ Shown only to you (ephemeral)_')
        .setColor(0x22c55e)
        .addFields(
            {
                name: '📣 Start Here',
                value: '**1) Announcements** — Read latest server notices\n**2) Join Verification** — Run `/join_verify`\n**3) /help** — Run `/help` for quick command overview',
                inline: false
            },
            {
                name: '📋 Daily Report',
                value: '**`/report_kinah region:<region> phase:start|end`** — Kinah team start/end (End includes spent kinah)\n**`/report_levelup region:<region> phase:start|end`** — Level-Up team start/end (Level & CP gains)\n_Or use the Daily Report panel Submit button if posted by staff._',
                inline: false
            },
            {
                name: '💰 Salary',
                value: '**`/salary_confirm region:<region>`** — 1-click salary receipt confirmation\n_Or use the Salary panel region buttons if posted._',
                inline: false
            },
            {
                name: '✅ Join Verification',
                value: '**`/join_verify`** — Country selection → Role (quick signup, no verification)\n**`/myinfo_register character_name:<name>`** — Screenshot required → staff Approve → **verified** character name added to member list',
                inline: false
            },
            {
                name: '💎 Payment Confirmation',
                value: '_Click **Submit Payment** on the Payment panel (if posted) → select currency → enter amount & reason._',
                inline: false
            }
        )
        .setTimestamp();
    const e2 = new EmbedBuilder()
        .setTitle('⚔️ Field Boss')
        .setColor(0xef4444)
        .addFields(
            {
                name: 'View',
                value: '**`/preset`** — Current boss list\n**`/boss`** — Full boss board\n**`/boss boss_name:<name>`** — Specific boss status',
                inline: false
            },
            {
                name: 'Record Kill',
                value: '**`/cut boss_name:<name>`** — Record kill time (uses current time)\n**`/cut boss_name:<name> killed_at:14:30`** — Record with custom time',
                inline: false
            },
            {
                name: 'Alerts',
                value: '**`/boss_alert_mode mode:channel|dm`** — Choose to receive alerts in channel or DM',
                inline: false
            }
        )
        .setTimestamp();
    const e3 = new EmbedBuilder()
        .setTitle('📊 Kinah & Search')
        .setColor(0x3b82f6)
        .addFields(
            {
                name: 'Kinah Rate',
                value: '**`/kinah_watch_now`** — Fetch current kinah rate\n**`/kinah_watch_status`** — View kinah config & last value',
                inline: false
            },
            {
                name: 'AION2 Search (EN/KR → EN results)',
                value: '**`/character`** **`/item`** **`/collection`** **`/build`** — Results visible only to you (ephemeral)\n**`!char <name>`** — Results sent to your DM\n_Channel stays clean_',
                inline: false
            },
            {
                name: 'Link & YouTube',
                value: '**`!link <url>`** — Summarize & translate article (inven.co.kr)\n**`/youtube_ready video:<URL>`** — EN subtitle link for Korean videos\n**`/aon_translate_status`** — View translation routes',
                inline: false
            }
        )
        .setTimestamp();
    const e4 = new EmbedBuilder()
        .setTitle('📖 TACTICS & Guidebook')
        .setColor(0x8b5cf6)
        .addFields(
            {
                name: 'Daily/Weekly Checklist',
                value: '**`/homework`** — Daily & Weekly task summary (Mission Quests, Entrance Tickets, Abyss, etc.)',
                inline: false
            },
            {
                name: 'Dungeon & Pet Guides',
                value: '**`/tactics`** — Inven AION2 dungeon & pet guides (ephemeral, only you)\n_Or click **Open Tactics Guide** on the panel if posted._\n(Admin can post publicly with `/tactics public:true`.)',
                inline: false
            },
            {
                name: 'Official Guidebook',
                value: '**`/guidebook`** — PlayNC official guidebook (ephemeral)\n_Or click **Open Guidebook** on the panel. Admin can use **Post to Channel** or `/guidebook public:true` to share publicly._',
                inline: false
            }
        )
        .setTimestamp();
    const e5 = new EmbedBuilder()
        .setTitle('🔧 Prefix Command')
        .setColor(0x94a3b8)
        .addFields(
            {
                name: '!char',
                value: '**`!char <character name>`** — Same as `/character`, results sent to your DM (channel stays clean)',
                inline: false
            }
        )
        .addFields({
                name: 'View this guide',
                value: '**`/guide`** — View this member guide (shown only to you, ephemeral)',
                inline: false
            })
        .setFooter({ text: 'TETRA Sync | Member Guide (All members)' })
        .setTimestamp();
    return [e1, e2, e3, e4, e5];
}

function buildFaqAdminEmbed(lang = 'en') {
    if (lang === 'ko') {
        return new EmbedBuilder()
            .setTitle('❓ FAQ (관리자)')
            .setDescription('서버 관리자용 자주 묻는 질문.')
            .setColor(0xf59e0b)
            .addFields(
                { name: 'Q: 패널은 어떻게 게시하나요?', value: '**`/panel type:<종류>`** — report, salary, join_verify, payment, youtube, **link**, guide_ko, guide_en, **guidebook_plaync**, **tactics**. 채널에서 실행하면 해당 패널 게시. 종류별 1개.', inline: false },
                { name: 'Q: TACTICS와 가이드북 차이?', value: '**TACTICS** — 인벤 던전/펫 가이드. **가이드북** — PlayNC 공식 (클래스·스킬).\n둘 다 기본은 나만보기.\n**관리자 공개:** `/tactics public:true`, `/guidebook public:true` 또는 패널 Post to Channel.\n**가이드북:** `/guidebook_fetch` 갱신, 실패/빈 데이터 시 로컬 fallback 자동 사용.', inline: false },
                { name: 'Q: 신규 멤버 안내 순서는?', value: '**Announcements 확인** → **`/join_verify`** 가입 진행 → **`/help`**로 명령어 확인.\n환영 문구 채널/공지 채널은 **`/welcome_set announcements_channel:<채널> welcome_channel:<채널>`**로 설정.', inline: false },
                { name: 'Q: 전체 가이드 vs 멤버 가이드?', value: '**전체 가이드** (`/panel type:guide_ko`, `guide_en`) — Admin 전체 명령어, 채널에 게시\n**멤버 가이드** (`/guide`) — 멤버용 명령어, 나만보기', inline: false },
                { name: 'Q: 필드 보스 타이머 설정 순서?', value: '1. **`/preset mode:combined`** 또는 **`/boss_fetch`** (URL에서 로드)\n2. 처치 시: **`/cut boss_name:<이름>`**로 기록\n3. **`/boss_alert_mode mode:dm`** — DM 알림 (선택)\n4. **`/boss_event_multiplier multiplier:0.8`** — 이벤트 리스폰 배율 (선택)', inline: false },
                { name: 'Q: MVP 스케줄 설정?', value: '**`/mvp_set day:<요일> time:HH:mm`** — 요일별 MVP 시간 (Admin)\n**`/mvp`** — 현재 스케줄 조회 (Admin)', inline: false },
                { name: 'Q: 키나 시세 모니터링 설정?', value: '**`/kinah_watch_preset`** — ItemBay/ItemMania 프리셋. channel, poll_minutes, mention_role 설정. **`/kinah_watch_status`**로 확인, **`/kinah_watch_stop`**으로 중지.', inline: false },
                { name: 'Q: AON 한→영 번역?', value: '**`/aon_translate_set`** — category(notice/update/event), channel 설정. **`/aon_translate_source`** — AON 봇 ID. **`/aon_translate_status`**로 라우트 확인.', inline: false },
                { name: 'Q: 캐릭터 검증 설정?', value: '**`/join_verify`** — Role만. **`/myinfo_register`**로 캐릭터명 추가 (스크린샷 필수)\n1. Admin: **`/verify_channel_set category:<카테고리>`**\n2. 사용자: **`/myinfo_register character_name:<이름>`** → 스크린샷 업로드\n3. 스태프: Approve → 지역 선택 → 회원목록 G열 반영', inline: false },
                { name: 'Q: 입금 통화 선택?', value: '**Submit Payment** → 통화 선택 (KRW, USD, PHP, INR, NPR, CNY, TWD) → 금액·사유 입력. Payment Log 시트: A:G (날짜, 유형, 태그, 금액, **통화**, 사유, 상태)', inline: false },
                { name: 'Q: 검색·가이드 결과는 누가 보나요?', value: '**`/character`** **`/item`** **`/collection`** **`/build`** — 나만 (ephemeral)\n**`!char <이름>`** — 결과 DM 전송\n**`/guide`** **`/tactics`** **`/guidebook`** — 기본 나만 (ephemeral)\n**관리자 공개:** `/tactics public:true`, `/guidebook public:true`', inline: false },
                { name: 'Q: 권한 오류?', value: '봇에 **Manage Messages**, **Send Messages**, **Embed Links**, **Read Message History**, **Manage Channels**(인증 채널용) 권한이 있는지 확인하세요.', inline: false }
            )
            .setFooter({ text: 'TETRA Sync | 관리자 FAQ' })
            .setTimestamp();
    }
    return new EmbedBuilder()
        .setTitle('❓ FAQ (Admin)')
        .setDescription('Frequently asked questions for server admins.')
        .setColor(0xf59e0b)
        .addFields(
            { name: 'Q: How do I post panels?', value: '**`/panel type:<type>`** — report, salary, join_verify, payment, youtube, **link**, guide_ko, guide_en, **guidebook_plaync**, **tactics**. Run in a channel to post. One panel per type.', inline: false },
            { name: 'Q: TACTICS vs Guidebook?', value: '**TACTICS** — Inven dungeon/pet guides. **Guidebook** — PlayNC official (class, skill).\nBoth are ephemeral by default.\n**Admin public share:** `/tactics public:true`, `/guidebook public:true`, or panel Post to Channel.\n**Guidebook:** run **`/guidebook_fetch`**; if scrape fails/empty, local fallback loads automatically.', inline: false },
            { name: 'Q: What is the onboarding order for new members?', value: '**Announcements** → **`/join_verify`** → **`/help`**.\nSet channels with **`/welcome_set announcements_channel:<channel> welcome_channel:<channel>`**.', inline: false },
            { name: 'Q: Full guide vs member guide?', value: '**Full guide** (`/panel type:guide_ko`, `guide_en`) — Admin commands, post to channel\n**Member guide** (`/guide`) — Member commands, visible only to you', inline: false },
            { name: 'Q: Field boss timer setup order?', value: '1. **`/preset mode:combined`** or **`/boss_fetch`** (load from URL)\n2. On kill: **`/cut boss_name:<name>`** to record\n3. **`/boss_alert_mode mode:dm`** — DM alerts (optional)\n4. **`/boss_event_multiplier multiplier:0.8`** — Event respawn rate (optional)', inline: false },
            { name: 'Q: How to set MVP schedule?', value: '**`/mvp_set day:<day> time:HH:mm`** — Set MVP time per day (Admin)\n**`/mvp`** — View current schedule (Admin)', inline: false },
            { name: 'Q: Kinah rate monitoring setup?', value: '**`/kinah_watch_preset`** — ItemBay/ItemMania preset for quick setup. Set channel, poll_minutes, mention_role. **`/kinah_watch_status`** to check, **`/kinah_watch_stop`** to stop.', inline: false },
            { name: 'Q: AON Korean→English translation?', value: '**`/aon_translate_set`** — Set category(notice/update/event), channel. **`/aon_translate_source`** — AON bot ID. **`/aon_translate_status`** to view routes.', inline: false },
            { name: 'Q: Character verification setup?', value: '**`/join_verify`** — Role only. **`/myinfo_register`** adds character (screenshot required)\n1. Admin: **`/verify_channel_set category:<category>`**\n2. User: **`/myinfo_register character_name:<name>`** → Upload screenshot\n3. Staff: Approve → Select region → Column G', inline: false },
            { name: 'Q: How to select payment currency?', value: '**Submit Payment** → Select currency (KRW, USD, PHP, INR, NPR, CNY, TWD) → Enter amount & reason. Payment Log sheet: A:G (Date, Type, Tag, Amount, **Currency**, Reason, Status)', inline: false },
            { name: 'Q: Who sees search results & guides?', value: '**`/character`** **`/item`** **`/collection`** **`/build`** — Only you (ephemeral)\n**`!char <name>`** — Results sent via DM\n**`/guide`** **`/tactics`** **`/guidebook`** — Default only you (ephemeral)\n**Admin public:** `/tactics public:true`, `/guidebook public:true`', inline: false },
            { name: 'Q: Permission errors?', value: 'Ensure the bot has **Manage Messages**, **Send Messages**, **Embed Links**, **Read Message History**, **Manage Channels** (for verification channels).', inline: false }
        )
        .setFooter({ text: 'TETRA Sync | Admin FAQ' })
        .setTimestamp();
}

function buildJoinVerifyPanelPayload() {
    const embed = new EmbedBuilder()
        .setTitle('✅ Join Verification')
        .setDescription([
            '**Step 1 — Join Verification:** Choose your country and submit your basic info.',
            '**Step 2 — Character Verification:** Register your AION2 character with screenshot (staff approval required).',
            '',
            `Supported regions: ${SUPPORTED_REGION_CODES}`,
        ].join('\n'))
        .setColor(0x22c55e);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_join_verify_open')
            .setLabel('1. Join Verification')
            .setEmoji('🌍')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('btn_char_verify_open')
            .setLabel('2. Character Verification')
            .setEmoji('🎮')
            .setStyle(ButtonStyle.Primary)
    );
    return { embeds: [embed], components: [row] };
}

function isJoinVerifyPanelMessage(message) {
    if (!message || message.author?.id !== client.user?.id) return false;
    const hasTitle = Boolean(message.embeds?.[0]?.title?.includes('Join Verification'));
    const hasButton = Boolean(
        message.components?.some(row =>
            row.components?.some(c => c.customId === 'btn_join_verify_open' || c.customId === 'btn_char_verify_open')
        )
    );
    return hasTitle || hasButton;
}

function createCharVerifyModal() {
    return new ModalBuilder()
        .setCustomId('modal_char_verify')
        .setTitle('Character Verification')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('character_name')
                    .setLabel('AION2 Character Name (screenshot upload in channel after submit)')
                    .setPlaceholder('e.g. YourCharacterName')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );
}

async function upsertJoinVerifyPanel(channel) {
    try {
        let panels;
        try {
            panels = (await channel.messages.fetch({ limit: 100 })).filter(isJoinVerifyPanelMessage);
        } catch (e) {
            console.warn('[join_verify] messages.fetch failed:', e.message);
            panels = { values: () => [] };
        }
        for (const msg of panels.values()) await msg.delete().catch(() => {});
        const sent = await channel.send(buildJoinVerifyPanelPayload());
        try {
            panels = (await channel.messages.fetch({ limit: 100 })).filter(isJoinVerifyPanelMessage);
        } catch (_) {}
        if (panels?.values) {
            for (const msg of panels.values()) {
                if (msg.id !== sent.id) await msg.delete().catch(() => {});
            }
        }
        return sent;
    } catch (err) {
        console.error('[join_verify] upsert failed:', err);
        throw err;
    }
}

function buildVerifyApproveRegionSelect(channelId) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`select_verify_approve_region_${channelId}`)
        .setPlaceholder('Select region')
        .addOptions(
            REGION_CONFIGS.map(region => ({
                label: `${region.label} (${region.code})`,
                value: region.value,
                emoji: region.emoji,
            }))
        );
    return new ActionRowBuilder().addComponents(menu);
}

function createJoinVerifyModal(region) {
    const cfg = getRegionConfig(region);
    const label = cfg ? `${cfg.label} (${cfg.code})` : String(region || '').toUpperCase();
    return new ModalBuilder()
        .setCustomId(`modal_join_verify_${region}`)
        .setTitle(`Join Verification - ${label}`)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('role_note')
                    .setLabel('Role/Note')
                    .setPlaceholder('Optional')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            ),
        );
}

function parseRegionFromCustomId(customId, prefix) {
    const pattern = new RegExp(`^${prefix}_([a-z]{2})$`, 'i');
    const match = String(customId || '').match(pattern);
    return match ? match[1].toLowerCase() : null;
}

function getDiscordTag(user) {
    if (!user) return 'Unknown';
    if (user.tag) return user.tag;
    return user.discriminator && user.discriminator !== '0' ? `${user.username}#${user.discriminator}` : user.username;
}

async function appendMemberListRecord(interaction, regionCfg, roleNote, characterName = '') {
    const member = interaction.member;
    const displayName = String(member?.displayName || interaction.user.globalName || interaction.user.username || 'Unknown').trim();
    const autoRoleSummary = member?.roles?.cache
        ? Array.from(member.roles.cache.values())
            .filter(role => role.name !== '@everyone')
            .map(role => role.name)
            .slice(0, 3)
            .join(', ')
        : '';
    const roleSummary = String(roleNote || '').trim() || autoRoleSummary || 'N/A';
    const joinedAt = makeLocalTimestamp(regionCfg.timeZone);
    const charName = String(characterName || '').trim();
    const row = [
        interaction.user.id,
        getDiscordTag(interaction.user),
        displayName,
        regionCfg.code,
        roleSummary,
        joinedAt,
        charName,
    ];
    return appendToSheet(regionCfg.memberSheetRange, row);
}

async function rebuildMemberOrganizedSheet() {
    const merged = [];
    for (const region of REGION_CONFIGS) {
        const sourceSheetName = `Member_List_${region.code}`;
        const sourceRange = `${sourceSheetName}!A2:G`;
        const read = await readSheetRows(sourceRange);
        if (!read.ok) continue;
        for (const row of read.values) {
            const [userId, discordTag, displayName, country, role, joinedAt, characterName] = row;
            const hasData = [userId, discordTag, displayName, country, role, joinedAt].some(v => String(v || '').trim().length > 0);
            if (!hasData) continue;
            merged.push({
                country: String(country || region.code).trim().toUpperCase(),
                userId: String(userId || '').trim(),
                discordTag: String(discordTag || '').trim(),
                displayName: String(displayName || '').trim(),
                role: String(role || '').trim(),
                joinedAt: joinedAt || '',
                characterName: String(characterName || '').trim(),
                sourceSheet: sourceSheetName,
            });
        }
    }

    const groupedMap = new Map();
    for (const item of merged) {
        const identity = item.userId || item.discordTag || item.displayName;
        if (!identity) continue;
        const key = `${item.country}|${identity}`;
        if (!groupedMap.has(key)) {
            const chars = item.characterName ? [item.characterName] : [];
            groupedMap.set(key, { ...item, characterNames: chars });
        } else {
            const entry = groupedMap.get(key);
            if (item.characterName && !entry.characterNames.includes(item.characterName)) {
                entry.characterNames.push(item.characterName);
            }
        }
    }
    const deduped = Array.from(groupedMap.values()).map(e => ({
        ...e,
        characterName: e.characterNames.length > 0 ? e.characterNames.join(', ') : (e.characterName || ''),
    })).sort((a, b) => {
        const byCountry = a.country.localeCompare(b.country);
        if (byCountry !== 0) return byCountry;
        return a.displayName.localeCompare(b.displayName);
    });
    const refreshedAt = makeLocalTimestamp('UTC');
    const values = deduped.map(item => [
        item.country,
        item.userId,
        item.discordTag,
        item.displayName,
        item.role,
        item.joinedAt,
        item.characterName || '',
        item.sourceSheet,
        refreshedAt,
    ]);

    const headerRes = await updateSheetRows('회원목록정리!A1:I1', [MEMBER_ORGANIZED_HEADERS]);
    if (!headerRes.ok) return { ok: false, error: headerRes.error };
    await clearSheetRows('회원목록정리!A2:I');
    if (values.length > 0) {
        const up = await updateSheetRows(`회원목록정리!A2:I${values.length + 1}`, values);
        if (!up.ok) return { ok: false, error: up.error };
    }
    return { ok: true, count: values.length };
}

function toDiscordTime(epochMs) {
    return `<t:${Math.floor(epochMs / 1000)}:F> (<t:${Math.floor(epochMs / 1000)}:R>)`;
}

function extractNumericTokens(text) {
    return String(text || '').match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)?.map(token => token.trim()) || [];
}

function parseNumericValue(token) {
    const value = Number.parseFloat(String(token || '').replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
}

function pickMedian(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
}

function pickTrimmedMedian(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length <= 4) return pickMedian(sorted);
    const trimCount = Math.floor(sorted.length * 0.1);
    const trimmed = trimCount > 0 && sorted.length - trimCount * 2 >= 3
        ? sorted.slice(trimCount, sorted.length - trimCount)
        : sorted;
    return pickMedian(trimmed);
}

function applyKinahStability(watch, rawNumeric) {
    const nextRaw = Number(rawNumeric);
    if (!Number.isFinite(nextRaw)) return watch.lastRate;
    const history = Array.isArray(watch.rateHistory) ? watch.rateHistory.map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0) : [];
    history.push(nextRaw);
    watch.rateHistory = history.slice(-10);
    const smoothWindow = watch.rateHistory.slice(-5);
    const stable = pickMedian(smoothWindow);
    const stableRounded = Number.isFinite(stable) ? Math.round(stable) : Math.round(nextRaw);
    watch.stableRate = stableRounded;
    return stableRounded;
}

function collectJsonNodes(value, out = []) {
    if (value == null) return out;
    if (Array.isArray(value)) {
        for (const item of value) collectJsonNodes(item, out);
        return out;
    }
    if (typeof value === 'object') {
        out.push(value);
        for (const child of Object.values(value)) {
            if (child && typeof child === 'object') collectJsonNodes(child, out);
        }
    }
    return out;
}

function parseJsonLdBlocks($) {
    const parsed = [];
    $('script[type="application/ld+json"]').each((_, element) => {
        const raw = $(element).contents().text().trim();
        if (!raw) return;
        try {
            parsed.push(JSON.parse(raw));
        } catch (_) {}
    });
    return parsed;
}

function formatKrw(value) {
    if (!Number.isFinite(value)) return 'N/A';
    return `${Math.round(value).toLocaleString()} KRW`;
}

async function fetchItembayAion2Snapshot(sourceUrl) {
    const url = sourceUrl || KINAH_PRESET_DEFAULTS.itembay_aion2.primaryUrl;
    const { data } = await axios.get(url, {
        timeout: 20_000,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'text/html,application/xhtml+xml',
        },
    });
    const $ = cheerio.load(data);
    const canonical = $('link[rel="canonical"]').attr('href') || url;
    const jsonBlocks = parseJsonLdBlocks($);
    const nodes = jsonBlocks.flatMap(block => collectJsonNodes(block));

    const aggregateOffer = nodes.find(
        node => node['@type'] === 'AggregateOffer' && parseNumericValue(node.lowPrice) != null && parseNumericValue(node.highPrice) != null
    );
    const lowPrice = aggregateOffer ? parseNumericValue(aggregateOffer.lowPrice) : null;
    const highPrice = aggregateOffer ? parseNumericValue(aggregateOffer.highPrice) : null;
    const offerCount = aggregateOffer ? parseNumericValue(aggregateOffer.offerCount) : null;

    const listItems = nodes
        .filter(node => node['@type'] === 'ListItem' && node.item)
        .map(node => node.item)
        .filter(item => /아이온2|aion2/i.test(`${item.name || ''} ${item.category || ''}`));
    const kinahItems = listItems.filter(item => /키나|kinah|게임머니|game.?money/i.test(`${item.name || ''} ${item.description || ''}`));

    const prices = (kinahItems.length ? kinahItems : listItems)
        .map(item => parseNumericValue(item?.offers?.price))
        .filter(value => value != null);
    const representative = pickTrimmedMedian(prices) ?? lowPrice ?? pickMedian(prices) ?? highPrice;
    if (!Number.isFinite(representative)) {
        throw new Error('ItemBay AION2 parser could not find numeric price.');
    }

    return {
        token: formatKrw(representative),
        numeric: Math.round(representative),
        snippet: `ItemBay low ${formatKrw(lowPrice)} / high ${formatKrw(highPrice)} / offers ${offerCount ? offerCount.toLocaleString() : 'N/A'}`,
        sourceUrl: canonical,
        sourceName: 'ItemBay AION2',
        sourceSummary: `ItemBay:${formatKrw(representative)}`,
    };
}

async function fetchItemmaniaAion2Snapshot(sourceUrl, sourceKeyword) {
    const url = sourceUrl || KINAH_PRESET_DEFAULTS.itemmania_aion2.primaryUrl;
    const { data } = await axios.get(url, {
        timeout: 20_000,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'text/html,application/xhtml+xml',
        },
    });
    const $ = cheerio.load(data);
    const bodyText = $('body').text().replace(/\r/g, '\n');
    const keyword = String(sourceKeyword || 'AION2 kinah').trim();
    const keywordLines = bodyText
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .filter(line => {
            if (!keyword) return true;
            const words = keyword.split(/\s+/).filter(Boolean);
            return words.every(word => line.toLowerCase().includes(word.toLowerCase()));
        });
    const candidateText = keywordLines.length ? keywordLines.slice(0, 100).join('\n') : bodyText;
    const candidates = extractNumericTokens(candidateText)
        .map(token => parseNumericValue(token))
        .filter(value => value != null)
        .filter(value => value >= 10 && value <= 500_000_000);
    const representative = pickTrimmedMedian(candidates) ?? pickMedian(candidates);
    if (!Number.isFinite(representative)) {
        throw new Error('ItemMania parser could not find numeric price.');
    }

    return {
        token: formatKrw(representative),
        numeric: Math.round(representative),
        snippet: `ItemMania keyword: ${keyword || 'AION2'} (${candidates.length} candidates)`,
        sourceUrl: url,
        sourceName: 'ItemMania AION2',
        sourceSummary: `ItemMania:${formatKrw(representative)}`,
    };
}

async function fetchKinahRateByPreset(watchConfig) {
    const preset = watchConfig?.sourcePreset;
    if (!KINAH_PRESET_TYPES.includes(preset)) throw new Error('Unknown kinah preset.');

    if (preset === 'itembay_aion2') {
        return fetchItembayAion2Snapshot(watchConfig?.sourceUrl || KINAH_PRESET_DEFAULTS.itembay_aion2.primaryUrl);
    }
    if (preset === 'itemmania_aion2') {
        return fetchItemmaniaAion2Snapshot(watchConfig?.sourceUrl || KINAH_PRESET_DEFAULTS.itemmania_aion2.primaryUrl, watchConfig?.sourceKeyword);
    }

    const results = await Promise.allSettled([
        fetchItembayAion2Snapshot(watchConfig?.sourceUrl || KINAH_PRESET_DEFAULTS.dual_market_aion2.primaryUrl),
        fetchItemmaniaAion2Snapshot(
            watchConfig?.secondarySourceUrl || KINAH_PRESET_DEFAULTS.dual_market_aion2.secondaryUrl,
            watchConfig?.sourceKeyword
        ),
    ]);
    const success = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (!success.length) {
        const reasons = results.filter(r => r.status === 'rejected').map(r => r.reason?.message || String(r.reason));
        throw new Error(`Dual market fetch failed: ${reasons.join(' / ')}`);
    }
    if (success.length === 1) return success[0];

    const average = success.reduce((sum, item) => sum + Number(item.numeric || 0), 0) / success.length;
    const summary = success.map(item => item.sourceSummary).join(' | ');
    return {
        token: formatKrw(average),
        numeric: Math.round(average),
        snippet: `Dual market avg from ${success.length} sources`,
        sourceUrl: success[0].sourceUrl,
        sourceName: 'Dual Market AION2',
        sourceSummary: summary,
        sourceValues: success.map(item => ({
            name: item.sourceName,
            token: item.token,
            numeric: item.numeric,
            sourceUrl: item.sourceUrl,
        })),
    };
}

function extractKinahValueFromText(text) {
    const lines = String(text || '')
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    if (!lines.length) return null;

    const keywordLines = lines.filter(line => /(kinah|키나|시세|rate|exchange|market)/i.test(line));
    const candidates = keywordLines.length ? keywordLines : lines.slice(0, 50);
    const tokens = extractNumericTokens(candidates.join('\n'));
    if (!tokens.length) return null;

    const ranked = tokens
        .map(token => ({ token, numeric: parseNumericValue(token) }))
        .filter(item => item.numeric != null)
        .sort((a, b) => b.numeric - a.numeric);
    if (!ranked.length) return null;
    return { token: ranked[0].token, numeric: ranked[0].numeric, snippet: candidates.slice(0, 3).join('\n') };
}

async function fetchKinahRateSnapshot(watchConfig) {
    const sourcePreset = String(watchConfig?.sourcePreset || '').trim();
    if (sourcePreset) return fetchKinahRateByPreset(watchConfig);

    const sourceUrl = String(watchConfig?.sourceUrl || '').trim();
    if (!sourceUrl) throw new Error('Source URL is not configured.');
    let parsedUrl;
    try {
        parsedUrl = new URL(sourceUrl);
    } catch (_) {
        throw new Error('Source URL is invalid.');
    }
    if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
        throw new Error('Source URL must start with http(s).');
    }

    const { data } = await axios.get(sourceUrl, {
        timeout: 15_000,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'text/html,application/xhtml+xml',
        },
    });
    const $ = cheerio.load(data);
    const selector = String(watchConfig?.selector || '').trim();
    const regexRaw = String(watchConfig?.valueRegex || '').trim();

    let targetText = '';
    if (selector) {
        const matches = $(selector)
            .slice(0, 20)
            .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
            .get()
            .filter(Boolean);
        targetText = matches.join('\n');
    }
    const bodyText = $('body').text().replace(/\r/g, '\n');
    if (!targetText) targetText = bodyText;

    if (regexRaw) {
        let regex;
        try {
            regex = new RegExp(regexRaw, 'i');
        } catch (err) {
            throw new Error(`Invalid regex: ${err.message}`);
        }
        const match = targetText.match(regex) || bodyText.match(regex);
        if (!match) throw new Error('Regex did not match any value.');
        const picked = match[1] || match[0];
        const token = String(picked).trim();
        const numeric = parseNumericValue(token);
        if (numeric == null) throw new Error('Matched value is not numeric.');
        return { token, numeric, snippet: targetText.split('\n').slice(0, 3).join('\n'), sourceUrl };
    }

    const parsed = extractKinahValueFromText(targetText);
    if (!parsed) throw new Error('Could not extract kinah rate. Configure `selector` or `value_regex`.');
    return { token: parsed.token, numeric: parsed.numeric, snippet: parsed.snippet, sourceUrl };
}

function buildKinahStatusEmbed(guildState) {
    const watch = createDefaultKinahWatch(guildState?.kinah);
    const presetLabel = watch.sourcePreset || 'custom';
    return new EmbedBuilder()
        .setTitle('Kinah Rate Crawler Status')
        .setDescription([
            `Enabled: ${watch.enabled ? 'Yes' : 'No'}`,
            `Post channel: ${watch.channelId ? `<#${watch.channelId}>` : 'Not set'}`,
            `Preset: ${presetLabel}`,
            `Keyword: ${watch.sourceKeyword || 'N/A'}`,
            `Source URL: ${watch.sourceUrl || 'Not set'}`,
            `Secondary URL: ${watch.secondarySourceUrl || 'N/A'}`,
            `Selector: ${watch.selector || 'Auto detect'}`,
            `Regex: ${watch.valueRegex || 'Auto detect'}`,
            `Poll interval: ${watch.pollMinutes} minute(s)`,
            `Mention role: ${watch.mentionRoleId ? `<@&${watch.mentionRoleId}>` : 'None'}`,
            `Last stable value: ${watch.stableRate ? formatKrw(watch.stableRate) : 'N/A'}`,
            `Last raw value: ${watch.lastRawText || 'N/A'}`,
            `Last sources: ${watch.lastSourceSummary || 'N/A'}`,
            `Last check: ${watch.lastCheckedAt ? toDiscordTime(watch.lastCheckedAt) : 'N/A'}`,
            `Last error: ${watch.lastError || 'None'}`,
        ].join('\n'))
        .setColor(0x14b8a6);
}

function buildKinahRateEmbed(snapshot, previousValue = null) {
    const isFirst = previousValue == null;
    const diff = previousValue == null ? null : Number(snapshot.numeric) - Number(previousValue);
    const diffLine = diff == null ? 'Initial baseline captured.' : `${diff >= 0 ? '+' : ''}${diff.toLocaleString()} vs previous`;
    return new EmbedBuilder()
        .setTitle('💰 Kinah Rate Update')
        .setDescription([
            `Current: **${snapshot.token}**`,
            `Change: ${diffLine}`,
            snapshot.rawToken ? `Raw snapshot: ${snapshot.rawToken}` : null,
            snapshot.sourceName ? `Source: ${snapshot.sourceName}` : null,
            snapshot.sourceSummary ? `Source summary: ${snapshot.sourceSummary}` : null,
            snapshot.snippet ? `Snapshot: \`${snapshot.snippet.slice(0, 220)}\`` : null,
            `[Source link](${snapshot.sourceUrl})`,
        ].filter(Boolean).join('\n'))
        .addFields(
            ...(Array.isArray(snapshot.sourceValues) && snapshot.sourceValues.length
                ? [{ name: 'Source breakdown', value: snapshot.sourceValues.map(item => `- ${item.name}: ${item.token}`).join('\n').slice(0, 1000) }]
                : [])
        )
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
            const watch = createDefaultKinahWatch(guildState.kinah);
            guildState.kinah = watch;
            if (!watch.enabled || !watch.sourceUrl || !watch.channelId) continue;

            const intervalMs = Math.max(60_000, watch.pollMinutes * 60_000);
            if (watch.lastCheckedAt && now - watch.lastCheckedAt < intervalMs) continue;

            watch.lastCheckedAt = now;
            changed = true;
            let snapshot;
            try {
                snapshot = await fetchKinahRateSnapshot(watch);
                watch.lastError = null;
            } catch (err) {
                watch.lastError = err.message || 'Fetch failed';
                changed = true;
                continue;
            }

            const stabilized = applyKinahStability(watch, snapshot.numeric);
            const stableSnapshot = {
                ...snapshot,
                rawToken: snapshot.token,
                rawNumeric: snapshot.numeric,
                token: formatKrw(stabilized),
                numeric: stabilized,
            };
            // Per-guild posting policy:
            // - Post on first baseline
            // - Post when value changes meaningfully (>=3%)
            // - Also post once per polling interval even when unchanged (heartbeat)
            const previousStable = watch.lastRate;
            const changeRatio = previousStable == null ? null : Math.abs(stabilized - previousStable) / Math.max(previousStable, 1);
            const isChanged = previousStable == null || stabilized !== previousStable;
            const dueByInterval = !watch.lastPostedAt || (now - Number(watch.lastPostedAt || 0) >= intervalMs);
            const shouldPost = dueByInterval || (isChanged && (changeRatio == null || changeRatio >= 0.03));

            watch.lastRawText = snapshot.token;
            watch.lastSourceSummary = snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null;
            watch.lastRate = stabilized;
            if (!shouldPost) {
                changed = true;
                continue;
            }

            const channel = await client.channels.fetch(watch.channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) {
                watch.lastError = 'Post channel is missing or not text-based.';
                changed = true;
                continue;
            }

            const mention = watch.mentionRoleId ? `<@&${watch.mentionRoleId}>` : undefined;
            await channel.send({ content: mention, embeds: [buildKinahRateEmbed(stableSnapshot, previousStable)] }).catch(() => {});
            watch.lastPostedAt = Date.now();
            changed = true;
        }
        if (changed) saveKinahState();
    } finally {
        kinahTickerActive = false;
    }
}

// ═══════════════════════════════════════════════════════════
// [3] 슬래시 커맨드 등록
// ═══════════════════════════════════════════════════════════
const commands = [
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show quick help and command overview')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('faq_admin')
        .setDescription('Admin FAQ (Admin, shown only to you)')
        .addStringOption(o => o
            .setName('lang')
            .setDescription('Language / 언어')
            .setRequired(false)
            .addChoices(
                { name: 'English', value: 'en' },
                { name: '한국어', value: 'ko' }
            ))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('guide')
        .setDescription('View member guide (shown only to you, ephemeral)')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('homework')
        .setDescription('Shows the Aion 2 Daily/Weekly Task Guide')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('tactics')
        .setDescription('View curated TACTICS guides')
        .addBooleanOption(o => o
            .setName('public')
            .setDescription('Post to channel (everyone sees) — Admin only')
            .setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('guidebook')
        .setDescription('View AION2 Official Guidebook (PlayNC)')
        .addBooleanOption(o => o
            .setName('public')
            .setDescription('Post to channel (everyone sees) — Admin only')
            .setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('report_kinah')
        .setDescription('Submit Kinah Team start/end report')
        .addStringOption(o => o
            .setName('region')
            .setDescription('Your region')
            .setRequired(true)
            .addChoices(...getRegionChoices()))
        .addStringOption(o => o
            .setName('phase')
            .setDescription('Start or end report')
            .setRequired(false)
            .addChoices(
                { name: 'Start', value: 'start' },
                { name: 'End', value: 'end' }
            ))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('report_levelup')
        .setDescription('Submit Level-Up Team start/end report')
        .addStringOption(o => o
            .setName('region')
            .setDescription('Your region')
            .setRequired(true)
            .addChoices(...getRegionChoices()))
        .addStringOption(o => o
            .setName('phase')
            .setDescription('Start or end report')
            .setRequired(false)
            .addChoices(
                { name: 'Start', value: 'start' },
                { name: 'End', value: 'end' }
            ))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('salary_confirm')
        .setDescription(`Confirm salary receipt (1-click, select ${SUPPORTED_REGION_CODES})`)
        .addStringOption(o => o
            .setName('region')
            .setDescription('Your region')
            .setRequired(true)
            .addChoices(...getRegionChoices()))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Post report/salary/join-verify panel to this channel (Admin)')
        .addStringOption(o => o
            .setName('type')
            .setDescription('Panel type')
            .setRequired(true)
            .addChoices(
                { name: 'Daily Report', value: 'report' },
                { name: 'Salary Confirm', value: 'salary' },
                { name: 'Kinah Rate', value: 'kinah' },
                { name: 'Join Verification', value: 'join_verify' },
                { name: 'Payment Confirm', value: 'payment' },
                { name: 'Field Boss & MVP', value: 'boss' },
                { name: 'AION2 Search (Item/Character/Build/Collection)', value: 'search' },
                { name: 'Info YouTube (Translated Links)', value: 'youtube' },
                { name: '📰 Link (Summarize & Translate)', value: 'link' },
                { name: '📖 Usage Guide (Korean)', value: 'guide_ko' },
                { name: '📖 Usage Guide (English)', value: 'guide_en' },
                { name: '📖 PlayNC Guidebook (Official)', value: 'guidebook_plaync' },
                { name: '⚔️ TACTICS (All Guide Categories)', value: 'tactics' }
            ))
        .addStringOption(o => o
            .setName('region')
            .setDescription('Report panel scope (report type only)')
            .setRequired(false)
            .addChoices(
                { name: 'All Regions', value: 'all' },
                ...getRegionChoices()
            ))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('join_verify')
        .setDescription('Open country selection popup for join verification')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('myinfo_register')
        .setDescription('Create private verification channel — upload screenshot, staff Approve/Reject')
        .addStringOption(o => o
            .setName('character_name')
            .setDescription('Your AION2 character name (saved to member list when approved)')
            .setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('verify_channel_set')
        .setDescription('Set category where verification channels are created (Admin)')
        .addChannelOption(o => o
            .setName('category')
            .setDescription('Category for verification channels')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildCategory))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('welcome_set')
        .setDescription('Set welcome channel and announcements channel (Admin)')
        .addChannelOption(o => o
            .setName('announcements_channel')
            .setDescription('Announcements channel to link (𝗔𝗻𝗻𝗼𝘂𝗻𝗰𝗲𝗺𝗲𝗻𝘁𝘀)')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText))
        .addChannelOption(o => o
            .setName('welcome_channel')
            .setDescription('Channel where welcome message is posted')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('welcome_send')
        .setDescription('Send welcome message to a user manually (Admin)')
        .addUserOption(o => o
            .setName('user')
            .setDescription('User to send welcome message')
            .setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('member_list_organize')
        .setDescription('Rebuild member list sheet from Member_List_* sheets (Admin)')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('link_channel_set')
        .setDescription('Set TACTICS category for !link / Add Link results (Admin)')
        .addStringOption(o => o
            .setName('category')
            .setDescription('TACTICS category — link results go to matching channel under parent. Omit to clear.')
            .setRequired(false)
            .addChoices(
                { name: '🏰 Dungeon Guide', value: 'dungeon' },
                { name: '🐾 Pet Guide', value: 'pet' },
                { name: '⚔️ Class Guide (general)', value: 'class' },
                { name: '⚔️ Gladiator', value: 'class_gladiator' },
                { name: '⚔️ Templar', value: 'class_templar' },
                { name: '⚔️ Assassin', value: 'class_assassin' },
                { name: '⚔️ Ranger', value: 'class_ranger' },
                { name: '⚔️ Chanter', value: 'class_chanter' },
                { name: '⚔️ Cleric', value: 'class_cleric' },
                { name: '⚔️ Sorcerer', value: 'class_sorcerer' },
                { name: '⚔️ Spiritmaster PvE', value: 'class_spiritmaster_pve' },
                { name: '⚔️ Spiritmaster PvP', value: 'class_spiritmaster_pvp' },
                { name: '🚀 Fast Leveling', value: 'fast_leveling' },
                { name: '💰 Kinah Farming', value: 'kinah_farming' },
                { name: '⚔️ CP Boost Guide', value: 'cp_boost_guide' },
                { name: '🏛️ Pantheon Guide', value: 'pantheon_guide' },
                { name: '👹 Dungeon Tactics', value: 'dungeon_tactics' },
                { name: '📅 Daily Checklist', value: 'daily_checklist' },
                { name: '💡 Pro Tips', value: 'pro_tips' },
                { name: '👔 Wardrobe Guide', value: 'wardrobe_guide' }
            ))
        .addChannelOption(o => o
            .setName('parent')
            .setDescription('Discord category under which to find the channel (e.g. tactics). Omit to search whole server.')
            .setRequired(false)
            .addChannelTypes(ChannelType.GuildCategory))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('guidebook_fetch')
        .setDescription('Fetch AION2 PlayNC guidebook and cache (Admin)')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('preset')
        .setDescription('Apply preset (Admin) or view boss list')
        .addStringOption(o => o
            .setName('mode')
            .setDescription('Preset mode (optional)')
            .setRequired(false)
            .addChoices(
                { name: 'Elyos', value: 'elyos' },
                { name: 'Asmodian', value: 'asmodian' },
                { name: 'Combined', value: 'combined' }
            ))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('boss')
        .setDescription('Show boss board or a specific boss')
        .addStringOption(o => o.setName('boss_name').setDescription('Optional: exact or partial boss name').setRequired(false).setAutocomplete(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('cut')
        .setDescription('Record a boss kill and calculate next spawn')
        .addStringOption(o => o.setName('boss_name').setDescription('Boss name').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('killed_at').setDescription('Optional kill time (HH:mm)').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('server_open')
        .setDescription('Reset all boss timers from server open time (Admin)')
        .addStringOption(o => o.setName('open_time').setDescription('Server open time HH:mm').setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('boss_add')
        .setDescription('Add or update a custom boss (Admin)')
        .addStringOption(o => o.setName('boss_name').setDescription('Boss name').setRequired(true).setAutocomplete(true))
        .addIntegerOption(o => o.setName('respawn_minutes').setDescription('Respawn minutes').setRequired(true).setMinValue(1).setMaxValue(10080))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('boss_remove')
        .setDescription('Remove a boss from tracking (Admin)')
        .addStringOption(o => o.setName('boss_name').setDescription('Boss name').setRequired(true).setAutocomplete(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('boss_alert_mode')
        .setDescription('Choose boss alerts in channel or DM')
        .addStringOption(o => o
            .setName('mode')
            .setDescription('Delivery mode')
            .setRequired(true)
            .addChoices(
                { name: 'public channel', value: 'channel' },
                { name: 'DM only', value: 'dm' }
            ))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('boss_event_multiplier')
        .setDescription('Set event respawn multiplier (e.g. 0.8) (Admin)')
        .addNumberOption(o => o.setName('multiplier').setDescription('Respawn multiplier: 0.1 ~ 2.0').setRequired(true).setMinValue(0.1).setMaxValue(2))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('boss_fetch')
        .setDescription('Fetch boss list from URL and apply as preset (Admin)')
        .addStringOption(o => o.setName('url').setDescription('JSON URL (default: repo boss_presets.json)').setRequired(false))
        .addStringOption(o => o
            .setName('mode')
            .setDescription('Which faction(s) to apply')
            .setRequired(false)
            .addChoices(
                { name: 'elyos only', value: 'elyos' },
                { name: 'asmodian only', value: 'asmodian' },
                { name: 'combined (both)', value: 'combined' }
            ))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('mvp')
        .setDescription('View MVP schedule (Admin)')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('mvp_set')
        .setDescription('Set MVP time for a day (Admin)')
        .addStringOption(o => o
            .setName('day')
            .setDescription('Day of week')
            .setRequired(true)
            .addChoices(
                { name: 'Sunday', value: 'Sunday' },
                { name: 'Monday', value: 'Monday' },
                { name: 'Tuesday', value: 'Tuesday' },
                { name: 'Wednesday', value: 'Wednesday' },
                { name: 'Thursday', value: 'Thursday' },
                { name: 'Friday', value: 'Friday' },
                { name: 'Saturday', value: 'Saturday' }
            ))
        .addStringOption(o => o.setName('time').setDescription('Time (HH:mm, e.g. 20:00)').setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('kinah_watch_set')
        .setDescription('Configure kinah rate crawler and target channel (Admin)')
        .addChannelOption(o => o
            .setName('channel')
            .setDescription('Channel where kinah updates are posted')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption(o => o.setName('source_url').setDescription('Market/source page URL').setRequired(true))
        .addStringOption(o => o.setName('selector').setDescription('Optional CSS selector for price text').setRequired(false))
        .addStringOption(o => o.setName('value_regex').setDescription('Optional regex (capture group #1 preferred)').setRequired(false))
        .addIntegerOption(o => o.setName('poll_minutes').setDescription('How often to check (1-60)').setRequired(false).setMinValue(1).setMaxValue(60))
        .addRoleOption(o => o.setName('mention_role').setDescription('Optional role mention on updates').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('kinah_watch_preset')
        .setDescription('Quick setup for ItemBay/ItemMania AION2 presets (Admin)')
        .addStringOption(o => o
            .setName('preset')
            .setDescription('Market preset')
            .setRequired(true)
            .addChoices(
                { name: 'ItemBay AION2', value: 'itembay_aion2' },
                { name: 'ItemMania AION2', value: 'itemmania_aion2' },
                { name: 'Dual Market AION2', value: 'dual_market_aion2' }
            ))
        .addChannelOption(o => o
            .setName('channel')
            .setDescription('Channel where kinah updates are posted')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addIntegerOption(o => o.setName('poll_minutes').setDescription('How often to check (1-60)').setRequired(false).setMinValue(1).setMaxValue(60))
        .addRoleOption(o => o.setName('mention_role').setDescription('Optional role mention on updates').setRequired(false))
        .addStringOption(o => o.setName('source_keyword').setDescription('Keyword hint (default: AION2 kinah)').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('kinah_watch_now')
        .setDescription('Fetch kinah rate immediately')
        .addBooleanOption(o => o.setName('public_post').setDescription('Post result publicly to configured channel').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('kinah_watch_stop')
        .setDescription('Stop kinah rate crawler for this guild (Admin)')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('kinah_watch_status')
        .setDescription('Show kinah rate crawler settings and last state')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('market_setup')
        .setDescription('Set global market and escrow ticket routing (Admin)')
        .addChannelOption(o => o
            .setName('market_channel')
            .setDescription('Channel where /wts and /wtb listings are posted')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addChannelOption(o => o
            .setName('ticket_category')
            .setDescription('Category where escrow trade tickets are created')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildCategory))
        .addRoleOption(o => o
            .setName('admin_role')
            .setDescription('TETRA escrow admin role')
            .setRequired(true))
        .addNumberOption(o => o
            .setName('fee_percent')
            .setDescription('Escrow fee percent (default 3.0, suggested 3-5)')
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(20))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('market_status')
        .setDescription('Show global market escrow setup and runtime status')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('wts')
        .setDescription('Post a Want-To-Sell (WTS) escrow listing')
        .addIntegerOption(o => o.setName('amount').setDescription('Amount of Kinah').setRequired(true).setMinValue(1))
        .addNumberOption(o => o.setName('price').setDescription('Total price').setRequired(true).setMinValue(0.01))
        .addStringOption(o => o
            .setName('currency')
            .setDescription('Settlement currency')
            .setRequired(true)
            .addChoices(
                { name: 'USD ($)', value: 'USD' },
                { name: 'KRW (₩)', value: 'KRW' },
                { name: 'PHP (₱)', value: 'PHP' },
                { name: 'EUR (€)', value: 'EUR' },
                { name: 'JPY (¥)', value: 'JPY' },
            ))
        .addStringOption(o => o.setName('note').setDescription('Optional note').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('wtb')
        .setDescription('Post a Want-To-Buy (WTB) escrow listing')
        .addIntegerOption(o => o.setName('amount').setDescription('Amount of Kinah').setRequired(true).setMinValue(1))
        .addNumberOption(o => o.setName('price').setDescription('Total price').setRequired(true).setMinValue(0.01))
        .addStringOption(o => o
            .setName('currency')
            .setDescription('Settlement currency')
            .setRequired(true)
            .addChoices(
                { name: 'USD ($)', value: 'USD' },
                { name: 'KRW (₩)', value: 'KRW' },
                { name: 'PHP (₱)', value: 'PHP' },
                { name: 'EUR (€)', value: 'EUR' },
                { name: 'JPY (¥)', value: 'JPY' },
            ))
        .addStringOption(o => o.setName('note').setDescription('Optional note').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('trust')
        .setDescription('Show trust score and tier')
        .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('trust_add')
        .setDescription('Adjust trust score for a user (Admin)')
        .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
        .addIntegerOption(o => o.setName('points').setDescription('Points to add/remove').setRequired(true).setMinValue(-10).setMaxValue(50))
        .addStringOption(o => o.setName('reason').setDescription('Adjustment reason').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('trust_role_set')
        .setDescription('Bind trust tier to Discord role (Admin)')
        .addStringOption(o => o
            .setName('tier')
            .setDescription('Trust tier')
            .setRequired(true)
            .addChoices(
                { name: 'Bronze (>=3)', value: 'bronze' },
                { name: 'Silver (>=10)', value: 'silver' },
                { name: 'Gold (>=25)', value: 'gold' },
            ))
        .addRoleOption(o => o.setName('role').setDescription('Role to grant for the tier').setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('payment_ocr_set')
        .setDescription('Set payment receipt OCR channel and behavior (Admin)')
        .addChannelOption(o => o
            .setName('channel')
            .setDescription('Channel where users upload payment proof images')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption(o => o
            .setName('enabled')
            .setDescription('Enable OCR auto logging (default: true)')
            .setRequired(false))
        .addIntegerOption(o => o
            .setName('min_confidence')
            .setDescription('Low confidence threshold 0-100 (default: 45)')
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(100))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('payment_ocr_status')
        .setDescription('Show payment receipt OCR automation status')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('aon_translate_set')
        .setDescription('Set channel route for AON Korean->English translation (Admin)')
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
        .setDescription('Set source bot id to translate from (default AON bot) (Admin)')
        .addStringOption(o => o
            .setName('bot_id')
            .setDescription('Discord bot user ID')
            .setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('aon_translate_status')
        .setDescription('Show AON translation routes and status')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('youtube_ready')
        .setDescription('Prepare YouTube link with EN title and subtitle preset')
        .addStringOption(o => o
            .setName('video')
            .setDescription('YouTube URL or 11-char video ID')
            .setRequired(true))
        .addBooleanOption(o => o
            .setName('post_card')
            .setDescription('Also post playable link card to this channel')
            .setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('character')
        .setDescription('Lookup AION2 character by name or profile URL')
        .addStringOption(o => o.setName('query').setDescription('Character name or PlayNC profile URL').setRequired(true))
        .addStringOption(o => o.setName('race').setDescription('Race filter').setRequired(false).addChoices({ name: 'Elyos', value: 'elyos' }, { name: 'Asmodian', value: 'asmodian' }))
        .addStringOption(o => o.setName('class_keyword').setDescription('Class keyword filter').setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('item')
        .setDescription('Lookup AION2 item by keyword')
        .addStringOption(o => o.setName('query').setDescription('Item name or keyword').setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('collection')
        .setDescription('Find equipment collections by stat keyword')
        .addStringOption(o => o.setName('query').setDescription('Stat keyword (e.g. crit, accuracy)').setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('build')
        .setDescription('Find recommended builds and skill trees')
        .addStringOption(o => o.setName('query').setDescription('Class or build keyword').setRequired(true))
        .toJSON(),
];

// ═══════════════════════════════════════════════════════════
// [4] 모달 (버튼 클릭 시)
// ═══════════════════════════════════════════════════════════
function createKinahStartModal(region) {
    return new ModalBuilder()
        .setCustomId(`modal_kinah_start_${region}`)
        .setTitle('Start — Kinah Team')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('start_kinah')
                    .setLabel('Start Kinah (numbers only)')
                    .setPlaceholder('e.g. 12000000')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('memo')
                    .setLabel('Memo')
                    .setPlaceholder('e.g. Today target: 30m')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            ),
        );
}

function createKinahEndModal(region) {
    return new ModalBuilder()
        .setCustomId(`modal_kinah_end_${region}`)
        .setTitle('End — Kinah Team')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('end_kinah')
                    .setLabel('End Kinah (numbers only)')
                    .setPlaceholder('e.g. 14750000')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('spent_kinah')
                    .setLabel('Spent Kinah (numbers only)')
                    .setPlaceholder('e.g. 10000000')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('memo')
                    .setLabel('Memo')
                    .setPlaceholder('e.g. Some kinah used to gear up')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            ),
        );
}

function createLevelUpStartModal(region) {
    return new ModalBuilder()
        .setCustomId(`modal_levelup_start_${region}`)
        .setTitle('Start — Level-Up Team')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('start_level')
                    .setLabel('Start Level (numbers only)')
                    .setPlaceholder('e.g. 40')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('start_cp')
                    .setLabel('Start Combat Power (numbers only)')
                    .setPlaceholder('e.g. 1800')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('memo')
                    .setLabel('Memo')
                    .setPlaceholder('e.g. Goal: Lv +2 / CP +150')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            ),
        );
}

function createLevelUpEndModal(region) {
    return new ModalBuilder()
        .setCustomId(`modal_levelup_end_${region}`)
        .setTitle('End — Level-Up Team')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('end_level')
                    .setLabel('End Level (numbers only)')
                    .setPlaceholder('e.g. 45')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('end_cp')
                    .setLabel('End Combat Power (numbers only)')
                    .setPlaceholder('e.g. 2100')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('memo')
                    .setLabel('Memo')
                    .setPlaceholder('e.g. Rune upgrade + dungeon clear')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            ),
        );
}

function parseNonNegativeBigIntInput(raw) {
    const normalized = String(raw || '').replace(/[,\s]/g, '').trim();
    if (!/^\d+$/.test(normalized)) return null;
    try {
        return BigInt(normalized);
    } catch (_) {
        return null;
    }
}

function parseNonNegativeIntInput(raw) {
    const normalized = String(raw || '').replace(/[,\s]/g, '').trim();
    if (!/^\d+$/.test(normalized)) return null;
    const value = Number.parseInt(normalized, 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatBigIntWithCommas(value) {
    const v = typeof value === 'bigint' ? value : BigInt(value || 0);
    const sign = v < 0n ? '-' : '';
    const abs = v < 0n ? -v : v;
    const s = abs.toString();
    return `${sign}${s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function buildDailySubmitButtonRow() {
    return buildDailySubmitButtonRowForRegion(null);
}

function buildDailySubmitButtonRowForRegion(regionValue = null) {
    const regionCfg = regionValue ? getRegionConfig(regionValue) : null;
    const customId = regionCfg ? `btn_daily_submit_${regionCfg.value}` : 'btn_daily_submit';
    const label = regionCfg ? `Submit Report (${regionCfg.code})` : 'Submit Report';
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setEmoji('📊')
            .setStyle(ButtonStyle.Primary)
    );
}

function buildDailySubmitTargetSelectRow(regionValue = null) {
    const regionCfg = regionValue ? getRegionConfig(regionValue) : null;
    const targetRegions = regionCfg ? [regionCfg] : REGION_CONFIGS;
    const options = [];
    for (const region of targetRegions) {
        options.push({
            label: `${region.code} • Start Kinah Team`,
            value: `kinah_start:${region.value}`,
            emoji: region.emoji,
            description: `${region.label} start report`,
        });
        options.push({
            label: `${region.code} • End Kinah Team`,
            value: `kinah_end:${region.value}`,
            emoji: region.emoji,
            description: `${region.label} end report (+spent)`,
        });
        options.push({
            label: `${region.code} • Start Level-Up Team`,
            value: `levelup_start:${region.value}`,
            emoji: region.emoji,
            description: `${region.label} start level/cp`,
        });
        options.push({
            label: `${region.code} • End Level-Up Team`,
            value: `levelup_end:${region.value}`,
            emoji: region.emoji,
            description: `${region.label} end level/cp`,
        });
    }
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_daily_submit_target')
            .setPlaceholder(regionCfg ? `Select start/end + team (${regionCfg.code})` : 'Select start/end + team + region')
            .addOptions(options.slice(0, 25))
    );
}

function ensureReportSessionsForGuild(state, guildId) {
    if (!state.reportSessionsByGuild || typeof state.reportSessionsByGuild !== 'object') {
        state.reportSessionsByGuild = {};
    }
    if (!state.reportSessionsByGuild[guildId] || typeof state.reportSessionsByGuild[guildId] !== 'object') {
        state.reportSessionsByGuild[guildId] = {};
    }
    return state.reportSessionsByGuild[guildId];
}

function buildReportSessionKey(userId, team, region) {
    return `${team}:${region}:${userId}`;
}

function pruneOldReportSessions(sessionMap, nowTs = Date.now()) {
    if (!sessionMap || typeof sessionMap !== 'object') return;
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    for (const [key, session] of Object.entries(sessionMap)) {
        const startedAt = Number(session?.startedAt || 0);
        if (!startedAt || nowTs - startedAt > maxAgeMs) delete sessionMap[key];
    }
}

const PAYMENT_CURRENCIES = [
    { value: 'KRW', label: 'KRW (Korean Won)', emoji: '🇰🇷' },
    { value: 'USD', label: 'USD (US Dollar)', emoji: '🇺🇸' },
    { value: 'PHP', label: 'PHP (Philippine Peso)', emoji: '🇵🇭' },
    { value: 'INR', label: 'INR (Indian Rupee)', emoji: '🇮🇳' },
    { value: 'NPR', label: 'NPR (Nepalese Rupee)', emoji: '🇳🇵' },
    { value: 'CNY', label: 'CNY (Chinese Yuan)', emoji: '🇨🇳' },
    { value: 'TWD', label: 'TWD (Taiwan Dollar)', emoji: '🇹🇼' },
];

function getPaymentOcrConfigForGuild(state, guildId) {
    const byGuild = state?.paymentOcrConfigByGuild && typeof state.paymentOcrConfigByGuild === 'object'
        ? state.paymentOcrConfigByGuild
        : {};
    const paymentByGuild = state?.paymentChannelIdByGuild && typeof state.paymentChannelIdByGuild === 'object'
        ? state.paymentChannelIdByGuild
        : {};
    const raw = byGuild[guildId] || {};
    return {
        enabled: raw.enabled !== false,
        channelId: asSnowflake(raw.channelId) || asSnowflake(paymentByGuild[guildId]) || asSnowflake(state?.paymentChannelId),
        minConfidence: clampNumber(raw.minConfidence ?? 45, 0, 100, 45),
    };
}

function isImageAttachment(attachment) {
    const contentType = String(attachment?.contentType || '').toLowerCase();
    if (contentType.startsWith('image/')) return true;
    const name = String(attachment?.name || '').toLowerCase();
    return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name);
}

function normalizeReceiptText(text) {
    return String(text || '')
        .replace(/\r/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function inferCurrencyFromReceiptText(text) {
    const t = String(text || '');
    if (/₱|\bphp\b|gcash/i.test(t)) return 'PHP';
    if (/₩|\bkrw\b/.test(t)) return 'KRW';
    if (/\$|\busd\b/.test(t)) return 'USD';
    if (/€|\beur\b/.test(t)) return 'EUR';
    if (/¥|\bjpy\b|\byen\b/.test(t)) return 'JPY';
    if (/₹|\binr\b/.test(t)) return 'INR';
    if (/₨|\bnpr\b/.test(t)) return 'NPR';
    if (/nt\$|\btwd\b/.test(t)) return 'TWD';
    if (/cny|rmb|元/.test(t)) return 'CNY';
    return 'PHP';
}

function pickReceiptAmount(text) {
    const source = String(text || '');
    const amountPatterns = [
        /total\s*amount\s*(?:sent|paid)?[^\d₱₩$¥€]{0,24}([₱₩$¥€]?\s*\d[\d,]*(?:\.\d{1,2})?)/i,
        /amount[^\d₱₩$¥€]{0,24}([₱₩$¥€]?\s*\d[\d,]*(?:\.\d{1,2})?)/i,
        /sent[^\d₱₩$¥€]{0,24}([₱₩$¥€]?\s*\d[\d,]*(?:\.\d{1,2})?)/i,
    ];
    for (const rx of amountPatterns) {
        const match = source.match(rx);
        const token = match?.[1];
        const numeric = parseNumericValue(String(token || '').replace(/[^\d.,-]/g, ''));
        if (numeric != null && numeric > 0 && numeric < 1_000_000_000) {
            return { numeric, token: String(token || '').trim() };
        }
    }
    const allNumeric = (source.match(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}/g) || [])
        .map(token => ({ token, numeric: parseNumericValue(token) }))
        .filter(item => item.numeric != null && item.numeric > 0 && item.numeric < 1_000_000_000);
    if (!allNumeric.length) return null;
    allNumeric.sort((a, b) => b.numeric - a.numeric);
    return allNumeric[0];
}

function extractReceiptReferenceNo(text) {
    const source = String(text || '');
    const match = source.match(/ref(?:erence)?\s*(?:no|#|number)?\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9 \-]{5,40})/i);
    if (!match) return null;
    return String(match[1] || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function extractReceiptTimestamp(text) {
    const source = String(text || '');
    const patterns = [
        /\b([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))\b/i,
        /\b(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\b/i,
        /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)\b/i,
    ];
    for (const rx of patterns) {
        const match = source.match(rx);
        if (match?.[1]) return String(match[1]).trim();
    }
    return null;
}

function extractReceiptPayMethod(text) {
    const source = String(text || '');
    if (/gcash/i.test(source)) return 'GCash';
    if (/paypal/i.test(source)) return 'PayPal';
    if (/bank/i.test(source)) return 'Bank Transfer';
    return null;
}

function parseReceiptOcrText(text) {
    const normalized = normalizeReceiptText(text);
    const amountInfo = pickReceiptAmount(normalized);
    const currency = inferCurrencyFromReceiptText(normalized);
    return {
        rawText: normalized,
        amount: amountInfo?.numeric ?? null,
        amountToken: amountInfo?.token || null,
        currency,
        refNo: extractReceiptReferenceNo(normalized),
        paidAt: extractReceiptTimestamp(normalized),
        method: extractReceiptPayMethod(normalized),
    };
}

async function runReceiptOcr(imageUrl) {
    const result = await Tesseract.recognize(imageUrl, 'eng', {
        logger: () => {},
    });
    const text = result?.data?.text || '';
    const confidence = Number(result?.data?.confidence);
    return {
        text,
        confidence: Number.isFinite(confidence) ? confidence : null,
    };
}

async function handleAutoPaymentProofOcr(message) {
    if (!message?.guildId || !message?.channelId) return false;
    if (!message.attachments?.size) return false;
    const state = loadPanelState();
    const cfg = getPaymentOcrConfigForGuild(state, message.guildId);
    if (!cfg.enabled || !cfg.channelId) return false;
    if (cfg.channelId !== message.channelId) return false;
    const images = [...message.attachments.values()].filter(isImageAttachment);
    if (!images.length) return false;

    let parsed = null;
    let confidence = null;
    let usedAttachment = null;
    let lastError = null;
    for (const att of images.slice(0, 3)) {
        try {
            const ocr = await runReceiptOcr(att.url);
            const receipt = parseReceiptOcrText(ocr.text);
            if (receipt.amount != null) {
                parsed = receipt;
                confidence = ocr.confidence;
                usedAttachment = att;
                break;
            }
        } catch (err) {
            lastError = err;
        }
    }

    if (!parsed || parsed.amount == null) {
        await message.reply({
            content: '⚠️ 결제 영수증 OCR에서 금액을 읽지 못했습니다. `/panel type:payment` 버튼 또는 `!confirm`으로 수동 입력해 주세요.',
            allowedMentions: { repliedUser: false }
        }).catch(() => {});
        if (lastError) console.warn('[payment-ocr] parse-failed', lastError.message || lastError);
        return true;
    }

    const trustConfidence = confidence == null ? 'N/A' : `${Math.round(confidence)}%`;
    const status = confidence != null && confidence < cfg.minConfidence
        ? `OCR_LOW_CONFIDENCE (${Math.round(confidence)}%)`
        : 'OCR_AUTO_PENDING_REVIEW';
    const amountText = Number(parsed.amount).toLocaleString('en-US', { maximumFractionDigits: 2 });
    const reasonParts = [
        'Auto OCR receipt',
        parsed.method ? `Method:${parsed.method}` : null,
        parsed.refNo ? `Ref:${parsed.refNo}` : null,
        parsed.paidAt ? `At:${parsed.paidAt}` : null,
        `Msg:${message.id}`,
    ].filter(Boolean);
    const row = [
        new Date().toLocaleString('ko-KR'),
        'MEMBER_CONFIRM_OCR',
        message.author.tag || message.author.username,
        amountText,
        parsed.currency || 'PHP',
        reasonParts.join(' | ').slice(0, 500),
        status,
    ];
    const res = await appendToSheet("'Payment Log'!A:G", row);
    if (!res.ok) {
        await message.reply({
            content: `❌ OCR 결과 시트 저장 실패: ${res.error}`,
            allowedMentions: { repliedUser: false }
        }).catch(() => {});
        return true;
    }

    const embed = new EmbedBuilder()
        .setTitle('🧾 Payment Proof OCR Captured')
        .setColor(status.startsWith('OCR_LOW') ? 0xf59e0b : 0x22c55e)
        .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
        .addFields(
            { name: '💵 Amount', value: `\`${amountText} ${parsed.currency}\``, inline: true },
            { name: '🔎 OCR Confidence', value: `\`${trustConfidence}\``, inline: true },
            { name: '📌 Status', value: `\`${status}\``, inline: true },
            { name: '🧾 Ref No', value: `\`${parsed.refNo || 'N/A'}\``, inline: true },
            { name: '🕒 Paid At', value: `\`${parsed.paidAt || 'N/A'}\``, inline: true },
            { name: '💳 Method', value: `\`${parsed.method || 'N/A'}\``, inline: true },
            { name: '🔗 Source', value: `[Open message](${message.url})`, inline: false },
        )
        .setFooter({ text: 'Saved to Payment Log (A:G) as OCR auto entry' })
        .setTimestamp();
    if (usedAttachment?.url) embed.setImage(usedAttachment.url);
    await message.channel.send({
        content: `✅ **OCR payment proof logged — ${message.author}**`,
        embeds: [embed],
        allowedMentions: { parse: [] }
    }).catch(() => {});
    return true;
}

function buildPaymentCurrencySelectRow() {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('select_payment_currency')
        .setPlaceholder('Select currency')
        .addOptions(
            PAYMENT_CURRENCIES.map(c => ({
                label: c.label,
                value: c.value,
                emoji: c.emoji,
            }))
        );
    return new ActionRowBuilder().addComponents(menu);
}

function createPaymentConfirmModal(currency = 'KRW') {
    const currLabel = PAYMENT_CURRENCIES.find(c => c.value === currency)?.label || currency;
    return new ModalBuilder()
        .setCustomId(`modal_payment_confirm_${currency}`)
        .setTitle(`Payment Confirmation (${currency})`)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('amount')
                    .setLabel(`Amount (${currency})`)
                    .setPlaceholder('e.g. 500,000')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Description / Reason')
                    .setPlaceholder('e.g. Weekly Settlement')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );
}

function createYoutubeAddModal() {
    return new ModalBuilder()
        .setCustomId('modal_youtube_add')
        .setTitle('Add Info YouTube Video')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('youtube_url')
                    .setLabel('YouTube URL')
                    .setPlaceholder('https://www.youtube.com/watch?v=... or youtu.be/...')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );
}

function createLinkAddModal(category) {
    const cid = category || 'current';
    return new ModalBuilder()
        .setCustomId(`modal_link_add:${cid}`)
        .setTitle('Add Link')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('link_url')
                    .setLabel('Article URL')
                    .setPlaceholder('https://inven.co.kr/board/aion2/695/12345')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );
}

const LINK_SET_OPTIONS = [
    { label: '📍 Clear (use channel where used)', value: '__clear__', description: 'Reset to default' },
    { label: '🏰 Dungeon Guide', value: 'dungeon' },
    { label: '🐾 Pet Guide', value: 'pet' },
    { label: '⚔️ Class Guide (general)', value: 'class' },
    ...(TACTICS_DATA.class?.items || []).map(i => ({ label: `⚔️ ${i.label}`, value: `class_${slugFromClassLabel(i.label)}` })),
    { label: '🚀 Fast Leveling', value: 'fast_leveling' },
    { label: '💰 Kinah Farming', value: 'kinah_farming' },
    { label: '⚔️ CP Boost Guide', value: 'cp_boost_guide' },
    { label: '🏛️ Pantheon Guide', value: 'pantheon_guide' },
    { label: '👹 Dungeon Tactics', value: 'dungeon_tactics' },
    { label: '📅 Daily Checklist', value: 'daily_checklist' },
    { label: '💡 Pro Tips', value: 'pro_tips' },
    { label: '👔 Wardrobe Guide', value: 'wardrobe_guide' }
];

function buildLinkCategorySelectRow() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_link_category')
            .setPlaceholder('Where to post this link?')
            .addOptions(
                { label: '📍 This channel', value: 'current', description: 'Post in current channel' },
                ...LINK_SET_OPTIONS.filter(o => o.value !== '__clear__')
            )
    );
}

function slugFromClassLabel(label) {
    return String(label || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function getLinkCategoryLabel(cat) {
    if (!cat) return 'none';
    if (cat.startsWith('class_')) {
        const item = TACTICS_DATA.class?.items?.find(i => `class_${slugFromClassLabel(i.label)}` === cat);
        return item ? item.label : cat.replace(/^class_/, '').replace(/_/g, ' ');
    }
    return TACTICS_DATA[cat]?.label || cat;
}

function buildLinkClassSubSelectRow() {
    const cat = TACTICS_DATA.class;
    if (!cat?.items?.length) return null;
    const options = [
        { label: '⚔️ Class Guide (general)', value: 'class', description: 'Post to general class channel' },
        ...cat.items.map(i => ({ label: i.label, value: `class_${slugFromClassLabel(i.label)}` }))
    ];
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_link_class_sub')
            .setPlaceholder('Select class (Gladiator, Templar, Assassin…)')
            .addOptions(options)
    );
}

function buildLinkSetSelectRow() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_link_set')
            .setPlaceholder('Set link target for !link / Add Link (Admin)')
            .addOptions(LINK_SET_OPTIONS)
    );
}

async function registerGuildSlashCommands(rest, guild) {
    if (!client.user) return false;
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
        console.log(`   Slash commands synced: ${guild.name} (${guild.id})`);
        return true;
    } catch (err) {
        console.error(`   Slash command sync failed: ${guild.name} (${guild.id}) -> ${err.message}`);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════
// [5] 이벤트 핸들러
// ═══════════════════════════════════════════════════════════
client.once('ready', async () => {
    console.log(`🚀 TETRA Sync 봇 가동: ${client.user.tag}`);
    if (!ENABLE_WELCOME_DM) console.log('   ℹ️ Welcome DM off (set ENABLE_WELCOME_DM=true + Server Members Intent in Discord Dev Portal to enable)');
    try {
        await hydrateRuntimeStateFromSheet().catch(err => {
            console.warn(`[state] runtime state hydrate skipped: ${err.message}`);
        });
        const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
        // 서버별 등록 (즉시 반영)
        let success = 0;
        let failed = 0;
        for (const guild of client.guilds.cache.values()) {
            ensureKinahGuildState(guild.id);
            const ok = await registerGuildSlashCommands(rest, guild);
            if (ok) success += 1;
            else failed += 1;
        }
        saveKinahState();
        console.log(`   Slash command sync done: ${success} success / ${failed} failed (total ${commands.length} commands).`);
    } catch (e) {
        console.error('   Slash command setup failed:', e.message);
    }

    setInterval(() => {
        runKinahTicker(client).catch(err => console.error('[kinah-ticker]', err.message));
    }, CONFIG.KINAH_TICKER_MS);
    runKinahTicker(client).catch(() => {});
    setInterval(() => {
        runBossTicker(client).catch(err => console.error('[boss-ticker]', err.message));
    }, CONFIG.BOSS_TICKER_MS);
    runBossTicker(client).catch(() => {});

    // Homework reset alerts (Wed 5 AM, Sun midnight)
    if (CONFIG.HOMEWORK_RESET_CHANNEL) {
        schedule.scheduleJob('0 5 * * 3', async () => {
            const ch = client.channels.cache.get(CONFIG.HOMEWORK_RESET_CHANNEL);
            if (ch) await ch.send('🔔 **Weekly Reset** — Pilots, all weekly dungeons and limits have been reset! Happy grinding!').catch(() => {});
        });
        schedule.scheduleJob('0 0 * * 0', async () => {
            const ch = client.channels.cache.get(CONFIG.HOMEWORK_RESET_CHANNEL);
            if (ch) await ch.send('🛒 **Shop Reset** — The Zephyr Shop (Membership) has just reset. Don\'t forget to buy your weekly materials!').catch(() => {});
        });
        console.log('   Homework reset alerts enabled (Wed 5AM, Sun midnight)');
    }
});

client.on('guildCreate', async (guild) => {
    if (!client.user) return;
    ensureKinahGuildState(guild.id);
    saveKinahState();
    ensureBossGuildState(guild.id);
    saveBossState();
    ensureMvpGuildState(guild.id);
    saveMvpScheduleState();
    const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
    await registerGuildSlashCommands(rest, guild);
});

client.on('guildMemberAdd', async (member) => {
    try {
        const guild = member.guild;
        const state = loadPanelState();
        const cfg = state.welcomeConfig && state.welcomeConfig[guild.id];
        if (!cfg?.announcementsChannelId) return;
        const embed = new EmbedBuilder()
            .setTitle('👋 Welcome!')
            .setDescription(
                `Welcome to **${guild.name}**!\n\n` +
                `1) 📢 **Announcements** — Check <#${cfg.announcementsChannelId}> first for server updates.\n` +
                `2) ✅ **Join Verification** — Run \`/join_verify\` to complete registration.\n` +
                `3) 📘 **Help** — Run \`/help\` for command overview and onboarding links.\n\n` +
                `Welcome channel guidance is managed by staff.`
            )
            .setColor(0x5865F2)
            .setTimestamp();
        const welcomeChannelId = cfg.welcomeChannelId || null;
        const ch = welcomeChannelId
            ? guild.channels.cache.get(welcomeChannelId) || await guild.channels.fetch(welcomeChannelId).catch(() => null)
            : null;
        if (ch && ch.isTextBased()) {
            await ch.send({ content: `${member}`, embeds: [embed] });
        } else {
            // Backward-compatible fallback: if no welcome channel is configured, DM as legacy behavior.
            await member.send({ embeds: [embed] }).catch(() => {});
        }
    } catch (err) {
        console.error('[guildMemberAdd]', err);
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
    if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'boss_name' && ['boss', 'cut', 'boss_add', 'boss_remove'].includes(interaction.commandName)) {
            const guildId = interaction.guildId;
            const guildState = guildId ? ensureBossGuildState(guildId) : null;
            const bosses = guildState?.bosses ? Object.values(guildState.bosses) : [];
            const input = (focused.value || '').toLowerCase().trim();
            let choices = bosses.map(b => ({ name: b.name, value: b.name }));
            if (input) choices = choices.filter(b => b.name.toLowerCase().includes(input));
            choices = choices.slice(0, 25);
            await interaction.respond(choices.length ? choices : [{ name: '(No bosses configured)', value: '' }]).catch(() => {});
        }
        return;
    }
    if (interaction.isChatInputCommand()) {
        const cmd = interaction.commandName;
        if (['panel', 'character', 'boss_fetch', 'kinah_watch_preset', 'kinah_watch_set', 'salary_confirm', 'myinfo_register', 'member_list_organize', 'collection', 'build', 'kinah_watch_now', 'guidebook_fetch', 'tactics', 'guidebook'].includes(cmd)) {
            const guidebookPublic = cmd === 'guidebook' && interaction.options?.getBoolean('public') && hasManageGuild(interaction);
            const tacticsPublic = cmd === 'tactics' && interaction.options?.getBoolean('public') && hasManageGuild(interaction);
            await interaction.deferReply({ flags: (guidebookPublic || tacticsPublic) ? 0 : EPHEMERAL_FLAGS }).catch(() => {});
        }
        if (cmd === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('📘 TETRA Sync — Quick Help')
                .setDescription(
                    'Quick command overview for TETRA Sync.\n\n' +
                    '**Start Here:** Announcements → `/join_verify` → `/help`\n\n' +
                    '**Reports:** `/report_kinah` `/report_levelup` (or panel buttons)\n' +
                    '**Salary:** `/salary_confirm` (or panel region buttons)\n' +
                    '**Payment OCR:** `/payment_ocr_status` (Admin: `/payment_ocr_set`)\n' +
                    '**Join:** `/join_verify` — Country → Role\n' +
                    '**Character Verification:** `/myinfo_register character_name:<name>` → screenshot → staff approval\n\n' +
                    '**Boss:** `/preset` `/boss` `/cut` `/boss_fetch` `/boss_alert_mode`\n**MVP (Admin):** `/mvp` `/mvp_set`\n\n' +
                    '**Kinah:** `/kinah_watch_now` `/kinah_watch_status`\n\n' +
                    '**Global Market (Escrow):** `/wts` `/wtb` `/market_status`\n' +
                    '**Market Admin:** `/market_setup` `/trust_add` `/trust_role_set`\n' +
                    '**Trust:** `/trust`\n\n' +
                    '**Search (ephemeral):** `/character` `/item` `/collection` `/build`\n' +
                    '**DM Search:** `!char <name>`\n\n' +
                    '**Guides (ephemeral):** `/guide` `/homework` `/tactics` `/guidebook`\n' +
                    '**Admin Public:** `/tactics public:true` `/guidebook public:true`\n\n' +
                    '**Link:** `!link <url>` — Summarize & translate\n**`/link_channel_set`** — Set channel for link results (Admin)\n' +
                    '**Other:** `/youtube_ready` `/aon_translate_status`\n' +
                    '**Welcome Setup (Admin):** `/welcome_set announcements_channel:<channel> welcome_channel:<channel>`'
                )
                .setColor(0x5865F2)
                .setTimestamp();
            await interaction.reply({ embeds: [embed], flags: EPHEMERAL_FLAGS });
        } else if (interaction.commandName === 'guide') {
            const embeds = buildGuideEmbedsUser();
            await interaction.reply({ embeds, flags: EPHEMERAL_FLAGS });
        } else if (interaction.commandName === 'tactics') {
            const isPublic = interaction.options.getBoolean('public') && hasManageGuild(interaction);
            const row = buildTacticsCategorySelect(isPublic);
            await interaction.editReply({
                content: isPublic ? '**TACTICS** — Select a category.\n_Everyone will see the selected guide._' : '**TACTICS** — Select a category.\n_Visible only to you_',
                components: [row],
            });
        } else if (interaction.commandName === 'guidebook') {
            const isPublic = interaction.options.getBoolean('public') && hasManageGuild(interaction);
            const state = loadGuidebookState();
            const row = buildGuidebookCategorySelect(state, isPublic);
            if (!row) {
                await interaction.editReply({
                    content: '❌ No guidebook data is available.\nPlease verify `guidebook_official_seed.json` exists, then run **`/guidebook_fetch`** to refresh local cache if needed.'
                });
                return;
            }
            await interaction.editReply({
                content: isPublic ? '**📖 AION2 Official Guidebook** — Select a category.\n_Everyone will see the selected guide._' : '**📖 AION2 Official Guidebook** — Select a category.\n_Visible only to you_',
                components: [row]
            });
        } else if (interaction.commandName === 'homework') {
            const embed = new EmbedBuilder()
                .setColor(0x00E5FF)
                .setTitle('📚 Aion 2 Daily & Weekly Checklist')
                .setDescription('Attention Pilots! Keep track of your grinding schedule.')
                .setThumbnail('https://static.inven.co.kr/column/2025/11/23/news/i1169393249.jpg')
                .addFields(
                    {
                        name: '🔥 Daily Tasks',
                        value: '• **Mission Quests** (5×/day) — Wanted Quests have Unique gear chance\n• **Emergency Supply Request** — Turn in gear for Abyss Points\n• **Black Cloud Traders** (hourly refresh) — Pets, skins via Kinah',
                        inline: false
                    },
                    {
                        name: '📦 Entrance Ticket Content (daily charge)',
                        value: '• **Expedition** (Exploration → Conquest, 3×/day)\n• **Transcendence** (CP 1,400+)\n• **Nightmare** (5 tickets/day at 5:00)\n• **Shugo Festa** (:15, :45 each hour)\n• **Dimension Invasion**',
                        inline: false
                    },
                    {
                        name: '📅 Weekly Tasks (Wed 5:00 AM reset)',
                        value: '• **Daily Dungeon** (7×/week) — Enhancement stones\n• **Awakening / Subjugation** (3×/week each)\n• **Odd Energy Crafting** (7×/week, 280 total)\n• **Abyss** (7h base, 14h with Membership)\n• **Battlefield** (up to 10 wins)\n• **Order Shop** (12 Verteron/Altgard, 25 Abyss)',
                        inline: false
                    },
                    {
                        name: '⚠️ Sunday Midnight Reset',
                        value: '• **Zephyr Breeze Shop** (Membership) — Revival Stone, Odd Energy, Abyss Rift Stone, Bio Research Base ticket, Soul Crystals — reset **Sunday midnight**, not Wednesday!',
                        inline: false
                    }
                )
                .setFooter({ text: 'Source: Inven AION2 Tips | TETRA AION2' })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
        } else if (interaction.commandName === 'faq_admin') {
            if (!hasManageGuild(interaction)) {
                await safeEphemeral(interaction, '❌ Manage Server permission required.');
                return;
            }
            const lang = interaction.options?.getString('lang') || 'en';
            const embed = buildFaqAdminEmbed(lang);
            await interaction.reply({ embeds: [embed], flags: EPHEMERAL_FLAGS });
        } else if (interaction.commandName === 'report_kinah') {
            const r = interaction.options.getString('region') || 'ph';
            const phase = (interaction.options.getString('phase') || 'start').toLowerCase();
            if (phase === 'start') await interaction.showModal(createKinahStartModal(r));
            else await interaction.showModal(createKinahEndModal(r));
        } else if (interaction.commandName === 'report_levelup') {
            const r = interaction.options.getString('region') || 'ph';
            const phase = (interaction.options.getString('phase') || 'start').toLowerCase();
            if (phase === 'start') await interaction.showModal(createLevelUpStartModal(r));
            else await interaction.showModal(createLevelUpEndModal(r));
        } else if (interaction.commandName === 'salary_confirm') {
            if (interaction.user.bot) return;
            const regionOpt = interaction.options.getString('region');
            const regionCfg = getRegionConfig(regionOpt);
            if (!regionCfg) {
                await interaction.editReply({ content: `❌ Region must be one of: ${SUPPORTED_REGION_CODES}.` }).catch(() => {});
                return;
            }
            const worker = (interaction.member?.displayName || interaction.user.globalName || interaction.user.username || 'Unknown').trim();
            const timestamp = makeLocalTimestamp(regionCfg.timeZone);
            const data = [timestamp, worker, 'Confirmed', ''];
            const res = await appendToSheet(regionCfg.salarySheetRange, data);
            await interaction.editReply({
                content: res.ok ? `✅ Salary confirmation submitted (${worker}) → ${regionCfg.code}` : `❌ Failed to save (${regionCfg.code}). Create **Salary_Log_${regionCfg.code}** sheet in Google Sheets.`,
                flags: EPHEMERAL_FLAGS
            }).catch(() => {});
        } else if (interaction.commandName === 'join_verify') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            await interaction.reply({
                content: '🌍 Please select your country for join verification.',
                components: [buildJoinCountrySelectRow()],
                flags: EPHEMERAL_FLAGS
            });
        } else if (interaction.commandName === 'myinfo_register') {
            try {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            const characterName = (interaction.options.getString('character_name') || '').trim();
            if (!characterName) {
                await safeEphemeral(interaction, 'Please enter your character name.');
                return;
            }
            const state = loadPanelState();
            const categoryId = state.verifyCategoryIdByGuild?.[interaction.guildId] || state.verifyCategoryId;
            if (!categoryId) {
                await safeEphemeral(interaction, '❌ Verification not configured. Ask an admin to run **`/verify_channel_set category:<category>`** first.');
                return;
            }
            const guild = interaction.guild;
            const category = guild.channels.cache.get(categoryId);
            if (!category || category.type !== ChannelType.GuildCategory) {
                await safeEphemeral(interaction, '❌ Verification category not found. Admin: run `/verify_channel_set` again.');
                return;
            }
            const displayName = (interaction.member?.displayName || interaction.user.globalName || interaction.user.username || 'Unknown').trim();
            const safeName = characterName.replace(/[^\w\s-]/g, '').slice(0, 50) || 'verify';
            const channelName = `verify-${safeName}-${interaction.user.id.slice(-6)}`;
            try {
                const channel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: categoryId,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
                    ],
                });
                const permOverwrites = channel.permissionOverwrites.cache;
                const manageRoles = guild.roles.cache.filter(r => r.permissions.has(PermissionFlagsBits.ManageGuild));
                for (const [, role] of manageRoles) {
                    if (!permOverwrites.has(role.id)) {
                        await channel.permissionOverwrites.create(role, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true,
                            ManageMessages: true,
                        });
                    }
                }
                const verifyState = loadVerifyPendingState();
                verifyState.pending[channel.id] = {
                    userId: interaction.user.id,
                    characterName,
                    guildId: guild.id,
                    createdAt: Date.now(),
                };
                saveVerifyPendingState(verifyState);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`verify_approve_${channel.id}`).setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId(`verify_reject_${channel.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setEmoji('❌')
                );
                const embed = new EmbedBuilder()
                    .setTitle('🎮 Character Verification')
                    .setDescription(
                        `**Character:** \`${characterName}\`\n**User:** ${interaction.user}\n\n` +
                        '📷 **Upload your screenshot HERE** — Drag & drop an image, or click **+** to attach file.\n' +
                        '_(Discord modals cannot accept files. Upload in this channel.)_\n\n' +
                        'Staff will review and click **Approve** or **Reject**.'
                    )
                    .setColor(0x5865F2)
                    .setTimestamp();
                await channel.send({
                    content: `${interaction.user} — Verification channel created.`,
                    embeds: [embed],
                    components: [row],
                });
                await interaction.editReply({ content: `✅ Verification channel created: <#${channel.id}>\n\n**→ Go to that channel and upload your screenshot** (drag & drop or click + to attach). The modal cannot accept files.` });
            } catch (err) {
                console.error('[myinfo_register]', err);
                await interaction.editReply({ content: `❌ Failed to create channel: ${err.message}` }).catch(() => {});
            }
            } catch (err) {
                console.error('[myinfo_register]', err);
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: `❌ Error: ${err.message}. If the bot was starting up, wait 1–2 min and try again. Or ask admin to run \`/verify_channel_set\` first.`, flags: EPHEMERAL_FLAGS });
                    } else {
                        await interaction.editReply({ content: `❌ Error: ${err.message}. Try again or ask admin to run \`/verify_channel_set\` first.` }).catch(() => {});
                    }
                } catch (_) {}
            }
        } else if (interaction.commandName === 'verify_channel_set') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const category = interaction.options.getChannel('category', true);
            if (category.type !== ChannelType.GuildCategory) {
                await safeEphemeral(interaction, 'Please select a category channel.');
                return;
            }
            const state = loadPanelState();
            const byGuild = state.verifyCategoryIdByGuild && typeof state.verifyCategoryIdByGuild === 'object' ? { ...state.verifyCategoryIdByGuild } : {};
            byGuild[interaction.guildId] = category.id;
            savePanelState({ ...state, verifyCategoryId: category.id, verifyCategoryIdByGuild: byGuild }, true);
            await safeEphemeral(interaction, `✅ Verification channels will be created in **${category.name}**.\n\n_(Settings saved to Bot_Runtime_State sheet — persisted across redeploys.)_`);
        } else if (interaction.commandName === 'welcome_set') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const announceCh = interaction.options.getChannel('announcements_channel', true);
            const welcomeCh = interaction.options.getChannel('welcome_channel');
            const state = loadPanelState();
            const welcomeConfig = state.welcomeConfig && typeof state.welcomeConfig === 'object' ? state.welcomeConfig : {};
            welcomeConfig[interaction.guildId] = {
                announcementsChannelId: announceCh.id,
                welcomeChannelId: welcomeCh?.id || null
            };
            savePanelState({ ...state, welcomeConfig }, true);
            const targetWelcomeId = welcomeCh?.id || null;
            const msg = targetWelcomeId
                ? `✅ Welcome messages will be posted in <#${targetWelcomeId}>.\n📢 Announcement guidance channel: <#${announceCh.id}>.`
                : `⚠️ No welcome channel set. Please run \`/welcome_set\` again with \`welcome_channel\`.\n📢 Announcement guidance channel: <#${announceCh.id}>.`;
            await safeEphemeral(interaction, msg);
        } else if (interaction.commandName === 'welcome_send') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const targetUser = interaction.options.getUser('user', true);
            const state = loadPanelState();
            const cfg = state.welcomeConfig && state.welcomeConfig[interaction.guildId];
            if (!cfg?.announcementsChannelId) {
                await safeEphemeral(interaction, '❌ Welcome not configured. Run `/welcome_set announcements_channel:<channel>` first.');
                return;
            }
            const guild = interaction.guild;
            const embed = new EmbedBuilder()
                .setTitle('👋 Welcome!')
                .setDescription(
                    `Welcome to **${guild.name}**!\n\n` +
                    `1) 📢 **Announcements** — Check <#${cfg.announcementsChannelId}> first for server updates.\n` +
                    `2) ✅ **Join Verification** — Run \`/join_verify\` to complete registration.\n` +
                    `3) 📘 **Help** — Run \`/help\` for command overview and onboarding links.\n\n` +
                    `Welcome channel guidance is managed by staff.`
                )
                .setColor(0x5865F2)
                .setTimestamp();
            const welcomeChannel = cfg.welcomeChannelId
                ? guild.channels.cache.get(cfg.welcomeChannelId) || await guild.channels.fetch(cfg.welcomeChannelId).catch(() => null)
                : null;
            if (welcomeChannel && welcomeChannel.isTextBased()) {
                await welcomeChannel.send({ content: `${targetUser}`, embeds: [embed] });
                await safeEphemeral(interaction, `✅ Welcome sent to <#${welcomeChannel.id}> for ${targetUser}.`);
            } else {
                await safeEphemeral(interaction, '❌ Welcome channel is not configured or inaccessible. Run `/welcome_set` with `welcome_channel`.');
            }
        } else if (interaction.commandName === 'link_channel_set') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const tacticsCat = interaction.options.getString('category');
            const parentCat = interaction.options.getChannel('parent');
            const state = loadPanelState();
            const catByGuild = state.linkTargetTacticsCategoryByGuild && typeof state.linkTargetTacticsCategoryByGuild === 'object' ? { ...state.linkTargetTacticsCategoryByGuild } : {};
            const parentByGuild = state.linkTargetParentCategoryIdByGuild && typeof state.linkTargetParentCategoryIdByGuild === 'object' ? { ...state.linkTargetParentCategoryIdByGuild } : {};
            delete catByGuild[interaction.guildId];
            delete parentByGuild[interaction.guildId];
            if (tacticsCat) {
                catByGuild[interaction.guildId] = tacticsCat;
                if (parentCat?.type === ChannelType.GuildCategory) parentByGuild[interaction.guildId] = parentCat.id;
                const targetCh = await resolveTacticsCategoryToChannel(interaction.guildId, tacticsCat, parentCat?.id);
                const label = getLinkCategoryLabel(tacticsCat);
                const hint = (TACTICS_CATEGORY_SEARCH_KEYS[tacticsCat] || [tacticsCat])[0];
                savePanelState({ ...state, linkTargetTacticsCategoryByGuild: catByGuild, linkTargetParentCategoryIdByGuild: parentByGuild }, true);
                await safeEphemeral(interaction, targetCh
                    ? `✅ Link results → **${label}** → <#${targetCh.id}>.\n\n**\`!link <url>\`** and **Add Link** will post there.`
                    : `✅ **${label}** set. No matching channel found${parentCat ? ` under **${parentCat.name}**` : ''}. Create a channel whose name contains \`${hint}\`.`);
            } else {
                savePanelState({ ...state, linkTargetTacticsCategoryByGuild: catByGuild, linkTargetParentCategoryIdByGuild: parentByGuild }, true);
                await safeEphemeral(interaction, '✅ Link target cleared. Results will post in **the channel where the command or button was used**.');
            }
        } else if (interaction.commandName === 'member_list_organize') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const merged = await rebuildMemberOrganizedSheet();
            if (!merged.ok) {
                await interaction.editReply({ content: `❌ Member list update failed: ${merged.error}` });
                return;
            }
            await interaction.editReply({ content: `✅ Member list updated: ${merged.count} row(s).` });
        } else if (interaction.commandName === 'guidebook_fetch') {
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            await interaction.editReply({ content: '⏳ Refreshing guidebook data…' });
            try {
                if (!CONFIG.GUIDEBOOK_ENABLE_SCRAPE) {
                    const local = buildLocalGuidebookFallbackState();
                    if ((local.categories?.length || 0) > 0) {
                        const normalized = applyGuidebookCategoryCoverage(local);
                        const total = (normalized.categories || []).reduce((n, c) => n + (c.guides?.length || 0), 0);
                        saveGuidebookState(normalized);
                        await interaction.editReply({ content: `✅ Guidebook refreshed from **local data**.\n${normalized.categories.length} categories, ${total} guides.\n**\`/panel type:guidebook_plaync\`** to post.` });
                    } else {
                        await interaction.editReply({ content: '❌ No local guidebook seed/data found. Please check `guidebook_official_seed.json`.' });
                    }
                    return;
                }

                let state = await withTimeout(
                    scrapePlayncGuidebookAll(),
                    GUIDEBOOK_FETCH_TIMEOUT_MS,
                    'guidebook_fetch'
                );
                let total = (state.categories || []).reduce((n, c) => n + (c.guides?.length || 0), 0);
                if ((state.categories?.length || 0) === 0 || total === 0) {
                    const fallback = buildLocalGuidebookFallbackState();
                    if ((fallback.categories?.length || 0) > 0) {
                        state = applyGuidebookCategoryCoverage(fallback);
                        total = (state.categories || []).reduce((n, c) => n + (c.guides?.length || 0), 0);
                        saveGuidebookState(state);
                        await interaction.editReply({ content: `⚠️ PlayNC scrape returned empty data. Loaded **local fallback** guidebook.\n✅ Ready: ${state.categories?.length || 0} categories, ${total} guides.\n**\`/panel type:guidebook_plaync\`** to post.` });
                    } else {
                        await interaction.editReply({ content: '❌ PlayNC scrape returned no data, and no local fallback files were found.' });
                    }
                    return;
                }
                state = applyGuidebookCategoryCoverage(state);
                saveGuidebookState(state);
                await interaction.editReply({ content: `✅ Guidebook fetched. ${state.categories?.length || 0} categories, ${total} guides.\n**\`/panel type:guidebook_plaync\`** to post.` });
            } catch (err) {
                console.error('[guidebook_fetch]', err);
                const fallback = buildLocalGuidebookFallbackState();
                if ((fallback.categories?.length || 0) > 0) {
                    const normalized = applyGuidebookCategoryCoverage(fallback);
                    const total = (normalized.categories || []).reduce((n, c) => n + (c.guides?.length || 0), 0);
                    saveGuidebookState(normalized);
                    await interaction.editReply({ content: `⚠️ Failed to scrape PlayNC: ${err.message}\nLoaded **local fallback** guidebook: ${normalized.categories.length} categories, ${total} guides.` }).catch(() => {});
                } else {
                    await interaction.editReply({ content: `❌ Failed: ${err.message}` }).catch(() => {});
                }
            }
        } else if (['preset','boss','cut','server_open','boss_add','boss_remove','boss_alert_mode','boss_event_multiplier','boss_fetch'].includes(interaction.commandName)) {
            const guildId = interaction.guildId;
            if (!guildId) { await safeEphemeral(interaction, 'This command can only be used in a guild.'); return; }
            const guildState = ensureBossGuildState(guildId);

            if (interaction.commandName === 'preset') {
                const mode = interaction.options.getString('mode');
                if (!mode) {
                    if (!Object.keys(guildState.bosses).length) {
                        await safeEphemeral(interaction, 'No bosses configured yet. Run `/preset mode:combined` first.');
                        return;
                    }
                    await interaction.reply({ embeds: [buildBossListEmbed(guildState)], flags: EPHEMERAL_FLAGS });
                    return;
                }
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                const bosses = listPreset(mode);
                guildState.bosses = {};
                for (const b of bosses) {
                    const key = normalizeBossName(b.name);
                    guildState.bosses[key] = { name: b.name, respawnMinutes: b.respawnMinutes, nextSpawnAt: null, lastCutAt: null, warnedForSpawnAt: null, announcedForSpawnAt: null };
                }
                guildState.bossChannelId = interaction.channelId;
                saveBossState();
                await interaction.reply({ content: `Preset applied (${mode}) with ${bosses.length} bosses. Alert channel set to <#${interaction.channelId}>.`, flags: EPHEMERAL_FLAGS });
            } else if (interaction.commandName === 'boss') {
                if (!Object.keys(guildState.bosses).length) { await safeEphemeral(interaction, 'No bosses configured. Run `/preset` first.'); return; }
                const input = interaction.options.getString('boss_name');
                if (!input) {
                    await interaction.reply({ embeds: [buildBossListEmbed(guildState)], flags: EPHEMERAL_FLAGS });
                    return;
                }
                const resolved = resolveBoss(guildState, input);
                if (resolved.error === 'missing') { await safeEphemeral(interaction, 'Boss not found.'); return; }
                if (resolved.error === 'ambiguous') { await safeEphemeral(interaction, `Multiple matches: ${resolved.matches.map(b=>b.name).join(', ')}`); return; }
                await interaction.reply({ embeds: [buildSingleBossEmbed(guildState, resolved.boss)], flags: EPHEMERAL_FLAGS });
            } else if (interaction.commandName === 'cut') {
                const input = interaction.options.getString('boss_name', true);
                const resolved = resolveBoss(guildState, input);
                if (resolved.error === 'missing') { await safeEphemeral(interaction, 'Boss not found.'); return; }
                if (resolved.error === 'ambiguous') { await safeEphemeral(interaction, `Multiple matches: ${resolved.matches.map(b=>b.name).join(', ')}`); return; }
                const killedAtInput = interaction.options.getString('killed_at');
                const killedAt = killedAtInput ? parseTodayTime(killedAtInput, true) : new Date();
                if (!killedAt) { await safeEphemeral(interaction, 'Invalid time format. Use HH:mm.'); return; }
                const boss = resolved.boss;
                boss.lastCutAt = killedAt.getTime();
                boss.nextSpawnAt = boss.lastCutAt + getEffectiveRespawnMinutes(guildState, boss) * 60_000;
                boss.warnedForSpawnAt = null;
                boss.announcedForSpawnAt = null;
                saveBossState();
                await interaction.reply({ content: `Cut recorded for **${boss.name}**.\nNext spawn: ${toDiscordTime(boss.nextSpawnAt)}\nRespawn applied: ${getEffectiveRespawnMinutes(guildState, boss)}m`, flags: EPHEMERAL_FLAGS });
            } else if (interaction.commandName === 'server_open') {
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                if (!Object.keys(guildState.bosses).length) { await safeEphemeral(interaction, 'No bosses configured. Run `/preset` first.'); return; }
                const openTime = interaction.options.getString('open_time', true);
                const parsed = parseTodayTime(openTime, false);
                if (!parsed) { await safeEphemeral(interaction, 'Invalid time format. Use HH:mm.'); return; }
                for (const boss of Object.values(guildState.bosses)) {
                    boss.lastCutAt = parsed.getTime();
                    boss.nextSpawnAt = parsed.getTime() + getEffectiveRespawnMinutes(guildState, boss) * 60_000;
                    boss.warnedForSpawnAt = null;
                    boss.announcedForSpawnAt = null;
                }
                guildState.bossChannelId = guildState.bossChannelId || interaction.channelId;
                saveBossState();
                await interaction.reply({ content: `All boss timers were reset from ${openTime}.`, flags: EPHEMERAL_FLAGS });
            } else if (interaction.commandName === 'boss_add') {
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                const name = interaction.options.getString('boss_name', true).trim();
                const respawnMinutes = interaction.options.getInteger('respawn_minutes', true);
                const key = normalizeBossName(name);
                const existing = guildState.bosses[key];
                guildState.bosses[key] = { name, respawnMinutes, nextSpawnAt: existing?.nextSpawnAt || null, lastCutAt: existing?.lastCutAt || null, warnedForSpawnAt: existing?.warnedForSpawnAt || null, announcedForSpawnAt: existing?.announcedForSpawnAt || null };
                if (!guildState.bossChannelId) guildState.bossChannelId = interaction.channelId;
                saveBossState();
                await interaction.reply({ content: `Boss saved: **${name}** (${respawnMinutes}m).`, flags: EPHEMERAL_FLAGS });
            } else if (interaction.commandName === 'boss_remove') {
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                const name = interaction.options.getString('boss_name', true);
                const resolved = resolveBoss(guildState, name);
                if (resolved.error) { await safeEphemeral(interaction, 'Boss not found.'); return; }
                delete guildState.bosses[normalizeBossName(resolved.boss.name)];
                saveBossState();
                await interaction.reply({ content: `Boss removed: **${resolved.boss.name}**.`, flags: EPHEMERAL_FLAGS });
            } else if (interaction.commandName === 'boss_fetch') {
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                const urlInput = interaction.options.getString('url') || '';
                const url = urlInput === 'local' || (!urlInput && fs.existsSync(path.join(__dirname, 'boss_presets.json')))
                    ? null
                    : (urlInput || BOSS_FETCH_DEFAULT_URL);
                const mode = interaction.options.getString('mode') || 'combined';
                let parsed = null;
                try {
                    if (url) {
                        parsed = await fetchBossListFromUrl(url);
                    } else {
                        const localPath = path.join(__dirname, 'boss_presets.json');
                        const raw = fs.readFileSync(localPath, 'utf8');
                        parsed = parseBossListFromJson(JSON.parse(raw));
                    }
                } catch (err) {
                    await interaction.editReply({ content: `❌ Fetch failed: ${err.message}\n\nUse a JSON URL with format: \`{ "elyos": [{ "name": "...", "respawnMinutes": 360 }], "asmodian": [...] }\`` }).catch(() => {});
                    return;
                }
                if (!parsed) {
                    await interaction.editReply({ content: `❌ No valid boss data from URL. Expected JSON: \`{ "elyos": [...], "asmodian": [...] }\` or \`{ "bosses": [{ "name", "respawnMinutes" }] }\`` }).catch(() => {});
                    return;
                }
                const bosses = mode === 'elyos' ? parsed.elyos : mode === 'asmodian' ? parsed.asmodian : parsed.all;
                if (!bosses.length) {
                    await interaction.editReply({ content: `❌ No bosses for mode \`${mode}\`.` }).catch(() => {});
                    return;
                }
                guildState.bosses = {};
                for (const b of bosses) {
                    const key = normalizeBossName(b.name);
                    guildState.bosses[key] = {
                        name: b.name,
                        respawnMinutes: b.respawnMinutes,
                        nextSpawnAt: null,
                        lastCutAt: null,
                        warnedForSpawnAt: null,
                        announcedForSpawnAt: null,
                        location: b.location || null,
                        description: b.description || null,
                        image: b.image || null,
                        level: b.level != null ? b.level : null,
                        faction: b.faction || null,
                    };
                }
                guildState.bossChannelId = guildState.bossChannelId || interaction.channelId;
                saveBossState();
                await interaction.editReply({ content: `✅ Fetched **${bosses.length}** bosses from URL and applied.\n\n${bosses.map(b => `- ${b.name} (${b.respawnMinutes}m)${b.location ? ` @ ${b.location}` : ''}`).join('\n')}` }).catch(() => {});
            } else if (interaction.commandName === 'boss_alert_mode') {
                const mode = interaction.options.getString('mode', true);
                const current = new Set(guildState.bossSettings.dmSubscribers || []);
                if (mode === 'dm') current.add(interaction.user.id);
                else current.delete(interaction.user.id);
                guildState.bossSettings.dmSubscribers = [...current];
                if (!guildState.bossChannelId) guildState.bossChannelId = interaction.channelId;
                saveBossState();
                await interaction.reply({ content: mode === 'dm' ? 'Boss alerts will be delivered to your DM. If DM fails, alerts fall back to the alert channel.' : 'Boss alerts for you are switched to public channel mode.', flags: EPHEMERAL_FLAGS });
            } else if (interaction.commandName === 'boss_event_multiplier') {
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                const multiplier = interaction.options.getNumber('multiplier', true);
                guildState.bossSettings.eventMultiplier = multiplier;
                saveBossState();
                await interaction.reply({ content: `Event respawn multiplier set to ${multiplier}x.`, flags: EPHEMERAL_FLAGS });
            }
        } else if (['mvp', 'mvp_set'].includes(interaction.commandName)) {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const mvpGuild = ensureMvpGuildState(interaction.guildId);
            if (interaction.commandName === 'mvp') {
                const sched = mvpGuild.schedule || {};
                const lines = MVP_DAY_NAMES.map(d => `**${d}:** ${sched[d] || '—'}`);
                const embed = new EmbedBuilder()
                    .setTitle('MVP Schedule')
                    .setDescription(lines.join('\n') || 'No schedule set. Use `/mvp_set` to configure.')
                    .setColor(0x9333ea)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], flags: EPHEMERAL_FLAGS });
            } else if (interaction.commandName === 'mvp_set') {
                const day = interaction.options.getString('day', true);
                const timeStr = interaction.options.getString('time', true);
                if (!parseTime24(timeStr)) { await safeEphemeral(interaction, 'Invalid time format. Use HH:mm (e.g. 20:00).'); return; }
                mvpGuild.schedule[day] = timeStr;
                if (!mvpGuild.channelId) mvpGuild.channelId = interaction.channelId;
                saveMvpScheduleState();
                await interaction.reply({ content: `✅ MVP **${day}** set to **${timeStr}**.`, flags: EPHEMERAL_FLAGS });
            }
        } else if (interaction.commandName.startsWith('kinah_watch_')) {
            const guildId = interaction.guildId;
            if (!guildId) { await safeEphemeral(interaction, 'This command can only be used in a guild.'); return; }
            const guildState = ensureKinahGuildState(guildId);

            if (interaction.commandName === 'kinah_watch_preset') {
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                const preset = interaction.options.getString('preset', true);
                const presetConfig = KINAH_PRESET_DEFAULTS[preset];
                if (!presetConfig) { await safeEphemeral(interaction, 'Invalid preset value.'); return; }
                const channel = interaction.options.getChannel('channel', true);
                const pollMinutes = interaction.options.getInteger('poll_minutes') ?? 5;
                const mentionRole = interaction.options.getRole('mention_role');
                const sourceKeyword = (interaction.options.getString('source_keyword') || '').trim() || presetConfig.sourceKeyword || 'AION2 kinah';

                const watch = createDefaultKinahWatch(guildState.kinah);
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
                try {
                    snapshot = await fetchKinahRateSnapshot(watch);
                    const stable = applyKinahStability(watch, snapshot.numeric);
                    watch.lastRate = stable;
                    watch.stableRate = stable;
                    watch.lastRawText = snapshot.token;
                    watch.lastSourceSummary = snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null;
                    watch.lastCheckedAt = Date.now();
                    snapshot = {
                        ...snapshot,
                        rawToken: snapshot.token,
                        rawNumeric: snapshot.numeric,
                        token: formatKrw(stable),
                        numeric: stable,
                    };
                } catch (err) {
                    watch.lastError = err.message || 'Initial preset fetch failed.';
                }

                guildState.kinah = watch;
                saveKinahState();
                const embeds = [buildKinahStatusEmbed(guildState)];
                if (snapshot) embeds.push(buildKinahRateEmbed(snapshot, null));
                await interaction.editReply({ embeds });
            } else if (interaction.commandName === 'kinah_watch_set') {
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                const channel = interaction.options.getChannel('channel', true);
                const sourceUrl = interaction.options.getString('source_url', true).trim();
                const selector = (interaction.options.getString('selector') || '').trim();
                const valueRegex = (interaction.options.getString('value_regex') || '').trim();
                const pollMinutes = interaction.options.getInteger('poll_minutes') ?? 5;
                const mentionRole = interaction.options.getRole('mention_role');

                try {
                    const u = new URL(sourceUrl);
                    if (!['https:', 'http:'].includes(u.protocol)) { await safeEphemeral(interaction, 'source_url must be http(s).'); return; }
                } catch (_) {
                    await safeEphemeral(interaction, 'source_url is invalid.');
                    return;
                }
                if (valueRegex) {
                    try { new RegExp(valueRegex, 'i'); } catch (err) { await safeEphemeral(interaction, `Invalid value_regex: ${err.message}`); return; }
                }
                const watch = createDefaultKinahWatch(guildState.kinah);
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
                try {
                    snapshot = await fetchKinahRateSnapshot(watch);
                    const stable = applyKinahStability(watch, snapshot.numeric);
                    watch.lastRate = stable;
                    watch.stableRate = stable;
                    watch.lastRawText = snapshot.token;
                    watch.lastSourceSummary = snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null;
                    watch.lastCheckedAt = Date.now();
                    snapshot = {
                        ...snapshot,
                        rawToken: snapshot.token,
                        rawNumeric: snapshot.numeric,
                        token: formatKrw(stable),
                        numeric: stable,
                    };
                } catch (err) {
                    watch.lastError = err.message || 'Initial fetch failed.';
                }

                guildState.kinah = watch;
                saveKinahState();
                const embeds = [buildKinahStatusEmbed(guildState)];
                if (snapshot) embeds.push(buildKinahRateEmbed(snapshot, null));
                await interaction.editReply({ embeds });
            } else if (interaction.commandName === 'kinah_watch_status') {
                await interaction.reply({ embeds: [buildKinahStatusEmbed(guildState)], flags: EPHEMERAL_FLAGS });
            } else if (interaction.commandName === 'kinah_watch_stop') {
                if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
                const watch = createDefaultKinahWatch(guildState.kinah);
                watch.enabled = false;
                watch.rateHistory = [];
                watch.stableRate = null;
                guildState.kinah = watch;
                saveKinahState();
                await interaction.reply({ content: 'Kinah rate crawler stopped for this guild.', flags: EPHEMERAL_FLAGS });
            } else if (interaction.commandName === 'kinah_watch_now') {
                const watch = createDefaultKinahWatch(guildState.kinah);
                if (!watch.sourceUrl) {
                    await safeEphemeral(interaction, 'Kinah crawler is not configured. Run `/kinah_watch_preset` or `/kinah_watch_set` first.');
                    return;
                }
                let snapshot;
                try {
                    snapshot = await fetchKinahRateSnapshot(watch);
                } catch (err) {
                    watch.lastError = err.message || 'Fetch failed';
                    guildState.kinah = watch;
                    saveKinahState();
                    await interaction.editReply({ content: `Failed to fetch kinah rate: ${watch.lastError}` });
                    return;
                }

                const previousRate = watch.lastRate;
                const stable = applyKinahStability(watch, snapshot.numeric);
                watch.lastRate = stable;
                watch.stableRate = stable;
                watch.lastRawText = snapshot.token;
                watch.lastSourceSummary = snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null;
                watch.lastCheckedAt = Date.now();
                watch.lastError = null;
                guildState.kinah = watch;
                saveKinahState();

                const stableSnapshot = {
                    ...snapshot,
                    rawToken: snapshot.token,
                    rawNumeric: snapshot.numeric,
                    token: formatKrw(stable),
                    numeric: stable,
                };
                const embed = buildKinahRateEmbed(stableSnapshot, previousRate);
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
        } else if (interaction.commandName === 'market_setup') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const marketChannel = interaction.options.getChannel('market_channel', true);
            const ticketCategory = interaction.options.getChannel('ticket_category', true);
            const adminRole = interaction.options.getRole('admin_role', true);
            const feePercent = clampNumber(interaction.options.getNumber('fee_percent') ?? 3, 0, 20, 3);
            if (!marketChannel.isTextBased()) {
                await safeEphemeral(interaction, 'market_channel must be a text or announcement channel.');
                return;
            }
            if (ticketCategory.type !== ChannelType.GuildCategory) {
                await safeEphemeral(interaction, 'ticket_category must be a category channel.');
                return;
            }
            const state = loadPanelState();
            const collections = ensureMarketCollections(state, interaction.guildId);
            collections.marketConfigByGuild[interaction.guildId] = {
                marketChannelId: marketChannel.id,
                ticketCategoryId: ticketCategory.id,
                adminRoleId: adminRole.id,
                feePercent,
            };
            savePanelState(state, true);
            await interaction.reply({
                content:
                    `✅ Global market setup saved.\n` +
                    `• Market channel: <#${marketChannel.id}>\n` +
                    `• Ticket category: **${ticketCategory.name}**\n` +
                    `• Escrow admin role: <@&${adminRole.id}>\n` +
                    `• Escrow fee: **${feePercent.toFixed(1)}%**`,
                flags: EPHEMERAL_FLAGS
            });
        } else if (interaction.commandName === 'market_status') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            const state = loadPanelState();
            const { listings, tickets } = ensureMarketCollections(state, interaction.guildId);
            const marketConfig = getMarketConfigForGuild(state, interaction.guildId);
            const openListingCount = Object.values(listings || {}).filter(item => item?.status === 'open').length;
            const openTicketCount = Object.values(tickets || {}).filter(item => item?.status !== 'completed' && item?.status !== 'closed').length;
            const configured = Boolean(marketConfig.marketChannelId && marketConfig.ticketCategoryId && marketConfig.adminRoleId);
            const embed = new EmbedBuilder()
                .setTitle('🌐 TETRA Global Market Status')
                .setColor(configured ? 0x22c55e : 0xf59e0b)
                .setDescription(
                    [
                        `Configured: **${configured ? 'Yes' : 'No'}**`,
                        `Market channel: ${marketConfig.marketChannelId ? `<#${marketConfig.marketChannelId}>` : 'Not set'}`,
                        `Ticket category: ${marketConfig.ticketCategoryId ? `<#${marketConfig.ticketCategoryId}>` : 'Not set'}`,
                        `Escrow admin role: ${marketConfig.adminRoleId ? `<@&${marketConfig.adminRoleId}>` : 'Not set'}`,
                        `Escrow fee: **${marketConfig.feePercent.toFixed(1)}%**`,
                        `Open listings: **${openListingCount}**`,
                        `Open tickets: **${openTicketCount}**`,
                    ].join('\n')
                )
                .setFooter({ text: configured ? 'Anti-Scam escrow mode active' : 'Run /market_setup to activate escrow mode' })
                .setTimestamp();
            await interaction.reply({ embeds: [embed], flags: EPHEMERAL_FLAGS });
        } else if (interaction.commandName === 'wts' || interaction.commandName === 'wtb') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            await interaction.deferReply({ flags: EPHEMERAL_FLAGS }).catch(() => {});
            const listingType = interaction.commandName === 'wts' ? 'WTS' : 'WTB';
            const amount = interaction.options.getInteger('amount', true);
            const price = interaction.options.getNumber('price', true);
            const currency = String(interaction.options.getString('currency', true) || 'USD').toUpperCase();
            const note = String(interaction.options.getString('note') || '').trim().slice(0, 400);
            if (!MARKET_LISTING_TYPES.includes(listingType)) {
                await interaction.editReply({ content: 'Invalid listing type.' }).catch(() => {});
                return;
            }
            if (!MARKET_CURRENCIES.includes(currency)) {
                await interaction.editReply({ content: `Unsupported currency. Use one of: ${MARKET_CURRENCIES.join(', ')}` }).catch(() => {});
                return;
            }
            const state = loadPanelState();
            const collections = ensureMarketCollections(state, interaction.guildId);
            const marketConfig = getMarketConfigForGuild(state, interaction.guildId);
            if (!marketConfig.marketChannelId || !marketConfig.ticketCategoryId || !marketConfig.adminRoleId) {
                await interaction.editReply({ content: '❌ Escrow market is not configured. Admin must run `/market_setup` first.' }).catch(() => {});
                return;
            }
            const listingChannel = interaction.guild.channels.cache.get(marketConfig.marketChannelId)
                || await interaction.guild.channels.fetch(marketConfig.marketChannelId).catch(() => null);
            if (!listingChannel || !listingChannel.isTextBased()) {
                await interaction.editReply({ content: '❌ Market channel is missing or not text-based. Admin: run `/market_setup` again.' }).catch(() => {});
                return;
            }
            const listingId = createMarketListingId();
            const conversions = await getMarketPriceConversions(price, currency);
            const trustScore = getTrustScore(state, interaction.guildId, interaction.user.id);
            const listing = {
                id: listingId,
                type: listingType,
                ownerId: interaction.user.id,
                ownerTag: interaction.user.tag || interaction.user.username,
                amount,
                price,
                currency,
                note,
                feePercent: marketConfig.feePercent,
                createdAt: Date.now(),
                status: 'open',
                channelId: listingChannel.id,
                messageId: null,
                matchedAt: null,
                matchedBy: null,
                matchedTicketChannelId: null,
                completedAt: null,
            };
            const embed = buildMarketListingEmbed({
                listingType,
                amount,
                totalPrice: price,
                currency,
                note,
                ownerTag: `${interaction.user}`,
                trustScore,
                feePercent: marketConfig.feePercent,
                conversions,
            });
            const buttonLabel = listingType === 'WTS' ? '🤝 Purchase Request (Open Escrow)' : '🤝 Sell Offer (Open Escrow)';
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`market_buy_${listingId}`)
                    .setLabel(buttonLabel)
                    .setStyle(ButtonStyle.Success)
            );
            let sent;
            try {
                sent = await listingChannel.send({ embeds: [embed], components: [row] });
            } catch (err) {
                await interaction.editReply({ content: `❌ Failed to post listing: ${err.message}` }).catch(() => {});
                return;
            }
            listing.messageId = sent.id;
            collections.listings[listingId] = listing;
            savePanelState(state, true);
            await interaction.editReply({
                content:
                    `✅ ${listingType} listing posted to <#${listingChannel.id}>.\n` +
                    `• Listing ID: \`${listingId}\`\n` +
                    `• Ticket mode: 3-party escrow only\n` +
                    `• Link: ${sent.url}`
            }).catch(() => {});
        } else if (interaction.commandName === 'trust') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            const target = interaction.options.getUser('user') || interaction.user;
            const state = loadPanelState();
            const score = getTrustScore(state, interaction.guildId, target.id);
            const tier = getTrustTier(score);
            const asc = [...TRUST_TIER_RULES].sort((a, b) => a.min - b.min);
            const nextTier = asc.find(t => score < t.min);
            const roleMap = getTrustRoleMapForGuild(state, interaction.guildId);
            const tierRole = tier ? asSnowflake(roleMap[tier.key]) : null;
            const embed = new EmbedBuilder()
                .setTitle('🏅 Trust Rating')
                .setColor(tier ? 0x22c55e : 0x94a3b8)
                .setDescription(
                    [
                        `User: ${target}`,
                        `Score: **${score}**`,
                        `Tier: **${tier ? `${tier.emoji} ${tier.label}` : 'Unranked'}**`,
                        `Tier role: ${tierRole ? `<@&${tierRole}>` : 'Not configured'}`,
                        nextTier ? `Next tier: **${nextTier.label}** in ${nextTier.min - score} point(s)` : 'Next tier: Max tier reached',
                    ].join('\n')
                )
                .setFooter({ text: 'Trust +1 is added automatically when escrow trade is completed by admin.' })
                .setTimestamp();
            await interaction.reply({ embeds: [embed], flags: EPHEMERAL_FLAGS });
        } else if (interaction.commandName === 'trust_add') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            await interaction.deferReply({ flags: EPHEMERAL_FLAGS }).catch(() => {});
            const target = interaction.options.getUser('user', true);
            const delta = interaction.options.getInteger('points', true);
            const reason = String(interaction.options.getString('reason') || 'Manual admin adjustment').slice(0, 200);
            const state = loadPanelState();
            const result = addTrustScore(state, interaction.guildId, target.id, delta);
            const roleMap = getTrustRoleMapForGuild(state, interaction.guildId);
            await syncTrustRolesForMember(interaction.guild, target.id, roleMap, result.current).catch(() => {});
            savePanelState(state, true);
            await interaction.editReply({
                content:
                    `✅ Trust updated for ${target}\n` +
                    `• Change: ${delta >= 0 ? '+' : ''}${delta}\n` +
                    `• Score: ${result.previous} → **${result.current}**\n` +
                    `• Tier: ${formatTrustBadge(result.current)}\n` +
                    `• Reason: ${reason}`
            }).catch(() => {});
        } else if (interaction.commandName === 'trust_role_set') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const tier = interaction.options.getString('tier', true);
            const role = interaction.options.getRole('role', true);
            if (!['bronze', 'silver', 'gold'].includes(tier)) {
                await safeEphemeral(interaction, 'Invalid tier.');
                return;
            }
            const state = loadPanelState();
            const collections = ensureMarketCollections(state, interaction.guildId);
            const current = getTrustRoleMapForGuild(state, interaction.guildId);
            current[tier] = role.id;
            collections.trustRoleMapByGuild[interaction.guildId] = current;
            savePanelState(state, true);
            await interaction.reply({
                content: `✅ Trust tier role mapped: **${tier.toUpperCase()}** → ${role}`,
                flags: EPHEMERAL_FLAGS
            });
        } else if (interaction.commandName === 'payment_ocr_set') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const channel = interaction.options.getChannel('channel', true);
            const enabled = interaction.options.getBoolean('enabled');
            const minConfidence = interaction.options.getInteger('min_confidence');
            if (!channel.isTextBased()) {
                await safeEphemeral(interaction, 'Please select a text/announcement channel.');
                return;
            }
            const state = loadPanelState();
            if (!state.paymentOcrConfigByGuild || typeof state.paymentOcrConfigByGuild !== 'object') state.paymentOcrConfigByGuild = {};
            if (!state.paymentChannelIdByGuild || typeof state.paymentChannelIdByGuild !== 'object') state.paymentChannelIdByGuild = {};
            const prev = getPaymentOcrConfigForGuild(state, interaction.guildId);
            state.paymentOcrConfigByGuild[interaction.guildId] = {
                enabled: enabled == null ? prev.enabled : Boolean(enabled),
                channelId: channel.id,
                minConfidence: minConfidence == null ? prev.minConfidence : clampNumber(minConfidence, 0, 100, 45),
            };
            state.paymentChannelIdByGuild[interaction.guildId] = channel.id;
            savePanelState(state, true);
            const cfg = getPaymentOcrConfigForGuild(state, interaction.guildId);
            await interaction.reply({
                content:
                    `✅ Payment OCR automation updated.\n` +
                    `• Channel: <#${cfg.channelId}>\n` +
                    `• Enabled: **${cfg.enabled ? 'Yes' : 'No'}**\n` +
                    `• Low-confidence threshold: **${cfg.minConfidence}%**\n` +
                    `\n이제 이 채널에 영수증 이미지를 올리면 OCR 후 **Payment Log** 시트에 자동 적재됩니다.`,
                flags: EPHEMERAL_FLAGS
            });
        } else if (interaction.commandName === 'payment_ocr_status') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            const state = loadPanelState();
            const cfg = getPaymentOcrConfigForGuild(state, interaction.guildId);
            const embed = new EmbedBuilder()
                .setTitle('🧾 Payment OCR Status')
                .setColor(cfg.enabled ? 0x22c55e : 0xf59e0b)
                .setDescription(
                    [
                        `Enabled: **${cfg.enabled ? 'Yes' : 'No'}**`,
                        `Channel: ${cfg.channelId ? `<#${cfg.channelId}>` : 'Not set'}`,
                        `Low-confidence threshold: **${cfg.minConfidence}%**`,
                        '',
                        'Flow: Upload receipt image -> OCR parse -> append to `Payment Log` (A:G).',
                    ].join('\n')
                )
                .setTimestamp();
            await interaction.reply({ embeds: [embed], flags: EPHEMERAL_FLAGS });
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
            await interaction.reply({ embeds: [buildAonTranslateStatusEmbed(g)], flags: EPHEMERAL_FLAGS });
        } else if (interaction.commandName === 'aon_translate_source') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            if (!hasManageGuild(interaction)) { await safeEphemeral(interaction, 'Manage Server permission is required.'); return; }
            const botId = String(interaction.options.getString('bot_id', true)).trim();
            if (!/^\d{17,20}$/.test(botId)) { await safeEphemeral(interaction, 'Invalid bot_id format.'); return; }
            const g = ensureAonTranslateGuildState(interaction.guildId);
            g.sourceBotId = botId;
            g.enabled = true;
            saveAonTranslateState();
            await interaction.reply({ embeds: [buildAonTranslateStatusEmbed(g)], flags: EPHEMERAL_FLAGS });
        } else if (interaction.commandName === 'aon_translate_status') {
            if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only command.'); return; }
            const g = ensureAonTranslateGuildState(interaction.guildId);
            await interaction.reply({ embeds: [buildAonTranslateStatusEmbed(g)], flags: EPHEMERAL_FLAGS });
        } else if (interaction.commandName === 'youtube_ready') {
            const videoInput = interaction.options.getString('video', true);
            const postCard = interaction.options.getBoolean('post_card') ?? true;
            await interaction.deferReply(postCard ? {} : { flags: EPHEMERAL_FLAGS });
            try {
                const ready = await fetchYouTubeVideoReadyInfo(videoInput);
                if (postCard) {
                    await interaction.editReply({
                        content: buildYouTubeReadyCardMessage(ready),
                        allowedMentions: { parse: [] },
                    });
                } else {
                    await interaction.editReply({ embeds: [buildYouTubeReadyEmbed(ready)] });
                }
            } catch (err) {
                await interaction.editReply({ content: `❌ YouTube processing failed: ${err.message || 'Unknown error'}` });
            }
        } else if (interaction.commandName === 'item') {
            const query = (interaction.options.getString('query', true) || '').trim();
            if (!query) { await safeEphemeral(interaction, 'Please enter an item name or keyword.'); return; }
            const displayQuery = await translateQueryForDisplay(query);
            await interaction.reply({ embeds: [buildItemLookupEmbed(query, displayQuery)], flags: EPHEMERAL_FLAGS });
        } else if (interaction.commandName === 'collection') {
            const query = (interaction.options.getString('query', true) || '').trim();
            if (!query) { await safeEphemeral(interaction, 'Please enter a stat keyword (e.g. crit, accuracy).'); return; }
            let scraped = await scrapeTalentbuildsDb(query, 'armor').catch(() => null);
            if (!scraped?.items?.length) scraped = await scrapeTalentbuildsDb(query, 'accessories').catch(() => null);
            if (!scraped?.items?.length) scraped = await scrapeTalentbuildsDb(query, 'weapons').catch(() => null);
            if (scraped?.items?.length) scraped = { ...scraped, items: await translateItemNamesToEn(scraped.items) };
            const displayQuery = await translateQueryForDisplay(query);
            await interaction.editReply({ embeds: [buildCollectionLookupEmbed(query, scraped, displayQuery)] });
        } else if (interaction.commandName === 'build') {
            const query = (interaction.options.getString('query', true) || '').trim();
            if (!query) { await safeEphemeral(interaction, 'Please enter a class or build keyword.'); return; }
            let scraped = await scrapeTalentbuildsArmory(query).catch(() => null);
            if (scraped?.items?.length) scraped = { ...scraped, items: await translateItemNamesToEn(scraped.items) };
            const displayQuery = await translateQueryForDisplay(query);
            await interaction.editReply({ embeds: [buildBuildLookupEmbed(query, scraped, displayQuery)] });
        } else if (interaction.commandName === 'character') {
            const query = (interaction.options.getString('query', true) || '').trim();
            if (!query) { await safeEphemeral(interaction, 'Please enter a character name or profile URL.'); return; }
            const raceFilter = interaction.options.getString('race');
            const classKeyword = (interaction.options.getString('class_keyword') || '').trim().toLowerCase();
            await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
            const charDisplayQuery = await translateQueryForDisplay(query);
            const urlMatch = query.match(PLAYNC_CHAR_URL);
            const charUrl = urlMatch ? (query.startsWith('http') ? query : 'https://' + urlMatch[0]) : null;
            try {
                let charInfo;
                if (charUrl) {
                    charInfo = await scrapePlayncCharacter(charUrl);
                    charInfo.cp = charInfo.cp || '0';
                } else {
                    charInfo = await searchPlayncByName(query);
                    if (!charInfo) {
                        await interaction.editReply({ embeds: [buildLinkFallbackEmbed(query, true, charDisplayQuery)] });
                        return;
                    }
                    charInfo.cp = null;
                }
                const raceVal = (charInfo.race === '천족' || charInfo.race === 'Elyos') ? 'elyos' : (charInfo.race === '마족' || charInfo.race === 'Asmodian') ? 'asmodian' : null;
                if (raceFilter && raceVal && raceVal !== raceFilter) {
                    await interaction.editReply({ embeds: [buildLinkFallbackEmbed(query, true, charDisplayQuery)], content: `No match for race filter "${raceFilter}".` });
                    return;
                }
                if (classKeyword && charInfo.job && !String(charInfo.job).toLowerCase().includes(classKeyword)) {
                    await interaction.editReply({ embeds: [buildLinkFallbackEmbed(query, true, charDisplayQuery)], content: `No match for class keyword "${classKeyword}".` });
                    return;
                }
                const toEnRace = (r) => (r === '천족' ? 'Elyos' : r === '마족' ? 'Asmodian' : r) || 'N/A';
                const rawName = stripHtmlTags(charInfo.name || query) || query;
                const displayName = hasHangul(rawName) ? (await translateKoToEn(rawName) || rawName) : rawName;
                const displayJob = hasHangul(charInfo.job) ? (await translateKoToEn(charInfo.job) || charInfo.job) : charInfo.job;
                const enc = encodeURIComponent(rawName);
                const linkLine = `[Full Profile](${charInfo.link}) · [Talentbuilds](https://talentbuilds.com/aion2/armory?search=${enc}&region=korea) · [Shugo.GG](https://shugo.gg/?q=${enc})`;
                const embed = new EmbedBuilder()
                    .setTitle(`🛡️ TETRA INTEL: ${displayName}`)
                    .setDescription(`**${linkLine}**`)
                    .setThumbnail(charInfo.img || 'https://i.imgur.com/8fXU89V.png')
                    .addFields(
                        { name: '👤 Class', value: `\`${displayJob}\``, inline: true },
                        { name: '📊 Level', value: `\`Lv.${charInfo.level}\``, inline: true },
                        ...(charInfo.cp != null ? [{ name: '⚔️ Combat Power', value: `\`${charInfo.cp}\``, inline: true }] : []),
                        { name: '🌐 Server', value: charInfo.server || 'N/A', inline: true },
                        { name: '🏹 Race', value: toEnRace(charInfo.race) || charInfo.race || 'N/A', inline: true }
                    )
                    .setColor(0xFF0055)
                    .setTimestamp()
                    .setFooter({ text: (charInfo.resultCount && charInfo.resultCount > 1) ? `#1 of ${charInfo.resultCount}` : 'TETRA Streamer Portal' });
                await interaction.editReply({ embeds: [embed] });
                if (!charInfo.cp && charInfo.link) {
                    scrapePlayncCharacter(charInfo.link).then(async scraped => {
                        if (scraped?.cp) {
                            charInfo.cp = scraped.cp;
                            const enc2 = encodeURIComponent(stripHtmlTags(charInfo.name || query) || query);
                            const linkLine2 = `[Full Profile](${charInfo.link}) · [Talentbuilds](https://talentbuilds.com/aion2/armory?search=${enc2}&region=korea) · [Shugo.GG](https://shugo.gg/?q=${enc2})`;
                            const dName = hasHangul(charInfo.name) ? (await translateKoToEn(charInfo.name) || charInfo.name) : (charInfo.name || query);
                            const dJob = hasHangul(charInfo.job) ? (await translateKoToEn(charInfo.job) || charInfo.job) : charInfo.job;
                            const embed2 = new EmbedBuilder()
                                .setTitle(`🛡️ TETRA INTEL: ${dName}`)
                                .setDescription(`**${linkLine2}**`)
                                .setThumbnail(charInfo.img || 'https://i.imgur.com/8fXU89V.png')
                                .addFields(
                                    { name: '👤 Class', value: `\`${dJob}\``, inline: true },
                                    { name: '📊 Level', value: `\`Lv.${charInfo.level}\``, inline: true },
                                    { name: '⚔️ Combat Power', value: `\`${scraped.cp}\``, inline: true },
                                    { name: '🌐 Server', value: charInfo.server || 'N/A', inline: true },
                                    { name: '🏹 Race', value: toEnRace(charInfo.race) || 'N/A', inline: true }
                                )
                                .setColor(0xFF0055)
                                .setTimestamp();
                            interaction.editReply({ embeds: [embed2] }).catch(() => {});
                        }
                    }).catch(() => {});
                }
            } catch (err) {
                console.error('[/character] Error:', err.message);
                await interaction.editReply({ embeds: [buildLinkFallbackEmbed(query, true, charDisplayQuery)], content: '❌ Failed to load. Check links below.' });
            }
        } else if (interaction.commandName === 'panel') {
            if (!interaction.guild) {
                await interaction.editReply({ content: '❌ /panel can only be used in a server channel (not DM).' });
                return;
            }
            const kind = interaction.options.getString('type');
            let channel = interaction.channel;
            if (!channel && interaction.channelId) {
                channel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
                if (!channel) channel = await client.channels.fetch(interaction.channelId, { force: true }).catch(() => null);
            }
            if (!channel?.send) {
                await interaction.editReply({ content: '❌ Channel not found. Run /panel in a text channel.' });
                return;
            }
            const lockKey = `${kind}_${channel.id}`;
            if (panelUpdateLocks.has(lockKey)) {
                await interaction.editReply({ content: '⏳ Panel is updating. Please try again in 2 seconds.' });
                return;
            }
            panelUpdateLocks.add(lockKey);
            try {
            if (kind === 'report') {
                const regionOpt = (interaction.options.getString('region') || 'all').toLowerCase();
                const scopedRegionCfg = regionOpt === 'all' ? null : getRegionConfig(regionOpt);
                if (regionOpt !== 'all' && !scopedRegionCfg) {
                    await interaction.editReply({ content: `❌ Invalid region. Supported: ${SUPPORTED_REGION_CODES} or all.` });
                    return;
                }
                const embed = new EmbedBuilder()
                    .setTitle('📋 DAILY WORK LOG')
                    .setDescription(
                        '**Operational Excellence: TETRA Management**\n\n' +
                        `Scope: **${scopedRegionCfg ? `${scopedRegionCfg.label} (${scopedRegionCfg.code})` : `All Regions (${SUPPORTED_REGION_CODES})`}**\n\n` +
                        'Click **📊 Submit Report** -> choose Start/End + Team + Region.\n\n' +
                        '• **Start Kinah**: Login time(auto), Start Kinah, Memo\n' +
                        '• **End Kinah**: Logout time(auto), End Kinah, Spent Kinah, Memo\n' +
                        '  - Uses saved start record for calculation:\n' +
                        '    - `Net Profit = End - Start - Spent`\n' +
                        '    - `On-hand Delta = End - Start`\n' +
                        '    - `Gross Farmed = Delta + Spent`\n' +
                        '• **Start Level-Up**: Login time(auto), Start Level, Start CP, Memo\n' +
                        '• **End Level-Up**: Logout time(auto), End Level, End CP, Memo\n' +
                        '  - `Level Gain` / `CP Gain` auto-calculated from start record\n\n' +
                        `**Rules:** Numbers only, choose one of ${SUPPORTED_REGION_CODES}, submit Start before End.\n` +
                        '_Data syncs to management database automatically._'
                    )
                    .setColor(0x5865F2);
                const submitRow = buildDailySubmitButtonRowForRegion(scopedRegionCfg?.value || null);
                const files = [];
                const state = loadPanelState();
                const payload = { embeds: [embed], components: [submitRow], files: files.length ? files : undefined };
                const isReportPanel = m => m.author?.id === client.user?.id && (m.embeds[0]?.title?.includes('DAILY WORK LOG') || m.components?.some(c => c.components?.some(b => b.customId?.startsWith('btn_daily_submit') || b.customId?.startsWith('btn_kinah') || b.customId?.startsWith('btn_levelup'))));
                let allReportPanels = (await channel.messages.fetch({ limit: 100 })).filter(isReportPanel);
                for (const m of allReportPanels.values()) await m.delete().catch(() => {});
                const sent = await channel.send(payload);
                allReportPanels = (await channel.messages.fetch({ limit: 100 })).filter(isReportPanel);
                for (const m of allReportPanels.values()) {
                    if (m.id !== sent.id) await m.delete().catch(() => {});
                }
                savePanelState({ ...state, reportMsgId: sent.id, reportChannelId: channel.id });
                await interaction.editReply({
                    content: `✅ Daily Report panel updated (1 only). Scope: ${scopedRegionCfg ? scopedRegionCfg.code : 'ALL'}`
                });
            } else if (kind === 'kinah') {
                const embed = new EmbedBuilder()
                    .setTitle('💰 Kinah Rate')
                    .setDescription(
                        '**AION2 Kinah Exchange Rate**\n\n' +
                        '• Real-time rate from ItemBay / ItemMania (configurable)\n' +
                        '• Auto-posts to this channel when rate changes (if crawler enabled)\n\n' +
                        '**How to use:**\n' +
                        '• Click **Fetch Kinah Rate** below — instant rate check (result only you see)\n' +
                        '• Or use `/kinah_watch_now` — same as button\n' +
                        '• `/kinah_watch_status` — View crawler config & last value\n\n' +
                        '_Admin: Configure crawler with `/kinah_watch_preset` to enable auto-updates._'
                    )
                    .setColor(0x14b8a6)
                    .setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('btn_kinah_rate_fetch')
                        .setLabel('Fetch Kinah Rate')
                        .setEmoji('💰')
                        .setStyle(ButtonStyle.Primary)
                );
                const isKinahPanel = m => m.author?.id === client.user?.id && (m.embeds[0]?.title?.includes('Kinah Rate') || m.components?.some(c => c.components?.some(b => b.customId === 'btn_kinah_rate_fetch')));
                let allKinahPanels = (await channel.messages.fetch({ limit: 100 })).filter(isKinahPanel);
                for (const m of allKinahPanels.values()) await m.delete().catch(() => {});
                const sent = await channel.send({ embeds: [embed], components: [row] });
                allKinahPanels = (await channel.messages.fetch({ limit: 100 })).filter(isKinahPanel);
                for (const m of allKinahPanels.values()) {
                    if (m.id !== sent.id) await m.delete().catch(() => {});
                }
                const state = loadPanelState();
                savePanelState({ ...state, kinahMsgId: sent.id, kinahChannelId: channel.id });
                await interaction.editReply({ content: '✅ Kinah Rate panel updated (1 only).' });
            } else if (kind === 'boss') {
                const embed = new EmbedBuilder()
                    .setTitle('⚔️ Field Boss & MVP')
                    .setDescription(
                        '**Track field boss spawns and MVP schedule.**\n\n' +
                        '**Commands:**\n' +
                        '• **`/boss`** — Full boss board\n' +
                        '• **`/boss boss_name:<name>`** — Specific boss status (autocomplete)\n' +
                        '• **`/cut boss_name:<name>`** — Record kill (uses current time)\n' +
                        '• **`/cut boss_name:<name> killed_at:14:30`** — Record with custom time\n' +
                        '• **`/mvp`** — View MVP schedule\n' +
                        '• **`/boss_alert_mode mode:dm`** — Receive alerts via DM\n\n' +
                        '_Admin: `/preset mode:combined` or `/boss_fetch` to load boss list._'
                    )
                    .setColor(0xef4444)
                    .setTimestamp();
                const isBossPanel = m => m.author?.id === client.user?.id && m.embeds[0]?.title?.includes('Field Boss');
                let allBoss = (await channel.messages.fetch({ limit: 100 })).filter(isBossPanel);
                for (const m of allBoss.values()) await m.delete().catch(() => {});
                const sent = await channel.send({ embeds: [embed] });
                allBoss = (await channel.messages.fetch({ limit: 100 })).filter(isBossPanel);
                for (const m of allBoss.values()) {
                    if (m.id !== sent.id) await m.delete().catch(() => {});
                }
                await interaction.editReply({ content: '✅ Field Boss & MVP panel updated (1 only).' });
            } else if (kind === 'search') {
                const embed = new EmbedBuilder()
                    .setTitle('🔍 AION2 Search (Item · Character · Build · Collection)')
                    .setDescription(
                        '**Lookup AION2 info — results visible only to you (ephemeral).**\n\n' +
                        '**Commands:**\n' +
                        '• **`/character <name>`** — Character lookup by name or profile URL\n' +
                        '• **`/item <keyword>`** — Item lookup\n' +
                        '• **`/collection <stat>`** — Find equipment by stat (e.g. crit, accuracy)\n' +
                        '• **`/build <class>`** — Find recommended builds & skill trees\n\n' +
                        '**`!char <name>`** — Same as `/character`, results sent to your DM (channel stays clean)'
                    )
                    .setColor(0x3b82f6)
                    .setTimestamp();
                const isSearchPanel = m => m.author?.id === client.user?.id && m.embeds[0]?.title?.includes('AION2 Search');
                let allSearch = (await channel.messages.fetch({ limit: 100 })).filter(isSearchPanel);
                for (const m of allSearch.values()) await m.delete().catch(() => {});
                const sent = await channel.send({ embeds: [embed] });
                allSearch = (await channel.messages.fetch({ limit: 100 })).filter(isSearchPanel);
                for (const m of allSearch.values()) {
                    if (m.id !== sent.id) await m.delete().catch(() => {});
                }
                await interaction.editReply({ content: '✅ AION2 Search panel updated (1 only).' });
            } else if (kind === 'salary') {
                const embed = new EmbedBuilder()
                    .setTitle('💰 Salary Verification Notice')
                    .setDescription(
                        '**Attention to all TETRA Staff:**\n' +
                        'Your salary for this period has been officially processed.\n\n' +
                        '**How to confirm (1-click, no typing):**\n' +
                        '• Check your bank/wallet balance.\n' +
                        `• Click one of **${SUPPORTED_REGION_CODES}** below — no form, no typing.\n\n` +
                        'Thank you for your excellent performance.'
                    )
                    .setColor(0x57F287);
                const salaryButtons = REGION_CONFIGS.map(region =>
                    new ButtonBuilder()
                        .setCustomId(`btn_salary_${region.value}`)
                        .setLabel(`${region.code} (1-Click)`)
                        .setEmoji(region.emoji)
                        .setStyle(ButtonStyle.Success)
                );
                const row = new ActionRowBuilder().addComponents(...salaryButtons);
                const files = [];
                if (fs.existsSync(CONFIG.PANEL_IMAGES.salary)) {
                    files.push(new AttachmentBuilder(CONFIG.PANEL_IMAGES.salary, { name: 'salary.png' }));
                    embed.setImage('attachment://salary.png');
                }
                const state = loadPanelState();
                const payload = { embeds: [embed], components: [row], files: files.length ? files : undefined };
                const isSalaryPanel = m => m.author?.id === client.user?.id && (m.embeds[0]?.title?.includes('Salary') || m.components?.some(c => c.components?.some(b => b.customId === 'btn_salary' || b.customId?.startsWith('btn_salary_'))));
                let allPanels = (await channel.messages.fetch({ limit: 100 })).filter(isSalaryPanel);
                for (const m of allPanels.values()) await m.delete().catch(() => {});
                const sent = await channel.send(payload);
                allPanels = (await channel.messages.fetch({ limit: 100 })).filter(isSalaryPanel);
                for (const m of allPanels.values()) {
                    if (m.id !== sent.id) await m.delete().catch(() => {});
                }
                savePanelState({ ...state, salaryMsgId: sent.id, salaryChannelId: channel.id });
                await interaction.editReply({ content: '✅ Salary panel updated (1 only).' });
            } else if (kind === 'join_verify') {
                try {
                    await upsertJoinVerifyPanel(channel);
                    await interaction.editReply({ content: '✅ Join verification panel updated (1 only).' });
                } catch (err) {
                    console.error('[panel join_verify]', err);
                    const hint = /permission|access|forbidden/i.test(err.message || '')
                        ? '\n\n💡 Ensure the bot has **Send Messages**, **Embed Links**, **Read Message History**, and **Manage Messages** permissions.'
                        : '';
                    await interaction.editReply({
                        content: `❌ Join verification panel setup failed: ${err.message || 'Unknown error'}${hint}`
                    }).catch(() => {});
                }
            } else if (kind === 'payment') {
                const embed = new EmbedBuilder()
                    .setTitle('💎 Payment Confirmation')
                    .setDescription(
                        '**Submit Member Payment Confirmation**\n\n' +
                        '• Select currency (KRW, USD, PHP, etc.) then enter amount and description.\n' +
                        '• If you need to attach a screenshot, post it separately after submitting.\n\n' +
                        '👇 Click **Submit Payment** below.'
                    )
                    .setColor(0x7289DA)
                    .setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('btn_payment_confirm')
                        .setLabel('Submit Payment')
                        .setEmoji('💎')
                        .setStyle(ButtonStyle.Primary)
                );
                const isPaymentPanel = m => m.author?.id === client.user?.id && m.embeds[0]?.title?.includes('Payment Confirmation');
                let allPaymentPanels = (await channel.messages.fetch({ limit: 100 })).filter(isPaymentPanel);
                for (const m of allPaymentPanels.values()) await m.delete().catch(() => {});
                const sent = await channel.send({ embeds: [embed], components: [row] });
                allPaymentPanels = (await channel.messages.fetch({ limit: 100 })).filter(isPaymentPanel);
                for (const m of allPaymentPanels.values()) {
                    if (m.id !== sent.id) await m.delete().catch(() => {});
                }
                const state = loadPanelState();
                const paymentChannelIdByGuild = state.paymentChannelIdByGuild && typeof state.paymentChannelIdByGuild === 'object'
                    ? { ...state.paymentChannelIdByGuild }
                    : {};
                paymentChannelIdByGuild[interaction.guildId] = channel.id;
                const paymentOcrConfigByGuild = state.paymentOcrConfigByGuild && typeof state.paymentOcrConfigByGuild === 'object'
                    ? { ...state.paymentOcrConfigByGuild }
                    : {};
                if (!paymentOcrConfigByGuild[interaction.guildId]) {
                    paymentOcrConfigByGuild[interaction.guildId] = {
                        enabled: true,
                        channelId: channel.id,
                        minConfidence: 45,
                    };
                } else if (!asSnowflake(paymentOcrConfigByGuild[interaction.guildId].channelId)) {
                    paymentOcrConfigByGuild[interaction.guildId].channelId = channel.id;
                }
                savePanelState({
                    ...state,
                    paymentMsgId: sent.id,
                    paymentChannelId: channel.id,
                    paymentChannelIdByGuild,
                    paymentOcrConfigByGuild,
                });
                await interaction.editReply({ content: '✅ Payment panel updated (1 only).' });
            } else if (kind === 'youtube') {
                const embed = new EmbedBuilder()
                    .setTitle('🎬 Info YouTube — Translated Links')
                    .setDescription(
                        '**Post translated links for Korean info videos**\n\n' +
                        '• Auto-translate title (KO→EN)\n' +
                        '• Generate EN subtitle/auto-translate watch link\n\n' +
                        '👇 Click **Add Video** and enter a YouTube URL.'
                    )
                    .setColor(0xFF0000)
                    .setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('btn_youtube_add')
                        .setLabel('Add Video')
                        .setEmoji('🎬')
                        .setStyle(ButtonStyle.Primary)
                );
                const isYoutubePanel = m => m.author?.id === client.user?.id && m.embeds[0]?.title?.includes('Info YouTube');
                let allYtPanels = (await channel.messages.fetch({ limit: 100 })).filter(isYoutubePanel);
                for (const m of allYtPanels.values()) await m.delete().catch(() => {});
                const sent = await channel.send({ embeds: [embed], components: [row] });
                allYtPanels = (await channel.messages.fetch({ limit: 100 })).filter(isYoutubePanel);
                for (const m of allYtPanels.values()) {
                    if (m.id !== sent.id) await m.delete().catch(() => {});
                }
                const state = loadPanelState();
                savePanelState({ ...state, youtubeMsgId: sent.id, youtubeChannelId: channel.id });
                await interaction.editReply({ content: '✅ YouTube panel updated (1 only).' });
            } else if (kind === 'link') {
                const embed = new EmbedBuilder()
                    .setTitle('📰 Link — Summarize & Translate')
                    .setDescription(
                        '**Summarize and translate article links**\n\n' +
                        '• Auto-summarize content (KO)\n' +
                        '• Translate to English (KO→EN)\n' +
                        '• Attach thumbnail image\n\n' +
                        '👇 Click **Add Link** and enter a URL.\n\n' +
                        'Supported: `inven.co.kr/board/aion2/*` or `inven.co.kr/webzine/news/?news=*`'
                    )
                    .setColor(0xcc0000)
                    .setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('btn_link_add')
                        .setLabel('Add Link')
                        .setEmoji('📰')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('btn_link_set')
                        .setLabel('Set')
                        .setEmoji('⚙️')
                        .setStyle(ButtonStyle.Secondary)
                );
                const isLinkPanel = m => m.author?.id === client.user?.id && m.embeds[0]?.title?.includes('Link —');
                let allLinkPanels = (await channel.messages.fetch({ limit: 100 })).filter(isLinkPanel);
                for (const m of allLinkPanels.values()) await m.delete().catch(() => {});
                const sent = await channel.send({ embeds: [embed], components: [row] });
                allLinkPanels = (await channel.messages.fetch({ limit: 100 })).filter(isLinkPanel);
                for (const m of allLinkPanels.values()) {
                    if (m.id !== sent.id) await m.delete().catch(() => {});
                }
                const state = loadPanelState();
                savePanelState({ ...state, linkMsgId: sent.id, linkChannelId: channel.id });
                await interaction.editReply({ content: '✅ Link panel updated (1 only).' });
            } else if (kind === 'guide_ko' || kind === 'guide_en') {
                if (!hasManageGuild(interaction)) {
                    await interaction.editReply({ content: '❌ Full guides require Manage Server permission. Use `/guide` for member guide.' });
                    return;
                }
                const embeds = kind === 'guide_ko' ? buildGuideEmbedsKo() : buildGuideEmbedsEn();
                const titleKey = kind === 'guide_ko' ? '사용법 가이드' : 'Usage Guide';
                const isGuidePanel = m => m.author?.id === client.user?.id && m.embeds?.[0]?.title?.includes(titleKey);
                let allGuides = (await channel.messages.fetch({ limit: 50 })).filter(isGuidePanel);
                for (const m of allGuides.values()) await m.delete().catch(() => {});
                const sent = await channel.send({ embeds });
                allGuides = (await channel.messages.fetch({ limit: 50 })).filter(isGuidePanel);
                for (const m of allGuides.values()) {
                    if (m.id !== sent.id) await m.delete().catch(() => {});
                }
                await interaction.editReply({ content: kind === 'guide_ko' ? '✅ Korean guide panel posted.' : '✅ English usage guide panel posted.' });
            } else if (kind === 'guidebook_plaync') {
                if (!hasManageGuild(interaction)) { await interaction.editReply({ content: '❌ Admin permission required.' }); return; }
                const embed = new EmbedBuilder()
                    .setTitle('📖 AION2 Official Guidebook')
                    .setDescription('PlayNC 공식 가이드북 (클래스·스킬·시스템 안내)\n\n아래 버튼을 눌러 **영어** 가이드북으로 이동하세요.')
                    .setColor(0x5865F2)
                    .addFields({ name: '🔗 Link', value: `[Open Guidebook (EN)](${GUIDEBOOK_EN_URL})`, inline: false })
                    .setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Open Guidebook (EN)')
                        .setEmoji('📖')
                        .setStyle(ButtonStyle.Link)
                        .setURL(GUIDEBOOK_EN_URL)
                );
                const isGbPanel = m => m.author?.id === client.user?.id && m.embeds?.[0]?.title?.includes('Guidebook');
                let allGb = (await channel.messages.fetch({ limit: 50 })).filter(isGbPanel);
                for (const m of allGb.values()) await m.delete().catch(() => {});
                const sent = await channel.send({ embeds: [embed], components: [row] });
                allGb = (await channel.messages.fetch({ limit: 50 })).filter(isGbPanel);
                for (const m of allGb.values()) { if (m.id !== sent.id) await m.delete().catch(() => {}); }
                await interaction.editReply({ content: '✅ Guidebook panel posted (link to EN guidebook).' });
            } else if (kind === 'tactics') {
                if (!hasManageGuild(interaction)) { await interaction.editReply({ content: '❌ Admin permission required.' }); return; }
                const embed = new EmbedBuilder()
                    .setTitle('⚔️ TACTICS — All Guide Categories')
                    .setDescription(
                        '**Inven AION2 guides (translated) — shown only to you when opened.**\n\n' +
                        '**Categories:**\n' +
                        '• **Dungeon Guide** — Stagger Gauge, Kaisinel, Krao Cave, Draupnir, Urugugu, Barklon, Fire Temple, Savage Horn Cave, Dead Dramata, Transcendence, Ludra 1–2, Ludra 3\n' +
                        '• **Pet Guide** — Pet Understanding, Pet Soul DB, Pet Stats\n' +
                        '• **Class Guide** — Gladiator, Templar, Assassin, Ranger, Chanter, Cleric, Sorcerer, Spiritmaster PvE/PvP\n' +
                        '• **Fast Leveling** — Early leveling route and progression priorities\n' +
                        '• **Kinah Farming** — Multi-character weekly farming and schedule planning\n' +
                        '• **CP Boost Guide** — Strike options, board growth, medals, gear replacement logic\n' +
                        '• **Pantheon Guide** — AP acquisition and Abyss progression plan\n' +
                        '• **Dungeon Tactics** — New transcendence and tier 4–6 pattern handling\n' +
                        '• **Daily Checklist** — Daily/weekly routine and resource control\n' +
                        '• **Pro Tips** — Practical optimization tips (gear, timing, mobile setup)\n' +
                        '• **Wardrobe Guide** — Wardrobe and appearance guide\n\n' +
                        '**How to use:**\n' +
                        '• Click the button below and select category → guide\n' +
                        '• Or use **`/tactics`** — same flow, ephemeral\n\n' +
                        '_Results are visible only to you._'
                    )
                    .setColor(0x5865F2)
                    .setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('btn_tactics_open')
                        .setLabel('Open Tactics Guide')
                        .setEmoji('📖')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('btn_tactics_post')
                        .setLabel('Post to Channel (public)')
                        .setEmoji('📢')
                        .setStyle(ButtonStyle.Success)
                );
                const isTacticsPanel = m => m.author?.id === client.user?.id && (m.embeds?.[0]?.title?.includes('TACTICS') || m.components?.some(c => c.components?.some(b => b.customId === 'btn_tactics_open' || b.customId === 'btn_tactics_post')));
                let allTactics = (await channel.messages.fetch({ limit: 100 })).filter(isTacticsPanel);
                for (const m of allTactics.values()) await m.delete().catch(() => {});
                const sent = await channel.send({ embeds: [embed], components: [row] });
                allTactics = (await channel.messages.fetch({ limit: 100 })).filter(isTacticsPanel);
                for (const m of allTactics.values()) { if (m.id !== sent.id) await m.delete().catch(() => {}); }
                await interaction.editReply({ content: '✅ TACTICS panel posted. Buttons: **Open (ephemeral)** / **Post to Channel (admin, public)**.' });
            }
            } finally {
                await new Promise(r => setTimeout(r, 2000));
                panelUpdateLocks.delete(lockKey);
            }
        } else {
            await safeEphemeral(interaction, `Command is registered but not handled yet: /${interaction.commandName}`);
        }
        return;
    }

    // 버튼 클릭
    if (interaction.isButton()) {
        try {
            const id = interaction.customId;
            if (id.startsWith('market_buy_')) {
                if (!interaction.guildId || !interaction.guild) {
                    await safeEphemeral(interaction, 'Guild only action.');
                    return;
                }
                await interaction.deferReply({ flags: EPHEMERAL_FLAGS }).catch(() => {});
                const listingId = id.replace(/^market_buy_/, '').trim();
                if (!listingId) {
                    await interaction.editReply({ content: 'Invalid listing id.' }).catch(() => {});
                    return;
                }
                const state = loadPanelState();
                const collections = ensureMarketCollections(state, interaction.guildId);
                const listing = collections.listings[listingId];
                if (!listing) {
                    await interaction.editReply({ content: '❌ Listing not found or expired.' }).catch(() => {});
                    return;
                }
                if (listing.status !== 'open') {
                    const ticketMention = listing.matchedTicketChannelId ? `<#${listing.matchedTicketChannelId}>` : 'N/A';
                    await interaction.editReply({ content: `⚠️ This listing is already matched.\nTicket: ${ticketMention}` }).catch(() => {});
                    return;
                }
                if (listing.ownerId === interaction.user.id) {
                    await interaction.editReply({ content: '❌ You cannot open escrow with your own listing.' }).catch(() => {});
                    return;
                }
                const marketConfig = getMarketConfigForGuild(state, interaction.guildId);
                if (!marketConfig.marketChannelId || !marketConfig.ticketCategoryId) {
                    await interaction.editReply({ content: '❌ Escrow config is missing. Admin: run `/market_setup`.' }).catch(() => {});
                    return;
                }
                const buyerId = listing.type === 'WTS' ? interaction.user.id : listing.ownerId;
                const sellerId = listing.type === 'WTS' ? listing.ownerId : interaction.user.id;
                if (!buyerId || !sellerId || buyerId === sellerId) {
                    await interaction.editReply({ content: '❌ Failed to resolve buyer/seller for this listing.' }).catch(() => {});
                    return;
                }

                const buyerMember = interaction.guild.members.cache.get(buyerId) || await interaction.guild.members.fetch(buyerId).catch(() => null);
                const sellerMember = interaction.guild.members.cache.get(sellerId) || await interaction.guild.members.fetch(sellerId).catch(() => null);
                const buyerToken = slugifyChannelToken(buyerMember?.displayName || 'buyer', 'buyer');
                const sellerToken = slugifyChannelToken(sellerMember?.displayName || 'seller', 'seller');
                const channelName = `trade-${listingId}-${buyerToken}-${sellerToken}`.slice(0, 95);
                const permissionOverwrites = [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    {
                        id: client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.ManageMessages,
                        ],
                    },
                    {
                        id: buyerId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.AttachFiles,
                        ],
                    },
                    {
                        id: sellerId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.AttachFiles,
                        ],
                    },
                ];
                if (marketConfig.adminRoleId) {
                    permissionOverwrites.push({
                        id: marketConfig.adminRoleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.ManageMessages,
                        ],
                    });
                }

                let ticketChannel;
                try {
                    ticketChannel = await interaction.guild.channels.create({
                        name: channelName,
                        type: ChannelType.GuildText,
                        parent: marketConfig.ticketCategoryId || null,
                        permissionOverwrites,
                    });
                } catch (err) {
                    await interaction.editReply({ content: `❌ Failed to create escrow ticket: ${err.message}` }).catch(() => {});
                    return;
                }

                if (!marketConfig.adminRoleId) {
                    const manageRoles = interaction.guild.roles.cache.filter(r => r.permissions.has(PermissionFlagsBits.ManageGuild));
                    for (const [, role] of manageRoles) {
                        await ticketChannel.permissionOverwrites.create(role, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true,
                            ManageMessages: true,
                        }).catch(() => {});
                    }
                }

                listing.status = 'matched';
                listing.matchedAt = Date.now();
                listing.matchedBy = interaction.user.id;
                listing.matchedTicketChannelId = ticketChannel.id;
                collections.tickets[ticketChannel.id] = {
                    channelId: ticketChannel.id,
                    listingId,
                    buyerId,
                    sellerId,
                    createdBy: interaction.user.id,
                    createdAt: Date.now(),
                    status: 'opened',
                    holdConfirmedAt: null,
                    sellerPaymentConfirmedAt: null,
                    completedAt: null,
                    closedAt: null,
                    feePercent: Number.isFinite(Number(listing.feePercent)) ? Number(listing.feePercent) : 0,
                };
                savePanelState(state, true);

                const marketChannel = interaction.guild.channels.cache.get(listing.channelId) || await interaction.guild.channels.fetch(listing.channelId).catch(() => null);
                if (marketChannel && marketChannel.isTextBased() && listing.messageId) {
                    const listingMsg = await marketChannel.messages.fetch(listing.messageId).catch(() => null);
                    if (listingMsg) {
                        const disabledRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`market_buy_${listingId}`)
                                .setLabel('🔒 Matched (Escrow Ticket Open)')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(true)
                        );
                        await listingMsg.edit({ components: [disabledRow] }).catch(() => {});
                    }
                }

                const introEmbed = buildMarketTicketEmbed({
                    listing,
                    buyerId,
                    sellerId,
                    adminRoleId: marketConfig.adminRoleId,
                });
                const mentionParts = [`<@${buyerId}>`, `<@${sellerId}>`];
                if (marketConfig.adminRoleId) mentionParts.push(`<@&${marketConfig.adminRoleId}>`);
                await ticketChannel.send({
                    content: mentionParts.join(' '),
                    embeds: [introEmbed],
                    components: buildMarketTicketControlRows(ticketChannel.id),
                }).catch(() => {});

                await interaction.editReply({ content: `✅ Escrow ticket created: <#${ticketChannel.id}>` }).catch(() => {});
            } else if (id.startsWith('market_hold_')) {
                if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only action.'); return; }
                const ticketChannelId = id.replace(/^market_hold_/, '').trim() || interaction.channelId;
                const state = loadPanelState();
                const collections = ensureMarketCollections(state, interaction.guildId);
                const ticket = collections.tickets[ticketChannelId] || collections.tickets[interaction.channelId];
                if (!ticket) { await safeEphemeral(interaction, '❌ Escrow ticket state not found.'); return; }
                const marketConfig = getMarketConfigForGuild(state, interaction.guildId);
                if (!isMarketAdmin(interaction, marketConfig)) {
                    await safeEphemeral(interaction, '❌ Only escrow admin can confirm hold.');
                    return;
                }
                if (ticket.completedAt) {
                    await safeEphemeral(interaction, '⚠️ This ticket is already completed.');
                    return;
                }
                if (ticket.holdConfirmedAt) {
                    await safeEphemeral(interaction, '⚠️ Hold is already confirmed.');
                    return;
                }
                ticket.holdConfirmedAt = Date.now();
                ticket.status = 'hold_confirmed';
                savePanelState(state, true);
                await interaction.reply({ content: `✅ Admin hold confirmed. Buyer may proceed with payment now.\nBuyer: <@${ticket.buyerId}> • Seller: <@${ticket.sellerId}>` });
            } else if (id.startsWith('market_pay_')) {
                if (!interaction.guildId) { await safeEphemeral(interaction, 'Guild only action.'); return; }
                const ticketChannelId = id.replace(/^market_pay_/, '').trim() || interaction.channelId;
                const state = loadPanelState();
                const collections = ensureMarketCollections(state, interaction.guildId);
                const ticket = collections.tickets[ticketChannelId] || collections.tickets[interaction.channelId];
                if (!ticket) { await safeEphemeral(interaction, '❌ Escrow ticket state not found.'); return; }
                const marketConfig = getMarketConfigForGuild(state, interaction.guildId);
                const isAdminClick = isMarketAdmin(interaction, marketConfig);
                if (interaction.user.id !== ticket.sellerId && !isAdminClick) {
                    await safeEphemeral(interaction, '❌ Only seller (or admin) can confirm payment receipt.');
                    return;
                }
                if (!ticket.holdConfirmedAt) {
                    await safeEphemeral(interaction, '⚠️ Hold is not confirmed yet. Wait for admin hold confirmation first.');
                    return;
                }
                if (ticket.completedAt) {
                    await safeEphemeral(interaction, '⚠️ This ticket is already completed.');
                    return;
                }
                ticket.sellerPaymentConfirmedAt = Date.now();
                ticket.status = 'payment_confirmed';
                savePanelState(state, true);
                await interaction.reply({ content: `✅ Seller confirmed payment receipt.\nAdmin can now finalize delivery and trust update via **Complete + Trust**.` });
            } else if (id.startsWith('market_complete_')) {
                if (!interaction.guildId || !interaction.guild) { await safeEphemeral(interaction, 'Guild only action.'); return; }
                const ticketChannelId = id.replace(/^market_complete_/, '').trim() || interaction.channelId;
                const state = loadPanelState();
                const collections = ensureMarketCollections(state, interaction.guildId);
                const ticket = collections.tickets[ticketChannelId] || collections.tickets[interaction.channelId];
                if (!ticket) { await safeEphemeral(interaction, '❌ Escrow ticket state not found.'); return; }
                const marketConfig = getMarketConfigForGuild(state, interaction.guildId);
                if (!isMarketAdmin(interaction, marketConfig)) {
                    await safeEphemeral(interaction, '❌ Only escrow admin can complete this trade.');
                    return;
                }
                if (!ticket.holdConfirmedAt || !ticket.sellerPaymentConfirmedAt) {
                    await safeEphemeral(interaction, '⚠️ You must complete Hold and Payment confirmation first.');
                    return;
                }
                if (ticket.completedAt) {
                    await safeEphemeral(interaction, '⚠️ This ticket is already completed.');
                    return;
                }
                ticket.completedAt = Date.now();
                ticket.closedAt = Date.now();
                ticket.status = 'completed';
                const listing = collections.listings[ticket.listingId];
                if (listing) {
                    listing.status = 'completed';
                    listing.completedAt = Date.now();
                }
                const buyerTrust = addTrustScore(state, interaction.guildId, ticket.buyerId, 1);
                const sellerTrust = addTrustScore(state, interaction.guildId, ticket.sellerId, 1);
                const roleMap = getTrustRoleMapForGuild(state, interaction.guildId);
                await syncTrustRolesForMember(interaction.guild, ticket.buyerId, roleMap, buyerTrust.current).catch(() => {});
                await syncTrustRolesForMember(interaction.guild, ticket.sellerId, roleMap, sellerTrust.current).catch(() => {});
                delete collections.tickets[ticket.channelId || interaction.channelId];
                savePanelState(state, true);

                const summary = new EmbedBuilder()
                    .setTitle('✅ Escrow Trade Completed')
                    .setColor(0x22c55e)
                    .setDescription(
                        [
                            `Buyer: <@${ticket.buyerId}>`,
                            `Seller: <@${ticket.sellerId}>`,
                            `Listing: \`${ticket.listingId}\``,
                            '',
                            '**Trust Updated (+1 each)**',
                            `• Buyer: ${buyerTrust.previous} → **${buyerTrust.current}** (${formatTrustBadge(buyerTrust.current)})`,
                            `• Seller: ${sellerTrust.previous} → **${sellerTrust.current}** (${formatTrustBadge(sellerTrust.current)})`,
                            '',
                            'Ticket will auto-close in 10 seconds.',
                        ].join('\n')
                    )
                    .setTimestamp();
                await interaction.reply({ embeds: [summary] });
                setTimeout(async () => {
                    const ch = await client.channels.fetch(ticket.channelId || interaction.channelId).catch(() => null);
                    if (ch && ch.type === ChannelType.GuildText) {
                        await ch.delete('Escrow completed and trust synced').catch(() => {});
                    }
                }, 10_000);
            } else if (id.startsWith('market_close_')) {
                if (!interaction.guildId || !interaction.guild) { await safeEphemeral(interaction, 'Guild only action.'); return; }
                const ticketChannelId = id.replace(/^market_close_/, '').trim() || interaction.channelId;
                const state = loadPanelState();
                const collections = ensureMarketCollections(state, interaction.guildId);
                const ticket = collections.tickets[ticketChannelId] || collections.tickets[interaction.channelId];
                if (!ticket) { await safeEphemeral(interaction, '❌ Escrow ticket state not found.'); return; }
                const marketConfig = getMarketConfigForGuild(state, interaction.guildId);
                if (!isMarketAdmin(interaction, marketConfig)) {
                    await safeEphemeral(interaction, '❌ Only escrow admin can close ticket.');
                    return;
                }
                const listing = collections.listings[ticket.listingId];
                if (listing && listing.status !== 'completed') {
                    listing.status = 'closed';
                    listing.closedAt = Date.now();
                }
                delete collections.tickets[ticket.channelId || interaction.channelId];
                savePanelState(state, true);
                await interaction.reply({ content: '🗄️ Ticket will close in 5 seconds.' });
                setTimeout(async () => {
                    const ch = await client.channels.fetch(ticket.channelId || interaction.channelId).catch(() => null);
                    if (ch && ch.type === ChannelType.GuildText) {
                        await ch.delete('Escrow ticket closed by admin').catch(() => {});
                    }
                }, 5_000);
            } else if (id === 'btn_tactics_open') {
                const row = buildTacticsCategorySelect(false);
                await interaction.reply({
                    content: '**TACTICS** — Select a category.\n_Visible only to you_',
                    components: [row],
                    flags: EPHEMERAL_FLAGS
                });
            } else if (id === 'btn_tactics_post') {
                if (!hasManageGuild(interaction)) {
                    await interaction.reply({ content: '❌ Only admins can post guides publicly.', flags: EPHEMERAL_FLAGS });
                    return;
                }
                const row = buildTacticsCategorySelect(true);
                await interaction.reply({
                    content: '**TACTICS** — Select a category.\n_Everyone will see the selected guide._',
                    components: [row]
                });
            } else if (id === 'btn_guidebook_open') {
                const state = loadGuidebookState();
                const row = buildGuidebookCategorySelect(state, false);
                if (!row) {
                    await interaction.reply({
                        content: '❌ No guidebook data is available.\nPlease verify `guidebook_official_seed.json` exists, then run **`/guidebook_fetch`** to refresh local cache if needed.',
                        flags: EPHEMERAL_FLAGS
                    });
                    return;
                }
                await interaction.reply({
                    content: '**📖 AION2 Official Guidebook** — Select a category.\n_Visible only to you_',
                    components: [row],
                    flags: EPHEMERAL_FLAGS
                });
            } else if (id === 'btn_guidebook_post') {
                if (!hasManageGuild(interaction)) {
                    await interaction.reply({ content: '❌ Only admins can post guides publicly.', flags: EPHEMERAL_FLAGS });
                    return;
                }
                const state = loadGuidebookState();
                const row = buildGuidebookCategorySelect(state, true);
                if (!row) {
                    await interaction.reply({
                        content: '❌ No guidebook data is available.\nPlease verify `guidebook_official_seed.json` exists, then run **`/guidebook_fetch`** to refresh local cache if needed.',
                        flags: EPHEMERAL_FLAGS
                    });
                    return;
                }
                await interaction.reply({
                    content: '**📖 AION2 Official Guidebook** — Select a category.\n_Everyone will see the selected guide._',
                    components: [row]
                });
            } else if (id === 'btn_join_verify_open') {
                await interaction.reply({
                    content: '🌍 Please select your country for join verification.',
                    components: [buildJoinCountrySelectRow()],
                    flags: EPHEMERAL_FLAGS
                });
            } else if (id === 'btn_char_verify_open') {
                // defer first to avoid 3-sec timeout (modal requires instant response; bot cold start fails)
                await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
                const state = loadPanelState();
                const verifyCatId = state.verifyCategoryIdByGuild?.[interaction.guildId] || state.verifyCategoryId;
                if (!verifyCatId) {
                    await interaction.editReply({
                        content: '❌ Character verification is not configured. Ask an admin to run **`/verify_channel_set category:<category>`** first.\n\nOr use **`/myinfo_register character_name:<name>`** (same function).',
                        flags: EPHEMERAL_FLAGS
                    }).catch(() => {});
                    return;
                }
                await interaction.editReply({
                    content: '🎮 **Character Verification**\n\nUse **`/myinfo_register character_name:<name>`**\nExample: `/myinfo_register character_name:YourCharacterName`\n\n→ A private channel will be created. Upload your screenshot there and staff will Approve.',
                    flags: EPHEMERAL_FLAGS
                }).catch(() => {});
            } else if (id === 'btn_daily_submit' || id.startsWith('btn_daily_submit_')) {
                const forcedRegion = id.startsWith('btn_daily_submit_')
                    ? id.replace(/^btn_daily_submit_/, '').trim().toLowerCase()
                    : null;
                const forcedCfg = forcedRegion ? getRegionConfig(forcedRegion) : null;
                if (forcedRegion && !forcedCfg) {
                    await interaction.reply({ content: '❌ Invalid region scope on this panel. Recreate panel with `/panel type:report`.', flags: EPHEMERAL_FLAGS });
                    return;
                }
                await interaction.reply({
                    content: forcedCfg
                        ? `📊 Select Start/End + Team for **${forcedCfg.code}**.`
                        : '📊 Select Start/End + Team + Region, then the report form will open.',
                    components: [buildDailySubmitTargetSelectRow(forcedCfg?.value || null)],
                    flags: EPHEMERAL_FLAGS
                });
            } else if (id.startsWith('btn_kinah_')) {
                const region = parseRegionFromCustomId(id, 'btn_kinah');
                const cfg = getRegionConfig(region);
                if (!cfg) {
                    await interaction.reply({ content: `❌ Invalid region. Supported: ${SUPPORTED_REGION_CODES}.`, flags: EPHEMERAL_FLAGS });
                    return;
                }
                await interaction.showModal(createKinahEndModal(cfg.value));
            } else if (id.startsWith('btn_levelup_')) {
                const region = parseRegionFromCustomId(id, 'btn_levelup');
                const cfg = getRegionConfig(region);
                if (!cfg) {
                    await interaction.reply({ content: `❌ Invalid region. Supported: ${SUPPORTED_REGION_CODES}.`, flags: EPHEMERAL_FLAGS });
                    return;
                }
                await interaction.showModal(createLevelUpEndModal(cfg.value));
            } else if (id === 'btn_kinah_rate_fetch') {
                if (interaction.user.bot) return;
                const guildId = interaction.guildId;
                if (!guildId) return;
                await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
                const guildState = ensureKinahGuildState(guildId);
                const watch = createDefaultKinahWatch(guildState.kinah);
                if (!watch.sourceUrl) {
                    await interaction.editReply({
                        content: '❌ Kinah crawler not configured. Admin: run `/kinah_watch_preset` first.',
                        flags: EPHEMERAL_FLAGS
                    }).catch(() => {});
                    return;
                }
                try {
                    const snapshot = await fetchKinahRateSnapshot(watch);
                    const previousRate = watch.lastRate;
                    const stable = applyKinahStability(watch, snapshot.numeric);
                    watch.lastRate = stable;
                    watch.stableRate = stable;
                    watch.lastRawText = snapshot.token;
                    watch.lastSourceSummary = snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null;
                    watch.lastCheckedAt = Date.now();
                    watch.lastError = null;
                    guildState.kinah = watch;
                    saveKinahState();
                    const stableSnapshot = {
                        ...snapshot,
                        rawToken: snapshot.token,
                        rawNumeric: snapshot.numeric,
                        token: formatKrw(stable),
                        numeric: stable,
                    };
                    const embed = buildKinahRateEmbed(stableSnapshot, previousRate);
                    await interaction.editReply({ embeds: [embed], flags: EPHEMERAL_FLAGS }).catch(() => {});
                } catch (err) {
                    watch.lastError = err.message || 'Fetch failed';
                    guildState.kinah = watch;
                    saveKinahState();
                    await interaction.editReply({
                        content: `❌ Failed to fetch kinah rate: ${err.message}`,
                        flags: EPHEMERAL_FLAGS
                    }).catch(() => {});
                }
            }
            else if (id === 'btn_salary') {
                await interaction.reply({
                    content: `⚠️ This button is deprecated. Refresh the panel with \`/panel type:salary\`, then click the region buttons (${SUPPORTED_REGION_CODES}).`,
                    flags: EPHEMERAL_FLAGS
                });
            } else if (id.startsWith('btn_salary_')) {
                if (interaction.user.bot) return;
                if (interaction.user.id === client.user?.id) return;
                const region = parseRegionFromCustomId(id, 'btn_salary');
                const regionCfg = getRegionConfig(region);
                if (!regionCfg) return;
                await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
                const username = (interaction.member?.displayName || interaction.user.globalName || interaction.user.username || 'Unknown').trim();
                const timestamp = makeLocalTimestamp(regionCfg.timeZone);
                const data = [timestamp, username, 'Confirmed', ''];
                const res = await appendToSheet(regionCfg.salarySheetRange, data);
                await interaction.editReply({
                    content: res.ok ? `✅ Salary confirmation submitted (${username}) → ${regionCfg.code}` : `❌ Failed to save (${regionCfg.code}). Create **Salary_Log_${regionCfg.code}** sheet in Google Sheets.`,
                    flags: EPHEMERAL_FLAGS
                }).catch(() => {});
            } else if (id === 'btn_youtube_add') {
                if (!hasManageGuild(interaction)) {
                    await safeEphemeral(interaction, 'Manage Server permission required to add videos.');
                    return;
                }
                await interaction.showModal(createYoutubeAddModal());
            } else if (id === 'btn_link_add') {
                if (!hasManageGuild(interaction)) {
                    await safeEphemeral(interaction, 'Manage Server permission required to add links.');
                    return;
                }
                await interaction.reply({
                    content: '**Where to post this link?** ↓ Select category, then URL modal will open.',
                    components: [buildLinkCategorySelectRow()],
                    flags: EPHEMERAL_FLAGS
                });
            } else if (id === 'btn_link_set') {
                if (!hasManageGuild(interaction)) {
                    await safeEphemeral(interaction, 'Manage Server permission required.');
                    return;
                }
                const state = loadPanelState();
                const current = state.linkTargetTacticsCategoryByGuild?.[interaction.guildId];
                const label = getLinkCategoryLabel(current);
                await interaction.reply({
                    content: `**Link target (Admin)**\nCurrent: **${label}**\n\nChoose category for \`!link\` and Add Link results:`,
                    components: [buildLinkSetSelectRow()],
                    flags: EPHEMERAL_FLAGS
                });
            } else if (id === 'btn_payment_confirm') {
                await interaction.reply({
                    content: '💎 Select currency for payment confirmation.',
                    components: [buildPaymentCurrencySelectRow()],
                    flags: EPHEMERAL_FLAGS
                });
            } else if (id.startsWith('verify_approve_')) {
                if (!hasManageGuild(interaction)) {
                    await safeEphemeral(interaction, 'Manage Server permission required to approve.');
                    return;
                }
                const channelId = id.replace(/^verify_approve_/, '');
                const verifyState = loadVerifyPendingState();
                const pending = verifyState.pending[channelId];
                if (!pending) {
                    await safeEphemeral(interaction, 'Verification session expired or already processed.');
                    return;
                }
                await interaction.reply({
                    content: `Select region for **${pending.characterName}**:`,
                    components: [buildVerifyApproveRegionSelect(channelId)],
                    flags: EPHEMERAL_FLAGS
                });
            } else if (id.startsWith('verify_reject_')) {
                if (!hasManageGuild(interaction)) {
                    await safeEphemeral(interaction, 'Manage Server permission required to reject.');
                    return;
                }
                const channelId = id.replace(/^verify_reject_/, '');
                const verifyState = loadVerifyPendingState();
                const pending = verifyState.pending[channelId];
                if (!pending) {
                    await safeEphemeral(interaction, 'Verification session expired or already processed.');
                    return;
                }
                delete verifyState.pending[channelId];
                saveVerifyPendingState(verifyState);
                try {
                    const ch = await client.channels.fetch(channelId).catch(() => null);
                    if (ch) {
                        await ch.send({ content: `❌ Verification was **rejected** by ${interaction.user}.` });
                        await ch.delete().catch(() => {});
                    }
                } catch (_) {}
                await interaction.reply({ content: '❌ Verification rejected. Channel removed.', flags: EPHEMERAL_FLAGS });
            }
        } catch (err) {
            console.error('Button interaction error:', err);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    const id = interaction.customId || '';
                    let msg = 'Interaction failed. Please try again.';
                    if (id === 'btn_char_verify_open') {
                        msg = `Interaction failed (bot may be starting up). Please try again in a moment or use \`/myinfo_register\` for character verification.`;
                    } else if (id === 'btn_join_verify_open') {
                        msg = `Interaction failed (bot may be starting up). Please try again in a moment.`;
                    } else if (id.startsWith('btn_salary')) {
                        msg = `Interaction failed. Please try again or use \`/salary_confirm\` (choose ${SUPPORTED_REGION_CODES}).`;
                    } else if (id.startsWith('market_')) {
                        msg = 'Escrow interaction failed. Please try again or ask admin to run `/market_status`.';
                    }
                    await interaction.reply({ content: msg, flags: EPHEMERAL_FLAGS });
                }
            } catch (_) {}
        }
        return;
    }

    // 나라 선택 / 통화 선택 / TACTICS 드롭다운
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('select_guidebook_category:')) {
            const parts = interaction.customId.split(':');
            const isPublic = parts[1] === '1';
            const catIndex = interaction.values?.[0];
            const state = loadGuidebookState();
            const subRow = buildGuidebookGuideSelect(catIndex, state, isPublic);
            if (!subRow) {
                await interaction.update({ content: '❌ No guides in this category.', components: [] }).catch(() => {});
                return;
            }
            const cat = state.categories?.[parseInt(catIndex, 10)];
            const catName = cat?.nameEn || cat?.name || 'Guide';
            await interaction.update({
                content: isPublic ? `**📖 Official Guidebook** — Select guide in **${catName}**.\n_Everyone will see the selected guide._` : `**📖 Official Guidebook** — Select guide in **${catName}**.\n_Visible only to you_`,
                components: [subRow]
            });
            return;
        }
        if (interaction.customId.startsWith('select_guidebook_guide:')) {
            const parts = interaction.customId.split(':');
            const catIndex = parts[1];
            const isPublic = parts[2] === '1';
            const guideIndex = interaction.values?.[0];
            const state = loadGuidebookState();
            const cat = state.categories?.[parseInt(catIndex, 10)];
            const guide = cat?.guides?.[parseInt(guideIndex, 10)];
            if (!guide) {
                await interaction.update({ content: '❌ Guide not found.', components: [] }).catch(() => {});
                return;
            }
            const catName = cat.nameEn || cat.name || 'Guide';
            const embeds = buildGuidebookGuideEmbeds(guide, catName);
            await interaction.update({
                content: '',
                embeds,
                components: []
            }).catch(err => {
                console.error('[select_guidebook_guide]', err);
            });
            return;
        }
        if (interaction.customId.startsWith('select_tactics_category')) {
            const category = interaction.values?.[0];
            const isPublic = interaction.customId.split(':')[1] === '1';
            const cat = TACTICS_DATA[category];
            if (!cat) {
                await interaction.reply({ content: '❌ Invalid category.', flags: EPHEMERAL_FLAGS });
                return;
            }
            const subRow = buildTacticsSubSelect(category, isPublic);
            if (!subRow) {
                await interaction.reply({ content: '❌ No sub-options.', flags: EPHEMERAL_FLAGS });
                return;
            }
            await interaction.update({
                content: isPublic ? `**TACTICS** — Select guide for **${cat.label}**.\n_Everyone will see the selected guide._` : `**TACTICS** — Select guide for **${cat.label}**.\n_Visible only to you_`,
                components: [subRow],
            });
            return;
        }
        if (interaction.customId.startsWith('select_tactics_sub:')) {
            const category = interaction.customId.split(':')[1];
            const isPublic = interaction.customId.split(':')[2] === '1';
            const subValue = interaction.values?.[0];
            const cat = TACTICS_DATA[category];
            const item = cat?.items?.find(i => i.value === subValue);
            if (!item) {
                await interaction.reply({ content: '❌ Guide not found.', flags: EPHEMERAL_FLAGS });
                return;
            }
            const content = loadTacticsContent(item.file);
            if (!content) {
                await interaction.update({ content: `❌ Could not load guide: ${item.file}`, components: [] }).catch(() => {});
                return;
            }
            const title = item.label;
            const embeds = buildTacticsEmbeds(content, title);
            if (isPublic) {
                await interaction.update({
                    content: null,
                    embeds,
                    components: []
                }).catch(() => {});
            } else {
                await interaction.update({
                    content: null,
                    embeds,
                    components: [],
                    flags: EPHEMERAL_FLAGS
                }).catch(() => {});
            }
            return;
        }
        if (interaction.customId === 'select_daily_submit_target') {
            const selected = String(interaction.values?.[0] || '');
            const [target, region] = selected.split(':');
            const parts = String(target || '').split('_');
            const team = parts[0] || '';
            const phase = parts[1] || '';
            const regionCfg = getRegionConfig(region);
            if (!regionCfg || !['kinah', 'levelup'].includes(team) || !['start', 'end'].includes(phase)) {
                await interaction.update({ content: '❌ Invalid selection. Try again.', components: [] }).catch(() => {});
                return;
            }
            if (team === 'kinah' && phase === 'start') {
                await interaction.showModal(createKinahStartModal(regionCfg.value));
            } else if (team === 'kinah' && phase === 'end') {
                await interaction.showModal(createKinahEndModal(regionCfg.value));
            } else if (team === 'levelup' && phase === 'start') {
                await interaction.showModal(createLevelUpStartModal(regionCfg.value));
            } else {
                await interaction.showModal(createLevelUpEndModal(regionCfg.value));
            }
            return;
        }
        if (interaction.customId === 'select_join_country') {
            const selected = interaction.values?.[0];
            const regionCfg = getRegionConfig(selected);
            if (!regionCfg) {
                await interaction.reply({ content: `❌ Invalid country selection. Supported: ${SUPPORTED_REGION_CODES}.`, flags: EPHEMERAL_FLAGS });
                return;
            }
            await interaction.showModal(createJoinVerifyModal(regionCfg.value));
            return;
        }
        if (interaction.customId === 'select_link_category') {
            const category = interaction.values?.[0] || 'current';
            if (category === 'class') {
                const subRow = buildLinkClassSubSelectRow();
                if (!subRow) {
                    await interaction.update({ content: '❌ Class Guide sub-categories not found.', components: [] }).catch(() => {});
                    return;
                }
                await interaction.update({
                    content: '**⚔️ Class Guide** — Which class channel?',
                    components: [subRow]
                }).catch(() => {});
            } else {
                await interaction.showModal(createLinkAddModal(category));
            }
            return;
        }
        if (interaction.customId === 'select_link_class_sub') {
            const category = interaction.values?.[0] || 'current';
            await interaction.showModal(createLinkAddModal(category));
            return;
        }
        if (interaction.customId === 'select_link_set') {
            const value = interaction.values?.[0];
            const state = loadPanelState();
            const catByGuild = state.linkTargetTacticsCategoryByGuild && typeof state.linkTargetTacticsCategoryByGuild === 'object' ? { ...state.linkTargetTacticsCategoryByGuild } : {};
            const parentByGuild = state.linkTargetParentCategoryIdByGuild && typeof state.linkTargetParentCategoryIdByGuild === 'object' ? { ...state.linkTargetParentCategoryIdByGuild } : {};
            if (value === '__clear__') {
                delete catByGuild[interaction.guildId];
                delete parentByGuild[interaction.guildId];
                savePanelState({ ...state, linkTargetTacticsCategoryByGuild: catByGuild, linkTargetParentCategoryIdByGuild: parentByGuild }, true);
                await interaction.update({ content: '✅ Link target cleared. Results will post in **the channel where used**.', components: [] }).catch(() => {});
            } else if (value) {
                catByGuild[interaction.guildId] = value;
                const parentId = parentByGuild[interaction.guildId] || null;
                const targetCh = await resolveTacticsCategoryToChannel(interaction.guildId, value, parentId);
                const label = getLinkCategoryLabel(value);
                savePanelState({ ...state, linkTargetTacticsCategoryByGuild: catByGuild, linkTargetParentCategoryIdByGuild: parentByGuild }, true);
                const hint = (TACTICS_CATEGORY_SEARCH_KEYS[value] || [value])[0];
                await interaction.update({
                    content: targetCh
                        ? `✅ Link results → **${label}** → <#${targetCh.id}>.\n\nUse \`/link_channel_set parent:<category>\` to change Discord category.`
                        : `✅ **${label}** set. No matching channel found. Create a channel whose name contains \`${hint}\` or use \`/link_channel_set parent:<category>\`.`,
                    components: []
                }).catch(() => {});
            }
            return;
        }
        if (interaction.customId === 'select_payment_currency') {
            const currency = interaction.values?.[0] || 'KRW';
            await interaction.showModal(createPaymentConfirmModal(currency));
            return;
        }
        if (interaction.customId.startsWith('select_verify_approve_region_')) {
            if (!hasManageGuild(interaction)) {
                await interaction.reply({ content: '❌ Manage Server permission required.', flags: EPHEMERAL_FLAGS });
                return;
            }
            const channelId = interaction.customId.replace(/^select_verify_approve_region_/, '');
            const region = interaction.values?.[0] || '';
            const regionCfg = getRegionConfig(region);
            if (!regionCfg) {
                await interaction.reply({ content: `❌ Invalid region.`, flags: EPHEMERAL_FLAGS });
                return;
            }
            const verifyState = loadVerifyPendingState();
            const pending = verifyState.pending[channelId];
            if (!pending) {
                await interaction.reply({ content: '❌ Verification session expired or already processed.', flags: EPHEMERAL_FLAGS });
                return;
            }
            await interaction.deferUpdate();
            try {
                const targetUser = await client.users.fetch(pending.userId).catch(() => null);
                const member = interaction.guild?.members.fetch(pending.userId).catch(() => null);
                const displayName = member?.displayName || targetUser?.globalName || targetUser?.username || 'Unknown';
                const row = [
                    pending.userId,
                    targetUser ? (targetUser.tag || targetUser.username) : 'Unknown',
                    displayName,
                    regionCfg.code,
                    'N/A',
                    makeLocalTimestamp(regionCfg.timeZone),
                    pending.characterName,
                ];
                const appendRes = await appendToSheet(regionCfg.memberSheetRange, row);
                const saved = appendRes.ok;
                if (!saved) {
                    await interaction.followUp({ content: `❌ Failed to save to Member_List_${regionCfg.code}. Create the sheet with columns A:G.`, flags: EPHEMERAL_FLAGS }).catch(() => {});
                    return;
                }
                const tgMsg = [
                    '👤 <b>신규 회원 (캐릭터 검증)</b>',
                    `Region: ${regionCfg.code}`,
                    `User: ${escapeHtml(displayName)}`,
                    `Character: ${escapeHtml(pending.characterName)}`,
                ].join('\n');
                sendTelegramNotification(tgMsg).catch(() => {});
                delete verifyState.pending[channelId];
                saveVerifyPendingState(verifyState);
                const merged = await rebuildMemberOrganizedSheet();
                const mergedMsg = merged.ok ? `\n📚 Member list refreshed: ${merged.count} rows` : '';
                try {
                    const ch = await client.channels.fetch(channelId).catch(() => null);
                    if (ch) {
                        await ch.send({ content: `✅ Verification **approved** by ${interaction.user}! Character **${pending.characterName}** added to member list. You can register more characters anytime with /myinfo_register or the panel button.` });
                        await ch.delete().catch(() => {});
                    }
                } catch (_) {}
                await interaction.followUp({ content: `✅ Approved. Character **${pending.characterName}** added to Member_List_${regionCfg.code}${mergedMsg}`, flags: EPHEMERAL_FLAGS }).catch(() => {});
            } catch (err) {
                console.error('[verify_approve]', err);
                await interaction.followUp({ content: `❌ Error: ${err.message}`, flags: EPHEMERAL_FLAGS }).catch(() => {});
            }
            return;
        }
    }

    // 모달 제출
    if (interaction.isModalSubmit()) {
        if (interaction.user.bot) return;
        if (interaction.user.id === client.user?.id) return;
        const customId = interaction.customId;

        if (customId === 'modal_char_verify') {
            const characterName = (interaction.fields.getTextInputValue('character_name') || '').trim();
            if (!characterName) {
                await interaction.reply({ content: '❌ Please enter your character name.', flags: EPHEMERAL_FLAGS });
                return;
            }
            if (!interaction.guildId) {
                await interaction.reply({ content: '❌ Guild only.', flags: EPHEMERAL_FLAGS });
                return;
            }
            const state = loadPanelState();
            const categoryId = state.verifyCategoryIdByGuild?.[interaction.guildId] || state.verifyCategoryId;
            if (!categoryId) {
                await interaction.reply({ content: '❌ Verification not configured. Ask an admin to run `/verify_channel_set category:<category>` first.', flags: EPHEMERAL_FLAGS });
                return;
            }
            const guild = interaction.guild;
            const category = guild.channels.cache.get(categoryId);
            if (!category || category.type !== ChannelType.GuildCategory) {
                await interaction.reply({ content: '❌ Verification category not found. Admin: run `/verify_channel_set` again.', flags: EPHEMERAL_FLAGS });
                return;
            }
            await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
            const safeName = characterName.replace(/[^\w\s-]/g, '').slice(0, 50) || 'verify';
            const channelName = `verify-${safeName}-${interaction.user.id.slice(-6)}`;
            try {
                const channel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: categoryId,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] },
                    ],
                });
                const manageRoles = guild.roles.cache.filter(r => r.permissions.has(PermissionFlagsBits.ManageGuild));
                for (const [, role] of manageRoles) {
                    if (!channel.permissionOverwrites.cache.has(role.id)) {
                        await channel.permissionOverwrites.create(role, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true,
                            ManageMessages: true,
                        });
                    }
                }
                const verifyState = loadVerifyPendingState();
                verifyState.pending[channel.id] = {
                    userId: interaction.user.id,
                    characterName,
                    guildId: guild.id,
                    createdAt: Date.now(),
                };
                saveVerifyPendingState(verifyState);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`verify_approve_${channel.id}`).setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji('✅'),
                    new ButtonBuilder().setCustomId(`verify_reject_${channel.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setEmoji('❌')
                );
                const embed = new EmbedBuilder()
                    .setTitle('🎮 Character Verification')
                    .setDescription(
                        `**Character:** \`${characterName}\`\n**User:** ${interaction.user}\n\n` +
                        '📷 **Upload your screenshot HERE** — Drag & drop an image, or click **+** to attach file.\n' +
                        '_(Discord modals cannot accept files. Upload in this channel.)_\n\n' +
                        'Staff will review and click **Approve** or **Reject**.'
                    )
                    .setColor(0x5865F2)
                    .setTimestamp();
                await channel.send({
                    content: `${interaction.user} — Verification channel created.`,
                    embeds: [embed],
                    components: [row],
                });
                await interaction.editReply({ content: `✅ Verification channel created: <#${channel.id}>\n\n**→ Go to that channel and upload your screenshot** (drag & drop or click + to attach). The modal cannot accept files.` });
            } catch (err) {
                console.error('[modal_char_verify]', err);
                await interaction.editReply({ content: `❌ Failed to create channel: ${err.message}` }).catch(() => {});
            }
            return;
        }

        if (customId.startsWith('modal_payment_confirm_')) {
            const currency = customId.replace('modal_payment_confirm_', '') || 'KRW';
            const amount = interaction.fields.getTextInputValue('amount')?.trim();
            const reason = (interaction.fields.getTextInputValue('reason') || '').trim() || 'N/A';
            if (!amount) {
                await interaction.reply({ content: '❌ Please enter the amount.', flags: EPHEMERAL_FLAGS });
                return;
            }
            await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
            try {
                const discordTag = interaction.user.tag || interaction.user.username;
                const row = [new Date().toLocaleString('ko-KR'), 'MEMBER_CONFIRM', discordTag, amount, currency, reason, 'Pending Verification'];
                const res = await appendToSheet("'Payment Log'!A:G", row);
                if (!res.ok) {
                    await interaction.editReply({ content: `❌ Failed to save: ${res.error}\nCreate **Payment Log** sheet with columns A:G (Date, Type, Tag, Amount, Currency, Reason, Status).` });
                    return;
                }
                const proofEmbed = new EmbedBuilder()
                    .setTitle('💎 MEMBER PAYMENT VERIFIED')
                    .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
                    .setColor(0x7289DA)
                    .addFields(
                        { name: '💵 Amount Received', value: `\`${amount} ${currency}\``, inline: true },
                        { name: '📝 Description', value: reason || 'N/A', inline: true }
                    )
                    .setFooter({ text: 'TETRA Agency Public Ledger' })
                    .setTimestamp();
                await interaction.channel.send({
                    content: `✅ **Payment confirmation submitted — ${interaction.user}**`,
                    embeds: [proofEmbed]
                });
                await interaction.editReply({ content: '✅ Payment confirmation submitted.' });
            } catch (err) {
                console.error('[modal_payment_confirm]', err);
                await interaction.editReply({ content: `❌ Error while saving: ${err.message || 'Unknown error'}` }).catch(() => {});
            }
            return;
        }

        if (customId === 'modal_youtube_add') {
            const url = interaction.fields.getTextInputValue('youtube_url')?.trim();
            if (!url) {
                await interaction.reply({ content: '❌ Please enter a YouTube URL.', flags: EPHEMERAL_FLAGS });
                return;
            }
            await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
            try {
                const ready = await fetchYouTubeVideoReadyInfo(url);
                await interaction.channel.send({
                    content: buildYouTubeReadyCardMessage(ready),
                    allowedMentions: { parse: [] }
                });
                await interaction.editReply({ content: '✅ Posted translated link to channel.' });
            } catch (err) {
                await interaction.editReply({ content: `❌ YouTube processing failed: ${err.message || 'Unknown error'}` });
            }
            return;
        }

        if (customId.startsWith('modal_link_add:')) {
            const category = customId.replace('modal_link_add:', '') || 'current';
            const urlInput = (interaction.fields.getTextInputValue('link_url') || '').trim().replace(/^<(.+)>$/g, '$1');
            if (!urlInput) {
                await interaction.reply({ content: '❌ Please enter a URL.', flags: EPHEMERAL_FLAGS });
                return;
            }
            if (!INVEN_URL_PATTERN.test(urlInput)) {
                await interaction.reply({
                    content: '❌ Invalid URL. Use AION2 board or Webzine links.\nExample: `https://inven.co.kr/board/aion2/695/12345`',
                    flags: EPHEMERAL_FLAGS
                });
                return;
            }
            await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
            try {
                const data = await fetchInvenArticle(urlInput);
                const linkEmbeds = buildLinkEmbeds(data);
                let targetCh = interaction.channel;
                if (category !== 'current') {
                    const parentId = (loadPanelState().linkTargetParentCategoryIdByGuild || {})[interaction.guildId];
                    targetCh = await resolveTacticsCategoryToChannel(interaction.guildId, category, parentId) || interaction.channel;
                }
                await sendLinkEmbedsInBatches(targetCh, linkEmbeds);
                await interaction.editReply({ content: targetCh.id !== interaction.channel.id ? `✅ Posted to <#${targetCh.id}>` : '✅ Posted summarized & translated article to channel.' });
            } catch (err) {
                await interaction.editReply({ content: `❌ Link fetch failed: ${err.message || 'Unknown error'}` });
            }
            return;
        }

        const reportMatch = String(customId || '').match(/^modal_(kinah|levelup)_(start|end)_([a-z]{2})$/i);
        const joinMatch = String(customId || '').match(/^modal_join_verify_([a-z]{2})$/i);
        if (!reportMatch && !joinMatch) {
            await interaction.reply({ content: '❌ Unknown modal request.', flags: EPHEMERAL_FLAGS });
            return;
        }
        const modalType = reportMatch ? reportMatch[1].toLowerCase() : 'join_verify';
        const phase = reportMatch ? reportMatch[2].toLowerCase() : null;
        const region = (reportMatch ? reportMatch[3] : joinMatch[1]).toLowerCase();
        const worker = (interaction.member?.displayName || interaction.user.globalName || interaction.user.username || 'Unknown').trim();
        const regionCfg = getRegionConfig(region);
        if (!regionCfg) {
            await interaction.reply({ content: `❌ Invalid region. Supported: ${SUPPORTED_REGION_CODES}.`, flags: EPHEMERAL_FLAGS });
            return;
        }
        await interaction.deferReply({ flags: EPHEMERAL_FLAGS });
        const timestamp = makeLocalTimestamp(regionCfg.timeZone);
        if (modalType === 'kinah' || modalType === 'levelup') {
            const state = loadPanelState();
            const sessions = ensureReportSessionsForGuild(state, interaction.guildId);
            pruneOldReportSessions(sessions, Date.now());
            const sessionKey = buildReportSessionKey(interaction.user.id, modalType, regionCfg.value);

            if (modalType === 'kinah' && phase === 'start') {
                const startKinahRaw = interaction.fields.getTextInputValue('start_kinah');
                const memo = (interaction.fields.getTextInputValue('memo') || '').trim();
                const startKinah = parseNonNegativeBigIntInput(startKinahRaw);
                if (startKinah == null) {
                    await interaction.editReply({ content: '❌ 시작 키나는 숫자만 입력해주세요.' });
                    return;
                }
                sessions[sessionKey] = {
                    userId: interaction.user.id,
                    worker,
                    team: 'kinah',
                    region: regionCfg.value,
                    startedAt: Date.now(),
                    loginAt: timestamp,
                    startKinah: startKinah.toString(),
                    startMemo: memo,
                };
                savePanelState(state, true);
                const data = [
                    timestamp,
                    worker,
                    'KinahStart',
                    timestamp,
                    '-',
                    '-',
                    `StartKinah:${formatBigIntWithCommas(startKinah)}${memo ? ` | Memo:${memo}` : ''}`,
                ];
                const res = await appendToSheet(regionCfg.sheetRange, data);
                await interaction.editReply({
                    content: res.ok
                        ? `✅ Start Kinah saved (${worker}) → ${regionCfg.code}\n• Login: **${timestamp}**\n• Start Kinah: **${formatBigIntWithCommas(startKinah)}**`
                        : `❌ Failed. Create **Daily_Log_${regionCfg.code}** sheet.`
                });
                return;
            }

            if (modalType === 'kinah' && phase === 'end') {
                const endKinahRaw = interaction.fields.getTextInputValue('end_kinah');
                const spentKinahRaw = interaction.fields.getTextInputValue('spent_kinah');
                const memo = (interaction.fields.getTextInputValue('memo') || '').trim();
                const endKinah = parseNonNegativeBigIntInput(endKinahRaw);
                const spentKinah = parseNonNegativeBigIntInput(spentKinahRaw);
                if (endKinah == null || spentKinah == null) {
                    await interaction.editReply({ content: '❌ 종료 키나/소비 키나는 숫자만 입력해주세요.' });
                    return;
                }
                const startSession = sessions[sessionKey];
                if (!startSession) {
                    await interaction.editReply({ content: '❌ 먼저 **Start Kinah Team** 보고를 제출해주세요.' });
                    return;
                }
                const startKinah = parseNonNegativeBigIntInput(startSession.startKinah);
                if (startKinah == null) {
                    delete sessions[sessionKey];
                    savePanelState(state, true);
                    await interaction.editReply({ content: '❌ 시작 데이터가 손상되었습니다. Start 보고를 다시 제출해주세요.' });
                    return;
                }
                const onHandDelta = endKinah - startKinah;
                const netProfit = endKinah - startKinah - spentKinah;
                const grossFarmed = onHandDelta + spentKinah;
                const data = [
                    timestamp,
                    worker,
                    'KinahEnd',
                    startSession.loginAt || 'N/A',
                    timestamp,
                    formatBigIntWithCommas(netProfit),
                    `Start:${formatBigIntWithCommas(startKinah)} | End:${formatBigIntWithCommas(endKinah)} | Spent:${formatBigIntWithCommas(spentKinah)} | Delta:${formatBigIntWithCommas(onHandDelta)} | Gross:${formatBigIntWithCommas(grossFarmed)}${startSession.startMemo ? ` | StartMemo:${startSession.startMemo}` : ''}${memo ? ` | EndMemo:${memo}` : ''}`,
                ];
                const res = await appendToSheet(regionCfg.sheetRange, data);
                if (res.ok) {
                    const msg = [
                        '📋 <b>Daily Log — Kinah End</b>',
                        `Region: ${regionCfg.code} | ${timestamp}`,
                        `Worker: ${escapeHtml(worker)}`,
                        `Login: ${escapeHtml(startSession.loginAt || 'N/A')} | Logout: ${escapeHtml(timestamp)}`,
                        '',
                        `Start: ${escapeHtml(formatBigIntWithCommas(startKinah))}`,
                        `End: ${escapeHtml(formatBigIntWithCommas(endKinah))}`,
                        `Spent: ${escapeHtml(formatBigIntWithCommas(spentKinah))}`,
                        `Net (End-Start-Spent): ${escapeHtml(formatBigIntWithCommas(netProfit))}`,
                        `Gross (Delta+Spent): ${escapeHtml(formatBigIntWithCommas(grossFarmed))}`,
                    ].join('\n');
                    sendTelegramNotification(msg).catch(() => {});
                    delete sessions[sessionKey];
                    savePanelState(state, true);
                }
                await interaction.editReply({
                    content: res.ok
                        ? `✅ End Kinah submitted (${worker}) → ${regionCfg.code}\n• Logout: **${timestamp}**\n• Net: **${formatBigIntWithCommas(netProfit)}**\n• Gross: **${formatBigIntWithCommas(grossFarmed)}**`
                        : `❌ Failed. Create **Daily_Log_${regionCfg.code}** sheet.`
                });
                return;
            }

            if (modalType === 'levelup' && phase === 'start') {
                const startLevelRaw = interaction.fields.getTextInputValue('start_level');
                const startCpRaw = interaction.fields.getTextInputValue('start_cp');
                const memo = (interaction.fields.getTextInputValue('memo') || '').trim();
                const startLevel = parseNonNegativeIntInput(startLevelRaw);
                const startCp = parseNonNegativeIntInput(startCpRaw);
                if (startLevel == null || startCp == null) {
                    await interaction.editReply({ content: '❌ 시작 레벨/전투력은 숫자만 입력해주세요.' });
                    return;
                }
                sessions[sessionKey] = {
                    userId: interaction.user.id,
                    worker,
                    team: 'levelup',
                    region: regionCfg.value,
                    startedAt: Date.now(),
                    loginAt: timestamp,
                    startLevel,
                    startCp,
                    startMemo: memo,
                };
                savePanelState(state, true);
                const data = [
                    timestamp,
                    worker,
                    'LevelUpStart',
                    timestamp,
                    '-',
                    '-',
                    `StartLevel:${startLevel} | StartCP:${startCp}${memo ? ` | Memo:${memo}` : ''}`,
                ];
                const res = await appendToSheet(regionCfg.sheetRange, data);
                await interaction.editReply({
                    content: res.ok
                        ? `✅ Start Level-Up saved (${worker}) → ${regionCfg.code}\n• Login: **${timestamp}**\n• Start: **Lv.${startLevel} / CP ${startCp.toLocaleString()}**`
                        : `❌ Failed. Create **Daily_Log_${regionCfg.code}** sheet.`
                });
                return;
            }

            if (modalType === 'levelup' && phase === 'end') {
                const endLevelRaw = interaction.fields.getTextInputValue('end_level');
                const endCpRaw = interaction.fields.getTextInputValue('end_cp');
                const memo = (interaction.fields.getTextInputValue('memo') || '').trim();
                const endLevel = parseNonNegativeIntInput(endLevelRaw);
                const endCp = parseNonNegativeIntInput(endCpRaw);
                if (endLevel == null || endCp == null) {
                    await interaction.editReply({ content: '❌ 종료 레벨/전투력은 숫자만 입력해주세요.' });
                    return;
                }
                const startSession = sessions[sessionKey];
                if (!startSession) {
                    await interaction.editReply({ content: '❌ 먼저 **Start Level-Up Team** 보고를 제출해주세요.' });
                    return;
                }
                const startLevel = parseNonNegativeIntInput(startSession.startLevel);
                const startCp = parseNonNegativeIntInput(startSession.startCp);
                if (startLevel == null || startCp == null) {
                    delete sessions[sessionKey];
                    savePanelState(state, true);
                    await interaction.editReply({ content: '❌ 시작 데이터가 손상되었습니다. Start 보고를 다시 제출해주세요.' });
                    return;
                }
                const levelGain = endLevel - startLevel;
                const cpGain = endCp - startCp;
                const data = [
                    timestamp,
                    worker,
                    'LevelUpEnd',
                    startSession.loginAt || 'N/A',
                    timestamp,
                    `Lv${levelGain >= 0 ? '+' : ''}${levelGain} / CP${cpGain >= 0 ? '+' : ''}${cpGain}`,
                    `StartLv:${startLevel} | EndLv:${endLevel} | StartCP:${startCp} | EndCP:${endCp}${startSession.startMemo ? ` | StartMemo:${startSession.startMemo}` : ''}${memo ? ` | EndMemo:${memo}` : ''}`,
                ];
                const res = await appendToSheet(regionCfg.sheetRange, data);
                if (res.ok) {
                    const msg = [
                        '📋 <b>Daily Log — Level-Up End</b>',
                        `Region: ${regionCfg.code} | ${timestamp}`,
                        `Worker: ${escapeHtml(worker)}`,
                        `Login: ${escapeHtml(startSession.loginAt || 'N/A')} | Logout: ${escapeHtml(timestamp)}`,
                        '',
                        `Level: ${startLevel} -> ${endLevel} (Gain ${levelGain >= 0 ? '+' : ''}${levelGain})`,
                        `CP: ${startCp} -> ${endCp} (Gain ${cpGain >= 0 ? '+' : ''}${cpGain})`,
                    ].join('\n');
                    sendTelegramNotification(msg).catch(() => {});
                    delete sessions[sessionKey];
                    savePanelState(state, true);
                }
                await interaction.editReply({
                    content: res.ok
                        ? `✅ End Level-Up submitted (${worker}) → ${regionCfg.code}\n• Logout: **${timestamp}**\n• Level Gain: **${levelGain >= 0 ? '+' : ''}${levelGain}**\n• CP Gain: **${cpGain >= 0 ? '+' : ''}${cpGain}**`
                        : `❌ Failed. Create **Daily_Log_${regionCfg.code}** sheet.`
                });
                return;
            }
            await interaction.editReply({ content: '❌ Unsupported report phase.' });
        } else if (modalType === 'join_verify') {
            const roleNote = (interaction.fields.getTextInputValue('role_note') || '').trim();
            const saved = await appendMemberListRecord(interaction, regionCfg, roleNote, '');
            if (!saved.ok) {
                await interaction.editReply({ content: `❌ Join verification save failed (${regionCfg.code}). Create **Member_List_${regionCfg.code}** sheet in Google Sheets.` });
                return;
            }
            const tgMsg = [
                '👤 <b>신규 회원 (가입 인증)</b>',
                `Region: ${regionCfg.code}`,
                `User: ${escapeHtml(worker)}`,
                roleNote ? `Role/Note: ${escapeHtml(roleNote)}` : '',
            ].filter(Boolean).join('\n');
            sendTelegramNotification(tgMsg).catch(() => {});
            const merged = await rebuildMemberOrganizedSheet();
            const mergedMsg = merged.ok
                ? `\n📚 Organized member sheet refreshed: ${merged.count} row(s)`
                : `\n⚠️ Organized member sheet refresh failed: ${merged.error}`;
            const charVerifyRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_char_verify_open')
                    .setLabel('Character Verification')
                    .setEmoji('🎮')
                    .setStyle(ButtonStyle.Primary)
            );
            await interaction.editReply({
                content: `✅ Join verification completed (${regionCfg.code})\n- User: ${worker}${mergedMsg}\n\n**Next: Complete Character Verification** — Upload a screenshot of your AION2 character. Staff approval required. Click the button below.`,
                components: [charVerifyRow],
            });
        } else {
            await interaction.editReply({ content: '❌ Unsupported modal type.' });
        }
    }

    } catch (err) {
        console.error('Interaction error:', err);
        try {
            if (!interaction?.isRepliable?.()) return;
            if (interaction.deferred) {
                await interaction.editReply({ content: '❌ An error occurred. Please try again.' }).catch(() => {});
            } else if (!interaction.replied) {
                await interaction.reply({ content: '❌ An error occurred. Please try again.', flags: EPHEMERAL_FLAGS }).catch(() => {});
            }
        } catch (_) {}
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

function stripHtmlTags(text) {
    return String(text || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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
    const safeName = stripHtmlTags(first.name) || charName.trim();
    return {
        name: safeName,
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
        browser = await puppeteer.launch(await getPuppeteerLaunchOptions());
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

const GUIDEBOOK_BASE_URL = 'https://aion2.plaync.com/ko-kr/guidebook';
const GUIDEBOOK_EN_URL = 'https://aion2.plaync.com/en-us/guidebook/list';
function isValidEmbedUrl(u) {
    if (!u || typeof u !== 'string') return false;
    const trimmed = u.trim();
    return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

const NC_FOOTER_PATTERNS = [
    /\bThis\s+document\s+was\s+updated\s+on\s+\d{4}-\d{2}-\d{2}/i,
    /이\s*문서는\s+\d{4}-\d{2}-\d{2}\s*에\s*업데이트/i,
    /\bYoutube\s+Company\s+Introduction\b/i,
    /\bSupport\s+NC\s*Privacy\s*Center/i,
    /\bNC\s*Privacy\s*Center\s+NCSOFT/i,
    /\bNCSOFT\s+Service\s+Agreement/i,
    /\bNC\s+Probab(?:ility|ability)\s+Information/i,
    /\bGame\s+Usage\s+Rating\b/i,
    /\bCompany\s*Introduction\s*Terms\s*of\s*Use/i,
    /\bTerms\s*of\s*Use\s*Privacy\s*Policy/i,
    /\bCompany\s*Name\s*NCSoft/i,
    /\bCo-CEOs?\s+Taek/i,
    /\bBusiness\s*Registration\s*Number\s+\d/i,
    /\bMail\s*Order\s*Business\s*Report\s*No\./i,
    /\b(?:12\s+)?Daewangpangyo-ro\s*(?:644|12)/i,
    /\b144-85-04244\b/,
    /\b2013-Gyeonggi\s+Seongnam/i,
    /\b1600-0020\b/,
    /\bFax\s+02-\d/i,
    /credit@ncsoft\.com/i,
    /\bCopyright\s*[©ⓒ]\s*(NCSOFT|NCSoft)/i,
    /\bAll\s+Rights\s+Reserved\b/i,
    /\bNCSOFT\s+OFF\b/i,
    /\s+회사소개\s*이용약관\s*개인정보/i,
    /\b상호\s*\(주\)\s*엔씨소프트\b/i,
    /\b사업자\s*등록번호\s*\d{3}-\d{2}-\d{5}/,
];

function stripNcsoftFooter(text) {
    if (!text || typeof text !== 'string') return text || '';
    let out = text.trim();
    let minIdx = out.length;
    for (const rx of NC_FOOTER_PATTERNS) {
        const m = out.match(rx);
        if (m && m.index != null && m.index < minIdx) minIdx = m.index;
    }
    return minIdx < out.length ? out.slice(0, minIdx).trim() : out;
}
const AION2_CLASS_NAMES = ['검성', '수호성', '살성', '궁성', '호법성', '치유성', '마도성', '정령성'];
const AION2_CLASS_NAMES_EN = { '검성': 'Swordmaster', '수호성': 'Gladiator', '살성': 'Assassin', '궁성': 'Ranger', '호법성': 'Chanter', '치유성': 'Cleric', '마도성': 'Sorcerer', '정령성': 'Spiritmaster' };
const GUIDEBOOK_CATEGORIES = [
    { id: '4227', name: 'Beginner\'s Guide', nameEn: 'Beginner\'s Guide' },
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
    { id: '4244', name: 'Gathering & Crafting', nameEn: 'Gathering & Crafting' },
];
const GUIDEBOOK_MAX_GUIDES_PER_CATEGORY = 6;
const GUIDEBOOK_MAX_CLASS_GUIDES = 8;
const GUIDEBOOK_MAX_DETAIL_PER_CATEGORY = 4;
const GUIDEBOOK_MAX_CONTENT_LENGTH = 3500;
const GUIDEBOOK_FETCH_TIMEOUT_MS = Math.max(60_000, parseInt(process.env.GUIDEBOOK_FETCH_TIMEOUT_MS || '180000', 10) || 180_000);
const GUIDEBOOK_DETAIL_ENRICH_PER_CATEGORY = Math.max(0, parseInt(process.env.GUIDEBOOK_DETAIL_ENRICH_PER_CATEGORY || '1', 10) || 1);
const GUIDEBOOK_FALLBACK_CATEGORIES = [
    {
        id: 'local_class',
        name: 'Class Guides (Local)',
        nameEn: 'Class Guides (Local)',
        guides: [
            { title: 'Swordmaster PVE', file: 'inven_58_english.txt', url: 'https://www.inven.co.kr/board/aion2/6448/58' },
            { title: 'Gladiator PVE', file: 'inven_6625_english.txt', url: 'https://www.inven.co.kr/board/aion2/6438/6625' },
            { title: 'Assassin PVE', file: 'inven_3856_english.txt', url: 'https://www.inven.co.kr/board/aion2/6449/3856' },
            { title: 'Ranger PVE', file: 'inven_4009_english.txt', url: 'https://www.inven.co.kr/board/aion2/6450/4009' },
            { title: 'Chanter PVE', file: 'inven_116_english.txt', url: 'https://www.inven.co.kr/board/aion2/6451/116' },
            { title: 'Cleric Guide', file: 'inven_657_english.txt', url: 'https://www.inven.co.kr/board/aion2/6452/657' },
            { title: 'Sorcerer PVE', file: 'inven_66_english.txt', url: 'https://www.inven.co.kr/board/aion2/6453/66' },
            { title: 'Spiritmaster PVE', file: 'inven_2760_english.txt', url: 'https://www.inven.co.kr/board/aion2/6454/2760' },
            { title: 'Spiritmaster PVP', file: 'inven_965_english.txt', url: 'https://www.inven.co.kr/board/aion2/6454/965' }
        ]
    },
    {
        id: 'local_tactics',
        name: '운영/공략 묶음',
        nameEn: 'Curated TACTICS (Local)',
        guides: [
            { title: 'Fast Leveling', file: 'tactics_fast_leveling.txt', url: 'https://www.inven.co.kr/webzine/news/?news=311570' },
            { title: 'Kinah Farming', file: 'tactics_kinah_farming.txt', url: 'https://www.inven.co.kr/board/aion2/6444/1067' },
            { title: 'CP Boost Guide', file: 'tactics_cp_boost_guide.txt', url: 'https://www.inven.co.kr/board/aion2/6444/1383' },
            { title: 'Pantheon/Abyss Guide', file: 'tactics_pantheon_guide.txt', url: 'https://www.inven.co.kr/webzine/news/?news=311736' },
            { title: 'Dungeon Tactics', file: 'tactics_dungeon_tactics.txt', url: 'https://www.inven.co.kr/board/aion2/6444/1393' },
            { title: 'Daily Checklist', file: 'tactics_daily_checklist.txt', url: 'https://www.inven.co.kr/board/aion2/6444/1067' },
            { title: 'Pro Tips', file: 'tactics_pro_tips.txt', url: 'https://www.inven.co.kr/board/aion2/6444/1067' }
        ]
    }
];

function extractImageUrlsFromText(text, max = 5) {
    return Array.from(
        new Set((String(text || '').match(/https?:\/\/[^\s)]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s)]*)?/gi) || []))
    ).slice(0, max);
}

function withTimeout(promise, ms, label = 'operation') {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function applyGuidebookCategoryCoverage(state) {
    const source = state && typeof state === 'object' ? state : {};
    const byId = new Map(
        (Array.isArray(source.categories) ? source.categories : [])
            .map(cat => [String(cat?.id || ''), cat])
    );

    const categories = GUIDEBOOK_CATEGORIES.map(def => {
        const existing = byId.get(def.id);
        const guides = Array.isArray(existing?.guides) ? [...existing.guides] : [];
        if (guides.length === 0) {
            const listUrl = `${GUIDEBOOK_BASE_URL}/list#categoryId=${def.id}`;
            guides.push({
                title: `${def.nameEn || def.name} (Index)`,
                titleEn: `${def.nameEn || def.name} (Index)`,
                url: listUrl,
                desc: 'Guide index for this category.',
                descEn: 'Guide index for this category.',
                content: `Open the official list page for this category:\n${listUrl}`,
                contentEn: `Open the official list page for this category:\n${listUrl}`,
                images: []
            });
        }
        return {
            id: def.id,
            name: def.name,
            nameEn: def.nameEn || def.name,
            guides
        };
    });

    return {
        ...source,
        categories,
        fetchedAt: source.fetchedAt || new Date().toISOString()
    };
}

function loadOfficialGuidebookSeedFromFile() {
    try {
        if (!fs.existsSync(CONFIG.GUIDEBOOK_OFFICIAL_SEED_PATH)) return null;
        const raw = fs.readFileSync(CONFIG.GUIDEBOOK_OFFICIAL_SEED_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.categories)) return null;
        return applyGuidebookCategoryCoverage({
            categories: parsed.categories,
            fetchedAt: parsed.fetchedAt || new Date().toISOString(),
            source: 'official_seed_file'
        });
    } catch (err) {
        console.warn(`[guidebook] official seed load failed: ${err.message}`);
        return null;
    }
}

function buildLocalGuidebookFallbackState() {
    const officialSeed = loadOfficialGuidebookSeedFromFile();
    if (officialSeed && Array.isArray(officialSeed.categories) && officialSeed.categories.length > 0) {
        return officialSeed;
    }
    const categoryMap = Object.fromEntries(
        GUIDEBOOK_CATEGORIES.map(cat => [
            cat.id,
            { id: cat.id, name: cat.name, nameEn: cat.nameEn || cat.name, guides: [] }
        ])
    );
    for (const cat of GUIDEBOOK_FALLBACK_CATEGORIES) {
        const targetCategoryId = cat.id === 'local_class' ? '4234' : '4227';
        const guides = [];
        for (const g of cat.guides) {
            const p = path.join(__dirname, g.file);
            if (!fs.existsSync(p)) continue;
            const raw = fs.readFileSync(p, 'utf8').trim();
            if (!raw) continue;
            const imageUrls = extractImageUrlsFromText(raw, 5);
            const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
            const firstBody = lines.find(l =>
                !l.startsWith('#') &&
                !l.startsWith('-') &&
                !/^source:?/i.test(l) &&
                !/^images:?/i.test(l) &&
                !/^대표 이미지:?/i.test(l) &&
                !/^출처:?/i.test(l)
            ) || 'Local curated fallback guide.';
            guides.push({
                title: g.title,
                titleEn: g.title,
                url: g.url || `${GUIDEBOOK_BASE_URL}/list`,
                desc: firstBody.slice(0, 240),
                descEn: firstBody.slice(0, 240),
                content: raw.slice(0, GUIDEBOOK_MAX_CONTENT_LENGTH),
                contentEn: raw.slice(0, GUIDEBOOK_MAX_CONTENT_LENGTH),
                images: imageUrls
            });
        }
        if (guides.length > 0 && categoryMap[targetCategoryId]) {
            categoryMap[targetCategoryId].guides.push(...guides);
        }
    }
    const categories = GUIDEBOOK_CATEGORIES.map(cat => categoryMap[cat.id]);
    return applyGuidebookCategoryCoverage({ categories, fetchedAt: new Date().toISOString(), source: 'local_fallback' });
}

function loadGuidebookState() {
    const officialSeed = loadOfficialGuidebookSeedFromFile();
    if (officialSeed && Array.isArray(officialSeed.categories) && officialSeed.categories.length > 0) {
        return applyGuidebookCategoryCoverage(officialSeed);
    }

    try {
        const raw = fs.readFileSync(CONFIG.GUIDEBOOK_STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.categories) && parsed.categories.length > 0) {
            return applyGuidebookCategoryCoverage(parsed);
        }
    } catch (_) {}
    const fallback = buildLocalGuidebookFallbackState();
    return fallback.categories.length > 0 ? applyGuidebookCategoryCoverage(fallback) : { categories: [], fetchedAt: null };
}

function buildGuidebookCategorySelect(state, isPublic = false) {
    const categories = state?.categories || [];
    if (categories.length === 0) return null;
    const opts = categories.slice(0, 25).map((cat, i) => ({
        label: (cat.nameEn || cat.name || `Category ${i + 1}`).slice(0, 100),
        value: String(i),
        description: `${(cat.guides || []).length} guide(s)`
    }));
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`select_guidebook_category:${isPublic ? '1' : '0'}`)
            .setPlaceholder('Select category…')
            .addOptions(opts)
    );
}

function buildGuidebookGuideSelect(catIndex, state, isPublic = false) {
    const categories = state?.categories || [];
    const cat = categories[parseInt(catIndex, 10)];
    if (!cat || !cat.guides?.length) return null;
    const opts = cat.guides.slice(0, 25).map((g, i) => ({
        label: (g.titleEn || g.title || `Guide ${i + 1}`).slice(0, 100),
        value: String(i)
    }));
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`select_guidebook_guide:${catIndex}:${isPublic ? '1' : '0'}`)
            .setPlaceholder(`Select guide in ${cat.nameEn || cat.name}…`)
            .addOptions(opts)
    );
}

function buildGuidebookGuideEmbeds(guide, catName) {
    const EMBED_DESC_MAX = 3800;
    const maxContentLen = GUIDEBOOK_MAX_CONTENT_LENGTH;
    const title = guide.titleEn || guide.title || 'Guide';
    const desc = stripNcsoftFooter(guide.descEn || guide.desc || '').trim();
    const content = stripNcsoftFooter(guide.contentEn || guide.content || '').trim().slice(0, maxContentLen);
    let text = [desc, content].filter(Boolean).join('\n\n');
    const linkUrl = isValidEmbedUrl(guide.url) ? guide.url : null;
    if (linkUrl) text = `[${title}](${linkUrl})\n\n` + text;
    const parts = [];
    while (text.length > EMBED_DESC_MAX) {
        const chunk = text.slice(0, EMBED_DESC_MAX);
        const lastNewline = chunk.lastIndexOf('\n');
        const splitAt = lastNewline > EMBED_DESC_MAX * 0.5 ? lastNewline + 1 : EMBED_DESC_MAX;
        parts.push(text.slice(0, splitAt));
        text = text.slice(splitAt);
    }
    if (text) parts.push(text);

    const thumb = isValidEmbedUrl(guide.images?.[0]) ? guide.images[0] : null;
    const embeds = parts.map((p, i) => {
        const emb = new EmbedBuilder().setColor(0x5865F2).setDescription(p.slice(0, 4096));
        if (i === 0) {
            emb.setTitle(`📖 ${catName}: ${title}`);
            if (thumb) emb.setThumbnail(thumb);
        } else {
            emb.setTitle(`${title} (${i + 1}/${parts.length})`);
        }
        return emb;
    });
    if (embeds.length === 0) {
        const fallback = new EmbedBuilder()
            .setTitle(`📖 ${catName}: ${title}`)
            .setDescription(`${linkUrl ? `[${title}](${linkUrl})\n\n` : ''}${desc || 'No content.'}`)
            .setColor(0x5865F2);
        if (thumb) fallback.setThumbnail(thumb);
        return [fallback];
    }
    return embeds;
}

function saveGuidebookState(state) {
    ensureDirectory(path.dirname(CONFIG.GUIDEBOOK_STATE_PATH));
    fs.writeFileSync(CONFIG.GUIDEBOOK_STATE_PATH, JSON.stringify(state, null, 2));
}

async function scrapePlayncGuidebookView(browser, guideUrl) {
    const page = await browser.newPage();
    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0');
        await page.goto(guideUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 2500));
        const data = await page.evaluate(() => {
            const titleEl = document.querySelector('h1, [class*="title"], h2, .tit');
            const title = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 150);
            const selectors = ['[class*="content"]', '[class*="body"]', 'article', 'main', '[class*="view"]', '.guide-view'];
            let contentEl = null;
            for (const sel of selectors) {
                contentEl = document.querySelector(sel);
                if (contentEl && (contentEl.textContent || '').length > 100) break;
            }
            let content = '';
            if (contentEl) {
                const parts = [];
                const skipTags = new Set(['SCRIPT', 'STYLE', 'NAV', 'HEADER', 'FOOTER']);
                const walk = (el) => {
                    if (!el || skipTags.has(el.tagName)) return;
                    if (['P', 'LI', 'H2', 'H3', 'H4', 'DIV', 'SPAN'].includes(el.tagName)) {
                        if (el.children.length === 0 || el.tagName === 'P' || el.tagName === 'LI') {
                            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
                            if (t && t.length > 15 && t.length < 1000) parts.push(t);
                        }
                    }
                    for (const c of el.children || []) walk(c);
                };
                walk(contentEl);
                content = [...new Set(parts)].join('\n\n').slice(0, 5000);
            }
            if (!content || content.length < 50) {
                const allText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
                const lines = allText.split('\n').filter(l => l.length > 25 && l.length < 600);
                content = lines.slice(0, 35).join('\n\n').slice(0, 5000);
            }
            const imgs = Array.from(document.querySelectorAll('img[src]'))
                .map(img => img.src)
                .filter(src => /^https?:\/\//.test(src) && !/logo|icon|avatar|button|sprite|blank|pixel|1x1|dot/i.test(src) && src.length < 500)
                .slice(0, 5);
            const links = [];
            for (const a of Array.from(document.querySelectorAll('a[href*="guidebook/view"], a[href*="/guidebook/"]'))) {
                const href = a.href || '';
                if (!href.includes('view')) continue;
                const text = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
                links.push({ href, text });
            }
            return { title: title || null, content: content || null, images: imgs, links };
        });
        return data;
    } finally {
        await page.close().catch(() => {});
    }
}

async function scrapePlayncGuidebookCategory(browser, categoryId) {
    const page = await browser.newPage();
    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0');
        await page.goto(`${GUIDEBOOK_BASE_URL}/list?categoryId=${categoryId}`, { waitUntil: 'networkidle2', timeout: 20000 });
        await new Promise(r => setTimeout(r, 3500));
        const data = await page.evaluate(() => {
            const out = [];
            const cards = document.querySelectorAll('a[href*="/guidebook/view"], a[href*="/guidebook/"]');
            const seen = new Set();
            for (const a of Array.from(cards)) {
                const href = a.href || '';
                if (!href.includes('view') && !/\/guidebook\/\d+$/.test(href)) continue;
                const titleEl = a.querySelector('h3, h4, [class*="title"], strong') || a;
                const descEl = a.querySelector('p, [class*="desc"], span');
                const title = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
                const desc = (descEl?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
                if (!title || title.length < 2) continue;
                const key = title + href;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ title, desc: desc || null, url: href });
            }
            const fallbackLinks = document.querySelectorAll('a[href*="guidebook/view"]');
            if (out.length === 0 && fallbackLinks.length) {
                for (const a of Array.from(fallbackLinks)) {
                    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
                    const parts = text.split(/\s{2,}/);
                    const title = (parts[0] || text).slice(0, 120);
                    if (title.length >= 2) out.push({ title, desc: parts[1] || null, url: a.href });
                    if (out.length >= 30) break;
                }
            }
            return out;
        });
        return data;
    } finally {
        await page.close().catch(() => {});
    }
}

function parseClassSkillTitle(title) {
    const t = String(title || '').trim();
    for (const c of AION2_CLASS_NAMES) {
        if (t === `${c} 스킬` || t.startsWith(`${c} 스킬`)) return { className: c, type: '스킬' };
    }
    return null;
}

function findSkillLinkFromDetail(g, className) {
    const links = g.links || [];
    const pattern = new RegExp(className + '\\s*스킬', 'i');
    for (const { href, text } of links) {
        if (pattern.test(text)) return href;
        try {
            const u = new URL(href);
            const title = u.searchParams.get('title') || '';
            if (pattern.test(decodeURIComponent(title))) return href;
        } catch (_) {}
    }
    return null;
}

async function fetchAndEnrichGuide(browser, g, options = {}) {
    const translateContent = options.translateContent !== false;
    if (!g.url || !g.url.includes('view')) return g;
    try {
        const detail = await scrapePlayncGuidebookView(browser, g.url);
        g.content = detail.content || g.desc;
        g.images = detail.images || [];
        g.links = detail.links || [];
        if (detail.title) g.title = detail.title;
        if (hasHangul(g.title)) g.titleEn = await withTimeout(translateKoToEn(g.title), 4000, 'guide title translation').catch(() => g.title) || g.title;
        else g.titleEn = g.title;
        if (g.desc && hasHangul(g.desc)) g.descEn = await withTimeout(translateKoToEn(g.desc), 4000, 'guide desc translation').catch(() => g.desc) || g.desc;
        else g.descEn = g.desc;
        if (translateContent && g.content && hasHangul(g.content)) {
            g.contentEn = await withTimeout(translateKoToEnLong(g.content.slice(0, 1200)), 9000, 'guide content translation').catch(() => g.content.slice(0, 1200)) || g.content.slice(0, 1200);
        } else {
            g.contentEn = (g.content || '').slice(0, 1200);
        }
    } catch (err) {
        console.warn(`[guidebook] view ${g.title?.slice(0, 30)} failed:`, err.message);
    }
    return g;
}

async function scrapePlayncGuidebookAll() {
    let browser;
    const results = { categories: [], fetchedAt: new Date().toISOString() };
    try {
        browser = await puppeteer.launch(await getPuppeteerLaunchOptions());
        for (let ci = 0; ci < GUIDEBOOK_CATEGORIES.length; ci++) {
            const cat = GUIDEBOOK_CATEGORIES[ci];
            try {
                let guides = await withTimeout(
                    scrapePlayncGuidebookCategory(browser, cat.id),
                    25000,
                    `guidebook category ${cat.id}`
                );
                guides = Array.isArray(guides) ? guides.slice(0, GUIDEBOOK_MAX_GUIDES_PER_CATEGORY) : [];
                for (let i = 0; i < guides.length; i++) {
                    const g = guides[i];
                    g.images = Array.isArray(g.images) ? g.images : [];
                    g.links = Array.isArray(g.links) ? g.links : [];
                    g.content = g.content || g.desc || '';

                    if (hasHangul(g.title || '')) {
                        g.titleEn = await withTimeout(translateKoToEn(g.title), 4000, 'list title translation').catch(() => g.title) || g.title;
                    } else {
                        g.titleEn = g.title;
                    }
                    if (g.desc && hasHangul(g.desc)) {
                        g.descEn = await withTimeout(translateKoToEn(g.desc), 4000, 'list desc translation').catch(() => g.desc) || g.desc;
                    } else {
                        g.descEn = g.desc || '';
                    }
                    g.contentEn = (g.descEn || g.desc || '').slice(0, 350);

                    if (i < GUIDEBOOK_DETAIL_ENRICH_PER_CATEGORY) {
                        await withTimeout(fetchAndEnrichGuide(browser, g, { translateContent: false }), 20000, 'guide detail enrich').catch(() => {});
                    }
                    await new Promise(r => setTimeout(r, 150));
                }
                results.categories.push({ id: cat.id, name: cat.name, nameEn: cat.nameEn || cat.name, guides });
            } catch (err) {
                console.warn(`[guidebook] category ${cat.id} failed:`, err.message);
            }
            await new Promise(r => setTimeout(r, 250));
        }
        return results;
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

function buildGuidebookPlayncEmbeds(state) {
    const categories = state?.categories || [];
    if (categories.length === 0) {
        return [new EmbedBuilder()
            .setTitle('📖 AION2 Official Guidebook')
            .setDescription('No guide data is available.\nCheck `guidebook_official_seed.json`, then run **`/guidebook_fetch`** to refresh local cache if needed.')
            .setColor(0x5865F2)
            .addFields({ name: '🔗 Link', value: `[AION2 Guidebook](${GUIDEBOOK_BASE_URL}/list)`, inline: false })
            .setTimestamp()];
    }
    const embeds = [];
    const listLines = categories.map(cat => {
        const guides = cat.guides || [];
        const catName = cat.nameEn || cat.name;
        const links = guides.slice(0, 5).map(g => {
            const t = g.titleEn || g.title || 'Guide';
            const u = isValidEmbedUrl(g.url) ? g.url : GUIDEBOOK_BASE_URL + '/list';
            return `• [${t}](${u})`;
        }).join('\n');
        return `**${catName}** (${guides.length})\n${links || '-'}`;
    });
    // Discord limit: 6000 chars total across ALL embeds. Panel shows overview only; details via Open Guidebook.
    const DESC_MAX = 4000;
    embeds.push(new EmbedBuilder()
        .setTitle('📖 AION2 Official Guidebook (PlayNC)')
        .setDescription(`[🔗 Full Guidebook](${GUIDEBOOK_BASE_URL}/list)\n\n${listLines.join('\n\n').slice(0, DESC_MAX)}`)
        .setColor(0x5865F2)
        .setFooter({ text: state.fetchedAt ? `Fetched: ${state.fetchedAt.slice(0, 10)}` : 'Run /guidebook_fetch to refresh' })
        .setTimestamp());
    return embeds;
}

function buildLinkFallbackEmbed(charName, addUrlHint = false, displayQuery = null) {
    const encoded = encodeURIComponent(charName);
    const titleName = displayQuery != null ? displayQuery : charName;
    const armoryLink = `https://talentbuilds.com/aion2/armory?search=${encoded}&region=korea`;
    const shugoLink = `https://shugo.gg/?q=${encoded}`;
    const playncLink = 'https://aion2.plaync.com/ko-kr/characters/index';
    let desc = `**AION 2 Character Lookup**\n\nCheck search results for "${titleName}" below:\n\n` +
        `🔗 [Talentbuilds Armory](${armoryLink})\n` +
        `🔗 [Shugo.GG](${shugoLink})\n` +
        `🔗 [Official Character Info](${playncLink})`;
    if (addUrlHint) desc += '\n\n💡 **Tip:** Paste the character page URL with `!char [URL]` to view full details here.';
    return new EmbedBuilder()
        .setTitle(`🔍 TETRA Intelligence: ${titleName}`)
        .setDescription(desc)
        .setColor(0xFF0055)
        .setFooter({ text: 'TETRA Streamer Portal | Character Search' })
        .setTimestamp();
}

const SEARCH_THUMBNAIL_DEFAULT = 'https://i.imgur.com/8fXU89V.png';

function buildItemLookupEmbed(query, displayQuery = null) {
    const encoded = encodeURIComponent(query);
    const titleQuery = displayQuery != null ? displayQuery : query;
    return new EmbedBuilder()
        .setTitle(`Item Lookup: ${titleQuery}`)
        .setDescription([
            'Search for items using the links below:',
            '',
            `🔗 [Talentbuilds Armory](https://talentbuilds.com/aion2/armory?search=${encoded}&region=korea)`,
            `🔗 [Shugo.GG](https://shugo.gg/?q=${encoded})`,
            `🔗 [Google site search](https://www.google.com/search?q=site%3Aaion2.plaync.com+${encoded})`,
        ].join('\n'))
        .setColor(0x16a34a)
        .setThumbnail(SEARCH_THUMBNAIL_DEFAULT)
        .setTimestamp();
}

async function scrapeTalentbuildsDb(query, category) {
    let browser;
    try {
        browser = await puppeteer.launch(await getPuppeteerLaunchOptions());
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0');
        const url = `https://talentbuilds.com/aion2/database/${category || 'armor'}?search=${encodeURIComponent(query)}`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
        await new Promise(r => setTimeout(r, 3000));
        const items = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/database/"], a[href*="/armor"], a[href*="/weapons"], a[href*="/accessories"]'));
            const seen = new Set();
            const out = [];
            for (const a of links) {
                const text = (a.textContent || '').trim();
                const href = a.href || '';
                if (!text || text.length < 2 || text.length > 80) continue;
                if (/^(weapons|armor|accessories|pets|wings|arcana|all)$/i.test(text)) continue;
                if (seen.has(text)) continue;
                seen.add(text);
                const img = a.querySelector('img')?.src || a.querySelector('[style*="background-image"]')?.style?.backgroundImage?.match(/url\(["']?([^"')]+)/)?.[1] || '';
                out.push({ name: text, url: href, img: img || null });
                if (out.length >= 10) break;
            }
            return out;
        });
        return { items, searchUrl: url };
    } catch (err) {
        console.warn('[scrapeTalentbuildsDb]', err.message);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

async function scrapeTalentbuildsArmory(query) {
    let browser;
    try {
        browser = await puppeteer.launch(await getPuppeteerLaunchOptions());
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0');
        const url = `https://talentbuilds.com/aion2/armory?search=${encodeURIComponent(query)}&region=korea`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
        await new Promise(r => setTimeout(r, 4000));
        const chars = await page.evaluate(() => {
            const cards = document.querySelectorAll('a[href*="/armory/"], [data-character], .character-card, table tbody tr, [class*="character"]');
            const seen = new Set();
            const out = [];
            for (const el of Array.from(cards)) {
                const a = el.closest('a') || el.querySelector('a') || (el.tagName === 'A' ? el : null);
                const link = a?.href || (el.tagName === 'A' ? el.href : '');
                if (!link || !link.includes('armory')) continue;
                const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
                if (!text || text.length < 3) continue;
                const key = text.slice(0, 50);
                if (seen.has(key)) continue;
                seen.add(key);
                const img = (a || el).querySelector?.('img')?.src || el.querySelector?.('img')?.src || '';
                out.push({ name: text.slice(0, 60), url: link, img: img || null });
                if (out.length >= 8) break;
            }
            if (out.length === 0) {
                const allLinks = Array.from(document.querySelectorAll('a[href*="armory"]'));
                for (const a of allLinks) {
                    const t = (a.textContent || '').trim();
                    if (t && t.length >= 2 && t.length <= 40 && !seen.has(t)) {
                        seen.add(t);
                        const img = a.querySelector?.('img')?.src || '';
                        out.push({ name: t, url: a.href, img: img || null });
                        if (out.length >= 8) break;
                    }
                }
            }
            return out;
        });
        return { items: chars, searchUrl: url };
    } catch (err) {
        console.warn('[scrapeTalentbuildsArmory]', err.message);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

function buildCollectionLookupEmbed(query, scraped = null, displayQuery = null) {
    const encoded = encodeURIComponent(query);
    const titleQuery = displayQuery != null ? displayQuery : query;
    const baseUrl = `https://talentbuilds.com/aion2/database/armor?search=${encoded}`;
    const shugoUrl = `https://shugo.gg/?q=${encoded}`;
    let desc;
    if (scraped?.items?.length) {
        desc = scraped.items.map((it, i) => `${i + 1}. [${it.name}](${it.url})`).join('\n') +
            `\n\n🔗 [More on Talentbuilds](${scraped.searchUrl}) · [Shugo.GG](${shugoUrl})`;
    } else {
        desc = [
            'Find equipment collection sets by stat keyword:',
            '',
            `🔗 [Talentbuilds Database](${baseUrl})`,
            `🔗 [Shugo.GG](${shugoUrl})`,
            `🔗 [Google (collection)](https://www.google.com/search?q=site%3Aaion2.plaync.com+${encoded}+collection)`,
        ].join('\n');
    }
    const embed = new EmbedBuilder()
        .setTitle(`📦 Collection: ${titleQuery}`)
        .setDescription(desc.slice(0, 4000))
        .setColor(0x0891b2)
        .setTimestamp();
    const thumb = scraped?.items?.[0]?.img || SEARCH_THUMBNAIL_DEFAULT;
    embed.setThumbnail(thumb);
    return embed;
}

function buildBuildLookupEmbed(query, scraped = null, displayQuery = null) {
    const encoded = encodeURIComponent(query);
    const titleQuery = displayQuery != null ? displayQuery : query;
    const armoryUrl = `https://talentbuilds.com/aion2/armory?search=${encoded}&region=korea`;
    const shugoUrl = `https://shugo.gg/?q=${encoded}`;
    const ytUrl = `https://www.youtube.com/results?search_query=aion2+${encoded}+build`;
    let desc;
    if (scraped?.items?.length) {
        desc = scraped.items.map((it, i) => `${i + 1}. [${it.name}](${it.url})`).join('\n') +
            `\n\n🔗 [More Builds](${armoryUrl}) · [Shugo.GG](${shugoUrl}) · [YouTube](${ytUrl})`;
    } else {
        desc = [
            'Find recommended builds and skill tree references:',
            '',
            `🔗 [Talentbuilds Armory](${armoryUrl})`,
            `🔗 [Shugo.GG](${shugoUrl})`,
            `🔗 [YouTube Build Search](${ytUrl})`,
        ].join('\n');
    }
    const embed = new EmbedBuilder()
        .setTitle(`⚔️ Build: ${titleQuery}`)
        .setDescription(desc.slice(0, 4000))
        .setColor(0xdc2626)
        .setTimestamp();
    const thumb = scraped?.items?.[0]?.img || SEARCH_THUMBNAIL_DEFAULT;
    embed.setThumbnail(thumb);
    return embed;
}

async function translateItemNamesToEn(items) {
    if (!items?.length) return items;
    const out = [];
    for (const it of items) {
        const name = hasHangul(it.name) ? (await translateKoToEn(it.name) || it.name) : it.name;
        out.push({ ...it, name });
    }
    return out;
}

async function translateQueryForDisplay(query) {
    return hasHangul(query) ? (await translateKoToEn(query) || query) : query;
}

const INVEN_URL_PATTERN = /https?:\/\/(?:www\.)?inven\.co\.kr\/board\/aion2\/\d+\/\d+|https?:\/\/(?:www\.)?inven\.co\.kr\/webzine\/news\/\?news=\d+/i;

const LINK_EMBED_DESC_MAX = 4096;
const LINE_WRAP_AT = 95; // 긴 줄만 줄바꿈 (내용 잘림 완화)

function wrapLongLines(text, maxLen = LINE_WRAP_AT) {
    return text.split('\n').map(line => {
        if (line.length <= maxLen) return line;
        const parts = [];
        let rest = line;
        while (rest.length > maxLen) {
            const chunk = rest.slice(0, maxLen);
            const lastSpace = chunk.lastIndexOf(' ');
            const cut = lastSpace > maxLen * 0.5 ? lastSpace : maxLen;
            parts.push(rest.slice(0, cut).trim());
            rest = rest.slice(cut).trim();
        }
        if (rest) parts.push(rest);
        return parts.join('\n');
    }).join('\n');
}

function buildLinkEmbeds(data) {
    const raw = data.summary || 'No content';
    const text = wrapLongLines(raw);
    const embeds = [];
    let offset = 0;
    let part = 0;
    while (offset < text.length && embeds.length < 15) {
        let chunk = text.slice(offset, offset + LINK_EMBED_DESC_MAX);
        if (chunk.length < text.length - offset) {
            const lastNewline = chunk.lastIndexOf('\n');
            chunk = lastNewline > LINK_EMBED_DESC_MAX * 0.3 ? chunk.slice(0, lastNewline + 1) : chunk;
        }
        if (!chunk) break;
        offset += chunk.length;
        const embed = new EmbedBuilder()
            .setTitle(embeds.length === 0 ? (data.titleEn || data.title) : `${data.titleEn || data.title} (${part + 1})`)
            .setURL(data.url)
            .setDescription(chunk)
            .setColor(0xcc0000)
            .setFooter({ text: embeds.length === 0 ? 'Link' : `Link · Part ${part + 1}` })
            .setTimestamp();
        if (embeds.length === 0 && data.images?.[0] && isValidEmbedUrl(data.images[0])) embed.setThumbnail(data.images[0]);
        embeds.push(embed);
        part++;
    }
    return embeds;
}

async function sendLinkEmbedsInBatches(channel, embeds) {
    if (!embeds?.length) return;
    if (embeds.length === 1) {
        await channel.send({ embeds });
        return;
    }
    for (const e of embeds) {
        await channel.send({ embeds: [e] });
    }
}

function formatLinkSummaryForReadability(text) {
    if (!text || typeof text !== 'string') return text;
    let raw = text
        .replace(/\r/g, '')
        .replace(/\n\s*[-]\s+/g, '\n• ')
        .replace(/\n\s*[-]\s*/g, '\n• ')
        .replace(/([.])\s*[-]\s+/g, '$1\n• ')
        .replace(/([。])\s*[-]\s+/g, '$1\n• ')
        .replace(/(\d{1,2})[.)]\s+/g, '\n\n**$1.** ');
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const mainMatch = line.match(/^\*\*(\d{1,2})\.\*\*\s*(.+)$/) || line.match(/^(\d{1,2})[.)]\s*(.+)$/);
        if (mainMatch) {
            const num = mainMatch[1];
            const rest = mainMatch[2].trim();
            if (out.length) out.push('');
            out.push(`**${num}.** ${rest}`);
            i++;
            while (i < lines.length) {
                const sub = lines[i];
                const subMatch = sub.match(/^[•▪▸※·]\s*(.+)$/) || sub.match(/^[-]\s*(.+)$/);
                if (subMatch && !/^\d{1,2}[.)]\s/.test(sub)) {
                    const content = subMatch[1].trim();
                    if (content.length > 1) out.push(`• ${content}`);
                    i++;
                } else if (/^\d{1,2}[.)]\s|\*\*\d{1,2}\.\*\*/.test(sub)) break;
                else if (sub.length > 20 && !/^[-•▪▸※·]/.test(sub)) break;
                else { i++; }
            }
            continue;
        }
        if (line.match(/^[•▪▸※·-]\s*(.+)$/) && out.length) {
            out.push(`• ${line.replace(/^[•▪▸※·-]\s*/, '').trim()}`);
        }
        i++;
    }
    if (!out.length) return text.replace(/(\d{1,2})[.)]\s+/g, '\n\n**$1.** ').replace(/\n{3,}/g, '\n\n').trim();
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const TACTICS_CATEGORY_SEARCH_KEYS = {
    dungeon: ['dungeon', '던전'],
    pet: ['pet', '펫'],
    class: ['class', '클래스'],
    class_gladiator: ['gladiator', '검성'],
    class_templar: ['templar', '탬플러'],
    class_assassin: ['assassin', '어쌔신'],
    class_ranger: ['ranger', '레인저'],
    class_chanter: ['chanter', '찬터'],
    class_cleric: ['cleric', '클레릭'],
    class_sorcerer: ['sorcerer', '소서러'],
    class_spiritmaster_pve: ['spiritmaster-pve', 'spiritmaster_pve', 'spirit-pve'],
    class_spiritmaster_pvp: ['spiritmaster-pvp', 'spiritmaster_pvp', 'spirit-pvp'],
    fast_leveling: ['leveling', '레벨', 'fast'],
    kinah_farming: ['kinah', '키나'],
    cp_boost_guide: ['cp', 'boost'],
    pantheon_guide: ['pantheon', 'abyss', '팬테온', '심연'],
    dungeon_tactics: ['dungeon_tactics', 'tactics'],
    daily_checklist: ['daily', 'checklist', '일일'],
    pro_tips: ['tips', 'pro', '팁'],
    wardrobe_guide: ['wardrobe-guide', 'wardrobe', '옷장']
};

async function resolveTacticsCategoryToChannel(guildId, tacticsCat, parentCategoryId = null) {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return null;
    const channels = guild.channels.cache.size ? guild.channels.cache : await guild.channels.fetch().catch(() => new Map());
    const keys = TACTICS_CATEGORY_SEARCH_KEYS[tacticsCat] || [tacticsCat];
    const candidates = [...channels.values()].filter(c => {
        if (c.type !== ChannelType.GuildText && c.type !== ChannelType.GuildAnnouncement) return false;
        if (parentCategoryId && c.parentId !== parentCategoryId) return false;
        const nameLower = (c.name || '').toLowerCase();
        return keys.some(k => nameLower.includes(k.toLowerCase()));
    });
    const first = candidates.sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))[0];
    return first?.isTextBased?.() ? first : null;
}

async function getLinkTargetChannel(guildId) {
    if (!guildId) return null;
    const state = loadPanelState();
    const chId = state.linkTargetChannelIdByGuild?.[guildId];
    if (chId) {
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return null;
        const ch = guild.channels.cache.get(chId) || await guild.channels.fetch(chId).catch(() => null);
        return ch?.isTextBased?.() ? ch : null;
    }
    const tacticsCat = state.linkTargetTacticsCategoryByGuild?.[guildId];
    const parentId = state.linkTargetParentCategoryIdByGuild?.[guildId];
    if (tacticsCat) return resolveTacticsCategoryToChannel(guildId, tacticsCat, parentId);
    return null;
}

function extractTableRowsFromInvenContent($, content) {
    const rows = [];
    const tables = content.find('table').toArray();
    const headerPattern = /^(no|번호|외형|외형\s*추출|획득처)$/i;
    for (const table of tables) {
        const trs = $(table).find('tr').toArray();
        for (const tr of trs) {
            const tds = $(tr).find('td').toArray();
            if (tds.length < 2) continue;
            const cells = tds.map(td => $(td).text().replace(/\s+/g, ' ').trim()).filter(Boolean);
            const firstAsNum = cells[0]?.replace(/\D/g, '');
            const hasNumCol = firstAsNum && /^\d{1,3}$/.test(firstAsNum);
            const name = hasNumCol ? (cells[1] || cells[2] || '') : (cells[0] || cells[1] || '');
            const source = cells[cells.length - 1] || cells[2] || '';
            if (headerPattern.test(cells[0]) || headerPattern.test(name)) continue;
            if (hasNumCol) {
                if (name) rows.push({ name, source });
            } else if (cells.length >= 3 && name && /[\uac00-\ud7a3a-zA-Z]/.test(name)) {
                rows.push({ name, source });
            }
        }
    }
    if (rows.length < 2) return null;
    const maxRows = 200;
    return rows.slice(0, maxRows)
        .map((r, i) => `**${i + 1}.** ${r.name} — ${r.source}`)
        .join('\n');
}

async function fetchInvenArticle(url) {
    const res = await axios.get(url, {
        timeout: 45000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
        maxRedirects: 3,
        responseType: 'text',
        validateStatus: s => s >= 200 && s < 400
    });
    const html = res.data;
    const $ = cheerio.load(html, { decodeEntities: false });
    const titleEl = $('.articleTitle').first();
    const title = (titleEl.text() || $('title').text() || 'Inven Article').replace(/\s+/g, ' ').trim();
    const content = $('#powerbbsContent').first();
    let summary = extractTableRowsFromInvenContent($, content);
    if (!summary) {
        const rawText = (content.text() || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]+/g, ' ')
            .trim();
        const SUMMARY_MAX = 7000;
        summary = rawText.slice(0, SUMMARY_MAX).trim();
        const last = summary.lastIndexOf('\n');
        if (last > SUMMARY_MAX * 0.5) summary = summary.slice(0, last).trim();
        else if (summary.length >= SUMMARY_MAX) summary = summary.slice(0, 6500).trim() + '\n\n…';
    }
    const imgs = [
        ...new Set(
            content.find('img')
                .map((_, el) => $(el).attr('src') || $(el).attr('data-src') || '')
                .get()
                .map(s => (s.startsWith('//') ? `https:${s}` : s))
                .filter(s => s.startsWith('http') && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(s))
        )
    ].slice(0, 5);
    const titleEn = hasHangul(title) ? (await translateKoToEn(title) || title) : title;
    let summaryEn = summary
        ? (await withTimeout(translateKoToEnLong(summary), 60000, 'summary translation').catch(() => summary) || summary)
        : '';
    const fromTable = summary && summary.includes('**') && (summary.match(/\n/g) || []).length >= 3;
    if (!fromTable) summaryEn = formatLinkSummaryForReadability(summaryEn || summary);
    return { url, title, titleEn, summary: summaryEn, images: imgs };
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

    const msg = [
        '🌐 <b>AION Bot 번역 완료</b>',
        `Category: ${String(category).toUpperCase()}`,
        `Title: ${escapeHtml((translatedTitle || sourceTitle || '').slice(0, 80))}${(translatedTitle || sourceTitle || '').length > 80 ? '...' : ''}`,
        `Link: ${message.url}`,
    ].join('\n');
    sendTelegramNotification(msg).catch(() => {});

    guildCfg.translatedMessageIds.push(message.id);
    guildCfg.translatedMessageIds = guildCfg.translatedMessageIds.slice(-1000);
    saveAonTranslateState();
}

client.on('messageCreate', async (message) => {
    await handleAonBotNewsTranslation(message).catch(() => {});
    if (message.author?.bot) return;
    const content = message.content?.trim() || '';

    // ── Auto OCR payment proof (image -> Payment Log)
    if (!content.toLowerCase().startsWith('!confirm')) {
        const ocrHandled = await handleAutoPaymentProofOcr(message).catch(err => {
            console.error('[payment-ocr]', err);
            return false;
        });
        if (ocrHandled) return;
    }

    // ── !yt [youtube-url]
    const ytMatch = content.match(/^!(?:yt|youtube)\s+(.+)$/i);
    if (ytMatch) {
        const videoInput = ytMatch[1].trim();
        let progressMsg = null;
        try {
            progressMsg = await message.reply({
                content: '🎬 Analyzing YouTube link... (title translation + EN subtitle check)',
                allowedMentions: { repliedUser: false }
            });
        } catch (_) {}
        try {
            const ready = await fetchYouTubeVideoReadyInfo(videoInput);
            if (progressMsg) {
                await progressMsg.edit({
                    content: buildYouTubeReadyCardMessage(ready),
                    embeds: [],
                    allowedMentions: { parse: [] }
                }).catch(() => {});
            } else {
                await message.channel.send({
                    content: buildYouTubeReadyCardMessage(ready),
                    allowedMentions: { parse: [] },
                }).catch(() => {});
            }
        } catch (err) {
            const errorText = `❌ YouTube processing failed: ${err.message || 'Unknown error'}\nUsage: \`!yt <youtube-url>\``;
            if (progressMsg) await progressMsg.edit({ content: errorText, embeds: [] }).catch(() => {});
            else await message.reply({ content: errorText, allowedMentions: { repliedUser: false } }).catch(() => {});
        }
        return;
    }

    // ── !link <url>
    const linkMatch = content.match(/^!(?:link|ln)\s+(.+)$/i);
    if (linkMatch) {
        const urlInput = linkMatch[1].trim().replace(/^<(.+)>$/g, '$1');
        if (!INVEN_URL_PATTERN.test(urlInput)) {
            await message.reply({
                content: '❌ Invalid URL. Use AION2 board or Webzine links.\nExample: `!link https://inven.co.kr/board/aion2/695/12345`',
                allowedMentions: { repliedUser: false }
            }).catch(() => {});
            return;
        }
        let progressMsg = null;
        try {
            progressMsg = await message.reply({
                content: '📄 Fetching and translating...',
                allowedMentions: { repliedUser: false }
            });
        } catch (_) {}
        try {
            const data = await fetchInvenArticle(urlInput);
            const linkEmbeds = buildLinkEmbeds(data);
            const targetCh = await getLinkTargetChannel(message.guildId) || message.channel;
            if (targetCh.id !== message.channel.id) {
                await sendLinkEmbedsInBatches(targetCh, linkEmbeds);
                if (progressMsg) await progressMsg.edit({ content: `✅ Posted to <#${targetCh.id}>`, embeds: [], allowedMentions: { parse: [] } }).catch(() => {});
            } else {
                if (progressMsg) await progressMsg.edit({ content: '✅ Posted summarized & translated article.', embeds: [], allowedMentions: { parse: [] } }).catch(() => {});
                await sendLinkEmbedsInBatches(message.channel, linkEmbeds);
            }
        } catch (err) {
            const errorText = `❌ Link fetch failed: ${err.message || 'Unknown error'}\nUsage: \`!link <url>\``;
            if (progressMsg) await progressMsg.edit({ content: errorText, embeds: [] }).catch(() => {});
            else await message.reply({ content: errorText, allowedMentions: { repliedUser: false } }).catch(() => {});
        }
        return;
    }

    // ── plain YouTube URL (auto EN subtitle card + translated title)
    const youtubeUrl = extractFirstYouTubeUrlFromText(content);
    if (youtubeUrl && !content.startsWith('!')) {
        try {
            const ready = await fetchYouTubeVideoReadyInfo(youtubeUrl);
            await message.channel.send({
                content: buildYouTubeReadyCardMessage(ready),
                allowedMentions: { parse: [] },
            }).catch(() => {});
        } catch (_) {}
    }

    // ── !confirm 금액 / [통화] / 내용 (회원 입금 확인, 스크린샷 선택)
    if (content.startsWith('!confirm ')) {
        const raw = content.slice(9).trim();
        const parts = raw.split('/').map(s => s.trim());
        const amount = parts[0];
        let currency = 'KRW';
        let reason = 'N/A';
        if (parts.length >= 3) {
            currency = (parts[1] || 'KRW').toUpperCase();
            reason = parts[2] || 'N/A';
        } else if (parts.length === 2) {
            reason = parts[1] || 'N/A';
        }
        const attachment = message.attachments?.first();

        if (!amount) {
            return message.reply('⚠️ **Usage:** `!confirm [Amount] / [Reason]` or `!confirm [Amount] / [Currency] / [Reason]`\nExample: `!confirm 500,000 / Weekly Settlement` or `!confirm 100 / USD / Initial payment`');
        }

        try {
            const row = [new Date().toLocaleString('ko-KR'), 'MEMBER_CONFIRM', message.author.tag, amount, currency, reason, 'Pending Verification'];
            const res = await appendToSheet("'Payment Log'!A:G", row);
            if (!res.ok) throw new Error(res.error);

            const proofEmbed = new EmbedBuilder()
                .setTitle('💎 MEMBER PAYMENT VERIFIED')
                .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                .setColor(0x7289DA)
                .addFields(
                    { name: '💵 Amount Received', value: `\`${amount} ${currency}\``, inline: true },
                    { name: '📝 Description', value: reason || 'No details provided', inline: true }
                )
                .setFooter({ text: 'TETRA Agency Public Ledger' })
                .setTimestamp();
            if (attachment) proofEmbed.setImage(attachment.url);

            await message.delete().catch(() => {});
            await message.channel.send({ content: `✅ **Payment confirmation submitted — ${message.author}**`, embeds: [proofEmbed] });
        } catch (err) {
            console.error('[!confirm]', err);
            message.reply('❌ Failed to save. Check Google Sheet (Payment Log) setup.');
        }
        return;
    }

    // ── !char [name] — DM result (only you see it, like /character)
    const prefix = '!char ';
    if (!content.toLowerCase().startsWith(prefix)) return;

    const input = content.slice(prefix.length).trim();
    if (!input) {
        await message.reply({
            content: '❌ Usage: `!char [character name]`\nExample: `!char Drau`',
            allowedMentions: { repliedUser: false }
        }).catch(() => {});
        return;
    }

    const urlMatch = input.match(PLAYNC_CHAR_URL);
    const charUrl = urlMatch ? (input.startsWith('http') ? input : 'https://' + urlMatch[0]) : null;

    let ackMsg;
    try {
        ackMsg = await message.reply({
            content: charUrl ? `🔍 Loading character info... (DM you shortly)` : `🔍 Searching for ${input}... (DM you shortly)`,
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
                await message.author.send({ content: '❌ No results found.', embeds: [embed] }).catch(() => {});
                if (ackMsg) await ackMsg.delete().catch(() => {});
                return;
            }
            charInfo.cp = null;
        }

        const toEnRace = (r) => (r === '천족' ? 'Elyos' : r === '마족' ? 'Asmodian' : r) || 'N/A';
        const buildEmbed = (info) => {
            const safeName = stripHtmlTags(info.name || input) || input;
            const enc = encodeURIComponent(safeName);
            const linkLine = `[Full Profile](${info.link}) · [Talentbuilds](https://talentbuilds.com/aion2/armory?search=${enc}&region=korea) · [Shugo.GG](https://shugo.gg/?q=${enc})`;
            return new EmbedBuilder()
                .setTitle(`🛡️ TETRA INTEL: ${safeName}`)
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

        await message.author.send({ embeds: [buildEmbed(charInfo)] }).catch(async (e) => {
            if (/cannot send|dm closed|disabled/i.test(String(e.message || ''))) {
                await message.channel.send({ content: `${message.author} — DM disabled. Enable DMs from server members to receive search results, or use \`/character\` (ephemeral).`, allowedMentions: { parse: [] } }).catch(() => {});
            }
        });
        if (ackMsg) await ackMsg.delete().catch(() => {});

        if (!charInfo.cp && charInfo.link) {
            scrapePlayncCharacter(charInfo.link).then(async scraped => {
                if (scraped?.cp) {
                    charInfo.cp = scraped.cp;
                    await message.author.send({ embeds: [buildEmbed(charInfo)] }).catch(() => {});
                }
            }).catch(() => {});
        }
    } catch (err) {
        console.error('[!char] Error:', err.message);
        const embed = buildLinkFallbackEmbed(input);
        try {
            await message.author.send({ content: '❌ **Failed to load.** ' + (charUrl ? 'Could not reach page. ' : '') + 'Check links below.', embeds: [embed] }).catch(() => {});
            if (ackMsg) await ackMsg.delete().catch(() => {});
        } catch (_) {
            await message.channel.send({ embeds: [embed] }).catch(() => {});
        }
    }
});

if (!CONFIG.TOKEN) {
    console.error('❌ DISCORD_TOKEN not set. Add DISCORD_TOKEN=<bot-token> to .env');
    process.exit(1);
}
client.login(CONFIG.TOKEN);
