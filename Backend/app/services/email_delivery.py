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


def send_order_notification(order_type: str, metadata: dict, customer_email: str | None, shipping: dict | None) -> bool:
    if not _ready():
        return False

    type_labels = {
        "print_own": "Print: Own Design",
        "template": "Template Purchase",
        "print_gallery": "Print: Gallery Design",
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

    resend.Emails.send({
        "from": FROM_EMAIL,
        "to": [RECIPIENT],
        "subject": subject,
        "text": "\n".join(lines),
    })
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
