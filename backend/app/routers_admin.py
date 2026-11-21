"""Administration endpoints: registry, cameras, users, configuration,
audit, reports, data protection (SRS §3.1.1 admin set)."""
import base64
import csv
import io
import json
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from . import audit as audit_mod
from . import config_store, engine, models, security
from .db import get_db
from .deps import get_current_user, require

router = APIRouter(tags=["admin"])

CATEGORIES = ["Staff", "Resident", "Student", "Contractor", "Fleet",
              "Pre-registered Visitor", "VIP"]
VEHICLE_TYPES = ["car", "motorcycle", "scooter", "auto-rickshaw", "van",
                 "bus", "truck", "bicycle", "other"]
STATUSES = ["Active", "Suspended", "Blacklisted"]


def _dt(value):
    if not value:
        return None
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _vehicle_dict(v):
    return {"id": v.id, "plate_display": v.plate_display,
            "plate_normalised": v.plate_normalised, "type": v.type,
            "make": v.make, "model": v.model, "colour": v.colour,
            "owner_name": v.owner_name, "organisation": v.organisation,
            "contact": v.contact, "category": v.category,
            "valid_from": v.valid_from.isoformat() if v.valid_from else None,
            "valid_to": v.valid_to.isoformat() if v.valid_to else None,
            "status": v.status, "remarks": v.remarks, "deleted": v.deleted}


# ------------------------------------------------------------------ registry

@router.get("/registry")
def list_registry(db: DbSession = Depends(get_db), user=Depends(require("registry.read")),
                  q: str = "", category: str = "", status: str = "", page: int = 1):
    query = db.query(models.Vehicle).filter_by(deleted=False)
    if q:
        like = f"%{q.upper()}%"
        query = query.filter((models.Vehicle.plate_normalised.like(like)) |
                             (models.Vehicle.owner_name.like(f"%{q}%")))
    if category:
        query = query.filter_by(category=category)
    if status:
        query = query.filter_by(status=status)
    total = query.count()
    rows = query.order_by(models.Vehicle.plate_display).offset((page - 1) * 50).limit(50).all()
    return {"total": total, "page": page, "vehicles": [_vehicle_dict(v) for v in rows]}


class VehicleIn(BaseModel):
    plate_display: str
    type: str = "car"
    make: str = ""
    model: str = ""
    colour: str = ""
    owner_name: str = ""
    organisation: str = ""
    contact: str = ""
    category: str = "Staff"
    valid_from: str | None = None
    valid_to: str | None = None
    status: str = "Active"
    remarks: str = ""


def _validate_vehicle(body: VehicleIn):
    if body.category not in CATEGORIES:
        raise HTTPException(400, f"Category must be one of: {', '.join(CATEGORIES)}.")
    if body.type not in VEHICLE_TYPES:
        raise HTTPException(400, f"Type must be one of: {', '.join(VEHICLE_TYPES)}.")
    if body.status not in STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(STATUSES)}.")
    if not engine.normalise_plate(body.plate_display):
        raise HTTPException(400, "Enter the plate number.")


@router.post("/registry")
def create_vehicle(body: VehicleIn, request: Request, db: DbSession = Depends(get_db),
                   user=Depends(require("registry.write"))):
    _validate_vehicle(body)
    norm = engine.normalise_plate(body.plate_display)
    if db.query(models.Vehicle).filter_by(plate_normalised=norm, deleted=False).first():
        raise HTTPException(400, "This plate is already registered. Edit the existing record instead.")
    v = models.Vehicle(plate_display=body.plate_display, plate_normalised=norm,
                       type=body.type, make=body.make, model=body.model, colour=body.colour,
                       owner_name=body.owner_name, organisation=body.organisation,
                       contact=body.contact, category=body.category,
                       valid_from=_dt(body.valid_from), valid_to=_dt(body.valid_to),
                       status=body.status, remarks=body.remarks)
    db.add(v)
    db.flush()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="vehicle_created", object_type="vehicle", object_id=v.id,
                          new_value=v.plate_display)
    db.commit()
    return _vehicle_dict(v)


