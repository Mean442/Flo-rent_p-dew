'use strict';

/*
 * FLO-RENT backend — Node.js มาตรฐาน ไม่ต้องติดตั้ง dependency
 * รัน:  node server/server.js   (หรือ npm start)  →  http://127.0.0.1:4173
 * ข้อมูลเก็บที่ server/data/db.json (กำหนดโฟลเดอร์เองได้ด้วย FLO_DATA_DIR)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('./env');

const auth = require('./auth');
const db = require('./db');
const seed = require('./seed');
const mailer = require('./mailer');
const verify = require('./verify');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.resolve(__dirname, '..', 'public');
/* ใหญ่พอสำหรับแนบรูปสินค้า (สูงสุด 4 รูป เป็น data URL ขนาดย่อแล้ว) */
const MAX_BODY = 4 * 1024 * 1024;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 700 * 1024;
const SESSION_TTL = 14 * 24 * 60 * 60 * 1000;
const DAY = 86400000;

/* หมวดหมู่อยู่ในฐานข้อมูล (แอดมินเพิ่ม/ลบ/แก้ไขได้) — ค่าเริ่มต้นมาจาก seed */
function ensureCategories() {
  let changed = false;
  if (!store().categories.length) {
    store().categories = seed.CATEGORIES.map(function (cat) { return Object.assign({}, cat); });
    changed = true;
  }
  if (!store().jobCategories.length) {
    store().jobCategories = (seed.JOB_CATEGORIES || []).map(function (cat) { return Object.assign({}, cat); });
    changed = true;
  }
  if (changed) db.persist();
}

/*
 * กันหน้าแรกว่างบน production/Vercel: อินสแตนซ์ที่ยัง warm อยู่และเคยสร้างฐานข้อมูลตอนที่
 * ยังไม่มีแคตตาล็อก (หรือฐานข้อมูลที่ถูก seed ไว้ก่อนเปิด FLO_SEED_CATALOG) จะค้าง items: []
 * จนกว่าจะรีสตาร์ต — ฟังก์ชันนี้เติมแคตตาล็อกคืนให้ทันทีที่พบว่ายังไม่มีประกาศเลย
 */
function ensureCatalog() {
  if (DEMO_MODE) return; /* โหมดเดโมมี seed ครบอยู่แล้ว */
  if (!seed.wantsCatalog(false)) return;
  if (store().items.length) return;

  const items = seed.catalogItems(null, null);
  if (!items.length) return;
  const admin = store().users.filter(function (user) { return user.role === 'admin'; })[0];
  if (admin) {
    items.forEach(function (item) { item.ownerId = admin.id; item.owner = admin.name; });
  }
  store().items = items;
  logEvent('catalog.seed', 'เติมแคตตาล็อกตั้งต้น ' + items.length + ' รายการ (ฐานข้อมูลยังไม่มีประกาศ)', null, null);
  db.persist();
}
/* ---------- การยืนยันตัวตนด้วยบัตรประชาชน ---------- */

const VERIFY_GRACE_DAYS = 14;
const VERIFY_SUBMITS_PER_HOUR = 3;
const ID_PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

function verificationOf(user) {
  return (user && user.verify) || { status: 'unverified' };
}

/* ผู้ใช้ทำธุรกรรมได้เมื่อ: เป็นแอดมิน / ยืนยันแล้ว / ยังอยู่ในช่วงผ่อนผันของผู้ใช้เดิม */
function canTransact(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const record = verificationOf(user);
  if (record.status === 'verified') return true;
  if (record.graceUntil && Date.parse(record.graceUntil) > Date.now()) return true;
  return false;
}

function publicVerification(user) {
  const record = verificationOf(user);
  return {
    status: record.status,
    idMasked: record.idMasked || '',
    fullName: record.fullName || '',
    submittedAt: record.submittedAt || null,
    reviewedAt: record.reviewedAt || null,
    rejectReason: record.rejectReason || '',
    graceUntil: record.graceUntil || null,
    canTransact: canTransact(user)
  };
}

function requireTransaction(user) {
  if (canTransact(user)) return user;
  const record = verificationOf(user);
  let message = 'ต้องยืนยันตัวตนด้วยบัตรประชาชนก่อนจองหรือลงประกาศ — ไปที่หน้าบัญชีของฉัน';
  if (record.status === 'pending') {
    message = 'คำขอยืนยันตัวตนอยู่ระหว่างการตรวจสอบ — ยังจองหรือลงประกาศไม่ได้จนกว่าแอดมินจะอนุมัติ';
  } else if (record.status === 'rejected') {
    message = 'คำขอยืนยันตัวตนไม่ผ่าน (' + (record.rejectReason || 'ไม่ระบุเหตุผล') + ') — ส่งใหม่ได้ที่หน้าบัญชีของฉัน';
  }
  fail(403, message, 'NEED_VERIFY');
}

/* จำกัดการส่งคำขอของผู้ใช้แต่ละคน (3 ครั้ง/ชั่วโมง) */
function checkVerifyRate(user) {
  const now = Date.now();
  const recent = (Array.isArray(user.verifySubmits) ? user.verifySubmits : []).filter(function (at) {
    return now - Number(at) < 3600000;
  });
  if (recent.length >= VERIFY_SUBMITS_PER_HOUR) {
    fail(429, 'ส่งคำขอยืนยันตัวตนบ่อยเกินไป — รอสักครู่แล้วลองใหม่');
  }
  recent.push(now);
  user.verifySubmits = recent;
}

/*
 * ผู้ใช้เดิมที่มีอยู่ก่อนเปิดระบบนี้ได้เวลาใช้งานต่อ 14 วัน (นับจากคำขอแรกหลัง deploy)
 * บัญชีที่สมัครใหม่ต้องยืนยันก่อนทำธุรกรรม; แอดมินและบัญชีทดลองได้สถานะยืนยันแล้ว
 */
function ensureVerification() {
  const meta = store().meta || (store().meta = {});
  let changed = false;
  if (!meta.verifyLaunchAt) {
    meta.verifyLaunchAt = new Date().toISOString();
    changed = true;
  }
  const launchAt = Date.parse(meta.verifyLaunchAt) || Date.now();
  const graceUntil = new Date(launchAt + VERIFY_GRACE_DAYS * DAY).toISOString();

  store().users.forEach(function (user) {
    if (user.verify) {
      /* โหมดเดโม: บัญชีที่ยังไม่เคยส่งข้อมูลให้ผ่านอัตโนมัติ (ไม่แตะคำขอที่รอตรวจหรือถูกปฏิเสธ) */
      if (DEMO_AUTO_VERIFY && user.verify.status === 'unverified' && !user.verify.idHash) {
        user.verify = { status: 'verified', idMasked: '', reviewedAt: new Date().toISOString(), note: 'โหมดเดโม: ผ่านอัตโนมัติ' };
        changed = true;
      }
      return;
    }
    changed = true;
    if (user.role === 'admin' || DEMO_AUTO_VERIFY) {
      user.verify = { status: 'verified', idMasked: '', reviewedAt: new Date().toISOString(), note: 'บัญชีระบบ' };
      return;
    }
    const joined = Date.parse(user.joinedAt || '');
    user.verify = joined && joined < launchAt
      ? { status: 'unverified', graceUntil: graceUntil }
      : { status: 'unverified' };
  });

  if (changed) db.persist();
}


function itemCategories() { return store().categories; }
function jobCategories() { return store().jobCategories; }
function categoryKeys() { return itemCategories().map(function (cat) { return cat.key; }); }
function jobKeys() { return jobCategories().map(function (cat) { return cat.key; }); }

function jobCatOf(key) {
  return jobCategories().find(function (cat) { return cat.key === key; }) || { key: key, name: key, emoji: '🧰', sub: '' };
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  /* ต้องส่ง Referer (origin) ไปด้วย ไม่งั้น tile ของ OpenStreetMap จะตอบ 403 Access blocked */
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/* ---------- helpers ---------- */

function store() { return db.data(); }

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }, SECURITY_HEADERS));
  res.end(body);
}

function fail(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  /* ข้อความที่ตั้งใจส่งให้ผู้ใช้เห็น (ไม่ใช่ stack trace ภายใน) */
  err.expose = true;
  throw err;
}

/* ---------- โหมดเดโม + การตรวจ Origin ---------- */

const DEMO_MODE = process.env.NODE_ENV !== 'production';
const DEMO_EMAILS = ['admin@flo-rent.co', 'demo@flo-rent.co', 'owner@flo-rent.co'];
/* โหมดเดโม: บัญชีที่สมัครใหม่ผ่านการยืนยันตัวตนอัตโนมัติ — production ต้องรอแอดมินอนุมัติ */
const DEMO_AUTO_VERIFY = process.env.FLO_DEMO_AUTO_VERIFY !== undefined
  ? process.env.FLO_DEMO_AUTO_VERIFY !== '0'
  : DEMO_MODE;

function allowedOriginHosts() {
  return String(process.env.FLO_ALLOWED_ORIGINS || '')
    .split(',')
    .map(function (entry) { return entry.trim().toLowerCase(); })
    .filter(Boolean);
}

function requestHost(req) {
  const forwarded = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  return (forwarded || String(req.headers.host || '')).toLowerCase();
}

/*
 * คำขอที่เขียนข้อมูลต้องมาจากโดเมนของเรา — เป็นตาข่ายกัน CSRF/คำขอข้ามโดเมน
 * ถ้าไม่มี header Origin (เช่น curl, แอปเนทีฟ) ให้ผ่านได้ เพราะการยืนยันตัวตนยังต้องใช้ token
 * เพิ่มโดเมนอื่นได้ด้วย FLO_ALLOWED_ORIGINS=https://a.com,https://b.com
 */
function assertSameOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return;
  let parsed = null;
  try { parsed = new URL(origin); } catch (err) { fail(403, 'Origin ไม่ถูกต้อง'); }
  const host = parsed.host.toLowerCase();
  const allow = [requestHost(req)].concat(allowedOriginHosts().map(function (entry) {
    try { return new URL(entry).host.toLowerCase(); } catch (err) { return entry; }
  }));
  if (allow.indexOf(host) === -1) fail(403, 'ไม่อนุญาตให้เรียก API จากโดเมนนี้');
}

function asString(value, label, options) {
  const opts = Object.assign({ min: 0, max: 400, required: true }, options || {});
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text && opts.required) fail(400, label + ' จำเป็นต้องกรอก');
  if (text && text.length < opts.min) fail(400, label + ' ต้องยาวอย่างน้อย ' + opts.min + ' ตัวอักษร');
  if (text.length > opts.max) fail(400, label + ' ยาวเกิน ' + opts.max + ' ตัวอักษร');
  return text;
}

function asInt(value, label, options) {
  const opts = Object.assign({ min: 0, max: 10000000, required: true }, options || {});
  if (value === undefined || value === null || value === '') {
    if (opts.required) fail(400, label + ' จำเป็นต้องกรอก');
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || Math.round(num) !== num) fail(400, label + ' ต้องเป็นจำนวนเต็ม');
  if (num < opts.min || num > opts.max) {
    fail(400, label + ' ต้องอยู่ระหว่าง ' + opts.min + ' ถึง ' + opts.max);
  }
  return num;
}

function asEnum(value, label, allowed) {
  if (allowed.indexOf(value) === -1) fail(400, label + ' ไม่ถูกต้อง');
  return value;
}

function asNumber(value, label, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) fail(400, label + ' ต้องเป็นตัวเลข');
  if (num < min || num > max) fail(400, label + ' ต้องอยู่ระหว่าง ' + min + ' ถึง ' + max);
  return num;
}

function asDay(value, label) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(400, label + ' ต้องอยู่ในรูปแบบ YYYY-MM-DD');
  const date = new Date(text + 'T00:00:00Z');
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) fail(400, label + ' ไม่ใช่วันที่ที่ถูกต้อง');
  return text;
}

function asDayList(value, label) {
  if (value === undefined || value === null || value === '') return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const seen = {};
  const days = [];
  for (let i = 0; i < raw.length; i += 1) {
    const text = String(raw[i] || '').trim();
    if (!text) continue;
    const day = asDay(text, label);
    if (seen[day]) continue;
    seen[day] = true;
    days.push(day);
  }
  if (days.length > 366) fail(400, label + ' เลือกได้ไม่เกิน 366 วัน');
  return days.sort();
}

