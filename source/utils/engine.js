/**
 * GZCLP 规则引擎（小程序 / H5 共用）
 * 1:1 复刻《SEVEN_GZCLP_扩展容量版_8周全自动追踪表.xlsx》的计算逻辑：
 *  - 参数设置：1RM → TM(×90%)、进阶步幅、T3 阈值、取整档位
 *  - A1/B1/A2/B2 四个训练日：首周重量 = ROUND(TM×系数/2.5)×2.5，之后每周 = 上周"下次重量"
 *  - T1 / T2 / T3 判定 → 下次阶段 → 下次重量（链式传递）
 *  - 统计：判定结果分布（COUNTIF）、各动作每周重量走势
 * 在此基础上扩展：完整三阶 T1 规则、减载周、容量、e1RM、线性回归、阶段总结
 * 设计：事件溯源 —— 只存"每次填写的 AMRAP/完成情况"，所有状态由回放计算（与 Excel 只填 F 列一致）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GZ = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ---------- 基础常量 ----------
  var VERSION = 1;
  var DAYS_VERSION = 2; // 动作模板版本，升级后 normalize 会刷新未自定义的 T2/T3 槽位
  var LIFTS = { squat: '杠铃深蹲', bench: '平板卧推', deadlift: '传统硬拉', ohp: '站姿实力推' };
  var LIFT_ORDER = ['squat', 'bench', 'deadlift', 'ohp'];
  var STEP_KEYS = [
    { key: 't1u', label: 'T1 上肢加重步幅', note: '原版 5 磅' },
    { key: 't1l', label: 'T1 下肢加重步幅', note: '原版 10 磅' },
    { key: 't2u', label: 'T2 上肢加重步幅', note: '' },
    { key: 't2l', label: 'T2 下肢加重步幅', note: '' },
    { key: 't3u', label: 'T3 上肢加重步幅', note: '按档位取整' },
    { key: 't3l', label: 'T3 下肢加重步幅', note: '' }
  ];

  var STAGES = {
    T1: {
      '5×3+': { sets: 5, reps: 3, add: 6, hold: 3, next: '6×2+' },
      '6×2+': { sets: 6, reps: 2, add: 4, hold: 2, next: '10×1+' },
      '10×1+': { sets: 10, reps: 1, add: 2, hold: 2, next: null }
    },
    T2: {
      '3×10': { sets: 3, reps: 10, next: '3×8' },
      '3×8': { sets: 3, reps: 8, next: '3×6' },
      '3×6': { sets: 3, reps: 6, next: '3×10' }
    },
    T3: { '3×15+': { sets: 3, reps: 15 } }
  };
  var FIRST_STAGE = { T1: '5×3+', T2: '3×10', T3: '3×15+' };
  var REST = { T1: 180, T2: 150, T3: 75 }; // 组间休息（秒）：T1 3~5min / T2 2~3min / T3 60~90s
  var DAY_ORDER = ['A1', 'B1', 'A2', 'B2'];

  // Apple 系统色
  var JUDGE_COLORS = {
    '加重': '#FF6B1A', '保持': '#34C759', '建议降阶': '#FF9F0A',
    '降阶': '#AF52DE', '退阶': '#AF52DE', '重置': '#FF3B30', '减载': '#5AC8FA', '跳过': '#C7C7CC', '替换': '#5856D6'
  };
  var TIER_COLORS = { T1: '#FF6B1A', T2: '#0A84FF', T3: '#AEAEB2' };
  var JUDGE_ICON = { '加重': '↑', '保持': '=', '建议降阶': '!', '降阶': '↓', '退阶': '↓', '重置': '↺', '减载': '~', '跳过': '–', '替换': '⇄' };
  var INS_ICON = { info: 'i', up: '↑', warn: '!', tip: '→', trend: '↗' };
  function dateLabel(d) {
    if (!d) return '';
    var p = d.split('-'), dt = new Date(+p[0], +p[1] - 1, +p[2]);
    return (+p[1]) + '月' + (+p[2]) + '日 周' + '日一二三四五六'.charAt(dt.getDay());
  }
  function backupLabel(ts) {
    if (!ts) return '从未备份';
    var d = Math.floor((Date.now() - ts) / 86400000);
    return d <= 0 ? '今天已备份' : d + ' 天前备份';
  }
  function fmtRest(s) { var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }

  // 动作库（来自「动作库」工作表）
  var LIB = [
    ['T1', '杠铃深蹲', '下肢·蹲', '杠铃', '主项；末组AMRAP≥6次加重'],
    ['T1', '前蹲', '下肢·蹲', '杠铃', '颈前位深蹲，核心与股四侧重'],
    ['T1', '泽奇深蹲', '下肢·蹲', '杠铃', '肘托杠深蹲，躯干承重更强'],
    ['T1', '传统硬拉', '下肢·髋铰链', '杠铃', '主项；髋主导拉起'],
    ['T1', '相扑硬拉', '下肢·髋铰链', '杠铃', '宽站距硬拉变式，腿部参与多'],
    ['T1', '平板卧推', '上肢·水平推', '杠铃', '主项；胸大肌主导'],
    ['T1', '暂停卧推', '上肢·水平推', '杠铃', '触胸停顿1秒，消除反弹借力'],
    ['T1', '上斜卧推', '上肢·水平推', '杠铃', '上胸侧重'],
    ['T1', '站姿实力推', '上肢·垂直推', '杠铃', '主项；站姿推举'],
    ['T1', '双杠臂屈伸', '上肢·水平推', '自重/负重', '下胸与三头'],
    ['T2', '罗马尼亚硬拉', '下肢·髋铰链', '杠铃', '腘绳肌主导，屈膝小'],
    ['T2', '杠铃后蹲', '下肢·蹲', '杠铃', '高杠后蹲变式'],
    ['T2', '腿举', '下肢·蹲', '器械', '腿部容量'],
    ['T2', '泽奇深蹲', '下肢·蹲', '杠铃', '肘托杠深蹲，躯干承重更强'],
    ['T2', '窄距卧推', '上肢·水平推', '杠铃', '三头侧重'],
    ['T2', '暂停卧推', '上肢·水平推', '杠铃', '触胸停顿，消除反弹借力'],
    ['T2', '坐姿哑铃推肩', '上肢·垂直推', '哑铃', '肩部容量'],
    ['T2', '潘德雷划船', '上肢·水平拉', '杠铃', '躯干平行地面划船'],
    ['T2', '坐姿划船', '上肢·水平拉', '绳索/器械', '背部厚度'],
    ['T2', '引体向上', '上肢·垂直拉', '自重', '背阔肌主项'],
    ['T2', '杠铃弯举', '上肢·屈肘', '杠铃', '二头主项'],
    ['T2', '绳索下压', '上肢·伸肘', '绳索', '三头主项'],
    ['T3', '高位下拉', '上肢·垂直拉', '器械', '背阔肌容量'],
    ['T3', '俯身划船', '上肢·水平拉', '杠铃', '背部容量'],
    ['T3', '反向飞鸟', '肩·后束', '哑铃', '三角肌后束'],
    ['T3', '面拉', '肩·后束', '绳索', '肩袖与后束'],
    ['T3', '哑铃侧平举', '肩·中束', '哑铃', '三角肌中束'],
    ['T3', '俯卧腿弯举', '下肢·屈膝', '器械', '腘绳肌容量'],
    ['T3', '坐姿腿屈伸', '下肢·伸膝', '器械', '股四头肌容量'],
    ['T3', '杠铃二头弯举', '上肢·屈肘', '杠铃', '二头容量'],
    ['T3', '绳索三头屈伸', '上肢·伸肘', '绳索', '三头容量'],
    ['T3', '哑铃耸肩', '肩·斜方', '哑铃', '斜方肌容量'],
    ['T3', '提踵', '下肢·踝', '器械/自重', '小腿容量'],
    ['T3', '卷腹', '核心·屈曲', '自重', '腹直肌'],
    ['T3', '悬垂举腿', '核心·屈髋', '自重', '下腹与髋屈肌'],
    ['T3', '保加利亚分腿蹲', '下肢·单腿', '哑铃', '单腿稳定与臀部'],
    ['T3', '山羊挺身', '下背·伸髋', '器械', '竖脊肌'],
    ['T1', '低杠深蹲', '下肢·蹲', '杠铃', '杠铃置于后三角肌，髋部参与更多'],
    ['T1', '箱式深蹲', '下肢·蹲', '杠铃', '坐箱停顿，强化底部发力'],
    ['T1', '赤字硬拉', '下肢·髋铰链', '杠铃', '站在垫高平台上拉，强化起拉段'],
    ['T2', '前蹲', '下肢·蹲', '杠铃', '股四头肌与核心'],
    ['T2', '哈克深蹲', '下肢·蹲', '器械', '股四头肌容量'],
    ['T2', '臀推', '下肢·髋伸', '杠铃', '臀大肌主导'],
    ['T2', '哑铃卧推', '上肢·水平推', '哑铃', '活动范围大，左右均衡'],
    ['T2', '上斜哑铃卧推', '上肢·水平推', '哑铃', '上胸容量'],
    ['T2', 'T杠划船', '上肢·水平拉', '杠铃', '背部厚度'],
    ['T2', '单臂哑铃划船', '上肢·水平拉', '哑铃', '单侧背阔'],
    ['T2', '负重引体向上', '上肢·垂直拉', '自重/负重', '背阔力量'],
    ['T3', '锤式弯举', '上肢·屈肘', '哑铃', '肱桡肌与二头'],
    ['T3', '哑铃弯举', '上肢·屈肘', '哑铃', '二头容量'],
    ['T3', '绳索夹胸', '上肢·水平内收', '绳索', '胸大肌孤立'],
    ['T3', '直臂下压', '上肢·垂直拉', '绳索', '背阔孤立'],
    ['T3', '腿外展', '下肢·髋外展', '器械', '臀中肌'],
    ['T3', '高脚杯深蹲', '下肢·蹲', '哑铃', '深蹲模式容量']
  ].map(function (r) { return { tier: r[0], name: r[1], part: r[2], equip: r[3], desc: r[4] }; });

  function libFind(name) {
    for (var i = 0; i < LIB.length; i++) if (LIB[i].name === name) return LIB[i];
    return null;
  }
  var PARTS = ['下肢·蹲', '下肢·髋铰链', '下肢·髋伸', '下肢·屈膝', '下肢·伸膝', '下肢·单腿', '上肢·水平推', '上肢·垂直推', '上肢·水平拉', '上肢·垂直拉',
    '上肢·屈肘', '上肢·伸肘', '肩·中束', '肩·后束', '核心', '其他'];
  var EQUIPS = ['杠铃', '哑铃', '器械', '绳索', '自重', '自重/负重', '壶铃', '其他'];
  // 动作库 = 内置 + 自定义
  function libAll(db) {
    var custom = (db && db.customLib) || [];
    return custom.map(function (x) { return Object.assign({ custom: true }, x); }).concat(LIB);
  }
  function libFindIn(db, name) {
    var all = libAll(db);
    for (var i = 0; i < all.length; i++) if (all[i].name === name) return all[i];
    return null;
  }
  function addCustomEx(db, ex) {
    var name = String(ex.name || '').trim();
    if (!name) return '请填写动作名称';
    if (name.length > 16) return '名称最多 16 个字';
    if (libFindIn(db, name)) return '动作库里已有「' + name + '」';
    db.customLib = db.customLib || [];
    db.customLib.unshift({ tier: ex.tier || 'T3', name: name, part: ex.part || '其他', equip: ex.equip || '其他', desc: String(ex.desc || '').trim() || '自定义动作' });
    return '';
  }
  function removeCustomEx(db, name) { db.customLib = (db.customLib || []).filter(function (x) { return x.name !== name; }); }

  // ---------- 默认数据（来自 Excel 当前填写） ----------
  function slot(id, tier, name, init, step, roundProg, lift) {
    var lib = libFind(name);
    return {
      id: id, tier: tier, name: name, equip: lib ? lib.equip : '', init: init,
      step: step, roundProg: !!roundProg, lift: lift || null
    };
  }
  function pct(base, p) { return { type: 'pct', base: base, pct: p }; }
  function fixed(v) { return { type: 'fixed', value: v }; }

  /**
   * GZCLP 四天模板（扩展容量版，每天 1×T1 + 2×T2 + 2×T3）
   * 设计原则：
   *  - T1 四大项不变：A1 深蹲 / B1 实力推 / A2 卧推 / B2 硬拉
   *  - 每个 T2/T3 动作在整套计划里唯一，不跨天重复（避免同名动作出现两套独立重量，造成理解/误操作成本）
   *  - T2 配该训练日主题的相关复合动作；T3 补齐背、肩、臂、腿等孤立肌群，保证全身均衡
   *  - 加重按「每次练到该动作时推进」：四天轮转里每个动作每轮（每周）出现一次，所以表现为每周加重，符合 GZCLP
   */
  function defaultDays() {
    return [
      { id: 'A1', name: '下肢蹲主导', slots: [
        slot('A1_1', 'T1', '杠铃深蹲', pct('squat', 0.85), 't1l', false, 'squat'),
        slot('A1_2', 'T2', '前蹲', pct('squat', 0.6), 't2l'),
        slot('A1_3', 'T2', '上斜卧推', pct('bench', 0.55), 't2u'),
        slot('A1_4', 'T3', '高位下拉', fixed(30), 't3u', true),
        slot('A1_5', 'T3', '俯卧腿弯举', fixed(20), 't3l', false)
      ] },
      { id: 'B1', name: '垂直推主导', slots: [
        slot('B1_1', 'T1', '站姿实力推', pct('ohp', 0.85), 't1u', false, 'ohp'),
        slot('B1_2', 'T2', '坐姿哑铃推肩', pct('ohp', 0.6), 't2u'),
        slot('B1_3', 'T2', '罗马尼亚硬拉', pct('deadlift', 0.6), 't2l'),
        slot('B1_4', 'T3', '引体向上', fixed(0), 't3u', true),
        slot('B1_5', 'T3', '哑铃侧平举', fixed(8), 't3u', true)
      ] },
      { id: 'A2', name: '水平推主导', slots: [
        slot('A2_1', 'T1', '平板卧推', pct('bench', 0.85), 't1u', false, 'bench'),
        slot('A2_2', 'T2', '窄距卧推', pct('bench', 0.65), 't2u'),
        slot('A2_3', 'T2', '杠铃后蹲', pct('squat', 0.7), 't2l'),
        slot('A2_4', 'T3', '杠铃弯举', fixed(20), 't3u', true),
        slot('A2_5', 'T3', '绳索三头屈伸', pct('bench', 0.5), 't3u', true)
      ] },
      { id: 'B2', name: '水平拉主导', slots: [
        slot('B2_1', 'T1', '传统硬拉', pct('deadlift', 0.85), 't1l', false, 'deadlift'),
        slot('B2_2', 'T2', '潘德雷划船', pct('deadlift', 0.55), 't2u'),
        slot('B2_3', 'T2', '坐姿划船', fixed(35), 't2u'),
        slot('B2_4', 'T3', '面拉', fixed(15), 't3u', true),
        slot('B2_5', 'T3', '哑铃弯举', fixed(12), 't3u', true)
      ] }
    ];
  }

  function defaultParams() {
    return {
      oneRM: { bench: 70, deadlift: 100, squat: 80, ohp: 30 },
      tmRatio: 0.9,
      steps: { t1u: 2.5, t1l: 5, t2u: 2.5, t2l: 5, t3u: 1.25, t3l: 2.5 },
      t3Threshold: 25,
      rounding: 2.5,
      barWeight: 20,
      plates: [25, 20, 15, 10, 5, 2.5, 1.25],
      ruleMode: 'full', // full = 按「进阶规则备查」完整三阶；excel = 严格按表格公式
      totalWeeks: 8,
      deloadEnabled: true,
      deloadEvery: 6,
      t1FailLimit: 2
    };
  }

  // Excel 中已填写的第 1 周数据（A1、B1），作为初始记录导入
  function excelSeedRecords() {
    return [
      { id: 'xls_A1_w1', date: '2026-10-13', day: 'A1', deload: false, note: '从 Excel 导入（日期可编辑）', bw: null, createdAt: 1,
        entries: { A1_1: { v: 10 }, A1_2: { v: '完成' }, A1_3: { v: '完成' }, A1_4: { v: 15 }, A1_5: { v: 19 } } },
      { id: 'xls_B1_w1', date: '2026-10-14', day: 'B1', deload: false, note: '从 Excel 导入（日期可编辑）', bw: null, createdAt: 2,
        entries: { B1_1: { v: 12 }, B1_2: { v: '完成' }, B1_3: { v: '完成' }, B1_4: { v: 17 }, B1_5: { v: 18 } } }
    ];
  }

  function defaults(withSeed) {
    return { version: VERSION, daysVersion: DAYS_VERSION, params: defaultParams(), days: defaultDays(), records: withSeed === false ? [] : excelSeedRecords() };
  }

  function normalize(db) {
    if (!db || !db.params || !db.days) return defaults(true);
    var p = defaultParams();
    db.params = Object.assign(p, db.params);
    db.params.oneRM = Object.assign(defaultParams().oneRM, db.params.oneRM);
    db.params.steps = Object.assign(defaultParams().steps, db.params.steps);
    db.records = db.records || [];
    db.customLib = db.customLib || [];
    // 动作库刷新迁移：把未被用户永久更换过（无 changes）的 T2/T3 槽位同步为最新默认动作，
    // 保留用户已手动更换的槽位；T1 四大项默认不变。记录按槽位 ID 存储，不受动作名变化影响。
    if (db.daysVersion !== DAYS_VERSION) {
      var fresh = defaultDays();
      db.days.forEach(function (d) {
        var nd = fresh.filter(function (x) { return x.id === d.id; })[0];
        if (!nd) return;
        d.slots.forEach(function (s) {
          if (s.changes && s.changes.length) return; // 用户已永久更换，保留
          var ns = nd.slots.filter(function (x) { return x.id === s.id; })[0];
          if (!ns) return;
          s.name = ns.name; s.equip = ns.equip; s.tier = ns.tier;
          s.init = ns.init; s.step = ns.step; s.roundProg = ns.roundProg; s.lift = ns.lift;
        });
      });
      db.daysVersion = DAYS_VERSION;
    }
    return db;
  }

  // ---------- 数学工具 ----------
  function fix(n) { return Math.round(n * 100) / 100; }
  // Excel ROUND(x/inc,0)*inc，四舍五入远离 0
  function roundTo(x, inc) {
    inc = inc || 2.5;
    var q = x / inc;
    var r = q >= 0 ? Math.floor(q + 0.5 + 1e-9) : -Math.floor(-q + 0.5 + 1e-9);
    return fix(r * inc);
  }
  function tm(P, lift) { return fix(P.oneRM[lift] * P.tmRatio); }
  function initWeight(s, P) {
    if (!s.init) return 0;
    if (s.init.type === 'fixed') return Number(s.init.value) || 0;
    return roundTo(tm(P, s.init.base) * s.init.pct, P.rounding);
  }
  function fmtW(w) {
    if (w === null || w === undefined || isNaN(w)) return '—';
    return (Math.round(w * 100) / 100).toString();
  }
  function platesFor(weight, P, equip) {
    if (equip !== '杠铃') return '';
    var side = (weight - P.barWeight) / 2;
    if (side < -1e-9) return '轻于空杆';
    if (side < 1e-9) return '空杆';
    var list = [], left = side;
    var plates = (P.plates || []).slice().sort(function (a, b) { return b - a; });
    for (var i = 0; i < plates.length; i++) {
      while (left + 1e-9 >= plates[i]) { list.push(plates[i]); left = fix(left - plates[i]); }
    }
    var txt = '每侧 ' + list.join('+');
    if (left > 1e-9) txt += '（差' + fmtW(left) + '）';
    return txt;
  }

  function linreg(points) {
    var n = points.length;
    if (n < 2) return null;
    var sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    points.forEach(function (p) { sx += p[0]; sy += p[1]; sxx += p[0] * p[0]; sxy += p[0] * p[1]; syy += p[1] * p[1]; });
    var den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) return null;
    var slope = (n * sxy - sx * sy) / den;
    var intercept = (sy - slope * sx) / n;
    var ssTot = syy - sy * sy / n, ssRes = 0;
    points.forEach(function (p) { var e = p[1] - (slope * p[0] + intercept); ssRes += e * e; });
    var r2 = ssTot < 1e-12 ? 1 : Math.max(0, 1 - ssRes / ssTot);
    return { slope: slope, intercept: intercept, r2: r2, n: n, predict: function (x) { return slope * x + intercept; } };
  }

  // ---------- 判定（核心规则） ----------
  function stageDef(tier, stage) { return STAGES[tier][stage] || STAGES[tier][FIRST_STAGE[tier]]; }
  function hasValue(e) { return e && e.v !== null && e.v !== undefined && e.v !== '' && !e.skip; }

  /**
   * @param s 槽位  @param st 当前状态 {stage, weight, fail}  @param e 本次输入 {v, reps, new5RM, skip}
   * @return 结果对象（含判定、下次阶段、下次重量、容量、e1RM）
   */
  function manualW(e) {
    if (!e || e.w === undefined || e.w === null || e.w === '') return null;
    var n = Number(e.w);
    return isNaN(n) || n < 0 ? null : fix(n);
  }
  function evaluate(s, st, e, P, deload) {
    var def = stageDef(s.tier, st.stage);
    var planned = st.weight, mw = manualW(e), step = P.steps[s.step] || 0;
    // 手动重量：本次按实际重量计算判定，下次重量在实际重量上推进
    var w = mw !== null && !deload ? mw : planned;
    var r = {
      slotId: s.id, tier: s.tier, name: s.name, equip: s.equip, lift: s.lift,
      stage: st.stage, sets: def.sets, reps: def.reps, weight: w, planned: planned, manual: mw !== null, fail: st.fail || 0,
      input: e ? e.v : null, judgment: '', nextStage: st.stage, nextWeight: w, nextFail: st.fail || 0,
      volume: 0, e1rm: null, delta: 0, deload: false
    };
    if (deload) {
      var f = s.tier === 'T1' ? 0.5 : s.tier === 'T2' ? 0.6 : 1;
      r.deload = true;
      r.autoWeight = s.tier === 'T3' ? planned : roundTo(planned * f, P.rounding);
      r.dWeight = mw !== null ? mw : r.autoWeight;
      r.dSets = s.tier === 'T3' ? Math.max(1, def.sets - 1) : def.sets;
      r.judgment = '减载';
      r.nextWeight = planned; // 减载不改变进阶链
      r.volume = e && e.skip ? 0 : fix(r.dWeight * r.dSets * def.reps);
      return r;
    }
    r.autoWeight = planned;
    if (!hasValue(e)) { r.judgment = '跳过'; r.input = null; r.nextWeight = planned; return r; }

    var mode = P.ruleMode;
    if (s.tier === 'T1') {
      var a = Number(e.v);
      r.volume = fix(w * ((def.sets - 1) * def.reps + a));
      if (a > 0) r.e1rm = fix(w * (1 + a / 30));
      if (mode === 'excel') {
        // =IF(F>=6,"加重",IF(F>=3,"保持","建议降阶")) / =IF(F>=3,"5×3+","6×2+") / =IF(F>=6,E+步幅,E)
        r.judgment = a >= 6 ? '加重' : a >= 3 ? '保持' : '建议降阶';
        r.nextStage = a >= 3 ? '5×3+' : '6×2+';
        r.nextWeight = a >= 6 ? fix(w + step) : w;
        r.nextFail = 0;
      } else {
        if (a >= def.add) { r.judgment = '加重'; r.nextWeight = fix(w + step); r.nextFail = 0; }
        else if (a >= def.hold && def.next !== null) { r.judgment = '保持'; r.nextFail = 0; }
        else if (def.next === null) {
          // 10×1+ 未达标：测试新 5RM，取 90% 为新 TM，重置回 5×3+
          r.judgment = '重置'; r.nextStage = FIRST_STAGE.T1; r.nextFail = 0;
          var p0 = s.init && s.init.type === 'pct' ? s.init.pct : 0.85;
          r.nextWeight = e.new5RM ? roundTo(Number(e.new5RM) * P.tmRatio * p0, P.rounding) : roundTo(w * 0.85, P.rounding);
          r.reset5RM = e.new5RM || null;
        } else {
          var fails = (st.fail || 0) + 1;
          if (fails >= (P.t1FailLimit || 2)) { r.judgment = '降阶'; r.nextStage = def.next; r.nextFail = 0; }
          else { r.judgment = '建议降阶'; r.nextFail = fails; }
        }
      }
    } else if (s.tier === 'T2') {
      var done = e.v === '完成';
      var actual = done ? def.sets * def.reps : (e.reps !== undefined && e.reps !== null && e.reps !== '' ? Number(e.reps) : def.sets * def.reps - 2);
      r.volume = fix(w * actual);
      r.actualReps = actual;
      // =IF(F="完成","加重","退阶") / 下次阶段 3×10→3×8→3×6→3×10 / =IF(OR(F="完成",D="3×6"),E+步幅,E)
      if (done) { r.judgment = '加重'; r.nextStage = '3×10'; r.nextWeight = fix(w + step); }
      else if (st.stage === '3×6') { r.judgment = mode === 'excel' ? '退阶' : '重置'; r.nextStage = '3×10'; r.nextWeight = fix(w + step); }
      else { r.judgment = '退阶'; r.nextStage = def.next; r.nextWeight = w; }
    } else {
      var t = Number(e.v);
      r.volume = fix(w * ((def.sets - 1) * def.reps + t));
      // =IF(F>=阈值,"加重","保持") / 上肢：ROUND((E+步幅)/2.5)*2.5
      if (t >= P.t3Threshold) { r.judgment = '加重'; r.nextWeight = s.roundProg ? roundTo(w + step, P.rounding) : fix(w + step); }
      else { r.judgment = '保持'; r.nextWeight = s.roundProg ? roundTo(w, P.rounding) : w; }
    }
    r.delta = fix(r.nextWeight - w);
    return r;
  }

  // ---------- 回放 ----------
  function sortRecords(recs) {
    return recs.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }
  function dayById(db, id) { for (var i = 0; i < db.days.length; i++) if (db.days[i].id === id) return db.days[i]; return null; }
  function initialStates(db) {
    var st = {};
    db.days.forEach(function (d) {
      d.slots.forEach(function (s) { st[s.id] = { stage: FIRST_STAGE[s.tier], weight: initWeight(s, db.params), fail: 0 }; });
    });
    return st;
  }
  /** 某训练日第 week 次时，槽位实际执行的动作（考虑“从某周起更换”） */
  function effectiveSlot(db, s, week) {
    var ch = null;
    (s.changes || []).forEach(function (c) { if (c.fromWeek <= week && (!ch || c.fromWeek >= ch.fromWeek)) ch = c; });
    if (!ch) return { slot: s, change: null, resetNow: false };
    var lib = libFindIn(db, ch.name);
    return { slot: Object.assign({}, s, { name: ch.name, equip: ch.equip || (lib ? lib.equip : '') }), change: ch, resetNow: ch.fromWeek === week };
  }
  /** 执行一个槽位：处理“更换起始周重置”和“仅本次替换” */
  function runSlot(db, s, st, e, week, deload) {
    var ef = effectiveSlot(db, s, week);
    if (ef.resetNow) st = { stage: FIRST_STAGE[s.tier], weight: ef.change.weight, fail: 0 };
    var res;
    if (e && e.ex && e.ex !== ef.slot.name) {
      var lib = libFindIn(db, e.ex);
      res = evaluate(Object.assign({}, ef.slot, { name: e.ex, equip: lib ? lib.equip : '' }), st, e, db.params, deload);
      // 仅本次替换：记录容量，但不推进原动作的阶段与重量
      if (!res.deload && res.judgment !== '跳过') { res.judgment = '替换'; res.e1rm = null; }
      res.nextStage = st.stage; res.nextWeight = st.weight; res.nextFail = st.fail || 0; res.delta = 0;
      res.sub = true; res.origName = ef.slot.name;
    } else {
      res = evaluate(ef.slot, st, e, db.params, deload);
    }
    res.changed = !!ef.change;
    return { res: res, st: st, eff: ef };
  }
  // ---------- 多轮循环（每 N 周为一轮，完成一轮后进入下一轮） ----------
  function cycleLen(P) { return Math.max(1, P.weeksPerCycle || P.totalWeeks || 8); }
  function cycleOf(week, P) {
    var N = cycleLen(P);
    return { cycle: Math.floor((week - 1) / N) + 1, wc: ((week - 1) % N) + 1, N: N };
  }
  // 绝对周 → 该轮的第 1 个绝对周
  function cycleStartWeek(cycle, P) { return (cycle - 1) * cycleLen(P) + 1; }
  function weekText(week, P) {
    var c = cycleOf(week, P);
    return c.cycle > 1 ? '第 ' + c.cycle + ' 轮 · 第 ' + c.wc + ' 周' : '第 ' + c.wc + ' 周';
  }
  // 减载按「每轮内的周序」判断：如每轮第 6 周减载（默认 deloadEvery=6）
  function isDeloadWeek(week, P) {
    if (!P.deloadEnabled || !(P.deloadEvery > 0)) return false;
    var wc = cycleOf(week, P).wc;
    return wc % P.deloadEvery === 0;
  }

  /** opts.untilId：回放到某条记录之前（用于编辑历史记录） */
  function replay(db, opts) {
    opts = opts || {};
    var states = initialStates(db), counts = {}, sessions = [];
    DAY_ORDER.forEach(function (d) { counts[d] = 0; });
    db.days.forEach(function (d) { counts[d.id] = 0; });
    var recs = sortRecords(db.records), before = null;
    for (var i = 0; i < recs.length; i++) {
      var rec = recs[i];
      if (opts.untilId && rec.id === opts.untilId) {
        before = { states: JSON.parse(JSON.stringify(states)), week: counts[rec.day] + 1 };
        continue;
      }
      var day = dayById(db, rec.day);
      if (!day) continue;
      counts[rec.day] += 1;
      var week = counts[rec.day], items = [], vol = { T1: 0, T2: 0, T3: 0 };
      day.slots.forEach(function (s) {
        var res = runSlot(db, s, states[s.id], rec.entries ? rec.entries[s.id] : null, week, rec.deload).res;
        items.push(res);
        vol[s.tier] += res.volume;
        states[s.id] = { stage: res.nextStage, weight: res.nextWeight, fail: res.nextFail };
      });
      sessions.push({ rec: rec, week: week, dayName: day.name, items: items, volume: fix(vol.T1 + vol.T2 + vol.T3), vol: vol, index: sessions.length });
    }
    return { states: states, counts: counts, sessions: sessions, before: before };
  }

  /**
   * 周轮次：当前周 = 四个训练日中完成次数最少者 + 1
   * 本周 A1/B1/A2/B2 全部完成后，才整体进入下一周（避免本周与下周内容混在同一时间线）
   */
  function roundInfo(db, rp) {
    rp = rp || replay(db);
    var ids = db.days.map(function (d) { return d.id; });
    var minC = Math.min.apply(null, ids.map(function (id) { return rp.counts[id] || 0; }));
    var week = minC + 1;
    var days = db.days.map(function (d) {
      var done = (rp.counts[d.id] || 0) >= week, sess = null;
      if (done) rp.sessions.forEach(function (x) { if (x.rec.day === d.id && x.week === week) sess = x; });
      return { id: d.id, name: d.name, done: done, recordId: sess ? sess.rec.id : null, date: sess ? sess.rec.date : '' };
    });
    var left = days.filter(function (d) { return !d.done; });
    return { week: week, done: days.length - left.length, total: days.length, days: days,
      next: (left[0] || days[0]).id, left: left.map(function (d) { return d.id; }), leftText: left.map(function (d) { return d.id; }).join('、') };
  }
  function recommend(db, rp) {
    var r = roundInfo(db, rp);
    return { day: r.next, week: r.week };
  }
  function lastWeights(rp) {
    var m = {};
    rp.sessions.forEach(function (x) { x.items.forEach(function (it) { if (!it.deload && it.judgment !== '跳过') m[it.name] = it.weight; }); });
    return m;
  }
  function logView(s) {
    return { id: s.rec.id, date: s.rec.date, dateText: dateLabel(s.rec.date), day: s.rec.day, dayName: s.dayName, week: s.week, note: s.rec.note || '', bw: s.rec.bw || '',
      deload: !!s.rec.deload, vol: Math.round(s.volume),
      items: s.items.map(function (it) {
        return { tier: it.tier, tierColor: TIER_COLORS[it.tier], name: it.name, stage: it.stage, sub: !!it.sub, origName: it.origName || '',
          w: fmtW(it.deload ? it.dWeight : it.weight), manual: !!it.manual && !it.sub, planned: fmtW(it.planned), input: it.input === null ? '—' : it.input,
          j: it.judgment, color: JUDGE_COLORS[it.judgment] || '#8E8E93', next: it.deload || it.judgment === '跳过' ? '' : it.sub ? '替代 ' + it.origName + '，不影响进阶' : '下次 ' + fmtW(it.nextWeight) + ' kg · ' + it.nextStage };
      }) };
  }

  // ---------- 视图模型：训练页 ----------
  function blankDraft(db, dayId) {
    var d = dayById(db, dayId), entries = {};
    d.slots.forEach(function (s) { entries[s.id] = { v: null, done: 0 }; });
    return entries;
  }

  function buildTrain(db, opts) {
    var P = db.params, rp = replay(db, { untilId: opts.recordId || null });
    var full = opts.recordId ? replay(db) : rp, round = roundInfo(db, full), rec = { day: round.next, week: round.week };
    var dayId = opts.day || rec.day, day = dayById(db, dayId);
    var states = rp.before ? rp.before.states : rp.states;
    var week = rp.before ? rp.before.week : rp.counts[dayId] + 1;
    // 本周已完成的训练日：锁定，只能查看 / 修改，不能提前开练下一周
    var rd = round.days.filter(function (d) { return d.id === dayId; })[0];
    var locked = !opts.recordId && rd && rd.done;
    var lockedInfo = null;
    if (locked) {
      week = round.week;
      var ls = full.sessions.filter(function (x) { return x.rec.id === rd.recordId; })[0];
      lockedInfo = ls ? logView(ls) : null;
    }
    var deloadSuggest = isDeloadWeek(week, P);
    var deload = opts.deload === undefined ? deloadSuggest : !!opts.deload;
    var draft = opts.draft || blankDraft(db, dayId);
    var filled = 0, total = 0, lastW = lastWeights(full);
    var items = day.slots.map(function (s0) {
      var e = draft[s0.id] || (draft[s0.id] = { v: null, done: 0 });
      // 仅本次替换：起始重量默认取该动作上次做过的重量，没有则沿用原计划重量
      var subDefault = null;
      if (e.ex) {
        var ef0 = effectiveSlot(db, s0, week), st0 = ef0.resetNow ? { weight: ef0.change.weight } : states[s0.id];
        if (e.ex === ef0.slot.name) { delete e.ex; }
        else {
          subDefault = lastW[e.ex] !== undefined ? lastW[e.ex] : st0.weight;
          if (manualW(e) === null) e.w = subDefault;
        }
      }
      var run = runSlot(db, s0, states[s0.id], e, week, deload), res = run.res, st = run.st, s = run.eff.slot;
      var def = stageDef(s.tier, st.stage);
      var showW = deload ? res.dWeight : res.weight;
      if (res.sub && !deload) showW = res.weight;
      var showSets = deload ? res.dSets : def.sets;
      total += 1; if (hasValue(e) || e.skip) filled += 1;
      var dots = [];
      for (var k = 0; k < showSets; k++) dots.push({ i: k, on: k < (e.done || 0), amrap: !deload && s.tier !== 'T2' && k === showSets - 1 });
      return {
        slotId: s.id, tier: s.tier, tierColor: TIER_COLORS[s.tier], name: res.name, equip: res.equip,
        planName: s.name, sub: !!res.sub, changed: !!run.eff.change, changeNew: !!run.eff.resetNow,
        stage: st.stage, sets: showSets, reps: def.reps, weight: showW, weightText: fmtW(showW),
        plates: platesFor(showW, P, res.equip), fail: res.sub ? 0 : (st.fail || 0),
        restText: fmtRest(REST[s.tier]),
        manual: res.sub ? manualW(e) !== subDefault : res.manual, autoWeight: res.sub ? subDefault : res.autoWeight, autoText: fmtW(res.sub ? subDefault : res.autoWeight), wStep: P.rounding || 2.5, editW: !!e.editW,
        repsText: showSets + '×' + def.reps + (s.tier !== 'T2' && !deload ? '+' : ''),
        inputType: deload ? 'deload' : s.tier === 'T2' ? 'done' : 'amrap',
        amrapHint: s.tier === 'T1' ? ('≥' + def.add + ' 加重' + (def.next ? ' · <' + def.hold + ' 预警' : ' · <' + def.add + ' 重置')) : s.tier === 'T3' ? ('≥' + P.t3Threshold + ' 加重') : '',
        value: e.v, reps2: e.reps, skip: !!e.skip, new5RM: e.new5RM || '', done: e.done || 0, dots: dots,
        need5RM: s.tier === 'T1' && P.ruleMode !== 'excel' && st.stage === '10×1+',
        rest: REST[s.tier],
        preview: (hasValue(e) || deload) ? {
          judgment: res.judgment, color: JUDGE_COLORS[res.judgment] || '#8E8E93', icon: JUDGE_ICON[res.judgment] || '',
          nextStage: res.nextStage, nextWeight: fmtW(res.nextWeight), stageChanged: res.nextStage !== st.stage,
          delta: res.delta > 0 ? '+' + fmtW(res.delta) : res.delta < 0 ? fmtW(res.delta) : '±0',
          e1rm: res.e1rm ? fmtW(Math.round(res.e1rm * 10) / 10) : '', volume: Math.round(res.volume), sub: !!res.sub, origName: res.origName || ''
        } : null
      };
    });
    var cyc = cycleOf(week, P);
    return {
      day: dayId, dayName: day.name, week: week, totalWeeks: P.totalWeeks, recommended: rec.day,
      cycle: cyc.cycle, weekInCycle: cyc.wc, weeksPerCycle: cyc.N, weekText: weekText(week, P),
      deload: deload, deloadSuggest: deloadSuggest, items: items, filled: filled, total: total,
      days: round.days.map(function (d) { return { id: d.id, name: d.name, done: d.done, rec: !d.done && d.id === rec.day }; }),
      round: { week: round.week, done: round.done, total: round.total, leftText: round.leftText, left: round.left.length, nextWeek: round.week + 1, nextWeekText: weekText(round.week + 1, P), pct: Math.round(round.done / round.total * 100) },
      locked: !!locked, lockedInfo: lockedInfo,
      ruleMode: P.ruleMode, editing: !!opts.recordId
    };
  }

  // ---------- 视图模型：计划页（按轮显示，每轮 N 周 × 4 日） ----------
  function buildPlan(db, opts) {
    opts = opts || {};
    var P = db.params, rp = replay(db), rec = recommend(db, rp), N = cycleLen(P);
    var byDayWeek = {};
    rp.sessions.forEach(function (s) { byDayWeek[s.rec.day + '_' + s.week] = s; });
    // 已产生数据的最大绝对周 & 当前进行到的轮
    var maxDoneWeek = Math.max.apply(null, [0].concat(db.days.map(function (d) { return rp.counts[d.id] || 0; })));
    var curCycle = cycleOf(rec.week, P).cycle;
    var dataCycle = cycleOf(Math.max(maxDoneWeek, 1), P).cycle;
    var maxCycle = Math.max(curCycle, dataCycle) + 1; // 允许向后预览一轮
    var cycle = Math.min(Math.max(opts.cycle || curCycle, 1), maxCycle);
    var base = cycleStartWeek(cycle, P);
    var rows = [];
    for (var i = 0; i < N; i++) {
      var w = base + i;
      var cells = db.days.map(function (d) {
        var key = d.id + '_' + w, s = byDayWeek[key], t1 = d.slots[0];
        if (s) {
          var it = s.items[0];
          return { day: d.id, week: w, status: 'done', date: s.rec.date.slice(5), recordId: s.rec.id,
            w: fmtW(it.deload ? it.dWeight : it.weight), j: it.judgment, color: JUDGE_COLORS[it.judgment] || '#8E8E93', deload: !!s.rec.deload };
        }
        var cnt = rp.counts[d.id] || 0, ahead = w - cnt - 1; // 0 = 下一次
        var st = rp.states[t1.id];
        // 理想推演：每次正常训练都加重；减载周不推进
        var adds = 0;
        for (var k = cnt + 1; k < w; k++) if (!isDeloadWeek(k, P)) adds++;
        var proj = st.weight + (P.steps[t1.step] || 0) * adds;
        if (isDeloadWeek(w, P)) proj = roundTo(proj * 0.5, P.rounding);
        return { day: d.id, week: w, status: (d.id === rec.day && ahead === 0) ? 'next' : (ahead === 0 && w === rec.week ? 'ready' : 'todo'),
          w: fmtW(fix(proj)), j: ahead === 0 ? '计划' : '理想', color: '#8E8E93', deload: isDeloadWeek(w, P) };
      });
      rows.push({ week: w, wc: i + 1, deload: isDeloadWeek(w, P), cells: cells });
    }
    var overview = db.days.map(function (d) {
      var nw = (rp.counts[d.id] || 0) + 1;
      return { day: d.id, name: d.name, slots: d.slots.map(function (s0) {
        var ef = effectiveSlot(db, s0, nw), s = ef.slot;
        var st = ef.resetNow ? { stage: FIRST_STAGE[s.tier], weight: ef.change.weight, fail: 0 } : rp.states[s0.id], last = null;
        for (var i = rp.sessions.length - 1; i >= 0; i--) {
          if (rp.sessions[i].rec.day === d.id) {
            var f = rp.sessions[i].items.filter(function (x) { return x.slotId === s.id; })[0];
            if (f && f.judgment !== '跳过' && !f.sub && f.name === s.name) { last = f; break; }
          }
        }
        var start = ef.change ? ef.change.weight : initWeight(s, P);
        return { id: s.id, changed: !!ef.change, tier: s.tier, tierColor: TIER_COLORS[s.tier], name: s.name, stage: st.stage, weight: fmtW(st.weight),
          gain: st.weight - start > 0 ? '+' + fmtW(fix(st.weight - start)) : '', fail: st.fail,
          last: last ? last.judgment : '—', lastColor: last ? JUDGE_COLORS[last.judgment] : '#C7C7CC' };
      }) };
    });
    var done = rp.sessions.length, nd = db.days.length;
    // 本轮进度：始终统计「当前进行中那一轮」的训练次数（不随浏览的轮次变化）
    var curBase = cycleStartWeek(curCycle, P);
    var cycDone = rp.sessions.filter(function (s) { return s.week >= curBase && s.week < curBase + N; }).length;
    var cycPlanned = N * nd;
    var recCyc = cycleOf(rec.week, P);
    return { rows: rows, overview: overview, days: db.days.map(function (d) { return { id: d.id, name: d.name }; }),
      done: done, planned: P.totalWeeks * nd, progress: Math.min(100, Math.round(done / (P.totalWeeks * nd) * 100)),
      cycle: cycle, curCycle: curCycle, maxCycle: maxCycle, weeksPerCycle: N,
      cycleText: '第 ' + cycle + ' 轮', isCurCycle: cycle === curCycle, isFuture: cycle > curCycle,
      canPrev: cycle > 1, canNext: cycle < maxCycle,
      cycleDone: cycDone, cyclePlanned: cycPlanned, cycleProgress: Math.min(100, Math.round(cycDone / cycPlanned * 100)),
      next: { day: rec.day, week: rec.week, name: dayById(db, rec.day).name, deload: isDeloadWeek(rec.week, P),
        cycle: recCyc.cycle, weekInCycle: recCyc.wc, weekText: weekText(rec.week, P) } };
  }

  // ---------- 视图模型：数据统计 ----------
  function liftSlots(db) {
    var map = {};
    var rp = replay(db);
    db.days.forEach(function (d) { d.slots.forEach(function (s) {
      if (s.tier === 'T1') map[s.lift || s.id] = { slot: s, day: d, name: effectiveSlot(db, s, (rp.counts[d.id] || 0) + 1).slot.name };
    }); });
    return map;
  }

  function buildStats(db) {
    var P = db.params, rp = replay(db), S = rp.sessions;
    var judged = { '加重': 0, '保持': 0, '建议降阶': 0, '降阶': 0, '退阶': 0, '重置': 0 };
    var t1n = 0, t1ok = 0, t2n = 0, t2ok = 0, t3n = 0, t3add = 0, totalVol = 0, reps = 0;
    S.forEach(function (s) {
      totalVol += s.volume;
      s.items.forEach(function (it) {
        if (judged[it.judgment] !== undefined) judged[it.judgment] += 1;
        if (it.deload || it.judgment === '跳过') return;
        if (it.tier === 'T1') { t1n++; if (it.judgment === '加重' || it.judgment === '保持') t1ok++; reps += (it.sets - 1) * it.reps + Number(it.input); }
        if (it.tier === 'T2') { t2n++; if (it.input === '完成') t2ok++; reps += it.actualReps || 0; }
        if (it.tier === 'T3') { t3n++; if (it.judgment === '加重') t3add++; reps += (it.sets - 1) * it.reps + Number(it.input); }
      });
    });
    var pieSum = Object.keys(judged).reduce(function (a, k) { return a + judged[k]; }, 0);
    var pie = Object.keys(judged).filter(function (k) { return judged[k] > 0; }).map(function (k) { return { label: k, value: judged[k], color: JUDGE_COLORS[k], pct: Math.round(judged[k] / pieSum * 100) }; });

    // 每周容量（按循环周）
    var maxWeek = 0; S.forEach(function (s) { maxWeek = Math.max(maxWeek, s.week); });
    var weeks = Math.max(maxWeek, 1), labels = [], v1 = [], v2 = [], v3 = [];
    for (var w = 1; w <= Math.max(weeks, P.totalWeeks); w++) {
      labels.push('W' + w); var a = 0, b = 0, c = 0;
      S.forEach(function (s) { if (s.week === w) { a += s.vol.T1; b += s.vol.T2; c += s.vol.T3; } });
      v1.push(Math.round(a)); v2.push(Math.round(b)); v3.push(Math.round(c));
    }

    // e1RM + 回归（每个 T1 主项）
    var lifts = liftSlots(db), e1 = [];
    Object.keys(lifts).forEach(function (k) {
      var info = lifts[k], pts = [], wts = [];
      S.forEach(function (s) {
        s.items.forEach(function (it) {
          if (it.slotId === info.slot.id && !it.deload && it.judgment !== '跳过' && !it.sub && it.name === info.name) {
            if (it.e1rm) pts.push([s.week, it.e1rm, s.rec.date]);
            wts.push([s.week, it.weight]);
          }
        });
      });
      var reg = linreg(pts.map(function (p) { return [p[0], p[1]]; }));
      var best = null; pts.forEach(function (p) { if (!best || p[1] > best[1]) best = p; });
      var series = [], regLine = [];
      for (var i = 1; i <= Math.max(P.totalWeeks, weeks); i++) {
        var hit = pts.filter(function (p) { return p[0] === i; })[0];
        series.push(hit ? fix(hit[1]) : null);
        regLine.push(reg ? fix(reg.predict(i)) : null);
      }
      var oneRM = k in P.oneRM ? P.oneRM[k] : null;
      e1.push({
        key: k, name: info.name, day: info.day.id, series: series, regLine: regLine, n: pts.length,
        best: best ? fmtW(Math.round(best[1] * 10) / 10) : '—', bestDate: best ? best[2] : '',
        slope: reg ? (reg.slope >= 0 ? '+' : '') + reg.slope.toFixed(2) : '—',
        r2: reg ? reg.r2.toFixed(2) : '—',
        predict: reg ? fmtW(Math.round(reg.predict(P.totalWeeks) * 10) / 10) : '—',
        oneRM: oneRM, vs1RM: best && oneRM ? Math.round((best[1] / oneRM - 1) * 1000) / 10 : null,
        sampleTip: pts.length < 2 ? '至少 2 次 AMRAP 记录才能回归' : pts.length < 4 ? '样本较少，趋势仅供参考' : ''
      });
    });

    // 每个训练日各动作的每周重量（复刻 Excel 折线图 K:O 列）
    var weightTrend = db.days.map(function (d) {
      var cols = d.slots.map(function (s, si) {
        var arr = [];
        for (var w = 1; w <= Math.max(P.totalWeeks, weeks); w++) arr.push(null);
        S.forEach(function (s2) {
          if (s2.rec.day === d.id) { var it = s2.items[si]; if (!it.sub && it.judgment !== '跳过') arr[s2.week - 1] = it.weight; }
        });
        var cnt = rp.counts[d.id] || 0, ef = effectiveSlot(db, s, cnt + 1);
        if (cnt < arr.length) arr[cnt] = ef.resetNow ? ef.change.weight : rp.states[s.id].weight; // 下一次计划重量
        return { name: ef.slot.name, tier: s.tier, data: arr };
      });
      return { day: d.id, name: d.name, cols: cols, nextIdx: rp.counts[d.id] || 0 };
    });

    // 体重
    var bw = S.filter(function (s) { return s.rec.bw; }).map(function (s) { return { date: s.rec.date, v: Number(s.rec.bw) }; });

    // 个人纪录
    // 个人纪录：按实际做过的动作统计（含替换、更换后的动作）
    var prMap = {}, prs = [];
    S.forEach(function (s2) { s2.items.forEach(function (it) {
      if (it.deload || it.judgment === '跳过') return;
      var cur = prMap[it.name];
      if (!cur || it.weight > cur.weight) prMap[it.name] = { weight: it.weight, tier: it.tier, day: s2.rec.day, date: s2.rec.date };
    }); });
    Object.keys(prMap).forEach(function (n) { var x = prMap[n]; prs.push({ day: x.day, tier: x.tier, tierColor: TIER_COLORS[x.tier], name: n, w: fmtW(x.weight), wn: x.weight, date: x.date.slice(5) }); });
    prs.sort(function (a, b) { return a.tier === b.tier ? b.wn - a.wn : (a.tier < b.tier ? -1 : 1); });

    return {
      kpi: {
        sessions: S.length, planned: P.totalWeeks * db.days.length,
        progress: Math.min(100, Math.round(S.length / (P.totalWeeks * db.days.length) * 100)),
        volume: totalVol >= 1000 ? (totalVol / 1000).toFixed(1) + ' t' : Math.round(totalVol) + ' kg',
        reps: reps, adds: judged['加重'],
        t1Rate: t1n ? Math.round(t1ok / t1n * 100) : null, t2Rate: t2n ? Math.round(t2ok / t2n * 100) : null,
        t3Add: t3add, warns: judged['建议降阶'] + judged['降阶'] + judged['退阶'] + judged['重置']
      },
      pie: pie, pieTotal: pie.reduce(function (a, b) { return a + b.value; }, 0),
      volume: { labels: labels, stacks: [
        { name: 'T1', color: TIER_COLORS.T1, data: v1 }, { name: 'T2', color: TIER_COLORS.T2, data: v2 }, { name: 'T3', color: TIER_COLORS.T3, data: v3 }] },
      e1rm: e1, weightTrend: weightTrend, bw: bw, prs: prs, totalWeeks: Math.max(P.totalWeeks, weeks)
    };
  }

  // ---------- 视图模型：回顾 & 总结 ----------
  function buildReview(db) {
    var P = db.params, rp = replay(db), S = rp.sessions, stats = buildStats(db);
    var maxWeek = 0; S.forEach(function (s) { maxWeek = Math.max(maxWeek, s.week); });
    var weekCards = [], prevVol = null;
    for (var w = 1; w <= maxWeek; w++) {
      var ss = S.filter(function (s) { return s.week === w; });
      var vol = ss.reduce(function (a, b) { return a + b.volume; }, 0);
      var adds = 0, warns = 0, lines = [];
      ss.forEach(function (s) {
        s.items.forEach(function (it) {
          if (it.judgment === '加重') adds++;
          if (['建议降阶', '降阶', '退阶', '重置'].indexOf(it.judgment) >= 0) warns++;
        });
      });
      var t1 = ss.map(function (s) {
        var it = s.items[0];
        return { day: s.rec.day, name: it.name, manual: !!it.manual, w: fmtW(it.deload ? it.dWeight : it.weight), input: it.input, j: it.judgment, color: JUDGE_COLORS[it.judgment] };
      });
      var dayFlags = db.days.map(function (d) { return { id: d.id, on: ss.some(function (s) { return s.rec.day === d.id; }) }; });
      var dv = prevVol && ss.length >= db.days.length ? Math.round((vol - prevVol) / prevVol * 100) : null;
      weekCards.push({ week: w, sessions: ss.length, total: db.days.length, vol: Math.round(vol), volText: (vol / 1000).toFixed(2) + ' t',
        dv: dv === null ? '' : (dv >= 0 ? '+' + dv : '' + dv) + '%', dvUp: dv !== null && dv >= 0,
        adds: adds, warns: warns, t1: t1, days: dayFlags, deload: isDeloadWeek(w, P) });
      prevVol = vol || prevVol;
    }

    // 总结洞察（教练口吻）
    var insights = [];
    var k = stats.kpi;
    if (!S.length) insights.push({ type: 'info', text: '还没有训练记录。去「训练」页完成第一次 A1，数据会自动长出来。' });
    else {
      insights.push({ type: 'info', text: '已完成 ' + k.sessions + '/' + k.planned + ' 次训练（' + k.progress + '%），累计容量 ' + k.volume + '，共 ' + k.adds + ' 次加重。' });
      var lifts = liftSlots(db);
      Object.keys(lifts).forEach(function (key) {
        var info = lifts[key], hist = [];
        S.forEach(function (s) { s.items.forEach(function (it) { if (it.slotId === info.slot.id && it.judgment !== '跳过' && !it.deload && !it.sub && it.name === info.name) hist.push(it); }); });
        if (!hist.length) return;
        var first = hist[0], lastIt = hist[hist.length - 1], streak = 0;
        for (var i = hist.length - 1; i >= 0 && hist[i].judgment === '加重'; i--) streak++;
        var gain = fix(lastIt.nextWeight - first.weight);
        if (streak >= 2) insights.push({ type: 'up', text: info.name + ' 连续 ' + streak + ' 次加重，' + fmtW(first.weight) + '→' + fmtW(lastIt.nextWeight) + 'kg，节奏在线。' });
        else if (lastIt.judgment === '加重') insights.push({ type: 'up', text: info.name + ' 上次 AMRAP ' + lastIt.input + ' 次，下次上 ' + fmtW(lastIt.nextWeight) + 'kg' + (gain > 0 ? '（累计 +' + fmtW(gain) + '）' : '') + '。' });
        if (lastIt.judgment === '建议降阶') insights.push({ type: 'warn', text: info.name + ' 末组没到 ' + stageDef('T1', lastIt.stage).hold + ' 次。下次同重量再冲，连续两次未达标才降阶，先睡好吃好。' });
        if (lastIt.judgment === '降阶') insights.push({ type: 'warn', text: info.name + ' 已切到 ' + lastIt.nextStage + '，重量保持 ' + fmtW(lastIt.nextWeight) + 'kg，用更少次数顶住强度。' });
        if (lastIt.judgment === '重置') insights.push({ type: 'warn', text: info.name + ' 完成一轮三阶，已重置回 5×3+ @ ' + fmtW(lastIt.nextWeight) + 'kg。' });
      });
      // T2 退阶 / T3 接近阈值
      var lastBySlot = {};
      S.forEach(function (s) { s.items.forEach(function (it) { if (it.judgment !== '跳过' && !it.deload && !it.sub) lastBySlot[it.slotId] = it; }); });
      Object.keys(lastBySlot).forEach(function (id) {
        var it = lastBySlot[id], dn = id.split('_')[0] + ' ';
        if (it.tier === 'T2' && it.judgment === '退阶') insights.push({ type: 'warn', text: dn + it.name + ' 没吃下 ' + it.stage + '，下次降到 ' + it.nextStage + '，重量不变。' });
        if (it.tier === 'T3' && it.judgment === '保持' && Number(it.input) >= P.t3Threshold - 4) insights.push({ type: 'tip', text: dn + it.name + ' 末组 ' + it.input + ' 次，距离 ' + P.t3Threshold + ' 次加重只差 ' + (P.t3Threshold - it.input) + ' 次，下次冲一把。' });
      });
      stats.e1rm.forEach(function (e) {
        if (e.n >= 2 && e.slope !== '—') insights.push({ type: 'trend', text: e.name + ' e1RM 回归斜率 ' + e.slope + ' kg/周，按此趋势第 ' + P.totalWeeks + ' 周约 ' + e.predict + 'kg' + (e.n < 4 ? '（样本少，参考）' : '') + '。' });
      });
      if (weekCards.length >= 2) {
        var lw = weekCards[weekCards.length - 1];
        if (lw.dv) insights.push({ type: lw.dvUp ? 'up' : 'tip', text: '第 ' + lw.week + ' 周容量 ' + lw.volText + '，环比 ' + lw.dv + '。' });
      }
      var rec = recommend(db, rp);
      if (isDeloadWeek(rec.week, P)) insights.push({ type: 'tip', text: '下一轮是第 ' + rec.week + ' 周减载周：T1 -50%、T2 -40%、T3 少 1 组，不影响进阶链。' });
    }

    var logs = S.slice().reverse().map(logView);
    insights.forEach(function (i) { i.icon = INS_ICON[i.type] || 'i'; });
    return { insights: insights, weeks: weekCards.reverse(), logs: logs, kpi: k };
  }

  // ---------- 动作库 / 更换动作 ----------
  /**
   * 从某训练日的“下一次”起永久更换动作。
   * - 该训练日还没练过：直接改首周方案（保留 TM% 配置，除非改了起始重量）
   * - 已练过：记一条更换（fromWeek），历史记录保持原动作名，新动作从 weight 重新开始进阶
   */
  function swapSlot(db, dayId, slotId, name, weight) {
    var d = dayById(db, dayId), s = null;
    d.slots.forEach(function (x) { if (x.id === slotId) s = x; });
    if (!s) return null;
    var rp = replay(db), fromWeek = (rp.counts[dayId] || 0) + 1, lib = libFindIn(db, name);
    var w = weight === null || weight === undefined || weight === '' || isNaN(Number(weight)) ? null : fix(Number(weight));
    s.changes = (s.changes || []).filter(function (c) { return c.fromWeek < fromWeek; });
    if (fromWeek === 1) {
      s.name = name; s.equip = lib ? lib.equip : '';
      if (w !== null && w !== initWeight(s, db.params)) s.init = { type: 'fixed', value: w };
      return { fromWeek: 1, base: true };
    }
    var cur = effectiveSlot(db, s, fromWeek).slot;
    if (cur.name === name && w === null) return { fromWeek: fromWeek, noop: true };
    if (w === null) w = rp.states[s.id].weight;
    s.changes.push({ fromWeek: fromWeek, name: name, equip: lib ? lib.equip : '', weight: w });
    return { fromWeek: fromWeek };
  }
  /** 动作库列表（更换弹层 / 动作库页面共用） */
  function buildLibrary(db, opts) {
    opts = opts || {};
    var tier = opts.tier || 'T1', q = String(opts.q || '').trim(), cur = opts.current || '', lastW = lastWeights(replay(db));
    var counts = { T1: 0, T2: 0, T3: 0 };
    var all = libAll(db);
    all.forEach(function (x) { counts[x.tier] = (counts[x.tier] || 0) + 1; });
    var list = all.filter(function (x) {
      if (q) return x.name.indexOf(q) >= 0 || (x.part || '').indexOf(q) >= 0 || (x.equip || '').indexOf(q) >= 0;
      return x.tier === tier;
    }).map(function (x) {
      return { name: x.name, tier: x.tier, part: x.part, equip: x.equip, desc: x.desc, custom: !!x.custom, current: x.name === cur,
        last: lastW[x.name] !== undefined ? fmtW(lastW[x.name]) : '' };
    });
    return { tier: tier, q: q, list: list, counts: counts, tiers: ['T1', 'T2', 'T3'].map(function (t) { return { id: t, n: counts[t] }; }),
      customCount: ((db && db.customLib) || []).length };
  }
  /** 某槽位“下一次”的更换上下文（弹层用） */
  function swapContext(db, dayId, slotId) {
    var d = dayById(db, dayId), s = null;
    d.slots.forEach(function (x) { if (x.id === slotId) s = x; });
    var rp = replay(db), wk = (rp.counts[dayId] || 0) + 1, ef = effectiveSlot(db, s, wk), lastW = lastWeights(rp);
    var curW = ef.resetNow ? ef.change.weight : rp.states[s.id].weight;
    return { dayId: dayId, slotId: slotId, tier: s.tier, name: ef.slot.name, week: wk, weight: curW, weightText: fmtW(curW), lastW: lastW, base: wk === 1 };
  }

  // ---------- 记录操作 ----------
  function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function today() {
    var d = new Date(), m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
  }
  function saveRecord(db, rec) {
    var entries = {};
    Object.keys(rec.entries).forEach(function (k) {
      var e = rec.entries[k];
      entries[k] = { v: e.v === undefined ? null : e.v };
      if (e.skip) entries[k].skip = true;
      if (e.reps !== undefined && e.reps !== null && e.reps !== '') entries[k].reps = Number(e.reps);
      if (e.new5RM) entries[k].new5RM = Number(e.new5RM);
      if (manualW(e) !== null) entries[k].w = manualW(e);
      if (e.ex) entries[k].ex = String(e.ex);
    });
    var r = { id: rec.id || uid(), date: rec.date || today(), day: rec.day, deload: !!rec.deload, note: rec.note || '', bw: rec.bw || null,
      entries: entries, createdAt: rec.createdAt || Date.now() };
    var idx = -1;
    db.records.forEach(function (x, i) { if (x.id === r.id) idx = i; });
    if (idx >= 0) db.records[idx] = r; else db.records.push(r);
    return r;
  }
  function deleteRecord(db, id) { db.records = db.records.filter(function (r) { return r.id !== id; }); }
  function getRecord(db, id) { return db.records.filter(function (r) { return r.id === id; })[0] || null; }

  // 结算：保存后返回该次训练的判定结果
  function sessionResult(db, id) {
    var rp = replay(db);
    return rp.sessions.filter(function (s) { return s.rec.id === id; })[0] || null;
  }

  var RULES = [
    { title: 'T1 主项 · 三阶进阶', rows: [
      ['5×3+', '末组 AMRAP ≥ 6', '加重，继续 5×3+'], ['5×3+', '3 ≤ AMRAP < 6', '重量不变，巩固'], ['5×3+', '连续 2 次 AMRAP < 3', '进入 6×2+，重量不变'],
      ['6×2+', '末组 AMRAP ≥ 4', '加重，继续 6×2+'], ['6×2+', '2 ≤ AMRAP < 4', '重量不变，巩固'], ['6×2+', '连续 2 次 AMRAP < 2', '进入 10×1+，重量不变'],
      ['10×1+', '末组 AMRAP ≥ 2', '加重，继续 10×1+'], ['10×1+', 'AMRAP < 2', '测新 5RM，取 90% 为新 TM，重置 5×3+']] },
    { title: 'T2 次主项 · 退阶重置', rows: [
      ['3×10', '全部完成', '加重，继续 3×10'], ['3×10', '无法完成', '降为 3×8，重量不变'],
      ['3×8', '全部完成', '加重，回到 3×10（表格公式）'], ['3×8', '无法完成', '降为 3×6，重量不变'], ['3×6', '完成 / 未完成', '加重，重置回 3×10']] },
    { title: 'T3 辅助项', rows: [['3×15+', '末组 AMRAP ≥ 阈值(25)', '加重，回到 3×15+'], ['3×15+', '末组 AMRAP < 阈值', '重量不变']] }
  ];
  var GENERAL_RULES = [
    '循环顺序：A1 → B1 → A2 → B2 依次滚动，不固定星期几',
    '组间休息：T1 3~5 分钟，T2 2~3 分钟，T3 60~90 秒',
    '减载：每 6 周 1 次，T1 -50%，T2 -40%，T3 减 1 组（不改变进阶链）',
    'T1 降阶：需连续 2 次未达标，单次失败只预警',
    '首周重量 = ROUND(TM × 系数 / 2.5) × 2.5，TM = 1RM × 90%',
    '记录原则：只填 AMRAP 次数或完成情况，阶段与重量自动推算'
  ];

  return {
    VERSION: VERSION, LIFTS: LIFTS, LIFT_ORDER: LIFT_ORDER, STEP_KEYS: STEP_KEYS, STAGES: STAGES, FIRST_STAGE: FIRST_STAGE,
    REST: REST, LIB: LIB, JUDGE_COLORS: JUDGE_COLORS, JUDGE_ICON: JUDGE_ICON, dateLabel: dateLabel, backupLabel: backupLabel, TIER_COLORS: TIER_COLORS, RULES: RULES, GENERAL_RULES: GENERAL_RULES,
    defaults: defaults, defaultDays: defaultDays, defaultParams: defaultParams, excelSeedRecords: excelSeedRecords, normalize: normalize,
    roundTo: roundTo, tm: tm, initWeight: initWeight, fmtW: fmtW, platesFor: platesFor, linreg: linreg,
    evaluate: evaluate, replay: replay, recommend: recommend, isDeloadWeek: isDeloadWeek, dayById: dayById,
    blankDraft: blankDraft, buildTrain: buildTrain, buildPlan: buildPlan, buildStats: buildStats, buildReview: buildReview,
    saveRecord: saveRecord, deleteRecord: deleteRecord, getRecord: getRecord, sessionResult: sessionResult, swapSlot: swapSlot, buildLibrary: buildLibrary, swapContext: swapContext, effectiveSlot: effectiveSlot,
    libAll: libAll, libFindIn: libFindIn, addCustomEx: addCustomEx, removeCustomEx: removeCustomEx, PARTS: PARTS, EQUIPS: EQUIPS, roundInfo: roundInfo, logView: logView, today: today, uid: uid,
    cycleOf: cycleOf, cycleLen: cycleLen, cycleStartWeek: cycleStartWeek, weekText: weekText
  };
});
