try {
  require("dotenv").config();
} catch (_) {}

const fs = require("fs");
const path = require("path");
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const DEFAULT_NOTICE_SOURCES = [
  { category: "notice", url: "https://aion2.plaync.com/ko-kr/news/notice" },
  { category: "update", url: "https://aion2.plaync.com/ko-kr/news/update" },
  { category: "event", url: "https://aion2.plaync.com/ko-kr/news/event" },
  {
    category: "maintenance",
    url: "https://aion2.plaync.com/ko-kr/news/maintenance",
  },
];

const BOSS_PRESETS = {
  elyos: [
    { name: "Tahabata", respawnMinutes: 360 },
    { name: "Bakarma", respawnMinutes: 300 },
    { name: "Anuhart", respawnMinutes: 240 },
    { name: "Kromede", respawnMinutes: 180 },
    { name: "Asteria Guardian", respawnMinutes: 180 },
  ],
  asmodian: [
    { name: "Padmarashka", respawnMinutes: 420 },
    { name: "Debilkarim", respawnMinutes: 300 },
    { name: "Lannok", respawnMinutes: 240 },
    { name: "Flame Lord Calindi", respawnMinutes: 180 },
    { name: "Miren Guardian", respawnMinutes: 180 },
  ],
};

const PLAYNC_CHAR_URL =
  /aion2\.plaync\.com\/ko-kr\/characters\/\d+\/[\w%-]+/i;
const SEARCH_API =
  "https://aion2.plaync.com/ko-kr/api/search/aion2/search/v2/character";
const PROFILE_IMG_BASE = "https://profileimg.plaync.com";

function toInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNoticeSources(raw) {
  if (!raw) return DEFAULT_NOTICE_SOURCES;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_NOTICE_SOURCES;
    const cleaned = parsed
      .map((entry) => ({
        category: String(entry.category || "").toLowerCase().trim(),
        url: String(entry.url || "").trim(),
      }))
      .filter((entry) => entry.category && entry.url)
      .filter((entry) => {
        try {
          const u = new URL(entry.url);
          return u.protocol === "https:" || u.protocol === "http:";
        } catch (_) {
          return false;
        }
      });
    return cleaned.length ? cleaned : DEFAULT_NOTICE_SOURCES;
  } catch (_) {
    return DEFAULT_NOTICE_SOURCES;
  }
}

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  port: toInt(process.env.PORT, 3000),
  statePath: path.join(__dirname, "bot_state.json"),
  bossWarningMinutes: Math.max(1, toInt(process.env.BOSS_WARNING_MINUTES, 10)),
  bossTickerMs: Math.max(10_000, toInt(process.env.BOSS_TICKER_MS, 60_000)),
  noticeTickerMs: Math.max(
    60_000,
    toInt(process.env.NOTICE_TICKER_MS, 600_000)
  ),
  noticeSources: parseNoticeSources(process.env.NOTICE_SOURCES_JSON),
};

function createDefaultState() {
  return {
    version: 1,
    guilds: {},
    notices: {
      seenBySource: {},
    },
  };
}

function createDefaultGuildState() {
  return {
    bosses: {},
    bossChannelId: null,
    bossSettings: {
      eventMultiplier: 1,
      dmSubscribers: [],
    },
    notices: {
      channelId: null,
      categories: ["all"],
    },
    verification: {
      tempRoleId: null,
      verifiedRoleId: null,
      categoryId: null,
      logChannelId: null,
      tickets: {},
    },
    profiles: {},
    parties: {},
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(CONFIG.statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return createDefaultState();
    parsed.guilds = parsed.guilds || {};
    parsed.notices = parsed.notices || { seenBySource: {} };
    parsed.notices.seenBySource = parsed.notices.seenBySource || {};
    return parsed;
  } catch (_) {
    return createDefaultState();
  }
}

const state = loadState();

function saveState() {
  fs.writeFileSync(CONFIG.statePath, JSON.stringify(state, null, 2));
}

function ensureGuildState(guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = createDefaultGuildState();
  }
  const g = state.guilds[guildId];
  g.bosses = g.bosses || {};
  g.bossSettings = g.bossSettings || { eventMultiplier: 1, dmSubscribers: [] };
  g.bossSettings.eventMultiplier = Number.isFinite(
    Number(g.bossSettings.eventMultiplier)
  )
    ? Number(g.bossSettings.eventMultiplier)
    : 1;
  g.bossSettings.dmSubscribers = Array.isArray(g.bossSettings.dmSubscribers)
    ? g.bossSettings.dmSubscribers
    : [];
  g.profiles = g.profiles || {};
  g.parties = g.parties || {};
  g.notices = g.notices || { channelId: null, categories: ["all"] };
  g.notices.categories = Array.isArray(g.notices.categories)
    ? g.notices.categories
    : ["all"];
  g.verification = g.verification || {
    tempRoleId: null,
    verifiedRoleId: null,
    categoryId: null,
    logChannelId: null,
    tickets: {},
  };
  g.verification.tickets = g.verification.tickets || {};
  return g;
}

