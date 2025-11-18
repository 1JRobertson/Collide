import {
  APP_STORAGE_KEYS,
  ARCHETYPE_PRESETS,
  BLACK_ONLY_SIZE_INDICES,
  CONTROL_CONFIG,
  PRODUCTS,
  SIZES
} from "../constants.js";
import { eventState } from "../state.js";
import { formatNumber, formatValue, formatTimestamp } from "../utils/format.js";
import { allocateCounts, computeDistribution } from "../utils/math.js";
import { drawHistogram } from "../utils/charts.js";
import { safeReadStorage, safeWriteStorage } from "../utils/storage.js";

const controlElements = {
  hoodie: {
    mean: {
      slider: document.getElementById("hoodie-mean-range"),
      input: document.getElementById("hoodie-mean-input")
    },
    sigma: {
      slider: document.getElementById("hoodie-sigma-range"),
      input: document.getElementById("hoodie-sigma-input")
    },
    skew: {
      slider: document.getElementById("hoodie-skew-range"),
      input: document.getElementById("hoodie-skew-input")
    },
    spt: {
      slider: document.getElementById("hoodie-spt-range"),
      input: document.getElementById("hoodie-spt-input")
    }
  },
  shirt: {
    mean: {
      slider: document.getElementById("shirt-mean-range"),
      input: document.getElementById("shirt-mean-input")
    },
    sigma: {
      slider: document.getElementById("shirt-sigma-range"),
      input: document.getElementById("shirt-sigma-input")
    },
    skew: {
      slider: document.getElementById("shirt-skew-range"),
      input: document.getElementById("shirt-skew-input")
    },
    spt: {
      slider: document.getElementById("shirt-spt-range"),
      input: document.getElementById("shirt-spt-input")
    }
  },
  shared: {
    teams: {
      slider: document.getElementById("teams-range"),
      input: document.getElementById("teams-input")
    },
    addon5APS: {
      slider: document.getElementById("addon5-range"),
      input: document.getElementById("addon5-input")
    },
    addon10APS: {
      slider: document.getElementById("addon10-range"),
      input: document.getElementById("addon10-input")
    }
  }
};

const sizeScaleElements = {
  hoodie: Array.from(document.querySelectorAll('.size-scale[data-product="hoodie"] span')),
  shirt: Array.from(document.querySelectorAll('.size-scale[data-product="shirt"] span'))
};

const summaryDisplays = {
  teams: document.querySelector('[data-metric="teams"]'),
  hoodieSpt: document.querySelector('[data-metric="hoodieSpt"]'),
  shirtSpt: document.querySelector('[data-metric="shirtSpt"]'),
  hoodieTotal: document.querySelector('[data-metric="hoodieTotal"]'),
  shirtTotal: document.querySelector('[data-metric="shirtTotal"]'),
  combinedTotal: document.querySelector('[data-metric="combinedTotal"]'),
  addon5Units: document.querySelector('[data-metric="addon5Units"]'),
  addon10Units: document.querySelector('[data-metric="addon10Units"]'),
  syncTimestamp: document.querySelector("[data-sync-timestamp]"),
  fetchTimestamp: document.querySelector("[data-fetch-timestamp]")
};

const hoodieCurveCanvas = document.getElementById("hoodie-curve-chart");
const shirtCurveCanvas = document.getElementById("shirt-curve-chart");
const hoodieLegend = document.getElementById("hoodie-legend");
const shirtLegend = document.getElementById("shirt-legend");
const allocationTableBody = document.querySelector("#allocation-table tbody");
const allocationExportButton = document.getElementById("export-button");
const archetypeButtons = Array.from(document.querySelectorAll(".archetype-button"));
const tabButtons = Array.from(document.querySelectorAll("[data-tab-button]"));
const productTabButtons = Array.from(document.querySelectorAll("[data-product-tab-button]"));
const productPanels = Array.from(document.querySelectorAll("[data-product-tab]"));
const projectionNodes = document.querySelectorAll(".projection-only");
const transactionNodes = document.querySelectorAll(".transactions-only");

let activeArchetypeKey = null;
let currentAllocation = null;

function setActiveProductTab(key, { persist = true } = {}) {
  const validKeys = productPanels.map((panel) => panel.dataset.productTab);
  const target = validKeys.includes(key) ? key : "hoodie";
  productTabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.productTabButton === target);
  });
  productPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.productTab !== target);
  });
  if (persist) {
    safeWriteStorage(APP_STORAGE_KEYS.productTab, target);
  }
}

productTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveProductTab(button.dataset.productTabButton || "hoodie");
  });
});

