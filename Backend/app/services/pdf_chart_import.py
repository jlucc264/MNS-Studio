"""Parser for symbol-chart PDFs — the kind a needlepoint designer sells.

A chart PDF is not a picture of a pattern. The ones we care about are vector
PDFs with a real text layer: every stitch is a single positioned glyph, and the
key below the chart pairs each glyph with a DMC code as ordinary text. So this
is not OCR and nothing here guesses — the grid is recovered by reading where
the generator placed each glyph, exactly as `stitchly_import` recovers it from
a plist. The pipeline is the same shape as that one: symbol -> DMC code -> cell.

Two things make it safe to trust the result:

  * The chart states its own dimensions and stitch count ("Pattern size: 26 x
    33 ... Total stitches: 502"). We reconstruct the grid independently and
    then check it against those numbers, so a misread lattice is a refusal
    rather than a wrong canvas. Every parse is self-verifying; see `_verify`.
  * Cell colors are read off the key's own swatches rather than looked up in
    a DMC table. The swatch is what the designer saw, and it is not always
    what our tables say — D162 is a pale blue in this generator's output and a
    grey-blue in STITCHLY_DMC_COLORS. Taking the PDF's color keeps an import
    looking like the chart it came from, which is the same reasoning that gave
    the Stitchly importer its own color table.

Because the color comes from the PDF, a thread code we don't recognise is NOT
fatal here, unlike in `stitchly_import`. There we reject unknown codes because
an unknown code means an unknown color and the import would be invented. Here
the PDF supplies the color either way, so an unrecognised code costs us the
thread's *name*, not the design. Those codes are reported in `unknown_codes`
so the UI can tell the importer to check them before ordering thread.

Known limits, all of which fail loudly rather than quietly:
  * One page only. Larger charts tile across pages with overlapping edge rows
    and need reassembly, which is not implemented.
  * The grid must occupy every declared row and column. If a chart's outermost
    row or column is entirely blank the lattice comes up short and we refuse,
    because nothing in the glyph positions says which side the empty band was
    on. The generator's ruler numbers would anchor it; no sample needs that yet.
  * Scanned charts have no text layer and are rejected outright.
"""
import io
import re
import statistics
from collections import Counter

import pdfplumber

from app.data.dmc_colors import DMC_COLORS
from app.data.stitchly_dmc_colors import STITCHLY_DMC_COLORS
from .stitch_visualizer import BLANK_CELL, rgb_to_hex

# Thread names only. The color always comes from the chart's own swatch, so
# these tables are consulted for the human-readable name and nothing else —
# which is why reading the Stitchly-sampled table here does not violate the
# "never use this table elsewhere" rule in its docstring: that rule guards its
# *colors* from leaking into quantization, and no color is taken from it here.
_NAMES_BY_CODE = {d["code"]: d["name"] for d in STITCHLY_DMC_COLORS}
_NAMES_BY_CODE.update({d["code"]: d["name"] for d in DMC_COLORS})

# A key entry's thread code, as printed: "D433", "DB5200". The leading D is the
# generator's marker for the DMC Stranded line, not part of the code.
_CODE_RE = re.compile(r"^DB?\d+$")

_PATTERN_SIZE_RE = re.compile(r"Pattern\s*size:\s*(\d+)\s*[x×]\s*(\d+)", re.I)
_TOTAL_STITCHES_RE = re.compile(r"Total\s*stitches:\s*(\d+)", re.I)
_FABRIC_COUNT_RE = re.compile(r"Fabric\s*count:\s*(\d+)", re.I)

# A glyph lands in the lattice band whose centre is nearest. Bands are split
# wherever two sorted coordinates differ by more than this fraction of a glyph
# height — derived from the chart's own type size rather than fixed in points,
# so it holds whatever scale the generator drew at.
_BAND_SPLIT_RATIO = 0.5

# A key swatch is a box drawn around one symbol. Anything whose width or
# height exceeds this many glyph heights is page furniture, not a swatch.
_SWATCH_MAX_GLYPH_HEIGHTS = 4.0

MAX_STITCHES_PER_SIDE = 400


