# Lumière Beauty & Nail Studio — Build Specification & Master Prompt

> Two parts:
> **Part A** — detailed plan + granular to-do across all in-flight workstreams (build from this).
> **Part B** — a final, self-contained "build prompt" you can hand to any developer or AI agent to (re)build the site to this spec.
>
> Hard constraints (apply everywhere): **vanilla HTML/CSS/JS only — no framework, no build step, no npm dependencies, FOSS-only, no paid third-party services** (no Stripe/Twilio/SendGrid/Calendly). Node's built-in `http`/`fs`/`zlib` only on the server. Data is a JSON file store (`data/db.json`, seeded from `data/seed.json`).

---

# PART A — Detailed Plan & To-Do

Status legend: ✅ done & verified · 🟡 designed, not built · ⬜ planned · ✏️ drafted (uncommitted)

> **Completion status (all workstreams built & verified; not yet committed):**
> - **W1 — Salon settings + customer notes + cache-bust** ✅ verified end-to-end.
> - **W2 — Dynamic, area-based SEO** ✅ built & verified: per-page server-rendered title/description/keywords/OG/Twitter/JSON-LD (`BeautySalon` + `BreadcrumbList`), `/robots.txt`, expanded `sitemap.xml`; config-driven (editing salon city updates served meta); admin pages excluded.
> - **W3 — Modern UI/UX refresh (Phases 0–8)** ✅ built & verified: tokens + dark mode, scroll-reveal, Book FAB + sticky mobile bar, theme toggle, bento gallery + lightbox swipe + before/after slider, page refreshes, footer SVG icons, cache-bust `v=10`/`lumiere-v4`. **WCAG AA contrast audit** done — added theme-split `--accent-text` token (light `#9c5350`, dark `#e3a49c`) so accent text passes AA in both themes; booking flow regression-tested (`201 ok`).

## Workstream 1 — Admin: Salon settings + Customer notes ✅ (verified)
- ✅ `PATCH /api/admin/salon` — update name/tagline/phone/email/address/instagram/facebook; validates name; moved out of a broken top-level location into `handleAPI`.
- ✅ Admin "Salon settings" card (`public/admin.html`) — populate from `/api/config`, save via `api.updateSalon`.
- ✅ `api.updateSalon` client method (`public/js/common.js`).
- ✅ Customer admin notes — `PATCH /api/admin/customers/:id/notes` + `adminNotes` in the customer detail response + private-notes textarea in the CRM detail panel.
- ✅ Cache-bust — `common.js?v=8`→`v=9` across all 21 pages + `sw.js`; SW cache `lumiere-v2`→`v3`.
- ✅ Verified end-to-end against a throwaway DB (save/trim/round-trip; blank-name → 400; `/api/config` reflects changes).

## Workstream 2 — Dynamic, area-based SEO 🟡 (designed, not built)
Goal: SEO meta + structured data generated **server-side from live salon settings + service catalog + area**, so it auto-updates when the admin edits Salon Settings, and targets local + global intent. No hardcoded "Riverside"/brand strings in page heads.

- ⬜ **Salon location fields** — add `city`, `region`, `country`, `postalCode` to the salon object (`data/seed.json` + live `data/db.json`), to the `PATCH /api/admin/salon` allow-list, and to the admin Salon-settings form (populate + save arrays). Fallback: derive city from the last comma-segment of `address`.
- ⬜ **SEO engine in `server.js`** (zero-dep):
  - `deriveCity(address)`, `seoEsc(s)`, recursive `prune(obj)` (drops `undefined`).
  - `PAGE_SEO` map keyed by page (`home`, `services`, `booking`, `gallery`, `team`, `reviews`, `faq`, `location`, `giftcard`) → `{ titleTpl, descTpl, type, themes[], breadcrumb[] }` with `{brand} {city} {region} {cityRegion} {services}` tokens.
  - `buildSEO(urlPath, db, base)` → returns a `<head>` SEO block (`<title>`, description, **keywords**, canonical, `og:*`, `twitter:*`, JSON-LD) or `null` for non-marketing pages.
  - `buildKeywords()` → local-intent + service-based + global terms (e.g. `nail salon {city}`, `{service} near me`, `beauty salon {city} {region}`, brand, category names), de-duped, capped ~24.
  - `buildJsonLd()` → `@graph` with `BeautySalon` (name, description, url, telephone, email, image, priceRange, **structured PostalAddress**, **areaServed**, **openingHoursSpecification from `salon.hours` — currently hardcoded**, `sameAs` from instagram/facebook, **`hasOfferCatalog` from the live service catalog grouped by category**, optional `aggregateRating` computed from `db.bookings[].review.rating` when present) + a `BreadcrumbList`.
  - `injectSEO(html, urlPath, db, base)` → strips any existing `<title>`/description/keywords/`og:`/`twitter:`/JSON-LD from the head, then injects the dynamic block after `<head>`. Returns html unchanged for non-configured pages.
