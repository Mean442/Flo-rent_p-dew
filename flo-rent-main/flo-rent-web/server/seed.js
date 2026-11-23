'use strict';

/* ข้อมูลตั้งต้น: หมวดหมู่ / บัญชีทดลอง / สินค้า / การจอง / คำขอตามหา */

const { hashPassword } = require('./auth');

const DAY = 86400000;

/*
 * โหมดเดโม: เปิดเฉพาะเมื่อไม่ได้รันแบบ production
 * NODE_ENV=production → ไม่สร้างบัญชีทดลองหรือข้อมูลตัวอย่างเลย
 * บัญชีแอดมินบน production ต้องมาจาก environment เท่านั้น (ไม่มีรหัสผ่านสำรองในโค้ด)
 */
function isDemoMode() {
  return process.env.NODE_ENV !== 'production';
}

function envAdmin() {
  const email = String(process.env.FLO_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.FLO_ADMIN_PASSWORD || '');
  if (!email && !password) return null;
  if (!email || !password) {
    throw new Error('ต้องตั้งทั้ง FLO_ADMIN_EMAIL และ FLO_ADMIN_PASSWORD');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new Error('FLO_ADMIN_EMAIL ไม่ใช่รูปแบบอีเมล');
  }
  if (password.length < 10) {
    throw new Error('FLO_ADMIN_PASSWORD ต้องยาวอย่างน้อย 10 ตัวอักษร');
  }
  return {
    id: 'u-admin',
    name: String(process.env.FLO_ADMIN_NAME || 'ผู้ดูแล FLO-RENT').slice(0, 60),
    email: email,
    passHash: hashPassword(password),
    role: 'admin',
    status: 'active',
    phone: '—', age: 30, location: 'กรุงเทพฯ', avatar: '🛠️',
    bio: 'ทีมงาน FLO-RENT', rating: 5, reviews: 0,
    wallet: 0, credit: 90,
    joinedAt: new Date().toISOString()
  };
}

const CATEGORIES = [
  { key: 'crew', num: '01', name: 'ของใช้คนออกกอง', emoji: '🎬', sub: 'กล้อง · ขาตั้งกล้อง · อุปกรณ์แสง-เสียง' },
  { key: 'fashion', num: '02', name: 'แฟชั่น', emoji: '👗', sub: 'เสื้อผ้า · อุปกรณ์แต่งหน้า · ชุดเครื่องสำอาง' },
  { key: 'sport', num: '03', name: 'อุปกรณ์กีฬา', emoji: '🏀', sub: 'บาส · ฟุตบอล · จักรยาน' },
  { key: 'party', num: '04', name: 'งานบันเทิง', emoji: '🪩', sub: 'แท่งไฟ · เครื่องเสียง · เวที' },
  { key: 'gadget', num: '05', name: 'อิเล็กทรอนิกส์', emoji: '📱', sub: 'โทรศัพท์ · ลำโพง · โปรเจกเตอร์' },
  { key: 'general', num: '06', name: 'อุปกรณ์ทั่วไป', emoji: '🪑', sub: 'โต๊ะ · เก้าอี้ · ของใช้ในบ้าน' }
];

/* หมวดหมู่การจ้างงาน — งานฟรีแลนซ์สายโปรดักชัน/ครีเอทีฟ */
const JOB_CATEGORIES = [
  { key: 'producer',        name: 'Producer',                emoji: '🎬', sub: 'ดูแลงานผลิตทั้งงาน' },
  { key: 'ad1',             name: 'Asst. Director 1',        emoji: '🎯', sub: 'ผู้ช่วยผู้กำกับคนที่ 1' },
  { key: 'ad2',             name: 'Asst. Director 2',        emoji: '🧭', sub: 'ผู้ช่วยผู้กำกับคนที่ 2' },
  { key: 'catering',        name: 'Catering',                emoji: '🍱', sub: 'อาหารและของว่างในกอง' },
  { key: 'casting',         name: 'Casting Director',        emoji: '🎭', sub: 'คัดเลือกนักแสดง' },
  { key: 'acting',          name: 'Acting',                  emoji: '🎤', sub: 'นักแสดง / ผู้แสดง' },
  { key: 'coach',           name: 'Coach',                   emoji: '🧑‍🏫', sub: 'โค้ชการแสดง/การเคลื่อนไหว' },
  { key: 'grip',            name: 'Grip',                    emoji: '🛠️', sub: 'อุปกรณ์ไฟและขาตั้ง' },
  { key: 'dog-walker',      name: 'คนจูงหมา',                 emoji: '🐕', sub: 'พาน้องหมาเดิน/ดูแล' },
  { key: 'illustrator',     name: 'คนวาดรูป',                emoji: '🎨', sub: 'ภาพประกอบ / สตอรีบอร์ด' },
  { key: 'report-designer', name: 'คนทำรูปเล่มรายงาน',        emoji: '📘', sub: 'จัดหน้าหนังสือ/รายงาน' },
  { key: 'web-dev',         name: 'คนเขียนเว็บไซต์',          emoji: '💻', sub: 'เว็บ/แลนดิ้งพจ' }
];

