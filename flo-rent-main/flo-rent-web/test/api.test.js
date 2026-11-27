'use strict';

/*
 * ชุดทดสอบขั้นต่ำ (ไม่ต้องติดตั้ง dependency)
 *   npm test        →  node --test
 *
 * รันเซิร์ฟเวอร์จริงในโปรเซสเดียวกันโดยชี้ FLO_DATA_DIR ไปที่โฟลเดอร์ชั่วคราว
 * จึงไม่ไปยุ่งกับ server/data/db.json ของงานจริง
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-rent-test-'));
process.env.FLO_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
/* ชุดทดสอบยิงคำขอ OTP หลายครั้งจาก IP เดียว (127.0.0.1) — ผ่อนเพดานเฉพาะตอนทดสอบ */
process.env.FLO_RATE_LIMIT_PER_MIN = '1000';
/* ต้องตั้งก่อน require เซิร์ฟเวอร์: ใช้ตรวจว่า OTP ถูก hash ด้วย HMAC + secret นี้จริง */
process.env.FLO_OTP_SECRET = 'test-otp-secret-for-hmac';
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const server = require('../server/server');
const db = require('../server/db');
const seed = require('../server/seed');

let httpServer = null;
let base = '';
let baseOrigin = '';

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
    return { status: response.status, body: parsed, text: text };
  });
}

function dayFromNow(offset) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/* สมัครสมาชิกต้องยืนยันอีเมลก่อน: ขอรหัส → ยืนยัน → ได้ signupToken */
async function signupTokenFor(name, email) {
  const requested = await api('POST', '/api/auth/otp/request', { email: email, purpose: 'signup', name: name });
  assert.strictEqual(requested.status, 200, 'otp signup ' + email + ' → ' + requested.status + ' ' + requested.text);
  assert.match(String(requested.body.devCode), /^\d{6}$/);
  const verified = await api('POST', '/api/auth/otp/verify', {
    email: email, code: requested.body.devCode, purpose: 'signup'
  });
  assert.strictEqual(verified.status, 200, verified.text);
  assert.ok(verified.body.signupToken, 'ต้องได้ signupToken หลังยืนยันอีเมล');
  return verified.body.signupToken;
}

/* ล็อกอินด้วย OTP: ผู้ใช้ทั่วไปไม่ได้ session จากรหัสผ่านตรง ๆ */
async function loginOtp(email) {
  const requested = await api('POST', '/api/auth/otp/request', { email: email });
  assert.strictEqual(requested.status, 200, 'otp login ' + email + ' → ' + requested.status + ' ' + requested.text);
  assert.match(String(requested.body.devCode), /^\d{6}$/);
  const verified = await api('POST', '/api/auth/otp/verify', { email: email, code: requested.body.devCode });
  assert.strictEqual(verified.status, 200, verified.text);
  assert.ok(verified.body.token, 'ยืนยัน OTP แล้วต้องได้ token');
  return verified.body;
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

async function register(name, email) {
  const signupToken = await signupTokenFor(name, email);
  const res = await api('POST', '/api/auth/register', {
    name: name,
    email: email,
    password: 'test-password-1234',
    age: 25,
    signupToken: signupToken
  });
  assert.strictEqual(res.status, 201, 'register ' + email + ' → ' + res.status + ' ' + res.text);
  markVerified(email);
  return res.body;
}

/* ---------- 1. ไม่มีบัญชีทดลองบน production ---------- */

test('seed: production ไม่มีบัญชีทดลองและไม่ใช้รหัสผ่านสำรอง', function () {
  const env = process.env.NODE_ENV;
  const email = process.env.FLO_ADMIN_EMAIL;
  const password = process.env.FLO_ADMIN_PASSWORD;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.FLO_ADMIN_EMAIL;
    delete process.env.FLO_ADMIN_PASSWORD;

    const data = seed.build();
    assert.deepStrictEqual(data.users, [], 'production ต้องไม่มีผู้ใช้ seed');
    assert.deepStrictEqual(data.items, [], 'production ต้องไม่มีสินค้าตัวอย่าง');
    assert.deepStrictEqual(data.bookings, [], 'production ต้องไม่มีการจองตัวอย่าง');
    assert.deepStrictEqual(data.holds, [], 'production ต้องไม่มี escrow ตัวอย่าง');

    process.env.FLO_ADMIN_EMAIL = 'owner@example.com';
    process.env.FLO_ADMIN_PASSWORD = 'strong-admin-pass';
    const withAdmin = seed.build();
    assert.strictEqual(withAdmin.users.length, 1);
    assert.strictEqual(withAdmin.users[0].role, 'admin');
    assert.strictEqual(withAdmin.users[0].email, 'owner@example.com');
    assert.ok(withAdmin.users[0].passHash.indexOf('scrypt$') === 0, 'ต้องเก็บเป็น scrypt hash');

    process.env.FLO_ADMIN_PASSWORD = 'short';
    assert.throws(function () { seed.build(); }, /FLO_ADMIN_PASSWORD/);
  } finally {
    if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
    if (email === undefined) delete process.env.FLO_ADMIN_EMAIL; else process.env.FLO_ADMIN_EMAIL = email;
    if (password === undefined) delete process.env.FLO_ADMIN_PASSWORD; else process.env.FLO_ADMIN_PASSWORD = password;
  }
});

