"""Alert delivery channels (FR-ALR-03, SW-04/05/06, SDS DD-12).

In-app delivery is immediate and never depends on external channels
(UN-40): the alert row itself is the in-app alert. Email (SMTP/TLS), SMS
(HTTPS gateway) and signed webhooks are attempted per the configured
channels for the alert's severity; failures are logged, never raised.
"""
import hashlib
import hmac
import json
import logging
import smtplib
import urllib.request
from email.message import EmailMessage

from . import config_store

log = logging.getLogger("nprs.notify")


def _send_email(db, alert):
    server = config_store.get_setting(db, "smtp_server")
    if not server:
        return
    try:
        msg = EmailMessage()
        msg["Subject"] = f"[NPRS {alert.severity}] {alert.type}"
        msg["From"] = "nprs@localhost"
        msg["To"] = "security-office@localhost"
        msg.set_content(alert.message)
        with smtplib.SMTP(server, 587, timeout=5) as s:
            try:
                s.starttls()
            except Exception:
                pass
            s.send_message(msg)
    except Exception as exc:  # channel failure is logged, in-app alert stands
        log.warning("email delivery failed: %s", exc)


def _send_sms(db, alert):
    gateway = config_store.get_setting(db, "sms_gateway")
    if not gateway:
        return
    try:
        req = urllib.request.Request(
            gateway,
            data=json.dumps({"text": f"[{alert.severity}] {alert.message}"}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=5)
    except Exception as exc:
        log.warning("sms delivery failed: %s", exc)


def _send_webhook(db, alert):
    url = config_store.get_setting(db, "webhook_url")
    if not url:
        return
    secret = config_store.get_setting(db, "webhook_secret") or ""
    payload = json.dumps({
        "type": alert.type, "severity": alert.severity,
        "message": alert.message, "related_type": alert.related_type,
        "related_id": alert.related_id, "created_at": alert.created_at.isoformat(),
    }).encode()
    sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    try:
        req = urllib.request.Request(
            url, data=payload, method="POST",
            headers={"Content-Type": "application/json",
                     "X-NPRS-Signature": f"sha256={sig}"})
        urllib.request.urlopen(req, timeout=5)
    except Exception as exc:
        log.warning("webhook delivery failed: %s", exc)


def dispatch(db, alert):
    channels = (config_store.get_setting(db, "alert_channels") or {}).get(alert.severity, ["inapp"])
    if "email" in channels:
        _send_email(db, alert)
    if "sms" in channels:
        _send_sms(db, alert)
    if "webhook" in channels:
        _send_webhook(db, alert)
