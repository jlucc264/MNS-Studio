from pathlib import Path
import colorsys
from contextvars import ContextVar
from io import BytesIO
from urllib.request import Request, urlopen
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps
from .storage import preview_output_path, ASSETS_DIR
from app.data.dmc_colors import DMC_COLORS


DISPLAY_CELL_SIZE = 12
GRID_COLOR = (180, 180, 180, 255)
BLANK_CELL = "__BLANK__"
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
STITCHED_MAX_COLORS = 128
DISTINCT_COLOR_DISTANCE_WEIGHT = 1.35
PHOTO_DISTINCT_COLOR_DISTANCE_WEIGHT = 1.6
PHOTO_EDGE_IMPORTANCE_WEIGHT = 36
PHOTO_DARK_IMPORTANCE_WEIGHT = 18
PHOTO_LOW_COUNT_IMPORTANCE_SCALE = 8
GRAPHIC_ART_DISTINCT_COLOR_DISTANCE_WEIGHT = 1.95
GRAPHIC_ART_EDGE_IMPORTANCE_WEIGHT = 44
GRAPHIC_ART_DARK_IMPORTANCE_WEIGHT = 12
GRAPHIC_ART_LOW_COUNT_IMPORTANCE_SCALE = 18
GRAPHIC_ART_MINORITY_COMPONENT_WEIGHT = 24
GRAPHIC_ART_MINORITY_DISTINCT_DISTANCE_WEIGHT = 0.85
GRAPHIC_ART_MINORITY_COUNT_THRESHOLD = 110
GRAPHIC_ART_HIGH_SATURATION_BONUS_WEIGHT = 20
GRAPHIC_ART_NEUTRAL_PENALTY_WEIGHT = 18
REGION_COMPONENT_WEIGHT = 10
REGION_BOUNDARY_RATIO_WEIGHT = 28
REGION_LARGEST_COMPONENT_WEIGHT = 4
REGION_FRAGMENTATION_PENALTY_WEIGHT = 18
REGION_WEAK_BOUNDARY_PENALTY_WEIGHT = 14
STITCHED_LIGHT_NEUTRAL_PENALTY_WEIGHT = 42
STITCHED_MINORITY_COMPONENT_WEIGHT = 18
STITCHED_MINORITY_DISTINCT_DISTANCE_WEIGHT = 0.55
STITCHED_MINORITY_COUNT_THRESHOLD = 120
STITCHED_DIFFUSE_NEUTRAL_PENALTY_WEIGHT = 22
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
STITCHED_TEXT_EDGE_THRESHOLD = 28
STITCHED_TEXT_MAX_BRIGHTNESS = 610
STITCHED_TEXT_MIN_SATURATION = 18
STITCHED_TEXT_DARK_NEUTRAL_BRIGHTNESS = 360
STITCHED_TEXT_LIGHT_NEUTRAL_BRIGHTNESS = 690
STITCHED_TEXT_LIGHT_NEUTRAL_SATURATION = 20
STITCHED_TEXT_DARKEN_STRENGTH = 0.34
STITCHED_TEXT_SATURATION_BOOST = 0.12
STITCHED_DETAIL_EDGE_THRESHOLD = 34
STITCHED_DETAIL_DARK_BRIGHTNESS = 460
STITCHED_DETAIL_LIGHT_BRIGHTNESS = 610
STITCHED_DETAIL_NEUTRAL_SATURATION = 26
STITCHED_DETAIL_DARKEN_STRENGTH = 0.2
STITCHED_DETAIL_LIGHTEN_STRENGTH = 0.18
STITCHED_CANVAS_BACKGROUND_BRIGHTNESS = 585
STITCHED_CANVAS_BACKGROUND_SATURATION = 56
STITCHED_SOFT_BACKGROUND_BRIGHTNESS = 520
STITCHED_SOFT_BACKGROUND_SATURATION = 28
STITCHED_BACKGROUND_EDGE_PROTECT_THRESHOLD = 24
GRAPHIC_ART_EDGE_THRESHOLD = 26
GRAPHIC_ART_DARK_BRIGHTNESS = 500
GRAPHIC_ART_LIGHT_BRIGHTNESS = 675
GRAPHIC_ART_LIGHT_SATURATION = 26
GRAPHIC_ART_DARKEN_STRENGTH = 0.22
GRAPHIC_ART_LIGHTEN_STRENGTH = 0.2
GRAPHIC_ART_BACKGROUND_BRIGHTNESS = 700
GRAPHIC_ART_BACKGROUND_SATURATION = 24
GRAPHIC_ART_RESIZE_SATURATION_BOOST = 1.08
GRAPHIC_ART_STROKE_EDGE_THRESHOLD = 18
GRAPHIC_ART_STROKE_FOREGROUND_BRIGHTNESS = 625
GRAPHIC_ART_STROKE_FOREGROUND_SATURATION = 36
GRAPHIC_ART_STROKE_SUPPORT_THRESHOLD = 2
GRAPHIC_ART_STROKE_BRIDGE_BLEND = 0.62
GRAPHIC_ART_STROKE_REINFORCE_BLEND = 0.28
STITCHED_STROKE_EDGE_THRESHOLD = 20
STITCHED_STROKE_FOREGROUND_BRIGHTNESS = 600
STITCHED_STROKE_FOREGROUND_SATURATION = 28
STITCHED_STROKE_SUPPORT_THRESHOLD = 2
STITCHED_STROKE_BRIDGE_BLEND = 0.48
STITCHED_STROKE_REINFORCE_BLEND = 0.22
SIMPLIFY_BLEND_GRAPHIC = 0.5
SIMPLIFY_BLEND_STITCHED = 0.4
SIMPLIFY_BLEND_PHOTO = 0.28
DARK_DETAIL_EDGE_THRESHOLD = 24
DARK_DETAIL_BRIGHTNESS_LIMIT = 560
DARK_DETAIL_DARKEN_STRENGTH = 0.24
SMALL_REGION_PROXY_COLORS = 14
SMALL_REGION_MIN_PIXELS = 3
SMALL_REGION_MAX_PIXELS = 180
SMALL_REGION_MIN_COMPONENT_RATIO = 0.42
SMALL_REGION_MIN_BOUNDARY_RATIO = 1.1
SMALL_REGION_BLEND_STRENGTH = 0.58
SMALL_REGION_EDGE_BLEND_BONUS = 0.18

CONTRAST_MAP = {
    "low": 1.0,
    "normal": 1.3,
    "high": 1.6,
    "super_high": 1.9,
    "super_super_high": 2.2,
}


def _resolve_asset_path(image_url: str) -> Path | str:
    if image_url.startswith(("http://", "https://")):
        return image_url
    cleaned = image_url.lstrip("/")
    return ASSETS_DIR.parent / cleaned


def flatten_transparency_to_white(img: Image.Image) -> Image.Image:
    if img.mode in {"RGBA", "LA"} or "transparency" in img.info:
        rgba = img.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        background.alpha_composite(rgba)
        return background.convert("RGB")

    return img.convert("RGB")


def open_source_image(src_path: Path | str) -> Image.Image:
    if isinstance(src_path, str) and src_path.startswith(("http://", "https://")):
        request = Request(src_path, headers={"User-Agent": "MNS/1.0"})
        with urlopen(request, timeout=30) as response:
            image_bytes = BytesIO(response.read())
        with Image.open(image_bytes) as img:
            return flatten_transparency_to_white(ImageOps.exif_transpose(img))

    with Image.open(src_path) as img:
        return flatten_transparency_to_white(ImageOps.exif_transpose(img))


