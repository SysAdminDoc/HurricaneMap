"""Generates a placeholder logo (transparent PNG, RGBA) until proper branding lands.

A simple hurricane-spiral mark in the Catppuccin Mocha mauve→sapphire gradient,
on a transparent canvas. Run once; output goes to branding/logo.png.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "branding" / "logo.png"
OUT.parent.mkdir(parents=True, exist_ok=True)

SIZE = 512
center = SIZE / 2

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Background dark squircle (slightly transparent so corners stay invisible).
pad = 18
draw.rounded_rectangle(
    [pad, pad, SIZE - pad, SIZE - pad],
    radius=110,
    fill=(17, 17, 27, 255),
    outline=(205, 214, 244, 30),
    width=2,
)


def lerp_color(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# Spiral arms — three logarithmic arms rotated 120° apart.
# Color gradient: sapphire (#74c7ec) outer → mauve (#cba6f7) inner.
SAPPHIRE = (116, 199, 236)
MAUVE = (203, 166, 247)

ARMS = 3
TURNS = 1.6   # how many spiral turns per arm
A = 22.0      # spiral scale (start radius)
B = 0.20      # tightness (e^B*theta)
MAX_THETA = TURNS * 2 * math.pi
SAMPLES = 320

for arm in range(ARMS):
    arm_offset = arm * (2 * math.pi / ARMS)
    pts = []
    for i in range(SAMPLES):
        t = i / SAMPLES
        theta = t * MAX_THETA
        r = A * math.exp(B * theta)
        if r > SIZE / 2 - pad - 30:
            break
        x = center + r * math.cos(theta + arm_offset)
        y = center + r * math.sin(theta + arm_offset)
        pts.append((x, y))
    # Draw fading-width segments along the spiral.
    for i in range(1, len(pts)):
        t = i / len(pts)
        color = lerp_color(MAUVE, SAPPHIRE, t)
        # arm tapers from thick near the eye out to thin at the tip
        width = max(3, int(34 * (1 - t) ** 0.6))
        draw.line([pts[i - 1], pts[i]], fill=(*color, 230), width=width)

# Bright eye in the center.
eye_r = 28
draw.ellipse(
    [center - eye_r, center - eye_r, center + eye_r, center + eye_r],
    fill=(205, 214, 244, 240),
)
# Soft halo around the eye.
for k, alpha in enumerate([20, 14, 9]):
    rr = eye_r + 6 + k * 6
    draw.ellipse([center - rr, center - rr, center + rr, center + rr],
                 outline=(180, 190, 254, alpha), width=2)

img.save(OUT, "PNG", optimize=True)

# Favicon size.
img.resize((64, 64), Image.LANCZOS).save(ROOT / "branding" / "favicon.png", "PNG", optimize=True)
print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
