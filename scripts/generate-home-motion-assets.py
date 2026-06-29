from __future__ import annotations

import math
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets" / "home"
FPS = 24
FRAMES = 96
SIZE = (1280, 720)
_BASE_BG: Image.Image | None = None


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


FONT_18 = font(18)
FONT_20 = font(20)
FONT_22 = font(22)
FONT_24 = font(24)
FONT_28 = font(28, True)
FONT_34 = font(34, True)
FONT_42 = font(42, True)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def ease(t: float) -> float:
    return 0.5 - math.cos(t * math.pi) / 2


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4)) + (alpha,)


def blend(c1: str, c2: str, t: float) -> tuple[int, int, int, int]:
    a = rgba(c1)
    b = rgba(c2)
    return tuple(int(lerp(a[i], b[i], t)) for i in range(3)) + (255,)


def base_bg() -> Image.Image:
    global _BASE_BG
    if _BASE_BG is not None:
        return _BASE_BG.copy()
    img = Image.new("RGBA", SIZE, "#f7fbff")
    pix = img.load()
    w, h = SIZE
    for y in range(h):
        for x in range(w):
            v = y / max(1, h - 1)
            cx = (x - w * 0.66) / w
            cy = (y - h * 0.42) / h
            glow = max(0.0, 1.0 - math.sqrt(cx * cx * 3.2 + cy * cy * 5.0))
            c = blend("#f9fcff", "#edf5ff", v)
            pix[x, y] = (
                min(255, int(c[0] + 30 * glow)),
                min(255, int(c[1] + 36 * glow)),
                min(255, int(c[2] + 42 * glow)),
                255,
            )
    _BASE_BG = img
    return img.copy()


def layer_shadow(img: Image.Image, box: tuple[int, int, int, int], radius: int, blur: int = 24, alpha: int = 38, offset: tuple[int, int] = (0, 14)) -> None:
    shadow = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    d = ImageDraw.Draw(shadow)
    shifted = (box[0] + offset[0], box[1] + offset[1], box[2] + offset[0], box[3] + offset[1])
    d.rounded_rectangle(shifted, radius=radius, fill=(37, 99, 235, alpha))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(blur)))


def rounded(img: Image.Image, box: tuple[int, int, int, int], radius: int, fill: str | tuple[int, int, int, int], outline: str | tuple[int, int, int, int] | None = None, width: int = 1) -> None:
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], value: str, fill: str | tuple[int, int, int, int], fnt: ImageFont.FreeTypeFont = FONT_20) -> None:
    draw.text(xy, value, fill=fill, font=fnt)


