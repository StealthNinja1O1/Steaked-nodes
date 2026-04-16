import os
import base64
import io
import json
import numpy as np
import torch
from PIL import Image

import folder_paths

# ── REST API routes ─────────────────────────────────────────────────────────────
from server import PromptServer
from aiohttp import web

routes = PromptServer.instance.routes

_EDITOR_HTML_PATH = os.path.join(os.path.dirname(__file__), "web", "openpose_editor", "index.html")


@routes.get("/steaked/openpose/editor")
async def openpose_editor_html(request):
    """Serve the OpenPose editor singlefile HTML."""
    try:
        if not os.path.exists(_EDITOR_HTML_PATH):
            return web.Response(
                text="Editor HTML not found. Please build it first.",
                status=404,
            )
        with open(_EDITOR_HTML_PATH, "r", encoding="utf-8") as f:
            content = f.read()
        return web.Response(text=content, content_type="text/html")
    except Exception as e:
        return web.Response(text=f"Error loading editor: {e}", status=500)


def _base64_to_image_tensor(b64_string: str) -> torch.Tensor:
    """Decode a base64 PNG data-URL string into a ComfyUI IMAGE tensor.

    Accepts both raw base64 and data-URL format (data:image/png;base64,...).
    Returns tensor of shape (1, H, W, 3) float32 in [0, 1].
    """
    # Strip data-URL prefix if present
    if b64_string.startswith("data:"):
        b64_string = b64_string.split(",", 1)[1]

    img_bytes = base64.b64decode(b64_string)
    pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    arr = np.array(pil_img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]  # (1, H, W, 3)


class OpenPoseEditor:
    """ComfyUI node that provides an embedded 3-D OpenPose editor.

    The user clicks *Open Editor* to launch a full-screen modal containing
    the Three.js editor.  When they close it the rendered pose image is
    captured and exposed as an ``IMAGE`` output that can be fed directly
    into a ControlNet *Apply* node.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "pose_json": ("STRING", {"default": ""}),
                "pose_image": ("STRING", {"default": ""}),
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("pose_image",)
    FUNCTION = "generate_pose_image"
    CATEGORY = "Steaked-nodes/tools"
    OUTPUT_NODE = True

    def generate_pose_image(self, pose_json="", pose_image="", unique_id=0):
        # If we have a base64 pose image, decode it into a tensor
        if pose_image:
            try:
                tensor = _base64_to_image_tensor(pose_image)
                return {
                    "result": (tensor,),
                    "ui": {"pose_image": [pose_image]},
                }
            except Exception as e:
                print(f"[Steaked OpenPose] Error decoding pose image: {e}")

        # Fallback: generate a blank black image (512x768)
        blank = torch.zeros(1, 768, 512, 3, dtype=torch.float32)
        return {
            "result": (blank,),
        }

    @classmethod
    def IS_CHANGED(cls, pose_json="", pose_image="", unique_id=0):
        # Re-execute whenever the pose image changes
        return float("nan")

    @classmethod
    def VALIDATE_INPUTS(cls, pose_json="", pose_image=""):
        return True
