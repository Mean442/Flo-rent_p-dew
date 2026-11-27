'use strict';

/*
 * ชุดทดสอบหน้า login แบบ split panel + stepper
 * ตรวจไฟล์ static (HTML/CSS/JS) ว่ามาร์กอัป สไตล์ และตัวควบคุมที่ต้องใช้คู่กันยังครบ
 * ไม่ได้รันเบราว์เซอร์จริง — การยิง API จริงอยู่ใน test/api.test.js และ test/system.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'login.html'), 'utf8');
const app = fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'css', 'style.css'), 'utf8');

test('หน้า login เป็น split panel: ฝั่งแนะนำ + การ์ดฟอร์ม', function () {
  assert.match(html, /class="container auth-page"/);
  assert.match(html, /class="auth-hero"/);
  assert.match(html, /id="auth-card"/);
  assert.match(html, /class="auth-hero-title"/);
});

test('มี stepper 3 ขั้น (อีเมล → ยืนยัน → บัญชี) และซ่อนขั้นที่ 3 ไว้ก่อน', function () {
  assert.match(html, /id="auth-steps"/);
  assert.match(html, /data-step="1"/);
  assert.match(html, /data-step="2"/);
  assert.match(html, /data-step="3" hidden/);
  assert.match(app, /function paintSteps\(mode\)/);
  assert.match(app, /li\.hidden = step === 3 && !third/);
});

test('มี 4 pane: email, otp, password, signup — และตัวควบคุมสลับ pane', function () {
  ['email', 'otp', 'password', 'signup'].forEach(function (pane) {
    assert.ok(html.indexOf('data-pane="' + pane + '"') !== -1, 'ไม่พบ pane ' + pane);
  });
  assert.match(app, /function showPane\(mode\)/);
  assert.match(app, /pane\.hidden = pane\.getAttribute\('data-pane'\) !== mode/);
});

test('OTP เป็นช่อง 6 หลัก พร้อมเลื่อนโฟกัสและวางรหัสทั้งชุดได้', function () {
  const boxes = html.match(/class="otp-box"/g) || [];
  assert.strictEqual(boxes.length, 6, 'ต้องมีช่อง OTP 6 ช่อง');
  assert.match(html, /id="otp-boxes"/);
  assert.match(app, /otpBoxes\[index \+ 1\]\.focus\(\)/);
  assert.match(app, /addEventListener\('paste'/);
  assert.match(app, /function syncOtp\(\)/);
  assert.match(app, /disabled = value\.length !== 6/);
});

test('ลืมรหัสผ่านตั้งรหัสใหม่ได้จริง: ขอ OTP → ยืนยัน → ตั้งรหัสผ่านใหม่', function () {
  assert.match(html, /id="pw-forgot"/);
  assert.match(html, /id="to-reset"/);
  assert.match(html, /data-pane="reset"/);
  assert.match(html, /id="reset-form"/);
  assert.match(html, /id="rs-pass"/);
  assert.match(html, /id="rs-pass2"/);
  assert.match(html, /id="reset-email"/);
  assert.match(app, /purpose: 'reset'/);
  assert.match(app, /state\.resetToken = data\.resetToken/);
  assert.match(app, /\/auth\/password\/reset/);
  assert.match(app, /showPane\('reset'\)/);
});

test('สเต็ปที่ 3 เปลี่ยนป้ายตามงาน: สมัครสมาชิก = บัญชี, ลืมรหัสผ่าน = รหัสใหม่', function () {
  assert.match(html, /data-step="3" hidden><span aria-hidden="true">3<\/span><b class="auth-step-text">บัญชี<\/b>/);
  assert.match(app, /state\.intent === 'reset' \? 'รหัสใหม่' : 'บัญชี'/);
});

test('การสมัครสมาชิกอยู่ใน stepper เดิม: ขอ OTP ก่อน แล้วค่อยสร้างบัญชีด้วย signupToken', function () {
  assert.match(app, /payload\.purpose = 'signup'/);
  assert.match(app, /purpose: state\.intent/);
  assert.match(app, /state\.signupToken = data\.signupToken/);
  assert.match(app, /signupToken: state\.signupToken/);
  assert.match(app, /\/auth\/register/);
});

test('ตัวควบคุมไม่ผูกกับมาร์กอัปเก่า (แท็บ auth-tabs / ฟอร์มเดิม)', function () {
  assert.strictEqual(app.indexOf("'auth-tabs'"), -1);
  assert.strictEqual(app.indexOf("'login-form'"), -1);
  assert.strictEqual(app.indexOf("'otp-code'"), -1);
  assert.strictEqual(app.indexOf("'reg-code'"), -1);
});

test('สไตล์ auth ครบ: split panel, stepper, ช่อง OTP, ลิงก์รอง และปรับจอเล็ก', function () {
  assert.match(css, /\.auth-page \{[^}]*grid-template-columns: 1\.05fr 0\.95fr/);
  assert.match(css, /\.auth-step\.is-current/);
  assert.match(css, /\.otp-boxes \{ display: grid; grid-template-columns: repeat\(6, 1fr\)/);
  assert.match(css, /\.link-btn \{/);
  assert.match(css, /\.field-error \{/);
  assert.match(css, /@media \(max-width: 900px\) \{\s*\.auth-page \{\s*grid-template-columns: 1fr/);
});

test('ทุกช่องกรอกมี label และช่องรหัสผ่านมีปุ่มสลับแสดง/ซ่อน', function () {
  ['auth-email', 'pw-email', 'pw-pass', 'sg-pass', 'sg-pass2', 'sg-age'].forEach(function (id) {
    assert.ok(html.indexOf('id="' + id + '"') !== -1, 'ไม่พบช่อง ' + id);
  });
  assert.match(html, /id="pw-toggle"/);
  assert.match(html, /id="sg-toggle"/);
  assert.match(app, /function wireToggle\(buttonId, inputId\)/);
});

test('หน้า login ยังโหลดสคริปต์ครบและไม่เรียกใช้คลาสที่ไม่มีใน CSS', function () {
  assert.match(html, /js\/data\.js/);
  assert.match(html, /js\/api\.js/);
  assert.match(html, /js\/app\.js/);
  ['auth-card', 'auth-steps', 'auth-pane', 'otp-boxes', 'link-btn'].forEach(function (cls) {
    assert.ok(css.indexOf('.' + cls) !== -1, 'ไม่พบสไตล์ .' + cls);
  });
});
