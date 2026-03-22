/**
 * save_widget.js  --  SaveImageToLibrary node UI
 *
 * Handles the character selector widget for the SaveImageToLibrary node.
 * - Auto mode: shows a greyed-out "Auto detect" label (no interaction needed).
 * - Manual mode: shows the selected character name; clicking opens a searchable
 *   picker populated from the library API.
 *
 * Two optional STRING widgets (character_id, character_name) store state and
 * are serialised into the workflow blob by ComfyUI's default mechanism.
 *
 * NOTE: The picker is built directly (no dependency on popups.js) and uses
 * pointerdown rather than click events, which avoids a known conflict between
 * LiteGraph's canvas mousedown capture and DOM click event generation.
 */

import { app } from "../../../scripts/app.js";
import { apiGet } from "./api.js";

// ─── Extension ────────────────────────────────────────────────────────────────

app.registerExtension({
  name: "Steaked.SaveImageToLibrary",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "SaveImageToLibrary") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      _setupNode(this);
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      onConfigure?.apply(this, arguments);
      // Widget values are already restored by ComfyUI at this point.
      // Just request a redraw so the selector label reflects the loaded state.
      setTimeout(() => app.graph?.setDirtyCanvas(true), 50);
    };
  },
});

// ─── Node setup ───────────────────────────────────────────────────────────────

function _setupNode(node) {
  // 1. Hide the raw character_id and character_name string widgets.
  //    computeSize → [0, -4] is the established project convention (library_widget.js:27).
  const HIDDEN = new Set(["character_id", "character_name"]);
  for (const w of node.widgets ?? []) {
    if (HIDDEN.has(w.name)) {
      w.computeSize = () => [0, -4];
      w.serializeValue = async () => w.value ?? "";
    }
  }

  // 2. Keep references for later reads/writes.
  node._charIdWidget   = node.widgets?.find(w => w.name === "character_id");
  node._charNameWidget = node.widgets?.find(w => w.name === "character_name");
  node._modeWidget     = node.widgets?.find(w => w.name === "mode");

  // 3. Add the visual selector widget.
  _addSelectorWidget(node);

  // 4. React to mode changes.
  if (node._modeWidget) {
    const origCb = node._modeWidget.callback;
    node._modeWidget.callback = function (value) {
      origCb?.call(this, value);
      app.graph?.setDirtyCanvas(true);
    };
  }
}

// ─── Selector widget ──────────────────────────────────────────────────────────

function _addSelectorWidget(node) {
  const btn = node.addWidget("button", "_charSelector", "", () => {
    if ((node._modeWidget?.value ?? "auto") === "manual") {
      _openCharPicker(node);
    }
  });

  // Override draw: render a styled label row instead of a plain button.
  btn.draw = function (ctx, n, widgetWidth, y, widgetHeight) {
    const mode   = n._modeWidget?.value ?? "auto";
    const isAuto = mode === "auto";

    const label = isAuto
      ? "Auto detect"
      : (n._charNameWidget?.value || n._charIdWidget?.value || "Click to select...");

    const h = widgetHeight ?? 22;
    const x = 15;
    const w = widgetWidth - 30;
    const r = 5;

    // Background
    ctx.fillStyle   = isAuto ? "#1e1e1e" : "#1e2a2a";
    ctx.strokeStyle = isAuto ? "#333"    : "#2d5050";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.fill();
    ctx.stroke();

    // Label
    ctx.fillStyle    = isAuto ? "#555" : "#7ab";
    ctx.font         = "11px 'Segoe UI',Arial,sans-serif";
    ctx.textAlign    = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 8, y + h / 2);

    // Dropdown arrow in manual mode
    if (!isAuto) {
      const ax = x + w - 12;
      const ay = y + h / 2;
      ctx.fillStyle = "#4a7070";
      ctx.beginPath();
      ctx.moveTo(ax - 4, ay - 2);
      ctx.lineTo(ax + 4, ay - 2);
      ctx.lineTo(ax,     ay + 3);
      ctx.closePath();
      ctx.fill();
    }
  };

  // Never include in widget_values serialisation.
  btn.serializeValue = async () => "";

  node._selectorWidget = btn;
}

