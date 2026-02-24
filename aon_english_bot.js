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
const NOTICE_CATEGORIES = ["notice", "update", "event", "maintenance"];
const KINAH_PRESET_TYPES = [
  "itembay_aion2",
  "itemmania_aion2",
  "dual_market_aion2",
];
const KINAH_PRESET_DEFAULTS = {
  itembay_aion2: {
    primaryUrl: "https://www.itembay.com/item/sell/game-3603/type-3",
    sourceKeyword: "아이온2 키나",
  },
  itemmania_aion2: {
    primaryUrl:
      "https://trade.itemmania.com/list/search.html?searchString=%EC%95%84%EC%9D%B4%EC%98%A82%20%ED%82%A4%EB%82%98",
    sourceKeyword: "아이온2 키나",
  },
  dual_market_aion2: {
    primaryUrl: "https://www.itembay.com/item/sell/game-3603/type-3",
    secondaryUrl:
      "https://trade.itemmania.com/list/search.html?searchString=%EC%95%84%EC%9D%B4%EC%98%A82%20%ED%82%A4%EB%82%98",
    sourceKeyword: "아이온2 키나",
  },
};

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

function createNoticeChannelMap(seed = null) {
  const map = {
    notice: null,
    update: null,
    event: null,
    maintenance: null,
  };
  if (!seed || typeof seed !== "object") return map;
  for (const category of NOTICE_CATEGORIES) {
    const value = seed[category];
    map[category] = typeof value === "string" && value.length ? value : null;
  }
  return map;
}

