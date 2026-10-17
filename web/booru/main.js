/**
 * booru/main.js – Extension entry point: settings, global listeners, topbar menu.
 */

import { app } from "../../../scripts/app.js";
import { BOORU_STYLES } from "./styles.js";
import { BooruTooltip } from "./tooltip.js";
import { openDetail } from "./detail.js";
import { openExplorer } from "./explorer.js";
import { PROVIDER_LABELS, getProvider } from "./api.js";

const PROVIDER_IDS = Object.keys(PROVIDER_LABELS);

async function fetchProvidersMeta() {
  try {
    const res = await fetch("/api/booru/providers");
    if (res.ok) return await res.json();
  } catch {
    /* backend offline, defaults still work */
  }
  return {};
}

function providerOptions() {
  return PROVIDER_IDS.map((id) => ({ value: id, text: PROVIDER_LABELS[id] }));
}

// API key management for providers that require one (gelbooru, rule34)
function apiKeyPrompt(provider) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "booru-overlay";
    overlay.innerHTML = `
      <div class="booru-overlay-inner booru-panel" style="width:min(480px,92vw); padding:20px; color:#e0e0e0;">
        <h3 style="margin:0 0 8px; color:#fff;">${PROVIDER_LABELS[provider]} API key</h3>
        <p style="color:#aaa; font-size:12px; margin:0 0 14px;">
          ${PROVIDER_LABELS[provider]} requires a (free) account API key for API access.
          Create an account, then find your API key and user id in your account options.
        </p>
        <input class="booru-explorer-search booru-key-input" type="password" placeholder="API key" style="width:100%; margin-bottom:8px; box-sizing:border-box;" />
        <input class="booru-explorer-search booru-uid-input" type="text" placeholder="User id" style="width:100%; margin-bottom:14px; box-sizing:border-box;" />
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="booru-icon-btn booru-key-cancel">Cancel</button>
          <button class="booru-icon-btn booru-key-save" style="background:#2d5a2d;">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const done = (val) => {
      overlay.remove();
      resolve(val);
    };
    overlay.querySelector(".booru-key-cancel").addEventListener("click", () => done(null));
    overlay.querySelector(".booru-key-save").addEventListener("click", async () => {
      const apiKey = overlay.querySelector(".booru-key-input").value.trim();
      const userId = overlay.querySelector(".booru-uid-input").value.trim();
      const res = await fetch(`/api/booru/settings/keys/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, user_id: userId }),
      });
      done(res.ok ? { apiKey, userId } : null);
    });
  });
}

async function openTagFromPrompt() {
  const tag = prompt("Tag to look up:");
  if (!tag) return;
  const normalized = tag.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized) openDetail(normalized, getProvider(), await fetchProvidersMeta());
}

app.registerExtension({
  name: "Steaked.BooruViewer",

  async setup() {
    const styleEl = document.createElement("style");
    styleEl.textContent = BOORU_STYLES;
    document.head.appendChild(styleEl);

    const providersMeta = await fetchProvidersMeta();

    app.ui.settings.addSetting({
      id: "Steaked.Booru.TooltipEnabled",
      name: "Booru viewer: show tag info on text selection",
      type: "boolean",
      defaultValue: true,
    });

    app.ui.settings.addSetting({
      id: "Steaked.Booru.ShowImages",
      name: "Booru viewer: show thumbnail images in tooltips",
      type: "boolean",
      defaultValue: true,
    });

    app.ui.settings.addSetting({
      id: "Steaked.Booru.Provider",
      name: "Booru viewer: default provider",
      type: "combo",
      options: providerOptions(),
      defaultValue: "danbooru",
      attrs: { style: { width: "150px" } },
    });

    app.ui.settings.addSetting({
      id: "Steaked.Booru.Transport",
      name: "Booru viewer: connection method",
      type: "combo",
      options: [
        { value: "proxy", text: "Proxy via ComfyUI server (recommended)" },
        { value: "direct", text: "Direct from browser (experimental)" },
      ],
      defaultValue: "proxy",
      tooltip:
        "Direct mode fetches Danbooru/e621 straight from your browser, bypassing the ComfyUI server. " +
        "Only useful if the server-side connection to a booru is broken (SSL errors, blocks). " +
        "WARNING: depends on your browser/IP not being Cloudflare-challenged, only supports Danbooru and e621, " +
        "and other providers automatically fall back to the proxy. Any direct failure also falls back to the proxy.",
      attrs: { style: { width: "250px" } },
    });

    app.ui.settings.addSetting({
      id: "Steaked.Booru.GelbooruKey",
      name: "Booru viewer: Gelbooru API key (required for Gelbooru)",
      type: "button",
      attrs: { text: "Set API key" },
      tooltip: "Gelbooru requires a free account API key since 2025. Click to configure.",
      onClick: () => apiKeyPrompt("gelbooru"),
    });

    app.ui.settings.addSetting({
      id: "Steaked.Booru.Rule34Key",
      name: "Booru viewer: Rule34 API key (required for Rule34)",
      type: "button",
      attrs: { text: "Set API key" },
      tooltip: "Rule34 requires a free account API key since 2025. Click to configure.",
      onClick: () => apiKeyPrompt("rule34"),
    });

    const tooltip = new BooruTooltip(providersMeta);

    document.addEventListener("mouseup", (e) => {
      if (e.target.closest?.(".booru-overlay, .booru-lightbox, .booru-tooltip")) return;
      tooltip.onTextSelection(e);
    });
    document.addEventListener("mousedown", (e) => {
      if (tooltip.el && !tooltip.el.contains(e.target) && !e.target.closest(".booru-open-detail")) {
        tooltip.hide();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") tooltip.hide();
    });

    // Topbar menu
    const menu = document.querySelector(".comfy-menu") || document.querySelector("#comfyui-menu");
    const addMenuItems = (container) => {
      if (!container || container.querySelector(".booru-menu-item")) return;
      const detailItem = document.createElement("button");
      detailItem.className = "booru-menu-item";
      detailItem.textContent = "Booru Tag Lookup";
      detailItem.addEventListener("click", openTagFromPrompt);

      const explorerItem = document.createElement("button");
      explorerItem.className = "booru-menu-item";
      explorerItem.textContent = "Booru Explorer";
      explorerItem.addEventListener("click", () => openExplorer("", getProvider()));

      container.append(detailItem, explorerItem);
    };
    addMenuItems(menu);

    // ComfyUI new UI puts actions in the topbar command registry
    if (window.comfyAPI?.menu?.menuStore) {
      try {
        const { menuStore } = window.comfyAPI.menu;
        menuStore.commands.push(
          {
            id: "steaked-booru-lookup",
            label: "Booru Tag Lookup",
            invoke: openTagFromPrompt,
          },
          {
            id: "steaked-booru-explorer",
            label: "Booru Explorer",
            invoke: () => openExplorer("", getProvider()),
          },
        );
      } catch {
        /* older comfy versions, fallback menu above */
      }
    }
  },
});