- ⬜ **Hook into `serveStatic`** — for `.html` whose `pageKey` is in `PAGE_SEO`, transform the string before gzip; compute `base` from `x-forwarded-proto` + `host` (factor a shared `reqBase(req)` and reuse it in the sitemap route).
- ⬜ **`/robots.txt` route** — `Allow: /`, disallow `/admin.html`/`/account.html`/`/api/`, and a `Sitemap:` line.
- ⬜ **Expand `sitemap.xml`** — add `reviews.html`, `faq.html`, `location.html`, `giftcard.html`; keep legal pages; use `reqBase`.
- ⬜ **Verify** — start server, confirm injected head per page, valid JSON-LD (no `</script>` breakage — escape `<` as `<`), `keywords` present, `/api/config` change reflected in served meta, robots + sitemap correct.

## Workstream 3 — Modern UI/UX refresh ⬜ (approved; identity = keep & refine warm rose; dark mode = yes)
Benchmarked against GlossGenius/Fresha/Awwwards spa themes & 2025–2026 trends. Refinement of a strong base, not a rebuild. **Do not change booking/i18n/a11y/PWA logic.**

### Phase 0 — Design-token foundation (`styles.css`) ✏️ (drafted, uncommitted)
- ✏️ Semantic tokens: space scale `--sp-1..8`, fluid type `--fs-*`, radius `--r-sm..xl/--r-pill`, shadows `--shadow-sm/md/lg`, motion `--dur*`/`--ease`, z-index scale. Back-compat aliases kept (`--shadow`, `--radius`).
- ✏️ Surface tokenization: `--surface`, `--surface-2`, `--rose-tint`, `--glass`/`--glass-line`, `--header-bg`, `--footer-bg/ink/soft`; swapped component `#fff` backgrounds → `var(--surface)`.
- ✏️ Dark theme via `:root[data-theme="dark"]` (warm plum-charcoal, accents kept); `color-scheme` set.
- ✏️ Fluid typography on `h1–h4`/body/`.eyebrow`; reduced-motion guard; scroll-reveal base classes.
- ⬜ Tidy lint: order `-webkit-backdrop-filter` before `backdrop-filter`; add `-webkit-user-select` on `.ba-slider`.
- ⬜ Contrast audit: verify `--ink-soft` and rose-on-surface meet WCAG AA in **both** themes.

### Phase 1 — Global chrome, motion & theming (`common.js` + `styles.css`)
- ⬜ Sticky-header `.scrolled` state (shadow + slight shrink) via scroll listener.
- ⬜ Floating **Book FAB** injected on public pages only (exclude booking/admin/account/login/register/manage/review); reveal after hero via IntersectionObserver sentinel.
- ⬜ Sticky **mobile action bar** (<560px): Book + Call (`tel:` from config); add `body.has-mobile-bar` padding.
- ⬜ **Scroll-reveal**: one IntersectionObserver adds `.in` to `[data-reveal]`; no-op under reduced-motion.
- ⬜ **Dark-mode toggle**: footer (+ optional header) control; persist `lumiere_theme`; set `data-theme` on `<html>`; update `theme-color` meta. Add a tiny inline `<head>` snippet to each page (set theme before paint; detect `prefers-color-scheme` when no saved choice) to avoid FOUC.
- ⬜ i18n: add EN/ES strings (`book_my_appt`, `call_us`, `theme_light`, `theme_dark`).
- ⬜ **Cache-bust**: `common.js?v=9`→`v=10` across all pages + `sw.js` SHELL; SW cache `lumiere-v3`→`v4`. (Combine with the inline theme snippet sweep — both touch every head.)

