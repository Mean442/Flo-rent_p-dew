'use strict';

/*
 * ส่งอีเมล OTP — เรียก HTTPS API ของผู้ให้บริการโดยตรง ไม่ต้องติดตั้ง dependency
 *
 * เลือกผู้ให้บริการอัตโนมัติจาก env (ตั้งตัวใดตัวหนึ่ง):
 *   RESEND_API_KEY   → Resend (https://resend.com)
 *   BREVO_API_KEY    → Brevo  (https://brevo.com) — ต้องตั้ง FLO_MAIL_FROM เป็นผู้ส่งที่ยืนยันแล้ว
 *
 * ตัวแปรเสริม:
 *   FLO_MAIL_FROM       ผู้ส่ง เช่น "FLO-RENT <no-reply@yourdomain.com>"
 *                       (ถ้าไม่ตั้งและใช้ Resend จะใช้ onboarding@resend.dev ซึ่งส่งได้เฉพาะอีเมลของเจ้าของบัญชี)
 *   FLO_MAIL_FROM_NAME  ชื่อผู้ส่ง (ค่าเริ่มต้น FLO-RENT)
 *
 * ถ้ายังไม่ตั้งผู้ให้บริการ: โหมดพัฒนา (NODE_ENV !== 'production') จะพิมพ์รหัสลงคอนโซล
 * และคืน devCode ให้นำไปกรอกได้ ส่วน production จะปฏิเสธคำขอ (503) ไม่ส่งรหัสใด ๆ
 */

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const BREVO_KEY = process.env.BREVO_API_KEY || '';
const FROM = String(process.env.FLO_MAIL_FROM || '').trim();
const FROM_NAME = String(process.env.FLO_MAIL_FROM_NAME || 'FLO-RENT').trim();
const TIMEOUT_MS = 10000;

function provider() {
  if (RESEND_KEY) return 'resend';
  if (BREVO_KEY) return 'brevo';
  return '';
}

function isConfigured() {
  return !!provider();
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function mailError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

/* แยก "ชื่อ <อีเมล>" เป็น { name, email } */
function parseFrom(raw, fallbackName) {
  const text = String(raw || '').trim();
  if (!text) return { name: fallbackName, email: '' };
  const match = /^(.*?)<([^>]+)>$/.exec(text);
  if (match) return { name: (match[1] || fallbackName).trim() || fallbackName, email: match[2].trim() };
  return { name: fallbackName, email: text };
}

function fromAddress() {
  if (FROM) return FROM;
  if (provider() === 'brevo') return '';
  return FROM_NAME + ' <onboarding@resend.dev>';
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function otpText(name, code, ttlMinutes) {
  return [
    'FLO-RENT — รหัสยืนยันการเข้าสู่ระบบ',
    '',
    'สวัสดี ' + name + ',',
    'รหัส OTP ของคุณคือ: ' + code,
    'รหัสนี้ใช้ได้ภายใน ' + ttlMinutes + ' นาที และใช้ได้ครั้งเดียว',
    '',
    'ถ้าคุณไม่ได้ขอล็อกอิน ไม่ต้องทำอะไร — รหัสจะหมดอายุเอง',
    'ทีมงาน FLO-RENT จะไม่มีวันขอรหัสนี้จากคุณ'
  ].join('\n');
}

function otpHtml(name, code, ttlMinutes) {
  return '' +
    '<div style="background:#f6f3ea;padding:28px 16px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#2f2c26">' +
      '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:18px;padding:28px;border:1px solid #e3ddcc">' +
        '<p style="margin:0 0 6px;font-size:13px;letter-spacing:2px;color:#8a2318;font-weight:700">FLO-RENT</p>' +
        '<h1 style="margin:0 0 10px;font-size:22px">รหัสยืนยันการเข้าสู่ระบบ</h1>' +
        '<p style="margin:0 0 18px;color:#5d5a51">สวัสดี ' + escapeHtml(name) + ' · ใช้รหัสด้านล่างเพื่อเข้าสู่ระบบ</p>' +
        '<div style="font-size:34px;letter-spacing:10px;font-weight:800;text-align:center;background:#f6f3ea;border-radius:14px;padding:16px 8px;color:#2f2c26">' + escapeHtml(code) + '</div>' +
        '<p style="margin:18px 0 0;color:#5d5a51;font-size:14px">รหัสนี้ใช้ได้ภายใน ' + ttlMinutes + ' นาที และใช้ได้ครั้งเดียว</p>' +
        '<p style="margin:14px 0 0;color:#8a8172;font-size:12px">ถ้าคุณไม่ได้ขอล็อกอิน ไม่ต้องทำอะไร — รหัสจะหมดอายุเอง ทีมงานจะไม่มีวันขอรหัสนี้จากคุณ</p>' +
      '</div>' +
    '</div>';
}

async function postJson(url, headers, body, label) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.text()).slice(0, 300); } catch (err) { detail = ''; }
      console.error('[mail] ' + label + ' ตอบ ' + response.status + ': ' + detail);
      /* Resend ที่ยังไม่ยืนยันโดเมนส่งได้เฉพาะอีเมลเจ้าของบัญชี — บอกสาเหตุให้ตรง */
      if (response.status === 403 && /verify a domain/i.test(detail)) {
        throw mailError(502, 'ส่งอีเมลถึงที่อยู่นี้ไม่ได้: บัญชีอีเมลยังไม่ได้ยืนยันโดเมน (ส่งได้เฉพาะอีเมลเจ้าของบัญชี Resend) — กรุณายืนยันโดเมนที่ resend.com/domains');
      }
      throw mailError(502, 'ส่งอีเมลไม่สำเร็จ (' + label + ' ' + response.status + ') — กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ');
    }
    return true;
  } catch (err) {
    if (err && err.status) throw err;
    console.error('[mail] ' + label + ' ผิดพลาด:', err && err.message);
    throw mailError(502, 'เชื่อมต่อผู้ให้บริการอีเมลไม่ได้ — กรุณาลองใหม่ภายหลัง');
  } finally {
    clearTimeout(timer);
  }
}

