/**
 * The DOM widget for the Combo Lora Loader node.
 *
 * State model (serialized into the node's `lora_stack` JSON widget):
 * {
 *   active: "free" | comboId,
 *   free: [entry...],
 *   combo: { id, name, entries: [entry...] } | null   // snapshot of active combo
 * }
 * entry = { lora, on, strength, clipStrength }
 */

import { getCombos, saveCombos } from "./api.js";
import {
  LoraInfoModal,
  showLoraChooser,
  extractActivationWords,
  showPrompt,
  showConfirm,
  showAlert,
} from "./dialogs.js";

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

const MAX_ROWS = 8;

export class LoraLoaderWidget {
  constructor(node, stackWidget) {
    this.node = node;
    this.stackWidget = stackWidget;
    this.state = { active: "free", free: [], combo: null };
    this.selected = new Set();
    this.combosDoc = { folders: [] };
    this.modal = new LoraInfoModal();
    this._dragState = null;
    this._suppressSync = false;

    this._buildDom();
    this._loadState();
    this._loadCombos();
  }

  // ── State persistence ───────────────────────────────────────────────────

  get entries() {
    if (this.state.active === "free") return this.state.free;
    return this.state.combo?.entries ?? [];
  }

  _loadState() {
    try {
      const raw = this.stackWidget.value;
      const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
      if (parsed && typeof parsed === "object") {
        this.state = {
          active: parsed.active ?? "free",
          free: Array.isArray(parsed.free) ? parsed.free : [],
          combo: parsed.combo ?? null,
        };
      }
    } catch (e) {
      console.warn("[SteakedLoraLoader] Bad stack JSON, resetting:", e);
    }
    this._suppressSync = true;
    this.render();
    this._suppressSync = false;
  }

  _syncWidget() {
    if (this._suppressSync) return;
    this.stackWidget.value = JSON.stringify(this.state);
    this.node.setDirtyCanvas?.(true, true);
  }

  async _loadCombos() {
    try {
      this.combosDoc = await getCombos();
    } catch (e) {
      console.warn("[SteakedLoraLoader] Could not load combos:", e);
    }
    this.renderTabs();
    this._checkSync();
  }

  _findCombo(id) {
    for (const folder of this.combosDoc.folders) {
      for (const combo of folder.combos ?? []) {
        if (combo.id === id) return { folder, combo };
      }
    }
    return null;
  }

  _checkSync() {
    const note = this.el?.querySelector(".sl-sync-note");
    if (note) note.remove();
    if (this.state.active === "free" || !this.state.combo) return;
    const found = this._findCombo(this.state.combo.id);
    if (!found) {
      this._showSyncNote("Shared combo was deleted (using snapshot)");
      return;
    }
    const a = JSON.stringify(this.state.combo.entries ?? []);
    const b = JSON.stringify(found.combo.entries ?? []);
    if (a !== b) this._showSyncNote("⟳ Shared combo changed - click to re-sync");
  }

  _showSyncNote(text) {
    if (!this.tabsEl) return;
    const note = h("div", { class: "sl-sync-note", title: text, onclick: () => this._resyncCombo() }, text);
    this.tabsEl.parentElement.insertBefore(note, this.tabsEl.nextSibling);
  }

  _resyncCombo() {
    if (this.state.active === "free" || !this.state.combo) return;
    const found = this._findCombo(this.state.combo.id);
    if (!found) return;
    this.state.combo = { id: found.combo.id, name: found.combo.name, entries: JSON.parse(JSON.stringify(found.combo.entries ?? [])) };
    this.selected.clear();
    this._syncWidget();
    this.render();
  }

  // ── DOM construction ────────────────────────────────────────────────────

