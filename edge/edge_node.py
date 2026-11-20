#!/usr/bin/env python3
"""NPRS edge node — per-gate pipeline (SDS §2.2, components C-01..C-05).

Pipeline per vehicle: detect -> track -> capture best frames -> recognise
plate -> package -> deliver. Delivery is store-and-forward: packages are
written to a durable local queue first and removed only after the core
confirms storage, so a network outage loses nothing (FR-LOG-12, NFR-REL-02)
and the 72-hour buffer is simply this queue on disk.

The recogniser is an interface (SDS DD-02/DD-03). This repository ships a
simulator behind it that generates realistic traffic — known vehicles,
unknown vehicles, one-character misreads, unreadable plates, plate-less
vehicles — so the whole system can be run and tested without cameras.
At deployment, a YOLO-class detector and a plate OCR model implement the
same two interfaces and nothing else changes.

Usage:
    python edge/edge_node.py --server http://localhost:8000 --interval 4
    python edge/edge_node.py --server http://localhost:8000 --count 25 --burst
"""
import argparse
import base64
import io
import json
import os
import random
import sys
import time
import urllib.request
import uuid
from datetime import datetime, timezone

MODEL_VERSION = "sim-recogniser-1.0"
QUEUE_DIR = os.environ.get("NPRS_EDGE_QUEUE", "./edge-queue")

# Plates the simulator "sees". Known ones mirror backend/app/seed.py so a
# fresh system demonstrates Known matches, flags and alerts immediately.
KNOWN_PLATES = ["LEA-4521", "LEB-9034", "ICT-992", "RIS-317", "GBR-118",
                "LEF-2210", "RIM-2045", "LES-778", "LET-5520", "VIP-101",
                "LEA-6640",   # Suspended in the seed registry
                "LXR-309",    # Blacklisted in the seed registry
                "LEH-1187",   # Expired validity in the seed registry
                "RIP-845", "LEJ-3301", "ICT-415"]
UNKNOWN_PLATES = ["XYZ-100", "QRS-777", "ZZT-431", "MNO-208", "KPK-552"]
VEHICLE_CLASSES = ["car", "car", "car", "van", "motorcycle", "truck", "bus",
                   "auto-rickshaw"]


# ------------------------------------------------------------------ images

def _make_images(plate_text, vehicle_class):
    """Draw a simple scene image and a plate crop (JPEG, like C-03 output)."""
    from PIL import Image, ImageDraw
    scene = Image.new("RGB", (640, 360), (52, 68, 86))
    d = ImageDraw.Draw(scene)
    d.rectangle([0, 280, 640, 360], fill=(38, 44, 52))          # road
    d.rectangle([90, 150, 550, 285], fill=(120, 130, 145))      # vehicle body
    d.rectangle([150, 105, 490, 155], fill=(95, 108, 125))      # cabin
    d.rectangle([255, 225, 385, 262], fill=(240, 240, 235))     # plate area
    d.text((268, 238), plate_text or "—", fill=(20, 20, 20))
    d.text((12, 10), f"{vehicle_class}", fill=(230, 230, 230))
    crop = scene.crop((245, 218, 395, 268)).resize((300, 100))
    out = []
    for kind, img in (("full", scene), ("plate", crop)):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=88)
        out.append({"kind": kind, "data_b64": base64.b64encode(buf.getvalue()).decode()})
    return out


# ------------------------------------------------------------------ pipeline stages (interfaces)

class Detector:
    """C-02 interface. A production build wraps a vehicle detector here."""

    def detect(self, frame):
        raise NotImplementedError


class Recogniser:
    """C-04 interface. A production build wraps plate OCR here and returns
    (plate_raw, plate_normalised, confidence) per SDS §6.1."""

    def read_plate(self, crop):
        raise NotImplementedError


class SimulatedTraffic:
    """Generates one vehicle passage per call, with realistic failure mix:
    ~62% clean known, ~12% clean unknown, ~8% one-character misread,
    ~7% low-confidence, ~5% unreadable, ~3% no plate, ~3% suspended/
    blacklisted/expired demonstrations via the known pool."""

    def __init__(self, rng=None):
        self.rng = rng or random.Random()

    def next_passage(self):
        r = self.rng.random()
        vclass = self.rng.choice(VEHICLE_CLASSES)
        if r < 0.03:
            return {"plate": None, "confidence": 0.0, "no_plate": True,
                    "vehicle_class": "bicycle", "class_confidence": 0.9}
        if r < 0.08:
            plate = self.rng.choice(KNOWN_PLATES + UNKNOWN_PLATES)
            return {"plate": plate, "confidence": round(self.rng.uniform(0.2, 0.45), 2),
                    "no_plate": False, "vehicle_class": vclass, "class_confidence": 0.9}
        if r < 0.15:
            plate = self.rng.choice(KNOWN_PLATES + UNKNOWN_PLATES)
            return {"plate": plate, "confidence": round(self.rng.uniform(0.55, 0.82), 2),
                    "no_plate": False, "vehicle_class": vclass, "class_confidence": 0.9}
        if r < 0.23:
            plate = self.rng.choice(KNOWN_PLATES)
            chars = list(plate)
            idx = self.rng.randrange(len(chars))
            if chars[idx].isdigit():
                chars[idx] = str((int(chars[idx]) + 1) % 10)
            else:
                chars[idx] = "B" if chars[idx] != "B" else "D"
            return {"plate": "".join(chars), "confidence": round(self.rng.uniform(0.86, 0.96), 2),
                    "no_plate": False, "vehicle_class": vclass, "class_confidence": 0.92}
        plate = self.rng.choice(KNOWN_PLATES * 3 + UNKNOWN_PLATES)
        return {"plate": plate, "confidence": round(self.rng.uniform(0.88, 0.99), 2),
                "no_plate": False, "vehicle_class": vclass,
                "class_confidence": round(self.rng.uniform(0.85, 0.99), 2)}


