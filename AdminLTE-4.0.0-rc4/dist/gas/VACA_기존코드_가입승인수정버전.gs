/**
 * VACA & Vacamong Management System - 가입/승인 수정 버전
 * 기존 기능 유지 + register/getApprovedUsers/handleApproveUser 수정
 */

/** 영수증 저장용 Google Drive 폴더 ID (링크에서 폴더 열기 → URL의 폴더 ID). 별도 Google API 키 불필요. 스크립트 실행 계정이 해당 폴더에 편집 권한으로 접근 가능해야 함. */
var RECEIPT_DRIVE_FOLDER_ID = ''; // Drive 사용 시 폴더 ID 입력. 비우면 영수증은 ReceiptStorage 시트에만 저장
/** 워커 일일업무 이미지: Drive 폴더 ID. 비우면 시트(TaskImageStorage)에만 저장. */
var TASK_IMAGE_DRIVE_FOLDER_ID = ''; // 예: '1Fsv7lCxGrXSAoaLBE4sktCi8cy-zyzJz'
/** 첨부 이미지 base64 최대 길이 (약 2MB 상당, 초과 시 업로드 스킵) */
var MAX_ATTACHMENT_B64_LENGTH = 2800000;
/** 영수증 시트 저장 시 셀당 최대 문자 수 (시트 제한 5만자 이하) */
var RECEIPT_SHEET_CHUNK_SIZE = 45000;

/**
 * 스크립트 속성에서 GitHub 설정 조회.
 * [설정 방법] Apps Script 편집기 > 프로젝트 설정(톱니) > 스크립트 속성 >
 *   GITHUB_TOKEN = (GitHub Personal Access Token, repo 권한)
 *   GITHUB_REPO  = 저장소 (예: vacagencydev-ringring/tetra)
 * 토큰은 코드에 넣지 말고 반드시 스크립트 속성에만 저장하세요.
 * @returns {{ token: string, repo: string }|null}
 */
function getGitHubConfig() {
  try {
    var props = PropertiesService.getScriptProperties();
    var token = (props.getProperty('GITHUB_TOKEN') || '').toString().trim();
    var repo = (props.getProperty('GITHUB_REPO') || '').toString().trim();
    var branch = (props.getProperty('GITHUB_BRANCH') || 'main').toString().trim() || 'main';
    if (token && repo) return { token: token, repo: repo, branch: branch };
  } catch (e) {}
  return null;
}

/**
 * GitHub 저장소에 이미지 파일 업로드. (스크립트 속성 GITHUB_TOKEN, GITHUB_REPO 필요)
 * @param {string} base64Data - data:image/xxx;base64,... 또는 순수 base64
 * @param {string} filePath - 저장 경로 예: receipts/exp123.jpg
 * @param {string} [mimeType] - image/jpeg, image/png 등
 * @returns {{ url: string, error: string }} 성공 시 url에 raw URL, 실패 시 error에 사유
 */
function uploadImageToGitHub(base64Data, filePath, mimeType) {
  var config = getGitHubConfig();
  if (!config || !filePath) return { url: '', error: 'GITHUB_TOKEN 또는 GITHUB_REPO 스크립트 속성이 없습니다.' };
  try {
    var raw = (base64Data || '').toString().trim().replace(/\s/g, '');
    if (!raw) return { url: '', error: '이미지 데이터가 비어 있습니다.' };
    var dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/);
    var base64 = (dataUrlMatch ? dataUrlMatch[2] : raw).replace(/\s/g, '');
    var repo = String(config.repo).trim().replace(/\.git$/i, '');
    if (!repo) return { url: '', error: 'GITHUB_REPO가 비어 있습니다. (예: vacagencydev-ringring/tetra)' };
    var pathClean = String(filePath).trim().replace(/^\/+/, '');
    var apiUrl = 'https://api.github.com/repos/' + repo + '/contents/' + pathClean;
    var branch = (config.branch || 'main').toString().trim() || 'main';
    var payload = {
      message: 'Add image ' + pathClean,
      content: base64,
      branch: branch
    };
    var options = {
      method: 'put',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + config.token.trim(),
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    var resp = UrlFetchApp.fetch(apiUrl, options);
    var code = resp.getResponseCode();
    var body = resp.getContentText();
    if (code !== 200 && code !== 201) {
      var errMsg = code + ' ';
      try {
        var errJson = JSON.parse(body);
        if (errJson.message) errMsg += errJson.message;
        else errMsg += body.slice(0, 200);
      } catch (_) { errMsg += body.slice(0, 200); }
      Logger.log('uploadImageToGitHub: ' + errMsg);
      return { url: '', error: 'GitHub: ' + errMsg };
    }
    var json = JSON.parse(body);
    var downloadUrl = (json.content && json.content.download_url) ? json.content.download_url : '';
    if (!downloadUrl) downloadUrl = 'https://raw.githubusercontent.com/' + repo + '/' + branch + '/' + pathClean;
    return { url: downloadUrl, error: '' };
  } catch (e) {
    var msg = (e.message || e.toString()).slice(0, 300);
    Logger.log('uploadImageToGitHub: ' + msg);
    return { url: '', error: 'GitHub 요청 오류: ' + msg };
  }
}

/**
 * 비공개 GitHub 저장소에서 파일 내용 조회. (바로가기용 - raw URL 노출 없이 GAS가 대신 가져옴)
 * @param {string} filePath - 예: receipts/exp123.jpg
 * @returns {{ mime: string, base64: string }|null}
 */
function fetchFileFromGitHub(filePath) {
  var config = getGitHubConfig();
  if (!config || !filePath) return null;
  try {
    var repo = String(config.repo).trim().replace(/\.git$/i, '');
    var pathClean = String(filePath).trim().replace(/^\/+/, '');
    var apiUrl = 'https://api.github.com/repos/' + repo + '/contents/' + pathClean;
    var options = {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + config.token.trim(),
        'Accept': 'application/vnd.github.v3+json'
      },
      muteHttpExceptions: true
    };
    var resp = UrlFetchApp.fetch(apiUrl, options);
    if (resp.getResponseCode() !== 200) return null;
    var json = JSON.parse(resp.getContentText());
    var content = (json.content || '').toString().replace(/\s/g, '');
    if (!content) return null;
    var mime = (json.name || '').indexOf('.png') >= 0 ? 'image/png' : 'image/jpeg';
    return { mime: mime, base64: content };
  } catch (e) {
    Logger.log('fetchFileFromGitHub: ' + (e.message || e.toString()));
    return null;
  }
}

/** 영수증 Drive 폴더 ID (비어 있으면 스크립트 속성 TETRA_RECEIPT_FOLDER_ID 사용) */
function getReceiptDriveFolderId() {
  var id = (RECEIPT_DRIVE_FOLDER_ID || '').toString().trim();
  if (id) return id;
  try {
    id = (PropertiesService.getScriptProperties().getProperty('TETRA_RECEIPT_FOLDER_ID') || '').toString().trim();
  } catch (e) {}
  return id || '';
}

/** 일일업무 이미지 Drive 폴더 ID */
function getTaskImageDriveFolderId() {
  var id = (TASK_IMAGE_DRIVE_FOLDER_ID || '').toString().trim();
  if (id) return id;
  try {
    id = (PropertiesService.getScriptProperties().getProperty('TETRA_TASK_IMAGE_FOLDER_ID') || '').toString().trim();
  } catch (e) {}
  return id || '';
}

/**
 * Tetra 이미지용 Drive 폴더 2개를 생성하고 스크립트 속성에 저장.
 * Apps Script 편집기에서 이 함수를 한 번 실행하면, 루트 Drive에 "Tetra 영수증", "Tetra 일일업무" 폴더가 생기고 ID가 저장됩니다.
 */
function createTetraImageFolders() {
  try {
    var root = DriveApp.getRootFolder();
    var receiptFolderName = 'Tetra 영수증';
    var taskFolderName = 'Tetra 일일업무';
    var existingReceipt = root.getFoldersByName(receiptFolderName);
    var receiptFolder = existingReceipt.hasNext() ? existingReceipt.next() : root.createFolder(receiptFolderName);
    var existingTask = root.getFoldersByName(taskFolderName);
    var taskFolder = existingTask.hasNext() ? existingTask.next() : root.createFolder(taskFolderName);
    var props = PropertiesService.getScriptProperties();
    props.setProperty('TETRA_RECEIPT_FOLDER_ID', receiptFolder.getId());
    props.setProperty('TETRA_TASK_IMAGE_FOLDER_ID', taskFolder.getId());
    Logger.log('Tetra 영수증 폴더 ID: ' + receiptFolder.getId());
    Logger.log('Tetra 일일업무 폴더 ID: ' + taskFolder.getId());
    return { receiptFolderId: receiptFolder.getId(), taskFolderId: taskFolder.getId() };
  } catch (e) {
    Logger.log('createTetraImageFolders: ' + (e.message || e.toString()));
    return null;
  }
}

/**
 * Base64 영수증 이미지를 Drive 폴더에 업로드하고 공개 보기 URL 반환.
 * 폴더 ID: RECEIPT_DRIVE_FOLDER_ID 또는 스크립트 속성 TETRA_RECEIPT_FOLDER_ID (createTetraImageFolders 실행 후 자동 설정)
 * @param {string} base64Data - data:image/xxx;base64,xxxx 또는 순수 base64
 * @param {string} [mimeType] - image/png, image/jpeg, application/pdf 등
 * @param {string} [fileName] - 저장할 파일명
 * @returns {string} 보기용 URL (실패 시 빈 문자열)
 */
function uploadReceiptToDrive(base64Data, mimeType, fileName) {
  try {
    var folderId = getReceiptDriveFolderId();
    if (!folderId) return '';
    var raw = (base64Data || '').toString().trim().replace(/\s/g, '');
    if (!raw) return '';
    var dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/);
    var mime = mimeType || (dataUrlMatch ? dataUrlMatch[1].trim() : 'image/png');
    var base64 = (dataUrlMatch ? dataUrlMatch[2] : raw).replace(/\s/g, '');
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime);
    var ext = (mime.indexOf('pdf') >= 0) ? 'pdf' : (mime.indexOf('jpeg') >= 0 || mime.indexOf('jpg') >= 0) ? 'jpg' : 'png';
    var name = (fileName || 'receipt_' + new Date().getTime()) + (fileName && fileName.indexOf('.') >= 0 ? '' : ('.' + ext));
    var folder = DriveApp.getFolderById(folderId);
    var file = folder.createFile(blob.setName(name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/file/d/' + file.getId() + '/view';
  } catch (e) {
    Logger.log('uploadReceiptToDrive: ' + (e.message || e.toString()));
    return '';
  }
}

/**
 * 일일업무 이미지를 Drive 폴더에 업로드하고 공개 보기 URL 반환.
 * 폴더 ID: TASK_IMAGE_DRIVE_FOLDER_ID 또는 스크립트 속성 TETRA_TASK_IMAGE_FOLDER_ID
 * @param {string} base64Data - data:image/xxx;base64,xxxx 또는 순수 base64
 * @param {string} [mimeType] - image/png, image/jpeg 등
 * @param {string} [fileName] - 저장할 파일명 (미입력 시 task_타임스탬프.jpg)
 * @returns {string} 보기용 URL (실패 시 빈 문자열)
 */
function uploadTaskImageToDrive(base64Data, mimeType, fileName) {
  try {
    var folderId = getTaskImageDriveFolderId();
    if (!folderId) return '';
    var raw = (base64Data || '').toString().trim();
    if (!raw) return '';
    var dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/);
    var mime = mimeType || (dataUrlMatch ? dataUrlMatch[1].trim() : 'image/jpeg');
    var base64 = dataUrlMatch ? dataUrlMatch[2] : raw;
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime);
    var ext = (mime.indexOf('jpeg') >= 0 || mime.indexOf('jpg') >= 0) ? 'jpg' : (mime.indexOf('png') >= 0 ? 'png' : 'jpg');
    var name = (fileName && fileName.indexOf('.') >= 0) ? fileName : ((fileName || 'task_' + new Date().getTime()) + (fileName ? '' : ('.' + ext)));
    var folder = DriveApp.getFolderById(folderId);
    var file = folder.createFile(blob.setName(name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/file/d/' + file.getId() + '/view';
  } catch (e) {
    Logger.log('uploadTaskImageToDrive: ' + (e.message || e.toString()));
    return '';
  }
}

/**
 * 영수증 base64를 같은 스프레드시트의 ReceiptStorage 시트에 청크로 저장. (Drive 불필요)
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} doc
 * @param {string} expenseId - 지출 ID (exp123 또는 exp-row2 등)
 * @param {string} base64Data - data:image/xxx;base64,... 또는 순수 base64
 * @returns {boolean} 성공 여부
 */
function saveReceiptToSheet(doc, expenseId, base64Data) {
  try {
    var raw = (base64Data || '').toString().trim().replace(/\s/g, '');
    if (!raw || !expenseId) return false;
    var dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/);
    var mime = dataUrlMatch ? dataUrlMatch[1].trim() : 'image/png';
    var base64 = (dataUrlMatch ? dataUrlMatch[2] : raw).replace(/\s/g, '');
    var sh = doc.getSheetByName('ReceiptStorage');
    if (!sh) {
      sh = doc.insertSheet('ReceiptStorage');
      sh.appendRow(['expense_id', 'chunk_index', 'mime', 'data']);
      sh.getRange(1, 1, 1, 4).setFontWeight('bold');
    }
    var data = sh.getDataRange().getValues();
    for (var r = data.length - 1; r >= 1; r--) {
      if (String(data[r][0] || '').trim() === String(expenseId).trim()) sh.deleteRow(r + 1);
    }
    var chunkSize = RECEIPT_SHEET_CHUNK_SIZE || 45000;
    for (var i = 0; i < base64.length; i += chunkSize) {
      var chunk = base64.substring(i, i + chunkSize);
      var idx = Math.floor(i / chunkSize);
      sh.appendRow([expenseId, idx, idx === 0 ? mime : '', chunk]);
    }
    return true;
  } catch (e) {
    Logger.log('saveReceiptToSheet: ' + (e.message || e.toString()));
    return false;
  }
}

/**
 * ReceiptStorage 시트에서 영수증 base64 조회.
 * @returns {{ mime: string, base64: string }|null}
 */
function getReceiptFromSheet(doc, expenseId) {
  try {
    var sh = doc.getSheetByName('ReceiptStorage');
    if (!sh || sh.getLastRow() < 2) return null;
    var data = sh.getDataRange().getValues();
    var idStr = String(expenseId || '').trim();
    var chunks = [];
    var mime = 'image/jpeg';
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][0] || '').trim() !== idStr) continue;
      var idx = parseInt(data[r][1], 10);
      if (data[r][2]) mime = String(data[r][2]).trim() || mime;
      chunks.push({ idx: idx, data: data[r][3] || '' });
    }
    if (chunks.length > 0) {
      chunks.sort(function (a, b) { return a.idx - b.idx; });
      var base64 = chunks.map(function (c) { return c.data; }).join('');
      return { mime: mime, base64: base64 };
    }
    var ghSh = doc.getSheetByName('ReceiptGitHub');
    if (ghSh && ghSh.getLastRow() >= 2) {
      var ghData = ghSh.getDataRange().getValues();
      for (var r = 1; r < ghData.length; r++) {
        if (String(ghData[r][0] || '').trim() === String(expenseId).trim()) {
          var path = String(ghData[r][1] || '').trim();
          if (path) {
            try { return fetchFileFromGitHub(path); } catch (ghEx) { Logger.log('getReceiptFromSheet GitHub: ' + (ghEx.message || ghEx)); }
          }
          break;
        }
      }
    }
  } catch (e) {
    Logger.log('getReceiptFromSheet: ' + (e.message || e.toString()));
  }
  return null;
}

/**
 * ReceiptGitHub 시트에 expense_id, path 기록. (비공개 저장소일 때 바로가기 URL만 노출하기 위함)
 */
function saveReceiptGitHubPath(doc, expenseId, path) {
  try {
    var sh = doc.getSheetByName('ReceiptGitHub');
    if (!sh) {
      sh = doc.insertSheet('ReceiptGitHub');
      sh.appendRow(['expense_id', 'path']);
      sh.getRange(1, 1, 1, 2).setFontWeight('bold');
    }
    sh.appendRow([expenseId, path]);
  } catch (e) {
    Logger.log('saveReceiptGitHubPath: ' + (e.message || e.toString()));
  }
}

/**
 * Expenses 시트에서 해당 지출 행의 receipt_url 컬럼만 갱신.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} doc
 * @param {string} expenseId - exp123 또는 exp-row2
 * @param {string} url - 저장할 URL
 * @param {number} [lastRow] - 방금 추가한 행 번호(있으면 이 행만 갱신)
 */
function updateExpenseReceiptUrl(doc, expenseId, url, lastRow) {
  try {
    var sh = doc.getSheetByName('Expenses');
    if (!sh || sh.getLastRow() < 2) return;
    var colReceipt = -1;
    var data = sh.getDataRange().getValues();
    var header = (data[0] || []).map(function (h) { return String(h || '').toLowerCase(); });
    if (header.indexOf('receipt_url') >= 0) colReceipt = header.indexOf('receipt_url');
    if (colReceipt < 0) return;
    var targetRow = -1;
    if (lastRow != null && lastRow >= 2) targetRow = lastRow;
    else if (header.indexOf('expense_id') >= 0) {
      for (var r = 1; r < data.length; r++) {
        if (String(data[r][0] || '').trim() === String(expenseId).trim()) { targetRow = r + 1; break; }
      }
    }
    if (targetRow >= 2) sh.getRange(targetRow, colReceipt + 1).setValue(url);
  } catch (e) {
    Logger.log('updateExpenseReceiptUrl: ' + (e.message || e.toString()));
  }
}

/**
 * 일일업무 이미지 base64를 TaskImageStorage 시트에 청크로 저장. (Drive 불필요)
 */
function saveTaskImageToSheet(doc, taskId, base64Data) {
  try {
    var raw = (base64Data || '').toString().trim().replace(/\s/g, '');
    if (!raw || !taskId) return false;
    var dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/);
    var mime = dataUrlMatch ? dataUrlMatch[1].trim() : 'image/jpeg';
    var base64 = (dataUrlMatch ? dataUrlMatch[2] : raw).replace(/\s/g, '');
    var sh = doc.getSheetByName('TaskImageStorage');
    if (!sh) {
      sh = doc.insertSheet('TaskImageStorage');
      sh.appendRow(['task_id', 'chunk_index', 'mime', 'data']);
      sh.getRange(1, 1, 1, 4).setFontWeight('bold');
    }
    var data = sh.getDataRange().getValues();
    for (var r = data.length - 1; r >= 1; r--) {
      if (String(data[r][0] || '').trim() === String(taskId).trim()) sh.deleteRow(r + 1);
    }
    var chunkSize = RECEIPT_SHEET_CHUNK_SIZE || 45000;
    for (var i = 0; i < base64.length; i += chunkSize) {
      var chunk = base64.substring(i, i + chunkSize);
      var idx = Math.floor(i / chunkSize);
      sh.appendRow([taskId, idx, idx === 0 ? mime : '', chunk]);
    }
    return true;
  } catch (e) {
    Logger.log('saveTaskImageToSheet: ' + (e.message || e.toString()));
    return false;
  }
}

