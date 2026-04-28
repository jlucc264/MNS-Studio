import logging
import os
import smtplib
from email.message import EmailMessage
from pathlib import Path

logger = logging.getLogger(__name__)

FINALIZED_REPORT_RECIPIENT = os.getenv("FINALIZED_REPORT_RECIPIENT", "john@mns.studio")
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").strip()
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USERNAME or FINALIZED_REPORT_RECIPIENT).strip()


def send_finalized_report(report_path: Path) -> bool:
    if not SMTP_HOST or not SMTP_FROM_EMAIL:
        logger.warning(
            "Finalized report email was not sent because SMTP_HOST/SMTP_FROM_EMAIL are not configured."
        )
        return False

    message = EmailMessage()
    message["Subject"] = "[Final] MNS Studio finalized PDF report"
    message["From"] = SMTP_FROM_EMAIL
    message["To"] = FINALIZED_REPORT_RECIPIENT
    message.set_content(
        "A finalized MNS Studio PDF report is attached. This internal report includes all pages."
    )

    message.add_attachment(
        report_path.read_bytes(),
        maintype="application",
        subtype="pdf",
        filename=f"[Final] {report_path.name}",
    )

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
        smtp.starttls()
        if SMTP_USERNAME and SMTP_PASSWORD:
            smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
        smtp.send_message(message)

    return True
