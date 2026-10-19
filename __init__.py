from .nodes.colors import ColorBlender
from .nodes.crop import ImageCrop
from .nodes.distortion import ImageDistortion
from .nodes.texture_generator import NebulaGenerator
from .nodes.edge_detection import EdgeDetection
from .nodes.blend import ImageBlender
from .nodes.halftone import HalftoneEffect
from .nodes.regional_prompts import (
    RegionalPromptsLatent,
    RegionalPromptsAttention,
    RegionalPromptsLatentImg2Img,
    RegionalPromptsAttentionImg2Img,
    RegionalPromptsLatentImageInput,
    RegionalPromptsAttentionImageInput,
)
from .nodes.any_switch import AnySwitch
from .nodes.scale_to_megapixels import ImageScaleToMegapixels, ImageScaleToMegapixelsAdvanced
from .nodes.character_library import SteakedLibrary
from .nodes.save_image_to_library import SaveImageToLibrary
from .nodes.text_concat import TextConcat
from .nodes.openpose_editor import OpenPoseEditor
from .nodes.preview_url import GetImageFromURL
from .nodes.lora_loader import SteakedLoraLoader
from .nodes.model_loader import SteakedModelLoader

# Register Booru API proxy routes
from .nodes import booru
# Register lora loader routes (combos, safetensors metadata)
from .nodes import lora_meta
# Register model loader routes (combined model listing)
from .nodes import model_meta

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
    "SaveImageToLibrary": SaveImageToLibrary,
    "SteakedTextConcat": TextConcat,
    "OpenPoseEditor": OpenPoseEditor,
    "GetImageFromURL": GetImageFromURL,
    "ComboLoraLoader": SteakedLoraLoader,
    "SmartModelLoader": SteakedModelLoader,
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
    "SaveImageToLibrary": "Save Image to Library",
    "SteakedTextConcat": "Text Concat",
    "OpenPoseEditor": "OpenPose Editor",
    "GetImageFromURL": "Get image from URL (with referer)",
    "ComboLoraLoader": "Combo Lora Loader",
    "SmartModelLoader": "Smart Model Loader",
}

WEB_DIRECTORY = "./web/"