/** TaskImageStorage 시트에서 일일업무 이미지 조회. */
function getTaskImageFromSheet(doc, taskId) {
  try {
    var sh = doc.getSheetByName('TaskImageStorage');
    if (sh && sh.getLastRow() >= 2) {
      var data = sh.getDataRange().getValues();
      var idStr = String(taskId || '').trim();
      var chunks = [];
      var mime = 'image/jpeg';
      for (var r = 1; r < data.length; r++) {
        if (String(data[r][0] || '').trim() !== idStr) continue;
        var idx = parseInt(data[r][1], 10);
        if (data[r][2]) mime = String(data[r][2]).trim() || mime;
        chunks.push({ idx: idx, data: data[r][3] || '' });
      }
      if (chunks.length > 0) {
        chunks.sort(function (a, b) { return a.idx - b.idx; });
        var base64 = chunks.map(function (c) { return c.data; }).join('');
        return { mime: mime, base64: base64 };
      }
    }
    var ghSh = doc.getSheetByName('TaskImageGitHub');
    if (ghSh && ghSh.getLastRow() >= 2) {
      var ghData = ghSh.getDataRange().getValues();
      var idStr2 = String(taskId || '').trim();
      for (var r = 1; r < ghData.length; r++) {
        if (String(ghData[r][0] || '').trim() === idStr2) {
          var path = String(ghData[r][1] || '').trim();
          if (path) {
            try { return fetchFileFromGitHub(path); } catch (ghEx) { Logger.log('getTaskImageFromSheet GitHub: ' + (ghEx.message || ghEx)); }
          }
          break;
        }
      }
    }
  } catch (e) {
    Logger.log('getTaskImageFromSheet: ' + (e.message || e.toString()));
  }
  return null;
}

/**
 * 웹앱/스크립트에서 사용할 스프레드시트 반환.
 * 스크립트 속성 SPREADSHEET_ID 가 있으면 해당 ID 시트를 열고, 없으면 스크립트가 연결된 활성 시트 사용.
 * 수동 시간 수정 등 시트 쓰기가 되려면, 이 ID에 해당하는 시트에 웹앱 실행 계정이 편집 권한으로 공유되어 있어야 합니다.
 */
function getDocument() {
  try {
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (id && id.toString().trim().length > 0) return SpreadsheetApp.openById(id.trim());
  } catch (err) {}
  return SpreadsheetApp.getActiveSpreadsheet();
}

function doGet(e) {
  var doc = getDocument();
  var action = (e.parameter || {}).action || '';

  try {
    if (action === "getReceipt") {
      var expenseId = (e.parameter.expenseId || e.parameter.expense_id || '').toString().trim();
      if (!expenseId) return ContentService.createTextOutput('<html><body><p>expenseId 필요</p></body></html>').setMimeType(ContentService.MimeType.HTML);
      var receipt = getReceiptFromSheet(doc, expenseId);
      var html;
      if (receipt && receipt.base64) {
        var dataUrl = 'data:' + (receipt.mime || 'image/jpeg') + ';base64,' + receipt.base64;
        var srcEsc = (dataUrl || '').replace(/"/g, '&quot;');
        html = '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta charset="utf-8"><title>영수증</title><style>body{margin:0;text-align:center;background:#333;min-height:100vh;display:flex;align-items:center;justify-content:center;}img{max-width:100%;height:auto;}</style></head><body><img src="' + srcEsc + '" alt="영수증" /></body></html>';
      } else {
        html = '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta charset="utf-8"><title>영수증</title><style>body{margin:0;text-align:center;background:#333;min-height:100vh;display:flex;align-items:center;justify-content:center;color:#fff;}</style></head><body><p>영수증을 불러올 수 없습니다.</p></body></html>';
      }
      return ContentService.createTextOutput(html).setMimeType(ContentService.MimeType.HTML);
    }
    if (action === "getReceiptData") {
      var expenseId = (e.parameter.expenseId || e.parameter.expense_id || '').toString().trim();
      if (!expenseId) return response({ error: 'expenseId 필요' });
      var receipt = getReceiptFromSheet(doc, expenseId);
      if (!receipt || !receipt.base64) return response({ error: '영수증 없음' });
      var dataUrl = 'data:' + receipt.mime + ';base64,' + receipt.base64;
      return response({ dataUrl: dataUrl });
    }
    if (action === "getTaskImage") {
      var taskId = (e.parameter.taskId || e.parameter.task_id || '').toString().trim();
      if (!taskId) return ContentService.createTextOutput('<html><body><p>taskId 필요</p></body></html>').setMimeType(ContentService.MimeType.HTML);
      var taskImg = getTaskImageFromSheet(doc, taskId);
      var html;
      if (taskImg && taskImg.base64) {
        var dataUrl = 'data:' + (taskImg.mime || 'image/jpeg') + ';base64,' + taskImg.base64;
        var srcEsc = (dataUrl || '').replace(/"/g, '&quot;');
        html = '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta charset="utf-8"><title>일일업무 이미지</title><style>body{margin:0;text-align:center;background:#333;min-height:100vh;display:flex;align-items:center;justify-content:center;}img{max-width:100%;height:auto;}</style></head><body><img src="' + srcEsc + '" alt="이미지" /></body></html>';
      } else {
        html = '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta charset="utf-8"><title>일일업무 이미지</title><style>body{margin:0;text-align:center;background:#333;min-height:100vh;display:flex;align-items:center;justify-content:center;color:#fff;}</style></head><body><p>이미지를 불러올 수 없습니다.</p></body></html>';
      }
      return ContentService.createTextOutput(html).setMimeType(ContentService.MimeType.HTML);
    }
    if (action === "getTaskImageData") {
      var taskId = (e.parameter.taskId || e.parameter.task_id || '').toString().trim();
      if (!taskId) return response({ error: 'taskId 필요' });
      var taskImg = getTaskImageFromSheet(doc, taskId);
      if (!taskImg || !taskImg.base64) return response({ error: '이미지 없음' });
      var dataUrl = 'data:' + taskImg.mime + ';base64,' + taskImg.base64;
      return response({ dataUrl: dataUrl });
    }
    if (action === "getPendingUsers") {
      return response({ users: getPendingUsersList(doc) });
    }
    if (action === "getApprovedUsers") {
      return response({ users: getApprovedUsersList(doc) });
    }
    if (action === "checkUserId") {
      var uid = (e.parameter.userId || '').toString().trim();
      return response(getUserIdExists(doc, uid) ? { exists: true } : { exists: false });
    }
    if (action === "getUserDetail") {
      var uid2 = (e.parameter.userId || '').toString().trim();
      return response(getUserDetailByUserId(doc, uid2) || {});
    }
    if (action === "login") {
      var users = doc.getSheetByName("Users").getDataRange().getValues();
      var staff = doc.getSheetByName("Staff_List");
      var staffData = staff ? staff.getDataRange().getValues() : [];
      for (var i = 1; i < users.length; i++) {
        var inputPw = e.parameter.userPw || '';
        var storedPw = users[i][1];
        var pwMatch = (storedPw === inputPw) || (hashPasswordSha256(inputPw) === String(storedPw));
        if (users[i][0] == e.parameter.userId && pwMatch) {
          var isApproved = users[i][7];
          if (isApproved === false || String(isApproved).toUpperCase() === "FALSE") {
            return response({ status: "pending_approval" });
          }
          var name = users[i][2];
          for (var j = 1; j < staffData.length; j++) {
            if (staffData[j][1] === name && staffData[j][10]) {
              if (new Date(staffData[j][10]) < new Date()) return response({ status: "terminated" });
            }
          }
          return response({ status: "success", userId: users[i][0], userName: name, role: users[i][6] || users[i][3] });
        }
      }
      return response({ status: "fail" });
    }
    if (action === "getSalaryReport") {
      var monthParam = (e.parameter.month || '').toString().trim();
      var report = calculateSalaryReport(doc, monthParam);
      if (report && report.status === "error") return response(report);
      return response(report || []);
    }
    if (action === "getStaffList") {
      var sl = doc.getSheetByName("Staff_List").getDataRange().getValues().slice(1);
      var staffArr = sl.map(function(r) {
        return { id: r[0], name: r[1], birth: r[2], phone: r[3], type: r[4], nation: r[5], wage: r[6], wageType: r[7], ot: r[8], hire: r[9], term: r[10] };
      });
      staffArr = augmentStaffListWithSevenDayAvg(doc, staffArr);
      return response(staffArr);
    }
    if (action === "getDailyAttendance") {
      var dateParam = (e.parameter.date || '').toString().trim();
      var targetDate = dateParam || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      return response(getDailyAttendanceList(doc, targetDate));
    }
    if (action === "getStaffMonthlyAttendance") {
      var staffName = (e.parameter.staffName || e.parameter.name || '').toString().trim();
      var monthParam = (e.parameter.month || '').toString().trim();
      return response(getStaffMonthlyAttendance(doc, staffName, monthParam));
    }
    if (action === "getWorkerTodaySummary") {
      var wn = (e.parameter.workerName || '').toString().trim();
      var dateParam = (e.parameter.date || '').toString().trim();
      var targetDate = dateParam || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
      return response(getWorkerTodaySummary(doc, wn, targetDate));
    }
    if (action === "getWorkerBalance") {
      var wn = (e.parameter.workerName || '').toString().trim();
      return response(getWorkerBalance(doc, wn));
    }
    if (action === "getDailyTaskList") {
      var dateParam = (e.parameter.date || '').toString().trim();
      var workerParam = (e.parameter.workerName || e.parameter.worker || e.parameter.name || '').toString().trim();
      var limit = parseInt(e.parameter.limit || '500', 10) || 500;
      return response(getDailyTaskList(doc, { date: dateParam, workerName: workerParam, limit: limit }));
    }
    if (action === "getFarmingExchangeList") {
      var limit = parseInt(e.parameter.limit || '50', 10) || 50;
      return response(getFarmingExchangeList(doc, limit));
    }
    if (action === "getWorkerRevenueSummary") {
      return response(getWorkerRevenueSummary(doc, e.parameter || {}));
    }
    if (action === "getRevenueLogs") {
      return response(handleGetRevenueLogs(doc, e.parameter || {}));
    }
    if (action === "getRevenueLedger") {
      return response(getRevenueLedger(doc, e.parameter || {}));
    }
    if (action === "getPLDashboard") {
      var monthParam = (e.parameter.month || '').toString().trim() || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM');
      return response(getPLDashboard(doc, monthParam));
    }
    if (action === "getPLTrend") {
      var monthsCount = parseInt(e.parameter.months || '6', 10) || 6;
      return response(getPLTrend(doc, monthsCount));
    }
    if (action === "getPLReport") {
      var monthsCount = parseInt(e.parameter.months || '12', 10) || 12;
      return response(getPLReport(doc, monthsCount));
    }
    if (action === "syncPLToSheet") {
      var monthsCount = parseInt(e.parameter.months || '12', 10) || 12;
      var out = syncPLToSheet(doc, monthsCount);
      if (out.error) return response(out);
      return response({ success: true, message: "손익계산서 시트가 업데이트되었습니다.", rows: out.rows });
    }
    if (action === "getExpenseList") {
      var params = e.parameter || {};
      var out = typeof handleGetExpenseList === "function" ? handleGetExpenseList(params) : handleGetExpenseListInline(doc, params);
      return response(out);
    }
    if (action === "getShareholders") {
      var out = handleGetShareholders(doc, e.parameter || {});
      if (out.error) return response(out);
      return response(out);
    }
    if (action === "deleteExpense") {
      var out = handleDeleteExpenseInline(doc, e.parameter || {});
      if (out.error) return response({ error: out.error });
      return response({ success: true });
    }
    if (action === "deleteUser") {
      var out = handleDeleteUser(doc, e.parameter || {});
      return response(out);
    }
    if (action === "manager_edit") {
      var p = e.parameter || {};
      var workerName = (p.workerName || p.worker_name || '').toString().trim();
      var targetDate = (p.targetDate || p.target_date || '').toString().trim();
      var newInTime = (p.newInTime || p.new_in_time || '').toString().trim();
      var newOutTime = (p.newOutTime || p.new_out_time || '').toString().trim();
      if (!workerName || !targetDate || !newInTime || !newOutTime) {
        return response({ "result": "error", "message": "근로자, 날짜, 출근/퇴근 시간을 모두 입력해 주세요." });
      }
      var result = handleEditAttendance(doc, workerName, targetDate, newInTime, newOutTime);
      return response(result);
    }
    if (action === "manager_add_attendance") {
      var p = e.parameter || {};
      var workerName = (p.workerName || p.worker_name || '').toString().trim();
      var targetDate = (p.targetDate || p.target_date || '').toString().trim();
      var shift = (p.shift || p.workShift || 'Day').toString().trim();
      var newInTime = (p.newInTime || p.new_in_time || '').toString().trim();
      var newOutTime = (p.newOutTime || p.new_out_time || '').toString().trim();
      var note = (p.note || p.remarks || 'manager_manual_add').toString().trim();
      if (!workerName || !targetDate || !newInTime || !newOutTime) {
        return response({ "result": "error", "message": "근로자, 날짜, 출근/퇴근 시간을 모두 입력해 주세요." });
      }
      var result = handleAddAttendance(doc, workerName, targetDate, shift, newInTime, newOutTime, note);
      return response(result);
    }
    if (action === "upsertShareholders") {
      var p = e.parameter || {};
      var out = handleUpsertShareholders(doc, p);
      if (out.error) return response({ error: out.error, status: out.status || 400 });
      return response({ success: true, updated: out.updated || 0 });
    }
    if (action === "getDashboardSummary") {
      var f = doc.getSheetByName("Farming").getDataRange().getValues();
      var a = 0, l = 0;
      f.forEach(function(r) {
        if (String(r[2]).indexOf("Aion") >= 0) a += (Number(r[3]) || 0);
        if (String(r[2]).indexOf("Lineage") >= 0) l += (Number(r[3]) || 0);
      });
      var expSheet = doc.getSheetByName("Expenses");
      var eExp = expSheet ? expSheet.getDataRange().getValues().slice(1).reduce(function(acc, r) { return acc + (Number(r[3]) || 0); }, 0) : 0;
      return response({ aion: a, lineage: l, expensePHP: eExp });
    }
    if (action === "upsertStaff") {
      var params = e.parameter || {};
      var sheet = doc.getSheetByName("Staff_List");
      if (!sheet) return response({ result: "error", message: "Staff_List 시트가 없습니다." });
      var data = sheet.getDataRange().getValues();
      var userId = (params.userId || params.staffId || '').toString().trim();
      var userName = (params.userName || params.staffName || '').toString().trim();
      var empType = (params.empType || params.employmentType || '').toString().trim();
      var wage = (params.wage || params.salaryAmount || '').toString().trim();
      var wageType = (params.wageType || params.salaryBasis || '').toString().trim();
      var otRate = (params.otRate || params.overtimeRate || '').toString().trim();
      var termDate = (params.termDate || params.resignDate || '').toString().trim();
      var foundRow = -1;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === String(userId).trim()) { foundRow = i + 1; break; }
      }
      var phoneStr = (params.phone || '').toString().trim();
      var newRow = [userId, userName, params.birthDate || '', phoneStr, empType, params.nationality || '', wage, wageType, otRate || '1.5', params.hireDate || '', termDate];
      if (foundRow > 0) {
        for (var c = 0; c < 11; c++) {
          var cell = sheet.getRange(foundRow, c + 1).getCell(1, 1);
          cell.setValue(newRow[c]);
        }
        sheet.getRange(foundRow, 4).getCell(1, 1).setNumberFormat('@');
        sheet.getRange(foundRow, 4).getCell(1, 1).setValue(phoneStr);
      } else {
        sheet.appendRow(newRow);
        var lastRow = sheet.getLastRow();
        sheet.getRange(lastRow, 4).setNumberFormat('@');
        sheet.getRange(lastRow, 4).setValue(phoneStr);
      }
      return response({ result: "success" });
    }
    return response({ status: "running", message: "Tetra Engine V3 Online" });
  } catch (err) {
    return response({ status: "error", message: err.toString() });
  }
}

