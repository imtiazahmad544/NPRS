"""FastAPI dependencies: authentication and permission enforcement.

Every protected endpoint resolves the caller through here, so the RBAC
matrix (rbac.py) is enforced on the server for every request (FR-SEC-06),
including session idle/absolute expiry (FR-SEC-04) and role changes
applying from the next request (FR-SEC-08 — the role is read from the
database on each request, never trusted from the token).
"""
from datetime import timedelta, timezone
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session as DbSession

from . import models, security
from .db import get_db
from .rbac import has_permission


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def get_current_user(request: Request, db: DbSession = Depends(get_db)):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Sign in is required. Use the Sign In screen to continue.")
    payload = security.read_access_token(auth[7:])
    if not payload:
        raise HTTPException(401, "Your session has ended. Sign in again to continue.")
    session = db.query(models.AuthSession).filter_by(id=payload.get("sid")).first()
    if not session or session.revoked:
        raise HTTPException(401, "Your session has ended. Sign in again to continue.")
    now = security.utcnow()
    last = session.last_activity
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    expires = session.expires_abs
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if now - last > timedelta(minutes=security.SESSION_IDLE_MINUTES) or now > expires:
        session.revoked = True
        db.commit()
        raise HTTPException(401, "Your session has ended through inactivity. Sign in again to continue.")
    user = db.query(models.User).filter_by(id=payload.get("sub")).first()
    if not user or user.status != "active":
        raise HTTPException(401, "This account is not active. Contact the System Administrator.")
    session.last_activity = now
    db.commit()
    request.state.user = user
    request.state.session = session
    request.state.client_ip = _client_ip(request)
    return user


def require(permission: str):
    def _dep(user=Depends(get_current_user)):
        if not has_permission(user.role, permission):
            raise HTTPException(
                403,
                "Your role does not include this action. If you need it, ask the System Administrator.")
        return user
    return _dep
