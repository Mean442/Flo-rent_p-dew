# FLO-RENT

เว็บไซต์เช่า / ยืมสินค้า (rental marketplace) จากเด็ค **FLO-RENT — HMMM! & CO.**
ประกอบด้วย frontend แบบ static + backend Node.js ที่ไม่ต้องติดตั้ง dependency ใด ๆ และหน้าแอดมินสำหรับดูแลระบบ

## สถานะปัจจุบัน

| รายการ | ค่า |
| --- | --- |
| เว็บที่ deploy แล้ว (production) | https://flo-rentp-dew-flo-rent-web-1.vercel.app |
| โปรเจกต์ Vercel | `means-projects-c35372c0/flo-rent_p-dew-flo-rent-web-1` |
| ที่อยู่ใน repo (ใช้เป็น Root Directory) | `flo-rent-main/flo-rent-web` |
| โหมด | production (`demo:false`), ผู้ให้บริการอีเมล = Brevo |
| ที่เก็บข้อมูลบน Vercel | ยังเป็น `/tmp` ของแต่ละอินสแตนซ์ (ยังไม่ได้ต่อ Upstash Redis) |
| บัญชีแอดมิน | มาจาก `FLO_ADMIN_EMAIL` / `FLO_ADMIN_PASSWORD` ที่ตั้งใน Vercel |

> หมายเหตุ: โดเมนจริงสะกด **`flo-rentp-dew-...`** (ไม่มีขีดล่าง) — ถ้าพิมพ์เป็น `flo-rent_p-dew-...` Vercel จะตอบ `404 DEPLOYMENT_NOT_FOUND`

## สิ่งที่ต้องมี

- Node.js **18 ขึ้นไป** (ทดสอบบน v22)
- ไม่ต้อง `npm install` — เซิร์ฟเวอร์ใช้โมดูลมาตรฐานของ Node ทั้งหมด

## วิธีรันในเครื่อง

```bash
cd flo-rent-main/flo-rent-web
npm start
```

แล้วเปิด **http://127.0.0.1:4173**

> เปิดไฟล์ `index.html` ด้วยการดับเบิลคลิกไม่ได้ เพราะหน้าเว็บต้องเรียก API — ถ้าเปิดแบบ `file://` จะมีข้อความบอกวิธีรันเซิร์ฟเวอร์ขึ้นมาแทน

เปลี่ยนพอร์ต/โฮสต์ได้ด้วย environment variable:

```bash
PORT=8080 HOST=127.0.0.1 npm start
```

### ไฟล์ `.env` (ใช้เฉพาะในเครื่อง)

คัดลอก `.env.example` เป็น `.env` ที่ **รากโปรเจกต์** (`flo-rent-main/flo-rent-web/.env`) แล้วเติมค่า — เซิร์ฟเวอร์โหลดให้เองผ่าน `server/env.js`

```
BREVO_API_KEY=xkeysib-...
FLO_MAIL_FROM=FLO-RENT <your-sender@gmail.com>
```

- `.env` ถูก gitignore ไว้ (`.env*`) — อย่า commit
- ค่าที่ตั้งใน environment จริงจะไม่ถูกเขียนทับจากไฟล์
- แก้ `.env` แล้วต้อง **รีสตาร์ทเซิร์ฟเวอร์**
- `NODE_ENV=test` จะข้ามการอ่านไฟล์ `.env` (ชุดทดสอบจะไม่ส่งอีเมลจริง)

## บัญชีทดลอง (โหมดเดโมเท่านั้น)

บัญชีทดลองจะถูกสร้างเฉพาะเมื่อ **ไม่ได้** รันด้วย `NODE_ENV=production` (หน้า login ไม่มีปุ่มกรอกบัญชีทดลองแล้ว)

| บทบาท | อีเมล | รหัสผ่าน |
| --- | --- | --- |
| ผู้ใช้ | `demo@flo-rent.co` | `demo1234` |
| ผู้ให้เช่า | `owner@flo-rent.co` | `owner1234` |
| ผู้ดูแลระบบ | `admin@flo-rent.co` | `admin1234` |

บัญชีทดลองผู้ใช้/ผู้ให้เช่าเป็นบัญชีทั่วไป — ล็อกอินด้วยรหัสผ่านแล้วต้องยืนยัน OTP ต่อ (โหมดเดโมที่ยังไม่ตั้งค่าอีเมลจะแสดงรหัสบนหน้าเว็บให้กรอก) ส่วนบัญชีผู้ดูแลระบบเข้าได้ด้วยรหัสผ่านทันที

## ตั้งค่า production

