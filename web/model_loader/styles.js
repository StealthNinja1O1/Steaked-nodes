let injected = false;

export function injectModelStyles() {
  if (injected) return;
  injected = true;

  const css = `
/* global scope: dialogs render on document.body, outside the widget */
:root {
  --smx-accent: #6ea8fe;
  --smx-border: #3a3a3a;
}
.steaked-lora-modal {
  --sl-accent: #6ea8fe;
  --sl-border: #3a3a3a;
  --sl-header: #242424;
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
  color: #eee;
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
  max-height: 400px;
  overflow-y: auto;
  user-select: text;
}
.sl-modal-tabs .sl-mt {
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 3px;
  color: #bbb;
}
.sl-modal-tabs .sl-mt:hover { background: #222; }
.sl-modal-tabs .sl-mt.active { background: #2a2a2a; color: #fff; }
.sl-modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  font-size: 12px;
  color: var(--input-text, #ddd);
}
.sl-loading { color: #888; padding: 20px; text-align: center; }
.sl-btn {
  background: #2a2a2a;
  color: #ccc;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.sl-btn:hover { border-color: #6ea8fe; color: #fff; }
.sl-btn:disabled { opacity: 0.6; cursor: default; }
/* chooser (positioned on body too) */
.sl-chooser {
  position: fixed;
  z-index: 100002;
  background: #1a1a1a;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  width: min(420px, 90vw);
  max-height: 420px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  font-size: 12px;
  color: #ddd;
}
.sl-chooser input {
  margin: 6px;
  padding: 5px 8px;
  background: #111;
  border: 1px solid #3a3a3a;
  border-radius: 2px;
  color: var(--input-text, #ddd);
  outline: none;
}
.sl-chooser input:focus { border-color: #6ea8fe; }
.sl-chooser .sl-ch-list { overflow-y: auto; padding: 0 4px 4px; }
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

.steaked-model-widget {
  font-family: var(--font-family, sans-serif);
  color: var(--input-text, #ddd);
  background: transparent;
  user-select: none;
  --sl-accent: #6ea8fe;
  --sl-border: #3a3a3a;
  --sl-header: #242424;
  --sl-row: #1e1e1e;
  --sl-row-hover: #2a2a2a;
}
.steaked-model-widget * { box-sizing: border-box; }

.steaked-model-widget {
  overflow: hidden;
}
.steaked-model-widget > * { flex-shrink: 0; }

.steaked-model-widget {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 0;
  font-size: 12px;
}

.sm-header { display: flex; flex-direction: column; gap: 2px; }

.sm-model-pick {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--sl-row);
  border: 1px solid var(--sl-border);
  border-radius: 4px;
  padding: 7px 8px;
  cursor: pointer;
  min-height: 30px;
}
.sm-model-pick:hover { background: var(--sl-row-hover); }

.sm-model-pick.sm-empty .sm-model-name { color: #888; }

.sm-model-dir { color: #777; font-size: 10px; flex-shrink: 0; }
.sm-model-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #eee;
}

.sm-model-type {
  flex: none;
  font-size: 9px;
  padding: 2px 5px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.sm-type-ckpt { background: #23364f; color: #6ea8fe; }
.sm-type-diff { background: #3f3323; color: #d9a95c; }

.sm-model-info {
  flex: none;
  width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  border-radius: 3px;
  font-size: 11px;
  color: #888;
  cursor: pointer;
}
.sm-model-info:hover { background: var(--sl-accent); color: #fff; }

.sm-body { display: flex; flex-direction: column; gap: 3px; }

.sm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--sl-row);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 3px 8px;
  min-height: 24px;
}
.sm-row:hover { background: var(--sl-row-hover); }
.sm-row-missing { border-color: #5c3232; }

.sm-row-label {
  flex: none;
  width: 40px;
  font-size: 9px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sm-row-value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #888;
  cursor: pointer;
  text-align: right;
  font-size: 11px;
}
.sm-row-value:hover { color: var(--sl-accent); }
.sm-row-value.overridden { color: #6ea8fe; }
.sm-row-value.sm-missing { color: #e57373; }

/* chooser extras (rides on the shared sl-chooser look) */
.sm-chooser .sl-ch-item { display: flex; align-items: center; gap: 6px; }
.sm-chooser .sm-ch-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-ch-type {
  flex: none;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.sm-ch-type.sm-type-ckpt { background: #23364f; color: #6ea8fe; }
.sm-ch-type.sm-type-diff { background: #3f3323; color: #d9a95c; }
.sm-chooser .sm-reset { color: #888; font-style: italic; }

/* info modal extras (shared classes duplicated from lora loader so they
   work even when no lora node exists) */
.sm-modal-box { width: min(760px, 92vw); height: min(600px, 86vh); }
.sm-modal-box .sl-modal-content { display: block; overflow-y: auto; padding: 12px; }
.sm-modal-box .sl-modal-content h4 {
  color: #999;
  font-size: 12px;
  margin: 14px 0 6px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.sm-modal-box .sl-modal-content h4:first-child { margin-top: 0; }
.sl-kv-grid {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 3px 10px;
  font-size: 12px;
}
.sl-kv-grid .sl-kv-k { color: #999; }
.sl-kv-grid .sl-kv-v { overflow-wrap: anywhere; color: #ddd; }
.sl-kv-grid .sl-kv-v a { color: var(--sl-accent); }
.sl-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.sl-chip {
  padding: 2px 8px;
  background: #222;
  border: 1px solid var(--sl-border);
  border-radius: 10px;
  font-size: 11px;
  cursor: pointer;
  user-select: none;
}
.sl-chip:hover { border-color: var(--sl-accent); color: #fff; }
.sl-preview-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.sl-preview-grid img {
  height: 110px;
  border-radius: 3px;
  cursor: pointer;
  object-fit: cover;
}
.sl-json {
  background: #141414;
  border: 1px solid var(--sl-border);
  border-radius: 3px;
  padding: 8px;
  font-family: monospace;
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 300px;
  overflow-y: auto;
  color: #bbb;
  user-select: text;
}
.sm-chooser .sl-ch-item { display: flex; align-items: center; gap: 6px; }
`;

  const style = document.createElement("style");
  style.id = "steaked-model-loader-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
