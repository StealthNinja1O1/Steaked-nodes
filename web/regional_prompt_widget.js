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

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "RegionalPromptsLatent" && nodeData.name !== "RegionalPromptsAttention") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

      this.serialize_widgets = true;

      // State initialization
      this.boxState = {
        boxes: [], // Array of {id, x, y, w, h}
        selectedBoxId: null,
        isDragging: false,
        isResizing: false,
        dragHandle: null,
        dragStartX: 0,
        dragStartY: 0,
        initialBox: null,
        canvasWidth: 1024,
        canvasHeight: 1024,
      };

      // Setup box_data widget (hidden but serialized)
      // Check if it exists from Python def (it might be in widgets list if extended properly, but safer to add/find)
      let boxDataWidget = this.widgets.find((w) => w.name === "box_data");

      if (!boxDataWidget) {
        // Create if not found (standard pattern for passing data to hidden inputs)
        boxDataWidget = this.addWidget("text", "box_data", "", (v) => {}, { serialize: true });
      }

      // Ensure hidden properties
      boxDataWidget.computeSize = () => [0, -4];

      // Initialize from saved value if exists
      if (boxDataWidget.value) {
        try {
          this.boxState.boxes = JSON.parse(boxDataWidget.value);
        } catch (e) {
          console.error("Invalid box data", e);
        }
      }

      this.boxDataWidget = boxDataWidget;

      // Variables to track property widgets
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
      addPropWidget("Feather", "number", 0, (box, v) => (box.feather = v), { min: 0, max: 100, step: 1, precision: 0 });
      addPropWidget("Start Step", "number", 0.0, (box, v) => (box.start = v), {
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
      });
      addPropWidget("End Step", "number", 1.0, (box, v) => (box.end = v), { min: 0, max: 1, step: 0.01, precision: 2 });

      // Buttons
      this.addWidget("button", "Add Box (+)", null, () => {
        this.addBox();
      });

      this.addWidget("button", "Remove Box (-)", null, () => {
        this.removeSelectedBox();
      });

      // Add Canvas Placeholder Widget
      // This widget reserves space in the layout for our custom drawing
      const canvasPlaceholder = this.addWidget("text", "canvas_placeholder", "", () => {}, { serialize: false });
      canvasPlaceholder.type = "canvas_placeholder"; // Custom type to avoid default drawing

      canvasPlaceholder.draw = function () {};

      canvasPlaceholder.computeSize = (width) => {
        if (this.boxState && this.boxState.canvasHeight && this.boxState.canvasWidth) {
          const aspect = this.boxState.canvasHeight / this.boxState.canvasWidth;
          // Reserve height based on aspect ratio
          return [width, width * aspect];
        }
        return [width, 300]; // Default fallback
      };

      this.canvasPlaceholder = canvasPlaceholder;

      // Update property widgets when selection changes
      this.updatePropertyWidgets = () => {
        const id = this.boxState.selectedBoxId;
        if (id) {
          const box = this.boxState.boxes.find((b) => b.id === id);
          if (box) {
            this.propWidgets["Weight"].value = box.weight !== undefined ? box.weight : 1.0;
            this.propWidgets["Feather"].value = box.feather !== undefined ? box.feather : 0;
            this.propWidgets["Start Step"].value = box.start !== undefined ? box.start : 0.0;
            this.propWidgets["End Step"].value = box.end !== undefined ? box.end : 1.0;
          }
        }
      };

      // Size estimation
      this.setSize([400, 600]);

      return r;
    };

    nodeType.prototype.onConfigure = function (o) {
      // Restore box state from widget value
      if (this.widgets) {
        const boxDataWidget = this.widgets.find((w) => w.name === "box_data");
        if (boxDataWidget && boxDataWidget.value) {
          try {
            this.boxState.boxes = JSON.parse(boxDataWidget.value);
            this.setDirtyCanvas(true, true);
          } catch (e) {
            console.error("RegionalPrompts: Failed to restore boxes", e);
          }
        }
      }
    };

    // Helper to get dimensions from inputs
    nodeType.prototype.getCanvasDimensions = function () {
      let w = 1024,
        h = 1024;
      const wWidget = this.widgets.find((w) => w.name === "width");
      const hWidget = this.widgets.find((w) => w.name === "height");
      if (wWidget) w = wWidget.value;
      if (hWidget) h = hWidget.value;
      return { w, h };
    };

    nodeType.prototype.addBox = function () {
      const { w, h } = this.getCanvasDimensions();
      const currentCount = this.boxState.boxes.length;
      if (currentCount >= 4) return; // Max 4 boxes

      // Find first available ID
      const usedIds = new Set(this.boxState.boxes.map((b) => b.id));
      let newId = 1;
      while (usedIds.has(newId)) newId++;

      // Smart placement? Center or cascade.
      // Let's just place it at (newId-1)*50, (newId-1)*50
      const offset = (newId - 1) * 50;
      const boxSize = Math.min(w, h) / 4;

      this.boxState.boxes.push({
        id: newId,
        x: offset,
        y: offset,
        w: boxSize,
        h: boxSize,
        weight: 1.0,
        feather: 0,
        start: 0.0,
        end: 1.0,
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

      if (!this.canvasPlaceholder) {
        console.log("Steaked.RegionalPrompts: No placeholder found");
        return;
      }

      // Wait for layout to happen (last_y populated)
      if (this.canvasPlaceholder.last_y === undefined) {
        // console.log("Steaked.RegionalPrompts: Waiting for layout...");
        return;
      }

      const margin = 10;

      // Use the placeholder's position
      // The placeholder starts after previous widgets.
      const startY = this.canvasPlaceholder.last_y;

      // Use the placeholder's height (computed by LiteGraph layout) if available, or calc
      let displayHeight = 300;
      if (this.canvasPlaceholder.last_h) {
        displayHeight = this.canvasPlaceholder.last_h;
      } else if (this.boxState.canvasHeight) {
        const imgAspect = this.boxState.canvasHeight / this.boxState.canvasWidth; // Corrected aspect ratio calc (H/W)
        displayHeight = (this.size[0] - margin * 2) * imgAspect;
      }

      const availableWidth = this.size[0] - margin * 2;
      let displayWidth = availableWidth;

      // Center horizontally
      const startX = margin + (availableWidth - displayWidth) / 2;

      // Save bounds for interaction
      const { w: imgW, h: imgH } = this.getCanvasDimensions();
      this.boxState.canvasWidth = imgW;
      this.boxState.canvasHeight = imgH;

      // Recalculate scale based on actual drawn area
      this.displayBounds = {
        startX,
        startY,
        displayWidth,
        displayHeight,
        scaleX: displayWidth / imgW,
        scaleY: displayHeight / imgH,
      };

      console.log("Steaked.RegionalPrompts: Drawing at", startX, startY, displayWidth, displayHeight);

      // Draw Canvas Background
      ctx.save();
      ctx.fillStyle = "#333";
      ctx.fillRect(startX, startY, displayWidth, displayHeight);
      ctx.strokeStyle = "#666";
      ctx.strokeRect(startX, startY, displayWidth, displayHeight);

      // Draw Grid
      ctx.strokeStyle = "rgba(100, 100, 100, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();

      const gridSize = 128; // Grid cell size in image pixels
      const gridSpacingX = gridSize * this.displayBounds.scaleX;
      const gridSpacingY = gridSize * this.displayBounds.scaleY;

      // Vertical lines
      for (let x = gridSpacingX; x < displayWidth; x += gridSpacingX) {
        ctx.moveTo(startX + x, startY);
        ctx.lineTo(startX + x, startY + displayHeight);
      }

      // Horizontal lines
      for (let y = gridSpacingY; y < displayHeight; y += gridSpacingY) {
        ctx.moveTo(startX, startY + y);
        ctx.lineTo(startX + displayWidth, startY + y);
      }
      ctx.stroke();

      // Draw Boxes
      // Draw unselected boxes first
      const boxes = this.boxState.boxes;

      const drawBox = (box, isSelected) => {
        const bx = startX + box.x * this.displayBounds.scaleX;
        const by = startY + box.y * this.displayBounds.scaleY;
        const bw = box.w * this.displayBounds.scaleX;
        const bh = box.h * this.displayBounds.scaleY;

        const color = BOX_COLORS[box.id] || "#FFFFFF";

        ctx.globalAlpha = 0.3;
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, bw, bh);

        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = isSelected ? "#FFFFFF" : color;
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(bx, by, bw, bh);

        // Draw ID
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "bold 16px Arial";
        ctx.fillText(box.id, bx + 5, by + 20);

        if (isSelected) {
          // Draw Handles
          ctx.fillStyle = "#FFFFFF";
          const handles = this.getHandles(bx, by, bw, bh);
          for (let h of handles) {
            ctx.fillRect(h.x, h.y, HANDLE_SIZE, HANDLE_SIZE);
          }
        }
      };

      // Draw non-selected
      boxes.forEach((b) => {
        if (b.id !== this.boxState.selectedBoxId) drawBox(b, false);
      });
      // Draw selected
      const selectedBox = boxes.find((b) => b.id === this.boxState.selectedBoxId);
      if (selectedBox) drawBox(selectedBox, true);

      ctx.restore();
    };

    nodeType.prototype.getHandles = function (bx, by, bw, bh) {
      return [
        { name: "tl", x: bx - HANDLE_SIZE / 2, y: by - HANDLE_SIZE / 2 },
        { name: "tr", x: bx + bw - HANDLE_SIZE / 2, y: by - HANDLE_SIZE / 2 },
        { name: "bl", x: bx - HANDLE_SIZE / 2, y: by + bh - HANDLE_SIZE / 2 },
        { name: "br", x: bx + bw - HANDLE_SIZE / 2, y: by + bh - HANDLE_SIZE / 2 },
        // edge centers?
        { name: "tm", x: bx + bw / 2 - HANDLE_SIZE / 2, y: by - HANDLE_SIZE / 2 },
        { name: "bm", x: bx + bw / 2 - HANDLE_SIZE / 2, y: by + bh - HANDLE_SIZE / 2 },
        { name: "lm", x: bx - HANDLE_SIZE / 2, y: by + bh / 2 - HANDLE_SIZE / 2 },
        { name: "rm", x: bx + bw - HANDLE_SIZE / 2, y: by + bh / 2 - HANDLE_SIZE / 2 },
      ];
    };

    nodeType.prototype.onMouseDown = function (e, localPos, canvas) {
      if (!this.displayBounds) return false;

      const [mouseX, mouseY] = localPos;

      // Check handles of selected box first
      if (this.boxState.selectedBoxId) {
        const box = this.boxState.boxes.find((b) => b.id === this.boxState.selectedBoxId);
        if (box) {
          const bx = this.displayBounds.startX + box.x * this.displayBounds.scaleX;
          const by = this.displayBounds.startY + box.y * this.displayBounds.scaleY;
          const bw = box.w * this.displayBounds.scaleX;
          const bh = box.h * this.displayBounds.scaleY;

          const handles = this.getHandles(bx, by, bw, bh);
          for (let h of handles) {
            if (mouseX >= h.x && mouseX <= h.x + HANDLE_SIZE && mouseY >= h.y && mouseY <= h.y + HANDLE_SIZE) {
              this.boxState.isResizing = true;
              this.boxState.dragHandle = h.name;
              this.boxState.dragStartX = mouseX;
              this.boxState.dragStartY = mouseY;
              this.boxState.initialBox = { ...box };
              return true;
            }
          }
        }
      }

      // Check click on boxes (selection / drag)
      // Iterate reverse to select top-most
      for (let i = this.boxState.boxes.length - 1; i >= 0; i--) {
        const box = this.boxState.boxes[i];
        const bx = this.displayBounds.startX + box.x * this.displayBounds.scaleX;
        const by = this.displayBounds.startY + box.y * this.displayBounds.scaleY;
        const bw = box.w * this.displayBounds.scaleX;
        const bh = box.h * this.displayBounds.scaleY;

        if (mouseX >= bx && mouseX <= bx + bw && mouseY >= by && mouseY <= by + bh) {
          this.boxState.selectedBoxId = box.id;
          this.boxState.isDragging = true;
          this.boxState.dragStartX = mouseX;
          this.boxState.dragStartY = mouseY;
          this.boxState.initialBox = { ...box };

          if (this.updatePropertyWidgets) this.updatePropertyWidgets();

          this.setDirtyCanvas(true, true);
          return true; // Capture
        }
      }

      // Deselect if clicked outside
      if (this.boxState.selectedBoxId) {
        this.boxState.selectedBoxId = null;
        // Maybe clear widgets or disable them?
        // For now let's just leave last value or set defaults?
        // Setting to defaults might be less confusing than showing values of unselected box.
        // But we don't know what defaults to set.
        // Actually, let's just keep them as is (showing last selected) or we could block edits.
        // Ideally we gray them out.

        this.setDirtyCanvas(true, true);
      }

      return false;
    };

    nodeType.prototype.onMouseMove = function (e, localPos, canvas) {
      if (!this.boxState.isDragging && !this.boxState.isResizing) return;

      // Safety check: if no mouse buttons are pressed, stop dragging
      // (1 is left button)
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

        box.x = Math.max(0, Math.min(this.boxState.initialBox.x + dx, this.boxState.canvasWidth - box.w));
        box.y = Math.max(0, Math.min(this.boxState.initialBox.y + dy, this.boxState.canvasHeight - box.h));

        this.saveBoxData();
        this.setDirtyCanvas(true, true);
      }

      if (this.boxState.isResizing) {
        const box = this.boxState.boxes.find((b) => b.id === this.boxState.selectedBoxId);
        if (!box) return;

        const dx = (mouseX - this.boxState.dragStartX) / scaleX;
        const dy = (mouseY - this.boxState.dragStartY) / scaleY;
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

        // Constrain to canvas
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
