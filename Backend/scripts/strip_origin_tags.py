"""Remove auto-applied provenance tags from existing gallery items.

Through 2026-08-30 the studio auto-tagged every published design with how it
was made: 'from photo' (applied to every from-scratch canvas too, because it
was derived from a source_type that defaults to 'photo'), 'graphic art', and
briefly the 'original'/'import' pair that replaced them. That tagging was
removed on 2026-09-01 — the site should not assert provenance it cannot
verify — but rows published earlier still carry the tags.

'remix' is deliberately NOT stripped. It records lineage between two gallery
items we host and drives creator attribution, rather than describing a
relationship to outside source material.

User-authored tags are preserved. A tag is only removed if it exactly matches
one of STRIP_TAGS after the normalisation the API already applies at publish
time (lowercased, '#' removed, trimmed) — so a user who deliberately typed
"original" as their own hashtag loses it too. That is accepted: there is no way
to tell the two apart after the fact, and leaving them risks exactly the
provenance implication this is meant to remove.

Dry run by default. Pass --apply to write:

    python -m scripts.strip_origin_tags            # report only
    python -m scripts.strip_origin_tags --apply    # actually update
"""
import argparse
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.services.supabase_db import _request

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("strip_origin_tags")

STRIP_TAGS = {"from photo", "graphic art", "original", "import"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    args = parser.parse_args()

    rows = _request("GET", "/gallery_items", params="select=id,title,tags")
    rows = rows if isinstance(rows, list) else []
    logger.info("Fetched %d gallery items", len(rows))

    changed = 0
    for row in rows:
        tags = row.get("tags")
        if not isinstance(tags, list):
            continue
        kept = [t for t in tags if str(t).strip().lower() not in STRIP_TAGS]
        if len(kept) == len(tags):
            continue

        removed = [t for t in tags if str(t).strip().lower() in STRIP_TAGS]
        changed += 1
        logger.info(
            "%s %r: removing %s -> %s",
            "WOULD UPDATE" if not args.apply else "UPDATING",
            row.get("title") or row["id"],
            removed,
            kept or "(no tags)",
        )
        if args.apply:
            _request("PATCH", "/gallery_items", params=f"id=eq.{row['id']}", body={"tags": kept})

    if not args.apply:
        logger.info("\nDry run — %d of %d items would change. Re-run with --apply to write.", changed, len(rows))
    else:
        logger.info("\nDone. Updated %d of %d items.", changed, len(rows))


if __name__ == "__main__":
    sys.exit(main())