test('seed: โหมดเดโม (ไม่ใช่ production) ยังมีบัญชีทดลองไว้ใช้งานในเครื่อง', function () {
  const data = seed.build();
  const emails = data.users.map(function (user) { return user.email; });
  assert.ok(emails.indexOf('admin@flo-rent.co') !== -1);
  assert.ok(emails.indexOf('demo@flo-rent.co') !== -1);
});

/* ---------- 2. ตรวจ Origin ---------- */

test('origin: คำขอเขียนจากโดเมนอื่นถูกปฏิเสธ แต่ same-origin ผ่าน', async function () {
  const email = 'same-' + Date.now() + '@example.com';
  const signupToken = await signupTokenFor('ผู้ใช้จริง', email);
  const body = {
    name: 'ผู้ใช้จริง', email: email, password: 'test-password-1234', age: 20, signupToken: signupToken
  };

  const foreign = await api('POST', '/api/auth/register', body, { origin: 'https://evil.example' });
  assert.strictEqual(foreign.status, 403, 'ต้องได้ 403 จาก foreign origin');

  const same = await api('POST', '/api/auth/register', body, { origin: baseOrigin });
  assert.strictEqual(same.status, 201, 'same-origin ต้องผ่าน: ' + same.text);
});

test('auth: GET /api/me ต้องมี token', async function () {
  const res = await api('GET', '/api/me');
  assert.strictEqual(res.status, 401);
});

/* ---------- 2.5 OTP ทางอีเมล ---------- */

