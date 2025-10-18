export const SIZES = ["4XL", "3XL", "2XL", "XL", "L", "M", "S", "YXL", "YL", "YM"];

export const BLACK_ONLY_SIZE_INDICES = new Set([0, 1, 2]);

export const PRODUCTS = {
  hoodie: {
    key: "hoodie",
    label: "Classic Hoodie",
    prefix: "hoodie",
    chartId: "hoodie-curve-chart",
    legendId: "hoodie-legend",
    colorConfig: {
      baseColors: ["Black"],
      extrasMax: 3,
      entryId: "hoodie-color-entry",
      addButtonId: "hoodie-add-color",
      listId: "hoodie-color-list",
      noteId: "hoodie-color-note",
      noteDefault: "Black accounts for 50% by default.",
      noteMax: "Maximum of three additional colors reached."
    }
  },
  shirt: {
    key: "shirt",
    label: "Classic Shirt",
    prefix: "shirt",
    chartId: "shirt-curve-chart",
    legendId: "shirt-legend",
    colorConfig: {
      baseColors: [],
      extrasMax: 12,
      entryId: "shirt-color-entry",
      addButtonId: "shirt-add-color",
      listId: "shirt-color-list",
      noteId: "shirt-color-note",
      noteDefault: "Add colors to split the total evenly.",
      noteMax: "Maximum color list reached."
    }
  }
};

export const ARCHETYPE_PRESETS = {
  "youth-hockey": {
    label: "Youth Hockey",
    hoodie: { mean: 6.24, sigma: 1.53, skew: -0.8, spt: 3 },
    shirt: { mean: 7.66, sigma: 2.25, skew: -0.87, spt: 1 },
    shared: { addon5APS: 1.75, addon10APS: 0.5 }
  }
};

export const APP_STORAGE_KEYS = {
  activeTab: "collide:activeTab",
  urlLocked: "collide:eventUrlLocked",
  archetype: "collide:archetype",
  productTab: "collide:productTab"
};

export const CONTROL_CONFIG = {
  hoodie: {
    mean: { precision: 2, span: 9, absoluteMin: 0, absoluteMax: 9 },
    sigma: { precision: 2, span: 5, absoluteMin: 0.05, absoluteMax: 5 },
    skew: { precision: 2, span: 10, absoluteMin: -5, absoluteMax: 5 },
    spt: { precision: 2, span: 8, absoluteMin: 0, absoluteMax: 8 }
  },
  shirt: {
    mean: { precision: 2, span: 9, absoluteMin: 0, absoluteMax: 9 },
    sigma: { precision: 2, span: 5, absoluteMin: 0.05, absoluteMax: 5 },
    skew: { precision: 2, span: 10, absoluteMin: -5, absoluteMax: 5 },
    spt: { precision: 2, span: 8, absoluteMin: 0, absoluteMax: 8 }
  },
  shared: {
    teams: { precision: 0, span: 250, absoluteMin: 0, absoluteMax: 250 },
    addon5APS: { precision: 2, absoluteMin: 0, absoluteMax: 5 },
    addon10APS: { precision: 2, absoluteMin: 0, absoluteMax: 2 }
  }
};

export const EVENT_STORAGE_KEYS = {
  source: "collide:eventSource",
  eventId: "collide:eventId",
  secret: "collide:eventSecret"
};

export const EVENT_FIELD_HINTS = {
  eventName: ["event", "event name", "event_title", "event label", "category"],
  eventKey: ["event id", "event identifier", "event key", "event code", "event", "category"],
  category: ["event category", "archetype", "event type", "series"],
  product: ["item", "item name", "product", "product name", "line item"],
  variation: ["variation", "variation name", "option", "option name", "sku", "price point name"],
  size: ["size", "size name", "size label", "size option", "modifiers applied"],
  quantity: ["quantity", "qty", "units", "count"],
  timestamp: ["timestamp", "sale timestamp", "created at", "sale time", "transaction time"],
  date: ["date"],
  time: ["time"],
  timeZone: ["time zone", "timezone"],
  venue: ["venue", "location", "rink", "city"]
};

export const PRODUCT_KEYWORDS = {
  hoodie: ["classic hoodie"],
  shirt: ["classic shirt"],
  addon5: ["add on $5", "add-on $5", "add-on 5", "add-ons $5", "addon $5", "addon 5"],
  addon10: ["add on $10", "add-on $10", "add-on 10", "add-ons $10", "addon $10", "addon 10"]
};

export const SIZE_ALIASES = {
  "extra large": "XL",
  "adult extra large": "XL",
  xl: "XL",
  large: "L",
  "adult large": "L",
  medium: "M",
  "adult medium": "M",
  small: "S",
  "adult small": "S",
  "youth extra large": "YXL",
  yxl: "YXL",
  "youth large": "YL",
  yl: "YL",
  "youth medium": "YM",
  ym: "YM"
};

export const SIZE_SYNONYMS = {
  "4xl": "4XL",
  "xxxxl": "4XL",
  "3xl": "3XL",
  "xxxl": "3XL",
  "2xl": "2XL",
  "xxl": "2XL",
  xl: "XL",
  "extra large": "XL",
  "adult extra large": "XL",
  "adult xl": "XL",
  "adult x-large": "XL",
  l: "L",
  large: "L",
  "adult l": "L",
  "adult large": "L",
  "1/4 zip xl": "XL",
  m: "M",
  medium: "M",
  "adult m": "M",
  "adult medium": "M",
  s: "S",
  small: "S",
  "adult s": "S",
  "adult small": "S",
  yxl: "YXL",
  youthxl: "YXL",
  "youth xl": "YXL",
  "youth extra large": "YXL",
  yl: "YL",
  youthl: "YL",
  "youth l": "YL",
  "youth large": "YL",
  ym: "YM",
  youthm: "YM",
  "youth m": "YM",
  "youth medium": "YM"
};
