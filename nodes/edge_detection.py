import numpy as np
import torch
import math


class EdgeDetection:
    """Advanced edge detection with multiple algorithms and styling options"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "algorithm": (
                    ["sobel", "prewitt", "scharr", "roberts", "laplacian", "canny"],
                    {"default": "sobel"},
                ),
                "threshold": (
                    "FLOAT",
                    {"default": 0.2, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "thickness": ("INT", {"default": 1, "min": 1, "max": 5, "step": 1}),
                "invert": ("BOOLEAN", {"default": False}),
                "color_r": (
                    "FLOAT",
                    {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "color_g": (
                    "FLOAT",
                    {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "color_b": (
                    "FLOAT",
                    {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "background_r": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "background_g": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "background_b": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "detect_edges"
    CATEGORY = "Steaked-nodes/effects"

    def _convolve(self, img, kernel):
        """Apply convolution with a kernel"""
        kh, kw = kernel.shape
        h, w = img.shape
        pad_h, pad_w = kh // 2, kw // 2

        padded = np.pad(img, ((pad_h, pad_h), (pad_w, pad_w)), mode="edge")
        result = np.zeros_like(img)

        for y in range(h):
            for x in range(w):
                region = padded[y : y + kh, x : x + kw]
                result[y, x] = np.sum(region * kernel)

        return result

    def _sobel(self, gray):
        """Sobel edge detection"""
        kernel_x = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=np.float32)
        kernel_y = np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=np.float32)

        gx = self._convolve(gray, kernel_x)
        gy = self._convolve(gray, kernel_y)

        magnitude = np.sqrt(gx**2 + gy**2)
        return magnitude / magnitude.max() if magnitude.max() > 0 else magnitude

    def _prewitt(self, gray):
        """Prewitt edge detection"""
        kernel_x = np.array([[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]], dtype=np.float32)
        kernel_y = np.array([[-1, -1, -1], [0, 0, 0], [1, 1, 1]], dtype=np.float32)

        gx = self._convolve(gray, kernel_x)
        gy = self._convolve(gray, kernel_y)

        magnitude = np.sqrt(gx**2 + gy**2)
        return magnitude / magnitude.max() if magnitude.max() > 0 else magnitude

    def _scharr(self, gray):
        """Scharr edge detection (improved Sobel)"""
        kernel_x = np.array([[-3, 0, 3], [-10, 0, 10], [-3, 0, 3]], dtype=np.float32)
        kernel_y = np.array([[-3, -10, -3], [0, 0, 0], [3, 10, 3]], dtype=np.float32)

        gx = self._convolve(gray, kernel_x)
        gy = self._convolve(gray, kernel_y)

        magnitude = np.sqrt(gx**2 + gy**2)
        return magnitude / magnitude.max() if magnitude.max() > 0 else magnitude

    def _roberts(self, gray):
        """Roberts cross edge detection"""
        kernel_x = np.array([[1, 0], [0, -1]], dtype=np.float32)
        kernel_y = np.array([[0, 1], [-1, 0]], dtype=np.float32)

        gx = self._convolve(gray, kernel_x)
        gy = self._convolve(gray, kernel_y)

        magnitude = np.sqrt(gx**2 + gy**2)
        return magnitude / magnitude.max() if magnitude.max() > 0 else magnitude

    def _laplacian(self, gray):
        """Laplacian edge detection"""
        kernel = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
        result = self._convolve(gray, kernel)
        result = np.abs(result)
        return result / result.max() if result.max() > 0 else result

    def _canny(self, gray, threshold):
        """Simplified Canny edge detection"""
        gaussian = np.array([[1, 2, 1], [2, 4, 2], [1, 2, 1]], dtype=np.float32) / 16
        blurred = self._convolve(gray, gaussian)

        edges = self._sobel(blurred)

        h, w = edges.shape
        suppressed = np.zeros_like(edges)
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                if edges[y, x] > threshold:
                    if edges[y, x] >= edges[y - 1 : y + 2, x - 1 : x + 2].max():
                        suppressed[y, x] = edges[y, x]

        return suppressed

    def _dilate(self, img, thickness):
        """Simple dilation to thicken edges"""
        if thickness <= 1:
            return img

        h, w = img.shape
        result = img.copy()

        for _ in range(thickness - 1):
            temp = result.copy()
            for y in range(1, h - 1):
                for x in range(1, w - 1):
                    result[y, x] = temp[y - 1 : y + 2, x - 1 : x + 2].max()

        return result

    def detect_edges(
        self,
        image,
        algorithm,
        threshold,
        thickness,
        invert,
        color_r,
        color_g,
        color_b,
        background_r,
        background_g,
        background_b,
    ):
        """Detect edges in image"""

        if isinstance(image, tuple) or isinstance(image, list):
            image = image[0]

        B, H, W, C = image.shape
        out_images = []

        edge_color = np.array([color_r, color_g, color_b], dtype=np.float32)
        bg_color = np.array(
            [background_r, background_g, background_b], dtype=np.float32
        )

        for b in range(B):
            img = image[b].cpu().numpy().astype(np.float32)

            gray = 0.299 * img[:, :, 0] + 0.587 * img[:, :, 1] + 0.114 * img[:, :, 2]

            if algorithm == "sobel":
                edges = self._sobel(gray)
            elif algorithm == "prewitt":
                edges = self._prewitt(gray)
            elif algorithm == "scharr":
                edges = self._scharr(gray)
            elif algorithm == "roberts":
                edges = self._roberts(gray)
            elif algorithm == "laplacian":
                edges = self._laplacian(gray)
            elif algorithm == "canny":
                edges = self._canny(gray, threshold)
            else:
                edges = self._sobel(gray)
            if algorithm != "canny":
                edges = (edges > threshold).astype(np.float32)
            else:
                edges = (edges > 0).astype(np.float32)

            if thickness > 1:
                edges = self._dilate(edges, thickness)

            if invert:
                edges = 1.0 - edges

            result = np.zeros((H, W, 3), dtype=np.float32)
            for c in range(3):
                result[:, :, c] = bg_color[c] * (1 - edges) + edge_color[c] * edges

            out_images.append(result)

        result = np.stack(out_images, axis=0)
        return (torch.from_numpy(result),)
