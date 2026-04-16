/**
 * openpose_editor_widget.js -- OpenPose Editor node UI
 *
 * Provides a button to launch a full-screen 3D OpenPose editor (iframe),
 * communicates via postMessage, persists pose state via localStorage + hidden widgets,
 * and renders a thumbnail preview on the node.
 *
 * Pose restoration strategy:
 *   1. Before opening the iframe, save pose JSON to localStorage
 *      (key: 'steaked_openpose_scene') so the editor can find it
 *   2. After the editor initializes, call RestoreLastSavedScene via postMessage
 *   3. The editor's own auto-save keeps the scene up-to-date in localStorage
 *
 * Image output strategy:
 *   The rendered pose PNG is uploaded to ComfyUI's /upload/image endpoint.
 *   The hidden widget stores only the filename (not base64), so the Python
 *   backend reads the file directly from disk.
 */

import { app } from "../../scripts/app.js";

// ── Constants ──────────────────────────────────────────────────────────────────
const NODE_NAME = "OpenPoseEditor";
const EDITOR_URL = "/steaked/openpose/editor";
const PREVIEW_SIZE = 220;

// postMessage protocol (matches useMessageDispatch in the editor)
const MSG_CMD = "openpose-3d";
// localStorage key for pose scene data
const LS_POSE_KEY = "openpose_scene";
const DEFAULT_POSE_FILENAME = "openpose_pose.png";

// ── Promise-based command invocation ───────────────────────────────────────────
const _pendingReturns = {};

function _invokeCommand(iframe, method, timeoutOrArg, ...rest) {
  // _invokeCommand(iframe, method, ...args) → 15s timeout
  // _invokeCommand(iframe, method, timeoutMs, ...args) → custom timeout
  let timeout, args;
  if (typeof timeoutOrArg === "number") {
    timeout = timeoutOrArg;
    args = rest;
  } else {
    timeout = 15000;
    args = [timeoutOrArg, ...rest];
  }

  return new Promise((resolve, reject) => {
    const tid = setTimeout(() => {
      delete _pendingReturns[method];
      reject({ method, status: "Timeout" });
    }, timeout);

    _pendingReturns[method] = (value) => {
      clearTimeout(tid);
      resolve(value);
    };

    iframe.contentWindow.postMessage(
      { cmd: MSG_CMD, method, type: "call", payload: args },
      "*"
    );
  });
}

// ── Image upload helper ────────────────────────────────────────────────────────

/**
 * Upload a base64 data-URL PNG to ComfyUI's /upload/image endpoint.
 * Returns the stored filename on success.
 */
async function _uploadPoseImage(dataUrl) {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();

  const form = new FormData();
  form.append("image", blob, "openpose_pose.png");
  form.append("subfolder", "openpose");
  form.append("overwrite", "true");

  const uploadResp = await fetch("/upload/image", { method: "POST", body: form });
  if (!uploadResp.ok) throw new Error("Upload failed: " + uploadResp.status);
  const data = await uploadResp.json();
  console.log("[Steaked OpenPose] Upload response:", JSON.stringify(data));
  return data.name;
}

/**
 * Build a ComfyUI /view URL for a given filename in our subfolder.
 */
function _poseImageUrl(filename, cacheBust) {
  if (!filename) return null;
  let url = "/view?filename=" + encodeURIComponent(filename) + "&subfolder=openpose&type=input";
  if (cacheBust !== false) url += "&t=" + Date.now();
  return url;
}

// ── Preview helpers ────────────────────────────────────────────────────────────

