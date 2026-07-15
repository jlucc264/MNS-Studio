"""Parser for Stitchly's native .stitchly project files.

A .stitchly file is an XML plist wrapping a binary NSKeyedArchiver plist
under the "PatternData" key. The archive's root object carries the full
project: `width`/`height` in stitches, `layerCodes` (a row-major NSArray of
one DMC code string per stitch, "D"-prefixed, e.g. "D891"), `fabricCount`
(mesh/fabric count), `patternName`, and the original source image bytes in
`imageData`. Each code is looked up in STITCHLY_DMC_COLORS (colors as
Stitchly itself renders them, not our own DMC chart) rather than snapped
or quantized, so an import shows the same colors the designer picked.
"""
import plistlib

from app.data.stitchly_dmc_colors import STITCHLY_DMC_COLORS
from .stitch_visualizer import BLANK_CELL, rgb_to_hex

# Deliberately not the main DMC_COLORS table: colors here are pixel-sampled
# from Stitchly's own color picker, not our published DMC chart, so an
# import renders the same colors the designer actually saw and picked on
# their screen. Keeping this table separate means changes here can never
# affect photo/graphic quantization or DMC snapping elsewhere in the app.
_STITCHLY_DMC_BY_CODE = {d["code"]: d for d in STITCHLY_DMC_COLORS}
_UNKNOWN_CODE_RGB = (176, 176, 176)

_CODE_ALIASES = {
    "WHITE": "BLANC",
}

_BLANK_CODES = {"", "$null", "D00", "D0", "empty"}


class StitchlyParseError(ValueError):
    pass


def _resolve(objects: list, value):
    return objects[value.data] if isinstance(value, plistlib.UID) else value


def _lookup_code(code: str) -> dict:
    # Custom/blended color instances are stored as "{uuid}-{index} D{code}"
    # (e.g. "E7D1C03E-6A59-43F3-8C66-AC1142B3B3DC-1 D3846") — the UUID
    # tracks the specific painted instance, but the real thread code is
    # always the last whitespace-separated token. Plain codes have no
    # space, so this is a no-op for them.
    code = code.rsplit(" ", 1)[-1]
    bare = code[1:] if code.startswith("D") else code
    bare = _CODE_ALIASES.get(bare.upper(), bare)
    if bare in _STITCHLY_DMC_BY_CODE:
        return _STITCHLY_DMC_BY_CODE[bare]
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
