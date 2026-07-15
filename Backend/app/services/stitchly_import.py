"""Parser for Stitchly's native .stitchly project files.

A .stitchly file is an XML plist wrapping a binary NSKeyedArchiver plist
under the "PatternData" key. The archive's root object carries the full
project: `width`/`height` in stitches, `layerCodes` (a row-major NSArray of
one DMC code string per stitch, "D"-prefixed, e.g. "D891"), `fabricCount`
(mesh/fabric count), `patternName`, and the original source image bytes in
`imageData`. Because the codes are authoritative DMC catalog numbers, no
color quantization or snapping is involved — imports are exact.
"""
import plistlib

from app.data.dmc_colors import DMC_COLORS
from .stitch_visualizer import BLANK_CELL, rgb_to_hex

_DMC_BY_CODE = {d["code"]: d for d in DMC_COLORS}

# Stitchly's own "01"-"30" palette isn't part of the standard DMC catalog and
# was never in our main table. Values below are pixel-sampled directly from
# Stitchly's in-app color picker (2026-07-14), not looked up from a published
# chart, so names are descriptive rather than official.
_SUPPLEMENTAL_DMC = {
    "01": {"code": "01", "name": "White Tin", "rgb": (231, 230, 230)},
    "02": {"code": "02", "name": "Tin", "rgb": (197, 196, 200)},
    "03": {"code": "03", "name": "Pewter", "rgb": (176, 176, 180)},
    "04": {"code": "04", "name": "Charcoal Gray", "rgb": (156, 155, 157)},
    "05": {"code": "05", "name": "Dusty Blush", "rgb": (223, 205, 192)},
    "06": {"code": "06", "name": "Sand", "rgb": (216, 199, 186)},
    "07": {"code": "07", "name": "Taupe", "rgb": (200, 185, 172)},
    "08": {"code": "08", "name": "Cocoa", "rgb": (152, 126, 115)},
    "09": {"code": "09", "name": "Espresso", "rgb": (78, 35, 23)},
    "10": {"code": "10", "name": "Pale Chartreuse", "rgb": (240, 253, 220)},
    "11": {"code": "11", "name": "Light Celery", "rgb": (228, 237, 187)},
    "12": {"code": "12", "name": "Sage", "rgb": (207, 216, 160)},
    "13": {"code": "13", "name": "Mint", "rgb": (202, 244, 225)},
    "14": {"code": "14", "name": "Honeydew", "rgb": (216, 250, 185)},
    "15": {"code": "15", "name": "Spring Green Light", "rgb": (214, 236, 171)},
    "16": {"code": "16", "name": "Fern Green", "rgb": (174, 212, 134)},
    "17": {"code": "17", "name": "Lemon", "rgb": (228, 226, 129)},
    "18": {"code": "18", "name": "Olive Yellow", "rgb": (216, 213, 123)},
    "19": {"code": "19", "name": "Golden Wheat", "rgb": (240, 203, 112)},
    "20": {"code": "20", "name": "Peach", "rgb": (236, 178, 151)},
    "21": {"code": "21", "name": "Terracotta", "rgb": (206, 155, 134)},
    "22": {"code": "22", "name": "Brick Red", "rgb": (176, 101, 83)},
    "23": {"code": "23", "name": "Pale Orchid", "rgb": (235, 226, 236)},
    "24": {"code": "24", "name": "Light Lilac", "rgb": (222, 215, 236)},
    "25": {"code": "25", "name": "Lilac Gray", "rgb": (216, 210, 231)},
    "26": {"code": "26", "name": "Dusty Lilac", "rgb": (206, 200, 220)},
    "27": {"code": "27", "name": "Pale Periwinkle", "rgb": (233, 236, 251)},
    "28": {"code": "28", "name": "Violet", "rgb": (118, 80, 142)},
    "29": {"code": "29", "name": "Deep Violet", "rgb": (97, 65, 115)},
    "30": {"code": "30", "name": "Indigo", "rgb": (105, 85, 204)},
    # This palette's numbering is not contiguous — it skips from 30 straight
    # to 31 then jumps around (48, 51-53, 67, 69, 90, ...). Confirmed by
    # cross-checking every code visible in the Stitchly color picker against
    # our main DMC table: everything else in this same picker (150-156 and
    # up) already resolves normally, only these are genuinely missing.
    "31": {"code": "31", "name": "Deep Purple", "rgb": (83, 53, 157)},
    "32": {"code": "32", "name": "Royal Purple", "rgb": (72, 47, 133)},
    "33": {"code": "33", "name": "Magenta Pink", "rgb": (201, 92, 156)},
    "34": {"code": "34", "name": "Mauve", "rgb": (161, 73, 126)},
    "35": {"code": "35", "name": "Plum", "rgb": (106, 47, 83)},
    "48": {"code": "48", "name": "Blush Pink", "rgb": (248, 216, 235)},
    "51": {"code": "51", "name": "Amber", "rgb": (230, 150, 86)},
    "52": {"code": "52", "name": "Indigo Purple", "rgb": (63, 39, 108)},
    "53": {"code": "53", "name": "Slate Gray", "rgb": (85, 90, 97)},
    "67": {"code": "67", "name": "Powder Blue", "rgb": (168, 190, 200)},
    "69": {"code": "69", "name": "Rust", "rgb": (168, 67, 55)},
    "90": {"code": "90", "name": "Marigold", "rgb": (243, 190, 89)},
    "92": {"code": "92", "name": "Forest Green", "rgb": (81, 132, 76)},
    "93": {"code": "93", "name": "Steel Blue", "rgb": (66, 98, 136)},
    "94": {"code": "94", "name": "Olive", "rgb": (175, 173, 103)},
    "99": {"code": "99", "name": "Rose", "rgb": (170, 75, 97)},
    "105": {"code": "105", "name": "Chestnut", "rgb": (141, 68, 38)},
    "106": {"code": "106", "name": "Tomato Red", "rgb": (205, 68, 57)},
    "107": {"code": "107", "name": "Crimson", "rgb": (168, 40, 57)},
    "111": {"code": "111", "name": "Copper Tan", "rgb": (199, 122, 84)},
    "115": {"code": "115", "name": "Mahogany Red", "rgb": (147, 43, 19)},
    "121": {"code": "121", "name": "Sky Blue", "rgb": (87, 150, 194)},
    "125": {"code": "125", "name": "Soft Sage", "rgb": (168, 197, 168)},
}
_UNKNOWN_CODE_RGB = (176, 176, 176)

