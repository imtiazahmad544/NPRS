#!/usr/bin/env python3
"""Generate RTM.md and RTM.csv from the mapping data below.
Every requirement of SRS-NPRS-001 v1.0 -> SDS design (component/section)
-> UI/UX frame -> acceptance test -> implementation in this repository.
"""
import csv, io

# id, requirement (short), SDS design, UI/UX frame, acceptance test, implementation, status
ROWS = []
def add(*r): ROWS.append(r)

# ---- External interfaces ----
add('UI-01','Responsive UI, usable 1024x768 to 1920x1080','SDS 8.1 design system','All frames','AT-71','frontend/styles.css (fluid layout, 260px sidebar)','Implemented')
add('UI-02','UI shows only what the role permits','SDS 8.2, 9.1 (C-14)','All frames (role-shaped nav); Access Denied (403)','AT-54','frontend/app.js (permission-driven nav) + backend/app/rbac.py','Implemented')
add('UI-03','UNKNOWN shown as text, never colour alone','SDS 8.2','All event frames','AT-24, AT-71','frontend/app.js status chips (icon + word)','Implemented')
add('UI-04','Live Monitor overlays boxes, class, plate','SDS 8.2 (C-11)','Live Monitor','AT-42','frontend Live Monitor view + edge overlays data','Implemented')
add('UI-05','Review screen: images, crop, editable plate, candidates, 4 actions','SDS 8.2 (C-09)','Review Detail','AT-37','frontend Review view; backend/app/engine.py review actions','Implemented')
add('UI-06','Purpose of Visit labelled Optional, on details and live list','SDS 8.2 (C-08)','Event Detail (both); Dashboard','AT-33','frontend purpose component','Implemented')
add('UI-07','Errors state cause and fix in plain language','SDS 7.2, App. B','Sign In states; all forms','AT-71','backend error catalogue; frontend messages','Implemented')
add('UI-08','Dates in site time zone, "20 November 2026, 10:42:07"','SDS 8.2','All frames','AT-30','frontend formatDateTime()','Implemented')
add('UI-09','WCAG 2.1 Level AA','SDS 8.1, 8.2','Foundations frame','AT-71','frontend (tokens, focus, live regions, keyboard)','Implemented')
add('HW-01','Video from IP cameras over RTSP; ONVIF S/T discovery/config','SDS 7.1 (C-01)','Camera Setup','AT-47, AT-49','edge/edge_node.py CameraSource interface','Interface implemented; hardware at deployment')
add('HW-02','Edge GPU/accelerator used; status reported to server','SDS 5 C-05 heartbeat','Cameras - List & Health','AT-67','edge heartbeat (accelerator field); backend ingest','Implemented (simulated accelerator)')
add('HW-03','Edge and server clocks NTP-synced at <= 10 min intervals','SDS 2.4, 10.2','Settings','AT-30','Deployment NTP config; drift alert in engine jobs','Deployment configuration')
add('HW-04','Event notification output for a future barrier; nothing actuated in 1.0','SDS 7.1 (C-13 webhooks)','Settings (noted)','Design review','backend webhooks (signed event output)','Implemented')
add('SW-01','Structured data in PostgreSQL 15+','SDS 3 DD-04','-','Design review','backend/app/db.py (SQLAlchemy; PostgreSQL in prod, SQLite in dev)','Implemented')
add('SW-02','Images on local file system or S3-compatible store by config','SDS 4.3','-','AT-06','backend image store (local path in config)','Implemented (local store)')
add('SW-03','REST API, JSON, documented in OpenAPI 3.0','SDS 7.2, App. A','-','AT-54 (API parity)','backend FastAPI (auto OpenAPI at /docs)','Implemented')
add('SW-04','Email via configurable SMTP with TLS','SDS 3 DD-12 (C-13)','Settings','AT-16, AT-45','backend/app/notify.py (SMTP)','Implemented')
add('SW-05','SMS via configurable HTTPS gateway','SDS 3 DD-12 (C-13)','Settings','AT-16','backend/app/notify.py (gateway POST)','Implemented')
add('SW-06','Alerts/events as signed HTTPS webhooks','SDS 7.1 (C-13)','Settings','AT-16','backend/app/notify.py (HMAC signature header)','Implemented')
add('CM-01','Browser-server traffic over HTTPS, TLS 1.2+','SDS 9.3','-','AT-63','Deployment (TLS termination); app refuses plain HTTP in prod config','Deployment configuration')
add('CM-02','Edge-server traffic over HTTPS with mutual certificates','SDS 7.1','-','Design review','Ingest API key in dev; mTLS at deployment (documented)','Deployment configuration')
add('CM-03','Camera streams only on the isolated camera segment','SDS 2.4','Cameras','Design review','Deployment network design; preview proxied by core (C-11)','Deployment configuration')
add('CM-04','NTP on UDP 123, port configurable','SDS 7.1','Settings','AT-30','Config key ntp_port','Implemented')