```bash
NODE_ENV=production \
FLO_ADMIN_EMAIL=you@yourdomain.com \
FLO_ADMIN_PASSWORD='รหัสผ่านยาวอย่างน้อย 10 ตัวอักษร' \
npm start
```

### Environment variables ทั้งหมด

| ตัวแปร | ความหมาย |
| --- | --- |
| `NODE_ENV` | `production` = ไม่สร้างบัญชีทดลอง/ข้อมูลตัวอย่าง และบล็อกอีเมลทดลองทั้งสามแบบ (Vercel ตั้งให้เอง) |
| `PORT` / `HOST` | พอร์ตและโฮสต์ของเซิร์ฟเวอร์ในเครื่อง (ค่าเริ่มต้น `4173` / `127.0.0.1`) — บน Vercel ไม่ต้องใช้ |
| `FLO_ADMIN_EMAIL` | อีเมลแอดมิน (ต้องตั้งคู่กับรหัสผ่าน และ **ต้องไม่ใช่อีเมลทดลอง** — ดูคำเตือนด้านล่าง) |
| `FLO_ADMIN_PASSWORD` | รหัสผ่านแอดมิน **ยาวอย่างน้อย 10 ตัวอักษร** ไม่งั้นระบบจะ throw ตอนสร้างข้อมูลตั้งต้น |
| `FLO_ADMIN_NAME` | ชื่อที่แสดงของแอดมิน (ไม่บังคับ) |
| `BREVO_API_KEY` | คีย์ Brevo — ใช้เป็นผู้ให้บริการอีเมล OTP |
| `RESEND_API_KEY` | คีย์ Resend — ถ้าตั้งพร้อม Brevo ระบบจะเลือก **Resend ก่อน** |
| `FLO_MAIL_FROM` | ผู้ส่ง เช่น `FLO-RENT <you@gmail.com>` (ต้องเป็นผู้ส่งที่ยืนยันกับผู้ให้บริการแล้ว) |
| `FLO_MAIL_FROM_NAME` | ชื่อผู้ส่ง (ค่าเริ่มต้น `FLO-RENT`) |
| `FLO_ALLOWED_ORIGINS` | โดเมนที่อนุญาตให้เรียก API ที่เขียนข้อมูล คั่นด้วยจุลภาค |
| `FLO_RATE_LIMIT_PER_MIN` | เพดานคำขอต่อนาทีต่อ IP (ค่าเริ่มต้น 20) |
| `FLO_DATA_DIR` | โฟลเดอร์เก็บ `db.json` (เช่น `/var/lib/flo-rent`) |
| `FLO_SEED_CATALOG` | แคตตาล็อกตั้งต้น 16 รายการ (เป็นของบัญชีแอดมิน) — **บน Vercel เปิดอัตโนมัติ** ทั้ง Preview และ Production, `=0` เพื่อปิด; บนเซิร์ฟเวอร์ production อื่นปิดไว้ ตั้ง `=1` เพื่อเปิด |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash/KV REST — เปิดโหมดเก็บข้อมูลบน Redis (ตั้งโดย Vercel Storage) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | ทางเลือกแทนสองตัวข้างบน |
| `FLO_DB_KEY` | ชื่อ key ใน Redis (ค่าเริ่มต้น `florent:db`) |

### ⚠️ อีเมลแอดมินต้องไม่ใช่อีเมลทดลอง

`server/server.js` มีลิสต์อีเมลทดลองฝังไว้:

```js
const DEMO_EMAILS = ['admin@flo-rent.co', 'demo@flo-rent.co', 'owner@flo-rent.co'];
```

บน production ระบบบล็อกอีเมลเหล่านี้ **ก่อนตรวจรหัสผ่าน** เพื่อกันฐานข้อมูลเก่าที่ค้างจากโหมดเดโม ผลคือถ้าตั้ง `FLO_ADMIN_EMAIL=admin@flo-rent.co` จะล็อกอินไม่ได้เลย (ได้ `403 บัญชีทดลองถูกปิดบน production`) แม้รหัสผ่านจะถูก

จึงต้องตั้งเป็นอีเมลอื่น เช่น `FLO_ADMIN_EMAIL=you@gmail.com` (ปัจจุบันใช้ `phichaiyutkhawboon@gmail.com`)

### ตรวจหลังขึ้น production

