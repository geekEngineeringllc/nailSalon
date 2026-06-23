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

async function renderChrome() {
  const cfg = window.__CFG__ || (window.__CFG__ = await api.config());
  const page = location.pathname.split('/').pop() || 'index.html';

  const header = document.getElementById('site-header');
  if (header) {
    const meRes = await api.me();
    const cust = meRes.ok ? meRes.data.customer : null;
    const authLink = cust
      ? `<li><a href="account.html" class="${page === 'account.html' ? 'active' : ''}">${t('nav.hi', esc(cust.name.split(' ')[0]))}</a></li>`
      : `<li><a href="login.html" class="${page === 'login.html' ? 'active' : ''}">${t('nav.login')}</a></li>`;
    header.innerHTML = `
      <a class="skip-link" href="#main-content">Skip to main content</a>
      <div class="container nav">
        <a class="brand" href="index.html">Lumière<span>.</span></a>
        <button class="nav-toggle" aria-label="${t('nav.menu')}">☰</button>
        <ul class="nav-links">
          ${NAV.map(([h, k]) => `<li><a href="${h}" class="${h === page ? 'active' : ''}">${t(k)}</a></li>`).join('')}
          ${authLink}
          <li><a class="btn btn-primary btn-sm" href="booking.html">${t('nav.book-now')}</a></li>
        </ul>
      </div>`;
    const toggle = header.querySelector('.nav-toggle');
    toggle.addEventListener('click', () => header.querySelector('.nav-links').classList.toggle('open'));
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
        </div>
        <div>
          <h4>${t('footer.hours')}</h4>
          ${s.hours.map(h => `<div class="hours-row"><span>${h.day}</span><span>${h.open}–${h.close}</span></div>`).join('')}
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getFullYear()} ${s.name}. ${t('footer.crafted')}</span>
        <span style="margin-left:auto;display:flex;gap:1.2rem;flex-wrap:wrap">
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
}

document.addEventListener('DOMContentLoaded', renderChrome);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
