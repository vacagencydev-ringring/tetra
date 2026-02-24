#!/usr/bin/env node
/**
 * 구글 시트 연동 확인 스크립트
 * tetra_sync.js와 동일한 credentials, SHEET_ID 사용
 */
try { require('dotenv').config(); } catch (_) {}

const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json.json');
const SHEET_ID = process.env.SHEET_ID || '1-SscA750TuYUd6BcGQF-hXXO_5HI5HxpGkmYo_JXnR8';
const RUNTIME_STATE_SHEET_NAME = process.env.RUNTIME_STATE_SHEET_NAME || 'Bot_Runtime_State';

async function main() {
    console.log('📋 TETRA Sync — 구글 시트 연동 테스트\n');

    if (!require('fs').existsSync(CREDENTIALS_PATH)) {
        console.error('❌ credentials.json.json 파일 없음:', CREDENTIALS_PATH);
        process.exit(1);
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const results = { ok: [], fail: [] };

    // 1. 스프레드시트 메타 조회 (시트 목록)
    try {
        const meta = await sheets.spreadsheets.get({
            spreadsheetId: SHEET_ID,
            fields: 'properties.title,sheets.properties.title',
        });
        const titles = (meta.data?.sheets || []).map(s => s.properties?.title).filter(Boolean);
        console.log(`✅ 스프레드시트 접근: "${meta.data?.properties?.title || SHEET_ID}"`);
        console.log(`   시트 목록 (${titles.length}개): ${titles.join(', ')}\n`);
        results.ok.push('spreadsheet.get');
    } catch (err) {
        console.error('❌ 스프레드시트 접근 실패:', err.message);
        results.fail.push({ test: 'spreadsheet.get', error: err.message });
        process.exit(1);
    }

    // 2. Bot_Runtime_State 시트 읽기
    try {
        const { data } = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${RUNTIME_STATE_SHEET_NAME}!A1:B5`,
        });
        const rows = data?.values || [];
        const map = new Map(rows.map(row => [String(row[0] || '').trim(), String(row[1] || '').trim()]));
        const hasPanel = map.has('panel_state_json');
        const hasKinah = map.has('kinah_state_json');
        const hasAon = map.has('aon_translate_state_json');
        const updatedAt = map.get('updated_at') || '(없음)';
        console.log('✅ Bot_Runtime_State 읽기 성공');
        console.log(`   panel_state_json: ${hasPanel ? '있음' : '없음'}`);
        console.log(`   kinah_state_json: ${hasKinah ? '있음' : '없음'}`);
        console.log(`   aon_translate_state_json: ${hasAon ? '있음' : '없음'}`);
        console.log(`   updated_at: ${updatedAt}\n`);
        results.ok.push('Bot_Runtime_State.read');
    } catch (err) {
        console.error(`❌ Bot_Runtime_State 읽기 실패:`, err.message);
        results.fail.push({ test: 'Bot_Runtime_State.read', error: err.message });
    }

    // 3. Payment Log 시트 존재 여부
    const meta2 = await sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
        fields: 'sheets.properties.title',
    });
    const allTitles = (meta2.data?.sheets || []).map(s => s.properties?.title).filter(Boolean);
    const hasPaymentLog = allTitles.some(t => t === 'Payment Log' || t === "'Payment Log'");
    const hasMemberList = allTitles.some(t => /^Member_List_/.test(t));
    const hasDailyLog = allTitles.some(t => /^Daily_Log_/.test(t));
    const hasSalaryLog = allTitles.some(t => /^Salary_Log_/.test(t));
    const hasOrganized = allTitles.some(t => t === '회원목록정리');

    console.log('📂 주요 시트 존재 여부');
    console.log(`   Payment Log: ${hasPaymentLog ? '✅' : '⚠️ 없음'}`);
    console.log(`   Member_List_*: ${hasMemberList ? '✅' : '⚠️ 없음'}`);
    console.log(`   Daily_Log_*: ${hasDailyLog ? '✅' : '⚠️ 없음'}`);
    console.log(`   Salary_Log_*: ${hasSalaryLog ? '✅' : '⚠️ 없음'}`);
    console.log(`   회원목록정리: ${hasOrganized ? '✅' : '⚠️ 없음'}`);

    console.log('\n' + '─'.repeat(40));
    if (results.fail.length === 0) {
        console.log('✅ 구글 시트 연동 정상');
    } else {
        console.log(`⚠️ ${results.fail.length}개 실패:`, results.fail.map(f => f.test).join(', '));
    }
}

main().catch(err => {
    console.error('테스트 실패:', err);
    process.exit(1);
});
