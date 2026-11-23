/* FLO-RENT — หน้าแอดมิน (ใช้ API เดียวกับหน้าเว็บ) */
(function () {
  'use strict';

  var API = window.FLO_API;
  var root = document.getElementById('admin-root');
  if (!root) return;

  var TABS = [
    ['overview', 'ภาพรวม'],
    ['users', 'ผู้ใช้'],
    ['items', 'ประกาศ'],
    ['categories', 'หมวดหมู่'],
    ['bookings', 'การจอง'],
    ['requests', 'คำขอตามหา'],
    ['wallet', 'กระเป๋าเงิน'],
    ['logs', 'ล็อกระบบ']
  ];

  var TX_LABELS = {
    topup: 'เติมเงิน',
    hold: 'กันเงินจอง',
    refund: 'คืนเงิน',
    'deposit-release': 'คืนมัดจำ',
    payout: 'รับค่าเช่า'
  };

  var STATUS = {
    pending: { label: 'รอยืนยัน', cls: 'badge-pending' },
    active: { label: 'กำลังเช่า', cls: 'badge-active' },
    return_requested: { label: 'แจ้งคืนแล้ว', cls: 'badge-pending' },
    returned: { label: 'คืนแล้ว', cls: 'badge-returned' },
    cancelled: { label: 'ยกเลิก', cls: 'badge-cancelled' }
  };

  var CATS = window.FLO_CATEGORIES || [];
  var tab = 'overview';
  var me = null;
  var stats = null;
  var users = [];
  var items = [];
  var bookings = [];
  var requests = [];
  var walletData = null;
  var logs = [];
  var userQuery = '';
  var itemQuery = '';
  var bookingFilter = 'all';
  var cats = { items: [], jobs: [] };
  var catEdit = null;
  var busy = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function baht(number) {
    return '฿' + Number(number || 0).toLocaleString('th-TH');
  }

  function flo(number) {
    return 'FLO ' + Number(number || 0).toLocaleString('th-TH');
  }

  function thDate(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  }

  function catName(key) {
    for (var i = 0; i < CATS.length; i += 1) {
      if (CATS[i].key === key) return CATS[i].name;
    }
    return 'อื่น ๆ';
  }

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

  function gate(title, message, href) {
    return '' +
      '<div class="empty">' +
        '<h1 class="display display-sm">' + esc(title) + '</h1>' +
        '<p class="muted">' + esc(message) + '</p>' +
        '<div class="success-actions">' +
          '<a class="btn btn-cream" href="' + (href || 'login.html?next=admin.html') + '">' +
            (href ? 'กลับหน้าแรก' : 'เข้าสู่ระบบ') + '</a>' +
        '</div>' +
      '</div>';
  }

  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    if (window.location.protocol === 'file:') {
      root.innerHTML = gate('ต้องเปิดผ่านเซิร์ฟเวอร์', 'รัน npm start แล้วเปิด http://127.0.0.1:4173/admin.html', 'index.html');
      return;
    }

    root.innerHTML = '<p class="muted" style="padding:40px 0">กำลังตรวจสอบสิทธิ์...</p>';

    try {
      var data = await API.get('/me');
      me = data.user;
    } catch (err) {
      root.innerHTML = gate('ต้องเข้าสู่ระบบก่อน', 'หน้าแอดมินสำหรับผู้ดูแลระบบเท่านั้น');
      return;
    }

    if (me.role !== 'admin') {
      root.innerHTML = gate('ไม่มีสิทธิ์เข้าถึง', 'บัญชีนี้ไม่ใช่ผู้ดูแลระบบ — เข้าสู่ระบบด้วย admin@flo-rent.co', 'index.html');
      return;
    }

    await refresh();
  }

  function query(path) {
    return path + (path.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
  }

  async function refresh() {
    root.setAttribute('aria-busy', 'true');
    try {
      if (tab === 'overview') {
        stats = await API.get(query('/admin/stats'));
      } else if (tab === 'users') {
        users = (await API.get(query('/admin/users?q=' + encodeURIComponent(userQuery)))).users;
      } else if (tab === 'items') {
        await loadCats();
        items = (await API.get(query('/admin/items?q=' + encodeURIComponent(itemQuery)))).items;
      } else if (tab === 'categories') {
        await loadCats();
      } else if (tab === 'bookings') {
        bookings = (await API.get(query('/admin/bookings?status=' + encodeURIComponent(bookingFilter)))).bookings;
      } else if (tab === 'requests') {
        requests = (await API.get(query('/admin/requests'))).requests;
      } else if (tab === 'wallet') {
        walletData = await API.get(query('/admin/wallet'));
      } else if (tab === 'logs') {
        logs = (await API.get(query('/admin/logs'))).logs;
      }
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        root.innerHTML = gate('ไม่มีสิทธิ์เข้าถึง', err.message, 'index.html');
        return;
      }
      toast(err.message || 'โหลดข้อมูลไม่สำเร็จ');
    }
    root.removeAttribute('aria-busy');
    paint();
  }

  async function loadCats() {
    var data = await API.get(query('/admin/categories'));
    cats = { items: data.items || [], jobs: data.jobs || [] };
    CATS = cats.items;
  }

  function paint() {
    root.innerHTML = '' +
      '<div class="page-head">' +
        '<h1>หลังบ้าน</h1>' +
        '<p>ภาพรวมระบบ จัดการผู้ใช้ ประกาศ การจอง และคำขอตามหา · เข้าใช้ในนาม ' + esc(me.name) + '</p>' +
      '</div>' +
      '<div class="admin-tabs">' +
        TABS.map(function (entry) {
          return '<button class="tab' + (tab === entry[0] ? ' is-active' : '') + '" type="button" data-tab="' +
            entry[0] + '">' + entry[1] + '</button>';
        }).join('') +
      '</div>' +
      '<div id="admin-panel">' + panel() + '</div>';
  }

  function statCard(value, label) {
    return '<div class="admin-stat"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }

  function emptyRow(cols, message) {
    return '<tr><td colspan="' + cols + '"><div class="admin-empty">' + esc(message || 'ไม่มีข้อมูล') + '</div></td></tr>';
  }

  function panel() {
    if (tab === 'overview') return overviewPanel();
    if (tab === 'users') return usersPanel();
    if (tab === 'items') return itemsPanel();
    if (tab === 'categories') return categoriesPanel();
    if (tab === 'bookings') return bookingsPanel();
    if (tab === 'requests') return requestsPanel();
    if (tab === 'wallet') return walletPanel();
    return logsPanel();
  }

  /* ---- overview ---- */

  function overviewPanel() {
    if (!stats) return '<p class="muted">กำลังโหลด...</p>';
    var s = stats;

    var recent = s.recentBookings.length
      ? s.recentBookings.map(function (booking) {
        var status = STATUS[booking.status] || STATUS.pending;
        return '<tr>' +
          '<td class="row-title">' + esc(booking.code) + '</td>' +
          '<td>' + esc(booking.itemTitle) + '</td>' +
          '<td>' + esc(booking.userName || '—') + '</td>' +
          '<td>' + baht(booking.total) + '</td>' +
          '<td><span class="badge ' + status.cls + '">' + status.label + '</span></td>' +
          '<td>' + thDate(booking.createdAt) + '</td>' +
        '</tr>';
      }).join('')
      : emptyRow(6, 'ยังไม่มีการจอง');

    return '' +
      '<div class="admin-stat-grid">' +
        statCard(s.users, 'ผู้ใช้ทั้งหมด (' + s.suspended + ' ถูกระงับ)') +
        statCard(s.items, 'ประกาศ (' + s.published + ' เผยแพร่ · ' + s.hidden + ' ซ่อน)') +
        statCard(s.bookings, 'การจองทั้งหมด') +
        statCard(baht(s.revenue), 'ยอดรวมที่ไม่ถูกยกเลิก') +
        statCard(s.byStatus.pending + s.byStatus.active + s.byStatus.return_requested, 'รอดำเนินการ') +
        statCard(s.requests, 'คำขอตามหา') +
        statCard(flo(s.walletTotal || 0), 'ยอดเงินในกระเป๋ารวม') +
        statCard(flo(s.escrow || 0), 'เงินที่กันไว้ (' + (s.activeHolds || 0) + ' รายการ)') +
      '</div>' +
      '<div class="admin-panel">' +
        '<h2>การจองล่าสุด</h2>' +
        '<p class="item-meta">สถานะ: รอยืนยัน ' + s.byStatus.pending + ' · กำลังเช่า ' + s.byStatus.active +
          ' · แจ้งคืนแล้ว ' + s.byStatus.return_requested + ' · คืนแล้ว ' + s.byStatus.returned +
          ' · ยกเลิก ' + s.byStatus.cancelled + '</p>' +
        '<div class="table-wrap"><table class="admin-table">' +
          '<thead><tr><th>รหัส</th><th>สินค้า</th><th>ผู้เช่า</th><th>ยอดรวม</th><th>สถานะ</th><th>วันที่จอง</th></tr></thead>' +
          '<tbody>' + recent + '</tbody>' +
        '</table></div>' +
      '</div>';
  }

  /* ---- categories ---- */

  function catRow(cat, kind) {
    return '<tr>' +
      '<td style="font-size:18px">' + esc(cat.emoji) + '</td>' +
      '<td class="row-title">' + esc(cat.name) +
        '<div class="muted" style="font-size:11.5px">' + esc(cat.key) + '</div></td>' +
      '<td>' + esc(cat.sub || '—') + '</td>' +
      '<td>' + Number(cat.usage || 0) + '</td>' +
      '<td>' +
        '<button class="btn-ghost" type="button" data-cat-edit="' + kind + ':' + esc(cat.key) + '">แก้ไข</button>' +
        '<button class="btn-ghost" type="button" data-cat-delete="' + kind + ':' + esc(cat.key) + '">ลบ</button>' +
      '</td>' +
    '</tr>';
  }

  function catForm(kind) {
    var editing = catEdit && catEdit.kind === kind
      ? (cats[kind] || []).find(function (cat) { return cat.key === catEdit.key; })
      : null;

    return '' +
      '<form class="admin-toolbar" data-cat-form="' + kind + '" style="margin-top:16px;align-items:flex-end;flex-wrap:wrap">' +
        '<label class="field" style="width:80px"><span>ไอคอน</span>' +
          '<input name="emoji" maxlength="4" value="' + esc(editing ? editing.emoji : '') + '" placeholder="📦"></label>' +
        '<label class="field" style="flex:1;min-width:170px"><span>ชื่อหมวดหมู่</span>' +
          '<input name="name" required value="' + esc(editing ? editing.name : '') + '" placeholder="ชื่อหมวดหมู่"></label>' +
        '<label class="field" style="flex:1;min-width:170px"><span>คำอธิบาย</span>' +
          '<input name="sub" value="' + esc(editing ? (editing.sub || '') : '') + '" placeholder="เช่น กล้อง · อุปกรณ์แสง-เสียง"></label>' +
        '<button class="btn btn-maroon btn-sm" type="submit">' + (editing ? 'บันทึกการแก้ไข' : 'เพิ่มหมวดหมู่') + '</button>' +
        (editing ? '<button class="btn btn-ghost btn-sm" type="button" data-cat-cancel="' + kind + '">ยกเลิก</button>' : '') +
      '</form>' +
      (editing ? '<p class="item-meta" style="margin-top:8px">กำลังแก้ไข “' + esc(editing.name) + '” — ชื่อใหม่จะเปลี่ยนทุกหน้าที่อ้างถึง</p>' : '');
  }

  function categoriesPanel() {
    function block(kind, title) {
      var list = cats[kind] || [];
      var rows = list.length ? list.map(function (cat) { return catRow(cat, kind); }).join('') : emptyRow(5, 'ยังไม่มีหมวดหมู่');
      return '' +
        '<div class="admin-panel">' +
          '<h2>' + title + ' (' + list.length + ')</h2>' +
          '<p class="item-meta">เพิ่ม ลบ แก้ไขชื่อ/ไอคอนได้ทันที · ลบได้เฉพาะหมวดที่ไม่มีรายการอยู่</p>' +
          '<div class="table-wrap"><table class="admin-table">' +
            '<thead><tr><th>ไอคอน</th><th>ชื่อหมวดหมู่</th><th>คำอธิบาย</th><th>ใช้อยู่</th><th>จัดการ</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table></div>' +
          catForm(kind) +
        '</div>';
    }

    return block('items', 'หมวดหมู่สินค้า') + block('jobs', 'หมวดหมู่การจ้างงาน');
  }

  /* ---- users ---- */

  function usersPanel() {
    var rows = users.length ? users.map(userRow).join('') : emptyRow(10, 'ไม่พบผู้ใช้');

    return '' +
      '<div class="admin-panel">' +
        '<h2>ผู้ใช้ (' + users.length + ')</h2>' +
        '<form class="admin-toolbar" data-search="users">' +
          '<label class="field" style="flex:1;min-width:220px"><span>ค้นหา</span>' +
            '<input type="search" name="q" value="' + esc(userQuery) + '" placeholder="ชื่อหรืออีเมล"></label>' +
          '<button class="btn btn-maroon btn-sm" type="submit">ค้นหา</button>' +
        '</form>' +
        '<div class="table-wrap"><table class="admin-table">' +
          '<thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>สถานะ</th><th>เครดิต</th><th>กระเป๋า</th><th>การจอง</th><th>ใช้จ่าย</th><th>ประกาศ</th><th>สมัครเมื่อ</th><th>จัดการ</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
      '</div>';
  }

  function userRow(user) {
    var isSelf = me && user.id === me.id;
    var actions = isSelf
      ? '<span class="item-meta">บัญชีที่ใช้อยู่</span>'
      : '<div class="admin-actions">' +
          '<button class="btn-ghost" type="button" data-act="user-role" data-id="' + esc(user.id) +
            '" data-value="' + (user.role === 'admin' ? 'user' : 'admin') + '">' +
            (user.role === 'admin' ? 'ลดสิทธิ์' : 'ตั้งเป็นแอดมิน') + '</button>' +
          '<button class="btn-ghost" type="button" data-act="user-status" data-id="' + esc(user.id) +
            '" data-value="' + (user.status === 'active' ? 'suspended' : 'active') + '">' +
            (user.status === 'active' ? 'ระงับ' : 'เปิดใช้') + '</button>' +
        '</div>';

    return '<tr>' +
      '<td><div class="row-title">' + esc(user.name) + '</div><div class="item-meta">' + esc(user.email) + '</div></td>' +
      '<td><span class="pill ' + (user.role === 'admin' ? 'pill-info' : '') + '">' +
        (user.role === 'admin' ? 'แอดมิน' : 'ผู้ใช้') + '</span></td>' +
      '<td><span class="pill ' + (user.status === 'active' ? 'pill-ok' : 'pill-bad') + '">' +
        (user.status === 'active' ? 'ใช้งาน' : 'ระงับ') + '</span></td>' +
      '<td><span class="pill ' + (user.credit >= 60 ? 'pill-ok' : (user.credit >= 40 ? 'pill-warn' : 'pill-bad')) + '">' +
        Number(user.credit || 0) + '</span></td>' +
      '<td>' + flo(user.wallet) + '</td>' +
      '<td>' + user.bookingCount + '</td>' +
      '<td>' + baht(user.spent) + '</td>' +
      '<td>' + user.listingCount + '</td>' +
      '<td>' + thDate(user.joinedAt) + '</td>' +
      '<td>' + actions + '</td>' +
    '</tr>';
  }

  /* ---- items ---- */

  function itemsPanel() {
    var rows = items.length ? items.map(itemRow).join('') : emptyRow(7, 'ไม่พบประกาศ');

    return '' +
      '<div class="admin-panel">' +
        '<h2>ประกาศ (' + items.length + ')</h2>' +
        '<form class="admin-toolbar" data-search="items">' +
          '<label class="field" style="flex:1;min-width:220px"><span>ค้นหา</span>' +
            '<input type="search" name="q" value="' + esc(itemQuery) + '" placeholder="ชื่อสินค้า ผู้ให้เช่า หรือรหัส"></label>' +
          '<button class="btn btn-maroon btn-sm" type="submit">ค้นหา</button>' +
        '</form>' +
        '<div class="table-wrap"><table class="admin-table">' +
          '<thead><tr><th>สินค้า</th><th>หมวด</th><th>ผู้ให้เช่า</th><th>ราคา/วัน</th><th>มัดจำ</th><th>สถานะ</th><th>จัดการ</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
      '</div>';
  }

  function itemRow(item) {
    return '<tr>' +
      '<td><div class="row-title">' + esc(item.emoji) + ' ' + esc(item.title) + '</div>' +
        '<div class="item-meta">' + esc(item.id) + ' · ' + thDate(item.createdAt) + '</div></td>' +
      '<td>' + esc(catName(item.cat)) + '</td>' +
      '<td>' + esc(item.owner) + '</td>' +
      '<td>' + baht(item.price) + '</td>' +
      '<td>' + baht(item.deposit) + '</td>' +
      '<td><span class="pill ' + (item.status === 'published' ? 'pill-ok' : 'pill-warn') + '">' +
        (item.status === 'published' ? 'เผยแพร่' : 'ซ่อน') + '</span></td>' +
      '<td><div class="admin-actions">' +
        '<button class="btn-ghost" type="button" data-act="item-toggle" data-id="' + esc(item.id) +
          '" data-value="' + (item.status === 'published' ? 'hidden' : 'published') + '">' +
          (item.status === 'published' ? 'ซ่อน' : 'เผยแพร่') + '</button>' +
        '<button class="btn-ghost" type="button" data-act="item-delete" data-id="' + esc(item.id) + '">ลบ</button>' +
      '</div></td>' +
    '</tr>';
  }

  /* ---- bookings ---- */

  function bookingsPanel() {
    var rows = bookings.length ? bookings.map(bookingRow).join('') : emptyRow(8, 'ไม่พบการจอง');

    return '' +
      '<div class="admin-panel">' +
        '<h2>การจอง (' + bookings.length + ')</h2>' +
        '<div class="admin-toolbar">' +
          '<label class="field" style="min-width:180px"><span>กรองตามสถานะ</span>' +
            '<select data-booking-filter>' +
              ['all', 'pending', 'active', 'return_requested', 'returned', 'cancelled'].map(function (value) {
                var label = value === 'all' ? 'ทั้งหมด' : STATUS[value].label;
                return '<option value="' + value + '"' + (bookingFilter === value ? ' selected' : '') + '>' + label + '</option>';
              }).join('') +
            '</select>' +
          '</label>' +
          '<span class="item-meta" style="padding-bottom:10px">เปลี่ยนสถานะได้จากช่องในตาราง</span>' +
        '</div>' +
        '<div class="table-wrap"><table class="admin-table">' +
          '<thead><tr><th>รหัส</th><th>สินค้า</th><th>ผู้เช่า</th><th>ช่วงวันที่</th><th>ยอดรวม</th><th>มัดจำ</th><th>สถานะ</th><th>เปลี่ยนสถานะ</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
      '</div>';
  }

  function bookingRow(booking) {
    return '<tr>' +
      '<td class="row-title">' + esc(booking.code) + '<div class="item-meta">' + thDate(booking.createdAt) + '</div></td>' +
      '<td>' + esc(booking.itemEmoji || '📦') + ' ' + esc(booking.itemTitle) + '</td>' +
      '<td>' + esc(booking.userName || '—') + '</td>' +
      '<td>' + thDate(booking.start) + ' → ' + thDate(booking.end) + '<div class="item-meta">' + booking.days + ' วัน</div></td>' +
      '<td>' + baht(booking.total) + '</td>' +
      '<td>' + baht(booking.deposit) + '</td>' +
      '<td>' + (STATUS[booking.status] ? STATUS[booking.status].label : booking.status) + '</td>' +
      '<td><select class="status-select" data-booking-status="' + esc(booking.code) + '">' +
        ['pending', 'active', 'return_requested', 'returned', 'cancelled'].map(function (value) {
          return '<option value="' + value + '"' + (booking.status === value ? ' selected' : '') + '>' +
            STATUS[value].label + '</option>';
        }).join('') +
      '</select></td>' +
    '</tr>';
  }

  /* ---- requests ---- */

  function requestsPanel() {
    var rows = requests.length ? requests.map(function (request) {
      return '<tr>' +
        '<td class="row-title">' + esc(request.want) + '</td>' +
        '<td>' + esc(request.name) + '</td>' +
        '<td>' + esc(catName(request.cat)) + '</td>' +
        '<td>' + baht(request.budget) + '</td>' +
        '<td>' + esc(request.when) + '</td>' +
        '<td>' + thDate(request.createdAt) + '</td>' +
        '<td><button class="btn-ghost" type="button" data-act="request-delete" data-id="' + esc(request.id) + '">ลบ</button></td>' +
      '</tr>';
    }).join('') : emptyRow(7, 'ไม่มีคำขอตามหา');

    return '' +
      '<div class="admin-panel">' +
        '<h2>คำขอตามหา (' + requests.length + ')</h2>' +
        '<div class="table-wrap"><table class="admin-table">' +
          '<thead><tr><th>ต้องการ</th><th>ผู้ประกาศ</th><th>หมวด</th><th>งบ/วัน</th><th>ช่วงวันที่</th><th>ประกาศเมื่อ</th><th></th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
      '</div>';
  }

  /* ---- wallet + logs ---- */

  function walletPanel() {
    if (!walletData) return '<p class="muted">กำลังโหลด...</p>';
    var s = walletData.summary;

    var rows = walletData.transactions.length ? walletData.transactions.map(function (entry) {
      var positive = entry.amount > 0;
      return '<tr>' +
        '<td>' + thDate(entry.createdAt) + '</td>' +
        '<td>' + esc(entry.userName || '—') + '</td>' +
        '<td><span class="pill">' + esc(TX_LABELS[entry.type] || entry.type) + '</span></td>' +
        '<td class="' + (positive ? 'tx-in' : 'tx-out') + '">' + (positive ? '+' : '−') +
          Number(Math.abs(entry.amount)).toLocaleString('th-TH') + '</td>' +
        '<td>' + flo(entry.balanceAfter) + '</td>' +
        '<td>' + esc(entry.note) + (entry.ref ? '<div class="item-meta">' + esc(entry.ref) + '</div>' : '') + '</td>' +
      '</tr>';
    }).join('') : emptyRow(6, 'ยังไม่มีธุรกรรม');

    var holds = walletData.holds.length ? walletData.holds.map(function (hold) {
      return '<tr>' +
        '<td class="row-title">' + esc(hold.bookingCode) + '</td>' +
        '<td>' + baht(hold.rent) + '</td>' +
        '<td>' + baht(hold.deposit) + '</td>' +
        '<td>' + baht(hold.rent + hold.deposit) + '</td>' +
        '<td>' + thDate(hold.createdAt) + '</td>' +
      '</tr>';
    }).join('') : emptyRow(5, 'ไม่มีเงินที่ถูกกันไว้');

    return '' +
      '<div class="admin-stat-grid">' +
        statCard(flo(s.wallets), 'ยอดรวมในกระเป๋าทุกคน') +
        statCard(flo(s.escrow), 'กันไว้ (ค่าเช่า + มัดจำ)') +
        statCard(flo(s.topups), 'เติมเงินรวม') +
        statCard(flo(s.payouts), 'จ่ายค่าเช่าให้ผู้ให้เช่า') +
        statCard(s.holds, 'รายการที่กันเงินอยู่') +
        statCard(s.transactions, 'ธุรกรรมทั้งหมด') +
      '</div>' +
      '<div class="admin-panel">' +
        '<h2>ธุรกรรมล่าสุด (' + walletData.transactions.length + ')</h2>' +
        '<p class="item-meta">กันเงินเมื่อจอง · คืนเงินเมื่อยกเลิก · คืนมัดจำ + จ่ายค่าเช่าเมื่อคืนของ</p>' +
        '<div class="table-wrap"><table class="admin-table">' +
          '<thead><tr><th>วันที่</th><th>ผู้ใช้</th><th>ประเภท</th><th>จำนวน</th><th>คงเหลือ</th><th>รายละเอียด</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
      '</div>' +
      '<div class="admin-panel">' +
        '<h2>เงินที่กันไว้ (' + walletData.holds.length + ')</h2>' +
        '<div class="table-wrap"><table class="admin-table">' +
          '<thead><tr><th>การจอง</th><th>ค่าเช่า</th><th>มัดจำ</th><th>รวม</th><th>กันเมื่อ</th></tr></thead>' +
          '<tbody>' + holds + '</tbody>' +
        '</table></div>' +
      '</div>';
  }

  function logsPanel() {
    var rows = logs.length ? logs.map(function (entry) {
      var time = new Date(entry.at);
      var clock = isNaN(time.getTime()) ? '—' : time.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      return '<tr>' +
        '<td>' + thDate(entry.at) + '<div class="item-meta">' + esc(clock) + '</div></td>' +
        '<td><span class="pill">' + esc(entry.action) + '</span></td>' +
        '<td>' + esc(entry.detail) + '</td>' +
        '<td>' + esc(entry.actorName || '—') + '</td>' +
        '<td>' + (entry.ref ? esc(entry.ref) : '—') + '</td>' +
      '</tr>';
    }).join('') : emptyRow(5, 'ยังไม่มีบันทึก');

    return '<div class="admin-panel">' +
      '<h2>ล็อกระบบ (' + logs.length + ')</h2>' +
      '<p class="item-meta">บันทึกการเติมเงิน กันเงิน คืนเงิน จ่ายค่าเช่า การเปลี่ยนเครดิต และการสมัครสมาชิก</p>' +
      '<div class="table-wrap"><table class="admin-table">' +
        '<thead><tr><th>เวลา</th><th>การกระทำ</th><th>รายละเอียด</th><th>ผู้ทำ</th><th>อ้างอิง</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
    '</div>';
  }

  /* ---- interactions ---- */

  root.addEventListener('click', async function (event) {
    var tabBtn = event.target.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.getAttribute('data-tab');
      await refresh();
      return;
    }

    var btn = event.target.closest('[data-act]');
    if (!btn || busy) return;
    var act = btn.getAttribute('data-act');
    var id = btn.getAttribute('data-id');
    var value = btn.getAttribute('data-value');

    if (act === 'user-status' && value === 'suspended') {
      var sureSuspend = await confirmDialog({
        eyebrow: 'ระงับบัญชี',
        title: 'ระงับบัญชีนี้?',
        message: 'ผู้ใช้จะถูกออกจากระบบทันทีและเข้าสู่ระบบใหม่ไม่ได้จนกว่าจะเปิดใช้',
        confirmText: 'ระงับบัญชี'
      });
      if (!sureSuspend) return;
    }
    if (act === 'item-delete') {
      var sureItem = await confirmDialog({
        eyebrow: 'ลบประกาศ',
        title: 'ลบประกาศนี้?',
        message: 'ประกาศจะถูกลบถาวรพร้อมข้อมูลที่เกี่ยวข้อง กู้คืนไม่ได้',
        confirmText: 'ลบประกาศ'
      });
      if (!sureItem) return;
    }
    if (act === 'request-delete') {
      var sureRequest = await confirmDialog({
        eyebrow: 'ลบคำขอตามหา',
        title: 'ลบคำขอนี้?',
        message: 'คำขอตามหาจะหายอกจากรายการถาวร',
        confirmText: 'ลบคำขอ'
      });
      if (!sureRequest) return;
    }

    busy = true;
    btn.disabled = true;
    try {
      if (act === 'user-role') await API.patch('/admin/users/' + encodeURIComponent(id), { role: value });
      if (act === 'user-status') await API.patch('/admin/users/' + encodeURIComponent(id), { status: value });
      if (act === 'item-toggle') await API.patch('/admin/items/' + encodeURIComponent(id), { status: value });
      if (act === 'item-delete') await API.del('/admin/items/' + encodeURIComponent(id));
      if (act === 'request-delete') await API.del('/admin/requests/' + encodeURIComponent(id));
      toast('อัปเดตข้อมูลแล้ว', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message || 'ทำรายการไม่สำเร็จ');
      btn.disabled = false;
    } finally {
      busy = false;
    }
  });

  root.addEventListener('change', async function (event) {
    var statusSelect = event.target.closest('[data-booking-status]');
    if (statusSelect) {
      statusSelect.disabled = true;
      try {
        await API.patch('/admin/bookings/' + encodeURIComponent(statusSelect.getAttribute('data-booking-status')), {
          status: statusSelect.value
        });
        toast('อัปเดตสถานะการจองแล้ว', 'ok');
      } catch (err) {
        toast(err.message || 'อัปเดตไม่สำเร็จ');
      }
      await refresh();
      return;
    }

    var filterSelect = event.target.closest('[data-booking-filter]');
    if (filterSelect) {
      bookingFilter = filterSelect.value;
      await refresh();
    }
  });

  /* ---- หมวดหมู่: แก้ไข / ลบ ---- */

  root.addEventListener('click', async function (event) {
    var editBtn = event.target.closest('[data-cat-edit]');
    if (editBtn) {
      var editParts = editBtn.getAttribute('data-cat-edit').split(':');
      catEdit = { kind: editParts[0], key: editParts.slice(1).join(':') };
      paint();
      return;
    }

    var cancelBtn = event.target.closest('[data-cat-cancel]');
    if (cancelBtn) {
      catEdit = null;
      paint();
      return;
    }

    var delBtn = event.target.closest('[data-cat-delete]');
    if (!delBtn) return;

    var delParts = delBtn.getAttribute('data-cat-delete').split(':');
    var delKind = delParts[0];
    var delKey = delParts.slice(1).join(':');
    var target = (cats[delKind] || []).find(function (cat) { return cat.key === delKey; });
    var usage = target ? Number(target.usage || 0) : 0;

    var sure = await confirmDialog({
      eyebrow: 'ลบหมวดหมู่',
      title: 'ลบ “' + (target ? target.name : delKey) + '”?',
      message: usage
        ? 'หมวดนี้ยังมีรายการใช้อยู่ ' + usage + ' รายการ — ต้องย้ายหรือลบรายการนั้นก่อน ระบบจะไม่ให้ลบ'
        : 'หมวดหมู่นี้จะหายจากหน้าเว็บถาวร (รายการที่ใช้อยู่จะไม่ถูกแตะ)',
      confirmText: 'ลบหมวดหมู่'
    });
    if (!sure) return;

    delBtn.disabled = true;
    try {
      await API.del('/admin/categories/' + delKind + '/' + encodeURIComponent(delKey));
      toast('ลบหมวดหมู่แล้ว', 'ok');
      if (catEdit && catEdit.key === delKey) catEdit = null;
      await refresh();
    } catch (err) {
      delBtn.disabled = false;
      toast(err.message || 'ลบไม่สำเร็จ');
    }
  });

  root.addEventListener('submit', async function (event) {
    var catForm = event.target.closest('[data-cat-form]');
    if (!catForm) return;
    event.preventDefault();

    var kind = catForm.getAttribute('data-cat-form');
    var payload = {
      kind: kind,
      emoji: catForm.querySelector('[name="emoji"]').value.trim(),
      name: catForm.querySelector('[name="name"]').value.trim(),
      sub: catForm.querySelector('[name="sub"]').value.trim()
    };
    var btn = catForm.querySelector('button[type="submit"]');
    btn.disabled = true;

    try {
      if (catEdit && catEdit.kind === kind) {
        await API.patch('/admin/categories/' + kind + '/' + encodeURIComponent(catEdit.key), payload);
        toast('แก้ไขหมวดหมู่แล้ว', 'ok');
        catEdit = null;
      } else {
        await API.post('/admin/categories', payload);
        toast('เพิ่มหมวดหมู่แล้ว', 'ok');
      }
      await refresh();
    } catch (err) {
      btn.disabled = false;
      toast(err.message || 'บันทึกไม่สำเร็จ');
    }
  });

  root.addEventListener('submit', async function (event) {
    var search = event.target.closest('[data-search]');
    if (!search) return;
    event.preventDefault();
    var kind = search.getAttribute('data-search');
    var value = search.querySelector('input').value.trim();
    if (kind === 'users') userQuery = value;
    if (kind === 'items') itemQuery = value;
    await refresh();
  });
})();
