/**
 * Info modal + lora chooser for the Combo lora loader.
 *
 * Info modal merges:
 *   - local safetensors header metadata (ss_* training data, tag frequency)
 *   - cached civitai sidecar data (.civitai.info), with a re-fetch button
 */

import { getLocalInfo, fetchCivitai } from "./api.js";

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    el.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return el;
}

function copyText(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function chip(text, title) {
  return h("span", { class: "sl-chip", title: title || "Click to copy", onclick: () => copyText(text) }, text);
}

function fmtDate(unix) {
  if (!unix) return null;
  const n = Number(unix);
  if (!isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toLocaleString();
}

/**
 * Best-effort activation words for a lora:
 *   1. civitai trainedWords (human-curated, most reliable)
 *   2. the most-used tag from ss_tag_frequency (appears in ~every training image)
 *   3. first word-ish token of ss_training_comment
 */
export function extractActivationWords(meta, civ) {
  const out = [];
  if (Array.isArray(civ?.trainedWords)) {
    for (const tw of civ.trainedWords) if (tw?.word) out.push(tw.word);
  }
  if (!out.length && meta?.ss_tag_frequency && typeof meta.ss_tag_frequency === "object") {
    const totals = {};
    for (const sub of Object.values(meta.ss_tag_frequency)) {
      if (!sub || typeof sub !== "object") continue;
      for (const [tag, count] of Object.entries(sub)) {
        totals[tag] = (totals[tag] || 0) + Number(count) || 0;
      }
    }
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    if (sorted.length) out.push(sorted[0][0]);
  }
  if (!out.length && meta?.ss_output_name) out.push(meta.ss_output_name);
  return [...new Set(out)];
}

function fmtDuration(started, finished) {
  const s = Number(started), f = Number(finished);
  if (!isFinite(s) || !isFinite(f) || f <= s) return null;
  const secs = Math.round(f - s);
  const hrs = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  return `${hrs}h ${mins}m`;
}

export class LoraInfoModal {
  constructor() {
    this.el = null;
  }

  open(loraName) {
    this.close();
    this.el = h("div", { class: "steaked-lora-modal", onclick: (e) => { if (e.target === this.el) this.close(); } },
      h("div", { class: "sl-modal-box" },
        h("div", { class: "sl-modal-header" },
          h("span", { class: "sl-modal-title" }, loraName.split("/").pop()),
          h("button", { class: "sl-modal-close", onclick: () => this.close() }, "✕"),
        ),
        h("div", { class: "sl-modal-body" },
          h("div", { class: "sl-loading" }, "Reading LoRA info…"),
        ),
      ),
    );
    document.body.appendChild(this.el);
    const esc = (e) => { if (e.key === "Escape") { this.close(); document.removeEventListener("keydown", esc); } };
    document.addEventListener("keydown", esc);
    this._load(loraName);
  }

  close() {
    this.el?.remove();
    this.el = null;
  }

  async _load(loraName) {
    let data;
    try {
      data = await getLocalInfo(loraName);
    } catch (e) {
      if (!this.el) return;
      this.el.querySelector(".sl-modal-body").replaceChildren(
        h("div", { class: "sl-error" }, String(e.message || e)),
      );
      return;
    }
    if (!this.el) return;
    this._render(loraName, data);
  }

  _render(loraName, data) {
    const meta = data.metadata || {};
    const civ = data.civitai || {};
    const tabs = [
      ["overview", "Overview"],
      ["training", "Training"],
      ["tags", "Tags"],
      ["civitai", "Civitai"],
      ["raw", "Raw JSON"],
    ];
    const content = h("div", { class: "sl-modal-content" });
    const tabEls = {};
    const tabStrip = h("div", { class: "sl-modal-tabs" });
    for (const [id, label] of tabs) {
      tabEls[id] = h("div", { class: "sl-mt" + (id === "overview" ? " active" : ""), onclick: () => {
        tabStrip.querySelectorAll(".sl-mt").forEach((t) => t.classList.remove("active"));
        tabEls[id].classList.add("active");
        this._showTab(id, content, loraName, meta, civ);
      } }, label);
      tabStrip.append(tabEls[id]);
    }
    this.el.querySelector(".sl-modal-body").replaceChildren(tabStrip, content);
    this._showTab("overview", content, loraName, meta, civ);
  }

  _showTab(id, content, loraName, meta, civ) {
    const renderers = {
      overview: () => this._renderOverview(loraName, meta, civ),
      training: () => this._renderTraining(meta),
      tags: () => this._renderTags(meta),
      civitai: () => this._renderCivitai(loraName, civ),
      raw: () => h("div", { class: "sl-json" }, JSON.stringify({ metadata: meta, civitai: civ }, null, 2)),
    };
    content.replaceChildren(renderers[id]());
    content.scrollTop = 0;
  }

  _showImageMeta(img) {
    const meta = img.meta || {};
    const content = this.el.querySelector(".sl-modal-content");
    const frag = document.createDocumentFragment();

    frag.append(h("h4", {}, "Preview"));
    const full = h("img", {
      src: img.url,
      style: "max-width:100%;max-height:280px;border-radius:2px;object-fit:contain;cursor:pointer",
      title: "Open full image on Civitai",
      onclick: () => window.open(img.url, "_blank"),
    });
    frag.append(h("div", { style: "text-align:center" }, full));

    if (meta.prompt) {
      frag.append(h("h4", {}, "Prompt (click to copy)"));
      frag.append(h("div", {
        class: "sl-json",
        style: "cursor:pointer",
        onclick: () => copyText(meta.prompt),
        title: "Click to copy",
      }, meta.prompt));
    }
    if (meta.negativePrompt) {
      frag.append(h("h4", {}, "Negative prompt (click to copy)"));
      frag.append(h("div", {
        class: "sl-json",
        style: "cursor:pointer",
        onclick: () => copyText(meta.negativePrompt),
        title: "Click to copy",
      }, meta.negativePrompt));
    }

    frag.append(h("h4", {}, "Generation settings"));
    frag.append(this._kv([
      ["Model", meta.Model],
      ["Sampler", meta.sampler],
      ["Steps", meta.steps],
      ["CFG", meta.cfgScale],
      ["Seed", meta.seed],
      ["Size", meta.Size],
      ["Schedule type", meta["Schedule type"]],
      ["Version", meta.Version],
    ]));

    const loraRes = (meta.resources ?? []).filter((r) => r?.type === "lora");
    if (loraRes.length) {
      frag.append(h("h4", {}, "LoRAs used"));
      const chips = h("div", { class: "sl-chips" });
      for (const r of loraRes) {
        chips.append(chip(`${r.name}:${r.weight ?? 1}`, "Click to copy"));
      }
      frag.append(chips);
    }

    if (!meta.prompt && !meta.negativePrompt && !meta.Model) {
      frag.append(h("div", { class: "sl-loading" }, "This image has no generation metadata on Civitai."));
    }

    content.replaceChildren(frag);
    content.scrollTop = 0;
  }

  _kv(pairs) {
    const grid = h("div", { class: "sl-kv-grid" });
    for (const [k, v] of pairs) {
      if (v === null || v === undefined || v === "") continue;
      grid.append(h("div", { class: "sl-kv-k" }, k), h("div", { class: "sl-kv-v" }, String(v)));
    }
    return grid;
  }

  _renderOverview(loraName, meta, civ) {
    const frag = document.createDocumentFragment();

    if (civ.images?.length) {
      frag.append(h("h4", {}, "Previews (click for generation info)"));
      const grid = h("div", { class: "sl-preview-grid" });
      for (const img of civ.images.slice(0, 6)) {
        if (!img?.url) continue;
        grid.append(h("img", {
          src: img.url, loading: "lazy",
          title: img.meta?.prompt ? "Click to view prompt & settings" : "Click to open on Civitai",
          onclick: () => (img.meta ? this._showImageMeta(img) : window.open(img.url, "_blank")),
        }));
      }
      if (grid.children.length) frag.append(grid);
    }

    frag.append(h("h4", {}, "Identity"));
    frag.append(this._kv([
      ["File", loraName],
      ["Civitai model", civ.model?.name],
      ["Version", civ.name],
      ["Base model", civ.baseModel || meta["modelspec.architecture"]?.replace(/^ Stable Diffusion /, "")],
      ["Type", civ.model?.type],
      ["NSFW", civ.model?.nsfw === undefined ? null : civ.model?.nsfw ? "Yes" : "No"],
      ["Network", [meta.ss_network_module, meta.ss_network_dim ? `dim ${meta.ss_network_dim}` : null, meta.ss_network_alpha ? `alpha ${meta.ss_network_alpha}` : null].filter(Boolean).join(" · ") || null],
      ["Creator", civ.model?.creator?.username],
      ["Civitai link", civ.modelId ? (() => {
        const a = h("a", { href: `https://civitai.com/models/${civ.modelId}?modelVersionId=${civ.id}`, target: "_blank" });
        a.textContent = `models/${civ.modelId}`;
        return a;
      })() : null],
    ]));

    const words = this._activationWords(meta, civ);
    if (words.length) {
      frag.append(h("h4", {}, `Activation words (click to copy)`));
      const chips = h("div", { class: "sl-chips" });
      for (const w of words) chips.append(chip(w));
      frag.append(chips);
    }

    if (civ.description) {
      frag.append(h("h4", {}, "Description"));
      const box = h("div", { class: "sl-json", style: "max-height:180px;user-select:text" });
      box.innerHTML = civ.description; // civitai descriptions are HTML
      frag.append(box);
    }

    if (!frag.childNodes.length) frag.append(h("div", { class: "sl-loading" }, "No metadata found for this LoRA."));
    return frag;
  }

  _activationWords(meta, civ) {
    return extractActivationWords(meta, civ);
  }

  _renderTraining(meta) {
    const frag = document.createDocumentFragment();
    if (!Object.keys(meta).length) {
      return h("div", { class: "sl-loading" }, "No training metadata embedded in this file. (Likely not trained with kohya sd-scripts, or metadata was stripped.)");
    }

    const datasets = meta.ss_dataset_dirs || meta.ss_datasets;
    let totalImages = 0;
    if (Array.isArray(datasets)) {
      totalImages = datasets.reduce((n, d) => n + (Number(d?.img_count) || 0), 0);
    } else if (datasets && typeof datasets === "object") {
      totalImages = Object.values(datasets).reduce((n, d) => n + (Number(d?.img_count) || 0), 0);
    }

    frag.append(h("h4", {}, "Network"));
    frag.append(this._kv([
      ["Module / algo", meta.ss_network_module],
      ["Dim / rank", meta.ss_network_dim],
      ["Alpha", meta.ss_network_alpha],
      ["Network args", meta.ss_network_args ? JSON.stringify(meta.ss_network_args) : null],
      ["Resolution", meta.ss_resolution || meta["modelspec.resolution"]],
    ]));

    frag.append(h("h4", {}, "Training run"));
    frag.append(this._kv([
      ["Base model", meta.ss_sd_model_name],
      ["Optimizer", meta.ss_optimizer],
      ["Learning rate", meta.ss_learning_rate],
      ["Text encoder LR", meta.ss_text_encoder_lr],
      ["UNet LR", meta.ss_unet_lr],
      ["Scheduler", meta.ss_lr_scheduler],
      ["Warmup steps", meta.ss_lr_warmup_steps],
      ["Epochs", meta.ss_num_epochs ? `${meta.ss_epoch ?? "?"} / ${meta.ss_num_epochs}` : null],
      ["Steps", meta.ss_max_train_steps ? `${meta.ss_steps ?? "?"} / ${meta.ss_max_train_steps}` : null],
      ["Batch size", meta.ss_total_batch_size],
      ["Clip skip", meta.ss_clip_skip],
      ["Noise offset", meta.ss_noise_offset],
      ["Min SNR gamma", meta.ss_min_snr_gamma],
      ["Training time", fmtDuration(meta.ss_training_started_at, meta.ss_training_finished_at)],
      ["Started", fmtDate(meta.ss_training_started_at)],
      ["Finished", fmtDate(meta.ss_training_finished_at)],
    ]));

    if (datasets) {
      frag.append(h("h4", {}, `Dataset (${totalImages} images)`));
      const rows = [];
      const entries = Array.isArray(datasets)
        ? datasets.map((d, i) => [`[${i}] ${d?.image_dir || "?"}`, d])
        : Object.entries(datasets);
      for (const [name, d] of entries) {
        rows.push([name, `${d?.img_count ?? "?"} imgs · repeats ${d?.num_repeats ?? "?"}`]);
      }
      frag.append(this._kv(rows));
    }

    if (meta.ss_training_comment) {
      frag.append(h("h4", {}, "Training comment"));
      frag.append(h("div", { class: "sl-json", style: "max-height:120px" }, String(meta.ss_training_comment)));
    }
    return frag;
  }

  _renderTags(meta) {
    const freq = meta.ss_tag_frequency;
    if (!freq || typeof freq !== "object") {
      return h("div", { class: "sl-loading" }, "No tag frequency data (ss_tag_frequency) embedded in this file.");
    }
    // Aggregate across dataset folders, sort by count
    const totals = {};
    for (const sub of Object.values(freq)) {
      if (!sub || typeof sub !== "object") continue;
      for (const [tag, count] of Object.entries(sub)) {
        totals[tag] = (totals[tag] || 0) + Number(count) || 0;
      }
    }
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return h("div", { class: "sl-loading" }, "Tag frequency data is empty.");

    const frag = document.createDocumentFragment();
    // Suggested prompt = the head of the frequency list: tags that appear in
    // (nearly) every image. Cut at the cliff where usage drops below 60% of
    // the top tag's count, capped to a sane length.
    const topCount = sorted[0][1];
    const cut = Math.max(
      3,
      sorted.findIndex(([, c]) => c < topCount * 0.6)
    );
    const promptTags = sorted.slice(0, Math.min(cut === -1 ? 20 : cut, 20));

    frag.append(h("h4", {}, "Suggested prompt (click to copy)"));
    frag.append(chip(promptTags.map(([t]) => t).join(", "), "Copy suggested prompt"));

    frag.append(h("h4", {}, `Tag frequency (${sorted.length} tags)`));
    const wrap = h("div", { class: "sl-tag-freq" });
    for (const [tag, count] of sorted) {
      wrap.append(h("span", { class: "sl-tf", onclick: () => copyText(tag), title: "Click to copy" },
        tag, h("span", { class: "sl-tf-n" }, count)));
    }
    frag.append(wrap);
    return frag;
  }

  _renderCivitai(loraName, civ) {
    const frag = document.createDocumentFragment();
    if (!Object.keys(civ).length) {
      frag.append(h("div", { class: "sl-loading" }, "No cached Civitai data for this LoRA."));
      frag.append(h("div", { style: "text-align:center;margin-top:8px" },
        h("button", { class: "sl-btn", style: "flex:none;padding:6px 14px", onclick: async (e) => {
          const btn = e.target;
          btn.disabled = true; btn.textContent = "Fetching (hashing file)…";
          try {
            await fetchCivitai(loraName);
            btn.textContent = "Found! Reopening…";
            this._load(loraName);
          } catch (err) {
            btn.disabled = false;
            btn.textContent = String(err.message || err);
          }
        } }, "Fetch from Civitai by hash"),
      ));
      return frag;
    }
    frag.append(h("h4", {}, "Version data"));
    frag.append(h("div", { class: "sl-json" }, JSON.stringify(civ, null, 2)));
    frag.append(h("div", { style: "text-align:center;margin-top:8px" },
      h("button", { class: "sl-btn", style: "flex:none;padding:6px 14px", onclick: async (e) => {
        const btn = e.target;
        btn.disabled = true; btn.textContent = "Refreshing…";
        try {
          await fetchCivitai(loraName);
          this._load(loraName);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = String(err.message || err);
        }
      } }, "Re-fetch from Civitai"),
    ));
    return frag;
  }
}

/**
 * Themed replacements for prompt/confirm/alert.
 * All return Promises; Escape / backdrop click resolves like Cancel.
 */
export function showPrompt(title, placeholder = "", value = "") {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", class: "sl-dlg-input", placeholder, value });
    const done = (val) => { overlay.remove(); document.removeEventListener("keydown", esc); resolve(val); };
    const esc = (e) => { if (e.key === "Escape") done(null); };
    document.addEventListener("keydown", esc);
    const overlay = h("div", { class: "steaked-lora-modal", onclick: (e) => { if (e.target === overlay) done(null); } },
      h("div", { class: "sl-dlg-box" },
        h("div", { class: "sl-dlg-title" }, title),
        input,
        h("div", { class: "sl-dlg-btns" },
          h("button", { class: "sl-btn", onclick: () => done(null) }, "Cancel"),
          h("button", { class: "sl-btn sl-btn-primary", onclick: () => done(input.value) }, "OK"),
        ),
      ),
    );
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(input.value);
      e.stopPropagation();
    });
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

export function showConfirm(title, message = "") {
  return new Promise((resolve) => {
    const done = (val) => { overlay.remove(); document.removeEventListener("keydown", esc); resolve(val); };
    const esc = (e) => { if (e.key === "Escape") done(false); };
    document.addEventListener("keydown", esc);
    const overlay = h("div", { class: "steaked-lora-modal", onclick: (e) => { if (e.target === overlay) done(false); } },
      h("div", { class: "sl-dlg-box" },
        h("div", { class: "sl-dlg-title" }, title),
        message ? h("div", { class: "sl-dlg-msg" }, message) : null,
        h("div", { class: "sl-dlg-btns" },
          h("button", { class: "sl-btn", onclick: () => done(false) }, "Cancel"),
          h("button", { class: "sl-btn sl-btn-danger", onclick: () => done(true) }, "Confirm"),
        ),
      ),
    );
    document.body.appendChild(overlay);
  });
}

export function showAlert(title, message = "") {
  return new Promise((resolve) => {
    const done = () => { overlay.remove(); document.removeEventListener("keydown", esc); resolve(); };
    const esc = (e) => { if (e.key === "Escape") done(); };
    document.addEventListener("keydown", esc);
    const overlay = h("div", { class: "steaked-lora-modal", onclick: (e) => { if (e.target === overlay) done(); } },
      h("div", { class: "sl-dlg-box" },
        h("div", { class: "sl-dlg-title" }, title),
        message ? h("div", { class: "sl-dlg-msg" }, message) : null,
        h("div", { class: "sl-dlg-btns" },
          h("button", { class: "sl-btn sl-btn-primary", onclick: () => done() }, "OK"),
        ),
      ),
    );
    document.body.appendChild(overlay);
  });
}

/**
 * Searchable lora chooser. Returns a Promise<string|null> with the chosen
 * relative lora path (fuzzy-filtered over the full folder tree).
 */
export function showLoraChooser(anchorRect, currentLoras) {
  return new Promise((resolve) => {
    const el = h("div", { class: "sl-chooser" });
    const input = h("input", { type: "text", placeholder: "Search loras...", autofocus: "" });
    const list = h("div", { class: "sl-ch-list" });
    const empty = h("div", { class: "sl-ch-empty" }, "Loading lora list…");
    list.append(empty);
    el.append(input, list);
    document.body.appendChild(el);

    // Position near anchor, clamped to viewport
    const w = 420, hgt = Math.min(420, window.innerHeight - 20);
    let x = Math.min(anchorRect.left, window.innerWidth - w - 10);
    let y = anchorRect.bottom + 4;
    if (y + hgt > window.innerHeight - 10) y = Math.max(10, anchorRect.top - hgt - 4);
    el.style.left = `${Math.max(10, x)}px`;
    el.style.top = `${y}px`;

    let items = [];
    let filtered = [];
    let hl = 0;

    const close = (val) => { el.remove(); document.removeEventListener("mousedown", onDocDown, true); resolve(val); };
    const onDocDown = (e) => { if (!el.contains(e.target)) close(null); };
    document.addEventListener("mousedown", onDocDown, true);

    // Token-AND substring search: every space-separated token must appear in
    // the path. Filename hits rank above folder hits, prefixes above substrings.
    // Returns Infinity for no-match (scores are negative, so -1 would collide).
    const search = (query, path) => {
      const p = path.toLowerCase();
      const f = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.length) return 0;
      let score = 0;
      for (const t of tokens) {
        if (f === t) score -= 100;
        else if (f.startsWith(t)) score -= 15;
        else if (f.includes(t)) score -= 10;
        else if (p.includes(t)) score -= 2;
        else return Infinity;
      }
      return score;
    };

    const render = () => {
      list.replaceChildren();
      if (!filtered.length) {
        list.append(h("div", { class: "sl-ch-empty" }, "No matches."));
        return;
      }
      filtered.forEach(([path], i) => {
        const slash = path.lastIndexOf("/");
        const dir = slash > 0 ? path.slice(0, slash + 1) : "";
        const name = path.slice(slash + 1);
        const row = h("div", { class: "sl-ch-item" + (i === hl ? " hl" : ""), onclick: () => close(path) },
          dir ? h("span", { class: "sl-ch-dir" }, dir) : null, name);
        list.append(row);
      });
    };

    input.addEventListener("input", () => {
      const q = input.value.trim();
      if (!q) {
        filtered = items.filter(([p]) => !currentLoras.has(p)).slice(0, 200);
      } else {
        filtered = items
          .map(([p]) => [p, search(q, p)])
          .filter(([, s]) => s !== Infinity)
          .sort((a, b) => a[1] - b[1])
          .map(([p]) => [p])
          .slice(0, 200);
      }
      hl = 0;
      render();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(null);
      else if (e.key === "ArrowDown") { hl = Math.min(hl + 1, filtered.length - 1); render(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { hl = Math.max(hl - 1, 0); render(); e.preventDefault(); }
      else if (e.key === "Enter" && filtered[hl]) close(filtered[hl][0]);
    });

    import("./api.js").then(({ getLoras }) =>
      getLoras().then((loras) => {
        items = loras.map((p) => [p]);
        filtered = items.filter(([p]) => !currentLoras.has(p)).slice(0, 200);
        render();
        input.focus();
      }).catch((e) => {
        list.replaceChildren(h("div", { class: "sl-ch-empty" }, String(e.message || e)));
      }),
    );
  });
}
