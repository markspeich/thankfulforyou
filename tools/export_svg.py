import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

MM_PER_INCH = 25.4
BATCH_EXPORT_START_STEP_MM = 2.03 * MM_PER_INCH


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


def count_connected_components(mask):
    structure = ndimage.generate_binary_structure(2, 2)
    _, component_count = ndimage.label(np.array(mask) > 0, structure=structure)
    return int(component_count)


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


def polyline_closed_path(points, scale):
    commands = [f"M{points[0][0] / scale:.3f} {points[0][1] / scale:.3f}"]
    commands.extend(f"L{x / scale:.3f} {y / scale:.3f}" for x, y in points[1:-1])
    commands.append("Z")
    return " ".join(commands)


def trace_mask_outline(mask, scale, tolerance_mm, smooth_iterations, curve_mode="quadratic"):
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
        if smooth_iterations > 0:
            points = chaikin_closed(points, smooth_iterations)
        if curve_mode == "polyline":
            paths.append(polyline_closed_path(points, scale))
        else:
            paths.append(quadratic_closed_path(points, scale))

    return " ".join(paths)


def load_font(root, font_ref, font_size, cache):
    font_key = (font_ref or "", font_size)
    if font_key in cache:
        return cache[font_key]

    fallback_path = root / "public" / "fonts" / "Candlepin-Laser.otf"
    candidates = []
    if font_ref:
        candidates.append(root / font_ref)
    candidates.append(fallback_path)

    for candidate in candidates:
        if candidate.exists():
            cache[font_key] = ImageFont.truetype(str(candidate), font_size)
            return cache[font_key]

    cache[font_key] = ImageFont.load_default()
    return cache[font_key]


def load_outline_font(root, font_ref, cache):
    cache_key = font_ref or "__fallback__"
    if cache_key in cache:
        return cache[cache_key]

    fallback_path = root / "public" / "fonts" / "Candlepin-Laser.otf"
    candidates = []
    if font_ref:
        candidates.append(root / font_ref)
    candidates.append(fallback_path)

    for candidate in candidates:
        if candidate.exists():
            font = TTFont(str(candidate))
            cache[cache_key] = {
                "font": font,
                "glyph_set": font.getGlyphSet(),
                "cmap": font.getBestCmap() or {},
                "units_per_em": font["head"].unitsPerEm,
            }
            return cache[cache_key]

    raise FileNotFoundError(f"Could not locate outline font for {font_ref or 'fallback font'}")


def build_face_outline_path(root, payload):
    font_cache = {}
    path_fragments = []
    min_x = None
    min_y = None
    max_x = None
    max_y = None

    for letter in payload["letters"]:
        character = letter.get("character", "")
        if not character:
            continue

        font_data = load_outline_font(root, letter.get("fontPath"), font_cache)
        glyph_name = font_data["cmap"].get(ord(character))
        if not glyph_name:
            continue

        glyph = font_data["glyph_set"][glyph_name]
        scale = float(letter["fontSizeMm"]) / float(font_data["units_per_em"])
        transform = (
            scale,
            0,
            0,
            -scale,
            float(letter["x"]),
            float(letter["y"]),
        )
        pen = SVGPathPen(font_data["glyph_set"])
        transform_pen = TransformPen(pen, transform)
        glyph.draw(transform_pen)
        commands = pen.getCommands()
        if commands:
            path_fragments.append(commands)

        bounds_pen = BoundsPen(font_data["glyph_set"])
        glyph.draw(TransformPen(bounds_pen, transform))
        if bounds_pen.bounds:
            glyph_min_x, glyph_min_y, glyph_max_x, glyph_max_y = bounds_pen.bounds
            min_x = glyph_min_x if min_x is None else min(min_x, glyph_min_x)
            min_y = glyph_min_y if min_y is None else min(min_y, glyph_min_y)
            max_x = glyph_max_x if max_x is None else max(max_x, glyph_max_x)
            max_y = glyph_max_y if max_y is None else max(max_y, glyph_max_y)

    bounds = None
    if min_x is not None and min_y is not None and max_x is not None and max_y is not None:
        bounds = {
            "left": float(min_x),
            "top": float(min_y),
            "width": float(max_x - min_x),
            "height": float(max_y - min_y),
        }

    return {
        "path": " ".join(path_fragments),
        "bounds": bounds,
    }


