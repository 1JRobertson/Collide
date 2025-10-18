import {
  APP_STORAGE_KEYS,
  EVENT_FIELD_HINTS,
  EVENT_STORAGE_KEYS,
  PRODUCT_KEYWORDS,
  SIZE_ALIASES,
  SIZE_SYNONYMS,
  SIZES
} from "../constants.js";
import { eventLoadingState, eventState } from "../state.js";
import { setActiveTab, updateSyncFetchDisplay } from "../projection/index.js";
import { formatInteger, formatNumber } from "../utils/format.js";
import { clearCanvas, drawHistogram } from "../utils/charts.js";
import { normalizeBaseUrl, buildActionUrl } from "../utils/url.js";
import { safeReadStorage, safeWriteStorage } from "../utils/storage.js";
import { SAMPLE_EVENT_DATA } from "./sample-data.js";

const eventElements = {
  sourceInput: document.getElementById("event-source-url"),
  secretInput: document.getElementById("event-secret"),
  loadButton: document.getElementById("event-load-button"),
  syncButton: document.getElementById("event-sync-button"),
  sampleButton: document.getElementById("event-load-sample"),
  lockButton: document.getElementById("event-lock-url"),
  status: document.getElementById("event-status"),
  eventSelect: document.getElementById("event-selector"),
  urlWrapper: document.querySelector('.url-wrapper'),
  hoodieCanvas: document.getElementById("event-hoodie-chart"),
  shirtCanvas: document.getElementById("event-shirt-chart"),
  tableBody: document.querySelector("#event-size-table tbody"),
  metricDisplays: {
    hoodies: document.querySelector('[data-event-metric="hoodies"]'),
    shirts: document.querySelector('[data-event-metric="shirts"]'),
    addon5: document.querySelector('[data-event-metric="addon5"]'),
    addon10: document.querySelector('[data-event-metric="addon10"]'),
    addon5APS: document.querySelector('[data-event-metric="addon5APS"]'),
    addon10APS: document.querySelector('[data-event-metric="addon10APS"]')
  },
  totalDisplays: {
    hoodies: document.querySelector('[data-event-total="hoodies"]'),
    shirts: document.querySelector('[data-event-total="shirts"]'),
    combined: document.querySelector('[data-event-total="combined"]')
  }
};

function flashButton(button, { duration = 200 } = {}) {
  if (!button) {
    return;
  }
  button.classList.add('is-pressed');
  window.setTimeout(() => {
    button.classList.remove('is-pressed');
  }, duration);
}

function recomputeEventUrls() {
  if (!eventElements.sourceInput) {
    eventState.urls = null;
    return null;
  }
  const raw = eventElements.sourceInput.value ? eventElements.sourceInput.value.trim() : '';
  if (!raw) {
    eventState.urls = null;
    return null;
  }
  const base = normalizeBaseUrl(raw);
  if (raw !== base) {
    eventElements.sourceInput.value = base;
  }
  const secret = (eventState.secret || '').trim();
  eventState.urls = {
    base,
    sync: buildActionUrl(base, 'sync', secret),
    fetch: buildActionUrl(base, 'fetch', secret)
  };
  safeWriteStorage(EVENT_STORAGE_KEYS.source, base);
  return eventState.urls;
}

function getActionUrl(action) {
  const urls = recomputeEventUrls();
  if (!urls) {
    return '';
  }
  if (action === 'sync') {
    return urls.sync;
  }
  if (action === 'fetch') {
    return urls.fetch;
  }
  return urls.base;
}

function setSecretValue(value, { persist = true } = {}) {
  const trimmed = value ? value.trim() : '';
  eventState.secret = trimmed;
  if (persist) {
    safeWriteStorage(EVENT_STORAGE_KEYS.secret, trimmed);
  }
  eventState.urls = null;
  if (trimmed) {
    recomputeEventUrls();
  }
  return trimmed;
}

