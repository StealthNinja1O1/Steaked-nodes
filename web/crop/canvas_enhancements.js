/**
 * crop/canvas_enhancements.js  –  Utility functions for canvas operations.
 */

/**
 * Snap a value to a grid.
 * @param {number} value - Value to snap
 * @param {number} gridSize - Grid size (default: 8)
 * @returns {number}
 */
export function snapToGrid(value, gridSize = 8) {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Clamp crop values to image bounds.
 * @param {number} x - Crop x position
 * @param {number} y - Crop y position
 * @param {number} width - Crop width
 * @param {number} height - Crop height
 * @param {number} imageWidth - Image width
 * @param {number} imageHeight - Image height
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function clampToImageBounds(x, y, width, height, imageWidth, imageHeight) {
  return {
    x: Math.max(0, Math.min(x, imageWidth - 1)),
    y: Math.max(0, Math.min(y, imageHeight - 1)),
    width: Math.max(1, Math.min(width, imageWidth - x)),
    height: Math.max(1, Math.min(height, imageHeight - y))
  };
}

/**
 * Calculate aspect ratio as a simplified fraction.
 * @param {number} width - Width
 * @param {number} height - Height
 * @returns {{ w: number, h: number, ratio: number }}
 */
export function calculateAspectRatio(width, height) {
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(Math.round(width), Math.round(height));
  return {
    w: Math.round(width / divisor),
    h: Math.round(height / divisor),
    ratio: width / height
  };
}
