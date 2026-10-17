/**
 * booru/direct.js – Direct browser → booru transport, bypassing the ComfyUI
 * server. Only providers with permissive CORS can be fetched this way
 * (danbooru, e621); everything else must use the proxy. Any failure here
 * should fall back to the proxy at the call site.
 */

const DANBOORU = "https://danbooru.donmai.us";
const E621 = "https://e621.net";

export const DIRECT_CAPABLE = { danbooru: true, e621: true };

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// fetch, but never reject: a failed sub-request just yields no data
async function settle(promise, fallback) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

function danbooruPost(p) {
  return {
    id: p.id,
    preview_url: p.preview_file_url,
    sample_url: p.large_file_url || p.file_url,
    file_url: p.file_url,
    width: p.image_width,
    height: p.image_height,
    tags: (p.tag_string || "").split(" ").filter(Boolean),
    rating: p.rating,
    score: p.score,
    source: p.source,
    post_url: `${DANBOORU}/posts/${p.id}`,
  };
}

function e621Post(p) {
  return {
    id: p.id,
    preview_url: p.preview?.url,
    sample_url: p.sample?.url || p.file?.url,
    file_url: p.file?.url,
    width: p.file?.width,
    height: p.file?.height,
    tags: Object.values(p.tags || {}).flat(),
    rating: p.rating,
    score: p.score?.total,
    source: (p.sources || [])[0],
    post_url: `${E621}/posts/${p.id}`,
  };
}

export async function directTagInfo(provider, tag) {
  const base = provider === "e621" ? E621 : DANBOORU;
  const nameParam = provider === "e621" ? "search[name]" : "search[name_matches]";

  const [tags, wiki, posts] = await Promise.all([
    settle(json(`${base}/tags.json?${nameParam}=${encodeURIComponent(tag)}&limit=1`), []),
    settle(json(`${base}/wiki_pages.json?search[title]=${encodeURIComponent(tag)}`), []),
    settle(directPosts(provider, tag, { limit: 1, random: true }), []),
  ]);

  const t = Array.isArray(tags) && tags[0]
    ? {
        name: tags[0].name,
        post_count: tags[0].post_count || 0,
        category: tags[0].category || 0,
        is_deprecated: !!tags[0].is_deprecated,
      }
    : null;
  const w = Array.isArray(wiki) && wiki[0]?.body
    ? { title: wiki[0].title || tag, body: wiki[0].body }
    : null;

  return {
    tag: t,
    wiki: w,
    posts: posts[0] || null,
    error: t || posts.length ? null : "Tag not found",
  };
}

export async function directWiki(provider, tag) {
  const base = provider === "e621" ? E621 : DANBOORU;
  const data = await json(`${base}/wiki_pages.json?search[title]=${encodeURIComponent(tag)}`);
  if (!Array.isArray(data) || !data[0]?.body) return { title: tag, body: null };
  return { title: data[0].title || tag, body: data[0].body };
}

export async function directPosts(provider, tag, { limit = 20, page = 1, random = false } = {}) {
  if (provider === "e621") {
    const q = new URLSearchParams({ tags: random ? `order:random ${tag}` : tag, limit, page });
    const data = await json(`${E621}/posts.json?${q}`);
    return (data.posts || []).map(e621Post);
  }
  const q = new URLSearchParams({ tags: tag, limit, page });
  if (random) q.set("random", "true");
  const data = await json(`${DANBOORU}/posts.json?${q}`);
  return (Array.isArray(data) ? data : []).map(danbooruPost);
}
