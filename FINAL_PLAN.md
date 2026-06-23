# Lumière — FINAL BUILD PLAN (Master)

The single, build-ready execution plan. It (1) **closes every open decision** so nothing is
blocked, (2) folds in **all features from the original brief** that earlier drafts dropped,
(3) adds the **delivery layer** (RBAC, NFR budgets, testing, deploy, risk, cost, estimates),
and (4) keeps the **zero-rework milestone order**. Companion docs in [DOCS.md](DOCS.md);
this file is the source of truth for *plan* questions.

> **Milestones: 8 (M0–M7).** Critical path M0→M1→M2→M3→M4→M5; M6 & M7 parallel after M1.

---

## 1. RESOLVED DECISIONS (M0 closed — defaults locked, change only via this file)

| # | Question | **Decision (default)** | Rationale |
|---|---|---|---|
| D1 | Cancellation/reschedule cutoff | **Free up to 24h before; within 24h forfeits deposit (or blocked if none)** | Standard salon policy; protects the slot |
| D2 | Deposit policy | **20% deposit on services ≥ $80 and on all new customers; applied to final bill** | Targets no-show-prone high-value visits |
| D3 | Multi-service per visit | **Yes — chain up to 3 services, durations summed** | Common (mani+pedi, color+cut) |
| D4 | Loyalty timing | **Points on COMPLETED visit only; 1 pt/$1, 100 pts = $5** | Prevents no-show point-gaming |
| D5 | Timezone | **Single location, salon-local tz; store ISO, render local** | One location in scope |
| D6 | Auth method | **Passwordless OTP via SMS** | Phone is the account key; no password resets |
| D7 | Session length | **30-day "remember me"; re-verify for payment/cancel** | Convenience + safety on sensitive actions |
| D8 | DB (production) | **SQLite behind `loadDB/saveDB` seam** | Atomic writes; zero caller changes |

---

## 2. COMPLETE SCOPE (built + planned + previously-dropped, now included)

### Built (Phase 1) — see BLUEPRINT
Marketing site · service catalog · 4-step booking · availability engine · self-service
manage · owner dashboard · simulated notifications · JSON persistence.

### To build — grouped, every item has a milestone
| Group | Items | Milestone |
|---|---|---|
| Safety | escape XSS, write-lock, validation, a11y, tests, headers, rate-limit | M1 |
| Operability | admin CRUD (services/staff), scheduling (hours/breaks/time-off), block-off, resources, walk-in booking | M2 |
| Identity | registration (OTP), login/session, my-account, auto-link guest bookings | M3 |
| Booking depth | statuses (completed/no-show), cutoff (D1), **multi-service (D3)**, deposits (D2), **packages/series**, **recurring**, **group/bridal bookings** | M4 |
| Engagement | real SMS/email + scheduler, **loyalty (D4)**, gift cards, **memberships**, **referrals**, waitlist, **reviews/ratings**, broadcasts | M5 |
| Operations++ | **retail store + inventory**, **staff tips/commission**, **owner reports (payroll/tax/daily sheet)** | M5/M6 |
| Discoverability | search, filter, pagination, SEO/JSON-LD, analytics | M6 |
| Launch | legal/consent, polish, performance, ops/backup, RBAC enforce, i18n, real media, DB swap | M7 |

**Bold = recovered from the original brief that earlier drafts had dropped.**

---

## 3. THE 8 MILESTONES (expanded)

Each: goal · key tasks · exit gate · est. size (assuming 1 full-stack dev). Sizes are
relative (S≈1–3d, M≈1wk, L≈2wk, XL≈3wk+).

### M0 — Decisions & Doc Lock · **S**
- [x] Resolve D1–D8 (above) · [ ] add DOCS.md index (done) · [ ] reconcile counts to BLUEPRINT
- **Exit:** no open decisions; one doc set.

