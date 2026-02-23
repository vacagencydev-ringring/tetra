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
    GatewayIntentBits,
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
    PANEL_IMAGES: {
        salary: path.join(__dirname, 'panels', 'salary.png')
    }
};

function loadPanelState() { try { return JSON.parse(fs.readFileSync(CONFIG.PANEL_STATE_PATH, 'utf8')); } catch { return {}; } }
function savePanelState(s) { fs.writeFileSync(CONFIG.PANEL_STATE_PATH, JSON.stringify(s, null, 2)); }

const panelUpdateLocks = new Set();

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
                new TextInputBuilder().setCustomId('profit').setLabel("Today's Kinah Profit").setPlaceholder('1,500,000').setStyle(TextInputStyle.Short).setRequired(true)
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
                        '• **Kinah** (💰) — Login, Logout, Profit\n' +
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

client.on('messageCreate', async (message) => {
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
