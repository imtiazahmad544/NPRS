"""Operations endpoints: ingest, events, review, dashboard, alerts, sessions."""
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from . import audit, config_store, engine, live, models
from .db import get_db
from .deps import get_current_user, require

router = APIRouter(tags=["ops"])


def _parse_dt(value):
    if not value:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ------------------------------------------------------------------ ingest

class IngestIn(BaseModel):
    edge_uuid: str | None = None
    camera_id: str
    ts: str
    direction: str | None = None
    plate_raw: str = ""
    plate_normalised: str = ""
    confidence: float = 0.0
    vehicle_class: str = "car"
    class_confidence: float = 1.0
    no_plate: bool = False
    images: list = []
    model_version: str = ""


@router.post("/ingest/events")
def ingest_event(body: IngestIn, request: Request, db: DbSession = Depends(get_db)):
    key = request.headers.get("X-Edge-Key", "")
    if key != config_store.get_setting(db, "edge_api_key"):
        raise HTTPException(401, "Edge authentication failed.")
    try:
        event, created = engine.create_event_from_package(
            db, body.model_dump(),
            push=lambda ev: live.broadcast({"type": "event", "event": engine._event_to_dict(db, ev)}))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    db.commit()
    return {"created": created, "event": engine._event_to_dict(db, event)}


class HeartbeatIn(BaseModel):
    camera_id: str
    accelerator: str = ""


@router.post("/ingest/heartbeat")
def ingest_heartbeat(body: HeartbeatIn, request: Request, db: DbSession = Depends(get_db)):
    key = request.headers.get("X-Edge-Key", "")
    if key != config_store.get_setting(db, "edge_api_key"):
        raise HTTPException(401, "Edge authentication failed.")
    cam = db.query(models.Camera).filter_by(id=body.camera_id).first()
    if not cam:
        raise HTTPException(404, "Unknown camera.")
    cam.last_frame_at = engine.utcnow()
    if cam.status == "offline":
        cam.status = "online"
        outage = (db.query(models.CameraOutage)
                  .filter_by(camera_id=cam.id, ended_at=None)
                  .order_by(models.CameraOutage.started_at.desc()).first())
        if outage:
            outage.ended_at = engine.utcnow()
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ events

@router.get("/events")
def list_events(db: DbSession = Depends(get_db), user=Depends(require("event.read")),
                q: str = "", date_from: str = "", date_to: str = "", type: str = "",
                status: str = "", vehicle_class: str = "", camera_id: str = "",
                category: str = "", purpose: str = "", flag: str = "", page: int = 1):
    query = db.query(models.Event).filter_by(discarded=False, superseded=False)
    if q:
        query = query.filter(models.Event.plate_normalised.like(f"%{engine.normalise_plate(q)}%"))
    if date_from:
        query = query.filter(models.Event.ts >= _parse_dt(date_from))
    if date_to:
        query = query.filter(models.Event.ts <= _parse_dt(date_to))
    if type:
        query = query.filter_by(event_type=type)
    if status:
        query = query.filter_by(status=status)
    if vehicle_class:
        query = query.filter_by(vehicle_class=vehicle_class)
    if camera_id:
        query = query.filter_by(camera_id=camera_id)
    if purpose:
        query = query.filter(models.Event.purpose.like(f"%{purpose}%"))
    if flag:
        query = query.filter(models.Event.flags.like(f"%{flag}%"))
    if category:
        ids = [v.id for v in db.query(models.Vehicle).filter_by(category=category).all()]
        query = query.filter(models.Event.vehicle_id.in_(ids))
    total = query.count()
    rows = (query.order_by(models.Event.ts.desc())
            .offset((page - 1) * 50).limit(50).all())
    return {"total": total, "page": page, "page_size": 50,
            "events": [engine._event_to_dict(db, e) for e in rows]}


def _event_or_404(db, event_id):
    event = db.query(models.Event).filter_by(id=event_id).first()
    if not event:
        raise HTTPException(404, "That event no longer exists. Refresh the list and try again.")
    return event


