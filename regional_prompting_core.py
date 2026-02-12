"""
Regional Prompting for ComfyUI.

Implements direct regional prompting without text parsing, using structured
inputs (box coordinates, prompt texts) to create conditioning tensors and hooks.

Adapted from comfyui-prompt-control (Apache 2.0 License) and original
attention couple implementations by pamparamm, laksjdjf, and Haoming02.
"""

import itertools
import logging
import math
from typing import Any

import torch
import torch.nn.functional as F

from comfy.hooks import EnumHookScope, HookGroup, TransformerOptionsHook, set_hooks_for_conditioning

log = logging.getLogger("Steaked-nodes")


def get_mask(mask, batch_size, num_tokens, extra_options):
    activations_shape = extra_options["activations_shape"]
    size = activations_shape[-2:]
    num_conds = mask.shape[0]
    mask_downsample = F.interpolate(mask, size=size, mode="nearest")
    mask_downsample_reshaped = mask_downsample.view(num_conds, num_tokens, 1).repeat_interleave(batch_size, dim=0)
    return mask_downsample_reshaped


class Proxy:
    def __init__(self, function):
        self.function = function

    def to(self, *args, **kwargs):
        self.function.__self__.to(*args, **kwargs)
        return self

    def __call__(self, *args, **kwargs):
        return self.function(*args, **kwargs)