test('OTP: ขอรหัส → ยืนยัน → ได้ token และรหัสใช้ซ้ำไม่ได้', async function () {
  const email = 'otp-' + Date.now() + '@example.com';
  await register('ผู้ใช้ OTP', email);

  /* โหมดทดสอบยังไม่ตั้งค่าผู้ให้บริการอีเมล → เซิร์ฟเวอร์คืน devCode ให้ตรวจได้ */
  const requested = await api('POST', '/api/auth/otp/request', { email: email });
  assert.strictEqual(requested.status, 200, requested.text);
  assert.strictEqual(requested.body.delivered, false);
  assert.match(String(requested.body.devCode), /^\d{6}$/);
  assert.strictEqual(requested.body.expiresIn, 600);

  const wrong = requested.body.devCode === '000000' ? '111111' : '000000';
  const bad = await api('POST', '/api/auth/otp/verify', { email: email, code: wrong });
  assert.strictEqual(bad.status, 401, 'รหัสผิดต้องถูกปฏิเสธ');

  const ok = await api('POST', '/api/auth/otp/verify', { email: email, code: requested.body.devCode });
  assert.strictEqual(ok.status, 200, ok.text);
  assert.ok(ok.body.token, 'ต้องได้ token หลังยืนยัน OTP');
  assert.strictEqual(ok.body.user.email, email);
  assert.strictEqual(ok.body.user.passHash, undefined, 'ห้ามคืน hash รหัสผ่านออกไป');

  const me = await api('GET', '/api/me', undefined, { token: ok.body.token });
  assert.strictEqual(me.status, 200);

  const reuse = await api('POST', '/api/auth/otp/verify', { email: email, code: requested.body.devCode });
  assert.strictEqual(reuse.status, 401, 'รหัสเดิมต้องใช้ซ้ำไม่ได้');

  /* ขอรหัสซ้ำภายใน 60 วินาทีต้องถูกปฏิเสธ */
  const tooFast = await api('POST', '/api/auth/otp/request', { email: email });
  assert.strictEqual(tooFast.status, 429, tooFast.text);

  const stored = db.data().otps.filter(function (entry) {
    return entry.email === email && entry.purpose === 'login';
  });
  assert.strictEqual(stored.length, 1, 'เก็บเฉพาะรหัสล่าสุดต่ออีเมล');
  assert.strictEqual(stored[0].code, undefined, 'ห้ามเก็บรหัสเป็นข้อความตรง ๆ');
  assert.match(String(stored[0].codeHash), /^[a-f0-9]{64}$/, 'เก็บเฉพาะ SHA-256 hash');
});

test('OTP: เก็บรหัสเป็น HMAC-SHA256 ด้วย secret และรหัสที่ออกก่อนหน้า (SHA-256 เดิม) ยังใช้ได้', async function () {
  const email = 'otp-hmac-' + Date.now() + '@example.com';
  await register('ผู้ใช้ OTP HMAC', email);

  const requested = await api('POST', '/api/auth/otp/request', { email: email });
  assert.strictEqual(requested.status, 200, requested.text);

  const record = db.data().otps.filter(function (entry) {
    return entry.email === email && entry.purpose === 'login';
  })[0];
  assert.ok(record, 'ต้องมีรหัส OTP ของอีเมลนี้');

  const legacy = crypto.createHash('sha256').update(email + '|' + requested.body.devCode).digest('hex');
  const expected = crypto.createHmac('sha256', process.env.FLO_OTP_SECRET)
    .update('otp|login|' + email + '|' + requested.body.devCode).digest('hex');

  assert.notStrictEqual(record.codeHash, legacy, 'ต้องไม่ใช่ SHA-256 เปล่าที่ถอดรหัสได้ทันที');
  assert.strictEqual(record.codeHash, expected, 'ต้องเป็น HMAC ด้วย FLO_OTP_SECRET');

  /* รหัสที่ออกก่อน deploy (SHA-256 เดิม) ต้องยังใช้ได้จนหมดอายุ ผู้ใช้ไม่ต้องขอใหม่ */
  record.codeHash = legacy;
  db.persist();
  const ok = await api('POST', '/api/auth/otp/verify', { email: email, code: requested.body.devCode });
  assert.strictEqual(ok.status, 200, ok.text);
  assert.ok(ok.body.token, 'รหัสแบบเดิมต้องแลก token ได้');
});

test('OTP: รหัสผิดติดกันครบ 5 ครั้งแล้วต้องขอรหัสใหม่', async function () {
  const email = 'otp-limit-' + Date.now() + '@example.com';
  await register('ผู้ใช้ OTP จำกัดครั้ง', email);

  const requested = await api('POST', '/api/auth/otp/request', { email: email });
  assert.strictEqual(requested.status, 200, requested.text);
  const wrong = requested.body.devCode === '000000' ? '111111' : '000000';

  for (let i = 0; i < 5; i += 1) {
    const res = await api('POST', '/api/auth/otp/verify', { email: email, code: wrong });
    assert.strictEqual(res.status, 401, 'ครั้งที่ ' + (i + 1) + ' ต้องได้ 401: ' + res.text);
  }
  const blocked = await api('POST', '/api/auth/otp/verify', { email: email, code: requested.body.devCode });
  assert.strictEqual(blocked.status, 429, 'เกินจำนวนครั้งต้องถูกล็อกจนกว่าจะขอรหัสใหม่');
});

