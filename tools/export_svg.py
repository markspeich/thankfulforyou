import json
import hashlib
import ipaddress
import math
import os
import re
import sys
import tempfile
import urllib.parse
import urllib.request
import unicodedata
import xml.etree.ElementTree as ET
from collections import defaultdict, deque
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import pyclipper

MM_PER_INCH = 25.4
BATCH_EXPORT_START_STEP_MM = 2.03 * MM_PER_INCH
BATCH_EXPORT_COLUMN_WIDTH_MM = BATCH_EXPORT_START_STEP_MM
EXPORT_GAP_MM = 10.0
COLOR_LABEL_MARGIN_MM = 3.0
FIXED_SVG_BACKING_TRACE_SCALE = 24
FIXED_SVG_BACKING_TOLERANCE_MM = 0.065
FIXED_SVG_BACKING_TRACE_PADDING_MM = 4.0
FIXED_SVG_VECTOR_OFFSET_SCALE = 1000
COLOR_LABEL_FONT_SIZE_MM = 9.0
COLOR_LABEL_LINE_HEIGHT_MM = 4.8
REMOTE_FONT_MAX_BYTES = 2 * 1024 * 1024
REMOTE_SVG_MAX_BYTES = 2 * 1024 * 1024
BLOCKED_FIXED_SVG_TAGS = {
    "animate",
    "animatemotion",
    "animatetransform",
    "audio",
    "discard",
    "embed",
    "foreignobject",
    "iframe",
    "image",
    "link",
    "meta",
    "mpath",
    "object",
    "script",
    "set",
    "style",
    "unknown",
    "video",
}
BLOCKED_FIXED_SVG_ATTRS = {
    "class",
    "clip-path",
    "color",
    "cursor",
    "filter",
    "fill",
    "marker-end",
    "marker-mid",
    "marker-start",
    "mask",
    "opacity",
    "pointer-events",
    "stroke",
    "style",
}

ET.register_namespace("", "http://www.w3.org/2000/svg")


