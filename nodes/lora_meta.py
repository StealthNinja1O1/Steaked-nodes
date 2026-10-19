"""
REST api for lora metadata and combos

Provides:
  - Local safetensors header parsing
  - Shared combos with folders, saved to library/lora_combos.json.

Civitai fetching reuses the existing /steaked/library/lora/* routes from
character_library.py
"""

import asyncio
import json
import os
import struct
import uuid
from pathlib import Path

import aiohttp
from aiohttp import web

import folder_paths
from server import PromptServer

routes = PromptServer.instance.routes

COMBOS_PATH = Path(__file__).parent.parent / "library" / "lora_combos.json"


def _read_combos():
    if not COMBOS_PATH.exists():
        return {"folders": []}
    try:
        with open(COMBOS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("folders"), list):
            return data
    except Exception:
        pass
    return {"folders": []}


def _write_combos(data):
    COMBOS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = COMBOS_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, COMBOS_PATH)


@routes.get("/steaked/lora/combos")
async def combos_get(request):
    return web.json_response(_read_combos())


@routes.post("/steaked/lora/combos")
async def combos_post(request):
    """Replace the whole combos document. Frontend is the source of truth for edits."""
    try:
        data = await request.json()
        if not isinstance(data, dict) or not isinstance(data.get("folders"), list):
            return web.json_response({"error": "Expected {folders: [...]}"}, status=400)
        for folder in data["folders"]:
            if not isinstance(folder, dict):
                return web.json_response({"error": "Bad folder entry"}, status=400)
            folder.setdefault("id", uuid.uuid4().hex[:8])
            for combo in folder.get("combos", []):
                if isinstance(combo, dict):
                    combo.setdefault("id", uuid.uuid4().hex[:8])
        _write_combos(data)
        return web.json_response(_read_combos())
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


def _parse_safetensors_metadata(path):
    """
    Read the JSON header from a .safetensors file.
    Returns the __metadata__ dict with values JSON-decoded when possible
    (kohya writes each value as a JSON-encoded string).
    """
    with open(path, "rb") as f:
        size_bytes = f.read(8)
        if len(size_bytes) < 8:
            raise ValueError("File too small to be safetensors")
        (header_size,) = struct.unpack("<Q", size_bytes)
        if header_size <= 0 or header_size > 100 * 1024 * 1024:
            raise ValueError("Implausible safetensors header size")
        header_raw = f.read(header_size)
    header = json.loads(header_raw.decode("utf-8"))
    meta = header.get("__metadata__") or {}

    decoded = {}
    for key, value in meta.items():
        if isinstance(value, str):
            try:
                decoded[key] = json.loads(value)
            except ValueError:
                decoded[key] = value
        else:
            decoded[key] = value
    return decoded


@routes.get("/steaked/lora/local-info/{lora_name:.*}")
async def lora_local_info(request):
    lora_name = request.match_info["lora_name"]
    lora_path = folder_paths.get_full_path("loras", lora_name)
    if lora_path is None:
        return web.json_response({"error": "LoRA not found"}, status=404)

    info = {"name": lora_name, "metadata": {}}
    try:
        loop = asyncio.get_event_loop()
        info["metadata"] = await loop.run_in_executor(
            None, _parse_safetensors_metadata, lora_path
        )
    except Exception as e:
        info["error"] = f"Could not read safetensors header: {e}"

    civitai = {}
    for ext in (".civitai.info", ".info"):
        sidecar = lora_path + ext
        if os.path.exists(sidecar):
            try:
                with open(sidecar, "r", encoding="utf-8") as f:
                    civitai = json.load(f)
                break
            except Exception:
                pass
    info["civitai"] = civitai
    return web.json_response(info)
