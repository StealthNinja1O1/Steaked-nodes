# Steaked Nodes

A collection of custom nodes for [ComfyUI](https://github.com/comfyanonymous/ComfyUI): model and LoRA loading with modern UIs, regional prompting, image processing effects, and library tooling.

## Installation

1. Clone into your ComfyUI `custom_nodes` folder:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/StealthNinja1O1/Steaked-nodes.git
```

2. Restart ComfyUI

Or install via Comfy Manager -> Install via Git URL

## Loaders

### Smart Model Loader (`SmartModelLoader`)

One loader for every model type. Browses `checkpoints` and `diffusion_models` folders together, detects what each file contains from its safetensors header, and outputs `MODEL`, `CLIP`, and `VAE`.

- Combined searchable listing (Anima diffusion models and SDXL checkpoints side by side)
- Detects whether CLIP/VAE are baked in; external overrides shown only when needed
- Optional external CLIP/VAE override pickers (text_encoders / vae folders)
- Weight dtype option (fp8 variants) for diffusion models
- Model info modal with civitai sidecar data when available

### Combo Lora Loader (`ComboLoraLoader`)

A LoRA stack with a full DOM widget UI: drag rows to reorder, scrub strengths with the mouse, multi-select with ctrl/shift, and activation words surfaced automatically.

- **Free tab**: ad-hoc LoRA stack, drop `.safetensors` files straight onto the node
- **Combos**: save stacks as named combos organized in folders, re-use and re-sync them across nodes
- **Activation words**: read from civitai sidecars or safetensors training metadata, exposed as a node output and a copyable badge per row
- **Info modal**: training parameters, tag frequency, civitai data, raw metadata
- Outputs `MODEL`, `CLIP`, and `ACTIVATION_WORDS` (comma-joined string, ready for prompt concat)

## Regional Prompting

### Regional Prompts (`RegionalPromptsLatent` / `RegionalPromptsAttention` + Img2Img and Image Input variants)

Define up to 4 rectangular regions on a canvas, each with its own prompt, weight, and timestep schedule.

- **Latent** variants: standard latent masking, better isolation between regions
- **Attention** variants: attention hooks, faster with more coherent blending. Recommended for most use cases
- Interactive canvas: drag boxes to move, drag edges/corners to resize
- Per-region weight (0.0-2.0) and start/end timesteps
- Overlapping regions are normalized automatically; unmasked areas fall back to the base prompt

## Image Processing

### Load and Crop Image (`LoadAndCrop`)

Load images from the input folder (with subfolder browsing) and crop with adjustable dimensions and position.

### Color Blender (`ColorBlender`)

Color overlay with multiple blend modes, hue/saturation/brightness adjustments, temperature, tint, and vibrance controls.

### Image Distortion (`ImageDistortion`)

12 distortion effects: Wave, Swirl, Kaleidoscope, Pixel Sort, Displacement, Fisheye, Ripple, Twist, Spherize, Glitch, Mosaic, and Warp. Parameters: intensity (0-100), frequency (0-100), offset x/y.

### Edge Detection (`EdgeDetection`)

Edge detection with Sobel, Prewitt, Scharr, Roberts, Laplacian, and Canny algorithms. Adjustable threshold, thickness, edge/background colors, invert.

### Image Blender (`ImageBlender`)

Blend two images with 14 professional blend modes (Normal, Multiply, Screen, Overlay, Soft Light, Hard Light, Color Dodge, Color Burn, Darken, Lighten, Difference, Exclusion, Add, Subtract) with opacity and optional mask.

### Halftone Effect (`HalftoneEffect`)

Retro printing and dithering effects: Halftone Dots, Halftone Lines, Bayer Dithering, Floyd-Steinberg, Ordered Dithering, Newspaper, Crosshatch.

### Nebula Generator (`NebulaGenerator`)

Procedural nebula/texture generation.

### Scale to Megapixels (`ImageScaleToMegapixels` / `ImageScaleToMegapixelsAdvanced`)

Scale to a target megapixel count while snapping dimensions to multiples (64 for SDXL, 8 for SD1.5) to avoid generation artifacts.

## Utility

### Prompt Library (`SteakedLibrary`)

Prompt and character library with civitai integration: browse your lora collection, fetch civitai metadata and images, and store prompts/characters in a shared library. Booru tag proxy included for tag lookup and autocomplete.

### Save Image to Library (`SaveImageToLibrary`)

Save generated images into the library for later reference.

### Text Concat (`SteakedTextConcat`)

Concatenate text inputs with a configurable separator.

### Any Switch (`AnySwitch`)

Pass through the first connected input of any type.

### OpenPose Editor (`OpenPoseEditor`)

Edit OpenPose skeletons directly in the node.

### Get Image from URL (`GetImageFromURL`)

Load an image from a URL with referer support (for sites that block hotlinking).

## License

MIT