export function setActiveTab(tab, { persist = true } = {}) {
  const target = tab === "transactions" ? "transactions" : "projection";
  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tabButton === target);
  });
  projectionNodes.forEach((node) => {
    if (node.dataset.productTab) {
      if (target !== "projection") {
        node.classList.add("hidden");
      }
      return;
    }
    node.classList.toggle("hidden", target !== "projection");
  });
  transactionNodes.forEach((node) => {
    node.classList.toggle("hidden", target !== "transactions");
  });
  document.body.dataset.activeTab = target;
  if (persist) {
    safeWriteStorage(APP_STORAGE_KEYS.activeTab, target);
  }
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.dataset.tabButton || "projection");
  });
});

function updateSizeScale(productKey, mean) {
  const spans = sizeScaleElements[productKey];
  if (!spans || !spans.length) return;
  const clamped = Math.max(0, Math.min(SIZES.length - 1, Math.round(mean)));
  spans.forEach((span) => {
    const index = Number(span.dataset.index);
    span.classList.toggle("active", index === clamped);
  });
}

function ensureSliderRange(groupKey, key, value) {
  const groupConfig = CONTROL_CONFIG[groupKey];
  if (!groupConfig) return;
  const config = groupConfig[key];
  if (!config) return;
  const { slider } = controlElements[groupKey][key];
  if (!slider) return;
  const span = config.span;
  if (!span) return;
  let min = value - span / 2;
  let max = value + span / 2;
  if (config.absoluteMin !== undefined && min < config.absoluteMin) {
    min = config.absoluteMin;
    max = min + span;
  }
  if (config.absoluteMax !== undefined && max > config.absoluteMax) {
    max = config.absoluteMax;
    min = max - span;
    if (config.absoluteMin !== undefined && min < config.absoluteMin) {
      min = config.absoluteMin;
    }
  }
  slider.min = formatValue(min, config.precision);
  slider.max = formatValue(max, config.precision);
}

function setControlValue(groupKey, key, rawValue, { source = "programmatic", silent = false } = {}) {
  const groupConfig = CONTROL_CONFIG[groupKey];
  const element = controlElements[groupKey] && controlElements[groupKey][key];
  if (!element) return;
  let value = rawValue;
  const config = groupConfig ? groupConfig[key] : undefined;
  if (config) {
    if (config.absoluteMin !== undefined && value < config.absoluteMin) {
      value = config.absoluteMin;
    }
    if (config.absoluteMax !== undefined && value > config.absoluteMax) {
      value = config.absoluteMax;
    }
    ensureSliderRange(groupKey, key, value);
  }
  if (element.slider && config) {
    element.slider.value = formatValue(value, config.precision);
  } else if (element.slider) {
    element.slider.value = value;
  }
  if (element.input) {
    const precision = config ? config.precision : 2;
    element.input.value = formatValue(value, precision);
  }
  if (groupKey === "hoodie" && key === "mean") {
    updateSizeScale("hoodie", value);
  }
  if (groupKey === "shirt" && key === "mean") {
    updateSizeScale("shirt", value);
  }
  if (!silent) {
    if (source !== "archetype") {
      clearActiveArchetype();
    }
    recompute();
  }
}

function readAddonValue(key) {
  const element = controlElements.shared[key];
  if (!element) {
    return 0;
  }
  if (element.slider) {
    const sliderValue = parseFloat(element.slider.value);
    if (Number.isFinite(sliderValue)) {
      return sliderValue;
    }
  }
  if (element.input) {
    const inputValue = parseFloat(element.input.value);
    if (Number.isFinite(inputValue)) {
      return inputValue;
    }
  }
  return 0;
}

function clearActiveArchetype() {
  if (!activeArchetypeKey) return;
  archetypeButtons.forEach((button) => button.classList.remove("active"));
  activeArchetypeKey = null;
  safeWriteStorage(APP_STORAGE_KEYS.archetype, "");
}

function setActiveArchetype(key) {
  activeArchetypeKey = key;
  archetypeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.archetype === key);
  });
  if (key) {
    safeWriteStorage(APP_STORAGE_KEYS.archetype, key);
  }
}

