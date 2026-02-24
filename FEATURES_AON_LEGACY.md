# AON English Bot 기능 설명

- ✅ **tetra_sync에 포함됨**: character, item, collection, build
- ❌ **미포함**: invite, verify, party_recruit, notice_set (필요 시 이식 가능)

---

## 1. Invite (초대 링크 자동화)
**커맨드**: `/invite_channel_set`, `/invite_create`, `/invite_status`

- **invite_channel_set**: 초대 링크를 게시할 채널 지정
- **invite_create**: 초대 링크 생성 후 지정 채널에 게시  
  - 옵션: 대상 채널, 최대 사용 횟수, 만료 시간(시간), 비공개 게시 여부
- **invite_status**: 현재 초대 설정 확인

**용도**: 디스코드 서버 초대 링크를 봇이 만들어 지정 채널에 자동 포스팅

---

## 2. Verify (스크린샷 인증 시스템)
**커맨드**: `/myinfo_register`, `/temp_role_set`, `/verified_role_set`, `/verify_channel_set`, `/verify_log_set`, `/verification_status`

- **myinfo_register**: 유저가 실행 → 캐릭터명 입력 → 전용 인증 채널 생성 → 스크린샷 업로드
- **temp_role_set**: 인증 전 부여할 임시 역할
- **verified_role_set**: 인증 후 부여할 역할
- **verify_channel_set**: 인증 채널이 생성될 카테고리
- **verify_log_set**: 인증 승인/거절 로그 채널
- **verification_status**: 현재 인증 설정 확인

**용도**: 캐릭터 인증용 스크린샷을 개인 채널에서 올리면, 스태프가 Approve/Reject 버튼으로 처리

---

## 3. Party Recruit (파티 모집 패널)
**커맨드**: `/profile_set`, `/party_recruit`

- **profile_set**: 클래스, 레벨, 메모 등 파티 프로필 등록
- **party_recruit**: 파티 모집용 패널 생성  
  - 옵션: 제목, 최대 인원(2~12), 활동 설명  
  - Join / Leave / Close 버튼 지원

**용도**: 버튼 클릭으로 파티 참여/탈퇴/마감이 가능한 모집 게시물 생성

---

## 4. Character (캐릭터 검색)
**커맨드**: `/character`

- 이름 또는 프로필 URL로 검색
- 옵션: 종족(elyos/asmodian), 클래스 키워드 필터
- Talentbuilds, Shugo.GG 등 외부 사이트 링크 제공

**용도**: AION2 캐릭터 정보 조회

---

## 5. Item (아이템 검색)
**커맨드**: `/item`

- 키워드로 아이템 검색
- Talentbuilds, Shugo.GG, Google 사이트 검색 링크 제공

**용도**: 아이템 정보 검색 링크 제공

---

## 6. Collection (세트 효과 검색)
**커맨드**: `/collection`

- 스탯 키워드(예: crit)로 장비 세트 검색
- Talentbuilds, Shugo.GG 링크 제공

**용도**: 원하는 스탯이 붙은 세트 장비 찾기

---

## 7. Build (빌드/스킬트리 검색)
**커맨드**: `/build`

- 클래스·빌드 키워드로 검색
- Talentbuilds, Shugo.GG, YouTube 빌드 검색 링크 제공

**용도**: 빌드 가이드 및 스킬트리 참고 자료 찾기

---

## 8. Notice Set (공지 릴레이)
**커맨드**: `/notice_set`, `/notice_status`

- 지정 URL(NEWS, Update_Note, EVENT 등)을 주기적으로 크롤링
- 새 공지가 생기면 지정 채널에 임베드로 발행
- 카테고리별로 채널 선택 가능

**용도**: AON 한국 공지를 자동으로 영어 채널로 릴레이
