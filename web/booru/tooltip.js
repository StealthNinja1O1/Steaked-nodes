/**
 * booru/tooltip.js – Compact tag tooltip on text selection.
 * Lean by design: meta, thumbnail, excerpt, related tags. Everything deeper
 * lives in the detail modal / explorer.
 */

import { app } from "../../../scripts/app.js";
import {
  escapeHtml,
  loadTagInfo,
  parseTag,
  getProvider,
  CATEGORY_COLORS,
  CATEGORY_NAMES,
  PROVIDER_LABELS,
} from "./api.js";
import { dtextExcerpt, dtextRelatedTags } from "./dtext.js";
import { openDetail } from "./detail.js";

const DEBOUNCE_DELAY = 300;
const TOOLTIP_OFFSET = 15;

export class BooruTooltip {
  constructor(providersMeta = {}) {
    this.el = null;
    this.debounceTimer = null;
    this.currentTag = null;
    this.lastMousePos = { x: 0, y: 0 };
    this.providersMeta = providersMeta;
  }

  isEnabled() {
    return app.ui.settings.getSettingValue("Steaked.Booru.TooltipEnabled");
  }

  onTextSelection(e) {
    this.lastMousePos = { x: e.clientX, y: e.clientY };
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.handleSelection(), DEBOUNCE_DELAY);
  }

  async handleSelection() {
    if (!this.isEnabled()) {
      this.hide();
      return;
    }
    const selection = window.getSelection();
    const selectedText = selection?.toString();
    if (!selectedText) {
      this.hide();
      return;
    }
    const tag = parseTag(selectedText);
    if (!tag) {
      this.hide();
      return;
    }
    if (this.currentTag === tag && this.el) return;

    this.currentTag = tag;
    const provider = getProvider();
    this.showLoading(tag, provider);

    const info = await loadTagInfo(provider, tag);
    if (this.currentTag !== tag) return;  // superseded by a newer selection
    if (info) this.show(info, tag, provider);
  }

  showLoading(tag, provider) {
    this.removeEl();
    const el = document.createElement("div");
    el.className = "booru-tooltip";
    el.innerHTML = `
      <div class="booru-tooltip-header">
        <span class="booru-tag-name">${escapeHtml(tag)}</span>
        <span class="booru-provider-chip">${escapeHtml(PROVIDER_LABELS[provider] || provider)}</span>
      </div>
      <div class="booru-tooltip-body">
        <div class="booru-loading"><span class="booru-spinner">⟳</span> Loading…</div>
      </div>
    `;
    this.position(el);
    this.el = el;
  }

  show(info, tag, provider) {
    this.removeEl();
    // Only a hard error when there's nothing renderable at all
    if (info.error && !info.tag && !info.wiki && !info.posts) {
      this.showError(tag, provider, info.error);
      return;
    }

    const tagData = info.tag;
    const wiki = info.wiki;
    const post = info.posts;
    const cat = tagData?.category ?? 0;
    const color = CATEGORY_COLORS[cat] || "#888";
    const showImages = app.ui.settings.getSettingValue("Steaked.Booru.ShowImages");

    const el = document.createElement("div");
    el.className = "booru-tooltip";
    el.innerHTML = this.buildContent(
      tagData, wiki, post, tag, color, cat, provider, showImages, info.fromProvider, info.via,
    );
    this.position(el);
    this.el = el;

    el.querySelectorAll(".booru-related-tag, .booru-wikilink").forEach((linkEl) => {
      linkEl.addEventListener("click", async (e) => {
        e.preventDefault();
        const related = linkEl.dataset.tag;
        if (!related) return;
        this.currentTag = related;
        this.showLoading(related, provider);
        const relatedInfo = await loadTagInfo(provider, related);
        if (this.currentTag !== related) return;
        if (relatedInfo) this.show(relatedInfo, related, provider);
      });
    });
    el.querySelector(".booru-open-detail")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hide();
      openDetail(tag, provider, this.providersMeta);
    });
  }

  buildContent(tagData, wiki, post, tag, color, cat, provider, showImages, fromProvider, via) {
    const shownProvider = fromProvider || provider;
    let html = `
      <div class="booru-tooltip-header">
        <div class="booru-tag-info">
          <span class="booru-tag-name" style="color:${color};">${escapeHtml(tagData?.name || tag)}</span>
          <span class="booru-tag-category" style="background:${color};">${CATEGORY_NAMES[cat] || "Unknown"}</span>
        </div>
        <div class="booru-tooltip-actions">
          <button class="booru-icon-btn booru-open-detail" title="Open details">Details</button>
        </div>
      </div>
      <div class="booru-tooltip-body">
    `;

    if (tagData) {
      const label = PROVIDER_LABELS[shownProvider] || shownProvider;
      const note = fromProvider && fromProvider !== provider ? " (fallback)" : "";
      const viaNote = via === "direct" ? " · direct" : "";
      html += `<div class="booru-post-count">${(tagData.post_count || 0).toLocaleString()} posts on ${escapeHtml(label)}${note}${viaNote}</div>`;
    }

    if (showImages && post?.preview_url) {
      html += `
        <div class="booru-thumbnail">
          <img src="${escapeHtml(post.preview_url)}" alt="Example" loading="lazy" />
        </div>
      `;
    }

    const excerpt = wiki?.body ? dtextExcerpt(wiki.body) : "";
    if (excerpt) html += `<div class="booru-wiki-excerpt">${escapeHtml(excerpt)}</div>`;

    const related = dtextRelatedTags(wiki?.body);
    if (related.length) {
      html += `
        <div class="booru-related-tags"><strong>Related:</strong>
          ${related
            .map(
              (t) =>
                `<a href="#" class="booru-related-tag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</a>`,
            )
            .join(", ")}
        </div>
      `;
    }

    html += `</div>`;
    return html;
  }

  showError(tag, provider, errorMsg) {
    this.removeEl();
    const el = document.createElement("div");
    el.className = "booru-tooltip";
    el.innerHTML = `
      <div class="booru-tooltip-header">
        <span class="booru-tag-name">${escapeHtml(tag)}</span>
        <span class="booru-provider-chip">${escapeHtml(PROVIDER_LABELS[provider] || provider)}</span>
      </div>
      <div class="booru-tooltip-body">
        <div class="booru-error">⚠ ${escapeHtml(errorMsg)}</div>
      </div>
    `;
    this.position(el);
    this.el = el;
  }

  position(el) {
    const { x, y } = this.lastMousePos;
    el.style.cssText = "position:fixed; left:-9999px; top:-9999px; opacity:0;";
    document.body.appendChild(el);

    const rect = el.getBoundingClientRect();
    let left = x + TOOLTIP_OFFSET;
    let top = y + TOOLTIP_OFFSET;
    if (left + rect.width > window.innerWidth - 10) left = x - rect.width - TOOLTIP_OFFSET;
    if (left < 10) left = 10;
    if (top + rect.height > window.innerHeight - 10) top = y - rect.height - TOOLTIP_OFFSET;
    if (top < 10) top = 10;
    el.style.cssText = `position:fixed; left:${left}px; top:${top}px; opacity:1;`;
  }

  removeEl() {
    this.el?.remove();
    this.el = null;
  }

  hide() {
    this.removeEl();
    this.currentTag = null;
  }
}