### Phase 2 — Home (`index.html`)
- ⬜ Hero: oversized fluid headline; first-person primary CTA ("Book my appointment") + ghost "View the menu"; glassmorphism stat chips; refined hours pill + gradient backdrop.
- ⬜ Value props: icon hover micro-interaction.
- ⬜ Services preview: refined cards; emphasize "Most popular".
- ⬜ NEW **trust band**: hygiene/sanitation + licensed-artists (+ optional "Featured in", hidden if empty).
- ⬜ Testimonials: glassmorphism cards w/ stars; live from `/api/reviews` when present, static fallback.
- ⬜ CTA band first-person copy; `data-reveal` on sections; dark-mode pass.

### Phase 3 — Services (`services.html`)
- ⬜ Benefit-first one-line descriptions; clearer "from $X"; refined Popular/Deposit badges; stronger category headers.
- ⬜ Sticky category filter bar; keep search/debounce/hash-deeplink; surface package savings; `data-reveal`; dark-mode.

### Phase 4 — Gallery (`gallery.html`)
- ⬜ Bento/masonry grid (`.tile.wide`/`.tile.tall` spans) with responsive collapse; keep filter chips.
- ⬜ Lightbox polish: glassmorphism controls, caption, keep keyboard nav, add touch-swipe + neighbor preload.
- ⬜ **Before/after slider** component (draggable divider / `range`), rendered only for items flagged via data attributes; documents the data shape; renders nothing if none. `data-reveal`; dark-mode.

### Phase 5 — Team / Reviews / FAQ / Location
- ⬜ Team: refined cards, experience + specialty chips, first-person "Book with {name}".
- ⬜ Reviews: glassmorphism summary; animate distribution bars on reveal; polish cards; keep sort/filter.
- ⬜ FAQ: smooth height-transition accordion; keep single-open + search.
- ⬜ Location: card framing, refined hours table + Today badge, prominent directions/book CTAs; keep map iframe.

### Phase 6 — Booking wizard UX (`booking.html`) — visual/UX only
- ⬜ Redesign step progress bar; 44px+ targets on `.option`/`.slot`; sticky summary/confirm on mobile; success-screen polish. **All wizard logic, gift-card/points/packages/recurring, i18n keys preserved.**

### Phase 7 — Footer & misc
- ⬜ Footer: refined layout, inline **SVG social icons**, hours table, language + theme toggle, opt-in styling.
- ⬜ Polish `404.html` / `offline.html`; readability pass on `privacy/terms/sms-consent`.

### Phase 8 — QA & verification
- ⬜ Run `PORT=3999 node server.js`; visually check every public page **light + dark** at **360 / 768 / 1180**.
- ⬜ Booking regression: full flow against a backed-up throwaway DB.
- ⬜ a11y: keyboard nav, visible focus, AA contrast (both themes), reduced-motion, SR labels on FAB/toggle/icons.
- ⬜ Perf: gzip on, fonts `display=swap`, no heavy assets.
- ⬜ Confirm cache-bust applied; SW serves new shell; EN/ES spot-check.

## Cross-cutting guardrails
- No deps / build step / paid services; hand-roll everything.
- Never alter booking logic, API contracts, i18n keys, gift-card/points/packages/recurring, or the PWA caching strategy — UI/UX + additive endpoints only.
- Any shared-asset change → bump `common.js?v=` everywhere + `sw.js` SHELL + SW `CACHE` name.
- New user-facing strings → EN/ES `LOCALES` (and `booking.html` `STRINGS`).
- Preserve & extend a11y (skip link, ARIA, focus-visible, keyboard); add reduced-motion + AA contrast.

---

# PART B — Final Build Prompt

> Copy-paste the block below to build the site from scratch (or to drive an agent to implement the workstreams above). It is self-contained.