1. `GET /api/health` → `{"demo":false,"mail":"brevo"}` (หรือ `"resend"`)
2. `GET /api/items` → `total: 0` (ไม่มีข้อมูลตัวอย่าง); ล็อกอินด้วย `demo@flo-rent.co` ต้องได้ 403
3. ล็อกอินแอดมินด้วยอีเมล/รหัสจาก env ที่แท็บ "รหัสผ่าน" → ได้ token แล้ว `GET /api/admin/stats` ตอบ 200
4. สมัครสมาชิกด้วยอีเมลจริงหนึ่งครั้ง → ต้องได้ OTP ในอีเมล และสร้างบัญชีได้หลังยืนยันรหัสเท่านั้น

หน้าแอดมินอยู่ที่ `/admin.html` (เข้าด้วยบัญชี admin เท่านั้น)

## เข้าสู่ระบบด้วย OTP ทางอีเมล

หน้า `/login.html` ใช้ **OTP ทางอีเมล** เป็นวิธีหลัก และ **การสมัครสมาชิกต้องยืนยันอีเมลก่อนสร้างบัญชี**

**สมัครสมาชิก**
1. กรอกชื่อ อีเมล รหัสผ่าน อายุ (และเบอร์โทรถ้าต้องการ) → กด "รับรหัส OTP ทางอีเมล" (ยังไม่มีการสร้างบัญชี)
2. ระบบสร้างรหัส 6 หลัก อายุ 10 นาที ส่งเข้าอีเมลนั้น
3. กรอกรหัส → ระบบออก `signupToken` (ใช้ครั้งเดียว 15 นาที) แล้วสร้างบัญชีให้และเข้าสู่ระบบทันที

**เข้าสู่ระบบ**
1. กรอกอีเมลที่สมัครไว้ → ระบบสร้างรหัส 6 หลัก ส่งเข้าอีเมล
2. กรอกรหัส → ได้ token และเข้าสู่ระบบ

**เข้าสู่ระบบด้วยรหัสผ่าน (แท็บ "รหัสผ่าน")**
1. กรอกอีเมล + รหัสผ่าน → ถ้าถูกต้อง ระบบส่งรหัส OTP ไปที่อีเมลนั้น (ยังไม่ได้ token)
2. กรอกรหัส OTP → ได้ token และเข้าสู่ระบบ

รหัสผ่านอย่างเดียวไม่เพียงพอสำหรับผู้ใช้ทั่วไป — ระบบไม่ออก session ให้ก่อนยืนยัน OTP ทางอีเมล
ข้อยกเว้นเดียวคือบัญชี `admin` (จาก `FLO_ADMIN_EMAIL`/`FLO_ADMIN_PASSWORD`) ซึ่งล็อกอินด้วยรหัสผ่านได้ทันที
เพื่อให้ยังเข้าไปดูแลระบบได้แม้ระบบอีเมลจะยังไม่พร้อม

รหัสใช้ได้ครั้งเดียว (กรอกผิดได้ไม่เกิน 5 ครั้ง) ขอรหัสใหม่ได้หลัง 60 วินาที และไม่เกิน 5 ครั้งต่อชั่วโมงต่ออีเมล

## ผู้ให้บริการอีเมล OTP

เลือกตั้งค่า env ตัวใดตัวหนึ่ง (เรียก HTTPS API ตรง ไม่ต้องติดตั้ง dependency):

```bash
# Brevo (ที่ใช้อยู่ตอนนี้) — ต้องใช้ผู้ส่งที่ยืนยันกับ Brevo แล้ว
BREVO_API_KEY=xkeysib-xxx
FLO_MAIL_FROM='FLO-RENT <you@gmail.com>'

# หรือ Resend — ถ้าตั้งทั้งสองคีย์ ระบบจะเลือก Resend ก่อน
RESEND_API_KEY=re_xxx
FLO_MAIL_FROM='FLO-RENT <no-reply@yourdomain.com>'
```

