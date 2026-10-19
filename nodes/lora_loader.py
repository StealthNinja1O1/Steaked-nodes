"""
Lora Loader node.

its a loder, not much else to say here. Just fancy UI and combos
"""

from .lora_stack import parse_stack, apply_loras


class SteakedLoraLoader:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "lora_stack": ("STRING", {
                    "multiline": True,
                    "default": "{}",
                }),
            },
            "optional": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP")
    RETURN_NAMES = ("MODEL", "CLIP")
    FUNCTION = "execute"
    CATEGORY = "Steaked-nodes"
    DESCRIPTION = "Load multiple LoRAs with a drag-and-drop stack UI, combos and per-LoRA info."

    def execute(self, lora_stack="{}", model=None, clip=None, **kwargs):
        if model is None:
            return (None, clip)

        entries = parse_stack(lora_stack)
        model, clip = apply_loras(model, clip, entries)
        return (model, clip)


NODE_CLASS_MAPPINGS = {"ComboLoraLoader": SteakedLoraLoader}
NODE_DISPLAY_NAME_MAPPINGS = {"ComboLoraLoader": "Combo Lora Loader"}
