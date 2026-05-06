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
) -> str:
    canvas = get_canvas_for_design(width_inches, height_inches)
    if not canvas:
        raise ValueError("Design dimensions exceed the largest available canvas (8×12).")

    total = print_own_total_cents(canvas)
    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=[{
            "price_data": {
                "currency": "usd",
                "unit_amount": total,
                "product_data": {
                    "name": f"Custom needlepoint canvas print — {canvas['label']}\"",
                    "description": (
                        f"{width_inches}\" × {height_inches}\" design on a "
                        f"{canvas['label']}\" canvas · includes PDF report"
                    ),
                },
            },
            "quantity": 1,
        }],
        mode="payment",
        shipping_address_collection={"allowed_countries": ["US"]},
        success_url=f"{FRONTEND_URL}/studio?order=success",
        cancel_url=f"{FRONTEND_URL}/studio",
        metadata={
            "type": "print_own",
            "pdf_url": pdf_url,
            "canvas_size": canvas["label"],
            "width_inches": str(width_inches),
            "height_inches": str(height_inches),
            "user_id": user_id,
        },
    )
    return session.url


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
        success_url=f"{FRONTEND_URL}/gallery?order=success",
        cancel_url=f"{FRONTEND_URL}/gallery",
        metadata={
            "type": "template",
            "gallery_item_id": gallery_item_id,
            "creator_user_id": creator_user_id,
            "pdf_url": pdf_url,
            "title": gallery_item_title,
        },
    )
    return session.url


def create_gallery_print_checkout(
    gallery_item_id: str,
    gallery_item_title: str,
    creator_user_id: str,
    pdf_url: str,
    width_inches: float,
    height_inches: float,
) -> str:
    canvas = get_canvas_for_design(width_inches, height_inches)
    if not canvas:
        raise ValueError("Design dimensions exceed the largest available canvas (8×12).")

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
        shipping_address_collection={"allowed_countries": ["US"]},
        success_url=f"{FRONTEND_URL}/gallery?order=success",
        cancel_url=f"{FRONTEND_URL}/gallery",
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
    return session.url