- Brevo ใช้ที่อยู่อีเมลฟรี (เช่น `@gmail.com`) เป็นผู้ส่งได้โดยไม่ต้องมีโดเมน — Brevo จะแทนโดเมนผู้ส่งเป็น `xxxxx.brevosend.com` ให้เอง (อีเมลยังส่งถึงผู้รับปกติ แต่ชื่อผู้ส่งจะไม่ใช่โดเมนของคุณ) ถ้าต้องการชื่อผู้ส่งบนโดเมนของตัวเองต้องยืนยันโดเมน
- Resend ที่ยังไม่ยืนยันโดเมนจะใช้ผู้ส่ง `onboarding@resend.dev` ซึ่งส่งได้เฉพาะอีเมลของเจ้าของบัญชี Resend (อีเมลอื่นถูกปฏิเสธ 403 `You can only send testing emails to your own email address`) — สำหรับผู้ใช้จริงให้ยืนยันโดเมนที่ resend.com/domains แล้วตั้ง `FLO_MAIL_FROM` เป็นอีเมลบนโดเมนนั้น ระบบจะแจ้งสาเหตุนี้ให้เห็นบนหน้าเว็บเมื่อถูกปฏิเสธ
- ถ้ายังไม่ตั้งค่า: โหมดพัฒนา (`NODE_ENV !== production`) จะพิมพ์รหัสลงคอนโซลเซิร์ฟเวอร์และหน้าเว็บแสดงรหัสให้กรอกเอง ส่วน production จะตอบ **503** และไม่ออก OTP เลย
- ถ้าส่งอีเมลไม่สำเร็จ ระบบจะถอดรหัส OTP ที่เพิ่งสร้างออก (ไม่นับคูลดาวน์ 60 วินาที) ผู้ใช้กดขอใหม่ได้ทันที
- ตรวจสถานะผู้ให้บริการอีเมลได้ที่ `GET /api/health` (ฟิลด์ `mail`)
- เก็บเฉพาะ **hash ของรหัส** (SHA-256) ในฐานข้อมูล ไม่เก็บรหัสจริง และลบรหัสทันทีที่ใช้สำเร็จ

## Deploy บน Vercel

Vercel รันเซิร์ฟเวอร์ที่ `listen()` ค้างไว้ไม่ได้ และดิสก์เขียนถาวรไม่ได้ จึงแยกเป็น: ไฟล์ใน `public/` เสิร์ฟเป็น static, ส่วน `/api/*` รันเป็น serverless function (`api/index.js`) และเก็บข้อมูลใน Redis

### ขั้นตอน

1. Vercel → Project → Settings → General → **Root Directory = `flo-rent-main/flo-rent-web`**
   (repo root บน GitHub คือ `Flo-rent_p-dew` ซึ่งมีโปรเจกต์อยู่ลึกสองชั้น — ถ้าใส่แค่ `flo-rent-web` Vercel จะหา `api/index.js` ไม่เจอ)
2. Project → **Storage → Marketplace → Upstash for Redis** (ฟรี) → Connect to Project
   ระบบจะเพิ่ม env `KV_REST_API_URL` และ `KV_REST_API_TOKEN` ให้เอง
3. ตั้ง env อย่างน้อย 4 ตัวใน **Settings → Environment Variables** แล้วเลือกให้ครบทั้ง **Production และ Preview**:

   | Key | ตัวอย่างค่า |
   | --- | --- |
   | `BREVO_API_KEY` | `xkeysib-...` (สร้างเป็นชนิด **Secret**) |
   | `FLO_MAIL_FROM` | `FLO-RENT <you@gmail.com>` |
   | `FLO_ADMIN_EMAIL` | อีเมลจริง **ที่ไม่ใช่ `@flo-rent.co`** |
   | `FLO_ADMIN_PASSWORD` | รหัสยาว ≥ 10 ตัว |

   ไม่ต้องตั้ง `NODE_ENV` (Vercel ตั้ง `production` ให้เอง) และไม่ต้องตั้ง `PORT`/`HOST`
4. **Redeploy** — Vercel ใช้ค่า env ตอน deploy ครั้งล่าสุดเท่านั้น: Deployments → deployment บนสุด → **⋯ → Redeploy**
   ครั้งแรกที่มีคนเรียก API ระบบจะสร้างข้อมูลตั้งต้น (หมวดหมู่ + บัญชีแอดมิน) ให้เอง

### ทำผ่าน Vercel CLI

```bash
# ล็อกอินครั้งเดียว (เบราว์เซอร์อนุมัติ)
npx vercel login

# ผูกโฟลเดอร์โปรเจกต์กับ Vercel project
cd flo-rent-main/flo-rent-web
npx vercel link --project flo-rent_p-dew-flo-rent-web-1

# ดู/ตั้ง env (ไม่ต้องพิมพ์ค่าในแชต)
npx vercel env ls
printf '%s' 'you@gmail.com' | npx vercel env add FLO_ADMIN_EMAIL production --force

# redeploy โดยใช้ source + การตั้งค่าล่าสุด (ไม่ต้อง push commit ใหม่)
npx vercel redeploy https://flo-rentp-dew-flo-rent-web-1.vercel.app --non-interactive
```

