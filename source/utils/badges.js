/* 里程碑徽章：纯计算，不读写存储、不联网。
 * 输入是「有效训练」列表（由 share.js 整理）+ 手表快照，输出每枚徽章何时获得、每次训练新获得了哪些。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine'));
  else root.GZBadges = factory(root.GZ);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GZ) {
  'use strict';

  // ---------- 徽章定义 ----------
  // rank 只决定徽章墙/候选列表的先后；卡片上展示哪一枚由「随机或手动选择」决定
  var GROUPS = [
    { id: 'strength', name: '主项重量', rank: 8 },
    { id: 'volume', name: '累计容量', rank: 7 },
    { id: 'session', name: '单次容量', rank: 6 },
    { id: 'progress', name: '加重进阶', rank: 5 },
    { id: 'count', name: '训练次数', rank: 4 },
    { id: 'streak', name: '坚持', rank: 3 },
    { id: 'watch', name: '手表', rank: 1 }
  ];
  var COUNTS = [1, 5, 10, 25, 50, 75, 100, 150, 200, 300];
  var VOLUMES = [
    { kg: 5000, title: '一头非洲象', desc: '累计容量 5 t，约一头成年非洲象的体重', e: '🐘' },
    { kg: 12000, title: '一辆公交车', desc: '累计容量 12 t，约一辆公交车的重量', e: '🚌' },
    { kg: 25000, title: '累计 25 吨', desc: '累计容量 25 t', e: '📦' },
    { kg: 41000, title: '一架波音 737', desc: '累计容量 41 t，约一架空机波音 737', e: '✈️' },
    { kg: 75000, title: '累计 75 吨', desc: '累计容量 75 t', e: '🏗️' },
    { kg: 150000, title: '一头蓝鲸', desc: '累计容量 150 t，约一头蓝鲸的体重', e: '🐋' },
    { kg: 280000, title: '一架空客 A380', desc: '累计容量 280 t，约一架空载 A380（空重约 277 t）', e: '🛫' },
    { kg: 500000, title: '累计 500 吨', desc: '累计容量 500 t', e: '🚢' },
    { kg: 1000000, title: '千吨容量', desc: '累计容量 1,000 t', e: '⛰️' },
    { kg: 7300000, title: '一座埃菲尔铁塔', desc: '累计容量 7,300 t，约埃菲尔铁塔的钢铁结构', e: '🗼' }
  ];
  var SESSION_VOLS = [3000, 5000, 8000, 10000, 15000];          // 单次训练容量（kg）
  var ADDS = [10, 25, 50, 100, 200, 300];                        // 累计达到加重条件的动作数
  var MONTH_N = [8, 12, 16];                                     // 单个自然月的训练次数
  var LIFT_NAME = { squat: '深蹲', bench: '卧推', deadlift: '硬拉', ohp: '推举' };
  var LIFT_E = { squat: '🦵', bench: '🏋️', deadlift: '🏗️', ohp: '🚀' };
  var LIFT_KG = { squat: [80, 100, 120, 140, 160], bench: [60, 80, 100, 120], deadlift: [100, 120, 140, 160, 180, 200], ohp: [30, 40, 50, 60, 70] };
  var LIFT_ORDER = ['squat', 'bench', 'deadlift', 'ohp'];
  var HOURS = [5, 10, 25, 50, 100, 200];
  var SETS = [50, 100, 250, 500, 1000, 2000];
  var KCALS = [1000, 2500, 5000, 10000];
  var SLEEP_NIGHTS = [3, 7, 14];
  var GOOD_NIGHTS = [10, 30, 60];
  var SLEEP_SCORE = 85;

  function fmtN(n) { return Number(n).toLocaleString('zh-CN'); }
  function defs(P) {
    var out = [];
    // m：进度指标名；t：目标值；u：单位。无 m 的徽章（完美一周等）没有进度条
    function add(group, id, title, desc, e, tier, repeat, m, t, u) { out.push({ id: id, group: group, title: title, desc: desc, e: e, tier: tier, repeat: !!repeat, m: m || null, t: t || 0, u: u || '' }); }
    COUNTS.forEach(function (n) { add('count', 'count-' + n, '第 ' + n + ' 次训练', '累计完成 ' + n + ' 次训练', '🎯', n, false, 'count', n, '次'); });
    ADDS.forEach(function (n) { add('progress', 'adds-' + n, '累计加重 ' + n + ' 次', '累计 ' + n + ' 次有动作达到加重条件（按计划规则判定）', '📈', n, false, 'adds', n, '次'); });
    VOLUMES.forEach(function (v, i) { add('volume', 'vol-' + v.kg, v.title, v.desc, v.e, i + 1, false, 'volume', v.kg / 1000, 't'); });
    SESSION_VOLS.forEach(function (kg) { add('session', 'sess-' + kg, '单次 ' + kg / 1000 + ' 吨', '单次训练的容量（重量 × 次数）达到 ' + kg / 1000 + ' t', '💥', kg, false, 'sess', kg / 1000, 't'); });
    LIFT_ORDER.forEach(function (k) {
      LIFT_KG[k].forEach(function (kg) {
        add('strength', 'lift-' + k + '-' + kg, LIFT_NAME[k] + ' ' + kg + ' kg', 'T1 ' + LIFT_NAME[k] + '的工作重量达到 ' + kg + ' kg，并完成目标（加重或保持）', LIFT_E[k], kg, false, 'lift-' + k, kg, 'kg');
      });
    });
    MONTH_N.forEach(function (n) { add('streak', 'month-' + n, '单月 ' + n + ' 练', '同一个自然月内训练 ' + n + ' 次', '📆', n, false, 'month', n, '次'); });
    HOURS.forEach(function (h) { add('watch', 'w-hours-' + h, '手表累计 ' + h + ' 小时', '手表记录的力量训练累计 ' + h + ' 小时（自训练手记开始记录起）', '⏱️', h, false, 'hours', h, '小时'); });
    SETS.forEach(function (n) { add('watch', 'w-sets-' + n, '手表累计 ' + n + ' 组', '手表记录的力量训练累计 ' + n + ' 组（自训练手记开始记录起）', '💪', n, false, 'sets', n, '组'); });
    KCALS.forEach(function (n) { add('watch', 'w-kcal-' + n, '手表累计 ' + fmtN(n) + ' 千卡', '手表估算的力量训练消耗累计 ' + fmtN(n) + ' 千卡（估算值，自训练手记开始记录起）', '🍚', n, false, 'kcal', n, '千卡'); });
    SLEEP_NIGHTS.forEach(function (n) { add('watch', 'w-sleep-' + n, '睡得好 · 连续 ' + n + ' 晚', '睡眠评分 ≥ ' + SLEEP_SCORE + ' 连续 ' + n + ' 晚', '😴', n, false, 'sleep', n, '晚'); });
    GOOD_NIGHTS.forEach(function (n) { add('watch', 'w-good-' + n, '睡得好 · 累计 ' + n + ' 晚', '睡眠评分 ≥ ' + SLEEP_SCORE + ' 的夜晚累计 ' + n + ' 晚（不要求连续）', '🌙', n, false, 'good', n, '晚'); });
    return out;
  }
  function groupRank(g) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].id === g) return GROUPS[i].rank; return 0; }

  // ---------- 工具 ----------
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function dayNum(date) { var p = date.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function r2(n) { return Math.round(n * 100) / 100; }

  // ---------- 手表快照 ----------
  function num(v, lo, hi) { v = Number(v); return Number.isFinite(v) && v >= lo && v <= hi ? v : null; }
  /** 校验并规整导入的快照；格式不对直接抛错，调用方给用户提示 */
  function sanitizeWatch(raw) {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { throw new Error('文件不是有效的 JSON'); } }
    if (!raw || typeof raw !== 'object' || raw.schema !== 'gzclp-watch-v1') throw new Error('这不是手表快照文件（缺少 gzclp-watch-v1 标识）');
    var ws = Array.isArray(raw.workouts) ? raw.workouts : [], out = { source: String(raw.source || 'COROS').slice(0, 24), workouts: [], sleep: {} }, seen = {};
    if (ws.length > 3000) throw new Error('训练条数过多');
    ws.forEach(function (w) {
      if (!w || !DATE_RE.test(w.date || '')) return;
      var start = num(w.start, 0, 4102444800), min = num(w.min, 1, 600), sets = num(w.sets, 0, 200), hr = num(w.avgHr, 0, 250), kcal = num(w.kcal, 0, 5000);
      if (start === null || min === null || sets === null) return;
      var key = w.date + '|' + start;
      if (seen[key]) return; seen[key] = 1;
      out.workouts.push({ date: w.date, start: Math.round(start), min: Math.round(min), sets: Math.round(sets), avgHr: hr === null ? 0 : Math.round(hr), kcal: kcal === null ? 0 : Math.round(kcal) });
    });
    var sl = raw.sleep && typeof raw.sleep === 'object' ? raw.sleep : {}, keys = Object.keys(sl);
    if (keys.length > 2000) throw new Error('睡眠天数过多');
    keys.forEach(function (d) {
      if (!DATE_RE.test(d)) return;
      var sc = num(sl[d] && sl[d].score, 1, 100), mi = num(sl[d] && sl[d].min, 0, 1440);
      if (sc === null) return;
      out.sleep[d] = { score: Math.round(sc), min: mi === null ? 0 : Math.round(mi) };
    });
    if (!out.workouts.length && !Object.keys(out.sleep).length) throw new Error('快照里没有可用的训练或睡眠数据');
    out.workouts.sort(function (a, b) { return a.start - b.start; });
    return out;
  }
  /** 合并：训练按「日期+开始时间」去重，睡眠按日期以新数据为准；重复导入不会翻倍 */
  function mergeWatch(oldW, incoming) {
    var base = oldW && oldW.workouts ? oldW : { workouts: [], sleep: {} }, seen = {}, ws = [];
    base.workouts.concat(incoming.workouts).forEach(function (w) { var k = w.date + '|' + w.start; if (!seen[k]) { seen[k] = 1; ws.push(w); } });
    ws.sort(function (a, b) { return a.start - b.start; });
    var sl = Object.assign({}, base.sleep || {}, incoming.sleep || {});
    return { source: incoming.source || base.source || 'COROS', importedAt: Date.now(), workouts: ws, sleep: sl };
  }
  /** 找出某次训练对应的手表训练：同一天按开始先后一一对应 */
  function watchFor(watch, sessions, session) {
    if (!watch || !watch.workouts || !session) return null;
    var day = watch.workouts.filter(function (w) { return w.date === session.date; }).sort(function (a, b) { return a.start - b.start; });
    if (!day.length) return null;
    var same = sessions.filter(function (s) { return s.date === session.date; }).sort(function (a, b) { return a.order - b.order; });
    var idx = same.map(function (s) { return s.id; }).indexOf(session.id);
    return day[idx] || null;
  }

  // ---------- 核心计算 ----------
  /**
   * sessions：按时间先后的有效训练 [{id,date,day,week,volume,order,adds,lifts}]
   *   adds：这次达到加重条件的动作数；lifts：{squat,bench,deadlift,ohp} 这次 T1 完成目标（加重/保持）的工作重量
   * 里程碑只收「所有计划都通用」的：次数、加重、主项重量、容量、单次容量、单月训练、手表。
   * 依赖计划周定义的（完美一周、连续全勤、完成周期、减载）不在这里——不同计划训练日数不同，无法跨计划比较。
   * sessions 应为全部计划的有效训练（按时间先后），即「终身」口径。
   * opts：{ params, watch, today }
   * 返回 { defs, earned, bySession, progress, prog, nextGoals, watchFrom, ... }
   */
  function compute(sessions, opts) {
    opts = opts || {};
    var P = opts.params || {}, ds = defs(P), byId = {}, earned = {}, bySession = {}, events = [];
    ds.forEach(function (d) { byId[d.id] = d; });
    function award(id, sess, extra) {
      if (!byId[id]) return;
      var d = byId[id];
      if (!d.repeat && earned[id]) return;
      var cur = earned[id] || { id: id, count: 0 };
      cur.count += 1; cur.date = sess.date; cur.recordId = sess.id; cur.seq = sess.seq;
      earned[id] = cur;
      (bySession[sess.id] = bySession[sess.id] || []).push(id);
      events.push({ id: id, recordId: sess.id, extra: extra || null });
    }

    var list = sessions.slice().sort(function (a, b) { return a.order - b.order; });
    list.forEach(function (s, i) { s.seq = i + 1; });
    var M = {};                      // 各进度指标的当前值

    // 1) 训练次数、累计容量、单次容量、累计加重、主项重量
    var cum = 0, addsNow = 0, liftMax = { squat: 0, bench: 0, deadlift: 0, ohp: 0 }, sessMax = 0;
    list.forEach(function (s) {
      if (COUNTS.indexOf(s.seq) >= 0) award('count-' + s.seq, s);
      var before = cum; cum += Number(s.volume) || 0;
      VOLUMES.forEach(function (v) { if (before < v.kg && cum >= v.kg) award('vol-' + v.kg, s); });
      var sv = Number(s.volume) || 0; sessMax = Math.max(sessMax, sv);
      SESSION_VOLS.forEach(function (kg) { if (sv >= kg) award('sess-' + kg, s); });
      var ab = addsNow; addsNow += Number(s.adds) || 0;
      ADDS.forEach(function (n) { if (ab < n && addsNow >= n) award('adds-' + n, s); });
      LIFT_ORDER.forEach(function (k) {
        var w = Number(s.lifts && s.lifts[k]) || 0;
        if (w > liftMax[k]) liftMax[k] = w;
        LIFT_KG[k].forEach(function (kg) { if (w >= kg) award('lift-' + k + '-' + kg, s); });
      });
    });
    M.count = list.length; M.volume = cum / 1000; M.sess = sessMax / 1000; M.adds = addsNow;
    LIFT_ORDER.forEach(function (k) { M['lift-' + k] = liftMax[k]; });


    // 2) 单月训练次数（自然月，与计划无关）
    var monthCnt = {};
    list.forEach(function (s) {
      var ym = s.date.slice(0, 7); monthCnt[ym] = (monthCnt[ym] || 0) + 1;
      if (MONTH_N.indexOf(monthCnt[ym]) >= 0) award('month-' + monthCnt[ym], s);
    });
    var curYM = (opts.today || (list.length ? list[list.length - 1].date : '')).slice(0, 7);
    M.month = monthCnt[curYM] || 0;


    // 3) 手表：只从训练手记第一条记录的日期开始计
    var watch = opts.watch, watchFrom = list.length ? list[0].date : '', hoursNow = 0, setsNow = 0, kcalNow = 0, nightsNow = 0, goodNow = 0;
    function markEarned(id, date, sess) { if (!earned[id]) earned[id] = { id: id, count: 1, date: date, recordId: sess ? sess.id : '', seq: sess ? sess.seq : 0, wallOnly: true }; }
    function lastOnOrBefore(date) { var pick = null; list.forEach(function (s) { if (s.date <= date) pick = s; }); return pick; }
    function onDate(date) { var pick = null; list.forEach(function (s) { if (s.date === date) pick = s; }); return pick; }
    function cross(id, date) { var sess = onDate(date); if (sess) award(id, sess); else markEarned(id, date, lastOnOrBefore(date)); }
    if (watch && watchFrom) {
      var cm = 0, cs = 0, ck = 0;
      (watch.workouts || []).filter(function (w) { return w.date >= watchFrom; }).sort(function (a, b) { return a.start - b.start; }).forEach(function (w) {
        var bm = cm, bs = cs, bk = ck; cm += w.min; cs += w.sets; ck += w.kcal || 0;
        HOURS.forEach(function (h) { if (bm < h * 60 && cm >= h * 60) cross('w-hours-' + h, w.date); });
        SETS.forEach(function (n) { if (bs < n && cs >= n) cross('w-sets-' + n, w.date); });
        KCALS.forEach(function (n) { if (bk < n && ck >= n) cross('w-kcal-' + n, w.date); });
      });
      hoursNow = cm / 60; setsNow = cs; kcalNow = ck;
      var dates = Object.keys(watch.sleep || {}).filter(function (d) { return d >= watchFrom; }).sort(), run = 0, prevDate = null, prevGood = false;
      dates.forEach(function (d) {
        var good = watch.sleep[d].score >= SLEEP_SCORE;
        // 必须是连续的自然日，且前一晚也达标；中间缺一晚就重新计数
        run = !good ? 0 : (prevGood && prevDate && dayNum(d) - dayNum(prevDate) === 1 ? run + 1 : 1);
        prevDate = d; prevGood = good;
        if (good) { goodNow += 1; if (GOOD_NIGHTS.indexOf(goodNow) >= 0) cross('w-good-' + goodNow, d); }
        SLEEP_NIGHTS.forEach(function (n) { if (run === n) cross('w-sleep-' + n, d); });
      });
      nightsNow = run;
    }
    M.hours = hoursNow; M.sets = setsNow; M.kcal = kcalNow; M.sleep = nightsNow; M.good = goodNow;

    // 排序：候选列表先后（周期 > 主项重量 > 容量 > …）
    function prio(id) { var d = byId[id]; return groupRank(d.group) * 100000 + d.tier; }
    Object.keys(bySession).forEach(function (k) {
      // 同一次训练一口气跨过同一系列的多档（如单次 3 吨 + 5 吨）：候选里只留最高一档，徽章墙仍各自点亮
      var top = {};
      bySession[k].forEach(function (id) { var d = byId[id]; if (d.m && (!top[d.m] || d.tier > byId[top[d.m]].tier)) top[d.m] = id; });
      bySession[k] = bySession[k].filter(function (id) { var d = byId[id]; return !d.m || top[d.m] === id; });
      bySession[k].sort(function (a, b) { return prio(b) - prio(a); });
    });

    // 进度（徽章墙 + 「下一个目标」）
    function nextOf(arr, v) { for (var i = 0; i < arr.length; i++) if (v < arr[i]) return arr[i]; return null; }
    var progress = {
      count: { value: list.length, next: nextOf(COUNTS, list.length), unit: '次' },
      volume: { value: r2(cum / 1000), next: (function () { var n = nextOf(VOLUMES.map(function (v) { return v.kg; }), cum); return n ? n / 1000 : null; })(), unit: 't' },
      hours: { value: r2(hoursNow), next: nextOf(HOURS, hoursNow), unit: '小时' },
      sets: { value: setsNow, next: nextOf(SETS, setsNow), unit: '组' },
      sleep: { value: nightsNow, next: nextOf(SLEEP_NIGHTS, nightsNow), unit: '晚' }
    };
    var all = ds.concat(Object.keys(byId).filter(function (k) { return !ds.some(function (d) { return d.id === k; }); }).map(function (k) { return byId[k]; }));
    var prog = {};
    all.forEach(function (d) {
      if (!d.m) return;
      var v = Number(M[d.m]) || 0;
      prog[d.id] = { v: r2(v), t: d.t, u: d.u, pct: d.t ? Math.max(0, Math.min(1, v / d.t)) : 0 };
    });
    // 每一类里「最接近」的未达成目标，按完成度从高到低
    var best = {};
    all.forEach(function (d) {
      if (!d.m || earned[d.id] || !prog[d.id]) return;
      var cur = best[d.group], pg = prog[d.id];
      if (!cur || pg.pct > prog[cur.id].pct || (pg.pct === prog[cur.id].pct && d.tier < cur.tier)) best[d.group] = d;
    });
    var nextGoals = Object.keys(best).map(function (g) { return { id: best[g].id, group: g, pct: prog[best[g].id].pct }; })
      .filter(function (x) { return x.pct > 0; }).sort(function (a, b) { return b.pct - a.pct; });
    return { defs: all, byId: byId, earned: earned, bySession: bySession, progress: progress, prog: prog, nextGoals: nextGoals, metrics: M, watchFrom: watchFrom, events: events,
      total: ds.length, earnedCount: ds.filter(function (d) { return earned[d.id]; }).length };
  }

  /** 从候选里稳定地「随机」挑一枚：同一次训练、同一个 variant 永远得到同一个结果，点「换一个」则 variant+1 */
  function pickOne(ids, seed, variant) {
    if (!ids || !ids.length) return '';
    var h = 2166136261, str = String(seed || '') + '|' + ids.slice().sort().join(',');
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var sorted = ids.slice().sort();
    return sorted[(h + (Number(variant) || 0)) % sorted.length];
  }

  return { GROUPS: GROUPS, defs: defs, compute: compute, pickOne: pickOne, sanitizeWatch: sanitizeWatch, mergeWatch: mergeWatch, watchFor: watchFor, groupRank: groupRank, SLEEP_SCORE: SLEEP_SCORE };
});