def curve_points(points: list[tuple[float, float]], steps: int = 80) -> list[tuple[float, float]]:
    if len(points) == 3:
        p0, p1, p2 = points
        return [
            (
                (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t**2 * p2[0],
                (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t**2 * p2[1],
            )
            for t in (i / steps for i in range(steps + 1))
        ]
    p0, p1, p2, p3 = points
    return [
        (
            (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t**2 * p2[0] + t**3 * p3[0],
            (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t**2 * p2[1] + t**3 * p3[1],
        )
        for t in (i / steps for i in range(steps + 1))
    ]


def draw_curve(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], color: str, width: int = 4, alpha: int = 120) -> list[tuple[float, float]]:
    pts = curve_points(points)
    draw.line(pts, fill=rgba(color, alpha), width=width, joint="curve")
    return pts


def moving_dot(draw: ImageDraw.ImageDraw, pts: list[tuple[float, float]], t: float, color: str, r: int = 8) -> None:
    idx = int((len(pts) - 1) * (t % 1))
    x, y = pts[idx]
    draw.ellipse((x - r, y - r, x + r, y + r), fill=rgba(color, 230))
    draw.ellipse((x - r * 2.0, y - r * 2.0, x + r * 2.0, y + r * 2.0), outline=rgba(color, 50), width=3)


def icon_square(img: Image.Image, x: int, y: int, color: str, label: str) -> None:
    d = ImageDraw.Draw(img)
    rounded(img, (x, y, x + 46, y + 46), 13, rgba(color, 235))
    text(d, (x + 13, y + 10), label, "white", FONT_22)


def card(img: Image.Image, box: tuple[int, int, int, int], title: str, color: str, body_lines: int = 3, icon: str = "") -> None:
    layer_shadow(img, box, 24, blur=18, alpha=24, offset=(0, 10))
    rounded(img, box, 24, rgba("#ffffff", 218), rgba("#cbdaf3", 190), 2)
    d = ImageDraw.Draw(img)
    icon_square(img, box[0] + 26, box[1] + 24, color, icon or title[:1])
    text(d, (box[0] + 88, box[1] + 27), title, "#1e293b", FONT_22)
    for i in range(body_lines):
        width = [186, 138, 220, 160][i % 4]
        y = box[1] + 74 + i * 24
        rounded(img, (box[0] + 88, y, box[0] + 88 + width, y + 9), 5, rgba("#9db9da", 130))


def notebook_panel(img: Image.Image, box: tuple[int, int, int, int], progress: float, title: str = "Knowledge notebook") -> None:
    layer_shadow(img, box, 28, blur=28, alpha=35, offset=(0, 14))
    rounded(img, box, 28, rgba("#ffffff", 228), rgba("#bed0ee", 210), 2)
    d = ImageDraw.Draw(img)
    text(d, (box[0] + 38, box[1] + 34), title, "#0f172a", FONT_24)
    rounded(img, (box[0] + 38, box[1] + 82, box[2] - 40, box[1] + 92), 5, rgba("#d8e4f4", 255))
    rounded(img, (box[0] + 38, box[1] + 82, int(lerp(box[0] + 38, box[2] - 40, progress)), box[1] + 92), 5, rgba("#3b82f6", 255))
    for i, label in enumerate(["Summary", "Themes", "Citations"]):
        y = box[1] + 128 + i * 78
        rounded(img, (box[0] + 38, y, box[2] - 40, y + 48), 16, rgba("#f3f7fd", 235))
        text(d, (box[0] + 58, y + 12), label, "#475569", FONT_18)
        rounded(img, (box[0] + 158, y + 18, box[2] - 80 - i * 38, y + 26), 5, rgba("#a7bedc", 120))
    check_x = box[2] - 82
    check_y = box[1] + 42
    d.ellipse((check_x, check_y, check_x + 42, check_y + 42), fill=rgba("#22c55e", 235))
    d.line([(check_x + 11, check_y + 22), (check_x + 19, check_y + 30), (check_x + 31, check_y + 14)], fill="white", width=5)


def draw_wave(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], t: float, color: str) -> None:
    x1, y1, x2, y2 = box
    count = 52
    step = (x2 - x1) / count
    cy = (y1 + y2) / 2
    for i in range(count):
        phase = t * math.tau + i * 0.42
        amp = 0.28 + 0.72 * abs(math.sin(phase))
        h = lerp(8, y2 - y1, amp)
        x = x1 + i * step
        draw.rounded_rectangle((x, cy - h / 2, x + step * 0.45, cy + h / 2), radius=3, fill=rgba(color, 170 + int(50 * amp)))


def render_hero(frame: int) -> Image.Image:
    t = frame / FRAMES
    img = base_bg()
    d = ImageDraw.Draw(img)
    for i, cfg in enumerate([
        (120, 140, "Website", "#10b981", "W", 0.0),
        (210, 392, "PDF Notes", "#3b82f6", "P", 0.35),
        (875, 190, "Audio Overview", "#8b5cf6", "A", 0.7),
        (820, 472, "Slide Deck", "#f59e0b", "S", 1.05),
    ]):
        x, y, title, color, ic, delay = cfg
        yy = int(y + math.sin(t * math.tau + delay) * 10)
        card(img, (x, yy, x + 300, yy + 128), title, color, 2, ic)
    paths = [
        [(280, 210), (520, 220), (650, 332)],
        [(360, 470), (535, 415), (650, 360)],
        [(900, 258), (760, 270), (660, 332)],
        [(850, 520), (760, 452), (660, 380)],
    ]
    colors = ["#60a5fa", "#2dd4bf", "#8b5cf6", "#f59e0b"]
    for i, pts in enumerate(paths):
        p = draw_curve(d, pts, colors[i], width=4, alpha=110)
        moving_dot(d, p, t + i * 0.18, colors[i], 7)

    layer_shadow(img, (540, 266, 742, 468), 42, blur=32, alpha=44, offset=(0, 16))
    rounded(img, (540, 266, 742, 468), 42, rgba("#ffffff", 230), rgba("#c7d8f2", 230), 2)
    logo = ROOT / "public" / "assets" / "brand" / "lingbi-logo-round.png"
    if logo.exists():
        mark = Image.open(logo).convert("RGBA").resize((118, 118), Image.Resampling.LANCZOS)
        img.alpha_composite(mark, (582, 294))
    text(d, (577, 424), "KnowTrail", "#0f172a", FONT_24)

    bar = (300, 500, 980, 592)
    layer_shadow(img, bar, 42, blur=24, alpha=42, offset=(0, 12))
    rounded(img, bar, 42, rgba("#ffffff", 238), rgba("#cfdef2", 230), 2)
    d.ellipse((336, 522, 398, 584), fill=rgba("#2563eb", 255))
    d.rounded_rectangle((360, 539, 368, 566), radius=3, fill="white")
    d.rounded_rectangle((377, 539, 385, 566), radius=3, fill="white")
    text(d, (430, 536), "1:42", "#334155", FONT_20)
    rounded(img, (510, 548, 790, 558), 6, rgba("#d7e1ee", 255))
    prog = 0.44 + 0.12 * math.sin(t * math.tau)
    rounded(img, (510, 548, int(510 + 280 * prog), 558), 6, rgba("#2563eb", 255))
    knob_x = int(510 + 280 * prog)
    d.ellipse((knob_x - 13, 543, knob_x + 13, 569), fill=rgba("#4f46e5", 255))
    text(d, (820, 536), "3:01", "#64748b", FONT_20)
    return img


def render_upload(frame: int) -> Image.Image:
    t = frame / FRAMES
    img = base_bg()
    d = ImageDraw.Draw(img)

    d.ellipse((455, 80, 1035, 660), fill=rgba("#dff3ff", 72))
    d.ellipse((70, 120, 500, 600), fill=rgba("#eef7e8", 70))
    rounded(img, (610, 138, 1178, 596), 38, rgba("#ffffff", 112), rgba("#dbeafe", 130), 1)

    sources = [
        (92, 144, "PDF", "#ef4444", "P", 0.0),
        (84, 330, "Website", "#10b981", "W", 0.5),
        (356, 246, "Audio", "#7c3aed", "A", 1.0),
        (368, 62, "Notes", "#2563eb", "N", 1.5),
    ]
    for x, y, title, color, ic, phase in sources:
        yy = int(y + math.sin(t * math.tau + phase) * 8)
        card(img, (x, yy, x + 284, yy + 132), title, color, 2, ic)
        p = draw_curve(d, [(x + 284, yy + 66), (565, yy + 80), (704, 360)], color, width=4, alpha=120)
        moving_dot(d, p, t + phase * 0.11, color, 6)

    hub = (654, 304, 754, 404)
    layer_shadow(img, hub, 34, blur=22, alpha=28, offset=(0, 12))
    rounded(img, hub, 34, rgba("#ffffff", 232), rgba("#bfd4ef", 235), 2)
    d.ellipse((682, 332, 726, 376), fill=rgba("#2563eb", 255))
    d.line([(696, 354), (713, 354)], fill="white", width=5)
    d.line([(704, 346), (704, 362)], fill="white", width=5)
    p = draw_curve(d, [(754, 354), (800, 342), (840, 326)], "#2563eb", width=4, alpha=110)
    moving_dot(d, p, t + 0.48, "#2563eb", 7)

    notebook_panel(img, (828, 160, 1162, 560), 0.46 + 0.38 * ease((math.sin(t * math.tau) + 1) / 2), "KnowTrail")
    for i, (label, color) in enumerate([("PDF", "#ef4444"), ("URL", "#10b981"), ("Audio", "#7c3aed")]):
        x = 884 + i * 82
        y = 508 + int(math.sin(t * math.tau + i * 0.9) * 4)
        rounded(img, (x, y, x + 66, y + 30), 15, rgba("#f8fbff", 232), rgba(color, 95), 1)
        text(d, (x + 15, y + 5), label, color, FONT_18)
    return img


def render_citations(frame: int) -> Image.Image:
    t = frame / FRAMES
    img = base_bg()
    d = ImageDraw.Draw(img)

    breath = 0.5 + 0.5 * math.sin(t * math.tau)
    d.ellipse((612, 44, 1240, 650), fill=rgba("#e7efff", 74 + int(18 * breath)))
    d.ellipse((36, 332, 590, 744), fill=rgba("#eaf8ef", 66 + int(12 * breath)))
    rounded(img, (64, 64, 1216, 648), 46, rgba("#ffffff", 96), rgba("#dbeafe", 118), 1)

    colors = ["#2563eb", "#10b981", "#8b5cf6"]

    question_box = (104, 104, 524, 170)
    layer_shadow(img, question_box, 32, blur=18, alpha=16, offset=(0, 8))
    rounded(img, question_box, 32, rgba("#ffffff", 238), rgba("#cbdaf0", 230), 2)
    text(d, (132, 134), "What supports this point?", "#334155", FONT_22)
    rounded(img, (446, 121, 494, 153), 16, rgba("#eff6ff", 255), rgba("#bfdbfe", 255), 1)
    text(d, (464, 126), "?", "#2563eb", FONT_18)

    answer_box = (112, 218, 704, 566)
    layer_shadow(img, answer_box, 34, blur=34, alpha=34, offset=(0, 16))
    rounded(img, answer_box, 34, rgba("#ffffff", 240), rgba("#c6d7ef", 230), 2)
    answer_glow = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    ag = ImageDraw.Draw(answer_glow)
    ag.rounded_rectangle((130, 354, 612, 404), radius=18, fill=rgba("#2563eb", 12 + int(22 * breath)))
    img.alpha_composite(answer_glow.filter(ImageFilter.GaussianBlur(18)))
    rounded(img, (154, 258, 326, 294), 18, rgba("#eef6ff", 255), rgba("#cfe0f7", 220), 1)
    d.ellipse((172, 268, 188, 284), fill=rgba("#2563eb", 235))
    text(d, (202, 264), "Grounded answer", "#1e293b", FONT_20)
    y = 336
    widths = [390, 456, 336, 420]
    for i, w in enumerate(widths):
        rounded(img, (154, y + i * 34, 154 + w, y + 12 + i * 34), 6, rgba("#b7c9e3", 132))
    pulse = int(118 + 58 * breath)
    highlight_width = int(372 + 36 * breath)
    rounded(img, (154, 370, 154 + highlight_width, 388), 8, rgba("#bfdbfe", pulse))
    for i, label in enumerate(["[1]", "[2]", "[3]"]):
        x = 420 + i * 64
        color = colors[i]
        fill = rgba(color, 62 + int(74 * breath) if i == 0 else 34)
        outline = rgba(color, 145 + int(55 * breath) if i == 0 else 92)
        text_fill = color
        if i == 0:
            glow = Image.new("RGBA", SIZE, (0, 0, 0, 0))
            gd = ImageDraw.Draw(glow)
            gd.rounded_rectangle((x - 5, 495, x + 57, 539), radius=22, fill=rgba(color, 16 + int(26 * breath)))
            img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(10)))
        rounded(img, (x, 500, x + 52, 534), 17, fill, outline, 1)
        text(d, (x + 13, 506), label, text_fill, FONT_18)

    panel = (744, 104, 1152, 582)
    layer_shadow(img, panel, 34, blur=34, alpha=30, offset=(0, 16))
    rounded(img, panel, 34, rgba("#ffffff", 238), rgba("#d2def0", 230), 2)
    rounded(img, (786, 138, 930, 174), 18, rgba("#f8fbff", 245), rgba("#dbeafe", 230), 1)
    text(d, (810, 145), "Sources", "#334155", FONT_20)

    def source_row(box: tuple[int, int, int, int], title: str, color: str, number: str, selected: bool) -> None:
        x1, y1, x2, y2 = box
        if selected:
            glow = Image.new("RGBA", SIZE, (0, 0, 0, 0))
            gd = ImageDraw.Draw(glow)
            gd.rounded_rectangle((x1 - 12, y1 - 10, x2 + 12, y2 + 10), radius=30, fill=rgba(color, 18 + int(30 * breath)))
            img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(20)))
        fill = rgba("#f4f9ff", 232 + int(16 * breath)) if selected else rgba("#ffffff", 220)
        outline = rgba(color, 150 + int(60 * breath) if selected else 70)
        rounded(img, box, 22, fill, outline, 2 if selected else 1)
        icon_square(img, x1 + 22, y1 + 17, color, number)
        text(d, (x1 + 82, y1 + 22), title, "#334155", FONT_20)
        rounded(img, (x1 + 82, y1 + 58, x2 - 34, y1 + 68), 5, rgba("#9db7d6", 132))
        rounded(img, (x1 + 82, y1 + 80, x2 - 88, y1 + 90), 5, rgba("#9db7d6", 105))
        if selected:
            selected_width = int((x2 - x1 - 120) * (0.72 + 0.10 * breath))
            rounded(img, (x1 + 82, y2 - 28, x1 + 82 + selected_width, y2 - 12), 8, rgba(color, 188 + int(42 * breath)))

    source_row((786, 198, 1110, 300), "Source 1", "#2563eb", "1", True)
    source_row((786, 320, 1110, 422), "Source 2", "#10b981", "2", False)
    source_row((786, 442, 1110, 544), "Source 3", "#8b5cf6", "3", False)

    return img