### M1 — Hardening · **M** · ✅ DONE (16/16 tests green)
- [x] `esc()` everywhere user input renders (XSS) — verified inert
- [x] serialize `saveDB` writes via `withLock` (race) — 43 concurrent, 0 lost
- [x] server validation: past/off-grid/out-of-hours/far-future/email/phone/unknown-service/wrong-artist
- [x] keyboard-accessible slots/tiles (role=button, tabindex) + focus mgmt + `aria-live` + focus-visible
- [x] security headers (CSP/nosniff/frame), rate limiting (429), `/api/health`, safe boot on bad seed (exit 1)
- [x] `test.js` running SPEC §8 acceptance + hardening assertions
- **Exit:** ✅ `node test.js` → 16 passed, 0 failed; XSS inert; concurrent bookings lose none.

### M2 — Owner Operability · **L** · ✅ DONE (29/29 tests green)
- [x] **M2.1** Admin CRUD: services (create/edit/delete, validated, lock) — tested
- [x] **M2.2** Admin CRUD: staff (create/edit/delete, orphan-guard) — tested
- [x] **M2.3a** Scheduling engine: per-day salon hours, staff hours override, time-off/vacation,
  recurring breaks → fed into `availableSlots()`; validated; API persists schedule — tested
- [x] **M2.3b** Admin GUI to edit staff hours/time-off/breaks — verified end-to-end in browser
  (set day-off + custom hours + vacation via the form → availability reflected it correctly)
- [x] **M2.4** Block-off slots (lunch/cleaning/event) — one-off blocks; engine excludes them;
  admin form + table; verified in browser (add → availability drops → remove → restored)
- [x] **M2.5** Resource model (chairs/rooms/stations) — shared-capacity caps concurrent
  bookings across all artists; service↔resource link; admin Resources CRUD; verified in browser
  (capacity-1 chair: noor books → lily blocked at same time)
- [x] **M2.6** Manual / walk-in booking from admin — quick-book panel (service→artist→time→
  customer) reusing the validated booking API; verified in browser (booked LUM-00F1 at the desk)
- **Exit:** ✅ owner runs a full day with zero JSON editing; availability reflects all of it.
- **Status:** ✅ **M2 COMPLETE** — 29/29 tests green; services, staff, schedules, block-offs,
  resources, and walk-in booking all manageable in the admin UI, verified end-to-end in browser.

### M3 — Customer Accounts · **L**
- [x] `customers[]` keyed by phone; bookings gain `customerId`
- [x] Registration + OTP verify + auto-link past guest bookings
- [x] Login/logout/session + `GET /api/me` + CSRF
- [x] `account.html`: upcoming/past, stat cards, logout; `register.html`; `login.html`; booking pre-fill
- **Exit:** known phone shows history instantly; logged-in manage skips ref+phone.
- **Status:** ✅ **M3 COMPLETE** — 36/36 tests green; register/OTP/verify/login/logout/me/account all
  verified end-to-end in browser. Auto-link guest bookings by phone on verify.

### M4 — Booking Depth · **XL** · 🚧 IN PROGRESS (63/63 tests green)
- [x] Statuses: `completed`, `no-show` (revenue becomes actual) — admin `✓ Done` / `✗ No-show`;
  `actualRevenue` tracks completed visits; loyalty points awarded on completion
- [x] Cutoff enforcement (D1) client+server — 24h customer cancel cutoff (409 + `cutoff` flag),
  admin override; manage.html shows "call us to cancel" within the window
- [x] Multi-service per visit (D3) — `services[]` (max 3), summed duration/price, single slot block
- [x] Deposit (D2) — **adapted to pay-at-salon per no-paid-services constraint (NO Stripe):**
  `depositStatus` pending→collected, admin `$ Collected` button; required services flagged in booking + success
- [x] **Recurring** appointments — `POST /api/bookings/recurring` (cadence weekly/biweekly/every4weeks,
  count 2–12); books each free occurrence, reports `skipped[]`, shares a `seriesId`; toggle in booking
  step 4 + series success screen; verified in browser