class AttentionCoupleHook(TransformerOptionsHook):
    COND_UNCOND_COUPLE_OPTION = "cond_or_uncond_hook_couple"
    COND = 0
    UNCOND = 1

    def __init__(self):
        super().__init__(hook_scope=EnumHookScope.HookedOnly)
        self.transformers_dict = {
            "patches": {
                "attn2_output_patch": [Proxy(self.attn2_output_patch)],
                "attn2_patch": [Proxy(self.attn2_patch)],
            }
        }
        self.has_negpip = False
        self.kv = {"k": None, "v": None}
        self.model_sampling = None

    def initialize_regions(self, base_cond, conds, fill=True):
        self.num_conds = len(conds) + 1
        self.base_strength = base_cond[1].get("strength", 1.0)
        self.strengths = [cond[1].get("strength", 1.0) for cond in conds]
        self.start_percent = [0.0] + [cond[1].get("start_percent", 0.0) for cond in conds]
        self.end_percent = [1.0] + [cond[1].get("end_percent", 1.0) for cond in conds]
        self.conds: list[torch.Tensor] = [base_cond[0]] + [cond[0] for cond in conds]
        base_mask = base_cond[1].get("mask", None)
        masks = [cond[1].get("mask") * cond[1].get("mask_strength") for cond in conds]

        if len(masks) < 1:
            raise ValueError("Attention Couple hook makes no sense without masked conds")
        if any(m is None for m in masks):
            raise ValueError("All conds given to Attention Couple must have masks")

        if any(m.shape != masks[0].shape for m in masks) or (
            base_mask is not None and base_mask.shape != masks[0].shape
        ):
            largest_shape = max(m.shape for m in masks)
            if base_mask is not None:
                largest_shape = max(largest_shape, base_mask.shape)
            log.warning("Attention Couple: Masks are irregularly shaped, resizing them all to match the largest")
            for i in range(len(masks)):
                masks[i] = F.interpolate(masks[i].unsqueeze(1), size=largest_shape[1:], mode="nearest-exact").squeeze(1)
            if base_mask is not None:
                base_mask = F.interpolate(base_mask.unsqueeze(1), size=largest_shape[1:], mode="nearest-exact").squeeze(1)

        if base_mask is None:
            sum = torch.stack(masks, dim=0).sum(dim=0)
            base_mask = torch.zeros_like(sum)
            base_mask[sum <= 0] = 1.0

        mask = [base_mask] + masks
        mask = torch.stack(mask, dim=0)
        self.mask = mask / mask.sum(dim=0, keepdim=True)

    def on_apply_hooks(self, model, transformer_options: dict[str, Any]):
        if self.kv["k"] is None:
            self.has_negpip = model.model_options.get("ppm_negpip", False)
            self.model_sampling = model.model.model_sampling
            log.debug("AttentionCouple has_negpip=%s", self.has_negpip)

            if self.has_negpip:
                self.kv["k"] = [cond[:, 0::2] for cond in self.conds[1:]]
                self.kv["v"] = [cond[:, 1::2] for cond in self.conds[1:]]
            else:
                self.kv["k"] = self.kv["v"] = self.conds[1:]

        return super().on_apply_hooks(model, transformer_options)

    def clone(self):
        c: AttentionCoupleHook = super().clone()
        c.mask = self.mask
        c.conds = self.conds
        c.kv = self.kv
        c.has_negpip = self.has_negpip
        c.base_strength = self.base_strength
        c.strengths = self.strengths
        c.start_percent = self.start_percent
        c.end_percent = self.end_percent
        c.num_conds = self.num_conds
        c.model_sampling = self.model_sampling
        return c

    def to(self, *args, **kwargs):
        self.conds = [c.to(*args, **kwargs) for c in self.conds]
        self.mask = self.mask.to(*args, **kwargs)
        if self.kv["k"] is not None:
            self.kv["k"] = [c.to(*args, **kwargs) for c in self.kv["k"]]
            self.kv["v"] = [c.to(*args, **kwargs) for c in self.kv["v"]]
        return self

    def attn2_patch(self, q: torch.Tensor, k: torch.Tensor, v: torch.Tensor, extra_options):
        cond_or_uncond = extra_options["cond_or_uncond"]
        cond_or_uncond_couple = extra_options[self.COND_UNCOND_COUPLE_OPTION] = list(cond_or_uncond)
        num_chunks = len(cond_or_uncond)

        if self.kv["k"][0].device != k.device:
            self.to(k)

        conds_k = self.kv["k"]
        conds_v = self.kv["v"]

        lcm_tokens_k = math.lcm(k.shape[1], *(cond.shape[1] for cond in conds_k))
        lcm_tokens_v = math.lcm(v.shape[1], *(cond.shape[1] for cond in conds_v))
        q_chunks = q.chunk(num_chunks, dim=0)
        k_chunks = k.chunk(num_chunks, dim=0)
        v_chunks = v.chunk(num_chunks, dim=0)

        bs = q.shape[0] // num_chunks

        conds_k_tensor = conds_v_tensor = torch.cat(
            [cond.repeat(bs, lcm_tokens_k // cond.shape[1], 1) * self.strengths[i] for i, cond in enumerate(conds_k)],
            dim=0,
        )
        if self.has_negpip:
            conds_v_tensor = torch.cat(
                [
                    cond.repeat(bs, lcm_tokens_v // cond.shape[1], 1) * self.strengths[i]
                    for i, cond in enumerate(conds_v)
                ],
                dim=0,
            )

        qs, ks, vs = [], [], []
        cond_or_uncond_couple.clear()

        for i, cond_type in enumerate(cond_or_uncond):
            q_target = q_chunks[i]
            k_target = k_chunks[i].repeat(1, lcm_tokens_k // k.shape[1], 1)
            v_target = v_chunks[i].repeat(1, lcm_tokens_v // v.shape[1], 1)
            if cond_type == self.UNCOND:
                qs.append(q_target)
                ks.append(k_target)
                vs.append(v_target)
                cond_or_uncond_couple.append(self.UNCOND)
            else:
                qs.append(q_target.repeat(self.num_conds, 1, 1))
                ks.append(torch.cat([k_target * self.base_strength, conds_k_tensor], dim=0))
                vs.append(torch.cat([v_target * self.base_strength, conds_v_tensor], dim=0))
                cond_or_uncond_couple.extend(itertools.repeat(self.COND, self.num_conds))

        return torch.cat(qs, dim=0), torch.cat(ks, dim=0), torch.cat(vs, dim=0)

    def attn2_output_patch(self, out, extra_options):
        cond_or_uncond = extra_options[self.COND_UNCOND_COUPLE_OPTION]
        bs = out.shape[0] // len(cond_or_uncond)

        current_sigma = extra_options.get("sigmas")
        if current_sigma is not None and self.model_sampling is not None:
            if isinstance(current_sigma, torch.Tensor):
                current_sigma = current_sigma[0].item()
            elif hasattr(current_sigma, 'item'):
                current_sigma = current_sigma.item()
            sigma_timestep = self.model_sampling.timestep(torch.tensor(current_sigma))
            if hasattr(sigma_timestep, 'item'):
                sigma_timestep = sigma_timestep.item()
            current_percent = 1.0 - (sigma_timestep / 999.0)
            current_percent = max(0.0, min(1.0, current_percent))
        else:
            current_percent = 0.5

        mask_with_timestep = self.mask.clone()
        for i in range(self.num_conds):
            start = self.start_percent[i]
            end = self.end_percent[i]
            if current_percent < start or current_percent > end:
                mask_with_timestep[i] = 0.0

        mask_downsample = get_mask(mask_with_timestep, bs, out.shape[1], extra_options)
        outputs = []
        cond_outputs = []
        i_cond = 0
        for i, cond_type in enumerate(cond_or_uncond):
            pos, next_pos = i * bs, (i + 1) * bs

            if cond_type == self.UNCOND:
                outputs.append(out[pos:next_pos])
            else:
                pos_cond, next_pos_cond = i_cond * bs, (i_cond + 1) * bs
                masked_output = out[pos:next_pos] * mask_downsample[pos_cond:next_pos_cond]
                cond_outputs.append(masked_output)
                i_cond += 1

        if len(cond_outputs) > 0:
            cond_output = torch.stack(cond_outputs).sum(0)
            outputs.append(cond_output)

        return torch.cat(outputs, dim=0)


def set_cond_attnmask(base_cond, extra_conds, fill=False):
    hook = AttentionCoupleHook()
    c = [base_cond[0][0], base_cond[0][1].copy()]
    c[1].pop("mask", None)
    c[1].pop("strength", None)
    c[1].pop("mask_strength", None)
    c = [c]
    c.extend(base_cond[1:])

    hook.initialize_regions(base_cond[0], extra_conds, fill=fill)
    group = HookGroup()
    group.add(hook)

    return set_hooks_for_conditioning(c, hooks=group, append_hooks=True)


def ensure_mask(c, mask_size=(512, 512)):
    if "mask" not in c[1]:
        mask = torch.full((1, mask_size[1], mask_size[0]), 0, dtype=torch.float32, device="cpu")
        c[1]["mask"] = mask
        c[1]["mask_strength"] = 1.0
    return c


class RegionalPromptData:
    def __init__(self, prompt_text: str, x: float = 0, y: float = 0, w: float = 0, h: float = 0,
                 weight: float = 1.0, start: float = 0.0, end: float = 1.0,
                 corners: list = None, locked: bool = True):
        self.prompt_text = prompt_text
        self.locked = locked
        self.corners = corners  # [(x1,y1), (x2,y2), (x3,y3), (x4,y4)] TL, TR, BR, BL
        
        if corners and len(corners) == 4:
            # Calculate bounding box from corners for compatibility
            xs = [c[0] for c in corners]
            ys = [c[1] for c in corners]
            self.x = min(xs)
            self.y = min(ys)
            self.w = max(xs) - min(xs)
            self.h = max(ys) - min(ys)
        else:
            # Use provided rectangle
            self.x = x
            self.y = y
            self.w = w
            self.h = h
            # Generate corners from rectangle if not provided
            if not corners:
                self.corners = [
                    [x, y],           # TL
                    [x + w, y],       # TR
                    [x + w, y + h],   # BR
                    [x, y + h]        # BL
                ]
        
        self.weight = weight
        self.start = start
        self.end = end


def create_mask_from_polygon(corners, image_width, image_height, weight, mask_size):
    """Create mask from arbitrary quadrilateral defined by 4 corners."""
    from PIL import Image, ImageDraw
    import numpy as np
    
    mask_w, mask_h = mask_size
    
    # Scale corners to mask size
    scaled_corners = [
        (int(x * mask_w / image_width), int(y * mask_h / image_height))
        for x, y in corners
    ]
    
    # Clamp to mask bounds
    scaled_corners = [
        (max(0, min(x, mask_w - 1)), max(0, min(y, mask_h - 1)))
        for x, y in scaled_corners
    ]
    
    # Use PIL to rasterize polygon
    img = Image.new('L', (mask_w, mask_h), 0)
    ImageDraw.Draw(img).polygon(scaled_corners, fill=int(weight * 255))
    
    # Convert to torch tensor
    mask_array = np.array(img).astype(np.float32) / 255.0
    mask = torch.from_numpy(mask_array)
    mask = mask.unsqueeze(0)
    
    return mask


def create_mask_from_region(x, y, w, h, image_width, image_height, weight, mask_size):
    """Create mask from rectangular region (backward compatibility)."""
    mask_w, mask_h = mask_size

    x1 = int(x * mask_w / image_width)
    y1 = int(y * mask_h / image_height)
    x2 = int((x + w) * mask_w / image_width)
    y2 = int((y + h) * mask_h / image_height)

    x1 = max(0, min(x1, mask_w))
    x2 = max(0, min(x2, mask_w))
    y1 = max(0, min(y1, mask_h))
    y2 = max(0, min(y2, mask_h))

    mask = torch.full((mask_h, mask_w), 0.0, dtype=torch.float32, device="cpu")
    mask[y1:y2, x1:x2] = weight
    mask = mask.unsqueeze(0)

    return mask


def encode_regional_prompts_direct(
    clip,
    base_prompt: str,
    regional_prompts: list[RegionalPromptData],
    width: int,
    height: int,
    mask_size: tuple[int, int] = (512, 512),
    use_attention_couple: bool = True,
):
    base_tokens = clip.tokenize(base_prompt)
    base_cond = clip.encode_from_tokens(base_tokens, return_dict=True)

    if not regional_prompts:
        return [[base_cond["cond"], base_cond]]

    if use_attention_couple:
        regional_conds = []

        for region in regional_prompts:
            if not region.prompt_text.strip():
                continue

            # Use polygon mask if corners provided and not locked, otherwise rectangular
            if region.corners and not region.locked:
                mask = create_mask_from_polygon(
                    region.corners,
                    width, height, region.weight, mask_size
                )
            else:
                mask = create_mask_from_region(
                    region.x, region.y, region.w, region.h,
                    width, height, region.weight, mask_size
                )

            tokens = clip.tokenize(region.prompt_text)
            cond = clip.encode_from_tokens(tokens, return_dict=True)

            cond["mask"] = mask
            cond["mask_strength"] = 1.0
            cond["strength"] = region.weight
            cond["start_percent"] = region.start
            cond["end_percent"] = region.end

            regional_conds.append((cond["cond"], cond))

        if regional_conds:
            base_cond_list = [[base_cond["cond"], base_cond.copy()]]
            final_cond = set_cond_attnmask(base_cond_list, regional_conds, fill=True)
            return final_cond

        return [[base_cond["cond"], base_cond]]

    else:
        conds_to_combine = []
        conds_to_combine.append([[base_cond["cond"], base_cond]])

        for region in regional_prompts:
            if not region.prompt_text.strip():
                continue

            # Use polygon mask if corners provided and not locked, otherwise rectangular
            if region.corners and not region.locked:
                mask = create_mask_from_polygon(
                    region.corners,
                    width, height, region.weight, mask_size
                )
            else:
                mask = create_mask_from_region(
                    region.x, region.y, region.w, region.h,
                    width, height, region.weight, mask_size
                )

            tokens = clip.tokenize(region.prompt_text)
            cond = clip.encode_from_tokens(tokens, return_dict=True)

            cond["mask"] = mask
            cond["mask_strength"] = 1.0
            cond["strength"] = region.weight
            cond["start_percent"] = region.start
            cond["end_percent"] = region.end

            conds_to_combine.append([[cond["cond"], cond]])

        result = []
        for cond in conds_to_combine:
            result.extend(cond)

        return result
