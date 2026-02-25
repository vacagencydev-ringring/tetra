# Aon English Discord Bot

English-focused Discord bot inspired by the feature set shown at:
https://koreanbots.dev/bots/1436590099235340410

> Active runtime entrypoint: `tetra_sync.js` (single-bot operation)

## Implemented Features

1. **Smart Verification System**
   - `/myinfo_register` creates private verification channel
   - Admin review buttons: Approve / Reject
   - Admin setup commands:
     - `/temp_role_set`
     - `/verified_role_set`
     - `/verify_channel_set`
     - `/verify_log_set`
     - `/verification_status`

2. **Field Boss Manager**
   - `/preset` (elyos/asmodian/combined)
   - `/boss` status board
   - `/cut` smart next-spawn calculation
   - `/server_open` mass timer reset
   - `/boss_add`, `/boss_remove` for custom tracking
   - 10-minute warning + spawn-now alerts
   - `/boss_alert_mode` (public channel or DM)
   - `/boss_event_multiplier` for event-time shorter respawns

3. **Live Notice Relay**
   - `/notice_set` to configure target channel/category
   - `/notice_status` to inspect current settings
   - Category auto-routing supported (per-category channel split)
   - Feed crawler with source/category filtering
   - AON bot message translation:
     - `/aon_translate_set`
     - `/aon_translate_source`
     - `/aon_translate_status`

4. **Party Recruit System**
   - `/profile_set` for player profile registration
   - `/party_recruit` panel with one-click buttons
   - Join/Leave/Close actions
   - Persistent data across bot restarts

5. **Invite Code / Link Automation**
   - `/invite_channel_set` for invite post channel
   - `/invite_create` to generate invite code/link with expiry/uses
   - `/invite_status` to inspect invite automation setup

6. **Kinah Rate Crawler**
   - `/kinah_watch_preset` for quick setup:
     - `itembay_aion2`
     - `itemmania_aion2`
     - `dual_market_aion2`
   - `/kinah_watch_set` to configure source/channel/selector/regex
   - `/kinah_watch_now` for immediate fetch
   - `/kinah_watch_status` and `/kinah_watch_stop`
   - Auto posts only on detected rate changes

7. **Search Utilities**
   - `/character` (name or profile URL + race/class filter)
   - Legacy alias: `!char <name>` / `!character <name>`
   - `/item` (quick lookup links)
   - `/collection` (stat-based lookup links)
   - `/build` (build/skill-tree lookup links)

8. **Guide Panel Command**
   - `/guide` posts a full command guide panel (capture-style)
   - `/guide public:false` sends it as ephemeral to yourself

## Environment Variables

See `.env.example`:

- `DISCORD_TOKEN` (required)
- `PORT` (optional, keep-alive HTTP)
- `BOSS_WARNING_MINUTES`
- `BOSS_TICKER_MS`
- `NOTICE_TICKER_MS`
- `KINAH_TICKER_MS`
- `NOTICE_SOURCES_JSON` (optional custom source list)

## Run

```bash
npm install
npm start
```

## Google Sheets Auto-Create (for added country sheets)

Use `google_sheet_country_bootstrap.gs` in Google Apps Script to automatically create:

- `Daily_Log_PH`, `Daily_Log_ID`, `Daily_Log_IN`, `Daily_Log_NP`, `Daily_Log_CH`, `Daily_Log_TW`
- `Salary_Log_PH`, `Salary_Log_ID`, `Salary_Log_IN`, `Salary_Log_NP`, `Salary_Log_CH`, `Salary_Log_TW`
- `Member_List_PH`, `Member_List_ID`, `Member_List_IN`, `Member_List_NP`, `Member_List_CH`, `Member_List_TW`
- `회원목록정리` (country-merged member organizer sheet)

Quick setup:

1. Open your Google Spreadsheet.
2. Go to **Extensions -> Apps Script**.
3. Paste `google_sheet_country_bootstrap.gs` code.
4. Run `setupCountrySheets()` once (authorize when prompted).
5. Run `refreshMemberListOrganized()` whenever you want to rebuild merged member rows.
6. Optional: run `installDailySetupTrigger()` for daily auto-check.

## Notes

- Runtime state is persisted to `bot_state.json`.
- Command registration is guild-scoped for immediate updates.
