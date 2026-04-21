import math
import numpy as np
import torch
from typing import Tuple, List

class PerlinNoise:
    """Perlin noise generator matching the TypeScript implementation"""
    
    def __init__(self, seed: float = None):
        if seed is None:
            seed = np.random.random()
        
        self.gradients = []
        self.permutation = []
        
        # Seeded random generator
        rng = np.random.RandomState(int(seed * 1000000) % (2**31))
        
        # Generate gradients
        for i in range(256):
            angle = rng.random() * 2 * math.pi
            self.gradients.append([math.cos(angle), math.sin(angle)])
        
        # Generate permutation table
        self.permutation = list(range(256))
        rng.shuffle(self.permutation)
        
        # Extend permutation
        self.permutation = self.permutation + self.permutation
    
    def fade(self, t: float) -> float:
        """Fade function for smooth interpolation"""
        return t * t * t * (t * (t * 6 - 15) + 10)
    
    def lerp(self, a: float, b: float, t: float) -> float:
        """Linear interpolation"""
        return a + t * (b - a)
    
    def dot(self, grad: List[float], x: float, y: float) -> float:
        """Dot product of gradient and distance vectors"""
        return grad[0] * x + grad[1] * y
    
    def noise(self, x: float, y: float) -> float:
        """Generate Perlin noise at coordinates (x, y)"""
        X = int(math.floor(x)) & 255
        Y = int(math.floor(y)) & 255
        
        x -= math.floor(x)
        y -= math.floor(y)
        
        u = self.fade(x)
        v = self.fade(y)
        
        a = self.permutation[X] + Y
        b = self.permutation[X + 1] + Y
        
        return self.lerp(
            self.lerp(
                self.dot(self.gradients[self.permutation[a] & 255], x, y),
                self.dot(self.gradients[self.permutation[b] & 255], x - 1, y),
                u
            ),
            self.lerp(
                self.dot(self.gradients[self.permutation[a + 1] & 255], x, y - 1),
                self.dot(self.gradients[self.permutation[b + 1] & 255], x - 1, y - 1),
                u
            ),
            v
        )


