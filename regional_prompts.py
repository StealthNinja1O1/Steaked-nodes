"""
Regional Prompting nodes for ComfyUI using comfyui-prompt-control.

Syntax Reference (from comfyui-prompt-control docs):

Latent-based (AND + MASK):
    prompt1 MASK(x1 x2, y1 y2, weight) AND prompt2 MASK(x1 x2, y1 y2, weight)

Attention-based (COUPLE):
    base_prompt COUPLE(x1 x2, y1 y2, weight) prompt1 COUPLE(x1 x2, y1 y2, weight) prompt2
    
Experimental Attention-based (COUPLE MASK):
    base_prompt COUPLE MASK(x1 x2, y1 y2, weight) prompt1 COUPLE MASK(x1 x2, y1 y2, weight) prompt2
This experimental syntax provides better regional separation, but may cause parsing errors on some systems.
"""

import json
import re
import sys
import os

custom_nodes_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
prompt_control_path = os.path.join(custom_nodes_path, "comfyui-prompt-control")

if prompt_control_path not in sys.path:
    sys.path.append(prompt_control_path)

try:
    from prompt_control.nodes_lazy import PCLazyTextEncode
except ImportError:
    print("RegionalPrompts: Could not import from comfyui-prompt-control.")
    PCLazyTextEncode = None


def clean_prompt(text):
    """Clean prompt text: normalize whitespace, remove trailing commas."""
    text = re.sub(r'\s+', ' ', text.strip())
    return text.rstrip(',').strip()