test('OTP: อีเมลที่ไม่มีบัญชีและรหัสผิดรูปแบบถูกปฏิเสธ', async function () {
  const missing = await api('POST', '/api/auth/otp/request', {
    email: 'nobody-' + Date.now() + '@example.com'
  });
  assert.strictEqual(missing.status, 404);

  const email = 'otp-format-' + Date.now() + '@example.com';
  await register('ผู้ใช้ OTP รูปแบบรหัส', email);
  const short = await api('POST', '/api/auth/otp/verify', { email: email, code: '123' });
  assert.strictEqual(short.status, 400);
});

/* ---------- 2.6 สมัครสมาชิกต้องยืนยันอีเมล ---------- */

test('สมัครสมาชิก: ยังไม่ยืนยันอีเมลสร้างบัญชีไม่ได้ และ signupToken ใช้ซ้ำไม่ได้', async function () {
  const email = 'signup-' + Date.now() + '@example.com';
  const noToken = await api('POST', '/api/auth/register', {
    name: 'ยังไม่ยืนยัน', email: email, password: 'test-password-1234', age: 20
  });
  assert.strictEqual(noToken.status, 401, noToken.text);

  const signupToken = await signupTokenFor('ยังไม่ยืนยัน', email);
  const created = await api('POST', '/api/auth/register', {
    name: 'ยังไม่ยืนยัน', email: email, password: 'test-password-1234', age: 20, signupToken: signupToken
  });
  assert.strictEqual(created.status, 201, created.text);
  assert.ok(created.body.token, 'ต้องล็อกอินอัตโนมัติหลังสมัครสำเร็จ');

  const me = await api('GET', '/api/me', undefined, { token: created.body.token });
  assert.strictEqual(me.status, 200);

  const reuse = await api('POST', '/api/auth/register', {
    name: 'ซ้ำ', email: email, password: 'test-password-1234', age: 20, signupToken: signupToken
  });
  assert.strictEqual(reuse.status, 409, 'อีเมลเดิมต้องถูกปฏิเสธ');
});

test('สมัครสมาชิก: ซื้อรหัสให้อีเมลที่มีบัญชีแล้วไม่ได้ และ token มั่วถูกปฏิเสธ', async function () {
  const email = 'signup-taken-' + Date.now() + '@example.com';
  await register('มีบัญชีแล้ว', email);

  const taken = await api('POST', '/api/auth/otp/request', { email: email, purpose: 'signup' });
  assert.strictEqual(taken.status, 409, taken.text);

  const bogus = await api('POST', '/api/auth/register', {
    name: 'มั่ว', email: 'bogus-' + Date.now() + '@example.com',
    password: 'test-password-1234', age: 20, signupToken: 'a'.repeat(48)
  });
  assert.strictEqual(bogus.status, 401, bogus.text);
});

/* ---------- 3. การจอง + flow คืนของ 2 ขั้น ---------- */

