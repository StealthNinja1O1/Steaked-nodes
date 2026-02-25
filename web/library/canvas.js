/**
 * library/canvas.js  –  LibraryCanvas class: state, events and all view drawing.
 *
 * New features vs the original single-file version:
 *  • Folders: characters can belong to named folders; folders collapse/expand.
 *  • Notes field per character.
 *  • Drag-to-reorder: gallery images and character cards.
 *  • Export / Import library as ZIP.
 *  • Generation capture: toast appears after each run offering to save the output image.
 */
import { app } from "../../../scripts/app.js";
import { C, M, ROW, SEC, GAP, R } from "./theme.js";
import {
  rrect,
  label,
  drawSec,
  drawBtn,
  drawCombo,
  drawNumBox,
  drawToggle,
  drawTextArea,
  drawIcon,
  getImg,
  evictImg,
  drawImgCropped,
  drawPlaceholder,
} from "./draw.js";
import { apiGet, apiPost, clamp, uid, downloadBlob, comfyImageUrl } from "./api.js";
import { textPopup, showImageMeta, showCaptureToast } from "./popups.js";
import { showLoraInfo } from "./civitai.js";

// Module-level set of all live instances — used by generation capture
export const _instances = new Set();

// ─── Hardcoded output names (must match character_library.py RETURN_NAMES) ────
const OUTPUT_NAMES = ["model", "clip", "vae", "style_tags", "base_prompt", "combined", "negative"];

export class LibraryCanvas {
  constructor(node) {
    this.node = node;
    this.data = { base: { checkpoint: "", loras: [] }, characters: [] };
    this.assets = { checkpoints: [], loras: [] };
    this.view = "base";
    this.charId = null;
    this.charSearch = "";
    this.scrollY = 0;
    this.totalH = 0;
    this.hover = null;
    this.controls = {};
    this.drag = null; // { startX, startVal, onChange } for number-scrub
    this.reorderDrag = null; // drag-to-reorder state
    this.clickPending = null; // deferred action for draggable controls
    this.collapsedFolders = new Set();
    this.collapsedBase = new Set(); // keys: "checkpoint", "loras"
    this.collapsedChar = new Set(); // keys: "model-override", "char-loras", "style-tags", "base-prompt", "text-blocks", "negative", "notes", "gallery"
    this.tooltipEl = null;
    this.tooltipTimer = null;
    // Layout snapshots written during draw, read during mouse events
    this._galLayout = null;
    this._tbLayout = null; // text-block drag layout
    this._folderZones = [];

    _instances.add(this);

    const self = this;
    node.onDrawForeground = function (ctx) {
      if (!this.flags?.collapsed) self.draw(ctx);
    };
    node.onMouseDown = function (e) {
      if (e.canvasY - this.pos[1] < 0) return false;
      return self.onMouseDown(e);
    };
    node.onMouseMove = function (e) {
      self.onMouseMove(e);
      return false;
    };
    node.onMouseUp = function (e) {
      return self.onMouseUp(e);
    };

    node.setSize([360, 700]);

    // Capture-phase wheel listener so we intercept before ComfyUI's zoom handler
    this._wheelHandler = (e) => {
      const cv = app.canvas;
      if (!cv) return;
      const r = cv.canvas.getBoundingClientRect();
      const sx = (e.clientX - r.left) / cv.ds.scale - cv.ds.offset[0];
      const sy = (e.clientY - r.top) / cv.ds.scale - cv.ds.offset[1];
      const TH = LiteGraph.NODE_TITLE_HEIGHT;
      if (sx < node.pos[0] || sx > node.pos[0] + node.size[0]) return;
      if (sy < node.pos[1] - TH || sy > node.pos[1] + node.size[1]) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.onWheel(e);
    };
    app.canvas?.canvas?.addEventListener("wheel", this._wheelHandler, { passive: false, capture: true });

    node.onRemoved = () => {
      app.canvas?.canvas?.removeEventListener("wheel", this._wheelHandler, { capture: true });
      _instances.delete(this);
    };

    // Store output names before blanking slot labels
    const _outNames = node.constructor._steakedOutputNames ?? [];
    if (node.outputs) {
      node.outputs.forEach((o, i) => {
        const nm = _outNames[i] || o.localized_name || o.name || o.type || "";
        o._origName = nm && nm !== o.type ? nm : o.type || "";
        o.name = o.localized_name = "";
      });
    }
    this._load();
  }

  // ── Data ────────────────────────────────────────────────────────────────────
  _load() {
    return Promise.all([
      apiGet("/steaked/library/checkpoints").catch(() => []),
      apiGet("/steaked/library/loras").catch(() => []),
      apiGet("/steaked/library/data").catch(() => ({ base: { checkpoint: "", loras: [] }, characters: [] })),
    ])
      .then(([ckpts, loras, data]) => {
        this.assets = { checkpoints: ckpts, loras };
        this.data = data;
        this._syncWidgetFromState();
        app.graph?.setDirtyCanvas(true);
      })
      .catch((e) => console.error("[SteakedLib] load:", e));
  }

  async _save() {
    this._syncWidgetFromState();
    await apiPost("/steaked/library/data", this.data).catch((e) => console.error("[SteakedLib] save:", e));
    app.graph?.setDirtyCanvas(true);
  }

  _syncWidgetFromState() {
    const node = this.node;
    const setW = (name, val) => {
      const w = node.widgets?.find((w) => w.name === name);
      if (w) w.value = String(val ?? "");
    };
    setW("selected_character", this.charId ?? "");

    const ch = this._char;
    let snap = {};
    if (ch) {
      const ov = ch.model_override ?? {};
      const base = this.data.base ?? {};
      const useOv = ov.enabled && ov.checkpoint;
      const loras = useOv ? (ov.loras ?? []) : [...(base.loras ?? []), ...(ov.loras ?? [])];
      const activeLoras = loras
        .filter((l) => l.enabled !== false && l.file)
        .map((l) => ({ file: l.file, strength: l.strength ?? 1, clip_strength: l.clip_strength ?? l.strength ?? 1 }));
      const clean = (s) => (s || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      const blocks = (ch.text_blocks ?? [])
        .filter((b) => b.enabled !== false && (b.text ?? "").trim())
        .map((b) => clean(b.text));
      const parts = [clean(ch.style_tags), clean(ch.base_prompt), ...blocks].filter(Boolean);
      snap = {
        char_name: ch.name ?? "",
        model: useOv ? ov.checkpoint : (base.checkpoint ?? ""),
        loras: activeLoras,
        style_tags: ch.style_tags ?? "",
        base_prompt: ch.base_prompt ?? "",
        combined: parts.join(", "),
        negative: ch.negative ?? "",
      };
    }
    setW("snap_data", JSON.stringify(snap));
  }

  get _char() {
    return (this.data.characters ?? []).find((c) => c.id === this.charId);
  }

  // ── Control registration ─────────────────────────────────────────────────────
  /** Immediate click — action fires on mouseDown. */
  reg(id, x, y, w, h, action, tip) {
    this.controls[id] = { x, y, w, h, action: action || null, tip: tip || null, deferred: false };
  }
  /** Fixed (not scrolled) control — action fires on mouseDown. */
  regFixed(id, x, y, w, h, action, tip) {
    this.controls[id] = { x, y, w, h, action: action || null, tip: tip || null, deferred: false, fixed: true };
  }
  /** Draggable control — click fires on mouseUp if not dragged; starts reorder on move > 8px. */
  regDraggable(id, x, y, w, h, clickAction, dragInfo, tip) {
    this.controls[id] = {
      x,
      y,
      w,
      h,
      action: clickAction || null,
      tip: tip || null,
      deferred: true,
      dragInfo,
    };
  }

  isIn(relX, relY, c) {
    if (relX < c.x || relX > c.x + c.w) return false;
    if (c.fixed) return relY >= c.y && relY <= c.y + c.h;
    const absY = relY + this.scrollY; // convert mouse to scroll-space
    return absY >= c.y && absY <= c.y + c.h;
  }

  // ── Main draw ────────────────────────────────────────────────────────────────
  draw(ctx) {
    const node = this.node;
    const W = node.size[0];
    const TH = LiteGraph.NODE_TITLE_HEIGHT;
    const visH = node.size[1] - TH;
    const WC = Math.round(W * 0.97);

    this.controls = {};
    this._galLayout = null;
    this._tbLayout = null;
    this._folderZones = [];

    rrect(ctx, 0, TH, W, visH, 0, C.bg);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TH, WC, visH);
    ctx.clip();
    ctx.translate(0, -this.scrollY);

    let cy = TH + GAP;
    cy = this.view === "base" ? this._drawBase(ctx, cy, WC) : this._drawChar(ctx, cy, WC);
    this.totalH = cy - TH + GAP;

    ctx.restore();

    // Drag ghost (drawn after restore, in node-local coords)
    if (this.reorderDrag?.active) this._drawDragGhost(ctx, WC);

    // Scrollbar
    if (this.totalH > visH) {
      const sbH = Math.max(20, (visH * visH) / this.totalH);
      const sbY = TH + (this.scrollY / this.totalH) * visH;
      rrect(ctx, WC - 7, TH, 5, visH, 2, "#1a1a1a");
      rrect(ctx, WC - 7, sbY, 5, sbH, 2, "#555");
    }

    // Tooltip
    if (this.tooltipEl && this.controls[this.tooltipEl]?.tip)
      this._drawTooltip(ctx, this.controls[this.tooltipEl].tip, WC);

    // Output slot hover labels
    if (node.outputs?.length) {
      const SH = LiteGraph.NODE_SLOT_HEIGHT ?? 20;
      this.regFixed("out-strip", WC, 0, W - WC, node.outputs.length * SH + 12, null, null);
      if (this.hover === "out-strip") {
        node.outputs.forEach((out, i) => {
          const nm = OUTPUT_NAMES[i] || out._origName || out.type || "";
          const sy = 5 + SH * 0.5 + i * SH;
          ctx.font = "10px 'Segoe UI'";
          const tw = ctx.measureText(nm).width;
          rrect(ctx, W - tw - 18, sy - 8, tw + 10, 16, 3, "rgba(15,15,15,0.94)", "#444");
          label(ctx, nm, W - 13, sy, "#ccc", 10, "right");
        });
      }
    }
  }

