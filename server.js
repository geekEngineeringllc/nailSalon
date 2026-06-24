// Lumière Beauty & Nail Studio — zero-dependency Node server.
// Serves the static site from /public and a small JSON-backed REST API.
// Run with: node server.js   (no npm install needed)

const http = require('http');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_KEEP = 7; // keep last 7 daily backups
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');

// ---- Tiny JSON datastore -------------------------------------------------
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.copyFileSync(SEED_FILE, DB_FILE);
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ---- Nightly backup -------------------------------------------------------
function runBackup() {
  if (!fs.existsSync(DB_FILE)) return;
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const dest = path.join(BACKUP_DIR, `db-${stamp}.json`);
    fs.copyFileSync(DB_FILE, dest);
    // Prune old backups — keep only the most recent BACKUP_KEEP files
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('db-') && f.endsWith('.json'))
      .sort(); // lexicographic = chronological for YYYY-MM-DD names
    files.slice(0, Math.max(0, files.length - BACKUP_KEEP))
      .forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
    process.stdout.write(`[backup] ${dest} (kept ${Math.min(files.length, BACKUP_KEEP)} copies)\n`);
  } catch (e) {
    process.stderr.write(`[backup] ERROR: ${e.message}\n`);
  }
}
function scheduleDailyBackup() {
  // Fire once at startup (catches the case where the server was down at midnight)
  runBackup();
  // Then fire every 24 hours
  setInterval(runBackup, 24 * 60 * 60 * 1000);
}

// ---- Audit log -----------------------------------------------------------
function audit(req, action, detail) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '-';
  const line = JSON.stringify({ ts: new Date().toISOString(), ip, action, detail }) + '\n';
  fs.appendFile(AUDIT_FILE, line, () => {}); // fire-and-forget
}

// Serialize read-modify-write sections so two concurrent mutating requests can't
// clobber each other. Each critical section reloads a FRESH db inside the lock and
// saves before releasing, so the next one always sees the previous one's write.
let _writeChain = Promise.resolve();
function withLock(fn) {
  const run = _writeChain.then(fn, fn);
  _writeChain = run.then(() => {}, () => {}); // never let a rejection break the chain
  return run;
}

// ---- Booking / availability logic ---------------------------------------
const SLOT_STEP = 15;        // minutes between candidate start times
const BUFFER = 10;           // cleanup buffer after each appointment (minutes)
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function toHHMM(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}
function weekdayShort(date) { return WD_SHORT[new Date(date + 'T00:00:00').getDay()]; }
// The salon's open window for the weekday of `date`, or null if closed that day.
function salonDayWindow(salon, date) {
  const full = WD_FULL[new Date(date + 'T00:00:00').getDay()];
  const h = (salon.hours || []).find((x) => x.day === full);
  if (!h || h.closed) return null;
  return { open: toMin(h.open), close: toMin(h.close) };
}

// Returns array of "HH:MM" start times a staff member is free on a date, honoring:
//   salon hours · the staff member's per-weekday hours · time-off ranges · recurring breaks · existing bookings + buffer.
// serviceIds may be a single string (backward compat) or an array.
// Total duration = sum of all selected services. Resource checked on first service only.
function availableSlots(db, serviceIds, staffId, date) {
  const ids = Array.isArray(serviceIds) ? serviceIds : [serviceIds];
  const services = ids.map((id) => db.services.find((s) => s.id === id)).filter(Boolean);
  if (!services.length) return [];
  const service = services[0]; // primary (for resource + staff pool)
  const staff = db.staff.find((p) => p.id === staffId);

  // 1) salon must be open
  const sw = salonDayWindow(db.salon, date);
  if (!sw) return [];
  let openMin = sw.open, closeMin = sw.close;

  const wd = weekdayShort(date);
  if (staff) {
    // 2) time-off / vacation (inclusive date ranges)
    if (Array.isArray(staff.timeOff) && staff.timeOff.some((r) => date >= r.from && date <= r.to)) return [];
    // 3) per-weekday hours override (null = day off); clamp to salon hours
    if (staff.hours && Object.prototype.hasOwnProperty.call(staff.hours, wd)) {
      const hw = staff.hours[wd];
      if (!hw) return [];
      openMin = Math.max(openMin, toMin(hw.start));
      closeMin = Math.min(closeMin, toMin(hw.end));
    }
  }
  if (openMin >= closeMin) return [];

  const dur = services.reduce((sum, s) => sum + s.duration, 0);
  const dayBookings = db.bookings.filter(
    (b) => b.date === date && b.staffId === staffId && b.status !== 'cancelled'
  );

  // Shared-resource capacity (e.g. pedicure chairs / treatment rooms): a slot is
  // blocked if the service's resource is already at capacity at that time across ALL artists.
  const resourceId = service.resourceId;
  let capacity = Infinity, resourceBookings = [];
  if (resourceId) {
    const resource = (db.resources || []).find((r) => r.id === resourceId);
    if (resource) {
      capacity = resource.capacity;
      resourceBookings = db.bookings.filter((b) => b.date === date && b.status !== 'cancelled' && b.resourceId === resourceId);
    }
  }

  // Recurring weekly breaks + one-off block-offs both carve unavailable windows out of the day.
  const breaks = (staff && staff.breaks || [])
    .filter((br) => br.day === wd)
    .map((br) => [toMin(br.start), toMin(br.end)]);
  const blockoffs = (db.blockoffs || [])
    .filter((bl) => bl.staffId === staffId && bl.date === date)
    .map((bl) => [toMin(bl.start), toMin(bl.end)]);
  const blocks = breaks.concat(blockoffs);

  const slots = [];
  for (let start = openMin; start + dur <= closeMin; start += SLOT_STEP) {
    const end = start + dur + BUFFER;
    const svcEnd = start + dur; // service time without buffer, for break/block comparison
    const clashBooking = dayBookings.some((b) => {
      const bStart = toMin(b.time);
      const bEnd = bStart + b.duration + BUFFER;
      return start < bEnd && bStart < end; // interval overlap
    });
    const clashBlock = blocks.some(([bs, be]) => start < be && bs < svcEnd);
    let resourceFull = false;
    if (capacity !== Infinity) {
      const overlapping = resourceBookings.filter((b) => {
        const bs = toMin(b.time); const be = bs + b.duration + BUFFER;
        return start < be && bs < end;
      }).length;
      resourceFull = overlapping >= capacity;
    }
    if (!clashBooking && !clashBlock && !resourceFull) slots.push(toHHMM(start));
  }
  return slots;
}

// ---- HTTP helpers --------------------------------------------------------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

// Baseline security headers on every response.
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "frame-src https://www.google.com https://maps.google.com"  // Google Maps embed on the location page
  ].join('; '));
}

// Simple in-memory per-IP rate limiter (token-bucket-ish, fixed window).
const RATE = { windowMs: 60000, max: Number(process.env.RATE_MAX) || 60 };
const _hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = _hits.get(ip);
  if (!rec || now > rec.resetAt) { _hits.set(ip, { count: 1, resetAt: now + RATE.windowMs }); return false; }
  rec.count += 1;
  return rec.count > RATE.max;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const CACHE_CTRL = {
  '.html': 'no-cache',
  '.css':  'public, max-age=3600',
  '.js':   'public, max-age=3600',
  '.json': 'public, max-age=3600',
  '.xml':  'public, max-age=86400',
  '.txt':  'public, max-age=86400',
  '.svg':  'public, max-age=604800',
  '.png':  'public, max-age=604800',
  '.jpg':  'public, max-age=604800',
  '.ico':  'public, max-age=604800',
};
const COMPRESSIBLE = new Set([
  'text/html; charset=utf-8',
  'text/css; charset=utf-8',
  'text/javascript; charset=utf-8',
  'application/json; charset=utf-8',
  'image/svg+xml',
]);

// ---- Dynamic, area-based SEO ------------------------------------------------
// Public marketing pages get their <title>, description, keywords, canonical,
// Open Graph / Twitter tags and JSON-LD generated server-side from the LIVE
// salon settings + service catalog + area — so editing Salon Settings updates
// search results automatically and nothing is hardcoded in the page heads.

function reqBase(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${req.headers.host || 'localhost'}`;
}
function seoEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function deriveCity(address) {
  const parts = String(address || '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}
function streetOf(address, city) {
  if (!address) return '';
  const parts = String(address).split(',').map((s) => s.trim()).filter(Boolean);
  if (city && parts.length > 1 && parts[parts.length - 1].toLowerCase() === city.toLowerCase()) parts.pop();
  return parts.join(', ');
}
function humanList(arr) {
  const a = (arr || []).filter(Boolean);
  if (!a.length) return 'nails, hair, skin & makeup';
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1];
}
// Recursively drop undefined / null / '' / empty-array values for clean JSON-LD.
function prune(v) {
  if (Array.isArray(v)) return v.map(prune).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      const pv = prune(v[k]);
      if (pv === undefined || pv === null || pv === '' || (Array.isArray(pv) && pv.length === 0)) continue;
      out[k] = pv;
    }
    return out;
  }
  return v;
}
function pageKey(urlPath) {
  if (urlPath === '/' || urlPath === '/index.html') return 'home';
  return urlPath.replace(/^\//, '').replace(/\.html$/, '');
}

const PAGE_SEO = {
  home:     { title: '{brand} — Beauty & Nail Salon in {city}',
              desc: '{brand} is a beauty parlor & nail salon in {cityRegion} offering {services}. Book your appointment online in seconds.',
              type: 'website', themes: ['beauty salon', 'nail salon', 'beauty parlor', 'spa'],
              crumbs: [['Home', '/']] },
  services: { title: 'Services & Pricing — {brand} ({city})',
              desc: "Explore {brand}'s full menu in {city}: {services}. Transparent pricing — book any service online.",
              type: 'website', themes: ['services', 'pricing', 'manicure', 'pedicure', 'gel nails', 'facial', 'waxing'],
              crumbs: [['Home', '/'], ['Services', '/services.html']] },
  booking:  { title: 'Book an Appointment — {brand} in {city}',
              desc: 'Book your nail, hair, skin or makeup appointment at {brand} in {city} in under a minute.',
              type: 'website', themes: ['book appointment', 'online booking', 'nail appointment'],
              crumbs: [['Home', '/'], ['Book', '/booking.html']] },
  gallery:  { title: 'Gallery — {brand} in {city}',
              desc: 'Recent nail art, hair color, makeup and skin work from {brand} in {city}.',
              type: 'website', themes: ['nail art', 'gallery', 'hair color', 'before and after'],
              crumbs: [['Home', '/'], ['Gallery', '/gallery.html']] },
  team:     { title: 'Our Team — {brand} in {city}',
              desc: 'Meet the licensed nail, hair, skin and makeup artists at {brand} in {city}. Book directly with your favorite.',
              type: 'website', themes: ['nail technician', 'hair stylist', 'beauty artists'],
              crumbs: [['Home', '/'], ['Team', '/team.html']] },
  reviews:  { title: 'Guest Reviews — {brand} in {city}',
              desc: 'Read verified guest reviews for {brand}, a beauty & nail salon in {cityRegion}.',
              type: 'website', themes: ['reviews', 'ratings', 'testimonials'],
              crumbs: [['Home', '/'], ['Reviews', '/reviews.html']] },
  faq:      { title: 'FAQ — {brand} in {city}',
              desc: 'Answers about booking, services, pricing and policies at {brand} in {city}.',
              type: 'website', themes: ['faq', 'questions', 'policies'],
              crumbs: [['Home', '/'], ['FAQ', '/faq.html']] },
  location: { title: 'Location & Hours — {brand} in {city}',
              desc: 'Find {brand} in {cityRegion}. Address, opening hours, parking, phone and directions.',
              type: 'website', themes: ['location', 'hours', 'directions', 'near me'],
              crumbs: [['Home', '/'], ['Location', '/location.html']] },
  giftcard: { title: 'Gift Cards — {brand} in {city}',
              desc: 'Buy or check the balance of a {brand} gift card — the perfect beauty gift in {city}.',
              type: 'website', themes: ['gift card', 'gift voucher', 'beauty gift'],
              crumbs: [['Home', '/'], ['Gift Cards', '/giftcard.html']] },
};

// Local-intent + service-based + global keywords, de-duped and capped.
function buildKeywords(pageCfg, db, city, region, brand) {
  const set = new Set();
  const add = (s) => { const v = String(s || '').trim().toLowerCase(); if (v) set.add(v); };
  add(brand);
  ['beauty salon', 'nail salon', 'beauty parlor', 'spa', 'manicure', 'pedicure'].forEach(add);
  (pageCfg.themes || []).forEach(add);
  const cats = (db.categories || []).map((c) => (c.name || '').toLowerCase()).filter(Boolean);
  ['beauty salon', 'nail salon', ...cats.slice(0, 4)].forEach((thing) => {
    add(`${thing} near me`);
    if (city) { add(`${thing} ${city}`); add(`${thing} in ${city}`); }
  });
  if (city && region) add(`beauty salon ${city} ${region}`);
  (db.services || []).slice(0, 6).forEach((s) => {
    add(s.name);
    if (city) add(`${s.name} ${city}`);
  });
  return Array.from(set).slice(0, 24).join(', ');
}

function buildOfferCatalog(db) {
  const items = (db.services || []).map((s) => prune({
    '@type': 'Offer',
    itemOffered: prune({ '@type': 'Service', name: s.name, description: s.description, category: s.category }),
    price: s.price != null ? String(s.price) : undefined,
    priceCurrency: 'USD',
  }));
  if (!items.length) return undefined;
  return { '@type': 'OfferCatalog', name: 'Services', itemListElement: items };
}

function buildJsonLd(pageCfg, db, base, ctx) {
  const salon = db.salon || {};
  const reviewed = (db.bookings || []).filter((b) => b.review && typeof b.review.rating === 'number');
  let aggregateRating;
  if (reviewed.length) {
    const avg = Math.round((reviewed.reduce((s, b) => s + b.review.rating, 0) / reviewed.length) * 10) / 10;
    aggregateRating = { '@type': 'AggregateRating', ratingValue: String(avg), reviewCount: String(reviewed.length), bestRating: '5', worstRating: '1' };
  }
  const biz = prune({
    '@type': 'BeautySalon',
    '@id': base + '/#business',
    name: salon.name,
    description: ctx.description,
    url: base + '/',
    telephone: salon.phone,
    email: salon.email,
    image: base + '/favicon.svg',
    priceRange: '$$',
    address: {
      '@type': 'PostalAddress',
      streetAddress: streetOf(salon.address, ctx.city),
      addressLocality: ctx.city,
      addressRegion: salon.region,
      postalCode: salon.postalCode,
      addressCountry: salon.country,
    },
    areaServed: ctx.city ? { '@type': 'City', name: ctx.city } : undefined,
    openingHoursSpecification: (salon.hours || []).map((h) => ({
      '@type': 'OpeningHoursSpecification', dayOfWeek: h.day, opens: h.open, closes: h.close,
    })),
    sameAs: [salon.instagram, salon.facebook].filter(Boolean),
    hasOfferCatalog: buildOfferCatalog(db),
    aggregateRating,
  });
  const graph = [biz];
  if (pageCfg.crumbs) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: pageCfg.crumbs.map((c, i) => ({
        '@type': 'ListItem', position: i + 1, name: c[0], item: base + (c[1] === '/' ? '/' : c[1]),
      })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

// Returns the <head> SEO block for a page, or null if the page isn't a public
// marketing page we generate SEO for.
function buildSEO(urlPath, db, base) {
  const pageCfg = PAGE_SEO[pageKey(urlPath)];
  if (!pageCfg) return null;
  const salon = db.salon || {};
  const brand = salon.name || 'Our Salon';
  const city = salon.city || deriveCity(salon.address) || '';
  const region = salon.region || '';
  const cityRegion = [city, region].filter(Boolean).join(', ') || city || 'our area';
  // Use each category's primary word so "Skin & Brows" doesn't yield an awkward
  // "skin & brows & makeup" — the human-readable phrase reads "skin & makeup".
  const servicesPhrase = humanList((db.categories || []).map((c) => (c.name || '').split(/\s*&\s*|\s+and\s+/i)[0].trim().toLowerCase()));
  const tokens = { brand, city: city || 'your area', region, cityRegion, services: servicesPhrase };
  const fill = (s) => String(s).replace(/\{(\w+)\}/g, (_, k) => (tokens[k] != null ? tokens[k] : '')).replace(/\s+/g, ' ').trim();
  const title = fill(pageCfg.title);
  const description = fill(pageCfg.desc);
  const canonical = base + (pageKey(urlPath) === 'home' ? '/' : urlPath);
  const keywords = buildKeywords(pageCfg, db, city, region, brand);
  // Escape "<" so the JSON-LD can't break out of the <script> element.
  const jsonLd = JSON.stringify(buildJsonLd(pageCfg, db, base, { description, city })).replace(/</g, '\\u003c');
  return [
    `<title>${seoEsc(title)}</title>`,
    `<meta name="description" content="${seoEsc(description)}">`,
    `<meta name="keywords" content="${seoEsc(keywords)}">`,
    `<link rel="canonical" href="${seoEsc(canonical)}">`,
    `<meta property="og:type" content="${pageCfg.type || 'website'}">`,
    `<meta property="og:site_name" content="${seoEsc(brand)}">`,
    `<meta property="og:title" content="${seoEsc(title)}">`,
    `<meta property="og:description" content="${seoEsc(description)}">`,
    `<meta property="og:url" content="${seoEsc(canonical)}">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${seoEsc(title)}">`,
    `<meta name="twitter:description" content="${seoEsc(description)}">`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join('\n  ');
}

