/* H5 版：复用 engine.js / chart.js，结构与类名与小程序 WXML 一一对应 */
(function () {
  'use strict';
  var GZ = window.GZ, Chart = window.GZChart;
  var KEY = 'gzclp_db_v1', BK = 'gzclp_last_backup';
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

  function load() { var db = null; try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) {} if (!db) { db = GZ.defaults(true); save(db); } return GZ.normalize(db); }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
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
    vm.items.forEach(function (it) {
      h += '<div class="card ex ' + (it.skip ? 'skipped' : '') + '">';
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
          return '<div class="dot ' + (d.on ? 'on ' : '') + (d.amrap ? 'amrap' : '') + '" data-act="dot" data-slot="' + it.slotId + '" data-i="' + d.i + '" data-rest="' + it.rest + '" data-name="' + esc(it.name) + '">' + (d.amrap ? '+' : d.i + 1) + '</div>';
        }).join('') + '<div class="rest-btn" data-act="rest" data-rest="' + it.rest + '" data-name="' + esc(it.name) + '">休息 ' + it.restText + '</div></div>';
        if (it.inputType === 'amrap') {
          h += '<div class="inrow"><div class="flex1"><div class="in-label">末组次数</div><div class="in-hint">' + it.amrapHint + '</div></div><div class="stepper">' +
            '<div class="st-btn" data-act="step" data-slot="' + it.slotId + '" data-d="-1">−</div><input class="st-val num" inputmode="numeric" data-act="amrap" data-slot="' + it.slotId + '" value="' + (it.value === null ? '' : it.value) + '" placeholder="—">' +
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
            (p.sub ? '<span class="v-l">不影响 ' + esc(p.origName) + ' 的进阶</span>' : p.judgment !== '减载' ? '<div class="v-next"><span class="v-l">下次</span><span class="num v-w">' + p.nextWeight + '</span><span class="v-u">kg</span>' + (p.stageChanged ? '<span class="v-stage">· ' + p.nextStage + '</span>' : '') + '</div>' : '<span class="v-l">按减载重量完成</span>') + '</div>';
        }
      }
      h += '</div>';
    });
    h += '<div class="list"><div class="cell"><span class="flex1">体重</span><input class="cell-in num" inputmode="decimal" data-act="bw" value="' + esc(t.bw) + '" placeholder="可选"><span class="unit">kg</span></div>' +
      '<div class="cell"><textarea class="note" data-act="note" rows="2" placeholder="备注：状态、睡眠、技术要点">' + esc(t.note) + '</textarea></div></div>';
    h += '<button class="btn-primary submit" data-act="submit">' + (vm.editing ? '保存修改' : '完成训练') + '<span class="btn-count num">' + vm.filled + '/' + vm.total + '</span></button>';
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
      case 'step':
        en = entry(ds.slot); vm = trainVM();
        var it = vm.items.filter(function (x) { return x.slotId === ds.slot; })[0];
        var v = en.v === null || en.v === '' || en.v === undefined ? (Number(ds.d) > 0 ? it.reps : 0) : Number(en.v) + Number(ds.d);
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
    clearInterval(rest.timer); rest.show = true; rest.left = sec; rest.total = sec; rest.name = name; renderRest();
    rest.timer = setInterval(function () {
      rest.left -= 1;
      if (rest.left <= 0) { clearInterval(rest.timer); rest.show = false; renderRest(); toast('休息结束，开始下一组'); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); return; }
      renderRest();
    }, 1000);
  }
  function renderRest() {
    var el = document.getElementById('rest');
    if (!rest.show) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="pg-train"><div class="mask center rest-mask"><div class="rest-box"><span class="rest-name">' + esc(rest.name) + ' · 组间休息</span><span class="rest-num num">' + fmtSec(rest.left) + '</span>' +
      '<div class="rest-bar"><div class="rest-in" style="width:' + (rest.left / rest.total * 100) + '%"></div></div>' +
      '<div class="rest-btns"><div class="rb" data-rest-adj="-30">−30</div><div class="rb main" data-rest-stop="1">跳过休息</div><div class="rb" data-rest-adj="30">+30</div></div></div></div></div>';
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
        '<div class="rot-tip">T1 四大项固定；T2/T3 每轮在同一动作模式内换一次，一轮 ' + vm.weeksPerCycle + ' 周内保持不变' + (rt.isFuture ? '。这一轮还没开始，以下为预排' : '') + '</div>' +
        rt.days.map(function (d) {
          return '<div class="rot-day"><div class="rot-dh"><span class="num rot-did">' + d.id + '</span><span class="rot-dn">' + esc(d.name) + '</span></div>' +
            d.slots.map(function (r) {
              return '<div class="rot-row">' + tier(r.tier) + '<div class="rot-main"><div class="rot-n">' + esc(r.name) + equipTag(r.equip) +
                (r.isNew ? '<span class="rot-new">新</span>' : '') + (r.locked ? '<span class="rot-lock">锁定</span>' : '') + '</div>' +
                '<div class="rot-s">' + esc(r.role) + (r.isNew ? ' · 上一轮 ' + esc(r.prev) : '') + (r.startW ? ' · 起始 ' + esc(r.startW) : '') + '</div></div></div>';
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
    return h;
  }
  function goTrain(day) { var t = S.train; if (!t.recordId) { t.day = day; t.draft = GZ.blankDraft(load(), day); t.deload = undefined; } S.tab = 'train'; }
  function planAct(act, ds) {
    var p = S.plan;
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
      '<div class="kpi"><span class="k-l">T1 达标率</span><span class="num kv">' + (k.t1Rate === null ? '—' : k.t1Rate + '%') + '</span><span class="ks">T2 完成 ' + (k.t2Rate === null ? '—' : k.t2Rate + '%') + '</span></div></div>';
    h += '<div class="card">' + seg(s.e1rm.map(function (e) { return { html: e.name }; }), st.lift, 'lift');
    if (cur) {
      h += '<span class="cap">最佳 e1RM</span><div class="hero"><span class="num hero-v">' + cur.best + '</span><span class="hero-u">kg</span><span class="cap hero-d">' + cur.bestDate + '</span></div>' +
        '<canvas id="c_e1" class="cv"></canvas>' +
        '<div class="mini"><div class="mi"><span class="num mi-v">' + cur.slope + '</span><span class="mi-l">kg / 周</span></div><div class="mi"><span class="num mi-v">' + cur.r2 + '</span><span class="mi-l">R²</span></div><div class="mi"><span class="num mi-v accent">' + cur.predict + '</span><span class="mi-l">W' + s.totalWeeks + ' 预测</span></div></div>';
      if (cur.sampleTip) h += '<div class="tip">' + cur.sampleTip + '</div>';
      else if (cur.vs1RM !== null && cur.vs1RM > 3) h += '<div class="tip">已超过录入 1RM ' + cur.vs1RM + '%，可以在设置里更新 1RM</div>';
    }
    h += '<div class="legend"><div class="lg"><div class="sw" style="background:#FF6B1A"></div>e1RM</div><div class="lg"><div class="sw dash" style="border-color:#0A84FF"></div>回归趋势</div><div class="lg"><div class="sw dash" style="border-color:#C7C7CC"></div>录入 1RM</div></div></div>';
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
    if (r.tab === 0) {
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
              '<div class="log-act"><span class="btn-small danger" data-act="del" data-id="' + l.id + '">删除</span><span class="btn-small rust" data-act="edit" data-id="' + l.id + '">修改</span></div></div>';
          }
          h += '</div>';
        });
        h += '</div>';
      }
      h += '<div class="sec-f" style="text-align:center">修改或删除任意一次记录，之后的重量与阶段会自动重算</div>';
    }
    return h;
  }
  function reviewAct(act, ds) {
    var r = S.review;
    if (act === 'rtab') { r.tab = Number(ds.i); return true; }
    if (act === 'rules') { r.rules = !r.rules; return true; }
    if (act === 'toggle') { r.open[ds.id] = !r.open[ds.id]; return true; }
    if (act === 'edit') { startEdit(ds.id); return true; }
    if (act === 'del') { confirmBox('删除这次训练？', '删除后，之后所有训练的重量与阶段会按规则重新推算。', function () { var db = load(); GZ.deleteRecord(db, ds.id); save(db); render(true); toast('已删除'); }); return false; }
    if (act === 'copy') {
      var v = S._review, lines = ['【GZCLP 训练小结】'].concat(v.insights.map(function (i) { return '· ' + i.text; }));
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

  // ================= 设置 =================
  function lastBackup() { return Number(localStorage.getItem(BK) || 0); }
  function renderLibrary() {
    var db = load(), st = S.settings, lib = GZ.buildLibrary(db, { tier: st.tier, q: st.q }), h = '';
    h += '<div class="lib-back" data-act="libback">‹ 设置</div>';
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
    h += '<div class="sec-h">基础 1RM</div><div class="list">' +
      GZ.LIFT_ORDER.map(function (k) { return '<div class="cell"><span class="flex1">' + GZ.LIFTS[k] + '</span><span class="tm">TM ' + GZ.fmtW(GZ.tm(P, k)) + '</span>' + inp('oneRM.' + k, P.oneRM[k], 'kg') + '</div>'; }).join('') +
      '<div class="cell"><span class="flex1">TM 比例</span>' + inp('tmRatio', tmPct, '%', 'data-pct="1"') + '</div>' +
      '<div class="cell"><span class="flex1">当前体重</span>' + inp('bodyWeight', P.bodyWeight || 70, 'kg') + '</div></div>' +
      '<div class="sec-f">T1 以四大项 1RM 推算；哑铃按单只、负重按外加重量、自重只记次数。训练时填写体重会自动同步这里。</div>';
    h += '<div class="sec-h">加重步幅</div><div class="list">' +
      GZ.STEP_KEYS.map(function (s) { return '<div class="cell"><span class="flex1">' + s.label + '</span>' + inp('steps.' + s.key, P.steps[s.key], 'kg') + '</div>'; }).join('') +
      '<div class="cell"><span class="flex1">T3 加重阈值</span>' + inp('t3Threshold', P.t3Threshold, '次') + '</div>' +
      '<div class="cell"><span class="flex1">取整档位</span>' + inp('rounding', P.rounding, 'kg') + '</div>' +
      '<div class="cell"><span class="flex1">杠铃杆重</span>' + inp('barWeight', P.barWeight, 'kg') + '</div></div>';
    h += '<div class="sec-h">判定规则</div>' + seg([{ html: '完整三阶', on: P.ruleMode === 'full', data: ' data-v="full"' }, { html: '严格按表格', on: P.ruleMode === 'excel', data: ' data-v="excel"' }], -1, 'mode', 'mode-seg') +
      '<div class="sec-f">' + (P.ruleMode === 'full' ? 'T1 按 5×3+ → 6×2+ → 10×1+ 三阶进阶，连续 2 次未达标才降阶，10×1+ 失败测 5RM 重置。' : '与 Excel 公式逐格一致：T1 只在 5×3+ 与 6×2+ 之间切换。') + '</div>';
    h += '<div class="sec-h">周期</div><div class="list"><div class="cell"><span class="flex1">每轮周数</span>' + inp('totalWeeks', P.totalWeeks, '周 / 轮') + '</div>' +
      '<div class="cell"><span class="flex1">减载周</span><label class="ios-sw green"><input type="checkbox" data-act="dlen" ' + (P.deloadEnabled ? 'checked' : '') + '><i></i></label></div>' +
      (P.deloadEnabled ? '<div class="cell"><span class="flex1">每轮第</span>' + inp('deloadEvery', P.deloadEvery, '周减载') + '</div>' : '') +
      '<div class="cell"><span class="flex1">每轮自动轮换 T2/T3</span><label class="ios-sw green"><input type="checkbox" data-act="rotsw" ' + (P.autoRotate !== false ? 'checked' : '') + '><i></i></label></div></div>' +
      '<div class="sec-f">' + (P.autoRotate !== false ? '每进入新一轮，T2/T3 会在同一动作模式内自动换成上一轮没练过的动作，T1 四大项不变。' : '') + '完成一轮（' + P.totalWeeks + ' 周 × 4 日）后自动进入下一轮，可无限循环；减载按每轮内周序计算' + (P.deloadEnabled ? '（每轮第 ' + P.deloadEvery + ' 周 T1 −50%、T2 −40%、T3 少 1 组，不影响进阶）' : '') + '。</div>';
    var d = db.days[st.d], curCyc = GZ.cycleOf(GZ.recommend(db, rp).week, P).cycle, nextPlan = GZ.planCycles(db, curCyc + 1);
    h += '<div class="sec-h">动作</div><div class="list"><div class="cell tap" data-act="openlib"><span class="flex1">动作库</span><span class="val">' + GZ.libAll(db).length + ' 个' +
      (db.customLib.length ? ' · 自定义 ' + db.customLib.length : '') + '</span><span class="chev">›</span></div></div>';
    h += '<div class="sec-h">训练日动作</div>' + seg(db.days.map(function (x) { return { html: '<span class="num">' + x.id + '</span>' }; }), st.d, 'sday') + '<div class="list">';
    d.slots.forEach(function (s, si) {
      var ef = GZ.effectiveSlot(db, s, (rp.counts[d.id] || 0) + 1, rp.hist), cur = ef.slot.name;
      var opts = names[s.tier].indexOf(cur) < 0 ? [cur].concat(names[s.tier]) : names[s.tier];
      var eq = GZ.equipOf(cur, ef.slot.equip), ss = Object.assign({}, s, { name: cur, equip: eq });
      var rc = GZ.recommendWeight(db, cur, s.tier, { preferLast: false });
      h += '<div class="cell slot"><div class="slot-top">' + tier(s.tier) + '<label class="flex1 ex-pick">' + esc(cur) + equipTag(eq) + '<span class="chev">⌄</span><select data-act="ex" data-si="' + si + '">' +
        opts.map(function (n) { return '<option ' + (n === cur ? 'selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>' +
        '<span class="init-step">' + (eq === '自重' ? '达阈值后改负重' : '每次 +' + GZ.stepOf(ss, P) + ' kg · 按 ' + GZ.incOf(ss, P) + ' kg 档') + '</span>' +
        '<span class="init num">' + (eq === '自重' ? '自重' : GZ.fmtW(GZ.initWeight(s, P)) + '<span class="f-u"> kg</span>') + '</span></div>' +
        (ef.auto ? '<div class="slot-chg">第 ' + ef.change.cycle + ' 轮自动轮换 · 上一轮 ' + esc(ef.change.prev) + '</div>' : ef.change ? '<div class="slot-chg">第 ' + ef.change.fromWeek + ' 周起更换 · 原 ' + esc(s.name) + '</div>' : '') +
        (s.tier !== 'T1' ? '<div class="slot-rot"><span class="flex1">' + (P.autoRotate === false || s.noRotate ? '不参与轮换' : '第 ' + (curCyc + 1) + ' 轮将换成「' + esc(nextPlan.actual[curCyc + 1][s.id]) + '」') + '</span><span class="rot-lock-btn ' + (s.noRotate ? 'on' : '') + '" data-act="lock" data-si="' + si + '">' + (s.noRotate ? '已锁定' : '锁定') + '</span></div>' : '') +
        '<div class="slot-rec"><span class="flex1">系统推荐 ' + esc(rc.text) + (rc.unit === '自重' ? '' : ' ' + esc(rc.unit)) + ' · ' + esc(rc.note) + '</span><span class="rec-apply" data-act="applyrec" data-si="' + si + '">采用</span></div>' +
        '<div class="slot-cfg"><span class="cfg-l">首周</span><div class="mini-seg"><div class="ms ' + (s.init.type === 'pct' ? 'on' : '') + '" data-act="itype" data-si="' + si + '" data-v="pct">TM%</div><div class="ms ' + (s.init.type === 'fixed' ? 'on' : '') + '" data-act="itype" data-si="' + si + '" data-v="fixed">固定</div></div>';
      if (s.init.type === 'pct') {
        h += '<label class="base-pick">' + GZ.LIFTS[s.init.base] + '<span class="chev">⌄</span><select data-act="base" data-si="' + si + '">' + GZ.LIFT_ORDER.map(function (k) { return '<option value="' + k + '" ' + (k === s.init.base ? 'selected' : '') + '>' + GZ.LIFTS[k] + '</option>'; }).join('') + '</select></label>' +
          '<span class="cap">×</span><input class="f-in sm num" inputmode="decimal" data-act="pctv" data-si="' + si + '" value="' + Math.round(s.init.pct * 100) + '"><span class="cap">%</span>';
      } else h += '<input class="f-in sm num" inputmode="decimal" data-act="fixv" data-si="' + si + '" value="' + s.init.value + '"><span class="cap">kg</span>';
      h += '</div></div>';
    });
    h += '</div>';
    var bk = lastBackup(), stale = !bk || Date.now() - bk > 7 * 86400000;
    h += '<div class="sec-h">数据</div><div class="list">' +
      '<div class="cell tap" data-act="export"><span class="flex1 accent">导出备份文件</span><span class="val ' + (stale ? 'amber' : '') + '">' + GZ.backupLabel(bk) + '</span></div>' +
      '<div class="cell tap" data-act="copyjson"><span class="flex1 accent">复制备份文本</span><span class="chev">›</span></div>' +
      '<label class="cell tap"><span class="flex1 accent">从文件恢复</span><span class="chev">›</span><input type="file" accept=".json,application/json" data-act="impfile" style="display:none"></label>' +
      '<div class="cell tap" data-act="imp"><span class="flex1 accent">粘贴文本恢复</span><span class="chev">' + (st.imp ? '⌃' : '›') + '</span></div>' +
      (st.imp ? '<div class="cell"><div class="flex1"><textarea class="imp" id="impText" placeholder="粘贴导出的 JSON"></textarea><span class="btn-small rust" style="margin-top:8px" data-act="doImp">确认恢复（覆盖当前数据）</span></div></div>' : '') +
      '</div><div class="sec-f">共 ' + db.records.length + ' 条训练记录。数据只存在这台设备的浏览器里，建议每周导出一次，发到微信「文件传输助手」保存。</div>';
    h += '<div class="list" style="margin-top:20px"><div class="cell tap" data-act="clear"><span class="flex1 red">清空训练记录</span></div><div class="cell tap" data-act="restore"><span class="flex1 red">恢复 Excel 默认</span></div></div>' +
      '<div class="sec-f">修改参数后，所有历史判定与重量会按新参数重新推算</div>';
    return h;
  }
  function setPath(o, p, v) { var ks = p.split('.'); for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; }
  function mutate(fn, tip) { var db = load(); fn(db); save(db); if (tip !== false) toast(tip || '已更新，数据已重算'); return true; }
  function markBackup() { localStorage.setItem(BK, String(Date.now())); }
  function exportFile() {
    var txt = JSON.stringify(load()), name = 'GZCLP备份_' + GZ.today() + '.json';
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
    try { save(GZ.normalize(JSON.parse(txt))); S.settings.imp = false; S.train.draft = null; S.train.day = null; toast('恢复成功'); render(true); }
    catch (e) { toast('文件内容不正确'); }
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
      case 'param': var v = parseFloat(el.value); if (isNaN(v) || v < 0) return true; if (ds.pct) v = v / 100; return mutate(function (db) { setPath(db.params, ds.k, v); });
      case 'mode': return mutate(function (db) { db.params.ruleMode = ds.v; }, ds.v === 'full' ? '已切换：完整三阶规则' : '已切换：严格按表格公式');
      case 'dlen': return mutate(function (db) { db.params.deloadEnabled = el.checked; });
      case 'rotsw': return mutate(function (db) { db.params.autoRotate = el.checked; }, el.checked ? '已开启：每轮自动轮换 T2/T3' : '已关闭自动轮换');
      case 'lock': return mutate(function (db) { var sl = db.days[st.d].slots[si]; sl.noRotate = !sl.noRotate; }, false);
      case 'sday': st.d = Number(ds.i); return true;
      case 'ex':
        var dbx = load(), dd = dbx.days[st.d], rx = GZ.swapSlot(dbx, dd.id, dd.slots[si].id, el.value, null);
        if (rx && rx.error) { toast(rx.error); return false; }
        save(dbx);
        toast(rx && rx.base ? '已更换为 ' + el.value : '第 ' + rx.fromWeek + ' 周起改为 ' + el.value); return true;
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
      case 'itype': return slotMut(function (s, db) { if (s.init.type === ds.v) return; var w = GZ.initWeight(s, db.params); s.init = ds.v === 'fixed' ? { type: 'fixed', value: w } : { type: 'pct', base: s.lift || 'bench', pct: 0.5 }; });
      case 'base': return slotMut(function (s) { s.init.base = el.value; });
      case 'pctv': var pv = parseFloat(el.value); if (isNaN(pv)) return true; return slotMut(function (s) { s.init.pct = pv / 100; });
      case 'fixv': var fv = parseFloat(el.value); if (isNaN(fv)) return true; return slotMut(function (s) { s.init.value = fv; });
      case 'applyrec':
        var dbr = load(), dyr = dbr.days[st.d], sr0 = dyr.slots[si], wkr = (GZ.replay(dbr).counts[dyr.id] || 0) + 1;
        var efr = GZ.effectiveSlot(dbr, sr0, wkr), rr = GZ.recommendWeight(dbr, efr.slot.name, sr0.tier, { preferLast: false });
        if (efr.change) GZ.swapSlot(dbr, dyr.id, sr0.id, efr.slot.name, rr.weight); else sr0.init = { type: 'fixed', value: rr.weight };
        save(dbr); toast('已采用推荐 ' + rr.text + (rr.unit === '自重' ? '' : ' ' + rr.unit)); return true;
      case 'export': exportFile(); return false;
      case 'copyjson': copyText(JSON.stringify(load()), '已复制，粘贴到文件传输助手保存'); markBackup(); setTimeout(function () { render(true); }, 50); return false;
      case 'impfile':
        var f = el.files && el.files[0]; if (!f) return false;
        var rd = new FileReader(); rd.onload = function () { confirmBox('从文件恢复？', '当前设备上的数据会被备份文件覆盖。', function () { importText(rd.result); }); }; rd.readAsText(f); el.value = ''; return false;
      case 'imp': st.imp = !st.imp; return true;
      case 'doImp': importText(document.getElementById('impText').value); return false;
      case 'clear': confirmBox('清空全部训练记录？', '参数与动作配置保留，记录无法恢复。', function () { mutate(function (db) { db.records = []; }, '已清空'); S.train.draft = null; S.train.day = null; render(true); }); return false;
      case 'restore': confirmBox('恢复 Excel 默认？', '参数、动作配置与记录将恢复为表格初始状态（含第 1 周 A1/B1 记录）。', function () { save(GZ.defaults(true)); S.train = { day: null, draft: null, recordId: null, date: GZ.today(), bw: '', note: '', result: null }; render(true); toast('已恢复'); }); return false;
    }
  }

  // ================= 框架 =================
  var RENDER = { train: renderTrain, plan: renderPlan, stats: renderStats, review: renderReview, settings: renderSettings };
  var ACT = { train: trainAct, plan: planAct, stats: statsAct, review: reviewAct, settings: settingsAct };
  function render(keepScroll) {
    var body = document.getElementById('body'), y = body.scrollTop;
    document.getElementById('navTitle').textContent = S.tab === 'settings' && S.settings.view === 'lib' ? '动作库' : TABS.filter(function (t) { return t.id === S.tab; })[0].title;
    body.innerHTML = '<div class="pg-' + S.tab + '"><div class="page">' + RENDER[S.tab]() + '</div></div>';
    body.scrollTop = keepScroll ? y : 0;
    document.querySelectorAll('.tb-item').forEach(function (el) { el.classList.toggle('on', el.dataset.tab === S.tab); });
    if (S.tab === 'stats') requestAnimationFrame(drawStats);
  }
  function handle(e, type) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var tag = el.tagName, isField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if (type === 'click' && isField) return;
    if (type === 'change' && !isField) return;
    if (type === 'input' && ['note', 'bw', 'swapq', 'libq'].indexOf(el.dataset.act) < 0) return;
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
    document.getElementById('tabbar').addEventListener('click', function (e) {
      var it = e.target.closest('.tb-item'); if (!it) return;
      if (S.tab === it.dataset.tab) { body.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      S.tab = it.dataset.tab; render();
    });
    document.getElementById('rest').addEventListener('click', function (e) {
      var a = e.target.closest('[data-rest-adj]'), s = e.target.closest('[data-rest-stop]');
      if (a) { rest.left = Math.max(5, rest.left + Number(a.dataset.restAdj)); rest.total = Math.max(rest.total, rest.left); renderRest(); }
      if (s) { clearInterval(rest.timer); rest.show = false; renderRest(); }
    });
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (S.tab === 'stats') drawStats(); }, 120); });
    render();
  });
})();