# ---- Cameras ----
for i, t in enumerate(['Acquire live video over RTSP (H.264/H.265)','Process >= 8 streams per edge node at 1080p/15fps','Store camera record: name, site, gate, lane, role, stream, encrypted credentials, ROI, virtual line, status','Declare offline after 10 s without a frame; alert within 15 s','Retry lost stream 5 s backing off to 60 s; log outage start/end','Live preview of every active camera with <= 3 s delay','Add/edit/disable/delete a camera without interrupting others','Timestamp each frame at receipt with the synchronised clock'], 1):
    add(f'FR-CAM-{i:02d}', t, 'SDS 5 C-01', 'Cameras - List & Health; Camera Setup', 'AT-47, AT-48, AT-49' if i in (4,5,7) else 'AT-42', 'edge/edge_node.py + backend cameras API', 'Implemented (simulated streams)' if i in (1,2,8) else 'Implemented')

# ---- Detection ----
for i, t in enumerate(['Detect every vehicle in the ROI at >= 10 fps per camera','Classify: car, motorcycle, scooter, auto-rickshaw, van, bus, truck, bicycle, other','Unique track ID per vehicle while visible','Direction from track position vs virtual line','Reference Conditions: >= 98% detection, >= 92% classification','Ignore pedestrians/animals/shadows/reflections; <= 2 false events per 100','Operate day and night using IR illumination','Detect plate-less vehicles; plate status No Plate Detected; event still created'], 1):
    add(f'FR-DET-{i:02d}', t, 'SDS 5 C-02', 'Live Monitor', 'AT-01..AT-04, AT-07', 'edge/edge_node.py Detector interface + simulator', 'Implemented (simulated detector); accuracy = site verification' if i in (5,6) else 'Implemented (simulated detector)')

# ---- Capture ----
for i, t in enumerate(['Capture >= 1 full vehicle image and 1 plate crop per track','Evaluate up to 5 frames; best by sharpness/contrast/plate completeness (>= 120 px plate)','Capture completes within 500 ms of trigger','JPEG quality >= 85 with event/camera/timestamp metadata','SHA-256 hash per image, verified on retrieval','Images immutable; redaction creates a derived copy','Edge keeps image until server confirms storage'], 1):
    add(f'FR-CAP-{i:02d}', t, 'SDS 5 C-03; 4.3', 'Event Detail (evidence)', 'AT-05, AT-06', 'edge capture + backend image store with hash verify', 'Implemented')

# ---- OCR ----
for i, t in enumerate(['Locate the plate in the vehicle image','Read characters; confidence per character and per plate','Read single-line, two-line, front and rear plates','Normalise (upper case, strip spaces/hyphens/punctuation); keep raw text','Plate format rules (regex per region) validate and resolve O/0, I/1, B/8, S/5, Z/2, G/6','Multi-frame weighted voting for the final text','Thresholds: accept >= 0.85; review 0.50-0.85; below = UNREADABLE (configurable)','Reference Conditions: >= 95% plate accuracy, >= 98% character accuracy (test set >= 2000)','Recognition completes within 2 s of capture end','Latin letters/digits; further character sets by configuration','Store raw, normalised, confidences and model version with every event'], 1):
    add(f'FR-OCR-{i:02d}', t, 'SDS 5 C-04; 6.1-6.3', 'Review Detail; Foundations (thresholds)', 'AT-08..AT-12', 'edge recognizer interface + backend threshold rule (engine.py)', 'Implemented (simulated recogniser); accuracy = site verification' if i == 8 else 'Implemented')