- **`npx vercel --prod` ต้องรันจาก repo root (`Flo-rent_p-dew`)** เพราะ Root Directory ตั้งเป็น `flo-rent-main/flo-rent-web` — ถ้ารันจากใน `flo-rent-web` จะได้ error `The specified Root Directory ... does not exist`
- `vercel env add` แบบไม่ระบุชนิดค่า จะเก็บเป็น **Secret** โดยปริยาย (และไม่ต้องใช้ `--sensitive`)
- ค่า env ที่เปลี่ยนแล้วยังไม่มีผลกับ deployment เดิม ต้อง `vercel redeploy` หรือ Redeploy ใน dashboard

### ถ้าไม่ตั้ง Redis (ปัจจุบัน)

ระบบยังรันได้ แต่ข้อมูลเก็บที่ `/tmp` ของแต่ละอินสแตนซ์ (`server/db.js`) — ข้อมูลจะหายเมื่ออินสแตนซ์รีสตาร์ท และคำขอที่ไปโดนอินสแตนซ์อื่นจะมองไม่เห็น session/OTP ที่เพิ่งสร้าง (ล็อกอินติดแล้วเด้งออกได้) จึงควรต่อ Redis ก่อนใช้งานจริง

## ฟีเจอร์

**ผู้ใช้ทั่วไป**
- หน้าแรก: ค้นหา, 6 หมวดหมู่, สินค้ายอดนิยม, HOW TO USE, Brand value
- ค้นหา/กรองตามคำสำคัญ หมวดหมู่ ช่วงราคา/วัน และเรียงตามราคา/คะแนน (อัปเดต URL)
- หน้ารายละเอียด: เงื่อนไขการเช่า, คำนวณค่าเช่า × วัน + มัดจำ, จองได้เมื่อเข้าสู่ระบบ
- สมัครสมาชิก/เข้าสู่ระบบด้วย **OTP ทางอีเมล** (บังคับยืนยันอีเมลทุกครั้ง, บังคับอายุ 15 ปีขึ้นไป), โปรไฟล์, แก้ไขข้อมูล, เลือกอวตาร
- ประวัติการจอง: กรองตามสถานะ, ยกเลิกการจองที่รอยืนยัน, ยืนยันคืนสินค้า
- ลงประกาศให้เช่า (ผูกกับบัญชี), ประกาศของฉัน, ประกาศตามหา (LOOK FOR)
- **หาคนทำงาน / ลงหางาน**: จ้างฟรีแลนซ์รายวัน (Producer, AD1, AD2, Catering, Casting, Acting, Coach, Grip, คนจูงหมา, คนวาดรูป, คนทำรูปเล่ม, คนเขียนเว็บไซต์) — จ่ายผ่าน Wallet และยกเลิกได้ก่อนเริ่มงาน
- **FLO-RENT wallet**: เติมเงิน, จ่ายค่าเช่า, กันเงินมัดจำไว้จนกว่าจะคืนของ, รายการเดินบัญชี
- **เครดิตผู้ใช้** (0–100): +2 เมื่อคืนของครบ, −4 เมื่อยกเลิก, ต่ำกว่า 40 จองใหม่ไม่ได้

**แอดมิน**
- ภาพรวม: จำนวนผู้ใช้/ประกาศ/การจอง, ยอดรวม, สถานะการจองล่าสุด
- ผู้ใช้: ค้นหา, ตั้ง/ลดสิทธิ์แอดมิน, ระงับ/เปิดใช้บัญชี (ระงับแล้ว token ถูกตัดทันที)
- ประกาศ: ค้นหา, ซ่อน/เผยแพร่, ลบ
- การจอง: กรองตามสถานะ, เปลี่ยนสถานะได้ทุกค่า
- คำขอตามหา: ดูและลบ

## โครงสร้างไฟล์

```
Flo-rent_p-dew/                      # repo root บน GitHub
└── flo-rent-main/
    └── flo-rent-web/                # ← Root Directory บน Vercel
        ├── public/                  # หน้าเว็บทั้งหมด (Vercel เสิร์ฟเป็น static)
        │   ├── index.html browse.html item.html post.html look-for.html
        │   ├── login.html profile.html bookings.html admin.html
        │   ├── css/style.css
        │   └── js/
        ├── server/
        │   ├── server.js            # HTTP server + REST API + static files
        │   ├── db.js                # ที่เก็บข้อมูล: ไฟล์ JSON (local) หรือ Redis REST (Vercel)
        │   ├── auth.js              # scrypt hash + token
        │   ├── mailer.js            # ส่งอีเมล OTP (Brevo / Resend หรือคอนโซลในโหมดพัฒนา)
        │   ├── env.js               # โหลด .env แบบไม่ต้องใช้ dependency
        │   └── seed.js              # ข้อมูลตั้งต้น
        ├── test/api.test.js         # npm test
        ├── api/index.js             # จุดเข้า serverless ของ Vercel
        ├── vercel.json
        ├── .env.example             # template (ไม่มีค่าจริง)
        └── package.json             # npm start
```

