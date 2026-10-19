/**
 * Entry point for the Smart Model Loader ui.
 */

import { app } from "../../scripts/app.js";
import { ModelLoaderWidget } from "./model_loader/widget.js";
import { injectModelStyles } from "./model_loader/styles.js";

app.registerExtension({
  name: "Steaked.ModelLoader",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "SmartModelLoader") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      injectModelStyles();

      this.serialize_widgets = true;

      const stateWidget = this.widgets?.find((w) => w.name === "model");
      if (!stateWidget) return;
      stateWidget.hidden = true;
      stateWidget.serializeValue = async () =>
        typeof stateWidget.value === "string" ? stateWidget.value : JSON.stringify(stateWidget.value ?? {});
      if (typeof stateWidget.value !== "string" || !stateWidget.value) stateWidget.value = "{}";

      const hiddenWidgets = {};
      for (const w of this.widgets ?? []) {
        if (w.name === "clip_name" || w.name === "vae_name" || w.name === "weight_dtype") {
          hiddenWidgets[w.name] = w;
          w.hidden = true;
        }
      }

      const widget = new ModelLoaderWidget(this, stateWidget, hiddenWidgets);
      this._steakedModelWidget = widget;

      const contentHeight = () => {
        const measured = widget.el?.scrollHeight ?? 0;
        if (measured > 20) return measured;
        if (!widget.state?.name) return 48;
        return 36 + 3 * 30 + 14;
      };
      const domWidget = this.addDOMWidget("model_loader_ui", "steaked_model_ui", widget.el, {
        hideOnZoom: false,
        margin: 4,
        getMinHeight: () => contentHeight() + 8,
        getMaxHeight: () => contentHeight() + 8,
        getHeight: () => contentHeight() + 8,
        onDraw: () => {},
      });
      domWidget.serialize = false;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      onConfigure?.apply(this, arguments);
      if (this._steakedModelWidget) {
        this._steakedModelWidget._loadState();
        this._steakedModelWidget._loadModels();
        this.setDirtyCanvas?.(true, true);
      }
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      onRemoved?.apply(this, arguments);
      this._steakedModelWidget?._infoModal?.close();
    };
  },
});
