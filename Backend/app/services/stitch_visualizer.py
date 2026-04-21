from pathlib import Path
import colorsys
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
from .storage import preview_output_path, ASSETS_DIR
from app.data.dmc_colors import DMC_COLORS


DISPLAY_CELL_SIZE = 12
GRID_COLOR = (180, 180, 180, 255)
DESPECKLE_DOMINANT_NEIGHBORS = 5
DESPECKLE_MAX_MATCHING_NEIGHBORS = 1
LIGHT_COLOR_DESPECKLE_DOMINANT_NEIGHBORS = 4
LIGHT_COLOR_DESPECKLE_MAX_MATCHING_NEIGHBORS = 2
LIGHT_COLOR_BRIGHTNESS_THRESHOLD = 620
MAX_ISLAND_SIZE = 2
MIN_ISLAND_NEIGHBOR_SUPPORT = 3
STITCHED_COLOR_BUDGET_BONUS = 4
STITCHED_SHADE_CLUSTER_DISTANCE = 26
STITCHED_SHADE_CLUSTER_BRIGHTNESS_DELTA = 70
THREAD_FAMILY_MIN_SATURATION = 28
THREAD_FAMILY_MAX_BRIGHTNESS = 680
THREAD_FAMILY_MAX_HUE_DELTA = 26
THREAD_FAMILY_MAX_DISTANCE = 78
THREAD_FAMILY_MAX_BRIGHTNESS_DELTA = 130
STITCHED_MIN_COLORS = 3
STITCHED_MAX_COLORS = 64
DISTINCT_COLOR_DISTANCE_WEIGHT = 1.35
PHOTO_DISTINCT_COLOR_DISTANCE_WEIGHT = 1.6
PHOTO_EDGE_IMPORTANCE_WEIGHT = 36
PHOTO_DARK_IMPORTANCE_WEIGHT = 18
PHOTO_LOW_COUNT_IMPORTANCE_SCALE = 8
WHITE_BACKGROUND_BRIGHTNESS = 710
WHITE_BACKGROUND_SATURATION = 30
SOFT_WHITE_BACKGROUND_BRIGHTNESS = 670
SOFT_WHITE_BACKGROUND_SATURATION = 18
PHOTO_WHITE_BACKGROUND_BRIGHTNESS = 735
PHOTO_WHITE_BACKGROUND_SATURATION = 16
PHOTO_SOFT_BACKGROUND_BRIGHTNESS = 705
PHOTO_SOFT_BACKGROUND_SATURATION = 12
ISOLATED_SUBJECT_BACKGROUND_RATIO = 0.38
PHOTO_FEATURE_EDGE_THRESHOLD = 42
PHOTO_FEATURE_DARK_BRIGHTNESS = 430
PHOTO_FEATURE_LIGHT_BRIGHTNESS = 650
PHOTO_FEATURE_DARKEN_STRENGTH = 0.26
PHOTO_FEATURE_LIGHTEN_STRENGTH = 0.12

CONTRAST_MAP = {
    "low": 1.0,
    "normal": 1.3,
    "high": 1.6,
    "super_high": 1.9,
    "super_super_high": 2.2,
}


def _resolve_asset_path(image_url: str) -> Path:
    cleaned = image_url.lstrip("/")
    return ASSETS_DIR.parent / cleaned


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def color_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


def brightness(rgb: tuple[int, int, int]) -> int:
    return rgb[0] + rgb[1] + rgb[2]


def saturation(rgb: tuple[int, int, int]) -> int:
    return max(rgb) - min(rgb)


def is_neutral_background_candidate(rgb: tuple[int, int, int], max_saturation: int) -> bool:
    if saturation(rgb) > max_saturation:
        return False

    average = sum(rgb) / 3
    return all(abs(channel - average) <= max_saturation for channel in rgb)