function catOf(key) {
  const list = itemCategories();
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].key === key) return list[i];
  }
  return { key: 'general', name: 'อุปกรณ์ทั่วไป', emoji: '📦' };
}

/* ---------- กระเป๋าเงิน / เครดิต ---------- */

const WELCOME_TOPUP = 3000;
const CREDIT_START = 70;
const CREDIT_MIN_BOOKING = 40;

function walletOf(user) {
  return user && typeof user.wallet === 'number' ? user.wallet : 0;
}

function creditOf(user) {
  if (!user || typeof user.credit !== 'number') return CREDIT_START;
  return Math.max(0, Math.min(100, user.credit));
}

function creditLevel(score) {
  if (score >= 80) return { key: 'excellent', label: 'ดีมาก' };
  if (score >= 60) return { key: 'good', label: 'ดี' };
  if (score >= 40) return { key: 'fair', label: 'พอใช้' };
  return { key: 'low', label: 'ควรปรับปรุง' };
}

function pushLedger(user, data) {
  const entry = {
    id: auth.newId('tx'),
    userId: user.id,
    userName: user.name,
    type: data.type,
    amount: Number(data.amount) || 0,
    balanceAfter: walletOf(user),
    note: data.note || '',
    ref: data.ref || '',
    createdAt: new Date().toISOString()
  };
  store().ledger.unshift(entry);
  if (store().ledger.length > 2000) store().ledger.length = 2000;
  return entry;
}

function logEvent(action, detail, actor, ref) {
  store().logs.unshift({
    id: auth.newId('lg'),
    action: action,
    detail: detail || '',
    actorId: actor ? actor.id : null,
    actorName: actor ? actor.name : 'ระบบ',
    ref: ref || '',
    at: new Date().toISOString()
  });
  if (store().logs.length > 800) store().logs.length = 800;
}

function ensureWallet(user) {
  if (typeof user.wallet !== 'number') {
    user.wallet = WELCOME_TOPUP;
    pushLedger(user, { type: 'topup', amount: WELCOME_TOPUP, note: 'เครดิตต้อนรับสมาชิกใหม่' });
    logEvent('wallet.topup', 'ให้เครดิตต้อนรับ ' + WELCOME_TOPUP + ' FLO แก่ ' + user.name, null, user.id);
  }
  if (typeof user.credit !== 'number') user.credit = CREDIT_START;
  return user;
}

function adjustCredit(user, delta, reason) {
  const before = creditOf(user);
  const after = Math.max(0, Math.min(100, before + delta));
  if (after === before) return;
  user.credit = after;
  logEvent('credit.change', user.name + ': เครดิต ' + before + ' → ' + after + ' (' + reason + ')', null, user.id);
}

/* คืนเงิน/คืนมัดจำ/จ่ายค่าเช่า เมื่อการจองถูกยกเลิกหรือคืนของ (ทำครั้งเดียวต่อ hold) */
function settleBooking(booking, next, actor, options) {
  const opts = options || {};
  const hold = store().holds.find(function (entry) {
    return entry.bookingCode === booking.code && entry.status === 'held';
  });
  if (!hold) return null;

  const renter = store().users.find(function (user) { return user.id === hold.renterId; });
  if (!renter) return null;
  const owner = store().users.find(function (user) { return user.id === hold.ownerId; });

  if (next === 'cancelled') {
    const refund = hold.rent + hold.deposit;
    const note = opts.rejectedByOwner
      ? 'ผู้ให้เช่าปฏิเสธการจอง — คืนเงินทั้งจำนวน · '
      : 'คืนเงินทั้งจำนวน · ';
    renter.wallet = walletOf(renter) + refund;
    pushLedger(renter, { type: 'refund', amount: refund, note: note + booking.code, ref: booking.code });
    hold.status = 'refunded';
    hold.closedAt = new Date().toISOString();
    if (opts.penalizeRenter === false) {
      /* ผู้ให้เช่าเป็นฝ่ายปฏิเสธ: ผู้เช่าไม่ได้ทำผิด จึงไม่ตัดเครดิต */
      logEvent('wallet.refund', 'คืน ' + refund + ' FLO ให้ ' + renter.name + ' (' + booking.code + ') หลังผู้ให้เช่าปฏิเสธ', actor, booking.code);
    } else {
      adjustCredit(renter, -4, 'ยกเลิกการจอง ' + booking.code);
      logEvent('wallet.refund', 'คืน ' + refund + ' FLO ให้ ' + renter.name + ' (' + booking.code + ')', actor, booking.code);
    }
    return 'refund';
  }

  if (next === 'returned') {
    renter.wallet = walletOf(renter) + hold.deposit;
    pushLedger(renter, { type: 'deposit-release', amount: hold.deposit, note: 'คืนมัดจำ · ' + booking.code, ref: booking.code });
    if (owner) {
      owner.wallet = walletOf(owner) + hold.rent;
      pushLedger(owner, { type: 'payout', amount: hold.rent, note: 'ค่าเช่า · ' + booking.code, ref: booking.code });
    }
    hold.status = 'settled';
    hold.closedAt = new Date().toISOString();
    adjustCredit(renter, 2, 'คืนของครบตามกำหนด ' + booking.code);
    if (owner) adjustCredit(owner, 1, 'ปล่อยเช่าสำเร็จ ' + booking.code);
    logEvent('wallet.settle', 'คืนมัดจำ ' + hold.deposit + ' FLO · จ่ายค่าเช่า ' + hold.rent + ' FLO (' + booking.code + ')', actor, booking.code);
    return 'settled';
  }

  return null;
}

function publicUser(user) {
  return {
    id: user.id, name: user.name, email: user.email, phone: user.phone,
    age: user.age, location: user.location, avatar: user.avatar, bio: user.bio,
    role: user.role, status: user.status, rating: user.rating, reviews: user.reviews,
    wallet: walletOf(user), credit: creditOf(user), creditLevel: creditLevel(creditOf(user)).label,
    joinedAt: user.joinedAt,
    verify: publicVerification(user)
  };
}

/* วันที่ถูกจองไปแล้ว (รอยืนยัน/กำลังเช่า) — เอาไปแสดงในปฏิทินว่าช่วงนั้นไม่ว่าง */
function bookedDays(itemId) {
  const days = [];
  store().bookings.forEach(function (booking) {
    if (booking.itemId !== itemId) return;
    if (booking.status !== 'pending' && booking.status !== 'active' && booking.status !== 'return_requested') return;
    const stop = String(booking.end || '');
    let cursor = String(booking.start || '');
    for (let guard = 0; guard < 400 && cursor && stop && cursor < stop; guard += 1) {
      days.push(cursor);
      const date = new Date(cursor + 'T00:00:00Z');
      if (isNaN(date.getTime())) break;
      date.setUTCDate(date.getUTCDate() + 1);
      cursor = date.toISOString().slice(0, 10);
    }
  });
  return days;
}

/* วันไม่ว่างของสินค้า = วันที่เจ้าของกันไว้ + วันที่มีการจองอยู่ */
function unavailableDays(item) {
  const set = new Set(item.unavailable || []);
  bookedDays(item.id).forEach(function (day) { set.add(day); });
  return Array.from(set).sort();
}

function publicItem(item, options) {
  const opts = options || {};
  return {
    id: item.id, cat: item.cat, title: item.title, emoji: item.emoji,
    images: Array.isArray(item.images) && item.images.length ? item.images : (seed.ITEM_IMAGES[item.id] || []),
    price: item.price, deposit: item.deposit, owner: item.owner, ownerId: item.ownerId,
    rating: item.rating, reviews: item.reviews, location: item.location,
    tags: item.tags || [], desc: item.desc, terms: item.terms,
    availableFrom: item.availableFrom || null,
    unavailable: opts.withBookings ? unavailableDays(item) : (item.unavailable || []),
    lat: typeof item.lat === 'number' ? item.lat : null,
    lng: typeof item.lng === 'number' ? item.lng : null,
    status: item.status, createdAt: item.createdAt
  };
}

function publicRequest(request, viewer) {
  const offers = request.offers || [];
  const isOwner = !!viewer && viewer.id === request.userId;
  const isAdmin = !!viewer && viewer.role === 'admin';
  return {
    id: request.id, want: request.want, cat: request.cat, budget: request.budget,
    when: request.when, name: request.name, userId: request.userId, createdAt: request.createdAt,
    offerCount: offers.length,
    myOffer: !!viewer && offers.some(function (offer) { return offer.userId === viewer.id; }),
    offers: isOwner || isAdmin ? offers : []
  };
}

function publicWorker(worker) {
  const cat = jobCatOf(worker.cat);
  return {
    id: worker.id, name: worker.name, cat: worker.cat,
    catName: cat.name, catEmoji: cat.emoji,
    rate: worker.rate, location: worker.location, bio: worker.bio,
    rating: worker.rating, reviews: worker.reviews, avatar: worker.avatar || cat.emoji
  };
}

function publicJob(job) {
  const cat = jobCatOf(job.cat);
  return {
    id: job.id, title: job.title, cat: job.cat,
    catName: cat.name, catEmoji: cat.emoji,
    rate: job.rate, days: job.days, total: job.rate * job.days,
    start: job.start || null, location: job.location, desc: job.desc,
    name: job.name, userId: job.userId, status: job.status, createdAt: job.createdAt
  };
}

function publicHire(hire) {
  return {
    code: hire.code, workerId: hire.workerId, workerName: hire.workerName,
    workerCatName: hire.workerCatName, dayRate: hire.dayRate, days: hire.days,
    start: hire.start || null, total: hire.total, status: hire.status,
    createdAt: hire.createdAt
  };
}

/* ฐานข้อมูลเดิมที่ยังไม่มีคนทำงาน/ประกาศงาน: เติมข้อมูลตั้งต้นให้หน้าเว็บไม่ว่าง */
let workSeeded = false;
function ensureWorkData() {
  if (workSeeded) return;
  workSeeded = true;
  let changed = false;
  if (!store().workers.length) {
    store().workers = (seed.WORKERS || []).slice();
    changed = true;
  }
  if (!store().jobs.length) {
    store().jobs = seed.seedJobs ? seed.seedJobs() : [];
    changed = true;
  }
  if (changed) db.persist();
}

function findUserByEmail(email) {
  const target = String(email || '').toLowerCase();
  return store().users.find(function (user) { return user.email === target; }) || null;
}

function cleanupSessions() {
  const now = Date.now();
  const sessions = store().sessions;
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    if (!sessions[i] || sessions[i].expiresAt <= now) sessions.splice(i, 1);
  }
}

function currentUser(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer ([a-f0-9]{16,64})$/i.exec(header.trim());
  if (!match) return null;
  cleanupSessions();
  const token = match[1];
  const session = store().sessions.find(function (item) { return item.token === token; });
  if (!session) return null;
  const user = store().users.find(function (item) { return item.id === session.userId; });
  if (!user || user.status !== 'active') return null;
  /* ผู้ใช้เก่าที่ยังไม่มีกระเป๋าเงิน: ให้เครดิตต้อนรับครั้งแรกที่เข้าใช้ */
  ensureWallet(user);
  return user;
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) fail(401, 'กรุณาเข้าสู่ระบบก่อน');
  return user;
}

function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== 'admin') fail(403, 'เฉพาะผู้ดูแลระบบเท่านั้น');
  return user;
}

function createSession(user) {
  const sessions = store().sessions;
  const mine = sessions.filter(function (item) { return item.userId === user.id; });
  if (mine.length >= 5) {
    const oldest = mine.sort(function (a, b) { return a.createdAt - b.createdAt; })[0];
    store().sessions = sessions.filter(function (item) { return item.token !== oldest.token; });
  }
  const token = auth.newToken();
  store().sessions.push({
    token: token,
    userId: user.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL
  });
  db.persist();
  return token;
}

/* ---------- OTP ทางอีเมล ---------- */

const OTP_TTL = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_HOUR = 5;
const SIGNUP_TOKEN_TTL = 15 * 60 * 1000;

function otpStore() {
  if (!Array.isArray(store().otps)) store().otps = [];
  return store().otps;
}

function hashOtp(email, code) {
  return crypto.createHash('sha256').update(email + '|' + code).digest('hex');
}