// Strip any static title/description/keywords/og/twitter/JSON-LD from the head,
// then inject the freshly generated block. Pages not in PAGE_SEO pass through.
function injectSEO(html, urlPath, db, base) {
  const block = buildSEO(urlPath, db, base);
  if (!block) return html;
  const out = html
    .replace(/\s*<title>[\s\S]*?<\/title>/i, '')
    .replace(/\s*<meta\s+name=["']description["'][^>]*>/ig, '')
    .replace(/\s*<meta\s+name=["']keywords["'][^>]*>/ig, '')
    .replace(/\s*<meta\s+property=["']og:[^"']*["'][^>]*>/ig, '')
    .replace(/\s*<meta\s+name=["']twitter:[^"']*["'][^>]*>/ig, '')
    .replace(/\s*<link\s+rel=["']canonical["'][^>]*>/ig, '')
    .replace(/\s*<script\s+type=["']application\/ld\+json["'][\s\S]*?<\/script>/ig, '');
  return out.replace(/<head([^>]*)>/i, (m) => `${m}\n  <!-- dynamic SEO (server-rendered from salon settings) -->\n  ${block}`);
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, '404.html'), (e2, page) => {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(page || '<h1>404 — page not found</h1><a href="/">Back home</a>');
      });
      return;
    }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    // Service worker must not be cached to allow prompt updates
    const cc   = urlPath === '/sw.js' ? 'no-store' : (CACHE_CTRL[ext] || 'no-cache');
    // Inject dynamic, area-based SEO into public marketing pages.
    let payload = data;
    if (ext === '.html' && PAGE_SEO[pageKey(urlPath)]) {
      try { payload = Buffer.from(injectSEO(data.toString('utf8'), urlPath, loadDB(), reqBase(req)), 'utf8'); }
      catch (e) { payload = data; }
    }
    const wantsGzip = (req.headers['accept-encoding'] || '').includes('gzip');
    if (wantsGzip && COMPRESSIBLE.has(mime)) {
      zlib.gzip(payload, (e, gz) => {
        if (e) { res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cc }); res.end(payload); return; }
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cc, 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' });
        res.end(gz);
      });
    } else {
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cc });
      res.end(payload);
    }
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
  });
}

function requireAdmin(req, res) {
  // 1. Admin session cookie (preferred — UI-based login)
  const sid = parseCookies(req).admin_sid;
  if (sid) {
    const s = _sessions.get(sid);
    if (s && s.isAdmin && Date.now() < s.expiresAt) return true;
    if (s) _sessions.delete(sid);
  }
  // 2. Legacy bearer token (env-var, for scripts/CI)
  const token = process.env.ADMIN_TOKEN;
  if (token) {
    const auth = req.headers['authorization'] || '';
    if (auth === 'Bearer ' + token) return true;
  }
  // 3. No password configured → allow (dev/demo mode)
  if (!process.env.ADMIN_PASSWORD && !process.env.ADMIN_TOKEN) return true;
  sendJSON(res, 401, { error: 'Admin access required.' });
  return false;
}

// ---- API routes ----------------------------------------------------------
// ---- Server-side validation (never trust the client) --------------------
const MAX_AHEAD_DAYS = 180;
function localDateStr(offsetDays = 0) {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
// Returns an error message string, or null if the date/time is acceptable.
// `salon` (optional) enables per-day opening-hours validation.
function validateDateTime(date, time, salon) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return 'Please choose a valid date.';
  if (isNaN(new Date(date + 'T00:00:00').getTime())) return 'Please choose a valid date.';
  if (date < localDateStr(0)) return 'That date is in the past.';
  if (date > localDateStr(MAX_AHEAD_DAYS)) return 'Please choose a date within the next 6 months.';
  if (!/^\d{2}:\d{2}$/.test(time || '')) return 'Please choose a valid time.';
  const mins = toMin(time);
  if (mins % SLOT_STEP !== 0) return 'Please choose a valid time slot.';
  if (salon) {
    const w = salonDayWindow(salon, date);
    if (!w) return 'We\'re closed that day.';
    if (mins < w.open || mins >= w.close) return 'That time is outside opening hours.';
  }
  return null;
}
function validateCustomer(c) {
  if (!c || !String(c.name || '').trim()) return 'Your name is required.';
  if (String(c.phone || '').replace(/\D/g, '').length < 7) return 'A valid phone number is required.';
  if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c.email))) return 'Please enter a valid email address.';
  return null;
}

// ---- Accounts (passwordless OTP) ----------------------------------------
// OTPs are ephemeral secrets — kept in memory only, never written to disk.
const _otps = new Map(); // phoneKey -> { code, expiresAt, attempts }
const OTP_TTL = 10 * 60 * 1000;
function normalizePhone(s) { return String(s || '').replace(/\D/g, ''); }
function genOtp(key) {
  const code = String(crypto.randomInt(100000, 1000000));
  _otps.set(key, { code, expiresAt: Date.now() + OTP_TTL, attempts: 0 });
  return code;
}
function validateRegister(d) {
  if (!d || !String(d.name || '').trim()) return 'Your name is required.';
  if (normalizePhone(d.phone).length < 7) return 'A valid phone number is required.';
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.email))) return 'Please enter a valid email address.';
  return null;
}

// Sessions are in-memory (lost on restart) — fine for now; move to DB/redis with the M7 DB swap.
const _sessions = new Map(); // token -> { customerId, expiresAt, isAdmin? }
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days (decision D7)
const ADMIN_SESSION_TTL = 8 * 60 * 60 * 1000;  // 8 hours for admin sessions
function createSession(customerId) {
  const t = crypto.randomBytes(24).toString('hex');
  _sessions.set(t, { customerId, expiresAt: Date.now() + SESSION_TTL });
  return t;
}
function createAdminSession() {
  const t = crypto.randomBytes(32).toString('hex');
  _sessions.set(t, { isAdmin: true, expiresAt: Date.now() + ADMIN_SESSION_TTL });
  return t;
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function getSession(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const s = _sessions.get(sid);
  if (!s || Date.now() > s.expiresAt) { if (s) _sessions.delete(sid); return null; }
  return s;
}
function setSessionCookie(res, token) {
  // SameSite=Lax gives baseline CSRF protection; add Secure in production (HTTPS). Double-submit token deferred to M7.
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax`);
}
function clearSessionCookie(req, res) {
  const sid = parseCookies(req).sid; if (sid) _sessions.delete(sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
// Validate an admin-supplied service; returns an error message or null.
function validateService(svc, db) {
  if (!svc || typeof svc !== 'object') return 'Invalid service.';
  if (!String(svc.name || '').trim()) return 'Service name is required.';
  if (!db.categories.some((c) => c.id === svc.category)) return 'Please choose a valid category.';
  const dur = Number(svc.duration);
  if (!Number.isInteger(dur) || dur <= 0 || dur > 480 || dur % 5 !== 0) return 'Duration must be a positive multiple of 5 minutes.';
  const price = Number(svc.price);
  if (!Number.isInteger(price) || price < 0 || price > 100000) return 'Price must be a whole, non-negative number.';
  if (!Array.isArray(svc.staffIds) || svc.staffIds.length === 0) return 'Assign at least one artist.';
  if (!svc.staffIds.every((id) => db.staff.some((p) => p.id === id))) return 'Unknown artist assigned.';
  if (svc.resourceId && !(db.resources || []).some((r) => r.id === svc.resourceId)) return 'Unknown resource assigned.';
  return null;
}
function validateResource(r) {
  if (!r || typeof r !== 'object') return 'Invalid resource.';
  if (!String(r.name || '').trim()) return 'Resource name is required.';
  const cap = Number(r.capacity);
  if (!Number.isInteger(cap) || cap < 1 || cap > 100) return 'Capacity must be a whole number of at least 1.';
  return null;
}
// Validate an admin-supplied prepaid package (a bundle of N sessions of one service).
function validatePackage(p, db) {
  if (!p || typeof p !== 'object') return 'Invalid package.';
  if (!String(p.name || '').trim()) return 'Package name is required.';
  if (!db.services.some((s) => s.id === p.serviceId)) return 'Choose a valid service for this package.';
  const n = Number(p.sessions);
  if (!Number.isInteger(n) || n < 2 || n > 50) return 'Sessions must be a whole number from 2 to 50.';
  const price = Number(p.price);
  if (!Number.isInteger(price) || price < 0 || price > 100000) return 'Price must be a whole, non-negative number.';
  return null;
}
function validateStaff(st) {
  if (!st || typeof st !== 'object') return 'Invalid artist.';
  if (!String(st.name || '').trim()) return 'Artist name is required.';
  if (st.specialties && !Array.isArray(st.specialties)) return 'Specialties must be a list.';
  return null;
}
// Validate optional scheduling fields on a staff record.
function validateSchedule(st) {
  const okTime = (t) => /^\d{2}:\d{2}$/.test(t);
  if (st.hours != null) {
    if (typeof st.hours !== 'object') return 'Invalid working hours.';
    for (const k of Object.keys(st.hours)) {
      if (!WD_SHORT.includes(k)) return 'Invalid weekday in working hours.';
      const v = st.hours[k];
      if (v === null) continue; // day off
      if (!v || !okTime(v.start) || !okTime(v.end) || toMin(v.start) >= toMin(v.end)) return 'Invalid hours for ' + k + '.';
    }
  }
  if (st.timeOff != null) {
    if (!Array.isArray(st.timeOff)) return 'Invalid time-off.';
    for (const r of st.timeOff) {
      if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(r.to || '') || r.from > r.to) return 'Invalid time-off range.';
    }
  }
  if (st.breaks != null) {
    if (!Array.isArray(st.breaks)) return 'Invalid breaks.';
    for (const b of st.breaks) {
      if (!b || !WD_SHORT.includes(b.day) || !okTime(b.start) || !okTime(b.end) || toMin(b.start) >= toMin(b.end)) return 'Invalid break.';
    }
  }
  return null;
}

// Validate a one-off block-off (lunch, cleaning, private event, etc.).
function validateBlockoff(bl, db) {
  if (!bl || typeof bl !== 'object') return 'Invalid block-off.';
  if (!db.staff.some((p) => p.id === bl.staffId)) return 'Choose an artist.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bl.date || '') || isNaN(new Date(bl.date + 'T00:00:00').getTime())) return 'Choose a valid date.';
  if (bl.date < localDateStr(0)) return 'That date is in the past.';
  if (!/^\d{2}:\d{2}$/.test(bl.start || '') || !/^\d{2}:\d{2}$/.test(bl.end || '') || toMin(bl.start) >= toMin(bl.end)) return 'End time must be after start time.';
  return null;
}

// Add `n` days to an ISO date string ("YYYY-MM-DD"), staying in local time so
// the calendar day never drifts across a DST/timezone boundary.
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Construct a confirmed booking object from already-validated inputs. Shared by the
// single, recurring and group booking paths so they all snapshot price/duration,
// resource and deposit the same way. The caller validates, re-checks availability,
// pushes onto fresh.bookings, and creates notifications. `extra` merges extra fields
// (e.g. seriesId, groupId) onto the result.
// A booking reference that's unique within `bookings`. Widened to 4 random bytes and
// collision-guarded so the bulk recurring/group paths (up to 12 refs in one request)
// can never mint a duplicate, which would make two visits indistinguishable on the
// ref+phone self-service lookup.
function uniqueRef(bookings) {
  let ref;
  do { ref = 'LUM-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }
  while (bookings.some((b) => b.ref === ref));
  return ref;
}

// Gift-card codes are human-readable and case-insensitive on lookup.
// Format: LUM-GIFT-XXXX-XXXX (8 hex chars grouped). Collisions are re-rolled.
function normalizeGiftCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}
function uniqueGiftCode(cards) {
  let code;
  do {
    const hex = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 chars
    code = `LUM-GIFT-${hex.slice(0, 4)}-${hex.slice(4)}`;
  } while (cards.some((c) => c.code === code));
  return code;
}
// A card is spendable only when paid for, active, and holding a positive balance.
function giftCardRedeemable(card) {
  return !!card && card.status === 'active' && card.paymentStatus === 'paid' && card.balance > 0;
}
// When a booking that consumed a gift card is cancelled, return the spent amount to
// the card so it can be used again. Idempotent: clears the marker so a double-cancel
// can't credit twice. Operates on the same `fresh` db the caller will save.
function refundGiftCard(fresh, booking) {
  const ga = booking.giftCardApplied;
  if (!ga) return;
  const card = (fresh.giftCards || []).find((c) => c.id === ga.giftCardId);
  if (card) {
    card.balance = Math.round((card.balance + ga.amount) * 100) / 100;
    card.redemptions = (card.redemptions || []).filter((r) => r.bookingId !== booking.id);
    if (card.status === 'depleted' && card.balance > 0) card.status = 'active';
    card.refunds = card.refunds || [];
    card.refunds.push({ bookingId: booking.id, ref: booking.ref, amount: ga.amount, at: new Date().toISOString() });
  }
  // Restore the price to its pre-discount worth and drop the marker (idempotency).
  if (booking.listPrice != null) booking.price = booking.listPrice;
  delete booking.giftCardApplied;
}

// After a booking is cancelled, notify the first matching waitlist entry (FIFO).
// Operates on the passed-in `fresh` DB object so the caller can saveDB once.
function notifyWaitlist(fresh, cancelled) {
  if (!fresh.waitlist || !fresh.waitlist.length) return;
  const serviceIds = cancelled.services ? cancelled.services.map((s) => s.serviceId) : [cancelled.serviceId];
  const waiter = fresh.waitlist.find((w) =>
    w.status === 'waiting' &&
    w.date === cancelled.date &&
    serviceIds.includes(w.serviceId) &&
    (w.staffId === 'any' || w.staffId === cancelled.staffId)
  );
  if (!waiter) return;
  waiter.status = 'notified';
  waiter.notifiedAt = new Date().toISOString();
  const toAddr = waiter.customer.email || waiter.customer.phone;
  const ch = waiter.customer.email ? 'email' : 'sms';
  if (!fresh.notifications) fresh.notifications = [];
  fresh.notifications.push({
    id: crypto.randomBytes(4).toString('hex'),
    waitlistId: waiter.id,
    to: toAddr, toName: waiter.customer.name,
    channel: ch, type: 'waitlist',
    message: `Hi ${waiter.customer.name.split(' ')[0]}, a spot has opened up on ${waiter.date} at Lumière! Call us or book online quickly before it's filled.\n\nLumière Beauty & Nail Studio`,
    status: 'scheduled', scheduledFor: new Date().toISOString()
  });
}

function buildBooking(fresh, svcs, staffId, date, time, customer, customerId, extra) {
  const totalDuration = svcs.reduce((sum, s) => sum + s.duration, 0);
  const totalPrice = svcs.reduce((sum, s) => sum + s.price, 0);
  const primary = svcs[0];
  const needsDeposit = svcs.some((s) => s.depositRequired);
  return Object.assign({
    id: crypto.randomBytes(4).toString('hex'),
    ref: uniqueRef(fresh.bookings),
    serviceId: primary.id,
    serviceName: svcs.map((s) => s.name).join(' + '),
    services: svcs.map((s) => ({ serviceId: s.id, serviceName: s.name, duration: s.duration, price: s.price })),
    duration: totalDuration,
    price: totalPrice,
    resourceId: primary.resourceId || null,
    depositStatus: needsDeposit ? 'pending' : null,
    customerId: customerId || null,
    staffId,
    staffName: (fresh.staff.find((p) => p.id === staffId) || {}).name || staffId,
    date,
    time,
    customer: {
      name: String(customer.name).slice(0, 80),
      phone: String(customer.phone).slice(0, 40),
      email: String(customer.email || '').slice(0, 120),
      notes: String(customer.notes || '').slice(0, 500)
    },
    status: 'confirmed',
    createdAt: new Date().toISOString()
  }, extra || {});
}

// Build the notification records a new booking generates:
// an immediate confirmation + a reminder scheduled 24h before the visit.
function makeNotifications(booking) {
  const visit = new Date(`${booking.date}T${booking.time}:00`);
  const remindAt = new Date(visit.getTime() - 24 * 60 * 60 * 1000);
  const toAddr = booking.customer.email || booking.customer.phone;
  const ch = booking.customer.email ? 'email' : 'sms';
  const first = booking.customer.name.split(' ')[0];
  const base = process.env.BASE_URL || 'http://localhost:3000';
  const phone = (booking.customer.phone || '').replace(/\D/g, '');
  const manageUrl = `${base}/manage.html?ref=${encodeURIComponent(booking.ref)}&phone=${encodeURIComponent(phone)}`;
  const out = [
    {
      id: crypto.randomBytes(4).toString('hex'),
      bookingId: booking.id, ref: booking.ref,
      to: toAddr, toName: booking.customer.name,
      channel: ch, type: 'confirmation',
      message: `Hi ${first}, your ${booking.serviceName} with ${booking.staffName} on ${booking.date} at ${booking.time} is confirmed. Ref: ${booking.ref}.\n\nManage your booking:\n${manageUrl}\n\nSee you soon!\nLumière Beauty & Nail Studio`,
      status: 'scheduled', scheduledFor: new Date().toISOString()
    }
  ];
  // Only schedule a "tomorrow" reminder when that moment is still in the future — a
  // same-day or <24h booking would otherwise fire a stale reminder on the next tick.
  if (remindAt.getTime() > Date.now()) {
    out.push({
      id: crypto.randomBytes(4).toString('hex'),
      bookingId: booking.id, ref: booking.ref,
      to: toAddr, toName: booking.customer.name,
      channel: ch, type: 'reminder',
      message: `Hi ${first}, just a reminder — your ${booking.serviceName} at Lumière is tomorrow at ${booking.time} with ${booking.staffName}.\n\nManage or reschedule:\n${manageUrl}\n\nLumière Beauty & Nail Studio`,
      status: 'scheduled', scheduledFor: remindAt.toISOString()
    });
  }
  return out;
}