def estimate_neutral_background_ratio(
    img: Image.Image,
    brightness_threshold: int,
    max_saturation: int,
) -> float:
    pixels = list(img.getdata())
    if not pixels:
        return 0.0

    matching = sum(
        1
        for pixel in pixels
        if brightness(pixel) >= brightness_threshold
        and is_neutral_background_candidate(pixel, max_saturation)
    )
    return matching / len(pixels)


def enhance_photo_features(img: Image.Image, background_ratio: float) -> Image.Image:
    if background_ratio < ISOLATED_SUBJECT_BACKGROUND_RATIO:
        return img

    edge_map = img.convert("L").filter(ImageFilter.FIND_EDGES)
    source_pixels = list(img.getdata())
    edge_pixels = list(edge_map.getdata())
    enhanced_pixels = []

    for pixel, edge_strength in zip(source_pixels, edge_pixels):
        if edge_strength < PHOTO_FEATURE_EDGE_THRESHOLD:
            enhanced_pixels.append(pixel)
            continue

        pixel_brightness = brightness(pixel)
        pixel_saturation = saturation(pixel)

        if pixel_brightness <= PHOTO_FEATURE_DARK_BRIGHTNESS:
            factor = max(0.0, 1.0 - PHOTO_FEATURE_DARKEN_STRENGTH * (edge_strength / 255))
            enhanced_pixels.append(
                tuple(max(0, min(255, round(channel * factor))) for channel in pixel)
            )
            continue

        if (
            pixel_brightness >= PHOTO_FEATURE_LIGHT_BRIGHTNESS
            and pixel_saturation <= PHOTO_SOFT_BACKGROUND_SATURATION + 6
        ):
            blend = PHOTO_FEATURE_LIGHTEN_STRENGTH * (edge_strength / 255)
            enhanced_pixels.append(
                tuple(
                    max(0, min(255, round(channel + (255 - channel) * blend)))
                    for channel in pixel
                )
            )
            continue

        enhanced_pixels.append(pixel)

    enhanced = Image.new("RGB", img.size)
    enhanced.putdata(enhanced_pixels)
    return enhanced


def hue_degrees(rgb: tuple[int, int, int]) -> float:
    r, g, b = (channel / 255 for channel in rgb)
    hue, _, _ = colorsys.rgb_to_hsv(r, g, b)
    return hue * 360


def hue_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    diff = abs(hue_degrees(a) - hue_degrees(b))
    return min(diff, 360 - diff)


def nearest_dmc(rgb: tuple[int, int, int]) -> dict:
    return min(DMC_COLORS, key=lambda dmc: color_distance(rgb, dmc["rgb"]))


def extract_palette(img: Image.Image) -> list[dict]:
    colors = img.getcolors(maxcolors=256000) or []
    sorted_colors = sorted(colors, key=lambda item: item[0], reverse=True)

    results = []
    seen_rgb = set()

    for _, rgb in sorted_colors:
        if rgb in seen_rgb:
            continue

        seen_rgb.add(rgb)
        dmc = nearest_dmc(rgb)
        results.append(
            {
                "hex": rgb_to_hex(rgb),
                "dmc_code": dmc["code"],
                "dmc_name": dmc["name"],
            }
        )

    return results


