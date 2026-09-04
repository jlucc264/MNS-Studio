"""Copyright screening for gallery listings, using Claude's vision.

Why this exists: every complaint so far was found by someone else first — a
designer recognising her own canvas, a rights holder's agent, a community
member. Safe harbour turns on acting once you are aware, so the cheapest move
available is to become aware before the claimant does. Reading titles by hand
is not that; it missed a plainly recognisable Lightning McQueen for two weeks
while five vaguer listings sat flagged.

**Why not reverse image search.** This was first built on Google Vision web
detection and measured against ten listings we already knew were problems. It
caught two. It read the Cars canvas as "luxury vehicle", the Frida portrait and
the Adirondack chair as "cross-stitch", and the lightsabers as "pattern" — it
was describing the *medium*, because a stitch rendering on a visible grid is
what dominates the picture. Meanwhile it flagged dog breeds and "digital
illustration". Reverse image search answers "does this picture exist
elsewhere", but the question that matters here is "does this design depict
something that belongs to someone", which is recognition, not matching. Asking
a vision model that question directly caught eight of nine.

**Why no web search.** Adding the web search tool was measured too: on the one
listing it was meant to catch (a chair traced from a canvas still for sale) it
ran eight searches, cost roughly twenty times a plain call, and still returned
clear. Search returns text snippets, and confirming that kind of copy requires
*looking* at the candidate product photos. That case stays a known gap, handled
by a person spot-checking anything whose composition reads like a product
rather than a drawing.

Nothing here blocks a publish and nothing is auto-hidden. The output is a
prompt for a person to look, and the judgement stays with the operator.
"""

import logging
import os

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

MODEL = "claude-opus-5"

# Enough headroom for adaptive thinking plus a three-field answer. Measured
# completions land near 300 tokens.
MAX_TOKENS = 1024

# Screening is a judgement call on a small image, not a research task. Medium
# is what the accuracy above was measured at; raising it costs more per listing
# for no observed gain.
EFFORT = "medium"

SYSTEM = """You screen needlepoint designs for a small shop before they are published.

The images are low-resolution stitch renderings on a visible grid. Look past the
medium and judge the underlying subject: the grid and the blocky pixels are how
every design here looks and say nothing about whether it is a copy.

Flag a design when it depicts intellectual property belonging to someone else:
a fictional character, a logo or brand, a sports team or university mark, a
Greek-letter organisation, song lyrics or a distinctive quoted phrase, a
recognisable artwork or portrait of a real person, or a design that is clearly
a specific commercial product rather than a generic rendering of its subject.

Clear a design when its subject is generic and belongs to nobody: a lobster, a
lemon, a plain monogram, an ordinary chair, a sailboat, a house, an initial, a
stripe or border pattern. Being well drawn does not make something someone
else's. A listing title that names a franchise does not by itself make the
artwork a copy — judge the picture, and say so in the reason if the title is
the only connection.

Name the rights holder in `subject` whenever you can identify one, because the
person reading this has to decide what to do and "some cartoon character" does
not help them. Keep `reason` to one sentence."""


class _Screening(BaseModel):
    verdict: str = Field(description='Exactly "flag" or "clear".')
    subject: str = Field(description="What the design actually depicts, naming the rights holder if identifiable.")
    reason: str = Field(description="One sentence explaining the verdict.")


def is_configured() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY", "").strip())


def screen_image(image_url: str, title: str = "") -> dict:
    """Screen one listing image. Always returns a record, never raises.

    status is one of:
      "flagged"        something a person should look at
      "clear"          screened, subject belongs to nobody
      "error"          the call failed; the listing is UNSCREENED, not clear
      "not_configured" no API key on this server

    The error/clear distinction is the important one. A screening that silently
    reads as clear when it never ran is worse than no screening, because it
    manufactures the belief that somebody looked.
    """
    if not image_url:
        return {"status": "error", "detail": "No preview image to screen."}
    if not is_configured():
        return {"status": "not_configured", "detail": "ANTHROPIC_API_KEY is not set."}

    try:
        import anthropic

        client = anthropic.Anthropic()
        response = client.messages.parse(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            output_config={"effort": EFFORT},
            system=SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "url", "url": image_url}},
                        {"type": "text", "text": f'Listing title: "{title}"' if title else "Screen this design."},
                    ],
                }
            ],
            output_format=_Screening,
        )

        # A safety decline leaves the listing unscreened. Reported as an error
        # rather than routed to a fallback model: a refusal on a needlepoint
        # image is rare enough that a human looking at it is the better answer,
        # and it keeps a beta parameter out of the publish path.
        if response.stop_reason == "refusal":
            return {"status": "error", "detail": "The model declined to screen this image."}

        parsed = response.parsed_output
        if parsed is None:
            return {"status": "error", "detail": "Screening returned nothing usable."}

        flagged = parsed.verdict.strip().lower().startswith("flag")
        return {
            "status": "flagged" if flagged else "clear",
            "subject": parsed.subject.strip()[:300],
            "detail": parsed.reason.strip()[:500],
        }

    except Exception as exc:  # noqa: BLE001 - every failure means "unscreened"
        logger.exception("Screening failed for %s", image_url)
        return {"status": "error", "detail": f"Screening failed: {type(exc).__name__}"}
