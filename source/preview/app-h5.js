/* H5 版：复用 engine.js / chart.js，结构与类名与小程序 WXML 一一对应 */
(function () {
  'use strict';
  var GZ = window.GZ, Chart = window.GZChart, Share = window.GZShare, Badges = window.GZBadges;
  var KEY = 'gzclp_db_v1', BK = 'gzclp_last_backup', SYNC_KEY = 'gzclp_sync_v1', WATCH_KEY = 'gzclp_watch_v1', BK_DISMISS = 'gzclp_bk_dismiss';
  var TABS = [
    { id: 'train', title: '训练' }, { id: 'plan', title: '计划' }, { id: 'stats', title: '数据' },
    { id: 'review', title: '回顾' }, { id: 'settings', title: '设置' }
  ];
  var TIER_TIP = {
    T1: 'T1 严格限定四大项：杠铃深蹲、平板卧推、传统硬拉、站姿实力推。不能添加其他 T1 动作。',
    T2: 'T2 次主项：中等重量，按 3×10 → 3×8 → 3×6 退阶',
    T3: 'T3 辅助项：小重量高次数，末组达阈值加重'
  };
  function libNames(db) {
    var m = { T1: [], T2: [], T3: [] };
    GZ.libAll(db).forEach(function (x) { if (m[x.tier].indexOf(x.name) < 0) m[x.tier].push(x.name); });
    return m;
  }
  function libRows(lib, opts) {
    if (!lib.list.length) return '<div class="empty-tip">' + (opts.empty || '没有找到相关动作') + '</div>';
    return lib.list.map(function (x) {
      var tierTag = (opts.showTier || (opts.slotTier && x.tier !== opts.slotTier)) ? '<span class="tier t-' + x.tier + ' lib-t">' + x.tier + '</span>' : '';
      var right = opts.pick
        ? (x.current ? '<span class="lib-cur">当前</span>' : '') + (opts.sel === x.name ? '<span class="lib-ck">✓</span>' : '')
        : (x.custom ? '<span class="lib-del" data-act="libdel" data-name="' + esc(x.name) + '">删除</span>' : '');
      return '<div class="cell ' + (opts.pick ? 'tap ' : '') + 'lib-row ' + (opts.sel === x.name ? 'sel' : '') + '"' + (opts.pick ? ' data-act="swappick" data-name="' + esc(x.name) + '"' : '') + '>' +
        '<div class="flex1"><div class="lib-n">' + esc(x.name) + equipTag(x.equip) + tierTag + (x.custom ? '<span class="lib-c">自定义</span>' : '') + '</div>' +
        '<div class="lib-s">' + esc(x.part) + (x.last ? ' · ' + (opts.pick ? '上次 ' : '最近 ') + x.last + ' ' + esc(x.recUnit) : '') + '</div>' +
        (opts.pick ? '' : '<div class="lib-d">' + esc(x.desc || '') + '</div>') +
        '<div class="lib-rec">推荐 ' + esc(x.rec) + (x.recUnit === '自重' ? '' : ' ' + esc(x.recUnit)) + ' · ' + esc(x.recNote) + '</div></div>' + right + '</div>';
    }).join('');
  }

  function rawLoad() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  /** 手表数据单独存放（不进训练数据文件，避免每次拉取都触发配置冲突与重复推送） */
  function watchLoad() { try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || null; } catch (e) { return null; } }
  function watchSave(w) { if (w) localStorage.setItem(WATCH_KEY, JSON.stringify(w)); else localStorage.removeItem(WATCH_KEY); }
  function load() {
    var db = rawLoad(); if (!db) { db = GZ.defaults(true); save(db, { fromSync: true }); }
    db = GZ.normalize(db);
    var w = watchLoad();
    // 旧版把手表数据放在 params.watch：并入独立存储后从主数据里拿掉
    if (db.params.watch) {
      w = Badges.mergeWatch(w, { source: db.params.watch.source, workouts: db.params.watch.workouts || [], sleep: db.params.watch.sleep || {} });
      watchSave(w); delete db.params.watch;
      // 主数据里的旧副本必须落盘去掉，否则会被反复合并、甚至用旧值覆盖刚拉取的
      var raw = rawLoad(); if (raw && raw.params) { delete raw.params.watch; localStorage.setItem(KEY, JSON.stringify(raw)); }
    }
    if (w) db.params.watch = w;
    return db;
  }
  /** 保存到本机；用户操作产生的保存会记下配置修改时间，并在 2 秒后自动同步到云端 */
  function save(db, opt) {
    var fromSync = opt && opt.fromSync, hasW = Object.prototype.hasOwnProperty.call(db.params || {}, 'watch'), w = hasW ? db.params.watch : undefined;
    if (hasW) { delete db.params.watch; watchSave(w || null); }  // 手表数据走独立键；主数据里不留
    if (!fromSync) { var prev = rawLoad(); if (prev) { prev = GZ.normalize(prev); delete prev.params.watch; GZ.stampConfig(prev, db); } }
    localStorage.setItem(KEY, JSON.stringify(db));
    if (hasW && w) db.params.watch = w;  // 调用方继续拿到完整对象
    if (!fromSync) Sync.schedule();
  }

  // ================= 云同步（GitHub 私有仓库） =================
  /**
   * 离线优先：所有读写都先落本机 localStorage，同步只是在后台把本机与云端合并。
   * 云端是私有仓库里的一个 JSON 文件，通过 GitHub Contents API 读写（带 sha 防覆盖，冲突时重新合并再写）。
   * 令牌只存在本机 gzclp_sync_v1，不进入备份文件，也不会被同步到云端。
   */
  var Sync = (function () {
    var API = 'https://api.github.com', busy = false, again = false, timer = null;
    function cfg() { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || null; } catch (e) { return null; } }
    function setCfg(c) { if (c) localStorage.setItem(SYNC_KEY, JSON.stringify(c)); else localStorage.removeItem(SYNC_KEY); }
    function on() { var c = cfg(); return !!(c && c.token && c.owner && c.repo); }
    function b64enc(str) { var b = new TextEncoder().encode(str), bin = ''; for (var i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); }
    function b64dec(x) { var bin = atob(String(x).replace(/\s/g, '')), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }
    function filePath(c) { return '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + '/contents/' + (c.path || 'gzclp-data.json').split('/').map(encodeURIComponent).join('/'); }
    function req(c, method, path, body) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : 0;
      var headers = { 'Authorization': 'Bearer ' + c.token, 'Accept': 'application/vnd.github+json' };
      if (body) headers['Content-Type'] = 'application/json';
      return fetch(API + path, { method: method, cache: 'no-store', headers: headers, body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined })
        .then(function (r) { clearTimeout(t); return r.text().then(function (tx) { var j = null; try { j = tx ? JSON.parse(tx) : null; } catch (e) {} return { status: r.status, json: j }; }); },
          function () { clearTimeout(t); return { status: 0, json: null }; });
    }
    function errMsg(st) {
      if (st === 0) return '网络不通（GitHub 在当前网络下可能不稳定），数据已保存在本机，稍后自动重试';
      if (st === 401) return '令牌无效或已过期，请在设置里更换';
      if (st === 403) return '令牌权限不足（需要该仓库的 Contents 读写），或请求过于频繁';
      if (st === 404) return '找不到这个仓库，或令牌没有这个仓库的权限';
      if (st === 'public') return '这是公开仓库，训练数据会被所有人看到。为了安全只支持私有仓库';
      if (st === 'bad') return '云端文件内容损坏，已停止同步以免覆盖，请联系开发者';
      return 'GitHub 返回错误 ' + st;
    }
    /** 一次完整同步：拉取 → 合并 → 写回本机（有变化时）→ 推送（云端不同时） */
    function run(manual) {
      var c = cfg(); if (!on()) return Promise.resolve(false);
      if (busy) { again = true; return Promise.resolve(false); }
      busy = true; c.state = 'syncing'; setCfg(c); refresh();
      var attempt = function (n) {
        return req(c, 'GET', filePath(c)).then(function (g) {
          if (g.status !== 200 && g.status !== 404) throw g.status;
          var remote = null, sha = null;
          if (g.status === 200) {
            sha = g.json.sha;
            try { remote = GZ.normalize(JSON.parse(b64dec(g.json.content))); } catch (e) { throw 'bad'; }
            if (remote.params.watch) { var ow = remote.params.watch; delete remote.params.watch; try { watchSave(Badges.mergeWatch(watchLoad(), { source: ow.source, workouts: ow.workouts || [], sleep: ow.sleep || {} })); } catch (e) {} }
          }
          var raw = rawLoad(), local = GZ.normalize(raw || GZ.defaults(true)), merged = GZ.mergeDb(local, remote);
          var pulled = !GZ.sameDb(merged, local);
          if (pulled || !raw) save(merged, { fromSync: true });
          if (remote && GZ.sameDb(merged, remote)) return { pulled: pulled, pushed: false, n: merged.records.length };
          var body = { message: '同步训练数据 · ' + GZ.today() + ' · ' + merged.records.length + ' 条记录', content: b64enc(JSON.stringify(merged)) };
          if (sha) body.sha = sha;
          return req(c, 'PUT', filePath(c), body).then(function (pr) {
            if ((pr.status === 409 || pr.status === 422) && n < 2) return attempt(n + 1); // 云端刚被别的设备改过：重新拉取合并
            if (pr.status !== 200 && pr.status !== 201) throw pr.status;
            return { pulled: pulled, pushed: true, n: merged.records.length };
          });
        });
      };
      return attempt(0).then(function (res) {
        c = cfg(); if (!c) { busy = false; return false; }
        c.state = 'ok'; c.lastAt = Date.now(); c.lastErr = ''; c.count = res.n; setCfg(c); busy = false;
        if (manual) toast(res.pulled ? '已同步，合并了其他设备的更新' : '已同步');
        refresh(res.pulled);
        pullWatch(manual);
        if (again) { again = false; run(); }
        return true;
      }, function (st) {
        busy = false; c = cfg(); if (!c) return false;
        c.state = 'err'; c.lastErr = errMsg(st); c.errAt = Date.now(); setCfg(c);
        if (manual) toast(c.lastErr);
        refresh(false);
        return false;
      });
    }
    /** 自动拉取手表数据：云端 gzclp-watch.json 由定时任务写入，这里只读、合并到本机，从不写回 */
    function pullWatch(manual) {
      var c = cfg(); if (!c || !on()) return Promise.resolve(false);
      var wp = Object.assign({}, c, { path: 'gzclp-watch.json' });
      return req(c, 'GET', filePath(wp)).then(function (g) {
        c = cfg(); if (!c) return false;
        if (g.status === 404) { c.watchErr = ''; c.watchGen = ''; c.watchAt = Date.now(); setCfg(c); if (manual) toast('云端还没有手表文件'); if (S.tab === 'settings') render(true); return false; }  // 还没有自动同步过：保持手动导入可用
        var fail = function (m) { c.watchErr = m; setCfg(c); if (manual) toast(m); if (S.tab === 'settings') render(true); return false; };
        if (g.status !== 200) return fail(errMsg(g.status));
        var incoming; try { incoming = Badges.sanitizeWatch(b64dec(g.json.content)); } catch (e) { return fail('云端手表文件格式不对，已忽略'); }
        var old = watchLoad(), before = JSON.stringify([old && old.workouts, old && old.sleep]), merged = Badges.mergeWatch(old, incoming);
        var changed = JSON.stringify([merged.workouts, merged.sleep]) !== before;
        if (changed) { watchSave(merged); } else if (old && old.importedAt) { merged.importedAt = old.importedAt; }  // 没变就不刷新「本机最近写入」
        var meta = null; try { meta = JSON.parse(b64dec(g.json.content)).generatedAt; } catch (e) {}
        c.watchErr = ''; c.watchAt = Date.now(); c.watchGen = meta || c.watchGen || ''; setCfg(c);
        var a = document.activeElement, typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
        if (manual) toast(changed ? '已拉取最新手表数据' : '手表数据已是最新');
        if (!typing && (changed || S.tab === 'settings')) render(true);
        return changed;
      });
    }
    function schedule() { if (!on()) return; clearTimeout(timer); timer = setTimeout(function () { run(); }, 2000); }
    /** 同步完成后刷新界面：拉到新数据就重算当前页；用户正在输入时不打断 */
    function refresh(pulled) {
      var a = document.activeElement, typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
      if (pulled) {
        // 拉到其他设备的训练后，若本机还没开始填当天的训练，重新定位到「下一次该练的训练日」
        var t = S.train, d = t.draft, touched = !!t.recordId || !!t.result || (t.swap && t.swap.show);
        if (d) Object.keys(d).forEach(function (k) { var e = d[k]; if (e && (e.v !== null && e.v !== undefined || e.done || e.w !== undefined || e.ex)) touched = true; });
        if (!touched) { t.day = null; t.draft = null; t.deload = undefined; }
      }
      if (typing) return;
      if (pulled || (S.tab === 'settings' && S.settings.view !== 'lib')) render(true);
    }
    /** 首次连接：先确认仓库存在且是私有的，再做第一次同步 */
    function connect(owner, repo, token) {
      var c = { owner: owner, repo: repo, token: token, path: 'gzclp-data.json' };
      return req(c, 'GET', '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo)).then(function (r) {
        if (r.status !== 200) return errMsg(r.status);
        if (!r.json || r.json.private !== true) return errMsg('public');
        setCfg(c);
        return run(true).then(function (ok) { return ok ? '' : (cfg() || {}).lastErr || '同步失败'; });
      });
    }
    function disconnect() { clearTimeout(timer); setCfg(null); }
    return { cfg: cfg, on: on, run: run, schedule: schedule, connect: connect, disconnect: disconnect, pullWatch: pullWatch };
  })();
  function ago(ts) {
    if (!ts) return '从未';
    var s = Math.floor((Date.now() - ts) / 1000);
    return s < 60 ? '刚刚' : s < 3600 ? Math.floor(s / 60) + ' 分钟前' : s < 86400 ? Math.floor(s / 3600) + ' 小时前' : Math.floor(s / 86400) + ' 天前';
  }
  /** 训练页顶部的备份提醒：周日提醒导出到 iCloud；没开云同步且超过 7 天没备份时每天提醒 */
  function backupNag() {
    var bk = Number(localStorage.getItem(BK) || 0), days = bk ? (Date.now() - bk) / 86400000 : 999;
    if (localStorage.getItem(BK_DISMISS) === GZ.today()) return '';
    var c = Sync.cfg(), synced = Sync.on() && c.lastAt && Date.now() - c.lastAt < 3 * 86400000;
    var sunday = new Date().getDay() === 0 && days > 6, longNo = !synced && days > 7;
    var syncErr = Sync.on() && c.state === 'err' && (!c.lastAt || Date.now() - c.lastAt > 86400000);
    // 备份提醒已按需求移除，仅保留云同步连续失败的提醒
    if (!syncErr) return '';
    var msg = syncErr ? '云同步已超过 1 天没有成功：' + c.lastErr
      : sunday ? '今天周日，导出一份备份存到 iCloud「文件」作为第二重保险'
      : (bk ? Math.floor(days) + ' 天' : '一直') + '没有备份了，数据只存在这台设备上';
    return '<div class="bk-nag"><div class="flex1"><div class="bk-t">' + (syncErr ? '同步提醒' : '备份提醒') + '</div><div class="bk-s">' + esc(msg) + '</div></div>' +
      '<span class="bk-go" data-act="' + (syncErr ? 'bkset' : 'bkexport') + '">' + (syncErr ? '去设置' : '导出') + '</span><span class="bk-x" data-act="bkdismiss">×</span></div>';
  }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtSec(s) { s = Math.max(0, s); var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }
  function toast(t) { var el = document.getElementById('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('show'); }, 1800); }
  function confirmBox(title, content, ok) { if (window.confirm(title + '\n\n' + content)) ok(); }
  function tier(t) { return '<span class="tier t-' + t + '">' + t + '</span>'; }
  function equipTag(e) {
    var suffix = e === '哑铃' ? '·单只' : e === '负重' ? '·外加' : '';
    return '<span class="equip-tag eq-' + esc(e) + '">' + esc(e + suffix) + '</span>';
  }
  function seg(items, cur, act, cls) {
    return '<div class="seg ' + (cls || '') + '">' + items.map(function (it, i) {
      return '<div class="seg-i ' + (it.on !== undefined ? (it.on ? 'on' : '') : (cur === i ? 'on' : '')) + '" data-act="' + act + '" data-i="' + i + '"' + (it.data || '') + '>' + it.html + '</div>';
    }).join('') + '</div>';
  }

  var S = {
    tab: 'train',
    train: { day: null, draft: null, recordId: null, deload: undefined, date: GZ.today(), bw: '', note: '', result: null, createdAt: null },
    plan: { ov: 0, detail: null, cycle: 0 }, stats: { lift: 0, day: 0 }, review: { tab: 0, open: {}, rules: false }, settings: { d: 0, imp: false, view: '', tier: 'T1', q: '', add: null }
  };
  var rest = { show: false, left: 0, total: 0, name: '', timer: null };

  // ================= 训练 =================
  function trainVM() {
    var db = load(), t = S.train;
    if (!t.day || !GZ.dayById(db, t.day)) t.day = GZ.recommend(db).day;
    if (!t.draft) t.draft = GZ.blankDraft(db, t.day);
    return GZ.buildTrain(db, { day: t.day, recordId: t.recordId, draft: t.draft, deload: t.deload });
  }
  function entry(slot) { var d = S.train.draft; return d[slot] || (d[slot] = { v: null, done: 0 }); }

  function renderTrain() {
    var vm = trainVM(), t = S.train, h = '';
    h += '<div class="head"><div class="row between"><label class="date-pick"><span class="head-sub">' + (vm.editing ? '编辑记录 · ' : '') + vm.weekText + (vm.locked ? ' · 已完成' : ' · ' + GZ.dateLabel(t.date)) + '</span>' +
      (vm.locked ? '' : '<input type="date" data-act="date" value="' + t.date + '">') + '</label>' + (vm.editing ? '<span class="link" data-act="cancelEdit">取消</span>' : '') + '</div>' +
      '<div class="large-title"><span class="num">' + vm.day + '</span> ' + vm.dayName + '</div></div>';
    if (!vm.editing) h += backupNag();
    if (!vm.editing) {
      h += '<div class="seg day-seg">' + vm.days.map(function (d) {
        return '<div class="seg-i ' + (d.id === vm.day ? 'on ' : '') + (d.done ? 'is-done' : '') + '" data-act="day" data-day="' + d.id + '">' + (d.done ? '<span class="ds-ck">✓</span>' : '') +
          '<span class="num">' + d.id + '</span>' + (d.rec ? '<div class="rec-dot"></div>' : '') + '</div>';
      }).join('') + '</div>';
      var rd = vm.round;
      h += '<div class="wk-prog"><div class="wk-bar"><div class="wk-in" style="width:' + rd.pct + '%"></div></div><span class="wk-t">本周 <span class="num strong">' + rd.done + '/' + rd.total + '</span>' +
        (rd.left ? ' · 完成 ' + rd.leftText + ' 后进入' + rd.nextWeekText : '') + '</span></div>';
    }
    if (vm.locked && vm.lockedInfo) {
      var L = vm.lockedInfo;
      h += '<div class="card locked"><div class="lk-head"><div class="lk-ic">✓</div><div class="flex1"><div class="lk-t">本周 ' + vm.day + ' 已完成</div><div class="lk-s">' + L.dateText + ' · 容量 ' + L.vol + ' kg</div></div></div>' +
        L.items.map(function (it) { return '<div class="lk-row">' + tier(it.tier) + '<span class="lk-n">' + it.name + '</span><span class="lk-w num">' + (it.manual ? '<span class="accent">手动 </span>' : '') + it.w + ' × ' + it.input + '</span><span class="jtag lk-j" style="color:' + it.color + '">' + it.j + '</span></div>'; }).join('') +
        '<div class="lk-tip">下周的 ' + vm.day + ' 会在本周 ' + vm.round.leftText + ' 完成后开放</div>' +
        '<div class="sheet-btns"><div class="btn-ghost" data-act="editLocked" data-id="' + L.id + '">修改这次</div><div class="btn-ghost solid" data-act="day" data-day="' + vm.recommended + '">去练 ' + vm.recommended + '</div></div></div>';
    }
    if (!vm.locked) {
    if (vm.deloadSuggest || vm.deload) {
      h += '<div class="card deload"><div class="dl-ic">↓</div><div class="flex1"><div class="dl-t">减载周</div><div class="dl-s">T1 −50% · T2 −40% · T3 少 1 组</div></div>' +
        '<label class="ios-sw"><input type="checkbox" data-act="deload" ' + (vm.deload ? 'checked' : '') + '><i></i></label></div>';
    }
    // 专注模式：只展开「当前动作」，其余收成一行。焦点只在换训练日 / 首次进入时自动定位到第一个未完成的动作，
    // 之后由用户点「下一个动作」或点某一行切换，避免刚填完就被收起、看不到判定结果。
    var finished = function (x) { return x.skip || !!x.preview; };
    var fkey = vm.day + '|' + (t.recordId || '');
    if (t.focusKey !== fkey || (t.focus && !vm.items.some(function (x) { return x.slotId === t.focus; }))) {
      var f0 = vm.items.filter(function (x) { return !finished(x); })[0];
      t.focus = f0 ? f0.slotId : null; t.focusKey = fkey;
    }
    var nextOpen = function (cur) {
      var idx = vm.items.map(function (x) { return x.slotId; }).indexOf(cur), rest0 = vm.items.slice(idx + 1).concat(vm.items.slice(0, idx));
      var n = rest0.filter(function (x) { return !finished(x); })[0]; return n ? n.slotId : null;
    };
    var t3buf = '', flushT3 = function () { if (t3buf) { h += '<div class="card t3-group">' + t3buf + '</div>'; t3buf = ''; } };
    vm.items.forEach(function (it) {
      if (it.slotId !== t.focus && it.tier === 'T3') {
        var q0 = it.preview, rr;
        if (it.skip) rr = '<span class="exr-st">已跳过</span>';
        else if (q0) rr = '<span class="exr-st" style="color:' + q0.color + '">' + q0.icon + ' ' + q0.judgment + '</span>' + (q0.sub || q0.judgment === '减载' ? '' : '<span class="exr-nx num">下次 ' + q0.nextWeight + '</span>');
        else rr = '<span class="exr-w num">' + (it.canAdjust ? it.weightText + '<span class="exr-u"> ' + esc(it.unitText) + '</span>' : '自重') + '</span><span class="exr-r num">' + it.repsText + '</span>';
        t3buf += '<div class="ex-row g ' + (finished(it) ? 'is-fin ' : '') + (it.skip ? 'skipped' : '') + '" data-act="focus" data-slot="' + it.slotId + '">' + tier(it.tier) +
          '<span class="exr-n">' + esc(it.name) + '</span><span class="exr-right">' + rr + '</span><span class="exr-chev">›</span></div>';
        return;
      }
      flushT3();
      if (it.slotId !== t.focus) {
        var p0 = it.preview, right;
        if (it.skip) right = '<span class="exr-st">已跳过</span>';
        else if (p0) right = '<span class="exr-st" style="color:' + p0.color + '">' + p0.icon + ' ' + p0.judgment + '</span>' + (p0.sub || p0.judgment === '减载' ? '' : '<span class="exr-nx num">下次 ' + p0.nextWeight + '</span>');
        else right = '<span class="exr-w num">' + (it.canAdjust ? it.weightText + '<span class="exr-u"> ' + esc(it.unitText) + '</span>' : '自重') + '</span><span class="exr-r num">' + it.repsText + '</span>';
        h += '<div class="card ex-row ' + (finished(it) ? 'is-fin ' : '') + (it.skip ? 'skipped' : '') + '" data-act="focus" data-slot="' + it.slotId + '">' + tier(it.tier) +
          '<span class="exr-n">' + esc(it.name) + '</span><span class="exr-right">' + right + '</span><span class="exr-chev">›</span></div>';
        return;
      }
      var nxt = nextOpen(it.slotId);
      h += '<div class="card ex is-focus ' + (it.skip ? 'skipped' : '') + '">';
      h += '<div class="ex-head">' + tier(it.tier) + '<div class="ex-title"><span class="ex-name">' + esc(it.name) + '</span>' + equipTag(it.equip) +
        (it.sub ? '<span class="ex-tag sub">替换 ' + esc(it.planName) + '</span>' : it.autoNew ? '<span class="ex-tag rot">本轮轮换 · 原 ' + esc(it.autoPrev) + '</span>' : it.changeNew ? '<span class="ex-tag new">新动作</span>' : '') + '</div>' +
        '<span class="ex-act" data-act="openswap" data-slot="' + it.slotId + '">更换</span>' +
        '<span class="ex-skip" data-act="skip" data-slot="' + it.slotId + '">' + (it.skip ? '恢复' : '跳过') + '</span></div>';
      h += '<div class="ex-main">' + (it.canAdjust
        ? '<div class="wbox ' + (it.editW ? 'editing' : '') + '" data-act="editW" data-slot="' + it.slotId + '"><span class="w-num num ' + (it.manual ? 'manual' : '') + '">' + it.weightText + '</span><span class="w-unit">' + esc(it.unitText) + '</span><span class="w-edit">' + (it.editW ? '完成' : '调整') + '</span></div>'
        : '<div class="wbox bw-only"><span class="w-num bw-text">自重</span></div>') + '<span class="reps num">' + it.repsText + '</span></div>';
      if (it.manual || it.plates || it.fail > 0) h += '<div class="ex-sub">' + (it.manual ? '<span class="accent">已手动调整 · 建议 ' + it.autoText + ' kg' + (it.plates || it.fail > 0 ? ' · ' : '') + '</span>' : '') + (it.plates || '') + (it.fail > 0 ? '<span class="amber">' + (it.plates ? ' · ' : '') + '已预警 ' + it.fail + ' 次</span>' : '') + '</div>';
      if (it.editW) {
        h += '<div class="wedit"><div class="stepper"><div class="st-btn" data-act="wstep" data-slot="' + it.slotId + '" data-d="-1">−</div>' +
          '<input class="st-val wide num" inputmode="decimal" data-act="winput" data-slot="' + it.slotId + '" value="' + it.weightText + '">' +
          '<div class="st-btn" data-act="wstep" data-slot="' + it.slotId + '" data-d="1">+</div></div><span class="we-step">每次 ' + it.wStep + ' kg</span>' +
          (it.manual ? '<span class="link we-reset" data-act="wreset" data-slot="' + it.slotId + '">恢复 ' + it.autoText + '</span>' : '') + '</div>';
      }
      if (!it.skip) {
        h += '<div class="dots">' + it.dots.map(function (d) {
          return '<div class="dot ' + (d.on ? 'on ' : '') + (d.amrap ? 'amrap' : '') + '" data-act="dot" data-slot="' + it.slotId + '" data-i="' + d.i + '" data-rest="' + it.rest + '" data-name="' + esc(it.name) + '">' + (d.amrap ? (d.i + 1) + '+' : d.i + 1) + '</div>';
        }).join('') + '<div class="rest-btn" data-act="rest" data-rest="' + it.rest + '" data-name="' + esc(it.name) + '">休息 ' + it.restText + '</div></div>';
        if (it.inputType === 'amrap') {
          h += '<div class="inrow"><div class="flex1"><div class="in-label">末组次数</div><div class="in-hint">目标 ' + it.amrapHint + '</div></div><div class="stepper">' +
            '<div class="st-btn" data-act="step" data-slot="' + it.slotId + '" data-d="-1">−</div><input class="st-val num" inputmode="numeric" data-act="amrap" data-slot="' + it.slotId + '" value="' + (it.value === null || it.value === undefined ? '' : it.value) + '" placeholder="' + (it.amrapTarget || '') + '">' +
            '<div class="st-btn" data-act="step" data-slot="' + it.slotId + '" data-d="1">+</div></div></div>';
        }
        if (it.need5RM) h += '<div class="inrow"><div class="flex1"><div class="in-label">新 5RM</div><div class="in-hint">10×1+ 未达标时填写，用于重置</div></div><input class="mini-in num" inputmode="decimal" data-act="5rm" data-slot="' + it.slotId + '" value="' + esc(it.new5RM) + '" placeholder="kg"></div>';
        if (it.inputType === 'done') {
          h += '<div class="inrow col"><div class="seg seg-done"><div class="seg-i ' + (it.value === '完成' ? 'on ok' : '') + '" data-act="done" data-slot="' + it.slotId + '" data-v="完成">全部完成</div>' +
            '<div class="seg-i ' + (it.value === '未完成' ? 'on bad' : '') + '" data-act="done" data-slot="' + it.slotId + '" data-v="未完成">未完成</div></div>';
          if (it.value === '未完成') h += '<div class="subrow"><span class="in-hint">实际总次数（可选，用于容量）</span><input class="mini-in num" inputmode="numeric" data-act="reps" data-slot="' + it.slotId + '" value="' + esc(it.reps2) + '" placeholder="' + (it.sets * it.reps - 2) + '"></div>';
          h += '</div>';
        }
        if (it.preview) {
          var p = it.preview;
          h += '<div class="verdict"><div class="v-ic" style="background:' + p.color + '">' + p.icon + '</div><span class="v-j" style="color:' + p.color + '">' + p.judgment + '</span>' +
            (p.sub ? '<span class="v-l">不影响 ' + esc(p.origName) + ' 的进阶</span>' : p.judgment !== '减载' ? '<div class="v-next"><span class="v-l">下次</span><span class="num v-w">' + p.nextWeight + '</span><span class="v-u">kg</span>' + (p.stageChanged ? '<span class="v-stage">· ' + p.nextStage + '</span>' : '') + '</div>' : '<span class="v-l">按减载重量完成</span>') + '</div>' +
            (p.boost && p.adaptNote ? '<div class="v-adapt"><span class="v-adapt-t">多加一档</span>' + esc(p.adaptNote) + '</div>' : '');
        }
      }
      if ((it.preview || it.skip) && nxt) h += '<div class="ex-next" data-act="focus" data-slot="' + nxt + '">下一个动作<span class="exr-chev">›</span></div>';
      h += '</div>';
    });
    flushT3();
    h += '<div class="list"><div class="cell"><span class="flex1">体重</span><input class="cell-in num" inputmode="decimal" data-act="bw" value="' + esc(t.bw) + '" placeholder="可选"><span class="unit">kg</span></div>' +
      '<div class="cell"><textarea class="note" data-act="note" rows="2" placeholder="备注：状态、睡眠、技术要点">' + esc(t.note) + '</textarea></div></div>';
    h += '<div class="submit-bar"><span class="sb-count num"><b>' + vm.filled + '</b> / ' + vm.total + '</span><button class="btn-primary sb-btn" data-act="submit">' + (vm.editing ? '保存修改' : '完成训练') + '</button></div>';
    }
    if (t.swap && t.swap.show) h += renderSwap();
    if (t.result) {
      var r = t.result;
      h += '<div class="mask" data-act="closeResult"><div class="sheet" data-stop="1"><div class="grabber"></div><span class="sheet-cap">' + r.day + ' ' + r.dayName + ' · ' + r.weekText + '</span><div class="sheet-title">' + (r.cycleDone ? '第 ' + r.cycle + ' 轮完成' : r.weekDone ? '本周完成' : '训练完成') + '</div>' +
        (r.cycleDone ? '<div class="wk-done">第 ' + r.cycle + ' 轮 ' + r.weeksPerCycle + ' 周全部完成，进入第 ' + (r.cycle + 1) + ' 轮' + (r.nextDeload ? '（含减载周）' : '') + '</div>' + (r.rotated ? '<div class="wk-left">已按轮换计划更换 ' + r.rotated + ' 个 T2/T3 动作，T1 四大项不变。可在「计划」查看本轮编排与依据</div>' : '')
          : r.weekDone ? '<div class="wk-done">A1 · B1 · A2 · B2 全部完成，已进入' + r.nextWeekText + (r.nextDeload ? '（减载周）' : '') + '</div>'
          : (r.leftText ? '<div class="wk-left">本周还剩 ' + r.leftText + '</div>' : '')) +
        '<div class="res-kpi"><div class="rk"><span class="num rk-v">' + r.volume + '</span><span class="rk-l">容量 kg</span></div><div class="rk"><span class="num rk-v accent">' + r.adds + '</span><span class="rk-l">项加重</span></div></div>' +
        '<div class="list">' + r.items.map(function (x) { return '<div class="cell res-row">' + tier(x.tier) + '<span class="res-name flex1">' + x.name + '</span><div class="res-r"><span class="jtag" style="color:' + x.color + '">' + x.j + '</span><span class="res-next num">' + x.next + '</span></div></div>'; }).join('') + '</div>' +
        '<div class="sheet-btns"><div class="btn-ghost" data-act="gotoStats">查看数据</div><div class="btn-ghost solid" data-act="closeResult">好</div></div></div></div>';
    }
    return h;
  }

  function trainAct(act, ds, el) {
    var t = S.train, en, vm;
    switch (act) {
      case 'date': if (el.value) t.date = el.value; return true;
      case 'bkexport': exportFile(); return false;
      case 'bkdismiss': localStorage.setItem(BK_DISMISS, GZ.today()); return true;
      case 'bkset': S.tab = 'settings'; S.settings.view = ''; render(); setTimeout(function () { var x = document.getElementById('syncSec'); if (x) x.scrollIntoView({ block: 'start' }); }, 30); return false;
      case 'editLocked': startEdit(ds.id); return true;
      case 'openswap': openSwap(ds.slot); return true;
      case 'closeswap': t.swap.show = false; return true;
      case 'swaptier': if (t.swap.slotTier === 'T1') return false; t.swap.tier = ds.t; return true;
      case 'swapq': t.swap.q = el.value; updateSwapList(); return false;
      case 'swappick':
        var sw = t.swap;
        if (ds.name === sw.curName) { sw.show = false; return true; }
        sw.sel = ds.name;
        var sr = GZ.recommendWeight(load(), ds.name, sw.slotTier, { preferLast: true });
        sw.weight = String(sr.weight); sw.recText = sr.text; sw.recUnit = sr.unit; sw.recNote = sr.note; sw.selEquip = sr.equip;
        return true;
      case 'swapscope': t.swap.scope = ds.s; return true;
      case 'swapw': t.swap.weight = el.value; return false;
      case 'swaprestore': en = entry(t.swap.slotId); delete en.ex; en.w = null; t.swap.show = false; return true;
      case 'swapok': return swapConfirm();
      case 'day': if (t.recordId) return; t.day = ds.day; t.deload = undefined; t.draft = GZ.blankDraft(load(), ds.day); return true;
      case 'deload': t.deload = el.checked; return true;
      case 'focus': t.focus = ds.slot; render(true); setTimeout(function () { var c = document.querySelector('.ex.is-focus'); if (c) c.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 20); return false;
      case 'step':
        en = entry(ds.slot); vm = trainVM();
        var it = vm.items.filter(function (x) { return x.slotId === ds.slot; })[0];
        var tg = it.amrapTarget || it.reps;
        var v = en.v === null || en.v === '' || en.v === undefined ? (Number(ds.d) > 0 ? tg : tg - 1) : Number(en.v) + Number(ds.d);
        en.v = Math.max(0, Math.min(60, v)); if (navigator.vibrate) navigator.vibrate(8); return true;
      case 'amrap': en = entry(ds.slot); en.v = el.value === '' ? null : Math.max(0, Math.min(60, parseInt(el.value, 10) || 0)); return true;
      case '5rm': entry(ds.slot).new5RM = el.value; return true;
      case 'done': en = entry(ds.slot); en.v = en.v === ds.v ? null : ds.v; return true;
      case 'reps': entry(ds.slot).reps = el.value; return true;
      case 'skip': en = entry(ds.slot); en.skip = !en.skip; return true;
      case 'editW': en = entry(ds.slot); en.editW = !en.editW; return true;
      case 'wstep':
        en = entry(ds.slot); vm = trainVM();
        var iw = vm.items.filter(function (x) { return x.slotId === ds.slot; })[0];
        var nw = Math.max(0, Math.round((Number(iw.weight) + Number(ds.d) * iw.wStep) * 100) / 100);
        en.w = nw === iw.autoWeight ? null : nw; if (navigator.vibrate) navigator.vibrate(8); return true;
      case 'winput':
        en = entry(ds.slot); vm = trainVM();
        var iw2 = vm.items.filter(function (x) { return x.slotId === ds.slot; })[0], n = parseFloat(el.value);
        en.w = el.value === '' || isNaN(n) || n === iw2.autoWeight ? null : n; return true;
      case 'wreset': entry(ds.slot).w = null; return true;
      case 'bw': t.bw = el.value; return false;
      case 'note': t.note = el.value; return false;
      case 'dot':
        en = entry(ds.slot); vm = trainVM();
        var it2 = vm.items.filter(function (x) { return x.slotId === ds.slot; })[0], i = Number(ds.i);
        en.done = en.done === i + 1 ? i : i + 1;
        if (en.done === i + 1 && en.done < it2.sets) beginRest(Number(ds.rest), ds.name);
        return true;
      case 'rest': beginRest(Number(ds.rest), ds.name); return false;
      case 'cancelEdit': t.recordId = null; t.day = null; t.draft = null; t.deload = undefined; t.date = GZ.today(); t.bw = ''; t.note = ''; return true;
      case 'submit': submit(); return false;
      case 'closeResult': t.result = null; return true;
      case 'gotoStats': t.result = null; S.tab = 'stats'; return true;
    }
  }
  function submit() {
    var vm = trainVM(), t = S.train;
    if (vm.locked) return;
    var missing = vm.deload ? [] : vm.items.filter(function (it) { return !it.skip && (it.value === null || it.value === undefined || it.value === ''); });
    if (missing.length === vm.items.length) return toast('至少填写一个动作');
    var go = function () {
      missing.forEach(function (it) { entry(it.slotId).skip = true; });
      var db = load();
      var bw = t.bw ? Number(t.bw) : null;
      var rec = GZ.saveRecord(db, { id: t.recordId, date: t.date, day: t.day, deload: vm.deload, note: t.note, bw: bw, entries: t.draft, createdAt: t.recordId ? t.createdAt : Date.now() });
      if (bw > 0) db.params.bodyWeight = bw;
      save(db);
      var s = GZ.sessionResult(db, rec.id), rdn = GZ.roundInfo(db), wDone = !t.recordId && s && rdn.week > s.week;
      var dCyc = s ? GZ.cycleOf(s.week, db.params).cycle : 1, nCyc = GZ.cycleOf(rdn.week, db.params).cycle, cDone = wDone && nCyc > dCyc;
      var rotated = cDone ? GZ.buildRotation(db, nCyc).changed : 0;
      t.result = s ? { rotated: rotated, day: s.rec.day, dayName: s.dayName, week: s.week, weekText: GZ.weekText(s.week, db.params),
        cycle: dCyc, weeksPerCycle: GZ.cycleLen(db.params), cycleDone: cDone, nextWeekText: GZ.weekText(rdn.week, db.params), volume: Math.round(s.volume),
        weekDone: wDone, leftText: t.recordId ? '' : rdn.leftText, nextDeload: wDone && GZ.isDeloadWeek(rdn.week, db.params), adds: s.items.filter(function (x) { return x.judgment === '加重'; }).length,
        items: s.items.map(function (it) { return { tier: it.tier, name: it.name, j: it.judgment, color: GZ.JUDGE_COLORS[it.judgment], next: it.deload || it.judgment === '跳过' ? '—' : it.sub ? GZ.fmtW(it.weight) + ' kg · 替代 ' + it.origName : GZ.fmtW(it.nextWeight) + ' kg · ' + it.nextStage }; }) } : null;
      t.recordId = null; t.deload = undefined; t.day = GZ.recommend(db).day; t.draft = GZ.blankDraft(db, t.day); t.bw = ''; t.note = ''; t.date = GZ.today();
      render();
    };
    if (missing.length) confirmBox('还有未填写的动作', missing.map(function (m) { return m.name; }).join('、') + ' 将按“跳过”保存，状态保持不变。', go); else go();
  }
  function openSwap(slot) {
    var t = S.train, vm = trainVM(), it = vm.items.filter(function (x) { return x.slotId === slot; })[0];
    var ctx = GZ.swapContext(load(), t.day, slot);
    t.swap = { show: true, slotId: slot, dayId: t.day, slotTier: it.tier, tier: it.tier, q: '', sel: '', scope: 'once', curName: it.name, planName: it.planName,
      isSub: it.sub, editing: !!t.recordId, rotates: ctx.rotates, week: ctx.week, weight: ctx.weightText, ctxW: ctx.weight, lastW: ctx.lastW };
  }
  function swapLib() { var sw = S.train.swap; return GZ.buildLibrary(load(), { tier: sw.tier, q: sw.q, current: sw.curName }); }
  function updateSwapList() {
    var el = document.getElementById('swapList'), sw = S.train.swap; if (!el) return;
    el.innerHTML = '<div class="list">' + libRows(swapLib(), { pick: true, sel: sw.sel, slotTier: sw.slotTier, showTier: !!sw.q, empty: '没有找到，可在「设置 → 动作库」添加自定义动作' }) + '</div>';
    var sg = document.getElementById('swapSeg'); if (sg) sg.style.display = sw.q ? 'none' : '';
  }
  function renderSwap() {
    var sw = S.train.swap, lib = swapLib(), h = '';
    h += '<div class="mask" data-act="closeswap"><div class="sheet swap-sheet" data-stop="1"><div class="grabber"></div>' +
      '<span class="sheet-cap">' + sw.slotTier + ' · 当前 ' + esc(sw.curName) + (sw.planName !== sw.curName ? '（原 ' + esc(sw.planName) + '）' : '') + '</span>' +
      '<div class="row between"><div class="sheet-title">更换动作</div>' + (sw.isSub ? '<span class="link" data-act="swaprestore">恢复 ' + esc(sw.planName) + '</span>' : '') + '</div>' +
      '<div class="search"><span class="search-ic">⌕</span><input class="search-in" data-act="swapq" value="' + esc(sw.q) + '" placeholder="搜索动作、部位或器械"></div>' +
      (sw.slotTier === 'T1'
        ? '<div class="sec-f t1-only">T1 严格限定四大项，只能在深蹲、卧推、硬拉、实力推之间选择。</div>'
        : '<div id="swapSeg"' + (sw.q ? ' style="display:none"' : '') + '>' + seg(lib.tiers.map(function (x) { return { html: x.id + '<span class="seg-n">' + x.n + '</span>', on: sw.tier === x.id, data: ' data-t="' + x.id + '"' }; }), -1, 'swaptier') + '</div>') +
      '<div class="lib-list" id="swapList"><div class="list">' + libRows(lib, { pick: true, sel: sw.sel, slotTier: sw.slotTier, showTier: !!sw.q, empty: '没有找到，可在「设置 → 动作库」添加自定义动作' }) + '</div></div>';
    if (sw.sel) {
      if (!sw.editing) h += seg([{ html: '仅本次', on: sw.scope === 'once', data: ' data-s="once"' }, { html: '以后都用', on: sw.scope === 'perm', data: ' data-s="perm"' }], -1, 'swapscope', 'swap-scope');
      h += '<div class="swap-rec">' + equipTag(sw.selEquip) + '<div><div class="swap-rec-v">推荐 ' + esc(sw.recText) + (sw.recUnit === '自重' ? '' : ' ' + esc(sw.recUnit)) + '</div><div class="swap-rec-n">' + esc(sw.recNote) + '</div></div></div>';
      if (sw.scope === 'perm' && !sw.editing && sw.selEquip !== '自重') h += '<div class="list"><div class="cell"><span class="flex1">起始重量</span><input class="cell-in num" inputmode="decimal" data-act="swapw" value="' + esc(sw.weight) + '"><span class="unit">' + esc(sw.recUnit) + '</span></div></div>';
      h += '<div class="sec-f">' + (sw.scope === 'once' || sw.editing
        ? '本次用推荐重量练「' + esc(sw.sel) + '」，记录容量，不改变「' + esc(sw.planName) + '」的阶段和重量。'
        : '从第 ' + sw.week + ' 周起，' + sw.dayId + ' 的这个位置改为「' + esc(sw.sel) + '」，按 ' + sw.slotTier + ' 规则从起始重量重新进阶；历史记录保持不变。' + (sw.rotates ? '下一轮仍按轮换计划自动编排（可在设置里锁定这个位置）。' : '')) + '</div>' +
        '<button class="btn-primary swap-ok" data-act="swapok">确认更换</button>';
    }
    return h + '</div></div>';
  }
  function swapConfirm() {
    var t = S.train, sw = t.swap, en = entry(sw.slotId);
    var wEl = document.querySelector('[data-act=swapw]'); if (wEl) sw.weight = wEl.value;
    if (sw.scope === 'once' || sw.editing) {
      en.ex = sw.sel; en.w = Number(sw.weight) || 0;
      toast('本次改为 ' + sw.sel + ' · ' + sw.recText + (sw.recUnit === '自重' ? '' : ' ' + sw.recUnit));
    }
    else {
      var w = parseFloat(sw.weight);
      if (isNaN(w) || w < 0) { toast('请填写起始重量'); return false; }
      var db = load(), r = GZ.swapSlot(db, sw.dayId, sw.slotId, sw.sel, w);
      if (r && r.error) { toast(r.error); return false; }
      save(db);
      delete en.ex; en.w = null; en.editW = false;
      toast(r && r.base ? '已更换为 ' + sw.sel : '第 ' + r.fromWeek + ' 周起改为 ' + sw.sel);
    }
    sw.show = false; return true;
  }
  function startEdit(id) {
    var db = load(), rec = GZ.getRecord(db, id), t = S.train; if (!rec) return;
    var draft = GZ.blankDraft(db, rec.day);
    Object.keys(draft).forEach(function (k) { if (rec.entries[k]) draft[k] = Object.assign({ done: 0 }, rec.entries[k]); });
    t.recordId = id; t.day = rec.day; t.deload = !!rec.deload; t.draft = draft; t.date = rec.date; t.bw = rec.bw || ''; t.note = rec.note || ''; t.createdAt = rec.createdAt;
    S.tab = 'train';
  }
  function beginRest(sec, name) {
    clearInterval(rest.timer); rest.show = true; rest.open = false; rest.left = sec; rest.total = sec; rest.name = name; renderRest();
    rest.timer = setInterval(function () {
      rest.left -= 1;
      if (rest.left <= 0) { clearInterval(rest.timer); rest.show = false; renderRest(); toast('休息结束，开始下一组'); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); return; }
      renderRest();
    }, 1000);
  }
  function renderRest() {
    var el = document.getElementById('rest');
    if (!rest.show) { el.innerHTML = ''; return; }
    var pct = Math.max(0, Math.min(100, rest.left / rest.total * 100)), app = document.querySelector('.app'), tb = document.getElementById('tabbar');
    var bottom = 12 + (app && tb ? app.getBoundingClientRect().bottom - tb.getBoundingClientRect().top : 60) + (S.tab === 'train' && !S.train.result ? 72 : 0);
    el.innerHTML = '<div class="rest-float" style="bottom:' + Math.round(bottom) + 'px">' +
      (rest.open ? '<div class="rest-pop"><div class="rp-n">' + esc(rest.name) + ' · 组间休息</div><div class="rp-btns"><div class="rp-b" data-rest-adj="-30">−30 秒</div><div class="rp-b main" data-rest-stop="1">结束休息</div><div class="rp-b" data-rest-adj="30">+30 秒</div></div></div>' : '') +
      '<div class="rest-cap" data-rest-toggle="1"><span class="rc-ring" style="background:conic-gradient(#fff ' + pct + '%, rgba(255,255,255,0.25) 0)"><i></i></span><span class="rc-t num">' + fmtSec(rest.left) + '</span><span class="rc-l">休息</span></div></div>';
  }

  // ================= 计划 =================
  function renderPlan() {
    var db = load(), vm = GZ.buildPlan(db, { cycle: S.plan.cycle }), p = S.plan, h = '';
    h += '<div class="card next-card"><div class="row"><div class="flex1"><span class="cap">下一次训练</span><div class="next-t"><span class="num accent">' + vm.next.day + '</span> ' + vm.next.name + '</div>' +
      '<span class="cap">' + vm.next.weekText + (vm.next.deload ? ' · 减载周' : '') + '</span></div><div class="go-btn" data-act="go" data-day="' + vm.next.day + '">开始</div></div>' +
      '<div class="prog"><div class="row between"><span class="cap">本轮进度（' + vm.weeksPerCycle + ' 周 / 轮）</span><span class="cap"><span class="num strong">' + vm.cycleDone + '</span> / ' + vm.cyclePlanned + ' 次 · ' + vm.cycleProgress + '%</span></div>' +
      '<div class="bar"><div class="bar-in" style="width:' + vm.cycleProgress + '%"></div></div><span class="cap total-cap">累计已完成 ' + vm.done + ' 次训练</span></div></div>';
    h += '<div class="card"><div class="card-title"><div class="cyc-nav"><span class="cyc-btn ' + (vm.canPrev ? '' : 'off') + '" data-act="cycle" data-d="-1">‹</span>' +
      '<span class="t cyc-label">' + vm.cycleText + (vm.isFuture ? ' · 预览' : vm.isCurCycle ? ' · 进行中' : '') + '</span>' +
      '<span class="cyc-btn ' + (vm.canNext ? '' : 'off') + '" data-act="cycle" data-d="1">›</span></div><span class="s">T1 重量 kg</span></div><div class="grid-head"><span class="gw"></span>' +
      vm.days.map(function (d) { return '<span class="gh num">' + d.id + '</span>'; }).join('') + '</div>';
    vm.rows.forEach(function (row) {
      h += '<div class="grid-row"><div class="gw"><span class="num">W' + row.wc + '</span>' + (row.deload ? '<span class="dltag">减载</span>' : '') + '</div>' +
        row.cells.map(function (c) {
          return '<div class="gcell ' + c.status + '" data-act="cell" data-day="' + c.day + '" data-status="' + c.status + '" data-id="' + (c.recordId || '') + '"><span class="cw num">' + c.w + '</span>' +
            (c.status === 'done' ? '<div class="cdot" style="background:' + c.color + '"></div>' : '') + '</div>';
        }).join('') + '</div>';
    });
    h += '<div class="legend"><div class="lg"><div class="sw" style="background:#FF6B1A"></div>已完成 · 圆点为判定</div><div class="lg"><div class="sw" style="box-shadow:inset 0 0 0 2px #FF6B1A"></div>下一次</div><div class="lg"><div class="sw" style="background:#E5E5EA"></div>每次加重的推演</div></div></div>';
    var rt = vm.rotation;
    if (rt) {
      h += '<div class="card rot-card"><div class="card-title"><span class="t">' + vm.cycleText + '动作编排</span><span class="s">' +
        (!rt.enabled ? '自动轮换已关闭' : rt.cycle === 1 ? '起始动作' : '换了 ' + rt.changed + ' / ' + rt.total + ' 个') + '</span></div>' +
        '<div class="rot-tip">' + (rt.isCur ? '点任意一行可调整重量或更换动作，从该训练日的下一次训练起生效。' : 'T1 四大项固定；T2/T3 每轮在同一动作模式内换一次，一轮 ' + vm.weeksPerCycle + ' 周内保持不变。') + (rt.isFuture ? '这一轮还没开始，以下为预排。' : '') + '</div>' +
        rt.days.map(function (d) {
          return '<div class="rot-day"><div class="rot-dh"><span class="num rot-did">' + d.id + '</span><span class="rot-dn">' + esc(d.name) + '</span></div>' +
            d.slots.map(function (r) {
              return '<div class="rot-row' + (rt.isCur ? ' tap' : '') + '"' + (rt.isCur ? ' data-act="slotsheet" data-day="' + d.id + '" data-slot="' + r.id + '"' : '') + '>' + tier(r.tier) +
                '<div class="rot-main"><div class="rot-n">' + esc(r.name) + equipTag(r.equip) +
                (r.isNew ? '<span class="rot-new">新</span>' : '') + (r.fixed ? '<span class="rot-lock">固定</span>' : r.locked ? '<span class="rot-lock">锁定</span>' : '') + '</div>' +
                '<div class="rot-s">' + (rt.isCur && r.cur ? '<span class="num rot-cw">' + esc(r.cur) + '</span>' : '') + esc(r.role) + (r.isNew ? ' · 上一轮 ' + esc(r.prev) : '') + (r.startW ? ' · 起始 ' + esc(r.startW) : '') + '</div></div>' +
                (rt.isCur ? '<span class="rot-chev">›</span>' : '') + '</div>';
            }).join('') + '</div>';
        }).join('') +
        '<div class="rot-why-btn" data-act="why">' + (p.why ? '收起编排依据' : '查看编排依据') + '<span class="chev">' + (p.why ? '⌃' : '›') + '</span></div>' +
        (p.why ? '<div class="rot-why">' + rt.principles.map(function (x, i) { return '<div class="rw"><span class="rw-t">' + (i + 1) + '. ' + esc(x.t) + '</span><span class="rw-d">' + esc(x.d) + '</span></div>'; }).join('') + '</div>' : '') +
        '</div>';
    }
    var ov = vm.overview[p.ov];
    h += '<div class="card"><div class="card-title"><span class="t">当前状态</span><span class="s">自动更新</span></div>' +
      seg(vm.overview.map(function (o) { return { html: '<span class="num">' + o.day + '</span>' }; }), p.ov, 'ov') +
      ov.slots.map(function (s) {
        return '<div class="ov-row">' + tier(s.tier) + '<div class="ov-main"><span class="ovn">' + s.name + '</span><span class="ov-sub">' + s.stage + (s.fail > 0 ? '<span class="amber"> · 预警 ' + s.fail + '</span>' : '') + '</span></div>' +
          '<div class="ov-right"><span class="num ov-w">' + s.weight + '<span class="ov-u"> kg</span></span><span class="ov-last"><span style="color:' + s.lastColor + '">' + s.last + '</span>' + (s.gain ? '<span class="green"> ' + s.gain + '</span>' : '') + '</span></div></div>';
      }).join('') + '</div>';
    if (p.detail) {
      var d = p.detail;
      h += '<div class="mask" data-act="closeDetail"><div class="sheet" data-stop="1"><div class="grabber"></div><span class="sheet-cap">' + d.dateText + ' · 第 ' + d.week + ' 次 · 容量 ' + d.vol + ' kg</span><div class="sheet-title">' + d.day + ' ' + d.dayName + '</div>' +
        '<div class="list">' + d.items.map(function (it) { return '<div class="cell d-row">' + tier(it.tier) + '<div class="d-main"><span>' + it.name + '</span><span class="d-sub">' + it.w + ' kg × ' + it.input + (it.manual ? '<span class="accent"> · 手动</span>' : '') + '</span></div><div class="d-right"><span class="jtag" style="color:' + it.color + '">' + it.j + '</span><span class="d-sub">' + it.next + '</span></div></div>'; }).join('') + '</div>' +
        (d.note ? '<div class="note-box">' + esc(d.note) + '</div>' : '') +
        '<div class="sheet-btns"><div class="btn-ghost" data-act="edit" data-id="' + d.id + '">修改这次</div><div class="btn-ghost solid" data-act="closeDetail">完成</div></div></div></div>';
    }
    if (p.slot) h += renderSlotSheet();
    return h;
  }
  // ============ 计划页：单个位置的动作面板（调整重量 / 更换动作 / 锁定轮换） ============
  function slotState(dayId, slotId) {
    var info = GZ.slotInfo(load(), dayId, slotId);
    if (!info) return null;
    return { day: dayId, slot: slotId, info: info, mode: 'info', w: String(info.weight), q: '' };
  }
  function renderSlotSheet() {
    var sl = S.plan.slot; if (!sl) return '';
    var info = sl.info, h = '', pick = sl.mode === 'pick';
    h += '<div class="mask" data-act="slotclose"><div class="sheet slot-sheet" data-stop="1"><div class="grabber"></div>' +
      '<div class="row between"><span class="sheet-cap">' + info.dayId + ' · ' + esc(info.dayName) + '</span><span class="link" data-act="slotclose">关闭</span></div>' +
      '<div class="slot-head">' + tier(info.tier) + '<span class="slot-name">' + esc(pick ? '更换动作 · 当前 ' + info.name : info.name) + '</span>' + (pick ? '' : equipTag(info.equip)) + '</div>';
    if (pick) {
      h += '<div class="search"><span class="search-ic">⌕</span><input class="search-in" data-act="slotq" value="' + esc(sl.q) + '" placeholder="搜索动作、部位或器械"></div>' +
        '<div class="sec-f">选中后从现在' + info.when + '这次开始用新动作，按 ' + info.tier + ' 规则从推荐重量重新进阶。原动作的历史记录不受影响。</div>' +
        '<div class="lib-list"><div class="list">' + libRows(GZ.buildLibrary(load(), { tier: info.tier, q: sl.q, current: info.name }), { pick: true, sel: '', slotTier: info.tier, empty: '没有找到' }) + '</div></div>';
      return h + '</div></div>';
    }
    h += '<div class="slot-now"><div class="slot-wbox"><span class="num slot-wv">' + (info.canAdjust ? info.weightText : '自重') + '</span><span class="slot-wu">' + (info.canAdjust ? esc(info.unitText) : '') + '</span></div>' +
      '<div class="slot-meta"><span class="slot-reps">' + esc(info.repsText) + '</span>' +
      '<span class="slot-when">' + (info.adjusted ? '已手动调整 · ' : '') + '下次 ' + info.when + ' · ' + esc(info.weekText) + '</span></div></div>';
    if (info.canAdjust) {
      h += '<div class="list"><div class="cell slot-adj"><span class="flex1">调整重量</span><div class="stepper">' +
        '<div class="st-btn" data-act="swstep" data-d="-1">−</div><input class="st-val num" inputmode="decimal" data-act="swin" value="' + esc(sl.w) + '">' +
        '<div class="st-btn" data-act="swstep" data-d="1">+</div></div></div></div>' +
        '<div class="sec-f">只改重量，阶段和失败次数都不变，也不会改动已有记录，之后照常按规则加重。</div>';
    }
    if (info.rotTier) {
      h += '<div class="list"><div class="cell tap" data-act="slotpick"><span class="flex1">更换动作</span><span class="val">' +
        esc(info.nextCycle ? '第 ' + info.nextCycle + ' 轮换成 ' + info.nextName : '') + '</span><span class="chev">›</span></div>' +
        '<div class="cell"><span class="flex1">锁定，不参与自动轮换</span><label class="ios-sw green"><input type="checkbox" data-act="slotlock" ' + (info.locked ? 'checked' : '') + '><i></i></label></div></div>' +
        '<div class="sec-f">' + esc(info.why) + '。锁定后这个位置每轮都用同一个动作，除非你手动更换。</div>';
    } else {
      h += '<div class="sec-f">T1 主项固定在本训练日，不参与轮换，训练时可以临时替换。</div>';
    }
    var changed = Math.abs((Number(sl.w) || 0) - info.weight) > 0.01;
    h += '<button class="btn-primary slot-ok" data-act="slotsw">' + (changed ? '改成 ' + (Number(sl.w) || 0) + (info.canAdjust ? ' ' + esc(info.unitText) : '') : '完成') + '</button>';
    return h + '</div></div>';
  }
  function goTrain(day) { var t = S.train; if (!t.recordId) { t.day = day; t.draft = GZ.blankDraft(load(), day); t.deload = undefined; } S.tab = 'train'; }
  function planAct(act, ds, el) {
    var p = S.plan;
    if (act === 'swappick' && p.slot && p.slot.mode === 'pick') {
      var inf2 = p.slot.info;
      if (ds.name === inf2.name) { p.slot.mode = 'info'; return true; }
      var dbp = load(), rw = GZ.recommendWeight(dbp, ds.name, inf2.tier, { preferLast: true });
      var rs = GZ.swapSlot(dbp, p.slot.day, p.slot.slot, ds.name, rw.weight);
      if (rs && rs.error) { toast(rs.error); return false; }
      save(dbp);
      p.slot = slotState(p.slot.day, p.slot.slot);
      toast('已改为 ' + ds.name + (rw.unit === '自重' ? '' : ' · 起始 ' + rw.text + ' ' + rw.unit) + '，' + inf2.when + '生效'); return true;
    }
    if (act === 'ov') { p.ov = Number(ds.i); return true; }
    if (act === 'why') { p.why = !p.why; return true; }
    if (act === 'cycle') {
      var vm = GZ.buildPlan(load(), { cycle: p.cycle });
      var next = vm.cycle + Number(ds.d);
      if (next < 1 || next > vm.maxCycle) return false;
      p.cycle = next; return true;
    }
    if (act === 'go') { goTrain(ds.day); return true; }
    if (act === 'cell') {
      if (ds.status === 'done') { p.detail = GZ.buildReview(load()).logs.filter(function (l) { return l.id === ds.id; })[0]; return true; }
      if (ds.status === 'next' || ds.status === 'ready') { goTrain(ds.day); return true; }
      toast('推演值：假设每次都加重'); return false;
    }
    if (act === 'slotsheet') { p.slot = slotState(ds.day, ds.slot); return true; }
    if (act === 'slotclose') { p.slot = null; return true; }
    if (act === 'slotpick') {
      if (p.slot.info.tier === 'T1') { toast('T1 只能在训练时临时替换'); return false; }
      p.slot.mode = 'pick'; p.slot.q = ''; return true;
    }
    if (act === 'slotq') { p.slot.q = el.value; return true; }
    if (act === 'swstep') {
      var inf = p.slot.info, cur = Number(p.slot.w) || 0;
      p.slot.w = String(Math.max(0, Math.round((cur + Number(ds.d) * inf.wStep) * 100) / 100));
      return true;
    }
    if (act === 'swin') { p.slot.w = el.value; return false; }
    if (act === 'slotlock') {
      var dbl = load(); GZ.setNoRotate(dbl, p.slot.day, p.slot.slot, el.checked); save(dbl);
      var back = slotState(p.slot.day, p.slot.slot); p.slot = back;
      toast(el.checked ? '已锁定，不再自动轮换' : '已恢复自动轮换'); return true;
    }
    if (act === 'slotsw') {
      var dbw = load(), wv = Number(p.slot.w), infw = p.slot.info;
      if (isNaN(wv) || wv < 0) { toast('请填写重量'); return false; }
      if (Math.abs(wv - infw.weight) < 0.01) { p.slot = null; return true; }
      var rr = GZ.adjustSlot(dbw, p.slot.day, p.slot.slot, wv);
      if (rr && rr.error) { toast(rr.error); return false; }
      save(dbw);
      p.slot = slotState(p.slot.day, p.slot.slot);
      toast(infw.name + ' 改为 ' + wv + (infw.canAdjust ? ' ' + infw.unitText : '') + ' · ' + infw.when + '生效'); return true;
    }
    if (act === 'closeDetail') { p.detail = null; return true; }
    if (act === 'edit') { p.detail = null; startEdit(ds.id); return true; }
  }

  // ================= 数据 =================
  function renderStats() {
    var s = GZ.buildStats(load()), st = S.stats, k = s.kpi, cur = s.e1rm[st.lift], h = '';
    S._stats = s;
    h += '<div class="kpis"><div class="kpi"><span class="k-l">训练次数</span><div><span class="num kv">' + k.sessions + '</span><span class="ku">/ ' + k.planned + '</span></div><div class="kbar"><div class="kin" style="width:' + k.progress + '%"></div></div></div>' +
      '<div class="kpi"><span class="k-l">累计容量</span><span class="num kv">' + k.volume + '</span><span class="ks">' + k.reps + ' 次</span></div>' +
      '<div class="kpi"><span class="k-l">加重</span><div><span class="num kv accent">' + k.adds + '</span><span class="ku">次</span></div><span class="ks">预警 ' + k.warns + '</span></div>' +
      '<div class="kpi"><span class="k-l">T1 达标率</span>' + (k.t1Rate === null ? '<span class="kv-na">暂无</span>' : '<span class="num kv">' + k.t1Rate + '%</span>') + '<span class="ks">T2 完成 ' + (k.t2Rate === null ? '暂无' : k.t2Rate + '%') + '</span></div></div>';
    h += '<div class="card">' + seg(s.e1rm.map(function (e) { return { html: e.name }; }), st.lift, 'lift');
    if (cur) {
      h += '<span class="cap">最佳 e1RM</span><div class="hero"><span class="num hero-v">' + cur.best + '</span><span class="hero-u">' + (cur.n ? 'kg' : '') + '</span><span class="cap hero-d">' + cur.bestDate + '</span></div>';
      if (cur.n < 2) {
        var need = 2 - cur.n;
        h += '<div class="empty-chart"><div class="ec-dots">' + [0, 1].map(function (i) { return '<i class="' + (i < cur.n ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
          '<div class="ec-t">再练 ' + need + ' 次' + esc(cur.name) + '就能看到趋势</div><div class="ec-s">每次 ' + cur.day + ' 的末组 AMRAP 会估算一次 1RM，至少 2 次才能画出趋势线</div></div>';
      } else h += '<canvas id="c_e1" class="cv"></canvas>' +
        '<div class="mini"><div class="mi"><span class="num mi-v">' + cur.slope + '</span><span class="mi-l">kg / 周</span></div><div class="mi"><span class="num mi-v">' + cur.r2 + '</span><span class="mi-l">R²</span></div><div class="mi"><span class="num mi-v accent">' + cur.predict + '</span><span class="mi-l">W' + s.totalWeeks + ' 预测</span></div></div>';
      if (cur.sampleTip && cur.n >= 2) h += '<div class="tip">' + cur.sampleTip + '</div>';
      else if (cur.vs1RM !== null && cur.vs1RM > 3) h += '<div class="tip">已超过录入 1RM ' + cur.vs1RM + '%，可以在设置里更新 1RM</div>';
    }
    h += (cur && cur.n >= 2 ? '<div class="legend"><div class="lg"><div class="sw" style="background:#FF6B1A"></div>e1RM</div><div class="lg"><div class="sw dash" style="border-color:#0A84FF"></div>回归趋势</div><div class="lg"><div class="sw dash" style="border-color:#C7C7CC"></div>录入 1RM</div></div>' : '') + '</div>';
    var wt = s.weightTrend[st.day];
    h += '<div class="card"><div class="card-title"><span class="t">重量走势</span><span class="s">空心点为下次计划</span></div>' +
      seg(s.weightTrend.map(function (d) { return { html: '<span class="num">' + d.day + '</span>' }; }), st.day, 'wday') +
      '<canvas id="c_w" class="cv"></canvas><div class="legend">' + wt.cols.map(function (c, i) { return '<div class="lg"><div class="sw" style="background:' + Chart.PALETTE[i] + '"></div>' + c.name + '</div>'; }).join('') + '</div></div>';
    h += '<div class="card"><div class="card-title"><span class="t">每周容量</span><span class="s">重量 × 组 × 次</span></div><canvas id="c_v" class="cv"></canvas><div class="legend">' +
      s.volume.stacks.map(function (x) { return '<div class="lg"><div class="sw" style="background:' + x.color + '"></div>' + x.name + '</div>'; }).join('') + '</div></div>';
    h += '<div class="card"><div class="card-title"><span class="t">判定分布</span><span class="s">全部训练日</span></div><div class="row"><canvas id="c_p" class="cv-sq"></canvas><div class="pie-list">' +
      (s.pie.length ? s.pie.map(function (x) { return '<div class="pl"><div class="sw" style="background:' + x.color + '"></div><span class="pl-l">' + x.label + '</span><span class="num pl-v">' + x.value + '</span><span class="pl-p num">' + x.pct + '%</span></div>'; }).join('') : '<div class="cap">暂无判定</div>') + '</div></div></div>';
    h += '<div class="sec-h">最高重量</div><div class="list">' +
      (s.prs.length ? s.prs.map(function (x) { return '<div class="cell pr">' + tier(x.tier) + '<div class="pr-main"><span>' + x.name + '</span><span class="pr-sub">' + x.day + ' · ' + x.date + '</span></div><span class="num pr-w">' + x.w + '<span class="pr-u"> kg</span></span></div>'; }).join('') : '<div class="empty-tip">完成训练后显示</div>') + '</div>';
    if (s.bw.length >= 2) h += '<div class="sec-h">体重</div><div class="card"><canvas id="c_bw" class="cv short"></canvas></div>';
    return h;
  }
  function ctxOf(id) {
    var c = document.getElementById(id); if (!c) return null;
    var r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 2;
    c.width = r.width * dpr; c.height = r.height * dpr;
    var ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: r.width, h: r.height };
  }
  function drawStats() {
    var s = S._stats, st = S.stats, P = Chart.presets, c;
    if ((c = ctxOf('c_e1')) && s.e1rm[st.lift]) P.e1rm(c.ctx, c.w, c.h, s.e1rm[st.lift], s.totalWeeks);
    if ((c = ctxOf('c_w'))) P.weight(c.ctx, c.w, c.h, s.weightTrend[st.day], s.totalWeeks);
    if ((c = ctxOf('c_v'))) P.volume(c.ctx, c.w, c.h, s.volume);
    if ((c = ctxOf('c_p'))) P.pie(c.ctx, c.w, c.h, s);
    if ((c = ctxOf('c_bw'))) P.bw(c.ctx, c.w, c.h, s.bw);
  }
  function statsAct(act, ds) {
    if (act === 'lift') { S.stats.lift = Number(ds.i); return true; }
    if (act === 'wday') { S.stats.day = Number(ds.i); return true; }
  }

  // ================= 回顾 =================
  function renderReview() {
    var vm = GZ.buildReview(load()), r = S.review, h = '';
    S._review = vm;
    h += seg([{ html: '总结' }, { html: '周报' }, { html: '日志' }], r.tab, 'rtab');
    var sd = Share.build(load());
    if (sd) h += '<div class="card share-entry"><span class="cap">' + (sd.isToday ? '今日战报' : '最近一次 · ' + sd.date.slice(5).replace('-', '月') + '日') + '</span><div class="share-entry-title">把努力，晒成一张卡。</div><div class="share-entry-meta">' + sd.day + ' ' + esc(sd.dayName) + ' · ' + sd.rows.length + ' 项动作 · ' + sd.volumeText + ' t 训练容量</div><button class="btn-primary" data-act="shareopen" data-id="' + sd.recordId + '">生成分享卡片</button></div>';
    else h += '<div class="card share-entry"><div class="share-entry-title">第一张训练战报，等你完成。</div><div class="sec-f">记录一次训练后，可生成高清分享卡片。</div></div>';
    var bs = Share.badgeState(load());
    h += '<div class="list wall-entry"><div class="cell tap" data-act="wallopen"><span class="flex1">里程碑</span><span class="val">已获得 ' + bs.earnedCount + ' / ' + bs.total + ' 枚</span><span class="chev">›</span></div>' +
      (bs.nextGoals[0] ? (function () { var g = bs.nextGoals[0], d = bs.byId[g.id], p = bs.prog[g.id]; return '<div class="cell tap wall-goal" data-act="wallopen"><span class="wall-e" aria-hidden="true">' + esc(d.e) + '</span><div class="wall-nt"><b>下一个：' + esc(d.title) + '</b><i>' + esc(fmtProg(p)) + '</i><span class="wall-bar"><span style="width:' + Math.max(4, Math.round(p.pct * 100)) + '%"></span></span></div><span class="wall-pct num">' + Math.round(p.pct * 100) + '%</span></div>'; })() : '') + '</div>';
    if (r.tab === 0) {
      h += '<div class="card lt-card"><div class="card-title"><span class="t">主项进度</span><span class="s">起始 → 下次</span></div>' +
        '<div class="lt-head"><span class="lt-c1">主项</span><span class="lt-c2">最近末组</span><span class="lt-c3">下次</span><span class="lt-c4">累计</span></div>' +
        vm.liftTable.map(function (x) {
          return '<div class="lt-row"><div class="lt-c1"><span class="lt-n">' + esc(x.name) + '</span><span class="lt-s num">' + x.day + ' · ' + x.stage + (x.fail ? ' · <span class="amber">预警 ' + x.fail + '</span>' : '') + '</span></div>' +
            '<div class="lt-c2"><span class="num lt-v">' + x.last + '</span>' + (x.lastJ ? '<span class="lt-j" style="color:' + x.lastColor + '">' + x.lastJ + '</span>' : '') + '</div>' +
            '<div class="lt-c3"><span class="num lt-v">' + x.next + '</span><span class="lt-s num">起始 ' + x.start + '</span></div>' +
            '<div class="lt-c4"><span class="num lt-g ' + (x.up ? 'up' : '') + '">' + x.gain + '</span><span class="lt-s num">e1RM ' + x.best + '</span></div></div>';
        }).join('') + '</div>';
      h += '<div class="card"><div class="card-title"><span class="t">训练小结</span><span class="link" data-act="copy">复制</span></div>' +
        vm.insights.map(function (i) { return '<div class="ins"><div class="ins-ic ' + i.type + '">' + i.icon + '</div><span class="ins-t">' + esc(i.text) + '</span></div>'; }).join('') + '</div>';
      h += '<div class="card"><div class="card-title rules-h" data-act="rules"><span class="t">规则速查</span><span class="link">' + (r.rules ? '收起' : '展开') + '</span></div>';
      if (r.rules) {
        h += GZ.RULES.map(function (g) { return '<div class="rg"><div class="rg-t">' + g.title + '</div>' + g.rows.map(function (x) { return '<div class="rr"><span class="r1 num">' + x[0] + '</span><span class="r2">' + x[1] + '</span><span class="r3">' + x[2] + '</span></div>'; }).join('') + '</div>'; }).join('') +
          GZ.GENERAL_RULES.map(function (g) { return '<div class="gen">' + g + '</div>'; }).join('');
      } else h += '<span class="cap">T1 三阶进阶、T2 退阶重置、T3 阈值加重与通用规则</span>';
      h += '</div>';
    } else if (r.tab === 1) {
      if (!vm.weeks.length) h += '<div class="empty-tip">完成第一次训练后生成周报</div>';
      vm.weeks.forEach(function (w) {
        h += '<div class="card wk"><div class="row between"><div class="row"><span class="wk-n">第 ' + w.week + ' 周</span>' + (w.deload ? '<span class="dltag">减载</span>' : '') + '</div><div class="row dflags">' +
          w.days.map(function (d) { return '<span class="dflag num ' + (d.on ? 'on' : '') + '">' + d.id + '</span>'; }).join('') + '</div></div>' +
          '<div class="wk-k"><div class="wkk"><span class="num kv">' + w.volText + '</span><span class="ks">容量' + (w.dv ? '<span class="' + (w.dvUp ? 'dv-up' : 'dv-down') + '"> ' + w.dv + '</span>' : '') + '</span></div>' +
          '<div class="wkk"><span class="num kv">' + w.sessions + '/' + w.total + '</span><span class="ks">完成</span></div><div class="wkk"><span class="num kv accent">' + w.adds + '</span><span class="ks">加重</span></div>' +
          '<div class="wkk"><span class="num kv ' + (w.warns ? 'amber' : '') + '">' + w.warns + '</span><span class="ks">预警</span></div></div>' +
          w.t1.map(function (t) { return '<div class="t1row"><span class="num t1d">' + t.day + '</span><span class="t1n">' + t.name + '</span><span class="num t1w">' + t.w + ' kg × ' + (t.input === null ? '—' : t.input) + '</span><span class="jtag" style="color:' + t.color + '">' + t.j + '</span></div>'; }).join('') + '</div>';
      });
    } else {
      if (!vm.logs.length) h += '<div class="empty-tip">暂无记录</div>';
      else {
        h += '<div class="list">';
        vm.logs.forEach(function (l) {
          var op = !!r.open[l.id];
          h += '<div class="log"><div class="cell tap" data-act="toggle" data-id="' + l.id + '"><span class="num log-day">' + l.day + '</span><div class="log-meta"><span>' + l.dayName + ' · 第 ' + l.week + ' 次</span><span class="log-d">' + l.dateText + (l.deload ? ' · 减载' : '') + (l.bw ? ' · ' + l.bw + ' kg' : '') + '</span></div>' +
            '<span class="num log-v">' + l.vol + '<span class="log-u"> kg</span></span><span class="chev">' + (op ? '⌃' : '›') + '</span></div>';
          if (op) {
            h += '<div class="log-body">' + l.items.map(function (it) { return '<div class="li">' + tier(it.tier) + '<span class="li-n">' + it.name + '</span><span class="li-w num">' + (it.manual ? '<span class="accent">手动 </span>' : '') + it.w + ' × ' + it.input + '</span><span class="jtag" style="color:' + it.color + '">' + it.j + '</span></div>'; }).join('') +
              (l.note ? '<div class="note-box">' + esc(l.note) + '</div>' : '') +
              '<div class="log-act"><span class="btn-small" data-act="shareopen" data-id="' + l.id + '">分享这次</span><span class="btn-small danger" data-act="del" data-id="' + l.id + '">删除</span><span class="btn-small rust" data-act="edit" data-id="' + l.id + '">修改</span></div></div>';
          }
          h += '</div>';
        });
        h += '</div>';
      }
      h += '<div class="sec-f" style="text-align:center">修改或删除任意一次记录，之后的重量与阶段会自动重算</div>';
    }
    if (r.share) h += renderShareSheet();
    if (r.wall) h += renderBadgeWall();
    return h;
  }
  function reviewAct(act, ds, el) {
    var r = S.review;
    if (act === 'shareopen') { r.share = {id:ds.id,funVariant:0,theme:'sage',body:false,badgePick:null,badgeVariant:0,image:null,blob:null}; return true; }
    if (act === 'shareclose') { r.share=null; return true; }
    if (act === 'sharerec') { r.share.id=el.value; r.share.funVariant=0; r.share.badgePick=null; r.share.badgeVariant=0; return true; }
    if (act === 'wallopen') { r.wall = true; return true; }
    if (act === 'wallclose') { r.wall = false; return true; }
    if (act === 'bodytoggle') { r.share.body = !!el.checked; return true; }
    if (act === 'badgepick') {
      // 卡片只展示一枚：点已选中的 = 不展示；点别的 = 换成它
      var cur = Share.build(load(), r.share.id, r.share), now = cur && cur.badges[0] ? cur.badges[0].id : '';
      r.share.badgePick = now === ds.id ? [] : [ds.id]; return true;
    }
    if (act === 'badgeagain') { r.share.badgePick = null; r.share.badgeVariant = (r.share.badgeVariant || 0) + 1; return true; }
    if (act === 'watchgo') { r.returnTo = { id: r.share.id, funVariant: r.share.funVariant, theme: r.share.theme, body: r.share.body, badgePick: r.share.badgePick, badgeVariant: r.share.badgeVariant }; r.share = null; S.tab = 'settings'; render(); setTimeout(function () { var x = document.getElementById('watchSec'); if (x) x.scrollIntoView({ block: 'start' }); }, 30); return false; }
    if (act === 'sharetheme') { r.share.theme=ds.theme; return true; }
    if (act === 'funagain') { r.share.funVariant=(r.share.funVariant||0)+1; return true; }
    if (act === 'sharecopy') { var cd=Share.build(load(),r.share.id,r.share); if(cd) copyText(cd.caption,'配文已复制'); return false; }
    if (act === 'shareexport') { exportShareImage(false); return false; }
    if (act === 'sharesystem') { exportShareImage(true); return false; }
    if (act === 'shareprofile') { r.returnTo = { id: r.share.id, funVariant: r.share.funVariant, theme: r.share.theme, body: r.share.body, badgePick: r.share.badgePick, badgeVariant: r.share.badgeVariant }; r.share=null; S.tab='settings'; render(); return false; }
    if (act === 'sharetrain') { r.share=null; S.tab='train'; render(); return false; }
    if (act === 'rtab') { r.tab = Number(ds.i); return true; }
    if (act === 'rules') { r.rules = !r.rules; return true; }
    if (act === 'toggle') { r.open[ds.id] = !r.open[ds.id]; return true; }
    if (act === 'edit') { startEdit(ds.id); return true; }
    if (act === 'del') { confirmBox('删除这次训练？', '删除后，之后所有训练的重量与阶段会按规则重新推算。', function () { var db = load(); GZ.deleteRecord(db, ds.id); save(db); render(true); toast('已删除'); }); return false; }
    if (act === 'copy') {
      var v = S._review, lines = ['【训练小结】'].concat(v.insights.map(function (i) { return '· ' + i.text; }));
      v.weeks.slice().reverse().forEach(function (w) { lines.push('W' + w.week + '：' + w.sessions + '/' + w.total + ' 次，容量 ' + w.volText + (w.dv ? '（' + w.dv + '）' : '') + '，加重 ' + w.adds + ' 项'); });
      copyText(lines.join('\n'), '已复制');
      return false;
    }
  }
  function copyText(txt, ok) {
    var done = function () { toast(ok); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, fallback); else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败'); } document.body.removeChild(ta);
    }
  }

  // ================= 成果分享（纯本地 Canvas 高清 PNG） =================
  function renderShareSheet() {
    var sh=S.review.share, data=Share.build(load(),sh.id,sh);
    if (data) { sh.id=data.recordId; sh.date=data.date; sh.day=data.day; }
    if(!data) return '<div class="mask" data-act="shareclose"><div class="sheet"><div class="sheet-title">这一天没有可分享的训练</div><button class="btn-primary" data-act="shareclose">返回</button></div></div>';
    var list=Share.sessionList(load());
    var ava = data.profile.avatar
      ? '<img class="ss-ava" src="' + esc(data.profile.avatar) + '" alt="' + esc(data.name) + ' 的头像">'
      : '<span class="ss-ava ss-ava-t" aria-hidden="true">' + esc(Array.from(data.name || '我')[0]) + '</span>';
    var who = [data.profile.handle, data.weight !== null ? '体重 ' + data.weight + ' kg' : ''].filter(Boolean).join(' · ') || (data.profile.signature ? '' : '未设置社媒 ID');
    var picked = {}; data.badges.forEach(function (b) { picked[b.id] = 1; });
    var nCand = data.badgeCands.length, manual = Array.isArray(sh.badgePick);
    var badgeBlock = nCand
      ? '<div class="ss-badges" role="radiogroup" aria-label="卡片上展示的里程碑">' + data.badgeCands.map(function (b) { return '<button class="ss-badge' + (picked[b.id] ? ' on' : '') + '" role="radio" data-act="badgepick" data-id="' + esc(b.id) + '" aria-checked="' + (picked[b.id] ? 'true' : 'false') + '"><span class="ss-badge-e">' + esc(b.e) + '</span><span class="ss-badge-t"><b>' + esc(b.title) + '</b><i>' + esc(b.desc) + '</i></span><span class="ss-badge-ck">' + (picked[b.id] ? '✓' : '') + '</span></button>'; }).join('') + '</div>' +
        '<p class="ss-hint">' + (nCand > 1 ? '这次训练达成了 ' + nCand + ' 枚，卡片只展示 1 枚：' + (manual ? (data.badges.length ? '已按你的选择。' : '你选了不展示。') + '点「🎲 随机」可回到随机。' : '现在是随机挑的，不满意可以点「🎲 换一枚」，或直接点选。') : '这次达成 1 枚，点一下可选择展示或不展示。') + '</p>'
      : '<p class="ss-empty">这次训练没有新的里程碑。已获得 ' + data.badgeEarned + ' / ' + data.badgeAll + ' 枚，看看徽章墙里最接近的目标。</p>';
    var badgeAct = (nCand > 1 ? '<button class="ss-act dice" data-act="badgeagain">' + (manual ? '🎲 随机' : '🎲 换一枚') + '</button>' : '') + '<button class="ss-act" data-act="wallopen">徽章墙 ›</button>';
    var hasWatch = !!(load().params.watch && (load().params.watch.workouts || []).length);
    var watchBlock = data.watchBody
      ? '<div class="ss-watch"><div class="ss-watch-t"><b>卡片显示手表记录</b><span>用时 ' + data.watchBody.min + ' 分' + (data.watchBody.avgHr ? ' · 平均心率 ' + data.watchBody.avgHr : '') + (data.watchBody.kcal ? ' · ' + data.watchBody.kcal + ' 千卡' : '') + '</span></div><label class="ios-sw green"><input type="checkbox" data-act="bodytoggle" ' + (sh.body ? 'checked' : '') + ' aria-label="卡片显示手表记录"><i></i></label></div>'
      : '<div class="ss-watch"><div class="ss-watch-t"><b>手表记录</b><span>' + (hasWatch ? '这次训练在手表里没有对应的力量训练记录' : '导入 COROS 手表快照后，可显示用时、心率、消耗，并解锁能量对照') + '</span></div>' + (hasWatch ? '' : '<button class="ss-act" data-act="watchgo">去导入 ›</button>') + '</div>';
    return '<div class="mask share-mask" data-act="shareclose"><div class="sheet share-sheet" data-stop="1">' +
      '<div class="share-head"><div class="grabber"></div>' +
        '<div class="share-toolbar"><span class="sheet-title">训练战报</span><button class="share-close" data-act="shareclose" aria-label="关闭分享预览">×</button></div>' +
        '<div class="ss-theme" role="group" aria-label="卡片配色">' + [['sage','鼠尾草'],['warm','暖杏色']].map(function(t){return '<button class="'+(sh.theme===t[0]?'on':'')+'" data-act="sharetheme" data-theme="'+t[0]+'" aria-pressed="'+(sh.theme===t[0])+'">'+t[1]+'</button>';}).join('') + '</div>' +
      '</div>' +
      '<div class="ss-body">' +
      // 一、个人名片
      '<div class="ss-sec"><div class="ss-h"><span class="ss-t">01 · 个人名片</span><button class="ss-act" data-act="shareprofile">编辑名片 ›</button></div>' +
        '<div class="ss-row">' + ava + '<div class="ss-who"><span class="ss-name">' + esc(data.name) + '</span><span class="ss-sub">' + esc(who) + '</span></div></div>' +
        (data.profile.signature ? '<p class="ss-sig">' + esc(data.profile.signature) + '</p>' : '') +
        (data.hasName ? '' : '<button class="share-profile-tip" data-act="shareprofile">还没有名片：去「设置 → 分享名片」填写头像和昵称，会显示在卡片顶部 ›</button>') + '</div>' +
      // 二、里程碑
      '<div class="ss-sec"><div class="ss-h"><span class="ss-t">02 · 里程碑</span><span class="ss-acts">' + badgeAct + '</span></div>' + badgeBlock + '</div>' +
      // 三、纵览与趣味
      '<div class="ss-sec"><div class="ss-h"><span class="ss-t">03 · 纵览与趣味</span><span class="ss-acts"><span class="quote-total">' + (data.funIndex + 1) + ' / ' + data.funTotal + '</span><button class="ss-act dice" data-act="funagain">🎲 换一个</button></span></div>' +
        '<div class="ss-metrics"><span><b class="num">' + esc(String(data.rows.length)) + '</b>项动作</span><span><b class="num">' + esc(String(data.reps)) + '</b>次动作</span><span><b class="num">' + esc(String(data.adds)) + '</b>项加重</span></div>' +
        '<div class="ss-fun"><span class="ss-fun-tag">' + esc(data.funTag) + '</span>' + esc((data.funEmoji ? data.funEmoji + ' ' : '') + data.fun) + (data.funBasis ? '<span class="ss-fun-note">算法：' + esc(data.funBasis) + '</span>' : '') + '</div>' +
        watchBlock + '</div>' +
      // 四、训练内容
      '<div class="ss-sec"><div class="ss-h"><span class="ss-t">04 · 训练内容</span><button class="ss-act" data-act="sharetrain">查看训练 ›</button></div>' +
        '<label class="ss-pick"><span class="ss-pick-l">哪次训练</span><select data-act="sharerec" aria-label="选择训练记录">' + list.map(function(x){return '<option value="'+x.id+'" '+(x.id===data.recordId?'selected':'')+'>'+esc(x.label)+'</option>';}).join('')+'</select></label>' +
        '<div class="ss-cells">' + data.rows.map(function(r){return '<span class="ss-cell"><i class="ss-tier">' + esc(r.tier) + '</i>' + esc(r.name) + '<b class="num">' + esc(r.load) + '</b></span>';}).join('') + '</div>' +
        '<p class="ss-load">累计 ' + esc(data.volumeText) + ' t · ' + esc(data.volume.toLocaleString('zh-CN')) + ' kg</p></div>' +
      // 五、小结
      '<div class="ss-sec"><div class="ss-h"><span class="ss-t">05 · 训练小结</span></div>' +
        '<div class="ss-sum">' + esc(data.copy) + '</div></div>' +
      '<div class="share-art-wrap"><div id="shareArtwork" class="share-art" aria-label="训练成果图片预览"><span class="share-loading">正在整理你的训练成果…</span></div></div>' +
      '<div class="share-hint">预览即最终图片，可长按保存；趣味换算可以一直换下去。</div>' +
      '</div>' +
      '<div class="share-foot"><div class="share-actions"><button data-act="sharecopy">复制配文</button><button data-act="shareexport" disabled>保存图片</button><button class="main" data-act="sharesystem" disabled>系统分享</button></div></div>' +
      '</div></div>';
  }

  // ================= 里程碑徽章墙 =================
  function fmtProg(p) {
    var v = p.v, t = p.t;
    return (Number.isInteger(v) ? v : v.toFixed(v < 10 ? 2 : 1).replace(/\.?0+$/, '')) + ' / ' + t.toLocaleString('zh-CN') + ' ' + p.u;
  }
  function renderBadgeWall() {
    var st = Share.badgeState(load());
    var WALL_ORDER = ['count', 'progress', 'strength', 'volume', 'session', 'streak', 'cycle', 'watch'];
    var near = st.nextGoals.slice(0, 3).map(function (g) {
      var d = st.byId[g.id], p = st.prog[g.id];
      return '<div class="wall-n"><span class="wall-e" aria-hidden="true">' + esc(d.e) + '</span><div class="wall-nt"><b>' + esc(d.title) + '</b><i>' + esc(fmtProg(p)) + '</i><span class="wall-bar"><span style="width:' + Math.max(4, Math.round(p.pct * 100)) + '%"></span></span></div><span class="wall-pct num">' + Math.round(p.pct * 100) + '%</span></div>';
    }).join('');
    var nearBlock = near ? '<div class="wall-g"><div class="wall-gt">最接近的目标</div><div class="wall-near">' + near + '</div></div>' : '';
    var body = Badges.GROUPS.slice().sort(function (a, b) { return WALL_ORDER.indexOf(a.id) - WALL_ORDER.indexOf(b.id); }).map(function (g) {
      var items = st.defs.filter(function (d) { return d.group === g.id; });
      if (!items.length) return '';
      var got = items.filter(function (d) { return st.earned[d.id]; }).length;
      return '<div class="wall-g"><div class="wall-gt">' + esc(g.name) + '<span class="wall-gc num">' + got + ' / ' + items.length + '</span></div><div class="wall-grid">' + items.map(function (d) {
        var e = st.earned[d.id], on = !!e, p = st.prog[d.id];
        var sub = on ? e.date.slice(5).replace('-', '月') + '日' + (e.count > 1 ? ' · ×' + e.count : '') : (p ? fmtProg(p) : '未获得');
        var bar = !on && p && p.pct > 0 ? '<span class="wall-bar"><span style="width:' + Math.max(4, Math.round(p.pct * 100)) + '%"></span></span>' : '';
        return '<div class="wall-b' + (on ? ' on' : '') + '"><span class="wall-e" aria-hidden="true">' + esc(d.e) + '</span><b>' + esc(d.title) + '</b><i>' + esc(sub) + '</i>' + bar + '<span class="wall-d">' + esc(d.desc) + '</span></div>';
      }).join('') + '</div></div>';
    }).join('');
    var hasW = !!(load().params.watch && (load().params.watch.workouts || []).length);
    return '<div class="mask share-mask" data-act="wallclose"><div class="sheet share-sheet" data-stop="1">' +
      '<div class="share-head"><div class="grabber"></div><div class="share-toolbar"><span class="sheet-title">里程碑</span><button class="share-close" data-act="wallclose" aria-label="关闭徽章墙">×</button></div>' +
      '<p class="wall-sum">已获得 <b class="num">' + st.earnedCount + '</b> / ' + st.total + ' 枚 · 彩色是已获得，灰色带进度条</p></div>' +
      '<div class="ss-body">' + nearBlock + body + (hasW ? '' : '<p class="ss-hint">手表系列需要先在「设置 → 手表数据」导入快照。</p>') + '<p class="ss-hint">手表系列只统计 ' + esc(st.watchFrom ? st.watchFrom.replace(/-/g, '.') : '训练手记第一条记录') + ' 之后的数据。主项重量按 T1 工作重量统计，需完成目标（加重或保持）才算。</p></div></div></div>';
  }
  async function paintSharePreview() {
    var sh=S.review.share, box=document.getElementById('shareArtwork'); if(!sh||!box) return;
    sh.image=null; sh.blob=null;
    var generation=(sh.generation || 0)+1; sh.generation=generation;
    try {
      var data=Share.build(load(),sh.id,sh); if(!data) return;
      if(document.fonts && document.fonts.ready) await document.fonts.ready;
      var canvas=document.createElement('canvas'); await Share.draw(canvas,data,sh.theme);
      var blob=await new Promise(function(resolve){canvas.toBlob(resolve,'image/png');});
      if(S.review.share!==sh || sh.generation!==generation || !box.isConnected) return;
      if(!blob) throw new Error('导出失败');
      sh.blob=blob;sh.image=canvas.toDataURL('image/png');
      box.innerHTML='';var img=new Image();img.src=sh.image;img.alt=data.name+' · '+data.date+' 训练战报';box.appendChild(img);
      document.querySelectorAll('[data-act="shareexport"],[data-act="sharesystem"]').forEach(function(b){b.disabled=false;});
    } catch(e) { if(box.isConnected) box.textContent='图片生成失败，请关闭后重试。'; }
  }
  function exportShareImage(system) {
    var sh=S.review.share; if(!sh||!sh.blob) { toast('图片正在生成，请稍候');return; }
    var filename='训练战报_'+sh.date+'_'+(sh.day||'')+'.png', file=new File([sh.blob],filename,{type:'image/png'});
    if(system && navigator.canShare && navigator.canShare({files:[file]}) && navigator.share) {
      navigator.share({files:[file],title:'训练战报 · '+sh.date+' '+(sh.day||'')}).catch(function(e){if(e.name!=='AbortError') toast('系统分享暂不可用，可保存图片后分享');});return;
    }
    var a=document.createElement('a'),url=URL.createObjectURL(sh.blob);a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},30000);
    toast(system?'已下载图片，可自行分享到社媒':'已下载 PNG；iPhone 也可长按预览图保存');
  }
  function uploadShareAvatar(file) {
    if(!file)return;
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>10*1024*1024){toast('请选择不超过 10 MB 的 JPG、PNG 或 WebP');return;}
    var reader=new FileReader();reader.onload=function(){var img=new Image();img.onload=function(){
      var c=document.createElement('canvas');c.width=c.height=160;var x=c.getContext('2d'),sz=Math.min(img.width,img.height);x.drawImage(img,(img.width-sz)/2,(img.height-sz)/2,sz,sz,0,0,160,160);
      var db=load(),pp=Share.profile(db.params.shareProfile);pp.avatar=c.toDataURL('image/jpeg',0.8);db.params.shareProfile=pp;save(db);render(true);toast('头像已裁切并保存');
    };img.onerror=function(){toast('图片无法读取');};img.src=reader.result;};reader.readAsDataURL(file);
  }

  // ================= 设置 =================
  function lastBackup() { return Number(localStorage.getItem(BK) || 0); }
  function renderLibrary() {
    var db = load(), st = S.settings, lib = GZ.buildLibrary(db, { tier: st.tier, q: st.q }), h = '';
    h += '<div class="lib-back" data-act="libback">‹ 设置</div><div class="pg-title">动作库</div>';
    h += '<div class="search"><span class="search-ic">⌕</span><input class="search-in" data-act="libq" value="' + esc(st.q) + '" placeholder="搜索动作、部位或器械"></div>';
    h += '<div id="libSeg"' + (st.q ? ' style="display:none"' : '') + '>' + seg(lib.tiers.map(function (x) { return { html: x.id + '<span class="seg-n">' + x.n + '</span>', on: st.tier === x.id, data: ' data-t="' + x.id + '"' }; }), -1, 'libtier') +
      '<div class="sec-f tier-tip">' + TIER_TIP[st.tier] + '</div></div>';
    h += '<div id="libList"><div class="list">' + libRows(lib, { showTier: !!st.q }) + '</div></div>';
    h += '<button class="btn-primary add-btn" data-act="libadd">添加自定义动作</button><div class="sec-f" style="text-align:center">在训练页点动作卡片上的「更换」，即可从动作库选择替换</div>';
    if (st.add) {
      var a = st.add;
      h += '<div class="mask" data-act="addclose"><div class="sheet" data-stop="1"><div class="grabber"></div><div class="sheet-title">添加动作</div><div class="list">' +
        '<div class="cell"><span class="f-l">名称</span><input class="f-v" data-act="addname" maxlength="16" value="' + esc(a.name) + '" placeholder="例如：史密斯卧推"></div>' +
        '<label class="cell tap pick-cell"><span class="f-l">部位</span><span class="f-v val">' + esc(a.part) + '</span><span class="chev">›</span><select data-act="addpart">' + GZ.PARTS.map(function (x) { return '<option ' + (x === a.part ? 'selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label>' +
        '<label class="cell tap pick-cell"><span class="f-l">器械</span><span class="f-v val">' + esc(a.equip) + '</span><span class="chev">›</span><select data-act="addequip">' + GZ.EQUIPS.map(function (x) { return '<option ' + (x === a.equip ? 'selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label>' +
        '<div class="cell"><span class="f-l">说明</span><input class="f-v" data-act="adddesc" maxlength="30" value="' + esc(a.desc) + '" placeholder="可选"></div></div>' +
        '<div class="sec-h">层级</div>' + seg(['T2', 'T3'].map(function (x) { return { html: x, on: a.tier === x, data: ' data-t="' + x + '"' }; }), -1, 'addtier') +
        '<div class="sec-f">' + TIER_TIP[a.tier] + '</div>' +
        '<div class="sheet-btns"><div class="btn-ghost" data-act="addclose">取消</div><div class="btn-ghost solid" data-act="adddo">添加</div></div></div></div>';
    }
    return h;
  }
  function renderSettings() {
    if (S.settings.view === 'lib') return renderLibrary();
    var db = load(), P = db.params, st = S.settings, h = '', tmPct = Math.round(P.tmRatio * 100), rp = GZ.replay(db), names = libNames(db);
    var inp = function (k, v, unit, extra) { return '<input class="f-in num" inputmode="decimal" data-act="param" data-k="' + k + '" ' + (extra || '') + ' value="' + v + '"><span class="f-u">' + unit + '</span>'; };
    h += '\u0000base\u0000';
    var pp = Share.profile(P.shareProfile);
    h += '<div class="sec-h" id="shareProfileSec">分享名片</div><div class="list profile-list">' +
      '<div class="cell"><span class="flex1">头像</span><label class="profile-avatar">' + (pp.avatar ? '<img src="' + pp.avatar + '" alt="头像">' : '<span>' + esc(pp.name.slice(0,1) || '我') + '</span>') + '<input type="file" accept="image/png,image/jpeg,image/webp" data-act="profileavatar"></label><span class="btn-small" data-act="profilenoavatar">移除</span></div>' +
      '<div class="cell"><label for="profileName" class="flex1">昵称</label><input id="profileName" class="profile-in" data-act="profiletext" data-k="name" maxlength="18" value="' + esc(pp.name) + '" placeholder="分享时显示的名字"></div>' +
      '<div class="cell"><label for="profileHandle" class="flex1">社媒 ID</label><input id="profileHandle" class="profile-in" data-act="profiletext" data-k="handle" maxlength="24" value="' + esc(pp.handle) + '" placeholder="可选，如 @seven"></div>' +
      '<div class="cell"><label for="profileSignature" class="flex1">个性签名</label><input id="profileSignature" class="profile-in" data-act="profiletext" data-k="signature" maxlength="48" value="' + esc(pp.signature) + '" placeholder="可选，写给坚持训练的自己"></div>' +
      '<div class="cell"><span class="flex1">卡片公开当天体重</span><label class="ios-sw green"><input type="checkbox" data-act="profileweight" ' + (pp.showWeight ? 'checked' : '') + '><i></i></label></div></div>' +
      '<div class="sec-f">昵称、ID、头像、签名会出现在图片上。体重默认隐藏；不显示训练备注、云仓库或令牌。名片随私人云同步保存。输入后离开字段自动保存。</div>';
    var wd = P.watch, wn = wd && wd.workouts ? wd.workouts.length : 0, wsn = wd && wd.sleep ? Object.keys(wd.sleep).length : 0;
    h += '<div class="sec-h" id="watchSec">手表数据</div><div class="list">' +
      '<div class="cell"><span class="flex1">' + esc((wd && wd.source) || 'COROS') + '</span><span class="val">' + (wn || wsn ? esc(wn + ' 次训练 · ' + wsn + ' 晚睡眠') : '未导入') + '</span></div>' +
      (Sync.on() ? (function () {
        var wc = Sync.cfg(), gen = wc.watchGen ? Date.parse(wc.watchGen) : 0;
        var val = wc.watchErr ? '<span class="red">' + esc(wc.watchErr) + '</span>' : gen ? '<span class="green">✓ 云端更新于 ' + ago(gen) + '</span>' : wc.watchAt ? '云端暂无手表文件' : '等待首次拉取';
        return '<div class="cell"><span class="flex1">自动同步</span><span class="val">' + val + '</span></div>' +
          '<div class="cell tap" data-act="watchpull"><span class="flex1 accent">立即拉取</span><span class="chev">›</span></div>';
      })() : '<div class="cell"><span class="flex1">自动同步</span><span class="val">需先开启云同步</span></div>') +
      (wd && wd.importedAt ? '<div class="cell"><span class="flex1">本机最近写入</span><span class="val">' + ago(wd.importedAt) + '</span></div>' : '') +
      '<label class="cell tap"><span class="flex1 accent">手动导入快照文件（备用）</span><span class="chev">›</span><input type="file" accept=".json,application/json" data-act="watchfile" style="display:none"></label>' +
      '<div class="cell tap" data-act="watchpaste"><span class="flex1 accent">粘贴快照文本</span><span class="chev">' + (st.wpaste ? '⌃' : '›') + '</span></div>' +
      (st.wpaste ? '<div class="cell"><div class="flex1"><textarea class="imp" id="watchText" placeholder="粘贴手表快照 JSON"></textarea><span class="btn-small rust" style="margin-top:8px" data-act="watchdo">导入</span></div></div>' : '') +
      (wn || wsn ? '<div class="cell tap" data-act="watchclear"><span class="flex1 red">清除手表数据</span></div>' : '') + '</div>' +
      '<div class="sec-f">手表数据只在本机和你自己的私有云仓库里，用于里程碑和分享卡片；睡眠、心率默认不会出现在图片上。开启云同步后，手表数据由定时任务写入你的私有仓库并自动拉取到这里；手动导入只在自动同步不可用时备用，重复导入不会重复计数。</div>';
    h += '<div class="sec-h">基础 1RM</div><div class="list">' +
      GZ.LIFT_ORDER.map(function (k) { return '<div class="cell"><span class="flex1">' + GZ.LIFTS[k] + '</span><span class="tm">TM ' + GZ.fmtW(GZ.tm(P, k)) + '</span>' + inp('oneRM.' + k, P.oneRM[k], 'kg') + '</div>'; }).join('') +
      '<div class="cell"><span class="flex1">TM 比例</span>' + inp('tmRatio', tmPct, '%', 'data-pct="1"') + '</div>' +
      '<div class="cell"><span class="flex1">当前体重</span>' + inp('bodyWeight', P.bodyWeight || 70, 'kg') + '</div></div>' +
      '<div class="sec-f">T1 以四大项 1RM 推算；哑铃按单只、负重按外加重量、自重只记次数。训练时填写体重会自动同步这里。</div>';
    h += '\u0000adv\u0000';
    h += '<div class="sec-h">加重步幅</div><div class="list">' +
      GZ.STEP_KEYS.map(function (s) { return '<div class="cell"><span class="flex1">' + s.label + '</span>' + inp('steps.' + s.key, P.steps[s.key], 'kg') + '</div>'; }).join('') +
      '<div class="cell"><span class="flex1">T3 加重阈值</span>' + inp('t3Threshold', P.t3Threshold, '次') + '</div>' +
      '<div class="cell"><span class="flex1">取整档位</span>' + inp('rounding', P.rounding, 'kg') + '</div>' +
      '<div class="cell"><span class="flex1">杠铃杆重</span>' + inp('barWeight', P.barWeight, 'kg') + '</div></div>';
    h += '<div class="sec-h">判定规则</div>' + seg([{ html: '完整三阶', on: P.ruleMode === 'full', data: ' data-v="full"' }, { html: '严格按表格', on: P.ruleMode === 'excel', data: ' data-v="excel"' }], -1, 'mode', 'mode-seg') +
      (P.ruleMode === 'full' ? '<div class="list"><div class="cell"><span class="flex1">按末组次数自适应加重</span><label class="ios-sw green"><input type="checkbox" data-act="adaptsw" ' + (P.adaptive !== false ? 'checked' : '') + '><i></i></label></div></div>' : '') +
      '<div class="sec-f">' + (P.ruleMode === 'full' ? 'T1 按 5×3+ → 6×2+ → 10×1+ 三阶进阶，连续 2 次未达标才降阶，10×1+ 失败测 5RM 重置。' + (P.adaptive !== false ? '末组次数远超加重线时（如卧推 17 次而加重线是 6 次），按 Epley 公式估算偏轻的程度，取一半、最多 3 档，只会多加不会少加；T3 超过阈值 10 次以上加 2 档。' : '') : '与 Excel 公式逐格一致：T1 只在 5×3+ 与 6×2+ 之间切换，固定步幅，不启用自适应加重。') + '</div>';
    h += '\u0000cycle\u0000';
    h += '<div class="sec-h">周期</div><div class="list"><div class="cell"><span class="flex1">每轮周数</span>' + inp('totalWeeks', P.totalWeeks, '周 / 轮') + '</div>' +
      '<div class="cell"><span class="flex1">减载周</span><label class="ios-sw green"><input type="checkbox" data-act="dlen" ' + (P.deloadEnabled ? 'checked' : '') + '><i></i></label></div>' +
      (P.deloadEnabled ? '<div class="cell"><span class="flex1">每轮第</span>' + inp('deloadEvery', P.deloadEvery, '周减载') + '</div>' : '') +
      '<div class="cell"><span class="flex1">每轮自动轮换 T2/T3</span><label class="ios-sw green"><input type="checkbox" data-act="rotsw" ' + (P.autoRotate !== false ? 'checked' : '') + '><i></i></label></div></div>' +
      '<div class="sec-f">' + (P.autoRotate !== false ? '每进入新一轮，T2/T3 会在同一动作模式内自动换成上一轮没练过的动作，T1 四大项不变。' : '') + '完成一轮（' + P.totalWeeks + ' 周 × 4 日）后自动进入下一轮，可无限循环；减载按每轮内周序计算' + (P.deloadEnabled ? '（每轮第 ' + P.deloadEvery + ' 周 T1 −50%、T2 −40%、T3 少 1 组，不影响进阶）' : '') + '。</div>';
    h += '\u0000act\u0000';
    h += '<div class="sec-h">动作</div><div class="list"><div class="cell tap" data-act="openlib"><span class="flex1">动作库</span><span class="val">' + GZ.libAll(db).length + ' 个' +
      (db.customLib.length ? ' · 自定义 ' + db.customLib.length : '') + '</span><span class="chev">›</span></div>' +
      '<div class="cell tap" data-act="goplan"><span class="flex1">调整动作与重量</span><span class="val">在计划页</span><span class="chev">›</span></div></div>' +
      '<div class="sec-f">每个训练日练什么、每个动作多重，都在「计划 → 动作编排」里调整，点任意一行即可改重量或换动作，与该训练日的下一次训练一致。</div>';
    h += '\u0000sync\u0000';
    var sc = Sync.cfg();
    h += '<div class="sec-h" id="syncSec">云同步</div>';
    if (Sync.on()) {
      var stTxt = sc.state === 'syncing' ? '同步中…' : sc.state === 'err' ? '<span class="red">同步失败</span>' : '<span class="green">✓ 已同步</span> · ' + ago(sc.lastAt);
      h += '<div class="list"><div class="cell"><span class="flex1">状态</span><span class="val">' + stTxt + '</span></div>' +
        (sc.state === 'err' ? '<div class="cell"><span class="flex1 sync-err">' + esc(sc.lastErr) + (sc.lastAt ? '（上次成功 ' + ago(sc.lastAt) + '）' : '') + '</span></div>' : '') +
        '<div class="cell"><span class="flex1">私有仓库</span><span class="val">' + esc(sc.owner + '/' + sc.repo) + '</span></div>' +
        '<div class="cell tap" data-act="syncnow"><span class="flex1 accent">立即同步</span><span class="chev">›</span></div>' +
        '<div class="cell tap" data-act="synctoken"><span class="flex1 accent">更换令牌</span><span class="chev">' + (st.tok ? '⌃' : '›') + '</span></div>' +
        (st.tok ? '<div class="cell"><input class="f-v sync-in" id="syncToken2" type="password" autocomplete="off" placeholder="粘贴新的令牌 github_pat_…"><span class="btn-small" data-act="synctokdo">保存</span></div>' : '') +
        '<div class="cell tap" data-act="syncoff"><span class="flex1 red">断开云同步</span></div></div>' +
        '<div class="sec-f">打开网页、完成训练、修改设置后会自动同步；在多台设备上用，训练记录会自动合并。断开后本机数据保留。</div>';
    } else {
      h += '<div class="list">' +
        '<div class="cell"><span class="f-l sync-l">GitHub 用户名</span><input class="f-v sync-in" id="syncOwner" autocomplete="off" autocapitalize="off" value="' + esc((sc && sc.owner) || 'seven-pro-7') + '"></div>' +
        '<div class="cell"><span class="f-l sync-l">私有仓库</span><input class="f-v sync-in" id="syncRepo" autocomplete="off" autocapitalize="off" value="' + esc((sc && sc.repo) || 'seven-training-data') + '"></div>' +
        '<div class="cell"><span class="f-l sync-l">令牌</span><input class="f-v sync-in" id="syncToken" type="password" autocomplete="off" placeholder="github_pat_…"></div></div>' +
        '<button class="btn-primary add-btn" data-act="syncconnect">' + (st.connecting ? '连接中…' : '连接并同步') + '</button>' +
        '<div class="sec-f">数据存在你自己的 GitHub 私有仓库里。令牌只保存在这台设备上，只需要「这一个仓库的 Contents 读写」权限，不会进入备份文件。</div>';
    }
    h += '\u0000data\u0000';
    var bk = lastBackup(), stale = !bk || Date.now() - bk > 7 * 86400000;
    h += '<div class="sec-h">数据</div><div class="list">' +
      '<div class="cell tap" data-act="export"><span class="flex1 accent">导出备份文件</span><span class="val ' + (stale ? 'amber' : '') + '">' + GZ.backupLabel(bk) + '</span></div>' +
      '<div class="cell tap" data-act="copyjson"><span class="flex1 accent">复制备份文本</span><span class="chev">›</span></div>' +
      '<label class="cell tap"><span class="flex1 accent">从文件恢复</span><span class="chev">›</span><input type="file" accept=".json,application/json" data-act="impfile" style="display:none"></label>' +
      '<div class="cell tap" data-act="imp"><span class="flex1 accent">粘贴文本恢复</span><span class="chev">' + (st.imp ? '⌃' : '›') + '</span></div>' +
      (st.imp ? '<div class="cell"><div class="flex1"><textarea class="imp" id="impText" placeholder="粘贴导出的 JSON"></textarea><span class="btn-small rust" style="margin-top:8px" data-act="doImp">确认恢复（覆盖当前数据）</span></div></div>' : '') +
      '</div><div class="sec-f">共 ' + db.records.length + ' 条训练记录。' + (Sync.on() ? '已开启云同步；仍建议每周导出一次存到 iCloud「文件」，作为第二重备份。' : '数据只存在这台设备的浏览器里，建议开启云同步，或每周导出一次存到 iCloud「文件」。') + '</div>';
    h += '\u0000danger\u0000';
    h += '<div class="list" style="margin-top:20px"><div class="cell tap" data-act="clear"><span class="flex1 red">清空训练记录</span></div><div class="cell tap" data-act="restore"><span class="flex1 red">恢复 Excel 默认</span></div></div>' +
      '<div class="sec-f">修改参数后，所有历史判定与重量会按新参数重新推算</div>';
    // 重新排列：常用在上，高级参数折叠
    var parts = {}, cur0 = 'base';
    h.split('\u0000').forEach(function (x, i) { if (i % 2 === 1) cur0 = x; else parts[cur0] = (parts[cur0] || '') + x; });
    var advHead = '<div class="list adv-head"><div class="cell tap" data-act="advtoggle"><span class="flex1">高级设置</span><span class="val">加重步幅 · 取整 · 判定规则</span><span class="chev">' + (st.adv ? '⌃' : '›') + '</span></div></div>';
    return (parts.base || '') + (parts.sync || '') + (parts.cycle || '') + (parts.act || '') + (parts.data || '') + advHead + (st.adv ? '<div class="adv-body">' + (parts.adv || '') + '</div>' : '') + (parts.danger || '');
  }
  function setPath(o, p, v) { var ks = p.split('.'); for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; }
  function mutate(fn, tip) { var db = load(); fn(db); save(db); if (tip !== false) toast(tip || '已更新，数据已重算'); return true; }
  function markBackup() { localStorage.setItem(BK, String(Date.now())); }
  function exportFile() {
    var txt = JSON.stringify(load()), name = '训练备份_' + GZ.today() + '.json';
    var blob = new Blob([txt], { type: 'application/json' });
    try {
      var file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: name }).then(function () { markBackup(); render(true); toast('已导出'); }, function () {});
        return;
      }
    } catch (e) {}
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    markBackup(); render(true); toast('已下载备份文件');
  }
  function importText(txt) {
    try { var inc = JSON.parse(txt); if (!inc || !inc.params || !inc.days) throw 0; save(GZ.replaceDb(load(), inc)); S.settings.imp = false; S.train.draft = null; S.train.day = null; toast('恢复成功'); render(true); }
    catch (e) { toast('文件内容不正确'); }
  }
  function importWatch(txt) {
    try {
      var clean = Badges.sanitizeWatch(txt), db = load();
      db.params.watch = Badges.mergeWatch(db.params.watch, clean); save(db);
      S.settings.wpaste = false; toast('已导入 ' + clean.workouts.length + ' 次训练、' + Object.keys(clean.sleep).length + ' 晚睡眠'); render(true);
    } catch (e) { toast(e && e.message ? e.message : '快照内容不正确'); }
  }
  function syncAddInputs() {
    var a = S.settings.add; if (!a) return;
    var n = document.querySelector('[data-act=addname]'), d = document.querySelector('[data-act=adddesc]');
    if (n) a.name = n.value; if (d) a.desc = d.value;
  }
  function settingsAct(act, ds, el) {
    var st = S.settings, si = Number(ds.si);
    var slotMut = function (fn) { return mutate(function (db) { fn(db.days[st.d].slots[si], db); }); };
    switch (act) {
      case 'profiletext':
        return mutate(function(db) { var pp = Share.profile(db.params.shareProfile); pp[ds.k] = el.value; db.params.shareProfile = Share.profile(pp); }, '分享名片已保存');
      case 'profileweight': return mutate(function(db) { var pp=Share.profile(db.params.shareProfile); pp.showWeight=el.checked; db.params.shareProfile=pp; }, el.checked ? '卡片会显示已记录的当天体重' : '卡片不再公开体重');
      case 'profilenoavatar': return mutate(function(db) { var pp=Share.profile(db.params.shareProfile); pp.avatar=''; db.params.shareProfile=pp; }, '头像已移除');
      case 'profileavatar':
        uploadShareAvatar(el.files && el.files[0]); return false;
      case 'param': var v = parseFloat(el.value); if (isNaN(v) || v < 0) return true; if (ds.pct) v = v / 100; return mutate(function (db) { setPath(db.params, ds.k, v); });
      case 'mode': return mutate(function (db) { db.params.ruleMode = ds.v; }, ds.v === 'full' ? '已切换：完整三阶规则' : '已切换：严格按表格公式');
      case 'adaptsw': return mutate(function (db) { db.params.adaptive = el.checked; }, el.checked ? '已开启：按末组次数自适应加重' : '已关闭：固定步幅加重');
      case 'dlen': return mutate(function (db) { db.params.deloadEnabled = el.checked; });
      case 'rotsw': return mutate(function (db) { db.params.autoRotate = el.checked; }, el.checked ? '已开启：每轮自动轮换 T2/T3' : '已关闭自动轮换');
      case 'openlib': st.view = 'lib'; st.q = ''; render(); return false;
      case 'libback': st.view = ''; st.add = null; render(); return false;
      case 'libtier': st.tier = ds.t; return true;
      case 'libq':
        st.q = el.value;
        var ll = document.getElementById('libList'); if (ll) ll.innerHTML = '<div class="list">' + libRows(GZ.buildLibrary(load(), { tier: st.tier, q: st.q }), { showTier: !!st.q }) + '</div>';
        var lsg = document.getElementById('libSeg'); if (lsg) lsg.style.display = st.q ? 'none' : '';
        return false;
      case 'libdel':
        confirmBox('删除「' + ds.name + '」？', '已经练过的记录会保留；正在使用它的训练位置仍按原名显示。', function () { var dbd = load(); GZ.removeCustomEx(dbd, ds.name); save(dbd); render(true); });
        return false;
      case 'libadd': st.add = { name: '', desc: '', tier: (st.q || st.tier === 'T1') ? 'T3' : st.tier, part: '其他', equip: '杠铃' }; return true;
      case 'addclose': st.add = null; return true;
      case 'addname': st.add.name = el.value; return false;
      case 'adddesc': st.add.desc = el.value; return false;
      case 'addpart': st.add.part = el.value; return true;
      case 'addequip': st.add.equip = el.value; return true;
      case 'addtier': syncAddInputs(); st.add.tier = ds.t; return true;
      case 'adddo':
        syncAddInputs();
        var dba = load(), err = GZ.addCustomEx(dba, st.add);
        if (err) { toast(err); return false; }
        save(dba); st.tier = st.add.tier; st.q = ''; st.add = null; render(); toast('已添加'); return false;
      case 'advtoggle': st.adv = !st.adv; return true;
      case 'goplan': S.tab = 'plan'; render(); return false;
      case 'export': exportFile(); return false;
      case 'syncconnect':
        if (st.connecting) return false;
        var ow = (document.getElementById('syncOwner').value || '').trim(), rp2 = (document.getElementById('syncRepo').value || '').trim(), tk = (document.getElementById('syncToken').value || '').trim();
        if (!ow || !rp2) { toast('请填写用户名和仓库名'); return false; }
        if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(tk)) { toast('令牌格式不对：应以 github_pat_ 开头，请整串复制一次'); return false; }
        st.connecting = true; render(true);
        Sync.connect(ow, rp2, tk).then(function (err) { st.connecting = false; if (err) { Sync.disconnect(); toast(err); } else toast('云同步已开启'); render(true); });
        return false;
      case 'syncnow': Sync.run(true); return false;
      case 'synctoken': st.tok = !st.tok; return true;
      case 'synctokdo':
        var nt = (document.getElementById('syncToken2').value || '').trim();
        if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(nt)) { toast('令牌格式不对'); return false; }
        var cc = Sync.cfg(); Sync.connect(cc.owner, cc.repo, nt).then(function (err) { if (err) { var c0 = cc; localStorage.setItem(SYNC_KEY, JSON.stringify(c0)); toast(err); } else { st.tok = false; toast('令牌已更换'); } render(true); });
        return false;
      case 'syncoff': confirmBox('断开云同步？', '本机数据保留，云端仓库里的数据也不会删除。之后可以随时重新连接。', function () { Sync.disconnect(); render(true); toast('已断开'); }); return false;
      case 'copyjson': copyText(JSON.stringify(load()), '已复制，粘贴到文件传输助手保存'); markBackup(); setTimeout(function () { render(true); }, 50); return false;
      case 'impfile':
        var f = el.files && el.files[0]; if (!f) return false;
        var rd = new FileReader(); rd.onload = function () { confirmBox('从文件恢复？', '当前设备上的数据会被备份文件覆盖。', function () { importText(rd.result); }); }; rd.readAsText(f); el.value = ''; return false;
      case 'watchfile':
        var wf = el.files && el.files[0]; if (!wf) return false;
        var wr = new FileReader(); wr.onload = function () { importWatch(wr.result); }; wr.readAsText(wf); el.value = ''; return false;
      case 'watchpull': Sync.pullWatch(true); return false;
      case 'watchpaste': st.wpaste = !st.wpaste; return true;
      case 'watchdo': importWatch(document.getElementById('watchText').value); return false;
      case 'watchclear': confirmBox('清除手表数据？', '只清除导入的手表快照；训练记录不受影响。手表系列的里程碑会重新变为未获得。', function () { mutate(function (db) { db.params.watch = null; var c = Sync.cfg(); if (c) { c.watchAt = 0; c.watchErr = ''; localStorage.setItem(SYNC_KEY, JSON.stringify(c)); } }, '已清除手表数据'); st.wpaste = false; render(true); }); return false;
      case 'imp': st.imp = !st.imp; return true;
      case 'doImp': importText(document.getElementById('impText').value); return false;
      case 'clear': confirmBox('清空全部训练记录？', '参数与动作配置保留，记录无法恢复。', function () { mutate(function (db) { GZ.clearRecords(db); }, '已清空'); S.train.draft = null; S.train.day = null; render(true); }); return false;
      case 'restore': confirmBox('恢复 Excel 默认？', '参数、动作配置与记录将恢复为表格初始状态（含第 1 周 A1/B1 记录）。', function () { save(GZ.replaceDb(load(), GZ.defaults(true))); S.train = { day: null, draft: null, recordId: null, date: GZ.today(), bw: '', note: '', result: null }; render(true); toast('已恢复'); }); return false;
    }
  }

  // ================= 框架 =================
  var RENDER = { train: renderTrain, plan: renderPlan, stats: renderStats, review: renderReview, settings: renderSettings };
  var ACT = { train: trainAct, plan: planAct, stats: statsAct, review: reviewAct, settings: settingsAct };
  function render(keepScroll) {
    var body = document.getElementById('body'), y = body.scrollTop;
    document.getElementById('navTitle').textContent = S.tab === 'settings' && S.settings.view === 'lib' ? '动作库' : TABS.filter(function (t) { return t.id === S.tab; })[0].title;
    var isLib = S.tab === 'settings' && S.settings.view === 'lib';
    var bigTitle = S.tab === 'train' || isLib ? '' : '<div class="pg-title">' + TABS.filter(function (t) { return t.id === S.tab; })[0].title + '</div>';
    body.innerHTML = '<div class="pg-' + S.tab + '"><div class="page">' + bigTitle + RENDER[S.tab]() + '</div></div>';
    body.scrollTop = keepScroll ? y : 0;
    navState();
    document.querySelectorAll('.tb-item').forEach(function (el) { el.classList.toggle('on', el.dataset.tab === S.tab); });
    if (S.tab === 'stats') requestAnimationFrame(drawStats);
    if (S.tab === 'review' && S.review.share) paintSharePreview();
  }
  /** 导航栏：一滚动就出现滚动边缘效果；滚过大标题后才显示小标题（iOS 大标题导航的行为） */
  function navState() {
    var body = document.getElementById('body'), nav = document.querySelector('.nav'); if (!body || !nav) return;
    nav.classList.toggle('edge', body.scrollTop > 4);
    nav.classList.toggle('titled', body.scrollTop > 46);
  }
  function handle(e, type) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var tag = el.tagName, isField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if (type === 'click' && isField) return;
    if (type === 'change' && !isField) return;
    if (type === 'input' && ['note', 'bw', 'swapq', 'libq', 'slotq'].indexOf(el.dataset.act) < 0) return;
    if (type === 'change' && (el.dataset.act === 'swapq' || el.dataset.act === 'libq')) return;
    if (el.classList.contains('mask') && e.target.closest('[data-stop]')) return;
    var prevTab = S.tab;
    var res = ACT[S.tab](el.dataset.act, el.dataset, el);
    if (res) render(prevTab === S.tab);
  }
  document.addEventListener('DOMContentLoaded', function () {
    var body = document.getElementById('body');
    body.addEventListener('click', function (e) { handle(e, 'click'); });
    body.addEventListener('change', function (e) { handle(e, 'change'); });
    body.addEventListener('input', function (e) { handle(e, 'input'); });
    body.addEventListener('scroll', navState, { passive: true });
    document.getElementById('tabbar').addEventListener('click', function (e) {
      var it = e.target.closest('.tb-item'); if (!it) return;
      if (S.tab === it.dataset.tab) { body.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      var prevTab = S.tab;
      S.tab = it.dataset.tab; render(); if (rest.show) renderRest();
      if (S.tab === 'review' && S.review.returnTo && prevTab === 'settings') {
        var back = S.review.returnTo; S.review.returnTo = null;
        S.review.share = { id: back.id, funVariant: back.funVariant || 0, theme: back.theme || 'sage', body: !!back.body, badgePick: back.badgePick || null, badgeVariant: back.badgeVariant || 0, image: null, blob: null };
        render();
      }
    });
    document.getElementById('rest').addEventListener('click', function (e) {
      var a = e.target.closest('[data-rest-adj]'), s = e.target.closest('[data-rest-stop]');
      if (a) { rest.left = Math.max(5, rest.left + Number(a.dataset.restAdj)); rest.total = Math.max(rest.total, rest.left); renderRest(); }
      if (s) { clearInterval(rest.timer); rest.show = false; renderRest(); }
      if (e.target.closest('[data-rest-toggle]')) { rest.open = !rest.open; renderRest(); }
    });
    document.addEventListener('visibilitychange', function () { var c = Sync.cfg(); if (document.visibilityState === 'visible' && Sync.on() && (!c.lastAt || Date.now() - c.lastAt > 30000)) Sync.run(); });
    window.addEventListener('online', function () { if (Sync.on()) Sync.run(); });
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (S.tab === 'stats') drawStats(); }, 120); });
    render();
    if (Sync.on()) Sync.run();
  });
})();
