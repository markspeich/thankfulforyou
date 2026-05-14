import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage


def svg_escape(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def fill_mask_holes(mask):
    filled = ndimage.binary_fill_holes(np.array(mask) > 0)
    mask.paste(Image.fromarray((filled * 255).astype(np.uint8)))


def point_line_distance(point, start, end):
    if start == end:
        return ((point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2) ** 0.5

    dx = end[0] - start[0]
    dy = end[1] - start[1]
    numerator = abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0])
    denominator = (dx * dx + dy * dy) ** 0.5
    return numerator / denominator


def rdp(points, tolerance):
    if len(points) <= 2:
        return points

    start = points[0]
    end = points[-1]
    max_distance = 0
    split_index = 0

    for index in range(1, len(points) - 1):
        distance = point_line_distance(points[index], start, end)
        if distance > max_distance:
            max_distance = distance
            split_index = index

    if max_distance <= tolerance:
        return [start, end]

    left = rdp(points[: split_index + 1], tolerance)
    right = rdp(points[split_index:], tolerance)
    return left[:-1] + right


def simplify_closed_polyline(points, tolerance):
    if len(points) <= 4:
        return points

    open_points = points[:-1]
    anchor_index = min(range(len(open_points)), key=lambda index: (open_points[index][0], open_points[index][1]))
    rotated = open_points[anchor_index:] + open_points[:anchor_index] + [open_points[anchor_index]]
    simplified = rdp(rotated, tolerance)

    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])

    return simplified


def chaikin_closed(points, iterations):
    if len(points) <= 4:
        return points

    open_points = points[:-1]
    for _ in range(iterations):
        smoothed = []
        for index, current in enumerate(open_points):
            next_point = open_points[(index + 1) % len(open_points)]
            q = (
                current[0] * 0.75 + next_point[0] * 0.25,
                current[1] * 0.75 + next_point[1] * 0.25,
            )
            r = (
                current[0] * 0.25 + next_point[0] * 0.75,
                current[1] * 0.25 + next_point[1] * 0.75,
            )
            smoothed.extend([q, r])
        open_points = smoothed

    open_points.append(open_points[0])
    return open_points


def quadratic_closed_path(points, scale):
    if len(points) < 4:
        commands = [f"M{points[0][0] / scale:.3f} {points[0][1] / scale:.3f}"]
        commands.extend(f"L{x / scale:.3f} {y / scale:.3f}" for x, y in points[1:-1])
        commands.append("Z")
        return " ".join(commands)

    open_points = points[:-1]
    first = open_points[0]
    second = open_points[1]
    start = ((first[0] + second[0]) / 2, (first[1] + second[1]) / 2)
    commands = [f"M{start[0] / scale:.3f} {start[1] / scale:.3f}"]

    for index in range(1, len(open_points) + 1):
        control = open_points[index % len(open_points)]
        next_point = open_points[(index + 1) % len(open_points)]
        end = ((control[0] + next_point[0]) / 2, (control[1] + next_point[1]) / 2)
        commands.append(
            f"Q{control[0] / scale:.3f} {control[1] / scale:.3f} {end[0] / scale:.3f} {end[1] / scale:.3f}"
        )

    commands.append("Z")
    return " ".join(commands)


def trace_mask_outline(mask, scale, tolerance_mm, smooth_iterations):
    width, height = mask.size
    pixels = mask.load()
    edges = defaultdict(list)

    def filled(x, y):
        return 0 <= x < width and 0 <= y < height and pixels[x, y] > 0

    for y in range(height):
        for x in range(width):
            if not filled(x, y):
                continue
            if not filled(x, y - 1):
                edges[(x, y)].append((x + 1, y))
            if not filled(x + 1, y):
                edges[(x + 1, y)].append((x + 1, y + 1))
            if not filled(x, y + 1):
                edges[(x + 1, y + 1)].append((x, y + 1))
            if not filled(x - 1, y):
                edges[(x, y + 1)].append((x, y))

    paths = []
    while edges:
        start = next(iter(edges))
        current = start
        points = [start]

        while True:
            next_points = edges[current]
            next_point = next_points.pop()
            if not next_points:
                del edges[current]
            current = next_point
            points.append(current)
            if current == start:
                break

        points = simplify_closed_polyline(points, tolerance_mm * scale)
        points = chaikin_closed(points, smooth_iterations)
        paths.append(quadratic_closed_path(points, scale))

    return " ".join(paths)


def text_outline_path(
    font_path,
    payload,
    scale=50,
    stroke_mm=0,
    fill_holes=False,
    tolerance_mm=0.025,
    smooth_iterations=1,
):
    width = float(payload["widthMm"])
    height = float(payload["heightMm"])
    font_size = float(payload["fontSizeMm"])
    letters = payload["letters"]

    image = Image.new("L", (round(width * scale), round(height * scale)), 0)
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(font_path), round(font_size * scale))
    stroke_width = max(0, round(stroke_mm * scale))

    for letter in letters:
        draw.text(
            (float(letter["x"]) * scale, float(letter["y"]) * scale),
            letter["character"],
            font=font,
            fill=255,
            anchor="ls",
            stroke_width=stroke_width,
            stroke_fill=255,
        )

    if fill_holes:
        fill_mask_holes(image)

    return trace_mask_outline(image, scale, tolerance_mm, smooth_iterations)


def build_svg(payload):
    root = Path(__file__).resolve().parents[1]
    font_path = root / "public" / "fonts" / "Candlepin-Laser.otf"

    width = float(payload["widthMm"])
    height = float(payload["heightMm"])
    export_gap = 10.0
    export_width = width * 2 + export_gap
    backing_x = width + export_gap
    font_size = float(payload["fontSizeMm"])
    backing = float(payload["backingMm"])

    face_path = text_outline_path(font_path, payload, tolerance_mm=0.025, smooth_iterations=1)
    backing_path = text_outline_path(
        font_path,
        payload,
        stroke_mm=backing,
        fill_holes=True,
        tolerance_mm=0.045,
        smooth_iterations=2,
    )
    text = svg_escape(payload.get("text", ""))
    bridge = svg_escape(payload.get("bridgeMm", ""))

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{export_width:.3f}mm" height="{height:.3f}mm" viewBox="0 0 {export_width:.3f} {height:.3f}">
  <title>Candlepin badge reel layout POC</title>
  <desc>Text: {text}. Bridge target: {bridge} mm. Face layer is on the left. Offset backing layer is on the right. Generated from Candlepin-Laser.otf as vector paths.</desc>
  <g id="face-layer" fill="none" stroke="#f8fbfc" stroke-width="0.100" stroke-linejoin="round" stroke-linecap="round">
    <path d="{face_path}"/>
  </g>
  <g id="backing-layer" transform="translate({backing_x:.3f} 0)" fill="none" stroke="#446f8b" stroke-width="0.100" stroke-linejoin="round" stroke-linecap="round">
    <path d="{backing_path}"/>
  </g>
</svg>
"""


def main():
    payload = json.loads(sys.stdin.read())
    sys.stdout.write(build_svg(payload))


if __name__ == "__main__":
    main()
