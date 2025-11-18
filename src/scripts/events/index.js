import {
  APP_STORAGE_KEYS,
  EVENT_FIELD_HINTS,
  EVENT_STORAGE_KEYS,
  PRODUCT_KEYWORDS,
  SIZE_ALIASES,
  SIZE_PHRASE_PATTERNS,
  SIZE_SYNONYMS,
  SIZES,
  EXACT_SIZE_LABELS
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
  productButtons: document.querySelectorAll("[data-event-product-button]"),
  productOtherSelect: document.querySelector("[data-event-product-other]"),
  productCompareSelect: document.querySelector("[data-event-product-compare]"),
  productChart: document.getElementById("event-product-chart"),
  productChartTitle: document.querySelector("[data-event-product-title]"),
  productChartCard: document.querySelector("[data-event-product-card]"),
  productTableWrapper: document.querySelector("[data-event-product-table-wrapper]"),
  productTableBody: document.querySelector("#event-product-table tbody"),
  productTotalCell: document.querySelector("[data-event-product-total]"),
  productShareCell: document.querySelector("[data-event-product-share]"),
  compareChart: document.getElementById("event-compare-chart"),
  compareChartTitle: document.querySelector("[data-event-compare-title]"),
  compareChartCard: document.querySelector("[data-event-compare-card]"),
  compareTableWrapper: document.querySelector("[data-event-compare-wrapper]"),
  compareTableBody: document.querySelector("#event-compare-table tbody"),
  compareTotalCell: document.querySelector("[data-event-compare-total]"),
  compareShareCell: document.querySelector("[data-event-compare-share]"),
  metricDisplays: {
    hoodies: document.querySelector('[data-event-metric="hoodies"]'),
    shirts: document.querySelector('[data-event-metric="shirts"]'),
    addon5: document.querySelector('[data-event-metric="addon5"]'),
    addon10: document.querySelector('[data-event-metric="addon10"]'),
    addon5APS: document.querySelector('[data-event-metric="addon5APS"]'),
    addon10APS: document.querySelector('[data-event-metric="addon10APS"]')
  }
};