/* token ชั่วคราวที่ได้หลังยืนยันอีเมลสำหรับสมัครสมาชิก — เก็บเฉพาะ hash */
function hashOtpToken(token) {
  return crypto.createHash('sha256').update('signup|' + token).digest('hex');
}

/* เทียบแบบ timing-safe เพราะรหัสสั้นและคงที่ 6 หลัก */
function otpMatches(email, code, record) {
  const expected = Buffer.from(String(record.codeHash || ''), 'hex');
  const actual = Buffer.from(hashOtp(email, code), 'hex');
  if (expected.length !== actual.length || expected.length === 0) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/* เก็บกวาดรหัสที่หมดอายุเกิน 1 ชั่วโมงแล้ว เพื่อไม่ให้ฐานข้อมูลโตไม่มีที่สิ้นสุด */
function pruneOtps() {
  const list = otpStore();
  const cutoff = Date.now() - 3600000;
  const keep = list.filter(function (entry) { return entry && entry.expiresAt > cutoff; });
  if (keep.length !== list.length) store().otps = keep;
}

/* activeOnly = true → เฉพาะรหัสที่ยังไม่ถูกใช้ (ใช้ตอนยืนยัน), false → รหัสล่าสุดทุกสถานะ (ใช้คิดคูลดาวน์ตอนขอใหม่) */
function latestOtp(email, activeOnly, purpose) {
  pruneOtps();
  let latest = null;
  otpStore().forEach(function (entry) {
    if (!entry || entry.email !== email) return;
    if ((entry.purpose || 'login') !== (purpose || 'login')) return;
    if (activeOnly && entry.usedAt) return;
    if (!latest || entry.createdAt > latest.createdAt) latest = entry;
  });
  return latest;
}

/* production ที่ยังไม่ตั้งค่าผู้ให้บริการอีเมล: ห้ามออก OTP เด็ดขาด (จะไม่มีใครได้รับรหัส) */
function otpUnavailable() {
  return !mailer.isConfigured() && process.env.NODE_ENV === 'production';
}

/* ออก OTP ใบใหม่ (แทนที่ใบเก่าของอีเมลนั้น) — ใช้ร่วมกันทั้งการขอรหัสทั่วไปและการล็อกอินด้วยรหัสผ่าน */
async function issueOtp(req, email, purpose, name) {
  const now = Date.now();
  const previous = latestOtp(email, false, purpose);
  if (previous && previous.createdAt > now - OTP_RESEND_MS) {
    fail(429, 'เพิ่งส่งรหัสไปแล้ว — รอ ' + Math.ceil((previous.createdAt + OTP_RESEND_MS - now) / 1000) + ' วินาทีก่อนขอใหม่');
  }
  const lastHour = otpStore().filter(function (entry) {
    return entry && entry.email === email && (entry.purpose || 'login') === purpose && entry.createdAt > now - 3600000;
  });
  if (lastHour.length >= OTP_MAX_PER_HOUR) fail(429, 'ขอยืนยันบ่อยเกินไปสำหรับอีเมลนี้ — กรุณาลองใหม่ภายหลัง');

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  /* รหัสใหม่ออกแล้วรหัสเก่าใช้ไม่ได้ทันที: มีรหัสที่ยังใช้ได้เพียงใบเดียวต่ออีเมล */
  store().otps = otpStore().filter(function (entry) { return entry.email !== email; });
  const record = {
    id: auth.newId('otp'),
    email: email,
    purpose: purpose,
    codeHash: hashOtp(email, code),
    attempts: 0,
    createdAt: now,
    expiresAt: now + OTP_TTL,
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
  };
  store().otps.push(record);
  db.persist();

  let delivery;
  try {
    delivery = await mailer.sendOtp({
      email: email,
      code: code,
      name: name,
      ttlMinutes: Math.round(OTP_TTL / 60000)
    });
  } catch (err) {
    /* ส่งอีเมลไม่สำเร็จ: ถอดรหัสที่ยังไม่ได้ส่งออก เพื่อไม่ให้คูลดาวน์ 60 วินาทีบล็อกการลองใหม่ */
    store().otps = otpStore().filter(function (entry) { return entry.id !== record.id; });
    db.persist();
    throw err;
  }
  return {
    delivered: delivery.delivered,
    devCode: delivery.devCode || undefined,
    expiresIn: Math.round(OTP_TTL / 1000),
    resendIn: Math.round(OTP_RESEND_MS / 1000)
  };
}

function readBody(req) {
  // บน Vercel ตัว runtime อ่านและ parse body ให้แล้ว (req.body) สตรีมจึงถูกใช้หมด — ถ้ารอ 'data'/'end' คำขอ POST จะค้างจน timeout
  if (req.body !== undefined && req.body !== null) {
    const given = req.body;
    if (Buffer.isBuffer(given) || typeof given === 'string') {
      const text = Buffer.isBuffer(given) ? given.toString('utf8') : given;
      if (Buffer.byteLength(text) > MAX_BODY) { const big = new Error('ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป'); big.status = 413; return Promise.reject(big); }
      if (!text) return Promise.resolve({});
      try { return Promise.resolve(JSON.parse(text)); } catch (err) { const bad = new Error('รูปแบบ JSON ไม่ถูกต้อง'); bad.status = 400; return Promise.reject(bad); }
    }
    return Promise.resolve(given);
  }
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) {
        const err = new Error('ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป');
        err.status = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        const bad = new Error('รูปแบบ JSON ไม่ถูกต้อง');
        bad.status = 400;
        reject(bad);
      }
    });
    req.on('error', reject);
  });
}

/* เพดานคำขอต่อนาทีต่อ IP (ปรับได้ด้วย FLO_RATE_LIMIT_PER_MIN — ใช้ผ่อนเฉพาะตอนทดสอบ) */
const RATE_LIMIT_PER_MIN = Math.max(1, Number(process.env.FLO_RATE_LIMIT_PER_MIN || 20) || 20);
const rateBuckets = new Map();

function allowAttempt(req, bucket) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = bucket + ':' + (forwarded || req.socket.remoteAddress || 'local');
  const now = Date.now();
  const record = rateBuckets.get(key);
  if (!record || record.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60000 });
    return true;
  }
  record.count += 1;
  return record.count <= RATE_LIMIT_PER_MIN;
}

/* รูปสินค้า: รับได้ทั้ง path ในโปรเจกต์ (img/xxx.jpg) และ data URL ที่ย่อจากหน้าเว็บแล้ว */
const IMAGE_DATA_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const IMAGE_PATH_RE = /^img\/[\w.-]+\.(jpg|jpeg|png|webp)$/i;

function imageList(value, label) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) fail(400, label + ' ต้องเป็นรายการรูปภาพ');
  if (value.length > MAX_IMAGES) fail(400, label + ' แนบได้สูงสุด ' + MAX_IMAGES + ' รูป');
  return value.map(function (raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (IMAGE_PATH_RE.test(text)) return text;
    if (!IMAGE_DATA_RE.test(text)) fail(400, label + ' ต้องเป็นไฟล์ภาพ JPEG / PNG / WebP');
    if (Buffer.byteLength(text) > MAX_IMAGE_BYTES) fail(400, label + ' มีขนาดใหญ่เกิน 700KB ต่อรูป');
    return text;
  });
}

function parseTags(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return list
    .map(function (tag) { return String(tag).trim(); })
    .filter(Boolean)
    .slice(0, 8)
    .map(function (tag) { return tag.slice(0, 24); });
}

function haystack(item) {
  return [item.title, item.owner, item.location, item.desc, item.terms, catOf(item.cat).name]
    .concat(item.tags || [])
    .join(' ')
    .toLowerCase();
}

function sortItems(list, sort) {
  if (sort === 'price-asc') return list.sort(function (a, b) { return a.price - b.price; });
  if (sort === 'price-desc') return list.sort(function (a, b) { return b.price - a.price; });
  if (sort === 'rating') return list.sort(function (a, b) { return b.rating - a.rating || b.reviews - a.reviews; });
  if (sort === 'newest') return list.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return list.sort(function (a, b) { return b.rating - a.rating || b.reviews - a.reviews; });
}

/* ---------- pagination ---------- */

function pageParams(url, defaultLimit, maxLimit) {
  const rawLimit = Number(url.searchParams.get('limit'));
  const rawPage = Number(url.searchParams.get('page'));
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : defaultLimit, 1),
    maxLimit
  );
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  return { page: page, limit: limit, offset: (page - 1) * limit };
}

/* ตัดหน้าให้รายการยาว + คืนข้อมูลหน้า/ยอดรวม เพื่อให้หน้าบ้านโหลดเพิ่มได้โดยไม่โหลดทั้งหมด */
function paged(url, list, key, defaultLimit, maxLimit) {
  const params = pageParams(url, defaultLimit, maxLimit);
  const total = list.length;
  const payload = {
    page: params.page,
    limit: params.limit,
    total: total,
    pages: Math.max(1, Math.ceil(total / params.limit)),
    count: total
  };
  payload[key] = list.slice(params.offset, params.offset + params.limit);
  return payload;
}

function parseDay(value, label) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(400, label + ' ต้องอยู่ในรูปแบบ YYYY-MM-DD');
  const date = new Date(text + 'T00:00:00Z');
  if (isNaN(date.getTime())) fail(400, label + ' ไม่ใช่วันที่ที่ถูกต้อง');
  return date;
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/* สร้าง key จากชื่อหมวดหมู่ (ชื่อไทยจะได้ key อัตโนมัติ) */
function slugifyCategory(text) {
  return String(text || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function newHireCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = 'WRK-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const exists = store().hires.some(function (hire) { return hire.code === code; });
    if (!exists) return code;
  }
  fail(500, 'สร้างรหัสการจ้างไม่สำเร็จ กรุณาลูกใหม่');
}

function newBookingCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = 'FLR-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const exists = store().bookings.some(function (booking) { return booking.code === code; });
    if (!exists) return code;
  }
  fail(500, 'สร้างรหัสการจองไม่สำเร็จ กรุณาลองใหม่');
}

/* ---------- static files ---------- */