function doPost(e) {
  var doc = getDocument();
  var timestamp = new Date();
  var params = parsePostParams(e);
  var action = params.action || '';

  try {
    if (action === "approveUser") {
      return response(handleApproveUser(doc, params.userId, params.role));
    }
    if (action === "deleteUser") {
      return response(handleDeleteUser(doc, params));
    }
    if (action === "logRevenue") {
      var revSheet = doc.getSheetByName("매출장부") || doc.insertSheet("매출장부");
      var revDate = formatRevenueDate(params.date || timestamp);
      revSheet.appendRow([revDate, params.game_type, params.amount, params.rate, params.revenue_php, params.revenue_krw, params.manager_name, "승인완료"]);
      return response({ "result": "success" });
    }
    if (action === "insertRevenue") {
      var out = handleInsertRevenue(doc, params);
      if (out.error) return response({ error: out.error });
      return response({ ok: true, log_id: out.log_id });
    }
    if (action === "approveRevenueLog") {
      var out = handleApproveRevenueLog(doc, params);
      if (out.error) return response({ error: out.error });
      return response({ ok: true, log_id: out.log_id, sheetSynced: out.sheetSynced });
    }
    if (action === "syncRevenueToLedger") {
      var out = handleSyncRevenueToLedger(doc, params);
      if (out.error) return response({ error: out.error });
      return response({ ok: true });
    }
    if (action === "upsertExpense") {
      try {
        var receiptB64 = (params.receiptBase64 || params.receipt_base64 || '').toString().trim();
        var receiptWarning = '';
        params.receipt_url = '';
        if (receiptB64 && receiptB64.length > MAX_ATTACHMENT_B64_LENGTH) {
          receiptWarning = '영수증 파일이 너무 커서 저장하지 못했습니다. (2MB 이하)';
        }
        var out = typeof handleUpsertExpense === "function" ? handleUpsertExpense(params) : handleUpsertExpenseInline(doc, params);
        if (out && out.error) return response({ error: out.error });
        if (receiptB64 && receiptB64.length <= MAX_ATTACHMENT_B64_LENGTH) {
          var receiptSaved = false;
          if (saveReceiptToSheet(doc, out.expenseId, receiptB64)) {
            try {
              var shortcutUrl = ScriptApp.getService().getUrl() + '?action=getReceipt&expenseId=' + encodeURIComponent(out.expenseId);
              updateExpenseReceiptUrl(doc, out.expenseId, shortcutUrl, out.lastRow);
              receiptSaved = true;
            } catch (urlEx) {}
          }
          if (!receiptSaved && getReceiptDriveFolderId()) {
            var driveUrl = uploadReceiptToDrive(receiptB64, null, (out.expenseId || 'r' + Date.now()));
            if (driveUrl) {
              updateExpenseReceiptUrl(doc, out.expenseId, driveUrl, out.lastRow);
              receiptSaved = true;
            }
          }
          if (!receiptSaved && getGitHubConfig()) {
            try {
              var ext = (receiptB64.indexOf('image/png') >= 0 || receiptB64.indexOf('image/png') === 0) ? 'png' : 'jpg';
              var receiptPath = 'receipts/' + (out.expenseId || 'r' + Date.now()) + '.' + ext;
              var ghResult = uploadImageToGitHub(receiptB64, receiptPath);
              if (ghResult && ghResult.url) {
                saveReceiptGitHubPath(doc, out.expenseId, receiptPath);
                var shortcutUrl = ScriptApp.getService().getUrl() + '?action=getReceipt&expenseId=' + encodeURIComponent(out.expenseId);
                updateExpenseReceiptUrl(doc, out.expenseId, shortcutUrl, out.lastRow);
                receiptSaved = true;
              } else if (ghResult && ghResult.error) receiptWarning = ghResult.error;
            } catch (ghEx) {
              receiptWarning = (ghEx.message || ghEx.toString() || 'GitHub 저장 실패').slice(0, 200);
            }
          }
          if (!receiptSaved && !receiptWarning) receiptWarning = '영수증 저장에 실패했습니다. (시트/Drive 폴더 확인)';
        }
        if (receiptWarning && out) out.warning = receiptWarning;
        return response(out);
      } catch (ex) {
        return response({ error: ex.toString() || "지출 등록 실패" });
      }
    }
    if (action === "register") {
      var userId = (params.userId || '').toString().trim();
      var userPw = (params.userPw || '').toString();
      var name = (params.name || params.userName || '').toString().trim();
      var birthDate = (params.birthDate || '').toString().trim();
      var phone = (params.phone || '').toString().trim();
      var email = (params.email || '').toString().trim();
      if (!userId || userId.length < 4) return response({ error: "아이디는 4자 이상이어야 합니다." });
      if (!name) return response({ error: "이름을 입력해주세요." });
      var us = doc.getSheetByName("Users");
      if (!us) return response({ error: "Users 시트가 없습니다." });
      var hashedPw = hashPasswordSha256(userPw);
      var phoneStr = (phone || '').toString().trim();
      us.appendRow([userId, hashedPw, name, birthDate, phoneStr, email || '', 'pending', false, timestamp]);
      var lastRow = us.getLastRow();
      var phoneCol = 5;
      var phoneCell = us.getRange(lastRow, phoneCol);
      phoneCell.setNumberFormat('@');
      phoneCell.setValue(phoneStr);
      return response({ status: "success", message: "가입 신청이 완료되었습니다. 관리자 승인 후 이용 가능합니다." });
    }
    if (action === "finalizePayroll") {
      var sheet = doc.getSheetByName("Monthly_Salary");
      if (!sheet) {
        sheet = doc.insertSheet("Monthly_Salary");
        sheet.appendRow(["성명", "총근무시간", "기본급합계", "연장수당합계", "보너스", "공제액", "최종지급액", "정산월", "정산일시"]);
        sheet.getRange(1, 1, 1, 9).setFontWeight("bold");
      } else if (sheet.getLastColumn() < 9) {
        sheet.insertColumnAfter(4);
        sheet.getRange(1, 5).setValue("보너스");
      }
      var dataArr = params.data;
      if (typeof dataArr === "string") { try { dataArr = JSON.parse(dataArr); } catch (e) { dataArr = []; } }
      var monthStr = (params.month || "").toString().trim();
      (dataArr || []).forEach(function(row) {
        sheet.appendRow([
          row.name || "",
          row.hrs != null ? row.hrs : 0,
          row.basePay != null ? row.basePay : 0,
          row.otPay != null ? row.otPay : 0,
          row.bonus != null ? row.bonus : 0,
          row.deduction != null ? row.deduction : 0,
          row.finalPay != null ? row.finalPay : 0,
          monthStr,
          timestamp
        ]);
      });
      SpreadsheetApp.flush();
      return response({ result: "success", message: "Monthly_Salary에 저장되었습니다.", saved: (dataArr || []).length });
    }
    if (action === "upsertStaff") {
      var sheet = doc.getSheetByName("Staff_List");
      var data = sheet.getDataRange().getValues();
      var userId = (params.userId || params.staffId || '').toString().trim();
      var userName = (params.userName || params.staffName || '').toString().trim();
      var empType = (params.empType || params.employmentType || '').toString().trim();
      var wage = (params.wage || params.salaryAmount || '').toString().trim();
      var wageType = (params.wageType || params.salaryBasis || '').toString().trim();
      var otRate = (params.otRate || params.overtimeRate || '').toString().trim();
      var termDate = (params.termDate || params.resignDate || '').toString().trim();
      var foundRow = -1;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === String(userId).trim()) { foundRow = i + 1; break; }
      }
      var phoneStr = (params.phone || '').toString().trim();
      var newRow = [userId, userName, params.birthDate || '', phoneStr, empType, params.nationality || '', wage, wageType, otRate || '1.5', params.hireDate || '', termDate];
      if (foundRow > 0) {
        for (var c = 0; c < 11; c++) {
          var cell = sheet.getRange(foundRow, c + 1).getCell(1, 1);
          cell.setValue(newRow[c]);
        }
        sheet.getRange(foundRow, 4).getCell(1, 1).setNumberFormat('@');
        sheet.getRange(foundRow, 4).getCell(1, 1).setValue(phoneStr);
      } else {
        sheet.appendRow(newRow);
        var lastRow = sheet.getLastRow();
        sheet.getRange(lastRow, 4).setNumberFormat('@');
        sheet.getRange(lastRow, 4).setValue(phoneStr);
      }
      return response({ "result": "success" });
    }
    if (action === "upsertShareholders") {
      var out = handleUpsertShareholders(doc, params);
      if (out.error) return response({ error: out.error, status: out.status || 400 });
      return response({ success: true, updated: out.updated || 0 });
    }
    if (action === "deleteExpense") {
      var out = handleDeleteExpenseInline(doc, params);
      if (out.error) return response({ error: out.error });
      return response({ success: true });
    }
    if (action === "clock_in_out") {
      var worker = (params.workerName || '').toString().trim();
      var type = params.type || (params.clockType === 'clock_in' ? 'Clock In' : params.clockType === 'clock_out' ? 'Clock Out' : params.type);
      var shift = params.shift || 'Day';
      if (!worker) return response({ "result": "error", "message": "이름을 입력해 주세요." });
      if (type !== "Clock In" && type !== "Clock Out") return response({ "result": "error", "message": "잘못된 요청입니다." });

      var pSheet = doc.getSheetByName("Payroll_Daily");
      if (!pSheet) {
        pSheet = doc.insertSheet("Payroll_Daily");
        pSheet.appendRow(["기록일", "이름", "조", "출근시간", "퇴근시간", "근무시간", "상태", "비고"]);
        pSheet.getRange(1, 1, 1, 8).setFontWeight("bold");
      }
      var todayStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyyMMdd');

      if (type === "Clock In") {
        if (pSheet) {
          var inData = pSheet.getDataRange().getValues();
          for (var ii = 1; ii < inData.length; ii++) {
            if (String(inData[ii][1]).trim() === worker && String(inData[ii][6]).trim() === "근무중") {
              var rowIn = inData[ii][3];
              var rowYmd = rowIn instanceof Date ? Utilities.formatDate(rowIn, Session.getScriptTimeZone(), 'yyyyMMdd') : String(rowIn || '').replace(/\D/g, '').slice(0, 8);
              if (rowYmd === todayStr) return response({ "result": "error", "message": "이미 출근 처리되었습니다." });
            }
          }
        }
        doc.getSheetByName("Attendance").appendRow([timestamp, worker, shift, type]);
        pSheet.appendRow([timestamp, worker, shift, timestamp, "", "", "근무중", ""]);
      } else {
        var found = false;
        if (pSheet) {
          var outData = pSheet.getDataRange().getValues();
          for (var k = outData.length - 1; k >= 1; k--) {
            if (String(outData[k][1]).trim() === worker && String(outData[k][6]).trim() === "근무중") {
              var rowOut = outData[k][3];
              var outYmd = rowOut instanceof Date ? Utilities.formatDate(rowOut, Session.getScriptTimeZone(), 'yyyyMMdd') : String(rowOut || '').replace(/\D/g, '').slice(0, 8);
              if (outYmd === todayStr) {
                var inTime = new Date(outData[k][3]);
                var hrs = Math.round(((timestamp - inTime) / (1000 * 60 * 60)) * 10) / 10;
                var status = (hrs >= 8 && hrs <= 10) ? "정상" : (hrs > 10 ? "오버타임" : "조퇴/지각");
                pSheet.getRange(k + 1, 5).setValue(timestamp);
                pSheet.getRange(k + 1, 6).setValue(hrs);
                pSheet.getRange(k + 1, 7).setValue(status);
                found = true;
                break;
              }
            }
          }
        }
        if (!found) return response({ "result": "error", "message": "출근 기록이 없습니다. 먼저 출근해 주세요." });
        doc.getSheetByName("Attendance").appendRow([timestamp, worker, shift, type]);
      }
      return response({ "result": "success" });
    }
    if (action === "farming") {
      var workerName = (params.workerName || '').toString().trim();
      var game = (params.game || '').toString().trim();
      var amount = parseInt(params.amount || '0', 10) || 0;
      if (!workerName) return response({ "result": "error", "message": "Name required." });
      var sheet = doc.getSheetByName('Farming');
      if (!sheet) {
        doc.insertSheet('Farming');
        sheet = doc.getSheetByName('Farming');
        sheet.appendRow(['시간', '이름', '게임', '수량']);
        sheet.getRange(1, 1, 1, 4).setBackground('#334155').setFontColor('#ffffff').setFontWeight('bold');
      }
      sheet.appendRow([new Date(), workerName, game || '', amount]);
      return response({ "result": "success", "message": "Farming registered." });
    }
    if (action === "logFarmingExchange") {
      var workerName = (params.workerName || '').toString().trim();
      var game = (params.game || '').toString().trim();
      var amount = parseInt(params.amount || '0', 10) || 0;
      var exchangeRate = parseFloat(params.exchange_rate || params.exchangeRate || '0') || 0;
      var note = (params.note || '').toString().trim();
      if (!workerName) return response({ "result": "error", "message": "이름을 입력해 주세요." });
      if (amount <= 0) return response({ "result": "error", "message": "차감 수량은 1 이상이어야 합니다." });
      var sheet = doc.getSheetByName('Farming_Exchange');
      if (!sheet) {
        doc.insertSheet('Farming_Exchange');
        sheet = doc.getSheetByName('Farming_Exchange');
        sheet.appendRow(['시간', '이름', '게임', '차감수량', '시세', '비고']);
        sheet.getRange(1, 1, 1, 6).setBackground('#334155').setFontColor('#ffffff').setFontWeight('bold');
      } else if (sheet.getLastRow() >= 1 && sheet.getLastColumn() < 6) {
        sheet.insertColumnAfter(4);
        sheet.getRange(1, 5).setValue('시세');
      }
      sheet.appendRow([new Date(), workerName, game || '', amount, exchangeRate, note]);
      return response({ "result": "success", "message": "환전 차감이 등록되었습니다." });
    }
    if (action === "logDailyTasks") {
      var workerName = (params.workerName || '').toString().trim();
      var tasksJson = params.tasks || params.data || '[]';
      if (!workerName) return response({ "result": "error", "message": "이름을 확인해 주세요." });
      var tasks = [];
      try {
        tasks = typeof tasksJson === 'string' ? JSON.parse(tasksJson) : (Array.isArray(tasksJson) ? tasksJson : []);
      } catch (ex) { return response({ "result": "error", "message": "업무 데이터 형식이 올바르지 않습니다." }); }
      if (!tasks.length) return response({ "result": "error", "message": "최소 1개 이상의 업무를 선택해 주세요." });
      var imageData = (params.taskImageBase64 || params.task_image_base64 || '').toString().trim();
      var imageCell = '';
      if (imageData && imageData.length <= MAX_ATTACHMENT_B64_LENGTH) {
        var taskId = 'task_' + new Date().getTime();
        if (saveTaskImageToSheet(doc, taskId, imageData)) {
          try {
            imageCell = ScriptApp.getService().getUrl() + '?action=getTaskImage&taskId=' + encodeURIComponent(taskId);
          } catch (e) {}
        }
        if (!imageCell && getTaskImageDriveFolderId()) {
          var uploadedUrl = uploadTaskImageToDrive(imageData, null, taskId + '.jpg');
          if (uploadedUrl) imageCell = uploadedUrl;
        }
        if (!imageCell && getGitHubConfig()) {
          try {
            var taskPath = 'task-images/' + taskId + '.jpg';
            var ghTask = uploadImageToGitHub(imageData, taskPath);
            if (ghTask && ghTask.url) {
              var taskGhSh = doc.getSheetByName('TaskImageGitHub');
              if (!taskGhSh) {
                taskGhSh = doc.insertSheet('TaskImageGitHub');
                taskGhSh.appendRow(['task_id', 'path']);
                taskGhSh.getRange(1, 1, 1, 2).setFontWeight('bold');
              }
              taskGhSh.appendRow([taskId, taskPath]);
              imageCell = ScriptApp.getService().getUrl() + '?action=getTaskImage&taskId=' + encodeURIComponent(taskId);
            }
          } catch (ghEx) {}
        }
      }
      var sheet = doc.getSheetByName('Daily_Tasks');
      if (!sheet) {
        doc.insertSheet('Daily_Tasks');
        sheet = doc.getSheetByName('Daily_Tasks');
        sheet.appendRow(['시간', '이름', '업무유형', '상세', '날짜', '이미지']);
        sheet.getRange(1, 1, 1, 6).setBackground('#334155').setFontColor('#ffffff').setFontWeight('bold');
      } else if (sheet.getLastRow() >= 1 && !sheet.getRange(1, 6).getValue()) {
        sheet.getRange(1, 6).setValue('이미지');
      }
      var todayStr = Utilities.formatDate(timestamp, 'Asia/Seoul', 'yyyy-MM-dd');
      for (var t = 0; t < tasks.length; t++) {
        var task = tasks[t];
        var typ = (task.type || task.업무유형 || task.task || '').toString().trim();
        var detail = (task.detail || task.상세 || task.level || task.레벨 || '').toString().trim();
        if (!typ) continue;
        sheet.appendRow([timestamp, workerName, typ, detail, todayStr, imageCell]);
      }
      return response({ "result": "success", "message": tasks.length + "건의 일일업무가 등록되었습니다." });
    }
    if (action === "manager_edit") {
      var workerName = (params.workerName || '').toString().trim();
      var targetDate = (params.targetDate || '').toString().trim();
      var newInTime = (params.newInTime || '').toString().trim();
      var newOutTime = (params.newOutTime || '').toString().trim();
      if (!workerName || !targetDate || !newInTime || !newOutTime) {
        return response({ "result": "error", "message": "근로자, 날짜, 출근/퇴근 시간을 모두 입력해 주세요." });
      }
      var result = handleEditAttendance(doc, workerName, targetDate, newInTime, newOutTime);
      return response(result);
    }
    if (action === "manager_add_attendance") {
      var workerName = (params.workerName || params.worker_name || '').toString().trim();
      var targetDate = (params.targetDate || params.target_date || '').toString().trim();
      var shift = (params.shift || params.workShift || 'Day').toString().trim();
      var newInTime = (params.newInTime || params.new_in_time || '').toString().trim();
      var newOutTime = (params.newOutTime || params.new_out_time || '').toString().trim();
      var note = (params.note || params.remarks || 'manager_manual_add').toString().trim();
      if (!workerName || !targetDate || !newInTime || !newOutTime) {
        return response({ "result": "error", "message": "근로자, 날짜, 출근/퇴근 시간을 모두 입력해 주세요." });
      }
      var result = handleAddAttendance(doc, workerName, targetDate, shift, newInTime, newOutTime, note);
      return response(result);
    }
    return response({ "result": "success" });
  } catch (err) {
    return response({ "result": "error", "message": err.toString() });
  }
}

/**
 * 시트 구조: Payroll_Daily
 * 1행 헤더: 기록일 | 이름 | 조 | 출근시간 | 퇴근시간 | 근무시간 | 상태 | 비고
 * - 기록일: 해당 출근일 (날짜 또는 YYYY-MM-DD 문자열)
 * - 이름: 근로자 이름 (매니저 화면 선택값과 정확히 일치해야 함)
 * 수동 시간 수정이 반영되려면 이 스크립트가 연결된 스프레드시트의 Payroll_Daily 시트를 사용해야 합니다.
 */
