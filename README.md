# Aon English Discord Bot

English-focused Discord bot inspired by the feature set shown at:
https://koreanbots.dev/bots/1436590099235340410

## Implemented Features

1. **Field Boss Manager**
   - `/preset` (elyos/asmodian/combined)
   - `/boss` status board
   - `/cut` smart next-spawn calculation
   - `/server_open` mass timer reset
   - `/boss_add`, `/boss_remove` for custom tracking
   - 10-minute warning + spawn-now alerts

2. **Live Notice Relay**
   - `/notice_set` to configure target channel/category
   - `/notice_status` to inspect current settings
   - Feed crawler with source/category filtering

3. **Party Recruit System**
   - `/profile_set` for player profile registration
   - `/party_recruit` panel with one-click buttons
   - Join/Leave/Close actions
   - Persistent data across bot restarts

4. **Search Utilities**
   - `/character` (name or profile URL)
   - `/item` (quick lookup links)

## Environment Variables

See `.env.example`:

- `DISCORD_TOKEN` (required)
- `PORT` (optional, keep-alive HTTP)
- `BOSS_WARNING_MINUTES`
- `BOSS_TICKER_MS`
- `NOTICE_TICKER_MS`
- `NOTICE_SOURCES_JSON` (optional custom source list)

## Run

```bash
npm install
npm start
```

## Notes

- Runtime state is persisted to `bot_state.json`.
- Command registration is guild-scoped for immediate updates.