/* คนทำงานที่เปิดรับจ้าง (ค่าแรงต่อวัน) — userId = null คือบัญชีตัวอย่าง */
const WORKERS = [
  {
    id: 'wk-mint', name: 'พี่มิ้นท์ สตูดิโออารีย์', cat: 'producer', rate: 3500,
    location: 'กรุงเทพฯ · อารีย์', rating: 4.9, reviews: 27, avatar: '🎬', userId: null,
    bio: 'ดูงานโปรดักชันโฆษณาและมิวสิกวิดีโอ 10 ปี ดูแลทีม 5–15 คน พร้อมตารางถ่ายและงบประมาณ'
  },
  {
    id: 'wk-jay', name: 'น้องเจ ฟรีแลนซ์กองถ่าย', cat: 'ad1', rate: 1800,
    location: 'กรุงเทพฯ · บางนา', rating: 4.8, reviews: 19, avatar: '🎯', userId: null,
    bio: 'ผู้ช่วยผู้กำกับคนที่ 1 ดูแลคิวถ่ายและเรียกซีน ถนัดงานถ่ายคอนเทนต์ 1–2 วัน'
  },
  {
    id: 'wk-ploy', name: 'น้องพลอย ทีมเอเจนซี', cat: 'ad2', rate: 1500,
    location: 'กรุงเทพฯ · รัชดา', rating: 4.7, reviews: 14, avatar: '🧭', userId: null,
    bio: 'AD2 ดูแลนักแสดงและสคริปต์หน้างาน มีประสบการณ์งานอีเวนต์และงานถ่ายสินค้า'
  },
  {
    id: 'wk-noi', name: 'พี่หนดย ครัวกองถ่าย', cat: 'catering', rate: 400,
    location: 'กรุงเทพฯ · ลาดพร้าว', rating: 4.9, reviews: 41, avatar: '🍱', userId: null,
    bio: 'เสิร์ฟอาหารกองถ่าย 1 วัน/400 บาทต่อคน รวมข้าวกล่อง น้ำ และของว่าง มีรถส่งเอง'
  },
  {
    id: 'wk-nan', name: 'พี่แนน แคสติ้งเฮาส์', cat: 'casting', rate: 2500,
    location: 'กรุงเทพฯ · สีลม', rating: 4.8, reviews: 22, avatar: '🎭', userId: null,
    bio: 'คัดนักแสดงโฆษณาและซีรีส์ มีฐานนักแสดงกว่า 300 คน ส่งโปรไฟล์ภายใน 24 ชม.'
  },
  {
    id: 'wk-win', name: 'น้องวิน นักแสดง', cat: 'acting', rate: 2000,
    location: 'กรุงเทพฯ · จตุจักร', rating: 4.6, reviews: 16, avatar: '🎤', userId: null,
    bio: 'นักแสดงรับบทนำ/สมทบ งานโฆษณา ซีรีส์ และ MV ซ้อมบทไว ตรงเวลา'
  },
  {
    id: 'wk-kong', name: 'พี่ก้อง Acting Coach', cat: 'coach', rate: 1200,
    location: 'กรุงเทพฯ · ทองหล่อ', rating: 4.9, reviews: 12, avatar: '🧑‍🏫', userId: null,
    bio: 'โค้ชการแสดงและ workshop กลุ่มเล็ก เหมาะกับทีมที่ต้องการซ้อมก่อนถ่าย'
  },
  {
    id: 'wk-boy', name: 'พี่บอย กริปกอง', cat: 'grip', rate: 900,
    location: 'กรุงเทพฯ · บางกะปิ', rating: 4.7, reviews: 30, avatar: '🛠️', userId: null,
    bio: 'กริป/ไฟ ประสบการณ์ 6 ปี รับผิดชอบขาตั้ง ไฟ และความปลอดภัยบนกอง'
  },
  {
    id: 'wk-khao', name: 'น้องข้าวหอม จูงหมา', cat: 'dog-walker', rate: 400,
    location: 'กรุงเทพฯ · อ่อนนุช', rating: 5.0, reviews: 58, avatar: '🐕', userId: null,
    bio: 'พาน้องหมาเดินและดูแลระหว่างวัน 1 วัน/400 บาท ส่งรูปอัปเดตทุกชั่วโมง'
  },
  {
    id: 'wk-fah', name: 'น้องฟ้า นักวาดภาพประกอบ', cat: 'illustrator', rate: 800,
    location: 'เชียงใหม่ · นิมมาน', rating: 4.9, reviews: 24, avatar: '🎨', userId: null,
    bio: 'วาดภาพประกอบและสตอรีบอร์ด แนวการ์ตูน/มินิมอล ส่งไฟล์ต้นฉบับความละเอียดสูง'
  },
  {
    id: 'wk-oi', name: 'พี่อ้อย จัดรูปเล่ม', cat: 'report-designer', rate: 1200,
    location: 'กรุงเทพฯ · พระโขนง', rating: 4.8, reviews: 18, avatar: '📘', userId: null,
    bio: 'จัดหน้าหนังสือและรูปเล่มรายงาน ปรับแต่งเลย์เอาต์ให้พร้อมพิมพ์ พร้อมไฟล์ PDF'
  },
  {
    id: 'wk-tong', name: 'น้องโต้ง ดีเวลลอปเปอร์', cat: 'web-dev', rate: 2500,
    location: 'ขอนแก่น · เมือง', rating: 4.8, reviews: 21, avatar: '💻', userId: null,
    bio: 'เขียนเว็บไซต์/แลนดิ้งพจ HTML–CSS–JS และปรับแก้หน้าบ้านให้รองรับมือถือ'
  }
];

