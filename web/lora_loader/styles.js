/**
 * Injected CSS for the Combo Lora Loader.
 */

const CSS = `
.steaked-lora-widget {
  font-family: var(--font-family, sans-serif);
  color: var(--input-text, #ddd);
  background: transparent;
  user-select: none;
  --sl-accent: #6ea8fe;
  --sl-border: #3a3a3a;
  --sl-header: #242424;
  --sl-row: #1e1e1e;
  --sl-row-hover: #2a2a2a;
  --sl-row-sel: #1d3a5f;
}
.steaked-lora-widget * { box-sizing: border-box; }

.steaked-lora-tabs {
  display: flex;
  align-items: stretch;
  gap: 0;
  border-bottom: 1px solid var(--sl-border);
  overflow-x: auto;
  scrollbar-width: none;
  min-height: 26px;
}
.steaked-lora-tabs::-webkit-scrollbar { display: none; }

.sl-tab {
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  border: none;
  background: transparent;
  color: var(--input-text, #ddd);
  border-bottom: 2px solid transparent;
  opacity: 0.7;
}
.sl-tab:hover { opacity: 1; }
.sl-tab.active {
  opacity: 1;
  border-bottom-color: var(--sl-accent);
  font-weight: 600;
}
.sl-tab .sl-tab-badge {
  display: inline-block;
  min-width: 14px;
  padding: 0 3px;
  margin-left: 4px;
  border-radius: 7px;
  background: #353535;
  font-size: 9px;
  text-align: center;
  line-height: 14px;
}
.sl-tab-add {
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
  border: none;
  background: transparent;
  color: #888;
}
.sl-tab-add:hover { color: var(--sl-accent); }

.steaked-lora-rows {
  max-height: 220px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.sl-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  background: var(--sl-row);
  border-bottom: 1px solid #161616;
  font-size: 11px;
  cursor: grab;
}
.sl-row:hover { background: var(--sl-row-hover); }
.sl-row.selected { background: var(--sl-row-sel); }
.sl-row.dragging { opacity: 0.45; }
.sl-row.drag-over-top { box-shadow: 0 -2px 0 0 var(--sl-accent); }
.sl-row.drag-over-bot { box-shadow: 0 2px 0 0 var(--sl-accent); }

.sl-row-toggle {
  width: 12px; height: 12px;
  border-radius: 50%;
  border: 1px solid #666;
  flex: none;
  cursor: pointer;
}
.sl-row-toggle.on {
  background: #4caf50;
  border-color: #4caf50;
}

.sl-row-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.sl-row-name .sl-name-dir { color: #777; font-size: 10px; }

.sl-row-badges { display: flex; gap: 3px; flex: none; }
.sl-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  background: #353535;
  color: #aaa;
  cursor: pointer;
}
.sl-badge.sl-badge-words:hover { background: var(--sl-accent); color: #fff; }
.sl-badge.sl-badge-info:hover { background: var(--sl-accent); color: #fff; }

.sl-strength {
  width: 40px;
  flex: none;
  font-size: 11px;
  padding: 1px 4px;
  text-align: center;
  cursor: ew-resize;
  color: #8fc3ff;
  font-variant-numeric: tabular-nums;
  border-radius: 2px;
}
.sl-row:hover .sl-strength { background: #111; }
.sl-strength-off { color: #666; }
.sl-strength-input {
  width: 40px;
  flex: none;
  background: #111;
  border: 1px solid var(--sl-accent);
  color: var(--input-text, #ddd);
  font-size: 11px;
  padding: 0 2px;
  border-radius: 2px;
  text-align: center;
  outline: none;
}

.sl-dropzone {
  padding: 8px;
  text-align: center;
  font-size: 11px;
  color: #666;
  border: 1px dashed #333;
  border-radius: 3px;
  margin: 4px 0;
}
.sl-dropzone.drag-over {
  border-color: var(--sl-accent);
  color: var(--sl-accent);
  background: rgba(110, 168, 254, 0.05);
}

.sl-footer {
  display: flex;
  gap: 4px;
  padding: 4px 0 2px;
}
.sl-btn {
  flex: 1;
  font-size: 10px;
  padding: 3px 6px;
  background: var(--sl-header);
  border: 1px solid var(--sl-border);
  border-radius: 2px;
  color: var(--input-text, #ddd);
  cursor: pointer;
}
.sl-btn:hover { border-color: var(--sl-accent); }
.sl-btn:disabled { opacity: 0.4; cursor: default; }
.sl-btn-primary { border-color: var(--sl-accent); color: var(--sl-accent); }
.sl-btn-primary:hover { background: var(--sl-accent); color: #fff; }

/* ── Combo manager modal ── */
.sl-mg-folder {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--sl-border);
  margin-top: 6px;
}
.sl-mg-folder .sl-mg-name { cursor: pointer; }
.sl-mg-folder .sl-mg-name:hover { color: var(--sl-accent); }
.sl-mg-combo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 4px 3px 18px;
  font-size: 12px;
  border-bottom: 1px solid #232323;
}
.sl-mg-combo .sl-mg-name { cursor: pointer; flex: 1; }
.sl-mg-combo .sl-mg-name:hover { color: var(--sl-accent); }
.sl-mg-count { color: #777; font-size: 10px; flex: none; }
.sl-mg-del {
  flex: none;
  font-size: 10px;
  padding: 2px 8px;
  background: transparent;
  border: 1px solid #5a3030;
  border-radius: 2px;
  color: #e57373;
  cursor: pointer;
}
.sl-mg-del:hover { background: #5a3030; color: #fff; }
.sl-mg-load {
  flex: none;
  font-size: 10px;
  padding: 2px 8px;
  background: transparent;
  border: 1px solid var(--sl-border);
  border-radius: 2px;
  color: var(--input-text, #ddd);
  cursor: pointer;
}
.sl-mg-load:hover { border-color: var(--sl-accent); color: var(--sl-accent); }

/* ── Small dialogs (prompt/confirm/alert) ── */
.sl-dlg-box {
  width: min(380px, 90vw);
  background: #1c1c1c;
  border: 1px solid var(--sl-border);
  border-radius: 4px;
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
}
.sl-dlg-title { font-size: 13px; font-weight: 600; }
.sl-dlg-msg { font-size: 12px; color: #bbb; line-height: 1.4; overflow-wrap: anywhere; }
.sl-dlg-input {
  padding: 6px 8px;
  background: #111;
  border: 1px solid var(--sl-border);
  border-radius: 2px;
  color: var(--input-text, #ddd);
  font-size: 12px;
  outline: none;
}
.sl-dlg-input:focus { border-color: var(--sl-accent); }
.sl-dlg-btns { display: flex; gap: 6px; justify-content: flex-end; }
.sl-dlg-btns .sl-btn { flex: none; padding: 4px 14px; }
.sl-btn-danger { border-color: #5a3030; color: #e57373; }
.sl-btn-danger:hover { background: #5a3030; border-color: #e57373; color: #fff; }

/* ── Combo picker dropdown ── */
.sl-combo-menu {
  position: fixed;
  z-index: 100000;
  background: #1a1a1a;
  border: 1px solid var(--sl-border);
  border-radius: 3px;
  min-width: 180px;
  max-height: 320px;
  overflow-y: auto;
  padding: 2px;
  font-size: 12px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
}
.sl-combo-menu .sl-cm-crumb {
  padding: 4px 6px;
  color: #888;
  font-size: 11px;
  border-bottom: 1px solid #2a2a2a;
  margin-bottom: 2px;
  cursor: pointer;
}
.sl-combo-menu .sl-cm-crumb:hover { color: var(--sl-accent); }
.sl-combo-menu .sl-cm-item {
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 2px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sl-combo-menu .sl-cm-item:hover { background: #2a2a2a; }
.sl-combo-menu .sl-cm-item .sl-cm-count { color: #777; font-size: 10px; }
.sl-combo-menu .sl-cm-item.sl-cm-folder::before { content: "📁 "; }

/* ── Info modal ── */
.steaked-lora-modal {
  position: fixed;
  inset: 0;
  z-index: 100001;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}
.steaked-lora-modal .sl-modal-box {
  width: min(860px, 92vw);
  height: min(640px, 88vh);
  background: #1c1c1c;
  border: 1px solid var(--sl-border);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sl-modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--sl-header);
  border-bottom: 1px solid var(--sl-border);
}
.sl-modal-header .sl-modal-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sl-modal-close {
  background: transparent;
  border: none;
  color: #999;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
}
.sl-modal-close:hover { color: #fff; }

.sl-modal-body { flex: 1; display: flex; min-height: 0; }
.sl-modal-tabs {
  width: 130px;
  flex: none;
  border-right: 1px solid var(--sl-border);
  padding: 6px 0;
  background: #191919;
}
.sl-modal-tabs .sl-mt {
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  border-left: 2px solid transparent;
}
.sl-modal-tabs .sl-mt:hover { background: #222; }
.sl-modal-tabs .sl-mt.active {
  border-left-color: var(--sl-accent);
  background: #222;
  font-weight: 600;
}
.sl-modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  font-size: 12px;
  line-height: 1.5;
}

.sl-modal-box-manage {
  width: min(560px, 92vw);
  height: min(480px, 85vh);
}
.sl-modal-box-manage .sl-modal-body { display: block; }
.sl-modal-box-manage .sl-modal-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}
.sl-modal-box-manage .sl-mg-folder { flex: none; }
.sl-modal-box-manage .sl-mg-combo { flex: none; }
.sl-modal-box-manage .sl-footer { margin-top: auto; flex: none; }
.sl-modal-content h4 {
  margin: 12px 0 4px;
  font-size: 12px;
  color: var(--sl-accent);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.sl-modal-content h4:first-child { margin-top: 0; }

.sl-kv-grid {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 2px 10px;
}
.sl-kv-grid .sl-kv-k { color: #999; }
.sl-kv-grid .sl-kv-v { overflow-wrap: anywhere; }
.sl-kv-grid .sl-kv-v a { color: var(--sl-accent); }

.sl-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.sl-chip {
  background: #2a2a2a;
  border: 1px solid var(--sl-border);
  border-radius: 2px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 11px;
}
.sl-chip:hover { border-color: var(--sl-accent); color: #fff; }

.sl-preview-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.sl-preview-grid img {
  height: 160px;
  border-radius: 2px;
  object-fit: cover;
  cursor: pointer;
}

.sl-tag-freq { display: flex; flex-wrap: wrap; gap: 3px; }
.sl-tag-freq .sl-tf {
  background: #232323;
  padding: 1px 6px;
  border-radius: 2px;
  font-size: 11px;
}
.sl-tag-freq .sl-tf .sl-tf-n { color: #777; margin-left: 4px; font-size: 9px; }

.sl-json {
  background: #141414;
  border: 1px solid #262626;
  border-radius: 3px;
  padding: 8px;
  font-family: monospace;
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 400px;
  overflow-y: auto;
  user-select: text;
}

.sl-loading { color: #888; padding: 20px; text-align: center; }
.sl-error { color: #e57373; padding: 12px; }

/* ── Lora chooser (add dialog) ── */
.sl-chooser {
  position: fixed;
  z-index: 100002;
  background: #1a1a1a;
  border: 1px solid var(--sl-border);
  border-radius: 4px;
  width: min(420px, 90vw);
  max-height: 420px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  font-size: 12px;
}
.sl-chooser input {
  margin: 6px;
  padding: 5px 8px;
  background: #111;
  border: 1px solid var(--sl-border);
  border-radius: 2px;
  color: var(--input-text, #ddd);
  outline: none;
}
.sl-chooser input:focus { border-color: var(--sl-accent); }
.sl-chooser .sl-ch-list {
  overflow-y: auto;
  padding: 0 4px 4px;
}
.sl-chooser .sl-ch-item {
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sl-chooser .sl-ch-item:hover, .sl-chooser .sl-ch-item.hl { background: #2a2a2a; }
.sl-chooser .sl-ch-item .sl-ch-dir { color: #777; font-size: 10px; }
.sl-chooser .sl-ch-empty { padding: 12px; color: #777; text-align: center; }

/* sync indicator on combo tab */
.sl-sync-note {
  font-size: 10px;
  color: #e0b050;
  padding: 2px 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}
.sl-sync-note:hover { color: #ffc94d; }
`;

let injected = false;
export function injectLoraStyles() {
  if (injected) return;
  const el = document.createElement("style");
  el.id = "steaked-lora-loader-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
  injected = true;
}
