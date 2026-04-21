import os
import io
import hashlib
import numpy as np
import torch
from PIL import Image

import folder_paths
import node_helpers

# ── REST API routes ─────────────────────────────────────────────────────────────
from server import PromptServer
from aiohttp import web

routes = PromptServer.instance.routes

_EDITOR_HTML_PATH = os.path.join(os.path.dirname(__file__), "..", "web", "openpose_editor", "index.html")

# Subfolder inside ComfyUI's input directory for pose images
_POSE_SUBFOLDER = "openpose"


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


def _read_pose_image(filename: str) -> torch.Tensor:
    """Read a pose image from the input directory and return as tensor.

    Returns tensor of shape (1, H, W, 3) float32 in [0, 1].
    """
    input_dir = folder_paths.get_input_directory()
    filepath = os.path.join(input_dir, _POSE_SUBFOLDER, filename)

    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Pose image not found: {filepath}")

    pil_img = Image.open(filepath).convert("RGB")
    arr = np.array(pil_img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]  # (1, H, W, 3)


class OpenPoseEditor:
    """ComfyUI node that provides an embedded 3-D OpenPose editor.

    The user clicks *Open Editor* to launch a full-screen modal containing
    the Three.js editor.  When they close it the rendered pose image is
    uploaded to the ComfyUI input directory and exposed as an ``IMAGE``
    output that can be fed directly into a ControlNet *Apply* node.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "image": ("IMAGE",),
            },
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

    def generate_pose_image(self, image=None, pose_json="", pose_image="openpose_pose.png", unique_id=0):
        # `image` is accepted from the optional input but not used in the
        # backend pipeline — it's only consumed by the frontend JS widget
        # for MediaPipe detection inside the browser.

        # `pose_image` stores a filename (uploaded via /upload/image)
        input_dir = folder_paths.get_input_directory()
        print(f"[Steaked OpenPose] generate_pose_image called:")
        print(f"  pose_image='{pose_image}'")
        print(f"  input_dir='{input_dir}'")

        if pose_image:
            filepath = os.path.join(input_dir, _POSE_SUBFOLDER, pose_image)
            print(f"  Looking for file: '{filepath}'")
            print(f"  File exists: {os.path.exists(filepath)}")
            try:
                tensor = _read_pose_image(pose_image)
                print(f"  Loaded pose image: shape={tensor.shape}, min={tensor.min():.3f}, max={tensor.max():.3f}")
                return {
                    "result": (tensor,),
                }
            except Exception as e:
                print(f"  Error reading pose image '{pose_image}': {e}")

        # Fallback: generate a blank black image (512x768)
        print("  No pose image, returning blank")
        blank = torch.zeros(1, 768, 512, 3, dtype=torch.float32)
        return {
            "result": (blank,),
        }

    @classmethod
    def IS_CHANGED(cls, image=None, pose_json="", pose_image="", unique_id=0):
        # Re-execute whenever the pose image changes
        return float("nan")

    @classmethod
    def VALIDATE_INPUTS(cls, image=None, pose_json="", pose_image=""):
        return True
