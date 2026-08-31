"""One-off backfill for print_orders.amount_total_cents.

Historically the sale price was never persisted to print_orders — it only
ever lived in the Stripe checkout session, used once to build a confirmation
email and then discarded. This walks every order missing amount_total_cents
and recovers the price from Stripe so revenue reporting has a real number for
old orders too.

Run once from Backend/, with the same env vars the app uses (SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY):

    python -m scripts.backfill_order_amounts
"""
import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import stripe

from app.services.supabase_db import _request

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("backfill_order_amounts")

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")


def _cart_item_total(real_session_id: str, item_index: int) -> int | None:
    session = stripe.checkout.Session.retrieve(real_session_id)
    metadata = session.get("metadata") or {}
    raw = metadata.get(f"item_{item_index}")
    if not raw:
        return None
    item_meta = json.loads(raw)
    return (item_meta.get("b", 0) + item_meta.get("cv", 0)) * item_meta.get("qty", 1)


def main() -> None:
    orders = _request("GET", "/print_orders", params="amount_total_cents=is.null&select=id,stripe_session_id,order_type")
    orders = orders if isinstance(orders, list) else []
    logger.info("Found %d orders missing amount_total_cents", len(orders))

    updated = 0
    skipped = 0

    for order in orders:
        order_id = order["id"]
        session_id = order["stripe_session_id"]
        order_type = order.get("order_type")

        try:
            if order_type == "cart":
                real_session_id, index_str = session_id.rsplit("_", 1)
                amount_total_cents = _cart_item_total(real_session_id, int(index_str))
            else:
                session = stripe.checkout.Session.retrieve(session_id)
                amount_total_cents = session.get("amount_total")

            if amount_total_cents is None:
                logger.warning("Skipping order %s (session %s): no amount recoverable", order_id, session_id)
                skipped += 1
                continue

            _request("PATCH", "/print_orders", params=f"id=eq.{order_id}", body={"amount_total_cents": amount_total_cents})
            updated += 1
        except Exception as exc:
            logger.warning("Skipping order %s (session %s): %s", order_id, session_id, exc)
            skipped += 1

    logger.info("Done. Updated %d, skipped %d.", updated, skipped)


if __name__ == "__main__":
    main()
