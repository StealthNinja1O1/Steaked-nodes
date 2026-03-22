/**
 * library_widget.js  --  thin entry-point for the Prompt Library node.
 *
 * All business logic lives in ./library/canvas.js.
 * This file only registers the ComfyUI extension and wires up generation capture.
 */
import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";
import { LibraryCanvas, _instances } from "./library/canvas.js";

app.registerExtension({
  name: "Steaked.PromptLibrary",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "SteakedLibrary") return;

    // Stash output names (RETURN_NAMES from server) so constructor can label slots
    nodeType._steakedOutputNames = nodeData.output_name ?? [];

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);

      const HIDDEN_WIDGETS = new Set(["selected_character", "snap_data"]);
      for (const w of this.widgets ?? []) {
        if (HIDDEN_WIDGETS.has(w.name)) {
          w.computeSize = () => [0, -4];
          w.h = -4; 
          w.draw = () => {};
          w.serializeValue = async () => w.value ?? "";
        }
      }

      this._libCanvas = new LibraryCanvas(this);
      try {
        const edRes = ComfyWidgets.STRING(this, "__inline_editor__", ["STRING", { multiline: true, default: "" }], app);
        const ew = edRes?.widget;
        if (ew) {
          const el = ew.element ?? ew.inputEl;
          ew.computeSize = () => [0, -4];
          ew.h = -4;
          ew.draw = () => {};
          ew.serializeValue = async () => ""; // never persist editing state
          if (el) {
            document.body.appendChild(el);
            el.style.cssText = "display:none;position:fixed;z-index:99999;";
            ew.element = null;
            ew.inputEl = null;
          }
          this.__inlineEditorEl = el ?? null;
        }
      } catch (e) {
        console.warn("[PromptLibrary] Could not create inline editor widget:", e);
      }

      // Restore selected character from serialized widget value
      const sw = this.widgets?.find((w) => w.name === "selected_character");
      if (sw?.value) {
        this._libCanvas.charId = sw.value;
        this._libCanvas.view = "char";
      }
    };

    // Forward wheel so canvas scrolling works even when LiteGraph intercepts it
    const onMouseWheel = nodeType.prototype.onMouseWheel;
    nodeType.prototype.onMouseWheel = function (e, pos) {
      if (this._libCanvas) return this._libCanvas.onWheel(e);
      return onMouseWheel?.apply(this, arguments) ?? false;
    };

    // Reload data when a saved graph is loaded, then restore selected character
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      onConfigure?.apply(this, arguments);
      const node = this;
      setTimeout(() => {
        if (!node._libCanvas) return;
        node._libCanvas._load().then?.(() => {
          const sw = node.widgets?.find((w) => w.name === "selected_character");
          if (sw?.value) {
            node._libCanvas.charId = sw.value;
            node._libCanvas.view = "char";
            node._libCanvas.scrollY = 0;
            app.graph?.setDirtyCanvas(true);
          }
        });
        // Fallback: _load() may not return a promise in all versions, so also apply immediately
        const sw = node.widgets?.find((w) => w.name === "selected_character");
        if (sw?.value) {
          node._libCanvas.charId = sw.value;
          node._libCanvas.view = "char";
          node._libCanvas.scrollY = 0;
        }
      }, 50);
    };
  },
});