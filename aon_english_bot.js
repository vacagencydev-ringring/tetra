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
    notices: {
      channelId: null,
      categories: ["all"],
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
  g.profiles = g.profiles || {};
  g.parties = g.parties || {};
  g.notices = g.notices || { channelId: null, categories: ["all"] };
  g.notices.categories = Array.isArray(g.notices.categories)
    ? g.notices.categories
    : ["all"];
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
  const sorted = bosses.sort((a, b) => {
    const aSpawn = a.nextSpawnAt || Number.MAX_SAFE_INTEGER;
    const bSpawn = b.nextSpawnAt || Number.MAX_SAFE_INTEGER;
    return aSpawn - bSpawn;
  });
  const lines = sorted.map((boss) => {
    const next = boss.nextSpawnAt ? toDiscordTime(boss.nextSpawnAt) : "N/A";
    return `- **${boss.name}** (${boss.respawnMinutes}m) -> ${statusForBoss(
      boss,
      now
    )} | Next: ${next}`;
  });
  return new EmbedBuilder()
    .setTitle("Field Boss Board")
    .setDescription(lines.join("\n").slice(0, 3900) || "No bosses configured.")
    .setColor(0x2563eb)
    .setTimestamp();
}

function buildSingleBossEmbed(boss) {
  const next = boss.nextSpawnAt ? toDiscordTime(boss.nextSpawnAt) : "N/A";
  const lastCut = boss.lastCutAt ? toDiscordTime(boss.lastCutAt) : "N/A";
  return new EmbedBuilder()
    .setTitle(`Boss: ${boss.name}`)
    .setDescription(
      [
        `Respawn: ${boss.respawnMinutes} minutes`,
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
      const channelId = guildState.bossChannelId;
      if (!channelId) continue;
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) continue;

      for (const boss of Object.values(guildState.bosses || {})) {
        if (!boss.nextSpawnAt) continue;
        const remaining = boss.nextSpawnAt - now;
        const target = boss.nextSpawnAt;

        if (
          remaining <= CONFIG.bossWarningMinutes * 60_000 &&
          remaining > 0 &&
          boss.warnedForSpawnAt !== target
        ) {
          await channel
            .send(
              `Boss warning: **${boss.name}** spawns in about ${formatDuration(
                remaining
              )}.`
            )
            .catch(() => {});
          boss.warnedForSpawnAt = target;
          changed = true;
        }

        if (remaining <= 0 && boss.announcedForSpawnAt !== target) {
          await channel
            .send(
              `Boss alert: **${boss.name}** should be up now. Record with \`/cut boss_name:${boss.name}\` after kill.`
            )
            .catch(() => {});
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

async function searchCharacterByName(name) {
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

  const first = list[0];
  const [pcMap, serverMap] = await Promise.all([getPcData(), getServerData()]);

  return {
    name: first.name.trim(),
    level: String(first.level),
    server: serverMap[first.serverId] || first.serverName || "N/A",
    race: first.race === 1 ? "Elyos" : first.race === 2 ? "Asmodian" : "N/A",
    className: pcMap[first.pcId] || "N/A",
    imageUrl: first.profileImageUrl
      ? PROFILE_IMG_BASE + first.profileImageUrl
      : null,
    url: `https://aion2.plaync.com/ko-kr/characters/${first.serverId}/${first.characterId}`,
    resultCount: list.length,
    combatPower: null,
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
          ? `Showing first result out of ${info.resultCount}`
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

const commandPayload = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show setup and command guide"),
  new SlashCommandBuilder()
    .setName("preset")
    .setDescription("One-click setup for field boss presets")
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("Preset mode")
        .setRequired(true)
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
    ),
  new SlashCommandBuilder()
    .setName("item")
    .setDescription("Lookup an item by keyword")
    .addStringOption((opt) =>
      opt.setName("query").setDescription("Item name").setRequired(true)
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
          "3) Run `/notice_set` to enable announcement relay.",
          "4) Run `/profile_set` once, then create `/party_recruit` panels.",
          "",
          "Main commands:",
          "- /preset /boss /cut /server_open /boss_add /boss_remove",
          "- /notice_set /notice_status",
          "- /profile_set /party_recruit",
          "- /character /item",
        ].join("\n")
      )
      .setColor(0x2563eb);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (interaction.commandName === "preset") {
    if (!hasManageGuild(interaction)) {
      await safeEphemeral(interaction, "Manage Server permission is required.");
      return;
    }
    const mode = interaction.options.getString("mode", true);
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
      embeds: [buildSingleBossEmbed(resolved.boss)],
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
    boss.nextSpawnAt = boss.lastCutAt + boss.respawnMinutes * 60_000;
    boss.warnedForSpawnAt = null;
    boss.announcedForSpawnAt = null;
    saveState();

    await interaction.reply({
      content: `Cut recorded for **${boss.name}**.\nNext spawn: ${toDiscordTime(
        boss.nextSpawnAt
      )}`,
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
      boss.nextSpawnAt = parsed.getTime() + boss.respawnMinutes * 60_000;
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
      else info = await searchCharacterByName(query);

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
