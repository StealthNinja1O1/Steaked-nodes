import numpy as np
import torch


class ImageBlender:
    """Image blending with multiple blend modes"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "base_image": ("IMAGE",),
                "blend_image": ("IMAGE",),
                "blend_mode": (
                    [
                        "normal",
                        "multiply",
                        "screen",
                        "overlay",
                        "soft_light",
                        "hard_light",
                        "color_dodge",
                        "color_burn",
                        "darken",
                        "lighten",
                        "difference",
                        "exclusion",
                        "add",
                        "subtract",
                    ],
                    {"default": "normal"},
                ),
                "opacity": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
            },
            "optional": {
                "mask": ("IMAGE",),  # Optional mask for selective blending
            },
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "blend_images"
    CATEGORY = "Steaked-nodes/compositing"

    def _blend_normal(self, base, blend):
        return blend

    def _blend_multiply(self, base, blend):
        return base * blend

    def _blend_screen(self, base, blend):
        return 1 - (1 - base) * (1 - blend)

    def _blend_overlay(self, base, blend):
        result = np.where(
            base < 0.5, 2 * base * blend, 1 - 2 * (1 - base) * (1 - blend)
        )
        return result

    def _blend_soft_light(self, base, blend):
        result = np.where(
            blend < 0.5,
            2 * base * blend + base * base * (1 - 2 * blend),
            2 * base * (1 - blend) + np.sqrt(base) * (2 * blend - 1),
        )
        return result

    def _blend_hard_light(self, base, blend):
        result = np.where(
            blend < 0.5, 2 * base * blend, 1 - 2 * (1 - base) * (1 - blend)
        )
        return result

    def _blend_color_dodge(self, base, blend):
        # Avoid division by zero
        result = np.where(
            blend >= 1.0, 1.0, np.minimum(1.0, base / (1.0 - blend + 1e-10))
        )
        return result

    def _blend_color_burn(self, base, blend):
        result = np.where(
            blend <= 0.0, 0.0, 1.0 - np.minimum(1.0, (1.0 - base) / (blend + 1e-10))
        )
        return result

    def _blend_darken(self, base, blend):
        return np.minimum(base, blend)

    def _blend_lighten(self, base, blend):
        return np.maximum(base, blend)

    def _blend_difference(self, base, blend):
        return np.abs(base - blend)

    def _blend_exclusion(self, base, blend):
        return base + blend - 2 * base * blend

    def _blend_add(self, base, blend):
        return np.minimum(1.0, base + blend)

    def _blend_subtract(self, base, blend):
        return np.maximum(0.0, base - blend)

    def blend_images(self, base_image, blend_image, blend_mode, opacity, mask=None):
        """Blend two images together"""

        if isinstance(base_image, tuple) or isinstance(base_image, list):
            base_image = base_image[0]
        if isinstance(blend_image, tuple) or isinstance(blend_image, list):
            blend_image = blend_image[0]

        B1, H1, W1, C1 = base_image.shape
        B2, H2, W2, C2 = blend_image.shape
        
        if B1 != B2:
            B = min(B1, B2)
            base_image = base_image[:B]
            blend_image = blend_image[:B]
        else:
            B = B1

        if H1 != H2 or W1 != W2:
            blend_resized = np.zeros((B, H1, W1, C2), dtype=np.float32)
            for b in range(B):
                for y in range(H1):
                    for x in range(W1):
                        src_y = int(y * H2 / H1)
                        src_x = int(x * W2 / W1)
                        blend_resized[b, y, x] = (
                            blend_image[b, src_y, src_x].cpu().numpy()
                        )
            blend_image = torch.from_numpy(blend_resized)

        out_images = []

        for b in range(B):
            base = base_image[b].cpu().numpy().astype(np.float32)
            blend = blend_image[b].cpu().numpy().astype(np.float32)

            # Clamp inputs
            base = np.clip(base, 0.0, 1.0)
            blend = np.clip(blend, 0.0, 1.0)

            # Apply blend mode
            if blend_mode == "normal":
                result = self._blend_normal(base, blend)
            elif blend_mode == "multiply":
                result = self._blend_multiply(base, blend)
            elif blend_mode == "screen":
                result = self._blend_screen(base, blend)
            elif blend_mode == "overlay":
                result = self._blend_overlay(base, blend)
            elif blend_mode == "soft_light":
                result = self._blend_soft_light(base, blend)
            elif blend_mode == "hard_light":
                result = self._blend_hard_light(base, blend)
            elif blend_mode == "color_dodge":
                result = self._blend_color_dodge(base, blend)
            elif blend_mode == "color_burn":
                result = self._blend_color_burn(base, blend)
            elif blend_mode == "darken":
                result = self._blend_darken(base, blend)
            elif blend_mode == "lighten":
                result = self._blend_lighten(base, blend)
            elif blend_mode == "difference":
                result = self._blend_difference(base, blend)
            elif blend_mode == "exclusion":
                result = self._blend_exclusion(base, blend)
            elif blend_mode == "add":
                result = self._blend_add(base, blend)
            elif blend_mode == "subtract":
                result = self._blend_subtract(base, blend)
            else:
                result = blend

            result = base * (1 - opacity) + result * opacity
            if mask is not None:
                if isinstance(mask, tuple) or isinstance(mask, list):
                    mask = mask[0]
                mask_img = (
                    mask[min(b, mask.shape[0] - 1)].cpu().numpy().astype(np.float32)
                )

                if mask_img.shape[0] != H1 or mask_img.shape[1] != W1:
                    mask_resized = np.zeros(
                        (H1, W1, mask_img.shape[2]), dtype=np.float32
                    )
                    for y in range(H1):
                        for x in range(W1):
                            src_y = int(y * mask_img.shape[0] / H1)
                            src_x = int(x * mask_img.shape[1] / W1)
                            mask_resized[y, x] = mask_img[src_y, src_x]
                    mask_img = mask_resized

                if mask_img.shape[2] == 3:
                    mask_val = mask_img.mean(axis=2, keepdims=True)
                else:
                    mask_val = mask_img[:, :, 0:1]

                result = base * (1 - mask_val) + result * mask_val

            result = np.clip(result, 0.0, 1.0)
            out_images.append(result)

        result = np.stack(out_images, axis=0)
        return (torch.from_numpy(result),)