def prepare_source_image(
    img: Image.Image,
    source_type: str,
) -> Image.Image:
    if source_type == "photo":
        background_ratio = estimate_neutral_background_ratio(
            img,
            PHOTO_SOFT_BACKGROUND_BRIGHTNESS,
            PHOTO_SOFT_BACKGROUND_SATURATION,
        )
        if background_ratio < ISOLATED_SUBJECT_BACKGROUND_RATIO:
            return img

        source_pixels = list(img.getdata())
        cleaned_pixels = []

        for pixel in source_pixels:
            pixel_brightness = brightness(pixel)

            if pixel_brightness >= PHOTO_WHITE_BACKGROUND_BRIGHTNESS and is_neutral_background_candidate(
                pixel, PHOTO_WHITE_BACKGROUND_SATURATION
            ):
                cleaned_pixels.append((255, 255, 255))
                continue

            if pixel_brightness >= PHOTO_SOFT_BACKGROUND_BRIGHTNESS and is_neutral_background_candidate(
                pixel, PHOTO_SOFT_BACKGROUND_SATURATION
            ):
                cleaned_pixels.append((250, 250, 250))
                continue

            cleaned_pixels.append(pixel)

        cleaned = Image.new("RGB", img.size)
        cleaned.putdata(cleaned_pixels)
        return cleaned.filter(ImageFilter.UnsharpMask(radius=1.0, percent=115, threshold=2))

    if source_type != "stitched_photo":
        return img

    source_pixels = list(img.getdata())
    cleaned_pixels = []

    for pixel in source_pixels:
        pixel_brightness = brightness(pixel)
        pixel_saturation = saturation(pixel)

        if pixel_brightness >= WHITE_BACKGROUND_BRIGHTNESS and is_neutral_background_candidate(
            pixel, WHITE_BACKGROUND_SATURATION
        ):
            cleaned_pixels.append((255, 255, 255))
            continue

        if pixel_brightness >= SOFT_WHITE_BACKGROUND_BRIGHTNESS and is_neutral_background_candidate(
            pixel, SOFT_WHITE_BACKGROUND_SATURATION
        ):
            cleaned_pixels.append((248, 248, 248))
            continue

        cleaned_pixels.append(pixel)

    cleaned = Image.new("RGB", img.size)
    cleaned.putdata(cleaned_pixels)
    return cleaned.filter(ImageFilter.UnsharpMask(radius=1.35, percent=170, threshold=2))


def normalize_background_after_quantization(
    img: Image.Image,
    source_type: str,
) -> Image.Image:
    if source_type == "photo":
        background_ratio = estimate_neutral_background_ratio(
            img,
            PHOTO_SOFT_BACKGROUND_BRIGHTNESS,
            PHOTO_SOFT_BACKGROUND_SATURATION,
        )
        if background_ratio < ISOLATED_SUBJECT_BACKGROUND_RATIO:
            return img

        pixels = list(img.getdata())
        normalized_pixels = []

        for pixel in pixels:
            pixel_brightness = brightness(pixel)
            pixel_saturation = saturation(pixel)

            if pixel_brightness >= PHOTO_SOFT_BACKGROUND_BRIGHTNESS and is_neutral_background_candidate(
                pixel, PHOTO_SOFT_BACKGROUND_SATURATION
            ):
                normalized_pixels.append((255, 255, 255))
                continue

            if pixel_brightness >= PHOTO_WHITE_BACKGROUND_BRIGHTNESS and pixel_saturation <= PHOTO_WHITE_BACKGROUND_SATURATION:
                normalized_pixels.append((255, 255, 255))
                continue

            normalized_pixels.append(pixel)

        normalized = Image.new("RGB", img.size)
        normalized.putdata(normalized_pixels)
        return normalized

    if source_type != "stitched_photo":
        return img

    pixels = list(img.getdata())
    normalized_pixels = []

    for pixel in pixels:
        pixel_brightness = brightness(pixel)
        pixel_saturation = saturation(pixel)

        if pixel_brightness >= SOFT_WHITE_BACKGROUND_BRIGHTNESS and is_neutral_background_candidate(
            pixel, SOFT_WHITE_BACKGROUND_SATURATION
        ):
            normalized_pixels.append((255, 255, 255))
            continue

        normalized_pixels.append(pixel)

    normalized = Image.new("RGB", img.size)
    normalized.putdata(normalized_pixels)
    return normalized