@router.get("/events/{event_id}")
def get_event(event_id: str, db: DbSession = Depends(get_db), user=Depends(require("event.read"))):
    event = _event_or_404(db, event_id)
    data = engine._event_to_dict(db, event)
    # Version history: walk the parent chain and children (FR-RPT-07, FR-LOG-10).
    history = []
    seen = set()
    node = event
    while node and node.parent_id:
        node = db.query(models.Event).filter_by(id=node.parent_id).first()
        if node and node.id not in seen:
            seen.add(node.id)
            history.append(engine._event_to_dict(db, node))
    frontier = [event.id]
    while frontier:
        kids = db.query(models.Event).filter(models.Event.parent_id.in_(frontier)).all()
        frontier = []
        for k in kids:
            if k.id not in seen and k.id != event.id:
                seen.add(k.id)
                history.append(engine._event_to_dict(db, k))
                frontier.append(k.id)
    data["history"] = sorted(history, key=lambda h: h["version"])
    sess = db.query(models.VisitSession).filter_by(id=event.session_id).first() if event.session_id else None
    if sess:
        data["session"] = {"id": sess.id, "state": sess.state,
                           "entry_ts": sess.entry_ts.isoformat(),
                           "exit_ts": sess.exit_ts.isoformat() if sess.exit_ts else None,
                           "dwell_seconds": sess.dwell_seconds}
    return data


@router.get("/events/{event_id}/images/{image_id}")
def get_image(event_id: str, image_id: str, request: Request,
              db: DbSession = Depends(get_db), user=Depends(require("event.image"))):
    img = db.query(models.EventImage).filter_by(id=image_id, event_id=event_id).first()
    if not img:
        raise HTTPException(404, "That image is not available. It may have passed its retention period.")
    if not engine.verify_image_hash(img):
        raise HTTPException(500, "This image failed its integrity check. Tell the System Administrator.")
    audit.write_audit(db, user=user, source_ip=request.state.client_ip,
                      action="image_viewed", object_type="event_image", object_id=img.id)
    db.commit()
    import os
    return FileResponse(os.path.join(engine.IMAGE_DIR, img.path), media_type="image/jpeg")


class PurposeIn(BaseModel):
    purpose: str = ""
    visitor_name: str = ""
    visitor_contact: str = ""
    person_visited: str = ""


@router.put("/events/{event_id}/purpose")
def set_purpose(event_id: str, body: PurposeIn, request: Request,
                db: DbSession = Depends(get_db), user=Depends(require("purpose.edit"))):
    if len(body.purpose) > 250:
        raise HTTPException(400, "Purpose of Visit can be at most 250 characters.")
    event = _event_or_404(db, event_id)
    prev = {"purpose": event.purpose, "visitor_name": event.visitor_name,
            "visitor_contact": event.visitor_contact, "person_visited": event.person_visited}
    event.purpose = body.purpose
    event.visitor_name = body.visitor_name
    event.visitor_contact = body.visitor_contact
    event.person_visited = body.person_visited
    if event.session_id:
        sess = db.query(models.VisitSession).filter_by(id=event.session_id).first()
        if sess:
            sess.purpose = body.purpose
    db.flush()
    audit.write_audit(db, user=user, source_ip=request.state.client_ip,
                      action="purpose_changed", object_type="event", object_id=event.id,
                      prev_value=json.dumps(prev), new_value=json.dumps(body.model_dump()))
    db.commit()
    return engine._event_to_dict(db, event)


# ------------------------------------------------------------------ review