test('คืนของ 2 ขั้น: ผู้เช่าแจ้งคืน → เจ้าของยืนยัน → จึงคืนมัดจำและจ่ายค่าเช่า', async function () {
  const alice = await register('อลิซ เจ้าของของ', 'alice-' + Date.now() + '@example.com');
  const bob = await register('บ๊อบ ผู้เช่า', 'bob-' + Date.now() + '@example.com');

  const itemRes = await api('POST', '/api/items', {
    title: 'ไมค์ทดสอบ',
    cat: 'crew',
    price: 100,
    deposit: 500,
    location: 'กรุงเทพฯ',
    desc: 'ใช้ทดสอบ flow คืนของ'
  }, { token: alice.token });
  assert.strictEqual(itemRes.status, 201, itemRes.text);
  const item = itemRes.body.item;

  const bookingRes = await api('POST', '/api/bookings', {
    itemId: item.id, start: dayFromNow(1), end: dayFromNow(3)
  }, { token: bob.token });
  assert.strictEqual(bookingRes.status, 201, bookingRes.text);
  const booking = bookingRes.body.booking;
  const walletAfterBooking = bookingRes.body.wallet;
  assert.strictEqual(booking.status, 'pending');

  /* ผู้เช่ายังแจ้งคืนไม่ได้ถ้าการจองยังไม่ถูกยืนยัน */
  const early = await api('PATCH', '/api/bookings/' + booking.code, { action: 'return' }, { token: bob.token });
  assert.strictEqual(early.status, 409, 'ยังไม่ active ต้องแจ้งคืนไม่ได้');

  const confirm = await api('PATCH', '/api/owner/bookings/' + booking.code, { action: 'confirm' }, { token: alice.token });
  assert.strictEqual(confirm.status, 200, confirm.text);
  assert.strictEqual(confirm.body.booking.status, 'active');

  /* ขั้นที่ 1: ผู้เช่าแจ้งคืน — เงินต้องยังไม่ถูกคืน */
  const returnRes = await api('PATCH', '/api/bookings/' + booking.code, { action: 'return' }, { token: bob.token });
  assert.strictEqual(returnRes.status, 200, returnRes.text);
  assert.strictEqual(returnRes.body.booking.status, 'return_requested');

  const meAfterReturn = await api('GET', '/api/me', undefined, { token: bob.token });
  assert.strictEqual(meAfterReturn.body.user.wallet, walletAfterBooking, 'แจ้งคืนแล้วยังไม่ควรได้มัดจำคืน');

  const hold = db.data().holds.find(function (entry) { return entry.bookingCode === booking.code; });
  assert.strictEqual(hold.status, 'held', 'มัดจำต้องยังถูกกันไว้ระหว่างรอเจ้าของยืนยัน');

  const again = await api('PATCH', '/api/bookings/' + booking.code, { action: 'return' }, { token: bob.token });
  assert.strictEqual(again.status, 409, 'แจ้งคืนซ้ำต้องไม่ผ่าน');

  /* ผู้เช่าไม่มีสิทธิ์กดรับคืนแทนเจ้าของ */
  const stoleOwner = await api('PATCH', '/api/owner/bookings/' + booking.code, { action: 'receive' }, { token: bob.token });
  assert.strictEqual(stoleOwner.status, 403);

  /* เจ้าของโต้แย้งได้ ของยังไม่คืน → กลับไป active และมัดจำยังถูกกัน */
  const dispute = await api('PATCH', '/api/owner/bookings/' + booking.code, {
    action: 'dispute', note: 'ยังไม่ได้รับของคืน'
  }, { token: alice.token });
  assert.strictEqual(dispute.status, 200, dispute.text);
  assert.strictEqual(dispute.body.booking.status, 'active');
  assert.strictEqual(dispute.body.booking.disputeNote, 'ยังไม่ได้รับของคืน');
  assert.strictEqual(hold.status, 'held');

  /* แจ้งคืนอีกครั้ง แล้วเจ้าของยืนยันรับคืน */
  const returnAgain = await api('PATCH', '/api/bookings/' + booking.code, { action: 'return' }, { token: bob.token });
  assert.strictEqual(returnAgain.status, 200, returnAgain.text);

  const aliceBefore = (await api('GET', '/api/me', undefined, { token: alice.token })).body.user.wallet;
  const receive = await api('PATCH', '/api/owner/bookings/' + booking.code, { action: 'receive' }, { token: alice.token });
  assert.strictEqual(receive.status, 200, receive.text);
  assert.strictEqual(receive.body.booking.status, 'returned');

  const bobAfter = (await api('GET', '/api/me', undefined, { token: bob.token })).body.user.wallet;
  assert.strictEqual(bobAfter, walletAfterBooking + item.deposit, 'ผู้เช่าต้องได้มัดจำคืนเมื่อเจ้าของยืนยัน');

  const aliceAfter = (await api('GET', '/api/me', undefined, { token: alice.token })).body.user.wallet;
  assert.strictEqual(aliceAfter, aliceBefore + item.price * booking.days, 'เจ้าของต้องได้ค่าเช่า');

  assert.strictEqual(hold.status, 'settled');
  assert.strictEqual(db.data().holds.filter(function (entry) {
    return entry.bookingCode === booking.code && entry.status === 'held';
  }).length, 0, 'ต้องไม่มี escrow ค้าง');

  const doubleSettle = await api('PATCH', '/api/owner/bookings/' + booking.code, { action: 'receive' }, { token: alice.token });
  assert.strictEqual(doubleSettle.status, 409, 'ยืนยันซ้ำต้องไม่จ่ายเงินซ้ำ');
});

