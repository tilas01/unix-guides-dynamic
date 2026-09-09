#!/usr/bin/env python3
"""
Generate the *nix Install Guides icon set, favicons and README banners.

Everything here is deterministic and dependency-free: no Pillow, no cairo, no
network. Given the same source grids you get byte-identical output, which is the
same property the Rust builds aim for. Run it from the repository root:

    python scripts/gen-icons.py

Outputs
  img/icons/<name>.svg          scalable, shape-rendering:crispEdges
  img/icons/<name>-<N>.png      raster at 16/32/64/128/256
  img/icons/<name>.ico          multi-size favicon (16/32/48/64)
  img/banners/<name>.png        README banner, icon + pixel-font wordmark
  website/img/...               a copy of the above, for the site

Why hand-authored 16x16 grids: at icon sizes an anti-aliased vector reduces to
mush. A pixel grid is the artwork, so what ships is exactly what was drawn.
"""

from __future__ import annotations

import os
import struct
import sys
import zlib

# ── Tokyo Night palette ───────────────────────────────────────────────────────
# One character per colour so the grids below stay readable as ASCII art.
# Magenta/purple is the family colour; each tool gets one accent on top of it.
PALETTE = {
    ".": None,              # transparent
    "K": (0x13, 0x14, 0x1C),  # bg-dark      (outlines, shadow)
    "k": (0x1A, 0x1B, 0x26),  # bg           (fills behind glyphs)
    "s": (0x24, 0x28, 0x3B),  # surface
    "d": (0x41, 0x48, 0x68),  # border/dim
    "w": (0xC0, 0xCA, 0xF5),  # foreground light
    "f": (0xA9, 0xB1, 0xD6),  # foreground
    "m": (0xBB, 0x9A, 0xF7),  # magenta/purple  ← family colour
    "M": (0x9D, 0x7C, 0xD8),  # magenta, deeper shade
    "b": (0x7A, 0xA2, 0xF7),  # blue
    "c": (0x7D, 0xCF, 0xFF),  # cyan
    "g": (0x9E, 0xCE, 0x6A),  # green
    "r": (0xF7, 0x76, 0x8E),  # red
    "o": (0xFF, 0x9E, 0x64),  # orange
    "y": (0xE0, 0xAF, 0x68),  # yellow
}

BG_BANNER = (0x1A, 0x1B, 0x26)

# ── The icons ─────────────────────────────────────────────────────────────────
# 16x16. Bold and geometric on purpose: detail that cannot survive a 16px
# favicon is detail that should not be drawn.

ICONS: dict[str, dict] = {}


def icon(name: str, label: str, subtitle: str, accent: str, grid: str) -> None:
    rows = [r for r in grid.strip("\n").split("\n")]
    assert len(rows) == 16, f"{name}: {len(rows)} rows, expected 16"
    for i, r in enumerate(rows):
        assert len(r) == 16, f"{name}: row {i} is {len(r)} wide, expected 16"
        for ch in r:
            assert ch in PALETTE, f"{name}: unknown palette char {ch!r}"
    ICONS[name] = {"grid": rows, "label": label, "subtitle": subtitle,
                   "accent": accent}


# The Arch mountain. Site mark, and the shape reused inside the suite shield.
icon("arch-guides", "ARCH INSTALL GUIDES", "DYNAMIC INSTALL GENERATOR", "m", """
................
.......mm.......
.......mm.......
......mmmm......
......mmmm......
.....mmmmmm.....
.....mm..mm.....
....mmm..mmm....
....mm....mm....
...mmm....mmm...
...mm......mm...
..mmm.mmmm.mmm..
..mm.mmmmmm.mm..
.mmmmmm..mmmmmm.
.mmmm......mmmm.
................
""")

# ── Per-OS marks ──────────────────────────────────────────────────────────────
# One set, drawn to the same rules as the Arch mountain above: 16x16, centred,
# silhouette-first, and the shape doing the work rather than detail. They are
# seen side by side in the OS switcher, so a single one drawn at a different
# weight or scale would look wrong next to the rest.
#
# Mascots, correctly: FreeBSD's Beastie is a *daemon* (the BSD pun) with horns
# and a trident, not a devil. OpenBSD's Puffy is a pufferfish. Gentoo's logo is
# the "g" swirl — Larry the cow is the mascot, but the swirl is the mark.

