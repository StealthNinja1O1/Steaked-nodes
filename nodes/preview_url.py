"""
Download image from URL with referer to bypass hotlink protections
"""
import io
import urllib.request
from urllib.parse import urlparse
import numpy as np
import torch
from PIL import Image


def _derive_referer(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    parts = host.split(".")
    if len(parts) > 2:
        host = ".".join(parts[-2:])
    scheme = parsed.scheme or "https"
    return f"{scheme}://{host}/"


def _fetch_image(url: str, referer: str | None) -> bytes:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
    }
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def _image_to_tensor(img: Image.Image) -> torch.Tensor:
    """Convert a PIL image to a ComfyUI IMAGE tensor (1, H, W, 3) float [0,1]."""
    img = img.convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


class GetImageFromURL:
    """ComfyUI node that downloads an image from a URL for preview / piping."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "url": ("STRING", {"default": "", "multiline": False}),
                "use_referer": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "custom_referer": ("STRING", {"default": "", "multiline": False}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    OUTPUT_NODE = True
    FUNCTION = "load_image"
    CATEGORY = "Steaked"
    DESCRIPTION = "Load an image from a URL. Supports referer-locked sources like Gelbooru."

    def load_image(self, url: str, use_referer: bool, custom_referer: str = ""):
        if not url or not url.strip():
            placeholder = Image.new("RGB", (64, 64), (0, 0, 0))
            return (_image_to_tensor(placeholder),)

        referer: str | None = None
        if use_referer:
            if custom_referer and custom_referer.strip():
                referer = custom_referer.strip()
            else:
                referer = _derive_referer(url)

        data = _fetch_image(url.strip(), referer)
        img = Image.open(io.BytesIO(data))
        return (_image_to_tensor(img),)


NODE_CLASS_MAPPINGS = {
    "GetImageFromURL": GetImageFromURL,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "GetImageFromURL": "Get image from URL (with referer)",
}