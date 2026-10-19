"""
Lora Loader node.

its a loder, not much else to say here. Just fancy UI and combos
"""

import json
import os
import folder_paths

from .lora_meta import _parse_safetensors_metadata
from .lora_stack import parse_stack, apply_loras


def _words_from_sidecar(path):
    """trainedWords from the .civitai.info if it exists."""
    info_path = path + ".civitai.info"
    if not os.path.exists(info_path):
        return []
    try:
        with open(info_path, "r", encoding="utf-8") as f:
            info = json.load(f)
    except Exception:
        return []
    words = []
    for tw in info.get("trainedWords") or []:
        word = (tw or {}).get("word") if isinstance(tw, dict) else tw
        if word:
            words.append(word)
    return words


def _words_from_header(path):
    try:
        meta = _parse_safetensors_metadata(path)
    except Exception:
        return []
    output_name = meta.get("ss_output_name")

    freq = meta.get("ss_tag_frequency")
    if isinstance(freq, dict) and freq:
        totals = {}
        for sub in freq.values():
            if not isinstance(sub, dict):
                continue
            for tag, count in sub.items():
                try:
                    totals[tag] = totals.get(tag, 0) + int(count)
                except (TypeError, ValueError):
                    pass
        if totals:
            if output_name and output_name in totals:
                return [output_name]
            return [max(totals, key=totals.get)]

    if output_name:
        return [str(output_name)]
    return []


def _activation_words(entries):
    words = []
    seen = set()

    def add(candidates):
        for word in candidates:
            if word and word not in seen:
                seen.add(word)
                words.append(word)

    for entry in entries:
        if not entry["on"]:
            continue
        path = folder_paths.get_full_path("loras", entry["lora"])
        if path is None:
            continue
        found = _words_from_sidecar(path)
        if not found:
            found = _words_from_header(path)
        add(found)
    return words


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

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("MODEL", "CLIP", "ACTIVATION_WORDS")
    FUNCTION = "execute"
    CATEGORY = "Steaked-nodes"
    DESCRIPTION = "Load multiple LoRAs with a drag-and-drop stack UI, combos and per-LoRA info."

    def execute(self, lora_stack="{}", model=None, clip=None, **kwargs):
        entries = parse_stack(lora_stack)
        if model is not None:
            model, clip = apply_loras(model, clip, entries)
        return (model, clip, ", ".join(_activation_words(entries)))


NODE_CLASS_MAPPINGS = {"ComboLoraLoader": SteakedLoraLoader}
NODE_DISPLAY_NAME_MAPPINGS = {"ComboLoraLoader": "Combo Lora Loader"}