// ---- SMTP client (Node.js net/tls built-ins only) --------------------------
// Configure via env: SMTP_HOST, SMTP_PORT (def 587), SMTP_USER, SMTP_PASS,
// SMTP_FROM, SMTP_SECURE=true (for port 465 implicit TLS).
function smtpSend({ to, toName, subject, text }, callback) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || '';
  const implicit = port === 465 || process.env.SMTP_SECURE === 'true';

  if (!host || !from) return callback(new Error('SMTP not configured (set SMTP_HOST and SMTP_FROM)'));

  const b64 = (s) => Buffer.from(String(s)).toString('base64');
  // Dot-stuffing: RFC 5321 requires lines starting with '.' to be doubled
  const body = text.split('\n').map((l) => (l.startsWith('.') ? '.' + l : l)).join('\r\n');
  const dateStr = new Date().toUTCString();
  const msgId = `<${Date.now()}.${crypto.randomBytes(4).toString('hex')}@lumiere>`;
  const toField = toName ? `${toName} <${to}>` : to;
  const message =
    `From: =?UTF-8?B?${b64('Lumière Beauty')}?= <${from}>\r\n` +
    `To: ${toField}\r\n` +
    `Subject: ${subject}\r\n` +
    `Date: ${dateStr}\r\n` +
    `Message-ID: ${msgId}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n` +
    `\r\n` +
    body;

  let sock;
  let buf = '';
  let state = 'greeting';
  let tlsDone = false;
  let finished = false;
  let caps = []; // EHLO capabilities collected from multi-line response

  function finish(err) {
    if (finished) return;
    finished = true;
    try { sock.destroy(); } catch (_) {}
    callback(err || null);
  }

  function write(s) { sock.write(s + '\r\n'); }

  function handle(line) {
    const code = parseInt(line.slice(0, 3), 10);
    const more = line[3] === '-'; // multi-line continuation
    if (code >= 400) return finish(new Error(`SMTP [${state}] ${line}`));

    // Collect EHLO capabilities; only act on the final 250 line
    if (state === 'ehlo' && code === 250) {
      caps.push(line.slice(4).trim().split(' ')[0].toUpperCase());
      if (more) return;
      const hasSTARTTLS = caps.includes('STARTTLS');
      caps = [];
      if (!implicit && !tlsDone && hasSTARTTLS) { write('STARTTLS'); state = 'starttls'; }
      else if (user) { write('AUTH LOGIN'); state = 'auth-user'; }
      else { write(`MAIL FROM:<${from}>`); state = 'mail-from'; }
      return;
    }
    if (more) return; // skip other multi-line continuations

    switch (state) {
      case 'greeting': write('EHLO lumiere'); state = 'ehlo'; break;
      case 'starttls': {
        tlsDone = true;
        const plain = sock;
        plain.removeListener('data', onData);
        sock = tls.connect({ socket: plain, host, servername: host }, () => {
          sock.on('data', onData);
          write('EHLO lumiere'); state = 'ehlo';
        });
        sock.on('error', finish);
        break;
      }
      case 'auth-user': write(b64(user)); state = 'auth-pass'; break;
      case 'auth-pass': write(b64(pass)); state = 'auth-ok'; break;
      case 'auth-ok':   write(`MAIL FROM:<${from}>`); state = 'mail-from'; break;
      case 'mail-from': write(`RCPT TO:<${to}>`); state = 'rcpt-to'; break;
      case 'rcpt-to':   write('DATA'); state = 'data-cmd'; break;
      case 'data-cmd':  sock.write(message + '\r\n.\r\n'); state = 'data-body'; break;
      case 'data-body': write('QUIT'); state = 'quit'; break;
      case 'quit':      finish(null); break;
    }
  }

  function onData(chunk) {
    buf += chunk.toString();
    const parts = buf.split('\r\n');
    buf = parts.pop();
    for (const line of parts) { if (line) handle(line); }
  }

  if (implicit) {
    sock = tls.connect({ host, port, servername: host });
  } else {
    sock = net.connect({ host, port });
  }
  sock.setTimeout(20000, () => finish(new Error('SMTP timeout')));
  sock.on('data', onData);
  sock.on('error', finish);
}

// ---- Notification scheduler ------------------------------------------------
let _notifRunning = false;
async function processNotifications() {
  if (_notifRunning || !process.env.SMTP_HOST) return;
  _notifRunning = true;
  try {
    const db = loadDB();
    if (!db.notifications) return;
    const now = Date.now();
    const due = db.notifications.filter(
      (n) => n.status === 'scheduled' && n.channel === 'email' &&
              n.to && n.to.includes('@') && new Date(n.scheduledFor).getTime() <= now
    );
    if (!due.length) return;

    const results = await Promise.all(due.map((n) => new Promise((resolve) => {
      const subject = n.subject || (n.type === 'confirmation'
        ? `Booking confirmed — ${n.ref} · Lumière`
        : n.type === 'waitlist'
          ? 'A spot opened up at Lumière!'
          : `Reminder: your Lumière appointment tomorrow · ${n.ref}`);
      smtpSend({ to: n.to, toName: n.toName, subject, text: n.message }, (err) => {
        if (err) console.error('[SMTP]', err.message);
        resolve({ id: n.id, ok: !err });
      });
    })));

    withLock(() => {
      const fresh = loadDB();
      const sentAt = new Date().toISOString();
      for (const { id, ok } of results) {
        const notif = (fresh.notifications || []).find((x) => x.id === id);
        if (!notif || notif.status !== 'scheduled') continue;
        notif.status = ok ? 'sent' : 'failed';
        if (ok) notif.sentAt = sentAt;
      }
      saveDB(fresh);
    });
  } catch (e) {
    console.error('[notifications]', e.message);
  } finally {
    _notifRunning = false;
  }
}