function handleEditAttendance(doc, workerName, targetDate, newInTime, newOutTime) {
  var sheet = doc.getSheetByName('Payroll_Daily');
  if (!sheet) return { "result": "error", "message": "Payroll_Daily 시트가 없습니다. 이 스크립트가 연결된 스프레드시트에 시트를 추가하세요." };
  var data = sheet.getDataRange().getValues();
  if (data.length < 1) return { "result": "error", "message": "수정할 출퇴근 기록이 없습니다." };
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colName = 1;
  for (var c = 0; c < header.length; c++) {
    var h = header[c];
    if (h.indexOf('이름') >= 0 || h === 'name') { colName = c; break; }
  }
  var colIn = 3, colOut = 4, colHours = 5, colStatus = 6;
  for (var c2 = 0; c2 < header.length; c2++) {
    var h2 = header[c2];
    if (h2.indexOf('출근') >= 0 || h2 === 'in') colIn = c2;
    else if (h2.indexOf('퇴근') >= 0 || h2 === 'out') colOut = c2;
    else if (h2.indexOf('근무시간') >= 0 || h2 === 'hours') colHours = c2;
    else if (h2.indexOf('상태') >= 0 || h2 === 'status') colStatus = c2;
  }
  var colRecordDate = -1;
  for (var c3 = 0; c3 < header.length; c3++) {
    var h3 = header[c3];
    if (h3.indexOf('기록') >= 0 || h3.indexOf('date') >= 0 || h3.indexOf('날짜') >= 0) { colRecordDate = c3; break; }
  }
  if (colRecordDate < 0) colRecordDate = 0;

  function toYmd(val) {
    if (val == null || val === '') return '';
    if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Seoul', 'yyyyMMdd');
    var s = String(val).trim().replace(/\D/g, '');
    if (s.length >= 8) return s.slice(0, 8);
    if (s.length === 6) return s + '01';
    return s;
  }
  function normalizeName(str) {
    return String(str || '').trim().replace(/\s+/g, ' ');
  }

  var startRow = 1;
  var firstCell = String(data[0][colName] || '');
  if (firstCell.indexOf('이름') >= 0 || firstCell === 'name') startRow = 1;
  else startRow = 0;
  var targetYmd = toYmd(targetDate);
  if (targetYmd.length < 8) return { "result": "error", "message": "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)" };
  var inParts = (newInTime || '').split(':');
  var outParts = (newOutTime || '').split(':');
  var y = parseInt(targetYmd.slice(0, 4), 10);
  var m = parseInt(targetYmd.slice(4, 6), 10) - 1;
  var d = parseInt(targetYmd.slice(6, 8), 10);
  var inH = parseInt(inParts[0] || '0', 10);
  var inMin = parseInt(inParts[1] || '0', 10);
  var outH = parseInt(outParts[0] || '0', 10);
  var outMin = parseInt(outParts[1] || '0', 10);
  var inDate = new Date(y, m, d, inH, inMin, 0, 0);
  var outDate = new Date(y, m, d, outH, outMin, 0, 0);
  if (outDate.getTime() <= inDate.getTime()) outDate.setTime(outDate.getTime() + 24 * 60 * 60 * 1000);
  var hrs = Math.round(((outDate.getTime() - inDate.getTime()) / (1000 * 60 * 60)) * 10) / 10;
  var status = (hrs >= 8 && hrs <= 10) ? "정상" : (hrs > 10 ? "오버타임" : "조퇴/지각");
  workerName = normalizeName(workerName);
  var foundRow = -1;
  for (var i = startRow; i < data.length; i++) {
    var rowName = normalizeName(data[i][colName]);
    if (rowName !== workerName) continue;
    var rowIn = data[i][colIn];
    var rowRec = colRecordDate >= 0 ? data[i][colRecordDate] : (rowIn != null ? rowIn : data[i][0]);
    var rowYmd = toYmd(rowRec) || toYmd(rowIn);
    if (rowYmd && rowYmd.length >= 8) rowYmd = rowYmd.slice(0, 8);
    if (rowYmd && rowYmd === targetYmd) { foundRow = i + 1; break; }
  }
  if (foundRow < 0) {
    return { "result": "error", "message": "해당 날짜의 출퇴근 기록을 찾을 수 없습니다. (이름: " + workerName + ", 날짜: " + targetDate + "). Payroll_Daily 시트에 '기록일'·'이름' 열과 데이터가 있는지, 웹앱이 이 스프레드시트에 연결되어 있는지 확인하세요." };
  }
  try {
    sheet.getRange(foundRow, colIn + 1).setValue(inDate);
    sheet.getRange(foundRow, colOut + 1).setValue(outDate);
    sheet.getRange(foundRow, colHours + 1).setValue(hrs);
    sheet.getRange(foundRow, colStatus + 1).setValue(status);
    SpreadsheetApp.flush();
  } catch (e) {
    return { "result": "error", "message": "시트 쓰기 실패: " + (e.message || e.toString()) };
  }
  return { "result": "success", "message": "시간 수정이 적용되었습니다." };
}

/**
 * 매니저 수동 근태 추가.
 * Payroll_Daily에 새 행을 추가하며, 동일 인원/동일 날짜/동일 출근시간 중복은 차단.
 */
function handleAddAttendance(doc, workerName, targetDate, shift, newInTime, newOutTime, note) {
  var sheet = doc.getSheetByName('Payroll_Daily');
  if (!sheet) {
    sheet = doc.insertSheet('Payroll_Daily');
    sheet.appendRow(['기록일', '이름', '조', '출근시간', '퇴근시간', '근무시간', '상태', '비고']);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  var data = sheet.getDataRange().getValues();
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colRecordDate = 0, colName = 1, colShift = 2, colIn = 3, colOut = 4, colHours = 5, colStatus = 6, colNote = 7;
  for (var c = 0; c < header.length; c++) {
    var h = header[c];
    if (h.indexOf('기록') >= 0 || h.indexOf('date') >= 0 || h.indexOf('날짜') >= 0) colRecordDate = c;
    else if (h.indexOf('이름') >= 0 || h === 'name') colName = c;
    else if (h === '조' || h === 'shift') colShift = c;
    else if (h.indexOf('출근') >= 0 || h === 'in') colIn = c;
    else if (h.indexOf('퇴근') >= 0 || h === 'out') colOut = c;
    else if (h.indexOf('근무시간') >= 0 || h === 'hours') colHours = c;
    else if (h.indexOf('상태') >= 0 || h === 'status') colStatus = c;
    else if (h.indexOf('비고') >= 0 || h === 'note' || h === 'remarks') colNote = c;
  }

  function toYmd(val) {
    if (val == null || val === '') return '';
    if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Seoul', 'yyyyMMdd');
    var s = String(val).trim().replace(/\D/g, '');
    if (s.length >= 8) return s.slice(0, 8);
    return s;
  }
  function normalizeName(str) {
    return String(str || '').trim().replace(/\s+/g, ' ');
  }

  var targetYmd = toYmd(targetDate);
  if (targetYmd.length < 8) return { "result": "error", "message": "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)" };
  var inParts = (newInTime || '').split(':');
  var outParts = (newOutTime || '').split(':');
  var y = parseInt(targetYmd.slice(0, 4), 10);
  var m = parseInt(targetYmd.slice(4, 6), 10) - 1;
  var d = parseInt(targetYmd.slice(6, 8), 10);
  var inH = parseInt(inParts[0] || '0', 10);
  var inMin = parseInt(inParts[1] || '0', 10);
  var outH = parseInt(outParts[0] || '0', 10);
  var outMin = parseInt(outParts[1] || '0', 10);
  if (isNaN(inH) || isNaN(inMin) || isNaN(outH) || isNaN(outMin)) {
    return { "result": "error", "message": "출근/퇴근 시간 형식이 올바르지 않습니다. (HH:mm)" };
  }
  var inDate = new Date(y, m, d, inH, inMin, 0, 0);
  var outDate = new Date(y, m, d, outH, outMin, 0, 0);
  if (outDate.getTime() <= inDate.getTime()) outDate.setTime(outDate.getTime() + 24 * 60 * 60 * 1000);
  var hrs = Math.round(((outDate.getTime() - inDate.getTime()) / (1000 * 60 * 60)) * 10) / 10;
  if (hrs <= 0 || hrs > 16) {
    return { "result": "error", "message": "근무시간은 0초과 16시간 이하여야 합니다." };
  }
  var status = (hrs >= 8 && hrs <= 10) ? "정상" : (hrs > 10 ? "오버타임" : "조퇴/지각");
  workerName = normalizeName(workerName);
  var inKey = Utilities.formatDate(inDate, 'Asia/Seoul', 'HH:mm');
  for (var i = 1; i < data.length; i++) {
    var rowName = normalizeName(data[i][colName]);
    if (rowName !== workerName) continue;
    var rowYmd = toYmd(data[i][colRecordDate]) || toYmd(data[i][colIn]);
    if (rowYmd !== targetYmd) continue;
    var rowInVal = data[i][colIn];
    var rowIn = '';
    if (rowInVal instanceof Date) {
      rowIn = Utilities.formatDate(rowInVal, 'Asia/Seoul', 'HH:mm');
    } else {
      var mRowIn = String(rowInVal || '').match(/(\d{1,2}):(\d{2})/);
      if (mRowIn) rowIn = mRowIn[1].padStart(2, '0') + ':' + mRowIn[2];
    }
    if (rowIn === inKey) {
      return { "result": "error", "message": "동일 날짜/동일 출근시간 기록이 이미 존재합니다. 기존 기록을 수정해 주세요." };
    }
  }

  try {
    var maxCol = Math.max(sheet.getLastColumn(), colNote + 1);
    var row = [];
    for (var c2 = 0; c2 < maxCol; c2++) row.push('');
    row[colRecordDate] = inDate;
    row[colName] = workerName;
    row[colShift] = shift || 'Day';
    row[colIn] = inDate;
    row[colOut] = outDate;
    row[colHours] = hrs;
    row[colStatus] = status;
    row[colNote] = note || 'manager_manual_add';
    sheet.appendRow(row);
    SpreadsheetApp.flush();
  } catch (e) {
    return { "result": "error", "message": "시트 쓰기 실패: " + (e.message || e.toString()) };
  }
  return { "result": "success", "message": "근태 기록이 추가되었습니다." };
}

function getWorkerTodaySummary(doc, workerName, dateStr) {
  var targetYmd = (dateStr || '').toString().replace(/\D/g, '').slice(0, 8);
  if (targetYmd.length < 8) targetYmd = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
  var farmingTotal = 0;
  var farmingCount = 0;
  var hasDailyTasks = false;
  var fSheet = doc.getSheetByName('Farming');
  if (fSheet && workerName) {
    var fData = fSheet.getDataRange().getValues();
    for (var i = 1; i < fData.length; i++) {
      if (String(fData[i][1] || '').trim() !== workerName) continue;
      var tVal = fData[i][0];
      var rowYmd = '';
      if (tVal instanceof Date) rowYmd = Utilities.formatDate(tVal, 'Asia/Seoul', 'yyyyMMdd');
      else if (tVal) rowYmd = String(tVal).replace(/\D/g, '').slice(0, 8);
      if (rowYmd !== targetYmd) continue;
      farmingTotal += (Number(fData[i][3]) || 0);
      farmingCount++;
    }
  }
  var dSheet = doc.getSheetByName('Daily_Tasks');
  if (dSheet && workerName) {
    var dData = dSheet.getDataRange().getValues();
    var colName = 1;
    var colDate = 4;
    if (dData.length > 0) {
      var h = (dData[0] || []).map(function(x) { return String(x || '').toLowerCase(); });
      for (var c = 0; c < h.length; c++) {
        if (h[c].indexOf('이름') >= 0 || h[c] === 'name') colName = c;
        if (h[c].indexOf('날짜') >= 0 || h[c].indexOf('date') >= 0) colDate = c;
      }
    }
    for (var j = 1; j < dData.length; j++) {
      if (String(dData[j][colName] || '').trim() !== workerName) continue;
      var dVal = dData[j][colDate];
      var dYmd = '';
      if (dVal instanceof Date) dYmd = Utilities.formatDate(dVal, 'Asia/Seoul', 'yyyyMMdd');
      else if (dVal) dYmd = String(dVal).replace(/\D/g, '').slice(0, 8);
      if (dYmd === targetYmd) { hasDailyTasks = true; break; }
    }
  }
  return { farmingTotal: farmingTotal, farmingCount: farmingCount, hasDailyTasks: hasDailyTasks };
}

function getWorkerBalance(doc, workerName) {
  var farmingTotal = 0;
  var exchangeTotal = 0;
  var fSheet = doc.getSheetByName('Farming');
  if (fSheet && workerName) {
    var fData = fSheet.getDataRange().getValues();
    for (var i = 1; i < fData.length; i++) {
      if (String(fData[i][1] || '').trim() !== workerName) continue;
      farmingTotal += (Number(fData[i][3]) || 0);
    }
  }
  var eSheet = doc.getSheetByName('Farming_Exchange');
  if (eSheet && workerName) {
    var eData = eSheet.getDataRange().getValues();
    for (var k = 1; k < eData.length; k++) {
      if (String(eData[k][1] || '').trim() !== workerName) continue;
      exchangeTotal += (Number(eData[k][3]) || 0);
    }
  }
  var balance = farmingTotal - exchangeTotal;
  return { farmingTotal: farmingTotal, exchangeTotal: exchangeTotal, balance: balance };
}

function getFarmingExchangeList(doc, limit) {
  var list = [];
  var sheet = doc.getSheetByName('Farming_Exchange');
  if (!sheet || sheet.getLastRow() < 2) return { list: [] };
  var data = sheet.getDataRange().getValues();
  var start = Math.max(1, data.length - (limit || 50));
  for (var i = data.length - 1; i >= start; i--) {
    var row = data[i];
    var t = row[0];
    var timeStr = t instanceof Date ? Utilities.formatDate(t, 'Asia/Seoul', 'yyyy-MM-dd HH:mm') : String(t || '');
    var hasRate = row.length >= 6;
    list.push({
      time: timeStr,
      workerName: String(row[1] || ''),
      game: String(row[2] || ''),
      amount: Number(row[3]) || 0,
      exchangeRate: hasRate ? (Number(row[4]) || 0) : null,
      note: String(hasRate ? (row[5] || '') : (row[4] || ''))
    });
  }
  return { list: list };
}

/**
 * 워커별 파밍·환전차감·추정 매출 집계. (개인당 돈이 되는지 확인용)
 * params.month 있으면 해당 월만 집계 (yyyy-MM 또는 yyyyMM). 없으면 전체 기간.
 */
function getWorkerRevenueSummary(doc, params) {
  var workersMap = {};
  function addWorker(name) {
    var key = staffNameKey(name);
    if (!key) return;
    if (!workersMap[key]) workersMap[key] = { workerName: String(name || '').trim(), farmingByGame: {}, exchangeByGame: {}, farmingTotal: 0, exchangeTotal: 0 };
  }

  var monthParam = (params.month || '').toString().trim().replace(/\D/g, '').slice(0, 6);
  function rowToYmd(row, colDate) {
    if (!row || row.length === 0) return '';
    var val = row[colDate != null ? colDate : 0];
    if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Seoul', 'yyyyMM');
    var s = String(val || '').trim();
    var m = s.match(/(\d{4})[-\/\s]*(\d{1,2})/);
    if (m) return m[1] + (m[2].length === 1 ? '0' + m[2] : m[2]).slice(-2);
    return s.replace(/\D/g, '').slice(0, 6);
  }
  function inMonth(row, colDate) {
    if (!monthParam || monthParam.length < 6) return true;
    return rowToYmd(row, colDate) === monthParam;
  }

  var fSheet = doc.getSheetByName('Farming');
  if (fSheet && fSheet.getLastRow() >= 2) {
    var fData = fSheet.getDataRange().getValues();
    for (var fi = 1; fi < fData.length; fi++) {
      if (!inMonth(fData[fi], 0)) continue;
      var name = String(fData[fi][1] || '').trim();
      var game = String(fData[fi][2] || '').trim();
      var qty = Number(fData[fi][3]) || 0;
      if (!name) continue;
      addWorker(name);
      var key = staffNameKey(name);
      if (!workersMap[key]) continue;
      workersMap[key].farmingByGame[game] = (workersMap[key].farmingByGame[game] || 0) + qty;
      workersMap[key].farmingTotal += qty;
    }
  }

  var eSheet = doc.getSheetByName('Farming_Exchange');
  if (eSheet && eSheet.getLastRow() >= 2) {
    var eData = eSheet.getDataRange().getValues();
    for (var ei = 1; ei < eData.length; ei++) {
      if (!inMonth(eData[ei], 0)) continue;
      var name = String(eData[ei][1] || '').trim();
      var game = String(eData[ei][2] || '').trim();
      var qty = Number(eData[ei][3]) || 0;
      if (!name) continue;
      addWorker(name);
      var key = staffNameKey(name);
      if (!workersMap[key]) continue;
      workersMap[key].exchangeByGame[game] = (workersMap[key].exchangeByGame[game] || 0) + qty;
      workersMap[key].exchangeTotal += qty;
    }
  }

  var rateByGame = {};
  var ledgerSh = doc.getSheetByName('매출장부');
  if (ledgerSh && ledgerSh.getLastRow() >= 2) {
    var lData = ledgerSh.getDataRange().getValues();
    var h = (lData[0] || []).map(function (x) { return String(x || '').toLowerCase(); });
    var colGame = h.indexOf('게임') >= 0 ? h.indexOf('게임') : 1;
    var colQty = h.indexOf('수량') >= 0 ? h.indexOf('수량') : 2;
    var colPHP = -1;
    for (var hi = 0; hi < h.length; hi++) {
      if (h[hi].indexOf('php') >= 0 || h[hi].indexOf('매출') >= 0) { colPHP = hi; break; }
    }
    if (colPHP < 0) colPHP = 4;
    var sumByGame = {};
    var phpByGame = {};
    for (var li = 1; li < lData.length; li++) {
      var game = String(lData[li][colGame] || '').trim();
      var qty = Number(lData[li][colQty]) || 0;
      var php = Number(lData[li][colPHP]) || 0;
      if (!game || (qty <= 0 && php <= 0)) continue;
      sumByGame[game] = (sumByGame[game] || 0) + qty;
      phpByGame[game] = (phpByGame[game] || 0) + php;
    }
    for (var g in sumByGame) {
      rateByGame[g] = sumByGame[g] > 0 ? (phpByGame[g] || 0) / sumByGame[g] : 0;
    }
  }

  var list = [];
  for (var k in workersMap) {
    var w = workersMap[k];
    var estPHP = 0;
    for (var game in w.exchangeByGame) {
      var rate = (rateByGame[game] != null && rateByGame[game] > 0) ? rateByGame[game] : 1;
      estPHP += (w.exchangeByGame[game] || 0) * rate;
    }
    w.estimatedRevenuePHP = Math.round(estPHP);
    w.balance = w.farmingTotal - w.exchangeTotal;
    list.push(w);
  }
  list.sort(function (a, b) {
    return (b.estimatedRevenuePHP || 0) - (a.estimatedRevenuePHP || 0);
  });
  return { workers: list, rateByGame: rateByGame };
}

function plMonthStr(d) {
  var y = d.getFullYear();
  var mm = d.getMonth() + 1;
  return y + '-' + (mm < 10 ? '0' + mm : String(mm));
}
function staffNameKey(s) {
  return String(s || '').trim().toLowerCase();
}
function staffNameMatch(a, b) {
  return staffNameKey(a) === staffNameKey(b);
}
function findColContain(headers, substrings, defaultIdx) {
  for (var s = 0; s < substrings.length; s++) {
    var sub = String(substrings[s] || '').toLowerCase();
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || '').toLowerCase();
      if (h.indexOf(sub) >= 0) return i;
    }
  }
  return defaultIdx;
}