def svg_escape(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def svg_id_token(value, fallback="fixed-svg"):
    token = "".join(
        character.lower() if character.isalnum() else "-"
        for character in str(value or fallback)
    ).strip("-")
    token = "-".join(part for part in token.split("-") if part)
    return token or fallback


def parse_svg_dimension(value):
    if value is None:
        return None

    raw = str(value).strip()
    if not raw:
        return None

    number = ""
    for character in raw:
        if character.isdigit() or character in ".-":
            number += character
        elif number:
            break

    try:
        parsed = float(number)
    except ValueError:
        return None

    return parsed if parsed > 0 else None


def local_svg_name(element):
    return str(element.tag).split("}")[-1].lower()


def local_attr_name(name):
    return str(name).split("}")[-1].lower()


def is_unsafe_svg_attr(name, value):
    attr_name = local_attr_name(name)
    attr_value = str(value or "").strip().lower()
    if attr_name.startswith("on"):
        return True
    if attr_name in BLOCKED_FIXED_SVG_ATTRS:
        return True
    if attr_name in {"href", "src"} or name.endswith("}href"):
        return True
    if "javascript:" in attr_value or "data:" in attr_value or "url(" in attr_value:
        return True
    return False


def sanitize_fixed_svg_element(element):
    for child in list(element):
        if local_svg_name(child) in BLOCKED_FIXED_SVG_TAGS:
            element.remove(child)
            continue
        sanitize_fixed_svg_element(child)

    for attr_name in list(element.attrib):
        if is_unsafe_svg_attr(attr_name, element.attrib[attr_name]):
            del element.attrib[attr_name]

    return element


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
    bounds = mask.getbbox()
    if not bounds:
        return

    left, top, right, bottom = bounds
    cropped = mask.crop(bounds)
    width, height = cropped.size
    data = bytearray(cropped.tobytes())
    exterior = bytearray(width * height)
    queue = deque()

    for x in range(width):
        top_index = x
        if not exterior[top_index] and data[top_index] <= 0:
            exterior[top_index] = 1
            queue.append((x, 0))

        bottom_index = (height - 1) * width + x
        if not exterior[bottom_index] and data[bottom_index] <= 0:
            exterior[bottom_index] = 1
            queue.append((x, height - 1))

    for y in range(height):
        left_index = y * width
        if not exterior[left_index] and data[left_index] <= 0:
            exterior[left_index] = 1
            queue.append((0, y))

        right_index = y * width + width - 1
        if not exterior[right_index] and data[right_index] <= 0:
            exterior[right_index] = 1
            queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        if x + 1 < width:
            index = y * width + x + 1
            if not exterior[index] and data[index] <= 0:
                exterior[index] = 1
                queue.append((x + 1, y))
        if x > 0:
            index = y * width + x - 1
            if not exterior[index] and data[index] <= 0:
                exterior[index] = 1
                queue.append((x - 1, y))
        if y + 1 < height:
            index = (y + 1) * width + x
            if not exterior[index] and data[index] <= 0:
                exterior[index] = 1
                queue.append((x, y + 1))
        if y > 0:
            index = (y - 1) * width + x
            if not exterior[index] and data[index] <= 0:
                exterior[index] = 1
                queue.append((x, y - 1))

    for index, value in enumerate(data):
        data[index] = 255 if value > 0 or not exterior[index] else 0

    cropped.putdata(data)
    mask.paste(cropped, (left, top))


def count_connected_components(mask):
    bounds = mask.getbbox()
    if not bounds:
        return 0

    cropped = mask.crop(bounds)
    width, height = cropped.size
    data = cropped.tobytes()
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
    bounds = mask.getbbox()
    if not bounds:
        return ""

    left, top, right, bottom = bounds
    pixels = mask.load()
    edges = defaultdict(list)

    for y in range(top, bottom):
        for x in range(left, right):
            if pixels[x, y] <= 0:
                continue
            if y == top or pixels[x, y - 1] <= 0:
                edges[(x, y)].append((x + 1, y))
            if x + 1 >= right or pixels[x + 1, y] <= 0:
                edges[(x + 1, y)].append((x + 1, y + 1))
            if y + 1 >= bottom or pixels[x, y + 1] <= 0:
                edges[(x + 1, y + 1)].append((x, y + 1))
            if x == left or pixels[x - 1, y] <= 0:
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
    font_ref = str(font_ref or "")
    is_absolute_url = font_ref.startswith("https://") or font_ref.startswith("http://")
    is_local_public_font = font_ref.startswith("public/fonts/")
    if not font_ref or (not is_absolute_url and (not asset_base_url or not is_local_public_font)):
        return None

    cache_dir = Path(tempfile.gettempdir()) / "thankfulforyou-fonts"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_name = hashlib.sha256(font_ref.encode("utf-8")).hexdigest()
    suffix = Path(urllib.parse.urlparse(font_ref).path).suffix or Path(font_ref).suffix or ".otf"
    cache_path = cache_dir / f"{cache_name}{suffix}"
    if cache_path.exists():
        return cache_path

    font_url = font_ref if is_absolute_url else urllib.parse.urljoin(f"{asset_base_url.rstrip('/')}/", urllib.parse.quote(font_ref))
    headers = {}
    asset_cookie = os.environ.get("THANKFULFORYOU_ASSET_REQUEST_COOKIE", "").strip()
    protection_bypass = (
        os.environ.get("THANKFULFORYOU_ASSET_PROTECTION_BYPASS", "").strip()
        or os.environ.get("VERCEL_AUTOMATION_BYPASS_SECRET", "").strip()
    )
    if asset_cookie:
        headers["Cookie"] = asset_cookie
    if protection_bypass:
        headers["x-vercel-protection-bypass"] = protection_bypass

    request = urllib.request.Request(font_url, headers=headers)
    with urllib.request.urlopen(request, timeout=10) as response:
        font_bytes = response.read(REMOTE_FONT_MAX_BYTES + 1)

    if len(font_bytes) > REMOTE_FONT_MAX_BYTES:
        raise ValueError(f"Remote font exceeded {REMOTE_FONT_MAX_BYTES} bytes: {font_ref}")

    cache_path.write_bytes(font_bytes)
    return cache_path


def configured_fixed_svg_allowed_hosts():
    hosts = set()
    raw_hosts = os.environ.get("THANKFULFORYOU_FIXED_SVG_ALLOWED_HOSTS", "")
    for host in raw_hosts.split(","):
        normalized = host.strip().lower()
        if normalized:
            hosts.add(normalized)

    for env_key in ("SUPABASE_URL", "THANKFULFORYOU_ASSET_BASE_URL"):
        parsed = urllib.parse.urlparse(os.environ.get(env_key, "").strip())
        if parsed.hostname:
            hosts.add(parsed.hostname.lower())

    return hosts


def is_private_or_internal_host(hostname):
    if not hostname:
        return True

    normalized = hostname.strip().lower().rstrip(".")
    if normalized in {"localhost", "0.0.0.0"} or normalized.endswith(".localhost") or normalized.endswith(".local"):
        return True

    try:
        address = ipaddress.ip_address(normalized.strip("[]"))
    except ValueError:
        return False

    return address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_unspecified


def is_allowed_fixed_svg_url(svg_url):
    parsed = urllib.parse.urlparse(str(svg_url or "").strip())
    if parsed.scheme != "https" or not parsed.hostname:
        return False

    hostname = parsed.hostname.lower()
    if is_private_or_internal_host(hostname):
        return False

    return hostname in configured_fixed_svg_allowed_hosts()


class FixedSvgNoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(
            req.full_url,
            code,
            "Fixed SVG redirects are not allowed",
            headers,
            fp,
        )


def read_remote_svg(svg_url):
    svg_url = str(svg_url or "").strip()
    if not is_allowed_fixed_svg_url(svg_url):
        return None

    cache_dir = Path(tempfile.gettempdir()) / "thankfulforyou-fixed-svgs"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_name = hashlib.sha256(svg_url.encode("utf-8")).hexdigest()
    cache_path = cache_dir / f"{cache_name}.svg"
    if cache_path.exists():
        return cache_path.read_text(encoding="utf-8")

    request = urllib.request.Request(svg_url)
    opener = urllib.request.build_opener(FixedSvgNoRedirectHandler)
    with opener.open(request, timeout=10) as response:
        svg_bytes = response.read(REMOTE_SVG_MAX_BYTES + 1)

    if len(svg_bytes) > REMOTE_SVG_MAX_BYTES:
        raise ValueError(f"Remote fixed SVG exceeded {REMOTE_SVG_MAX_BYTES} bytes: {svg_url}")

    svg_text = svg_bytes.decode("utf-8")
    cache_path.write_text(svg_text, encoding="utf-8")
    return svg_text


def parse_svg_markup(svg_text):
    if not isinstance(svg_text, str) or not svg_text.strip():
        return None

    try:
        root = ET.fromstring(svg_text)
    except ET.ParseError:
        return None

    if root.tag.split("}")[-1].lower() != "svg":
        return None

    view_box = root.attrib.get("viewBox") or root.attrib.get("viewbox")
    view_box_values = []
    if view_box:
        try:
            view_box_values = [float(part) for part in view_box.replace(",", " ").split()]
        except ValueError:
            view_box_values = []

    if len(view_box_values) == 4 and view_box_values[2] > 0 and view_box_values[3] > 0:
        source_x = view_box_values[0]
        source_y = view_box_values[1]
        source_width = view_box_values[2]
        source_height = view_box_values[3]
    else:
        source_x = 0.0
        source_y = 0.0
        source_width = parse_svg_dimension(root.attrib.get("width")) or 1.0
        source_height = parse_svg_dimension(root.attrib.get("height")) or source_width

    children = []
    child_elements = []
    for child in list(root):
        if local_svg_name(child) in BLOCKED_FIXED_SVG_TAGS:
            continue
        sanitized_child = sanitize_fixed_svg_element(child)
        child_elements.append(sanitized_child)
        children.append(ET.tostring(sanitized_child, encoding="unicode"))

    if not children:
        return None

    return {
        "source_x": source_x,
        "source_y": source_y,
        "source_width": source_width,
        "source_height": source_height,
        "source_elements": child_elements,
        "markup": "\n    ".join(children),
    }


def resolve_fixed_svg_markup(fixed_svg):
    svg_text = fixed_svg.get("svgText")
    if not svg_text and fixed_svg.get("publicUrl"):
        svg_text = read_remote_svg(fixed_svg.get("publicUrl"))

    return parse_svg_markup(svg_text)


def normalize_fixed_svgs(payload):
    fixed_svgs = []
    for index, fixed_svg in enumerate(payload.get("fixedSvgs") or []):
        if not isinstance(fixed_svg, dict):
            continue

        try:
            width = float(fixed_svg.get("widthMm"))
            height = float(fixed_svg.get("heightMm"))
            x = float(fixed_svg.get("xMm"))
            y = float(fixed_svg.get("yMm"))
        except (TypeError, ValueError):
            continue

        if width <= 0 or height <= 0:
            continue

        try:
            parsed_svg = resolve_fixed_svg_markup(fixed_svg)
        except Exception:
            parsed_svg = None
        if not parsed_svg:
            continue

        backing_mm = 0.0
        if fixed_svg.get("backingBorder") is True:
            try:
                backing_mm = float(fixed_svg.get("backingMm", 0))
            except (TypeError, ValueError):
                backing_mm = 0.0

        fixed_svgs.append({
            "id": svg_id_token(fixed_svg.get("id") or fixed_svg.get("fixedDesignId") or index + 1),
            "name": svg_escape(fixed_svg.get("name") or fixed_svg.get("fixedDesignName") or "Fixed SVG"),
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "backing_border": backing_mm > 0,
            "backing_mm": max(0.0, backing_mm),
            **parsed_svg,
        })

    return fixed_svgs


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


def sanitize_text_token(value):
    if not value:
        return ""

    sanitized = []
    for character in str(value):
        category = unicodedata.category(character)
        if category == "Cf":
            continue
        if category.startswith("C") and character not in ("\t", "\n", "\r"):
            continue
        sanitized.append(character)

    return "".join(sanitized)


def mask_bounds_mm(mask, scale):
    bounds = mask.getbbox()
    if not bounds:
        return None

    left, top, right, bottom = bounds
    return {
        "left": left / scale,
        "top": top / scale,
        "width": (right - left) / scale,
        "height": (bottom - top) / scale,
    }


def build_face_outline_path(root, payload, scale=50, tolerance_mm=0.025, smooth_iterations=1, curve_mode="quadratic"):
    font_cache = {}
    path_fragments = []
    min_x = None
    min_y = None
    max_x = None
    max_y = None

    for letter in payload["letters"]:
        character = sanitize_text_token(letter.get("character", ""))
        if not character:
            continue

        font_data = load_outline_font(root, letter.get("fontPath"), font_cache)
        glyph_name = font_data["cmap"].get(ord(character)) if len(character) == 1 else None
        if glyph_name == ".notdef":
            glyph_name = None
        if not glyph_name:
            letter_mask = render_text_mask(
                root,
                {
                    "widthMm": payload["widthMm"],
                    "heightMm": payload["heightMm"],
                    "letters": [{ **letter, "character": character }],
                },
                scale=scale,
            )
            letter_path = text_outline_path(
                letter_mask,
                scale,
                tolerance_mm=tolerance_mm,
                smooth_iterations=smooth_iterations,
                curve_mode=curve_mode,
            )
            if letter_path:
                path_fragments.append(letter_path)

            letter_bounds = mask_bounds_mm(letter_mask, scale)
            if letter_bounds:
                glyph_min_x = letter_bounds["left"]
                glyph_min_y = letter_bounds["top"]
                glyph_max_x = letter_bounds["left"] + letter_bounds["width"]
                glyph_max_y = letter_bounds["top"] + letter_bounds["height"]
                min_x = glyph_min_x if min_x is None else min(min_x, glyph_min_x)
                min_y = glyph_min_y if min_y is None else min(min_y, glyph_min_y)
                max_x = glyph_max_x if max_x is None else max(max_x, glyph_max_x)
                max_y = glyph_max_y if max_y is None else max(max_y, glyph_max_y)
            continue

        glyph = font_data["glyph_set"][glyph_name]
        scale_x = float(letter["fontSizeMm"]) / float(font_data["units_per_em"])
        horizontal_scale = float(letter.get("horizontalScale", 1))
        vertical_scale = float(letter.get("verticalScale", 1))
        scale_x = scale_x * horizontal_scale
        scale_y = scale_x / max(horizontal_scale, 1e-9) * vertical_scale
        transform = (
            scale_x,
            0,
            0,
            -scale_y,
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
    stroke_width = max(0, round(stroke_mm * scale))
    font_cache = {}
    temp_draw = ImageDraw.Draw(Image.new("L", (1, 1), 0))

    for letter in letters:
        font = load_font(
            root,
            letter.get("fontPath"),
            max(1, round(float(letter["fontSizeMm"]) * scale)),
            font_cache,
        )
        character = sanitize_text_token(letter.get("character", ""))
        if not character:
            continue

        horizontal_scale = max(0.01, float(letter.get("horizontalScale", 1)))
        vertical_scale = max(0.01, float(letter.get("verticalScale", 1)))
        bbox = temp_draw.textbbox(
            (0, 0),
            character,
            font=font,
            anchor="ls",
            stroke_width=stroke_width,
        )
        if not bbox:
            continue

        left, top, right, bottom = bbox
        glyph_width = max(1, right - left)
        glyph_height = max(1, bottom - top)
        glyph_image = Image.new("L", (glyph_width, glyph_height), 0)
        glyph_draw = ImageDraw.Draw(glyph_image)
        glyph_draw.text(
            (-left, -top),
            character,
            font=font,
            fill=255,
            anchor="ls",
            stroke_width=stroke_width,
            stroke_fill=255,
        )

        if abs(horizontal_scale - 1.0) > 1e-6 or abs(vertical_scale - 1.0) > 1e-6:
            glyph_image = glyph_image.resize(
                (
                    max(1, round(glyph_width * horizontal_scale)),
                    max(1, round(glyph_height * vertical_scale)),
                ),
                Image.Resampling.BICUBIC,
            )

        paste_x = round(float(letter["x"]) * scale + left * horizontal_scale)
        paste_y = round(float(letter["y"]) * scale + top * vertical_scale)
        image.paste(glyph_image, (paste_x, paste_y), glyph_image)

    return image


def text_outline_path(mask, scale, tolerance_mm=0.025, smooth_iterations=1, fill_holes=False, curve_mode="quadratic"):
    if fill_holes:
        fill_mask_holes(mask)

    return trace_mask_outline(mask, scale, tolerance_mm, smooth_iterations, curve_mode=curve_mode)


def get_trace_profile(payload):
    font_ids = {str(letter.get("fontId", "")).lower() for letter in payload.get("letters", [])}
    if "somekind" in font_ids:
        profile = {
            "scale": 60,
            "face_tolerance_mm": 0.025,
            "face_smooth_iterations": 0,
            "face_curve_mode": "polyline",
            "backing_tolerance_mm": 0.028,
            "backing_smooth_iterations": 0,
            "backing_curve_mode": "polyline",
        }
    else:
        profile = {
            "scale": 50,
            "face_tolerance_mm": 0.025,
            "face_smooth_iterations": 0,
            "face_curve_mode": "polyline",
            "backing_tolerance_mm": 0.045,
            "backing_smooth_iterations": 1,
            "backing_curve_mode": "quadratic",
        }

    overrides = payload.get("traceProfileOverrides")
    if isinstance(overrides, dict):
        if "faceToleranceMm" in overrides:
            profile["face_tolerance_mm"] = float(overrides["faceToleranceMm"])
        if "faceSmoothIterations" in overrides:
            profile["face_smooth_iterations"] = int(overrides["faceSmoothIterations"])
        if "faceCurveMode" in overrides:
            profile["face_curve_mode"] = str(overrides["faceCurveMode"])
        if "backingToleranceMm" in overrides:
            profile["backing_tolerance_mm"] = float(overrides["backingToleranceMm"])
        if "backingSmoothIterations" in overrides:
            profile["backing_smooth_iterations"] = int(overrides["backingSmoothIterations"])
        if "backingCurveMode" in overrides:
            profile["backing_curve_mode"] = str(overrides["backingCurveMode"])

    return profile


def build_fixed_svg_backing_analysis_paths(payload, width, height):
    fixed_svgs = normalize_fixed_svgs(payload)
    if not fixed_svgs:
        return []

    order = {
        "width": width,
        "height": height,
        "fixed_svgs": fixed_svgs,
    }
    paths = []
    for fixed_svg in fixed_svgs:
        if not fixed_svg.get("backing_border"):
            continue
        backing_path = fixed_svg_offset_backing_path(order, fixed_svg)
        if backing_path:
            paths.append({
                "id": fixed_svg["id"],
                "path": backing_path,
            })
    return paths

def analyze_single_layout(root, payload):
    profile = get_trace_profile(payload)
    scale = profile["scale"]
    backing = float(payload["backingMm"])
    weld_exported_design = payload.get("weldExportedDesign", True)
    face_outline = build_face_outline_path(
        root,
        payload,
        scale=scale,
        tolerance_mm=profile["face_tolerance_mm"],
        smooth_iterations=profile["face_smooth_iterations"],
        curve_mode=profile["face_curve_mode"],
    )
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
    width_mm = float(payload["widthMm"])
    height_mm = float(payload["heightMm"])

    return {
        "widthMm": width_mm,
        "heightMm": height_mm,
        "backingMm": backing,
        "text": payload.get("text", ""),
        "facePath": face_outline["path"],
        "faceBoundsMm": face_outline["bounds"],
        "exportFacePath": welded_face_path if weld_exported_design else face_outline["path"],
        "backingPath": backing_path,
        "fixedSvgBackingPaths": build_fixed_svg_backing_analysis_paths(payload, width_mm, height_mm),
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
        "fixed_svgs": normalize_fixed_svgs(payload),
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
        "fixed_svgs": normalize_fixed_svgs(payload),
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


def build_color_label(order, instance_id, translate_y, x=None, y=None, center_vertical=False):
    color_name = order.get("color_name", "")
    if not color_name:
        return ""

    if x is None:
        x = order["backing_x"] + order["width"] + COLOR_LABEL_MARGIN_MM
    if y is None:
        y = translate_y + min(order["height"] - 1.5, max(COLOR_LABEL_FONT_SIZE_MM, COLOR_LABEL_FONT_SIZE_MM + 1.0))
    baseline = ' dominant-baseline="middle"' if center_vertical else ""
    return (
        f'  <text id="{instance_id}-color-label" x="{x:.3f}" y="{y:.3f}" '
        f'font-family="Arial" font-size="{COLOR_LABEL_FONT_SIZE_MM:.3f}mm" '
        f'fill="rgb(255, 0, 0)" text-anchor="middle"{baseline}>{color_name}</text>'
    )



SVG_PATH_TOKEN_RE = re.compile(r"[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
TRANSFORM_RE = re.compile(r"(matrix|translate|scale)\s*\(([^)]*)\)")


def matrix_multiply(left, right):
    la, lb, lc, ld, le, lf = left
    ra, rb, rc, rd, re_value, rf = right
    return (
        la * ra + lc * rb,
        lb * ra + ld * rb,
        la * rc + lc * rd,
        lb * rc + ld * rd,
        la * re_value + lc * rf + le,
        lb * re_value + ld * rf + lf,
    )


def apply_matrix(matrix, x, y):
    a, b, c, d, e, f = matrix
    return (a * x + c * y + e, b * x + d * y + f)


def parse_transform(value):
    matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    for match in TRANSFORM_RE.finditer(str(value or "")):
        kind = match.group(1)
        try:
            numbers = [float(part) for part in re.split(r"[\s,]+", match.group(2).strip()) if part]
        except ValueError:
            continue

        if kind == "matrix" and len(numbers) == 6:
            next_matrix = tuple(numbers)
        elif kind == "translate" and numbers:
            next_matrix = (1.0, 0.0, 0.0, 1.0, numbers[0], numbers[1] if len(numbers) > 1 else 0.0)
        elif kind == "scale" and numbers:
            sx = numbers[0]
            sy = numbers[1] if len(numbers) > 1 else sx
            next_matrix = (sx, 0.0, 0.0, sy, 0.0, 0.0)
        else:
            continue

        matrix = matrix_multiply(matrix, next_matrix)

    return matrix


def svg_number(value, fallback=0.0):
    parsed = parse_svg_dimension(value)
    return parsed if parsed is not None else fallback


def sample_quadratic(start, control, end, steps=16):
    points = []
    for index in range(1, steps + 1):
        t = index / steps
        mt = 1 - t
        points.append((
            mt * mt * start[0] + 2 * mt * t * control[0] + t * t * end[0],
            mt * mt * start[1] + 2 * mt * t * control[1] + t * t * end[1],
        ))
    return points


def sample_cubic(start, first, second, end, steps=20):
    points = []
    for index in range(1, steps + 1):
        t = index / steps
        mt = 1 - t
        points.append((
            mt ** 3 * start[0] + 3 * mt * mt * t * first[0] + 3 * mt * t * t * second[0] + t ** 3 * end[0],
            mt ** 3 * start[1] + 3 * mt * mt * t * first[1] + 3 * mt * t * t * second[1] + t ** 3 * end[1],
        ))
    return points


def parse_svg_path_subpaths(path_data):
    tokens = SVG_PATH_TOKEN_RE.findall(str(path_data or ""))
    subpaths = []
    current_path = []
    command = None
    index = 0
    current = (0.0, 0.0)
    start = (0.0, 0.0)
    last_cubic_control = None
    last_quadratic_control = None
    previous_op = None

    def is_command(token):
        return len(token) == 1 and token.isalpha()

    def has_numbers(count):
        return index + count <= len(tokens) and not any(is_command(tokens[index + offset]) for offset in range(count))

    def read_number():
        nonlocal index
        value = float(tokens[index])
        index += 1
        return value

    def read_point(relative=False):
        x = read_number()
        y = read_number()
        if relative:
            return (current[0] + x, current[1] + y)
        return (x, y)

    def reset_controls():
        nonlocal last_cubic_control, last_quadratic_control
        last_cubic_control = None
        last_quadratic_control = None

    while index < len(tokens):
        if is_command(tokens[index]):
            command = tokens[index]
            index += 1
        if not command:
            break

        relative = command.islower()
        op = command.upper()

        try:
            if op == "M":
                point = read_point(relative)
                if current_path:
                    subpaths.append(current_path)
                current_path = [point]
                current = point
                start = point
                command = "l" if relative else "L"
                reset_controls()
                previous_op = "M"
            elif op == "L":
                while has_numbers(2):
                    point = read_point(relative)
                    current_path.append(point)
                    current = point
                reset_controls()
                previous_op = "L"
            elif op == "H":
                while has_numbers(1):
                    x = read_number()
                    point = (current[0] + x if relative else x, current[1])
                    current_path.append(point)
                    current = point
                reset_controls()
                previous_op = "H"
            elif op == "V":
                while has_numbers(1):
                    y = read_number()
                    point = (current[0], current[1] + y if relative else y)
                    current_path.append(point)
                    current = point
                reset_controls()
                previous_op = "V"
            elif op == "Q":
                while has_numbers(4):
                    control = read_point(relative)
                    end = read_point(relative)
                    current_path.extend(sample_quadratic(current, control, end))
                    current = end
                    last_quadratic_control = control
                    last_cubic_control = None
                previous_op = "Q"
            elif op == "T":
                while has_numbers(2):
                    if previous_op in {"Q", "T"} and last_quadratic_control:
                        control = (2 * current[0] - last_quadratic_control[0], 2 * current[1] - last_quadratic_control[1])
                    else:
                        control = current
                    end = read_point(relative)
                    current_path.extend(sample_quadratic(current, control, end))
                    current = end
                    last_quadratic_control = control
                    last_cubic_control = None
                    previous_op = "T"
            elif op == "C":
                while has_numbers(6):
                    first = read_point(relative)
                    second = read_point(relative)
                    end = read_point(relative)
                    current_path.extend(sample_cubic(current, first, second, end))
                    current = end
                    last_cubic_control = second
                    last_quadratic_control = None
                previous_op = "C"
            elif op == "S":
                while has_numbers(4):
                    if previous_op in {"C", "S"} and last_cubic_control:
                        first = (2 * current[0] - last_cubic_control[0], 2 * current[1] - last_cubic_control[1])
                    else:
                        first = current
                    second = read_point(relative)
                    end = read_point(relative)
                    current_path.extend(sample_cubic(current, first, second, end))
                    current = end
                    last_cubic_control = second
                    last_quadratic_control = None
                    previous_op = "S"
            elif op == "A":
                while has_numbers(7):
                    _rx = read_number()
                    _ry = read_number()
                    _rotation = read_number()
                    _large_arc = read_number()
                    _sweep = read_number()
                    end = read_point(relative)
                    current_path.append(end)
                    current = end
                reset_controls()
                previous_op = "A"
            elif op == "Z":
                if current_path and current_path[-1] != start:
                    current_path.append(start)
                if current_path:
                    subpaths.append(current_path)
                current_path = []
                current = start
                command = None
                reset_controls()
                previous_op = "Z"
            else:
                break
        except (IndexError, ValueError):
            break

    if current_path:
        subpaths.append(current_path)

    return [path for path in subpaths if len(path) >= 3]

def parse_point_list(value):
    try:
        numbers = [float(part) for part in re.split(r"[\s,]+", str(value or "").strip()) if part]
    except ValueError:
        return []
    return list(zip(numbers[0::2], numbers[1::2]))


def element_subpaths(element):
    name = local_svg_name(element)
    if name == "path":
        return parse_svg_path_subpaths(element.attrib.get("d"))
    if name == "polygon":
        points = parse_point_list(element.attrib.get("points"))
        return [points] if len(points) >= 3 else []
    if name == "polyline":
        points = parse_point_list(element.attrib.get("points"))
        return [points] if len(points) >= 3 else []
    if name == "rect":
        x = svg_number(element.attrib.get("x"))
        y = svg_number(element.attrib.get("y"))
        width = svg_number(element.attrib.get("width"))
        height = svg_number(element.attrib.get("height"))
        if width <= 0 or height <= 0:
            return []
        return [[(x, y), (x + width, y), (x + width, y + height), (x, y + height), (x, y)]]
    if name in {"circle", "ellipse"}:
        cx = svg_number(element.attrib.get("cx"))
        cy = svg_number(element.attrib.get("cy"))
        rx = svg_number(element.attrib.get("r")) if name == "circle" else svg_number(element.attrib.get("rx"))
        ry = rx if name == "circle" else svg_number(element.attrib.get("ry"))
        if rx <= 0 or ry <= 0:
            return []
        points = []
        for index in range(48):
            angle = 2 * 3.141592653589793 * index / 48
            points.append((cx + rx * math.cos(angle), cy + ry * math.sin(angle)))
        points.append(points[0])
        return [points]
    return []


def transformed_svg_subpaths_mm(
    element,
    fixed_svg,
    transform=(1.0, 0.0, 0.0, 1.0, 0.0, 0.0),
):
    next_transform = matrix_multiply(transform, parse_transform(element.attrib.get("transform")))
    source_scale = min(
        fixed_svg["width"] / fixed_svg["source_width"],
        fixed_svg["height"] / fixed_svg["source_height"],
    )
    paths = []

    for subpath in element_subpaths(element):
        points = []
        for x, y in subpath:
            tx, ty = apply_matrix(next_transform, x, y)
            final_x = fixed_svg["x"] + (tx - fixed_svg["source_x"]) * source_scale
            final_y = fixed_svg["y"] + (ty - fixed_svg["source_y"]) * source_scale
            points.append((final_x, final_y))
        if len(points) >= 3:
            paths.append(points)

    for child in list(element):
        if local_svg_name(child) in BLOCKED_FIXED_SVG_TAGS:
            continue
        paths.extend(transformed_svg_subpaths_mm(child, fixed_svg, next_transform))

    return paths


def polygon_area(points):
    area = 0.0
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return area / 2.0


def scale_polygon_for_clipper(points, scale=FIXED_SVG_VECTOR_OFFSET_SCALE):
    return [(int(round(x * scale)), int(round(y * scale))) for x, y in points]


def unscale_polygon_from_clipper(points, scale=FIXED_SVG_VECTOR_OFFSET_SCALE):
    return [(x / scale, y / scale) for x, y in points]


def svg_path_from_mm_polygons(polygons):
    fragments = []
    for polygon in polygons:
        if len(polygon) < 3:
            continue
        fragments.append(quadratic_closed_path([(x, y) for x, y in polygon], 1))
    return " ".join(fragment for fragment in fragments if fragment)


def fixed_svg_vector_offset_backing_path(fixed_svg):
    backing = float(fixed_svg.get("backing_mm", 0.0))
    if backing <= 0:
        return ""

    subject_paths = []
    for element in fixed_svg.get("source_elements") or []:
        for subpath in transformed_svg_subpaths_mm(element, fixed_svg):
            cleaned = []
            for point in subpath:
                if not cleaned or point != cleaned[-1]:
                    cleaned.append(point)
            if len(cleaned) >= 2 and cleaned[0] == cleaned[-1]:
                cleaned = cleaned[:-1]
            if len(cleaned) < 3 or abs(polygon_area(cleaned)) < 0.0001:
                continue
            scaled = scale_polygon_for_clipper(cleaned)
            if pyclipper.Area(scaled) < 0:
                scaled.reverse()
            subject_paths.append(scaled)

    if not subject_paths:
        return ""

    clipper = pyclipper.Pyclipper()
    clipper.AddPaths(subject_paths, pyclipper.PT_SUBJECT, True)
    unioned = clipper.Execute(pyclipper.CT_UNION, pyclipper.PFT_NONZERO, pyclipper.PFT_NONZERO)
    if not unioned:
        return ""

    offset = pyclipper.PyclipperOffset(arc_tolerance=0.05 * FIXED_SVG_VECTOR_OFFSET_SCALE)
    offset.AddPaths(unioned, pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
    expanded = offset.Execute(backing * FIXED_SVG_VECTOR_OFFSET_SCALE)
    expanded = pyclipper.CleanPolygons(expanded, 0.015 * FIXED_SVG_VECTOR_OFFSET_SCALE)
    if not expanded:
        return ""

    return svg_path_from_mm_polygons([unscale_polygon_from_clipper(path) for path in expanded])


def draw_svg_element_to_mask(
    draw,
    element,
    fixed_svg,
    layout_scale,
    transform=(1.0, 0.0, 0.0, 1.0, 0.0, 0.0),
    stroke_width=0,
    offset_x_mm=0.0,
    offset_y_mm=0.0,
):
    next_transform = matrix_multiply(transform, parse_transform(element.attrib.get("transform")))
    source_scale = min(
        fixed_svg["width"] / fixed_svg["source_width"],
        fixed_svg["height"] / fixed_svg["source_height"],
    )

    for subpath in element_subpaths(element):
        points = []
        for x, y in subpath:
            tx, ty = apply_matrix(next_transform, x, y)
            final_x = fixed_svg["x"] + (tx - fixed_svg["source_x"]) * source_scale + offset_x_mm
            final_y = fixed_svg["y"] + (ty - fixed_svg["source_y"]) * source_scale + offset_y_mm
            points.append((final_x * layout_scale, final_y * layout_scale))
        if len(points) >= 3:
            draw.polygon(points, fill=255)
            if stroke_width > 0:
                draw.line(points, fill=255, width=stroke_width, joint="curve")

    for child in list(element):
        if local_svg_name(child) in BLOCKED_FIXED_SVG_TAGS:
            continue
        draw_svg_element_to_mask(draw, child, fixed_svg, layout_scale, next_transform, stroke_width, offset_x_mm, offset_y_mm)

def dilate_mask(mask, radius_px):
    radius_px = max(0, int(radius_px))
    if radius_px <= 0:
        return mask

    expanded = mask
    max_step = 8
    remaining = radius_px
    while remaining > 0:
        step = min(max_step, remaining)
        size = step * 2 + 1
        expanded = expanded.filter(ImageFilter.MaxFilter(size))
        remaining -= step
    return expanded

def format_svg_number(value):
    return f"{value:.3f}".rstrip("0").rstrip(".") or "0"


def translate_trace_path(path, dx, dy):
    tokens = SVG_PATH_TOKEN_RE.findall(str(path or ""))
    translated = []
    command = None
    index = 0

    def is_command(token):
        return len(token) == 1 and token.isalpha()

    def read_number():
        nonlocal index
        value = float(tokens[index])
        index += 1
        return value

    while index < len(tokens):
        if is_command(tokens[index]):
            command = tokens[index]
            translated.append(command)
            index += 1
            continue
        if not command:
            break

        op = command.upper()
        is_relative = command.islower()
        if op in {"M", "L", "T"} and index + 1 < len(tokens):
            x = read_number()
            y = read_number()
            translated.append(format_svg_number(x if is_relative else x + dx))
            translated.append(format_svg_number(y if is_relative else y + dy))
        elif op == "Q" and index + 3 < len(tokens):
            x1 = read_number()
            y1 = read_number()
            x = read_number()
            y = read_number()
            translated.append(format_svg_number(x1 if is_relative else x1 + dx))
            translated.append(format_svg_number(y1 if is_relative else y1 + dy))
            translated.append(format_svg_number(x if is_relative else x + dx))
            translated.append(format_svg_number(y if is_relative else y + dy))
        elif op == "C" and index + 5 < len(tokens):
            values = [read_number() for _ in range(6)]
            for value_index, value in enumerate(values):
                if is_relative:
                    translated.append(format_svg_number(value))
                else:
                    translated.append(format_svg_number(value + (dx if value_index % 2 == 0 else dy)))
        elif op == "H":
            x = read_number()
            translated.append(format_svg_number(x if is_relative else x + dx))
        elif op == "V":
            y = read_number()
            translated.append(format_svg_number(y if is_relative else y + dy))
        else:
            translated.append(tokens[index])
            index += 1

    return " ".join(translated)


def fixed_svg_offset_backing_path(order, fixed_svg, scale=FIXED_SVG_BACKING_TRACE_SCALE, tolerance_mm=FIXED_SVG_BACKING_TOLERANCE_MM):
    vector_path = fixed_svg_vector_offset_backing_path(fixed_svg)
    if vector_path:
        return vector_path

    backing = float(fixed_svg.get("backing_mm", 0.0))
    if backing <= 0:
        return ""

    padding_mm = max(FIXED_SVG_BACKING_TRACE_PADDING_MM, backing + 1.0)
    width_px = max(1, int(round((order["width"] + padding_mm * 2) * scale)))
    height_px = max(1, int(round((order["height"] + padding_mm * 2) * scale)))
    mask = Image.new("L", (width_px, height_px), 0)
    draw = ImageDraw.Draw(mask)

    for element in fixed_svg.get("source_elements") or []:
        draw_svg_element_to_mask(draw, element, fixed_svg, scale, offset_x_mm=padding_mm, offset_y_mm=padding_mm)

    if not mask.getbbox():
        return ""

    expanded = dilate_mask(mask, int(round(backing * scale)))
    # A small smoothing/threshold pass removes pixel stair-steps from the dilation
    # while keeping the requested physical offset close to the mask.
    expanded = expanded.filter(ImageFilter.GaussianBlur(max(0.5, scale * 0.03)))
    expanded = expanded.point(lambda value: 255 if value >= 96 else 0)
    fill_mask_holes(expanded)
    traced_path = text_outline_path(
        expanded,
        scale,
        tolerance_mm=tolerance_mm,
        smooth_iterations=2,
        curve_mode="quadratic",
    )
    return translate_trace_path(traced_path, -padding_mm, -padding_mm)

def fixed_svg_backing_path(fixed_svg):
    backing = float(fixed_svg.get("backing_mm", 0.0))
    if backing <= 0:
        return ""

    x = fixed_svg["x"] - backing
    y = fixed_svg["y"] - backing
    width = fixed_svg["width"] + backing * 2
    height = fixed_svg["height"] + backing * 2
    radius = min(backing, width / 2, height / 2)
    right = x + width
    bottom = y + height

    if radius <= 0:
        return f"M{x:.3f} {y:.3f} H{right:.3f} V{bottom:.3f} H{x:.3f} Z"

    return (
        f"M{x + radius:.3f} {y:.3f} H{right - radius:.3f} "
        f"Q{right:.3f} {y:.3f} {right:.3f} {y + radius:.3f} "
        f"V{bottom - radius:.3f} Q{right:.3f} {bottom:.3f} {right - radius:.3f} {bottom:.3f} "
        f"H{x + radius:.3f} Q{x:.3f} {bottom:.3f} {x:.3f} {bottom - radius:.3f} "
        f"V{y + radius:.3f} Q{x:.3f} {y:.3f} {x + radius:.3f} {y:.3f} Z"
    )


def build_fixed_svg_layers(order, instance_id, face_x, item_y, id_suffix=""):
    parts = []
    for fixed_svg in order.get("fixed_svgs", []):
        scale = min(
            fixed_svg["width"] / fixed_svg["source_width"],
            fixed_svg["height"] / fixed_svg["source_height"],
        )
        translate_x = face_x + fixed_svg["x"] - fixed_svg["source_x"] * scale
        translate_y = item_y + fixed_svg["y"] - fixed_svg["source_y"] * scale
        parts.append(
            f"""  <g id="{instance_id}{id_suffix}-fixed-svg-{fixed_svg["id"]}" data-fixed-svg-name="{fixed_svg["name"]}" transform="translate({translate_x:.3f} {translate_y:.3f}) scale({scale:.6f} {scale:.6f})" fill="rgb(255, 0, 0)" stroke="none">
    {fixed_svg["markup"]}
  </g>"""
        )

    return "\n".join(parts)


def build_fixed_svg_backing_layers(order, instance_id, backing_x, item_y, mirrored=False, id_suffix=""):
    parts = []
    for fixed_svg in order.get("fixed_svgs", []):
        if not fixed_svg.get("backing_border"):
            continue

        backing_path = fixed_svg_offset_backing_path(order, fixed_svg)
        if not backing_path:
            continue

        transform = f"translate({backing_x + order['width']:.3f} {item_y:.3f}) scale(-1 1)" if mirrored else f"translate({backing_x:.3f} {item_y:.3f})"
        parts.append(
            f'  <path id="{instance_id}{id_suffix}-fixed-svg-{fixed_svg["id"]}-backing-border" d="{backing_path}" transform="{transform}" fill="rgb(255, 0, 0)" stroke="none"/>'
        )

    return "\n".join(parts)


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


def build_name_group(order, instance_id, x, y, mirrored=False):
    group_id = f"{instance_id}-mirror-name-group" if mirrored else f"{instance_id}-name-group"
    transform = f"translate({x + order['width']:.3f} {y:.3f}) scale(-1 1)" if mirrored else f"translate({x:.3f} {y:.3f})"
    if mirrored:
        fixed_svg_layers = build_fixed_svg_layers(order, instance_id, 0.0, 0.0, "-mirror")
        if fixed_svg_layers:
            fixed_svg_layers = "\n" + fixed_svg_layers
        return f"""  <g id="{group_id}" transform="{transform}" fill="rgb(255, 0, 0)" stroke="none">
    <path d="{order["face_path"]}"/>{fixed_svg_layers}
  </g>"""

    return f"""  <g id="{group_id}" transform="{transform}" fill="rgb(255, 0, 0)" stroke="none">
    <path d="{order["face_path"]}"/>
  </g>"""


def build_backing_layer(order, instance_id, x, y, mirrored=False):
    layer_id = f"{instance_id}-mirror-backing-border" if mirrored else f"{instance_id}-backing-border"
    transform = f"translate({x + order['width']:.3f} {y:.3f}) scale(-1 1)" if mirrored else f"translate({x:.3f} {y:.3f})"
    return f"""  <path id="{layer_id}" d="{order["backing_path"]}" transform="{transform}" fill="rgb(255, 0, 0)" stroke="none"/>"""


def build_svg_document(title, desc, instances, fixed_columns=False):
    column_width = None
    if fixed_columns:
        column_width = max(
            BATCH_EXPORT_COLUMN_WIDTH_MM,
            *(instance["order"]["width"] for instance in instances),
        )
        export_width = column_width * 4
    else:
        export_width = max(instance["order"]["export_width"] for instance in instances)

    export_height = 0.0
    if instances:
        if fixed_columns:
            export_height = BATCH_EXPORT_START_STEP_MM * len(instances)
        else:
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
        face_x = 0.0
        mirror_face_x = None
        backing_x = order["backing_x"]
        color_label_x = None
        item_y = current_y
        color_label_y = None
        center_color_label = False
        if fixed_columns:
            column_item_x = (column_width - order["width"]) / 2
            mirror_face_x = column_item_x
            face_x = column_width + column_item_x
            backing_x = column_width * 2 + column_item_x
            color_label_x = column_width * 3 + column_width / 2
            item_y = current_y + max(0.0, (BATCH_EXPORT_START_STEP_MM - order["height"]) / 2)
            color_label_y = current_y + BATCH_EXPORT_START_STEP_MM / 2
            center_color_label = True

        if fixed_columns:
            parts.append(build_name_group(order, instance_id, mirror_face_x, item_y, mirrored=True))
            parts.append(build_name_group(order, instance_id, face_x, item_y))
            fixed_svg_layers = build_fixed_svg_layers(order, instance_id, face_x, item_y)
            if fixed_svg_layers:
                parts.append(fixed_svg_layers)
            fixed_svg_backing_layers = build_fixed_svg_backing_layers(order, instance_id, backing_x, item_y, mirrored=True, id_suffix="-mirror")
            if fixed_svg_backing_layers:
                parts.append(fixed_svg_backing_layers)
            parts.append(build_backing_layer(order, instance_id, backing_x, item_y, mirrored=True))
        else:
            parts.append(build_name_group(order, instance_id, face_x, item_y))
            fixed_svg_layers = build_fixed_svg_layers(order, instance_id, face_x, item_y)
            if fixed_svg_layers:
                parts.append(fixed_svg_layers)
            fixed_svg_backing_layers = build_fixed_svg_backing_layers(order, instance_id, backing_x, item_y)
            if fixed_svg_backing_layers:
                parts.append(fixed_svg_backing_layers)
            parts.append(build_backing_layer(order, instance_id, backing_x, item_y))

        color_label = build_color_label(
            order,
            instance_id,
            current_y,
            color_label_x,
            color_label_y,
            center_color_label,
        )
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
        f'Text: {order["text"]}. Columns are mirrored design, design, mirrored backing border, and color. '
        f'Generated as vector paths from the selected production fonts. Connected components: {order["connected_component_count"]}.'
    )
    if order.get("color_name"):
        desc += f' Color label: {order["color_name"]}.'
    if order.get("quantity", 1) > 1:
        desc += f' Quantity exported: {order["quantity"]}.'
    return build_svg_document("Badge reel layout", desc, instances, fixed_columns=True)


def build_batch_svg(root, layouts):
    order_paths = [build_single_order_paths(root, payload) for payload in layouts]
    desc_items = [
        f"Order {index + 1}: {order['text']}" + (f" (x{order['quantity']})" if order.get("quantity", 1) > 1 else "")
        for index, order in enumerate(order_paths)
    ]
    desc = (
        f'{"; ".join(desc_items)}. Each exported instance is stacked below the previous one. '
        f'Columns are mirrored design, design, mirrored backing border, and color. Generated as vector paths from the selected production fonts.'
    )
    return build_svg_document("Badge reel batch layout", desc, expand_export_instances(order_paths), fixed_columns=True)


def build_analysis(payload):
    root = Path(__file__).resolve().parents[1]
    return json.dumps(analyze_single_layout(root, payload))


def read_stdin_json():
    raw = sys.stdin.buffer.read()
    if not raw:
        return None

    try:
        return json.loads(raw.decode("utf-8"))
    except UnicodeDecodeError:
        return json.loads(raw.decode(sys.stdin.encoding or "utf-8"))


def main():
    payload = read_stdin_json()
    if isinstance(payload, dict) and payload.get("mode") == "analyze":
        sys.stdout.write(build_analysis(payload["layout"]))
        return

    sys.stdout.write(build_svg(payload))


if __name__ == "__main__":
    main()
