'use strict';

/*
 * ชุดทดสอบ UI เฟส A — ตรวจไฟล์ static ว่ามาร์กอัป/สไตล์ที่เพิ่มยังอยู่ครบ
 * (ไม่ได้ทดสอบการแสดงผลจริง — ส่วนนั้นตรวจด้วยตาในเบราว์เซอร์)
 *
 * ครอบคลุม: เมนูล่างมือถือ + เมนูพับในหัวเว็บ, skeleton ตอนโหลด,
 * sticky CTA ในหน้าสินค้า, และตรวจว่าฟังก์ชันจองเดิมยังอยู่
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const app = fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'css', 'style.css'), 'utf8');

test('เมนูล่างมือถือมี 5 ปลายทาง และทุกไฟล์ปลายทางมีจริง', function () {
  assert.match(app, /className = 'bottom-nav'/);
  ['index.html', 'browse.html', 'post.html', 'bookings.html', 'profile.html'].forEach(function (file) {
    assert.ok(fs.existsSync(path.join(PUBLIC, file)), 'ไม่พบไฟล์ ' + file);
    assert.ok(app.indexOf("'" + file + "'") !== -1, 'เมนูล่างไม่มีการอ้างถึง ' + file);
  });
});

test('หัวเว็บมือถือมีปุ่มเปิดเมนูพับ ปิดได้ด้วย Escape และล็อกการเลื่อนจอ', function () {
  assert.match(app, /className = 'nav-toggle'/);
  assert.match(app, /aria-expanded/);
  assert.match(app, /event\.key === 'Escape'/);
  assert.match(app, /data-menu-close/);
  assert.match(css, /body\.is-menu-open \{ overflow: hidden; \}/);
});

test('มี skeleton ระหว่างโหลดหน้าแรก หน้า browse และหน้ารายละเอียด', function () {
  assert.match(app, /function skeletonCards\(count\)/);
  assert.match(app, /function detailSkeleton\(\)/);
  assert.match(app, /featured\.innerHTML = skeletonCards\(8\)/);
  assert.match(app, /grid\.innerHTML = skeletonCards\(8\)/);
  assert.match(app, /root\.innerHTML = detailSkeleton\(\)/);
  assert.match(css, /@keyframes sk-shimmer/);
});

test('หน้าสินค้ามี sticky CTA เลื่อนไปการ์ดจอง และซ่อนเมื่อการ์ดจองอยู่ในจอ', function () {
  assert.match(app, /function paintStickyCta/);
  assert.match(app, /paintStickyCta\(item, isMine\)/);
  assert.match(app, /scrollIntoView/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /sticky-cta/);
});

test('สไตล์มือถือ: แท็บล่าง, กันเนื้อหาทับ, toast เหนือแท็บ, sticky CTA', function () {
  const start = css.indexOf('PHASE A');
  assert.ok(start !== -1, 'ไม่พบบล็อก PHASE A ใน style.css');
  const mobile = css.slice(start);
  assert.match(mobile, /\.bottom-nav \{[^}]*display: grid/);
  assert.match(mobile, /\.page \{ padding-bottom: calc\(72px \+ env\(safe-area-inset-bottom\)\); \}/);
  assert.match(mobile, /\.sticky-cta \{[^}]*position: fixed/);
  assert.match(mobile, /\.toast-stack \{ bottom: calc\(84px \+ env\(safe-area-inset-bottom\)\); \}/);
  assert.match(mobile, /\.nav \{ display: none; \}/);
});

test('flow การจองและการยืนยันตัวตนเดิมไม่ถูกแก้', function () {
  assert.match(app, /formEl\.addEventListener\('submit'/);
  assert.match(app, /if \(!sessionUser\) \{\s*requireLogin\(\);/);
  assert.match(app, /showVerifyNeeded\(err, \$\('booking-card'\)\)/);
});
