export function normalizeBaseUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete("action");
    parsed.searchParams.delete("secret");
    const base = parsed.origin + parsed.pathname;
    const search = parsed.searchParams.toString();
    return search ? `${base}?${search}` : base;
  } catch {
    return rawUrl;
  }
}

export function buildActionUrl(rawUrl, action, secret) {
  try {
    const parsed = new URL(rawUrl);
    if (action) {
      parsed.searchParams.set("action", action);
    } else {
      parsed.searchParams.delete("action");
    }
    if (secret) {
      parsed.searchParams.set("secret", secret);
    } else {
      parsed.searchParams.delete("secret");
    }
    return parsed.toString();
  } catch {
    const separator = rawUrl.includes("?") ? "&" : "?";
    const params = [];
    if (action) params.push(`action=${encodeURIComponent(action)}`);
    if (secret) params.push(`secret=${encodeURIComponent(secret)}`);
    if (params.length === 0) {
      return rawUrl;
    }
    return `${rawUrl}${separator}${params.join("&")}`;
  }
}
