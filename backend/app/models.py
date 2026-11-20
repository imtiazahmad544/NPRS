"""Physical data model — implements the 14 logical entities of SRS §3.4
(SDS §4.1). UUID primary keys for events, sessions, images and audit
entries (DB-02); all times UTC (DB-04); events are immutable versions
linked by parent_id (FR-LOG-10, SDS DD-08).
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, Text, ForeignKey, Index,
)
from sqlalchemy.orm import relationship
from .db import Base


def utcnow():
    return datetime.now(timezone.utc)


def new_uuid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=new_uuid)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    password_history = Column(Text, default="[]")  # JSON list of previous hashes (FR-SEC-10)
    full_name = Column(String, nullable=False)
    email = Column(String, default="")
    phone = Column(String, default="")
    role = Column(String, nullable=False)  # one role per user (SRS §5.4 rule 1)
    status = Column(String, default="active")  # active | disabled
    mfa_secret = Column(String, default="")
    mfa_enabled = Column(Boolean, default=False)
    must_change_password = Column(Boolean, default=False)
    failed_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    last_login = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class AuthSession(Base):
    """Server-side session behind the short-lived access token (FR-SEC-04/12)."""
    __tablename__ = "auth_sessions"
    id = Column(String, primary_key=True, default=new_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    last_activity = Column(DateTime(timezone=True), default=utcnow)
    expires_abs = Column(DateTime(timezone=True), nullable=False)  # created + 12 h
    revoked = Column(Boolean, default=False)
    refresh_hash = Column(String, default="")


class Camera(Base):
    __tablename__ = "cameras"
    id = Column(String, primary_key=True, default=new_uuid)
    name = Column(String, nullable=False)
    site = Column(String, default="Main Campus")
    gate = Column(String, default="Main Gate")
    lane = Column(String, default="Lane 1")
    role = Column(String, nullable=False)  # Entry | Exit | Bidirectional
    stream_url = Column(String, default="")
    credentials_enc = Column(String, default="")
    roi = Column(Text, default="[]")
    virtual_line = Column(Text, default="{}")
    status = Column(String, default="online")  # online | offline | degraded | disabled
    edge_node = Column(String, default="Edge Node 1")
    last_frame_at = Column(DateTime(timezone=True), nullable=True)
    last_outage_start = Column(DateTime(timezone=True), nullable=True)


class CameraOutage(Base):
    __tablename__ = "camera_outages"
    id = Column(String, primary_key=True, default=new_uuid)
    camera_id = Column(String, ForeignKey("cameras.id"), index=True)
    started_at = Column(DateTime(timezone=True), default=utcnow)
    ended_at = Column(DateTime(timezone=True), nullable=True)


class Vehicle(Base):
    """Registry record (FR-REG-01). Soft deletion keeps history (FR-REG-07)."""
    __tablename__ = "vehicles"
    id = Column(String, primary_key=True, default=new_uuid)
    plate_normalised = Column(String, nullable=False, index=True)
    plate_display = Column(String, nullable=False)
    type = Column(String, default="car")
    make = Column(String, default="")
    model = Column(String, default="")
    colour = Column(String, default="")
    owner_name = Column(String, default="")
    organisation = Column(String, default="")
    contact = Column(String, default="")
    category = Column(String, default="Staff")
    valid_from = Column(DateTime(timezone=True), nullable=True)
    valid_to = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, default="Active")  # Active | Suspended | Blacklisted
    remarks = Column(String, default="")
    deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class VisitSession(Base):
    __tablename__ = "visit_sessions"
    id = Column(String, primary_key=True, default=new_uuid)
    plate_normalised = Column(String, nullable=False, index=True)
    vehicle_id = Column(String, ForeignKey("vehicles.id"), nullable=True)
    entry_event_id = Column(String, nullable=True)
    exit_event_id = Column(String, nullable=True)
    entry_ts = Column(DateTime(timezone=True), nullable=False)
    exit_ts = Column(DateTime(timezone=True), nullable=True)
    dwell_seconds = Column(Integer, nullable=True)
    state = Column(String, default="Open")  # Open | Closed | Unclosed | Closed Manually
    purpose = Column(String, default="")
    overstay_alerted = Column(Boolean, default=False)


class Event(Base):
    __tablename__ = "vehicle_events"
    id = Column(String, primary_key=True, default=new_uuid)
    version = Column(Integer, default=1)
    parent_id = Column(String, nullable=True, index=True)
    superseded = Column(Boolean, default=False)  # a newer version exists
    edge_uuid = Column(String, unique=True, nullable=True)  # ingest dedupe (SDS DD-09)
    event_type = Column(String, nullable=False)  # Entry | Exit
    ts = Column(DateTime(timezone=True), nullable=False, index=True)
    camera_id = Column(String, ForeignKey("cameras.id"), nullable=True)
    vehicle_id = Column(String, ForeignKey("vehicles.id"), nullable=True)
    plate_raw = Column(String, default="")
    plate_normalised = Column(String, default="", index=True)
    confidence = Column(Float, default=0.0)
    vehicle_class = Column(String, default="car")
    class_confidence = Column(Float, default=1.0)
    status = Column(String, default="UNKNOWN")  # Known | UNKNOWN
    plate_status = Column(String, default="Accepted")  # Accepted | Needs Review | UNREADABLE | No Plate Detected
    flags = Column(Text, default="[]")  # JSON list
    candidates = Column(Text, default="[]")  # JSON list of candidate vehicle ids/plates
    purpose = Column(String, default="")
    visitor_name = Column(String, default="")
    visitor_contact = Column(String, default="")
    person_visited = Column(String, default="")
    model_version = Column(String, default="")
    manual = Column(Boolean, default=False)
    discarded = Column(Boolean, default=False)
    session_id = Column(String, ForeignKey("visit_sessions.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_events_plate_ts", "plate_normalised", "ts"),
    )


class EventImage(Base):
    __tablename__ = "event_images"
    id = Column(String, primary_key=True, default=new_uuid)
    event_id = Column(String, ForeignKey("vehicle_events.id"), index=True)
    kind = Column(String, nullable=False)  # full | plate
    path = Column(String, nullable=False)
    sha256 = Column(String, nullable=False)
    width = Column(Integer, default=0)
    height = Column(Integer, default=0)
    captured_ts = Column(DateTime(timezone=True), default=utcnow)


class ReviewTask(Base):
    __tablename__ = "review_tasks"
    id = Column(String, primary_key=True, default=new_uuid)
    event_id = Column(String, ForeignKey("vehicle_events.id"), index=True)
    reason = Column(String, nullable=False)
    state = Column(String, default="open")  # open | resolved | escalated
    assigned_user = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(String, nullable=True)
    resolution = Column(String, default="")
    reason_text = Column(String, default="")
    escalated = Column(Boolean, default=False)


class Alert(Base):
    __tablename__ = "alerts"
    id = Column(String, primary_key=True, default=new_uuid)
    type = Column(String, nullable=False, index=True)
    severity = Column(String, default="Warning")  # Critical | Warning | Information
    message = Column(String, nullable=False)
    related_type = Column(String, default="")
    related_id = Column(String, default="")
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)
    ack_by = Column(String, nullable=True)
    ack_at = Column(DateTime(timezone=True), nullable=True)
    last_notified_at = Column(DateTime(timezone=True), default=utcnow)


class PurposeOption(Base):
    __tablename__ = "purpose_options"
    id = Column(String, primary_key=True, default=new_uuid)
    label = Column(String, nullable=False)
    active = Column(Boolean, default=True)
    default_for_category = Column(String, nullable=True)


class PlateFormat(Base):
    __tablename__ = "plate_formats"
    id = Column(String, primary_key=True, default=new_uuid)
    region = Column(String, nullable=False)
    regex = Column(String, nullable=False)
    example = Column(String, default="")
    active = Column(Boolean, default=True)


class ConfigSetting(Base):
    __tablename__ = "config_settings"
    key = Column(String, primary_key=True)
    value = Column(Text, nullable=False)  # JSON-encoded value
    changed_by = Column(String, default="")
    changed_at = Column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    """Append-only, hash-chained (FR-AUD-01..05, SDS §6.7)."""
    __tablename__ = "audit_log"
    id = Column(String, primary_key=True, default=new_uuid)
    ts = Column(DateTime(timezone=True), default=utcnow, index=True)
    user_id = Column(String, nullable=True)
    username = Column(String, default="")
    role = Column(String, default="")
    source_ip = Column(String, default="")
    action = Column(String, nullable=False, index=True)
    object_type = Column(String, default="")
    object_id = Column(String, default="")
    prev_value = Column(Text, default="")
    new_value = Column(Text, default="")
    result = Column(String, default="success")
    prev_hash = Column(String, default="")
    hash = Column(String, default="")


class LegalHold(Base):
    __tablename__ = "legal_holds"
    id = Column(String, primary_key=True, default=new_uuid)
    event_id = Column(String, ForeignKey("vehicle_events.id"), index=True)
    placed_by = Column(String, default="")
    placed_at = Column(DateTime(timezone=True), default=utcnow)
    released_by = Column(String, nullable=True)
    released_at = Column(DateTime(timezone=True), nullable=True)
    reason = Column(String, default="")
