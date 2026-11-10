#!/usr/bin/env python3
"""
Builds the final logo masters for the three Connectly marks (A Doorway, B Gap, C Lean In).

  pip install fonttools
  python3 brand/tools/build_brand.py --name Connectly --font brand/fonts/Poppins-SemiBold.ttf --out brand/final

Everything is generated from geometry (no live text): the wordmark is outlined from the font, so
changing the product name is one flag. The font is SIL OFL 1.1 (see the licence field in the file).
All marks live on a 256x256 grid, centred, so they can be swapped 1:1.
"""
import argparse
import math
import os

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

# ---- palette (see brand/final/PALETTE.md for the reasoning and contrast table) ----
INK = "#10252B"      # deep teal-ink: text, primary mark colour
EMBER = "#F9502C"    # warm ember: the "person", the accent (3.0:1 on Paper as a graphic, 4.7:1 on Ink)
PAPER = "#F6F1E9"    # warm off-white: backgrounds, reversed marks

VB = 256


def f(n):
    return f"{n:.2f}".rstrip("0").rstrip(".")


# ---------------------------------------------------------------- marks
def mark_a(small=False, reverse=False):
    """The Doorway: an arch (the door) with one solid dot (the person) standing in it."""
    R = 92
    t = 44 if not small else 46          # arch thickness; heavier in the small cut
    if reverse:
        t -= 3                           # light-on-dark looks heavier: thin the reversed art
    r = R - t
    top, base = 36, 220                  # symmetric about y=128
    cy = top + R                         # arch centre
    d = (f"M{128-R},{base}V{cy}A{R},{R} 0 0 1 {128+R},{cy}V{base}H{128+r}V{cy}"
         f"A{r},{r} 0 0 0 {128-r},{cy}V{base}Z")
    dot_r = 22 if not small else 25
    dot_cy = base - 38 if not small else base - 40
    return [(d, "ink"), (f"M{128-dot_r},{dot_cy}a{dot_r},{dot_r} 0 1 0 {2*dot_r},0a{dot_r},{dot_r} 0 1 0 {-2*dot_r},0Z", "ember")]


def mark_b(small=False, reverse=False):
    """The Gap: a ring cut into two halves, offset vertically; the gap is the opening (closing it = a connection)."""
    R, r = 92, 46
    if reverse:
        r += 2
    g, off = (7, 16) if not small else (10, 22)   # half-gap and vertical offset; wider for 16px
    parts = []
    for side, colour in (("L", "ink"), ("R", "ember")):
        s = -1 if side == "L" else 1
        xo = 128 + s * g
        yo, yi = math.sqrt(R * R - g * g), math.sqrt(r * r - g * g)
        dy = -off if side == "L" else off
        so = 0 if side == "L" else 1
        d = (f"M{f(xo)},{f(128-yo+dy)}A{R},{R} 0 1 {so} {f(xo)},{f(128+yo+dy)}"
             f"V{f(128+yi+dy)}A{r},{r} 0 1 {1-so} {f(xo)},{f(128-yi+dy)}Z")
        parts.append((d, colour))
    return parts


def stadium(top, bottom, w):
    """A pill between two cap centres, as an explicit path (no transforms)."""
    (tx, ty), (bx, by) = top, bottom
    ux, uy = tx - bx, ty - by
    n = math.hypot(ux, uy)
    ux, uy = ux / n, uy / n
    nx, ny = -uy, ux
    r = w / 2
    p1 = (bx + r * nx, by + r * ny)
    p2 = (tx + r * nx, ty + r * ny)
    p3 = (tx - r * nx, ty - r * ny)
    p4 = (bx - r * nx, by - r * ny)
    return (f"M{f(p1[0])},{f(p1[1])}L{f(p2[0])},{f(p2[1])}A{r},{r} 0 0 0 {f(p3[0])},{f(p3[1])}"
            f"L{f(p4[0])},{f(p4[1])}A{r},{r} 0 0 0 {f(p1[0])},{f(p1[1])}Z")


def mark_c(small=False, reverse=False):
    """Lean In: two pills leaning toward each other at exactly 15 degrees, not yet touching."""
    w = 44 if not small else 52
    if reverse:
        w -= 3
    L = 116                                # cap-centre to cap-centre length
    th = math.radians(15)
    s, c = (L / 2) * math.sin(th), (L / 2) * math.cos(th)
    gap = 16 if not small else 18          # clear space between the two tops
    D = 2 * s + w + gap                    # centre distance between the pills
    cy = 128
    xl, xr = 128 - D / 2, 128 + D / 2
    left = stadium((xl + s, cy - c), (xl - s, cy + c), w)
    right = stadium((xr - s, cy - c), (xr + s, cy + c), w)
    return [(left, "ink"), (right, "ember")]