async function handleAPI(req, res, url) {
  const db = loadDB();
  if (!db.notifications) db.notifications = [];
  if (!db.blockoffs) db.blockoffs = [];
  if (!db.resources) db.resources = [];
  if (!db.customers) db.customers = [];
  if (!db.packages) db.packages = [];
  if (!db.giftCards) db.giftCards = [];
  if (!db.waitlist) db.waitlist = [];
  if (!db.membershipPlans) db.membershipPlans = [];
  if (!db.broadcasts) db.broadcasts = [];
  if (!db.products) db.products = [];
  if (!db.productSales) db.productSales = [];
  if (!db.gallery) db.gallery = [];
  const q = url.searchParams;

  // ---- Admin auth routes (public — no gate) --------------------------------
  // POST /api/admin/login { password }
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const { password } = body;
    const configured = process.env.ADMIN_PASSWORD;
    if (!configured) {
      // No password configured — issue session so UI works in dev/demo mode
      const t = createAdminSession();
      res.setHeader('Set-Cookie', `admin_sid=${t}; HttpOnly; Path=/; Max-Age=${ADMIN_SESSION_TTL / 1000}; SameSite=Lax`);
      return sendJSON(res, 200, { ok: true });
    }
    if (!password || password !== configured) {
      return sendJSON(res, 401, { error: 'Incorrect password.' });
    }
    const t = createAdminSession();
    res.setHeader('Set-Cookie', `admin_sid=${t}; HttpOnly; Path=/; Max-Age=${ADMIN_SESSION_TTL / 1000}; SameSite=Lax`);
    return sendJSON(res, 200, { ok: true });
  }
  // GET /api/admin/auth — returns whether caller is authenticated admin
  if (req.method === 'GET' && url.pathname === '/api/admin/auth') {
    const passwordSet = !!process.env.ADMIN_PASSWORD;
    const authed = requireAdmin(req, { writeHead() {}, setHeader() {}, end() {} }); // dry-run
    return sendJSON(res, 200, { authenticated: authed, passwordRequired: passwordSet });
  }
  // POST /api/admin/logout
  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    const sid = parseCookies(req).admin_sid;
    if (sid) _sessions.delete(sid);
    res.setHeader('Set-Cookie', 'admin_sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
    return sendJSON(res, 200, { ok: true });
  }

  // Admin gate — all /api/admin/* routes require the ADMIN_TOKEN when it is set
  if (url.pathname.startsWith('/api/admin/') && !requireAdmin(req, res)) return;

  // GET /api/health — liveness probe
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJSON(res, 200, { ok: true, bookings: db.bookings.length, uptime: process.uptime() });
  }

  // GET /api/config — salon, categories, services, staff, resources, packages
  if (req.method === 'GET' && url.pathname === '/api/config') {
    const payload = {
      salon: db.salon, categories: db.categories, services: db.services,
      staff: db.staff, resources: db.resources, packages: db.packages,
      membershipPlans: db.membershipPlans
    };
    const json = JSON.stringify(payload);
    const etag = '"' + crypto.createHash('sha1').update(json).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'public, max-age=60' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'ETag': etag });
    return res.end(json);
  }

  // GET /api/availability?serviceIds=id1,id2&staffId=&date=
  // Also accepts legacy ?serviceId=single for backward compat.
  if (req.method === 'GET' && url.pathname === '/api/availability') {
    const rawIds = q.get('serviceIds') || q.get('serviceId') || '';
    const serviceIds = rawIds.split(',').map((s) => s.trim()).filter(Boolean);
    const date = q.get('date');
    let staffId = q.get('staffId');
    const svcs = serviceIds.map((id) => db.services.find((s) => s.id === id)).filter(Boolean);
    if (!svcs.length || !date) return sendJSON(res, 400, { error: 'serviceId(s) and date required' });
    const primary = svcs[0];

    // "any" staff → intersect staffIds across ALL selected services
    let staffPool;
    if (staffId && staffId !== 'any') {
      staffPool = [staffId];
    } else {
      staffPool = svcs.reduce((pool, svc) => pool.filter((id) => svc.staffIds.includes(id)), primary.staffIds);
    }

    const byStaff = staffPool.map((sid) => ({
      staffId: sid,
      staffName: (db.staff.find((p) => p.id === sid) || {}).name || sid,
      slots: availableSlots(db, serviceIds, sid, date)
    }));
    const label = svcs.map((s) => s.name).join(' + ');
    return sendJSON(res, 200, { date, service: label, options: byStaff });
  }

  // POST /api/bookings
  // Accepts services[] array (multi-service) or legacy serviceId (single).
  // services[] is an array of serviceId strings, max 3.
  if (req.method === 'POST' && url.pathname === '/api/bookings') {
    const data = await readBody(req);
    const { staffId, date, time, customer } = data;
    // Normalize to array; enforce max 3
    const serviceIds = Array.isArray(data.services)
      ? data.services.slice(0, 3).map(String)
      : [data.serviceId];
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.notifications) fresh.notifications = [];
      const svcs = serviceIds.map((id) => fresh.services.find((s) => s.id === id));
      if (svcs.some((s) => !s)) return sendJSON(res, 400, { error: 'Unknown service.' });
      // Staff must be qualified for every selected service
      if (!staffId || svcs.some((s) => !s.staffIds.includes(staffId))) {
        return sendJSON(res, 400, { error: 'That artist can\'t perform all selected services.' });
      }
      const dtErr = validateDateTime(date, time, fresh.salon);
      if (dtErr) return sendJSON(res, 400, { error: dtErr });
      const custErr = validateCustomer(customer);
      if (custErr) return sendJSON(res, 400, { error: custErr });
      // Re-check the combined slot is still free (guard against double-booking).
      const free = availableSlots(fresh, serviceIds, staffId, date).includes(time);
      if (!free) return sendJSON(res, 409, { error: 'That slot was just taken. Please pick another time.' });

      const sess = getSession(req);
      // Optional: redeem one session of a prepaid package the logged-in customer owns.
      // Only valid for a single-service booking matching the package's service.
      let redeem = null;
      if (data.usePackageId) {
        if (!sess) return sendJSON(res, 401, { error: 'Please log in to use a package.' });
        const cust = fresh.customers.find((c) => c.id === sess.customerId);
        redeem = cust && (cust.packages || []).find((p) => p.id === data.usePackageId);
        if (!redeem || redeem.remaining <= 0) return sendJSON(res, 400, { error: 'That package has no sessions left.' });
        if (redeem.paymentStatus !== 'paid') return sendJSON(res, 400, { error: 'That package has not been paid for yet.' });
        if (serviceIds.length !== 1 || serviceIds[0] !== redeem.serviceId) {
          return sendJSON(res, 400, { error: `Your "${redeem.name}" can only be used for ${redeem.serviceId}.` });
        }
      }

      // Optional: apply a prepaid gift card. Reject an unknown/unusable code up front so
      // the customer can fix it before the slot is consumed.
      let giftCard = null;
      if (data.giftCardCode) {
        const code = normalizeGiftCode(data.giftCardCode);
        giftCard = fresh.giftCards.find((c) => c.code === code);
        if (!giftCard) return sendJSON(res, 400, { error: 'That gift card code was not found.' });
        if (!giftCardRedeemable(giftCard)) {
          const why = giftCard.status === 'void' ? 'has been voided'
            : giftCard.paymentStatus !== 'paid' ? 'has not been paid for yet'
            : 'has no balance remaining';
          return sendJSON(res, 400, { error: `That gift card ${why}.` });
        }
      }

      const booking = buildBooking(fresh, svcs, staffId, date, time, customer, (sess || {}).customerId);
      if (redeem) {
        booking.listPrice = booking.price;       // keep what the visit is worth
        booking.price = 0;                        // prepaid via the package
        booking.packageRedemption = { customerPackageId: redeem.id, packageName: redeem.name };
        redeem.remaining -= 1;                    // decrement the owner's balance (same fresh db)
      }
      // Apply membership discount (skipped when package already covers the visit).
      if (!redeem && sess) {
        const memCust = fresh.customers.find((c) => c.id === sess.customerId);
        const mem = memCust && memCust.membership;
        if (mem && mem.status === 'active' && mem.paymentStatus === 'paid' && (mem.discountPct || 0) > 0 && booking.price > 0) {
          const saved = Math.round(booking.price * mem.discountPct) / 100;
          if (booking.listPrice == null) booking.listPrice = booking.price;
          booking.price = Math.max(0, Math.round((booking.price - saved) * 100) / 100);
          booking.memberDiscount = { planName: mem.planName, discountPct: mem.discountPct, savedAmount: saved };
        }
      }

      // Apply the gift card to whatever price remains (a package may have zeroed it).
      if (giftCard && booking.price > 0) {
        const applied = Math.min(giftCard.balance, booking.price);
        if (booking.listPrice == null) booking.listPrice = booking.price; // worth before discount
        booking.price = booking.price - applied;  // net the customer pays at the salon
        booking.giftCardApplied = { giftCardId: giftCard.id, code: giftCard.code, amount: applied };
        giftCard.balance = Math.round((giftCard.balance - applied) * 100) / 100;
        giftCard.redemptions = giftCard.redemptions || [];
        giftCard.redemptions.push({ bookingId: booking.id, ref: booking.ref, amount: applied, at: new Date().toISOString() });
        if (giftCard.balance <= 0) giftCard.status = 'depleted';
      }

      // Apply loyalty points: 100 pts = $1. Customer must be logged in and own enough points.
      if (data.pointsToRedeem && booking.price > 0 && sess) {
        const pts = Math.round(Number(data.pointsToRedeem) || 0);
        const ptsCust = fresh.customers.find((c) => c.id === sess.customerId);
        if (pts > 0 && pts % 100 === 0 && ptsCust && (ptsCust.points || 0) >= pts) {
          const savedByPoints = pts / 100;
          const actualSaved = Math.min(savedByPoints, booking.price);
          if (booking.listPrice == null) booking.listPrice = booking.price;
          booking.price = Math.round((booking.price - actualSaved) * 100) / 100;
          ptsCust.points = (ptsCust.points || 0) - pts;
          booking.pointsRedeemed = { points: pts, savedAmount: actualSaved };
        }
      }

      fresh.bookings.push(booking);
      fresh.notifications.push(...makeNotifications(booking));
      saveDB(fresh);
      return sendJSON(res, 201, { ok: true, booking });
    });
  }

  // POST /api/bookings/recurring — book a repeating series (same service + artist + time).
  // { services|serviceId, staffId, date, time, customer, cadence, count }
  // cadence: weekly(7d) | biweekly(14d) | every4weeks(28d).  count: 2..12.
  // Books every occurrence that's free; reports any it had to skip. Shares a seriesId.
  if (req.method === 'POST' && url.pathname === '/api/bookings/recurring') {
    const data = await readBody(req);
    const { staffId, date, time, customer, cadence } = data;
    const serviceIds = Array.isArray(data.services) ? data.services.slice(0, 3).map(String) : [data.serviceId];
    const CADENCE = { weekly: 7, biweekly: 14, every4weeks: 28 };
    const step = CADENCE[cadence];
    const count = Math.min(12, Math.max(0, parseInt(data.count, 10) || 0));
    if (!step) return sendJSON(res, 400, { error: 'Choose how often to repeat.' });
    if (count < 2) return sendJSON(res, 400, { error: 'Choose how many visits (2–12).' });
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.notifications) fresh.notifications = [];
      const svcs = serviceIds.map((id) => fresh.services.find((s) => s.id === id));
      if (svcs.some((s) => !s)) return sendJSON(res, 400, { error: 'Unknown service.' });
      if (!staffId || staffId === 'any' || svcs.some((s) => !s.staffIds.includes(staffId))) {
        return sendJSON(res, 400, { error: 'Pick a specific artist for a recurring series.' });
      }
      const custErr = validateCustomer(customer);
      if (custErr) return sendJSON(res, 400, { error: custErr });
      const dtErr = validateDateTime(date, time, fresh.salon);
      if (dtErr) return sendJSON(res, 400, { error: dtErr });

      const seriesId = crypto.randomBytes(4).toString('hex');
      const customerId = (getSession(req) || {}).customerId || null;
      const booked = [], skipped = [];
      for (let i = 0; i < count; i++) {
        const d = addDays(date, i * step);
        const dErr = validateDateTime(d, time, fresh.salon);
        if (dErr) { skipped.push({ date: d, reason: dErr }); continue; }
        // fresh.bookings already includes the ones we pushed this loop, so the
        // engine won't double-book the same artist within the series.
        if (!availableSlots(fresh, serviceIds, staffId, d).includes(time)) {
          skipped.push({ date: d, reason: 'That time isn\'t available.' });
          continue;
        }
        const booking = buildBooking(fresh, svcs, staffId, d, time, customer, customerId, { seriesId, seriesIndex: i });
        fresh.bookings.push(booking);
        fresh.notifications.push(...makeNotifications(booking));
        booked.push(booking);
      }
      if (!booked.length) {
        return sendJSON(res, 409, { error: 'None of those dates were available. Try a different time or artist.', skipped });
      }
      saveDB(fresh);
      return sendJSON(res, 201, { ok: true, seriesId, booked, skipped });
    });
  }

  // POST /api/bookings/group — book a party (bridal / event) on one date under one
  // organizer who is the single point of contact ("one payer"). All-or-nothing.
  // { organizer:{name,phone,email}, date, time (target start), members:[{name, services|serviceId, staffId|'any', notes}] }
  // Each guest is placed in the earliest free slot at/after the target time for their
  // chosen (or any qualified) artist; guests sharing an artist/resource fall to adjacent slots.
  if (req.method === 'POST' && url.pathname === '/api/bookings/group') {
    const data = await readBody(req);
    const { organizer, date, time, members } = data;
    if (!Array.isArray(members) || members.length < 2 || members.length > 12) {
      return sendJSON(res, 400, { error: 'A group needs between 2 and 12 guests.' });
    }
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.notifications) fresh.notifications = [];
      const orgErr = validateCustomer(organizer);
      if (orgErr) return sendJSON(res, 400, { error: 'Organizer — ' + orgErr });
      const dtErr = validateDateTime(date, time, fresh.salon);
      if (dtErr) return sendJSON(res, 400, { error: dtErr });

      const groupId = crypto.randomBytes(4).toString('hex');
      const customerId = (getSession(req) || {}).customerId || null;
      // Place guests against a working copy so each placement is visible to the next.
      const working = Object.assign({}, fresh, { bookings: fresh.bookings.slice() });
      const placed = [];
      for (let i = 0; i < members.length; i++) {
        const m = members[i] || {};
        const name = String(m.name || '').trim();
        if (!name) return sendJSON(res, 400, { error: `Guest ${i + 1}: a name is required.` });
        const ids = Array.isArray(m.services) ? m.services.slice(0, 3).map(String) : [m.serviceId];
        const svcs = ids.map((id) => fresh.services.find((s) => s.id === id));
        if (!svcs.length || svcs.some((s) => !s)) return sendJSON(res, 400, { error: `Guest ${i + 1} (${name}): choose a valid service.` });
        const pool = (m.staffId && m.staffId !== 'any')
          ? [m.staffId]
          : svcs.reduce((p, s) => p.filter((id) => s.staffIds.includes(id)), svcs[0].staffIds.slice());
        // Pick the qualified artist whose earliest opening is closest to the target time,
        // so the party clusters around one start time instead of drifting later than needed.
        let chosen = null;
        for (const sid of pool) {
          if (svcs.some((s) => !s.staffIds.includes(sid))) continue;
          const slot = availableSlots(working, ids, sid, date).find((t) => toMin(t) >= toMin(time));
          if (slot && (!chosen || toMin(slot) < toMin(chosen.time))) chosen = { staffId: sid, time: slot };
        }
        if (!chosen) return sendJSON(res, 409, { error: `Couldn't fit guest ${i + 1} (${name}) on ${date}. Try an earlier start time, a different artist, or fewer services.` });
        const guestContact = { name, phone: organizer.phone, email: organizer.email || '', notes: String(m.notes || '').slice(0, 500) };
        // Build against `working` (not fresh) so uniqueRef sees already-placed guests this request.
        const booking = buildBooking(working, svcs, chosen.staffId, date, chosen.time, guestContact, customerId, {
          groupId, groupRole: i === 0 ? 'organizer' : 'guest', organizerName: String(organizer.name).slice(0, 80)
        });
        working.bookings.push(booking); // next guest sees this slot as taken
        placed.push(booking);
      }
      placed.forEach((b) => { fresh.bookings.push(b); fresh.notifications.push(...makeNotifications(b)); });
      saveDB(fresh);
      return sendJSON(res, 201, { ok: true, groupId, bookings: placed });
    });
  }

  // GET /api/bookings/lookup-by-ref?ref=  — ref-only lookup used by review.html
  // Exposes minimal fields — no raw phone/email. The ref itself is the access token.
  if (req.method === 'GET' && url.pathname === '/api/bookings/lookup-by-ref') {
    const refVal = String(q.get('ref') || '').trim().toUpperCase();
    if (!refVal) return sendJSON(res, 400, { error: 'ref required.' });
    const b = db.bookings.find((x) => x.ref === refVal);
    if (!b) return sendJSON(res, 404, { error: 'Booking not found.' });
    return sendJSON(res, 200, {
      booking: {
        id: b.id, ref: b.ref, status: b.status,
        serviceId: b.serviceId, serviceName: b.serviceName,
        staffName: b.staffName, date: b.date, time: b.time,
        review: b.review || null
      }
    });
  }

  // POST /api/bookings/lookup  { ref, phone } — self-service retrieval
  if (req.method === 'POST' && url.pathname === '/api/bookings/lookup') {
    const { ref, phone } = await readBody(req);
    const digits = (s) => String(s || '').replace(/\D/g, '');
    const b = db.bookings.find(
      (x) => x.ref.toLowerCase() === String(ref || '').trim().toLowerCase() &&
             digits(x.customer.phone) === digits(phone)
    );
    if (!b) return sendJSON(res, 404, { error: 'No booking matches that reference and phone number.' });
    return sendJSON(res, 200, { booking: b });
  }

  // GET /api/bookings/ics?ref=&phone=  — download iCalendar file for a booking
  if (req.method === 'GET' && url.pathname === '/api/bookings/ics') {
    const refVal  = String(q.get('ref')   || '').trim().toUpperCase();
    const phoneVal = String(q.get('phone') || '').replace(/\D/g, '');
    if (!refVal || !phoneVal) return sendJSON(res, 400, { error: 'ref and phone are required.' });
    const b = db.bookings.find(
      (x) => x.ref === refVal && x.customer.phone.replace(/\D/g, '') === phoneVal
    );
    if (!b) return sendJSON(res, 404, { error: 'Booking not found.' });

    // Build start/end datetimes (naive local — no TZ suffix)
    const totalMins = (b.services || []).reduce((sum, s) => sum + (s.duration || 0), 0) || 60;
    const [yy, mm, dd] = (b.date || '').split('-').map(Number);
    const [hh, mi] = (b.time || '00:00').split(':').map(Number);
    const pad = (n) => String(n).padStart(2, '0');
    const dtFmt = (y, mo, d, h, m) => `${y}${pad(mo)}${pad(d)}T${pad(h)}${pad(m)}00`;
    const startDt = dtFmt(yy, mm, dd, hh, mi);
    const endMin  = mi + totalMins;
    const endDt   = dtFmt(yy, mm, dd, hh + Math.floor(endMin / 60), endMin % 60);
    const stampDt = dtFmt(...(() => { const n = new Date(); return [n.getUTCFullYear(), n.getUTCMonth()+1, n.getUTCDate(), n.getUTCHours(), n.getUTCMinutes()]; })()) + 'Z';

    const addr = db.salon && db.salon.address ? db.salon.address : 'Lumière Beauty & Nail Studio';
    const descLines = [
      `Service: ${b.serviceName}`,
      `Artist: ${b.staffName}`,
      `Booking ref: ${b.ref}`,
      `Manage: ${req.headers.host ? 'http://' + req.headers.host + '/manage.html?ref=' + encodeURIComponent(b.ref) + '&phone=' + encodeURIComponent((b.customer.phone || '').replace(/\D/g,'')) : '/manage.html'}`,
    ];
    const fold = (s) => s.match(/.{1,75}/g).join('\r\n ');  // iCal line folding

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Lumière Beauty & Nail Studio//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${b.ref}@lumierestudio.com`,
      `DTSTAMP:${stampDt}`,
      `DTSTART:${startDt}`,
      `DTEND:${endDt}`,
      fold(`SUMMARY:${b.serviceName} at Lumière`),
      fold(`DESCRIPTION:${descLines.join('\\n')}`),
      fold(`LOCATION:${addr}`),
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n';

    res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="lumiere-${b.ref}.ics"`,
      'Cache-Control': 'no-store',
    });
    return res.end(ics);
  }

  // POST /api/bookings/reschedule  { id, date, time }
  if (req.method === 'POST' && url.pathname === '/api/bookings/reschedule') {
    const { id, date, time } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.notifications) fresh.notifications = [];
      const b = fresh.bookings.find((x) => x.id === id);
      if (!b) return sendJSON(res, 404, { error: 'Booking not found.' });
      if (b.status === 'cancelled') return sendJSON(res, 400, { error: 'This booking was cancelled.' });
      const dtErr = validateDateTime(date, time, fresh.salon);
      if (dtErr) return sendJSON(res, 400, { error: dtErr });
      // Check the new slot is free for the same artist (ignoring this booking itself).
      const others = fresh.bookings.filter((x) => x.id !== id);
      const reschedIds = b.services ? b.services.map((s) => s.serviceId) : [b.serviceId];
      const free = availableSlots({ ...fresh, bookings: others }, reschedIds, b.staffId, date).includes(time);
      if (!free) return sendJSON(res, 409, { error: 'That time isn\'t available. Please pick another.' });
      b.date = date; b.time = time;
      // refresh the reminder for the new date (makeNotifications omits it if now <24h away)
      fresh.notifications = fresh.notifications.filter((n) => !(n.bookingId === id && n.type === 'reminder'));
      const reminder = makeNotifications(b).find((n) => n.type === 'reminder');
      if (reminder) fresh.notifications.push(reminder);
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true, booking: b });
    });
  }

  // GET /api/notifications — admin reminder/notification feed
  if (req.method === 'GET' && url.pathname === '/api/notifications') {
    const sorted = [...db.notifications].sort((a, b) =>
      String(b.scheduledFor).localeCompare(String(a.scheduledFor))
    );
    return sendJSON(res, 200, { notifications: sorted });
  }

  // POST /api/admin/notifications/send — manually trigger delivery now
  if (req.method === 'POST' && url.pathname === '/api/admin/notifications/send') {
    processNotifications(); // fire-and-forget
    return sendJSON(res, 200, { ok: true, message: 'Delivery triggered.' });
  }

  // GET /api/bookings — admin list with optional search/filter/pagination
  if (req.method === 'GET' && url.pathname === '/api/bookings') {
    const q        = (url.searchParams.get('q') || '').trim().toLowerCase();
    const statusF  = url.searchParams.get('status') || '';
    const staffF   = url.searchParams.get('staffId') || '';
    const dateF    = url.searchParams.get('date') || '';
    const page     = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '25', 10)));

    let list = [...db.bookings].sort((a, b) =>
      (b.date + b.time).localeCompare(a.date + a.time)
    );
    if (q) list = list.filter(b =>
      (b.ref || '').toLowerCase().includes(q) ||
      (b.customer?.name || '').toLowerCase().includes(q) ||
      (b.customer?.phone || '').toLowerCase().includes(q) ||
      (b.serviceName || '').toLowerCase().includes(q) ||
      (b.staffName || '').toLowerCase().includes(q)
    );
    if (statusF) list = list.filter(b => b.status === statusF);
    if (staffF)  list = list.filter(b => b.staffId === staffF);
    if (dateF)   list = list.filter(b => b.date === dateF);

    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const pg    = Math.min(page, pages);
    return sendJSON(res, 200, {
      bookings: list.slice((pg - 1) * pageSize, pg * pageSize),
      total, page: pg, pageSize, pages,
    });
  }

  // POST /api/bookings/cancel  { id }  — customer self-service; enforces 24h cutoff
  if (req.method === 'POST' && url.pathname === '/api/bookings/cancel') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const b = fresh.bookings.find((x) => x.id === id);
      if (!b) return sendJSON(res, 404, { error: 'Booking not found.' });
      if (b.status === 'cancelled') return sendJSON(res, 400, { error: 'Already cancelled.' });
      // Enforce 24-hour cancellation cutoff
      const apptMs = new Date(b.date + 'T' + b.time + ':00').getTime();
      if (apptMs - Date.now() < 24 * 60 * 60 * 1000) {
        return sendJSON(res, 409, { error: 'Cancellations must be made at least 24 hours in advance. Please call us to cancel.', cutoff: true });
      }
      b.status = 'cancelled';
      refundGiftCard(fresh, b);
      notifyWaitlist(fresh, b);
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true });
    });
  }

  // POST /api/admin/bookings/cancel  { id }  — admin cancel, bypasses the cutoff
  if (req.method === 'POST' && url.pathname === '/api/admin/bookings/cancel') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const b = fresh.bookings.find((x) => x.id === id);
      if (!b) return sendJSON(res, 404, { error: 'Booking not found.' });
      b.status = 'cancelled';
      refundGiftCard(fresh, b);
      notifyWaitlist(fresh, b);
      saveDB(fresh);
      audit(req, 'booking.cancel', { id: b.id, ref: b.ref, customer: b.customer && b.customer.name });
      return sendJSON(res, 200, { ok: true });
    });
  }

  // POST /api/waitlist  { serviceId, staffId, date, name, phone, email? }  — join waitlist
  if (req.method === 'POST' && url.pathname === '/api/waitlist') {
    const { serviceId, staffId, date, name, phone, email } = await readBody(req);
    if (!serviceId || !date || !name || !phone) {
      return sendJSON(res, 400, { error: 'serviceId, date, name and phone are required.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJSON(res, 400, { error: 'date must be YYYY-MM-DD.' });
    if (new Date(date) < new Date(new Date().toISOString().slice(0, 10))) {
      return sendJSON(res, 400, { error: 'Cannot join the waitlist for a past date.' });
    }
    const normPhone = normalizePhone(phone);
    if (!normPhone) return sendJSON(res, 400, { error: 'Invalid phone number.' });
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.waitlist) fresh.waitlist = [];
      const entry = {
        id: crypto.randomBytes(6).toString('hex'),
        serviceId, staffId: staffId || 'any', date,
        customer: { name: name.trim(), phone: normPhone, email: email || null },
        status: 'waiting',
        createdAt: new Date().toISOString()
      };
      fresh.waitlist.push(entry);
      saveDB(fresh);
      return sendJSON(res, 201, { ok: true, id: entry.id });
    });
  }

  // GET /api/waitlist  — admin: view all waitlist entries
  if (req.method === 'GET' && url.pathname === '/api/waitlist') {
    const sorted = [...db.waitlist].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)));
    return sendJSON(res, 200, { waitlist: sorted });
  }

  // POST /api/admin/waitlist/dismiss  { id }  — remove an entry
  if (req.method === 'POST' && url.pathname === '/api/admin/waitlist/dismiss') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.waitlist) fresh.waitlist = [];
      const idx = fresh.waitlist.findIndex((w) => w.id === id);
      if (idx === -1) return sendJSON(res, 404, { error: 'Waitlist entry not found.' });
      fresh.waitlist.splice(idx, 1);
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true });
    });
  }

  // --- Memberships ---

  // POST /api/admin/membership-plans/save  { plan: { id?, name, description?, monthlyPrice, discountPct } }
  if (req.method === 'POST' && url.pathname === '/api/admin/membership-plans/save') {
    const { plan } = await readBody(req);
    if (!plan || !plan.name || plan.monthlyPrice == null || plan.discountPct == null) {
      return sendJSON(res, 400, { error: 'name, monthlyPrice and discountPct are required.' });
    }
    if (plan.discountPct < 1 || plan.discountPct > 100) {
      return sendJSON(res, 400, { error: 'discountPct must be 1–100.' });
    }
    if (plan.monthlyPrice < 0) return sendJSON(res, 400, { error: 'monthlyPrice must be non-negative.' });
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.membershipPlans) fresh.membershipPlans = [];
      if (plan.id) {
        const idx = fresh.membershipPlans.findIndex((p) => p.id === plan.id);
        if (idx === -1) return sendJSON(res, 404, { error: 'Plan not found.' });
        fresh.membershipPlans[idx] = { ...fresh.membershipPlans[idx], ...plan };
        saveDB(fresh);
        return sendJSON(res, 200, { plan: fresh.membershipPlans[idx] });
      }
      const newPlan = { id: crypto.randomBytes(5).toString('hex'), name: plan.name.trim(), description: plan.description || '', monthlyPrice: Number(plan.monthlyPrice), discountPct: Number(plan.discountPct), active: plan.active !== false };
      fresh.membershipPlans.push(newPlan);
      saveDB(fresh);
      return sendJSON(res, 201, { plan: newPlan });
    });
  }

  // POST /api/admin/membership-plans/delete  { id }
  if (req.method === 'POST' && url.pathname === '/api/admin/membership-plans/delete') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.membershipPlans) fresh.membershipPlans = [];
      const idx = fresh.membershipPlans.findIndex((p) => p.id === id);
      if (idx === -1) return sendJSON(res, 404, { error: 'Plan not found.' });
      fresh.membershipPlans.splice(idx, 1);
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true });
    });
  }

  // GET /api/gallery — public list sorted by sortOrder
  if (req.method === 'GET' && url.pathname === '/api/gallery') {
    const items = [...(db.gallery || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    return sendJSON(res, 200, { gallery: items });
  }

  // POST /api/admin/gallery/save  { item: { id?, category, title, emoji?, imageUrl?, caption?, sortOrder? } }
  if (req.method === 'POST' && url.pathname === '/api/admin/gallery/save') {
    const { item } = await readBody(req);
    if (!item || !item.title || !item.category) return sendJSON(res, 400, { error: 'title and category are required.' });
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.gallery) fresh.gallery = [];
      const id = item.id || crypto.randomUUID();
      const idx = fresh.gallery.findIndex((g) => g.id === id);
      const saved = {
        id,
        category: String(item.category).trim(),
        title: String(item.title).trim(),
        emoji: item.emoji != null ? String(item.emoji).trim() : '🖼️',
        imageUrl: item.imageUrl != null ? String(item.imageUrl).trim() : '',
        caption: item.caption != null ? String(item.caption).trim() : '',
        sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : (fresh.gallery.length + 1),
      };
      if (idx === -1) fresh.gallery.push(saved);
      else fresh.gallery[idx] = saved;
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true, item: saved });
    });
  }

  // POST /api/admin/gallery/delete  { id }
  if (req.method === 'POST' && url.pathname === '/api/admin/gallery/delete') {
    const { id } = await readBody(req);
    if (!id) return sendJSON(res, 400, { error: 'id is required.' });
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.gallery) fresh.gallery = [];
      const idx = fresh.gallery.findIndex((g) => g.id === id);
      if (idx === -1) return sendJSON(res, 404, { error: 'Gallery item not found.' });
      fresh.gallery.splice(idx, 1);
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true });
    });
  }

  // GET /api/admin/backup  — download a full db.json snapshot (admin-only)
  if (req.method === 'GET' && url.pathname === '/api/admin/backup') {
    const snapshot = JSON.stringify(db, null, 2);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="lumiere-backup-${ts}.json"`,
      'Cache-Control': 'no-store',
    });
    return res.end(snapshot);
  }

  // GET /api/admin/members  — list all customers who have (or had) a membership
  if (req.method === 'GET' && url.pathname === '/api/admin/members') {
    const members = (db.customers || [])
      .filter((c) => c.membership)
      .map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email || null, membership: c.membership }));
    return sendJSON(res, 200, { members });
  }

  // POST /api/membership/subscribe  { planId }  — logged-in customer joins a plan
  if (req.method === 'POST' && url.pathname === '/api/membership/subscribe') {
    const sess = getSession(req);
    if (!sess) return sendJSON(res, 401, { error: 'Please log in to subscribe.' });
    const { planId } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.membershipPlans) fresh.membershipPlans = [];
      const plan = fresh.membershipPlans.find((p) => p.id === planId && p.active !== false);
      if (!plan) return sendJSON(res, 404, { error: 'Membership plan not found.' });
      const cust = fresh.customers.find((c) => c.id === sess.customerId);
      if (!cust) return sendJSON(res, 404, { error: 'Customer not found.' });
      if (cust.membership && cust.membership.status === 'active') {
        return sendJSON(res, 409, { error: 'You already have an active membership.' });
      }
      const today = new Date().toISOString().slice(0, 10);
      const renewal = new Date(); renewal.setMonth(renewal.getMonth() + 1);
      cust.membership = {
        planId: plan.id, planName: plan.name, discountPct: plan.discountPct,
        monthlyPrice: plan.monthlyPrice, status: 'pending_payment', paymentStatus: 'pending',
        startDate: today, renewalDate: renewal.toISOString().slice(0, 10)
      };
      saveDB(fresh);
      return sendJSON(res, 201, { ok: true, membership: cust.membership });
    });
  }

  // POST /api/admin/membership/markpaid  { customerId }  — mark current period as paid (activates or renews)
  if (req.method === 'POST' && url.pathname === '/api/admin/membership/markpaid') {
    const { customerId } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const cust = fresh.customers.find((c) => c.id === customerId);
      if (!cust || !cust.membership) return sendJSON(res, 404, { error: 'No membership found for this customer.' });
      if (cust.membership.status === 'cancelled') return sendJSON(res, 400, { error: 'This membership is cancelled.' });
      cust.membership.status = 'active';
      cust.membership.paymentStatus = 'paid';
      const renewal = new Date(); renewal.setMonth(renewal.getMonth() + 1);
      cust.membership.renewalDate = renewal.toISOString().slice(0, 10);
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true, membership: cust.membership });
    });
  }

  // POST /api/admin/membership/cancel  { customerId }
  if (req.method === 'POST' && url.pathname === '/api/admin/membership/cancel') {
    const { customerId } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const cust = fresh.customers.find((c) => c.id === customerId);
      if (!cust || !cust.membership) return sendJSON(res, 404, { error: 'No membership found for this customer.' });
      cust.membership.status = 'cancelled';
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true, membership: cust.membership });
    });
  }

  // POST /api/admin/bookings/status  { id, status }  — mark completed or no-show
  if (req.method === 'POST' && url.pathname === '/api/admin/bookings/status') {
    const { id, status } = await readBody(req);
    if (!['completed', 'no-show'].includes(status)) {
      return sendJSON(res, 400, { error: 'status must be completed or no-show.' });
    }
    return withLock(() => {
      const fresh = loadDB();
      const b = fresh.bookings.find((x) => x.id === id);
      if (!b) return sendJSON(res, 404, { error: 'Booking not found.' });
      if (b.status === 'cancelled') return sendJSON(res, 400, { error: 'Cannot update a cancelled booking.' });
      if (b.status === 'completed' || b.status === 'no-show') {
        return sendJSON(res, 400, { error: `Booking is already ${b.status}.` });
      }
      b.status = status;
      // Award loyalty points: 1 pt per $1 when completed, only for linked customer accounts
      if (status === 'completed' && b.customerId) {
        const customer = fresh.customers.find((c) => c.id === b.customerId);
        if (customer) {
          const pts = Math.floor(b.price || 0);
          customer.points = (customer.points || 0) + pts;
          b.loyaltyPoints = pts;
          // Award referral bonus on referred customer's first completed booking
          if (customer.referredBy && !customer.referralClaimed) {
            const prevCompleted = fresh.bookings.filter((bk) => bk.customerId === customer.id && bk.status === 'completed' && bk.id !== b.id).length;
            if (prevCompleted === 0) {
              customer.referralClaimed = true;
              customer.points = (customer.points || 0) + 100;
              b.refereeBonus = 100;
              const referrer = fresh.customers.find((c) => c.id === customer.referredBy);
              if (referrer) { referrer.points = (referrer.points || 0) + 200; b.referrerBonus = 200; }
            }
          }
        }
      }
      saveDB(fresh);
      audit(req, 'booking.status', { id: b.id, ref: b.ref, status, prev: b.status });
      return sendJSON(res, 200, { booking: b });
    });
  }

  // --- Referrals ---

  // GET /api/referral  — get (or generate) the logged-in customer's referral code + stats
  if (req.method === 'GET' && url.pathname === '/api/referral') {
    const sess = getSession(req);
    if (!sess) return sendJSON(res, 401, { error: 'Please log in.' });
    return withLock(() => {
      const fresh = loadDB();
      const cust = fresh.customers.find((c) => c.id === sess.customerId);
      if (!cust) return sendJSON(res, 404, { error: 'Customer not found.' });
      if (!cust.referralCode) {
        cust.referralCode = 'LUM-' + crypto.randomBytes(3).toString('hex').toUpperCase();
        saveDB(fresh);
      }
      const referred = fresh.customers.filter((c) => c.referredBy === cust.id);
      return sendJSON(res, 200, {
        referralCode: cust.referralCode,
        totalReferred: referred.length,
        claimedReferrals: referred.filter((c) => c.referralClaimed).length,
        pendingReferrals: referred.filter((c) => !c.referralClaimed).length
      });
    });
  }

  // GET /api/admin/referrals  — list all referrals
  if (req.method === 'GET' && url.pathname === '/api/admin/referrals') {
    const referrals = (db.customers || [])
      .filter((c) => c.referredBy)
      .map((c) => {
        const referrer = (db.customers || []).find((r) => r.id === c.referredBy);
        return {
          referee: { id: c.id, name: c.name, phone: c.phone },
          referrer: referrer ? { id: referrer.id, name: referrer.name, phone: referrer.phone, referralCode: referrer.referralCode } : null,
          referralClaimed: c.referralClaimed || false,
          createdAt: c.createdAt
        };
      });
    return sendJSON(res, 200, { referrals });
  }

  // --- Marketing broadcasts + opt-out ---

  // POST /api/marketing/optout  — logged-in customer opts out
  if (req.method === 'POST' && url.pathname === '/api/marketing/optout') {
    const sess = getSession(req);
    if (!sess) return sendJSON(res, 401, { error: 'Please log in.' });
    return withLock(() => {
      const fresh = loadDB();
      const cust = fresh.customers.find((c) => c.id === sess.customerId);
      if (!cust) return sendJSON(res, 404, { error: 'Customer not found.' });
      cust.marketingOptOut = true;
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true });
    });
  }

  // POST /api/marketing/optin  — logged-in customer opts back in
  if (req.method === 'POST' && url.pathname === '/api/marketing/optin') {
    const sess = getSession(req);
    if (!sess) return sendJSON(res, 401, { error: 'Please log in.' });
    return withLock(() => {
      const fresh = loadDB();
      const cust = fresh.customers.find((c) => c.id === sess.customerId);
      if (!cust) return sendJSON(res, 404, { error: 'Customer not found.' });
      cust.marketingOptOut = false;
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true });
    });
  }

  // GET /api/marketing/optout?token=<base64url-customerId>  — one-click unsubscribe from email
  if (req.method === 'GET' && url.pathname === '/api/marketing/optout') {
    const token = url.searchParams.get('token');
    if (!token) return sendJSON(res, 400, { error: 'token is required.' });
    let custId;
    try { custId = Buffer.from(token, 'base64url').toString(); } catch { return sendJSON(res, 400, { error: 'Invalid token.' }); }
    return withLock(() => {
      const fresh = loadDB();
      const cust = fresh.customers.find((c) => c.id === custId);
      if (!cust) return sendJSON(res, 404, { error: 'Customer not found.' });
      cust.marketingOptOut = true;
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true, message: 'You have been unsubscribed from marketing emails.' });
    });
  }

  // POST /api/admin/broadcasts  { subject, message, channel? }  — create + queue broadcast
  if (req.method === 'POST' && url.pathname === '/api/admin/broadcasts') {
    const { subject, message, channel } = await readBody(req);
    if (!message || !String(message).trim()) return sendJSON(res, 400, { error: 'message is required.' });
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.broadcasts) fresh.broadcasts = [];
      const ch = ['email', 'sms', 'both'].includes(channel) ? channel : 'email';
      const broadcast = {
        id: crypto.randomBytes(6).toString('hex'),
        subject: String(subject || '').trim() || 'Message from Lumière',
        message: String(message).trim(),
        channel: ch,
        sentAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const eligible = (fresh.customers || []).filter((c) => c.verified && !c.marketingOptOut);
      let queued = 0;
      for (const c of eligible) {
        const sendEmail = ch === 'email' || ch === 'both';
        const sendSms = ch === 'sms' || ch === 'both';
        if (sendEmail && c.email) {
          const token = Buffer.from(c.id).toString('base64url');
          const body = broadcast.message.replace(/{name}/g, c.name.split(' ')[0]) +
            `\n\n---\nTo stop receiving marketing emails: ${baseUrl}/unsubscribe.html?token=${token}`;
          fresh.notifications.push({ id: crypto.randomBytes(4).toString('hex'), broadcastId: broadcast.id, to: c.email, toName: c.name, channel: 'email', type: 'broadcast', subject: broadcast.subject, message: body, status: 'scheduled', scheduledFor: new Date().toISOString() });
          queued++;
        }
        if (sendSms && c.phone) {
          fresh.notifications.push({ id: crypto.randomBytes(4).toString('hex'), broadcastId: broadcast.id, to: c.phone, toName: c.name, channel: 'sms', type: 'broadcast', subject: broadcast.subject, message: broadcast.message.replace(/{name}/g, c.name.split(' ')[0]), status: 'scheduled', scheduledFor: new Date().toISOString() });
          queued++;
        }
      }
      broadcast.recipientCount = queued;
      fresh.broadcasts.push(broadcast);
      saveDB(fresh);
      processNotifications();
      return sendJSON(res, 201, { ok: true, broadcast, queued });
    });
  }

  // GET /api/admin/broadcasts  — list all broadcasts
  if (req.method === 'GET' && url.pathname === '/api/admin/broadcasts') {
    const sorted = [...db.broadcasts].sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)));
    return sendJSON(res, 200, { broadcasts: sorted });
  }

  // POST /api/admin/bookings/deposit  { id }  — mark deposit as collected at salon
  if (req.method === 'POST' && url.pathname === '/api/admin/bookings/deposit') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const b = fresh.bookings.find((x) => x.id === id);
      if (!b) return sendJSON(res, 404, { error: 'Booking not found.' });
      if (b.depositStatus == null) return sendJSON(res, 400, { error: 'This booking does not require a deposit.' });
      b.depositStatus = 'collected';
      saveDB(fresh);
      return sendJSON(res, 200, { booking: b });
    });
  }

  // GET /api/stats — admin dashboard summary
  if (req.method === 'GET' && url.pathname === '/api/stats') {
    const active = db.bookings.filter((b) => b.status !== 'cancelled');
    const completed = db.bookings.filter((b) => b.status === 'completed');
    const projectedRevenue = active.reduce((sum, b) => sum + (b.price || 0), 0);
    const actualRevenue = completed.reduce((sum, b) => sum + (b.price || 0), 0);
    const totalPointsIssued = (db.customers || []).reduce((sum, c) => sum + (c.points || 0), 0);
    const byCategory = {};
    for (const b of active) {
      const svc = db.services.find((s) => s.id === b.serviceId);
      const cat = svc ? svc.category : 'other';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
    const byStaff = {};
    for (const b of active) byStaff[b.staffName] = (byStaff[b.staffName] || 0) + 1;
    // Package revenue is recognized when a purchase is paid (collected at salon); redeemed
    // visits are $0 bookings so they don't double-count toward projected/actual revenue.
    let packageRevenue = 0, packagesSold = 0;
    for (const c of (db.customers || [])) {
      for (const p of (c.packages || [])) {
        packagesSold += 1;
        if (p.paymentStatus === 'paid') packageRevenue += (p.price || 0);
      }
    }
    const reviewed = db.bookings.filter((b) => b.review);
    const totalReviews = reviewed.length;
    const avgRating = totalReviews
      ? Math.round((reviewed.reduce((s, b) => s + b.review.rating, 0) / totalReviews) * 10) / 10
      : null;

    // Revenue by month — last 6 calendar months (completed bookings)
    const revenueByMonth = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      revenueByMonth[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = 0;
    }
    for (const b of completed) {
      const key = (b.date || '').slice(0, 7);
      if (key in revenueByMonth) revenueByMonth[key] += (b.price || 0);
    }

    // Bookings per week — last 8 weeks (Mon–Sun), non-cancelled
    const bookingsByWeek = {};
    const thisMonday = new Date();
    thisMonday.setHours(0, 0, 0, 0);
    thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7));
    for (let w = 7; w >= 0; w--) {
      const ws = new Date(thisMonday);
      ws.setDate(thisMonday.getDate() - w * 7);
      bookingsByWeek[ws.toISOString().slice(0, 10)] = 0;
    }
    const weekKeys = Object.keys(bookingsByWeek).sort();
    for (const b of db.bookings.filter((x) => x.status !== 'cancelled')) {
      for (let i = 0; i < weekKeys.length; i++) {
        const ws = new Date(weekKeys[i] + 'T00:00:00');
        const we = new Date(ws); we.setDate(ws.getDate() + 7);
        const bd = new Date(b.date + 'T00:00:00');
        if (bd >= ws && bd < we) { bookingsByWeek[weekKeys[i]]++; break; }
      }
    }

    // Top 5 services by active booking count
    const svcCounts = {};
    for (const b of active) {
      if (!svcCounts[b.serviceId]) svcCounts[b.serviceId] = { name: b.serviceName, count: 0, revenue: 0 };
      svcCounts[b.serviceId].count++;
      svcCounts[b.serviceId].revenue += (b.price || 0);
    }
    const topServices = Object.values(svcCounts).sort((a, b) => b.count - a.count).slice(0, 5);

    return sendJSON(res, 200, {
      totalBookings: db.bookings.length,
      activeBookings: active.length,
      cancelled: db.bookings.length - active.length,
      projectedRevenue,
      actualRevenue,
      totalPointsIssued,
      packageRevenue,
      packagesSold,
      totalReviews,
      avgRating,
      byCategory,
      byStaff,
      revenueByMonth,
      bookingsByWeek,
      topServices,
    });
  }

  // ---- Reviews -------------------------------------------------------------

  // POST /api/reviews  { ref, rating, comment }
  // Open to anyone who holds the booking ref — no login required.
  if (req.method === 'POST' && url.pathname === '/api/reviews') {
    const { ref, rating, comment } = await readBody(req);
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return sendJSON(res, 400, { error: 'Rating must be an integer 1–5.' });
    }
    return withLock(() => {
      const fresh = loadDB();
      const b = fresh.bookings.find((x) => x.ref === String(ref || '').trim().toUpperCase());
      if (!b) return sendJSON(res, 404, { error: 'Booking not found.' });
      if (b.status !== 'completed') {
        return sendJSON(res, 400, { error: 'Reviews can only be submitted for completed visits.' });
      }
      if (b.review) return sendJSON(res, 409, { error: 'A review has already been submitted for this booking.' });
      b.review = {
        rating: r,
        comment: String(comment || '').slice(0, 500).trim() || null,
        submittedAt: new Date().toISOString()
      };
      saveDB(fresh);
      return sendJSON(res, 201, { ok: true, review: b.review });
    });
  }

  // GET /api/reviews?serviceId=  — public feed; optionally filtered by service
  if (req.method === 'GET' && url.pathname === '/api/reviews') {
    const sid = q.get('serviceId');
    const reviews = db.bookings
      .filter((b) => b.review && (!sid || b.serviceId === sid))
      .map((b) => ({
        ref: b.ref,
        serviceId: b.serviceId,
        serviceName: b.serviceName,
        staffName: b.staffName,
        rating: b.review.rating,
        comment: b.review.comment,
        submittedAt: b.review.submittedAt,
        customerFirstName: (b.customer.name || '').split(' ')[0]
      }))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return sendJSON(res, 200, { reviews });
  }

  // GET /api/admin/reviews — admin full feed (includes booking id + customer name)
  if (req.method === 'GET' && url.pathname === '/api/admin/reviews') {
    const reviews = db.bookings
      .filter((b) => b.review)
      .map((b) => ({
        bookingId: b.id, ref: b.ref,
        serviceId: b.serviceId, serviceName: b.serviceName, staffName: b.staffName,
        customerName: b.customer.name, customerPhone: b.customer.phone,
        rating: b.review.rating, comment: b.review.comment, submittedAt: b.review.submittedAt
      }))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return sendJSON(res, 200, { reviews });
  }

  // POST /api/admin/services/save  { service }  — create or update (upsert by id)
  if (req.method === 'POST' && url.pathname === '/api/admin/services/save') {
    const { service } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const err = validateService(service, fresh);
      if (err) return sendJSON(res, 400, { error: err });
      const clean = {
        category: service.category,
        name: String(service.name).trim().slice(0, 80),
        duration: Number(service.duration),
        price: Number(service.price),
        description: String(service.description || '').slice(0, 300),
        staffIds: service.staffIds.slice(),
        resourceId: service.resourceId || null,
        depositRequired: !!service.depositRequired
      };
      const existing = service.id && fresh.services.find((s) => s.id === service.id);
      if (existing) {
        Object.assign(existing, clean);
        saveDB(fresh);
        audit(req, 'service.update', { id: existing.id, name: existing.name });
        return sendJSON(res, 200, { ok: true, service: existing });
      }
      // create — derive a unique id from the name
      let id = slugify(clean.name) || 'service';
      let n = 2; while (fresh.services.some((s) => s.id === id)) id = slugify(clean.name) + '-' + n++;
      const created = Object.assign({ id }, clean);
      fresh.services.push(created);
      saveDB(fresh);
      audit(req, 'service.create', { id: created.id, name: created.name });
      return sendJSON(res, 201, { ok: true, service: created });
    });
  }

  // POST /api/admin/services/delete  { id }
  if (req.method === 'POST' && url.pathname === '/api/admin/services/delete') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const i = fresh.services.findIndex((s) => s.id === id);
      if (i === -1) return sendJSON(res, 404, { error: 'Service not found.' });
      const [removed] = fresh.services.splice(i, 1);
      saveDB(fresh);
      audit(req, 'service.delete', { id: removed.id, name: removed.name });
      // past bookings keep their own snapshot of name/price, so they're unaffected.
      return sendJSON(res, 200, { ok: true, removed: removed.id });
    });
  }

  // POST /api/admin/staff/save  { staff }  — create or update (upsert by id)
  if (req.method === 'POST' && url.pathname === '/api/admin/staff/save') {
    const { staff } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const err = validateStaff(staff) || validateSchedule(staff);
      if (err) return sendJSON(res, 400, { error: err });
      const clean = {
        name: String(staff.name).trim().slice(0, 60),
        title: String(staff.title || '').slice(0, 80),
        bio: String(staff.bio || '').slice(0, 400),
        specialties: (staff.specialties || []).map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 8)
      };
      // Persist optional scheduling fields when provided (validated above).
      if (staff.hours !== undefined) clean.hours = staff.hours;
      if (staff.timeOff !== undefined) clean.timeOff = staff.timeOff;
      if (staff.breaks !== undefined) clean.breaks = staff.breaks;
      if (staff.commissionPct !== undefined) {
        const cp = Number(staff.commissionPct);
        clean.commissionPct = Number.isFinite(cp) && cp >= 0 && cp <= 100 ? cp : 0;
      }
      const existing = staff.id && fresh.staff.find((p) => p.id === staff.id);
      if (existing) {
        Object.assign(existing, clean);
        saveDB(fresh);
        audit(req, 'staff.update', { id: existing.id, name: existing.name });
        return sendJSON(res, 200, { ok: true, staff: existing });
      }
      let id = slugify(clean.name) || 'artist';
      let n = 2; while (fresh.staff.some((p) => p.id === id)) id = slugify(clean.name) + '-' + n++;
      const created = Object.assign({ id }, clean);
      fresh.staff.push(created);
      saveDB(fresh);
      audit(req, 'staff.create', { id: created.id, name: created.name });
      return sendJSON(res, 201, { ok: true, staff: created });
    });
  }

  // POST /api/admin/staff/delete  { id }
  if (req.method === 'POST' && url.pathname === '/api/admin/staff/delete') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const i = fresh.staff.findIndex((p) => p.id === id);
      if (i === -1) return sendJSON(res, 404, { error: 'Artist not found.' });
      // Guard: don't orphan a service whose ONLY artist is this person.
      const wouldOrphan = fresh.services.filter((s) => s.staffIds.length === 1 && s.staffIds[0] === id);
      if (wouldOrphan.length) {
        return sendJSON(res, 409, { error: 'Reassign these services first: ' + wouldOrphan.map((s) => s.name).join(', ') + '.' });
      }
      fresh.services.forEach((s) => { s.staffIds = s.staffIds.filter((x) => x !== id); });
      const [removed] = fresh.staff.splice(i, 1);
      saveDB(fresh);
      audit(req, 'staff.delete', { id: removed.id, name: removed.name });
      return sendJSON(res, 200, { ok: true, removed: removed.id });
    });
  }

  // POST /api/admin/resources/save  { resource }  — create or update
  if (req.method === 'POST' && url.pathname === '/api/admin/resources/save') {
    const { resource } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.resources) fresh.resources = [];
      const err = validateResource(resource);
      if (err) return sendJSON(res, 400, { error: err });
      const clean = { name: String(resource.name).trim().slice(0, 60), capacity: Number(resource.capacity) };
      const existing = resource.id && fresh.resources.find((r) => r.id === resource.id);
      if (existing) { Object.assign(existing, clean); saveDB(fresh); return sendJSON(res, 200, { ok: true, resource: existing }); }
      let id = slugify(clean.name) || 'resource';
      let n = 2; while (fresh.resources.some((r) => r.id === id)) id = slugify(clean.name) + '-' + n++;
      const created = Object.assign({ id }, clean);
      fresh.resources.push(created);
      saveDB(fresh);
      return sendJSON(res, 201, { ok: true, resource: created });
    });
  }

  // POST /api/admin/resources/delete  { id }
  if (req.method === 'POST' && url.pathname === '/api/admin/resources/delete') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const inUse = fresh.services.filter((s) => s.resourceId === id);
      if (inUse.length) return sendJSON(res, 409, { error: 'In use by: ' + inUse.map((s) => s.name).join(', ') + '. Unassign it first.' });
      const i = (fresh.resources || []).findIndex((r) => r.id === id);
      if (i === -1) return sendJSON(res, 404, { error: 'Resource not found.' });
      fresh.resources.splice(i, 1);
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true });
    });
  }

  // POST /api/admin/packages/save  { package }  — create or update a package (upsert by id)
  if (req.method === 'POST' && url.pathname === '/api/admin/packages/save') {
    const body = await readBody(req);
    const pkg = body.package;
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.packages) fresh.packages = [];
      const err = validatePackage(pkg, fresh);
      if (err) return sendJSON(res, 400, { error: err });
      const clean = {
        name: String(pkg.name).trim().slice(0, 80),
        serviceId: pkg.serviceId,
        sessions: Number(pkg.sessions),
        price: Number(pkg.price),
        description: String(pkg.description || '').slice(0, 300),
        active: pkg.active !== false
      };
      const existing = pkg.id && fresh.packages.find((p) => p.id === pkg.id);
      if (existing) { Object.assign(existing, clean); saveDB(fresh); return sendJSON(res, 200, { ok: true, package: existing }); }
      let id = slugify(clean.name) || 'package';
      let n = 2; while (fresh.packages.some((p) => p.id === id)) id = slugify(clean.name) + '-' + n++;
      const created = Object.assign({ id }, clean);
      fresh.packages.push(created);
      saveDB(fresh);
      return sendJSON(res, 201, { ok: true, package: created });
    });
  }

  // POST /api/admin/packages/delete  { id }  — removes from the catalog. Already-purchased
  // balances are self-contained snapshots on the customer, so they're unaffected.
  if (req.method === 'POST' && url.pathname === '/api/admin/packages/delete') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const i = (fresh.packages || []).findIndex((p) => p.id === id);
      if (i === -1) return sendJSON(res, 404, { error: 'Package not found.' });
      fresh.packages.splice(i, 1);
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true });
    });
  }

  // POST /api/packages/buy  { packageId }  — purchase a package (logged-in customer).
  // Pay-at-salon: balance is created immediately with paymentStatus 'pending'.
  if (req.method === 'POST' && url.pathname === '/api/packages/buy') {
    const sess = getSession(req);
    if (!sess) return sendJSON(res, 401, { error: 'Please log in to buy a package.' });
    const { packageId } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const cust = (fresh.customers || []).find((c) => c.id === sess.customerId);
      if (!cust) return sendJSON(res, 401, { error: 'Not logged in.' });
      const pkg = (fresh.packages || []).find((p) => p.id === packageId && p.active !== false);
      if (!pkg) return sendJSON(res, 404, { error: 'Package not found.' });
      if (!cust.packages) cust.packages = [];
      const cp = {
        id: crypto.randomBytes(4).toString('hex'),
        packageId: pkg.id, name: pkg.name, serviceId: pkg.serviceId,
        total: pkg.sessions, remaining: pkg.sessions, price: pkg.price,
        purchasedAt: new Date().toISOString(), paymentStatus: 'pending'
      };
      cust.packages.push(cp);
      saveDB(fresh);
      return sendJSON(res, 201, { ok: true, package: cp });
    });
  }

  // GET /api/admin/customer-packages — every purchased package across all customers (admin)
  if (req.method === 'GET' && url.pathname === '/api/admin/customer-packages') {
    const list = [];
    (db.customers || []).forEach((c) => (c.packages || []).forEach((p) =>
      list.push(Object.assign({}, p, { customerId: c.id, customerName: c.name, customerPhone: c.phone }))));
    list.sort((a, b) => String(b.purchasedAt).localeCompare(String(a.purchasedAt)));
    return sendJSON(res, 200, { packages: list });
  }

  // POST /api/admin/packages/markpaid  { customerId, customerPackageId }  — collected at salon
  if (req.method === 'POST' && url.pathname === '/api/admin/packages/markpaid') {
    const { customerId, customerPackageId } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const cust = (fresh.customers || []).find((c) => c.id === customerId);
      if (!cust) return sendJSON(res, 404, { error: 'Customer not found.' });
      const cp = (cust.packages || []).find((p) => p.id === customerPackageId);
      if (!cp) return sendJSON(res, 404, { error: 'Package purchase not found.' });
      cp.paymentStatus = 'paid';
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true, package: cp });
    });
  }

  // ---- Gift cards ----------------------------------------------------------
  // Cards are issued by admin (sold at the counter / as promos), optionally paid at
  // the register (paymentStatus: 'pending' → 'paid'), then redeemable by anyone who
  // knows the code at booking time. Balance remainder is paid at the salon.

  // POST /api/admin/giftcards/issue  { amount, issuedTo?, note? }  — create a card
  if (req.method === 'POST' && url.pathname === '/api/admin/giftcards/issue') {
    const { amount, issuedTo, note } = await readBody(req);
    const dollars = Number(amount);
    if (!dollars || dollars <= 0 || dollars > 10000) {
      return sendJSON(res, 400, { error: 'Amount must be a positive number up to $10,000.' });
    }
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.giftCards) fresh.giftCards = [];
      const card = {
        id: crypto.randomBytes(4).toString('hex'),
        code: uniqueGiftCode(fresh.giftCards),
        amount: dollars,
        balance: dollars,
        issuedTo: String(issuedTo || '').slice(0, 80) || null,
        note: String(note || '').slice(0, 200) || null,
        status: 'active',          // active | depleted | void
        paymentStatus: 'pending',  // pending | paid
        redemptions: [],
        refunds: [],
        issuedAt: new Date().toISOString()
      };
      fresh.giftCards.push(card);
      saveDB(fresh);
      return sendJSON(res, 201, { ok: true, giftCard: card });
    });
  }

  // POST /api/admin/giftcards/markpaid  { id }  — mark the card's purchase as collected
  if (req.method === 'POST' && url.pathname === '/api/admin/giftcards/markpaid') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const card = (fresh.giftCards || []).find((c) => c.id === id);
      if (!card) return sendJSON(res, 404, { error: 'Gift card not found.' });
      if (card.status === 'void') return sendJSON(res, 400, { error: 'Cannot mark a voided card as paid.' });
      card.paymentStatus = 'paid';
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true, giftCard: card });
    });
  }

  // POST /api/admin/giftcards/void  { id }  — deactivate a card (lost / fraud)
  if (req.method === 'POST' && url.pathname === '/api/admin/giftcards/void') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const card = (fresh.giftCards || []).find((c) => c.id === id);
      if (!card) return sendJSON(res, 404, { error: 'Gift card not found.' });
      if (card.status === 'void') return sendJSON(res, 400, { error: 'Already voided.' });
      card.status = 'void';
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true, giftCard: card });
    });
  }

  // GET /api/admin/giftcards — full list (admin)
  if (req.method === 'GET' && url.pathname === '/api/admin/giftcards') {
    const cards = [...(db.giftCards || [])].sort((a, b) =>
      String(b.issuedAt).localeCompare(String(a.issuedAt)));
    return sendJSON(res, 200, { giftCards: cards });
  }

  // GET /api/giftcards/lookup?code=LUM-GIFT-XXXX-XXXX — public balance check
  if (req.method === 'GET' && url.pathname === '/api/giftcards/lookup') {
    const code = normalizeGiftCode(q.get('code') || '');
    if (!code) return sendJSON(res, 400, { error: 'code required.' });
    const card = (db.giftCards || []).find((c) => c.code === code);
    if (!card) return sendJSON(res, 404, { error: 'Gift card not found.' });
    // Only expose public fields — no issuedTo, note, or redemption history
    return sendJSON(res, 200, {
      code: card.code, balance: card.balance, status: card.status,
      paymentStatus: card.paymentStatus, amount: card.amount
    });
  }

  // GET /api/blockoffs — list (admin)
  if (req.method === 'GET' && url.pathname === '/api/blockoffs') {
    const sorted = [...db.blockoffs].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    return sendJSON(res, 200, { blockoffs: sorted });
  }

  // POST /api/admin/blockoffs/save  { blockoff }
  if (req.method === 'POST' && url.pathname === '/api/admin/blockoffs/save') {
    const { blockoff } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.blockoffs) fresh.blockoffs = [];
      const err = validateBlockoff(blockoff, fresh);
      if (err) return sendJSON(res, 400, { error: err });
      const created = {
        id: crypto.randomBytes(4).toString('hex'),
        staffId: blockoff.staffId,
        staffName: (fresh.staff.find((p) => p.id === blockoff.staffId) || {}).name || blockoff.staffId,
        date: blockoff.date,
        start: blockoff.start,
        end: blockoff.end,
        reason: String(blockoff.reason || '').slice(0, 120)
      };
      fresh.blockoffs.push(created);
      saveDB(fresh);
      return sendJSON(res, 201, { ok: true, blockoff: created });
    });
  }

  // POST /api/admin/blockoffs/delete  { id }
  if (req.method === 'POST' && url.pathname === '/api/admin/blockoffs/delete') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const i = (fresh.blockoffs || []).findIndex((b) => b.id === id);
      if (i === -1) return sendJSON(res, 404, { error: 'Block-off not found.' });
      fresh.blockoffs.splice(i, 1);
      saveDB(fresh);
      return sendJSON(res, 200, { ok: true });
    });
  }

  // POST /api/register  { name, phone, email } -> creates an unverified account, sends OTP
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const data = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.customers) fresh.customers = [];
      const err = validateRegister(data);
      if (err) return sendJSON(res, 400, { error: err });
      const key = normalizePhone(data.phone);
      let cust = fresh.customers.find((c) => c.phone === key);
      if (cust && cust.verified) return sendJSON(res, 409, { error: 'That phone is already registered — please log in.' });
      if (!cust) {
        cust = { id: crypto.randomBytes(4).toString('hex'), phone: key, name: '', email: '', verified: false, points: 0, favoriteStaffId: null, createdAt: new Date().toISOString(), referralCode: 'LUM-' + crypto.randomBytes(3).toString('hex').toUpperCase() };
        fresh.customers.push(cust);
      }
      cust.name = String(data.name).trim().slice(0, 80);
      cust.email = String(data.email || '').slice(0, 120);
      if (data.referralCode && !cust.referredBy) {
        const refCode = String(data.referralCode).trim().toUpperCase();
        const referrer = fresh.customers.find((c) => c.referralCode === refCode && c.id !== cust.id);
        if (referrer) cust.referredBy = referrer.id;
      }
      saveDB(fresh);
      const code = genOtp(key);
      // DEV: code returned in the response until real SMS is wired in M5. Do NOT ship this.
      return sendJSON(res, 201, { ok: true, devCode: code, message: 'We texted you a 6-digit code.' });
    });
  }

  // POST /api/verify  { phone, code } -> marks verified, auto-links past guest bookings
  if (req.method === 'POST' && url.pathname === '/api/verify') {
    const { phone, code } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.customers) fresh.customers = [];
      const key = normalizePhone(phone);
      const rec = _otps.get(key);
      if (!rec || Date.now() > rec.expiresAt) return sendJSON(res, 400, { error: 'Code expired — request a new one.' });
      rec.attempts += 1;
      if (rec.attempts > 5) { _otps.delete(key); return sendJSON(res, 429, { error: 'Too many attempts. Request a new code.' }); }
      if (String(code) !== rec.code) return sendJSON(res, 400, { error: 'Incorrect code. Try again.' });
      _otps.delete(key);
      const cust = fresh.customers.find((c) => c.phone === key);
      if (!cust) return sendJSON(res, 404, { error: 'No pending registration for that number.' });
      cust.verified = true;
      let linked = 0;
      fresh.bookings.forEach((b) => {
        if (normalizePhone(b.customer.phone) === key && !b.customerId) { b.customerId = cust.id; linked += 1; }
      });
      saveDB(fresh);
      setSessionCookie(res, createSession(cust.id)); // log them in straight after verifying
      return sendJSON(res, 200, { ok: true, customer: { id: cust.id, name: cust.name, phone: cust.phone, email: cust.email, points: cust.points }, linkedBookings: linked });
    });
  }

  // POST /api/otp  { phone } -> send a login code to an existing verified account
  if (req.method === 'POST' && url.pathname === '/api/otp') {
    const { phone } = await readBody(req);
    const key = normalizePhone(phone);
    const cust = (db.customers || []).find((c) => c.phone === key && c.verified);
    if (!cust) return sendJSON(res, 404, { error: 'No account found for that number — please sign up.' });
    const code = genOtp(key);
    return sendJSON(res, 200, { ok: true, devCode: code, message: 'We texted you a code.' });
  }

  // POST /api/login  { phone, code } -> verify OTP, open a session
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const { phone, code } = await readBody(req);
    const key = normalizePhone(phone);
    const rec = _otps.get(key);
    if (!rec || Date.now() > rec.expiresAt) return sendJSON(res, 400, { error: 'Code expired — request a new one.' });
    rec.attempts += 1;
    if (rec.attempts > 5) { _otps.delete(key); return sendJSON(res, 429, { error: 'Too many attempts. Request a new code.' }); }
    if (String(code) !== rec.code) return sendJSON(res, 400, { error: 'Incorrect code. Try again.' });
    _otps.delete(key);
    const cust = (db.customers || []).find((c) => c.phone === key && c.verified);
    if (!cust) return sendJSON(res, 404, { error: 'No account found.' });
    setSessionCookie(res, createSession(cust.id));
    return sendJSON(res, 200, { ok: true, customer: { id: cust.id, name: cust.name, phone: cust.phone, email: cust.email, points: cust.points } });
  }

  // POST /api/logout
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    clearSessionCookie(req, res);
    return sendJSON(res, 200, { ok: true });
  }

  // GET /api/me -> current customer + their bookings
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const sess = getSession(req);
    if (!sess) return sendJSON(res, 401, { error: 'Not logged in.' });
    const cust = (db.customers || []).find((c) => c.id === sess.customerId);
    if (!cust) return sendJSON(res, 401, { error: 'Not logged in.' });
    const mine = db.bookings
      .filter((b) => b.customerId === cust.id)
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    return sendJSON(res, 200, {
      customer: { id: cust.id, name: cust.name, phone: cust.phone, email: cust.email, points: cust.points, favoriteStaffId: cust.favoriteStaffId, packages: cust.packages || [], membership: cust.membership || null, marketingOptOut: cust.marketingOptOut || false },
      bookings: mine
    });
  }

  // PATCH /api/me — update profile (name, email, birthday)
  if (req.method === 'PATCH' && url.pathname === '/api/me') {
    const sess = getSession(req);
    if (!sess) return sendJSON(res, 401, { error: 'Please log in.' });
    const { name, email, birthday } = await readBody(req);
    const trimName     = typeof name     === 'string' ? name.trim()     : null;
    const trimEmail    = typeof email    === 'string' ? email.trim()    : null;
    const trimBirthday = typeof birthday === 'string' ? birthday.trim() : null;
    if (trimName !== null && trimName.length < 2) return sendJSON(res, 400, { error: 'Name must be at least 2 characters.' });
    if (trimEmail !== null && trimEmail.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail)) {
      return sendJSON(res, 400, { error: 'Invalid email address.' });
    }
    if (trimBirthday !== null && trimBirthday !== '' && !/^\d{2}-\d{2}$/.test(trimBirthday)) {
      return sendJSON(res, 400, { error: 'birthday must be MM-DD format.' });
    }
    return withLock(() => {
      const fresh = loadDB();
      const cust = (fresh.customers || []).find((c) => c.id === sess.customerId);
      if (!cust) return sendJSON(res, 401, { error: 'Not logged in.' });
      if (trimName     !== null) cust.name     = trimName;
      if (trimEmail    !== null) cust.email    = trimEmail;
      if (trimBirthday !== null) cust.birthday = trimBirthday || null;
      saveDB(fresh);
      audit(req, 'profile.update', { id: cust.id, name: cust.name });
      return sendJSON(res, 200, { ok: true, customer: { name: cust.name, email: cust.email, birthday: cust.birthday || null } });
    });
  }

  // --- Tips + Commission ---

  // POST /api/admin/bookings/tip { id, tipAmount } — record/update tip on a completed booking
  if (req.method === 'POST' && url.pathname === '/api/admin/bookings/tip') {
    const { id, tipAmount } = await readBody(req);
    const amount = Number(tipAmount);
    if (!Number.isFinite(amount) || amount < 0) return sendJSON(res, 400, { error: 'tipAmount must be a non-negative number.' });
    return withLock(() => {
      const fresh = loadDB();
      const b = fresh.bookings.find((x) => x.id === id);
      if (!b) return sendJSON(res, 404, { error: 'Booking not found.' });
      if (b.status !== 'completed') return sendJSON(res, 400, { error: 'Tips can only be recorded on completed bookings.' });
      b.tip = Math.round(amount * 100) / 100;
      saveDB(fresh);
      audit(req, 'tip.record', { id: b.id, ref: b.ref, tip: b.tip });
      return sendJSON(res, 200, { ok: true, booking: { id: b.id, ref: b.ref, tip: b.tip } });
    });
  }

  // GET /api/admin/tips — list completed bookings that have a tip recorded
  if (req.method === 'GET' && url.pathname === '/api/admin/tips') {
    const tips = (db.bookings || [])
      .filter((b) => b.status === 'completed' && (b.tip || 0) > 0)
      .map((b) => ({
        id: b.id, ref: b.ref, date: b.date, time: b.time,
        serviceName: b.serviceName, staffId: b.staffId, staffName: b.staffName,
        price: b.price, tip: b.tip,
        customer: b.customer ? { name: b.customer.name } : null
      }))
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    return sendJSON(res, 200, { tips });
  }

  // GET /api/admin/commissions?from=YYYY-MM-DD&to=YYYY-MM-DD — per-staff commission summary
  if (req.method === 'GET' && url.pathname === '/api/admin/commissions') {
    const from = q.get('from') || '';
    const to = q.get('to') || '';
    const completed = (db.bookings || []).filter((b) => {
      if (b.status !== 'completed') return false;
      if (from && b.date < from) return false;
      if (to && b.date > to) return false;
      return true;
    });
    const staffMap = {};
    for (const s of (db.staff || [])) {
      staffMap[s.id] = {
        staffId: s.id, staffName: s.name,
        commissionPct: s.commissionPct || 0,
        completedBookings: 0, serviceRevenue: 0,
        commissionEarned: 0, tipsEarned: 0, totalEarnings: 0
      };
    }
    for (const b of completed) {
      if (!staffMap[b.staffId]) continue;
      const row = staffMap[b.staffId];
      row.completedBookings++;
      row.serviceRevenue = Math.round((row.serviceRevenue + (b.price || 0)) * 100) / 100;
      row.tipsEarned = Math.round((row.tipsEarned + (b.tip || 0)) * 100) / 100;
    }
    for (const row of Object.values(staffMap)) {
      row.commissionEarned = Math.round(row.serviceRevenue * row.commissionPct) / 100;
      row.totalEarnings = Math.round((row.commissionEarned + row.tipsEarned) * 100) / 100;
      row.avgTicket = row.completedBookings > 0
        ? Math.round((row.serviceRevenue / row.completedBookings) * 100) / 100 : 0;
    }
    const commissions = Object.values(staffMap).sort((a, b) => a.staffName.localeCompare(b.staffName));
    return sendJSON(res, 200, { commissions, from, to });
  }

  // GET /api/admin/customers?q=&lapsed=N — customer CRM list with booking stats
  // lapsed=N filters to customers whose last completed visit was >= N days ago (or never visited)
  if (req.method === 'GET' && url.pathname === '/api/admin/customers') {
    const search = (q.get('q') || '').toLowerCase().trim();
    const lapsedDays = parseInt(q.get('lapsed') || '0', 10);
    const bookings = db.bookings || [];
    const custList = (db.customers || []).map((c) => {
      const myBookings = bookings.filter((b) => b.customerId === c.id);
      const completed = myBookings.filter((b) => b.status === 'completed');
      const upcoming = myBookings.filter((b) => b.status === 'confirmed');
      const lastVisit = completed.sort((a, b) => b.date.localeCompare(a.date))[0];
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email || '',
        points: c.points || 0,
        totalBookings: myBookings.length,
        completedVisits: completed.length,
        upcomingCount: upcoming.length,
        lastVisit: lastVisit ? lastVisit.date : null,
        totalSpent: Math.round(completed.reduce((s, b) => s + (b.price || 0), 0) * 100) / 100,
        marketingOptOut: c.marketingOptOut || false,
        birthday: c.birthday || null,
        membership: c.membership ? { planName: c.membership.planName, status: c.membership.status } : null,
        createdAt: c.createdAt || null,
      };
    });
    let filtered = search
      ? custList.filter((c) =>
          c.name.toLowerCase().includes(search) ||
          c.phone.includes(search) ||
          c.email.toLowerCase().includes(search)
        )
      : custList;
    if (lapsedDays > 0) {
      const cutoff = new Date(); cutoff.setMinutes(cutoff.getMinutes() - cutoff.getTimezoneOffset());
      cutoff.setDate(cutoff.getDate() - lapsedDays);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      filtered = filtered.filter((c) => !c.lastVisit || c.lastVisit < cutoffStr);
      filtered = filtered.filter((c) => c.upcomingCount === 0);  // skip those with upcoming bookings
    }
    filtered.sort((a, b) => (b.lastVisit || '').localeCompare(a.lastVisit || '') || a.name.localeCompare(b.name));
    return sendJSON(res, 200, { customers: filtered, total: filtered.length, lapsedDays: lapsedDays || null });
  }

  // GET /api/admin/customers/:id/bookings — full booking history for one customer
  if (req.method === 'GET' && /^\/api\/admin\/customers\/[^/]+\/bookings$/.test(url.pathname)) {
    const custId = url.pathname.split('/')[4];
    const cust = (db.customers || []).find((c) => c.id === custId);
    if (!cust) return sendJSON(res, 404, { error: 'Customer not found.' });
    const myBookings = (db.bookings || [])
      .filter((b) => b.customerId === custId)
      .sort((a, b) => b.date.localeCompare(a.date));
    return sendJSON(res, 200, { customer: { id: cust.id, name: cust.name, phone: cust.phone, email: cust.email, points: cust.points, birthday: cust.birthday || null, adminNotes: cust.adminNotes || '' }, bookings: myBookings });
  }

  // POST /api/admin/customers/:id/points { delta, reason } — manual points adjustment
  if (req.method === 'POST' && /^\/api\/admin\/customers\/[^/]+\/points$/.test(url.pathname)) {
    const custId = url.pathname.split('/')[4];
    const { delta, reason } = await readBody(req);
    const d = Math.round(Number(delta) || 0);
    if (d === 0) return sendJSON(res, 400, { error: 'delta must be a non-zero integer.' });
    return withLock(() => {
      const fresh = loadDB();
      const cust = (fresh.customers || []).find((c) => c.id === custId);
      if (!cust) return sendJSON(res, 404, { error: 'Customer not found.' });
      const before = cust.points || 0;
      cust.points = Math.max(0, before + d);
      saveDB(fresh);
      audit(req, 'points.adjust', { customerId: cust.id, name: cust.name, delta: d, before, after: cust.points, reason: reason || '' });
      return sendJSON(res, 200, { ok: true, customerId: cust.id, points: cust.points, delta: d });
    });
  }

  // PATCH /api/admin/customers/:id/notes { notes } — save freeform customer notes
  if (req.method === 'PATCH' && /^\/api\/admin\/customers\/[^/]+\/notes$/.test(url.pathname)) {
    const custId = url.pathname.split('/')[4];
    const { notes } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const cust = (fresh.customers || []).find((c) => c.id === custId);
      if (!cust) return sendJSON(res, 404, { error: 'Customer not found.' });
      cust.adminNotes = typeof notes === 'string' ? notes.trim() : '';
      saveDB(fresh);
      audit(req, 'customer.notes', { customerId: cust.id, name: cust.name });
      return sendJSON(res, 200, { ok: true });
    });
  }

  // --- Retail store + inventory ---

  // GET /api/admin/products — list all products with stock status
  if (req.method === 'GET' && url.pathname === '/api/admin/products') {
    const products = (db.products || []).map((p) => ({
      ...p, lowStock: p.stock <= (p.lowStockThreshold ?? 5)
    }));
    return sendJSON(res, 200, { products });
  }

  // POST /api/admin/products/save { product: { id?, name, category?, price, stock, lowStockThreshold? } }
  if (req.method === 'POST' && url.pathname === '/api/admin/products/save') {
    const { product: prod } = await readBody(req);
    if (!prod || !String(prod.name || '').trim()) return sendJSON(res, 400, { error: 'name is required.' });
    const price = Number(prod.price);
    if (!Number.isFinite(price) || price < 0) return sendJSON(res, 400, { error: 'price must be a non-negative number.' });
    const stock = Math.max(0, Math.round(Number(prod.stock) || 0));
    const threshold = Math.max(0, Math.round(Number(prod.lowStockThreshold ?? 5)));
    return withLock(() => {
      const fresh = loadDB();
      if (!fresh.products) fresh.products = [];
      let product, status;
      if (prod.id) {
        product = fresh.products.find((p) => p.id === prod.id);
        if (!product) return sendJSON(res, 404, { error: 'Product not found.' });
        product.name = String(prod.name).trim();
        product.category = String(prod.category || '').trim() || 'General';
        product.description = String(prod.description || '').trim();
        product.price = price;
        product.sku = String(prod.sku || '').trim();
        product.stock = stock;
        product.lowStockThreshold = threshold;
        status = 200;
      } else {
        product = {
          id: crypto.randomBytes(4).toString('hex'),
          name: String(prod.name).trim(),
          category: String(prod.category || '').trim() || 'General',
          description: String(prod.description || '').trim(),
          price,
          sku: String(prod.sku || '').trim(),
          stock,
          lowStockThreshold: threshold,
          createdAt: new Date().toISOString()
        };
        fresh.products.push(product);
        status = 201;
      }
      saveDB(fresh);
      audit(req, status === 201 ? 'product.create' : 'product.update', { id: product.id, name: product.name });
      return sendJSON(res, status, { product: { ...product, lowStock: product.stock <= product.lowStockThreshold } });
    });
  }

  // POST /api/admin/products/delete { id }
  if (req.method === 'POST' && url.pathname === '/api/admin/products/delete') {
    const { id } = await readBody(req);
    return withLock(() => {
      const fresh = loadDB();
      const idx = (fresh.products || []).findIndex((p) => p.id === id);
      if (idx < 0) return sendJSON(res, 404, { error: 'Product not found.' });
      const [removed] = fresh.products.splice(idx, 1);
      saveDB(fresh);
      audit(req, 'product.delete', { id: removed.id, name: removed.name });
      return sendJSON(res, 200, { ok: true });
    });
  }

  // POST /api/admin/products/adjust { id, delta, reason? } — manual stock adjustment (+/-)
  if (req.method === 'POST' && url.pathname === '/api/admin/products/adjust') {
    const { id, delta, reason } = await readBody(req);
    const d = Math.round(Number(delta) || 0);
    if (!d) return sendJSON(res, 400, { error: 'delta must be a non-zero integer.' });
    return withLock(() => {
      const fresh = loadDB();
      const product = (fresh.products || []).find((p) => p.id === id);
      if (!product) return sendJSON(res, 404, { error: 'Product not found.' });
      product.stock = Math.max(0, (product.stock || 0) + d);
      saveDB(fresh);
      return sendJSON(res, 200, { product: { ...product, lowStock: product.stock <= (product.lowStockThreshold ?? 5) } });
    });
  }

  // POST /api/admin/sales { productId, quantity, staffId?, note? } — record a retail sale
  if (req.method === 'POST' && url.pathname === '/api/admin/sales') {
    const { productId, quantity, staffId, note } = await readBody(req);
    const qty = Math.round(Number(quantity) || 0);
    if (!productId) return sendJSON(res, 400, { error: 'productId is required.' });
    if (qty < 1) return sendJSON(res, 400, { error: 'quantity must be at least 1.' });
    return withLock(() => {
      const fresh = loadDB();
      const product = (fresh.products || []).find((p) => p.id === productId);
      if (!product) return sendJSON(res, 404, { error: 'Product not found.' });
      if (product.stock < qty) return sendJSON(res, 409, { error: `Only ${product.stock} in stock.` });
      product.stock -= qty;
      if (!fresh.productSales) fresh.productSales = [];
      const sale = {
        id: crypto.randomBytes(6).toString('hex'),
        productId,
        productName: product.name,
        unitPrice: product.price,
        quantity: qty,
        total: Math.round(product.price * qty * 100) / 100,
        staffId: staffId || null,
        note: String(note || '').trim() || null,
        soldAt: new Date().toISOString()
      };
      fresh.productSales.push(sale);
      saveDB(fresh);
      audit(req, 'sale.record', { id: sale.id, productId, productName: product.name, quantity: qty, total: sale.total });
      return sendJSON(res, 201, { sale, product: { ...product, lowStock: product.stock <= (product.lowStockThreshold ?? 5) } });
    });
  }

  // GET /api/admin/sales — list product sales, newest first
  if (req.method === 'GET' && url.pathname === '/api/admin/sales') {
    const sales = [...(db.productSales || [])].sort((a, b) => String(b.soldAt).localeCompare(String(a.soldAt)));
    return sendJSON(res, 200, { sales });
  }

  // GET /api/admin/products/low-stock — products at or below their threshold
  if (req.method === 'GET' && url.pathname === '/api/admin/products/low-stock') {
    const low = (db.products || [])
      .filter((p) => p.stock <= (p.lowStockThreshold ?? 5))
      .map((p) => ({ ...p, lowStock: true }));
    return sendJSON(res, 200, { products: low });
  }

  // GET /api/admin/reports/daily?date=YYYY-MM-DD — daily appointment sheet
  if (req.method === 'GET' && url.pathname === '/api/admin/reports/daily') {
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const bookings = (db.bookings || [])
      .filter(b => b.date === date && b.status !== 'cancelled')
      .sort((a, b) => a.time.localeCompare(b.time));
    const cfg = db.config || {};
    const staffMap = Object.fromEntries((cfg.staff || []).map(s => [s.id, s.name]));
    const svcMap = Object.fromEntries((cfg.services || []).map(s => [s.id, { name: s.name, duration: s.duration }]));
    const rows = bookings.map(b => ({
      ref: b.ref,
      time: b.time,
      serviceName: b.serviceName || (svcMap[b.serviceId] || {}).name || b.serviceId,
      staffName: b.staffName || staffMap[b.staffId] || b.staffId,
      customerName: b.customer ? b.customer.name : '—',
      customerPhone: b.customer ? b.customer.phone : '',
      price: b.price || 0,
      tip: b.tip || 0,
      status: b.status,
      notes: b.customer ? (b.customer.notes || '') : ''
    }));
    const byStaff = {};
    rows.forEach(r => {
      if (!byStaff[r.staffName]) byStaff[r.staffName] = [];
      byStaff[r.staffName].push(r);
    });
    const revenue = rows.filter(r => r.status === 'completed').reduce((s, r) => s + (r.price || 0), 0);
    const tips = rows.filter(r => r.status === 'completed').reduce((s, r) => s + (r.tip || 0), 0);
    return sendJSON(res, 200, { date, rows, byStaff, summary: { total: rows.length, revenue, tips } });
  }

  // GET /api/admin/reports/revenue?from=&to= — revenue export (CSV-ready)
  if (req.method === 'GET' && url.pathname === '/api/admin/reports/revenue') {
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const bookings = (db.bookings || []).filter(b => {
      if (b.status !== 'completed') return false;
      if (from && b.date < from) return false;
      if (to && b.date > to) return false;
      return true;
    }).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    const rows = bookings.map(b => ({
      date: b.date, time: b.time, ref: b.ref,
      service: b.serviceName || b.serviceId,
      staff: b.staffName || b.staffId,
      customer: b.customer ? b.customer.name : '',
      phone: b.customer ? b.customer.phone : '',
      price: b.price || 0,
      tip: b.tip || 0,
      total: (b.price || 0) + (b.tip || 0)
    }));
    const totals = { revenue: rows.reduce((s,r)=>s+r.price,0), tips: rows.reduce((s,r)=>s+r.tip,0), total: rows.reduce((s,r)=>s+r.total,0), count: rows.length };
    if (url.searchParams.get('format') === 'csv') {
      const header = 'Date,Time,Ref,Service,Artist,Customer,Phone,Price,Tip,Total\r\n';
      const csv = rows.map(r => [r.date,r.time,r.ref,r.service,r.staff,r.customer,r.phone,r.price.toFixed(2),r.tip.toFixed(2),r.total.toFixed(2)].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="revenue-${from||'all'}-${to||'all'}.csv"`, 'Cache-Control': 'no-store' });
      return res.end(header + csv);
    }
    return sendJSON(res, 200, { rows, totals, from, to });
  }

  // GET /api/admin/schedule/week?date=YYYY-MM-DD — 7-day week view for staff calendar
  if (req.method === 'GET' && url.pathname === '/api/admin/schedule/week') {
    const raw = q.get('date') || new Date().toISOString().slice(0, 10);
    const anchor = new Date(raw + 'T12:00:00Z');
    const dow = anchor.getUTCDay(); // 0=Sun
    const monday = new Date(anchor); monday.setUTCDate(anchor.getUTCDate() - ((dow + 6) % 7));
    const days = [];
    const staffMap = {}; (db.staff || []).forEach(s => { staffMap[s.id] = s.name; });
    const svcMap = {}; (db.services || []).forEach(s => { svcMap[s.id] = s.name; });
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setUTCDate(monday.getUTCDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const label = DAYS[d.getUTCDay()];
      const bookings = (db.bookings || [])
        .filter(b => b.date === dateStr && b.status !== 'cancelled')
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
        .map(b => ({
          id: b.id, ref: b.ref, time: b.time || '', date: b.date, status: b.status,
          staffId: b.staffId, staffName: staffMap[b.staffId] || 'Unassigned',
          serviceId: b.serviceId, serviceName: svcMap[b.serviceId] || b.service || '',
          customer: b.customerName || '', phone: b.customerPhone || '',
          price: b.price || 0, notes: b.notes || '',
          duration: b.duration || 60,
        }));
      days.push({ date: dateStr, label, bookings });
    }
    return sendJSON(res, 200, { days, weekStart: monday.toISOString().slice(0, 10) });
  }

  // GET /api/admin/reports/chart?days=N — daily revenue + booking counts for chart
  if (req.method === 'GET' && url.pathname === '/api/admin/reports/chart') {
    const days = Math.min(90, Math.max(7, parseInt(q.get('days') || '30', 10)));
    const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    const todayStr = today.toISOString().slice(0, 10);
    const startDate = new Date(today); startDate.setDate(startDate.getDate() - (days - 1));
    const startStr = startDate.toISOString().slice(0, 10);
    const byDate = {};
    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      byDate[d.toISOString().slice(0, 10)] = { revenue: 0, tips: 0, bookings: 0 };
    }
    (db.bookings || []).forEach((b) => {
      if (b.status !== 'completed') return;
      if (b.date < startStr || b.date > todayStr) return;
      if (!byDate[b.date]) return;
      byDate[b.date].revenue = Math.round((byDate[b.date].revenue + (b.price || 0)) * 100) / 100;
      byDate[b.date].tips = Math.round((byDate[b.date].tips + (b.tip || 0)) * 100) / 100;
      byDate[b.date].bookings += 1;
    });
    const points = Object.entries(byDate).map(([date, v]) => ({ date, ...v, total: Math.round((v.revenue + v.tips) * 100) / 100 }));
    return sendJSON(res, 200, { points, days });
  }

  // POST /api/admin/backup — trigger a manual backup immediately
  if (req.method === 'POST' && url.pathname === '/api/admin/backup') {
    runBackup();
    const files = fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('db-') && f.endsWith('.json')).sort()
      : [];
    return sendJSON(res, 200, { ok: true, backups: files });
  }

  // GET /api/admin/backups — list available backups
  if (req.method === 'GET' && url.pathname === '/api/admin/backups') {
    const files = fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('db-') && f.endsWith('.json')).sort().reverse()
      : [];
    return sendJSON(res, 200, { backups: files });
  }

  // GET /api/admin/audit?limit=N — tail of audit log, newest first
  if (req.method === 'GET' && url.pathname === '/api/admin/audit') {
    const limit = Math.min(200, Math.max(1, parseInt(q.get('limit') || '50', 10)));
    if (!fs.existsSync(AUDIT_FILE)) return sendJSON(res, 200, { entries: [] });
    const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const tail = lines.slice(-limit).reverse();
    const entries = tail.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return sendJSON(res, 200, { entries });
  }

  // PATCH /api/admin/salon — update salon contact info, tagline, social links
  if (req.method === 'PATCH' && url.pathname === '/api/admin/salon') {
    const body = await readBody(req);
    const ALLOWED = ['name', 'tagline', 'phone', 'email', 'address', 'city', 'region', 'country', 'postalCode', 'instagram', 'facebook'];
    const updates = {};
    for (const k of ALLOWED) {
      if (typeof body[k] === 'string') updates[k] = body[k].trim();
    }
    if (!updates.name || updates.name.length < 2) return sendJSON(res, 400, { error: 'Salon name is required.' });
    return withLock(() => {
      const fresh = loadDB();
      Object.assign(fresh.salon, updates);
      saveDB(fresh);
      audit(req, 'admin.salon.update', updates);
      return sendJSON(res, 200, { ok: true, salon: fresh.salon });
    });
  }

  // PATCH /api/admin/home-sections — show/hide homepage sections + gallery preview count
  if (req.method === 'PATCH' && url.pathname === '/api/admin/home-sections') {
    const HOME_SECTION_KEYS = ['valueProps', 'services', 'trust', 'team', 'gallery', 'testimonials', 'visit', 'cta'];
    const body = await readBody(req);
    const sections = {};
    const src = body.sections && typeof body.sections === 'object' ? body.sections : {};
    for (const k of HOME_SECTION_KEYS) sections[k] = src[k] !== false;  // default visible
    const count = Math.max(1, Math.min(24, parseInt(body.galleryPreviewCount, 10) || 8));
    return withLock(() => {
      const fresh = loadDB();
      fresh.salon.homeSections = sections;
      fresh.salon.galleryPreviewCount = count;
      saveDB(fresh);
      audit(req, 'admin.home-sections.update', { hidden: HOME_SECTION_KEYS.filter((k) => !sections[k]), galleryPreviewCount: count });
      return sendJSON(res, 200, { ok: true, homeSections: sections, galleryPreviewCount: count });
    });
  }

  return sendJSON(res, 404, { error: 'Unknown API route.' });
}

// ---- Server --------------------------------------------------------------
const server = http.createServer((req, res) => {
  const _t0 = Date.now();
  const _ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '-';
  res.on('finish', () => {
    process.stdout.write(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} ${Date.now() - _t0}ms ${_ip}\n`);
  });

  setSecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Rate-limit mutating API calls per client IP.
  if (url.pathname.startsWith('/api/') && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) {
      return sendJSON(res, 429, { error: 'Too many requests — please slow down and try again shortly.' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/robots.txt') {
    const body = `User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /account.html\nDisallow: /api/\n\nSitemap: ${reqBase(req)}/sitemap.xml\n`;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    res.end(body);
  } else if (req.method === 'GET' && url.pathname === '/sitemap.xml') {
    const base  = reqBase(req);
    const today = new Date().toISOString().slice(0, 10);
    const pages = [
      { loc: '/',              freq: 'weekly',  pri: '1.0' },
      { loc: '/services.html', freq: 'weekly',  pri: '0.9' },
      { loc: '/booking.html',  freq: 'monthly', pri: '0.8' },
      { loc: '/gallery.html',  freq: 'monthly', pri: '0.7' },
      { loc: '/team.html',     freq: 'monthly', pri: '0.6' },
      { loc: '/reviews.html',  freq: 'weekly',  pri: '0.6' },
      { loc: '/location.html', freq: 'monthly', pri: '0.6' },
      { loc: '/faq.html',      freq: 'monthly', pri: '0.5' },
      { loc: '/giftcard.html', freq: 'monthly', pri: '0.5' },
      { loc: '/privacy.html',     freq: 'yearly',  pri: '0.3' },
      { loc: '/terms.html',       freq: 'yearly',  pri: '0.3' },
      { loc: '/sms-consent.html', freq: 'yearly',  pri: '0.3' },
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      pages.map(p => `  <url><loc>${base}${p.loc}</loc><lastmod>${today}</lastmod><changefreq>${p.freq}</changefreq><priority>${p.pri}</priority></url>`).join('\n')
    }\n</urlset>\n`;
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    res.end(xml);
  } else if (url.pathname.startsWith('/api/')) {
    handleAPI(req, res, url).catch((e) => {
      console.error(e);
      sendJSON(res, 500, { error: 'Server error.' });
    });
  } else {
    serveStatic(req, res);
  }
});

// Fail fast with a clear message if the data files are missing/corrupt,
// rather than crashing on the first request.
try {
  loadDB();
} catch (e) {
  console.error('\n  FATAL: could not load data store (data/seed.json or db.json is invalid JSON).');
  console.error('  ' + e.message + '\n');
  process.exit(1);
}

// ---- Birthday bonus scheduler -----------------------------------------------
const BIRTHDAY_BONUS_PTS = 200;
function processBirthdayBonuses() {
  try {
    const db = loadDB();
    const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    const todayStr = today.toISOString().slice(0, 10);   // YYYY-MM-DD
    const todayMMDD = todayStr.slice(5);                  // MM-DD
    const thisYear = todayStr.slice(0, 4);
    let changed = false;
    (db.customers || []).forEach((c) => {
      if (!c.birthday || c.birthday !== todayMMDD) return;
      if (c.lastBirthdayBonus === thisYear) return;  // already awarded this year
      c.points = (c.points || 0) + BIRTHDAY_BONUS_PTS;
      c.lastBirthdayBonus = thisYear;
      changed = true;
      if (!db.notifications) db.notifications = [];
      const toAddr = c.email || '';
      if (toAddr && process.env.SMTP_HOST) {
        db.notifications.push({
          id: crypto.randomBytes(4).toString('hex'),
          to: toAddr, toName: c.name, channel: 'email', type: 'birthday',
          subject: `Happy birthday, ${c.name.split(' ')[0]}! 🎉 — Lumière`,
          message: `Hi ${c.name.split(' ')[0]},\n\nWishing you a wonderful birthday! We've added ${BIRTHDAY_BONUS_PTS} bonus reward points to your account as a birthday gift.\n\nCome celebrate with us — book your visit at any time.\n\nWith love,\nLumière Beauty & Nail Studio`,
          status: 'scheduled', scheduledFor: new Date().toISOString()
        });
      }
      process.stdout.write(`[birthday] Awarded ${BIRTHDAY_BONUS_PTS} pts to ${c.name}\n`);
    });
    if (changed) saveDB(db);
  } catch (e) {
    process.stderr.write(`[birthday] ERROR: ${e.message}\n`);
  }
}

server.listen(PORT, () => {
  console.log(`\n  Lumière Studio running →  http://localhost:${PORT}\n`);
  // Run notification delivery immediately, then every 60 s
  processNotifications();
  setInterval(processNotifications, 60000);
  // Run birthday bonuses once at startup, then every 24 h
  processBirthdayBonuses();
  setInterval(processBirthdayBonuses, 24 * 60 * 60 * 1000);
  // Run db backup on startup then every 24 h
  scheduleDailyBackup();
});
