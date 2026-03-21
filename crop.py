import os
import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence
import hashlib
import folder_paths
import node_helpers

# ── REST API routes ─────────────────────────────────────────────────────────────
from server import PromptServer
from aiohttp import web

routes = PromptServer.instance.routes

@routes.get("/steaked/crop/input_images")
async def crop_input_images(request):
    """List all images in the input directory with metadata."""
    try:
        input_dir = folder_paths.get_input_directory()
        files = [
            f
            for f in os.listdir(input_dir)
            if os.path.isfile(os.path.join(input_dir, f))
        ]
        files = folder_paths.filter_files_content_types(files, ["image"])

        images = []
        for filename in sorted(files):
            filepath = os.path.join(input_dir, filename)
            stat = os.stat(filepath)

            # Parse subfolder if present
            subfolder = ""
            display_name = filename
            if os.path.sep in filename:
                parts = filename.split(os.path.sep)
                subfolder = os.path.sep.join(parts[:-1])
                display_name = parts[-1]

            images.append({
                "filename": filename,
                "display_name": display_name,
                "subfolder": subfolder,
                "size": stat.st_size,
                "modified": stat.st_mtime,
                "url": f"/view?filename={filename}&type=input&subfolder={subfolder}"
            })

        return web.json_response({"images": images})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/steaked/crop/output_images")
async def crop_output_images(request):
    """List all images in the output directory with metadata."""
    try:
        output_dir = folder_paths.get_output_directory()
        files = [
            f
            for f in os.listdir(output_dir)
            if os.path.isfile(os.path.join(output_dir, f))
        ]
        files = folder_paths.filter_files_content_types(files, ["image"])

        images = []
        for filename in sorted(files):
            filepath = os.path.join(output_dir, filename)
            stat = os.stat(filepath)

            # Parse subfolder if present
            subfolder = ""
            display_name = filename
            if os.path.sep in filename:
                parts = filename.split(os.path.sep)
                subfolder = os.path.sep.join(parts[:-1])
                display_name = parts[-1]

            images.append({
                "filename": filename,
                "display_name": display_name,
                "subfolder": subfolder,
                "size": stat.st_size,
                "modified": stat.st_mtime,
                "url": f"/view?filename={filename}&type=output&subfolder={subfolder}"
            })

        return web.json_response({"images": images})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


class ImageCrop:
    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [
            f
            for f in os.listdir(input_dir)
            if os.path.isfile(os.path.join(input_dir, f))
        ]
        files = folder_paths.filter_files_content_types(files, ["image"])
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
            },
            "hidden": {
                "crop_data": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT", "INT", "INT")
    RETURN_NAMES = ("image", "x", "y", "width", "height")
    FUNCTION = "load_and_crop"
    CATEGORY = "Steaked-nodes/tools"

    def load_and_crop(self, image, crop_data=""):
        # Parse folder type from filename (format: "folder_type:filename" or just "filename")
        folder_type = "input"
        filename = image
        if ":" in image:
            folder_type, filename = image.split(":", 1)

        # Get the appropriate filepath based on folder type
        if folder_type == "output":
            # For output folder, construct the path manually
            output_dir = folder_paths.get_output_directory()
            image_path = os.path.join(output_dir, filename)
        else:
            # For input folder (default), use the standard method
            image_path = folder_paths.get_annotated_filepath(filename)

        img = node_helpers.pillow(Image.open, image_path)

        output_images = []
        output_masks = []
        w, h = None, None

        excluded_formats = ["MPO"]

        for i in ImageSequence.Iterator(img):
            i = node_helpers.pillow(ImageOps.exif_transpose, i)

            if i.mode == "I":
                i = i.point(lambda i: i * (1 / 255))
            image_converted = i.convert("RGB")

            if len(output_images) == 0:
                w = image_converted.size[0]
                h = image_converted.size[1]

            if image_converted.size[0] != w or image_converted.size[1] != h:
                continue

            image_np = np.array(image_converted).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_np)[None,]
            if "A" in i.getbands():
                mask = np.array(i.getchannel("A")).astype(np.float32) / 255.0
                mask = 1.0 - torch.from_numpy(mask)
            elif i.mode == "P" and "transparency" in i.info:
                mask = (
                    np.array(i.convert("RGBA").getchannel("A")).astype(np.float32)
                    / 255.0
                )
                mask = 1.0 - torch.from_numpy(mask)
            else:
                mask = torch.zeros((64, 64), dtype=torch.float32, device="cpu")
            output_images.append(image_tensor)
            output_masks.append(mask.unsqueeze(0))

        if len(output_images) > 1 and img.format not in excluded_formats:
            output_image = torch.cat(output_images, dim=0)
            output_mask = torch.cat(output_masks, dim=0)
        else:
            output_image = output_images[0]
            output_mask = output_masks[0]

        # Parse crop data - support both old and new format, plus folder type
        x, y, width, height = 0, 0, output_image.shape[2], output_image.shape[1]

        if crop_data:
            try:
                import json

                crop_info = json.loads(crop_data)

                # Support new format (cropX, cropY, cropWidth, cropHeight) and old format (x, y, width, height)
                x = int(crop_info.get("cropX", crop_info.get("x", 0)))
                y = int(crop_info.get("cropY", crop_info.get("y", 0)))
                width = int(crop_info.get("cropWidth", crop_info.get("width", output_image.shape[2])))
                height = int(crop_info.get("cropHeight", crop_info.get("height", output_image.shape[1])))

                img_height, img_width = output_image.shape[1], output_image.shape[2]
                x = max(0, min(x, img_width - 1))
                y = max(0, min(y, img_height - 1))
                width = max(1, min(width, img_width - x))
                height = max(1, min(height, img_height - y))

                # Apply crop
                output_image = output_image[:, y : y + height, x : x + width, :]

            except Exception as e:
                print(f"Error parsing crop data: {e}")
                # Fall back to no crop
                pass

        return (output_image, x, y, width, height)

    @classmethod
    def IS_CHANGED(cls, image, crop_data=""):
        # Parse folder type from filename
        folder_type = "input"
        filename = image
        if ":" in image:
            folder_type, filename = image.split(":", 1)

        # Get the appropriate filepath based on folder type
        if folder_type == "output":
            output_dir = folder_paths.get_output_directory()
            image_path = os.path.join(output_dir, filename)
        else:
            image_path = folder_paths.get_annotated_filepath(filename)

        m = hashlib.sha256()
        with open(image_path, "rb") as f:
            m.update(f.read())
        # Include crop data in hash so it updates when crop changes
        m.update(crop_data.encode("utf-8"))
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        # Parse folder type from filename
        folder_type = "input"
        filename = image
        if ":" in image:
            folder_type, filename = image.split(":", 1)

        # Validate the file exists
        if folder_type == "output":
            output_dir = folder_paths.get_output_directory()
            image_path = os.path.join(output_dir, filename)
            if not os.path.exists(image_path):
                return "Invalid image file: {}".format(image)
        else:
            if not folder_paths.exists_annotated_filepath(filename):
                return "Invalid image file: {}".format(image)

        return True
