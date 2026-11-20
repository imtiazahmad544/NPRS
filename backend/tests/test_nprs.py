"""Behavioural tests for the NPRS core, mapped to SRS acceptance tests."""
from conftest import ingest, login


# --------------------------------------------------------------- auth (AT-50..58)

def test_login_requires_mfa_for_admin(client):
    res = client.post("/api/auth/login", json={"username": "admin.one", "password": "NprsDemo#2026"})
    assert res.status_code == 200
    assert res.json()["mfa_required"] is True


def test_wrong_password_rejected(client):
    res = client.post("/api/auth/login", json={"username": "ahmed.raza", "password": "wrong-password"})
    assert res.status_code == 401


def test_lockout_after_five_failures(client, sa):
    # Create a throwaway user so the shared fixtures are not locked out.
    res = client.post("/api/users", headers=sa, json={
        "username": "lock.test", "full_name": "Lock Test", "role": "RV",
        "password": "LockTest#2026pass"})
    assert res.status_code == 200
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "lock.test", "password": "nope-nope-nope"})
    res = client.post("/api/auth/login", json={"username": "lock.test", "password": "LockTest#2026pass"})
    assert res.status_code == 423  # locked (FR-SEC-03)


def test_rbac_denies_by_default(client, go, rv, au):
    # Gate Operator cannot manage users (FR-SEC-06)
    assert client.get("/api/users", headers=go).status_code == 403
    # Report Viewer cannot see the review queue or registry writes
    assert client.get("/api/review", headers=rv).status_code == 403
    assert client.post("/api/registry", headers=rv, json={"plate_display": "AAA-111"}).status_code == 403
    # Auditor cannot export the audit log without the export permission holder check:
    # AU holds audit.export, SA does not.
    assert client.get("/api/audit/export", headers=au).status_code == 200