@router.put("/registry/{vehicle_id}")
def update_vehicle(vehicle_id: str, body: VehicleIn, request: Request,
                   db: DbSession = Depends(get_db), user=Depends(require("registry.write"))):
    _validate_vehicle(body)
    v = db.query(models.Vehicle).filter_by(id=vehicle_id, deleted=False).first()
    if not v:
        raise HTTPException(404, "That registry record no longer exists.")
    prev = _vehicle_dict(v)
    norm = engine.normalise_plate(body.plate_display)
    clash = db.query(models.Vehicle).filter_by(plate_normalised=norm, deleted=False).first()
    if clash and clash.id != v.id:
        raise HTTPException(400, "Another record already uses this plate.")
    for field in ("plate_display", "type", "make", "model", "colour", "owner_name",
                  "organisation", "contact", "category", "status", "remarks"):
        setattr(v, field, getattr(body, field))
    v.plate_normalised = norm
    v.valid_from = _dt(body.valid_from)
    v.valid_to = _dt(body.valid_to)
    db.flush()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="vehicle_updated", object_type="vehicle", object_id=v.id,
                          prev_value=json.dumps(prev), new_value=json.dumps(_vehicle_dict(v)))
    db.commit()
    return _vehicle_dict(v)


@router.delete("/registry/{vehicle_id}")
def delete_vehicle(vehicle_id: str, request: Request, db: DbSession = Depends(get_db),
                   user=Depends(require("registry.write"))):
    v = db.query(models.Vehicle).filter_by(id=vehicle_id, deleted=False).first()
    if not v:
        raise HTTPException(404, "That registry record no longer exists.")
    v.deleted = True  # soft delete; history keeps referencing it (FR-REG-07)
    db.flush()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="vehicle_deactivated", object_type="vehicle", object_id=v.id)
    db.commit()
    return {"ok": True}


class StatusIn(BaseModel):
    status: str


@router.post("/registry/{vehicle_id}/status")
def set_vehicle_status(vehicle_id: str, body: StatusIn, request: Request,
                       db: DbSession = Depends(get_db), user=Depends(require("registry.status"))):
    if body.status not in STATUSES:
        raise HTTPException(400, f"Status must be one of: {', '.join(STATUSES)}.")
    v = db.query(models.Vehicle).filter_by(id=vehicle_id, deleted=False).first()
    if not v:
        raise HTTPException(404, "That registry record no longer exists.")
    prev = v.status
    v.status = body.status
    db.flush()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="vehicle_status_changed", object_type="vehicle",
                          object_id=v.id, prev_value=prev, new_value=body.status)
    db.commit()
    return _vehicle_dict(v)


@router.get("/registry/export")
def export_registry(request: Request, db: DbSession = Depends(get_db),
                    user=Depends(require("registry.import")), format: str = "csv"):
    rows = db.query(models.Vehicle).filter_by(deleted=False).order_by(
        models.Vehicle.plate_display).all()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="registry_exported", object_type="registry",
                          new_value=format)
    db.commit()
    if format == "xlsx":
        return Response(_xlsx_bytes([_vehicle_dict(v) for v in rows]),
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": "attachment; filename=registry.xlsx"})
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["plate", "type", "make", "model", "colour", "owner", "organisation",
                "contact", "category", "valid_from", "valid_to", "status"])
    for v in rows:
        w.writerow([v.plate_display, v.type, v.make, v.model, v.colour, v.owner_name,
                    v.organisation, v.contact, v.category,
                    v.valid_from.isoformat() if v.valid_from else "",
                    v.valid_to.isoformat() if v.valid_to else "", v.status])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=registry.csv"})


