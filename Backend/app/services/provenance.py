"""Where a design's source image actually came from, decided by the server.

The gallery rule we want — an imported photo may be printed privately but never
published — needs to know an image's origin. Two fields looked like they
already answered that and neither does:

  * `design_origin` and `source_image_url` are both sent by the browser when a
    project is saved, so a client that omits them is simply believed.
  * Every remix-derived project in the database carries no source image at all,
    so derived work already reads as hand-drawn without anyone trying.

And the chat editor launders provenance on its own: ask it to change an
uploaded photo and the result is written out as a fresh image with no record of
what it descended from, indistinguishable from something typed into existence.
Meanwhile a genuine text-to-image generation sets `source_image_url` exactly
like an upload does, so a naive "has a source image" rule blocks the *safest*
content on the platform while admitting the laundered kind.

So origin is recorded here instead, on the storage path, at the moment the
server writes the file — the one point the browser does not control. Three
values rather than two, because "edited an upload" is neither an upload nor a
generation and collapsing it into either is what makes the rule leak:

    uploaded             a photo the user supplied
    generated            text-to-image, descended from no one's picture
    derived_from_upload  a generation seeded by an upload, however many passes

A path prefix carries it rather than a lookup table: it needs no migration, no
extra query on the save path, and it cannot drift out of sync with the file it
describes. Forging one means naming a file that does not exist, which fails
loudly instead of silently mislabelling a design.

Images written before this existed are UNKNOWN, not clear. Whether the gallery
rule grandfathers them is a policy decision, deliberately left to the caller.
"""

UPLOADED = "uploaded"
GENERATED = "generated"
DERIVED = "derived_from_upload"
UNKNOWN = "unknown"

# The storage prefix each origin is written under. "source-images" is the
# pre-existing prefix and is what UNKNOWN reads back from.
PREFIXES = {
    UPLOADED: "origin-uploaded",
    GENERATED: "origin-generated",
    DERIVED: "origin-derived",
}
LEGACY_PREFIX = "source-images"

_BY_PREFIX = {v: k for k, v in PREFIXES.items()}


def prefix_for(origin: str) -> str:
    """Storage prefix to write an image of this origin under."""
    return PREFIXES.get(origin, LEGACY_PREFIX)


def origin_of(source_image_url: str | None) -> str:
    """Read an image's origin back off its stored path.

    Substring rather than exact path parsing: the same image is referenced as a
    local `/assets/...` path before it is made durable and as a full Supabase
    URL afterwards, and both must resolve the same way.
    """
    if not source_image_url:
        # No source image at all. Usually a from-scratch drawing, but a remix
        # also arrives this way, so it is not a positive signal of anything.
        return UNKNOWN
    for prefix, origin in _BY_PREFIX.items():
        if f"/{prefix}/" in source_image_url or source_image_url.startswith(f"{prefix}/"):
            return origin
    return UNKNOWN


def origin_after_edit(current_source_url: str | None) -> str:
    """Origin of the image produced by editing `current_source_url`.

    Editing a generation stays a generation. Editing anything else — an upload,
    something already derived, or an image whose origin predates this tracking —
    is derived. Unknown resolves to derived on purpose: an image we cannot
    account for might be a photograph, and treating it as a clean generation is
    the mistake that lets one edit launder a copyrighted upload.
    """
    return GENERATED if origin_of(current_source_url) == GENERATED else DERIVED


def blocks_gallery(origin: str, *, block_unknown: bool = False) -> bool:
    """Whether a design with this origin should be kept out of the gallery.

    `block_unknown` is the grandfathering switch. Most of the existing gallery
    predates provenance tracking, so turning it on retroactively bars listings
    that may be perfectly fine. Left off by default; that is a policy call, not
    a technical one.
    """
    if origin in (UPLOADED, DERIVED):
        return True
    return origin == UNKNOWN and block_unknown