function normalizeBossName(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function statusForBoss(boss, now = Date.now()) {
  if (!boss.nextSpawnAt) return "Not tracked yet";
  const remaining = boss.nextSpawnAt - now;
  if (remaining <= 0) return "Spawned";
  return `${formatDuration(remaining)} left`;
}

function toDiscordTime(epochMs) {
  return `<t:${Math.floor(epochMs / 1000)}:F> (<t:${Math.floor(
    epochMs / 1000
  )}:R>)`;
}

function parseHHmm(input) {
  const raw = String(input || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = Number.parseInt(match[1], 10);
  const mm = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function parseTodayTime(input, preferPast = false) {
  const parsed = parseHHmm(input);
  if (!parsed) return null;
  const d = new Date();
  d.setHours(parsed.hh, parsed.mm, 0, 0);
  if (preferPast && d.getTime() > Date.now() + 5 * 60_000) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

function resolveBoss(guildState, inputName) {
  const key = normalizeBossName(inputName);
  if (!key) return { error: "empty" };
  if (guildState.bosses[key]) return { boss: guildState.bosses[key] };
  const matches = Object.values(guildState.bosses).filter((boss) =>
    normalizeBossName(boss.name).includes(key)
  );
  if (matches.length === 1) return { boss: matches[0] };
  if (matches.length > 1) return { error: "ambiguous", matches };
  return { error: "missing" };
}

function hasManageGuild(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

function listPreset(mode) {
  if (mode === "combined") {
    return [...BOSS_PRESETS.elyos, ...BOSS_PRESETS.asmodian];
  }
  return BOSS_PRESETS[mode] || [];
}

function getBossEventMultiplier(guildState) {
  const value = Number(guildState?.bossSettings?.eventMultiplier ?? 1);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(2, Math.max(0.1, value));
}

function getEffectiveRespawnMinutes(guildState, boss) {
  const multiplier = getBossEventMultiplier(guildState);
  return Math.max(1, Math.round(boss.respawnMinutes * multiplier));
}

function sanitizeChannelName(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 32);
}

function cleanApiText(raw, fallback = "N/A") {
  const entityMap = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
  };
  const cleaned = String(raw ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39);/g, (match) => entityMap[match] || match)
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function createPartyId() {
  return `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

function buildPartyButtons(post) {
  const closed = post.status === "closed";
  const full = post.members.length >= post.maxMembers;
  const join = new ButtonBuilder()
    .setCustomId(`party|join|${post.id}`)
    .setLabel("Join")
    .setStyle(ButtonStyle.Success)
    .setDisabled(closed || full);
  const leave = new ButtonBuilder()
    .setCustomId(`party|leave|${post.id}`)
    .setLabel("Leave")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(closed);
  const close = new ButtonBuilder()
    .setCustomId(`party|close|${post.id}`)
    .setLabel("Close")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(closed);
  return new ActionRowBuilder().addComponents(join, leave, close);
}

function buildPartyEmbed(guildState, post) {
  const memberLines = post.members
    .map((userId, idx) => {
      const profile = guildState.profiles[userId];
      const summary = profile
        ? `${profile.className} Lv.${profile.level}${
            profile.note ? ` (${profile.note})` : ""
          }`
        : "Profile not set";
      return `${idx + 1}. <@${userId}> - ${summary}`;
    })
    .join("\n");

  return new EmbedBuilder()
    .setTitle(`Party Recruit: ${post.title}`)
    .setDescription(
      [
        `Leader: <@${post.leaderId}>`,
        `Activity: ${post.activity || "General run"}`,
        `Slots: ${post.members.length}/${post.maxMembers}`,
        `Status: ${post.status}`,
        "",
        memberLines || "No members",
      ].join("\n")
    )
    .setColor(post.status === "closed" ? 0xa3a3a3 : 0x3b82f6)
    .setFooter({ text: `Post ID: ${post.id}` })
    .setTimestamp(new Date(post.createdAt || Date.now()));
}

async function refreshPartyMessage(interaction, guildState, post) {
  try {
    await interaction.message.edit({
      embeds: [buildPartyEmbed(guildState, post)],
      components: [buildPartyButtons(post)],
    });
    return true;
  } catch (_) {
    return false;
  }
}

function buildBossListEmbed(guildState) {
  const bosses = Object.values(guildState.bosses);
  const now = Date.now();
  const multiplier = getBossEventMultiplier(guildState);
  const sorted = bosses.sort((a, b) => {
    const aSpawn = a.nextSpawnAt || Number.MAX_SAFE_INTEGER;
    const bSpawn = b.nextSpawnAt || Number.MAX_SAFE_INTEGER;
    return aSpawn - bSpawn;
  });
  const lines = sorted.map((boss) => {
    const next = boss.nextSpawnAt ? toDiscordTime(boss.nextSpawnAt) : "N/A";
    const effective = getEffectiveRespawnMinutes(guildState, boss);
    const respawnLabel =
      effective === boss.respawnMinutes
        ? `${boss.respawnMinutes}m`
        : `${boss.respawnMinutes}m -> ${effective}m`;
    return `- **${boss.name}** (${respawnLabel}) -> ${statusForBoss(
      boss,
      now
    )} | Next: ${next}`;
  });
  return new EmbedBuilder()
    .setTitle("Field Boss Board")
    .setDescription(
      lines.join("\n").slice(0, 3600) || "No bosses configured."
    )
    .addFields({
      name: "Event multiplier",
      value: `${multiplier}x`,
      inline: true,
    })
    .setColor(0x2563eb)
    .setTimestamp();
}

function buildSingleBossEmbed(guildState, boss) {
  const next = boss.nextSpawnAt ? toDiscordTime(boss.nextSpawnAt) : "N/A";
  const lastCut = boss.lastCutAt ? toDiscordTime(boss.lastCutAt) : "N/A";
  const effective = getEffectiveRespawnMinutes(guildState, boss);
  const respawnLabel =
    effective === boss.respawnMinutes
      ? `${boss.respawnMinutes} minutes`
      : `${boss.respawnMinutes} minutes (event: ${effective} minutes)`;
  return new EmbedBuilder()
    .setTitle(`Boss: ${boss.name}`)
    .setDescription(
      [
        `Respawn: ${respawnLabel}`,
        `Status: ${statusForBoss(boss)}`,
        `Next Spawn: ${next}`,
        `Last Cut: ${lastCut}`,
      ].join("\n")
    )
    .setColor(0x1d4ed8)
    .setTimestamp();
}

function buildNoticeStatusEmbed(guildState) {
  const notice = guildState.notices || {};
  const categories = Array.isArray(notice.categories) ? notice.categories : [];
  return new EmbedBuilder()
    .setTitle("Notice Relay Status")
    .setDescription(
      [
        `Channel: ${
          notice.channelId ? `<#${notice.channelId}>` : "Not configured"
        }`,
        `Categories: ${
          categories.length ? categories.join(", ") : "Disabled"
        }`,
        `Sources: ${CONFIG.noticeSources.length}`,
      ].join("\n")
    )
    .setColor(0x0ea5e9);
}

function noticeCategoryEnabled(categories, category) {
  if (!Array.isArray(categories) || categories.length === 0) return false;
  if (categories.includes("all")) return true;
  return categories.includes(category);
}

function buildSourceKey(source) {
  return `${source.category}|${source.url}`;
}

async function sendBossAlert(client, guildState, message) {
  const dmTargets = Array.isArray(guildState?.bossSettings?.dmSubscribers)
    ? guildState.bossSettings.dmSubscribers
    : [];
  let dmDelivered = false;

  for (const userId of dmTargets) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) continue;
    await user
      .send(message)
      .then(() => {
        dmDelivered = true;
      })
      .catch(() => {});
  }

  if (dmDelivered) return;
  if (!guildState.bossChannelId) return;

  const channel = await client.channels
    .fetch(guildState.bossChannelId)
    .catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.send(message).catch(() => {});
}

async function fetchNoticeEntries(sourceUrl) {
  const { data } = await axios.get(sourceUrl, {
    timeout: 15_000,
    maxRedirects: 5,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  const $ = cheerio.load(data);
  const entries = [];
  const seen = new Set();
  const source = new URL(sourceUrl);

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const title = $(element).text().replace(/\s+/g, " ").trim();
    if (!href || !title) return;
    if (title.length < 4 || title.length > 140) return;
    if (href.startsWith("#") || href.startsWith("javascript:")) return;
    let absolute;
    try {
      absolute = new URL(href, source).toString();
    } catch (_) {
      return;
    }
    const parsed = new URL(absolute);
    if (parsed.pathname === source.pathname) return;
    if (
      !absolute.includes("/news/") &&
      !absolute.includes("/board/") &&
      !absolute.includes("/notice")
    ) {
      return;
    }
    if (seen.has(absolute)) return;
    seen.add(absolute);
    entries.push({ id: absolute, title, url: absolute });
  });

  return entries.slice(0, 20);
}

let bossTickerActive = false;
async function runBossTicker(client) {
  if (bossTickerActive) return;
  bossTickerActive = true;
  try {
    const now = Date.now();
    let changed = false;

    for (const [guildId, guildState] of Object.entries(state.guilds)) {
      for (const boss of Object.values(guildState.bosses || {})) {
        if (!boss.nextSpawnAt) continue;
        const remaining = boss.nextSpawnAt - now;
        const target = boss.nextSpawnAt;

        if (
          remaining <= CONFIG.bossWarningMinutes * 60_000 &&
          remaining > 0 &&
          boss.warnedForSpawnAt !== target
        ) {
          await sendBossAlert(
            client,
            guildState,
            `Boss warning: **${boss.name}** spawns in about ${formatDuration(
              remaining
            )}.`
          );
          boss.warnedForSpawnAt = target;
          changed = true;
        }

        if (remaining <= 0 && boss.announcedForSpawnAt !== target) {
          await sendBossAlert(
            client,
            guildState,
            `Boss alert: **${boss.name}** should be up now. Record with \`/cut boss_name:${boss.name}\` after kill.`
          );
          boss.announcedForSpawnAt = target;
          changed = true;
        }
      }

      ensureGuildState(guildId);
    }

    if (changed) saveState();
  } finally {
    bossTickerActive = false;
  }
}