function getPLDashboard(doc, monthStr) {
  var targetYmd = (monthStr || '').toString().replace(/\D/g, '').slice(0, 6);
  if (targetYmd.length < 6) targetYmd = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMM');
  var totalRevenue = 0, aion = 0, lineage = 0, expensePHP = 0, estimatedPayroll = 0;
  try {
    var revSh = doc.getSheetByName('Revenue_Logs');
    if (revSh && revSh.getLastRow() >= 2) {
      var rData = revSh.getDataRange().getValues();
      var rHeader = (rData[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
      var colDate = findColContain(rHeader, ['date', '일자', '날짜'], 1);
      var colStatus = findColContain(rHeader, ['status', '상태'], 7);
      var colFinal = findColContain(rHeader, ['final_revenue', 'final revenue', '매출', 'revenue'], 5);
      var colGame = findColContain(rHeader, ['game_type', 'game type', '게임'], 2);
      for (var i = 1; i < rData.length; i++) {
        if (String(rData[i][colStatus] || '').toLowerCase() !== 'approved') continue;
        var dVal = rData[i][colDate];
        var rowYmd = '';
        if (dVal instanceof Date) rowYmd = Utilities.formatDate(dVal, 'Asia/Seoul', 'yyyyMM');
        else if (dVal) rowYmd = String(dVal).replace(/\D/g, '').slice(0, 6);
        if (rowYmd !== targetYmd) continue;
        var fin = Number(rData[i][colFinal]) || 0;
        totalRevenue += fin;
        var gt = String(rData[i][colGame] || '').toLowerCase();
        if (gt.indexOf('aion') >= 0) aion += fin;
        else if (gt.indexOf('lineage') >= 0) lineage += fin;
      }
    }
    if (totalRevenue === 0) {
      var mSheet = doc.getSheetByName('매출장부');
      if (mSheet && mSheet.getLastRow() >= 2) {
        var mData = mSheet.getDataRange().getValues();
        var mHeader = (mData[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
        var col일자 = findColContain(mHeader, ['일자', 'date', '날짜'], 0);
        var colPHP = findColContain(mHeader, ['php', '매출', 'revenue'], 4);
        for (var j = 1; j < mData.length; j++) {
          var md = mData[j][col일자];
          var mymd = md instanceof Date ? Utilities.formatDate(md, 'Asia/Seoul', 'yyyyMM') : String(md || '').replace(/\D/g, '').slice(0, 6);
          if (mymd === targetYmd) totalRevenue += (Number(mData[j][colPHP]) || 0);
        }
      }
    }
    var expSh = doc.getSheetByName('Expenses');
    if (expSh && expSh.getLastRow() >= 2) {
      var eData = expSh.getDataRange().getValues();
      var eHeader = (eData[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
      var colDateExp = findColContain(eHeader, ['date', '날짜', '시간'], 0);
      var colCostExp = findColContain(eHeader, ['cost', '금액', 'amount'], 3);
      for (var k = 1; k < eData.length; k++) {
        var ed = eData[k][colDateExp];
        var ey = ed instanceof Date ? Utilities.formatDate(ed, 'Asia/Seoul', 'yyyyMM') : String(ed || '').replace(/\D/g, '').slice(0, 6);
        if (ey === targetYmd) expensePHP += (Number(eData[k][colCostExp]) || 0);
      }
    }
    var msSh = doc.getSheetByName('Monthly_Salary');
    if (msSh && msSh.getLastRow() >= 2) {
      var msData = msSh.getDataRange().getValues();
      var msHeaderRaw = (msData[0] || []).map(function(h) { return String(h || ''); });
      var msHeader = msHeaderRaw.map(function(h) { return h.trim().toLowerCase(); });
      var colMonth = findColContain(msHeader, ['정산월', 'month', '정산'], 6);
      var colPay = findColContain(msHeader, ['최종', '지급액', 'pay', 'final'], 5);
      if (colPay < 0) colPay = 5;
      for (var m = 1; m < msData.length; m++) {
        var msMonth = String(msData[m][colMonth] || '').replace(/\D/g, '').slice(0, 6);
        if (msMonth === targetYmd) estimatedPayroll += (Number(msData[m][colPay]) || 0);
      }
    }
    if (estimatedPayroll === 0) {
      var staffSh = doc.getSheetByName('Staff_List');
      var pSh = doc.getSheetByName('Payroll_Daily');
      if (staffSh && pSh && staffSh.getLastRow() >= 2 && pSh.getLastRow() >= 2) {
        var staffData = staffSh.getDataRange().getValues();
        var wageMap = {};
        for (var si = 1; si < staffData.length; si++) {
          var sk = staffNameKey(staffData[si][1]);
          if (sk) wageMap[sk] = { wage: Number(staffData[si][6]) || 0, type: String(staffData[si][7] || ''), otRate: Number(staffData[si][8]) || 1 };
        }
        var pData = pSh.getDataRange().getValues();
        var pHeader = (pData[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
        var colPDate = findColContain(pHeader, ['기록일', 'date', '날짜'], 0);
        var colPName = findColContain(pHeader, ['이름', 'name'], 1);
        var colPHrs = findColContain(pHeader, ['근무시간', 'hours', '근무'], 5);
        var monthlyAdded = {};
        for (var pi = 1; pi < pData.length; pi++) {
          var pr = pData[pi][colPDate];
          var pymd = pr instanceof Date ? Utilities.formatDate(pr, 'Asia/Seoul', 'yyyyMM') : String(pr || '').replace(/\D/g, '').slice(0, 6);
          if (pymd !== targetYmd) continue;
          var pNameKey = staffNameKey(pData[pi][colPName]);
          var pHrs = Number(pData[pi][colPHrs]) || 0;
          var sw = wageMap[pNameKey];
          if (!sw) continue;
          if (sw.type === '시급') {
            var reg = Math.min(pHrs, 8), ot = Math.max(0, pHrs - 8);
            estimatedPayroll += reg * sw.wage + ot * sw.wage * sw.otRate;
          } else {
            if (!monthlyAdded[pNameKey]) { estimatedPayroll += sw.wage; monthlyAdded[pNameKey] = true; }
          }
        }
      }
    }
  } catch (e) {
    totalRevenue = totalRevenue || 0;
    expensePHP = expensePHP || 0;
    estimatedPayroll = estimatedPayroll || 0;
  }
  var totalExpenditure = estimatedPayroll + expensePHP;
  return {
    totalRevenue: totalRevenue,
    revenue: totalRevenue,
    total_revenue: totalRevenue,
    aion: aion,
    lineage: lineage,
    estimatedPayroll: estimatedPayroll,
    salary: estimatedPayroll,
    estimated_payroll: estimatedPayroll,
    expensePHP: expensePHP,
    operatingExpenses: expensePHP,
    expense_php: expensePHP,
    totalExpenditure: totalExpenditure
  };
}

function getPLTrend(doc, monthsCount) {
  var trend = [];
  var d = new Date();
  for (var i = 0; i < (monthsCount || 6); i++) {
    var m = plMonthStr(d);
    var dash = getPLDashboard(doc, m);
    var rev = Number(dash.totalRevenue || 0);
    var exp = Number(dash.estimatedPayroll || 0) + Number(dash.expensePHP || 0);
    trend.unshift({ month: m, revenue: rev, netProfit: Math.max(0, rev - exp) });
    d.setMonth(d.getMonth() - 1);
  }
  return { trend: trend };
}

function getPLReport(doc, monthsCount) {
  var months = Math.min(Math.max(monthsCount || 12, 1), 24);
  var rows = [];
  var d = new Date();
  for (var i = 0; i < months; i++) {
    var m = plMonthStr(d);
    var dash = getPLDashboard(doc, m);
    var rev = Number(dash.totalRevenue || 0);
    var payroll = Number(dash.estimatedPayroll || 0);
    var op = Number(dash.expensePHP || 0);
    var totalExp = payroll + op;
    var net = rev - totalExp;
    rows.unshift({ month: m, revenue: rev, payroll: payroll, operating: op, totalExp: totalExp, net: net });
    d.setMonth(d.getMonth() - 1);
  }
  return { data: rows };
}

function syncPLToSheet(doc, monthsCount) {
  try {
    var sh = doc.getSheetByName('손익계산서');
    if (!sh) {
      sh = doc.insertSheet('손익계산서');
    }
    var months = Math.min(Math.max(monthsCount || 12, 1), 24);
    var d = new Date();
    var rows = [['정산월', '매출 (PHP)', '급여 (PHP)', '운영비 (PHP)', '총지출 (PHP)', '순손익 (PHP)']];
    for (var i = 0; i < months; i++) {
      var m = plMonthStr(d);
      var dash = getPLDashboard(doc, m);
      var rev = Number(dash.totalRevenue || 0);
      var payroll = Number(dash.estimatedPayroll || 0);
      var opEx = Number(dash.expensePHP || 0);
      var totalExp = payroll + opEx;
      var net = rev - totalExp;
      rows.push([m, rev, payroll, opEx, totalExp, net]);
      d.setMonth(d.getMonth() - 1);
    }
    sh.clear();
    sh.getRange(1, 1, rows.length, 6).setValues(rows);
    sh.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#1e3a5f').setFontColor('#ffffff');
    sh.autoResizeColumns(1, 6);
    sh.activate(); // 탭 클릭하여 시트 바로 보이게
    var sheetUrl = doc.getUrl() + '#gid=' + sh.getSheetId();
    return { success: true, rows: rows.length - 1, spreadsheetUrl: doc.getUrl(), sheetUrl: sheetUrl, sheetName: '손익계산서' };
  } catch (e) {
    return { error: e.toString(), message: '손익계산서 시트 동기화 실패' };
  }
}

var REVENUE_GAME_LABELS = { 'aion': '아이온2(키나)', 'lineage': '리니지(아덴)' };
var REVENUE_DEFAULT_KRW = 23;

function getRevenueManagerName(doc, managerId) {
  if (!managerId) return '-';
  var sh = doc.getSheetByName('Users');
  if (!sh) return managerId;
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === String(managerId).trim()) return String(data[i][2] || managerId).trim() || managerId;
  }
  return managerId;
}

function getRevenueRole(doc, userId) {
  if (!userId) return '';
  var sh = doc.getSheetByName('Users');
  if (!sh) return '';
  var data = sh.getDataRange().getValues();
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colRole = header.indexOf('role') >= 0 ? header.indexOf('role') : 6;
  var colId = header.indexOf('userid') >= 0 ? header.indexOf('userid') : 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colId] || '').trim() === String(userId).trim()) return String(data[i][colRole] || '').trim();
  }
  return '';
}

/** 주주 지분율 조회. 시트 없으면 빈 배열 반환. */
function handleGetShareholders(doc, params) {
  var userId = (params.userId || '').toString().trim();
  var role = getRevenueRole(doc, userId) || (params.role || '').toString().trim();
  if (role === 'Manager') return { error: 'Forbidden', status: 403, shareholders: [] };
  var sh = doc.getSheetByName('Shareholders');
  if (!sh || sh.getLastRow() < 2) return { shareholders: [] };
  var data = sh.getDataRange().getValues();
  var shareholders = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[0]) {
      shareholders.push({
        shareholder_id: String(row[0] || ''),
        name: String(row[1] || ''),
        share_percentage: parseFloat(row[2]) || 0,
        updated_at: row[3] ? Utilities.formatDate(new Date(row[3]), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : ''
      });
    }
  }
  return { shareholders: shareholders };
}

/** 주주 지분율 저장. 시트 없으면 자동 생성. */
function handleUpsertShareholders(doc, params) {
  try {
    var userId = (params.userId || params.user_id || '').toString().trim();
    var role = getRevenueRole(doc, userId) || (params.role || '').toString().trim();
    if (role === 'Manager') return { error: 'Forbidden', status: 403 };
    var jsonStr = params.shareholders || params.shareholders_snapshot || '[]';
    var list;
    try { list = JSON.parse(jsonStr); } catch (e) { return { error: 'Invalid shareholders JSON' }; }
    if (!Array.isArray(list)) return { error: 'shareholders must be array' };
    var sum = list.reduce(function(s, r) { return s + (parseFloat(r.share_percentage) || 0); }, 0);
    if (Math.abs(sum - 100) > 0.01) return { error: '지분율 합계가 100%여야 합니다. (현재: ' + sum.toFixed(2) + '%)' };
    var sh = doc.getSheetByName('Shareholders');
    var sheetCreated = false;
    if (!sh) {
      sh = doc.insertSheet('Shareholders');
      var headers = ['shareholder_id', 'name', 'share_percentage', 'updated_at'];
      for (var h = 0; h < headers.length; h++) {
        sh.getRange(1, 1 + h).getCell(1, 1).setValue(headers[h]);
        sh.getRange(1, 1 + h).getCell(1, 1).setFontWeight('bold');
      }
      sheetCreated = true;
    }
    var now = new Date();
    var rows = [];
    list.forEach(function(item, idx) {
      var id = String(item.shareholder_id || '').trim();
      var name = String(item.name || item.shareholder_name || '').trim();
      var pct = parseFloat(item.share_percentage || item.sharePercentage) || 0;
      rows.push([id || ('sh' + (idx + 1)), name || ('주주 ' + (idx + 1)), pct, now]);
    });
    var lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      for (var r = 2; r <= lastRow; r++) {
        for (var c = 1; c <= 4; c++) sh.getRange(r, c).getCell(1, 1).setValue('');
      }
    }
    if (rows.length > 0) {
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < 4; c++) {
          sh.getRange(2 + r, 1 + c).getCell(1, 1).setValue(rows[r][c]);
        }
      }
    }
    return { success: true, updated: rows.length, sheetCreated: sheetCreated };
  } catch (err) {
    return { error: '주주 저장 중 오류: ' + (err.message || err.toString()) };
  }
}

function handleGetRevenueLogs(doc, p) {
  var sh = doc.getSheetByName('Revenue_Logs');
  if (!sh || sh.getLastRow() < 2) return { logs: [] };
  var data = sh.getDataRange().getValues();
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var idx = function(n) { var i = header.indexOf(n); return i >= 0 ? i : -1; };
  var colLogId = idx('log_id') >= 0 ? idx('log_id') : 0;
  var colDate = idx('date') >= 0 ? idx('date') : 1;
  var colGame = idx('game_type') >= 0 ? idx('game_type') : 2;
  var colAmount = idx('currency_amount') >= 0 ? idx('currency_amount') : 3;
  var colRate = idx('exchange_rate') >= 0 ? idx('exchange_rate') : 4;
  var colFinal = idx('final_revenue') >= 0 ? idx('final_revenue') : 5;
  var colManager = idx('manager_id') >= 0 ? idx('manager_id') : 6;
  var colStatus = idx('status') >= 0 ? idx('status') : 7;
  var colReject = idx('reject_reason') >= 0 ? idx('reject_reason') : 8;
  var list = [];
  var managerId = (p.managerId || p.manager_id || '').toString().trim();
  var statusFilter = (p.status || '').toString().toLowerCase();
  var fromDate = (p.fromDate || p.from_date || '').toString().replace(/\D/g, '');
  var toDate = (p.toDate || p.to_date || '').toString().replace(/\D/g, '');
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (managerId && String(row[colManager] || '').trim() !== managerId) continue;
    if (statusFilter) {
      var st = String(row[colStatus] || '').toLowerCase();
      if (st !== statusFilter) continue;
    }
    var dStr = (row[colDate] || '').toString().replace(/\D/g, '').slice(0, 8);
    if (fromDate && dStr < fromDate) continue;
    if (toDate && dStr > toDate) continue;
    list.push({
      log_id: String(row[colLogId] || ''),
      date: row[colDate],
      game_type: String(row[colGame] || ''),
      currency_amount: Number(row[colAmount]) || 0,
      exchange_rate: Number(row[colRate]) || 0,
      final_revenue: Number(row[colFinal]) || 0,
      manager_id: String(row[colManager] || ''),
      manager_name: getRevenueManagerName(doc, row[colManager]),
      status: String(row[colStatus] || 'pending'),
      reject_reason: String(row[colReject] || '')
    });
  }
  return { logs: list };
}

/** 매출장부 시트 조회. params: month (YYYY-MM), fromDate, toDate, limit. */
function getRevenueLedger(doc, params) {
  var sh = doc.getSheetByName('매출장부');
  if (!sh || sh.getLastRow() < 2) return { rows: [], totalPHP: 0, totalKRW: 0 };
  var data = sh.getDataRange().getValues();
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colDate = header.indexOf('일자') >= 0 ? header.indexOf('일자') : (header.indexOf('date') >= 0 ? header.indexOf('date') : 0);
  var colGame = header.indexOf('게임') >= 0 ? header.indexOf('게임') : (header.indexOf('game') >= 0 ? header.indexOf('game') : 1);
  var colQty = header.indexOf('수량') >= 0 ? header.indexOf('수량') : (header.indexOf('amount') >= 0 ? header.indexOf('amount') : 2);
  var colRate = header.indexOf('시세') >= 0 ? header.indexOf('시세') : (header.indexOf('rate') >= 0 ? header.indexOf('rate') : 3);
  var colPHP = -1, colKRW = -1;
  for (var hi = 0; hi < header.length; hi++) {
    if (colPHP < 0 && (header[hi].indexOf('php') >= 0 || header[hi].indexOf('매출') >= 0)) colPHP = hi;
    if (colKRW < 0 && (header[hi].indexOf('krw') >= 0 || header[hi].indexOf('원화') >= 0 || header[hi].indexOf('환산') >= 0)) colKRW = hi;
  }
  if (colPHP < 0) colPHP = 4;
  if (colKRW < 0) colKRW = 5;
  var colManager = header.indexOf('매니저') >= 0 ? header.indexOf('매니저') : (header.indexOf('manager') >= 0 ? header.indexOf('manager') : 6);
  var colStatus = header.indexOf('상태') >= 0 ? header.indexOf('상태') : (header.indexOf('status') >= 0 ? header.indexOf('status') : 7);

  var monthParam = (params.month || '').toString().trim().replace(/\D/g, '').slice(0, 6);
  var fromParam = (params.fromDate || params.from_date || '').toString().replace(/\D/g, '').slice(0, 8);
  var toParam = (params.toDate || params.to_date || '').toString().replace(/\D/g, '').slice(0, 8);
  var limit = Math.min(parseInt(params.limit, 10) || 500, 2000);
  var tz = Session.getScriptTimeZone() || 'Asia/Seoul';
  var rows = [];
  var totalPHP = 0, totalKRW = 0;
  for (var i = 1; i < data.length && rows.length < limit; i++) {
    var row = data[i];
    var dateVal = row[colDate];
    var rowYmd = '';
    var effectiveDate = null;
    if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
      effectiveDate = dateVal;
      rowYmd = Utilities.formatDate(dateVal, tz, 'yyyyMMdd');
    } else {
      var d = new Date(dateVal);
      if (!isNaN(d.getTime())) {
        effectiveDate = d;
        rowYmd = Utilities.formatDate(d, tz, 'yyyyMMdd');
      } else {
        rowYmd = String(dateVal || '').replace(/\D/g, '').slice(0, 8);
      }
    }
    var rowMonth = rowYmd.length >= 6 ? rowYmd.slice(0, 6) : '';
    if (monthParam && rowMonth !== monthParam) continue;
    if (fromParam && rowYmd < fromParam) continue;
    if (toParam && rowYmd > toParam) continue;
    var php = Number(row[colPHP] != null ? row[colPHP] : 0) || 0;
    var krw = Number(row[colKRW] != null ? row[colKRW] : 0) || 0;
    totalPHP += php;
    totalKRW += krw;
    var dateStr = effectiveDate ? Utilities.formatDate(effectiveDate, tz, 'yyyy-MM-dd') : (dateVal instanceof Date ? Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd') : String(dateVal || '').trim());
    rows.push({
      date: dateStr,
      game: String(row[colGame] != null ? row[colGame] : '').trim(),
      amount: row[colQty] != null ? row[colQty] : '',
      rate: row[colRate] != null ? row[colRate] : '',
      revenuePHP: php,
      revenueKRW: krw,
      manager: String(row[colManager] != null ? row[colManager] : '').trim(),
      status: String(row[colStatus] != null ? row[colStatus] : '').trim()
    });
  }
  rows.sort(function(a, b) {
    var da = (a.date || '').replace(/\D/g, '');
    var db = (b.date || '').replace(/\D/g, '');
    return db.localeCompare(da);
  });
  return { rows: rows, totalPHP: totalPHP, totalKRW: totalKRW };
}

