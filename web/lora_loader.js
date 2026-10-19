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
      // Properly hide the raw JSON widget: excluded from layout, sizing, and
      // the DOM widget overlay layer entirely.
      stackWidget.hidden = true;
      stackWidget.serializeValue = async () =>
        typeof stackWidget.value === "string" ? stackWidget.value : JSON.stringify(stackWidget.value ?? {});
      if (typeof stackWidget.value !== "string" || !stackWidget.value) stackWidget.value = "{}";

      const widget = new LoraLoaderWidget(this, stackWidget);
      this._steakedLoraWidget = widget;


      const contentHeight = () => {
        const measured = widget.el?.scrollHeight ?? 0;
        if (measured > 20) return measured;
        const rows = widget.entries?.length ?? 0;
        return 26 + rows * 28 + 30 + 36 + 14;
      };
      const domWidget = this.addDOMWidget("lora_loader_ui", "steaked_lora_ui", widget.el, {
        hideOnZoom: false,
        margin: 4,
        getMinHeight: () => contentHeight() + 8,
        getMaxHeight: () => contentHeight() + 8,
        getHeight: () => contentHeight() + 8,
        onDraw: () => {},
      });
      domWidget.serialize = false;
    };

    // Ensure the node is big enough for the DOM widget after graph load
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      onConfigure?.apply(this, arguments);
      if (this._steakedLoraWidget) {
        this._steakedLoraWidget._loadState();
        this._steakedLoraWidget._loadCombos();
        this.setDirtyCanvas?.(true, true);
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
