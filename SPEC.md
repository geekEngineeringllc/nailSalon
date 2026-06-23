# Lumière Beauty & Nail Studio — Master Specification

**Purpose of this document:** pin down every decision (data shapes, screens, states,
buttons, rules, errors, acceptance tests) **before** code changes, so the project does not
get reworked. If a question comes up during build, the answer is here. Anything not here is
explicitly listed under "Open decisions" — resolve those first, don't guess.

**Status legend:** `BUILT` = done & verified · `PLANNED` = specced, not yet coded ·
`LOCKED` = decision is final, do not change without updating this file.

---

## 0. Locked foundations (do not change silently)

| Decision | Value | Why locked |
|---|---|---|
| Runtime | Node.js, built-in `http` only, **zero npm deps** | Runs anywhere, no install/build, no supply-chain risk |
| Datastore (phase 1) | JSON file `data/db.json`, seeded from `data/seed.json` | Simple, inspectable, resettable |
| Front-end | Vanilla HTML/CSS/JS, no framework, no bundler | No build step; every page is independently loadable |
| Styling | One global file `public/css/styles.css` + CSS variables | Single source of visual truth |
| Shared chrome | Header/footer/API-client injected by `public/js/common.js` | Change nav/branding in one place |
| Money | Whole-dollar integers, displayed `$NN` via `money()` | No float rounding bugs |
| Time | 24h `"HH:MM"` strings; dates `"YYYY-MM-DD"` (ISO) | Lexicographic sort = chronological |
| IDs | `crypto.randomBytes` hex; booking ref `LUM-XXXX` (4 hex, upper) | Collision-safe, human-quotable |
| Port | `3000`, overridable via `PORT` env | — |

**Naming conventions (LOCKED):** files `kebab-case.html`; ids in data `kebab-case`
(`gel-mani`, `noor`); JS variables `camelCase`; CSS classes `kebab-case`; API routes
`/api/<noun>[/<verb>]`. Categories are the only fixed enum: `nails | hair | skin | makeup`.

---

## 1. Scope & phases

### Phase 1 — `BUILT`
Marketing site + online booking + self-service manage + owner dashboard + simulated
notifications. Single location, single timezone, no auth, no payments.

### Phase 2 — `PLANNED` (slots in without refactor — see §9)
Customer accounts, loyalty points, gift cards, deposits/payments, real SMS/email,
waitlist, packages/series, admin login.

