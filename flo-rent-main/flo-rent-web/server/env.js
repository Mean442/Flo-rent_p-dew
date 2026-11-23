'use strict';

/*
 * โหลดค่าจากไฟล์ .env ที่รากโปรเจกต์ (ถ้ามี) — ไม่ใช้ dependency ภายนอก
 * ตัวแปรที่มีอยู่ใน environment จริงแล้วจะไม่ถูกเขียนทับ
 * - ข้ามการอ่านไฟล์เมื่อ NODE_ENV=test เพื่อให้ชุดทดสอบไม่ส่งอีเมลจริง
 * - บน Vercel ไม่มีไฟล์นี้ ระบบจะใช้ Environment Variables ของโปรเจกต์แทน
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '.env');

if (process.env.NODE_ENV !== 'test' && fs.existsSync(FILE)) {
  fs.readFileSync(FILE, 'utf8').split(/\r?\n/).forEach(function (line) {
    const text = line.trim();
    if (!text || text.charAt(0) === '#') return;
    const eq = text.indexOf('=');
    if (eq < 1) return;
    const key = text.slice(0, eq).trim();
    let value = text.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    const quote = value.charAt(0);
    if ((quote === '"' || quote === "'") && value.charAt(value.length - 1) === quote) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  });
}
