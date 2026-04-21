import math
import numpy as np
import torch
from typing import Tuple


class ImageDistortion:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "distortion_type": (
                    [
                        "wave",
                        "swirl",
                        "kaleidoscope",
                        "pixelSort",
                        "displacement",
                        "fisheye",
                        "ripple",
                        "twist",
                        "spherize",
                        "glitch",
                        "mosaic",
                        "warp",
                    ],
                    {"default": "wave"},
                ),
                "intensity": (
                    "FLOAT",
                    {"default": 50.0, "min": 0.0, "max": 100.0, "step": 1.0},
                ),
                "frequency": (
                    "FLOAT",
                    {"default": 10.0, "min": 0.0, "max": 100.0, "step": 1.0},
                ),
                "offset_x": (
                    "FLOAT",
                    {"default": 0.0, "min": -50.0, "max": 50.0, "step": 0.1},
                ),
                "offset_y": (
                    "FLOAT",
                    {"default": 0.0, "min": -50.0, "max": 50.0, "step": 0.1},
                ),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply_distortion"
    CATEGORY = "Steaked-nodes/tools"

    def _clamp_img(self, img: np.ndarray) -> np.ndarray:
        return np.clip(img, 0.0, 1.0)

    def apply_distortion(
        self,
        image,
        distortion_type: str,
        intensity: float,
        frequency: float,
        offset_x: float,
        offset_y: float,
    ):
        """Apply selected distortion to an image tensor.

        image: torch tensor in shape (B,H,W,C) with floats in [0,1]
        returns: tuple containing one torch tensor (B,H,W,C)
        """
        if isinstance(image, tuple) or isinstance(image, list):
            image = image[0]

        # Expect tensor (B,H,W,C)
        if not hasattr(image, "shape"):
            raise ValueError("Invalid image input")

        B, H, W, C = image.shape
        if C != 3:
            raise ValueError("ImageDistortion expects RGB images (3 channels)")

        out_images = []

        for b in range(B):
            img = image[b].cpu().numpy().astype(np.float32)

            img = self._clamp_img(img)

            inten = float(intensity) / 100.0
            freq = float(frequency) / 100.0
            offx = float(offset_x) / 100.0 * W  # percentage -> pixels
            offy = float(offset_y) / 100.0 * H

            def sample_pixel(sx: int, sy: int) -> Tuple[float, float, float]:
                sx = int(max(0, min(W - 1, sx)))
                sy = int(max(0, min(H - 1, sy)))
                return img[sy, sx, 0], img[sy, sx, 1], img[sy, sx, 2]

            new_img = np.zeros_like(img)

            if distortion_type == "wave":
                # JS: amplitude = params.intensity * 2; frequency = params.frequency / 100;
                # offsetX = Math.sin(y * frequency) * amplitude
                amplitude = float(intensity) * 2.0
                frequency = float(frequency) / 100.0
                for y in range(H):
                    for x in range(W):
                        offsetX = math.sin(y * frequency) * amplitude
                        offsetY = math.cos(x * frequency) * amplitude
                        sx = int(round(x + offsetX))
                        sy = int(round(y + offsetY))
                        sx = max(0, min(W - 1, sx))
                        sy = max(0, min(H - 1, sy))
                        new_img[y, x] = sample_pixel(sx, sy)

            elif distortion_type == "swirl":
                # JS: centerX = width / 2 + params.offsetX; (offsetX is already in pixels)
                # maxRadius = Math.min(width, height) / 2;
                # strength = params.intensity / 50;
                centerX = W / 2 + float(offset_x)
                centerY = H / 2 + float(offset_y)
                maxRadius = min(W, H) / 2
                strength = float(intensity) / 50.0
                for y in range(H):
                    for x in range(W):
                        dx = x - centerX
                        dy = y - centerY
                        distance = math.hypot(dx, dy)

                        if distance < maxRadius:
                            amount = (maxRadius - distance) / maxRadius * strength
                            angle = math.atan2(dy, dx) + amount
                            sx = int(round(centerX + math.cos(angle) * distance))
                            sy = int(round(centerY + math.sin(angle) * distance))
                            if 0 <= sx < W and 0 <= sy < H:
                                new_img[y, x] = sample_pixel(sx, sy)
                            else:
                                new_img[y, x] = img[y, x]
                        else:
                            new_img[y, x] = img[y, x]

            elif distortion_type == "kaleidoscope":
                # JS: centerX = width / 2; centerY = height / 2; (no offset)
                # segments = Math.max(3, params.segments);
                # Since Python version doesn't have segments param, derive from frequency
                centerX = W / 2
                centerY = H / 2
                segments = max(
                    3, int(3 + freq * 9)
                )  # Scale frequency 0-1 to 3-12 segments
                segmentAngle = (2 * math.pi) / segments
                for y in range(H):
                    for x in range(W):
                        dx = x - centerX
                        dy = y - centerY
                        distance = math.sqrt(dx * dx + dy * dy)
                        angle = math.atan2(dy, dx)

                        if angle < 0:
                            angle += 2 * math.pi

                        segmentIndex = int(angle / segmentAngle)
                        segmentStart = segmentIndex * segmentAngle
                        segmentOffset = angle - segmentStart

                        if segmentIndex % 2 == 0:
                            mirroredOffset = segmentOffset
                        else:
                            mirroredOffset = segmentAngle - segmentOffset
                        newAngle = segmentStart + mirroredOffset

                        sx = int(round(centerX + math.cos(newAngle) * distance))
                        sy = int(round(centerY + math.sin(newAngle) * distance))

                        if 0 <= sx < W and 0 <= sy < H:
                            new_img[y, x] = sample_pixel(sx, sy)
                        else:
                            new_img[y, x] = img[y, x]

            elif distortion_type == "pixelSort":
                sort_len = max(1, int(round(float(frequency))))
                # Start with a copy of the original image
                new_img = img.copy()
                for y in range(H):
                    sortStart = 0
                    # iterate x up to W inclusive so the final run flushes at x==W
                    for x in range(W + 1):
                        shouldSort = (x == W) or (x - sortStart >= sort_len)
                        if shouldSort:
                            if x - sortStart > 0:
                                block = img[y, sortStart:x].copy()
                                # brightness = average of r,g,b (matches page.tsx)
                                bright = block[:, 0] + block[:, 1] + block[:, 2]
                                idx = np.argsort(bright)
                                new_img[y, sortStart:x] = block[idx]
                            sortStart = x

            elif distortion_type == "displacement":
                # JS: strength = params.intensity / 10; scale = params.frequency / 10;
                # noiseX = Math.sin(x * scale) * Math.cos(y * scale) * strength;
                strength = float(intensity) / 10.0
                scale = float(frequency) / 10.0
                for y in range(H):
                    for x in range(W):
                        noiseX = math.sin(x * scale) * math.cos(y * scale) * strength
                        noiseY = math.cos(x * scale) * math.sin(y * scale) * strength
                        sx = int(round(x + noiseX))
                        sy = int(round(y + noiseY))
                        sx = max(0, min(W - 1, sx))
                        sy = max(0, min(H - 1, sy))
                        new_img[y, x] = sample_pixel(sx, sy)

            elif distortion_type == "fisheye":
                # JS: centerX = width / 2; centerY = height / 2; (no offset)
                # maxRadius = Math.min(width, height) / 2;
                # strength = params.intensity / 100;
                # amount = Math.pow(distance / maxRadius, strength);
                centerX = W / 2
                centerY = H / 2
                maxRadius = min(W, H) / 2
                strength = float(intensity) / 100.0
                for y in range(H):
                    for x in range(W):
                        dx = x - centerX
                        dy = y - centerY
                        distance = math.sqrt(dx * dx + dy * dy)

                        if distance < maxRadius:
                            amount = math.pow(distance / maxRadius, strength)
                            sx = int(round(centerX + dx * amount))
                            sy = int(round(centerY + dy * amount))
                            if 0 <= sx < W and 0 <= sy < H:
                                new_img[y, x] = sample_pixel(sx, sy)
                            else:
                                new_img[y, x] = [0, 0, 0]
                        else:
                            # Outside fisheye radius: black
                            new_img[y, x] = [0, 0, 0]

            elif distortion_type == "ripple":
                # JS: centerX = width / 2 + params.offsetX; centerY = height / 2 + params.offsetY;
                # amplitude = params.intensity / 2; frequency = params.frequency / 50;
                centerX = W / 2 + float(offset_x)
                centerY = H / 2 + float(offset_y)
                amplitude = float(intensity) / 2.0
                frequency_val = float(frequency) / 50.0
                for y in range(H):
                    for x in range(W):
                        dx = x - centerX
                        dy = y - centerY
                        distance = math.sqrt(dx * dx + dy * dy)

                        ripple = math.sin(distance * frequency_val) * amplitude
                        rippleFactor = (
                            (distance + ripple) / distance if distance > 0 else 1
                        )

                        sx = int(round(centerX + dx * rippleFactor))
                        sy = int(round(centerY + dy * rippleFactor))

                        if 0 <= sx < W and 0 <= sy < H:
                            new_img[y, x] = sample_pixel(sx, sy)
                        else:
                            new_img[y, x] = img[y, x]

            elif distortion_type == "twist" or distortion_type == "spherize":
                # JS twist: centerX = width / 2; centerY = height / 2; (no offset)
                # twistAmount = (1 - distance / maxRadius) * strength * Math.PI;
                # JS spherize: factor = Math.sin((distance / maxRadius) * Math.PI * 0.5);
                # sphereFactor = 1 + (factor - 1) * strength;
                centerX = W / 2
                centerY = H / 2
                maxRadius = min(W, H) / 2
                strength = float(intensity) / 100.0
                for y in range(H):
                    for x in range(W):
                        dx = x - centerX
                        dy = y - centerY
                        distance = math.sqrt(dx * dx + dy * dy)

                        if distance < maxRadius:
                            angle = math.atan2(dy, dx)

                            if distortion_type == "twist":
                                twistAmount = (
                                    (1 - distance / maxRadius) * strength * math.pi
                                )
                                newAngle = angle + twistAmount
                                sx = int(round(centerX + math.cos(newAngle) * distance))
                                sy = int(round(centerY + math.sin(newAngle) * distance))
                            else:  # spherize
                                factor = math.sin(
                                    (distance / maxRadius) * math.pi * 0.5
                                )
                                sphereFactor = 1 + (factor - 1) * strength
                                sx = int(round(centerX + dx * sphereFactor))
                                sy = int(round(centerY + dy * sphereFactor))

                            if 0 <= sx < W and 0 <= sy < H:
                                new_img[y, x] = sample_pixel(sx, sy)
                            else:
                                new_img[y, x] = img[y, x]
                        else:
                            new_img[y, x] = img[y, x]

            elif distortion_type == "glitch":
                # JS: glitchStrength = params.intensity / 10; blockSize = Math.max(1, params.frequency);
                # displacement = Math.random() * params.displacement - params.displacement / 2;
                new_img[:] = img.copy()
                glitchStrength = float(intensity) / 10.0
                blockSize = max(1, int(float(frequency)))
                displacementAmount = float(frequency)

                for y in range(0, H, blockSize):
                    if np.random.rand() < glitchStrength / 100.0:
                        shift = int((np.random.rand() - 0.5) * displacementAmount * 2)
                        blockHeight = min(blockSize, H - y)
                        # Shift rows horizontally
                        for by in range(blockHeight):
                            if y + by < H:
                                new_img[y + by] = np.roll(
                                    new_img[y + by], shift, axis=0
                                )

            elif distortion_type == "mosaic":
                # JS: tileSize = Math.max(2, params.frequency); offset = params.intensity / 10;
                # Apply random offset for mosaic effect
                tileSize = max(2, int(float(frequency)))
                offsetStrength = float(intensity) / 10.0
                for y in range(0, H, tileSize):
                    for x in range(0, W, tileSize):
                        tile_h = min(tileSize, H - y)
                        tile_w = min(tileSize, W - x)
                        block = img[y : y + tile_h, x : x + tile_w]
                        r = block[:, :, 0].mean()
                        g = block[:, :, 1].mean()
                        b = block[:, :, 2].mean()
                        offsetX = (np.random.rand() - 0.5) * offsetStrength
                        offsetY = (np.random.rand() - 0.5) * offsetStrength

                        for ty in range(tile_h):
                            for tx in range(tile_w):
                                targetX = int(
                                    round(max(0, min(W - 1, x + tx + offsetX)))
                                )
                                targetY = int(
                                    round(max(0, min(H - 1, y + ty + offsetY)))
                                )
                                new_img[targetY, targetX] = [r, g, b]

            elif distortion_type == "warp":
                # JS: warpStrength = params.intensity / 100; warpScale = params.frequency / 20;
                # Multi-octave noise for complex warping (no offset used in JS)
                warpStrength = float(intensity) / 100.0
                warpScale = float(frequency) / 20.0
                for y in range(H):
                    for x in range(W):
                        warp1 = math.sin(x * warpScale) * math.cos(y * warpScale)
                        warp2 = (
                            math.sin(x * warpScale * 2)
                            * math.cos(y * warpScale * 2)
                            * 0.5
                        )
                        warp3 = (
                            math.sin(x * warpScale * 4)
                            * math.cos(y * warpScale * 4)
                            * 0.25
                        )

                        totalWarp = (warp1 + warp2 + warp3) * warpStrength * 20.0

                        sx = int(round(x + totalWarp))
                        sy = int(round(y + totalWarp * 0.7))
                        sx = max(0, min(W - 1, sx))
                        sy = max(0, min(H - 1, sy))
                        new_img[y, x] = sample_pixel(sx, sy)

            else:
                new_img = img.copy()

            new_img = self._clamp_img(new_img)
            out_images.append(new_img.astype(np.float32))

        result = np.stack(out_images, axis=0)
        return (torch.from_numpy(result),)
