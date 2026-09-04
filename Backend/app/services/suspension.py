"""Site-feature kill switch.

Built for the Sep 2026 copyright review: the public gallery, all purchasing, and
the image import tools go dark while listings are investigated and counsel is
engaged, without deleting anything and without a code change to bring them back.

Two decisions worth keeping:

FAIL CLOSED. A feature is served only when its variable is explicitly set to a
true value. A missing, empty, or misspelled variable leaves it suspended. The
asymmetry is deliberate — an accidental extra hour of downtime costs nothing,
while accidentally re-serving the gallery mid-review is the exact failure this
exists to prevent, and a fresh Render instance that came up with no env vars set
would otherwise do precisely that.

READ AT CALL TIME, not at import. Flipping a variable in the Render dashboard
and restarting is enough; nothing needs a deploy or a code review to change what
is live.

Deliberately NOT gated: /stripe/webhook, every /admin route, and a user's own
projects and drafts. Sessions already in flight must still complete or the
customer is charged with no order created; orders already paid for still have to
be fulfilled; and a creator's own saved work is not what is under review — the
takedown question is about what is published publicly.
"""

import logging
import os

from fastapi import HTTPException

logger = logging.getLogger(__name__)

GALLERY = "gallery"
CHECKOUT = "checkout"
IMPORT = "import"

# Feature -> the environment variable that must be explicitly true to serve it.
FEATURE_ENV_VARS = {
    GALLERY: "GALLERY_ENABLED",
    CHECKOUT: "CHECKOUT_ENABLED",
    IMPORT: "IMPORT_ENABLED",
}

_TRUE_VALUES = {"1", "true", "yes", "on", "enabled"}

# Shown to the visitor. Deliberately says nothing about why any individual
# listing is under review, and makes no claim about anyone's rights — see the
# standing note not to characterize listings as infringing.
SUSPENSION_MESSAGE = (
    "This part of MNS Studio is temporarily unavailable while we review the "
    "gallery. Your saved designs are unaffected. Please check back soon."
)

# Long enough that crawlers back off rather than hammering a closed door, short
# enough that they return on their own once this lifts. A 503 with Retry-After
# is a "come back later" signal; a 404 would tell them the gallery is gone for
# good and drop it from the index.
RETRY_AFTER_SECONDS = 60 * 60 * 6


def is_enabled(feature: str) -> bool:
    """True only when the feature's variable is explicitly set to a true value."""
    env_var = FEATURE_ENV_VARS.get(feature)
    if env_var is None:
        # An unknown feature name is a bug in the caller, not a request to serve
        # something. Refuse rather than open a hole via a typo.
        logger.warning("Unknown suspendable feature %r; treating as suspended.", feature)
        return False
    return os.getenv(env_var, "").strip().lower() in _TRUE_VALUES


def require_enabled(feature: str):
    """FastAPI dependency: 503 while `feature` is suspended."""

    def _dependency() -> None:
        if not is_enabled(feature):
            raise HTTPException(
                status_code=503,
                detail=SUSPENSION_MESSAGE,
                headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
            )

    return _dependency


def site_status() -> dict:
    """What the frontend needs to render a notice instead of an error."""
    return {
        "gallery_enabled": is_enabled(GALLERY),
        "checkout_enabled": is_enabled(CHECKOUT),
        "import_enabled": is_enabled(IMPORT),
        "message": SUSPENSION_MESSAGE,
    }
