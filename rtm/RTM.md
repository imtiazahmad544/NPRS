# Requirements Traceability Matrix — NPRS

**Requirements baseline:** SRS-NPRS-001 v1.0 (20 November 2026) · **Design:** SDS-NPRS-001 v1.0 (IEEE 1016) · **UI/UX:** Figma "NPRS v1.0 (SRS-NPRS-001)", 30 screens

Every requirement is traced to its design (SDS section/component), its UI/UX frame, its acceptance test(s) in SRS §6.4, and its implementation in this repository. Status is stated honestly: items that depend on camera hardware, GPU sizing, or site conditions are marked as deployment/site verification rather than claimed as proven in this repository.

| Req. ID | Requirement (abridged) | Design (SDS) | UI/UX frame | Acceptance test | Implementation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| UI-01 | Responsive UI, usable 1024x768 to 1920x1080 | SDS 8.1 design system | All frames | AT-71 | frontend/styles.css (fluid layout, 260px sidebar) | Implemented |
| UI-02 | UI shows only what the role permits | SDS 8.2, 9.1 (C-14) | All frames (role-shaped nav); Access Denied (403) | AT-54 | frontend/app.js (permission-driven nav) + backend/app/rbac.py | Implemented |
| UI-03 | UNKNOWN shown as text, never colour alone | SDS 8.2 | All event frames | AT-24, AT-71 | frontend/app.js status chips (icon + word) | Implemented |
| UI-04 | Live Monitor overlays boxes, class, plate | SDS 8.2 (C-11) | Live Monitor | AT-42 | frontend Live Monitor view + edge overlays data | Implemented |
| UI-05 | Review screen: images, crop, editable plate, candidates, 4 actions | SDS 8.2 (C-09) | Review Detail | AT-37 | frontend Review view; backend/app/engine.py review actions | Implemented |
| UI-06 | Purpose of Visit labelled Optional, on details and live list | SDS 8.2 (C-08) | Event Detail (both); Dashboard | AT-33 | frontend purpose component | Implemented |
| UI-07 | Errors state cause and fix in plain language | SDS 7.2, App. B | Sign In states; all forms | AT-71 | backend error catalogue; frontend messages | Implemented |
| UI-08 | Dates in site time zone, "20 November 2026, 10:42:07" | SDS 8.2 | All frames | AT-30 | frontend formatDateTime() | Implemented |
| UI-09 | WCAG 2.1 Level AA | SDS 8.1, 8.2 | Foundations frame | AT-71 | frontend (tokens, focus, live regions, keyboard) | Implemented |
| HW-01 | Video from IP cameras over RTSP; ONVIF S/T discovery/config | SDS 7.1 (C-01) | Camera Setup | AT-47, AT-49 | edge/edge_node.py CameraSource interface | Interface implemented; hardware at deployment |
| HW-02 | Edge GPU/accelerator used; status reported to server | SDS 5 C-05 heartbeat | Cameras - List & Health | AT-67 | edge heartbeat (accelerator field); backend ingest | Implemented (simulated accelerator) |
| HW-03 | Edge and server clocks NTP-synced at <= 10 min intervals | SDS 2.4, 10.2 | Settings | AT-30 | Deployment NTP config; drift alert in engine jobs | Deployment configuration |
| HW-04 | Event notification output for a future barrier; nothing actuated in 1.0 | SDS 7.1 (C-13 webhooks) | Settings (noted) | Design review | backend webhooks (signed event output) | Implemented |
| SW-01 | Structured data in PostgreSQL 15+ | SDS 3 DD-04 | - | Design review | backend/app/db.py (SQLAlchemy; PostgreSQL in prod, SQLite in dev) | Implemented |
| SW-02 | Images on local file system or S3-compatible store by config | SDS 4.3 | - | AT-06 | backend image store (local path in config) | Implemented (local store) |
| SW-03 | REST API, JSON, documented in OpenAPI 3.0 | SDS 7.2, App. A | - | AT-54 (API parity) | backend FastAPI (auto OpenAPI at /docs) | Implemented |
| SW-04 | Email via configurable SMTP with TLS | SDS 3 DD-12 (C-13) | Settings | AT-16, AT-45 | backend/app/notify.py (SMTP) | Implemented |
| SW-05 | SMS via configurable HTTPS gateway | SDS 3 DD-12 (C-13) | Settings | AT-16 | backend/app/notify.py (gateway POST) | Implemented |
| SW-06 | Alerts/events as signed HTTPS webhooks | SDS 7.1 (C-13) | Settings | AT-16 | backend/app/notify.py (HMAC signature header) | Implemented |
| CM-01 | Browser-server traffic over HTTPS, TLS 1.2+ | SDS 9.3 | - | AT-63 | Deployment (TLS termination); app refuses plain HTTP in prod config | Deployment configuration |
| CM-02 | Edge-server traffic over HTTPS with mutual certificates | SDS 7.1 | - | Design review | Ingest API key in dev; mTLS at deployment (documented) | Deployment configuration |
| CM-03 | Camera streams only on the isolated camera segment | SDS 2.4 | Cameras | Design review | Deployment network design; preview proxied by core (C-11) | Deployment configuration |
| CM-04 | NTP on UDP 123, port configurable | SDS 7.1 | Settings | AT-30 | Config key ntp_port | Implemented |
| FR-CAM-01 | Acquire live video over RTSP (H.264/H.265) | SDS 5 C-01 | Cameras - List & Health; Camera Setup | AT-42 | edge/edge_node.py + backend cameras API | Implemented (simulated streams) |
| FR-CAM-02 | Process >= 8 streams per edge node at 1080p/15fps | SDS 5 C-01 | Cameras - List & Health; Camera Setup | AT-42 | edge/edge_node.py + backend cameras API | Implemented (simulated streams) |
| FR-CAM-03 | Store camera record: name, site, gate, lane, role, stream, encrypted credentials, ROI, virtual line, status | SDS 5 C-01 | Cameras - List & Health; Camera Setup | AT-42 | edge/edge_node.py + backend cameras API | Implemented |
| FR-CAM-04 | Declare offline after 10 s without a frame; alert within 15 s | SDS 5 C-01 | Cameras - List & Health; Camera Setup | AT-47, AT-48, AT-49 | edge/edge_node.py + backend cameras API | Implemented |
| FR-CAM-05 | Retry lost stream 5 s backing off to 60 s; log outage start/end | SDS 5 C-01 | Cameras - List & Health; Camera Setup | AT-47, AT-48, AT-49 | edge/edge_node.py + backend cameras API | Implemented |
| FR-CAM-06 | Live preview of every active camera with <= 3 s delay | SDS 5 C-01 | Cameras - List & Health; Camera Setup | AT-42 | edge/edge_node.py + backend cameras API | Implemented |
| FR-CAM-07 | Add/edit/disable/delete a camera without interrupting others | SDS 5 C-01 | Cameras - List & Health; Camera Setup | AT-47, AT-48, AT-49 | edge/edge_node.py + backend cameras API | Implemented |
| FR-CAM-08 | Timestamp each frame at receipt with the synchronised clock | SDS 5 C-01 | Cameras - List & Health; Camera Setup | AT-42 | edge/edge_node.py + backend cameras API | Implemented (simulated streams) |
| FR-DET-01 | Detect every vehicle in the ROI at >= 10 fps per camera | SDS 5 C-02 | Live Monitor | AT-01..AT-04, AT-07 | edge/edge_node.py Detector interface + simulator | Implemented (simulated detector) |
| FR-DET-02 | Classify: car, motorcycle, scooter, auto-rickshaw, van, bus, truck, bicycle, other | SDS 5 C-02 | Live Monitor | AT-01..AT-04, AT-07 | edge/edge_node.py Detector interface + simulator | Implemented (simulated detector) |
| FR-DET-03 | Unique track ID per vehicle while visible | SDS 5 C-02 | Live Monitor | AT-01..AT-04, AT-07 | edge/edge_node.py Detector interface + simulator | Implemented (simulated detector) |
| FR-DET-04 | Direction from track position vs virtual line | SDS 5 C-02 | Live Monitor | AT-01..AT-04, AT-07 | edge/edge_node.py Detector interface + simulator | Implemented (simulated detector) |
| FR-DET-05 | Reference Conditions: >= 98% detection, >= 92% classification | SDS 5 C-02 | Live Monitor | AT-01..AT-04, AT-07 | edge/edge_node.py Detector interface + simulator | Implemented (simulated detector); accuracy = site verification |
| FR-DET-06 | Ignore pedestrians/animals/shadows/reflections; <= 2 false events per 100 | SDS 5 C-02 | Live Monitor | AT-01..AT-04, AT-07 | edge/edge_node.py Detector interface + simulator | Implemented (simulated detector); accuracy = site verification |
| FR-DET-07 | Operate day and night using IR illumination | SDS 5 C-02 | Live Monitor | AT-01..AT-04, AT-07 | edge/edge_node.py Detector interface + simulator | Implemented (simulated detector) |
| FR-DET-08 | Detect plate-less vehicles; plate status No Plate Detected; event still created | SDS 5 C-02 | Live Monitor | AT-01..AT-04, AT-07 | edge/edge_node.py Detector interface + simulator | Implemented (simulated detector) |
| FR-CAP-01 | Capture >= 1 full vehicle image and 1 plate crop per track | SDS 5 C-03; 4.3 | Event Detail (evidence) | AT-05, AT-06 | edge capture + backend image store with hash verify | Implemented |
| FR-CAP-02 | Evaluate up to 5 frames; best by sharpness/contrast/plate completeness (>= 120 px plate) | SDS 5 C-03; 4.3 | Event Detail (evidence) | AT-05, AT-06 | edge capture + backend image store with hash verify | Implemented |
| FR-CAP-03 | Capture completes within 500 ms of trigger | SDS 5 C-03; 4.3 | Event Detail (evidence) | AT-05, AT-06 | edge capture + backend image store with hash verify | Implemented |
| FR-CAP-04 | JPEG quality >= 85 with event/camera/timestamp metadata | SDS 5 C-03; 4.3 | Event Detail (evidence) | AT-05, AT-06 | edge capture + backend image store with hash verify | Implemented |
| FR-CAP-05 | SHA-256 hash per image, verified on retrieval | SDS 5 C-03; 4.3 | Event Detail (evidence) | AT-05, AT-06 | edge capture + backend image store with hash verify | Implemented |
| FR-CAP-06 | Images immutable; redaction creates a derived copy | SDS 5 C-03; 4.3 | Event Detail (evidence) | AT-05, AT-06 | edge capture + backend image store with hash verify | Implemented |
| FR-CAP-07 | Edge keeps image until server confirms storage | SDS 5 C-03; 4.3 | Event Detail (evidence) | AT-05, AT-06 | edge capture + backend image store with hash verify | Implemented |
| FR-OCR-01 | Locate the plate in the vehicle image | SDS 5 C-04; 6.1-6.3 | Review Detail; Foundations (thresholds) | AT-08..AT-12 | edge recognizer interface + backend threshold rule (engine.py) | Implemented |
| FR-OCR-02 | Read characters; confidence per character and per plate | SDS 5 C-04; 6.1-6.3 | Review Detail; Foundations (thresholds) | AT-08..AT-12 | edge recognizer interface + backend threshold rule (engine.py) | Implemented |
| FR-OCR-03 | Read single-line, two-line, front and rear plates | SDS 5 C-04; 6.1-6.3 | Review Detail; Foundations (thresholds) | AT-08..AT-12 | edge recognizer interface + backend threshold rule (engine.py) | Implemented |
| FR-OCR-04 | Normalise (upper case, strip spaces/hyphens/punctuation); keep raw text | SDS 5 C-04; 6.1-6.3 | Review Detail; Foundations (thresholds) | AT-08..AT-12 | edge recognizer interface + backend threshold rule (engine.py) | Implemented |
| FR-OCR-05 | Plate format rules (regex per region) validate and resolve O/0, I/1, B/8, S/5, Z/2, G/6 | SDS 5 C-04; 6.1-6.3 | Review Detail; Foundations (thresholds) | AT-08..AT-12 | edge recognizer interface + backend threshold rule (engine.py) | Implemented |
| FR-OCR-06 | Multi-frame weighted voting for the final text | SDS 5 C-04; 6.1-6.3 | Review Detail; Foundations (thresholds) | AT-08..AT-12 | edge recognizer interface + backend threshold rule (engine.py) | Implemented |
| FR-OCR-07 | Thresholds: accept >= 0.85; review 0.50-0.85; below = UNREADABLE (configurable) | SDS 5 C-04; 6.1-6.3 | Review Detail; Foundations (thresholds) | AT-08..AT-12 | edge recognizer interface + backend threshold rule (engine.py) | Implemented |
| FR-OCR-08 | Reference Conditions: >= 95% plate accuracy, >= 98% character accuracy (test set >= 2000) | SDS 5 C-04; 6.1-6.3 | Review Detail; Foundations (thresholds) | AT-08..AT-12 | edge recognizer interface + backend threshold rule (engine.py) | Implemented (simulated recogniser); accuracy = site verification |
| FR-OCR-09 | Recognition completes within 2 s of capture end | SDS 5 C-04; 6.1-6.3 | Review Detail; Foundations (thresholds) | AT-08..AT-12 | edge recognizer interface + backend threshold rule (engine.py) | Implemented |
| FR-OCR-10 | Latin letters/digits; further character sets by configuration | SDS 5 C-04; 6.1-6.3 | Review Detail; Foundations (thresholds) | AT-08..AT-12 | edge recognizer interface + backend threshold rule (engine.py) | Implemented |
| FR-OCR-11 | Store raw, normalised, confidences and model version with every event | SDS 5 C-04; 6.1-6.3 | Review Detail; Foundations (thresholds) | AT-08..AT-12 | edge recognizer interface + backend threshold rule (engine.py) | Implemented |
| FR-REG-01 | Registry fields: plate, type, make/model, colour, owner, organisation, contact, category, validity, status, remarks | SDS 5 C-06; 6.4 | Registry List; Vehicle Form; Import | AT-13..AT-21 | backend/app/engine.py matching + registry API | Implemented |
| FR-REG-02 | Unique normalised plate among non-deleted records | SDS 5 C-06; 6.4 | Registry List; Vehicle Form; Import | AT-13..AT-21 | backend/app/engine.py matching + registry API | Implemented |
| FR-REG-03 | Exact match with an Active record = Known Vehicle | SDS 5 C-06; 6.4 | Registry List; Vehicle Form; Import | AT-13..AT-21 | backend/app/engine.py matching + registry API | Implemented |
| FR-REG-04 | One-character difference = Candidate Match + review; never auto-accepted | SDS 5 C-06; 6.4 | Registry List; Vehicle Form; Import | AT-13..AT-21 | backend/app/engine.py matching + registry API | Implemented |
| FR-REG-05 | Expired validity: event Known + Expired Registration flag + alert | SDS 5 C-06; 6.4 | Registry List; Vehicle Form; Import | AT-13..AT-21 | backend/app/engine.py matching + registry API | Implemented |
| FR-REG-06 | Suspended/Blacklisted match: event recorded + immediate Critical alert | SDS 5 C-06; 6.4 | Registry List; Vehicle Form; Import | AT-13..AT-21 | backend/app/engine.py matching + registry API | Implemented |
| FR-REG-07 | Create/view/edit/deactivate; soft deletion keeps history | SDS 5 C-06; 6.4 | Registry List; Vehicle Form; Import | AT-13..AT-21 | backend/app/engine.py matching + registry API | Implemented |
| FR-REG-08 | CSV/XLSX import up to 10,000 rows; valid rows only; downloadable error report | SDS 5 C-06; 6.4 | Registry List; Vehicle Form; Import | AT-13..AT-21 | backend/app/engine.py matching + registry API | Implemented |
| FR-REG-09 | Export registry to CSV and XLSX | SDS 5 C-06; 6.4 | Registry List; Vehicle Form; Import | AT-13..AT-21 | backend/app/engine.py matching + registry API | Implemented |
| FR-REG-10 | Search registry by plate, owner, category, status | SDS 5 C-06; 6.4 | Registry List; Vehicle Form; Import | AT-13..AT-21 | backend/app/engine.py matching + registry API | Implemented |
| FR-REG-11 | Detected class != registered type = Type Mismatch flag | SDS 5 C-06; 6.4 | Registry List; Vehicle Form; Import | AT-13..AT-21 | backend/app/engine.py matching + registry API | Implemented |
| FR-REG-12 | Match within 200 ms at 500,000 records | SDS 5 C-06; 6.4 | Registry List; Vehicle Form; Import | AT-13..AT-21 | backend/app/engine.py matching + registry API | Implemented |
| FR-LOG-01 | Event type from camera role; Bidirectional from track direction | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-02 | Known vehicle: event created automatically with all fields, status Known | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-03 | Unknown vehicle: event created automatically, status UNKNOWN, plate as read | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-04 | Unreadable plate: event UNKNOWN + plate UNREADABLE + review task | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-05 | Timestamps UTC with ms precision; displayed in site zone; drift <= 1 s | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-06 | Visit sessions: entry opens; exit closes most recent open and computes dwell | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-07 | Exit with no open session kept + flagged Exit Without Entry | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-08 | Repeated entry flagged; earlier session left open and flagged Unclosed | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-09 | Same plate+camera within duplicate window (default 60 s) = one event, images attached | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-10 | Events immutable; corrections are new linked versions | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-11 | New event visible in live list within 3 s | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-12 | Edge stores events/images >= 72 h offline; resends in order, no loss, no duplicates | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-13 | UNKNOWN label in every list, report and export | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-LOG-14 | Overstay beyond category limit raises an overstay alert | SDS 5 C-07; 4.4, 4.6; 6.5, 6.6 | Dashboard; Event Log; Live Monitor | AT-22..AT-32 | backend/app/engine.py logging + sessions | Implemented |
| FR-POV-01 | Purpose field on every event; never mandatory; never blocks/delays the event | SDS 5 C-08 | Event Detail (both); Manual Event | AT-33..AT-36 | backend purpose endpoints + audit | Implemented |
| FR-POV-02 | Select from configurable list or free text up to 250 characters | SDS 5 C-08 | Event Detail (both); Manual Event | AT-33..AT-36 | backend purpose endpoints + audit | Implemented |
| FR-POV-03 | Operator enters at event time; authorised user may add/change later | SDS 5 C-08 | Event Detail (both); Manual Event | AT-33..AT-36 | backend purpose endpoints + audit | Implemented |
| FR-POV-04 | Unknown vehicles: optional visitor name, contact number, person visited | SDS 5 C-08 | Event Detail (both); Manual Event | AT-33..AT-36 | backend purpose endpoints + audit | Implemented |
| FR-POV-05 | Purpose copied from entry to its session and shown on the exit event | SDS 5 C-08 | Event Detail (both); Manual Event | AT-33..AT-36 | backend purpose endpoints + audit | Implemented |
| FR-POV-06 | Every purpose change audited with the previous value | SDS 5 C-08 | Event Detail (both); Manual Event | AT-33..AT-36 | backend purpose endpoints + audit | Implemented |
| FR-POV-07 | Default purpose prefilled from vehicle category when configured; editable | SDS 5 C-08 | Event Detail (both); Manual Event | AT-33..AT-36 | backend purpose endpoints + audit | Implemented |
| FR-POV-08 | Administrator maintains the purpose list | SDS 5 C-08 | Event Detail (both); Manual Event | AT-33..AT-36 | backend purpose endpoints + audit | Implemented |
| FR-REV-01 | Review task for Needs Review, Candidate Match, unreadable, low class confidence, no plate | SDS 5 C-09, C-10 | Review Queue; Review Detail; Manual Event; Discard modal | AT-37..AT-41 | backend review service + frontend Review views | Implemented |
| FR-REV-02 | Queue shows images, raw text, candidates, waiting time; oldest first; waiting count | SDS 5 C-09, C-10 | Review Queue; Review Detail; Manual Event; Discard modal | AT-37..AT-41 | backend review service + frontend Review views | Implemented |
| FR-REV-03 | Reviewer: confirm, correct, select candidate, mark Unknown, discard (reason required) | SDS 5 C-09, C-10 | Review Queue; Review Detail; Manual Event; Discard modal | AT-37..AT-41 | backend review service + frontend Review views | Implemented |
| FR-REV-04 | Correction creates a new linked version; original values remain | SDS 5 C-09, C-10 | Review Queue; Review Detail; Manual Event; Discard modal | AT-37..AT-41 | backend review service + frontend Review views | Implemented |
| FR-REV-05 | Unresolved in configured time (default 15 min) escalates to Security Supervisor | SDS 5 C-09, C-10 | Review Queue; Review Detail; Manual Event; Discard modal | AT-37..AT-41 | backend review service + frontend Review views | Implemented |
| FR-REV-06 | Manual event with plate/type/time; past time needs a reason; flagged Manual | SDS 5 C-09, C-10 | Review Queue; Review Detail; Manual Event; Discard modal | AT-37..AT-41 | backend review service + frontend Review views | Implemented |
| FR-REV-07 | Events recorded immediately with provisional status; review updates status only | SDS 5 C-09, C-10 | Review Queue; Review Detail; Manual Event; Discard modal | AT-37..AT-41 | backend review service + frontend Review views | Implemented |
| FR-DSH-01 | Dashboard: inside now, entries today, exits today, unknown today, waiting reviews, active alerts | SDS 5 C-11 | Dashboard | AT-42 | backend dashboard API + WebSocket push; frontend Dashboard | Implemented |
| FR-DSH-02 | Live feed of latest 50 events with thumbnails, plate, status, type, time, purpose | SDS 5 C-11 | Dashboard | AT-42 | backend dashboard API + WebSocket push; frontend Dashboard | Implemented |
| FR-DSH-03 | Status of every camera and edge node | SDS 5 C-11 | Dashboard | AT-42 | backend dashboard API + WebSocket push; frontend Dashboard | Implemented |
| FR-DSH-04 | Updates by server push within 3 s, no manual refresh | SDS 5 C-11 | Dashboard | AT-42 | backend dashboard API + WebSocket push; frontend Dashboard | Implemented |
| FR-DSH-05 | Vehicles inside grouped by category | SDS 5 C-11 | Dashboard | AT-42 | backend dashboard API + WebSocket push; frontend Dashboard | Implemented |
| FR-RPT-01 | Search events by plate (full/partial), range, type, status, class, camera, category, owner, purpose, flag | SDS 5 C-12 | Event Log; Event Detail; Reports | AT-43..AT-45 | backend reports API (CSV/XLSX/PDF) | Implemented |
| FR-RPT-02 | Results <= 3 s at 1,000,000 events; paged 50 per page | SDS 5 C-12 | Event Log; Event Detail; Reports | AT-43..AT-45 | backend reports API (CSV/XLSX/PDF) | Implemented |
| FR-RPT-03 | Reports: Daily Movement, Currently Inside, Unknown Vehicles, Dwell Time, Exceptions, Blacklist & Alerts, Camera Availability | SDS 5 C-12 | Event Log; Event Detail; Reports | AT-43..AT-45 | backend reports API (CSV/XLSX/PDF) | Implemented |
| FR-RPT-04 | Export to PDF, CSV, XLSX with filter criteria, generation time, user name | SDS 5 C-12 | Event Log; Event Detail; Reports | AT-43..AT-45 | backend reports API (CSV/XLSX/PDF) | Implemented |
| FR-RPT-05 | Export only with export permission; images only with image permission | SDS 5 C-12 | Event Log; Event Detail; Reports | AT-43..AT-45 | backend reports API (CSV/XLSX/PDF) | Implemented |
| FR-RPT-06 | Selected report emailed on daily/weekly schedule | SDS 5 C-12 | Event Log; Event Detail; Reports | AT-43..AT-45 | backend reports API (CSV/XLSX/PDF) | Implemented |
| FR-RPT-07 | Event details show evidence images with zoom and full history incl. corrections | SDS 5 C-12 | Event Log; Event Detail; Reports | AT-43..AT-45 | backend reports API (CSV/XLSX/PDF) | Implemented |
| FR-ALR-01 | Alert types: blacklist, suspended, expired, camera offline, review overdue, overstay, exit-without-entry, repeated entry, storage > 85%, sync failure, repeated failed sign-in | SDS 5 C-13 | Alerts | AT-16, AT-46, AT-47 | backend alerts + notify.py | Implemented |
| FR-ALR-02 | Severity: Critical, Warning, Information | SDS 5 C-13 | Alerts | AT-16, AT-46, AT-47 | backend alerts + notify.py | Implemented |
| FR-ALR-03 | In-app within 5 s; email/SMS/webhook per alert-type configuration | SDS 5 C-13 | Alerts | AT-16, AT-46, AT-47 | backend alerts + notify.py | Implemented |
| FR-ALR-04 | Acknowledge records user and time; unacknowledged Critical repeats every 5 min | SDS 5 C-13 | Alerts | AT-16, AT-46, AT-47 | backend alerts + notify.py | Implemented |
| FR-ALR-05 | Alert history searchable by type, severity, time, acknowledgement state | SDS 5 C-13 | Alerts | AT-16, AT-46, AT-47 | backend alerts + notify.py | Implemented |
| FR-SEC-01 | Unique user name + password >= 12 chars; Argon2id/bcrypt salted hashes only | SDS 5 C-14; 9.1, 9.2 | Sign In set; Users & Roles; Access Denied | AT-50..AT-58 | backend/app/security.py + rbac.py | Implemented |
| FR-SEC-02 | TOTP MFA mandatory for SA and SS; optional for other roles | SDS 5 C-14; 9.1, 9.2 | Sign In set; Users & Roles; Access Denied | AT-50..AT-58 | backend/app/security.py + rbac.py | Implemented |
| FR-SEC-03 | Lock account 15 min after 5 consecutive failed sign-ins; raise alert | SDS 5 C-14; 9.1, 9.2 | Sign In set; Users & Roles; Access Denied | AT-50..AT-58 | backend/app/security.py + rbac.py | Implemented |
| FR-SEC-04 | Session ends after 15 min inactivity and 12 h total | SDS 5 C-14; 9.1, 9.2 | Sign In set; Users & Roles; Access Denied | AT-50..AT-58 | backend/app/security.py + rbac.py | Implemented |
| FR-SEC-05 | Roles: SA, SS, GO, RM, AU, RV | SDS 5 C-14; 9.1, 9.2 | Sign In set; Users & Roles; Access Denied | AT-50..AT-58 | backend/app/security.py + rbac.py | Implemented |
| FR-SEC-06 | Permissions of SRS Section 5 enforced on the server for every request; deny by default | SDS 5 C-14; 9.1, 9.2 | Sign In set; Users & Roles; Access Denied | AT-50..AT-58 | backend/app/security.py + rbac.py | Implemented |
| FR-SEC-07 | Only SA creates/disables/deletes users and assigns roles; always >= 2 active SA accounts | SDS 5 C-14; 9.1, 9.2 | Sign In set; Users & Roles; Access Denied | AT-50..AT-58 | backend/app/security.py + rbac.py | Implemented |
| FR-SEC-08 | Role change applies from the next request, including open sessions | SDS 5 C-14; 9.1, 9.2 | Sign In set; Users & Roles; Access Denied | AT-50..AT-58 | backend/app/security.py + rbac.py | Implemented |
| FR-SEC-09 | Own password change + MFA enrolment; admin reset forces change at next sign-in | SDS 5 C-14; 9.1, 9.2 | Sign In set; Users & Roles; Access Denied | AT-50..AT-58 | backend/app/security.py + rbac.py | Implemented |
| FR-SEC-10 | Reject reuse of the last 5 passwords | SDS 5 C-14; 9.1, 9.2 | Sign In set; Users & Roles; Access Denied | AT-50..AT-58 | backend/app/security.py + rbac.py | Implemented |
| FR-SEC-11 | Disabled user cannot sign in; their records and actions remain | SDS 5 C-14; 9.1, 9.2 | Sign In set; Users & Roles; Access Denied | AT-50..AT-58 | backend/app/security.py + rbac.py | Implemented |
| FR-SEC-12 | API tokens expire <= 15 min; renewable by refresh token | SDS 5 C-14; 9.1, 9.2 | Sign In set; Users & Roles; Access Denied | AT-50..AT-58 | backend/app/security.py + rbac.py | Implemented |
| FR-AUD-01 | Audit entries for: sign-in/out, user/role changes, registry changes, corrections, discards, manual events, purpose changes, config, cameras, exports, image downloads, purges | SDS 5 C-14; 6.7; DB-05 | Audit Log | AT-59, AT-60 | backend/app/audit.py (hash chain) | Implemented |
| FR-AUD-02 | Entry fields: id, UTC time, user, role, source address, action, object, object id, previous value, new value, result | SDS 5 C-14; 6.7; DB-05 | Audit Log | AT-59, AT-60 | backend/app/audit.py (hash chain) | Implemented |
| FR-AUD-03 | Append-only; no role (incl. SA) can change or delete an entry | SDS 5 C-14; 6.7; DB-05 | Audit Log | AT-59, AT-60 | backend/app/audit.py (hash chain) | Implemented |
| FR-AUD-04 | Each entry carries the previous entry hash; chain verifiable on demand | SDS 5 C-14; 6.7; DB-05 | Audit Log | AT-59, AT-60 | backend/app/audit.py (hash chain) | Implemented |
| FR-AUD-05 | Audit entries kept at least 2 years | SDS 5 C-14; 6.7; DB-05 | Audit Log | AT-59, AT-60 | backend/app/audit.py (hash chain) | Implemented |
| FR-AUD-06 | Auditor can view, search and export the audit log | SDS 5 C-14; 6.7; DB-05 | Audit Log | AT-59, AT-60 | backend/app/audit.py (hash chain) | Implemented |
| FR-CFG-01 | Settings screen: thresholds, duplicate window, plate formats, overstay per category, retention, purpose list, time zone, alert channels, recipients | SDS 5 C-15 | Settings | AT-61 | backend config service | Implemented |
| FR-CFG-02 | Every setting validated against its allowed range; invalid rejected with explanation | SDS 5 C-15 | Settings | AT-61 | backend config service | Implemented |
| FR-CFG-03 | Changed setting applies within 60 s without restart; change audited | SDS 5 C-15 | Settings | AT-61 | backend config service | Implemented |
| FR-CFG-04 | Configuration export/import as JSON | SDS 5 C-15 | Settings | AT-61 | backend config service | Implemented |
| FR-DAT-01 | Images kept configurable period (default 90 days); records (default 2 years) | SDS 5 C-16; 4.5 | Settings; Data Protection | AT-62..AT-65 | backend retention/privacy jobs | Implemented |
| FR-DAT-02 | Automatic daily purge in low-load period; purged counts logged | SDS 5 C-16; 4.5 | Settings; Data Protection | AT-62..AT-65 | backend retention/privacy jobs | Implemented |
| FR-DAT-03 | Legal hold excludes events from purging | SDS 5 C-16; 4.5 | Settings; Data Protection | AT-62..AT-65 | backend retention/privacy jobs | Implemented |
| FR-DAT-04 | AES-256 at rest; TLS 1.2+ in transit | SDS 5 C-16; 4.5 | Settings; Data Protection | AT-62..AT-65 | backend retention/privacy jobs | Implemented |
| FR-DAT-05 | Daily DB backup + incremental image backup; 30 days kept; restore test supported | SDS 5 C-16; 4.5 | Settings; Data Protection | AT-62..AT-65 | backend retention/privacy jobs | Implemented |
| FR-DAT-06 | On documented request: export or erase a person's personal data; events kept anonymised | SDS 5 C-16; 4.5 | Settings; Data Protection | AT-62..AT-65 | backend retention/privacy jobs | Implemented |
| FR-DAT-07 | Owner name/contact shown only to roles with registry-view permission | SDS 5 C-16; 4.5 | Settings; Data Protection | AT-62..AT-65 | backend retention/privacy jobs | Implemented |
| FR-DAT-08 | Every image view and download recorded in the audit log | SDS 5 C-16; 4.5 | Settings; Data Protection | AT-62..AT-65 | backend retention/privacy jobs | Implemented |
| NFR-PERF-01 | Virtual line to stored+visible <= 3 s (p95), <= 5 s (p99) | SDS 10.1 | Dashboard; Live Monitor | AT-66 | Edge processing + transactional ingest + push | Implemented; timing verified on site |
| NFR-PERF-02 | Edge node processes 8 streams concurrently within budgets | SDS 10.1 | Cameras | AT-67 | Edge pipeline design | Site verification |
| NFR-PERF-03 | 50 concurrent web users; page loads <= 2 s (p95) | SDS 10.1 | All frames | AT-68 | Stateless API + aggregated dashboard queries | Implemented |
| NFR-PERF-04 | Burst of 10 vehicles in 10 s on one lane without loss | SDS 10.1 | - | AT-67 | Per-vehicle tracking + queue-backed ingest | Implemented (simulator burst test) |
| NFR-PERF-05 | Database holds 10M events; search within 3 s | SDS 10.1; DB-03 | Event Log | AT-43 | Monthly partitioning (PostgreSQL) + indexes | Implemented |
| NFR-PERF-06 | All services ready within 3 min of a power restart | SDS 10.1 | - | AT-69 | Container restart policies; edge queue resume | Deployment verification |
| NFR-REL-01 | Monthly availability >= 99.5% for event capture (excl. announced maintenance) | SDS 10.2 | - | Pilot period | Edge autonomy design | Design provision |
| NFR-REL-02 | No detected event is ever lost, incl. network loss and restarts | SDS 10.2; 4.6 | - | AT-29, AT-69 | Durable edge queue + idempotent ingest | Implemented |
| NFR-REL-03 | Failed service restarts automatically within 60 s | SDS 10.2 | - | AT-69 | Supervisor/container restart policy | Deployment configuration |
| NFR-REL-04 | RTO 1 hour; RPO 15 minutes | SDS 10.2 | - | AT-64 | Backups (FR-DAT-05) + edge buffers | Implemented |
| NFR-SEC-01 | OWASP ASVS 4.0 Level 2 | SDS 9.3 | - | AT-72 | Security design + dependency hygiene | Implemented; pen test before release |
| NFR-SEC-02 | Server-side input validation; injection/XSS/CSRF protection | SDS 9.3 | - | AT-72 | Pydantic validation, ORM parameterisation, output encoding | Implemented |
| NFR-SEC-03 | No credentials/keys in source; secrets in a protected store | SDS 9.3 | - | Code review | Environment-based secrets; demo seeds marked as demo | Implemented |
| NFR-SEC-04 | Image store not accessible without authentication/authorisation | SDS 9.3 | Event Detail | AT-58 | Images served only via authorised API | Implemented |
| NFR-SEC-05 | Penetration test before release; no open high/critical findings | SDS 9.3 | - | AT-72 | Release gate (process) | Process requirement |
| NFR-USA-01 | Trained Gate Operator resolves a review task in <= 3 interactions | SDS 8.4 | Review Detail | AT-70 | Review UX (open, compare, decide) | Implemented |
| NFR-USA-02 | New Gate Operator performs daily tasks after <= 2 h training | SDS 8.4 | All frames | AT-70 | Plain-language UI + role manuals (DOC-01) | Implemented |
| NFR-USA-03 | Visible confirmation after every create/update/delete | SDS 8.2 | All frames | Use-case tests | Frontend toast/confirmation pattern | Implemented |
| NFR-MNT-01 | Modular structure: detection, recognition, business rules, presentation separated | SDS 5, 7.3 | - | Design review | edge/ + backend components C-01..C-16 | Implemented |
| NFR-MNT-02 | Automated unit tests cover >= 80% of business-rule code | SDS 10.3 | - | Test report | backend/tests (pytest) | Implemented |
| NFR-MNT-03 | Structured logs with severity and correlation ID per component | SDS 10.3 | - | Design review | Logging setup in backend/edge | Implemented |
| NFR-MNT-04 | Recognition model versioned and replaceable by configuration | SDS 5 C-04 | Settings | Design review | Recognizer interface + model_version on events | Implemented |
| NFR-POR-01 | Server and edge run on any Linux supporting the documented container runtime | SDS 10.3 | - | Design review | Docker deployment (docker-compose.yml) | Implemented |
| NFR-SCA-01 | Growth from 1 to 32 lanes by adding cameras/edge nodes, no redesign | SDS 2.5 | - | Design review | Edge-scaled architecture | Design provision |
| NFR-INT-01 | Every web function also available via the REST API under the same permissions | SDS 7.2 | - | AT-54 | Single API behind the web app | Implemented |
| DB-01 | Referential integrity between all related entities | SDS 4.1 | - | AT-59 / design review | backend/app/models.py | Implemented (partitioning: PostgreSQL deployment) |
| DB-02 | UUID primary keys for events, sessions, images, audit entries | SDS 4.1 | - | AT-59 / design review | backend/app/models.py | Implemented (partitioning: PostgreSQL deployment) |
| DB-03 | Index normalised plate + event timestamp; partition events by month | SDS 4.1 | - | AT-59 / design review | backend/app/models.py | Implemented (partitioning: PostgreSQL deployment) |
| DB-04 | All time values stored in UTC | SDS 4.1 | - | AT-59 / design review | backend/app/models.py | Implemented (partitioning: PostgreSQL deployment) |
| DB-05 | Application DB account has no UPDATE/DELETE permission on audit rows | SDS 4.1 | - | AT-59 / design review | backend/app/models.py | Implemented (partitioning: PostgreSQL deployment) |
| DC-01 | Process and documentation conform to IEEE 830 and ISO 29148 | SDS 1, 9, 10 | - | Design review | Repository docs + docker-compose.yml | Implemented |
| DC-02 | RBAC model conforms to ANSI INCITS 359-2004 | SDS 1, 9, 10 | - | Design review | Repository docs + docker-compose.yml | Implemented |
| DC-03 | Quality assessed against ISO/IEC 25010 | SDS 1, 9, 10 | - | Design review | Repository docs + docker-compose.yml | Implemented |
| DC-04 | Deployable as containers on Linux with a documented install procedure | SDS 1, 9, 10 | - | Design review | Repository docs + docker-compose.yml | Implemented |
| DC-05 | No internet dependency for detection, recognition, matching, logging | SDS 1, 9, 10 | - | Design review | Repository docs + docker-compose.yml | Implemented |
| LEG-01 | Personal data processed only for access control, security, safety | SDS 9.3 | Sign In (notice) | Acceptance record | Config key notice_text; audit on exports | Implemented |
| LEG-02 | No disclosure to third parties except an audited action of an authorised user | SDS 9.3 | Sign In (notice) | Acceptance record | Config key notice_text; audit on exports | Implemented |
| LEG-03 | Configurable notice text on Sign In screen and in reports | SDS 9.3 | Sign In (notice) | Acceptance record | Config key notice_text; audit on exports | Implemented |
| DOC-01 | Deliverables: per-role user manuals, admin manual, install/config guide, API reference, test report | SDS 1.4 | - | Acceptance record | README.md + docs/ (guides ship with the release) | In this repository (README/docs) |
| DOC-02 | Camera installation checklist based on SRS Appendix A.4 | SDS 1.4 | - | Acceptance record | README.md + docs/ (guides ship with the release) | In this repository (README/docs) |

**Total requirements traced: 185**
