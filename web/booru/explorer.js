/**
 * booru/explorer.js – Full-screen booru browser: search tags, infinite scroll
 * post grid, image lightbox. Opened from the detail modal or the topbar button.
 */

import { escapeHtml, getProvider, loadPosts, PROVIDER_LABELS } from "./api.js";

const RATINGS = { g: "general", s: "sensitive", q: "questionable", e: "explicit" };

export function showLightbox(post) {
  const existing = document.querySelector(".booru-lightbox");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.className = "booru-lightbox";
  el.innerHTML = `
    <img src="${escapeHtml(post.sample_url || post.file_url || post.preview_url)}" alt="post ${post.id}" />
    <div class="booru-lightbox-info">
      <span>#${escapeHtml(String(post.id))}</span>
      <span>${post.width}×${post.height}</span>
      ${post.score != null ? `<span>score ${escapeHtml(String(post.score))}</span>` : ""}
      <a href="${escapeHtml(post.post_url)}" target="_blank" rel="noopener">open on site ↗</a>
    </div>
  `;
  el.addEventListener("click", (e) => {
    if (e.target === el || e.target.tagName === "IMG") el.remove();
  });
  document.body.appendChild(el);
}

export class BooruExplorer {
  constructor() {
    this.el = null;
    this.state = { provider: "danbooru", tag: "", page: 1, posts: [], done: false, loading: false };
    this.onTagPicked = null;
  }

  open(tag = "", provider = null) {
    this.close();
    this.state = {
      provider: provider || getProvider(),
      tag: tag || "",
      page: 1,
      posts: [],
      done: false,
      loading: false,
    };
    this.render();
    if (tag) this.search(tag);
  }

  close() {
    this.el?.remove();
    this.el = null;
  }

  render() {
    const overlay = document.createElement("div");
    overlay.className = "booru-overlay";
    overlay.innerHTML = `
      <div class="booru-overlay-inner booru-panel booru-explorer">
        <div class="booru-explorer-topbar">
          <strong style="font-size:14px; color:#fff;">Booru Explorer</strong>
          <input class="booru-explorer-search" type="text" placeholder="Search tags… (space separated)"
                 value="${escapeHtml(this.state.tag.replace(/_/g, " "))}" />
          <select class="booru-select booru-provider-select">
            ${Object.entries(PROVIDER_LABELS)
              .map(([id, label]) => `<option value="${id}" ${id === this.state.provider ? "selected" : ""}>${label}</option>`)
              .join("")}
          </select>
          <button class="booru-icon-btn booru-close" title="Close">✕</button>
        </div>
        <div class="booru-explorer-body">
          <div class="booru-grid"></div>
          <div class="booru-sentinel"></div>
        </div>
      </div>
    `;
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) this.close();
    });
    document.body.appendChild(overlay);
    this.el = overlay;

    const search = overlay.querySelector(".booru-explorer-search");
    const body = overlay.querySelector(".booru-explorer-body");
    const grid = overlay.querySelector(".booru-grid");

    const doSearch = () => {
      const tags = search.value.trim().replace(/\s+/g, "_");
      if (!tags) return;
      this.state.tag = tags;
      this.state.page = 1;
      this.state.posts = [];
      this.state.done = false;
      grid.innerHTML = "";
      this.loadPage();
    };
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch();
      e.stopPropagation();
    });
    overlay.querySelector(".booru-provider-select").addEventListener("change", (e) => {
      this.state.provider = e.target.value;
      if (this.state.tag) doSearch();
    });
    overlay.querySelector(".booru-close").addEventListener("click", () => this.close());

    // click post -> lightbox; shift-click -> send tag back to the detail view
    grid.addEventListener("click", (e) => {
      const item = e.target.closest(".booru-grid-item");
      if (!item) return;
      const post = this.state.posts[+item.dataset.index];
      if (!post) return;
      if (e.shiftKey && this.onTagPicked) {
        this.onTagPicked(post.tags[0]);
      } else {
        showLightbox(post);
      }
    });

    const sentinel = overlay.querySelector(".booru-sentinel");
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !this.state.loading && !this.state.done && this.state.tag) {
        this.loadPage();
      }
    });
    observer.observe(sentinel);
    this._observer = observer;

    search.focus();
  }

  async loadPage() {
    if (this.state.loading) return;
    this.state.loading = true;
    const grid = this.el?.querySelector(".booru-grid");
    const body = this.el?.querySelector(".booru-explorer-body");
    if (!grid || !body) return;

    let loadingEl = body.querySelector(".booru-load-more");
    if (!loadingEl) {
      loadingEl = document.createElement("div");
      loadingEl.className = "booru-load-more";
      body.appendChild(loadingEl);
    }
    loadingEl.textContent = "Loading…";

    const data = await loadPosts(this.state.provider, this.state.tag, {
      limit: 40,
      page: this.state.page,
    });
    this.state.loading = false;

    if (!this.el) return;
    if (data.error) {
      loadingEl.textContent = data.error;
      return;
    }
    const posts = data.posts || [];
    if (!posts.length && this.state.page === 1) {
      loadingEl.textContent = "";
      grid.innerHTML = `<div class="booru-explorer-empty">No posts found for "${escapeHtml(this.state.tag)}"</div>`;
      this.state.done = true;
      return;
    }
    this.state.posts.push(...posts);
    this.state.page += 1;

    const start = this.state.posts.length - posts.length;
    const frag = document.createDocumentFragment();
    posts.forEach((post, i) => frag.appendChild(this.renderItem(post, start + i)));
    grid.appendChild(frag);

    loadingEl.textContent = "Load more";
    loadingEl.onclick = () => this.loadPage();
    if (!posts.length) {
      loadingEl.textContent = "No more posts";
      this.state.done = true;
    }
  }

  renderItem(post, index) {
    const item = document.createElement("div");
    item.className = "booru-grid-item";
    item.dataset.index = index;
    const rating = RATINGS[post.rating] || post.rating || "";
    item.innerHTML = `
      ${post.preview_url ? `<img src="${escapeHtml(post.preview_url)}" loading="lazy" alt="post ${post.id}" />` : `<span style="color:#555;">no image</span>`}
      ${rating ? `<span class="booru-grid-rating booru-rating-${rating}">${rating[0]}</span>` : ""}
      <div class="booru-grid-meta">
        <span>#${escapeHtml(String(post.id))}</span>
        ${post.score != null ? `<span>▲ ${escapeHtml(String(post.score))}</span>` : ""}
      </div>
    `;
    return item;
  }
}

let explorerInstance = null;
export function openExplorer(tag, provider) {
  if (!explorerInstance) explorerInstance = new BooruExplorer();
  explorerInstance.open(tag, provider);
  return explorerInstance;
}
