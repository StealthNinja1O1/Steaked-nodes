/**
 * preview_overlay.js - Live Preview Overlay for ComfyUI
 *
 * Hooks into ComfyUI's WebSocket preview events (b_preview / b_preview_with_metadata)
 * and renders them in a floating overlay that can be moved anywhere
 */
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const STORAGE_KEY = "Steaked.PreviewOverlay";
const DEFAULT_STATE = {
  enabled: false,
  x: null,
  y: null,
  width: 512,
  height: 512,
  opacity: 0.95,
  alwaysOnTop: true,
  showNodeInfo: true,
};

class PreviewOverlay {
  constructor() {
    this.container = null;
    this.imageEl = null;
    this.infoEl = null;
    this.headerEl = null;
    this.state = { ...DEFAULT_STATE };
    this.currentBlobUrl = null;
    this.lastBlobUrl = null;
    this.isDragging = false;
    this.isResizing = false;
    this.dragOffset = { x: 0, y: 0 };
    this.currentNodeId = null;
    this.currentNodeName = null;
    this.isVisible = false;
    this.toolbarBtn = null;
    this._boundHandlers = {};
  }

  loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.state = { ...DEFAULT_STATE, ...parsed };
      }
    } catch (e) {
      console.warn("[PreviewOverlay] Failed to load state:", e);
    }
  }

  saveState() {
    try {
      const toSave = { ...this.state };
      if (this.container) {
        const rect = this.container.getBoundingClientRect();
        toSave.x = rect.left;
        toSave.y = rect.top;
        toSave.width = rect.width;
        toSave.height = rect.height;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.warn("[PreviewOverlay] Failed to save state:", e);
    }
  }

  create() {
    if (this.container) return;

    // Main container
    this.container = document.createElement("div");
    this.container.className = "steaked-preview-overlay";
    this.container.style.cssText = this._containerStyle();
    this.headerEl = document.createElement("div");
    this.headerEl.className = "steaked-preview-overlay-header";

    const titleSpan = document.createElement("span");
    titleSpan.className = "steaked-preview-overlay-title";
    titleSpan.textContent = "◉ Live Preview";
    this.infoEl = document.createElement("span");
    this.infoEl.className = "steaked-preview-overlay-info";
    this.infoEl.textContent = "";
    const btnContainer = document.createElement("div");
    btnContainer.className = "steaked-preview-overlay-btns";

    const closeBtn = document.createElement("button");
    closeBtn.className = "steaked-preview-overlay-btn";
    closeBtn.title = "Hide overlay (Shift+P to toggle)";
    closeBtn.innerHTML = "✕";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hide();
      this.state.enabled = false;
      this.saveState();
      if (this.toolbarBtn) {
        this.toolbarBtn.style.opacity = "0.5";
      }
    });

    btnContainer.append(closeBtn);
    this.headerEl.append(titleSpan, this.infoEl, btnContainer);

    // Image container
    const imageContainer = document.createElement("div");
    imageContainer.className = "steaked-preview-overlay-image-container";

    this.imageEl = document.createElement("img");
    this.imageEl.className = "steaked-preview-overlay-image";
    this.imageEl.alt = "Live preview";
    this.imageEl.draggable = false;

    // when no image is available
    this.placeholderEl = document.createElement("div");
    this.placeholderEl.className = "steaked-preview-overlay-placeholder";
    this.placeholderEl.innerHTML = `
      <div class="steaked-preview-overlay-placeholder-icon">◉</div>
      <div class="steaked-preview-overlay-placeholder-text">Waiting for preview...</div>
      <div class="steaked-preview-overlay-placeholder-hint">Enable previews in ComfyUI settings<br/>(Auto, TAESD, or Latent2RGB)</div>
    `;

    imageContainer.append(this.imageEl, this.placeholderEl);

    this.resizeHandle = document.createElement("div");
    this.resizeHandle.className = "steaked-preview-overlay-resize";

    this.container.append(this.headerEl, imageContainer, this.resizeHandle);
    document.body.appendChild(this.container);

    this._setupDragHandlers();
    this._setupResizeHandlers();
    this._restorePosition();
    this._applyState();
  }

  destroy() {
    this._cleanupBlobUrl();
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  show() {
    if (!this.container) this.create();
    this.container.style.display = "flex";
    this.isVisible = true;
    if (this.toolbarBtn) {
      this.toolbarBtn.style.opacity = "1";
    }
  }

  hide() {
    if (this.container) {
      this.container.style.display = "none";
    }
    this.isVisible = false;
  }

  toggle() {
    this.state.enabled = !this.state.enabled;
    if (this.state.enabled) {
      this.show();
      // Restore last frame if available
      if (this.lastBlobUrl) {
        this._showImage(this.lastBlobUrl);
      }
    } else {
      this.hide();
    }
    this.saveState();
    if (this.toolbarBtn) {
      this.toolbarBtn.style.opacity = this.state.enabled ? "1" : "0.5";
    }
  }

  updatePreview(blob) {
    if (!this.state.enabled) return;

    this._cleanupBlobUrl();
    this.currentBlobUrl = URL.createObjectURL(blob);
    this.lastBlobUrl = this.currentBlobUrl;
    this._showImage(this.currentBlobUrl);

    if (!this.isVisible) {
      this.show();
      this.state.enabled = true;
      this.saveState();
      if (this.toolbarBtn) 
        this.toolbarBtn.style.opacity = "1";
      
    }
  }

  updateNodeInfo(nodeId, displayNodeId) {
    const targetId = displayNodeId || nodeId;
    this.currentNodeId = targetId;

    if (!this.state.showNodeInfo || !this.infoEl) return;
    const node = app.graph?.getNodeById(Number(targetId));
    this.currentNodeName = node?.title || node?.properties?.["Node name for S&R"] || `Node ${targetId}`;
    this.infoEl.textContent = this.currentNodeName;
  }

  onExecutionStart() {
    if (!this.state.enabled) return;
    if (this.infoEl) 
      this.infoEl.textContent = "";
    
    this.currentNodeId = null;
    this.currentNodeName = null;
    if (this.placeholderEl) 
      this.placeholderEl.style.display = "flex";
    if (this.imageEl) 
      this.imageEl.style.display = "none";
    
  }

  // not needed
  onExecutionComplete() {
  }

  _showImage(blobUrl) {
    if (this.imageEl) {
      this.imageEl.src = blobUrl;
      this.imageEl.style.display = "block";
    }
    if (this.placeholderEl) 
      this.placeholderEl.style.display = "none";
    
  }

  _cleanupBlobUrl() {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
  }

  _containerStyle() {
    return `
      position: fixed;
      display: none;
      flex-direction: column;
      z-index: ${this.state.alwaysOnTop ? "100001" : "10000"};
      background: #1a1a1a;
      border: 1px solid #3a3a3a;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-width: 200px;
      min-height: 200px;
      transition: opacity 0.15s ease;
      opacity: ${this.state.opacity};
    `;
  }

  _restorePosition() {
    if (!this.container) return;

    // Use saved position if available, otherwise center-right of viewport
    if (this.state.x !== null && this.state.y !== null) {
      const maxX = window.innerWidth - 100;
      const maxY = window.innerHeight - 100;
      const x = Math.min(this.state.x, maxX);
      const y = Math.min(this.state.y, maxY);
      this.container.style.left = `${x}px`;
      this.container.style.top = `${y}px`;
    } else {
      const defaultWidth = this.state.width || 512;
      const x = window.innerWidth - defaultWidth - 20;
      const y = Math.max(20, (window.innerHeight - (this.state.height || 512)) / 2);
      this.container.style.left = `${Math.max(20, x)}px`;
      this.container.style.top = `${y}px`;
    }

    if (this.state.width) {
      this.container.style.width = `${this.state.width}px`;
    }
    if (this.state.height) {
      this.container.style.height = `${this.state.height}px`;
    }
  }

  _applyState() {
    if (!this.container) return;
    this.container.style.opacity = this.state.opacity;
    this.container.style.zIndex = this.state.alwaysOnTop ? "100001" : "10000";
  }

  _setupDragHandlers() {
    const startDrag = (e) => {
      // Only drag from header
      if (e.target.closest(".steaked-preview-overlay-btn")) return;
      e.preventDefault();
      this.isDragging = true;
      const rect = this.container.getBoundingClientRect();
      this.dragOffset.x = e.clientX - rect.left;
      this.dragOffset.y = e.clientY - rect.top;
      document.body.style.userSelect = "none";
    };

    const onDrag = (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      const x = Math.max(0, Math.min(e.clientX - this.dragOffset.x, window.innerWidth - 50));
      const y = Math.max(0, Math.min(e.clientY - this.dragOffset.y, window.innerHeight - 50));
      this.container.style.left = `${x}px`;
      this.container.style.top = `${y}px`;
    };

    const endDrag = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      document.body.style.userSelect = "";
      this.saveState();
    };

    this.headerEl.addEventListener("mousedown", startDrag);
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", endDrag);

    this._boundHandlers = { startDrag, onDrag, endDrag };
  }

  _setupResizeHandlers() {
    const startResize = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isResizing = true;
      this._resizeStartX = e.clientX;
      this._resizeStartY = e.clientY;
      const rect = this.container.getBoundingClientRect();
      this._resizeStartW = rect.width;
      this._resizeStartH = rect.height;
      document.body.style.userSelect = "none";
    };

    const onResize = (e) => {
      if (!this.isResizing) return;
      e.preventDefault();
      const dw = e.clientX - this._resizeStartX;
      const dh = e.clientY - this._resizeStartY;
      // Maintain square aspect ratio with shift
      if (e.shiftKey) {
        const maxD = Math.max(Math.abs(dw), Math.abs(dh));
        const sign_w = dw >= 0 ? 1 : -1;
        const sign_h = dh >= 0 ? 1 : -1;
        this.container.style.width = `${Math.max(200, this._resizeStartW + maxD * sign_w)}px`;
        this.container.style.height = `${Math.max(200, this._resizeStartH + maxD * sign_h)}px`;
      } else {
        this.container.style.width = `${Math.max(200, this._resizeStartW + dw)}px`;
        this.container.style.height = `${Math.max(200, this._resizeStartH + dh)}px`;
      }
    };

    const endResize = () => {
      if (!this.isResizing) return;
      this.isResizing = false;
      document.body.style.userSelect = "";
      this.saveState();
    };

    this.resizeHandle.addEventListener("mousedown", startResize);
    document.addEventListener("mousemove", onResize);
    document.addEventListener("mouseup", endResize);
  }

  createToolbarButton() {
    const existingBtn = document.getElementById("steaked-preview-overlay-btn");
    if (existingBtn) return existingBtn;

    const btn = document.createElement("button");
    btn.id = "steaked-preview-overlay-btn";
    btn.className = "steaked-preview-overlay-toolbar-btn";
    btn.title = "Toggle Live Preview Overlay (Shift + P)";
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><circle cx="12" cy="10" r="2" fill="currentColor"/></svg>`;
    btn.style.opacity = this.state.enabled ? "1" : "0.5";
    btn.addEventListener("click", () => this.toggle());

    const menubar = document.querySelector(".comfyui-menu") || document.querySelector("#comfyui-menu");
    if (menubar) {
      menubar.appendChild(btn);
    } else {
      // Fallback: append to body as a fixed button
      btn.style.position = "fixed";
      btn.style.bottom = "60px";
      btn.style.right = "10px";
      btn.style.zIndex = "100002";
      document.body.appendChild(btn);
    }

    this.toolbarBtn = btn;
    return btn;
  }

  injectStyles() {
    if (document.getElementById("steaked-preview-overlay-styles")) return;

    const style = document.createElement("style");
    style.id = "steaked-preview-overlay-styles";
    style.textContent = `
      .steaked-preview-overlay {
        position: fixed;
        display: none;
        flex-direction: column;
        z-index: 100001;
        background: #1a1a1a;
        border: 1px solid #3a3a3a;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        min-width: 200px;
        min-height: 200px;
        transition: opacity 0.15s ease, box-shadow 0.15s ease;
      }

      .steaked-preview-overlay:hover {
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08);
      }

      .steaked-preview-overlay-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        background: #252525;
        border-bottom: 1px solid #333;
        cursor: grab;
        user-select: none;
        flex-shrink: 0;
      }

      .steaked-preview-overlay-header:active {
        cursor: grabbing;
      }

      .steaked-preview-overlay-title {
        font-size: 12px;
        font-weight: 600;
        color: #a0d0ff;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .steaked-preview-overlay-info {
        font-size: 11px;
        color: #888;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
      }

      .steaked-preview-overlay-btns {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
        margin-left: auto;
      }

      .steaked-preview-overlay-btn {
        background: transparent;
        border: none;
        color: #666;
        cursor: pointer;
        font-size: 12px;
        padding: 2px 4px;
        border-radius: 3px;
        line-height: 1;
        transition: color 0.15s, background 0.15s;
      }

      .steaked-preview-overlay-btn:hover {
        color: #ccc;
        background: rgba(255, 255, 255, 0.08);
      }

      .steaked-preview-overlay-image-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        background: #111;
        position: relative;
      }

      .steaked-preview-overlay-image {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        image-rendering: auto;
        display: none;
      }

      .steaked-preview-overlay-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: #555;
        padding: 20px;
        text-align: center;
      }

      .steaked-preview-overlay-placeholder-icon {
        font-size: 32px;
        opacity: 0.4;
        animation: steaked-preview-pulse 2s ease-in-out infinite;
      }

      @keyframes steaked-preview-pulse {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 0.6; }
      }

      .steaked-preview-overlay-placeholder-text {
        font-size: 13px;
        font-weight: 500;
        color: #666;
      }

      .steaked-preview-overlay-placeholder-hint {
        font-size: 11px;
        color: #444;
        line-height: 1.5;
      }

      .steaked-preview-overlay-resize {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 16px;
        height: 16px;
        cursor: nwse-resize;
        z-index: 1;
        opacity: 0;
        transition: opacity 0.15s;
      }

      .steaked-preview-overlay-resize::before,
      .steaked-preview-overlay-resize::after {
        content: "";
        position: absolute;
        background: #555;
        border-radius: 1px;
      }

      .steaked-preview-overlay-resize::before {
        bottom: 4px;
        right: 4px;
        width: 8px;
        height: 1.5px;
      }

      .steaked-preview-overlay-resize::after {
        bottom: 4px;
        right: 4px;
        width: 1.5px;
        height: 8px;
      }

      .steaked-preview-overlay:hover .steaked-preview-overlay-resize {
        opacity: 1;
      }

      .steaked-preview-overlay-toolbar-btn {
        background: transparent;
        border: 1px solid #444;
        color: #aaa;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
        line-height: 1;
      }

      .steaked-preview-overlay-toolbar-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        border-color: #666;
      }

      .steaked-preview-overlay-toolbar-btn:active {
        transform: scale(0.95);
      }

      .comfyui-menu .steaked-preview-overlay-toolbar-btn {
        margin-left: 4px;
      }

      .steaked-preview-overlay-header.dblclick-reset {
        animation: steaked-preview-reset-flash 0.3s ease;
      }

      @keyframes steaked-preview-reset-flash {
        0%, 100% { background: #252525; }
        50% { background: #335; }
      }
    `;
    document.head.appendChild(style);
  }

  dispose() {
    clearTimeout(this._hideTimer);
    this.destroy();
    if (this.toolbarBtn) {
      this.toolbarBtn.remove();
      this.toolbarBtn = null;
    }
  }
}

const overlay = new PreviewOverlay();

//Extension Registration
app.registerExtension({
  name: "Steaked.PreviewOverlay",

  async setup() {
    overlay.loadState();
    overlay.injectStyles();

    app.ui.settings.addSetting({
      id: "Steaked.PreviewOverlay.Enabled",
      name: "Live Preview Overlay – Enable on startup",
      type: "boolean",
      defaultValue: false,
    });

    app.ui.settings.addSetting({
      id: "Steaked.PreviewOverlay.ShowNodeInfo",
      name: "Live Preview Overlay – Show node name in header",
      type: "boolean",
      defaultValue: true,
      onChange(value) {
        overlay.state.showNodeInfo = value;
        overlay.saveState();
        if (!value && overlay.infoEl) {
          overlay.infoEl.textContent = "";
        }
      },
    });

    app.ui.settings.addSetting({
      id: "Steaked.PreviewOverlay.Opacity",
      name: "Live Preview Overlay – Opacity",
      type: "slider",
      attrs: { min: 0.1, max: 1, step: 0.05 },
      defaultValue: 0.95,
      onChange(value) {
        overlay.state.opacity = parseFloat(value);
        overlay._applyState();
        overlay.saveState();
      },
    });

    // Listen for preview images
    api.addEventListener("b_preview", (event) => {
      overlay.updatePreview(event.detail);
    });

    // Listen for metadata-enhanced previews (includes node info)
    api.addEventListener("b_preview_with_metadata", (event) => {
      const { blob, displayNodeId, nodeId } = event.detail;
      overlay.updatePreview(blob);
      overlay.updateNodeInfo(nodeId, displayNodeId);
    });

    // Track execution state for showing/hiding placeholder
    api.addEventListener("execution_start", () => {
      overlay.onExecutionStart();
    });

    api.addEventListener("execution_success", () => {
      overlay.onExecutionComplete();
    });

    api.addEventListener("execution_error", () => {
      overlay.onExecutionComplete();
    });

    api.addEventListener("execution_interrupted", () => {
      overlay.onExecutionComplete();
    });

    // Keyboard shortcut: P to toggle
    document.addEventListener("keydown", (e) => {
      if (e.key === "P" && (e.shiftKey || e.ctrlKey) && !e.altKey && !e.metaKey) {
        e.preventDefault();
        overlay.toggle();
      }
    });

    // doubleclick header to reset size to default
    document.addEventListener("dblclick", (e) => {
      if (e.target.closest(".steaked-preview-overlay-header")) {
        overlay.state.width = DEFAULT_STATE.width;
        overlay.state.height = DEFAULT_STATE.height;
        if (overlay.container) {
          overlay.container.style.width = `${DEFAULT_STATE.width}px`;
          overlay.container.style.height = `${DEFAULT_STATE.height}px`;
          overlay.headerEl.classList.add("dblclick-reset");
          setTimeout(() => overlay.headerEl?.classList.remove("dblclick-reset"), 300);
        }
        overlay.saveState();
      }
    });

    const tryAddButton = () => {
      if (document.querySelector(".comfyui-menu") || document.querySelector("#comfyui-menu") || document.body) {
        overlay.createToolbarButton();
      } else {
        setTimeout(tryAddButton, 500);
      }
    };
    tryAddButton();

    const settingEnabled = app.ui.settings.getSettingValue("Steaked.PreviewOverlay.Enabled", false);
    if (settingEnabled || overlay.state.enabled) {
      overlay.state.enabled = true;
      overlay.show();
    }
  },

  async beforeRegisterNodeDef() {
  },
});
