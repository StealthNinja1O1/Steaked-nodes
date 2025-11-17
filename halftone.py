import numpy as np
import torch
import math


class HalftoneEffect:
    """Apply retro halftone and dithering effects"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "effect_type": (
                    [
                        "halftone_dots",
                        "halftone_lines",
                        "bayer_dithering",
                        "floyd_steinberg",
                        "ordered_dithering",
                        "newspaper",
                        "crosshatch",
                    ],
                    {"default": "halftone_dots"},
                ),
                "dot_size": ("INT", {"default": 4, "min": 2, "max": 20, "step": 1}),
                "angle": (
                    "FLOAT",
                    {"default": 45.0, "min": 0.0, "max": 360.0, "step": 1.0},
                ),
                "sharpness": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.1, "max": 2.0, "step": 0.1},
                ),
                "contrast": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.1},
                ),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply_effect"
    CATEGORY = "Steaked-nodes/effects"

    def _halftone_dots(self, gray, dot_size, angle, sharpness):
        """Classic circular halftone dots"""
        h, w = gray.shape
        result = np.zeros_like(gray)

        angle_rad = math.radians(angle)
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)

        for y in range(0, h, dot_size):
            for x in range(0, w, dot_size):
                cell_h = min(dot_size, h - y)
                cell_w = min(dot_size, w - x)
                avg_brightness = gray[y : y + cell_h, x : x + cell_w].mean()
                max_radius = dot_size / 2
                dot_radius = max_radius * avg_brightness * sharpness
                center_x = x + dot_size / 2
                center_y = y + dot_size / 2

                for dy in range(cell_h):
                    for dx in range(cell_w):
                        px = x + dx
                        py = y + dy
                        rx = (px - center_x) * cos_a - (py - center_y) * sin_a
                        ry = (px - center_x) * sin_a + (py - center_y) * cos_a
                        distance = math.sqrt(rx * rx + ry * ry)
                        if distance <= dot_radius:
                            result[py, px] = 0.0
                        else:
                            result[py, px] = 1.0

        return result

    def _halftone_lines(self, gray, line_size, angle, sharpness):
        """Halftone with parallel lines"""
        h, w = gray.shape
        result = np.zeros_like(gray)

        angle_rad = math.radians(angle)

        for y in range(h):
            for x in range(w):
                rx = x * math.cos(angle_rad) - y * math.sin(angle_rad)
                line_pos = int(rx / line_size) * line_size
                offset = abs(rx - line_pos)
                brightness = gray[y, x]
                max_thickness = line_size / 2
                line_thickness = max_thickness * brightness * sharpness

                if offset <= line_thickness:
                    result[y, x] = 0.0
                else:
                    result[y, x] = 1.0

        return result

    def _bayer_dithering(self, gray, matrix_size=4):
        """Bayer/ordered dithering"""
        bayer_4x4 = (
            np.array(
                [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
                dtype=np.float32,
            )
            / 16.0
        )

        h, w = gray.shape
        result = np.zeros_like(gray)

        for y in range(h):
            for x in range(w):
                threshold = bayer_4x4[y % 4, x % 4]
                result[y, x] = 1.0 if gray[y, x] > threshold else 0.0

        return result

    def _floyd_steinberg(self, gray):
        """Floyd-Steinberg error diffusion dithering"""
        h, w = gray.shape
        result = gray.copy()

        for y in range(h):
            for x in range(w):
                old_pixel = result[y, x]
                new_pixel = 1.0 if old_pixel > 0.5 else 0.0
                result[y, x] = new_pixel

                error = old_pixel - new_pixel
                if x + 1 < w:
                    result[y, x + 1] += error * 7 / 16
                if y + 1 < h:
                    if x > 0:
                        result[y + 1, x - 1] += error * 3 / 16
                    result[y + 1, x] += error * 5 / 16
                    if x + 1 < w:
                        result[y + 1, x + 1] += error * 1 / 16

        return np.clip(result, 0, 1)

    def _crosshatch(self, gray, line_size, sharpness):
        """Crosshatch pattern"""
        h, w = gray.shape
        result = np.ones_like(gray)

        for y in range(h):
            for x in range(w):
                brightness = gray[y, x]

                if (y % line_size) < (line_size * brightness * sharpness):
                    result[y, x] = 0.0
                if brightness < 0.5:
                    if (x % line_size) < (line_size * (1 - brightness) * sharpness):
                        result[y, x] = 0.0
                if brightness < 0.3:
                    if ((x + y) % line_size) < (
                        line_size * (0.3 - brightness) * 3 * sharpness
                    ):
                        result[y, x] = 0.0

        return result

    def apply_effect(self, image, effect_type, dot_size, angle, sharpness, contrast):
        """Apply halftone or dithering effect"""

        if isinstance(image, tuple) or isinstance(image, list):
            image = image[0]

        B, H, W, C = image.shape
        out_images = []

        for b in range(B):
            img = image[b].cpu().numpy().astype(np.float32)
            gray = 0.299 * img[:, :, 0] + 0.587 * img[:, :, 1] + 0.114 * img[:, :, 2]
            gray = np.clip((gray - 0.5) * contrast + 0.5, 0, 1)

            if effect_type == "halftone_dots":
                processed = self._halftone_dots(gray, dot_size, angle, sharpness)
            elif effect_type == "halftone_lines":
                processed = self._halftone_lines(gray, dot_size, angle, sharpness)
            elif effect_type == "bayer_dithering":
                processed = self._bayer_dithering(gray)
            elif effect_type == "floyd_steinberg":
                processed = self._floyd_steinberg(gray)
            elif effect_type == "ordered_dithering":
                processed = self._bayer_dithering(gray, matrix_size=8)
            elif effect_type == "newspaper":
                processed = self._halftone_dots(gray, dot_size, angle, sharpness * 0.8)
            elif effect_type == "crosshatch":
                processed = self._crosshatch(gray, dot_size, sharpness)
            else:
                processed = gray

            result = np.stack([processed, processed, processed], axis=2)
            out_images.append(result)

        result = np.stack(out_images, axis=0)
        return (torch.from_numpy(result),)