# Tux, for the neutral *nix banner shown before an OS is chosen.
#
# The wordmark carries the acronym and the subtitle expands it, because "SIT"
# on its own is a name nobody can guess the meaning of. The repository is
# `Unix-SIT` rather than `*nix-SIT` only because GitHub repository names are
# ASCII, and `*` is not in the set it accepts — the banner is under no such
# constraint, so it says the real name.
icon("unix-guides", "*NIX-SIT", "SECURE INSTALLATION TUTORIALS", "m", """
................
......KKKK......
.....KKKKKK.....
....KKwKKwKK....
....KKKKKKKK....
....KKKooKKK....
....KKKKKKKK....
...KKKwwwwKKK...
...KKwwwwwwKK...
..KKKwwwwwwKKK..
..KKwwwwwwwwKK..
..KKwwwwwwwwKK..
..KKKwwwwwwKKK..
...KKKwwwwKKK...
...oo.KKKK.oo...
................
""")

# The Gentoo "g" swirl.
icon("gentoo-guides", "GENTOO INSTALL GUIDES", "THE GENTOO INSTALL GENERATOR", "m", """
................
.....mmmmmm.....
...mmmmmmmmmm...
..mmmm....mmmm..
..mmm......mmm..
..mm........mm..
..mm............
..mm....mmmmmm..
..mm....mmmmmm..
..mm........mm..
..mmm......mmm..
..mmmm....mmmm..
...mmmmmmmmmm...
.....mmmmmm.....
..........mm....
................
""")

# Beastie: horned daemon head.
icon("freebsd-guides", "FREEBSD INSTALL GUIDES", "THE FREEBSD INSTALL GENERATOR", "r", """
................
..rr........rr..
..rrr......rrr..
...rrr....rrr...
....rrrrrrrr....
...rrrrrrrrrr...
..rrrrrrrrrrrr..
..rrwwrrrrwwrr..
..rrrrrrrrrrrr..
..rrrrKKKKrrrr..
..rrrrrrrrrrrr..
...rrrrrrrrrr...
....rrrrrrrr....
.....rrrrrr.....
......rrrr......
................
""")

# A raspberry. Deliberately the fruit and not the Raspberry Pi logo, which is a
# registered trademark — the same reason the repository control is a drawn
# octopus rather than the GitHub mark. Naming the OS in text is nominative use
# and unavoidable; reproducing the logo is not.
icon("raspios-guides", "RASPBERRY PI INSTALL GUIDES",
     "THE RASPBERRY PI OS INSTALL GENERATOR", "r", """
................
......gg.g......
.....g.ggg......
....ggg.g.g.....
.....ggggg......
.......g........
....rrrrrrr.....
...rrrrrrrrr....
..rrrrrrrrrrr...
..rrrrrrrrrrr...
..rrrrrrrrrrr...
...rrrrrrrrr....
....rrrrrrr.....
.....rrrrr......
......rrr.......
................
""")

# Puffy: pufferfish, spines out.
icon("openbsd-guides", "OPENBSD INSTALL GUIDES", "THE OPENBSD INSTALL GENERATOR", "g", """
................
....g.g..g.g....
.....gggggg.....
...gggggggggg...
..gggggggggggg..
.gggwwggggwwggg.
.gggwwggggwwggg.
.gggggggggggggg.
.ggggggKKgggggg.
.gggggKKKKggggg.
.gggggggggggggg.
..gggggggggggg..
...gggggggggg...
....g.gggg.g....
...g...oo...g...
................
""")


# Shield with the mountain inside it: the all-in-one binary.
icon("unix-security-suite", "SECURITY SUITE", "ALL FIVE TOOLS, ONE BINARY", "m", """
................
..wwwwwwwwwwww..
..wMMMMMMMMMMw..
..wMMMMwwMMMMw..
..wMMMwwwwMMMw..
..wMMMwwwwMMMw..
..wMMwwMMwwMMw..
..wMMwwMMwwMMw..
..wMwwMMMMwwMw..
..wMwwMwwMwwMw..
..wwwwwwwwwwww..
...wMMMMMMMMw...
....wMMMMMMw....
.....wMMMMw.....
......wMMw......
.......ww.......
""")