// ─── Character picker ─────────────────────────────────────────────────────────

function _openCharPicker(node) {
  apiGet("/steaked/library/data")
    .then(data => {
      const chars = data?.characters ?? [];
      if (chars.length === 0) {
        alert("No characters in library.");
        return;
      }
      _showCharPicker(chars, (char) => {
        if (node._charIdWidget)   node._charIdWidget.value   = char.id   ?? "";
        if (node._charNameWidget) node._charNameWidget.value = char.name ?? char.id ?? "";
        app.graph?.setDirtyCanvas(true);
      });
    })
    .catch(err => {
      console.error("[SaveImageToLibrary] Failed to fetch library data:", err);
    });
}

/**
 * Show a self-contained character picker overlay.
 * Uses pointerdown instead of click to avoid LiteGraph canvas event capture
 * conflicts that can prevent click events from firing on overlaid DOM elements.
 */
function _showCharPicker(chars, onSelect) {
  const ov = document.createElement("div");
  Object.assign(ov.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,0.65)",
    zIndex: "100000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Segoe UI',Arial,sans-serif",
  });

  const pop = document.createElement("div");
  Object.assign(pop.style, {
    background: "#1e1e1e",
    border: "1px solid #3a3a3a",
    borderRadius: "8px",
    padding: "12px",
    maxWidth: "420px",
    width: "90vw",
    maxHeight: "70vh",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    boxShadow: "0 12px 48px rgba(0,0,0,0.85)",
    overflow: "hidden",
  });

  // Stop both pointer and click events so they don't bubble to the overlay.
  pop.addEventListener("pointerdown", e => e.stopPropagation());
  pop.addEventListener("click",       e => e.stopPropagation());

  const hdr = document.createElement("div");
  hdr.textContent = "Select Character";
  Object.assign(hdr.style, {
    fontSize: "11px", color: "#666",
    textTransform: "uppercase", letterSpacing: "0.06em",
  });

  const search = document.createElement("input");
  search.type        = "text";
  search.placeholder = "Search characters...";
  Object.assign(search.style, {
    background: "#141414", border: "1px solid #3a3a3a", borderRadius: "5px",
    color: "#ddd", padding: "8px 10px", fontSize: "12px", outline: "none",
    fontFamily: "'Segoe UI',Arial,sans-serif", width: "100%", boxSizing: "border-box",
  });

  const list = document.createElement("div");
  Object.assign(list.style, {
    overflowY: "auto", maxHeight: "50vh",
    display: "flex", flexDirection: "column", gap: "2px",
  });

  function close() {
    if (ov.parentNode) ov.parentNode.removeChild(ov);
  }

  function renderList(filter) {
    list.innerHTML = "";
    const filtered = filter
      ? chars.filter(c => (c.name || c.id).toLowerCase().includes(filter.toLowerCase()))
      : chars;

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.textContent = "No matches";
      Object.assign(empty.style, { padding: "16px", textAlign: "center", color: "#666", fontSize: "11px" });
      list.appendChild(empty);
      return;
    }

    for (const char of filtered) {
      const name = char.name || char.id;
      const row  = document.createElement("div");
      row.textContent = name;
      Object.assign(row.style, {
        padding: "8px 10px", borderRadius: "4px", cursor: "pointer",
        fontSize: "12px", lineHeight: "1.5", color: "#ccc",
        userSelect: "none",
      });
      row.addEventListener("mouseenter", () => { row.style.background = "#3a5050"; row.style.color = "#fff"; });
      row.addEventListener("mouseleave", () => { row.style.background = "transparent"; row.style.color = "#ccc"; });
      // Use pointerdown: fires before any canvas event capture can intercept it.
      row.addEventListener("pointerdown", e => {
        e.stopPropagation();
        e.preventDefault();
        close();
        onSelect(char);
      });
      list.appendChild(row);
    }
  }

  search.addEventListener("input", () => renderList(search.value));

  // Close when clicking the overlay background.
  ov.addEventListener("pointerdown", close);

  renderList("");
  pop.append(hdr, search, list);
  ov.appendChild(pop);
  document.body.appendChild(ov);
  setTimeout(() => search.focus(), 0);
}
