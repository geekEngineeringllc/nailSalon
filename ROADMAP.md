# Lumière — Nested Execution Plan, To-Dos, Flows & Gap Audit

Companion to **SPEC.md** (the contract) and **INVENTORY.md** (the counts). This file is the
**work breakdown**: epics → stories → tasks → subtasks, each with a checkbox, the detailed
flow (happy path + edge cases + error/empty/loading states), acceptance criteria, and a
dependency note. The **Gap Audit (§G)** lists everything currently missing, ranked by
severity — including two real issues in the Phase-1 build that should be fixed first.

Checkbox legend: `[x]` done · `[ ]` to do · `[~]` partial/needs hardening.

---

## G. GAP AUDIT — what's missing right now (fix top-down)

### G1. Security — `CRITICAL / HIGH`
- [ ] **G1.1 Stored XSS (HIGH, real today).** `customer.name`/`notes` are rendered with
  `innerHTML` in `admin.html`, `manage.html`, and the booking success screen. A name like
  `<img onerror=...>` would execute. **Fix:** an `escapeHtml()` helper applied to every
  user-supplied string before interpolation, OR switch those inserts to `textContent`.
  *Flow risk: attacker books with a script payload → salon owner opens admin → script runs.*
- [ ] **G1.2 JSON write race (HIGH, real today).** `saveDB()` does read-modify-write with no
  lock. Two near-simultaneous bookings can clobber each other (lost booking) even though the
  409 guard passed. **Fix:** serialize writes via an in-process async queue/mutex; or move to
  SQLite (atomic) in Phase 2. *Document as known until fixed.*
- [ ] **G1.3 No rate limiting.** `/api/bookings`, `/api/bookings/lookup` are abusable
  (spam bookings, phone/ref brute-force). **Fix:** per-IP token bucket; lookup lockout after
  N misses.
- [ ] **G1.4 No admin auth.** `/admin.html` + admin APIs are public. **Fix:** Phase-2 login
  (E7). Until then, do NOT deploy to a public URL.
- [ ] **G1.5 No CSRF protection** (only matters once cookies/sessions exist — Phase 2).
- [ ] **G1.6 No security headers** (CSP, X-Content-Type-Options, etc.). **Fix:** set on every
  response in `server.js`.

### G2. Input validation — `MEDIUM`
- [ ] **G2.1 Server doesn't reject past dates/times** (client sets `min=today` only). Add a
  server check: `date >= today` and `time` on the 15-min grid within hours.
- [ ] **G2.2 No email format / phone format validation** (only length caps).
- [ ] **G2.3 No check that `time` is actually a generated slot** (a crafted POST could book
  09:07). The availability re-check mitigates overlap but not grid alignment — tighten.
- [ ] **G2.4 No max-future-date limit** (someone could book in year 2099).

### G3. Accessibility — `MEDIUM`
- [ ] **G3.1 Custom tiles/slots are `<div>` with click handlers** — not keyboard reachable.
  **Fix:** make them real `<button>`s or add `role`, `tabindex`, Enter/Space handlers.
- [ ] **G3.2 No focus management between wizard steps** (focus should move to the new step).
- [ ] **G3.3 No `aria-live` on toast / availability results** for screen readers.
- [ ] **G3.4 Color-contrast pass** on muted text + gold-on-white not yet audited.
- [ ] **G3.5 Date input has no min/max announced; no error text tied to fields via `aria-describedby`.**

### G4. Data integrity & business rules — `MEDIUM`
- [ ] **G4.1 No cancellation cutoff** (cancel 1 min before visit allowed). *SPEC §10 #1.*
- [ ] **G4.2 No no-show / completed status** — bookings are only confirmed/cancelled, so
  revenue is "projected" forever. Add `completed`, `no-show`.
- [ ] **G4.3 No resource model** beyond artist (chairs/rooms/pedicure-stations not capped).
- [ ] **G4.4 Per-day salon hours are display-only** — engine uses fixed 09–20. *SPEC §3.*
- [ ] **G4.5 No double-booking protection for the SAME customer** at overlapping times.
- [ ] **G4.6 Reschedule/cancel are unauthenticated by reference only** — anyone with a ref +
  phone can act (acceptable for guests, revisit with accounts).

