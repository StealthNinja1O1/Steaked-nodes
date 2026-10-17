/**
 * booru/detail.js – Rich tag detail modal with per-provider tabs.
 * Tab = provider; each tab shows tag meta, full rendered wiki, post strip.
 */

import {
  escapeHtml,
  loadPosts,
  loadTagInfo,
  PROVIDER_LABELS,
  CATEGORY_COLORS,
  CATEGORY_NAMES,
} from "./api.js";
import { renderDText } from "./dtext.js";
import { openExplorer, showLightbox } from "./explorer.js";

export class BooruDetailModal {
  constructor() {
    this.el = null;
    this.state = { tag: "", provider: "", providers: {}, tabs: {} };
  }

  open(tag, provider, providersMeta = {}) {
    this.close();
    this.state = { tag, provider, providers: providersMeta, tabs: {} };
    this.render();
    this.activateTab(provider);
  }

  close() {
    this.el?.remove();
    this.el = null;
    this._keyHandler && document.removeEventListener("keydown", this._keyHandler);
  }

  render() {
    const overlay = document.createElement("div");
    overlay.className = "booru-overlay";
    overlay.innerHTML = `
      <div class="booru-overlay-inner booru-panel booru-detail">
        <div class="booru-detail-topbar">
          <span class="booru-tag-name">${escapeHtml(this.state.tag)}</span>
          <div class="booru-detail-tabs"></div>
          <button class="booru-icon-btn booru-detail-explore" title="Open in explorer">Explore</button>
          <button class="booru-icon-btn booru-detail-close" title="Close">✕</button>
        </div>
        <div class="booru-detail-content"></div>
      </div>
    `;
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) this.close();
    });
    document.body.appendChild(overlay);
    this.el = overlay;

    overlay.querySelector(".booru-detail-close").addEventListener("click", () => this.close());
    overlay.querySelector(".booru-detail-explore").addEventListener("click", () => {
      openExplorer(this.state.tag, this.state.provider);
    });

    this._keyHandler = (e) => {
      if (e.key === "Escape") this.close();
    };
    document.addEventListener("keydown", this._keyHandler);
  }

  buildTabs() {
    const container = this.el.querySelector(".booru-detail-tabs");
    container.innerHTML = Object.keys(PROVIDER_LABELS)
      .map(
        (id) => `
        <button class="booru-tab ${id === this.state.provider ? "active" : ""}" data-provider="${id}">
          ${PROVIDER_LABELS[id]}
          <span class="booru-tab-count" data-count-for="${id}"></span>
        </button>`,
      )
      .join("");
    container.querySelectorAll(".booru-tab").forEach((btn) => {
      btn.addEventListener("click", () => this.activateTab(btn.dataset.provider));
    });
  }

  async activateTab(provider) {
    if (!this.el) return;
    this.state.provider = provider;
    this.el.querySelectorAll(".booru-tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.provider === provider);
    });
    if (!Object.keys(this.state.tabs).length) this.buildTabs();

    const content = this.el.querySelector(".booru-detail-content");
    if (this.state.tabs[provider]?.data) {
      this.renderTab(this.state.tabs[provider].data, provider);
      return;
    }

    content.innerHTML = `<div class="booru-loading"><span class="booru-spinner">⟳</span> Loading ${escapeHtml(PROVIDER_LABELS[provider] || provider)}…</div>`;
    const data = await this.loadTab(provider);
    if (!this.el) return;
    this.state.tabs[provider] = { data };
    if (this.state.provider === provider) this.renderTab(data, provider);
  }

  async loadTab(provider) {
    const [tagInfo, posts] = await Promise.all([
      loadTagInfo(provider, this.state.tag),
      loadPosts(provider, this.state.tag, { limit: 12, page: 1, random: true }),
    ]);
    return { tagInfo, posts: posts.posts || [] };
  }

  extractOtherNames(body) {
    if (!body) return [];
    const m = body.match(/h[1-6]\.\s*Other [Nn]ames\s*\n+([\s\S]*?)(?=\n\nh[1-6.]|$)/);
    if (!m) return [];
    return m[1]
        .split(/[\n,]+/)
        .map((n) => n.replace(/^[\s*-]+/, "").trim())
        .filter(Boolean)
        .slice(0, 12);
  }

  providerTagUrl(provider, tag) {
    const t = encodeURIComponent(tag);
    switch (provider) {
      case "danbooru": return `https://danbooru.donmai.us/posts?tags=${t}`;
      case "safebooru": return `https://safebooru.org/index.php?page=post&s=list&tags=${t}`;
      case "gelbooru": return `https://gelbooru.com/index.php?page=post&s=list&tags=${t}`;
      case "yandere": return `https://yande.re/post?tags=${t}`;
      case "konachan": return `https://konachan.com/post?tags=${t}`;
      case "e621": return `https://e621.net/posts?tags=${t}`;
      case "rule34": return `https://rule34.xxx/index.php?page=post&s=list&tags=${t}`;
      default: return "#";
    }
  }

  renderTab({ tagInfo, posts }, provider) {
    const content = this.el.querySelector(".booru-detail-content");
    const tagData = tagInfo?.tag;
    const wiki = tagInfo?.wiki;
    const cat = tagData?.category ?? 0;
    const color = CATEGORY_COLORS[cat] || "#888";
    const providerLabel = PROVIDER_LABELS[provider] || provider;
    const otherNames = this.extractOtherNames(wiki?.body);
    const siteUrl = this.providerTagUrl(provider, this.state.tag);

    const countEl = this.el.querySelector(`[data-count-for="${provider}"]`);
    if (countEl) {
      countEl.textContent = tagData ? `${(tagData.post_count || 0).toLocaleString()}` : "";
    }

    // Hard provider error (auth required, blocked, rate limit) and nothing to show
    if (tagInfo?.error && !tagData && !wiki && !posts.length) {
      content.innerHTML = `
        <div class="booru-tab-error">
          <div class="booru-tab-error-title">${escapeHtml(providerLabel)}</div>
          <div class="booru-error">${escapeHtml(tagInfo.error)}</div>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="booru-detail-grid">
        <div>
          ${posts.length ? `<div class="booru-posts-strip-label">Example posts</div>` : ""}
          <div class="booru-posts-strip">
            ${posts
              .map(
                (p) =>
                  `<img src="${escapeHtml(p.preview_url || "")}" data-id="${p.id}" loading="lazy"
                        title="${escapeHtml((p.tags || []).slice(0, 6).join(", "))}" alt="post ${p.id}" />`,
              )
              .join("")}
          </div>
          <div class="booru-wiki-full" style="margin-top:16px;">
            ${wiki?.body ? renderDText(wiki.body) : `<p class="booru-no-wiki">No wiki entry on ${escapeHtml(providerLabel)}.</p>`}
          </div>
        </div>
        <div class="booru-detail-sidebar">
          <div class="booru-sidebar-box">
            <h4>Tag</h4>
            <span class="booru-tag-name" style="color:${color};">${escapeHtml(tagData?.name || this.state.tag)}</span>
            <div style="margin-top:6px;">
              <span class="booru-tag-category" style="background:${color};">${CATEGORY_NAMES[cat] || "Unknown"}</span>
              ${tagData ? `<span class="booru-post-count">${(tagData.post_count || 0).toLocaleString()} posts</span>` : ""}
            </div>
            ${tagData?.is_deprecated ? `<div style="color:#f88; margin-top:6px; font-size:11px;">⚠ Deprecated tag</div>` : ""}
            ${!tagData && tagInfo?.error ? `<div class="booru-error" style="margin-top:6px;">${escapeHtml(tagInfo.error)}</div>` : ""}
          </div>
          ${otherNames ? `
          <div class="booru-sidebar-box">
            <h4>Other names</h4>
            ${otherNames.map((n) => `<span class="booru-alias">${escapeHtml(n)}</span>`).join("")}
          </div>` : ""}
          <div class="booru-sidebar-box">
            <h4>Source</h4>
            <a href="${escapeHtml(siteUrl)}" class="booru-open-site" target="_blank" rel="noopener">
              View on ${escapeHtml(providerLabel)} ↗
            </a>
          </div>
          <div class="booru-sidebar-box">
            <h4>Actions</h4>
            <button class="booru-icon-btn booru-copy" style="width:100%; margin-bottom:6px;">Copy tag</button>
            <button class="booru-icon-btn booru-refresh" style="width:100%;">Refresh examples</button>
          </div>
        </div>
      </div>
    `;

    content.querySelectorAll(".booru-posts-strip img").forEach((img) => {
      img.addEventListener("click", () => {
        const post = posts.find((p) => String(p.id) === img.dataset.id);
        if (post) showLightbox(post);
      });
    });
    content.querySelector(".booru-copy")?.addEventListener("click", async (e) => {
      try {
        await navigator.clipboard.writeText(this.state.tag);
        e.target.textContent = "Copied!";
        setTimeout(() => (e.target.textContent = "Copy tag"), 1200);
      } catch {
        /* clipboard denied */
      }
    });
    content.querySelector(".booru-refresh")?.addEventListener("click", () => {
      delete this.state.tabs[provider];
      this.activateTab(provider);
    });

    // wiki links navigate the modal
    content.querySelectorAll(".booru-wikilink").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.open(link.dataset.tag, this.state.provider, this.state.providers);
      });
    });
  }
}

let modalInstance = null;
export function openDetail(tag, provider, providersMeta) {
  if (!modalInstance) modalInstance = new BooruDetailModal();
  modalInstance.open(tag, provider, providersMeta);
  return modalInstance;
}