function ensureSecretProvided() {
  let secret = (eventState.secret || '').trim();
  if (!secret && eventElements.secretInput) {
    secret = setSecretValue(eventElements.secretInput.value, { persist: true });
  }
  if (secret) {
    return true;
  }
  setEventStatus('Enter the shared secret before continuing.', 'error');
  if (eventElements.secretInput) {
    eventElements.secretInput.focus();
  }
  return false;
}

function setUrlLocked(locked) {
  if (!eventElements.sourceInput) {
    return;
  }
  const hasUi = Boolean(eventElements.urlWrapper || eventElements.lockButton);
  eventElements.sourceInput.readOnly = locked;
  if (locked && hasUi) {
    eventElements.sourceInput.blur();
  }
  if (eventElements.urlWrapper) {
    eventElements.urlWrapper.classList.toggle('locked', locked);
  }
  if (eventElements.lockButton) {
    eventElements.lockButton.textContent = locked ? 'Unlock URL' : 'Lock URL';
  }
  if (locked) {
    recomputeEventUrls();
    safeWriteStorage(APP_STORAGE_KEYS.urlLocked, '1');
    if (hasUi) {
      setEventStatus('URL locked. Use Sync or Fetch when you are ready.', 'info');
    }
  } else {
    eventState.urls = null;
    safeWriteStorage(APP_STORAGE_KEYS.urlLocked, '');
    if (hasUi) {
      setEventStatus('URL unlocked. You can paste a new Apps Script link.', 'info');
    } else {
      recomputeEventUrls();
    }
  }
}

if (eventElements.lockButton) {
  eventElements.lockButton.addEventListener('click', () => {
    flashButton(eventElements.lockButton);
    const isLocked = Boolean(eventElements.sourceInput && eventElements.sourceInput.readOnly);
    if (!isLocked) {
      const value = eventElements.sourceInput ? eventElements.sourceInput.value.trim() : '';
      if (!value) {
        setEventStatus('Enter the Apps Script web app URL before locking.', 'error');
        return;
      }
    }
    setUrlLocked(!isLocked);
  });
}



function setEventStatus(message, tone = "info") {
  if (!eventElements.status) {
    return;
  }
  eventElements.status.textContent = message;
  eventElements.status.dataset.tone = tone;
}

function updateEventLoadingUi() {
  const syncBusy = Boolean(eventLoadingState.sync);
  const fetchBusy = Boolean(eventLoadingState.fetch);
  if (eventElements.syncButton) {
    eventElements.syncButton.disabled = syncBusy;
    eventElements.syncButton.textContent = syncBusy ? 'Syncing...' : 'Sync Square';
  }
  if (eventElements.loadButton) {
    eventElements.loadButton.disabled = fetchBusy;
    eventElements.loadButton.textContent = fetchBusy ? 'Fetching...' : 'Fetch Data';
  }
  if (eventElements.sampleButton) {
    eventElements.sampleButton.disabled = fetchBusy;
  }
  if (eventElements.lockButton) {
    eventElements.lockButton.disabled = syncBusy;
  }
}

function setEventLoading(mode, isLoading) {
  if (!Object.prototype.hasOwnProperty.call(eventLoadingState, mode)) {
    return;
  }
  eventLoadingState[mode] = Boolean(isLoading);
  updateEventLoadingUi();
}

function makeAccessor(row) {
  const map = {};
  Object.keys(row).forEach((key) => {
    if (typeof key === "string") {
      map[key.trim().toLowerCase()] = row[key];
    }
  });
  return (keys) => {
    for (const key of keys) {
      const normalized = key.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(map, normalized)) {
        const value = map[normalized];
        if (value !== undefined && value !== null && value !== "") {
          return value;
        }
      }
    }
    return undefined;
  };
}

function safeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function normalizeSizeValue(value) {
  if (!value && value !== 0) {
    return null;
  }
  const str = String(value).trim();
  if (!str) {
    return null;
  }
  const direct = str.toUpperCase();
  if (SIZES.includes(direct)) {
    return direct;
  }
  const lower = str.toLowerCase();
  if (SIZE_ALIASES[lower]) {
    return SIZE_ALIASES[lower];
  }
  const collapsed = lower.replace(/[^a-z0-9]/g, "");
  if (SIZE_SYNONYMS[collapsed]) {
    return SIZE_SYNONYMS[collapsed];
  }
  for (const size of SIZES) {
    if (lower.includes(size.toLowerCase())) {
      return size;
    }
  }
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    if (SIZE_SYNONYMS[token]) {
      return SIZE_SYNONYMS[token];
    }
    const alias = SIZE_ALIASES[token];
    if (alias) {
      return alias;
    }
    const upperToken = token.toUpperCase();
    if (SIZES.includes(upperToken)) {
      return upperToken;
    }
  }
  return null;
}

function detectProductType(item, variation) {
  const normalizedItem = (item || '').trim().toLowerCase();
  if (normalizedItem) {
    if (["add-on $5", "add-on$5", "add on $5", "addon $5", "add-ons $5"].includes(normalizedItem.replace(/\s+/g, ' '))) {
      return 'addon5';
    }
    if (["add-on $10", "add-on$10", "add on $10", "addon $10", "add-ons $10"].includes(normalizedItem.replace(/\s+/g, ' '))) {
      return 'addon10';
    }
  }

  const raw = `${item || ''} ${variation || ''}`;
  const lower = raw.toLowerCase();
  const combined = lower.replace(/[-\u2013\u2014\u2212]/g, '-');
  const collapsed = combined.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return null;
  }
  if (/add[\s-]?on[s]?\s*\$?\s*5\b/.test(collapsed)) {
    return 'addon5';
  }
  if (/add[\s-]?on[s]?\s*\$?\s*10\b/.test(collapsed)) {
    return 'addon10';
  }
  if (PRODUCT_KEYWORDS.hoodie.some((keyword) => collapsed.includes(keyword))) {
    return 'hoodie';
  }
  if (PRODUCT_KEYWORDS.shirt.some((keyword) => collapsed.includes(keyword))) {
    return 'shirt';
  }
  if (PRODUCT_KEYWORDS.addon5.some((keyword) => collapsed.includes(keyword))) {
    return 'addon5';
  }
  if (PRODUCT_KEYWORDS.addon10.some((keyword) => collapsed.includes(keyword))) {
    return 'addon10';
  }
  return null;
}

function normalizePayloadToRows(payload) {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  const candidates = ["rows", "data", "records", "items", "result"];
  for (const key of candidates) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }
  return [];
}