  _buildDom() {
    this.el = h("div", { class: "steaked-lora-widget" });
    this.tabsEl = h("div", { class: "steaked-lora-tabs" });
    this.rowsEl = h("div", { class: "steaked-lora-rows" });
    this.dropEl = h("div", { class: "sl-dropzone" }, "Drop .safetensors files here to add");
    this.footerEl = h("div", { class: "sl-footer" });

    this.el.append(this.tabsEl, this.rowsEl, this.dropEl, this.footerEl);

    this.dropEl.addEventListener("dragover", (e) => { e.preventDefault(); this.dropEl.classList.add("drag-over"); });
    this.dropEl.addEventListener("dragleave", () => this.dropEl.classList.remove("drag-over"));
    this.dropEl.addEventListener("drop", (e) => {
      e.preventDefault();
      this.dropEl.classList.remove("drag-over");
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.name.endsWith(".safetensors"));
      for (const f of files) {
        this._addByFilename(f.name);
      }
    });
  }

  _addByFilename(filename) {
    import("./api.js").then(({ getLoras }) =>
      getLoras().then((loras) => {
        const base = filename.replace(/\.safetensors$/i, "");
        const match = loras.find((p) => p === filename) ??
          loras.find((p) => p.endsWith("/" + filename)) ??
          loras.find((p) => p.split("/").pop()?.replace(/\.safetensors$/i, "") === base);
        if (match) {
          this.addEntry({ lora: match, on: true, strength: 1 });
        } else {
          console.warn(`[SteakedLoraLoader] Dropped file not in loras folder: ${filename}`);
        }
      }),
    );
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  render() {
    this.renderTabs();
    this.renderRows();
    this.renderFooter();
    this._checkSync();
  }

  renderTabs() {
    this.tabsEl.replaceChildren();

    const freeTab = h("div", {
      class: "sl-tab" + (this.state.active === "free" ? " active" : ""),
      onclick: () => this._activateTab("free"),
    }, "Free", h("span", { class: "sl-tab-badge" }, String(this.state.free.length)));
    this.tabsEl.append(freeTab);

    let comboTabLabel = "Combos";
    if (this.state.active !== "free" && this.state.combo) {
      comboTabLabel = this.state.combo.name || "Combo";
    }
    const comboTab = h("div", {
      class: "sl-tab" + (this.state.active !== "free" ? " active" : ""),
      onclick: (e) => this._openComboMenu(e),
    }, comboTabLabel, " ▾");
    this.tabsEl.append(comboTab);

    const addTab = h("div", { class: "sl-tab-add", title: "Save current stack as a new combo", onclick: () => this._saveAsCombo() }, "+ Save combo");
    this.tabsEl.append(addTab);
  }

  renderRows() {
    this.rowsEl.replaceChildren();
    const entries = this.entries;
    this.selected = new Set([...this.selected].filter((i) => i < entries.length));

    if (!entries.length) {
      this.rowsEl.append(h("div", { style: "padding:10px;color:#666;font-size:11px;text-align:center" },
        this.state.active === "free" ? "No loras. Add one below or drop a file." : "This combo is empty."));
    }

    entries.forEach((entry, i) => {
      this.rowsEl.append(this._renderRow(entry, i));
    });
    if (entries.length > MAX_ROWS) this.rowsEl.scrollTop = this.rowsEl.scrollHeight;
  }

  _renderRow(entry, i) {
    const slash = entry.lora.lastIndexOf("/");
    const dir = slash > 0 ? entry.lora.slice(0, slash + 1) : "";
    const name = entry.lora.slice(slash + 1);

    const row = h("div", {
      class: "sl-row" + (this.selected.has(i) ? " selected" : ""),
      "data-idx": String(i),
    },
      h("div", {
        class: "sl-row-toggle" + (entry.on ? " on" : ""),
        title: entry.on ? "Disable" : "Enable",
        onclick: (e) => { e.stopPropagation(); entry.on = !entry.on; this._syncWidget(); this.renderRows(); },
      }),
      h("div", { class: "sl-row-name", title: entry.lora },
        dir ? h("span", { class: "sl-name-dir" }, dir) : null, name),
      h("div", { class: "sl-row-badges" },
        h("span", { class: "sl-badge sl-badge-words", title: "Activation words (click to copy)", onclick: (e) => this._copyWords(e, entry) }, "Aa"),
        h("span", { class: "sl-badge sl-badge-info", title: "LoRA info", onclick: (e) => { e.stopPropagation(); this.modal.open(entry.lora); } }, "ℹ"),
      ),
      h("div", {
        class: "sl-strength" + (entry.on ? "" : " sl-strength-off"),
        title: "Strength (drag to adjust, double-click to type)",
        onmousedown: (e) => this._scrubStart(e, entry),
        ondblclick: (e) => this._strengthEdit(e, entry),
      }, this._fmtStrength(entry.strength ?? 1)),
    );

    row.addEventListener("mousedown", (e) => this._onRowMouseDown(e, row, i));
    return row;
  }

  renderFooter() {
    this.footerEl.replaceChildren();
    const selCount = this.selected.size;

    this.footerEl.append(
      h("button", { class: "sl-btn", onclick: (e) => this._addLora(e) }, "+ Add"),
      h("button", { class: "sl-btn", disabled: selCount ? null : "", onclick: () => this._deleteSelected() },
        selCount ? `Remove ${selCount}` : "Remove"),
      h("button", { class: "sl-btn", onclick: () => this._toggleOnOff() },
        selCount ? `On/Off ${selCount} selected` : "On/Off all"),
    );

    if (this.state.active !== "free" && this.state.combo) {
      this.footerEl.append(
        h("button", { class: "sl-btn", title: "Write edits back to the shared combo", onclick: () => this._saveComboEdits() }, "Save to combo"),
      );
    }
  }

  // ── Row interaction: selection + drag ───────────────────────────────────

  _onRowMouseDown(e, row, i) {
    if (e.target.closest("input, .sl-row-toggle, .sl-badge")) return;
    e.preventDefault();

    // Selection logic
    if (e.ctrlKey || e.metaKey) {
      this.selected.has(i) ? this.selected.delete(i) : this.selected.add(i);
    } else if (e.shiftKey && this._lastClicked !== undefined) {
      const [a, b] = [Math.min(this._lastClicked, i), Math.max(this._lastClicked, i)];
      this.selected = new Set([...Array(b - a + 1)].map((_, k) => a + k));
    } else if (!this.selected.has(i)) {
      this.selected = new Set([i]);
    }
    this._lastClicked = i;
    this.renderRows();
    this.renderFooter();

    const startX = e.clientX, startY = e.clientY;
    const dragIndices = [...this.selected];
    const onMove = (ev) => {
      if (!this._dragState && (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4)) {
        this._startDrag(dragIndices, ev);
      }
      this._updateDrag(ev);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (this._dragState) this._finishDrag();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  _startDrag(indices, ev) {
    this._dragState = { indices };
    for (const el of this.rowsEl.children) {
      const idx = Number(el.dataset.idx);
      if (indices.includes(idx)) el.classList.add("dragging");
    }
  }

  _updateDrag(ev) {
    if (!this._dragState) return;
    for (const el of this.rowsEl.children) {
      el.classList.remove("drag-over-top", "drag-over-bot");
      const r = el.getBoundingClientRect();
      if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
        const idx = Number(el.dataset.idx);
        if (this._dragState.indices.includes(idx)) continue;
        el.classList.add(ev.clientY < r.top + r.height / 2 ? "drag-over-top" : "drag-over-bot");
      }
    }
  }

  _finishDrag() {
    const drag = this._dragState;
    this._dragState = null;
    if (!drag) return;

    let targetIdx = -1, before = false;
    for (const el of this.rowsEl.children) {
      if (el.classList.contains("drag-over-top")) { targetIdx = Number(el.dataset.idx); before = true; break; }
      if (el.classList.contains("drag-over-bot")) { targetIdx = Number(el.dataset.idx); before = false; break; }
    }
    this.renderRows();
    if (targetIdx === -1) return;

    const entries = this.entries;
    const moving = drag.indices.filter((i) => i < entries.length).map((i) => entries[i]);
    const remaining = entries.filter((_, i) => !drag.indices.includes(i));

    let insertAt = remaining.length;
    const targetEntry = entries[targetIdx];
    const remIdx = remaining.indexOf(targetEntry);
    if (remIdx !== -1) insertAt = before ? remIdx : remIdx + 1;

    remaining.splice(insertAt, 0, ...moving);
    this._setEntries(remaining);

    this.selected = new Set(moving.map((m) => remaining.indexOf(m)));
    this._syncWidget();
    this.renderRows();
    this.renderFooter();
  }

  _setEntries(newEntries) {
    if (this.state.active === "free") this.state.free = newEntries;
    else if (this.state.combo) this.state.combo.entries = newEntries;
  }

  _fmtStrength(v) {
    return (Math.round(v * 100) / 100).toFixed(2).replace(/0$/, "").replace(/\.$/, ".0");
  }

  _scrubStart(e, entry) {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startVal = Number(entry.strength ?? 1);
    const rowEl = e.target.closest(".sl-row");
    const onMove = (ev) => {
      // 200px = 1.0 strength, with Ctrl for fine mode (800px = 1.0)
      const scale = ev.ctrlKey || ev.metaKey ? 800 : 200;
      let v = startVal + (ev.clientX - startX) / scale;
      v = Math.round(v * 20) / 20; // snap to 0.05
      v = Math.min(4, Math.max(-2, v));
      if (v !== entry.strength) {
        entry.strength = v;
        const el = rowEl?.querySelector(".sl-strength");
        if (el) el.textContent = this._fmtStrength(v);
        this._syncWidget();
      }
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  _strengthEdit(e, entry) {
    e.stopPropagation();
    const el = e.target;
    const input = h("input", {
      class: "sl-strength-input", type: "text", value: String(entry.strength ?? 1),
    });
    el.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const v = parseFloat(input.value);
      if (isFinite(v)) entry.strength = Math.min(4, Math.max(-2, v));
      this._syncWidget();
      this.renderRows();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") input.blur();
      if (ev.key === "Escape") { input.value = String(entry.strength ?? 1); input.blur(); }
      ev.stopPropagation();
    });
    input.addEventListener("mousedown", (ev) => ev.stopPropagation());
  }

  _deleteSelected() {
    if (!this.selected.size) return;
    this._setEntries(this.entries.filter((_, i) => !this.selected.has(i)));
    this.selected.clear();
    this._lastClicked = undefined;
    this._syncWidget();
    this.render();
  }

  _toggleOnOff() {
    const entries = this.entries;
    const indices = this.selected.size ? [...this.selected] : entries.map((_, i) => i);
    const subset = indices.map((i) => entries[i]).filter(Boolean);
    const target = !subset.every((e) => e.on);
    for (const e of subset) e.on = target;
    this._syncWidget();
    this.renderRows();
  }

  async _addLora(e) {
    const current = new Set(this.entries.map((en) => en.lora));
    const rect = e.target.getBoundingClientRect();
    const chosen = await showLoraChooser(rect, current);
    if (chosen) this.addEntry({ lora: chosen, on: true, strength: 1 });
  }

  addEntry(entry) {
    if (this.entries.some((e) => e.lora === entry.lora)) return;
    this._setEntries([...this.entries, entry]);
    this._syncWidget();
    this.render();
  }

  async _copyWords(e, entry) {
    e.stopPropagation();
    try {
      const { getLocalInfo } = await import("./api.js");
      const info = await getLocalInfo(entry.lora);
      const words = extractActivationWords(info.metadata || {}, info.civitai || {});
      if (words.length) {
        navigator.clipboard?.writeText(words.join(", "));
        const badge = e.target;
        const old = badge.textContent;
        badge.textContent = "✓";
        setTimeout(() => (badge.textContent = old), 800);
      } else {
        this.modal.open(entry.lora);
      }
    } catch {
      this.modal.open(entry.lora);
    }
  }

  _activateTab(which) {
    this.state.active = which;
    this.selected.clear();
    this._lastClicked = undefined;
    this._syncWidget();
    this.render();
  }

  _openComboMenu(e) {
    this._comboMenu?.remove();
    const menu = h("div", { class: "sl-combo-menu" });
    this._comboMenu = menu;
    document.body.appendChild(menu);
    const rect = e.target.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 200)}px`;
    menu.style.top = `${rect.bottom + 2}px`;

    const close = () => { menu.remove(); document.removeEventListener("mousedown", onDoc, true); };
    const onDoc = (ev) => { if (!menu.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);

    this._renderComboFolder(menu, null, close);
  }

  _renderComboFolder(menu, folderId, close) {
    menu.replaceChildren();
    if (folderId === null) {
      menu.append(h("div", { class: "sl-cm-crumb" }, "Combos"));
    } else {
      const folder = this.combosDoc.folders.find((f) => f.id === folderId);
      menu.append(h("div", { class: "sl-cm-crumb", onclick: () => this._renderComboFolder(menu, null, close) }, "← All folders"));
      menu.append(h("div", { class: "sl-cm-crumb" }, folder?.name ?? folderId));
    }

    const folders = this.combosDoc.folders.filter((f) => (f.combos ?? []).length > 0);
    let any = false;
    for (const folder of folders) {
      if (folderId === null) {
        const count = (folder.combos ?? []).length;
        menu.append(h("div", { class: "sl-cm-item sl-cm-folder", onclick: () => this._renderComboFolder(menu, folder.id, close) },
          folder.name ?? "Untitled", h("span", { class: "sl-cm-count" }, `${count}`)));
        any = true;
      } else if (folder.id === folderId) {
        for (const combo of folder.combos ?? []) {
          menu.append(h("div", { class: "sl-cm-item", onclick: () => {
            this.state.active = combo.id;
            this.state.combo = { id: combo.id, name: combo.name, entries: JSON.parse(JSON.stringify(combo.entries ?? [])) };
            this.selected.clear();
            this._syncWidget();
            this.render();
            close();
          } }, combo.name ?? "Untitled", h("span", { class: "sl-cm-count" }, `${(combo.entries ?? []).length}`)));
          any = true;
        }
      }
    }

    menu.append(h("div", { class: "sl-cm-item", style: "color:#6ea8fe", onclick: () => { this._manageCombos(); close(); } }, "Manage combos..."));
    if (!any && folderId !== null) menu.append(h("div", { class: "sl-cm-crumb" }, "No combos in this folder."));
    if (!any && folderId === null && !folders.length) menu.append(h("div", { class: "sl-cm-crumb" }, "No combos yet. Save one with + Save combo."));
  }

  async _saveAsCombo() {
    const entries = this.entries;
    if (!entries.length) return;
    const defaultFolder = this.combosDoc.folders[0]?.name ?? "General";
    const name = await showPrompt("Save combo", "Combo name");
    if (!name) return;
    const folderName = (await showPrompt("Save combo", "Folder (e.g. SDXL, Pony, Anima)", defaultFolder)) || defaultFolder;
    if (!this.combosDoc.folders.length) {
      this.combosDoc.folders.push({ id: "f" + Math.random().toString(36).slice(2, 8), name: "General", combos: [] });
    }
    let folder = this.combosDoc.folders.find((f) => f.name === folderName);
    if (!folder) {
      folder = { id: "f" + Math.random().toString(36).slice(2, 8), name: folderName, combos: [] };
      this.combosDoc.folders.push(folder);
    }
    const combo = {
      id: "c" + Math.random().toString(36).slice(2, 10),
      name,
      entries: JSON.parse(JSON.stringify(entries)),
    };
    folder.combos.push(combo);
    try {
      this.combosDoc = await saveCombos(this.combosDoc);
    } catch (e) {
      await showAlert("Save failed", String(e.message || e));
      return;
    }
    // Activate the saved combo
    this.state.active = combo.id;
    this.state.combo = { id: combo.id, name, entries: JSON.parse(JSON.stringify(entries)) };
    this._syncWidget();
    this.render();
  }

  async _saveComboEdits() {
    if (this.state.active === "free" || !this.state.combo) return;
    const found = this._findCombo(this.state.combo.id);
    if (!found) {
      await showAlert("Combo gone", "The shared combo no longer exists. Use + Save combo to save as new.");
      return;
    }
    found.combo.entries = JSON.parse(JSON.stringify(this.state.combo.entries));
    found.combo.name = this.state.combo.name;
    try {
      this.combosDoc = await saveCombos(this.combosDoc);
      this.render(); // clears sync note
    } catch (e) {
      await showAlert("Save failed", String(e.message || e));
    }
  }

  _manageCombos() {
    const doc = JSON.parse(JSON.stringify(this.combosDoc));
    if (!Array.isArray(doc.folders)) doc.folders = [];

    const overlay = h("div", { class: "steaked-lora-modal", onclick: (e) => { if (e.target === overlay) close(); } });
    const body = h("div", { class: "sl-modal-body" });
    const box = h("div", { class: "sl-modal-box sl-modal-box-manage" },
      h("div", { class: "sl-modal-header" },
        h("span", { class: "sl-modal-title" }, "Manage combos"),
        h("button", { class: "sl-modal-close", onclick: () => close() }, "✕"),
      ),
      body,
    );
    overlay.append(box);

    const close = () => { overlay.remove(); document.removeEventListener("keydown", esc); };
    const esc = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc);

    const rename = async (item, what) => {
      const name = await showPrompt(`Rename ${what}`, "", item.name ?? "");
      if (name) { item.name = name; render(); }
    };
    const del = async (item, what) => {
      const label = item.name ?? "untitled";
      if (!(await showConfirm(`Delete ${what}`, `"${label}" will be removed. This cannot be undone.`))) return;
      if (what === "folder") doc.folders = doc.folders.filter((f) => f !== item);
      else for (const f of doc.folders) f.combos = (f.combos ?? []).filter((c) => c !== item);
      render();
    };

    const render = () => {
      const frag = document.createDocumentFragment();

      for (const folder of doc.folders) {
        const head = h("div", { class: "sl-mg-folder" },
          h("span", { class: "sl-mg-name", title: "Click to rename", onclick: () => rename(folder, "folder") }, folder.name ?? "Untitled"),
          h("span", { class: "sl-mg-count" }, `${(folder.combos ?? []).length} combos`),
          h("button", { class: "sl-mg-del", title: "Delete folder", onclick: () => del(folder, "folder") }, "Delete"),
        );
        frag.append(head);

        for (const combo of folder.combos ?? []) {
          frag.append(h("div", { class: "sl-mg-combo" },
            h("span", { class: "sl-mg-name", title: "Click to rename", onclick: () => rename(combo, "combo") }, combo.name ?? "Untitled"),
            h("span", { class: "sl-mg-count" }, `${(combo.entries ?? []).length} loras`),
            h("button", { class: "sl-mg-load", title: "Load this combo into the node", onclick: () => { close(); this._loadComboById(combo.id); } }, "Load"),
            h("button", { class: "sl-mg-del", title: "Delete combo", onclick: () => del(combo, "combo") }, "Delete"),
          ));
        }
      }

      if (!doc.folders.length) {
        frag.append(h("div", { class: "sl-loading" }, "No folders yet."));
      }

      body.replaceChildren(h("div", { class: "sl-modal-content" },
        frag,
        h("div", { class: "sl-footer", style: "margin-top:12px" },
        h("button", { class: "sl-btn", onclick: async () => {
          const name = await showPrompt("New folder", "Folder name (e.g. SDXL, Pony, Anima)");
            if (name) { doc.folders.push({ id: "f" + Math.random().toString(36).slice(2, 8), name, combos: [] }); render(); }
          } }, "+ New folder"),
          h("button", { class: "sl-btn", style: "flex:none", onclick: () => close() }, "Cancel"),
          h("button", { class: "sl-btn sl-btn-primary", onclick: async () => {
            try {
              this.combosDoc = await saveCombos(doc);
              close();
              if (this.state.active !== "free") {
                const found = this._findCombo(this.state.active);
                if (!found) this._activateTab("free");
                else if (this.state.combo && found.combo.name !== this.state.combo.name) {
                  this.state.combo.name = found.combo.name;
                  this._syncWidget();
                }
              }
              this.render();
            } catch (e) {
              await showAlert("Save failed", String(e.message || e));
            }
          } }, "Save"),
        ),
      ));
    };

    render();
    document.body.appendChild(overlay);
  }

  _loadComboById(id) {
    const found = this._findCombo(id);
    if (!found) return;
    this.state.active = id;
    this.state.combo = { id, name: found.combo.name, entries: JSON.parse(JSON.stringify(found.combo.entries ?? [])) };
    this.selected.clear();
    this._syncWidget();
    this.render();
  }
}
