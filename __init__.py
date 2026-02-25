from .colors import ColorBlender
from .crop import ImageCrop
from .distortion import ImageDistortion
from .texture_generator import NebulaGenerator
from .edge_detection import EdgeDetection
from .blend import ImageBlender
from .halftone import HalftoneEffect
from .regional_prompts import (
    RegionalPromptsLatent,
    RegionalPromptsAttention,
    RegionalPromptsLatentImg2Img,
    RegionalPromptsAttentionImg2Img,
    RegionalPromptsLatentImageInput,
    RegionalPromptsAttentionImageInput,
)
from .any_switch import AnySwitch
from .scale_to_megapixels import ImageScaleToMegapixels, ImageScaleToMegapixelsAdvanced
from .character_library import SteakedLibrary
from .text_concat import TextConcat

# Register Danbooru API proxy routes
from . import danbooru_proxy

NODE_CLASS_MAPPINGS = {
    "LoadAndCrop": ImageCrop,
    "ColorBlender": ColorBlender,
    "ImageDistortion": ImageDistortion,
    "NebulaGenerator": NebulaGenerator,
    "EdgeDetection": EdgeDetection,
    "ImageBlender": ImageBlender,
    "HalftoneEffect": HalftoneEffect,
    "RegionalPromptsLatent": RegionalPromptsLatent,
    "RegionalPromptsAttention": RegionalPromptsAttention,
    "RegionalPromptsLatentImg2Img": RegionalPromptsLatentImg2Img,
    "RegionalPromptsAttentionImg2Img": RegionalPromptsAttentionImg2Img,
    "RegionalPromptsLatentImageInput": RegionalPromptsLatentImageInput,
    "RegionalPromptsAttentionImageInput": RegionalPromptsAttentionImageInput,
    "AnySwitch": AnySwitch,
    "ImageScaleToMegapixels": ImageScaleToMegapixels,
    "ImageScaleToMegapixelsAdvanced": ImageScaleToMegapixelsAdvanced,
    "SteakedLibrary": SteakedLibrary,
    "SteakedTextConcat": TextConcat,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadAndCrop": "Load and Crop Image",
    "ColorBlender": "Color Blender",
    "ImageDistortion": "Image Distortion",
    "NebulaGenerator": "Nebula Generator",
    "EdgeDetection": "Edge Detection",
    "ImageBlender": "Image Blender",
    "HalftoneEffect": "Halftone Effect",
    "RegionalPromptsLatent": "Regional Prompts (Latent)",
    "RegionalPromptsAttention": "Regional Prompts (Attention)",
    "RegionalPromptsLatentImg2Img": "Regional Prompts (Latent Img2Img)",
    "RegionalPromptsAttentionImg2Img": "Regional Prompts (Attention Img2Img)",
    "RegionalPromptsLatentImageInput": "Regional Prompts (Latent + Image Input)",
    "RegionalPromptsAttentionImageInput": "Regional Prompts (Attention + Image Input)",
    "AnySwitch": "Any Switch",
    "ImageScaleToMegapixels": "Scale to Megapixels (SDXL Safe)",
    "ImageScaleToMegapixelsAdvanced": "Scale to Megapixels (Advanced)",
    "SteakedLibrary": "Prompt Library",
    "SteakedTextConcat": "Text Concat",
}

WEB_DIRECTORY = "./web/"
