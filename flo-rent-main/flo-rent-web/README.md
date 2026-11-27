<div align="center">

# FLO-RENT

### ตลาดกลางสำหรับให้เช่าและเช่าสินค้า

หน้าเว็บ static + เซิร์ฟเวอร์ Node.js ที่ไม่ต้องติดตั้ง dependency ใด ๆ เข้าสู่ระบบด้วย OTP ทางอีเมล ยืนยันตัวตนด้วยบัตรประชาชน จองและคืนของ กระเป๋าเงิน และหน้าแอดมินอยู่ในระบบเดียว

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![Hosting](https://img.shields.io/badge/deploy-Vercel-black?logo=vercel&logoColor=white)

[เว็บไซต์จริง](https://flo-rentp-dew-flo-rent-web-1.vercel.app) · [คู่มือ tech stack (PDF)](docs/FLO-RENT-techstack.pdf) · [วิธีรันในเครื่อง](#เริ่มต้นใช้งาน)

</div>

---

## ภาพรวมโปรเจกต์

FLO-RENT เป็นตลาดกลางให้คนปล่อยสินค้าที่ไม่ได้ใช้ให้คนอื่นเช่า ตั้งแต่กล้อง แล็ปท็อป ไปจนถึงอุปกรณ์แคมป์ปิ้ง ผู้ใช้ลงประกาศ ตั้งราคาต่อวัน รับคำขอจอง และติดตามสถานะการคืนของได้ในที่เดียว

ไอเดียเริ่มจากคำถามง่าย ๆ ว่า ของที่วางทิ้งไว้ในห้อง เช่น กล้องตัวเก่า เต็นท์ที่ใช้ปีละครั้ง หรือแล็ปท็อปสำรอง ทำไมถึงยังไม่มีที่ให้ปล่อยเช่าได้ง่าย ๆ แบบที่หยิบของขึ้นมาถ่ายรูปแล้วตั้งราคาได้ในไม่กี่นาที ผมเลยลองสร้างตลาดกลางที่จัดการทั้งวงจรให้ ตั้งแต่ลงประกาศ ค้นหา จอง จ่ายมัดจำ ไปจนถึงการคืนของ

งานในโปรเจกต์นี้ผมทำตั้งแต่ต้นจนจบ: ออกแบบ UX/UI, เขียน frontend และ backend, ออกแบบโมเดลข้อมูล, วางระบบยืนยันตัวตน, เขียนชุดทดสอบ และ deploy ขึ้น production

โจทย์ที่อยากแก้มีอยู่สี่ข้อ: คนไม่อยากจำรหัสผ่าน, กลัวโดนโกงหรือของหาย, ไม่รู้ว่าจะเชื่อใครได้ และการจองที่หลุดการติดตามง่ายเกินไป สิ่งที่ออกมาจึงเป็น OTP ทางอีเมลแทนรหัสผ่าน, การยืนยันตัวตนด้วยบัตรประชาชนก่อนทำธุรกรรม, มัดจำต่อรายการ และสถานะการจองที่เดินครบวงจรตั้งแต่ขอยืนยันไปจนถึงคืนของ

---

## ฟีเจอร์เด่น

**สำหรับผู้เช่า**
- ค้นหาและกรองสินค้าตามหมวดหมู่ ช่วงราคา และช่วงวันที่ว่าง
- หน้าสินค้าที่คำนวณค่าเช่า + มัดจำตามจำนวนวันให้ทันที พร้อมปฏิทินวันว่าง
- จองและติดตามสถานะได้จากหน้าประวัติการจอง, ยกเลิกได้ก่อนผู้ให้เช่ายืนยัน
- กระเป๋าเงิน FLO-RENT สำหรับมัดจำและค่าเช่า

**สำหรับผู้ให้เช่า**
- ลงประกาศพร้อมรูปหลายรูป หมวดหมู่ ราคา/วัน และมัดจำ
- กล่อง "คำขอจองที่เข้ามา" — ยืนยัน ปฏิเสธ หรือกดรับคืนของได้จากหน้าโปรไฟล์
- ประกาศความต้องการเช่า (LOOK FOR) และรับข้อเสนอจากผู้ให้เช่าหลายราย
- ประกาศงาน/รับงาน (WORK) สำหรับงานที่ต้องใช้คน

**สำหรับผู้ดูแลระบบ**
- แดชบอร์ดสถิติ, จัดการผู้ใช้/ประกาศ/การจอง/คำขอ
- อนุมัติหรือปฏิเสธการยืนยันตัวตน พร้อมดูรูปบัตร (ทุกการเปิดดูถูกบันทึกในล็อก)
- จัดการหมวดหมู่ กระเป๋าเงิน และดูบันทึกเหตุการณ์ของระบบ

**หน้า login (split panel + stepper)**
- เดสก์ท็อปแบ่งสองฝั่ง ฝั่งซ้ายเล่าแบรนด์ ฝั่งขวาเป็นการ์ดฟอร์ม
- ฟอร์มเดียวเดินเป็นขั้น อีเมล → ยืนยัน OTP → เข้าใช้งาน พร้อมแถบความคืบหน้า
- OTP เป็นช่อง 6 ช่อง กรอกต่อเนื่อง วางรหัสทั้งชุดได้ และลบย้อนกลับทีละช่อง
- รหัสผ่านเป็นทางเลือกรอง ผู้ดูแลระบบเข้าได้ทันที ส่วนการสมัครสมาชิกต่อในสเต็ปเปอร์เดิม
- ปุ่มลืมรหัสผ่านพาไปยืนยัน OTP แล้วตั้งรหัสผ่านใหม่ในสเต็ปเปอร์เดียวกัน

---

## Tech Stack

| ชั้น | เทคโนโลยี | เหตุผลที่เลือก |
| --- | --- | --- |
| Frontend | HTML5, CSS3 (custom properties, grid/flex, `clamp()`), JavaScript ES5-safe แบบ vanilla | ไม่มี build step — เปิดอ่านโค้ดได้ตรง ๆ และ deploy ได้ทันที |
| Backend | Node.js `http` module ล้วน (ไม่มี Express) | ควบคุมทุก byte ของ response, cold start เร็ว, ไม่มี dependency ให้ตามแพตช์ |
| Data (local) | JSON file + atomic write (temp → rename) | รันในเครื่องได้โดยไม่ต้องติดตั้งฐานข้อมูล |
| Data (production) | Upstash Redis ผ่าน REST + Lua CAS | หลาย serverless instance เขียนพร้อมกันได้โดยข้อมูลไม่สูญหาย |
| Auth | OTP ทางอีเมล (HMAC-SHA256), scrypt สำหรับรหัสผ่าน, bearer session token | ไม่เก็บรหัส OTP จริง และไม่เก็บรหัสผ่านแบบย้อนกลับได้ |
| Identity | SHA-256 + salt (เลขบัตร), AES-256-GCM (รูปบัตร) | ตรวจเลขซ้ำได้โดยไม่ต้องเก็บเลขจริง |
| Email | Brevo / Resend ผ่าน HTTPS `fetch` | ไม่ต้องใช้ SDK และสลับผู้ให้บริการได้ด้วย env ตัวเดียว |
| Hosting | Vercel — static `public/` + serverless function `api/index.js` | ฟรี, ผูกกับ Git, preview ต่อ PR |
| Testing | `node:test` + `node:assert` | มาพร้อม Node ไม่ต้องเพิ่ม dev dependency |

**สถาปัตยกรรมโดยสรุป**

```
เบราว์เซอร์
   │  HTML/CSS/JS (public/)           ← เสิร์ฟเป็น static
   │  fetch('/api/...')
   ▼
api/index.js  (Vercel serverless)
   │  แปลง request → เลือก handler เดียวกับ server/server.js
   │  buffer response + CAS retry 8 ครั้ง + คิวต่อ instance
   ▼
server/db.js
   ├─ โหมด local  → JSON file (atomic write)
   └─ โหมด Redis  → Upstash REST + Lua compare-and-swap
```

จุดที่ตั้งใจออกแบบ: **ตรรกะทั้งหมดอยู่ใน `server/server.js` ที่เดียว** ทั้งโหมด `npm start` และโหมด serverless เรียกใช้ handler ชุดเดียวกัน จึงไม่มีปัญหา "พอร์ตแล้วพฤติกรรมเพี้ยน"

---

## เส้นทางหลักของระบบ

**เข้าสู่ระบบ (OTP)**
1. กรอกอีเมล → `POST /api/auth/otp/request` สร้างรหัส 6 หลัก อายุ 10 นาที ส่งทางอีเมล
2. กรอกรหัส → `POST /api/auth/otp/verify` ตรวจแล้วออก session token
3. รหัสใช้ได้ครั้งเดียว กรอกผิดได้ 5 ครั้ง ขอใหม่ได้หลัง 60 วินาที (ไม่เกิน 5 ครั้ง/ชั่วโมง/อีเมล)

**สมัครสมาชิก**
1. กรอกชื่อ + อีเมล → ขอรหัส OTP แบบ `purpose: signup` (ยังไม่สร้างบัญชี)
2. ยืนยันรหัส → ได้ `signupToken` อายุ 15 นาที ใช้ครั้งเดียว
3. ตั้งรหัสผ่าน/อายุ/เบอร์โทร → `POST /api/auth/register` สร้างบัญชีและเข้าสู่ระบบทันที

**ลืมรหัสผ่าน**
1. กรอกอีเมล (หรือกดจากหน้าใช้รหัสผ่าน) → ขอรหัส OTP แบบ `purpose: reset`
2. ยืนยันรหัส → ได้ `resetToken` อายุ 15 นาที ใช้ครั้งเดียว และแยกจาก `signupToken`
3. ตั้งรหัสผ่านใหม่ → `POST /api/auth/password/reset` เปลี่ยนรหัส ตัด session เดิมทั้งหมด แล้วเข้าสู่ระบบให้ทันที

**จองและคืนของ**
`POST /api/bookings` → ผู้ให้เช่ายืนยัน → สถานะ `active` → ผู้เช่าแจ้งคืน → ผู้ให้เช่ากดรับคืน → คืนมัดจำ ระบบกันการจองซ้อนด้วยการตรวจช่วงวันที่ว่าง

---

## โครงสร้างโปรเจกต์

```
flo-rent-web/
├── api/
│   └── index.js            # entrypoint ของ Vercel — buffer + CAS retry
├── server/
│   ├── server.js           # route ทั้งหมด + ธุรกิจหลัก
│   ├── auth.js             # scrypt, session token
│   ├── db.js               # JSON atomic write / Redis REST + Lua CAS
│   ├── mailer.js           # Brevo, Resend, โหมด devCode
│   ├── env.js              # ตัวอ่าน .env ขนาดเล็ก
│   └── verify.js           # checksum เลขบัตรประชาชน
├── public/
│   ├── index.html  browse.html  item.html  post.html  look-for.html
│   ├── work.html   jobs.html    bookings.html  wallet.html  profile.html
│   ├── login.html  admin.html
│   ├── css/style.css       # ดีไซน์ทั้งเว็บ (design tokens + responsive)
│   └── js/
│       ├── app.js          # ตัวควบคุมทุกหน้า
│       ├── api.js          # fetch wrapper + token
│       └── data.js         # หมวดหมู่/ค่าคงที่ฝั่ง client
├── test/                   # api · system · verify · ui · login
├── docs/FLO-RENT-techstack.pdf
├── vercel.json
└── package.json
```

---

## เริ่มต้นใช้งาน

ต้องมี **Node.js 18 ขึ้นไป** (ทดสอบบน v22) — ไม่ต้อง `npm install`

```bash
git clone https://github.com/Mean442/Flo-rent_p-dew.git
cd Flo-rent_p-dew/flo-rent-main/flo-rent-web
npm start
```

เปิด **http://127.0.0.1:4173**

> เปิด `index.html` ด้วยการดับเบิลคลิกไม่ได้ เพราะหน้าเว็บต้องเรียก API — ถ้าเปิดแบบ `file://` จะมีข้อความบอกวิธีรันเซิร์ฟเวอร์ขึ้นมาแทน

เปลี่ยนพอร์ต/โฮสต์:

```bash
PORT=8080 HOST=127.0.0.1 npm start
```

### บัญชีทดลอง (โหมดเดโมเท่านั้น)

สร้างให้อัตโนมัติเมื่อ **ไม่ได้** รันด้วย `NODE_ENV=production`

| บทบาท | อีเมล | รหัสผ่าน |
| --- | --- | --- |
| ผู้ใช้ | `demo@flo-rent.co` | `demo1234` |
| ผู้ให้เช่า | `owner@flo-rent.co` | `owner1234` |
| ผู้ดูแลระบบ | `admin@flo-rent.co` | `admin1234` |

บัญชีผู้ใช้/ผู้ให้เช่าเป็นบัญชีทั่วไป — ล็อกอินด้วยรหัสผ่านแล้วต้องยืนยัน OTP ต่อ (โหมดเดโมที่ยังไม่ตั้งค่าอีเมลจะแสดงรหัสบนหน้าเว็บให้กรอก) ส่วนแอดมินเข้าได้ด้วยรหัสผ่านทันที

---

## Environment Variables

คัดลอก `.env.example` เป็น `.env` ที่รากโปรเจกต์ แล้วเติมค่า — `server/env.js` โหลดให้เอง (`.env*` ถูก gitignore ไว้แล้ว)

| ตัวแปร | ความหมาย |
| --- | --- |
| `NODE_ENV` | `production` = ไม่สร้างบัญชีทดลอง/ข้อมูลตัวอย่าง และบล็อกอีเมลทดลองทั้งสามแบบ |
| `PORT` / `HOST` | พอร์ตและโฮสต์ในเครื่อง (ค่าเริ่มต้น `4173` / `127.0.0.1`) |
| `FLO_ADMIN_EMAIL` | อีเมลแอดมิน (ต้องตั้งคู่กับรหัสผ่าน) |
| `FLO_ADMIN_PASSWORD` | รหัสผ่านแอดมิน ยาวอย่างน้อย 10 ตัวอักษร |
| `FLO_ADMIN_NAME` | ชื่อที่แสดงของแอดมิน (ไม่บังคับ) |
| `BREVO_API_KEY` | คีย์ Brevo — ผู้ให้บริการอีเมล OTP |
| `RESEND_API_KEY` | คีย์ Resend — ถ้าตั้งพร้อม Brevo ระบบจะเลือก Resend ก่อน |
| `FLO_MAIL_FROM` | ผู้ส่ง เช่น `FLO-RENT <you@gmail.com>` |
| `FLO_MAIL_FROM_NAME` | ชื่อผู้ส่ง (ค่าเริ่มต้น `FLO-RENT`) |
| `FLO_ALLOWED_ORIGINS` | โดเมนที่อนุญาตให้เรียก API ที่เขียนข้อมูล คั่นด้วยจุลภาค |
| `FLO_RATE_LIMIT_PER_MIN` | เพดานคำขอต่อนาทีต่อ IP (ค่าเริ่มต้น 20) |
| `FLO_DATA_DIR` | โฟลเดอร์เก็บ `db.json` |
| `FLO_SEED_CATALOG` | แคตตาล็อกตั้งต้น 16 รายการ (บน Vercel เปิดอัตโนมัติ, `=0` เพื่อปิด) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash/KV REST — เปิดโหมดเก็บข้อมูลบน Redis |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | ทางเลือกแทนสองตัวข้างบน |
| `FLO_DB_KEY` | ชื่อ key ใน Redis (ค่าเริ่มต้น `florent:db`; Preview ใช้ `florent:preview:db`) |
| `FLO_ID_SALT` | salt สำหรับ hash เลขบัตรประชาชน |
| `FLO_ID_ENCRYPTION_KEY` | คีย์เข้ารหัสรูปบัตร (AES-256-GCM) |
| `FLO_OTP_SECRET` | secret สำหรับ HMAC ของรหัส OTP |
| `FLO_DEMO_AUTO_VERIFY` | โหมดเดโม: ให้บัญชีใหม่ผ่านการยืนยันอัตโนมัติ (`=0` เพื่อทดสอบเส้นทางรออนุมัติ) |

---

## API โดยย่อ

| กลุ่ม | Endpoint |
| --- | --- |
| ระบบ | `GET /api/health`, `GET /api/categories` |
| บัญชี | `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/otp/request` · `POST /api/auth/otp/verify` · `POST /api/auth/password/reset` · `POST /api/auth/logout` · `GET/PATCH /api/me` |
| สินค้า | `GET /api/items` · `GET /api/items/:id` · `POST /api/items` |
| การจอง | `GET/POST /api/bookings` · `GET /api/owner/bookings` · `GET/POST /api/requests` |
| งาน | `GET /api/work-categories` · `GET /api/workers` · `GET/POST /api/jobs` · `GET/POST /api/hires` |
| กระเป๋าเงิน | `GET /api/wallet` · `POST /api/wallet/topup` |
| ยืนยันตัวตน | `GET/POST /api/verification` |
| แอดมิน | `GET /api/admin/stats` · `/users` · `/items` · `/bookings` · `/requests` · `/logs` · `/categories` · `/wallet` · `/verifications` |

ทุก endpoint ที่เขียนข้อมูลตรวจ token และ Origin ก่อนทำงาน — ดูรายละเอียดทั้งหมดใน `server/server.js`

---

## ความปลอดภัย

- **OTP** เก็บเป็น HMAC-SHA256 ไม่เก็บรหัสจริง, ใช้ครั้งเดียว, อายุ 10 นาที, ผิดได้ 5 ครั้ง, ขอใหม่ได้หลัง 60 วินาที
- **รหัสผ่าน** hash ด้วย `scrypt` + salt ต่อผู้ใช้
- **เลขบัตรประชาชน** เก็บเป็น SHA-256 + salt เพื่อกันใช้ซ้ำ และเก็บเฉพาะ 4 ตัวท้ายไว้แสดง
- **รูปบัตร** เข้ารหัส AES-256-GCM, หมดอายุ 30 วัน, เปิดดูทุกครั้งถูกบันทึกในล็อกระบบ
- **ลืมรหัสผ่าน** ต้องยืนยัน OTP ก่อนเสมอ, `resetToken` ใช้ครั้งเดียว หมดอายุ 15 นาที และเปลี่ยนรหัสแล้ว session เดิมทั้งหมดถูกตัด
- **Session** เป็น bearer token ที่เพิกถอนได้ทันทีเมื่อ logout
- **Rate limit** ต่อ IP และตรวจ `Origin` สำหรับคำขอที่เขียนข้อมูล
- ข้อจำกัดที่รู้อยู่: rate limit เก็บใน memory (รีเซ็ตเมื่อ instance ใหม่), ยังไม่มี CSP และยังไม่มี E2E test

---

## การทดสอบ

```bash
npm test
```

รันด้วย `node:test` ทั้งหมด **68 เคส** ใน 5 ไฟล์

| ไฟล์ | ครอบคลุม |
| --- | --- |
| `test/api.test.js` | เส้นทาง API หลัก: สมัคร, OTP, จอง, กระเป๋าเงิน, สิทธิ์แอดมิน |
| `test/system.test.js` | สถานะการจองทั้งวงจร, การกันจองซ้อน, การคืนมัดจำ |
| `test/verify.test.js` | checksum เลขบัตร, การเข้ารหัสรูป, การหมดอายุ |
| `test/ui.test.js` | มาร์กอัป/สไตล์ที่ต้องมีของ shell มือถือ, skeleton, sticky CTA |
| `test/login.test.js` | split panel, stepper 3 ขั้น, OTP 6 ช่อง, ทางลืมรหัสผ่าน |
| `test/api.test.js` (ต่อท้าย) | ลืมรหัสผ่านทั้งวงจร: OTP → resetToken → ตั้งรหัสใหม่ → ตัด session เดิม |

ชุดทดสอบตั้ง `NODE_ENV=test` จึงไม่ส่งอีเมลจริงออกไป

---

## Deploy บน Vercel

Vercel รันเซิร์ฟเวอร์ที่ `listen()` ค้างไว้ไม่ได้ และดิสก์เขียนถาวรไม่ได้ จึงแยกเป็น static (`public/`) + serverless (`api/index.js`) และเก็บข้อมูลใน Redis

1. Vercel → Settings → General → **Root Directory = `flo-rent-main/flo-rent-web`**
2. Storage → Marketplace → **Upstash for Redis** (ฟรี) → Connect to Project
3. ตั้ง env: `FLO_ADMIN_EMAIL`, `FLO_ADMIN_PASSWORD`, `BREVO_API_KEY`, `FLO_MAIL_FROM`, `FLO_ID_SALT`, `FLO_ID_ENCRYPTION_KEY`, `FLO_OTP_SECRET`
4. Push ขึ้น `main` → deploy อัตโนมัติ

**กับดักสองข้อที่เจอจริงตอน deploy**

- `FLO_ADMIN_EMAIL` **ห้ามใช้ `admin@flo-rent.co`** — ระบบบล็อกอีเมลทดลองบน production ก่อนตรวจรหัสผ่าน จะล็อกอินไม่ได้เลย
- โดเมนจริงสะกด **`flo-rentp-dew-...`** (ไม่มีขีดล่าง) ถ้าพิมพ์เป็น `flo-rent_p-dew-...` จะได้ `404 DEPLOYMENT_NOT_FOUND`

ตรวจหลังขึ้น production: `GET /api/health` → `{"demo":false,"mail":"brevo"}` และ `GET /api/items` → `total: 0`

---

## บันทึกผู้พัฒนา

สิ่งที่ผมจะทำต่างออกไปถ้าเริ่มใหม่:

- **ยังไม่มีฟอร์มเปลี่ยนรหัสผ่านในหน้าโปรไฟล์** ตอนนี้ต้องออกจากระบบแล้วใช้ทางลืมรหัสผ่าน ซึ่งไม่สะดวกสำหรับคนที่ยังจำรหัสเดิมได้
- **rate limit** เก็บใน memory ของแต่ละ instance บน serverless จึงไม่ใช่เพดานกลางจริง ๆ ถ้าจะกัน brute force จริงจังต้องย้ายไป Redis
- **ยังไม่มี CSP และยังไม่มี E2E test** ชุดทดสอบปัจจุบันยิง API จริงแต่ไม่ได้ขับเบราว์เซอร์
- **`server/server.js` ยาวสองพันกว่าบรรทัดแล้ว** ถึงเวลาต้องแยกเป็นโมดูลตามโดเมนก่อนที่มันจะโตไปมากกว่านี้

ส่วนที่คิดว่าทำได้ดีและอยากเก็บไว้คือการที่โหมด `npm start` กับ serverless ใช้ handler ชุดเดียวกัน ทำให้บั๊กที่เจอในเครื่อง reproduce บน production ได้ทันที และการเก็บ OTP เป็น hash แทนรหัสจริงตั้งแต่ต้น

## เอกสารเพิ่มเติม

- **[คู่มือ tech stack ฉบับเต็ม (PDF, 20 หน้า)](docs/FLO-RENT-techstack.pdf)** — อธิบายทุกชั้นของระบบตั้งแต่ HTTP request แรกจนถึง Redis CAS พร้อมตัวอย่างโค้ดจริง
- ความรู้ที่อยากต่อยอด: เพิ่ม CSP, ย้าย rate limit ไป Redis, เขียน E2E test ด้วย Playwright, แยก repository layer เพื่อรองรับ PostgreSQL

---

<div align="center">

**FLO-RENT — HMMM! & CO.**

สร้างด้วย Node.js ล้วน ๆ และความตั้งใจที่จะไม่เพิ่ม dependency ที่ไม่จำเป็น

</div>
