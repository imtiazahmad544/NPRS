# Changelog

## 1.0.0 — 24 November 2026

First versioned release. The complete implementation of SRS-NPRS-001 v1.0,
verified running end-to-end (core service + edge simulator + web app).

### Included
- **Core service** (`backend/`, FastAPI): Argon2id passwords + TOTP MFA,
  six-role RBAC enforced server-side per the SRS §5.3 matrix, vehicle
  registry with CSV/XLSX import (preview + error report), exact-match
  engine with one-character candidate matches, visit sessions and dwell
  time, review queue with versioned corrections, alerts, typed
  configuration, retention purge with legal holds, privacy export/erasure,
  and seven reports (JSON/CSV/XLSX/PDF).
- **Audit log**: append-only and hash-chained (FR-AUD-01..05); writes are
  serialised so concurrent activity cannot fork the chain.
- **Edge node** (`edge/`): detect → track → capture → recognise → package →
  deliver pipeline with a durable store-and-forward queue; ships with a
  traffic simulator. Detector/Recogniser are pluggable interfaces
  (SDS DD-02/DD-03) for the site camera/OCR models.
- **Web app** (`frontend/`): every screen built to the Figma UI/UX design
  (30 frames) — dashboard, live monitor, event log and detail, review
  queue and detail, manual events, vehicles inside, registry, cameras,
  alerts, reports, users & roles, audit log, settings, data protection.
- **Documents**: SRS, SDS and UI/UX design in `docs/`; Requirements
  Traceability Matrix (185 requirements) in `rtm/`; build status in
  `BUILD-STATUS.md`.

### Verification
- 29/29 automated tests pass (`pytest backend/tests -q`), including a
  concurrency test for the audit chain.
- Web app screens screenshot-compared against the Figma frames.
- Live run confirmed on Windows 10 (24 November 2026).

### Known remaining work
See `BUILD-STATUS.md` — principally the site-trained detector/OCR models,
RTSP camera integration and live video preview (FR-CAM-06), and the
production deployment items (PostgreSQL, TLS/mTLS, backups).