function notFound(res) {
  const body = '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>ไม่พบหน้านี้ · FLO-RENT</title>' +
    '<link rel="stylesheet" href="/css/style.css"></head><body><div class="page"><main class="container">' +
    '<div class="empty"><h1 class="display display-sm">ไม่พบหน้านี้ (404)</h1>' +
    '<p class="muted">ลิงก์อาจไม่ถูกต้องหรือไฟล์ถูกย้ายแล้ว</p>' +
    '<a class="btn btn-cream" href="/index.html">กลับหน้าแรก</a></div></main></div></body></html>';
  res.writeHead(404, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, SECURITY_HEADERS));
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (err) { return notFound(res); }
  if (decoded === '/' || decoded === '') decoded = '/index.html';

  const resolved = path.resolve(ROOT, '.' + decoded);
  const relative = path.relative(ROOT, resolved);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return notFound(res);
  const parts = relative.split(path.sep);
  if (parts[0] === 'server' || parts[0] === 'node_modules' || parts.some(function (part) { return part.startsWith('.'); })) {
    return notFound(res);
  }
  if (parts[0] === 'package.json') return notFound(res);

  fs.stat(resolved, function (err, stat) {
    if (err || !stat.isFile()) return notFound(res);
    const headers = Object.assign({
      'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    }, SECURITY_HEADERS);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(resolved);
    stream.on('error', function () { res.end(); });
    stream.pipe(res);
  });
}

/* ---------- API ---------- */

async function handleApi(req, res, url) {
  const method = req.method.toUpperCase();
  const pathname = url.pathname.replace(/\/+$/, '');
  const key = method + ' ' + pathname;

  /* ทุกคำขอที่เขียนข้อมูลต้องมาจากโดเมนของเรา */
  if (method !== 'GET' && method !== 'HEAD') assertSameOrigin(req);

  ensureCategories();
  ensureCatalog();
  ensureVerification();

  if (key === 'GET /api/health') {
    return sendJson(res, 200, {
      ok: true, name: 'FLO-RENT API', time: new Date().toISOString(),
      uptime: Math.round(process.uptime()), demo: DEMO_MODE,
      mail: mailer.provider() || 'none'
    });
  }

  if (key === 'GET /api/categories') {
    return sendJson(res, 200, { categories: itemCategories() });
  }

  /* ---- auth ---- */

  if (key === 'POST /api/auth/register') {
    if (!allowAttempt(req, 'register')) fail(429, 'พยายามสมัครหลายครั้งเกินไป กรุณารอสักครู่');
    const payload = await readBody(req);
    const name = asString(payload.name, 'ชื่อที่ใช้แสดง', { min: 2, max: 60 });
    const email = asString(payload.email, 'อีเมล', { max: 120 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail(400, 'รูปแบบอีเมลไม่ถูกต้อง');
    const password = String(payload.password || '');
    if (password.length < 6) fail(400, 'รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร');
    if (password.length > 200) fail(400, 'รหัสผ่านยาวเกินไป');
    const age = asInt(payload.age, 'อายุ', { min: 15, max: 99 });
    if (findUserByEmail(email)) fail(409, 'อีเมลนี้มีบัญชีอยู่แล้ว');

    /* บัญชีจะถูกสร้างก็ต่อเมื่อยืนยันรหัสจากอีเมลแล้วเท่านั้น (token ใช้ได้ครั้งเดียว 15 นาที) */
    const signupToken = String(payload.signupToken || '').trim();
    const signupRecord = /^[a-f0-9]{16,64}$/i.test(signupToken)
      ? otpStore().filter(function (entry) {
        return entry && entry.purpose === 'signup' && entry.signupTokenHash === hashOtpToken(signupToken) &&
          entry.signupUsedAt === undefined && entry.signupExpiresAt > Date.now();
      })[0]
      : null;
    if (!signupRecord || signupRecord.email !== email) {
      fail(401, 'ต้องยืนยันอีเมลก่อนสมัครสมาชิก — กด "รับรหัส OTP ทางอีเมล" แล้วกรอกรหัส 6 หลักจากอีเมล');
    }

    const user = {
      id: auth.newId('u'),
      name: name,
      email: email,
      passHash: auth.hashPassword(password),
      role: 'user',
      status: 'active',
      phone: asString(payload.phone, 'เบอร์โทร', { max: 30, required: false }) || '—',
      age: age,
      location: asString(payload.location, 'พื้นที่', { max: 80, required: false }) || 'กรุงเทพฯ',
      avatar: asString(payload.avatar, 'รูปโปรไฟล์', { max: 8, required: false }) || '🙂',
      bio: '',
      rating: 5,
      reviews: 0,
      wallet: WELCOME_TOPUP,
      credit: CREDIT_START,
      verify: DEMO_AUTO_VERIFY
        ? { status: 'verified', idMasked: '', reviewedAt: new Date().toISOString(), note: 'โหมดเดโม: ผ่านอัตโนมัติ' }
        : { status: 'unverified' },
      joinedAt: new Date().toISOString()
    };
    store().users.push(user);
    pushLedger(user, { type: 'topup', amount: WELCOME_TOPUP, note: 'เครดิตต้อนรับสมาชิกใหม่' });
    signupRecord.signupUsedAt = Date.now();
    signupRecord.signupTokenHash = '';
    logEvent('user.register', 'สมาชิกใหม่: ' + user.name + ' (' + user.email + ')', user, user.id);
    db.persist();
    const token = createSession(user);
    return sendJson(res, 201, { token: token, user: publicUser(user) });
  }

  if (key === 'POST /api/auth/login') {
    if (!allowAttempt(req, 'login')) fail(429, 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่');
    const payload = await readBody(req);
    const email = asString(payload.email, 'อีเมล', { max: 120 }).toLowerCase();
    const password = String(payload.password || '');

    /* ฐานข้อมูลเก่าที่ยังมีบัญชีทดลองค้างอยู่: ปิดไม่ให้เข้าสู่ระบบบน production */
    if (!DEMO_MODE && DEMO_EMAILS.indexOf(email) !== -1) {
      fail(403, 'บัญชีทดลองถูกปิดบน production — เข้าสู่ระบบด้วยบัญชีแอดมินที่ตั้งผ่าน FLO_ADMIN_EMAIL');
    }

    const user = findUserByEmail(email);
    if (!user || !auth.verifyPassword(password, user.passHash)) fail(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    if (user.status !== 'active') fail(403, 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อทีมงาน');

    /* ผู้ดูแลระบบ: ทางเข้าเดียวที่ใช้รหัสผ่านได้โดยตรง เผื่อกรณีอีเมลยังส่งไม่ได้ */
    if (user.role === 'admin') {
      ensureWallet(user);
      return sendJson(res, 200, { token: createSession(user), user: publicUser(user) });
    }

    /* ผู้ใช้ทั่วไป: รหัสผ่านถูกต้องแล้วยังไม่ได้ session — ต้องยืนยัน OTP ทางอีเมลก่อนทุกครั้ง */
    if (otpUnavailable()) fail(503, 'ระบบส่งอีเมล OTP ยังไม่ถูกตั้งค่า — กรุณาติดต่อผู้ดูแลระบบ');
    const issued = await issueOtp(req, email, 'login', user.name);
    logEvent('auth.otp.request', 'ขอรหัส OTP หลังตรวจรหัสผ่าน: ' + email, user, user.id);
    db.persist();
    return sendJson(res, 200, {
      ok: true,
      otpRequired: true,
      email: email,
      delivered: issued.delivered,
      expiresIn: issued.expiresIn,
      resendIn: issued.resendIn,
      devCode: issued.devCode
    });
  }

  /* ขอ OTP: สร้างรหัส 6 หลัก ส่งทางอีเมล เก็บเฉพาะ hash ไว้ในฐานข้อมูล */
  if (key === 'POST /api/auth/otp/request') {
    if (!allowAttempt(req, 'otp-request')) fail(429, 'ขอยืนยันหลายครั้งเกินไป กรุณารอสักครู่');
    if (otpUnavailable()) fail(503, 'ระบบส่งอีเมล OTP ยังไม่ถูกตั้งค่า — กรุณาติดต่อผู้ดูแลระบบ');
    const payload = await readBody(req);
    const purpose = payload.purpose === 'signup' ? 'signup' : 'login';
    const email = asString(payload.email, 'อีเมล', { max: 120 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail(400, 'รูปแบบอีเมลไม่ถูกต้อง');

    const user = findUserByEmail(email);
    if (purpose === 'signup') {
      if (user) fail(409, 'อีเมลนี้มีบัญชีอยู่แล้ว — เข้าสู่ระบบด้วยแท็บ "อีเมล OTP" ได้เลย');
    } else {
      if (!user) fail(404, 'ไม่พบบัญชีที่ใช้อีเมลนี้ — สมัครสมาชิกก่อนใช้การเข้าสู่ระบบด้วย OTP');
      if (user.status !== 'active') fail(403, 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อทีมงาน');
    }

    const issued = await issueOtp(
      req,
      email,
      purpose,
      user ? user.name : String(payload.name || '').trim().slice(0, 60) || email.split('@')[0]
    );
    logEvent('auth.otp.request', 'ขอรหัส OTP ทางอีเมล: ' + email + (purpose === 'signup' ? ' (สมัครสมาชิก)' : ''), null, user ? user.id : null);
    db.persist();
    return sendJson(res, 200, {
      ok: true,
      email: email,
      delivered: issued.delivered,
      expiresIn: issued.expiresIn,
      resendIn: issued.resendIn,
      devCode: issued.devCode
    });
  }

  /* ยืนยัน OTP: ใช้ได้ครั้งเดียว ผิดได้ไม่เกิน 5 ครั้ง และหมดอายุใน 10 นาที */
  if (key === 'POST /api/auth/otp/verify') {
    if (!allowAttempt(req, 'otp-verify')) fail(429, 'กรอกรหัสหลายครั้งเกินไป กรุณารอสักครู่');
    const payload = await readBody(req);
    const email = asString(payload.email, 'อีเมล', { max: 120 }).toLowerCase();
    const purpose = payload.purpose === 'signup' ? 'signup' : 'login';
    const code = String(payload.code === undefined || payload.code === null ? '' : payload.code).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) fail(400, 'รหัส OTP ต้องเป็นตัวเลข 6 หลัก');

    const record = latestOtp(email, true, purpose);
    if (!record) fail(401, 'รหัส OTP ไม่ถูกต้องหรือหมดอายุแล้ว — ขอรหัสใหม่');
    if (record.expiresAt <= Date.now()) {
      store().otps = otpStore().filter(function (entry) { return entry.id !== record.id; });
      db.persist();
      fail(401, 'รหัส OTP หมดอายุแล้ว — ขอรหัสใหม่');
    }
    if ((record.attempts || 0) >= OTP_MAX_ATTEMPTS) {
      fail(429, 'กรอกรหัสผิดหลายครั้งเกินไป — ขอรหัสใหม่');
    }
    if (!otpMatches(email, code, record)) {
      record.attempts = (record.attempts || 0) + 1;
      db.persist();
      fail(401, 'รหัส OTP ไม่ถูกต้อง เหลือโอกาสอีก ' + Math.max(0, OTP_MAX_ATTEMPTS - record.attempts) + ' ครั้ง');
    }

    /* สมัครสมาชิก: ยืนยันอีเมลสำเร็จ → ออก token ชั่วคราวให้หน้าเว็บเอาไปสร้างบัญชี */
    if (purpose === 'signup') {
      if (findUserByEmail(email)) fail(409, 'อีเมลนี้มีบัญชีอยู่แล้ว — เข้าสู่ระบบด้วย OTP ได้เลย');
      const signupToken = auth.newToken();
      record.usedAt = Date.now();
      record.attempts = OTP_MAX_ATTEMPTS;
      record.signupTokenHash = hashOtpToken(signupToken);
      record.signupExpiresAt = Date.now() + SIGNUP_TOKEN_TTL;
      db.persist();
      return sendJson(res, 200, {
        ok: true,
        email: email,
        signupToken: signupToken,
        expiresIn: Math.round(SIGNUP_TOKEN_TTL / 1000)
      });
    }

    const user = findUserByEmail(email);
    if (!user) fail(404, 'ไม่พบบัญชีสำหรับอีเมลนี้');
    if (user.status !== 'active') fail(403, 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อทีมงาน');

    /* ทำเครื่องหมายว่าใช้แล้วทันที (ไม่ลบทิ้ง เพื่อให้คูลดาวน์ส่งซ้ำยังนับจากเวลาที่ขอ) */
    record.usedAt = Date.now();
    record.attempts = OTP_MAX_ATTEMPTS;
    ensureWallet(user);
    const token = createSession(user);
    logEvent('auth.otp.login', 'เข้าสู่ระบบด้วย OTP ทางอีเมล: ' + user.email, user, user.id);
    db.persist();
    return sendJson(res, 200, { token: token, user: publicUser(user) });
  }

  if (key === 'POST /api/auth/logout') {
    const header = req.headers.authorization || '';
    const match = /^Bearer ([a-f0-9]{16,64})$/i.exec(header.trim());
    if (match) {
      store().sessions = store().sessions.filter(function (session) { return session.token !== match[1]; });
      db.persist();
    }
    return sendJson(res, 200, { ok: true });
  }

  if (key === 'GET /api/me') {
    const user = requireUser(req);
    const bookings = store().bookings.filter(function (booking) { return booking.userId === user.id; });
    const listings = store().items.filter(function (item) { return item.ownerId === user.id; });
    return sendJson(res, 200, {
      user: publicUser(user),
      stats: {
        bookings: bookings.length,
        active: bookings.filter(function (b) {
          return b.status === 'pending' || b.status === 'active' || b.status === 'return_requested';
        }).length,
        spent: bookings.filter(function (b) { return b.status !== 'cancelled'; })
          .reduce(function (sum, b) { return sum + Number(b.total || 0); }, 0),
        listings: listings.length
      }
    });
  }

  if (key === 'PATCH /api/me') {
    const user = requireUser(req);
    const payload = await readBody(req);
    if (payload.name !== undefined) user.name = asString(payload.name, 'ชื่อที่ใช้แสดง', { min: 2, max: 60 });
    if (payload.phone !== undefined) user.phone = asString(payload.phone, 'เบอร์โทร', { max: 30, required: false }) || '—';
    if (payload.age !== undefined) user.age = asInt(payload.age, 'อายุ', { min: 15, max: 99 });
    if (payload.location !== undefined) user.location = asString(payload.location, 'พื้นที่', { max: 80, required: false }) || '—';
    if (payload.bio !== undefined) user.bio = asString(payload.bio, 'แนะนำตัว', { max: 300, required: false });
    if (payload.avatar !== undefined) user.avatar = asString(payload.avatar, 'รูปโปรไฟล์', { max: 8, required: false }) || '🙂';

    store().items.forEach(function (item) {
      if (item.ownerId === user.id) item.owner = user.name;
    });

    db.persist();
    return sendJson(res, 200, { user: publicUser(user) });
  }

  /* ---- items ---- */

  if (key === 'GET /api/items') {
    const user = currentUser(req);
    const mine = url.searchParams.get('mine') === '1';
    if (mine && !user) fail(401, 'กรุณาเข้าสู่ระบบก่อน');

    let items = store().items.slice();
    if (mine) {
      items = items.filter(function (item) { return item.ownerId === user.id; });
    } else {
      items = items.filter(function (item) { return item.status === 'published'; });
    }

    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const cat = String(url.searchParams.get('cat') || 'all');
    const min = Number(url.searchParams.get('min') || 0);
    const max = Number(url.searchParams.get('max') || 0);

    if (cat !== 'all') items = items.filter(function (item) { return item.cat === cat; });
    if (min > 0) items = items.filter(function (item) { return item.price >= min; });
    if (max > 0) items = items.filter(function (item) { return item.price <= max; });
    if (q) items = items.filter(function (item) { return haystack(item).indexOf(q) !== -1; });

    sortItems(items, String(url.searchParams.get('sort') || 'recommended'));
    return sendJson(res, 200, paged(url, items.map(publicItem), 'items', 24, 100));
  }

  if (key === 'POST /api/items') {
    const user = requireUser(req);
    requireTransaction(user);
    const payload = await readBody(req);
    const cat = asEnum(String(payload.cat || ''), 'หมวดหมู่', categoryKeys());
    const item = {
      id: auth.newId('usr'),
      ownerId: user.id,
      owner: user.name,
      cat: cat,
      title: asString(payload.title, 'ชื่อสินค้า', { min: 2, max: 120 }),
      emoji: catOf(cat).emoji,
      images: imageList(payload.images, 'รูปสินค้า'),
      price: asInt(payload.price, 'ราคาเช่าต่อวัน', { min: 0, max: 1000000 }),
      deposit: asInt(payload.deposit === undefined ? 0 : payload.deposit, 'เงินมัดจำ', { min: 0, max: 5000000, required: false }) || 0,
      rating: 5,
      reviews: 0,
      location: asString(payload.location, 'พื้นที่', { max: 80, required: false }) || 'ไม่ระบุพื้นที่',
      availableFrom: payload.availableFrom ? asDay(payload.availableFrom, 'วันที่เริ่มให้เช่า') : null,
      unavailable: asDayList(payload.unavailable, 'วันที่ไม่ว่าง'),
      lat: asNumber(payload.lat, 'ละติจูด', -90, 90),
      lng: asNumber(payload.lng, 'ลองจิจูด', -180, 180),
      tags: parseTags(payload.tags),
      desc: asString(payload.desc, 'รายละเอียด', { max: 1200, required: false }) || 'ยังไม่มีรายละเอียด',
      terms: asString(payload.terms, 'เงื่อนไข', { max: 600, required: false }) || 'ตกลงเงื่อนไขกับผู้เช่าโดยตรง · คืนของในสภาพเรียบร้อย',
      status: 'published',
      createdAt: new Date().toISOString()
    };
    store().items.unshift(item);
    db.persist();
    return sendJson(res, 201, { item: publicItem(item) });
  }

  const itemMatch = /^\/api\/items\/([\w-]+)$/.exec(pathname);
  if (itemMatch) {
    const id = itemMatch[1];
    const item = store().items.find(function (entry) { return entry.id === id; });
    if (!item) fail(404, 'ไม่พบสินค้าชิ้นนี้');
    const viewer = currentUser(req);
    const isOwner = viewer && viewer.id === item.ownerId;
    const isAdmin = viewer && viewer.role === 'admin';

    if (key === 'GET /api/items/' + id) {
      if (item.status !== 'published' && !isOwner && !isAdmin) fail(404, 'ไม่พบสินค้าชิ้นนี้');
      return sendJson(res, 200, { item: publicItem(item, { withBookings: true }) });
    }

    if (method === 'PATCH') {
      if (!isOwner && !isAdmin) fail(403, 'แก้ไขได้เฉพาะประกาศของตัวเอง');
      const payload = await readBody(req);
      if (payload.title !== undefined) item.title = asString(payload.title, 'ชื่อสินค้า', { min: 2, max: 120 });
      if (payload.cat !== undefined) {
        item.cat = asEnum(String(payload.cat), 'หมวดหมู่', categoryKeys());
        item.emoji = catOf(item.cat).emoji;
      }
      if (payload.images !== undefined) item.images = imageList(payload.images, 'รูปสินค้า');
      if (payload.price !== undefined) item.price = asInt(payload.price, 'ราคาเช่าต่อวัน', { min: 0, max: 1000000 });
      if (payload.deposit !== undefined) item.deposit = asInt(payload.deposit, 'เงินมัดจำ', { min: 0, max: 5000000, required: false }) || 0;
      if (payload.location !== undefined) item.location = asString(payload.location, 'พื้นที่', { max: 80, required: false }) || 'ไม่ระบุพื้นที่';
      if (payload.availableFrom !== undefined) item.availableFrom = payload.availableFrom ? asDay(payload.availableFrom, 'วันที่เริ่มให้เช่า') : null;
      if (payload.unavailable !== undefined) item.unavailable = asDayList(payload.unavailable, 'วันที่ไม่ว่าง');
      if (payload.lat !== undefined) item.lat = asNumber(payload.lat, 'ละติจูด', -90, 90);
      if (payload.lng !== undefined) item.lng = asNumber(payload.lng, 'ลองจิจูด', -180, 180);
      if (payload.tags !== undefined) item.tags = parseTags(payload.tags);
      if (payload.desc !== undefined) item.desc = asString(payload.desc, 'รายละเอียด', { max: 1200, required: false });
      if (payload.terms !== undefined) item.terms = asString(payload.terms, 'เงื่อนไข', { max: 600, required: false });
      if (payload.status !== undefined) item.status = asEnum(String(payload.status), 'สถานะประกาศ', ['published', 'hidden']);
      db.persist();
      return sendJson(res, 200, { item: publicItem(item) });
    }

    if (method === 'DELETE') {
      if (!isOwner && !isAdmin) fail(403, 'ลบได้เฉพาะประกาศของตัวเอง');
      store().items = store().items.filter(function (entry) { return entry.id !== id; });
      db.persist();
      return sendJson(res, 200, { ok: true });
    }
  }

  /* ---- bookings ---- */

  if (key === 'GET /api/bookings') {
    const user = requireUser(req);
    const list = store().bookings
      .filter(function (booking) { return booking.userId === user.id; })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    return sendJson(res, 200, paged(url, list, 'bookings', 100, 200));
  }

  if (key === 'POST /api/bookings') {
    const user = requireUser(req);
    requireTransaction(user);
    const payload = await readBody(req);
    const item = store().items.find(function (entry) { return entry.id === String(payload.itemId || ''); });
    if (!item) fail(404, 'ไม่พบสินค้าชิ้นนี้');
    if (item.status !== 'published' && item.ownerId !== user.id) fail(409, 'สินค้านี้ปิดรับการจองอยู่');
    if (item.ownerId === user.id) fail(400, 'ไม่สามารถจองประกาศของตัวเองได้');

    const start = parseDay(payload.start, 'วันที่เริ่มเช่า');
    const end = parseDay(payload.end, 'วันที่คืน');
    if (start < startOfTodayUtc()) fail(400, 'วันที่เริ่มเช่าต้องไม่เป็นวันในอดีต');
    const days = Math.round((end - start) / DAY);
    if (days < 1) fail(400, 'วันที่คืนต้องอยู่หลังวันที่เริ่มเช่า');
    if (days > 90) fail(400, 'จองได้ครั้งละไม่เกิน 90 วัน');

    /* กันจองทับช่วงที่มีคนจองอยู่แล้ว (รอยืนยันหรือกำลังเช่า) */
    const clash = store().bookings.some(function (entry) {
      if (entry.itemId !== item.id) return false;
      if (entry.status !== 'pending' && entry.status !== 'active') return false;
      return start < new Date(String(entry.end) + 'T00:00:00Z') && end > new Date(String(entry.start) + 'T00:00:00Z');
    });
    if (clash) fail(409, 'ช่วงวันที่เลือกถูกจองไปแล้ว — เลือกวันอื่นที่ว่าง');

    const total = item.price * days + item.deposit;

    ensureWallet(user);
    const credit = creditOf(user);
    if (credit < CREDIT_MIN_BOOKING) {
      fail(403, 'เครดิตของคุณ ' + credit + '/100 ต่ำกว่าเกณฑ์การจอง (' + CREDIT_MIN_BOOKING + ') — คืนของให้ครบสัก 1–2 ครั้งเพื่อเพิ่มเครดิต');
    }
    if (walletOf(user) < total) {
      fail(402, 'ยอดใน FLO-RENT Wallet ไม่พอ: ต้องใช้ ' + total + ' FLO แต่มี ' + walletOf(user) + ' FLO — เติมเงินที่หน้ากระเป๋าเงินก่อน');
    }

    const booking = {
      code: newBookingCode(),
      itemId: item.id,
      itemTitle: item.title,
      itemCat: item.cat,
      itemEmoji: item.emoji,
      owner: item.owner,
      ownerId: item.ownerId,
      userId: user.id,
      userName: user.name,
      status: 'pending',
      start: String(payload.start),
      end: String(payload.end),
      days: days,
      dayPrice: item.price,
      deposit: item.deposit,
      total: total,
      paidWith: 'wallet',
      paidAt: new Date().toISOString(),
      creditAtBooking: credit,
      createdAt: new Date().toISOString()
    };

    user.wallet = walletOf(user) - total;
    store().bookings.unshift(booking);
    store().holds.unshift({
      id: auth.newId('hd'),
      bookingCode: booking.code,
      renterId: user.id,
      ownerId: item.ownerId,
      rent: item.price * days,
      deposit: item.deposit,
      status: 'held',
      createdAt: new Date().toISOString()
    });
    pushLedger(user, {
      type: 'hold',
      amount: -total,
      note: 'กันเงินค่าเช่า + มัดจำ · ' + item.title,
      ref: booking.code
    });
    logEvent('wallet.hold', 'กันเงิน ' + total + ' FLO (' + (item.price * days) + ' ค่าเช่า + ' + item.deposit +
      ' มัดจำ) · ' + booking.code, user, booking.code);
    db.persist();
    return sendJson(res, 201, { booking: booking, wallet: walletOf(user) });
  }

  const bookingMatch = /^\/api\/bookings\/([\w-]+)$/.exec(pathname);
  if (bookingMatch && method === 'PATCH') {
    const user = requireUser(req);
    const code = bookingMatch[1];
    const booking = store().bookings.find(function (entry) { return entry.code === code; });
    if (!booking) fail(404, 'ไม่พบการจองนี้');
    if (booking.userId !== user.id && user.role !== 'admin') fail(403, 'จัดการได้เฉพาะการจองของตัวเอง');

    const payload = await readBody(req);
    const action = asEnum(String(payload.action || ''), 'การกระทำ', ['cancel', 'return']);

    if (action === 'cancel') {
      if (booking.status !== 'pending' && user.role !== 'admin') fail(409, 'ยกเลิกได้เฉพาะการจองที่ยังไม่เริ่มใช้งาน');
      booking.status = 'cancelled';
      booking.cancelledAt = new Date().toISOString();
      settleBooking(booking, 'cancelled', user);
    } else if (user.role === 'admin') {
      /* แอดมินปิดงานแทนได้ (หลังไกล่เกลี่ย) — ผู้ใช้ทั่วไปต้องรอผู้ให้เช่ายืนยัน */
      booking.status = 'returned';
      booking.returnedAt = new Date().toISOString();
      settleBooking(booking, 'returned', user);
    } else {
      /*
       * คืนของ 2 ขั้น: ผู้เช่า “แจ้งคืน” แล้วผู้ให้เช่าต้อง “ยืนยันรับคืน”
       * มัดจำยังถูกกันไว้ (hold = held) จนกว่าเจ้าของจะยืนยันหรือแอดมินตัดสิน
       */
      if (booking.status !== 'active') fail(409, 'แจ้งคืนได้เฉพาะการจองที่กำลังเช่าอยู่');
      booking.status = 'return_requested';
      booking.returnRequestedAt = new Date().toISOString();
      logEvent('booking.return-requested', 'ผู้เช่าแจ้งคืน ' + booking.code + ' — รอผู้ให้เช่ายืนยันรับคืน', user, booking.code);
    }

    db.persist();
    return sendJson(res, 200, { booking: booking, wallet: walletOf(user) });
  }

  /* ---- bookings ฝั่งผู้ให้เช่า: ดูคำขอจองของประกาศตัวเอง และยืนยัน/ปฏิเสธ ---- */

  if (key === 'GET /api/owner/bookings') {
    const user = requireUser(req);
    const status = String(url.searchParams.get('status') || 'all');
    let list = store().bookings.filter(function (booking) { return booking.ownerId === user.id; });
    if (status !== 'all') list = list.filter(function (booking) { return booking.status === status; });
    list = list.slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    return sendJson(res, 200, Object.assign(paged(url, list, 'bookings', 100, 200), {
      pending: store().bookings.filter(function (booking) {
        return booking.ownerId === user.id && booking.status === 'pending';
      }).length,
      returnRequests: store().bookings.filter(function (booking) {
        return booking.ownerId === user.id && booking.status === 'return_requested';
      }).length
    }));
  }

  const ownerBookingMatch = /^\/api\/owner\/bookings\/([\w-]+)$/.exec(pathname);
  if (ownerBookingMatch && method === 'PATCH') {
    const user = requireUser(req);
    const booking = store().bookings.find(function (entry) { return entry.code === ownerBookingMatch[1]; });
    if (!booking) fail(404, 'ไม่พบการจองนี้');
    if (booking.ownerId !== user.id && user.role !== 'admin') fail(403, 'ยืนยันได้เฉพาะการจองของประกาศตัวเอง');

    const payload = await readBody(req);
    const action = asEnum(String(payload.action || ''), 'การกระทำ', ['confirm', 'reject', 'receive', 'dispute']);

    /* ขั้นที่ 2 ของการคืนของ: ผู้ให้เช่ายืนยันรับคืน หรือแจ้งปัญหา */
    if (action === 'receive' || action === 'dispute') {
      if (booking.status !== 'return_requested') {
        fail(409, 'ยืนยันรับคืนได้เฉพาะการจองที่ผู้เช่าแจ้งคืนแล้ว');
      }

      if (action === 'receive') {
        booking.status = 'returned';
        booking.returnedAt = new Date().toISOString();
        booking.receivedBy = user.id;
        settleBooking(booking, 'returned', user);
        logEvent('booking.received', 'ผู้ให้เช่ายืนยันรับคืน ' + booking.code + ' — คืนมัดจำและจ่ายค่าเช่าแล้ว', user, booking.code);
      } else {
        const note = asString(payload.note, 'เหตุผลที่ยังรับคืนไม่ได้', { min: 2, max: 300 });
        booking.status = 'active';
        booking.disputedAt = new Date().toISOString();
        booking.disputeNote = note;
        logEvent('booking.dispute', 'ผู้ให้เช่าโต้แย้งการคืน ' + booking.code + ': ' + note, user, booking.code);
      }

      db.persist();
      return sendJson(res, 200, { booking: booking });
    }

    if (booking.status !== 'pending') fail(409, 'จัดการได้เฉพาะการจองที่รอยืนยันอยู่');

    if (action === 'confirm') {
      booking.status = 'active';
      booking.confirmedAt = new Date().toISOString();
      booking.confirmedBy = user.id;
      adjustCredit(user, 1, 'ยืนยันการจอง ' + booking.code);
      logEvent('booking.confirm', 'ยืนยันการจอง ' + booking.code + ' ของ ' + (booking.userName || 'ผู้เช่า'), user, booking.code);
    } else {
      booking.status = 'cancelled';
      booking.cancelledAt = new Date().toISOString();
      booking.cancelledBy = 'owner';
      settleBooking(booking, 'cancelled', user, { rejectedByOwner: true, penalizeRenter: false });
      logEvent('booking.reject', 'ปฏิเสธการจอง ' + booking.code + ' และคืนเงินให้ ' + (booking.userName || 'ผู้เช่า'), user, booking.code);
    }

    db.persist();
    return sendJson(res, 200, { booking: booking });
  }

  /* ---- look for requests ---- */

  if (key === 'GET /api/requests') {
    const viewer = currentUser(req);
    const list = store().requests.slice().sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    }).map(function (request) { return publicRequest(request, viewer); });
    return sendJson(res, 200, paged(url, list, 'requests', 50, 100));
  }

  if (key === 'POST /api/requests') {
    const user = requireUser(req);
    const payload = await readBody(req);
    const request = {
      id: auth.newId('rq'),
      want: asString(payload.want, 'สิ่งที่ต้องการเช่า', { min: 2, max: 160 }),
      cat: asEnum(String(payload.cat || 'all'), 'หมวดหมู่', ['all'].concat(categoryKeys())),
      budget: asInt(payload.budget === undefined ? 0 : payload.budget, 'งบต่อวัน', { min: 0, max: 1000000, required: false }) || 0,
      when: asString(payload.when, 'ช่วงวันที่', { max: 60, required: false }) || 'ไม่ระบุ',
      name: asString(payload.name, 'ชื่อผู้ประกาศ', { max: 60, required: false }) || user.name,
      userId: user.id,
      offers: [],
      createdAt: new Date().toISOString()
    };
    store().requests.unshift(request);
    db.persist();
    return sendJson(res, 201, { request: publicRequest(request, user) });
  }

  /* เสนอประกาศของตัวเองให้คำขอตามหา (เจ้าของประกาศเท่านั้น) */
  const offerMatch = /^\/api\/requests\/([\w-]+)\/offers$/.exec(pathname);
  if (offerMatch && method === 'POST') {
    const user = requireUser(req);
    const target = store().requests.find(function (entry) { return entry.id === offerMatch[1]; });
    if (!target) fail(404, 'ไม่พบคำขอนี้');
    if (target.userId === user.id) fail(400, 'นี่คือคำขอของคุณเอง — รอให้คนอื่นเสนอของให้');

    const payload = await readBody(req);
    const item = store().items.find(function (entry) { return entry.id === String(payload.itemId || ''); });
    if (!item) fail(404, 'ไม่พบประกาศที่เลือก');
    if (item.ownerId !== user.id) fail(403, 'เสนอได้เฉพาะประกาศของคุณเอง');
    if (item.status !== 'published') fail(409, 'ประกาศนี้ถูกซ่อนอยู่ — เผยแพร่ก่อนแล้วค่อยเสนอ');

    if (!target.offers) target.offers = [];
    const duplicate = target.offers.some(function (offer) { return offer.userId === user.id && offer.itemId === item.id; });
    if (duplicate) fail(409, 'คุณเสนอประกาศนี้ให้คำขอนี้ไปแล้ว');

    const offer = {
      id: auth.newId('of'),
      userId: user.id,
      userName: user.name,
      itemId: item.id,
      itemTitle: item.title,
      itemEmoji: item.emoji,
      itemPrice: item.price,
      note: asString(payload.note, 'ข้อความถึงผู้ประกาศ', { max: 200, required: false }),
      createdAt: new Date().toISOString()
    };
    target.offers.push(offer);
    db.persist();
    return sendJson(res, 201, { offer: offer, request: publicRequest(target, user) });
  }

  /* ---- งาน / จ้างคนทำงาน ( freelance ) ---- */

  if (key === 'GET /api/work-categories') {
    return sendJson(res, 200, { categories: jobCategories() });
  }

  if (key === 'GET /api/workers') {
    ensureWorkData();
    const cat = String(url.searchParams.get('cat') || 'all');
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const list = store().workers.filter(function (worker) {
      if (cat !== 'all' && worker.cat !== cat) return false;
      if (!q) return true;
      const haystack = [worker.name, worker.bio, worker.location, jobCatOf(worker.cat).name].join(' ').toLowerCase();
      return haystack.indexOf(q) !== -1;
    });
    return sendJson(res, 200, { workers: list.map(publicWorker), count: list.length });
  }

  if (key === 'GET /api/jobs') {
    ensureWorkData();
    const cat = String(url.searchParams.get('cat') || 'all');
    const mine = url.searchParams.get('mine') === '1';
    const viewer = mine ? requireUser(req) : currentUser(req);
    const list = store().jobs.filter(function (job) {
      if (mine && job.userId !== viewer.id) return false;
      return cat === 'all' || job.cat === cat;
    }).slice().sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    return sendJson(res, 200, { jobs: list.map(publicJob), count: list.length });
  }

  if (key === 'POST /api/jobs') {
    const user = requireUser(req);
    const payload = await readBody(req);
    const job = {
      id: auth.newId('job'),
      title: asString(payload.title, 'ชื่องาน', { min: 2, max: 120 }),
      cat: asEnum(String(payload.cat || ''), 'หมวดหมู่การจ้างงาน', jobKeys()),
      rate: asInt(payload.rate, 'ค่าจ้างต่อวัน', { min: 0, max: 100000 }),
      days: asInt(payload.days === undefined || payload.days === '' ? 1 : payload.days, 'จำนวนวัน', { min: 1, max: 90 }) || 1,
      start: payload.start ? asDay(payload.start, 'วันที่เริ่มงาน') : null,
      location: asString(payload.location, 'พื้นที่ทำงาน', { max: 80, required: false }) || 'ไม่ระบุพื้นที่',
      desc: asString(payload.desc, 'รายละเอียดงาน', { max: 1200, required: false }) || 'ยังไม่มีรายละเอียด',
      name: user.name,
      userId: user.id,
      status: 'open',
      createdAt: new Date().toISOString()
    };
    store().jobs.unshift(job);
    logEvent('job.create', 'ประกาศหางาน: ' + job.title + ' (' + job.rate + ' บาท/วัน)', user, job.id);
    db.persist();
    return sendJson(res, 201, { job: publicJob(job) });
  }

  if (key === 'GET /api/hires') {
    const user = requireUser(req);
    const list = store().hires.filter(function (hire) { return hire.userId === user.id; });
    return sendJson(res, 200, { hires: list.map(publicHire), wallet: walletOf(user) });
  }

  if (key === 'POST /api/hires') {
    const user = requireUser(req);
    const payload = await readBody(req);
    const worker = store().workers.find(function (entry) { return entry.id === String(payload.workerId || ''); });
    if (!worker) fail(404, 'ไม่พบคนทำงานคนนี้');
    if (worker.userId && worker.userId === user.id) fail(400, 'จ้างตัวเองไม่ได้');

    const days = asInt(payload.days === undefined || payload.days === '' ? 1 : payload.days, 'จำนวนวัน', { min: 1, max: 30 }) || 1;
    const start = payload.start ? asDay(payload.start, 'วันที่เริ่มงาน') : null;
    const total = worker.rate * days;

    ensureWallet(user);
    const credit = creditOf(user);
    if (credit < CREDIT_MIN_BOOKING) {
      fail(403, 'เครดิตของคุณ ' + credit + '/100 ต่ำกว่าเกณฑ์การจ้าง (' + CREDIT_MIN_BOOKING + ')');
    }
    if (walletOf(user) < total) {
      fail(402, 'ยอดใน FLO-RENT Wallet ไม่พอ: ต้องจ่าย ' + total + ' FLO แต่มี ' + walletOf(user) + ' FLO — เติมเงินที่หน้ากระเป๋าเงินก่อน');
    }

    user.wallet = walletOf(user) - total;
    const hire = {
      code: newHireCode(),
      workerId: worker.id,
      workerName: worker.name,
      workerCatName: jobCatOf(worker.cat).name,
      dayRate: worker.rate,
      days: days,
      start: start,
      total: total,
      status: 'pending',
      userId: user.id,
      userName: user.name,
      createdAt: new Date().toISOString()
    };
    store().hires.unshift(hire);
    pushLedger(user, {
      type: 'hire',
      amount: -total,
      note: 'จ้าง ' + worker.name + ' ' + days + ' วัน',
      ref: hire.code
    });
    logEvent('hire.create', 'จ้าง ' + worker.name + ' ' + days + ' วัน · ' + total + ' FLO', user, hire.code);
    db.persist();
    return sendJson(res, 201, { hire: publicHire(hire), wallet: walletOf(user) });
  }

  const hireMatch = /^\/api\/hires\/([\w-]+)$/.exec(pathname);
  if (hireMatch && method === 'PATCH') {
    const user = requireUser(req);
    const hire = store().hires.find(function (entry) { return entry.code === hireMatch[1]; });
    if (!hire) fail(404, 'ไม่พบรายการจ้างนี้');
    if (hire.userId !== user.id && user.role !== 'admin') fail(403, 'จัดการได้เฉพาะรายการจ้างของคุณเอง');

    const payload = await readBody(req);
    asEnum(String(payload.action || ''), 'การกระทำ', ['cancel']);
    if (hire.status !== 'pending') fail(409, 'ยกเลิกได้เฉพาะรายการที่ยังไม่เริ่มงาน');

    hire.status = 'cancelled';
    hire.cancelledAt = new Date().toISOString();
    user.wallet = walletOf(user) + hire.total;
    pushLedger(user, { type: 'refund', amount: hire.total, note: 'คืนเงินค่าจ้าง · ' + hire.workerName, ref: hire.code });
    logEvent('hire.cancel', 'ยกเลิกการจ้าง ' + hire.workerName + ' · คืน ' + hire.total + ' FLO', user, hire.code);
    db.persist();
    return sendJson(res, 200, { hire: publicHire(hire), wallet: walletOf(user) });
  }

  /* ---- FLO-RENT wallet ---- */

  if (key === 'GET /api/wallet') {
    const user = requireUser(req);
    const migrated = typeof user.wallet !== 'number';
    ensureWallet(user);
    if (migrated) db.persist();

    const transactions = store().ledger
      .filter(function (entry) { return entry.userId === user.id; })
      .slice(0, 80);
    const holds = store().holds
      .filter(function (entry) { return entry.renterId === user.id && entry.status === 'held'; });

    return sendJson(res, 200, {
      balance: walletOf(user),
      credit: creditOf(user),
      level: creditLevel(creditOf(user)),
      minBookingCredit: CREDIT_MIN_BOOKING,
      transactions: transactions,
      holds: holds
    });
  }

  if (key === 'POST /api/wallet/topup') {
    const user = requireUser(req);
    ensureWallet(user);
    const payload = await readBody(req);
    const amount = asInt(payload.amount, 'จำนวนเงินที่เติม', { min: 1, max: 50000 });

    user.wallet = walletOf(user) + amount;
    const entry = pushLedger(user, { type: 'topup', amount: amount, note: 'เติมเงินเข้า FLO-RENT Wallet' });
    logEvent('wallet.topup', user.name + ' เติม ' + amount + ' FLO (คงเหลือ ' + user.wallet + ' FLO)', user, entry.id);
    db.persist();

    return sendJson(res, 201, {
      balance: user.wallet,
      credit: creditOf(user),
      level: creditLevel(creditOf(user)),
      transaction: entry
    });
  }

  /* ---- admin ---- */

  if (key === 'GET /api/admin/wallet') {
    requireAdmin(req);
    const users = store().users;
    const holds = store().holds.filter(function (hold) { return hold.status === 'held'; });
    const summary = { wallets: 0, escrow: 0, topups: 0, payouts: 0, holds: holds.length, transactions: store().ledger.length };

    users.forEach(function (user) { summary.wallets += walletOf(user); });
    store().ledger.forEach(function (entry) {
      if (entry.type === 'topup') summary.topups += entry.amount;
      if (entry.type === 'payout') summary.payouts += entry.amount;
    });
    holds.forEach(function (hold) { summary.escrow += hold.rent + hold.deposit; });

    return sendJson(res, 200, {
      summary: summary,
      transactions: store().ledger.slice(0, 150),
      holds: holds,
      users: users.map(function (user) {
        return { id: user.id, name: user.name, email: user.email, wallet: walletOf(user), credit: creditOf(user) };
      })
    });
  }

  if (key === 'GET /api/admin/logs') {
    requireAdmin(req);
    return sendJson(res, 200, paged(url, store().logs, 'logs', 200, 500));
  }

  /* ---- admin: หมวดหมู่ (สินค้า / การจ้างงาน) ---- */

  if (key === 'GET /api/admin/categories') {
    requireAdmin(req);
    return sendJson(res, 200, {
      items: itemCategories().map(function (cat) {
        return Object.assign({}, cat, {
          usage: store().items.filter(function (item) { return item.cat === cat.key; }).length
        });
      }),
      jobs: jobCategories().map(function (cat) {
        return Object.assign({}, cat, {
          usage: store().jobs.filter(function (job) { return job.cat === cat.key; }).length
        });
      })
    });
  }

  if (key === 'POST /api/admin/categories') {
    const admin = requireAdmin(req);
    const payload = await readBody(req);
    const kind = asEnum(String(payload.kind || 'items'), 'ประเภทหมวดหมู่', ['items', 'jobs']);
    const list = kind === 'jobs' ? jobCategories() : itemCategories();
    const name = asString(payload.name, 'ชื่อหมวดหมู่', { min: 2, max: 40 });
    if (list.some(function (cat) { return cat.name.toLowerCase() === name.toLowerCase(); })) {
      fail(409, 'มีหมวดหมู่นี้อยู่แล้ว');
    }

    const emoji = asString(payload.emoji, 'ไอคอน', { max: 4, required: false }) || (kind === 'jobs' ? '🧰' : '📦');
    const sub = asString(payload.sub, 'คำอธิบาย', { max: 120, required: false });

    const base = slugifyCategory(name) || auth.newId('cat');
    let categoryKey = base;
    let counter = 1;
    while (list.some(function (cat) { return cat.key === categoryKey; })) {
      counter += 1;
      categoryKey = base + '-' + counter;
    }

    const category = { key: categoryKey, name: name, emoji: emoji, sub: sub };
    if (kind === 'items') category.num = String(list.length + 1).padStart(2, '0');
    list.push(category);
    logEvent('category.create', 'เพิ่มหมวดหมู่' + (kind === 'jobs' ? 'การจ้างงาน' : 'สินค้า') + ': ' + name, admin, categoryKey);
    db.persist();
    return sendJson(res, 201, { kind: kind, category: category });
  }

  const adminCatMatch = /^\/api\/admin\/categories\/(items|jobs)\/([\w-]+)$/.exec(pathname);
  if (adminCatMatch && method === 'PATCH') {
    const admin = requireAdmin(req);
    const kind = adminCatMatch[1];
    const list = kind === 'jobs' ? jobCategories() : itemCategories();
    const category = list.find(function (cat) { return cat.key === adminCatMatch[2]; });
    if (!category) fail(404, 'ไม่พบหมวดหมู่นี้');

    const payload = await readBody(req);
    if (payload.name !== undefined) {
      const name = asString(payload.name, 'ชื่อหมวดหมู่', { min: 2, max: 40 });
      const duplicate = list.some(function (cat) {
        return cat.key !== category.key && cat.name.toLowerCase() === name.toLowerCase();
      });
      if (duplicate) fail(409, 'มีหมวดหมู่นี้อยู่แล้ว');
      category.name = name;
    }
    if (payload.emoji !== undefined) {
      category.emoji = asString(payload.emoji, 'ไอคอน', { max: 4, required: false }) || category.emoji;
    }
    if (payload.sub !== undefined) category.sub = asString(payload.sub, 'คำอธิบาย', { max: 120, required: false });

    logEvent('category.update', 'แก้ไขหมวดหมู่: ' + category.name, admin, category.key);
    db.persist();
    return sendJson(res, 200, { kind: kind, category: category });
  }

  if (adminCatMatch && method === 'DELETE') {
    const admin = requireAdmin(req);
    const kind = adminCatMatch[1];
    const list = kind === 'jobs' ? jobCategories() : itemCategories();
    const category = list.find(function (cat) { return cat.key === adminCatMatch[2]; });
    if (!category) fail(404, 'ไม่พบหมวดหมู่นี้');

    const usage = kind === 'jobs'
      ? store().jobs.filter(function (job) { return job.cat === category.key; }).length
      : store().items.filter(function (item) { return item.cat === category.key; }).length;
    if (usage > 0) {
      fail(409, 'ลบไม่ได้: ยังมี' + (kind === 'jobs' ? 'งาน' : 'สินค้า') + ' ' + usage + ' รายการอยู่ในหมวดนี้ — ย้ายหรือลบรายการนั้นก่อน');
    }

    const next = list.filter(function (cat) { return cat.key !== category.key; });
    if (kind === 'jobs') store().jobCategories = next; else store().categories = next;
    logEvent('category.delete', 'ลบหมวดหมู่: ' + category.name, admin, category.key);
    db.persist();
    return sendJson(res, 200, { ok: true });
  }

  if (key === 'GET /api/admin/stats') {
    requireAdmin(req);
    const users = store().users;
    const items = store().items;
    const bookings = store().bookings;
    const statuses = ['pending', 'active', 'return_requested', 'returned', 'cancelled'];
    const byStatus = {};
    statuses.forEach(function (status) {
      byStatus[status] = bookings.filter(function (booking) { return booking.status === status; }).length;
    });

    return sendJson(res, 200, {
      users: users.length,
      suspended: users.filter(function (user) { return user.status === 'suspended'; }).length,
      items: items.length,
      published: items.filter(function (item) { return item.status === 'published'; }).length,
      hidden: items.filter(function (item) { return item.status === 'hidden'; }).length,
      bookings: bookings.length,
      byStatus: byStatus,
      revenue: bookings.filter(function (booking) { return booking.status !== 'cancelled'; })
        .reduce(function (sum, booking) { return sum + Number(booking.total || 0); }, 0),
      requests: store().requests.length,
      walletTotal: users.reduce(function (sum, user) { return sum + walletOf(user); }, 0),
      escrow: store().holds.filter(function (hold) { return hold.status === 'held'; })
        .reduce(function (sum, hold) { return sum + hold.rent + hold.deposit; }, 0),
      activeHolds: store().holds.filter(function (hold) { return hold.status === 'held'; }).length,
      recentBookings: bookings.slice().sort(function (a, b) {
        return String(b.createdAt).localeCompare(String(a.createdAt));
      }).slice(0, 6)
    });
  }

  if (key === 'GET /api/admin/users') {
    requireAdmin(req);
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const bookings = store().bookings;
    let users = store().users.map(function (user) {
      const mine = bookings.filter(function (booking) { return booking.userId === user.id; });
      return Object.assign(publicUser(user), {
        bookingCount: mine.length,
        spent: mine.filter(function (b) { return b.status !== 'cancelled'; })
          .reduce(function (sum, b) { return sum + Number(b.total || 0); }, 0),
        listingCount: store().items.filter(function (item) { return item.ownerId === user.id; }).length
      });
    });
    if (q) users = users.filter(function (user) { return (user.name + ' ' + user.email).toLowerCase().indexOf(q) !== -1; });
    users.sort(function (a, b) { return String(b.joinedAt).localeCompare(String(a.joinedAt)); });
    return sendJson(res, 200, paged(url, users, 'users', 100, 500));
  }

  const adminUserMatch = /^\/api\/admin\/users\/([\w-]+)$/.exec(pathname);
  if (adminUserMatch && method === 'PATCH') {
    const admin = requireAdmin(req);
    const target = store().users.find(function (user) { return user.id === adminUserMatch[1]; });
    if (!target) fail(404, 'ไม่พบผู้ใช้นี้');
    if (target.id === admin.id) fail(400, 'ไม่สามารถเปลี่ยนสิทธิ์บัญชีที่กำลังใช้งานอยู่');
    const payload = await readBody(req);
    if (payload.role !== undefined) target.role = asEnum(String(payload.role), 'บทบาท', ['user', 'admin']);
    if (payload.status !== undefined) {
      target.status = asEnum(String(payload.status), 'สถานะบัญชี', ['active', 'suspended']);
      if (target.status === 'suspended') {
        store().sessions = store().sessions.filter(function (session) { return session.userId !== target.id; });
      }
    }
    db.persist();
    return sendJson(res, 200, { user: publicUser(target) });
  }

  if (key === 'GET /api/admin/items') {
    requireAdmin(req);
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    let items = store().items.slice();
    if (q) {
      items = items.filter(function (item) {
        return (item.title + ' ' + item.owner + ' ' + item.id).toLowerCase().indexOf(q) !== -1;
      });
    }
    items.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    return sendJson(res, 200, paged(url, items.map(publicItem), 'items', 100, 500));
  }

  const adminItemMatch = /^\/api\/admin\/items\/([\w-]+)$/.exec(pathname);
  if (adminItemMatch) {
    requireAdmin(req);
    const item = store().items.find(function (entry) { return entry.id === adminItemMatch[1]; });
    if (!item) fail(404, 'ไม่พบสินค้านี้');

    if (method === 'PATCH') {
      const payload = await readBody(req);
      item.status = asEnum(String(payload.status || ''), 'สถานะประกาศ', ['published', 'hidden']);
      db.persist();
      return sendJson(res, 200, { item: publicItem(item) });
    }
    if (method === 'DELETE') {
      store().items = store().items.filter(function (entry) { return entry.id !== item.id; });
      db.persist();
      return sendJson(res, 200, { ok: true });
    }
  }

  if (key === 'GET /api/admin/bookings') {
    requireAdmin(req);
    const status = String(url.searchParams.get('status') || 'all');
    let bookings = store().bookings.slice();
    if (status !== 'all') bookings = bookings.filter(function (booking) { return booking.status === status; });
    bookings.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    return sendJson(res, 200, paged(url, bookings, 'bookings', 100, 500));
  }

  const adminBookingMatch = /^\/api\/admin\/bookings\/([\w-]+)$/.exec(pathname);
  if (adminBookingMatch && method === 'PATCH') {
    const admin = requireAdmin(req);
    const booking = store().bookings.find(function (entry) { return entry.code === adminBookingMatch[1]; });
    if (!booking) fail(404, 'ไม่พบการจองนี้');
    const payload = await readBody(req);
    const next = asEnum(String(payload.status || ''), 'สถานะการจอง', ['pending', 'active', 'return_requested', 'returned', 'cancelled']);
    booking.status = next;
    if (next === 'returned') booking.returnedAt = new Date().toISOString();
    if (next === 'cancelled') booking.cancelledAt = new Date().toISOString();
    settleBooking(booking, next, admin);
    db.persist();
    return sendJson(res, 200, { booking: booking });
  }

  if (key === 'GET /api/admin/requests') {
    requireAdmin(req);
    const list = store().requests.slice().sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    return sendJson(res, 200, paged(url, list, 'requests', 100, 500));
  }

  const adminRequestMatch = /^\/api\/admin\/requests\/([\w-]+)$/.exec(pathname);
  if (adminRequestMatch && method === 'DELETE') {
    requireAdmin(req);
    store().requests = store().requests.filter(function (request) { return request.id !== adminRequestMatch[1]; });
    db.persist();
    return sendJson(res, 200, { ok: true });
  }

  /* ---- ยืนยันตัวตน (บัตรประชาชน) ---- */

  if (key === 'GET /api/verification') {
    const user = requireUser(req);
    return sendJson(res, 200, { verification: publicVerification(user) });
  }

  if (key === 'POST /api/verification') {
    const user = requireUser(req);
    const current = verificationOf(user);
    if (current.status === 'verified') fail(409, 'บัญชีนี้ยืนยันตัวตนแล้ว');
    if (current.status === 'pending') fail(409, 'คำขอยืนยันตัวตนอยู่ระหว่างการตรวจสอบ');

    const payload = await readBody(req);
    const idNumber = asString(payload.idNumber, 'เลขบัตรประชาชน', { max: 25 });
    if (!verify.isValidThaiId(idNumber)) {
      fail(400, 'เลขบัตรประชาชนไม่ถูกต้อง (ต้องเป็นตัวเลข 13 หลักและผ่านการตรวจสอบ)');
    }
    const fullName = asString(payload.fullName, 'ชื่อ-นามสกุลตามบัตร', { min: 4, max: 120 });
    const photo = String(payload.photo || '');
    if (!photo) fail(400, 'ต้องแนบรูปบัตรประชาชน');
    if (!ID_PHOTO_RE.test(photo)) fail(400, 'รูปบัตรต้องเป็นไฟล์ JPEG / PNG / WebP');
    if (Buffer.byteLength(photo) > verify.MAX_PHOTO_BYTES) fail(413, 'รูปบัตรใหญ่เกิน 1.2MB — ย่อรูปแล้วลองใหม่');

    const idHash = verify.hashId(idNumber);
    const duplicate = store().users.some(function (entry) {
      return entry.id !== user.id && entry.verify && entry.verify.idHash === idHash;
    });
    if (duplicate) fail(409, 'เลขบัตรประชาชนนี้ถูกใช้ยืนยันตัวตนกับบัญชีอื่นแล้ว');
    checkVerifyRate(user);

    const stored = await verify.savePhoto(user.id, photo);
    user.verify = {
      status: 'pending',
      idHash: idHash,
      idMasked: verify.maskId(idNumber),
      fullName: fullName,
      submittedAt: new Date().toISOString(),
      photoExpiresAt: stored.expiresAt
    };
    logEvent('verification.submit', 'ส่งคำขอยืนยันตัวตน: ' + user.name + ' (' + user.verify.idMasked + ')', user, user.id);
    db.persist();
    return sendJson(res, 201, { verification: publicVerification(user) });
  }

  if (key === 'GET /api/admin/verifications') {
    requireAdmin(req);
    const status = String(url.searchParams.get('status') || 'pending');
    const list = store().users.filter(function (entry) {
      if (!entry.verify) return false;
      return status === 'all' ? true : entry.verify.status === status;
    }).map(function (entry) {
      return {
        userId: entry.id,
        name: entry.name,
        email: entry.email,
        status: entry.verify.status,
        idMasked: entry.verify.idMasked || '',
        fullName: entry.verify.fullName || '',
        submittedAt: entry.verify.submittedAt || null,
        reviewedAt: entry.verify.reviewedAt || null,
        rejectReason: entry.verify.rejectReason || '',
        hasPhoto: !!entry.verify.photoExpiresAt,
        photoExpiresAt: entry.verify.photoExpiresAt || null
      };
    });
    return sendJson(res, 200, { verifications: list, total: list.length });
  }

  const adminVerifyMatch = /^\/api\/admin\/verifications\/([\w-]+)$/.exec(pathname);
  if (adminVerifyMatch && method === 'PATCH') {
    const admin = requireAdmin(req);
    const target = store().users.find(function (entry) { return entry.id === adminVerifyMatch[1]; });
    if (!target) fail(404, 'ไม่พบผู้ใช้นี้');
    if (!target.verify || target.verify.status !== 'pending') fail(409, 'ผู้ใช้นี้ไม่ได้อยู่ในคิวรอตรวจ');

    const payload = await readBody(req);
    const action = asEnum(String(payload.action || ''), 'การกระทำ', ['approve', 'reject']);
    target.verify.reviewedAt = new Date().toISOString();
    target.verify.reviewedBy = admin.id;

    if (action === 'approve') {
      target.verify.status = 'verified';
      target.verify.rejectReason = '';
      logEvent('verification.approve', 'อนุมัติการยืนยันตัวตนของ ' + target.name, admin, target.id);
    } else {
      target.verify.status = 'rejected';
      target.verify.rejectReason = asString(payload.reason || payload.note, 'เหตุผลที่ปฏิเสธ', { min: 2, max: 200 });
      logEvent('verification.reject', 'ปฏิเสธการยืนยันตัวตนของ ' + target.name + ': ' + target.verify.rejectReason, admin, target.id);
    }

    db.persist();
    return sendJson(res, 200, { user: publicUser(target) });
  }

  /* รูปบัตรสำหรับแอดมินเท่านั้น: ถอดรหัสแล้วส่งให้ดูทีละครั้ง พร้อมบันทึกว่าใครเปิดดู */
  const adminVerifyPhotoMatch = /^\/api\/admin\/verifications\/([\w-]+)\/photo$/.exec(pathname);
  if (adminVerifyPhotoMatch && method === 'GET') {
    const admin = requireAdmin(req);
    const target = store().users.find(function (entry) { return entry.id === adminVerifyPhotoMatch[1]; });
    if (!target || !target.verify) fail(404, 'ไม่พบคำขอยืนยันตัวตนนี้');

    let photo = null;
    try { photo = await verify.readPhoto(target.id); } catch (err) { photo = null; }
    if (!photo) fail(404, 'ไม่พบรูปบัตร (อาจถูกลบตามระยะเวลาเก็บข้อมูลแล้ว)');

    logEvent('verification.photo.view', 'แอดมินเปิดดูรูปบัตรของ ' + target.name, admin, target.id);
    db.persist();
    return sendJson(res, 200, { photo: photo, expiresAt: target.verify.photoExpiresAt || null });
  }

  return sendJson(res, 404, { error: 'ไม่พบ API นี้' });
}

/* ---------- server ---------- */

async function handle(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  if (url.pathname === '/api' || url.pathname.indexOf('/api/') === 0) {
    return handleApi(req, res, url);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'ไม่รองรับ method นี้' });
  }

  return serveStatic(req, res, url.pathname);
}

function respond(req, res) {
  return handle(req, res).catch(function (err) {
    const status = err && err.status ? err.status : 500;
    if (status >= 500 && !err.expose) console.error('[api]', err);
    if (res.headersSent) return res.end();
    const payload = { error: status >= 500 && !err.expose ? 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' : err.message };
    if (err && err.code) payload.code = err.code;
    sendJson(res, status, payload);
  });
}

module.exports = { respond, seed };

/* รันตรง ๆ (npm start) = เซิร์ฟเวอร์ปกติ / บน Vercel ไฟล์ api/index.js จะ require ไฟล์นี้ไปใช้แทน */
if (require.main === module) {
  db.init(seed.build);

  const server = http.createServer(respond);

  server.listen(PORT, HOST, function () {
    console.log('FLO-RENT พร้อมใช้งานที่ http://' + HOST + ':' + PORT);
    console.log('ไฟล์ข้อมูล: ' + db.DB_FILE);
    if (DEMO_MODE) {
      console.log('โหมดเดโม: มีบัญชีทดลอง demo@flo-rent.co / owner@flo-rent.co / admin@flo-rent.co (รหัสอยู่ใน README)');
      console.log('ก่อนใช้งานจริงให้ตั้ง NODE_ENV=production และ FLO_ADMIN_EMAIL / FLO_ADMIN_PASSWORD');
    } else {
      console.log('โหมด production: ไม่สร้างบัญชีทดลอง — แอดมินมาจาก FLO_ADMIN_EMAIL');
    }
    if (mailer.isConfigured()) {
      console.log('อีเมล OTP: ส่งผ่าน ' + mailer.provider() + ' จาก ' + mailer.fromAddress());
    } else if (DEMO_MODE) {
      console.log('อีเมล OTP: ยังไม่ตั้งค่า — โหมดพัฒนาจะพิมพ์รหัสลงคอนโซลนี้แทนการส่งอีเมลจริง');
    } else {
      console.warn('อีเมล OTP: ยังไม่ตั้งค่า — ตั้ง RESEND_API_KEY หรือ BREVO_API_KEY ก่อนใช้งานจริง');
    }
  });

  const shutdown = function (signal) {
    console.log('\nได้รับสัญญาณ ' + signal + ' กำลังบันทึกข้อมูลและปิดเซิร์ฟเวอร์...');
    db.flushSync();
    server.close(function () { process.exit(0); });
    setTimeout(function () { process.exit(0); }, 3000).unref();
  };

  process.on('SIGINT', function () { shutdown('SIGINT'); });
  process.on('SIGTERM', function () { shutdown('SIGTERM'); });
  process.on('uncaughtException', function (err) {
    console.error('[fatal]', err);
    db.flushSync();
    process.exit(1);
  });
}