```
You are building "Lumière Beauty & Nail Studio", a production salon website with online
booking and an admin back-office. Build it as a SINGLE Node.js app with NO frameworks,
NO npm dependencies, NO build step, and NO paid third-party services. Use only Node core
modules (http, fs, path, url, crypto, zlib). Persistence is a JSON file store at
data/db.json, seeded from data/seed.json. Serve a static public/ folder of plain HTML +
one shared CSS file + one shared vanilla-JS file. Everything must run with `node server.js`.

== STACK & ARCHITECTURE ==
- server.js: a single http server. Static file serving with gzip (zlib) and sensible
  Cache-Control per extension; HTML is no-cache. A JSON API under /api/*. A tiny JSON
  datastore: loadDB() copies seed.json→db.json on first run; saveDB() writes pretty JSON;
  a withLock() wrapper serializes writes; nightly backups to data/backups (keep 7); an
  append-only audit log (data/audit.log) via audit(req, action, meta).
- Auth: admin via password→session cookie (admin_sid) OR ADMIN_TOKEN bearer; if neither
  ADMIN_PASSWORD nor ADMIN_TOKEN is set, admin is open (dev). Customer sessions via cookie.
- public/js/common.js: injects the shared header/nav and footer into #site-header /
  #site-footer on every page, registers the service worker, handles EN/ES i18n (t()/LOCALES,
  ?lang= + localStorage + browser detection), injects canonical URL, and exposes an `api`
  object wrapping all fetch calls. Pages are static HTML that call window.api + render.
- PWA: manifest.json + sw.js (cache-first shell, network-first navigation w/ offline.html
  fallback, network-only API). Cache-bust shared JS with ?v=N and bump sw CACHE name on change.

== DATA MODEL (seed.json) ==
salon { name, tagline, phone, email, address, city, region, country, postalCode,
        instagram, facebook, hours[{day,open,close}] }
categories[{id,name,blurb}]; services[{id,category,name,duration,price,description,staffIds[]}];
staff[{id,name,title,bio,specialties[],hours?,timeOff?}]; resources[]; packages[];
customers[{id,name,phone,email,points,birthday,adminNotes,...}];
bookings[{id,ref,customerId,serviceId(s),staffId,date,time,status,price,review?{rating,comment,submittedAt}}];
reviews live on bookings. gallery[]; broadcasts[]; referrals[].

== CORE FEATURES ==
1) Public marketing site: Home, Services (menu + pricing + packages), Gallery (+ lightbox),
   Team, Reviews, FAQ, Location, Gift cards, plus legal (privacy/terms/sms-consent) and
   account/login/register/manage pages.
2) Booking wizard (booking.html), 4 steps: choose service(s) (≤3) → choose artist
   (filtered to those who can do ALL selected; "Any available") → pick date & time (live
   /api/availability honoring salon hours, per-staff hours, time-off, breaks, buffers,
   existing bookings; waitlist form when no slots) → details & review (name/phone/email/
   notes, deposit notice, gift-card redemption, reward-points redemption in 100-pt steps,
   package selection, recurring-series toggle). Success screen w/ ref + iCalendar download.
   Bilingual EN/ES. Full keyboard support + focus management + skip link.
3) Loyalty: points earn/redeem, birthday bonuses (daily scheduler), referrals.
4) Admin (admin.html): dashboard stats, weekly staff schedule, bookings management, deposit
   collection, customer CRM (search, lapsed filter, points adjust, PRIVATE per-customer
   notes), services/staff/gallery editors, retail products + inventory, packages, broadcasts,
   commission/artist-performance reports, backups, daily print sheet, and a SALON SETTINGS
   form (name/tagline/phone/email/address/city/region/country/postal/instagram/facebook)
   persisted via PATCH /api/admin/salon (validates name; updates the live salon object).

== DYNAMIC, AREA-BASED SEO (server-rendered) ==
Generate all SEO from LIVE salon settings + service catalog + area — never hardcode brand
or city in page heads. In server.js add an SEO engine and inject it when serving public HTML:
- PAGE_SEO map per public page → title/description templates with {brand}{city}{region}
  {cityRegion}{services} tokens, og type, keyword themes, breadcrumb trail.
- buildSEO() emits <title>, meta description, meta KEYWORDS (local-intent + service-based +
  global, de-duped, ~24 cap, e.g. "nail salon {city}", "{service} near me",
  "beauty salon {city} {region}"), canonical, og:* and twitter:*, and JSON-LD @graph:
  a BeautySalon node (name, description, url, telephone, email, image, priceRange,
  structured PostalAddress, areaServed=City, openingHoursSpecification FROM salon.hours,
  sameAs=[instagram,facebook], hasOfferCatalog FROM the live service catalog grouped by
  category, aggregateRating computed from bookings' reviews when any exist) + a BreadcrumbList.
- injectSEO(html,urlPath,db,base): strip any existing title/description/keywords/og/twitter/
  ld+json from <head>, then insert the generated block; escape "<" as < inside JSON-LD.
- serveStatic: for public HTML, transform the string before gzip; compute base from
  x-forwarded-proto + host (shared reqBase()). Add /robots.txt (Allow /, disallow admin/
  account/api, Sitemap line) and a dynamic /sitemap.xml covering all public pages.

== MODERN UI/UX (the visual system) ==
Identity: KEEP the warm rose/plum/gold brand. Fonts: Cormorant Garamond (display) + Poppins
(body) via Google Fonts, display=swap. One stylesheet (public/css/styles.css) built on CSS
custom properties:
- Tokens: brand accents (--rose --rose-deep --gold --plum) constant across themes; semantic
  surfaces/text (--bg --bg-soft --surface --surface-2 --ink --ink-soft --line --rose-tint
  --glass/--glass-line --header-bg --footer-bg/ink/soft); scales for space, fluid type
  (clamp), radius (10/16/20/28/pill), shadow (sm/md/lg), motion (--dur*/--ease cubic-bezier),
  z-index. DARK THEME via :root[data-theme="dark"] (warm plum-charcoal surfaces, accents kept;
  set color-scheme). An inline <head> snippet sets data-theme from localStorage or
  prefers-color-scheme before paint (no flash). A toggle in the footer persists the choice.
- Components: pill buttons (.btn primary/ghost/gold/sm) with lift-on-hover; cards w/ hover
  lift + icon micro-interaction; chips; status pills; glassmorphism (.glass) reusing
  backdrop-filter; service rows; team cards; bento gallery (.tile.wide/.tall); before/after
  slider (draggable, data-driven, optional); wizard steps/options/slots with 44px+ targets;
  skeleton shimmer; toast.
- Motion & conversion: scroll-reveal via ONE IntersectionObserver toggling .in on
  [data-reveal] (gated by prefers-reduced-motion); sticky-header .scrolled state; a floating
  "Book Now" FAB that appears past the hero on public pages (excluded on booking/admin/auth);
  a sticky mobile action bar (Book + Call) under 560px; first-person CTA copy
  ("Book my appointment"). Hero with oversized headline + glassmorphism stat chips; a trust
  band (hygiene/licensed/featured-in); testimonials pulled live from reviews.
- Accessibility: skip link, ARIA labels (FAB/toggle/lightbox/hamburger), focus-visible rings,
  full keyboard support, AA contrast in BOTH themes, prefers-reduced-motion respected.

== ACCEPTANCE CRITERIA ==
- `node server.js` serves the whole site; first run seeds db.json.
- Booking works end-to-end (availability respects all constraints; waitlist when full;
  iCal download; recurring series); no regressions to gift-card/points/packages.
- Admin salon-settings + customer-notes persist and round-trip; /api/config reflects salon
  edits; SEO meta + JSON-LD update automatically when salon settings change (no hardcoded
  brand/city in served heads); robots.txt + sitemap.xml valid; JSON-LD validates.
- Light + dark themes both pass AA contrast; layouts hold at 360/768/1180; reduced-motion
  disables animations; keyboard-only navigation works on every interactive control.
- EN/ES strings complete; PWA installs and works offline (shell + offline.html); gzip active;
  shared-asset versions bumped consistently (no stale common.js / sw cache).
```

---

## Notes for execution
- Implement in the order: **Workstream 2 (SEO)** → **Workstream 3 Phases 0→8 (UI/UX)**, committing each phase as its own milestone (matches the repo's `M<n>` commit style). Workstream 1 is already done & verified.
- Recommended checkpoint after UI/UX Phase 1 (tokens + theme + motion underpin every page).
- Keep the dynamic SEO independent of the visual refresh so either can ship first.