# ---- Registry & matching ----
reg = ['Registry fields: plate, type, make/model, colour, owner, organisation, contact, category, validity, status, remarks','Unique normalised plate among non-deleted records','Exact match with an Active record = Known Vehicle','One-character difference = Candidate Match + review; never auto-accepted','Expired validity: event Known + Expired Registration flag + alert','Suspended/Blacklisted match: event recorded + immediate Critical alert','Create/view/edit/deactivate; soft deletion keeps history','CSV/XLSX import up to 10,000 rows; valid rows only; downloadable error report','Export registry to CSV and XLSX','Search registry by plate, owner, category, status','Detected class != registered type = Type Mismatch flag','Match within 200 ms at 500,000 records']
for i, t in enumerate(reg, 1):
    add(f'FR-REG-{i:02d}', t, 'SDS 5 C-06; 6.4', 'Registry List; Vehicle Form; Import', 'AT-13..AT-21', 'backend/app/engine.py matching + registry API', 'Implemented')

# ---- Logging & sessions ----
log = ['Event type from camera role; Bidirectional from track direction','Known vehicle: event created automatically with all fields, status Known','Unknown vehicle: event created automatically, status UNKNOWN, plate as read','Unreadable plate: event UNKNOWN + plate UNREADABLE + review task','Timestamps UTC with ms precision; displayed in site zone; drift <= 1 s','Visit sessions: entry opens; exit closes most recent open and computes dwell','Exit with no open session kept + flagged Exit Without Entry','Repeated entry flagged; earlier session left open and flagged Unclosed','Same plate+camera within duplicate window (default 60 s) = one event, images attached','Events immutable; corrections are new linked versions','New event visible in live list within 3 s','Edge stores events/images >= 72 h offline; resends in order, no loss, no duplicates','UNKNOWN label in every list, report and export','Overstay beyond category limit raises an overstay alert']
for i, t in enumerate(log, 1):
    add(f'FR-LOG-{i:02d}', t, 'SDS 5 C-07; 4.4, 4.6; 6.5, 6.6', 'Dashboard; Event Log; Live Monitor', 'AT-22..AT-32', 'backend/app/engine.py logging + sessions', 'Implemented')

# ---- Purpose of visit ----
pov = ['Purpose field on every event; never mandatory; never blocks/delays the event','Select from configurable list or free text up to 250 characters','Operator enters at event time; authorised user may add/change later','Unknown vehicles: optional visitor name, contact number, person visited','Purpose copied from entry to its session and shown on the exit event','Every purpose change audited with the previous value','Default purpose prefilled from vehicle category when configured; editable','Administrator maintains the purpose list']
for i, t in enumerate(pov, 1):
    add(f'FR-POV-{i:02d}', t, 'SDS 5 C-08', 'Event Detail (both); Manual Event', 'AT-33..AT-36', 'backend purpose endpoints + audit', 'Implemented')

# ---- Review & manual ----
rev = ['Review task for Needs Review, Candidate Match, unreadable, low class confidence, no plate','Queue shows images, raw text, candidates, waiting time; oldest first; waiting count','Reviewer: confirm, correct, select candidate, mark Unknown, discard (reason required)','Correction creates a new linked version; original values remain','Unresolved in configured time (default 15 min) escalates to Security Supervisor','Manual event with plate/type/time; past time needs a reason; flagged Manual','Events recorded immediately with provisional status; review updates status only']
for i, t in enumerate(rev, 1):
    add(f'FR-REV-{i:02d}', t, 'SDS 5 C-09, C-10', 'Review Queue; Review Detail; Manual Event; Discard modal', 'AT-37..AT-41', 'backend review service + frontend Review views', 'Implemented')

# ---- Dashboard ----
for i, t in enumerate(['Dashboard: inside now, entries today, exits today, unknown today, waiting reviews, active alerts','Live feed of latest 50 events with thumbnails, plate, status, type, time, purpose','Status of every camera and edge node','Updates by server push within 3 s, no manual refresh','Vehicles inside grouped by category'], 1):
    add(f'FR-DSH-{i:02d}', t, 'SDS 5 C-11', 'Dashboard', 'AT-42', 'backend dashboard API + WebSocket push; frontend Dashboard', 'Implemented')