function buildEventRecords(rows) {
  const eventsMap = new Map();
  let latest = null;

  rows.forEach((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return;
    }
    const accessor = makeAccessor(row);
    const eventName = cleanEventName(accessor(EVENT_FIELD_HINTS.eventName));
    if (!eventName) {
      return;
    }
    const eventKey = cleanEventName(accessor(EVENT_FIELD_HINTS.eventKey)) || eventName;
    const categoryRaw = accessor(EVENT_FIELD_HINTS.category);
    const category = categoryRaw ? String(categoryRaw).trim() : "All Events";
    const itemValue = accessor(EVENT_FIELD_HINTS.product);
    const variationValue = accessor(EVENT_FIELD_HINTS.variation);
    const productType = detectProductType(itemValue, variationValue);
    const quantityValue = accessor(EVENT_FIELD_HINTS.quantity);
    const quantity = safeNumber(quantityValue);
    const sizeValue = normalizeSizeValue(accessor(EVENT_FIELD_HINTS.size) || variationValue || itemValue);
    const timestampValue = accessor(EVENT_FIELD_HINTS.timestamp);
    const dateValue = accessor(EVENT_FIELD_HINTS.date);
    const timeValue = accessor(EVENT_FIELD_HINTS.time);
    const timeZoneValue = accessor(EVENT_FIELD_HINTS.timeZone);
    let timestamp = null;
    const pushTimestamp = (value) => {
      if (value && !timestamp) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.valueOf())) {
          timestamp = parsed;
        }
      }
    };
    pushTimestamp(timestampValue);
    if (!timestamp && dateValue) {
      const datePart = String(dateValue).trim();
      const timePartRaw = timeValue ? String(timeValue).trim() : "";
      const timePart = timePartRaw || "00:00:00";
      const tzPart = timeZoneValue ? String(timeZoneValue).trim() : "";
      const candidate = tzPart ? `${datePart} ${timePart} ${tzPart}` : `${datePart} ${timePart}`;
      pushTimestamp(candidate);
      if (!timestamp) {
        pushTimestamp(`${datePart}T${timePart}`);
      }
    }

    let record = eventsMap.get(eventKey);
    if (!record) {
      record = {
        id: eventKey,
        name: eventName,
        category,
        hoodies: { counts: Array(SIZES.length).fill(0), total: 0 },
        shirts: { counts: Array(SIZES.length).fill(0), total: 0 },
        addOn5: 0,
        addOn10: 0,
        addOn5APS: 0,
        addOn10APS: 0,
        totalUnits: 0,
        lastSale: null,
        rows: []
      };
      const venueRaw = accessor(EVENT_FIELD_HINTS.venue);
      if (venueRaw) {
        record.venue = String(venueRaw).trim();
      }
      eventsMap.set(eventKey, record);
    }

    record.rows.push(row);

    if (timestamp && (!record.lastSale || timestamp > record.lastSale)) {
      record.lastSale = timestamp;
    }
    if (timestamp && (!latest || timestamp > latest)) {
      latest = timestamp;
    }

    if (productType === "hoodie" || productType === "shirt") {
      if (!sizeValue || quantity === 0) {
        return;
      }
      const index = SIZES.indexOf(sizeValue);
      if (index >= 0) {
        const bucket = productType === "hoodie" ? record.hoodies : record.shirts;
        bucket.counts[index] += quantity;
        bucket.total += quantity;
        record.totalUnits += quantity;
      }
    } else if (productType === "addon5") {
      record.addOn5 += quantity;
    } else if (productType === "addon10") {
      record.addOn10 += quantity;
    }
  });

  const events = Array.from(eventsMap.values());
  events.forEach((record) => {
    const denominator = record.hoodies.total + record.shirts.total;
    record.addOn5APS = denominator > 0 ? record.addOn5 / denominator : 0;
    record.addOn10APS = denominator > 0 ? record.addOn10 / denominator : 0;
  });
  events.sort((a, b) => {
    if (a.lastSale && b.lastSale) {
      return b.lastSale - a.lastSale;
    }
    if (a.lastSale) {
      return -1;
    }
    if (b.lastSale) {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });

  eventState.events = events;
  eventState.lastUpdated = latest;
}

function shareByIndex(counts) {
  const total = counts.reduce((acc, value) => acc + value, 0);
  if (total <= 0) {
    return counts.map(() => 0);
  }
  return counts.map((value) => (value > 0 ? value / total : 0));
}

function cleanEventName(value) {
  if (!value && value !== 0) {
    return "";
  }
  let result = String(value).trim();
  if (!result) {
    return "";
  }
  result = result.replace(/\s*\((?:payment|payments)[^)]*\)\s*$/i, "");
  result = result.replace(/\s+-\s+payment$/i, "");
  result = result.replace(/\s+/g, " " );
  return result.trim();
}

function renderEventPlaceholder(message) {
  resetEventMetrics();
  if (eventElements.tableBody) {
    eventElements.tableBody.innerHTML = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "event-empty";
    cell.textContent = message;
    row.appendChild(cell);
    eventElements.tableBody.appendChild(row);
  }
  clearCanvas(eventElements.hoodieCanvas);
  clearCanvas(eventElements.shirtCanvas);
}