class NebulaGenerator:
    """Advanced nebula/texture generator with Perlin noise, multiple color modes, and post-processing"""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'width': ("INT", {"default": 800, "min": 64, "max": 4096, "step": 64}),
                'height': ("INT", {"default": 600, "min": 64, "max": 4096, "step": 64}),
                'scale': ("FLOAT", {"default": 0.01, "min": 0.001, "max": 0.05, "step": 0.001}),
                'octaves': ("INT", {"default": 6, "min": 1, "max": 8, "step": 1}),
                'persistence': ("FLOAT", {"default": 0.5, "min": 0.1, "max": 1.0, "step": 0.1}),
                'lacunarity': ("FLOAT", {"default": 2.0, "min": 1.0, "max": 3.0, "step": 0.1}),
                'seed': ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.001}),
                'color_mode': (["custom", "rainbow", "spectrum", "radial", "angular", "gradient", "dual", "plasma"], {"default": "custom"}),
                'noise_type': (["perlin", "simplex", "ridged", "billow", "turbulence"], {"default": "perlin"}),
                # Color stops (simplified to 5 colors for ComfyUI - nebula preset by default)
                'color1_r': ("FLOAT", {"default": 0.02, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color1_g': ("FLOAT", {"default": 0.02, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color1_b': ("FLOAT", {"default": 0.06, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color2_r': ("FLOAT", {"default": 0.10, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color2_g': ("FLOAT", {"default": 0.06, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color2_b': ("FLOAT", {"default": 0.24, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color3_r': ("FLOAT", {"default": 0.47, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color3_g': ("FLOAT", {"default": 0.16, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color3_b': ("FLOAT", {"default": 0.59, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color4_r': ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color4_g': ("FLOAT", {"default": 0.39, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color4_b': ("FLOAT", {"default": 0.78, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color5_r': ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color5_g': ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                'color5_b': ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                'gradient_rotation': ("FLOAT", {"default": 0.0, "min": 0.0, "max": 360.0, "step": 1.0}),
                'gradient_scale': ("FLOAT", {"default": 1.0, "min": 0.1, "max": 3.0, "step": 0.1}),
                'hue_shift': ("FLOAT", {"default": 0.0, "min": 0.0, "max": 360.0, "step": 1.0}),
                'saturation_boost': ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.1}),
                'brightness': ("FLOAT", {"default": 1.0, "min": 0.1, "max": 2.0, "step": 0.1}),
                'contrast': ("FLOAT", {"default": 1.0, "min": 0.1, "max": 3.0, "step": 0.1}),
                'gamma': ("FLOAT", {"default": 1.0, "min": 0.1, "max": 3.0, "step": 0.1}),
                'invert_colors': ("BOOLEAN", {"default": False}),
                'warp_strength': ("FLOAT", {"default": 0.0, "min": 0.0, "max": 2.0, "step": 0.1}),
                'warp_frequency': ("FLOAT", {"default": 0.01, "min": 0.001, "max": 0.05, "step": 0.001}),
                'star_density': ("FLOAT", {"default": 0.001, "min": 0.0, "max": 0.01, "step": 0.0001}),
                'star_brightness': ("FLOAT", {"default": 0.8, "min": 0.0, "max": 1.0, "step": 0.1}),
                'star_colors': ("BOOLEAN", {"default": False}),
                'star_twinkle': ("BOOLEAN", {"default": False}),
                'bloom': ("BOOLEAN", {"default": False}),
                'bloom_intensity': ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1}),
                'vignette': ("BOOLEAN", {"default": False}),
                'vignette_intensity': ("FLOAT", {"default": 0.3, "min": 0.0, "max": 1.0, "step": 0.1}),
                'chromatic': ("BOOLEAN", {"default": False}),
                'chromatic_intensity': ("FLOAT", {"default": 0.1, "min": 0.0, "max": 0.5, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "generate_nebula"
    CATEGORY = "Steaked-nodes/generators"

    def hsl_to_rgb(self, h: float, s: float, l: float) -> Tuple[int, int, int]:
        """Convert HSL to RGB (h: 0-1, s: 0-1, l: 0-1)"""
        c = (1 - abs(2 * l - 1)) * s
        x = c * (1 - abs(((h * 6) % 2) - 1))
        m = l - c / 2
        
        if h < 1/6:
            r, g, b = c, x, 0
        elif h < 2/6:
            r, g, b = x, c, 0
        elif h < 3/6:
            r, g, b = 0, c, x
        elif h < 4/6:
            r, g, b = 0, x, c
        elif h < 5/6:
            r, g, b = x, 0, c
        else:
            r, g, b = c, 0, x
        
        return (
            int(round((r + m) * 255)),
            int(round((g + m) * 255)),
            int(round((b + m) * 255))
        )
    
    def interpolate_color(self, color_stops: List[Tuple[float, Tuple[float, float, float]]], 
                         t: float, mode: str, hue_shift: float, saturation_boost: float) -> Tuple[int, int, int]:
        """Interpolate color based on mode and value t (0-1)"""
        t = max(0.0, min(1.0, t))
        
        if mode == "rainbow":
            hue = (t + hue_shift / 360.0) % 1.0
            return self.hsl_to_rgb(hue, 1.0, 0.5)
        
        if mode == "spectrum":
            hue = ((t * 300 / 360.0) + hue_shift / 360.0) % 1.0
            sat = 0.8 + saturation_boost * 0.2
            light = 0.4 + t * 0.4
            return self.hsl_to_rgb(hue, sat, light)
        
        # Custom gradient interpolation
        for i in range(len(color_stops) - 1):
            pos1, rgb1 = color_stops[i]
            pos2, rgb2 = color_stops[i + 1]
            
            if pos1 <= t <= pos2:
                local_t = (t - pos1) / (pos2 - pos1) if pos2 > pos1 else 0
                r = int(rgb1[0] + (rgb2[0] - rgb1[0]) * local_t)
                g = int(rgb1[1] + (rgb2[1] - rgb1[1]) * local_t)
                b = int(rgb1[2] + (rgb2[2] - rgb1[2]) * local_t)
                return (r, g, b)
        
        # Return last color if t is beyond range
        return tuple(int(c) for c in color_stops[-1][1])
    
    def enhanced_noise(self, noise: PerlinNoise, x: float, y: float, noise_type: str) -> float:
        """Apply different noise types"""
        base_noise = noise.noise(x, y)
        
        if noise_type == "ridged":
            return 1 - abs(base_noise)
        elif noise_type == "billow":
            return abs(base_noise)
        elif noise_type == "turbulence":
            return abs(base_noise) * 2 - 1
        elif noise_type == "simplex":
            # Simplified simplex-like transformation
            return (base_noise + noise.noise(x * 1.414, y * 1.414)) * 0.5
        else:  # perlin
            return base_noise
    
    def apply_post_processing(self, image_data: np.ndarray, width: int, height: int,
                             bloom: bool, bloom_intensity: float,
                             vignette: bool, vignette_intensity: float,
                             chromatic: bool, chromatic_intensity: float):
        """Apply post-processing effects"""
        for y in range(height):
            for x in range(width):
                r = image_data[y, x, 0]
                g = image_data[y, x, 1]
                b = image_data[y, x, 2]
                
                # Vignette effect
                if vignette:
                    centerX = width / 2
                    centerY = height / 2
                    distance = math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2)
                    maxDistance = math.sqrt(centerX ** 2 + centerY ** 2)
                    vignetteFactor = 1 - (distance / maxDistance) * vignette_intensity
                    r *= vignetteFactor
                    g *= vignetteFactor
                    b *= vignetteFactor
                
                # Bloom effect (simplified)
                if bloom:
                    brightness_val = (r + g + b) / 3
                    if brightness_val > 200:
                        bloomFactor = bloom_intensity
                        r = min(255, r + brightness_val * bloomFactor * 0.1)
                        g = min(255, g + brightness_val * bloomFactor * 0.1)
                        b = min(255, b + brightness_val * bloomFactor * 0.1)
                
                # Chromatic aberration
                if chromatic:
                    aberration = chromatic_intensity * 2
                    offsetX = (x - width / 2) * aberration * 0.01
                    r *= 1 + offsetX * 0.1
                    b *= 1 - offsetX * 0.1
                
                image_data[y, x, 0] = max(0, min(255, r))
                image_data[y, x, 1] = max(0, min(255, g))
                image_data[y, x, 2] = max(0, min(255, b))

    def generate_nebula(self, width, height, scale, octaves, persistence, lacunarity, seed,
                       color_mode, noise_type,
                       color1_r, color1_g, color1_b,
                       color2_r, color2_g, color2_b,
                       color3_r, color3_g, color3_b,
                       color4_r, color4_g, color4_b,
                       color5_r, color5_g, color5_b,
                       gradient_rotation, gradient_scale, hue_shift, saturation_boost,
                       brightness, contrast, gamma, invert_colors,
                       warp_strength, warp_frequency,
                       star_density, star_brightness, star_colors, star_twinkle,
                       bloom, bloom_intensity, vignette, vignette_intensity,
                       chromatic, chromatic_intensity):
        """Generate nebula texture"""
        
        # Initialize noise generator
        noise = PerlinNoise(seed)
        
        # Prepare color stops (5 evenly spaced colors)
        color_stops = [
            (0.0, (color1_r * 255, color1_g * 255, color1_b * 255)),
            (0.3, (color2_r * 255, color2_g * 255, color2_b * 255)),
            (0.6, (color3_r * 255, color3_g * 255, color3_b * 255)),
            (0.8, (color4_r * 255, color4_g * 255, color4_b * 255)),
            (1.0, (color5_r * 255, color5_g * 255, color5_b * 255)),
        ]
        
        # Create image array
        image_data = np.zeros((height, width, 3), dtype=np.float32)
        
        # Calculate gradient transformation
        centerX = width / 2
        centerY = height / 2
        cos_rot = math.cos(math.radians(gradient_rotation))
        sin_rot = math.sin(math.radians(gradient_rotation))
        
        # Generate base nebula noise
        for y in range(height):
            for x in range(width):
                # Apply warping if enabled
                warpedX = x
                warpedY = y
                if warp_strength > 0:
                    warpedX += warp_strength * self.enhanced_noise(
                        noise, x * warp_frequency, y * warp_frequency, "perlin") * 50
                    warpedY += warp_strength * self.enhanced_noise(
                        noise, (x + 1000) * warp_frequency, y * warp_frequency, "perlin") * 50
                
                # Generate fractal noise
                amplitude = 1.0
                frequency = scale
                noise_value = 0.0
                max_value = 0.0
                
                for _ in range(octaves):
                    noise_value += self.enhanced_noise(
                        noise, warpedX * frequency, warpedY * frequency, noise_type) * amplitude
                    max_value += amplitude
                    amplitude *= persistence
                    frequency *= lacunarity
                
                # Normalize noise value
                noise_value = (noise_value / max_value + 1) / 2
                
                # Apply gradient transformations for different color modes
                gradient_t = noise_value
                
                if color_mode == "radial":
                    dx = (x - centerX) / width
                    dy = (y - centerY) / height
                    gradient_t = math.sqrt(dx * dx + dy * dy) * gradient_scale
                elif color_mode == "angular":
                    dx = x - centerX
                    dy = y - centerY
                    gradient_t = (math.atan2(dy, dx) + math.pi) / (2 * math.pi)
                    gradient_t = (gradient_t + gradient_rotation / 360) % 1
                elif color_mode == "gradient":
                    dx = x - centerX
                    dy = y - centerY
                    rotatedX = dx * cos_rot - dy * sin_rot
                    gradient_t = (rotatedX / width + 0.5) * gradient_scale
                elif color_mode == "dual":
                    primary = noise_value
                    dx = (x - centerX) / width
                    dy = (y - centerY) / height
                    secondary = math.sqrt(dx * dx + dy * dy)
                    gradient_t = (primary + secondary) * 0.5
                elif color_mode == "plasma":
                    plasma = math.sin(x * 0.02) * math.cos(y * 0.02) + math.sin(
                        math.sqrt(x * x + y * y) * 0.02)
                    gradient_t = (noise_value + plasma * 0.5) * 0.5
                
                # Apply brightness, contrast, and gamma
                gradient_t = math.pow(gradient_t * brightness, contrast)
                gradient_t = math.pow(gradient_t, 1 / gamma)
                gradient_t = max(0, min(1, gradient_t))
                
                # Get color from the selected mode
                r, g, b = self.interpolate_color(color_stops, gradient_t, color_mode, 
                                                hue_shift, saturation_boost)
                
                # Apply color inversion if enabled
                if invert_colors:
                    r = 255 - r
                    g = 255 - g
                    b = 255 - b
                
                image_data[y, x, 0] = r
                image_data[y, x, 1] = g
                image_data[y, x, 2] = b
        
        # Add stars
        if star_density > 0:
            star_count = int(width * height * star_density)
            rng = np.random.RandomState(int(seed * 1000000) % (2**31))
            
            for _ in range(star_count):
                x = rng.randint(0, width)
                y = rng.randint(0, height)
                brightness_val = rng.random() * star_brightness
                
                if star_colors:
                    # Use random colors for stars
                    star_hue = rng.random()
                    star_r, star_g, star_b = self.hsl_to_rgb(star_hue, 0.8, 0.7)
                    image_data[y, x, 0] = min(255, image_data[y, x, 0] + star_r * brightness_val)
                    image_data[y, x, 1] = min(255, image_data[y, x, 1] + star_g * brightness_val)
                    image_data[y, x, 2] = min(255, image_data[y, x, 2] + star_b * brightness_val)
                else:
                    # White stars
                    star_color = 255 * brightness_val
                    image_data[y, x, 0] = min(255, image_data[y, x, 0] + star_color)
                    image_data[y, x, 1] = min(255, image_data[y, x, 1] + star_color)
                    image_data[y, x, 2] = min(255, image_data[y, x, 2] + star_color)
                
                # Add star twinkle effect (larger stars)
                if star_twinkle and rng.random() < 0.1:
                    twinkle_size = 1 + rng.randint(0, 2)
                    for dx in range(-twinkle_size, twinkle_size + 1):
                        for dy in range(-twinkle_size, twinkle_size + 1):
                            newX = x + dx
                            newY = y + dy
                            if 0 <= newX < width and 0 <= newY < height:
                                distance = math.sqrt(dx * dx + dy * dy)
                                falloff = max(0, 1 - distance / twinkle_size)
                                twinkle_brightness = brightness_val * falloff * 0.5
                                
                                if star_colors:
                                    star_hue = rng.random()
                                    star_r, star_g, star_b = self.hsl_to_rgb(star_hue, 0.8, 0.7)
                                    image_data[newY, newX, 0] = min(255, image_data[newY, newX, 0] + star_r * twinkle_brightness)
                                    image_data[newY, newX, 1] = min(255, image_data[newY, newX, 1] + star_g * twinkle_brightness)
                                    image_data[newY, newX, 2] = min(255, image_data[newY, newX, 2] + star_b * twinkle_brightness)
                                else:
                                    star_color = 255 * twinkle_brightness
                                    image_data[newY, newX, 0] = min(255, image_data[newY, newX, 0] + star_color)
                                    image_data[newY, newX, 1] = min(255, image_data[newY, newX, 1] + star_color)
                                    image_data[newY, newX, 2] = min(255, image_data[newY, newX, 2] + star_color)
        
        # Apply post-processing effects
        self.apply_post_processing(image_data, width, height, bloom, bloom_intensity,
                                   vignette, vignette_intensity, chromatic, chromatic_intensity)
        
        # Normalize to 0-1 range for ComfyUI
        image_data = np.clip(image_data / 255.0, 0.0, 1.0)
        
        # Add batch dimension
        result = torch.from_numpy(image_data).unsqueeze(0)
        return (result,)