let noticeTickerActive = false;
async function runNoticeTicker(client) {
  if (noticeTickerActive || CONFIG.noticeSources.length === 0) return;
  noticeTickerActive = true;
  try {
    let changed = false;

    for (const source of CONFIG.noticeSources) {
      let entries = [];
      try {
        entries = await fetchNoticeEntries(source.url);
      } catch (err) {
        console.error(`[notice] source failed: ${source.url}`, err.message);
        continue;
      }
      if (!entries.length) continue;

      const key = buildSourceKey(source);
      const previous = state.notices.seenBySource[key] || [];
      const seenSet = new Set(previous);

      if (previous.length === 0) {
        state.notices.seenBySource[key] = entries.map((e) => e.id).slice(0, 200);
        changed = true;
        continue;
      }

      const fresh = entries.filter((e) => !seenSet.has(e.id)).reverse();
      if (!fresh.length) continue;

      for (const guildState of Object.values(state.guilds)) {
        const noticeConfig = guildState.notices || {};
        if (!noticeConfig.channelId) continue;
        if (!noticeCategoryEnabled(noticeConfig.categories, source.category)) {
          continue;
        }

        const channel = await client.channels
          .fetch(noticeConfig.channelId)
          .catch(() => null);
        if (!channel || !channel.isTextBased()) continue;

        for (const item of fresh) {
          const embed = new EmbedBuilder()
            .setTitle(`[${source.category.toUpperCase()}] ${item.title}`)
            .setDescription(`[Open notice](${item.url})`)
            .setColor(0x0ea5e9)
            .setTimestamp();
          await channel.send({ embeds: [embed] }).catch(() => {});
        }
      }

      state.notices.seenBySource[key] = [
        ...new Set([...fresh.map((f) => f.id), ...previous]),
      ].slice(0, 200);
      changed = true;
    }

    if (changed) saveState();
  } finally {
    noticeTickerActive = false;
  }
}

let pcDataCache = null;
let serverDataCache = null;

async function getPcData() {
  if (pcDataCache) return pcDataCache;
  const { data } = await axios.get("https://aion2.plaync.com/api/gameinfo/pcdata?lang=en", {
    timeout: 8000,
  });
  pcDataCache = Object.fromEntries(
    (data.pcDataList || []).map((pc) => [pc.id, pc.classText || pc.className])
  );
  return pcDataCache;
}

async function getServerData() {
  if (serverDataCache) return serverDataCache;
  const { data } = await axios.get(
    "https://aion2.plaync.com/api/gameinfo/servers?lang=ko",
    {
      timeout: 8000,
    }
  );
  serverDataCache = Object.fromEntries(
    (data.serverList || []).map((s) => [s.serverId, s.serverName])
  );
  return serverDataCache;
}

async function searchCharacterByName(name, filters = {}) {
  const { data } = await axios.get(SEARCH_API, {
    params: { keyword: name.trim() },
    timeout: 10_000,
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
  });
  const list = data?.list || [];
  if (!list.length) return null;

  const [pcMap, serverMap] = await Promise.all([getPcData(), getServerData()]);
  const normalizedRace = filters?.race
    ? String(filters.race).toLowerCase()
    : null;
  const normalizedClassKeyword = filters?.classKeyword
    ? String(filters.classKeyword).toLowerCase().trim()
    : null;

  const mapped = list.map((entry) => ({
    name: cleanApiText(entry.name, "Unknown"),
    level: String(entry.level),
    server: cleanApiText(serverMap[entry.serverId] || entry.serverName || "N/A"),
    race: entry.race === 1 ? "Elyos" : entry.race === 2 ? "Asmodian" : "N/A",
    className: cleanApiText(pcMap[entry.pcId] || "N/A"),
    imageUrl: entry.profileImageUrl
      ? PROFILE_IMG_BASE + entry.profileImageUrl
      : null,
    url: `https://aion2.plaync.com/ko-kr/characters/${entry.serverId}/${entry.characterId}`,
    combatPower: null,
  }));

  const filtered = mapped.filter((entry) => {
    const raceOk =
      !normalizedRace || entry.race.toLowerCase() === normalizedRace;
    const classOk =
      !normalizedClassKeyword ||
      entry.className.toLowerCase().includes(normalizedClassKeyword);
    return raceOk && classOk;
  });

  if (!filtered.length) return null;
  return {
    ...filtered[0],
    resultCount: filtered.length,
    totalResultCount: mapped.length,
  };
}

async function scrapeCharacterByUrl(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const raw = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      let name = "Unknown";
      let level = "N/A";
      let server = "N/A";
      let race = "N/A";
      let className = "N/A";

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!level && /^\d{1,2}$/.test(line)) level = line;
        if (line === "천족") race = "Elyos";
        if (line === "마족") race = "Asmodian";
        if (/^\[.+\]$/.test(line)) className = line.replace(/^\[|\]$/g, "");
      }

      const levelMatch = text.match(/\b(\d{1,2})\b/);
      if (levelMatch) level = levelMatch[1];
      const cpMatch = text.match(/전투력[^\d]*(\d{3,7})/);
      const imageUrl =
        document.querySelector('img[src*="plaync"], img[src*="aion"]')?.src ||
        null;

      const titleText = document.title || "";
      if (titleText.includes("|")) {
        const possibleName = titleText.split("|")[0].trim();
        if (possibleName) name = possibleName;
      }

      return {
        name,
        level,
        server,
        race,
        className,
        imageUrl,
        combatPower: cpMatch ? cpMatch[1] : null,
        url: window.location.href,
      };
    });

    return {
      ...raw,
      name: cleanApiText(raw.name, "Unknown"),
      server: cleanApiText(raw.server, "N/A"),
      className: cleanApiText(raw.className, "N/A"),
      resultCount: 1,
    };
  } finally {
    if (browser) await browser.close();
  }
}