function applyArchetype(key) {
  const preset = ARCHETYPE_PRESETS[key];
  if (!preset) return;
  setActiveArchetype(key);
  const ops = { source: "archetype", silent: true };
  setControlValue("hoodie", "mean", preset.hoodie.mean, ops);
  setControlValue("hoodie", "sigma", preset.hoodie.sigma, ops);
  setControlValue("hoodie", "skew", preset.hoodie.skew, ops);
  setControlValue("hoodie", "spt", preset.hoodie.spt, ops);
  setControlValue("shirt", "mean", preset.shirt.mean, ops);
  setControlValue("shirt", "sigma", preset.shirt.sigma, ops);
  setControlValue("shirt", "skew", preset.shirt.skew, ops);
  setControlValue("shirt", "spt", preset.shirt.spt, ops);
  setControlValue("shared", "addon5APS", preset.shared.addon5APS, { source: "archetype", silent: true });
  setControlValue("shared", "addon10APS", preset.shared.addon10APS, { source: "archetype", silent: true });
  recompute();
}

archetypeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.archetype;
    applyArchetype(key);
  });
});

function createColorManager(config) {
  const state = {
    extras: [],
    weights: {},
    sliderRefs: new Map(),
    percentRefs: new Map(),
    pinned: new Set(),
    isCustomized: false
  };
  const entry = document.getElementById(config.entryId);
  const addButton = document.getElementById(config.addButtonId);
  const list = document.getElementById(config.listId);
  const note = document.getElementById(config.noteId);

  function normalizeName(name) {
    return name.trim().replace(/\s+/g, " ");
  }

  function getNames() {
    const base = config.baseColors || [];
    return base.concat(state.extras);
  }

  function computeDefaultWeights(names) {
    if (!names.length) {
      return [];
    }
    if (config.baseColors.length === 1 && config.baseColors[0] === "Black") {
      if (names.length === 1) {
        return [1];
      }
      const extraShare = state.extras.length ? 0.5 / state.extras.length : 0;
      return [0.5, ...state.extras.map(() => extraShare)];
    }
    const even = 1 / names.length;
    return names.map(() => even);
  }

  function setDefaultWeights() {
    const names = getNames();
    const defaults = computeDefaultWeights(names);
    names.forEach((color, index) => {
      state.weights[color] = defaults[index] || 0;
    });
    state.isCustomized = false;
    return defaults;
  }

  function normalizeWeights(names) {
    if (!names.length) {
      state.weights = {};
      return [];
    }
    const pinnedColors = names.filter((color) => state.pinned.has(color));
    const flexibleColors = names.filter((color) => !state.pinned.has(color));
    const pinnedTotal = pinnedColors.reduce(
      (acc, color) => acc + Math.max(0, state.weights[color] || 0),
      0
    );
    if (flexibleColors.length === 0) {
      if (pinnedTotal === 0) {
        const even = 1 / names.length;
        names.forEach((color) => {
          state.weights[color] = even;
        });
      } else {
        const scale = pinnedTotal > 0 ? Math.min(1 / pinnedTotal, 1) : 0;
        pinnedColors.forEach((color) => {
          state.weights[color] = Math.max(0, Math.min(1, (state.weights[color] || 0) * scale));
        });
      }
      return names.map((color) => state.weights[color] || 0);
    }
    const flexibleValues = flexibleColors.map((color) => Math.max(0, state.weights[color] || 0));
    const flexibleTotal = flexibleValues.reduce((acc, value) => acc + value, 0);
    const remaining = Math.max(0, 1 - pinnedTotal);
    if (remaining <= 0) {
      flexibleColors.forEach((color) => {
        state.weights[color] = 0;
      });
      return names.map((color) => state.weights[color] || 0);
    }
    if (flexibleTotal <= 0) {
      const evenFlex = remaining / flexibleColors.length;
      flexibleColors.forEach((color) => {
        state.weights[color] = evenFlex;
      });
    } else {
      flexibleColors.forEach((color, index) => {
        const ratio = flexibleValues[index] / flexibleTotal;
        state.weights[color] = ratio * remaining;
      });
    }
    return names.map((color) => state.weights[color] || 0);
  }

  function ensureWeights(names) {
    if (!names.length) {
      return [];
    }
    const hasStored = names.some((color) => typeof state.weights[color] === "number");
    if (!hasStored) {
      return setDefaultWeights();
    }
    return normalizeWeights(names);
  }

  function syncColorControls() {
    const names = getNames();
    const weights = ensureWeights(names);
    names.forEach((color, index) => {
      const percent = Math.round((weights[index] || 0) * 100);
      const slider = state.sliderRefs.get(color);
      const percentNode = state.percentRefs.get(color);
      if (slider) {
        slider.value = String(percent);
      }
      if (percentNode) {
        percentNode.textContent = `${percent}%`;
      }
    });
  }

  function adjustWeights(targetColor, fraction) {
    const names = getNames();
    if (!names.length) {
      return;
    }
    if (names.length === 1) {
      state.weights[targetColor] = 1;
      state.isCustomized = true;
      return;
    }
    const pinnedOthers = names.filter((color) => state.pinned.has(color) && color !== targetColor);
    const flexibleOthers = names.filter((color) => color !== targetColor && !state.pinned.has(color));
    const pinnedTotal = pinnedOthers.reduce(
      (acc, color) => acc + Math.max(0, state.weights[color] || 0),
      0
    );
    const maxTarget = Math.max(0, 1 - pinnedTotal);
    const clamped = Math.min(Math.max(fraction, 0), maxTarget);
    state.weights[targetColor] = clamped;
    const remaining = Math.max(0, 1 - pinnedTotal - clamped);
    if (flexibleOthers.length > 0) {
      const flexibleTotal = flexibleOthers.reduce(
        (acc, color) => acc + Math.max(0, state.weights[color] || 0),
        0
      );
      if (flexibleTotal <= 0) {
        const evenShare = remaining / flexibleOthers.length;
        flexibleOthers.forEach((color) => {
          state.weights[color] = evenShare;
        });
      } else {
        flexibleOthers.forEach((color) => {
          const portion = (state.weights[color] || 0) / flexibleTotal;
          state.weights[color] = portion * remaining;
        });
      }
    } else if (remaining > 0) {
      state.weights[targetColor] = Math.min(1, clamped + remaining);
    }
    normalizeWeights(names);
    state.isCustomized = true;
  }

  function updateNote(message, isWarning = false) {
    if (!note) return;
    if (message) {
      note.textContent = message;
    } else if (config.baseColors.length) {
      if (state.extras.length) {
        note.textContent = `Black begins at 50%. Adjust sliders to fine-tune ${state.extras.length} additional color(s).`;
      } else {
        note.textContent = config.noteDefault;
      }
    } else if (state.extras.length) {
      note.textContent = `Adjust sliders to split evenly across ${state.extras.length} color(s).`;
    } else {
      note.textContent = config.noteDefault;
    }
    note.classList.toggle("warning", isWarning);
  }

  function togglePinned(color) {
    if (state.pinned.has(color)) {
      state.pinned.delete(color);
    } else {
      state.pinned.add(color);
    }
    state.isCustomized = true;
    normalizeWeights(getNames());
    renderColorControls();
    updateNote();
    recompute();
  }

  function renderColorControls() {
    if (!list) {
      return;
    }
    const names = getNames();
    list.innerHTML = "";
    state.sliderRefs.clear();
    state.percentRefs.clear();
    if (!names.length) {
      const empty = document.createElement("p");
      empty.className = "color-empty-message";
      empty.textContent = "Add colors to build a mix.";
      list.appendChild(empty);
      return;
    }
    const weights = ensureWeights(names);
    names.forEach((color, index) => {
      const row = document.createElement("div");
      row.className = "color-mix-row";
      if (state.pinned.has(color)) {
        row.classList.add("is-pinned");
      }
      const header = document.createElement("div");
      header.className = "color-mix-header";
      const labelWrap = document.createElement("div");
      labelWrap.className = "color-mix-label";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = color;
      const label = document.createElement("span");
      label.textContent = color;
      labelWrap.appendChild(swatch);
      labelWrap.appendChild(label);
      const controls = document.createElement("div");
      controls.className = "color-mix-controls";
      const percentNode = document.createElement("span");
      percentNode.className = "color-mix-percent";
      percentNode.textContent = `${Math.round((weights[index] || 0) * 100)}%`;
      const pinButton = document.createElement("button");
      pinButton.type = "button";
      pinButton.className = "color-pin-button";
      pinButton.dataset.pinned = state.pinned.has(color) ? "true" : "false";
      pinButton.textContent = state.pinned.has(color) ? "Pinned" : "Pin %";
      pinButton.addEventListener("click", () => {
        togglePinned(color);
      });
      controls.appendChild(percentNode);
      controls.appendChild(pinButton);
      header.appendChild(labelWrap);
      header.appendChild(controls);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.step = "1";
      slider.value = String(Math.round((weights[index] || 0) * 100));
      slider.disabled = state.pinned.has(color);
      slider.addEventListener("input", (event) => {
        const percentValue = Number(event.target.value);
        adjustWeights(color, percentValue / 100);
        syncColorControls();
        updateNote();
        recompute();
      });
      row.appendChild(header);
      row.appendChild(slider);
      if (state.extras.includes(color)) {
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "color-remove-button";
        removeButton.textContent = "Remove";
        removeButton.addEventListener("click", () => {
          state.extras = state.extras.filter((value) => value !== color);
          state.pinned.delete(color);
          delete state.weights[color];
          if (state.isCustomized) {
            normalizeWeights(getNames());
          } else {
            setDefaultWeights();
          }
          renderColorControls();
          updateNote();
          recompute();
        });
        row.appendChild(removeButton);
      }
      list.appendChild(row);
      state.sliderRefs.set(color, slider);
      state.percentRefs.set(color, percentNode);
    });
    syncColorControls();
  }

  function handleAdd() {
    if (!entry) return;
    const raw = entry.value ? normalizeName(entry.value) : "";
    if (!raw) {
      updateNote("Enter a color name before adding.", true);
      return;
    }
    if (config.extrasMax && state.extras.length >= config.extrasMax) {
      updateNote(config.noteMax, true);
      return;
    }
    if (state.extras.includes(raw)) {
      updateNote("Color already added.", true);
      return;
    }
    state.extras = [...state.extras, raw];
    entry.value = "";
    state.pinned.delete(raw);
    if (state.isCustomized) {
      state.weights[raw] = 0;
      normalizeWeights(getNames());
    } else {
      setDefaultWeights();
    }
    updateNote();
    renderColorControls();
    recompute();
  }

  if (addButton) {
    addButton.addEventListener("click", handleAdd);
  }
  if (entry) {
    entry.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleAdd();
      }
    });
  }

  setDefaultWeights();
  updateNote();
  renderColorControls();

  return {
    config,
    getNames,
    getWeights() {
      const names = getNames();
      if (!names.length) {
        return [];
      }
      return ensureWeights(names);
    }
  };
}

