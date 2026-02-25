/**
 * library_civitai.js
 * Standalone Civitai / LoRA-info popup for the Steaked Library node.
 * Imported by library_widget.js via ES module import.
 */

// ─── API helpers ──────────────────────────────────────────────────────────────
async function _apiGet(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
async function _apiPost(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ─── CSS ─────────────────────────────────────────────────────────────────────
const CIVITAI_STYLE = `
.slc-overlay {
  position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:99999;
  display:flex;align-items:center;justify-content:center;
  font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#ddd;
}
.slc-popup {
  background:#1e1e1e;border:1px solid #3a3a3a;border-radius:8px;
  padding:0;max-width:1300px;width:96vw;max-height:94vh;
  box-shadow:0 16px 64px rgba(0,0,0,0.9);
  display:flex;flex-direction:column;overflow:hidden;
}
.slc-popup-header {
  display:flex;align-items:center;gap:8px;padding:11px 14px 9px;
  border-bottom:1px solid #2e2e2e;flex-shrink:0;
}
.slc-popup-title{flex:1;font-size:13px;font-weight:600;color:#ddd;}
.slc-popup-close{
  background:none;border:none;color:#555;font-size:18px;cursor:pointer;
  line-height:1;padding:0 4px;
}
.slc-popup-close:hover{color:#f77;}
.slc-popup-body{
  display:flex;gap:0;overflow:hidden;flex:1;min-height:0;
}
.slc-body-left{
  width:340px;flex-shrink:0;padding:14px;border-right:1px solid #2a2a2a;
  overflow-y:auto;
}
.slc-body-right{
  flex:1;padding:14px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;min-width:0;
}
.slc-preview-img{width:100%;height:auto;border-radius:6px;display:block;margin-bottom:10px;}
.slc-meta-table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:0;}
.slc-meta-table td{padding:4px 5px;border-bottom:1px solid #272727;vertical-align:top;}
.slc-meta-table td:first-child{color:#555;white-space:nowrap;width:90px;}
.slc-desc{font-size:11px;color:#888;line-height:1.5;margin:0;}
.slc-civitai-btn{
  display:block;width:100%;padding:7px;border-radius:5px;
  background:#252525;border:1px solid #3a3a3a;color:#999;
  cursor:pointer;font-size:11px;text-align:center;
}
.slc-civitai-btn:hover:not(:disabled){background:#2e2e2e;border-color:#555;color:#ddd;}
.slc-civitai-btn:disabled{opacity:0.5;cursor:not-allowed;}
.slc-no-info{font-size:11px;color:#555;font-style:italic;margin:0;}
.slc-pre{
  background:#171717;border-radius:4px;padding:8px;font-size:10px;
  overflow-x:auto;white-space:pre-wrap;word-break:break-all;
  color:#666;max-height:180px;margin-top:0;
}
.slc-toggle-btn{
  font-size:10px;color:#555;cursor:pointer;background:none;
  border:1px solid #333;border-radius:4px;padding:2px 7px;
}
.slc-toggle-btn:hover{color:#aaa;border-color:#555;}
.slc-examples-hdr{
  font-size:9px;color:#555;text-transform:uppercase;letter-spacing:0.08em;
  padding-bottom:6px;border-bottom:1px solid #2a2a2a;flex-shrink:0;
}
.slc-examples-strip{
  display:flex;flex-wrap:wrap;gap:8px;padding-bottom:4px;flex-shrink:0;
  overflow-y:auto;max-height:460px;
  scrollbar-width:thin;scrollbar-color:#3a3a3a #1e1e1e;
}
.slc-example-wrap{
  position:relative;flex-shrink:0;cursor:pointer;
  border-radius:5px;overflow:hidden;border:1px solid #333;
  width:200px;height:200px;
}
.slc-example-img{width:200px;height:200px;object-fit:cover;display:block;}
.slc-example-prompt{
  position:absolute;inset:0;background:rgba(10,10,10,0.90);
  opacity:0;pointer-events:none;
  padding:6px;font-size:9px;color:#ccc;font-family:'Segoe UI',Arial,sans-serif;
  overflow-y:auto;line-height:1.4;white-space:pre-wrap;word-break:break-word;
  transition:opacity 0.15s;
}
.slc-example-wrap:hover .slc-example-prompt{opacity:1;pointer-events:auto;}
`;

let _civitaiStyleDone = false;
function _injectStyle() {
  if (_civitaiStyleDone) return;
  _civitaiStyleDone = true;
  // Always replace — avoids stale cached style from previous page loads
  const existing = document.getElementById("slc-style");
  if (existing) existing.remove();
  const s = document.createElement("style");
  s.id = "slc-style";
  s.textContent = CIVITAI_STYLE;
  document.head.appendChild(s);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    e.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

// ─── Main exported function ───────────────────────────────────────────────────
/**
 * Show the LoRA info popup with Civitai fetch support.
 * @param {string} loraFile  - filename of the LoRA (as known to ComfyUI)
 */
export async function showLoraInfo(loraFile) {
  if (!loraFile) return;
  _injectStyle();

  // Fetch cached info first (may be empty if no sidecar exists)
  let info = {};
  try { info = await _apiGet(`/steaked/library/lora/info/${encodeURIComponent(loraFile)}`); }
  catch (_) {}

  // Build overlay
  const overlay = _el("div", { class: "slc-overlay" });
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

  const popup = _el("div", { class: "slc-popup" });
  popup.addEventListener("click", e => e.stopPropagation());
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  const renderContent = (data) => {
    popup.innerHTML = "";

    // Header
    const name = data.model?.name ?? data.name ?? loraFile;
    const hdr = _el("div", { class: "slc-popup-header" });
    hdr.appendChild(_el("span", { class: "slc-popup-title" }, name));
    const closeBtn = _el("button", { class: "slc-popup-close" }, "✕");
    closeBtn.addEventListener("click", () => overlay.remove());
    hdr.appendChild(closeBtn);
    popup.appendChild(hdr);

    // 2-column body
    const body    = _el("div", { class: "slc-popup-body" });
    const colLeft = _el("div", { class: "slc-body-left" });
    const colRight= _el("div", { class: "slc-body-right" });
    body.append(colLeft, colRight);
    popup.appendChild(body);

    // LEFT — preview image + compact meta table
    const previewUrl = data.images?.[0]?.url;
    if (previewUrl) {
      colLeft.appendChild(_el("img", { class: "slc-preview-img", src: previewUrl, alt: name }));
    }
    const rows = [];
    if (data.model?.type)             rows.push(["Type",         data.model.type]);
    if (data.baseModel)               rows.push(["Base model",   data.baseModel]);
    if (data.model?.nsfw !== undefined) rows.push(["NSFW",       data.model.nsfw ? "Yes" : "No"]);
    const triggers = data.trainedWords?.filter(Boolean);
    if (triggers?.length)             rows.push(["Triggers",     triggers.join(", ")]);
    if (data.metadata?.ss_network_args) {
      try {
        const a = JSON.parse(data.metadata.ss_network_args);
        if (a.conv_alpha !== undefined) rows.push(["Conv alpha", String(a.conv_alpha)]);
      } catch (_) {}
    }
    if (rows.length) {
      const tbl = _el("table", { class: "slc-meta-table" });
      for (const [k, v] of rows)
        tbl.appendChild(_el("tr", {}, _el("td", {}, k), _el("td", {}, v)));
      colLeft.appendChild(tbl);
    }

    // RIGHT — description, fetch, raw JSON, example images
    if (!previewUrl && !rows.length && !data.description) {
      colRight.appendChild(_el("p", { class: "slc-no-info" },
        "No .civitai.info sidecar found for this LoRA. Fetch from Civitai below."));
    }
    if (data.description) {
      const desc = _el("p", { class: "slc-desc" });
      desc.textContent = data.description.replace(/<[^>]+>/g, "");
      colRight.appendChild(desc);
    }

    // Civitai fetch button — only show when we don't already have model info
    const alreadyFetched = !!(data.model?.name || data.images?.length);
    if (!alreadyFetched) {
      const fetchBtn = _el("button", { class: "slc-civitai-btn" }, "🌐 Fetch info from Civitai");
      fetchBtn.addEventListener("click", async () => {
        fetchBtn.disabled = true;
        fetchBtn.textContent = "Fetching… (computing SHA256 + API call, may take a moment)";
        try {
          const result = await _apiPost("/steaked/library/lora/fetch-civitai", { lora_name: loraFile });
          if (result.error) {
            fetchBtn.textContent = `❌ ${result.error}`;
            fetchBtn.disabled = false;
          } else {
            info = result;
            renderContent(info);
          }
        } catch (err) {
          fetchBtn.textContent = `❌ ${err.message}`;
          fetchBtn.disabled = false;
        }
      });
      colRight.appendChild(fetchBtn);
    }

    // Raw JSON toggle
    if (Object.keys(data).length > 0) {
      const toggleBtn = _el("button", { class: "slc-toggle-btn" }, "Show raw JSON");
      const pre = _el("pre", { class: "slc-pre", style: { display: "none" } },
        JSON.stringify(data, null, 2));
      toggleBtn.addEventListener("click", () => {
        const hidden = pre.style.display === "none";
        pre.style.display = hidden ? "block" : "none";
        toggleBtn.textContent = hidden ? "Hide raw JSON" : "Show raw JSON";
      });
      colRight.appendChild(toggleBtn);
      colRight.appendChild(pre);
    }

    // Example images strip
    const imgs = (data.images ?? []).filter(im => im?.url);
    if (imgs.length) {
      colRight.appendChild(_el("div", { class: "slc-examples-hdr" }, `Example images (${imgs.length})`));
      const strip = _el("div", { class: "slc-examples-strip" });
      for (const im of imgs) {
        const prompt    = im.meta?.prompt    ?? im.meta?.Prompt    ?? "";
        const negPrompt = im.meta?.negativePrompt ?? im.meta?.NegativePrompt ?? "";
        const tipParts  = [
          prompt    ? `Prompt:\n${prompt}`           : null,
          negPrompt ? `\nNegative:\n${negPrompt}`   : null,
          im.meta?.seed  != null ? `\nSeed: ${im.meta.seed}` : null,
          im.meta?.Model ? `\nModel: ${im.meta.Model}`       : null,
        ].filter(Boolean);
        const wrap  = _el("div", { class: "slc-example-wrap" });
        const imgEl = _el("img", { class: "slc-example-img", src: im.url, loading: "lazy", alt: "" });
        const tipEl = _el("div", { class: "slc-example-prompt" },
          tipParts.length ? tipParts.join("") : "No prompt metadata");
        wrap.append(imgEl, tipEl);
        strip.appendChild(wrap);
      }
      colRight.appendChild(strip);
    }
  };

  renderContent(info);
}