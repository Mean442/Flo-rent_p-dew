'use strict';

/*
 * ชุดทดสอบการยืนยันตัวตนด้วยบัตรประชาชน (เฟส 1–3)
 *   npm test → node --test test/api.test.js test/system.test.js test/verify.test.js
 *
 * ครอบคลุม: checksum เลขบัตร, การ hash/mask/เข้ารหัส, ด่านก่อนจอง/ลงประกาศ,
 * การส่งคำขอ, กันเลขบัตรซ้ำ, คิวแอดมิน, อนุมัติ/ปฏิเสธ, และช่วงผ่อนผัน 14 วัน
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-rent-verify-'));
process.env.FLO_DATA_DIR = DATA_DIR;
process.env.NODE_ENV = 'test';
process.env.FLO_RATE_LIMIT_PER_MIN = '1000';
/* ทดสอบเส้นทาง production (ต้องรออนุมัติ) แม้เทสต์จะรันในโหมดเดโม */
process.env.FLO_DEMO_AUTO_VERIFY = '0';
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const server = require('../server/server');
const db = require('../server/db');
const seed = require('../server/seed');
const verify = require('../server/verify');

const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let httpServer = null;
let base = '';

const state = { owner: null, renter: null, grace: null, idNumber: '', renterId: '' };

before(async function () {
  db.init(seed.build);
  httpServer = http.createServer(server.respond);
  await new Promise(function (resolve) { httpServer.listen(0, '127.0.0.1', resolve); });
  base = 'http://127.0.0.1:' + httpServer.address().port;
});