def _xlsx_bytes(rows):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    if rows:
        ws.append(list(rows[0].keys()))
        for r in rows:
            ws.append([str(x) if x is not None else "" for x in r.values()])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _parse_import_rows(filename, content: bytes):
    if filename.lower().endswith(".xlsx"):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(content), read_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []
        header = [str(h or "").strip().lower() for h in rows[0]]
        return [dict(zip(header, ["" if c is None else str(c) for c in r])) for r in rows[1:]]
    text = content.decode("utf-8-sig", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


@router.post("/registry/import")
async def import_registry(request: Request, db: DbSession = Depends(get_db),
                          user=Depends(require("registry.import")),
                          file: UploadFile = File(...), commit: bool = Form(False)):
    content = await file.read()
    try:
        rows = _parse_import_rows(file.filename, content)
    except Exception:
        raise HTTPException(400, "That file could not be read. Use a CSV or XLSX file with a header row.")
    if len(rows) > 10000:
        raise HTTPException(400, "Import files are limited to 10,000 rows. Split the file and try again.")
    valid, errors = [], []
    seen = set()
    for idx, row in enumerate(rows, start=2):  # row 1 is the header
        def get(*names):
            for n in names:
                if n in row and str(row[n]).strip():
                    return str(row[n]).strip()
            return ""
        plate = get("plate", "plate_display", "plate number")
        category = get("category") or "Staff"
        vtype = get("type") or "car"
        status = get("status") or "Active"
        problem = None
        if not engine.normalise_plate(plate):
            problem = "Plate is missing."
        elif category not in CATEGORIES:
            problem = f"Unknown category '{category}'."
        elif vtype not in VEHICLE_TYPES:
            problem = f"Unknown type '{vtype}'."
        elif status not in STATUSES:
            problem = f"Unknown status '{status}'."
        elif engine.normalise_plate(plate) in seen:
            problem = "Duplicate plate inside the file."
        elif db.query(models.Vehicle).filter_by(
                plate_normalised=engine.normalise_plate(plate), deleted=False).first():
            problem = "Plate already exists in the registry."
        if problem:
            errors.append({"row": idx, "plate": plate, "message": problem})
            continue
        seen.add(engine.normalise_plate(plate))
        valid.append({
            "plate_display": plate, "plate_normalised": engine.normalise_plate(plate),
            "type": vtype, "category": category, "status": status,
            "make": get("make"), "model": get("model"), "colour": get("colour"),
            "owner_name": get("owner", "owner_name"), "organisation": get("organisation"),
            "contact": get("contact"),
            "valid_from": _dt(get("valid_from")) if get("valid_from") else None,
            "valid_to": _dt(get("valid_to")) if get("valid_to") else None,
            "remarks": get("remarks")})
    imported = 0
    if commit:
        for data in valid:
            db.add(models.Vehicle(**data))
            imported += 1
        db.flush()
        audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                              action="registry_imported", object_type="registry",
                              new_value=f"{imported} rows from {file.filename}")
        db.commit()
    err_buf = io.StringIO()
    ew = csv.writer(err_buf)
    ew.writerow(["row", "plate", "message"])
    for e in errors:
        ew.writerow([e["row"], e["plate"], e["message"]])
    return {"total_rows": len(rows), "valid_rows": len(valid), "error_rows": len(errors),
            "imported": imported, "errors": errors, "error_report_csv": err_buf.getvalue()}


# ------------------------------------------------------------------ cameras

@router.get("/cameras")
def list_cameras(db: DbSession = Depends(get_db), user=Depends(require("dashboard.view"))):
    rows = db.query(models.Camera).order_by(models.Camera.name).all()
    return {"cameras": [{"id": c.id, "name": c.name, "site": c.site, "gate": c.gate,
                         "lane": c.lane, "role": c.role, "status": c.status,
                         "edge_node": c.edge_node, "stream_url": c.stream_url,
                         "roi": c.roi, "virtual_line": c.virtual_line,
                         "last_frame_at": c.last_frame_at.isoformat() if c.last_frame_at else None}
                        for c in rows]}


class CameraIn(BaseModel):
    name: str
    site: str = "Main Campus"
    gate: str = "Main Gate"
    lane: str = "Lane 1"
    role: str = "Entry"
    stream_url: str = ""
    edge_node: str = "Edge Node 1"
    roi: str = "[]"
    virtual_line: str = "{}"
    status: str = "online"