# ---- Search, reports, export ----
rpt = ['Search events by plate (full/partial), range, type, status, class, camera, category, owner, purpose, flag','Results <= 3 s at 1,000,000 events; paged 50 per page','Reports: Daily Movement, Currently Inside, Unknown Vehicles, Dwell Time, Exceptions, Blacklist & Alerts, Camera Availability','Export to PDF, CSV, XLSX with filter criteria, generation time, user name','Export only with export permission; images only with image permission','Selected report emailed on daily/weekly schedule','Event details show evidence images with zoom and full history incl. corrections']
for i, t in enumerate(rpt, 1):
    add(f'FR-RPT-{i:02d}', t, 'SDS 5 C-12', 'Event Log; Event Detail; Reports', 'AT-43..AT-45', 'backend reports API (CSV/XLSX/PDF)', 'Implemented')

# ---- Alerts ----
alr = ['Alert types: blacklist, suspended, expired, camera offline, review overdue, overstay, exit-without-entry, repeated entry, storage > 85%, sync failure, repeated failed sign-in','Severity: Critical, Warning, Information','In-app within 5 s; email/SMS/webhook per alert-type configuration','Acknowledge records user and time; unacknowledged Critical repeats every 5 min','Alert history searchable by type, severity, time, acknowledgement state']
for i, t in enumerate(alr, 1):
    add(f'FR-ALR-{i:02d}', t, 'SDS 5 C-13', 'Alerts', 'AT-16, AT-46, AT-47', 'backend alerts + notify.py', 'Implemented')

# ---- Security / RBAC ----
sec = ['Unique user name + password >= 12 chars; Argon2id/bcrypt salted hashes only','TOTP MFA mandatory for SA and SS; optional for other roles','Lock account 15 min after 5 consecutive failed sign-ins; raise alert','Session ends after 15 min inactivity and 12 h total','Roles: SA, SS, GO, RM, AU, RV','Permissions of SRS Section 5 enforced on the server for every request; deny by default','Only SA creates/disables/deletes users and assigns roles; always >= 2 active SA accounts','Role change applies from the next request, including open sessions','Own password change + MFA enrolment; admin reset forces change at next sign-in','Reject reuse of the last 5 passwords','Disabled user cannot sign in; their records and actions remain','API tokens expire <= 15 min; renewable by refresh token']
for i, t in enumerate(sec, 1):
    add(f'FR-SEC-{i:02d}', t, 'SDS 5 C-14; 9.1, 9.2', 'Sign In set; Users & Roles; Access Denied', 'AT-50..AT-58', 'backend/app/security.py + rbac.py', 'Implemented')

# ---- Audit ----
aud = ['Audit entries for: sign-in/out, user/role changes, registry changes, corrections, discards, manual events, purpose changes, config, cameras, exports, image downloads, purges','Entry fields: id, UTC time, user, role, source address, action, object, object id, previous value, new value, result','Append-only; no role (incl. SA) can change or delete an entry','Each entry carries the previous entry hash; chain verifiable on demand','Audit entries kept at least 2 years','Auditor can view, search and export the audit log']
for i, t in enumerate(aud, 1):
    add(f'FR-AUD-{i:02d}', t, 'SDS 5 C-14; 6.7; DB-05', 'Audit Log', 'AT-59, AT-60', 'backend/app/audit.py (hash chain)', 'Implemented')

# ---- Configuration ----
for i, t in enumerate(['Settings screen: thresholds, duplicate window, plate formats, overstay per category, retention, purpose list, time zone, alert channels, recipients','Every setting validated against its allowed range; invalid rejected with explanation','Changed setting applies within 60 s without restart; change audited','Configuration export/import as JSON'], 1):
    add(f'FR-CFG-{i:02d}', t, 'SDS 5 C-15', 'Settings', 'AT-61', 'backend config service', 'Implemented')