def render_text_mask(
    root,
    payload,
    scale=50,
    stroke_mm=0,
):
    width = float(payload["widthMm"])
    height = float(payload["heightMm"])
    letters = payload["letters"]

    image = Image.new("L", (round(width * scale), round(height * scale)), 0)
    draw = ImageDraw.Draw(image)
    stroke_width = max(0, round(stroke_mm * scale))
    font_cache = {}

    for letter in letters:
        font = load_font(
            root,
            letter.get("fontPath"),
            max(1, round(float(letter["fontSizeMm"]) * scale)),
            font_cache,
        )
        draw.text(
            (float(letter["x"]) * scale, float(letter["y"]) * scale),
            letter["character"],
            font=font,
            fill=255,
            anchor="ls",
            stroke_width=stroke_width,
            stroke_fill=255,
        )

    return image


def text_outline_path(mask, scale, tolerance_mm=0.025, smooth_iterations=1, fill_holes=False, curve_mode="quadratic"):
    if fill_holes:
        fill_mask_holes(mask)

    return trace_mask_outline(mask, scale, tolerance_mm, smooth_iterations, curve_mode=curve_mode)


def get_trace_profile(payload):
    font_ids = {str(letter.get("fontId", "")).lower() for letter in payload.get("letters", [])}
    if "somekind" in font_ids:
        return {
            "scale": 60,
            "face_tolerance_mm": 0.012,
            "face_smooth_iterations": 0,
            "face_curve_mode": "polyline",
            "backing_tolerance_mm": 0.028,
            "backing_smooth_iterations": 0,
            "backing_curve_mode": "polyline",
        }

    return {
        "scale": 50,
        "face_tolerance_mm": 0.012,
        "face_smooth_iterations": 0,
        "face_curve_mode": "polyline",
        "backing_tolerance_mm": 0.045,
        "backing_smooth_iterations": 2,
        "backing_curve_mode": "quadratic",
    }


def analyze_single_layout(root, payload):
    profile = get_trace_profile(payload)
    scale = profile["scale"]
    backing = float(payload["backingMm"])
    weld_exported_design = payload.get("weldExportedDesign", True)
    face_outline = build_face_outline_path(root, payload)
    face_mask = render_text_mask(root, payload, scale=scale)
    backing_mask = render_text_mask(root, payload, scale=scale, stroke_mm=backing)

    backing_mask_for_path = backing_mask.copy()
    fill_mask_holes(backing_mask_for_path)
    welded_face_path = text_outline_path(
        face_mask,
        scale,
        tolerance_mm=profile["face_tolerance_mm"],
        smooth_iterations=profile["face_smooth_iterations"],
        curve_mode=profile["face_curve_mode"],
    )

    backing_path = text_outline_path(
        backing_mask_for_path,
        scale,
        tolerance_mm=profile["backing_tolerance_mm"],
        smooth_iterations=profile["backing_smooth_iterations"],
        curve_mode=profile["backing_curve_mode"],
    )
    component_count = count_connected_components(face_mask)

    return {
        "widthMm": float(payload["widthMm"]),
        "heightMm": float(payload["heightMm"]),
        "backingMm": backing,
        "text": payload.get("text", ""),
        "facePath": face_outline["path"],
        "faceBoundsMm": face_outline["bounds"],
        "exportFacePath": welded_face_path if weld_exported_design else face_outline["path"],
        "backingPath": backing_path,
        "connectedComponentCount": component_count,
        "isConnected": component_count <= 1,
    }


def build_precomputed_order_paths(payload):
    analysis = payload.get("analysis")
    if not isinstance(analysis, dict):
        return None

    export_face_path = analysis.get("exportFacePath")
    backing_path = analysis.get("backingPath")
    width = payload.get("widthMm")
    height = payload.get("heightMm")

    if (
        not isinstance(export_face_path, str)
        or not export_face_path
        or not isinstance(backing_path, str)
        or not backing_path
        or not isinstance(width, (int, float))
        or not isinstance(height, (int, float))
    ):
        return None

    export_gap = 10.0
    width = float(width)
    height = float(height)

    return {
        "width": width,
        "height": height,
        "export_width": width * 2 + export_gap,
        "backing_x": width + export_gap,
        "face_path": export_face_path,
        "backing_path": backing_path,
        "text": svg_escape(payload.get("text", "")),
        "connected_component_count": int(analysis.get("connectedComponentCount", 0)),
    }


