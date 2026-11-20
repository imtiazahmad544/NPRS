"""Append-only, hash-chained audit log (FR-AUD-01..05, SDS §6.7).

Each entry stores the SHA-256 hash of the previous entry, so silent
alteration of stored rows is detectable. Nothing in the codebase updates
or deletes audit rows; the production database account is additionally
denied UPDATE/DELETE on the table (DB-05).
"""
import hashlib
import json
from . import models


def _canonical(entry: dict) -> str:
    return json.dumps(entry, sort_keys=True, separators=(",", ":"), default=str)


def _ts_iso(dt) -> str:
    """Canonical timestamp form. SQLite drops the offset on read-back, so
    both writing and verification normalise to aware UTC first."""
    from datetime import timezone
    if dt is not None and dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def write_audit(db, *, user=None, username="", role="", source_ip="",
                action, object_type="", object_id="",
                prev_value="", new_value="", result="success"):
    # Chain head = the entry no other entry points back to. Robust even
    # when several entries share a timestamp.
    rows = db.query(models.AuditLog).all()
    pointed = {r.prev_hash for r in rows}
    heads = [r for r in rows if r.hash and r.hash not in pointed]
    prev_hash = heads[0].hash if heads else ""
    entry = models.AuditLog(
        user_id=(user.id if user else None),
        username=(user.username if user else username),
        role=(user.role if user else role),
        source_ip=source_ip, action=action, object_type=object_type,
        object_id=str(object_id), prev_value=str(prev_value or ""),
        new_value=str(new_value or ""), result=result, prev_hash=prev_hash,
    )
    db.add(entry)
    db.flush()  # assigns id + ts
    payload = {
        "id": entry.id, "ts": _ts_iso(entry.ts), "user": entry.username,
        "action": entry.action, "object_type": entry.object_type,
        "object_id": entry.object_id, "prev_value": entry.prev_value,
        "new_value": entry.new_value, "result": entry.result,
        "prev_hash": prev_hash,
    }
    entry.hash = hashlib.sha256(_canonical(payload).encode()).hexdigest()
    db.flush()
    return entry


def verify_chain(db):
    """Recompute the chain by following prev_hash links from the genesis
    entry (order-independent). Returns (ok, entries_checked, first_bad_id)."""
    rows = db.query(models.AuditLog).all()
    by_prev = {}
    for row in rows:
        by_prev.setdefault(row.prev_hash, []).append(row)
    checked = 0
    prev_hash = ""
    while True:
        nxt = by_prev.get(prev_hash, [])
        if not nxt:
            break
        if len(nxt) > 1:
            return False, len(rows), nxt[1].id  # chain forked
        row = nxt[0]
        payload = {
            "id": row.id, "ts": _ts_iso(row.ts), "user": row.username,
            "action": row.action, "object_type": row.object_type,
            "object_id": row.object_id, "prev_value": row.prev_value,
            "new_value": row.new_value, "result": row.result,
            "prev_hash": row.prev_hash,
        }
        expect = hashlib.sha256(_canonical(payload).encode()).hexdigest()
        if expect != row.hash:
            return False, len(rows), row.id
        checked += 1
        prev_hash = row.hash
    if checked != len(rows):
        orphan = next((r.id for r in rows if r.prev_hash != "" and r.prev_hash not in
                       {x.hash for x in rows}), rows[0].id if rows else None)
        return False, len(rows), orphan
    return True, len(rows), None
