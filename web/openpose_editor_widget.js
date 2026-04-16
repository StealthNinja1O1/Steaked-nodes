/**
 * openpose_editor_widget.js -- OpenPose Editor node UI
 *
 * Provides a button to launch a full-screen 3D OpenPose editor (iframe),
 * communicates via postMessage, persists pose state in hidden widgets,
 * and renders a thumbnail preview on the node.
 */

import { app } from "../../scripts/app.js";

// ── Constants ──────────────────────────────────────────────────────────────────
const NODE_NAME = "OpenPoseEditor";
const EDITOR_URL = "/steaked/openpose/editor";
const PREVIEW_SIZE = 220; // max preview width/height on node

// postMessage protocol constants (matches useMessageDispatch in the editor)
const MSG_CMD = "openpose-3d";

// ── Promise-based command invocation ───────────────────────────────────────────
const _pendingReturns = {};

function _invokeCommand(iframe, method, ...args) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      delete _pendingReturns[method];
      reject({ method, status: "Timeout" });
    }, 10000);

    _pendingReturns[method] = (value) => {
      clearTimeout(timeout);
      resolve(value);
    };

    iframe.contentWindow.postMessage(
      { cmd: MSG_CMD, method, type: "call", payload: args },
      "*"
    );
  });
}

// ── Extension ──────────────────────────────────────────────────────────────────

app.registerExtension({
  name: "Steaked.OpenPoseEditor",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      origOnNodeCreated?.apply(this, arguments);
      _setupNode(this);
    };

    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      origOnConfigure?.apply(this, arguments);
      // Restore preview from saved image data after workflow load
      const imgW = this.widgets?.find((w) => w.name === "pose_image");
      if (imgW?.value) {
        _loadPreviewFromBase64(this, imgW.value);
      }
      setTimeout(() => app.graph?.setDirtyCanvas(true, true), 100);
    };

    // Ensure the node is big enough for the preview
    const origOnAdded = nodeType.prototype.onAdded;
    nodeType.prototype.onAdded = function () {
      origOnAdded?.apply(this, arguments);
      this.size[0] = Math.max(this.size[0], PREVIEW_SIZE + 40);
    };
  },
});

// ── Node setup ─────────────────────────────────────────────────────────────────

function _setupNode(node) {
  // 1. Hide the hidden widgets
  const HIDDEN = new Set(["pose_json", "pose_image"]);
  for (const w of node.widgets ?? []) {
    if (HIDDEN.has(w.name)) {
      w.computeSize = () => [0, -4];
      w.h = -4;
      w.serializeValue = async () => w.value ?? "";
    }
  }

  node._poseJsonWidget = node.widgets?.find((w) => w.name === "pose_json");
  node._poseImageWidget = node.widgets?.find((w) => w.name === "pose_image");

  // Preview image element
  node._previewImage = null;

  // 2. Add the "Open Editor" button
  _addEditorButton(node);
}

// ── Editor button ──────────────────────────────────────────────────────────────

function _addEditorButton(node) {
  const btn = node.addWidget("button", "open_editor", "🖼️ Open Pose Editor", () => {
    _openEditorModal(node);
  });

  btn.draw = function (ctx, n, widgetWidth, y, widgetHeight) {
    const h = widgetHeight ?? 26;
    const x = 15;
    const w = widgetWidth - 30;
    const r = 5;

    // Background
    ctx.fillStyle = "#1a3344";
    ctx.strokeStyle = "#2a6688";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.fill();
    ctx.stroke();

    // Label
    ctx.fillStyle = "#88ccee";
    ctx.font = "12px 'Segoe UI',Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🖼️ Open Pose Editor", x + w / 2, y + h / 2);
  };

  btn.serializeValue = async () => "";

  // 3. Override onDrawForeground for preview
  const origDraw = node.onDrawForeground;
  node.onDrawForeground = function (ctx) {
    origDraw?.apply(this, arguments);
    _drawPreview(ctx, node);
  };

  node._editorButton = btn;
}

// ── Preview rendering ──────────────────────────────────────────────────────────

function _loadPreviewFromBase64(node, b64) {
  if (!b64) return;
  const img = new Image();
  img.onload = () => {
    node._previewImage = img;
    app.graph?.setDirtyCanvas(true, true);
  };
  img.src = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
}

function _drawPreview(ctx, node) {
  if (!node._previewImage) {
    // Draw placeholder
    const yStart = _getPreviewY(node);
    if (yStart == null) return;
    ctx.fillStyle = "#1a1a1a";
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(15, yStart, PREVIEW_SIZE, PREVIEW_SIZE, 4);
    } else {
      ctx.rect(15, yStart, PREVIEW_SIZE, PREVIEW_SIZE);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#555";
    ctx.font = "12px 'Segoe UI',Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "No pose yet",
      15 + PREVIEW_SIZE / 2,
      yStart + PREVIEW_SIZE / 2
    );
    return;
  }

  const yStart = _getPreviewY(node);
  if (yStart == null) return;

  const img = node._previewImage;
  const ratio = Math.min(
    PREVIEW_SIZE / img.naturalWidth,
    PREVIEW_SIZE / img.naturalHeight
  );
  const dw = img.naturalWidth * ratio;
  const dh = img.naturalHeight * ratio;
  const dx = 15 + (PREVIEW_SIZE - dw) / 2;
  const dy = yStart + (PREVIEW_SIZE - dh) / 2;

  // Background
  ctx.fillStyle = "#000";
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(15, yStart, PREVIEW_SIZE, PREVIEW_SIZE, 4);
  } else {
    ctx.rect(15, yStart, PREVIEW_SIZE, PREVIEW_SIZE);
  }
  ctx.fill();

  // Image
  ctx.drawImage(img, dx, dy, dw, dh);

  // Border
  ctx.strokeStyle = "#2a6688";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(15, yStart, PREVIEW_SIZE, PREVIEW_SIZE, 4);
  } else {
    ctx.rect(15, yStart, PREVIEW_SIZE, PREVIEW_SIZE);
  }
  ctx.stroke();
}

