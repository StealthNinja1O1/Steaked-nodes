/**
 * Entry point for the Combo Lora Loader ui.
 */

import { app } from "../../scripts/app.js";
import { LoraLoaderWidget } from "./lora_loader/widget.js";
import { injectLoraStyles } from "./lora_loader/styles.js";

app.registerExtension({
  name: "Steaked.LoraLoader",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "ComboLoraLoader") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      injectLoraStyles();

      this.serialize_widgets = true;

      const stackWidget = this.widgets?.find((w) => w.name === "lora_stack");
      if (!stackWidget) return;
      stackWidget.computeSize = () => [0, -4];
      stackWidget.h = -4;
      stackWidget.draw = () => {};
      stackWidget.serializeValue = async () =>
        typeof stackWidget.value === "string" ? stackWidget.value : JSON.stringify(stackWidget.value ?? {});
      if (typeof stackWidget.value !== "string" || !stackWidget.value) stackWidget.value = "{}";
      const rawEl = stackWidget.element ?? stackWidget.inputEl;
      if (rawEl) {
        document.body.appendChild(rawEl);
        rawEl.style.cssText = "display:none;position:fixed;z-index:-1;pointer-events:none;";
        stackWidget.element = null;
        stackWidget.inputEl = null;
      }

      const widget = new LoraLoaderWidget(this, stackWidget);
      this._steakedLoraWidget = widget;

      const domWidget = this.addDOMWidget("lora_loader_ui", "steaked_lora_ui", widget.el, {
        hideOnZoom: false,
        getMinHeight: () => 260,
        getMaxHeight: () => 460,
        getHeight: () => Math.max(200, widget.el?.offsetHeight ?? 300),
        onDraw: () => {},
      });
      domWidget.serialize = false;
      this.setSize([Math.max(this.size[0], 340), this.size[1]]);
    };

    // Ensure the node is big enough for the DOM widget after graph load
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      onConfigure?.apply(this, arguments);
      if (this._steakedLoraWidget) {
        this._steakedLoraWidget._loadState();
        this._steakedLoraWidget._loadCombos();
      }
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      onRemoved?.apply(this, arguments);
      this._steakedLoraWidget?.modal?.close();
    };

    const onKeyDown = nodeType.prototype.onKeyDown;
    nodeType.prototype.onKeyDown = function (e) {
      if (this._steakedLoraWidget?.selected?.size && (e.key === "Delete" || e.key === "Backspace")) {
        this._steakedLoraWidget._deleteSelected();
        e.preventDefault();
        return true;
      }
      return onKeyDown?.apply(this, arguments);
    };
  },
});