const colorManagers = {
  hoodie: createColorManager(PRODUCTS.hoodie.colorConfig),
  shirt: createColorManager(PRODUCTS.shirt.colorConfig)
};

function computeProductProjection(productKey, teams) {
  const controls = controlElements[productKey];
  const mean = parseFloat(controls.mean.slider.value);
  const sigma = parseFloat(controls.sigma.slider.value);
  const skew = parseFloat(controls.skew.slider.value);
  const spt = parseFloat(controls.spt.slider.value);
  updateSizeScale(productKey, mean);
  const distribution = computeDistribution(mean, sigma, skew);
  const totalUnits = spt * teams;
  const counts = allocateCounts(distribution, totalUnits);
  const total = counts.reduce((acc, value) => acc + value, 0);
  const percentages = counts.map((count) => (total > 0 ? count / total : 0));
  const rawAddons = {
    addon5: readAddonValue("addon5APS") * total,
    addon10: readAddonValue("addon10APS") * total
  };
  return {
    productKey,
    mean,
    sigma,
    skew,
    spt,
    distribution,
    totalUnits,
    counts,
    percentages,
    total,
    addons: rawAddons
  };
}

function allocateRowColors(total, weights, { lockFirst = false, sizeIndex } = {}) {
  if (total === 0 || weights.length === 0) {
    return weights.map(() => 0);
  }
  if (lockFirst && BLACK_ONLY_SIZE_INDICES.has(sizeIndex)) {
    return [total, ...weights.slice(1).map(() => 0)];
  }
  const raw = weights.map((w) => w * total);
  const counts = raw.map((value) => Math.round(value));
  let difference = total - counts.reduce((acc, value) => acc + value, 0);
  if (difference !== 0) {
    const adjustment = raw
      .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
      .sort((a, b) => (difference > 0 ? b.remainder - a.remainder : a.remainder - b.remainder));
    let idx = 0;
    while (difference !== 0 && adjustment.length > 0) {
      const target = adjustment[idx % adjustment.length];
      if (difference > 0) {
        counts[target.index] += 1;
        difference -= 1;
      } else if (difference < 0 && counts[target.index] > 0) {
        counts[target.index] -= 1;
        difference += 1;
      }
      idx += 1;
    }
  }
  return counts;
}