@router.post("/cameras")
def create_camera(body: CameraIn, request: Request, db: DbSession = Depends(get_db),
                  user=Depends(require("camera.manage"))):
    if body.role not in ("Entry", "Exit", "Bidirectional"):
        raise HTTPException(400, "Camera role must be Entry, Exit or Bidirectional.")
    cam = models.Camera(**body.model_dump())
    db.add(cam)
    db.flush()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="camera_created", object_type="camera", object_id=cam.id,
                          new_value=cam.name)
    db.commit()
    return {"id": cam.id, "name": cam.name}


@router.put("/cameras/{camera_id}")
def update_camera(camera_id: str, body: CameraIn, request: Request,
                  db: DbSession = Depends(get_db), user=Depends(require("camera.manage"))):
    cam = db.query(models.Camera).filter_by(id=camera_id).first()
    if not cam:
        raise HTTPException(404, "That camera no longer exists.")
    prev = cam.name
    for k, v in body.model_dump().items():
        setattr(cam, k, v)
    db.flush()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="camera_updated", object_type="camera", object_id=cam.id,
                          prev_value=prev, new_value=cam.name)
    db.commit()
    return {"ok": True}


@router.delete("/cameras/{camera_id}")
def delete_camera(camera_id: str, request: Request, db: DbSession = Depends(get_db),
                  user=Depends(require("camera.manage"))):
    cam = db.query(models.Camera).filter_by(id=camera_id).first()
    if not cam:
        raise HTTPException(404, "That camera no longer exists.")
    db.delete(cam)
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="camera_deleted", object_type="camera", object_id=camera_id)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ users

@router.get("/users")
def list_users(db: DbSession = Depends(get_db), user=Depends(require("user.manage"))):
    rows = db.query(models.User).order_by(models.User.username).all()
    return {"users": [{"id": u.id, "username": u.username, "full_name": u.full_name,
                       "email": u.email, "phone": u.phone, "role": u.role,
                       "status": u.status, "mfa_enabled": u.mfa_enabled,
                       "last_login": u.last_login.isoformat() if u.last_login else None}
                      for u in rows]}


class UserIn(BaseModel):
    username: str
    full_name: str
    role: str
    email: str = ""
    phone: str = ""
    password: str


@router.post("/users")
def create_user(body: UserIn, request: Request, db: DbSession = Depends(get_db),
                user=Depends(require("user.manage"))):
    from .rbac import ROLES
    if body.role not in ROLES:
        raise HTTPException(400, "Choose a valid role.")
    err = security.password_policy_error(body.password)
    if err:
        raise HTTPException(400, err)
    if db.query(models.User).filter_by(username=body.username.strip()).first():
        raise HTTPException(400, "That user name is already in use.")
    u = models.User(username=body.username.strip(), full_name=body.full_name,
                    role=body.role, email=body.email, phone=body.phone,
                    password_hash=security.hash_password(body.password),
                    mfa_secret=security.new_mfa_secret() if body.role in ("SA", "SS") else "",
                    mfa_enabled=body.role in ("SA", "SS"))
    db.add(u)
    db.flush()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="user_created", object_type="user", object_id=u.id,
                          new_value=f"{u.username} ({u.role})")
    db.commit()
    return {"id": u.id, "username": u.username}


class UserUpdateIn(BaseModel):
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    role: str | None = None
    status: str | None = None


@router.put("/users/{user_id}")
def update_user(user_id: str, body: UserUpdateIn, request: Request,
                db: DbSession = Depends(get_db), user=Depends(require("user.manage"))):
    target = db.query(models.User).filter_by(id=user_id).first()
    if not target:
        raise HTTPException(404, "That user no longer exists.")
    prev = {"role": target.role, "status": target.status}
    if body.role is not None or body.status is not None:
        new_role = body.role or target.role
        new_status = body.status or target.status
        # FR-SEC-07: never drop below two active System Administrators.
        admins_after = db.query(models.User).filter_by(role="SA", status="active").count()
        if target.role == "SA" and target.status == "active" and (new_role != "SA" or new_status != "active"):
            admins_after -= 1
        if admins_after < 2:
            raise HTTPException(400, "At least two active System Administrator accounts are required. "
                                     "Create another administrator first.")
    for field in ("full_name", "email", "phone", "role", "status"):
        value = getattr(body, field)
        if value is not None:
            setattr(target, field, value)
    db.flush()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="user_updated", object_type="user", object_id=target.id,
                          prev_value=json.dumps(prev),
                          new_value=json.dumps({"role": target.role, "status": target.status}))
    db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: str, request: Request, db: DbSession = Depends(get_db),
                   user=Depends(require("user.manage"))):
    target = db.query(models.User).filter_by(id=user_id).first()
    if not target:
        raise HTTPException(404, "That user no longer exists.")
    import secrets as _secrets
    temp = "Tmp-" + _secrets.token_urlsafe(9) + "#1"
    security.rotate_password_history(target, security.hash_password(temp))
    target.must_change_password = True
    db.flush()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="password_reset_by_admin", object_type="user", object_id=target.id)
    db.commit()
    return {"temporary_password": temp,
            "note": "Shown once. The user must change it at the next sign-in."}


