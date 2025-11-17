import { app } from "../../scripts/app.js";
app.registerExtension({
  name: "Steaked.ColorBlender",
  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "ColorBlender") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
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
        }
      }

      return r;
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
