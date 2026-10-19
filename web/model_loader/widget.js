/**
 * The DOM widget for the Smart Model Loader node.
 *
 * State model (serialized into the node's `model_state` JSON widget):
 * {
 *   name: "path/to/model.safetensors",
 *   folder: "checkpoints" | "diffusion_models",
 *   type: "checkpoint" | "diffusion..." | "unknown",  // detected at pick time
 *   clipName: "" | "text encoder name",               // "" = baked in
 *   vaeName: "" | "vae file name",                    // "" = baked in
 *   weight_dtype: "default" | "fp8_...",
 * }
 */

import { getModels, getVaes, getClips } from "./api.js";
import { showModelChooser, showOverrideChooser, ModelInfoModal } from "./dialogs.js";
import { forwardCanvasEvents } from "../common/canvas_forward.js";

const OVERRIDE_MEM_KEY = "steaked.modelLoader.overrides";

function loadOverrideMemory() {
  try {
    const raw = localStorage.getItem(OVERRIDE_MEM_KEY);
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveOverrideMemory(mem) {
  try {
    localStorage.setItem(OVERRIDE_MEM_KEY, JSON.stringify(mem));
  } catch {
  }
}

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

export class ModelLoaderWidget {
  constructor(node, stateWidget, hiddenWidgets = {}) {
    this.node = node;
    this.stateWidget = stateWidget;
    this.hiddenWidgets = hiddenWidgets;
    this.state = { name: "", folder: "checkpoints", type: "checkpoint", clipName: "", vaeName: "", weight_dtype: "default" };
    this.models = [];
    this._suppressSync = false;

    this._buildDom();
    this._loadState();
    this._loadModels();
  }

  // ── State persistence ───────────────────────────────────────────────────

  _loadState() {
    try {
      const raw = this.stateWidget.value;
      const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
      if (parsed && typeof parsed === "object") this.state = { ...this.state, ...parsed };
    } catch (e) {
      console.warn("[SteakedModelLoader] Bad state JSON, resetting:", e);
    }
    this._suppressSync = true;
    this.render();
    this._suppressSync = false;
  }

  _syncWidget() {
    if (this._suppressSync) return;
    this.stateWidget.value = JSON.stringify(this.state);
    if (this.hiddenWidgets.clip_name) this.hiddenWidgets.clip_name.value = this.state.clipName || "<from model>";
    if (this.hiddenWidgets.vae_name) this.hiddenWidgets.vae_name.value = this.state.vaeName || "<from model>";
    if (this.hiddenWidgets.weight_dtype) this.hiddenWidgets.weight_dtype.value = this.state.weight_dtype || "default";
    this.node.setDirtyCanvas?.(true, true);
  }

  async _loadModels() {
    try {
      this.models = await getModels();
    } catch (e) {
      console.warn("[SteakedModelLoader] Could not load model list:", e);
    }
    this.render();
  }

  _findModel(name) {
    return this.models.find((m) => m.name === name) ?? null;
  }

  get hasClip() {
    const m = this.state.name ? this._findModel(this.state.name) : null;
    if (m) return m.type === "checkpoint" || m.type.includes("clip");
    return this.state.type === "checkpoint";
  }

  get hasVae() {
    const m = this.state.name ? this._findModel(this.state.name) : null;
    if (m) return m.type === "checkpoint" || m.type.includes("vae");
    return this.state.type === "checkpoint";
  }

  // ── DOM construction ────────────────────────────────────────────────────

  _buildDom() {
    this.el = h("div", { class: "steaked-model-widget" });
    this.headerEl = h("div", { class: "sm-header" });
    this.bodyEl = h("div", { class: "sm-body" });
    this.el.append(this.headerEl, this.bodyEl);

    this._detachForward = forwardCanvasEvents(this.el, { allWheel: true });
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  render() {
    this.renderHeader();
    this.renderBody();
  }

  renderHeader() {
    this.headerEl.replaceChildren();

    if (!this.state.name) {
      this.headerEl.append(
        h("div", {
          class: "sm-model-pick sm-empty",
          title: "Click to pick a model",
          onclick: (e) => this._pickModel(e),
        },
          h("span", { class: "sm-model-name" },
            this.models.length ? "Click to select a model..." : "Loading models..."),
        ),
      );
      return;
    }

    const model = this._findModel(this.state.name);
    const slash = this.state.name.lastIndexOf("/");
    const dir = slash > 0 ? this.state.name.slice(0, slash + 1) : "";
    const name = this.state.name.slice(slash + 1);
    const type = model?.type ?? this.state.type;

    this.headerEl.append(
      h("div", {
        class: "sm-model-pick has-model",
        title: this.state.name,
        onclick: (e) => this._pickModel(e),
      },
        dir ? h("span", { class: "sm-model-dir" }, dir) : null,
        h("span", { class: "sm-model-name" }, name),
        h("span", {
          class: "sm-model-type " + (type.startsWith("diffusion") ? "sm-type-diff" : "sm-type-ckpt"),
          title: this.state.folder,
        }, type.startsWith("diffusion") ? "diffusion" : "checkpoint"),
        h("span", {
          class: "sm-model-info",
          title: "Model info",
          onclick: (e) => { e.stopPropagation(); this._showInfo(); },
        }, "ℹ"),
      ),
    );
  }

  renderBody() {
    this.bodyEl.replaceChildren();
    if (!this.state.name) return;

    this.bodyEl.append(
      this._renderRow("CLIP", this.state.clipName, this.hasClip, "clip"),
      this._renderRow("VAE", this.state.vaeName, this.hasVae, "vae"),
      this._renderRow("DTYPE", this.state.weight_dtype !== "default" ? this.state.weight_dtype : "", true, "dtype"),
    );
  }

  _renderRow(label, value, bakedIn, kind) {
    const isDtype = kind === "dtype";
    const missing = !isDtype && !bakedIn && !value;
    return h("div", { class: "sm-row" + (missing ? " sm-row-missing" : "") },
      h("span", { class: "sm-row-label" }, label),
      h("div", {
        class: "sm-row-value" + (value ? " overridden" : "") + (missing ? " sm-missing" : ""),
        title: value
          ? (isDtype ? "Weight dtype" : `Override: ${value} (click to change)`)
          : missing
            ? "Not included in this model - click to select an override"
            : isDtype ? "Weight dtype (click to change)" : "Baked into the model (click to override)",
        onclick: (e) => this._pickOverride(e, kind),
      },
        value || (missing ? "required - click to set" : isDtype ? "default" : "baked in")),
    );
  }

  // ── Interactions ────────────────────────────────────────────────────────

  async _pickModel(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!this.models.length) {
      try {
        this.models = await getModels();
      } catch (err) {
        console.warn("[SteakedModelLoader] Could not load models:", err);
        return;
      }
    }
    const chosen = await showModelChooser({ top: rect.top, bottom: rect.bottom, left: rect.left }, this.models);
    if (!chosen) return;
    this._selectModel(chosen.name, chosen.folder ?? "checkpoints", chosen.type ?? "checkpoint");
  }

  _selectModel(name, folder, type) {
    // Remember overrides for the model we're leaving
    if (this.state.name) this._rememberOverrides();

    this.state = { ...this.state, name, folder, type };

    // Restore last-used overrides for the new model (or clear if none saved)
    const mem = loadOverrideMemory();
    const saved = mem[name];
    this.state.clipName = saved?.clipName ?? "";
    this.state.vaeName = saved?.vaeName ?? "";
    this._syncWidget();
    this.render();
  }

  _rememberOverrides() {
    if (!this.state.name) return;
    const mem = loadOverrideMemory();
    if (this.state.clipName || this.state.vaeName) {
      mem[this.state.name] = {
        clipName: this.state.clipName || "",
        vaeName: this.state.vaeName || "",
      };
    } else {
      delete mem[this.state.name];
    }
    saveOverrideMemory(mem);
  }

  async _pickOverride(e, kind) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const anchor = { top: rect.top, bottom: rect.bottom, left: rect.left };

    let chosen;
    if (kind === "dtype") {
      chosen = await showOverrideChooser(anchor, ["fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"], "dtype");
    } else {
      let list;
      try {
        list = kind === "vae" ? await getVaes() : await getClips();
      } catch (err) {
        console.warn("[SteakedModelLoader] Could not list overrides:", err);
        return;
      }
      chosen = await showOverrideChooser(anchor, list, kind);
    }
    if (chosen === null || chosen === undefined) return;

    if (kind === "vae") this.state.vaeName = chosen;
    else if (kind === "clip") this.state.clipName = chosen;
    else this.state.weight_dtype = chosen || "default";
    if (kind !== "dtype") this._rememberOverrides();
    this._syncWidget();
    this.render();
  }

  _showInfo() {
    const model = this._findModel(this.state.name) ?? { ...this.state, metadata: {} };
    this._infoModal?.close();
    this._infoModal = new ModelInfoModal(async () => {
      const { fetchModelCivitai } = await import("./api.js");
      await fetchModelCivitai(this.state.name, this.state.folder);
      try {
        this.models = await getModels();
      } catch (e) {
        console.warn("[SteakedModelLoader] Could not reload model list:", e);
      }
      this.render();
      return this._findModel(this.state.name);
    });
    this._infoModal.open(model);
  }
}