function resetEventMetrics() {
  const metrics = eventElements.metricDisplays;
  if (metrics.hoodies) metrics.hoodies.textContent = "0";
  if (metrics.shirts) metrics.shirts.textContent = "0";
  if (metrics.addon5) metrics.addon5.textContent = "0";
  if (metrics.addon10) metrics.addon10.textContent = "0";
  if (metrics.addon5APS) metrics.addon5APS.textContent = "0.00";
  if (metrics.addon10APS) metrics.addon10APS.textContent = "0.00";
  const totals = eventElements.totalDisplays;
  if (totals.hoodies) totals.hoodies.textContent = "0";
  if (totals.shirts) totals.shirts.textContent = "0";
  if (totals.combined) totals.combined.textContent = "0";
}

function renderEventTableRows(record) {
  if (!eventElements.tableBody) {
    return;
  }
  eventElements.tableBody.innerHTML = "";
  SIZES.forEach((size, index) => {
    const hoodieCount = record.hoodies.counts[index] || 0;
    const shirtCount = record.shirts.counts[index] || 0;
    const total = hoodieCount + shirtCount;
    const tr = document.createElement("tr");
    const cells = [
      size,
      formatInteger(hoodieCount),
      formatInteger(shirtCount),
      formatInteger(total)
    ];
    cells.forEach((value, cellIndex) => {
      const td = document.createElement("td");
      td.textContent = value;
      if (cellIndex === 0) {
        td.style.fontWeight = "600";
      }
      tr.appendChild(td);
    });
    eventElements.tableBody.appendChild(tr);
  });
}

function populateEventOptions(shouldRender = true) {
  if (!eventElements.eventSelect) {
    return;
  }
  const select = eventElements.eventSelect;
  const events = eventState.events;
  select.innerHTML = "";
  if (events.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No events available";
    select.appendChild(option);
    select.disabled = true;
    renderEventPlaceholder(eventState.events.length ? "Select an event to view details." : "Load data to see hoodie and shirt distributions.");
    if (shouldRender) {
      eventState.selectedEventId = "";
    }
    return;
  }
  select.disabled = false;
  events.forEach((record) => {
    const option = document.createElement("option");
    option.value = record.id;
    option.textContent = record.name;
    select.appendChild(option);
  });
  if (!events.some((record) => record.id === eventState.selectedEventId)) {
    eventState.selectedEventId = events[0].id;
  }
  select.value = eventState.selectedEventId;
  if (shouldRender) {
    renderSelectedEvent();
  }
}

function renderSelectedEvent() {
  const events = eventState.events;
  const record = events.find((event) => event.id === eventState.selectedEventId);
  if (!record) {
    renderEventPlaceholder(events.length ? "Select an event to view details." : "Load data to see hoodie and shirt distributions.");
    return;
  }

  const metrics = eventElements.metricDisplays;
  if (metrics.hoodies) metrics.hoodies.textContent = formatInteger(record.hoodies.total);
  if (metrics.shirts) metrics.shirts.textContent = formatInteger(record.shirts.total);
  if (metrics.addon5) metrics.addon5.textContent = formatInteger(record.addOn5);
  if (metrics.addon10) metrics.addon10.textContent = formatInteger(record.addOn10);
  if (metrics.addon5APS) metrics.addon5APS.textContent = formatNumber(record.addOn5APS, { decimals: 2 });
  if (metrics.addon10APS) metrics.addon10APS.textContent = formatNumber(record.addOn10APS, { decimals: 2 });

  const totals = eventElements.totalDisplays;
  if (totals.hoodies) totals.hoodies.textContent = formatInteger(record.hoodies.total);
  if (totals.shirts) totals.shirts.textContent = formatInteger(record.shirts.total);
  if (totals.combined) totals.combined.textContent = formatInteger(record.hoodies.total + record.shirts.total);

  renderEventTableRows(record);

  const hoodieShares = shareByIndex(record.hoodies.counts);
  const shirtShares = shareByIndex(record.shirts.counts);
  drawHistogram(eventElements.hoodieCanvas, record.hoodies.counts, {
    percentages: hoodieShares,
    yLabel: "units",
    colors: { from: "rgba(119, 167, 255, 0.95)", to: "rgba(80, 122, 255, 0.82)" }
  });
  drawHistogram(eventElements.shirtCanvas, record.shirts.counts, {
    percentages: shirtShares,
    yLabel: "units",
    colors: { from: "rgba(255, 166, 133, 0.9)", to: "rgba(232, 112, 134, 0.82)" }
  });

  safeWriteStorage(EVENT_STORAGE_KEYS.eventId, eventState.selectedEventId);
}

