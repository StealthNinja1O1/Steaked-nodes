"""
Prompt Library Node
===================
A self-contained generation settings + character/prompt library node.

Outputs: MODEL, CLIP, VAE, style_tags (STRING), base_prompt (STRING), combined (STRING), negative (STRING)
"""

import os
import io
import json
import struct
import zlib
import zipfile
import hashlib
import asyncio
from pathlib import Path
from aiohttp import web
import aiohttp
import folder_paths
import comfy.sd
from server import PromptServer


# ─── Library storage location ─────────────────────────────────────────────────
LIBRARY_DIR = Path(__file__).parent / "library"
LIBRARY_JSON = LIBRARY_DIR / "library.json"

BLANK_LIBRARY = {
    "base": {
        "checkpoint": "",
        "loras": [],
    },
    "characters": [],
}


def _ensure_library_dir():
    LIBRARY_DIR.mkdir(exist_ok=True)


def _read_library() -> dict:
    _ensure_library_dir()
    if not LIBRARY_JSON.exists():
        return BLANK_LIBRARY.copy()
    try:
        with open(LIBRARY_JSON, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return BLANK_LIBRARY.copy()


def _write_library(data: dict):
    _ensure_library_dir()
    with open(LIBRARY_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _apply_loras(model, clip, loras: list):
    """Apply a list of lora dicts [{file, enabled, strength, clip_strength}] to model+clip."""
    from nodes import LoraLoader  # lazy import to avoid module-load failures

    loader = LoraLoader()
    for entry in loras:
        if not entry.get("enabled", True):
            continue
        lora_file = entry.get("file", "")
        if not lora_file:
            continue
        strength = float(entry.get("strength", 1.0))
        clip_strength = float(entry.get("clip_strength", strength))
        # Resolve full path
        lora_path = folder_paths.get_full_path("loras", lora_file)
        if lora_path is None:
            print(f"[SteakedLibrary] LoRA not found: {lora_file}")
            continue
        try:
            model, clip = loader.load_lora(
                model, clip, lora_file, strength, clip_strength
            )
        except Exception as e:
            print(f"[SteakedLibrary] Failed to apply LoRA '{lora_file}': {e}")
    return model, clip


def _read_png_metadata(filepath: str) -> dict:
    """
    Extract tEXt / iTXt chunks from a PNG file.
    Returns a dict of keyword → text pairs.
    ComfyUI stores workflow JSON under key 'workflow' and prompt under 'prompt'.
    """
    result = {}
    try:
        with open(filepath, "rb") as f:
            sig = f.read(8)
            if sig != b"\x89PNG\r\n\x1a\n":
                return result
            while True:
                header = f.read(8)
                if len(header) < 8:
                    break
                length = struct.unpack(">I", header[:4])[0]
                chunk_type = header[4:8].decode("latin-1")
                data = f.read(length)
                f.read(4)  # CRC
                if chunk_type == "tEXt":
                    try:
                        parts = data.split(b"\x00", 1)
                        if len(parts) == 2:
                            key = parts[0].decode("latin-1")
                            value = parts[1].decode("latin-1")
                            result[key] = value
                    except Exception:
                        pass
                elif chunk_type == "iTXt":
                    try:
                        # null-sep: keyword \0 compression_flag \0 compression_method \0 language \0 translated \0 text
                        parts = data.split(b"\x00", 5)
                        if len(parts) >= 6:
                            key = parts[0].decode("latin-1")
                            compression_flag = parts[1][0] if parts[1] else 0
                            text_bytes = parts[5]
                            if compression_flag:
                                text_bytes = zlib.decompress(text_bytes)
                            result[key] = text_bytes.decode("utf-8", errors="replace")
                    except Exception:
                        pass
                elif chunk_type == "IEND":
                    break
    except Exception as e:
        print(f"[SteakedLibrary] PNG metadata read error: {e}")
    return result


# ─── Node class ───────────────────────────────────────────────────────────────


class SteakedLibrary:
    """
    Generation settings library + character selector.
    Loads a checkpoint (with LoRAs), outputs MODEL/CLIP/VAE and character prompt strings.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "selected_character": ("STRING", {"default": ""}),
                # Snapshot blob — written by the JS widget so model, LoRAs, and all
                # prompt strings appear verbatim in ComfyUI’s PNG workflow metadata.
                # JSON keys: char_name, model, loras, style_tags, base_prompt, combined, negative
                "snap_data": ("STRING", {"default": ""}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = (
        "model",
        "clip",
        "vae",
        "style_tags",
        "base_prompt",
        "combined",
        "negative",
    )
    FUNCTION = "execute"
    CATEGORY = "Steaked-nodes/tools"
    DESCRIPTION = "Prompt & character library. Outputs a model with LoRAs applied and character-specific prompt strings."

    def execute(self, selected_character="", unique_id=None, snap_data=""):
        # snap_data is metadata-only — its value is recorded in ComfyUI’s
        # PNG prompt metadata by the JS widget; we don’t use it here.
        library = _read_library()
        base = library.get("base", {})

        # Find selected character data
        char_data = None
        if selected_character:
            for c in library.get("characters", []):
                if c.get("id") == selected_character:
                    char_data = c
                    break

        # Resolve which checkpoint to use
        override = char_data.get("model_override", {}) if char_data else {}
        use_override = override.get("enabled", False) and override.get("checkpoint", "")

        ckpt_name = (
            override["checkpoint"] if use_override else base.get("checkpoint", "")
        )

        if not ckpt_name:
            print("[SteakedLibrary] No checkpoint configured.")
            return (None, None, None, "", "", "", "")

        ckpt_path = folder_paths.get_full_path("checkpoints", ckpt_name)
        if ckpt_path is None:
            print(f"[SteakedLibrary] Checkpoint not found: {ckpt_name}")
            return (None, None, None, "", "", "", "")

        out = comfy.sd.load_checkpoint_guess_config(
            ckpt_path,
            output_vae=True,
            output_clip=True,
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
        )
        model, clip, vae = out[0], out[1], out[2]

        # Apply loras: base first, then character overrides (or character additions)
        if use_override:
            # Override: base loras skipped, only character loras
            model, clip = _apply_loras(model, clip, override.get("loras", []))
        else:
            # Base loras always applied
            model, clip = _apply_loras(model, clip, base.get("loras", []))
            # Then character-specific additional loras (no checkpoint override)
            if char_data:
                char_loras = char_data.get("model_override", {}).get("loras", [])
                model, clip = _apply_loras(model, clip, char_loras)

        # Prompt strings
        style_tags = ""
        base_prompt = ""
        negative = ""
        text_blocks = []
        if char_data:
            style_tags = char_data.get("style_tags", "")
            base_prompt = char_data.get("base_prompt", "")
            negative = char_data.get("negative", "")
            text_blocks = char_data.get("text_blocks", [])

        def _clean(s):
            """Collapse newlines and extra whitespace for prompt concatenation."""
            return " ".join(s.replace("\n", " ").split())

        block_texts = [
            _clean(b.get("text", ""))
            for b in text_blocks
            if b.get("enabled", True) and b.get("text", "").strip()
        ]
        parts = [
            p for p in [_clean(style_tags), _clean(base_prompt)] + block_texts if p
        ]
        combined = ", ".join(parts)

        return (model, clip, vae, style_tags, base_prompt, combined, negative)

    @classmethod
    def IS_CHANGED(cls, selected_character="", unique_id=None, snap_data=""):
        mtime = 0.0
        if LIBRARY_JSON.exists():
            mtime = LIBRARY_JSON.stat().st_mtime
        return f"{mtime}:{selected_character}"


# ─── REST API routes ──────────────────────────────────────────────────────────

routes = PromptServer.instance.routes


@routes.get("/steaked/library/data")
async def library_get(request):
    return web.json_response(_read_library())


@routes.post("/steaked/library/data")
async def library_post(request):
    try:
        data = await request.json()
        _write_library(data)
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@routes.get("/steaked/library/checkpoints")
async def library_checkpoints(request):
    return web.json_response(folder_paths.get_filename_list("checkpoints"))


@routes.get("/steaked/library/loras")
async def library_loras(request):
    return web.json_response(folder_paths.get_filename_list("loras"))


@routes.get("/steaked/library/lora/info/{lora_name}")
async def library_lora_info(request):
    lora_name = request.match_info["lora_name"]
    lora_path = folder_paths.get_full_path("loras", lora_name)
    if lora_path is None:
        return web.json_response({"error": "LoRA not found"}, status=404)
    # Look for .civitai.info or .info sidecar
    info_data = {}
    for ext in [".civitai.info", ".info"]:
        info_path = lora_path + ext
        if os.path.exists(info_path):
            try:
                with open(info_path, "r", encoding="utf-8") as f:
                    info_data = json.load(f)
                break
            except Exception:
                pass
    return web.json_response(info_data)


def _compute_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


@routes.post("/steaked/library/lora/fetch-civitai")
async def library_lora_fetch_civitai(request):
    """Fetch model info from Civitai by file hash and save as .civitai.info sidecar."""
    try:
        body = await request.json()
        lora_name = body.get("lora_name", "")
        lora_path = folder_paths.get_full_path("loras", lora_name)
        if lora_path is None:
            return web.json_response({"error": "LoRA not found"}, status=404)

        info_path = lora_path + ".civitai.info"

        # Compute hash in thread so we don't block the event loop
        loop = asyncio.get_event_loop()
        sha256 = await loop.run_in_executor(None, _compute_sha256, lora_path)

        url = f"https://civitai.com/api/v1/model-versions/by-hash/{sha256}"
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url, timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 404:
                    return web.json_response(
                        {"error": "Model not found on Civitai"}, status=404
                    )
                resp.raise_for_status()
                info_data = await resp.json()

        with open(info_path, "w", encoding="utf-8") as f:
            json.dump(info_data, f, indent=2, ensure_ascii=False)

        return web.json_response(info_data)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.post("/steaked/library/character/{char_id}/image")
async def library_upload_image(request):
    char_id = request.match_info["char_id"]
    try:
        reader = await request.multipart()
        field = await reader.next()
        filename = field.filename or "image.png"
        img_dir = LIBRARY_DIR / char_id / "images"
        img_dir.mkdir(parents=True, exist_ok=True)
        # Avoid collisions
        dest = img_dir / filename
        counter = 0
        while dest.exists():
            counter += 1
            stem, suffix = os.path.splitext(filename)
            dest = img_dir / f"{stem}_{counter}{suffix}"
        with open(dest, "wb") as f:
            while True:
                chunk = await field.read_chunk()
                if not chunk:
                    break
                f.write(chunk)
        return web.json_response({"success": True, "filename": dest.name})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@routes.get("/steaked/library/character/{char_id}/image/{filename}")
async def library_serve_image(request):
    char_id = request.match_info["char_id"]
    filename = request.match_info["filename"]
    img_path = LIBRARY_DIR / char_id / "images" / filename
    if not img_path.exists():
        raise web.HTTPNotFound()
    return web.FileResponse(img_path)


@routes.delete("/steaked/library/character/{char_id}/image/{filename}")
async def library_delete_image(request):
    char_id = request.match_info["char_id"]
    filename = request.match_info["filename"]
    # Resolve and safety-check path stays inside the library dir
    img_path = (LIBRARY_DIR / char_id / "images" / filename).resolve()
    try:
        library_root = LIBRARY_DIR.resolve()
        if not str(img_path).startswith(str(library_root)):
            raise web.HTTPForbidden()
        if img_path.exists():
            img_path.unlink()
        return web.json_response({"success": True})
    except web.HTTPException:
        raise
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


# ─── ZIP export ──────────────────────────────────────────────────────────────
@routes.get("/steaked/library/export")
async def library_export(request):
    """Build an in-memory ZIP of library.json + every character image, then stream it."""
    try:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            if LIBRARY_JSON.exists():
                zf.write(LIBRARY_JSON, "library.json")
            for char_dir in LIBRARY_DIR.iterdir():
                img_dir = char_dir / "images"
                if img_dir.is_dir():
                    for img_file in img_dir.iterdir():
                        if img_file.is_file():
                            arc_name = f"{char_dir.name}/images/{img_file.name}"
                            zf.write(img_file, arc_name)
        buf.seek(0)
        return web.Response(
            body=buf.read(),
            content_type="application/zip",
            headers={
                "Content-Disposition": 'attachment; filename="steaked_library.zip"'
            },
        )
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


# ─── ZIP import ───────────────────────────────────────────────────────────────
@routes.post("/steaked/library/import")
async def library_import(request):
    """Accept a multipart ZIP upload and merge/replace the library."""
    try:
        mode = request.rel_url.query.get("mode", "merge")  # "merge" | "replace"
        reader = await request.multipart()
        zip_bytes = None
        async for part in reader:
            if part.name == "file":
                zip_bytes = await part.read()
                break
        if not zip_bytes:
            return web.json_response(
                {"success": False, "error": "No file part"}, status=400
            )

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()

            if "library.json" not in names:
                return web.json_response(
                    {"success": False, "error": "ZIP missing library.json"}, status=400
                )

            imported_lib = json.loads(zf.read("library.json"))

            if mode == "replace":
                # Wipe existing library and extract everything
                if LIBRARY_DIR.exists():
                    import shutil

                    shutil.rmtree(LIBRARY_DIR)
                _ensure_library_dir()
                _write_library(imported_lib)
                for name in names:
                    if name == "library.json":
                        continue
                    dest = LIBRARY_DIR / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(zf.read(name))
            else:
                # Merge: add characters whose id doesn't yet exist, skip duplicates
                current = _read_library()
                existing_ids = {c["id"] for c in current.get("characters", [])}
                for ch in imported_lib.get("characters", []):
                    if ch.get("id") not in existing_ids:
                        current.setdefault("characters", []).append(ch)
                        # Extract images for this new character
                        prefix = f"{ch['id']}/images/"
                        for name in names:
                            if name.startswith(prefix):
                                dest = LIBRARY_DIR / name
                                dest.parent.mkdir(parents=True, exist_ok=True)
                                dest.write_bytes(zf.read(name))
                _write_library(current)

        return web.json_response({"success": True, "mode": mode})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@routes.post("/steaked/library/image/metadata")
async def library_image_metadata(request):
    try:
        body = await request.json()
        rel = body.get("filepath", "")
        # Accept absolute paths or paths relative to the library dir
        if os.path.isabs(rel):
            filepath = rel
        else:
            filepath = str(LIBRARY_DIR / rel)
        if not filepath or not os.path.exists(filepath):
            return web.json_response({"error": "File not found"}, status=404)
        meta = _read_png_metadata(filepath)
        # Try to parse ComfyUI workflow and prompt JSON
        parsed = {}
        for key in ("workflow", "prompt", "parameters"):
            if key in meta:
                try:
                    parsed[key] = json.loads(meta[key])
                except Exception:
                    parsed[key] = meta[key]
        return web.json_response({"raw": meta, "parsed": parsed})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)