class RegionalPromptsLatent:
    """
    Latent-based regional prompting using AND + MASK syntax.
    Output: base_prompt AND prompt1 MASK(...) AND prompt2 MASK(...)
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "base_prompt": ("STRING", {"multiline": True, "default": ""}),
                "clip": ("CLIP", {"rawLink": True}),
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
        if PCLazyTextEncode is None:
            raise ImportError("RegionalPrompts requires 'comfyui-prompt-control' to be installed.")

        try:
            boxes = json.loads(box_data)
        except json.JSONDecodeError:
            boxes = []

        # Build list of prompt segments to join with AND
        segments = []
        
        # Base prompt (no mask)
        base = clean_prompt(base_prompt)
        if base:
            segments.append(base)

        prompts_map = {1: prompt_1, 2: prompt_2, 3: prompt_3, 4: prompt_4}

        for box in boxes:
            box_id = int(box.get("id", 0))
            if box_id not in prompts_map or not prompts_map[box_id].strip():
                continue

            # Get box coordinates and convert to 0-1 range
            x1 = max(0.0, min(1.0, float(box.get("x", 0)) / width))
            y1 = max(0.0, min(1.0, float(box.get("y", 0)) / height))
            x2 = max(0.0, min(1.0, (float(box.get("x", 0)) + float(box.get("w", 0))) / width))
            y2 = max(0.0, min(1.0, (float(box.get("y", 0)) + float(box.get("h", 0))) / height))
            weight = float(box.get("weight", 1.0))

            prompt_text = clean_prompt(prompts_map[box_id])
            
            # Format: prompt_text MASK(x1 x2, y1 y2, weight)
            segment = f"{prompt_text} MASK({x1:.4f} {x2:.4f}, {y1:.4f} {y2:.4f}, {weight:.2f})"
            segments.append(segment)

        final_prompt = " AND ".join(segments)
        print(f"RegionalPromptsLatent: {final_prompt}")

        node = PCLazyTextEncode()
        return node.apply(clip=clip, text=final_prompt, unique_id=unique_id)


class RegionalPromptsAttention(RegionalPromptsLatent):
    """
    Attention-based regional prompting using COUPLE syntax.
    Output: base_prompt COUPLE(...) prompt1 COUPLE(...) prompt2
    """

    FUNCTION = "apply_regional_prompts_attention"

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
        if PCLazyTextEncode is None:
            raise ImportError("RegionalPrompts requires 'comfyui-prompt-control' to be installed.")

        try:
            boxes = json.loads(box_data)
        except json.JSONDecodeError:
            boxes = []

        # Start with base prompt
        final_prompt_parts = []
        if base_prompt.strip():
            final_prompt_parts.append(clean_prompt(base_prompt))

        prompts_map = {1: prompt_1, 2: prompt_2, 3: prompt_3, 4: prompt_4}

        for box in boxes:
            box_id = int(box.get("id", 0))
            if box_id not in prompts_map or not prompts_map[box_id].strip():
                continue

            # Get box coordinates and convert to 0-1 range
            x1 = max(0.0, min(1.0, float(box.get("x", 0)) / width))
            y1 = max(0.0, min(1.0, float(box.get("y", 0)) / height))
            x2 = max(0.0, min(1.0, (float(box.get("x", 0)) + float(box.get("w", 0))) / width))
            y2 = max(0.0, min(1.0, (float(box.get("y", 0)) + float(box.get("h", 0))) / height))
            weight = float(box.get("weight", 1.0))

            prompt_text = clean_prompt(prompts_map[box_id])
            
            # Use COUPLE(params) shorthand - this gets expanded to COUPLE MASK(params) by parser
            # This avoids having a separate MASK keyword that could cause parsing issues
            # Format: COUPLE(x1 x2, y1 y2, weight) on one line, prompt on next line
            couple_str = f"COUPLE({x1:.4f} {x2:.4f}, {y1:.4f} {y2:.4f}, {weight:.2f})"
            final_prompt_parts.append(f"{couple_str}\n{prompt_text}")

        # Join with newlines for cleaner parsing
        final_prompt = "\n".join(final_prompt_parts)
        print(f"RegionalPromptsAttention:\n{final_prompt}")

        node = PCLazyTextEncode()
        return node.apply(clip=clip, text=final_prompt, unique_id=unique_id)


class RegionalPromptsAttentionExperimental(RegionalPromptsLatent):
    """
    Experimental attention-based regional prompting using COUPLE MASK(...) syntax.
    
    This provides better regional separation than the shorthand syntax,
    but may cause parsing errors on some systems. Use RegionalPromptsAttention
    if you encounter 'no closing paren' errors.
    
    Format: base_prompt COUPLE MASK(x1 x2, y1 y2, weight) prompt1 COUPLE MASK(...) prompt2
    """

    FUNCTION = "apply_regional_prompts_attention_experimental"
    DESCRIPTION = "Experimental: Uses COUPLE MASK syntax for better regional separation. May not work on all systems."

    def apply_regional_prompts_attention_experimental(
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
        """Build COUPLE MASK(...) formatted prompt for attention-based regional prompting."""
        if PCLazyTextEncode is None:
            raise ImportError("RegionalPrompts requires 'comfyui-prompt-control' to be installed.")

        try:
            boxes = json.loads(box_data)
        except json.JSONDecodeError:
            boxes = []

        # Start with base prompt
        final_prompt_parts = []
        if base_prompt.strip():
            final_prompt_parts.append(clean_prompt(base_prompt))

        prompts_map = {1: prompt_1, 2: prompt_2, 3: prompt_3, 4: prompt_4}

        for box in boxes:
            box_id = int(box.get("id", 0))
            if box_id not in prompts_map or not prompts_map[box_id].strip():
                continue

            # Get box coordinates and convert to 0-1 range
            x1 = max(0.0, min(1.0, float(box.get("x", 0)) / width))
            y1 = max(0.0, min(1.0, float(box.get("y", 0)) / height))
            x2 = max(0.0, min(1.0, (float(box.get("x", 0)) + float(box.get("w", 0))) / width))
            y2 = max(0.0, min(1.0, (float(box.get("y", 0)) + float(box.get("h", 0))) / height))
            weight = float(box.get("weight", 1.0))

            prompt_text = clean_prompt(prompts_map[box_id])

            # Use full COUPLE MASK(...) syntax for better regional separation
            # Format: COUPLE MASK(x1 x2, y1 y2, weight)
            mask_str = f"MASK({x1:.4f} {x2:.4f}, {y1:.4f} {y2:.4f}, {weight:.2f})"
            final_prompt_parts.append(f"COUPLE {mask_str}\n{prompt_text}")

        # Join with newlines for cleaner parsing
        final_prompt = "\n".join(final_prompt_parts)
        print(f"RegionalPromptsAttentionExperimental:\n{final_prompt}")

        node = PCLazyTextEncode()
        return node.apply(clip=clip, text=final_prompt, unique_id=unique_id)