  _drawTooltip(ctx, text, WC) {
    const TH = LiteGraph.NODE_TITLE_HEIGHT;
    ctx.font = "11px 'Segoe UI'";
    const tw = ctx.measureText(text).width,
      bw = tw + 14,
      bh = 20;
    const bx = clamp((WC - bw) / 2, M, WC - M - bw);
    rrect(ctx, bx, TH + 4, bw, bh, 3, "#1e1e1e", C.borderHov);
    label(ctx, text, bx + 7, TH + 4 + bh / 2, C.text, 11);
  }

  // ── BASE VIEW ───────────────────────────────────────────────────────────────
  _drawBase(ctx, cy, W) {
    const base = this.data.base;

    // ── Collapsible: Base Checkpoint ───────────────────────────────────────────
    const ckptCol = this.collapsedBase.has("checkpoint");
    const ckptHov = this.hover === "base-ckpt-hdr";
    rrect(ctx, M, cy, W - M * 2, SEC, 3, ckptHov ? C.folder : "transparent", C.folderBdr);
    label(ctx, (ckptCol ? "▶" : "▼") + " Base Checkpoint", M + 8, cy + SEC / 2, C.folderTxt, 10, "left", true);
    this.reg(
      "base-ckpt-hdr",
      M,
      cy,
      W - M * 2,
      SEC,
      () => {
        if (this.collapsedBase.has("checkpoint")) this.collapsedBase.delete("checkpoint");
        else this.collapsedBase.add("checkpoint");
        app.graph?.setDirtyCanvas(true);
      },
      "Collapse / expand",
    );
    cy += SEC + 4;
    if (!ckptCol) {
      drawCombo(ctx, M, cy, W - M * 2, ROW, base.checkpoint, this.hover === "ckpt");
      this.reg("ckpt", M, cy, W - M * 2, ROW, (e) => {
        const items = ["", ...(this.assets.checkpoints ?? [])].map((o) => ({
          content: o || "(none)",
          callback: () => {
            base.checkpoint = o;
            this._save();
          },
        }));
        new LiteGraph.ContextMenu(items, { event: e });
      });
      cy += ROW + GAP;
    }

    // ── Collapsible: Base LoRAs ───────────────────────────────────────────────
    const loraCol = this.collapsedBase.has("loras");
    const loraHov = this.hover === "base-loras-hdr";
    rrect(ctx, M, cy, W - M * 2, SEC, 3, loraHov ? C.folder : "transparent", C.folderBdr);
    label(ctx, (loraCol ? "▶" : "▼") + " Base LoRAs", M + 8, cy + SEC / 2, C.folderTxt, 10, "left", true);
    this.reg(
      "base-loras-hdr",
      M,
      cy,
      W - M * 2,
      SEC,
      () => {
        if (this.collapsedBase.has("loras")) this.collapsedBase.delete("loras");
        else this.collapsedBase.add("loras");
        app.graph?.setDirtyCanvas(true);
      },
      "Collapse / expand",
    );
    cy += SEC + 4;
    if (!loraCol) {
      cy = this._loraSection(ctx, base.loras, null, cy, W);
    }

    // Export / Import buttons
    const bw = (W - M * 2 - GAP) / 2;
    drawBtn(ctx, M, cy, bw, ROW - 4, "📦 Export Library", this.hover === "lib-export");
    drawBtn(ctx, M + bw + GAP, cy, bw, ROW - 4, "📥 Import Library", this.hover === "lib-import");
    this.reg("lib-export", M, cy, bw, ROW - 4, () => this._exportLibrary(), "Download library as ZIP");
    this.reg("lib-import", M + bw + GAP, cy, bw, ROW - 4, () => this._importLibrary(), "Import library from ZIP");
    cy += ROW + GAP * 2;

    // Characters header + search bar
    cy += drawSec(ctx, "Characters", M, cy, W - M * 2);

    const hasSrch = this.charSearch.trim().length > 0;
    const srchHov = this.hover === "ch-search",
      clrHov = this.hover === "ch-search-clr";
    const sbw = W - M * 2;
    rrect(ctx, M, cy, sbw, ROW - 2, R, srchHov ? C.rowHov : C.panel, srchHov ? C.borderHov : C.border);
    label(
      ctx,
      hasSrch ? `🔍 ${this.charSearch}` : "🔍 Search characters…",
      M + 7,
      cy + (ROW - 2) / 2,
      hasSrch ? C.text : C.muted,
      11,
      "left",
      false,
      sbw - (hasSrch ? 44 : 14),
    );
    this.reg(
      "ch-search",
      M,
      cy,
      sbw - (hasSrch ? 28 : 0),
      ROW - 2,
      () => {
        textPopup(
          "Filter characters",
          this.charSearch,
          (v) => {
            this.charSearch = v.trim();
            this.scrollY = 0;
            app.graph?.setDirtyCanvas(true);
          },
          { singleLine: true },
        );
      },
      "Type to filter characters by name",
    );
    if (hasSrch) {
      const cX = M + sbw - 24;
      rrect(ctx, cX, cy + 3, 18, ROW - 8, 3, clrHov ? "#3a2020" : "transparent", "transparent");
      label(ctx, "✕", cX + 9, cy + (ROW - 2) / 2, clrHov ? C.dangerText : C.muted, 10, "center");
      this.reg(
        "ch-search-clr",
        cX,
        cy + 3,
        18,
        ROW - 8,
        () => {
          this.charSearch = "";
          this.scrollY = 0;
          app.graph?.setDirtyCanvas(true);
        },
        "Clear filter",
      );
    }
    cy += ROW + GAP;

    const allChars = this.data.characters ?? [];
    const filtered = hasSrch
      ? allChars.filter((c) => c.name.toLowerCase().includes(this.charSearch.toLowerCase()))
      : allChars;

    if (!hasSrch) {
      // Group by folder — always include "" (Ungrouped) so the New button is always present
      const folders = [...new Set(["", ...allChars.map((c) => c.folder || "")])].sort();
      for (const folder of folders) {
        const groupChars = allChars.filter((c) => (c.folder || "") === folder);
        cy = this._drawCharGroup(ctx, groupChars, folder, cy, W, allChars);
      }
    } else {
      cy = this._drawCharGroup(ctx, filtered, null, cy, W, allChars);
    }
    return cy;
  }