**Out of scope entirely (say no, don't half-build):** medical/patient records, multi-location,
multi-currency, native mobile app, POS hardware.

---

## 2. Data model (LOCKED field names & types)

All data lives in one JSON object. Field names are contracts — the UI and API depend on
them exactly. **Never rename a field without updating every consumer listed in §4/§5.**

### 2.1 `salon` (object)
```
name        string
tagline     string
phone       string   display format, e.g. "(555) 240-1180"
email       string
address     string
hours[]     { day:string, open:"HH:MM", close:"HH:MM" }   // 7 entries, Mon..Sun
```

### 2.2 `categories[]`
```
id    "nails"|"hair"|"skin"|"makeup"   (LOCKED enum)
name  string
blurb string
```

### 2.3 `services[]`
```
id          kebab-case string, unique, immutable (used in URLs & bookings)
category    one of the category ids
name        string
duration    integer minutes (>0, multiple of 5)
price       integer dollars (from-price)
description string
staffIds[]  string[]  // which staff can perform it (must reference real staff ids)
```
**Invariant:** every `staffId` in a service must exist in `staff[]`. A service with an
empty `staffIds` is bookable by nobody — disallowed.

### 2.4 `staff[]`
```
id           kebab-case string, unique, immutable
name         string  // "First Last" — initials drive the avatar
title        string
bio          string
specialties  string[]  // tags shown on team page
```

### 2.5 `bookings[]` (created at runtime)
```
id          hex string (internal)
ref         "LUM-XXXX" (customer-facing, unique enough for demo)
serviceId, serviceName, duration, price   // snapshotted from service at booking time
staffId, staffName                        // resolved real artist (never "any")
date        "YYYY-MM-DD"
time        "HH:MM"  (start)
customer    { name, phone, email, notes }
status      "confirmed" | "cancelled"     (LOCKED enum)
createdAt   ISO timestamp
```
**Snapshot rule (LOCKED):** price/duration/serviceName are copied onto the booking so that
later edits to the service menu never retroactively change past bookings.

### 2.6 `notifications[]` (created at runtime)
```
id, bookingId, ref, to (customer name)
channel      "SMS" | "email + SMS"  (email+SMS if customer.email present)
type         "confirmation" | "reminder"   (LOCKED enum)
message      string (pre-rendered)
status       "sent" | "scheduled"          (LOCKED enum)
scheduledFor ISO timestamp (confirmation = now; reminder = visit − 24h)
```

---

## 3. Business rules (the booking engine — LOCKED)

These constants live at the top of `server.js`. Changing them changes availability for the
whole salon; they are intentionally centralized.

```
OPEN_MIN  = 09:00   earliest bookable start
CLOSE_MIN = 20:00   latest allowed END of a service
SLOT_STEP = 15 min  spacing of candidate start times
BUFFER    = 10 min  mandatory cleanup after every appointment
```

**Availability algorithm (LOCKED):** for a given (service, artist, date):
1. Candidate starts = `OPEN_MIN, OPEN_MIN+15, …` while `start + duration ≤ CLOSE_MIN`.
2. A candidate is **free** unless it overlaps an existing non-cancelled booking for that
   artist, where each booking occupies `[start, start + duration + BUFFER)`.
3. Overlap test: `start < existingEnd AND existingStart < candidateEnd`.

**"Any available" (LOCKED):** the UI sends `staffId="any"`; the server expands to all
qualified artists and returns slots **grouped per artist**. The customer's chosen slot
carries the real `staffId`, so a booking is **never** stored as "any".

**Double-booking guard (LOCKED):** `POST /api/bookings` recomputes availability at submit
time and returns `409` if the slot is no longer free. The client must send the user back to
the time step on `409`.

**Known simplifications (documented, not bugs):** salon `hours` are display-only in phase 1
— availability uses the fixed 09:00–20:00 window for all days. Promoting per-day hours to
the engine is a Phase-2 item (§9) and must reuse the same algorithm, only swapping the
window bounds per weekday.

---

## 4. API contract (LOCKED request/response shapes)

Base: same origin. All bodies JSON. All errors: `{ "error": "<human message>" }`.
On `409`/`404`/`400` the `error` string is safe to show the user verbatim.

| # | Method · Route | Request | Success | Errors |
|---|---|---|---|---|
| 1 | GET `/api/config` | — | `{salon, categories, services, staff}` | — |
| 2 | GET `/api/availability?serviceId&staffId&date` | query | `{date, service, options:[{staffId,staffName,slots:["HH:MM"]}]}` | 400 missing serviceId/date |
| 3 | POST `/api/bookings` | `{serviceId, staffId, date, time, customer:{name*,phone*,email,notes}}` | 201 `{ok, booking}` | 400 missing fields · 409 slot taken |
| 4 | POST `/api/bookings/lookup` | `{ref, phone}` | 200 `{booking}` | 404 no match |
| 5 | POST `/api/bookings/reschedule` | `{id, date, time}` | 200 `{ok, booking}` | 404 not found · 400 cancelled · 409 slot taken |
| 6 | POST `/api/bookings/cancel` | `{id}` | 200 `{ok}` | 404 not found |
| 7 | GET `/api/bookings` | — | `{bookings:[…]}` sorted by date+time | — |
| 8 | GET `/api/notifications` | — | `{notifications:[…]}` newest first | — |
| 9 | GET `/api/stats` | — | `{totalBookings, activeBookings, cancelled, projectedRevenue, byCategory, byStaff}` | — |

**Validation rules (LOCKED, enforced server-side — client validation is convenience only):**
- `name` and `phone` required, trimmed, capped (name 80, phone 40, email 120, notes 500).
- Phone match in lookup compares **digits only** (`(555) 777-1212` == `5557771212`).
- Unknown service / missing date → 400, never a 500.
- `reschedule` checks the new slot against all OTHER bookings (excludes itself).

**Server consumers of each field** (so you know what breaks if you rename one): see §2 —
every field above is read by the page named in §5.

---

## 5. Screen specifications (every page, every state)

For each page: route, purpose, data it loads, components, and the **four states**
(loading / empty / error / success) where applicable. Buttons list their exact action.

### 5.1 Home — `/index.html` — `BUILT`
- Loads `GET /api/config`. Renders category cards, team preview, mini gallery from data.
- Sections (top→bottom): Hero · 3 value props · Services preview (4 cards) · Team (4) ·
  Gallery (8 tiles) · Testimonials (3) · CTA band.
- Buttons → targets: `Book an appointment`/`Book now`→booking; `View the menu`/`See all
  services`→services; category card→`services.html#<cat>`; `Browse gallery`→gallery.
- States: only success (static marketing). If `/api/config` fails, chrome still renders a
  bare page — acceptable.

### 5.2 Services — `/services.html` — `BUILT`
- Loads config. Filter chips: `All` + 4 categories. Renders a row per service:
  name · description · `duration min · with <artists>` · `$price from` · `Book`.
- Deep link: `#nails` (hash) pre-selects that filter on load.
- `Book` → `booking.html?service=<id>`.
- States: empty filter result is impossible (every category has services); if it were,
  show a muted "no services" line.

### 5.3 Booking wizard — `/booking.html` — `BUILT` — **the critical flow**
State object: `{step, serviceId, staffId, date, time, chosenStaff, customer{}}`.
Stepper shows active/done. **Forward navigation is guarded** (`go(step)` refuses to advance
without the prerequisite selection).

- **Step 1 Service:** services grouped by category as selectable tiles. Selecting resets
  downstream (`staffId`, `time`) so you can't keep a stale slot. `Next` disabled until a
  pick. Pre-selected via `?service=`.
- **Step 2 Artist:** `✨ Any available` + one tile per qualified artist. `Next` disabled
  until pick.
- **Step 3 Date & time:** date input (min = today). Calls `GET /api/availability`. Renders
  slots grouped per artist. States here:
  - loading → "Loading times…"
  - empty → "No openings that day — try another date."
  - success → slot grid; picking a slot stores `time` + resolves `chosenStaff`.
- **Step 4 Details:** form (name*, phone*, email, notes) + live summary (service/artist/
  when/duration/total). `Confirm booking ✓`:
  - client check name+phone → toast if missing
  - `POST /api/bookings`; on `409` toast + jump to Step 3; on other error toast + re-enable
  - on success → success screen (ref, summary, `Book another`/`Back home`).
- Buttons: `← Back`, `Next →` (label changes per step), `Confirm booking ✓`, slot tiles,
  option tiles, success actions.

### 5.4 Gallery — `/gallery.html` — `BUILT`
- 16 hardcoded demo items (emoji + label), filter chips by category, `Book your look`.
- **Placeholder note:** images are emoji+gradient tiles. Phase 2 swaps to real `<img>` with
  the SAME tile markup so layout doesn't change.

### 5.5 Team — `/team.html` — `BUILT`
- Loads config. Card per artist: initials avatar, name, title, bio, specialty tags,
  `Book with <First>` → booking.

### 5.6 Manage — `/manage.html` — `BUILT` — **self-service flow**
- **Lookup view:** ref + phone → `POST /api/bookings/lookup`. Wrong match → inline error,
  stay on form.
- **Booking view:** shows status badge + summary.
  - If `cancelled`: read-only message, only "look up another".
  - Else: `Reschedule` (reveals date+slots, reuses availability; picking a slot calls
    `reschedule`; `409` re-loads slots) and `Cancel booking` (confirm dialog → cancel).
- Toaster confirms each action; view re-renders from the returned booking.

### 5.7 Admin — `/admin.html` — `BUILT`
- Loads stats + bookings + config + notifications in parallel.
- Stat cards: Active · Projected revenue · Cancelled · All-time.
- Bar charts: by category, by artist (CSS bars).
- Bookings table: ref · when · service · artist · customer(+phone) · total · status ·
  `Cancel` (confirmed rows only).
- Notifications table: type · to · channel · message · when · status.
- Buttons: `+ New booking`→booking, `↻ Refresh`→reload, per-row `Cancel`.
- **No auth in phase 1** (documented gap; Phase 2 §9 adds login). Do not ship to a public
  domain without it.

---

## 6. Component & visual contract (so styling isn't reinvented)

Reusable classes already defined in `styles.css` — **use these, don't invent new ones:**
`.btn .btn-primary .btn-ghost .btn-gold .btn-sm` · `.card` · `.chip` · `.option(.selected)`
· `.slot(.selected)` · `.field` · `.panel` · `.step(.active/.done)` · `.summary-line` ·
`.status.confirmed/.cancelled` · `.toast` · `.stat` · `table.bookings` · `.avatar` · `.tag`.

CSS variables (palette/spacing) in `:root` are the only place colors are defined.
Breakpoints: `900px` (tablet: nav collapses to hamburger, grids → 2-col) and `560px`
(mobile: grids → 1-col). New pages must honor both.

**Accessibility/SEO rules (LOCKED):** every page has `<title>` + `meta description`,
semantic headings (one `h1`/`h2` per section), `lang="en"`, focus-visible inputs, and the
mobile nav toggle has `aria-label`. Keep these on any new page.

---

## 7. Placeholders & simulated parts (explicitly, so nobody mistakes them for real)

| Thing | Current state | Phase-2 replacement (same shape) |
|---|---|---|
| Service/gallery/avatar imagery | emoji + CSS gradient / initials | real `<img>`, identical containers |
| Notifications | records generated + logged, **not sent** | Twilio (SMS) / SendGrid (email) at creation point |
| Salon contact, testimonials | seed sample data | real content in `seed.json` |
| Input placeholders (6) | ghost text only: name, phone, email, notes, ref, phone | unchanged |
| Payments | none | Stripe deposit at Step 4 |

---

## 8. Acceptance tests (definition of done — must pass, already verified for Phase 1)

1. `GET /api/config` returns 15 services, 4 staff, 4 categories.
2. Booking happy path: book a free slot → 201 + `LUM-` ref + booking persisted.
3. Double-book same artist/date/time → 409 with the exact "just taken" message.
4. "Any available" returns ≥1 artist's slots and books a real (non-"any") artist.
5. Buffer respected: a 45-min service at 09:00 blocks the next start until ≥10:00.
6. Lookup: correct ref+phone (any phone formatting) → 200; wrong phone → 404.
7. Reschedule to a free slot → 200, date/time updated, reminder regenerated (count stays 1).
8. Cancel → status `cancelled`, excluded from stats revenue & availability.
9. Each booking creates exactly 2 notifications (confirmation=sent, reminder=scheduled).
10. Every page renders header+footer and is responsive at 900px and 560px.

**Regression rule:** any change to `server.js` must re-run tests 1–9 (the smoke-test
snippet in chat history). Any new page must satisfy 10.

---

## 9. Phase-2 specs (designed now so they slot in WITHOUT refactor)

Each item states the **integration point** so it's additive, not a rewrite.

- **Per-day hours:** replace fixed `OPEN_MIN/CLOSE_MIN` in `availableSlots()` with a lookup
  into `salon.hours[weekday]`. Algorithm unchanged. *Touch point: one function.*
- **Customer accounts:** add `customers[]` keyed by phone; link bookings via `customerId`.
  Booking flow gains an optional "log in / continue as guest" — guest path stays identical.
- **Loyalty points:** add `points` to customer; award `floor(price/10)` on completed visit;
  show on Step-4 summary + success. *Touch point: booking creation + one UI line.*
- **Gift cards:** new `giftCards[]` `{code, balance}`; redeem at checkout. New admin tab.
- **Deposits/payments:** insert a Stripe step between Step 4 and confirm; booking gains
  `paid`/`depositCents`. *Additive step, wizard unchanged otherwise.*
- **Real notifications:** at the two `makeNotifications` creation points, call the provider;
  set `status:"sent"` on success. *Touch point: one function.*
- **Waitlist:** new `waitlist[]`; on cancel, notify the first matching entry.
- **Admin login:** gate `/admin.html` + admin APIs behind a session cookie. Public APIs
  (config/availability/bookings POST/lookup/reschedule/cancel) stay open.
- **Real DB:** swap `loadDB/saveDB` for Postgres/SQLite behind the **same two functions**.
  No caller changes. *That's the whole point of centralizing them.*

---

## 10. Open decisions (resolve BEFORE building the relevant item — do not assume)

1. Cancellation cutoff window? (e.g., no cancel within 24h) — affects manage + API.
2. Deposit amount/policy — flat fee vs. % vs. only for services over $N?
3. Do multi-service bookings in one visit ship in Phase 2? (engine supports one service now.)
4. Loyalty: points on booking or on completed/attended visit? (no-show handling.)
5. Timezone handling if the salon ever serves multiple regions — Phase 1 assumes local.

Until an item here is answered, its dependent feature is **blocked**, not guessed.

---

*This spec is the contract. If the code and this file disagree, that is a bug in one of
them — fix the mismatch, don't fork the behavior.*