/* รูปสินค้าตั้งต้น — ไฟล์จริงอยู่ใน public/img/ (คัดจากโฟลเดอร์ img/ ของโปรเจกต์) */
const ITEM_IMAGES = {
  'cam-sony-a7iii': ['img/cam-sony-a7iii.jpg'],
  'tripod-manfrotto': ['img/tripod-manfrotto.jpg'],
  'light-studio-kit': ['img/light-studio-kit.jpg'],
  'mic-rode-wireless': ['img/mic-rode-wireless.jpg'],
  'dress-satin-red': ['img/dress-satin-red.jpg'],
  'bag-chanel-classic': ['img/bag-chanel-classic.jpg'],
  'makeup-kit-mac': ['img/makeup-kit-mac.jpg'],
  'bike-trek-domane': ['img/bike-trek-domane.jpg'],
  'basketball-spalding': ['img/basketball-spalding.jpg'],
  'lightstick-pack': ['img/lightstick-pack.jpg'],
  'speaker-jbl-partybox': ['img/speaker-jbl-partybox.jpg'],
  'iphone-14-pro': ['img/iphone-14-pro.jpg'],
  'projector-epson': ['img/projector-epson.jpg'],
  'table-folding-180': ['img/table-folding-180.jpg'],
  'chair-ergonomic': ['img/chair-ergonomic.jpg'],
  'tent-4p': ['img/tent-4p.png']
};