/* ---------- 4. สิทธิ์ข้ามบัญชี ---------- */

test('สิทธิ์: ผู้ใช้อื่นยกเลิกหรือแตะการจองของเราไม่ได้', async function () {
  const carol = await register('แครอล', 'carol-' + Date.now() + '@example.com');
  const dave = await register('เดฟ', 'dave-' + Date.now() + '@example.com');

  const itemRes = await api('POST', '/api/items', {
    title: 'เต็นท์ทดสอบ', cat: 'general', price: 50, deposit: 100
  }, { token: carol.token });
  const item = itemRes.body.item;

  const bookingRes = await api('POST', '/api/bookings', {
    itemId: item.id, start: dayFromNow(2), end: dayFromNow(4)
  }, { token: dave.token });
  const booking = bookingRes.body.booking;

  const foreignCancel = await api('PATCH', '/api/bookings/' + booking.code, { action: 'cancel' }, { token: carol.token });
  assert.strictEqual(foreignCancel.status, 403);

  const foreignConfirm = await api('PATCH', '/api/owner/bookings/' + booking.code, { action: 'confirm' }, { token: dave.token });
  assert.strictEqual(foreignConfirm.status, 403);
});

/* ---------- 5. Pagination ---------- */

test('pagination: /api/items คืนหน้าและยอดรวมถูกต้อง', async function () {
  const admin = await api('POST', '/api/auth/login', {
    email: 'admin@flo-rent.co', password: 'admin1234'
  });
  assert.strictEqual(admin.status, 200, 'บัญชีแอดมินเดโมต้องล็อกอินได้ในโหมดเดโม');

  for (let i = 0; i < 3; i += 1) {
    const res = await api('POST', '/api/items', {
      title: 'สินค้าหน้า ' + i, cat: 'general', price: 10 + i, deposit: 0
    }, { token: admin.body.token });
    assert.strictEqual(res.status, 201, res.text);
  }

  const page1 = await api('GET', '/api/items?limit=2&page=1&sort=newest');
  assert.strictEqual(page1.status, 200);
  assert.strictEqual(page1.body.limit, 2);
  assert.strictEqual(page1.body.page, 1);
  assert.ok(page1.body.items.length <= 2, 'หน้าแรกต้องไม่เกิน limit');
  assert.ok(page1.body.total >= 3, 'total ต้องเป็นยอดรวมทั้งหมด');
  assert.strictEqual(page1.body.count, page1.body.total);
  assert.ok(page1.body.pages >= 2);

  const page2 = await api('GET', '/api/items?limit=2&page=2&sort=newest');
  const ids1 = page1.body.items.map(function (item) { return item.id; });
  const ids2 = page2.body.items.map(function (item) { return item.id; });
  assert.strictEqual(ids1.filter(function (id) { return ids2.indexOf(id) !== -1; }).length, 0, 'สองหน้าต้องไม่ซ้ำกัน');

  const clamped = await api('GET', '/api/items?limit=999999&page=-4');
  assert.strictEqual(clamped.body.limit, 100, 'limit ต้องถูกจำกัดเพดาน');
  assert.strictEqual(clamped.body.page, 1, 'page ติดลบต้องถูกปรับเป็น 1');

  const mine = await api('GET', '/api/items?mine=1&limit=1', undefined, { token: admin.body.token });
  assert.strictEqual(mine.status, 200);
  assert.strictEqual(mine.body.limit, 1);
  assert.strictEqual(mine.body.items.length, 1);
});

