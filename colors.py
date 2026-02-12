import torch
import numpy as np
import os
import json
import hashlib
import folder_paths
from PIL import Image


class ColorBlender:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "hue": (
                    "FLOAT",
                    {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0},
                ),
                "saturation": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.01},
                ),
                "brightness": (
                    "FLOAT",
                    {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01},
                ),
                "contrast": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.01},
                ),
                "exposure": (
                    "FLOAT",
                    {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01},
                ),
                "temperature": (
                    "FLOAT",
                    {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01},
                ),
                "tint": (
                    "FLOAT",
                    {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01},
                ),
                "blacks": (
                    "FLOAT",
                    {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01},
                ),
                "whites": (
                    "FLOAT",
                    {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01},
                ),
                "highlights": (
                    "FLOAT",
                    {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01},
                ),
                "shadows": (
                    "FLOAT",
                    {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01},
                ),
                "invert": ("BOOLEAN", {"default": False}),
            },
            "hidden": {
                "cached_image_path": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "blend_colors"
    CATEGORY = "Steaked-nodes/tools"
    OUTPUT_NODE = True

    def rgb_to_hsv(self, rgb):
        """Convert RGB to HSV color space"""
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

        maxc = np.maximum(np.maximum(r, g), b)
        minc = np.minimum(np.minimum(r, g), b)
        v = maxc

        deltac = maxc - minc
        s = np.where(maxc != 0, deltac / maxc, 0)

        rc = np.where(deltac != 0, (maxc - r) / deltac, 0)
        gc = np.where(deltac != 0, (maxc - g) / deltac, 0)
        bc = np.where(deltac != 0, (maxc - b) / deltac, 0)

        h = np.zeros_like(maxc)
        h = np.where((maxc == r), bc - gc, h)
        h = np.where((maxc == g), 2.0 + rc - bc, h)
        h = np.where((maxc == b), 4.0 + gc - rc, h)
        h = np.where((minc == maxc), 0.0, h)

        h = (h / 6.0) % 1.0

        return np.stack([h, s, v], axis=-1)

    def hsv_to_rgb(self, hsv):
        """Convert HSV to RGB color space"""
        h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]

        i = (h * 6.0).astype(np.int32)
        f = (h * 6.0) - i

        p = v * (1.0 - s)
        q = v * (1.0 - s * f)
        t = v * (1.0 - s * (1.0 - f))

        i = i % 6

        r = np.choose(i, [v, q, p, p, t, v])
        g = np.choose(i, [t, v, v, q, p, p])
        b = np.choose(i, [p, p, t, v, v, q])

        return np.stack([r, g, b], axis=-1)

    def blend_colors(
        self,
        image,
        hue,
        saturation,
        brightness,
        contrast,
        exposure,
        temperature,
        tint,
        blacks,
        whites,
        highlights,
        shadows,
        invert,
        cached_image_path="",
    ):

        B, H, W, C = image.shape
        if C != 3:
            raise ValueError("Expected RGB image with 3 channels.")

        # Save input image for frontend preview (first batch item only)
        preview_filename = None
        try:
            temp_dir = folder_paths.get_temp_directory()
            # Use a stable filename based on a hash
            img_hash = hashlib.md5(image[0].cpu().numpy().tobytes()).hexdigest()[:16]
            preview_filename = f"colorblender_cache_{img_hash}.png"
            preview_path = os.path.join(temp_dir, preview_filename)
            
            # Save the first input image (not processed) as preview reference
            preview_img_array = (image[0].cpu().numpy() * 255).astype(np.uint8)
            preview_img = Image.fromarray(preview_img_array)
            preview_img.save(preview_path)
        except Exception as e:
            print(f"Warning: Could not save preview image: {e}")
            preview_filename = None

        output_images = []

        for b in range(B):
            img = image[b].cpu().numpy().astype(np.float32)
            
            # Apply invert first if enabled
            if invert:
                img = 1.0 - img

            if exposure != 0.0:
                img = img * (2.0**exposure)

            if temperature != 0.0:
                if temperature > 0:  # Warmer
                    img[..., 0] = img[..., 0] * (1.0 + temperature * 0.5)  # More red
                    img[..., 2] = img[..., 2] * (1.0 - temperature * 0.3)  # Less blue
                else:  # Cooler
                    img[..., 0] = img[..., 0] * (1.0 + temperature * 0.3)  # Less red
                    img[..., 2] = img[..., 2] * (1.0 - temperature * 0.5)  # More blue

            if tint != 0.0:
                if tint > 0:  # More green
                    img[..., 1] = img[..., 1] * (1.0 + tint * 0.5)
                else:  # More magenta
                    img[..., 0] = img[..., 0] * (1.0 - tint * 0.3)
                    img[..., 2] = img[..., 2] * (1.0 - tint * 0.3)

            if highlights != 0.0 or shadows != 0.0:
                luma = (
                    0.2126 * img[..., 0] + 0.7152 * img[..., 1] + 0.0722 * img[..., 2]
                )

                if highlights != 0.0:
                    highlight_mask = np.clip((luma - 0.5) * 2.0, 0, 1) ** 2
                    img = img + highlights * highlight_mask[..., np.newaxis]

                if shadows != 0.0:
                    shadow_mask = np.clip((0.5 - luma) * 2.0, 0, 1) ** 2
                    img = img + shadows * shadow_mask[..., np.newaxis]

            if blacks != 0.0:
                img = img + blacks * (1.0 - img)

            if whites != 0.0:
                img = img + whites * img

            if contrast != 1.0:
                img = (img - 0.5) * contrast + 0.5

            if brightness != 0.0:
                img = img + brightness

            img = np.clip(img, 0, 1)
            if hue != 0.0 or saturation != 1.0:
                hsv = self.rgb_to_hsv(img)

                if hue != 0.0:
                    hsv[..., 0] = (hsv[..., 0] + hue / 360.0) % 1.0

                if saturation != 1.0:
                    hsv[..., 1] = np.clip(hsv[..., 1] * saturation, 0, 1)

                img = self.hsv_to_rgb(hsv)
            img = np.clip(img, 0, 1)

            output_images.append(img.astype(np.float32))

        result = (torch.from_numpy(np.stack(output_images)),)
        
        # Return preview filename for UI to access
        if preview_filename:
            return {
                "ui": {"cached_image": [preview_filename]},
                "result": result
            }
        
        return {"result": result}
