import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

MM_PER_INCH = 25.4
BATCH_EXPORT_START_STEP_MM = 2.03 * MM_PER_INCH
EXPORT_GAP_MM = 10.0
COLOR_LABEL_MARGIN_MM = 3.0
COLOR_LABEL_FONT_SIZE_MM = 4.0
COLOR_LABEL_LINE_HEIGHT_MM = 4.8
REMOTE_FONT_MAX_BYTES = 2 * 1024 * 1024


def svg_escape(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def parse_export_quantity(value):
    if isinstance(value, bool):
        return 1

    if isinstance(value, (int, float)):
        parsed = int(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return 1
        try:
            parsed = int(float(stripped))
        except ValueError:
            return 1
    else:
        return 1

    return parsed if parsed > 0 else 1


def fill_mask_holes(mask):
    width, height = mask.size
    data = bytearray(mask.tobytes())
    exterior = bytearray(width * height)
    queue = deque()

    def enqueue_if_empty(x, y):
        if x < 0 or y < 0 or x >= width or y >= height:
            return

        index = y * width + x
        if exterior[index] or data[index] > 0:
            return

        exterior[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue_if_empty(x, 0)
        enqueue_if_empty(x, height - 1)
    for y in range(height):
        enqueue_if_empty(0, y)
        enqueue_if_empty(width - 1, y)

    while queue:
        x, y = queue.popleft()
        enqueue_if_empty(x + 1, y)
        enqueue_if_empty(x - 1, y)
        enqueue_if_empty(x, y + 1)
        enqueue_if_empty(x, y - 1)

    for index, value in enumerate(data):
        data[index] = 255 if value > 0 or not exterior[index] else 0

    mask.putdata(data)


def count_connected_components(mask):
    width, height = mask.size
    data = mask.tobytes()
    visited = bytearray(width * height)
    component_count = 0

    for start_index, value in enumerate(data):
        if value <= 0 or visited[start_index]:
            continue

        component_count += 1
        visited[start_index] = 1
        queue = deque([(start_index % width, start_index // width)])

        while queue:
            x, y = queue.popleft()
            for next_y in range(max(0, y - 1), min(height, y + 2)):
                for next_x in range(max(0, x - 1), min(width, x + 2)):
                    next_index = next_y * width + next_x
                    if visited[next_index] or data[next_index] <= 0:
                        continue
                    visited[next_index] = 1
                    queue.append((next_x, next_y))

    return component_count


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


def resolve_font_candidates(root, font_ref):
    fallback_ref = "public/fonts/Candlepin-Laser.otf"
    refs = []
    if font_ref:
        refs.append(font_ref)
    refs.append(fallback_ref)

    candidates = []
    for ref in refs:
        path = Path(ref)
        if path.is_absolute():
            candidates.append(path)
            continue

        candidates.extend([
            root / path,
            root / "dist" / path,
            Path.cwd() / path,
            Path.cwd() / "dist" / path,
        ])

    return list(dict.fromkeys(candidates))


def cache_remote_font(font_ref):
    asset_base_url = os.environ.get("THANKFULFORYOU_ASSET_BASE_URL", "").strip()
    if not asset_base_url or not font_ref or not str(font_ref).startswith("public/fonts/"):
        return None

    cache_dir = Path(tempfile.gettempdir()) / "thankfulforyou-fonts"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / Path(font_ref).name
    if cache_path.exists():
        return cache_path

    font_url = urllib.parse.urljoin(f"{asset_base_url.rstrip('/')}/", urllib.parse.quote(font_ref))
    with urllib.request.urlopen(font_url, timeout=10) as response:
        font_bytes = response.read(REMOTE_FONT_MAX_BYTES + 1)

    if len(font_bytes) > REMOTE_FONT_MAX_BYTES:
        raise ValueError(f"Remote font exceeded {REMOTE_FONT_MAX_BYTES} bytes: {font_ref}")

    cache_path.write_bytes(font_bytes)
    return cache_path


def find_font_path(root, font_ref):
    candidates = resolve_font_candidates(root, font_ref)
    for candidate in candidates:
        if candidate.exists():
            return candidate, candidates

    remote_font = cache_remote_font(font_ref or "public/fonts/Candlepin-Laser.otf")
    if remote_font and remote_font.exists():
        candidates.append(remote_font)
        return remote_font, candidates

    return None, candidates


def load_font(root, font_ref, font_size, cache):
    font_key = (font_ref or "", font_size)
    if font_key in cache:
        return cache[font_key]

    font_path, _ = find_font_path(root, font_ref)
    if font_path:
        cache[font_key] = ImageFont.truetype(str(font_path), font_size)
        return cache[font_key]

    cache[font_key] = ImageFont.load_default()
    return cache[font_key]


def load_outline_font(root, font_ref, cache):
    cache_key = font_ref or "__fallback__"
    if cache_key in cache:
        return cache[cache_key]

    font_path, candidates = find_font_path(root, font_ref)
    if font_path:
        font = TTFont(str(font_path))
        cache[cache_key] = {
            "font": font,
            "glyph_set": font.getGlyphSet(),
            "cmap": font.getBestCmap() or {},
            "units_per_em": font["head"].unitsPerEm,
        }
        return cache[cache_key]

    checked_paths = ", ".join(str(candidate) for candidate in candidates)
    raise FileNotFoundError(f"Could not locate outline font for {font_ref or 'fallback font'}; checked {checked_paths}")


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

    width = float(width)
    height = float(height)
    color_name = svg_escape(payload.get("colorName", ""))
    quantity = parse_export_quantity(payload.get("quantity"))
    color_label_width = estimate_color_label_width_mm(color_name)
    color_label_extra = color_label_width + COLOR_LABEL_MARGIN_MM if color_name else 0.0

    return {
        "width": width,
        "height": height,
        "export_width": width * 2 + EXPORT_GAP_MM + color_label_extra,
        "backing_x": width + EXPORT_GAP_MM,
        "face_path": export_face_path,
        "backing_path": backing_path,
        "text": svg_escape(payload.get("text", "")),
        "connected_component_count": int(analysis.get("connectedComponentCount", 0)),
        "color_name": color_name,
        "quantity": quantity,
    }


def build_single_order_paths(root, payload):
    precomputed_order = build_precomputed_order_paths(payload)
    if precomputed_order:
        return precomputed_order

    analysis = analyze_single_layout(root, payload)
    width = analysis["widthMm"]
    height = analysis["heightMm"]
    color_name = svg_escape(payload.get("colorName", ""))
    quantity = parse_export_quantity(payload.get("quantity"))
    color_label_width = estimate_color_label_width_mm(color_name)
    color_label_extra = color_label_width + COLOR_LABEL_MARGIN_MM if color_name else 0.0
    export_width = width * 2 + EXPORT_GAP_MM + color_label_extra
    backing_x = width + EXPORT_GAP_MM

    return {
        "width": width,
        "height": height,
        "export_width": export_width,
        "backing_x": backing_x,
        "face_path": analysis["exportFacePath"],
        "backing_path": analysis["backingPath"],
        "text": svg_escape(analysis["text"]),
        "connected_component_count": analysis["connectedComponentCount"],
        "color_name": color_name,
        "quantity": quantity,
    }


def estimate_color_label_width_mm(color_name):
    if not color_name:
        return 0.0

    estimated_char_width_mm = COLOR_LABEL_FONT_SIZE_MM * 0.58
    return max(12.0, len(color_name) * estimated_char_width_mm)


def build_color_label(order, instance_id, translate_y):
    color_name = order.get("color_name", "")
    if not color_name:
        return ""

    x = order["backing_x"] + order["width"] + COLOR_LABEL_MARGIN_MM
    y = translate_y + min(order["height"] - 1.5, max(COLOR_LABEL_FONT_SIZE_MM, COLOR_LABEL_FONT_SIZE_MM + 1.0))
    return (
        f'  <text id="{instance_id}-color-label" x="{x:.3f}" y="{y:.3f}" '
        f'font-family="Arial" font-size="{COLOR_LABEL_FONT_SIZE_MM:.3f}mm" '
        f'fill="rgb(255, 0, 0)">{color_name}</text>'
    )


def expand_export_instances(order_paths):
    instances = []
    for order_index, order in enumerate(order_paths, start=1):
        quantity = order.get("quantity", 1)
        for copy_index in range(quantity):
            instances.append({
                "instance_id": f"order-{order_index}-copy-{copy_index + 1}",
                "order": order,
            })
    return instances


def build_svg_document(title, desc, instances):
    export_fill = "rgb(255, 0, 0)"
    export_width = max(instance["order"]["export_width"] for instance in instances)
    export_height = 0.0
    if instances:
        export_height = BATCH_EXPORT_START_STEP_MM * (len(instances) - 1) + instances[-1]["order"]["height"]

    parts = [
        f"""<svg xmlns="http://www.w3.org/2000/svg" width="{export_width:.3f}mm" height="{export_height:.3f}mm" viewBox="0 0 {export_width:.3f} {export_height:.3f}">
  <title>{title}</title>
  <desc>{desc}</desc>"""
    ]

    current_y = 0.0
    for instance in instances:
        order = instance["order"]
        instance_id = instance["instance_id"]
        parts.append(
            f"""  <g id="{instance_id}-name-group" transform="translate(0 {current_y:.3f})" fill="{export_fill}" stroke="none">
    <path d="{order["face_path"]}"/>
  </g>
  <path id="{instance_id}-backing-border" d="{order["backing_path"]}" transform="translate({order["backing_x"]:.3f} {current_y:.3f})" fill="{export_fill}" stroke="none"/>"""
        )
        color_label = build_color_label(order, instance_id, current_y)
        if color_label:
            parts.append(color_label)
        current_y += BATCH_EXPORT_START_STEP_MM

    parts.append("</svg>\n")
    return "\n".join(parts)


def build_svg(payload):
    root = Path(__file__).resolve().parents[1]

    if isinstance(payload, dict) and isinstance(payload.get("layouts"), list):
        return build_batch_svg(root, payload["layouts"])

    order = build_single_order_paths(root, payload)
    instances = expand_export_instances([order])
    desc = (
        f'Text: {order["text"]}. Face layer is on the left. Offset backing layer is on the right. '
        f'Generated as vector paths from the selected production fonts. Connected components: {order["connected_component_count"]}.'
    )
    if order.get("color_name"):
        desc += f' Color label: {order["color_name"]}.'
    if order.get("quantity", 1) > 1:
        desc += f' Quantity exported: {order["quantity"]}.'
    return build_svg_document("Badge reel layout", desc, instances)


def build_batch_svg(root, layouts):
    order_paths = [build_single_order_paths(root, payload) for payload in layouts]
    desc_items = [
        f"Order {index + 1}: {order['text']}" + (f" (x{order['quantity']})" if order.get("quantity", 1) > 1 else "")
        for index, order in enumerate(order_paths)
    ]
    desc = (
        f'{"; ".join(desc_items)}. Each exported instance is stacked below the previous one. '
        f'Face layer is on the left. Offset backing layer is on the right. Generated as vector paths from the selected production fonts.'
    )
    return build_svg_document("Badge reel batch layout", desc, expand_export_instances(order_paths))


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
