// Lumière acceptance + hardening test harness.  Run: node test.js
// Spins up the server, exercises the API, asserts SPEC §8 + M1 hardening, exits
// non-zero on any failure. No dependencies.

const cp = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3517; // dedicated test port
const base = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra != null ? '→ ' + JSON.stringify(extra) : ''); }
}

function req(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(base + p, {
      method,
      headers: Object.assign(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, headers || {})
    }, (x) => { let s = ''; x.on('data', c => s += c); x.on('end', () => resolve({ s: x.statusCode, h: x.headers, b: JSON.parse(s || '{}') })); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
function reqRaw(method, p) {
  return new Promise((resolve, reject) => {
    const r = http.request(base + p, { method }, (x) => {
      let s = ''; x.on('data', c => s += c); x.on('end', () => resolve({ s: x.statusCode, h: x.headers, body: s }));
    });
    r.on('error', reject); r.end();
  });
}
function waitHealthy(tries = 40) {
  return new Promise((resolve, reject) => {
    const tick = () => req('GET', '/api/health').then(() => resolve()).catch(() => {
      if (--tries <= 0) return reject(new Error('server never became healthy'));
      setTimeout(tick, 100);
    });
    tick();
  });
}

// Local calendar date `n` days from now ("YYYY-MM-DD"), matching the server's
// local-time date math. Used so recurring/group tests stay inside the booking window
// regardless of the wall clock.
function plusDays(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Pull the REAL esc() out of common.js and test it (don't reimplement).
function loadEsc() {
  const src = fs.readFileSync(path.join(__dirname, 'public/js/common.js'), 'utf8');
  const m = src.match(/function esc\(s\)\s*\{[\s\S]*?\n\}/);
  if (!m) throw new Error('esc() not found in common.js');
  return new Function(m[0] + '\nreturn esc;')();
}

(async () => {
  // Fresh datastore; high rate cap so the booking-heavy suite isn't throttled.
  try { fs.rmSync(path.join(__dirname, 'data/db.json')); } catch {}
  const srv = cp.spawn('node', ['server.js'], {
    cwd: __dirname, env: Object.assign({}, process.env, { PORT: String(PORT), RATE_MAX: '100000' })
  });
  let log = ''; srv.stderr.on('data', d => log += d);

  try {
    await waitHealthy();

    // --- SPEC §8 acceptance ---
    const cfg = (await req('GET', '/api/config')).b;
    ok('config: 15 services / 4 staff / 4 categories',
      cfg.services.length === 15 && cfg.staff.length === 4 && cfg.categories.length === 4,
      { svc: cfg.services.length, staff: cfg.staff.length, cat: cfg.categories.length });

    const day = '2026-09-01';
    const av = (await req('GET', `/api/availability?serviceId=gel-mani&staffId=lily&date=${day}`)).b;
    ok('availability returns slots', av.options[0].slots.length > 0);

    const first = av.options[0].slots[0];
    const bk = (await req('POST', '/api/bookings', { serviceId: 'gel-mani', staffId: 'lily', date: day, time: first, customer: { name: 'Test One', phone: '5551110001' } }));
    ok('booking happy path → 201 + ref', bk.s === 201 && /^LUM-/.test(bk.b.booking.ref), bk.b);
    const firstRef = bk.b.booking.ref;

    const dup = (await req('POST', '/api/bookings', { serviceId: 'gel-mani', staffId: 'lily', date: day, time: first, customer: { name: 'Dup', phone: '5550000000' } }));
    ok('double-book same slot → 409', dup.s === 409, dup.s);

    // buffer: gel-mani is 45min; booking 'first' blocks the next grid start
    const av2 = (await req('GET', `/api/availability?serviceId=gel-mani&staffId=lily&date=${day}`)).b.options[0].slots;
    ok('buffer respected (booked slot removed)', !av2.includes(first));

    const anyDay = '2026-09-02';
    const anyAv = (await req('GET', `/api/availability?serviceId=classic-mani&staffId=any&date=${anyDay}`)).b;
    const anyStaff = anyAv.options[0].staffId, anySlot = anyAv.options[0].slots[0];
    const anyBk = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: anyStaff, date: anyDay, time: anySlot, customer: { name: 'Any User', phone: '5552220002' } }));
    ok('"any available" books a real (non-any) artist', anyBk.s === 201 && anyBk.b.booking.staffId !== 'any');

    const lk = (await req('POST', '/api/bookings/lookup', { ref: bk.b.booking.ref, phone: '(555) 111-0001' }));
    ok('lookup matches with formatted phone', lk.s === 200 && lk.b.booking.id === bk.b.booking.id);
    const lkBad = (await req('POST', '/api/bookings/lookup', { ref: bk.b.booking.ref, phone: '5559999999' }));
    ok('lookup wrong phone → 404', lkBad.s === 404);

    const rsSlot = (await req('GET', `/api/availability?serviceId=gel-mani&staffId=lily&date=${day}`)).b.options[0].slots[2];
    const rs = (await req('POST', '/api/bookings/reschedule', { id: bk.b.booking.id, date: day, time: rsSlot }));
    const notifs = (await req('GET', '/api/notifications')).b.notifications;
    const reminders = notifs.filter(n => n.bookingId === bk.b.booking.id && n.type === 'reminder');
    ok('reschedule → 200 and exactly 1 reminder', rs.s === 200 && reminders.length === 1, reminders.length);
    ok('each booking yields 2 notifications', notifs.filter(n => n.bookingId === anyBk.b.booking.id).length === 2);

    const statsBefore = (await req('GET', '/api/stats')).b;
    await req('POST', '/api/bookings/cancel', { id: anyBk.b.booking.id });
    const statsAfter = (await req('GET', '/api/stats')).b;
    ok('cancel removes booking from active revenue',
      statsAfter.projectedRevenue === statsBefore.projectedRevenue - anyBk.b.booking.price &&
      statsAfter.activeBookings === statsBefore.activeBookings - 1);

    // --- M4.1 booking status model ---
    const statusBk = (await req('POST', '/api/bookings', { serviceId: 'gel-mani', staffId: 'lily', date: '2026-09-03', time: '10:00', customer: { name: 'Status Test', phone: '5550001111' } }));
    const statusId = statusBk.b.booking.id, statusPrice = statusBk.b.booking.price;
    const statsPreComplete = (await req('GET', '/api/stats')).b;
    const comp = (await req('POST', '/api/admin/bookings/status', { id: statusId, status: 'completed' }));
    ok('mark completed → 200 + status completed', comp.s === 200 && comp.b.booking.status === 'completed');
    const statsPostComplete = (await req('GET', '/api/stats')).b;
    ok('actualRevenue increases after completion',
      statsPostComplete.actualRevenue === statsPreComplete.actualRevenue + statusPrice);
    ok('bad status value → 400', (await req('POST', '/api/admin/bookings/status', { id: statusId, status: 'pending' })).s === 400);

    const noShowBk = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-09-04', time: '11:00', customer: { name: 'Ghost', phone: '5550002222' } }));
    const ns = (await req('POST', '/api/admin/bookings/status', { id: noShowBk.b.booking.id, status: 'no-show' }));
    ok('mark no-show → 200 + status no-show', ns.s === 200 && ns.b.booking.status === 'no-show');

    // --- M4.2 cancellation cutoff ---
    // Book far in future, then patch db.json to move it within 24h
    const cutoffBk = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-09-05', time: '12:00', customer: { name: 'Cutoff Test', phone: '5550003333' } }));
    const cutoffId = cutoffBk.b.booking.id;
    const dbPath = path.join(__dirname, 'data/db.json');
    const dbPatch = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const cutoffEntry = dbPatch.bookings.find(b => b.id === cutoffId);
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h from now
    cutoffEntry.date = soon.toISOString().slice(0, 10);
    cutoffEntry.time = soon.toISOString().slice(11, 16);
    fs.writeFileSync(dbPath, JSON.stringify(dbPatch, null, 2));
    const cutoffCancel = (await req('POST', '/api/bookings/cancel', { id: cutoffId }));
    ok('customer cancel within 24h → 409 + cutoff flag', cutoffCancel.s === 409 && cutoffCancel.b.cutoff === true, cutoffCancel.b);
    const adminCancelRes = (await req('POST', '/api/admin/bookings/cancel', { id: cutoffId }));
    ok('admin cancel bypasses 24h cutoff → 200', adminCancelRes.s === 200, adminCancelRes.b);

    // --- M4.3 multi-service bookings ---
    // classic-mani (30 min, $35) + gel-mani (45 min, $55) → 75 min, $90 for Lily (does both)
    const multiDay = '2026-09-08', multiTime = '09:00';
    const multiBk = (await req('POST', '/api/bookings', { services: ['classic-mani', 'gel-mani'], staffId: 'lily', date: multiDay, time: multiTime, customer: { name: 'Multi Test', phone: '5550004444' } }));
    ok('multi-service booking → 201 + combined price', multiBk.s === 201 && multiBk.b.booking.price === 70 && multiBk.b.booking.duration === 75, multiBk.b);
    ok('multi-service booking stores services[]', Array.isArray(multiBk.b.booking.services) && multiBk.b.booking.services.length === 2);
    // The combined slot (75 min + 10 buffer = 85 min) should block 09:00 through 10:30
    const afterMulti = (await req('GET', `/api/availability?serviceId=classic-mani&staffId=lily&date=${multiDay}`)).b.options[0].slots;
    ok('multi-service blocks combined duration — 09:00 and 09:30 gone', !afterMulti.includes('09:00') && !afterMulti.includes('09:30') && afterMulti.includes('10:30'), afterMulti.slice(0, 5));

    // --- M4.4 deposit flag ---
    // balayage has depositRequired:true in seed
    const depBk = (await req('POST', '/api/bookings', { services: ['balayage'], staffId: 'maya', date: '2026-09-09', time: '09:00', customer: { name: 'Deposit Test', phone: '5550005555' } }));
    ok('deposit-required service → depositStatus pending', depBk.s === 201 && depBk.b.booking.depositStatus === 'pending', depBk.b);
    const dep = (await req('POST', '/api/admin/bookings/deposit', { id: depBk.b.booking.id }));
    ok('mark deposit collected → depositStatus collected', dep.s === 200 && dep.b.booking.depositStatus === 'collected', dep.b);
    // non-deposit service gets null depositStatus
    const noDepBk = (await req('POST', '/api/bookings', { services: ['classic-mani'], staffId: 'ava', date: '2026-09-09', time: '09:00', customer: { name: 'No Dep', phone: '5550006666' } }));
    ok('no-deposit service → depositStatus null', noDepBk.s === 201 && noDepBk.b.booking.depositStatus === null, noDepBk.b);

    // --- M4.5 recurring series ---
    // All new bookings use 14:00 — a time no fixed-date test above occupies — so they
    // never collide with those regardless of what "today" is.
    const recStart = plusDays(35);
    const recRes = (await req('POST', '/api/bookings/recurring', { serviceId: 'blowout', staffId: 'maya', date: recStart, time: '14:00', customer: { name: 'Reg Ular', phone: '5550007777' }, cadence: 'biweekly', count: 3 }));
    ok('recurring → 201 + 3 booked', recRes.s === 201 && recRes.b.booked.length === 3, recRes.b);
    ok('recurring shares one seriesId', !!recRes.b.booked[0].seriesId && new Set(recRes.b.booked.map(b => b.seriesId)).size === 1);
    ok('recurring mints distinct refs', new Set(recRes.b.booked.map(b => b.ref)).size === recRes.b.booked.length);
    ok('recurring spaced 14 days apart', recRes.b.booked[1].date === plusDays(35 + 14) && recRes.b.booked[2].date === plusDays(35 + 28), recRes.b.booked.map(b => b.date));
    ok('recurring rejects "any" artist → 400', (await req('POST', '/api/bookings/recurring', { serviceId: 'blowout', staffId: 'any', date: recStart, time: '14:00', customer: { name: 'X', phone: '5551110000' }, cadence: 'weekly', count: 2 })).s === 400);
    ok('recurring rejects count < 2 → 400', (await req('POST', '/api/bookings/recurring', { serviceId: 'blowout', staffId: 'maya', date: recStart, time: '14:00', customer: { name: 'X', phone: '5551110000' }, cadence: 'weekly', count: 1 })).s === 400);
    // Pre-book the 2nd weekly occurrence's slot so the series has to skip it.
    await req('POST', '/api/bookings', { serviceId: 'blowout', staffId: 'ava', date: plusDays(36 + 7), time: '14:00', customer: { name: 'Blocker', phone: '5550008888' } });
    const recRes2 = (await req('POST', '/api/bookings/recurring', { serviceId: 'blowout', staffId: 'ava', date: plusDays(36), time: '14:00', customer: { name: 'Reg Two', phone: '5550009999' }, cadence: 'weekly', count: 3 }));
    ok('recurring skips an unavailable occurrence', recRes2.s === 201 && recRes2.b.booked.length === 2 && recRes2.b.skipped.length === 1 && recRes2.b.skipped[0].date === plusDays(36 + 7), recRes2.b);

    // --- M4.6 group / bridal party ---
    const gpDate = plusDays(45);
    const gp = (await req('POST', '/api/bookings/group', { organizer: { name: 'Bride To Be', phone: '5550012345', email: 'bride@x.com' }, date: gpDate, time: '14:00', members: [
      { name: 'Bride', serviceId: 'bridal-makeup', staffId: 'ava' },
      { name: 'Maid', serviceId: 'classic-mani', staffId: 'lily' },
      { name: 'Mom', serviceId: 'gel-mani', staffId: 'lily' }
    ] }));
    ok('group → 201 + 3 bookings', gp.s === 201 && gp.b.bookings.length === 3, gp.b);
    ok('group shares one groupId', new Set(gp.b.bookings.map(b => b.groupId)).size === 1 && !!gp.b.bookings[0].groupId);
    ok('group mints distinct refs', new Set(gp.b.bookings.map(b => b.ref)).size === gp.b.bookings.length);
    ok('group: first guest is the organizer', gp.b.bookings[0].groupRole === 'organizer');
    ok('group: two same-artist guests get different adjacent times',
      gp.b.bookings[1].staffId === 'lily' && gp.b.bookings[2].staffId === 'lily' && gp.b.bookings[1].time !== gp.b.bookings[2].time, gp.b.bookings.map(b => b.staffId + '@' + b.time));
    ok('group: every guest shares the organizer phone', gp.b.bookings.every(b => b.customer.phone === '5550012345'));
    ok('group rejects fewer than 2 guests → 400', (await req('POST', '/api/bookings/group', { organizer: { name: 'X', phone: '5550012345' }, date: gpDate, time: '14:00', members: [{ name: 'Solo', serviceId: 'gel-mani' }] })).s === 400);

    // --- M4.7 no stale "tomorrow" reminder for a same-day booking ---
    const todayBk = (await req('POST', '/api/bookings', { serviceId: 'brow-shape', staffId: 'noor', date: plusDays(0), time: '14:00', customer: { name: 'Same Day', phone: '5550013579' } }));
    const todayNotifs = (await req('GET', '/api/notifications')).b.notifications.filter(n => n.bookingId === todayBk.b.booking.id);
    ok('same-day booking creates confirmation only, no past-due reminder',
      todayBk.s === 201 && todayNotifs.length === 1 && todayNotifs[0].type === 'confirmation', { s: todayBk.s, types: todayNotifs.map(n => n.type) });

    // --- M1 hardening ---
    const past = (await req('POST', '/api/bookings', { serviceId: 'gel-mani', staffId: 'lily', date: '2020-01-01', time: '10:00', customer: { name: 'X', phone: '5551112222' } }));
    ok('validation rejects past date → 400', past.s === 400);
    const offgrid = (await req('POST', '/api/bookings', { serviceId: 'gel-mani', staffId: 'lily', date: day, time: '10:07', customer: { name: 'X', phone: '5551112222' } }));
    ok('validation rejects off-grid time → 400', offgrid.s === 400);
    const bademail = (await req('POST', '/api/bookings', { serviceId: 'gel-mani', staffId: 'lily', date: day, time: '11:00', customer: { name: 'X', phone: '5551112222', email: 'nope' } }));
    ok('validation rejects bad email → 400', bademail.s === 400);

    const esc = loadEsc();
    ok('esc() neutralizes XSS payload', esc('<img onerror=x>') === '&lt;img onerror=x&gt;' && !/[<>]/.test(esc('"><script>')));

    const health = (await req('GET', '/api/health'));
    ok('health 200 + security headers', health.s === 200 && health.h['x-content-type-options'] === 'nosniff' && !!health.h['content-security-policy']);

    // --- M2 admin CRUD ---
    const svcCreate = (await req('POST', '/api/admin/services/save', { service: { name: 'Test Add-On', category: 'nails', duration: 20, price: 15, staffIds: ['ava'] } }));
    ok('service create → 201 with id', svcCreate.s === 201 && !!svcCreate.b.service.id);
    const svcId = svcCreate.b.service.id;
    const svcEdit = (await req('POST', '/api/admin/services/save', { service: { id: svcId, name: 'Test Add-On', category: 'nails', duration: 20, price: 22, staffIds: ['ava'] } }));
    ok('service edit persists', svcEdit.s === 200 && (await req('GET', '/api/config')).b.services.find(s => s.id === svcId).price === 22);
    ok('service validation rejects bad duration', (await req('POST', '/api/admin/services/save', { service: { name: 'X', category: 'nails', duration: 7, price: 10, staffIds: ['ava'] } })).s === 400);
    ok('service delete → 200', (await req('POST', '/api/admin/services/delete', { id: svcId })).s === 200);

    const stCreate = (await req('POST', '/api/admin/staff/save', { staff: { name: 'Test Artist', title: 'Tester', specialties: ['Nails'] } }));
    ok('staff create → 201 with id', stCreate.s === 201 && !!stCreate.b.staff.id);
    const stId = stCreate.b.staff.id;
    await req('POST', '/api/admin/services/save', { service: { name: 'Solo Svc', category: 'nails', duration: 30, price: 30, staffIds: [stId] } });
    ok('staff delete blocked when sole artist → 409', (await req('POST', '/api/admin/staff/delete', { id: stId })).s === 409);

    // block-offs
    const boDay = '2026-09-15';
    const beforeBO = (await req('GET', '/api/availability?serviceId=classic-mani&staffId=ava&date=' + boDay)).b.options[0].slots;
    const boCreate = (await req('POST', '/api/admin/blockoffs/save', { blockoff: { staffId: 'ava', date: boDay, start: '12:00', end: '13:00', reason: 'Lunch' } }));
    ok('block-off create → 201', boCreate.s === 201 && !!boCreate.b.blockoff.id);
    const afterBO = (await req('GET', '/api/availability?serviceId=classic-mani&staffId=ava&date=' + boDay)).b.options[0].slots;
    ok('block-off removes overlapping slots, keeps 13:00', !afterBO.includes('12:00') && !afterBO.includes('12:30') && afterBO.includes('13:00') && afterBO.length < beforeBO.length);
    ok('block-off delete → 200 and availability restored', (await req('POST', '/api/admin/blockoffs/delete', { id: boCreate.b.blockoff.id })).s === 200 &&
      (await req('GET', '/api/availability?serviceId=classic-mani&staffId=ava&date=' + boDay)).b.options[0].slots.length === beforeBO.length);

    // resource capacity (shared across artists)
    const resC = (await req('POST', '/api/admin/resources/save', { resource: { name: 'Test Room', capacity: 1 } }));
    ok('resource create → 201', resC.s === 201 && !!resC.b.resource.id);
    const resId = resC.b.resource.id;
    const svcR = (await req('POST', '/api/admin/services/save', { service: { name: 'Room Service', category: 'skin', duration: 30, price: 40, staffIds: ['ava', 'noor'], resourceId: resId } }));
    const rsId = svcR.b.service.id, rday = '2026-09-17', rt = '10:00';
    const noorBefore = (await req('GET', '/api/availability?serviceId=' + rsId + '&staffId=noor&date=' + rday)).b.options[0].slots;
    const rbk = (await req('POST', '/api/bookings', { serviceId: rsId, staffId: 'ava', date: rday, time: rt, customer: { name: 'R', phone: '5551112222' } }));
    ok('resource booking snapshots resourceId', rbk.s === 201 && rbk.b.booking.resourceId === resId);
    const noorAfter = (await req('GET', '/api/availability?serviceId=' + rsId + '&staffId=noor&date=' + rday)).b.options[0].slots;
    ok('capacity-1 resource blocks OTHER artist at same time', noorBefore.includes(rt) && !noorAfter.includes(rt));
    ok('resource delete blocked while in use → 409', (await req('POST', '/api/admin/resources/delete', { id: resId })).s === 409);

    // accounts: register -> verify (session) -> me -> logout; then login
    const reg = (await req('POST', '/api/register', { name: 'Acc Test', phone: '555-888-7777', email: 'a@x.com' }));
    ok('register → 201 + devCode', reg.s === 201 && /^\d{6}$/.test(reg.b.devCode));
    const ver = (await req('POST', '/api/verify', { phone: '5558887777', code: reg.b.devCode }));
    const sid = ver.h['set-cookie'] ? ver.h['set-cookie'][0].split(';')[0] : null;
    ok('verify → 200 + session cookie', ver.s === 200 && !!sid);
    const meR = (await req('GET', '/api/me', null, { Cookie: sid }));
    ok('/api/me with session → 200', meR.s === 200 && meR.b.customer.phone === '5558887777');
    ok('/api/me without session → 401', (await req('GET', '/api/me')).s === 401);
    await req('POST', '/api/logout', null, { Cookie: sid });
    ok('after logout /api/me → 401', (await req('GET', '/api/me', null, { Cookie: sid })).s === 401);
    const otp = (await req('POST', '/api/otp', { phone: '5558887777' }));
    ok('otp for known account → 200 + devCode', otp.s === 200 && /^\d{6}$/.test(otp.b.devCode));
    const login = (await req('POST', '/api/login', { phone: '5558887777', code: otp.b.devCode }));
    ok('login → 200 + new session', login.s === 200 && !!login.h['set-cookie']);

    // --- M5.2 loyalty points ---
    const lpSid = login.h['set-cookie'][0].split(';')[0];
    const lpBk = (await req('POST', '/api/bookings',
      { serviceId: 'classic-mani', staffId: 'ava', date: '2026-09-22', time: '11:00',
        customer: { name: 'Acc Test', phone: '5558887777' } },
      { Cookie: lpSid }));
    ok('loyalty: linked booking has customerId', lpBk.s === 201 && !!lpBk.b.booking.customerId, lpBk.b);
    const lpId = lpBk.b.booking.id, lpPrice = lpBk.b.booking.price; // $28
    const lpComp = (await req('POST', '/api/admin/bookings/status', { id: lpId, status: 'completed' }));
    ok('loyalty: mark completed → loyaltyPoints = floor(price)', lpComp.s === 200 && lpComp.b.booking.loyaltyPoints === Math.floor(lpPrice), lpComp.b);
    const lpMe = (await req('GET', '/api/me', null, { Cookie: lpSid }));
    ok('loyalty: customer.points incremented after completion', lpMe.s === 200 && lpMe.b.customer.points === Math.floor(lpPrice), lpMe.b);
    ok('loyalty: re-marking finalised booking → 400', (await req('POST', '/api/admin/bookings/status', { id: lpId, status: 'no-show' })).s === 400);
    const lpStats = (await req('GET', '/api/stats')).b;
    ok('loyalty: totalPointsIssued in stats >= awarded points', lpStats.totalPointsIssued >= Math.floor(lpPrice), lpStats);

    // --- M5.3 gift cards ---
    // Issue
    const gcIssue = (await req('POST', '/api/admin/giftcards/issue', { amount: 50, issuedTo: 'Jane Doe', note: 'Birthday' }));
    ok('gift card: issue → 201 + code + balance $50', gcIssue.s === 201 && gcIssue.b.giftCard.balance === 50 && /^LUM-GIFT-/.test(gcIssue.b.giftCard.code), gcIssue.b);
    const gcId = gcIssue.b.giftCard.id, gcCode = gcIssue.b.giftCard.code;
    ok('gift card: bad amount → 400', (await req('POST', '/api/admin/giftcards/issue', { amount: 0 })).s === 400);

    // Lookup
    ok('gift card: public lookup by code → 200 + balance', (await req('GET', '/api/giftcards/lookup?code=' + encodeURIComponent(gcCode))).b.balance === 50);
    ok('gift card: lookup nonexistent → 404', (await req('GET', '/api/giftcards/lookup?code=LUM-GIFT-0000-0000')).s === 404);

    // Cannot redeem while payment pending
    const gcPrePay = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-09-23', time: '09:00', customer: { name: 'GC Test', phone: '5550009999' }, giftCardCode: gcCode }));
    ok('gift card: unpaid card rejected at booking → 400', gcPrePay.s === 400, gcPrePay.b);

    // Mark paid
    const gcPaid = (await req('POST', '/api/admin/giftcards/markpaid', { id: gcId }));
    ok('gift card: mark paid → 200 + paymentStatus paid', gcPaid.s === 200 && gcPaid.b.giftCard.paymentStatus === 'paid', gcPaid.b);

    // Redeem against a booking (classic-mani = $28, card has $50 → price becomes $0, balance $22)
    const gcBk = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-09-23', time: '09:00', customer: { name: 'GC Test', phone: '5550009999' }, giftCardCode: gcCode }));
    ok('gift card: redeemed → booking price is 0, listPrice is 28', gcBk.s === 201 && gcBk.b.booking.price === 0 && gcBk.b.booking.listPrice === 28, gcBk.b);
    ok('gift card: giftCardApplied amount = 28 on booking', gcBk.b.booking.giftCardApplied && gcBk.b.booking.giftCardApplied.amount === 28, gcBk.b);
    const gcAfter = (await req('GET', '/api/giftcards/lookup?code=' + encodeURIComponent(gcCode))).b;
    ok('gift card: balance decremented to $22 after use', gcAfter.balance === 22, gcAfter);

    // Cancel → balance restored
    await req('POST', '/api/admin/bookings/cancel', { id: gcBk.b.booking.id });
    const gcRestored = (await req('GET', '/api/giftcards/lookup?code=' + encodeURIComponent(gcCode))).b;
    ok('gift card: cancel restores balance to $50', gcRestored.balance === 50, gcRestored);

    // Void
    const gcVoidRes = (await req('POST', '/api/admin/giftcards/void', { id: gcId }));
    ok('gift card: void → 200 + status void', gcVoidRes.s === 200 && gcVoidRes.b.giftCard.status === 'void', gcVoidRes.b);
    const gcVoidBk = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-09-24', time: '09:00', customer: { name: 'GC Test', phone: '5550009999' }, giftCardCode: gcCode }));
    ok('gift card: voided card rejected at booking → 400', gcVoidBk.s === 400, gcVoidBk.b);

    // --- M4.8 prepaid packages ---
    // Admin creates a package catalog entry
    const pkgCreate = (await req('POST', '/api/admin/packages/save', { package: { name: '5-Visit Mani', serviceId: 'classic-mani', sessions: 5, price: 120 } }));
    ok('package: admin create catalog → 201 + id', pkgCreate.s === 201 && !!pkgCreate.b.package.id, pkgCreate.b);
    const pkgId = pkgCreate.b.package.id;

    // Edit catalog entry
    const pkgEdit = (await req('POST', '/api/admin/packages/save', { package: { id: pkgId, name: '5-Visit Mani', serviceId: 'classic-mani', sessions: 5, price: 130 } }));
    ok('package: admin edit price → 200 + price 130', pkgEdit.s === 200 && pkgEdit.b.package.price === 130, pkgEdit.b);

    // Validation: sessions too few
    ok('package: sessions = 1 → 400', (await req('POST', '/api/admin/packages/save', { package: { name: 'X', serviceId: 'classic-mani', sessions: 1, price: 50 } })).s === 400);

    // Unauthenticated buy → 401
    ok('package: buy unauthenticated → 401', (await req('POST', '/api/packages/buy', { packageId: pkgId })).s === 401);

    // Customer buys (logged-in as Acc Test via lpSid from loyalty section)
    const pkgBuy = (await req('POST', '/api/packages/buy', { packageId: pkgId }, { Cookie: lpSid }));
    ok('package: buy → 201 + remaining 5 + paymentStatus pending', pkgBuy.s === 201 && pkgBuy.b.package.remaining === 5 && pkgBuy.b.package.paymentStatus === 'pending', pkgBuy.b);
    const cpId = pkgBuy.b.package.id;

    // Redeem unpaid package → 400
    const pkgUnpaidBk = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-09-27', time: '09:00', customer: { name: 'Acc Test', phone: '5558887777' }, usePackageId: cpId }, { Cookie: lpSid }));
    ok('package: redeem unpaid → 400', pkgUnpaidBk.s === 400, pkgUnpaidBk.b);

    // Admin marks paid
    const meForId = (await req('GET', '/api/me', null, { Cookie: lpSid })).b.customer.id;
    const pkgPaid = (await req('POST', '/api/admin/packages/markpaid', { customerId: meForId, customerPackageId: cpId }));
    ok('package: admin mark paid → 200 + paymentStatus paid', pkgPaid.s === 200 && pkgPaid.b.package.paymentStatus === 'paid', pkgPaid.b);

    // Admin customer-packages list includes the purchase
    const cpList = (await req('GET', '/api/admin/customer-packages'));
    ok('package: admin customer-packages includes purchase', cpList.s === 200 && cpList.b.packages.some(p => p.id === cpId), cpList.b);

    // Redeem at booking → price = 0, listPrice = 28 (Mon 2026-09-28, opens 09:00)
    const pkgBkRes = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-09-28', time: '09:00', customer: { name: 'Acc Test', phone: '5558887777' }, usePackageId: cpId }, { Cookie: lpSid }));
    ok('package: redeem → price=0, listPrice=28', pkgBkRes.s === 201 && pkgBkRes.b.booking.price === 0 && pkgBkRes.b.booking.listPrice === 28, pkgBkRes.b);
    ok('package: packageRedemption recorded on booking', !!pkgBkRes.b.booking.packageRedemption && pkgBkRes.b.booking.packageRedemption.customerPackageId === cpId, pkgBkRes.b);

    // Remaining decremented to 4
    const meAfterRedeem = (await req('GET', '/api/me', null, { Cookie: lpSid })).b;
    ok('package: remaining decremented to 4', (meAfterRedeem.customer.packages.find(p => p.id === cpId) || {}).remaining === 4, meAfterRedeem.customer.packages);

    // Wrong service → 400
    ok('package: wrong service at booking → 400', (await req('POST', '/api/bookings', { serviceId: 'gel-mani', staffId: 'lily', date: '2026-09-28', time: '10:00', customer: { name: 'Acc Test', phone: '5558887777' }, usePackageId: cpId }, { Cookie: lpSid })).s === 400);

    // Admin delete catalog package
    ok('package: admin delete → 200', (await req('POST', '/api/admin/packages/delete', { id: pkgId })).s === 200);
    ok('package: admin delete nonexistent → 404', (await req('POST', '/api/admin/packages/delete', { id: 'nope' })).s === 404);

    // --- M5.4 reviews ---
    // statusBk was booked earlier (gel-mani / lily, 2026-09-03) and marked completed in M4.1
    const rvRef = statusBk.b.booking.ref;

    // Lookup by ref exposes minimal fields (no customer phone)
    const rvLookup = (await req('GET', '/api/bookings/lookup-by-ref?ref=' + encodeURIComponent(rvRef)));
    ok('review: lookup-by-ref → 200 + status completed', rvLookup.s === 200 && rvLookup.b.booking.status === 'completed', rvLookup.b);
    ok('review: lookup-by-ref does not expose phone', !rvLookup.b.booking.customer, rvLookup.b.booking);

    // Unknown ref → 404
    ok('review: lookup-by-ref unknown → 404', (await req('GET', '/api/bookings/lookup-by-ref?ref=LUM-0000')).s === 404);

    // Submit on a non-completed booking → 400
    const pendingRef = bk.b.booking.ref; // rescheduled but still confirmed
    ok('review: non-completed booking → 400', (await req('POST', '/api/reviews', { ref: pendingRef, rating: 5 })).s === 400);

    // Bad rating → 400
    ok('review: rating 0 → 400', (await req('POST', '/api/reviews', { ref: rvRef, rating: 0 })).s === 400);
    ok('review: rating 6 → 400', (await req('POST', '/api/reviews', { ref: rvRef, rating: 6 })).s === 400);

    // Happy path: 5-star review with comment
    const rvSubmit = (await req('POST', '/api/reviews', { ref: rvRef, rating: 5, comment: 'Absolutely perfect!' }));
    ok('review: submit → 201 + rating 5', rvSubmit.s === 201 && rvSubmit.b.review.rating === 5, rvSubmit.b);

    // Duplicate → 409
    ok('review: duplicate → 409', (await req('POST', '/api/reviews', { ref: rvRef, rating: 4 })).s === 409);

    // Public feed includes the review
    const rvFeed = (await req('GET', '/api/reviews')).b;
    ok('review: public feed contains submitted review', rvFeed.reviews.some(r => r.rating === 5 && r.comment === 'Absolutely perfect!'));

    // Filtered by serviceId
    const rvFiltered = (await req('GET', '/api/reviews?serviceId=gel-mani')).b;
    ok('review: serviceId filter works', rvFiltered.reviews.every(r => r.serviceId === 'gel-mani'));

    // Admin feed includes customer name
    const rvAdmin = (await req('GET', '/api/admin/reviews')).b;
    ok('review: admin feed includes customerName', rvAdmin.reviews.some(r => r.customerName === 'Status Test'));

    // Stats reflect the review
    const rvStats = (await req('GET', '/api/stats')).b;
    ok('review: stats.totalReviews >= 1', rvStats.totalReviews >= 1, rvStats.totalReviews);
    ok('review: stats.avgRating is a number', typeof rvStats.avgRating === 'number', rvStats.avgRating);

    // lookup-by-ref shows review after submission
    const rvLookup2 = (await req('GET', '/api/bookings/lookup-by-ref?ref=' + encodeURIComponent(rvRef))).b;
    ok('review: lookup-by-ref shows review after submission', rvLookup2.booking.review && rvLookup2.booking.review.rating === 5);

    // --- M5.8 marketing broadcasts + opt-out ---
    // Opt-out unauthenticated → 401
    ok('marketing: optout unauthenticated → 401', (await req('POST', '/api/marketing/optout')).s === 401);

    // Opt-out while logged in → 200
    const mktOut = (await req('POST', '/api/marketing/optout', null, { Cookie: lpSid }));
    ok('marketing: optout → 200', mktOut.s === 200 && mktOut.b.ok === true, mktOut.b);

    // /api/me shows marketingOptOut = true
    const mktMe = (await req('GET', '/api/me', null, { Cookie: lpSid })).b;
    ok('marketing: me.customer.marketingOptOut = true after optout', mktMe.customer.marketingOptOut === true, mktMe.customer.marketingOptOut);

    // Opt-in → 200 and flag cleared
    const mktIn = (await req('POST', '/api/marketing/optin', null, { Cookie: lpSid }));
    ok('marketing: optin → 200', mktIn.s === 200 && mktIn.b.ok === true, mktIn.b);
    const mktMeAfter = (await req('GET', '/api/me', null, { Cookie: lpSid })).b;
    ok('marketing: marketingOptOut = false after optin', mktMeAfter.customer.marketingOptOut === false, mktMeAfter.customer.marketingOptOut);

    // Token-based optout via GET /api/marketing/optout?token=...
    const mktCustId = mktMe.customer.id;
    const mktToken = Buffer.from(mktCustId).toString('base64url');
    const mktTokenOut = (await req('GET', '/api/marketing/optout?token=' + encodeURIComponent(mktToken)));
    ok('marketing: token-based optout → 200', mktTokenOut.s === 200 && mktTokenOut.b.ok === true, mktTokenOut.b);
    // Customer now opted out again
    ok('marketing: token optout reflected on customer', (await req('GET', '/api/me', null, { Cookie: lpSid })).b.customer.marketingOptOut === true);

    // Re-opt-in so they get counted in broadcast
    await req('POST', '/api/marketing/optin', null, { Cookie: lpSid });

    // Send broadcast → 201 + queued ≥ 1
    const bcSend = (await req('POST', '/api/admin/broadcasts', { subject: 'Summer special', message: 'Hi {name}, come in this week for 20% off!', channel: 'email' }));
    ok('marketing: send broadcast → 201', bcSend.s === 201, bcSend.b);
    ok('marketing: broadcast queued ≥ 1 recipient', bcSend.b.queued >= 1, bcSend.b.queued);
    ok('marketing: broadcast has recipientCount', bcSend.b.broadcast.recipientCount >= 1, bcSend.b.broadcast);
    const bcId = bcSend.b.broadcast.id;

    // GET /api/admin/broadcasts lists it
    const bcList = (await req('GET', '/api/admin/broadcasts')).b;
    ok('marketing: admin broadcasts list → 200 + contains broadcast', bcList.broadcasts.some(b => b.id === bcId), bcList.broadcasts);

    // Broadcast queued a notification of type 'broadcast'
    const bcNotifs = (await req('GET', '/api/notifications')).b;
    ok('marketing: broadcast notification queued', bcNotifs.notifications.some(n => n.broadcastId === bcId && n.type === 'broadcast'), bcNotifs.notifications.length);

    // Missing message → 400
    ok('marketing: missing message → 400', (await req('POST', '/api/admin/broadcasts', { subject: 'No msg' })).s === 400);

    // Opted-out customer not included: opt out lpSid, send another broadcast, count drops
    await req('POST', '/api/marketing/optout', null, { Cookie: lpSid });
    const bcSend2 = (await req('POST', '/api/admin/broadcasts', { subject: 'Second', message: 'Another blast', channel: 'email' }));
    ok('marketing: opted-out customer excluded from broadcast', bcSend.b.queued > bcSend2.b.queued, { first: bcSend.b.queued, second: bcSend2.b.queued });

    // --- M5.7 referrals ---
    // Register Customer A (referrer) — referral code created at registration
    const refAPhone = '5550100001';
    const refAReg = (await req('POST', '/api/register', { name: 'Referrer Alice', phone: refAPhone, email: '' }));
    ok('referral: register referrer → 201', refAReg.s === 201, refAReg.b);
    const refACode = (await req('POST', '/api/verify', { phone: refAPhone, code: refAReg.b.devCode }));
    ok('referral: verify referrer → 200', refACode.s === 200, refACode.b);
    const refASid = refACode.h['set-cookie'];

    // GET /api/referral — returns code + stats
    const refAInfo = (await req('GET', '/api/referral', null, { Cookie: refASid }));
    ok('referral: GET /api/referral → 200 + code', refAInfo.s === 200 && /^LUM-/.test(refAInfo.b.referralCode), refAInfo.b);
    const refCode = refAInfo.b.referralCode;

    // GET /api/referral unauthenticated → 401
    ok('referral: unauthenticated → 401', (await req('GET', '/api/referral')).s === 401);

    // Register Customer B using Alice's referral code
    const refBPhone = '5550100002';
    const refBReg = (await req('POST', '/api/register', { name: 'Referee Bob', phone: refBPhone, referralCode: refCode }));
    ok('referral: register with code → 201', refBReg.s === 201, refBReg.b);
    const refBVerify = (await req('POST', '/api/verify', { phone: refBPhone, code: refBReg.b.devCode }));
    ok('referral: verify referee → 200', refBVerify.s === 200, refBVerify.b);
    const refBSid = refBVerify.h['set-cookie'];
    const refBCustId = refBVerify.b.customer.id;

    // Admin referrals list shows Bob referred by Alice
    const refAdminList = (await req('GET', '/api/admin/referrals')).b;
    ok('referral: admin list shows referee', refAdminList.referrals.some(r => r.referee.id === refBCustId), refAdminList.referrals);
    ok('referral: referralClaimed = false before first booking', refAdminList.referrals.find(r => r.referee.id === refBCustId).referralClaimed === false);

    // Points before completion
    const refAPointsBefore = (await req('GET', '/api/me', null, { Cookie: refASid })).b.customer.points;
    const refBPointsBefore = (await req('GET', '/api/me', null, { Cookie: refBSid })).b.customer.points;

    // Bob books and completes first visit
    const refBBk = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-11-03', time: '09:00', customer: { name: 'Referee Bob', phone: refBPhone } }, { Cookie: refBSid }));
    ok('referral: referee books → 201', refBBk.s === 201, refBBk.b);
    const refBComp = (await req('POST', '/api/admin/bookings/status', { id: refBBk.b.booking.id, status: 'completed' }));
    ok('referral: complete first booking → refereeBonus on booking', refBComp.s === 200 && refBComp.b.booking.refereeBonus === 100, refBComp.b.booking);
    ok('referral: referrerBonus on booking', refBComp.b.booking.referrerBonus === 200, refBComp.b.booking);

    // Both customers received bonus points
    const refAPointsAfter = (await req('GET', '/api/me', null, { Cookie: refASid })).b.customer.points;
    const refBPointsAfter = (await req('GET', '/api/me', null, { Cookie: refBSid })).b.customer.points;
    ok('referral: referrer earns 200 bonus pts', refAPointsAfter === refAPointsBefore + 200, { before: refAPointsBefore, after: refAPointsAfter });
    ok('referral: referee earns 100 bonus pts', refBPointsAfter >= refBPointsBefore + 100, { before: refBPointsBefore, after: refBPointsAfter });

    // Admin referrals list now shows claimed
    const refAdminAfter = (await req('GET', '/api/admin/referrals')).b;
    ok('referral: referralClaimed = true after completion', refAdminAfter.referrals.find(r => r.referee.id === refBCustId).referralClaimed === true);

    // Second completed booking does NOT re-award bonus
    const refBBk2 = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-11-04', time: '09:00', customer: { name: 'Referee Bob', phone: refBPhone } }, { Cookie: refBSid }));
    await req('POST', '/api/admin/bookings/status', { id: refBBk2.b.booking.id, status: 'completed' });
    const refAPointsFinal = (await req('GET', '/api/me', null, { Cookie: refASid })).b.customer.points;
    ok('referral: no double-award on second booking', refAPointsFinal === refAPointsAfter, { after: refAPointsAfter, final: refAPointsFinal });

    // Invalid referral code at registration is silently ignored (no error)
    const refBadReg = (await req('POST', '/api/register', { name: 'No Ref', phone: '5550100003', referralCode: 'LUM-ZZZZZZ' }));
    ok('referral: invalid code silently ignored', refBadReg.s === 201, refBadReg.b);

    // --- M5.6 memberships ---
    // Admin create plan
    const mpCreate = (await req('POST', '/api/admin/membership-plans/save', { plan: { name: 'Gold Member', description: '10% off every visit', monthlyPrice: 29, discountPct: 10 } }));
    ok('membership: admin create plan → 201 + id', mpCreate.s === 201 && !!mpCreate.b.plan.id, mpCreate.b);
    const mpId = mpCreate.b.plan.id;

    // Bad discountPct → 400
    ok('membership: discountPct 0 → 400', (await req('POST', '/api/admin/membership-plans/save', { plan: { name: 'Bad', monthlyPrice: 10, discountPct: 0 } })).s === 400);

    // Plan shows in config
    const cfgMem = (await req('GET', '/api/config')).b;
    ok('membership: plan in config.membershipPlans', cfgMem.membershipPlans.some(p => p.id === mpId));

    // Subscribe unauthenticated → 401
    ok('membership: subscribe unauthenticated → 401', (await req('POST', '/api/membership/subscribe', { planId: mpId })).s === 401);

    // Subscribe (logged in as lpSid customer)
    const memSub = (await req('POST', '/api/membership/subscribe', { planId: mpId }, { Cookie: lpSid }));
    ok('membership: subscribe → 201 + pending_payment', memSub.s === 201 && memSub.b.membership.status === 'pending_payment', memSub.b);

    // Admin members list
    const memList = (await req('GET', '/api/admin/members')).b;
    ok('membership: admin members list contains subscriber', memList.members.some(m => m.membership.planId === mpId));
    const memCustId = memList.members.find(m => m.membership.planId === mpId).id;

    // Booking while pending — no discount (paymentStatus = 'pending')
    const memBkPending = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-09-29', time: '09:00', customer: { name: 'Acc Test', phone: '5558887777' } }, { Cookie: lpSid }));
    ok('membership: booking while pending → no discount', memBkPending.s === 201 && !memBkPending.b.booking.memberDiscount, memBkPending.b.booking);

    // Admin mark paid → status active
    const memPaid = (await req('POST', '/api/admin/membership/markpaid', { customerId: memCustId }));
    ok('membership: markpaid → 200 + status active', memPaid.s === 200 && memPaid.b.membership.status === 'active', memPaid.b);

    // Duplicate subscribe after active → 409
    ok('membership: duplicate subscribe → 409', (await req('POST', '/api/membership/subscribe', { planId: mpId }, { Cookie: lpSid })).s === 409);

    // Booking with active membership → discount applied
    const memBkActive = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-09-30', time: '09:00', customer: { name: 'Acc Test', phone: '5558887777' } }, { Cookie: lpSid }));
    ok('membership: booking applies 10% discount', memBkActive.s === 201 && !!memBkActive.b.booking.memberDiscount && memBkActive.b.booking.memberDiscount.discountPct === 10, memBkActive.b.booking);
    ok('membership: price = listPrice - savedAmount', memBkActive.s === 201 && memBkActive.b.booking.price === memBkActive.b.booking.listPrice - memBkActive.b.booking.memberDiscount.savedAmount, memBkActive.b.booking);

    // Admin cancel membership
    const memCancelRes = (await req('POST', '/api/admin/membership/cancel', { customerId: memCustId }));
    ok('membership: admin cancel → 200 + status cancelled', memCancelRes.s === 200 && memCancelRes.b.membership.status === 'cancelled', memCancelRes.b);

    // Admin delete plan → 200 / 404
    ok('membership: admin delete plan → 200', (await req('POST', '/api/admin/membership-plans/delete', { id: mpId })).s === 200);
    ok('membership: admin delete nonexistent → 404', (await req('POST', '/api/admin/membership-plans/delete', { id: 'nope' })).s === 404);

    // --- M5.5 waitlist ---
    // Missing fields → 400
    ok('waitlist: missing phone → 400', (await req('POST', '/api/waitlist', { serviceId: 'classic-mani', date: '2026-10-05', name: 'Wait Person' })).s === 400);

    // Past date → 400
    ok('waitlist: past date → 400', (await req('POST', '/api/waitlist', { serviceId: 'classic-mani', date: '2024-01-01', name: 'Wait Person', phone: '5559990000' })).s === 400);

    // Join waitlist → 201 + id
    const wlJoin = (await req('POST', '/api/waitlist', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-10-05', name: 'Wait Person', phone: '5559990000', email: 'wait@example.com' }));
    ok('waitlist: join → 201 + id', wlJoin.s === 201 && !!wlJoin.b.id, wlJoin.b);
    const wlId = wlJoin.b.id;

    // Admin list → 200 + contains entry
    const wlList = (await req('GET', '/api/waitlist'));
    ok('waitlist: admin list → 200 + entry present', wlList.s === 200 && wlList.b.waitlist.some(w => w.id === wlId), wlList.b);

    // Cancel-triggered notification: book then cancel a slot on the same date/service/staff
    const wlBk = (await req('POST', '/api/bookings', { serviceId: 'classic-mani', staffId: 'ava', date: '2026-10-05', time: '09:00', customer: { name: 'Slot Holder', phone: '5551112222' } }));
    ok('waitlist: book slot for cancel test → 201', wlBk.s === 201, wlBk.b);
    const wlCancel = (await req('POST', '/api/admin/bookings/cancel', { id: wlBk.b.booking.id }));
    ok('waitlist: cancel booking → 200', wlCancel.s === 200, wlCancel.b);

    // Waitlist entry should now be 'notified'
    const wlAfter = (await req('GET', '/api/waitlist')).b;
    const wlEntry = wlAfter.waitlist.find(w => w.id === wlId);
    ok('waitlist: entry status → notified after cancellation', wlEntry && wlEntry.status === 'notified', wlEntry);

    // A waitlist notification should have been queued
    const wlNotifs = (await req('GET', '/api/notifications')).b;
    ok('waitlist: notification queued', wlNotifs.notifications.some(n => n.type === 'waitlist' && n.waitlistId === wlId), wlNotifs.notifications);

    // Dismiss entry → 200
    ok('waitlist: dismiss → 200', (await req('POST', '/api/admin/waitlist/dismiss', { id: wlId })).s === 200);

    // Dismissed entry gone from list
    const wlGone = (await req('GET', '/api/waitlist')).b;
    ok('waitlist: dismissed entry removed from list', !wlGone.waitlist.some(w => w.id === wlId), wlGone.waitlist);

    // Dismiss nonexistent → 404
    ok('waitlist: dismiss nonexistent → 404', (await req('POST', '/api/admin/waitlist/dismiss', { id: 'nope' })).s === 404);

    // --- M6.2 retail store + inventory ---
    // List products (empty)
    const pList0 = (await req('GET', '/api/admin/products')).b;
    ok('retail: products list → 200 array', Array.isArray(pList0.products), pList0);

    // Create a product
    const pCreate = (await req('POST', '/api/admin/products/save', { product: { name: 'OPI Nail Lacquer', category: 'Polish', price: 12.99, stock: 10, lowStockThreshold: 3 } }));
    ok('retail: create product → 201 + id', pCreate.s === 201 && !!pCreate.b.product.id, pCreate.b);
    const pId = pCreate.b.product.id;

    // Missing name → 400
    ok('retail: missing name → 400', (await req('POST', '/api/admin/products/save', { product: { price: 5, stock: 2 } })).s === 400);

    // Negative price → 400
    ok('retail: negative price → 400', (await req('POST', '/api/admin/products/save', { product: { name: 'Bad', price: -1, stock: 0 } })).s === 400);

    // Product appears in list
    const pList1 = (await req('GET', '/api/admin/products')).b;
    ok('retail: product in list', pList1.products.some(p => p.id === pId), pList1.products.length);

    // lowStock flag false when stock (10) > threshold (3)
    ok('retail: lowStock false when stock > threshold', pList1.products.find(p => p.id === pId).lowStock === false);

    // Edit product
    const pEdit = (await req('POST', '/api/admin/products/save', { product: { id: pId, name: 'OPI Nail Lacquer', category: 'Polish', price: 13.99, stock: 10, lowStockThreshold: 3 } }));
    ok('retail: edit product → 200 + updated price', pEdit.s === 200 && pEdit.b.product.price === 13.99, pEdit.b);

    // Stock adjustment
    const pAdj = (await req('POST', '/api/admin/products/adjust', { id: pId, delta: -8 }));
    ok('retail: stock adjust -8 → stock becomes 2', pAdj.s === 200 && pAdj.b.product.stock === 2, pAdj.b.product && pAdj.b.product.stock);
    ok('retail: lowStock true after adjustment', pAdj.b.product.lowStock === true, pAdj.b.product && pAdj.b.product.lowStock);

    // Low-stock endpoint shows the product
    const pLow = (await req('GET', '/api/admin/products/low-stock')).b;
    ok('retail: low-stock list contains product', pLow.products.some(p => p.id === pId), pLow.products.length);

    // delta=0 → 400
    ok('retail: delta=0 → 400', (await req('POST', '/api/admin/products/adjust', { id: pId, delta: 0 })).s === 400);

    // Record a sale — first restore stock to 10
    await req('POST', '/api/admin/products/adjust', { id: pId, delta: 8 });
    const pSale = (await req('POST', '/api/admin/sales', { productId: pId, quantity: 2 }));
    ok('retail: record sale → 201 + correct total', pSale.s === 201 && Math.abs((pSale.b.sale && pSale.b.sale.total) - 27.98) < 0.01, { s: pSale.s, total: pSale.b.sale && pSale.b.sale.total });
    ok('retail: stock decremented after sale', pSale.b.product && pSale.b.product.stock === 8, pSale.b.product && pSale.b.product.stock);

    // Sales list contains the sale
    const sList = (await req('GET', '/api/admin/sales')).b;
    ok('retail: sales list contains sale', Array.isArray(sList.sales) && sList.sales.some(s => s.productId === pId && s.quantity === 2), sList.sales && sList.sales.length);

    // Oversell → 409
    ok('retail: oversell → 409', (await req('POST', '/api/admin/sales', { productId: pId, quantity: 999 })).s === 409);

    // Missing productId → 400
    ok('retail: missing productId → 400', (await req('POST', '/api/admin/sales', { quantity: 1 })).s === 400);

    // quantity 0 → 400
    ok('retail: quantity 0 → 400', (await req('POST', '/api/admin/sales', { productId: pId, quantity: 0 })).s === 400);

    // Delete product → 200
    ok('retail: delete product → 200', (await req('POST', '/api/admin/products/delete', { id: pId })).s === 200);

    // Delete nonexistent → 404
    ok('retail: delete nonexistent → 404', (await req('POST', '/api/admin/products/delete', { id: 'nope' })).s === 404);

    // --- M6.3 tips + commission ---
    // Commissions list returns one row per staff member
    const commAll = (await req('GET', '/api/admin/commissions')).b;
    ok('tips: commissions list → 200 + staff array', Array.isArray(commAll.commissions), commAll);

    // Set commissionPct on a staff member (ava, who has completed bookings)
    const staffAva = (await req('GET', '/api/config')).b.staff.find(s => s.id === 'ava');
    ok('tips: ava exists in config', !!staffAva, null);
    const staffSave = (await req('POST', '/api/admin/staff/save', { staff: { id: 'ava', name: staffAva.name, title: staffAva.title || '', bio: staffAva.bio || '', specialties: staffAva.specialties || [], commissionPct: 40 } }));
    ok('tips: set ava commissionPct 40 → 200', staffSave.s === 200, staffSave.b);

    // Commission recalculates with rate
    const commAva = (await req('GET', '/api/admin/commissions')).b.commissions.find(c => c.staffId === 'ava');
    ok('tips: ava commissionPct reflected in commissions', commAva && commAva.commissionPct === 40, commAva);
    ok('tips: ava commissionEarned = revenue * 0.4', commAva && Math.abs(commAva.commissionEarned - commAva.serviceRevenue * 0.4) < 0.02, commAva);

    // Record tip on a completed booking (use statusId which was marked completed earlier)
    const tipR = (await req('POST', '/api/admin/bookings/tip', { id: statusId, tipAmount: 8 }));
    ok('tips: record tip → 200', tipR.s === 200 && tipR.b.booking.tip === 8, tipR.b);

    // Tip shows in tips list
    const tipsData = (await req('GET', '/api/admin/tips')).b;
    ok('tips: tips list contains recorded tip', Array.isArray(tipsData.tips) && tipsData.tips.some(t => t.id === statusId && t.tip === 8), tipsData.tips && tipsData.tips.length);

    // Tip on non-completed booking → 400
    ok('tips: tip on confirmed booking → 400', (await req('POST', '/api/admin/bookings/tip', { id: bk.b.booking.id, tipAmount: 5 })).s === 400);

    // Negative tip → 400
    ok('tips: negative tip → 400', (await req('POST', '/api/admin/bookings/tip', { id: statusId, tipAmount: -1 })).s === 400);

    // Tips appear in commission tipsEarned
    const commAfterTip = (await req('GET', '/api/admin/commissions')).b.commissions.find(c => c.staffId === 'lily');
    ok('tips: tipsEarned in commissions ≥ 8 for lily', commAfterTip && commAfterTip.tipsEarned >= 8, commAfterTip);

    // Date filter: future range → 0 bookings
    const commFuture = (await req('GET', '/api/admin/commissions?from=2099-01-01&to=2099-12-31')).b;
    ok('tips: future date filter → 0 bookings', commFuture.commissions.every(c => c.completedBookings === 0), commFuture.commissions);

    // --- M6.1 booking search / filter / pagination ---
    // Default response shape has pagination fields
    const bAll = (await req('GET', '/api/bookings')).b;
    ok('bookings: response has pagination fields', Number.isInteger(bAll.total) && Number.isInteger(bAll.pages) && Number.isInteger(bAll.page), bAll);
    ok('bookings: default page=1', bAll.page === 1, bAll.page);
    ok('bookings: default newest-first', bAll.bookings.length >= 2 && bAll.bookings[0].date >= bAll.bookings[1].date, bAll.bookings.slice(0,2).map(b=>b.date));

    // Search by ref (use a ref we know from earlier)
    const searchRef = firstRef; // 'LUM-xxxx' from the very first booking
    const bRef = (await req('GET', '/api/bookings?q=' + encodeURIComponent(searchRef))).b;
    ok('bookings: search by ref returns match', bRef.bookings.length >= 1 && bRef.bookings.some(b => b.ref === searchRef), bRef.bookings.map(b=>b.ref));

    // Search by customer name fragment
    const bName = (await req('GET', '/api/bookings?q=status+test')).b;
    ok('bookings: search by name is case-insensitive', bName.bookings.some(b => b.customer.name.toLowerCase().includes('status test')), bName.bookings.map(b=>b.customer.name));

    // Filter by status=cancelled
    const bCancelled = (await req('GET', '/api/bookings?status=cancelled')).b;
    ok('bookings: filter status=cancelled returns only cancelled', bCancelled.bookings.every(b => b.status === 'cancelled'), bCancelled.bookings.map(b=>b.status));
    ok('bookings: cancelled count matches total', bCancelled.bookings.length === bCancelled.total, { len: bCancelled.bookings.length, total: bCancelled.total });

    // Filter by staffId
    const bAva = (await req('GET', '/api/bookings?staffId=ava')).b;
    ok('bookings: filter by staffId returns only that artist', bAva.bookings.every(b => b.staffId === 'ava'), bAva.bookings.map(b=>b.staffId));

    // Filter by exact date
    const bDate = (await req('GET', '/api/bookings?date=2026-09-01')).b;
    ok('bookings: filter by date returns only that date', bDate.bookings.every(b => b.date === '2026-09-01'), bDate.bookings.map(b=>b.date));

    // Pagination — pageSize=1 should split across multiple pages
    const bPg1 = (await req('GET', '/api/bookings?pageSize=1&page=1')).b;
    ok('bookings: pageSize=1 returns 1 booking', bPg1.bookings.length === 1, bPg1.bookings.length);
    ok('bookings: pages > 1 when pageSize=1 and multiple bookings', bPg1.pages > 1, bPg1.pages);

    const bPg2 = (await req('GET', '/api/bookings?pageSize=1&page=2')).b;
    ok('bookings: page 2 returns different booking than page 1', bPg2.bookings.length === 1 && bPg2.bookings[0].id !== bPg1.bookings[0].id, { p1: bPg1.bookings[0].id, p2: bPg2.bookings[0].id });

    // Past-end page clamps to last page
    const bBig = (await req('GET', '/api/bookings?page=9999')).b;
    ok('bookings: out-of-range page clamps to last', bBig.page === bBig.pages, { page: bBig.page, pages: bBig.pages });

    // No match → empty bookings, total=0
    const bNone = (await req('GET', '/api/bookings?q=zzznomatchzzz')).b;
    ok('bookings: no-match query → total=0 empty array', bNone.total === 0 && bNone.bookings.length === 0, bNone);

    // --- M6.4 analytics stats fields ---
    const st64 = (await req('GET', '/api/stats')).b;
    // revenueByMonth
    ok('stats: revenueByMonth is an object', st64.revenueByMonth !== null && typeof st64.revenueByMonth === 'object' && !Array.isArray(st64.revenueByMonth), st64.revenueByMonth);
    const rmKeys = Object.keys(st64.revenueByMonth || {});
    ok('stats: revenueByMonth has 6 keys', rmKeys.length === 6, rmKeys.length);
    ok('stats: revenueByMonth keys are YYYY-MM format', rmKeys.every(k => /^\d{4}-\d{2}$/.test(k)), rmKeys);
    ok('stats: revenueByMonth keys are sorted ascending', rmKeys.join(',') === [...rmKeys].sort().join(','), rmKeys);
    ok('stats: revenueByMonth values are numbers', Object.values(st64.revenueByMonth).every(v => typeof v === 'number'), Object.values(st64.revenueByMonth));
    // bookingsByWeek
    ok('stats: bookingsByWeek is an object', st64.bookingsByWeek !== null && typeof st64.bookingsByWeek === 'object' && !Array.isArray(st64.bookingsByWeek), st64.bookingsByWeek);
    const wKeys = Object.keys(st64.bookingsByWeek || {});
    ok('stats: bookingsByWeek has 8 keys', wKeys.length === 8, wKeys.length);
    ok('stats: bookingsByWeek keys are YYYY-MM-DD format', wKeys.every(k => /^\d{4}-\d{2}-\d{2}$/.test(k)), wKeys);
    ok('stats: bookingsByWeek values are non-negative integers', Object.values(st64.bookingsByWeek).every(v => Number.isInteger(v) && v >= 0), Object.values(st64.bookingsByWeek));
    // topServices
    ok('stats: topServices is an array', Array.isArray(st64.topServices), st64.topServices);
    ok('stats: topServices has at most 5 items', (st64.topServices || []).length <= 5, (st64.topServices || []).length);
    if ((st64.topServices || []).length > 0) {
      const ts = st64.topServices[0];
      ok('stats: topServices items have name, count, revenue', typeof ts.name === 'string' && typeof ts.count === 'number' && typeof ts.revenue === 'number', ts);
      ok('stats: topServices sorted by count descending', st64.topServices.every((s, i, a) => i === 0 || a[i-1].count >= s.count), st64.topServices.map(s=>s.count));
    }

    // --- M7.1 legal pages served as HTML ---
    const privacyR = await reqRaw('GET', '/privacy.html');
    ok('legal: privacy.html → 200 HTML', privacyR.s === 200 && privacyR.h['content-type'].includes('text/html'), { s: privacyR.s, ct: privacyR.h['content-type'] });
    ok('legal: privacy.html contains Privacy Policy heading', privacyR.body.includes('Privacy Policy'), null);
    const termsR = await reqRaw('GET', '/terms.html');
    ok('legal: terms.html → 200 HTML', termsR.s === 200 && termsR.h['content-type'].includes('text/html'), { s: termsR.s, ct: termsR.h['content-type'] });
    const smsR = await reqRaw('GET', '/sms-consent.html');
    ok('legal: sms-consent.html → 200 HTML', smsR.s === 200 && smsR.h['content-type'].includes('text/html'), { s: smsR.s, ct: smsR.h['content-type'] });

    // --- M7.2 styled 404 ---
    const r404 = await reqRaw('GET', '/this-page-does-not-exist.html');
    ok('404: missing page returns status 404', r404.s === 404, r404.s);
    ok('404: body is HTML (not plain text)', r404.h['content-type'].includes('text/html'), r404.h['content-type']);
    ok('404: body contains branded content', r404.body.includes('404') && r404.body.includes('Lumi'), r404.body.slice(0, 200));

    // --- M6.3 sitemap has legal pages ---
    const smR = await reqRaw('GET', '/sitemap.xml');
    ok('sitemap: returns 200 XML', smR.s === 200 && smR.h['content-type'].includes('xml'), { s: smR.s, ct: smR.h['content-type'] });
    ok('sitemap: contains privacy.html', smR.body.includes('/privacy.html'), null);
    ok('sitemap: contains terms.html', smR.body.includes('/terms.html'), null);
    ok('sitemap: contains sms-consent.html', smR.body.includes('/sms-consent.html'), null);

    // --- M7.3 performance: Cache-Control + gzip ---
    const cssR = await reqRaw('GET', '/css/styles.css');
    ok('perf: CSS gets public max-age Cache-Control', (cssR.h['cache-control'] || '').includes('max-age=3600'), cssR.h['cache-control']);
    const jsR  = await reqRaw('GET', '/js/common.js');
    ok('perf: JS gets public max-age Cache-Control', (jsR.h['cache-control'] || '').includes('max-age=3600'), jsR.h['cache-control']);
    const htmlR = await reqRaw('GET', '/');
    ok('perf: HTML gets no-cache Cache-Control', (htmlR.h['cache-control'] || '') === 'no-cache', htmlR.h['cache-control']);
    const gzR = await new Promise((resolve, reject) => {
      const r = http.request(base + '/css/styles.css', { headers: { 'Accept-Encoding': 'gzip' } }, (x) => {
        const chunks = []; x.on('data', c => chunks.push(c)); x.on('end', () => resolve({ s: x.statusCode, h: x.headers, buf: Buffer.concat(chunks) }));
      }); r.on('error', reject); r.end();
    });
    ok('perf: gzip response has Content-Encoding: gzip', gzR.h['content-encoding'] === 'gzip', gzR.h['content-encoding']);
    ok('perf: gzip response has Vary: Accept-Encoding', (gzR.h['vary'] || '').includes('Accept-Encoding'), gzR.h['vary']);
    ok('perf: gzip body smaller than raw', gzR.buf.length < cssR.body.length, { gz: gzR.buf.length, raw: cssR.body.length });
    const cfgR1 = await reqRaw('GET', '/api/config');
    const etag = cfgR1.h['etag'];
    ok('perf: /api/config returns ETag', !!etag, etag);
    ok('perf: /api/config returns Cache-Control', (cfgR1.h['cache-control'] || '').includes('max-age'), cfgR1.h['cache-control']);
    const cfg304 = await new Promise((resolve, reject) => {
      const r = http.request(base + '/api/config', { headers: { 'If-None-Match': etag } }, (x) => {
        let s = ''; x.on('data', c => s += c); x.on('end', () => resolve({ s: x.statusCode, body: s }));
      }); r.on('error', reject); r.end();
    });
    ok('perf: /api/config with matching ETag → 304', cfg304.s === 304, cfg304.s);
    ok('perf: 304 body is empty', cfg304.body === '', cfg304.body.length);

    // --- M7.4 ops: request logging + backup ---
    // Backup endpoint returns JSON with Content-Disposition attachment
    const bkR = await reqRaw('GET', '/api/admin/backup');
    ok('backup: GET /api/admin/backup → 200', bkR.s === 200, bkR.s);
    ok('backup: response is JSON', (bkR.h['content-type'] || '').includes('application/json'), bkR.h['content-type']);
    ok('backup: Content-Disposition is attachment', (bkR.h['content-disposition'] || '').startsWith('attachment'), bkR.h['content-disposition']);
    ok('backup: filename contains lumiere-backup', (bkR.h['content-disposition'] || '').includes('lumiere-backup'), bkR.h['content-disposition']);
    ok('backup: body is valid JSON with bookings array', (() => { try { const d = JSON.parse(bkR.body); return Array.isArray(d.bookings); } catch { return false; } })(), null);
    // With wrong token, backup should be 401
    const bkBadR = await new Promise((resolve, reject) => {
      const r = http.request(base + '/api/admin/backup', { headers: { 'Authorization': 'Bearer wrong-token' } }, (x) => {
        let s = ''; x.on('data', c => s += c); x.on('end', () => resolve({ s: x.statusCode }));
      }); r.on('error', reject); r.end();
    });
    // Only test auth when ADMIN_TOKEN env is set; in test env it's unset so endpoint is open
    if (process.env.ADMIN_TOKEN) {
      ok('backup: wrong token → 401', bkBadR.s === 401, bkBadR.s);
    } else {
      ok('backup: no ADMIN_TOKEN set → open access (dev mode)', bkR.s === 200, bkR.s);
    }

    // --- M7.5 RBAC: admin gate enforced when ADMIN_TOKEN is set ---
    const RBAC_PORT = 3518;
    const RBAC_TOKEN = 'test-admin-secret';
    const rbacSrv = cp.spawn('node', ['server.js'], {
      cwd: __dirname,
      env: Object.assign({}, process.env, { PORT: String(RBAC_PORT), ADMIN_TOKEN: RBAC_TOKEN, RATE_MAX: '100000' })
    });
    const rbacBase = `http://localhost:${RBAC_PORT}`;
    function rbacReq(method, p, headers) {
      return new Promise((resolve, reject) => {
        const r = http.request(rbacBase + p, { method, headers: headers || {} }, (x) => {
          let s = ''; x.on('data', c => s += c); x.on('end', () => resolve({ s: x.statusCode }));
        }); r.on('error', reject); r.end();
      });
    }
    // Wait for the RBAC server to start
    await new Promise((resolve, reject) => {
      let tries = 40;
      const tick = () => rbacReq('GET', '/api/health').then(resolve).catch(() => {
        if (--tries <= 0) return reject(new Error('rbac server never started'));
        setTimeout(tick, 100);
      });
      tick();
    });
    try {
      // No token → 401
      ok('rbac: admin route, no token → 401', (await rbacReq('GET', '/api/admin/backup')).s === 401);
      // Wrong token → 401
      ok('rbac: admin route, wrong token → 401', (await rbacReq('GET', '/api/admin/backup', { Authorization: 'Bearer wrong' })).s === 401);
      // Correct token → 200
      ok('rbac: admin route, correct token → 200', (await rbacReq('GET', '/api/admin/backup', { Authorization: 'Bearer ' + RBAC_TOKEN })).s === 200);
      // Non-admin route unaffected
      ok('rbac: public /api/config still accessible', (await rbacReq('GET', '/api/config')).s === 200);
      ok('rbac: public /api/health still accessible', (await rbacReq('GET', '/api/health')).s === 200);
    } finally {
      rbacSrv.kill();
    }

    // --- M7.6 i18n scaffold ---
    // Extract LOCALES and build t() in Node — mirrors how the browser loads common.js
    function loadI18n(lang) {
      const src = fs.readFileSync(path.join(__dirname, 'public/js/common.js'), 'utf8');
      const m = src.match(/const LOCALES\s*=\s*(\{[\s\S]*?\n\};)/);
      if (!m) throw new Error('LOCALES not found in common.js');
      const LOCALES = new Function('return ' + m[1].slice(0, -1))();
      const dict = Object.assign({}, LOCALES.en, LOCALES[lang] || {});
      return function t(key, ...args) {
        const str = dict[key] !== undefined ? dict[key] : key;
        return str.replace(/\{(\d+)\}/g, (_, i) => args[+i] !== undefined ? String(args[+i]) : '{' + i + '}');
      };
    }
    const tEn = loadI18n('en');
    const tEs = loadI18n('es');
    // English translations
    ok('i18n: en nav.home = Home',          tEn('nav.home') === 'Home', tEn('nav.home'));
    ok('i18n: en nav.services = Services',  tEn('nav.services') === 'Services', tEn('nav.services'));
    ok('i18n: en nav.book-now = Book Now',  tEn('nav.book-now') === 'Book Now', tEn('nav.book-now'));
    ok('i18n: en footer.crafted correct',   tEn('footer.crafted') === 'Crafted with care.', tEn('footer.crafted'));
    ok('i18n: en footer.privacy correct',   tEn('footer.privacy') === 'Privacy Policy', tEn('footer.privacy'));
    // Spanish translations
    ok('i18n: es nav.home = Inicio',        tEs('nav.home') === 'Inicio', tEs('nav.home'));
    ok('i18n: es nav.services = Servicios', tEs('nav.services') === 'Servicios', tEs('nav.services'));
    ok('i18n: es nav.book-now = Reservar',  tEs('nav.book-now') === 'Reservar', tEs('nav.book-now'));
    ok('i18n: es footer.crafted correct',   tEs('footer.crafted') === 'Hecho con cariño.', tEs('footer.crafted'));
    ok('i18n: es lang.switch = English',    tEs('lang.switch') === 'English', tEs('lang.switch'));
    ok('i18n: en lang.switch = Español',    tEn('lang.switch') === 'Español', tEn('lang.switch'));
    // Template substitution
    ok('i18n: en nav.hi substitutes name',  tEn('nav.hi', 'Jordan') === 'Hi, Jordan', tEn('nav.hi', 'Jordan'));
    ok('i18n: es nav.hi substitutes name',  tEs('nav.hi', 'Jordan') === 'Hola, Jordan', tEs('nav.hi', 'Jordan'));
    // Unknown key falls back to the key itself
    ok('i18n: unknown key returns key',     tEn('no.such.key') === 'no.such.key', tEn('no.such.key'));
    // Both locales have the same set of keys
    const i18nSrc = fs.readFileSync(path.join(__dirname, 'public/js/common.js'), 'utf8');
    const localesMatch = i18nSrc.match(/const LOCALES\s*=\s*(\{[\s\S]*?\n\};)/);
    const LOCALES_ALL = new Function('return ' + localesMatch[1].slice(0, -1))();
    const enKeys = Object.keys(LOCALES_ALL.en).sort().join(',');
    const esKeys = Object.keys(LOCALES_ALL.es).sort().join(',');
    ok('i18n: en and es have the same keys', enKeys === esKeys, { en: enKeys, es: esKeys });

    // --- M8 gallery ---
    // GET /api/gallery returns seeded items sorted by sortOrder
    const galList = await req('GET', '/api/gallery');
    ok('M8: GET /api/gallery → 200', galList.s === 200, galList.b);
    ok('M8: gallery has 16 seeded items', Array.isArray(galList.b.gallery) && galList.b.gallery.length === 16, galList.b.gallery && galList.b.gallery.length);
    ok('M8: gallery items sorted by sortOrder', (() => {
      const orders = galList.b.gallery.map(g => g.sortOrder);
      return orders.every((o, i) => i === 0 || o >= orders[i - 1]);
    })(), galList.b.gallery && galList.b.gallery.map(g => g.sortOrder));
    ok('M8: gallery item has required fields', galList.b.gallery[0].id && galList.b.gallery[0].category && galList.b.gallery[0].title);

    // POST /api/admin/gallery/save — create new item
    const galCreate = await req('POST', '/api/admin/gallery/save', { item: { category: 'nails', title: 'Test Tile', emoji: '🔵', caption: 'Test cap', sortOrder: 99 } });
    ok('M8: gallery/save creates item → 200', galCreate.s === 200 && galCreate.b.ok === true, galCreate.b);
    ok('M8: gallery/save returns item with id', typeof galCreate.b.item.id === 'string', galCreate.b.item);
    const galId = galCreate.b.item.id;

    // POST /api/admin/gallery/save — update existing item
    const galUpdate = await req('POST', '/api/admin/gallery/save', { item: { id: galId, category: 'hair', title: 'Updated Tile', emoji: '🟣', sortOrder: 5 } });
    ok('M8: gallery/save updates item → 200', galUpdate.s === 200 && galUpdate.b.item.title === 'Updated Tile', galUpdate.b);
    ok('M8: gallery/save updated category', galUpdate.b.item.category === 'hair', galUpdate.b.item);

    // Validation: title and category are required
    const galBad = await req('POST', '/api/admin/gallery/save', { item: { emoji: '❓' } });
    ok('M8: gallery/save rejects missing title → 400', galBad.s === 400, galBad.b);

    // POST /api/admin/gallery/delete
    const galDel = await req('POST', '/api/admin/gallery/delete', { id: galId });
    ok('M8: gallery/delete → 200 + ok', galDel.s === 200 && galDel.b.ok === true, galDel.b);

    // Verify item is gone
    const galAfter = await req('GET', '/api/gallery');
    ok('M8: deleted item absent from gallery', !galAfter.b.gallery.find(g => g.id === galId), galAfter.b.gallery.length);

    // Delete non-existent item → 404
    const galDel404 = await req('POST', '/api/admin/gallery/delete', { id: 'no-such-id' });
    ok('M8: gallery/delete missing id → 404', galDel404.s === 404, galDel404.b);

    // Missing id field → 400
    const galDelBad = await req('POST', '/api/admin/gallery/delete', {});
    ok('M8: gallery/delete no id field → 400', galDelBad.s === 400, galDelBad.b);

  } catch (e) {
    fail++; console.log('  FAIL harness error →', e.message); if (log) console.log(log);
  } finally {
    srv.kill();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
