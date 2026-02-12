"""
Regional Prompting nodes for ComfyUI.

Provides direct regional prompting without text parsing, building conditioning
tensors and hooks from structured inputs (box coordinates, prompt texts).
"""

import json
import re
import logging
import os
import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence
import folder_paths
import node_helpers

from .regional_prompting_core import (
    encode_regional_prompts_direct,
    RegionalPromptData,
)

log = logging.getLogger("Steaked-nodes")


def clean_prompt(text):
    text = re.sub(r'\s+', ' ', text.strip())
    return text.rstrip(',').strip()


def load_image_tensor(image_name):
    """Load an image and return it as a tensor."""
    image_path = folder_paths.get_annotated_filepath(image_name)
    img = node_helpers.pillow(Image.open, image_path)

    output_images = []
    output_masks = []
    w, h = None, None
    excluded_formats = ["MPO"]

    for i in ImageSequence.Iterator(img):
        i = node_helpers.pillow(ImageOps.exif_transpose, i)
        if i.mode == "I":
            i = i.point(lambda i: i * (1 / 255))
        image_converted = i.convert("RGB")

        if len(output_images) == 0:
            w = image_converted.size[0]
            h = image_converted.size[1]

        if image_converted.size[0] != w or image_converted.size[1] != h:
            continue

        image_np = np.array(image_converted).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_np)[None,]
        if "A" in i.getbands():
            mask = np.array(i.getchannel("A")).astype(np.float32) / 255.0
            mask = 1.0 - torch.from_numpy(mask)
        elif i.mode == "P" and "transparency" in i.info:
            mask = np.array(i.convert("RGBA").getchannel("A")).astype(np.float32) / 255.0
            mask = 1.0 - torch.from_numpy(mask)
        else:
            mask = torch.zeros((64, 64), dtype=torch.float32, device="cpu")
        output_images.append(image_tensor)
        output_masks.append(mask.unsqueeze(0))

    if len(output_images) > 1 and img.format not in excluded_formats:
        output_image = torch.cat(output_images, dim=0)
    else:
        output_image = output_images[0]

    return output_image, w, h