after(async function () {
  if (httpServer) await new Promise(function (resolve) { httpServer.close(resolve); });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

function api(method, urlPath, body, options) {
  const opts = options || {};
  const headers = { Accept: 'application/json' };
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
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

function uniqueEmail(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8) + '@example.com';
}

/* เลขบัตร 13 หลักที่ checksum ถูกต้อง (คำนวณหลักสุดท้ายเอง) */
function makeThaiId(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12.charAt(i)) * (13 - i);
  return first12 + String((11 - (sum % 11)) % 10);
}

async function signup(name, email) {
  const requested = await api('POST', '/api/auth/otp/request', { email: email, purpose: 'signup', name: name });
  assert.strictEqual(requested.status, 200, requested.text);
  const confirmed = await api('POST', '/api/auth/otp/verify', {
    email: email, code: requested.body.devCode, purpose: 'signup'
  });
  assert.strictEqual(confirmed.status, 200, confirmed.text);
  const created = await api('POST', '/api/auth/register', {
    name: name,
    email: email,
    password: 'test-password-1234',
    age: 25,
    signupToken: confirmed.body.signupToken
  });
  assert.strictEqual(created.status, 201, created.text);
  return { token: created.body.token, user: created.body.user, email: email };
}

async function adminToken() {
  const res = await api('POST', '/api/auth/login', { email: 'admin@flo-rent.co', password: 'admin1234' });
  assert.strictEqual(res.status, 200, res.text);
  return res.body.token;
}

/* ---------- 1. หน่วย: ตรวจเลขบัตร / hash / mask / เข้ารหัส ---------- */

test('ตรวจเลขบัตร 13 หลัก (checksum) และปกปิดข้อมูล', function () {
  const id = makeThaiId('110170020040');
  assert.strictEqual(id.length, 13);
  assert.strictEqual(verify.isValidThaiId(id), true, 'เลขที่คำนวณถูกต้องต้องผ่าน');
  assert.strictEqual(verify.isValidThaiId(' ' + id + ' '), true, 'มีช่องว่างคั่นได้');
  assert.strictEqual(verify.isValidThaiId(id.slice(0, 12) + ((Number(id.charAt(12)) + 1) % 10)), false, 'หลักสุดท้ายผิดต้องไม่ผ่าน');
  assert.strictEqual(verify.isValidThaiId('1234567890123'), false);
  assert.strictEqual(verify.isValidThaiId('abc'), false);
  assert.strictEqual(verify.isValidThaiId('1111111111111'), false, 'เลขซ้ำทั้ง 13 หลักต้องไม่ผ่าน');

  const hashed = verify.hashId(id);
  assert.strictEqual(hashed.length, 64);
  assert.strictEqual(hashed, verify.hashId(id), 'hash ต้องได้ค่าเดิม');
  assert.ok(hashed.indexOf(id) === -1, 'hash ต้องไม่เปิดเผยเลขบัตร');
  assert.strictEqual(verify.maskId(id), '•••••••••' + id.slice(-4));

  const encrypted = verify.encrypt('hello-id');
  assert.notStrictEqual(encrypted, 'hello-id');
  assert.strictEqual(verify.decrypt(encrypted).toString('utf8'), 'hello-id');
  assert.throws(function () { verify.decrypt('AAAA'); }, 'ข้อมูลเสียหายต้องถอดไม่ได้');
});

/* ---------- 2. ด่าน: บัญชีใหม่ยังทำธุรกรรมไม่ได้ ---------- */

test('บัญชีใหม่ยังจองและลงประกาศไม่ได้จนกว่าจะยืนยันตัวตน', async function () {
  state.owner = await signup('เจ้าของทดสอบ', uniqueEmail('vf-owner'));
  state.renter = await signup('ผู้เช่าทดสอบ', uniqueEmail('vf-renter'));

  const item = await api('POST', '/api/items', {
    title: 'ของทดสอบด่านยืนยัน', cat: 'general', price: 100, deposit: 0
  }, { token: state.owner.token });
  assert.strictEqual(item.status, 403, item.text);
  assert.strictEqual(item.body.code, 'NEED_VERIFY');

  const booking = await api('POST', '/api/bookings', {
    itemId: 'any', start: dayFromNow(1), end: dayFromNow(2)
  }, { token: state.renter.token });
  assert.strictEqual(booking.status, 403, booking.text);
  assert.strictEqual(booking.body.code, 'NEED_VERIFY');

  const status = await api('GET', '/api/verification', undefined, { token: state.renter.token });
  assert.strictEqual(status.status, 200);
  assert.strictEqual(status.body.verification.status, 'unverified');
  assert.strictEqual(status.body.verification.canTransact, false);

  const me = await api('GET', '/api/me', undefined, { token: state.renter.token });
  assert.strictEqual(me.body.user.verify.status, 'unverified');
});

/* ---------- 3. ส่งคำขอ + กันเลขบัตรซ้ำ ---------- */

test('ส่งคำขอยืนยันตัวตน: ตรวจรูปแบบ เก็บเลขบัตรแบบปกปิด และกันใช้ซ้ำ', async function () {
  const bad = await api('POST', '/api/verification', {
    idNumber: '123', fullName: 'ทดสอบ ชื่อ', photo: PHOTO
  }, { token: state.renter.token });
  assert.strictEqual(bad.status, 400, bad.text);

  const noPhoto = await api('POST', '/api/verification', {
    idNumber: makeThaiId('110170020040'), fullName: 'ทดสอบ ชื่อ'
  }, { token: state.renter.token });
  assert.strictEqual(noPhoto.status, 400);

  state.idNumber = makeThaiId('110170020040');
  const submitted = await api('POST', '/api/verification', {
    idNumber: state.idNumber, fullName: 'ทดสอบ ผู้เช่า', photo: PHOTO
  }, { token: state.renter.token });
  assert.strictEqual(submitted.status, 201, submitted.text);
  assert.strictEqual(submitted.body.verification.status, 'pending');
  assert.ok(submitted.body.verification.idMasked.endsWith(state.idNumber.slice(-4)));
  assert.strictEqual(JSON.stringify(submitted.body).indexOf(state.idNumber), -1, 'ห้ามส่งเลขบัตรเต็มกลับ');

  const pendingAgain = await api('POST', '/api/verification', {
    idNumber: state.idNumber, fullName: 'ทดสอบ ผู้เช่า', photo: PHOTO
  }, { token: state.renter.token });
  assert.strictEqual(pendingAgain.status, 409);

  /* รูปบัตรถูกเก็บแบบเข้ารหัส แยกจากฐานข้อมูลหลัก */
  state.renterId = submitted.body.verification && db.data().users.find(function (user) {
    return user.email === state.renter.email;
  }).id;
  const storedPhoto = await verify.readPhoto(state.renterId);
  assert.strictEqual(storedPhoto, PHOTO, 'อ่านรูปที่เข้ารหัสแล้วต้องได้ค่าเดิม');

  /* ผู้ใช้อื่นใช้เลขบัตรเดียวกันไม่ได้ */
  const third = await signup('ผู้ใช้ที่สาม', uniqueEmail('vf-third'));
  const duplicate = await api('POST', '/api/verification', {
    idNumber: state.idNumber, fullName: 'ทดสอบ ผู้เช่า', photo: PHOTO
  }, { token: third.token });
  assert.strictEqual(duplicate.status, 409, duplicate.text);

  /* เจ้าของส่งคำขอของตัวเอง (verbose: คนละเลขบัตร) */
  const ownerSubmit = await api('POST', '/api/verification', {
    idNumber: makeThaiId('310060030050'), fullName: 'เจ้าของ ทดสอบ', photo: PHOTO
  }, { token: state.owner.token });
  assert.strictEqual(ownerSubmit.status, 201, ownerSubmit.text);
});

/* ---------- 4. คิวแอดมิน + อนุมัติ/ปฏิเสธ ---------- */

test('แอดมินตรวจคิว อนุมัติได้ และผู้ใช้ทั่วไปเข้าถึงคิวไม่ได้', async function () {
  const forbidden = await api('GET', '/api/admin/verifications', undefined, { token: state.renter.token });
  assert.strictEqual(forbidden.status, 403);

  const token = await adminToken();
  const queue = await api('GET', '/api/admin/verifications?status=pending', undefined, { token: token });
  assert.strictEqual(queue.status, 200, queue.text);
  const entry = queue.body.verifications.find(function (item) { return item.email === state.renter.email; });
  assert.ok(entry, 'ต้องเห็นคำขอของผู้เช่าในคิว');
  assert.strictEqual(JSON.stringify(queue.body).indexOf(state.idNumber), -1, 'คิวต้องไม่ส่งเลขบัตรเต็ม');

  const rejected = await api('PATCH', '/api/admin/verifications/' + entry.userId, {
    action: 'reject', reason: 'รูปบัตรไม่ชัด'
  }, { token: token });
  assert.strictEqual(rejected.status, 200, rejected.text);
  assert.strictEqual(rejected.body.user.verify.status, 'rejected');

  const mine = await api('GET', '/api/verification', undefined, { token: state.renter.token });
  assert.strictEqual(mine.body.verification.status, 'rejected');
  assert.strictEqual(mine.body.verification.rejectReason, 'รูปบัตรไม่ชัด');

  /* ส่งใหม่ได้หลังถูกปฏิเสธ */
  const retry = await api('POST', '/api/verification', {
    idNumber: state.idNumber, fullName: 'ทดสอบ ผู้เช่า', photo: PHOTO
  }, { token: state.renter.token });
  assert.strictEqual(retry.status, 201, retry.text);

  const approveRenter = await api('PATCH', '/api/admin/verifications/' + entry.userId, {
    action: 'approve'
  }, { token: token });
  assert.strictEqual(approveRenter.status, 200, approveRenter.text);
  assert.strictEqual(approveRenter.body.user.verify.status, 'verified');
  assert.strictEqual(approveRenter.body.user.verify.canTransact, true);

  const ownerEntry = queue.body.verifications.find(function (item) { return item.email === state.owner.email; });
  const approveOwner = await api('PATCH', '/api/admin/verifications/' + ownerEntry.userId, {
    action: 'approve'
  }, { token: token });
  assert.strictEqual(approveOwner.status, 200, approveOwner.text);
});

/* ---------- 5. หลังอนุมัติทำธุรกรรมได้จริง ---------- */

test('ยืนยันตัวตนแล้ว: ลงประกาศและจองได้จริง', async function () {
  const item = await api('POST', '/api/items', {
    title: 'กล้องหลังยืนยันตัวตน', cat: 'general', price: 100, deposit: 50
  }, { token: state.owner.token });
  assert.strictEqual(item.status, 201, item.text);

  const booking = await api('POST', '/api/bookings', {
    itemId: item.body.item.id, start: dayFromNow(1), end: dayFromNow(2)
  }, { token: state.renter.token });
  assert.strictEqual(booking.status, 201, booking.text);
  assert.strictEqual(booking.body.wallet, 3000 - 150);

  const me = await api('GET', '/api/me', undefined, { token: state.renter.token });
  assert.strictEqual(me.body.user.verify.status, 'verified');
  assert.strictEqual(me.body.user.verify.canTransact, true);
  assert.strictEqual(JSON.stringify(me.body).indexOf(state.idNumber), -1, '/api/me ต้องไม่ส่งเลขบัตรเต็ม');
});

/* ---------- 6. ผู้ใช้เดิม: ผ่อนผัน 14 วัน ---------- */

test('ช่วงผ่อนผันของผู้ใช้เดิม: จองได้จนหมดเวลา แล้วถูกบล็อกเมื่อพ้นกำหนด', async function () {
  state.grace = await signup('ผู้ใช้เดิมทดสอบ', uniqueEmail('vf-grace'));
  const record = db.data().users.find(function (user) { return user.email === state.grace.email; });
  record.verify = { status: 'unverified', graceUntil: new Date(Date.now() + 86400000).toISOString() };
  db.persist();

  const item = await api('POST', '/api/items', {
    title: 'ของทดสอบช่วงผ่อนผัน', cat: 'general', price: 100, deposit: 0
  }, { token: state.grace.token });
  assert.strictEqual(item.status, 201, 'ยังอยู่ในช่วงผ่อนผันต้องลงประกาศได้: ' + item.text);

  record.verify = { status: 'unverified', graceUntil: new Date(Date.now() - 1000).toISOString() };
  db.persist();

  const blocked = await api('POST', '/api/items', {
    title: 'ของทดสอบหลังหมดผ่อนผัน', cat: 'general', price: 100, deposit: 0
  }, { token: state.grace.token });
  assert.strictEqual(blocked.status, 403, blocked.text);
  assert.strictEqual(blocked.body.code, 'NEED_VERIFY');
});

/* ---------- 7. บัญชีระบบ (แอดมิน) ไม่ถูกบล็อก ---------- */

test('แอดมินไม่ต้องยืนยันตัวตนและไม่ติดด่าน', async function () {
  const token = await adminToken();
  const me = await api('GET', '/api/me', undefined, { token: token });
  assert.strictEqual(me.body.user.verify.status, 'verified');
  assert.strictEqual(me.body.user.verify.canTransact, true);

  const item = await api('POST', '/api/items', {
    title: 'ประกาศโดยแอดมิน', cat: 'general', price: 50, deposit: 0
  }, { token: token });
  assert.strictEqual(item.status, 201, item.text);
});

/* ---------- 8. รูปบัตรสำหรับแอดมิน ---------- */

test('แอดมินเปิดดูรูปบัตรได้ คนทั่วไปเปิดไม่ได้ และบันทึก log ทุกครั้ง', async function () {
  const token = await adminToken();
  const user = db.data().users.find(function (entry) { return entry.email === state.renter.email; });

  const forbidden = await api('GET', '/api/admin/verifications/' + user.id + '/photo', undefined, { token: state.renter.token });
  assert.strictEqual(forbidden.status, 403);

  const photo = await api('GET', '/api/admin/verifications/' + user.id + '/photo', undefined, { token: token });
  assert.strictEqual(photo.status, 200, photo.text);
  assert.strictEqual(photo.body.photo, PHOTO, 'ต้องได้รูปเดิมที่ผู้ใช้ส่งมา');

  const unknown = await api('GET', '/api/admin/verifications/u-unknown/photo', undefined, { token: token });
  assert.strictEqual(unknown.status, 404);

  assert.ok(db.data().logs.some(function (entry) {
    return entry.action === 'verification.photo.view';
  }), 'ต้องบันทึกว่าแอดมินเปิดดูรูป');
});

/* ---------- 9. โหมดเดโม: ผ่านอัตโนมัติ ---------- */

test('โหมดเดโม: บัญชีที่สมัครใหม่ผ่านการยืนยันตัวตนอัตโนมัติ', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-rent-demo-'));
  const port = 36000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: Object.assign({}, process.env, {
      NODE_ENV: 'test',
      FLO_DATA_DIR: dir,
      PORT: String(port),
      HOST: '127.0.0.1',
      FLO_RATE_LIMIT_PER_MIN: '1000',
      FLO_DEMO_AUTO_VERIFY: ''
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const origin = 'http://127.0.0.1:' + port;

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        const res = await fetch(origin + '/api/health');
        if (res.ok) { ready = true; break; }
      } catch (err) { /* ยังไม่ขึ้น */ }
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    assert.ok(ready, 'เซิร์ฟเวอร์โหมดเดโมต้องเริ่มทำงาน');

    const email = uniqueEmail('vf-demo');
    const requested = await (await fetch(origin + '/api/auth/otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, purpose: 'signup', name: 'เดโม ออโต้' })
    })).json();
    const confirmed = await (await fetch(origin + '/api/auth/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, code: requested.devCode, purpose: 'signup' })
    })).json();
    const created = await (await fetch(origin + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'เดโม ออโต้',
        email: email,
        password: 'test-password-1234',
        age: 25,
        signupToken: confirmed.signupToken
      })
    })).json();

    assert.strictEqual(created.user.verify.status, 'verified', 'โหมดเดโมต้องผ่านอัตโนมัติ');
    assert.strictEqual(created.user.verify.canTransact, true, 'โหมดเดโมต้องทำธุรกรรมได้ทันที');

    const item = await fetch(origin + '/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + created.token },
      body: JSON.stringify({ title: 'ของเดโม', cat: 'general', price: 50, deposit: 0 })
    });
    assert.strictEqual(item.status, 201, 'โหมดเดโมต้องลงประกาศได้ทันที');
  } finally {
    try { child.kill(); } catch (err) { /* ไม่เป็นไร */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
