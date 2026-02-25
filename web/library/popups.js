/**
 * library/popups.js  –  HTML overlay popups (text editor + image metadata viewer).
 */

// ── Shared mk helper ──────────────────────────────────────────────────────────
function mk(tag, css, ...kids) {
  const e = document.createElement(tag);
  if (css) Object.assign(e.style, css);
  kids.flat().forEach((k) => k != null && e.append(typeof k === "string" ? document.createTextNode(k) : k));
  return e;
}

function overlay(onBgClick) {
  const ov = mk("div", {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,0.65)",
    zIndex: "100000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Segoe UI',Arial,sans-serif",
  });
  if (onBgClick)
    ov.addEventListener("click", (e) => {
      if (e.target === ov) onBgClick();
    });
  return ov;
}

const BTN_BASE = {
  padding: "5px 14px",
  borderRadius: "5px",
  border: "1px solid #3a3a3a",
  background: "#252525",
  color: "#999",
  cursor: "pointer",
  fontSize: "11px",
  fontFamily: "'Segoe UI',Arial,sans-serif",
};

// ── Text popup ────────────────────────────────────────────────────────────────
/**
 * Show a floating textarea / input popup.
 * @param {string} title
 * @param {string} initial  pre-filled value
 * @param {(v:string)=>void} onSave
 * @param {{ singleLine?: boolean }} opts
 */
export function textPopup(title, initial, onSave, { singleLine = false } = {}) {
  const ov = overlay(() => ov.remove());

  const pop = mk("div", {
    background: "#1e1e1e",
    border: "1px solid #3a3a3a",
    borderRadius: "8px",
    padding: "16px",
    maxWidth: "560px",
    width: "90vw",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    boxShadow: "0 12px 48px rgba(0,0,0,0.85)",
  });
  pop.addEventListener("click", (e) => e.stopPropagation());

  const hdr = mk(
    "div",
    { fontSize: "11px", color: "#666", textTransform: "uppercase", letterSpacing: "0.06em" },
    title,
  );

  let field;
  if (singleLine) {
    field = document.createElement("input");
    field.type = "text";
  } else {
    field = document.createElement("textarea");
    field.rows = 7;
  }
  field.value = initial ?? "";
  Object.assign(field.style, {
    background: "#141414",
    border: "1px solid #3a3a3a",
    borderRadius: "5px",
    color: "#ddd",
    padding: "8px 10px",
    fontSize: "12px",
    fontFamily: singleLine ? "'Segoe UI',Arial,sans-serif" : "'Consolas','Courier New',monospace",
    resize: singleLine ? "none" : "vertical",
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
    lineHeight: "1.5",
  });
  field.addEventListener("focus", () => (field.style.borderColor = "#555"));
  field.addEventListener("blur", () => (field.style.borderColor = "#3a3a3a"));

  const hint = mk(
    "div",
    { fontSize: "10px", color: "#444" },
    singleLine ? "Enter to confirm, Escape to cancel" : "Ctrl+Enter to save, Escape to cancel",
  );

  const btns = mk("div", { display: "flex", gap: "8px", justifyContent: "flex-end" });
  const cancelBtn = mk("button", { ...BTN_BASE }, "Cancel");
  const saveBtn = mk("button", { ...BTN_BASE, background: "#2a2a2a", color: "#ccc", borderColor: "#555" }, "Save");
  cancelBtn.onmouseenter = () => (cancelBtn.style.background = "#2e2e2e");
  cancelBtn.onmouseleave = () => (cancelBtn.style.background = "#252525");
  saveBtn.onmouseenter = () => (saveBtn.style.background = "#333");
  saveBtn.onmouseleave = () => (saveBtn.style.background = "#2a2a2a");

  const doSave = () => {
    onSave(field.value);
    ov.remove();
  };
  cancelBtn.onclick = () => ov.remove();
  saveBtn.onclick = doSave;
  field.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      ov.remove();
    }
    if (e.key === "Enter" && (singleLine || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      doSave();
    }
  });

  btns.append(cancelBtn, saveBtn);
  pop.append(hdr, field, hint, btns);
  ov.appendChild(pop);
  document.body.appendChild(ov);
  setTimeout(() => {
    field.focus();
    if (!singleLine) field.setSelectionRange(0, 0);
  }, 0);
}