class RegionalPromptsLatent:
    """Latent-based regional prompting using ComfyUI's standard masking."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "base_prompt": ("STRING", {"multiline": True, "default": ""}),
                "clip": ("CLIP",),
                "width": ("INT", {"default": 1024, "min": 64, "max": 8192}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 8192}),
            },
            "optional": {
                "prompt_1": ("STRING", {"multiline": True, "default": ""}),
                "prompt_2": ("STRING", {"multiline": True, "default": ""}),
                "prompt_3": ("STRING", {"multiline": True, "default": ""}),
                "prompt_4": ("STRING", {"multiline": True, "default": ""}),
            },
            "hidden": {
                "box_data": ("STRING", {"default": "[]"}),
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("CONDITIONING",)
    RETURN_NAMES = ("conditioning",)
    FUNCTION = "apply_regional_prompts"
    CATEGORY = "Steaked-nodes/prompting"

    def apply_regional_prompts(
        self,
        base_prompt,
        clip,
        width,
        height,
        unique_id,
        box_data="[]",
        prompt_1="",
        prompt_2="",
        prompt_3="",
        prompt_4="",
    ):
        try:
            boxes = json.loads(box_data)
        except json.JSONDecodeError:
            boxes = []

        regional_prompts = []
        prompts_map = {1: prompt_1, 2: prompt_2, 3: prompt_3, 4: prompt_4}
        base = clean_prompt(base_prompt)

        for box in boxes:
            box_id = int(box.get("id", 0))
            if box_id not in prompts_map or not prompts_map[box_id].strip():
                continue

            prompt_text = clean_prompt(prompts_map[box_id])
            # Prepend base prompt to ensure it's always included
            if base:
                prompt_text = f"{base}, {prompt_text}"
            
            x = float(box.get("x", 0))
            y = float(box.get("y", 0))
            w = float(box.get("w", 0))
            h = float(box.get("h", 0))
            weight = float(box.get("weight", 1.0))
            start = float(box.get("start", 0.0))
            end = float(box.get("end", 1.0))

            regional_prompts.append(RegionalPromptData(
                prompt_text=prompt_text, x=x, y=y, w=w, h=h,
                weight=weight, start=start, end=end,
            ))

        log.info(f"RegionalPromptsLatent: base='{base}', regions={len(regional_prompts)}")
        for i, rp in enumerate(regional_prompts):
            log.info(f"  Region {i+1}: '{rp.prompt_text}' @ ({rp.x},{rp.y},{rp.w},{rp.h}) w={rp.weight} start={rp.start} end={rp.end}")

        return (encode_regional_prompts_direct(
            clip=clip,
            base_prompt=base,
            regional_prompts=regional_prompts,
            width=width,
            height=height,
            use_attention_couple=False,
        ),)


class RegionalPromptsAttention:
    """Attention-based regional prompting using hooks for better separation."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "base_prompt": ("STRING", {"multiline": True, "default": ""}),
                "clip": ("CLIP",),
                "width": ("INT", {"default": 1024, "min": 64, "max": 8192}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 8192}),
            },
            "optional": {
                "prompt_1": ("STRING", {"multiline": True, "default": ""}),
                "prompt_2": ("STRING", {"multiline": True, "default": ""}),
                "prompt_3": ("STRING", {"multiline": True, "default": ""}),
                "prompt_4": ("STRING", {"multiline": True, "default": ""}),
            },
            "hidden": {
                "box_data": ("STRING", {"default": "[]"}),
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("CONDITIONING",)
    RETURN_NAMES = ("conditioning",)
    FUNCTION = "apply_regional_prompts_attention"
    CATEGORY = "Steaked-nodes/prompting"

    def apply_regional_prompts_attention(
        self,
        base_prompt,
        clip,
        width,
        height,
        unique_id,
        box_data="[]",
        prompt_1="",
        prompt_2="",
        prompt_3="",
        prompt_4="",
    ):
        try:
            boxes = json.loads(box_data)
        except json.JSONDecodeError:
            boxes = []

        regional_prompts = []
        prompts_map = {1: prompt_1, 2: prompt_2, 3: prompt_3, 4: prompt_4}
        base = clean_prompt(base_prompt)

        for box in boxes:
            box_id = int(box.get("id", 0))
            if box_id not in prompts_map or not prompts_map[box_id].strip():
                continue

            prompt_text = clean_prompt(prompts_map[box_id])
            # Prepend base prompt to ensure it's always included
            if base:
                prompt_text = f"{base}, {prompt_text}"
            
            x = float(box.get("x", 0))
            y = float(box.get("y", 0))
            w = float(box.get("w", 0))
            h = float(box.get("h", 0))
            weight = float(box.get("weight", 1.0))
            start = float(box.get("start", 0.0))
            end = float(box.get("end", 1.0))

            regional_prompts.append(RegionalPromptData(
                prompt_text=prompt_text, x=x, y=y, w=w, h=h,
                weight=weight, start=start, end=end,
            ))

        log.info(f"RegionalPromptsAttention: base='{base}', regions={len(regional_prompts)}")
        for i, rp in enumerate(regional_prompts):
            log.info(f"  Region {i+1}: '{rp.prompt_text}' @ ({rp.x},{rp.y},{rp.w},{rp.h}) w={rp.weight} start={rp.start} end={rp.end}")

        return (encode_regional_prompts_direct(
            clip=clip,
            base_prompt=base,
            regional_prompts=regional_prompts,
            width=width,
            height=height,
            use_attention_couple=True,
        ),)


class RegionalPromptsLatentImg2Img:
    """Latent-based regional prompting with image input for img2img workflows."""

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [
            f for f in os.listdir(input_dir)
            if os.path.isfile(os.path.join(input_dir, f))
        ]
        files = folder_paths.filter_files_content_types(files, ["image"])
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
                "base_prompt": ("STRING", {"multiline": True, "default": ""}),
                "clip": ("CLIP",),
            },
            "optional": {
                "prompt_1": ("STRING", {"multiline": True, "default": ""}),
                "prompt_2": ("STRING", {"multiline": True, "default": ""}),
                "prompt_3": ("STRING", {"multiline": True, "default": ""}),
                "prompt_4": ("STRING", {"multiline": True, "default": ""}),
            },
            "hidden": {
                "box_data": ("STRING", {"default": "[]"}),
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE", "CONDITIONING", "INT", "INT")
    RETURN_NAMES = ("image", "conditioning", "width", "height")
    FUNCTION = "apply_regional_prompts_img2img"
    CATEGORY = "Steaked-nodes/prompting"

    def apply_regional_prompts_img2img(
        self,
        image,
        base_prompt,
        clip,
        unique_id,
        box_data="[]",
        prompt_1="",
        prompt_2="",
        prompt_3="",
        prompt_4="",
    ):
        output_image, width, height = load_image_tensor(image)

        try:
            boxes = json.loads(box_data)
        except json.JSONDecodeError:
            boxes = []

        regional_prompts = []
        prompts_map = {1: prompt_1, 2: prompt_2, 3: prompt_3, 4: prompt_4}
        base = clean_prompt(base_prompt)

        for box in boxes:
            box_id = int(box.get("id", 0))
            if box_id not in prompts_map or not prompts_map[box_id].strip():
                continue

            prompt_text = clean_prompt(prompts_map[box_id])
            # Prepend base prompt to ensure it's always included
            if base:
                prompt_text = f"{base}, {prompt_text}"
            
            x = float(box.get("x", 0))
            y = float(box.get("y", 0))
            w = float(box.get("w", 0))
            h = float(box.get("h", 0))
            weight = float(box.get("weight", 1.0))
            start = float(box.get("start", 0.0))
            end = float(box.get("end", 1.0))

            regional_prompts.append(RegionalPromptData(
                prompt_text=prompt_text, x=x, y=y, w=w, h=h,
                weight=weight, start=start, end=end,
            ))

        log.info(f"RegionalPromptsLatentImg2Img: base='{base}', regions={len(regional_prompts)}")
        for i, rp in enumerate(regional_prompts):
            log.info(f"  Region {i+1}: '{rp.prompt_text}' @ ({rp.x},{rp.y},{rp.w},{rp.h}) w={rp.weight} start={rp.start} end={rp.end}")

        conditioning = encode_regional_prompts_direct(
            clip=clip,
            base_prompt=base,
            regional_prompts=regional_prompts,
            width=width,
            height=height,
            use_attention_couple=False,
        )

        return (output_image, conditioning, width, height)


class RegionalPromptsAttentionImg2Img:
    """Attention-based regional prompting with image input for img2img workflows."""

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [
            f for f in os.listdir(input_dir)
            if os.path.isfile(os.path.join(input_dir, f))
        ]
        files = folder_paths.filter_files_content_types(files, ["image"])
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
                "base_prompt": ("STRING", {"multiline": True, "default": ""}),
                "clip": ("CLIP",),
            },
            "optional": {
                "prompt_1": ("STRING", {"multiline": True, "default": ""}),
                "prompt_2": ("STRING", {"multiline": True, "default": ""}),
                "prompt_3": ("STRING", {"multiline": True, "default": ""}),
                "prompt_4": ("STRING", {"multiline": True, "default": ""}),
            },
            "hidden": {
                "box_data": ("STRING", {"default": "[]"}),
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE", "CONDITIONING", "INT", "INT")
    RETURN_NAMES = ("image", "conditioning", "width", "height")
    FUNCTION = "apply_regional_prompts_attention_img2img"
    CATEGORY = "Steaked-nodes/prompting"

    def apply_regional_prompts_attention_img2img(
        self,
        image,
        base_prompt,
        clip,
        unique_id,
        box_data="[]",
        prompt_1="",
        prompt_2="",
        prompt_3="",
        prompt_4="",
    ):
        output_image, width, height = load_image_tensor(image)

        try:
            boxes = json.loads(box_data)
        except json.JSONDecodeError:
            boxes = []

        regional_prompts = []
        prompts_map = {1: prompt_1, 2: prompt_2, 3: prompt_3, 4: prompt_4}
        base = clean_prompt(base_prompt)

        for box in boxes:
            box_id = int(box.get("id", 0))
            if box_id not in prompts_map or not prompts_map[box_id].strip():
                continue

            prompt_text = clean_prompt(prompts_map[box_id])
            # Prepend base prompt to ensure it's always included
            if base:
                prompt_text = f"{base}, {prompt_text}"
            
            x = float(box.get("x", 0))
            y = float(box.get("y", 0))
            w = float(box.get("w", 0))
            h = float(box.get("h", 0))
            weight = float(box.get("weight", 1.0))
            start = float(box.get("start", 0.0))
            end = float(box.get("end", 1.0))

            regional_prompts.append(RegionalPromptData(
                prompt_text=prompt_text, x=x, y=y, w=w, h=h,
                weight=weight, start=start, end=end,
            ))

        log.info(f"RegionalPromptsAttentionImg2Img: base='{base}', regions={len(regional_prompts)}")
        for i, rp in enumerate(regional_prompts):
            log.info(f"  Region {i+1}: '{rp.prompt_text}' @ ({rp.x},{rp.y},{rp.w},{rp.h}) w={rp.weight} start={rp.start} end={rp.end}")

        conditioning = encode_regional_prompts_direct(
            clip=clip,
            base_prompt=base,
            regional_prompts=regional_prompts,
            width=width,
            height=height,
            use_attention_couple=True,
        )

        return (output_image, conditioning, width, height)


class RegionalPromptsAttentionExperimental(RegionalPromptsAttention):
    """Alias for RegionalPromptsAttention."""
    FUNCTION = "apply_regional_prompts_attention_experimental"


NODE_CLASS_MAPPINGS = {
    "RegionalPromptsLatent": RegionalPromptsLatent,
    "RegionalPromptsAttention": RegionalPromptsAttention,
    "RegionalPromptsAttentionExperimental": RegionalPromptsAttentionExperimental,
    "RegionalPromptsLatentImg2Img": RegionalPromptsLatentImg2Img,
    "RegionalPromptsAttentionImg2Img": RegionalPromptsAttentionImg2Img,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RegionalPromptsLatent": "Regional Prompts (Latent/MASK)",
    "RegionalPromptsAttention": "Regional Prompts (Attention/COUPLE)",
    "RegionalPromptsAttentionExperimental": "Regional Prompts (Attention/Experimental)",
    "RegionalPromptsLatentImg2Img": "Regional Prompts (Latent/MASK Img2Img)",
    "RegionalPromptsAttentionImg2Img": "Regional Prompts (Attention/COUPLE Img2Img)",
}
