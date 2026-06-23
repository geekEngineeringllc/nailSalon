# Lumière — Complete Inventory: Buttons, Features, Functions & Flows

Exhaustive count of everything in the project. **Phase 1 = `BUILT` & verified** (numbers
counted from the actual source). **Phase 2 = `PLANNED`** (designed in SPEC.md §9, not yet
coded). Use this as the build checklist — nothing here is approximate.

---

## 0. Totals at a glance

| Thing | Phase 1 (BUILT) | Phase 2 (PLANNED) | Total |
|---|---|---|---|
| Pages | 7 | +3 (login, register, my-account) | 10 |
| Features (top-level) | 9 | +7 | 16 |
| Sub-features | 31 | +24 | 55 |
| API endpoints | 9 | +7 | 16 |
| Server functions | 10 | +6 | 16 |
| Client functions (shared + page) | 46 | +18 | 64 |
| Distinct button **types** | 17 | +9 | 26 |
| Button **instances** (incl. generated) | ~60 at runtime | +~25 | ~85 |
| Cross-cutting: filter / search / pagination / notification | 1 / 0 / 0 / 1 | +3 / +2 / +3 / +2 | — |

---

## 1. FEATURES → SUB-FEATURES (with flow for each)

### F1. Marketing site — `BUILT`
- **1.1 Home hero + CTAs** → click CTA → routes to booking/services.
- **1.2 Value props (3 cards)** → static.
- **1.3 Service preview (4 category cards)** → click → `services.html#<cat>` (pre-filtered).
- **1.4 Team preview (4)** → static cards.
- **1.5 Gallery preview (8 tiles)** → click "Browse" → gallery.
- **1.6 Testimonials (3)** → static.
- **1.7 CTA band** → "Book now" → booking.

### F2. Service catalog — `BUILT`
- **2.1 Load services** → `GET /api/config`.
- **2.2 Category filter** (All + 4) → chip click re-renders list. *(the FILTER feature)*
- **2.3 Per-service row** (name, desc, duration, artists, price).
- **2.4 Deep-link** `#nails` → opens pre-filtered.
- **2.5 Book button per service** → `booking.html?service=<id>` (pre-selects).

### F3. Booking wizard — `BUILT` — **core flow**
- **3.1 Step 1 — service select** → tiles; selecting resets downstream.
- **3.2 Step 2 — artist select** → "Any available" or specific.
- **3.3 Step 3 — date picker** → min=today.
- **3.4 Step 3 — availability fetch** → `GET /api/availability` (loading/empty/success).
- **3.5 Step 3 — slot select** → resolves real artist for "any".
- **3.6 Step 4 — details form** → name*, phone*, email, notes.
- **3.7 Step 4 — live summary** → service/artist/when/duration/total.
- **3.8 Submit** → `POST /api/bookings`; 409 → bounce to Step 3.
- **3.9 Success screen** → ref + summary + "book another"/"home".
- **3.10 Step guards** → can't advance without prerequisite.
- **3.11 Back/Next navigation** → `go(step)`.

### F4. Self-service manage — `BUILT`
- **4.1 Lookup** → ref + phone → `POST /api/bookings/lookup` (digits-only phone match).
- **4.2 View booking** → status badge + summary.
- **4.3 Reschedule** → reveal date + slots → `POST /api/bookings/reschedule` (409 reloads).
- **4.4 Cancel** → confirm dialog → `POST /api/bookings/cancel`.
- **4.5 Look up another** → reset to form.

### F5. Owner dashboard — `BUILT`
- **5.1 Stat cards (4)** → `GET /api/stats`.
- **5.2 By-category bar chart.**
- **5.3 By-artist bar chart.**
- **5.4 Bookings table** → `GET /api/bookings` (sorted date+time).
- **5.5 Cancel from table** → per-row, confirmed only.
- **5.6 Refresh** → reload all.
- **5.7 New booking** → routes to booking.

### F6. Notifications — `BUILT` (simulated)
- **6.1 Auto-create on booking** → confirmation (sent) + reminder (scheduled −24h).
- **6.2 Refresh on reschedule** → old reminder deleted, new one created.
- **6.3 Admin feed** → `GET /api/notifications` table. *(the NOTIFICATION feature)*