function computeColorPlan(productKey, counts) {
  const product = PRODUCTS[productKey];
  const manager = colorManagers[productKey];
  const names = manager.getNames();
  const weights = manager.getWeights();
  const rows = counts.map((total, index) => {
    let breakdown = [];
    if (names.length) {
      const colorCounts = allocateRowColors(total, weights, {
        lockFirst: productKey === "hoodie",
        sizeIndex: index
      });
      breakdown = names.map((name, colorIndex) => ({ name, value: colorCounts[colorIndex] || 0 }));
    }
    return {
      product: product.label,
      size: SIZES[index],
      index,
      total,
      colors: breakdown
    };
  });
  const colorTotals = names.map((name, idx) =>
    rows.reduce((acc, row) => acc + (row.colors[idx] ? row.colors[idx].value : 0), 0)
  );
  const grandTotal = counts.reduce((acc, value) => acc + value, 0);
  return {
    product: product.label,
    key: productKey,
    names,
    rows,
    colorTotals,
    grandTotal
  };
}

function renderLegend(legendElement, counts, percentages) {
  if (!legendElement) return;
  legendElement.innerHTML = "";
  counts.forEach((count, index) => {
    const percent = Math.round((percentages[index] || 0) * 100);
    const item = document.createElement("div");
    item.textContent = `${SIZES[index]}: ${count.toLocaleString()} units (${Number.isFinite(percent) ? percent : 0}%)`;
    legendElement.appendChild(item);
  });
}

