import base64
import logging
import os
from pathlib import Path

import resend

logger = logging.getLogger(__name__)

resend.api_key = os.getenv("RESEND_API_KEY", "")

RECIPIENT = os.getenv("FINALIZED_REPORT_RECIPIENT", "john@mns.studio")
FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "MNS Studio <noreply@mns.studio>")


def _ready() -> bool:
    if not resend.api_key:
        logger.warning("Email skipped — RESEND_API_KEY not configured.")
        return False
    return True


def send_contact_email(name: str | None, reply_email: str | None, category: str, message: str) -> bool:
    if not _ready():
        return False

    subject = f"[MNS Contact] {category}"
    if name:
        subject += f" — {name}"

    lines = [f"Category: {category}"]
    if name:
        lines.append(f"Name: {name}")
    if reply_email:
        lines.append(f"Reply-to: {reply_email}")
    lines += ["", message]

    params: resend.Emails.SendParams = {
        "from": FROM_EMAIL,
        "to": [RECIPIENT],
        "subject": subject,
        "text": "\n".join(lines),
    }
    if reply_email:
        params["reply_to"] = [reply_email]

    resend.Emails.send(params)
    return True


def send_order_notification(
    order_type: str,
    metadata: dict,
    customer_email: str | None,
    shipping: dict | None,
    pdf_attachment_bytes: bytes | None = None,
    pdf_attachment_name: str = "production_report.pdf",
    extra_attachments: list[tuple[bytes, str]] | None = None,
) -> bool:
    if not _ready():
        return False

    type_labels = {
        "print_own": "Print: Own Design",
        "template": "Template Purchase",
        "print_gallery": "Print: Gallery Design",
        "cart": "Cart Order",
    }
    subject = f"[MNS Order] {type_labels.get(order_type, order_type)}"
    if metadata.get("title"):
        subject += f" — {metadata['title']}"

    lines = [f"Order type: {type_labels.get(order_type, order_type)}"]
    if metadata.get("title"):
        lines.append(f"Design: {metadata['title']}")
    if metadata.get("canvas_size"):
        lines.append(f"Canvas size: {metadata['canvas_size']}\"")
    if metadata.get("width_inches") and metadata.get("height_inches"):
        lines.append(f"Design dimensions: {metadata['width_inches']}\" × {metadata['height_inches']}\"")
    if metadata.get("pdf_url"):
        lines.append(f"PDF: {metadata['pdf_url']}")
    if metadata.get("item_count"):
        # A cart's metadata carries none of the title/canvas_size/dimension keys
        # the single-item paths set, so without this the whole notification read
        # "Cart Order / Items in cart: 5" and nothing else — the buyer got an
        # itemised list and we didn't. Same helper the customer email uses.
        lines.append(f"Items in cart: {metadata['item_count']}")
        for n, item_line in enumerate(_order_items_summary(order_type, metadata), start=1):
            lines.append(f"  {n}. {item_line}")
    if customer_email:
        lines.append(f"\nCustomer email: {customer_email}")
    if shipping:
        addr = shipping.get("address", {})
        name = shipping.get("name", "")
        lines.append(f"Ship to: {name}")
        lines.append(f"  {addr.get('line1', '')}")
        if addr.get("line2"):
            lines.append(f"  {addr['line2']}")
        lines.append(f"  {addr.get('city', '')}, {addr.get('state', '')} {addr.get('postal_code', '')}")

    params: resend.Emails.SendParams = {
        "from": FROM_EMAIL,
        "to": [RECIPIENT],
        "subject": subject,
        "text": "\n".join(lines),
    }

    attachments = []
    if pdf_attachment_bytes:
        attachments.append({"filename": pdf_attachment_name, "content": list(pdf_attachment_bytes)})
    for pdf_bytes, pdf_name in (extra_attachments or []):
        attachments.append({"filename": pdf_name, "content": list(pdf_bytes)})
    if attachments:
        params["attachments"] = attachments

    resend.Emails.send(params)
    return True


def _order_items_summary(order_type: str, metadata: dict) -> list[str]:
    if order_type == "cart":
        import json as _json

        lines = []
        for i in range(int(metadata.get("item_count", 0))):
            try:
                item = _json.loads(metadata.get(f"item_{i}", "{}"))
            except Exception:
                continue
            qty = item.get("qty", 1)
            qty_suffix = f" × {qty}" if qty and qty != 1 else ""
            lines.append(f'{item.get("w", "?")}" × {item.get("h", "?")}" canvas print{qty_suffix}')
        return lines

    title = metadata.get("title", "your design")
    if order_type == "template":
        return [f"Needlepoint pattern: “{title}”"]
    canvas = f' on a {metadata["canvas_size"]}" canvas' if metadata.get("canvas_size") else ""
    if order_type == "print_gallery":
        return [f"Canvas print: “{title}”{canvas}"]
    return [f"Canvas print of your design{canvas}"]


