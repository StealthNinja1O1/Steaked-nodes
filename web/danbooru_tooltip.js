import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

/**
 * Danbooru Tag Tooltip Extension
 * Shows tag information from Danbooru when text is selected
 */

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const DEBOUNCE_DELAY = 300; // ms
const TOOLTIP_OFFSET = 15;

const CATEGORY_COLORS = {
  0: "#0073ff", // General
  1: "#f00", // Artist
  3: "#a0a", // Copyright
  4: "#0a0", // Character
  5: "#fc2", // Meta
};

const CATEGORY_NAMES = {
  0: "General",
  1: "Artist",
  3: "Copyright",
  4: "Character",
  5: "Meta",
};

class DanbooruTooltip {
  constructor() {
    this.tooltipElement = null;
    this.debounceTimer = null;
    this.currentTag = null;
    this.isLoading = false;
    this.lastMousePos = { x: 0, y: 0 };
  }

  /**
   * Check if tooltip feature is enabled in settings
   */
  isEnabled() {
    const setting = app.ui.settings.getSettingValue("Steaked.DanbooruTagTooltip.Enabled", true);
    console.log("Danbooru Tooltip enabled:", setting);
    return setting;
  }

  isTextWidget(element) {
    if (!element) return false;

    const tagName = element.tagName?.toLowerCase();
    console.log("[Danbooru] Checking element tagName:", tagName, "element:", element);

    if (tagName === "textarea" || tagName === "input") return true;

    // Check for ComfyUI multiline inputs
    if (element.closest && element.closest(".comfy-multiline-input")) return true;
    if (element.classList?.contains("comfy-multiline-input")) return true;

    let parent = element.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      const parentTag = parent.tagName?.toLowerCase();
      if (parentTag === "textarea" || parentTag === "input") return true;
      parent = parent.parentElement;
    }