  _drawCharGroup(ctx, chars, folder, cy, W, allChars) {
    const cardW = 132,
      cardH = 162,
      cPad = 6;
    const cols = Math.max(1, Math.floor((W - M * 2 + cPad) / (cardW + cPad)));
    // null = search-results mode (display flat, no folder zone tracking)
    const effectiveFolder = folder;

    // Folder header (skip for null = search-results)
    const hdrStartScrollY = cy; // used for zone startScrollY (includes header area as drop target)
    if (folder !== null) {
      const isCollapsed = this.collapsedFolders.has(folder);
      const fHov = this.hover === `fhdr-${folder}`;
      const hdrLabel = folder === "" ? "Ungrouped" : `📁 ${folder}`;
      rrect(ctx, M, cy, W - M * 2, SEC, 3, fHov ? C.folder : "transparent", C.folderBdr);
      label(ctx, isCollapsed ? "▶ " + hdrLabel : "▼ " + hdrLabel, M + 8, cy + SEC / 2, C.folderTxt, 10, "left", true);
      this.reg(
        `fhdr-${folder}`,
        M,
        cy,
        W - M * 2,
        SEC,
        () => {
          if (this.collapsedFolders.has(folder)) this.collapsedFolders.delete(folder);
          else this.collapsedFolders.add(folder);
          app.graph?.setDirtyCanvas(true);
        },
        folder ? `Folder: ${folder}` : "Ungrouped characters",
      );
      cy += SEC + 4;
      if (isCollapsed) {
        // Even collapsed, register as a valid drop zone so you can drag into it
        if (folder !== null)
          this._folderZones.push({
            folder: effectiveFolder,
            startScrollY: hdrStartScrollY,
            endScrollY: cy,
            startX: M,
            tileW: cardW,
            tileH: cardH,
            tilesPerRow: cols,
            gap: cPad,
            listLen: chars.length,
          });
        return cy;
      }
    }

    const rd = this.reorderDrag;
    const isDraggingCard = rd?.kind === "card" && rd.active;
    const isSourceZone = isDraggingCard && rd.sourceFolder === effectiveFolder;
    const isTargetZone = isDraggingCard && rd.targetFolder === effectiveFolder;

    const galStartY = cy;
    let cx2 = M,
      cy2 = cy;

    // Build display list: remove dragged card from source, inject placeholder in target
    let baseList = isSourceZone ? chars.filter((c) => c?.id !== rd.dragCharId) : chars.slice();
    let displayChars;
    if (isTargetZone) {
      const safeIdx = clamp(rd.toIdx, 0, baseList.length);
      displayChars = [...baseList.slice(0, safeIdx), null, ...baseList.slice(safeIdx)];
    } else {
      displayChars = baseList;
    }

    for (let i = 0; i < displayChars.length; i++) {
      const ch = displayChars[i];
      const hId = `card-${folder ?? "srch"}-${i}`;

      if (ch === null) {
        // Drop placeholder
        drawPlaceholder(ctx, cx2, cy2, cardW, cardH, R);
      } else {
        const hov = this.hover === hId && !isDraggingCard;
        rrect(ctx, cx2, cy2, cardW, cardH, R, hov ? C.rowHov : C.row, hov ? C.borderHov : C.border);

        const ts = 99,
          tx = cx2 + (cardW - ts) / 2,
          ty = cy2 + 10;
        const thumbUrl = ch.gallery?.length ? `/steaked/library/character/${ch.id}/image/${ch.gallery[0]}` : null;
        if (thumbUrl) {
          const img = getImg(thumbUrl, () => app.graph?.setDirtyCanvas(true));
          if (img?.complete && img.naturalWidth > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(tx, ty, ts, ts, R) : ctx.rect(tx, ty, ts, ts);
            ctx.clip();
            drawImgCropped(ctx, img, tx, ty, ts, ts);
            ctx.restore();
          } else {
            rrect(ctx, tx, ty, ts, ts, R, C.thumb);
            label(ctx, "👤", tx + ts / 2, ty + ts / 2, C.muted, 28, "center");
          }
        } else {
          rrect(ctx, tx, ty, ts, ts, R, C.thumb);
          label(ctx, "👤", tx + ts / 2, ty + ts / 2, C.muted, 28, "center");
        }

        label(ctx, ch.name, cx2 + cardW / 2, cy2 + 10 + ts + 16, C.text, 10, "center", false, cardW - 8);
        // In search-results mode show the folder name below the card name
        if (ch.folder && folder === null)
          label(ctx, ch.folder, cx2 + cardW / 2, cy2 + cardH - 12, C.muted, 9, "center", false, cardW - 8);

        // Drag handle strip at the top of the card (16px) — drag only, no click action
        const gripId = `grip-${hId}`;
        const gripHov = this.hover === gripId;
        rrect(ctx, cx2, cy2, cardW, 16, R, gripHov ? "#333" : "#2a2a2a", "transparent");
        // Draw 3 grip dots
        for (let d = 0; d < 3; d++) {
          const dotX = cx2 + cardW / 2 - 8 + d * 8;
          ctx.beginPath();
          ctx.arc(dotX, cy2 + 8, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = gripHov ? "#888" : "#555";
          ctx.fill();
        }
        this.regDraggable(
          gripId,
          cx2,
          cy2,
          cardW,
          16,
          null, // no click action — handle is drag-only
          {
            kind: "card",
            list: allChars,
            fromIdx: allChars.indexOf(ch),
            dragCharId: ch.id,
            sourceFolder: effectiveFolder,
            tileW: cardW,
            tileH: cardH,
            tilesPerRow: cols,
            gap: cPad,
            startX: M,
            startY: galStartY,
          },
          "Drag to reorder / move to folder",
        );

        // Main card body — opens character immediately on click
        this.reg(
          hId,
          cx2,
          cy2 + 16,
          cardW,
          cardH - 16,
          () => {
            this.view = "char";
            this.charId = ch.id;
            this.scrollY = 0;
            this._syncWidgetFromState();
            app.graph?.setDirtyCanvas(true);
          },
          `Open ${ch.name}`,
        );
      }

      cx2 += cardW + cPad;
      if ((i + 1) % cols === 0) {
        cx2 = M;
        cy2 += cardH + cPad;
      }
    }

    // Record this zone for drop-target detection during card drag
    if (folder !== null) {
      const gridEndY = cx2 > M ? cy2 + cardH : cy2; // end of last card row
      this._folderZones.push({
        folder: effectiveFolder,
        startScrollY: hdrStartScrollY, // include the folder header area as a valid drop zone
        endScrollY: gridEndY,
        startX: M,
        tileW: cardW,
        tileH: cardH,
        tilesPerRow: cols,
        gap: cPad,
        listLen: chars.length,
      });
    }

    // New character card (only in Ungrouped or search-results mode)
    if (folder === null || folder === "") {
      const hov = this.hover === "card-new";
      rrect(ctx, cx2, cy2, cardW, cardH, R, hov ? C.rowHov : C.row, hov ? C.borderHov : C.border);
      label(ctx, "+", cx2 + cardW / 2, cy2 + cardH / 2 - 10, C.muted, 30, "center");
      label(ctx, "New", cx2 + cardW / 2, cy2 + cardH / 2 + 20, C.muted, 10, "center");
      this.reg("card-new", cx2, cy2, cardW, cardH, () => {
        const id = uid((this.data.characters ?? []).map((c) => c.id));
        const ch = {
          id,
          name: "New Character",
          folder: "",
          model_override: { enabled: false, checkpoint: "", loras: [] },
          style_tags: "",
          base_prompt: "",
          text_blocks: [],
          negative: "",
          notes: "",
          gallery: [],
        };
        (this.data.characters ?? (this.data.characters = [])).push(ch);
        this.charId = id;
        this.view = "char";
        this.scrollY = 0;
        this._save();
        textPopup(
          "Character name",
          "New Character",
          (v) => {
            if (v?.trim()) {
              ch.name = v.trim();
              this._save();
            }
          },
          { singleLine: true },
        );
      });
      cy2 = cy2 + cardH + GAP;
    } else {
      if (cx2 > M || displayChars.length === 0) cy2 += cardH + GAP;
    }

    return cy2;
  }

  // ── CHAR VIEW ───────────────────────────────────────────────────────────────

  /**
   * Show the shared inline editor textarea (registered via ComfyWidgets.STRING so
   * autocomplete extensions have already attached their handlers to it) positioned
   * over the clicked canvas control.
   * @param {number} x         node-local X of the control
   * @param {number} scrollY   scroll-space Y as stored by reg() (plain cy value)
   * @param {number} w         control width in node-local pixels
   * @param {number} h         control height in node-local pixels
   * @param {string} value     initial text
   * @param {(v:string)=>void} onSave  called with final value on commit
   */
  _inlineEdit(x, scrollY, w, h, value, onSave) {
    // Reuse the shared widget textarea so autocomplete extensions (which attach
    // via ComfyWidgets.STRING override) work out of the box.
    const el = this.node.__inlineEditorEl;
    if (!el) {
      console.warn("[PromptLibrary] No inline editor element — falling back to nothing");
      return;
    }

    const cv = app.canvas;
    if (!cv) return;
    const rect = cv.canvas.getBoundingClientRect();
    const ds = cv.ds;
    const node = this.node;
    const TH = LiteGraph.NODE_TITLE_HEIGHT ?? 20;

    // onDrawForeground is called with ctx translated so that cy=0 is the
    // absolute top of the node INCLUDING the title bar. In graph space that
    // origin is (node.pos[0], node.pos[1] - TH) — node.pos[1] is body-top.
    const nodeLocalY = scrollY - this.scrollY; // cy - scrollY  (scroll eliminated)
    const gx = node.pos[0] + x;
    const gy = node.pos[1] - TH + nodeLocalY; // correct graph-space Y
    const sx = Math.round((gx + ds.offset[0]) * ds.scale + rect.left);
    const sy = Math.round((gy + ds.offset[1]) * ds.scale + rect.top);
    const sw = Math.round(w * ds.scale);
    const sh = Math.max(Math.round(h * ds.scale), 80); // always at least 80 screen-px tall

    el.value = value ?? "";
    Object.assign(el.style, {
      display: "block",
      position: "fixed",
      left: sx + "px",
      top: sy + "px",
      width: sw + "px",
      height: sh + "px",
      fontSize: Math.max(9, Math.round(11 * ds.scale)) + "px",
      fontFamily: "'Consolas','Courier New',monospace",
      background: "#101418",
      color: "#ddd",
      border: "2px solid #5a7a9a",
      borderRadius: "4px",
      padding: "4px 6px",
      boxSizing: "border-box",
      resize: "vertical",
      zIndex: "99999",
      outline: "none",
      lineHeight: "1.45",
      overflowY: "auto",
    });

    let done = false;
    const hide = () => {
      el.style.display = "none";
      app.graph?.setDirtyCanvas(true);
    };
    const commit = () => {
      if (done) return;
      done = true;
      rmListeners();
      onSave(el.value);
      hide();
    };
    const discard = () => {
      if (done) return;
      done = true;
      rmListeners();
      hide();
    };

    const onBlur = () => commit();
    const onKeyDown = (e) => {
      // Escape → discard (autocomplete extension also sees Escape to close its dropdown)
      if (e.key === "Escape") {
        e.preventDefault();
        discard();
        return;
      }
      // Ctrl/Cmd+Enter → commit
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        commit();
      }
    };
    const onWheel = () => commit(); // canvas scroll → commit + close to avoid drift

    function rmListeners() {
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("keydown", onKeyDown);
      cv.canvas.removeEventListener("wheel", onWheel, true);
    }

    el.addEventListener("blur", onBlur);
    el.addEventListener("keydown", onKeyDown);
    cv.canvas.addEventListener("wheel", onWheel, { once: true, capture: true });

    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      // Dispatch input so autocomplete initialises suggestions for existing text
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /** Draw a collapsible section header; registers click to toggle. Returns updated cy. */
  _collHdr(ctx, key, title, cy, W) {
    const col = this.collapsedChar.has(key);
    const hov = this.hover === `coll-${key}`;
    rrect(ctx, M, cy, W - M * 2, SEC, 3, hov ? C.folder : "transparent", C.folderBdr);
    label(ctx, (col ? "▶" : "▼") + "  " + title, M + 8, cy + SEC / 2, C.folderTxt, 10, "left", true);
    this.reg(
      `coll-${key}`,
      M,
      cy,
      W - M * 2,
      SEC,
      () => {
        if (this.collapsedChar.has(key)) this.collapsedChar.delete(key);
        else this.collapsedChar.add(key);
        app.graph?.setDirtyCanvas(true);
      },
      col ? "Click to expand" : "Click to collapse",
    );
    return cy + SEC + 4;
  }

  _drawChar(ctx, cy, W) {
    const ch = this._char;
    if (!ch) {
      this.view = "base";
      this.scrollY = 0;
      return cy;
    }
    if (!ch.model_override) ch.model_override = { enabled: false, checkpoint: "", loras: [] };
    const ov = ch.model_override;

    // Nav row
    drawBtn(ctx, M, cy, 70, ROW - 2, "← Back", this.hover === "back");
    this.reg("back", M, cy, 70, ROW - 2, () => {
      this.view = "base";
      this.charId = null;
      this.scrollY = 0;
      this._syncWidgetFromState();
      app.graph?.setDirtyCanvas(true);
    });

    const nameW = W - M * 2 - 74 - 78;
    const hName = this.hover === "ch-name";
    rrect(ctx, M + 74, cy, nameW, ROW - 2, R, hName ? C.rowHov : "transparent", hName ? C.borderHov : "transparent");
    label(ctx, ch.name, M + 80, cy + (ROW - 2) / 2, C.activeText, 13, "left", true, nameW - 14);
    this.reg(
      "ch-name",
      M + 74,
      cy,
      nameW,
      ROW - 2,
      () => {
        textPopup(
          "Character name",
          ch.name,
          (v) => {
            if (v?.trim()) {
              ch.name = v.trim();
              this._save();
            }
          },
          { singleLine: true },
        );
      },
      "Click to rename",
    );

    drawBtn(ctx, W - M - 76, cy, 76, ROW - 2, "🗑 Delete", this.hover === "ch-del", true);
    this.reg(
      "ch-del",
      W - M - 76,
      cy,
      76,
      ROW - 2,
      () => {
        if (!confirm(`Delete "${ch.name}"?`)) return;
        this.data.characters = this.data.characters.filter((c) => c.id !== ch.id);
        this.charId = null;
        this.view = "base";
        this.scrollY = 0;
        this._save();
      },
      "Delete character",
    );
    cy += ROW + GAP;

    // Folder assignment
    const folderHov = this.hover === "ch-folder";
    const folderLabel = ch.folder ? `📁 ${ch.folder}` : "📁 No folder — click to set";
    rrect(ctx, M, cy, W - M * 2, ROW - 4, R, folderHov ? C.rowHov : "transparent", folderHov ? C.folderBdr : C.border);
    label(
      ctx,
      folderLabel,
      M + 7,
      cy + (ROW - 4) / 2,
      ch.folder ? C.folderTxt : C.muted,
      11,
      "left",
      false,
      W - M * 2 - 14,
    );
    this.reg(
      "ch-folder",
      M,
      cy,
      W - M * 2,
      ROW - 4,
      () => {
        textPopup(
          "Folder name (leave blank for ungrouped)",
          ch.folder ?? "",
          (v) => {
            ch.folder = v.trim();
            this._save();
          },
          { singleLine: true },
        );
      },
      "Assign to a folder",
    );
    cy += ROW + GAP;

    // ── COLLAPSIBLE: Model Override ────────────────────────────────────────────────
    cy = this._collHdr(ctx, "model-override", "Model Override", cy, W);
    if (!this.collapsedChar.has("model-override")) {
      drawToggle(ctx, M + 3, cy, ov.enabled, this.hover === "ov-tog");
      label(ctx, "Override base checkpoint", M + 24, cy + ROW / 2, C.text, 11);
      this.reg(
        "ov-tog",
        M + 3,
        cy,
        W - M * 2,
        ROW,
        () => {
          ov.enabled = !ov.enabled;
          this._save();
        },
        "Toggle checkpoint override for this character",
      );
      cy += ROW + 2;
      if (ov.enabled) {
        drawCombo(ctx, M, cy, W - M * 2, ROW, ov.checkpoint, this.hover === "ov-ckpt");
        this.reg("ov-ckpt", M, cy, W - M * 2, ROW, (e) => {
          const items = ["", ...(this.assets.checkpoints ?? [])].map((o) => ({
            content: o || "(none)",
            callback: () => {
              ov.checkpoint = o;
              this._save();
            },
          }));
          new LiteGraph.ContextMenu(items, { event: e });
        });
        cy += ROW + 2;
      }
      cy += GAP;
    }

    // ── COLLAPSIBLE: Character LoRAs ──────────────────────────────────────────────
    const loraTitle = ov.enabled ? "Character LoRAs (replaces base)" : "Character LoRAs (stacks on base)";
    cy = this._collHdr(ctx, "char-loras", loraTitle, cy, W);
    if (!this.collapsedChar.has("char-loras")) {
      cy = this._loraSection(ctx, ov.loras, null, cy, W);
    }

    // ── COLLAPSIBLE: Style Tags ────────────────────────────────────────────────────
    cy = this._collHdr(ctx, "style-tags", "Style Tags  →  style_tags output", cy, W);
    if (!this.collapsedChar.has("style-tags")) {
      const stHov = this.hover === "st";
      const stH = 44;
      drawTextArea(ctx, M, cy, W - M * 2, stH, ch.style_tags, stHov, "click to edit…");
      const stY = cy;
      this.reg("st", M, cy, W - M * 2, stH, () => {
        this._inlineEdit(M, stY, W - M * 2, stH, ch.style_tags, (v) => {
          ch.style_tags = v;
          this._save();
        });
      });
      cy += stH + GAP;
    }

    // ── COLLAPSIBLE: Base Prompt ──────────────────────────────────────────────────
    cy = this._collHdr(ctx, "base-prompt", "Base Prompt  →  base_prompt output", cy, W);
    if (!this.collapsedChar.has("base-prompt")) {
      const bpH = 70,
        bpHov = this.hover === "bp";
      drawTextArea(ctx, M, cy, W - M * 2, bpH, ch.base_prompt, bpHov, "click to edit…");
      const bpY = cy;
      this.reg("bp", M, cy, W - M * 2, bpH, () => {
        this._inlineEdit(M, bpY, W - M * 2, bpH, ch.base_prompt, (v) => {
          ch.base_prompt = v;
          this._save();
        });
      });
      cy += bpH + GAP;
    }

    // ── COLLAPSIBLE: Text Blocks ──────────────────────────────────────────────────
    cy = this._collHdr(ctx, "text-blocks", "Text Blocks  →  combined output", cy, W);
    if (!this.collapsedChar.has("text-blocks")) {
      cy = this._textBlockSection(ctx, ch, cy, W);
    }

    // ── COLLAPSIBLE: Negative Prompt ─────────────────────────────────────────────
    cy = this._collHdr(ctx, "negative", "Negative Prompt  →  negative output", cy, W);
    if (!this.collapsedChar.has("negative")) {
      const negH = 54,
        negHov = this.hover === "neg";
      drawTextArea(ctx, M, cy, W - M * 2, negH, ch.negative, negHov, "click to edit…");
      const negY = cy;
      this.reg("neg", M, cy, W - M * 2, negH, () => {
        this._inlineEdit(M, negY, W - M * 2, negH, ch.negative ?? "", (v) => {
          ch.negative = v;
          this._save();
        });
      });
      cy += negH + GAP;
    }

    // ── COLLAPSIBLE: Notes ──────────────────────────────────────────────────────────
    cy = this._collHdr(ctx, "notes", "Notes (not output)", cy, W);
    if (!this.collapsedChar.has("notes")) {
      const ntH = 54,
        ntHov = this.hover === "nt";
      drawTextArea(ctx, M, cy, W - M * 2, ntH, ch.notes, ntHov, "private notes / seed info…");
      const ntY = cy;
      this.reg("nt", M, cy, W - M * 2, ntH, () => {
        this._inlineEdit(M, ntY, W - M * 2, ntH, ch.notes ?? "", (v) => {
          ch.notes = v;
          this._save();
        });
      });
      cy += ntH + GAP;
    }

    // ── COLLAPSIBLE: Image Gallery ──────────────────────────────────────────────────
    cy = this._collHdr(ctx, "gallery", "Image Gallery", cy, W);
    if (!this.collapsedChar.has("gallery")) {
      cy = this._drawGallery(ctx, ch, cy, W);
    }

    return cy;
  }
  // ── Text Block Section ────────────────────────────────────────────────────────────
  _textBlockSection(ctx, ch, cy, W) {
    if (!ch.text_blocks) ch.text_blocks = [];
    const blocks = ch.text_blocks;
    const TW = 20,
      RW = 18,
      GW = 24,
      DW = 22;
    const nameW = W - M * 2 - TW - 4 - RW - 4 - GW - 4 - DW;
    const nx = M + TW + 4,
      rx = nx + nameW + 4,
      gx = rx + RW + 4,
      dx = gx + GW + 4;
    const tbRowH = ROW + 2;
    const tbStart = cy;

    this._tbLayout = { startScrollY: tbStart, rowH: tbRowH, listLen: blocks.length };

    const rd = this.reorderDrag;
    const isDragging = rd?.kind === "textblock" && rd.active;
    let displayBlocks;
    if (isDragging) {
      const without = blocks.filter((_, i) => i !== rd.fromIdx);
      const safeIdx = clamp(rd.toIdx ?? 0, 0, without.length);
      displayBlocks = [...without.slice(0, safeIdx), null, ...without.slice(safeIdx)];
    } else {
      displayBlocks = blocks.slice();
    }

    for (let i = 0; i < displayBlocks.length; i++) {
      const blk = displayBlocks[i];
      const pfx = `tb-${i}`;
      if (blk === null) {
        // Drag placeholder
        rrect(ctx, M, cy, W - M * 2, ROW, R, "transparent", C.accent);
        cy += tbRowH;
        continue;
      }
      const hRow = this.hover?.startsWith(pfx) && !isDragging;
      rrect(ctx, M, cy, W - M * 2, ROW, R, hRow ? C.rowHov : C.row, C.border);

      // Toggle
      drawToggle(ctx, M + 3, cy, blk.enabled !== false, this.hover === `${pfx}-t`);
      this.reg(`${pfx}-t`, M + 3, cy, TW, ROW, () => {
        blk.enabled = !(blk.enabled !== false);
        this._save();
      });

      // Name + preview text
      const nameColor = blk.enabled !== false ? C.text : C.muted;
      const preview = (blk.text ?? "").replace(/\n/g, " ").trim();
      label(ctx, blk.name ?? "Unnamed", nx, cy + ROW * 0.35, nameColor, 10, "left", true, nameW);
      if (preview) label(ctx, preview, nx, cy + ROW * 0.7, C.muted, 9, "left", false, nameW);
      const blkBodyY = cy; // capture before cy advances
      this.reg(
        `${pfx}-body`,
        nx,
        cy,
        nameW,
        ROW,
        () => {
          // Wider (full node width) and taller than the row for comfortable editing
          this._inlineEdit(M, blkBodyY, W - M * 2, Math.max(ROW * 4, 100), blk.text ?? "", (v) => {
            blk.text = v;
            this._save();
          });
        },
        "Click to edit content",
      );

      // Rename icon
      drawIcon(ctx, rx, cy, RW, "✎", this.hover === `${pfx}-r`);
      this.reg(
        `${pfx}-r`,
        rx,
        cy,
        RW,
        ROW,
        () => {
          textPopup(
            "Block name",
            blk.name ?? "",
            (v) => {
              if (v?.trim()) {
                blk.name = v.trim();
                this._save();
              }
            },
            { singleLine: true },
          );
        },
        "Rename block",
      );

      // Drag grip
      const ghId = `${pfx}-grip`;
      const ghHov = this.hover === ghId && !isDragging;
      rrect(ctx, gx, cy + 4, GW, ROW - 8, 2, ghHov ? "#333" : "transparent", C.border);
      for (let d = 0; d < 3; d++) {
        const dotX = gx + GW / 2 - 8 + d * 8;
        ctx.beginPath();
        ctx.arc(dotX, cy + ROW / 2, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = ghHov ? "#999" : "#555";
        ctx.fill();
      }
      this.regDraggable(
        ghId,
        gx,
        cy,
        GW,
        ROW,
        null,
        {
          kind: "textblock",
          list: blocks,
          fromIdx: blocks.indexOf(blk),
          tileW: W - M * 2,
          tileH: tbRowH,
          startX: M,
          startY: tbStart,
        },
        "Drag to reorder",
      );

      // Delete
      drawIcon(ctx, dx, cy, DW, "✕", this.hover === `${pfx}-d`, true);
      this.reg(
        `${pfx}-d`,
        dx,
        cy,
        DW,
        ROW,
        () => {
          blocks.splice(blocks.indexOf(blk), 1);
          this._save();
        },
        "Remove block",
      );

      cy += tbRowH;
    }

    if (!blocks.length && !isDragging) {
      label(ctx, "No text blocks yet", W / 2, cy + ROW / 2, C.muted, 11, "center");
      cy += ROW;
    }

    const aHov = this.hover === "tb-add";
    drawBtn(ctx, M, cy, W - M * 2, ROW - 4, "+ Add Text Block", aHov);
    this.reg("tb-add", M, cy, W - M * 2, ROW - 4, () => {
      const nb = { id: uid(blocks.map((b) => b.id ?? "")), name: "New Block", enabled: true, text: "" };
      blocks.push(nb);
      this._save();
      textPopup(
        "Block name",
        "New Block",
        (v) => {
          if (v?.trim()) {
            nb.name = v.trim();
            this._save();
          }
        },
        { singleLine: true },
      );
    });
    return cy + ROW + GAP;
  }
  // ── Gallery ──────────────────────────────────────────────────────────────────
  _drawGallery(ctx, ch, cy, W) {
    const gal = ch.gallery ?? [];
    const TS = 150,
      TP = 6;
    const gcols = Math.max(1, Math.floor((W - M * 2 + TP) / (TS + TP)));

    if (!gal.length) {
      const dHov = this.hover === "gal-add";
      rrect(ctx, M, cy, W - M * 2, ROW, R, dHov ? C.rowHov : "transparent", dHov ? C.borderHov : C.border);
      label(ctx, "Click to add images", W / 2, cy + ROW / 2, C.muted, 11, "center");
      this.reg("gal-add", M, cy, W - M * 2, ROW, () => this._uploadImages(ch));
      cy += ROW + GAP;
      return cy;
    }

    const rd = this.reorderDrag;
    const isDragging = rd?.kind === "gallery" && rd.active;

    const galStartY = cy; // scroll-space Y where tiles start
    this._galLayout = {
      startX: M,
      startY: galStartY,
      tileW: TS,
      tileH: TS,
      tilesPerRow: gcols,
      gap: TP,
      listLen: gal.length,
    };

    const displayList = isDragging
      ? (() => {
          const without = gal.filter((_, i) => i !== rd.fromIdx);
          return [...without.slice(0, rd.toIdx), null, ...without.slice(rd.toIdx)];
        })()
      : gal.map((f) => f);

    let gx = M,
      gy = cy;
    for (let i = 0; i < displayList.length; i++) {
      const filename = displayList[i];

      if (filename === null) {
        drawPlaceholder(ctx, gx, gy, TS, TS, R);
      } else {
        const src = `/steaked/library/character/${ch.id}/image/${filename}`;
        const img = getImg(src, () => app.graph?.setDirtyCanvas(true));
        const hovMain = this.hover === `gi-${i}` && !isDragging;
        const hovDel = this.hover === `gd-${i}`;
        const hov = hovMain || hovDel;
        rrect(ctx, gx, gy, TS, TS, R, C.thumb, hov ? C.borderHov : C.border);
        if (img?.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(gx, gy, TS, TS, R) : ctx.rect(gx, gy, TS, TS);
          ctx.clip();
          drawImgCropped(ctx, img, gx, gy, TS, TS);
          ctx.restore();
        }

        // Delete button (top-right)
        const dX = gx + TS - 20,
          dY = gy + 2;
        rrect(ctx, dX, dY, 18, 18, 3, hovDel ? "rgba(100,20,20,0.95)" : "rgba(20,20,20,0.75)");
        label(ctx, "✕", dX + 9, dY + 9, hovDel ? C.dangerText : "#888", 10, "center");
        this.reg(
          `gd-${i}`,
          dX,
          dY,
          18,
          18,
          async () => {
            const realFilename = gal.indexOf(filename) >= 0 ? filename : null;
            if (!realFilename || !confirm(`Remove "${realFilename}"?`)) return;
            const url = `/steaked/library/character/${ch.id}/image/${realFilename}`;
            evictImg(url);
            gal.splice(gal.indexOf(realFilename), 1);
            try {
              await fetch(url, { method: "DELETE" });
            } catch (err) {
              console.warn("[SteakedLib] delete:", err);
            }
            this._save();
          },
          "Remove image",
        );

        // Main tile: click = meta popup (immediate, no drag ambiguity)
        if (hovMain && !isDragging) label(ctx, "click for info", gx + TS / 2, gy + TS - 20, C.muted, 9, "center");
        this.reg(`gi-${i}`, gx, gy, TS - 22, TS - 16, () => showImageMeta(src, filename), "Click for image metadata");

        // Drag handle strip at the bottom of the tile
        const ghId = `gidrag-${i}`;
        const ghHov = this.hover === ghId && !isDragging;
        rrect(ctx, gx, gy + TS - 14, TS - 22, 12, 2, ghHov ? "#333" : "rgba(0,0,0,0.55)");
        for (let d = 0; d < 3; d++) {
          const dotX = gx + (TS - 22) / 2 - 8 + d * 8;
          ctx.beginPath();
          ctx.arc(dotX, gy + TS - 8, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = ghHov ? "#999" : "#555";
          ctx.fill();
        }
        const realIdx = gal.indexOf(filename);
        this.regDraggable(
          ghId,
          gx,
          gy + TS - 14,
          TS - 22,
          12,
          null,
          {
            kind: "gallery",
            list: gal,
            fromIdx: realIdx,
            tileW: TS,
            tileH: TS,
            tilesPerRow: gcols,
            gap: TP,
            startX: M,
            startY: galStartY,
          },
          "Drag to reorder",
        );
      }

      gx += TS + TP;
      if ((i + 1) % gcols === 0) {
        gx = M;
        gy += TS + TP;
      }
    }
    cy = gy + TS + TP;

    const aHov = this.hover === "gal-add2";
    drawBtn(ctx, M, cy, W - M * 2, ROW - 4, "+ Add Images", aHov);
    this.reg("gal-add2", M, cy, W - M * 2, ROW - 4, () => this._uploadImages(ch));
    cy += ROW + GAP;
    return cy;
  }

  // ── Lora section ─────────────────────────────────────────────────────────────
  _loraSection(ctx, loraArr, title, cy, W) {
    if (title !== null) cy += drawSec(ctx, title, M, cy, W - M * 2);
    const TW = 20,
      IW = 22,
      DW = 22,
      NW = 44;
    const nx = M + TW + 4;
    const nameW = W - M * 2 - TW - 4 - NW - 2 - NW - 2 - IW - 2 - DW;
    const sx = nx + nameW + 2,
      clipX = sx + NW + 2,
      ix = clipX + NW + 2,
      dx = ix + IW + 2;

    ctx.fillStyle = C.muted;
    ctx.font = "10px 'Segoe UI'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Mdl str", sx + NW / 2, cy + 9);
    ctx.fillText("Clip str", clipX + NW / 2, cy + 9);
    cy += 18;

    if (!loraArr.length) {
      label(ctx, "No LoRAs", W / 2, cy + ROW / 2, C.muted, 11, "center");
      cy += ROW;
    } else {
      for (let i = 0; i < loraArr.length; i++) {
        const lo = loraArr[i],
          pfx = `${title}-${i}`;
        const hRow = this.hover?.startsWith(pfx);
        rrect(ctx, M, cy, W - M * 2, ROW, R, hRow ? C.rowHov : C.row, C.border);
        drawToggle(ctx, M + 3, cy, lo.enabled !== false, this.hover === `${pfx}-t`);
        this.reg(
          `${pfx}-t`,
          M + 3,
          cy,
          TW,
          ROW,
          () => {
            lo.enabled = !(lo.enabled !== false);
            this._save();
          },
          "Enable / disable LoRA",
        );
        drawCombo(ctx, nx, cy + 3, nameW, ROW - 6, lo.file, this.hover === `${pfx}-f`);
        this.reg(`${pfx}-f`, nx, cy + 3, nameW, ROW - 6, (e) => this._loraFilePicker(e, lo), "Select LoRA file");
        drawNumBox(ctx, sx, cy + 3, NW, ROW - 6, lo.strength ?? 1, this.hover === `${pfx}-s`);
        this.reg(
          `${pfx}-s`,
          sx,
          cy + 3,
          NW,
          ROW - 6,
          (e) => {
            this.drag = {
              startX: e.clientX,
              startVal: lo.strength ?? 1,
              onChange: (v) => {
                lo.strength = v;
                this._save();
              },
            };
          },
          "Model strength. Drag to adjust.",
        );
        drawNumBox(ctx, clipX, cy + 3, NW, ROW - 6, lo.clip_strength ?? lo.strength ?? 1, this.hover === `${pfx}-c`);
        this.reg(
          `${pfx}-c`,
          clipX,
          cy + 3,
          NW,
          ROW - 6,
          (e) => {
            this.drag = {
              startX: e.clientX,
              startVal: lo.clip_strength ?? lo.strength ?? 1,
              onChange: (v) => {
                lo.clip_strength = v;
                this._save();
              },
            };
          },
          "CLIP strength. Drag to adjust.",
        );
        drawIcon(ctx, ix, cy, IW, "ℹ", this.hover === `${pfx}-i`);
        this.reg(`${pfx}-i`, ix, cy, IW, ROW, () => showLoraInfo(lo.file), "View on Civitai");
        drawIcon(ctx, dx, cy, DW, "✕", this.hover === `${pfx}-d`, true);
        this.reg(
          `${pfx}-d`,
          dx,
          cy,
          DW,
          ROW,
          () => {
            loraArr.splice(i, 1);
            this._save();
          },
          "Remove LoRA",
        );
        cy += ROW + 2;
      }
    }
    const addId = `${title}-add`;
    drawBtn(ctx, M, cy, W - M * 2, ROW - 4, "+ Add LoRA", this.hover === addId);
    this.reg(addId, M, cy, W - M * 2, ROW - 4, () => {
      loraArr.push({ enabled: true, file: "", strength: 1, clip_strength: 1 });
      this._save();
    });
    return cy + ROW + GAP;
  }

  _loraFilePicker(e, lo) {
    const opts = ["", ...(this.assets.loras ?? [])];
    new LiteGraph.ContextMenu(
      opts.map((o) => ({
        content: o || "(none)",
        callback: () => {
          lo.file = o;
          this._save();
        },
      })),
      { event: e },
    );
  }

  // ── Drag ghost ───────────────────────────────────────────────────────────────
  _drawDragGhost(ctx, WC) {
    const rd = this.reorderDrag;
    if (!rd?.active) return;
    const TH = LiteGraph.NODE_TITLE_HEIGHT;
    const node = this.node;
    // cursor in node-local canvas coords (no scroll adjustment — ghost follows cursor absolutely)
    const ghostX = rd.curCanvasX - rd.tileW / 2;
    const ghostY = rd.curCanvasY - rd.tileH / 2;

    ctx.save();
    ctx.globalAlpha = 0.72;
    // Clip ghost to content area so it doesn't overdraw the title bar or scrollbar
    ctx.beginPath();
    ctx.rect(0, TH, WC, node.size[1] - TH);
    ctx.clip();

    rrect(ctx, ghostX, ghostY, rd.tileW, rd.tileH, R, C.thumb, C.borderHov, 2);

    if (rd.kind === "gallery") {
      const src = `/steaked/library/character/${this._char?.id}/image/${rd.list[rd.fromIdx]}`;
      const img = getImg(src, null);
      if (img?.complete && img.naturalWidth > 0) {
        ctx.beginPath();
        ctx.roundRect
          ? ctx.roundRect(ghostX, ghostY, rd.tileW, rd.tileH, R)
          : ctx.rect(ghostX, ghostY, rd.tileW, rd.tileH);
        ctx.clip();
        drawImgCropped(ctx, img, ghostX, ghostY, rd.tileW, rd.tileH);
      }
    } else if (rd.kind === "card") {
      const ch = rd.dragCharId ? rd.list.find((c) => c.id === rd.dragCharId) : rd.list[rd.fromIdx];
      if (ch) {
        const thumbUrl = ch.gallery?.length ? `/steaked/library/character/${ch.id}/image/${ch.gallery[0]}` : null;
        const ts = 99,
          tx = ghostX + (rd.tileW - ts) / 2,
          ty = ghostY + 10;
        if (thumbUrl) {
          const img = getImg(thumbUrl, null);
          if (img?.complete && img.naturalWidth > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(tx, ty, ts, ts, R) : ctx.rect(tx, ty, ts, ts);
            ctx.clip();
            drawImgCropped(ctx, img, tx, ty, ts, ts);
            ctx.restore();
          }
        }
        label(ctx, ch.name, ghostX + rd.tileW / 2, ghostY + 10 + 99 + 16, C.text, 10, "center", false, rd.tileW - 8);
      }
    }
    ctx.restore();
  }

  // ── Mouse events ─────────────────────────────────────────────────────────────
  onMouseDown(e) {
    const relX = e.canvasX - this.node.pos[0];
    const relY = e.canvasY - this.node.pos[1];

    // Clear any stale state
    this.reorderDrag = null;
    this.clickPending = null;
    this.drag = null;

    for (const [, c] of Object.entries(this.controls)) {
      if (!this.isIn(relX, relY, c)) continue;

      if (c.deferred && c.dragInfo) {
        // Drag handle: start tracking for reorder (no click action)
        this.reorderDrag = {
          ...c.dragInfo,
          startAbsX: e.canvasX,
          startAbsY: e.canvasY,
          curCanvasX: relX,
          curCanvasY: relY,
          active: false,
          toIdx: 0,
          targetFolder: c.dragInfo.sourceFolder ?? null,
        };
        // If the handle also has a click action (currently none for cards)
        if (c.action) this.clickPending = c.action;
      } else {
        if (c.action) c.action(e);
        if (this.drag) this.drag.startX = e.clientX;
      }
      app.graph?.setDirtyCanvas(true);
      return true;
    }
    this.reorderDrag = null;
    this.clickPending = null;
    return false;
  }

  onMouseMove(e) {
    const relX = e.canvasX - this.node.pos[0];
    const relY = e.canvasY - this.node.pos[1];

    // Number scrub
    if (this.drag) {
      const dx = (e.clientX - this.drag.startX) * 0.005;
      const v = clamp(Math.round((this.drag.startVal + dx) * 100) / 100, 0, 2);
      this.drag.onChange(v);
      app.graph?.setDirtyCanvas(true);
      return;
    }

    // Reorder drag
    if (this.reorderDrag) {
      const rd = this.reorderDrag;
      // Distance check uses ABSOLUTE canvas coords so LiteGraph's node-drag doesn't false-trigger
      const dx = e.canvasX - rd.startAbsX,
        dy = e.canvasY - rd.startAbsY;
      if (!rd.active && Math.sqrt(dx * dx + dy * dy) > 10) rd.active = true;

      if (rd.active) {
        rd.curCanvasX = relX;
        rd.curCanvasY = relY;
        const scrollSpaceY = relY + this.scrollY;

        if (rd.kind === "gallery") {
          const layout = this._galLayout;
          if (layout) {
            const col = clamp(
              Math.floor((relX - layout.startX) / (layout.tileW + layout.gap)),
              0,
              layout.tilesPerRow - 1,
            );
            const row = Math.max(0, Math.floor((scrollSpaceY - layout.startY) / (layout.tileH + layout.gap)));
            rd.toIdx = clamp(row * layout.tilesPerRow + col, 0, layout.listLen - 1);
          }
        } else if (rd.kind === "card") {
          // Find which folder zone the cursor is currently over
          const zone =
            this._folderZones.find((z) => scrollSpaceY >= z.startScrollY && scrollSpaceY < z.endScrollY) ??
            this._folderZones[this._folderZones.length - 1]; // fallback: last zone
          if (zone) {
            rd.targetFolder = zone.folder;
            const col = clamp(Math.floor((relX - zone.startX) / (zone.tileW + zone.gap)), 0, zone.tilesPerRow - 1);
            const row = Math.max(0, Math.floor((scrollSpaceY - zone.startScrollY) / (zone.tileH + zone.gap)));
            // listLen excluding the dragged card if same zone
            const zoneLen = zone.listLen - (rd.targetFolder === rd.sourceFolder ? 1 : 0);
            rd.toIdx = clamp(row * zone.tilesPerRow + col, 0, Math.max(0, zoneLen));
          }
        } else if (rd.kind === "textblock") {
          const layout = this._tbLayout;
          if (layout) {
            const row = Math.round((scrollSpaceY - layout.startScrollY) / layout.rowH);
            rd.toIdx = clamp(row, 0, Math.max(0, layout.listLen - 1));
          }
        }
        app.graph?.setDirtyCanvas(true);
        return;
      }
    }

    // Hover detection
    let newHov = null;
    for (const [id, c] of Object.entries(this.controls)) {
      if (this.isIn(relX, relY, c)) {
        newHov = id;
        break;
      }
    }
    if (newHov !== this.hover) {
      this.hover = newHov;
      clearTimeout(this.tooltipTimer);
      this.tooltipEl = null;
      if (newHov && this.controls[newHov]?.tip)
        this.tooltipTimer = setTimeout(() => {
          this.tooltipEl = newHov;
          app.graph?.setDirtyCanvas(true);
        }, 600);
      app.graph?.setDirtyCanvas(true);
    }
  }

  onMouseUp(e) {
    if (this.drag) {
      this.drag = null;
      app.graph?.setDirtyCanvas(true);
      return true;
    }

    if (this.reorderDrag) {
      const rd = this.reorderDrag;
      if (rd.active) {
        if (rd.kind === "gallery") {
          // Simple same-list reorder
          const { list, fromIdx, toIdx } = rd;
          const item = list[fromIdx];
          const without = list.filter((_, i) => i !== fromIdx);
          without.splice(toIdx, 0, item);
          list.length = 0;
          list.push(...without);
          this._save();
        } else if (rd.kind === "card") {
          const allChars = this.data.characters;
          const ch = allChars.find((c) => c.id === rd.dragCharId);
          if (ch) {
            const newFolder = rd.targetFolder ?? "";
            // Chars in target folder excluding the dragged char
            const targetFolderChars = allChars.filter((c) => (c.folder ?? "") === newFolder && c.id !== ch.id);
            const insertBefore = targetFolderChars[rd.toIdx]; // undefined = append to end of folder
            // Update the folder assignment
            ch.folder = newFolder;
            // Remove from current position
            allChars.splice(allChars.indexOf(ch), 1);
            // Re-insert at the correct spot
            if (insertBefore) {
              allChars.splice(allChars.indexOf(insertBefore), 0, ch);
            } else {
              // Find last char in target folder and insert after it
              let lastInFolder = -1;
              for (let i = 0; i < allChars.length; i++) {
                if ((allChars[i].folder ?? "") === newFolder) lastInFolder = i;
              }
              allChars.splice(lastInFolder + 1, 0, ch);
            }
            this._save();
          }
        } else if (rd.kind === "textblock") {
          const { list, fromIdx, toIdx } = rd;
          if (list && fromIdx != null && toIdx != null && fromIdx !== toIdx) {
            const item = list[fromIdx];
            const without = list.filter((_, i) => i !== fromIdx);
            without.splice(clamp(toIdx, 0, without.length), 0, item);
            list.length = 0;
            list.push(...without);
            this._save();
          }
        }
      } else if (this.clickPending) {
        this.clickPending(e);
      }
      this.reorderDrag = null;
      this.clickPending = null;
      app.graph?.setDirtyCanvas(true);
      return true;
    }

    if (this.clickPending) {
      this.clickPending(e);
      this.clickPending = null;
      app.graph?.setDirtyCanvas(true);
      return true;
    }
    return false;
  }

  onWheel(e) {
    const TH = LiteGraph.NODE_TITLE_HEIGHT;
    const visH = this.node.size[1] - TH;
    const max = Math.max(0, this.totalH - visH);
    this.scrollY = clamp(this.scrollY + e.deltaY * 0.4, 0, max);
    app.graph?.setDirtyCanvas(true);
    return true;
  }

  // ── File operations ───────────────────────────────────────────────────────────
  _uploadImages(ch) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.multiple = true;
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", async () => {
      for (const f of inp.files) {
        const fd = new FormData();
        fd.append("image", f, f.name);
        try {
          const r = await fetch(`/steaked/library/character/${ch.id}/image`, { method: "POST", body: fd });
          const d = await r.json();
          if (d.success) (ch.gallery ?? (ch.gallery = [])).push(d.filename);
        } catch (err) {
          console.error("[SteakedLib] upload:", err);
        }
      }
      await this._save();
      inp.remove();
    });
    inp.click();
  }

  async _exportLibrary() {
    try {
      const r = await fetch("/steaked/library/export");
      if (!r.ok) throw new Error(`${r.status}`);
      const blob = await r.blob();
      downloadBlob(blob, "steaked_library.zip");
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    }
  }

  _importLibrary() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".zip";
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", async () => {
      const f = inp.files[0];
      if (!f) {
        inp.remove();
        return;
      }
      const mode = confirm(
        "Replace entire library?\n\n• OK = Replace (overwrites everything)\n• Cancel = Merge (adds new characters, keeps existing)",
      )
        ? "replace"
        : "merge";
      const fd = new FormData();
      fd.append("file", f, f.name);
      try {
        const r = await fetch(`/steaked/library/import?mode=${mode}`, { method: "POST", body: fd });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        await this._load();
        alert(`Library imported (${mode} mode).`);
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
      inp.remove();
    });
    inp.click();
  }

  /** Called by the generation capture listener to save an output image into this character's gallery. */
  async captureImage(imageInfo) {
    const ch = this._char;
    if (!ch) return;
    try {
      const imgUrl = comfyImageUrl(imageInfo);
      const imgResp = await fetch(imgUrl);
      const blob = await imgResp.blob();
      const ext = (imageInfo.filename.split(".").pop() || "png").toLowerCase();
      const fname = `capture_${Date.now()}.${ext}`;
      const fd = new FormData();
      fd.append("image", blob, fname);
      const r = await fetch(`/steaked/library/character/${ch.id}/image`, { method: "POST", body: fd });
      const d = await r.json();
      if (d.success) {
        (ch.gallery ?? (ch.gallery = [])).push(d.filename);
        await this._save();
      }
    } catch (err) {
      console.error("[SteakedLib] capture:", err);
    }
  }
}