### G5. Ops, testing, observability — `MEDIUM/LOW`
- [ ] **G5.1 No automated test suite** — only a manual smoke snippet. Add a `test.js` that
  runs the 10 acceptance checks on each change.
- [ ] **G5.2 No logging/audit trail** (who cancelled what, when).
- [ ] **G5.3 No error monitoring / structured logs.**
- [ ] **G5.4 No backup or migration strategy** for `db.json`.
- [ ] **G5.5 No graceful handling if `seed.json` is malformed** (server would crash on boot).
- [ ] **G5.6 No health-check endpoint** (`/api/health`).

### G6. UX & content polish — `LOW`
- [ ] **G6.1 Real photography** (gallery/avatars are emoji+gradient placeholders).
- [ ] **G6.2 Loading skeletons** instead of "Loading…" text.
- [ ] **G6.3 Styled 404 page** (currently a bare string).
- [ ] **G6.4 Favicon + social/OG images** missing.
- [ ] **G6.5 No "add to calendar" (.ics)** on confirmation.
- [ ] **G6.6 No print styles** for the confirmation/receipt.
- [ ] **G6.7 No empty-state illustration** on admin when zero bookings (text only — ok).
- [ ] **G6.8 No i18n / multi-language** scaffold.

### G7. SEO & discoverability — `LOW`
- [ ] **G7.1 No `LocalBusiness`/`HairSalon` JSON-LD structured data** (hours, address, geo).
- [ ] **G7.2 No `sitemap.xml` / `robots.txt`.**
- [ ] **G7.3 No canonical URLs / Open Graph / Twitter cards.**
- [ ] **G7.4 No analytics** (visits, booking funnel drop-off).

---

## E. EPICS → STORIES → TASKS (the build plan)

### EPIC E0 — Phase-1 Hardening (do BEFORE new features) — `[~]`
> Rationale: ship the gaps that are bugs/risks before stacking Phase 2 on top.
- [ ] **E0.1 Escape user input (G1.1)**
  - [ ] add `escapeHtml(s)` to `common.js`
  - [ ] apply in admin table, manage view, booking success
  - [ ] test with payload name `<b>x</b>` → renders literally
- [ ] **E0.2 Serialize DB writes (G1.2)**
  - [ ] wrap `saveDB` in an async write-queue
  - [ ] concurrency test: fire 20 simultaneous bookings → all persist
- [ ] **E0.3 Server-side validation (G2.1–G2.4)**
  - [ ] reject past date, off-grid time, out-of-hours, far-future
  - [ ] email/phone format checks → 400 with field-specific message
- [ ] **E0.4 Keyboard a11y for tiles/slots (G3.1–G3.2)**
  - [ ] convert to `<button>` or add role/tabindex + key handlers
  - [ ] move focus to step heading on advance
- [ ] **E0.5 Security headers + health endpoint (G1.6, G5.6)**
- [ ] **E0.6 `test.js` acceptance harness (G5.1)** — runs SPEC §8 checks, exit non-zero on fail
- **Acceptance:** all 10 SPEC tests pass via `node test.js`; XSS payload neutralized; 20-way
  concurrent booking loses nothing.
- **Depends on:** nothing. **Blocks:** safe deploy, Phase 2.

### EPIC E1 — Customer Accounts (Registration) — `[ ]` — *SPEC §9, F10*
- [ ] **E1.1 Data:** `customers[]` keyed by phone (`id, phone, name, email, passwordHash|null, verified, createdAt, favoriteStaffId, points`)
- [ ] **E1.2 API:** `POST /api/register` → create unverified + send OTP
- [ ] **E1.3 API:** `POST /api/verify {phone, code}` → mark verified, **auto-link** past guest bookings by phone
- [ ] **E1.4 Page:** `register.html` (form → OTP → success)
  - flow: form submit → loading → OTP screen → verify → "account ready" → redirect
  - edge: phone already registered → "log in instead"; wrong/expired OTP; resend cooldown
