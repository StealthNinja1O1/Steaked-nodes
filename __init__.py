from .colors import ColorBlender
from .crop import ImageCrop
from .distortion import ImageDistortion
from .texture_generator import NebulaGenerator
from .edge_detection import EdgeDetection
from .blend import ImageBlender
from .halftone import HalftoneEffect
from .regional_prompts import RegionalPromptsLatent, RegionalPromptsAttention, RegionalPromptsAttentionExperimental

NODE_CLASS_MAPPINGS = {
    "LoadAndCrop": ImageCrop,
    "ColorBlender": ColorBlender,
    "ImageDistortion": ImageDistortion,
    "NebulaGenerator": NebulaGenerator,
    "EdgeDetection": EdgeDetection,
    "ImageBlender": ImageBlender,
    "HalftoneEffect": HalftoneEffect,
    "HalftoneEffect": HalftoneEffect,
    "RegionalPromptsLatent": RegionalPromptsLatent,
    "RegionalPromptsAttention": RegionalPromptsAttention,
    "RegionalPromptsAttentionExperimental": RegionalPromptsAttentionExperimental,
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
    "RegionalPromptsAttentionExperimental": "Regional Prompts (Attention Experimental)",
}

WEB_DIRECTORY = "./web/"
