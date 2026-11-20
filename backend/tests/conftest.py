"""Test fixtures: an isolated SQLite database and signed-in clients per role.

Tests map to the SRS acceptance tests (SRS §6.4); the mapping is listed in
rtm/RTM.md. Run: pytest backend/tests -q
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

_tmp = tempfile.mkdtemp(prefix="nprs-test-")
os.environ["NPRS_DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["NPRS_IMAGE_DIR"] = f"{_tmp}/images"
os.environ["NPRS_SECRET"] = "test-secret"

import pyotp  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.seed import MFA_SECRETS, DEMO_PASSWORD  # noqa: E402

EDGE_KEY = "dev-edge-key-change-in-production"


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def login(client, username):
    res = client.post("/api/auth/login", json={"username": username, "password": DEMO_PASSWORD})
    assert res.status_code == 200, res.text
    data = res.json()
    if data.get("mfa_required"):
        code = pyotp.TOTP(MFA_SECRETS[username]).now()
        res = client.post("/api/auth/mfa", json={"challenge": data["challenge"], "code": code})
        assert res.status_code == 200, res.text
        data = res.json()
    return {"Authorization": f"Bearer {data['access_token']}"}


@pytest.fixture(scope="session")
def sa(client):
    return login(client, "admin.one")


@pytest.fixture(scope="session")
def ss(client):
    return login(client, "imran.shah")


@pytest.fixture(scope="session")
def go(client):
    return login(client, "ahmed.raza")


@pytest.fixture(scope="session")
def rm(client):
    return login(client, "fatima.noor")


@pytest.fixture(scope="session")
def au(client):
    return login(client, "audit.ext")


@pytest.fixture(scope="session")
def rv(client):
    return login(client, "khalid.m")


@pytest.fixture(scope="session")
def cameras(client, sa):
    return client.get("/api/cameras", headers=sa).json()["cameras"]


def make_image_b64():
    import base64
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (320, 180), (40, 60, 90)).save(buf, "JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def ingest(client, camera, ts, plate="LEA-4521", conf=0.97, uuid=None,
           vclass="car", class_conf=0.95, no_plate=False):
    import uuid as uuidlib
    pkg = {
        "edge_uuid": uuid or str(uuidlib.uuid4()),
        "camera_id": camera["id"], "ts": ts,
        "plate_raw": plate, "plate_normalised": plate.replace("-", ""),
        "confidence": conf, "vehicle_class": vclass,
        "class_confidence": class_conf, "no_plate": no_plate,
        "images": [{"kind": "full", "data_b64": make_image_b64()},
                   {"kind": "plate", "data_b64": make_image_b64()}],
        "model_version": "test-1.0",
    }
    res = client.post("/api/ingest/events", json=pkg, headers={"X-Edge-Key": EDGE_KEY})
    assert res.status_code == 200, res.text
    return res.json()
