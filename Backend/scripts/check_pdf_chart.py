#!/usr/bin/env python3
"""Triage chart PDFs against the importer, one or many at a time.

We have exactly one chart PDF to develop against, so the question that matters
is not whether the importer works on that one — it does — but how it behaves on
charts nobody here has seen. This runs the real parser over any PDFs you point
it at and prints what happened, so a batch sent in by a designer can be sorted
into "imports cleanly" and "refused, and here is the reason" without opening the
app or touching the database.

    ./.venv/bin/python scripts/check_pdf_chart.py chart.pdf
    ./.venv/bin/python scripts/check_pdf_chart.py ~/charts/*.pdf --render out/

A refusal is a result, not a crash: the parser verifies its own reading of the
grid against the stitch count the chart prints on itself, so "REFUSED
stitch_count_mismatch" means the safety net did its job. Those are the ones
worth looking at — each is either a generator we don't handle yet or a bug.

--render writes a PNG of each successful import. Eyeballing that against the
PDF is the only check that catches a grid read correctly but, say, mirrored.
"""
import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.pdf_chart_import import parse_pdf_chart, PdfChartParseError  # noqa: E402
from app.services.stitch_visualizer import BLANK_CELL  # noqa: E402


def render(cells: list[list[str]], path: Path, scale: int = 10) -> None:
    from PIL import Image

    height, width = len(cells), len(cells[0])
    img = Image.new("RGB", (width, height), (255, 255, 255))
    px = img.load()
    for y, row in enumerate(cells):
        for x, value in enumerate(row):
            if value == BLANK_CELL:
                continue
            px[x, y] = tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))
    img.resize((width * scale, height * scale), Image.NEAREST).save(path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdfs", nargs="+", type=Path)
    ap.add_argument("--render", type=Path, metavar="DIR",
                    help="write a PNG of each successful import here")
    args = ap.parse_args()

    if args.render:
        args.render.mkdir(parents=True, exist_ok=True)

    outcomes: Counter = Counter()
    for pdf in args.pdfs:
        label = pdf.name
        try:
            result = parse_pdf_chart(pdf.read_bytes())
        except PdfChartParseError as exc:
            outcomes[exc.code] += 1
            print(f"REFUSED  {label}\n         [{exc.code}] {exc}")
            continue
        except Exception as exc:  # an unhandled shape is a bug, not a refusal
            outcomes["crash"] += 1
            print(f"CRASH    {label}\n         {type(exc).__name__}: {exc}")
            continue

        outcomes["ok"] += 1
        stitched = sum(1 for row in result["cells"] for c in row if c != BLANK_CELL)
        fabric = result["fabric_count"]
        note = ""
        if fabric and fabric not in (13, 18):
            note = f"  (fabric count {fabric} — not a mesh we print)"
        if result["unknown_codes"]:
            note += f"  (unrecognised codes: {', '.join(result['unknown_codes'][:6])})"
        print(
            f"OK       {label}\n"
            f"         {result['stitch_width']} x {result['stitch_height']}, "
            f"{stitched} stitches, {len(result['palette'])} colours{note}"
        )
        if args.render:
            out = args.render / f"{pdf.stem}.png"
            render(result["cells"], out)
            print(f"         rendered -> {out}")

    total = sum(outcomes.values())
    summary = ", ".join(f"{count} {name}" for name, count in outcomes.most_common())
    print(f"\n{total} file(s): {summary}")
    return 0 if outcomes["ok"] == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
