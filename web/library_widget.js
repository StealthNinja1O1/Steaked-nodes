/**
 * library_widget.js  --  thin entry-point for the Prompt Library node.
 *
 * All business logic lives in ./library/canvas.js.
 * This file only registers the ComfyUI extension and wires up generation capture.
 */
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ComfyWidgets } from "../../scripts/widgets.js";
import { LibraryCanvas, _instances } from "./library/canvas.js";
import { showCaptureToast } from "./library/popups.js";

app.registerExtension({
  name: "Steaked.PromptLibrary",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "SteakedLibrary") return;

    // Stash output names (RETURN_NAMES from server) so constructor can label slots
    nodeType._steakedOutputNames = nodeData.output_name ?? [];

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      onNodeCreated?.apply(this, arguments);

      // Fully hide the selected_character and snap_data widgets.
      // We deliberately avoid setting w.type so LiteGraph doesn't reclassify
      // them as slot widgets. Zero-size + no-draw keeps them invisible while
      // still serialising their values into the workflow / PNG metadata.
      // Crucially we also reset w.h (LiteGraph's cached height) so the node
      // layout doesn't phantom-reserve space for the unhidden versions.
      const HIDDEN_WIDGETS = new Set(["selected_character", "snap_data"]);
      for (const w of this.widgets ?? []) {
        if (HIDDEN_WIDGETS.has(w.name)) {
          w.computeSize = () => [0, -4];
          w.h = -4;  // clear cached height used by LiteGraph layout
          w.draw = () => {};
          w.serializeValue = async () => w.value ?? "";
        }
      }

      this._libCanvas = new LibraryCanvas(this);

      // Create a shared inline editor widget so that ComfyUI autocomplete
      // extensions (which patch ComfyWidgets.STRING at widget-creation time)
      // attach their event handlers to a real registered textarea.
      // _inlineEdit() repositions and shows this element on demand instead of
      // creating throw-away <textarea> elements that autocomplete never sees.
      try {
        const edRes = ComfyWidgets.STRING(this, "__inline_editor__",
          ["STRING", { multiline: true, default: "" }], app);
        const ew = edRes?.widget;
        if (ew) {
          const el = ew.element ?? ew.inputEl;
          ew.computeSize = () => [0, -4];
          ew.h = -4;
          ew.draw = () => {};
          ew.serializeValue = async () => ""; // never persist editing state
          if (el) {
            // Move out of ComfyUI's canvas widget container into document.body.
            // Any ancestor with a CSS `transform` property causes position:fixed
            // elements to position relative to that ancestor instead of the
            // viewport, breaking our coordinate math. document.body is safe.
            document.body.appendChild(el);
            el.style.cssText = "display:none;position:fixed;z-index:99999;";
            // Clear the widget's own element reference so ComfyUI doesn't try
            // to re-parent or repositon it through its normal widget lifecycle.
            ew.element  = null;
            ew.inputEl  = null;
          }
          this.__inlineEditorEl = el ?? null;
        }
      } catch (e) {
        console.warn("[PromptLibrary] Could not create inline editor widget:", e);
      }

      // Restore selected character from serialized widget value
      const sw = this.widgets?.find(w => w.name === "selected_character");
      if (sw?.value) {
        this._libCanvas.charId = sw.value;
        this._libCanvas.view   = "char";
      }
    };

    // Forward wheel so canvas scrolling works even when LiteGraph intercepts it
    const onMouseWheel = nodeType.prototype.onMouseWheel;
    nodeType.prototype.onMouseWheel = function(e, pos) {
      if (this._libCanvas) return this._libCanvas.onWheel(e);
      return onMouseWheel?.apply(this, arguments) ?? false;
    };

    // Reload data when a saved graph is loaded, then restore selected character
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function(info) {
      onConfigure?.apply(this, arguments);
      const node = this;
      setTimeout(() => {
        if (!node._libCanvas) return;
        node._libCanvas._load().then?.(() => {
          const sw = node.widgets?.find(w => w.name === "selected_character");
          if (sw?.value) {
            node._libCanvas.charId = sw.value;
            node._libCanvas.view   = "char";
            node._libCanvas.scrollY = 0;
            app.graph?.setDirtyCanvas(true);
          }
        });
        // Fallback: _load() may not return a promise in all versions, so also apply immediately
        const sw = node.widgets?.find(w => w.name === "selected_character");
        if (sw?.value) {
          node._libCanvas.charId = sw.value;
          node._libCanvas.view   = "char";
          node._libCanvas.scrollY = 0;
        }
      }, 50);
    };
  },

  setup() {
    // Generation capture: when ComfyUI finishes a run, offer to save output images
    // to whichever Library node currently has a character selected.
    api.addEventListener("executed", (event) => {
      const output = event.detail?.output;
      if (!output?.images?.length) return;

      for (const inst of _instances) {
        if (!inst.charId) continue;
        const charName = inst._char?.name ?? "Character";
        const images = output.images; // all images from this run

        // Single toast that saves every output image at once
        showCaptureToast(
          charName,
          async () => {
            for (const imgInfo of images) {
              await inst.captureImage(imgInfo);
            }
          },
          () => {},
          images.length,
        );
        break; // only the first matched instance gets the toast
      }
    });
  },
});
