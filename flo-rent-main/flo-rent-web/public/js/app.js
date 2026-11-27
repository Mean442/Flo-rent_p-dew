/* FLO-RENT — ตรรกะหน้าเว็บ (ทำงานร่วมกับ API ที่ server/server.js) */
(function () {
  'use strict';

  var API = window.FLO_API;
  var CATS = window.FLO_CATEGORIES || [];
  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var AVATARS = ['🐥', '🙂', '🐱', '🦊', '🐼', '🌻', '🎧', '📷', '👗', '🪩'];
  var sessionUser = null;

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) { return ESC_MAP[ch]; });
  }

  function baht(number) {
    return '฿' + Number(number || 0).toLocaleString('th-TH');
  }

  function flo(number) {
    return 'FLO ' + Number(number || 0).toLocaleString('th-TH');
  }

  /* รูปที่ผู้ใช้อัปโหลด: ย่อขนาดในเบราว์เซอร์แล้วส่งเป็น data URL */
  function readPhoto(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var image = new Image();
        image.onload = function () {
          var max = 1200;
          var scale = Math.min(1, max / Math.max(image.width, image.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(image.width * scale);
          canvas.height = Math.round(image.height * scale);
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        image.onerror = function () { reject(new Error('อ่านรูปไม่สำเร็จ')); };
        image.src = String(reader.result);
      };
      reader.onerror = function () { reject(new Error('อ่านไฟล์ไม่สำเร็จ')); };
      reader.readAsDataURL(file);
    });
  }

  function verifyNeededHtml(message) {
    return '<div class="form-card" style="margin-top:16px">' +
      '<h2 style="font-size:20px">ต้องยืนยันตัวตนก่อนทำธุรกรรม</h2>' +
      '<p class="muted">' + esc(message || 'แนบเลขบัตรประชาชนและรูปบัตรเพื่อให้แอดมินตรวจสอบ') + '</p>' +
      '<p class="fine-print">เราเก็บเลขบัตรแบบเข้ารหัส/ปกปิด และลบรูปบัตรภายใน 30 วันหลังตรวจ</p>' +
      '<a class="btn btn-maroon" href="profile.html#verify">ไปยืนยันตัวตน →</a>' +
    '</div>';
  }

  function showVerifyNeeded(err, container) {
    if (!err || !err.data || err.data.code !== 'NEED_VERIFY') return false;
    toast(err.message);
    if (container) container.innerHTML = verifyNeededHtml(err.message);
    return true;
  }

  var TX_LABELS = {
    topup: 'เติมเงิน',
    hold: 'กันเงินจอง',
    refund: 'คืนเงิน',
    'deposit-release': 'คืนมัดจำ',
    payout: 'รับค่าเช่า',
    hire: 'จ่ายค่าจ้าง'
  };

  /* หมวดหมู่จริงมาจาก API (แอดมินแก้ไขได้) — data.js เป็นค่าเริ่มต้นถ้าโหลดไม่สำเร็จ */
  async function loadCategories() {
    try {
      var data = await API.get('/categories');
      if (data.categories && data.categories.length) {
        CATS = data.categories;
        window.FLO_CATEGORIES = data.categories;
      }
    } catch (err) { /* ใช้ค่าเริ่มต้น */ }
  }

  function catOf(key) {
    for (var i = 0; i < CATS.length; i += 1) {
      if (CATS[i].key === key) return CATS[i];
    }
    return { key: 'general', name: 'อุปกรณ์ทั่วไป', emoji: '📦', num: '06', sub: '' };
  }

  function param(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
  }

  function thDate(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  }

  function isoDay(offset) {
    return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  }

  function currentPage() {
    return window.location.pathname.split('/').pop() + window.location.search;
  }

  function requireLogin() {
    window.location.href = 'login.html?next=' + encodeURIComponent(currentPage());
  }

  function goNext(fallback) {
    var next = param('next');
    if (next && /^[a-z0-9._-]+\.html(\?.*)?$/i.test(next)) {
      window.location.href = next;
      return;
    }
    window.location.href = fallback;
  }

  function handleAuth(err) {
    if (err && err.status === 401) {
      API.setToken('');
      sessionUser = null;
      return true;
    }
    return false;
  }

  /* ---------- UI ชิ้นเล็ก ---------- */

  function toast(message, kind) {
    var stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    var node = document.createElement('div');
    node.className = 'toast' + (kind === 'ok' ? ' toast-ok' : '');
    node.textContent = message;
    stack.appendChild(node);
    window.setTimeout(function () { node.remove(); }, 4200);
  }

  function showError(err) {
    if (handleAuth(err)) return;
    toast(err && err.message ? err.message : 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
  }

  /* เก็บข้อความแจ้งเตือนข้ามหน้า (เข้าสู่ระบบ/ออกจากระบบมีการเปลี่ยนหน้า) */
  var FLASH_KEY = 'florent_flash_v1';

  function setFlash(message) {
    try { sessionStorage.setItem(FLASH_KEY, message); } catch (err) { /* โหมดส่วนตัวอาจเขียนไม่ได้ */ }
  }

  function showFlash() {
    var message = '';
    try {
      message = sessionStorage.getItem(FLASH_KEY) || '';
      sessionStorage.removeItem(FLASH_KEY);
    } catch (err) { return; }
    if (message) toast(message, 'ok');
  }

  /* อัปเดตยอดในเมนูหัวเว็บหลังเติมเงิน/จอง */
  function paintWalletChip() {
    var link = document.querySelector('.account-nav a[href="wallet.html"]');
    if (link && sessionUser) link.textContent = 'กระเป๋าเงิน ' + flo(sessionUser.wallet);
  }

  /* dialog ยืนยันแบบเข้ากับธีม (แทน window.confirm) */
  function confirmDialog(config) {
    var opts = typeof config === 'string' ? { message: config } : (config || {});
    return new Promise(function (resolve) {
      var dlg = document.createElement('dialog');
      dlg.className = 'confirm-dialog';
      dlg.innerHTML = '' +
        '<p class="eyebrow">' + esc(opts.eyebrow || 'ยืนยันการทำรายการ') + '</p>' +
        '<h2 class="display display-sm" style="font-size:24px">' + esc(opts.title || 'ยืนยัน?') + '</h2>' +
        '<p class="confirm-text">' + esc(opts.message || '') + '</p>' +
        '<div class="confirm-actions">' +
          '<button class="btn btn-ghost" type="button" data-confirm="no">' + esc(opts.cancelText || 'ยกเลิก') + '</button>' +
          '<button class="btn btn-maroon" type="button" data-confirm="yes">' + esc(opts.confirmText || 'ยืนยัน') + '</button>' +
        '</div>';

      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        if (dlg.open) dlg.close();
        dlg.remove();
        resolve(value);
      }

      dlg.addEventListener('click', function (event) {
        if (event.target === dlg) { finish(false); return; }
        var btn = event.target.closest('[data-confirm]');
        if (btn) finish(btn.getAttribute('data-confirm') === 'yes');
      });
      dlg.addEventListener('cancel', function (event) {
        event.preventDefault();
        finish(false);
      });

      document.body.appendChild(dlg);
      dlg.showModal();
      var cancelBtn = dlg.querySelector('[data-confirm="no"]');
      if (cancelBtn) cancelBtn.focus();
    });
  }

  /* ถามข้อความสั้น ๆ ด้วย <dialog> (แทน window.prompt ที่บล็อกหน้าและคุมสไตล์ไม่ได้) */
  function promptDialog(config) {
    var opts = config || {};
    return new Promise(function (resolve) {
      var dlg = document.createElement('dialog');
      dlg.className = 'confirm-dialog';
      dlg.innerHTML = '' +
        '<form method="dialog" class="confirm-box">' +
          '<p class="eyebrow">' + esc(opts.eyebrow || 'ระบุรายละเอียด') + '</p>' +
          '<h2 class="display display-sm" style="font-size:22px">' + esc(opts.title || '') + '</h2>' +
          '<p class="confirm-text">' + esc(opts.message || '') + '</p>' +
          '<label class="field"><span>' + esc(opts.label || 'รายละเอียด') + '</span>' +
            '<textarea id="prompt-input" required minlength="2" maxlength="300" style="min-height:90px"></textarea></label>' +
          '<div class="confirm-actions">' +
            '<button class="btn btn-ghost" type="button" data-prompt="no">ยกเลิก</button>' +
            '<button class="btn btn-maroon" type="submit" data-prompt="yes">' + esc(opts.confirmText || 'ยืนยัน') + '</button>' +
          '</div>' +
        '</form>';

      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        if (dlg.open) dlg.close();
        dlg.remove();
        resolve(value);
      }

      dlg.addEventListener('click', function (event) {
        if (event.target === dlg) { finish(null); return; }
        var btn = event.target.closest('[data-prompt]');
        if (btn && btn.getAttribute('data-prompt') === 'no') finish(null);
      });
      dlg.addEventListener('cancel', function (event) {
        event.preventDefault();
        finish(null);
      });
      dlg.querySelector('form').addEventListener('submit', function (event) {
        event.preventDefault();
        var input = dlg.querySelector('#prompt-input');
        var value = String(input.value || '').trim();
        if (value.length < 2) { input.focus(); return; }
        finish(value);
      });

      document.body.appendChild(dlg);
      dlg.showModal();
      dlg.querySelector('#prompt-input').focus();
    });
  }

  function loginPrompt(title, message) {
    return '' +
      '<div class="empty">' +
        '<h1 class="display display-sm">' + esc(title) + '</h1>' +
        '<p class="muted">' + esc(message || 'เข้าสู่ระบบเพื่อดูข้อมูลบัญชี ประวัติการจอง และประกาศของคุณ') + '</p>' +
        '<a class="btn btn-cream" href="login.html?next=' + encodeURIComponent(currentPage()) + '">เข้าสู่ระบบ / สมัครสมาชิก</a>' +
      '</div>';
  }

  /* ---------- รูปสินค้า ---------- */

  function itemImages(item) {
    var list = item && Array.isArray(item.images) ? item.images : [];
    return list.filter(function (src) { return typeof src === 'string' && src; });
  }

  function thumbInner(item, extraClass) {
    var images = itemImages(item);
    if (images.length) {
      return '<img class="thumb-img ' + esc(extraClass || '') + '" src="' + esc(images[0]) + '" alt="' + esc(item.title) + '" loading="lazy">';
    }
    return '<span class="thumb-emoji" aria-hidden="true">' + esc(item.emoji) + '</span>';
  }

  function thumbsStrip(item) {
    var images = itemImages(item);
    if (images.length < 2) return '';
    return '<div class="detail-gallery" id="detail-gallery">' + images.map(function (src, index) {
      return '<button type="button" class="gallery-thumb' + (index === 0 ? ' is-active' : '') + '" data-src="' + esc(src) + '">' +
        '<img src="' + esc(src) + '" alt="รูปที่ ' + (index + 1) + '"></button>';
    }).join('') + '</div>';
  }

  function itemCard(item) {
    var cat = catOf(item.cat);
    return '' +
      '<a class="item-card" href="item.html?id=' + encodeURIComponent(item.id) + '">' +
        '<div class="thumb thumb-' + esc(item.cat) + '">' +
          thumbInner(item) +
          '<span class="chip chip-light">' + esc(cat.name) + '</span>' +
          (item.status === 'hidden' ? '<span class="chip">ซ่อนอยู่</span>' : '') +
        '</div>' +
        '<div class="item-body">' +
          '<h3 class="item-title">' + esc(item.title) + '</h3>' +
          '<p class="item-meta">' + esc(item.owner) + ' · <span class="stars">★ ' +
            Number(item.rating || 0).toFixed(1) + '</span> <span class="muted">(' + Number(item.reviews || 0) + ')</span></p>' +
          '<p class="item-price"><strong>' + baht(item.price) + '</strong><span>/วัน</span></p>' +
          '<p class="item-fine">มัดจำ ' + baht(item.deposit) + ' · ' + esc(item.location) + '</p>' +
        '</div>' +
      '</a>';
  }

  function renderCards(target, items) {
    if (!target) return;
    target.innerHTML = items.map(itemCard).join('');
  }

  /* ---------- แผนที่ปักหมุด ---------- */

  function pinIcon() {
    return window.L.divIcon({
      className: 'pin-marker',
      html: '<span aria-hidden="true">📍</span>',
      iconSize: [28, 28],
      iconAnchor: [14, 26]
    });
  }

  /* วาดแผนที่ OpenStreetMap + หมุด (editable = คลิก/ลากเพื่อย้ายหมุดได้) */
  function createPinMap(container, config) {
    var opts = config || {};
    if (!container) return null;
    if (!window.L) {
      container.innerHTML = '<p class="field-hint">โหลดแผนที่ไม่สำเร็จ — ตรวจสอบการเชื่อมต่อแล้วลองใหม่</p>';
      return null;
    }

    var editable = !!opts.editable;
    var hasPin = typeof opts.lat === 'number' && typeof opts.lng === 'number';
    var center = hasPin ? [opts.lat, opts.lng] : [13.7563, 100.5018];
    var map = window.L.map(container, { scrollWheelZoom: editable }).setView(center, hasPin ? 15 : 11);

    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);

    var marker = null;

    function place(lat, lng) {
      if (!marker) {
        marker = window.L.marker([lat, lng], { draggable: editable, icon: pinIcon() }).addTo(map);
        if (editable) {
          marker.on('dragend', function () {
            var pos = marker.getLatLng();
            if (opts.onPick) opts.onPick(pos);
          });
        }
        return;
      }
      marker.setLatLng([lat, lng]);
    }

    if (hasPin) place(opts.lat, opts.lng);

    if (editable) {
      map.on('click', function (event) {
        place(event.latlng.lat, event.latlng.lng);
        if (opts.onPick) opts.onPick(event.latlng);
      });
    }

    window.setTimeout(function () { map.invalidateSize(); }, 0);
    return map;
  }

  /* ---------- ปฏิทินสถานะสินค้า ---------- */

  var THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var THAI_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

  function pad2(num) { return num < 10 ? '0' + num : String(num); }

  function dayKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function todayKey() { return dayKey(new Date()); }

  /* selected = วันที่ไม่ว่าง (YYYY-MM-DD) · readOnly = ดูอย่างเดียว */
  function createCalendar(container, config) {
    if (!container) return null;
    var opts = config || {};
    var selected = new Set(opts.selected || []);
    var minDay = opts.minDay || '';
    var readOnly = !!opts.readOnly;
    var today = new Date();
    var month = opts.month || new Date(today.getFullYear(), today.getMonth(), 1);
    var cursor = new Date(month.getFullYear(), month.getMonth(), 1);

    function list() { return Array.from(selected).sort(); }

    function paint() {
      var year = cursor.getFullYear();
      var monthIndex = cursor.getMonth();
      var startOffset = new Date(year, monthIndex, 1).getDay();
      var daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
      var cells = [];
      var i;

      for (i = 0; i < startOffset; i += 1) cells.push('<span class="cal-day is-empty"></span>');
      for (i = 1; i <= daysInMonth; i += 1) {
        var key = year + '-' + pad2(monthIndex + 1) + '-' + pad2(i);
        var busy = selected.has(key);
        var past = !!minDay && key < minDay;
        cells.push('<button type="button" class="cal-day' + (busy ? ' is-busy' : '') + (past ? ' is-past' : '') + '"' +
          ' data-day="' + key + '"' + (readOnly || past ? ' disabled' : '') +
          ' aria-pressed="' + (busy ? 'true' : 'false') + '">' + i + '</button>');
      }

      container.innerHTML = '' +
        '<div class="cal-head">' +
          '<button type="button" class="cal-nav" data-cal-nav="-1" aria-label="เดือนก่อนหน้า">‹</button>' +
          '<strong>' + THAI_MONTHS[monthIndex] + ' ' + (year + 543) + '</strong>' +
          '<button type="button" class="cal-nav" data-cal-nav="1" aria-label="เดือนถัดไป">›</button>' +
        '</div>' +
        '<div class="cal-grid">' +
          THAI_DOW.map(function (dow) { return '<span class="cal-dow">' + dow + '</span>'; }).join('') +
          cells.join('') +
        '</div>' +
        '<div class="cal-legend">' +
          '<span><i class="cal-dot"></i> ว่าง</span>' +
          '<span><i class="cal-dot is-busy"></i> ไม่ว่าง' + (readOnly ? '' : ' (คลิกเพื่อสลับ)') + '</span>' +
        '</div>';
    }

    container.addEventListener('click', function (event) {
      var nav = event.target.closest('[data-cal-nav]');
      if (nav) {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + Number(nav.getAttribute('data-cal-nav')), 1);
        paint();
        return;
      }

      var day = event.target.closest('[data-day]');
      if (!day || readOnly || day.disabled) return;

      var key = day.getAttribute('data-day');
      if (selected.has(key)) selected.delete(key); else selected.add(key);
      paint();
      if (opts.onChange) opts.onChange(list());
    });

    paint();

    return {
      list: list,
      setMinDay: function (day) {
        minDay = day || '';
        list().forEach(function (key) { if (minDay && key < minDay) selected.delete(key); });
        paint();
        if (opts.onChange) opts.onChange(list());
      }
    };
  }

  /* ปฏิทินเลือกช่วงวันแบบลาก — ใช้เลือกวันเริ่มเช่า/วันคืน */
  function createRangeCalendar(container, config) {
    if (!container) return null;
    var opts = config || {};
    var blockedDays = new Set(opts.blocked || []);
    var minDay = opts.minDay || '';
    var now = new Date();
    var cursor = new Date(now.getFullYear(), now.getMonth(), 1);
    var pending = null;
    var hover = null;
    var start = null;
    var end = null;
    var dragging = false;

    function isBlocked(key) {
      if (minDay && key < minDay) return true;
      return blockedDays.has(key);
    }

    function currentRange() {
      if (pending && hover) return pending <= hover ? [pending, hover] : [hover, pending];
      if (start && end) return [start, end];
      if (pending) return [pending, pending];
      return null;
    }

    /* ตรวจวันในลิสต์ไม่ว่าง (นับวันเช่า ตั้งแต่ start ถึงก่อนวันคืน) */
    function rangeHasBlocked(from, to) {
      var lo = from <= to ? from : to;
      var hi = from <= to ? to : from;
      var day = new Date(lo + 'T00:00:00');
      var stop = new Date(hi + 'T00:00:00');
      while (day < stop) {
        if (isBlocked(dayKey(day))) return true;
        day = new Date(day.getTime() + 86400000);
      }
      return false;
    }

    function commit(from, to) {
      var lo = from <= to ? from : to;
      var hi = from <= to ? to : from;
      if (lo === hi) {
        if (opts.onInvalid) opts.onInvalid('เลือกวันคืนให้หลังวันเริ่มเช่า (อย่างน้อย 1 คืน)');
        return false;
      }
      if (rangeHasBlocked(lo, hi)) {
        pending = null;
        hover = null;
        if (opts.onInvalid) opts.onInvalid('ช่วงนี้มีวันที่ไม่ว่างอยู่ — เลือกช่วงใหม่');
        return false;
      }
      start = lo;
      end = hi;
      pending = null;
      hover = null;
      if (opts.onSelect) opts.onSelect(start, end);
      return true;
    }

    function paint() {
      var range = currentRange();
      var year = cursor.getFullYear();
      var monthIndex = cursor.getMonth();
      var startOffset = new Date(year, monthIndex, 1).getDay();
      var daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
      var cells = [];
      var i;

      for (i = 0; i < startOffset; i += 1) cells.push('<span class="cal-day is-empty"></span>');
      for (i = 1; i <= daysInMonth; i += 1) {
        var key = year + '-' + pad2(monthIndex + 1) + '-' + pad2(i);
        var blockedDay = isBlocked(key);
        var cls = 'cal-day';
        if (blockedDay) cls += ' is-blocked';
        if (range && key >= range[0] && key <= range[1]) {
          cls += ' is-selected';
          if (key === range[0]) cls += ' is-range-start';
          if (key === range[1]) cls += ' is-range-end';
        }
        cells.push('<button type="button" class="' + cls + '" data-day="' + key + '"' +
          (blockedDay ? ' disabled' : '') + '>' + i + '</button>');
      }

      container.innerHTML = '' +
        '<div class="cal-head">' +
          '<button type="button" class="cal-nav" data-cal-nav="-1" aria-label="เดือนก่อนหน้า">‹</button>' +
          '<strong>' + THAI_MONTHS[monthIndex] + ' ' + (year + 543) + '</strong>' +
          '<button type="button" class="cal-nav" data-cal-nav="1" aria-label="เดือนถัดไป">›</button>' +
        '</div>' +
        '<div class="cal-grid">' +
          THAI_DOW.map(function (dow) { return '<span class="cal-dow">' + dow + '</span>'; }).join('') +
          cells.join('') +
        '</div>' +
        '<div class="cal-legend">' +
          '<span><i class="cal-dot"></i> ว่าง</span>' +
          '<span><i class="cal-dot is-selected"></i> ช่วงที่เลือก</span>' +
          '<span><i class="cal-dot is-blocked"></i> ไม่ว่าง</span>' +
        '</div>';
    }

    container.addEventListener('pointerdown', function (event) {
      var nav = event.target.closest('[data-cal-nav]');
      if (nav) {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + Number(nav.getAttribute('data-cal-nav')), 1);
        paint();
        return;
      }

      var day = event.target.closest('[data-day]');
      if (!day || day.disabled) return;
      event.preventDefault();

      var key = day.getAttribute('data-day');
      if (pending && key !== pending) {
        commit(pending, key);
        paint();
        dragging = false;
        return;
      }

      pending = key;
      hover = key;
      dragging = true;
      paint();
    });

    container.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var day = event.target.closest('[data-day]');
      if (!day || day.disabled) return;
      var key = day.getAttribute('data-day');
      if (hover === key) return;
      hover = key;
      paint();
    });

    window.addEventListener('pointerup', function () {
      if (!dragging) return;
      dragging = false;
      if (pending && hover && hover !== pending) {
        commit(pending, hover);
        paint();
      }
    });

    if (opts.start && opts.end && opts.start < opts.end && !isBlocked(opts.start) && !rangeHasBlocked(opts.start, opts.end)) {
      start = opts.start;
      end = opts.end;
      if (opts.onSelect) opts.onSelect(start, end);
    }

    paint();

    return { selection: function () { return { start: start, end: end }; } };
  }

  function bootHelp() {
    var overlay = document.createElement('div');
    overlay.className = 'boot-overlay';
    overlay.innerHTML = '' +
      '<div class="boot-card">' +
        '<p class="eyebrow">ต้องเปิดผ่านเซิร์ฟเวอร์</p>' +
        '<h1>FLO-RENT ใช้ backend</h1>' +
        '<p>หน้านี้ถูกเปิดจากไฟล์โดยตรง (file://) จึงติดต่อ API ไม่ได้ เปิด terminal ในโฟลเดอร์โปรเจกต์แล้วรัน:</p>' +
        '<code>npm start</code>' +
        '<p>จากนั้นเปิด <strong>http://127.0.0.1:4173</strong> — ต้องมี Node.js 18 ขึ้นไป (ไม่ต้องติดตั้ง dependency เพิ่ม)</p>' +
      '</div>';
    document.body.appendChild(overlay);
  }

  /* ---------- เปลือกเว็บมือถือ: เมนูล่าง + เมนูพับ (เฟส A) ---------- */

  var MOBILE_NAV = [
    { href: 'index.html', label: 'หน้าแรก', icon: '🏠' },
    { href: 'browse.html', label: 'ค้นหา', icon: '🔍', also: ['item.html'] },
    { href: 'post.html', label: 'ลงประกาศ', icon: '＋', accent: true },
    { href: 'bookings.html', label: 'การจอง', icon: '🗓️', needLogin: true },
    { href: 'profile.html', label: 'บัญชี', icon: '👤', needLogin: true }
  ];

  function currentFile() {
    return window.location.pathname.split('/').pop() || 'index.html';
  }

  /* การ์ดโครงร่างระหว่างรอข้อมูล — ขนาดใกล้เคียง item-card จริง */
  function skeletonCards(count) {
    var card = '<div class="sk-card" aria-hidden="true">' +
      '<div class="sk sk-thumb"></div>' +
      '<div class="sk-body">' +
        '<span class="sk sk-line w-70"></span>' +
        '<span class="sk sk-line w-45"></span>' +
        '<span class="sk sk-line w-30"></span>' +
      '</div>' +
    '</div>';
    return new Array(count + 1).join(card);
  }

  function detailSkeleton() {
    return '' +
      '<div class="sk-detail" aria-hidden="true">' +
        '<div class="sk-detail-main">' +
          '<div class="sk sk-hero"></div>' +
          '<span class="sk sk-line w-70"></span>' +
          '<span class="sk sk-line w-40"></span>' +
          '<span class="sk sk-line"></span>' +
          '<span class="sk sk-line"></span>' +
          '<span class="sk sk-line w-60"></span>' +
        '</div>' +
        '<div class="sk sk-booking"></div>' +
      '</div>';
  }

  function paintMobileShell() {
    var header = document.querySelector('.site-header .header-inner');
    if (!header) return;
    var file = currentFile();

    if (!header.querySelector('.nav-toggle')) {
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'nav-toggle';
      toggle.setAttribute('aria-label', 'เปิดเมนูทั้งหมด');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', 'mobile-menu');
      toggle.innerHTML = '<span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>';
      header.appendChild(toggle);
    }

    if (!document.querySelector('.bottom-nav')) {
      var bar = document.createElement('nav');
      bar.className = 'bottom-nav';
      bar.setAttribute('aria-label', 'เมนูหลัก');
      bar.innerHTML = MOBILE_NAV.map(function (entry) {
        var href = entry.href;
        if (entry.needLogin && !sessionUser) href = 'login.html?next=' + encodeURIComponent(entry.href);
        var active = entry.href === file || (entry.also && entry.also.indexOf(file) !== -1);
        return '<a class="bn-item' + (entry.accent ? ' bn-accent' : '') + (active ? ' is-active' : '') + '"' +
          ' href="' + href + '"' + (active ? ' aria-current="page"' : '') + '>' +
          '<span class="bn-icon" aria-hidden="true">' + entry.icon + '</span>' +
          '<span class="bn-label">' + entry.label + '</span></a>';
      }).join('');
      document.body.appendChild(bar);
    }

    if (document.querySelector('.mobile-menu')) return;

    var menu = document.createElement('div');
    menu.className = 'mobile-menu';
    menu.id = 'mobile-menu';
    menu.hidden = true;
    menu.innerHTML = '' +
      '<div class="mobile-menu-backdrop" data-menu-close></div>' +
      '<div class="mobile-menu-panel" role="dialog" aria-modal="true" aria-label="เมนูทั้งหมด">' +
        '<div class="mobile-menu-head">' +
          '<span class="logo">FLO<span>-</span>RENT</span>' +
          '<button type="button" class="mobile-menu-close" data-menu-close aria-label="ปิดเมนู">✕</button>' +
        '</div>' +
        '<nav class="mobile-menu-links" aria-label="เมนูเพิ่มเติม">' +
          '<a href="browse.html">สินค้าทั้งหมด</a>' +
          '<a href="look-for.html">LOOK FOR · ตามหาของ</a>' +
          '<a href="work.html">หาคนทำงาน</a>' +
          '<a href="jobs.html">ลงหางาน</a>' +
          '<a href="post.html">ลงประกาศให้เช่า</a>' +
          '<a href="index.html#how">วิธีใช้งาน</a>' +
          '<a href="index.html#value">ทำไมต้อง FLO-RENT</a>' +
        '</nav>' +
        '<div class="mobile-menu-account">' +
          (sessionUser
            ? '<a href="profile.html">บัญชีของฉัน</a>' +
              '<a href="bookings.html">การจองของฉัน</a>' +
              '<a href="wallet.html">กระเป๋าเงิน ' + flo(sessionUser.wallet) + '</a>' +
              (sessionUser.role === 'admin' ? '<a href="admin.html">หลังบ้านแอดมิน</a>' : '')
            : '<a class="btn btn-maroon btn-block" href="login.html?next=' + encodeURIComponent(file) + '">เข้าสู่ระบบ / สมัครสมาชิก</a>') +
        '</div>' +
      '</div>';
    document.body.appendChild(menu);

    var toggleBtn = header.querySelector('.nav-toggle');

    function closeMenu() {
      menu.hidden = true;
      document.body.classList.remove('is-menu-open');
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.classList.remove('is-open');
      }
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        var open = menu.hidden;
        menu.hidden = !open;
        document.body.classList.toggle('is-menu-open', open);
        toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggleBtn.classList.toggle('is-open', open);
        if (open) {
          var closeBtn = menu.querySelector('.mobile-menu-close');
          if (closeBtn) closeBtn.focus();
        }
      });
    }

    menu.addEventListener('click', function (event) {
      if (event.target.closest('[data-menu-close]') || event.target.closest('a')) closeMenu();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !menu.hidden) closeMenu();
    });
  }

  /* แถบราคาลอยล่างจอในหน้าสินค้า — ทำหน้าที่เลื่อนไปยังการ์ดจองเดิม */
  function paintStickyCta(item, isMine) {
    if (isMine || document.querySelector('.sticky-cta')) return;
    var bar = document.createElement('div');
    bar.className = 'sticky-cta';
    bar.innerHTML = '' +
      '<div class="sticky-price">' +
        '<strong>' + baht(item.price) + '</strong>' +
        '<span>/วัน · มัดจำ ' + baht(item.deposit) + '</span>' +
      '</div>' +
      '<button class="btn btn-maroon" type="button">' + (sessionUser ? 'จองเลย' : 'เข้าสู่ระบบเพื่อจอง') + '</button>';
    document.body.appendChild(bar);

    var cardEl = $('booking-card');
    bar.querySelector('button').addEventListener('click', function () {
      if (!cardEl) return;
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var submit = cardEl.querySelector('button[type="submit"]');
      if (submit) window.setTimeout(function () { submit.focus({ preventScroll: true }); }, 450);
    });

    if (cardEl && 'IntersectionObserver' in window) {
      new window.IntersectionObserver(function (entries) {
        bar.classList.toggle('is-off', entries[0].isIntersecting);
      }, { rootMargin: '-8% 0px -24% 0px' }).observe(cardEl);
    }
  }

  /* ---------- ส่วนหัวเว็บ ---------- */

  async function initHeader() {
    var header = document.querySelector('.header-inner');
    if (!header) return;

    var box = document.createElement('div');
    box.className = 'account-nav';
    box.innerHTML = '<span class="account-skeleton" aria-hidden="true"></span>';
    header.appendChild(box);

    try {
      var data = await API.get('/me');
      sessionUser = data.user;
    } catch (err) {
      sessionUser = null;
    }

    /* ลิงก์งานแสดงให้ทุกคนเห็น (ไม่ต้องเข้าสู่ระบบ) และไม่เพิ่มซ้ำถ้าหน้านั้นมีอยู่แล้ว */
    var headerNav = header.querySelector('.nav');
    if (headerNav) {
      [['หาคนทำงาน', 'work.html'], ['ลงหางาน', 'jobs.html']].forEach(function (item) {
        if (headerNav.querySelector('a[href="' + item[1] + '"]')) return;
        var link = document.createElement('a');
        link.href = item[1];
        link.textContent = item[0];
        headerNav.appendChild(link);
      });

    }

    if (sessionUser) {
      box.innerHTML = '' +
        '<a class="account-link" href="wallet.html">กระเป๋าเงิน ' + flo(sessionUser.wallet) + '</a>' +
        '<a class="account-link" href="bookings.html">การจองของฉัน</a>' +
        '<a class="account-chip" href="profile.html"><span class="avatar avatar-sm" aria-hidden="true">' +
          esc(sessionUser.avatar || '🙂') + '</span>' + esc(String(sessionUser.name || '').split(' ')[0]) + '</a>';

      var nav = header.querySelector('.nav');
      if (nav) {
        var bookingsLink = document.createElement('a');
        bookingsLink.href = 'bookings.html';
        bookingsLink.textContent = 'การจองของฉัน';
        nav.appendChild(bookingsLink);

        if (sessionUser.role === 'admin') {
          var adminLink = document.createElement('a');
          adminLink.href = 'admin.html';
          adminLink.textContent = 'แอดมิน';
          nav.appendChild(adminLink);
        }
      }
    } else {
      box.innerHTML = '<a class="btn btn-outline btn-sm" href="login.html">เข้าสู่ระบบ</a>';
    }

    paintMobileShell();
  }

  /* ---------- หน้าแรก ---------- */

  async function initHome() {
    var featured = $('featured-grid');
    if (!featured) return;

    var cats = $('category-grid');
    if (cats) {
      cats.innerHTML = CATS.map(function (cat) {
        return '' +
          '<a class="cat-card" href="browse.html?cat=' + cat.key + '">' +
            '<span class="cat-num">' + cat.num + '</span>' +
            '<span class="cat-emoji" aria-hidden="true">' + cat.emoji + '</span>' +
            '<span class="cat-name">' + esc(cat.name) + '</span>' +
            '<span class="cat-sub">' + esc(cat.sub) + '</span>' +
          '</a>';
      }).join('');
    }

    featured.setAttribute('aria-busy', 'true');
    featured.innerHTML = skeletonCards(8);
    try {
      var data = await API.get('/items?sort=recommended&limit=8');
      if (!data.items.length) {
        featured.innerHTML = '' +
          '<div class="empty" style="grid-column:1/-1">' +
            '<h2 class="display display-sm">ยังไม่มีประกาศให้เช่า</h2>' +
            '<p class="muted">เป็นคนแรกที่ลงประกาศ — ของที่ไม่ได้ใช้ สร้างรายได้ได้ทุกวัน</p>' +
            '<a class="btn btn-cream" href="post.html">ลงประกาศให้เช่า</a>' +
          '</div>';
        return;
      }
      renderCards(featured, data.items.slice(0, 8));
      featured.removeAttribute('aria-busy');
    } catch (err) {
      featured.removeAttribute('aria-busy');
      featured.innerHTML = '<p class="muted">โหลดสินค้าไม่สำเร็จ</p>';
      showError(err);
    }
  }

  /* ---------- หน้าค้นหา / กรอง ---------- */

  async function initBrowse() {
    var grid = $('browse-grid');
    if (!grid) return;

    var input = $('filter-q');
    var countEl = $('result-count');
    var emptyEl = $('empty-state');
    var minEl = $('filter-min');
    var maxEl = $('filter-max');
    var sortEl = $('filter-sort');
    var chipsEl = $('filter-cats');
    var form = $('filter-form');
    var seq = 0;
    var lastPage = 1;

    /* ปุ่มโหลดหน้าถัดไป (แสดงเฉพาะเมื่อยังมีข้อมูลเหลือ) */
    var moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'btn btn-outline btn-block';
    moreBtn.textContent = 'โหลดเพิ่ม';
    moreBtn.hidden = true;
    moreBtn.addEventListener('click', function () { render(true); });
    if (grid.parentNode) grid.parentNode.insertBefore(moreBtn, grid.nextSibling);

    var state = {
      q: param('q'),
      cat: param('cat') || 'all',
      min: 0,
      max: 0,
      sort: 'recommended'
    };

    if (input) input.value = state.q;

    if (chipsEl) {
      chipsEl.innerHTML = '<button type="button" class="chip chip-filter" data-cat="all">ทั้งหมด</button>' +
        CATS.map(function (cat) {
          return '<button type="button" class="chip chip-filter" data-cat="' + cat.key + '">' +
            cat.emoji + ' ' + esc(cat.name) + '</button>';
        }).join('');
    }

    function paintChips() {
      if (!chipsEl) return;
      Array.prototype.forEach.call(chipsEl.querySelectorAll('[data-cat]'), function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-cat') === state.cat);
      });
    }

    function syncUrl() {
      var url = new URL(window.location.href);
      if (state.q) url.searchParams.set('q', state.q); else url.searchParams.delete('q');
      if (state.cat !== 'all') url.searchParams.set('cat', state.cat); else url.searchParams.delete('cat');
      window.history.replaceState(null, '', url.toString());
    }

    async function render(append) {
      var ticket = ++seq;
      var page = append ? lastPage + 1 : 1;
      var query = new URLSearchParams();
      if (state.q) query.set('q', state.q);
      if (state.cat !== 'all') query.set('cat', state.cat);
      if (state.min > 0) query.set('min', String(state.min));
      if (state.max > 0) query.set('max', String(state.max));
      query.set('sort', state.sort);
      query.set('limit', '24');
      query.set('page', String(page));

      paintChips();
      if (countEl) countEl.textContent = append ? 'กำลังโหลดเพิ่ม...' : 'กำลังโหลด...';
      if (!append) {
        grid.hidden = false;
        grid.setAttribute('aria-busy', 'true');
        grid.innerHTML = skeletonCards(8);
      }
      moreBtn.disabled = true;

      try {
        var data = await API.get('/items?' + query.toString());
        if (ticket !== seq) return;
        if (append) {
          grid.insertAdjacentHTML('beforeend', data.items.map(itemCard).join(''));
        } else {
          renderCards(grid, data.items);
        }
        grid.removeAttribute('aria-busy');
        lastPage = Number(data.page) || page;
        var shown = grid.querySelectorAll('.item-card').length;
        grid.hidden = shown === 0;
        if (emptyEl) emptyEl.hidden = shown !== 0;
        if (countEl) countEl.textContent = 'พบ ' + data.count + ' รายการ · แสดง ' + shown;
        moreBtn.hidden = !(Number(data.pages) > lastPage);
      } catch (err) {
        if (ticket !== seq) return;
        grid.removeAttribute('aria-busy');
        if (!append) grid.innerHTML = '<p class="muted">โหลดสินค้าไม่สำเร็จ</p>';
        if (countEl) countEl.textContent = 'โหลดไม่สำเร็จ';
        showError(err);
      } finally {
        moreBtn.disabled = false;
      }

      syncUrl();
    }

    if (chipsEl) {
      chipsEl.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-cat]');
        if (!btn) return;
        state.cat = btn.getAttribute('data-cat');
        render();
      });
    }

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        state.q = input ? input.value : '';
        state.min = Number(minEl && minEl.value) || 0;
        state.max = Number(maxEl && maxEl.value) || 0;
        render();
      });
    }

    if (sortEl) {
      sortEl.addEventListener('change', function () {
        state.sort = sortEl.value;
        render();
      });
    }

    render();
  }

  /* ---------- รายละเอียดสินค้า + จอง ---------- */

  function notFoundBlock(title) {
    return '' +
      '<div class="empty">' +
        '<h1 class="display display-sm">' + esc(title || 'ไม่พบสินค้าชิ้นนี้') + '</h1>' +
        '<p class="muted">ประกาศนี้อาจถูกลบหรือปิดการขายไปแล้ว</p>' +
        '<a class="btn btn-cream" href="browse.html">ดูสินค้าทั้งหมด</a>' +
      '</div>';
  }

  async function initDetail() {
    var root = $('detail-root');
    if (!root) return;

    var id = param('id');
    if (!id) {
      root.innerHTML = notFoundBlock();
      return;
    }

    root.innerHTML = detailSkeleton();

    var item;
    try {
      var data = await API.get('/items/' + encodeURIComponent(id));
      item = data.item;
    } catch (err) {
      root.innerHTML = notFoundBlock(err.status === 404 ? 'ไม่พบสินค้าชิ้นนี้' : 'โหลดสินค้าไม่สำเร็จ');
      if (err.status !== 404) showError(err);
      return;
    }

    document.title = item.title + ' · FLO-RENT';
    var cat = catOf(item.cat);
    var isMine = sessionUser && item.ownerId === sessionUser.id;
    var unavailable = item.unavailable || [];
    var hasPin = typeof item.lat === 'number' && typeof item.lng === 'number';

    var bookingPanel;
    if (isMine) {
      bookingPanel = '' +
        '<p class="eyebrow">ประกาศของคุณ</p>' +
        '<h2 class="display display-sm" style="font-size:26px">' + baht(item.price) + ' / วัน</h2>' +
        '<p class="fine-print" style="margin-top:10px">มัดจำ ' + baht(item.deposit) + ' · สถานะ: ' +
          (item.status === 'published' ? 'เผยแพร่' : 'ซ่อนอยู่') + '</p>' +
        '<div class="booking-form"><a class="btn btn-maroon btn-block" href="profile.html">จัดการในบัญชีของฉัน</a>' +
        '<a class="btn btn-ghost btn-block" href="bookings.html">ดูการจองของฉัน</a></div>';
    } else {
      bookingPanel = '' +
        '<p class="eyebrow">เริ่มต้น</p>' +
        '<p class="booking-price"><strong>' + baht(item.price) + '</strong><span>/วัน</span></p>' +
        '<p class="item-fine">มัดจำ ' + baht(item.deposit) + ' (คืนเมื่อคืนของครบ)</p>' +
        (sessionUser
          ? '<p class="item-fine">FLO-RENT Wallet: <strong>' + flo(sessionUser.wallet) + '</strong> · ' +
            '<a href="wallet.html">เติมเงิน</a></p>'
          : '') +
        '<form id="booking-form" class="booking-form">' +
          '<div class="booking-range"><span>ช่วงวันเช่า</span>' +
            '<strong id="booking-range-label">ลากหรือคลิกเลือกช่วงวัน</strong></div>' +
          '<div class="cal cal-light cal-booking" id="booking-cal"></div>' +
          '<div class="booking-summary" id="booking-summary"></div>' +
          '<button class="btn btn-maroon btn-block" type="submit">' + (sessionUser ? 'ยืนยันการจอง' : 'เข้าสู่ระบบเพื่อจอง') + '</button>' +
          '<p class="fine-print">' + (sessionUser
            ? 'การจองจะถูกบันทึกในประวัติและผู้ให้เช่าจะติดต่อกลับ'
            : 'ต้องเข้าสู่ระบบก่อนยืนยันการจอง เพื่อเก็บประวัติไว้ในบัญชีของคุณ') + '</p>' +
        '</form>';
    }

    root.innerHTML = '' +
      '<nav class="crumbs"><a href="index.html">หน้าแรก</a> / ' +
        '<a href="browse.html?cat=' + esc(item.cat) + '">' + esc(cat.name) + '</a> / ' +
        '<span>' + esc(item.title) + '</span></nav>' +
      '<div class="detail">' +
        '<div class="detail-main">' +
          '<div class="thumb thumb-lg thumb-' + esc(item.cat) + '">' +
            thumbInner(item, 'detail-hero') +
          '</div>' +
          thumbsStrip(item) +
          '<h1 class="detail-title">' + esc(item.title) + '</h1>' +
          '<p class="item-meta">' + esc(item.owner) + ' · <span class="stars">★ ' +
            Number(item.rating || 0).toFixed(1) + '</span> <span class="muted">(' + Number(item.reviews || 0) +
            ' รีวิว)</span> · ' + esc(item.location) + '</p>' +
          '<h2 class="detail-h2">รายละเอียด</h2>' +
          '<p>' + esc(item.desc) + '</p>' +
          '<h2 class="detail-h2">เงื่อนไขการเช่า</h2>' +
          '<p>' + esc(item.terms) + '</p>' +
          '<ul class="checklist">' +
            '<li>ผู้เช่าต้องมีอายุ 15 ปีขึ้นไป</li>' +
            '<li>ชำระค่าอุปกรณ์ + ค่ามัดจำก่อนรับสินค้า</li>' +
            '<li>ได้รับเงินมัดจำคืนเมื่อคืนสินค้าในสภาพเรียบร้อย</li>' +
          '</ul>' +
          '<h2 class="detail-h2">ตำแหน่งรับของ</h2>' +
          (hasPin
            ? '<div class="detail-map" id="detail-map" aria-label="แผนที่จุดนัดรับ"></div>' +
              '<p class="item-fine">📍 ' + esc(item.location) + ' · ' + Number(item.lat).toFixed(4) + ', ' + Number(item.lng).toFixed(4) + '</p>'
            : '<p class="item-fine">📍 ' + esc(item.location) + ' — ผู้ให้เช่ายังไม่ได้ปักหมุดตำแหน่งไว้</p>') +
          '<h2 class="detail-h2">สถานะสินค้า</h2>' +
          '<p class="item-fine">' +
            (item.availableFrom ? 'เริ่มให้เช่า ' + thDate(item.availableFrom) : 'พร้อมให้เช่า') + ' · ' +
            (unavailable.length ? 'ไม่ว่าง ' + unavailable.length + ' วัน' : 'ว่างทุกวัน') +
          '</p>' +
          '<div class="cal" id="detail-cal"></div>' +
        '</div>' +
        '<aside class="booking-card" id="booking-card">' + bookingPanel + '</aside>' +
      '</div>';

    var galleryEl = $('detail-gallery');
    if (galleryEl) {
      galleryEl.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-src]');
        if (!btn) return;
        var hero = document.querySelector('.thumb-lg .thumb-img');
        if (hero) hero.src = btn.getAttribute('data-src');
        Array.prototype.forEach.call(galleryEl.querySelectorAll('[data-src]'), function (node) {
          node.classList.toggle('is-active', node === btn);
        });
      });
    }

    if (hasPin) {
      createPinMap($('detail-map'), { lat: item.lat, lng: item.lng, editable: false });
    }

    createCalendar($('detail-cal'), {
      selected: unavailable,
      minDay: item.availableFrom || '',
      readOnly: true,
      month: item.availableFrom ? new Date(item.availableFrom + 'T00:00:00') : null
    });

    paintStickyCta(item, isMine);

    if (isMine) return;

    var summaryEl = $('booking-summary');
    var formEl = $('booking-form');
    var calEl = $('booking-cal');
    var rangeLabel = $('booking-range-label');
    if (!formEl || !summaryEl || !calEl) return;

    var picked = { start: '', end: '' };
    var notice = '';

    function daysBetween() {
      if (!picked.start || !picked.end) return 0;
      var start = new Date(picked.start + 'T00:00:00');
      var end = new Date(picked.end + 'T00:00:00');
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
      return Math.round((end - start) / 86400000);
    }

    function refreshSummary() {
      if (rangeLabel) {
        rangeLabel.textContent = picked.start && picked.end
          ? thDate(picked.start) + ' → ' + thDate(picked.end)
          : 'ลากหรือคลิกเลือกช่วงวัน';
      }

      var days = daysBetween();
      var html = notice ? '<p class="warn" style="margin-bottom:6px">' + esc(notice) + '</p>' : '';

      if (days < 1) {
        summaryEl.innerHTML = html + '<p class="warn">เลือกวันเริ่มเช่าและวันคืนจากปฏิทิน (อย่างน้อย 1 คืน)</p>';
        return;
      }

      var rent = item.price * days;
      var total = rent + item.deposit;
      var wallet = sessionUser ? Number(sessionUser.wallet || 0) : 0;
      var canPay = wallet >= total;

      summaryEl.innerHTML = html +
        '<div class="summary-row"><span>ค่าเช่า ' + baht(item.price) + ' × ' + days + ' วัน</span><span>' +
          baht(rent) + '</span></div>' +
        '<div class="summary-row"><span>เงินมัดจำ (กันไว้จนกว่าจะคืนของ)</span><span>' + baht(item.deposit) + '</span></div>' +
        '<div class="summary-row summary-total"><span>รวมทั้งสิ้น</span><span>' +
          baht(total) + '</span></div>' +
        '<div class="summary-row"><span>ชำระจาก FLO-RENT Wallet</span><span>' + flo(total) + '</span></div>' +
        '<p class="fine-print">' + (canPay
          ? 'เงินจะถูกกันไว้ใน Wallet และคืนมัดจำอัตโนมัติเมื่อยืนยันคืนของ'
          : 'ยอดใน Wallet ไม่พอ (มี ' + flo(wallet) + ') — <a href="wallet.html">เติมเงินก่อนจอง</a>') + '</p>';
    }

    createRangeCalendar(calEl, {
      minDay: isoDay(0),
      blocked: unavailable,
      start: isoDay(0),
      end: isoDay(1),
      onSelect: function (start, end) {
        picked.start = start;
        picked.end = end;
        notice = '';
        refreshSummary();
      },
      onInvalid: function (message) {
        notice = message;
        refreshSummary();
      }
    });

    refreshSummary();

    formEl.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!sessionUser) {
        requireLogin();
        return;
      }
      var days = daysBetween();
      if (days < 1) {
        refreshSummary();
        return;
      }

      if (sessionUser && Number(sessionUser.wallet || 0) < item.price * days + item.deposit) {
        toast('ยอดใน FLO-RENT Wallet ไม่พอ — เติมเงินก่อนจอง');
        return;
      }

      var button = formEl.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'กำลังจอง...';

      try {
        var result = await API.post('/bookings', {
          itemId: item.id,
          start: picked.start,
          end: picked.end
        });
        var booking = result.booking;
        if (sessionUser && typeof result.wallet === 'number') {
          sessionUser.wallet = result.wallet;
          paintWalletChip();
        }
        toast('จองสำเร็จ · รหัส ' + booking.code, 'ok');
        $('booking-card').innerHTML = '' +
          '<div class="success">' +
            '<p class="eyebrow">จองสำเร็จ</p>' +
            '<h2 class="display display-sm">' + esc(booking.code) + '</h2>' +
            '<p><strong>' + esc(booking.itemTitle) + '</strong><br>' + thDate(booking.start) + ' → ' + thDate(booking.end) + '</p>' +
            '<p class="booking-price"><strong>' + baht(booking.total) + '</strong></p>' +
            '<p class="fine-print">บันทึกในประวัติการจองของบัญชีคุณแล้ว สถานะเริ่มต้นคือ “รอยืนยัน”</p>' +
            '<div class="success-actions">' +
              '<a class="btn btn-maroon" href="bookings.html">ดูประวัติการจอง</a>' +
              '<a class="btn btn-ghost" href="browse.html">เลือกชิ้นอื่นต่อ</a>' +
            '</div>' +
          '</div>';
      } catch (err) {
        button.disabled = false;
        button.textContent = 'ยืนยันการจอง';
        if (err.status === 401) { requireLogin(); return; }
        if (showVerifyNeeded(err, $('booking-card'))) return;
        showError(err);
      }
    });
  }

  /* ---------- ลงประกาศให้เช่า ---------- */

  async function initPost() {
    var form = $('post-form');
    if (!form) return;

    var wrap = $('post-form-wrap');
    var catSelect = $('post-cat');
    catSelect.innerHTML = CATS.map(function (cat) {
      return '<option value="' + cat.key + '">' + cat.emoji + ' ' + esc(cat.name) + '</option>';
    }).join('');

    if (!sessionUser) {
      if (wrap) {
        wrap.innerHTML = '' +
          '<div class="success success-wide">' +
            '<p class="eyebrow">ต้องเข้าสู่ระบบก่อน</p>' +
            '<h2 class="display display-sm">ลงประกาศให้เช่า</h2>' +
            '<p>ประกาศจะผูกกับบัญชีของคุณ เพื่อแก้ไข ซ่อน หรือดูยอดในหน้าโปรไฟล์ได้</p>' +
            '<div class="success-actions">' +
              '<a class="btn btn-maroon" href="login.html?next=post.html">เข้าสู่ระบบ / สมัครสมาชิก</a>' +
              '<a class="btn btn-ghost" href="browse.html">ดูสินค้าทั้งหมด</a>' +
            '</div>' +
          '</div>';
      }
      return;
    }

    var owner = $('post-owner');
    if (owner) {
      owner.value = sessionUser.name;
      owner.readOnly = true;
    }

    var latEl = $('post-lat');
    var lngEl = $('post-lng');
    var mapHint = $('post-map-hint');
    var startEl = $('post-start');
    var calHint = $('post-cal-hint');

    if (startEl) startEl.value = todayKey();

    createPinMap($('post-map'), {
      editable: true,
      onPick: function (latlng) {
        if (!latEl || !lngEl) return;
        latEl.value = latlng.lat.toFixed(6);
        lngEl.value = latlng.lng.toFixed(6);
        if (mapHint) {
          mapHint.textContent = 'ปักหมุดแล้ว: ' + Number(latEl.value).toFixed(4) + ', ' + Number(lngEl.value).toFixed(4);
        }
      }
    });

    var calendar = createCalendar($('post-cal'), {
      selected: [],
      minDay: startEl ? startEl.value : todayKey(),
      onChange: function (days) {
        if (!calHint) return;
        calHint.textContent = days.length
          ? 'ทำเครื่องหมาย “ไม่ว่าง” แล้ว ' + days.length + ' วัน'
          : 'ทุกวันว่างให้เช่า — คลิกวันที่ในปฏิทินเพื่อทำเครื่องหมาย “ไม่ว่าง”';
      }
    });

    if (startEl) {
      startEl.addEventListener('change', function () {
        if (calendar) calendar.setMinDay(startEl.value);
      });
    }

    /* แนบรูปสินค้า: ย่อขนาดในเบราว์เซอร์แล้วส่งเป็น data URL (สูงสุด 4 รูป) */
    var imageInput = $('post-images');
    var previewEl = $('post-images-preview');
    var photos = [];

    function paintPreviews() {
      if (previewEl) {
        previewEl.innerHTML = photos.map(function (src, index) {
          return '<figure class="image-item">' +
            '<img src="' + esc(src) + '" alt="รูปที่ ' + (index + 1) + '">' +
            '<button type="button" class="image-remove" data-remove="' + index + '" aria-label="ลบรูปนี้">×</button>' +
          '</figure>';
        }).join('');
      }
      if (imageInput) imageInput.disabled = photos.length >= 4;
    }

    if (imageInput) {
      imageInput.addEventListener('change', async function () {
        var files = Array.prototype.slice.call(imageInput.files || []);
        imageInput.value = '';
        for (var i = 0; i < files.length; i += 1) {
          if (photos.length >= 4) { toast('แนบได้สูงสุด 4 รูป'); break; }
          if (!/^image\//.test(files[i].type)) { toast('ไฟล์นี้ไม่ใช่รูปภาพ'); continue; }
          try {
            photos.push(await readPhoto(files[i]));
          } catch (err) {
            toast(err && err.message ? err.message : 'อ่านรูปไม่สำเร็จ');
          }
        }
        paintPreviews();
      });
    }

    if (previewEl) {
      previewEl.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-remove]');
        if (!btn) return;
        photos.splice(Number(btn.getAttribute('data-remove')), 1);
        paintPreviews();
      });
    }

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var button = form.querySelector('button[type="submit"]');
      var msg = $('post-msg');
      if (msg) { msg.textContent = ''; msg.className = 'form-msg'; }
      button.disabled = true;
      button.textContent = 'กำลังเผยแพร่...';

      try {
        var result = await API.post('/items', {
          title: $('post-title').value,
          cat: catSelect.value,
          price: $('post-price').value,
          deposit: $('post-deposit').value,
          location: $('post-location').value,
          availableFrom: startEl ? startEl.value : '',
          unavailable: calendar ? calendar.list() : [],
          lat: latEl && latEl.value ? latEl.value : undefined,
          lng: lngEl && lngEl.value ? lngEl.value : undefined,
          tags: $('post-tags').value,
          desc: $('post-desc').value,
          images: photos
        });
        var item = result.item;
        toast('เผยแพร่ประกาศแล้ว', 'ok');
        wrap.innerHTML = '' +
          '<div class="success success-wide">' +
            '<p class="eyebrow">ประกาศขึ้นแล้ว</p>' +
            '<h2 class="display display-sm">' + esc(item.title) + '</h2>' +
            '<p>ราคา <strong>' + baht(item.price) + '/วัน</strong> · มัดจำ ' + baht(item.deposit) + '</p>' +
            '<p class="fine-print">ประกาศแสดงในหน้าค้นหาแล้ว และอยู่ใน “ประกาศของฉัน”</p>' +
            '<div class="success-actions">' +
              '<a class="btn btn-maroon" href="item.html?id=' + encodeURIComponent(item.id) + '">ดูประกาศของฉัน</a>' +
              '<a class="btn btn-ghost" href="profile.html">ไปหน้าบัญชี</a>' +
            '</div>' +
          '</div>';
      } catch (err) {
        button.disabled = false;
        button.textContent = 'เผยแพร่ประกาศ';
        if (err.status === 401) { requireLogin(); return; }
        if (showVerifyNeeded(err, wrap)) return;
        showError(err);
      }
    });
  }

  /* ---------- LOOK FOR ---------- */

  async function initLookFor() {
    var form = $('request-form');
    if (!form) return;

    var catSelect = $('request-cat');
    var listEl = $('request-list');
    var okEl = $('request-ok');

    catSelect.innerHTML = '<option value="all">ทุกหมวด</option>' + CATS.map(function (cat) {
      return '<option value="' + cat.key + '">' + cat.emoji + ' ' + esc(cat.name) + '</option>';
    }).join('');

    if (sessionUser && $('request-name')) $('request-name').value = sessionUser.name;

    async function load() {
      if (!listEl) return;
      listEl.innerHTML = '<p class="muted">กำลังโหลด...</p>';
      try {
        var data = await API.get('/requests');
        if (!data.requests.length) {
          listEl.innerHTML = '<p class="muted">ยังไม่มีคำขอ — ประกาศของคุณจะเป็นรายการแรก</p>';
          return;
        }
        listEl.innerHTML = data.requests.map(function (req) {
          var cat = req.cat === 'all' ? { emoji: '🔍', name: 'ทุกหมวด' } : catOf(req.cat);
          var mine = !!(req.userId && sessionUser && req.userId === sessionUser.id);
          var offers = req.offers || [];

          var offerList = offers.length
            ? '<ul class="offer-list">' + offers.map(function (offer) {
                return '<li>' +
                  '<a href="item.html?id=' + encodeURIComponent(offer.itemId) + '">' +
                    esc(offer.itemEmoji || '📦') + ' ' + esc(offer.itemTitle) + '</a>' +
                  ' · ' + baht(offer.itemPrice) + '/วัน · เสนอโดย ' + esc(offer.userName) +
                  (offer.note ? ' — “' + esc(offer.note) + '”' : '') +
                '</li>';
              }).join('') + '</ul>'
            : '<p class="offer-empty">ยังไม่มีใครเสนอประกาศให้คำขอนี้</p>';

          var actions = mine
            ? '<span class="chip chip-light">คำขอของคุณ · มีผู้เสนอ ' + Number(req.offerCount || 0) + '</span>' + offerList
            : '<div class="request-actions">' +
                (req.offerCount ? '<span class="offer-count">มีผู้เสนอ ' + Number(req.offerCount) + ' รายการ</span>' : '') +
                '<button class="btn btn-ghost btn-sm" type="button" data-offer="' + esc(req.id) + '">' +
                  (req.myOffer ? 'เสนอแล้ว · เสนออีกรายการ' : 'เสนอของฉัน') +
                '</button>' +
              '</div>' +
              '<div class="offer-slot" data-slot="' + esc(req.id) + '" hidden></div>';

          return '' +
            '<article class="request-card">' +
              '<span class="cat-emoji" aria-hidden="true">' + cat.emoji + '</span>' +
              '<div class="request-body">' +
                '<h3>' + esc(req.want) + '</h3>' +
                '<p class="item-meta">โดย ' + esc(req.name) + ' · ต้องการใช้ ' + esc(req.when) +
                  ' · งบ ' + baht(req.budget) + '/วัน</p>' +
                actions +
              '</div>' +
              '<span class="chip chip-light">' + esc(cat.name) + '</span>' +
            '</article>';
        }).join('');
      } catch (err) {
        listEl.innerHTML = '<p class="muted">โหลดรายการไม่สำเร็จ</p>';
        showError(err);
      }
    }

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!sessionUser) {
        requireLogin();
        return;
      }
      var button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await API.post('/requests', {
          want: $('request-want').value,
          cat: catSelect.value,
          budget: $('request-budget').value,
          when: $('request-when').value,
          name: $('request-name').value
        });
        form.reset();
        if (sessionUser && $('request-name')) $('request-name').value = sessionUser.name;
        if (okEl) okEl.hidden = false;
        toast('ประกาศตามหาของคุณขึ้นในรายการแล้ว', 'ok');
        await load();
      } catch (err) {
        if (err.status === 401) { requireLogin(); return; }
        showError(err);
      } finally {
        button.disabled = false;
      }
    });

    /* เสนอประกาศของตัวเองให้คำขอในรายการ */
    listEl.addEventListener('click', async function (event) {
      var cancelBtn = event.target.closest('[data-offer-cancel]');
      if (cancelBtn) {
        var openSlot = cancelBtn.closest('.offer-slot');
        if (openSlot) { openSlot.hidden = true; openSlot.innerHTML = ''; }
        return;
      }

      var offerBtn = event.target.closest('[data-offer]');
      if (!offerBtn) return;
      if (!sessionUser) { requireLogin(); return; }

      var requestId = offerBtn.getAttribute('data-offer');
      var slotEl = listEl.querySelector('[data-slot="' + requestId + '"]');
      if (!slotEl) return;
      if (!slotEl.hidden) { slotEl.hidden = true; slotEl.innerHTML = ''; return; }

      slotEl.hidden = false;
      slotEl.innerHTML = '<p class="offer-empty">กำลังโหลดประกาศของคุณ...</p>';

      try {
        var mineData = await API.get('/items?mine=1');
        var options = mineData.items.filter(function (item) { return item.status === 'published'; });
        if (!options.length) {
          slotEl.innerHTML = '<p class="offer-empty">คุณยังไม่มีประกาศที่เผยแพร่อยู่ — ' +
            '<a href="post.html">ลงประกาศให้เช่า</a> ก่อน แล้วกลับมาเสนอได้เลย</p>';
          return;
        }

        slotEl.innerHTML = '' +
          '<form class="offer-form">' +
            '<label class="field"><span>เลือกประกาศของคุณ</span>' +
              '<select data-offer-item>' + options.map(function (item) {
                return '<option value="' + esc(item.id) + '">' + esc(item.emoji) + ' ' + esc(item.title) +
                  ' · ' + baht(item.price) + '/วัน</option>';
              }).join('') + '</select>' +
            '</label>' +
            '<label class="field"><span>ข้อความถึงผู้ประกาศ (ไม่บังคับ)</span>' +
              '<input type="text" maxlength="200" data-offer-note placeholder="เช่น ว่างตรงวันที่ต้องการ ส่งของได้ที่...">' +
            '</label>' +
            '<div class="form-actions">' +
              '<button class="btn btn-maroon btn-sm" type="submit">ส่งข้อเสนอ</button>' +
              '<button class="btn btn-ghost btn-sm" type="button" data-offer-cancel>ยกเลิก</button>' +
            '</div>' +
          '</form>';

        slotEl.querySelector('.offer-form').addEventListener('submit', async function (submitEvent) {
          submitEvent.preventDefault();
          var submitBtn = submitEvent.target.querySelector('button[type="submit"]');
          submitBtn.disabled = true;
          try {
            await API.post('/requests/' + encodeURIComponent(requestId) + '/offers', {
              itemId: slotEl.querySelector('[data-offer-item]').value,
              note: slotEl.querySelector('[data-offer-note]').value
            });
            toast('ส่งข้อเสนอแล้ว — ผู้ประกาศจะเห็นประกาศของคุณในคำขอนี้', 'ok');
            await load();
          } catch (err) {
            submitBtn.disabled = false;
            if (err.status === 401) { requireLogin(); return; }
            showError(err);
          }
        });
      } catch (err) {
        slotEl.innerHTML = '<p class="offer-empty">โหลดประกาศของคุณไม่สำเร็จ</p>';
        showError(err);
      }
    });

    load();
  }

  /* ---------- เข้าสู่ระบบ / สมัครสมาชิก ---------- */

  async function initLogin() {
    var card = $('auth-card');
    if (!card) return;

    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    var panes = card.querySelectorAll('[data-pane]');
    var steps = $('auth-steps');
    var kicker = $('auth-kicker');
    var title = $('auth-title');
    var sub = $('auth-sub');
    var otpBoxes = $('otp-boxes') ? Array.prototype.slice.call($('otp-boxes').querySelectorAll('.otp-box')) : [];

    var state = {
      mode: 'email',
      intent: 'login',
      email: '',
      name: '',
      signupToken: '',
      back: 'email',
      resendTimer: null
    };

    if (sessionUser) {
      card.innerHTML = '' +
        '<p class="eyebrow">เข้าสู่ระบบอยู่แล้ว</p>' +
        '<h2 class="display display-sm auth-signed-title">' + esc(String(sessionUser.name || '').split(' ')[0]) + '</h2>' +
        '<p class="auth-sub">' + esc(sessionUser.email) + ' · ' +
          (sessionUser.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้ทั่วไป') + '</p>' +
        '<div class="auth-alt auth-signed-actions">' +
          '<a class="btn btn-maroon" href="profile.html">บัญชีของฉัน</a>' +
          '<a class="btn btn-ghost" href="bookings.html">ประวัติการจอง</a>' +
          (sessionUser.role === 'admin' ? '<a class="btn btn-ghost" href="admin.html">หน้าแอดมิน</a>' : '') +
        '</div>';
      return;
    }

    /* ---------- ตัวช่วยเล็ก ๆ ---------- */

    function msg(id, text, ok) {
      var el = $(id);
      if (!el) return;
      el.textContent = text || '';
      el.className = 'form-msg' + (text ? (ok ? ' is-ok' : ' is-error') : '');
    }

    function fieldError(id, text) {
      var el = $(id);
      if (!el) return;
      el.textContent = text || '';
      el.hidden = !text;
    }

    function maskEmail(email) {
      var at = String(email || '').indexOf('@');
      if (at < 1) return String(email || '');
      return email.slice(0, Math.min(2, at)) + '•••' + email.slice(at);
    }

    function copyFor(mode) {
      if (mode === 'otp') return { kicker: 'ยืนยันตัวตน', title: 'กรอกรหัส 6 หลัก', sub: 'รหัสใช้ได้ครั้งเดียวและหมดอายุใน 10 นาที' };
      if (mode === 'password') return { kicker: 'เข้าสู่ระบบ', title: 'ด้วยรหัสผ่าน', sub: 'ผู้ดูแลระบบเข้าได้ทันที ผู้ใช้ทั่วไปต้องยืนยัน OTP จากอีเมลอีกขั้น' };
      if (mode === 'signup') return { kicker: 'ขั้นสุดท้าย', title: 'ตั้งค่าบัญชี', sub: 'ตั้งรหัสผ่านและข้อมูลพื้นฐานเพื่อเริ่มใช้งาน' };
      if (state.intent === 'signup') return { kicker: 'สมัครสมาชิก', title: 'เริ่มจากอีเมล', sub: 'กรอกชื่อและอีเมล แล้วยืนยันด้วยรหัส 6 หลักจากอีเมล' };
      return { kicker: 'เข้าสู่ระบบ', title: 'อีเมลของคุณ', sub: 'เราจะส่งรหัส 6 หลักไปให้ — ไม่ต้องจำรหัสผ่าน' };
    }

    function paintSteps(mode) {
      if (!steps) return;
      steps.hidden = mode === 'password';
      var signup = state.intent === 'signup';
      var current = mode === 'otp' ? 2 : (mode === 'signup' ? 3 : 1);
      Array.prototype.forEach.call(steps.querySelectorAll('[data-step]'), function (li) {
        var step = Number(li.getAttribute('data-step'));
        li.hidden = step === 3 && !signup;
        li.classList.toggle('is-current', step === current);
        li.classList.toggle('is-done', step < current);
      });
    }

    function showPane(mode) {
      state.mode = mode;
      Array.prototype.forEach.call(panes, function (pane) {
        pane.hidden = pane.getAttribute('data-pane') !== mode;
      });
      var copy = copyFor(mode);
      if (kicker) kicker.textContent = copy.kicker;
      if (title) title.textContent = copy.title;
      if (sub) sub.textContent = copy.sub;
      if (mode !== 'otp') stopResend();
      if (mode === 'email') {
        $('auth-name-field').hidden = state.intent !== 'signup';
        $('email-submit').textContent = state.intent === 'signup' ? 'รับรหัสเพื่อสมัคร' : 'รับรหัสทางอีเมล';
      }
      if (mode === 'password' && !$('pw-email').value) {
        $('pw-email').value = state.email || $('auth-email').value.trim();
      }
      paintSteps(mode);
    }

    function finish(token, flashText) {
      API.setToken(token);
      stopResend();
      setFlash(flashText);
      goNext('profile.html');
    }

    /* ---------- OTP 6 ช่อง ---------- */

    function otpValue() {
      return otpBoxes.map(function (box) { return box.value.replace(/\D/g, ''); }).join('');
    }

    function syncOtp() {
      var value = otpValue();
      $('otp-submit').disabled = value.length !== 6;
      return value;
    }

    function clearOtp() {
      otpBoxes.forEach(function (box) {
        box.value = '';
        box.classList.remove('is-filled');
      });
      syncOtp();
    }

    function stopResend() {
      if (state.resendTimer) {
        window.clearInterval(state.resendTimer);
        state.resendTimer = null;
      }
    }

    function startResend(seconds) {
      stopResend();
      var button = $('otp-resend');
      if (!button) return;
      var left = Math.max(0, Number(seconds) || 60);
      function paint() {
        button.disabled = left > 0;
        button.textContent = left > 0 ? 'ส่งรหัสใหม่ (' + left + ')' : 'ส่งรหัสใหม่';
      }
      paint();
      state.resendTimer = window.setInterval(function () {
        left -= 1;
        paint();
        if (left <= 0) stopResend();
      }, 1000);
    }

    function openOtp(sent, lead) {
      state.back = state.mode === 'password' ? 'password' : 'email';
      if (sent && sent.email) state.email = sent.email;
      $('otp-masked').textContent = maskEmail(state.email);
      clearOtp();
      msg('otp-msg', lead || '', !!lead);

      var hint = $('otp-hint');
      if (sent && sent.devCode) {
        hint.hidden = false;
        hint.textContent = 'โหมดพัฒนา (ยังไม่ตั้งค่าผู้ให้บริการอีเมล): รหัสของคุณคือ ' + sent.devCode;
      } else if (sent && sent.delivered) {
        hint.hidden = false;
        hint.textContent = 'ส่งรหัส 6 หลักไปที่ ' + state.email + ' แล้ว · ใช้ได้ภายใน ' +
          Math.round((sent.expiresIn || 600) / 60) + ' นาที';
      } else {
        hint.hidden = true;
        hint.textContent = '';
      }

      showPane('otp');
      startResend(sent && sent.resendIn ? sent.resendIn : 60);
      if (otpBoxes[0]) otpBoxes[0].focus();
    }

    if (otpBoxes.length) {
      otpBoxes.forEach(function (box, index) {
        box.addEventListener('input', function () {
          box.value = box.value.replace(/\D/g, '').slice(-1);
          box.classList.toggle('is-filled', !!box.value);
          if (box.value && index < otpBoxes.length - 1) otpBoxes[index + 1].focus();
          syncOtp();
        });

        box.addEventListener('keydown', function (event) {
          if (event.key === 'Backspace' && !box.value && index > 0) {
            event.preventDefault();
            otpBoxes[index - 1].value = '';
            otpBoxes[index - 1].classList.remove('is-filled');
            otpBoxes[index - 1].focus();
            syncOtp();
          } else if (event.key === 'ArrowLeft' && index > 0) {
            event.preventDefault();
            otpBoxes[index - 1].focus();
          } else if (event.key === 'ArrowRight' && index < otpBoxes.length - 1) {
            event.preventDefault();
            otpBoxes[index + 1].focus();
          }
        });

        box.addEventListener('paste', function (event) {
          var clip = event.clipboardData || window.clipboardData;
          var digits = String((clip && clip.getData('text')) || '').replace(/\D/g, '').slice(0, otpBoxes.length);
          if (!digits) return;
          event.preventDefault();
          otpBoxes.forEach(function (target, i) {
            target.value = digits[i] || '';
            target.classList.toggle('is-filled', !!target.value);
          });
          otpBoxes[Math.min(digits.length, otpBoxes.length - 1)].focus();
          syncOtp();
        });
      });
    }

    /* ---------- ขั้นที่ 1: อีเมล ---------- */

    function startSignup(email) {
      state.intent = 'signup';
      fieldError('auth-email-error', '');
      fieldError('auth-name-error', '');
      if (email) $('auth-email').value = email;
      showPane('email');
      $('auth-name').focus();
    }

    $('email-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var nameEl = $('auth-name');
      var emailEl = $('auth-email');
      var button = $('email-submit');
      var signup = state.intent === 'signup';
      var email = emailEl.value.trim();
      var name = nameEl.value.trim();

      fieldError('auth-email-error', '');
      fieldError('auth-name-error', '');
      msg('email-msg', '');

      if (signup && name.length < 2) {
        fieldError('auth-name-error', 'กรอกชื่ออย่างน้อย 2 ตัวอักษร');
        nameEl.focus();
        return;
      }
      if (!EMAIL_RE.test(email)) {
        fieldError('auth-email-error', 'รูปแบบอีเมลไม่ถูกต้อง');
        emailEl.focus();
        return;
      }

      state.email = email;
      if (signup) state.name = name;
      button.disabled = true;
      button.textContent = 'กำลังส่งรหัส...';

      try {
        var payload = { email: email };
        if (signup) {
          payload.purpose = 'signup';
          payload.name = name;
        }
        var sent = await API.post('/auth/otp/request', payload);
        openOtp(sent, signup
          ? 'กรอกรหัสจากอีเมลเพื่อยืนยันว่าเป็นอีเมลของคุณ'
          : 'ถ้าไม่เห็นอีเมล ให้ตรวจถังสแปมหรือกด "ส่งรหัสใหม่"');
      } catch (err) {
        if (!signup && err.status === 404) {
          startSignup(email);
          msg('email-msg', 'อีเมลนี้ยังไม่มีบัญชี — กรอกชื่อเพื่อสมัครสมาชิก');
          return;
        }
        msg('email-msg', err.message);
      } finally {
        button.disabled = false;
        button.textContent = state.intent === 'signup' ? 'รับรหัสเพื่อสมัคร' : 'รับรหัสทางอีเมล';
      }
    });

    $('to-signup').addEventListener('click', function () {
      startSignup($('auth-email').value.trim());
    });

    $('to-password').addEventListener('click', function () {
      state.email = $('auth-email').value.trim() || state.email;
      msg('pw-msg', '');
      showPane('password');
      $('pw-pass').focus();
    });

    /* ---------- ขั้นที่ 2: OTP ---------- */

    $('otp-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var button = $('otp-submit');
      var code = otpValue();
      msg('otp-msg', '');
      if (code.length !== 6) {
        msg('otp-msg', 'กรอกรหัส 6 หลักจากอีเมล');
        return;
      }

      button.disabled = true;
      button.textContent = 'กำลังยืนยัน...';
      try {
        var data = await API.post('/auth/otp/verify', {
          email: state.email,
          code: code,
          purpose: state.intent
        });

        if (state.intent === 'signup') {
          state.signupToken = data.signupToken || '';
          $('signup-email').textContent = state.email;
          $('sg-pass').value = '';
          $('sg-pass2').value = '';
          $('sg-phone').value = '';
          fieldError('sg-pass-error', '');
          fieldError('sg-pass2-error', '');
          fieldError('sg-age-error', '');
          msg('sg-msg', '');
          showPane('signup');
          $('sg-pass').focus();
          return;
        }

        finish(data.token, 'เข้าสู่ระบบสำเร็จ');
      } catch (err) {
        msg('otp-msg', err.message);
        clearOtp();
        if (otpBoxes[0]) otpBoxes[0].focus();
      } finally {
        button.textContent = 'ยืนยันและเข้าสู่ระบบ';
        syncOtp();
      }
    });

    $('otp-back').addEventListener('click', function () {
      stopResend();
      clearOtp();
      msg('otp-msg', '');
      showPane(state.back);
      if (state.back === 'email') $('auth-email').focus();
    });

    $('otp-change').addEventListener('click', function () {
      stopResend();
      clearOtp();
      msg('otp-msg', '');
      showPane('email');
      $('auth-email').focus();
    });

    $('otp-resend').addEventListener('click', async function () {
      var button = $('otp-resend');
      button.disabled = true;
      msg('otp-msg', '');
      try {
        var payload = { email: state.email };
        if (state.intent === 'signup') {
          payload.purpose = 'signup';
          payload.name = state.name;
        }
        var sent = await API.post('/auth/otp/request', payload);
        msg('otp-msg', 'ส่งรหัสใหม่แล้ว', true);
        var hint = $('otp-hint');
        if (sent.devCode) {
          hint.hidden = false;
          hint.textContent = 'โหมดพัฒนา: รหัสของคุณคือ ' + sent.devCode;
        }
        startResend(sent.resendIn || 60);
      } catch (err) {
        msg('otp-msg', err.message);
        startResend(15);
      }
    });

    /* ---------- รหัสผ่าน (ทางเลือกสำรอง) ---------- */

    $('password-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var email = $('pw-email').value.trim();
      var password = $('pw-pass').value;
      var button = $('pw-submit');
      msg('pw-msg', '');

      if (!EMAIL_RE.test(email)) {
        msg('pw-msg', 'รูปแบบอีเมลไม่ถูกต้อง');
        $('pw-email').focus();
        return;
      }
      if (!password) {
        msg('pw-msg', 'กรอกรหัสผ่าน');
        $('pw-pass').focus();
        return;
      }

      state.email = email;
      button.disabled = true;
      button.textContent = 'กำลังตรวจสอบ...';
      try {
        var data = await API.post('/auth/login', { email: email, password: password });
        if (data.otpRequired) {
          state.intent = 'login';
          openOtp(data, 'รหัสผ่านถูกต้อง — กรอกรหัส 6 หลักจากอีเมลเพื่อยืนยันตัวตน');
          return;
        }
        finish(data.token, 'เข้าสู่ระบบสำเร็จ');
      } catch (err) {
        msg('pw-msg', err.message);
      } finally {
        button.disabled = false;
        button.textContent = 'เข้าสู่ระบบด้วยรหัสผ่าน';
      }
    });

    $('pw-back').addEventListener('click', function () {
      msg('pw-msg', '');
      showPane('email');
      $('auth-email').focus();
    });

    /* ลืมรหัสผ่าน: ระบบไม่มี endpoint รีเซ็ต — ใช้ทางเข้า OTP ทางอีเมลแทนได้ทันที */
    $('pw-forgot').addEventListener('click', function () {
      state.intent = 'login';
      msg('pw-msg', '');
      showPane('email');
      msg('email-msg', 'ลืมรหัสผ่านไม่เป็นไร — ใส่อีเมลแล้วรับรหัส 6 หลักเพื่อเข้าสู่ระบบได้เลย', true);
      $('auth-email').focus();
    });

    function wireToggle(buttonId, inputId) {
      var button = $(buttonId);
      var input = $(inputId);
      if (!button || !input) return;
      button.addEventListener('click', function () {
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.textContent = show ? 'ซ่อน' : 'แสดง';
        button.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
      });
    }

    wireToggle('pw-toggle', 'pw-pass');
    wireToggle('sg-toggle', 'sg-pass');

    /* ---------- ขั้นที่ 3: ตั้งค่าบัญชีหลังยืนยันอีเมล ---------- */

    $('signup-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var password = $('sg-pass').value;
      var confirm = $('sg-pass2').value;
      var age = Number($('sg-age').value);
      var button = $('sg-submit');

      msg('sg-msg', '');
      fieldError('sg-pass-error', '');
      fieldError('sg-pass2-error', '');
      fieldError('sg-age-error', '');

      if (password.length < 6) {
        fieldError('sg-pass-error', 'รหัสผ่านอย่างน้อย 6 ตัวอักษร');
        $('sg-pass').focus();
        return;
      }
      if (password !== confirm) {
        fieldError('sg-pass2-error', 'รหัสผ่านทั้งสองช่องไม่ตรงกัน');
        $('sg-pass2').focus();
        return;
      }
      if (!(age >= 15)) {
        fieldError('sg-age-error', 'FLO-RENT เปิดให้ผู้ใช้อายุ 15 ปีขึ้นไป');
        $('sg-age').focus();
        return;
      }
      if (!state.signupToken) {
        msg('sg-msg', 'การยืนยันอีเมลหมดอายุแล้ว — เริ่มสมัครใหม่อีกครั้ง');
        showPane('email');
        return;
      }

      button.disabled = true;
      button.textContent = 'กำลังสร้างบัญชี...';
      try {
        var data = await API.post('/auth/register', {
          name: state.name,
          email: state.email,
          password: password,
          age: age,
          phone: $('sg-phone').value.trim(),
          signupToken: state.signupToken
        });
        finish(data.token, 'สมัครสมาชิกสำเร็จ — ยินดีต้อนรับ');
      } catch (err) {
        msg('sg-msg', err.message);
        button.disabled = false;
        button.textContent = 'สร้างบัญชีและเข้าสู่ระบบ';
      }
    });

    $('sg-back').addEventListener('click', function () {
      state.intent = 'signup';
      state.signupToken = '';
      msg('sg-msg', '');
      showPane('email');
      $('auth-email').focus();
    });

    showPane('email');
  }

  /* ---------- โปรไฟล์ ---------- */

  async function initProfile() {
    var root = $('profile-root');
    if (!root) return;

    if (!sessionUser) {
      root.innerHTML = loginPrompt('บัญชีของฉัน');
      return;
    }

    var flash = '';
    var myItems = [];
    var incoming = [];

    function incomingRow(booking) {
      var status = BOOKING_STATUS[booking.status] || BOOKING_STATUS.pending;
      var actions = '';
      if (booking.status === 'pending') {
        actions = '<div class="booking-actions">' +
          '<button class="btn-mini" type="button" data-owner-act="confirm" data-code="' + esc(booking.code) + '">ยืนยันการจอง</button>' +
          '<button class="btn-ghost" type="button" data-owner-act="reject" data-code="' + esc(booking.code) + '">ปฏิเสธ</button>' +
        '</div>';
      } else if (booking.status === 'active') {
        actions = '<p class="fine-print" style="margin-top:8px">ยืนยันแล้ว — รอผู้เช่าแจ้งคืนสินค้า</p>';
      } else if (booking.status === 'return_requested') {
        actions = '<div class="booking-actions">' +
          '<button class="btn-mini" type="button" data-owner-act="receive" data-code="' + esc(booking.code) + '">ยืนยันรับคืน</button>' +
          '<button class="btn-ghost" type="button" data-owner-act="dispute" data-code="' + esc(booking.code) + '">ยังไม่ได้รับของ</button>' +
        '</div>' +
        '<p class="fine-print" style="margin-top:8px">ผู้เช่าแจ้งคืนแล้ว — ยืนยันเพื่อคืนมัดจำ หรือแจ้งปัญหา' +
          (booking.disputeNote ? ' · ปัญหาที่แจ้งไว้: ' + esc(booking.disputeNote) : '') + '</p>';
      } else if (booking.status === 'returned') {
        actions = '<p class="fine-print" style="margin-top:8px">คืนของครบแล้ว · ได้รับค่าเช่า ' +
          baht(Number(booking.total || 0) - Number(booking.deposit || 0)) + '</p>';
      } else {
        actions = '<p class="fine-print" style="margin-top:8px">ถูกยกเลิกแล้ว · เงินถูกคืนผู้เช่าเต็มจำนวน</p>';
      }

      return '' +
        '<article class="booking-item">' +
          '<div class="booking-thumb thumb thumb-' + esc(booking.itemCat || 'general') + '">' +
            '<span aria-hidden="true">' + esc(booking.itemEmoji || '📦') + '</span>' +
          '</div>' +
          '<div>' +
            '<span class="booking-code">' + esc(booking.code) + ' · ขอเมื่อ ' + thDate(booking.createdAt) + '</span>' +
            '<h2><a href="item.html?id=' + encodeURIComponent(booking.itemId) + '">' + esc(booking.itemTitle) + '</a></h2>' +
            '<p class="item-meta">ผู้เช่า ' + esc(booking.userName || '—') + ' · ' + thDate(booking.start) + ' → ' +
              thDate(booking.end) + ' · ' + booking.days + ' วัน</p>' +
            actions +
          '</div>' +
          '<div class="booking-side">' +
            '<span class="badge ' + status.cls + '">' + status.label + '</span>' +
            '<strong>' + baht(booking.total) + '</strong>' +
            '<span class="booking-code">มัดจำ ' + baht(booking.deposit) + '</span>' +
          '</div>' +
        '</article>';
    }

    function incomingSection() {
      var waiting = incoming.filter(function (booking) { return booking.status === 'pending'; }).length;
      var returning = incoming.filter(function (booking) { return booking.status === 'return_requested'; }).length;
      return '' +
        '<section style="margin-top:26px">' +
          '<div class="section-head" style="margin-bottom:16px;padding-bottom:12px">' +
            '<h2 style="font-size:22px">คำขอจองที่เข้ามา' +
              (waiting ? ' <span class="badge badge-pending">รอยืนยัน ' + waiting + '</span>' : '') +
              (returning ? ' <span class="badge badge-pending">รอรับคืน ' + returning + '</span>' : '') + '</h2>' +
            '<span class="item-meta">ยืนยันหรือปฏิเสธได้จากที่นี่</span>' +
          '</div>' +
          (incoming.length
            ? '<div class="booking-list" id="incoming-bookings">' + incoming.map(incomingRow).join('') + '</div>'
            : '<p class="muted">ยังไม่มีคำขอจอง — เมื่อมีคนขอเช่าสินค้าของคุณ รายการจะขึ้นที่นี่</p>') +
        '</section>';
    }

    async function ownerAction(btn) {
      var action = btn.getAttribute('data-owner-act');
      var code = btn.getAttribute('data-code');
      var payload = { action: action };

      if (action === 'reject') {
        var sure = await confirmDialog({
          eyebrow: 'ปฏิเสธการจอง',
          title: 'ปฏิเสธการจอง ' + code + '?',
          message: 'ผู้เช่าจะได้รับเงินคืนทั้งจำนวน และการจองนี้จะถูกยกเลิก',
          confirmText: 'ปฏิเสธการจอง'
        });
        if (!sure) return;
      }

      if (action === 'receive') {
        var sureReceive = await confirmDialog({
          eyebrow: 'ยืนยันรับคืน',
          title: 'ยืนยันรับคืน ' + code + '?',
          message: 'ระบบจะคืนมัดจำให้ผู้เช่าและโอนค่าเช่าเข้ากระเป๋าของคุณ — ตรวจสภาพสินค้าก่อนยืนยัน',
          confirmText: 'ยืนยันรับคืน'
        });
        if (!sureReceive) return;
      }

      if (action === 'dispute') {
        var note = await promptDialog({
          eyebrow: 'ยังไม่ได้รับของ',
          title: 'แจ้งปัญหาการคืน ' + code,
          message: 'การจองจะกลับไปสถานะกำลังเช่า และมัดจำยังถูกกันไว้จนกว่าจะตกลงกันได้',
          label: 'ปัญหา / เหตุผล',
          confirmText: 'แจ้งปัญหา'
        });
        if (!note) return;
        payload.note = note;
      }

      var messages = {
        confirm: 'ยืนยันการจองแล้ว ผู้เช่าเห็นสถานะใหม่ทันที',
        reject: 'ปฏิเสธการจองและคืนเงินผู้เช่าแล้ว',
        receive: 'ยืนยันรับคืนแล้ว — คืนมัดจำและรับค่าเช่าเรียบร้อย',
        dispute: 'แจ้งปัญหาแล้ว การจองกลับไปสถานะกำลังเช่า'
      };

      btn.disabled = true;
      try {
        await API.patch('/owner/bookings/' + encodeURIComponent(code), payload);
        toast(messages[action] || 'อัปเดตสถานะแล้ว', 'ok');
        await render();
      } catch (err) {
        btn.disabled = false;
        showError(err);
      }
    }

    function manageCard(item) {
      var hidden = item.status === 'hidden';
      return '' +
        '<div class="manage-card">' +
          itemCard(item) +
          '<div class="manage-actions">' +
            '<button class="btn-ghost" type="button" data-manage="edit" data-id="' + esc(item.id) + '">แก้ไข</button>' +
            '<button class="btn-ghost" type="button" data-manage="toggle" data-id="' + esc(item.id) +
              '" data-value="' + (hidden ? 'published' : 'hidden') + '">' + (hidden ? 'เผยแพร่อีกครั้ง' : 'ซ่อนประกาศ') + '</button>' +
            '<button class="btn-ghost" type="button" data-manage="delete" data-id="' + esc(item.id) + '">ลบ</button>' +
          '</div>' +
        '</div>';
    }

    function openEditDialog(item) {
      var old = document.getElementById('edit-dialog');
      if (old) old.remove();
      var tags = Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || '');
      var dlg = document.createElement('dialog');
      dlg.id = 'edit-dialog';
      dlg.className = 'edit-dialog';
      dlg.innerHTML = '' +
        '<form method="dialog" id="edit-form" class="booking-form" style="margin:0">' +
          '<h2 class="display display-sm" style="font-size:24px">แก้ไขประกาศ</h2>' +
          '<label class="field"><span>ชื่อสินค้า</span><input type="text" id="ed-title" required value="' + esc(item.title) + '"></label>' +
          '<div class="form-grid">' +
            '<label class="field"><span>ราคา / วัน</span><input type="number" id="ed-price" min="0" step="10" required value="' + esc(item.price) + '"></label>' +
            '<label class="field"><span>เงินมัดจำ</span><input type="number" id="ed-deposit" min="0" step="100" required value="' + esc(item.deposit) + '"></label>' +
          '</div>' +
          '<label class="field"><span>พื้นที่ / จุดนัดรับ</span><input type="text" id="ed-location" value="' + esc(item.location) + '"></label>' +
          '<label class="field"><span>คำค้น (คั่นด้วยจุลภาค)</span><input type="text" id="ed-tags" value="' + esc(tags) + '"></label>' +
          '<label class="field"><span>รายละเอียด</span><textarea id="ed-desc">' + esc(item.desc) + '</textarea></label>' +
          '<p class="form-msg" id="ed-msg" role="status"></p>' +
          '<div class="form-actions" style="margin-top:4px">' +
            '<button class="btn btn-maroon btn-sm" type="submit">บันทึก</button>' +
            '<button class="btn btn-ghost" type="button" id="ed-cancel">ยกเลิก</button>' +
          '</div>' +
        '</form>';
      document.body.appendChild(dlg);
      dlg.querySelector('#ed-cancel').addEventListener('click', function () { dlg.close(); });
      dlg.addEventListener('close', function () { dlg.remove(); });
      dlg.querySelector('#edit-form').addEventListener('submit', async function (event) {
        event.preventDefault();
        var msg = $('ed-msg');
        var button = event.target.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          await API.patch('/items/' + encodeURIComponent(item.id), {
            title: $('ed-title').value.trim(),
            price: $('ed-price').value,
            deposit: $('ed-deposit').value,
            location: $('ed-location').value.trim(),
            tags: $('ed-tags').value,
            desc: $('ed-desc').value
          });
          dlg.close();
          toast('บันทึกประกาศแล้ว', 'ok');
          await render();
        } catch (err) {
          button.disabled = false;
          if (err.status === 401) { requireLogin(); return; }
          msg.textContent = err.message;
          msg.className = 'form-msg is-error';
        }
      });
      dlg.showModal();
    }

    async function manageItem(btn) {
      var act = btn.getAttribute('data-manage');
      var id = btn.getAttribute('data-id');
      var item = myItems.filter(function (entry) { return entry.id === id; })[0];
      if (!item) return;

      if (act === 'edit') { openEditDialog(item); return; }
      if (act === 'delete') {
        var sureDelete = await confirmDialog({
          eyebrow: 'ลบประกาศ',
          title: 'ลบประกาศนี้?',
          message: '“' + item.title + '” จะถูกลบถาวร กู้คืนไม่ได้',
          confirmText: 'ลบประกาศ'
        });
        if (!sureDelete) return;
      }

      btn.disabled = true;
      try {
        if (act === 'toggle') {
          await API.patch('/items/' + encodeURIComponent(id), { status: btn.getAttribute('data-value') });
          toast(btn.getAttribute('data-value') === 'hidden' ? 'ซ่อนประกาศแล้ว' : 'เผยแพร่ประกาศแล้ว', 'ok');
        } else {
          await API.del('/items/' + encodeURIComponent(id));
          toast('ลบประกาศแล้ว', 'ok');
        }
        await render();
      } catch (err) {
        btn.disabled = false;
        showError(err);
      }
    }

    function verifySection(user) {
      var info = user.verify || { status: 'unverified' };
      var head = '<div class="section-head" style="margin-bottom:16px;padding-bottom:12px">' +
        '<h2 style="font-size:22px">ยืนยันตัวตนด้วยบัตรประชาชน</h2></div>';

      if (info.status === 'verified') {
        return '<section class="form-card" id="verify" style="margin-bottom:26px">' + head +
          '<p><span class="badge badge-returned">ยืนยันตัวตนแล้ว</span> ' +
            (info.idMasked ? 'บัตร ' + esc(info.idMasked) : '') + '</p>' +
          '<p class="fine-print">เลขบัตรถูกเก็บแบบเข้ารหัสและปกปิด · รูปบัตรถูกลบภายใน 30 วันหลังตรวจ</p>' +
        '</section>';
      }

      if (info.status === 'pending') {
        return '<section class="form-card" id="verify" style="margin-bottom:26px">' + head +
          '<p><span class="badge badge-pending">รอแอดมินตรวจสอบ</span> ส่งเมื่อ ' +
            thDate(info.submittedAt) + '</p>' +
          '<p class="fine-print">ระหว่างรอตรวจยังจองหรือลงประกาศไม่ได้</p>' +
        '</section>';
      }

      var rejected = info.status === 'rejected'
        ? '<p class="fine-print" style="color:#a33">คำขอก่อนหน้าไม่ผ่าน: ' +
            esc(info.rejectReason || 'ไม่ระบุเหตุผล') + '</p>'
        : '';
      var grace = info.graceUntil && Date.parse(info.graceUntil) > Date.now()
        ? '<p class="fine-print">บัญชีเดิมใช้งานแบบปกติได้ถึง ' + thDate(info.graceUntil) +
            ' หลังจากนั้นต้องยืนยันตัวตนก่อนจองหรือลงประกาศ</p>'
        : '';

      return '<section class="form-card" id="verify" style="margin-bottom:26px">' + head +
        '<p class="muted">แนบเลขบัตรประชาชนและรูปบัตรเพื่อยืนยันตัวตน — ตรวจภายใน 1 วันทำการ</p>' +
        rejected + grace +
        '<form id="verify-form">' +
          '<div class="form-grid">' +
            '<label class="field"><span>เลขบัตรประชาชน</span>' +
              '<input type="text" id="vf-id" inputmode="numeric" maxlength="17" placeholder="1 2345 67890 12 3" required></label>' +
            '<label class="field"><span>ชื่อ-นามสกุลตามบัตร</span>' +
              '<input type="text" id="vf-name" maxlength="120" required></label>' +
            '<label class="field span-2"><span>รูปบัตรประชาชน (ด้านหน้า)</span>' +
              '<input type="file" id="vf-photo" accept="image/*" required></label>' +
          '</div>' +
          '<label class="field" style="display:flex;gap:8px;align-items:flex-start;margin-top:12px">' +
            '<input type="checkbox" id="vf-consent" style="width:auto;margin-top:3px">' +
            '<span>ยินยอมให้เก็บเลขบัตร (เข้ารหัส/ปกปิด) และรูปบัตรเพื่อยืนยันตัวตน และให้ลบรูปภายใน 30 วันหลังตรวจ</span>' +
          '</label>' +
          '<p class="form-msg" id="vf-msg"></p>' +
          '<div class="form-actions"><button class="btn btn-maroon" type="submit">ส่งคำขอยืนยัน</button></div>' +
        '</form>' +
      '</section>';
    }

    function bindVerifyForm() {
      var form = $('verify-form');
      if (!form) return;

      var photo = '';
      var input = $('vf-photo');
      if (input) {
        input.addEventListener('change', async function () {
          var file = (input.files || [])[0];
          if (!file) return;
          if (!/^image\//.test(file.type)) { toast('ไฟล์นี้ไม่ใช่รูปภาพ'); input.value = ''; return; }
          try {
            photo = await readPhoto(file);
            toast('แนบรูปบัตรแล้ว', 'ok');
          } catch (err) {
            toast(err && err.message ? err.message : 'อ่านรูปไม่สำเร็จ');
          }
        });
      }

      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        var msg = $('vf-msg');
        if (!photo) { setMsgOn(msg, 'กรุณาแนบรูปบัตรประชาชน'); return; }
        var consent = $('vf-consent');
        if (consent && !consent.checked) { setMsgOn(msg, 'กรุณายอมรับนโยบายการเก็บข้อมูลก่อนส่ง'); return; }

        var button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = 'กำลังส่ง...';
        try {
          await API.post('/verification', {
            idNumber: $('vf-id').value,
            fullName: $('vf-name').value,
            photo: photo
          });
          toast('ส่งคำขอยืนยันตัวตนแล้ว — รอแอดมินตรวจสอบ', 'ok');
          await render();
        } catch (err) {
          button.disabled = false;
          button.textContent = 'ส่งคำขอยืนยัน';
          if (err.status === 401) { requireLogin(); return; }
          setMsgOn(msg, err.message);
        }
      });
    }

    async function render() {
      root.innerHTML = '<p class="muted" style="padding:40px 0">กำลังโหลดบัญชี...</p>';
      var me;
      var mine;
      try {
        var results = await Promise.all([API.get('/me'), API.get('/items?mine=1&limit=100')]);
        me = results[0];
        mine = results[1].items;
        myItems = mine;
      } catch (err) {
        root.innerHTML = loginPrompt('โหลดบัญชีไม่สำเร็จ', err.message);
        return;
      }

      /* คำขอจองที่เข้ามา: ถ้าเซิร์ฟเวอร์รุ่นเก่ายังไม่มีเส้นนี้ หน้าบัญชีก็ต้องใช้งานได้ปกติ */
      incoming = [];
      try {
        incoming = (await API.get('/owner/bookings?limit=100')).bookings || [];
      } catch (err) {
        incoming = [];
      }

      var user = me.user;
      var stats = me.stats;
      var avatar = user.avatar || '🙂';

      root.innerHTML = '' +
        '<div class="page-head"><h1>บัญชีของฉัน</h1><p>ข้อมูลบัญชี คะแนนผู้เช่า และประกาศของคุณ</p></div>' +
        '<div class="profile-grid">' +
          '<aside class="profile-card">' +
            '<span class="avatar avatar-lg" aria-hidden="true">' + esc(avatar) + '</span>' +
            '<h2>' + esc(user.name) + '</h2>' +
            '<p class="item-meta">' + esc(user.email) + '</p>' +
            '<p class="item-meta"><span class="stars">★ ' + Number(user.rating || 5).toFixed(1) + '</span> (' +
              Number(user.reviews || 0) + ' รีวิว) · สมาชิกตั้งแต่ ' + thDate(user.joinedAt) + '</p>' +
            '<p class="item-meta">' + (user.age >= 15
              ? '✓ ยืนยันอายุแล้ว (' + esc(user.age) + ' ปี)'
              : 'ยังไม่ยืนยันอายุ') + ' · ' + esc(user.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้ทั่วไป') + '</p>' +
            '<div class="stat-grid">' +
              '<div class="stat"><b>' + stats.bookings + '</b><span>การจองทั้งหมด</span></div>' +
              '<div class="stat"><b>' + stats.active + '</b><span>กำลังดำเนินการ</span></div>' +
              '<div class="stat"><b>' + baht(stats.spent) + '</b><span>ยอดใช้จ่ายรวม</span></div>' +
              '<div class="stat"><b>' + stats.listings + '</b><span>ประกาศของฉัน</span></div>' +
            '</div>' +
            '<div class="wallet-mini"><span>FLO-RENT Wallet</span><b>' + flo(user.wallet) + '</b></div>' +
            '<div class="wallet-mini"><span>เครดิต</span><b>' + Number(user.credit || 0) + '/100 · ' +
              esc(user.creditLevel || '') + '</b></div>' +
            '<a class="btn btn-ghost btn-block" href="wallet.html" style="margin-top:10px">กระเป๋าเงิน · เติมเงิน</a>' +
            '<a class="btn btn-maroon btn-block" href="bookings.html" style="margin-top:16px">ดูประวัติการจอง</a>' +
            (user.role === 'admin' ? '<a class="btn btn-cream btn-block" href="admin.html" style="margin-top:10px">หน้าแอดมิน</a>' : '') +
            '<button class="btn btn-ghost btn-block" type="button" id="logout-btn" style="margin-top:10px">ออกจากระบบ</button>' +
          '</aside>' +
          '<div>' +
            verifySection(user) +
            '<form class="form-card" id="profile-form">' +
              '<div class="form-grid">' +
                '<label class="field span-2"><span>ชื่อที่ใช้แสดง</span><input type="text" id="pf-name" required value="' + esc(user.name) + '"></label>' +
                '<label class="field"><span>เบอร์โทร</span><input type="text" id="pf-phone" value="' + esc(user.phone) + '"></label>' +
                '<label class="field"><span>อายุ</span><input type="number" id="pf-age" min="15" max="99" value="' + esc(user.age) + '"></label>' +
                '<label class="field span-2"><span>พื้นที่</span><input type="text" id="pf-location" value="' + esc(user.location) + '"></label>' +
                '<label class="field span-2"><span>แนะนำตัวสั้น ๆ</span><textarea id="pf-bio" style="min-height:80px" placeholder="ความสนใจหรือรูปแบบการใช้งานของคุณ">' + esc(user.bio) + '</textarea></label>' +
                '<div class="field span-2"><span>รูปโปรไฟล์</span>' +
                  '<div class="avatar-pick" id="pf-avatar-pick">' +
                    AVATARS.map(function (emoji) {
                      return '<button type="button" class="' + (emoji === avatar ? 'is-active' : '') +
                        '" data-avatar="' + emoji + '">' + emoji + '</button>';
                    }).join('') +
                  '</div>' +
                  '<input type="hidden" id="pf-avatar" value="' + esc(avatar) + '">' +
                '</div>' +
              '</div>' +
              '<p class="form-msg' + (flash ? ' is-ok' : '') + '" id="pf-msg">' + esc(flash) + '</p>' +
              '<div class="form-actions">' +
                '<button class="btn btn-maroon" type="submit">บันทึกข้อมูล</button>' +
                '<a class="btn btn-outline" href="bookings.html">ประวัติการจอง</a>' +
              '</div>' +
            '</form>' +
            (mine.length || incoming.length ? incomingSection() : '') +
            '<section style="margin-top:26px">' +
              '<div class="section-head" style="margin-bottom:16px;padding-bottom:12px">' +
                '<h2 style="font-size:22px">ประกาศของฉัน</h2>' +
                '<a class="link-arrow" href="post.html">ลงประกาศใหม่ →</a>' +
              '</div>' +
              (mine.length
                ? '<div class="grid-3" id="my-items">' + mine.map(manageCard).join('') + '</div>'
                : '<p class="muted">ยังไม่มีประกาศ — ของที่ไม่ได้ใช้อยู่บ้านสามารถสร้างรายได้ให้คุณได้</p>') +
            '</section>' +
          '</div>' +
        '</div>';

      bind(user);
    }

    function bind(user) {
      var pick = $('pf-avatar-pick');
      if (pick) {
        pick.addEventListener('click', function (event) {
          var btn = event.target.closest('[data-avatar]');
          if (!btn) return;
          Array.prototype.forEach.call(pick.querySelectorAll('[data-avatar]'), function (node) {
            node.classList.toggle('is-active', node === btn);
          });
          $('pf-avatar').value = btn.getAttribute('data-avatar');
        });
      }

      var mineGrid = $('my-items');
      if (mineGrid) {
        mineGrid.addEventListener('click', function (event) {
          var btn = event.target.closest('[data-manage]');
          if (btn) manageItem(btn);
        });
      }

      var incomingList = $('incoming-bookings');
      if (incomingList) {
        incomingList.addEventListener('click', function (event) {
          var btn = event.target.closest('[data-owner-act]');
          if (btn) ownerAction(btn);
        });
      }

      var logout = $('logout-btn');
      if (logout) {
        logout.addEventListener('click', async function () {
          try { await API.post('/auth/logout'); } catch (err) { /* ออกได้แม้เซิร์ฟเวอร์ไม่ตอบ */ }
          API.setToken('');
          sessionUser = null;
          setFlash('ออกจากระบบแล้ว');
          window.location.href = 'index.html';
        });
      }

      var form = $('profile-form');
      if (!form) return;

      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        var msg = $('pf-msg');
        var name = $('pf-name').value.trim();
        var age = Number($('pf-age').value);
        if (name.length < 2) { setMsgOn(msg, 'กรุณากรอกชื่ออย่างน้อย 2 ตัวอักษร'); return; }
        if (!(age >= 15)) { setMsgOn(msg, 'FLO-RENT เปิดให้ผู้ใช้อายุ 15 ปีขึ้นไป'); return; }

        var button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = 'กำลังบันทึก...';
        try {
          var result = await API.patch('/me', {
            name: name,
            phone: $('pf-phone').value.trim(),
            age: age,
            location: $('pf-location').value.trim(),
            bio: $('pf-bio').value.trim(),
            avatar: $('pf-avatar').value
          });
          sessionUser = result.user;
          flash = 'บันทึกข้อมูลแล้ว';

          var chip = document.querySelector('.account-chip');
          if (chip) {
            chip.innerHTML = '<span class="avatar avatar-sm" aria-hidden="true">' + esc(sessionUser.avatar) +
              '</span>' + esc(String(sessionUser.name).split(' ')[0]);
          }
          toast('บันทึกข้อมูลบัญชีแล้ว', 'ok');
          await render();
        } catch (err) {
          button.disabled = false;
          button.textContent = 'บันทึกข้อมูล';
          if (err.status === 401) { requireLogin(); return; }
          setMsgOn(msg, err.message);
        }
      });

      bindVerifyForm();

      void user;
    }

    function setMsgOn(el, text) {
      if (!el) return;
      el.textContent = text || '';
      el.className = 'form-msg' + (text ? ' is-error' : '');
    }

    await render();
  }

  /* ---------- ประวัติการจอง ---------- */

  var BOOKING_STATUS = {
    pending: { label: 'รอยืนยัน', cls: 'badge-pending' },
    active: { label: 'กำลังเช่า', cls: 'badge-active' },
    return_requested: { label: 'แจ้งคืนแล้ว', cls: 'badge-pending' },
    returned: { label: 'คืนแล้ว', cls: 'badge-returned' },
    cancelled: { label: 'ยกเลิก', cls: 'badge-cancelled' }
  };

  async function initBookings() {
    var root = $('bookings-root');
    if (!root) return;

    if (!sessionUser) {
      root.innerHTML = loginPrompt('ประวัติการจอง');
      return;
    }

    var filter = 'all';
    var bookings = [];
    var TABS = [['all', 'ทั้งหมด'], ['pending', 'รอยืนยัน'], ['active', 'กำลังเช่า'], ['return_requested', 'แจ้งคืน'], ['returned', 'คืนแล้ว'], ['cancelled', 'ยกเลิก']];

    function row(booking) {
      var status = BOOKING_STATUS[booking.status] || BOOKING_STATUS.pending;
      var actions = '';

      if (booking.status === 'pending') {
        actions = '<div class="booking-actions">' +
          '<button class="btn-ghost" type="button" data-act="cancel" data-code="' + esc(booking.code) + '">ยกเลิกการจอง</button>' +
        '</div>' +
        '<p class="fine-print" style="margin-top:8px">รอผู้ให้เช่ายืนยัน — เงินถูกกันไว้ใน Wallet แล้ว</p>';
      } else if (booking.status === 'active') {
        actions = '<div class="booking-actions">' +
          '<button class="btn-mini" type="button" data-act="return" data-code="' + esc(booking.code) + '">แจ้งคืนสินค้า</button>' +
        '</div>' +
        '<p class="fine-print" style="margin-top:8px">หลังแจ้งคืน ผู้ให้เช่าต้องกดยืนยันรับคืนก่อน ระบบจึงคืนมัดจำ</p>';
      } else if (booking.status === 'return_requested') {
        actions = '<p class="fine-print" style="margin-top:8px">แจ้งคืนแล้ว · รอผู้ให้เช่ายืนยันรับคืน — มัดจำยังถูกกันไว้</p>';
      } else if (booking.status === 'returned') {
        actions = '<p class="fine-print" style="margin-top:8px">คืนของครบแล้ว · ได้รับมัดจำ ' +
          baht(booking.deposit) + ' คืน</p>';
      } else {
        actions = '<p class="fine-print" style="margin-top:8px">ยกเลิกแล้ว ไม่มีการเรียกเก็บเงิน</p>';
      }

      return '' +
        '<article class="booking-item">' +
          '<div class="booking-thumb thumb thumb-' + esc(booking.itemCat || 'general') + '">' +
            '<span aria-hidden="true">' + esc(booking.itemEmoji || '📦') + '</span>' +
          '</div>' +
          '<div>' +
            '<span class="booking-code">' + esc(booking.code) + ' · ' + thDate(booking.createdAt) + '</span>' +
            '<h2><a href="item.html?id=' + encodeURIComponent(booking.itemId) + '">' + esc(booking.itemTitle) + '</a></h2>' +
            '<p class="item-meta">' + esc(booking.owner || 'ผู้ให้เช่า') + ' · ' + thDate(booking.start) + ' → ' +
              thDate(booking.end) + ' · ' + booking.days + ' วัน</p>' +
            actions +
          '</div>' +
          '<div class="booking-side">' +
            '<span class="badge ' + status.cls + '">' + status.label + '</span>' +
            '<strong>' + baht(booking.total) + '</strong>' +
            '<span class="booking-code">มัดจำ ' + baht(booking.deposit) + '</span>' +
          '</div>' +
        '</article>';
    }

    function paint() {
      var shown = bookings.filter(function (booking) { return filter === 'all' || booking.status === filter; });
      var active = bookings.filter(function (b) {
        return b.status === 'active' || b.status === 'pending' || b.status === 'return_requested';
      }).length;
      var spent = bookings.reduce(function (sum, b) {
        return b.status === 'cancelled' ? sum : sum + Number(b.total || 0);
      }, 0);

      root.innerHTML = '' +
        '<div class="page-head">' +
          '<h1>ประวัติการจอง</h1>' +
          '<p>ติดตามสถานะการเช่า จัดการคำขอ และดูยอดที่ใช้ไปทั้งหมดของคุณ</p>' +
        '</div>' +
        '<div class="stat-strip">' +
          '<div class="stat"><b>' + bookings.length + '</b><span>การจองทั้งหมด</span></div>' +
          '<div class="stat"><b>' + active + '</b><span>กำลังดำเนินการ</span></div>' +
          '<div class="stat"><b>' + baht(spent) + '</b><span>ยอดใช้จ่ายรวม</span></div>' +
        '</div>' +
        '<div class="tabs">' +
          TABS.map(function (tab) {
            return '<button class="tab' + (filter === tab[0] ? ' is-active' : '') + '" type="button" data-tab="' +
              tab[0] + '">' + tab[1] + '</button>';
          }).join('') +
        '</div>' +
        (shown.length
          ? '<div class="booking-list">' + shown.map(row).join('') + '</div>'
          : '<div class="empty">' +
              '<h2 class="display display-sm">ยังไม่มีการจองในหมวดนี้</h2>' +
              '<p class="muted">เลือกของที่อยากใช้แล้วกดจอง ระบบจะเก็บประวัติไว้ที่นี่</p>' +
              '<a class="btn btn-cream" href="browse.html">ไปหาของที่อยากเช่า</a>' +
            '</div>');
    }

    async function load() {
      root.innerHTML = '<p class="muted" style="padding:40px 0">กำลังโหลดประวัติ...</p>';
      try {
        var data = await API.get('/bookings?limit=100');
        bookings = data.bookings;
        paint();
      } catch (err) {
        root.innerHTML = loginPrompt('โหลดประวัติไม่สำเร็จ', err.message);
      }
    }

    root.addEventListener('click', async function (event) {
      var tabBtn = event.target.closest('[data-tab]');
      if (tabBtn) {
        filter = tabBtn.getAttribute('data-tab');
        paint();
        return;
      }

      var actBtn = event.target.closest('[data-act]');
      if (!actBtn) return;
      var action = actBtn.getAttribute('data-act');
      var code = actBtn.getAttribute('data-code');
      if (action === 'cancel') {
        var sureCancel = await confirmDialog({
          eyebrow: 'ยกเลิกการจอง',
          title: 'ยกเลิกการจอง ' + code + '?',
          message: 'การจองนี้จะถูกยกเลิก และผู้ให้เช่าจะเห็นสถานะใหม่ทันที',
          confirmText: 'ยกเลิกการจอง'
        });
        if (!sureCancel) return;
      }

      if (action === 'return') {
        var sureReturn = await confirmDialog({
          eyebrow: 'แจ้งคืนสินค้า',
          title: 'แจ้งคืนการจอง ' + code + '?',
          message: 'ผู้ให้เช่าจะได้รับแจ้งและต้องกดยืนยันรับคืนก่อน ระบบจึงคืนมัดจำให้คุณ',
          confirmText: 'แจ้งคืนสินค้า'
        });
        if (!sureReturn) return;
      }

      actBtn.disabled = true;
      try {
        var result = await API.patch('/bookings/' + encodeURIComponent(code), { action: action });
        if (sessionUser && result && typeof result.wallet === 'number') {
          sessionUser.wallet = result.wallet;
          paintWalletChip();
        }
        toast(action === 'return' ? 'แจ้งคืนสินค้าแล้ว — รอผู้ให้เช่ายืนยันรับคืน' : 'ยกเลิกการจองแล้ว', 'ok');
        await load();
      } catch (err) {
        actBtn.disabled = false;
        showError(err);
      }
    });

    load();
  }

  /* ---------- กระเป๋าเงิน FLO-RENT ---------- */

  async function initWallet() {
    var root = $('wallet-root');
    if (!root) return;

    if (!sessionUser) {
      root.innerHTML = loginPrompt('FLO-RENT wallet', 'เข้าสู่ระบบเพื่อดูยอดเงิน เครดิต และรายการเดินบัญชี');
      return;
    }

    function txRow(entry) {
      var positive = entry.amount > 0;
      return '<tr>' +
        '<td>' + thDate(entry.createdAt) + '</td>' +
        '<td><span class="pill">' + esc(TX_LABELS[entry.type] || entry.type) + '</span></td>' +
        '<td class="' + (positive ? 'tx-in' : 'tx-out') + '">' + (positive ? '+' : '−') +
          Number(Math.abs(entry.amount)).toLocaleString('th-TH') + '</td>' +
        '<td>' + flo(entry.balanceAfter) + '</td>' +
        '<td>' + esc(entry.note) + (entry.ref ? ' <span class="item-meta">· ' + esc(entry.ref) + '</span>' : '') + '</td>' +
      '</tr>';
    }

    function creditPill(key) {
      if (key === 'excellent' || key === 'good') return 'pill-ok';
      if (key === 'fair') return 'pill-warn';
      return 'pill-bad';
    }

    async function load() {
      root.innerHTML = '<p class="muted" style="padding:30px 0">กำลังโหลดกระเป๋าเงิน...</p>';

      var data;
      try {
        data = await API.get('/wallet');
      } catch (err) {
        root.innerHTML = loginPrompt('โหลดกระเป๋าเงินไม่สำเร็จ', err.message);
        return;
      }

      if (sessionUser) {
        sessionUser.wallet = data.balance;
        sessionUser.credit = data.credit;
      }

      paint(data);
    }

    function paint(data) {
      var level = data.level || { key: 'good', label: 'ดี' };
      var holds = data.holds || [];
      var tx = data.transactions || [];
      var credit = Math.max(0, Math.min(100, Number(data.credit) || 0));

      root.innerHTML = '' +
        '<div class="wallet-grid">' +
          '<section class="wallet-card">' +
            '<p class="eyebrow">FLO-RENT wallet</p>' +
            '<p class="wallet-balance">' + flo(data.balance) + '</p>' +
            '<p class="item-fine">1 FLO = 1 บาท · ใช้จ่ายได้ภายในเว็บเท่านั้น</p>' +
            '<form id="topup-form" class="wallet-topup">' +
              '<div class="wallet-presets">' +
                [500, 1000, 2000].map(function (amount) {
                  return '<button type="button" class="btn btn-ghost btn-sm" data-topup="' + amount + '">+' +
                    amount.toLocaleString('th-TH') + '</button>';
                }).join('') +
              '</div>' +
              '<label class="field"><span>จำนวนที่ต้องการเติม (FLO)</span>' +
                '<input type="number" id="topup-amount" min="1" max="50000" step="1" required placeholder="1000"></label>' +
              '<button class="btn btn-maroon" type="submit">เติมเงินเข้ากระเป๋า</button>' +
            '</form>' +
          '</section>' +
          '<section class="wallet-card">' +
            '<p class="eyebrow">เครดิตผู้ใช้</p>' +
            '<p class="wallet-balance">' + Number(data.credit) + '<span>/100</span></p>' +
            '<span class="pill ' + creditPill(level.key) + '" style="justify-self:start">' + esc(level.label) + '</span>' +
            '<div class="credit-bar"><i style="width:' + credit + '%"></i></div>' +
            '<ul class="credit-rules">' +
              '<li>เกณฑ์จองขั้นต่ำ <strong>' + Number(data.minBookingCredit || 40) + '</strong> คะแนน</li>' +
              '<li>คืนของครบ <strong>+2</strong> · ยกเลิกการจอง <strong>−4</strong></li>' +
              '<li>เครดิตต่ำกว่าเกณฑ์จะจองสินค้าใหม่ไม่ได้</li>' +
            '</ul>' +
          '</section>' +
        '</div>' +
        '<section class="wallet-panel">' +
          '<h2>เงินที่กันไว้ (' + holds.length + ')</h2>' +
          (holds.length
            ? '<div class="table-wrap"><table class="admin-table"><thead><tr>' +
                '<th>การจอง</th><th>ค่าเช่า</th><th>มัดจำ</th><th>รวมที่กัน</th><th>เมื่อ</th>' +
              '</tr></thead><tbody>' +
              holds.map(function (hold) {
                return '<tr>' +
                  '<td class="row-title">' + esc(hold.bookingCode) + '</td>' +
                  '<td>' + baht(hold.rent) + '</td>' +
                  '<td>' + baht(hold.deposit) + '</td>' +
                  '<td>' + baht(hold.rent + hold.deposit) + '</td>' +
                  '<td>' + thDate(hold.createdAt) + '</td>' +
                '</tr>';
              }).join('') + '</tbody></table></div>'
            : '<p class="muted">ไม่มีเงินที่ถูกกันไว้ตอนนี้ — เงินมัดจำจะถูกกันเมื่อคุณจองสินค้า</p>') +
        '</section>' +
        '<section class="wallet-panel">' +
          '<h2>รายการเดินบัญชี</h2>' +
          (tx.length
            ? '<div class="table-wrap"><table class="admin-table"><thead><tr>' +
                '<th>วันที่</th><th>ประเภท</th><th>จำนวน</th><th>คงเหลือ</th><th>รายละเอียด</th>' +
              '</tr></thead><tbody>' + tx.map(txRow).join('') + '</tbody></table></div>'
            : '<p class="muted">ยังไม่มีรายการในกระเป๋า</p>') +
        '</section>';

      var form = $('topup-form');
      if (form) {
        form.addEventListener('submit', async function (event) {
          event.preventDefault();
          var input = $('topup-amount');
          var amount = Number(input ? input.value : 0);
          if (!(amount >= 1)) { toast('กรอกจำนวนเงินที่ต้องการเติมก่อน'); return; }

          var button = form.querySelector('button[type="submit"]');
          button.disabled = true;
          try {
            var result = await API.post('/wallet/topup', { amount: amount });
            if (sessionUser) { sessionUser.wallet = result.balance; paintWalletChip(); }
            toast('เติมเงิน ' + flo(amount) + ' สำเร็จ · คงเหลือ ' + flo(result.balance), 'ok');
            await load();
          } catch (err) {
            button.disabled = false;
            if (err.status === 401) { requireLogin(); return; }
            showError(err);
          }
        });
      }

      Array.prototype.forEach.call(root.querySelectorAll('[data-topup]'), function (btn) {
        btn.addEventListener('click', function () {
          var input = $('topup-amount');
          if (input) input.value = btn.getAttribute('data-topup');
        });
      });
    }

    load();
  }

  /* ---------- หาคนทำงาน / ลงหางาน ---------- */

  var WORK_CATS = null;

  async function loadWorkCats() {
    if (WORK_CATS) return WORK_CATS;
    var data = await API.get('/work-categories');
    WORK_CATS = data.categories || [];
    return WORK_CATS;
  }

  /* dialog เลือกจำนวนวันก่อนจ้าง (คืน { days } หรือ null) */
  function hireDialog(worker) {
    return new Promise(function (resolve) {
      var dlg = document.createElement('dialog');
      dlg.className = 'confirm-dialog';
      dlg.innerHTML = '' +
        '<p class="eyebrow">จ้างงาน · ' + esc(worker.catName) + '</p>' +
        '<h2 class="display display-sm" style="font-size:24px">' + esc(worker.name) + '</h2>' +
        '<p class="confirm-text">' + baht(worker.rate) + ' / วัน · ' + esc(worker.location) + '</p>' +
        '<label class="field" style="text-align:left;margin-top:14px"><span>จำนวนวัน</span>' +
          '<input type="number" id="hire-days" min="1" max="30" step="1" value="1"></label>' +
        '<div class="summary-row summary-total" style="margin:6px 0 0"><span>รวมทั้งสิ้น</span>' +
          '<span id="hire-total">' + baht(worker.rate) + '</span></div>' +
        '<p class="fine-print">หักจาก FLO-RENT Wallet ทันที · ยกเลิกก่อนเริ่มงานได้เต็มจำนวน</p>' +
        '<div class="confirm-actions">' +
          '<button class="btn btn-ghost" type="button" data-confirm="no">ยกเลิก</button>' +
          '<button class="btn btn-maroon" type="button" data-confirm="yes">ยืนยันการจ้าง</button>' +
        '</div>';

      var daysInput = dlg.querySelector('#hire-days');
      var totalEl = dlg.querySelector('#hire-total');
      var settled = false;

      function finish(value) {
        if (settled) return;
        settled = true;
        if (dlg.open) dlg.close();
        dlg.remove();
        resolve(value);
      }

      daysInput.addEventListener('input', function () {
        var days = Math.max(1, Math.min(30, Number(daysInput.value) || 1));
        totalEl.textContent = baht(worker.rate * days);
      });

      dlg.addEventListener('click', function (event) {
        if (event.target === dlg) { finish(null); return; }
        var btn = event.target.closest('[data-confirm]');
        if (!btn) return;
        if (btn.getAttribute('data-confirm') !== 'yes') { finish(null); return; }
        var days = Math.max(1, Math.min(30, Number(daysInput.value) || 1));
        finish({ days: days });
      });
      dlg.addEventListener('cancel', function (event) {
        event.preventDefault();
        finish(null);
      });

      document.body.appendChild(dlg);
      dlg.showModal();
      daysInput.focus();
      daysInput.select();
    });
  }

  async function initWork() {
    var grid = $('worker-grid');
    if (!grid) return;

    var qEl = $('worker-q');
    var countEl = $('worker-count');
    var emptyEl = $('worker-empty');
    var chipsEl = $('worker-cats');
    var filterForm = $('worker-filter');
    var hireList = $('hire-list');
    var byId = {};

    var state = { q: '', cat: param('cat') || 'all' };
    if (qEl) qEl.value = state.q;

    var cats = [];
    try { cats = await loadWorkCats(); } catch (err) { cats = []; }

    function chipsMarkup() {
      return '<button type="button" class="chip chip-filter' + (state.cat === 'all' ? ' is-active' : '') + '" data-cat="all">ทั้งหมด</button>' +
        cats.map(function (cat) {
          return '<button type="button" class="chip chip-filter' + (state.cat === cat.key ? ' is-active' : '') + '" data-cat="' + esc(cat.key) + '">' +
            cat.emoji + ' ' + esc(cat.name) + '</button>';
        }).join('');
    }

    if (chipsEl) chipsEl.innerHTML = chipsMarkup();

    function workerCard(worker) {
      return '' +
        '<article class="worker-card">' +
          '<span class="worker-emoji" aria-hidden="true">' + esc(worker.avatar || worker.catEmoji) + '</span>' +
          '<h3 class="worker-name">' + esc(worker.name) + '</h3>' +
          '<p class="item-meta">' + esc(worker.catName) + ' · <span class="stars">★ ' +
            Number(worker.rating || 0).toFixed(1) + '</span> <span class="muted">(' + Number(worker.reviews || 0) + ')</span></p>' +
          '<p class="worker-rate"><strong>' + baht(worker.rate) + '</strong><span>/วัน</span></p>' +
          '<p class="worker-bio">' + esc(worker.bio) + '</p>' +
          '<p class="item-fine">📍 ' + esc(worker.location) + '</p>' +
          '<button class="btn btn-maroon btn-sm" type="button" data-hire="' + esc(worker.id) + '">จ้างงาน</button>' +
        '</article>';
    }

    async function render() {
      grid.innerHTML = '<p class="muted">กำลังโหลด...</p>';
      try {
        var query = new URLSearchParams();
        query.set('cat', state.cat);
        if (state.q) query.set('q', state.q);
        var data = await API.get('/workers?' + query.toString());
        byId = {};
        data.workers.forEach(function (worker) { byId[worker.id] = worker; });
        grid.innerHTML = data.workers.map(workerCard).join('');
        grid.hidden = data.workers.length === 0;
        if (emptyEl) emptyEl.hidden = data.workers.length !== 0;
        if (countEl) countEl.textContent = 'พบ ' + data.count + ' คน';
      } catch (err) {
        grid.innerHTML = '<p class="muted">โหลดรายชื่อไม่สำเร็จ</p>';
        showError(err);
      }
    }

    if (chipsEl) {
      chipsEl.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-cat]');
        if (!btn) return;
        state.cat = btn.getAttribute('data-cat');
        chipsEl.innerHTML = chipsMarkup();
        render();
      });
    }

    if (filterForm) {
      filterForm.addEventListener('submit', function (event) {
        event.preventDefault();
        state.q = qEl ? qEl.value.trim() : '';
        render();
      });
    }

    async function loadHires() {
      if (!hireList) return;
      if (!sessionUser) {
        hireList.innerHTML = '<p class="muted" style="font-size:13.5px">เข้าสู่ระบบเพื่อดูประวัติการจ้างของคุณ</p>';
        return;
      }
      try {
        var data = await API.get('/hires');
        if (!data.hires.length) {
          hireList.innerHTML = '<p class="muted" style="font-size:13.5px">ยังไม่มีการจ้าง — เลือกคนทำงานด้านบนแล้วกด “จ้างงาน”</p>';
          return;
        }
        hireList.innerHTML = '' +
          '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
            '<th>รหัส</th><th>คนทำงาน</th><th>จำนวน</th><th>ยอดชำระ</th><th>สถานะ</th><th></th>' +
          '</tr></thead><tbody>' +
            data.hires.map(function (hire) {
              var status = hire.status === 'pending' ? 'รอเริ่มงาน' : (hire.status === 'cancelled' ? 'ยกเลิกแล้ว' : hire.status);
              return '<tr>' +
                '<td>' + esc(hire.code) + '</td>' +
                '<td>' + esc(hire.workerName) +
                  '<div class="muted" style="font-size:11.5px">' + esc(hire.workerCatName) + '</div></td>' +
                '<td>' + Number(hire.days) + ' วัน</td>' +
                '<td>' + flo(hire.total) + '</td>' +
                '<td>' + esc(status) + '</td>' +
                '<td>' + (hire.status === 'pending'
                  ? '<button class="btn btn-ghost btn-sm" type="button" data-cancel-hire="' + esc(hire.code) + '">ยกเลิก</button>'
                  : '') + '</td>' +
              '</tr>';
            }).join('') +
          '</tbody></table></div>';
      } catch (err) {
        hireList.innerHTML = '<p class="muted" style="font-size:13.5px">โหลดประวัติการจ้างไม่สำเร็จ</p>';
      }
    }

    grid.addEventListener('click', async function (event) {
      var btn = event.target.closest('[data-hire]');
      if (!btn) return;
      if (!sessionUser) { requireLogin(); return; }

      var worker = byId[btn.getAttribute('data-hire')];
      if (!worker) return;

      var picked = await hireDialog(worker);
      if (!picked) return;

      btn.disabled = true;
      try {
        var result = await API.post('/hires', { workerId: worker.id, days: picked.days });
        if (sessionUser && typeof result.wallet === 'number') {
          sessionUser.wallet = result.wallet;
          paintWalletChip();
        }
        toast('จ้าง ' + worker.name + ' แล้ว · ' + result.hire.code, 'ok');
        await loadHires();
      } catch (err) {
        if (err.status === 401) { requireLogin(); return; }
        showError(err);
      } finally {
        btn.disabled = false;
      }
    });

    if (hireList) {
      hireList.addEventListener('click', async function (event) {
        var btn = event.target.closest('[data-cancel-hire]');
        if (!btn) return;
        var code = btn.getAttribute('data-cancel-hire');
        var ok = await confirmDialog({
          eyebrow: 'ยกเลิกการจ้าง',
          title: 'ยกเลิก ' + code + '?',
          message: 'เงินค่าจ้างจะถูกคืนเข้ากระเป๋าเต็มจำนวน และคนทำงานจะเห็นว่ายกเลิกแล้ว',
          confirmText: 'ยกเลิกการจ้าง',
          cancelText: 'ปิด'
        });
        if (!ok) return;

        btn.disabled = true;
        try {
          var result = await API.patch('/hires/' + encodeURIComponent(code), { action: 'cancel' });
          if (sessionUser && typeof result.wallet === 'number') {
            sessionUser.wallet = result.wallet;
            paintWalletChip();
          }
          toast('ยกเลิกการจ้างแล้ว · คืน ' + flo(result.hire.total), 'ok');
          await loadHires();
        } catch (err) {
          btn.disabled = false;
          showError(err);
        }
      });
    }

    render();
    loadHires();
  }

  async function initJobs() {
    var form = $('job-form');
    if (!form) return;

    var catSelect = $('job-cat');
    var listEl = $('job-list');
    var chipsEl = $('job-cats');
    var msg = $('job-msg');
    var state = { cat: param('cat') || 'all' };

    var cats = [];
    try { cats = await loadWorkCats(); } catch (err) { cats = []; }

    catSelect.innerHTML = cats.map(function (cat) {
      return '<option value="' + esc(cat.key) + '">' + cat.emoji + ' ' + esc(cat.name) + '</option>';
    }).join('');

    function chipsMarkup() {
      return '<button type="button" class="chip chip-filter' + (state.cat === 'all' ? ' is-active' : '') + '" data-cat="all">ทั้งหมด</button>' +
        cats.map(function (cat) {
          return '<button type="button" class="chip chip-filter' + (state.cat === cat.key ? ' is-active' : '') + '" data-cat="' + esc(cat.key) + '">' +
            cat.emoji + ' ' + esc(cat.name) + '</button>';
        }).join('');
    }

    function jobCard(job) {
      var mine = !!(job.userId && sessionUser && job.userId === sessionUser.id);
      return '' +
        '<article class="job-card">' +
          '<div class="job-main">' +
            '<h3 class="job-title">' + esc(job.title) + '</h3>' +
            '<p class="item-meta">' + job.catEmoji + ' ' + esc(job.catName) + ' · โดย ' + esc(job.name) +
              (mine ? ' <span class="chip chip-light">ของคุณ</span>' : '') + '</p>' +
            '<p class="job-desc">' + esc(job.desc) + '</p>' +
            '<p class="item-fine">📍 ' + esc(job.location) + (job.start ? ' · เริ่ม ' + thDate(job.start) : '') + '</p>' +
          '</div>' +
          '<div class="job-side">' +
            '<p class="worker-rate"><strong>' + baht(job.rate) + '</strong><span>/วัน</span></p>' +
            '<p class="item-fine">' + Number(job.days) + ' วัน · รวม ' + baht(job.total) + '</p>' +
            '<a class="btn btn-ghost btn-sm" href="work.html?cat=' + encodeURIComponent(job.cat) + '">หาคนทำงาน</a>' +
          '</div>' +
        '</article>';
    }

    async function loadJobs() {
      if (!listEl) return;
      listEl.innerHTML = '<p class="muted">กำลังโหลด...</p>';
      try {
        var data = await API.get('/jobs?cat=' + encodeURIComponent(state.cat));
        if (!data.jobs.length) {
          listEl.innerHTML = '<p class="muted">ยังไม่มีงานในหมวดนี้ — ประกาศของคุณจะเป็นรายการแรก</p>';
          return;
        }
        listEl.innerHTML = data.jobs.map(jobCard).join('');
      } catch (err) {
        listEl.innerHTML = '<p class="muted">โหลดรายการงานไม่สำเร็จ</p>';
        showError(err);
      }
    }

    if (chipsEl) {
      chipsEl.innerHTML = chipsMarkup();
      chipsEl.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-cat]');
        if (!btn) return;
        state.cat = btn.getAttribute('data-cat');
        chipsEl.innerHTML = chipsMarkup();
        loadJobs();
      });
    }

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!sessionUser) { requireLogin(); return; }

      var button = form.querySelector('button[type="submit"]');
      if (msg) { msg.textContent = ''; msg.className = 'form-msg'; }
      button.disabled = true;
      button.textContent = 'กำลังเผยแพร่...';

      try {
        var result = await API.post('/jobs', {
          title: $('job-title').value,
          cat: catSelect.value,
          rate: $('job-rate').value,
          days: $('job-days').value,
          start: $('job-start').value,
          location: $('job-location').value,
          desc: $('job-desc').value
        });
        toast('ประกาศหางานแล้ว · ' + result.job.title, 'ok');
        form.reset();
        if ($('job-days')) $('job-days').value = '1';
        button.disabled = false;
        button.textContent = 'เผยแพร่ประกาศหางาน';
        state.cat = 'all';
        if (chipsEl) chipsEl.innerHTML = chipsMarkup();
        await loadJobs();
      } catch (err) {
        button.disabled = false;
        button.textContent = 'เผยแพร่ประกาศหางาน';
        if (err.status === 401) { requireLogin(); return; }
        if (msg) { msg.textContent = err.message; msg.className = 'form-msg is-error'; }
        showError(err);
      }
    });

    loadJobs();
  }

  /* ---------- bootstrap ---------- */

  document.addEventListener('DOMContentLoaded', function () {
    if (window.location.protocol === 'file:') {
      bootHelp();
      return;
    }

    initHeader().then(async function () {
      await loadCategories();
      showFlash();
      initHome().catch(showError);
      initBrowse().catch(showError);
      initDetail().catch(showError);
      initPost().catch(showError);
      initLookFor().catch(showError);
      initLogin().catch(showError);
      initProfile().catch(showError);
      initBookings().catch(showError);
      initWallet().catch(showError);
      initWork().catch(showError);
      initJobs().catch(showError);
    });
  });
})();
