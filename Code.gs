/**
 * NEXS Live Pickup Monitor — Google Apps Script
 *
 * Single sheet tab: "Snapshot"
 * Row 1 = headers, Row 2 = latest data (always overwritten, never piles up)
 *
 * Three push types merge into the SAME row 2:
 *   1. type:"snapshot"        → manifest done counts (from filter API bookmarklet)
 *   2. type:"monitorSnapshot" → B2C / B2B / Store Packing (from monitor bookmarklet)
 *   3. type:"combinedSnapshot"→ all four dashboard columns in one live cycle
 *
 * Deploy as:
 *   Execute as → Me
 *   Who has access → Anyone
 */

const SNAPSHOT_SHEET = "Snapshot";

const COURIERS = [
  "BLITZNDD", "BLUEDART", "BUSYBEESPPD", "BusybeesSDD",
  "DELCARTB2B", "DELHIVERY", "DELHIVERYPDS", "DOT",
  "DTDCVB2B", "FASTBEETLE", "GPSUPPLY", "PURPLEDRONE",
  "SHADOWFAX", "shreerajxpress", "Velocity", "XPRESSBEES"
];

// Column groups, in header order
const FIELD_GROUPS = ["manifest", "b2c", "b2b", "storePacking"];

// ─────────────────────────────────────────────────────────────────────────────
// ✅ RUN ONCE after deploying — creates sheet + pushes dummy data
// ─────────────────────────────────────────────────────────────────────────────
function setupAndSendDummy() {
  ensureHeaders(getSheet());

  writeSnapshot({
    type: "snapshot",
    timestamp: nowIST(),
    runId: "DEV-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    facilityCode: "NXS2",
    counts: makeDummyCounts()
  });

  writeMonitorSnapshot({
    type: "monitorSnapshot",
    timestamp: nowIST(),
    runId: "DEV-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    facilityCode: "NXS2",
    b2cCounts: makeDummyCounts(),
    b2bCounts: makeDummyCounts(),
    storePackingCounts: makeDummyCounts()
  });

  Logger.log("✅ Done! Snapshot sheet ready with dummy manifest + monitor data.");
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — Dashboard reads this
// ─────────────────────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const sheet = getSheet();
    if (sheet.getLastRow() < 2) return jsonResponse({ error: "no_data" });

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const values  = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];

    const result = {};
    headers.forEach((h, i) => { if (h !== "") result[h] = values[i]; });

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — Bookmarklets push here
// ─────────────────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.type === "snapshot") writeSnapshot(payload);
    if (payload.type === "monitorSnapshot") writeMonitorSnapshot(payload);
    if (payload.type === "combinedSnapshot") writeCombinedSnapshot(payload);

    return jsonResponse({ status: "ok" });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Write manifest-done snapshot (from filter API bookmarklet)