# The duck itself. The tool is named for the attack it refuses — the Rubber
# Ducky — so the mark is the duck, and the wordmark and subtitle say what
# happens to it. A struck-through keyboard was tried first and a slash drawn
# across the duck after that; at 16px the strike ate the beak and the result
# read as neither a duck nor a prohibition. Silhouette-first, like the rest.
icon("anti-ducky", "ANTI-DUCKY", "BLOCKS BADUSB KEYSTROKE INJECTION", "y", """
................
.....yyyy.......
....yyyyyy......
....yyKyyy......
....yyyyyyoooo..
....yyyyyyoo....
.....yyyyy......
..yyyyyyyyy.....
.yyyyyyyyyyy....
yyyyyyyyyyyyy...
.yyyyyyyyyyyy...
..yyyyyyyyyy....
...yyyyyyyy.....
....yyyyyy......
................
................
""")

# Padlock, shackle closed, keyhole: boot integrity before you type the passphrase.
icon("anti-evil-maid", "ANTI EVIL MAID", "BOOT INTEGRITY VERIFICATION", "m", """
................
.....mmmmmm.....
....mm....mm....
....mm....mm....
...mm......mm...
...mm......mm...
..wwwwwwwwwwww..
..wMMMMMMMMMMw..
..wMMM.KK.MMMw..
..wMM.KKKK.MMw..
..wMM.KKKK.MMw..
..wMMM.KK.MMMw..
..wMMMM.KKMMMw..
..wMMMMMMMMMMw..
..wwwwwwwwwwww..
................
""")

# An eye set in a chip: something is watching the kernel's neighbourhood.
icon("kernel-watcher", "KERNEL WATCHER", "FILESYSTEM AND ROOTKIT MONITOR", "c", """
................
...d.d.d..d.d...
...dddddddddd...
.ddd........ddd.
.d.d..cccc..d.d.
.ddd.cccccc.ddd.
.d.dcccKKcccd.d.
.dddccKKKKccddd.
.d.dccKKKKccd.d.
.dddcccKKcccddd.
.d.d.cccccc.d.d.
.ddd..cccc..ddd.
.d.d........d.d.
...dddddddddd...
...d.d.d..d.d...
................
""")

# A key: one-time passwords, no proprietary authenticator app required.
icon("libre-otp", "LIBRE OTP", "TOTP AND HOTP, NO CLOUD, NO BLOBS", "g", """
................
....gggggg......
...gg....gg.....
..gg......gg....
..gg..KK..gg....
..gg.KKKK.gg....
..gg..KK..gg....
...gg....gg.....
....gggggg......
......gg........
......gg........
......ggggg.....
......gg..g.....
......gg........
......ggggg.....
......gg..g.....
""")

# Straw hat, stitched eyes: a decoy that convinces malware it is being watched.
icon("scarecrow", "SCARECROW", "CANARY TOKENS AND SANDBOX SPOOFING", "o", """
................
......oooo......
.....oooooo.....
..oooooooooooo..
..oooooooooooo..
....yyyyyyyy....
....yr.yy.ry....
....y.r..r.y....
....yr.yy.ry....
....yyy..yyy....
....yyyyyyyy....
.....yyyyyy.....
.......oo.......
......oooo......
.....oo..oo.....
....oo....oo....
""")

# The source repository control. An octopus, drawn rather than borrowed: the
# GitHub mark is a trademark, and a pixel octopus fits the rest of the set.
icon("source-repo", "SOURCE REPO", "EVERY PAGE, SCRIPT AND TOOL, IN THE OPEN", "m", """
................
.....mmmmmm.....
....mmmmmmmm....
...mmmmmmmmmm...
...mmwwmmwwmm...
...mmwKmmwKmm...
...mmmmmmmmmm...
...mmmmmmmmmm...
...mmmmmmmmmm...
..mmmmmmmmmmmm..
..mm.mm..mm.mm..
.mm..mm..mm..mm.
.mm.mm....mm.mm.
.m..mm....mm..m.
....m......m....
................
""")

# A shield over a card slot: the boot partition, watched. Green rather than the
# red the other boot tool uses, because this one reports and never enforces.
icon("pi-boot-guard", "PI BOOT GUARD", "RASPBERRY PI BOOT INTEGRITY", "g", """
................
................
..gggggggggggg..
.gggggggggggggg.
.gg..........gg.
.gg.gggggggg.gg.
.gg.gg....gg.gg.
.gg.gg.KK.gg.gg.
.gg.gg.KK.gg.gg.
.gg.gggggggg.gg.
.gg..........gg.
.gggggggggggggg.
..gggggggggggg..
...gggggggggg...
.....gggggg.....
................
""")

