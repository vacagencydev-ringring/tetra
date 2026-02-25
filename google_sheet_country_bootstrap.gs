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
 *
 * Default country codes include current + newly added regions.
 */

const COUNTRY_CODES = ['PH', 'ID', 'IN', 'NP', 'CH', 'TW'];

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
 * Create all required country sheets if missing.
 */
function setupCountrySheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active spreadsheet found.');

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

  const summary = [
    `Created: ${created.length}`,
    `Already existed: ${existing.length}`,
    '',
    created.length ? `New sheets:\n- ${created.join('\n- ')}` : 'No new sheets were required.',
  ].join('\n');

  Logger.log(summary);
  ss.toast(`Country sheet setup done. Created ${created.length} sheet(s).`, 'TETRA Setup', 7);
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
    .addItem('Install daily auto-setup trigger', 'installDailySetupTrigger')
    .addItem('Remove daily auto-setup trigger', 'removeDailySetupTrigger')
    .addToUi();
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
