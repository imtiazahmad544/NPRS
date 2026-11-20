"""Authentication and session security (FR-SEC-01..12, SDS §9.2).

Passwords: Argon2id salted hashes, minimum 12 characters, history of 5.
MFA: TOTP (RFC 6238) via pyotp. Access tokens are HMAC-signed, expire in
15 minutes, and ride on a server-side session that enforces the
15-minute inactivity and 12-hour absolute limits (FR-SEC-04).
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timedelta, timezone

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_ph = PasswordHasher()  # Argon2id defaults (RFC 9106 profile)
_SECRET = os.environ.get("NPRS_SECRET", "dev-only-secret-change-in-production")
ACCESS_TOKEN_MINUTES = 15
SESSION_IDLE_MINUTES = 15
SESSION_ABSOLUTE_HOURS = 12
LOCKOUT_THRESHOLD = 5
LOCKOUT_MINUTES = 15
PASSWORD_MIN_LENGTH = 12
PASSWORD_HISTORY = 5


def utcnow():
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, Exception):
        return False


def password_policy_error(password: str):
    if len(password) < PASSWORD_MIN_LENGTH:
        return f"Password must be at least {PASSWORD_MIN_LENGTH} characters long."
    return None


def password_reused(user, new_password: str) -> bool:
    """True if new_password matches the current or any of the last 5 (FR-SEC-10)."""
    history = []
    try:
        history = json.loads(user.password_history or "[]")
    except Exception:
        history = []
    for old in [user.password_hash] + history[:PASSWORD_HISTORY]:
        if old and verify_password(old, new_password):
            return True
    return False


def rotate_password_history(user, new_hash: str):
    try:
        history = json.loads(user.password_history or "[]")
    except Exception:
        history = []
    history = [user.password_hash] + history
    user.password_history = json.dumps(history[:PASSWORD_HISTORY])
    user.password_hash = new_hash


# ---- TOTP MFA (FR-SEC-02) ----

def new_mfa_secret() -> str:
    return pyotp.random_base32()


def verify_totp(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    try:
        return pyotp.TOTP(secret).verify(str(code).strip(), valid_window=1)
    except Exception:
        return False


def totp_now(secret: str) -> str:
    return pyotp.TOTP(secret).now()


# ---- Access tokens (signed, short-lived) ----

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def issue_access_token(user_id: str, session_id: str) -> str:
    payload = {
        "sub": user_id,
        "sid": session_id,
        "exp": int(time.time()) + ACCESS_TOKEN_MINUTES * 60,
    }
    body = _b64(json.dumps(payload).encode())
    sig = _b64(hmac.new(_SECRET.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_access_token(token: str):
    try:
        body, sig = token.split(".")
        expected = _b64(hmac.new(_SECRET.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(body))
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def session_expiry():
    return utcnow() + timedelta(hours=SESSION_ABSOLUTE_HOURS)