def consolidate_stitched_shades(
    img: Image.Image,
    target_color_count: int,
) -> Image.Image:
    colors = img.getcolors(maxcolors=256000) or []
    if not colors:
      return img

    sorted_colors = sorted(colors, key=lambda item: item[0], reverse=True)
    groups: list[dict] = []

    for count, rgb in sorted_colors:
        nearest_group = None
        nearest_distance = None

        for group in groups:
            distance = color_distance(rgb, group["representative"])
            brightness_delta = abs(brightness(rgb) - brightness(group["representative"]))
            if (
                distance <= STITCHED_SHADE_CLUSTER_DISTANCE
                and brightness_delta <= STITCHED_SHADE_CLUSTER_BRIGHTNESS_DELTA
                and (nearest_distance is None or distance < nearest_distance)
            ):
                nearest_group = group
                nearest_distance = distance

        if nearest_group is None:
            groups.append(
                {
                    "representative": rgb,
                    "representative_count": count,
                    "members": {rgb},
                }
            )
            continue

        nearest_group["members"].add(rgb)
        if count > nearest_group["representative_count"]:
            nearest_group["representative"] = rgb
            nearest_group["representative_count"] = count

    while len(groups) > target_color_count:
        best_pair = None
        best_distance = None

        for left_index in range(len(groups)):
            for right_index in range(left_index + 1, len(groups)):
                left_group = groups[left_index]
                right_group = groups[right_index]
                distance = color_distance(
                    left_group["representative"],
                    right_group["representative"],
                )
                if best_distance is None or distance < best_distance:
                    best_distance = distance
                    best_pair = (left_index, right_index)

        if best_pair is None:
            break

        left_index, right_index = best_pair
        left_group = groups[left_index]
        right_group = groups[right_index]

        if right_group["representative_count"] > left_group["representative_count"]:
            left_group["representative"] = right_group["representative"]
            left_group["representative_count"] = right_group["representative_count"]

        left_group["members"].update(right_group["members"])
        groups.pop(right_index)

    replacement_map: dict[tuple[int, int, int], tuple[int, int, int]] = {}
    for group in groups:
        for member in group["members"]:
            replacement_map[member] = group["representative"]

    remapped = Image.new("RGB", img.size)
    remapped.putdata([replacement_map.get(pixel, pixel) for pixel in img.getdata()])
    return remapped


def collapse_dominant_thread_families(img: Image.Image) -> Image.Image:
    colors = img.getcolors(maxcolors=256000) or []
    if not colors:
        return img

    sorted_colors = sorted(colors, key=lambda item: item[0], reverse=True)
    representatives = [
        (count, rgb)
        for count, rgb in sorted_colors
        if saturation(rgb) >= THREAD_FAMILY_MIN_SATURATION
        and brightness(rgb) <= THREAD_FAMILY_MAX_BRIGHTNESS
    ]

    replacement_map: dict[tuple[int, int, int], tuple[int, int, int]] = {}

    for count, rgb in sorted_colors:
        if rgb in replacement_map:
            continue

        for representative_count, representative_rgb in representatives:
            if representative_rgb == rgb:
                break
            if representative_count < count:
                continue
            if hue_distance(rgb, representative_rgb) > THREAD_FAMILY_MAX_HUE_DELTA:
                continue
            if color_distance(rgb, representative_rgb) > THREAD_FAMILY_MAX_DISTANCE:
                continue
            if abs(brightness(rgb) - brightness(representative_rgb)) > THREAD_FAMILY_MAX_BRIGHTNESS_DELTA:
                continue

            replacement_map[rgb] = representative_rgb
            break

    if not replacement_map:
        return img

    remapped = Image.new("RGB", img.size)
    remapped.putdata([replacement_map.get(pixel, pixel) for pixel in img.getdata()])
    return remapped


