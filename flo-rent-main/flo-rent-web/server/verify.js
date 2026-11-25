'use strict';

/*
 * การยืนยันตัวตนด้วยบัตรประชาชน
 * - ไม่เก็บเลขบัตรเต็ม: เก็บ SHA-256 (พร้อม salt) ไว้กันใช้ซ้ำ + เก็บ 4 ตัวท้ายไว้แสดง
 * - รูปบัตรเข้ารหัส AES-256-GCM และเก็บแยกจากฐานข้อมูลหลัก (Redis key แยก / ไฟล์แยก)
 *   พร้อมกำหนดอายุ 30 วันหลังตรวจตามนโยบายความเป็นส่วนตัว
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = require('./db');

const DAY = 86400000;
const PHOTO_TTL_DAYS = 30;
const MAX_PHOTO_BYTES = 1200 * 1024;

const SALT = process.env.FLO_ID_SALT || 'flo-rent-id-salt-v1';
const KEY = crypto.createHash('sha256')
  .update('flo-rent-id|' + (process.env.FLO_ID_ENCRYPTION_KEY || SALT))
  .digest();

const PHOTO_DIR = path.join(db.DATA_DIR, 'id-docs');

function normalizeId(value) {
  return String(value == null ? '' : value).replace(/[^0-9]/g, '');
}

/* เลขบัตรประชาชนไทย 13 หลัก: 12 หลักแรกเป็นข้อมูล หลักที่ 13 คือ check digit (mod 11) */
function isValidThaiId(value) {
  const id = normalizeId(value);
  if (id.length !== 13) return false;
  if (/^(\d)\1{12}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(id.charAt(i)) * (13 - i);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(id.charAt(12));
}

function hashId(value) {
  return crypto.createHash('sha256').update(SALT + '|' + normalizeId(value)).digest('hex');
}

function maskId(value) {
  const id = normalizeId(value);
  return '•••••••••' + id.slice(-4);
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const body = Buffer.concat([cipher.update(input), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

function decrypt(payload) {
  const raw = Buffer.from(String(payload == null ? '' : payload), 'base64');
  if (raw.length < 29) throw new Error('ข้อมูลที่เข้ารหัสไม่ถูกต้อง');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function photoKey(userId) { return 'florent:idphoto:' + userId; }
function photoFile(userId) { return path.join(PHOTO_DIR, userId + '.txt'); }

/* เก็บรูปบัตร (data URL) แบบเข้ารหัส — ไม่ปนกับฐานข้อมูลหลัก */
async function savePhoto(userId, dataUrl) {
  const encoded = encrypt(String(dataUrl));
  if (db.IS_REMOTE) {
    await db.command(['SET', photoKey(userId), encoded, 'EX', String(PHOTO_TTL_DAYS * 86400)]);
  } else {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    fs.writeFileSync(photoFile(userId), encoded, 'utf8');
  }
  return { expiresAt: new Date(Date.now() + PHOTO_TTL_DAYS * DAY).toISOString() };
}

async function readPhoto(userId) {
  let encoded = '';
  if (db.IS_REMOTE) {
    encoded = await db.command(['GET', photoKey(userId)]);
  } else {
    try { encoded = fs.readFileSync(photoFile(userId), 'utf8'); } catch (err) { encoded = ''; }
  }
  if (!encoded) return null;
  return decrypt(encoded).toString('utf8');
}

async function removePhoto(userId) {
  if (db.IS_REMOTE) {
    await db.command(['DEL', photoKey(userId)]);
  } else {
    try { fs.unlinkSync(photoFile(userId)); } catch (err) { /* ไม่มีไฟล์ก็ไม่เป็นไร */ }
  }
}

module.exports = {
  DAY,
  PHOTO_TTL_DAYS,
  MAX_PHOTO_BYTES,
  normalizeId,
  isValidThaiId,
  hashId,
  maskId,
  encrypt,
  decrypt,
  savePhoto,
  readPhoto,
  removePhoto
};