test('pagination: รายการจองและคำขอตามหาใช้รูปแบบเดียวกัน', async function () {
  const login = await loginOtp('demo@flo-rent.co');
  assert.ok(login.token, 'ต้องได้ token หลังยืนยัน OTP');

  const bookings = await api('GET', '/api/bookings?limit=1', undefined, { token: login.token });
  assert.strictEqual(bookings.status, 200);
  assert.strictEqual(bookings.body.limit, 1);
  assert.ok(bookings.body.bookings.length <= 1);
  assert.ok(typeof bookings.body.total === 'number');

  const requests = await api('GET', '/api/requests?limit=1');
  assert.strictEqual(requests.status, 200);
  assert.strictEqual(requests.body.limit, 1);
  assert.ok(requests.body.requests.length <= 1);
});

/* ---------- 6. รหัสผ่านต้องผ่าน OTP ก่อนได้ session ---------- */

test('ล็อกอินด้วยรหัสผ่าน: ผู้ใช้ทั่วไปต้องยืนยัน OTP ก่อนจึงได้ session', async function () {
  const email = 'pw-' + Date.now() + '@example.com';
  await register('ผู้ใช้รหัสผ่าน', email);

  const wrong = await api('POST', '/api/auth/login', { email: email, password: 'รหัสผิด-1234' });
  assert.strictEqual(wrong.status, 401, 'รหัสผ่านผิดต้องไม่ผ่าน');

  const direct = await api('POST', '/api/auth/login', { email: email, password: 'test-password-1234' });
  assert.strictEqual(direct.status, 200, direct.text);
  assert.strictEqual(direct.body.token, undefined, 'ห้ามออก session จากรหัสผ่านเพียงอย่างเดียว');
  assert.strictEqual(direct.body.otpRequired, true);
  assert.match(String(direct.body.devCode), /^\d{6}$/);

  const blocked = await api('GET', '/api/me', undefined, { token: 'a'.repeat(32) });
  assert.strictEqual(blocked.status, 401);

  const verified = await api('POST', '/api/auth/otp/verify', { email: email, code: direct.body.devCode });
  assert.strictEqual(verified.status, 200, verified.text);
  const me = await api('GET', '/api/me', undefined, { token: verified.body.token });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.user.email, email);
});

test('ล็อกอินด้วยรหัสผ่าน: บัญชีแอดมินยังเข้าได้ทันที', async function () {
  const admin = await api('POST', '/api/auth/login', { email: 'admin@flo-rent.co', password: 'admin1234' });
  assert.strictEqual(admin.status, 200, admin.text);
  assert.ok(admin.body.token, 'แอดมินต้องได้ token ทันที');
  assert.strictEqual(admin.body.user.role, 'admin');
});