function _loadPreviewFromUrl(node, url) {
  if (!url) return;
  const img = new Image();
  img.onload = () => {
    node._previewImage = img;
    app.graph?.setDirtyCanvas(true, true);
  };
  img.onerror = () => {
    console.warn("[Steaked OpenPose] Preview failed to load:", url);
  };
  img.src = url;
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
      // Try loading the default pose image preview on first creation
      _loadPreviewFromUrl(this, _poseImageUrl(DEFAULT_POSE_FILENAME));
    };

    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      origOnConfigure?.apply(this, arguments);
      setTimeout(() => {
        const imgW = this.widgets?.find((w) => w.name === "pose_image");
        const filename = imgW?.value || DEFAULT_POSE_FILENAME;
        _loadPreviewFromUrl(this, _poseImageUrl(filename));
        app.graph?.setDirtyCanvas(true, true);
      }, 150);
    };

    const origOnAdded = nodeType.prototype.onAdded;
    nodeType.prototype.onAdded = function () {
      origOnAdded?.apply(this, arguments);
      this.size[0] = Math.max(this.size[0], PREVIEW_SIZE + 40);
    };
  },
});

// ── Node setup ─────────────────────────────────────────────────────────────────

function _setupNode(node) {
  const HIDDEN = new Set(["pose_json", "pose_image"]);
  for (const w of node.widgets ?? []) {
    if (HIDDEN.has(w.name)) {
      w.computeSize = () => [0, -4];
      w.h = -4;
      w.serializeValue = async () => {
        const val = w.value ?? "";
        console.log(`[Steaked OpenPose] Serializing ${w.name}: '${val.substring(0, 80)}'`);
        return val;
      };
    }
  }

  node._poseJsonWidget = node.widgets?.find((w) => w.name === "pose_json");
  node._poseImageWidget = node.widgets?.find((w) => w.name === "pose_image");
  node._previewImage = null;

  _addEditorButton(node);
}

// ── Buttons + preview ──────────────────────────────────────────────────────────

function _addEditorButton(node) {
  const btn = node.addWidget("button", "open_editor", "Open Pose Editor", () => {
    _openEditorModal(node);
  });

  btn.draw = function (ctx, n, widgetWidth, y, widgetHeight) {
    const h = widgetHeight ?? 26, x = 15, w = widgetWidth - 30, r = 5;
    ctx.fillStyle = "#1a3344"; ctx.strokeStyle = "#2a6688"; ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#88ccee"; ctx.font = "12px 'Segoe UI',Arial,sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("Open Pose Editor", x + w / 2, y + h / 2);
  };
  btn.serializeValue = async () => "";

  // Preview
  const origDraw = node.onDrawForeground;
  node.onDrawForeground = function (ctx) {
    origDraw?.apply(this, arguments);
    _drawPreview(ctx, node);
  };

  node._editorButton = btn;
}

// ── Preview rendering ──────────────────────────────────────────────────────────

function _drawPreview(ctx, node) {
  const yStart = _getPreviewY(node);
  if (yStart == null) return;

  ctx.fillStyle = "#000";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(15, yStart, PREVIEW_SIZE, PREVIEW_SIZE, 4);
  else ctx.rect(15, yStart, PREVIEW_SIZE, PREVIEW_SIZE);
  ctx.fill();

  if (!node._previewImage) {
    ctx.strokeStyle = "#333"; ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(15, yStart, PREVIEW_SIZE, PREVIEW_SIZE, 4);
    else ctx.rect(15, yStart, PREVIEW_SIZE, PREVIEW_SIZE);
    ctx.stroke();
    ctx.fillStyle = "#555"; ctx.font = "12px 'Segoe UI',Arial,sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("No pose yet", 15 + PREVIEW_SIZE / 2, yStart + PREVIEW_SIZE / 2);
    return;
  }

  const img = node._previewImage;
  const ratio = Math.min(PREVIEW_SIZE / img.naturalWidth, PREVIEW_SIZE / img.naturalHeight);
  const dw = img.naturalWidth * ratio, dh = img.naturalHeight * ratio;
  const dx = 15 + (PREVIEW_SIZE - dw) / 2, dy = yStart + (PREVIEW_SIZE - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);

  ctx.strokeStyle = "#2a6688"; ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(15, yStart, PREVIEW_SIZE, PREVIEW_SIZE, 4);
  else ctx.rect(15, yStart, PREVIEW_SIZE, PREVIEW_SIZE);
  ctx.stroke();
}