def render_audio(frame: int) -> Image.Image:
    t = frame / FRAMES
    img = base_bg()
    d = ImageDraw.Draw(img)

    d.ellipse((120, 40, 1160, 680), fill=rgba("#edf5ff", 92))
    draw_wave(d, (86, 88, 1196, 178), t * 0.8, "#93c5fd")
    rounded(img, (122, 108, 1160, 612), 48, rgba("#ffffff", 84), rgba("#dbeafe", 108), 1)

    player = (170, 164, 1110, 386)
    layer_shadow(img, player, 42, blur=34, alpha=40, offset=(0, 16))
    rounded(img, player, 42, rgba("#ffffff", 238), rgba("#cbdaf0", 230), 2)
    d.ellipse((230, 224, 350, 344), fill=rgba("#2563eb", 255))
    d.rounded_rectangle((278, 261, 290, 308), radius=5, fill="white")
    d.rounded_rectangle((310, 261, 322, 308), radius=5, fill="white")
    text(d, (396, 230), "Audio Overview", "#0f172a", FONT_28)
    rounded(img, (396, 300, 970, 314), 8, rgba("#d8e2ef", 255))
    prog = 0.18 + 0.64 * ((t * 0.72) % 1)
    rounded(img, (396, 300, int(396 + 574 * prog), 314), 8, rgba("#2563eb", 255))
    knob = int(396 + 574 * prog)
    d.ellipse((knob - 15, 292, knob + 15, 322), fill=rgba("#7c3aed", 255))
    text(d, (1000, 289), "3:01", "#64748b", FONT_20)
    clip_cards = [
        (142, 462, 412, 604, "Key moment", "#10b981"),
        (506, 462, 776, 604, "Follow-up", "#7c3aed"),
        (870, 462, 1140, 604, "Saved clip", "#f59e0b"),
    ]
    for i, (x1, y1, x2, y2, title, color) in enumerate(clip_cards):
        yy = int(y1 + math.sin(t * math.tau + i) * 6)
        layer_shadow(img, (x1, yy, x2, yy + 130), 26, blur=18, alpha=24, offset=(0, 9))
        rounded(img, (x1, yy, x2, yy + 130), 26, rgba("#ffffff", 232), rgba("#d1def0", 230), 2)
        text(d, (x1 + 28, yy + 24), title, "#334155", FONT_20)
        draw_wave(d, (x1 + 28, yy + 70, x2 - 28, yy + 108), t + i * 0.18, color)
    for i, (x, y, label, color) in enumerate([(256, 408, "Source", "#2563eb"), (548, 402, "Quote", "#10b981"), (848, 408, "Clip", "#f59e0b")]):
        rounded(img, (x, y, x + 116, y + 34), 17, rgba("#f8fbff", 232), rgba(color, 90), 1)
        text(d, (x + 26, y + 6), label, color, FONT_18)
    return img