def source_transparency_mask(src_path: Path | str, size: tuple[int, int]) -> set[tuple[int, int]]:
    if isinstance(src_path, str) and src_path.startswith(("http://", "https://")):
        request = Request(src_path, headers={"User-Agent": "MNS/1.0"})
        with urlopen(request, timeout=30) as response:
            img_bytes = BytesIO(response.read())
        img_ctx = Image.open(img_bytes)
    else:
        img_ctx = Image.open(src_path)

    with img_ctx as img:
        if img.mode not in {"RGBA", "LA"} and "transparency" not in img.info:
            return set()

        alpha = img.convert("RGBA").getchannel("A").resize(size, Image.Resampling.BILINEAR)
        pixels = list(alpha.getdata())
        width, height = size
        return {
            (index % width, index // width)
            for index, value in enumerate(pixels)
            if value < 16
        }


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def color_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


def _srgb_channel_to_linear(value: int) -> float:
    u = value / 255.0
    return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4


def srgb_to_oklab(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    r = _srgb_channel_to_linear(rgb[0])
    g = _srgb_channel_to_linear(rgb[1])
    b = _srgb_channel_to_linear(rgb[2])
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = l ** (1 / 3), m ** (1 / 3), s ** (1 / 3)
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


_OKLAB_M1 = np.array([
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
])
_OKLAB_M2 = np.array([
    [0.2104542553, 0.7936177850, -0.0040720468],
    [1.9779984951, -2.4285922050, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.8086757660],
])
_OKLAB_M1_INV = np.linalg.inv(_OKLAB_M1)
_OKLAB_M2_INV = np.linalg.inv(_OKLAB_M2)


# np.where(cond, A, B) was found to incorrectly compose its two branches
# (rather than select between them) for large arrays on Render production
# host — a 200x200 solid color came back wrong at this exact decode/encode
# step while an 8x8 array of the same values came back correct (see the
# comment near _verify_numeric_environment for the full diagnostic trail).
# Boolean-mask assignment computes each branch only from the *original*
# array, restricted to its own elements, so one branch's output can never
# feed into the other regardless of how that composition bug manifests.
def _srgb_to_linear_array(u: np.ndarray) -> np.ndarray:
    mask = u <= 0.04045
    out = np.empty_like(u)
    out[mask] = u[mask] / 12.92
    out[~mask] = ((u[~mask] + 0.055) / 1.055) ** 2.4
    return out


def _linear_to_srgb_array(lin: np.ndarray) -> np.ndarray:
    mask = lin <= 0.0031308
    out = np.empty_like(lin)
    out[mask] = lin[mask] * 12.92
    out[~mask] = 1.055 * np.clip(lin[~mask], 0.0, None) ** (1 / 2.4) - 0.055
    return out


def _srgb_to_oklab_array(rgb: np.ndarray) -> np.ndarray:
    u = rgb / 255.0
    lin = _srgb_to_linear_array(u)
    return np.cbrt(lin @ _OKLAB_M1.T) @ _OKLAB_M2.T


def _oklab_to_srgb_array(lab: np.ndarray) -> np.ndarray:
    lms = (lab @ _OKLAB_M2_INV.T) ** 3
    lin = lms @ _OKLAB_M1_INV.T
    u = _linear_to_srgb_array(lin)
    return np.clip(u * 255.0, 0.0, 255.0)


BLEND_CLUSTER_MAX_PERP_RATIO = 0.12
BLEND_CLUSTER_MIN_SPAN = 0.08
BLEND_CLUSTER_MAX_WEIGHT_RATIO = 0.35
BLEND_CLUSTER_MIN_CONTACT_FRACTION = 0.5
OKLAB_CLUSTER_MERGE_DISTANCE = 0.07
OKLAB_MERGE_MAX_CHROMA_DIFF = 0.045
OKLAB_MERGE_HUE_GUARD_CHROMA = 0.03
OKLAB_MERGE_MAX_HUE_ANGLE = 60.0


def _mergeable_pair(center_a: np.ndarray, center_b: np.ndarray) -> bool:
    """Guard against merging colors OKLab distance underestimates.

    Chroma compresses toward zero at low lightness, so a dark green field and
    its black shadow gaps measure deceptively close. Refuse merges across a
    large chroma gap (a colored thread into a neutral) or between distinctly
    different hues when both clusters are actually chromatic.
    """
    chroma_a = float(np.hypot(center_a[1], center_a[2]))
    chroma_b = float(np.hypot(center_b[1], center_b[2]))
    if abs(chroma_a - chroma_b) > OKLAB_MERGE_MAX_CHROMA_DIFF:
        return False
    if min(chroma_a, chroma_b) >= OKLAB_MERGE_HUE_GUARD_CHROMA:
        hue_a = np.degrees(np.arctan2(center_a[2], center_a[1]))
        hue_b = np.degrees(np.arctan2(center_b[2], center_b[1]))
        hue_diff = abs(hue_a - hue_b) % 360.0
        if min(hue_diff, 360.0 - hue_diff) > OKLAB_MERGE_MAX_HUE_ANGLE:
            return False
    return True


def _merge_close_clusters(
    centers: np.ndarray, lab: np.ndarray, weights: np.ndarray
) -> np.ndarray:
    """Merge cluster centers closer than one perceptual step in OKLab.

    K-means at an over-provisioned budget frequently lands two centers on the
    same thread family (both snapping to the same or adjacent DMC codes); the
    downstream RGB-threshold consolidation can't reliably merge them. Same-
    family duplicates measure ≲0.065 apart in OKLab while genuinely distinct
    colors (pink vs lavender, light vs dark of one hue) measure ≳0.09.
    """
    while len(centers) > 2:
        assignment = ((lab[:, None, :] - centers[None]) ** 2).sum(-1).argmin(1)
        cluster_weights = np.array([
            weights[assignment == j].sum() for j in range(len(centers))
        ])
        distances = np.sqrt(((centers[:, None, :] - centers[None]) ** 2).sum(-1))
        np.fill_diagonal(distances, np.inf)
        for a in range(len(centers)):
            for b in range(a + 1, len(centers)):
                if distances[a, b] < OKLAB_CLUSTER_MERGE_DISTANCE and not _mergeable_pair(
                    centers[a], centers[b]
                ):
                    distances[a, b] = distances[b, a] = np.inf
        a, b = np.unravel_index(np.argmin(distances), distances.shape)
        if distances[a, b] >= OKLAB_CLUSTER_MERGE_DISTANCE:
            return centers
        total = cluster_weights[a] + cluster_weights[b]
        if total > 0:
            merged = (
                centers[a] * cluster_weights[a] + centers[b] * cluster_weights[b]
            ) / total
        else:
            merged = (centers[a] + centers[b]) / 2
        centers = np.delete(centers, max(a, b), axis=0)
        centers[min(a, b)] = merged
    return centers


def _adjacent_to(mask: np.ndarray) -> np.ndarray:
    touches = np.zeros_like(mask)
    touches[1:, :] |= mask[:-1, :]
    touches[:-1, :] |= mask[1:, :]
    touches[:, 1:] |= mask[:, :-1]
    touches[:, :-1] |= mask[:, 1:]
    return touches


def _drop_blend_clusters(
    centers: np.ndarray,
    lab: np.ndarray,
    weights: np.ndarray,
    inverse: np.ndarray,
    shape: tuple[int, int],
) -> np.ndarray:
    """Remove clusters that are anti-aliased blends of two larger clusters.

    Edge pixels between a subject and the canvas form their own OKLab cluster
    (e.g. a gray fringe between dark green and white). A blend cluster is
    identified by two properties a genuine color region never has together:
    its center lies on the straight OKLab segment between two parent
    clusters, AND most of its pixels sit spatially sandwiched between those
    parents (touching both). Lighter tints of a real color share the first
    property but fail the second, so motif fills survive.
    """
    while len(centers) > 2:
        assignment = ((lab[:, None, :] - centers[None]) ** 2).sum(-1).argmin(1)
        cluster_weights = np.array([
            weights[assignment == j].sum() for j in range(len(centers))
        ])
        pixel_assignment = assignment[inverse].reshape(shape)

        blend_index = None
        for c in np.argsort(cluster_weights):
            mask_c = pixel_assignment == c
            c_total = mask_c.sum()
            if c_total == 0:
                blend_index = int(c)
                break

            on_segment = False
            for a in range(len(centers)):
                if a == c:
                    continue
                for b in range(a + 1, len(centers)):
                    if b == c:
                        continue
                    if cluster_weights[c] > BLEND_CLUSTER_MAX_WEIGHT_RATIO * min(
                        cluster_weights[a], cluster_weights[b]
                    ):
                        continue
                    span = centers[b] - centers[a]
                    span_len = np.linalg.norm(span)
                    if span_len < BLEND_CLUSTER_MIN_SPAN:
                        continue
                    offset = centers[c] - centers[a]
                    t = float(offset @ span) / float(span @ span)
                    if not 0.1 <= t <= 0.9:
                        continue
                    perp = np.linalg.norm(offset - t * span)
                    if perp <= BLEND_CLUSTER_MAX_PERP_RATIO * span_len:
                        on_segment = True
                        break
                if on_segment:
                    break

            if not on_segment:
                continue

            # Spatial confirmation: a fringe is thin, so most of its pixels
            # touch at least two different foreign clusters (one per side).
            # The parents may be split across several near-identical clusters,
            # so count distinct foreign contacts rather than a specific pair.
            foreign_contacts = np.zeros(shape, dtype=np.int64)
            for j in range(len(centers)):
                if j != c:
                    foreign_contacts += _adjacent_to(pixel_assignment == j)
            sandwiched = (mask_c & (foreign_contacts >= 2)).sum()
            if sandwiched / c_total >= BLEND_CLUSTER_MIN_CONTACT_FRACTION:
                blend_index = int(c)
                break

        if blend_index is None:
            return centers
        centers = np.delete(centers, blend_index, axis=0)
    return centers


# Set per request when the serving-time numeric probe fails, so a transient
# corruption episode only downgrades the requests it actually touches.
_FORCE_FALLBACK: ContextVar[bool] = ContextVar("stitch_force_fallback", default=False)


def resize_linear_light(
    img: Image.Image, size: tuple[int, int], resampling: Image.Resampling
) -> Image.Image:
    """Resize in linear-light RGB instead of gamma-encoded sRGB.

    Averaging gamma-encoded values darkens blends, so a white stitch averaged
    with dark gaps comes out muddier than it should. Downsampling in linear
    light keeps light details (e.g. white lettering on a dark field)
    measurably brighter and closer to their true color.
    """
    # globals().get: the numeric self-check probes this function before the
    # flag exists; a broken numpy install gets gamma-space resize instead.
    if not globals().get("_NUMPY_ENV_OK", True) or _FORCE_FALLBACK.get():
        return img.convert("RGB").resize(size, resampling)
    arr = np.asarray(img.convert("RGB"), dtype=np.float64) / 255.0
    lin = _srgb_to_linear_array(arr)
    channels = [
        np.asarray(
            Image.fromarray(lin[:, :, c].astype(np.float32), mode="F").resize(size, resampling)
        )
        for c in range(3)
    ]
    lin_small = np.stack(channels, axis=-1)
    srgb = _linear_to_srgb_array(lin_small)
    return Image.fromarray(np.clip(srgb * 255.0, 0, 255).astype(np.uint8), "RGB")


# TEMPORARY diagnostic for the 2026-07 Render resize corruption (see the
# comment above _verify_numeric_environment). Mirrors resize_linear_light
# step by step so /debug/numeric can report where a solid color first goes
# wrong: the sRGB->linear decode, Pillow's own F-mode .resize(), or the
# linear->sRGB re-encode. Remove once the corruption is diagnosed and fixed.
def debug_resize_linear_light_steps(
    rgb: tuple[int, int, int], size: tuple[int, int], resampling: Image.Resampling
) -> dict:
    img = Image.new("RGB", (200, 200), rgb)
    converted = img.convert("RGB")
    raw_pixel_at_center = converted.getpixel((15, 15))
    arr = np.asarray(converted, dtype=np.float64) / 255.0
    arr_at_center = arr[15, 15, :].tolist()
    lin = _srgb_to_linear_array(arr)
    lin_at_center = lin[15, 15, :].tolist()

    resized_channels = [
        Image.fromarray(lin[:, :, c].astype(np.float32), mode="F").resize(size, resampling)
        for c in range(3)
    ]
    py, px = size[1] // 2, size[0] // 2
    lin_after_resize = [chan.getpixel((px, py)) for chan in resized_channels]

    lin_small = np.stack([np.asarray(chan) for chan in resized_channels], axis=-1)
    srgb = _linear_to_srgb_array(lin_small)
    srgb_at_center = srgb[py, px, :].tolist()
    final = np.clip(srgb * 255.0, 0, 255).astype(np.uint8)[py, px, :].tolist()

    return {
        "input_rgb": list(rgb),
        "raw_pixel_at_center": list(raw_pixel_at_center),
        "arr_at_center": arr_at_center,
        "lin_before_resize": lin_at_center,
        "lin_after_resize": lin_after_resize,
        "srgb_after_reencode": srgb_at_center,
        "final_uint8": final,
    }


# Render's production host sets NPY_DISABLE_CPU_FEATURES (dashboard env var,
# not read directly by this code — numpy applies it at import time). Value:
# "SSSE3 SSE41 POPCNT SSE42 AVX F16C FMA3 AVX2" — every SIMD tier numpy
# dispatches to above the universal SSE/SSE2/SSE3 baseline on this build.
# Confirmed 2026-07-13 via /debug/numeric: resize_linear_light corrupted a
# solid color at realistic sizes (200x200 -> 30x30) but not at the tiny size
# the startup probe used (8x8 -> 4x4), and the corruption was identical
# across a RAM upgrade and multiple redeploys/restarts — ruling out memory
# pressure or "unlucky host" as the cause. That points at numpy's runtime
# CPU feature dispatch selecting a SIMD code path this virtualized CPU
# reports support for but doesn't correctly implement. Forcing numpy onto
# its baseline dispatch path is the fix; if this env var is ever removed or
# its feature list falls out of date with numpy's actual dispatch set,
# expect the corruption (and the fallback below) to come back.
def _verify_numeric_environment() -> bool:
    """Detect a numpy/Pillow install that computes wrong colors.

    A production build once shipped with a numpy install whose ufunc results
    were wrong: every photo import quantized to a single near-black color
    (the linear-light round trip came back gamma-decoded instead of
    re-encoded). The scalar Python paths were unaffected, so the service
    stayed "healthy" while silently ruining every pattern. When this check
    fails, the photo pipeline drops to numpy-free fallbacks (gamma-space
    resize + MEDIANCUT quantization): slightly muddier previews, but correct
    colors, and the service stays up.
    """
    probe_rgb = (200, 30, 40)
    try:
        probe = Image.new("RGB", (8, 8), probe_rgb)
        resized = resize_linear_light(probe, (4, 4), Image.Resampling.BILINEAR)
        if any(abs(got - want) > 2 for got, want in zip(resized.getpixel((1, 1)), probe_rgb)):
            raise RuntimeError(f"resize_linear_light corrupted a solid color: {resized.getpixel((1, 1))} != {probe_rgb}")
        roundtrip = _oklab_to_srgb_array(_srgb_to_oklab_array(np.array([list(probe_rgb)], dtype=np.float64)))
        if np.abs(roundtrip - np.array(probe_rgb)).max() > 2:
            raise RuntimeError(f"OKLab round trip corrupted a color: {roundtrip.tolist()} != {probe_rgb}")
    except Exception:
        import logging
        logging.getLogger(__name__).critical(
            "NUMERIC ENVIRONMENT BROKEN — numpy/Pillow compute wrong colors; "
            "falling back to gamma-space resize and MEDIANCUT quantization. "
            "Rebuild the environment (clear the build cache) to restore the OKLab pipeline.",
            exc_info=True,
        )
        return False
    return True


_NUMPY_ENV_OK = _verify_numeric_environment()


def quantize_image_perceptual(img: Image.Image, colors: int, dither: Image.Dither) -> Image.Image:
    """Reduce an image to `colors` colors via weighted k-means in OKLab space.

    Replaces PIL's MEDIANCUT for the main quantization pass: median cut splits
    boxes purely by pixel population, so small accent regions (a dozen yellow
    stitches in a lavender field) never earn a palette entry at any budget.
    Seeding is deterministic so the same upload always previews identically.
    """
    rgb_img = img.convert("RGB")
    if not _NUMPY_ENV_OK or _FORCE_FALLBACK.get():
        return rgb_img.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=dither).convert("RGB")
    pixels = np.asarray(rgb_img, dtype=np.float64).reshape(-1, 3)
    unique_colors, inverse, counts = np.unique(
        pixels, axis=0, return_inverse=True, return_counts=True
    )
    if len(unique_colors) <= colors:
        return rgb_img

    lab = _srgb_to_oklab_array(unique_colors)
    weights = counts.astype(np.float64)

    # Weighted k-means++ seeding, deterministically anchored on the most
    # common color so identical inputs always produce identical palettes.
    rng = np.random.default_rng(0)
    centers = lab[[int(np.argmax(weights))]]
    for _ in range(colors - 1):
        d2 = ((lab[:, None, :] - centers[None]) ** 2).sum(-1).min(1)
        probs = d2 * weights
        total = probs.sum()
        if total <= 0:
            break
        centers = np.vstack([centers, lab[int(rng.choice(len(lab), p=probs / total))]])

    for _ in range(24):
        assignment = ((lab[:, None, :] - centers[None]) ** 2).sum(-1).argmin(1)
        updated = centers.copy()
        for j in range(len(centers)):
            member_mask = assignment == j
            if member_mask.any():
                w = weights[member_mask]
                updated[j] = (lab[member_mask] * w[:, None]).sum(0) / w.sum()
        if np.allclose(updated, centers, atol=1e-7):
            centers = updated
            break
        centers = updated

    centers = _merge_close_clusters(centers, lab, weights)
    centers = _drop_blend_clusters(
        centers, lab, weights, inverse, (rgb_img.height, rgb_img.width)
    )
    palette = np.rint(_oklab_to_srgb_array(centers)).astype(np.uint8)

    if dither != Image.Dither.NONE:
        palette_img = Image.new("P", (1, 1))
        flat = palette.reshape(-1).tolist()
        palette_img.putpalette(flat + [0] * (768 - len(flat)))
        return rgb_img.quantize(palette=palette_img, dither=dither).convert("RGB")

    assignment = ((lab[:, None, :] - centers[None]) ** 2).sum(-1).argmin(1)
    mapped = palette[assignment][inverse].reshape(rgb_img.height, rgb_img.width, 3)
    return Image.fromarray(mapped, "RGB")


def brightness(rgb: tuple[int, int, int]) -> int:
    return rgb[0] + rgb[1] + rgb[2]


def saturation(rgb: tuple[int, int, int]) -> int:
    return max(rgb) - min(rgb)


def is_stitched_light_neutral_candidate(rgb: tuple[int, int, int]) -> bool:
    pixel_brightness = brightness(rgb)
    pixel_saturation = saturation(rgb)

    if pixel_brightness < 430 or pixel_brightness > 710:
        return False

    if pixel_saturation > 42:
        return False

    average = sum(rgb) / 3
    red_bias = rgb[0] - average
    blue_bias = rgb[2] - average

    return red_bias >= -4 and blue_bias <= 8


def is_stitched_canvas_background_candidate(rgb: tuple[int, int, int]) -> bool:
    pixel_brightness = brightness(rgb)
    pixel_saturation = saturation(rgb)

    if pixel_brightness < STITCHED_CANVAS_BACKGROUND_BRIGHTNESS:
        return False

    if pixel_saturation > STITCHED_CANVAS_BACKGROUND_SATURATION:
        return False

    average = sum(rgb) / 3
    red_bias = rgb[0] - average
    green_bias = rgb[1] - average
    blue_bias = rgb[2] - average

    return red_bias >= -10 and green_bias >= -12 and blue_bias <= 20


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


def enhance_graphic_art_features(img: Image.Image, clean_background: bool) -> Image.Image:
    edge_map = img.convert("L").filter(ImageFilter.FIND_EDGES)
    source_pixels = list(img.getdata())
    edge_pixels = list(edge_map.getdata())
    enhanced_pixels = []

    for pixel, edge_strength in zip(source_pixels, edge_pixels):
        pixel_brightness = brightness(pixel)
        pixel_saturation = saturation(pixel)

        if (
            clean_background
            and edge_strength < GRAPHIC_ART_EDGE_THRESHOLD
            and pixel_brightness >= GRAPHIC_ART_BACKGROUND_BRIGHTNESS
            and is_neutral_background_candidate(pixel, GRAPHIC_ART_BACKGROUND_SATURATION)
        ):
            enhanced_pixels.append((255, 255, 255))
            continue

        if edge_strength < GRAPHIC_ART_EDGE_THRESHOLD:
            enhanced_pixels.append(pixel)
            continue

        if pixel_brightness <= GRAPHIC_ART_DARK_BRIGHTNESS:
            factor = max(0.0, 1.0 - GRAPHIC_ART_DARKEN_STRENGTH * (edge_strength / 255))
            enhanced_pixels.append(
                tuple(max(0, min(255, round(channel * factor))) for channel in pixel)
            )
            continue

        if (
            pixel_brightness >= GRAPHIC_ART_LIGHT_BRIGHTNESS
            and pixel_saturation <= GRAPHIC_ART_LIGHT_SATURATION
        ):
            blend = GRAPHIC_ART_LIGHTEN_STRENGTH * (edge_strength / 255)
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


def boost_graphic_art_saturation(img: Image.Image) -> Image.Image:
    return ImageEnhance.Color(img).enhance(GRAPHIC_ART_RESIZE_SATURATION_BOOST)


def preserve_text_strokes(img: Image.Image, source_type: str) -> Image.Image:
    width, height = img.size
    if width == 0 or height == 0:
        return img

    if source_type == "graphic_art":
        edge_threshold = GRAPHIC_ART_STROKE_EDGE_THRESHOLD
        foreground_brightness = GRAPHIC_ART_STROKE_FOREGROUND_BRIGHTNESS
        foreground_saturation = GRAPHIC_ART_STROKE_FOREGROUND_SATURATION
        support_threshold = GRAPHIC_ART_STROKE_SUPPORT_THRESHOLD
        bridge_blend = GRAPHIC_ART_STROKE_BRIDGE_BLEND
        reinforce_blend = GRAPHIC_ART_STROKE_REINFORCE_BLEND
    else:
        edge_threshold = STITCHED_STROKE_EDGE_THRESHOLD
        foreground_brightness = STITCHED_STROKE_FOREGROUND_BRIGHTNESS
        foreground_saturation = STITCHED_STROKE_FOREGROUND_SATURATION
        support_threshold = STITCHED_STROKE_SUPPORT_THRESHOLD
        bridge_blend = STITCHED_STROKE_BRIDGE_BLEND
        reinforce_blend = STITCHED_STROKE_REINFORCE_BLEND

    edge_map = img.convert("L").filter(ImageFilter.FIND_EDGES)
    edge_pixels = list(edge_map.getdata())
    source_pixels = list(img.getdata())
    enhanced_pixels = source_pixels.copy()

    def is_foreground_candidate(pixel: tuple[int, int, int]) -> bool:
        pixel_brightness = brightness(pixel)
        pixel_saturation = saturation(pixel)
        return (
            pixel_brightness <= foreground_brightness
            or (pixel_saturation >= foreground_saturation and pixel_brightness <= foreground_brightness + 60)
        )

    for y in range(height):
        for x in range(width):
            idx = y * width + x
            current = source_pixels[idx]
            current_edge = edge_pixels[idx]
            if current_edge < edge_threshold:
                continue

            foreground_neighbors: list[tuple[int, int, int]] = []
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    nx = x + dx
                    ny = y + dy
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    neighbor = source_pixels[ny * width + nx]
                    if edge_pixels[ny * width + nx] < edge_threshold * 0.6:
                        continue
                    if is_foreground_candidate(neighbor):
                        foreground_neighbors.append(neighbor)

            if len(foreground_neighbors) < support_threshold:
                continue

            average_neighbor = tuple(
                round(sum(pixel[channel] for pixel in foreground_neighbors) / len(foreground_neighbors))
                for channel in range(3)
            )
            blend = reinforce_blend if is_foreground_candidate(current) else bridge_blend
            enhanced_pixels[idx] = tuple(
                max(
                    0,
                    min(
                        255,
                        round(channel + (neighbor_channel - channel) * blend),
                    ),
                )
                for channel, neighbor_channel in zip(current, average_neighbor)
            )

    enhanced = Image.new("RGB", img.size)
    enhanced.putdata(enhanced_pixels)
    return enhanced


def simplify_source_colors(img: Image.Image, source_type: str) -> Image.Image:
    proxy_colors = 36 if source_type == "graphic_art" else 48 if source_type == "stitched_photo" else 64
    blend_strength = (
        SIMPLIFY_BLEND_GRAPHIC
        if source_type == "graphic_art"
        else SIMPLIFY_BLEND_STITCHED
        if source_type == "stitched_photo"
        else SIMPLIFY_BLEND_PHOTO
    )
    proxy = img.quantize(
        colors=proxy_colors,
        method=Image.MEDIANCUT,
        dither=Image.Dither.NONE,
    ).convert("RGB")
    simplified = Image.blend(img, proxy, blend_strength)
    return simplified.filter(ImageFilter.MedianFilter(size=3))


def strengthen_dark_detail(img: Image.Image) -> Image.Image:
    edge_map = img.convert("L").filter(ImageFilter.FIND_EDGES)
    source_pixels = list(img.getdata())
    edge_pixels = list(edge_map.getdata())
    enhanced_pixels = []

    for pixel, edge_strength in zip(source_pixels, edge_pixels):
        if edge_strength < DARK_DETAIL_EDGE_THRESHOLD or brightness(pixel) > DARK_DETAIL_BRIGHTNESS_LIMIT:
            enhanced_pixels.append(pixel)
            continue

        factor = max(0.0, 1.0 - DARK_DETAIL_DARKEN_STRENGTH * (edge_strength / 255))
        enhanced_pixels.append(
            tuple(max(0, min(255, round(channel * factor))) for channel in pixel)
        )

    enhanced = Image.new("RGB", img.size)
    enhanced.putdata(enhanced_pixels)
    return enhanced


def enhance_stitched_text_features(img: Image.Image) -> Image.Image:
    edge_map = img.convert("L").filter(ImageFilter.FIND_EDGES)
    source_pixels = list(img.getdata())
    edge_pixels = list(edge_map.getdata())
    enhanced_pixels = []

    for pixel, edge_strength in zip(source_pixels, edge_pixels):
        if edge_strength < STITCHED_TEXT_EDGE_THRESHOLD:
            enhanced_pixels.append(pixel)
            continue

        pixel_brightness = brightness(pixel)
        pixel_saturation = saturation(pixel)

        if pixel_brightness <= STITCHED_TEXT_DARK_NEUTRAL_BRIGHTNESS:
            darken_factor = max(0.0, 1.0 - (STITCHED_TEXT_DARKEN_STRENGTH + 0.08) * (edge_strength / 255))
            enhanced_pixels.append(
                tuple(max(0, min(255, round(channel * darken_factor))) for channel in pixel)
            )
            continue

        if (
            pixel_brightness >= STITCHED_TEXT_LIGHT_NEUTRAL_BRIGHTNESS
            and pixel_saturation <= STITCHED_TEXT_LIGHT_NEUTRAL_SATURATION
        ):
            blend = 0.16 * (edge_strength / 255)
            enhanced_pixels.append(
                tuple(
                    max(0, min(255, round(channel + (255 - channel) * blend)))
                    for channel in pixel
                )
            )
            continue

        if (
            pixel_brightness > STITCHED_TEXT_MAX_BRIGHTNESS
            or pixel_saturation < STITCHED_TEXT_MIN_SATURATION
        ):
            enhanced_pixels.append(pixel)
            continue

        darken_factor = max(0.0, 1.0 - STITCHED_TEXT_DARKEN_STRENGTH * (edge_strength / 255))
        darkened = [
            max(0, min(255, round(channel * darken_factor)))
            for channel in pixel
        ]
        average = sum(darkened) / 3
        boosted = tuple(
            max(0, min(255, round(channel + (channel - average) * STITCHED_TEXT_SATURATION_BOOST)))
            for channel in darkened
        )
        enhanced_pixels.append(boosted)

    enhanced = Image.new("RGB", img.size)
    enhanced.putdata(enhanced_pixels)
    return enhanced


def reduce_stitched_canvas_noise(img: Image.Image) -> Image.Image:
    source_pixels = list(img.getdata())
    edge_map = img.convert("L").filter(ImageFilter.FIND_EDGES)
    edge_pixels = list(edge_map.getdata())
    cleaned_pixels = []

    for pixel, edge_strength in zip(source_pixels, edge_pixels):
        pixel_brightness = brightness(pixel)

        if edge_strength >= STITCHED_BACKGROUND_EDGE_PROTECT_THRESHOLD:
            cleaned_pixels.append(pixel)
            continue

        if pixel_brightness >= WHITE_BACKGROUND_BRIGHTNESS and is_neutral_background_candidate(
            pixel, WHITE_BACKGROUND_SATURATION
        ):
            cleaned_pixels.append((255, 255, 255))
            continue

        if is_stitched_canvas_background_candidate(pixel):
            cleaned_pixels.append((255, 255, 255))
            continue

        if pixel_brightness >= STITCHED_SOFT_BACKGROUND_BRIGHTNESS and is_neutral_background_candidate(
            pixel, STITCHED_SOFT_BACKGROUND_SATURATION
        ):
            cleaned_pixels.append((248, 248, 248))
            continue

        cleaned_pixels.append(pixel)

    cleaned = Image.new("RGB", img.size)
    cleaned.putdata(cleaned_pixels)
    return cleaned


def enhance_stitched_subject_features(img: Image.Image) -> Image.Image:
    edge_map = img.convert("L").filter(ImageFilter.FIND_EDGES)
    source_pixels = list(img.getdata())
    edge_pixels = list(edge_map.getdata())
    enhanced_pixels = []

    for pixel, edge_strength in zip(source_pixels, edge_pixels):
        if edge_strength < STITCHED_DETAIL_EDGE_THRESHOLD:
            enhanced_pixels.append(pixel)
            continue

        pixel_brightness = brightness(pixel)
        pixel_saturation = saturation(pixel)

        if pixel_brightness <= STITCHED_DETAIL_DARK_BRIGHTNESS:
            factor = max(0.0, 1.0 - STITCHED_DETAIL_DARKEN_STRENGTH * (edge_strength / 255))
            enhanced_pixels.append(
                tuple(max(0, min(255, round(channel * factor))) for channel in pixel)
            )
            continue

        if (
            pixel_brightness >= STITCHED_DETAIL_LIGHT_BRIGHTNESS
            and pixel_saturation <= STITCHED_DETAIL_NEUTRAL_SATURATION
        ):
            blend = STITCHED_DETAIL_LIGHTEN_STRENGTH * (edge_strength / 255)
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


_DMC_OKLAB = [(dmc, srgb_to_oklab(tuple(dmc["rgb"]))) for dmc in DMC_COLORS]
_NEAREST_DMC_CACHE: dict[tuple[int, int, int], dict] = {}

# OKLab compresses hue separation at low lightness, so plain OKLab distance
# snaps very dark greens to black-brown threads. Weighting the hue component
# of the distance restores the family (ΔE² = ΔL² + ΔC² + K·ΔH²).
DMC_SNAP_HUE_WEIGHT = 3.0


def _dmc_snap_distance(
    l: float, a: float, b: float, chroma: float, dmc_lab: tuple[float, float, float]
) -> float:
    l2, a2, b2 = dmc_lab
    chroma2 = (a2 * a2 + b2 * b2) ** 0.5
    dab2 = (a - a2) ** 2 + (b - b2) ** 2
    dc2 = (chroma - chroma2) ** 2
    dh2 = max(0.0, dab2 - dc2)
    return (l - l2) ** 2 + dc2 + DMC_SNAP_HUE_WEIGHT * dh2


def nearest_dmc(rgb: tuple[int, int, int]) -> dict:
    rgb = tuple(rgb)
    if rgb not in _NEAREST_DMC_CACHE:
        l, a, b = srgb_to_oklab(rgb)
        chroma = (a * a + b * b) ** 0.5
        _NEAREST_DMC_CACHE[rgb] = min(
            _DMC_OKLAB,
            key=lambda entry: _dmc_snap_distance(l, a, b, chroma, entry[1]),
        )[0]
    return _NEAREST_DMC_CACHE[rgb]


def remap_image_to_nearest_dmc(img: Image.Image) -> Image.Image:
    replacement_cache: dict[tuple[int, int, int], tuple[int, int, int]] = {}
    remapped_pixels = []

    for pixel in img.getdata():
        if pixel not in replacement_cache:
            replacement_cache[pixel] = nearest_dmc(pixel)["rgb"]
        remapped_pixels.append(replacement_cache[pixel])

    remapped = Image.new("RGB", img.size)
    remapped.putdata(remapped_pixels)
    return remapped


def is_blank_canvas_candidate(rgb: tuple[int, int, int]) -> bool:
    return brightness(rgb) >= 735 and saturation(rgb) <= 20


def edge_connected_blank_mask(img: Image.Image) -> set[tuple[int, int]]:
    width, height = img.size
    if not width or not height:
        return set()

    pixels = list(img.getdata())
    visited: set[tuple[int, int]] = set()
    blank_cells: set[tuple[int, int]] = set()
    stack: list[tuple[int, int]] = []

    for x in range(width):
        stack.append((x, 0))
        stack.append((x, height - 1))
    for y in range(height):
        stack.append((0, y))
        stack.append((width - 1, y))

    while stack:
        x, y = stack.pop()
        if (x, y) in visited:
            continue
        visited.add((x, y))
        if not is_blank_canvas_candidate(pixels[y * width + x]):
            continue

        blank_cells.add((x, y))
        if x > 0:
            stack.append((x - 1, y))
        if x < width - 1:
            stack.append((x + 1, y))
        if y > 0:
            stack.append((x, y - 1))
        if y < height - 1:
            stack.append((x, y + 1))

    return blank_cells


def compute_content_bounds(
    cells: list[list[str]],
    width_inches: float,
    height_inches: float,
) -> dict | None:
    """Return the tight bounding box of non-blank cells in inches, or None if no blanks exist."""
    if not cells or not cells[0]:
        return None

    grid_h = len(cells)
    grid_w = len(cells[0])
    min_row, max_row = grid_h, -1
    min_col, max_col = grid_w, -1
    has_blank = False

    for r, row in enumerate(cells):
        for c, cell in enumerate(row):
            if cell == BLANK_CELL:
                has_blank = True
            else:
                if r < min_row:
                    min_row = r
                if r > max_row:
                    max_row = r
                if c < min_col:
                    min_col = c
                if c > max_col:
                    max_col = c

    if not has_blank or max_row == -1:
        return None

    content_w = round((max_col - min_col + 1) / grid_w * width_inches, 2)
    content_h = round((max_row - min_row + 1) / grid_h * height_inches, 2)
    return {"width_inches": content_w, "height_inches": content_h}


def apply_blank_mask_to_cells(
    cells: list[list[str]],
    blank_mask: set[tuple[int, int]],
) -> list[list[str]]:
    if not blank_mask:
        return cells

    return [
        [
            BLANK_CELL if (x, y) in blank_mask else cell
            for x, cell in enumerate(row)
        ]
        for y, row in enumerate(cells)
    ]


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


def enhance_small_structured_regions(img: Image.Image, source_type: str) -> Image.Image:
    proxy = img.quantize(colors=SMALL_REGION_PROXY_COLORS, method=Image.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    region_metrics = compute_region_metrics(proxy)
    color_counts = {
        color: count
        for count, color in (proxy.getcolors(maxcolors=256000) or [])
    }
    qualifying_colors: set[tuple[int, int, int]] = set()

    for color, count in color_counts.items():
        metrics = region_metrics.get(
            color,
            {
                "largest_component_ratio": 0.0,
                "boundary_ratio": 0.0,
            },
        )
        if count < SMALL_REGION_MIN_PIXELS or count > SMALL_REGION_MAX_PIXELS:
            continue
        if metrics["largest_component_ratio"] < SMALL_REGION_MIN_COMPONENT_RATIO:
            continue
        if metrics["boundary_ratio"] < SMALL_REGION_MIN_BOUNDARY_RATIO:
            continue
        if source_type == "stitched_photo" and is_stitched_light_neutral_candidate(color):
            continue
        qualifying_colors.add(color)

    if not qualifying_colors:
        return img

    edge_map = img.convert("L").filter(ImageFilter.FIND_EDGES)
    source_pixels = list(img.getdata())
    proxy_pixels = list(proxy.getdata())
    edge_pixels = list(edge_map.getdata())
    enhanced_pixels = []

    for pixel, proxy_pixel, edge_strength in zip(source_pixels, proxy_pixels, edge_pixels):
        if proxy_pixel not in qualifying_colors:
            enhanced_pixels.append(pixel)
            continue

        blend_strength = SMALL_REGION_BLEND_STRENGTH + (
            SMALL_REGION_EDGE_BLEND_BONUS * (edge_strength / 255)
        )
        enhanced_pixels.append(
            tuple(
                max(
                    0,
                    min(
                        255,
                        round(channel + (proxy_channel - channel) * blend_strength),
                    ),
                )
                for channel, proxy_channel in zip(pixel, proxy_pixel)
            )
        )

    enhanced = Image.new("RGB", img.size)
    enhanced.putdata(enhanced_pixels)
    return enhanced


STITCHED_DARK_FIELD_LUMINANCE = 60
STITCHED_DARK_FIELD_FRACTION = 0.15


def _has_dark_field(img: Image.Image) -> bool:
    lum = np.asarray(img.convert("L"), dtype=np.float64)
    return float((lum < STITCHED_DARK_FIELD_LUMINANCE).mean()) > STITCHED_DARK_FIELD_FRACTION


def prepare_source_image(
    img: Image.Image,
    source_type: str,
    clean_background: bool = False,
    simplify_colors: bool = False,
    strengthen_dark_detail_enabled: bool = False,
) -> Image.Image:
    if source_type == "photo":
        base = simplify_source_colors(img, source_type) if simplify_colors else img
        if not clean_background:
            return strengthen_dark_detail(base) if strengthen_dark_detail_enabled else base

        background_ratio = estimate_neutral_background_ratio(
            base,
            PHOTO_SOFT_BACKGROUND_BRIGHTNESS,
            PHOTO_SOFT_BACKGROUND_SATURATION,
        )
        if background_ratio < ISOLATED_SUBJECT_BACKGROUND_RATIO:
            return strengthen_dark_detail(base) if strengthen_dark_detail_enabled else base

        source_pixels = list(base.getdata())
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
        cleaned = cleaned.filter(ImageFilter.UnsharpMask(radius=1.0, percent=115, threshold=2))
        if strengthen_dark_detail_enabled:
            cleaned = strengthen_dark_detail(cleaned)
        return enhance_small_structured_regions(cleaned, source_type)

    if source_type == "graphic_art":
        cleaned = simplify_source_colors(img, source_type) if simplify_colors else img
        if clean_background:
            cleaned = enhance_graphic_art_features(cleaned, True)
        cleaned = cleaned.filter(ImageFilter.UnsharpMask(radius=1.1, percent=145, threshold=2))
        if strengthen_dark_detail_enabled:
            cleaned = strengthen_dark_detail(cleaned)
        cleaned = preserve_text_strokes(cleaned, source_type)
        cleaned = enhance_small_structured_regions(cleaned, source_type)
        return enhance_graphic_art_features(cleaned, clean_background)

    if source_type != "stitched_photo":
        return strengthen_dark_detail(img) if strengthen_dark_detail_enabled else img

    cleaned = simplify_source_colors(img, source_type) if simplify_colors else img
    cleaned = reduce_stitched_canvas_noise(cleaned) if clean_background else cleaned
    # No median filter: it erases 1-2 stitch accents and thin strokes, and
    # canvas noise is already handled by reduce_stitched_canvas_noise.
    # Unsharp only helps low-contrast content; on designs that are already
    # high-contrast (light text on a dark field) it amplifies field texture
    # into spurious near-black palette colors.
    if not _has_dark_field(cleaned):
        cleaned = cleaned.filter(ImageFilter.UnsharpMask(radius=1.35, percent=170, threshold=2))
    if strengthen_dark_detail_enabled:
        cleaned = strengthen_dark_detail(cleaned)
    cleaned = preserve_text_strokes(cleaned, source_type)
    cleaned = enhance_small_structured_regions(cleaned, source_type)
    cleaned = enhance_stitched_subject_features(cleaned)
    return enhance_stitched_text_features(cleaned)


def normalize_background_after_quantization(
    img: Image.Image,
    source_type: str,
    clean_background: bool = False,
) -> Image.Image:
    if source_type == "photo":
        if not clean_background:
            return img

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

    if source_type == "graphic_art":
        if not clean_background:
            return img

        pixels = list(img.getdata())
        normalized_pixels = []

        for pixel in pixels:
            if (
                brightness(pixel) >= GRAPHIC_ART_BACKGROUND_BRIGHTNESS
                and is_neutral_background_candidate(pixel, GRAPHIC_ART_BACKGROUND_SATURATION)
            ):
                normalized_pixels.append((255, 255, 255))
                continue

            normalized_pixels.append(pixel)

        normalized = Image.new("RGB", img.size)
        normalized.putdata(normalized_pixels)
        return normalized

    if source_type != "stitched_photo":
        return img

    if not clean_background:
        return img

    pixels = list(img.getdata())
    normalized_pixels = []

    for pixel in pixels:
        if is_stitched_canvas_background_candidate(pixel):
            normalized_pixels.append((255, 255, 255))
            continue

        normalized_pixels.append(pixel)

    normalized = Image.new("RGB", img.size)
    normalized.putdata(normalized_pixels)
    return normalized


def compute_region_metrics(img: Image.Image) -> dict[tuple[int, int, int], dict[str, float]]:
    width, height = img.size
    pixels = list(img.getdata())
    visited: set[tuple[int, int]] = set()
    component_counts: dict[tuple[int, int, int], int] = {}
    largest_component_sizes: dict[tuple[int, int, int], int] = {}
    boundary_contacts: dict[tuple[int, int, int], int] = {}
    color_counts: dict[tuple[int, int, int], int] = {}

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
            color = pixels[y * width + x]
            color_counts[color] = color_counts.get(color, 0) + 1

            boundary_count = 0
            for nx, ny in neighbors(x, y):
                if pixels[ny * width + nx] != color:
                    boundary_count += 1
            boundary_contacts[color] = boundary_contacts.get(color, 0) + boundary_count

            if (x, y) in visited:
                continue

            stack = [(x, y)]
            component_size = 0
            while stack:
                cx, cy = stack.pop()
                if (cx, cy) in visited:
                    continue
                if pixels[cy * width + cx] != color:
                    continue

                visited.add((cx, cy))
                component_size += 1

                for nx, ny in neighbors(cx, cy):
                    if (nx, ny) not in visited and pixels[ny * width + nx] == color:
                        stack.append((nx, ny))

            component_counts[color] = component_counts.get(color, 0) + 1
            largest_component_sizes[color] = max(
                largest_component_sizes.get(color, 0),
                component_size,
            )

    region_metrics: dict[tuple[int, int, int], dict[str, float]] = {}
    for color, count in color_counts.items():
        largest_component = largest_component_sizes.get(color, 0)
        region_metrics[color] = {
            "component_count": float(component_counts.get(color, 0)),
            "largest_component_ratio": (largest_component / count) if count else 0.0,
            "boundary_ratio": (boundary_contacts.get(color, 0) / max(1, count)),
            "fragmentation_ratio": (
                component_counts.get(color, 0) / count
                if count
                else 0.0
            ),
        }

    return region_metrics


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
    preserve_accents: bool = False,
) -> list[tuple[int, int, int]]:
    colors = img.getcolors(maxcolors=256000) or []
    if not colors:
        return []

    sorted_colors = sorted(colors, key=lambda item: item[0], reverse=True)
    color_metrics: dict[tuple[int, int, int], dict[str, float]] = {}
    region_metrics = compute_region_metrics(img)

    if source_image is not None and source_type in {"photo", "graphic_art"}:
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
            region = region_metrics.get(
                rgb,
                {
                    "component_count": 0.0,
                    "largest_component_ratio": 0.0,
                    "boundary_ratio": 0.0,
                    "fragmentation_ratio": 0.0,
                },
            )
            color_metrics[rgb] = {
                "average_edge": average_edge,
                "darkness": darkness,
                "component_count": region["component_count"],
                "largest_component_ratio": region["largest_component_ratio"],
                "boundary_ratio": region["boundary_ratio"],
                "fragmentation_ratio": region["fragmentation_ratio"],
            }
    else:
        for _, rgb in sorted_colors:
            region = region_metrics.get(
                rgb,
                {
                    "component_count": 0.0,
                    "largest_component_ratio": 0.0,
                    "boundary_ratio": 0.0,
                    "fragmentation_ratio": 0.0,
                },
            )
            color_metrics[rgb] = {
                "component_count": region["component_count"],
                "largest_component_ratio": region["largest_component_ratio"],
                "boundary_ratio": region["boundary_ratio"],
                "fragmentation_ratio": region["fragmentation_ratio"],
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
                metrics = color_metrics.get(
                    rgb,
                    {
                        "average_edge": 0.0,
                        "darkness": 0.0,
                        "component_count": 0.0,
                        "largest_component_ratio": 0.0,
                        "boundary_ratio": 0.0,
                        "fragmentation_ratio": 0.0,
                    },
                )
                weak_boundary_penalty = max(0.0, 1.0 - min(1.0, metrics["boundary_ratio"] / 2.5))
                score = (
                    min_distance * PHOTO_DISTINCT_COLOR_DISTANCE_WEIGHT
                    + count
                    + metrics["average_edge"] * PHOTO_EDGE_IMPORTANCE_WEIGHT
                    + metrics["darkness"] * PHOTO_DARK_IMPORTANCE_WEIGHT
                    + metrics["component_count"] * REGION_COMPONENT_WEIGHT
                    + metrics["boundary_ratio"] * REGION_BOUNDARY_RATIO_WEIGHT
                    + metrics["largest_component_ratio"] * REGION_LARGEST_COMPONENT_WEIGHT
                    - metrics["fragmentation_ratio"] * REGION_FRAGMENTATION_PENALTY_WEIGHT
                    - weak_boundary_penalty * REGION_WEAK_BOUNDARY_PENALTY_WEIGHT
                    + (PHOTO_LOW_COUNT_IMPORTANCE_SCALE / max(1, count))
                )
                if preserve_accents and saturation(rgb) >= 36 and count <= 140:
                    score += min_distance * 0.55 + saturation(rgb) * 0.18
            elif source_type == "graphic_art":
                metrics = color_metrics.get(
                    rgb,
                    {
                        "average_edge": 0.0,
                        "darkness": 0.0,
                        "component_count": 0.0,
                        "largest_component_ratio": 0.0,
                        "boundary_ratio": 0.0,
                        "fragmentation_ratio": 0.0,
                    },
                )
                weak_boundary_penalty = max(0.0, 1.0 - min(1.0, metrics["boundary_ratio"] / 2.5))
                minority_component_bonus = 0.0
                if (
                    count <= GRAPHIC_ART_MINORITY_COUNT_THRESHOLD
                    and metrics["largest_component_ratio"] >= 0.34
                    and metrics["boundary_ratio"] >= 1.0
                ):
                    minority_component_bonus = (
                        GRAPHIC_ART_MINORITY_COMPONENT_WEIGHT
                        * metrics["largest_component_ratio"]
                        * (1.0 + min(1.0, metrics["component_count"] / 5.0))
                    )

                saturation_bonus = (
                    GRAPHIC_ART_HIGH_SATURATION_BONUS_WEIGHT
                    * min(1.0, saturation(rgb) / 96)
                    if saturation(rgb) >= 30
                    else 0.0
                )
                neutral_penalty = (
                    GRAPHIC_ART_NEUTRAL_PENALTY_WEIGHT
                    if saturation(rgb) <= 20 and metrics["largest_component_ratio"] < 0.32
                    else 0.0
                )
                score = (
                    min_distance * GRAPHIC_ART_DISTINCT_COLOR_DISTANCE_WEIGHT
                    + min_distance * GRAPHIC_ART_MINORITY_DISTINCT_DISTANCE_WEIGHT / max(1, count)
                    + count * 0.7
                    + metrics["average_edge"] * GRAPHIC_ART_EDGE_IMPORTANCE_WEIGHT
                    + metrics["darkness"] * GRAPHIC_ART_DARK_IMPORTANCE_WEIGHT
                    + metrics["component_count"] * REGION_COMPONENT_WEIGHT
                    + metrics["boundary_ratio"] * REGION_BOUNDARY_RATIO_WEIGHT
                    + metrics["largest_component_ratio"] * (REGION_LARGEST_COMPONENT_WEIGHT + 4)
                    + minority_component_bonus
                    + saturation_bonus
                    - metrics["fragmentation_ratio"] * REGION_FRAGMENTATION_PENALTY_WEIGHT
                    - weak_boundary_penalty * REGION_WEAK_BOUNDARY_PENALTY_WEIGHT
                    - neutral_penalty
                    + (GRAPHIC_ART_LOW_COUNT_IMPORTANCE_SCALE / max(1, count))
                )
                if preserve_accents:
                    score += min_distance * 0.6 + saturation(rgb) * 0.2
            else:
                metrics = color_metrics.get(
                    rgb,
                    {
                        "component_count": 0.0,
                        "largest_component_ratio": 0.0,
                        "boundary_ratio": 0.0,
                        "fragmentation_ratio": 0.0,
                    },
                )
                weak_boundary_penalty = max(0.0, 1.0 - min(1.0, metrics["boundary_ratio"] / 2.5))
                light_neutral_penalty = (
                    STITCHED_LIGHT_NEUTRAL_PENALTY_WEIGHT
                    if is_stitched_light_neutral_candidate(rgb)
                    else 0.0
                )
                minority_component_bonus = 0.0
                if (
                    count <= STITCHED_MINORITY_COUNT_THRESHOLD
                    and metrics["largest_component_ratio"] >= 0.35
                    and metrics["boundary_ratio"] >= 1.2
                ):
                    minority_component_bonus = (
                        STITCHED_MINORITY_COMPONENT_WEIGHT
                        * metrics["largest_component_ratio"]
                        * (1.0 + min(1.0, metrics["component_count"] / 6.0))
                    )

                diffuse_neutral_penalty = 0.0
                if saturation(rgb) <= 34 and metrics["largest_component_ratio"] < 0.3:
                    diffuse_neutral_penalty = STITCHED_DIFFUSE_NEUTRAL_PENALTY_WEIGHT * (
                        1.0 - metrics["largest_component_ratio"]
                    )

                score = (
                    min_distance * DISTINCT_COLOR_DISTANCE_WEIGHT
                    + min_distance * STITCHED_MINORITY_DISTINCT_DISTANCE_WEIGHT / max(1, count)
                    + count
                    + metrics["component_count"] * REGION_COMPONENT_WEIGHT
                    + metrics["boundary_ratio"] * REGION_BOUNDARY_RATIO_WEIGHT
                    + metrics["largest_component_ratio"] * REGION_LARGEST_COMPONENT_WEIGHT
                    + minority_component_bonus
                    - metrics["fragmentation_ratio"] * REGION_FRAGMENTATION_PENALTY_WEIGHT
                    - weak_boundary_penalty * REGION_WEAK_BOUNDARY_PENALTY_WEIGHT
                    - light_neutral_penalty
                    - diffuse_neutral_penalty
                )
                if preserve_accents and saturation(rgb) >= 30 and count <= 140:
                    score += min_distance * 0.5 + saturation(rgb) * 0.16

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


def render_preview_image_from_cells(
    cells: list[list[str]],
    mesh_count: int,
    show_grid: bool,
) -> str:
    stitch_height = len(cells)
    stitch_width = len(cells[0]) if stitch_height else 0
    border_stitches = int(1.0 * mesh_count)

    total_width = stitch_width + (2 * border_stitches)
    total_height = stitch_height + (2 * border_stitches)
    canvas = Image.new("RGB", (total_width, total_height), (255, 255, 255))

    if stitch_width and stitch_height:
        quantized = Image.new("RGB", (stitch_width, stitch_height), (255, 255, 255))
        quantized.putdata([
            (255, 255, 255) if cell == BLANK_CELL else hex_to_rgb(cell)
            for row in cells
            for cell in row
        ])
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


def _numeric_env_ok_in_request() -> bool:
    """Re-probe the numeric environment at serving time with realistic sizes.

    The import-time check once passed while real requests still produced
    corrupted colors — the failure only shows up in the serving context
    (worker thread / production-sized images). Probing a 200x200 solid color
    through the same pipeline entry points costs a few ms per import request.
    """
    probe_rgb = (200, 30, 40)
    try:
        probe = Image.new("RGB", (200, 200), probe_rgb)
        resized = resize_linear_light(probe, (30, 30), Image.Resampling.BILINEAR)
        if any(abs(got - want) > 4 for got, want in zip(resized.getpixel((15, 15)), probe_rgb)):
            return False
        roundtrip = _oklab_to_srgb_array(_srgb_to_oklab_array(np.array([list(probe_rgb)], dtype=np.float64)))
        if np.abs(roundtrip - np.array(probe_rgb)).max() > 4:
            return False
    except Exception:
        return False
    return True


def _palette_looks_corrupted(palette: list[dict]) -> bool:
    """A whole photo collapsing to a single very dark color is the corruption
    signature (any real photo keeps several palette entries)."""
    return len(palette) <= 1 and all(
        max(hex_to_rgb(color["hex"])) < 70 for color in palette
    )


def generate_stitch_preview(
    image_url: str,
    stitch_width: int,
    stitch_height: int,
    color_count: int,
    show_grid: bool,
    clean_background: bool,
    simplify_colors: bool,
    strengthen_dark_detail: bool,
    preserve_accents: bool,
    mesh_count: int,
    contrast_level: str,
    source_type: str = "photo",
) -> tuple[str, list[dict], list[list[str]]]:
    import logging

    # The corruption is intermittent (transient episodes on shared hosts), so
    # the fallback decision is per request — quality returns automatically
    # once the environment computes correctly again.
    fallback = not _NUMPY_ENV_OK or not _numeric_env_ok_in_request()
    if fallback and _NUMPY_ENV_OK:
        logging.getLogger(__name__).critical(
            "NUMERIC ENVIRONMENT BROKEN AT REQUEST TIME — serving this import "
            "via gamma-space resize and MEDIANCUT quantization."
        )
    token = _FORCE_FALLBACK.set(fallback)
    try:
        result = _generate_stitch_preview_impl(
            image_url, stitch_width, stitch_height, color_count, show_grid,
            clean_background, simplify_colors, strengthen_dark_detail,
            preserve_accents, mesh_count, contrast_level, source_type,
        )

        # Last-resort net: corruption that starts mid-request slips past the
        # entry probe; if the output shows the signature, regenerate once on
        # the numpy-free path.
        if not fallback and _palette_looks_corrupted(result[1]):
            logging.getLogger(__name__).critical(
                "Preview collapsed to a single dark color — regenerating with "
                "the numpy-free fallback pipeline."
            )
            _FORCE_FALLBACK.set(True)
            result = _generate_stitch_preview_impl(
                image_url, stitch_width, stitch_height, color_count, show_grid,
                clean_background, simplify_colors, strengthen_dark_detail,
                preserve_accents, mesh_count, contrast_level, source_type,
            )
        return result
    finally:
        _FORCE_FALLBACK.reset(token)


def _generate_stitch_preview_impl(
    image_url: str,
    stitch_width: int,
    stitch_height: int,
    color_count: int,
    show_grid: bool,
    clean_background: bool,
    simplify_colors: bool,
    strengthen_dark_detail: bool,
    preserve_accents: bool,
    mesh_count: int,
    contrast_level: str,
    source_type: str = "photo",
) -> tuple[str, list[dict], list[list[str]]]:
    src_path = _resolve_asset_path(image_url)
    img = open_source_image(src_path)

    resize_resampling = (
        Image.Resampling.LANCZOS if source_type == "graphic_art" else Image.Resampling.BILINEAR
    )
    resized = resize_linear_light(img, (stitch_width, stitch_height), resize_resampling)
    if source_type == "graphic_art":
        resized = boost_graphic_art_saturation(resized)
    photo_background_ratio = (
        estimate_neutral_background_ratio(
            resized,
            PHOTO_SOFT_BACKGROUND_BRIGHTNESS,
            PHOTO_SOFT_BACKGROUND_SATURATION,
        )
        if source_type == "photo"
        else 0.0
    )
    prepared = prepare_source_image(
        resized,
        source_type,
        clean_background,
        simplify_colors,
        strengthen_dark_detail,
    )
    if source_type == "photo":
        prepared = enhance_photo_features(prepared, photo_background_ratio)

    contrast_factor = CONTRAST_MAP.get(contrast_level, 1.3)
    enhanced = ImageEnhance.Contrast(prepared).enhance(contrast_factor)

    target_color_count = color_count
    effective_color_count = (
        min(128, color_count + STITCHED_COLOR_BUDGET_BONUS)
        if source_type == "stitched_photo"
        else color_count
    )
    if source_type == "stitched_photo":
        target_color_count = max(STITCHED_MIN_COLORS, min(STITCHED_MAX_COLORS, color_count))
        effective_color_count = min(128, target_color_count + STITCHED_COLOR_BUDGET_BONUS)
    elif source_type == "graphic_art":
        effective_color_count = min(128, max(color_count + 8, round(color_count * 1.25)))

    if preserve_accents:
        effective_color_count = min(128, effective_color_count + 12)

    quantized = quantize_image_perceptual(
        enhanced,
        colors=max(2, effective_color_count),
        dither=(
            Image.Dither.NONE
            if source_type in {"stitched_photo", "graphic_art"} or photo_background_ratio >= ISOLATED_SUBJECT_BACKGROUND_RATIO
            else Image.Dither.FLOYDSTEINBERG
        ),
    )
    quantized = normalize_background_after_quantization(quantized, source_type, clean_background)
    if source_type == "stitched_photo":
        quantized = consolidate_stitched_shades(quantized, max(2, target_color_count))
        quantized = collapse_dominant_thread_families(quantized)
        distinct_palette = select_distinct_palette_colors(
            quantized,
            max(2, target_color_count),
            source_image=enhanced,
            source_type=source_type,
            preserve_accents=preserve_accents,
        )
        quantized = remap_image_to_palette(quantized, distinct_palette)
        quantized = normalize_background_after_quantization(quantized, source_type, clean_background)
        quantized = cleanup_tiny_color_islands(quantized)
    elif source_type == "graphic_art":
        distinct_palette = select_distinct_palette_colors(
            quantized,
            max(2, target_color_count),
            source_image=enhanced,
            source_type=source_type,
            preserve_accents=preserve_accents,
        )
        quantized = remap_image_to_palette(quantized, distinct_palette)
        quantized = normalize_background_after_quantization(quantized, source_type, clean_background)
        quantized = cleanup_tiny_color_islands(quantized)
    else:
        distinct_palette = select_distinct_palette_colors(
            quantized,
            max(2, target_color_count),
            source_image=enhanced,
            source_type=source_type,
            preserve_accents=preserve_accents,
        )
        quantized = remap_image_to_palette(quantized, distinct_palette)
        quantized = normalize_background_after_quantization(quantized, source_type, clean_background)
        quantized = despeckle_image(quantized)
        quantized = cleanup_tiny_color_islands(quantized)

    quantized = remap_image_to_nearest_dmc(quantized)
    palette = extract_palette(quantized)
    cells = image_to_cells(quantized)
    if clean_background:
        blank_mask = edge_connected_blank_mask(quantized)
        blank_mask.update(source_transparency_mask(src_path, (stitch_width, stitch_height)))
        cells = apply_blank_mask_to_cells(cells, blank_mask)
        used_hexes = {cell for row in cells for cell in row if cell != BLANK_CELL}
        palette = [color for color in palette if color["hex"] in used_hexes]

    preview_url = render_preview_image_from_cells(
        cells=cells,
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
    img = open_source_image(src_path)

    base = resize_linear_light(img, (stitch_width, stitch_height), Image.Resampling.BILINEAR)

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

    recolored = remap_image_to_nearest_dmc(recolored)
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

def grid_first_render(
    image_url: str,
    stitch_width: int,
    stitch_height: int,
    mesh_count: int,
    show_grid: bool,
    palette: list[dict],
) -> tuple[str, list[list[str]], list[dict]]:
    src_path = _resolve_asset_path(image_url)
    img = open_source_image(src_path)
    resized = resize_linear_light(img, (stitch_width, stitch_height), Image.Resampling.LANCZOS)

    palette_rgb = [(hex_to_rgb(c["hex"]), c) for c in palette]

    cache: dict[tuple[int, int, int], tuple[int, int, int]] = {}
    snapped: list[tuple[int, int, int]] = []
    for pixel in resized.getdata():
        if pixel not in cache:
            best = min(palette_rgb, key=lambda p: color_distance(pixel, p[0]))
            cache[pixel] = best[0]
        snapped.append(cache[pixel])

    result = Image.new("RGB", (stitch_width, stitch_height))
    result.putdata(snapped)
    result = despeckle_image(result)
    result = cleanup_tiny_color_islands(result)

    preview_url = render_preview_image(result, stitch_width, stitch_height, mesh_count, show_grid)
    cells = image_to_cells(result)

    used_hexes = {cell.upper() for row in cells for cell in row if cell != BLANK_CELL}
    used_palette = [c for c in palette if c["hex"].upper() in used_hexes]

    return preview_url, cells, used_palette


PATTERN_IMPORT_MAX_STITCHES = 400
PATTERN_IMPORT_MAX_COLORS = 120
PATTERN_IMPORT_PITCH_TOLERANCE = 0.05
PATTERN_IMPORT_ALPHA_THRESHOLD = 128


class PatternImportError(ValueError):
    """Raised with a machine-readable code when a chart import can't proceed."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _open_image_with_alpha(src_path: Path | str) -> Image.Image:
    if isinstance(src_path, str) and src_path.startswith(("http://", "https://")):
        request = Request(src_path, headers={"User-Agent": "MNS/1.0"})
        with urlopen(request, timeout=30) as response:
            image_bytes = BytesIO(response.read())
        with Image.open(image_bytes) as img:
            return ImageOps.exif_transpose(img).convert("RGBA")

    with Image.open(src_path) as img:
        return ImageOps.exif_transpose(img).convert("RGBA")


def import_pattern_image(
    image_url: str,
    stitch_width: int | None = None,
    stitch_height: int | None = None,
    snap_to_dmc: bool = True,
) -> tuple[list[list[str]], list[dict], int, int, int]:
    """Import an already-charted pattern image (e.g. a Stitchly 1:1 PNG export).

    Unlike the photo pipeline, this path is lossless: no resize filtering, no
    despeckle, no palette budgeting. One block of pixels (or one pixel, for
    1:1 exports) becomes exactly one stitch, sampled at block centers so
    gridlines or antialiased block edges never bleed into the cell color.
    """
    rgba = _open_image_with_alpha(_resolve_asset_path(image_url))
    width, height = rgba.size

    if stitch_width and stitch_height:
        grid_w, grid_h = stitch_width, stitch_height
    elif width <= PATTERN_IMPORT_MAX_STITCHES and height <= PATTERN_IMPORT_MAX_STITCHES:
        grid_w, grid_h = width, height
    else:
        raise PatternImportError(
            "needs_dimensions",
            "Image is larger than one pixel per stitch — provide the pattern's stitch width and height.",
        )

    if grid_w > PATTERN_IMPORT_MAX_STITCHES or grid_h > PATTERN_IMPORT_MAX_STITCHES:
        raise PatternImportError(
            "too_large",
            f"Patterns are limited to {PATTERN_IMPORT_MAX_STITCHES} stitches per side.",
        )
    if grid_w < 1 or grid_h < 1 or grid_w > width or grid_h > height:
        raise PatternImportError("invalid_dimensions", "Stitch dimensions don't fit the image.")

    pitch_x = width / grid_w
    pitch_y = height / grid_h
    if (
        abs(pitch_x - round(pitch_x)) > PATTERN_IMPORT_PITCH_TOLERANCE
        or abs(pitch_y - round(pitch_y)) > PATTERN_IMPORT_PITCH_TOLERANCE
    ):
        raise PatternImportError(
            "non_integer_pitch",
            "Image size isn't a whole multiple of the stitch dimensions.",
        )

    pixels = rgba.load()
    sampled_rows: list[list[tuple[int, int, int] | None]] = []
    distinct_colors: set[tuple[int, int, int]] = set()
    for row in range(grid_h):
        y = min(height - 1, int((row + 0.5) * pitch_y))
        row_colors: list[tuple[int, int, int] | None] = []
        for col in range(grid_w):
            x = min(width - 1, int((col + 0.5) * pitch_x))
            r, g, b, a = pixels[x, y]
            if a < PATTERN_IMPORT_ALPHA_THRESHOLD:
                row_colors.append(None)
            else:
                color = (r, g, b)
                row_colors.append(color)
                distinct_colors.add(color)
        sampled_rows.append(row_colors)

    if len(distinct_colors) > PATTERN_IMPORT_MAX_COLORS:
        raise PatternImportError(
            "too_many_colors",
            "This looks like a photo rather than a charted pattern — use the photo import instead.",
        )
    if not distinct_colors:
        raise PatternImportError("empty_pattern", "No stitched cells found in the image.")

    if snap_to_dmc:
        color_map = {color: tuple(nearest_dmc(color)["rgb"]) for color in distinct_colors}
    else:
        color_map = {color: color for color in distinct_colors}
    snapped_color_count = len(set(color_map.values()))

    counts: dict[tuple[int, int, int], int] = {}
    cells: list[list[str]] = []
    for row_colors in sampled_rows:
        row_cells = []
        for color in row_colors:
            if color is None:
                row_cells.append(BLANK_CELL)
                continue
            mapped = color_map[color]
            counts[mapped] = counts.get(mapped, 0) + 1
            row_cells.append(rgb_to_hex(mapped))
        cells.append(row_cells)

    palette = []
    for rgb, _count in sorted(counts.items(), key=lambda item: -item[1]):
        dmc = nearest_dmc(rgb)
        palette.append({"hex": rgb_to_hex(rgb), "dmc_code": dmc["code"], "dmc_name": dmc["name"]})

    return cells, palette, grid_w, grid_h, snapped_color_count


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