    console.log("[Danbooru] Allowing selection for debugging purposes");
    return true;
  }

  parseTag(text) {
    if (!text) return null;

    let tag = text.trim();
    if (tag.includes(",")) return null;
    tag = tag.replace(/\s+/g, "_");
    tag = tag.replace(/[^a-zA-Z0-9_\-()]/g, "");
    tag = tag.toLowerCase();
    if (tag.length < 2 || tag.length > 100) return null;
    return tag;
  }

  getCachedTag(tag) {
    try {
      const cacheKey = `danbooru_tag_${tag}`;
      const cached = localStorage.getItem(cacheKey);

      if (cached) {
        const data = JSON.parse(cached);
        const now = Date.now();

        if (data.timestamp && now - data.timestamp < CACHE_DURATION) {
          return data.content;
        } else {
          localStorage.removeItem(cacheKey);
        }
      }
    } catch (e) {
      console.error("Error reading cache:", e);
    }

    return null;
  }

  setCachedTag(tag, data) {
    try {
      const cacheKey = `danbooru_tag_${tag}`;
      const cacheData = {
        timestamp: Date.now(),
        content: data,
      };

      localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    } catch (e) {
      console.error("Error writing cache:", e);
    }
  }

  async fetchTagInfo(tag) {
    try {
      console.log("Fetching tag info for:", tag);
      const response = await fetch(`/api/danbooru/tag/${encodeURIComponent(tag)}`);

      if (response.ok) {
        const data = await response.json();
        return data;
      } else if (response.status === 404) {
        return { error: "Tag not found on Danbooru" };
      } else if (response.status === 429) {
        return { error: "Rate limited, please wait" };
      } else {
        return { error: `Error: ${response.status}` };
      }
    } catch (error) {
      console.error("Failed to fetch tag info:", error);
      return { error: "Network error" };
    }
  }

  async onTextSelection(e) {
    console.log("[Danbooru] onTextSelection triggered");

    if (!this.isEnabled()) {
      console.log("[Danbooru] Extension disabled in settings");
      this.hideTooltip();
      return;
    }

    this.lastMousePos = { x: e.clientX, y: e.clientY };

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      const selection = window.getSelection();
      const selectedText = selection.toString();
      console.log("[Danbooru] Selected text:", selectedText);

      if (!selectedText || selectedText.length === 0) {
        console.log("[Danbooru] No text selected");
        this.hideTooltip();
        return;
      }

      const anchorNode = selection.anchorNode;
      const targetElement = anchorNode?.parentElement || anchorNode;
      //   console.log("[Danbooru] Target element:", targetElement, "tagName:", targetElement?.tagName);

      const isWidget = this.isTextWidget(targetElement);
      //   console.log("[Danbooru] Is text widget:", isWidget);

      if (!isWidget) {
        // console.log("[Danbooru] Not in a text widget, ignoring");
        return;
      }

      const tag = this.parseTag(selectedText);
      //   console.log("[Danbooru] Parsed tag:", tag);

      if (!tag) {
        // console.log("[Danbooru] Invalid tag, ignoring");
        this.hideTooltip();
        return;
      }

      if (this.currentTag === tag && this.tooltipElement) {
        // console.log("[Danbooru] Same tag already displayed");
        return;
      }

      this.currentTag = tag;
      //   console.log("[Danbooru] Fetching info for tag:", tag);
      this.showLoading(tag);
      let tagInfo = this.getCachedTag(tag);

      if (!tagInfo) {
        tagInfo = await this.fetchTagInfo(tag);
        if (tagInfo && !tagInfo.error) this.setCachedTag(tag, tagInfo);
      }

      if (tagInfo) this.showTooltip(tagInfo, tag);
    }, DEBOUNCE_DELAY);
  }

  showLoading(tag) {
    this.hideTooltip();
    this.isLoading = true;

    const tooltip = document.createElement("div");
    tooltip.className = "danbooru-tooltip danbooru-tooltip-loading";

    tooltip.innerHTML = `
      <div class="danbooru-tooltip-header">
        <span class="danbooru-tag-name">${this.escapeHtml(tag)}</span>
      </div>
      <div class="danbooru-tooltip-body">
        <div class="danbooru-loading">
          <span class="danbooru-spinner">⟳</span> Loading...
        </div>
      </div>
    `;

    this.positionTooltip(tooltip);
    document.body.appendChild(tooltip);
    this.tooltipElement = tooltip;
  }

  showTooltip(tagInfo, tag) {
    this.hideTooltip();
    this.isLoading = false;

    if (tagInfo.error) {
      this.showError(tag, tagInfo.error);
      return;
    }

    const tooltip = document.createElement("div");
    tooltip.className = "danbooru-tooltip";
    tooltip.innerHTML = this.formatTooltipContent(tagInfo, tag);

    this.positionTooltip(tooltip);
    document.body.appendChild(tooltip);
    this.tooltipElement = tooltip;
    tooltip.querySelectorAll(".danbooru-related-tag").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const relatedTag = el.dataset.tag;
        if (relatedTag) {
          this.currentTag = relatedTag;
          this.showLoading(relatedTag);
          this.fetchTagInfo(relatedTag).then((info) => {
            if (info) {
              if (!info.error) {
                this.setCachedTag(relatedTag, info);
              }
              this.showTooltip(info, relatedTag);
            }
          });
        }
      });
    });
  }

  showError(tag, errorMsg) {
    this.hideTooltip();
    const tooltip = document.createElement("div");
    tooltip.className = "danbooru-tooltip danbooru-tooltip-error";
    tooltip.innerHTML = `
      <div class="danbooru-tooltip-header">
        <span class="danbooru-tag-name">${this.escapeHtml(tag)}</span>
      </div>
      <div class="danbooru-tooltip-body">
        <div class="danbooru-error">⚠ ${this.escapeHtml(errorMsg)}</div>
      </div>
    `;

    this.positionTooltip(tooltip);
    document.body.appendChild(tooltip);
    this.tooltipElement = tooltip;
  }

  formatTooltipContent(tagInfo, tag) {
    const { tag: tagData, wiki, posts } = tagInfo;

    let html = '<div class="danbooru-tooltip-header">';
    if (tagData) {
      const category = tagData.category || 0;
      const categoryColor = CATEGORY_COLORS[category] || "#888";
      const categoryName = CATEGORY_NAMES[category] || "Unknown";
      const postCount = tagData.post_count || 0;

      html += `
        <div class="danbooru-tag-info">
          <span class="danbooru-tag-name" style="color: ${categoryColor};">
            ${this.escapeHtml(tagData.name)}
          </span>
          <span class="danbooru-tag-category" style="background: ${categoryColor};">
            ${categoryName}
          </span>
        </div>
        <div class="danbooru-post-count">${postCount.toLocaleString()} posts</div>
      `;
    } else {
      html += `<span class="danbooru-tag-name">${this.escapeHtml(tag)}</span>`;
    }

    html += '</div><div class="danbooru-tooltip-body">';

    // Thumbnail image
    if (posts && posts.preview_file_url) {
      const previewUrl = posts.preview_file_url.startsWith("http")
        ? posts.preview_file_url
        : `https://danbooru.donmai.us${posts.preview_file_url}`;

      html += `
        <div class="danbooru-thumbnail">
          <img src="${previewUrl}" alt="Example" loading="lazy" />
        </div>
      `;
    }

    // Wiki excerpt
    if (wiki && wiki.body) {
      const excerpt = this.extractWikiExcerpt(wiki.body);
      if (excerpt) {
        html += `<div class="danbooru-wiki-excerpt">${this.escapeHtml(excerpt)}</div>`;
      }
    }

    // Related tags
    const relatedTags = this.extractRelatedTags(wiki);
    if (relatedTags.length > 0) {
      html += '<div class="danbooru-related-tags"><strong>Related:</strong> ';
      html += relatedTags
        .map(
          (t) =>
            `<a href="https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(t)}" class="danbooru-related-tag" data-tag="${this.escapeHtml(t)}" target="_blank">${this.escapeHtml(t)}</a>`,
        )
        .join(", ");
      html += "</div>";
    }

    // Link to full wiki page
    html += `
      <div class="danbooru-wiki-link">
        <a href="https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(tag)}" target="_blank">
          View full wiki page →
        </a>
      </div>
    `;

    html += "</div>";

    return html;
  }

  /**
   * Extract first paragraph from wiki body
   */
  extractWikiExcerpt(body) {
    if (!body) return null;

    let text = body;
    text = text.replace(/^h[1-6]\.\s+/gm, "");

    // Remove links but keep text
    text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, link, label) => label || link);
    text = text.replace(/"([^"]+)":\S+/g, "$1");

    // Remove formatting
    text = text.replace(/\[b\]|\[\/b\]/g, "");
    text = text.replace(/\[i\]|\[\/i\]/g, "");

    // Get first paragraph
    const paragraphs = text.split(/\n\n+/);
    let excerpt = paragraphs[0]?.trim() || "";

    // Truncate if too long
    if (excerpt.length > 250) excerpt = excerpt.substring(0, 250) + "...";

    return excerpt;
  }

  extractRelatedTags(wiki) {
    if (!wiki || !wiki.body) return [];

    const body = wiki.body;
    const relatedTags = [];

    const seeAlsoMatch = body.match(/h[1-6]\.\s*See [Aa]lso\s*\n+(.*?)(?=\n\nh[1-6]\.|$)/s);

    if (seeAlsoMatch) {
      const section = seeAlsoMatch[1];

      // Extract wiki links [[tag]] or [[tag|label]]
      const wikiLinks = section.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);

      if (wikiLinks) {
        wikiLinks.forEach((link) => {
          const match = link.match(/\[\[([^\]|]+)/);
          if (match) {
            const tag = match[1].trim().toLowerCase().replace(/\s+/g, "_");
            if (tag && !relatedTags.includes(tag)) relatedTags.push(tag);
          }
        });
      }

      // Limit to first 5 tags
      return relatedTags.slice(0, 5);
    }

    return [];
  }

  positionTooltip(tooltip) {
    const { x, y } = this.lastMousePos;

    tooltip.style.cssText = `
      position: fixed;
      left: -9999px;
      top: -9999px;
      opacity: 0;
    `;

    document.body.appendChild(tooltip);

    const rect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = x + TOOLTIP_OFFSET;
    let top = y + TOOLTIP_OFFSET;

    // Adjust if would overflow right edge
    if (left + rect.width > viewportWidth - 10) left = x - rect.width - TOOLTIP_OFFSET;

    // Adjust if would overflow left edge
    if (left < 10) left = 10;

    // Adjust if would overflow bottom edge
    if (top + rect.height > viewportHeight - 10) top = y - rect.height - TOOLTIP_OFFSET;

    // Adjust if would overflow top edge
    if (top < 10) top = 10;

    tooltip.style.cssText = `
      position: fixed;
      left: ${left}px;
      top: ${top}px;
      opacity: 1;
    `;
  }

  hideTooltip() {
    if (this.tooltipElement) {
      this.tooltipElement.remove();
      this.tooltipElement = null;
    }
    this.currentTag = null;
    this.isLoading = false;
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

const tooltip = new DanbooruTooltip();

app.registerExtension({
  name: "Steaked.DanbooruTagTooltip",

  async setup() {
    // Add setting
    app.ui.settings.addSetting({
      id: "Steaked.DanbooruTagTooltip.Enabled",
      name: "Show Danbooru tag info on text selection",
      type: "boolean",
      defaultValue: true,
    });

    // Add global text selection listener
    document.addEventListener("mouseup", (e) => tooltip.onTextSelection(e));

    // Hide tooltip on mousedown outside
    document.addEventListener("mousedown", (e) => {
      if (tooltip.tooltipElement && !tooltip.tooltipElement.contains(e.target)) {
        tooltip.hideTooltip();
      }
    });

    // Hide tooltip when clicking elsewhere or pressing Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        tooltip.hideTooltip();
      }
    });

    // Inject styles
    const style = document.createElement("style");
    style.textContent = `
      .danbooru-tooltip {
        position: fixed;
        background: #1e1e1e;
        border: 1px solid #444;
        border-radius: 6px;
        padding: 0;
        max-width: 400px;
        max-height: 600px;
        overflow-y: auto;
        z-index: 99999;
        color: #e0e0e0;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        animation: fadeIn 0.15s ease-out;
        line-height: 1.4;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(-5px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .danbooru-tooltip-header {
        background: #2a2a2a;
        padding: 10px 12px;
        border-bottom: 1px solid #444;
        border-radius: 6px 6px 0 0;
      }

      .danbooru-tag-info {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }

      .danbooru-tag-name {
        font-weight: 600;
        font-size: 14px;
      }

      .danbooru-tag-category {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 3px;
        color: #fff;
        font-weight: 600;
        text-transform: uppercase;
      }

      .danbooru-post-count {
        color: #999;
        font-size: 12px;
      }

      .danbooru-tooltip-body {
        padding: 12px;
      }

      .danbooru-thumbnail {
        margin-bottom: 12px;
        text-align: center;
        background: #000;
        border-radius: 4px;
        overflow: hidden;
      }

      .danbooru-thumbnail img {
        max-width: 100%;
        max-height: 200px;
        display: block;
        margin: 0 auto;
      }

      .danbooru-wiki-excerpt {
        color: #ccc;
        margin-bottom: 12px;
        line-height: 1.5;
      }

      .danbooru-related-tags {
        margin-bottom: 12px;
        font-size: 12px;
      }

      .danbooru-related-tags strong {
        color: #aaa;
      }

      .danbooru-related-tag {
        color: #5b9eff;
        text-decoration: none;
        cursor: pointer;
      }

      .danbooru-related-tag:hover {
        text-decoration: underline;
      }

      .danbooru-wiki-link {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid #333;
        font-size: 11px;
      }

      .danbooru-wiki-link a {
        color: #5b9eff;
        text-decoration: none;
      }

      .danbooru-wiki-link a:hover {
        text-decoration: underline;
      }

      .danbooru-loading,
      .danbooru-error {
        padding: 8px 0;
        text-align: center;
        color: #999;
      }

      .danbooru-error {
        color: #f88;
      }

      .danbooru-spinner {
        display: inline-block;
        animation: spin 1s linear infinite;
        font-size: 16px;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .danbooru-tooltip-loading .danbooru-tooltip-body,
      .danbooru-tooltip-error .danbooru-tooltip-body {
        padding: 12px;
      }
    `;
    document.head.appendChild(style);

    console.log("Danbooru Tag Tooltip extension loaded");
  },
});