function createDefaultKinahWatch(seed = null) {
  const base = {
    enabled: false,
    sourcePreset: null,
    sourceKeyword: "아이온2 키나",
    channelId: null,
    sourceUrl: null,
    secondarySourceUrl: null,
    selector: null,
    valueRegex: null,
    pollMinutes: 5,
    mentionRoleId: null,
    lastRate: null,
    lastRawText: null,
    lastSourceSummary: null,
    lastCheckedAt: null,
    lastPostedAt: null,
    lastError: null,
  };
  if (!seed || typeof seed !== "object") return base;
  return {
    ...base,
    enabled: Boolean(seed.enabled),
    sourcePreset:
      typeof seed.sourcePreset === "string" &&
      KINAH_PRESET_TYPES.includes(seed.sourcePreset)
        ? seed.sourcePreset
        : null,
    sourceKeyword:
      typeof seed.sourceKeyword === "string" && seed.sourceKeyword.length
        ? seed.sourceKeyword
        : base.sourceKeyword,
    channelId:
      typeof seed.channelId === "string" && seed.channelId.length
        ? seed.channelId
        : null,
    sourceUrl:
      typeof seed.sourceUrl === "string" && seed.sourceUrl.length
        ? seed.sourceUrl
        : null,
    secondarySourceUrl:
      typeof seed.secondarySourceUrl === "string" && seed.secondarySourceUrl.length
        ? seed.secondarySourceUrl
        : null,
    selector:
      typeof seed.selector === "string" && seed.selector.length
        ? seed.selector
        : null,
    valueRegex:
      typeof seed.valueRegex === "string" && seed.valueRegex.length
        ? seed.valueRegex
        : null,
    pollMinutes: Math.max(
      1,
      Math.min(60, Number.parseInt(String(seed.pollMinutes || 5), 10) || 5)
    ),
    mentionRoleId:
      typeof seed.mentionRoleId === "string" && seed.mentionRoleId.length
        ? seed.mentionRoleId
        : null,
    lastRate: Number.isFinite(Number(seed.lastRate))
      ? Number(seed.lastRate)
      : null,
    lastRawText:
      typeof seed.lastRawText === "string" && seed.lastRawText.length
        ? seed.lastRawText
        : null,
    lastSourceSummary:
      typeof seed.lastSourceSummary === "string" && seed.lastSourceSummary.length
        ? seed.lastSourceSummary
        : null,
    lastCheckedAt: Number.isFinite(Number(seed.lastCheckedAt))
      ? Number(seed.lastCheckedAt)
      : null,
    lastPostedAt: Number.isFinite(Number(seed.lastPostedAt))
      ? Number(seed.lastPostedAt)
      : null,
    lastError:
      typeof seed.lastError === "string" && seed.lastError.length
        ? seed.lastError
        : null,
  };
}

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
  kinahTickerMs: Math.max(60_000, toInt(process.env.KINAH_TICKER_MS, 300_000)),
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
      channelsByCategory: createNoticeChannelMap(),
    },
    kinah: createDefaultKinahWatch(),
    verification: {
      tempRoleId: null,
      verifiedRoleId: null,
      categoryId: null,
      logChannelId: null,
      tickets: {},
    },
    invites: {
      channelId: null,
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
  g.notices = g.notices || {
    channelId: null,
    categories: ["all"],
    channelsByCategory: createNoticeChannelMap(),
  };
  g.notices.channelsByCategory = createNoticeChannelMap(
    g.notices.channelsByCategory
  );
  if (Array.isArray(g.notices.categories)) {
    const normalizedCategories = [
      ...new Set(
        g.notices.categories
          .map((item) => String(item || "").toLowerCase().trim())
          .filter(Boolean)
      ),
    ].filter((item) => item === "all" || NOTICE_CATEGORIES.includes(item));
    g.notices.categories = normalizedCategories.includes("all")
      ? ["all"]
      : normalizedCategories;
  } else {
    g.notices.categories = ["all"];
  }
  g.kinah = createDefaultKinahWatch(g.kinah);
  g.verification = g.verification || {
    tempRoleId: null,
    verifiedRoleId: null,
    categoryId: null,
    logChannelId: null,
    tickets: {},
  };
  g.verification.tickets = g.verification.tickets || {};
  g.invites = g.invites || { channelId: null };
  g.invites.channelId =
    typeof g.invites.channelId === "string" && g.invites.channelId.length
      ? g.invites.channelId
      : null;
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
  const enabledCategories = categories.includes("all")
    ? NOTICE_CATEGORIES
    : categories;
  const routes = createNoticeChannelMap(notice.channelsByCategory);
  const routeLines = NOTICE_CATEGORIES.map((category) => {
    const target = routes[category] || notice.channelId;
    return `- ${category}: ${target ? `<#${target}>` : "Not set"}`;
  }).join("\n");
  return new EmbedBuilder()
    .setTitle("Notice Relay Status")
    .setDescription(
      [
        `Default channel: ${
          notice.channelId ? `<#${notice.channelId}>` : "Not configured"
        }`,
        `Enabled categories: ${
          enabledCategories.length ? enabledCategories.join(", ") : "Disabled"
        }`,
        `Sources: ${CONFIG.noticeSources.length}`,
      ].join("\n")
    )
    .addFields({
      name: "Category routes",
      value: routeLines,
    })
    .setColor(0x0ea5e9);
}

function noticeCategoryEnabled(categories, category) {
  if (!NOTICE_CATEGORIES.includes(category)) return false;
  if (!Array.isArray(categories) || categories.length === 0) return false;
  if (categories.includes("all")) return true;
  return categories.includes(category);
}

function getNoticeTargetChannelId(noticeConfig, category) {
  const routes = createNoticeChannelMap(noticeConfig?.channelsByCategory);
  return routes[category] || noticeConfig?.channelId || null;
}

function extractNumericTokens(text) {
  return String(text || "")
    .match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)
    ?.map((token) => token.trim()) || [];
}

function parseNumericValue(token) {
  const value = Number.parseFloat(String(token || "").replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function pickMedian(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function pickTrimmedMedian(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length <= 4) return pickMedian(sorted);
  const trimCount = Math.floor(sorted.length * 0.1);
  const trimmed =
    trimCount > 0 && sorted.length - trimCount * 2 >= 3
      ? sorted.slice(trimCount, sorted.length - trimCount)
      : sorted;
  return pickMedian(trimmed);
}

function collectJsonNodes(value, out = []) {
  if (value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonNodes(item, out);
    return out;
  }
  if (typeof value === "object") {
    out.push(value);
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") collectJsonNodes(child, out);
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
  if (!Number.isFinite(value)) return "N/A";
  return `${Math.round(value).toLocaleString()} KRW`;
}

async function fetchItembayAion2Snapshot(sourceUrl) {
  const url = sourceUrl || KINAH_PRESET_DEFAULTS.itembay_aion2.primaryUrl;
  const { data } = await axios.get(url, {
    timeout: 20_000,
    maxRedirects: 5,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  const $ = cheerio.load(data);
  const canonical = $('link[rel="canonical"]').attr("href") || url;
  const jsonBlocks = parseJsonLdBlocks($);
  const nodes = jsonBlocks.flatMap((block) => collectJsonNodes(block));

  const aggregateOffer = nodes.find(
    (node) =>
      node["@type"] === "AggregateOffer" &&
      parseNumericValue(node.lowPrice) != null &&
      parseNumericValue(node.highPrice) != null
  );
  const lowPrice = aggregateOffer ? parseNumericValue(aggregateOffer.lowPrice) : null;
  const highPrice = aggregateOffer
    ? parseNumericValue(aggregateOffer.highPrice)
    : null;
  const offerCount = aggregateOffer ? parseNumericValue(aggregateOffer.offerCount) : null;

  const listItems = nodes
    .filter((node) => node["@type"] === "ListItem" && node.item)
    .map((node) => node.item)
    .filter((item) => {
      const name = String(item.name || "");
      const category = String(item.category || "");
      return /아이온2|aion2/i.test(`${name} ${category}`);
    });
  const kinahItems = listItems.filter((item) =>
    /키나|kinah|게임머니|game.?money/i.test(
      `${item.name || ""} ${item.description || ""}`
    )
  );

  const prices = (kinahItems.length ? kinahItems : listItems)
    .map((item) => parseNumericValue(item?.offers?.price))
    .filter((value) => value != null);
  const representative =
    pickTrimmedMedian(prices) ?? lowPrice ?? pickMedian(prices) ?? highPrice;
  if (!Number.isFinite(representative)) {
    throw new Error("ItemBay AION2 parser could not find numeric price.");
  }

  return {
    token: formatKrw(representative),
    numeric: Math.round(representative),
    snippet: `ItemBay AION2 game-money low ${formatKrw(lowPrice)} / high ${formatKrw(
      highPrice
    )} / offers ${offerCount ? offerCount.toLocaleString() : "N/A"}`,
    sourceUrl: canonical,
    sourceName: "ItemBay AION2",
    sourceSummary: `ItemBay:${formatKrw(representative)}`,
  };
}

async function fetchItemmaniaAion2Snapshot(sourceUrl, sourceKeyword) {
  const url = sourceUrl || KINAH_PRESET_DEFAULTS.itemmania_aion2.primaryUrl;
  const { data } = await axios.get(url, {
    timeout: 20_000,
    maxRedirects: 5,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  const $ = cheerio.load(data);
  const bodyText = $("body").text().replace(/\r/g, "\n");
  const keyword = String(sourceKeyword || "아이온2 키나").trim();
  const keywordLines = bodyText
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => {
      if (!keyword) return true;
      const words = keyword.split(/\s+/).filter(Boolean);
      return words.every((word) => line.toLowerCase().includes(word.toLowerCase()));
    });

  const candidateText = keywordLines.length
    ? keywordLines.slice(0, 100).join("\n")
    : bodyText;
  const candidates = extractNumericTokens(candidateText)
    .map((token) => parseNumericValue(token))
    .filter((value) => value != null)
    .filter((value) => value >= 10 && value <= 500_000_000);

  const representative = pickTrimmedMedian(candidates) ?? pickMedian(candidates);
  if (!Number.isFinite(representative)) {
    throw new Error("ItemMania parser could not find numeric price.");
  }

  return {
    token: formatKrw(representative),
    numeric: Math.round(representative),
    snippet: `ItemMania keyword: ${keyword || "AION2"} (${candidates.length} candidates)`,
    sourceUrl: url,
    sourceName: "ItemMania AION2",
    sourceSummary: `ItemMania:${formatKrw(representative)}`,
  };
}

async function fetchKinahRateByPreset(watchConfig) {
  const preset = watchConfig?.sourcePreset;
  if (!KINAH_PRESET_TYPES.includes(preset)) {
    throw new Error("Unknown kinah preset.");
  }

  if (preset === "itembay_aion2") {
    return fetchItembayAion2Snapshot(
      watchConfig?.sourceUrl || KINAH_PRESET_DEFAULTS.itembay_aion2.primaryUrl
    );
  }
  if (preset === "itemmania_aion2") {
    return fetchItemmaniaAion2Snapshot(
      watchConfig?.sourceUrl || KINAH_PRESET_DEFAULTS.itemmania_aion2.primaryUrl,
      watchConfig?.sourceKeyword
    );
  }

  const calls = [
    fetchItembayAion2Snapshot(
      watchConfig?.sourceUrl || KINAH_PRESET_DEFAULTS.dual_market_aion2.primaryUrl
    ),
    fetchItemmaniaAion2Snapshot(
      watchConfig?.secondarySourceUrl ||
        KINAH_PRESET_DEFAULTS.dual_market_aion2.secondaryUrl,
      watchConfig?.sourceKeyword
    ),
  ];
  const results = await Promise.allSettled(calls);
  const success = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  if (!success.length) {
    const reasons = results
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason?.message || String(r.reason));
    throw new Error(`Dual market fetch failed: ${reasons.join(" / ")}`);
  }
  if (success.length === 1) return success[0];

  const average =
    success.reduce((sum, item) => sum + Number(item.numeric || 0), 0) /
    success.length;
  const summary = success.map((item) => item.sourceSummary).join(" | ");
  return {
    token: formatKrw(average),
    numeric: Math.round(average),
    snippet: `Dual market avg from ${success.length} sources`,
    sourceUrl: success[0].sourceUrl,
    sourceName: "Dual Market AION2",
    sourceSummary: summary,
    sourceValues: success.map((item) => ({
      name: item.sourceName,
      token: item.token,
      numeric: item.numeric,
      sourceUrl: item.sourceUrl,
    })),
  };
}

function extractKinahValueFromText(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const keywordLines = lines.filter((line) =>
    /(kinah|키나|시세|rate|exchange|market)/i.test(line)
  );
  const candidates = keywordLines.length ? keywordLines : lines.slice(0, 50);
  const joined = candidates.join("\n");
  const tokens = extractNumericTokens(joined);
  if (!tokens.length) return null;

  const ranked = tokens
    .map((token) => ({ token, numeric: parseNumericValue(token) }))
    .filter((item) => item.numeric != null)
    .sort((a, b) => b.numeric - a.numeric);
  if (!ranked.length) return null;
  return {
    token: ranked[0].token,
    numeric: ranked[0].numeric,
    snippet: candidates.slice(0, 3).join("\n"),
  };
}

async function fetchKinahRateSnapshot(watchConfig) {
  const sourcePreset = String(watchConfig?.sourcePreset || "").trim();
  if (sourcePreset) {
    return fetchKinahRateByPreset(watchConfig);
  }

  const sourceUrl = String(watchConfig?.sourceUrl || "").trim();
  if (!sourceUrl) {
    throw new Error("Source URL is not configured.");
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch (_) {
    throw new Error("Source URL is invalid.");
  }
  if (!["https:", "http:"].includes(parsedUrl.protocol)) {
    throw new Error("Source URL must start with http(s).");
  }

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
  const selector = String(watchConfig?.selector || "").trim();
  const regexRaw = String(watchConfig?.valueRegex || "").trim();

  let targetText = "";
  if (selector) {
    const matches = $(selector)
      .slice(0, 20)
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);
    targetText = matches.join("\n");
  }

  const bodyText = $("body").text().replace(/\r/g, "\n");
  if (!targetText) targetText = bodyText;

  if (regexRaw) {
    let regex;
    try {
      regex = new RegExp(regexRaw, "i");
    } catch (err) {
      throw new Error(`Invalid regex: ${err.message}`);
    }
    const match = targetText.match(regex) || bodyText.match(regex);
    if (!match) {
      throw new Error("Regex did not match any value.");
    }
    const picked = match[1] || match[0];
    const token = String(picked).trim();
    const numeric = parseNumericValue(token);
    if (numeric == null) {
      throw new Error("Matched value is not numeric.");
    }
    return {
      token,
      numeric,
      snippet: targetText.split("\n").slice(0, 3).join("\n"),
      sourceUrl,
    };
  }

  const parsed = extractKinahValueFromText(targetText);
  if (!parsed) {
    throw new Error(
      "Could not extract kinah rate. Configure `selector` or `value_regex`."
    );
  }

  return {
    token: parsed.token,
    numeric: parsed.numeric,
    snippet: parsed.snippet,
    sourceUrl,
  };
}

function buildKinahStatusEmbed(guildState) {
  const watch = createDefaultKinahWatch(guildState?.kinah);
  const presetLabel = watch.sourcePreset || "custom";
  return new EmbedBuilder()
    .setTitle("Kinah Rate Crawler Status")
    .setDescription(
      [
        `Enabled: ${watch.enabled ? "Yes" : "No"}`,
        `Post channel: ${watch.channelId ? `<#${watch.channelId}>` : "Not set"}`,
        `Preset: ${presetLabel}`,
        `Keyword: ${watch.sourceKeyword || "N/A"}`,
        `Source URL: ${watch.sourceUrl || "Not set"}`,
        `Secondary URL: ${watch.secondarySourceUrl || "N/A"}`,
        `Selector: ${watch.selector || "Auto detect"}`,
        `Regex: ${watch.valueRegex || "Auto detect"}`,
        `Poll interval: ${watch.pollMinutes} minute(s)`,
        `Mention role: ${
          watch.mentionRoleId ? `<@&${watch.mentionRoleId}>` : "None"
        }`,
        `Last value: ${watch.lastRawText || "N/A"}`,
        `Last sources: ${watch.lastSourceSummary || "N/A"}`,
        `Last check: ${
          watch.lastCheckedAt ? toDiscordTime(watch.lastCheckedAt) : "N/A"
        }`,
        `Last error: ${watch.lastError || "None"}`,
      ].join("\n")
    )
    .setColor(0x14b8a6);
}

function buildKinahRateEmbed(snapshot, previousValue = null) {
  const isFirst = previousValue == null;
  const diff =
    previousValue == null ? null : Number(snapshot.numeric) - Number(previousValue);
  const diffLine =
    diff == null
      ? "Initial baseline captured."
      : `${diff >= 0 ? "+" : ""}${diff.toLocaleString()} vs previous`;
  return new EmbedBuilder()
    .setTitle("💰 Kinah Rate Update")
    .setDescription(
      [
        `Current: **${snapshot.token}**`,
        `Change: ${diffLine}`,
        snapshot.sourceName ? `Source: ${snapshot.sourceName}` : null,
        snapshot.sourceSummary ? `Source summary: ${snapshot.sourceSummary}` : null,
        snapshot.snippet ? `Snapshot: \`${snapshot.snippet.slice(0, 220)}\`` : null,
        `[Source link](${snapshot.sourceUrl})`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .addFields(
      ...(Array.isArray(snapshot.sourceValues) && snapshot.sourceValues.length
        ? [
            {
              name: "Source breakdown",
              value: snapshot.sourceValues
                .map((item) => `- ${item.name}: ${item.token}`)
                .join("\n")
                .slice(0, 1000),
            },
          ]
        : [])
    )
    .setColor(isFirst ? 0x0ea5e9 : diff >= 0 ? 0x22c55e : 0xef4444)
    .setTimestamp();
}

function formatInviteExpiry(maxAgeSeconds) {
  if (!maxAgeSeconds) return "Never";
  if (maxAgeSeconds % 3600 === 0) {
    return `${maxAgeSeconds / 3600}h`;
  }
  if (maxAgeSeconds % 60 === 0) {
    return `${maxAgeSeconds / 60}m`;
  }
  return `${maxAgeSeconds}s`;
}

function buildInviteStatusEmbed(guildState) {
  const channelId = guildState?.invites?.channelId || null;
  return new EmbedBuilder()
    .setTitle("Invite Automation Status")
    .setDescription(
      [
        `Invite post channel: ${
          channelId ? `<#${channelId}>` : "Not configured"
        }`,
        "Use `/invite_channel_set` to choose where invite posts go.",
        "Use `/invite_create` to generate and post invite links.",
      ].join("\n")
    )
    .setColor(0x8b5cf6);
}

function buildInviteEmbed({
  code,
  url,
  targetChannelId,
  maxUses,
  maxAge,
  creatorId,
  note,
}) {
  const expiresText = formatInviteExpiry(maxAge);
  return new EmbedBuilder()
    .setTitle("🔗 Server Invite Code")
    .setDescription(url)
    .addFields(
      { name: "Code", value: code || "N/A", inline: true },
      {
        name: "Target Channel",
        value: targetChannelId ? `<#${targetChannelId}>` : "N/A",
        inline: true,
      },
      {
        name: "Uses",
        value: maxUses && maxUses > 0 ? String(maxUses) : "Unlimited",
        inline: true,
      },
      {
        name: "Expires",
        value: expiresText,
        inline: true,
      },
      {
        name: "Created By",
        value: creatorId ? `<@${creatorId}>` : "N/A",
        inline: true,
      },
      {
        name: "Note",
        value: note || "N/A",
        inline: false,
      }
    )
    .setColor(0x7c3aed)
    .setTimestamp();
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
        if (!noticeCategoryEnabled(noticeConfig.categories, source.category)) {
          continue;
        }
        const targetChannelId = getNoticeTargetChannelId(
          noticeConfig,
          source.category
        );
        if (!targetChannelId) continue;

        const channel = await client.channels
          .fetch(targetChannelId)
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

let kinahTickerActive = false;
async function runKinahTicker(client) {
  if (kinahTickerActive) return;
  kinahTickerActive = true;
  try {
    const now = Date.now();
    let changed = false;

    for (const guildState of Object.values(state.guilds)) {
      const watch = createDefaultKinahWatch(guildState.kinah);
      guildState.kinah = watch;
      if (!watch.enabled || !watch.sourceUrl || !watch.channelId) continue;

      const intervalMs = Math.max(60_000, watch.pollMinutes * 60_000);
      if (watch.lastCheckedAt && now - watch.lastCheckedAt < intervalMs) {
        continue;
      }

      watch.lastCheckedAt = now;
      changed = true;

      let snapshot;
      try {
        snapshot = await fetchKinahRateSnapshot(watch);
        watch.lastError = null;
      } catch (err) {
        watch.lastError = err.message || "Fetch failed";
        changed = true;
        continue;
      }

      const isChanged = watch.lastRate == null || snapshot.numeric !== watch.lastRate;
      watch.lastRawText = snapshot.token;
      watch.lastSourceSummary =
        snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null;
      if (!isChanged) continue;

      const channel = await client.channels.fetch(watch.channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        watch.lastError = "Post channel is missing or not text-based.";
        changed = true;
        continue;
      }

      const content = watch.mentionRoleId ? `<@&${watch.mentionRoleId}>` : undefined;
      const embed = buildKinahRateEmbed(snapshot, watch.lastRate);
      await channel.send({ content, embeds: [embed] }).catch(() => {});

      watch.lastRate = snapshot.numeric;
      watch.lastPostedAt = Date.now();
      changed = true;
    }

    if (changed) saveState();
  } finally {
    kinahTickerActive = false;
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

async function lookupCharacterEmbed(query, filters = {}) {
  const trimmed = String(query || "").trim();
  const urlMatch = trimmed.match(PLAYNC_CHAR_URL);
  const normalizedUrl = urlMatch
    ? trimmed.startsWith("http")
      ? trimmed
      : `https://${urlMatch[0]}`
    : null;

  try {
    let info;
    if (normalizedUrl) {
      info = await scrapeCharacterByUrl(normalizedUrl);
    } else {
      info = await searchCharacterByName(trimmed, {
        race: filters.race || null,
        classKeyword: filters.classKeyword || null,
      });
    }

    if (!info) {
      return buildCharacterFallbackEmbed(trimmed, Boolean(normalizedUrl));
    }
    return buildCharacterEmbed(info, trimmed);
  } catch (err) {
    console.error("[character] failed", err.message);
    return buildCharacterFallbackEmbed(trimmed, Boolean(normalizedUrl));
  }
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
          "`/kinah_watch_now` - On-demand kinah crawl snapshot",
        ].join("\n"),
      },
      {
        name: "🛡️ Admin Only (Initial Setup)",
        value: [
          "`/temp_role_set` `/verified_role_set`",
          "`/verify_channel_set` `/verify_log_set`",
          "`/notice_set` `/notice_status`",
          "`/kinah_watch_preset` `/kinah_watch_set`",
          "`/kinah_watch_stop` `/kinah_watch_status`",
          "`/boss_add` `/boss_remove`",
        ].join("\n"),
      },
      {
        name: "🔗 Invite Automation",
        value: [
          "`/invite_channel_set` - Set invite post channel",
          "`/invite_create` - Create and post invite links",
          "`/invite_status` - Check invite automation setup",
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
    .setName("invite_channel_set")
    .setDescription("Set channel where invite links are posted")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Invite post channel")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    ),
  new SlashCommandBuilder()
    .setName("invite_create")
    .setDescription("Create and post a server invite link")
    .addChannelOption((opt) =>
      opt
        .setName("target_channel")
        .setDescription("Channel users should join into")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("max_uses")
        .setDescription("0 = unlimited")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(100)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("expire_hours")
        .setDescription("0 = never expire")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(168)
    )
    .addStringOption((opt) =>
      opt
        .setName("note")
        .setDescription("Optional note shown in invite embed")
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName("public_post")
        .setDescription("Post to invite channel publicly (default: true)")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("invite_status")
    .setDescription("Show invite automation settings"),
  new SlashCommandBuilder()
    .setName("kinah_watch_set")
    .setDescription("Configure kinah rate crawler and target channel")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Channel where kinah updates are posted")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addStringOption((opt) =>
      opt
        .setName("source_url")
        .setDescription("Market/source page URL")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("selector")
        .setDescription("Optional CSS selector for price text")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("value_regex")
        .setDescription("Optional regex (capture group #1 preferred)")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("poll_minutes")
        .setDescription("How often to check (1-60)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(60)
    )
    .addRoleOption((opt) =>
      opt
        .setName("mention_role")
        .setDescription("Optional role mention on updates")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("kinah_watch_preset")
    .setDescription("Quick setup for ItemBay/ItemMania AION2 presets")
    .addStringOption((opt) =>
      opt
        .setName("preset")
        .setDescription("Market preset")
        .setRequired(true)
        .addChoices(
          { name: "ItemBay AION2", value: "itembay_aion2" },
          { name: "ItemMania AION2", value: "itemmania_aion2" },
          { name: "Dual Market AION2", value: "dual_market_aion2" }
        )
    )
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Channel where kinah updates are posted")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("poll_minutes")
        .setDescription("How often to check (1-60)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(60)
    )
    .addRoleOption((opt) =>
      opt
        .setName("mention_role")
        .setDescription("Optional role mention on updates")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("source_keyword")
        .setDescription("Keyword hint (default: 아이온2 키나)")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("kinah_watch_now")
    .setDescription("Fetch kinah rate immediately")
    .addBooleanOption((opt) =>
      opt
        .setName("public_post")
        .setDescription("Post result publicly to configured channel")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("kinah_watch_stop")
    .setDescription("Stop kinah rate crawler for this guild"),
  new SlashCommandBuilder()
    .setName("kinah_watch_status")
    .setDescription("Show kinah rate crawler settings and last state"),
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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
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
          "- /invite_channel_set /invite_create /invite_status",
          "- /kinah_watch_preset /kinah_watch_set /kinah_watch_now",
          "- /kinah_watch_status /kinah_watch_stop",
          "- /myinfo_register /verification_status",
          "- /profile_set /party_recruit",
          "- /character /item /collection /build (legacy: !char)",
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

    const allCategories = NOTICE_CATEGORIES;
    guildState.notices.channelsByCategory = createNoticeChannelMap(
      guildState.notices.channelsByCategory
    );
    const current = new Set(guildState.notices.categories || []);
    if (current.has("all")) {
      current.clear();
      for (const item of allCategories) current.add(item);
    }

    if (category === "all") {
      guildState.notices.channelId = channel.id;
      guildState.notices.categories = enabled ? ["all"] : [];
    } else {
      if (enabled) {
        current.add(category);
        guildState.notices.channelsByCategory[category] = channel.id;
      } else {
        current.delete(category);
        guildState.notices.channelsByCategory[category] = null;
      }
      if (!guildState.notices.channelId) {
        guildState.notices.channelId = channel.id;
      }
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

  if (interaction.commandName === "invite_channel_set") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const channel = interaction.options.getChannel("channel", true);
    guildState.invites.channelId = channel.id;
    saveState();
    await interaction.reply({
      embeds: [buildInviteStatusEmbed(guildState)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "invite_status") {
    await interaction.reply({
      embeds: [buildInviteStatusEmbed(guildState)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "invite_create") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }

    const targetChannel =
      interaction.options.getChannel("target_channel") || interaction.channel;
    const maxUses = interaction.options.getInteger("max_uses") ?? 0;
    const expireHours = interaction.options.getInteger("expire_hours") ?? 0;
    const note = (interaction.options.getString("note") || "").trim();
    const publicPost = interaction.options.getBoolean("public_post") ?? true;

    if (!targetChannel || typeof targetChannel.createInvite !== "function") {
      await safeEphemeral(
        interaction,
        "Target channel does not support invite creation."
      );
      return;
    }

    const invite = await targetChannel
      .createInvite({
        maxAge: expireHours > 0 ? expireHours * 3600 : 0,
        maxUses: maxUses > 0 ? maxUses : 0,
        unique: true,
        reason: `Invite automation requested by ${interaction.user.tag}`,
      })
      .catch(() => null);

    if (!invite) {
      await safeEphemeral(
        interaction,
        "Failed to create invite. Check bot permission: Create Instant Invite."
      );
      return;
    }

    const embed = buildInviteEmbed({
      code: invite.code,
      url: invite.url,
      targetChannelId: targetChannel.id,
      maxUses: invite.maxUses || 0,
      maxAge: invite.maxAge || 0,
      creatorId: interaction.user.id,
      note,
    });

    if (!publicPost) {
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const preferredChannelId = guildState.invites.channelId || interaction.channelId;
    const preferredChannel = await interaction.guild.channels
      .fetch(preferredChannelId)
      .catch(() => null);
    const postChannel =
      preferredChannel && preferredChannel.isTextBased()
        ? preferredChannel
        : interaction.channel;

    if (!postChannel || !postChannel.isTextBased()) {
      await safeEphemeral(
        interaction,
        "Invite post channel is invalid. Run `/invite_channel_set` first."
      );
      return;
    }

    const sent = await postChannel.send({ embeds: [embed] }).catch(() => null);
    if (!sent) {
      await safeEphemeral(
        interaction,
        "Failed to post invite embed in target channel."
      );
      return;
    }

    await interaction.reply({
      content: `Invite posted in ${postChannel}.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "kinah_watch_preset") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const preset = interaction.options.getString("preset", true);
    const presetConfig = KINAH_PRESET_DEFAULTS[preset];
    if (!presetConfig) {
      await safeEphemeral(interaction, "Invalid preset value.");
      return;
    }

    const channel = interaction.options.getChannel("channel", true);
    const pollMinutes = interaction.options.getInteger("poll_minutes") ?? 5;
    const mentionRole = interaction.options.getRole("mention_role");
    const sourceKeyword =
      (interaction.options.getString("source_keyword") || "").trim() ||
      presetConfig.sourceKeyword ||
      "아이온2 키나";

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
      watch.lastRate = snapshot.numeric;
      watch.lastRawText = snapshot.token;
      watch.lastSourceSummary =
        snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null;
      watch.lastCheckedAt = Date.now();
      watch.lastError = null;
    } catch (err) {
      watch.lastError = err.message || "Initial preset fetch failed.";
    }

    guildState.kinah = watch;
    saveState();

    const embeds = [buildKinahStatusEmbed(guildState)];
    if (snapshot) embeds.push(buildKinahRateEmbed(snapshot, null));
    await interaction.reply({ embeds, ephemeral: true });
    return;
  }

  if (interaction.commandName === "kinah_watch_set") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }

    const channel = interaction.options.getChannel("channel", true);
    const sourceUrl = interaction.options.getString("source_url", true).trim();
    const selector = (interaction.options.getString("selector") || "").trim();
    const valueRegex = (interaction.options.getString("value_regex") || "").trim();
    const pollMinutes = interaction.options.getInteger("poll_minutes") ?? 5;
    const mentionRole = interaction.options.getRole("mention_role");

    try {
      const u = new URL(sourceUrl);
      if (!["https:", "http:"].includes(u.protocol)) {
        await safeEphemeral(interaction, "source_url must be http(s).");
        return;
      }
    } catch (_) {
      await safeEphemeral(interaction, "source_url is invalid.");
      return;
    }

    if (valueRegex) {
      try {
        // Validate regex early for admin convenience.
        // eslint-disable-next-line no-new
        new RegExp(valueRegex, "i");
      } catch (err) {
        await safeEphemeral(interaction, `Invalid value_regex: ${err.message}`);
        return;
      }
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
    if (mentionRole) watch.mentionRoleId = mentionRole.id;
    watch.lastError = null;

    let snapshot = null;
    try {
      snapshot = await fetchKinahRateSnapshot(watch);
      watch.lastRate = snapshot.numeric;
      watch.lastRawText = snapshot.token;
      watch.lastSourceSummary =
        snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null;
      watch.lastCheckedAt = Date.now();
      watch.lastError = null;
    } catch (err) {
      watch.lastError = err.message || "Initial fetch failed.";
    }

    guildState.kinah = watch;
    saveState();

    const embeds = [buildKinahStatusEmbed(guildState)];
    if (snapshot) embeds.push(buildKinahRateEmbed(snapshot, null));
    await interaction.reply({ embeds, ephemeral: true });
    return;
  }

  if (interaction.commandName === "kinah_watch_status") {
    await interaction.reply({
      embeds: [buildKinahStatusEmbed(guildState)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "kinah_watch_stop") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const watch = createDefaultKinahWatch(guildState.kinah);
    watch.enabled = false;
    guildState.kinah = watch;
    saveState();
    await interaction.reply({
      content: "Kinah rate crawler stopped for this guild.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "kinah_watch_now") {
    const watch = createDefaultKinahWatch(guildState.kinah);
    if (!watch.sourceUrl) {
      await safeEphemeral(
        interaction,
        "Kinah crawler is not configured. Run `/kinah_watch_preset` or `/kinah_watch_set` first."
      );
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    let snapshot;
    try {
      snapshot = await fetchKinahRateSnapshot(watch);
    } catch (err) {
      watch.lastError = err.message || "Fetch failed";
      guildState.kinah = watch;
      saveState();
      await interaction.editReply({
        content: `Failed to fetch kinah rate: ${watch.lastError}`,
      });
      return;
    }

    const previousRate = watch.lastRate;
    watch.lastRate = snapshot.numeric;
    watch.lastRawText = snapshot.token;
    watch.lastSourceSummary =
      snapshot.sourceSummary || snapshot.sourceName || snapshot.sourceUrl || null;
    watch.lastCheckedAt = Date.now();
    watch.lastError = null;
    guildState.kinah = watch;
    saveState();

    const embed = buildKinahRateEmbed(snapshot, previousRate);
    const publicPost = interaction.options.getBoolean("public_post") ?? false;
    if (publicPost) {
      const postChannelId = watch.channelId || interaction.channelId;
      const postChannel = await interaction.guild.channels
        .fetch(postChannelId)
        .catch(() => null);
      if (postChannel && postChannel.isTextBased()) {
        const mention = watch.mentionRoleId ? `<@&${watch.mentionRoleId}>` : undefined;
        await postChannel.send({ content: mention, embeds: [embed] }).catch(() => {});
        watch.lastPostedAt = Date.now();
        guildState.kinah = watch;
        saveState();
      }
    }

    await interaction.editReply({
      embeds: [embed, buildKinahStatusEmbed(guildState)],
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
    const embed = await lookupCharacterEmbed(query, {
      race: raceFilter || null,
      classKeyword: classKeyword || null,
    });
    await interaction.editReply({
      embeds: [embed],
    });
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

  setInterval(() => {
    runKinahTicker(client).catch((err) =>
      console.error("[kinah-ticker]", err.message)
    );
  }, CONFIG.kinahTickerMs);

  runBossTicker(client).catch(() => {});
  runNoticeTicker(client).catch(() => {});
  runKinahTicker(client).catch(() => {});
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

client.on("messageCreate", async (message) => {
  if (message.author?.bot) return;
  const content = (message.content || "").trim();
  if (!content) return;

  const lower = content.toLowerCase();
  const prefix = lower.startsWith("!char ")
    ? "!char "
    : lower.startsWith("!character ")
    ? "!character "
    : null;
  if (!prefix) return;

  const query = content.slice(prefix.length).trim();
  if (!query) {
    await message
      .reply({
        content: "Usage: `!char <name or profile URL>`",
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
    return;
  }

  let loadingMessage = null;
  try {
    loadingMessage = await message.reply({
      content: "🔍 Searching character info...",
      allowedMentions: { repliedUser: false },
    });
  } catch (_) {}

  const embed = await lookupCharacterEmbed(query);
  if (loadingMessage) {
    await loadingMessage.edit({ content: "", embeds: [embed] }).catch(() => {});
    return;
  }

  await message
    .reply({
      embeds: [embed],
      allowedMentions: { repliedUser: false },
    })
    .catch(() => {});
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