### F7. Availability engine — `BUILT`
- **7.1 Slot generation** (OPEN→CLOSE, 15-min step).
- **7.2 Duration + 10-min buffer enforcement.**
- **7.3 Overlap detection per artist.**
- **7.4 "Any available" merge across qualified artists.**

### F8. Shared chrome — `BUILT`
- **8.1 Header injection** (nav, active state, Book Now).
- **8.2 Mobile hamburger toggle.**
- **8.3 Footer injection** (address, hours, CTA).
- **8.4 Toast notifications** (client-side feedback).

### F9. Data persistence — `BUILT`
- **9.1 Auto-seed** db.json from seed.json on first run.
- **9.2 Load/save JSON store.**
- **9.3 Snapshot pricing onto bookings.**

### Phase 2 features — `PLANNED` (SPEC §9)
- **F10. Registration** → form → OTP verify → create account → auto-link past bookings.
- **F11. Login / logout** → phone + OTP/password → session cookie → `GET /api/me`.
- **F12. My-account dashboard** → upcoming/past visits, favorite artist, saved notes.
- **F13. Loyalty points** → earn per visit, shown at checkout + account.
- **F14. Gift cards** → buy, redeem at checkout, admin tab.
- **F15. Deposits/payments** → Stripe step before confirm.
- **F16. Waitlist** → join when full; auto-notify on cancellation.

---

## 2. BUTTON INVENTORY (every type + where)

### Static button types — `BUILT`
| # | Button | Page(s) | Action |
|---|---|---|---|
| 1 | Book Now (header) | all | → booking.html |
| 2 | Hamburger ☰ | all (mobile) | toggle nav |
| 3 | Book an appointment | home, footer | → booking |
| 4 | View the menu | home | → services |
| 5 | See all services | home | → services |
| 6 | Browse the gallery | home, gallery | → gallery |
| 7 | Book now (CTA band) | home | → booking |
| 8 | Book your look | gallery | → booking |
| 9 | Book with <artist> | team (×4) | → booking |
| 10 | ← Back | booking | go(step−1) |
| 11 | Next → / Confirm ✓ | booking | go(next) / submit |
| 12 | Book another / Back home | booking success | reset / home |
| 13 | Find my booking | manage | lookup |
| 14 | Reschedule | manage | reveal slots |
| 15 | Cancel booking | manage / admin | cancel |
| 16 | + New booking / ↻ Refresh | admin | route / reload |
| 17 | Look up another | manage | reset |

### Generated button instances (runtime) — `BUILT`
- Service "Book" rows: **15** (one per service)
- Category filter chips: **5** on services, **5** on gallery
- Booking service tiles: **15**; artist tiles: **2–4** per service
- Time-slot buttons: **N per day** (up to ~40 per artist)
- Admin per-row Cancel: **1 per confirmed booking**

### Phase 2 button types — `PLANNED`
Log in · Sign up · Send code (OTP) · Verify · Logout · My account ▾ · Save profile ·
Redeem gift card · Pay deposit (9 new types).

---

## 3. FUNCTIONS → SUB-FUNCTIONS

### Server (`server.js`) — 10 functions — `BUILT`
1. `loadDB()` — read/seed store
2. `saveDB(db)` — persist
3. `toMin(hhmm)` / 4. `toHHMM(min)` — time helpers
5. `availableSlots(db, service, staff, date)` — **core engine** (sub-steps: candidate loop → overlap test → collect)
6. `sendJSON(res, status, obj)`
7. `serveStatic(req, res)` — static file serving + path guard + MIME
8. `readBody(req)` — JSON body parse
9. `makeNotifications(booking)` — builds confirmation + reminder
10. `handleAPI(req, res, url)` — router → 9 route branches (each a sub-function of logic), incl. inline `digits()` in lookup
   + `http.createServer` callback + `listen`.

