#!/usr/bin/env python3
"""Compose the Between Sets social-share card (1200x630) from the lobby hero bg."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1200, 630
ROOT = "/Users/peterarango/Documents/Hackspace/frontend"
WORD_FONT = "/Library/Fonts/ClashGrotesk-Bold.ttf"
MONO_FONT = "/Users/peterarango/Library/Fonts/JetBrainsMonoNLNerdFont-Bold.ttf"

# --- background: cover-fit + darken + vignette ---
bg = Image.open(f"{ROOT}/assets/lobby-bg.jpg").convert("RGB")
ir, cr = bg.width / bg.height, W / H
if ir > cr:
    nh = H; nw = int(H * ir)
else:
    nw = W; nh = int(W / ir)
bg = bg.resize((nw, nh), Image.LANCZOS).crop(
    ((nw - W) // 2, (nh - H) // 2, (nw - W) // 2 + W, (nh - H) // 2 + H))
card = bg.copy()
# global darken
card = Image.blend(card, Image.new("RGB", (W, H), (7, 7, 11)), 0.42)
# radial vignette
vig = Image.new("L", (W, H), 0)
vd = ImageDraw.Draw(vig)
vd.ellipse([-W * 0.25, -H * 0.35, W * 1.25, H * 1.35], fill=180)
vig = vig.filter(ImageFilter.GaussianBlur(160))
dark = Image.new("RGB", (W, H), (7, 7, 11))
card = Image.composite(card, dark, vig)

draw = ImageDraw.Draw(card)

def grad_h(w, h, c0, c1):
    """Horizontal gradient image (1-row built then stretched down)."""
    row = Image.new("RGB", (w, 1))
    px = row.load()
    for x in range(w):
        t = x / max(1, w - 1)
        px[x, 0] = tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
    return row.resize((w, h))

def draw_centered(text, font, y, fill=None, grad=None, ls=0, shadow=False):
    """Draw text centered at vertical y (top). Optional letter-spacing + gradient."""
    # measure with letter spacing
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + ls * (len(text) - 1)
    x = (W - total) / 2
    if grad is not None:
        # render text as white mask, then paste gradient through it
        mask = Image.new("L", (W, H), 0)
        md = ImageDraw.Draw(mask)
        cx = x
        for ch, w in zip(text, widths):
            md.text((cx, y), ch, font=font, fill=255)
            cx += w + ls
        gimg = grad_h(W, H, grad[0], grad[1])
        card.paste(gimg, (0, 0), mask)
        return
    cx = x
    for ch, w in zip(text, widths):
        if shadow:
            draw.text((cx + 2, y + 2), ch, font=font, fill=(0, 0, 0, 160))
        draw.text((cx, y), ch, font=font, fill=fill)
        cx += w + ls

word = ImageFont.truetype(WORD_FONT, 132)
tag = ImageFont.truetype(MONO_FONT, 23)
btn = ImageFont.truetype(WORD_FONT, 26)

CYAN, MAG = (0, 229, 255), (255, 26, 140)
draw_centered("BETWEEN", word, 150, grad=(CYAN, MAG))
draw_centered("SETS", word, 285, grad=(CYAN, MAG))
draw_centered("LIVE SONGS, MADE BY THE CROWD", tag, 452, fill=(255, 255, 255), ls=6)

# pink pill
bw, bh = 300, 64
bx, by = (W - bw) // 2, 506
draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh // 2, fill=MAG)
bt = "START A SHOW"
bl = draw.textlength(bt, font=btn) + 3 * (len(bt) - 1)
cx = bx + (bw - bl) / 2
for ch in bt:
    draw.text((cx, by + 16), ch, font=btn, fill=(10, 10, 15))
    cx += draw.textlength(ch, font=btn) + 3

card.save(f"{ROOT}/assets/og-image.jpg", "JPEG", quality=88, optimize=True)
print("wrote", f"{ROOT}/assets/og-image.jpg", card.size)