# ---- Data retention & protection ----
dat = ['Images kept configurable period (default 90 days); records (default 2 years)','Automatic daily purge in low-load period; purged counts logged','Legal hold excludes events from purging','AES-256 at rest; TLS 1.2+ in transit','Daily DB backup + incremental image backup; 30 days kept; restore test supported','On documented request: export or erase a person\'s personal data; events kept anonymised','Owner name/contact shown only to roles with registry-view permission','Every image view and download recorded in the audit log']
for i, t in enumerate(dat, 1):
    add(f'FR-DAT-{i:02d}', t, 'SDS 5 C-16; 4.5', 'Settings; Data Protection', 'AT-62..AT-65', 'backend retention/privacy jobs', 'Implemented')

# ---- Non-functional ----
nfr = [
 ('NFR-PERF-01','Virtual line to stored+visible <= 3 s (p95), <= 5 s (p99)','SDS 10.1','Dashboard; Live Monitor','AT-66','Edge processing + transactional ingest + push','Implemented; timing verified on site'),
 ('NFR-PERF-02','Edge node processes 8 streams concurrently within budgets','SDS 10.1','Cameras','AT-67','Edge pipeline design','Site verification'),
 ('NFR-PERF-03','50 concurrent web users; page loads <= 2 s (p95)','SDS 10.1','All frames','AT-68','Stateless API + aggregated dashboard queries','Implemented'),
 ('NFR-PERF-04','Burst of 10 vehicles in 10 s on one lane without loss','SDS 10.1','-','AT-67','Per-vehicle tracking + queue-backed ingest','Implemented (simulator burst test)'),
 ('NFR-PERF-05','Database holds 10M events; search within 3 s','SDS 10.1; DB-03','Event Log','AT-43','Monthly partitioning (PostgreSQL) + indexes','Implemented'),
 ('NFR-PERF-06','All services ready within 3 min of a power restart','SDS 10.1','-','AT-69','Container restart policies; edge queue resume','Deployment verification'),
 ('NFR-REL-01','Monthly availability >= 99.5% for event capture (excl. announced maintenance)','SDS 10.2','-','Pilot period','Edge autonomy design','Design provision'),
 ('NFR-REL-02','No detected event is ever lost, incl. network loss and restarts','SDS 10.2; 4.6','-','AT-29, AT-69','Durable edge queue + idempotent ingest','Implemented'),
 ('NFR-REL-03','Failed service restarts automatically within 60 s','SDS 10.2','-','AT-69','Supervisor/container restart policy','Deployment configuration'),
 ('NFR-REL-04','RTO 1 hour; RPO 15 minutes','SDS 10.2','-','AT-64','Backups (FR-DAT-05) + edge buffers','Implemented'),
 ('NFR-SEC-01','OWASP ASVS 4.0 Level 2','SDS 9.3','-','AT-72','Security design + dependency hygiene','Implemented; pen test before release'),
 ('NFR-SEC-02','Server-side input validation; injection/XSS/CSRF protection','SDS 9.3','-','AT-72','Pydantic validation, ORM parameterisation, output encoding','Implemented'),
 ('NFR-SEC-03','No credentials/keys in source; secrets in a protected store','SDS 9.3','-','Code review','Environment-based secrets; demo seeds marked as demo','Implemented'),
 ('NFR-SEC-04','Image store not accessible without authentication/authorisation','SDS 9.3','Event Detail','AT-58','Images served only via authorised API','Implemented'),
 ('NFR-SEC-05','Penetration test before release; no open high/critical findings','SDS 9.3','-','AT-72','Release gate (process)','Process requirement'),
 ('NFR-USA-01','Trained Gate Operator resolves a review task in <= 3 interactions','SDS 8.4','Review Detail','AT-70','Review UX (open, compare, decide)','Implemented'),
 ('NFR-USA-02','New Gate Operator performs daily tasks after <= 2 h training','SDS 8.4','All frames','AT-70','Plain-language UI + role manuals (DOC-01)','Implemented'),
 ('NFR-USA-03','Visible confirmation after every create/update/delete','SDS 8.2','All frames','Use-case tests','Frontend toast/confirmation pattern','Implemented'),
 ('NFR-MNT-01','Modular structure: detection, recognition, business rules, presentation separated','SDS 5, 7.3','-','Design review','edge/ + backend components C-01..C-16','Implemented'),
 ('NFR-MNT-02','Automated unit tests cover >= 80% of business-rule code','SDS 10.3','-','Test report','backend/tests (pytest)','Implemented'),
 ('NFR-MNT-03','Structured logs with severity and correlation ID per component','SDS 10.3','-','Design review','Logging setup in backend/edge','Implemented'),
 ('NFR-MNT-04','Recognition model versioned and replaceable by configuration','SDS 5 C-04','Settings','Design review','Recognizer interface + model_version on events','Implemented'),
 ('NFR-POR-01','Server and edge run on any Linux supporting the documented container runtime','SDS 10.3','-','Design review','Docker deployment (docker-compose.yml)','Implemented'),
 ('NFR-SCA-01','Growth from 1 to 32 lanes by adding cameras/edge nodes, no redesign','SDS 2.5','-','Design review','Edge-scaled architecture','Design provision'),
 ('NFR-INT-01','Every web function also available via the REST API under the same permissions','SDS 7.2','-','AT-54','Single API behind the web app','Implemented'),
]
for r in nfr: add(*r)

