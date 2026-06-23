# Lumière — Wiring Blueprint (Buttons · Functions · Features · API)

Everything counted from the **actual source** and mapped to the **exact API** it touches.
Phase-1 = built. Tables are the source of truth; if code differs, code is wrong.

---

## T0. Count summary

| Category | Count (Phase 1, built) | Notes |
|---|---|---|
| Pages | 7 | index, services, booking, gallery, team, manage, admin |
| API endpoints | 9 | see T1 |
| Server functions | 10 | + 9 route-branches inside `handleAPI` (sub-functions) |
| Client shared functions | 12 | 9 `api.*` methods + `money` + `toast` + `renderChrome` |
| Client page functions | 32 | booking 14 · manage 8 · admin 4 · services 2 · gallery 2 · index 1 · team 1 |
| **Total functions** | **54** | 10 server + 12 shared + 32 page (+9 route-branches) |
| Button **types** | 17 | T2 |
| Button instances (runtime) | ~60 | incl. generated (15 service rows, slots, chips, per-row cancel) |
| Buttons that call an API directly | 8 | T3 |
| Features (top-level) | 9 | T4 |
| Sub-features | 31 | T4 |

---

## T1. API ENDPOINTS — master table (9)

| # | Method · Route | Server fn / branch | Client method | Request | Response | Errors |
|---|---|---|---|---|---|---|
| A1 | GET `/api/config` | `handleAPI` → config branch | `api.config()` | — | `{salon,categories,services,staff}` | — |
| A2 | GET `/api/availability` | → availability branch → `availableSlots()` | `api.availability(s,st,d)` | `?serviceId&staffId&date` | `{date,service,options[]}` | 400 |
| A3 | POST `/api/bookings` | → bookings POST → `availableSlots()` recheck + `makeNotifications()` | `api.book(payload)` | `{serviceId,staffId,date,time,customer}` | 201 `{ok,booking}` | 400, 409 |
| A4 | POST `/api/bookings/lookup` | → lookup branch (`digits()`) | `api.lookup(ref,phone)` | `{ref,phone}` | `{booking}` | 404 |
| A5 | POST `/api/bookings/reschedule` | → reschedule → `availableSlots()` + `makeNotifications()` | `api.reschedule(id,d,t)` | `{id,date,time}` | `{ok,booking}` | 404,400,409 |
| A6 | POST `/api/bookings/cancel` | → cancel branch | `api.cancel(id)` | `{id}` | `{ok}` | 404 |
| A7 | GET `/api/bookings` | → bookings GET (sort) | `api.bookings()` | — | `{bookings[]}` | — |
| A8 | GET `/api/notifications` | → notifications branch (sort) | `api.notifications()` | — | `{notifications[]}` | — |
| A9 | GET `/api/stats` | → stats branch (aggregate) | `api.stats()` | — | `{totals,byCategory,byStaff}` | — |

---

## T2. BUTTON TYPES — master table (17)

| # | Button | Page(s) | Trigger | Handler | Hits API? |
|---|---|---|---|---|---|
| B1 | Book Now (header) | all | link | — | no |
| B2 | Hamburger ☰ | all | click | nav toggle | no |
| B3 | Book an appointment | home, footer | link | — | no |
| B4 | View the menu | home | link | — | no |
| B5 | See all services | home | link | — | no |
| B6 | Browse gallery | home, gallery | link | — | no |
| B7 | Book now (CTA) | home | link | — | no |
| B8 | Category chip | services, gallery | click | `render()` filter | no (data cached) |
| B9 | Book (per service) | services | link `?service=` | — | no |
| B10 | Service / Artist / Slot tile | booking | click | state + `render()` | **slot→A2 on load** |
| B11 | Back / Next / Confirm | booking | click | `go()` / `submitBooking()` | **Confirm→A3** |
| B12 | Book another / Back home | booking success | link | — | no |
| B13 | Book with <artist> | team | link | — | no |
| B14 | Book your look | gallery | link | — | no |
| B15 | Find my booking | manage | click | `doLookup()` | **A4** |
| B16 | Reschedule / Cancel / slot | manage | click | `showReschedule`/`doCancel` | **A2, A5, A6** |
| B17 | + New / Refresh / row-Cancel | admin | link/click | `load()`/`cancelB()` | **A1,A7,A8,A9 / A6** |

---

## T3. BUTTONS THAT CALL AN API — exact wiring (8)

| Button | Page | Handler fn | Client call | Endpoint | On success | On error |
|---|---|---|---|---|---|---|
| Date picker (change) | booking | `loadSlots()` | `api.availability` | A2 | render slot grid | "no openings" / loading |
| Confirm booking ✓ | booking | `submitBooking()` | `api.book` | A3 | success screen + ref | 409→jump step3; toast |
| Find my booking | manage | `doLookup()` | `api.lookup` | A4 | show booking | inline 404 error |
| Slot (reschedule) | manage | `loadResched()` click | `api.reschedule` | A5 | re-render booking | 409→reload slots |
| Cancel booking | manage | `doCancel()` | `api.cancel` | A6 | status→cancelled | toast |
| Date picker (change) | manage | `loadResched()` | `api.availability` | A2 | render slots | "no openings" |
| Refresh / page load | admin | `load()` | `api.stats/bookings/config/notifications` | A9,A7,A1,A8 | fill dashboard | — |
| Cancel (table row) | admin | `cancelB(id)` | `api.cancel` | A6 | toast + reload | — |

*Every page also calls A1 (`/api/config`) once on load via `renderChrome()`.*