def select_distinct_palette_colors(
    img: Image.Image,
    target_color_count: int,
    source_image: Image.Image | None = None,
    source_type: str = "stitched_photo",
) -> list[tuple[int, int, int]]:
    colors = img.getcolors(maxcolors=256000) or []
    if not colors:
        return []

    sorted_colors = sorted(colors, key=lambda item: item[0], reverse=True)
    color_metrics: dict[tuple[int, int, int], dict[str, float]] = {}

    if source_image is not None and source_type == "photo":
        edge_map = source_image.convert("L").filter(ImageFilter.FIND_EDGES)
        edge_pixels = list(edge_map.getdata())
        source_pixels = list(img.getdata())
        metric_buckets: dict[tuple[int, int, int], dict[str, float]] = {}

        for pixel, edge_strength in zip(source_pixels, edge_pixels):
            bucket = metric_buckets.setdefault(pixel, {"edge_sum": 0.0, "count": 0.0})
            bucket["edge_sum"] += edge_strength
            bucket["count"] += 1

        for _, rgb in sorted_colors:
            bucket = metric_buckets.get(rgb)
            average_edge = (bucket["edge_sum"] / bucket["count"]) if bucket and bucket["count"] else 0.0
            darkness = max(0, (760 - brightness(rgb)) / 255)
            color_metrics[rgb] = {
                "average_edge": average_edge,
                "darkness": darkness,
            }

    selected = [sorted_colors[0][1]]

    while len(selected) < target_color_count and len(selected) < len(sorted_colors):
        best_rgb = None
        best_score = None

        for count, rgb in sorted_colors:
            if rgb in selected:
                continue

            min_distance = min(color_distance(rgb, chosen) for chosen in selected)
            if source_type == "photo":
                metrics = color_metrics.get(rgb, {"average_edge": 0.0, "darkness": 0.0})
                score = (
                    min_distance * PHOTO_DISTINCT_COLOR_DISTANCE_WEIGHT
                    + count
                    + metrics["average_edge"] * PHOTO_EDGE_IMPORTANCE_WEIGHT
                    + metrics["darkness"] * PHOTO_DARK_IMPORTANCE_WEIGHT
                    + (PHOTO_LOW_COUNT_IMPORTANCE_SCALE / max(1, count))
                )
            else:
                score = min_distance * DISTINCT_COLOR_DISTANCE_WEIGHT + count

            if best_score is None or score > best_score:
                best_score = score
                best_rgb = rgb

        if best_rgb is None:
            break

        selected.append(best_rgb)

    return selected


def remap_image_to_palette(
    img: Image.Image,
    palette: list[tuple[int, int, int]],
) -> Image.Image:
    if not palette:
        return img

    remapped_pixels = []
    for pixel in img.getdata():
        nearest = min(palette, key=lambda candidate: color_distance(pixel, candidate))
        remapped_pixels.append(nearest)

    remapped = Image.new("RGB", img.size)
    remapped.putdata(remapped_pixels)
    return remapped


def despeckle_image(img: Image.Image) -> Image.Image:
    width, height = img.size
    source_pixels = list(img.getdata())
    cleaned_pixels = source_pixels.copy()

    for y in range(height):
        for x in range(width):
            idx = y * width + x
            current = source_pixels[idx]
            neighbor_counts: dict[tuple[int, int, int], int] = {}
            matching_neighbors = 0

            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue

                    nx = x + dx
                    ny = y + dy
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue

                    neighbor = source_pixels[ny * width + nx]
                    neighbor_counts[neighbor] = neighbor_counts.get(neighbor, 0) + 1
                    if neighbor == current:
                        matching_neighbors += 1

            if not neighbor_counts:
                continue

            dominant_neighbor, dominant_count = max(
                neighbor_counts.items(),
                key=lambda item: item[1],
            )

            is_light_color = brightness(current) >= LIGHT_COLOR_BRIGHTNESS_THRESHOLD
            required_neighbors = (
                LIGHT_COLOR_DESPECKLE_DOMINANT_NEIGHBORS
                if is_light_color
                else DESPECKLE_DOMINANT_NEIGHBORS
            )
            max_matching_neighbors = (
                LIGHT_COLOR_DESPECKLE_MAX_MATCHING_NEIGHBORS
                if is_light_color
                else DESPECKLE_MAX_MATCHING_NEIGHBORS
            )

            if (
                dominant_neighbor != current
                and matching_neighbors <= max_matching_neighbors
                and dominant_count >= required_neighbors
            ):
                cleaned_pixels[idx] = dominant_neighbor

    cleaned = Image.new("RGB", img.size)
    cleaned.putdata(cleaned_pixels)
    return cleaned