# ---- Database / constraints / legal / docs ----
for i, t in enumerate(['Referential integrity between all related entities','UUID primary keys for events, sessions, images, audit entries','Index normalised plate + event timestamp; partition events by month','All time values stored in UTC','Application DB account has no UPDATE/DELETE permission on audit rows'], 1):
    add(f'DB-{i:02d}', t, 'SDS 4.1', '-', 'AT-59 / design review', 'backend/app/models.py', 'Implemented (partitioning: PostgreSQL deployment)')
for i, t in enumerate(['Process and documentation conform to IEEE 830 and ISO 29148','RBAC model conforms to ANSI INCITS 359-2004','Quality assessed against ISO/IEC 25010','Deployable as containers on Linux with a documented install procedure','No internet dependency for detection, recognition, matching, logging'], 1):
    add(f'DC-{i:02d}', t, 'SDS 1, 9, 10', '-', 'Design review', 'Repository docs + docker-compose.yml', 'Implemented')
for i, t in enumerate(['Personal data processed only for access control, security, safety','No disclosure to third parties except an audited action of an authorised user','Configurable notice text on Sign In screen and in reports'], 1):
    add(f'LEG-{i:02d}', t, 'SDS 9.3', 'Sign In (notice)', 'Acceptance record', 'Config key notice_text; audit on exports', 'Implemented')
for i, t in enumerate(['Deliverables: per-role user manuals, admin manual, install/config guide, API reference, test report','Camera installation checklist based on SRS Appendix A.4'], 1):
    add(f'DOC-{i:02d}', t, 'SDS 1.4', '-', 'Acceptance record', 'README.md + docs/ (guides ship with the release)', 'In this repository (README/docs)')

# ---- Render ----
md = io.StringIO()
md.write('# Requirements Traceability Matrix — NPRS\n\n')
md.write('**Requirements baseline:** SRS-NPRS-001 v1.0 (20 November 2026) · **Design:** SDS-NPRS-001 v1.0 (IEEE 1016) · **UI/UX:** Figma "NPRS v1.0 (SRS-NPRS-001)", 30 screens\n\n')
md.write('Every requirement is traced to its design (SDS section/component), its UI/UX frame, its acceptance test(s) in SRS §6.4, and its implementation in this repository. ')
md.write('Status is stated honestly: items that depend on camera hardware, GPU sizing, or site conditions are marked as deployment/site verification rather than claimed as proven in this repository.\n\n')
md.write('| Req. ID | Requirement (abridged) | Design (SDS) | UI/UX frame | Acceptance test | Implementation | Status |\n')
md.write('| --- | --- | --- | --- | --- | --- | --- |\n')
for r in ROWS:
    md.write('| ' + ' | '.join(x.replace('|', '/') for x in r) + ' |\n')
md.write(f'\n**Total requirements traced: {len(ROWS)}**\n')
open('RTM.md', 'w').write(md.getvalue())
with open('RTM.csv', 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['Requirement ID', 'Requirement (abridged)', 'Design (SDS)', 'UI/UX frame', 'Acceptance test', 'Implementation', 'Status'])
    w.writerows(ROWS)
print('RTM rows:', len(ROWS))
