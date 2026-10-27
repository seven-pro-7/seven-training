/* H5 版：复用 engine.js / chart.js，结构与类名与小程序 WXML 一一对应 */
(function () {
  'use strict';
  var GZ = window.GZ, Chart = window.GZChart, Share = window.GZShare, Badges = window.GZBadges, Insight = window.GZInsight, Monthly = window.GZMonthly, Weekly = window.GZWeekly;
  var KEY = 'training_db_v1', BK = 'training_last_backup', SYNC_KEY = 'training_sync_v1', WATCH_KEY = 'training_watch_v1', BK_DISMISS = 'training_bk_dismiss';
  [['training_db_v1', 'gzclp_db_v1'], ['training_last_backup', 'gzclp_last_backup'], ['training_sync_v1', 'gzclp_sync_v1'], ['training_watch_v1', 'gzclp_watch_v1'], ['training_bk_dismiss', 'gzclp_bk_dismiss']].forEach(function (pair) {
    try { if (localStorage.getItem(pair[0]) == null && localStorage.getItem(pair[1]) != null) localStorage.setItem(pair[0], localStorage.getItem(pair[1])); } catch (e) {}
  });
  var TABS = [
    { id: 'train', title: '训练' }, { id: 'stats', title: '数据' }, { id: 'tools', title: '工具' },
    { id: 'plan', title: '计划总览' }, { id: 'settings', title: '我的' }
  ];
  function libNames(db) {
    var m = { T1: [], T2: [], T3: [] };
    GZ.libAll(db).forEach(function (x) { if (!m[x.tier] || m[x.tier].indexOf(x.name) >= 0) return; m[x.tier].push(x.name); });
    return m;
  }
  function libRows(lib, opts) {
    if (!lib.list.length) return '<div class="empty-tip">' + (opts.empty || '没有找到相关动作') + '</div>';
    return lib.list.map(function (x) {
      var right = opts.pick
        ? (x.current ? '<span class="lib-cur">当前</span>' : '') + (opts.sel === x.name ? '<span class="lib-ck">✓</span>' : '')
        : (x.custom ? '<span class="lib-del" data-act="libdel" data-name="' + esc(x.name) + '">删除</span>' : '');
      return '<div class="cell ' + (opts.pick ? 'tap ' : '') + 'lib-row ' + (opts.sel === x.name ? 'sel' : '') + '"' + (opts.pick ? ' data-act="swappick" data-name="' + esc(x.name) + '"' : '') + '>' +
        '<div class="flex1"><div class="lib-n">' + esc(x.name) + equipTag(x.equip) + (x.custom ? '<span class="lib-c">自定义</span>' : '') + '</div>' +
        '<div class="lib-s">' + esc(x.patternLabel || '') + (x.part ? ' · ' + esc(x.part) : '') + (x.last ? ' · ' + (opts.pick ? '上次 ' : '最近 ') + x.last + ' ' + esc(x.recUnit) : '') + '</div>' +
        (opts.pick ? '' : '<div class="lib-d">' + esc(x.desc || '') + '</div>') +
        (x.equip === '有氧'
          ? '<div class="lib-rec">' + esc(x.recNote) + '</div>'
          : '<div class="lib-rec">推荐 ' + esc(x.rec) + (x.recUnit === '自重' ? '' : ' ' + esc(x.recUnit)) + ' · ' + esc(x.recNote) + '</div>') + '</div>' + right + '</div>';
    }).join('');
  }
  function chips(items, act) {
    return '<div class="chip-row">' + items.map(function (it) {
      return '<div class="chip' + (it.on ? ' on' : '') + '" data-act="' + act + '" data-k="' + it.k + '" data-v="' + esc(it.id) + '">' + esc(it.label) + (it.n ? '<span class="chip-n">' + it.n + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function fitChoices(cat) {
    var items = [{ html: cat.label, on: false, data: ' data-f="plan"' }];
    if (cat.names && cat.names.length) items.push({ html: '同模式', on: false, data: ' data-f="part"' });
    items.push({ html: '全部', on: false, data: ' data-f="all"' });
    return items;
  }

  function rawLoad() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  /** 手表数据单独存放（不进训练数据文件，避免每次拉取都触发配置冲突与重复推送） */
  function watchLoad() { try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || null; } catch (e) { return null; } }
  function watchSave(w) { if (w) localStorage.setItem(WATCH_KEY, JSON.stringify(w)); else localStorage.removeItem(WATCH_KEY); }
  function load() {
    var raw = rawLoad(), prevDays = raw ? raw.daysVersion : undefined;
    var db = raw; if (!db) { db = GZ.defaults(false); save(db, { fromSync: true }); }
    db = GZ.normalize(db);
    var w = watchLoad();
    // 旧版把手表数据放在 params.watch：并入独立存储后从主数据里拿掉
    if (db.params.watch) {
      w = Badges.mergeWatch(w, { source: db.params.watch.source, workouts: db.params.watch.workouts || [], sleep: db.params.watch.sleep || {} });
      watchSave(w); delete db.params.watch;
      // 主数据里的旧副本必须落盘去掉，否则会被反复合并、甚至用旧值覆盖刚拉取的
      var stored = rawLoad(); if (stored && stored.params) { delete stored.params.watch; localStorage.setItem(KEY, JSON.stringify(stored)); }
    }
    if (raw && prevDays !== db.daysVersion) {
      var snap = JSON.parse(JSON.stringify(db));
      if (snap.params && snap.params.watch) delete snap.params.watch;
      localStorage.setItem(KEY, JSON.stringify(snap));
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
   * 令牌只存在本机 training_sync_v1，不进入备份文件，也不会被同步到云端。
   */
  var Sync = (function () {
    var API = 'https://api.github.com', busy = false, again = false, timer = null;
    function cfg() {
      try {
        var c = JSON.parse(localStorage.getItem(SYNC_KEY)) || null;
        if (c && (!c.path || c.path === 'gzclp-data.json')) c.path = 'training-data.json';
        return c;
      } catch (e) { return null; }
    }
    function setCfg(c) { if (c) localStorage.setItem(SYNC_KEY, JSON.stringify(c)); else localStorage.removeItem(SYNC_KEY); }
    function on() { var c = cfg(); return !!(c && c.token && c.owner && c.repo); }
    function b64enc(str) { var b = new TextEncoder().encode(str), bin = ''; for (var i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); }
    function b64dec(x) { var bin = atob(String(x).replace(/\s/g, '')), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }
    function filePath(c) { return '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + '/contents/' + (c.path || 'training-data.json').split('/').map(encodeURIComponent).join('/'); }
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
        var read = req(c, 'GET', filePath(c)).then(function (g) {
          if (g.status === 404 && (c.path || 'training-data.json') === 'training-data.json') {
            return req(c, 'GET', filePath(Object.assign({}, c, { path: 'gzclp-data.json' }))).then(function (old) {
              if (old.status === 200) old.legacyFile = true;
              return old;
            });
          }
          return g;
        });
        return read.then(function (g) {
          if (g.status !== 200 && g.status !== 404) throw g.status;
          var remote = null, sha = null, rawRemoteObj = null, remoteVer = null;
          if (g.status === 200) {
            if (!g.legacyFile) sha = g.json.sha;
            try { rawRemoteObj = JSON.parse(b64dec(g.json.content)); } catch (e) { throw 'bad'; }
            remoteVer = rawRemoteObj.daysVersion;
            remote = GZ.normalize(rawRemoteObj);
            if (remote.params.watch) { var ow = remote.params.watch; delete remote.params.watch; try { watchSave(Badges.mergeWatch(watchLoad(), { source: ow.source, workouts: ow.workouts || [], sleep: ow.sleep || {} })); } catch (e) {} }
          }
          var raw = rawLoad(), localVer = raw && raw.daysVersion, local = GZ.normalize(raw || GZ.defaults(false)), merged = GZ.mergeDb(local, remote);
          var remoteChanged = g.status === 200 && remoteVer !== remote.daysVersion;
          var localChanged = !!(raw && localVer !== local.daysVersion);
          var pulled = !GZ.sameDb(merged, local);
          if (pulled || !raw || localChanged) save(merged, { fromSync: true });
          if (remote && GZ.sameDb(merged, remote) && !g.legacyFile && !remoteChanged) return { pulled: pulled, pushed: false, n: merged.records.length };
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
    /** 自动拉取手表数据：云端 training-watch.json 由定时任务写入，这里只读、合并到本机，从不写回 */
    function pullWatch(manual) {
      var c = cfg(); if (!c || !on()) return Promise.resolve(false);
      function grab(path) { return req(c, 'GET', filePath(Object.assign({}, c, { path: path }))); }
      return grab('training-watch.json').then(function (g) {
        if (g.status === 404) return grab('gzclp-watch.json');
        return g;
      }).then(function (g) {
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
        if (manual) toast((changed ? '已拉取手表数据' : '云端快照没有新内容') + watchLatestText(merged) + watchSnapText(meta));
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
      var c = { owner: owner, repo: repo, token: token, path: 'training-data.json' };
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
  function mdDate(d) { return d && String(d).length >= 10 ? (+String(d).slice(5, 7)) + '月' + (+String(d).slice(8, 10)) + '日' : ''; }
  function watchLatestText(w) {
    var edge = Badges.watchLatest ? Badges.watchLatest(w) : null;
    return edge ? '，最近一次力量训练是 ' + mdDate(edge.date) : '';
  }
  function watchSnapText(generatedAt) {
    var day = generatedAt && String(generatedAt).slice(0, 10);
    var hm = generatedAt && String(generatedAt).slice(11, 16);
    if (!day || day.length < 10) return '';
    return '。这份快照更新于 ' + mdDate(day) + (hm && hm.indexOf(':') > 0 ? ' ' + hm : '') + '，立即拉取不会直接连接手表';
  }
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
  function tier(t, badge) { return '<span class="tier t-' + t + '">' + esc(badge || t) + '</span>'; }
  /** 计划总览的完成详情、数据 → 记录的展开行，用同一套 HTML。 */
  function sessionRows(items) {
    return '<div class="sess-list">' + items.map(function (it) {
      return '<div class="sess-row">' + tier(it.tier, it.badge) +
        '<div class="sess-main"><span class="sess-name">' + esc(it.name) + '</span><span class="sess-sub">' + esc(it.detail) + '</span>' +
        (it.context ? '<span class="sess-ctx">' + esc(it.context) + '</span>' : '') + '</div>' +
        '<div class="sess-right"><span class="jtag" style="color:' + it.color + '">' + esc(it.j) + '</span>' +
        (it.next ? '<span class="sess-next">' + esc(it.next) + '</span>' : '') + '</div></div>';
    }).join('') + '</div>';
  }
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
    view: { pid: null },
    plan: { ov: 0, detail: null, cycle: 0, view: '', tpl: '', from: '' }, stats: { lift: 0, day: 0, ex: null }, data: { seg: 1 }, review: { tab: 0, open: {}, rules: false }, settings: { d: 0, imp: false, view: '', pattern: '', part: '', equip: '', q: '', add: null },
    onboard: { step: 1, force: false, returnTab: '' }
  };
  function gateOnboard() { return false; }
  function syncOnboardStep(db) {
    if (S.onboard.force) return;
    if (!GZ.profileReady(db)) S.onboard.step = 1;
    else if (!GZ.directionReady(db)) S.onboard.step = 2;
  }
  var rest = { show: false, left: 0, total: 0, name: '', timer: null };

  // ================= 多计划：数据与回顾默认看当前计划，可切换查看其他计划 =================
  /** 数据页 / 回顾页取数用：默认当前计划；切换后是该计划的只读视图（规则、训练日、记录都属于它） */
  function viewDb() {
    var db = load(), pid = S.view.pid;
    if (pid && pid !== GZ.activePid(db)) { var v = GZ.planView(db, pid); if (v) return v; }
    S.view.pid = null;
    return db;
  }
  function viewingOther() { var db = load(); return !!S.view.pid && S.view.pid !== GZ.activePid(db) && !!GZ.planView(db, S.view.pid); }
  /** 页面顶部的计划上下文：只有一个计划时只显示名称；多个计划时可切换查看 */
  function planBar() {
    var db = load(), L = GZ.programList(db), cur = L.filter(function (p) { return p.active; })[0] || L[0];
    if (!cur) return '';
    var viewId = viewingOther() ? S.view.pid : cur.id, v = L.filter(function (p) { return p.id === viewId; })[0] || cur;
    if (L.length <= 1) return '<div class="plan-ctx"><span class="plan-ctx-l">当前计划</span><span class="plan-ctx-n">' + esc(cur.name) + '</span></div>';
    return '<label class="plan-ctx sel"><span class="plan-ctx-l">' + (v.active ? '当前计划' : '查看计划') + '</span><select data-act="viewplan" aria-label="选择要查看的计划">' +
      L.map(function (p) { return '<option value="' + esc(p.id) + '" ' + (p.id === viewId ? 'selected' : '') + '>' + esc(p.name + ' · ' + p.statusText + (p.sessions ? ' · ' + p.sessions + ' 次' : '')) + '</option>'; }).join('') + '</select></label>' +
      (v.active ? '' : '<div class="plan-ro">正在查看「' + esc(v.name) + '」（' + esc(v.statusText) + '），只读。记录的修改与删除需要回到当前计划。<span class="btn-small" data-act="viewcur">回到当前计划</span></div>');
  }
  /** 计划栏的操作：数据页与回顾页共用 */
  function viewAct(act, el) {
    if (act === 'viewplan') { var db = load(); S.view.pid = el.value === GZ.activePid(db) ? null : el.value; S.stats.ex = null; S.review.share = null; S.review.open = {}; return true; }
    if (act === 'viewcur') { S.view.pid = null; S.stats.ex = null; S.review.share = null; return true; }
    return null;
  }

  // ================= 训练 =================
  /** 切到别的训练日之前，把这一天已经填的组次、完成选择和减载记下来 */
  function rememberTrain() {
    var t = S.train;
    if (!t.day || t.recordId) return;
    if (!t.drafts) t.drafts = {};
    if (t.draft) t.drafts[t.day] = t.draft;
    if (!t.deloads) t.deloads = {};
    if (t.deload) t.deloads[t.day] = true; else delete t.deloads[t.day];
    if (!t.focusByDay) t.focusByDay = {};
    if (t.focus) t.focusByDay[t.day] = t.focus; else delete t.focusByDay[t.day];
  }
  function takeTrainDay(day) {
    var t = S.train, db = load();
    if (!t.drafts) t.drafts = {};
    t.day = day;
    t.draft = t.drafts[day] || GZ.blankDraft(db, day);
    t.drafts[day] = t.draft;
    t.deload = t.deloads && t.deloads[day] ? true : undefined;
    if (t.focusByDay && t.focusByDay[day]) { t.focus = t.focusByDay[day]; t.focusKey = day + '|'; }
    else { t.focus = null; t.focusKey = ''; }
  }
  function dropTrainDay(day) {
    var t = S.train;
    if (t.drafts) delete t.drafts[day];
    if (t.deloads) delete t.deloads[day];
    if (t.focusByDay) delete t.focusByDay[day];
  }
  function clearTrainDays() {
    var t = S.train;
    t.drafts = {}; t.deloads = {}; t.focusByDay = {}; t.focus = null; t.focusKey = '';
  }
  function trainVM() {
    var db = load(), t = S.train;
    if (!t.day || !GZ.dayById(db, t.day)) t.day = GZ.recommend(db).day;
    if (!t.drafts) t.drafts = {};
    if (!t.draft) t.draft = t.drafts[t.day] || GZ.blankDraft(db, t.day);
    t.drafts[t.day] = t.draft;
    if (t.deload === undefined && t.deloads && t.deloads[t.day]) t.deload = true;
    return GZ.buildTrain(db, { day: t.day, recordId: t.recordId, draft: t.draft, deload: t.deload });
  }
  function entry(slot) { var d = S.train.draft; return d[slot] || (d[slot] = { v: null, done: 0 }); }

  function renderTrainHold(cur) {
    var paused = cur.status === 'paused';
    return '<div class="head"><div class="large-title">' + esc(cur.name) + '</div></div>' +
      '<div class="card hold-card"><div class="st-pill ' + (paused ? 'st-paused' : 'st-ended') + '">' + (paused ? '已暂停' : '已结束') + '</div>' +
      '<div class="hold-t">' + (paused ? '这套计划暂停了' : '这套计划已经结束') + '</div>' +
      '<div class="hold-s">' + (paused ? '要继续或结束，打开工具里计划库中的这套计划。' : '不能再往这套里记训练。要换一套，去工具里的计划库开始。') + '</div>' +
      '<div class="plan-ops"><div class="btn-ghost" data-act="opendetail">打开这套计划</div></div></div>';
  }
  function renderTrain() {
    var db0 = load(), cur0 = GZ.activeProgram(db0);
    if (cur0 && cur0.status !== 'active' && !S.train.recordId) return renderTrainHold(cur0);
    var vm = trainVM(), t = S.train, h = '';
    var o = vm.overview || {};
    h += '<div class="head day-head"><div class="head-tools"><span class="cycle-eye num">' + (vm.editing ? '编辑记录 · ' : '') + '第 ' + vm.cycle + ' 轮 · 第 ' + vm.weekInCycle + ' 周' + (vm.locked ? ' · 已完成' : '') + '</span><div class="head-pills">' +
      '<label class="date-pick date-pill"><span class="num">' + GZ.dateLabel(t.date) + '</span>' + (vm.locked ? '' : '<input type="date" data-act="date" value="' + t.date + '" aria-label="训练日期">') + '</label>' +
      (!vm.locked && (vm.deloadSuggest || vm.deload) ? '<div class="deload-pill' + (vm.deload ? ' on' : '') + '"><span>减载</span><label class="ios-sw sm"><input type="checkbox" data-act="deload" aria-label="减载周" ' + (vm.deload ? 'checked' : '') + '><i></i></label></div>' : '') +
      (vm.editing ? '<span class="link" data-act="cancelEdit">取消</span>' : '') + '</div></div>' +
      '<div class="large-title"><span class="num">' + vm.day + '</span> ' + esc(vm.dayName) + '</div>' +
      (!vm.locked && (vm.deloadSuggest || vm.deload) ? '<div class="dl-note">' + esc(vm.deloadTip || '减载周 · 降低负荷恢复') + '</div>' : '') + '</div>';
    if (!vm.editing) h += backupNag();
    if (!vm.editing) {
      h += '<div class="day-cmd"><div class="seg day-seg' + (vm.days.length > 4 ? ' wide' : '') + '">' + vm.days.map(function (d) {
        return '<div class="seg-i ' + (d.id === vm.day ? 'on ' : '') + (d.done ? 'is-done' : '') + '" data-act="day" data-day="' + d.id + '">' + (d.done ? '<span class="ds-ck">✓</span>' : '') +
          '<span class="num">' + d.id + '</span>' + (d.rec ? '<div class="rec-dot"></div>' : '') + '</div>';
      }).join('') + '</div>';
      var rd = vm.round;
      h += '<div class="wk-prog"><div class="wk-bar"><div class="wk-in" style="width:' + rd.pct + '%"></div></div><span class="wk-t">本周 <span class="num strong">' + rd.done + '/' + rd.total + '</span>' +
        (rd.left ? ' · 完成 ' + rd.leftText + ' 后进入' + rd.nextWeekText : '') + '</span></div></div>';
    }
    if (!vm.locked && vm.overview) {
      h += '<div class="ov"><div class="ov-cell"><span class="ov-k">' + esc(o.focusLabel) + '</span><span class="ov-v">' + esc(o.focusName) + '</span></div>' +
        '<div class="ov-cell"><span class="ov-k">已完成</span><span class="ov-v num">' + o.done + '/' + o.total + '<span class="ov-u"> 项</span></span></div>' +
        '<div class="ov-cell"><span class="ov-k">实时容量</span><span class="ov-v num">' + o.volume + '<span class="ov-u"> kg</span></span></div></div>';
    }
    if (!vm.editing) {
      h += '<div class="card tap lib-entry" data-act="overview"><span class="flex1">计划总览</span><span class="cap" style="margin-right:8px">周期与动作状态</span><span class="chev">›</span></div>';
    }
    if (vm.locked && vm.lockedInfo) {
      var L = vm.lockedInfo;
      h += '<div class="card locked"><div class="lk-head"><div class="lk-ic">✓</div><div class="flex1"><div class="lk-t">本周 ' + vm.day + ' 已完成</div><div class="lk-s">' + L.dateText + ' · 容量 ' + L.vol + ' kg</div></div></div>' +
        sessionRows(L.items) +
        '<div class="lk-tip">下周的 ' + vm.day + ' 会在本周 ' + vm.round.leftText + ' 完成后开放</div>' +
        '<button type="button" class="btn-primary lk-share" data-act="shareopen" data-id="' + L.id + '">查看今日战报</button>' +
        '<div class="sheet-btns"><div class="btn-ghost" data-act="editLocked" data-id="' + L.id + '">修改这次</div><div class="btn-ghost solid" data-act="day" data-day="' + vm.recommended + '">去练 ' + vm.recommended + '</div></div></div>';
    }
    if (!vm.locked) {
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
    var restBuf = '', flushRest = function () {
      if (restBuf) {
        h += '<div class="card rest-group"><div class="rg-head">后续动作</div>' + restBuf + '</div>';
        restBuf = '';
      }
    };
    vm.items.forEach(function (it) {
      if (it.slotId !== t.focus) {
        var p0 = it.preview, right;
        if (it.skip) right = '<span class="exr-st">已跳过</span>';
        else if (p0) right = '<span class="exr-st" style="color:' + p0.color + '">' + p0.icon + ' ' + p0.judgment + '</span>' + (p0.sub || p0.judgment === '减载' ? '' : '<span class="exr-nx num">下次 ' + (it.inputType === 'cardio' ? esc(p0.nextStage) : p0.nextWeight) + '</span>');
        else if (it.isCardio) right = '<span class="exr-w num">' + esc(it.repsText) + '</span>';
        else right = '<span class="exr-w num">' + (!it.isBW ? it.weightText + '<span class="exr-u"> ' + esc(it.unitText) + '</span>' : '自重') + '</span><span class="exr-r num">' + it.repsText + '</span>';
        restBuf += '<div class="ex-row g ' + (finished(it) ? 'is-fin ' : '') + (it.skip ? 'skipped' : '') + '" data-act="focus" data-slot="' + it.slotId + '">' + tier(it.tier, it.badge) +
          '<span class="exr-n">' + esc(it.name) + '</span><span class="exr-right">' + right + '</span><span class="exr-chev">›</span></div>';
        return;
      }
      flushRest();
      var nxt = nextOpen(it.slotId);
      h += '<div class="card ex is-focus tier-' + it.tier + (it.skip ? ' skipped' : '') + '">';
      h += '<div class="ex-head">' + tier(it.tier, it.badge) + '<div class="ex-title"><span class="ex-name">' + esc(it.name) + '</span>' + equipTag(it.equip) +
        (it.sub ? '<span class="ex-tag sub">替换 ' + esc(it.planName) + '</span>' : it.autoNew ? '<span class="ex-tag rot">本轮轮换 · 原 ' + esc(it.autoPrev) + '</span>' : it.changeNew ? '<span class="ex-tag new">新动作</span>' : '') + '</div>' +
        (it.skip ? '<span class="ex-skip-w num">' + (it.isBW ? '自重' : esc(it.weightText)) + '</span>' : '') +
        '<span class="ex-act" data-act="openswap" data-slot="' + it.slotId + '">更换</span>' +
        '<span class="ex-skip" data-act="skip" data-slot="' + it.slotId + '">' + (it.skip ? '恢复' : '跳过') + '</span></div>';
      if (!it.skip) {
      h += '<div class="ex-main">' + (!it.isBW
        ? '<div class="wbox ' + (it.editW ? 'editing' : '') + '"' + (it.canAdjust ? ' data-act="editW" data-slot="' + it.slotId + '"' : '') + '><span class="w-num num ' + (it.manual ? 'manual' : '') + '">' + it.weightText + '</span><span class="w-unit">' + esc(it.unitText) + '</span>' + (it.canAdjust ? '<span class="w-edit">' + (it.editW ? '收起' : '调整') + '</span>' : '') + '</div>'
        : '<div class="wbox bw-only"><span class="w-num bw-text">自重</span></div>') + (it.isCardio ? '' : '<span class="reps num">' + it.repsText + '</span>') + '</div>';
      if (it.manual || it.plates || it.fail > 0) h += '<div class="meta-row">' + (it.manual ? '<span class="meta-chip manual">已手动调整 · 建议 ' + it.autoText + ' kg</span>' : '') + (it.plates ? '<span class="meta-chip">' + esc(it.plates) + '</span>' : '') + (it.fail > 0 ? '<span class="meta-chip warn">已预警 ' + it.fail + ' 次</span>' : '') + '</div>';
      if (it.editW) {
        h += '<div class="wedit"><div class="stepper"><div class="st-btn" data-act="wstep" data-slot="' + it.slotId + '" data-d="-1">−</div>' +
          '<input class="st-val wide num" inputmode="decimal" data-act="winput" data-slot="' + it.slotId + '" value="' + it.weightText + '" aria-label="工作重量">' +
          '<div class="st-btn" data-act="wstep" data-slot="' + it.slotId + '" data-d="1">+</div></div><span class="we-step">± ' + it.wStep + ' kg</span>' +
          (it.manual ? '<span class="we-reset" data-act="wreset" data-slot="' + it.slotId + '">恢复建议</span>' : '') + '</div>';
      }
        if (it.inputType !== 'sets' && it.inputType !== 'fixed' && it.inputType !== 'cardio') {
          h += '<div class="dots">' + it.dots.map(function (d) {
            return '<div class="dot ' + (d.on ? 'on ' : '') + (d.amrap ? 'amrap' : '') + '" data-act="dot" data-slot="' + it.slotId + '" data-i="' + d.i + '" data-rest="' + it.rest + '" data-name="' + esc(it.name) + '">' + (d.amrap ? (d.i + 1) + '+' : d.i + 1) + '</div>';
          }).join('') + '<div class="rest-btn" data-act="rest" data-rest="' + it.rest + '" data-name="' + esc(it.name) + '">休息 ' + it.restText + '</div></div>';
        }
        h += '<div class="ex-foot">';
        if (it.inputType === 'sets') h += setsBlock(it);
        else if (it.inputType === 'linear' || it.inputType === 'wave') h += repBlock(it);
        else if (it.inputType === 'fixed') h += fixedBlock(it);
        else if (it.inputType === 'cardio') h += cardioBlock(it);
        else if (it.inputType === 'amrap') {
          h += '<div class="inrow"><div class="flex1"><div class="in-label">末组次数</div><div class="in-hint">目标 ' + it.amrapHint + '</div></div><div class="stepper">' +
            '<div class="st-btn" data-act="step" data-slot="' + it.slotId + '" data-d="-1">−</div><input class="st-val num" inputmode="numeric" data-act="amrap" data-slot="' + it.slotId + '" value="' + (it.value === null || it.value === undefined ? '' : it.value) + '" placeholder="' + (it.amrapTarget || '') + '" aria-label="末组次数">' +
            '<div class="st-btn" data-act="step" data-slot="' + it.slotId + '" data-d="1">+</div></div></div>';
        }
        if (it.need5RM) h += '<div class="inrow"><div class="flex1"><div class="in-label">新 5RM</div><div class="in-hint">未达标时按新 5RM 的 85% 重置</div></div><input class="mini-in num" inputmode="decimal" data-act="5rm" data-slot="' + it.slotId + '" value="' + esc(it.new5RM) + '" placeholder="kg" aria-label="新 5RM"></div>';
        if (it.inputType === 'done') {
          h += '<div class="inrow col"><div class="seg seg-done"><div class="seg-i ' + (it.value === '完成' ? 'on ok' : '') + '" data-act="done" data-slot="' + it.slotId + '" data-v="完成">全部完成</div>' +
            '<div class="seg-i ' + (it.value === '未完成' ? 'on bad' : '') + '" data-act="done" data-slot="' + it.slotId + '" data-v="未完成">未完成</div></div>';
          if (it.amrapHint) h += '<div class="in-hint">' + esc(it.amrapHint) + '</div>';
          if (it.value === '未完成') h += '<div class="subrow"><span class="in-hint">实际总次数（选填，不填则这次不计入容量）</span><input class="mini-in num" inputmode="numeric" data-act="reps" data-slot="' + it.slotId + '" value="' + esc(it.reps2) + '" placeholder="次数" aria-label="实际总次数"></div>';
          h += '</div>';
        }
        if (it.preview) {
          var p = it.preview;
          h += '<div class="verdict v-' + (p.tone || 'hold') + '"><div class="v-ic">' + p.icon + '</div><span class="v-j">' + esc(p.pill || p.judgment) + '</span>' +
            (p.sub ? '<span class="v-l">不影响 ' + esc(p.origName) + ' 的进阶</span>' : it.inputType === 'cardio' ? '<div class="v-next"><span class="v-l">下次</span><span class="num v-w">' + esc(p.nextStage) + '</span></div>' : p.judgment !== '减载' ? '<div class="v-next"><span class="v-l">下次</span><span class="num v-w">' + p.nextWeight + '</span><span class="v-u">kg</span>' + (p.stageChanged ? '<span class="v-stage">· ' + esc(p.nextStage) + '</span>' : '') + '</div>' : '<span class="v-l">按减载重量完成</span>') + '</div>' +
            (p.boost && p.adaptNote ? '<div class="v-adapt"><span class="v-adapt-t">多加一档</span>' + esc(p.adaptNote) + '</div>' : '');
        }
        h += '</div>';
      }
      if ((it.preview || it.skip) && nxt) h += '<div class="ex-next" data-act="focus" data-slot="' + nxt + '">下一个动作<span class="exr-chev">›</span></div>';
      h += '</div>';
    });
    flushRest();
    h += '<div class="list"><div class="cell"><span class="flex1">体重</span><input class="cell-in num" inputmode="decimal" data-act="bw" value="' + esc(t.bw) + '" placeholder="可选"><span class="unit">kg</span></div>' +
      '<div class="cell"><textarea class="note" data-act="note" rows="2" placeholder="备注：状态、睡眠、技术要点">' + esc(t.note) + '</textarea></div></div>';
    h += '<div class="submit-bar"><span class="sb-count num"><b>' + vm.filled + '</b> / ' + vm.total + '</span><button class="btn-primary sb-btn" data-act="submit">' + (vm.editing ? '保存修改' : '完成训练') + '</button></div>';
    }
    if (t.swap && t.swap.show) h += renderSwap();
    if (t.result) {
      var r = t.result;
      h += '<div class="mask" data-act="closeResult"><div class="sheet" data-stop="1"><div class="grabber"></div><span class="sheet-cap">' + r.day + ' ' + r.dayName + ' · ' + r.weekText + '</span><div class="sheet-title">' + (r.cycleDone ? '第 ' + r.cycle + ' 轮完成' : r.weekDone ? '本周完成' : '训练完成') + '</div>' +
        (r.cycleDone ? '<div class="wk-done">第 ' + r.cycle + ' 轮 ' + r.weeksPerCycle + ' 周全部完成，进入第 ' + (r.cycle + 1) + ' 轮' + (r.nextDeload ? '（含减载周）' : '') + '</div>' + (r.rotated ? '<div class="wk-left">' + ((vm.progression || 'gzclp') === 'gzclp' ? '已按轮换计划更换 ' + r.rotated + ' 个 T2/T3 动作，T1 四大项不变。当前动作在「计划总览」的当前状态里。' : '已按计划更换变式。当前动作在「计划总览」的当前状态里。') + '</div>' : '')
          : r.weekDone ? '<div class="wk-done">本周训练日全部完成，已进入' + r.nextWeekText + (r.nextDeload ? '（减载周）' : '') + '</div>'
          : (r.leftText ? '<div class="wk-left">本周还剩 ' + r.leftText + '</div>' : '')) +
        '<div class="res-kpi"><div class="rk"><span class="num rk-v">' + r.volume + '</span><span class="rk-l">容量 kg</span></div><div class="rk"><span class="num rk-v accent">' + r.adds + '</span><span class="rk-l">项加重</span></div></div>' +
        '<div class="list">' + r.items.map(function (x) { return '<div class="cell res-row">' + tier(x.tier, x.badge) + '<span class="res-name flex1">' + x.name + '</span><div class="res-r"><span class="jtag" style="color:' + x.color + '">' + x.j + '</span><span class="res-next num">' + x.next + '</span></div></div>'; }).join('') + '</div>' +
        '<div class="sheet-btns stack"><button type="button" class="btn-primary share-result" data-act="shareopen" data-id="' + r.logId + '">生成今日战报</button><div class="row"><div class="btn-ghost" data-act="gotoStats">查看数据</div><div class="btn-ghost solid" data-act="closeResult">好</div></div></div></div></div>';
    }
    return h;
  }

  function setsBlock(it) {
    var sc = it.scheme || {}, arr = it.setsIn || [], h = '<div class="in-hint set-hint">' + esc(it.amrapHint) + '</div>';
    for (var i = 0; i < it.sets; i++) {
      var v = arr[i];
      h += '<div class="inrow"><div class="flex1"><div class="in-label">第 ' + (i + 1) + ' 组</div><div class="in-hint">' + (sc.repMin || '') + '–' + (sc.repMax || '') + ' 次</div></div><div class="stepper">' +
        '<div class="st-btn" data-act="setrep" data-slot="' + it.slotId + '" data-i="' + i + '" data-d="-1">−</div>' +
        '<input class="st-val num" inputmode="numeric" data-act="setin" data-slot="' + it.slotId + '" data-i="' + i + '" value="' + (v === null || v === undefined ? '' : v) + '" placeholder="' + (sc.repMin || '') + '">' +
        '<div class="st-btn" data-act="setrep" data-slot="' + it.slotId + '" data-i="' + i + '" data-d="1">+</div></div></div>';
    }
    h += '<div class="rest-btn" data-act="rest" data-rest="' + it.rest + '" data-name="' + esc(it.name) + '">休息 ' + it.restText + '</div>';
    return h;
  }
  function repBlock(it) {
    var h = '';
    if (it.inputType === 'wave' && it.loads) {
      h += '<div class="load-list">' + it.loads.map(function (ld, i) {
        var last = i === it.loads.length - 1;
        return '<div class="load-row"><span>' + (ld.pct ? Math.round(ld.pct * 100) + '%' : ('第 ' + (i + 1) + ' 组')) + '</span><span class="num">' + GZ.fmtW(ld.weight) + ' × ' + ld.reps + (last && ld.amrap ? '+' : '') + '</span></div>';
      }).join('') + '</div>';
    }
    h += '<div class="inrow"><div class="flex1"><div class="in-label">' + (it.inputType === 'wave' ? '最后一组次数' : '末组次数') + '</div><div class="in-hint">' + esc(it.amrapHint) + '</div></div><div class="stepper">' +
      '<div class="st-btn" data-act="step" data-slot="' + it.slotId + '" data-d="-1">−</div><input class="st-val num" inputmode="numeric" data-act="amrap" data-slot="' + it.slotId + '" value="' + (it.value === null || it.value === undefined ? '' : it.value) + '" placeholder="' + (it.reps || '') + '">' +
      '<div class="st-btn" data-act="step" data-slot="' + it.slotId + '" data-d="1">+</div></div></div>';
    h += '<div class="inrow"><div class="flex1"><div class="in-label">前面的规定组没完成</div></div><label class="ios-sw"><input type="checkbox" data-act="miss" data-slot="' + it.slotId + '" ' + (it.miss ? 'checked' : '') + '><i></i></label></div>';
    return h;
  }
  function cardioBlock(it) {
    var hit = it.value !== null && it.value !== undefined && it.value !== '' && Number(it.value) >= Number(it.amrapTarget || 0);
    return '<div class="inrow col"><div class="seg seg-done"><div class="seg-i ' + (hit ? 'on ok' : '') + '" data-act="cardiodone" data-slot="' + it.slotId + '">完成</div></div></div>' +
      '<div class="inrow"><div class="flex1"><div class="in-label">实际分钟</div><div class="in-hint">' + esc(it.amrapHint) + '</div></div><div class="stepper">' +
      '<div class="st-btn" data-act="step" data-slot="' + it.slotId + '" data-d="-1">−</div><input class="st-val num" inputmode="numeric" data-act="amrap" data-slot="' + it.slotId + '" value="' + (it.value === null || it.value === undefined ? '' : it.value) + '" placeholder="' + (it.amrapTarget || '') + '">' +
      '<div class="st-btn" data-act="step" data-slot="' + it.slotId + '" data-d="1">+</div></div></div>';
  }
  function fixedBlock(it) {
    return '<div class="inrow col"><div class="in-hint">' + esc(it.amrapHint) + '</div><div class="seg seg-done"><div class="seg-i ' + (it.value === '完成' ? 'on ok' : '') + '" data-act="done" data-slot="' + it.slotId + '" data-v="完成">全部完成</div></div>' +
      '<div class="rest-btn" data-act="rest" data-rest="' + it.rest + '" data-name="' + esc(it.name) + '">休息 ' + it.restText + '</div></div>';
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
      case 'swapfit': if (t.swap.category && t.swap.category.locked) return false; t.swap.fit = ds.f; return true;
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
      case 'day': if (t.recordId || !ds.day || ds.day === t.day) return; rememberTrain(); takeTrainDay(ds.day); return true;
      case 'deload': t.deload = el.checked; return true;
      case 'focus': t.focus = ds.slot; render(true); setTimeout(function () { var c = document.querySelector('.ex.is-focus'); if (c) c.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 20); return false;
      case 'step':
        en = entry(ds.slot); vm = trainVM();
        var it = vm.items.filter(function (x) { return x.slotId === ds.slot; })[0];
        var tg = it.amrapTarget || it.reps;
        var v = en.v === null || en.v === '' || en.v === undefined ? (Number(ds.d) > 0 ? tg : tg - 1) : Number(en.v) + Number(ds.d);
        en.v = Math.max(0, Math.min(it.inputType === 'cardio' ? 300 : 60, v)); if (navigator.vibrate) navigator.vibrate(8); return true;
      case 'amrap': en = entry(ds.slot); vm = trainVM(); var ait = vm.items.filter(function (x) { return x.slotId === ds.slot; })[0]; en.v = el.value === '' ? null : Math.max(0, Math.min(ait && ait.inputType === 'cardio' ? 300 : 60, parseInt(el.value, 10) || 0)); return true;
      case '5rm': entry(ds.slot).new5RM = el.value; return true;
      case 'done': en = entry(ds.slot); en.v = en.v === ds.v ? null : ds.v; return true;
      case 'cardiodone':
        en = entry(ds.slot); vm = trainVM();
        var cit = vm.items.filter(function (x) { return x.slotId === ds.slot; })[0];
        var goalMin = Number(cit && (cit.amrapTarget || cit.reps)) || 0;
        en.v = en.v !== null && en.v !== '' && Number(en.v) >= goalMin ? null : goalMin;
        return true;
      case 'setrep':
        en = entry(ds.slot); vm = trainVM();
        var its = vm.items.filter(function (x) { return x.slotId === ds.slot; })[0];
        if (!en.sets) en.sets = [];
        var ix = Number(ds.i), base = (its.scheme && its.scheme.repMin) || its.reps || 8, cur = en.sets[ix];
        var nv = cur === null || cur === undefined || cur === '' ? (Number(ds.d) > 0 ? base : Math.max(0, base - 1)) : Number(cur) + Number(ds.d);
        en.sets[ix] = Math.max(0, Math.min(60, nv)); if (navigator.vibrate) navigator.vibrate(8); return true;
      case 'setin':
        en = entry(ds.slot); if (!en.sets) en.sets = [];
        en.sets[Number(ds.i)] = el.value === '' ? null : Math.max(0, Math.min(60, parseInt(el.value, 10) || 0)); return true;
      case 'miss': en = entry(ds.slot); en.miss = !!el.checked; return true;
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
      case 'overview': S.tab = 'plan'; S.plan.view = ''; S.plan.from = 'train'; S.plan.slot = null; S.plan.detail = null; S.stats.ex = null; render(); return false;
      case 'opendetail':
        var curOpen = GZ.activeProgram(load());
        S.tab = 'tools'; S.plan.view = 'browse'; S.plan.tpl = curOpen ? GZ.templateKey(curOpen.template) : '';
        render(); return false;
      case 'closeResult': t.result = null; return true;
      case 'gotoStats': t.result = null; S.tab = 'stats'; S.data.seg = 1; return true;
    }
  }
  function submit() {
    var db0 = load(), cur0 = GZ.activeProgram(db0);
    if (cur0 && cur0.status !== 'active' && !S.train.recordId) return toast(cur0.status === 'paused' ? '计划已暂停' : '计划已结束');
    var vm = trainVM(), t = S.train;
    if (vm.locked) return;
    var missing = vm.deload ? [] : vm.items.filter(function (it) { return !it.skip && !it.logged; });
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
        weekDone: wDone, leftText: t.recordId ? '' : rdn.leftText, nextDeload: wDone && GZ.isDeloadWeek(rdn.week, db.params), logId: rec.id, adds: s.items.filter(function (x) { return x.judgment === '加重'; }).length,
        items: s.items.map(function (it) { return { tier: it.tier, badge: it.badge, name: it.name, j: it.judgment, color: GZ.JUDGE_COLORS[it.judgment], next: it.deload || it.judgment === '跳过' ? '—' : it.sub ? GZ.fmtW(it.weight) + ' kg · 替代 ' + it.origName : it.inputMode === 'cardio' ? it.nextStage : GZ.fmtW(it.barNext != null ? it.barNext : it.nextWeight) + ' kg · ' + it.nextStage }; }) } : null;
      dropTrainDay(t.day);
      t.recordId = null; t.deload = undefined; t.day = GZ.recommend(db).day; t.draft = null; t.focus = null; t.focusKey = ''; t.bw = ''; t.note = ''; t.date = GZ.today();
      render();
    };
    if (missing.length) confirmBox('还有未填写的动作', missing.map(function (m) { return m.name; }).join('、') + ' 将按“跳过”保存，状态保持不变。', go); else go();
  }
  function openSwap(slot) {
    var t = S.train, vm = trainVM(), it = vm.items.filter(function (x) { return x.slotId === slot; })[0];
    var ctx = GZ.swapContext(load(), t.day, slot);
    t.swap = { show: true, slotId: slot, dayId: t.day, category: ctx.category, fit: 'plan', q: '', sel: '', scope: 'once', curName: it.name, planName: it.planName,
      isSub: it.sub, editing: !!t.recordId, rotates: ctx.rotates, week: ctx.week, weight: ctx.weightText, ctxW: ctx.weight, lastW: ctx.lastW };
  }
  function swapLib() { var sw = S.train.swap; return GZ.buildLibrary(load(), { category: sw.category, fit: sw.fit, q: sw.q, current: sw.curName }); }
  function updateSwapList() {
    var el = document.getElementById('swapList'), sw = S.train.swap; if (!el) return;
    el.innerHTML = '<div class="list">' + libRows(swapLib(), { pick: true, sel: sw.sel, empty: '没有找到，可在「我的 → 动作库」添加自定义动作' }) + '</div>';
    var sg = document.getElementById('swapSeg'); if (sg) sg.style.display = sw.q ? 'none' : '';
  }
  function renderSwap() {
    var sw = S.train.swap, lib = swapLib(), cat = sw.category, h = '';
    h += '<div class="mask" data-act="closeswap"><div class="sheet swap-sheet" data-stop="1"><div class="grabber"></div>' +
      '<span class="sheet-cap">' + esc(cat.label) + ' · 当前 ' + esc(sw.curName) + (sw.planName !== sw.curName ? '（原 ' + esc(sw.planName) + '）' : '') + '</span>' +
      '<div class="row between"><div class="sheet-title">更换动作</div>' + (sw.isSub ? '<span class="link" data-act="swaprestore">恢复 ' + esc(sw.planName) + '</span>' : '') + '</div>' +
      '<div class="search"><span class="search-ic">⌕</span><input class="search-in" data-act="swapq" value="' + esc(sw.q) + '" placeholder="搜索动作、部位或器械"></div>' +
      (cat.locked
        ? '<div class="sec-f t1-only">' + esc(cat.hint) + '</div>'
        : '<div id="swapSeg"' + (sw.q ? ' style="display:none"' : '') + '>' + seg(fitChoices(cat).map(function (x) { x.on = (x.data.indexOf('"' + sw.fit + '"') >= 0); return x; }), -1, 'swapfit') + '</div>' +
          (cat.hint ? '<div class="sec-f">' + esc(cat.hint) + '</div>' : '')) +
      '<div class="lib-list" id="swapList"><div class="list">' + libRows(lib, { pick: true, sel: sw.sel, empty: '没有找到，可在「我的 → 动作库」添加自定义动作' }) + '</div></div>';
    if (sw.sel) {
      if (!sw.editing) h += seg([{ html: '仅本次', on: sw.scope === 'once', data: ' data-s="once"' }, { html: '以后都用', on: sw.scope === 'perm', data: ' data-s="perm"' }], -1, 'swapscope', 'swap-scope');
      h += '<div class="swap-rec">' + equipTag(sw.selEquip) + '<div><div class="swap-rec-v">推荐 ' + esc(sw.recText) + (sw.recUnit === '自重' ? '' : ' ' + esc(sw.recUnit)) + '</div><div class="swap-rec-n">' + esc(sw.recNote) + '</div></div></div>';
      if (sw.scope === 'perm' && !sw.editing && sw.selEquip !== '自重') h += '<div class="list"><div class="cell"><span class="flex1">起始重量</span><input class="cell-in num" inputmode="decimal" data-act="swapw" value="' + esc(sw.weight) + '"><span class="unit">' + esc(sw.recUnit) + '</span></div></div>';
      h += '<div class="sec-f">' + (sw.scope === 'once' || sw.editing
        ? '本次用推荐重量练「' + esc(sw.sel) + '」，记录容量，不改变「' + esc(sw.planName) + '」的阶段和重量。'
        : '从第 ' + sw.week + ' 周起，这个位置改为「' + esc(sw.sel) + '」，仍按「' + esc(sw.category.label) + '」进阶；历史记录保持不变。' + (sw.rotates ? '下一轮仍按轮换计划自动编排（可在设置里锁定这个位置）。' : '')) + '</div>' +
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
    el.innerHTML = '<div class="rest-live" style="bottom:' + Math.round(bottom) + 'px">' +
      '<div class="rl-top"><span class="rl-name">' + esc(rest.name) + ' · 组间休息</span><span class="rl-time num">' + fmtSec(rest.left) + '</span></div>' +
      '<div class="rl-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="rl-btns"><div class="rl-b" data-rest-adj="-30">−30s</div><div class="rl-b main" data-rest-stop="1">跳过休息</div><div class="rl-b" data-rest-adj="30">+30s</div></div></div>';
  }

  // ================= 计划 =================
  function renderPlan() {
    var p = S.plan;
    if (p.view === 'lib') return renderPlanLib();
    if (p.view === 'browse') return renderPlanBrowse();
    var db = load(), cur = GZ.activeProgram(db), vm = GZ.buildPlan(db, { cycle: p.cycle }), h = '';
    var live = !cur || cur.status === 'active', holding = cur && cur.status === 'paused';
    h += '<div class="lib-back" data-act="overviewback">‹ 训练</div><div class="pg-title">计划总览</div>';
    h += planStatusCard(cur);
    if (live) {
      h += '<div class="card next-card"><div class="row"><div class="flex1"><span class="cap">下一次训练</span><div class="next-t"><span class="num accent">' + vm.next.day + '</span> ' + vm.next.name + '</div>' +
        '<span class="cap">' + vm.next.weekText + (vm.next.deload ? ' · 减载周' : '') + '</span></div><div class="go-btn" data-act="go" data-day="' + vm.next.day + '">去训练</div></div>' +
        '<div class="prog"><div class="row between"><span class="cap">本轮进度（' + vm.weeksPerCycle + ' 周 / 轮）</span><span class="cap"><span class="num strong">' + vm.cycleDone + '</span> / ' + vm.cyclePlanned + ' 次 · ' + vm.cycleProgress + '%</span></div>' +
        '<div class="bar"><div class="bar-in" style="width:' + vm.cycleProgress + '%"></div></div><span class="cap total-cap">累计已完成 ' + vm.done + ' 次训练</span></div></div>';
    } else {
      h += '<div class="card hold-card"><div class="hold-t">' + (holding ? '已暂停' : '已结束') + '</div><div class="hold-s">' + (holding ? '训练进度停在这里。要继续或结束，请到工具里的计划库打开这套计划。' : '这套计划已结束，下面是当时的记录。') + '</div></div>';
    }
    var wide = vm.days.length > 4;
    h += '<div class="card"><div class="card-title"><div class="cyc-nav"><span class="cyc-btn ' + (vm.canPrev ? '' : 'off') + '" data-act="cycle" data-d="-1">‹</span>' +
      '<span class="t cyc-label">' + vm.cycleText + (vm.isFuture ? ' · 预览' : vm.isCurCycle ? ' · 进行中' : '') + '</span>' +
      '<span class="cyc-btn ' + (vm.canNext ? '' : 'off') + '" data-act="cycle" data-d="1">›</span></div><span class="s">' + (db.params.progression === 'w531' ? '顶组 kg' : (vm.mainLabel || '主项') + ' 重量 kg') + '</span></div><div class="grid-head' + (wide ? ' wide' : '') + '"><span class="gw"></span>' +
      vm.days.map(function (d) { return '<span class="gh num">' + d.id + '</span>'; }).join('') + '</div>';
    vm.rows.forEach(function (row) {
      h += '<div class="grid-row' + (wide ? ' wide' : '') + '"><div class="gw"><span class="num">W' + row.wc + '</span>' + (row.deload ? '<span class="dltag">减载</span>' : '') + '</div>' +
        row.cells.map(function (c) {
          return '<div class="gcell ' + c.status + '" data-act="cell" data-day="' + c.day + '" data-status="' + c.status + '" data-id="' + (c.recordId || '') + '"><span class="cw num">' + c.w + '</span>' +
            (c.status === 'done' ? '<div class="cdot" style="background:' + c.color + '"></div>' : '') + '</div>';
        }).join('') + '</div>';
    });
    h += '<div class="legend"><div class="lg"><div class="sw" style="background:#FF6B1A"></div>已完成 · 圆点为判定</div><div class="lg"><div class="sw" style="box-shadow:inset 0 0 0 2px #FF6B1A"></div>下一次</div><div class="lg"><div class="sw" style="background:#E5E5EA"></div>每次加重的推演</div></div></div>';
    var ov = vm.overview[p.ov];
    h += '<div class="card"><div class="card-title"><span class="t">当前状态</span><span class="s">点动作看趋势</span></div>' +
      seg(vm.overview.map(function (o) { return { html: '<span class="num">' + o.day + '</span>' }; }), p.ov, 'ov') +
      ov.slots.map(function (s) {
        return '<div class="ov-row tap" data-act="exopen" data-name="' + esc(s.name) + '" role="button" aria-label="查看' + esc(s.name) + '的数据趋势">' +
          tier(s.tier, s.badge) +
          '<div class="ov-main"><span class="ovn">' + esc(s.name) + '</span><span class="ov-sub">' + s.stage + (s.fail > 0 ? '<span class="amber"> · 预警 ' + s.fail + '</span>' : '') + '</span></div>' +
          '<div class="ov-right"><span class="num ov-w">' + s.weight + (s.isCardio ? '' : '<span class="ov-u"> kg</span>') + '</span><span class="ov-last"><span style="color:' + s.lastColor + '">' + s.last + '</span>' + (s.gain ? '<span class="green"> ' + s.gain + '</span>' : '') + '</span></div>' +
          '<span class="chev">›</span></div>';
      }).join('') + '</div>';
    if (p.detail) {
      var d = p.detail;
      h += '<div class="mask" data-act="closeDetail"><div class="sheet" data-stop="1"><div class="grabber"></div><span class="sheet-cap">' + d.dateText + ' · ' + d.weekText + ' · 容量 ' + d.vol + ' kg</span><div class="sheet-title">' + d.day + ' ' + d.dayName + '</div>' +
        sessionRows(d.items) +
        (d.note ? '<div class="note-box">' + esc(d.note) + '</div>' : '') +
        '<div class="sheet-btns"><div class="btn-ghost" data-act="shareopen" data-id="' + d.id + '">分享这次</div><div class="btn-ghost" data-act="edit" data-id="' + d.id + '">修改这次</div><div class="btn-ghost solid" data-act="closeDetail">完成</div></div></div></div>';
    }
    if (S.stats.ex) h += renderExerciseSheet();
    return h;
  }
  // ============ 计划页：单个位置的动作面板（调整重量 / 更换动作 / 锁定轮换） ============
  function slotState(dayId, slotId) {
    var info = GZ.slotInfo(load(), dayId, slotId);
    if (!info) return null;
    return { day: dayId, slot: slotId, info: info, mode: 'info', w: String(info.weight), q: '', fit: 'plan' };
  }
  function renderSlotSheet() {
    var sl = S.plan.slot; if (!sl) return '';
    var info = sl.info, h = '', pick = sl.mode === 'pick';
    h += '<div class="mask" data-act="slotclose"><div class="sheet slot-sheet" data-stop="1"><div class="grabber"></div>' +
      '<div class="row between"><span class="sheet-cap">' + info.dayId + ' · ' + esc(info.dayName) + '</span><span class="link" data-act="slotclose">关闭</span></div>' +
      '<div class="slot-head">' + (info.category ? '<span class="tier">' + esc(info.category.label) + '</span>' : tier(info.tier, info.badge)) + '<span class="slot-name">' + esc(pick ? '更换动作 · 当前 ' + info.name : info.name) + '</span>' + (pick ? '' : equipTag(info.equip)) + '</div>';
    if (pick) {
      var cat = info.category;
      h += '<div class="search"><span class="search-ic">⌕</span><input class="search-in" data-act="slotq" value="' + esc(sl.q) + '" placeholder="搜索动作、部位或器械"></div>' +
        (cat && !cat.locked ? seg(fitChoices(cat).map(function (x) { x.on = x.data.indexOf('"' + (sl.fit || 'plan') + '"') >= 0; return x; }), -1, 'slotfit') : '') +
        '<div class="sec-f">' + esc(cat && cat.hint ? cat.hint : '') + '选中后从现在' + info.when + '这次开始用新动作。原动作的历史记录不受影响。</div>' +
        '<div class="lib-list"><div class="list">' + libRows(GZ.buildLibrary(load(), { category: cat, fit: sl.fit || 'plan', q: sl.q, current: info.name }), { pick: true, empty: '没有找到' }) + '</div></div>';
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
    if (info.category && !info.category.locked) {
      h += '<div class="list"><div class="cell tap" data-act="slotpick"><span class="flex1">更换动作</span><span class="val">' +
        esc(info.rotTier && info.nextName ? '第 ' + info.nextCycle + ' 轮换成 ' + info.nextName : info.category.label) + '</span><span class="chev">›</span></div>' +
        (info.rotTier ? '<div class="cell"><span class="flex1">锁定，不参与自动轮换</span><label class="ios-sw green"><input type="checkbox" data-act="slotlock" ' + (info.locked ? 'checked' : '') + '><i></i></label></div>' : '') +
        '</div>' +
        '<div class="sec-f">' + esc(info.why || info.category.hint) + (info.rotTier ? '。锁定后这个位置每轮都用同一个动作，除非你手动更换。' : '') + '</div>';
    } else {
      h += '<div class="sec-f">' + esc(info.category ? info.category.label : '主项') + '固定在本训练日，不参与轮换，训练时可以临时替换。</div>';
    }
    var changed = Math.abs((Number(sl.w) || 0) - info.weight) > 0.01;
    h += '<button class="btn-primary slot-ok" data-act="slotsw">' + (changed ? '改成 ' + (Number(sl.w) || 0) + (info.canAdjust ? ' ' + esc(info.unitText) : '') : '完成') + '</button>';
    return h + '</div></div>';
  }
  function stPill(status) {
    var cls = status === 'active' ? 'st-active' : status === 'paused' ? 'st-paused' : status === 'ended' ? 'st-ended' : 'st-new';
    var text = status === 'active' ? '进行中' : status === 'paused' ? '已暂停' : status === 'ended' ? '已结束' : '未开始';
    return '<span class="st-pill ' + cls + '">' + text + '</span>';
  }
  function openInstance(db, tpl) {
    var key = GZ.templateKey(tpl), list = GZ.programList(db).filter(function (p) { return GZ.templateKey(p.template) === key && p.status !== 'ended'; });
    return list[0] || null;
  }
  function planStatusCard(cur) {
    if (!cur) return '';
    return '<div class="card"><div class="row between"><div class="prog-name">' + esc(cur.name) + '</div>' + stPill(cur.status) + '</div></div>';
  }
  var FOCUS_LABEL = { strength: '力量', physique: '形体', function: '功能', fat_loss: '减脂' };
  var LEAN_LABEL = { male: '偏推拉', female: '偏臀腿' };
  function tplTags(c) {
    var bits = [];
    if (c.focus && FOCUS_LABEL[c.focus]) bits.push(FOCUS_LABEL[c.focus]);
    if (c.lean && LEAN_LABEL[c.lean]) bits.push(LEAN_LABEL[c.lean]);
    if (!bits.length) return '';
    return '<div class="tpl-tags">' + bits.map(function (t) { return '<span class="tpl-tag">' + esc(t) + '</span>'; }).join('') + '</div>';
  }
  function planCard(db, c) {
    var inst = openInstance(db, c.id);
    var ended = !inst && GZ.programList(db).some(function (p) { return GZ.templateKey(p.template) === c.id && p.status === 'ended'; });
    return '<div class="card lib-card tap" data-act="browse" data-id="' + c.id + '"><div class="row between"><span class="tpl-name">' + esc(c.name) + '</span>' + stPill(inst ? inst.status : (ended ? 'ended' : '')) + '</div>' +
      '<div class="tpl-days">' + esc(c.days) + (inst && inst.sessions ? ' · 已练 ' + inst.sessions + ' 次' : '') + '</div>' + tplTags(c) +
      '<div class="tpl-blurb">' + esc(c.blurb) + '</div><div class="lib-more">查看安排 <span class="chev">›</span></div></div>';
  }
  function renderPlanLib() {
    return '<div class="lib-back" data-act="libback">‹ 工具</div><div class="pg-title">计划库</div>' + renderPlanLibBody();
  }
  function renderPlanLibBody() {
    var db = load(), h = '';
    h += '<div class="sec-f lib-lead">按训练目标分组。点进任意一套就能看每天练什么，没开始也能看。</div>';
    var goal = db.onboarding && db.onboarding.direction ? db.onboarding.direction.goal : '';
    var order = GZ.ONBOARD_GOAL.slice().sort(function (a, b) {
      if (a.id === goal) return -1;
      if (b.id === goal) return 1;
      return 0;
    });
    var cats = GZ.templateCatalog();
    var ranked = GZ.recommendTemplates(db), rank = {};
    ranked.forEach(function (c, i) { rank[c.id] = i; });
    order.forEach(function (g) {
      var items = cats.filter(function (c) { return (c.goals || []).indexOf(g.id) >= 0; });
      if (!items.length) return;
      if (g.id === goal) items.sort(function (a, b) { return (rank[a.id] === undefined ? 99 : rank[a.id]) - (rank[b.id] === undefined ? 99 : rank[b.id]); });
      h += '<div class="sec-h">' + esc(g.label) + (g.id === goal ? ' · 符合你的目标' : '') + '</div>';
      items.forEach(function (c) { h += planCard(db, c); });
    });
    return h;
  }
  function renderPlanBrowse() {
    var db = load(), prev = GZ.templatePreview(db, S.plan.tpl);
    if (!prev) return '<div class="lib-back" data-act="libback">‹ 计划库</div><div class="pg-title">计划详情</div>';
    var inst = openInstance(db, prev.id);
    var h = '<div class="lib-back" data-act="backlib">‹ 计划库</div><div class="pg-title">' + esc(prev.name) + '</div>';
    h += '<div class="card"><div class="row between"><span class="tpl-days">' + esc(prev.daysLabel) + '</span>' + stPill(inst ? inst.status : '') + '</div><div class="tpl-blurb">' + esc(prev.blurb) + '</div>';
    if (inst) h += '<div class="hold-s">这套' + (inst.status === 'active' ? '正在进行' : '已暂停') + (inst.sessions ? '，已练 ' + inst.sessions + ' 次' : '') + '。</div>';
    h += '<div class="plan-ops">' + browseOps(inst, prev.id) + '</div></div>';
    h += planCycleCard(db, prev.id, prev.days.length);
    prev.days.forEach(function (d) {
      h += '<div class="card"><div class="card-title"><span class="t"><span class="num">' + esc(d.id) + '</span> ' + esc(d.name) + '</span></div>';
      d.slots.forEach(function (s) {
        h += '<div class="ov-row">' + tier(s.tier, s.badge) + '<div class="ov-main"><span class="ovn">' + esc(s.name) + '</span><span class="ov-sub">' + esc(s.text) + '</span></div>' +
          '<div class="ov-right"><span class="num ov-w">' + esc(s.weight) + '</span></div></div>';
      });
      h += '</div>';
    });
    h += '<div class="sec-f">起始重量按现在的 1RM 估算。开始之后，这套计划才会计入训练记录。</div>';
    return h;
  }
  // ================= 工具：计划库 + 以后的计算器 =================
  function renderTools() {
    var p = S.plan;
    if (p.view === 'browse') return renderPlanBrowse();
    var h = '<div class="sec-h" style="padding-top:6px">计划库</div>';
    h += renderPlanLibBody();
    h += '<div class="sec-h">计算器</div><div class="list">' +
      '<div class="cell"><span class="flex1">1RM 计算</span><span class="val">即将推出</span></div>' +
      '<div class="cell"><span class="flex1">BMI 计算</span><span class="val">即将推出</span></div></div>' +
      '<div class="sec-f">以后常用的健身小工具会放在这里，算完只看结果，不会改动你的计划和记录。</div>';
    return h;
  }
  function toolsAct(act, ds, el) { return planAct(act, ds, el); }
  function cycleSource(db, tpl) {
    var inst = openInstance(db, tpl);
    if (inst && inst.active) return db.params;
    if (inst) {
      var raw = GZ.programById(db, inst.id);
      if (raw && raw.snap && raw.snap.params) return raw.snap.params;
    }
    var def = GZ.templateDef(db, tpl);
    return Object.assign({}, GZ.defaultParams(), (def && def.params) || {}, (S.plan.tune || {})[tpl] || {});
  }
  function writePlanCycle(tpl, fn, tip) {
    var db = load(), inst = openInstance(db, tpl);
    var prog = (inst && inst.progression) || ((GZ.templateDef(db, tpl) || {}).progression) || 'gzclp';
    if (inst && inst.active) { fn(db.params, prog); save(db); toast(tip || '已更新，数据已重算'); return true; }
    if (inst) {
      var raw = GZ.programById(db, inst.id);
      if (!raw || !raw.snap || !raw.snap.params) return false;
      fn(raw.snap.params, prog); save(db); toast(tip || '已更新这套计划'); return true;
    }
    var next = Object.assign({}, cycleSource(db, tpl));
    fn(next, prog);
    S.plan.tune = S.plan.tune || {};
    S.plan.tune[tpl] = { weeksPerCycle: next.weeksPerCycle, totalWeeks: next.totalWeeks, deloadEnabled: next.deloadEnabled, deloadEvery: next.deloadEvery, autoRotate: next.autoRotate };
    toast('开始这套计划时会用这些设置'); return true;
  }
  function planCycleCard(db, tpl, dayCount) {
    var P = cycleSource(db, tpl), inst = openInstance(db, tpl);
    var prog = (inst && inst.progression) || ((GZ.templateDef(db, tpl) || {}).progression) || 'gzclp';
    var gz = prog === 'gzclp', wave = prog === 'w531', weeks = P.weeksPerCycle || P.totalWeeks || 8;
    var inp = function (k, v, unit) { return '<input class="f-in num" inputmode="numeric" data-act="plannum" data-id="' + tpl + '" data-k="' + k + '" value="' + v + '"><span class="f-u">' + unit + '</span>'; };
    var h = '<div class="sec-h">这套计划的周期</div><div class="list"><div class="cell"><span class="flex1">每轮周数</span>' + inp('len', weeks, '周 / 轮') + '</div>';
    if (wave) h += '<div class="cell"><span class="flex1">计划总周数</span>' + inp('span', P.totalWeeks || weeks, '周') + '</div>';
    if (gz) {
      h += '<div class="cell"><span class="flex1">减载周</span><label class="ios-sw green"><input type="checkbox" data-act="plandel" data-id="' + tpl + '" ' + (P.deloadEnabled ? 'checked' : '') + '><i></i></label></div>';
      if (P.deloadEnabled) h += '<div class="cell"><span class="flex1">每轮第</span>' + inp('every', P.deloadEvery || 6, '周减载') + '</div>';
      h += '<div class="cell"><span class="flex1">每轮自动轮换 T2/T3</span><label class="ios-sw green"><input type="checkbox" data-act="planrot" data-id="' + tpl + '" ' + (P.autoRotate !== false ? 'checked' : '') + '><i></i></label></div>';
    }
    h += '</div><div class="sec-f">';
    if (gz) h += (P.autoRotate !== false ? '每进入新一轮，T2/T3 会在同一模式里换成上一轮没练过的，T1 不变。' : '') + '完成一轮（' + weeks + ' 周 × ' + dayCount + ' 日）后进入下一轮。' + (P.deloadEnabled ? '每轮第 ' + (P.deloadEvery || 6) + ' 周减载：T1 −50%、T2 −40%、T3 少 1 组。' : '这套计划目前不安排减载周。');
    else if (wave) h += '5/3/1 每 ' + weeks + ' 周一个波浪，第 4 周本身就是减载。计划总长度 ' + (P.totalWeeks || weeks) + ' 周。';
    else h += '这套计划每 ' + weeks + ' 周一轮，按自己的进阶加重，不使用 GZCLP 的减载周和动作轮换。';
    return h + '</div>';
  }
  function browseOps(inst, tpl) {
    if (!inst) return '<div class="btn-ghost solid" data-act="starttpl" data-id="' + tpl + '">开始</div>';
    if (inst.status === 'active') return '<div class="btn-ghost" data-act="pausecur">暂停</div><div class="btn-ghost op-end" data-act="endcur">结束</div>';
    return '<div class="btn-ghost solid" data-act="resumetpl" data-id="' + inst.id + '">继续</div><div class="btn-ghost op-end" data-act="endtpl" data-id="' + inst.id + '">结束</div>';
  }
  function goTrain(day) {
    if (!GZ.canTrain(load())) { toast('这套计划现在不能训练'); return false; }
    var t = S.train;
    if (!t.recordId && day && day !== t.day) { rememberTrain(); takeTrainDay(day); }
    S.tab = 'train'; return true;
  }
  function resetTrain() {
    var t = S.train;
    t.recordId = null; t.day = null; t.draft = null; t.deload = undefined; t.date = GZ.today(); t.bw = ''; t.note = ''; t.focus = null; t.result = null; t.focusKey = '';
    clearTrainDays();
    S.plan.cycle = 0; S.plan.ov = 0; S.plan.slot = null; S.plan.detail = null;
  }
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
    if (act === 'go') { if (!goTrain(ds.day)) return false; return true; }
    if (act === 'exopen') { closeSheets(); S.stats.ex = ds.name; return true; }
    if (act === 'exclose') { S.stats.ex = null; return true; }
    if (act === 'overviewback') { S.tab = 'train'; p.from = ''; p.slot = null; p.detail = null; S.stats.ex = null; render(); return false; }
    if (act === 'openlib') { p.view = 'lib'; return true; }
    if (act === 'libback') { p.view = ''; if (S.tab === 'plan') { S.tab = 'tools'; } return true; }
    if (act === 'backlib') { p.view = 'lib'; return true; }
    if (act === 'browse') { p.tpl = ds.id; p.view = 'browse'; return true; }
    if (act === 'plannum') {
      var n = parseInt(el.value, 10);
      if (!n || n < 1 || n > 52) { toast('请填 1 到 52 周'); return true; }
      return writePlanCycle(ds.id || p.tpl, function (params, prog) {
        if (ds.k === 'span') params.totalWeeks = n;
        else if (ds.k === 'every') params.deloadEvery = Math.min(n, params.weeksPerCycle || params.totalWeeks || n);
        else { params.weeksPerCycle = n; if (prog !== 'w531') params.totalWeeks = n; }
      });
    }
    if (act === 'plandel') return writePlanCycle(ds.id || p.tpl, function (params) { params.deloadEnabled = !!el.checked; });
    if (act === 'planrot') return writePlanCycle(ds.id || p.tpl, function (params) { params.autoRotate = !!el.checked; }, el.checked ? '已开启：每轮自动轮换 T2/T3' : '已关闭自动轮换');
    if (act === 'pausecur') {
      var cur = GZ.activeProgram(load());
      if (!cur || cur.status !== 'active') return false;
      confirmBox('暂停「' + cur.name + '」？', '暂停后不能记新的训练。进度和记录都保留，可以随时继续。', function () {
        var dbn = load();
        try { GZ.pauseProgram(dbn); } catch (err) { toast(err.message || '无法暂停'); return; }
        save(dbn); resetTrain(); toast('已暂停'); render();
      });
      return false;
    }
    if (act === 'resumecur' || act === 'resumetpl') {
      var pid = act === 'resumetpl' ? ds.id : GZ.activePid(load());
      var target = GZ.programList(load()).filter(function (x) { return x.id === pid; })[0];
      if (!target) return false;
      var other = GZ.activeProgram(load());
      var extra = other && other.id !== target.id && other.status === 'active' ? '当前的「' + other.name + '」会暂停。' : '';
      confirmBox('继续「' + target.name + '」？', '继续后可以记新的训练。' + extra, function () {
        var dbr = load();
        try { GZ.resumeProgram(dbr, pid); } catch (err) { toast(err.message || '无法继续'); return; }
        save(dbr); resetTrain(); S.plan.view = ''; toast('已继续'); render();
      });
      return false;
    }
    if (act === 'endcur' || act === 'endtpl') {
      var eid = act === 'endtpl' ? ds.id : GZ.activePid(load());
      var ep = GZ.programList(load()).filter(function (x) { return x.id === eid; })[0];
      if (!ep || ep.status === 'ended') return false;
      confirmBox('结束「' + ep.name + '」？', '结束后不能再练这套，也不能恢复。记录仍可在数据里查看。', function () {
        var dbe = load();
        try { GZ.endProgram(dbe, eid); } catch (err) { toast(err.message || '无法结束'); return; }
        save(dbe); resetTrain(); toast('已结束'); render();
      });
      return false;
    }
    if (act === 'starttpl') {
      var cat = GZ.templateCatalog().filter(function (x) { return x.id === ds.id; })[0];
      if (!cat) return false;
      var curp = GZ.activeProgram(load());
      var note = curp && curp.status !== 'ended' ? '当前的「' + curp.name + '」会暂停，记录都保留。' : '起始重量按现在的 1RM 计算。';
      confirmBox('开始「' + cat.name + '」？', note, function () {
        var dbn = load(), def = GZ.templateDef(dbn, ds.id);
        if (!def) { toast('没有这套计划'); return; }
        var tune = (S.plan.tune || {})[ds.id];
        if (tune) def.params = Object.assign({}, def.params, tune);
        GZ.startProgram(dbn, def); save(dbn); if (S.plan.tune) delete S.plan.tune[ds.id]; resetTrain(); S.plan.view = ''; S.plan.from = 'train'; S.tab = 'plan'; toast('已开始 ' + def.name); render();
      });
      return false;
    }
    if (act === 'cell') {
      if (ds.status === 'done') { p.detail = GZ.buildReview(load()).logs.filter(function (l) { return l.id === ds.id; })[0]; return true; }
      if (ds.status === 'next' || ds.status === 'ready') { if (!goTrain(ds.day)) return false; return true; }
      toast('推演值：假设每次都加重'); return false;
    }
    if (act === 'slotsheet') { p.slot = slotState(ds.day, ds.slot); return true; }
    if (act === 'slotclose') { p.slot = null; return true; }
    if (act === 'slotpick') {
      if (p.slot.info.category && p.slot.info.category.locked) { toast(p.slot.info.category.label + '只能在训练时临时替换'); return false; }
      p.slot.mode = 'pick'; p.slot.q = ''; p.slot.fit = 'plan'; return true;
    }
    if (act === 'slotfit') { p.slot.fit = ds.f; return true; }
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
  function renderStats(skipBar) {
    var s = GZ.buildStats(viewDb()), st = S.stats, k = s.kpi, cur = s.e1rm[st.lift], h = skipBar ? '' : planBar();
    S._stats = s;
    h += '<div class="kpis"><div class="kpi"><span class="k-l">训练次数</span><div><span class="num kv">' + k.sessions + '</span><span class="ku">/ ' + k.planned + '</span></div><div class="kbar"><div class="kin" style="width:' + k.progress + '%"></div></div></div>' +
      '<div class="kpi"><span class="k-l">累计容量</span><span class="num kv">' + k.volume + '</span><span class="ks">' + k.reps + ' 次</span></div>' +
      '<div class="kpi"><span class="k-l">加重</span><div><span class="num kv accent">' + k.adds + '</span><span class="ku">次</span></div><span class="ks">预警 ' + k.warns + '</span></div>' +
      '<div class="kpi"><span class="k-l">' + GZ.tierLabel(GZ.progressionOf(viewDb()).id, 'T1') + ' 达标率</span>' + (k.t1Rate === null ? '<span class="kv-na">暂无</span>' : '<span class="num kv">' + k.t1Rate + '%</span>') + '<span class="ks">' + GZ.tierLabel(GZ.progressionOf(viewDb()).id, 'T2') + ' 完成 ' + (k.t2Rate === null ? '暂无' : k.t2Rate + '%') + '</span></div></div>';
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
    h += (cur && cur.n >= 2 ? '<div class="legend"><div class="lg"><div class="sw" style="background:#FF6B1A"></div>e1RM</div><div class="lg"><div class="sw dash" style="border-color:#0A84FF"></div>回归趋势</div><div class="lg"><div class="sw dash" style="border-color:#C7C7CC"></div>录入 1RM</div></div>' : '') +
      (cur ? '<button class="ex-link" data-act="exopen" data-name="' + esc(cur.name) + '">查看「' + esc(cur.name) + '」的完整详情 ›</button>' : '') + '</div>';
    var wt = s.weightTrend[st.day];
    h += '<div class="card"><div class="card-title"><span class="t">重量走势</span><span class="s">空心点为下次计划</span></div>' +
      seg(s.weightTrend.map(function (d) { return { html: '<span class="num">' + d.day + '</span>' }; }), st.day, 'wday') +
      '<canvas id="c_w" class="cv"></canvas><div class="legend">' + wt.cols.map(function (c, i) { return '<div class="lg"><div class="sw" style="background:' + Chart.PALETTE[i] + '"></div>' + c.name + '</div>'; }).join('') + '</div></div>';
    h += '<div class="card"><div class="card-title"><span class="t">每周容量</span><span class="s">重量 × 组 × 次</span></div><canvas id="c_v" class="cv"></canvas><div class="legend">' +
      s.volume.stacks.map(function (x) { return '<div class="lg"><div class="sw" style="background:' + x.color + '"></div>' + x.name + '</div>'; }).join('') + '</div></div>';
    h += '<div class="card"><div class="card-title"><span class="t">判定分布</span><span class="s">全部训练日</span></div><div class="row"><canvas id="c_p" class="cv-sq"></canvas><div class="pie-list">' +
      (s.pie.length ? s.pie.map(function (x) { return '<div class="pl"><div class="sw" style="background:' + x.color + '"></div><span class="pl-l">' + x.label + '</span><span class="num pl-v">' + x.value + '</span><span class="pl-p num">' + x.pct + '%</span></div>'; }).join('') : '<div class="cap">暂无判定</div>') + '</div></div></div>';
    h += '<div class="sec-h">动作 · 最高重量</div><div class="list">' +
      (s.prs.length ? s.prs.map(function (x) { return '<div class="cell pr tap" data-act="exopen" data-name="' + esc(x.name) + '" role="button" aria-label="查看' + esc(x.name) + '的详情">' + tier(x.tier, x.badge) + '<div class="pr-main"><span>' + x.name + '</span><span class="pr-sub">' + x.day + ' · ' + x.date + '</span></div><span class="num pr-w">' + x.w + '<span class="pr-u"> kg</span></span><span class="chev">›</span></div>'; }).join('') : '<div class="empty-tip">完成训练后显示</div>') + '</div>' +
      (s.prs.length ? '<div class="sec-f">点任意一个动作，查看它的重量曲线、容量和估算 1RM 趋势。</div>' : '');
    if (s.bw.length >= 2) h += '<div class="sec-h">体重</div><div class="card"><canvas id="c_bw" class="cv short"></canvas></div>';
    if (st.ex) h += renderExerciseSheet();
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
    if (st.ex) drawExercise();
  }
  var TIER_HEX = { T1: '#FF6B1A', T2: '#0A84FF', T3: '#8E8E93' };
  /** 数据页可切到其他计划的只读快照；计划总览始终看当前计划，和当前状态同一份数据。 */
  function exerciseDb() {
    if (S.tab === 'stats') return viewDb();
    return load();
  }
  function tierData(se, t, key) {
    var b = se.byTier && se.byTier[t];
    return (b && b[key]) || [];
  }
  function drawExercise() {
    var d = GZ.exerciseDetail(exerciseDb(), S.stats.ex), c; if (!d) return;
    var se = d.series, multi = d.tiers.length > 1, col = function (t) { return TIER_HEX[t] || '#FF6B1A'; };
    if ((c = ctxOf('c_ex_w'))) {
      var sw = multi ? d.tiers.map(function (t) { return { color: col(t), data: tierData(se, t, 'perf'), width: 2.2, connect: true }; })
        : [{ color: '#FF6B1A', data: se.perf || [], width: 2.5, fill: 'rgba(255,107,26,0.22)', connect: true }];
      Chart.line(c.ctx, c.w, c.h, { labels: se.labels || [], series: sw, emptyText: '暂无数据' });
    }
    if ((c = ctxOf('c_ex_e'))) {
      var ser = [];
      if (d.ref && d.primary === 'T1') ser.push({ color: '#C7C7CC', data: (se.labels || []).map(function () { return d.ref; }), dashed: true, width: 1, dots: false });
      if (se.reg) ser.push({ color: '#0A84FF', data: se.reg, dashed: true, width: 1.5, dots: false, connect: true });
      if (multi) d.tiers.forEach(function (t) { if (t !== d.primary) ser.push({ color: col(t), data: tierData(se, t, 'e1rm'), width: 1.4, connect: true }); });
      ser.push({ color: multi ? col(d.primary) : '#FF6B1A', data: multi ? tierData(se, d.primary, 'e1rm') : (se.e1rm || []), width: 2.5, fill: multi ? undefined : 'rgba(255,107,26,0.22)', connect: true });
      Chart.line(c.ctx, c.w, c.h, { labels: se.labels || [], series: ser, emptyText: '还没有可估算的记录' });
    }
    if ((c = ctxOf('c_ex_v'))) Chart.bars(c.ctx, c.w, c.h, { labels: se.labels || [], stacks: (d.tiers || []).map(function (t) { return { name: t, color: col(t), data: tierData(se, t, 'volume') }; }), emptyText: '暂无容量数据' });
  }
  function fmtKg(v) { return GZ.fmtW(Math.round(v * 10) / 10); }
  function renderExerciseSheet() {
    var d = GZ.exerciseDetail(exerciseDb(), S.stats.ex);
    if (!d) { S.stats.ex = null; return ''; }
    var kp = function (l, v, u, sub) { return '<div class="ex-k"><span class="ex-kl">' + l + '</span><span class="ex-kv"><b class="num">' + v + '</b>' + (u ? '<i>' + u + '</i>' : '') + '</span><span class="ex-ks">' + sub + '</span></div>'; };
    var dt = function (x) { return x.slice(5).replace('-', '月') + '日'; };
    var perfLabel = d.bw ? '次数走势' : '重量走势';
    var kpis;
    if (!d.n) {
      kpis = '<div class="ex-kpis">' +
        kp('最佳估算 1RM', '—', '', '尚未开始') +
        kp('最重训练重量', '—', '', '尚未开始') +
        kp('单次最高容量', '—', '', '尚未开始') +
        kp('已记录训练', '0', '次', '尚未开始') + '</div>';
    } else {
      var unit = d.bw ? '次' : d.unit.replace(' 单只', '').replace(' 外加', '');
      kpis = '<div class="ex-kpis">' +
        kp(d.bw ? '最近次数' : '最佳重量', d.bw ? d.points[d.points.length - 1].last !== null ? d.points[d.points.length - 1].last : d.points[d.points.length - 1].reps : fmtKg(d.bestWeight.v), d.bw ? '次' : unit, d.bw ? dt(d.lastDate) : dt(d.bestWeight.date)) +
        kp('估算 1RM', d.bestE1 ? fmtKg(d.bestE1.v) : '—', d.bestE1 ? 'kg' : '', d.bw ? '自重不估算' : d.bestE1 ? '最佳 · ' + dt(d.bestE1.date) : '暂无') +
        kp('累计容量', d.bw ? '—' : (d.volume >= 1000 ? (d.volume / 1000).toFixed(2) : d.volume), d.bw ? '' : (d.volume >= 1000 ? 't' : 'kg'), d.bw ? '自重不计 kg' : '均 ' + d.avgVolume.toLocaleString('zh-CN') + ' kg / 次') +
        kp('记录次数', d.n, '次', d.adds ? '加重 ' + d.adds + ' 次' : '首次 ' + dt(d.firstDate)) + '</div>';
    }
    var e1sec = '';
    if (!d.bw) {
      var delta = !d.n
        ? '<div class="mini"><div class="mi"><span class="num mi-v">—</span><span class="mi-l">首次至今 kg</span></div><div class="mi"><span class="num mi-v">—</span><span class="mi-l">kg / 周</span></div><div class="mi"><span class="num mi-v">—</span><span class="mi-l">R²</span></div>' + (d.ref ? '<div class="mi"><span class="num mi-v">—</span><span class="mi-l">对比录入 1RM</span></div>' : '') + '</div>'
        : (d.e1Delta === null ? '' : '<div class="mini"><div class="mi"><span class="num mi-v ' + (d.e1Delta > 0 ? 'accent' : '') + '">' + (d.e1Delta > 0 ? '+' : '') + d.e1Delta + '</span><span class="mi-l">首次至今 kg</span></div>' +
          (d.slope !== null ? '<div class="mi"><span class="num mi-v">' + (d.slope >= 0 ? '+' : '') + d.slope + '</span><span class="mi-l">kg / 周</span></div><div class="mi"><span class="num mi-v">' + d.r2 + '</span><span class="mi-l">R²</span></div>' : '<div class="mi"><span class="num mi-v">—</span><span class="mi-l">趋势需 3 次</span></div>') +
          (d.vsRef !== null ? '<div class="mi"><span class="num mi-v">' + (d.vsRef > 0 ? '+' : '') + d.vsRef + '%</span><span class="mi-l">对比录入 1RM</span></div>' : '') + '</div>');
      e1sec = '<div class="ss-sec"><div class="ss-h"><span class="ss-t">估算 1RM 趋势</span>' + (d.latestE1 ? '<span class="ex-src">' + esc(d.e1Kind) + '</span>' : '') + '</div>' +
        '<canvas id="c_ex_e" class="cv"></canvas>' +
        '<div class="legend">' + (d.tiers.length > 1 ? d.tiers.map(function (t) { var lb = (d.tierLabel && d.tierLabel[t]) || t; return '<div class="lg"><div class="sw" style="background:' + (TIER_HEX[t] || '#FF6B1A') + '"></div>' + lb + (t === d.primary ? ' · 估算以此为准' : '') + '</div>'; }).join('') : '<div class="lg"><div class="sw" style="background:#FF6B1A"></div>估算 1RM</div>') + (d.slope !== null ? '<div class="lg"><div class="sw dash" style="border-color:#0A84FF"></div>回归趋势</div>' : '') + (d.ref && d.primary === 'T1' ? '<div class="lg"><div class="sw dash" style="border-color:#C7C7CC"></div>录入 1RM</div>' : '') + '</div>' +
        delta + (d.tip ? '<p class="ss-hint">' + esc(d.tip) + '</p>' : '') + '</div>';
    } else e1sec = '<div class="ss-sec"><div class="ss-h"><span class="ss-t">估算 1RM</span></div><p class="ss-empty">' + esc(d.tip) + '</p></div>';
    var volsec = d.bw ? '' : '<div class="ss-sec"><div class="ss-h"><span class="ss-t">每次容量</span>' + (d.bestVolume ? '<span class="ex-src">最高 ' + d.bestVolume.v.toLocaleString('zh-CN') + ' kg</span>' : '') + '</div><canvas id="c_ex_v" class="cv"></canvas>' + (d.tiers.length > 1 ? '<div class="legend">' + d.tiers.map(function (t) { return '<div class="lg"><div class="sw" style="background:' + (TIER_HEX[t] || '#FF6B1A') + '"></div>' + esc((d.tierLabel && d.tierLabel[t]) || t) + '</div>'; }).join('') + '</div>' : '') + '</div>';
    var rows = d.n ? d.recent.map(function (p) {
      var main = d.bw ? (p.last !== null ? '末组 ' + p.last + ' 次' : '共 ' + p.reps + ' 次') : fmtKg(p.weight) + ' kg × ' + p.reps + ' 次';
      return '<div class="ex-row"><span class="ex-d num">' + p.md + '</span><span class="ex-m"><b>' + esc(main) + '</b><i>' + esc(p.day + ' · ' + p.stage + (p.volume ? ' · ' + Math.round(p.volume).toLocaleString('zh-CN') + ' kg' : '')) + '</i></span><span class="ex-e">' + (p.e1rm ? '<b class="num">' + fmtKg(p.e1rm) + '</b><i>1RM</i>' : '<i>—</i>') + '</span><span class="jtag" style="color:' + (GZ.JUDGE_COLORS ? GZ.JUDGE_COLORS[p.judgment] || '#8E8E93' : '#8E8E93') + '">' + esc(p.judgment) + '</span></div>';
    }).join('') : '';
    var hist = d.n
      ? '<div class="ss-sec"><div class="ss-h"><span class="ss-t">最近记录</span><span class="ex-src">共 ' + d.n + ' 次</span></div><div class="ex-rows">' + rows + '</div></div>'
      : '<div class="ss-sec"><div class="ss-h"><span class="ss-t">全部记录</span><span class="ex-src">共 0 次</span></div><p class="ss-empty">还没有训练记录。完成第一次训练后，这里会列出全部记录。</p></div>';
    return '<div class="mask share-mask" data-act="exclose"><div class="sheet share-sheet" data-stop="1">' +
      '<div class="share-head"><div class="grabber"></div><div class="share-toolbar"><span class="sheet-title ex-title">' + esc(d.name) + '</span><button class="share-close" data-act="exclose" aria-label="关闭动作详情">×</button></div>' +
      '<p class="ex-sub">' + (d.tiers || []).map(function (t) { return tier(t, (d.tierLabel && d.tierLabel[t]) || t); }).join(' ') + '<span>' + esc(d.equip) + ' · ' + esc((d.days || []).join(' / ')) + ' · ' + d.n + ' 次记录</span></p></div>' +
      '<div class="ss-body">' + kpis +
      '<div class="ss-sec"><div class="ss-h"><span class="ss-t">' + perfLabel + '</span></div><canvas id="c_ex_w" class="cv"></canvas></div>' +
      e1sec + volsec + hist +
      '<details class="quote-source ex-method"><summary>估算方法</summary><p>1RM 用 Epley 公式估算：重量 × (1 + 次数 ÷ 30)。T1 取末组 AMRAP；T2 取实际完成次数 ÷ 组数；T3 取末组次数，超过 ' + Insight.REP_CAP + ' 次按 ' + Insight.REP_CAP + ' 次计（高次数会让公式偏高，所以偏保守）。自重动作不估算。</p><p>估算值只用于看趋势，不是真实 1RM，也不会改变训练计划里的重量。</p></details>' +
      '</div></div></div>';
  }
  function statsAct(act, ds, el) {
    var va = viewAct(act, el); if (va !== null) return va;
    if (act === 'lift') { S.stats.lift = Number(ds.i); return true; }
    if (act === 'wday') { S.stats.day = Number(ds.i); return true; }
    if (act === 'exopen') { closeSheets(); S.stats.ex = ds.name; return true; }
    if (act === 'exclose') { S.stats.ex = null; return true; }
  }

  // ================= 数据：记录 / 趋势 / 小结（原回顾按分段并入） =================
  function renderCycleBento() {
    var db = viewDb(), vm = S._review || GZ.buildReview(db), bs = Share.badgeState(load());
    var w = vm.weeks && vm.weeks[0];
    var mths = Monthly.months(db);
    var month = mths.length ? Monthly.build(db, mths[0], {}) : null;
    var recent = Object.keys(bs.earned || {}).map(function (id) { return bs.earned[id]; })
      .sort(function (a, b) { return String(b.date || '') < String(a.date || '') ? -1 : 1; })
      .slice(0, 3).map(function (e) { var d = bs.byId[e.id]; return d ? d.e : ''; }).filter(Boolean);
    if (!w && !month) {
      return '<div class="bento"><div class="bento-card bento-week"><span class="bento-k"><i class="bento-dot"></i>周期回顾</span><span class="bento-empty">完成第一次训练后，周报和月报会出现在这里。</span></div></div>';
    }
    var weekLabel = w ? GZ.weekText(w.week, db.params) : '';
    var weekCard = w
      ? '<button type="button" class="bento-card bento-week" data-act="weekopen" data-week="' + w.week + '">' +
        '<span class="bento-k"><i class="bento-dot"></i>周度报告</span>' +
        '<span class="bento-hero' + (weekLabel.length > 8 ? ' sm' : '') + '">' + esc(weekLabel) + '</span>' +
        '<span class="bento-sub">' + w.sessions + ' / ' + w.total + ' 次</span>' +
        '<span class="bento-row"><span class="bento-vol num">' + esc(w.volText) + '</span>' +
        (w.dv ? '<span class="bento-chip' + (w.dvUp ? '' : ' down') + '">较上周 ' + esc(w.dv) + '</span>' : '<span class="bento-chip">本周</span>') +
        '</span></button>'
      : '';
    var monthCard = month
      ? '<button type="button" class="bento-card" data-act="monthopen" data-ym="' + month.ym + '">' +
        '<span class="bento-k"><i class="bento-dot sage"></i>月度报告</span>' +
        '<span class="bento-hero">' + esc(month.mon) + '</span>' +
        '<span class="bento-sub">' + month.days + ' 天 · ' + esc(month.volumeText) + ' t</span></button>'
      : '<div class="bento-card bento-quiet"><span class="bento-k"><i class="bento-dot sage"></i>月度报告</span><span class="bento-sub">这个月还没有训练</span></div>';
    var wallCard = '<button type="button" class="bento-card" data-act="wallopen">' +
      '<span class="bento-k"><i class="bento-dot amber"></i>里程碑徽章</span>' +
      '<span class="bento-hero">' + bs.earnedCount + '<span class="bento-unit"> / ' + bs.total + '</span></span>' +
      '<span class="bento-em">' + (recent.length ? recent.map(function (e) { return '<span aria-hidden="true">' + esc(e) + '</span>'; }).join('') : '<span class="bento-sub">继续练，徽章会亮起来</span>') + '</span></button>';
    return '<div class="bento">' + weekCard + monthCard + wallCard + '</div>';
  }
  function renderReview(part) {
    var vm = GZ.buildReview(viewDb()), r = S.review, h = '', gzReview = (viewDb().params.progression || 'gzclp') === 'gzclp';
    S._review = vm;
    if (part !== 'log') h += renderCycleBento();
    if (part === 'summary' || (!part && r.tab === 0)) {
      h += '<div class="card lt-card"><div class="card-title"><span class="t">' + GZ.tierLabel(GZ.progressionOf(viewDb()).id, 'T1') + ' 进度</span><span class="s">起始 → 下次</span></div>' +
        '<div class="lt-head"><span class="lt-c1">' + GZ.tierLabel(GZ.progressionOf(viewDb()).id, 'T1') + '</span><span class="lt-c2">最近末组</span><span class="lt-c3">下次</span><span class="lt-c4">累计</span></div>' +
        vm.liftTable.map(function (x) {
          return '<div class="lt-row"><div class="lt-c1"><span class="lt-n">' + esc(x.name) + '</span><span class="lt-s num">' + x.day + ' · ' + x.stage + (x.fail ? ' · <span class="amber">预警 ' + x.fail + '</span>' : '') + '</span></div>' +
            '<div class="lt-c2"><span class="num lt-v">' + x.last + '</span>' + (x.lastJ ? '<span class="lt-j" style="color:' + x.lastColor + '">' + x.lastJ + '</span>' : '') + '</div>' +
            '<div class="lt-c3"><span class="num lt-v">' + x.next + '</span><span class="lt-s num">起始 ' + x.start + '</span></div>' +
            '<div class="lt-c4"><span class="num lt-g ' + (x.up ? 'up' : '') + '">' + x.gain + '</span><span class="lt-s num">e1RM ' + x.best + '</span></div></div>';
        }).join('') + '</div>';
      h += '<div class="card"><div class="card-title"><span class="t">训练小结</span><span class="link" data-act="copy">复制</span></div>' +
        vm.insights.map(function (i) { return '<div class="ins"><div class="ins-ic ' + i.type + '">' + i.icon + '</div><span class="ins-t">' + esc(i.text) + '</span></div>'; }).join('') + '</div>';
      var rTitle = vm.ruleTitle || (gzReview ? 'GZCLP 规则速查' : '这套计划的进阶规则');
      h += '<div class="card"><div class="card-title rules-h" data-act="rules"><span class="t">' + esc(rTitle) + '</span><span class="link">' + (r.rules ? '收起' : '展开') + '</span></div>';
      if (r.rules) {
        var rList = vm.rules || GZ.progressionRules(viewDb().params.progression).rules;
        var gList = vm.generalRules || GZ.progressionRules(viewDb().params.progression).general;
        h += rList.map(function (g) { return '<div class="rg"><div class="rg-t">' + esc(g.title) + '</div>' + g.rows.map(function (x) { return '<div class="rr"><span class="r1 num">' + esc(x[0]) + '</span><span class="r2">' + esc(x[1]) + '</span><span class="r3">' + esc(x[2]) + '</span></div>'; }).join('') + '</div>'; }).join('') +
          gList.map(function (g) { return '<div class="gen">' + esc(g) + '</div>'; }).join('');
      } else {
        h += '<span class="cap">' + esc(vm.ruleSummary || (GZ.progressionOf(viewDb()).desc) || '') + '</span>';
      }
      h += '</div>';
    }
    if (part === 'summary' || (!part && r.tab === 1)) {
      if (!vm.weeks.length) h += '<div class="empty-tip">完成第一次训练后生成周报</div>';
      vm.weeks.forEach(function (w) {
        h += '<div class="card wk"><div class="wk-top"><div><div class="row"><span class="wk-n">第 ' + w.week + ' 周</span>' + (w.deload ? '<span class="dltag">减载</span>' : '') + '</div><div class="row dflags">' +
          w.days.map(function (d) { return '<span class="dflag num ' + (d.on ? 'on' : '') + '">' + d.id + '</span>'; }).join('') + '</div></div>' +
          '<button type="button" class="wk-share" data-act="weekopen" data-week="' + w.week + '">分享周报</button></div>' +
          '<div class="wk-k"><div class="wkk"><span class="num kv">' + w.volText + '</span><span class="ks">容量' + (w.dv ? '<span class="' + (w.dvUp ? 'dv-up' : 'dv-down') + '"> ' + w.dv + '</span>' : '') + '</span></div>' +
          '<div class="wkk"><span class="num kv">' + w.sessions + '/' + w.total + '</span><span class="ks">完成</span></div><div class="wkk"><span class="num kv accent">' + w.adds + '</span><span class="ks">加重</span></div>' +
          '<div class="wkk"><span class="num kv ' + (w.warns ? 'amber' : '') + '">' + w.warns + '</span><span class="ks">预警</span></div></div>' +
          w.t1.map(function (t) { return '<div class="t1row"><span class="num t1d">' + t.day + '</span><span class="t1n">' + t.name + '</span><span class="num t1w">' + t.w + ' kg · ' + esc(t.stage || '') + ' · 末组 ' + (t.input === null ? '—' : t.input) + '</span><span class="jtag" style="color:' + t.color + '">' + t.j + '</span></div>'; }).join('') + '</div>';
      });
    }
    if (part === 'log' || (!part && r.tab !== 0 && r.tab !== 1)) {
      if (!vm.logs.length) h += '<div class="empty-tip">暂无记录</div>';
      else {
        h += '<div class="list">';
        vm.logs.forEach(function (l) {
          var op = !!r.open[l.id];
          h += '<div class="log"><div class="cell tap" data-act="toggle" data-id="' + l.id + '"><span class="num log-day">' + l.day + '</span><div class="log-meta"><span>' + l.dayName + ' · ' + l.weekText + '</span><span class="log-d">' + l.dateText + (l.deload ? ' · 减载' : '') + (l.bw ? ' · ' + l.bw + ' kg' : '') + '</span></div>' +
            '<span class="num log-v">' + l.vol + '<span class="log-u"> kg</span></span><span class="chev">' + (op ? '⌃' : '›') + '</span></div>';
          if (op) {
            h += '<div class="log-body">' + sessionRows(l.items) +
              (l.note ? '<div class="note-box">' + esc(l.note) + '</div>' : '') +
              '<div class="log-act"><span class="btn-small" data-act="shareopen" data-id="' + l.id + '">分享这次</span>' + (viewingOther() ? '' : '<span class="btn-small danger" data-act="del" data-id="' + l.id + '">删除</span><span class="btn-small rust" data-act="edit" data-id="' + l.id + '">修改</span>') + '</div></div>';
          }
          h += '</div>';
        });
        h += '</div>';
      }
      if (!viewingOther()) h += '<div class="sec-f" style="text-align:center">修改或删除任意一次记录，之后的重量与阶段会自动重算</div>';
    }
    if (r.wall) h += renderBadgeWall();
    return h;
  }
  function renderData() {
    var h = planBar();
    h += seg([{ html: '记录' }, { html: '趋势' }, { html: '小结' }], S.data.seg, 'dseg');
    if (S.data.seg === 1) h += renderStats(true);
    else if (S.data.seg === 0) h += renderReview('log');
    else h += renderReview('summary');
    return h;
  }
  function dataAct(act, ds, el) {
    if (act === 'dseg') { S.data.seg = Number(ds.i); return true; }
    var r = statsAct(act, ds, el); if (r !== undefined) return r;
    return reviewAct(act, ds, el);
  }
  function reviewAct(act, ds, el) {
    var va = viewAct(act, el); if (va !== null) return va;
    var r = S.review;
    if (viewingOther() && (act === 'del' || act === 'edit')) { toast('这是其他计划的记录，只读'); return false; }
    if (act === 'shareopen') {
      closeSheets();
      r.share = { kind: 'day', id: ds.id, funVariant: 0, theme: 'sage', body: false, badgePick: null, badgeVariant: 0, image: null, blob: null };
      return true;
    }
    if (act === 'shareclose') { r.share = null; r.returnTo = null; return true; }
    if (act === 'weekopen') { closeSheets(); r.share = { kind: 'week', week: ds.week ? Number(ds.week) : null, funVariant: 0, theme: 'sage', body: false, image: null, blob: null }; return true; }
    if (act === 'weekpick') { if (r.share) { r.share.week = Number(el.value); r.share.funVariant = 0; } return true; }
    if (act === 'monthopen') { closeSheets(); r.share = { kind: 'month', ym: ds.ym || null, funVariant: 0, theme: 'sage', body: false, image: null, blob: null }; return true; }
    if (act === 'monthpick') { if (r.share) { r.share.ym = el.value; r.share.funVariant = 0; } return true; }
    if (act === 'wallopen') { closeSheets(); r.wall = true; return true; }
    if (act === 'wallclose') { r.wall = false; return true; }
    if (act === 'bodytoggle') { if (r.share) r.share.body = !!el.checked; return true; }
    if (act === 'badgeswap' || act === 'badgeagain') {
      if (!r.share || r.share.kind === 'week' || r.share.kind === 'month') return false;
      var curB = Share.build(viewDb(), r.share.id, r.share);
      var nCand = curB && curB.badgeCands ? curB.badgeCands.length : 0;
      if (nCand <= 1) r.share.badgePick = (curB && curB.badges && curB.badges.length) ? [] : null;
      else { r.share.badgePick = null; r.share.badgeVariant = (r.share.badgeVariant || 0) + 1; }
      return true;
    }
    if (act === 'watchgo') { r.returnTo = shareKeep(r.share); r.share = null; r.wall = false; S.stats.ex = null; S.tab = 'settings'; render(); setTimeout(function () { var x = document.getElementById('watchSec'); if (x) x.scrollIntoView({ block: 'start' }); }, 30); return false; }
    if (act === 'sharetheme') { if (r.share) r.share.theme = ds.theme; return true; }
    if (act === 'funswap' || act === 'funagain') { if (r.share) r.share.funVariant = (r.share.funVariant || 0) + 1; return true; }
    if (act === 'sharecopy') { var cd = sharePayload(r.share); if (cd) copyText(cd.caption, '配文已复制'); return false; }
    if (act === 'shareexport') { exportShareImage(false); return false; }
    if (act === 'sharesystem') { exportShareImage(true); return false; }
    if (act === 'shareprofile') { r.returnTo = shareKeep(r.share); r.share = null; r.wall = false; S.stats.ex = null; S.tab = 'settings'; render(); setTimeout(function () { var x = document.getElementById('shareProfileSec'); if (x) x.scrollIntoView({ block: 'start' }); }, 30); return false; }
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
  /** 跳去设置页（改名片、导入手表）前记住当前分享面板，回来自动恢复；日 / 周 / 月共用 */
  function shareKeep(sh) {
    return { kind: sh.kind || 'day', id: sh.id, ym: sh.ym || null, week: sh.week || null, funVariant: sh.funVariant, theme: sh.theme, body: sh.body, badgePick: sh.badgePick, badgeVariant: sh.badgeVariant, from: S.tab };
  }
  function shareRestore(b) {
    return { kind: b.kind || 'day', id: b.id, ym: b.ym || null, week: b.week || null, funVariant: b.funVariant || 0, theme: b.theme || 'sage', body: !!b.body, badgePick: b.badgePick || null, badgeVariant: b.badgeVariant || 0, image: null, blob: null };
  }
  function sharePayload(sh) {
    if (!sh) return null;
    if (sh.kind === 'month') return Monthly.build(viewDb(), sh.ym, sh);
    if (sh.kind === 'week') return Weekly.build(viewDb(), sh.week, sh);
    return Share.build(viewDb(), sh.id, sh);
  }
  function renderShareModal() {
    var sh = S.review.share;
    if (!sh) return '';
    if (!sh.kind) sh.kind = 'day';
    var data = sharePayload(sh);
    var empty = sh.kind === 'month' ? '还没有可生成月报的训练' : sh.kind === 'week' ? '还没有可生成周报的训练' : '这次没有可分享的训练';
    if (!data) return '<div class="mask share-mask" data-act="shareclose"><div class="sheet share-sheet" data-stop="1"><div class="share-head"><div class="grabber"></div><div class="share-toolbar"><span class="sheet-title">' + empty + '</span><button type="button" class="share-close" data-act="shareclose" aria-label="关闭">×</button></div></div></div></div>';
    if (sh.kind === 'day') { sh.id = data.recordId; sh.date = data.date; sh.day = data.day; }
    if (sh.kind === 'week') sh.week = data.week;
    if (sh.kind === 'month') sh.ym = data.ym;
    var title = sh.kind === 'week' ? '周度报告' : sh.kind === 'month' ? '月度报告' : '训练战报';
    var db = viewDb(), period = '';
    if (sh.kind === 'week') {
      period = '<label class="share-period">' + esc(data.weekText) + ' ▾<select data-act="weekpick" aria-label="选择训练周">' +
        data.weeks.map(function (w) { return '<option value="' + w + '"' + (w === data.week ? ' selected' : '') + '>' + esc(GZ.weekText(w, db.params)) + '</option>'; }).join('') +
        '</select></label>';
    } else if (sh.kind === 'month') {
      period = '<label class="share-period">' + esc(Monthly.ymText(data.ym)) + ' ▾<select data-act="monthpick" aria-label="选择月份">' +
        data.months.map(function (m) { return '<option value="' + m + '"' + (m === data.ym ? ' selected' : '') + '>' + esc(Monthly.ymText(m)) + '</option>'; }).join('') +
        '</select></label>';
    }
    var tip = data.hasName ? '' : '<button type="button" class="share-profile-tip" data-act="shareprofile">还没有昵称。点这里设置名片，名字会印在海报上 ›</button>';
    var themes = '<div class="share-pill-group" role="group" aria-label="卡片配色">' +
      [['sage', '鼠尾草'], ['warm', '暖杏色']].map(function (t) {
        return '<button type="button" class="' + (sh.theme === t[0] ? 'on' : '') + '" data-act="sharetheme" data-theme="' + t[0] + '" aria-pressed="' + (sh.theme === t[0] ? 'true' : 'false') + '">' + t[1] + '</button>';
      }).join('') + '</div>';
    var pills = themes + '<button type="button" class="share-pill" data-act="funswap">🎲 换一句</button>';
    if (sh.kind === 'day' && data.badgeCands && data.badgeCands.length) pills += '<button type="button" class="share-pill" data-act="badgeswap">🏅 换勋章</button>';
    var imported = !!(load().params.watch && (load().params.watch.workouts || []).length);
    var hasWatch = sh.kind === 'day' ? !!data.watchBody : !!data.watch;
    if (hasWatch) pills += '<label class="share-pill share-switch"><input type="checkbox" data-act="bodytoggle"' + (sh.body ? ' checked' : '') + ' aria-label="在海报上显示手表数据"><span>⌚ 手表数据</span></label>';
    else if (!imported) pills += '<button type="button" class="share-pill ghost" data-act="watchgo">⌚ 手表</button>';
    var artLabel = sh.kind === 'week' ? '周报图片预览' : sh.kind === 'month' ? '月报图片预览' : '训练战报图片预览';
    return '<div class="mask share-mask" data-act="shareclose"><div class="sheet share-sheet" data-stop="1">' +
      '<div class="share-head"><div class="grabber"></div>' +
        '<div class="share-toolbar"><div class="share-title-row"><span class="sheet-title">' + title + '</span>' + period + '</div>' +
        '<div class="share-tools"><button type="button" class="share-profile" data-act="shareprofile">名片 ›</button>' +
        '<button type="button" class="share-close" data-act="shareclose" aria-label="关闭分享预览">×</button></div></div></div>' +
      '<div class="ss-body">' + tip +
        '<div class="share-art-wrap"><div id="shareArtwork" class="share-art" aria-label="' + artLabel + '"><span class="share-loading">正在整理这张海报…</span></div></div>' +
        '<div class="share-pills" role="toolbar" aria-label="海报微调">' + pills + '</div></div>' +
      '<div class="share-foot"><div class="share-actions">' +
        '<button type="button" class="main" data-act="sharesystem" disabled>系统分享</button></div></div></div></div>';
  }

  // ================= 里程碑徽章墙 =================
  function fmtProg(p) {
    var v = p.v, t = p.t;
    return (Number.isInteger(v) ? v : v.toFixed(v < 10 ? 2 : 1).replace(/\.?0+$/, '')) + ' / ' + t.toLocaleString('zh-CN') + ' ' + p.u;
  }
  function renderBadgeWall() {
    var st = Share.badgeState(load());
    var WALL_ORDER = ['count', 'progress', 'strength', 'volume', 'session', 'streak', 'watch'];
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
      '<div class="ss-body">' + nearBlock + body + (hasW ? '' : '<p class="ss-hint">手表系列需要先在「我的 → 手表数据」导入快照。</p>') + '<p class="ss-hint">手表系列只统计 ' + esc(st.watchFrom ? st.watchFrom.replace(/-/g, '.') : '训练手记第一条记录') + ' 之后的数据。' + GZ.tierLabel(GZ.progressionOf(load()).id, 'T1') + '重量按工作重量统计，需完成目标（加重或保持）才算。</p></div></div></div>';
  }
  async function paintSharePreview() {
    var sh=S.review.share, box=document.getElementById('shareArtwork'); if(!sh||!box) return;
    sh.image=null; sh.blob=null;
    var generation=(sh.generation || 0)+1; sh.generation=generation;
    try {
      var kind = sh.kind || 'day';
      var data = sharePayload(sh); if(!data) return;
      if(document.fonts && document.fonts.ready) await document.fonts.ready;
      var canvas=document.createElement('canvas');
      var drawer = kind === 'month' ? Monthly.draw : kind === 'week' ? Weekly.draw : Share.draw;
      await drawer(canvas, data, sh.theme);
      var blob=await new Promise(function(resolve){canvas.toBlob(resolve,'image/png');});
      if(S.review.share!==sh || sh.generation!==generation || !box.isConnected) return;
      if(!blob) throw new Error('导出失败');
      sh.blob=blob;sh.image=canvas.toDataURL('image/png');
      var alt = data.name + ' · ' + (kind === 'month' ? data.title + ' 月报' : kind === 'week' ? data.title : data.date + ' 训练战报');
      box.innerHTML='';var img=new Image();img.src=sh.image;img.alt=alt;box.appendChild(img);
      document.querySelectorAll('[data-act="sharesystem"]').forEach(function(b){b.disabled=false;});
    } catch(e) { if(box.isConnected) box.textContent='图片生成失败，请关闭后重试。'; }
  }
  function exportShareImage(system) {
    var sh=S.review.share; if(!sh||!sh.blob) { toast('图片正在生成，请稍候');return; }
    var kind = sh.kind || 'day';
    var filename = kind === 'month' ? '月报_'+sh.ym+'.png' : kind === 'week' ? '周报_W'+sh.week+'.png' : '训练战报_'+sh.date+'_'+(sh.day||'')+'.png';
    var shareTitle = kind === 'month' ? '月报 · '+sh.ym : kind === 'week' ? '周报 · 第 '+sh.week+' 周' : '训练战报 · '+sh.date+' '+(sh.day||'');
    var file=new File([sh.blob],filename,{type:'image/png'});
    if(system && navigator.canShare && navigator.canShare({files:[file]}) && navigator.share) {
      navigator.share({files:[file],title:shareTitle}).catch(function(e){if(e.name!=='AbortError') toast('系统分享暂不可用，已改为下载图片');});return;
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

  // ================= 新用户切入：资料 → 训练方向 =================
  function obPick(list, cur, act) {
    return '<div class="ob-picks">' + list.map(function (x) {
      return '<button type="button" class="ob-pick' + (cur === x.id ? ' on' : '') + '" data-act="' + act + '" data-v="' + esc(x.id) + '"><b>' + esc(x.label) + '</b>' +
        (x.hint ? '<i>' + esc(x.hint) + '</i>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function renderOnboardProfile(db) {
    var pp = Share.profile(db.params.shareProfile), bw = db.params.bodyWeight, ready = GZ.profileReady(db);
    var av = pp.avatar
      ? '<img src="' + pp.avatar + '" alt="头像">'
      : '<span>' + esc((pp.name || '我').slice(0, 1)) + '</span>';
    return '<div class="ob-step">第 1 步 · 共 2 步</div><div class="large-title">建立档案</div>' +
      '<p class="ob-lead">头像、昵称和性别会用于你的训练名片；体重可先不填。</p>' +
      '<div class="ob-ava-wrap"><label class="ob-ava">' + av + '<input type="file" accept="image/png,image/jpeg,image/webp" data-act="obavatar"></label>' +
      '<div class="ob-ava-tip">' + (pp.avatar ? '点头像可更换' : '点此上传头像') + '</div></div>' +
      '<div class="list profile-list">' +
      '<div class="cell"><label for="obName" class="flex1">昵称</label><input id="obName" class="profile-in" data-act="obname" maxlength="18" value="' + esc(pp.name) + '" placeholder="怎么称呼你"></div>' +
      '<div class="cell col"><span class="flex1" style="margin-bottom:8px">性别</span>' +
      seg(GZ.ONBOARD_GENDER.map(function (g) { return { html: g.label, on: pp.gender === g.id, data: ' data-v="' + g.id + '"' }; }), -1, 'obgender', 'mode-seg') + '</div>' +
      '<div class="cell"><label for="obBw" class="flex1">体重 <span class="ob-opt">选填</span></label><input id="obBw" class="profile-in num" inputmode="decimal" data-act="obbw" value="' + (bw ? esc(bw) : '') + '" placeholder="kg"><span class="f-u">kg</span></div></div>' +
      '<div class="ob-foot"><button type="button" class="btn-primary" data-act="obnext"' + (ready ? '' : ' disabled') + '>下一步</button></div>';
  }
  function renderOnboardDirection(db) {
    var d = (db.onboarding && db.onboarding.direction) || {}, ready = GZ.directionReady(db);
    var forced = S.onboard.force;
    return '<div class="ob-step">' + (forced ? '训练方向' : '第 2 步 · 共 2 步') + '</div><div class="large-title">' + (forced ? '调整训练方向' : '训练方向') + '</div>' +
      '<p class="ob-lead">先记下你的目标与条件，本期只存答案；不会自动换计划。</p>' +
      '<div class="ob-lab">训练目标</div>' + obPick(GZ.ONBOARD_GOAL, d.goal, 'obgoal') +
      '<div class="ob-lab">训练经验</div>' + obPick(GZ.ONBOARD_EXPERIENCE, d.experience, 'obexp') +
      '<div class="ob-lab">每周训练天数</div>' + obPick(GZ.ONBOARD_DAYS, d.daysPerWeek, 'obdays') +
      '<div class="ob-lab">可用器械</div>' + obPick(GZ.ONBOARD_EQUIP, d.equipment, 'obequip') +
      '<div class="ob-foot sheet-btns">' +
      (forced ? '<div class="btn-ghost" data-act="obcancel">取消</div>' : '<div class="btn-ghost" data-act="obback">上一步</div>') +
      '<div class="btn-ghost solid" data-act="obdone"' + (ready ? '' : ' style="opacity:.45;pointer-events:none"') + '>' + (forced ? '保存' : '开始训练') + '</div></div>';
  }
  function renderOnboarding() {
    var db = load();
    syncOnboardStep(db);
    return S.onboard.step === 2 ? renderOnboardDirection(db) : renderOnboardProfile(db);
  }
  function setDirection(db, key, val) {
    if (!db.onboarding) db.onboarding = { profileDone: false, directionDone: false, direction: {}, completedAt: '' };
    if (!db.onboarding.direction) db.onboarding.direction = {};
    db.onboarding.direction[key] = val;
    GZ.normalize(db);
  }
  function readObBw(el) {
    var raw = (el && el.value != null ? el.value : (document.getElementById('obBw') || {}).value || '').trim();
    if (!raw) return { ok: true, v: null };
    var v = parseFloat(raw);
    if (isNaN(v) || v < 30 || v > 250) return { ok: false };
    return { ok: true, v: Math.round(v * 10) / 10 };
  }
  function onboardAct(act, ds, el) {
    switch (act) {
      case 'obavatar': uploadShareAvatar(el.files && el.files[0]); return false;
      case 'obname':
        return mutate(function (db) {
          var pp = Share.profile(db.params.shareProfile); pp.name = el.value; db.params.shareProfile = Share.profile(pp);
          if (db.onboarding) db.onboarding.profileDone = GZ.profileReady(db);
        }, false);
      case 'obgender':
        return mutate(function (db) {
          var pp = Share.profile(db.params.shareProfile); pp.gender = ds.v; db.params.shareProfile = Share.profile(pp);
          if (db.onboarding) db.onboarding.profileDone = GZ.profileReady(db);
        }, false);
      case 'obbw': return false;
      case 'obnext': {
        var bw1 = readObBw();
        if (!bw1.ok) { toast('体重请填 30–250 kg，或留空'); return false; }
        if (!GZ.profileReady(load())) { toast('请先填写头像、昵称和性别'); return false; }
        mutate(function (db) {
          if (bw1.v != null) db.params.bodyWeight = bw1.v;
          if (!db.onboarding) db.onboarding = { profileDone: false, directionDone: false, direction: {}, completedAt: '' };
          db.onboarding.profileDone = true;
          GZ.normalize(db);
        }, false);
        S.onboard.step = 2; return true;
      }
      case 'obback': S.onboard.step = 1; return true;
      case 'obcancel':
        S.onboard.force = false; S.onboard.step = 1;
        S.tab = S.onboard.returnTab || 'settings'; S.onboard.returnTab = '';
        return true;
      case 'obgoal': return mutate(function (db) { setDirection(db, 'goal', ds.v); }, false);
      case 'obexp': return mutate(function (db) { setDirection(db, 'experience', ds.v); }, false);
      case 'obdays': return mutate(function (db) { setDirection(db, 'daysPerWeek', ds.v); }, false);
      case 'obequip': return mutate(function (db) { setDirection(db, 'equipment', ds.v); }, false);
      case 'obdone': {
        if (!GZ.directionReady(load())) { toast('请选完四题'); return false; }
        var wasForce = S.onboard.force;
        mutate(function (db) {
          if (!db.onboarding) db.onboarding = { profileDone: false, directionDone: false, direction: {}, completedAt: '' };
          db.onboarding.directionDone = true;
          db.onboarding.profileDone = true;
          if (!db.onboarding.completedAt) db.onboarding.completedAt = GZ.today();
          GZ.normalize(db);
        }, wasForce ? '训练方向已保存' : '档案已建立');
        S.onboard.force = false; S.onboard.step = 1;
        S.tab = wasForce ? (S.onboard.returnTab || 'settings') : 'train';
        S.onboard.returnTab = '';
        return true;
      }
    }
  }

  // ================= 设置 =================
  function lastBackup() { return Number(localStorage.getItem(BK) || 0); }
  function renderLibrary() {
    var db = load(), st = S.settings, lib = GZ.buildLibrary(db, { catalog: true, pattern: st.pattern, part: st.part, equip: st.equip, q: st.q }), h = '';
    h += '<div class="lib-back" data-act="libback">‹ 设置</div><div class="pg-title">动作库</div>';
    h += '<div class="search"><span class="search-ic">⌕</span><input class="search-in" data-act="libq" value="' + esc(st.q) + '" placeholder="搜索动作、部位或器械"></div>';
    h += '<div class="filter-lab">动作模式</div>' + chips([{ id: '', k: 'pattern', label: '全部', on: !st.pattern }].concat(lib.patterns.map(function (x) { return { id: x.id, k: 'pattern', label: x.label, n: x.n, on: st.pattern === x.id }; })), 'libfilter');
    h += '<div class="filter-lab">部位</div>' + chips([{ id: '', k: 'part', label: '全部', on: !st.part }].concat(lib.parts.map(function (x) { return { id: x.id, k: 'part', label: x.label, n: x.n, on: st.part === x.id }; })), 'libfilter');
    h += '<div class="filter-lab">器械</div>' + chips([{ id: '', k: 'equip', label: '全部', on: !st.equip }].concat(lib.equips.map(function (x) { return { id: x.id, k: 'equip', label: x.id, n: x.n, on: st.equip === x.id }; })), 'libfilter');
    h += '<div id="libList"><div class="list">' + libRows(lib, {}) + '</div></div>';
    h += '<button class="btn-primary add-btn" data-act="libadd">添加自定义动作</button><div class="sec-f" style="text-align:center">动作不区分 T1 / T2 / T3。换动作时，按当前计划给这个位置定的分类来选。</div>';
    if (st.add) {
      var a = st.add;
      h += '<div class="mask" data-act="addclose"><div class="sheet" data-stop="1"><div class="grabber"></div><div class="sheet-title">添加动作</div><div class="list">' +
        '<div class="cell"><span class="f-l">名称</span><input class="f-v" data-act="addname" maxlength="16" value="' + esc(a.name) + '" placeholder="例如：史密斯卧推"></div>' +
        '<label class="cell tap pick-cell"><span class="f-l">部位</span><span class="f-v val">' + esc(a.part) + '</span><span class="chev">›</span><select data-act="addpart">' + GZ.PARTS.map(function (x) { return '<option ' + (x === a.part ? 'selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label>' +
        '<label class="cell tap pick-cell"><span class="f-l">器械</span><span class="f-v val">' + esc(a.equip) + '</span><span class="chev">›</span><select data-act="addequip">' + GZ.EQUIPS.map(function (x) { return '<option ' + (x === a.equip ? 'selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label>' +
        '<div class="cell"><span class="f-l">说明</span><input class="f-v" data-act="adddesc" maxlength="30" value="' + esc(a.desc) + '" placeholder="可选"></div></div>' +
        '<div class="sec-f">部位决定它在动作库里的模式。计划里的主项、变式、孤立由那个训练位置决定，不写在动作上；GZCLP 里显示为 T1、T2、T3。</div>' +
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
      '<div class="cell col"><span class="flex1" style="margin-bottom:8px">性别</span>' +
      seg(GZ.ONBOARD_GENDER.map(function (g) { return { html: g.label, on: pp.gender === g.id, data: ' data-v="' + g.id + '"' }; }), -1, 'profilegender', 'mode-seg') + '</div>' +
      '<div class="cell"><label for="profileHandle" class="flex1">社媒 ID</label><input id="profileHandle" class="profile-in" data-act="profiletext" data-k="handle" maxlength="24" value="' + esc(pp.handle) + '" placeholder="可选，如 @seven"></div>' +
      '<div class="cell"><label for="profileSignature" class="flex1">个性签名</label><input id="profileSignature" class="profile-in" data-act="profiletext" data-k="signature" maxlength="48" value="' + esc(pp.signature) + '" placeholder="可选，写给坚持训练的自己"></div>' +
      '<div class="cell"><span class="flex1">卡片公开当天体重</span><label class="ios-sw green"><input type="checkbox" data-act="profileweight" ' + (pp.showWeight ? 'checked' : '') + '><i></i></label></div></div>' +
      '<div class="sec-f">昵称、性别、ID、头像、签名会出现在名片相关能力里。体重默认隐藏；不显示训练备注、云仓库或令牌。名片随私人云同步保存。输入后离开字段自动保存。</div>';
    var wd = P.watch, wn = wd && wd.workouts ? wd.workouts.length : 0, wsn = wd && wd.sleep ? Object.keys(wd.sleep).length : 0;
    var wEdge = Badges.watchLatest ? Badges.watchLatest(wd) : null;
    h += '<div class="sec-h" id="watchSec">手表数据</div><div class="list">' +
      '<div class="cell"><span class="flex1">' + esc((wd && wd.source) || 'COROS') + '</span><span class="val">' + (wn || wsn ? esc((wEdge ? mdDate(wEdge.date) + ' · ' : '') + wn + ' 次训练 · ' + wsn + ' 晚睡眠') : '未导入') + '</span></div>' +
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
      '<div class="sec-f">手表数据只在本机和你自己的私有云仓库里，用于里程碑和分享卡片；睡眠、心率默认不会出现在图片上。开启云同步后，COROS 的力量训练和睡眠会在北京时间 7:30、13:30、19:30、22:30 写入私有仓库的 training-watch.json。立即拉取只读取这份快照，不会直接连接手表；刚练完的那次要等下一次写入之后才能拉到。分享卡片按训练日期对上快照里的力量训练。手动导入只在自动同步不可用时备用，重复导入不会重复计数。</div>';
    var isCurGz = (P.progression || 'gzclp') === 'gzclp';
    h += '<div class="sec-h">基础 1RM</div><div class="list">' +
      GZ.LIFT_ORDER.map(function (k) { return '<div class="cell"><span class="flex1">' + GZ.LIFTS[k] + '</span><span class="tm">TM ' + GZ.fmtW(GZ.tm(P, k)) + '</span>' + inp('oneRM.' + k, P.oneRM[k], 'kg') + '</div>'; }).join('') +
      '<div class="cell"><span class="flex1">TM 比例</span>' + inp('tmRatio', tmPct, '%', 'data-pct="1"') + '</div>' +
      '<div class="cell"><span class="flex1">当前体重</span>' + inp('bodyWeight', P.bodyWeight || 70, 'kg') + '</div></div>' +
      '<div class="sec-f">' + GZ.tierLabel(GZ.progressionOf(load()).id, 'T1') + '以四大项 1RM 推算；哑铃按单只、负重按外加重量、自重只记次数。训练时填写体重会自动同步这里。</div>';
    h += '\u0000adv\u0000';
    h += '<div class="sec-h">加重步幅</div><div class="list">' +
      GZ.STEP_KEYS.map(function (s) { return '<div class="cell"><span class="flex1">' + s.label + '</span>' + inp('steps.' + s.key, P.steps[s.key], 'kg') + '</div>'; }).join('') +
      (isCurGz ? '<div class="cell"><span class="flex1">T3 加重阈值</span>' + inp('t3Threshold', P.t3Threshold, '次') + '</div>' : '') +
      '<div class="cell"><span class="flex1">取整档位</span>' + inp('rounding', P.rounding, 'kg') + '</div>' +
      '<div class="cell"><span class="flex1">杠铃杆重</span>' + inp('barWeight', P.barWeight, 'kg') + '</div></div>';
    if (isCurGz) {
      h += '<div class="sec-h">判定规则</div>' + seg([{ html: '完整三阶', on: P.ruleMode === 'full', data: ' data-v="full"' }, { html: '严格按表格', on: P.ruleMode === 'excel', data: ' data-v="excel"' }], -1, 'mode', 'mode-seg') +
        (P.ruleMode === 'full' ? '<div class="list"><div class="cell"><span class="flex1">按末组次数自适应加重</span><label class="ios-sw green"><input type="checkbox" data-act="adaptsw" ' + (P.adaptive !== false ? 'checked' : '') + '><i></i></label></div></div>' : '') +
        '<div class="sec-f">' + GZ.ruleModeNote(P) + '</div>';
    } else {
      var pRules = GZ.progressionRules(P.progression);
      h += '<div class="sec-h">当前计划进阶</div><div class="list"><div class="cell"><span class="flex1">策略</span><span class="val">' + esc(pRules.name) + '</span></div></div>' +
        '<div class="sec-f">' + esc(pRules.summary) + '</div>';
    }
    h += '\u0000act\u0000';
    h += '<div class="sec-h">动作</div><div class="list"><div class="cell tap" data-act="openlib"><span class="flex1">动作库</span><span class="val">' + GZ.libAll(db).length + ' 个' +
      (db.customLib.length ? ' · 自定义 ' + db.customLib.length : '') + '</span><span class="chev">›</span></div></div>';
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
    return (parts.base || '') + (parts.sync || '') + (parts.act || '') + (parts.data || '') + advHead + (st.adv ? '<div class="adv-body">' + (parts.adv || '') + '</div>' : '') + (parts.danger || '');
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
    try { var inc = JSON.parse(txt); if (!inc || !inc.params || !inc.days) throw 0; save(GZ.replaceDb(load(), inc)); S.settings.imp = false; S.train.draft = null; S.train.day = null; clearTrainDays(); toast('恢复成功'); render(true); }
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
      case 'profilegender':
        return mutate(function (db) { var pp = Share.profile(db.params.shareProfile); pp.gender = ds.v; db.params.shareProfile = Share.profile(pp); }, '性别已保存');
      case 'profileweight': return mutate(function(db) { var pp=Share.profile(db.params.shareProfile); pp.showWeight=el.checked; db.params.shareProfile=pp; }, el.checked ? '卡片会显示已记录的当天体重' : '卡片不再公开体重');
      case 'profilenoavatar': return mutate(function(db) { var pp=Share.profile(db.params.shareProfile); pp.avatar=''; db.params.shareProfile=pp; }, '头像已移除');
      case 'profileavatar':
        uploadShareAvatar(el.files && el.files[0]); return false;
      case 'editdir':
        S.onboard.force = true; S.onboard.step = 2; S.onboard.returnTab = 'settings'; return true;
      case 'param': var v = parseFloat(el.value); if (isNaN(v) || v < 0) return true; if (ds.pct) v = v / 100; return mutate(function (db) { setPath(db.params, ds.k, v); });
      case 'mode': return mutate(function (db) { db.params.ruleMode = ds.v; }, ds.v === 'full' ? '已切换：完整三阶规则' : '已切换：严格按表格公式');
      case 'adaptsw': return mutate(function (db) { db.params.adaptive = el.checked; }, el.checked ? '已开启：按末组次数自适应加重' : '已关闭：固定步幅加重');
      case 'openlib': st.view = 'lib'; st.q = ''; render(); return false;
      case 'libback': st.view = ''; st.add = null; render(); return false;
      case 'libfilter':
        if (ds.k === 'pattern') {
          st.pattern = ds.v;
          if (ds.v && st.part && GZ.patternOfPart(st.part).id !== ds.v) st.part = '';
        } else st[ds.k] = ds.v;
        return true;
      case 'libq':
        st.q = el.value;
        var ll = document.getElementById('libList'); if (ll) ll.innerHTML = '<div class="list">' + libRows(GZ.buildLibrary(load(), { catalog: true, pattern: st.pattern, part: st.part, equip: st.equip, q: st.q }), {}) + '</div>';
        return false;
      case 'libdel':
        confirmBox('删除「' + ds.name + '」？', '已经练过的记录会保留；正在使用它的训练位置仍按原名显示。', function () { var dbd = load(); GZ.removeCustomEx(dbd, ds.name); save(dbd); render(true); });
        return false;
      case 'libadd': st.add = { name: '', desc: '', part: st.part || '上肢·水平推', equip: st.equip || '杠铃' }; return true;
      case 'addclose': st.add = null; return true;
      case 'addname': st.add.name = el.value; return false;
      case 'adddesc': st.add.desc = el.value; return false;
      case 'addpart': st.add.part = el.value; return true;
      case 'addequip': st.add.equip = el.value; return true;
      case 'adddo':
        syncAddInputs();
        var dba = load(), err = GZ.addCustomEx(dba, st.add);
        if (err) { toast(err); return false; }
        save(dba); st.pattern = GZ.patternOfPart(st.add.part).id; st.part = st.add.part; st.equip = ''; st.q = ''; st.add = null; render(); toast('已添加'); return false;
      case 'advtoggle': st.adv = !st.adv; return true;
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
      case 'clear': confirmBox('清空全部训练记录？', '参数与动作配置保留，记录无法恢复。', function () { mutate(function (db) { GZ.clearRecords(db); }, '已清空'); S.train.draft = null; S.train.day = null; clearTrainDays(); render(true); }); return false;
      case 'restore': confirmBox('恢复 Excel 默认？', '参数、动作配置与记录将恢复为表格初始状态（含第 1 周 A1/B1 记录）。', function () { save(GZ.replaceDb(load(), GZ.defaults(true))); S.train = { day: null, draft: null, recordId: null, date: GZ.today(), bw: '', note: '', result: null }; render(true); toast('已恢复'); }); return false;
    }
  }

  // ================= 框架 =================
  var RENDER = { train: renderTrain, plan: renderPlan, stats: renderData, tools: renderTools, settings: renderSettings };
  var ACT = { train: trainAct, plan: planAct, stats: dataAct, tools: toolsAct, settings: settingsAct };
  var PGCLS = { train: 'pg-train', plan: 'pg-plan', stats: 'pg-stats pg-review', tools: 'pg-tools pg-plan', settings: 'pg-settings' };
  /** 同时只留一层弹层。切 Tab、打开另一张卡之前清掉训练结算、详情、趋势、徽章墙和分享。 */
  function closeSheets() {
    S.train.result = null;
    if (S.train.swap) S.train.swap.show = false;
    if (S.plan) { S.plan.detail = null; S.plan.slot = null; }
    S.stats.ex = null;
    S.review.wall = false;
    S.review.share = null;
    S.review.returnTo = null;
  }
  function render(keepScroll) {
    var body = document.getElementById('body'), y = body.scrollTop;
    var tb = document.getElementById('tabbar');
    if (gateOnboard()) {
      syncOnboardStep(load());
      if (tb) tb.style.display = 'none';
      document.getElementById('navTitle').textContent = S.onboard.step === 2 ? '训练方向' : '建立档案';
      body.innerHTML = '<div class="pg-onboard"><div class="page">' + renderOnboarding() + '</div></div>';
      body.scrollTop = keepScroll ? y : 0;
      navState();
      return;
    }
    if (tb) tb.style.display = '';
    var title = TABS.filter(function (t) { return t.id === S.tab; })[0].title;
    var isLib = S.tab === 'settings' && S.settings.view === 'lib';
    var toolsBrowse = S.tab === 'tools' && S.plan.view === 'browse';
    document.getElementById('navTitle').textContent = isLib ? '动作库' : toolsBrowse ? '计划详情' : title;
    var bigTitle = S.tab === 'train' || S.tab === 'plan' || isLib || toolsBrowse ? '' : '<div class="pg-title">' + title + '</div>';
    var shareHtml = S.review.share ? renderShareModal() : '';
    body.innerHTML = '<div class="' + (PGCLS[S.tab] || ('pg-' + S.tab)) + '"><div class="page">' + bigTitle + RENDER[S.tab]() + '</div>' + shareHtml + '</div>';
    body.scrollTop = keepScroll ? y : 0;
    navState();
    var hl = S.tab === 'plan' ? 'train' : S.tab;
    document.querySelectorAll('.tb-item').forEach(function (el) { el.classList.toggle('on', el.dataset.tab === hl); });
    if (S.tab === 'stats') requestAnimationFrame(drawStats);
    else if (S.stats.ex) requestAnimationFrame(drawExercise);
    if (S.review.share) paintSharePreview();
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
    if (type === 'input' && ['note', 'bw', 'swapq', 'libq', 'slotq', 'obbw'].indexOf(el.dataset.act) < 0) return;
    if (type === 'change' && (el.dataset.act === 'swapq' || el.dataset.act === 'libq')) return;
    if (el.classList.contains('mask') && e.target.closest('[data-stop]')) return;
    var prevTab = S.tab;
    var actName = el.dataset.act;
    var SHARE_ACT = { shareopen: 1, shareclose: 1, sharetheme: 1, funswap: 1, funagain: 1, badgeswap: 1, badgeagain: 1, bodytoggle: 1, sharecopy: 1, shareexport: 1, sharesystem: 1, shareprofile: 1, weekopen: 1, weekpick: 1, monthopen: 1, monthpick: 1, wallopen: 1, wallclose: 1, watchgo: 1 };
    var res = (!gateOnboard() && SHARE_ACT[actName]) ? reviewAct(actName, el.dataset, el) : (gateOnboard() ? onboardAct(actName, el.dataset, el) : ACT[S.tab](actName, el.dataset, el));
    if (res) render(prevTab === S.tab && !gateOnboard());
  }
  /** 当前如果在子目录里，返回上一级要触发的动作；根页面和弹层里不响应 */
  function parentBack() {
    if (document.querySelector('.mask')) return null;
    if (gateOnboard()) {
      if (S.onboard.step !== 2) return null;
      return { act: S.onboard.force ? 'obcancel' : 'obback', onboard: true };
    }
    var back = document.querySelector('#body .lib-back');
    if (!back) return null;
    return { act: back.dataset.act, ds: back.dataset, el: back };
  }
  function runParentBack(back) {
    if (!back) return;
    if (back.onboard) { if (onboardAct(back.act, {}, null)) render(); return; }
    var prevTab = S.tab, res = ACT[S.tab](back.act, back.ds, back.el);
    if (res) render(prevTab === S.tab && !gateOnboard());
  }
  /** 从屏幕左侧右滑，跟手退出当前目录，松手超过一段距离才回到上一级 */
  function bindSwipeBack() {
    var app = document.querySelector('.app');
    if (!app) return;
    var drag = null, swallow = false;
    app.addEventListener('click', function (e) {
      if (!swallow) return;
      swallow = false; e.preventDefault(); e.stopPropagation();
    }, true);
    app.addEventListener('pointerdown', function (e) {
      if (drag || (e.button != null && e.button !== 0)) return;
      if (e.target.closest('input, textarea, select, canvas, #rest, #tabbar')) return;
      var back = parentBack(); if (!back) return;
      var edge = app.getBoundingClientRect().left;
      if (e.clientX - edge > 44) return;
      var shell = document.querySelector('#body > div');
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, back: back, shell: shell, on: false };
    });
    app.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.dx = dx; drag.dy = dy;
      if (!drag.on) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx) || dx < 10) { drag = null; return; }
        drag.on = true;
      }
      if (dx < 0) dx = 0;
      if (drag.shell) {
        drag.shell.style.transition = 'none';
        drag.shell.style.transform = 'translate3d(' + dx + 'px,0,0)';
        drag.shell.style.boxShadow = '-12px 0 28px rgba(0,0,0,.12)';
      }
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    function finish(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag; drag = null;
      if (d.on) { swallow = true; setTimeout(function () { swallow = false; }, 350); }
      var shell = d.shell, go = d.on && d.dx > 72;
      if (!shell) { if (go) runParentBack(d.back); return; }
      if (!go) {
        shell.style.transition = 'transform .22s ease';
        shell.style.transform = '';
        shell.style.boxShadow = '';
        return;
      }
      shell.style.transition = 'transform .18s ease';
      shell.style.transform = 'translate3d(100%,0,0)';
      setTimeout(function () { runParentBack(d.back); }, 170);
    }
    app.addEventListener('pointerup', finish);
    app.addEventListener('pointercancel', finish);
  }
  document.addEventListener('DOMContentLoaded', function () {
    var body = document.getElementById('body');
    body.addEventListener('click', function (e) { handle(e, 'click'); });
    body.addEventListener('change', function (e) { handle(e, 'change'); });
    body.addEventListener('input', function (e) { handle(e, 'input'); });
    body.addEventListener('scroll', navState, { passive: true });
    document.getElementById('tabbar').addEventListener('click', function (e) {
      var it = e.target.closest('.tb-item'); if (!it) return;
      if (S.tab === it.dataset.tab || (it.dataset.tab === 'train' && S.tab === 'plan')) {
        if (document.querySelector('#body .mask')) { closeSheets(); render(); }
        body.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      var prevTab = S.tab;
      var dest = it.dataset.tab;
      var back = S.review.returnTo;
      var restore = back && prevTab === 'settings' && dest === back.from ? back : null;
      closeSheets();
      S.tab = dest;
      if (restore) {
        if (dest === 'stats') S.data.seg = 2;
        S.review.share = shareRestore(restore);
      }
      render();
      if (rest.show) renderRest();
    });
    document.getElementById('rest').addEventListener('click', function (e) {
      var a = e.target.closest('[data-rest-adj]'), s = e.target.closest('[data-rest-stop]');
      if (a) { rest.left = Math.max(5, rest.left + Number(a.dataset.restAdj)); rest.total = Math.max(rest.total, rest.left); renderRest(); }
      if (s) { clearInterval(rest.timer); rest.show = false; renderRest(); }
      if (e.target.closest('[data-rest-toggle]')) { rest.open = !rest.open; renderRest(); }
    });
    document.addEventListener('visibilitychange', function () { var c = Sync.cfg(); if (document.visibilityState === 'visible' && Sync.on() && (!c.lastAt || Date.now() - c.lastAt > 30000)) Sync.run(); });
    window.addEventListener('online', function () { if (Sync.on()) Sync.run(); });
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (S.tab === 'stats') drawStats(); else if (S.stats.ex) drawExercise(); }, 120); });
    bindSwipeBack();
    render();
    if (Sync.on()) Sync.run();
  });
})();