# ------------------------------------------------------------------ configuration

@router.get("/config")
def get_config(db: DbSession = Depends(get_db), user=Depends(require("config.manage"))):
    return {"settings": config_store.all_settings(db),
            "descriptions": {k: v[3] for k, v in config_store.SETTINGS.items()}}


class ConfigIn(BaseModel):
    value: object


@router.put("/config/{key}")
def put_config(key: str, body: ConfigIn, request: Request, db: DbSession = Depends(get_db),
               user=Depends(require("config.manage"))):
    prev = config_store.get_setting(db, key)
    try:
        config_store.set_setting(db, key, body.value, changed_by=user.username)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="config_changed", object_type="config", object_id=key,
                          prev_value=json.dumps(prev), new_value=json.dumps(body.value))
    db.commit()
    return {"ok": True, "key": key, "value": body.value}


@router.get("/config/export")
def export_config(request: Request, db: DbSession = Depends(get_db),
                  user=Depends(require("config.manage"))):
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="config_exported", object_type="config")
    db.commit()
    return {"settings": config_store.all_settings(db)}


@router.get("/purposes")
def list_purposes(db: DbSession = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(models.PurposeOption).order_by(models.PurposeOption.label).all()
    return {"purposes": [{"id": p.id, "label": p.label, "active": p.active,
                          "default_for_category": p.default_for_category} for p in rows]}


class PurposeOptIn(BaseModel):
    label: str
    active: bool = True
    default_for_category: str | None = None


@router.post("/purposes")
def create_purpose(body: PurposeOptIn, db: DbSession = Depends(get_db),
                   user=Depends(require("config.manage"))):
    p = models.PurposeOption(**body.model_dump())
    db.add(p)
    db.commit()
    return {"id": p.id}


@router.put("/purposes/{purpose_id}")
def update_purpose(purpose_id: str, body: PurposeOptIn, db: DbSession = Depends(get_db),
                   user=Depends(require("config.manage"))):
    p = db.query(models.PurposeOption).filter_by(id=purpose_id).first()
    if not p:
        raise HTTPException(404, "That purpose no longer exists.")
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/purposes/{purpose_id}")
def delete_purpose(purpose_id: str, db: DbSession = Depends(get_db),
                   user=Depends(require("config.manage"))):
    p = db.query(models.PurposeOption).filter_by(id=purpose_id).first()
    if not p:
        raise HTTPException(404, "That purpose no longer exists.")
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.get("/plate-formats")
def list_formats(db: DbSession = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(models.PlateFormat).all()
    return {"formats": [{"id": f.id, "region": f.region, "regex": f.regex,
                         "example": f.example, "active": f.active} for f in rows]}


class FormatIn(BaseModel):
    region: str
    regex: str
    example: str = ""
    active: bool = True


@router.post("/plate-formats")
def create_format(body: FormatIn, db: DbSession = Depends(get_db),
                  user=Depends(require("config.manage"))):
    import re as _re
    try:
        _re.compile(body.regex)
    except Exception:
        raise HTTPException(400, "That is not a valid regular expression.")
    f = models.PlateFormat(**body.model_dump())
    db.add(f)
    db.commit()
    return {"id": f.id}


# ------------------------------------------------------------------ audit

@router.get("/audit")
def list_audit(db: DbSession = Depends(get_db), user=Depends(require("audit.view")),
               action: str = "", username: str = "", page: int = 1):
    query = db.query(models.AuditLog)
    if action:
        query = query.filter_by(action=action)
    if username:
        query = query.filter(models.AuditLog.username.like(f"%{username}%"))
    total = query.count()
    rows = query.order_by(models.AuditLog.ts.desc()).offset((page - 1) * 50).limit(50).all()
    return {"total": total, "page": page, "entries": [
        {"id": r.id, "ts": r.ts.isoformat(), "username": r.username, "role": r.role,
         "source_ip": r.source_ip, "action": r.action, "object_type": r.object_type,
         "object_id": r.object_id, "prev_value": r.prev_value, "new_value": r.new_value,
         "result": r.result, "hash": r.hash[:12] + "…"} for r in rows]}


@router.get("/audit/verify")
def verify_audit(db: DbSession = Depends(get_db), user=Depends(require("audit.verify"))):
    ok, count, bad = audit_mod.verify_chain(db)
    return {"ok": ok, "entries_checked": count, "first_bad_entry": bad}


@router.get("/audit/export")
def export_audit(request: Request, db: DbSession = Depends(get_db),
                 user=Depends(require("audit.export"))):
    rows = db.query(models.AuditLog).order_by(models.AuditLog.ts.asc()).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "timestamp_utc", "user", "role", "source", "action", "object",
                "object_id", "previous", "new", "result", "hash"])
    for r in rows:
        w.writerow([r.id, r.ts.isoformat(), r.username, r.role, r.source_ip, r.action,
                    r.object_type, r.object_id, r.prev_value, r.new_value, r.result, r.hash])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=audit-log.csv"})