// ─────────────────────────────────────────────────────────────────────────────
function writeSnapshot(payload) {
  const sheet = getSheet();
  ensureHeaders(sheet);
  ensureRow2(sheet);

  // Update meta columns
  setCell(sheet, "timestamp", payload.timestamp || "");
  setCell(sheet, "runId", payload.runId || "");
  setCell(sheet, "facilityCode", payload.facilityCode || "");

  const counts = payload.counts || {};
  COURIERS.forEach(c => {
    setCell(sheet, "manifest_" + c, counts[c] !== undefined ? counts[c] : 0);
  });

  colorManifestCells(sheet, counts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Write B2C / B2B / Store Packing snapshot (from monitor bookmarklet)
// ─────────────────────────────────────────────────────────────────────────────
function writeMonitorSnapshot(payload) {
  const sheet = getSheet();
  ensureHeaders(sheet);
  ensureRow2(sheet);

  setCell(sheet, "monitorTimestamp", payload.timestamp || "");

  const b2c = payload.b2cCounts || {};
  const b2b = payload.b2bCounts || {};
  const sp  = payload.storePackingCounts || {};

  COURIERS.forEach(c => {
    setCell(sheet, "b2c_" + c, b2c[c] !== undefined ? b2c[c] : 0);
    setCell(sheet, "b2b_" + c, b2b[c] !== undefined ? b2b[c] : 0);
    setCell(sheet, "storePacking_" + c, sp[c] !== undefined ? sp[c] : 0);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Write manifest + B2C + B2B + Store Packing in a single live push
// ─────────────────────────────────────────────────────────────────────────────
function writeCombinedSnapshot(payload) {
  writeSnapshot({
    type: "snapshot",
    timestamp: payload.timestamp || nowIST(),
    runId: payload.runId || "",
    facilityCode: payload.facilityCode || "",
    counts: payload.counts || {}
  });

  writeMonitorSnapshot({
    type: "monitorSnapshot",
    timestamp: payload.monitorTimestamp || payload.timestamp || nowIST(),
    runId: payload.runId || "",
    facilityCode: payload.facilityCode || "",
    b2cCounts: payload.b2cCounts || {},
    b2bCounts: payload.b2bCounts || {},
    storePackingCounts: payload.storePackingCounts || {}
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Header setup — builds column list once
// timestamp | runId | facilityCode | monitorTimestamp |
// manifest_X16 | b2c_X16 | b2b_X16 | storePacking_X16
// ─────────────────────────────────────────────────────────────────────────────
function buildHeaders() {
  const headers = ["timestamp", "runId", "facilityCode", "monitorTimestamp"];
  FIELD_GROUPS.forEach(group => {
    COURIERS.forEach(c => headers.push(group + "_" + c));
  });
  return headers;
}

function ensureHeaders(sheet) {
  const headers = buildHeaders();
  const needsRepair = sheet.getLastRow() === 0 || !hasRequiredHeaders(sheet, headers);
  if (!needsRepair) return;

  sheet.clear();
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length)
       .setBackground("#000042").setFontColor("#ffffff")
       .setFontWeight("bold").setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
  for (let i = 1; i <= headers.length; i++) sheet.setColumnWidth(i, 130);
}

function hasRequiredHeaders(sheet, requiredHeaders) {
  if (sheet.getLastRow() === 0) return false;
  const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return requiredHeaders.every(h => currentHeaders.indexOf(h) !== -1);
}

function ensureRow2(sheet) {
  if (sheet.getLastRow() < 2) {
    const headers = buildHeaders();
    sheet.appendRow(new Array(headers.length).fill(""));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Set a single cell in row 2 by header name
// ─────────────────────────────────────────────────────────────────────────────
function setCell(sheet, headerName, value) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf(headerName) + 1;
  if (col === 0) return;
  sheet.getRange(2, col).setValue(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Color manifest cells based on value
// ─────────────────────────────────────────────────────────────────────────────
function colorManifestCells(sheet, counts) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  COURIERS.forEach(c => {
    const col = headers.indexOf("manifest_" + c) + 1;
    if (col === 0) return;
    const cell = sheet.getRange(2, col);
    const count = counts[c];
    if (count === undefined || count === -1) {
      cell.setBackground("#eeeeee").setFontColor("#9e9e9e");
    } else if (count === 0) {
      cell.setBackground("#e8f5e9").setFontColor("#2e7d32");
    } else {
      cell.setBackground("#fff3e0").setFontColor("#e65100");
    }
    cell.setFontWeight("bold");
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stale data clear — run on a 1-minute trigger
// ─────────────────────────────────────────────────────────────────────────────
function clearStaleSnapshot() {
  const sheet = getSheet();
  if (sheet.getLastRow() < 2) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const tsCol = headers.indexOf("timestamp") + 1;
  if (tsCol === 0) return;

  const ts = sheet.getRange(2, tsCol).getValue();
  if (!ts) return;

  const clean = ts.toString().replace(" IST", "").trim();
  const isoString = clean.replace(" ", "T") + "+05:30";
  const pushedUTC = new Date(isoString);
  const ageMinutes = (new Date() - pushedUTC) / 60000;

  if (ageMinutes > 10) {
    sheet.deleteRow(2);
    Logger.log("Stale data cleared. Age was: " + ageMinutes.toFixed(1) + " mins");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SNAPSHOT_SHEET) || ss.insertSheet(SNAPSHOT_SHEET);
}

function makeDummyCounts() {
  const counts = {};
  COURIERS.forEach(c => {
    counts[c] = Math.random() < 0.7 ? 0 : Math.floor(Math.random() * 100) + 1;
  });
  return counts;
}

function nowIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().replace("T", " ").replace("Z", "") + " IST";
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
