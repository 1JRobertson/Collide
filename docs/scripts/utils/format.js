export function formatValue(value, precision) {
  return Number(value).toFixed(precision);
}

export function formatNumber(value, { decimals = 2 } = {}) {
  if (!Number.isFinite(value)) {
    return (0).toFixed(decimals);
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

export function formatInteger(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Math.round(value).toLocaleString();
}

export function formatTimestamp(value) {
  if (!value) return "--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}
