# ComfyUI Custom Nodes

A collection of powerful image processing nodes for ComfyUI, including distortion effects, texture generation, edge detection, blending, and retro effects.

## 📦 Installation

1. Clone or download this repository into your ComfyUI `custom_nodes` folder:
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/StealthNinja1O1/Steaked-nodes.git
```

2. Restart ComfyUI

Or do so from the Comfy Manager -> Install via Git URL

## 🎨 Available Nodes

### 1. **Load and Crop Image** (`LoadAndCrop`)
Load images with advanced cropping capabilities.

**Features:**
- Load images from file
- Crop with adjustable dimensions and position

---

### 2. **Color Blender** (`ColorBlender`)
Advanced color manipulation and blending.

**Features:**
- Color overlay with multiple blend modes
- Hue/Saturation/Brightness adjustments
- Color temperature control
- Tint and vibrance adjustments

---

### 3. **Image Distortion** (`ImageDistortion`)
Apply 12 different distortion effects to images.

**Distortion Types:**
- **Wave** - Sinusoidal wave patterns
- **Swirl** - Rotational swirl effect (supports offset)
- **Kaleidoscope** - Mirrored kaleidoscope segments
- **Pixel Sort** - Sort pixels by brightness
- **Displacement** - Noise-based displacement mapping
- **Fisheye** - Fisheye lens distortion
- **Ripple** - Concentric ripple effect (supports offset)
- **Twist** - Spiral twist effect
- **Spherize** - Spherical warping
- **Glitch** - Digital glitch artifacts
- **Mosaic** - Mosaic tile effect
- **Warp** - Multi-octave noise warping

**Parameters:**
- `intensity` (0-100) - Effect strength
- `frequency` (0-100) - Pattern frequency/detail
- `offset_x/y` (-50 to 50) - Center offset for applicable effects

---

### 4. **Texture Generator** (`TextureGenerator`)
Generate procedural textures from scratch.

**Texture Types:**
- **Perlin Noise** - Smooth organic noise
- **Voronoi** - Cellular/mosaic patterns
- **Marble** - Marble vein patterns
- **Wood Grain** - Natural wood texture
- **Clouds** - Soft cloud formations
- **Cells** - Honeycomb/cellular structures
- **Waves** - Sinusoidal wave patterns
- **Spiral** - Spiral patterns

**Parameters:**
- `width/height` - Output resolution (64-4096px)
- `scale` - Pattern scale (1-100)
- `octaves` - Noise complexity (1-8)
- `persistence` - Noise detail level (0.1-1.0)
- `seed` - Random seed for reproducibility
- `color1/color2 RGB` - Start and end colors for gradient

**Use Cases:**
- Background generation
- Overlay textures
- Displacement maps
- Abstract art bases

---

### 5. **Edge Detection** (`EdgeDetection`)
Detect edges with multiple algorithms and styling options.

**Algorithms:**
- **Sobel** - Standard gradient-based edge detection
- **Prewitt** - Similar to Sobel, different kernel
- **Scharr** - Improved Sobel with better rotational symmetry
- **Roberts** - Fast 2×2 gradient operator
- **Laplacian** - Second derivative edge detection
- **Canny** - Multi-stage edge detection with non-maximum suppression

**Parameters:**
- `threshold` (0-1) - Edge sensitivity
- `thickness` (1-5) - Edge line thickness
- `invert` - Swap edge/background colors
- `color RGB` - Edge line color
- `background RGB` - Background color

**Use Cases:**
- Line art generation
- Outline extraction
- Artistic edge effects
- Preprocessing for other effects

---

### 6. **Image Blender** (`ImageBlender`)
Blend two images with professional blend modes.

**Blend Modes:**
- **Normal** - Standard alpha blending
- **Multiply** - Darkens (multiply colors)
- **Screen** - Lightens (inverse multiply)
- **Overlay** - Contrast-preserving blend
- **Soft Light** - Gentle contrast adjustment
- **Hard Light** - Strong contrast adjustment
- **Color Dodge** - Brightens highlights
- **Color Burn** - Darkens shadows
- **Darken** - Keep darker pixels
- **Lighten** - Keep lighter pixels
- **Difference** - Absolute difference
- **Exclusion** - Similar to difference, softer
- **Add** - Additive blending
- **Subtract** - Subtractive blending

**Parameters:**
- `base_image` - Bottom layer
- `blend_image` - Top layer (auto-resized to match)
- `blend_mode` - Blend algorithm
- `opacity` (0-1) - Blend strength
- `mask` (optional) - Grayscale mask for selective blending

**Use Cases:**
- Composite multiple generations
- Texture overlay
- Color grading
- Creative blending effects

---

### 7. **Halftone Effect** (`HalftoneEffect`)
Apply retro printing and dithering effects.

**Effect Types:**
- **Halftone Dots** - Classic circular halftone print
- **Halftone Lines** - Parallel line pattern
- **Bayer Dithering** - 4×4 ordered dithering
- **Floyd-Steinberg** - Error diffusion dithering
- **Ordered Dithering** - 8×8 ordered dithering
- **Newspaper** - Newspaper print simulation
- **Crosshatch** - Multi-directional hatching

**Parameters:**
- `dot_size` (2-20) - Size of halftone elements
- `angle` (0-360°) - Rotation angle for directional effects
- `sharpness` (0.1-2.0) - Dot sharpness/contrast
- `contrast` (0.5-2.0) - Input contrast adjustment

**Use Cases:**
- Retro/vintage effects
- Print simulation
- Comic book style
- Pop art effects
- Monochrome artistic styles

---
