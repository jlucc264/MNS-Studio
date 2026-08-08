import json
import os
import stripe

from .canvas_pricing import (
    get_canvas_for_design,
    print_own_total_cents,
    print_gallery_total_cents,
    TEMPLATE_PRICE_CENTS,
    PRINT_OWN_BASE_CENTS,
)

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

_SHIPPING_OPTIONS = [{
    "shipping_rate_data": {
        "type": "fixed_amount",
        "fixed_amount": {"amount": 700, "currency": "usd"},
        "display_name": "Standard Shipping",
        "delivery_estimate": {
            "minimum": {"unit": "business_day", "value": 5},
            "maximum": {"unit": "business_day", "value": 7},
        },
    },
}]


def _cents_to_display(cents: int) -> str:
    return f"${cents / 100:.2f}".replace(".00", "")


def _apply_canvas_credit(buyer_user_id: str | None, total_cents: int) -> tuple[str | None, int]:
    if not buyer_user_id:
        return None, 0
    from .supabase_db import get_creator_earnings
    pending = get_creator_earnings(buyer_user_id).get("pending_cents", 0)
    if pending <= 0:
        return None, 0
    apply = min(pending, max(0, total_cents - 50))
    if apply <= 0:
        return None, 0
    coupon = stripe.Coupon.create(amount_off=apply, currency="usd", duration="once")
    return coupon.id, apply


def _apply_discount(session_params: dict, coupon_id: str | None) -> None:
    """Attach either the buyer's canvas credit or a promo-code field.

    Stripe allows one discount per session and rejects `allow_promotion_codes`
    outright when `discounts` is set, so the two are mutually exclusive. Credit
    wins where both could apply: it is money the buyer has already earned, and
    silently dropping it to make room for a code would be worse than not
    offering the field. Friends-and-family codes are created and managed in the
    Stripe dashboard — nothing about them lives in this codebase.
    """
    if coupon_id:
        session_params["discounts"] = [{"coupon": coupon_id}]
    else:
        session_params["allow_promotion_codes"] = True


def create_print_own_checkout(
    pdf_url: str,
    width_inches: float,
    height_inches: float,
    user_id: str,
    gallery_item_id: str | None = None,
    creator_user_id: str | None = None,
    internal_pdf_supabase_path: str | None = None,
    project_id: str | None = None,
) -> str:
    canvas = get_canvas_for_design(width_inches, height_inches)

    is_remixed = bool(gallery_item_id and creator_user_id)
    total = print_gallery_total_cents(canvas) if is_remixed else print_own_total_cents(canvas)
    name = f"Custom needlepoint canvas print — {canvas['label']}\""
    if is_remixed:
        name += " (remixed template)"

    metadata: dict = {
        "type": "print_gallery" if is_remixed else "print_own",
        "pdf_url": pdf_url,
        "canvas_size": canvas["label"],
        "width_inches": str(width_inches),
        "height_inches": str(height_inches),
        "user_id": user_id,
    }
    if is_remixed:
        metadata["gallery_item_id"] = gallery_item_id
        metadata["creator_user_id"] = creator_user_id
    if internal_pdf_supabase_path:
        metadata["internal_pdf_supabase_path"] = internal_pdf_supabase_path
    if project_id:
        metadata["project_id"] = project_id

    coupon_id, applied_cents = _apply_canvas_credit(user_id, total)
    if applied_cents:
        metadata["applied_credit_user_id"] = user_id
        metadata["applied_credit_cents"] = str(applied_cents)

    session_params: dict = {
        "line_items": [{
            "price_data": {
                "currency": "usd",
                "unit_amount": total,
                "product_data": {
                    "name": name,
                    "description": (
                        f"{width_inches}\" × {height_inches}\" design on a "
                        f"{canvas['label']}\" canvas · includes PDF report"
                    ),
                },
            },
            "quantity": 1,
        }],
        "mode": "payment",
        "ui_mode": "embedded_page",
        "shipping_options": _SHIPPING_OPTIONS,
        "shipping_address_collection": {"allowed_countries": ["US"]},
        "return_url": f"{FRONTEND_URL}/studio?order=success",
        "metadata": metadata,
    }
    _apply_discount(session_params, coupon_id)

    session = stripe.checkout.Session.create(**session_params)
    return session.client_secret