function renderAllocationTable(bundle) {
  if (!allocationTableBody) return;
  allocationTableBody.innerHTML = "";
  const plans = bundle && bundle.plans ? bundle.plans : bundle;
  const addons = bundle && bundle.addons ? bundle.addons : null;
  ["hoodie", "shirt"].forEach((productKey) => {
    const plan = plans && plans[productKey];
    if (!plan) return;

    const headerRow = document.createElement("tr");
    headerRow.className = "allocation-section";
    const headerCell = document.createElement("td");
    headerCell.colSpan = 5;
    headerCell.textContent = plan.product;
    headerRow.appendChild(headerCell);
    allocationTableBody.appendChild(headerRow);

    plan.rows.forEach((row) => {
      const colors = row.colors.length ? row.colors : [{ name: "--", value: row.total }];
      colors.forEach((color, idx) => {
        const tr = document.createElement("tr");
        if (idx === 0) {
          const productCell = document.createElement("td");
          productCell.textContent = plan.product;
          productCell.rowSpan = colors.length;
          tr.appendChild(productCell);

          const sizeCell = document.createElement("td");
          sizeCell.textContent = row.size;
          sizeCell.rowSpan = colors.length;
          tr.appendChild(sizeCell);

          const totalCell = document.createElement("td");
          totalCell.className = "numeric";
          totalCell.textContent = row.total.toLocaleString();
          totalCell.rowSpan = colors.length;
          tr.appendChild(totalCell);
        }

        const colorCell = document.createElement("td");
        colorCell.textContent = color.name;
        tr.appendChild(colorCell);

        const unitsCell = document.createElement("td");
        unitsCell.className = "numeric";
        unitsCell.textContent = color.value ? formatNumber(color.value, { decimals: 2 }) : "--";
        tr.appendChild(unitsCell);

        allocationTableBody.appendChild(tr);
      });
    });

    const totalRow = document.createElement("tr");
    totalRow.className = "allocation-total";
    const labelCell = document.createElement("td");
    labelCell.colSpan = 2;
    labelCell.textContent = `${plan.product} Total`;
    totalRow.appendChild(labelCell);

    const totalValueCell = document.createElement("td");
    totalValueCell.className = "numeric";
    totalValueCell.textContent = plan.grandTotal.toLocaleString();
    totalRow.appendChild(totalValueCell);

    const spacerCell = document.createElement("td");
    spacerCell.textContent = "";
    totalRow.appendChild(spacerCell);

    const colorTotalCell = document.createElement("td");
    colorTotalCell.className = "numeric";
    colorTotalCell.textContent = plan.grandTotal.toLocaleString();
    totalRow.appendChild(colorTotalCell);

    allocationTableBody.appendChild(totalRow);
  });

  if (addons) {
    const addOnHeader = document.createElement("tr");
    addOnHeader.className = "allocation-section";
    const headerCell = document.createElement("td");
    headerCell.colSpan = 5;
    headerCell.textContent = "Add-Ons";
    addOnHeader.appendChild(headerCell);
    allocationTableBody.appendChild(addOnHeader);

    const addOnRows = [
      { label: "Add-On $5", value: addons.addon5 || 0 },
      { label: "Add-On $10", value: addons.addon10 || 0 }
    ];
    addOnRows.forEach((entry) => {
      const tr = document.createElement("tr");
      const productCell = document.createElement("td");
      productCell.textContent = entry.label;
      tr.appendChild(productCell);

      const sizeCell = document.createElement("td");
      sizeCell.textContent = "--";
      tr.appendChild(sizeCell);

      const totalCell = document.createElement("td");
      totalCell.className = "numeric";
      totalCell.textContent = formatNumber(entry.value, { decimals: 2 });
      tr.appendChild(totalCell);

      const colorCell = document.createElement("td");
      colorCell.textContent = "--";
      tr.appendChild(colorCell);

      const unitsCell = document.createElement("td");
      unitsCell.className = "numeric";
      unitsCell.textContent = formatNumber(entry.value, { decimals: 2 });
      tr.appendChild(unitsCell);

      allocationTableBody.appendChild(tr);
    });

    const addOnTotal = (addons.addon5 || 0) + (addons.addon10 || 0);
    const totalRow = document.createElement("tr");
    totalRow.className = "allocation-total";
    const labelCell = document.createElement("td");
    labelCell.colSpan = 2;
    labelCell.textContent = "Add-Ons Total";
    totalRow.appendChild(labelCell);

    const totalValueCell = document.createElement("td");
    totalValueCell.className = "numeric";
    totalValueCell.textContent = formatNumber(addOnTotal, { decimals: 2 });
    totalRow.appendChild(totalValueCell);

    const spacerCell = document.createElement("td");
    spacerCell.textContent = "";
    totalRow.appendChild(spacerCell);

    const colorTotalCell = document.createElement("td");
    colorTotalCell.className = "numeric";
    colorTotalCell.textContent = "--";
    totalRow.appendChild(colorTotalCell);

    allocationTableBody.appendChild(totalRow);
  }
}

