"""Development seed data: demo users, cameras, registry, purposes, formats.

DEMO VALUES ONLY. Passwords and MFA secrets below exist so a developer
can sign in immediately; replace all of them before any real deployment
(NFR-SEC-03). The two System Administrator accounts satisfy FR-SEC-07.
"""
from datetime import timedelta
from . import models, security
from .db import SessionLocal

DEMO_PASSWORD = "NprsDemo#2026"
# Valid base32 TOTP secrets (demo only).
MFA_SECRETS = {
    "admin.one": "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    "admin.two": "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    "imran.shah": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
}

USERS = [
    ("admin.one", "Ayesha Khan", "SA", True),
    ("admin.two", "Bilal Ahmed", "SA", True),
    ("imran.shah", "Imran Shah", "SS", True),
    ("ahmed.raza", "Ahmed Raza", "GO", False),
    ("fatima.noor", "Fatima Noor", "RM", False),
    ("audit.ext", "External Auditor", "AU", False),
    ("khalid.m", "Khalid Mehmood", "RV", False),
]

CAMERAS = [
    ("Main Gate Entry Lane 1", "Main Gate", "Lane 1", "Entry", "Edge Node 1"),
    ("Main Gate Entry Lane 2", "Main Gate", "Lane 2", "Entry", "Edge Node 1"),
    ("Main Gate Exit Lane 1", "Main Gate", "Lane 1", "Exit", "Edge Node 1"),
    ("Service Gate Camera", "Service Gate", "Lane 1", "Bidirectional", "Edge Node 2"),
]

# plate_display, type, category, status, valid_days_from_now (None = no expiry)
VEHICLES = [
    ("LEA-4521", "car", "Staff", "Active", 300),
    ("LEB-9034", "car", "Staff", "Active", 300),
    ("ICT-992", "car", "Resident", "Active", 300),
    ("RIS-317", "car", "Resident", "Active", 300),
    ("GBR-118", "motorcycle", "Student", "Active", 120),
    ("LEF-2210", "car", "Student", "Active", 120),
    ("RIM-2045", "van", "Contractor", "Active", 30),
    ("LES-778", "truck", "Fleet", "Active", 300),
    ("LET-5520", "car", "Fleet", "Active", 300),
    ("VIP-101", "car", "VIP", "Active", 300),
    ("LEA-6640", "car", "Staff", "Suspended", 300),
    ("LXR-309", "car", "Resident", "Blacklisted", 300),
    ("LEH-1187", "car", "Contractor", "Active", -10),   # expired validity
    ("RIP-845", "auto-rickshaw", "Student", "Active", 120),
    ("LEJ-3301", "bus", "Fleet", "Active", 300),
    ("ICT-415", "car", "Pre-registered Visitor", "Active", 2),
]

PURPOSES = [
    ("Delivery", "Fleet"),
    ("Official visit", None),
    ("Parent meeting", None),
    ("Maintenance", "Contractor"),
    ("Student drop-off", "Student"),
    ("Event attendance", None),
    ("Medical emergency", None),
]

PLATE_FORMATS = [
    ("Punjab", r"^[A-Z]{3}-?\d{3,4}$", "LEA-4521"),
    ("Islamabad Capital Territory", r"^[A-Z]{2,3}-?\d{2,3}$", "ICT-992"),
    ("Sindh", r"^[A-Z]{3}-?\d{3,4}$", "BKA-204"),
    ("Khyber Pakhtunkhwa", r"^[A-Z]{2,3}-?\d{3,4}$", "PES-1187"),
    ("Generic", r"^[A-Z]{2,4}-?\d{1,4}$", "ABC-123"),
]


def seed(db=None):
    own = db is None
    db = db or SessionLocal()
    try:
        if db.query(models.User).count() == 0:
            for username, name, role, mfa in USERS:
                db.add(models.User(
                    username=username, full_name=name, role=role,
                    password_hash=security.hash_password(DEMO_PASSWORD),
                    mfa_secret=MFA_SECRETS.get(username, ""),
                    mfa_enabled=mfa,
                    email=f"{username}@example.edu.pk",
                ))
        if db.query(models.Camera).count() == 0:
            for name, gate, lane, role, edge in CAMERAS:
                db.add(models.Camera(name=name, gate=gate, lane=lane, role=role,
                                     edge_node=edge, status="online",
                                     last_frame_at=security.utcnow()))
        if db.query(models.Vehicle).count() == 0:
            from .engine import normalise_plate
            now = security.utcnow()
            for plate, vtype, category, status, days in VEHICLES:
                db.add(models.Vehicle(
                    plate_display=plate, plate_normalised=normalise_plate(plate),
                    type=vtype, category=category, status=status,
                    owner_name="Seed Owner", organisation="University",
                    valid_from=now - timedelta(days=30),
                    valid_to=(now + timedelta(days=days)) if days is not None else None,
                ))
        if db.query(models.PurposeOption).count() == 0:
            for label, default_cat in PURPOSES:
                db.add(models.PurposeOption(label=label, default_for_category=default_cat))
        if db.query(models.PlateFormat).count() == 0:
            for region, regex, example in PLATE_FORMATS:
                db.add(models.PlateFormat(region=region, regex=regex, example=example))
        db.commit()
    finally:
        if own:
            db.close()