def build_single_order_paths(root, payload):
    precomputed_order = build_precomputed_order_paths(payload)
    if precomputed_order:
        return precomputed_order

    analysis = analyze_single_layout(root, payload)
    width = analysis["widthMm"]
    height = analysis["heightMm"]
    export_gap = 10.0
    export_width = width * 2 + export_gap
    backing_x = width + export_gap

    return {
        "width": width,
        "height": height,
        "export_width": export_width,
        "backing_x": backing_x,
        "face_path": analysis["exportFacePath"],
        "backing_path": analysis["backingPath"],
        "text": svg_escape(analysis["text"]),
        "connected_component_count": analysis["connectedComponentCount"],
    }


def build_svg(payload):
    root = Path(__file__).resolve().parents[1]
    export_fill = "rgb(255, 0, 0)"

    if isinstance(payload, dict) and isinstance(payload.get("layouts"), list):
        return build_batch_svg(root, payload["layouts"])

    order = build_single_order_paths(root, payload)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{order["export_width"]:.3f}mm" height="{order["height"]:.3f}mm" viewBox="0 0 {order["export_width"]:.3f} {order["height"]:.3f}">
  <title>Badge reel layout</title>
  <desc>Text: {order["text"]}. Face layer is on the left. Offset backing layer is on the right. Generated as vector paths from the selected production fonts. Connected components: {order["connected_component_count"]}.</desc>
  <g id="face-layer" fill="{export_fill}" stroke="none">
    <path d="{order["face_path"]}"/>
  </g>
  <g id="backing-layer" transform="translate({order["backing_x"]:.3f} 0)" fill="{export_fill}" stroke="none">
    <path d="{order["backing_path"]}"/>
  </g>
</svg>
"""


def build_batch_svg(root, layouts):
    export_fill = "rgb(255, 0, 0)"
    order_paths = [build_single_order_paths(root, payload) for payload in layouts]
    export_width = max(order["export_width"] for order in order_paths)
    export_height = 0.0
    if order_paths:
        export_height = BATCH_EXPORT_START_STEP_MM * (len(order_paths) - 1) + order_paths[-1]["height"]
    desc_items = [
        f"Order {index + 1}: {order['text']}"
        for index, order in enumerate(order_paths)
    ]

    parts = [
        f"""<svg xmlns="http://www.w3.org/2000/svg" width="{export_width:.3f}mm" height="{export_height:.3f}mm" viewBox="0 0 {export_width:.3f} {export_height:.3f}">
  <title>Badge reel batch layout</title>
  <desc>{"; ".join(desc_items)}. Each order is stacked below the previous order. Face layer is on the left. Offset backing layer is on the right. Generated as vector paths from the selected production fonts.</desc>"""
    ]

    current_y = 0.0
    for index, order in enumerate(order_paths):
        parts.append(
            f"""  <g id="order-{index + 1}-face-layer" transform="translate(0 {current_y:.3f})" fill="{export_fill}" stroke="none">
      <path d="{order["face_path"]}"/>
    </g>
    <g id="order-{index + 1}-backing-layer" transform="translate({order["backing_x"]:.3f} {current_y:.3f})" fill="{export_fill}" stroke="none">
      <path d="{order["backing_path"]}"/>
    </g>"""
        )
        current_y += BATCH_EXPORT_START_STEP_MM

    parts.append("</svg>\n")
    return "\n".join(parts)


def build_analysis(payload):
    root = Path(__file__).resolve().parents[1]
    return json.dumps(analyze_single_layout(root, payload))


def main():
    payload = json.loads(sys.stdin.read())
    if isinstance(payload, dict) and payload.get("mode") == "analyze":
        sys.stdout.write(build_analysis(payload["layout"]))
        return

    sys.stdout.write(build_svg(payload))


if __name__ == "__main__":
    main()
