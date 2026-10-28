"""Draws the app icons and splash image from the cow glyph the app uses (Material Community Icons).

Run from apps/mobile:  python scripts/make-icons.py
Colours are the design tokens: pasture green (green-800) and milk white (milk-50). See docs/design.md.
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons'
GREEN = (0x24, 0x58, 0x3A, 255)
GREEN_DEEP = (0x17, 0x3F, 0x2B, 255)
MILK = (0xFB, 0xFA, 0xF6, 255)
WHITE = (255, 255, 255, 255)

COW = chr(json.loads((FONTS / 'glyphmaps/MaterialCommunityIcons.json').read_text())['cow'])
FONT_FILE = str(FONTS / 'Fonts/MaterialCommunityIcons.ttf')


def glyph(canvas: Image.Image, size: int, colour, centre=None):
    """Draws the cow, `size` pixels wide, centred on the canvas (by its ink, not its font box)."""
    font = ImageFont.truetype(FONT_FILE, size)
    layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = d.textbbox((0, 0), COW, font=font)
    cx, cy = centre or (canvas.width / 2, canvas.height / 2)
    d.text((cx - (x0 + x1) / 2, cy - (y0 + y1) / 2), COW, font=font, fill=colour)
    canvas.alpha_composite(layer)


def gradient(size: int) -> Image.Image:
    """Pasture green, a little deeper towards the bottom: depth without a loud gradient."""
    img = Image.new('RGBA', (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        c = tuple(round(GREEN[i] + (GREEN_DEEP[i] - GREEN[i]) * t * 0.8) for i in range(3)) + (255,)
        for x in range(size):
            px[x, y] = c
    return img


def rounded(size: int, radius: float, fill) -> Image.Image:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=fill)
    return img


assets = ROOT / 'assets'

# iOS / store icon: full square (the system rounds it), white cow on green.
icon = gradient(1024)
glyph(icon, 620, WHITE)
icon.convert('RGB').save(assets / 'icon.png')

# Android adaptive icon: green background layer, cow foreground kept inside the 66% safe zone.
Image.new('RGBA', (512, 512), GREEN).save(assets / 'android-icon-background.png')
fg = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
glyph(fg, 250, WHITE)
fg.save(assets / 'android-icon-foreground.png')
mono = Image.new('RGBA', (432, 432), (0, 0, 0, 0))
glyph(mono, 210, WHITE)
mono.save(assets / 'android-icon-monochrome.png')

# Splash: the app mark (green rounded square with the cow) on milk white, set in app.json.
mark = rounded(1024, 1024 * 0.28, GREEN)
glyph(mark, 600, WHITE)
mark.save(assets / 'splash-icon.png')

# Android notification icon: white shape on transparent (Android tints it).
note = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
glyph(note, 80, WHITE)
note.save(assets / 'notification-icon.png')

# Web favicon.
fav = rounded(48, 12, GREEN)
glyph(fav, 32, WHITE)
fav.save(assets / 'favicon.png')

print('icons written to', assets)
