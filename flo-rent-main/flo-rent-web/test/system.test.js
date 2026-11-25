'use strict';

/*
 * ชุดทดสอบระบบแบบ end-to-end (ไม่ต้องติดตั้ง dependency)
 *   npm test  →  node --test test/api.test.js test/system.test.js
 *
 * ทดสอบเส้นทางจริงของผู้ใช้บนเซิร์ฟเวอร์จริงในโปรเซสเดียวกัน:
 *   หน้าเว็บ → สมัคร/ล็อกอิน OTP → ลงประกาศ → ค้นหา → จอง → ผู้ให้เช่ายืนยัน
 *   → ผู้เช่าแจ้งคืน → ผู้ให้เช่ายืนยันรับคืน → เงินมัดจำ/ค่าเช่าเข้าบัญชี
 *   พร้อมทางที่ผิด (เงินไม่พอ จองทับวัน ปฏิเสธคำขอ ยกเลิก) และหน้าผู้ดูแลระบบ
 *
 * ข้อมูลแยกจากงานจริงด้วย FLO_DATA_DIR ชั่วคราว และไม่ส่งอีเมลจริงเพราะ NODE_ENV=test
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-rent-system-'));
process.env.FLO_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
process.env.FLO_RATE_LIMIT_PER_MIN = '1000';
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const server = require('../server/server');
const db = require('../server/db');
const seed = require('../server/seed');

let httpServer = null;
let base = '';
let baseOrigin = '';

/* ข้อมูลที่ส่งต่อระหว่างเทสต์ (เรียงตามลำดับการใช้งานจริง) */
const state = {
  owner: null,
  renter: null,
  admin: null,
  item: null,
  secondItem: null,
  expensiveItem: null,
  booking: null,
  rejectedCode: null,
  cancelledCode: null,
  request: null,
  hire: null
};

before(async function () {
  db.init(seed.build);
  httpServer = http.createServer(server.respond);
  await new Promise(function (resolve) { httpServer.listen(0, '127.0.0.1', resolve); });
  base = 'http://127.0.0.1:' + httpServer.address().port;
  baseOrigin = base;
});

