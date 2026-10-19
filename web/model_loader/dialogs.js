/**
 * Chooser + info dialogs for the Smart Model Loader.
 * Reuses the Combo Lora Loader's sl-chooser / sl-modal CSS
 */

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

function searchModels(query, model) {
  const p = model.name.toLowerCase();
  const f = model.name.slice(model.name.lastIndexOf("/") + 1).toLowerCase();
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
}

export function showModelChooser(anchor, models) {
  return new Promise((resolve) => {
    if (!models.length) {
      resolve(null);
      return;
    }
    const el = h("div", { class: "sl-chooser sm-chooser" });
    const input = h("input", { type: "text", placeholder: "Search models..." });
    const list = h("div", { class: "sl-ch-list" });
    el.append(input, list);
    document.body.appendChild(el);

    const w = 480, hgt = Math.min(460, window.innerHeight - 20);
    let x = Math.min(anchor.left, window.innerWidth - w - 10);
    let y = anchor.bottom + 4;
    if (y + hgt > window.innerHeight - 10) y = Math.max(10, anchor.top - hgt - 4);
    el.style.left = `${Math.max(10, x)}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;

    let filtered = [...models];
    let hl = 0;

    const close = (val) => { el.remove(); document.removeEventListener("pointerdown", onDocDown, true); resolve(val); };
    const onDocDown = (e) => { if (!el.contains(e.target)) close(null); };
    document.addEventListener("pointerdown", onDocDown, true);

    const setHl = (idx) => {
      hl = idx;
      list.querySelectorAll(".sl-ch-item").forEach((n, i) => n.classList.toggle("hl", i === hl));
    };

    const render = () => {
      list.replaceChildren();
      if (!filtered.length) {
        list.append(h("div", { class: "sl-ch-empty" }, "No matches."));
        return;
      }
      filtered.slice(0, 200).forEach((m, i) => {
        const slash = m.name.lastIndexOf("/");
        const dir = slash > 0 ? m.name.slice(0, slash + 1) : "";
        const isDiff = (m.type ?? "").startsWith("diffusion");
        list.append(h("div", {
          class: "sl-ch-item" + (i === hl ? " hl" : ""),
          onclick: () => close(m),
          onmouseenter: (e) => { if (hl !== i) setHl(i); },
        },
          dir ? h("span", { class: "sl-ch-dir" }, dir) : null,
          h("span", { class: "sm-ch-name" }, m.name.slice(slash + 1)),
          h("span", { class: "sm-ch-type " + (isDiff ? "sm-type-diff" : "sm-type-ckpt") },
            isDiff ? "diffusion" : "ckpt"),
        ));
      });
    };

    input.addEventListener("input", () => {
      const q = input.value.trim();
      if (!q) {
        filtered = [...models];
      } else {
        filtered = models
          .map((m) => [m, searchModels(q, m)])
          .filter(([, s]) => s !== Infinity)
          .sort((a, b) => a[1] - b[1])
          .map(([m]) => m);
      }
      hl = 0;
      render();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(null);
      else if (e.key === "ArrowDown") { setHl(Math.min(hl + 1, Math.min(filtered.length, 200) - 1)); e.preventDefault(); }
      else if (e.key === "ArrowUp") { setHl(Math.max(hl - 1, 0)); e.preventDefault(); }
      else if (e.key === "Enter" && filtered[hl]) close(filtered[hl]);
    });

    render();
    input.focus();
  });
}

export function showOverrideChooser(anchor, list, kind) {
  return new Promise((resolve) => {
    const el = h("div", { class: "sl-chooser sm-chooser" });
    const input = h("input", { type: "text", placeholder: `Search ${kind}...` });
    const listEl = h("div", { class: "sl-ch-list" });
    el.append(input, listEl);
    document.body.appendChild(el);

    const w = 420, hgt = Math.min(380, window.innerHeight - 20);
    let x = Math.min(anchor.left, window.innerWidth - w - 10);
    let y = anchor.bottom + 4;
    if (y + hgt > window.innerHeight - 10) y = Math.max(10, anchor.top - hgt - 4);
    el.style.left = `${Math.max(10, x)}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;

    let filtered = [...list];
    let hl = 0; // 0 = baked-in reset row, 1.. = items

    const close = (val) => { el.remove(); document.removeEventListener("pointerdown", onDocDown, true); resolve(val); };
    const onDocDown = (e) => { if (!el.contains(e.target)) close(null); };
    document.addEventListener("pointerdown", onDocDown, true);

    const setHl = (idx) => {
      hl = idx;
      listEl.querySelectorAll(".sl-ch-item").forEach((n, i) => n.classList.toggle("hl", i === hl));
    };

    const render = () => {
      listEl.replaceChildren();
      listEl.append(h("div", {
        class: "sl-ch-item sm-reset" + (hl === 0 ? " hl" : ""),
        onclick: () => close(""),
        onmouseenter: () => { if (hl !== 0) setHl(0); },
      }, "< use baked in / default >"));
      filtered.slice(0, 200).forEach((name, i) => {
        listEl.append(h("div", {
          class: "sl-ch-item" + (i + 1 === hl ? " hl" : ""),
          onclick: () => close(name),
          onmouseenter: () => { if (hl !== i + 1) setHl(i + 1); },
        }, name));
      });
    };

    const applyFilter = () => {
      const q = input.value.trim().toLowerCase();
      filtered = q ? list.filter((n) => n.toLowerCase().includes(q)) : [...list];
      hl = 0;
      render();
    };

    input.addEventListener("input", applyFilter);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(null);
      else if (e.key === "ArrowDown") { setHl(Math.min(hl + 1, filtered.length)); e.preventDefault(); }
      else if (e.key === "ArrowUp") { setHl(Math.max(hl - 1, 0)); e.preventDefault(); }
      else if (e.key === "Enter") {
        if (hl === 0) close("");
        else if (filtered[hl - 1]) close(filtered[hl - 1]);
      }
    });

    render();
    input.focus();
  });
}