# ------------------------------------------------------------------ reports

def _fmt_ts(dt):
    return dt.strftime("%d %B %Y, %H:%M:%S") if dt else ""


def _report_rows(db, report_type, date_from, date_to):
    q = db.query(models.Event).filter_by(discarded=False, superseded=False)
    if date_from:
        q = q.filter(models.Event.ts >= _dt(date_from))
    if date_to:
        q = q.filter(models.Event.ts <= _dt(date_to))
    events = q.order_by(models.Event.ts.asc()).all()
    if report_type == "daily-movement":
        days = {}
        for e in events:
            d = e.ts.strftime("%Y-%m-%d")
            row = days.setdefault(d, {"date": d, "entries": 0, "exits": 0, "unknown": 0})
            row["entries" if e.event_type == "Entry" else "exits"] += 1
            if e.status == "UNKNOWN":
                row["unknown"] += 1
        return list(days.values())
    if report_type == "currently-inside":
        out = []
        for s in db.query(models.VisitSession).filter_by(state="Open").all():
            veh = db.query(models.Vehicle).filter_by(id=s.vehicle_id).first() if s.vehicle_id else None
            out.append({"plate": veh.plate_display if veh else s.plate_normalised,
                        "category": veh.category if veh else "Unknown",
                        "entered": _fmt_ts(s.entry_ts), "purpose": s.purpose})
        return out
    if report_type == "unknown-vehicles":
        return [{"time": _fmt_ts(e.ts), "plate": e.plate_raw or "UNREADABLE",
                 "type": e.event_type, "camera": e.camera_id} for e in events if e.status == "UNKNOWN"]
    if report_type == "dwell-time":
        out = []
        for s in db.query(models.VisitSession).filter(models.VisitSession.dwell_seconds.isnot(None)).all():
            veh = db.query(models.Vehicle).filter_by(id=s.vehicle_id).first() if s.vehicle_id else None
            out.append({"plate": veh.plate_display if veh else s.plate_normalised,
                        "category": veh.category if veh else "Unknown",
                        "entered": _fmt_ts(s.entry_ts), "exited": _fmt_ts(s.exit_ts),
                        "dwell_minutes": round(s.dwell_seconds / 60, 1)})
        return out
    if report_type == "exceptions":
        return [{"time": _fmt_ts(e.ts), "plate": e.plate_raw, "type": e.event_type,
                 "flags": ", ".join(json.loads(e.flags or "[]"))}
                for e in events if json.loads(e.flags or "[]")]
    if report_type == "blacklist-alerts":
        rows = db.query(models.Alert).filter(
            models.Alert.type.in_(["Blacklisted Vehicle", "Suspended Vehicle"])).all()
        return [{"time": _fmt_ts(a.created_at), "type": a.type, "message": a.message,
                 "acknowledged_by": a.ack_by or ""} for a in rows]
    if report_type == "camera-availability":
        out = []
        window_start = engine.utcnow() - timedelta(days=30)
        for c in db.query(models.Camera).all():
            down = 0.0
            for o in db.query(models.CameraOutage).filter_by(camera_id=c.id).all():
                start = max(engine._aware(o.started_at), window_start)
                end = engine._aware(o.ended_at) or engine.utcnow()
                down += (end - start).total_seconds()
            total = 30 * 24 * 3600
            out.append({"camera": c.name, "uptime_percent": round(100 * (1 - down / total), 2),
                        "current_status": c.status})
        return out
    raise HTTPException(404, "Unknown report type.")


