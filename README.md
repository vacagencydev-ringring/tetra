# TETRA Sync Bot

Discord 리포트/급여 관리 봇 (Google Sheets 연동)

## 기능
- **일일 리포트**: Kinah / Level-Up 팀 (PH/ID 구분)
- **급여 확인**: PH/ID 버튼 1클릭 확인
- **!confirm**: 회원 입금 확인 (스크린샷 선택)
- **!char**: 캐릭터 검색 (plaync)

## 설정
1. `credentials.json.json` - Google Service Account 키
2. `tetra_sync.js` 내 CONFIG - TOKEN, SHEET_ID, 채널 ID

## Render 배포
- `npm start` → `node tetra_sync.js`
- UptimeRobot으로 5분마다 Ping하여 Sleep 방지