def send_customer_order_confirmation(
    order_type: str,
    metadata: dict,
    customer_email: str,
    shipping: dict | None,
    amount_total_cents: int | None,
    pdf_attachments: list[tuple[bytes, str]] | None = None,
) -> bool:
    if not _ready():
        return False

    is_template = order_type == "template"
    items = _order_items_summary(order_type, metadata)
    total = f"${amount_total_cents / 100:,.2f}" if amount_total_cents is not None else None

    if is_template:
        next_steps = "Your pattern PDF is attached to this email — happy stitching!"
    else:
        next_steps = (
            "We're preparing your canvas now — expect it to ship within 5–7 business days, "
            "and we'll follow up with tracking once it's on its way."
        )
        if pdf_attachments:
            next_steps += " We've attached a production report of what you ordered for your records."

    text_lines = ["Thank you for your order from MNS Studio!", ""]
    text_lines += [f"  • {item}" for item in items]
    if total:
        text_lines += ["", f"Total paid: {total}"]
    if shipping:
        addr = shipping.get("address", {})
        text_lines += ["", f"Shipping to: {shipping.get('name', '')}", f"  {addr.get('line1', '')}"]
        if addr.get("line2"):
            text_lines.append(f"  {addr['line2']}")
        text_lines.append(f"  {addr.get('city', '')}, {addr.get('state', '')} {addr.get('postal_code', '')}")
    text_lines += ["", next_steps, "", "Questions? Just reply to this email.", "— MNS Studio"]

    item_rows = "".join(
        f'<tr><td style="padding:6px 0;border-bottom:1px solid #eee6d8;">{item}</td></tr>'
        for item in items
    )
    total_row = (
        f'<tr><td style="padding:10px 0 0;font-weight:bold;">Total paid: {total}</td></tr>'
        if total
        else ""
    )
    shipping_html = ""
    if shipping:
        addr = shipping.get("address", {})
        parts = [shipping.get("name", ""), addr.get("line1", "")]
        if addr.get("line2"):
            parts.append(addr["line2"])
        parts.append(f"{addr.get('city', '')}, {addr.get('state', '')} {addr.get('postal_code', '')}")
        shipping_html = (
            '<p style="margin:18px 0 4px;font-weight:bold;">Shipping to</p>'
            + "<p style=\"margin:0;color:#5b544a;\">" + "<br>".join(p for p in parts if p) + "</p>"
        )

    html = f"""
<div style="background:#f9f5ee;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;color:#2f2a24;">
  <div style="max-width:520px;margin:0 auto;background:#fffdf9;border:1px solid #e8e0d0;border-radius:10px;padding:32px;">
    <img src="https://www.mns.studio/icons/icon-512.png" width="48" height="48" alt="MNS Studio" style="border-radius:10px;margin:0 0 20px;display:block;">
    <h1 style="margin:0 0 6px;font-size:22px;font-weight:normal;">Thank you for your order</h1>
    <p style="margin:0 0 20px;color:#5b544a;">Your MNS Studio order is confirmed.</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px;">{item_rows}{total_row}</table>
    {shipping_html}
    <p style="margin:22px 0 0;">{next_steps}</p>
    <p style="margin:18px 0 0;color:#5b544a;font-size:14px;">Questions? Just reply to this email.</p>
    <p style="margin:24px 0 0;font-size:14px;color:#8a8272;">— MNS Studio · <a href="https://mns.studio" style="color:#8a8272;">mns.studio</a></p>
  </div>
</div>
"""

    params: resend.Emails.SendParams = {
        "from": FROM_EMAIL,
        "to": [customer_email],
        "reply_to": [RECIPIENT],
        "subject": "Your MNS Studio order is confirmed",
        "text": "\n".join(text_lines),
        "html": html,
    }
    if pdf_attachments:
        params["attachments"] = [
            {"filename": name, "content": list(content)} for content, name in pdf_attachments
        ]

    resend.Emails.send(params)
    return True


def send_finalized_report(report_path: Path) -> bool:
    if not _ready():
        return False

    pdf_bytes = report_path.read_bytes()
    resend.Emails.send({
        "from": FROM_EMAIL,
        "to": [RECIPIENT],
        "subject": "[Final] MNS Studio finalized PDF report",
        "text": "A finalized MNS Studio PDF report is attached.",
        "attachments": [{
            "filename": f"[Final] {report_path.name}",
            "content": list(pdf_bytes),
        }],
    })
    return True


# The §512(g) notice: when material comes down, the user who posted it is told,
# and told how to respond. Wording is deliberately constrained — it describes
# the complaint and the action taken, and never asserts that the recipient
# infringed anything. That is not our determination to make, and a platform
# that makes it in writing hands a claimant a quote and the user a grievance.
def send_takedown_notice(
    to_email: str,
    design_title: str | None,
    reason: str | None = None,
) -> bool:
    if not _ready():
        return False

    title = design_title or "one of your designs"
    lines = [
        f"We've removed \"{title}\" from the MNS Studio gallery while we review a",
        "copyright concern that was raised with us.",
        "",
        "This is not a determination that you did anything wrong. We remove listings",
        "on receipt of a complaint so we can look into it properly, and listings are",
        "restored when the concern is resolved.",
        "",
        "Your design has not been deleted. It remains in your account, and anything",
        "already ordered is unaffected.",
        "",
    ]
    if reason:
        lines += [f"Reference: {reason}", ""]
    lines += [
        "If you hold the rights to this design, or you have permission to use the",
        "material in it, reply to this message and tell us — we'd rather hear from",
        "you than guess. Our full policy is at https://mns.studio/terms (section 4).",
        "",
        "— MNS Studio",
    ]

    params: resend.Emails.SendParams = {
        "from": FROM_EMAIL,
        "to": [to_email],
        "subject": "A design has been removed from the MNS Studio gallery",
        "text": "\n".join(lines),
    }
    resend.Emails.send(params)
    return True
