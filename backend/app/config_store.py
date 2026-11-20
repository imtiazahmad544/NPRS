"""System configuration (FR-CFG-01..04, SDS C-15).

Settings are typed data with allowed ranges, validated on change, applied
without restart, and audited by the caller. Plate formats are data, not
code (FR-OCR-05).
"""
import json
from . import models

# key -> (default, min, max, description)  (min/max None = free value)
SETTINGS = {
    "accept_threshold": (0.85, 0.50, 0.99, "Plate confidence at/above which a reading is accepted (FR-OCR-07)"),
    "review_threshold": (0.50, 0.10, 0.84, "Below this confidence a plate is UNREADABLE (FR-OCR-07)"),
    "duplicate_window_seconds": (60, 5, 600, "Same plate + camera within this window is one event (FR-LOG-09)"),
    "review_escalation_minutes": (15, 1, 240, "Unresolved review escalates to the Security Supervisor (FR-REV-05)"),
    "image_retention_days": (90, 1, 3650, "Event images kept this long (FR-DAT-01)"),
    "record_retention_years": (2, 1, 50, "Event records kept this long (FR-DAT-01)"),
    "site_timezone": ("Asia/Karachi", None, None, "Display time zone (UI-08)"),
    "notice_text": ("This gate is monitored by cameras. Vehicle images and plate numbers are recorded for access control and premises security.", None, None, "Notice on the Sign In screen and reports (LEG-03)"),
    "overstay_limits": ({"Contractor": 8, "Pre-registered Visitor": 12}, None, None, "Overstay limit in hours per category (FR-LOG-14)"),
    "alert_channels": ({"Critical": ["inapp", "email", "sms"], "Warning": ["inapp", "email"], "Information": ["inapp"]}, None, None, "Delivery channels per severity (FR-ALR-03)"),
    "smtp_server": ("", None, None, "SMTP server for email alerts (SW-04)"),
    "sms_gateway": ("", None, None, "SMS gateway HTTPS endpoint (SW-05)"),
    "webhook_url": ("", None, None, "Webhook endpoint for signed event/alert delivery (SW-06)"),
    "webhook_secret": ("", None, None, "HMAC secret for webhook signatures (SW-06)"),
    "ntp_port": (123, 1, 65535, "NTP UDP port (CM-04)"),
    "edge_api_key": ("dev-edge-key-change-in-production", None, None, "Shared key for edge ingest in development; mTLS in production (CM-02)"),
    "class_confidence_review": (0.60, 0.0, 1.0, "Vehicle class confidence below this sends the event to review (FR-REV-01)"),
    "camera_quality_conf_floor": (0.55, 0.0, 1.0, "Sustained average confidence below this raises a camera quality alert (UN-08)"),
}


def get_setting(db, key):
    row = db.query(models.ConfigSetting).filter_by(key=key).first()
    if row:
        try:
            return json.loads(row.value)
        except Exception:
            return row.value
    return SETTINGS.get(key, (None,))[0]


def set_setting(db, key, value, changed_by=""):
    if key not in SETTINGS:
        raise ValueError(f"Unknown setting: {key}")
    default, lo, hi, _desc = SETTINGS[key]
    if lo is not None and isinstance(value, (int, float)) and not isinstance(value, bool):
        if value < lo or value > hi:
            raise ValueError(f"{key} must be between {lo} and {hi}.")
    if key == "review_threshold":
        accept = get_setting(db, "accept_threshold")
        if isinstance(value, (int, float)) and value >= accept:
            raise ValueError("review_threshold must be below accept_threshold.")
    row = db.query(models.ConfigSetting).filter_by(key=key).first()
    if not row:
        row = models.ConfigSetting(key=key, value=json.dumps(value))
        db.add(row)
    else:
        row.value = json.dumps(value)
    row.changed_by = changed_by
    db.flush()
    return value


def all_settings(db):
    return {k: get_setting(db, k) for k in SETTINGS}
