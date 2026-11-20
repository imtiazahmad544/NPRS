"""Authentication endpoints (FR-SEC-01..12, SRS §3.1.1 Sign In set)."""
import time
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from . import audit, models, security
from .db import get_db
from .deps import get_current_user, require
from .engine import raise_alert
from .rbac import MFA_REQUIRED_ROLES, permissions_for

router = APIRouter(prefix="/auth", tags=["auth"])

# Pending MFA challenges: token -> (user_id, expiry epoch). Development-grade
# store; production keeps these in the session store.
_challenges = {}


class LoginIn(BaseModel):
    username: str
    password: str


class MfaIn(BaseModel):
    challenge: str
    code: str


class RefreshIn(BaseModel):
    refresh_token: str


class PasswordIn(BaseModel):
    current_password: str
    new_password: str


def _start_session(db, user, request):
    refresh = security.new_refresh_token()
    session = models.AuthSession(
        user_id=user.id, expires_abs=security.session_expiry(),
        refresh_hash=security.hash_refresh(refresh))
    db.add(session)
    db.flush()
    access = security.issue_access_token(user.id, session.id)
    user.last_login = security.utcnow()
    user.failed_attempts = 0
    db.commit()
    audit.write_audit(db, user=user, source_ip=request.client.host if request.client else "",
                      action="sign_in", object_type="user", object_id=user.id)
    db.commit()
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer",
            "user": _public_user(user), "must_change_password": user.must_change_password}


def _public_user(user):
    return {"id": user.id, "username": user.username, "full_name": user.full_name,
            "role": user.role, "permissions": permissions_for(user.role),
            "mfa_enabled": user.mfa_enabled}


@router.post("/login")
def login(body: LoginIn, request: Request, db: DbSession = Depends(get_db)):
    user = db.query(models.User).filter_by(username=body.username.strip()).first()
    ip = request.client.host if request.client else ""
    if user and user.locked_until:
        locked = user.locked_until
        if locked.tzinfo is None:
            from datetime import timezone
            locked = locked.replace(tzinfo=timezone.utc)
        if locked > security.utcnow():
            raise HTTPException(423, "This account is locked after repeated failed sign-ins. "
                                     "Wait 15 minutes, or ask the System Administrator.")
    if not user or user.status != "active" or not security.verify_password(user.password_hash, body.password):
        if user and user.status == "active":
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= security.LOCKOUT_THRESHOLD:
                user.locked_until = security.utcnow() + timedelta(minutes=security.LOCKOUT_MINUTES)
                raise_alert(db, "Repeated Failed Sign-in", "Warning",
                            f"Account {user.username} was locked after {security.LOCKOUT_THRESHOLD} failed sign-ins.",
                            "user", user.id)
            db.commit()
            audit.write_audit(db, user=user, source_ip=ip, action="sign_in_failed",
                              object_type="user", object_id=user.id, result="failure")
            db.commit()
        raise HTTPException(401, "The user name or password is not correct. Check both and try again.")
    if user.mfa_enabled or user.role in MFA_REQUIRED_ROLES:
        if not user.mfa_secret:
            user.mfa_secret = security.new_mfa_secret()
            db.commit()
        token = security.new_refresh_token()
        _challenges[token] = (user.id, time.time() + 300)
        return {"mfa_required": True, "challenge": token}
    return _start_session(db, user, request)


@router.post("/mfa")
def mfa(body: MfaIn, request: Request, db: DbSession = Depends(get_db)):
    entry = _challenges.pop(body.challenge, None)
    if not entry or entry[1] < time.time():
        raise HTTPException(401, "This sign-in step has expired. Start again from the Sign In screen.")
    user = db.query(models.User).filter_by(id=entry[0]).first()
    if not user or not security.verify_totp(user.mfa_secret, body.code):
        _challenges[body.challenge] = entry  # allow retry within the window
        raise HTTPException(401, "That code is not correct. Enter the current 6-digit code from your authenticator app.")
    return _start_session(db, user, request)


@router.post("/refresh")
def refresh(body: RefreshIn, db: DbSession = Depends(get_db)):
    digest = security.hash_refresh(body.refresh_token)
    session = db.query(models.AuthSession).filter_by(refresh_hash=digest).first()
    if not session or session.revoked:
        raise HTTPException(401, "Your session has ended. Sign in again to continue.")
    from datetime import timezone
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
    new_refresh = security.new_refresh_token()
    session.refresh_hash = security.hash_refresh(new_refresh)
    session.last_activity = now
    db.commit()
    return {"access_token": security.issue_access_token(session.user_id, session.id),
            "refresh_token": new_refresh, "token_type": "bearer"}


@router.post("/logout")
def logout(request: Request, user=Depends(get_current_user), db: DbSession = Depends(get_db)):
    session = request.state.session
    session.revoked = True
    db.commit()
    audit.write_audit(db, user=user, source_ip=request.state.client_ip,
                      action="sign_out", object_type="user", object_id=user.id)
    db.commit()
    return {"ok": True}


@router.get("/me")
def me(user=Depends(get_current_user)):
    return _public_user(user)


@router.post("/password")
def change_password(body: PasswordIn, request: Request,
                    user=Depends(require("password.own")), db: DbSession = Depends(get_db)):
    if not security.verify_password(user.password_hash, body.current_password):
        raise HTTPException(400, "Your current password is not correct.")
    err = security.password_policy_error(body.new_password)
    if err:
        raise HTTPException(400, err)
    if security.password_reused(user, body.new_password):
        raise HTTPException(400, "Choose a password you have not used in your last 5 passwords.")
    security.rotate_password_history(user, security.hash_password(body.new_password))
    user.must_change_password = False
    db.commit()
    audit.write_audit(db, user=user, source_ip=request.state.client_ip,
                      action="password_changed", object_type="user", object_id=user.id)
    db.commit()
    return {"ok": True}


@router.post("/mfa/enroll")
def mfa_enroll(user=Depends(get_current_user), db: DbSession = Depends(get_db)):
    user.mfa_secret = security.new_mfa_secret()
    db.commit()
    return {"secret": user.mfa_secret,
            "note": "Add this secret to your authenticator app, then confirm with a code."}


class MfaConfirmIn(BaseModel):
    code: str


@router.post("/mfa/confirm")
def mfa_confirm(body: MfaConfirmIn, user=Depends(get_current_user), db: DbSession = Depends(get_db)):
    if not security.verify_totp(user.mfa_secret, body.code):
        raise HTTPException(400, "That code is not correct. Check the app and try again.")
    user.mfa_enabled = True
    db.commit()
    return {"ok": True, "mfa_enabled": True}