- [x] **Group/bridal** bookings (adjacent slots, one payer) — `POST /api/bookings/group`; one organizer
  contact, all-or-nothing, each guest placed in earliest free slot ≥ target time, shares a `groupId`;
  admin "Group / bridal party" form + table badges; verified in browser
- [ ] **Packages/series** (buy N, redeem, track) — *remaining; ties to accounts (M3) + pay-at-salon*
- **Exit:** no-show tracked ✓; deposit collected at salon ✓; recurring series + bridal party both book ✓;
  *still to do: a 6-session package buys/redeems.*

### M5 — Engagement · **XL**
- [ ] Real SMS (Twilio) + email (SendGrid) + reminder **scheduler** that fires at `scheduledFor`
- [ ] Loyalty points (D4) · Gift cards · **Memberships** (monthly plan, member pricing)
- [ ] **Referral** codes · **Reviews/ratings** (collect post-visit, display, negative intercept)
- [ ] Waitlist join + auto-notify on cancel · marketing broadcasts + opt-out
- **Exit:** real reminder text arrives; points accrue; cancelled slot notifies waitlist; a member books at member price.

### M6 — Discoverability & Operations++ · **L**
- [ ] Admin booking filter (status/date/artist) + search (`?q=`) + pagination (>50 rows)
- [ ] Service-menu search; account list filter/search/paginate
- [ ] **Retail store + inventory** (consumables low-stock alerts) · **staff tips/commission** tracking
- [ ] **Owner reports**: daily sheet, payroll/commission, tax-ready revenue
- [ ] SEO: `LocalBusiness` JSON-LD, sitemap, robots, OG/favicon · analytics funnel
- **Exit:** owner searches 1000 bookings, runs payroll report, rich snippet validates.

### M7 — Trust & Launch · **L**
- [ ] Legal: privacy, terms, SMS/marketing consent, data export/delete
- [ ] Polish: skeletons, styled 404, .ics, print receipt · real photography
- [ ] Performance budgets met (see §5) · config cache, static `Cache-Control`, gzip, font swap
- [ ] Ops: logging/audit, error monitoring, nightly backup, **DB swap to SQLite** (D8) behind seam
- [ ] **RBAC enforced** (see §4) · admin behind login · i18n scaffold
- **Exit:** legal live; perf budget met; deployed behind auth with backups; RBAC active.

---

## 4. RBAC — roles & permissions matrix

| Capability | Customer | Artist | Reception/Mgr | Owner/Admin |
|---|---|---|---|---|
| Browse, book, manage own | ✓ | ✓ | ✓ | ✓ |
| View own schedule | — | ✓ | ✓ | ✓ |
| Book/cancel for any customer (walk-in) | — | own clients | ✓ | ✓ |
| View all bookings | — | own only | ✓ | ✓ |
| Edit services/prices | — | — | — | ✓ |
| Manage staff & schedules | — | own time-off | ✓ (schedules) | ✓ |
| Refunds / comp / gift cards | — | — | ✓ | ✓ |
| Reports (revenue/payroll) | — | own earnings | ✓ | ✓ |
| Settings, RBAC, integrations | — | — | — | ✓ |

---

## 5. NON-FUNCTIONAL BUDGETS (acceptance targets)

| Area | Target |
|---|---|
| Performance | LCP < 2.5s on Fast-3G; API p95 < 300ms; page JS < 60KB/page |
| Accessibility | WCAG 2.1 **AA**; full keyboard nav; visible focus; screen-reader booking |
| Availability | 99.5% uptime; graceful degradation if SMS/email/Stripe down |
| Capacity | 50 concurrent bookings without data loss (write-queue/SQLite) |
| Security | escaped output, CSRF, rate-limited auth, headers, no secrets in client |
| SEO | Lighthouse SEO ≥ 95; valid LocalBusiness rich result |

