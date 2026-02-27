# Aon English Discord Bot

English-focused Discord bot inspired by the feature set shown at:
https://koreanbots.dev/bots/1436590099235340410

## Implemented Features

1. **Smart Verification System**
   - `/myinfo_register character_name:<name>` — Creates private verification channel
   - User uploads in-game screenshot; staff clicks **Approve** or **Reject**
   - On Approve: character name added to Member_List_* → 회원목록정리 (column G)
   - Admin setup: `/verify_channel_set category:<category>` — Where verification channels are created
   - `/join_verify` — Optional character name field; also adds to 회원목록정리

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

8. **Guides**
   - **`/guide`** — Member guide (English), all members can post, no Admin required
   - **`/panel type:guide_ko`** `guide_en` — Full guides (Admin only)

11. **Daily Report v2 (Submit button + numeric modal)**
   - `/panel type:report` posts a single **📊 Submit Report** button
   - User click flow: button -> select `Start/End + region + team` -> modal
   - **Start Kinah Team**: auto login time + `start_kinah` + `memo`
   - **End Kinah Team**: auto logout time + `end_kinah` + `spent_kinah` + `memo`
   - **Start Level-Up Team**: auto login time + `start_level` + `start_cp` + `memo`
   - **End Level-Up Team**: auto logout time + `end_level` + `end_cp` + `memo`
   - Numeric-only validation for required amount/level/cp fields
   - End Kinah calculations (using saved Start values):
     - `Net Profit = End - Start - Spent`
     - `On-hand Delta = End - Start`
     - `Gross Farmed = On-hand Delta + Spent`
   - End Level-Up calculations (using saved Start values):
     - `Level Gain = End Level - Start Level`
     - `CP Gain = End CP - Start CP`

9. **Global Trading Hub (Anti-Scam Escrow)**
   - `/market_setup market_channel:<channel> ticket_category:<category> admin_role:<role> fee_percent:<0-20>` (Admin)
   - `/market_status` — Check escrow setup and open listing/ticket counts
   - `/wts amount:<kinah> price:<total> currency:<USD|KRW|PHP|EUR|JPY>` — Post WTS listing
   - `/wtb amount:<kinah> price:<total> currency:<USD|KRW|PHP|EUR|JPY>` — Post WTB listing
   - Listing button creates private 3-party escrow ticket (buyer + seller + admin role)
   - Ticket workflow buttons:
     - **Hold Confirmed (Admin)** → **Payment Confirmed (Seller)** → **Complete + Trust (Admin)**
   - On complete: buyer/seller trust score auto +1, tier role sync (if configured), ticket auto-closes
   - Trust commands:
     - `/trust [user]` — View trust score and tier
     - `/trust_add user:<user> points:<-10~50> reason:<text>` (Admin)
     - `/trust_role_set tier:<bronze|silver|gold> role:<role>` (Admin)

10. **Payment Proof OCR -> Google Sheet (No ticket required)**
   - `/payment_ocr_set channel:<channel> enabled:true/false min_confidence:<0-100>` (Admin)
   - `/payment_ocr_status` — View OCR automation status
   - Users upload payment receipt images in configured channel
   - Bot OCR parses amount/currency/reference/time and appends to `'Payment Log'!A:G`
   - Row type: `MEMBER_CONFIRM_OCR`, status:
     - `OCR_AUTO_PENDING_REVIEW`
     - `OCR_LOW_CONFIDENCE (<n>%)`

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

## Notes

- Runtime state is persisted to `bot_state.json`.
- Command registration is guild-scoped for immediate updates.
