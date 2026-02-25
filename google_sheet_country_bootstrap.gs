/**
 * TETRA country sheet bootstrap for Google Sheets (Apps Script).
 *
 * Usage:
 * 1) Open your target Google Spreadsheet.
 * 2) Extensions -> Apps Script.
 * 3) Paste this file and save.
 * 4) Run setupCountrySheets() once.
 *
 * This script creates missing sheets for each country code:
 * - Daily_Log_<CODE>
 * - Salary_Log_<CODE>
 * - Member_List_<CODE>
 * - 회원목록정리 (country-merged member organizer sheet)
 *
 * Default country codes include current + newly added regions.
 */

const COUNTRY_CODES = ['PH', 'ID', 'IN', 'NP', 'CH', 'TW'];
const ORGANIZED_MEMBER_SHEET_NAME = '회원목록정리';
const ORGANIZED_MEMBER_HEADERS = [
  'Country',
  'User ID',
  'Discord Tag',
  'Display Name',
  'Role',
  'Joined At',
  'Source Sheet',
  'Refreshed At',
];

const SHEET_TEMPLATES = [
  {
    prefix: 'Daily_Log_',
    headers: ['Timestamp', 'Worker', 'Team', 'Login', 'Logout', 'Progress', 'Memo'],
    minColumns: 7,
  },
  {
    prefix: 'Salary_Log_',
    headers: ['Timestamp', 'Worker', 'Status', 'Memo'],
    minColumns: 4,
  },
  {
    prefix: 'Member_List_',
    headers: ['User ID', 'Discord Tag', 'Display Name', 'Country', 'Role', 'Joined At'],
    minColumns: 6,
  },
];

/**
 * Optional default spreadsheet ID (for Web App mode).
 * You can also set Script Properties -> SHEET_ID instead.
 */
const DEFAULT_SPREADSHEET_ID = '';

/**
 * Create all required country sheets if missing.
 */
function setupCountrySheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active spreadsheet found.');
  return setupCountrySheetsForSpreadsheet_(ss);
}

function setupCountrySheetsForSpreadsheet_(ss) {
  if (!ss) throw new Error('No spreadsheet found.');

  const created = [];
  const existing = [];

  COUNTRY_CODES.forEach((code) => {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) return;

    SHEET_TEMPLATES.forEach((tpl) => {
      const sheetName = `${tpl.prefix}${normalizedCode}`;
      const wasCreated = ensureSheetWithHeader_(ss, sheetName, tpl.headers, tpl.minColumns);
      (wasCreated ? created : existing).push(sheetName);
    });
  });

  const organizeCreated = ensureSheetWithHeader_(
    ss,
    ORGANIZED_MEMBER_SHEET_NAME,
    ORGANIZED_MEMBER_HEADERS,
    ORGANIZED_MEMBER_HEADERS.length
  );
  (organizeCreated ? created : existing).push(ORGANIZED_MEMBER_SHEET_NAME);
  const mergedRows = rebuildMemberListOrganized_(ss);

  const summary = [
    `Created: ${created.length}`,
    `Already existed: ${existing.length}`,
    `Organized member rows: ${mergedRows}`,
    '',
    created.length ? `New sheets:\n- ${created.join('\n- ')}` : 'No new sheets were required.',
  ].join('\n');

  Logger.log(summary);
  ss.toast(`Country sheet setup done. Created ${created.length} sheet(s), merged ${mergedRows} member row(s).`, 'TETRA Setup', 7);
  return { created: created.length, existing: existing.length, mergedRows };
}

/**
 * Install a daily trigger to re-check missing sheets automatically.
 */
function installDailySetupTrigger() {
  removeDailySetupTrigger();
  ScriptApp.newTrigger('setupCountrySheets')
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();
}

/**
 * Remove existing daily setup triggers.
 */
function removeDailySetupTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach((trigger) => {
    if (trigger.getHandlerFunction() === 'setupCountrySheets') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/**
 * Add convenience menu in Google Sheets UI.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TETRA Setup')
    .addItem('Create country sheets now', 'setupCountrySheets')
    .addItem('Refresh organized member sheet', 'refreshMemberListOrganized')
    .addItem('Install daily auto-setup trigger', 'installDailySetupTrigger')
    .addItem('Remove daily auto-setup trigger', 'removeDailySetupTrigger')
    .addToUi();
}

/**
 * Rebuild the 회원목록정리 sheet from Member_List_<CODE> sheets.
 */
function refreshMemberListOrganized() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active spreadsheet found.');
  return refreshMemberListOrganizedForSpreadsheet_(ss);
}

function refreshMemberListOrganizedForSpreadsheet_(ss) {
  ensureSheetWithHeader_(
    ss,
    ORGANIZED_MEMBER_SHEET_NAME,
    ORGANIZED_MEMBER_HEADERS,
    ORGANIZED_MEMBER_HEADERS.length
  );
  const mergedRows = rebuildMemberListOrganized_(ss);
  ss.toast(`회원목록정리 refreshed. ${mergedRows} row(s).`, 'TETRA Setup', 7);
  return { mergedRows };
}

function ensureSheetWithHeader_(ss, sheetName, headers, minColumns) {
  let sheet = ss.getSheetByName(sheetName);
  let created = false;
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    created = true;
  }

  if (sheet.getMaxColumns() < minColumns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), minColumns - sheet.getMaxColumns());
  }

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  const currentHeader = headerRange.getValues()[0];
  const headerIsEmpty = currentHeader.every((cell) => !String(cell || '').trim());

  if (headerIsEmpty) {
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#E5E7EB');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, Math.max(headers.length, minColumns));
  }

  return created;
}

