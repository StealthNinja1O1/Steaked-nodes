"""
Image Scale to Megapixels with Resolution Snapping
Scales images to a target megapixel count while ensuring dimensions are multiples of a specified value.
Prevents SDXL artifacts caused by non-standard resolutions.
"""

import math
import comfy.utils


class ImageScaleToMegapixels:
    """
    Scale an image to a target megapixel count while snapping dimensions to multiples.
    Useful for SDXL which works best with resolutions that are multiples of 64.
    """
    
    upscale_methods = ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "upscale_method": (cls.upscale_methods, {"default": "lanczos"}),
                "megapixels": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.01,
                    "max": 16.0,
                    "step": 0.01,
                    "display": "number"
                }),
                "multiple_of": ("INT", {
                    "default": 64,
                    "min": 1,
                    "max": 512,
                    "step": 1,
                    "display": "number",
                    "tooltip": "Snap dimensions to multiples of this value (64 for SDXL, 8 for SD1.5)"
                }),
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "scale"
    CATEGORY = "image/upscaling"
    
    def scale(self, image, upscale_method, megapixels, multiple_of):
        """
        Scale image to target megapixels with dimension snapping.
        
        Args:
            image: Input image tensor [B, H, W, C]
            upscale_method: Interpolation method
            megapixels: Target size in megapixels
            multiple_of: Snap dimensions to multiples of this value
        
        Returns:
            Scaled image tensor
        """
        samples = image.movedim(-1, 1)
        
        batch_size, channels, orig_height, orig_width = samples.shape
        
        target_pixels = megapixels * 1024 * 1024
        
        current_pixels = orig_width * orig_height
        scale_by = math.sqrt(target_pixels / current_pixels)
        
        target_width = orig_width * scale_by
        target_height = orig_height * scale_by
        final_width = self._snap_to_multiple(target_width, multiple_of)
        final_height = self._snap_to_multiple(target_height, multiple_of)
        final_width = max(multiple_of, final_width)
        final_height = max(multiple_of, final_height)
        scaled = comfy.utils.common_upscale(
            samples,
            final_width,
            final_height,
            upscale_method,
            "disabled"  # crop method
        )
        scaled = scaled.movedim(1, -1)
        return (scaled,)
    
    @staticmethod
    def _snap_to_multiple(value, multiple):
        """Round value to nearest multiple."""
        return round(value / multiple) * multiple


class ImageScaleToMegapixelsAdvanced:
    """
    Advanced version with separate width/height multipliers and aspect ratio control.
    """
    
    upscale_methods = ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "upscale_method": (cls.upscale_methods, {"default": "lanczos"}),
                "megapixels": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.01,
                    "max": 16.0,
                    "step": 0.01,
                    "display": "number"
                }),
                "width_multiple": ("INT", {
                    "default": 64,
                    "min": 1,
                    "max": 512,
                    "step": 1,
                    "display": "number"
                }),
                "height_multiple": ("INT", {
                    "default": 64,
                    "min": 1,
                    "max": 512,
                    "step": 1,
                    "display": "number"
                }),
                "keep_aspect_ratio": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Maintain original aspect ratio"
                }),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "width", "height")
    FUNCTION = "scale"
    CATEGORY = "image/upscaling"
    
    def scale(self, image, upscale_method, megapixels, width_multiple, height_multiple, keep_aspect_ratio):
        """
        Scale image with advanced control over dimension snapping.
        """
        samples = image.movedim(-1, 1)
        batch_size, channels, orig_height, orig_width = samples.shape
        target_pixels = megapixels * 1024 * 1024
        current_pixels = orig_width * orig_height
        
        if keep_aspect_ratio:
            scale_by = math.sqrt(target_pixels / current_pixels)
            target_width = orig_width * scale_by
            target_height = orig_height * scale_by
        else:
            aspect_ratio = orig_width / orig_height
            target_height = math.sqrt(target_pixels / aspect_ratio)
            target_width = target_pixels / target_height
        
        final_width = self._snap_to_multiple(target_width, width_multiple)
        final_height = self._snap_to_multiple(target_height, height_multiple)
        final_width = max(width_multiple, final_width)
        final_height = max(height_multiple, final_height)
        scaled = comfy.utils.common_upscale(
            samples,
            final_width,
            final_height,
            upscale_method,
            "disabled"
        )
        
        # Convert back to [B, H, W, C]
        scaled = scaled.movedim(1, -1)
        
        return (scaled, final_width, final_height)
    
    @staticmethod
    def _snap_to_multiple(value, multiple):
        """Round value to nearest multiple."""
        return round(value / multiple) * multiple


NODE_CLASS_MAPPINGS = {
    "ImageScaleToMegapixels": ImageScaleToMegapixels,
    "ImageScaleToMegapixelsAdvanced": ImageScaleToMegapixelsAdvanced,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageScaleToMegapixels": "Scale to Megapixels (SDXL Safe)",
    "ImageScaleToMegapixelsAdvanced": "Scale to Megapixels (Advanced)",
}
