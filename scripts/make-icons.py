"""Draw the snow crew apps' home-screen icons over a pale snowflake, on the
app's blue. Two options, one per app:

  plow    Plow Command: a white plow blade across the lower half, leaning
          right, with a dark cutting edge.   (the default)
  shovel  Shovel Command: a white snow shovel.

Gold is Inventory and green is Bootprint, so blue keeps the three apart on a
phone's home screen. The snowflake is the icon the crew already knew (Snow
Crew, until 10/20/26); the blade or the shovel says which snow app this is.
Drawn at 4x and scaled down, so the edges are smooth.

Usage: python scripts/make-icons.py [plow|shovel]
       (writes icon-192/512 and the maskable one)
"""
import math
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..")
BLUE = (31, 95, 168)      # --accent in app.css
PALE = (84, 137, 201)     # the snowflake, a step lighter than the blue
WHITE = (255, 255, 255)
DARK = (9, 38, 82)        # the plow's cutting edge: darker than the blue behind it
RIB = (172, 201, 236)     # the plow's stiffening ribs: a faint blue line on the white board
TILT = 30                 # degrees: the shovel leans right, blade at the bottom
LEAN = 0.20               # the plow blade's top edge sits this share of its width right of its foot


def snowflake(draw, cx, cy, r, w, fill):
    """Six arms, each with two pairs of branches. r = arm length, w = stroke."""
    def line(a, b):
        draw.line([a, b], fill=fill, width=w)
        for p in (a, b):  # round the ends
            draw.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=fill)
    for k in range(6):
        t = math.radians(90 + 60 * k)
        tip = (cx + r * math.cos(t), cy - r * math.sin(t))
        line((cx, cy), tip)
        for at, length in ((0.5, 0.32), (0.75, 0.22)):
            base = (cx + r * at * math.cos(t), cy - r * at * math.sin(t))
            for side in (-1, 1):
                b = t + side * math.radians(45)
                line(base, (base[0] + r * length * math.cos(b), base[1] - r * length * math.sin(b)))
    hub = w * 0.9
    draw.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=fill)


def shovel(s, cx, cy, length):
    """A snow shovel on its own layer: D-grip, shaft, a wide scoop with a wear
    strip along the edge. Drawn upright, centred on (cx, cy), then tilted."""
    lay = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    L = length
    top = cy - L / 2
    shaft = L * 0.05
    # D-grip: a rounded ring
    gw, gh = L * 0.20, L * 0.13
    g0, g1 = (cx - gw / 2, top), (cx + gw / 2, top + gh)
    d.rounded_rectangle([g0, g1], radius=int(gh * 0.45), fill=WHITE)
    t = L * 0.04
    d.rounded_rectangle([g0[0] + t, g0[1] + t, g1[0] - t, g1[1] - t], radius=int(gh * 0.25), fill=(0, 0, 0, 0))
    # shaft
    d.rectangle([cx - shaft / 2, top + gh - 1, cx + shaft / 2, top + L * 0.60], fill=WHITE)
    # neck flaring into the scoop
    bw, by0, by1 = L * 0.46, top + L * 0.62, top + L
    d.polygon([(cx - shaft * 0.9, top + L * 0.56), (cx + shaft * 0.9, top + L * 0.56),
               (cx + bw * 0.30, by0), (cx - bw * 0.30, by0)], fill=WHITE)
    d.rounded_rectangle([cx - bw / 2, by0, cx + bw / 2, by1], radius=int(L * 0.05), fill=WHITE)
    # wear strip, in the background blue
    d.line([(cx - bw / 2 + L * 0.03, by1 - L * 0.06), (cx + bw / 2 - L * 0.03, by1 - L * 0.06)],
           fill=BLUE + (255,), width=max(2, int(L * 0.018)))
    return lay.rotate(TILT, resample=Image.BICUBIC, center=(cx, cy))