# ------------------------------------------------------------------ delivery (C-05)

class StoreAndForward:
    """Durable on-disk queue. A package leaves only after the core confirms."""

    def __init__(self, queue_dir, server, api_key):
        self.dir = queue_dir
        self.server = server.rstrip("/")
        self.api_key = api_key
        os.makedirs(self.dir, exist_ok=True)

    def enqueue(self, package):
        path = os.path.join(self.dir, f"{package['edge_uuid']}.json")
        with open(path, "w") as fh:
            json.dump(package, fh)
        return path

    def flush(self):
        sent = 0
        for name in sorted(os.listdir(self.dir)):
            if not name.endswith(".json"):
                continue
            path = os.path.join(self.dir, name)
            with open(path) as fh:
                package = json.load(fh)
            if self._post("/api/ingest/events", package):
                os.remove(path)
                sent += 1
            else:
                break  # server unreachable: keep order, retry next cycle
        return sent

    def heartbeat(self, camera_id):
        return self._post("/api/ingest/heartbeat",
                          {"camera_id": camera_id, "accelerator": "simulated"})

    def _post(self, path, payload):
        try:
            req = urllib.request.Request(
                self.server + path,
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json", "X-Edge-Key": self.api_key},
                method="POST")
            with urllib.request.urlopen(req, timeout=5) as resp:
                return 200 <= resp.status < 300
        except Exception:
            return False

    def pending(self):
        return len([n for n in os.listdir(self.dir) if n.endswith(".json")])


def main():
    ap = argparse.ArgumentParser(description="NPRS edge node simulator")
    ap.add_argument("--server", default="http://localhost:8000")
    ap.add_argument("--api-key", default=os.environ.get("NPRS_EDGE_API_KEY",
                                                        "dev-edge-key-change-in-production"))
    ap.add_argument("--cameras", default="",
                    help="Comma-separated camera IDs from the core (Cameras screen). "
                         "If omitted, the node discovers them via the demo sign-in.")
    ap.add_argument("--interval", type=float, default=5.0, help="Seconds between vehicles")
    ap.add_argument("--count", type=int, default=0, help="Stop after N vehicles (0 = run forever)")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()

    queue = StoreAndForward(QUEUE_DIR, args.server, args.api_key)
    traffic = SimulatedTraffic(random.Random(args.seed))

    camera_ids = [c.strip() for c in args.cameras.split(",") if c.strip()]
    if not camera_ids:
        camera_ids = _discover_cameras(args.server)
    if not camera_ids:
        print("No cameras known. Start the core first (it seeds 4 cameras), "
              "or pass --cameras.", file=sys.stderr)
        return 1
    print(f"Edge node up. Cameras: {len(camera_ids)} · server {args.server} · "
          f"queue pending: {queue.pending()}")

    made = 0
    try:
        while True:
            passage = traffic.next_passage()
            camera_id = camera_ids[made % len(camera_ids)]
            plate = passage["plate"] or ""
            package = {
                "edge_uuid": str(uuid.uuid4()),
                "camera_id": camera_id,
                "ts": datetime.now(timezone.utc).isoformat(),
                "direction": "inbound",
                "plate_raw": plate,
                "plate_normalised": plate.replace("-", ""),
                "confidence": passage["confidence"],
                "vehicle_class": passage["vehicle_class"],
                "class_confidence": passage["class_confidence"],
                "no_plate": passage["no_plate"],
                "images": _make_images(plate, passage["vehicle_class"]),
                "model_version": MODEL_VERSION,
            }
            queue.enqueue(package)
            sent = queue.flush()
            queue.heartbeat(camera_id)
            made += 1
            print(f"[{made}] {passage['vehicle_class']:>13}  plate={plate or '(none)':>9}  "
                  f"conf={passage['confidence']:.2f}  delivered={sent}  pending={queue.pending()}")
            if args.count and made >= args.count:
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nEdge node stopped. Undelivered packages remain in the queue "
              f"({queue.pending()}) and will be sent on the next start.")
    return 0


def _discover_cameras(server):
    """Development convenience: sign in with the seeded Gate Operator and
    read the camera list. Production edges are provisioned, not signed in."""
    import urllib.error
    def call(path, payload=None, token=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(server.rstrip("/") + path, data=data,
                                     headers={"Content-Type": "application/json",
                                              **({"Authorization": f"Bearer {token}"} if token else {})},
                                     method="POST" if payload is not None else "GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read())
    try:
        login = call("/api/auth/login", {"username": "ahmed.raza", "password": "NprsDemo#2026"})
        cams = call("/api/cameras", token=login["access_token"])
        return [c["id"] for c in cams["cameras"]]
    except Exception:
        return []


if __name__ == "__main__":
    raise SystemExit(main())
