# TETRA Sync 구글 시트 고정값 명세

## 검증 결과: ✅ 모든 시트 정상

`node test_google_sheet.js` 로 확인 가능합니다.

---

## 시트 목록 및 컬럼 형식

| 시트명 | 범위 | 용도 | 컬럼 (A→) |
|--------|------|------|-----------|
| **Bot_Runtime_State** | A2:B20 | 봇 상태 (패널·키나·번역 등) | panel_state_json, kinah_state_json, aon_translate_state_json, boss_state_json, mvp_schedule_state_json, updated_at |
| **Payment Log** | A:G | 입금 확인 | Date, Type, Tag, Amount, Currency, Reason, Status |
| **Daily_Log_PH** | A:G | PH 일일 리포트 | Timestamp, Worker, Type(Kinah/LevelUp), Login, Logout, Profit/Progress, (빈칸) |
| **Daily_Log_IN** | A:G | IN 일일 리포트 |同上 |
| **Daily_Log_NP** | A:G | NP 일일 리포트 |同上 |
| **Daily_Log_CH** | A:G | CH 일일 리포트 |同上 |
| **Daily_Log_TW** | A:G | TW 일일 리포트 |同上 |
| **Salary_Log_PH** | A:D | PH 급여 확정 | Timestamp, Worker, Confirmed, (빈칸) |
| **Salary_Log_IN** ~ **TW** | A:D | 급여 확정 |同上 |
| **Member_List_PH** | A:G | PH 회원 목록 | User ID, Discord Tag, Display Name, Country, Role, Joined At, Character Name |
| **Member_List_IN** ~ **TW** | A:G | 회원 목록 |同上 |
| **회원목록정리** | A:I | 통합 회원 (member_list_organize) | Country, User ID, Discord Tag, Display Name, Role, Joined At, Character Name, Source Sheet, Refreshed At |

---

## Bot_Runtime_State — 멀티 서버 병합

한 서버에서 설정해도 다른 서버 설정이 덮어쓰이지 않도록 **guild별 병합** 적용:

- **kinah, aonTranslate, boss, mvp**: guildId별로 시트 데이터 유지, 현재 인스턴스만 갱신
- **panel**: welcomeConfig, verifyCategoryIdByGuild를 guild별로 병합
- **verifyCategoryIdByGuild**: 서버별 인증 채널 카테고리 (`/verify_channel_set`)

---

## 환경 변수

- `SHEET_ID` — 스프레드시트 ID (기본값 포함)
- `RUNTIME_STATE_SHEET_NAME` — 런타임 시트명 (기본: Bot_Runtime_State)
- `ENABLE_SHEETS_STATE` — 시트 연동 사용 여부 (true/false)