function applyEventRows(rows) {
  eventState.rawRows = rows;
  buildEventRecords(rows);
  populateEventOptions(true);
  if (eventState.events.length === 0) {
    setEventStatus("No hoodie or shirt rows were found. Confirm the sheet headers and item names.", "error");
  } else {
    const messageParts = [`${eventState.events.length} event${eventState.events.length === 1 ? "" : "s"} loaded`];
    if (eventState.lastUpdated) {
      messageParts.push(`Latest transaction ${eventState.lastUpdated.toLocaleString()}`);
    }
    setEventStatus(messageParts.join(" - "), "success");
  }
}

async function triggerSync(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    if (payload && typeof payload === 'object') {
      if (payload.message) return payload.message;
      if (payload.status) return String(payload.status);
    }
    return 'Sync complete.';
  }
  const text = await response.text();
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        if (parsed.message) return parsed.message;
        if (parsed.status) return String(parsed.status);
      }
    } catch {
      // fall through to plain text
    }
    return text.trim();
  }
  return 'Sync complete.';
}

async function syncSquare() {
  if (!ensureSecretProvided()) {
    return;
  }
  const syncUrl = getActionUrl('sync');
  if (!syncUrl) {
    setEventStatus('Enter the Apps Script web app URL first.', 'error');
    return;
  }
  setEventLoading('sync', true);
  try {
    setEventStatus('Syncing Square data via Apps Script...', 'info');
    const syncMessage = await triggerSync(syncUrl);
    eventState.syncTimestamp = new Date();
    updateSyncFetchDisplay();
    const cleaned = syncMessage && syncMessage.trim() ? syncMessage.trim() : 'Sync complete.';
    setEventStatus(`${cleaned} Run Fetch Data to refresh the dashboard.`, 'info');
  } catch (error) {
    console.error(error);
    setEventStatus(`Square sync failed: ${error.message}`, 'error');
  } finally {
    setEventLoading('sync', false);
  }
}

export async function verifyEventCredentials({ baseUrl, secret, statusMessage } = {}) {
  const normalizedUrl = baseUrl ? normalizeBaseUrl(baseUrl) : '';
  const trimmedSecret = secret ? secret.trim() : '';
  const result = await hydrateFromUrl(buildActionUrl(normalizedUrl, 'fetch', trimmedSecret), {
    statusMessage: statusMessage || 'Verifying credentials with Apps Script...'
  });
  if (!result || !result.ok) {
    if (!result) {
      console.error('Credential verification failed with unknown result');
      return { ok: false, error: 'Verification failed: Unknown error.', normalizedUrl, secret: trimmedSecret };
    }
    return { ...result, normalizedUrl, secret: trimmedSecret };
  }
  return { ok: true, normalizedUrl, secret: trimmedSecret };
}

export async function fetchSquareData({ statusMessage } = {}) {
  if (!ensureSecretProvided()) {
    return { ok: false, error: 'Enter the shared secret before continuing.' };
  }
  const fetchUrl = getActionUrl('fetch');
  if (!fetchUrl) {
    const message = 'Enter the Apps Script web app URL first.';
    setEventStatus(message, 'error');
    return { ok: false, error: message };
  }
  const result = await hydrateFromUrl(fetchUrl, { statusMessage: statusMessage || 'Fetching event data...' });
  if (!result || !result.ok) {
    if (!result) {
      console.error('Fetch sequence failed with unknown result');
      const message = 'Fetch failed: Unknown error.';
      setEventStatus(message, 'error');
      return { ok: false, error: message };
    }
    return result;
  }
  return result;
}

