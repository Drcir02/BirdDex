"""Writes preprocess-vectors.json: what Pillow (the reference of the WingCLIP preprocessing) makes of synthetic pictures.

The pictures are made by a small integer-only formula that tests/unit/helpers/vision-synth.ts repeats exactly, so no
picture has to be stored: the test builds the same pixels, runs our preprocessing and compares the SHA-256 of the
cropped bytes and of the float32 tensor with the numbers below. Run it again only if the recipe changes:

    .venv/bin/python tests/fixtures/vision/make-preprocess-vectors.py
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import PIL
from PIL import Image

MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

# name, width, height, seed, why this picture
CASES = [
    ('landscape-1000x751', 1000, 751, 1, 'ordinary landscape picture'),
    ('portrait-683x1024', 683, 1024, 2, 'portrait; the resized height 371 leaves a half pixel margin, so the crop offset must round to even'),
    ('half-margin-1327x1000', 1327, 1000, 3, 'resized width 329: margin 52.5, Python gives 52 where Math.round gives 53'),
    ('upscale-100x80', 100, 80, 4, 'smaller than the target, so the filter is not stretched'),
    ('square-500x500', 500, 500, 5, 'square'),
    ('panorama-1920x480', 1920, 480, 6, 'very wide: the stretched filter reads 8 source pixels per output pixel'),
    ('tiny-17x23', 17, 23, 7, 'tiny picture, upscaled by 10'),
]


def synth(width: int, height: int, seed: int) -> np.ndarray:
    """Integer-only picture, mirrored in vision-synth.ts. Returns height x width x 3 uint8."""
    x = np.arange(width, dtype=np.uint64)[None, :, None]
    y = np.arange(height, dtype=np.uint64)[:, None, None]
    c = np.arange(3, dtype=np.uint64)[None, None, :]
    m32 = np.uint64(0xFFFFFFFF)
    h = (x * np.uint64(374761393) + y * np.uint64(668265263) + c * np.uint64(2147483629) + np.uint64(seed) * np.uint64(1274126177)) & m32
    h = h ^ (h >> np.uint64(13))
    h = (h * np.uint64(1274126177)) & m32
    h = h ^ (h >> np.uint64(16))
    noise = h & np.uint64(255)
    gx = (x * np.uint64(255)) // np.uint64(max(width - 1, 1))
    gy = (y * np.uint64(255)) // np.uint64(max(height - 1, 1))
    grad = (gx * (c + np.uint64(1)) + gy * (np.uint64(3) - c)) // np.uint64(4) % np.uint64(256)
    checker = np.where(((x // np.uint64(9) + y // np.uint64(6) + c) % np.uint64(2)) == 0, np.uint64(255), np.uint64(0))
    value = (noise * np.uint64(2) + grad * np.uint64(4) + checker * np.uint64(2)) // np.uint64(8)
    return value.astype(np.uint8)


def torch_like_tensor(rgb: np.ndarray) -> np.ndarray:
    """ToTensor + Normalize in float32, the way torchvision does it. Returns 3 x H x W."""
    a = rgb.astype(np.float32) / np.float32(255)
    a = (a - MEAN) / STD
    return np.ascontiguousarray(a.transpose(2, 0, 1)).astype(np.float32)


def main() -> None:
    out = []
    for name, w, h, seed, why in CASES:
        picture = Image.fromarray(synth(w, h, seed), 'RGB')
        if w <= h:
            nw, nh = 248, int(248 * h // w)
        else:
            nw, nh = int(248 * w // h), 248
        resized = picture.resize((nw, nh), Image.BICUBIC)
        left, top = int(round((nw - 224) / 2.0)), int(round((nh - 224) / 2.0))
        crop = resized.crop((left, top, left + 224, top + 224))
        rgb = np.asarray(crop, dtype=np.uint8)
        tensor = torch_like_tensor(rgb)
        out.append({
            'name': name, 'width': w, 'height': h, 'seed': seed, 'why': why,
            'resized': [nw, nh], 'left': left, 'top': top,
            'cropSha256': hashlib.sha256(rgb.tobytes()).hexdigest(),
            'tensorSha256': hashlib.sha256(tensor.tobytes()).hexdigest(),
            'cropHead': [int(v) for v in rgb.reshape(-1)[:30]],
            'cropMean': [round(float(rgb[:, :, k].mean()), 4) for k in range(3)],
        })
        print(f'{name}: resized {nw}x{nh}, crop at {left},{top}, mean {out[-1]["cropMean"]}')
    path = Path(__file__).with_name('preprocess-vectors.json')
    path.write_text(json.dumps({'pillow': PIL.__version__, 'numpy': np.__version__, 'cases': out}, indent=2) + '\n')
    print('wrote', path)


if __name__ == '__main__':
    sys.exit(main())
