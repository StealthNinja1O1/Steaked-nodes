/**
 * booru/api.js – Fetch helpers, provider metadata, transport switching
 * (proxy via ComfyUI server, or direct browser fetch), localStorage cache.
 */

import { DIRECT_CAPABLE, directTagInfo, directPosts } from "./direct.js";

const CACHE_DURATION = 24 * 60 * 60 * 1000;

/**
 * Transport setting: "proxy" (default, via ComfyUI server) or "direct"
 * (browser fetches the booru directly – only works for CORS-friendly
 * providers and only if the user's browser/IP isn't Cloudflare-blocked).
 */
export function getTransport() {
  return app.ui.settings.getSettingValue("Steaked.Booru.Transport");
}

export const CATEGORY_COLORS = {
  0: "#0073ff",
  1: "#f00",
  3: "#a0a",
  4: "#0a0",
  5: "#fc2",
};

export const CATEGORY_NAMES = {
  0: "General",
  1: "Artist",
  3: "Copyright",
  4: "Character",
  5: "Meta",
};

export const PROVIDER_LABELS = {
  danbooru: "Danbooru",
  safebooru: "Safebooru",
  gelbooru: "Gelbooru",
  yandere: "Yande.re",
  konachan: "Konachan",
  e621: "e621",
  rule34: "Rule34",
};

export function getProvider() {
  return app.ui.settings.getSettingValue("Steaked.Booru.Provider");
}

export async function fetchProviders() {
  const res = await fetch("/api/booru/providers");
  if (!res.ok) throw new Error(`providers: ${res.status}`);
  return res.json();
}

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    return { error: "Network error" };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (res.ok) return data;
  if (data && typeof data === "object") {
    return { ...data, error: data.error || `Error: ${res.status}` };
  }
  return { error: res.status === 404 ? "Tag not found" : `Error: ${res.status}` };
}

export function fetchTagInfo(provider, tag) {
  return fetchJson(`/api/booru/${provider}/tag/${encodeURIComponent(tag)}`);
}

export function fetchWiki(provider, tag) {
  return fetchJson(`/api/booru/${provider}/wiki/${encodeURIComponent(tag)}`);
}

export function fetchPosts(provider, tag, { limit = 20, page = 1, random = false } = {}) {
  const q = new URLSearchParams({ limit, page, random });
  return fetchJson(`/api/booru/${provider}/posts/${encodeURIComponent(tag)}?${q}`);
}

// ── localStorage cache ────────────────────────────────────────────────────────

function cacheKey(provider, tag) {
  return `booru_tag_${provider}_${tag}`;
}

export function getCachedTag(provider, tag) {
  try {
    const raw = localStorage.getItem(cacheKey(provider, tag));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.timestamp && Date.now() - data.timestamp < CACHE_DURATION) return data.content;
    localStorage.removeItem(cacheKey(provider, tag));
  } catch {
    /* corrupt entry, ignore */
  }
  return null;
}

export function setCachedTag(provider, tag, data) {
  try {
    localStorage.setItem(
      cacheKey(provider, tag),
      JSON.stringify({ timestamp: Date.now(), content: data }),
    );
  } catch {
    /* quota exceeded, ignore */
  }
}

export async function loadTagInfo(provider, tag) {
  let info = getCachedTag(provider, tag);
  if (info) return info;

  if (getTransport() === "direct" && DIRECT_CAPABLE[provider]) {
    try {
      info = await directTagInfo(provider, tag);
      if (!info.error) {
        setCachedTag(provider, tag, info);
        return { ...info, via: "direct" };
      }
    } catch {
      // direct blocked (Cloudflare/CORS/offline) – fall through to proxy
    }
  }

  info = await fetchTagInfo(provider, tag);
  if (info && !info.error) {
    setCachedTag(provider, tag, info);
    return info;
  }
  // Only fall back to danbooru when the tag genuinely doesn't exist on the
  // selected provider. Auth/rate/network errors must surface as-is.
  if (provider !== "danbooru" && /not found/i.test(info?.error || "")) {
    let fallback = getCachedTag("danbooru", tag);
    if (!fallback) {
      fallback = await fetchTagInfo("danbooru", tag);
      if (fallback && !fallback.error) setCachedTag("danbooru", tag, fallback);
    }
    if (fallback && !fallback.error) {
      const merged = { ...fallback, wiki: fallback.wiki || info.wiki, fromProvider: "danbooru" };
      if (merged.tag || merged.wiki || merged.posts) return merged;
    }
  }
  return info;
}

export async function loadPosts(provider, tag, opts = {}) {
  if (getTransport() === "direct" && DIRECT_CAPABLE[provider]) {
    try {
      const posts = await directPosts(provider, tag, opts);
      if (posts.length || opts.page === 1) return { posts, via: "direct" };
    } catch {
      // fall through to proxy
    }
  }
  return fetchPosts(provider, tag, opts);
}

// ── misc helpers ──────────────────────────────────────────────────────────────

export function parseTag(text) {
  if (!text) return null;
  let tag = text.trim();
  if (tag.includes(",")) return null;
  tag = tag.replace(/\s+/g, "_");
  tag = tag.replace(/[^a-zA-Z0-9_\-.:()]/g, "");
  tag = tag.toLowerCase();
  if (tag.length < 2 || tag.length > 100) return null;
  return tag;
}

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}