ในเครื่อง ข้อมูลถูกเก็บที่ `server/data/db.json` (สร้างอัตโนมัติครั้งแรก)

## API

ทุก endpoint อยู่ใต้ `/api` — ส่ง token ด้วย `Authorization: Bearer <token>`

| Method | Path | คำอธิบาย |
| --- | --- | --- |
| GET | `/api/health` | ตรวจสถานะเซิร์ฟเวอร์ (`demo`, `mail`) |
| GET | `/api/categories` | หมวดหมู่ |
| GET | `/api/items?q&cat&min&max&sort` | ค้นหาสินค้าที่เผยแพร่ |
| GET | `/api/items?mine=1` | ประกาศของฉัน (ต้องล็อกอิน) |
| GET | `/api/items/:id` | รายละเอียดสินค้า |
| POST | `/api/items` | ลงประกาศ |
| PATCH | `/api/items/:id` | แก้ไข/ซ่อนประกาศ (เจ้าของหรือแอดมิน) |
| DELETE | `/api/items/:id` | ลบประกาศ (เจ้าของหรือแอดมิน) |
| POST | `/api/auth/register` | สมัครสมาชิก (อายุ ≥ 15, ต้องมี `signupToken` จากการยืนยันอีเมล) |
| POST | `/api/auth/login` | เข้าสู่ระบบด้วยรหัสผ่าน → ส่ง OTP ทางอีเมลและคืน `otpRequired: true` (ผู้ใช้ทั่วไป) หรือ token ทันที (เฉพาะ `admin`) |
| POST | `/api/auth/otp/request` | ขอรหัส OTP ทางอีเมล (`email`, `purpose`: `login` (ค่าเริ่มต้น) หรือ `signup`) |
| POST | `/api/auth/otp/verify` | ยืนยันรหัส OTP (`email`, `code`, `purpose`) → token (login) หรือ `signupToken` (signup) |
| POST | `/api/auth/logout` | ออกจากระบบ |
| GET | `/api/me` | ข้อมูลบัญชี + สถิติ |
| PATCH | `/api/me` | แก้ไขโปรไฟล์ |
| GET | `/api/bookings` | การจองของฉัน |
| POST | `/api/bookings` | จองสินค้า (`itemId`, `start`, `end`) |
| PATCH | `/api/bookings/:code` | `{action:"cancel"}` หรือ `{action:"return"}` — `return` = **แจ้งคืน** (สถานะ `return_requested`, ยังไม่คืนเงิน) |
| GET | `/api/owner/bookings` | คำขอจองที่เข้ามาในประกาศของฉัน |
| PATCH | `/api/owner/bookings/:code` | `confirm` / `reject` / `receive` (ยืนยันรับคืน → คืนมัดจำ + จ่ายค่าเช่า) / `dispute` (`note` = เหตุผล, กลับไปสถานะ `active`) |
| GET | `/api/requests` | คำขอตามหา |
| GET | `/api/work-categories` | หมวดหมู่การจ้างงาน (Producer, Grip, Catering, …) |
| GET | `/api/workers?cat&q` | คนทำงานที่เปิดรับจ้าง (เรตค่าจ้าง/วัน) |
| GET | `/api/jobs?cat&mine` | งานที่เปิดรับ / งานที่ฉันประกาศ |
| POST | `/api/jobs` | ลงประกาศหางาน (`title`, `cat`, `rate`, `days`, `start`, `location`, `desc`) |
| GET | `/api/hires` | ประวัติการจ้างของฉัน |
| POST | `/api/hires` | จ้างคนทำงาน (`workerId`, `days`) — หักจาก Wallet |
| PATCH | `/api/hires/:code` | ยกเลิกการจ้าง (`action=cancel`) — คืนเงินเต็มจำนวน |
| POST | `/api/requests` | ประกาศตามหา |
| POST | `/api/requests/:id/offers` | เสนอประกาศของตัวเองให้คำขอ (`itemId`, `note`) |
| GET | `/api/wallet` | ยอดเงิน + เครดิต + รายการเดินบัญชีของฉัน |
| POST | `/api/wallet/topup` | เติมเงินเข้ากระเป๋า (`amount` 1–50000) |
| GET | `/api/admin/categories` | หมวดหมู่สินค้า + หมวดหมู่การจ้างงาน พร้อมจำนวนที่ใช้อยู่ (แอดมิน) |
| POST | `/api/admin/categories` | เพิ่มหมวดหมู่ (`kind=items\|jobs`, `name`, `emoji`, `sub`) |
| PATCH | `/api/admin/categories/:kind/:key` | แก้ไขชื่อ/ไอคอน/คำอธิบายหมวดหมู่ |
| DELETE | `/api/admin/categories/:kind/:key` | ลบหมวดหมู่ (ลบไม่ได้ถ้ายังมีรายการใช้อยู่) |
| GET | `/api/admin/stats` | สถิติภาพรวม (แอดมิน) |
| GET | `/api/admin/wallet` | ยอดรวมกระเป๋า เงินที่กันไว้ และธุรกรรมทั้งหมด (แอดมิน) |
| GET | `/api/admin/logs` | ล็อกระบบ: เติมเงิน กันเงิน คืนเงิน ค่าเช่า และเครดิต (แอดมิน) |
| GET | `/api/admin/users?q` | รายชื่อผู้ใช้ (แอดมิน) |
| PATCH | `/api/admin/users/:id` | เปลี่ยน `role` / `status` (แอดมิน) |
| GET | `/api/admin/items?q` | ประกาศทั้งหมด (แอดมิน) |
| PATCH | `/api/admin/items/:id` | ซ่อน/เผยแพร่ (แอดมิน) |
| DELETE | `/api/admin/items/:id` | ลบประกาศ (แอดมิน) |
| GET | `/api/admin/bookings?status` | การจองทั้งหมด (แอดมิน) |
| PATCH | `/api/admin/bookings/:code` | เปลี่ยนสถานะการจอง (แอดมิน) |
| GET | `/api/admin/requests` | คำขอทั้งหมด (แอดมิน) |
| DELETE | `/api/admin/requests/:id` | ลบคำขอ (แอดมิน) |