RENDERERS = {
    "knowtrail-upload": render_upload,
    "knowtrail-citations": render_citations,
    "knowtrail-audio": render_audio,
}


def encode(name: str, renderer) -> None:
    with tempfile.TemporaryDirectory(prefix=f"{name}-frames-") as tmp:
        tmp_path = Path(tmp)
        poster: Image.Image | None = None
        for frame in range(FRAMES):
            img = renderer(frame).convert("RGB")
            if frame == 8:
                poster = img.copy()
            img.save(tmp_path / f"frame-{frame:04d}.png", quality=95)
        if poster is None:
            poster = renderer(0).convert("RGB")
        poster.save(OUT / f"{name}-poster.jpg", quality=88, optimize=True)
        mp4 = OUT / f"{name}.mp4"
        webm = OUT / f"{name}.webm"
        input_pattern = str(tmp_path / "frame-%04d.png")
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-framerate",
                str(FPS),
                "-i",
                input_pattern,
                "-vf",
                "format=yuv420p",
                "-c:v",
                "libx264",
                "-movflags",
                "+faststart",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                "26",
                str(mp4),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-framerate",
                str(FPS),
                "-i",
                input_pattern,
                "-c:v",
                "libvpx-vp9",
                "-b:v",
                "0",
                "-crf",
                "34",
                "-pix_fmt",
                "yuva420p",
                str(webm),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def main() -> None:
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is required to generate home motion assets.")
    OUT.mkdir(parents=True, exist_ok=True)
    for name, renderer in RENDERERS.items():
        encode(name, renderer)
        print(f"generated {name}")


if __name__ == "__main__":
    main()