def create_template_checkout(
    gallery_item_id: str,
    gallery_item_title: str,
    creator_user_id: str,
    pdf_url: str,
    buyer_user_id: str | None = None,
) -> str:
    metadata = {
        "type": "template",
        "gallery_item_id": gallery_item_id,
        "creator_user_id": creator_user_id,
        "pdf_url": pdf_url,
        "title": gallery_item_title,
        # Creator earnings are a share of THIS item, so record it explicitly.
        # Stripe's amount_total includes shipping and any other line items.
        "item_total_cents": str(TEMPLATE_PRICE_CENTS),
    }
    coupon_id, applied_cents = _apply_canvas_credit(buyer_user_id, TEMPLATE_PRICE_CENTS)
    if applied_cents:
        metadata["applied_credit_user_id"] = buyer_user_id
        metadata["applied_credit_cents"] = str(applied_cents)

    session_params: dict = {
        "line_items": [{
            "price_data": {
                "currency": "usd",
                "unit_amount": TEMPLATE_PRICE_CENTS,
                "product_data": {
                    "name": f"Needlepoint template: {gallery_item_title}",
                    "description": "Finalized PDF pattern with color palette and stitch counts",
                },
            },
            "quantity": 1,
        }],
        "mode": "payment",
        "ui_mode": "embedded_page",
        "return_url": f"{FRONTEND_URL}/gallery?order=success",
        "metadata": metadata,
    }
    _apply_discount(session_params, coupon_id)

    session = stripe.checkout.Session.create(**session_params)
    return session.client_secret


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
    total = print_gallery_total_cents(canvas)

    metadata = {
        "type": "print_gallery",
        "gallery_item_id": gallery_item_id,
        "creator_user_id": creator_user_id,
        "canvas_size": canvas["label"],
        "pdf_url": pdf_url,
        "title": gallery_item_title,
        "width_inches": str(width_inches),
        "height_inches": str(height_inches),
        # Creator earnings are a share of THIS item, so record it explicitly.
        # Stripe's amount_total includes the $7 shipping, and paying the creator
        # a share of shipping was ~$1.40 per order going out the door.
        "item_total_cents": str(total),
    }
    coupon_id, applied_cents = _apply_canvas_credit(buyer_user_id, total)
    if applied_cents:
        metadata["applied_credit_user_id"] = buyer_user_id
        metadata["applied_credit_cents"] = str(applied_cents)

    session_params: dict = {
        "line_items": [{
            "price_data": {
                "currency": "usd",
                "unit_amount": total,
                "product_data": {
                    "name": f"Needlepoint canvas print: {gallery_item_title} — {canvas['label']}\"",
                    "description": (
                        f"{width_inches}\" × {height_inches}\" design on a "
                        f"{canvas['label']}\" canvas · includes PDF report"
                    ),
                },
            },
            "quantity": 1,
        }],
        "mode": "payment",
        "ui_mode": "embedded_page",
        "shipping_options": _SHIPPING_OPTIONS,
        "shipping_address_collection": {"allowed_countries": ["US"]},
        "return_url": f"{FRONTEND_URL}/gallery?order=success",
        "metadata": metadata,
    }
    _apply_discount(session_params, coupon_id)

    session = stripe.checkout.Session.create(**session_params)
    return session.client_secret


def create_cart_checkout(items: list[dict], user_id: str, use_credit: bool = True) -> str:
    line_items = []
    metadata: dict = {"type": "cart", "user_id": user_id, "item_count": str(len(items))}
    subtotal_for_credit = 0

    for i, item in enumerate(items):
        canvas = get_canvas_for_design(item["width_inches"], item["height_inches"])
        has_creator = bool(item.get("creator_user_id"))
        qty = item.get("quantity", 1)
        # Gallery pricing is now a markup on the print-own total rather than a
        # separate base fee, so derive `unit` from the same helpers the
        # single-item paths use. `b` is kept in the metadata only so that the
        # webhook's `b + cv` still reconstructs the unit price exactly.
        unit = print_gallery_total_cents(canvas) if has_creator else print_own_total_cents(canvas)
        base = unit - canvas["price_cents"]
        subtotal_for_credit += unit * qty

        line_items.append({
            "price_data": {
                "currency": "usd",
                "unit_amount": unit,
                "product_data": {
                    "name": f"Needlepoint canvas print — {canvas['label']}\"",
                    "description": f"{item['width_inches']}\" × {item['height_inches']}\" · {canvas['label']}\" canvas",
                },
            },
            "quantity": qty,
        })

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
        if item.get("pdf_url"):
            item_meta["pdf"] = item["pdf_url"]
        if has_creator:
            item_meta["gi"] = item.get("creator_gallery_item_id", "")
            item_meta["cu"] = item["creator_user_id"]
        if item.get("project_id"):
            item_meta["pid"] = item["project_id"]

        metadata[f"item_{i}"] = json.dumps(item_meta)

    coupon_id, applied_cents = (
        _apply_canvas_credit(user_id, subtotal_for_credit) if use_credit else (None, 0)
    )
    if applied_cents:
        metadata["applied_credit_user_id"] = user_id
        metadata["applied_credit_cents"] = str(applied_cents)

    session_params: dict = {
        "line_items": line_items,
        "mode": "payment",
        "ui_mode": "embedded_page",
        "shipping_options": _SHIPPING_OPTIONS,
        "shipping_address_collection": {"allowed_countries": ["US"]},
        "return_url": f"{FRONTEND_URL}/gallery?order=success",
        "metadata": metadata,
    }
    _apply_discount(session_params, coupon_id)

    session = stripe.checkout.Session.create(**session_params)
    return session.client_secret