### Client shared (`common.js`) — `BUILT`
- `api` object → **9 methods**: config, availability, book, bookings, stats, notifications, cancel, lookup, reschedule
- `money(n)`, `toast(msg)`, `renderChrome()` (sub: header build, nav toggle, footer build)

### Client per-page functions — `BUILT`
- **index:** 1 (DOMContentLoaded render of cards/team/gallery)
- **services:** `render()` + init/filter wiring (2)
- **booking (≈14):** `todayISO`, `setStepUI`, `svc`, `render`, `navButtons`, `renderService`, `renderStaff`, `renderTime`, `loadSlots`, `renderDetails`, `submitBooking`, `renderSuccess`, `go`, init
- **gallery:** `render()` + init (2)
- **team:** 1 (init render)
- **manage (≈8):** `todayISO`, `lookupForm`, `doLookup`, `showBooking`, `doCancel`, `showReschedule`, `loadResched`, init
- **admin (≈4):** `bars`, `load`, `cancelB`, init

### Phase 2 functions — `PLANNED`
Server: `register`, `sendOtp`, `verifyOtp`, `login`, `logout`, `requireAuth` (6).
Client: account page render, login form, otp form, session check, profile save, etc. (~18).

---

## 4. CROSS-CUTTING CONCERNS — flow for each

### FILTER — `BUILT` (1 instance) / `PLANNED` (+3)
- **Built:** category chips on Services & Gallery. Flow: click chip → set `current` →
  `render()` re-filters in memory (no server call) → active chip highlighted.
- **Planned:** admin bookings filter (by status / date / artist), gallery by artist.

### SEARCH — `PLANNED` (none built yet)
- **Admin booking search:** input → filter table by ref/name/phone substring (client-side
  for small sets; server `?q=` when paginated).
- **Service search** on the menu: type → live-filter the service rows.
- Flow: debounce input → match → re-render → show "no results" empty state.

### PAGINATION — `PLANNED` (none built; not needed at current data size)
- **Trigger rule:** add when any list exceeds ~50 rows (admin bookings, notifications).
- **Design:** server returns `?page=&pageSize=` → `{items, page, total}`; UI shows
  Prev/Next + page count. Flow: click Next → fetch page → replace rows → disable Prev/Next
  at bounds. Until then, lists render fully (documented, intentional).

### NOTIFICATION — `BUILT` (1 system) / `PLANNED` (+2)
- **Built (transactional):** confirmation + 24h reminder per booking; reschedule refreshes
  reminder; shown in admin feed. Flow: booking created → `makeNotifications()` →
  pushed to `notifications[]` → admin `GET /api/notifications`.
- **Built (UI toasts):** `toast()` for client feedback (booked, cancelled, errors).
- **Planned:** real delivery (Twilio/SendGrid) at the creation point; marketing broadcasts
  (birthday, win-back) filtered by last-visit/loyalty.

---

## 5. FLOW MAP (one line each — the whole app)

```
Home ─CTA─▶ Booking ─4 steps─▶ POST /bookings ─▶ Success(ref) ─▶ notifications[]
Services ─Book─▶ Booking (pre-selected service)
Gallery / Team ─Book─▶ Booking
Manage ─ref+phone─▶ lookup ─▶ {Reschedule | Cancel}
Admin ─load─▶ stats + bookings + notifications ─▶ Cancel row
[P2] Header ─Login─▶ phone+OTP ─▶ session ─▶ My-account ─▶ history/points/giftcards
```

---

## 6. "Do you have a plan?" — Yes. Coverage status

- Buttons: **enumerated** (17 types built, +9 planned). ✔
- Features/sub-features: **enumerated** (9/31 built, +7/+24 planned). ✔
- Functions/sub-functions: **counted from source** (server 10, client 46). ✔
- Filter: **built** (category) + 3 planned. ✔
- Search: **planned** (2 surfaces, flow defined). ✔
- Pagination: **planned** with a clear trigger rule (>50 rows). ✔
- Notifications: **built** (transactional + toasts) + 2 planned. ✔

Anything marked PLANNED has an integration point in SPEC.md §9 so it's additive — no
rework. The only things still genuinely undecided are the 5 open questions in SPEC.md §10.