function handleInsertRevenue(doc, params) {
  var date = (params.date || '').toString().trim();
  var gameType = (params.game_type || params.gameType || '').toString().trim().toLowerCase();
  var amt = parseFloat(params.currency_amount || params.currencyAmount) || 0;
  var rate = parseFloat(params.exchange_rate || params.exchangeRate) || 0;
  var finalRev = parseFloat(params.final_revenue || params.finalRevenue) || amt * rate;
  var managerId = (params.manager_id || params.managerId || '').toString().trim();
  if (!date) return { error: 'date required' };
  var sh = doc.getSheetByName('Revenue_Logs');
  if (!sh) {
    doc.insertSheet('Revenue_Logs');
    sh = doc.getSheetByName('Revenue_Logs');
    sh.appendRow(['log_id', 'date', 'game_type', 'currency_amount', 'exchange_rate', 'final_revenue', 'manager_id', 'status', 'reject_reason']);
    sh.getRange(1, 1, 1, 9).setBackground('#334155').setFontColor('#ffffff').setFontWeight('bold');
  }
  var logId = 'rev_' + Utilities.getUuid().slice(0, 8);
  sh.appendRow([logId, date, gameType, amt, rate, finalRev, managerId, 'pending', '']);
  return { log_id: logId };
}

/** 날짜 값을 매출장부/환전장부용 YYYY-MM-DD 문자열로 통일 */
function formatRevenueDate(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Seoul', 'yyyy-MM-dd');
  var s = String(val).trim();
  if (!s) return '';
  var digits = s.replace(/\D/g, '');
  if (digits.length >= 8) return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
  var m = s.match(/(\d{4})[-\/.]?(\d{1,2})[-\/.]?(\d{1,2})/);
  if (m) return m[1] + '-' + (m[2].length === 1 ? '0' + m[2] : m[2]) + '-' + (m[3].length === 1 ? '0' + (m[3] || '01') : (m[3] || '01'));
  return s;
}

function appendRevenueToSheets(doc, row) {
  var date = formatRevenueDate(row.date || '');
  var gameType = (row.game_type || row.gameType || '').toString().toLowerCase();
  var game = REVENUE_GAME_LABELS[gameType] || gameType || '-';
  var amt = parseFloat(row.currency_amount || row.currencyAmount) || 0;
  var rate = parseFloat(row.exchange_rate || row.exchangeRate) || 0;
  var finalPhp = parseFloat(row.final_revenue || row.finalRevenue) || amt * rate;
  var krw = Math.floor(finalPhp * REVENUE_DEFAULT_KRW);
  var managerName = row.manager_name || row.managerName || getRevenueManagerName(doc, row.manager_id || row.managerId);
  var okExchange = false;
  var exSh = doc.getSheetByName('ExchangeLedger');
  if (!exSh) {
    doc.insertSheet('ExchangeLedger');
    exSh = doc.getSheetByName('ExchangeLedger');
    exSh.appendRow(['날짜', '게임', '매각 수량', '적용 시세', '최종 매출(PHP)', '원화 환산(KRW)', '담당 매니저']);
    exSh.getRange(1, 1, 1, 7).setBackground('#059669').setFontColor('#ffffff').setFontWeight('bold');
  }
  exSh.appendRow([date, game, amt, rate, finalPhp, krw, managerName]);
  exSh.getRange(exSh.getLastRow(), 3, exSh.getLastRow(), 6).setNumberFormat('#,##0');
  okExchange = true;
  var revSh = doc.getSheetByName('매출장부');
  if (!revSh) {
    doc.insertSheet('매출장부');
    revSh = doc.getSheetByName('매출장부');
    revSh.appendRow(['일자', '게임', '수량', '시세', 'PHP매출', 'KRW환산', '매니저', '상태']);
    revSh.getRange(1, 1, 1, 8).setBackground('#334155').setFontColor('#ffffff').setFontWeight('bold');
  }
  revSh.appendRow([date, game, amt, rate, finalPhp, krw, managerName, '승인완료']);
  revSh.getRange(revSh.getLastRow(), 3, revSh.getLastRow(), 6).setNumberFormat('#,##0');
  return okExchange;
}

function handleApproveRevenueLog(doc, params) {
  var userId = (params.userId || params.user_id || '').toString().trim();
  var role = (getRevenueRole(doc, userId) || (params.role || '').toString().trim() || '').trim();
  if (String(role).toLowerCase() !== 'admin') return { error: 'Admin only', status: 403 };
  var logId = (params.log_id || '').toString().trim();
  if (!logId) return { error: 'log_id required' };
  var sh = doc.getSheetByName('Revenue_Logs');
  if (!sh) return { error: 'Revenue_Logs sheet not found' };
  var data = sh.getDataRange().getValues();
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colLogId = header.indexOf('log_id') >= 0 ? header.indexOf('log_id') : 0;
  var colStatus = header.indexOf('status') >= 0 ? header.indexOf('status') : 7;
  var approvedRow = -1;
  var rowData = null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colLogId] || '').trim() === logId) {
      var st = String(data[i][colStatus] || '').toLowerCase();
      if (st === 'pending') {
        approvedRow = i + 1;
        rowData = {
          date: data[i][1],
          game_type: String(data[i][2] || ''),
          currency_amount: parseFloat(data[i][3]) || 0,
          exchange_rate: parseFloat(data[i][4]) || 0,
          final_revenue: parseFloat(data[i][5]) || 0,
          manager_id: String(data[i][6] || ''),
          manager_name: getRevenueManagerName(doc, data[i][6])
        };
        break;
      }
      if (st === 'approved') return { error: 'Already approved' };
      return { error: 'Cannot approve rejected log' };
    }
  }
  if (approvedRow < 0 || !rowData) return { error: 'Log not found or not pending' };
  sh.getRange(approvedRow, colStatus + 1).setValue('approved');
  var sheetSynced = appendRevenueToSheets(doc, rowData);
  return { log_id: logId, sheetSynced: sheetSynced };
}

function handleSyncRevenueToLedger(doc, params) {
  var userId = (params.userId || params.user_id || '').toString().trim();
  var role = (getRevenueRole(doc, userId) || (params.role || '').toString().trim() || '').trim();
  if (String(role).toLowerCase() !== 'admin') return { error: 'Admin only', status: 403 };
  var logId = (params.log_id || '').toString().trim();
  if (!logId) return { error: 'log_id required' };
  var sh = doc.getSheetByName('Revenue_Logs');
  if (!sh) return { error: 'Revenue_Logs not found' };
  var data = sh.getDataRange().getValues();
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colLogId = header.indexOf('log_id') >= 0 ? header.indexOf('log_id') : 0;
  var colStatus = header.indexOf('status') >= 0 ? header.indexOf('status') : 7;
  var rowData = null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colLogId] || '').trim() === logId && String(data[i][colStatus] || '').toLowerCase() === 'approved') {
      rowData = {
        date: data[i][1],
        game_type: String(data[i][2] || ''),
        currency_amount: parseFloat(data[i][3]) || 0,
        exchange_rate: parseFloat(data[i][4]) || 0,
        final_revenue: parseFloat(data[i][5]) || 0,
        manager_id: String(data[i][6] || ''),
        manager_name: getRevenueManagerName(doc, data[i][6])
      };
      break;
    }
  }
  if (!rowData) return { error: 'Approved log not found' };
  appendRevenueToSheets(doc, rowData);
  return {};
}

/** Daily_Tasks 시트에서 일일업무 목록 조회. params: { date, workerName, limit }. */
function getDailyTaskList(doc, params) {
  var sheet = doc.getSheetByName('Daily_Tasks');
  if (!sheet || sheet.getLastRow() < 2) return { tasks: [] };
  var data = sheet.getDataRange().getValues();
  var dateFilter = (params.date || '').toString().trim().replace(/\D/g, '').slice(0, 8);
  var workerFilter = (params.workerName || '').toString().trim();
  var limit = Math.min(parseInt(params.limit, 10) || 500, 1000);
  var tasks = [];
  var tz = Session.getScriptTimeZone() || 'Asia/Seoul';
  for (var i = data.length - 1; i >= 1 && tasks.length < limit; i--) {
    var row = data[i];
    var timeVal = row[0];
    var workerName = String(row[1] || '').trim();
    var type = String(row[2] || '').trim();
    var detail = String(row[3] || '').trim();
    var dateVal = row[4];
    var imageVal = row.length > 5 ? (row[5] || '') : '';
    var imageUrl = (typeof imageVal === 'string' && imageVal.indexOf('data:') === 0) ? imageVal : (imageVal ? String(imageVal) : '');
    var rowYmd = '';
    if (dateVal instanceof Date) {
      rowYmd = Utilities.formatDate(dateVal, tz, 'yyyyMMdd');
    } else {
      rowYmd = String(dateVal || '').replace(/\D/g, '').slice(0, 8);
    }
    if (dateFilter && rowYmd !== dateFilter) continue;
    if (workerFilter && workerName !== workerFilter) continue;
    var timeStr = timeVal instanceof Date ? Utilities.formatDate(timeVal, tz, 'yyyy-MM-dd HH:mm') : String(timeVal || '');
    var taskItem = {
      time: timeStr,
      workerName: workerName,
      type: type,
      detail: detail,
      date: rowYmd ? rowYmd.slice(0, 4) + '-' + rowYmd.slice(4, 6) + '-' + rowYmd.slice(6, 8) : ''
    };
    if (imageUrl) taskItem.image = imageUrl;
    tasks.push(taskItem);
  }
  return { tasks: tasks };
}

function getDailyAttendanceList(doc, dateStr) {
  var sheet = doc.getSheetByName('Payroll_Daily');
  if (!sheet) return { attendance: [] };
  var data = sheet.getDataRange().getValues();
  if (data.length < 1) return { attendance: [] };
  var tz = 'Asia/Seoul';
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colRecordDate = header.indexOf('기록일') >= 0 ? header.indexOf('기록일') : (header.indexOf('date') >= 0 ? header.indexOf('date') : 0);
  var colName = header.indexOf('이름') >= 0 ? header.indexOf('이름') : (header.indexOf('name') >= 0 ? header.indexOf('name') : 1);
  var colShift = header.indexOf('조') >= 0 ? header.indexOf('조') : (header.indexOf('shift') >= 0 ? header.indexOf('shift') : 2);
  var colIn = header.indexOf('출근시간') >= 0 ? header.indexOf('출근시간') : (header.indexOf('출근') >= 0 ? header.indexOf('출근') : (header.indexOf('in') >= 0 ? header.indexOf('in') : 3));
  var colOut = header.indexOf('퇴근시간') >= 0 ? header.indexOf('퇴근시간') : (header.indexOf('퇴근') >= 0 ? header.indexOf('퇴근') : (header.indexOf('out') >= 0 ? header.indexOf('out') : 4));
  var colHours = header.indexOf('근무시간') >= 0 ? header.indexOf('근무시간') : (header.indexOf('hours') >= 0 ? header.indexOf('hours') : 5);
  var colStatus = header.indexOf('상태') >= 0 ? header.indexOf('상태') : (header.indexOf('status') >= 0 ? header.indexOf('status') : 6);
  var startRow = 1;
  if (header[colName] && (header[colName].indexOf('이름') >= 0 || header[colName].indexOf('name') >= 0)) startRow = 1;
  else startRow = 0;
  var targetYmd = (dateStr || '').toString().replace(/\D/g, '').slice(0, 8);
  if (targetYmd.length < 8) {
    targetYmd = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  }
  function toYmd(val) {
    if (!val) return '';
    if (val instanceof Date) return Utilities.formatDate(val, tz, 'yyyyMMdd');
    return String(val).replace(/\D/g, '').slice(0, 8);
  }
  var result = [];
  for (var i = startRow; i < data.length; i++) {
    var row = data[i];
    var inVal = row[colIn];
    var recordVal = row[colRecordDate];
    var inYmd = toYmd(inVal) || toYmd(recordVal);
    if (inYmd !== targetYmd) continue;
    var outVal = row[colOut];
    var outStr = '';
    if (outVal instanceof Date) outStr = Utilities.formatDate(outVal, tz, 'yyyy-MM-dd HH:mm');
    else if (outVal) outStr = String(outVal);
    var inStr = '';
    if (inVal instanceof Date) inStr = Utilities.formatDate(inVal, tz, 'yyyy-MM-dd HH:mm');
    else if (inVal) inStr = String(inVal);
    var hoursVal = row[colHours];
    var hoursStr = hoursVal !== '' && hoursVal !== null && hoursVal !== undefined ? String(hoursVal) : '';
    result.push({
      name: String(row[colName] || ''),
      Name: String(row[colName] || ''),
      in: inStr,
      In: inStr,
      clockIn: inStr,
      out: outStr || '-',
      Out: outStr || '-',
      clockOut: outStr || '-',
      hours: hoursStr,
      Hours: hoursStr,
      shift: String(row[colShift] || ''),
      status: String(row[colStatus] || '')
    });
  }
  return { attendance: result };
}

/**
 * 직원 목록에 7일 평균 파밍 실적(seven_day_avg, seven_day_trend) 추가
 * Farming 시트: [시간, 이름, 게임, 수량] = 열 0,1,2,3
 */
function augmentStaffListWithSevenDayAvg(doc, staffArr) {
  if (!staffArr || staffArr.length === 0) return staffArr;
  var farmingSh = doc.getSheetByName('Farming');
  var tz = 'Asia/Seoul';
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var last7Days = [];
  for (var d = 1; d <= 7; d++) {
    var dt = new Date();
    dt.setDate(dt.getDate() - d);
    last7Days.push(Utilities.formatDate(dt, tz, 'yyyy-MM-dd'));
  }
  for (var i = 0; i < staffArr.length; i++) {
    staffArr[i].seven_day_avg = 0;
    staffArr[i].seven_day_trend = [];
  }
  if (!farmingSh || farmingSh.getLastRow() < 2) return staffArr;
  var fData = farmingSh.getDataRange().getValues();
  var header = (fData[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colDate = 0, colName = 1, colQty = 3;
  if (header.indexOf('시간') >= 0) colDate = header.indexOf('시간');
  if (header.indexOf('이름') >= 0) colName = header.indexOf('이름');
  if (header.indexOf('수량') >= 0) colQty = header.indexOf('수량');
  var byWorker = {};
  for (var r = 1; r < fData.length; r++) {
    var row = fData[r];
    var nameVal = String(row[colName] || '').trim();
    var qty = parseFloat(row[colQty]) || 0;
    var dateVal = row[colDate];
    var dateStr = '';
    if (dateVal instanceof Date) dateStr = Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd');
    else if (dateVal) dateStr = String(dateVal).trim().slice(0, 10);
    if (!nameVal || !dateStr || dateStr === today) continue;
    if (last7Days.indexOf(dateStr) === -1) continue;
    if (!byWorker[nameVal]) byWorker[nameVal] = {};
    if (!byWorker[nameVal][dateStr]) byWorker[nameVal][dateStr] = 0;
    byWorker[nameVal][dateStr] += qty;
  }
  for (var j = 0; j < staffArr.length; j++) {
    var staffName = String(staffArr[j].name || staffArr[j].staffName || '').trim();
    if (!staffName) continue;
    var daily = byWorker[staffName] || {};
    var days = Object.keys(daily);
    var total = 0;
    for (var k = 0; k < days.length; k++) total += daily[days[k]];
    var div = days.length > 0 ? days.length : 1;
    var avg = Math.round((total / div) * 100) / 100;
    var trend = [];
    for (var t = 0; t < last7Days.length; t++) trend.push(daily[last7Days[t]] || 0);
    staffArr[j].seven_day_avg = avg;
    staffArr[j].seven_day_trend = trend;
  }
  return staffArr;
}

function getStaffMonthlyAttendance(doc, staffName, monthParam) {
  if (!staffName) return { attendance: [], summary: {}, staffInfo: null };
  var targetYmd = (monthParam || '').toString().replace(/\D/g, '').slice(0, 6);
  if (targetYmd.length < 6) targetYmd = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMM');
  var pSheet = doc.getSheetByName('Payroll_Daily');
  var sSheet = doc.getSheetByName('Staff_List');
  var staffInfo = null;
  if (sSheet && sSheet.getLastRow() >= 2) {
    var sData = sSheet.getDataRange().getValues();
    for (var si = 1; si < sData.length; si++) {
      if (staffNameMatch(sData[si][1], staffName)) {
        staffInfo = { wage: Number(sData[si][6]) || 0, type: String(sData[si][7] || '').trim(), otRate: Number(sData[si][8]) || 1 };
        break;
      }
    }
  }
  if (!staffInfo) staffInfo = { wage: 0, type: '월급', otRate: 1 };
  var attendance = [];
  var totalHrs = 0, totalBase = 0, totalOt = 0;
  if (pSheet && pSheet.getLastRow() >= 2) {
    var pData = pSheet.getDataRange().getValues();
    var header = (pData[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
    var colRec = header.indexOf('기록일') >= 0 ? header.indexOf('기록일') : 0;
    var colName = header.indexOf('이름') >= 0 ? header.indexOf('이름') : (header.indexOf('name') >= 0 ? header.indexOf('name') : 1);
    var colIn = header.indexOf('출근시간') >= 0 ? header.indexOf('출근시간') : 3;
    var colOut = header.indexOf('퇴근시간') >= 0 ? header.indexOf('퇴근시간') : 4;
    var colHrs = header.indexOf('근무시간') >= 0 ? header.indexOf('근무시간') : 5;
    var colStatus = header.indexOf('상태') >= 0 ? header.indexOf('상태') : 6;
    function rowYmd(row) {
      var v = row[colRec] || row[colIn];
      if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyyMM');
      return String(v || '').replace(/\D/g, '').slice(0, 6);
    }
    function rowDateStr(row) {
      var v = row[colRec] || row[colIn];
      if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
      var s = String(v || '');
      var m = s.match(/(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})/);
      return m ? m[1] + '-' + (m[2].length === 1 ? '0' + m[2] : m[2]) + '-' + (m[3].length === 1 ? '0' + m[3] : (m[3] || '01')) : s.slice(0, 10);
    }
    for (var i = 1; i < pData.length; i++) {
      var row = pData[i];
      if (!staffNameMatch(row[colName], staffName)) continue;
      if (rowYmd(row) !== targetYmd) continue;
      var hrs = Number(row[colHrs]) || 0;
      totalHrs += hrs;
      var inStr = row[colIn] instanceof Date ? Utilities.formatDate(row[colIn], 'Asia/Seoul', 'HH:mm') : String(row[colIn] || '-');
      var outStr = row[colOut] instanceof Date ? Utilities.formatDate(row[colOut], 'Asia/Seoul', 'HH:mm') : (row[colOut] ? String(row[colOut]) : '-');
      var dailyPay = 0;
      if (staffInfo.type === '시급' && staffInfo.wage > 0) {
        var reg = Math.min(hrs, 8), ot = Math.max(0, hrs - 8);
        var base = reg * staffInfo.wage, otPay = ot * staffInfo.wage * staffInfo.otRate;
        totalBase += base; totalOt += otPay;
        dailyPay = Math.round(base + otPay);
      }
      attendance.push({
        date: rowDateStr(row),
        clockIn: inStr,
        clockOut: outStr,
        hours: hrs,
        status: String(row[colStatus] || ''),
        dailyPay: dailyPay
      });
    }
    if (staffInfo.type === '월급' && attendance.length > 0) {
      totalBase = staffInfo.wage;
      totalOt = 0;
    }
  }
  var summary = { totalHours: totalHrs, basePay: Math.round(totalBase), otPay: Math.round(totalOt), finalPay: Math.round(totalBase + totalOt), salaryBasis: staffInfo.type };
  return { attendance: attendance, summary: summary, staffInfo: staffInfo };
}

function getPendingUsersList(doc) {
  var sheet = doc.getSheetByName('Users');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colId = header.indexOf('userid') >= 0 ? header.indexOf('userid') : 0;
  var colName = header.indexOf('name') >= 0 ? header.indexOf('name') : 2;
  var colPhone = header.indexOf('phone') >= 0 ? header.indexOf('phone') : 4;
  var colRole = header.indexOf('role') >= 0 ? header.indexOf('role') : 6;
  var colApproved = header.indexOf('is_approved') >= 0 ? header.indexOf('is_approved') : 7;
  var colCreated = header.indexOf('createdat') >= 0 ? header.indexOf('createdat') : 8;
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var isApproved = row[colApproved];
    if (isApproved === true || isApproved === 'TRUE' || isApproved === 'true') continue;
    var role = String(row[colRole] || '').trim().toLowerCase();
    if (role === 'worker' || role === 'manager' || role === 'admin') continue;
    var userId = (row[colId] || '').toString().trim();
    if (!userId) continue;
    result.push({
      userId: userId,
      name: (row[colName] || '').toString().trim(),
      phone: formatPhoneDisplay(row[colPhone]),
      role: (row[colRole] || 'pending').toString().trim(),
      createdAt: (row[colCreated] || '').toString()
    });
  }
  return result;
}

function getApprovedUsersList(doc) {
  var sheet = doc.getSheetByName('Users');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colId = header.indexOf('userid') >= 0 ? header.indexOf('userid') : 0;
  var colName = header.indexOf('name') >= 0 ? header.indexOf('name') : 2;
  var colPhone = header.indexOf('phone') >= 0 ? header.indexOf('phone') : 4;
  var colRole = header.indexOf('role') >= 0 ? header.indexOf('role') : 6;
  var colApproved = header.indexOf('is_approved') >= 0 ? header.indexOf('is_approved') : 7;
  var colCreated = header.indexOf('createdat') >= 0 ? header.indexOf('createdat') : 8;
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var isApproved = row[colApproved];
    if (isApproved !== true && isApproved !== 'TRUE' && isApproved !== 'true' && isApproved !== 1 && isApproved !== '1') continue;
    var role = (row[colRole] || '').toString().trim().toLowerCase();
    if (role !== 'worker' && role !== 'manager' && role !== 'admin') continue;
    var userId = (row[colId] || '').toString().trim();
    if (!userId) continue;
    var createdVal = row[colCreated];
    var createdAt = createdVal ? (createdVal instanceof Date ? createdVal.toISOString() : String(createdVal)) : '';
    result.push({
      userId: userId,
      name: (row[colName] || '').toString().trim(),
      role: (row[colRole] || '').toString().trim(),
      phone: formatPhoneDisplay(row[colPhone]),
      createdAt: createdAt
    });
  }
  return result;
}

function handleApproveUser(doc, userId, role) {
  var sheet = doc.getSheetByName('Users');
  if (!sheet) return { status: "error", message: "Users 시트 없음" };
  var data = sheet.getDataRange().getValues();
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colId = header.indexOf('userid') >= 0 ? header.indexOf('userid') : 0;
  var colRole = header.indexOf('role') >= 0 ? header.indexOf('role') : 6;
  var colApproved = header.indexOf('is_approved') >= 0 ? header.indexOf('is_approved') : 7;
  if (!role || (role !== 'Worker' && role !== 'Manager' && role !== 'Admin')) role = 'Worker';
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colId]).trim().toLowerCase() === String(userId || '').trim().toLowerCase()) {
      sheet.getRange(i + 1, colRole + 1).setValue(role);
      sheet.getRange(i + 1, colApproved + 1).setValue(true);
      SpreadsheetApp.flush();
      return { status: "success", message: userId + " 승인 완료" };
    }
  }
  return { status: "error", message: "사용자를 찾을 수 없습니다." };
}

