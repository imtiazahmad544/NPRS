# NPRS — Build Status

What is built and what remains, against SRS-NPRS-001 v1.0 / SDS-NPRS-001 v1.0.
**Release 1.0.0** — updated 24 November 2026. Full traceability: [`rtm/RTM.md`](rtm/RTM.md).

## Built ✅

### Documents & design
- [x] SRS-NPRS-001 v1.0 (requirements baseline) — `docs/`
- [x] SDS-NPRS-001 v1.0 (IEEE 1016 design) — `docs/`
- [x] UI/UX design, 30 screens (Figma + PDF) — `docs/`
- [x] Requirements Traceability Matrix — all 185 requirements traced to design, screens, acceptance tests and code — `rtm/`

### Core service (`backend/`)
- [x] Sign-in: Argon2id password hashing, minimum 12 characters, password history (last 5)
- [x] TOTP MFA — mandatory for System Administrator and Security Supervisor
- [x] Account lockout after 5 failed sign-ins (15 min) + alert
- [x] Sessions: 15-minute access tokens, 15-minute idle and 12-hour absolute limits, refresh rotation
- [x] RBAC: the full SRS §5.3 permission matrix (6 roles, 27 permissions), enforced on the server for every request, deny by default; separation of duties (SA cannot resolve reviews, Auditor read-only)
- [x] At least two active System Administrator accounts enforced by the system
- [x] Registry: create/edit/deactivate (soft delete), status changes (Active/Suspended/Blacklisted), search
- [x] Registry import CSV/XLSX up to 10,000 rows with preview and downloadable error report; export CSV/XLSX
- [x] Matching engine: exact match only; one-character Candidate Matches for human confirmation; Expired Registration flag; Suspended/Blacklisted Critical alerts; Type Mismatch flag
- [x] Event logging: confidence bands (accept ≥ 0.85, review 0.50–0.85, UNREADABLE below), UNKNOWN labelling everywhere, immutable events
- [x] Visit sessions: entry opens, exit closes with dwell time; Exit Without Entry, Repeated Entry, Unclosed handling; duplicate window (60 s) merge
- [x] Review queue: oldest first, confirm / correct / select candidate / mark Unknown / discard with reason; corrections create new versions, originals preserved; escalation flagging
- [x] Purpose of Visit: optional, list or ≤250-char free text, visitor details, inherited by the exit event, every change audited
- [x] Manual events (past time requires a reason, flagged Manual)
- [x] Alerts: 11 types with severities, acknowledgement with user + time, searchable history
- [x] Alert channels: in-app, SMTP email, SMS gateway, HMAC-signed webhooks (per-severity configuration)
- [x] Audit log: append-only, SHA-256 hash-chained, chain verification endpoint, export (Auditor)
- [x] Configuration screen: thresholds, duplicate window, overstay limits, retention periods, purpose list, plate formats, alert channels — validated, applied without restart, audited; JSON export
- [x] Retention: image/record purge jobs with legal-hold exclusion; legal hold place/release
- [x] Data protection: personal-data export and anonymising erasure
- [x] Reports: Daily Movement, Currently Inside, Unknown Vehicles, Dwell Time, Exceptions, Blacklist & Alerts, Camera Availability — JSON, CSV, XLSX and PDF with filter header
- [x] Event search: plate (partial), date range, type, status, class, camera, category, purpose, flag — paged
- [x] Evidence images: stored with SHA-256, hash verified on every view, views audited
- [x] Edge ingest API: idempotent (edge UUID), store-and-forward friendly, camera heartbeats and outage recording
- [x] Live push: WebSocket feed of new events to the web app
- [x] OpenAPI 3.0 documentation of the whole API (`/docs`)

### Web app (`frontend/`)
- [x] Sign In + MFA + forced password change + account-locked states
- [x] Dashboard (inside now, today counts, reviews waiting, active alerts, camera status, inside by category)
- [x] Live Monitor (push updates with polling fallback)
- [x] Event Log with full search filters and paging
- [x] Event Detail with evidence, visit session, correction history, Purpose of Visit editor, legal hold
- [x] Review Queue and Review Detail (all five resolution actions, candidate selection)
- [x] Manual Event form; Vehicles Inside with manual close (Supervisor)
- [x] Registry list, add/edit form, status changes, import preview/commit, export
- [x] Cameras list and Camera Setup (ROI and virtual line)
- [x] Alerts with acknowledgement; Reports with export; Users & Roles management
- [x] Audit Log with chain verification; Settings; Data Protection
- [x] Accessibility: WCAG 2.1 AA tokens, skip link, focus management, aria-live announcements, status always icon + word, keyboard-operable tables

### Edge tier (`edge/`)
- [x] Pipeline structure: detect → track → capture → recognise → package → deliver
- [x] Store-and-forward durable queue (≥72 h buffering, in-order resend, nothing lost)
- [x] Traffic simulator behind the detector/recogniser interfaces (known, unknown, misread, unreadable, plate-less passages; generated evidence images)
- [x] Heartbeats to the core for camera health

### Deployment
- [x] Dockerfile + docker-compose (PostgreSQL 15 + core), `run.sh` for local runs
- [x] SQLite for development/tests, PostgreSQL for production (same code)

### Testing (summary — see test report for detail)
- [x] 28 automated acceptance tests passing (auth/MFA/lockout, RBAC denials, matching, sessions, review, purpose, import, audit chain, config ranges, password history, reports)
- [x] Live end-to-end smoke run: 15 simulated vehicles processed correctly

## Remaining 🔧

### Recognition & cameras (site integration)
- [ ] Real vehicle detector + tracker model behind the `Detector` interface (YOLO-class)
- [ ] Real plate localisation + OCR model behind the `Recogniser` interface
- [ ] Model evaluation harness and site test set (≥2,000 images) to prove FR-DET-05 / FR-OCR-08 accuracy figures
- [ ] RTSP camera source (FFmpeg/OpenCV) and ONVIF discovery/configuration
- [ ] Live camera video preview in the Live Monitor, proxied by the core (FR-CAM-06)
- [ ] Edge packaging for gate hardware (GPU status reporting, watchdog, auto-start)

### Platform & operations
- [ ] Built-in background scheduler (today the periodic jobs run from the Settings screen or an external cron): review escalation timing, camera-offline checks, overstay checks, nightly retention and backups
- [ ] Unacknowledged Critical alert repeat every 5 minutes (FR-ALR-04)
- [ ] Scheduled emailed reports, daily/weekly (FR-RPT-06)
- [ ] Automated daily database + image backups with a tested restore (FR-DAT-05)
- [ ] Mutual TLS for edge↔core traffic (development uses a shared API key)
- [ ] TLS termination / HTTPS for the web app in production configuration
- [ ] Alert recipient lists per alert type (channels are configured; recipients are placeholders)
- [ ] PostgreSQL monthly partitioning enabled for the events table (DB-03, production tuning)
- [ ] Secrets moved from environment/demo seeds to a protected store; demo accounts replaced

### Documents
- [ ] Per-role user manuals (Gate Operator, Supervisor, Registry Manager, Auditor) (DOC-01)
- [ ] Administrator and installation/configuration guide (DOC-01)
- [ ] Camera installation checklist issued for the pilot gate (DOC-02)

### Verification still owed (not code)
- [ ] Accuracy acceptance on site video (AT-01…AT-12 figures)
- [ ] Performance verification on production-class hardware (NFR-PERF-01/02/06)
- [ ] Penetration test before release, no open high/critical findings (NFR-SEC-05)
- [ ] Pilot-period availability measurement, 99.5% target (NFR-REL-01)