async function sendResend(options) {
  const from = parseFrom(fromAddress(), FROM_NAME);
  return postJson('https://api.resend.com/emails', {
    Authorization: 'Bearer ' + RESEND_KEY
  }, {
    from: from.name + ' <' + from.email + '>',
    to: [options.email],
    subject: options.subject,
    text: options.text,
    html: options.html
  }, 'resend');
}

async function sendBrevo(options) {
  const from = parseFrom(FROM, FROM_NAME);
  if (!from.email) {
    throw mailError(503, 'ยังไม่ได้ตั้งค่า FLO_MAIL_FROM — Brevo ต้องใช้ผู้ส่งที่ยืนยันแล้ว');
  }
  return postJson('https://api.brevo.com/v3/smtp/email', {
    'api-key': BREVO_KEY
  }, {
    sender: { name: from.name, email: from.email },
    to: [{ email: options.email }],
    subject: options.subject,
    textContent: options.text,
    htmlContent: options.html
  }, 'brevo');
}

/*
 * คืน { delivered, devCode? }
 * - delivered: true  → ผู้ให้บริการรับอีเมลแล้ว
 * - devCode: มีค่าเฉพาะโหมดพัฒนาที่ยังไม่ตั้งค่าผู้ให้บริการ (ให้หน้าเว็บแสดงรหัสได้)
 */
async function sendOtp(options) {
  const ttlMinutes = options.ttlMinutes || 10;
  const subject = 'FLO-RENT: รหัส OTP ของคุณ ' + options.code;
  const text = otpText(options.name || options.email, options.code, ttlMinutes);
  const html = otpHtml(options.name || options.email, options.code, ttlMinutes);

  if (!provider()) {
    if (isProduction()) {
      throw mailError(503, 'ระบบส่งอีเมล OTP ยังไม่ถูกตั้งค่า — ตั้ง RESEND_API_KEY หรือ BREVO_API_KEY');
    }
    console.log('[mail] (โหมดพัฒนา ไม่ได้ส่งอีเมลจริง) OTP สำหรับ ' + options.email + ' = ' + options.code +
      ' · ใช้ได้ ' + ttlMinutes + ' นาที');
    return { delivered: false, devCode: options.code };
  }

  const payload = { email: options.email, subject: subject, text: text, html: html };
  if (provider() === 'brevo') await sendBrevo(payload);
  else await sendResend(payload);

  console.log('[mail] ส่ง OTP ถึง ' + options.email + ' ผ่าน ' + provider());
  return { delivered: true };
}

module.exports = { provider, isConfigured, fromAddress, sendOtp };