@router.get("/review")
def review_queue(db: DbSession = Depends(get_db), user=Depends(require("review.resolve"))):
    tasks = (db.query(models.ReviewTask)
             .filter(models.ReviewTask.state.in_(["open", "escalated"]))
             .order_by(models.ReviewTask.created_at.asc()).all())
    out = []
    for t in tasks:
        event = db.query(models.Event).filter_by(id=t.event_id).first()
        if not event or event.discarded:
            continue
        out.append({"id": t.id, "reason": t.reason, "state": t.state,
                    "created_at": t.created_at.isoformat(),
                    "event": engine._event_to_dict(db, event)})
    day_start = engine.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    resolved = (db.query(models.ReviewTask)
                .filter(models.ReviewTask.state == "resolved",
                        models.ReviewTask.resolved_at >= day_start)
                .order_by(models.ReviewTask.resolved_at.desc()).all())
    resolved_out = []
    for t in resolved:
        event = db.query(models.Event).filter_by(id=t.event_id).first()
        resolved_out.append({
            "resolved_at": t.resolved_at.isoformat() if t.resolved_at else None,
            "resolved_by": t.resolved_by or "",
            "resolution": t.resolution or "",
            "plate": (event.plate_raw or event.plate_normalised) if event else "—"})
    return {"waiting": len(out), "tasks": out, "resolved_today": resolved_out}


class ResolveIn(BaseModel):
    action: str
    plate_text: str = ""
    reason: str = ""


@router.post("/review/{task_id}/resolve")
def resolve(task_id: str, body: ResolveIn, request: Request,
            db: DbSession = Depends(get_db), user=Depends(get_current_user)):
    perm = {"discard": "event.discard", "correct": "plate.correct",
            "select_candidate": "plate.correct"}.get(body.action, "review.resolve")
    from .rbac import has_permission
    if not has_permission(user.role, perm):
        raise HTTPException(403, "Your role does not include this action.")
    task = db.query(models.ReviewTask).filter_by(id=task_id).first()
    if not task or task.state == "resolved":
        raise HTTPException(404, "That review task is no longer waiting. Refresh the queue.")
    try:
        event = engine.resolve_review(db, task, body.action, user,
                                      plate_text=body.plate_text, reason_text=body.reason)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    audit.write_audit(db, user=user, source_ip=request.state.client_ip,
                      action=f"review_{body.action}", object_type="event",
                      object_id=event.id, new_value=body.plate_text or body.reason)
    db.commit()
    return {"ok": True, "event": engine._event_to_dict(db, event)}


class ManualIn(BaseModel):
    plate_text: str
    vehicle_class: str = "car"
    event_type: str = "Entry"
    ts: str
    camera_id: str
    purpose: str = ""
    past_reason: str = ""


@router.post("/events/manual")
def manual_event(body: ManualIn, request: Request,
                 db: DbSession = Depends(get_db), user=Depends(require("event.create_manual"))):
    if len(body.purpose) > 250:
        raise HTTPException(400, "Purpose of Visit can be at most 250 characters.")
    try:
        event = engine.create_manual_event(
            db, user, plate_text=body.plate_text, vehicle_class=body.vehicle_class,
            event_type=body.event_type, ts=_parse_dt(body.ts), camera_id=body.camera_id,
            purpose=body.purpose, past_reason=body.past_reason)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    audit.write_audit(db, user=user, source_ip=request.state.client_ip,
                      action="manual_event_created", object_type="event", object_id=event.id,
                      new_value=body.past_reason)
    db.commit()
    return engine._event_to_dict(db, event)


# ------------------------------------------------------------------ dashboard / live

@router.get("/dashboard/summary")
def dashboard(db: DbSession = Depends(get_db), user=Depends(require("dashboard.view"))):
    now = engine.utcnow()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    base = db.query(models.Event).filter_by(discarded=False, superseded=False)
    inside = db.query(models.VisitSession).filter_by(state="Open").count()
    by_category = {}
    for sess in db.query(models.VisitSession).filter_by(state="Open").all():
        veh = db.query(models.Vehicle).filter_by(id=sess.vehicle_id).first() if sess.vehicle_id else None
        cat = veh.category if veh else "Unknown"
        by_category[cat] = by_category.get(cat, 0) + 1
    cameras = db.query(models.Camera).all()
    return {
        "inside_now": inside,
        "entries_today": base.filter(models.Event.ts >= start, models.Event.event_type == "Entry").count(),
        "exits_today": base.filter(models.Event.ts >= start, models.Event.event_type == "Exit").count(),
        "unknown_today": base.filter(models.Event.ts >= start, models.Event.status == "UNKNOWN").count(),
        "reviews_waiting": db.query(models.ReviewTask).filter(
            models.ReviewTask.state.in_(["open", "escalated"])).count(),
        "active_alerts": db.query(models.Alert).filter(models.Alert.ack_by.is_(None)).count(),
        "inside_by_category": by_category,
        "cameras": [{"id": c.id, "name": c.name, "gate": c.gate, "lane": c.lane,
                     "role": c.role, "status": c.status, "edge_node": c.edge_node} for c in cameras],
    }


