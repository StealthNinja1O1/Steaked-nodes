"""
Smart Model Loader node.

Loads any model from checkpoints or diffusion_models folders, outputs
MODEL + CLIP + VAE
"""

import json

import folder_paths
import torch
import comfy.sd


class SteakedModelLoader:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("STRING", {"default": "{}"}),
            },
            "optional": {
                "clip_name": (
                    ["<from model>"] + folder_paths.get_filename_list("text_encoders"),
                ),
                "vae_name": (
                    ["<from model>"] + folder_paths.get_filename_list("vae"),
                ),
                "weight_dtype": (
                    ["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"],
                ),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE")
    RETURN_NAMES = ("model", "clip", "vae")
    FUNCTION = "load"
    CATEGORY = "Steaked-nodes/loaders"

    def load(self, model, clip_name, vae_name, weight_dtype):
        state = json.loads(model) if isinstance(model, str) and model.strip() else {}
        name = state.get("name", "")
        folder_type = state.get("folder", "checkpoints")
        if not name:
            raise RuntimeError("No model selected")

        path = folder_paths.get_full_path(folder_type, name)
        if path is None:
            for alt in ("checkpoints", "diffusion_models"):
                path = folder_paths.get_full_path(alt, name)
                if path is not None:
                    break
        if path is None:
            raise RuntimeError(f"Model not found: {name}")

        model_options = {}
        if weight_dtype == "fp8_e4m3fn":
            model_options["dtype"] = torch.float8_e4m3fn
        elif weight_dtype == "fp8_e4m3fn_fast":
            model_options["dtype"] = torch.float8_e4m3fn
            model_options["fp8_optimizations"] = True
        elif weight_dtype == "fp8_e5m2":
            model_options["dtype"] = torch.float8_e5m2

        is_checkpoint = state.get("type", "checkpoint") == "checkpoint"
        if not is_checkpoint:
            # Bare diffusion model (Anima, Flux, who knows what else)
            loaded = comfy.sd.load_diffusion_model(path, model_options=model_options)
            out_model = loaded
            out_clip = self._load_clip(clip_name)
            out_vae = self._load_vae(vae_name)
            if out_clip is None:
                raise RuntimeError(
                    f"'{name}' is a bare diffusion model with no CLIP. "
                    "Connect a clip_name override."
                )
            if out_vae is None:
                raise RuntimeError(
                    f"'{name}' is a bare diffusion model with no VAE. "
                    "Connect a vae_name override."
                )
            return (out_model, out_clip, out_vae)

        out = comfy.sd.load_checkpoint_guess_config(
            path,
            output_vae=vae_name == "<from model>",
            output_clip=clip_name == "<from model>",
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
            model_options=model_options,
        )
        out_model = out[0]
        out_clip = out[1] if clip_name == "<from model>" else self._load_clip(clip_name)
        out_vae = out[2] if vae_name == "<from model>" else self._load_vae(vae_name)

        if out_clip is None:
            raise RuntimeError(
                "Checkpoint has no CLIP and no clip_name override selected."
            )
        if out_vae is None:
            raise RuntimeError(
                "Checkpoint has no VAE and no vae_name override selected."
            )
        return (out_model, out_clip, out_vae)

    @staticmethod
    def _load_clip(clip_name):
        if clip_name in (None, "", "<from model>"):
            return None
        path = folder_paths.get_full_path("text_encoders", clip_name)
        if path is None:
            raise RuntimeError(f"CLIP not found: {clip_name}")
        return comfy.sd.load_clip(
            ckpt_paths=[path],
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
        )

    @staticmethod
    def _load_vae(vae_name):
        if vae_name in (None, "", "<from model>"):
            return None
        import comfy.utils

        path = folder_paths.get_full_path("vae", vae_name)
        if path is None:
            raise RuntimeError(f"VAE not found: {vae_name}")
        sd, metadata = comfy.utils.load_torch_file(path, return_metadata=True)
        vae = comfy.sd.VAE(sd=sd, metadata=metadata)
        vae.throw_exception_if_invalid()
        return vae
