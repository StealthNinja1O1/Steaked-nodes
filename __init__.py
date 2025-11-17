from .colors import ColorBlender
from .crop import ImageCrop
from .distortion import ImageDistortion
from .texture_generator import NebulaGenerator
from .edge_detection import EdgeDetection
from .blend import ImageBlender
from .halftone import HalftoneEffect

# Merge all node mappings
NODE_CLASS_MAPPINGS = {
    "LoadAndCrop": ImageCrop,
    "ColorBlender": ColorBlender,
    "ImageDistortion": ImageDistortion,
    "NebulaGenerator": NebulaGenerator,
    "EdgeDetection": EdgeDetection,
    "ImageBlender": ImageBlender,
    "HalftoneEffect": HalftoneEffect,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadAndCrop": "Load and Crop Image",
    "ColorBlender": "Color Blender",
    "ImageDistortion": "Image Distortion",
    "NebulaGenerator": "Nebula Generator",
    "EdgeDetection": "Edge Detection",
    "ImageBlender": "Image Blender",
    "HalftoneEffect": "Halftone Effect",
}

WEB_DIRECTORY = "./web/"
