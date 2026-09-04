"""Reverse-image screening for gallery listings, via Google Vision web detection.

Why this exists: the Aug/Sep 2026 complaints were all discovered by someone
else first — a designer recognising her own canvas, a rights holder's agent,
a community member. Safe harbour turns on acting when you become aware of a
problem, so the cheapest thing we can do is become aware earlier than the
claimant. Reading titles by hand missed a plainly recognisable Lightning
McQueen for two weeks, which is the argument for automating it.

Two signals come back from one call, and they catch different things:

  * **Matching images** catch a *traced commercial canvas* — the Adirondack
    chair case, where the design is someone's for-sale artwork redrawn. Note
    these will hit less often than you'd expect: what we submit is our own
    stitch-grid rendering, not the source photo, so an exact match only lands
    when the original itself is findable at similar framing.

  * **Web entities and the best-guess label** catch a *character or brand* —
    the Miffy and Cars cases. Vision names the subject ("Lightning McQueen"),
    which is precisely the signal a title never gives you when the listing is
    called "LMQ Cars Canvas". In practice this is the higher-yield half for
    this gallery, and it is why we do not simply threshold on match counts.

Nothing here blocks a publish. Generic patterns produce false hits constantly
(every listing is legitimately "needlepoint"), so the output is a flag for a
person to judge, recorded against the listing for the reviewer to see.
"""

import json
import logging
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate"
VISION_TIMEOUT = 20

# How many of each list we keep. The API returns far more than a reviewer will
# ever click, and the row is stored per listing, so keep it small.
MAX_ENTITIES = 8
MAX_MATCHES = 6
MAX_PAGES = 6

# An entity has to clear this to be worth showing. Vision scores are not
# probabilities and drift by subject; this is tuned to admit named characters
# and brands while dropping the long tail of vague nouns.
ENTITY_SCORE_FLOOR = 0.55

# Terms every listing here legitimately matches. Without this filter each of
# the 89 listings flags on itself and the queue becomes noise the operator
# learns to ignore, which is worse than no screening at all.
GENERIC_TERMS = {
    "needlepoint", "cross-stitch", "cross stitch", "embroidery", "stitch",
    "needlework", "pattern", "pixel art", "canvas", "textile", "craft",
    "art", "design", "drawing", "illustration", "image", "picture",
    "graphics", "font", "line", "square", "rectangle", "circle", "pattern",
    "thread", "yarn", "sewing", "quilt", "mosaic", "beadwork", "handicraft",
    "symmetry", "material", "product", "brand", "logo", "text", "paper",
}


def is_configured() -> bool:
    return bool(os.getenv("GOOGLE_VISION_API_KEY", "").strip())


def _generic(description: str) -> bool:
    d = description.strip().lower()
    return d in GENERIC_TERMS or len(d) < 3


def _call_vision(image_url: str) -> dict | None:
    """One web-detection annotation. Returns None on any failure.

    The image URI is handed to Google rather than the bytes: gallery previews
    live in a public Supabase bucket, so this saves downloading and re-encoding
    every image we screen.
    """
    key = os.getenv("GOOGLE_VISION_API_KEY", "").strip()
    if not key:
        return None

    payload = {
        "requests": [
            {
                "image": {"source": {"imageUri": image_url}},
                "features": [{"type": "WEB_DETECTION", "maxResults": 20}],
            }
        ]
    }

    try:
        req = Request(
            f"{VISION_ENDPOINT}?key={key}",
            data=json.dumps(payload).encode(),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urlopen(req, timeout=VISION_TIMEOUT) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        logger.warning("Vision request failed: %s %s", exc.code, detail)
        return None
    except (OSError, URLError, ValueError) as exc:
        logger.warning("Vision request failed: %s", exc)
        return None

    responses = body.get("responses") or []
    if not responses:
        return None
    first = responses[0]
    # Vision reports per-image problems in the body with a 200 status, so an
    # unreachable or unreadable image surfaces here rather than as an HTTPError.
    if first.get("error"):
        logger.warning("Vision returned an error for %s: %s", image_url, first["error"])
        return None
    return first.get("webDetection") or {}


def screen_image(image_url: str) -> dict:
    """Screen one image. Always returns a record, never raises.

    status is one of:
      "flagged"        something a person should look at
      "clear"          screened, nothing notable
      "error"          the call failed; the listing is unscreened, not cleared
      "not_configured" no API key on this server
    """
    if not image_url:
        return {"status": "error", "detail": "No preview image to screen."}
    if not is_configured():
        return {"status": "not_configured", "detail": "GOOGLE_VISION_API_KEY is not set."}

    web = _call_vision(image_url)
    if web is None:
        return {"status": "error", "detail": "Vision request failed; listing is unscreened."}

    entities = []
    for e in web.get("webEntities") or []:
        desc = (e.get("description") or "").strip()
        score = e.get("score") or 0
        if not desc or _generic(desc) or score < ENTITY_SCORE_FLOOR:
            continue
        entities.append({"name": desc, "score": round(float(score), 3)})
        if len(entities) >= MAX_ENTITIES:
            break

    def urls(key: str, limit: int) -> list[str]:
        return [i.get("url") for i in (web.get(key) or [])[:limit] if i.get("url")]

    full_matches = urls("fullMatchingImages", MAX_MATCHES)
    partial_matches = urls("partialMatchingImages", MAX_MATCHES)

    pages = []
    for p in (web.get("pagesWithMatchingImages") or [])[:MAX_PAGES]:
        if p.get("url"):
            pages.append({"url": p["url"], "title": (p.get("pageTitle") or "").strip()[:160]})

    best_guess = ""
    guesses = web.get("bestGuessLabels") or []
    if guesses:
        best_guess = (guesses[0].get("label") or "").strip()

    # Why either signal flags on its own: a matched image means the artwork
    # exists elsewhere, and a named entity means the subject belongs to
    # somebody. Requiring both would miss the Cars case (a hand-drawn character
    # matches no image) and the Adirondack case (a traced canvas whose subject
    # is just "chair").
    reasons = []
    if full_matches:
        reasons.append(f"{len(full_matches)} matching image(s) found online")
    if partial_matches:
        reasons.append(f"{len(partial_matches)} partial match(es)")
    if entities:
        reasons.append("named subject: " + ", ".join(e["name"] for e in entities[:3]))

    return {
        "status": "flagged" if reasons else "clear",
        "detail": "; ".join(reasons) if reasons else "Nothing notable found.",
        "best_guess": best_guess,
        "entities": entities,
        "full_matches": full_matches,
        "partial_matches": partial_matches,
        "pages": pages,
    }
