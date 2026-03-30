import { app } from "../../scripts/app.js";
import { showLibraryModal } from "./crop/library_modal.js";

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
        folderType: "input", // Default to input folder
      };

      this.imageElement = null;
      this.imageLoaded = false;
      this.isLoadingPreview = false; // Prevent concurrent preview loads
      this.ignoreSavedFolderType = false; // Prevent restoring folderType from saved crop data

      const cropDataWidget = this.addWidget("text", "crop_data", "", (v) => {}, { serialize: true });
      cropDataWidget.computeSize = () => [0, -4]; // Hide completely
      this.cropDataWidget = cropDataWidget;

      this.addWidget("button", "Library", null, () => {
        showLibraryModal((fullFilename) => {
          // Parse folder type from filename (format: "input:filename" or "output:filename")
          const separatorIndex = fullFilename.indexOf(":");
          if (separatorIndex !== -1) {
            this.cropState.folderType = fullFilename.substring(0, separatorIndex);
            this.imageWidget.value = fullFilename.substring(separatorIndex + 1);
          } else {
            // Default to input folder if no prefix
            this.cropState.folderType = "input";
            this.imageWidget.value = fullFilename;
          }

          // Set loading flag to prevent race condition with widget callback
          this.isLoadingPreview = true;
          this.ignoreSavedFolderType = true; // Don't restore old folderType from saved crop data

          // Update dropdown value without triggering callback first
          this.imageWidget.options.values = [...this.imageWidget.options.values];
          this.imageWidget.value = this.imageWidget.value;

          // Save crop data with new folderType BEFORE loading preview
          // This ensures even if callback tries to restore, it restores the correct folderType
          this.saveCropData();

          // Load preview with explicit folder type
          this.loadImagePreview(this.imageWidget.value, this.cropState.folderType);

          // Clear loading flag after a delay
          setTimeout(() => {
            this.isLoadingPreview = false;
          }, 100);

          // Save crop data with new folder type
          this.saveCropData();

          // Update dropdown callback after everything is done
          setTimeout(() => {
            if (!this.isLoadingPreview) {
              this.imageWidget.options.values = [...this.imageWidget.options.values];
              this.imageWidget.callback(this.imageWidget.value);
            }
          }, 150);
        });
      });

      this.addWidget("button", "Reset Crop", null, () => {
        if (!this.imageLoaded) return;
        this.cropState.x = 0;
        this.cropState.y = 0;
        this.cropState.width = this.cropState.imageWidth;
        this.cropState.height = this.cropState.imageHeight;
        this.saveCropData();
        app.graph.setDirtyCanvas(true, true);
      });

      const imageWidget = this.widgets.find((w) => w.name === "image");
      this.imageWidget = imageWidget;
      if (imageWidget) {
        imageWidget.options = imageWidget.options || {};
        imageWidget.options.hidePreview = true;
        imageWidget.serializeValue = async (node, index) => {
          return imageWidget.value;
        };

        const originalCallback = imageWidget.callback;
        imageWidget.callback = (...args) => {
          if (originalCallback) originalCallback.apply(imageWidget, args);
          // Skip preview loading if we're already loading from library
          if (this.isLoadingPreview) return;

          // When image is changed via dropdown or paste, extract folder type
          let filename = imageWidget.value;
          if (filename) {
            // Check if filename has folder type prefix (format: "folder_type:filename")
            if (filename.includes(":")) {
              const prefixIndex = filename.indexOf(":");
              this.cropState.folderType = filename.substring(0, prefixIndex);
              filename = filename.substring(prefixIndex + 1);
            }
            // Check if filename has subfolder path
            const separatorIndex = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
            if (separatorIndex !== -1) {
              // It's a pasted image with subfolder path
              const subfolder = filename.substring(0, separatorIndex);
              const baseFilename = filename.substring(separatorIndex + 1);

              // Set folder type based on subfolder (only if not already set)
              if (!this.cropState.folderType) {
                this.cropState.folderType = "input";
              }
              // Keep the full path including subfolder in imageWidget.value
              // Don't strip subfolder from the value
              this.loadImagePreview(filename, this.cropState.folderType);
              this.saveCropData();
              return; // Don't call loadImagePreview again below
            }
          }

          // Prevent loadImagePreview from restoring the old filename from saved crop data.
          // This flag is only cleared during the initial load (onNodeCreated / onConfigure).
          this.ignoreSavedFolderType = true;
          this.loadImagePreview(filename);
          // Clear flag after a short delay so the initial page-load path still works
          setTimeout(() => {
            this.ignoreSavedFolderType = false;
          }, 200);
        };

        // Update serializeValue to include folder type in the returned filename
        const originalSerializeValue = imageWidget.serializeValue;
        imageWidget.serializeValue = async (node, index) => {
          const filename = imageWidget.value;
          const folderType = this.cropState.folderType || "input";
          // Return filename with folder type prefix if not already present
          if (filename && !filename.includes(":")) {
            return `${folderType}:${filename}`;
          }
          return filename;
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

      // Draw folder type badge
      const folderType = this.cropState.folderType || "input";
      const folderBadgeColor = folderType === "output" ? "#ff9800" : "#4caf50";
      ctx.fillStyle = folderBadgeColor;
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "left";
      ctx.fillText(folderType.toUpperCase(), startX, startY - 6);

      // Draw resolution and megapixel info below the image
      const resW = Math.round(this.cropState.width);
      const resH = Math.round(this.cropState.height);
      const megapixels = ((resW * resH) / 1000000).toFixed(2);

      ctx.fillStyle = "#888";
      ctx.font = "11px Arial";
      ctx.textAlign = "center";
      ctx.fillText(`${resW} × ${resH} (${megapixels} MP)`, startX + displayWidth / 2, startY + displayHeight + 20);

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

    nodeType.prototype.loadImagePreview = async function (filename, explicitFolderType = null) {
      if (!filename) return;

      try {
        // Strip folder type prefix if present (format: "folder_type:filename")
        if (filename.includes(":")) {
          const separatorIndex = filename.indexOf(":");
          const folderType = filename.substring(0, separatorIndex);
          const actualFilename = filename.substring(separatorIndex + 1);

          // Update folder type if not explicitly provided
          if (!explicitFolderType) {
            this.cropState.folderType = folderType;
          }
          // Use the actual filename without prefix
          filename = actualFilename;
        }

        // Restore folder type and filename from saved crop data (for page refresh)
        if (!explicitFolderType && !this.ignoreSavedFolderType) {
          const cropDataWidget = this.widgets.find((w) => w.name === "crop_data");
          if (cropDataWidget && cropDataWidget.value && cropDataWidget.value.trim() !== "") {
            try {
              const savedCrop = JSON.parse(cropDataWidget.value);
              if (savedCrop.folderType) {
                this.cropState.folderType = savedCrop.folderType;
              }
              if (savedCrop.filename) {
                filename = savedCrop.filename;
                // Update widget value to match saved filename
                this.imageWidget.value = filename;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }

        const img = new Image();
        img.onload = () => {
          this.imageElement = img;
          this.imageLoaded = true;
          this.cropState.imageWidth = img.width;
          this.cropState.imageHeight = img.height;

          // Update folder type if explicitly provided (from library selection)
          if (explicitFolderType) {
            this.cropState.folderType = explicitFolderType;
          }

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

          // Clear the ignoreSavedFolderType flag after loading completes
          this.ignoreSavedFolderType = false;

          app.graph.setDirtyCanvas(true, true);
        };
        img.onerror = () => {
          console.error("Failed to load image:", filename);
          this.ignoreSavedFolderType = false; // Clear flag even on error
        };

        // Parse subfolder from filename (e.g., "pasted/image.png" -> subfolder="pasted", filename="image.png")
        let subfolder = "";
        let baseFilename = filename;

        const separatorIndex = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
        if (separatorIndex !== -1) {
          subfolder = filename.substring(0, separatorIndex);
          baseFilename = filename.substring(separatorIndex + 1);
        }

        // Use folder type from state (default to "input" if not set)
        const folderType = this.cropState.folderType || "input";

        // Construct URL - only include subfolder parameter if subfolder is not empty
        let url = `/view?filename=${encodeURIComponent(baseFilename)}&type=${folderType}`;
        if (subfolder) {
          url += `&subfolder=${encodeURIComponent(subfolder)}`;
        }

        img.src = url;
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
        folderType: this.cropState.folderType || "input",
        // Save full filename for proper restoration on page refresh
        filename: this.imageWidget.value,
      });

      if (this.cropDataWidget) {
        this.cropDataWidget.value = cropData;
      }
    };
  },
});