function buildCsv(bundle) {
  const header = ["Product", "Size", "Total", "Color", "Units"];
  const rows = [];
  const plans = bundle && bundle.plans ? bundle.plans : bundle;
  const addons = bundle && bundle.addons ? bundle.addons : null;
  ["hoodie", "shirt"].forEach((productKey) => {
    const plan = plans && plans[productKey];
    if (!plan) return;
    plan.rows.forEach((row) => {
      const colors = row.colors.length ? row.colors : [{ name: "--", value: row.total }];
      colors.forEach((color, idx) => {
        rows.push([
          plan.product,
          idx === 0 ? row.size : "",
          idx === 0 ? row.total : "",
          color.name,
          color.value
        ]);
      });
    });
    rows.push([`${plan.product} Total`, "", plan.grandTotal, "", plan.grandTotal]);
  });
  if (addons) {
    const add5 = addons.addon5 || 0;
    const add10 = addons.addon10 || 0;
    const addOnTotal = add5 + add10;
    rows.push(["Add-On $5", "--", formatNumber(add5, { decimals: 2 }), "--", formatNumber(add5, { decimals: 2 })]);
    rows.push(["Add-On $10", "--", formatNumber(add10, { decimals: 2 }), "--", formatNumber(add10, { decimals: 2 })]);
    rows.push(["Add-Ons Total", "--", formatNumber(addOnTotal, { decimals: 2 }), "--", formatNumber(addOnTotal, { decimals: 2 })]);
  }
  const escape = (value) => {
    const str = String(value === undefined ? "" : value);
    if (/["\n,]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}

function recompute() {
  const teams = parseFloat(controlElements.shared.teams.slider.value);
  const addon5APS = readAddonValue("addon5APS");
  const addon10APS = readAddonValue("addon10APS");

  const hoodieProjection = computeProductProjection("hoodie", teams);
  const shirtProjection = computeProductProjection("shirt", teams);

  const hoodieTotal = hoodieProjection.counts.reduce((acc, value) => acc + value, 0);
  const shirtTotal = shirtProjection.counts.reduce((acc, value) => acc + value, 0);
  const combinedTotal = hoodieTotal + shirtTotal;
  const addon5Units = addon5APS * combinedTotal;
  const addon10Units = addon10APS * combinedTotal;

  summaryDisplays.teams.textContent = teams.toLocaleString();
  summaryDisplays.hoodieSpt.textContent = formatValue(hoodieProjection.spt, CONTROL_CONFIG.hoodie.spt.precision);
  summaryDisplays.shirtSpt.textContent = formatValue(shirtProjection.spt, CONTROL_CONFIG.shirt.spt.precision);
  summaryDisplays.hoodieTotal.textContent = hoodieTotal.toLocaleString();
  summaryDisplays.shirtTotal.textContent = shirtTotal.toLocaleString();
  summaryDisplays.combinedTotal.textContent = combinedTotal.toLocaleString();
  summaryDisplays.addon5Units.textContent = formatNumber(addon5Units, { decimals: 2 });
  summaryDisplays.addon10Units.textContent = formatNumber(addon10Units, { decimals: 2 });

  hoodieProjection.addons = {
    addon5: addon5Units * (hoodieTotal / (combinedTotal || 1)),
    addon10: addon10Units * (hoodieTotal / (combinedTotal || 1))
  };
  shirtProjection.addons = {
    addon5: addon5Units * (shirtTotal / (combinedTotal || 1)),
    addon10: addon10Units * (shirtTotal / (combinedTotal || 1))
  };

  drawHistogram(hoodieCurveCanvas, hoodieProjection.counts, {
    percentages: hoodieProjection.percentages,
    yLabel: "units",
    colors: { from: "rgba(111, 136, 255, 0.95)", to: "rgba(73, 94, 201, 0.82)" }
  });
  drawHistogram(shirtCurveCanvas, shirtProjection.counts, {
    percentages: shirtProjection.percentages,
    yLabel: "units",
    colors: { from: "rgba(255, 166, 133, 0.9)", to: "rgba(232, 112, 134, 0.82)" }
  });

  renderLegend(hoodieLegend, hoodieProjection.counts, hoodieProjection.percentages);
  renderLegend(shirtLegend, shirtProjection.counts, shirtProjection.percentages);

  const allocationPlans = {
    hoodie: computeColorPlan("hoodie", hoodieProjection.counts),
    shirt: computeColorPlan("shirt", shirtProjection.counts)
  };
  const allocationBundle = {
    plans: allocationPlans,
    addons: { addon5: addon5Units, addon10: addon10Units },
    syncTimestamp: eventState.syncTimestamp || null,
    fetchTimestamp: new Date(),
    urls: eventState.urls || null
  };
  currentAllocation = allocationBundle;
  renderAllocationTable(allocationBundle);
}

function setupControlHandlers() {
  ["hoodie", "shirt"].forEach((group) => {
    Object.keys(controlElements[group]).forEach((key) => {
      const { slider, input } = controlElements[group][key];
      if (slider) {
        slider.addEventListener("input", () => {
          const value = parseFloat(slider.value);
          if (!Number.isFinite(value)) return;
          setControlValue(group, key, value, { source: "slider" });
        });
        const initial = parseFloat(slider.value);
        if (Number.isFinite(initial)) {
          setControlValue(group, key, initial, { silent: true });
        }
      }
      if (input) {
        input.addEventListener("input", () => {
          const value = parseFloat(input.value);
          if (!Number.isFinite(value)) return;
          setControlValue(group, key, value, { source: "input", silent: true });
        });
        input.addEventListener("change", () => {
          const value = parseFloat(input.value);
          if (Number.isFinite(value)) {
            setControlValue(group, key, value, { source: "input" });
          }
        });
      }
    });
  });

  ["teams", "addon5APS", "addon10APS"].forEach((key) => {
    const control = controlElements.shared[key];
    if (!control) return;
    const { slider, input } = control;
    if (slider) {
      slider.addEventListener("input", () => {
        const value = parseFloat(slider.value);
        if (!Number.isFinite(value)) return;
        setControlValue("shared", key, value, { source: "slider" });
      });
      const initial = parseFloat(slider.value);
      if (Number.isFinite(initial)) {
        setControlValue("shared", key, initial, { silent: true });
      }
    }
    if (input) {
      input.addEventListener("input", () => {
        const value = parseFloat(input.value);
        if (!Number.isFinite(value)) return;
        setControlValue("shared", key, value, { source: "input", silent: true });
      });
      input.addEventListener("change", () => {
        const value = parseFloat(input.value);
        if (Number.isFinite(value)) {
          setControlValue("shared", key, value, { source: "input" });
        }
      });
    }
  });
}

function handleAllocationExport() {
  if (!currentAllocation) {
    return;
  }
  const csv = buildCsv(currentAllocation);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const timestamp = new Date().toISOString().slice(0, 10);
  link.download = `collide_allocation_${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function updateSyncFetchDisplay() {
  if (summaryDisplays.syncTimestamp) {
    summaryDisplays.syncTimestamp.textContent = formatTimestamp(eventState.syncTimestamp);
  }
  if (summaryDisplays.fetchTimestamp) {
    summaryDisplays.fetchTimestamp.textContent = formatTimestamp(eventState.fetchTimestamp);
  }
}

export function initProjection() {
  setupControlHandlers();

  setActiveProductTab("hoodie", { persist: false });

  const savedTab = safeReadStorage(APP_STORAGE_KEYS.activeTab);
  if (savedTab) {
    setActiveTab(savedTab, { persist: false });
  } else {
    setActiveTab("projection", { persist: false });
  }

  const savedArchetype = safeReadStorage(APP_STORAGE_KEYS.archetype);
  if (savedArchetype && ARCHETYPE_PRESETS[savedArchetype]) {
    applyArchetype(savedArchetype);
  } else {
    applyArchetype("youth-hockey");
  }

  if (allocationExportButton) {
    allocationExportButton.addEventListener("click", handleAllocationExport);
  }
}