const ITEMS = [
  {
    id: 'cam-sony-a7iii', cat: 'crew', title: 'กล้อง Sony A7 III + เลนส์ 28-70', emoji: '📷',
    price: 1500, deposit: 8000, owner: 'พี่กันต์ สตูดิโอกลางซอย', rating: 4.9, reviews: 42,
    location: 'กรุงเทพฯ · อารีย์', tags: ['กล้อง', 'camera', 'วิดีโอ', 'คอนเทนต์'],
    desc: 'ชุดกล้อง Full Frame พร้อมเลนส์คิต 28-70 เหมาะกับงานถ่ายคอนเทนต์และงานออกกอง ไม่ต้องซื้อให้หนักกระเป๋า',
    terms: 'รับได้ 1–7 วัน · แบตเตอรี่ 2 ก้อน + การ์ด 64GB · นัดรับที่อารีย์หรือส่ง Kerry'
  },
  {
    id: 'tripod-manfrotto', cat: 'crew', title: 'ขาตั้งกล้อง Manfrotto Befree', emoji: '🦿',
    price: 250, deposit: 2000, owner: 'น้องมิ้นท์ บีทีเอสอ่อนนุช', rating: 4.8, reviews: 31,
    location: 'กรุงเทพฯ · อ่อนนุช', tags: ['ขาตั้ง', 'tripod', 'กล้อง'],
    desc: 'ขาตั้งคาร์บอนน้ำหนักเบา พับได้ 43 ซม. รับน้ำหนักได้ 4 กก. พร้อมหัวบอล',
    terms: 'รับได้ 1–5 วัน · หากชำรุดเสียหายหักเงินมัดจำตามจริง'
  },
  {
    id: 'light-studio-kit', cat: 'crew', title: 'ชุดไฟสตูดิโอ 2 ดวง + ฉากขาว', emoji: '💡',
    price: 800, deposit: 3000, owner: 'พี่โอ๊ต สตูดิโอรัชดา', rating: 4.7, reviews: 18,
    location: 'กรุงเทพฯ · รัชดา', tags: ['ไฟ', 'light', 'สตูดิโอ', 'ถ่ายสินค้า'],
    desc: 'Softbox 60x90 สองดวงพร้อมขาตั้งและฉากขาว 2x4 ม. พอสำหรับถ่ายสินค้าขนาดเล็กถึงกลาง',
    terms: 'รับได้ 1–3 วัน · มีบริการติดตั้งในพื้นที่กรุงเทพฯ (+300 บาท)'
  },
  {
    id: 'mic-rode-wireless', cat: 'crew', title: 'ไมโครโฟน Rode Wireless GO II', emoji: '🎙️',
    price: 350, deposit: 2500, owner: 'พี่ฟ้า คอนเทนต์ดี', rating: 5.0, reviews: 27,
    location: 'กรุงเทพฯ · ลาดพร้าว', tags: ['ไมค์', 'ไมโครโฟน', 'วิดีโอ', 'สัมภาษณ์'],
    desc: 'ไมค์ไร้สาย 2 ตัวส่ง 1 รับ บันทึกเสียงในตัว ใช้กับกล้องหรือมือถือได้',
    terms: 'รับได้ 1–5 วัน · ต้องคืนพร้อมกล่องและสายครบชุด'
  },
  {
    id: 'dress-satin-red', cat: 'fashion', title: 'เดรสราตรี Satin สีแดง (S–M)', emoji: '👗',
    price: 450, deposit: 1500, owner: 'คุณแพร สยาม', rating: 4.6, reviews: 22,
    location: 'กรุงเทพฯ · สยาม', tags: ['เดรส', 'ชุดราตรี', 'แฟชั่น', 'งานปาร์ตี้'],
    desc: 'เดรสผ้าซาตินสีแดงเข้ม ทรงมิดชิด ใส่ได้งานเลี้ยงหรือถ่ายพรีเวดดิ้ง',
    terms: 'รับได้ 2–4 วัน · ซักแห้งก่อนคืน · ไซซ์ S–M (รอบอก 32–34 นิ้ว)'
  },
  {
    id: 'bag-chanel-classic', cat: 'fashion', title: 'กระเป๋า Chanel Classic Flap (ของแท้)', emoji: '👜',
    price: 1200, deposit: 20000, owner: 'ร้านลักซ์เชียร์ เอ็มสเฟียร์', rating: 4.9, reviews: 64,
    location: 'กรุงเทพฯ · เอ็มสเฟียร์', tags: ['กระเป๋า', 'แบรนด์เนม', 'แฟชั่น', 'งานแต่ง'],
    desc: 'กระเป๋าแท้พร้อมใบรับรองและกล่อง เหมาะกับงานแต่งงานและอีเวนต์สำคัญ',
    terms: 'รับได้ 1–3 วัน · ต้องยืนยันตัวตนและวางมัดจำเต็มจำนวน · ตรวจสภาพก่อน–หลังรับ'
  },
  {
    id: 'makeup-kit-mac', cat: 'fashion', title: 'ชุดเครื่องสำอาง MAC Pro (ใช้ได้ 1 งาน)', emoji: '💄',
    price: 600, deposit: 2000, owner: 'พี่จอย เมคอัพอาร์ติสต์', rating: 4.5, reviews: 12,
    location: 'กรุงเทพฯ · พญาไท', tags: ['เครื่องสำอาง', 'แต่งหน้า', 'แฟชั่น'],
    desc: 'ชุดเครื่องสำอางมืออาชีพสำหรับงานถ่ายหรืออีเวนต์ พร้อมแปรงและพาเลตต์',
    terms: 'รับได้ 1–2 วัน · อุปกรณ์ทำความสะอาดให้ก่อนคืน'
  },
  {
    id: 'bike-trek-domane', cat: 'sport', title: 'จักรยานเสือหมอบ Trek Domane', emoji: '🚴',
    price: 300, deposit: 3000, owner: 'พี่บอส ไบค์แอนด์บีน', rating: 4.8, reviews: 39,
    location: 'นนทบุรี · เมืองทอง', tags: ['จักรยาน', 'กีฬา', 'ปั่น'],
    desc: 'จักรยานเสือหมอบไซซ์ 54 เหมาะปั่นในเมืองและทริปวันหยุด พร้อมหมวกและไฟ',
    terms: 'รับได้ 1–7 วัน · ต้องมีประสบการณ์ปั่น · หากยางแตกผู้เช่ารับผิดชอบ'
  },
  {
    id: 'basketball-spalding', cat: 'sport', title: 'ลูกบาส Spalding + สแตนด์ติดตั้ง', emoji: '🏀',
    price: 100, deposit: 500, owner: 'พี่เต้ ยิมปากซอย', rating: 4.4, reviews: 7,
    location: 'กรุงเทพฯ · บางนา', tags: ['บาส', 'กีฬา', 'ลูกบอล'],
    desc: 'ลูกบาสซ้อมกลางแจ้งพร้อมสแตนด์แบบถอดประกอบ',
    terms: 'รับได้ 1–3 วัน · คืนพร้อมสูบลม'
  },
  {
    id: 'lightstick-pack', cat: 'party', title: 'แท่งไฟ LED (ชุด 2 อัน)', emoji: '🪩',
    price: 150, deposit: 500, owner: 'น้องข้าวฟาง คอนเสิร์ตคลับ', rating: 4.9, reviews: 88,
    location: 'กรุงเทพฯ · ราชเทวี', tags: ['แท่งไฟ', 'คอนเสิร์ต', 'งานบันเทิง'],
    desc: 'แท่งไฟ LED เปลี่ยนสีได้ 2 อันพร้อมสายคล้อง ใส่คอนเสิร์ตหรือปาร์ตี้',
    terms: 'รับได้ 1–2 วัน · ต้องคืนพร้อมแบตเตอรี่ที่ชาร์จแล้ว'
  },
  {
    id: 'speaker-jbl-partybox', cat: 'party', title: 'ลำโพง JBL PartyBox 310', emoji: '🔊',
    price: 700, deposit: 3000, owner: 'พี่กอล์ฟ ซาวด์ซิสเต็ม', rating: 4.7, reviews: 25,
    location: 'กรุงเทพฯ · บางแค', tags: ['ลำโพง', 'เสียง', 'งานเลี้ยง'],
    desc: 'ลำโพงรุ่นใหญ่ 240 วัตต์ ไฟ LED ต่อไมค์ได้ ใช้ในงานกลางแจ้งได้',
    terms: 'รับได้ 1–3 วัน · มีค่าส่งในเขตกรุงเทพฯ 300 บาท'
  },
  {
    id: 'iphone-14-pro', cat: 'gadget', title: 'iPhone 14 Pro (สำหรับถ่ายคอนเทนต์)', emoji: '📱',
    price: 400, deposit: 10000, owner: 'พี่นัท เทคเรนท์', rating: 4.8, reviews: 51,
    location: 'กรุงเทพฯ · พร้อมพงษ์', tags: ['โทรศัพท์', 'ถ่ายวิดีโอ', 'คอนเทนต์'],
    desc: 'ว่างสำหรับงานถ่าย กล้อง 48MP พร้อมกิมบอลติดมือถือ',
    terms: 'รับได้ 1–7 วัน · ต้องยืนยันตัวตน · ห้ามติดตั้งบัญชี iCloud'
  },
  {
    id: 'projector-epson', cat: 'gadget', title: 'โปรเจกเตอร์ Epson Full HD', emoji: '📽️',
    price: 900, deposit: 5000, owner: 'พี่หนู ริก้าเรนท์', rating: 4.6, reviews: 20,
    location: 'กรุงเทพฯ · ปทุมวัน', tags: ['โปรเจกเตอร์', 'ประชุม', 'หนังกลางแปลง'],
    desc: 'โปรเจกเตอร์ 3000 lumen พร้อมจอ 100 นิ้วและรีโมต',
    terms: 'รับได้ 1–3 วัน · ต้องมีปลั๊กไฟใกล้อุปกรณ์'
  },
  {
    id: 'table-folding-180', cat: 'general', title: 'โต๊ะพับ 1.8 ม. (ชุด 10 ตัว)', emoji: '🪑',
    price: 80, deposit: 300, owner: 'พี่แอน อีเวนต์ซัพพลาย', rating: 4.5, reviews: 16,
    location: 'ปทุมธานี · รังสิต', tags: ['โต๊ะ', 'งานอีเวนต์', 'ของใช้'],
    desc: 'โต๊ะพับขาเหล็ก 10 ตัว เหมาะงานแจกของ งานบุญ และงานโรงเรียน',
    terms: 'รับได้ 1–3 วัน · ค่าขนส่งขึ้นกับพื้นที่'
  },
  {
    id: 'chair-ergonomic', cat: 'general', title: 'เก้าอี้ทำงาน Ergonomic', emoji: '💺',
    price: 120, deposit: 1000, owner: 'น้องเพชร เวิร์กฟรอมโฮม', rating: 4.7, reviews: 9,
    location: 'ขอนแก่น · เมือง', tags: ['เก้าอี้', 'ทำงาน', 'ของใช้'],
    desc: 'เก้าอี้ปรับระดับได้ มีที่รองเอว เหมาะกับช่วงทำงานจากบ้าน',
    terms: 'รับได้ 3–30 วัน · ส่งถึงบ้านในเขตเมืองขอนแก่น'
  },
  {
    id: 'tent-4p', cat: 'general', title: 'เต็นท์แคมป์ปิ้ง 4 คน', emoji: '⛺',
    price: 350, deposit: 1500, owner: 'พี่ตูน แคมป์คลับ', rating: 4.8, reviews: 33,
    location: 'เชียงใหม่ · นิมมาน', tags: ['เต็นท์', 'แคมป์ปิ้ง', 'ท่องเที่ยว'],
    desc: 'เต็นท์กันน้ำ 2 ชั้น 4 คน พร้อมผ้าปูและตะเกียงพกพา',
    terms: 'รับได้ 2–5 วัน · ต้องคืนแบบตากแห้ง'
  }
];