# Optical size of each mark inside the horizontal lockup (a ring looks bigger than an arch; thin pills look smaller).
LOCKUP_SCALE = {"a": 1.0, "b": 0.88, "c": 1.12}

MARKS = {"a": ("doorway", mark_a), "b": ("gap", mark_b), "c": ("lean", mark_c)}


# ---------------------------------------------------------------- svg helpers
def paint(parts, scheme):
    """scheme: color | reversed | ink | white"""
    m = {
        "color": {"ink": INK, "ember": EMBER},
        "reversed": {"ink": PAPER, "ember": EMBER},
        "ink": {"ink": INK, "ember": INK},
        "white": {"ink": "#FFFFFF", "ember": "#FFFFFF"},
    }[scheme]
    return "".join(f'<path fill="{m[k]}" d="{d}"/>' for d, k in parts)


def svg(body, title, w=VB, h=VB):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" role="img" '
            f'aria-label="{title}"><title>{title}</title>{body}</svg>\n')


def wordmark(name, font_path, x_height_units=92, tracking=14, color=INK):
    """Outline `name` with the font. Returns (path_markup, width) with the baseline at y=0."""
    font = TTFont(font_path)
    gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
    upm = font["head"].unitsPerEm
    xh = getattr(font["OS/2"], "sxHeight", 0.55 * upm)
    scale = x_height_units / xh
    x, ds = 0.0, []
    for ch in name:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=lambda v: f(v))
        gs[g].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
        ds.append(pen.getCommands())
        x += hmtx[g][0] * scale + tracking
    width = x - tracking
    return f'<path fill="{color}" d="{"".join(ds)}"/>', width


def lockup(parts, scheme, name, font_path, dark=False, k=1.0):
    wm_color = PAPER if dark else INK
    x_h = 92
    wm, w = wordmark(name, font_path, x_height_units=x_h, color=wm_color)
    # x-height band centred on the mark's optical centre (y=128)
    baseline = 128 + x_h / 2
    gap = 22
    total_w = VB + gap + w + 24
    off = 128 * (1 - k)  # scale about the mark centre so it stays centred on the wordmark
    mark = f'<g transform="translate({f(off)},{f(off)}) scale({k})">{paint(parts, scheme)}</g>'
    body = mark + f'<g transform="translate({VB + gap},{f(baseline)})">{wm}</g>'
    return svg(body, f"{name} logo", total_w, VB)


def app_icon(parts, bg, scheme="reversed"):
    size, rad = 1024, 1024 * 0.2237
    scale = size * 0.62 / VB                             # the mark occupies 62% of the tile
    off = (size - VB * scale) / 2
    body = (f'<rect width="{size}" height="{size}" rx="{f(rad)}" fill="{bg}"/>'
            f'<g transform="translate({f(off)},{f(off)}) scale({scale})">{paint(parts, scheme)}</g>')
    return svg(body, "App icon", size, size)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="Connectly")
    ap.add_argument("--font", default="brand/fonts/Poppins-SemiBold.ttf")
    ap.add_argument("--out", default="brand/final")
    a = ap.parse_args()
    name = a.name.lower()
    for key, (slug, builder) in MARKS.items():
        d = f"{a.out}/{key}-{slug}"
        std, small, rev = builder(), builder(small=True), builder(reverse=True)
        title = f"{a.name} mark ({slug})"
        write(f"{d}/{slug}-symbol.svg", svg(paint(std, "color"), title))
        write(f"{d}/{slug}-symbol-reversed.svg", svg(paint(rev, "reversed"), title))
        write(f"{d}/{slug}-symbol-ink.svg", svg(paint(std, "ink"), title))
        write(f"{d}/{slug}-symbol-white.svg", svg(paint(rev, "white"), title))
        write(f"{d}/{slug}-symbol-small.svg", svg(paint(small, "color"), title))
        write(f"{d}/{slug}-horizontal.svg", lockup(std, "color", name, a.font, k=LOCKUP_SCALE[key]))
        write(f"{d}/{slug}-horizontal-reversed.svg", lockup(rev, "reversed", name, a.font, dark=True, k=LOCKUP_SCALE[key]))
        write(f"{d}/{slug}-app-icon.svg", app_icon(small, INK))
    print("built", ", ".join(f"{k}-{v[0]}" for k, v in MARKS.items()), "for", a.name)


if __name__ == "__main__":
    main()