const FETCH_TIMEOUT_MS = 20000;

async function hydrateFromUrl(rawUrl, { skipLoadingToggle = false, statusMessage } = {}) {
  const url = rawUrl ? rawUrl.trim() : "";
  if (!url) {
    const message = "Enter the Apps Script web app URL first.";
    setEventStatus(message, "error");
    return { ok: false, error: message };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      const message = "Use an http or https URL.";
      setEventStatus(message, "error");
      return { ok: false, error: message };
    }
  } catch {
    const message = "Enter a valid URL to load data.";
    setEventStatus(message, "error");
    return { ok: false, error: message };
  }

  if (!skipLoadingToggle) {
    setEventLoading('fetch', true);
  }
  setEventStatus(statusMessage || "Loading event data...", "info");

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const abortTimeout = controller ? window.setTimeout(() => {
    try {
      controller.abort();
    } catch {
      // ignore abort errors
    }
  }, FETCH_TIMEOUT_MS) : null;

  try {
    const response = await fetch(url, { cache: "no-store", signal: controller ? controller.signal : undefined });
    if (abortTimeout !== null) {
      window.clearTimeout(abortTimeout);
    }
    if (!response.ok) {
      let errorMessage = `${response.status} ${response.statusText || ''}`.trim();
      let responseText = '';
      try {
        responseText = await response.text();
      } catch {
        // ignore body read errors
      }
      if (!errorMessage) {
        errorMessage = 'Request failed';
      }
      const error = new Error(errorMessage);
      error.status = response.status;
      if (responseText) {
        error.responseText = responseText;
        try {
          const parsed = JSON.parse(responseText);
          const hint = parsed?.error || parsed?.message || parsed?.statusText;
          if (typeof hint === 'string' && hint.trim()) {
            error.responseHint = hint.trim();
          }
        } catch {
          // ignore parse errors
        }
      }
      throw error;
    }
    const contentType = response.headers.get("content-type") || "";
    let payload;
    if (contentType.includes("application/json")) {
      payload = await response.json();
    } else {
      const text = await response.text();
      payload = JSON.parse(text);
    }
    const rows = normalizePayloadToRows(payload);
    if (!rows.length) {
      throw new Error("No rows returned. Ensure your Apps Script returns an array of objects.");
    }
    applyEventRows(rows);
    eventState.fetchTimestamp = new Date();
    updateSyncFetchDisplay();
    const base = eventState.urls ? eventState.urls.base : normalizeBaseUrl(url);
    if (base) {
      safeWriteStorage(EVENT_STORAGE_KEYS.source, base);
    }
    return { ok: true };
  } catch (error) {
    console.error(error);
    const isAbort = error && (error.name === 'AbortError' || error.message === 'The user aborted a request.');
    let message;
    let code;
    if (isAbort) {
      message = 'Fetch timed out. Try again or verify the Apps Script deployment.';
      code = 'timeout';
    } else {
      const status = typeof error?.status === 'number' ? error.status : null;
      if (status === 401 || status === 403) {
        message = 'Authentication failed. Confirm the Apps Script URL and shared secret token.';
        code = 'unauthorized';
      } else if (status === 404) {
        message = 'Could not reach that Apps Script deployment. Confirm the URL is correct and published.';
        code = 'not_found';
      } else if (status >= 500 && status < 600) {
        message = 'Apps Script returned an error. Try again or review the deployment logs.';
        code = 'server_error';
      } else if (typeof error?.responseHint === 'string' && error.responseHint) {
        message = error.responseHint;
      } else if (typeof error?.responseText === 'string' && error.responseText) {
        const trimmed = error.responseText.trim();
        if (trimmed) {
          message = trimmed.length <= 140 ? trimmed : `${trimmed.slice(0, 137)}...`;
        }
      }
      if (!message) {
        const baseMessage = typeof error?.message === 'string' && error.message ? error.message : 'Unknown error.';
        message = `Failed to load data: ${baseMessage}`;
      }
    }
    setEventStatus(message, "error");
    const status = typeof error?.status === 'number' ? error.status : undefined;
    return { ok: false, error: message, status, code };
  } finally {
    if (abortTimeout !== null) {
      window.clearTimeout(abortTimeout);
    }
    if (!skipLoadingToggle) {
      setEventLoading('fetch', false);
    }
  }
}