## รีเซ็ตข้อมูล

ในเครื่อง — หยุดเซิร์ฟเวอร์แล้วลบไฟล์ข้อมูล:

```bash
rm -rf server/data
npm start
```

ระบบจะสร้างข้อมูลตั้งต้นใหม่ (บัญชีทดลอง + สินค้า 16 ชิ้น + การจองตัวอย่าง) — ถ้ารันด้วย `NODE_ENV=production` จะสร้างแค่หมวดหมู่และบัญชีแอดมินจาก env

บน Vercel + Redis — ลบ key `florent:db` และ `florent:db:v` ใน Upstash console แล้วเรียก API ครั้งถัดไป ระบบจะสร้างข้อมูลตั้งต้นใหม่

## รันเทสต์

```bash
npm test
```

ใช้ `node:test` ของ Node ไม่ต้องติดตั้ง dependency — เทสต์จะรันเซิร์ฟเวอร์จริงบนพอร์ตสุ่มและเก็บข้อมูลในโฟลเดอร์ชั่วคราว (ไม่แตะ `server/data/db.json`) ครอบคลุม:

- production ไม่มีบัญชีทดลอง / แอดมินมาจาก env เท่านั้น
- คำขอที่เขียนข้อมูลจากต่าง Origin ได้ 403
- pagination ของ `/api/items`, `/api/bookings`, `/api/requests`
- สิทธิ์ข้ามบัญชี (ยกเลิก/ยืนยันการจองของคนอื่นไม่ได้)
- flow คืนของ 2 ขั้น (แจ้งคืน → เจ้าของยืนยัน → คืนมัดจำ/จ่ายค่าเช่า) และกันจ่ายเงินซ้ำ
- OTP ทางอีเมล: ขอรหัส → ยืนยัน → ได้ token, ใช้รหัสซ้ำไม่ได้, กรอกผิดครบ 5 ครั้งถูกล็อก, ขอรหัสซ้ำเร็วเกินไปได้ 429
- ล็อกอินด้วยรหัสผ่าน: รหัสผ่านผิดได้ 401, รหัสผ่านถูกแต่ยังไม่ได้ token (ต้องยืนยัน OTP), แอดมินได้ token ทันที
- สมัครสมาชิก: สร้างบัญชีไม่ได้ถ้ายังไม่ยืนยันรหัสทางอีเมล, `signupToken` ใช้ซ้ำไม่ได้, อีเมลที่มีบัญชีแล้วขอรหัสสมัครไม่ได้ (409)

## Pagination

Endpoint ที่คืนรายการยาวรับ `?page=` และ `?limit=` (ค่าเริ่มต้น/เพดานตามตาราง) และตอบกลับด้วย `page`, `limit`, `total`, `pages`, `count` เพิ่มจาก key เดิม