const productViews = {
  primary: {
    chart: eventElements.productChart,
    title: eventElements.productChartTitle,
    tableBody: eventElements.productTableBody,
    totalCell: eventElements.productTotalCell,
    shareCell: eventElements.productShareCell,
    card: eventElements.productChartCard,
    tableWrapper: eventElements.productTableWrapper,
    defaultTitle: "Item Size Distribution"
  },
  compare: {
    chart: eventElements.compareChart,
    title: eventElements.compareChartTitle,
    tableBody: eventElements.compareTableBody,
    totalCell: eventElements.compareTotalCell,
    shareCell: eventElements.compareShareCell,
    card: eventElements.compareChartCard,
    tableWrapper: eventElements.compareTableWrapper,
    defaultTitle: "Comparison Size Distribution"
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

const STANDARD_PRODUCT_LABELS = {
  hoodie: "Classic Hoodie",
  shirt: "Classic Shirt",
  addon5: "Add-On $5",
  addon10: "Add-On $10"
};

function normalizeDisplayValue(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }
  const text = String(value).trim();
  return text || fallback;
}

function slugifyLabel(label) {
  return label
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveProductLabel(productType, itemValue, variationValue) {
  const canonical = STANDARD_PRODUCT_LABELS[productType];
  const itemLabel = normalizeDisplayValue(itemValue, "");
  const variationLabel = normalizeDisplayValue(variationValue, "");
  if (canonical) {
    return canonical;
  }
  if (itemLabel) {
    return itemLabel;
  }
  if (variationLabel) {
    return variationLabel;
  }
  return "Other Item";
}

function resolveRawLabel(itemValue, variationValue, fallback) {
  const itemLabel = normalizeDisplayValue(itemValue, "");
  if (itemLabel) {
    return itemLabel;
  }
  const variationLabel = normalizeDisplayValue(variationValue, "");
  if (variationLabel) {
    return variationLabel;
  }
  return fallback;
}

function buildProductKey(productType, label) {
  if (productType === "hoodie" || productType === "shirt" || productType === "addon5" || productType === "addon10") {
    return productType;
  }
  const normalized = label.toLowerCase().replace(/\s+/g, " ").trim();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  return `other:${slug}`;
}

function buildVariantKey(productType, label) {
  const slug = slugifyLabel(label) || productType;
  return `variant:${productType}:${slug}`;
}

function shouldTrackVariant(productType, canonicalLabel, rawLabel) {
  if (!rawLabel) {
    return false;
  }
  if (!canonicalLabel) {
    return false;
  }
  const canonicalNormalized = canonicalLabel.toLowerCase();
  const actualNormalized = rawLabel.toLowerCase();
  return canonicalNormalized !== actualNormalized;
}

function ensureProductSummary(record, key, label, type = "other") {
  if (!record.products.has(key)) {
    record.products.set(key, {
      key,
      label,
      type,
      counts: Array(SIZES.length).fill(0),
      total: 0,
      hasSizes: false
    });
  }
  return record.products.get(key);
}

function getSelectedEventRecord() {
  return eventState.events.find((event) => event.id === eventState.selectedEventId) || null;
}

function ensureSelectedProduct(record) {
  if (!record || !record.products) {
    eventState.selectedProductKey = "";
    return "";
  }
  const currentKey = eventState.selectedProductKey;
  if (currentKey && record.products.has(currentKey)) {
    const summary = record.products.get(currentKey);
    if (summary && summary.total > 0) {
      return currentKey;
    }
  }
  const preferred = ["hoodie", "shirt"];
  for (const key of preferred) {
    const summary = record.products.get(key);
    if (summary && summary.total > 0) {
      eventState.selectedProductKey = key;
      return key;
    }
  }
  for (const product of record.products.values()) {
    if (product.total > 0) {
      eventState.selectedProductKey = product.key;
      return product.key;
    }
  }
  eventState.selectedProductKey = "";
  return "";
}

function buildProductDisplayData(product) {
  if (!product) {
    return { counts: [], labels: [] };
  }
  if (product.hasSizes && product.counts.some((value) => value > 0)) {
    return { counts: product.counts, labels: SIZES };
  }
  if (product.total > 0) {
    return { counts: [product.total], labels: ["Units"] };
  }
  return { counts: [], labels: [] };
}

function renderProductViewForKey(record, productKey, view, { hideWhenEmpty = false } = {}) {
  if (!record || !productKey) {
    renderProductPlaceholder("Select an item to view size data.", view, { hideContainer: hideWhenEmpty });
    return;
  }
  const product = record.products.get(productKey);
  if (!product || product.total <= 0) {
    renderProductPlaceholder("No data for that item.", view, { hideContainer: hideWhenEmpty });
    return;
  }
  if (view.card) {
    view.card.classList.remove("hidden");
  }
  if (view.tableWrapper) {
    view.tableWrapper.classList.remove("hidden");
  }
  if (view.title) {
    view.title.textContent = `${product.label} Size Distribution`;
  }
  const { counts, labels } = buildProductDisplayData(product);
  if (!counts.length || !labels.length) {
    renderProductPlaceholder("No size detail available for this item.", view, { hideContainer: hideWhenEmpty });
    return;
  }
  const percentages = shareByIndex(counts);
  drawHistogram(view.chart, counts, {
    percentages,
    yLabel: "units",
    colors: getProductColors(product),
    labels
  });
  renderProductTable(labels, counts, percentages, view);
  const totalUnits = counts.reduce((acc, value) => acc + value, 0);
  if (view.totalCell) {
    view.totalCell.textContent = formatInteger(totalUnits);
  }
  if (view.shareCell) {
    view.shareCell.textContent = totalUnits > 0 ? "100%" : "--";
  }
}

function getProductColors(product) {
  if (!product) {
    return {};
  }
  if (product.key === "hoodie") {
    return { from: "rgba(119, 167, 255, 0.95)", to: "rgba(80, 122, 255, 0.82)" };
  }
  if (product.key === "shirt") {
    return { from: "rgba(255, 166, 133, 0.9)", to: "rgba(232, 112, 134, 0.82)" };
  }
  return { from: "rgba(132, 247, 222, 0.9)", to: "rgba(72, 201, 176, 0.8)" };
}

function renderSelectedProduct(record) {
  if (!record) {
    renderProductPlaceholder("Select an event to view item data.", productViews.primary);
    renderProductPlaceholder("Select an item to compare.", productViews.compare, { hideContainer: true });
    return;
  }
  const selectedKey = ensureSelectedProduct(record);
  if (!selectedKey) {
    renderProductPlaceholder("No items available for this event.", productViews.primary);
    renderProductPlaceholder("Select an item to compare.", productViews.compare, { hideContainer: true });
    return;
  }
  renderProductViewForKey(record, selectedKey, productViews.primary);
  renderComparisonProduct(record);
}

function renderComparisonProduct(record) {
  if (!record) {
    renderProductPlaceholder("Select an item to compare.", productViews.compare, { hideContainer: true });
    return;
  }
  const compareKey = eventState.compareProductKey;
  if (!compareKey) {
    renderProductPlaceholder("Select an item to compare.", productViews.compare, { hideContainer: true });
    return;
  }
  renderProductViewForKey(record, compareKey, productViews.compare, { hideWhenEmpty: false });
}

function updateProductControls(record, { resetOtherSelect = false } = {}) {
  const selectedKey = eventState.selectedProductKey;
  if (eventElements.productButtons && eventElements.productButtons.length) {
    eventElements.productButtons.forEach((button) => {
      const key = button.dataset.eventProductButton;
      if (!key) {
        return;
      }
      const summary = record?.products?.get(key);
      const hasData = Boolean(summary && summary.total > 0);
      button.disabled = !hasData;
      button.classList.toggle("is-active", hasData && key === selectedKey);
    });
  }
  const otherSelect = eventElements.productOtherSelect;
  if (otherSelect) {
    const options = [];
    if (record?.products) {
      record.products.forEach((product, key) => {
        if (key !== "hoodie" && key !== "shirt" && product.total > 0) {
          options.push(product);
        }
      });
    }
    options.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    otherSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = options.length ? "Select item" : "No other items";
    otherSelect.appendChild(placeholder);
    options.forEach((product) => {
      const option = document.createElement("option");
      option.value = product.key;
      option.textContent = product.label;
      otherSelect.appendChild(option);
    });
    otherSelect.disabled = options.length === 0;
    if (selectedKey && options.some((product) => product.key === selectedKey)) {
      otherSelect.value = selectedKey;
    } else if (resetOtherSelect || selectedKey === "hoodie" || selectedKey === "shirt") {
      otherSelect.value = "";
    }
  }
  const compareSelect = eventElements.productCompareSelect;
  if (compareSelect) {
    const compareOptions = [];
    if (record?.products) {
      record.products.forEach((product) => {
        if (product.total > 0) {
          compareOptions.push(product);
        }
      });
    }
    compareOptions.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    compareSelect.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = compareOptions.length ? "No comparison" : "No items available";
    compareSelect.appendChild(defaultOption);
    compareOptions.forEach((product) => {
      const option = document.createElement("option");
      option.value = product.key;
      option.textContent = product.label;
      compareSelect.appendChild(option);
    });
    const hasExisting = compareOptions.some((product) => product.key === eventState.compareProductKey);
    compareSelect.disabled = compareOptions.length === 0;
    if (eventState.compareProductKey && hasExisting) {
      compareSelect.value = eventState.compareProductKey;
    } else {
      compareSelect.value = "";
      if (!hasExisting) {
        eventState.compareProductKey = "";
      }
    }
  }
}

function refreshProductVisualization(record, { resetOtherSelect = false } = {}) {
  if (!record) {
    renderEventPlaceholder("Select an event to view item data.");
    return;
  }
  ensureSelectedProduct(record);
  updateProductControls(record, { resetOtherSelect });
  renderSelectedProduct(record);
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
  const normalizedExact = str.replace(/\s+/g, " ").toUpperCase();
  if (Object.prototype.hasOwnProperty.call(EXACT_SIZE_LABELS, normalizedExact)) {
    return EXACT_SIZE_LABELS[normalizedExact];
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
  const phraseMatch = SIZE_PHRASE_PATTERNS.find(({ regex }) => regex.test(lower));
  if (phraseMatch) {
    return phraseMatch.value;
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
  for (const size of SIZES) {
    if (lower.includes(size.toLowerCase())) {
      return size;
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
        products: new Map(),
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

    const productLabel = resolveProductLabel(productType, itemValue, variationValue);
    const rawLabel = resolveRawLabel(itemValue, variationValue, productLabel);
    const productKey = buildProductKey(productType, productLabel);
    const productSummary = ensureProductSummary(record, productKey, productLabel, productType || "other");
    let variantSummary = null;
    const canonicalLabel = STANDARD_PRODUCT_LABELS[productType];
    if (
      (productType === "hoodie" || productType === "shirt") &&
      shouldTrackVariant(productType, canonicalLabel, rawLabel)
    ) {
      const variantKey = buildVariantKey(productType, rawLabel);
      variantSummary = ensureProductSummary(record, variantKey, rawLabel, "variant");
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
        productSummary.counts[index] += quantity;
        productSummary.total += quantity;
        productSummary.hasSizes = true;
        if (variantSummary) {
          variantSummary.counts[index] += quantity;
          variantSummary.total += quantity;
          variantSummary.hasSizes = true;
        }
      }
      return;
    }

    if (productType === "addon5") {
      record.addOn5 += quantity;
    } else if (productType === "addon10") {
      record.addOn10 += quantity;
    }

    if (quantity === 0) {
      return;
    }
    const index = sizeValue ? SIZES.indexOf(sizeValue) : -1;
    if (index >= 0) {
      productSummary.counts[index] += quantity;
      productSummary.hasSizes = true;
      if (variantSummary) {
        variantSummary.counts[index] += quantity;
        variantSummary.hasSizes = true;
      }
    }
    productSummary.total += quantity;
    if (variantSummary) {
      variantSummary.total += quantity;
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

function renderProductPlaceholder(message, view, { hideContainer = false } = {}) {
  if (!view) {
    return;
  }
  const { tableBody, totalCell, shareCell, chart, card, tableWrapper, title } = view;
  if (card) {
    card.classList.toggle("hidden", hideContainer);
  }
  if (tableWrapper) {
    tableWrapper.classList.toggle("hidden", hideContainer);
  }
  if (tableBody) {
    tableBody.innerHTML = "";
    if (!hideContainer) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 3;
      cell.className = "event-empty";
      cell.textContent = message;
      row.appendChild(cell);
      tableBody.appendChild(row);
    }
  }
  if (totalCell) {
    totalCell.textContent = "0";
  }
  if (shareCell) {
    shareCell.textContent = "--";
  }
  if (title && !hideContainer) {
    title.textContent = view.defaultTitle || "Item Size Distribution";
  }
  clearCanvas(chart);
}

function renderProductTable(labels, counts, percentages, view) {
  if (!view || !view.tableBody) {
    return;
  }
  const tbody = view.tableBody;
  tbody.innerHTML = "";
  labels.forEach((label, index) => {
    const tr = document.createElement("tr");
    const sizeCell = document.createElement("td");
    sizeCell.textContent = label;
    sizeCell.style.fontWeight = "600";
    const unitsCell = document.createElement("td");
    unitsCell.textContent = formatInteger(counts[index] || 0);
    const shareCell = document.createElement("td");
    const share = percentages[index] || 0;
    shareCell.textContent = share > 0 ? `${(share * 100).toFixed(1)}%` : "0%";
    tr.appendChild(sizeCell);
    tr.appendChild(unitsCell);
    tr.appendChild(shareCell);
    tbody.appendChild(tr);
  });
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
  renderProductPlaceholder(message, productViews.primary);
  renderProductPlaceholder("Select an item to compare.", productViews.compare, { hideContainer: true });
}

function resetEventMetrics() {
  const metrics = eventElements.metricDisplays;
  if (metrics.hoodies) metrics.hoodies.textContent = "0";
  if (metrics.shirts) metrics.shirts.textContent = "0";
  if (metrics.addon5) metrics.addon5.textContent = "0";
  if (metrics.addon10) metrics.addon10.textContent = "0";
  if (metrics.addon5APS) metrics.addon5APS.textContent = "0.00";
  if (metrics.addon10APS) metrics.addon10APS.textContent = "0.00";
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
    renderEventPlaceholder(eventState.events.length ? "Select an event to view details." : "Load data to see item size distributions.");
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
    renderEventPlaceholder(events.length ? "Select an event to view details." : "Load data to see item size distributions.");
    return;
  }

  const metrics = eventElements.metricDisplays;
  if (metrics.hoodies) metrics.hoodies.textContent = formatInteger(record.hoodies.total);
  if (metrics.shirts) metrics.shirts.textContent = formatInteger(record.shirts.total);
  if (metrics.addon5) metrics.addon5.textContent = formatInteger(record.addOn5);
  if (metrics.addon10) metrics.addon10.textContent = formatInteger(record.addOn10);
  if (metrics.addon5APS) metrics.addon5APS.textContent = formatNumber(record.addOn5APS, { decimals: 2 });
  if (metrics.addon10APS) metrics.addon10APS.textContent = formatNumber(record.addOn10APS, { decimals: 2 });

  refreshProductVisualization(record);

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
  renderEventPlaceholder("Load data to see item size distributions.");
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

if (eventElements.productButtons && eventElements.productButtons.length) {
  eventElements.productButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.eventProductButton;
      if (!key) {
        return;
      }
      eventState.selectedProductKey = key;
      const record = getSelectedEventRecord();
      if (record) {
        refreshProductVisualization(record, { resetOtherSelect: true });
      } else {
        renderProductPlaceholder("Select an event to view item data.");
      }
    });
  });
}

if (eventElements.productOtherSelect) {
  eventElements.productOtherSelect.addEventListener("change", (event) => {
    const value = event.target.value || "";
    if (!value) {
      const record = getSelectedEventRecord();
      if (record) {
        refreshProductVisualization(record, { resetOtherSelect: true });
      }
      return;
    }
    eventState.selectedProductKey = value;
    const record = getSelectedEventRecord();
    if (record) {
      refreshProductVisualization(record);
    }
  });
}

if (eventElements.productCompareSelect) {
  eventElements.productCompareSelect.addEventListener("change", (event) => {
    eventState.compareProductKey = event.target.value || "";
    const record = getSelectedEventRecord();
    if (record) {
      renderComparisonProduct(record);
    } else {
      renderProductPlaceholder("Select an item to compare.", productViews.compare, { hideContainer: true });
    }
  });
}

export function initEvents() {
  updateEventLoadingUi();
  initializeEventExplorer();
}