function loadSampleData() {
  applyEventRows(SAMPLE_EVENT_DATA);
  setEventStatus("Loaded sample data. Replace with your live Apps Script feed when ready.", "info");
}

function initializeEventExplorer() {
  const savedTab = safeReadStorage(APP_STORAGE_KEYS.activeTab) || 'projection';
  setActiveTab(savedTab, { persist: false });
  const savedSource = safeReadStorage(EVENT_STORAGE_KEYS.source);
  if (eventElements.sourceInput && savedSource) {
    eventElements.sourceInput.value = savedSource;
  }
  const savedSecret = safeReadStorage(EVENT_STORAGE_KEYS.secret);
  if (typeof savedSecret === 'string') {
    if (eventElements.secretInput) {
      eventElements.secretInput.value = savedSecret;
    }
    setSecretValue(savedSecret, { persist: false });
  }
  const savedLock = safeReadStorage(APP_STORAGE_KEYS.urlLocked) === '1';
  if (eventElements.lockButton || eventElements.urlWrapper) {
    setUrlLocked(Boolean(savedLock));
  } else if (savedSource) {
    recomputeEventUrls();
  }
  const savedEventId = safeReadStorage(EVENT_STORAGE_KEYS.eventId);
  if (savedEventId) {
    eventState.selectedEventId = savedEventId;
  }
  renderEventPlaceholder("Load data to see hoodie and shirt distributions.");
  if (savedSource && savedSecret && savedLock) {
    fetchSquareData({ statusMessage: 'Loading saved event data...' }).catch((error) => {
      console.error('Initial fetch failed', error);
      setEventLoading('fetch', false);
    });
  }
}

if (eventElements.syncButton) {
  eventElements.syncButton.addEventListener('click', () => {
    flashButton(eventElements.syncButton);
    syncSquare();
  });
}

if (eventElements.loadButton) {
  eventElements.loadButton.addEventListener('click', () => {
    flashButton(eventElements.loadButton);
    fetchSquareData();
  });
}

if (eventElements.sampleButton) {
  eventElements.sampleButton.addEventListener('click', () => {
    flashButton(eventElements.sampleButton);
    loadSampleData();
  });
}

if (eventElements.sourceInput) {
  eventElements.sourceInput.addEventListener("change", (event) => {
    const value = event.target.value ? event.target.value.trim() : "";
    safeWriteStorage(EVENT_STORAGE_KEYS.source, value);
    eventState.urls = null;
  });
}

if (eventElements.secretInput) {
  const updateSecret = (persist) => (event) => {
    setSecretValue(event.target.value, { persist });
  };
  eventElements.secretInput.addEventListener('input', updateSecret(false));
  eventElements.secretInput.addEventListener('change', updateSecret(true));
}

if (eventElements.eventSelect) {
  eventElements.eventSelect.addEventListener("change", (event) => {
    eventState.selectedEventId = event.target.value || "";
    safeWriteStorage(EVENT_STORAGE_KEYS.eventId, eventState.selectedEventId);
    renderSelectedEvent();
  });
}

export function initEvents() {
  updateEventLoadingUi();
  initializeEventExplorer();
}