---

## 6. TEST STRATEGY

| Tier | What | When |
|---|---|---|
| Unit | engine (`availableSlots`, buffer, overlap), validators | every change |
| Integration | each API route (happy + 400/404/409) | every change |
| E2E | booking, manage, register/login, deposit | per milestone gate + CI |
| Load | 50 concurrent bookings; no double-book/loss | M1, M4, M7 |
| Security | XSS payloads, auth brute-force, CSRF, rate-limit | M1, M3, M7 |
| Accessibility | axe + manual keyboard/SR pass | M1, M7 |

**CI:** run unit+integration+e2e on every push; block merge on red. `test.js` is the seed.

---

## 7. ENVIRONMENTS & DEPLOY

- **Envs:** dev (local `node server.js`) → staging → prod.
- **Host:** Node-friendly PaaS (Render/Railway/Fly) or VPS; TLS via platform.
- **CI/CD:** GitHub Actions — test → build → deploy to staging → manual promote to prod.
- **DB:** SQLite file with nightly backup (M7); migration script JSON→SQLite preserving refs.
- **Rollback:** redeploy previous build; DB backup restore.
- **Secrets:** Twilio/SendGrid/Stripe keys in env vars, never in client.

---

## 8. RISK REGISTER

| Risk | Impact | Mitigation |
|---|---|---|
| Third-party outage (Twilio/Stripe/SendGrid) | bookings/comms fail | queue + retry; degrade gracefully; status banner |
| Data loss (single JSON/SQLite file) | lost bookings | write-queue (M1), nightly backup (M7), SQLite atomicity |
| Scope creep | timeline slip | scope locked in §2; new asks → backlog, not mid-milestone |
| Security incident (XSS/auth) | data/PII exposure | M1 first; security tests in CI; headers + rate-limit |
| Key person / single dev | bus factor | this doc set + tests = transferable; small reviewable PRs |
| Compliance (SMS/TCPA, privacy) | legal exposure | consent + opt-out (M5), legal pages (M7) before launch |

---

## 9. COST MODEL (run-rate, order of magnitude)

| Item | Cost |
|---|---|
| Hosting (PaaS) | ~$7–25/mo |
| SMS (Twilio) | ~$0.0079/msg (~$8 per 1,000 reminders) |
| Email (SendGrid) | free → ~$20/mo |
| Payments (Stripe) | 2.9% + $0.30 per charge |
| Domain | ~$12/yr |

---

## 10. SEQUENCING & ESTIMATE ROLL-UP

```
M0(S) → M1(M) → M2(L) → M3(L) → M4(XL) → M5(XL)
                 └─────────────┴─────────────────→ M6(L) ┐ parallel after M1
                                                   M7(L) ┘
```
Rough total for 1 full-stack dev: **~14–18 weeks** serial; less with parallelism on M6/M7.

---

## 11. DEFINITION OF DONE (whole project)

Every checkbox checked · `node test.js` + CI green at each gate · Gap Audit (ROADMAP §G)
cleared or deferred-with-note · NFR budgets (§5) met · RBAC enforced · legal live · deployed
behind admin auth with backups · SPEC/BLUEPRINT updated to match shipped code.

## 12. ZERO-REWORK GUARANTEES (why this won't be redone)
1. Decisions closed up front (§1) — no guessing.
2. Hardening before features (M1) — safe base inherited, not retrofitted.
3. Engine refactored once (M2) before anything depends on it.
4. Identity before personalization (M3); status model before money (M4).
5. Contracts locked in SPEC; DB swap behind `loadDB/saveDB` — no caller churn.
6. Scope frozen in §2; new requests go to backlog, never mid-milestone.

*Build top-down. Don't reopen a finished milestone to fix a foundation — if that's ever
needed, the miss was here, in the plan, and this file gets updated first.*
