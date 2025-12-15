import json
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


class RegionalPromptsLatent:
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
            raise ImportError(
                "RegionalPrompts requires 'comfyui-prompt-control' or 'ComfyUI Prompt Control' to be installed."
            )

        # Parse box data
        try:
            boxes = json.loads(box_data)
        except json.JSONDecodeError:
            print(f"RegionalPrompts: Invalid JSON in box_data: {box_data}")
            boxes = []

        final_prompt_parts = []
        if base_prompt.strip():
            final_prompt_parts.append(base_prompt)

        prompts_map = {1: prompt_1, 2: prompt_2, 3: prompt_3, 4: prompt_4}

        for box in boxes:
            box_id = int(box.get("id", 0))
            if box_id not in prompts_map or not prompts_map[box_id].strip():
                continue

            b_x = float(box.get("x", 0))
            b_y = float(box.get("y", 0))
            b_w = float(box.get("w", 0))
            b_h = float(box.get("h", 0))

            # Advanced options
            weight = float(box.get("weight", 1.0))
            feather = int(box.get("feather", 0))
            start_step = float(box.get("start", 0.0))
            end_step = float(box.get("end", 1.0))

            x1 = max(0.0, min(1.0, b_x / width))
            y1 = max(0.0, min(1.0, b_y / height))
            x2 = max(0.0, min(1.0, (b_x + b_w) / width))
            y2 = max(0.0, min(1.0, (b_y + b_h) / height))

            p_text = prompts_map[box_id]

            # Scheduling logic: [:prompt::start,end]
            # If start != 0 or end != 1, wrap in schedule
            if start_step > 0.0 or end_step < 1.0:
                p_text = f"[:{p_text}::{start_step:.2f},{end_step:.2f}]"

            # Construct MASK string with weight
            # MASK(x1 x2, y1 y2, weight)
            mask_str = f"MASK({x1:.4f} {x2:.4f}, {y1:.4f} {y2:.4f}, {weight:.2f})"

            # Add FEATHER if needed
            if feather > 0:
                mask_str += f" FEATHER({feather})"

            final_prompt_parts.append(f"AND {p_text} {mask_str}")

        final_prompt_str = " ".join(final_prompt_parts)

        print(f"RegionalPrompts: Generated prompt: {final_prompt_str}")

        node = PCLazyTextEncode()
        return node.apply(clip=clip, text=final_prompt_str, unique_id=unique_id)


class RegionalPromptsAttention(RegionalPromptsLatent):
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
            raise ImportError(
                "RegionalPrompts requires 'comfyui-prompt-control' or 'ComfyUI Prompt Control' to be installed."
            )

        try:
            boxes = json.loads(box_data)
        except json.JSONDecodeError:
            print(f"RegionalPrompts: Invalid JSON in box_data: {box_data}")
            boxes = []

        final_prompt_parts = []
        if base_prompt.strip():
            final_prompt_parts.append(base_prompt)

        prompts_map = {1: prompt_1, 2: prompt_2, 3: prompt_3, 4: prompt_4}

        for box in boxes:
            box_id = int(box.get("id", 0))
            if box_id not in prompts_map or not prompts_map[box_id].strip():
                continue

            b_x = float(box.get("x", 0))
            b_y = float(box.get("y", 0))
            b_w = float(box.get("w", 0))
            b_h = float(box.get("h", 0))

            # Advanced options
            weight = float(box.get("weight", 1.0))
            feather = int(box.get("feather", 0))
            start_step = float(box.get("start", 0.0))
            end_step = float(box.get("end", 1.0))

            x1 = max(0.0, min(1.0, b_x / width))
            y1 = max(0.0, min(1.0, b_y / height))
            x2 = max(0.0, min(1.0, (b_x + b_w) / width))
            y2 = max(0.0, min(1.0, (b_y + b_h) / height))

            p_text = prompts_map[box_id]

            # Scheduling logic
            if start_step > 0.0 or end_step < 1.0:
                p_text = f"[:{p_text}::{start_step:.2f},{end_step:.2f}]"

            # Construct COUPLE string
            # Syntax: COUPLE MASK(x1 x2, y1 y2, weight) FEATHER(f) prompt

            mask_str = f"MASK({x1:.4f} {x2:.4f}, {y1:.4f} {y2:.4f}, {weight:.2f})"
            if feather > 0:
                mask_str += f" FEATHER({feather})"

            final_prompt_parts.append(f"COUPLE {mask_str} {p_text}")

        final_prompt_str = " ".join(final_prompt_parts)
        print(f"RegionalPromptsAttention: Generated prompt: {final_prompt_str}")

        node = PCLazyTextEncode()
        return node.apply(clip=clip, text=final_prompt_str, unique_id=unique_id)