def test_sa_cannot_resolve_review(client, sa, go, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    out = ingest(client, entry, "2026-11-20T09:00:00+00:00", plate="ZZQ-900", conf=0.7)
    assert out["event"]["plate_status"] == "Needs Review"
    queue = client.get("/api/review", headers=go).json()
    task = queue["tasks"][0]
    res = client.post(f"/api/review/{task['id']}/resolve", headers=sa,
                      json={"action": "confirm"})
    assert res.status_code == 403  # separation of duties (§5.4 rule 2)


# --------------------------------------------------------------- matching (AT-13..21)

def test_exact_match_is_known(client, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    out = ingest(client, entry, "2026-11-20T09:05:00+00:00", plate="LEB-9034")
    ev = out["event"]
    assert ev["status"] == "Known" and ev["plate_status"] == "Accepted"


def test_unknown_vehicle_labelled(client, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    out = ingest(client, entry, "2026-11-20T09:06:00+00:00", plate="QQQ-31337".replace("31337", "313"))
    assert out["event"]["status"] == "UNKNOWN"


def test_candidate_match_goes_to_review_never_auto_accepted(client, go, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    # LEA-4521 is registered; LEA-4522 differs by one character.
    out = ingest(client, entry, "2026-11-20T09:07:00+00:00", plate="LEA-4522")
    ev = out["event"]
    assert ev["status"] == "UNKNOWN"
    assert ev["plate_status"] == "Needs Review"
    assert ev["candidates"], "candidate list must be offered to the reviewer"


def test_unreadable_below_review_threshold(client, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    out = ingest(client, entry, "2026-11-20T09:08:00+00:00", plate="LEA-4521", conf=0.30)
    assert out["event"]["plate_status"] == "UNREADABLE"


def test_no_plate_event_still_created(client, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    out = ingest(client, entry, "2026-11-20T09:09:00+00:00", plate="", conf=0.0,
                 vclass="bicycle", no_plate=True)
    assert out["event"]["plate_status"] == "No Plate Detected"


def test_blacklisted_raises_critical_alert(client, sa, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    ingest(client, entry, "2026-11-20T09:10:00+00:00", plate="LXR-309")
    alerts = client.get("/api/alerts", headers=sa).json()["alerts"]
    assert any(a["type"] == "Blacklisted Vehicle" and a["severity"] == "Critical" for a in alerts)


def test_expired_registration_flagged(client, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    out = ingest(client, entry, "2026-11-20T09:11:00+00:00", plate="LEH-1187")
    assert "Expired Registration" in out["event"]["flags"]


def test_type_mismatch_flagged(client, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    out = ingest(client, entry, "2026-11-20T09:12:00+00:00", plate="RIS-317", vclass="truck")
    assert "Type Mismatch" in out["event"]["flags"]


# --------------------------------------------------------------- sessions (AT-22..32)

def test_session_opens_and_closes_with_dwell(client, sa, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    exit_ = next(c for c in cameras if c["role"] == "Exit")
    ingest(client, entry, "2026-11-20T10:00:00+00:00", plate="ICT-992")
    out = ingest(client, exit_, "2026-11-20T11:00:00+00:00", plate="ICT-992")
    detail = client.get(f"/api/events/{out['event']['id']}", headers=sa).json()
    assert detail["session"]["state"] == "Closed"
    assert detail["session"]["dwell_seconds"] == 3600


def test_exit_without_entry_flagged(client, cameras):
    exit_ = next(c for c in cameras if c["role"] == "Exit")
    out = ingest(client, exit_, "2026-11-20T10:05:00+00:00", plate="ZZE-555")
    assert "Exit Without Entry" in out["event"]["flags"]


def test_duplicate_window_merges(client, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    first = ingest(client, entry, "2026-11-20T10:10:00+00:00", plate="LET-5520")
    second = ingest(client, entry, "2026-11-20T10:10:30+00:00", plate="LET-5520")
    assert first["event"]["id"] == second["event"]["id"]
    assert second["created"] is False


def test_ingest_is_idempotent(client, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    a = ingest(client, entry, "2026-11-20T10:20:00+00:00", plate="VIP-101", uuid="fixed-uuid-1")
    b = ingest(client, entry, "2026-11-20T10:20:00+00:00", plate="VIP-101", uuid="fixed-uuid-1")
    assert a["event"]["id"] == b["event"]["id"] and b["created"] is False


# --------------------------------------------------------------- review (AT-37..41)

def test_review_correction_creates_new_version(client, go, sa, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    out = ingest(client, entry, "2026-11-20T11:30:00+00:00", plate="LEA-4522")
    original_id = out["event"]["id"]
    task = client.get("/api/review", headers=go).json()["tasks"]
    task = next(t for t in task if t["event"]["id"] == original_id)
    res = client.post(f"/api/review/{task['id']}/resolve", headers=go,
                      json={"action": "correct", "plate_text": "LEA-4521"})
    assert res.status_code == 200
    new_ev = res.json()["event"]
    assert new_ev["version"] == 2 and new_ev["status"] == "Known"
    detail = client.get(f"/api/events/{new_ev['id']}", headers=sa).json()
    assert detail["history"], "original version must remain visible in history"


def test_discard_requires_reason(client, go, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    out = ingest(client, entry, "2026-11-20T11:40:00+00:00", plate="ZZQ-901", conf=0.65)
    task = next(t for t in client.get("/api/review", headers=go).json()["tasks"]
                if t["event"]["id"] == out["event"]["id"])
    res = client.post(f"/api/review/{task['id']}/resolve", headers=go,
                      json={"action": "discard", "reason": ""})
    assert res.status_code == 400
    res = client.post(f"/api/review/{task['id']}/resolve", headers=go,
                      json={"action": "discard", "reason": "False detection: shadow"})
    assert res.status_code == 200


# --------------------------------------------------------------- purpose (AT-33..36)

def test_purpose_optional_and_audited(client, go, sa, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    out = ingest(client, entry, "2026-11-20T12:00:00+00:00", plate="RIM-2045")
    ev_id = out["event"]["id"]
    res = client.put(f"/api/events/{ev_id}/purpose", headers=go, json={
        "purpose": "Maintenance", "visitor_name": "", "visitor_contact": "",
        "person_visited": ""})
    assert res.status_code == 200 and res.json()["purpose"] == "Maintenance"
    # Purpose longer than 250 characters is rejected (FR-POV-02)
    res = client.put(f"/api/events/{ev_id}/purpose", headers=go, json={
        "purpose": "x" * 251, "visitor_name": "", "visitor_contact": "", "person_visited": ""})
    assert res.status_code == 400
    # SA may not edit purpose (matrix: SS, GO only)
    res = client.put(f"/api/events/{ev_id}/purpose", headers=sa, json={
        "purpose": "Delivery", "visitor_name": "", "visitor_contact": "", "person_visited": ""})
    assert res.status_code == 403


# --------------------------------------------------------------- manual events (AT-41)

def test_manual_event_past_time_needs_reason(client, go, cameras):
    entry = next(c for c in cameras if c["role"] == "Entry")
    res = client.post("/api/events/manual", headers=go, json={
        "plate_text": "LEA-4521", "vehicle_class": "car", "event_type": "Entry",
        "camera_id": entry["id"], "ts": "2020-01-01T08:00:00+00:00",
        "purpose": "", "past_reason": ""})
    assert res.status_code == 400
    res = client.post("/api/events/manual", headers=go, json={
        "plate_text": "LEA-4521", "vehicle_class": "car", "event_type": "Entry",
        "camera_id": entry["id"], "ts": "2020-01-01T08:00:00+00:00",
        "purpose": "", "past_reason": "Camera outage"})
    assert res.status_code == 200 and res.json()["manual"] is True


# --------------------------------------------------------------- registry (AT-13..21)

def test_registry_duplicate_plate_rejected(client, rm):
    res = client.post("/api/registry", headers=rm, json={"plate_display": "LEA-4521"})
    assert res.status_code == 400


def test_registry_import_preview_and_commit(client, rm):
    csv_text = ("plate,type,category,status,owner\n"
                "NEW-100,car,Staff,Active,Test Owner\n"
                "BAD-200,hovercraft,Staff,Active,X\n"
                "LEA-4521,car,Staff,Active,Dup\n")
    files = {"file": ("import.csv", csv_text, "text/csv")}
    res = client.post("/api/registry/import", headers=rm, files=files, data={"commit": "false"})
    data = res.json()
    assert data["valid_rows"] == 1 and data["error_rows"] == 2
    res = client.post("/api/registry/import", headers=rm, files={
        "file": ("import.csv", csv_text, "text/csv")}, data={"commit": "true"})
    assert res.json()["imported"] == 1


# --------------------------------------------------------------- audit (AT-59, AT-60)

def test_audit_chain_verifies(client, au):
    res = client.get("/api/audit/verify", headers=au)
    assert res.status_code == 200 and res.json()["ok"] is True


# --------------------------------------------------------------- config (AT-61)

def test_config_range_validation(client, sa):
    res = client.put("/api/config/accept_threshold", headers=sa, json={"value": 0.2})
    assert res.status_code == 400  # below the allowed range
    res = client.put("/api/config/accept_threshold", headers=sa, json={"value": 0.9})
    assert res.status_code == 200
    res = client.put("/api/config/accept_threshold", headers=sa, json={"value": 0.85})
    assert res.status_code == 200  # restore default for other tests


# --------------------------------------------------------------- users (AT-55, AT-57)

def test_cannot_drop_below_two_admins(client, sa):
    users = client.get("/api/users", headers=sa).json()["users"]
    admins = [u for u in users if u["role"] == "SA" and u["status"] == "active"]
    assert len(admins) >= 2
    # With exactly the two seeded admins active, disabling one must be refused.
    res = client.put(f"/api/users/{admins[0]['id']}", headers=sa, json={"status": "disabled"})
    assert res.status_code == 400


def test_password_history_reuse_rejected(client, sa):
    res = client.post("/api/users", headers=sa, json={
        "username": "hist.test", "full_name": "Hist Test", "role": "RV",
        "password": "FirstPass#2026x"})
    assert res.status_code == 200
    res = client.post("/api/auth/login", json={"username": "hist.test", "password": "FirstPass#2026x"})
    assert res.status_code == 200
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    res = client.post("/api/auth/password", headers=headers, json={
        "current_password": "FirstPass#2026x", "new_password": "SecondPass#2026x"})
    assert res.status_code == 200
    res = client.post("/api/auth/password", headers=headers, json={
        "current_password": "SecondPass#2026x", "new_password": "FirstPass#2026x"})
    assert res.status_code == 400  # reuse of a recent password (FR-SEC-10)


# --------------------------------------------------------------- reports (AT-43..45)

def test_reports_generate_and_export(client, rv, sa):
    res = client.get("/api/reports/daily-movement", headers=rv)
    assert res.status_code == 200 and "rows" in res.json()
    res = client.get("/api/reports/daily-movement?format=csv", headers=rv)
    assert res.status_code == 200 and "text/csv" in res.headers["content-type"]
    res = client.get("/api/reports/daily-movement?format=pdf", headers=rv)
    assert res.status_code == 200 and res.content[:4] == b"%PDF"