/* ผูกไฟล์รูปเข้ากับสินค้าแต่ละชิ้น (ใช้ทั้งตอน seed และตอน migrate ข้อมูลเดิม) */
ITEMS.forEach(function (item) {
  if (!Array.isArray(item.images)) item.images = ITEM_IMAGES[item.id] || [];
});

function iso(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function dayString(offsetDays) {
  return new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
}

/* ประกาศหางานตั้งต้น — แยกเป็นฟังก์ชันเพื่อใช้ migrate ฐานข้อมูลเดิมได้ */
function seedJobs() {
  return [
    {
      id: 'job-1', title: 'ต้องการ Grip ประจำกอง 2 วัน (ถ่ายโฆษณา)', cat: 'grip', rate: 900, days: 2,
      start: dayString(3), location: 'กรุงเทพฯ · บางกะปิ',
      desc: 'ต้องยกไฟและขาตั้งได้ มีประสบการณ์บนกองถ่าย เริ่ม 08:00 น. มีรถรับส่งจาก MRTA',
      name: 'ทีมโปรดักชัน บี', userId: 'u-owner', status: 'open', createdAt: iso(-2 * DAY)
    },
    {
      id: 'job-2', title: 'หา Catering งานถ่าย MV 1 วัน', cat: 'catering', rate: 400, days: 1,
      start: dayString(5), location: 'กรุงเทพฯ · ลาดพร้าว',
      desc: 'ทีมถ่าย 12 คน ต้องการข้าวกลางวัน น้ำ และของว่างบ่าย (1 วัน/400 บาทต่อคน)',
      name: 'เดโม่ ผู้เช่ามือใหม่', userId: 'u-demo', status: 'open', createdAt: iso(-1 * DAY)
    },
    {
      id: 'job-3', title: 'รับคนเขียนเว็บไซต์ แก้หน้า landing page', cat: 'web-dev', rate: 2500, days: 1,
      start: dayString(7), location: 'ทำงานจากที่ไหนก็ได้',
      desc: 'แก้หน้า landing page ที่มีอยู่ 3 ส่วน เพิ่มฟอร์มติดต่อ และทำ responsive ให้มือถือ',
      name: 'ทีมโปรดักชัน บี', userId: 'u-owner', status: 'open', createdAt: iso(-4 * DAY)
    }
  ];
}

function build() {
  const now = Date.now();
  const demo = isDemoMode();
  const admin = envAdmin();

  const users = [];
  if (admin) {
    users.push(admin);
  } else if (demo) {
    users.push({
      id: 'u-admin', name: 'ผู้ดูแล FLO-RENT', email: 'admin@flo-rent.co',
      passHash: hashPassword('admin1234'), role: 'admin', status: 'active',
      phone: '02-000-0000', age: 30, location: 'กรุงเทพฯ', avatar: '🛠️',
      bio: 'ทีมงาน FLO-RENT ดูแลประกาศและการจอง', rating: 5, reviews: 0,
      wallet: 2000, credit: 90,
      joinedAt: iso(-200 * DAY)
    });
  } else {
    console.warn('[seed] ไม่มีบัญชีแอดมิน: ตั้ง FLO_ADMIN_EMAIL และ FLO_ADMIN_PASSWORD ก่อนใช้งาน production');
  }

  if (demo) {
    users.push(
      {
        id: 'u-demo', name: 'เดโม่ ผู้เช่ามือใหม่', email: 'demo@flo-rent.co',
        passHash: hashPassword('demo1234'), role: 'user', status: 'active',
        phone: '081-234-5678', age: 22, location: 'กรุงเทพฯ · อารีย์', avatar: '🐥',
        bio: 'ชอบเช่าของใช้ครั้งเดียวจบ มากกว่าซื้อเก็บไว้', rating: 4.9, reviews: 6,
        wallet: 2200, credit: 78,
        joinedAt: iso(-96 * DAY)
      },
      {
        id: 'u-owner', name: 'พี่กันต์ สตูดิโอกลางซอย', email: 'owner@flo-rent.co',
        passHash: hashPassword('owner1234'), role: 'user', status: 'active',
        phone: '089-555-1212', age: 34, location: 'กรุงเทพฯ · อารีย์', avatar: '🎬',
        bio: 'ปล่อยกล้องและอุปกรณ์ออกกองให้คนทำงานสร้างสรรค์', rating: 4.9, reviews: 42,
        wallet: 8000, credit: 92,
        joinedAt: iso(-140 * DAY)
      }
    );
  }

  const items = ITEMS.map(function (item, index) {
    return Object.assign({
      ownerId: 'u-owner',
      status: 'published',
      createdAt: iso(-(index + 1) * DAY)
    }, item);
  });

  const bookings = [
    {
      code: 'FLR-DEMO2', itemId: 'projector-epson', itemTitle: 'โปรเจกเตอร์ Epson Full HD',
      itemCat: 'gadget', itemEmoji: '📽️',
      owner: 'พี่หนู ริก้าเรนท์', ownerId: 'u-owner', userId: 'u-demo', userName: 'เดโม่ ผู้เช่ามือใหม่',
      status: 'active', start: dayString(0), end: dayString(2), days: 2,
      dayPrice: 900, deposit: 5000, total: 6800, createdAt: iso(-1 * DAY)
    },
    {
      code: 'FLR-DEMO1', itemId: 'cam-sony-a7iii', itemTitle: 'กล้อง Sony A7 III + เลนส์ 28-70',
      itemCat: 'crew', itemEmoji: '📷',
      owner: 'พี่กันต์ สตูดิโอกลางซอย', ownerId: 'u-owner', userId: 'u-demo', userName: 'เดโม่ ผู้เช่ามือใหม่',
      status: 'returned', start: dayString(-12), end: dayString(-10), days: 2,
      dayPrice: 1500, deposit: 8000, total: 11000, createdAt: iso(-13 * DAY), returnedAt: iso(-10 * DAY)
    }
  ];

  const requests = [
    {
      id: 'rq-1', want: 'ตามหาเดรสราตรีสีแดง ไซซ์ S', cat: 'fashion', budget: 500,
      when: '20 ธ.ค.', name: 'น้องฟ้า', userId: 'u-demo', createdAt: iso(-2 * DAY)
    },
    {
      id: 'rq-2', want: 'ตามหากล้อง 4K + ไมค์ 2 ตัว สำหรับคอนเสิร์ต 3 วัน', cat: 'crew', budget: 2000,
      when: '2–4 ม.ค.', name: 'ทีมโปรดักชัน บี', userId: 'u-owner', createdAt: iso(-3 * DAY)
    },
    {
      id: 'rq-3', want: 'ตามหาแท่งไฟและป้ายไฟชื่อ สำหรับงานเปิดตัว', cat: 'party', budget: 300,
      when: '12 ธ.ค.', name: 'พี่จูน', userId: null, createdAt: iso(-4 * DAY)
    }
  ];

  /* กระเป๋าเงิน: รายการเดินบัญชีตั้งต้น ให้หน้า wallet/logs ของแอดมินมีข้อมูล */
  const ledger = [
    {
      id: 'tx-admin-welcome', userId: 'u-admin', userName: 'ผู้ดูแล FLO-RENT', type: 'topup', amount: 2000,
      balanceAfter: 2000, note: 'เครดิตต้อนรับทีมงาน', ref: '', createdAt: iso(-200 * DAY)
    },
    {
      id: 'tx-demo-welcome', userId: 'u-demo', userName: 'เดโม่ ผู้เช่ามือใหม่', type: 'topup', amount: 12000,
      balanceAfter: 12000, note: 'เติมเงินเข้า FLO-RENT Wallet', ref: '', createdAt: iso(-13 * DAY)
    },
    {
      id: 'tx-demo-hold1', userId: 'u-demo', userName: 'เดโม่ ผู้เช่ามือใหม่', type: 'hold', amount: -11000,
      balanceAfter: 1000, note: 'กันเงินค่าเช่า + มัดจำ · กล้อง Sony A7 III', ref: 'FLR-DEMO1', createdAt: iso(-13 * DAY)
    },
    {
      id: 'tx-demo-release1', userId: 'u-demo', userName: 'เดโม่ ผู้เช่ามือใหม่', type: 'deposit-release', amount: 8000,
      balanceAfter: 9000, note: 'คืนมัดจำ · FLR-DEMO1', ref: 'FLR-DEMO1', createdAt: iso(-10 * DAY)
    },
    {
      id: 'tx-owner-payout1', userId: 'u-owner', userName: 'พี่กันต์ สตูดิโอกลางซอย', type: 'payout', amount: 3000,
      balanceAfter: 8000, note: 'ค่าเช่า · FLR-DEMO1', ref: 'FLR-DEMO1', createdAt: iso(-10 * DAY)
    },
    {
      id: 'tx-owner-welcome', userId: 'u-owner', userName: 'พี่กันต์ สตูดิโอกลางซอย', type: 'topup', amount: 5000,
      balanceAfter: 5000, note: 'เติมเงินเข้า FLO-RENT Wallet', ref: '', createdAt: iso(-140 * DAY)
    },
    {
      id: 'tx-demo-hold2', userId: 'u-demo', userName: 'เดโม่ ผู้เช่ามือใหม่', type: 'hold', amount: -6800,
      balanceAfter: 2200, note: 'กันเงินค่าเช่า + มัดจำ · โปรเจกเตอร์ Epson', ref: 'FLR-DEMO2', createdAt: iso(-1 * DAY)
    }
  ];

  const holds = [
    {
      id: 'hd-demo2', bookingCode: 'FLR-DEMO2', renterId: 'u-demo', ownerId: 'u-owner',
      rent: 1800, deposit: 5000, status: 'held', createdAt: iso(-1 * DAY)
    }
  ];

  const jobs = seedJobs();

  const logs = [
    {
      id: 'lg-seed-1', action: 'wallet.hold',
      detail: 'กันเงิน 6,800 FLO สำหรับการจอง FLR-DEMO2 (เดโม่ ผู้เช่ามือใหม่)',
      actorId: 'u-demo', actorName: 'เดโม่ ผู้เช่ามือใหม่', ref: 'FLR-DEMO2', at: iso(-1 * DAY)
    },
    {
      id: 'lg-seed-2', action: 'wallet.settle',
      detail: 'คืนมัดจำ 8,000 FLO · จ่ายค่าเช่า 3,000 FLO (FLR-DEMO1)',
      actorId: 'u-demo', actorName: 'เดโม่ ผู้เช่ามือใหม่', ref: 'FLR-DEMO1', at: iso(-10 * DAY)
    }
  ];

  return {
    version: 1,
    users: users,
    sessions: [],
    otps: [],
    items: demo ? items : [],
    bookings: demo ? bookings : [],
    requests: demo ? requests : [],
    jobs: demo ? jobs : [],
    workers: demo ? WORKERS : [],
    hires: [],
    ledger: demo ? ledger : [],
    holds: demo ? holds : [],
    logs: demo ? logs : [],
    meta: { seededAt: new Date(now).toISOString(), name: 'FLO-RENT', demo: demo }
  };
}

module.exports = { build, isDemoMode, CATEGORIES, ITEM_IMAGES, JOB_CATEGORIES, WORKERS, seedJobs };