def _inset(pts, r):
    """Pull a convex polygon's edges in by r (points in order, either winding).
    Used to round corners: fill the shrunken polygon, then stroke its outline."""
    n = len(pts)
    area2 = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    sgn = 1 if area2 > 0 else -1
    edges = []
    for i in range(n):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        k = math.hypot(dx, dy)
        edges.append(((x0 - dy / k * r * sgn, y0 + dx / k * r * sgn), (dx, dy)))  # a point on the moved edge, its direction
    out = []
    for i in range(n):
        (p, d), (q, e) = edges[i - 1], edges[i]
        t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / (d[0] * e[1] - d[1] * e[0])
        out.append((p[0] + t * d[0], p[1] + t * d[1]))  # where the moved edges meet
    return out


def _round_poly(draw, pts, r, fill):
    core = _inset(pts, r)
    draw.polygon(core, fill=fill)
    draw.line(core + [core[0]], fill=fill, width=int(2 * r), joint="curve")
    for x, y in core:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def plow(draw, cx, cy, width):
    """A snow-plow blade seen from the side: a wide white moldboard leaning
    right (its top edge pushed right of its foot, the way a blade is angled to
    roll snow off to one side), a rolled top lip, three stiffening ribs, and the
    dark cutting edge along the bottom, a touch wider than the board.
    (cx, cy) is the middle of the whole blade and `width` is its full width,
    lean included."""
    h = width * 0.34                      # blade height, roll to cutting edge
    lean = width * LEAN
    left, right = cx - width / 2, cx + width / 2
    top, foot = cy - h / 2, cy + h / 2
    roll_h, edge_h, gap, over = h * 0.16, h * 0.22, h * 0.035, width * 0.012
    r = h * 0.06                          # corner rounding

    def off(y):                           # how far right a horizontal slice sits at height y
        return lean * (foot - y) / h

    def slab(y0, y1, grow, rr, fill):    # a sheared rectangle between two heights
        _round_poly(draw, [(left - grow + off(y0), y0), (right - lean + grow + off(y0), y0),
                           (right - lean + grow + off(y1), y1), (left - grow + off(y1), y1)], rr, fill)
    # the rolled lip: a full-width bar along the top, its ends rounded right off
    slab(top, top + roll_h, over, roll_h * 0.45, WHITE)
    # the moldboard under it, and the ribs that stiffen it
    board_top, board_foot = top + roll_h + gap, foot - edge_h - gap
    slab(board_top, board_foot, 0, r, WHITE)
    for t in (0.25, 0.5, 0.75):
        x = left + t * (width - lean)
        draw.line([(x + off(board_top + h * 0.05), board_top + h * 0.05), (x + off(board_foot - h * 0.05), board_foot - h * 0.05)],
                  fill=RIB, width=max(2, int(h * 0.035)))
    # the cutting edge, dark, with the gap above it showing the blue behind
    slab(foot - edge_h, foot, over, r * 0.8, DARK)


def icon(size, flake_share, tool_share, rounded, tool="plow"):
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.18), fill=BLUE)
    else:
        d.rectangle([0, 0, s, s], fill=BLUE)  # maskable: the phone cuts its own shape
    # Stroke scales with the flake, or a smaller flake's branches run together.
    snowflake(d, s / 2, s / 2, s * flake_share / 2, max(4, int(s * flake_share * 0.076)), PALE)
    if tool == "shovel":
        img.alpha_composite(shovel(s, s / 2, s / 2, s * tool_share))
    else:
        plow(d, s / 2, s * (0.5 + 0.2 * tool_share), s * tool_share)  # across the lower half
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    tool = sys.argv[1] if len(sys.argv) > 1 else "plow"
    if tool not in ("plow", "shovel"):
        sys.exit("usage: python scripts/make-icons.py [plow|shovel]")
    # tool_share is the plow blade's width, or the shovel's length, as a share of the icon.
    big = 0.80 if tool == "shovel" else 0.82
    small = 0.60 if tool == "shovel" else 0.62
    icon(192, 0.76, big, True, tool).save(os.path.join(ROOT, "icon-192.png"))
    icon(512, 0.76, big, True, tool).save(os.path.join(ROOT, "icon-512.png"))
    # Maskable: everything that matters inside the middle 80%, so no phone's
    # circle or squircle crop cuts the grip or the blade off.
    icon(512, 0.56, small, False, tool).save(os.path.join(ROOT, "icon-maskable-512.png"))
    print("wrote icon-192.png, icon-512.png, icon-maskable-512.png (" + tool + ")")