after(async function () {
  if (httpServer) await new Promise(function (resolve) { httpServer.close(resolve); });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

function api(method, urlPath, body, options) {
  const opts = options || {};
  const headers = { Accept: 'application/json' };
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  if (opts.origin) headers.Origin = opts.origin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(base + urlPath, {
    method: method,
    headers: headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(async function (response) {
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
    return { status: response.status, body: parsed, text: text, headers: response.headers };
  });
}

function dayFromNow(offset) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function uniqueEmail(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8) + '@example.com';
}

/* บัญชีที่ใช้ทำธุรกรรมในชุดทดสอบต้องผ่านการยืนยันตัวตน — ตั้งสถานะตรงในฐานข้อมูลชั่วคราวของเทสต์ */
function markVerified(email) {
  const user = db.data().users.find(function (entry) { return entry.email === email; });
  assert.ok(user, 'ต้องพบผู้ใช้ ' + email + ' ในฐานข้อมูลทดสอบ');
  user.verify = {
    status: 'verified',
    idMasked: '•••••••••0000',
    reviewedAt: new Date().toISOString(),
    reviewedBy: 'test'
  };
  db.persist();
}

/* สมัครสมาชิกตามขั้นตอนจริง: ขอรหัส OTP → ยืนยัน → สร้างบัญชี */
async function signup(name, email) {
  const requested = await api('POST', '/api/auth/otp/request', { email: email, purpose: 'signup', name: name });
  assert.strictEqual(requested.status, 200, 'ขอ OTP สมัครสมาชิก → ' + requested.status + ' ' + requested.text);
  assert.match(String(requested.body.devCode), /^\d{6}$/);

  const verified = await api('POST', '/api/auth/otp/verify', {
    email: email, code: requested.body.devCode, purpose: 'signup'
  });
  assert.strictEqual(verified.status, 200, verified.text);

  const created = await api('POST', '/api/auth/register', {
    name: name,
    email: email,
    password: 'test-password-1234',
    age: 25,
    signupToken: verified.body.signupToken
  });
  assert.strictEqual(created.status, 201, 'สมัครสมาชิก → ' + created.status + ' ' + created.text);
  markVerified(email);
  return { token: created.body.token, user: created.body.user, email: email };
}

/* ล็อกอินผู้ใช้ทั่วไปด้วยรหัสผ่าน + OTP (ขั้นตอนเดียวกับหน้า login.html) */
async function loginWithPassword(email, password) {
  const login = await api('POST', '/api/auth/login', { email: email, password: password });
  assert.strictEqual(login.status, 200, 'ล็อกอิน → ' + login.status + ' ' + login.text);
  assert.strictEqual(login.body.otpRequired, true, 'ผู้ใช้ทั่วไปต้องยืนยัน OTP ก่อน');
  assert.match(String(login.body.devCode), /^\d{6}$/);
  const verified = await api('POST', '/api/auth/otp/verify', { email: email, code: login.body.devCode });
  assert.strictEqual(verified.status, 200, verified.text);
  return verified.body;
}

async function balanceOf(session) {
  const res = await api('GET', '/api/me', undefined, { token: session.token });
  assert.strictEqual(res.status, 200, res.text);
  return res.body.user;
}

async function createItem(session, fields) {
  const payload = Object.assign({
    title: 'สินค้าทดสอบ',
    cat: 'general',
    price: 100,
    deposit: 0,
    location: 'กรุงเทพฯ',
    desc: 'ใช้ทดสอบระบบ'
  }, fields || {});
  const res = await api('POST', '/api/items', payload, { token: session.token });
  assert.strictEqual(res.status, 201, 'ลงประกาศ → ' + res.status + ' ' + res.text);
  return res.body.item;
}

/* ---------- 1. หน้าเว็บและไฟล์ที่เบราว์เซอร์ต้องโหลดได้ ---------- */

test('หน้าเว็บ: ทุกหน้าหลักและไฟล์ static ตอบ 200 พร้อมชนิดไฟล์ถูกต้อง', async function () {
  const pages = [
    '/', '/index.html', '/browse.html', '/item.html', '/login.html', '/post.html',
    '/bookings.html', '/wallet.html', '/profile.html', '/jobs.html', '/work.html',
    '/look-for.html', '/admin.html'
  ];
  for (const page of pages) {
    const res = await api('GET', page);
    assert.strictEqual(res.status, 200, page + ' ต้องโหลดได้');
    assert.match(String(res.headers.get('content-type')), /text\/html/, page + ' ต้องเป็น HTML');
    assert.match(res.text, /FLO-RENT/, page + ' ต้องมีชื่อเว็บ');
  }

  const css = await api('GET', '/css/style.css');
  assert.strictEqual(css.status, 200);
  assert.match(String(css.headers.get('content-type')), /text\/css/);

  const js = await api('GET', '/js/app.js');
  assert.strictEqual(js.status, 200);
  assert.match(String(js.headers.get('content-type')), /javascript/);

  /* รูปสินค้าตั้งต้นต้องมีอยู่จริง ไม่งั้นหน้าแรกจะเห็นแต่ช่องว่าง */
  for (const file of Object.keys(seed.ITEM_IMAGES)) {
    const image = seed.ITEM_IMAGES[file][0];
    const res = await api('GET', '/' + image);
    assert.strictEqual(res.status, 200, image + ' ต้องมีไฟล์จริง');
    assert.match(String(res.headers.get('content-type')), /^image\//, image + ' ต้องเป็นรูปภาพ');
  }

  const fake = await api('GET', '/not-here.html');
  assert.strictEqual(fake.status, 404);

  /* ห้ามเสิร์ฟไฟล์หลังบ้านหรือไฟล์ซ่อน */
  assert.strictEqual((await api('GET', '/server/server.js')).status, 404);
  assert.strictEqual((await api('GET', '/.env')).status, 404);
  assert.strictEqual((await api('GET', '/package.json')).status, 404);
});

test('API พื้นฐาน: health, หมวดหมู่ และ 404 ของ API', async function () {
  const health = await api('GET', '/api/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.body.ok, true);
  assert.strictEqual(health.body.demo, true, 'โหมดทดสอบต้องเป็นโหมดเดโม');

  const categories = await api('GET', '/api/categories');
  assert.strictEqual(categories.status, 200);
  assert.strictEqual(categories.body.categories.length, 6);
  assert.ok(categories.body.categories.every(function (cat) { return cat.key && cat.name; }));

  const missing = await api('GET', '/api/does-not-exist');
  assert.strictEqual(missing.status, 404);
  assert.ok(missing.body.error);

  const noAuth = await api('GET', '/api/me');
  assert.strictEqual(noAuth.status, 401);
});

/* ---------- 2. ล็อกอินจริง ---------- */

test('ล็อกอิน: สมัครสมาชิก → ใช้ระบบได้ → ออกจากระบบ → รหัสผ่านเดิมต้องยืนยัน OTP อีกครั้ง', async function () {
  state.owner = await signup('เจ้าของทดสอบ', uniqueEmail('owner'));
  assert.strictEqual(state.owner.user.role, 'user');
  assert.strictEqual(state.owner.user.wallet, 3000, 'สมาชิกใหม่ได้เครดิตต้อนรับ 3000 FLO');
  assert.strictEqual(state.owner.user.credit, 70);
  assert.strictEqual(state.owner.user.passHash, undefined, 'ห้ามส่ง hash รหัสผ่านออกไป');

  const me = await api('GET', '/api/me', undefined, { token: state.owner.token });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.user.email, state.owner.email);
  assert.ok(me.body.stats);

  const wrongPassword = await api('POST', '/api/auth/login', {
    email: state.owner.email, password: 'รหัสผิดแน่นอน'
  });
  assert.strictEqual(wrongPassword.status, 401);

  const relogin = await loginWithPassword(state.owner.email, 'test-password-1234');
  assert.ok(relogin.token, 'ต้องได้ token หลังยืนยัน OTP');
  assert.notStrictEqual(relogin.token, state.owner.token, 'ล็อกอินใหม่ต้องได้ session ใหม่');

  const logout = await api('POST', '/api/auth/logout', {}, { token: relogin.token });
  assert.strictEqual(logout.status, 200);
  const afterLogout = await api('GET', '/api/me', undefined, { token: relogin.token });
  assert.strictEqual(afterLogout.status, 401, 'token ที่ออกจากระบบแล้วต้องใช้ไม่ได้');

  /* token เดิมของ session แรกยังใช้ได้ (ออกจากระบบเฉพาะ session ที่กด) */
  const firstStill = await api('GET', '/api/me', undefined, { token: state.owner.token });
  assert.strictEqual(firstStill.status, 200);

  /* เพิ่งขอรหัสไปเมื่อครู่ — ขอซ้ำภายใน 60 วินาทีต้องถูกปฏิเสธ */
  const tooFast = await api('POST', '/api/auth/otp/request', { email: state.owner.email });
  assert.strictEqual(tooFast.status, 429, tooFast.text);
});

test('ล็อกอิน: สมัครอีเมลซ้ำไม่ได้ และเขียนข้อมูลจากโดเมนอื่นถูกบล็อก', async function () {
  const duplicate = await api('POST', '/api/auth/otp/request', {
    email: state.owner.email, purpose: 'signup'
  });
  assert.strictEqual(duplicate.status, 409);

  const foreign = await api('POST', '/api/auth/login', {
    email: state.owner.email, password: 'test-password-1234'
  }, { origin: 'https://evil.example' });
  assert.strictEqual(foreign.status, 403, 'คำขอเขียนจากโดเมนอื่นต้องได้ 403');

  state.renter = await signup('ผู้เช่าทดสอบ', uniqueEmail('renter'));
  assert.strictEqual(state.renter.user.wallet, 3000);
});

/* ---------- 3. ลงประกาศ + ค้นหา ---------- */

test('ประกาศ: ลงประกาศ → เห็นในหน้าเว็บ → ค้นหา/กรอง/แก้ไข/ซ่อน ได้จริง', async function () {
  state.item = await createItem(state.owner, {
    title: 'ชุดไฟสตูดิโอทดสอบ',
    cat: 'crew',
    price: 300,
    deposit: 1000,
    images: ['img/light-studio-kit.jpg'],
    tags: ['ไฟ', 'สตูดิโอ'],
    terms: 'คืนของภายในวันที่ตกลง'
  });
  assert.strictEqual(state.item.status, 'published');
  assert.deepStrictEqual(state.item.images, ['img/light-studio-kit.jpg']);
  assert.strictEqual(state.item.ownerId, state.owner.user.id);

  const list = await api('GET', '/api/items?q=' + encodeURIComponent('ชุดไฟสตูดิโอทดสอบ'));
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.items.length, 1);
  assert.strictEqual(list.body.items[0].id, state.item.id);

  const byCat = await api('GET', '/api/items?cat=crew&limit=100');
  assert.ok(byCat.body.items.every(function (item) { return item.cat === 'crew'; }));

  const sorted = await api('GET', '/api/items?sort=price-asc&limit=100');
  const prices = sorted.body.items.map(function (item) { return item.price; });
  assert.deepStrictEqual(prices, prices.slice().sort(function (a, b) { return a - b; }));

  const detail = await api('GET', '/api/items/' + state.item.id);
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.body.item.title, 'ชุดไฟสตูดิโอทดสอบ');
  assert.deepStrictEqual(detail.body.item.unavailable, [], 'ยังไม่มีการจองจึงต้องว่าง');

  const mine = await api('GET', '/api/items?mine=1&limit=100', undefined, { token: state.owner.token });
  assert.ok(mine.body.items.some(function (item) { return item.id === state.item.id; }));

  const foreignEdit = await api('PATCH', '/api/items/' + state.item.id, {
    price: 1
  }, { token: state.renter.token });
  assert.strictEqual(foreignEdit.status, 403, 'แก้ประกาศคนอื่นไม่ได้');

  const edited = await api('PATCH', '/api/items/' + state.item.id, {
    title: 'ชุดไฟสตูดิโอทดสอบ (ปรับราคา)', price: 300, deposit: 1000
  }, { token: state.owner.token });
  assert.strictEqual(edited.status, 200, edited.text);
  assert.strictEqual(edited.body.item.title, 'ชุดไฟสตูดิโอทดสอบ (ปรับราคา)');

  const hidden = await api('PATCH', '/api/items/' + state.item.id, {
    status: 'hidden'
  }, { token: state.owner.token });
  assert.strictEqual(hidden.status, 200);
  assert.strictEqual((await api('GET', '/api/items/' + state.item.id)).status, 404, 'ประกาศที่ซ่อนต้องไม่เห็นจากคนนอก');

  await api('PATCH', '/api/items/' + state.item.id, { status: 'published' }, { token: state.owner.token });
  assert.strictEqual((await api('GET', '/api/items/' + state.item.id)).status, 200);

  state.secondItem = await createItem(state.owner, {
    title: 'เต็นท์ทดสอบ 4 คน', cat: 'general', price: 100, deposit: 0
  });
  state.expensiveItem = await createItem(state.owner, {
    title: 'ของราคาสูงทดสอบ', cat: 'gadget', price: 5000, deposit: 0
  });
});

/* ---------- 4. จอง ---------- */

test('จอง: ตรวจเงิน/วันที่/สิทธิ์ ก่อนสร้างรายการจริง', async function () {
  /* จองของตัวเองไม่ได้ */
  const own = await api('POST', '/api/bookings', {
    itemId: state.item.id, start: dayFromNow(1), end: dayFromNow(3)
  }, { token: state.owner.token });
  assert.strictEqual(own.status, 400, own.text);

  /* วันที่ผิดรูปแบบ / อดีต / คืนก่อนเริ่ม / ยาวเกิน 90 วัน */
  const badFormat = await api('POST', '/api/bookings', {
    itemId: state.item.id, start: '01/01/2027', end: dayFromNow(3)
  }, { token: state.renter.token });
  assert.strictEqual(badFormat.status, 400);

  const past = await api('POST', '/api/bookings', {
    itemId: state.item.id, start: dayFromNow(-5), end: dayFromNow(2)
  }, { token: state.renter.token });
  assert.strictEqual(past.status, 400);

  const backwards = await api('POST', '/api/bookings', {
    itemId: state.item.id, start: dayFromNow(3), end: dayFromNow(3)
  }, { token: state.renter.token });
  assert.strictEqual(backwards.status, 400);

  const tooLong = await api('POST', '/api/bookings', {
    itemId: state.item.id, start: dayFromNow(1), end: dayFromNow(120)
  }, { token: state.renter.token });
  assert.strictEqual(tooLong.status, 400);

  /* ของราคาสูงเกินเงินในกระเป๋า → 402 */
  const poor = await api('POST', '/api/bookings', {
    itemId: state.expensiveItem.id, start: dayFromNow(1), end: dayFromNow(3)
  }, { token: state.renter.token });
  assert.strictEqual(poor.status, 402, poor.text);

  const noAuth = await api('POST', '/api/bookings', {
    itemId: state.item.id, start: dayFromNow(1), end: dayFromNow(3)
  });
  assert.strictEqual(noAuth.status, 401);
});

test('จอง: หักเงินในกระเป๋า กันมัดจำ และจองทับวันเดิมไม่ได้', async function () {
  const before = await balanceOf(state.renter);
  assert.strictEqual(before.wallet, 3000);

  const start = dayFromNow(5);
  const end = dayFromNow(7);
  const res = await api('POST', '/api/bookings', {
    itemId: state.item.id, start: start, end: end
  }, { token: state.renter.token });
  assert.strictEqual(res.status, 201, res.text);

  state.booking = res.body.booking;
  assert.strictEqual(state.booking.status, 'pending');
  assert.strictEqual(state.booking.days, 2);
  assert.strictEqual(state.booking.total, 300 * 2 + 1000, 'ค่าเช่า 2 วัน + มัดจำ');
  assert.strictEqual(res.body.wallet, 3000 - 1600, 'ต้องหักเงินทันทีที่จอง');

  const wallet = await api('GET', '/api/wallet', undefined, { token: state.renter.token });
  assert.strictEqual(wallet.status, 200);
  assert.strictEqual(wallet.body.balance, 1400);
  assert.strictEqual(wallet.body.holds.length, 1, 'ต้องมีมัดจำถูกกันไว้ 1 รายการ');
  assert.strictEqual(wallet.body.holds[0].bookingCode, state.booking.code);
  assert.ok(wallet.body.transactions.some(function (tx) {
    return tx.type === 'hold' && tx.ref === state.booking.code && tx.amount === -1600;
  }));

  const clash = await api('POST', '/api/bookings', {
    itemId: state.item.id, start: dayFromNow(6), end: dayFromNow(8)
  }, { token: state.renter.token });
  assert.strictEqual(clash.status, 409, 'ช่วงวันทับกันต้องถูกปฏิเสธ');

  const detail = await api('GET', '/api/items/' + state.item.id);
  assert.ok(detail.body.item.unavailable.indexOf(dayFromNow(5)) !== -1, 'ปฏิทินต้องแสดงวันที่ถูกจอง');

  const mine = await api('GET', '/api/bookings?limit=100', undefined, { token: state.renter.token });
  assert.ok(mine.body.bookings.some(function (booking) { return booking.code === state.booking.code; }));

  const otherOwners = await api('GET', '/api/owner/bookings?limit=100', undefined, { token: state.owner.token });
  assert.strictEqual(otherOwners.status, 200);
  assert.ok(otherOwners.body.pending >= 1);
  assert.ok(otherOwners.body.bookings.some(function (booking) { return booking.code === state.booking.code; }));
});

/* ---------- 5. ผู้ให้เช่ายืนยัน + ผู้เช่าแจ้งคืน + เจ้าของรับคืน ---------- */

test('จอง: ผู้ให้เช่ายืนยันแล้วจึงเริ่มเช่า และผู้เช่าแจ้งคืนได้', async function () {
  const beforeConfirm = await api('PATCH', '/api/bookings/' + state.booking.code, {
    action: 'return'
  }, { token: state.renter.token });
  assert.strictEqual(beforeConfirm.status, 409, 'ยังไม่ยืนยันต้องแจ้งคืนไม่ได้');

  const foreignConfirm = await api('PATCH', '/api/owner/bookings/' + state.booking.code, {
    action: 'confirm'
  }, { token: state.renter.token });
  assert.strictEqual(foreignConfirm.status, 403, 'ผู้เช่ายืนยันแทนเจ้าของไม่ได้');

  const ownerBefore = await balanceOf(state.owner);
  const confirm = await api('PATCH', '/api/owner/bookings/' + state.booking.code, {
    action: 'confirm'
  }, { token: state.owner.token });
  assert.strictEqual(confirm.status, 200, confirm.text);
  assert.strictEqual(confirm.body.booking.status, 'active');

  const ownerAfter = await balanceOf(state.owner);
  assert.strictEqual(ownerAfter.credit, Math.min(100, ownerBefore.credit + 1), 'เจ้าของได้เครดิตเพิ่มเมื่อยืนยัน');

  const again = await api('PATCH', '/api/owner/bookings/' + state.booking.code, {
    action: 'confirm'
  }, { token: state.owner.token });
  assert.strictEqual(again.status, 409, 'ยืนยันซ้ำไม่ได้');

  const returnRes = await api('PATCH', '/api/bookings/' + state.booking.code, {
    action: 'return'
  }, { token: state.renter.token });
  assert.strictEqual(returnRes.status, 200, returnRes.text);
  assert.strictEqual(returnRes.body.booking.status, 'return_requested');

  const secondReturn = await api('PATCH', '/api/bookings/' + state.booking.code, {
    action: 'return'
  }, { token: state.renter.token });
  assert.strictEqual(secondReturn.status, 409);

  const renterNow = await balanceOf(state.renter);
  assert.strictEqual(renterNow.wallet, 1400, 'แจ้งคืนแล้วยังไม่ได้เงินคืน');

  const pendingReturns = await api('GET', '/api/owner/bookings?status=return_requested', undefined, { token: state.owner.token });
  assert.ok(pendingReturns.body.returnRequests >= 1);
  assert.ok(pendingReturns.body.bookings.some(function (booking) { return booking.code === state.booking.code; }));
});

test('คืนของ: เจ้าของโต้แย้งได้ แล้วเมื่อรับคืนจริงเงินจึงถูกจ่ายครบ', async function () {
  const noNote = await api('PATCH', '/api/owner/bookings/' + state.booking.code, {
    action: 'dispute'
  }, { token: state.owner.token });
  assert.strictEqual(noNote.status, 400, 'ต้องมีเหตุผลประกอบ');

  const dispute = await api('PATCH', '/api/owner/bookings/' + state.booking.code, {
    action: 'dispute', note: 'ยังไม่ได้รับของคืน'
  }, { token: state.owner.token });
  assert.strictEqual(dispute.status, 200, dispute.text);
  assert.strictEqual(dispute.body.booking.status, 'active');
  assert.strictEqual(dispute.body.booking.disputeNote, 'ยังไม่ได้รับของคืน');

  const holdStill = await api('GET', '/api/wallet', undefined, { token: state.renter.token });
  assert.strictEqual(holdStill.body.holds.length, 1, 'โต้แย้งแล้วมัดจำยังถูกกันไว้');

  const returnAgain = await api('PATCH', '/api/bookings/' + state.booking.code, {
    action: 'return'
  }, { token: state.renter.token });
  assert.strictEqual(returnAgain.status, 200, returnAgain.text);

  const ownerBefore = await balanceOf(state.owner);
  const renterBefore = await balanceOf(state.renter);
  const receive = await api('PATCH', '/api/owner/bookings/' + state.booking.code, {
    action: 'receive'
  }, { token: state.owner.token });
  assert.strictEqual(receive.status, 200, receive.text);
  assert.strictEqual(receive.body.booking.status, 'returned');
  assert.strictEqual(receive.body.booking.receivedBy, state.owner.user.id);

  const ownerAfter = await balanceOf(state.owner);
  const renterAfter = await balanceOf(state.renter);
  assert.strictEqual(ownerAfter.wallet, ownerBefore.wallet + 600, 'เจ้าของได้ค่าเช่า 2 วัน');
  assert.strictEqual(renterAfter.wallet, renterBefore.wallet + 1000, 'ผู้เช่าได้มัดจำคืน');

  const wallet = await api('GET', '/api/wallet', undefined, { token: state.renter.token });
  assert.strictEqual(wallet.body.holds.length, 0, 'ต้องไม่มีมัดจำค้าง');

  const double = await api('PATCH', '/api/owner/bookings/' + state.booking.code, {
    action: 'receive'
  }, { token: state.owner.token });
  assert.strictEqual(double.status, 409, 'รับคืนซ้ำต้องไม่จ่ายเงินซ้ำ');

  const detail = await api('GET', '/api/items/' + state.item.id);
  assert.deepStrictEqual(detail.body.item.unavailable, [], 'คืนของแล้ววันต้องว่างอีกครั้ง');
});

/* ---------- 6. ยกเลิก / ปฏิเสธคำขอ ---------- */

test('ยกเลิก: ผู้เช่ายกเลิกเองได้เงินคืนเต็มจำนวน และเจ้าของปฏิเสธก็คืนเงินให้ผู้เช่า', async function () {
  const before = await balanceOf(state.renter);

  const created = await api('POST', '/api/bookings', {
    itemId: state.secondItem.id, start: dayFromNow(10), end: dayFromNow(12)
  }, { token: state.renter.token });
  assert.strictEqual(created.status, 201, created.text);
  state.cancelledCode = created.body.booking.code;
  assert.strictEqual(created.body.wallet, before.wallet - 200);

  const cancel = await api('PATCH', '/api/bookings/' + state.cancelledCode, {
    action: 'cancel'
  }, { token: state.renter.token });
  assert.strictEqual(cancel.status, 200, cancel.text);
  assert.strictEqual(cancel.body.booking.status, 'cancelled');
  assert.strictEqual(cancel.body.wallet, before.wallet, 'ยกเลิกแล้วต้องได้เงินคืนทั้งหมด');

  const cancelAgain = await api('PATCH', '/api/bookings/' + state.cancelledCode, {
    action: 'cancel'
  }, { token: state.renter.token });
  assert.strictEqual(cancelAgain.status, 409);

  const rejected = await api('POST', '/api/bookings', {
    itemId: state.secondItem.id, start: dayFromNow(14), end: dayFromNow(16)
  }, { token: state.renter.token });
  assert.strictEqual(rejected.status, 201, rejected.text);
  state.rejectedCode = rejected.body.booking.code;

  const reject = await api('PATCH', '/api/owner/bookings/' + state.rejectedCode, {
    action: 'reject'
  }, { token: state.owner.token });
  assert.strictEqual(reject.status, 200, reject.text);
  assert.strictEqual(reject.body.booking.status, 'cancelled');
  assert.strictEqual(reject.body.booking.cancelledBy, 'owner');

  const after = await balanceOf(state.renter);
  assert.strictEqual(after.wallet, before.wallet, 'ถูกปฏิเสธต้องได้เงินคืนเต็มจำนวน');

  const wallet = await api('GET', '/api/wallet', undefined, { token: state.renter.token });
  assert.strictEqual(wallet.body.holds.length, 0, 'ไม่มีมัดจำค้างหลังคืนเงิน');
});

test('ยกเลิก: การจองที่เริ่มแล้วยกเลิกเองไม่ได้', async function () {
  const created = await api('POST', '/api/bookings', {
    itemId: state.secondItem.id, start: dayFromNow(20), end: dayFromNow(22)
  }, { token: state.renter.token });
  assert.strictEqual(created.status, 201, created.text);

  await api('PATCH', '/api/owner/bookings/' + created.body.booking.code, {
    action: 'confirm'
  }, { token: state.owner.token });

  const cancel = await api('PATCH', '/api/bookings/' + created.body.booking.code, {
    action: 'cancel'
  }, { token: state.renter.token });
  assert.strictEqual(cancel.status, 409, 'กำลังเช่าอยู่ต้องใช้ขั้นตอนคืนของ');

  const force = await api('PATCH', '/api/bookings/' + created.body.booking.code, {
    action: 'return'
  }, { token: state.renter.token });
  assert.strictEqual(force.status, 200, force.text);
});

/* ---------- 7. กระเป๋าเงิน ---------- */

test('กระเป๋าเงิน: เติมเงินได้ ตรวจยอดตรง และปฏิเสธจำนวนที่ไม่สมเหตุสมผล', async function () {
  const before = await api('GET', '/api/wallet', undefined, { token: state.renter.token });
  assert.strictEqual(before.body.minBookingCredit, 40);
  assert.ok(before.body.level && before.body.level.label);

  const topup = await api('POST', '/api/wallet/topup', { amount: 500 }, { token: state.renter.token });
  assert.strictEqual(topup.status, 201, topup.text);
  assert.strictEqual(topup.body.balance, before.body.balance + 500);
  assert.strictEqual(topup.body.transaction.type, 'topup');

  const me = await balanceOf(state.renter);
  assert.strictEqual(me.wallet, topup.body.balance);

  assert.strictEqual((await api('POST', '/api/wallet/topup', { amount: 0 }, { token: state.renter.token })).status, 400);
  assert.strictEqual((await api('POST', '/api/wallet/topup', { amount: 999999 }, { token: state.renter.token })).status, 400);
  assert.strictEqual((await api('POST', '/api/wallet/topup', { amount: 100 })).status, 401);
});

/* ---------- 8. คำขอตามหา + ข้อเสนอ ---------- */

test('ตามหาของ: ตั้งคำขอ → เจ้าของประกาศเสนอของ → กันข้อเสนอซ้ำ', async function () {
  const created = await api('POST', '/api/requests', {
    want: 'ต้องการเช่าเต็นท์สำหรับทริป', cat: 'general', budget: 150, when: 'เดือนหน้า', name: 'ผู้เช่าทดสอบ'
  }, { token: state.renter.token });
  assert.strictEqual(created.status, 201, created.text);
  state.request = created.body.request;
  assert.strictEqual(state.request.userId, state.renter.user.id);
  assert.strictEqual(state.request.offerCount, 0);

  const ownOffer = await api('POST', '/api/requests/' + state.request.id + '/offers', {
    itemId: state.secondItem.id
  }, { token: state.renter.token });
  assert.strictEqual(ownOffer.status, 400, 'เสนอของให้คำขอตัวเองไม่ได้');

  const offer = await api('POST', '/api/requests/' + state.request.id + '/offers', {
    itemId: state.secondItem.id, note: 'เต็นท์ 4 คนพร้อมใช้'
  }, { token: state.owner.token });
  assert.strictEqual(offer.status, 201, offer.text);
  assert.strictEqual(offer.body.request.offerCount, 1);

  const duplicate = await api('POST', '/api/requests/' + state.request.id + '/offers', {
    itemId: state.secondItem.id
  }, { token: state.owner.token });
  assert.strictEqual(duplicate.status, 409);

  const asOwnerOfRequest = await api('GET', '/api/requests?limit=100', undefined, { token: state.renter.token });
  const mine = asOwnerOfRequest.body.requests.find(function (item) { return item.id === state.request.id; });
  assert.ok(mine, 'ต้องเห็นคำขอของตัวเอง');
  assert.strictEqual(mine.offers.length, 1);
  assert.strictEqual(mine.offers[0].itemTitle, 'เต็นท์ทดสอบ 4 คน');

  const asStranger = await api('GET', '/api/requests?limit=100');
  const publicView = asStranger.body.requests.find(function (item) { return item.id === state.request.id; });
  assert.strictEqual(publicView.offers.length, 0, 'คนนอกไม่ควรเห็นรายละเอียดข้อเสนอ');
  assert.strictEqual(publicView.offerCount, 1);
});

/* ---------- 9. งาน / จ้างคนทำงาน ---------- */

test('จ้างงาน: ประกาศงาน → จ้างคนทำงาน → ยกเลิกแล้วได้เงินคืน', async function () {
  const categories = await api('GET', '/api/work-categories');
  assert.strictEqual(categories.status, 200);
  assert.ok(categories.body.categories.length >= 11);

  const workers = await api('GET', '/api/workers');
  assert.strictEqual(workers.status, 200);
  assert.ok(workers.body.workers.length >= 12, 'ต้องมีคนทำงานให้เลือก');

  const job = await api('POST', '/api/jobs', {
    title: 'หาช่างภาพงานอีเวนต์', cat: 'producer', rate: 2000, days: 2, location: 'กรุงเทพฯ'
  }, { token: state.owner.token });
  assert.strictEqual(job.status, 201, job.text);

  const myJobs = await api('GET', '/api/jobs?mine=1', undefined, { token: state.owner.token });
  assert.ok(myJobs.body.jobs.some(function (entry) { return entry.id === job.body.job.id; }));

  const worker = workers.body.workers.find(function (entry) { return entry.id === 'wk-noi'; }) || workers.body.workers[0];
  const before = await balanceOf(state.renter);
  const hire = await api('POST', '/api/hires', {
    workerId: worker.id, days: 1, start: dayFromNow(3)
  }, { token: state.renter.token });
  assert.strictEqual(hire.status, 201, hire.text);
  assert.strictEqual(hire.body.hire.total, worker.rate);
  assert.strictEqual(hire.body.wallet, before.wallet - worker.rate);

  const hires = await api('GET', '/api/hires', undefined, { token: state.renter.token });
  assert.ok(hires.body.hires.some(function (entry) { return entry.code === hire.body.hire.code; }));

  const cancel = await api('PATCH', '/api/hires/' + hire.body.hire.code, { action: 'cancel' }, { token: state.renter.token });
  assert.strictEqual(cancel.status, 200, cancel.text);
  assert.strictEqual(cancel.body.hire.status, 'cancelled');
  assert.strictEqual(cancel.body.wallet, before.wallet, 'ยกเลิกการจ้างต้องได้เงินคืน');

  const cancelAgain = await api('PATCH', '/api/hires/' + hire.body.hire.code, { action: 'cancel' }, { token: state.renter.token });
  assert.strictEqual(cancelAgain.status, 409);

  const foreign = await api('PATCH', '/api/hires/' + hire.body.hire.code, { action: 'cancel' }, { token: state.owner.token });
  assert.strictEqual(foreign.status, 403);
});

/* ---------- 10. แอดมิน ---------- */

test('แอดมิน: เข้าได้ด้วยรหัสผ่านโดยตรง และเห็นภาพรวมระบบ', async function () {
  const admin = await api('POST', '/api/auth/login', {
    email: 'admin@flo-rent.co', password: 'admin1234'
  });
  assert.strictEqual(admin.status, 200, admin.text);
  assert.strictEqual(admin.body.user.role, 'admin');
  assert.ok(admin.body.token);
  state.admin = { token: admin.body.token, user: admin.body.user };

  const stats = await api('GET', '/api/admin/stats', undefined, { token: state.admin.token });
  assert.strictEqual(stats.status, 200);
  assert.ok(stats.body.users >= 3);
  assert.ok(stats.body.items >= 3);
  assert.strictEqual(stats.body.byStatus.returned >= 1, true, 'ต้องมีการจองที่คืนสำเร็จแล้ว');

  const bookings = await api('GET', '/api/admin/bookings?status=returned', undefined, { token: state.admin.token });
  assert.ok(bookings.body.bookings.some(function (booking) { return booking.code === state.booking.code; }));

  const wallet = await api('GET', '/api/admin/wallet', undefined, { token: state.admin.token });
  assert.strictEqual(wallet.status, 200);
  assert.ok(wallet.body.summary.wallets >= 0);
  assert.strictEqual(wallet.body.summary.escrow, wallet.body.holds.reduce(function (sum, hold) {
    return sum + hold.rent + hold.deposit;
  }, 0), 'ยอด escrow ต้องตรงกับมัดจำที่ค้าง');

  const logs = await api('GET', '/api/admin/logs?limit=20', undefined, { token: state.admin.token });
  assert.strictEqual(logs.status, 200);
  assert.ok(logs.body.logs.length > 0);

  assert.strictEqual((await api('GET', '/api/admin/stats', undefined, { token: state.renter.token })).status, 403);
  assert.strictEqual((await api('GET', '/api/admin/stats')).status, 401);
});

test('แอดมิน: จัดการหมวดหมู่และระงับบัญชีได้จริง', async function () {
  const created = await api('POST', '/api/admin/categories', {
    kind: 'items', name: 'หมวดทดสอบ', emoji: '🧪', sub: 'สำหรับทดสอบ'
  }, { token: state.admin.token });
  assert.strictEqual(created.status, 201, created.text);
  const key = created.body.category.key;

  const duplicate = await api('POST', '/api/admin/categories', {
    kind: 'items', name: 'หมวดทดสอบ'
  }, { token: state.admin.token });
  assert.strictEqual(duplicate.status, 409);

  const renamed = await api('PATCH', '/api/admin/categories/items/' + key, {
    name: 'หมวดทดสอบเปลี่ยนชื่อ'
  }, { token: state.admin.token });
  assert.strictEqual(renamed.status, 200, renamed.text);
  assert.strictEqual(renamed.body.category.name, 'หมวดทดสอบเปลี่ยนชื่อ');

  const removed = await api('DELETE', '/api/admin/categories/items/' + key, undefined, { token: state.admin.token });
  assert.strictEqual(removed.status, 200, removed.text);
  assert.strictEqual(removed.body.ok, true);

  const inUse = await api('DELETE', '/api/admin/categories/items/crew', undefined, { token: state.admin.token });
  assert.strictEqual(inUse.status, 409, 'ลบหมวดที่มีสินค้าอยู่ไม่ได้');

  const eve = await signup('ผู้ใช้ที่ถูกระงับ', uniqueEmail('eve'));
  const suspend = await api('PATCH', '/api/admin/users/' + eve.user.id, {
    status: 'suspended'
  }, { token: state.admin.token });
  assert.strictEqual(suspend.status, 200, suspend.text);
  assert.strictEqual(suspend.body.user.status, 'suspended');

  assert.strictEqual((await api('GET', '/api/me', undefined, { token: eve.token })).status, 401, 'ระงับแล้ว session ต้องถูกตัด');
  const blocked = await api('POST', '/api/auth/login', { email: eve.email, password: 'test-password-1234' });
  assert.strictEqual(blocked.status, 403);

  const self = await api('PATCH', '/api/admin/users/' + state.admin.user.id, {
    status: 'suspended'
  }, { token: state.admin.token });
  assert.strictEqual(self.status, 400, 'ระงับบัญชีตัวเองไม่ได้');
});

/* ---------- 11. ความถูกต้องของข้อมูลที่ส่งออก ---------- */

test('ความปลอดภัย: ไม่มีรหัสผ่าน/รหัส OTP หลุดออกไปใน response', async function () {
  const items = await api('GET', '/api/items?limit=100');
  const text = JSON.stringify(items.body) + JSON.stringify(db.data().bookings) + JSON.stringify(db.data().users.map(function (user) {
    return { email: user.email, status: user.status };
  }));
  assert.strictEqual(text.indexOf('passHash'), -1);
  assert.strictEqual(text.indexOf('codeHash'), -1);

  const me = await api('GET', '/api/me', undefined, { token: state.renter.token });
  assert.strictEqual(me.body.user.passHash, undefined);
  assert.strictEqual(me.body.user.codeHash, undefined);

  /* รหัส OTP และ signup token ต้องถูกเก็บเป็น hash เท่านั้น */
  assert.ok(db.data().otps.length > 0);
  db.data().otps.forEach(function (entry) {
    assert.strictEqual(entry.code, undefined, 'ห้ามเก็บรหัส OTP เป็นข้อความตรง ๆ');
    if (entry.codeHash) assert.match(String(entry.codeHash), /^[a-f0-9]{64}$/);
    if (entry.signupTokenHash) assert.match(String(entry.signupTokenHash), /^[a-f0-9]{64}$/);
  });
});

/* ---------- 12. แคตตาล็อกบน production / Vercel (เคสที่หน้าแรกว่าง) ---------- */

function freePort() {
  return 42000 + Math.floor(Math.random() * 3000);
}

/* รันเซิร์ฟเวอร์แยกโปรเซสในโหมด production เพื่อทดสอบพฤติกรรมจริงบน Vercel */
async function startProductionServer(extraEnv) {
  const port = freePort();
  const env = Object.assign({}, process.env, {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    FLO_RATE_LIMIT_PER_MIN: '1000'
  }, extraEnv);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', function (chunk) { output += chunk; });
  child.stderr.on('data', function (chunk) { output += chunk; });

  const base = 'http://127.0.0.1:' + port;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(base + '/api/health');
      if (res.ok) return { child: child, base: base, output: function () { return output; } };
    } catch (err) { /* ยังไม่พร้อม */ }
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
  child.kill();
  throw new Error('เซิร์ฟเวอร์ production ไม่ขึ้น: ' + output);
}

async function stopProductionServer(started, dir) {
  try { started.child.kill(); } catch (err) { /* ไม่เป็นไร */ }
  fs.rmSync(dir, { recursive: true, force: true });
}

function productionDb(items) {
  return {
    version: 1,
    users: [{
      id: 'u-admin', name: 'ผู้ดูแล FLO-RENT', email: 'owner@example.com', passHash: 'x',
      role: 'admin', status: 'active', wallet: 0, credit: 90, joinedAt: new Date().toISOString()
    }],
    sessions: [], otps: [], items: items, categories: [], jobCategories: [],
    bookings: [], requests: [], jobs: [], workers: [], hires: [],
    ledger: [], holds: [], logs: [], meta: {}
  };
}

test('production: ค่าเริ่มต้นของแคตตาล็อกขึ้นกับสภาพแวดล้อม', function () {
  const before = {
    nodeEnv: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
    flag: process.env.FLO_SEED_CATALOG
  };
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;
    delete process.env.FLO_SEED_CATALOG;
    assert.strictEqual(seed.wantsCatalog(false), false, 'production ธรรมดาเริ่มจากศูนย์');
    assert.strictEqual(seed.build().items.length, 0);

    process.env.VERCEL = '1';
    assert.strictEqual(seed.wantsCatalog(false), true, 'บน Vercel เปิดเป็นค่าเริ่มต้น');
    const items = seed.build().items;
    assert.strictEqual(items.length, 16);
    assert.ok(items.every(function (item) {
      return item.status === 'published' && item.images.length === 1 && item.title && item.price > 0;
    }));

    process.env.FLO_SEED_CATALOG = '0';
    assert.strictEqual(seed.wantsCatalog(false), false, 'FLO_SEED_CATALOG=0 ปิดได้');
    assert.strictEqual(seed.build().items.length, 0);

    process.env.FLO_SEED_CATALOG = '1';
    delete process.env.VERCEL;
    assert.strictEqual(seed.build().items.length, 16, 'FLO_SEED_CATALOG=1 เปิดได้บนเซิร์ฟเวอร์ปกติ');

    const catalog = seed.catalogItems('u-admin', 'ผู้ดูแล FLO-RENT');
    assert.strictEqual(catalog.length, 16);
    assert.ok(catalog.every(function (item) {
      return item.ownerId === 'u-admin' && item.owner === 'ผู้ดูแล FLO-RENT' && item.status === 'published';
    }));
  } finally {
    if (before.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before.nodeEnv;
    if (before.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = before.vercel;
    if (before.flag === undefined) delete process.env.FLO_SEED_CATALOG; else process.env.FLO_SEED_CATALOG = before.flag;
  }
});

test('production บน Vercel: หน้าแรกมีสินค้าตั้งต้นแม้ไม่ได้ตั้ง FLO_SEED_CATALOG', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-rent-vercel-'));
  const started = await startProductionServer({
    VERCEL: '1',
    FLO_DATA_DIR: dir,
    FLO_SEED_CATALOG: '',
    FLO_ADMIN_EMAIL: 'owner@example.com',
    FLO_ADMIN_PASSWORD: 'strong-admin-pass-1234'
  });
  try {
    const items = await (await fetch(started.base + '/api/items?limit=100')).json();
    assert.strictEqual(items.total, 16, 'ต้องมีสินค้าให้แสดงบนหน้าแรก');
    assert.ok(items.items.every(function (item) { return item.status === 'published'; }));
    assert.strictEqual(items.items[0].owner, 'ผู้ดูแล FLO-RENT', 'สินค้าเป็นของบัญชีแอดมิน');

    const page = await (await fetch(started.base + '/')).text();
    assert.match(page, /ของยอดนิยม/);
  } finally {
    await stopProductionServer(started, dir);
  }
});

test('production: ฐานข้อมูลเก่าที่มี items ว่างถูกเติมแคตตาล็อกคืนทันที', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-rent-stale-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(productionDb([])), 'utf8');
  const started = await startProductionServer({
    VERCEL: '1',
    FLO_DATA_DIR: dir,
    FLO_SEED_CATALOG: ''
  });
  try {
    const items = await (await fetch(started.base + '/api/items?limit=100')).json();
    assert.strictEqual(items.total, 16, 'ฐานข้อมูลว่างต้องถูกเติมคืน ไม่ปล่อยหน้าแรกว่าง');
    assert.ok(items.items.every(function (item) {
      return item.ownerId === 'u-admin' && item.owner === 'ผู้ดูแล FLO-RENT';
    }));
  } finally {
    await stopProductionServer(started, dir);
  }
});

test('production: FLO_SEED_CATALOG=0 ปิดแคตตาล็อกได้จริง', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-rent-off-'));
  const started = await startProductionServer({
    VERCEL: '1',
    FLO_DATA_DIR: dir,
    FLO_SEED_CATALOG: '0'
  });
  try {
    const items = await (await fetch(started.base + '/api/items?limit=100')).json();
    assert.strictEqual(items.total, 0, 'ตั้งใจปิดก็ต้องว่างจริง');
  } finally {
    await stopProductionServer(started, dir);
  }
});