def cleanup_tiny_color_islands(img: Image.Image) -> Image.Image:
    width, height = img.size
    pixels = list(img.getdata())
    cleaned_pixels = pixels.copy()
    visited: set[tuple[int, int]] = set()

    def neighbors(x: int, y: int) -> list[tuple[int, int]]:
        results = []
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx = x + dx
            ny = y + dy
            if 0 <= nx < width and 0 <= ny < height:
                results.append((nx, ny))
        return results

    for y in range(height):
        for x in range(width):
            if (x, y) in visited:
                continue

            color = pixels[y * width + x]
            stack = [(x, y)]
            component: list[tuple[int, int]] = []
            border_counts: dict[tuple[int, int, int], int] = {}

            while stack:
                cx, cy = stack.pop()
                if (cx, cy) in visited:
                    continue
                if pixels[cy * width + cx] != color:
                    continue

                visited.add((cx, cy))
                component.append((cx, cy))

                for nx, ny in neighbors(cx, cy):
                    neighbor_color = pixels[ny * width + nx]
                    if neighbor_color == color:
                        if (nx, ny) not in visited:
                            stack.append((nx, ny))
                    else:
                        border_counts[neighbor_color] = border_counts.get(neighbor_color, 0) + 1

            if len(component) > MAX_ISLAND_SIZE or not border_counts:
                continue

            replacement_color, support = max(border_counts.items(), key=lambda item: item[1])
            if support < MIN_ISLAND_NEIGHBOR_SUPPORT:
                continue

            for cx, cy in component:
                cleaned_pixels[cy * width + cx] = replacement_color

    cleaned = Image.new("RGB", img.size)
    cleaned.putdata(cleaned_pixels)
    return cleaned


def render_preview_image(
    quantized: Image.Image,
    stitch_width: int,
    stitch_height: int,
    mesh_count: int,
    show_grid: bool,
) -> str:
    border_stitches = int(1.0 * mesh_count)

    total_width = stitch_width + (2 * border_stitches)
    total_height = stitch_height + (2 * border_stitches)

    canvas = Image.new("RGB", (total_width, total_height), (255, 255, 255))
    canvas.paste(quantized, (border_stitches, border_stitches))

    display_w = total_width * DISPLAY_CELL_SIZE
    display_h = total_height * DISPLAY_CELL_SIZE

    preview = canvas.resize((display_w, display_h), Image.Resampling.NEAREST).convert("RGBA")

    if show_grid:
        draw = ImageDraw.Draw(preview)
        for x in range(0, display_w + 1, DISPLAY_CELL_SIZE):
            draw.line([(x, 0), (x, display_h)], fill=GRID_COLOR, width=1)
        for y in range(0, display_h + 1, DISPLAY_CELL_SIZE):
            draw.line([(0, y), (display_w, y)], fill=GRID_COLOR, width=1)

    out_path, out_url = preview_output_path()
    preview.save(out_path, format="PNG")
    return out_url