---

## T4. FEATURES → SUB-FEATURES → API (9 features, 31 sub-features)

| Feature | Sub-features | APIs used |
|---|---|---|
| **F1 Marketing site** | hero+CTA · value props · service preview · team preview · gallery preview · testimonials · CTA band (7) | A1 |
| **F2 Service catalog** | load · category filter · service row · deep-link · per-service Book (5) | A1 |
| **F3 Booking wizard** | service select · artist select · date · availability fetch · slot select · details form · live summary · submit · success · step guards · back/next (11) | A1, A2, A3 |
| **F4 Manage** | lookup · view · reschedule · cancel · look-up-another (5) | A1, A2, A4, A5, A6 |
| **F5 Admin dashboard** | stat cards · category chart · artist chart · bookings table · row cancel · refresh · new (7) | A1, A6, A7, A8, A9 |
| **F6 Notifications** | auto-create · refresh on reschedule · admin feed (3) | A3, A5, A8 |
| **F7 Availability engine** | slot gen · buffer · overlap · any-merge (4) | (server-internal; powers A2,A3,A5) |
| **F8 Shared chrome** | header · hamburger · footer · toast (4) | A1 |
| **F9 Persistence** | auto-seed · load/save · price snapshot (3) | (server-internal) |

---

## T5. SERVER FUNCTIONS — table (10 + 9 branches)

| # | Function | Sub-steps / sub-functions | Used by |
|---|---|---|---|
| S1 | `loadDB()` | seed-copy, JSON.parse | every API call |
| S2 | `saveDB(db)` | JSON.stringify, writeFile | A3,A5,A6 |
| S3 | `toMin(hhmm)` | — | S5 |
| S4 | `toHHMM(min)` | — | S5 |
| S5 | `availableSlots()` | candidate loop · overlap test · collect | A2,A3,A5 |
| S6 | `sendJSON()` | — | all branches |
| S7 | `serveStatic()` | path-guard · readFile · MIME map | non-API routes |
| S8 | `readBody()` | stream collect · JSON.parse | A3,A4,A5,A6 |
| S9 | `makeNotifications()` | build confirmation · build reminder | A3,A5 |
| S10 | `handleAPI()` | **9 route branches** ↓ | createServer |
| — | branches | config·availability·bookings-POST·lookup·reschedule·notifications·bookings-GET·cancel·stats | — |

---

## T6. CLIENT FUNCTIONS — table (12 shared + 32 page = 44)

| File | Functions | API calls |
|---|---|---|
| `common.js` (12) | `api.{config,availability,book,bookings,stats,notifications,cancel,lookup,reschedule}` · `money` · `toast` · `renderChrome` | A1–A9 wrappers; renderChrome→A1 |
| `index.html` (1) | init-render | A1 |
| `services.html` (2) | `render` · init | A1 |
| `booking.html` (14) | `todayISO·setStepUI·svc·render·navButtons·renderService·renderStaff·renderTime·loadSlots·renderDetails·submitBooking·renderSuccess·go·init` | init→A1 · loadSlots→A2 · submitBooking→A3 |
| `gallery.html` (2) | `render` · init | A1 |
| `team.html` (1) | init-render | A1 |
| `manage.html` (8) | `todayISO·lookupForm·doLookup·showBooking·doCancel·showReschedule·loadResched·init` | doLookup→A4 · loadResched→A2 · slot→A5 · doCancel→A6 · init→A1 |
| `admin.html` (4) | `bars·load·cancelB·init` | load→A1,A7,A8,A9 · cancelB→A6 |

---

## T7. PAGE → APIs consumed — table

| Page | On load | On interaction |
|---|---|---|
| index | A1 | — |
| services | A1 | — (filter is client-side) |
| booking | A1 | A2 (slots), A3 (submit) |
| gallery | A1 | — |
| team | A1 | — |
| manage | A1 | A4 (lookup), A2 (resched slots), A5 (resched), A6 (cancel) |
| admin | A1, A7, A8, A9 | A6 (cancel), refresh re-runs the 4 |

---

## T8. FLOW PER FEATURE — one-line each

| Feature | Flow (→ = step, ⟶ = API) |
|---|---|
| Book | service→artist→date ⟶A2→ slot→details→ Confirm ⟶A3 → success(ref) → ⟶A3 spawns notifications |
| Reschedule | Manage ⟶A4 → Reschedule → date ⟶A2 → slot ⟶A5 → reminder refreshed |
| Cancel | Manage ⟶A4 → Cancel(confirm) ⟶A6 → status cancelled, excluded from A9 |
| Admin view | load ⟶A1+A7+A8+A9 → cards/charts/tables → row Cancel ⟶A6 → reload |
| Catalog | ⟶A1 → render → chip filter (client) → Book → booking?service= |
| Availability | A2/A3/A5 → `availableSlots` (S5): slot gen → buffer → overlap → [any-merge] |

---

## T9. WHAT'S MISSING (pointer)

Counts above are Phase-1. Search (0), pagination (0), accounts/login (0), real notification
delivery (0), payments/loyalty/giftcards (0) are **not built** — fully specced with API
additions in **ROADMAP.md** (E1–E8) and **SPEC.md** §9. Two live issues (XSS, write race)
are in **ROADMAP.md** §G1 and must be fixed before Phase 2.

Phase-2 will add **+7 endpoints** (register, otp, login, logout, me, + payments/giftcard),
bringing API total to **16**, functions to **~64**, button types to **26**.
