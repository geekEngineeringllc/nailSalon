// Shared site chrome: header + footer, fetched config, small helpers.
const api = {
  async config() { return (await fetch('/api/config')).json(); },
  async availability(serviceIds, staffId, date) {
    const ids = Array.isArray(serviceIds) ? serviceIds.join(',') : serviceIds;
    const u = new URL('/api/availability', location.origin);
    u.searchParams.set('serviceIds', ids);
    u.searchParams.set('staffId', staffId || 'any');
    u.searchParams.set('date', date);
    return (await fetch(u)).json();
  },
  async book(payload) {
    const r = await fetch('/api/bookings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async bookRecurring(payload) {
    const r = await fetch('/api/bookings/recurring', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async bookGroup(payload) {
    const r = await fetch('/api/bookings/group', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async bookings(params) {
    const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params) : '';
    return (await fetch('/api/bookings' + qs)).json();
  },
  async stats() { return (await fetch('/api/stats')).json(); },
  async notifications() { return (await fetch('/api/notifications')).json(); },
  async cancel(id) {
    const r = await fetch('/api/bookings/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async adminCancel(id) {
    const r = await fetch('/api/admin/bookings/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async lookup(ref, phone) {
    const r = await fetch('/api/bookings/lookup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, phone })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async reschedule(id, date, time) {
    const r = await fetch('/api/bookings/reschedule', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, date, time })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async saveService(service) {
    const r = await fetch('/api/admin/services/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async deleteService(id) {
    const r = await fetch('/api/admin/services/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async saveStaff(staff) {
    const r = await fetch('/api/admin/staff/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async deleteStaff(id) {
    const r = await fetch('/api/admin/staff/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async blockoffs() { return (await fetch('/api/blockoffs')).json(); },
  async saveBlockoff(blockoff) {
    const r = await fetch('/api/admin/blockoffs/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockoff })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async deleteBlockoff(id) {
    const r = await fetch('/api/admin/blockoffs/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async saveResource(resource) {
    const r = await fetch('/api/admin/resources/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async deleteResource(id) {
    const r = await fetch('/api/admin/resources/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async collectDeposit(id) {
    const r = await fetch('/api/admin/bookings/deposit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async setBookingStatus(id, status) {
    const r = await fetch('/api/admin/bookings/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async register(payload) {
    const r = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async verify(phone, code) {
    const r = await fetch('/api/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async requestOtp(phone) {
    const r = await fetch('/api/otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async login(phone, code) {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async giftCardLookup(code) {
    const r = await fetch('/api/giftcards/lookup?code=' + encodeURIComponent(code));
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async issueGiftCard(amount, issuedTo, note) {
    const r = await fetch('/api/admin/giftcards/issue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, issuedTo, note })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async markGiftCardPaid(id) {
    const r = await fetch('/api/admin/giftcards/markpaid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async voidGiftCard(id) {
    const r = await fetch('/api/admin/giftcards/void', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async adminGiftCards() { return (await fetch('/api/admin/giftcards')).json(); },
  async submitReview(ref, rating, comment) {
    const r = await fetch('/api/reviews', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, rating, comment })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async reviews(serviceId) {
    const u = new URL('/api/reviews', location.origin);
    if (serviceId) u.searchParams.set('serviceId', serviceId);
    return (await fetch(u)).json();
  },
  async adminReviews() { return (await fetch('/api/admin/reviews')).json(); },
  async savePackage(pkg) {
    const r = await fetch('/api/admin/packages/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: pkg })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async deletePackage(id) {
    const r = await fetch('/api/admin/packages/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async adminCustomerPackages() { return (await fetch('/api/admin/customer-packages')).json(); },
  async markPackagePaid(customerId, customerPackageId) {
    const r = await fetch('/api/admin/packages/markpaid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId, customerPackageId })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async buyPackage(packageId) {
    const r = await fetch('/api/packages/buy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async saveMembershipPlan(plan) {
    const r = await fetch('/api/admin/membership-plans/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async deleteMembershipPlan(id) {
    const r = await fetch('/api/admin/membership-plans/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async adminMembers() { return (await fetch('/api/admin/members')).json(); },
  async subscribeMembership(planId) {
    const r = await fetch('/api/membership/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async markMembershipPaid(customerId) {
    const r = await fetch('/api/admin/membership/markpaid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async cancelMembership(customerId) {
    const r = await fetch('/api/admin/membership/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async myReferral() { return (await fetch('/api/referral')).json(); },
  async adminReferrals() { return (await fetch('/api/admin/referrals')).json(); },
  async updateProfile(payload) { const r = await fetch('/api/me', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }); return { ok: r.ok, status: r.status, data: await r.json() }; },
  async updateSalon(payload) { const r = await fetch('/api/admin/salon', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }); return { ok: r.ok, status: r.status, data: await r.json() }; },
  async updateHomeSections(payload) { const r = await fetch('/api/admin/home-sections', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }); return { ok: r.ok, status: r.status, data: await r.json() }; },
  async marketingOptout() { const r = await fetch('/api/marketing/optout', { method: 'POST' }); return { ok: r.ok, status: r.status, data: await r.json() }; },
  async marketingOptin() { const r = await fetch('/api/marketing/optin', { method: 'POST' }); return { ok: r.ok, status: r.status, data: await r.json() }; },
  async adminBroadcasts() { return (await fetch('/api/admin/broadcasts')).json(); },
  async sendBroadcast(payload) { const r = await fetch('/api/admin/broadcasts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return { ok: r.ok, status: r.status, data: await r.json() }; },
  async joinWaitlist(entry) {
    const r = await fetch('/api/waitlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async adminWaitlist() { return (await fetch('/api/waitlist')).json(); },
  async dismissWaitlist(id) {
    const r = await fetch('/api/admin/waitlist/dismiss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  },
  async logout() { return (await fetch('/api/logout', { method: 'POST' })).json(); },
  async me() {
    const r = await fetch('/api/me');
    return { ok: r.ok, status: r.status, data: r.ok ? await r.json() : null };
  },
  async adminProducts() { return (await fetch('/api/admin/products')).json(); },
  async saveProduct(product) { const r = await fetch('/api/admin/products/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product }) }); return { ok: r.ok, status: r.status, data: await r.json() }; },
  async deleteProduct(id) { const r = await fetch('/api/admin/products/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); return { ok: r.ok, status: r.status, data: await r.json() }; },
  async adjustStock(id, delta, reason) { const r = await fetch('/api/admin/products/adjust', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, delta, reason }) }); return { ok: r.ok, status: r.status, data: await r.json() }; },
  async adminSales() { return (await fetch('/api/admin/sales')).json(); },
  async recordSale(payload) { const r = await fetch('/api/admin/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return { ok: r.ok, status: r.status, data: await r.json() }; },
  async lowStockProducts() { return (await fetch('/api/admin/products/low-stock')).json(); },
  async recordTip(id, tipAmount) { const r = await fetch('/api/admin/bookings/tip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, tipAmount }) }); return { ok: r.ok, status: r.status, data: await r.json() }; },
  async adminTips() { return (await fetch('/api/admin/tips')).json(); },
  async adminCommissions(from, to) { const qs = new URLSearchParams({}); if (from) qs.set('from', from); if (to) qs.set('to', to); return (await fetch('/api/admin/commissions?' + qs)).json(); },
  async dailyReport(date) { const qs = date ? '?date=' + date : ''; return (await fetch('/api/admin/reports/daily' + qs)).json(); },
  async revenueReport(from, to, csv) { const p = new URLSearchParams(); if (from) p.set('from', from); if (to) p.set('to', to); if (csv) p.set('format', 'csv'); return fetch('/api/admin/reports/revenue?' + p); },
  async auditLog(limit) { const qs = limit ? '?limit=' + limit : ''; return (await fetch('/api/admin/audit' + qs)).json(); },
  async galleryItems() { return (await fetch('/api/gallery')).json(); },
  async saveGalleryItem(item) { const r = await fetch('/api/admin/gallery/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item }) }); return { ok: r.ok, status: r.status, data: await r.json() }; },
  async deleteGalleryItem(id) { const r = await fetch('/api/admin/gallery/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); return { ok: r.ok, status: r.status, data: await r.json() }; }
};

const money = (n) => '$' + Number(n).toFixed(0);

// Escape user-supplied strings before interpolating into innerHTML (XSS guard).
// Use on EVERY value that originates from a customer (name, notes, phone, email, ref).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

// Keyboard support for div-based interactive tiles (.option, .slot) that act as
// buttons: Enter/Space triggers a click, matching native button behavior.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const el = e.target.closest && e.target.closest('.option, .slot');
  if (el) { e.preventDefault(); el.click(); }
});

// Move keyboard focus to the first heading of a freshly rendered panel so screen
// readers announce the new step/state and keyboard users land in the right place.
function focusPanelHeading(container) {
  const h = (container || document).querySelector('h2, h3');
  if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
}

// ---- i18n -------------------------------------------------------------------
const LOCALES = {
  en: {
    'nav.home': 'Home', 'nav.services': 'Services', 'nav.gallery': 'Gallery',
    'nav.team': 'Team', 'nav.reviews': 'Reviews', 'nav.manage': 'Manage', 'nav.admin': 'Admin',
    'nav.login': 'Log in', 'nav.book-now': 'Book Now', 'nav.hi': 'Hi, {0}', 'nav.menu': 'Menu',
    'footer.visit': 'Visit', 'footer.hours': 'Hours',
    'footer.tagline-ext': 'Walk in for a touch-up, book ahead for the full experience.',
    'footer.book': 'Book an appointment', 'footer.crafted': 'Crafted with care.',
    'footer.privacy': 'Privacy Policy', 'footer.terms': 'Terms of Service', 'footer.sms': 'SMS Policy',
    'lang.switch': 'Español',
    'cta.book-my': 'Book my appointment', 'fab.book': 'Book now', 'action.call': 'Call',
    'theme.dark': 'Dark', 'theme.light': 'Light', 'theme.toggle': 'Toggle dark / light theme',
  },
  es: {
    'nav.home': 'Inicio', 'nav.services': 'Servicios', 'nav.gallery': 'Galería',
    'nav.team': 'Equipo', 'nav.reviews': 'Reseñas', 'nav.manage': 'Mi cita', 'nav.admin': 'Admin',
    'nav.login': 'Ingresar', 'nav.book-now': 'Reservar', 'nav.hi': 'Hola, {0}', 'nav.menu': 'Menú',
    'footer.visit': 'Visítanos', 'footer.hours': 'Horario',
    'footer.tagline-ext': 'Pasa sin cita o reserva con anticipación.',
    'footer.book': 'Reservar una cita', 'footer.crafted': 'Hecho con cariño.',
    'footer.privacy': 'Privacidad', 'footer.terms': 'Términos', 'footer.sms': 'Política SMS',
    'lang.switch': 'English',
    'cta.book-my': 'Reservar mi cita', 'fab.book': 'Reservar', 'action.call': 'Llamar',
    'theme.dark': 'Oscuro', 'theme.light': 'Claro', 'theme.toggle': 'Cambiar tema claro / oscuro',
  },
};
(function () {
  function detectLang() {
    try {
      const q = new URLSearchParams(location.search).get('lang');
      if (q && LOCALES[q]) { localStorage.setItem('lumiere_lang', q); return q; }
      const s = localStorage.getItem('lumiere_lang');
      if (s && LOCALES[s]) return s;
    } catch {}
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return LOCALES[nav] ? nav : 'en';
  }
  window.__LANG__ = detectLang();
  const _dict = Object.assign({}, LOCALES.en, LOCALES[window.__LANG__] || {});
  window.t = function (key, ...args) {
    const str = _dict[key] !== undefined ? _dict[key] : key;
    return str.replace(/\{(\d+)\}/g, (_, i) => args[+i] !== undefined ? String(args[+i]) : '{' + i + '}');
  };
})();

const NAV = [
  ['index.html', 'nav.home'],
  ['services.html', 'nav.services'],
  ['gallery.html', 'nav.gallery'],
  ['team.html', 'nav.team'],
  ['reviews.html', 'nav.reviews'],
  ['manage.html', 'nav.manage'],
  ['admin.html', 'nav.admin'],
];

// ---- Theme (light / dark) ---------------------------------------------------
// The effective theme is set before paint by a tiny inline <head> snippet on each
// page (reads localStorage, else prefers-color-scheme) to avoid a flash. Here we
// expose the toggle and keep any toggle buttons in sync.
function currentTheme() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark' || explicit === 'light') return explicit;
  try { if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'; } catch {}
  return 'light';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('lumiere_theme', theme); } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#1b1618' : '#b0657a');
  document.querySelectorAll('[data-theme-toggle]').forEach(syncThemeToggle);
}
function toggleTheme() { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); }
window.toggleTheme = toggleTheme;
function syncThemeToggle(btn) {
  const dark = currentTheme() === 'dark';
  btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  btn.setAttribute('aria-label', t('theme.toggle'));
  btn.innerHTML = dark ? '☀️ <span>' + t('theme.light') + '</span>' : '🌙 <span>' + t('theme.dark') + '</span>';
}
function wireThemeToggles(root) {
  (root || document).querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    if (btn._wired) return;
    btn._wired = true;
    btn.addEventListener('click', toggleTheme);
    syncThemeToggle(btn);
  });
}

// ---- Motion: prefers-reduced-motion + scroll-reveal ------------------------
function prefersReducedMotion() {
  try { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
let _revealIO;
// Reveals any [data-reveal] element on scroll. Re-callable: pages that render
// content dynamically should call window.revealScan() after injecting markup.
function revealScan() {
  const els = document.querySelectorAll('[data-reveal]:not(.in)');
  if (!els.length) return;
  if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
    els.forEach((el) => el.classList.add('in'));
    return;
  }
  if (!_revealIO) {
    _revealIO = new IntersectionObserver((entries, obs) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  }
  els.forEach((el) => _revealIO.observe(el));
}
window.revealScan = revealScan;

// ---- Sticky-header shadow on scroll ----------------------------------------
function setupHeaderScroll() {
  const apply = () => {
    const h = document.getElementById('site-header');
    if (h) h.classList.toggle('scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', apply, { passive: true });
  apply();
}

// ---- Floating Book CTA + sticky mobile action bar --------------------------
const NO_BOOK_CTA = new Set([
  'booking.html', 'admin.html', 'account.html', 'login.html',
  'register.html', 'manage.html', 'review.html', 'offline.html', '404.html',
]);
function setupBookCta(cfg) {
  const page = location.pathname.split('/').pop() || 'index.html';
  if (NO_BOOK_CTA.has(page) || document.querySelector('.book-fab')) return;

  const fab = document.createElement('a');
  fab.href = 'booking.html';
  fab.className = 'book-fab';
  fab.setAttribute('aria-label', t('fab.book'));
  fab.innerHTML = '✦ ' + t('cta.book-my');
  document.body.appendChild(fab);

  const phone = ((cfg.salon && cfg.salon.phone) || '').replace(/\D/g, '');
  const bar = document.createElement('div');
  bar.className = 'mobile-bar';
  bar.innerHTML =
    `<a class="btn btn-primary" href="booking.html">${t('cta.book-my')}</a>` +
    (phone
      ? `<a class="btn btn-ghost" href="tel:${phone}">${t('action.call')}</a>`
      : `<a class="btn btn-ghost" href="services.html">${t('nav.services')}</a>`);
  document.body.appendChild(bar);

  const threshold = () => Math.max(360, window.innerHeight * 0.6);
  const reveal = () => {
    const show = window.scrollY > threshold();
    fab.classList.toggle('show', show);
    bar.classList.toggle('show', show);
    document.body.classList.toggle('has-mobile-bar', show);
  };
  window.addEventListener('scroll', reveal, { passive: true });
  reveal();
}

// Inline brand SVGs (Simple Icons paths) — fill: currentColor via .social-row svg
const SVG_INSTAGRAM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 1.17.054 1.805.249 2.227.415.56.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227a3.81 3.81 0 0 1-.896 1.382 3.744 3.744 0 0 1-1.379.896c-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421a3.716 3.716 0 0 1-1.379-.896 3.644 3.644 0 0 1-.9-1.381c-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.164 1.051-.36 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0-2.163c-3.259 0-3.667.014-4.947.072-1.277.058-2.148.261-2.913.558a5.898 5.898 0 0 0-2.126 1.384A5.86 5.86 0 0 0 .630 4.14C.333 4.905.131 5.776.072 7.053.014 8.333 0 8.741 0 12s.014 3.667.072 4.947c.058 1.277.261 2.148.558 2.913a5.898 5.898 0 0 0 1.384 2.126A5.86 5.86 0 0 0 4.14 23.37c.766.296 1.636.499 2.913.558C8.333 23.986 8.741 24 12 24s3.667-.014 4.947-.072c1.277-.059 2.148-.262 2.913-.558a5.898 5.898 0 0 0 2.126-1.384 5.86 5.86 0 0 0 1.384-2.126c.296-.765.499-1.636.558-2.913.058-1.28.072-1.688.072-4.947s-.014-3.667-.072-4.947c-.059-1.277-.262-2.148-.558-2.913a5.898 5.898 0 0 0-1.384-2.126A5.847 5.847 0 0 0 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>';
const SVG_FACEBOOK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647z"/></svg>';

async function renderChrome() {
  const cfg = window.__CFG__ || (window.__CFG__ = await api.config());
  const page = location.pathname.split('/').pop() || 'index.html';

  // Canonical URL — strip query params to prevent duplicate-content issues
  if (!document.querySelector('link[rel="canonical"]')) {
    const el = document.createElement('link');
    el.rel = 'canonical';
    el.href = location.origin + location.pathname;
    document.head.appendChild(el);
  }

  const header = document.getElementById('site-header');
  if (header) {
    const meRes = await api.me();
    const cust = meRes.ok ? meRes.data.customer : null;
    const authLink = cust
      ? `<li><a href="account.html" class="${page === 'account.html' ? 'active' : ''}"${page === 'account.html' ? ' aria-current="page"' : ''}>${t('nav.hi', esc(cust.name.split(' ')[0]))}</a></li>`
      : `<li><a href="login.html" class="${page === 'login.html' ? 'active' : ''}"${page === 'login.html' ? ' aria-current="page"' : ''}>${t('nav.login')}</a></li>`;
    header.innerHTML = `
      <a class="skip-link" href="#main-content">Skip to main content</a>
      <div class="container nav">
        <a class="brand" href="index.html">Lumière<span>.</span></a>
        <button class="nav-toggle" aria-label="${t('nav.menu')}" aria-expanded="false" aria-controls="primary-nav">☰</button>
        <ul class="nav-links" id="primary-nav">
          ${NAV.map(([h, k]) => `<li><a href="${h}" class="${h === page ? 'active' : ''}"${h === page ? ' aria-current="page"' : ''}>${t(k)}</a></li>`).join('')}
          ${authLink}
          <li><button type="button" class="theme-toggle" data-theme-toggle></button></li>
          <li><a class="btn btn-primary btn-sm" href="booking.html">${t('nav.book-now')}</a></li>
        </ul>
      </div>`;
    const toggle = header.querySelector('.nav-toggle');
    toggle.addEventListener('click', () => {
      const open = header.querySelector('.nav-links').classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  const footer = document.getElementById('site-footer');
  if (footer) {
    const s = cfg.salon;
    const langHref = '?lang=' + (window.__LANG__ === 'en' ? 'es' : 'en');
    footer.innerHTML = `
      <div class="container footer-grid">
        <div>
          <div class="brand" style="color:#fff">Lumière<span>.</span></div>
          <p style="max-width:22rem;color:#b3a59c">${s.tagline} ${t('footer.tagline-ext')}</p>
          <a class="btn btn-gold btn-sm" href="booking.html">${t('footer.book')}</a>
        </div>
        <div>
          <h4>${t('footer.visit')}</h4>
          <p style="font-size:.9rem"><a href="location.html" style="color:inherit;text-decoration:none">${esc(s.address)}</a></p>
          <p style="font-size:.9rem"><a href="tel:${(s.phone||'').replace(/\D/g,'')}" style="color:inherit;text-decoration:none">${esc(s.phone)}</a><br><a href="mailto:${esc(s.email)}" style="color:#b3a59c;text-decoration:none">${esc(s.email)}</a></p>
          ${(s.instagram || s.facebook) ? `<div class="social-row">${s.instagram ? `<a href="${esc(s.instagram)}" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${SVG_INSTAGRAM}</a>` : ''}${s.facebook ? `<a href="${esc(s.facebook)}" target="_blank" rel="noopener noreferrer" aria-label="Facebook">${SVG_FACEBOOK}</a>` : ''}</div>` : ''}
        </div>
        <div>
          <h4>${t('footer.hours')}</h4>
          ${s.hours.map(h => `<div class="hours-row"><span>${h.day}</span><span>${h.open}–${h.close}</span></div>`).join('')}
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getFullYear()} ${s.name}. ${t('footer.crafted')}</span>
        <span style="margin-left:auto;display:flex;gap:1.1rem;flex-wrap:wrap;align-items:center">
          <button type="button" class="theme-toggle" data-theme-toggle style="border-color:rgba(255,255,255,.35);color:#d7c7bd"></button>
          <a href="${langHref}" style="color:#b3a59c;text-decoration:none">${t('lang.switch')}</a>
          <a href="location.html" style="color:#b3a59c;text-decoration:none">Location</a>
          <a href="faq.html" style="color:#b3a59c;text-decoration:none">FAQ</a>
          <a href="giftcard.html" style="color:#b3a59c;text-decoration:none">Gift Cards</a>
          <a href="reviews.html" style="color:#b3a59c;text-decoration:none">Reviews</a>
          <a href="privacy.html" style="color:#b3a59c;text-decoration:none">${t('footer.privacy')}</a>
          <a href="terms.html" style="color:#b3a59c;text-decoration:none">${t('footer.terms')}</a>
          <a href="sms-consent.html" style="color:#b3a59c;text-decoration:none">${t('footer.sms')}</a>
        </span>
      </div>`;
  }

  wireThemeToggles();
  setupHeaderScroll();
  setupBookCta(cfg);
  revealScan();
}

document.addEventListener('DOMContentLoaded', renderChrome);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