function rebuildMemberListOrganized_(ss) {
  const target = ss.getSheetByName(ORGANIZED_MEMBER_SHEET_NAME);
  if (!target) throw new Error(`${ORGANIZED_MEMBER_SHEET_NAME} sheet is missing.`);

  if (target.getMaxColumns() < ORGANIZED_MEMBER_HEADERS.length) {
    target.insertColumnsAfter(target.getMaxColumns(), ORGANIZED_MEMBER_HEADERS.length - target.getMaxColumns());
  }

  if (target.getLastRow() > 1) {
    target.getRange(2, 1, target.getLastRow() - 1, target.getMaxColumns()).clearContent();
  }

  const merged = [];
  COUNTRY_CODES.forEach((code) => {
    const sourceName = `Member_List_${code}`;
    const source = ss.getSheetByName(sourceName);
    if (!source || source.getLastRow() < 2) return;

    const rows = source.getRange(2, 1, source.getLastRow() - 1, 6).getValues();
    rows.forEach((row) => {
      const [userId, discordTag, displayName, country, role, joinedAt] = row;
      const hasData = row.some((cell) => String(cell || '').trim() !== '');
      if (!hasData) return;
      merged.push([
        String(country || code).trim().toUpperCase(),
        String(userId || '').trim(),
        String(discordTag || '').trim(),
        String(displayName || '').trim(),
        String(role || '').trim(),
        joinedAt || '',
        sourceName,
        new Date(),
      ]);
    });
  });

  // Deduplicate by Country + User ID (fallback to Discord Tag).
  const dedupedMap = new Map();
  merged.forEach((row) => {
    const country = row[0] || 'NA';
    const keyIdentity = row[1] || row[2] || row[3];
    const key = `${country}|${keyIdentity}`;
    dedupedMap.set(key, row);
  });

  const deduped = Array.from(dedupedMap.values()).sort((a, b) => {
    const byCountry = String(a[0] || '').localeCompare(String(b[0] || ''));
    if (byCountry !== 0) return byCountry;
    return String(a[3] || '').localeCompare(String(b[3] || ''));
  });

  if (deduped.length) {
    target.getRange(2, 1, deduped.length, ORGANIZED_MEMBER_HEADERS.length).setValues(deduped);
    target.autoResizeColumns(1, ORGANIZED_MEMBER_HEADERS.length);
  }

  return deduped.length;
}

/**
 * Web App endpoint:
 * - ?action=status
 * - ?action=setup&sheetId=YOUR_SHEET_ID
 * - ?action=refresh_member&sheetId=YOUR_SHEET_ID
 * - ?action=install_trigger
 * - ?action=remove_trigger
 */
function doGet(e) {
  return handleWebRequest_(e);
}

function doPost(e) {
  return handleWebRequest_(e);
}

function handleWebRequest_(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'status')
      .trim()
      .toLowerCase();

    if (action === 'status') {
      return jsonResponse_({
        ok: true,
        message: 'TETRA Apps Script endpoint is running.',
        actions: ['status', 'setup', 'refresh_member', 'install_trigger', 'remove_trigger'],
        countryCodes: COUNTRY_CODES,
      });
    }

    if (action === 'install_trigger') {
      installDailySetupTrigger();
      return jsonResponse_({ ok: true, action, message: 'Daily trigger installed.' });
    }

    if (action === 'remove_trigger') {
      removeDailySetupTrigger();
      return jsonResponse_({ ok: true, action, message: 'Daily trigger removed.' });
    }

    const ss = resolveSpreadsheet_(e);
    if (action === 'setup') {
      const result = setupCountrySheetsForSpreadsheet_(ss);
      return jsonResponse_({ ok: true, action, result });
    }

    if (action === 'refresh_member') {
      const result = refreshMemberListOrganizedForSpreadsheet_(ss);
      return jsonResponse_({ ok: true, action, result });
    }

    return jsonResponse_({
      ok: false,
      error: `Unknown action: ${action}`,
      allowed: ['status', 'setup', 'refresh_member', 'install_trigger', 'remove_trigger'],
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  }
}

function resolveSpreadsheet_(e) {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  const fromParam = String((e && e.parameter && e.parameter.sheetId) || '').trim();
  if (fromParam) return SpreadsheetApp.openById(fromParam);

  const fromProp =
    String(
      PropertiesService.getScriptProperties().getProperty('SHEET_ID') ||
        DEFAULT_SPREADSHEET_ID ||
        ''
    ).trim();
  if (fromProp) return SpreadsheetApp.openById(fromProp);

  throw new Error('No spreadsheet context. Add ?sheetId=... or set Script Property SHEET_ID.');
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj, null, 2)).setMimeType(
    ContentService.MimeType.JSON
  );
}