// ── Image metadata popup ──────────────────────────────────────────────────────
async function _parsePngMeta(url) {
  try {
    const buf = await fetch(url).then((r) => r.arrayBuffer());
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    if (dv.getUint32(0) !== 0x89504e47) return {};
    const dec = new TextDecoder(),
      out = {};
    let off = 8;
    while (off + 12 <= u8.length) {
      const len = dv.getUint32(off);
      const type = dec.decode(u8.slice(off + 4, off + 8));
      if (type === "tEXt" || type === "iTXt") {
        const d = u8.slice(off + 8, off + 8 + len);
        const nul = d.indexOf(0);
        if (nul >= 0) out[dec.decode(d.slice(0, nul))] = dec.decode(d.slice(nul + 1));
      }
      if (type === "IEND") break;
      off += 12 + len;
    }
    return out;
  } catch {
    return {};
  }
}

export async function showImageMeta(src, filename) {
  // ── Parse metadata ──────────────────────────────────────────────────────────
  let hasMeta = false;
  let libSnap = null; // { char_name, model, loras, style_tags, base_prompt, combined, negative }
  let fallbackModel = null;
  const textNodes = []; // { title, text } — from CLIPTextEncode etc.

  try {
    const meta = await _parsePngMeta(src);
    if (meta.prompt) {
      hasMeta = true;
      const pd = JSON.parse(meta.prompt);

      // Build a set of every node-id that is referenced as an input by any other node.
      // This tells us which nodes are actually "wired up" in the workflow.
      const referencedIds = new Set();
      for (const node of Object.values(pd)) {
        for (const val of Object.values(node.inputs ?? {})) {
          if (Array.isArray(val) && val.length === 2 && typeof val[0] === "string") referencedIds.add(val[0]);
        }
      }

      for (const [nodeId, node] of Object.entries(pd)) {
        const inp = node.inputs ?? {};
        const cls = node.class_type ?? "";

        // ── Prompt Library / SteakedLibrary snap ──────────────────────────────
        if (cls === "SteakedLibrary") {
          // New format: snap_data JSON blob
          if (inp.snap_data) {
            try {
              libSnap = JSON.parse(inp.snap_data);
            } catch {}
          }
          // Old format (7 individual fields) — backward compat
          if (!libSnap && (inp.snap_model || inp.snap_combined)) {
            let loras = [];
            try {
              loras = JSON.parse(inp.snap_loras ?? "[]");
            } catch {}
            libSnap = {
              char_name: inp.snap_char_name ?? "",
              model: inp.snap_model ?? "",
              loras,
              style_tags: inp.snap_style_tags ?? "",
              base_prompt: inp.snap_base_prompt ?? "",
              combined: inp.snap_combined ?? "",
              negative: inp.snap_negative ?? "",
            };
          }
          continue;
        }

        // ── Other checkpoint loaders ──────────────────────────────────────────
        if (cls === "CheckpointLoaderSimple" || cls === "UNETLoader")
          fallbackModel = inp.ckpt_name ?? inp.unet_name ?? fallbackModel;

        // ── Text source nodes ─────────────────────────────────────────────────
        // Skip CLIPTextEncode (it's an encoder, its text input is usually a reference).
        // For everything else: if the node has a literal text string input AND is
        // referenced by another node, it's a meaningful text source to display.
        if (cls === "CLIPTextEncode") continue;

        const txt = inp.text;
        if (typeof txt === "string" && txt.trim() && referencedIds.has(nodeId))
          textNodes.push({ title: node._meta?.title ?? cls, text: txt.trim() });
      }
    }
  } catch {}

  // ── Build popup ─────────────────────────────────────────────────────────────
  const ov = overlay(() => ov.remove());
  ov.style.background = "rgba(0,0,0,0.75)";

  const pop = mk("div", {
    background: "#1e1e1e",
    border: "1px solid #3a3a3a",
    borderRadius: "8px",
    maxWidth: "660px",
    width: "92vw",
    maxHeight: "86vh",
    boxShadow: "0 16px 60px rgba(0,0,0,0.9)",
    display: "flex",
    flexDirection: "column",
  });
  pop.addEventListener("click", (e) => e.stopPropagation());

  const closeBtn = mk(
    "button",
    { background: "none", border: "none", color: "#555", fontSize: "18px", cursor: "pointer", padding: "0 4px" },
    "✕",
  );
  closeBtn.onmouseenter = () => (closeBtn.style.color = "#f77");
  closeBtn.onmouseleave = () => (closeBtn.style.color = "#555");
  closeBtn.onclick = () => ov.remove();

  const hdr = mk(
    "div",
    { display: "flex", alignItems: "center", padding: "10px 12px 8px", borderBottom: "1px solid #2e2e2e" },
    mk(
      "span",
      {
        flex: "1",
        fontSize: "11px",
        color: "#666",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      filename,
    ),
    closeBtn,
  );

  const body = mk("div", {
    padding: "14px",
    display: "flex",
    gap: "14px",
    alignItems: "flex-start",
    overflowY: "auto",
  });

  // Thumbnail
  const imgLink = document.createElement("a");
  imgLink.href = src;
  imgLink.target = "_blank";
  imgLink.style.cssText = "flex-shrink:0;display:block;";
  const imgEl = document.createElement("img");
  imgEl.src = src;
  imgEl.alt = "";
  imgEl.style.cssText = "width:220px;height:auto;border-radius:6px;display:block;border:1px solid #333;";
  imgLink.appendChild(imgEl);
  body.appendChild(imgLink);

  const info = mk("div", { flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "10px" });

  const sec = (label, content) => {
    const wrap = mk("div", {});
    wrap.appendChild(
      mk(
        "div",
        { fontSize: "9px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px" },
        label,
      ),
    );
    wrap.appendChild(content);
    return wrap;
  };
  const txt = (t, color = "#bbb") =>
    mk(
      "div",
      {
        fontSize: "11px",
        color,
        lineHeight: "1.45",
        background: "#171717",
        borderRadius: "4px",
        padding: "5px 7px",
        wordBreak: "break-word",
      },
      t,
    );

  if (!hasMeta) {
    info.appendChild(
      mk(
        "p",
        { fontSize: "12px", color: "#555", fontStyle: "italic", margin: "0" },
        "No embedded metadata found. Click thumbnail to open full-size.",
      ),
    );
  } else if (libSnap) {
    // ── Prompt Library block ────────────────────────────────────────────────
    if (libSnap.char_name)
      info.appendChild(
        sec("Character", mk("div", { fontSize: "13px", color: "#eee", fontWeight: "600" }, libSnap.char_name)),
      );

    const modelName = (libSnap.model || fallbackModel || "").split(/[/\\]/).pop();
    if (modelName) info.appendChild(sec("Model", mk("div", { fontSize: "12px", color: "#ddd" }, modelName)));

    if (libSnap.loras?.length) {
      const loraList = mk("div", { display: "flex", flexDirection: "column", gap: "3px" });
      for (const l of libSnap.loras) {
        const fname = (l.file ?? "").split(/[/\\]/).pop();
        const str = l.strength !== l.clip_strength ? `${l.strength} / ${l.clip_strength}` : String(l.strength ?? 1);
        loraList.appendChild(
          mk(
            "div",
            {
              fontSize: "11px",
              color: "#bbb",
              display: "flex",
              justifyContent: "space-between",
              background: "#171717",
              borderRadius: "4px",
              padding: "3px 7px",
            },
            mk("span", { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1" }, fname),
            mk("span", { color: "#666", marginLeft: "8px", flexShrink: "0" }, str),
          ),
        );
      }
      info.appendChild(sec("LoRAs", loraList));
    }

    if (libSnap.combined) info.appendChild(sec("Combined Prompt", txt(libSnap.combined, "#b8c8b8")));
    else if (libSnap.base_prompt) info.appendChild(sec("Base Prompt", txt(libSnap.base_prompt)));

    if (libSnap.style_tags) info.appendChild(sec("Style Tags", txt(libSnap.style_tags, "#a0b0c0")));

    if (libSnap.negative) info.appendChild(sec("Negative Prompt", txt(libSnap.negative, "#c08080")));

    // Additional text source nodes in the workflow (TextConcat typed text,
    // PrimitiveText, any third-party node with a literal text input)
    for (const { title, text } of textNodes) info.appendChild(sec(title, txt(text, "#b0a8c0")));
  } else {
    // ── Generic ComfyUI workflow fallback ────────────────────────────────────
    const modelName = (fallbackModel ?? "").split(/[/\\]/).pop();
    if (modelName) info.appendChild(sec("Model", mk("div", { fontSize: "12px", color: "#ddd" }, modelName)));
    if (!modelName && !textNodes.length)
      info.appendChild(
        mk(
          "p",
          { fontSize: "12px", color: "#555", fontStyle: "italic", margin: "0" },
          "Workflow found but no text nodes detected.",
        ),
      );
    for (const { title, text } of textNodes) info.appendChild(sec(title, txt(text)));
  }

  body.appendChild(info);
  pop.append(hdr, body);
  ov.appendChild(pop);
  document.body.appendChild(ov);
}

// ── Generation capture toast ──────────────────────────────────────────────────
let _captureToast = null;

export function showCaptureToast(charName, onSave, onDismiss, imageCount = 1) {
  if (_captureToast) _captureToast.remove();

  const toast = mk("div", {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    background: "#1e1e1e",
    border: "1px solid #3a5050",
    borderRadius: "8px",
    padding: "12px 14px",
    zIndex: "100001",
    minWidth: "260px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
    fontFamily: "'Segoe UI',Arial,sans-serif",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  });
  _captureToast = toast;

  const imgLabel = imageCount > 1 ? `${imageCount} images` : "1 image";
  toast.appendChild(mk("div", { fontSize: "11px", color: "#7ab" }, "📸 Generation complete"));
  toast.appendChild(mk("div", { fontSize: "12px", color: "#ccc" }, `Save ${imgLabel} to "${charName}"?`));

  const row = mk("div", { display: "flex", gap: "8px" });
  const yes = mk(
    "button",
    { ...BTN_BASE, background: "#1e2e2e", color: "#7ab", borderColor: "#3a5050" },
    `Save ${imageCount > 1 ? "all" : ""}`,
  );
  const no = mk("button", { ...BTN_BASE }, "Dismiss");
  yes.onmouseenter = () => (yes.style.background = "#253535");
  yes.onmouseleave = () => (yes.style.background = "#1e2e2e");
  no.onmouseenter = () => (no.style.background = "#2e2e2e");
  no.onmouseleave = () => (no.style.background = "#252525");
  yes.onclick = () => {
    toast.remove();
    _captureToast = null;
    onSave();
  };
  no.onclick = () => {
    toast.remove();
    _captureToast = null;
    onDismiss?.();
  };
  row.append(yes, no);
  toast.appendChild(row);

  document.body.appendChild(toast);
  setTimeout(() => {
    if (_captureToast === toast) {
      toast.remove();
      _captureToast = null;
    }
  }, 12000);
}
