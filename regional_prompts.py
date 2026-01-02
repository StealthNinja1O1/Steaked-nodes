"""
Regional Prompting nodes for ComfyUI.

Provides direct regional prompting without text parsing, building conditioning
tensors and hooks from structured inputs (box coordinates, prompt texts).
"""

import json
import re
import logging

from .regional_prompting_core import (
    encode_regional_prompts_direct,
    RegionalPromptData,
)

log = logging.getLogger("Steaked-nodes")


def clean_prompt(text):
    text = re.sub(r'\s+', ' ', text.strip())
    return text.rstrip(',').strip()


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

        for box in boxes:
            box_id = int(box.get("id", 0))
            if box_id not in prompts_map or not prompts_map[box_id].strip():
                continue

            prompt_text = clean_prompt(prompts_map[box_id])
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

        base = clean_prompt(base_prompt)
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

        for box in boxes:
            box_id = int(box.get("id", 0))
            if box_id not in prompts_map or not prompts_map[box_id].strip():
                continue

            prompt_text = clean_prompt(prompts_map[box_id])
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

        base = clean_prompt(base_prompt)
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


class RegionalPromptsAttentionExperimental(RegionalPromptsAttention):
    """Alias for RegionalPromptsAttention."""
    FUNCTION = "apply_regional_prompts_attention_experimental"


NODE_CLASS_MAPPINGS = {
    "RegionalPromptsLatent": RegionalPromptsLatent,
    "RegionalPromptsAttention": RegionalPromptsAttention,
    "RegionalPromptsAttentionExperimental": RegionalPromptsAttentionExperimental,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RegionalPromptsLatent": "Regional Prompts (Latent/MASK)",
    "RegionalPromptsAttention": "Regional Prompts (Attention/COUPLE)",
    "RegionalPromptsAttentionExperimental": "Regional Prompts (Attention/Experimental)",
}
