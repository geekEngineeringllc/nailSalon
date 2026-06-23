# Lumière Beauty & Nail Studio

A complete website + online booking platform for a beauty parlor and nail salon.
Built with **zero dependencies** — just Node's built-in modules — so it runs anywhere
Node is installed, with no `npm install` step.

## Run it

```powershell
node server.js
```

Then open **http://localhost:3000**.

To use a different port: `$env:PORT=4000; node server.js`

## Test it

```powershell
node test.js
```

Runs the acceptance + hardening suite (booking flow, double-book guard, validation,
XSS-escaping, security headers, health) against a throwaway server. Exits non-zero on any
failure — run it after every change.

## What's inside

| Page | What it does |
|------|--------------|
| `/` (Home) | Hero, value props, service & team previews, gallery, testimonials, CTA |
| `/services.html` | Full service menu with category filters, prices, durations & "Book" buttons |
| `/booking.html` | 4-step booking wizard: service → artist → date/time → details → confirmation |
| `/gallery.html` | Filterable portfolio of recent work |
| `/team.html` | Artist bios, specialties, and direct booking links |
| `/manage.html` | **Self-service**: look up a booking by reference + phone, then reschedule or cancel |
| `/admin.html` | Owner dashboard: live stats, revenue, load by artist/category, cancel bookings, notification feed |

## Features

- **Real-time availability** — slots are generated per artist per day, respecting each
  service's duration and a 10-minute cleanup buffer, with overlap detection so a chair
  is never double-booked.
- **"Any available" artist** — merges openings across every qualified artist and resolves
  to a real person when a slot is chosen.
- **Double-booking guard** — the server re-checks the slot at submit time and returns
  `409` if it was just taken, sending the guest back to pick another time.
- **Persistent data** — bookings are written to `data/db.json` (created on first run from
  `data/seed.json`). Delete `db.json` to reset to seed data.
- **Booking reference numbers**, customer notes, and per-booking cancellation.
- **Self-service manage** — guests retrieve a booking with their reference + phone
  (phone match ignores formatting) and reschedule into any open slot or cancel.
- **Notifications & reminders** — every booking auto-creates a confirmation (sent) and a
  reminder scheduled 24h before the visit; rescheduling refreshes the reminder. Visible in
  the admin feed. Simulated — swap in Twilio/SendGrid for real delivery.
- **Responsive + accessible** layout, semantic HTML, SEO meta tags, mobile nav.

## Project structure

```
server.js          Zero-dependency HTTP server + REST API + booking logic
data/seed.json     Salon info, services, staff (source of truth)
data/db.json        Live data (auto-created; gitignore-able)
public/             Static front-end (HTML / CSS / JS)
  css/styles.css
  js/common.js      Shared header/footer + API client
  *.html            Pages
```

## API

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/config` | Salon info, categories, services, staff |
| GET | `/api/availability?serviceId=&staffId=&date=` | Open slots (per artist) |
| POST | `/api/bookings` | Create a booking |
| GET | `/api/bookings` | List all bookings (admin) |
| POST | `/api/bookings/cancel` | Cancel a booking by id |
| POST | `/api/bookings/lookup` | Retrieve a booking by `{ ref, phone }` |
| POST | `/api/bookings/reschedule` | Move a booking to `{ id, date, time }` (re-checks availability) |
| GET | `/api/notifications` | Confirmation + reminder feed |
| GET | `/api/stats` | Dashboard summary |

## Where you'd take it next (production)

- Swap the JSON store for a real DB (Postgres/SQLite) and add auth on `/admin`.
- Wire SMS/email reminders (Twilio / SendGrid) to the confirmation + 24h-before hooks.
- Add deposits/payments (Stripe), loyalty points, gift cards, and waitlist auto-fill.
- Calendar sync (Google Calendar) for each artist.
