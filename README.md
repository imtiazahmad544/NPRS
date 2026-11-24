# NPRS — Number Plate Recognition & Vehicle Access Logging System

Automatic vehicle detection, number plate reading, and entry/exit logging with role-based access control — implemented against **SRS-NPRS-001 v1.0** and designed in **SDS-NPRS-001 v1.0**.

**Version 1.0.0** (24 November 2026) — see [`CHANGELOG.md`](CHANGELOG.md) and [`BUILD-STATUS.md`](BUILD-STATUS.md).

| Document | Location |
| --- | --- |
| Software Requirements Specification (SRS-NPRS-001 v1.0) | `docs/SRS-NPRS-001.docx` |
| Software Design Specification (SDS-NPRS-001 v1.0) | `docs/SDS-NPRS-001.docx` / `.pdf` |
| UI/UX design (30 screens, Figma) | `docs/NPRS-UI-UX-Design.pdf` · [Figma file](https://www.figma.com/design/EdjbRuN5qZncopOlpT44bp) |
| Requirements Traceability Matrix | `rtm/RTM.md` · `rtm/RTM.csv` |

## What this system does

Every vehicle that passes a gate lane is detected, photographed, and read automatically. A plate that exactly matches the registry is logged as a **Known** entry or exit with a visit session and dwell time. Anything else is logged as **UNKNOWN** — nothing is ever silently dropped. Uncertain readings (low confidence, one-character near matches, unreadable plates) go to a **review queue** where a person confirms, corrects, or discards them — corrections are new versions, originals are never overwritten. The **Purpose of Visit** is optional and never blocks an event. Access is governed by a six-role RBAC matrix enforced on the server for every request, and every sensitive action lands in an **append-only, hash-chained audit log**.

## Architecture (SDS §2)

- **Edge tier** (`edge/`) — per-gate processing: detection → tracking → best-frame capture → plate reading → store-and-forward delivery. Ships with a simulator that exercises the full pipeline; the recogniser is a pluggable interface (SDS DD-02/DD-03) so a YOLO-class detector + plate OCR model drops in without touching the core.
- **Core tier** (`backend/`) — FastAPI service owning all business rules: matching, sessions, review, alerts, RBAC, audit chain, configuration, retention. PostgreSQL in production (SDS DD-04); SQLite works for development and tests.
- **Presentation tier** (`frontend/`) — the accessible web app implementing the Figma design system (WCAG 2.1 AA): dashboard, live monitor, event log, review queue, registry, cameras, reports, alerts, users, audit log, settings — each role sees only what it may use.

## Run it

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements.txt
./run.sh                      # API + web app on http://localhost:8000
```

In a second terminal, feed it live traffic:

```bash
python edge/edge_node.py --server http://localhost:8000 --interval 4
```

Run the tests (they trace to the SRS acceptance tests — see `rtm/RTM.md`):

```bash
pytest backend/tests -q
```

## Demo accounts (development only — change before any real use)

All passwords: `NprsDemo#2026` · MFA (TOTP) is mandatory for System Administrators and Security Supervisors; add the listed secret to any authenticator app, or get the current code with `python backend/tools/totp.py <secret>`.

| User name | Role | MFA secret (demo) |
| --- | --- | --- |
| admin.one | System Administrator | `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` |
| admin.two | System Administrator | `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` |
| imran.shah | Security Supervisor | `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` |
| ahmed.raza | Gate Operator | not required |
| fatima.noor | Registry Manager | not required |
| audit.ext | Auditor | not required |
| khalid.m | Report Viewer | not required |

**These are demo values for a development environment, not production credentials.**

## Repository layout

```
docs/       SRS, SDS, UI/UX PDF
rtm/        Requirements Traceability Matrix (every requirement → design → screen → test)
backend/    FastAPI core service + pytest suite
edge/       Edge-node pipeline + simulator
frontend/   Web application (no build step)
```

## Scope honesty

Release 1.0 per SRS §2.7: no barrier control, no payments, no biometrics, no speed enforcement. The recognition models are interfaces with a simulation behind them in this repository — camera hardware and site-trained models are deployment activities (SRS Appendix A.4), and the acceptance figures of FR-DET-05 / FR-OCR-08 are verified on site video per SRS §6.3, not in CI. Everything else — logging, matching, sessions, review, alerts, RBAC, audit, retention, reporting — is real, working, and tested here.