function _getPreviewY(node) {
  const btn = node._editorButton;
  if (!btn) return null;
  let y = 40;
  for (const w of node.widgets ?? []) {
    const h = w.computeSize?.();
    if (w === btn) { y += (h?.[1] ?? 26) + 4; break; }
    if (h && h[1] > 0) y += h[1] + 4;
  }
  return y;
}

// ── Connected image helper ─────────────────────────────────────────────────────

async function _getConnectedImageBase64(node) {
  const inp = node.inputs?.find((i) => i.name === "image");
  if (!inp?.link) return null;
  const link = app.graph?.links?.[inp.link];
  if (!link) return null;
  const srcNode = app.graph?.getNodeById(link.origin_id);
  if (!srcNode?.imgs?.length) return null;
  const img = srcNode.imgs[0];
  if (!(img instanceof HTMLImageElement) && !(img instanceof HTMLCanvasElement)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

// ── Editor modal ───────────────────────────────────────────────────────────────

function _openEditorModal(node, autoDetect = false) {
  // ── Before opening: save pose to localStorage ──
  const existingPoseJson = node._poseJsonWidget?.value;
  if (existingPoseJson) {
    try {
      // Write to both keys the editor uses for RestoreLastSavedScene
      localStorage.setItem("AutoSaveSceneData", existingPoseJson);
      localStorage.setItem("LastSceneData", existingPoseJson);
    } catch (e) {
      console.warn("[Steaked OpenPose] localStorage write failed:", e);
    }
  }

  // ── Build DOM ──
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", background: "rgba(0,0,0,0.85)",
    zIndex: "100000", display: "flex", flexDirection: "column",
    fontFamily: "'Segoe UI',Arial,sans-serif",
  });

  const topBar = document.createElement("div");
  Object.assign(topBar.style, {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 16px", background: "#1a1a2e", borderBottom: "1px solid #333",
    flexShrink: "0",
  });

  const title = document.createElement("span");
  title.textContent = "OpenPose Editor";
  title.style.cssText = "color:#88ccee; font-size:14px; font-weight:600;";

  const btnGroup = document.createElement("div");
  btnGroup.style.cssText = "display:flex; gap:8px;";

  function makeBtn(text, bg, fg, border) {
    const b = document.createElement("button");
    b.textContent = text;
    Object.assign(b.style, {
      background: bg, color: fg, border: "1px solid " + border,
      borderRadius: "4px", padding: "6px 16px", cursor: "pointer",
      fontSize: "13px", fontWeight: "600",
    });
    return b;
  }

  const detectBtn = makeBtn("\uD83D\uDD0D Detect from Image", "#2a1a44", "#bb88ee", "#553388");
  detectBtn.style.display = "none";
  const saveBtn = makeBtn("\u2705 Save & Close", "#1a4422", "#88ee88", "#2a6633");
  const cancelBtn = makeBtn("\u2715 Cancel", "#441a1a", "#ee8888", "#663333");

  btnGroup.append(detectBtn, saveBtn, cancelBtn);
  topBar.append(title, btnGroup);

  const iframeWrap = document.createElement("div");
  Object.assign(iframeWrap.style, { flex: "1", position: "relative", overflow: "hidden" });

  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, { width: "100%", height: "100%", border: "none" });
  iframe.src = EDITOR_URL;

  iframeWrap.appendChild(iframe);
  overlay.append(topBar, iframeWrap);
  document.body.appendChild(overlay);

  overlay.addEventListener("pointerdown", (e) => e.stopPropagation());
  overlay.addEventListener("mousedown", (e) => e.stopPropagation());

  // ── Message handling ──
  let editorReady = false;

  function handleMessage(event) {
    const { data } = event;
    if (!data || data.cmd !== MSG_CMD) return;
    if (data.type === "return" && data.method in _pendingReturns) {
      _pendingReturns[data.method](data.payload);
      delete _pendingReturns[data.method];
    }
  }
  window.addEventListener("message", handleMessage);

  // ── Wait for editor, then restore ──
  async function waitForEditor() {
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const data = await _invokeCommand(iframe, "GetSceneData");
        if (data?.object?.bodies != null) { editorReady = true; break; }
      } catch { /* loading */ }
    }

    if (!editorReady) { console.warn("[Steaked OpenPose] Editor timeout"); return; }

    // Give the editor time to finish its init (AutoSaveScene reads our localStorage)
    await new Promise((r) => setTimeout(r, 1000));

    // Restore using the editor's own mechanism (reads from localStorage)
    try {
      await _invokeCommand(iframe, "RestoreLastSavedScene");
      console.log("[Steaked OpenPose] Restored via RestoreLastSavedScene");
    } catch (e) {
      // Fallback
      if (existingPoseJson) {
        try {
          await _invokeCommand(iframe, "RestoreScene", existingPoseJson);
          console.log("[Steaked OpenPose] Restored via RestoreScene fallback");
        } catch (e2) {
          console.warn("[Steaked OpenPose] Restore failed:", e2);
        }
      }
    }

    // Check for connected image
    const connectedImage = await _getConnectedImageBase64(node);
    if (connectedImage) detectBtn.style.display = "inline-block";

    if (autoDetect && connectedImage) {
      await _runDetection(iframe, detectBtn, connectedImage);
    }
  }

  waitForEditor();

  // ── Detection ──
  async function _runDetection(iframe, btn, imageDataUrl) {
    btn.textContent = "\uD83D\uDD0D Detecting... (first run downloads model)";
    btn.style.pointerEvents = "none";
    try {
      const result = await _invokeCommand(iframe, "DetectFromImage", 60000, imageDataUrl);
      if (result?.error) {
        const msg = result.error.length > 200 ? result.error.substring(0, 200) + "..." : result.error;
        alert("Detection: " + msg);
      }
    } catch (e) {
      alert("Detection timed out or failed. The MediaPipe model may still be downloading — try again.");
    }
    btn.textContent = "\uD83D\uDD0D Detect from Image";
    btn.style.pointerEvents = "auto";
  }

  detectBtn.addEventListener("pointerdown", async () => {
    if (!editorReady) { alert("Editor still loading..."); return; }
    const img = await _getConnectedImageBase64(node);
    if (!img) { alert("No image connected."); return; }
    await _runDetection(iframe, detectBtn, img);
  });

  // ── Save & Close ──
  saveBtn.addEventListener("pointerdown", async () => {
    if (!editorReady) { alert("Editor still loading..."); return; }
    saveBtn.textContent = "Saving..."; saveBtn.style.pointerEvents = "none";

    try {
      const [sceneData, images] = await Promise.all([
        _invokeCommand(iframe, "GetSceneData"),
        _invokeCommand(iframe, "MakeImages"),
      ]);

      const poseImageB64 = images?.pose;
      const poseJson = JSON.stringify(sceneData);

      console.log("[Steaked OpenPose] Pose image length:", poseImageB64?.length ?? 0);

      // Upload image to ComfyUI → get filename
      let filename = "";
      if (poseImageB64) {
        filename = await _uploadPoseImage(poseImageB64);
        console.log("[Steaked OpenPose] Uploaded filename:", filename);
      }

      // Store in hidden widgets
      if (node._poseJsonWidget) node._poseJsonWidget.value = poseJson;
      if (node._poseImageWidget) node._poseImageWidget.value = filename;

      // Update preview from server
      if (filename) {
        _loadPreviewFromUrl(node, _poseImageUrl(filename));
      }

      // Save to localStorage for next open
      try { localStorage.setItem(LS_POSE_KEY, poseJson); } catch {}

      app.graph?.setDirtyCanvas(true, true);
      window.removeEventListener("message", handleMessage);
      overlay.remove();
    } catch (e) {
      console.error("[Steaked OpenPose] Save failed:", e);
      alert("Failed to save: " + (e?.message || e));
      saveBtn.textContent = "\u2705 Save & Close"; saveBtn.style.pointerEvents = "auto";
    }
  });

  // ── Cancel ──
  cancelBtn.addEventListener("pointerdown", () => {
    window.removeEventListener("message", handleMessage);
    overlay.remove();
  });
}