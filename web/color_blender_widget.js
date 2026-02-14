import { app } from "../../scripts/app.js";

app.registerExtension({
  name: "Steaked.ColorBlender",
  
  async nodeCreated(node) {
    // This is called after the graph is configured
    // We'll handle execution results in the node's callback
  },

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "ColorBlender") return;

    // Handle execution completion to load preview
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function(message) {
      if (onExecuted) {
        onExecuted.apply(this, arguments);
      }
      
      // Check if we received cached image data
      if (message && message.cached_image && message.cached_image.length > 0) {
        const filename = message.cached_image[0];
        this.loadPreviewImage(filename, "temp");
        
        // Update the hidden widget
        const cachedWidget = this.widgets?.find(w => w.name === "cached_image_path");
        if (cachedWidget) {
          cachedWidget.value = filename;
        }
      }
    };
    
    // Handle loading from saved workflows
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function(data) {
      if (onConfigure) {
        onConfigure.apply(this, arguments);
      }
      
      // Try to load cached image if available
      const cachedWidget = this.widgets?.find(w => w.name === "cached_image_path");
      if (cachedWidget && cachedWidget.value) {
        this.loadPreviewImage(cachedWidget.value, "temp");
      }
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
      
      // Initialize preview state
      this.previewImage = null;
      this.previewCanvas = null;    // offscreen canvas for processing
      this.processedCanvas = null;  // cached result after effects
      
      // Add preview canvas as a custom widget
      this.addPreviewWidget();
      
      // Find and enhance each widget
      for (let widget of this.widgets) {
        switch (widget.name) {
          case "hue":
            this.enhanceHueWidget(widget);
            break;
          case "saturation":
            this.enhanceSaturationWidget(widget);
            break;
          case "brightness":
            this.enhanceBrightnessWidget(widget);
            break;
          case "contrast":
            this.enhanceContrastWidget(widget);
            break;
          case "exposure":
            this.enhanceExposureWidget(widget);
            break;
          case "temperature":
            this.enhanceTemperatureWidget(widget);
            break;
          case "tint":
            this.enhanceTintWidget(widget);
            break;
          case "invert":
            this.enhanceInvertWidget(widget);
            break;
          case "cached_image_path":
            // Hidden widget - hide it completely
            widget.computeSize = () => [0, -4];
            widget.type = "converted-widget";
            break;
        }
        
        // Wire up widgets to trigger preview updates (except hidden ones)
        if (widget.name !== "cached_image_path") {
          widget.callback = ((originalCallback) => {
            return (value) => {
              if (originalCallback) originalCallback(value);
              this.processPreview();
            };
          })(widget.callback);
        }
      }
      
      // Try to load cached preview if available
      setTimeout(() => {
        const cachedWidget = this.widgets?.find(w => w.name === "cached_image_path");
        if (cachedWidget && cachedWidget.value) {
          this.loadPreviewImage(cachedWidget.value, "temp");
        }
      }, 100);

      return r;
    };

    // Add preview widget method
    nodeType.prototype.addPreviewWidget = function() {
      const widget = {
        name: "preview_canvas",
        type: "preview",
        value: null,
        draw: (ctx, node, width, y) => {
          const previewHeight = 200;
          const padding = 10;
          const previewWidth = width - padding * 2;
          const previewY = y;
          
          // Draw background
          ctx.fillStyle = "#1a1a1a";
          ctx.fillRect(padding, previewY, previewWidth, previewHeight);
          
          // Draw border
          ctx.strokeStyle = "#444";
          ctx.lineWidth = 1;
          ctx.strokeRect(padding, previewY, previewWidth, previewHeight);
          
          // Cheap value-change detection for sliders (which don't fire callback during drag)
          if (this.previewImage && this.previewImage.complete) {
            const key = this._getWidgetValueKey();
            if (key !== this._lastProcessedKey) {
              this._lastProcessedKey = key;
              clearTimeout(this._processTimer);
              this._processTimer = setTimeout(() => this.processPreview(), 16);
            }
          }
          
          if (this.processedCanvas) {
            // Just blit the pre-processed result (fast)
            const scale = Math.min(
              previewWidth / this.processedCanvas.width,
              previewHeight / this.processedCanvas.height
            );
            const scaledWidth = this.processedCanvas.width * scale;
            const scaledHeight = this.processedCanvas.height * scale;
            const offsetX = padding + (previewWidth - scaledWidth) / 2;
            const offsetY = previewY + (previewHeight - scaledHeight) / 2;
            
            ctx.drawImage(
              this.processedCanvas,
              offsetX, offsetY,
              scaledWidth, scaledHeight
            );
          } else {
            // Draw placeholder text
            ctx.fillStyle = "#666";
            ctx.font = "14px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
              this.previewImage ? "Processing..." : "Connect an image input to see preview",
              width / 2,
              previewY + previewHeight / 2
            );
          }
          
          return previewHeight;
        },
        computeSize: (width) => {
          return [width, 210]; // Height + padding
        }
      };
      
      this.addCustomWidget(widget);
    };
    
    // Apply color effects to canvas (client-side approximation)
    nodeType.prototype.applyColorEffects = function(ctx) {
      const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      const data = imageData.data;
      
      // Get widget values
      const getWidgetValue = (name, defaultValue) => {
        const widget = this.widgets.find(w => w.name === name);
        return widget ? widget.value : defaultValue;
      };
      
      const invert = getWidgetValue('invert', false);
      const exposure = getWidgetValue('exposure', 0.0);
      const temperature = getWidgetValue('temperature', 0.0);
      const tint = getWidgetValue('tint', 0.0);
      const highlights = getWidgetValue('highlights', 0.0);
      const shadows = getWidgetValue('shadows', 0.0);
      const blacks = getWidgetValue('blacks', 0.0);
      const whites = getWidgetValue('whites', 0.0);
      const contrast = getWidgetValue('contrast', 1.0);
      const brightness = getWidgetValue('brightness', 0.0);
      const hue = getWidgetValue('hue', 0.0);
      const saturation = getWidgetValue('saturation', 1.0);
      
      // Process each pixel
      for (let i = 0; i < data.length; i += 4) {
        let r = data[i] / 255;
        let g = data[i + 1] / 255;
        let b = data[i + 2] / 255;
        
        // 1. Invert (first)
        if (invert) {
          r = 1.0 - r;
          g = 1.0 - g;
          b = 1.0 - b;
        }
        
        // 2. Exposure
        if (exposure !== 0.0) {
          const multiplier = Math.pow(2.0, exposure);
          r *= multiplier;
          g *= multiplier;
          b *= multiplier;
        }
        
        // 3. Temperature
        if (temperature !== 0.0) {
          if (temperature > 0) {
            r = r * (1.0 + temperature * 0.5);
            b = b * (1.0 - temperature * 0.3);
          } else {
            r = r * (1.0 + temperature * 0.3);
            b = b * (1.0 - temperature * 0.5);
          }
        }
        
        // 4. Tint
        if (tint !== 0.0) {
          if (tint > 0) {
            g = g * (1.0 + tint * 0.5);
          } else {
            r = r * (1.0 - tint * 0.3);
            b = b * (1.0 - tint * 0.3);
          }
        }
        
        // 5. Highlights and Shadows
        if (highlights !== 0.0 || shadows !== 0.0) {
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          
          if (highlights !== 0.0) {
            const highlightMask = Math.pow(Math.max(0, Math.min(1, (luma - 0.5) * 2.0)), 2);
            r += highlights * highlightMask;
            g += highlights * highlightMask;
            b += highlights * highlightMask;
          }
          
          if (shadows !== 0.0) {
            const shadowMask = Math.pow(Math.max(0, Math.min(1, (0.5 - luma) * 2.0)), 2);
            r += shadows * shadowMask;
            g += shadows * shadowMask;
            b += shadows * shadowMask;
          }
        }
        
        // 6. Blacks
        if (blacks !== 0.0) {
          r = r + blacks * (1.0 - r);
          g = g + blacks * (1.0 - g);
          b = b + blacks * (1.0 - b);
        }
        
        // 7. Whites
        if (whites !== 0.0) {
          r = r + whites * r;
          g = g + whites * g;
          b = b + whites * b;
        }
        
        // 8. Contrast
        if (contrast !== 1.0) {
          r = (r - 0.5) * contrast + 0.5;
          g = (g - 0.5) * contrast + 0.5;
          b = (b - 0.5) * contrast + 0.5;
        }
        
        // 9. Brightness
        if (brightness !== 0.0) {
          r += brightness;
          g += brightness;
          b += brightness;
        }
        
        // Clip before HSV
        r = Math.max(0, Math.min(1, r));
        g = Math.max(0, Math.min(1, g));
        b = Math.max(0, Math.min(1, b));
        
        // 10. Hue and Saturation (HSV conversion)
        if (hue !== 0.0 || saturation !== 1.0) {
          const hsv = this.rgbToHsv(r, g, b);
          
          if (hue !== 0.0) {
            hsv.h = (hsv.h + hue / 360.0) % 1.0;
            if (hsv.h < 0) hsv.h += 1.0;
          }
          
          if (saturation !== 1.0) {
            hsv.s = Math.max(0, Math.min(1, hsv.s * saturation));
          }
          
          const rgb = this.hsvToRgb(hsv.h, hsv.s, hsv.v);
          r = rgb.r;
          g = rgb.g;
          b = rgb.b;
        }
        
        // Final clip and convert back to 0-255
        data[i] = Math.max(0, Math.min(255, r * 255));
        data[i + 1] = Math.max(0, Math.min(255, g * 255));
        data[i + 2] = Math.max(0, Math.min(255, b * 255));
      }
      
      ctx.putImageData(imageData, 0, 0);
    };
    
    // RGB to HSV conversion
    nodeType.prototype.rgbToHsv = function(r, g, b) {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      
      let h = 0;
      const s = max === 0 ? 0 : delta / max;
      const v = max;
      
      if (delta !== 0) {
        if (max === r) {
          h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        } else if (max === g) {
          h = ((b - r) / delta + 2) / 6;
        } else {
          h = ((r - g) / delta + 4) / 6;
        }
      }
      
      return { h, s, v };
    };
    
    // HSV to RGB conversion
    nodeType.prototype.hsvToRgb = function(h, s, v) {
      const i = Math.floor(h * 6);
      const f = h * 6 - i;
      const p = v * (1 - s);
      const q = v * (1 - f * s);
      const t = v * (1 - (1 - f) * s);
      
      let r, g, b;
      switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
      }
      
      return { r, g, b };
    };
    
    // Load preview image from filename
    nodeType.prototype.loadPreviewImage = function(filename, type = "temp") {
      if (!filename) return;
      
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.previewImage = img;
        this.processPreview();
      };
      img.onerror = (e) => {
        console.log("Failed to load preview image:", filename, e);
        this.previewImage = null;
      };
      img.src = `/view?filename=${encodeURIComponent(filename)}&type=${type}&subfolder=`;
    };
    
    // Get a simple key of current widget values for change detection
    nodeType.prototype._getWidgetValueKey = function() {
      const vals = [];
      for (const w of this.widgets) {
        if (w.name !== "cached_image_path" && w.name !== "preview_canvas") {
          vals.push(w.value);
        }
      }
      return vals.join(',');
    };
    
    // Process preview image with current effects (expensive - only called on value changes)
    nodeType.prototype.processPreview = function() {
      if (!this.previewImage || !this.previewImage.complete) return;
      
      const w = this.previewImage.width;
      const h = this.previewImage.height;
      
      // Create/resize work canvas
      if (!this.previewCanvas || this.previewCanvas.width !== w || this.previewCanvas.height !== h) {
        this.previewCanvas = document.createElement('canvas');
        this.previewCanvas.width = w;
        this.previewCanvas.height = h;
      }
      
      // Create/resize result canvas
      if (!this.processedCanvas || this.processedCanvas.width !== w || this.processedCanvas.height !== h) {
        this.processedCanvas = document.createElement('canvas');
        this.processedCanvas.width = w;
        this.processedCanvas.height = h;
      }
      
      // Draw original image and apply effects
      const pctx = this.previewCanvas.getContext('2d', { willReadFrequently: true });
      pctx.drawImage(this.previewImage, 0, 0);
      this.applyColorEffects(pctx);
      
      // Copy result to processedCanvas
      const rctx = this.processedCanvas.getContext('2d');
      rctx.drawImage(this.previewCanvas, 0, 0);
      
      // Request redraw to show updated result
      if (app.graph) {
        app.graph.setDirtyCanvas(true, true);
      }
    };
    
    // Enhance Invert widget 
    nodeType.prototype.enhanceInvertWidget = function (widget) {
      const originalDraw = widget.draw;
      widget.draw = function (ctx, node, width, y, height) {
        if (originalDraw) {
          originalDraw.apply(this, arguments);
        }
        
        // Only draw extras if there's enough width
        if (width < 150) return;
        
        // Add visual indicator for invert toggle
        const labelText = "Invert Colors";
        const labelX = 10;
        const labelY = y + height / 2;
        ctx.font = "12px Arial";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        
        // Only draw label if enough space
        if (width > 200) {
          ctx.fillText(labelText, labelX + 70, labelY);
        }
        
        // Draw a small invert icon (black/white squares)
        const iconSize = 16;
        const iconX = Math.min(labelX + 200, width - iconSize - 15);
        const iconY = y + (height - iconSize) / 2;
        
        ctx.fillStyle = widget.value ? "#ffffff" : "#666666";
        ctx.fillRect(iconX, iconY, iconSize / 2, iconSize / 2);
        ctx.fillRect(iconX + iconSize / 2, iconY + iconSize / 2, iconSize / 2, iconSize / 2);
        
        ctx.fillStyle = widget.value ? "#000000" : "#333333";
        ctx.fillRect(iconX + iconSize / 2, iconY, iconSize / 2, iconSize / 2);
        ctx.fillRect(iconX, iconY + iconSize / 2, iconSize / 2, iconSize / 2);
        
        ctx.strokeStyle = "#666";
        ctx.strokeRect(iconX, iconY, iconSize, iconSize);
      };
    };

    // Enhance Hue widget with color gradient
    nodeType.prototype.enhanceHueWidget = function (widget) {
      const originalDraw = widget.draw;
      widget.draw = function (ctx, node, width, y, height) {
        // Draw original widget
        if (originalDraw) {
          originalDraw.apply(this, arguments);
        }

        // Draw hue gradient bar
        const barHeight = 8;
        const barY = y + height - barHeight - 2;
        // Draw label on the left
        const labelText = "Hue";
        const labelX = 10;
        const labelY = y + height / 2;
        ctx.font = "12px Arial";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, labelX, labelY);
        // Bar is placed to the right of the label
        const barX = labelX + 70;
        const barWidth = width - barX - 15;

        // Create gradient with full hue spectrum
        const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
        gradient.addColorStop(0, "hsl(0, 100%, 50%)"); // Red
        gradient.addColorStop(0.17, "hsl(60, 100%, 50%)"); // Yellow
        gradient.addColorStop(0.33, "hsl(120, 100%, 50%)"); // Green
        gradient.addColorStop(0.5, "hsl(180, 100%, 50%)"); // Cyan
        gradient.addColorStop(0.67, "hsl(240, 100%, 50%)"); // Blue
        gradient.addColorStop(0.83, "hsl(300, 100%, 50%)"); // Magenta
        gradient.addColorStop(1, "hsl(360, 100%, 50%)"); // Red

        ctx.fillStyle = gradient;
        ctx.fillRect(barX, barY, barWidth, barHeight);

        // Draw position indicator
        const value = widget.value || 0;
        const normalizedValue = (value + 180) / 360; // -180 to 180 -> 0 to 1
        const indicatorX = barX + normalizedValue * barWidth;

        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(indicatorX, barY + barHeight / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
    };

    // Enhance Saturation widget with desaturated to saturated gradient
    nodeType.prototype.enhanceSaturationWidget = function (widget) {
      const originalDraw = widget.draw;
      widget.draw = function (ctx, node, width, y, height) {
        if (originalDraw) {
          originalDraw.apply(this, arguments);
        }

        const barHeight = 8;
        const barY = y + height - barHeight - 2;
        const labelText = "Saturation";
        const labelX = 10;
        const labelY = y + height / 2;
        ctx.font = "12px Arial";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, labelX, labelY);
        const barX = labelX + 70;
        const barWidth = width - barX - 15;

        // Gradient from gray to vibrant color
        const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
        gradient.addColorStop(0, "hsl(200, 0%, 50%)"); // Gray
        gradient.addColorStop(0.5, "hsl(200, 50%, 50%)"); // Mid saturation
        gradient.addColorStop(1, "hsl(200, 100%, 50%)"); // Full saturation

        ctx.fillStyle = gradient;
        ctx.fillRect(barX, barY, barWidth, barHeight);

        // Position indicator
        const value = widget.value || 1.0;
        const normalizedValue = (value - 0) / 2.0; // 0 to 2 -> 0 to 1
        const indicatorX = barX + normalizedValue * barWidth;

        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(indicatorX, barY + barHeight / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
    };

    // Enhance Brightness widget with dark to bright gradient
    nodeType.prototype.enhanceBrightnessWidget = function (widget) {
      const originalDraw = widget.draw;
      widget.draw = function (ctx, node, width, y, height) {
        if (originalDraw) {
          originalDraw.apply(this, arguments);
        }

        const barHeight = 8;
        const barY = y + height - barHeight - 2;
        const labelText = "Brightness";
        const labelX = 10;
        const labelY = y + height / 2;
        ctx.font = "12px Arial";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, labelX, labelY);
        const barX = labelX + 70;
        const barWidth = width - barX - 15;

        const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
        gradient.addColorStop(0, "#000000"); // Black
        gradient.addColorStop(0.5, "#808080"); // Mid gray
        gradient.addColorStop(1, "#ffffff"); // White

        ctx.fillStyle = gradient;
        ctx.fillRect(barX, barY, barWidth, barHeight);

        const value = widget.value || 0.0;
        const normalizedValue = (value + 1) / 2.0; // -1 to 1 -> 0 to 1
        const indicatorX = barX + normalizedValue * barWidth;

        ctx.fillStyle = "#00ff00";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(indicatorX, barY + barHeight / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
    };

    // Enhance Contrast widget
    nodeType.prototype.enhanceContrastWidget = function (widget) {
      const originalDraw = widget.draw;
      widget.draw = function (ctx, node, width, y, height) {
        if (originalDraw) {
          originalDraw.apply(this, arguments);
        }

        const barHeight = 8;
        const barY = y + height - barHeight - 2;
        const labelText = "Contrast";
        const labelX = 10;
        const labelY = y + height / 2;
        ctx.font = "12px Arial";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, labelX, labelY);
        const barX = labelX + 70;
        const barWidth = width - barX - 15;

        // Draw checkerboard pattern to show contrast
        const segments = 10;
        for (let i = 0; i < segments; i++) {
          const segWidth = barWidth / segments;
          const x = barX + i * segWidth;

          // Vary from low contrast (similar grays) to high contrast (black/white)
          const progress = i / (segments - 1);
          const lightness = i % 2 === 0 ? 50 - progress * 30 : 50 + progress * 30;
          ctx.fillStyle = `hsl(0, 0%, ${lightness}%)`;
          ctx.fillRect(x, barY, segWidth, barHeight);
        }

        const value = widget.value || 1.0;
        const normalizedValue = (value - 0) / 2.0; // 0 to 2 -> 0 to 1
        const indicatorX = barX + normalizedValue * barWidth;

        ctx.fillStyle = "#ff8800";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(indicatorX, barY + barHeight / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
    };

    // Enhance Exposure widget
    nodeType.prototype.enhanceExposureWidget = function (widget) {
      const originalDraw = widget.draw;
      widget.draw = function (ctx, node, width, y, height) {
        if (originalDraw) {
          originalDraw.apply(this, arguments);
        }

        const barHeight = 8;
        const barY = y + height - barHeight - 2;
        const labelText = "Exposure";
        const labelX = 10;
        const labelY = y + height / 2;
        ctx.font = "12px Arial";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, labelX, labelY);
        const barX = labelX + 70;
        const barWidth = width - barX - 15;

        // Gradient showing exposure stops
        const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
        gradient.addColorStop(0, "#1a1a1a"); // Very dark
        gradient.addColorStop(0.25, "#404040"); // Dark
        gradient.addColorStop(0.5, "#808080"); // Mid
        gradient.addColorStop(0.75, "#c0c0c0"); // Bright
        gradient.addColorStop(1, "#f0f0f0"); // Very bright

        ctx.fillStyle = gradient;
        ctx.fillRect(barX, barY, barWidth, barHeight);

        const value = widget.value || 0.0;
        const normalizedValue = (value + 2) / 4.0; // -2 to 2 -> 0 to 1
        const indicatorX = barX + normalizedValue * barWidth;

        ctx.fillStyle = "#ffff00";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(indicatorX, barY + barHeight / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
    };

    // Enhance Temperature widget (blue to orange)
    nodeType.prototype.enhanceTemperatureWidget = function (widget) {
      const originalDraw = widget.draw;
      widget.draw = function (ctx, node, width, y, height) {
        if (originalDraw) {
          originalDraw.apply(this, arguments);
        }

        const barHeight = 8;
        const barY = y + height - barHeight - 2;
        const labelText = "Temperature";
        const labelX = 10;
        const labelY = y + height / 2;
        ctx.font = "12px Arial";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, labelX, labelY);
        const barX = labelX + 70;
        const barWidth = width - barX - 15;

        const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
        gradient.addColorStop(0, "#0066ff"); // Cool blue
        gradient.addColorStop(0.5, "#ffffff"); // Neutral
        gradient.addColorStop(1, "#ff8800"); // Warm orange

        ctx.fillStyle = gradient;
        ctx.fillRect(barX, barY, barWidth, barHeight);

        const value = widget.value || 0.0;
        const normalizedValue = (value + 1) / 2.0; // -1 to 1 -> 0 to 1
        const indicatorX = barX + normalizedValue * barWidth;

        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(indicatorX, barY + barHeight / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
    };

    // Enhance Tint widget (green to magenta)
    nodeType.prototype.enhanceTintWidget = function (widget) {
      const originalDraw = widget.draw;
      widget.draw = function (ctx, node, width, y, height) {
        if (originalDraw) {
          originalDraw.apply(this, arguments);
        }

        const barHeight = 8;
        const barY = y + height - barHeight - 2;
        const labelText = "Tint";
        const labelX = 10;
        const labelY = y + height / 2;
        ctx.font = "12px Arial";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, labelX, labelY);
        const barX = labelX + 70;
        const barWidth = width - barX - 15;

        const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
        gradient.addColorStop(0, "#00ff66"); // Green
        gradient.addColorStop(0.5, "#ffffff"); // Neutral
        gradient.addColorStop(1, "#ff00ff"); // Magenta

        ctx.fillStyle = gradient;
        ctx.fillRect(barX, barY, barWidth, barHeight);

        const value = widget.value || 0.0;
        const normalizedValue = (value + 1) / 2.0; // -1 to 1 -> 0 to 1
        const indicatorX = barX + normalizedValue * barWidth;

        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(indicatorX, barY + barHeight / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
    };
  },
});