/** 회원 비활성화(삭제). is_approved=false 로 설정하여 로그인 불가·승인 목록 제외. */
function handleDeleteUser(doc, params) {
  var userId = (params.userId || params.user_id || '').toString().trim();
  if (!userId) return { status: "error", message: "userId 필요" };
  var sheet = doc.getSheetByName('Users');
  if (!sheet) return { status: "error", message: "Users 시트 없음" };
  var data = sheet.getDataRange().getValues();
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colId = header.indexOf('userid') >= 0 ? header.indexOf('userid') : 0;
  var colApproved = header.indexOf('is_approved') >= 0 ? header.indexOf('is_approved') : 7;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colId]).trim().toLowerCase() === userId.toLowerCase()) {
      sheet.getRange(i + 1, colApproved + 1).getCell(1, 1).setValue(false);
      return { status: "success", message: userId + " 회원이 비활성화되었습니다." };
    }
  }
  return { status: "error", message: "사용자를 찾을 수 없습니다." };
}

function findCol(headers, candidates, fallback) {
  function norm(s) { return String(s || '').trim().replace(/\s+/g, '').toLowerCase(); }
  for (var c = 0; c < candidates.length; c++) {
    var want = norm(candidates[c]);
    if (!want) continue;
    for (var i = 0; i < headers.length; i++) {
      var h = norm(headers[i]);
      if (!h) continue;
      if (h === want || h.indexOf(want) >= 0 || (want.length >= 1 && want.indexOf(h) >= 0)) return i;
    }
  }
  return fallback;
}

function calculateSalaryReport(doc, monthParam) {
  try {
  var staffSheet = doc.getSheetByName("Staff_List");
  if (!staffSheet) return { status: "error", message: "Staff_List 시트가 없습니다." };

  var staffData = staffSheet.getDataRange().getValues();
  if (staffData.length < 2) return [];

  var sHeaderRaw = (staffData[0] || []).map(function(h) { return String(h || ''); });
  var colName = findCol(sHeaderRaw, ['이름', 'name', '성명', 'Name'], 1);
  var colWage = findCol(sHeaderRaw, ['급여액', 'wage', 'salary', '급여'], 6);
  var colType = findCol(sHeaderRaw, ['급여기준', '급여 기준', 'wagetype', 'salary_basis', 'salarybasis', 'type'], 7);
  var colOt = findCol(sHeaderRaw, ['연장비율', '연장 비율', 'ot', 'overtime', '연장'], 8);

  var payroll = [];
  var pHeaderRaw = [];
  var colPDate = 0, colPName = 1, colPHours = 5;
  var payrollSheet = doc.getSheetByName("Payroll_Daily");
  if (!payrollSheet) {
    return { status: "error", message: "Payroll_Daily 시트가 없습니다. 스프레드시트에 'Payroll_Daily' 시트를 추가하고, 첫 행에 헤더(기록일, 이름, 조, 출근시간, 퇴근시간, 근무시간, 상태, 비고)를 넣어 주세요. 출퇴근 기록이 있어야 급여 조회가 가능합니다." };
  }
  if (payrollSheet.getLastRow() >= 1) {
    payroll = payrollSheet.getDataRange().getValues();
    if (payroll.length >= 1) {
      pHeaderRaw = (payroll[0] || []).map(function(h) { return String(h || ''); });
      colPDate = findCol(pHeaderRaw, ['기록일', '기록 일', 'date', '날짜'], 0);
      colPName = findCol(pHeaderRaw, ['이름', 'name', '성명', 'Name'], 1);
      colPHours = findCol(pHeaderRaw, ['근무시간', '근무 시간', 'hours', '근무'], 5);
    }
  }

  var targetYmd = (monthParam || '').toString().replace(/\D/g, '').slice(0, 6);
  if (targetYmd.length < 6) {
    targetYmd = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMM');
  }
  function rowToYmd(row) {
    if (!row || row.length === 0) return '';
    var val = row[colPDate];
    if (val === undefined || val === null) val = row[0] || row[3];
    if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Seoul', 'yyyyMM');
    var s = String(val || '').trim();
    var m = s.match(/(\d{4})[-\/\s]*(\d{1,2})[-\/\s]*(\d{1,2})?/);
    if (m) return m[1] + (m[2].length === 1 ? '0' + m[2] : m[2]).slice(-2);
    return s.replace(/\D/g, '').slice(0, 6);
  }
  function hasAttendanceInMonth(name, targetMonth) {
    for (var i = 1; i < payroll.length; i++) {
      var pName = (payroll[i][colPName] != null ? payroll[i][colPName] : payroll[i][1]).toString().trim();
      if (!staffNameMatch(pName, name)) continue;
      if (rowToYmd(payroll[i]) === targetMonth) return true;
    }
    return false;
  }

  var results = [];
  for (var si = 1; si < staffData.length; si++) {
    var s = staffData[si];
    var name = (s[colName] != null ? s[colName] : s[1]).toString().trim();
    if (!name) continue;
    var wage = Number(s[colWage] != null ? s[colWage] : s[6]) || 0;
    var typeRaw = String(s[colType] != null ? s[colType] : s[7] || '').trim();
    var type = (typeRaw === '시급' || typeRaw === '일급' || typeRaw.toLowerCase() === 'hourly') ? '시급' : (typeRaw || '월급');
    var otRate = Number(s[colOt] != null ? s[colOt] : s[8]) || 1;
    if (isNaN(otRate) || otRate <= 0) otRate = 1;
    var bTotal = 0, oTotal = 0, tHrs = 0;
    if (type === "시급") {
      for (var pi = 1; pi < payroll.length; pi++) {
        var p = payroll[pi];
        var pName = (p[colPName] != null ? p[colPName] : p[1]).toString().trim();
        if (!staffNameMatch(pName, name)) continue;
        if (rowToYmd(p) !== targetYmd) continue;
        var h = Number(p[colPHours] != null ? p[colPHours] : p[5]) || 0;
        var reg = Math.min(h, 8), ot = Math.max(0, h - 8);
        bTotal += (reg * wage);
        oTotal += (ot * wage * otRate);
        tHrs += h;
      }
    } else {
      if (hasAttendanceInMonth(name, targetYmd)) bTotal = wage;
    }
    var basePay = Math.round(bTotal), otPay = Math.round(oTotal);
    var finalPay = basePay + otPay;
    results.push({
      name: name,
      basePay: basePay,
      otPay: otPay,
      hrs: tHrs,
      finalPay: finalPay,
      salaryBasis: type,
      month: targetYmd.slice(0, 4) + '-' + targetYmd.slice(4, 6),
      wage: wage,
      hourlyWage: type === '시급' ? wage : null,
      monthlyWage: type === '월급' ? wage : null
    });
  }
  return results;
  } catch (e) {
    return { status: "error", message: "급여 조회 중 오류: " + (e.message || e.toString()) };
  }
}

function formatPhoneDisplay(val) {
  if (val == null || val === '') return '';
  var s = String(val).trim().replace(/\D/g, '');
  if (!s) return '';
  if (s.length === 10 && s.charAt(0) === '1') return '0' + s;
  return s;
}

function handleUpsertExpenseInline(doc, params) {
  var date = String(params.date || params.Date || params.expenseDate || '').trim();
  var category = String(params.category || params.Category || params.expenseCategory || '').trim();
  var item = String(params.item || params.Item || params.expenseItem || '').trim();
  var cost = params.cost != null ? params.cost : (params.Cost != null ? params.Cost : params.expenseCost);
  if (cost === undefined) cost = '';
  var remarks = String(params.remarks || params.Remarks || '').trim();
  var staffId = String(params.staff_id || params.staffId || '').trim();
  var staffName = String(params.staff_name || params.staffName || '').trim();

  if (!date || !category || !item || (cost === '' || cost === null || cost === undefined)) {
    return { error: '날짜, 구분, 항목, 금액을 모두 입력해 주세요. (date, category, item, cost are required)' };
  }
  var staffNameToUse = staffName || String(params.staff_name || '').trim();
  if (!staffNameToUse) {
    return { error: '직원(이름)을 선택하거나 입력해주세요. (staff_name required)' };
  }

  var receiptUrl = String(params.receipt_url || params.receiptUrl || '').trim();

  var sh = doc.getSheetByName('Expenses');
  if (!sh) {
    sh = doc.insertSheet('Expenses');
    sh.appendRow(['expense_id', 'date', 'category', 'item', 'cost', 'remarks', 'receipt_url', 'staff_id', 'staff_name']);
    sh.getRange(1, 1, 1, 9).setFontWeight('bold');
  }
  if (sh.getLastColumn() < 9 && sh.getLastRow() >= 1) {
    for (var c = sh.getLastColumn(); c < 9; c++) {
      var addH = ['receipt_url', 'staff_id', 'staff_name'][c - 6];
      if (addH) sh.getRange(1, c + 1).setValue(addH);
    }
  }
  var data = sh.getDataRange().getValues();
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var hasReceiptCol = header.indexOf('receipt_url') >= 0;
  var hasFullNine = header.indexOf('expense_id') >= 0 && sh.getLastColumn() >= 9;
  var displayItem = (category ? '[' + category + '] ' : '') + item;
  var expenseId = String(params.expenseId || params.expense_id || '').trim();
  var rowMatch = expenseId.match(/^exp-row(\d+)$/);

  if (rowMatch) {
    var rowNum = parseInt(rowMatch[1], 10);
    var lastRow = sh.getLastRow();
    if (rowNum < 1 || rowNum > lastRow - 1) return { error: '수정 대상 행을 찾을 수 없습니다.' };
    var sheetRow = rowNum + 1;
    if (hasFullNine && data[0].length >= 9) {
      sh.getRange(sheetRow, 2, sheetRow, 6).setValues([[date, category, item, cost, remarks]]);
      sh.getRange(sheetRow, 7, sheetRow, 9).setValues([[receiptUrl, staffId, staffNameToUse]]);
    } else if (hasReceiptCol && data[0].length >= 8) {
      sh.getRange(sheetRow, 1, sheetRow, 5).setValues([[date, staffNameToUse, displayItem, cost, remarks]]);
      sh.getRange(sheetRow, 6, sheetRow, 8).setValues([[receiptUrl, staffId, staffNameToUse]]);
    } else {
      sh.getRange(sheetRow, 1, sheetRow, 5).setValues([[date, staffNameToUse, displayItem, cost, remarks]]);
    }
    return { success: true, expenseId: expenseId };
  }
  if (expenseId && sh.getLastRow() >= 2) {
    var hasIdCol = header.indexOf('expense_id') >= 0;
    if (hasIdCol) {
      for (var r = 1; r < data.length; r++) {
        if (String(data[r][0] || '').trim() === expenseId) {
          var colCount = Math.max(5, data[r].length);
          if (colCount >= 9) {
            sh.getRange(r + 1, 2, r + 1, 6).setValues([[date, category, item, cost, remarks]]);
            sh.getRange(r + 1, 7, r + 1, 9).setValues([[receiptUrl, staffId, staffNameToUse]]);
          } else if (colCount >= 8) {
            sh.getRange(r + 1, 1, r + 1, 5).setValues([[date, staffNameToUse, displayItem, cost, remarks]]);
            sh.getRange(r + 1, 6, r + 1, 8).setValues([[receiptUrl, staffId, staffNameToUse]]);
          } else {
            sh.getRange(r + 1, 1, r + 1, 5).setValues([[date, staffNameToUse, displayItem, cost, remarks]]);
          }
          return { success: true, expenseId: expenseId };
        }
      }
    }
  }

  var now = new Date();
  var newId = 'exp' + now.getTime();
  if (hasFullNine) {
    sh.appendRow([newId, date, category, item, cost, remarks, receiptUrl, staffId, staffNameToUse]);
  } else if (hasReceiptCol) {
    sh.appendRow([date, staffNameToUse, displayItem, cost, remarks, receiptUrl, staffId, staffNameToUse]);
  } else {
    sh.appendRow([date, staffNameToUse, displayItem, cost, remarks]);
  }
  return { success: true, expenseId: newId, lastRow: sh.getLastRow() };
}

function handleGetExpenseListInline(doc, params) {
  var userId = (params.userId || params.user_id || '').toString().trim();
  var role = (params.role || '').toString();
  if (!role && userId) {
    try { role = typeof getUserRole === "function" ? getUserRole(userId) : ''; } catch (e) {}
  }
  if (role === 'Manager') {
    return { error: 'Forbidden', code: 403, message: 'Manager cannot access full expense list' };
  }

  var sh = doc.getSheetByName('Expenses');
  if (!sh || sh.getLastRow() < 2) return { expenses: [] };

  var data = sh.getDataRange().getValues();
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var isExpensesGs = header.indexOf('expense_id') >= 0 || (header.indexOf('date') >= 0 && header.indexOf('category') >= 0);

  var expenses = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var e;
    if (isExpensesGs && row.length >= 9) {
      e = {
        id: String(row[0] || ''),
        expenseId: String(row[0] || ''),
        date: String(row[1] || '').replace(/\//g, '-'),
        category: String(row[2] || ''),
        item: String(row[3] || ''),
        cost: String(row[4] || ''),
        remarks: String(row[5] || ''),
        receipt_url: row[6] ? String(row[6]) : '',
        staff_id: row[7] ? String(row[7]) : '',
        staff_name: row[8] ? String(row[8]) : ''
      };
    } else {
      var dateVal = row[0];
      var dateStr = dateVal instanceof Date ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(dateVal || '').replace(/\//g, '-');
      var itemStr = String(row[2] || '');
      var catMatch = itemStr.match(/^\[([^\]]+)\]\s*(.*)$/);
      var categoryVal = catMatch ? catMatch[1] : '';
      var itemVal = catMatch ? catMatch[2] : itemStr;
      var receiptFromRow = (row.length >= 7 && row[6]) ? String(row[6]) : '';
      var staffIdFromRow = (row.length >= 8 && row[7]) ? String(row[7]) : '';
      var staffNameFromRow = (row.length >= 9 && row[8]) ? String(row[8]) : String(row[1] || '');
      e = {
        id: 'exp-row' + i,
        expenseId: 'exp-row' + i,
        date: dateStr,
        category: categoryVal,
        item: itemVal || itemStr,
        cost: String(row[3] != null ? row[3] : ''),
        remarks: String(row[4] || ''),
        receipt_url: receiptFromRow,
        staff_id: staffIdFromRow,
        staff_name: staffNameFromRow
      };
    }
    expenses.push(e);
  }
  return { expenses: expenses };
}