function copyText(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function chip(text, title) {
  return h("span", { class: "sl-chip", title: title || "Click to copy", onclick: () => copyText(text) }, text);
}

function kv(pairs) {
  const grid = h("div", { class: "sl-kv-grid" });
  for (const [k, v] of pairs) {
    if (v === null || v === undefined || v === "") continue;
    grid.append(h("div", { class: "sl-kv-k" }, k), h("div", { class: "sl-kv-v" }, v));
  }
  return grid;
}

function civLink(civ, label) {
  const a = h("a", {
    href: `https://civitai.com/models/${civ.modelId}?modelVersionId=${civ.id ?? ""}`,
    target: "_blank",
  });
  a.textContent = label;
  return a;
}

/**
 * Lora-info-style modal for models. Tabs: Overview / Civitai / Raw JSON.
 * The Civitai tab doubles as the fetch entry point when no sidecar exists.
 */
export class ModelInfoModal {
  constructor(onFetch) {
    this.el = null;
    this.onFetch = onFetch;
  }

  open(model) {
    this.close();
    this.model = model;
    this.el = h("div", { class: "steaked-lora-modal", onclick: (e) => { if (e.target === this.el) this.close(); } },
      h("div", { class: "sl-modal-box" },
        h("div", { class: "sl-modal-header" },
          h("span", { class: "sl-modal-title" }, (model?.name ?? "").split("/").pop() || "Model"),
          h("button", { class: "sl-modal-close", onclick: () => this.close() }, "✕"),
        ),
        h("div", { class: "sl-modal-body" },
          h("div", { class: "sl-loading" }, "Loading model info…"),
        ),
      ),
    );
    document.body.appendChild(this.el);
    const esc = (e) => { if (e.key === "Escape") { this.close(); document.removeEventListener("keydown", esc); } };
    document.addEventListener("keydown", esc);
    this._render();
  }

  close() {
    this.el?.remove();
    this.el = null;
  }

  async refresh() {
    if (!this.onFetch) return null;
    try {
      return await this.onFetch();
    } catch (err) {
      console.warn("[SteakedModelLoader] Fetch failed:", err);
      return null;
    }
  }

  async _render() {
    const model = this.model ?? {};
    const civ = model.civitai ?? null;
    const meta = model.metadata ?? {};

    const content = h("div", { class: "sl-modal-content" });
    const tabs = civ ? [["overview", "Overview"], ["civitai", "Civitai"], ["raw", "Raw JSON"]] : [["overview", "Overview"]];
    const tabEls = {};
    const tabStrip = h("div", { class: "sl-modal-tabs" });
    for (const [id, label] of tabs) {
      tabEls[id] = h("div", {
        class: "sl-mt" + (id === "overview" ? " active" : ""),
        onclick: () => {
          tabStrip.querySelectorAll(".sl-mt").forEach((t) => t.classList.remove("active"));
          tabEls[id].classList.add("active");
          this._showTab(id, content, model, meta, civ);
        },
      }, label);
      tabStrip.append(tabEls[id]);
    }
    this.el.querySelector(".sl-modal-body").replaceChildren(tabStrip, content);
    this._showTab("overview", content, model, meta, civ);
  }

  _showTab(id, content, model, meta, civ) {
    const renderers = {
      overview: () => this._renderOverview(model, meta, civ),
      civitai: () => this._renderCivitai(model, civ),
      raw: () => h("div", { class: "sl-json" }, JSON.stringify({ model, metadata: meta, civitai: civ }, null, 2)),
    };
    content.replaceChildren(renderers[id]());
    content.scrollTop = 0;
  }

  _showImageMeta(img) {
    const meta = img.meta || {};
    const content = this.el.querySelector(".sl-modal-content");
    const frag = document.createDocumentFragment();

    frag.append(h("h4", {}, "Preview"));
    frag.append(h("div", { style: "text-align:center" },
      h("img", {
        src: img.url,
        style: "max-width:100%;max-height:280px;border-radius:2px;object-fit:contain;cursor:pointer",
        title: "Open full image on Civitai",
        onclick: () => window.open(img.url, "_blank"),
      })));

    if (meta.prompt) {
      frag.append(h("h4", {}, "Prompt (click to copy)"));
      frag.append(h("div", {
        class: "sl-json", style: "cursor:pointer",
        onclick: () => copyText(meta.prompt), title: "Click to copy",
      }, meta.prompt));
    }
    if (meta.negativePrompt) {
      frag.append(h("h4", {}, "Negative prompt (click to copy)"));
      frag.append(h("div", {
        class: "sl-json", style: "cursor:pointer",
        onclick: () => copyText(meta.negativePrompt), title: "Click to copy",
      }, meta.negativePrompt));
    }

    frag.append(h("h4", {}, "Generation settings"));
    frag.append(kv([
      ["Model", meta.Model],
      ["Sampler", meta.sampler],
      ["Steps", meta.steps],
      ["CFG", meta.cfgScale],
      ["Seed", meta.seed],
      ["Scheduler", meta.scheduler],
      ["VAE", Array.isArray(meta.vaes) ? meta.vaes.join(", ") : null],
    ]));

    if (!meta.prompt && !meta.negativePrompt && !meta.Model) {
      frag.append(h("div", { class: "sl-loading" }, "This image has no generation metadata on Civitai."));
    }
    content.replaceChildren(frag);
    content.scrollTop = 0;
  }

  _renderOverview(model, meta, civ) {
    const frag = document.createDocumentFragment();

    if (civ?.images?.length) {
      frag.append(h("h4", {}, "Previews (click for generation info)"));
      const grid = h("div", { class: "sl-preview-grid" });
      for (const img of civ.images.slice(0, 6)) {
        if (!img?.url) continue;
        grid.append(h("img", {
          src: img.url, loading: "lazy",
          title: img.meta ? "Click to view prompt & settings" : "Click to open on Civitai",
          onclick: () => (img.meta ? this._showImageMeta(img) : window.open(img.url, "_blank")),
        }));
      }
      if (grid.children.length) frag.append(grid);
    }

    frag.append(h("h4", {}, "Identity"));
    frag.append(kv([
      ["File", model.name],
      ["Folder", model.folder],
      ["Contains", model.type],
      ["Civitai model", civ?.model?.name],
      ["Version", civ?.name],
      ["Base model", civ?.baseModel],
      ["Type", civ?.model?.type],
      ["Creator", civ?.model?.creator?.username],
      ["Downloads", civ?.stats?.downloadCount?.toLocaleString?.()],
      ["Likes", civ?.stats?.thumbsUpCount?.toLocaleString?.()],
      ["NSFW level", civ?.nsfwLevel],
      ["Civitai link", civ ? civLink(civ, `models/${civ.modelId}`) : null],
    ]));

    if (civ?.trainedWords?.length) {
      frag.append(h("h4", {}, "Activation words (click to copy)"));
      const chips = h("div", { class: "sl-chips" });
      for (const tw of civ.trainedWords) chips.append(chip(tw?.word ?? String(tw)));
      frag.append(chips);
    }

    if (civ?.description) {
      frag.append(h("h4", {}, "Description"));
      const box = h("div", { class: "sl-json", style: "max-height:180px;user-select:text" });
      box.innerHTML = civ.description; // civitai descriptions are HTML
      frag.append(box);
    } else if (meta.ss_base_model_version) {
      frag.append(h("h4", {}, "Training"));
      frag.append(kv([
        ["Trained from", meta.ss_base_model_version],
        ["Train images", meta.ss_num_train_images],
      ]));
    } else if (!civ) {
      frag.append(h("h4", {}, "No civitai data yet"));
      frag.append(h("div", { style: "text-align:center" },
        h("button", { class: "sl-btn", style: "padding:6px 14px", onclick: (e) => this._fetch(e) }, "Fetch from Civitai by hash"),
      ));
      frag.append(h("div", { class: "sl-loading", style: "margin-top:6px" }, "Hashes the file (can take a few seconds for large models), then looks it up on Civitai."));
    }

    return frag;
  }

  async _fetch(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Fetching (hashing file)…";
    const fresh = await this.refresh();
    if (fresh) {
      this.model = fresh;
      this._render();
    } else {
      btn.disabled = false;
      btn.textContent = "Not found on Civitai / failed";
      setTimeout(() => { btn.textContent = "Fetch from Civitai by hash"; }, 2500);
    }
  }

  _renderCivitai(model, civ) {
    const frag = document.createDocumentFragment();
    frag.append(h("h4", {}, "Version data"));
    frag.append(h("div", { class: "sl-json" }, JSON.stringify(civ, null, 2)));
    frag.append(h("div", { style: "text-align:center;margin-top:8px" },
      h("button", { class: "sl-btn", style: "padding:6px 14px", onclick: (e) => this._fetch(e) }, "Re-fetch from Civitai"),
    ));
    return frag;
  }
}