# Stitchly uses DMC's French/catalog labels for a few threads our table
# stores under different codes.
_CODE_ALIASES = {
    "BLANC": "White",
    "WHITE": "White",
    "ECRU": "Ecru",
    "B5200": "B5200",
}

_BLANK_CODES = {"", "$null", "D00", "D0", "empty"}


class StitchlyParseError(ValueError):
    pass


def _resolve(objects: list, value):
    return objects[value.data] if isinstance(value, plistlib.UID) else value


def _lookup_code(code: str) -> dict:
    bare = code[1:] if code.startswith("D") else code
    bare = _CODE_ALIASES.get(bare.upper(), bare)
    if bare in _DMC_BY_CODE:
        return _DMC_BY_CODE[bare]
    if bare in _SUPPLEMENTAL_DMC:
        return _SUPPLEMENTAL_DMC[bare]
    return {"code": bare, "name": f"DMC {bare} (approximate)", "rgb": _UNKNOWN_CODE_RGB}


def parse_stitchly(file_bytes: bytes) -> dict:
    try:
        outer = plistlib.loads(file_bytes)
        inner = plistlib.loads(outer["PatternData"])
        objects = inner["$objects"]
        root = _resolve(objects, inner["$top"]["root"])
    except (KeyError, TypeError, plistlib.InvalidFileException) as exc:
        raise StitchlyParseError("Not a readable .stitchly file.") from exc

    width = root.get("width")
    height = root.get("height")
    if not isinstance(width, int) or not isinstance(height, int) or width < 1 or height < 1:
        raise StitchlyParseError("Pattern has no stitch dimensions.")

    layer_ref = root.get("layerCodes")
    layer = _resolve(objects, layer_ref) if layer_ref is not None else None
    raw_codes = layer.get("NS.objects", []) if isinstance(layer, dict) else []
    if len(raw_codes) != width * height:
        raise StitchlyParseError(
            f"Stitch grid size mismatch: {len(raw_codes)} cells for {width}x{height}."
        )

    unknown_codes: set[str] = set()
    counts: dict[str, int] = {}
    entries_by_hex: dict[str, dict] = {}
    cells: list[list[str]] = []
    for row_index in range(height):
        row = []
        for col_index in range(width):
            code = _resolve(objects, raw_codes[row_index * width + col_index])
            if not isinstance(code, str) or code in _BLANK_CODES:
                row.append(BLANK_CELL)
                continue
            dmc = _lookup_code(code)
            if dmc["name"].endswith("(approximate)"):
                unknown_codes.add(dmc["code"])
            hex_color = rgb_to_hex(tuple(dmc["rgb"]))
            row.append(hex_color)
            counts[hex_color] = counts.get(hex_color, 0) + 1
            entries_by_hex[hex_color] = dmc
        cells.append(row)

    if not counts:
        raise StitchlyParseError("Pattern contains no stitches.")

    if unknown_codes:
        raise StitchlyParseError(
            "This pattern uses color codes we can't match to a real needlepoint "
            "thread (e.g. " + ", ".join(sorted(unknown_codes)[:6]) + "). It was "
            "likely drawn from scratch using a different DMC thread line (such as "
            "stranded cotton) rather than photo-imported, so we can't import it "
            "without guessing at thread colors."
        )

    palette_entries = [
        {
            "hex": hex_color,
            "dmc_code": entries_by_hex[hex_color]["code"],
            "dmc_name": entries_by_hex[hex_color]["name"],
        }
        for hex_color, _count in sorted(counts.items(), key=lambda item: -item[1])
    ]

    backstitches = _resolve(objects, root.get("backstitches"))
    point_stitches = _resolve(objects, root.get("pointStitches"))
    backstitch_count = len(backstitches.get("NS.objects", [])) if isinstance(backstitches, dict) else 0
    point_stitch_count = len(point_stitches.get("NS.objects", [])) if isinstance(point_stitches, dict) else 0

    image_data_ref = _resolve(objects, root.get("imageData"))
    source_image_bytes = (
        bytes(image_data_ref["NS.data"]) if isinstance(image_data_ref, dict) and image_data_ref.get("NS.data") else None
    )

    fabric_count = root.get("fabricCount")
    pattern_name = _resolve(objects, root.get("patternName"))

    return {
        "cells": cells,
        "palette": palette_entries,
        "stitch_width": width,
        "stitch_height": height,
        "mesh_count": fabric_count if isinstance(fabric_count, int) else None,
        "pattern_name": pattern_name if isinstance(pattern_name, str) and pattern_name != "$null" else None,
        "source_image_bytes": source_image_bytes,
        "unknown_codes": sorted(unknown_codes),
        "backstitch_count": backstitch_count,
        "point_stitch_count": point_stitch_count,
    }
