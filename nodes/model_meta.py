"""
REST api + model detection for the Smart Model Loader.

Provides:
  - Combined listing of checkpoints + diffusion_models folders
  - safetensors header sniffing to detect what's inside each file
"""

import asyncio
import hashlib
import json
import os
import struct
from pathlib import Path

import aiohttp
from aiohttp import web

import folder_paths
from server import PromptServer

from .lora_meta import _parse_safetensors_metadata

routes = PromptServer.instance.routes

MODEL_FOLDERS = ["checkpoints", "diffusion_models"]
VAE_FOLDERS = ["vae", "vae_approx"]


def _read_header_keys(path):
    """Read just the raw key names from a safetensors header (no metadata decoding)."""
    with open(path, "rb") as f:
        size_bytes = f.read(8)
        if len(size_bytes) < 8:
            raise ValueError("File too small to be safetensors")
        (header_size,) = struct.unpack("<Q", size_bytes)
        if header_size <= 0 or header_size > 100 * 1024 * 1024:
            raise ValueError("Implausible safetensors header size")
        header = json.loads(f.read(header_size).decode("utf-8"))
    return set(k for k in header.keys() if k != "__metadata__")


def _classify(keys):
    """Classify a safetensors file from its tensor key names."""
    def has_prefix(prefixes):
        return any(k.startswith(p) for k in keys for p in prefixes)

    has_unet = has_prefix((
        "model.diffusion_model.",
        "diffusion_model.",
        "model.",            # sd1.5/sdxl/illustrious unet keys: model.input_blocks...
    ))
    has_clip = has_prefix((
        "conditioner.embedders.",   # sdxl/illustrious
        "clip_l.",
        "clip_g.",
        "text_encoders.",           # flux all-in-one
        "llm.",
        "t5.",
        "text_encoder.",
    ))
    has_vae = has_prefix((
        "first_stage_model.",       # sd1.5/sdxl/illustrious
        "vae.",
    ))
    if has_unet and has_clip and has_vae:
        return "checkpoint"
    if has_unet:
        # diffusion model; note if clip/vae ride along
        parts = []
        if has_clip:
            parts.append("clip")
        if has_vae:
            parts.append("vae")
        return "diffusion" + ("+" + "+".join(parts) if parts else "")
    return "unknown"


def _model_info(name, folder_type, path):
    """Build the info dict for one model file."""
    info = {
        "name": name,
        "folder": folder_type,
        "type": "unknown",
        "has_clip": False,
        "has_vae": False,
        "metadata": {},
    }
    try:
        keys = _read_header_keys(path)
        kind = _classify(keys)
        info["type"] = kind
        info["has_clip"] = "clip" in kind or kind == "checkpoint"
        info["has_vae"] = "vae" in kind or kind == "checkpoint"
    except Exception:
        # assume full checkpoint
        info["type"] = "checkpoint"
        info["has_clip"] = True
        info["has_vae"] = True
    try:
        info["metadata"] = _parse_safetensors_metadata(path)
    except Exception:
        pass
    for suffix in (".civitai.info", ".cminfo.json"):
        sidecar = path + suffix
        if os.path.exists(sidecar):
            try:
                with open(sidecar, "r", encoding="utf-8") as f:
                    info["civitai"] = json.load(f)
                break
            except Exception:
                pass
    return info


@routes.get("/steaked/model/list")
async def model_list(request):
    """List all models across checkpoints + diffusion_models folders."""
    models = []

    def scan(folder_type):
        try:
            names = folder_paths.get_filename_list(folder_type)
        except Exception:
            return
        for name in names:
            path = folder_paths.get_full_path(folder_type, name)
            if path is None:
                continue
            models.append(_model_info(name, folder_type, path))

    loop = asyncio.get_event_loop()
    for folder_type in MODEL_FOLDERS:
        await loop.run_in_executor(None, scan, folder_type)
    models.sort(key=lambda m: m["name"].lower())
    return web.json_response({"models": models})


@routes.get("/steaked/model/vaes")
async def model_vaes(request):
    """List standalone VAE files (vae folder only, not approx embeddings)."""
    try:
        vaes = folder_paths.get_filename_list("vae")
    except Exception:
        vaes = []
    return web.json_response(vaes)


@routes.get("/steaked/model/clips")
async def model_clips(request):
    """List standalone text encoders."""
    try:
        clips = folder_paths.get_filename_list("text_encoders")
    except Exception:
        clips = []
    return web.json_response(clips)


def _compute_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


@routes.post("/steaked/model/fetch-civitai")
async def model_fetch_civitai(request):
    """Fetch model info from Civitai by file hash, save as .civitai.info sidecar."""
    try:
        body = await request.json()
        name = body.get("name", "")
        folder_type = body.get("folder", "checkpoints")
        if folder_type not in MODEL_FOLDERS:
            folder_type = "checkpoints"

        path = folder_paths.get_full_path(folder_type, name)
        if path is None:
            for alt in MODEL_FOLDERS:
                path = folder_paths.get_full_path(alt, name)
                if path is not None:
                    break
        if path is None:
            return web.json_response({"error": "Model not found"}, status=404)

        loop = asyncio.get_event_loop()
        sha256 = await loop.run_in_executor(None, _compute_sha256, path)

        url = f"https://civitai.com/api/v1/model-versions/by-hash/{sha256}"
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 404:
                    return web.json_response(
                        {"error": "Model not found on Civitai"}, status=404
                    )
                resp.raise_for_status()
                info_data = await resp.json()

        sidecar = path + ".civitai.info"
        with open(sidecar, "w", encoding="utf-8") as f:
            json.dump(info_data, f, indent=2, ensure_ascii=False)

        return web.json_response(info_data)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)
