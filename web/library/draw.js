/**
 * library/draw.js  –  Canvas drawing primitives and image helpers.
 */
import { C, M, ROW, R } from "./theme.js";

export function rrect(ctx, x, y, w, h, r, fill, stroke, lw = 1) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

export function label(ctx, s, x, y, color, size = 11, align = "left", bold = false, maxW = 9e9) {
  ctx.fillStyle = color;
  ctx.font = `${bold ? "bold " : ""}${size}px "Segoe UI",Arial,sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  s = String(s ?? "");
  if (maxW < 9e9) {
    while (s.length > 1 && ctx.measureText(s).width > maxW) s = s.slice(0, -2) + "…";
  }
  ctx.fillText(s, x, y);
}

export function drawSec(ctx, text, x, y, w) {
  rrect(ctx, x, y, w, 18, 3, C.secBg, C.border);
  label(ctx, text, x + 8, y + 9, C.secText, 10, "left", true);
  return 18 + 4;
}

export function drawBtn(ctx, x, y, w, h, text, hov, danger = false) {
  const bg = danger ? (hov ? C.dangerHov : C.danger) : hov ? C.rowHov : C.panel;
  const br = danger ? C.dangerText : hov ? C.borderHov : C.border;
  rrect(ctx, x, y, w, h, R, bg, br);
  label(ctx, text, x + w / 2, y + h / 2, danger ? C.dangerText : C.text, 11, "center");
}

export function drawCombo(ctx, x, y, w, h, val, hov) {
  rrect(ctx, x, y, w, h, R, hov ? C.rowHov : C.panel, hov ? C.borderHov : C.border);
  const name = val ? String(val).split(/[/\\]/).pop() : "─ not set ─";
  label(ctx, name, x + 7, y + h / 2, val ? C.text : C.muted, 11, "left", false, w - 20);
  ctx.fillStyle = C.muted;
  ctx.beginPath();
  const ax = x + w - 10,
    ay = y + h / 2;
  ctx.moveTo(ax - 4, ay - 2);
  ctx.lineTo(ax + 4, ay - 2);
  ctx.lineTo(ax, ay + 3);
  ctx.closePath();
  ctx.fill();
}

export function drawNumBox(ctx, x, y, w, h, val, hov) {
  rrect(ctx, x, y, w, h, R, hov ? C.rowHov : C.panel, hov ? C.borderHov : C.border);
  label(ctx, Number(val).toFixed(2), x + w / 2, y + h / 2, C.text, 11, "center");
}

export function drawToggle(ctx, x, y, on, hov) {
  const S = 15,
    cy = y + ROW / 2;
  rrect(ctx, x, cy - S / 2, S, S, 3, on ? C.check : hov ? C.rowHov : C.panel, C.border);
  if (on) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x + 3, cy);
    ctx.lineTo(x + 6, cy + 4);
    ctx.lineTo(x + 12, cy - 3);
    ctx.stroke();
  }
}

export function drawTextArea(ctx, x, y, w, h, val, hov, placeholder) {
  rrect(ctx, x, y, w, h, R, hov ? C.rowHov : C.panel, hov ? C.borderHov : C.border);
  if (val?.trim()) {
    ctx.save();
    ctx.rect(x + 2, y + 2, w - 4, h - 4);
    ctx.clip();
    ctx.font = "11px 'Segoe UI',Arial";
    ctx.fillStyle = C.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const words = val.split(" "),
      maxLW = w - 12;
    let line = "",
      ty = y + 6;
    for (const wd of words) {
      const t = line ? `${line} ${wd}` : wd;
      if (ctx.measureText(t).width > maxLW && line) {
        ctx.fillText(line, x + 6, ty);
        line = wd;
        ty += 15;
        if (ty > y + h - 12) {
          ctx.fillText("…", x + 6, ty);
          break;
        }
      } else line = t;
    }
    if (line && ty <= y + h - 12) ctx.fillText(line, x + 6, ty);
    ctx.restore();
  } else {
    label(ctx, placeholder, x + 7, y + h / 2, C.muted, 11);
  }
}

export function drawIcon(ctx, x, y, S, icon, hov, danger = false) {
  const bg = danger ? (hov ? C.dangerHov : C.danger) : hov ? C.rowHov : "transparent";
  const br = danger || hov ? (danger ? C.dangerText : C.border) : "transparent";
  rrect(ctx, x, y + (ROW - S) / 2, S, S, 3, bg, br);
  label(ctx, icon, x + S / 2, y + ROW / 2, danger ? C.dangerText : hov ? C.text : C.muted, 12, "center");
}

// ── Image cache ───────────────────────────────────────────────────────────────
const _imgs = {};

export function getImg(url, cb) {
  if (url in _imgs) return _imgs[url];
  const img = new Image();
  _imgs[url] = img;
  img.onload = cb;
  img.onerror = () => {
    _imgs[url] = null;
  };
  img.src = url;
  return null;
}

export function evictImg(url) {
  delete _imgs[url];
}

/** Center-crop: draws the largest centered square region of img into (dx,dy,dw,dh). */
export function drawImgCropped(ctx, img, dx, dy, dw, dh) {
  const iw = img.naturalWidth,
    ih = img.naturalHeight;
  const side = Math.min(iw, ih);
  const sx = (iw - side) / 2,
    sy = (ih - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, dx, dy, dw, dh);
}

/** Draw a dashed placeholder rectangle (for drag-to-reorder ghost slot). */
export function drawPlaceholder(ctx, x, y, w, h, r) {
  ctx.save();
  ctx.setLineDash([4, 4]);
  rrect(ctx, x, y, w, h, r, "#181818", "#404040");
  ctx.setLineDash([]);
  ctx.restore();
}