function _getPreviewY(node) {
  // Position preview below the button widget
  const btn = node._editorButton;
  if (!btn) return null;
  // Find the button's last y position
  // LiteGraph stores widget y offsets internally
  // We calculate from node layout
  let y = 40; // start below title
  for (const w of node.widgets ?? []) {
    if (w === btn) {
      y += (w.computeSize?.()?.[1] ?? 26) + 4;
      break;
    }
    const h = w.computeSize?.();
    if (h && h[1] > 0) y += h[1] + 4;
  }
  return y;
}

// ── Editor modal ───────────────────────────────────────────────────────────────

function _openEditorModal(node) {
  // Create overlay
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,0.85)",
    zIndex: "100000",
    display: "flex",
    flexDirection: "column",
    fontFamily: "'Segoe UI',Arial,sans-serif",
  });

  // Top bar with save/close buttons
  const topBar = document.createElement("div");
  Object.assign(topBar.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 16px",
    background: "#1a1a2e",
    borderBottom: "1px solid #333",
    flexShrink: "0",
  });

  const title = document.createElement("span");
  title.textContent = "OpenPose Editor";
  title.style.cssText = "color:#88ccee; font-size:14px; font-weight:600;";

  const btnGroup = document.createElement("div");
  btnGroup.style.cssText = "display:flex; gap:8px;";

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "✅ Save & Close";
  Object.assign(saveBtn.style, {
    background: "#1a4422",
    color: "#88ee88",
    border: "1px solid #2a6633",
    borderRadius: "4px",
    padding: "6px 16px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "600",
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "✕ Cancel";
  Object.assign(cancelBtn.style, {
    background: "#441a1a",
    color: "#ee8888",
    border: "1px solid #663333",
    borderRadius: "4px",
    padding: "6px 16px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "600",
  });

  btnGroup.append(saveBtn, cancelBtn);
  topBar.append(title, btnGroup);

  // Iframe container
  const iframeWrap = document.createElement("div");
  Object.assign(iframeWrap.style, {
    flex: "1",
    position: "relative",
    overflow: "hidden",
  });

  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, {
    width: "100%",
    height: "100%",
    border: "none",
  });
  iframe.src = EDITOR_URL;

  iframeWrap.appendChild(iframe);
  overlay.append(topBar, iframeWrap);
  document.body.appendChild(overlay);

  // Prevent LiteGraph canvas from capturing events
  overlay.addEventListener("pointerdown", (e) => e.stopPropagation());
  overlay.addEventListener("mousedown", (e) => e.stopPropagation());

  // ── Message listener for this modal ────────────────────────────────────────
  let editorReady = false;

  function handleMessage(event) {
    const { data } = event;
    if (!data || data.cmd !== MSG_CMD) return;

    // Handle return messages
    if (data.type === "return" && data.method in _pendingReturns) {
      _pendingReturns[data.method](data.payload);
      delete _pendingReturns[data.method];
    }
  }

  window.addEventListener("message", handleMessage);

  // ── Wait for editor to be ready, then restore pose ────────────────────────
  const existingPoseJson = node._poseJsonWidget?.value;

  async function waitForEditor() {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        await _invokeCommand(iframe, "GetAppVersion");
        editorReady = true;
        break;
      } catch {
        // still loading...
      }
    }

    if (!editorReady) {
      console.warn("[Steaked OpenPose] Editor did not initialize in time");
      return;
    }

    // Restore existing pose if available
    if (existingPoseJson) {
      try {
        await _invokeCommand(iframe, "RestoreScene", existingPoseJson);
      } catch (e) {
        console.warn("[Steaked OpenPose] Failed to restore pose:", e);
      }
    }
  }

  waitForEditor();

  // ── Save & Close ───────────────────────────────────────────────────────────
  saveBtn.addEventListener("pointerdown", async () => {
    if (!editorReady) {
      alert("Editor is still loading, please wait...");
      return;
    }

    saveBtn.textContent = "Saving...";
    saveBtn.style.pointerEvents = "none";

    try {
      // Get scene data and pose image
      const [sceneData, images] = await Promise.all([
        _invokeCommand(iframe, "GetSceneData"),
        _invokeCommand(iframe, "MakeImages"),
      ]);

      const poseImageB64 = images?.pose;
      const poseJson = JSON.stringify(sceneData);

      // Store in hidden widgets
      if (node._poseJsonWidget) node._poseJsonWidget.value = poseJson;
      if (node._poseImageWidget) node._poseImageWidget.value = poseImageB64 ?? "";

      // Update preview
      if (poseImageB64) {
        _loadPreviewFromBase64(node, poseImageB64);
      }

      // Trigger re-execution
      app.graph?.setDirtyCanvas(true, true);

      // Close modal
      window.removeEventListener("message", handleMessage);
      overlay.remove();
    } catch (e) {
      console.error("[Steaked OpenPose] Save failed:", e);
      alert("Failed to save pose: " + (e?.message || e));
      saveBtn.textContent = "✅ Save & Close";
      saveBtn.style.pointerEvents = "auto";
    }
  });

  // ── Cancel ──────────────────────────────────────────────────────────────────
  cancelBtn.addEventListener("pointerdown", () => {
    window.removeEventListener("message", handleMessage);
    overlay.remove();
  });
}