- [ ] **E1.5 Link nudge** on booking success + header "Sign up"
- **Acceptance:** registering with a phone that has prior bookings shows that history instantly.
- **Depends on:** E0 (escape/validation), OTP service decision (SPEC §10 #1 of accounts).

### EPIC E2 — Login / Session — `[ ]` — *F11*
- [ ] **E2.1 API:** `POST /api/otp {phone}`, `POST /api/login {phone, otp|password}`, `POST /api/logout`, `GET /api/me`
- [ ] **E2.2 Session:** httpOnly cookie, signed; `requireAuth` middleware
- [ ] **E2.3 Page:** `login.html` with all states (loading, wrong creds, unverified, OTP expired, lockout, success-redirect)
- [ ] **E2.4 Header swap:** logged-in → "My account ▾ / Logout"
- [ ] **E2.5 CSRF token (G1.5)** on state-changing POSTs
- **Acceptance:** logged-in user's booking Step 4 pre-fills; manage page skips ref+phone.
- **Depends on:** E1.

### EPIC E3 — My Account Dashboard — `[ ]` — *F12*
- [ ] **E3.1 Page:** `account.html` — upcoming, past, favorite artist, saved notes, points
- [ ] **E3.2 "Rebook last look"** one-tap → booking pre-filled from a past visit
- [ ] **E3.3 Profile edit** (name, email, marketing opt-in)
- [ ] **E3.4 Booking list with FILTER (upcoming/past/cancelled) + SEARCH + PAGINATION** (ties to G + cross-cutting below)
- **Depends on:** E2.

### EPIC E4 — Search, Filter, Pagination (cross-cutting) — `[ ]`
- [ ] **E4.1 Admin booking FILTER** (status, date range, artist) — client first
- [ ] **E4.2 Admin booking SEARCH** (`?q=` over ref/name/phone) with debounce + empty state
- [ ] **E4.3 PAGINATION** — server `?page=&pageSize=`, returns `{items,page,total}`; Prev/Next UI; **trigger when list > 50**
- [ ] **E4.4 Service-menu SEARCH** (live filter rows)
- [ ] **E4.5 Notifications feed: filter by type/status + pagination**
- **Flow (each):** input/click → (debounce) → query (mem or server) → re-render → loading & "no results" states → preserve filter on refresh.
- **Depends on:** E0; admin filters independent of accounts.

### EPIC E5 — Real Notifications — `[ ]` — *F6 → real*
- [ ] **E5.1 SMS via Twilio** at `makeNotifications` send point; set `status:sent` on success, `failed` on error (retry once)
- [ ] **E5.2 Email via SendGrid** when email present
- [ ] **E5.3 Scheduler** that actually fires reminders at `scheduledFor` (cron/interval worker)
- [ ] **E5.4 Marketing broadcasts** (birthday, win-back ≥60d) — filtered queries
- [ ] **E5.5 Unsubscribe / opt-out compliance**
- **Depends on:** provider keys (SPEC §10), E0.

### EPIC E6 — Payments & Loyalty & Gift Cards — `[ ]` — *F13–F15*
- [ ] **E6.1 Deposits:** Stripe step between booking Step 4 and confirm; booking gains `depositCents`, `paid`
- [ ] **E6.2 Loyalty:** award `floor(price/10)` on **completed** visit (needs G4.2 statuses); show at checkout + account
- [ ] **E6.3 Gift cards:** `giftCards[] {code,balance}`; buy + redeem at checkout; admin tab
- [ ] **E6.4 Refund handling** tied to cancellation policy (G4.1)
- **Depends on:** E0, E2, status model (G4.2). **Decisions:** SPEC §10 #2,#4.

### EPIC E7 — Waitlist & Resources — `[ ]` — *F16, G4.3*
- [ ] **E7.1 Waitlist join** when a day is full
- [ ] **E7.2 Auto-notify** first match on cancellation (hooks E5)
- [ ] **E7.3 Resource model** (chairs/rooms/stations) added to availability engine
- **Depends on:** E5 (notify), engine refactor.

### EPIC E8 — Ops, SEO, Polish — `[ ]` — *G5–G7*
- [ ] **E8.1 JSON-LD LocalBusiness + sitemap + robots + OG/favicon (G6.4, G7)**
- [ ] **E8.2 Loading skeletons, styled 404, .ics, print receipt (G6)**
- [ ] **E8.3 Logging/audit + health + analytics funnel (G5.2–G5.6, G7.4)**
- [ ] **E8.4 i18n scaffold (G6.8)**

---

## D. DETAILED FLOWS WITH EDGE CASES (the ones not yet written down)

### D1. Booking — full state machine (incl. failures)
```
Step1 service ─(none)→ Next disabled
              ─pick→ resets staff/time → Step2
Step2 artist  ─pick→ Step3
Step3 date    ─default today; change → refetch
       fetch  ─loading→ slots | empty("try another date") | error(toast, retry)
       slot   ─pick→ resolve real artist → Next enabled
Step4 submit  ─missing name/phone→ toast, stay
              ─POST 201→ success(ref)
              ─POST 409 (slot taken)→ toast + jump Step3, reload slots
              ─POST 400 (bad field)→ toast field message
              ─network error→ toast "try again", re-enable button
              ─[E0] off-grid/past time→ 400 rejected server-side
```
Missing-today branches to add: network error retry, server 400 field messaging, focus move.

### D2. Manage — edge cases
```
lookup ─empty fields→ toast
       ─no match→ inline error, stay
       ─match→ booking view
view   ─cancelled→ read-only
       ─[E0+G4.1] within cutoff→ disable cancel/reschedule with reason
reschedule ─pick slot 409→ reload slots, keep panel
cancel ─confirm dialog→ cancel→ re-render
```

### D3. Registration/Login — edge cases (Phase 2)
```
register ─phone exists→ "log in instead"
         ─OTP wrong→ error, attempts--; ─expired→ resend; ─lockout after N
login    ─unverified→ verify first
         ─wrong creds→ generic msg (don't leak existence)
         ─success→ redirect to intended page
session  ─expired cookie→ silent → guest mode, prompt re-login on protected action
```

### D4. Pagination flow (Phase 2)
```
list>50 → server pages → render page 1 + Prev(disabled)/Next
Next → fetch page+1 → replace rows → update counter → disable at last page
filter/search change → reset to page 1
```

---

## C. SEQUENCING (dependency order — don't build out of order)

```
E0 Hardening ─────────────┬──▶ E1 Register ──▶ E2 Login ──▶ E3 Account
                          │                                   │
                          ├──▶ E4 Search/Filter/Pagination ◀──┘ (admin part needs only E0)
                          ├──▶ E5 Notifications (real)
                          │        └──▶ E7 Waitlist
                          └──▶ E6 Payments/Loyalty/Giftcards (needs E2 + status model)
E8 Ops/SEO/Polish ── parallel, anytime after E0
```

**One rule:** E0 first. Everything else stacks on a hardened, validated, escaped base so no
feature gets rebuilt after a security/validation fix.

---

## B. MASTER TO-DO (flat checklist, copy into a tracker)

- [ ] E0.1 escape user input  · [ ] E0.2 serialize writes  · [ ] E0.3 server validation
- [ ] E0.4 keyboard a11y  · [ ] E0.5 headers+health  · [ ] E0.6 test.js
- [ ] E1 registration (5 tasks)  · [ ] E2 login/session (5)  · [ ] E3 account (4)
- [ ] E4 search/filter/pagination (5)  · [ ] E5 real notifications (5)
- [ ] E6 payments/loyalty/giftcards (4)  · [ ] E7 waitlist/resources (3)
- [ ] E8 ops/seo/polish (4)
- [ ] Resolve SPEC §10 open decisions (5) — blocks E1/E6/E7

**Definition of fully done:** every box above checked, `node test.js` green, Gap Audit §G
cleared or consciously deferred with a note, SPEC.md updated to match.