/** 지출 삭제. exp-rowN 형식(5열 시트) 또는 expense_id 일치(9열 시트)로 행 삭제. */
function handleDeleteExpenseInline(doc, params) {
  var expenseId = (params.expenseId || params.expense_id || '').toString().trim();
  if (!expenseId) return { error: 'expenseId required' };
  var sh = doc.getSheetByName('Expenses');
  if (!sh || sh.getLastRow() < 2) return { error: 'Expenses sheet not found or empty' };
  var data = sh.getDataRange().getValues();
  var rowMatch = expenseId.match(/^exp-row(\d+)$/);
  if (rowMatch) {
    var rowNum = parseInt(rowMatch[1], 10);
    if (rowNum < 1 || rowNum >= data.length) return { error: 'Row not found' };
    sh.deleteRow(rowNum + 1);
    return { success: true };
  }
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0] || '').trim() === expenseId) {
      sh.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { error: 'Not found' };
}

function parsePostParams(e) {
  var params = {};
  if (e.parameter) { for (var k in e.parameter) { params[k] = e.parameter[k]; } }
  if (e.postData && e.postData.contents) {
    var type = (e.postData.type || '').toString();
    var body = e.postData.contents;
    if (type.indexOf('application/json') !== -1) {
      try { params = JSON.parse(body); } catch (ex) {}
    } else if (type.indexOf('application/x-www-form-urlencoded') !== -1) {
      var pairs = body.split('&');
      for (var j = 0; j < pairs.length; j++) {
        var p = pairs[j].split('=');
        if (p.length >= 2) params[decodeURIComponent((p[0] || '').replace(/\+/g, ' '))] = decodeURIComponent((p.slice(1).join('=') || '').replace(/\+/g, ' '));
      }
    } else if (type.indexOf('multipart/form-data') !== -1) {
      var boundaryMatch = type.match(/boundary=([^;\s]+)/);
      var boundary = boundaryMatch ? boundaryMatch[1].replace(/^["']|["']$/g, '').trim() : null;
      if (boundary) {
        var parts = body.split('--' + boundary);
        for (var i = 0; i < parts.length; i++) {
          var part = parts[i];
          var nameMatch = part.match(/name\s*=\s*["']?([^"'\s;]+)["']?/);
          if (!nameMatch) continue;
          var name = nameMatch[1].trim();
          if (!name) continue;
          var valueStart = part.indexOf('\r\n\r\n');
          if (valueStart < 0) valueStart = part.indexOf('\n\n');
          if (valueStart >= 0) {
            var value = part.substring(valueStart).replace(/^\r?\n\r?\n/, '').trim();
            var boundaryEnd = value.indexOf('\r\n--');
            if (boundaryEnd < 0) boundaryEnd = value.indexOf('\n--');
            if (boundaryEnd >= 0) value = value.substring(0, boundaryEnd);
            value = value.replace(/[\r\n]+$/, '').trim();
            if (value.length > 0) params[name] = value;
          }
        }
      }
    }
  }
  return params;
}

function response(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function hashPasswordSha256(plainPassword) {
  if (!plainPassword) return '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, plainPassword, Utilities.Charset.UTF_8);
  return bytes.map(function(b) { var v = b < 0 ? 256 + b : b; return ('0' + v.toString(16)).slice(-2); }).join('');
}

function getUserIdExists(doc, userId) {
  if (!userId) return false;
  var sheet = doc.getSheetByName('Users');
  if (!sheet) return false;
  var data = sheet.getDataRange().getValues();
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colId = header.indexOf('userid') >= 0 ? header.indexOf('userid') : 0;
  var searchId = String(userId).trim().toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colId] || '').trim().toLowerCase() === searchId) return true;
  }
  return false;
}

function getUserDetailByUserId(doc, userId) {
  if (!userId) return null;
  var sheet = doc.getSheetByName('Users');
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  var header = (data[0] || []).map(function(h) { return String(h || '').toLowerCase(); });
  var colId = header.indexOf('userid') >= 0 ? header.indexOf('userid') : 0;
  var colName = header.indexOf('name') >= 0 ? header.indexOf('name') : 2;
  var colBirth = header.indexOf('birthdate') >= 0 ? header.indexOf('birthdate') : 3;
  var colPhone = header.indexOf('phone') >= 0 ? header.indexOf('phone') : 4;
  var searchId = String(userId).trim().toLowerCase();
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[colId] || '').trim().toLowerCase() === searchId) {
      var birth = row[colBirth];
      var birthStr = '';
      if (birth) {
        if (birth instanceof Date) birthStr = Utilities.formatDate(birth, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        else {
          var s = String(birth).trim();
          var m = s.match(/^(\d{4})(\d{2})(\d{2})$/) || s.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})$/);
          birthStr = m ? m[1] + '-' + (m[2] || '').padStart(2, '0') + '-' + (m[3] || '').padStart(2, '0') : s;
        }
      }
      return {
        userId: String(row[colId] || ''),
        name: String(row[colName] || ''),
        birthDate: birthStr,
        phone: formatPhoneDisplay(row[colPhone])
      };
    }
  }
  return null;
}

/**
 * 모든 시트에 가짜 테스트 데이터를 대량 입력합니다.
 * Apps Script 편집기에서 함수 선택 후 실행하거나, 스프레드시트 메뉴 [테스트] → [모의 데이터 입력] 사용.
 * replaceExisting: true이면 기존 데이터 행을 지우고 새로 채움. false이면 뒤에 추가.
 */
function insertMockTestData(replaceExisting) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupDatabaseSheets();
  var replace = replaceExisting === true;
  var testPw = hashPasswordSha256('test1234');
  var now = new Date();
  var fmt = function(d, f) { return Utilities.formatDate(d, 'Asia/Seoul', f || 'yyyy-MM-dd'); };
  var rnd = function(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; };

  // ---- Users ----
  var uSh = ss.getSheetByName('Users');
  if (uSh) {
    if (replace && uSh.getLastRow() > 1) uSh.deleteRows(2, uSh.getLastRow() - 1);
    var usersData = [
      ['admin1', testPw, '김관리', '1985-03-15', '010-1111-1111', 'admin@test.com', 'Admin', true, fmt(now, 'yyyy-MM-dd\'T\'HH:mm:ss')],
      ['manager1', testPw, '이매니저', '1990-07-20', '010-2222-2222', 'manager@test.com', 'Manager', true, fmt(now, 'yyyy-MM-dd\'T\'HH:mm:ss')],
      ['worker1', testPw, '박직원', '1995-11-08', '010-3333-3333', 'worker1@test.com', 'Worker', true, fmt(now, 'yyyy-MM-dd\'T\'HH:mm:ss')],
      ['worker2', testPw, '최현장', '1992-05-22', '010-4444-4444', 'worker2@test.com', 'Worker', true, fmt(now, 'yyyy-MM-dd\'T\'HH:mm:ss')],
      ['worker3', testPw, '정파밍', '1998-01-30', '010-5555-5555', 'worker3@test.com', 'Worker', true, fmt(now, 'yyyy-MM-dd\'T\'HH:mm:ss')],
      ['worker4', testPw, '한테스트', '1994-09-12', '010-6666-6666', 'worker4@test.com', 'Worker', true, fmt(now, 'yyyy-MM-dd\'T\'HH:mm:ss')],
      ['worker5', testPw, '강데모', '1997-04-25', '010-7777-7777', 'worker5@test.com', 'Worker', true, fmt(now, 'yyyy-MM-dd\'T\'HH:mm:ss')],
      ['pending1', testPw, '대기회원1', '1993-08-18', '010-8888-8888', 'pending1@test.com', 'pending', false, fmt(now, 'yyyy-MM-dd\'T\'HH:mm:ss')],
      ['pending2', testPw, '대기회원2', '1996-12-05', '010-9999-9999', 'pending2@test.com', 'pending', false, fmt(now, 'yyyy-MM-dd\'T\'HH:mm:ss')],
      ['pending3', testPw, '대기회원3', '1991-06-14', '010-1010-1010', 'pending3@test.com', 'pending', false, fmt(now, 'yyyy-MM-dd\'T\'HH:mm:ss')]
    ];
    usersData.forEach(function(r) { uSh.appendRow(r); });
  }

  // ---- Staff_List (시급: PHP/시간, 월급: PHP/월 - 현실적 금액) ----
  var sSh = ss.getSheetByName('Staff_List');
  if (sSh) {
    if (replace && sSh.getLastRow() > 1) sSh.deleteRows(2, sSh.getLastRow() - 1);
    var staffList = [
      ['박직원', '시급', 85], ['최현장', '시급', 95], ['정파밍', '시급', 90],
      ['한테스트', '월급', 35000], ['강데모', '월급', 32000],
      ['김관리', '월급', 42000], ['이매니저', '월급', 38000]
    ];
    for (var i = 0; i < staffList.length; i++) {
      var hireDate = new Date(now.getFullYear() - 1, rnd(0, 8), rnd(1, 25));
      var emp = staffList[i];
      sSh.appendRow(['s' + (i + 1), emp[0], fmt(hireDate), '010-' + rnd(1000, 9999) + '-' + rnd(1000, 9999), emp[1], '필리핀', emp[2], emp[1], 1.5, fmt(hireDate), '']);
    }
  }

  // ---- Payroll_Daily (최근 3개월) ----
  var pSh = ss.getSheetByName('Payroll_Daily');
  if (pSh) {
    if (replace && pSh.getLastRow() > 1) pSh.deleteRows(2, pSh.getLastRow() - 1);
    var workers = ['박직원', '최현장', '정파밍', '한테스트', '강데모'];
    for (var m = 0; m < 3; m++) {
      var baseDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
      for (var d = 1; d <= 22; d++) {
        var dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), d);
        if (dayDate.getDay() === 0 || dayDate.getDay() === 6) continue;
        var w = workers[rnd(0, workers.length - 1)];
        var inH = 8 + rnd(0, 1);
        var outH = inH + rnd(8, 12);
        var hrs = Math.min(12, outH - inH) + (rnd(0, 2) * 0.5);
        var inTime = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), inH, 0, 0);
        var outTime = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), outH, 30, 0);
        pSh.appendRow([dayDate, w, 'Day', inTime, outTime, hrs, '완료', '']);
      }
    }
  }

  // ---- Monthly_Salary (최근 6개월) ----
  var msSh = ss.getSheetByName('Monthly_Salary');
  if (msSh) {
    if (replace && msSh.getLastRow() > 1) msSh.deleteRows(2, msSh.getLastRow() - 1);
    for (var m = 0; m < 6; m++) {
      var salDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
      var ym = fmt(salDate, 'yyyy-MM');
      var pay = rnd(25000, 45000);
      msSh.appendRow(['박직원', rnd(160, 200), pay * 0.7, pay * 0.2, rnd(500, 2000), pay, ym, fmt(now)]);
      pay = rnd(30000, 50000);
      msSh.appendRow(['최현장', rnd(170, 210), pay * 0.7, pay * 0.25, rnd(0, 1000), pay, ym, fmt(now)]);
      pay = rnd(35000, 55000);
      msSh.appendRow(['정파밍', rnd(165, 195), pay * 0.75, pay * 0.2, rnd(500, 1500), pay, ym, fmt(now)]);
      msSh.appendRow(['한테스트', 176, 40000, 5000, 0, 45000, ym, fmt(now)]);
      msSh.appendRow(['강데모', 168, 38000, 4000, 500, 41500, ym, fmt(now)]);
    }
  }

  // ---- Attendance ----
  var aSh = ss.getSheetByName('Attendance');
  if (aSh) {
    if (replace && aSh.getLastRow() > 1) aSh.deleteRows(2, aSh.getLastRow() - 1);
    for (var i = 0; i < 50; i++) {
      var atDate = new Date(now.getTime() - i * 86400000);
      aSh.appendRow([atDate, ['박직원', '최현장', '정파밍'][i % 3], 'Day', i % 2 === 0 ? 'Clock In' : 'Clock Out']);
    }
  }

  // ---- Farming ----
  var fSh = ss.getSheetByName('Farming');
  if (fSh) {
    if (replace && fSh.getLastRow() > 1) fSh.deleteRows(2, fSh.getLastRow() - 1);
    var games = ['Aion', 'Lineage', 'Aion2'];
    for (var i = 0; i < 80; i++) {
      var fDate = new Date(now.getTime() - i * 43200000);
      fSh.appendRow([fDate, ['박직원', '최현장', '정파밍', '한테스트', '강데모'][i % 5], games[i % 3], rnd(50, 500)]);
    }
  }

  // ---- Farming_Exchange ----
  var feSh = ss.getSheetByName('Farming_Exchange');
  if (feSh) {
    if (replace && feSh.getLastRow() > 1) feSh.deleteRows(2, feSh.getLastRow() - 1);
    for (var i = 0; i < 40; i++) {
      var feDate = new Date(now.getTime() - i * 86400000);
      feSh.appendRow([feDate, ['박직원', '최현장', '정파밍'][i % 3], ['Aion', 'Lineage'][i % 2], rnd(10, 80), '테스트 차감']);
    }
  }

  // ---- Daily_Tasks ----
  var dtSh = ss.getSheetByName('Daily_Tasks');
  if (dtSh) {
    if (replace && dtSh.getLastRow() > 1) dtSh.deleteRows(2, dtSh.getLastRow() - 1);
    var tasks = [['배치작업', '던전 클리어'], ['장비보강', '강화 +5'], ['퀘스트', '일일퀘 완료'], ['PvP', '전장 참여']];
    for (var i = 0; i < 60; i++) {
      var dtDate = new Date(now.getTime() - rnd(0, 30) * 86400000);
      var t = tasks[i % 4];
      dtSh.appendRow([dtDate, ['박직원', '최현장', '정파밍'][i % 3], t[0], t[1], fmt(dtDate)]);
    }
  }

  // ---- Expenses (VACA 5열: 날짜, 이름, 항목, 금액, 비고) ----
  var exSh = ss.getSheetByName('Expenses');
  if (exSh) {
    if (replace && exSh.getLastRow() > 1) exSh.deleteRows(2, exSh.getLastRow() - 1);
    var expItems = [['[전기]', '전기료'], ['[인터넷]', '회선비'], ['[소모품]', '장비교체'], ['[식비]', '직원 식대'], ['[기타]', '운영비']];
    for (var i = 0; i < 60; i++) {
      var exDate = new Date(now.getFullYear(), now.getMonth() - rnd(0, 5), rnd(1, 25));
      var ei = expItems[i % 5];
      exSh.appendRow([fmt(exDate), ['이매니저', '김관리', '박직원'][i % 3], ei[0] + ' ' + ei[1], rnd(500, 15000), '테스트 지출']);
    }
  }

  // ---- 매출장부 (setupDatabaseSheets에서 헤더 생성됨) ----
  var revSh = ss.getSheetByName('매출장부');
  if (!revSh) { ss.insertSheet('매출장부'); revSh = ss.getSheetByName('매출장부'); revSh.appendRow(['일자', '게임', '수량', '시세', 'PHP매출', 'KRW환산', '매니저', '상태']); revSh.getRange(1, 1, 1, 8).setFontWeight('bold'); }
  if (replace && revSh.getLastRow() > 1) revSh.deleteRows(2, revSh.getLastRow() - 1);
  for (var i = 0; i < 70; i++) {
    var rDate = new Date(now.getFullYear(), now.getMonth() - Math.floor(i / 20), rnd(1, 28));
    var php = rnd(5000, 25000);
    revSh.appendRow([fmt(rDate), ['아이온2(키나)', '리니지(아덴)'][i % 2], rnd(100, 500), 23, php, php * 23, '이매니저', '승인완료']);
  }

  // ---- Revenue_Logs ----
  var rlSh = ss.getSheetByName('Revenue_Logs');
  if (!rlSh) {
    ss.insertSheet('Revenue_Logs');
    rlSh = ss.getSheetByName('Revenue_Logs');
    rlSh.appendRow(['log_id', 'date', 'game_type', 'currency_amount', 'exchange_rate', 'final_revenue', 'manager_id', 'status', 'reject_reason']);
    rlSh.getRange(1, 1, 1, 9).setBackground('#334155').setFontColor('#ffffff').setFontWeight('bold');
  }
  if (replace && rlSh.getLastRow() > 1) rlSh.deleteRows(2, rlSh.getLastRow() - 1);
  for (var i = 0; i < 50; i++) {
    var rlDate = new Date(now.getFullYear(), now.getMonth() - Math.floor(i / 15), rnd(1, 28));
    var amt = rnd(3000, 20000);
    var status = i % 5 === 0 ? 'pending' : 'approved';
    rlSh.appendRow(['rev_' + Utilities.getUuid().slice(0, 8), fmt(rlDate), i % 2 === 0 ? 'aion' : 'lineage', amt, 23, amt, 'manager1', status, '']);
  }

  // ---- 손익계산서 ----
  syncPLToSheet(ss, 12);

  try {
    SpreadsheetApp.getUi().alert('모의 테스트 데이터 입력이 완료되었습니다.\n\n로그인: admin1 / test1234 (Admin)\nmanager1 / test1234 (Manager)\nworker1 / test1234 (Worker)');
  } catch (e) { Logger.log('insertMockTestData 완료. 로그인: admin1/manager1/worker1 / test1234'); }
  return 'OK';
}

/**
 * 스프레드시트 열 때 [테스트] 메뉴 추가
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('테스트').addItem('모의 데이터 입력 (덮어쓰기)', 'menuInsertMockDataReplace').addItem('모의 데이터 추가 (기존 유지)', 'menuInsertMockDataAppend').addToUi();
  } catch (e) {}
}

function menuInsertMockDataReplace() {
  insertMockTestData(true);
}

function menuInsertMockDataAppend() {
  insertMockTestData(false);
}

function setupDatabaseSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var schemas = {
    "Users": ["userId", "userPw", "name", "birthDate", "phone", "email", "role", "is_approved", "createdAt"],
    "Staff_List": ["ID", "이름", "생년월일", "전화번호", "고용유형", "국적", "급여액", "급여기준", "연장비율", "입사일", "퇴사일"],
    "Payroll_Daily": ["기록일", "이름", "조", "출근시간", "퇴근시간", "근무시간", "상태", "비고"],
    "Monthly_Salary": ["성명", "총근무시간", "기본급합계", "연장수당합계", "보너스", "공제액", "최종지급액", "정산월", "정산일시"],
    "Attendance": ["시간", "이름", "조", "유형"],
    "Farming": ["시간", "이름", "게임", "수량"],
    "Farming_Exchange": ["시간", "이름", "게임", "차감수량", "시세", "비고"],
    "Daily_Tasks": ["시간", "이름", "업무유형", "상세", "날짜"],
    "Expenses": ["시간", "이름", "항목", "금액", "비고"],
    "매출장부": ["일자", "게임", "수량", "시세", "PHP매출", "KRW환산", "매니저", "상태"],
    "Shareholders": ["shareholder_id", "name", "share_percentage", "updated_at"]
  };
  for (var sheetName in schemas) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    var headers = schemas[sheetName];
    var firstCell = sheet.getRange("A1").getValue();
    if (firstCell !== "" && String(firstCell) !== headers[0]) {
      sheet.insertRowBefore(1);
    }
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setBackground("#334155");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
}

function testMockDoGet() {
  var mockEvent = { parameter: { action: 'getPendingUsers' } };
  var result = doGet(mockEvent);
  Logger.log(result.getContent());
}