| Endpoint | ค่าเริ่มต้น | เพดาน |
| --- | --- | --- |
| `/api/items` | 24 | 100 |
| `/api/bookings`, `/api/owner/bookings` | 100 | 200 |
| `/api/requests` | 50 | 100 |
| `/api/admin/*` (รายการ) | 100–200 | 500 |

หน้า browse ใช้ปุ่ม “โหลดเพิ่ม” จึงไม่ต้องโหลดสินค้าทั้งหมดในครั้งเดียว

## ความปลอดภัย

- รหัสผ่านเก็บเป็น **scrypt** พร้อม salt ต่อบัญชี ไม่เก็บข้อความตรง ๆ
- session token สุ่ม 24 ไบต์ (hex) อายุ 14 วัน เก็บฝั่งเซิร์ฟเวอร์และเพิกถอนได้
- จำกัดจำนวนครั้งการ login/register/OTP (20 ครั้ง/นาที ต่อ IP — นับในหน่วยความจำของอินสแตนซ์)
- OTP ทางอีเมล: รหัส 6 หลักจาก `crypto.randomInt`, เก็บเป็น SHA-256 hash, อายุ 10 นาที, ใช้ครั้งเดียว, กรอกผิดได้ 5 ครั้ง, ขอใหม่ได้ทุก 60 วินาที (สูงสุด 5 ครั้ง/ชั่วโมง/อีเมล)
- สมัครสมาชิกต้องยืนยันอีเมล: `signupToken` สุ่มใหม่ เก็บเป็น SHA-256 hash, ใช้ครั้งเดียว, อายุ 15 นาที
- OTP เก็บแยกตามวัตถุประสงค์ (login / signup) — รหัสของงานหนึ่งใช้กับอีกงานไม่ได้
- การล็อกอินด้วยรหัสผ่านของผู้ใช้ทั่วไปไม่ให้ session ก่อนยืนยัน OTP (แอดมินเท่านั้นที่ข้ามได้)
- เพดานคำขอต่อนาทีต่อ IP ปรับได้ด้วย `FLO_RATE_LIMIT_PER_MIN` (ค่าเริ่มต้น 20)
- คำขอที่เขียนข้อมูล (`POST/PATCH/DELETE`) ตรวจ `Origin` เทียบกับ host ของเซิร์ฟเวอร์ → 403 ถ้ามาจากโดเมนอื่น (เพิ่มโดเมนที่อนุญาตได้ด้วย `FLO_ALLOWED_ORIGINS`)
- ไม่มีบัญชีทดลองบน production และปิดการ login ด้วยอีเมลทดลองทั้งสามแบบ
- คืนของเป็น **2 ขั้น**: ผู้เช่าแจ้งคืน → ผู้ให้เช่ายืนยันรับคืน ระบบจึงคืนมัดจำ (กันการกดคืนของเองเพื่อเอามัดจำ) และแจ้งปัญหา (`dispute`) กลับไปสถานะกำลังเช่าได้
- ตรวจ input ทุกจุด, จำกัดขนาด body 4MB (เผื่อรูป base64), ป้องกัน path traversal ตอนเสิร์ฟไฟล์
- ตั้ง header `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
- ประกาศ/การจองแก้ได้เฉพาะเจ้าของ (หรือแอดมิน)

## ข้อจำกัดที่ควรรู้ก่อนใช้จริง

- ข้อมูลยังเก็บเป็น JSON ก้อนเดียว: โฟลเดอร์เครื่องเดียวตอนรันในเครื่อง หรือ Redis ก้อนเดียวบน Vercel — ยังไม่ใช่ฐานข้อมูลเชิงสัมพันธ์
- รูปสินค้าเก็บเป็น base64 อยู่ในก้อนข้อมูลเดียวกัน ทำให้ข้อมูลโตเร็ว
- ยังไม่มีระบบชำระเงินจริง (กระเป๋าเป็นตัวเลขภายในระบบ) และยังไม่มีโดเมนของตัวเอง (ผู้ส่งอีเมลจึงเป็น `*.brevosend.com`)
- rate limit นับแยกต่ออินสแตนซ์ — บน Vercel หลายอินสแตนซ์ทำให้เพดานจริงสูงกว่าที่ตั้งไว้
- การส่งอีเมลขึ้นกับผู้ให้บริการภายนอก (Brevo ฟรี ~300 เมล/วัน)
- ถ้ายังไม่ต่อ Redis บน Vercel ข้อมูลและ session จะไม่คงอยู่ถาวร
