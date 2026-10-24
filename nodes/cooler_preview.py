import json
import os
import random

import numpy as np
import torch
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import folder_paths


class CoolerPreviewImage:
    hide_from_assets_doc = "When ON, images are served to the node preview but never registered with the Assets system."

    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.prefix_append = "_cooler_" + "".join(random.choice("abcdefghijklmnopqrstuvxyz") for _ in range(5))
        self.compress_level = 1

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
                "hide_from_assets": ("BOOLEAN", {"default": False, "tooltip": s.hide_from_assets_doc}),
                "remove_metadata": ("BOOLEAN", {"default": False, "tooltip": "When ON, no prompt/workflow metadata is embedded in the PNG files."}),
            },
            "optional": {
                "filename_prefix": ("STRING", {"default": "temp", "tooltip": "Filename prefix for the saved preview files. (/temp folder)"}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "image"
    DESCRIPTION = "Preview Image with options to stay out of the Assets tab and strip metadata."
    SEARCH_ALIASES = ["preview", "preview image", "show image", "view image", "display image", "image viewer", "cooler"]

    def save_images(self, images, hide_from_assets=False, remove_metadata=False, filename_prefix="temp", prompt=None, extra_pnginfo=None):
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix + self.prefix_append,
            self.output_dir,
            images[0].shape[1],
            images[0].shape[0],
        )
        results = []
        for (batch_number, image) in enumerate(images):
            i = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
            metadata = None
            if not remove_metadata:
                metadata = PngInfo()
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    for x in extra_pnginfo:
                        metadata.add_text(x, json.dumps(extra_pnginfo[x]))

            filename_with_batch_num = filename.replace("%batch_num%", str(batch_number))
            file = f"{filename_with_batch_num}_{counter:05}_.png"
            img.save(os.path.join(full_output_folder, file), pnginfo=metadata, compress_level=self.compress_level)
            entry = {
                "filename": file,
                "subfolder": subfolder,
            }
            if not hide_from_assets:
                entry["type"] = self.type
            results.append(entry)
            counter += 1

        ui_key = "images" if not hide_from_assets else "st_cooler_images"
        return {"ui": {ui_key: results}, "result": (images,)}


NODE_CLASS_MAPPINGS = {"CoolerPreviewImage": CoolerPreviewImage}