class PdfChartParseError(ValueError):
    """A chart we will not import. `code` is a stable handle for the UI."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _shape_rgb(color) -> tuple[int, int, int] | None:
    """PDF fill colors arrive as gray, RGB or CMYK components in 0..1."""
    if color is None:
        return None
    if isinstance(color, (int, float)):
        color = (color,)
    try:
        vals = [float(c) for c in color]
    except (TypeError, ValueError):
        return None
    if len(vals) == 1:
        g = vals[0]
        rgb = (g, g, g)
    elif len(vals) == 3:
        rgb = tuple(vals)
    elif len(vals) == 4:
        c, m, y, k = vals
        rgb = ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    else:
        return None
    return tuple(max(0, min(255, round(v * 255))) for v in rgb)


def _bands(values: list[float], tolerance: float) -> list[float]:
    """Collapse sorted coordinates into lattice band centres."""
    ordered = sorted(values)
    groups = [[ordered[0]]]
    for v in ordered[1:]:
        if v - groups[-1][-1] <= tolerance:
            groups[-1].append(v)
        else:
            groups.append([v])
    return [sum(g) / len(g) for g in groups]


def _nearest(value: float, bands: list[float]) -> int:
    return min(range(len(bands)), key=lambda i: abs(bands[i] - value))


def _declared(page_text: str) -> tuple[int, int, int, int | None]:
    size = _PATTERN_SIZE_RE.search(page_text)
    total = _TOTAL_STITCHES_RE.search(page_text)
    if not size or not total:
        # Without these we have no way to check our own reading of the grid,
        # and an unverified import is the one outcome worth refusing outright.
        raise PdfChartParseError(
            "no_metadata",
            "This PDF doesn't state its pattern size and total stitch count. "
            "We rely on those to verify the chart was read correctly, so we "
            "can't import it.",
        )
    fabric = _FABRIC_COUNT_RE.search(page_text)
    return (
        int(size.group(1)),
        int(size.group(2)),
        int(total.group(1)),
        int(fabric.group(1)) if fabric else None,
    )


def _chart_window(chars: list[dict], metadata_top: float) -> tuple[float, float, float, float]:
    """Bounding box of the chart grid, above the metadata line.

    The page also carries ruler numbers along the chart's edges, which must not
    be mistaken for stitches. Rather than name fonts the generator happens to
    use, take the most common (font, size) pair above the metadata line: on a
    symbol chart that is overwhelmingly the stitch glyphs, because there is one
    per stitch and only a handful of ruler labels. Its bounding box is the
    grid, and every glyph inside it — including symbols the generator drew from
    a second, rarer font — is then a stitch.
    """
    above = [c for c in chars if c["bottom"] <= metadata_top]
    if not above:
        raise PdfChartParseError("no_chart", "No chart was found above the pattern details.")
    style, _ = Counter((c["fontname"], round(c["size"], 1)) for c in above).most_common(1)[0]
    body = [c for c in above if (c["fontname"], round(c["size"], 1)) == style]
    pad = statistics.median([c["bottom"] - c["top"] for c in body]) * 0.25
    return (
        min(c["x0"] for c in body) - pad,
        max(c["x1"] for c in body) + pad,
        min(c["top"] for c in body) - pad,
        max(c["bottom"] for c in body) + pad,
    )


def _read_grid(cells_chars: list[dict], width: int, height: int) -> list[list[str | None]]:
    glyph_h = statistics.median([c["bottom"] - c["top"] for c in cells_chars])
    tol = glyph_h * _BAND_SPLIT_RATIO
    cols = _bands([(c["x0"] + c["x1"]) / 2 for c in cells_chars], tol)
    rows = _bands([(c["top"] + c["bottom"]) / 2 for c in cells_chars], tol)
    if len(cols) != width or len(rows) != height:
        raise PdfChartParseError(
            "grid_mismatch",
            f"The chart says it is {width} x {height} stitches, but we read a "
            f"{len(cols)} x {len(rows)} grid from it. We won't import a pattern "
            "we can't line up with its own stated size.",
        )

    grid: list[list[str | None]] = [[None] * width for _ in range(height)]
    for c in cells_chars:
        r = _nearest((c["top"] + c["bottom"]) / 2, rows)
        col = _nearest((c["x0"] + c["x1"]) / 2, cols)
        if grid[r][col] is not None:
            raise PdfChartParseError(
                "grid_mismatch",
                "Two stitches landed in the same square while reading this "
                "chart, so the grid couldn't be read reliably.",
            )
        grid[r][col] = c["text"]
    return grid


def _read_key(chars: list[dict], shapes: list[dict], metadata_top: float) -> dict[str, dict]:
    """Map each chart symbol to its thread code and the swatch color beside it.

    The symbols are not read as characters. Several arrive as private-use
    codepoints from the generator's own symbol fonts — one decodes as a hotel
    emoji — so their meaning is nil and only their consistency between chart
    and key matters. They are treated as opaque tokens throughout.

    Pairing is done per key row by x order rather than by "nearest code to the
    right", which quietly mis-pairs when a row's symbols come from fonts with
    different baselines.
    """
    below = [c for c in chars if c["top"] > metadata_top]
    if not below:
        return {}
    glyph_h = statistics.median([c["bottom"] - c["top"] for c in below])
    rows = _bands([(c["top"] + c["bottom"]) / 2 for c in below], glyph_h * 0.75)

    mapping: dict[str, dict] = {}
    for index in range(len(rows)):
        line = [c for c in below if _nearest((c["top"] + c["bottom"]) / 2, rows) == index]
        line.sort(key=lambda c: c["x0"])

        # Walk the row splitting it into runs of adjacent characters; a run is
        # a thread code if it reads like one, and any other single glyph is a
        # candidate symbol.
        runs: list[list[dict]] = []
        for ch in line:
            if runs and ch["x0"] - runs[-1][-1]["x1"] < glyph_h * 0.45:
                runs[-1].append(ch)
            else:
                runs.append([ch])

        codes = [r for r in runs if _CODE_RE.match("".join(c["text"] for c in r))]
        code_runs = {id(r) for r in codes}
        symbols = [r[0] for r in runs if len(r) == 1 and id(r) not in code_runs]
        # Only a row that pairs up one-to-one is a key row; the title line and
        # the footer fall out here because they carry no codes at all.
        if not codes or len(codes) != len(symbols):
            continue
        for sym, code_run in zip(symbols, codes):
            mapping[sym["text"]] = {
                "code": "".join(c["text"] for c in code_run),
                "rgb": _swatch_rgb(sym, shapes),
            }
    return mapping


def _swatch_rgb(symbol: dict, shapes: list[dict]) -> tuple[int, int, int] | None:
    """Fill color of the swatch box drawn behind a key symbol.

    The generator draws two boxes per entry: a filled square and a slightly
    smaller outline on top of it. For a plain thread both carry the same color;
    for a variegated one they differ, and it is the larger, filled square that
    is actually visible — confirmed by sampling the rendered page. So take the
    largest filled shape containing the symbol.

    "Largest" has to be bounded, though: the page's own white background and
    the chart's backing panel both contain every symbol on the page, and
    unbounded this picked white for all sixteen threads. A swatch is drawn
    around a single glyph, so anything much bigger than the glyph is scenery.
    """
    cx = (symbol["x0"] + symbol["x1"]) / 2
    cy = (symbol["top"] + symbol["bottom"]) / 2
    limit = (symbol["bottom"] - symbol["top"]) * _SWATCH_MAX_GLYPH_HEIGHTS
    best = None
    best_area = 0.0
    for s in shapes:
        if not (s["x0"] <= cx <= s["x1"] and s["top"] <= cy <= s["bottom"]):
            continue
        w, h = s["x1"] - s["x0"], s["bottom"] - s["top"]
        if w > limit or h > limit:
            continue
        rgb = _shape_rgb(s.get("non_stroking_color"))
        if rgb is None:
            continue
        if w * h > best_area:
            best, best_area = rgb, w * h
    return best


def _thread_name(code: str) -> tuple[str, str, bool]:
    """(bare code, display name, whether we recognise it)."""
    bare = code[1:] if code.startswith("D") else code
    name = _NAMES_BY_CODE.get(bare)
    if name:
        return bare, name, True
    return bare, f"DMC {bare}", False


def _verify(grid, declared_stitches):
    stitched = sum(1 for row in grid for cell in row if cell)
    if stitched != declared_stitches:
        raise PdfChartParseError(
            "stitch_count_mismatch",
            f"This chart says it has {declared_stitches} stitches but we read "
            f"{stitched}. Rather than import a pattern that doesn't match its "
            "own count, we've stopped.",
        )
    return stitched


def parse_pdf_chart(file_bytes: bytes) -> dict:
    try:
        pdf = pdfplumber.open(io.BytesIO(file_bytes))
    except Exception as exc:  # pdfminer raises a wide range on malformed input
        raise PdfChartParseError("unreadable", "This file isn't a readable PDF.") from exc

    with pdf:
        if len(pdf.pages) != 1:
            raise PdfChartParseError(
                "multi_page",
                f"This chart is {len(pdf.pages)} pages. We can only import "
                "single-page charts for now — a tiled chart has to be joined "
                "back together across pages, which we don't do yet.",
            )
        page = pdf.pages[0]
        chars = [c for c in page.chars if c["text"].strip()]
        if not chars:
            raise PdfChartParseError(
                "no_text_layer",
                "This PDF has no text in it, so it's most likely a scan or a "
                "flat image of a chart. We can only import charts saved "
                "directly from charting software.",
            )
        shapes = list(page.rects) + list(page.curves)
        width, height, declared_stitches, fabric_count = _declared(page.extract_text() or "")

        if width > MAX_STITCHES_PER_SIDE or height > MAX_STITCHES_PER_SIDE:
            raise PdfChartParseError(
                "too_large",
                f"Patterns are limited to {MAX_STITCHES_PER_SIDE} stitches per side.",
            )

        # The line stating the pattern's details is the divider: chart above,
        # key below. It is a required anchor, so using it costs nothing.
        metadata_top = _metadata_top(chars)

        x0, x1, y0, y1 = _chart_window(chars, metadata_top)
        cells_chars = [
            c for c in chars
            if x0 <= (c["x0"] + c["x1"]) / 2 <= x1 and y0 <= (c["top"] + c["bottom"]) / 2 <= y1
        ]
        grid = _read_grid(cells_chars, width, height)
        _verify(grid, declared_stitches)

        key = _read_key(chars, shapes, metadata_top)
        missing = sorted({v for row in grid for v in row if v and v not in key})
        if missing:
            raise PdfChartParseError(
                "symbol_not_in_key",
                f"{len(missing)} symbol(s) used in this chart don't appear in "
                "its colour key, so we can't tell which thread they are.",
            )

        unknown_codes: list[str] = []
        counts: Counter = Counter()
        entries: dict[str, dict] = {}
        cells: list[list[str]] = []
        for row in grid:
            out_row = []
            for symbol in row:
                if symbol is None:
                    out_row.append(BLANK_CELL)
                    continue
                entry = key[symbol]
                rgb = entry["rgb"]
                if rgb is None:
                    raise PdfChartParseError(
                        "no_swatch",
                        "This chart's colour key has no colour swatches we can "
                        "read, so we'd be guessing at every thread colour.",
                    )
                bare, name, known = _thread_name(entry["code"])
                if not known and bare not in unknown_codes:
                    unknown_codes.append(bare)
                hex_color = rgb_to_hex(rgb)
                out_row.append(hex_color)
                counts[hex_color] += 1
                entries[hex_color] = {"code": bare, "name": name}
            cells.append(out_row)

        palette = [
            {
                "hex": hex_color,
                "dmc_code": entries[hex_color]["code"],
                "dmc_name": entries[hex_color]["name"],
            }
            for hex_color, _ in counts.most_common()
        ]

        return {
            "cells": cells,
            "palette": palette,
            "stitch_width": width,
            "stitch_height": height,
            "stitch_count": declared_stitches,
            "fabric_count": fabric_count,
            "pattern_name": (pdf.metadata or {}).get("Title") or None,
            "unknown_codes": unknown_codes,
        }


def _metadata_top(chars: list[dict]) -> float:
    """Top edge of the line stating the pattern's size and stitch count."""
    for line_top, line_chars in _lines(chars):
        text = "".join(c["text"] for c in sorted(line_chars, key=lambda c: c["x0"]))
        if _PATTERN_SIZE_RE.search(text):
            return line_top
    raise PdfChartParseError(
        "no_metadata",
        "Couldn't find the line stating this pattern's size.",
    )


def _lines(chars: list[dict]):
    glyph_h = statistics.median([c["bottom"] - c["top"] for c in chars])
    centres = _bands([(c["top"] + c["bottom"]) / 2 for c in chars], glyph_h * 0.6)
    grouped: dict[int, list[dict]] = {}
    for c in chars:
        grouped.setdefault(_nearest((c["top"] + c["bottom"]) / 2, centres), []).append(c)
    for index in sorted(grouped):
        yield min(ch["top"] for ch in grouped[index]), grouped[index]
