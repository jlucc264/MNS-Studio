import os
import stripe

from .canvas_pricing import (
    get_canvas_for_design,
    print_own_total_cents,
    print_gallery_total_cents,
    TEMPLATE_PRICE_CENTS,
)

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")


def _cents_to_display(cents: int) -> str:
    return f"${cents / 100:.2f}".replace(".00", "")


def create_print_own_checkout(
    pdf_url: str,
    width_inches: float,
    height_inches: float,
    user_id: str,
    gallery_item_id: str | None = None,
    creator_user_id: str | None = None,
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

    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=[{
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
        mode="payment",
        ui_mode="embedded_page",
        shipping_address_collection={"allowed_countries": ["US"]},
        return_url=f"{FRONTEND_URL}/studio?order=success",
        metadata=metadata,
    )
    return session.client_secret


def create_template_checkout(
    gallery_item_id: str,
    gallery_item_title: str,
    creator_user_id: str,
    pdf_url: str,
) -> str:
    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=[{
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
        mode="payment",
        ui_mode="embedded_page",
        return_url=f"{FRONTEND_URL}/gallery?order=success",
        metadata={
            "type": "template",
            "gallery_item_id": gallery_item_id,
            "creator_user_id": creator_user_id,
            "pdf_url": pdf_url,
            "title": gallery_item_title,
        },
    )
    return session.client_secret


def create_gallery_print_checkout(
    gallery_item_id: str,
    gallery_item_title: str,
    creator_user_id: str,
    pdf_url: str,
    width_inches: float,
    height_inches: float,
) -> str:
    canvas = get_canvas_for_design(width_inches, height_inches)

    total = print_gallery_total_cents(canvas)
    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=[{
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
        mode="payment",
        ui_mode="embedded_page",
        shipping_address_collection={"allowed_countries": ["US"]},
        return_url=f"{FRONTEND_URL}/gallery?order=success",
        metadata={
            "type": "print_gallery",
            "gallery_item_id": gallery_item_id,
            "creator_user_id": creator_user_id,
            "canvas_size": canvas["label"],
            "pdf_url": pdf_url,
            "title": gallery_item_title,
            "width_inches": str(width_inches),
            "height_inches": str(height_inches),
        },
    )
    return session.client_secret