function buildCharacterFallbackEmbed(query, isUrl = false) {
  const encoded = encodeURIComponent(query);
  const talentbuilds = `https://talentbuilds.com/aion2/armory?search=${encoded}&region=korea`;
  const shugo = `https://shugo.gg/?q=${encoded}`;
  const official = "https://aion2.plaync.com/ko-kr/characters/index";
  const helpLine = isUrl
    ? "Could not scrape this profile URL right now."
    : "No direct match found in search API.";

  return new EmbedBuilder()
    .setTitle("Character Lookup")
    .setDescription(
      [
        helpLine,
        "",
        `[Talentbuilds Armory](${talentbuilds})`,
        `[Shugo.GG](${shugo})`,
        `[Official Character Page](${official})`,
      ].join("\n")
    )
    .setColor(0x9333ea);
}

function buildCharacterEmbed(info, query) {
  const encoded = encodeURIComponent(info.name || query);
  const profileLinks = [
    `[Full Profile](${info.url})`,
    `[Talentbuilds](https://talentbuilds.com/aion2/armory?search=${encoded}&region=korea)`,
    `[Shugo.GG](https://shugo.gg/?q=${encoded})`,
  ].join(" | ");

  const fields = [
    { name: "Class", value: info.className || "N/A", inline: true },
    { name: "Level", value: `Lv.${info.level || "N/A"}`, inline: true },
    { name: "Server", value: info.server || "N/A", inline: true },
    { name: "Race", value: info.race || "N/A", inline: true },
  ];
  if (info.combatPower) {
    fields.push({
      name: "Combat Power",
      value: String(info.combatPower),
      inline: true,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Character: ${info.name || query}`)
    .setDescription(profileLinks)
    .addFields(fields)
    .setColor(0x7c3aed)
    .setTimestamp()
    .setFooter({
      text:
        info.resultCount && info.resultCount > 1
          ? `Showing first filtered result (${info.resultCount} filtered / ${
              info.totalResultCount || info.resultCount
            } total)`
          : "Live lookup",
    });

  if (info.imageUrl) embed.setThumbnail(info.imageUrl);
  return embed;
}

function buildItemLookupEmbed(query) {
  const encoded = encodeURIComponent(query);
  return new EmbedBuilder()
    .setTitle(`Item Lookup: ${query}`)
    .setDescription(
      [
        "Item API endpoint is not publicly stable yet. Use the links below:",
        "",
        `[Talentbuilds Search](https://talentbuilds.com/aion2/armory?search=${encoded}&region=korea)`,
        `[Shugo.GG Search](https://shugo.gg/?q=${encoded})`,
        `[Google site search](https://www.google.com/search?q=site%3Aaion2.plaync.com+${encoded})`,
      ].join("\n")
    )
    .setColor(0x16a34a);
}

function buildCollectionLookupEmbed(query) {
  const encoded = encodeURIComponent(query);
  return new EmbedBuilder()
    .setTitle(`Collection Lookup: ${query}`)
    .setDescription(
      [
        "Find collection sets by desired stat keyword:",
        "",
        `[Talentbuilds Collection Search](https://talentbuilds.com/aion2/armory?search=${encoded}&region=korea)`,
        `[Shugo.GG Search](https://shugo.gg/?q=${encoded})`,
        `[Google site search](https://www.google.com/search?q=site%3Aaion2.plaync.com+${encoded}+collection)`,
      ].join("\n")
    )
    .setColor(0x0891b2);
}

function buildBuildLookupEmbed(query) {
  const encoded = encodeURIComponent(query);
  return new EmbedBuilder()
    .setTitle(`Build Lookup: ${query}`)
    .setDescription(
      [
        "Find community build guides and skill tree references:",
        "",
        `[Talentbuilds Build Search](https://talentbuilds.com/aion2/armory?search=${encoded}&region=korea)`,
        `[Shugo.GG Build Search](https://shugo.gg/?q=${encoded})`,
        `[YouTube Search](https://www.youtube.com/results?search_query=aion2+${encoded}+build)`,
      ].join("\n")
    )
    .setColor(0xdc2626);
}

function buildGuideEmbeds() {
  const embed1 = new EmbedBuilder()
    .setTitle("📘 AON2 Bot Guide (Ver 2.1)")
    .setDescription(
      [
        "A must-have support bot for AION2 communities.",
        "Check the commands below and use the features you need.",
      ].join("\n")
    )
    .addFields(
      {
        name: "🔐 Smart Verification System",
        value: [
          "`/myinfo_register character_name:<name>`",
          "- Creates a private verification channel",
          "- Upload screenshot, then staff can Approve/Reject",
          "",
          "`/verification_status`",
          "- Check current verification setup",
        ].join("\n"),
      },
      {
        name: "⚔️ Boss Content Timer",
        value: [
          "`/cut boss_name:<boss> [killed_at:HH:mm]`",
          "- Auto-calculates next spawn time from kill time",
          "- Event respawn multiplier is applied automatically",
          "",
          "`/preset [mode]` `/boss` `/server_open`",
          "- Preset setup, tracking list, and board management",
        ].join("\n"),
      },
      {
        name: "Tip",
        value: [
          "Use `/boss_alert_mode` to choose **public channel** or **DM-only** alerts",
          "Use `/boss_event_multiplier` to apply event-time shortened respawns",
        ].join("\n"),
      }
    )
    .setColor(0x22c55e);

  const embed2 = new EmbedBuilder()
    .setTitle("📚 Command Guide (Search / Admin / Party)")
    .addFields(
      {
        name: "📚 Information Search",
        value: [
          "`/character` - Character lookup (race/class keyword filter)",
          "`/item` - Item lookup",
          "`/collection` - Stat-based collection lookup",
          "`/build` - Recommended build / skill-tree lookup",
        ].join("\n"),
      },
      {
        name: "🛡️ Admin Only (Initial Setup)",
        value: [
          "`/temp_role_set` `/verified_role_set`",
          "`/verify_channel_set` `/verify_log_set`",
          "`/notice_set` `/notice_status`",
          "`/boss_add` `/boss_remove`",
        ].join("\n"),
      },
      {
        name: "⚔️ Party Recruit",
        value: [
          "`/profile_set` - Register your profile",
          "`/party_recruit` - Create button-based recruit panel",
          "(supports Join / Leave / Close buttons)",
        ].join("\n"),
      },
      {
        name: "❓ Help",
        value: "`/help` or `/guide`",
      }
    )
    .setColor(0x3b82f6)
    .setFooter({
      text: "Use /guide public:false to send it only to yourself (ephemeral)",
    });

  return [embed1, embed2];
}

function buildVerificationConfigEmbed(guildState) {
  const conf = guildState.verification || {};
  return new EmbedBuilder()
    .setTitle("Verification Setup")
    .setDescription(
      [
        `Temp role: ${conf.tempRoleId ? `<@&${conf.tempRoleId}>` : "Not set"}`,
        `Verified role: ${
          conf.verifiedRoleId ? `<@&${conf.verifiedRoleId}>` : "Not set"
        }`,
        `Verification category: ${
          conf.categoryId ? `<#${conf.categoryId}>` : "Not set"
        }`,
        `Verification log channel: ${
          conf.logChannelId ? `<#${conf.logChannelId}>` : "Not set"
        }`,
      ].join("\n")
    )
    .setColor(0xf59e0b);
}

function buildVerificationButtons(userId, ticketId, disabled = false) {
  const approve = new ButtonBuilder()
    .setCustomId(`verify|approve|${userId}|${ticketId}`)
    .setLabel("Approve")
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled);
  const reject = new ButtonBuilder()
    .setCustomId(`verify|reject|${userId}|${ticketId}`)
    .setLabel("Reject")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled);
  return new ActionRowBuilder().addComponents(approve, reject);
}

async function sendVerificationLog(
  client,
  guildId,
  guildState,
  ticket,
  status,
  actorId,
  note = ""
) {
  const conf = guildState.verification || {};
  if (!conf.logChannelId) return;
  const logChannel = await client.channels.fetch(conf.logChannelId).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(`Verification ${status.toUpperCase()}`)
    .setDescription(
      [
        `User: <@${ticket.userId}>`,
        `Character: ${ticket.characterName || "N/A"}`,
        `Ticket channel: <#${ticket.channelId}>`,
        `Handled by: <@${actorId}>`,
        note ? `Note: ${note}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setColor(status === "approved" ? 0x22c55e : 0xef4444)
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch(() => {});
}

const commandPayload = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show setup and command guide"),
  new SlashCommandBuilder()
    .setName("guide")
    .setDescription("Post full command guide panel")
    .addBooleanOption((opt) =>
      opt
        .setName("public")
        .setDescription("Post publicly in this channel (default: true)")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("preset")
    .setDescription("Apply preset or display current boss list")
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("Preset mode (optional)")
        .setRequired(false)
        .addChoices(
          { name: "Elyos", value: "elyos" },
          { name: "Asmodian", value: "asmodian" },
          { name: "Combined", value: "combined" }
        )
    ),
  new SlashCommandBuilder()
    .setName("boss")
    .setDescription("Show boss board or a specific boss")
    .addStringOption((opt) =>
      opt
        .setName("boss_name")
        .setDescription("Optional: exact or partial boss name")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("cut")
    .setDescription("Record a boss kill and calculate next spawn")
    .addStringOption((opt) =>
      opt.setName("boss_name").setDescription("Boss name").setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("killed_at")
        .setDescription("Optional kill time (HH:mm)")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("server_open")
    .setDescription("Reset all boss timers from server open time")
    .addStringOption((opt) =>
      opt
        .setName("open_time")
        .setDescription("Server open time HH:mm")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("boss_add")
    .setDescription("Add or update a custom boss")
    .addStringOption((opt) =>
      opt.setName("boss_name").setDescription("Boss name").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("respawn_minutes")
        .setDescription("Respawn minutes")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10_080)
    ),
  new SlashCommandBuilder()
    .setName("boss_remove")
    .setDescription("Remove a boss from tracking")
    .addStringOption((opt) =>
      opt.setName("boss_name").setDescription("Boss name").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("boss_alert_mode")
    .setDescription("Choose boss alerts in channel or DM")
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("Delivery mode")
        .setRequired(true)
        .addChoices(
          { name: "public channel", value: "channel" },
          { name: "DM only", value: "dm" }
        )
    ),
  new SlashCommandBuilder()
    .setName("boss_event_multiplier")
    .setDescription("Set event respawn multiplier (e.g. 0.8)")
    .addNumberOption((opt) =>
      opt
        .setName("multiplier")
        .setDescription("Respawn multiplier: 0.1 ~ 2.0")
        .setRequired(true)
        .setMinValue(0.1)
        .setMaxValue(2)
    ),
  new SlashCommandBuilder()
    .setName("notice_set")
    .setDescription("Configure live notice relay channel and filters")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Target channel for notices")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("category")
        .setDescription("Notice category")
        .setRequired(true)
        .addChoices(
          { name: "all", value: "all" },
          { name: "notice", value: "notice" },
          { name: "update", value: "update" },
          { name: "event", value: "event" },
          { name: "maintenance", value: "maintenance" }
        )
    )
    .addBooleanOption((opt) =>
      opt
        .setName("enabled")
        .setDescription("Enable or disable category")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("notice_status")
    .setDescription("Show current notice relay settings"),
  new SlashCommandBuilder()
    .setName("myinfo_register")
    .setDescription("Create your private verification channel")
    .addStringOption((opt) =>
      opt
        .setName("character_name")
        .setDescription("Main character name")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("temp_role_set")
    .setDescription("Set role assigned before verification")
    .addRoleOption((opt) =>
      opt.setName("role").setDescription("Temporary role").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("verified_role_set")
    .setDescription("Set role assigned after verification")
    .addRoleOption((opt) =>
      opt.setName("role").setDescription("Verified role").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("verify_channel_set")
    .setDescription("Set category where private verify channels are created")
    .addChannelOption((opt) =>
      opt
        .setName("category")
        .setDescription("Target category")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildCategory)
    ),
  new SlashCommandBuilder()
    .setName("verify_log_set")
    .setDescription("Set channel where verify approve/reject logs are sent")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Log channel")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    ),
  new SlashCommandBuilder()
    .setName("verification_status")
    .setDescription("Show current verification setup"),
  new SlashCommandBuilder()
    .setName("profile_set")
    .setDescription("Register your party profile for one-click joining")
    .addStringOption((opt) =>
      opt
        .setName("class_name")
        .setDescription("Your class")
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("level")
        .setDescription("Your level")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(99)
    )
    .addStringOption((opt) =>
      opt
        .setName("note")
        .setDescription("Optional role/note")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("party_recruit")
    .setDescription("Create smart party recruitment panel")
    .addStringOption((opt) =>
      opt.setName("title").setDescription("Party title").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("max_members")
        .setDescription("Max members")
        .setRequired(true)
        .setMinValue(2)
        .setMaxValue(12)
    )
    .addStringOption((opt) =>
      opt
        .setName("activity")
        .setDescription("Optional activity")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("character")
    .setDescription("Lookup a character by name or profile URL")
    .addStringOption((opt) =>
      opt.setName("query").setDescription("Name or URL").setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("race")
        .setDescription("Optional race filter")
        .setRequired(false)
        .addChoices(
          { name: "Elyos", value: "elyos" },
          { name: "Asmodian", value: "asmodian" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("class_keyword")
        .setDescription("Optional class keyword filter")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("item")
    .setDescription("Lookup an item by keyword")
    .addStringOption((opt) =>
      opt.setName("query").setDescription("Item name").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("collection")
    .setDescription("Find equipment collections by stat keyword")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("Stat keyword, e.g. crit")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("build")
    .setDescription("Find recommended builds and skill trees")
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription("Class or build keyword")
        .setRequired(true)
    ),
].map((c) => c.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const rest = new REST({ version: "10" }).setToken(CONFIG.token || "");

async function registerCommands() {
  for (const guild of client.guilds.cache.values()) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), {
      body: commandPayload,
    });
    console.log(`[commands] registered for ${guild.name}`);
  }
}

async function safeEphemeral(interaction, content) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({ content, ephemeral: true }).catch(() => {});
  }
  return interaction.reply({ content, ephemeral: true }).catch(() => {});
}

async function handleSlash(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await safeEphemeral(interaction, "This command can only be used in a guild.");
    return;
  }
  const guildState = ensureGuildState(guildId);

  if (interaction.commandName === "help") {
    const embed = new EmbedBuilder()
      .setTitle("Aon English Bot - Quick Start")
      .setDescription(
        [
          "1) Run `/preset mode:combined` in your boss channel.",
          "2) Use `/cut boss_name:<name>` whenever a boss is killed.",
          "3) Optional: `/boss_alert_mode mode:dm` for private alerts.",
          "4) Configure verification with:",
          "   `/temp_role_set` `/verified_role_set`",
          "   `/verify_channel_set` `/verify_log_set`",
          "5) Users run `/myinfo_register` to open private verify channel.",
          "6) Party: `/profile_set` then `/party_recruit`.",
          "",
          "Main commands:",
          "- /help /guide",
          "- /preset /boss /cut /server_open /boss_add /boss_remove",
          "- /boss_alert_mode /boss_event_multiplier",
          "- /notice_set /notice_status",
          "- /myinfo_register /verification_status",
          "- /profile_set /party_recruit",
          "- /character /item /collection /build",
        ].join("\n")
      )
      .setColor(0x2563eb);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (interaction.commandName === "guide") {
    const isPublic = interaction.options.getBoolean("public") ?? true;
    await interaction.reply({
      embeds: buildGuideEmbeds(),
      ephemeral: !isPublic,
    });
    return;
  }

  if (interaction.commandName === "preset") {
    const mode = interaction.options.getString("mode");
    if (!mode) {
      if (!Object.keys(guildState.bosses).length) {
        await safeEphemeral(
          interaction,
          "No bosses configured yet. Run `/preset mode:combined` first."
        );
        return;
      }
      await interaction.reply({
        embeds: [buildBossListEmbed(guildState)],
        ephemeral: true,
      });
      return;
    }

    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const bosses = listPreset(mode);
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
      };
    }
    guildState.bossChannelId = interaction.channelId;
    saveState();
    await interaction.reply({
      content: `Preset applied (${mode}) with ${bosses.length} bosses. Alert channel set to <#${interaction.channelId}>.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "boss") {
    if (!Object.keys(guildState.bosses).length) {
      await safeEphemeral(
        interaction,
        "No bosses configured. Run `/preset` first."
      );
      return;
    }
    const input = interaction.options.getString("boss_name");
    if (!input) {
      await interaction.reply({
        embeds: [buildBossListEmbed(guildState)],
        ephemeral: true,
      });
      return;
    }
    const resolved = resolveBoss(guildState, input);
    if (resolved.error === "missing") {
      await safeEphemeral(interaction, "Boss not found.");
      return;
    }
    if (resolved.error === "ambiguous") {
      await safeEphemeral(
        interaction,
        `Multiple matches found: ${resolved.matches
          .map((b) => b.name)
          .join(", ")}`
      );
      return;
    }
    await interaction.reply({
      embeds: [buildSingleBossEmbed(guildState, resolved.boss)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "cut") {
    const input = interaction.options.getString("boss_name", true);
    const resolved = resolveBoss(guildState, input);
    if (resolved.error === "missing") {
      await safeEphemeral(interaction, "Boss not found.");
      return;
    }
    if (resolved.error === "ambiguous") {
      await safeEphemeral(
        interaction,
        `Multiple matches found: ${resolved.matches
          .map((b) => b.name)
          .join(", ")}`
      );
      return;
    }

    const killedAtInput = interaction.options.getString("killed_at");
    const killedAt = killedAtInput
      ? parseTodayTime(killedAtInput, true)
      : new Date();
    if (!killedAt) {
      await safeEphemeral(interaction, "Invalid time format. Use HH:mm.");
      return;
    }

    const boss = resolved.boss;
    boss.lastCutAt = killedAt.getTime();
    const effectiveRespawnMinutes = getEffectiveRespawnMinutes(guildState, boss);
    boss.nextSpawnAt = boss.lastCutAt + effectiveRespawnMinutes * 60_000;
    boss.warnedForSpawnAt = null;
    boss.announcedForSpawnAt = null;
    saveState();

    await interaction.reply({
      content: `Cut recorded for **${boss.name}**.\nNext spawn: ${toDiscordTime(
        boss.nextSpawnAt
      )}\nRespawn applied: ${effectiveRespawnMinutes}m`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "server_open") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    if (!Object.keys(guildState.bosses).length) {
      await safeEphemeral(
        interaction,
        "No bosses configured. Run `/preset` first."
      );
      return;
    }
    const openTime = interaction.options.getString("open_time", true);
    const parsed = parseTodayTime(openTime, false);
    if (!parsed) {
      await safeEphemeral(interaction, "Invalid time format. Use HH:mm.");
      return;
    }

    for (const boss of Object.values(guildState.bosses)) {
      boss.lastCutAt = parsed.getTime();
      const effectiveRespawnMinutes = getEffectiveRespawnMinutes(guildState, boss);
      boss.nextSpawnAt = parsed.getTime() + effectiveRespawnMinutes * 60_000;
      boss.warnedForSpawnAt = null;
      boss.announcedForSpawnAt = null;
    }
    guildState.bossChannelId = guildState.bossChannelId || interaction.channelId;
    saveState();

    await interaction.reply({
      content: `All boss timers were reset from ${openTime}.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "boss_add") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const name = interaction.options.getString("boss_name", true).trim();
    const respawnMinutes = interaction.options.getInteger(
      "respawn_minutes",
      true
    );
    const key = normalizeBossName(name);
    const existing = guildState.bosses[key];
    guildState.bosses[key] = {
      name,
      respawnMinutes,
      nextSpawnAt: existing?.nextSpawnAt || null,
      lastCutAt: existing?.lastCutAt || null,
      warnedForSpawnAt: existing?.warnedForSpawnAt || null,
      announcedForSpawnAt: existing?.announcedForSpawnAt || null,
    };
    if (!guildState.bossChannelId) guildState.bossChannelId = interaction.channelId;
    saveState();
    await interaction.reply({
      content: `Boss saved: **${name}** (${respawnMinutes}m).`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "boss_remove") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const name = interaction.options.getString("boss_name", true);
    const resolved = resolveBoss(guildState, name);
    if (resolved.error) {
      await safeEphemeral(interaction, "Boss not found.");
      return;
    }
    delete guildState.bosses[normalizeBossName(resolved.boss.name)];
    saveState();
    await interaction.reply({
      content: `Boss removed: **${resolved.boss.name}**.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "boss_alert_mode") {
    const mode = interaction.options.getString("mode", true);
    const current = new Set(guildState.bossSettings.dmSubscribers || []);
    if (mode === "dm") current.add(interaction.user.id);
    else current.delete(interaction.user.id);
    guildState.bossSettings.dmSubscribers = [...current];
    if (!guildState.bossChannelId) guildState.bossChannelId = interaction.channelId;
    saveState();
    await interaction.reply({
      content:
        mode === "dm"
          ? "Boss alerts will be delivered to your DM. If DM fails, alerts fall back to the alert channel."
          : "Boss alerts for you are switched to public channel mode.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "boss_event_multiplier") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const multiplier = interaction.options.getNumber("multiplier", true);
    guildState.bossSettings.eventMultiplier = multiplier;
    saveState();
    await interaction.reply({
      content: `Event respawn multiplier set to ${multiplier}x. New \`/cut\` and \`/server_open\` calculations will use this value.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "temp_role_set") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const role = interaction.options.getRole("role", true);
    guildState.verification.tempRoleId = role.id;
    saveState();
    await interaction.reply({
      embeds: [buildVerificationConfigEmbed(guildState)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "verified_role_set") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const role = interaction.options.getRole("role", true);
    guildState.verification.verifiedRoleId = role.id;
    saveState();
    await interaction.reply({
      embeds: [buildVerificationConfigEmbed(guildState)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "verify_channel_set") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const category = interaction.options.getChannel("category", true);
    guildState.verification.categoryId = category.id;
    saveState();
    await interaction.reply({
      embeds: [buildVerificationConfigEmbed(guildState)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "verify_log_set") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const channel = interaction.options.getChannel("channel", true);
    guildState.verification.logChannelId = channel.id;
    saveState();
    await interaction.reply({
      embeds: [buildVerificationConfigEmbed(guildState)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "verification_status") {
    await interaction.reply({
      embeds: [buildVerificationConfigEmbed(guildState)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "myinfo_register") {
    const characterName = interaction.options
      .getString("character_name", true)
      .trim();
    const conf = guildState.verification || {};
    if (!conf.categoryId) {
      await safeEphemeral(
        interaction,
        "Verification category is not configured. Ask admins to run `/verify_channel_set`."
      );
      return;
    }

    const existing = Object.values(conf.tickets || {}).find(
      (ticket) =>
        ticket.userId === interaction.user.id && ticket.status === "pending"
    );
    if (existing) {
      await safeEphemeral(
        interaction,
        `You already have an open verification ticket: <#${existing.channelId}>`
      );
      return;
    }

    const managerRoleIds = interaction.guild.roles.cache
      .filter(
        (role) =>
          role.permissions.has(PermissionFlagsBits.Administrator) ||
          role.permissions.has(PermissionFlagsBits.ManageGuild)
      )
      .map((role) => role.id);
    const botMemberId = interaction.guild.members.me?.id || client.user.id;

    const overwrites = [
      {
        id: interaction.guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: botMemberId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
        ],
      },
      ...managerRoleIds.map((roleId) => ({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      })),
    ];

    const channelNameBase =
      sanitizeChannelName(`verify-${characterName}`) || "verify-ticket";
    const channelName = `${channelNameBase}-${Math.random()
      .toString(36)
      .slice(2, 5)}`;
    const verifyChannel = await interaction.guild.channels
      .create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: conf.categoryId,
        permissionOverwrites: overwrites,
      })
      .catch(() => null);

    if (!verifyChannel) {
      await safeEphemeral(
        interaction,
        "Failed to create verification channel. Please check bot permissions."
      );
      return;
    }

    const ticket = {
      ticketId: verifyChannel.id,
      userId: interaction.user.id,
      characterName,
      status: "pending",
      channelId: verifyChannel.id,
      createdAt: Date.now(),
      handledAt: null,
      handledBy: null,
    };
    guildState.verification.tickets[verifyChannel.id] = ticket;

    const member = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    if (member && conf.tempRoleId) {
      await member.roles.add(conf.tempRoleId).catch(() => {});
    }

    const userEmbed = new EmbedBuilder()
      .setTitle("Private Verification Ticket")
      .setDescription(
        [
          `User: <@${interaction.user.id}>`,
          `Character: ${characterName}`,
          "",
          "Please upload your verification screenshot in this channel.",
          "Staff will review and approve/reject with buttons below.",
        ].join("\n")
      )
      .setColor(0xf59e0b)
      .setTimestamp();

    await verifyChannel.send({ embeds: [userEmbed] }).catch(() => {});
    await verifyChannel
      .send({
        content: "Staff review controls:",
        components: [buildVerificationButtons(interaction.user.id, verifyChannel.id)],
      })
      .catch(() => {});

    saveState();
    await interaction.reply({
      content: `Verification channel created: ${verifyChannel}`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "notice_set") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const channel = interaction.options.getChannel("channel", true);
    const category = interaction.options.getString("category", true);
    const enabled = interaction.options.getBoolean("enabled") ?? true;

    const allCategories = ["notice", "update", "event", "maintenance"];
    const current = new Set(guildState.notices.categories || []);
    if (current.has("all")) {
      current.clear();
      for (const item of allCategories) current.add(item);
    }

    if (category === "all") {
      guildState.notices.categories = enabled ? ["all"] : [];
    } else {
      if (enabled) current.add(category);
      else current.delete(category);
      if (allCategories.every((item) => current.has(item))) {
        guildState.notices.categories = ["all"];
      } else {
        guildState.notices.categories = [...current];
      }
    }
    guildState.notices.channelId = channel.id;
    saveState();

    await interaction.reply({
      embeds: [buildNoticeStatusEmbed(guildState)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "notice_status") {
    await interaction.reply({
      embeds: [buildNoticeStatusEmbed(guildState)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "profile_set") {
    const className = interaction.options.getString("class_name", true).trim();
    const level = interaction.options.getInteger("level", true);
    const note = (interaction.options.getString("note") || "").trim();
    guildState.profiles[interaction.user.id] = {
      className,
      level,
      note,
      updatedAt: Date.now(),
    };
    saveState();
    await interaction.reply({
      content: "Profile saved. You can now use one-click party join buttons.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "party_recruit") {
    const leaderProfile = guildState.profiles[interaction.user.id];
    if (!leaderProfile) {
      await safeEphemeral(
        interaction,
        "Run `/profile_set` first before creating a party."
      );
      return;
    }
    const title = interaction.options.getString("title", true).trim();
    const maxMembers = interaction.options.getInteger("max_members", true);
    const activity = (interaction.options.getString("activity") || "").trim();
    const post = {
      id: createPartyId(),
      title,
      activity,
      maxMembers,
      leaderId: interaction.user.id,
      members: [interaction.user.id],
      status: "open",
      createdAt: Date.now(),
      channelId: interaction.channelId,
      messageId: null,
    };

    const sent = await interaction.channel.send({
      embeds: [buildPartyEmbed(guildState, post)],
      components: [buildPartyButtons(post)],
    });
    post.messageId = sent.id;
    guildState.parties[post.id] = post;
    saveState();

    await interaction.reply({
      content: `Party panel posted: https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${sent.id}`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "character") {
    const query = interaction.options.getString("query", true).trim();
    const raceFilter = interaction.options.getString("race");
    const classKeyword = interaction.options.getString("class_keyword");
    await interaction.deferReply({ ephemeral: true });
    const urlMatch = query.match(PLAYNC_CHAR_URL);
    const normalizedUrl = urlMatch
      ? query.startsWith("http")
        ? query
        : `https://${urlMatch[0]}`
      : null;

    try {
      let info;
      if (normalizedUrl) info = await scrapeCharacterByUrl(normalizedUrl);
      else {
        info = await searchCharacterByName(query, {
          race: raceFilter || null,
          classKeyword: classKeyword || null,
        });
      }

      if (!info) {
        await interaction.editReply({
          embeds: [buildCharacterFallbackEmbed(query, Boolean(normalizedUrl))],
        });
        return;
      }

      await interaction.editReply({
        embeds: [buildCharacterEmbed(info, query)],
      });
    } catch (err) {
      console.error("[character] failed", err.message);
      await interaction.editReply({
        embeds: [buildCharacterFallbackEmbed(query, Boolean(normalizedUrl))],
      });
    }
    return;
  }

  if (interaction.commandName === "item") {
    const query = interaction.options.getString("query", true).trim();
    await interaction.reply({
      embeds: [buildItemLookupEmbed(query)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "collection") {
    const query = interaction.options.getString("query", true).trim();
    await interaction.reply({
      embeds: [buildCollectionLookupEmbed(query)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "build") {
    const query = interaction.options.getString("query", true).trim();
    await interaction.reply({
      embeds: [buildBuildLookupEmbed(query)],
      ephemeral: true,
    });
    return;
  }
}

async function handlePartyButton(interaction) {
  const [scope, action, postId] = (interaction.customId || "").split("|");
  if (scope !== "party" || !postId) return;
  if (!interaction.guildId) {
    await safeEphemeral(interaction, "This button only works in a guild.");
    return;
  }
  const guildState = ensureGuildState(interaction.guildId);
  const post = guildState.parties[postId];
  if (!post) {
    await safeEphemeral(
      interaction,
      "This party post is no longer tracked. Create a new one."
    );
    return;
  }

  const userId = interaction.user.id;
  const isLeader = userId === post.leaderId;
  const canManage = hasManageGuild(interaction);

  if (action === "join") {
    if (post.status === "closed") {
      await safeEphemeral(interaction, "This party is closed.");
      return;
    }
    if (!guildState.profiles[userId]) {
      await safeEphemeral(
        interaction,
        "Run `/profile_set` first, then click Join again."
      );
      return;
    }
    if (post.members.includes(userId)) {
      await safeEphemeral(interaction, "You are already in this party.");
      return;
    }
    if (post.members.length >= post.maxMembers) {
      await safeEphemeral(interaction, "Party is full.");
      return;
    }
    post.members.push(userId);
    saveState();
    await refreshPartyMessage(interaction, guildState, post);
    await safeEphemeral(interaction, "You joined the party.");
    return;
  }

  if (action === "leave") {
    if (!post.members.includes(userId)) {
      await safeEphemeral(interaction, "You are not in this party.");
      return;
    }
    if (isLeader && post.status === "open") {
      await safeEphemeral(
        interaction,
        "Leader cannot leave an open party. Close it first."
      );
      return;
    }
    post.members = post.members.filter((id) => id !== userId);
    saveState();
    await refreshPartyMessage(interaction, guildState, post);
    await safeEphemeral(interaction, "You left the party.");
    return;
  }

  if (action === "close") {
    if (!isLeader && !canManage) {
      await safeEphemeral(
        interaction,
        "Only party leader or server managers can close this post."
      );
      return;
    }
    post.status = "closed";
    post.closedAt = Date.now();
    saveState();
    await refreshPartyMessage(interaction, guildState, post);
    await safeEphemeral(interaction, "Party closed.");
  }
}

async function handleVerificationButton(interaction) {
  const [scope, action, userId, ticketId] = (interaction.customId || "").split("|");
  if (scope !== "verify" || !action || !userId || !ticketId) return false;
  if (!interaction.guildId) {
    await safeEphemeral(interaction, "This button only works in a guild.");
    return true;
  }
  if (!hasManageGuild(interaction)) {
    await safeEphemeral(interaction, "Manage Server permission is required.");
    return true;
  }

  const guildState = ensureGuildState(interaction.guildId);
  const ticket = guildState.verification?.tickets?.[ticketId];
  if (!ticket) {
    await safeEphemeral(interaction, "Verification ticket was not found.");
    return true;
  }
  if (ticket.status !== "pending") {
    await safeEphemeral(interaction, `This ticket is already ${ticket.status}.`);
    return true;
  }
  if (!["approve", "reject"].includes(action)) {
    await safeEphemeral(interaction, "Invalid verification action.");
    return true;
  }

  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const conf = guildState.verification || {};
  if (action === "approve") {
    if (member && conf.tempRoleId) await member.roles.remove(conf.tempRoleId).catch(() => {});
    if (member && conf.verifiedRoleId) {
      await member.roles.add(conf.verifiedRoleId).catch(() => {});
    }
    ticket.status = "approved";
  } else {
    if (member && conf.tempRoleId) await member.roles.remove(conf.tempRoleId).catch(() => {});
    ticket.status = "rejected";
  }

  ticket.handledAt = Date.now();
  ticket.handledBy = interaction.user.id;
  saveState();

  await interaction
    .update({
      components: [buildVerificationButtons(ticket.userId, ticket.ticketId, true)],
    })
    .catch(async () => {
      await interaction.deferUpdate().catch(() => {});
    });

  await sendVerificationLog(
    client,
    interaction.guildId,
    guildState,
    ticket,
    ticket.status,
    interaction.user.id
  );

  if (member) {
    await member
      .send(
        `Your verification was **${ticket.status}** in **${interaction.guild.name}**.`
      )
      .catch(() => {});
  }

  await interaction.channel
    ?.send(
      `Verification ${ticket.status}: <@${ticket.userId}> by <@${interaction.user.id}>`
    )
    .catch(() => {});
  await safeEphemeral(interaction, `Ticket marked as ${ticket.status}.`);
  return true;
}

const app = express();
app.get("/", (_, res) => res.send("Aon English Bot is online."));
app.listen(CONFIG.port, () => {
  console.log(`[http] keep-alive server on ${CONFIG.port}`);
});

if (!CONFIG.token) {
  console.error("DISCORD_TOKEN is missing.");
  process.exit(1);
}

client.once("ready", async () => {
  console.log(`[ready] logged in as ${client.user.tag}`);
  try {
    for (const guild of client.guilds.cache.values()) {
      ensureGuildState(guild.id);
    }
    saveState();
    await registerCommands();
  } catch (err) {
    console.error("[commands] registration failed", err.message);
  }

  setInterval(() => {
    runBossTicker(client).catch((err) =>
      console.error("[boss-ticker]", err.message)
    );
  }, CONFIG.bossTickerMs);

  setInterval(() => {
    runNoticeTicker(client).catch((err) =>
      console.error("[notice-ticker]", err.message)
    );
  }, CONFIG.noticeTickerMs);

  runBossTicker(client).catch(() => {});
  runNoticeTicker(client).catch(() => {});
});

client.on("guildCreate", async (guild) => {
  try {
    ensureGuildState(guild.id);
    saveState();
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), {
      body: commandPayload,
    });
  } catch (err) {
    console.error("[guildCreate] command registration failed", err.message);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlash(interaction);
      return;
    }
    if (interaction.isButton()) {
      const handled = await handleVerificationButton(interaction);
      if (handled) return;
      await handlePartyButton(interaction);
      return;
    }
  } catch (err) {
    console.error("[interaction] error", err);
    await safeEphemeral(
      interaction,
      "An unexpected error occurred. Please try again."
    );
  }
});

client.login(CONFIG.token);