@router.get("/live/events")
def live_events(db: DbSession = Depends(get_db), user=Depends(require("live.view"))):
    rows = (db.query(models.Event).filter_by(discarded=False, superseded=False)
            .order_by(models.Event.ts.desc()).limit(50).all())
    return {"events": [engine._event_to_dict(db, e) for e in rows]}


# ------------------------------------------------------------------ alerts

@router.get("/alerts")
def list_alerts(db: DbSession = Depends(get_db), user=Depends(require("dashboard.view")),
                type: str = "", severity: str = "", acked: str = ""):
    query = db.query(models.Alert)
    if type:
        query = query.filter_by(type=type)
    if severity:
        query = query.filter_by(severity=severity)
    if acked == "yes":
        query = query.filter(models.Alert.ack_by.isnot(None))
    elif acked == "no":
        query = query.filter(models.Alert.ack_by.is_(None))
    rows = query.order_by(models.Alert.created_at.desc()).limit(200).all()
    return {"alerts": [{"id": a.id, "type": a.type, "severity": a.severity,
                        "message": a.message, "created_at": a.created_at.isoformat(),
                        "ack_by": a.ack_by, "ack_at": a.ack_at.isoformat() if a.ack_at else None,
                        "related_type": a.related_type, "related_id": a.related_id} for a in rows]}


@router.post("/alerts/{alert_id}/ack")
def ack_alert(alert_id: str, request: Request, db: DbSession = Depends(get_db),
              user=Depends(require("alert.acknowledge"))):
    alert = db.query(models.Alert).filter_by(id=alert_id).first()
    if not alert:
        raise HTTPException(404, "That alert no longer exists.")
    alert.ack_by = user.username
    alert.ack_at = engine.utcnow()
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ sessions

@router.get("/sessions/inside")
def inside_now(db: DbSession = Depends(get_db), user=Depends(require("event.read"))):
    rows = db.query(models.VisitSession).filter_by(state="Open").order_by(
        models.VisitSession.entry_ts.asc()).all()
    out = []
    for s in rows:
        veh = db.query(models.Vehicle).filter_by(id=s.vehicle_id).first() if s.vehicle_id else None
        out.append({"id": s.id, "plate": veh.plate_display if veh else s.plate_normalised,
                    "category": veh.category if veh else "Unknown",
                    "entry_ts": s.entry_ts.isoformat(), "purpose": s.purpose})
    return {"inside": out}


class CloseSessionIn(BaseModel):
    reason: str = ""


@router.post("/sessions/{session_id}/close")
def close_session(session_id: str, body: CloseSessionIn, request: Request,
                  db: DbSession = Depends(get_db), user=Depends(require("session.close_manual"))):
    sess = db.query(models.VisitSession).filter_by(id=session_id).first()
    if not sess or sess.state not in ("Open", "Unclosed"):
        raise HTTPException(404, "That visit is not open.")
    sess.state = "Closed Manually"
    sess.exit_ts = engine.utcnow()
    sess.dwell_seconds = int((sess.exit_ts - engine._aware(sess.entry_ts)).total_seconds()) if sess.entry_ts else None
    db.flush()
    audit.write_audit(db, user=user, source_ip=request.state.client_ip,
                      action="session_closed_manually", object_type="session",
                      object_id=sess.id, new_value=body.reason)
    db.commit()
    return {"ok": True}
