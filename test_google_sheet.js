#!/usr/bin/env node
/**
 * 구글 시트 연동 확인 스크립트
 * tetra_sync.js와 동일한 credentials, SHEET_ID, 시트 고정값 사용
 */
try { require('dotenv').config(); } catch (_) {}

const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json.json');
const SHEET_ID = process.env.SHEET_ID || '1-SscA750TuYUd6BcGQF-hXXO_5HI5HxpGkmYo_JXnR8';
const RUNTIME_STATE_SHEET_NAME = process.env.RUNTIME_STATE_SHEET_NAME || 'Bot_Runtime_State';

const REGION_CODES = ['PH', 'IN', 'NP', 'CH', 'TW'];

async function readRange(sheets, range) {
    try {
        const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
        return { ok: true, values: data?.values || [] };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function main() {
    console.log('📋 TETRA Sync — 구글 시트 고정값 검증\n');

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

    try {
        const meta = await sheets.spreadsheets.get({
            spreadsheetId: SHEET_ID,
            fields: 'properties.title,sheets.properties.title',
        });
        const titles = (meta.data?.sheets || []).map(s => s.properties?.title).filter(Boolean);
        console.log(`✅ 스프레드시트: "${meta.data?.properties?.title || SHEET_ID}"`);
        console.log(`   시트: ${titles.join(', ')}\n`);
    } catch (err) {
        console.error('❌ 스프레드시트 접근 실패:', err.message);
        process.exit(1);
    }

    // 1. Bot_Runtime_State (A2:B20 로드 / A2:B7 flush)
    const runtime = await readRange(sheets, `${RUNTIME_STATE_SHEET_NAME}!A2:B20`);
    if (runtime.ok) {
        const keys = new Set((runtime.values || []).map(r => String(r[0] || '').trim()));
        const required = ['panel_state_json', 'kinah_state_json', 'aon_translate_state_json', 'boss_state_json', 'mvp_schedule_state_json', 'updated_at'];
        const missing = required.filter(k => !keys.has(k));
        console.log(`📦 Bot_Runtime_State (${RUNTIME_STATE_SHEET_NAME})`);
        console.log(`   ${missing.length === 0 ? '✅' : '⚠️'} 키: ${required.join(', ')}`);
        if (missing.length) console.log(`   누락: ${missing.join(', ')}`);
        results[missing.length ? 'fail' : 'ok'].push('Bot_Runtime_State');
    } else {
        console.log(`❌ Bot_Runtime_State: ${runtime.error}`);
        results.fail.push('Bot_Runtime_State');
    }
    console.log('');

    // 2. Payment Log (A:G = Date, Type, Tag, Amount, Currency, Reason, Status)
    const payment = await readRange(sheets, "'Payment Log'!A1:G2");
    console.log(`💎 Payment Log`);
    console.log(`   ${payment.ok ? `✅ 읽기 가능 (A:G)` : `❌ ${payment.error}`}`);
    results[payment.ok ? 'ok' : 'fail'].push('Payment Log');
    console.log('');

    // 3. Daily_Log_{CODE} (A:G) — Start/End report format
    const expectedDailyHeader = ['Timestamp', 'Worker', 'Type', 'LoginAt', 'LogoutAt', 'Metric', 'Details'];
    console.log(`📋 Daily_Log_* (Start/End 리포트, A:G)`);
    for (const code of REGION_CODES) {
        const r = await readRange(sheets, `Daily_Log_${code}!A1:G1`);
        if (!r.ok) {
            console.log(`   Daily_Log_${code}: ⚠️ (${r.error})`);
            results.fail.push(`Daily_Log_${code}`);
            continue;
        }
        const header = (r.values?.[0] || []).map(v => String(v || '').trim());
        const same = expectedDailyHeader.every((v, i) => String(header[i] || '') === v);
        console.log(`   Daily_Log_${code}: ${same ? '✅ header ok' : '⚠️ header mismatch'}`);
        if (!same) {
            console.log(`      expected: ${expectedDailyHeader.join(' | ')}`);
            console.log(`      actual  : ${(header.length ? header : ['(empty)']).join(' | ')}`);
        }
        results[same ? 'ok' : 'fail'].push(`Daily_Log_${code}`);
    }
    console.log('');

    // 4. Salary_Log_{CODE} (A:D) — 급여 확정
    console.log(`💰 Salary_Log_* (급여 확정, A:D)`);
    for (const code of REGION_CODES) {
        const r = await readRange(sheets, `Salary_Log_${code}!A1:D1`);
        const status = r.ok ? '✅' : '⚠️';
        console.log(`   Salary_Log_${code}: ${status}${!r.ok ? ` (${r.error})` : ''}`);
        results[r.ok ? 'ok' : 'fail'].push(`Salary_Log_${code}`);
    }
    console.log('');

    // 5. Member_List_{CODE} (A:G) — 가입/캐릭터 인증
    console.log(`👤 Member_List_* (가입·캐릭터 인증, A:G)`);
    for (const code of REGION_CODES) {
        const r = await readRange(sheets, `Member_List_${code}!A1:G1`);
        const status = r.ok ? '✅' : '⚠️';
        console.log(`   Member_List_${code}: ${status}${!r.ok ? ` (${r.error})` : ''}`);
        results[r.ok ? 'ok' : 'fail'].push(`Member_List_${code}`);
    }
    console.log('');

    // 6. 회원목록정리 (A:I) — member_list_organize
    const organized = await readRange(sheets, '회원목록정리!A1:I1');
    console.log(`📚 회원목록정리 (A:I)`);
    console.log(`   ${organized.ok ? '✅ 읽기 가능' : `⚠️ ${organized.error}`}`);
    results[organized.ok ? 'ok' : 'fail'].push('회원목록정리');
    console.log('');

    // 요약
    console.log('─'.repeat(50));
    const failCount = Array.isArray(results.fail) ? results.fail.length : 0;
    if (failCount === 0) {
        console.log('✅ 모든 시트 고정값 정상');
    } else {
        console.log(`⚠️ ${failCount}개 시트 접근 실패: ${results.fail.join(', ')}`);
        console.log('   → 구글 시트에서 해당 시트를 생성하고 열 형식을 맞추세요.');
    }
}

main().catch(err => {
    console.error('테스트 실패:', err);
    process.exit(1);
});