# A package under a lens: read the PKGBUILD before makepkg runs it.
icon("aur-guard", "AUR GUARD", "AUDITS PKGBUILDS BEFORE MAKEPKG RUNS", "y", """
................
..yyyyyyyyyy....
..y........y....
..y.yyyyyy.y....
..y.y....y.y....
..y.y....y.y....
..y.yyyyyy.y....
..y........y....
..yyyyyyyyyy....
.......ccccc....
......cc...cc...
......c.....c...
......c.....c...
......cc...cc...
.......ccccc.c..
..............cc
""")

# ── 5x7 pixel font, for the banner wordmarks ──────────────────────────────────
# Terminal-shaped by design: the whole project is a monospace/terminal thing, so
# the banners use a bitmap font rather than whatever font a viewer happens to
# have installed. That also keeps the PNGs reproducible on any machine.

FONT: dict[str, list[str]] = {
    " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "B": ["####.", "#...#", "####.", "#...#", "#...#", "#...#", "####."],
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "E": ["#####", "#....", "####.", "#....", "#....", "#....", "#####"],
    "F": ["#####", "#....", "####.", "#....", "#....", "#....", "#...."],
    "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "I": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
    "J": ["####.", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    "N": ["#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
    "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
    ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
    ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
    "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
    ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
    "_": [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
    "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
    "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
    # Needed for the "*nix" wordmark. Drawn in the top half of the cell rather
    # than centred, which is where an asterisk sits in a real typeface, and
    # squarer than a typographic one because a 5x7 grid cannot do six arms.
    "*": ["#.#.#", ".###.", "#####", ".###.", "#.#.#", ".....", "....."],
    "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
    "'": ["..#..", "..#..", ".....", ".....", ".....", ".....", "....."],
    "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
    ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
}

FONT_W, FONT_H, FONT_TRACK = 5, 7, 1


# ── PNG writer ────────────────────────────────────────────────────────────────

def write_png(path: str, pixels: list[list[tuple | None]]) -> None:
    """RGBA PNG. pixels[y][x] is an (r,g,b) tuple or None for transparent."""
    h, w = len(pixels), len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type 0 (None) — keeps output deterministic
        for px in row:
            if px is None:
                raw += b"\x00\x00\x00\x00"
            else:
                raw += bytes((px[0], px[1], px[2], 255))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)


def write_ico(path: str, sizes: list[int], grid: list[str]) -> None:
    """Multi-size ICO wrapping PNG-encoded frames (Vista+ reads PNG in ICO)."""
    frames = []
    for s in sizes:
        px = scale(grid_to_pixels(grid), s // 16)
        tmp = path + f".{s}.tmp"
        write_png(tmp, px)
        with open(tmp, "rb") as fh:
            frames.append((s, fh.read()))
        os.remove(tmp)

    header = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries, blobs = b"", b""
    for s, data in frames:
        entries += struct.pack("<BBBBHHII",
                               0 if s >= 256 else s, 0 if s >= 256 else s,
                               0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    with open(path, "wb") as fh:
        fh.write(header + entries + blobs)


# ── Grid helpers ──────────────────────────────────────────────────────────────

def grid_to_pixels(grid: list[str]) -> list[list[tuple | None]]:
    return [[PALETTE[ch] for ch in row] for row in grid]


def scale(px: list[list], factor: int) -> list[list]:
    if factor <= 1:
        return [row[:] for row in px]
    out = []
    for row in px:
        big = []
        for cell in row:
            big.extend([cell] * factor)
        out.extend([big[:] for _ in range(factor)])
    return out


def svg_from_grid(grid: list[str], name: str) -> str:
    """One <rect> per run of identical colour — smaller files, same result."""
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" '
        'width="16" height="16" shape-rendering="crispEdges" '
        f'role="img" aria-label="{name}">',
    ]
    for y, row in enumerate(grid):
        x = 0
        while x < 16:
            ch = row[x]
            run = 1
            while x + run < 16 and row[x + run] == ch:
                run += 1
            if PALETTE[ch] is not None:
                r, g, b = PALETTE[ch]
                parts.append(
                    f'<rect x="{x}" y="{y}" width="{run}" height="1" '
                    f'fill="#{r:02x}{g:02x}{b:02x}"/>')
            x += run
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def draw_text(px, text, ox, oy, colour, scale_factor=1):
    """Blit the bitmap font. Unknown characters render as a space."""
    cx = ox
    for chpos in text.upper():
        glyph = FONT.get(chpos, FONT[" "])
        for gy, grow in enumerate(glyph):
            for gx, bit in enumerate(grow):
                if bit != "#":
                    continue
                for sy in range(scale_factor):
                    for sx in range(scale_factor):
                        y = oy + gy * scale_factor + sy
                        x = cx + gx * scale_factor + sx
                        if 0 <= y < len(px) and 0 <= x < len(px[0]):
                            px[y][x] = colour
        cx += (FONT_W + FONT_TRACK) * scale_factor
    return cx


def text_width(text, scale_factor=1):
    return len(text) * (FONT_W + FONT_TRACK) * scale_factor


# ── Banner ────────────────────────────────────────────────────────────────────

BANNER_W, BANNER_H, BANNER_SCALE = 960, 200, 1


def make_banner(name: str, spec: dict, credit: bool = True) -> list[list]:
    """Icon on the left, wordmark and subtitle on the right, on a flat field.

    Deliberately no gradient: the whole design language here is flat Tokyo Night
    tints, and a gradient in a README banner would be the one place it appears.

    `credit=False` leaves the attribution line out. Two variants exist because
    they are read in two different ways. In a README the image is the whole
    thing, at whatever width the page gives it, and the credit has to travel
    inside it. On the site the banner is scaled down to a few hundred pixels by
    `.banner`'s max-width, and a 7px-tall bitmap line inside it becomes
    unreadable — so the site uses this variant and draws the credit as real
    text underneath, which scales with the viewport instead of against it.
    """
    w, h = BANNER_W, BANNER_H
    px = [[BG_BANNER for _ in range(w)] for _ in range(h)]

    accent = PALETTE[spec["accent"]]
    border = PALETTE["d"]

    # 2px frame
    for x in range(w):
        px[0][x] = px[1][x] = border
        px[h - 2][x] = px[h - 1][x] = border
    for y in range(h):
        px[y][0] = px[y][1] = border
        px[y][w - 2] = px[y][w - 1] = border

    # Accent rule under the wordmark area
    for x in range(2, w - 2):
        px[h - 8][x] = accent
        px[h - 7][x] = accent

    # Icon, 16x16 scaled 8x = 128px, vertically centred
    icon_px = scale(grid_to_pixels(spec["grid"]), 8)
    iy = (h - 128) // 2
    ix = 28
    for y, row in enumerate(icon_px):
        for x, cell in enumerate(row):
            if cell is not None:
                px[iy + y][ix + x] = cell

    tx = ix + 128 + 36
    label = spec["label"]
    sub = spec["subtitle"]

    # Shrink the title scale until it fits rather than letting it overflow.
    tscale = 5
    while tscale > 1 and tx + text_width(label, tscale) > w - 28:
        tscale -= 1
    sscale = 2
    while sscale > 1 and tx + text_width(sub, sscale) > w - 28:
        sscale -= 1

    # Attribution is part of the image rather than page furniture, so it travels
    # with the banner wherever it is embedded — README, wiki, a forum post, a
    # screenshot — instead of only existing on the site that overlaid it.
    credit_text = "BY TILAS01 ON GITHUB"
    cscale = 2
    while cscale > 1 and tx + text_width(credit_text, cscale) > w - 28:
        cscale -= 1

    title_h = FONT_H * tscale
    sub_h = FONT_H * sscale
    credit_h = FONT_H * cscale if credit else 0
    gap = 18
    credit_gap = 10 if credit else 0
    block_h = title_h + gap + sub_h + credit_gap + credit_h
    ty = (h - block_h) // 2 - 4

    draw_text(px, label, tx, ty, PALETTE["w"], tscale)
    draw_text(px, sub, tx, ty + title_h + gap, accent, sscale)
    if credit:
        # Green regardless of the banner's accent: it reads as attribution
        # rather than as another line of the subtitle, and stays consistent
        # across the set.
        draw_text(px, credit_text, tx, ty + title_h + gap + sub_h + credit_gap,
                  PALETTE["g"], cscale)

    return px


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    icon_dir = os.path.join(root, "img", "icons")
    banner_dir = os.path.join(root, "img", "banners")
    site_icon_dir = os.path.join(root, "website", "img", "icons")
    site_banner_dir = os.path.join(root, "website", "img", "banners")
    for d in (icon_dir, banner_dir, site_icon_dir, site_banner_dir):
        os.makedirs(d, exist_ok=True)

    written = 0
    for name, spec in ICONS.items():
        grid = spec["grid"]

        svg = svg_from_grid(grid, spec["label"])
        for d in (icon_dir, site_icon_dir):
            with open(os.path.join(d, f"{name}.svg"), "w",
                      encoding="utf-8", newline="\n") as fh:
                fh.write(svg)
            written += 1

        base = grid_to_pixels(grid)
        for size in (16, 32, 64, 128, 256):
            data = scale(base, size // 16)
            for d in (icon_dir, site_icon_dir):
                write_png(os.path.join(d, f"{name}-{size}.png"), data)
                written += 1

        for d in (icon_dir, site_icon_dir):
            write_ico(os.path.join(d, f"{name}.ico"), [16, 32, 48, 64], grid)
            written += 1

        banner = make_banner(name, spec)
        for d in (banner_dir, site_banner_dir):
            write_png(os.path.join(d, f"{name}.png"), banner)
            written += 1

        # Site variant: no baked credit line. The site scales the banner down to
        # a few hundred pixels, which reduced the attribution to an unreadable
        # smudge, so shared-ui.js draws it as real text underneath instead.
        write_png(os.path.join(site_banner_dir, f"{name}-plain.png"),
                  make_banner(name, spec, credit=False))
        written += 1

    # Per-crate assets. The tool READMEs already point at assets/icon.png and
    # assets/banner.png, and the Rust binaries include assets/icon-64.png at
    # compile time, so the artwork has exactly one source of truth: this file.
    for name in ("anti-ducky", "anti-evil-maid", "kernel-watcher", "libre-otp",
                 "scarecrow", "unix-security-suite", "aur-guard",
                 "pi-boot-guard"):
        crate = os.path.join(root, "security-tools", name)
        if not os.path.isdir(crate):
            continue
        spec = ICONS[name]
        grid = spec["grid"]
        for sub in ("assets", "img"):
            d = os.path.join(crate, sub)
            os.makedirs(d, exist_ok=True)
            write_png(os.path.join(d, "icon.png"),
                      scale(grid_to_pixels(grid), 16))      # 256px
            write_png(os.path.join(d, "icon-64.png"),
                      scale(grid_to_pixels(grid), 4))       # embedded in binary
            write_png(os.path.join(d, "banner.png"), make_banner(name, spec))
            with open(os.path.join(d, "icon.svg"), "w",
                      encoding="utf-8", newline="\n") as fh:
                fh.write(svg_from_grid(grid, spec["label"]))
            # Raw 64x64 RGBA for egui's ViewportBuilder::with_icon. Raw pixels,
            # not a PNG, so the binaries do not have to link an image decoder
            # purely to draw a title-bar icon.
            with open(os.path.join(d, "icon-64.rgba"), "wb") as fh:
                for row in scale(grid_to_pixels(grid), 4):
                    for cell in row:
                        fh.write(b"\x00\x00\x00\x00" if cell is None
                                 else bytes((cell[0], cell[1], cell[2], 255)))
            written += 5

    # The site favicon is the Arch mark.
    write_ico(os.path.join(root, "website", "favicon.ico"), [16, 32, 48, 64],
              ICONS["arch-guides"]["grid"])
    written += 1

    # The default banner keeps its historic file name so existing links stay
    # valid, but it is the neutral *nix one, not Arch's: it is what the README
    # shows and what the site header shows before a system has been chosen.
    # Arch's own banner is still written as img/banners/arch-guides.png and the
    # header swaps to it the moment Arch is selected.
    # The repository copy keeps the credit baked in, because on GitHub the image
    # is shown at full width and travels on its own. The site copy does not, for
    # the reason given above.
    write_png(os.path.join(root, "img", "banner.png"),
              make_banner("unix-guides", ICONS["unix-guides"]))
    write_png(os.path.join(root, "website", "img", "banner.png"),
              make_banner("unix-guides", ICONS["unix-guides"], credit=False))
    written += 2

    print(f"wrote {written} files for {len(ICONS)} icons")
    return 0


if __name__ == "__main__":
    sys.exit(main())