test('ลืมรหัสผ่าน: ยืนยัน OTP แล้วตั้งรหัสใหม่ได้จริง และ session เดิมถูกตัด', async function () {
  const email = 'reset-flow-' + Date.now() + '@example.com';
  const signupToken = await signupTokenFor('ผู้ใช้รีเซ็ต', email);
  const created = await api('POST', '/api/auth/register', {
    name: 'ผู้ใช้รีเซ็ต', email: email, password: 'oldpass123', age: 20, signupToken: signupToken
  });
  assert.strictEqual(created.status, 201, created.text);
  const oldToken = created.body.token;

  const requested = await api('POST', '/api/auth/otp/request', { email: email, purpose: 'reset' });
  assert.strictEqual(requested.status, 200, requested.text);
  assert.match(String(requested.body.devCode), /^\d{6}$/);

  const wrong = await api('POST', '/api/auth/otp/verify', { email: email, code: '000000', purpose: 'reset' });
  assert.strictEqual(wrong.status, 401, wrong.text);
  assert.ok(!wrong.body.resetToken);

  const verified = await api('POST', '/api/auth/otp/verify', { email: email, code: requested.body.devCode, purpose: 'reset' });
  assert.strictEqual(verified.status, 200, verified.text);
  assert.ok(verified.body.resetToken, 'ต้องได้ resetToken หลังยืนยันอีเมล');
  assert.strictEqual(verified.body.signupToken, undefined, 'ต้องไม่ปนกับ signupToken');

  const crossUse = await api('POST', '/api/auth/password/reset', {
    email: email, password: 'newpass123', resetToken: signupToken
  });
  assert.strictEqual(crossUse.status, 401, 'token สมัครสมาชิกต้องใช้ตั้งรหัสผ่านใหม่ไม่ได้');

  const weak = await api('POST', '/api/auth/password/reset', {
    email: email, password: '123', resetToken: verified.body.resetToken
  });
  assert.strictEqual(weak.status, 400, weak.text);

  const done = await api('POST', '/api/auth/password/reset', {
    email: email, password: 'newpass123', resetToken: verified.body.resetToken
  });
  assert.strictEqual(done.status, 200, done.text);
  assert.ok(done.body.token, 'ตั้งรหัสผ่านใหม่แล้วต้องได้ session ใหม่');

  const meOld = await api('GET', '/api/me', undefined, { token: oldToken });
  assert.strictEqual(meOld.status, 401, 'session เดิมต้องใช้ไม่ได้หลังเปลี่ยนรหัสผ่าน');

  const loginNew = await api('POST', '/api/auth/login', { email: email, password: 'newpass123' });
  assert.strictEqual(loginNew.status, 200, loginNew.text);
  assert.strictEqual(loginNew.body.otpRequired, true, 'ผู้ใช้ทั่วไปยังต้องยืนยัน OTP หลังใช้รหัสผ่าน');

  const loginOld = await api('POST', '/api/auth/login', { email: email, password: 'oldpass123' });
  assert.strictEqual(loginOld.status, 401, 'รหัสผ่านเดิมต้องใช้ไม่ได้แล้ว');

  const reuse = await api('POST', '/api/auth/password/reset', {
    email: email, password: 'another123', resetToken: verified.body.resetToken
  });
  assert.strictEqual(reuse.status, 401, 'resetToken ใช้ซ้ำไม่ได้');
});

test('ลืมรหัสผ่าน: อีเมลที่ไม่มีบัญชีตอบ 404 และรหัสของ reset ยืนยันแบบ login ไม่ได้', async function () {
  const missing = await api('POST', '/api/auth/otp/request', {
    email: 'nobody-' + Date.now() + '@example.com', purpose: 'reset'
  });
  assert.strictEqual(missing.status, 404, missing.text);

  const email = 'reset-scope-' + Date.now() + '@example.com';
  const signupToken = await signupTokenFor('ผู้ใช้สโคป', email);
  const created = await api('POST', '/api/auth/register', {
    name: 'ผู้ใช้สโคป', email: email, password: 'firstpass1', age: 22, signupToken: signupToken
  });
  assert.strictEqual(created.status, 201, created.text);

  const requested = await api('POST', '/api/auth/otp/request', { email: email, purpose: 'reset' });
  assert.strictEqual(requested.status, 200, requested.text);

  const asLogin = await api('POST', '/api/auth/otp/verify', { email: email, code: requested.body.devCode });
  assert.strictEqual(asLogin.status, 401, 'รหัสของ reset ต้องใช้ยืนยันแบบ login ไม่ได้');
  assert.ok(!asLogin.body.token);
});

/* ---------- 4. รูปแบบ id ของประกาศ ---------- */

test('ประกาศใหม่ได้ id ขึ้นต้นด้วย itm- ไม่ใช่ usr- ที่อ่านเหมือน id ผู้ใช้', async function () {
  const owner = await register('เจ้าของทดสอบ id', 'idprefix-' + Date.now() + '@example.com');
  const res = await api('POST', '/api/items', {
    title: 'ทดสอบรูปแบบ id', cat: 'crew', price: 50, deposit: 0
  }, { token: owner.token });
  assert.strictEqual(res.status, 201, res.text);
  assert.match(res.body.item.id, /^itm-[a-z0-9]+$/, 'id ประกาศต้องขึ้นต้นด้วย itm-');
  assert.ok(res.body.item.id.indexOf('usr-') !== 0, 'id ประกาศต้องไม่ขึ้นต้นด้วย usr-');
});
