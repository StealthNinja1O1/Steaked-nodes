import { app } from "../../scripts/app.js";

const HANDLE_SIZE = 10;
const MIN_BOX_SIZE = 20;
const BOX_COLORS = {
  1: "#FF0000", // Red
  2: "#00FF00", // Green
  3: "#0000FF", // Blue
  4: "#FFFF00", // Yellow
};

app.registerExtension({
  name: "Steaked.RegionalPrompts",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    const supportedNodes = [
      "RegionalPromptsLatent",
      "RegionalPromptsAttention",
      "RegionalPromptsLatentImg2Img",
      "RegionalPromptsAttentionImg2Img",
      "RegionalPromptsLatentImageInput",
      "RegionalPromptsAttentionImageInput",
    ];

    if (!supportedNodes.includes(nodeData.name)) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

      this.serialize_widgets = true;
      this.isImg2Img = nodeData.name.includes("Img2Img");
      this.isImageInput = nodeData.name.includes("ImageInput");

      // State initialization
      this.boxState = {
        boxes: [],
        selectedBoxId: null,
        isDragging: false,
        isResizing: false,
        dragHandle: null,
        dragStartX: 0,
        dragStartY: 0,
        initialBox: null,
        canvasWidth: 1024,
        canvasHeight: 1024,
        backgroundImage: null,
      };

      // Setup box_data widget
      let boxDataWidget = this.widgets.find((w) => w.name === "box_data");
      if (!boxDataWidget) {
        boxDataWidget = this.addWidget("text", "box_data", "", (v) => {}, { serialize: true });
      }
      boxDataWidget.computeSize = () => [0, -4];

      // Initialize from saved value
      if (boxDataWidget.value) {
        try {
          this.boxState.boxes = JSON.parse(boxDataWidget.value);
        } catch (e) {
          console.error("Invalid box data", e);
        }
      }

      this.boxDataWidget = boxDataWidget;
      this.propWidgets = {};

      const addPropWidget = (name, type, defaultVal, callback, options = {}) => {
        const w = this.addWidget(
          type,
          name,
          defaultVal,
          (v) => {
            if (this.boxState.selectedBoxId) {
              const box = this.boxState.boxes.find((b) => b.id === this.boxState.selectedBoxId);
              if (box) {
                callback(box, v);
                this.saveBoxData();
              }
            }
          },
          options
        );
        this.propWidgets[name] = w;
        return w;
      };

      // Property Widgets for Selected Box
      addPropWidget("Weight", "number", 1.0, (box, v) => (box.weight = v), { min: 0, max: 2, step: 0.1, precision: 2 });
      addPropWidget("Start Step", "number", 0.0, (box, v) => (box.start = v), {
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      });
      addPropWidget("End Step", "number", 1.0, (box, v) => (box.end = v), { min: 0, max: 1, step: 0.01, precision: 2 });
      addPropWidget("Unlock Shape", "toggle", false, (box, v) => {
        box.locked = !v;
        this.setDirtyCanvas(true, true);
      });

      // Buttons
      this.addWidget("button", "Add Box (+)", null, () => {
        this.addBox();
      });

      this.addWidget("button", "Remove Box (-)", null, () => {
        this.removeSelectedBox();
      });

      // Canvas Placeholder Widget
      const canvasPlaceholder = this.addWidget("text", "canvas_placeholder", "", () => {}, { serialize: false });
      canvasPlaceholder.type = "canvas_placeholder";
      canvasPlaceholder.draw = function () {};
      canvasPlaceholder.computeSize = (width) => {
        if (this.boxState && this.boxState.canvasHeight && this.boxState.canvasWidth) {
          const aspect = this.boxState.canvasHeight / this.boxState.canvasWidth;
          const calculatedHeight = width * aspect;
          // Clamp max height to prevent canvas from scaling outside node
          const maxHeight = 600;
          return [width, Math.min(calculatedHeight, maxHeight)];
        }
        return [width, 300];
      };

      this.canvasPlaceholder = canvasPlaceholder;

      // Update property widgets when selection changes
      this.updatePropertyWidgets = () => {
        const id = this.boxState.selectedBoxId;
        if (id) {
          const box = this.boxState.boxes.find((b) => b.id === id);
          if (box) {
            this.propWidgets["Weight"].value = box.weight !== undefined ? box.weight : 1.0;
            this.propWidgets["Start Step"].value = box.start !== undefined ? box.start : 0.0;
            this.propWidgets["End Step"].value = box.end !== undefined ? box.end : 1.0;
            this.propWidgets["Unlock Shape"].value = box.locked !== undefined ? !box.locked : false;
          }
        }
      };

      // For img2img nodes, setup image loading
      if (this.isImg2Img) {
        const imageWidget = this.widgets.find((w) => w.name === "image");
        if (imageWidget) {
          // Hook into image widget's callback to load the image
          const originalCallback = imageWidget.callback;
          imageWidget.callback = (v) => {
            if (originalCallback) originalCallback(v);
            this.loadBackgroundImage(v, "input");
          };

          // Load initial image if set
          if (imageWidget.value) {
            this.loadBackgroundImage(imageWidget.value, "input");
          }
        }
      }

      this.setSize([400, 600]);
      return r;
    };

    // Handle execution output for image-input nodes (load cached preview like ColorBlender)
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function(message) {
      if (onExecuted) onExecuted.apply(this, arguments);
      if (this.isImageInput && message && message.cached_image && message.cached_image.length > 0) {
        this.loadBackgroundImage(message.cached_image[0], "temp");
        const cachedWidget = this.widgets?.find(w => w.name === "cached_image_path");
        if (cachedWidget) cachedWidget.value = message.cached_image[0];
      }
    };

    nodeType.prototype.onConfigure = function (o) {
      if (this.widgets) {
        const boxDataWidget = this.widgets.find((w) => w.name === "box_data");
        if (boxDataWidget && boxDataWidget.value) {
          try {
            this.boxState.boxes = JSON.parse(boxDataWidget.value);
            
            // Ensure backwards compatibility - generate corners if missing
            this.boxState.boxes.forEach(box => {
              if (!box.corners || box.corners.length !== 4) {
                const x = box.x || 0;
                const y = box.y || 0;
                const w = box.w || 100;
                const h = box.h || 100;
                box.corners = [
                  [x, y],           // TL
                  [x + w, y],       // TR
                  [x + w, y + h],   // BR
                  [x, y + h]        // BL
                ];
              }
              if (box.locked === undefined) {
                box.locked = true;
              }
            });
            
            this.setDirtyCanvas(true, true);
          } catch (e) {
            console.error("RegionalPrompts: Failed to restore boxes", e);
          }
        }

        // For image-input nodes, restore the cached background preview
        if (this.isImageInput) {
          const cachedWidget = this.widgets.find(w => w.name === "cached_image_path");
          if (cachedWidget && cachedWidget.value) {
            this.loadBackgroundImage(cachedWidget.value, "temp");
          }
        }
      }
    };

    nodeType.prototype.loadBackgroundImage = function(imageName, type = "input") {
      if (!imageName) return;

      const img = new Image();
      
      // Parse subfolder from filename (e.g. "pasted/image.png" -> subfolder="pasted")
      let subfolder = "";
      let baseFilename = imageName;
      if (type === "input") {
        const sep = Math.max(imageName.lastIndexOf('/'), imageName.lastIndexOf('\\'));
        if (sep !== -1) {
          subfolder = imageName.substring(0, sep);
          baseFilename = imageName.substring(sep + 1);
        }
      }

      img.src = `/view?filename=${encodeURIComponent(baseFilename)}&type=${type}&subfolder=${encodeURIComponent(subfolder)}`;

      img.onload = () => {
        const newW = img.width;
        const newH = img.height;
        const oldW = this.boxState.canvasWidth;
        const oldH = this.boxState.canvasHeight;

        // Rescale boxes if image resolution changed and we already have boxes
        if (oldW && oldH && (oldW !== newW || oldH !== newH) && this.boxState.boxes.length > 0) {
          const scaleX = newW / oldW;
          const scaleY = newH / oldH;
          this.boxState.boxes.forEach(box => {
            // Rescale corners
            box.corners = box.corners.map(([cx, cy]) => [
              Math.max(0, Math.min(cx * scaleX, newW)),
              Math.max(0, Math.min(cy * scaleY, newH)),
            ]);
            // Update bounding box fields from rescaled corners
            const xs = box.corners.map(c => c[0]);
            const ys = box.corners.map(c => c[1]);
            box.x = Math.min(...xs);
            box.y = Math.min(...ys);
            box.w = Math.max(...xs) - box.x;
            box.h = Math.max(...ys) - box.y;
          });
          this.saveBoxData();
        }

        this.boxState.backgroundImage = img;
        this.boxState.canvasWidth = newW;
        this.boxState.canvasHeight = newH;
        // Auto-resize node to fit the new canvas aspect ratio
        this._autoResizeForCanvas();
        this.setDirtyCanvas(true, true);
      };

      img.onerror = () => {
        console.error("Failed to load background image:", imageName);
      };
    };

    // Auto-resize the node height to fit the canvas at current width
    nodeType.prototype._autoResizeForCanvas = function() {
      const margin = 10;
      const nodeWidth = this.size[0];
      const availableWidth = nodeWidth - margin * 2;
      const { w: imgW, h: imgH } = this.getCanvasDimensions();
      const aspect = imgH / imgW;
      const canvasH = Math.min(availableWidth * aspect, 600);

      // Sum up widget heights to find where the canvas starts
      let widgetsH = LiteGraph.NODE_TITLE_HEIGHT;
      if (this.widgets) {
        for (const w of this.widgets) {
          if (w.name === "canvas_placeholder") break;
          const ws = w.computeSize ? w.computeSize(nodeWidth) : [nodeWidth, LiteGraph.NODE_WIDGET_HEIGHT];
          widgetsH += (ws[1] > 0 ? ws[1] : 0) + 4;
        }
      }
      const neededHeight = widgetsH + canvasH + margin * 2;
      if (this.size[1] < neededHeight) {
        this.size[1] = neededHeight;
      }
    };

    // Helper to get dimensions from inputs (for non-img2img nodes)
    nodeType.prototype.getCanvasDimensions = function () {
      if (this.isImg2Img || this.isImageInput) {
        return { w: this.boxState.canvasWidth || 1024, h: this.boxState.canvasHeight || 1024 };
      }

      let w = 1024, h = 1024;
      const wWidget = this.widgets.find((w) => w.name === "width");
      const hWidget = this.widgets.find((w) => w.name === "height");
      if (wWidget) w = wWidget.value;
      if (hWidget) h = hWidget.value;
      return { w, h };
    };

    nodeType.prototype.addBox = function () {
      const { w, h } = this.getCanvasDimensions();
      const currentCount = this.boxState.boxes.length;
      if (currentCount >= 4) return;

      const usedIds = new Set(this.boxState.boxes.map((b) => b.id));
      let newId = 1;
      while (usedIds.has(newId)) newId++;

      const offset = (newId - 1) * 50;
      const boxSize = Math.min(w, h) / 4;

      this.boxState.boxes.push({
        id: newId,
        x: offset,
        y: offset,
        w: boxSize,
        h: boxSize,
        weight: 1.0,
        start: 0.0,
        end: 1.0,
        locked: true,
        corners: [
          [offset, offset],                   // TL
          [offset + boxSize, offset],         // TR
          [offset + boxSize, offset + boxSize], // BR
          [offset, offset + boxSize]          // BL
        ]
      });
      this.boxState.selectedBoxId = newId;
      if (this.updatePropertyWidgets) this.updatePropertyWidgets();
      this.saveBoxData();
      this.setDirtyCanvas(true, true);
    };

    nodeType.prototype.removeSelectedBox = function () {
      if (this.boxState.boxes.length === 0) return;

      const maxId = Math.max(...this.boxState.boxes.map((b) => b.id));
      this.boxState.boxes = this.boxState.boxes.filter((b) => b.id !== maxId);

      if (this.boxState.selectedBoxId === maxId) {
        this.boxState.selectedBoxId = null;
      }

      if (this.boxState.selectedBoxId && this.updatePropertyWidgets) {
        this.updatePropertyWidgets();
      }

      this.saveBoxData();
      this.setDirtyCanvas(true, true);
    };

    nodeType.prototype.saveBoxData = function () {
      if (this.boxDataWidget) {
        this.boxDataWidget.value = JSON.stringify(this.boxState.boxes);
      }
    };

    const originalOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (originalOnDrawForeground) originalOnDrawForeground.apply(this, arguments);

      if (!this.canvasPlaceholder || this.canvasPlaceholder.last_y === undefined) {
        return;
      }

      const margin = 10;
      const startY = this.canvasPlaceholder.last_y;

      let displayHeight = 300;
      if (this.canvasPlaceholder.last_h) {
        displayHeight = this.canvasPlaceholder.last_h;
      } else if (this.boxState.canvasHeight) {
        const imgAspect = this.boxState.canvasHeight / this.boxState.canvasWidth;
        displayHeight = (this.size[0] - margin * 2) * imgAspect;
      }

      const availableWidth = this.size[0] - margin * 2;
      let displayWidth = availableWidth;

      const startX = margin + (availableWidth - displayWidth) / 2;

      const { w: imgW, h: imgH } = this.getCanvasDimensions();
      this.boxState.canvasWidth = imgW;
      this.boxState.canvasHeight = imgH;

      // Auto-grow node if canvas would overflow the bottom
      const bottomEdge = startY + displayHeight + margin;
      if (bottomEdge > this.size[1]) {
        this.size[1] = bottomEdge;
      }

      this.displayBounds = {
        startX,
        startY,
        displayWidth,
        displayHeight,
        scaleX: displayWidth / imgW,
        scaleY: displayHeight / imgH,
      };

      ctx.save();

      // Draw background image (for img2img) or dark canvas (for txt2img)
      if (this.boxState.backgroundImage) {
        ctx.drawImage(this.boxState.backgroundImage, startX, startY, displayWidth, displayHeight);
      } else {
        ctx.fillStyle = "#333";
        ctx.fillRect(startX, startY, displayWidth, displayHeight);
        ctx.strokeStyle = "#666";
        ctx.strokeRect(startX, startY, displayWidth, displayHeight);
      }

      // Draw Grid
      ctx.strokeStyle = "rgba(100, 100, 100, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();

      const gridSize = 128;
      const gridSpacingX = gridSize * this.displayBounds.scaleX;
      const gridSpacingY = gridSize * this.displayBounds.scaleY;

      for (let x = gridSpacingX; x < displayWidth; x += gridSpacingX) {
        ctx.moveTo(startX + x, startY);
        ctx.lineTo(startX + x, startY + displayHeight);
      }

      for (let y = gridSpacingY; y < displayHeight; y += gridSpacingY) {
        ctx.moveTo(startX, startY + y);
        ctx.lineTo(startX + displayWidth, startY + y);
      }
      ctx.stroke();

      // Draw Boxes
      const boxes = this.boxState.boxes;

      const drawBox = (box, isSelected) => {
        const color = BOX_COLORS[box.id] || "#FFFFFF";
        
        // Get display corners
        const getDisplayCorners = (box) => {
          if (!box.corners || box.corners.length !== 4) {
            // Fallback to rectangle
            const bx = startX + box.x * this.displayBounds.scaleX;
            const by = startY + box.y * this.displayBounds.scaleY;
            const bw = box.w * this.displayBounds.scaleX;
            const bh = box.h * this.displayBounds.scaleY;
            return [
              [bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]
            ];
          }
          return box.corners.map(c => [
            startX + c[0] * this.displayBounds.scaleX,
            startY + c[1] * this.displayBounds.scaleY
          ]);
        };
        
        const displayCorners = getDisplayCorners(box);
        
        // Draw filled polygon
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(displayCorners[0][0], displayCorners[0][1]);
        for (let i = 1; i < displayCorners.length; i++) {
          ctx.lineTo(displayCorners[i][0], displayCorners[i][1]);
        }
        ctx.closePath();
        ctx.fill();

        // Draw outline
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = isSelected ? "#FFFFFF" : color;
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(displayCorners[0][0], displayCorners[0][1]);
        for (let i = 1; i < displayCorners.length; i++) {
          ctx.lineTo(displayCorners[i][0], displayCorners[i][1]);
        }
        ctx.closePath();
        ctx.stroke();

        // Draw box ID label at center
        const centerX = displayCorners.reduce((sum, c) => sum + c[0], 0) / displayCorners.length;
        const centerY = displayCorners.reduce((sum, c) => sum + c[1], 0) / displayCorners.length;
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "bold 16px Arial";
        ctx.fillText(box.id, centerX - 5, centerY + 5);

        if (isSelected) {
          ctx.fillStyle = "#FFFFFF";
          const handles = this.getHandles(box, displayCorners);
          for (let h of handles) {
            ctx.fillRect(h.x, h.y, HANDLE_SIZE, HANDLE_SIZE);
          }
        }
      };

      boxes.forEach((b) => {
        if (b.id !== this.boxState.selectedBoxId) drawBox(b, false);
      });

      const selectedBox = boxes.find((b) => b.id === this.boxState.selectedBoxId);
      if (selectedBox) drawBox(selectedBox, true);

      ctx.restore();
    };

    nodeType.prototype.getHandles = function (box, displayCorners) {
      if (!box.locked) {
        // Unlocked: 4 independent corner handles
        return [
          { name: "c0", x: displayCorners[0][0] - HANDLE_SIZE / 2, y: displayCorners[0][1] - HANDLE_SIZE / 2, cornerIndex: 0 },
          { name: "c1", x: displayCorners[1][0] - HANDLE_SIZE / 2, y: displayCorners[1][1] - HANDLE_SIZE / 2, cornerIndex: 1 },
          { name: "c2", x: displayCorners[2][0] - HANDLE_SIZE / 2, y: displayCorners[2][1] - HANDLE_SIZE / 2, cornerIndex: 2 },
          { name: "c3", x: displayCorners[3][0] - HANDLE_SIZE / 2, y: displayCorners[3][1] - HANDLE_SIZE / 2, cornerIndex: 3 },
        ];
      } else {
        // Locked: 8 rectangle handles
        const bx = displayCorners[0][0];
        const by = displayCorners[0][1];
        const bw = displayCorners[1][0] - displayCorners[0][0];
        const bh = displayCorners[3][1] - displayCorners[0][1];
        
        return [
          { name: "tl", x: bx - HANDLE_SIZE / 2, y: by - HANDLE_SIZE / 2 },
          { name: "tr", x: bx + bw - HANDLE_SIZE / 2, y: by - HANDLE_SIZE / 2 },
          { name: "bl", x: bx - HANDLE_SIZE / 2, y: by + bh - HANDLE_SIZE / 2 },
          { name: "br", x: bx + bw - HANDLE_SIZE / 2, y: by + bh - HANDLE_SIZE / 2 },
          { name: "tm", x: bx + bw / 2 - HANDLE_SIZE / 2, y: by - HANDLE_SIZE / 2 },
          { name: "bm", x: bx + bw / 2 - HANDLE_SIZE / 2, y: by + bh - HANDLE_SIZE / 2 },
          { name: "lm", x: bx - HANDLE_SIZE / 2, y: by + bh / 2 - HANDLE_SIZE / 2 },
          { name: "rm", x: bx + bw - HANDLE_SIZE / 2, y: by + bh / 2 - HANDLE_SIZE / 2 },
        ];
      }
    };

    // Point in polygon detection using ray casting
    nodeType.prototype.isPointInPolygon = function (x, y, corners) {
      let inside = false;
      for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
        const xi = corners[i][0], yi = corners[i][1];
        const xj = corners[j][0], yj = corners[j][1];
        
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    // Update bounding box from corners
    nodeType.prototype.updateBoxBounds = function (box) {
      const xs = box.corners.map(c => c[0]);
      const ys = box.corners.map(c => c[1]);
      box.x = Math.min(...xs);
      box.y = Math.min(...ys);
      box.w = Math.max(...xs) - box.x;
      box.h = Math.max(...ys) - box.y;
    };

    nodeType.prototype.onMouseDown = function (e, localPos, canvas) {
      if (!this.displayBounds) return false;

      const [mouseX, mouseY] = localPos;

      if (this.boxState.selectedBoxId) {
        const box = this.boxState.boxes.find((b) => b.id === this.boxState.selectedBoxId);
        if (box) {
          // Compute display corners for handle detection
          const displayCorners = box.corners.map(([cx, cy]) => [
            this.displayBounds.startX + cx * this.displayBounds.scaleX,
            this.displayBounds.startY + cy * this.displayBounds.scaleY,
          ]);

          const handles = this.getHandles(box, displayCorners);
          for (let h of handles) {
            if (mouseX >= h.x && mouseX <= h.x + HANDLE_SIZE && mouseY >= h.y && mouseY <= h.y + HANDLE_SIZE) {
              this.boxState.isResizing = true;
              this.boxState.dragHandle = h.name;
              this.boxState.dragHandleCornerIndex = h.cornerIndex; // For unlocked shapes
              this.boxState.dragStartX = mouseX;
              this.boxState.dragStartY = mouseY;
              this.boxState.initialBox = { ...box, corners: box.corners.map(c => [...c]) };
              return true;
            }
          }
        }
      }

      for (let i = this.boxState.boxes.length - 1; i >= 0; i--) {
        const box = this.boxState.boxes[i];
        
        // Compute display corners
        const displayCorners = box.corners.map(([cx, cy]) => [
          this.displayBounds.startX + cx * this.displayBounds.scaleX,
          this.displayBounds.startY + cy * this.displayBounds.scaleY,
        ]);

        // Check if mouse is inside the polygon
        if (this.isPointInPolygon(mouseX, mouseY, displayCorners)) {
          this.boxState.selectedBoxId = box.id;
          this.boxState.isDragging = true;
          this.boxState.dragStartX = mouseX;
          this.boxState.dragStartY = mouseY;
          this.boxState.initialBox = { ...box, corners: box.corners.map(c => [...c]) };

          if (this.updatePropertyWidgets) this.updatePropertyWidgets();
          this.setDirtyCanvas(true, true);
          return true;
        }
      }

      if (this.boxState.selectedBoxId) {
        this.boxState.selectedBoxId = null;
        this.setDirtyCanvas(true, true);
      }

      return false;
    };

    nodeType.prototype.onMouseMove = function (e, localPos, canvas) {
      if (!this.boxState.isDragging && !this.boxState.isResizing) return;

      if (e.buttons !== undefined && (e.buttons & 1) === 0) {
        this.boxState.isDragging = false;
        this.boxState.isResizing = false;
        this.boxState.dragHandle = null;
        this.saveBoxData();
        this.setDirtyCanvas(true, true);
        return;
      }

      if (!this.displayBounds) return;

      const [mouseX, mouseY] = localPos;
      const { scaleX, scaleY } = this.displayBounds;

      if (this.boxState.isDragging) {
        const box = this.boxState.boxes.find((b) => b.id === this.boxState.selectedBoxId);
        if (!box) return;

        const dx = (mouseX - this.boxState.dragStartX) / scaleX;
        const dy = (mouseY - this.boxState.dragStartY) / scaleY;

        // Move all corners by the same offset
        box.corners = this.boxState.initialBox.corners.map(([cx, cy]) => [
          Math.max(0, Math.min(cx + dx, this.boxState.canvasWidth)),
          Math.max(0, Math.min(cy + dy, this.boxState.canvasHeight)),
        ]);
        
        // Update bounding box
        this.updateBoxBounds(box);

        this.saveBoxData();
        this.setDirtyCanvas(true, true);
      }

      if (this.boxState.isResizing) {
        const box = this.boxState.boxes.find((b) => b.id === this.boxState.selectedBoxId);
        if (!box) return;

        const dx = (mouseX - this.boxState.dragStartX) / scaleX;
        const dy = (mouseY - this.boxState.dragStartY) / scaleY;

        if (!box.locked) {
          // Unlocked: Move individual corner
          const cornerIndex = this.boxState.dragHandleCornerIndex;
          if (cornerIndex !== undefined) {
            const initial = this.boxState.initialBox.corners[cornerIndex];
            box.corners[cornerIndex] = [
              Math.max(0, Math.min(initial[0] + dx, this.boxState.canvasWidth)),
              Math.max(0, Math.min(initial[1] + dy, this.boxState.canvasHeight)),
            ];
            
            // Update bounding box
            this.updateBoxBounds(box);
          }
        } else {
          // Locked: Rectangle resize
          const initial = this.boxState.initialBox;
          const handle = this.boxState.dragHandle;

          let newX = initial.x;
          let newY = initial.y;
          let newW = initial.w;
          let newH = initial.h;

          if (handle.includes("l")) {
            newX = Math.min(initial.x + initial.w - MIN_BOX_SIZE, initial.x + dx);
            newW = initial.w + (initial.x - newX);
          }
          if (handle.includes("r")) {
            newW = Math.max(MIN_BOX_SIZE, initial.w + dx);
          }
          if (handle.includes("t")) {
            newY = Math.min(initial.y + initial.h - MIN_BOX_SIZE, initial.y + dy);
            newH = initial.h + (initial.y - newY);
          }
          if (handle.includes("b")) {
            newH = Math.max(MIN_BOX_SIZE, initial.h + dy);
          }

          if (newX < 0) {
            newW += newX;
            newX = 0;
          }
          if (newY < 0) {
            newH += newY;
            newY = 0;
          }
          if (newX + newW > this.boxState.canvasWidth) newW = this.boxState.canvasWidth - newX;
          if (newY + newH > this.boxState.canvasHeight) newH = this.boxState.canvasHeight - newY;

          box.x = Math.max(0, newX);
          box.y = Math.max(0, newY);
          box.w = Math.max(MIN_BOX_SIZE, newW);
          box.h = Math.max(MIN_BOX_SIZE, newH);
          
          // Update corners to match the rectangle
          box.corners = [
            [box.x, box.y],           // TL
            [box.x + box.w, box.y],   // TR
            [box.x + box.w, box.y + box.h], // BR
            [box.x, box.y + box.h],   // BL
          ];
        }

        this.saveBoxData();
        this.setDirtyCanvas(true, true);
      }
    };

    nodeType.prototype.onMouseUp = function (e, localPos, canvas) {
      if (this.boxState.isDragging || this.boxState.isResizing) {
        this.boxState.isDragging = false;
        this.boxState.isResizing = false;
        this.boxState.dragHandle = null;
        this.saveBoxData();
        return true;
      }
      return false;
    };
  },
});