REPORT_TITLES = {
    "daily-movement": "Daily Movement Summary", "currently-inside": "Currently Inside",
    "unknown-vehicles": "Unknown Vehicles", "dwell-time": "Dwell Time",
    "exceptions": "Exceptions", "blacklist-alerts": "Blacklist & Suspended Alerts",
    "camera-availability": "Camera Availability",
}


@router.get("/reports/{report_type}")
def report(report_type: str, request: Request, db: DbSession = Depends(get_db),
           user=Depends(require("report.generate")), format: str = "json",
           date_from: str = "", date_to: str = ""):
    if report_type not in REPORT_TITLES:
        raise HTTPException(404, "Unknown report type.")
    rows = _report_rows(db, report_type, date_from, date_to)
    title = REPORT_TITLES[report_type]
    if format == "json":
        return {"title": title, "generated_at": _fmt_ts(engine.utcnow()),
                "generated_by": user.username, "rows": rows}
    if format not in ("csv", "xlsx", "pdf"):
        raise HTTPException(400, "Format must be json, csv, xlsx or pdf.")
    if not _has(user, "report.export"):
        raise HTTPException(403, "Your role can view reports but not export them.")
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="report_exported", object_type="report",
                          object_id=report_type, new_value=format)
    db.commit()
    if format == "csv":
        buf = io.StringIO()
        buf.write(f"# {title}\n# Generated: {_fmt_ts(engine.utcnow())} by {user.username}\n")
        buf.write(f"# Filters: from={date_from or '-'} to={date_to or '-'}\n")
        w = csv.writer(buf)
        if rows:
            w.writerow(list(rows[0].keys()))
            for r in rows:
                w.writerow(list(r.values()))
        return Response(buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f"attachment; filename={report_type}.csv"})
    if format == "xlsx":
        return Response(_xlsx_bytes(rows),
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f"attachment; filename={report_type}.xlsx"})
    return Response(_pdf_bytes(title, rows, user),
                    media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={report_type}.pdf"})


def _has(user, permission):
    from .rbac import has_permission
    return has_permission(user.role, permission)


def _pdf_bytes(title, rows, user):
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title=title)
    styles = getSampleStyleSheet()
    story = [Paragraph(title, styles["Title"]),
             Paragraph(f"Generated: {_fmt_ts(engine.utcnow())} by {user.username}", styles["Normal"]),
             Spacer(1, 12)]
    if rows:
        data = [list(rows[0].keys())] + [[str(v) for v in r.values()] for r in rows]
        table = Table(data, repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#16324F")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#C9D4E0")),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
        ]))
        story.append(table)
    else:
        story.append(Paragraph("No records match the selected filters.", styles["Normal"]))
    doc.build(story)
    return buf.getvalue()


# ------------------------------------------------------------------ data protection & jobs

class LegalHoldIn(BaseModel):
    event_id: str
    reason: str = ""


