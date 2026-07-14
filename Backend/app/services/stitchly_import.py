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

# DMC's 2017 "01-35" range isn't in our main table yet; approximate the two
# codes observed in real Stitchly exports so their stitches aren't dropped.
_SUPPLEMENTAL_DMC = {
    "01": {"code": "01", "name": "White Tin", "rgb": (227, 227, 225)},
    "02": {"code": "02", "name": "Tin", "rgb": (200, 200, 203)},
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
