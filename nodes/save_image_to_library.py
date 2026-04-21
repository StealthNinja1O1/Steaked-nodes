"""
Save Image to Library Node
===========================
Saves a generated image into a character's gallery in the Prompt Library.

Two modes:
  auto   — Detects the selected character from a SteakedLibrary node in the
            current workflow (via the PROMPT hidden input).
  manual — User selects a character explicitly via the JS widget.
"""

import json
import time
import numpy as np
from PIL import Image, PngImagePlugin
from .character_library import _read_library, _write_library, LIBRARY_DIR


class SaveImageToLibrary:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "mode": (["auto", "manual"], {"default": "auto"}),
            },
            "optional": {
                # Managed by the JS widget; hidden via JS but serialised into
                # the workflow blob so state is restored on graph reload.
                "character_id":   ("STRING", {"default": ""}),
                "character_name": ("STRING", {"default": ""}),
            },
            "hidden": {
                # ComfyUI special tokens — not widgets.
                "prompt":         "PROMPT",
                "extra_pnginfo":  "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "save_image"
    OUTPUT_NODE = True
    CATEGORY = "Steaked-nodes/library"
    DESCRIPTION = "Save a generated image directly into a character's library gallery."

    @classmethod
    def IS_CHANGED(cls, image, mode="auto", character_id="", character_name="", prompt=None, extra_pnginfo=None):
        # nan != nan → always True → node never cached, re-executes every run.
        return float("nan")

    def save_image(self, image, mode="auto", character_id="", character_name="", prompt=None, extra_pnginfo=None):
        char_id = self._resolve_char_id(mode, character_id, prompt)

        if not char_id:
            print("[SaveImageToLibrary] No character resolved — skipping save.")
            return {}

        # Validate character exists
        library = _read_library()
        char_entry = next(
            (c for c in library.get("characters", []) if c.get("id") == char_id),
            None,
        )
        if char_entry is None:
            print(f"[SaveImageToLibrary] Character '{char_id}' not found in library.")
            return {}

        # Ensure output directory
        img_dir = LIBRARY_DIR / char_id / "images"
        img_dir.mkdir(parents=True, exist_ok=True)

        # Convert tensor batch (B, H, W, C) float32 [0,1] → PNG files
        timestamp = int(time.time() * 1000)
        saved = []

        for b in range(image.shape[0]):
            arr = (image[b].cpu().numpy() * 255).clip(0, 255).astype("uint8")
            pil_img = Image.fromarray(arr)

            filename = f"saved_{timestamp}_{b:04d}.png"
            dest = img_dir / filename
            # Collision guard (rare: two runs starting within the same millisecond)
            counter = 0
            while dest.exists():
                counter += 1
                dest = img_dir / f"saved_{timestamp}_{b:04d}_{counter}.png"
            filename = dest.name

            # Embed metadata exactly as ComfyUI's SaveImage does:
            # - "prompt" chunk = execution API dict (used by metadata viewer)
            # - "workflow" chunk = comes from extra_pnginfo (full graph JSON)
            pnginfo = PngImagePlugin.PngInfo()
            if prompt is not None:
                try:
                    pnginfo.add_text("prompt", json.dumps(prompt))
                except (ValueError, TypeError):
                    pass
            if extra_pnginfo:
                for k, v in extra_pnginfo.items():
                    try:
                        pnginfo.add_text(k, json.dumps(v))
                    except (ValueError, TypeError):
                        pass

            pil_img.save(str(dest), format="PNG", pnginfo=pnginfo)
            saved.append(filename)
            print(f"[SaveImageToLibrary] Saved '{filename}' → character '{char_id}'")

        # Append to gallery and persist
        char_entry.setdefault("gallery", []).extend(saved)
        _write_library(library)

        return {}

    # ──────────────────────────────────────────────────────────────────────────

    def _resolve_char_id(self, mode: str, character_id: str, prompt) -> str:
        if mode == "auto":
            return self._find_library_char(prompt)
        return character_id.strip()

    @staticmethod
    def _find_library_char(prompt) -> str:
        """Walk the workflow prompt dict and return the selected_character value
        from the first SteakedLibrary node found."""
        if not isinstance(prompt, dict):
            return ""
        for node_data in prompt.values():
            if not isinstance(node_data, dict):
                continue
            if node_data.get("class_type") == "SteakedLibrary":
                char_id = node_data.get("inputs", {}).get("selected_character", "")
                if char_id:
                    return char_id
        return ""