@router.post("/legal-holds")
def place_hold(body: LegalHoldIn, request: Request, db: DbSession = Depends(get_db),
               user=Depends(require("legal.hold"))):
    ev = db.query(models.Event).filter_by(id=body.event_id).first()
    if not ev:
        raise HTTPException(404, "That event no longer exists.")
    hold = models.LegalHold(event_id=body.event_id, placed_by=user.username, reason=body.reason)
    db.add(hold)
    db.flush()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="legal_hold_placed", object_type="event",
                          object_id=body.event_id, new_value=body.reason)
    db.commit()
    return {"id": hold.id}


@router.get("/legal-holds")
def list_holds(db: DbSession = Depends(get_db), user=Depends(require("legal.hold"))):
    holds = (db.query(models.LegalHold).filter(models.LegalHold.released_at.is_(None))
             .order_by(models.LegalHold.placed_at.desc()).all())
    out = []
    for h in holds:
        ev = db.query(models.Event).filter_by(id=h.event_id).first()
        out.append({"id": h.id, "event_id": h.event_id,
                    "plate": (ev.plate_raw or ev.plate_normalised) if ev else "—",
                    "event_ts": ev.ts.isoformat() if ev else None,
                    "placed_by": h.placed_by,
                    "placed_at": h.placed_at.isoformat() if h.placed_at else None,
                    "reason": h.reason})
    return {"holds": out}


@router.delete("/legal-holds/{hold_id}")
def release_hold(hold_id: str, request: Request, db: DbSession = Depends(get_db),
                 user=Depends(require("legal.hold"))):
    hold = db.query(models.LegalHold).filter_by(id=hold_id).first()
    if not hold:
        raise HTTPException(404, "That hold no longer exists.")
    hold.released_by = user.username
    hold.released_at = engine.utcnow()
    db.flush()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="legal_hold_released", object_type="event",
                          object_id=hold.event_id)
    db.commit()
    return {"ok": True}


class PrivacyIn(BaseModel):
    plate: str = ""
    owner_name: str = ""


@router.post("/privacy/export")
def privacy_export(body: PrivacyIn, request: Request, db: DbSession = Depends(get_db),
                   user=Depends(require("privacy.manage"))):
    query = db.query(models.Vehicle).filter_by(deleted=False)
    if body.plate:
        query = query.filter_by(plate_normalised=engine.normalise_plate(body.plate))
    if body.owner_name:
        query = query.filter(models.Vehicle.owner_name.like(f"%{body.owner_name}%"))
    vehicles = query.all()
    bundle = {"vehicles": [_vehicle_dict(v) for v in vehicles], "events": []}
    for v in vehicles:
        for e in db.query(models.Event).filter_by(vehicle_id=v.id).all():
            bundle["events"].append(engine._event_to_dict(db, e, include_vehicle=False))
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="personal_data_exported", object_type="person",
                          new_value=body.plate or body.owner_name)
    db.commit()
    return bundle


class EraseIn(BaseModel):
    vehicle_id: str


@router.post("/privacy/erase")
def privacy_erase(body: EraseIn, request: Request, db: DbSession = Depends(get_db),
                  user=Depends(require("privacy.manage"))):
    v = db.query(models.Vehicle).filter_by(id=body.vehicle_id).first()
    if not v:
        raise HTTPException(404, "That registry record no longer exists.")
    v.owner_name = "Erased"
    v.contact = ""
    v.organisation = ""
    for e in db.query(models.Event).filter_by(vehicle_id=v.id).all():
        e.visitor_name = ""
        e.visitor_contact = ""
    db.flush()
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="personal_data_erased", object_type="vehicle", object_id=v.id)
    db.commit()
    return {"ok": True, "note": "Events remain, anonymised (FR-DAT-06)."}


@router.post("/admin/run-jobs")
def run_jobs(db: DbSession = Depends(get_db), user=Depends(require("config.manage"))):
    summary = engine.run_periodic_jobs(db)
    db.commit()
    return summary


@router.post("/admin/run-retention")
def run_retention(request: Request, db: DbSession = Depends(get_db),
                  user=Depends(require("config.manage"))):
    result = engine.run_retention(db)
    audit_mod.write_audit(db, user=user, source_ip=request.state.client_ip,
                          action="retention_purge", object_type="system",
                          new_value=json.dumps(result))
    db.commit()
    return result
