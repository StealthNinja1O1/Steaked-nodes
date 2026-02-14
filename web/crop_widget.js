import { app } from "../../scripts/app.js";
const HANDLE_SIZE = 10;
const MIN_CROP_SIZE = 20;

app.registerExtension({
  name: "Steaked.LoadAndCrop",

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "LoadAndCrop") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

      this.serialize_widgets = true;

      this.cropState = {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        imageWidth: 100,
        imageHeight: 100,
        isDragging: false,
        isResizing: false,
        dragHandle: null,
        dragStartX: 0,
        dragStartY: 0,
        initialCrop: null,
      };

      this.imageElement = null;
      this.imageLoaded = false;

      const cropDataWidget = this.addWidget("text", "crop_data", "", (v) => {}, { serialize: true });
      cropDataWidget.computeSize = () => [0, -4]; // Hide completely
      this.cropDataWidget = cropDataWidget;

      const imageWidget = this.widgets.find((w) => w.name === "image");
      if (imageWidget) {
        imageWidget.options = imageWidget.options || {};
        imageWidget.options.hidePreview = true;
        imageWidget.serializeValue = async (node, index) => {
          return imageWidget.value;
        };

        const originalCallback = imageWidget.callback;
        imageWidget.callback = (...args) => {
          if (originalCallback) originalCallback.apply(imageWidget, args);
          this.loadImagePreview(imageWidget.value);
        };

        if (imageWidget.value && imageWidget.value.trim() !== "") {
          setTimeout(() => {
            this.loadImagePreview(imageWidget.value);
          }, 100);
        }
      }

      const originalOnDrawBackground = this.onDrawBackground;
      this.onDrawBackground = function (ctx) {
        const temp = this.imgs;
        this.imgs = null;
        if (originalOnDrawBackground) {
          originalOnDrawBackground.apply(this, arguments);
        }
        this.imgs = temp;
      };

      return r;
    };

    const onDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (onDrawForeground) {
        onDrawForeground.apply(this, arguments);
      }

      if (!this.imageLoaded || !this.imageElement) return;

      const node = this;
      const margin = 10;
      const headerHeight = LiteGraph.NODE_TITLE_HEIGHT;

      let widgetsHeight = 0;
      if (this.widgets) {
        for (let w of this.widgets) {
          if (w.computeSize) {
            const size = w.computeSize();
            if (size && size[1] > 0) {
              widgetsHeight += size[1] + 4;
            }
          } else {
            widgetsHeight += LiteGraph.NODE_WIDGET_HEIGHT + 4;
          }
        }
      }

      widgetsHeight += 100;

      const startY = headerHeight + widgetsHeight + margin;
      const availableWidth = node.size[0] - margin * 2;
      const availableHeight = node.size[1] - startY - margin;

      const imgAspect = this.cropState.imageWidth / this.cropState.imageHeight;
      let displayWidth = availableWidth;
      let displayHeight = displayWidth / imgAspect;

      if (displayHeight > availableHeight) {
        displayHeight = availableHeight;
        displayWidth = displayHeight * imgAspect;
      }

      const startX = margin + (availableWidth - displayWidth) / 2;
      ctx.save();
      try {
        ctx.drawImage(this.imageElement, startX, startY, displayWidth, displayHeight);
      } catch (e) {
        console.error("Error drawing image:", e);
      }

      const scaleX = displayWidth / this.cropState.imageWidth;
      const scaleY = displayHeight / this.cropState.imageHeight;
      const cropX = startX + this.cropState.x * scaleX;
      const cropY = startY + this.cropState.y * scaleY;
      const cropWidth = this.cropState.width * scaleX;
      const cropHeight = this.cropState.height * scaleY;

      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(startX, startY, displayWidth, cropY - startY); // Top
      ctx.fillRect(startX, cropY, cropX - startX, cropHeight); // Left
      ctx.fillRect(cropX + cropWidth, cropY, startX + displayWidth - (cropX + cropWidth), cropHeight); // Right
      ctx.fillRect(startX, cropY + cropHeight, displayWidth, startY + displayHeight - (cropY + cropHeight)); // Bottom

      ctx.strokeStyle = "#00ff00";
      ctx.lineWidth = 2;
      ctx.strokeRect(cropX, cropY, cropWidth, cropHeight);

      ctx.fillStyle = "#00ff00";
      const handles = [
        { x: cropX - HANDLE_SIZE / 2, y: cropY - HANDLE_SIZE / 2 }, // Top-left
        { x: cropX + cropWidth - HANDLE_SIZE / 2, y: cropY - HANDLE_SIZE / 2 }, // Top-right
        { x: cropX - HANDLE_SIZE / 2, y: cropY + cropHeight - HANDLE_SIZE / 2 }, // Bottom-left
        { x: cropX + cropWidth - HANDLE_SIZE / 2, y: cropY + cropHeight - HANDLE_SIZE / 2 }, // Bottom-right
        { x: cropX + cropWidth / 2 - HANDLE_SIZE / 2, y: cropY - HANDLE_SIZE / 2 }, // Top-center
        { x: cropX + cropWidth / 2 - HANDLE_SIZE / 2, y: cropY + cropHeight - HANDLE_SIZE / 2 }, // Bottom-center
        { x: cropX - HANDLE_SIZE / 2, y: cropY + cropHeight / 2 - HANDLE_SIZE / 2 }, // Left-center
        { x: cropX + cropWidth - HANDLE_SIZE / 2, y: cropY + cropHeight / 2 - HANDLE_SIZE / 2 }, // Right-center
      ];

      handles.forEach((handle) => {
        ctx.fillRect(handle.x, handle.y, HANDLE_SIZE, HANDLE_SIZE);
      });

      ctx.restore();

      this.displayBounds = {
        startX,
        startY,
        displayWidth,
        displayHeight,
        scaleX,
        scaleY,
      };
    };

    nodeType.prototype.onMouseDown = function (e, localPos, canvas) {
      if (!this.displayBounds || !this.imageLoaded) return false;

      const [mouseX, mouseY] = localPos;
      const { startX, startY, scaleX, scaleY } = this.displayBounds;

      const cropX = startX + this.cropState.x * scaleX;
      const cropY = startY + this.cropState.y * scaleY;
      const cropWidth = this.cropState.width * scaleX;
      const cropHeight = this.cropState.height * scaleY;

      const handles = [
        { name: "tl", x: cropX, y: cropY },
        { name: "tr", x: cropX + cropWidth, y: cropY },
        { name: "bl", x: cropX, y: cropY + cropHeight },
        { name: "br", x: cropX + cropWidth, y: cropY + cropHeight },
        { name: "tc", x: cropX + cropWidth / 2, y: cropY },
        { name: "bc", x: cropX + cropWidth / 2, y: cropY + cropHeight },
        { name: "lc", x: cropX, y: cropY + cropHeight / 2 },
        { name: "rc", x: cropX + cropWidth, y: cropY + cropHeight / 2 },
      ];

      for (const handle of handles) {
        if (Math.abs(mouseX - handle.x) < HANDLE_SIZE * 1.5 && Math.abs(mouseY - handle.y) < HANDLE_SIZE * 1.5) {
          this.cropState.isResizing = true;
          this.cropState.dragHandle = handle.name;
          this.cropState.dragStartX = mouseX;
          this.cropState.dragStartY = mouseY;
          this.cropState.initialCrop = { ...this.cropState };

          // Prevent node dragging
          e.preventDefault?.();
          e.stopPropagation?.();
          canvas.setDirty(true, true);
          return true;
        }
      }

      if (mouseX >= cropX && mouseX <= cropX + cropWidth && mouseY >= cropY && mouseY <= cropY + cropHeight) {
        this.cropState.isDragging = true;
        this.cropState.dragStartX = mouseX;
        this.cropState.dragStartY = mouseY;
        this.cropState.initialCrop = { ...this.cropState };

        // Prevent node dragging
        e.preventDefault?.();
        e.stopPropagation?.();
        canvas.setDirty(true, true);
        return true;
      }

      return false;
    };

    nodeType.prototype.onMouseMove = function (e, localPos, canvas) {
      if (!this.displayBounds || !this.imageLoaded) return;
      if (!this.cropState.isDragging && !this.cropState.isResizing) return;

      // Check if mouse button is still pressed (fixes cursor attachment bug)
      if (e.buttons !== undefined && (e.buttons & 1) === 0) {
        this.cropState.isDragging = false;
        this.cropState.isResizing = false;
        this.cropState.dragHandle = null;
        this.saveCropData();
        canvas.setDirty(true, true);
        return;
      }

      const [mouseX, mouseY] = localPos;
      const { scaleX, scaleY } = this.displayBounds;

      if (this.cropState.isDragging) {
        const deltaX = (mouseX - this.cropState.dragStartX) / scaleX;
        const deltaY = (mouseY - this.cropState.dragStartY) / scaleY;

        this.cropState.x = Math.max(
          0,
          Math.min(this.cropState.imageWidth - this.cropState.width, this.cropState.initialCrop.x + deltaX)
        );
        this.cropState.y = Math.max(
          0,
          Math.min(this.cropState.imageHeight - this.cropState.height, this.cropState.initialCrop.y + deltaY)
        );
      } else if (this.cropState.isResizing) {
        const deltaX = (mouseX - this.cropState.dragStartX) / scaleX;
        const deltaY = (mouseY - this.cropState.dragStartY) / scaleY;
        const handle = this.cropState.dragHandle;
        const initial = this.cropState.initialCrop;

        if (handle.includes("l")) {
          const newX = Math.max(0, Math.min(initial.x + initial.width - MIN_CROP_SIZE, initial.x + deltaX));
          const newWidth = initial.width + (initial.x - newX);
          this.cropState.x = newX;
          this.cropState.width = newWidth;
        }
        if (handle.includes("r")) {
          this.cropState.width = Math.max(
            MIN_CROP_SIZE,
            Math.min(this.cropState.imageWidth - this.cropState.x, initial.width + deltaX)
          );
        }
        if (handle.includes("t")) {
          const newY = Math.max(0, Math.min(initial.y + initial.height - MIN_CROP_SIZE, initial.y + deltaY));
          const newHeight = initial.height + (initial.y - newY);
          this.cropState.y = newY;
          this.cropState.height = newHeight;
        }
        if (handle.includes("b")) {
          this.cropState.height = Math.max(
            MIN_CROP_SIZE,
            Math.min(this.cropState.imageHeight - this.cropState.y, initial.height + deltaY)
          );
        }
      }

      this.saveCropData();
      canvas.setDirty(true, true);
    };

    nodeType.prototype.onMouseUp = function (e, localPos, canvas) {
      if (this.cropState.isDragging || this.cropState.isResizing) {
        this.cropState.isDragging = false;
        this.cropState.isResizing = false;
        this.cropState.dragHandle = null;
        this.saveCropData();
        return true;
      }
      return false;
    };

    nodeType.prototype.loadImagePreview = async function (filename) {
      if (!filename) return;

      try {
        const img = new Image();
        img.onload = () => {
          this.imageElement = img;
          this.imageLoaded = true;
          this.cropState.imageWidth = img.width;
          this.cropState.imageHeight = img.height;

          const cropDataWidget = this.widgets.find((w) => w.name === "crop_data");
          let hasSavedCrop = false;

          if (cropDataWidget && cropDataWidget.value && cropDataWidget.value.trim() !== "") {
            try {
              const savedCrop = JSON.parse(cropDataWidget.value);
              if (
                savedCrop.x >= 0 &&
                savedCrop.y >= 0 &&
                savedCrop.width > 0 &&
                savedCrop.height > 0 &&
                savedCrop.x + savedCrop.width <= img.width &&
                savedCrop.y + savedCrop.height <= img.height
              ) {
                this.cropState.x = savedCrop.x;
                this.cropState.y = savedCrop.y;
                this.cropState.width = savedCrop.width;
                this.cropState.height = savedCrop.height;
                hasSavedCrop = true;
              }
            } catch (e) {
              console.log("Could not parse saved crop data:", e);
            }
          }

          if (!hasSavedCrop) {
            this.cropState.x = 0;
            this.cropState.y = 0;
            this.cropState.width = img.width;
            this.cropState.height = img.height;
            this.saveCropData();
          }

          let widgetsHeight = LiteGraph.NODE_TITLE_HEIGHT + 10;
          if (this.widgets) {
            for (let w of this.widgets) {
              if (w.computeSize) {
                const size = w.computeSize();
                if (size && size[1] > 0) {
                  widgetsHeight += size[1] + 4;
                }
              } else {
                widgetsHeight += LiteGraph.NODE_WIDGET_HEIGHT + 4;
              }
            }
          }

          widgetsHeight += 60;

          const targetWidth = Math.min(512, img.width + 40);
          const imageDisplayHeight = Math.min(400, (img.height / img.width) * (targetWidth - 40));
          const totalHeight = widgetsHeight + imageDisplayHeight + 40;

          this.size = [Math.max(this.size[0], targetWidth), Math.max(this.size[1], totalHeight)];

          app.graph.setDirtyCanvas(true, true);
        };
        img.onerror = () => {
          console.error("Failed to load image:", filename);
        };

        // Parse subfolder from filename (e.g., "pasted/image.png" -> subfolder="pasted", filename="image.png")
        let subfolder = "";
        let baseFilename = filename;
        const separatorIndex = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
        if (separatorIndex !== -1) {
          subfolder = filename.substring(0, separatorIndex);
          baseFilename = filename.substring(separatorIndex + 1);
        }

        img.src = `/view?filename=${encodeURIComponent(baseFilename)}&type=input&subfolder=${encodeURIComponent(subfolder)}`;
      } catch (e) {
        console.error("Error loading image preview:", e);
      }
    };

    nodeType.prototype.saveCropData = function () {
      const cropData = JSON.stringify({
        x: Math.round(this.cropState.x),
        y: Math.round(this.cropState.y),
        width: Math.round(this.cropState.width),
        height: Math.round(this.cropState.height),
      });

      if (this.cropDataWidget) {
        this.cropDataWidget.value = cropData;
      }
    };
  },
});
