"""Core business rules: ingest, matching, sessions, review, alerts, jobs.

Implements SDS components C-06 (matching), C-07 (event logging and
sessions), C-09 (review), C-13 (alerts) and C-16 (retention), and the
algorithms of SDS §6. All rules come from SRS-NPRS-001; section numbers
are cited at each rule.
"""
import base64
import difflib
import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone

from . import models, config_store, notify

IMAGE_DIR = os.environ.get("NPRS_IMAGE_DIR", "./data/images")


def utcnow():
    return datetime.now(timezone.utc)


def _aware(dt):
    """SQLite returns naive datetimes; normalise DB values to aware UTC
    before comparing them with freshly generated timestamps."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ---------------------------------------------------------------- text utils

def normalise_plate(text: str) -> str:
    """FR-OCR-04: upper case, remove spaces, hyphens, punctuation."""
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


# Characters a single-stroke misread commonly confuses (FR-OCR-05, UN-47).
_AMBIGUOUS = {"0": "O", "O": "0", "1": "I", "I": "1", "8": "B", "B": "8",
              "5": "S", "S": "5", "2": "Z", "Z": "2", "6": "G", "G": "6"}


def edit_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    la, lb = len(a), len(b)
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        for j in range(1, lb + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1,
                         prev[j - 1] + (0 if a[i - 1] == b[j - 1] else 1))
        prev = cur
    return prev[lb]


def is_candidate(a: str, b: str) -> bool:
    """SDS §6.4: edit distance exactly 1, or equal after ambiguity folding."""
    if not a or not b:
        return False
    if edit_distance(a, b) == 1:
        return True
    fold = lambda s: "".join(_AMBIGUOUS.get(c, c) if c in "0O" else c for c in s)
    fa = "".join("0" if c in "O0" else "1" if c in "I1" else c for c in a)
    fb = "".join("0" if c in "O0" else "1" if c in "I1" else c for c in b)
    return fa == fb


# ---------------------------------------------------------------- alerts

def raise_alert(db, type_, severity, message, related_type="", related_id="", dispatch=True):
    alert = models.Alert(type=type_, severity=severity, message=message,
                         related_type=related_type, related_id=related_id)
    db.add(alert)
    db.flush()
    if dispatch:
        notify.dispatch(db, alert)
    return alert


# ---------------------------------------------------------------- images

def store_image(db, event, kind, data_b64, captured_ts):
    raw = base64.b64decode(data_b64)
    digest = hashlib.sha256(raw).hexdigest()
    day = captured_ts.strftime("%Y/%m/%d")
    rel = f"{day}/{event.id}-{kind}.jpg"
    path = os.path.join(IMAGE_DIR, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(raw)
    width = height = 0
    try:
        from PIL import Image
        import io
        with Image.open(io.BytesIO(raw)) as im:
            width, height = im.size
    except Exception:
        pass
    img = models.EventImage(event_id=event.id, kind=kind, path=rel,
                            sha256=digest, width=width, height=height,
                            captured_ts=captured_ts)
    db.add(img)
    db.flush()
    return img


def verify_image_hash(img) -> bool:
    path = os.path.join(IMAGE_DIR, img.path)
    if not os.path.exists(path):
        return False
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest() == img.sha256


# ---------------------------------------------------------------- matching

def find_candidates(db, plate_normalised):
    """Active registry records at edit distance 1 (FR-REG-04)."""
    if not plate_normalised:
        return []
    vehicles = db.query(models.Vehicle).filter_by(deleted=False).all()
    out = []
    for v in vehicles:
        if v.plate_normalised != plate_normalised and is_candidate(plate_normalised, v.plate_normalised):
            out.append(v)
    out.sort(key=lambda v: difflib.SequenceMatcher(None, plate_normalised, v.plate_normalised).ratio(),
             reverse=True)
    return out[:5]


# ---------------------------------------------------------------- sessions

def _open_session(db, plate_normalised):
    return (db.query(models.VisitSession)
            .filter_by(plate_normalised=plate_normalised, state="Open")
            .order_by(models.VisitSession.entry_ts.desc()).first())


def _apply_session_rules(db, event):
    """FR-LOG-06/07/08 + FR-POV-05. Sets event.session_id."""
    if event.event_type == "Entry":
        existing = _open_session(db, event.plate_normalised)
        if existing:
            # Repeated entry: earlier session stays open, flagged Unclosed.
            existing.state = "Unclosed"
            event.flags = _add_flag(event.flags, "Repeated Entry")
            raise_alert(db, "Repeated Entry", "Warning",
                        f"Plate {event.plate_normalised} entered again while a visit was still open.",
                        "event", event.id)
        session = models.VisitSession(
            plate_normalised=event.plate_normalised, vehicle_id=event.vehicle_id,
            entry_event_id=event.id, entry_ts=event.ts, state="Open",
            purpose=event.purpose or "")
        db.add(session)
        db.flush()
        event.session_id = session.id
    else:  # Exit
        session = _open_session(db, event.plate_normalised)
        if session is None:
            event.flags = _add_flag(event.flags, "Exit Without Entry")
            raise_alert(db, "Exit Without Entry", "Warning",
                        f"Plate {event.plate_normalised} exited with no open visit.",
                        "event", event.id)
            return
        session.exit_event_id = event.id
        session.exit_ts = event.ts
        session.dwell_seconds = int((event.ts - _aware(session.entry_ts)).total_seconds())
        session.state = "Closed"
        if session.purpose and not event.purpose:
            event.purpose = session.purpose  # exit inherits the visit purpose
        event.session_id = session.id
        db.flush()


def _add_flag(flags_json, flag):
    flags = json.loads(flags_json or "[]")
    if flag not in flags:
        flags.append(flag)
    return json.dumps(flags)


# ---------------------------------------------------------------- ingest

def create_event_from_package(db, pkg, push=None):
    """Create (or de-duplicate) an event from an edge package.

    pkg keys: edge_uuid, camera_id, ts (ISO), direction, plate_raw,
    plate_normalised, confidence, vehicle_class, class_confidence,
    no_plate (bool), images: [{kind, data_b64}], model_version.
    Returns (event, created: bool). Implements SDS §6.5 (Appendix B.3).
    """
    # 1. Idempotency: a resent package returns the stored event (DD-09).
    if pkg.get("edge_uuid"):
        existing = db.query(models.Event).filter_by(edge_uuid=pkg["edge_uuid"]).first()
        if existing:
            return existing, False

    ts = pkg["ts"]
    if isinstance(ts, str):
        ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)

    camera = db.query(models.Camera).filter_by(id=pkg["camera_id"]).first()
    if camera is None:
        raise ValueError("Unknown camera.")

    # 2. Duplicate window: same plate+camera inside the window merges (FR-LOG-09).
    plate_norm = normalise_plate(pkg.get("plate_normalised") or pkg.get("plate_raw") or "")
    window = int(config_store.get_setting(db, "duplicate_window_seconds"))
    if plate_norm:
        recent = (db.query(models.Event)
                  .filter_by(camera_id=camera.id, plate_normalised=plate_norm, discarded=False)
                  .filter(models.Event.ts >= ts - timedelta(seconds=window),
                          models.Event.ts <= ts)
                  .order_by(models.Event.ts.desc()).first())
        if recent:
            for img in pkg.get("images", []):
                store_image(db, recent, img["kind"], img["data_b64"], ts)
            db.commit()
            return recent, False

    # 3. Event type from camera role or direction (FR-LOG-01).
    if camera.role == "Entry":
        event_type = "Entry"
    elif camera.role == "Exit":
        event_type = "Exit"
    else:
        event_type = "Entry" if pkg.get("direction") == "inbound" else "Exit"

    confidence = float(pkg.get("confidence") or 0.0)
    accept_t = float(config_store.get_setting(db, "accept_threshold"))
    review_t = float(config_store.get_setting(db, "review_threshold"))
    no_plate = bool(pkg.get("no_plate"))

    event = models.Event(
        edge_uuid=pkg.get("edge_uuid"), event_type=event_type, ts=ts,
        camera_id=camera.id, plate_raw=pkg.get("plate_raw") or "",
        plate_normalised=plate_norm, confidence=confidence,
        vehicle_class=pkg.get("vehicle_class") or "other",
        class_confidence=float(pkg.get("class_confidence") or 1.0),
        model_version=pkg.get("model_version") or "",
        status="UNKNOWN",
    )
    db.add(event)
    db.flush()

    # 4. Confidence band (FR-OCR-07).
    reasons = []
    if no_plate:
        event.plate_status = "No Plate Detected"
        reasons.append("No Plate Detected")
    elif confidence < review_t:
        event.plate_status = "UNREADABLE"
        reasons.append("Unreadable Plate")
    elif confidence < accept_t:
        event.plate_status = "Needs Review"
        reasons.append("Low Confidence")
    else:
        event.plate_status = "Accepted"

    # 5. Exact match only (FR-REG-03); candidates never auto-accept (FR-REG-04).
    vehicle = None
    if plate_norm:
        vehicle = (db.query(models.Vehicle)
                   .filter_by(plate_normalised=plate_norm, deleted=False).first())
    if vehicle:
        event.vehicle_id = vehicle.id
        event.status = "Known"
        if vehicle.valid_to and _aware(vehicle.valid_to) < ts:
            event.flags = _add_flag(event.flags, "Expired Registration")
            raise_alert(db, "Expired Registration", "Warning",
                        f"Registered vehicle {plate_norm} has an expired registration.",
                        "event", event.id)
        if vehicle.status in ("Suspended", "Blacklisted"):
            raise_alert(db, "Blacklisted Vehicle" if vehicle.status == "Blacklisted" else "Suspended Vehicle",
                        "Critical",
                        f"{vehicle.status} vehicle {plate_norm} was detected at {camera.gate} {camera.lane}.",
                        "event", event.id)
        if (pkg.get("vehicle_class") or "other") != "other" and vehicle.type != (pkg.get("vehicle_class") or ""):
            event.flags = _add_flag(event.flags, "Type Mismatch")
    else:
        cands = find_candidates(db, plate_norm)
        if cands:
            event.candidates = json.dumps(
                [{"vehicle_id": c.id, "plate": c.plate_display} for c in cands])
            reasons.append("Candidate Match")

    if float(pkg.get("class_confidence") or 1.0) < float(config_store.get_setting(db, "class_confidence_review")):
        reasons.append("Low Class Confidence")

    # 6. Sessions and flags (FR-LOG-06/07/08).
    if plate_norm:
        _apply_session_rules(db, event)

    # 7. Images, then review task if anything needs a person (FR-REV-01).
    for img in pkg.get("images", []):
        store_image(db, event, img["kind"], img["data_b64"], ts)

    if reasons:
        if event.plate_status == "Accepted":
            event.plate_status = "Needs Review"
        task = models.ReviewTask(event_id=event.id, reason=", ".join(reasons))
        db.add(task)

    db.flush()
    if push:
        push(event)
    return event, True


# ---------------------------------------------------------------- review

def _event_to_dict(db, event, include_vehicle=True):
    cam = db.query(models.Camera).filter_by(id=event.camera_id).first() if event.camera_id else None
    veh = db.query(models.Vehicle).filter_by(id=event.vehicle_id).first() if event.vehicle_id else None
    images = db.query(models.EventImage).filter_by(event_id=event.id).all()
    return {
        "id": event.id, "version": event.version, "parent_id": event.parent_id,
        "event_type": event.event_type, "ts": event.ts.isoformat(),
        "camera_id": event.camera_id,
        "camera_name": cam.name if cam else "", "gate": cam.gate if cam else "",
        "lane": cam.lane if cam else "",
        "plate_raw": event.plate_raw, "plate_normalised": event.plate_normalised,
        "plate_display": (veh.plate_display if veh else event.plate_raw or event.plate_normalised),
        "confidence": event.confidence, "vehicle_class": event.vehicle_class,
        "class_confidence": event.class_confidence,
        "status": event.status, "plate_status": event.plate_status,
        "flags": json.loads(event.flags or "[]"),
        "candidates": json.loads(event.candidates or "[]"),
        "purpose": event.purpose, "visitor_name": event.visitor_name,
        "visitor_contact": event.visitor_contact, "person_visited": event.person_visited,
        "vehicle_id": event.vehicle_id,
        "vehicle": ({"owner_name": veh.owner_name, "category": veh.category,
                     "type": veh.type, "make": veh.make, "model": veh.model,
                     "colour": veh.colour, "status": veh.status} if veh and include_vehicle else None),
        "manual": event.manual, "discarded": event.discarded,
        "session_id": event.session_id, "model_version": event.model_version,
        "images": [{"id": i.id, "kind": i.kind, "sha256": i.sha256,
                    "width": i.width, "height": i.height} for i in images],
    }


def resolve_review(db, task, action, user, *, plate_text=None, reason_text=""):
    """FR-REV-03/04: confirm | correct | select_candidate | mark_unknown | discard.
    Corrections create a new version; the original is never edited (DD-08)."""
    event = db.query(models.Event).filter_by(id=task.event_id).first()
    if action == "discard":
        if not reason_text.strip():
            raise ValueError("A reason is required to discard an event.")
        event.discarded = True
        db.flush()
        _close_task(db, task, user, "discarded", reason_text)
        return event
    if action == "confirm":
        event.plate_status = "Accepted"
        db.flush()
        _close_task(db, task, user, "confirmed", reason_text)
        return event
    if action == "mark_unknown":
        event.status = "UNKNOWN"
        event.vehicle_id = None
        event.plate_status = "Accepted"
        db.flush()
        _close_task(db, task, user, "marked unknown", reason_text)
        return event
    if action in ("correct", "select_candidate"):
        new_plate_raw = plate_text or ""
        new_norm = normalise_plate(new_plate_raw)
        if not new_norm:
            raise ValueError("Enter the correct plate text.")
        new_event = models.Event(
            version=event.version + 1, parent_id=event.id,
            event_type=event.event_type, ts=event.ts, camera_id=event.camera_id,
            plate_raw=new_plate_raw, plate_normalised=new_norm,
            confidence=1.0, vehicle_class=event.vehicle_class,
            class_confidence=event.class_confidence, status="UNKNOWN",
            plate_status="Accepted", flags=event.flags, purpose=event.purpose,
            visitor_name=event.visitor_name, visitor_contact=event.visitor_contact,
            person_visited=event.person_visited, model_version=event.model_version,
            manual=event.manual, session_id=event.session_id,
        )
        vehicle = (db.query(models.Vehicle)
                   .filter_by(plate_normalised=new_norm, deleted=False).first())
        if vehicle:
            new_event.vehicle_id = vehicle.id
            new_event.status = "Known"
        db.add(new_event)
        db.flush()
        # Move images to the new version so evidence stays with the live record.
        for img in db.query(models.EventImage).filter_by(event_id=event.id).all():
            img.event_id = new_event.id
        # Re-point session linkage from the old version to the new one.
        if event.session_id:
            sess = db.query(models.VisitSession).filter_by(id=event.session_id).first()
            if sess:
                if sess.entry_event_id == event.id:
                    sess.entry_event_id = new_event.id
                if sess.exit_event_id == event.id:
                    sess.exit_event_id = new_event.id
                sess.vehicle_id = new_event.vehicle_id
                sess.plate_normalised = new_norm
        event.superseded = True
        db.flush()
        _close_task(db, task, user, f"corrected to {new_plate_raw}", reason_text)
        return new_event
    raise ValueError(f"Unknown review action: {action}")


def _close_task(db, task, user, resolution, reason_text):
    task.state = "resolved"
    task.resolved_at = utcnow()
    task.resolved_by = user.username if user else ""
    task.resolution = resolution
    task.reason_text = reason_text or ""
    db.flush()


def create_manual_event(db, user, *, plate_text, vehicle_class, event_type, ts, camera_id,
                        purpose="", past_reason=""):
    """FR-REV-06: manual entry; a past time requires a reason."""
    if ts < utcnow() - timedelta(minutes=1) and not past_reason.strip():
        raise ValueError("This time is in the past. Give a reason, for example a camera outage.")
    event = models.Event(
        event_type=event_type, ts=ts, camera_id=camera_id,
        plate_raw=plate_text, plate_normalised=normalise_plate(plate_text),
        confidence=1.0, vehicle_class=vehicle_class or "car", class_confidence=1.0,
        status="UNKNOWN", plate_status="Accepted", manual=True,
        flags=json.dumps(["Manual"]), purpose=purpose or "",
    )
    db.add(event)
    db.flush()
    vehicle = (db.query(models.Vehicle)
               .filter_by(plate_normalised=event.plate_normalised, deleted=False).first())
    if vehicle:
        event.vehicle_id = vehicle.id
        event.status = "Known"
    if event.plate_normalised:
        _apply_session_rules(db, event)
    db.flush()
    return event


# ---------------------------------------------------------------- jobs

def run_periodic_jobs(db):
    """Review escalation (FR-REV-05), camera offline (FR-CAM-04),
    overstay (FR-LOG-14), unclosed sweep, storage check. Safe to call often."""
    now = utcnow()
    summary = {"escalated": 0, "cameras_offline": 0, "overstays": 0, "unclosed_flagged": 0}

    esc_minutes = int(config_store.get_setting(db, "review_escalation_minutes"))
    for task in db.query(models.ReviewTask).filter_by(state="open").all():
        created = task.created_at
        if created and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if created and (now - created) > timedelta(minutes=esc_minutes) and not task.escalated:
            task.state = "escalated"
            task.escalated = True
            raise_alert(db, "Review Overdue", "Warning",
                        f"A review task ({task.reason}) has waited longer than {esc_minutes} minutes.",
                        "review_task", task.id)
            summary["escalated"] += 1

    for cam in db.query(models.Camera).filter(models.Camera.status != "disabled").all():
        last = cam.last_frame_at
        if last and last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if last and (now - last) > timedelta(seconds=10) and cam.status == "online":
            cam.status = "offline"
            cam.last_outage_start = now
            db.add(models.CameraOutage(camera_id=cam.id, started_at=now))
            raise_alert(db, "Camera Offline", "Warning",
                        f"Camera {cam.name} at {cam.gate} {cam.lane} stopped sending frames.",
                        "camera", cam.id)
            summary["cameras_offline"] += 1

    limits = config_store.get_setting(db, "overstay_limits") or {}
    for sess in db.query(models.VisitSession).filter_by(state="Open").all():
        veh = db.query(models.Vehicle).filter_by(id=sess.vehicle_id).first() if sess.vehicle_id else None
        category = veh.category if veh else None
        limit_h = limits.get(category) if category else None
        entry = sess.entry_ts
        if entry and entry.tzinfo is None:
            entry = entry.replace(tzinfo=timezone.utc)
        if limit_h and entry and (now - entry) > timedelta(hours=float(limit_h)) and not sess.overstay_alerted:
            sess.overstay_alerted = True
            raise_alert(db, "Overstay", "Warning",
                        f"Vehicle {sess.plate_normalised} has been inside longer than the {category} limit of {limit_h} hours.",
                        "session", sess.id)
            summary["overstays"] += 1

    # Storage utilisation check against the image store volume (FR-ALR-01).
    try:
        import shutil
        total, used, _free = shutil.disk_usage(IMAGE_DIR if os.path.exists(IMAGE_DIR) else ".")
        if total and used / total > 0.85:
            recent = (db.query(models.Alert).filter_by(type="Storage High")
                      .order_by(models.Alert.created_at.desc()).first())
            if not recent or (now - (recent.created_at.replace(tzinfo=timezone.utc) if recent.created_at.tzinfo is None else recent.created_at)) > timedelta(hours=6):
                raise_alert(db, "Storage High", "Warning",
                            f"Image storage is {int(used / total * 100)}% full (over the 85% threshold).",
                            "system", "")
                summary["storage_alert"] = 1
    except Exception:
        pass

    db.flush()
    return summary


def run_retention(db, user=None):
    """FR-DAT-01/02/03: purge images past retention, then records;
    legal holds are excluded. Returns counts; the caller audits."""
    now = utcnow()
    img_days = int(config_store.get_setting(db, "image_retention_days"))
    rec_years = int(config_store.get_setting(db, "record_retention_years"))
    held_event_ids = {h.event_id for h in db.query(models.LegalHold)
                      .filter(models.LegalHold.released_at.is_(None)).all()}

    images_purged = 0
    cutoff_img = now - timedelta(days=img_days)
    for img in db.query(models.EventImage).all():
        ev = db.query(models.Event).filter_by(id=img.event_id).first()
        if not ev or ev.id in held_event_ids:
            continue
        ts = ev.ts.replace(tzinfo=timezone.utc) if ev.ts.tzinfo is None else ev.ts
        if ts < cutoff_img:
            path = os.path.join(IMAGE_DIR, img.path)
            if os.path.exists(path):
                os.remove(path)
            db.delete(img)
            images_purged += 1

    events_purged = 0
    cutoff_rec = now - timedelta(days=rec_years * 365)
    for ev in db.query(models.Event).all():
        if ev.id in held_event_ids:
            continue
        ts = ev.ts.replace(tzinfo=timezone.utc) if ev.ts.tzinfo is None else ev.ts
        if ts < cutoff_rec:
            db.query(models.EventImage).filter_by(event_id=ev.id).delete()
            db.query(models.ReviewTask).filter_by(event_id=ev.id).delete()
            db.delete(ev)
            events_purged += 1

    db.flush()
    return {"images_purged": images_purged, "events_purged": events_purged}
