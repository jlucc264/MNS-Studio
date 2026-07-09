import json
import os
import stripe

from .canvas_pricing import (
    get_canvas_for_design,
    print_own_total_cents,
    print_gallery_total_cents,
    TEMPLATE_PRICE_CENTS,
    PRINT_OWN_BASE_CENTS,
    PRINT_GALLERY_BASE_CENTS,
)

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
SHIPPING_CENTS = 700


def _cents_to_display(cents: int) -> str:
    return f"${cents / 100:.2f}".replace(".00", "")


def _apply_canvas_credit(buyer_user_id: str | None, total_cents: int) -> int:
    if not buyer_user_id:
        return 0
    from .supabase_db import get_creator_earnings
    pending = get_creator_earnings(buyer_user_id).get("pending_cents", 0)
    if pending <= 0:
        return 0
    return max(0, min(pending, max(0, total_cents - 50)))


def create_print_own_checkout(
    pdf_url: str,
    width_inches: float,
    height_inches: float,
    user_id: str,
    gallery_item_id: str | None = None,
    creator_user_id: str | None = None,
    internal_pdf_supabase_path: str | None = None,
) -> str:
    canvas = get_canvas_for_design(width_inches, height_inches)
    is_remixed = bool(gallery_item_id and creator_user_id)
    print_price = print_gallery_total_cents(canvas) if is_remixed else print_own_total_cents(canvas)
    subtotal = print_price + SHIPPING_CENTS
    credit = _apply_canvas_credit(user_id, subtotal)
    amount = subtotal - credit

    metadata: dict = {
        "type": "print_gallery" if is_remixed else "print_own",
        "pdf_url": pdf_url,
        "canvas_size": canvas["label"],
        "width_inches": str(width_inches),
        "height_inches": str(height_inches),
        "user_id": user_id,
        "print_subtotal_cents": str(print_price),
    }
    if is_remixed:
        metadata["gallery_item_id"] = gallery_item_id
        metadata["creator_user_id"] = creator_user_id
    if internal_pdf_supabase_path:
        metadata["internal_pdf_supabase_path"] = internal_pdf_supabase_path
    if credit:
        metadata["applied_credit_user_id"] = user_id
        metadata["applied_credit_cents"] = str(credit)

    intent = stripe.PaymentIntent.create(
        amount=amount,
        currency="usd",
        automatic_payment_methods={"enabled": True},
        metadata=metadata,
    )
    return intent.client_secret


def create_template_checkout(
    gallery_item_id: str,
    gallery_item_title: str,
    creator_user_id: str,
    pdf_url: str,
    buyer_user_id: str | None = None,
) -> str:
    credit = _apply_canvas_credit(buyer_user_id, TEMPLATE_PRICE_CENTS)
    amount = TEMPLATE_PRICE_CENTS - credit

    metadata: dict = {
        "type": "template",
        "gallery_item_id": gallery_item_id,
        "creator_user_id": creator_user_id,
        "pdf_url": pdf_url,
        "title": gallery_item_title,
        "print_subtotal_cents": str(TEMPLATE_PRICE_CENTS),
    }
    if credit:
        metadata["applied_credit_user_id"] = buyer_user_id
        metadata["applied_credit_cents"] = str(credit)

    intent = stripe.PaymentIntent.create(
        amount=amount,
        currency="usd",
        automatic_payment_methods={"enabled": True},
        metadata=metadata,
    )
    return intent.client_secret


def create_gallery_print_checkout(
    gallery_item_id: str,
    gallery_item_title: str,
    creator_user_id: str,
    pdf_url: str,
    width_inches: float,
    height_inches: float,
    buyer_user_id: str | None = None,
) -> str:
    canvas = get_canvas_for_design(width_inches, height_inches)
    print_price = print_gallery_total_cents(canvas)
    subtotal = print_price + SHIPPING_CENTS
    credit = _apply_canvas_credit(buyer_user_id, subtotal)
    amount = subtotal - credit

    metadata: dict = {
        "type": "print_gallery",
        "gallery_item_id": gallery_item_id,
        "creator_user_id": creator_user_id,
        "canvas_size": canvas["label"],
        "pdf_url": pdf_url,
        "title": gallery_item_title,
        "width_inches": str(width_inches),
        "height_inches": str(height_inches),
        "print_subtotal_cents": str(print_price),
    }
    if credit:
        metadata["applied_credit_user_id"] = buyer_user_id
        metadata["applied_credit_cents"] = str(credit)

    intent = stripe.PaymentIntent.create(
        amount=amount,
        currency="usd",
        automatic_payment_methods={"enabled": True},
        metadata=metadata,
    )
    return intent.client_secret


def create_cart_checkout(items: list[dict], user_id: str) -> str:
    metadata: dict = {"type": "cart", "user_id": user_id, "item_count": str(len(items))}
    subtotal_for_credit = 0

    for i, item in enumerate(items):
        canvas = get_canvas_for_design(item["width_inches"], item["height_inches"])
        has_creator = bool(item.get("creator_user_id"))
        base = PRINT_GALLERY_BASE_CENTS if has_creator else PRINT_OWN_BASE_CENTS
        qty = item.get("quantity", 1)
        unit = base + canvas["price_cents"]
        subtotal_for_credit += unit * qty

        item_meta: dict = {
            "w": item["width_inches"],
            "h": item["height_inches"],
            "qty": qty,
            "b": base,
            "cv": canvas["price_cents"],
        }
        ip = item.get("internal_pdf_supabase_path")
        if ip:
            item_meta["ip"] = ip
        else:
            item_meta["pdf"] = item["pdf_url"]
        if has_creator:
            item_meta["gi"] = item.get("creator_gallery_item_id", "")
            item_meta["cu"] = item["creator_user_id"]

        metadata[f"item_{i}"] = json.dumps(item_meta)

    total = subtotal_for_credit + SHIPPING_CENTS
    credit = _apply_canvas_credit(user_id, total)
    amount = total - credit

    metadata["print_subtotal_cents"] = str(subtotal_for_credit)
    if credit:
        metadata["applied_credit_user_id"] = user_id
        metadata["applied_credit_cents"] = str(credit)

    intent = stripe.PaymentIntent.create(
        amount=amount,
        currency="usd",
        automatic_payment_methods={"enabled": True},
        metadata=metadata,
    )
    return intent.client_secret