def generate_stitch_preview(
    image_url: str,
    stitch_width: int,
    stitch_height: int,
    color_count: int,
    show_grid: bool,
    mesh_count: int,
    contrast_level: str,
    source_type: str = "photo",
) -> tuple[str, list[dict]]:
    src_path = _resolve_asset_path(image_url)
    img = Image.open(src_path).convert("RGB")

    resized = img.resize((stitch_width, stitch_height), Image.Resampling.BILINEAR)
    photo_background_ratio = (
        estimate_neutral_background_ratio(
            resized,
            PHOTO_SOFT_BACKGROUND_BRIGHTNESS,
            PHOTO_SOFT_BACKGROUND_SATURATION,
        )
        if source_type == "photo"
        else 0.0
    )
    prepared = prepare_source_image(resized, source_type)
    if source_type == "photo":
        prepared = enhance_photo_features(prepared, photo_background_ratio)

    contrast_factor = CONTRAST_MAP.get(contrast_level, 1.3)
    enhanced = ImageEnhance.Contrast(prepared).enhance(contrast_factor)

    target_color_count = color_count
    effective_color_count = (
        min(64, color_count + STITCHED_COLOR_BUDGET_BONUS)
        if source_type == "stitched_photo"
        else color_count
    )
    if source_type == "stitched_photo":
        target_color_count = max(STITCHED_MIN_COLORS, min(STITCHED_MAX_COLORS, color_count))
        effective_color_count = min(16, target_color_count + STITCHED_COLOR_BUDGET_BONUS)

    quantized = enhanced.quantize(
        colors=max(2, effective_color_count),
        method=Image.MEDIANCUT,
        dither=(
            Image.Dither.NONE
            if source_type == "stitched_photo" or photo_background_ratio >= ISOLATED_SUBJECT_BACKGROUND_RATIO
            else Image.Dither.FLOYDSTEINBERG
        ),
    ).convert("RGB")
    quantized = normalize_background_after_quantization(quantized, source_type)
    if source_type == "stitched_photo":
        quantized = consolidate_stitched_shades(quantized, max(2, target_color_count))
        quantized = collapse_dominant_thread_families(quantized)
        distinct_palette = select_distinct_palette_colors(
            quantized,
            max(2, target_color_count),
            source_image=enhanced,
            source_type=source_type,
        )
        quantized = remap_image_to_palette(quantized, distinct_palette)
        quantized = normalize_background_after_quantization(quantized, source_type)
        quantized = cleanup_tiny_color_islands(quantized)
    else:
        distinct_palette = select_distinct_palette_colors(
            quantized,
            max(2, target_color_count),
            source_image=enhanced,
            source_type=source_type,
        )
        quantized = remap_image_to_palette(quantized, distinct_palette)
        quantized = normalize_background_after_quantization(quantized, source_type)
        quantized = despeckle_image(quantized)
        quantized = cleanup_tiny_color_islands(quantized)

    palette = extract_palette(quantized)
    cells = image_to_cells(quantized)

    preview_url = render_preview_image(
        quantized=quantized,
        stitch_width=stitch_width,
        stitch_height=stitch_height,
        mesh_count=mesh_count,
        show_grid=show_grid,
    )

    return preview_url, palette, cells


def recolor_stitch_preview(
    image_url: str,
    stitch_width: int,
    stitch_height: int,
    mesh_count: int,
    show_grid: bool,
    selected_palette: list[dict],
) -> tuple[str, list[dict], list[list[str]]]:
    src_path = _resolve_asset_path(image_url)
    img = Image.open(src_path).convert("RGB")

    base = img.resize((stitch_width, stitch_height), Image.Resampling.BILINEAR)

    allowed_colors = [hex_to_rgb(color["hex"]) for color in selected_palette]
    if not allowed_colors:
        raise ValueError("At least one color must be selected.")

    pixels = list(base.getdata())
    remapped_pixels = []

    for pixel in pixels:
        nearest = min(allowed_colors, key=lambda allowed: color_distance(pixel, allowed))
        remapped_pixels.append(nearest)

    recolored = Image.new("RGB", base.size)
    recolored.putdata(remapped_pixels)
    recolored = despeckle_image(recolored)
    recolored = cleanup_tiny_color_islands(recolored)

    palette = extract_palette(recolored)
    preview_url = render_preview_image(
        quantized=recolored,
        stitch_width=stitch_width,
        stitch_height=stitch_height,
        mesh_count=mesh_count,
        show_grid=show_grid,
    )

    cells = image_to_cells(recolored)

    return preview_url, palette, cells

def image_to_cells(img: Image.Image) -> list[list[str]]:
    width, height = img.size
    pixels = list(img.getdata())
    rows = []

    for y in range(height):
        row = []
        for x in range(width):
            rgb = pixels[y * width + x]
            row.append(rgb_to_hex(rgb))
        rows.append(row)

    return rows
