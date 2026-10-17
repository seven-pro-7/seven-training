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
  var DAYS_VERSION = 3; // 动作模板版本，升级后 normalize 会刷新未自定义的 T2/T3 槽位（v3：A2 深蹲命名统一）
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
    '加重': '#FF6B1A', '建议负重': '#5856D6', '保持': '#34C759', '建议降阶': '#FF9F0A',
    '降阶': '#AF52DE', '退阶': '#AF52DE', '重置': '#FF3B30', '减载': '#5AC8FA', '跳过': '#C7C7CC', '替换': '#5856D6'
  };
  var TIER_COLORS = { T1: '#FF6B1A', T2: '#0A84FF', T3: '#AEAEB2' };
  var JUDGE_ICON = { '加重': '↑', '建议负重': '＋', '保持': '=', '建议降阶': '!', '降阶': '↓', '退阶': '↓', '重置': '↺', '减载': '~', '跳过': '–', '替换': '⇄' };
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

  /**
   * 动作库 —— 每个动作归入 5 类器械：杠铃 / 哑铃 / 自重 / 负重 / 器械（固定器械·绳索）
   * 列：[层级, 名称, 部位, 器械, 说明, 基准主项, 系数, 取整档]
   *  - 基准主项：该动作的重量挂在四大项哪一项的 1RM 上（squat/bench/deadlift/ohp）
   *  - 系数：该动作「推荐重量」占基准主项 1RM 的比例（杠铃=总重；哑铃=单只；器械=配重片；负重=外加重量）
   *  - 取整档：该器械的最小可加重量（杠铃 2.5 / 哑铃 1 或 2 / 器械 5 / 负重 1.25 或 2.5）
   *  依据：NSCA %1RM–次数表（10RM≈75%、15RM≈65%）、Strength Level / Symmetric Strength / ExRx 的动作间强度比例，
   *  哑铃单只≈杠铃 1RM×(0.36~0.40)、变式相对主项 0.75~0.85 等，见 RULES_WEIGHT 的说明。
   */
  var LIB = [
    // ---- T1：严格只保留四大项，不提供变式或其他复合动作 ----
    ['T1', '杠铃深蹲', '下肢·蹲', '杠铃', '主项；末组AMRAP≥6次加重', 'squat', 1, 2.5],
    ['T1', '传统硬拉', '下肢·髋铰链', '杠铃', '主项；髋主导拉起', 'deadlift', 1, 2.5],
    ['T1', '平板卧推', '上肢·水平推', '杠铃', '主项；胸大肌主导', 'bench', 1, 2.5],
    ['T1', '站姿实力推', '上肢·垂直推', '杠铃', '主项；站姿推举', 'ohp', 1, 2.5],
    // ---- T2：四大项的变式 + 次级复合动作 ----
    ['T2', '前蹲', '下肢·蹲', '杠铃', '股四头肌与核心；约为深蹲的 82%', 'squat', 0.82, 2.5],
    ['T2', '杠铃深蹲', '下肢·蹲', '杠铃', '与 T1 同源，中等强度做容量', 'squat', 1, 2.5],
    ['T2', '箱式深蹲', '下肢·蹲', '杠铃', '坐箱停顿，强化底部发力；约为深蹲的 90%', 'squat', 0.9, 2.5],
    ['T2', '泽奇深蹲', '下肢·蹲', '杠铃', '肘托杠深蹲，躯干承重更强；约为深蹲的 80%', 'squat', 0.8, 2.5],
    ['T2', '罗马尼亚硬拉', '下肢·髋铰链', '杠铃', '腘绳肌主导；约为硬拉的 75%', 'deadlift', 0.75, 2.5],
    ['T2', '赤字硬拉', '下肢·髋铰链', '杠铃', '站垫高平台拉，强化起拉段；约为硬拉的 90%', 'deadlift', 0.9, 2.5],
    ['T2', '杠铃早安式', '下肢·髋铰链', '杠铃', '髋铰链，腘绳肌与竖脊肌；约为硬拉的 45%', 'deadlift', 0.45, 2.5],
    ['T2', '臀推', '下肢·髋伸', '杠铃', '臀大肌主导；可达硬拉的 100%', 'deadlift', 1, 2.5],
    ['T2', '暂停卧推', '上肢·水平推', '杠铃', '触胸停顿1秒，消除反弹借力；约为卧推的 92%', 'bench', 0.92, 2.5],
    ['T2', '窄距卧推', '上肢·水平推', '杠铃', '三头侧重；约为卧推的 85%', 'bench', 0.85, 2.5],
    ['T2', '上斜卧推', '上肢·水平推', '杠铃', '上胸侧重；约为卧推的 80%', 'bench', 0.8, 2.5],
    ['T2', '杠铃推举', '上肢·垂直推', '杠铃', '坐姿或站姿推举，约为站姿实力推的 110%', 'ohp', 1.1, 2.5],
    ['T2', '潘德雷划船', '上肢·水平拉', '杠铃', '躯干平行地面，约为卧推的 90%', 'bench', 0.9, 2.5],
    ['T2', '杠铃划船', '上肢·水平拉', '杠铃', '俯身杠铃划船，约为卧推的 95%', 'bench', 0.95, 2.5],
    ['T2', 'T杠划船', '上肢·水平拉', '杠铃', '背部厚度，约为卧推的 80%', 'bench', 0.8, 2.5],
    ['T2', '坐姿哑铃推肩', '上肢·垂直推', '哑铃', '肩部容量；单只≈卧推的 32%', 'bench', 0.32, 2],
    ['T2', '阿诺德推举', '上肢·垂直推', '哑铃', '旋转推举，三角肌前中束；单只≈卧推的 26%', 'bench', 0.26, 2],
    ['T2', '哑铃卧推', '上肢·水平推', '哑铃', '活动范围大；单只≈卧推的 38%', 'bench', 0.38, 2],
    ['T2', '上斜哑铃卧推', '上肢·水平推', '哑铃', '上胸容量；单只≈卧推的 30%', 'bench', 0.3, 2],
    ['T2', '单臂哑铃划船', '上肢·水平拉', '哑铃', '单侧背阔；单只≈卧推的 35%', 'bench', 0.35, 2],
    ['T2', '引体向上', '上肢·垂直拉', '自重', '背阔肌主项；以体重做次数，无外加重量', 'bench', 0, 0],
    ['T2', '负重引体向上', '上肢·垂直拉', '负重', '外加重量≈卧推的 10%，起步附加体重 5~10%', 'bench', 0.1, 2.5],
    ['T2', '双杠臂屈伸', '上肢·水平推', '自重', '下胸与三头；以体重做次数', 'bench', 0, 0],
    ['T2', '负重双杠臂屈伸', '上肢·水平推', '负重', '外加重量≈卧推的 12%', 'bench', 0.12, 2.5],
    ['T2', '腿举', '下肢·蹲', '器械', '腿部容量；配重约为深蹲的 140%', 'squat', 1.4, 5],
    ['T2', '哈克深蹲', '下肢·蹲', '器械', '股四头肌容量；配重约为深蹲的 90%', 'squat', 0.9, 5],
    ['T2', '坐姿划船', '上肢·水平拉', '器械', '背部厚度；配重约为卧推的 70%', 'bench', 0.7, 2.5],
    // ---- T3：辅助孤立动作，按 15RM（≈65% 以下）取重 ----
    ['T3', '高位下拉', '上肢·垂直拉', '器械', '背阔肌容量；配重约为卧推的 85%', 'bench', 0.85, 2.5],
    ['T3', '对握高位下拉', '上肢·垂直拉', '器械', '中立握，肘部更舒适；配重约为卧推的 80%', 'bench', 0.8, 2.5],
    ['T3', '直臂下压', '上肢·垂直拉', '器械', '背阔孤立；配重约为卧推的 25%', 'bench', 0.25, 2.5],
    ['T3', '反握引体向上', '上肢·垂直拉', '自重', '掌心朝内，二头参与更多；以体重做次数', 'bench', 0, 0],
    ['T3', '绳索下压', '上肢·伸肘', '器械', '三头主项；配重约为卧推的 30%', 'bench', 0.3, 2.5],
    ['T3', '绳索三头屈伸', '上肢·伸肘', '器械', '三头容量；配重约为卧推的 25%', 'bench', 0.25, 2.5],
    ['T3', '过头绳索臂屈伸', '上肢·伸肘', '器械', '拉长位练三头长头，增肌优于下压（Maeo 2023）；配重约为卧推的 22%', 'bench', 0.22, 2.5],
    ['T3', '仰卧臂屈伸', '上肢·伸肘', '杠铃', 'EZ 杆仰卧臂屈伸，三头长头；约为卧推的 30%', 'bench', 0.3, 1.25],
    ['T3', '面拉', '肩·后束', '器械', '肩袖与后束；配重约为卧推的 22%', 'bench', 0.22, 2.5],
    ['T3', '绳索夹胸', '上肢·水平内收', '器械', '胸大肌孤立；单侧配重约为卧推的 15%', 'bench', 0.15, 2.5],
    ['T3', '俯卧腿弯举', '下肢·屈膝', '器械', '腘绳肌容量；配重约为深蹲的 30%', 'squat', 0.3, 2.5],
    ['T3', '坐姿腿弯举', '下肢·屈膝', '器械', '屈髋位拉长腘绳肌，增肌优于俯卧位（Maeo 2021）；配重约为深蹲的 35%', 'squat', 0.35, 2.5],
    ['T3', '坐姿腿屈伸', '下肢·伸膝', '器械', '股四头肌容量；配重约为深蹲的 40%', 'squat', 0.4, 2.5],
    ['T3', '腿外展', '下肢·髋外展', '器械', '臀中肌；配重约为深蹲的 40%', 'squat', 0.4, 5],
    ['T3', '山羊挺身', '下背·伸髋', '器械', '竖脊肌；以体重做次数，需要时再手动加重', 'deadlift', 0, 0],
    ['T3', '提踵', '下肢·踝', '器械', '小腿容量；配重约为深蹲的 60%', 'squat', 0.6, 5],
    ['T3', '杠铃弯举', '上肢·屈肘', '杠铃', '二头主项；约为卧推的 40%', 'bench', 0.4, 1.25],
    ['T3', 'EZ杆弯举', '上肢·屈肘', '杠铃', 'EZ 杆半旋握，腕部压力更小；约为卧推的 38%', 'bench', 0.38, 1.25],
    ['T3', '俯身划船', '上肢·水平拉', '杠铃', '背部容量；约为卧推的 85%', 'bench', 0.85, 2.5],
    ['T3', '哑铃弯举', '上肢·屈肘', '哑铃', '二头容量；单只≈卧推的 15%', 'bench', 0.15, 1],
    ['T3', '锤式弯举', '上肢·屈肘', '哑铃', '肱桡肌与二头；单只≈卧推的 17%', 'bench', 0.17, 1],
    ['T3', '上斜哑铃弯举', '上肢·屈肘', '哑铃', '肩伸位拉长二头长头；单只≈卧推的 12%', 'bench', 0.12, 1],
    ['T3', '哑铃侧平举', '肩·中束', '哑铃', '三角肌中束；单只≈卧推的 14%', 'bench', 0.14, 1],
    ['T3', '绳索侧平举', '肩·中束', '器械', '底部仍有张力；单侧配重约为卧推的 7%', 'bench', 0.07, 1.25],
    ['T3', '反向飞鸟', '肩·后束', '哑铃', '三角肌后束；单只≈卧推的 12%', 'bench', 0.12, 1],
    ['T3', '哑铃耸肩', '肩·斜方', '哑铃', '斜方肌容量；单只≈硬拉的 30%', 'deadlift', 0.3, 2],
    ['T3', '高脚杯深蹲', '下肢·蹲', '哑铃', '深蹲模式容量；单只≈深蹲的 25%', 'squat', 0.25, 2],
    ['T3', '保加利亚分腿蹲', '下肢·单腿', '哑铃', '单腿稳定与臀部；单只≈深蹲的 25%', 'squat', 0.25, 2],
    ['T3', '卷腹', '核心·屈曲', '自重', '腹直肌；以体重做次数', 'squat', 0, 0],
    ['T3', '悬垂举腿', '核心·屈髋', '自重', '下腹与髋屈肌；以体重做次数', 'squat', 0, 0]
  ].map(function (r) { return { tier: r[0], name: r[1], part: r[2], equip: r[3], desc: r[4], base: r[5], ratio: r[6], inc: r[7] }; });

  function libFind(name) {
    for (var i = 0; i < LIB.length; i++) if (LIB[i].name === name) return LIB[i];
    return null;
  }
  var PARTS = ['下肢·蹲', '下肢·髋铰链', '下肢·髋伸', '下肢·屈膝', '下肢·伸膝', '下肢·单腿', '上肢·水平推', '上肢·垂直推', '上肢·水平拉', '上肢·垂直拉',
    '上肢·屈肘', '上肢·伸肘', '肩·中束', '肩·后束', '核心', '其他'];
  var EQUIPS = ['杠铃', '哑铃', '自重', '负重', '器械'];
  // 器械类别说明（显示在动作库顶部与标签 tooltip）
  var EQUIP_NOTE = {
    '杠铃': '杠铃动作 · 重量=杠铃总重（含杆）',
    '哑铃': '哑铃动作 · 重量=单只哑铃',
    '自重': '自重动作 · 以体重做次数，无外加重量',
    '负重': '负重动作 · 重量=外加重量（腰带/背心），不含体重',
    '器械': '固定器械/绳索 · 重量=配重片'
  };
  // 旧数据迁移：历史自定义动作里的 绳索/自重/负重/壶铃/其他 归并到新分类
  function normEquip(e) {
    if (EQUIPS.indexOf(e) >= 0) return e;
    if (e === '自重/负重') return '负重';
    if (e === '绳索' || e === '器械/自重') return '器械';
    if (e === '壶铃') return '哑铃';
    return '杠铃';
  }
  // 自定义动作缺省推算档案：按器械给一个保守的起步比例
  var DEF_PROFILE = {
    '杠铃': { base: 'bench', ratio: 0.4, inc: 2.5 },
    '哑铃': { base: 'bench', ratio: 0.15, inc: 1 },
    '自重': { base: 'bench', ratio: 0, inc: 0 },
    '负重': { base: 'bench', ratio: 0.1, inc: 2.5 },
    '器械': { base: 'bench', ratio: 0.3, inc: 2.5 }
  };
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
    if ((ex.tier || 'T3') === 'T1') return 'T1 严格限定为深蹲、卧推、硬拉、实力推四大项，不能添加自定义动作';
    if (!name) return '请填写动作名称';
    if (name.length > 16) return '名称最多 16 个字';
    if (libFindIn(db, name)) return '动作库里已有「' + name + '」';
    db.customLib = db.customLib || [];
    var eq = normEquip(ex.equip);
    var d0 = DEF_PROFILE[eq] || DEF_PROFILE['杠铃'];
    db.customLib.unshift({ tier: ex.tier || 'T3', name: name, part: ex.part || '其他', equip: eq, desc: String(ex.desc || '').trim() || '自定义动作',
      base: ex.base || d0.base, ratio: ex.ratio !== undefined ? ex.ratio : d0.ratio, inc: ex.inc !== undefined ? ex.inc : d0.inc });
    return '';
  }
  function removeCustomEx(db, name) { db.customLib = (db.customLib || []).filter(function (x) { return x.name !== name; }); }

  // ---------- 默认数据（来自 Excel 当前填写） ----------
  function slot(id, tier, name, init, step, roundProg, lift) {
    var lib = libFind(name);
    return {
      id: id, tier: tier, name: name, equip: lib ? lib.equip : normEquip(''), init: init,
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
        slot('A2_3', 'T2', '杠铃深蹲', pct('squat', 0.7), 't2l'),
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
      bodyWeight: 70, // 自重/负重动作推算用（负重动作按体重百分比给起步）。训练卡上的「体重」会同步到这里
      plates: [25, 20, 15, 10, 5, 2.5, 1.25],
      ruleMode: 'full', // full = 按「进阶规则备查」完整三阶；excel = 严格按表格公式
      totalWeeks: 8,
      deloadEnabled: true,
      deloadEvery: 6,
      t1FailLimit: 2,
      adaptive: true, // 按末组 AMRAP 次数自适应加重：次数远超加重线时，一次多加 1~2 档
      autoRotate: true // 每轮（8 周）自动轮换 T2/T3 动作
    };
  }

  // 第 1 周（A1/B1/A2/B2 各一次）用户实际训练数据，由 App「设置 → 导出备份」回灌
  function excelSeedRecords() {
    return [
      { id: "xls_A1_w1", date: "2026-10-13", day: "A1", deload: false, note: "从 Excel 导入（日期可编辑）", bw: null, createdAt: 1,
        entries: {"A1_1": {"v": 10}, "A1_2": {"v": "完成", "w": 42.5, "ex": "泽奇深蹲"}, "A1_3": {"v": "完成", "w": 17.5, "ex": "坐姿哑铃推肩"}, "A1_4": {"v": 15, "w": 50}, "A1_5": {"v": 19, "w": 10}} },
      { id: "xls_B1_w1", date: "2026-10-14", day: "B1", deload: false, note: "从 Excel 导入（日期可编辑）", bw: null, createdAt: 2,
        entries: {"B1_1": {"v": 12}, "B1_2": {"v": "完成", "w": 17.5}, "B1_3": {"v": "完成"}, "B1_4": {"v": 17, "w": 45, "ex": "俯身划船"}, "B1_5": {"v": 18, "w": 10, "ex": "反向飞鸟"}} },
      { id: "rmvahlea74du2", date: "2026-10-16", day: "A2", deload: false, note: "", bw: null, createdAt: 3,
        entries: {"A2_1": {"v": 17}, "A2_2": {"v": "完成"}, "A2_3": {"v": "完成"}, "A2_4": {"v": 17, "w": 50, "ex": "高位下拉"}, "A2_5": {"v": 16, "w": 10}} },
      { id: "rmvaj5j6l5hq3", date: "2026-10-16", day: "B2", deload: false, note: "", bw: null, createdAt: 4,
        entries: {"B2_1": {"v": 11}, "B2_2": {"v": "完成"}, "B2_3": {"v": "完成", "w": 35, "ex": "上斜哑铃卧推"}, "B2_4": {"v": 25}, "B2_5": {"v": 25, "w": 6}} }
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
    // 器械分类迁移：所有旧值统一到 杠铃/哑铃/自重/负重/器械；自定义 T1 降为 T2，避免污染 T1 四大项
    db.customLib.forEach(function (x) {
      x.equip = normEquip(x.equip);
      if (x.tier === 'T1') x.tier = 'T2';
      var dp = DEF_PROFILE[x.equip] || DEF_PROFILE['杠铃'];
      if (!x.base) x.base = dp.base;
      if (x.ratio === undefined || x.ratio === null) x.ratio = dp.ratio;
      if (x.inc === undefined || x.inc === null) x.inc = dp.inc;
    });
    db.days.forEach(function (d) { d.slots.forEach(function (s) { s.equip = equipOf(s.name, s.equip); }); });
    // 最近一次填写体重时，自动作为负重动作的推算体重
    sortRecords(db.records).forEach(function (r) { if (Number(r.bw) > 0) db.params.bodyWeight = Number(r.bw); });
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
  // ---------- 器械感知的取整档位与加重步幅 ----------
  /**
   * 不同器械能加的最小重量完全不同：杠铃按配重片 2.5kg、哑铃按单只 1~2kg、
   * 固定器械按配重销 2.5~5kg、负重（腰带/背心）按 1.25~2.5kg。
   * 取整档位 = 该器械的最小可加重量；步幅 = 一次加重实际跨几档。
   */
  var EQUIP_RULE = {
    '杠铃': { inc: 2.5, step: 2.5, incL: 2.5, stepL: 5 },
    '哑铃': { inc: 1, step: 1, incL: 2, stepL: 2 },
    '器械': { inc: 2.5, step: 2.5, incL: 5, stepL: 5 },
    '负重': { inc: 1.25, step: 1.25, incL: 2.5, stepL: 2.5 },
    '自重': { inc: 0, step: 0, incL: 0, stepL: 0 }
  };
  // 动作的真实器械类别：以动作库为准，库里没有的（旧数据/自定义）归并到新分类
  function equipOf(name, fallback) {
    var lb = libFindIn(null, name);
    return lb ? lb.equip : normEquip(fallback);
  }
  function isLowerSlot(s) {
    if (s.lift) return s.lift === 'squat' || s.lift === 'deadlift';
    var lb = libFindIn(null, s.name);
    return !!(lb && (lb.base === 'squat' || lb.base === 'deadlift') ||
      /深蹲|硬拉|腿|臀|小腿|提踵|分腿|台阶/.test(s.name || ''));
  }
  /** 该槽位的取整档位（优先用动作库声明的 inc） */
  function incOf(s, P) {
    var lb = libFindIn(null, s.name);
    if (lb && lb.inc) return lb.inc;
    var r = EQUIP_RULE[s.equip]; if (!r) return P.rounding || 2.5;
    return isLowerSlot(s) ? r.incL : r.inc;
  }
  /**
   * 该槽位的加重步幅
   *  - T1/T2：按器械和上下肢取（杠铃上肢 2.5、下肢 5；哑铃 1~2；器械 2.5~5；负重 1.25~2.5）
   *  - T3：孤立动作肌群小，一律只跨 1 个最小档位，避免一次加得太猛
   *  - 自重：没有"加重"，步幅为 0（想加重请换成「负重」版本）
   *  - 严格按表格模式：沿用设置里的旧步幅，保证与 Excel 逐格一致
   */
  function stepOf(s, P) {
    var legacy = P.steps[s.step];
    var lb = libFindIn(null, s.name);
    var eq = (lb && lb.equip) || normEquip(s.equip);
    if (P.ruleMode === 'excel' && s.step && legacy) return legacy;
    var r = EQUIP_RULE[eq];
    if (!r) return legacy || 2.5;
    if (eq === '自重') return 0;
    var inc = (lb && lb.inc) || r.inc;
    // 关键：步幅不得小于取整档位，否则「加完再取整」会回到原值，永远加不上去
    if (s.tier === 'T3') return inc;
    return Math.max(inc, isLowerSlot(s) ? r.stepL : r.step);
  }
  // 把结果按该器械的档位对齐
  function alignTo(w, inc) {
    if (!inc || inc <= 0) return fix(w);
    return roundTo(w, inc);
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

  // ---------- 推荐重量（按器械类型科学推算） ----------
  /**
   * 档位目标 %1RM（NSCA %1RM–次数表）：
   *   3 次 ≈ 93%  → T1 用 TM×0.85 已覆盖
   *   10 次 ≈ 75% → T2 取 70%（留 1~2 次余量，GZCLP 要求 3×10 能干净完成）
   *   15 次 ≈ 65% → T3 取 55%（末组要冲 15~25 次 AMRAP，起手不能太重）
   */
  var TIER_PCT = { T1: 0.765, T2: 0.65, T3: 0.5 }; // 对 1RM 的直接比例：T1=TM(90%)×85%，T2≈15RM~10RM 之间，T3≈15RM 以下
  /**
   * 算出某个动作的推荐重量（含单位说明）。
   * 优先级：用户上次实际用过的重量 > 按 1RM×系数×档位比例推算。
   * @return { weight, unit, text, note, source, inc, equip }
   */
  /**
   * 纯模型推算（不读训练历史）：1RM × 动作系数 × 档位比例，再按器械档位取整。
   * e1rm（可选）：训练中由 T1 末组 AMRAP 估算出的 1RM（Epley）。只取其 90% 参与，抵消高次数 AMRAP 的高估；
   * 且只在高于设置里填的 1RM 时才采用——体现「随训练变强，换入的新动作起点跟着变高」。
   */
  function modelWeight(P, lb, tier, e1rm) {
    var tierKey = tier || (lb && lb.tier) || 'T3', equip = lb ? lb.equip : '杠铃', base = (lb && lb.base) || 'bench';
    var inc = (lb && lb.inc) || (EQUIP_RULE[equip] ? EQUIP_RULE[equip].inc : 2.5);
    if (equip === '自重' || !lb || !lb.ratio) return { weight: 0, base: base, oneRM: P.oneRM[base], inc: 0, equip: equip, bw: true };
    var rm = P.oneRM[base], est = e1rm && e1rm[base] ? fix(e1rm[base] * 0.9) : 0, fromE = est > rm;
    if (fromE) rm = est;
    var w = rm * lb.ratio * TIER_PCT[tierKey];
    if (equip === '负重') w = Math.max(w, (Number(P.bodyWeight) || 70) * 0.05); // 起步至少加体重 5%
    if (equip === '杠铃') w = Math.max(w, P.barWeight || 20); // 杠铃动作不低于空杆
    return { weight: alignTo(w, inc) || 0, base: base, oneRM: fix(rm), fromE1rm: fromE, ratio: lb.ratio, pct: TIER_PCT[tierKey], inc: inc, equip: equip };
  }
  function recommendWeight(db, name, tier, opts) {
    opts = opts || {};
    var P = db.params, lb = libFindIn(db, name);
    var equip = (lb && lb.equip) || normEquip(opts.equip);
    if (opts.preferLast !== false) {
      var last = lastWeights(opts.rp || replay(db))[name];
      if (last !== undefined && last !== null && equip !== '自重') {
        return { weight: fix(last), unit: unitOf(equip), text: fmtW(last), source: 'last', equip: equip, inc: (lb && lb.inc) || 0,
          note: '沿用上次 ' + fmtW(last) + ' kg' };
      }
    }
    var m = modelWeight(P, lb, tier, opts.e1rm);
    if (m.bw) return { weight: 0, unit: unitOf(equip), text: '自重', source: 'bodyweight', equip: equip, inc: 0, note: '以体重做次数，达到次数上限后再加重' };
    return { weight: m.weight, unit: unitOf(equip), text: fmtW(m.weight), source: 'model', equip: equip, inc: m.inc,
      note: LIFTS[m.base] + (m.fromE1rm ? ' 估算 1RM ' : ' 1RM ') + fmtW(m.oneRM) + ' × ' + Math.round(m.ratio * 100) + '% × ' + Math.round(m.pct * 100) + '%' };
  }
  /** 重量单位：哑铃按单只，负重按外加，自重无重量 */
  function unitOf(equip) {
    return equip === '哑铃' ? 'kg 单只' : equip === '负重' ? 'kg 外加' : equip === '自重' ? '自重' : 'kg';
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
  /**
   * 按最后一组 AMRAP 次数自适应加重（仅「完整三阶」模式；「严格按表格」仍是固定步幅）。
   * 原理：次数 ↔ 强度有稳定的对应关系（NSCA %1RM–次数表；Epley 公式 1RM = w × (1 + 次数/30)）。
   * 末组次数远超「加重线」，说明这个重量其实比计划偏轻。把重量调到「刚好做到加重线次数」所需的重量，
   * 差值就是 gap；但 AMRAP 高次数时 Epley 会高估（>10 次误差明显），而且下次还要连做 5 组，
   * 所以只取 gap 的一半（ADAPT.damp）、次数最多按 15 次计（ADAPT.repCap）、一次最多加 3 档（ADAPT.maxSteps）。
   * 结果永远不会低于普通步幅——它只会「多加」，不会「少加」。
   */
  var ADAPT = { damp: 0.5, repCap: 15, maxSteps: 3, t3Extra: 10, t3MaxSteps: 2 };
  function adaptiveUp(P, w, a, add, step, inc) {
    var out = { up: step, boost: false, note: '' };
    if (!P.adaptive || P.ruleMode === 'excel' || !step || !(a > add) || !(w > 0)) return out;
    var ar = Math.min(a, ADAPT.repCap);
    var gap = w * ((1 + ar / 30) / (1 + add / 30) - 1);
    var want = roundTo(gap * ADAPT.damp, inc || step);
    var up = Math.max(step, Math.min(want, ADAPT.maxSteps * step));
    if (up > step) {
      out.up = up; out.boost = true;
      out.note = '末组 ' + a + ' 次，比加重线（' + add + ' 次）多 ' + (a - add) + ' 次，重量明显偏轻：本次多加到 +' + fmtW(up) + ' kg（常规 +' + fmtW(step) + '）';
    }
    return out;
  }
  function evaluate(s, st, e, P, deload) {
    var def = stageDef(s.tier, st.stage);
    var planned = st.weight, mw = manualW(e);
    var step = stepOf(s, P), inc = incOf(s, P);
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
      r.autoWeight = s.tier === 'T3' ? planned : alignTo(planned * f, inc);
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
        if (a >= def.add) {
          var ad = adaptiveUp(P, w, a, def.add, step, inc);
          r.judgment = '加重'; r.nextWeight = alignTo(fix(w + ad.up), inc); r.nextFail = 0;
          if (ad.boost) { r.boost = true; r.adaptNote = ad.note; }
        }
        else if (a >= def.hold && def.next !== null) { r.judgment = '保持'; r.nextFail = 0; }
        else if (def.next === null) {
          // 10×1+ 未达标：测试新 5RM，取 90% 为新 TM，重置回 5×3+
          r.judgment = '重置'; r.nextStage = FIRST_STAGE.T1; r.nextFail = 0;
          var p0 = s.init && s.init.type === 'pct' ? s.init.pct : 0.85;
          r.nextWeight = e.new5RM ? alignTo(Number(e.new5RM) * P.tmRatio * p0, inc) : alignTo(w * 0.85, inc);
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
      if (done) { r.judgment = '加重'; r.nextStage = '3×10'; r.nextWeight = alignTo(fix(w + step), inc); }
      else if (st.stage === '3×6') { r.judgment = mode === 'excel' ? '退阶' : '重置'; r.nextStage = '3×10'; r.nextWeight = alignTo(fix(w + step), inc); }
      else { r.judgment = '退阶'; r.nextStage = def.next; r.nextWeight = w; }
    } else {
      var t = Number(e.v);
      r.volume = fix(w * ((def.sets - 1) * def.reps + t));
      // =IF(F>=阈值,"加重","保持") / 上肢：ROUND((E+步幅)/2.5)*2.5
      if (t >= P.t3Threshold && equipOf(s.name, s.equip) === '自重') {
        r.judgment = '建议负重'; r.nextWeight = w; // 自重无法直接增加 kg，引导更换到同动作的负重版本
      } else if (t >= P.t3Threshold) {
        var up3 = step;
        if (P.adaptive && P.ruleMode !== 'excel' && step && t >= P.t3Threshold + ADAPT.t3Extra) {
          up3 = Math.min(ADAPT.t3MaxSteps, 2) * step; r.boost = true;
          r.adaptNote = '末组 ' + t + ' 次，超过加重线（' + P.t3Threshold + ' 次）' + (t - P.t3Threshold) + ' 次：本次多加一档 +' + fmtW(up3) + ' kg（常规 +' + fmtW(step) + '）';
        }
        r.judgment = '加重'; r.nextWeight = alignTo(fix(w + up3), inc);
      }
      else { r.judgment = '保持'; r.nextWeight = w; }
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
  // ================= 周期动作轮换（每 N 周一轮，自动编排 T2/T3） =================
  /**
   * 科学依据（已在说明页列出出处）：
   *  1. T1 四大项永不轮换——力量具有高度专项性（SAID 原则），主项需要持续重复才能进步。
   *  2. T2/T3 以「中周期」为单位系统性轮换：Kassiano 等 2022 年系统综述（JSCR 36:1753）指出，有计划的动作变化
   *     有利于肌肉各区域均衡增长与最大力量，而随意、过于频繁的轮换反而有害；Fonseca 2014（JSCR 28:3085）
   *     显示轮换动作组股四头肌四个头都增长、且深蹲 1RM 提升最大。所以：一轮内固定，换轮才换，不做每次随机。
   *  3. 同一位置只在「同一动作模式 / 同一目标肌群」的候选池里轮换，保证每周推、拉、蹲、髋铰链的比例与训练量不变。
   *  4. 不与上一轮重复；优先选最久没练过的动作（最近最少使用），同一轮内每个动作只出现一次。
   *  5. 候选池优先纳入「拉长位」动作（坐姿腿弯举 Maeo 2021、过头臂屈伸 Maeo 2023），其增肌效果有直接 MRI 证据。
   */
  var ROTATION = {
    A1_2: { role: '深蹲变式', why: '保持「蹲」模式，变换杠位与躯干角度，补强 T1 深蹲的薄弱环节', pool: ['前蹲', '泽奇深蹲', '箱式深蹲'] },
    A2_3: { role: '深蹲（次主项）', why: 'GZCLP 原版此位就是深蹲；只在迁移度最高的杠铃深蹲变式间切换', pool: ['杠铃深蹲', '箱式深蹲', '前蹲', '泽奇深蹲'] },
    A1_3: { role: '上斜推', why: '上胸与三角肌前束；杠铃与哑铃交替，兼顾负荷与活动范围', pool: ['上斜卧推', '上斜哑铃卧推', '哑铃卧推'] },
    A2_2: { role: '卧推变式', why: '针对卧推锁定段（窄距/臂屈伸练三头）与触胸段（暂停）', pool: ['窄距卧推', '暂停卧推', '负重双杠臂屈伸', '哑铃卧推'] },
    B1_2: { role: '垂直推', why: '支援站姿实力推；哑铃与杠铃交替改善左右力量平衡', pool: ['坐姿哑铃推肩', '杠铃推举', '阿诺德推举'] },
    B1_3: { role: '髋铰链', why: '支援硬拉的后链：腘绳肌、臀大肌、竖脊肌', pool: ['罗马尼亚硬拉', '赤字硬拉', '杠铃早安式', '臀推'] },
    B2_2: { role: '水平拉', why: '背部厚度，平衡卧推带来的推拉比例', pool: ['潘德雷划船', '杠铃划船', 'T杠划船'] },
    B2_3: { role: '背部容量', why: '水平拉与垂直拉交替，覆盖背阔不同纤维走向', pool: ['坐姿划船', '单臂哑铃划船', '负重引体向上', 'T杠划船'] },
    A1_4: { role: '垂直拉', why: '背阔宽度；改变握法以分散肘关节负担', pool: ['高位下拉', '对握高位下拉', '直臂下压'] },
    B1_4: { role: '垂直拉（自重）', why: '自重拉力；正握、反握与器械下拉交替', pool: ['引体向上', '反握引体向上', '对握高位下拉', '高位下拉'] },
    A1_5: { role: '腘绳肌', why: '屈膝动作在俯卧与坐姿间交替；坐姿（拉长位）增肌更优（Maeo 2021）', pool: ['俯卧腿弯举', '坐姿腿弯举', '山羊挺身'] },
    B1_5: { role: '三角肌中束', why: '哑铃与绳索交替：绳索在动作底部仍保持张力', pool: ['哑铃侧平举', '绳索侧平举'] },
    A2_4: { role: '肱二头', why: '改变握法与肩位：锤式练肱桡肌，上斜位拉长二头长头', pool: ['杠铃弯举', 'EZ杆弯举', '锤式弯举', '上斜哑铃弯举'] },
    B2_5: { role: '肱二头', why: '与 A2 的二头动作错开，每轮两种不同刺激', pool: ['哑铃弯举', '上斜哑铃弯举', '锤式弯举', 'EZ杆弯举'] },
    A2_5: { role: '肱三头', why: '过头位拉长三头长头，增肌优于下压（Maeo 2023）', pool: ['绳索三头屈伸', '过头绳索臂屈伸', '仰卧臂屈伸'] }, // 绳索下压与绳索三头屈伸同属下压，刺激重复，不入池,
    B2_4: { role: '后束 / 肩袖', why: '平衡大量推类动作，维护肩关节健康', pool: ['面拉', '反向飞鸟'] }
  };
  var ROTATION_PRINCIPLES = [
    { t: 'T1 四大项不轮换', d: '力量具有专项性（SAID 原则），深蹲、卧推、硬拉、实力推需要持续重复练习才能进步。' },
    { t: 'T2/T3 每轮换一次，一轮内固定', d: '系统综述显示：有计划的动作变化有利于肌肉均衡增长和最大力量，随意、过于频繁地换动作反而有害（Kassiano 等 2022，JSCR）。轮换动作组股四头肌四个头都增长、深蹲 1RM 提升最大（Fonseca 2014，JSCR）。' },
    { t: '同一位置只在同一动作模式内轮换', d: '每个位置都有固定的「角色」（如深蹲变式、髋铰链、垂直拉），保证每周推/拉/蹲/髋铰链的比例与训练量不变。' },
    { t: '不重复上一轮，优先最久没练的', d: '同一位置不会连续两轮用同一个动作；同一轮内每个动作只出现一次；候选里优先选最久没练过的。' },
    { t: '优先纳入拉长位动作', d: '坐姿腿弯举比俯卧腿弯举、过头臂屈伸比下压有更多肌肉增长（Maeo 2021 MSSE；Maeo 2023 EJSS，MRI 测量）。' },
    { t: '新动作重新进阶', d: 'T2 从 3×10、T3 从 3×15+ 开始；起始重量取「按当前估算 1RM 推算」与「该动作上次重量 × 90%」中较大者。' }
  ];
  function rotationOn(P, s) { return P.autoRotate !== false && s.tier !== 'T1' && !s.noRotate; }
  /** 某个位置的候选池：预设池 + 同层级、同部位的自定义动作 */
  function rotationPool(db, s) {
    var def = ROTATION[s.id], pool = def ? def.pool.slice() : [];
    var first = libFindIn(db, pool[0] || s.name), part = first ? first.part : '';
    if (!def && part) libAll(db).forEach(function (x) { if (x.tier === s.tier && x.part === part && pool.indexOf(x.name) < 0) pool.push(x.name); });
    ((db && db.customLib) || []).forEach(function (x) { if (x.tier === s.tier && part && x.part === part && pool.indexOf(x.name) < 0) pool.push(x.name); });
    return pool.filter(function (n) { return !!libFindIn(db, n); });
  }
  // 槽位编排顺序：先 T2 后 T3（T2 候选少、约束多，先排），同层按训练日顺序
  function rotationSlots(db) {
    var out = [];
    ['T2', 'T3'].forEach(function (t) { db.days.forEach(function (d) { d.slots.forEach(function (s) { if (s.tier === t) out.push(s); }); }); });
    return out;
  }
  function latestChange(s, from, to) {
    var ch = null;
    (s.changes || []).forEach(function (c) { if (c.fromWeek >= from && c.fromWeek <= to && (!ch || c.fromWeek >= ch.fromWeek)) ch = c; });
    return ch;
  }
  /**
   * 推演 1..upto 轮每个位置的动作。
   * planned[k][id]：第 k 轮开始时系统自动安排的动作；actual[k][id]：考虑用户本轮手动更换后的实际动作。
   * 纯函数（只看动作配置，不看训练记录），所以未来任意一轮都能提前预览。
   */
  function planCycles(db, upto) {
    var P = db.params, N = cycleLen(P), slots = rotationSlots(db), lastUse = {}, planned = [null], actual = [null];
    for (var k = 1; k <= upto; k++) {
      var start = cycleStartWeek(k, P), end = start + N - 1, pl = {}, act = {}, used = {}, prev = actual[k - 1], prevSet = {};
      if (prev) Object.keys(prev).forEach(function (id) { prevSet[prev[id]] = 1; });
      slots.forEach(function (s) {
        var name;
        if (k === 1 || !rotationOn(P, s)) {
          var c0 = latestChange(s, 1, k === 1 ? end : start - 1);
          name = c0 ? c0.name : s.name;
        } else {
          var pool = rotationPool(db, s), prevName = prev[s.id];
          var cands = pool.filter(function (n) { return n !== prevName && !used[n]; });
          var fresh = cands.filter(function (n) { return !prevSet[n]; });
          var list = fresh.length ? fresh : cands;
          list.sort(function (x, y) { return ((lastUse[x] || 0) - (lastUse[y] || 0)) || (pool.indexOf(x) - pool.indexOf(y)); });
          name = list.length ? list[0] : prevName;
        }
        pl[s.id] = name;
        var inCyc = latestChange(s, k === 1 ? 1 : start, end);
        act[s.id] = inCyc ? inCyc.name : name;
        used[act[s.id]] = 1;
      });
      Object.keys(act).forEach(function (id) { lastUse[act[id]] = k; });
      planned.push(pl); actual.push(act);
    }
    return { planned: planned, actual: actual };
  }
  /** 换入新动作的起始重量：max(按当前估算 1RM 推算, 该动作上次重量 × 90%) */
  function autoStartWeight(db, s, name, hist) {
    var lb = libFindIn(db, name), m = modelWeight(db.params, lb, s.tier, hist && hist.e1rm);
    if (m.bw) return 0;
    var last = hist && hist.lastW ? hist.lastW[name] : undefined;
    if (last > 0) return Math.max(m.weight, alignTo(last * 0.9, m.inc));
    return m.weight;
  }
  /** 第 cycle 轮该位置的自动轮换信息（不轮换返回 null） */
  function autoChange(db, s, cycle, hist) {
    if (cycle < 2 || !rotationOn(db.params, s)) return null;
    var plan = planCycles(db, cycle), name = plan.planned[cycle][s.id], prev = plan.actual[cycle - 1][s.id];
    if (!name || name === prev) return null;
    var lib = libFindIn(db, name);
    return { fromWeek: cycleStartWeek(cycle, db.params), name: name, equip: lib ? lib.equip : '', weight: autoStartWeight(db, s, name, hist), auto: true, cycle: cycle, prev: prev };
  }

  /** 某训练日第 week 次时，槽位实际执行的动作（考虑“从某周起更换”） */
  function effectiveSlot(db, s, week, hist) {
    var ch = null;
    (s.changes || []).forEach(function (c) { if (c.fromWeek <= week && (!ch || c.fromWeek >= ch.fromWeek)) ch = c; });
    // 自动轮换：本轮开始后用户没有手动换过，就用编排好的动作
    var auto = autoChange(db, s, cycleOf(week, db.params).cycle, hist);
    if (auto && (!ch || ch.fromWeek < auto.fromWeek)) ch = auto;
    if (!ch) return { slot: s, change: null, resetNow: false };
    var lib = libFindIn(db, ch.name);
    return { slot: Object.assign({}, s, { name: ch.name, equip: ch.equip || (lib ? lib.equip : '') }), change: ch, resetNow: ch.fromWeek === week, auto: !!ch.auto };
  }
  /** 执行一个槽位：处理“更换起始周重置”和“仅本次替换” */
  function runSlot(db, s, st, e, week, deload, hist) {
    var ef = effectiveSlot(db, s, week, hist);
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
    var states = initialStates(db), counts = {}, sessions = [], hist = { lastW: {}, e1rm: {} };
    DAY_ORDER.forEach(function (d) { counts[d] = 0; });
    db.days.forEach(function (d) { counts[d.id] = 0; });
    var recs = sortRecords(db.records), before = null;
    for (var i = 0; i < recs.length; i++) {
      var rec = recs[i];
      if (opts.untilId && rec.id === opts.untilId) {
        before = { states: JSON.parse(JSON.stringify(states)), week: counts[rec.day] + 1, hist: JSON.parse(JSON.stringify(hist)) };
        continue;
      }
      var day = dayById(db, rec.day);
      if (!day) continue;
      counts[rec.day] += 1;
      var week = counts[rec.day], items = [], vol = { T1: 0, T2: 0, T3: 0 };
      day.slots.forEach(function (s) {
        var res = runSlot(db, s, states[s.id], rec.entries ? rec.entries[s.id] : null, week, rec.deload, hist).res;
        items.push(res);
        vol[s.tier] += res.volume;
        states[s.id] = { stage: res.nextStage, weight: res.nextWeight, fail: res.nextFail };
      });
      items.forEach(function (it) {
        if (it.deload || it.judgment === '跳过') return;
        if (it.weight > 0) hist.lastW[it.name] = it.weight;
        if (it.tier === 'T1' && it.lift && it.e1rm) hist.e1rm[it.lift] = it.e1rm;
      });
      sessions.push({ rec: rec, week: week, dayName: day.name, items: items, volume: fix(vol.T1 + vol.T2 + vol.T3), vol: vol, index: sessions.length });
    }
    return { states: states, counts: counts, sessions: sessions, before: before, hist: hist };
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
    var states = rp.before ? rp.before.states : rp.states, hist = rp.before ? rp.before.hist : rp.hist;
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
        var ef0 = effectiveSlot(db, s0, week, hist), st0 = ef0.resetNow ? { weight: ef0.change.weight } : states[s0.id];
        if (e.ex === ef0.slot.name) { delete e.ex; }
        else {
          subDefault = lastW[e.ex] !== undefined ? lastW[e.ex] : st0.weight;
          if (manualW(e) === null) e.w = subDefault;
        }
      }
      var run = runSlot(db, s0, states[s0.id], e, week, deload, hist), res = run.res, st = run.st, s = run.eff.slot;
      var def = stageDef(s.tier, st.stage);
      var showW = deload ? res.dWeight : res.weight;
      if (res.sub && !deload) showW = res.weight;
      var showSets = deload ? res.dSets : def.sets;
      total += 1; if (hasValue(e) || e.skip) filled += 1;
      var dots = [];
      for (var k = 0; k < showSets; k++) dots.push({ i: k, on: k < (e.done || 0), amrap: !deload && s.tier !== 'T2' && k === showSets - 1 });
      return {
        slotId: s.id, tier: s.tier, tierColor: TIER_COLORS[s.tier], name: res.name, equip: equipOf(res.name, res.equip), equipNote: EQUIP_NOTE[equipOf(res.name, res.equip)] || '',
        unitText: unitOf(equipOf(res.name, res.equip)), isBW: equipOf(res.name, res.equip) === '自重',
        planName: s.name, sub: !!res.sub, changed: !!run.eff.change, changeNew: !!run.eff.resetNow,
        autoNew: !!(run.eff.auto && run.eff.resetNow), autoPrev: run.eff.auto && run.eff.change ? run.eff.change.prev : '',
        stage: st.stage, sets: showSets, reps: def.reps, weight: showW,
        weightText: equipOf(res.name, res.equip) === '自重' ? '自重' : fmtW(showW),
        canAdjust: equipOf(res.name, res.equip) !== '自重',
        plates: platesFor(showW, P, equipOf(res.name, res.equip)), fail: res.sub ? 0 : (st.fail || 0),
        restText: fmtRest(REST[s.tier]),
        manual: res.sub ? manualW(e) !== subDefault : res.manual, autoWeight: res.sub ? subDefault : res.autoWeight, autoText: fmtW(res.sub ? subDefault : res.autoWeight), wStep: incOf(Object.assign({}, s, { name: res.name, equip: equipOf(res.name, res.equip) }), P) || 1, editW: !!e.editW,
        repsText: showSets + '×' + def.reps + (s.tier !== 'T2' && !deload ? '+' : ''),
        inputType: deload ? 'deload' : s.tier === 'T2' ? 'done' : 'amrap',
        amrapHint: s.tier === 'T1' ? ('≥' + def.add + ' 加重' + (def.next ? ' · <' + def.hold + ' 预警' : ' · <' + def.add + ' 重置')) : s.tier === 'T3' ? ('≥' + P.t3Threshold + (equipOf(res.name, res.equip) === '自重' ? ' 建议切换负重版' : ' 加重')) : '',
        value: e.v, reps2: e.reps, skip: !!e.skip, new5RM: e.new5RM || '', done: e.done || 0, dots: dots,
        need5RM: s.tier === 'T1' && P.ruleMode !== 'excel' && st.stage === '10×1+',
        rest: REST[s.tier],
        preview: (hasValue(e) || deload) ? {
          judgment: res.judgment, color: JUDGE_COLORS[res.judgment] || '#8E8E93', icon: JUDGE_ICON[res.judgment] || '',
          nextStage: res.nextStage, nextWeight: fmtW(res.nextWeight), stageChanged: res.nextStage !== st.stage,
          delta: res.delta > 0 ? '+' + fmtW(res.delta) : res.delta < 0 ? fmtW(res.delta) : '±0', boost: !!res.boost, adaptNote: res.adaptNote || '',
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
        var ef = effectiveSlot(db, s0, nw, rp.hist), s = ef.slot;
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
    return { rotation: buildRotation(db, cycle, rp), rows: rows, overview: overview, days: db.days.map(function (d) { return { id: d.id, name: d.name }; }),
      done: done, planned: P.totalWeeks * nd, progress: Math.min(100, Math.round(done / (P.totalWeeks * nd) * 100)),
      cycle: cycle, curCycle: curCycle, maxCycle: maxCycle, weeksPerCycle: N,
      cycleText: '第 ' + cycle + ' 轮', isCurCycle: cycle === curCycle, isFuture: cycle > curCycle,
      canPrev: cycle > 1, canNext: cycle < maxCycle,
      cycleDone: cycDone, cyclePlanned: cycPlanned, cycleProgress: Math.min(100, Math.round(cycDone / cycPlanned * 100)),
      next: { day: rec.day, week: rec.week, name: dayById(db, rec.day).name, deload: isDeloadWeek(rec.week, P),
        cycle: recCyc.cycle, weekInCycle: recCyc.wc, weekText: weekText(rec.week, P) } };
  }

  // ---------- 视图模型：某一轮的动作编排（计划页展示 / 结算提示 / 设置页预览共用） ----------
  function buildRotation(db, cycle, rp) {
    var P = db.params; rp = rp || replay(db);
    var cur = cycleOf(recommend(db, rp).week, P).cycle;
    cycle = Math.max(1, cycle || cur);
    var plan = planCycles(db, cycle), act = plan.actual[cycle], prev = cycle > 1 ? plan.actual[cycle - 1] : null, changed = 0;
    var days = db.days.map(function (d) {
      return { id: d.id, name: d.name, slots: d.slots.filter(function (s) { return s.tier !== 'T1'; }).map(function (s) {
        var name = act[s.id], pv = prev ? prev[s.id] : '', isNew = !!prev && name !== pv, eq = equipOf(name, '');
        if (isNew) changed++;
        var def = ROTATION[s.id], startW = '';
        if (isNew && cycle >= cur) {
          var w = autoStartWeight(db, s, name, rp.hist);
          startW = eq === '自重' ? '自重' : fmtW(w) + ' ' + unitOf(eq);
        }
        return { id: s.id, tier: s.tier, name: name, equip: eq, prev: pv, isNew: isNew, locked: !rotationOn(P, s),
          role: def ? def.role : '', why: def ? def.why : '', startW: startW };
      }) };
    });
    return { cycle: cycle, curCycle: cur, enabled: P.autoRotate !== false, changed: changed, total: rotationSlots(db).length,
      isFuture: cycle > cur, days: days, principles: ROTATION_PRINCIPLES };
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
        var cnt = rp.counts[d.id] || 0, ef = effectiveSlot(db, s, cnt + 1, rp.hist);
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
    var lib = libFindIn(db, name);
    if (s.tier === 'T1' && (!lib || lib.tier !== 'T1')) return { error: 'T1 严格限定四大项，不能更换为其他动作' };
    var rp = replay(db), fromWeek = (rp.counts[dayId] || 0) + 1;
    var w = weight === null || weight === undefined || weight === '' || isNaN(Number(weight)) ? null : fix(Number(weight));
    s.changes = (s.changes || []).filter(function (c) { return c.fromWeek < fromWeek; });
    if (fromWeek === 1) {
      s.name = name; s.equip = lib ? lib.equip : '';
      if (w !== null && w !== initWeight(s, db.params)) s.init = { type: 'fixed', value: w };
      return { fromWeek: 1, base: true };
    }
    var cur = effectiveSlot(db, s, fromWeek, rp.hist).slot;
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
      // T1 是安全边界：即使搜索也不能跨层级混入非四大项；T2/T3 搜索仍可跨层查找替代动作
      if (tier === 'T1' && x.tier !== 'T1') return false;
      if (q) return x.name.indexOf(q) >= 0 || (x.part || '').indexOf(q) >= 0 || (x.equip || '').indexOf(q) >= 0;
      return x.tier === tier;
    }).map(function (x) {
      var rc = recommendWeight(db, x.name, x.tier, { preferLast: false });
      return { name: x.name, tier: x.tier, part: x.part, equip: x.equip, desc: x.desc, custom: !!x.custom, current: x.name === cur,
        last: lastW[x.name] !== undefined ? fmtW(lastW[x.name]) : '',
        rec: rc.text, recUnit: rc.unit, recNote: rc.note, isBW: x.equip === '自重' };
    });
    var eqCount = {}; EQUIPS.forEach(function (e) { eqCount[e] = 0; });
    all.filter(function (x) { return x.tier === tier; }).forEach(function (x) { eqCount[x.equip] = (eqCount[x.equip] || 0) + 1; });
    return { tier: tier, q: q, list: list, counts: counts, equipCounts: EQUIPS.map(function (e) { return { id: e, n: eqCount[e] || 0 }; }), tiers: ['T1', 'T2', 'T3'].map(function (t) { return { id: t, n: counts[t] }; }),
      customCount: ((db && db.customLib) || []).length };
  }
  /** 某槽位“下一次”的更换上下文（弹层用） */
  function swapContext(db, dayId, slotId) {
    var d = dayById(db, dayId), s = null;
    d.slots.forEach(function (x) { if (x.id === slotId) s = x; });
    var rp = replay(db), wk = (rp.counts[dayId] || 0) + 1, ef = effectiveSlot(db, s, wk, rp.hist), lastW = lastWeights(rp);
    var curW = ef.resetNow ? ef.change.weight : rp.states[s.id].weight;
    return { rotates: rotationOn(db.params, s), dayId: dayId, slotId: slotId, tier: s.tier, name: ef.slot.name, week: wk, weight: curW, weightText: fmtW(curW), lastW: lastW, base: wk === 1 };
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
      entries: entries, createdAt: rec.createdAt || Date.now(), updatedAt: Date.now() };
    var idx = -1;
    db.records.forEach(function (x, i) { if (x.id === r.id) idx = i; });
    if (idx >= 0) db.records[idx] = r; else db.records.push(r);
    return r;
  }
  // 删除会留下「删除标记」（tomb），多设备同步时另一台设备据此删除，而不是把记录同步回来
  function deleteRecord(db, id) {
    db.tomb = db.tomb || {}; db.tomb[id] = Date.now();
    db.records = db.records.filter(function (r) { return r.id !== id; });
  }
  function clearRecords(db) { (db.records || []).slice().forEach(function (r) { deleteRecord(db, r.id); }); }
  /** 整体替换（恢复备份 / 恢复默认）：旧数据里有、新数据里没有的记录记为删除，配置以新数据为准 */
  function replaceDb(oldDb, newDb) {
    var nd = normalize(newDb), keep = {}, tomb = Object.assign({}, (oldDb && oldDb.tomb) || {}, nd.tomb || {}), now = Date.now();
    nd.records.forEach(function (r) { keep[r.id] = 1; r.updatedAt = Math.max(r.updatedAt || r.createdAt || 0, now); delete tomb[r.id]; });
    ((oldDb && oldDb.records) || []).forEach(function (r) { if (!keep[r.id]) tomb[r.id] = now; });
    nd.tomb = tomb; nd.cfgAt = now;
    return nd;
  }

  // ================= 多设备同步：合并 =================
  /** 配置部分（参数、四天动作、自定义动作库）——任何一项变化都会刷新 cfgAt */
  function cfgPart(db) { return JSON.stringify([db.params, db.days, db.customLib || [], db.daysVersion]); }
  /** 保存前调用：配置有变化就记下修改时间，同步时据此判断以哪台设备的配置为准 */
  function stampConfig(prevDb, db) {
    if (!prevDb || cfgPart(prevDb) !== cfgPart(db)) db.cfgAt = Date.now();
    return db;
  }
  function recTime(r) { return r.updatedAt || r.createdAt || 0; }
  /**
   * 合并两份数据（本机 local，云端 remote），纯函数：
   *  - 训练记录：按 id 取并集；同一条两边都有，取最后修改的那份；
   *  - 删除标记：并集；记录的修改时间早于删除时间就丢弃（删除优先于旧记录，晚于删除的重新保存会保留）；
   *  - 配置：取 cfgAt 较新的一方；相同时以云端为准（新设备首次连接时，用云端已有的配置）。
   */
  function mergeDb(local, remote) {
    if (!remote) return normalize(JSON.parse(JSON.stringify(local)));
    if (!local) return normalize(JSON.parse(JSON.stringify(remote)));
    var a = JSON.parse(JSON.stringify(local)), b = JSON.parse(JSON.stringify(remote));
    var tomb = Object.assign({}, a.tomb || {});
    Object.keys(b.tomb || {}).forEach(function (id) { tomb[id] = Math.max(tomb[id] || 0, b.tomb[id]); });
    var byId = {};
    (a.records || []).concat(b.records || []).forEach(function (r) {
      var cur = byId[r.id];
      if (!cur || recTime(r) > recTime(cur)) byId[r.id] = r;
    });
    var records = Object.keys(byId).map(function (id) { return byId[id]; }).filter(function (r) { return !(tomb[r.id] && tomb[r.id] >= recTime(r)); });
    records.sort(function (x, y) { return (x.createdAt || 0) - (y.createdAt || 0) || (x.id < y.id ? -1 : 1); });
    var cfgSrc = (a.cfgAt || 0) > (b.cfgAt || 0) ? a : b;
    var out = { version: cfgSrc.version || a.version, daysVersion: cfgSrc.daysVersion, params: cfgSrc.params, days: cfgSrc.days, customLib: cfgSrc.customLib || [],
      cfgAt: Math.max(a.cfgAt || 0, b.cfgAt || 0), records: records, tomb: tomb };
    return normalize(out);
  }
  /** 两份数据内容是否一致（忽略记录顺序），用于决定要不要写回本机 / 推送云端 */
  function sameDb(x, y) {
    if (!x || !y) return false;
    var k = function (d) {
      var rs = (d.records || []).slice().sort(function (p, q) { return p.id < q.id ? -1 : 1; });
      var tb = Object.keys(d.tomb || {}).sort().map(function (id) { return id + ':' + d.tomb[id]; });
      return JSON.stringify([cfgPart(d), d.cfgAt || 0, rs, tb]);
    };
    return k(x) === k(y);
  }
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
    '推荐重量：T1=1RM×76.5%；T2≈1RM×动作系数×65%；T3≈1RM×动作系数×50%',
    '器械取整：杠铃按 2.5kg；哑铃按单只 1~2kg；负重按外加重量；自重只记次数；固定器械按配重档',
    '自适应加重：末组次数远超加重线时多加 1~2 档（T1 按 Epley 估算的差距取一半，最多 3 档；T3 超过阈值 10 次加 2 档）；只会多加，不会少加；「严格按表格」模式不启用',
    '动作轮换：T1 四大项固定；T2/T3 每轮（8 周）在同一动作模式内自动换一次，不与上一轮重复，一轮内保持不变',
    '记录原则：只填 AMRAP 次数或完成情况，阶段与重量自动推算'
  ];

  return {
    VERSION: VERSION, LIFTS: LIFTS, LIFT_ORDER: LIFT_ORDER, STEP_KEYS: STEP_KEYS, STAGES: STAGES, FIRST_STAGE: FIRST_STAGE,
    REST: REST, LIB: LIB, JUDGE_COLORS: JUDGE_COLORS, JUDGE_ICON: JUDGE_ICON, dateLabel: dateLabel, backupLabel: backupLabel, TIER_COLORS: TIER_COLORS, RULES: RULES, GENERAL_RULES: GENERAL_RULES,
    defaults: defaults, defaultDays: defaultDays, defaultParams: defaultParams, excelSeedRecords: excelSeedRecords, normalize: normalize,
    roundTo: roundTo, tm: tm, recommendWeight: recommendWeight, equipOf: equipOf, unitOf: unitOf, incOf: incOf, stepOf: stepOf, EQUIP_NOTE: EQUIP_NOTE, EQUIP_RULE: EQUIP_RULE, normEquip: normEquip, initWeight: initWeight, fmtW: fmtW, platesFor: platesFor, linreg: linreg,
    evaluate: evaluate, replay: replay, recommend: recommend, isDeloadWeek: isDeloadWeek, dayById: dayById,
    blankDraft: blankDraft, buildTrain: buildTrain, buildPlan: buildPlan, buildStats: buildStats, buildReview: buildReview,
    saveRecord: saveRecord, deleteRecord: deleteRecord, clearRecords: clearRecords, replaceDb: replaceDb, mergeDb: mergeDb, sameDb: sameDb, stampConfig: stampConfig, cfgPart: cfgPart, getRecord: getRecord, sessionResult: sessionResult, swapSlot: swapSlot, buildLibrary: buildLibrary, swapContext: swapContext, effectiveSlot: effectiveSlot,
    libAll: libAll, libFindIn: libFindIn, addCustomEx: addCustomEx, removeCustomEx: removeCustomEx, PARTS: PARTS, EQUIPS: EQUIPS, roundInfo: roundInfo, logView: logView, today: today, uid: uid,
    cycleOf: cycleOf, cycleLen: cycleLen, cycleStartWeek: cycleStartWeek, weekText: weekText,
    adaptiveUp: adaptiveUp, ADAPT: ADAPT, planCycles: planCycles, buildRotation: buildRotation, rotationOn: rotationOn, rotationPool: rotationPool, autoStartWeight: autoStartWeight,
    ROTATION: ROTATION, ROTATION_PRINCIPLES: ROTATION_PRINCIPLES, modelWeight: modelWeight
  };
});
