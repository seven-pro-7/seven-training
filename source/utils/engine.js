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
  var DAYS_VERSION = 4; // 动作模板版本。v4：T2 只放复合变式，T3 只放孤立；引体、高位下拉从 T3 调到 T2
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
  var REST = { T1: 180, T2: 150, T3: 75, C: 0 }; // 组间休息（秒）：T1 3~5min / T2 2~3min / T3 60~90s；C 为有氧，无组间休息
  var DAY_ORDER = ['A1', 'B1', 'A2', 'B2'];

  // Apple 系统色
  var JUDGE_COLORS = {
    '加重': '#E65A00', '建议负重': '#5856D6', '保持': '#34C759', '建议降阶': '#FF9F0A',
    '降阶': '#AF52DE', '退阶': '#AF52DE', '重置': '#FF3B30', '减载': '#5AC8FA', '跳过': '#C7C7CC', '替换': '#5856D6',
    '减轻': '#FF9F0A', '未完成': '#FF9F0A', '纪录': '#E65A00', '完成': '#34C759'
  };
  var TIER_COLORS = { T1: '#E65A00', T2: '#007AFF', T3: '#6C6C70', C: '#34C759' };
  var JUDGE_ICON = { '加重': '↑', '建议负重': '＋', '保持': '=', '建议降阶': '!', '降阶': '↓', '退阶': '↓', '重置': '↺', '减载': '~', '跳过': '–', '替换': '⇄', '减轻': '↓', '未完成': '!', '纪录': '↑', '完成': '=' };
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
    ['T2', '引体向上', '上肢·垂直拉', '自重', '垂直拉复合动作；以体重做次数，无外加重量', 'bench', 0, 0],
    ['T2', '负重引体向上', '上肢·垂直拉', '负重', '外加重量≈卧推的 10%，起步附加体重 5~10%', 'bench', 0.1, 2.5],
    ['T2', '反握引体向上', '上肢·垂直拉', '自重', '掌心朝内的垂直拉；以体重做次数', 'bench', 0, 0],
    ['T2', '高位下拉', '上肢·垂直拉', '器械', '垂直拉复合动作；配重约为卧推的 55%', 'bench', 0.55, 2.5],
    ['T2', '对握高位下拉', '上肢·垂直拉', '器械', '中立握垂直拉；配重约为卧推的 50%', 'bench', 0.5, 2.5],
    ['T2', '反握高位下拉', '上肢·垂直拉', '器械', '反握垂直拉，肘部更靠近身体；配重约为卧推的 48%', 'bench', 0.48, 2.5],
    ['T2', '俯身划船', '上肢·水平拉', '杠铃', '水平拉复合动作；约为卧推的 85%', 'bench', 0.85, 2.5],
    ['T2', '山羊挺身', '下背·伸髋', '器械', '髋铰链辅助；以体重做次数，需要时再手动加重', 'deadlift', 0, 0],
    ['T2', '高脚杯深蹲', '下肢·蹲', '哑铃', '深蹲模式变式；单只≈深蹲的 25%', 'squat', 0.25, 2],
    ['T2', '保加利亚分腿蹲', '下肢·单腿', '哑铃', '单腿蹲变式；单只≈深蹲的 25%', 'squat', 0.25, 2],
    ['T2', '双杠臂屈伸', '上肢·水平推', '自重', '下胸与三头；以体重做次数', 'bench', 0, 0],
    ['T2', '负重双杠臂屈伸', '上肢·水平推', '负重', '外加重量≈卧推的 12%', 'bench', 0.12, 2.5],
    ['T2', '腿举', '下肢·蹲', '器械', '腿部容量；配重约为深蹲的 140%', 'squat', 1.4, 5],
    ['T2', '哈克深蹲', '下肢·蹲', '器械', '股四头肌容量；配重约为深蹲的 90%', 'squat', 0.9, 5],
    ['T2', '坐姿划船', '上肢·水平拉', '器械', '背部厚度；配重约为卧推的 70%', 'bench', 0.7, 2.5],
    // ---- T3：只放单关节孤立，按 15RM（≈65% 以下）取重。引体、下拉、划船是复合动作，放在 T2 ----
    ['T3', '直臂下压', '上肢·垂直拉', '器械', '背阔孤立；配重约为卧推的 25%', 'bench', 0.25, 2.5],
    ['T3', '绳索下压', '上肢·伸肘', '器械', '三头主项；配重约为卧推的 30%', 'bench', 0.3, 2.5],
    ['T3', '绳索三头屈伸', '上肢·伸肘', '器械', '三头容量；配重约为卧推的 25%', 'bench', 0.25, 2.5],
    ['T3', '过头绳索臂屈伸', '上肢·伸肘', '器械', '拉长位练三头长头，增肌优于下压（Maeo 2023）；配重约为卧推的 22%', 'bench', 0.22, 2.5],
    ['T3', '仰卧臂屈伸', '上肢·伸肘', '杠铃', 'EZ 杆仰卧臂屈伸，三头长头；约为卧推的 30%', 'bench', 0.3, 1.25],
    ['T3', '面拉', '肩·后束', '器械', '肩袖与后束；配重约为卧推的 22%', 'bench', 0.22, 2.5],
    ['T3', '绳索夹胸', '上肢·水平内收', '器械', '胸大肌孤立；单侧配重约为卧推的 15%', 'bench', 0.15, 2.5],
    ['T3', '俯卧腿弯举', '下肢·屈膝', '器械', '腘绳肌容量；配重约为深蹲的 30%', 'squat', 0.3, 2.5],
    ['T3', '坐姿腿弯举', '下肢·屈膝', '器械', '屈髋位拉长腘绳肌，增肌优于俯卧位（Maeo 2021）；配重约为深蹲的 35%', 'squat', 0.35, 2.5],
    ['T3', '坐姿腿屈伸', '下肢·伸膝', '器械', '股四头肌容量；配重约为深蹲的 40%', 'squat', 0.4, 2.5],
    ['T3', '单腿腿屈伸', '下肢·伸膝', '器械', '单侧股四头肌；配重约为深蹲的 25%', 'squat', 0.25, 2.5],
    ['T3', '腿外展', '下肢·髋外展', '器械', '臀中肌；配重约为深蹲的 40%', 'squat', 0.4, 5],
    ['T3', '提踵', '下肢·踝', '器械', '小腿容量；配重约为深蹲的 60%', 'squat', 0.6, 5],
    ['T3', '杠铃弯举', '上肢·屈肘', '杠铃', '二头主项；约为卧推的 40%', 'bench', 0.4, 1.25],
    ['T3', 'EZ杆弯举', '上肢·屈肘', '杠铃', 'EZ 杆半旋握，腕部压力更小；约为卧推的 38%', 'bench', 0.38, 1.25],
    ['T3', '哑铃弯举', '上肢·屈肘', '哑铃', '二头容量；单只≈卧推的 15%', 'bench', 0.15, 1],
    ['T3', '锤式弯举', '上肢·屈肘', '哑铃', '肱桡肌与二头；单只≈卧推的 17%', 'bench', 0.17, 1],
    ['T3', '上斜哑铃弯举', '上肢·屈肘', '哑铃', '肩伸位拉长二头长头；单只≈卧推的 12%', 'bench', 0.12, 1],
    ['T3', '哑铃侧平举', '肩·中束', '哑铃', '三角肌中束；单只≈卧推的 14%', 'bench', 0.14, 1],
    ['T3', '绳索侧平举', '肩·中束', '器械', '底部仍有张力；单侧配重约为卧推的 7%', 'bench', 0.07, 1.25],
    ['T3', '反向飞鸟', '肩·后束', '哑铃', '三角肌后束；单只≈卧推的 12%', 'bench', 0.12, 1],
    ['T3', '哑铃耸肩', '肩·斜方', '哑铃', '斜方肌容量；单只≈硬拉的 30%', 'deadlift', 0.3, 2],
    ['T3', '卷腹', '核心·屈曲', '自重', '腹直肌；以体重做次数', 'squat', 0, 0],
    ['T3', '悬垂举腿', '核心·屈髋', '自重', '下腹与髋屈肌；以体重做次数', 'squat', 0, 0],
    // ---- 有氧：健身房稳态有氧，只记分钟，不记重量，不挂 1RM ----
    ['', '跑步机匀速', '有氧·跑步', '有氧', '能完整说话的配速匀速跑；记实际分钟', 'bench', 0, 0],
    ['', '跑步机坡走', '有氧·跑步', '有氧', '加坡度快走，能说话但略喘；记实际分钟', 'bench', 0, 0],
    ['', '单车', '有氧·骑行', '有氧', '匀速骑行，能完整说话；记实际分钟', 'bench', 0, 0],
    ['', '椭圆机', '有氧·椭圆', '有氧', '匀速踩踏，能完整说话；记实际分钟', 'bench', 0, 0],
    ['', '划船机', '有氧·划船', '有氧', '匀速划船，能完整说话；记实际分钟', 'bench', 0, 0],
    ['', '楼梯机', '有氧·台阶', '有氧', '匀速登阶，能说话但略喘；记实际分钟', 'bench', 0, 0]
  ].map(function (r) { return { tier: r[0], name: r[1], part: r[2], equip: r[3], desc: r[4], base: r[5], ratio: r[6], inc: r[7] }; });

  function libFind(name) {
    for (var i = 0; i < LIB.length; i++) if (LIB[i].name === name) return LIB[i];
    return null;
  }
  var PARTS = ['下肢·蹲', '下肢·髋铰链', '下肢·髋伸', '下肢·屈膝', '下肢·伸膝', '下肢·单腿', '下肢·踝', '下肢·髋外展',
    '上肢·水平推', '上肢·水平内收', '上肢·垂直推', '上肢·水平拉', '上肢·垂直拉', '上肢·屈肘', '上肢·伸肘',
    '肩·中束', '肩·后束', '肩·斜方', '下背·伸髋', '核心·屈曲', '核心·屈髋', '核心',
    '有氧·跑步', '有氧·骑行', '有氧·划船', '有氧·椭圆', '有氧·台阶', '其他'];
  /** 动作库的筛选模式。部位仍保留，用来在同一个模式里再收窄。 */
  var PATTERNS = [
    { id: 'squat', label: '蹲', parts: ['下肢·蹲', '下肢·单腿'] },
    { id: 'hinge', label: '髋铰链', parts: ['下肢·髋铰链', '下肢·髋伸', '下背·伸髋'] },
    { id: 'legs', label: '腿部孤立', parts: ['下肢·屈膝', '下肢·伸膝', '下肢·踝', '下肢·髋外展'] },
    { id: 'hpush', label: '水平推', parts: ['上肢·水平推', '上肢·水平内收'] },
    { id: 'vpush', label: '垂直推', parts: ['上肢·垂直推'] },
    { id: 'hpull', label: '水平拉', parts: ['上肢·水平拉'] },
    { id: 'vpull', label: '垂直拉', parts: ['上肢·垂直拉'] },
    { id: 'arm', label: '手臂', parts: ['上肢·屈肘', '上肢·伸肘'] },
    { id: 'shoulder', label: '肩', parts: ['肩·中束', '肩·后束', '肩·斜方'] },
    { id: 'core', label: '核心', parts: ['核心·屈曲', '核心·屈髋', '核心'] },
    { id: 'cardio', label: '有氧', parts: ['有氧·跑步', '有氧·骑行', '有氧·划船', '有氧·椭圆', '有氧·台阶'] },
    { id: 'other', label: '其他', parts: ['其他'] }
  ];
  function patternOfPart(part) {
    for (var i = 0; i < PATTERNS.length; i++) if (PATTERNS[i].parts.indexOf(part) >= 0) return PATTERNS[i];
    return PATTERNS[PATTERNS.length - 1];
  }
  function stampLib(x) { if (x && !x.pattern) x.pattern = patternOfPart(x.part).id; return x; }
  var EQUIPS = ['杠铃', '哑铃', '自重', '负重', '器械', '有氧'];
  // 器械类别说明（显示在动作库顶部与标签 tooltip）
  var EQUIP_NOTE = {
    '杠铃': '杠铃动作 · 重量=杠铃总重（含杆）',
    '哑铃': '哑铃动作 · 重量=单只哑铃',
    '自重': '自重动作 · 以体重做次数，无外加重量',
    '负重': '负重动作 · 重量=外加重量（腰带/背心），不含体重',
    '器械': '固定器械/绳索 · 重量=配重片',
    '有氧': '有氧 · 记分钟，不记重量'
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
    '器械': { base: 'bench', ratio: 0.3, inc: 2.5 },
    '有氧': { base: 'bench', ratio: 0, inc: 0 }
  };
  // 动作库 = 内置 + 自定义
  function libAll(db) {
    var custom = (db && db.customLib) || [];
    return custom.map(function (x) { return stampLib(Object.assign({ custom: true }, x)); }).concat(LIB.map(stampLib));
  }
  function libUnique(db) {
    var seen = {}, out = [];
    libAll(db).forEach(function (x) { if (seen[x.name]) return; seen[x.name] = 1; out.push(x); });
    return out;
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
    var eq = normEquip(ex.equip), part = ex.part || '其他';
    var d0 = DEF_PROFILE[eq] || DEF_PROFILE['杠铃'];
    db.customLib.unshift({ name: name, part: part, pattern: patternOfPart(part).id, equip: eq, desc: String(ex.desc || '').trim() || '自定义动作',
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
   * GZCLP 四天（每天 1×T1 + 2×T2 + 2×T3）
   *  - T1 主项：A1 深蹲 / B1 实力推 / A2 卧推 / B2 硬拉
   *  - T2 变式：同一动作模式的复合变式，外加垂直拉、水平拉。引体、高位下拉、划船都在这里
   *  - T3 孤立：单关节，弯举、侧平举、面拉、腿弯举、腿屈伸
   * 每个 T2/T3 在这一轮里只出现一次。已经练过的位置从下一次训练起换成新动作，已有记录仍按当时的动作回放。
   */
  function defaultDays() {
    return [
      { id: 'A1', name: '下肢蹲主导', slots: [
        slot('A1_1', 'T1', '杠铃深蹲', pct('squat', 0.85), 't1l', false, 'squat'),
        slot('A1_2', 'T2', '前蹲', pct('squat', 0.6), 't2l'),
        slot('A1_3', 'T2', '高位下拉', pct('bench', 0.55), 't2u'),
        slot('A1_4', 'T3', '坐姿腿屈伸', pct('squat', 0.35), 't3l', false),
        slot('A1_5', 'T3', '俯卧腿弯举', pct('squat', 0.3), 't3l', false)
      ] },
      { id: 'B1', name: '垂直推主导', slots: [
        slot('B1_1', 'T1', '站姿实力推', pct('ohp', 0.85), 't1u', false, 'ohp'),
        slot('B1_2', 'T2', '坐姿哑铃推肩', pct('ohp', 0.6), 't2u'),
        slot('B1_3', 'T2', '引体向上', fixed(0), 't2u', true),
        slot('B1_4', 'T3', '面拉', fixed(15), 't3u', true),
        slot('B1_5', 'T3', '哑铃侧平举', fixed(8), 't3u', true)
      ] },
      { id: 'A2', name: '水平推主导', slots: [
        slot('A2_1', 'T1', '平板卧推', pct('bench', 0.85), 't1u', false, 'bench'),
        slot('A2_2', 'T2', '窄距卧推', pct('bench', 0.65), 't2u'),
        slot('A2_3', 'T2', '箱式深蹲', pct('squat', 0.65), 't2l'),
        slot('A2_4', 'T3', '杠铃弯举', fixed(20), 't3u', true),
        slot('A2_5', 'T3', '绳索三头屈伸', pct('bench', 0.25), 't3u', true)
      ] },
      { id: 'B2', name: '髋铰链主导', slots: [
        slot('B2_1', 'T1', '传统硬拉', pct('deadlift', 0.85), 't1l', false, 'deadlift'),
        slot('B2_2', 'T2', '潘德雷划船', pct('bench', 0.55), 't2u'),
        slot('B2_3', 'T2', '罗马尼亚硬拉', pct('deadlift', 0.6), 't2l'),
        slot('B2_4', 'T3', '坐姿腿弯举', pct('squat', 0.3), 't3l', false),
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
      { id: "rmvahlea74du2", date: "2026-10-15", day: "A2", deload: false, note: "", bw: null, createdAt: 3,
        entries: {"A2_1": {"v": 17}, "A2_2": {"v": "完成"}, "A2_3": {"v": "完成"}, "A2_4": {"v": 17, "w": 50, "ex": "高位下拉"}, "A2_5": {"v": 16, "w": 10}} },
      { id: "rmvaj5j6l5hq3", date: "2026-10-16", day: "B2", deload: false, note: "", bw: null, createdAt: 4,
        entries: {"B2_1": {"v": 11}, "B2_2": {"v": "完成"}, "B2_3": {"v": "完成", "w": 35, "ex": "上斜哑铃卧推"}, "B2_4": {"v": 25}, "B2_5": {"v": 25, "w": 6}} }
    ];
  }
  /** 空白档案默认无记录。withSeed 为 true 时才写入表格样例（设置里的「恢复 Excel 默认」）。 */
  function defaults(withSeed) {
    return { version: VERSION, daysVersion: DAYS_VERSION, params: defaultParams(), days: defaultDays(), records: withSeed ? excelSeedRecords() : [], onboarding: { profileDone: false, directionDone: false, direction: {}, completedAt: '' } };
  }

  // ================= 新用户切入：资料 + 训练方向（档案层，可上云） =================
  var ONBOARD_GENDER = [
    { id: 'male', label: '男' }, { id: 'female', label: '女' }, { id: 'undisclosed', label: '不愿透露' }
  ];
  var ONBOARD_GOAL = [
    { id: 'fat_loss', label: '减脂', hint: '降低体脂，力量训练保住肌肉' },
    { id: 'reshape', label: '塑形体态', hint: '线条、体态与围度，不只看体重秤' },
    { id: 'muscle_gain', label: '增肌', hint: '增加肌肉量与围度' },
    { id: 'strength', label: '提升力量', hint: '深蹲、卧推、硬拉等主项变强' },
    { id: 'recomp', label: '减脂增肌兼顾', hint: '体脂与肌肉一起管，进步会慢一些' }
  ];
  var ONBOARD_EXPERIENCE = [
    { id: 'beginner', label: '刚开始' },
    { id: 'intermediate', label: '规律训练不到一年' },
    { id: 'advanced', label: '一年以上' }
  ];
  var ONBOARD_DAYS = [
    { id: '2_3', label: '每周 2–3 天' },
    { id: '4', label: '每周 4 天' },
    { id: '5_6', label: '每周 5–6 天' }
  ];
  var ONBOARD_EQUIP = [
    { id: 'full_gym', label: '完整健身房' },
    { id: 'barbell', label: '杠铃架为主' },
    { id: 'dumbbell_machine', label: '哑铃与器械为主' }
  ];
  function onboardIds(list) { return list.map(function (x) { return x.id; }); }
  function hasAvatar(sp) {
    return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test((sp && sp.avatar) || '') && String(sp.avatar).length < 180000;
  }
  function profileReady(db) {
    var sp = (db && db.params && db.params.shareProfile) || {};
    return hasAvatar(sp) && !!String(sp.name || '').trim() && onboardIds(ONBOARD_GENDER).indexOf(sp.gender) >= 0;
  }
  function directionReady(db) {
    var d = (db && db.onboarding && db.onboarding.direction) || {};
    return onboardIds(ONBOARD_GOAL).indexOf(d.goal) >= 0
      && onboardIds(ONBOARD_EXPERIENCE).indexOf(d.experience) >= 0
      && onboardIds(ONBOARD_DAYS).indexOf(d.daysPerWeek) >= 0
      && onboardIds(ONBOARD_EQUIP).indexOf(d.equipment) >= 0;
  }
  /** 已有训练记录的老档案视为完成。资料与训练方向流程已下架，不再拦截进入。 */
  function onboardingComplete(db) {
    if (!db) return true;
    if ((db.records || []).length > 0) return true;
    return profileReady(db) && directionReady(db);
  }
  function needsOnboarding() { return false; }
  function labelOf(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label;
    return '';
  }
  function directionSummary(db) {
    var d = (db && db.onboarding && db.onboarding.direction) || {};
    if (!directionReady(db)) return '';
    return [labelOf(ONBOARD_GOAL, d.goal), labelOf(ONBOARD_EXPERIENCE, d.experience), labelOf(ONBOARD_DAYS, d.daysPerWeek), labelOf(ONBOARD_EQUIP, d.equipment)].join(' · ');
  }
  function normalizeOnboarding(db) {
    var o = db.onboarding || {};
    var d = o.direction || {};
    var goal = onboardIds(ONBOARD_GOAL).indexOf(d.goal) >= 0 ? d.goal : '';
    var experience = onboardIds(ONBOARD_EXPERIENCE).indexOf(d.experience) >= 0 ? d.experience : '';
    var daysPerWeek = onboardIds(ONBOARD_DAYS).indexOf(d.daysPerWeek) >= 0 ? d.daysPerWeek : '';
    var equipment = onboardIds(ONBOARD_EQUIP).indexOf(d.equipment) >= 0 ? d.equipment : '';
    db.onboarding = {
      profileDone: !!o.profileDone || profileReady(db),
      directionDone: !!o.directionDone || directionReady(db),
      direction: { goal: goal, experience: experience, daysPerWeek: daysPerWeek, equipment: equipment },
      completedAt: o.completedAt || ''
    };
    if (profileReady(db) && directionReady(db) && !db.onboarding.completedAt) db.onboarding.completedAt = today();
    return db;
  }

  /** 升级模板前，记下每个动作下一次该用的重量，换槽位时带着走。 */
  function nextExerciseWeights(db) {
    var map = {};
    var rp = replay(db);
    db.days.forEach(function (d) {
      var wk = (rp.counts[d.id] || 0) + 1;
      d.slots.forEach(function (s) {
        var ef = effectiveSlot(db, s, wk, rp.hist);
        map[ef.slot.name] = startState(s, rp.states[s.id], ef, wk, progressionOf(db, s)).weight;
      });
    });
    return map;
  }
  /** 把一套 GZCLP 训练日对齐到当前模板。练过的槽位不改历史动作名，只从下一次训练起更换。 */
  function applyGzclpTemplate(db, days, pid, weightMap) {
    var fresh = defaultDays(), counts = {};
    (db.records || []).forEach(function (r) {
      if (recPid(r) !== pid || !r.day) return;
      counts[r.day] = (counts[r.day] || 0) + 1;
    });
    days.forEach(function (d) {
      var nd = fresh.filter(function (x) { return x.id === d.id; })[0];
      if (!nd) return;
      if (nd.name) d.name = nd.name;
      d.slots.forEach(function (s) {
        if (s.changes && s.changes.length) return;
        var ns = nd.slots.filter(function (x) { return x.id === s.id; })[0];
        if (!ns) return;
        if (ns.name === s.name) {
          s.tier = ns.tier; s.step = ns.step; s.roundProg = ns.roundProg;
          return;
        }
        var done = counts[d.id] || 0;
        if (!done) {
          s.name = ns.name; s.equip = ns.equip; s.tier = ns.tier;
          s.init = ns.init; s.step = ns.step; s.roundProg = ns.roundProg; s.lift = ns.lift;
          if (weightMap && weightMap[ns.name] !== undefined && !isNaN(Number(weightMap[ns.name]))) s.init = { type: 'fixed', value: Number(weightMap[ns.name]) };
          return;
        }
        s.tier = ns.tier; s.step = ns.step; s.roundProg = ns.roundProg;
        var w = weightMap && weightMap[ns.name];
        if (w === undefined || w === null || isNaN(Number(w))) w = initWeight(ns, db.params);
        s.changes = [{ fromWeek: done + 1, name: ns.name, equip: ns.equip, weight: Number(w), tier: ns.tier, step: ns.step }];
      });
    });
  }

  function normalize(db) {
    if (!db || !db.params || !db.days) return defaults(false);
    var p = defaultParams();
    db.params = Object.assign(p, db.params);
    db.params.oneRM = Object.assign(defaultParams().oneRM, db.params.oneRM);
    db.params.steps = Object.assign(defaultParams().steps, db.params.steps);
    db.records = db.records || [];
    db.customLib = db.customLib || [];
    if (db.params.shareProfile) {
      var g = db.params.shareProfile.gender;
      if (g !== 'male' && g !== 'female' && g !== 'undisclosed') delete db.params.shareProfile.gender;
    }
    normalizePrograms(db);
    normalizeOnboarding(db);
    // 日期校正：A2 这条记录实际是 10-15 完成，早期误记为 10-16（与 B2 同日）。
    // 只改这一条，重复执行无副作用；同步时以更新后的 updatedAt 为准，两台设备都会跟随。
    (db.records || []).forEach(function (r) {
      if (r.id === 'rmvahlea74du2' && r.date === '2026-10-16') {
        r.date = '2026-10-15';
        r.updatedAt = Math.max(r.updatedAt || r.createdAt || 0, Date.now());
      }
    });
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
    // 模板升级：未手动更换的槽位对齐最新编排。已经练过的位置保留原动作名，从下一次训练起换成新动作，避免把旧记录回放成另一个动作。
    if (db.daysVersion !== DAYS_VERSION) {
      var carried = nextExerciseWeights(db);
      applyGzclpTemplate(db, db.days, activePid(db), carried);
      (db.programs || []).forEach(function (p) {
        if (!p.snap || !p.snap.days || p.progression !== 'gzclp') return;
        applyGzclpTemplate(db, p.snap.days, p.id, carried);
        p.snap.daysVersion = DAYS_VERSION;
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
    '自重': { inc: 0, step: 0, incL: 0, stepL: 0 },
    '有氧': { inc: 0, step: 0, incL: 0, stepL: 0 }
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
    if (equip === '有氧') return { weight: 0, unit: '分钟', text: '—', source: 'cardio', equip: equip, inc: 0, note: '记分钟，不记重量' };
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
    return equip === '哑铃' ? 'kg 单只' : equip === '负重' ? 'kg 外加' : equip === '自重' ? '自重' : equip === '有氧' ? '分钟' : 'kg';
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
  function gzStageDef(tier, stage) { return STAGES[tier][stage] || STAGES[tier][FIRST_STAGE[tier]]; }
  function hasValue(e) { return e && e.v !== null && e.v !== undefined && e.v !== '' && !e.skip; }
  /** 这一项是否已经填完。双重进阶看每一组次数，固定组次看是否标记完成。 */
  function logged(s, e) {
    if (!e || e.skip) return false;
    if (s.prog === 'cardio' || equipOf(e.ex || s.name, s.equip) === '有氧') return hasValue(e) && !isNaN(Number(e.v));
    if (s.prog === 'dual') {
      var n = (s.scheme && s.scheme.sets) || 0, arr = e.sets || [], i;
      if (!n) return false;
      for (i = 0; i < n; i++) if (arr[i] === null || arr[i] === undefined || arr[i] === '') return false;
      return true;
    }
    if (s.prog === 'fixed') return e.v === '完成' || e.v === 1 || e.v === '1';
    return hasValue(e);
  }

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
  function gzEvaluate(s, st, e, P, deload) {
    var def = gzStageDef(s.tier, st.stage);
    var planned = st.weight, mw = manualW(e);
    var step = stepOf(s, P), inc = incOf(s, P);
    // 手动重量：本次按实际重量计算判定，下次重量在实际重量上推进
    var w = mw !== null && !deload ? mw : planned;
    var r = {
      slotId: s.id, tier: s.tier, badge: slotBadge(s), name: s.name, equip: s.equip, lift: s.lift,
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

  // ================= 多计划：共享底座 / 计划 / 记录 =================
  /**
   * 存储形状（向下兼容 v1，只增字段）：
   *   params / days / daysVersion  —— 当前进行中计划的「物化」副本：引擎与界面照旧直接读，不用改
   *   programs[]                   —— 全部计划的元数据；非当前计划另存 snap = { params: 计划参数, days, daysVersion }
   *   activeProgramId              —— 当前计划（同一时间只有一个）
   *   records[].programId          —— 记录归属；旧记录没有这个字段，一律归第一个计划 LEGACY_PID，记录本身不改写
   * 参数分两类：
   *   BASE_KEYS 共享底座（体重、器材、名片）——所有计划共用，切换计划不变。规范见 .cursor/rules/plan-base.mdc
   *   PLAN_KEYS 计划自己（规则参数、周期、减载、计划起始 1RM）——各计划独立，暂停时随计划冻结
   *   层级显示名只在 TIER_LABELS：GZCLP 是 T1/T2/T3，其他进阶是主项/变式/孤立或 BBB。界面走 slotBadge / tierLabel。
   * 1RM 的口径：每个计划冻结自己的起始 1RM（避免改一次 1RM 就改写已暂停计划的历史）；
   *   跨计划共享的是「1RM 档案」oneRMProfile：手动录入值 + 所有计划的估算 1RM，用于新计划的起始重量。
   */
  var LEGACY_PID = 'p-gzclp-1';
  var BASE_KEYS = ['bodyWeight', 'barWeight', 'plates', 'rounding', 'shareProfile'];
  var PLAN_KEYS = ['oneRM', 'tmRatio', 'steps', 't3Threshold', 'ruleMode', 'totalWeeks', 'weeksPerCycle', 'deloadEnabled', 'deloadEvery', 't1FailLimit', 'adaptive', 'autoRotate', 'progression'];
  var PROGRAM_STATUS = { active: '进行中', paused: '已暂停', ended: '已结束' };
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function pickKeys(o, keys) { var r = {}; keys.forEach(function (k) { if (o && o[k] !== undefined) r[k] = clone(o[k]); }); return r; }
  function firstRecordDate(db, pid) {
    var ds = (db.records || []).filter(function (r) { return recPid(r) === pid && /^\d{4}-\d{2}-\d{2}$/.test(r.date || ''); }).map(function (r) { return r.date; }).sort();
    return ds[0] || '';
  }
  function normalizePrograms(db) {
    if (!Array.isArray(db.programs) || !db.programs.length) {
      db.programs = [{ id: LEGACY_PID, template: 'gzclp-8w', name: 'GZCLP · 8 周', progression: 'gzclp', status: 'active', startedAt: '', endedAt: '', snap: null }];
      db.activeProgramId = LEGACY_PID;
    }
    if (!db.programs.some(function (p) { return p.id === db.activeProgramId; })) db.activeProgramId = db.programs[0].id;
    db.programs.forEach(function (p) {
      if (p.id === db.activeProgramId) p.snap = null; // 当前计划的训练日就在 db.days 上，暂停、结束也留在这里
      else if (p.status === 'active') p.status = 'paused';   // 不变式：同一时间最多一个进行中
      if (!p.startedAt) p.startedAt = firstRecordDate(db, p.id);
    });
  }
  function recPid(r) { return (r && r.programId) || LEGACY_PID; }
  function activePid(db) { return (db && db.activeProgramId) || LEGACY_PID; }
  function programById(db, pid) { return (db.programs || []).filter(function (p) { return p.id === pid; })[0] || null; }
  function activeProgram(db) { return programById(db, activePid(db)); }
  /** 当前计划还能不能继续练（主动结束后为 false，需要选下一个计划） */
  function canTrain(db) { var p = activeProgram(db); return !p || p.status === 'active'; }
  /** 暂停当前计划：训练日和记录都留在原地，只是不能再记新的一次。 */
  function pauseProgram(db, pid) {
    var p = programById(db, pid || activePid(db));
    if (!p) throw new Error('找不到这个计划');
    if (p.id !== activePid(db)) throw new Error('只能暂停正在进行的计划');
    if (p.status === 'ended') throw new Error('已结束的计划不能暂停');
    if (p.status === 'paused') return db;
    p.status = 'paused'; p.pausedAt = today();
    return db;
  }
  /** 继续一个暂停的计划。若它不是当前计划，会先暂停正在进行的那套。 */
  function resumeProgram(db, pid) {
    var p = programById(db, pid || activePid(db));
    if (!p) throw new Error('找不到这个计划');
    if (p.status === 'ended') throw new Error('已结束的计划只能查看，不能继续训练');
    if (p.id !== activePid(db)) return switchProgram(db, pid);
    p.status = 'active'; p.pausedAt = '';
    return db;
  }
  /**
   * 计划视图：把任意一个计划投影成引擎认识的形状（底座参数 + 该计划参数、该计划的训练日），
   * replay / build* 原样复用；回放只会读这个计划自己的记录。
   */
  function rootOf(db) { return (db && db.__root) || db; }
  function planView(db, pid) {
    var root = rootOf(db);
    if (!pid || pid === activePid(root)) return root;
    var p = programById(root, pid);
    if (!p || !p.snap) return null;
    db = root;
    var v = Object.assign({}, db);
    Object.defineProperty(v, '__root', { value: root, enumerable: false });   // 视图里仍能找到真正的当前计划
    v.params = Object.assign({}, pickKeys(db.params, BASE_KEYS), clone(p.snap.params));
    v.params.oneRM = Object.assign(defaultParams().oneRM, v.params.oneRM);
    v.params.steps = Object.assign(defaultParams().steps, v.params.steps);
    v.params.watch = db.params.watch;
    v.days = clone(p.snap.days); v.daysVersion = p.snap.daysVersion; v.activeProgramId = pid;
    return v;
  }
  function freezeActive(db, status) {
    var p = activeProgram(db); if (!p) return;
    p.snap = { params: pickKeys(db.params, PLAN_KEYS), days: clone(db.days), daysVersion: db.daysVersion };
    p.status = status;
    if (status === 'paused') p.pausedAt = today();
  }
  function thaw(db, p) {
    var keep = pickKeys(db.params, BASE_KEYS);
    PLAN_KEYS.forEach(function (k) { delete db.params[k]; });
    var dp = defaultParams();
    db.params = Object.assign(dp, keep, clone(p.snap.params), { watch: db.params.watch });
    if (db.params.watch === undefined) delete db.params.watch;
    db.params.oneRM = Object.assign(defaultParams().oneRM, db.params.oneRM);
    db.params.steps = Object.assign(defaultParams().steps, db.params.steps);
    db.days = clone(p.snap.days); db.daysVersion = p.snap.daysVersion;
    p.snap = null; db.activeProgramId = p.id;
  }
  /** 切换到另一个计划（暂停当前，续练目标）。已结束的计划只读，不能切回来练 */
  function switchProgram(db, pid) {
    if (pid === activePid(db)) return db;
    var t = programById(db, pid);
    if (!t) throw new Error('找不到这个计划');
    if (t.status === 'ended') throw new Error('已结束的计划只能查看，不能继续训练');
    var cur = activeProgram(db);
    freezeActive(db, cur && cur.status === 'ended' ? 'ended' : 'paused');
    thaw(db, t); t.status = 'active'; t.pausedAt = '';
    return db;
  }
  /** 主动结束一个计划：记录全部保留、只读；结束当前计划后，需要开始或续练另一个计划才能继续训练 */
  function endProgram(db, pid) {
    var p = programById(db, pid || activePid(db));
    if (!p) throw new Error('找不到这个计划');
    p.status = 'ended'; p.endedAt = today();
    return db;
  }
  /**
   * 开始一个新计划：def = { template, name, progression, params(计划参数), days }
   * 当前计划自动暂停（已结束的保持结束）。
   */
  function startProgram(db, def) {
    def = def || {};
    var cur = activeProgram(db);
    if (cur) freezeActive(db, cur.status === 'ended' ? 'ended' : 'paused');
    var id = def.id || ('p-' + uid().slice(1));
    var p = { id: id, template: def.template || '', name: def.name || '新计划', progression: def.progression || 'gzclp', status: 'paused', startedAt: def.startedAt || today(), endedAt: '',
      snap: { params: Object.assign(pickKeys(defaultParams(), PLAN_KEYS), clone(def.params || {}), { progression: def.progression || 'gzclp' }), days: clone(def.days || defaultDays()), daysVersion: DAYS_VERSION } };
    db.programs.push(p);
    thaw(db, p); p.status = 'active';
    return p;
  }
  /** 计划列表（含记录统计），当前计划在前 */
  function programList(db) {
    var cnt = {}, last = {};
    (db.records || []).forEach(function (r) { var k = recPid(r); cnt[k] = (cnt[k] || 0) + 1; if (!last[k] || r.date > last[k]) last[k] = r.date; });
    return (db.programs || []).map(function (p) {
      var prog = PROGRESSIONS[p.progression] || PROGRESSIONS.gzclp;
      return { id: p.id, name: p.name, template: p.template, progression: p.progression, progressionName: prog ? prog.name : p.progression,
        status: p.status, statusText: PROGRAM_STATUS[p.status] || p.status, active: p.id === activePid(db),
        startedAt: p.startedAt, endedAt: p.endedAt || '', pausedAt: p.pausedAt || '', sessions: cnt[p.id] || 0, lastDate: last[p.id] || '' };
    }).sort(function (a, b) { return (b.active - a.active) || ((b.lastDate || b.startedAt) > (a.lastDate || a.startedAt) ? 1 : -1); });
  }
  /** 全部计划的回放（每个计划只读自己的记录），用于终身里程碑、1RM 档案 */
  function replayAll(db) {
    db = rootOf(db);
    return (db.programs || []).map(function (p) { var v = planView(db, p.id); return v ? { program: p, view: v, rp: replay(v) } : null; }).filter(Boolean);
  }
  /** 1RM 档案（共享底座）：手动录入值 + 各计划估算 1RM 的最近值与最佳值 */
  function oneRMProfile(db) {
    db = rootOf(db);
    var out = {};
    LIFT_ORDER.forEach(function (k) { out[k] = { lift: k, name: LIFTS[k], manual: db.params.oneRM[k], e1rm: [], latest: null, best: null }; });
    replayAll(db).forEach(function (x) {
      x.rp.sessions.forEach(function (s) {
        s.items.forEach(function (it) {
          if (!it.lift || !it.e1rm || it.deload || it.judgment === '替换') return;
          out[it.lift] && out[it.lift].e1rm.push({ date: s.rec.date, v: it.e1rm, programId: x.program.id });
        });
      });
    });
    Object.keys(out).forEach(function (k) {
      var o = out[k]; o.e1rm.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      o.latest = o.e1rm.length ? o.e1rm[o.e1rm.length - 1] : null;
      o.e1rm.forEach(function (x) { if (!o.best || x.v > o.best.v) o.best = x; });
    });
    return out;
  }

  // ================= 进阶策略（可插拔） =================
  /**
   * 进阶策略只回答一个问题：「一个动作槽位，这次练成这样，下次该练什么」。
   * 训练日编排、动作轮换、周轮次、回放、统计、徽章、分享都与具体策略无关，只通过下面的接口取数。
   *   id / name / desc
   *   firstStage(tier)                  → 该层级的第一个阶段键
   *   stageDef(tier, stage)             → { sets, reps, add?, hold?, next? }（训练页显示组数与次数）
   *   initState(slot, P)                → 计划开始时的状态 { stage, weight, fail }
   *   freshState(slot, weight)          → 换入新动作时从头进阶的状态
   *   evaluate(slot, state, entry, P, deload) → 本次结果：judgment / nextStage / nextWeight / nextFail / volume / e1rm …
   *   amrapLast(tier)                   → 最后一组是否 AMRAP（训练页最后一个圆点画成实心）
   * 层级 T1/T2/T3 在策略之外统一映射为通用角色：主项 / 变式 / 孤立（roleOf），
   * 换计划时历史数据按「动作名 + 角色」衔接，不依赖某个策略的阶段名。
   */
  var PROGRESSIONS = {};
  var PROG_KEYS = ['id', 'name', 'firstStage', 'stageDef', 'initState', 'freshState', 'evaluate', 'amrapLast'];
  function registerProgression(def) {
    PROG_KEYS.forEach(function (k) { if (!def || def[k] === undefined) throw new Error('进阶策略缺少 ' + k + '：' + (def && def.id)); });
    PROGRESSIONS[def.id] = def;
    return def;
  }
  function progressionOf(db, slot) {
    var id = slot && slot.prog;
    if (!id && db && db.params) id = db.params.progression;
    if (!id && db && db.programs) { var p = activeProgram(db); id = p && p.progression; }
    return PROGRESSIONS[id] || PROGRESSIONS.gzclp;
  }
  var ROLES = { T1: 'main', T2: 'assist', T3: 'accessory', C: 'cardio' };
  /**
   * 每个进阶的层级显示名。界面只从这里取，不要在页面里再写一套。
   * 槽位自己的 prog 优先；GZCLP 的槽位不写 prog，缺省就是 gzclp。
   */
  var TIER_LABELS = {
    gzclp: { T1: 'T1', T2: 'T2', T3: 'T3', C: '有氧' },
    w531: { T1: '主项', T2: '主项', T3: '主项', C: '有氧' },
    fixed: { T1: 'BBB', T2: 'BBB', T3: 'BBB', C: '有氧' },
    linear: { T1: '主项', T2: '变式', T3: '孤立', C: '有氧' },
    dual: { T1: '主项', T2: '变式', T3: '孤立', C: '有氧' },
    cardio: { T1: '有氧', T2: '有氧', T3: '有氧', C: '有氧' }
  };
  var ROLE_NAME = { main: TIER_LABELS.dual.T1, assist: TIER_LABELS.dual.T2, accessory: TIER_LABELS.dual.T3, cardio: '有氧' };
  function roleOf(tier) { return ROLES[tier] || 'accessory'; }
  function tierLabel(progId, tier) {
    var table = TIER_LABELS[progId] || TIER_LABELS.dual;
    if (tier === 'C') return '有氧';
    return (tier && table[tier]) || '动作';
  }
  /** 槽位徽章。progHint 是计划进阶，槽位自己的 prog（BBB、有氧）优先。 */
  function slotBadge(s, progHint) {
    var prog = (s && s.prog) || progHint || 'gzclp';
    return tierLabel(prog, s && s.tier);
  }

  registerProgression({
    id: 'gzclp', name: 'GZCLP', family: 'stage',
    desc: 'T1 5×3+ → 6×2+ → 10×1+，T2 3×10 → 3×8 → 3×6，T3 3×15+ 末组达标加重；每次训练都可能加重。',
    firstStage: function (tier) { return FIRST_STAGE[tier]; },
    stageDef: gzStageDef,
    initState: function (s, P) { return { stage: FIRST_STAGE[s.tier], weight: initWeight(s, P), fail: 0 }; },
    freshState: function (s, weight) { return { stage: FIRST_STAGE[s.tier], weight: weight, fail: 0 }; },
    evaluate: gzEvaluate,
    amrapLast: function (tier) { return tier !== 'T2'; }
  });
  // 兼容旧调用：GZ.evaluate / 内部 stageDef 仍指向 GZCLP
  var evaluate = gzEvaluate, stageDef = gzStageDef;

  // ---------- 计划库：双重进阶 / 线性 / 5/3/1（已确认的应用规则） ----------
  // 向上取整到档位。对应 Wendler 原书 Excel 的 CEILING(..., 5)。
  function ceilTo(x, inc) {
    inc = inc || 2.5;
    if (!(inc > 0)) return fix(x);
    return fix(Math.ceil(x / inc - 1e-9) * inc);
  }
  function waveWeek(week) { return ((Math.max(1, week) - 1) % 4) + 1; }
  function waveTop(tm, wk, inc) {
    var pct = { 1: 0.85, 2: 0.9, 3: 0.95, 4: 0.6 }[wk] || 0.85;
    return ceilTo(tm * pct, inc || 2.5);
  }
  var WAVE = {
    1: [[0.65, 5, false], [0.75, 5, false], [0.85, 5, true]],
    2: [[0.70, 3, false], [0.80, 3, false], [0.90, 3, true]],
    3: [[0.75, 5, false], [0.85, 3, false], [0.95, 1, true]],
    4: [[0.40, 5, false], [0.50, 5, false], [0.60, 5, false]]
  };
  function resultBase(s, st, w) {
    return {
      slotId: s.id, tier: s.tier, badge: slotBadge(s), name: s.name, equip: s.equip, lift: s.lift,
      stage: st.stage, sets: 0, reps: 0, weight: w, planned: st.weight, manual: false, fail: st.fail || 0,
      input: null, judgment: '', nextStage: st.stage, nextWeight: st.weight, nextFail: st.fail || 0, nextCycleMiss: st.cycleMiss || 0,
      volume: 0, e1rm: null, delta: 0, deload: false, autoWeight: st.weight, loads: null, inputMode: ''
    };
  }
  function dualEvaluate(s, st, e) {
    var sc = s.scheme || { sets: 3, repMin: 8, repMax: 12, step: 2.5 };
    var step = sc.step || 2.5, planned = st.weight, mw = manualW(e), w = mw !== null ? mw : planned;
    var r = resultBase(s, st, w);
    r.manual = mw !== null; r.sets = sc.sets; r.reps = sc.repMax; r.inputMode = 'sets'; r.autoWeight = planned;
    r.nextStage = sc.repMin + '–' + sc.repMax;
    var nums = [], i;
    for (i = 0; i < sc.sets; i++) {
      var raw = e && e.sets ? e.sets[i] : null;
      var n = raw === null || raw === undefined || raw === '' ? null : Number(raw);
      nums.push(n);
      r.loads = r.loads || [];
      r.loads.push({ reps: sc.repMin + '–' + sc.repMax, weight: w, amrap: false, value: n });
    }
    if (e && e.skip) { r.judgment = '跳过'; r.nextWeight = planned; return r; }
    if (nums.some(function (n) { return n === null || isNaN(n); })) { r.judgment = '跳过'; r.nextWeight = planned; return r; }
    r.input = nums.join('/');
    r.volume = fix(nums.reduce(function (a, n) { return a + w * n; }, 0));
    var best = Math.max.apply(null, nums);
    if (w > 0 && best > 0) r.e1rm = fix(w * (1 + Math.min(best, 12) / 30));
    if (nums.every(function (n) { return n >= sc.repMax; })) {
      r.judgment = '加重'; r.nextWeight = alignTo(w + step, step); r.nextFail = 0;
    } else if (nums.some(function (n) { return n <= sc.repMin - 2; })) {
      r.judgment = '减轻'; r.nextWeight = Math.max(step, alignTo(w - step, step)); r.nextFail = 0;
    } else {
      r.judgment = '保持'; r.nextWeight = w; r.nextFail = 0;
    }
    r.delta = fix(r.nextWeight - planned);
    return r;
  }
  function linearEvaluate(s, st, e) {
    var sc = s.scheme || { sets: 5, reps: 5, step: 2.5 };
    var step = sc.step || 2.5, inc = sc.inc || 2.5, planned = st.weight, mw = manualW(e), w = mw !== null ? mw : planned;
    var r = resultBase(s, st, w);
    r.manual = mw !== null; r.sets = sc.sets; r.reps = sc.reps; r.inputMode = 'linear'; r.autoWeight = planned;
    r.nextStage = sc.sets + '×' + sc.reps + '+';
    var amrap = e && e.v !== null && e.v !== undefined && e.v !== '' ? Number(e.v) : null;
    if (e && e.skip || amrap === null || isNaN(amrap)) { r.judgment = '跳过'; r.nextWeight = planned; return r; }
    r.input = amrap;
    var straight = Math.max(0, sc.sets - 1);
    r.volume = fix(w * (straight * sc.reps + amrap));
    if (w > 0 && amrap > 0) r.e1rm = fix(w * (1 + amrap / 30));
    var ok = !e.miss && amrap >= sc.reps;
    if (ok) { r.judgment = '加重'; r.nextWeight = alignTo(w + step, inc); r.nextFail = 0; }
    else {
      var fails = (st.fail || 0) + 1;
      if (fails >= 3) { r.judgment = '减载'; r.nextWeight = Math.max(inc, alignTo(w * 0.9, inc)); r.nextFail = 0; }
      else { r.judgment = '保持'; r.nextWeight = w; r.nextFail = fails; }
    }
    r.delta = fix(r.nextWeight - planned);
    return r;
  }
  function waveEvaluate(s, st, e, P, deload, week) {
    var sc = s.scheme || { step: 2.5, inc: 2.5 };
    var wk = waveWeek(week || 1), rows = WAVE[wk], tm0 = st.weight, inc = sc.inc || 2.5, step = sc.step || 2.5;
    var r = resultBase(s, st, tm0);
    r.inputMode = 'wave'; r.sets = rows.length; r.autoWeight = tm0; r.stage = '第' + wk + '周';
    r.loads = rows.map(function (row) {
      return { pct: row[0], reps: row[1], weight: ceilTo(tm0 * row[0], inc), amrap: row[2] && wk !== 4 };
    });
    var top = r.loads[r.loads.length - 1];
    r.weight = top.weight; r.reps = top.reps;
    var amrap = e && e.v !== null && e.v !== undefined && e.v !== '' ? Number(e.v) : null;
    if (e && e.skip || amrap === null || isNaN(amrap)) { r.judgment = '跳过'; r.nextWeight = tm0; r.nextStage = '第' + wk + '周'; r.barNext = waveTop(tm0, wk, inc); return r; }
    r.input = amrap;
    r.volume = fix(r.loads.reduce(function (a, ld, i) {
      var reps = i === r.loads.length - 1 ? amrap : ld.reps;
      return a + ld.weight * reps;
    }, 0));
    if (tm0 > 0 && amrap > 0 && wk !== 4) r.e1rm = fix(top.weight * (1 + amrap / 30));
    var need = top.reps, missed = !!(e && e.miss) || amrap < need;
    var cycleMiss = missed ? 1 : (st.cycleMiss || 0);
    if (wk < 4) {
      r.judgment = missed ? '未完成' : (amrap > need ? '纪录' : '完成');
      r.nextWeight = tm0; r.nextFail = st.fail || 0; r.nextCycleMiss = cycleMiss; r.nextStage = '第' + waveWeek(week + 1) + '周';
      r.barNext = waveTop(tm0, waveWeek(week + 1), inc);
    } else {
      var streak = (st.fail || 0) + (cycleMiss ? 1 : 0);
      if (!cycleMiss) { r.judgment = '加重'; r.nextWeight = alignTo(tm0 + step, inc); r.nextFail = 0; }
      else if (streak >= 2) { r.judgment = '重置'; r.nextWeight = Math.max(inc, ceilTo(tm0 * 0.9, inc)); r.nextFail = 0; }
      else { r.judgment = '保持'; r.nextWeight = tm0; r.nextFail = streak; }
      r.nextCycleMiss = 0; r.nextStage = '第1周';
      r.barNext = waveTop(r.nextWeight, 1, inc);
    }
    r.delta = fix(r.nextWeight - tm0);
    return r;
  }
  function fixedEvaluate(s, st, e, P, deload, week) {
    var sc = s.scheme || { sets: 5, reps: 10 };
    var sets = sc.sets, half = sc.halfOnDeload && waveWeek(week || 1) === 4;
    if (half) sets = Math.ceil(sc.sets / 2);
    var mw = manualW(e), w = mw !== null ? mw : st.weight, r = resultBase(s, st, w);
    r.manual = mw !== null; r.inputMode = 'fixed'; r.sets = sets; r.reps = sc.reps; r.autoWeight = st.weight; r.nextWeight = st.weight; r.nextStage = sets + '×' + sc.reps;
    var done = e && (e.v === '完成' || e.v === 1 || e.v === '1');
    if (e && e.skip || !done) { r.judgment = '跳过'; return r; }
    r.input = '完成'; r.judgment = '完成'; r.volume = fix(w * sets * sc.reps);
    return r;
  }
  function cardioMinutes(s, st) {
    var m = st && st.stage ? parseInt(st.stage, 10) : NaN;
    if (isNaN(m) || m <= 0) m = (s && s.scheme && Number(s.scheme.minutes)) || 20;
    return Math.max(1, Math.round(m));
  }
  function cardioEvaluate(s, st, e) {
    var planned = cardioMinutes(s, st), r = resultBase(s, st, 0);
    r.inputMode = 'cardio'; r.sets = 1; r.reps = planned; r.autoWeight = 0;
    r.stage = planned + ' 分钟'; r.nextStage = r.stage; r.nextWeight = 0; r.weight = 0;
    if (e && e.skip) { r.judgment = '跳过'; return r; }
    var mins = e && e.v !== null && e.v !== undefined && e.v !== '' ? Number(e.v) : null;
    if (mins === null || isNaN(mins)) { r.judgment = '跳过'; return r; }
    mins = Math.max(0, Math.round(mins));
    r.input = mins; r.minutes = mins;
    r.judgment = mins >= planned ? '完成' : '未完成';
    return r;
  }
  function progShell(id, name, desc, evaluateFn, first) {
    return registerProgression({
      id: id, name: name, desc: desc,
      firstStage: function () { return first; },
      stageDef: function () { return { sets: 1, reps: 1, add: 1, hold: 1, next: null }; },
      initState: function (s) {
        var sc = s.scheme || {};
        var stage = id === 'dual' ? (sc.repMin + '–' + sc.repMax) : id === 'w531' ? '第1周' : (sc.sets || 1) + '×' + (sc.reps || 5);
        return { stage: stage, weight: s.init && s.init.type === 'fixed' ? Number(s.init.value) || 0 : 0, fail: 0, cycleMiss: 0 };
      },
      freshState: function (s, weight) {
        var st = PROGRESSIONS[id].initState(s);
        st.weight = weight;
        return st;
      },
      evaluate: evaluateFn,
      amrapLast: function () { return id === 'linear' || id === 'w531'; }
    });
  }
  registerProgression({
    id: 'cardio', name: '有氧', desc: '记实际分钟。达到计划分钟算完成，下次分钟不变，不记重量、不计容量。',
    firstStage: function (s) { return cardioMinutes(s, null) + ' 分钟'; },
    stageDef: function (tier, stage) { var m = parseInt(stage, 10); if (isNaN(m) || m <= 0) m = 20; return { sets: 1, reps: m, add: m, hold: 0, next: null }; },
    initState: function (s) { return { stage: cardioMinutes(s, null) + ' 分钟', weight: 0, fail: 0, cycleMiss: 0 }; },
    freshState: function (s) { return { stage: cardioMinutes(s, null) + ' 分钟', weight: 0, fail: 0, cycleMiss: 0 }; },
    evaluate: cardioEvaluate,
    amrapLast: function () { return false; }
  });
  progShell('dual', '双重进阶', '全部组到达次数上限后加重并回到下限；任一组低于下限 2 次则减轻。', dualEvaluate, '8–12');
  progShell('linear', '线性加重', '完成规定次数就加重。连续 3 次完不成，工作重量减 10%。', linearEvaluate, '5+');
  progShell('w531', '5/3/1', '按训练最大重量的四周百分比训练。规定组都完成才提高 TM；连续两轮没完成则 TM × 0.9。', waveEvaluate, '第1周');
  progShell('fixed', '固定组次', '重量由关联主项算出，本组不自动加重。', fixedEvaluate, '5×10');

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
      d.slots.forEach(function (s) { st[s.id] = progressionOf(db, s).initState(s, db.params); });
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
   *  4. 每个位置按候选池的顺序轮换：第二轮用下一个，第三轮再下一个，用完回到第一个。
   *     不与该位置上一轮重复；同一轮内每个动作只出现一次。不按「全局最久没用」来抢别的位置刚练过的动作。
   *  5. 候选池优先纳入「拉长位」动作（坐姿腿弯举 Maeo 2021、过头臂屈伸 Maeo 2023），其增肌效果有直接 MRI 证据。
   */
  var ROTATION = {
    A1_2: { role: '深蹲变式', why: '保持「蹲」模式，变换杠位与躯干角度，补强 T1 深蹲的薄弱环节', pool: ['前蹲', '泽奇深蹲', '箱式深蹲'] },
    A2_3: { role: '深蹲变式', why: '另一天再练一次蹲。顺序和 A1 错开，同一轮不会两个位置做同一个变式', pool: ['箱式深蹲', '腿举', '哈克深蹲', '泽奇深蹲'] },
    A1_3: { role: '垂直拉', why: '高位下拉是复合动作，三轮依次换握法，不进孤立组', pool: ['高位下拉', '对握高位下拉', '反握高位下拉'] },
    A2_2: { role: '卧推变式', why: '窄距、暂停、上斜和臂屈伸，分别补锁定段、触胸段和上胸', pool: ['窄距卧推', '暂停卧推', '上斜卧推', '上斜哑铃卧推', '负重双杠臂屈伸', '哑铃卧推'] },
    B1_2: { role: '垂直推', why: '支援站姿实力推；哑铃与杠铃交替改善左右力量平衡', pool: ['坐姿哑铃推肩', '杠铃推举', '阿诺德推举'] },
    B1_3: { role: '垂直拉', why: '引体向上是复合动作，作为垂直拉的变式放在 T2', pool: ['引体向上', '反握引体向上', '负重引体向上'] },
    B2_2: { role: '水平拉', why: '划船是复合动作，平衡卧推带来的推拉比例', pool: ['潘德雷划船', '杠铃划船', 'T杠划船', '坐姿划船', '单臂哑铃划船'] },
    B2_3: { role: '髋铰链', why: '硬拉的变式：腘绳肌、臀大肌、竖脊肌', pool: ['罗马尼亚硬拉', '赤字硬拉', '杠铃早安式', '臀推', '山羊挺身'] },
    A1_4: { role: '股四头', why: '单关节伸膝。第一轮双侧，第二轮单侧，之后交替', pool: ['坐姿腿屈伸', '单腿腿屈伸'] },
    B1_4: { role: '后束 / 肩袖', why: '平衡大量推类动作，维护肩关节', pool: ['面拉', '反向飞鸟'] },
    A1_5: { role: '腘绳肌', why: '屈膝孤立；坐姿（拉长位）增肌更优（Maeo 2021）', pool: ['俯卧腿弯举', '坐姿腿弯举'] },
    B1_5: { role: '三角肌中束', why: '哑铃与绳索交替：绳索在动作底部仍保持张力', pool: ['哑铃侧平举', '绳索侧平举'] },
    A2_4: { role: '肱二头', why: '改变握法与肩位：锤式练肱桡肌，上斜位拉长二头长头', pool: ['杠铃弯举', 'EZ杆弯举', '锤式弯举', '上斜哑铃弯举'] },
    B2_5: { role: '肱二头', why: '与 A2 的二头动作错开，每轮两种不同刺激', pool: ['哑铃弯举', '上斜哑铃弯举', '锤式弯举', 'EZ杆弯举'] },
    A2_5: { role: '肱三头', why: '过头位拉长三头长头，增肌优于下压（Maeo 2023）', pool: ['绳索三头屈伸', '过头绳索臂屈伸', '仰卧臂屈伸'] },
    B2_4: { role: '腘绳肌', why: '和 A1 的腿弯举错开，俯卧与坐姿交替', pool: ['坐姿腿弯举', '俯卧腿弯举'] }
  };
  var ROTATION_PRINCIPLES = [
    { t: 'T1、T2、T3 分层', d: 'T1 只放深蹲、卧推、硬拉、实力推。T2 放这些动作的变式，以及引体、下拉、划船这类复合动作。T3 只放单关节孤立，例如弯举、侧平举、面拉、腿弯举。' },
    { t: 'T1 四大项不轮换', d: '力量具有专项性（SAID 原则），深蹲、卧推、硬拉、实力推需要持续重复练习才能进步。' },
    { t: 'T2/T3 每轮换一次，一轮内固定', d: '系统综述显示：有计划的动作变化有利于肌肉均衡增长和最大力量，随意、过于频繁地换动作反而有害（Kassiano 等 2022，JSCR）。轮换动作组股四头肌四个头都增长、深蹲 1RM 提升最大（Fonseca 2014，JSCR）。' },
    { t: '同一位置只在同一动作模式内轮换', d: '每个位置都有固定的角色（如深蹲变式、垂直拉、腘绳肌），保证每周推、拉、蹲、髋铰链的比例不变。' },
    { t: '按顺序轮换，第二轮、第三轮照同一分层', d: '每个位置的候选就是它的轮换顺序：第二轮用下一个，第三轮再下一个，用完回到第一个。不和上一轮相同，也不和本轮其他位置重复。T2 始终是复合变式，T3 始终是孤立。' },
    { t: '优先纳入拉长位动作', d: '坐姿腿弯举比俯卧腿弯举、过头臂屈伸比下压有更多肌肉增长（Maeo 2021 MSSE；Maeo 2023 EJSS，MRI 测量）。' },
    { t: '新动作重新进阶', d: 'T2 从 3×10、T3 从 3×15+ 开始；起始重量取「按当前估算 1RM 推算」与「该动作上次重量 × 90%」中较大者。' }
  ];
  function rotationOn(P, s) { return P.autoRotate !== false && s.tier !== 'T1' && !s.noRotate; }
  /** 某个位置的候选池：预设池 + 同层级、同部位的自定义动作 */
  function rotationPool(db, s) {
    var def = ROTATION[s.id], pool = def ? def.pool.slice() : [];
    var first = libFindIn(db, pool[0] || s.name), part = first ? first.part : '';
    if (!def && part) libAll(db).forEach(function (x) { if (x.tier === s.tier && x.part === part && pool.indexOf(x.name) < 0) pool.push(x.name); });
    ((db && db.customLib) || []).forEach(function (x) {
      if (!part || x.part !== part || pool.indexOf(x.name) >= 0) return;
      if (!x.tier || x.tier === s.tier) pool.push(x.name);
    });
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
    var P = db.params, N = cycleLen(P), slots = rotationSlots(db), planned = [null], actual = [null];
    for (var k = 1; k <= upto; k++) {
      var start = cycleStartWeek(k, P), end = start + N - 1, pl = {}, act = {}, used = {}, prev = actual[k - 1];
      slots.forEach(function (s) {
        var name;
        if (k === 1 || !rotationOn(P, s)) {
          var c0 = latestChange(s, 1, k === 1 ? end : start - 1);
          name = c0 ? c0.name : s.name;
        } else {
          var pool = rotationPool(db, s), prevName = prev[s.id], at = pool.indexOf(prevName);
          name = prevName;
          for (var i = 1; i <= pool.length; i++) {
            var n = pool[at < 0 ? i - 1 : (at + i) % pool.length];
            if (!n || n === prevName || used[n]) continue;
            name = n;
            break;
          }
        }
        pl[s.id] = name;
        var inCyc = latestChange(s, k === 1 ? 1 : start, end);
        act[s.id] = inCyc ? inCyc.name : name;
        used[act[s.id]] = 1;
      });
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
    var slot = Object.assign({}, s, { name: ch.name, equip: ch.equip || (lib ? lib.equip : '') });
    if (ch.tier) slot.tier = ch.tier;
    if (ch.step) slot.step = ch.step;
    return { slot: slot, change: ch, resetNow: ch.fromWeek === week, auto: !!ch.auto };
  }
  /**
   * 某训练日第 week 次开练时的起始状态：
   *  1. 这一次刚换入新动作 → 从该动作的第一阶段、起始重量重新进阶；
   *  2. 用户在计划页「调整重量」→ 只替换重量，阶段与失败次数保持不变（不改写任何历史记录）。
   */
  function startState(s, st, ef, week, prog) {
    prog = prog || PROGRESSIONS.gzclp;
    var out = ef.resetNow ? prog.freshState(ef.slot, ef.change.weight) : st;
    var adj = null;
    (s.adjusts || []).forEach(function (a) { if (a.fromWeek === week) adj = a; });
    if (adj) out = Object.assign({}, out, { weight: adj.weight });
    return out;
  }
  /** 执行一个槽位：处理“更换起始周重置”、“调整重量”和“仅本次替换” */
  function runSlot(db, s, st, e, week, deload, hist, snapW) {
    var ef = effectiveSlot(db, s, week, hist), prog = progressionOf(db, ef.slot);
    var link = ef.slot.scheme && ef.slot.scheme.link;
    if (link && snapW && snapW[link] != null) {
      var sc0 = ef.slot.scheme;
      st = Object.assign({}, st, { weight: ceilTo(snapW[link] * (sc0.pct || 0.5), sc0.inc || 2.5) });
    }
    st = startState(s, st, ef, week, prog);
    var res;
    // 换上的动作是有氧时按分钟记：原生有氧槽位用自己的计划分钟，临时或永久换入的默认 20 分钟
    function evalSlot(slot, state, entry) {
      var lb = libFindIn(db, slot.name);
      if (lb && lb.equip === '有氧') {
        var mins = slot.prog === 'cardio' ? cardioMinutes(slot, state) : ((slot.scheme && Number(slot.scheme.minutes)) || 20);
        var cslot = Object.assign({}, slot, { prog: 'cardio', scheme: Object.assign({}, slot.scheme || {}, { minutes: mins }) });
        return PROGRESSIONS.cardio.evaluate(cslot, { stage: mins + ' 分钟', weight: 0, fail: state.fail || 0 }, entry, db.params, deload, week);
      }
      return prog.evaluate(slot, state, entry, db.params, deload, week);
    }
    if (e && e.ex && e.ex !== ef.slot.name) {
      var lib = libFindIn(db, e.ex);
      res = evalSlot(Object.assign({}, ef.slot, { name: e.ex, equip: lib ? lib.equip : '' }), st, e);
      // 仅本次替换：记录容量，但不推进原动作的阶段与重量
      if (!res.deload && res.judgment !== '跳过') { res.judgment = '替换'; res.e1rm = null; }
      res.nextStage = st.stage; res.nextWeight = st.weight; res.nextFail = st.fail || 0; res.delta = 0;
      res.sub = true; res.origName = ef.slot.name;
    } else {
      res = evalSlot(ef.slot, st, e);
    }
    res.changed = !!ef.change;
    return { res: res, st: st, eff: ef, prog: prog };
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
    var pid = activePid(db), recs = sortRecords((db.records || []).filter(function (r) { return recPid(r) === pid; })), before = null;
    for (var i = 0; i < recs.length; i++) {
      var rec = recs[i];
      if (opts.untilId && rec.id === opts.untilId) {
        before = { states: JSON.parse(JSON.stringify(states)), week: counts[rec.day] + 1, hist: JSON.parse(JSON.stringify(hist)) };
        continue;
      }
      var day = dayById(db, rec.day);
      if (!day) continue;
      counts[rec.day] += 1;
      var week = counts[rec.day], items = [], vol = { T1: 0, T2: 0, T3: 0 }, snapW = {};
      Object.keys(states).forEach(function (id) { snapW[id] = states[id] && states[id].weight; });
      day.slots.forEach(function (s) {
        var res = runSlot(db, s, states[s.id], rec.entries ? rec.entries[s.id] : null, week, rec.deload, hist, snapW).res;
        items.push(res);
        vol[s.tier] += res.volume;
        states[s.id] = { stage: res.nextStage, weight: res.nextWeight, fail: res.nextFail || 0, cycleMiss: res.nextCycleMiss || 0 };
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
        return { tier: it.tier, badge: it.badge, tierColor: TIER_COLORS[it.tier], name: it.name, stage: it.stage, sub: !!it.sub, origName: it.origName || '', isCardio: it.inputMode === 'cardio',
          w: it.inputMode === 'cardio' ? '' : fmtW(it.deload ? it.dWeight : it.weight), manual: !!it.manual && !it.sub, planned: fmtW(it.planned), input: it.input === null ? '—' : it.input,
          j: it.judgment, color: JUDGE_COLORS[it.judgment] || '#6C6C70', next: it.deload || it.judgment === '跳过' ? '' : it.sub ? '替代 ' + it.origName + '，不影响进阶' : it.inputMode === 'cardio' ? '下次 ' + it.nextStage : '下次 ' + fmtW(it.barNext != null ? it.barNext : it.nextWeight) + ' kg · ' + it.nextStage };
      }) };
  }

  // ---------- 视图模型：训练页 ----------
  function blankDraft(db, dayId) {
    var d = dayById(db, dayId), entries = {};
    d.slots.forEach(function (s) { entries[s.id] = { v: null, done: 0 }; });
    return entries;
  }

  function buildTrain(db, opts) {
    opts = opts || {};
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
    var deloadSuggest = progressionOf(db).id === 'gzclp' && isDeloadWeek(week, P);
    var deload = opts.deload === undefined ? deloadSuggest : !!opts.deload;
    var draft = opts.draft || blankDraft(db, dayId);
    var filled = 0, total = 0, lastW = lastWeights(full);
    var items = day.slots.map(function (s0) {
      var e = draft[s0.id] || (draft[s0.id] = { v: null, done: 0 });
      // 仅本次替换：起始重量默认取该动作上次做过的重量，没有则沿用原计划重量
      var subDefault = null;
      if (e.ex) {
        var ef0 = effectiveSlot(db, s0, week, hist), st0 = startState(s0, states[s0.id], ef0, week, progressionOf(db));
        if (e.ex === ef0.slot.name) { delete e.ex; }
        else {
          subDefault = lastW[e.ex] !== undefined ? lastW[e.ex] : st0.weight;
          if (manualW(e) === null) e.w = subDefault;
        }
      }
      var snapW = {};
      Object.keys(states).forEach(function (id) { snapW[id] = states[id] && states[id].weight; });
      var run = runSlot(db, s0, states[s0.id], e, week, deload, hist, snapW), res = run.res, st = run.st, s = run.eff.slot;
      var def = res.loads && res.loads.length ? { sets: res.loads.length, reps: res.loads[res.loads.length - 1].reps } : (res.inputMode ? { sets: res.sets, reps: res.reps } : run.prog.stageDef(s.tier, st.stage));
      var showW = deload && res.dWeight != null && !res.loads ? res.dWeight : res.weight;
      if (res.sub && !deload) showW = res.weight;
      var showSets = deload ? res.dSets : def.sets;
      var doneLog = logged(s0, e);
      total += 1; if (doneLog || e.skip) filled += 1;
      var dots = [];
      for (var k = 0; k < showSets; k++) dots.push({ i: k, on: k < (e.done || 0), amrap: !deload && run.prog.amrapLast(s.tier) && k === showSets - 1 });
      return {
        slotId: s.id, tier: s.tier, badge: slotBadge(s), tierColor: TIER_COLORS[s.tier], name: res.name, equip: equipOf(res.name, res.equip), equipNote: EQUIP_NOTE[equipOf(res.name, res.equip)] || '',
        unitText: unitOf(equipOf(res.name, res.equip)), isBW: equipOf(res.name, res.equip) === '自重',
        planName: s.name, sub: !!res.sub, changed: !!run.eff.change, changeNew: !!run.eff.resetNow,
        autoNew: !!(run.eff.auto && run.eff.resetNow), autoPrev: run.eff.auto && run.eff.change ? run.eff.change.prev : '',
        stage: st.stage, sets: showSets, reps: def.reps, weight: showW, isCardio: res.inputMode === 'cardio',
        weightText: res.inputMode === 'cardio' ? String(def.reps) : equipOf(res.name, res.equip) === '自重' ? '自重' : fmtW(showW),
        canAdjust: equipOf(res.name, res.equip) !== '自重' && res.inputMode !== 'wave' && res.inputMode !== 'cardio',
        plates: platesFor(showW, P, equipOf(res.name, res.equip)), fail: res.sub ? 0 : (st.fail || 0),
        restText: fmtRest(REST[s.tier]),
        manual: res.sub ? manualW(e) !== subDefault : res.manual, autoWeight: res.sub ? subDefault : res.autoWeight, autoText: fmtW(res.sub ? subDefault : res.autoWeight), wStep: incOf(Object.assign({}, s, { name: res.name, equip: equipOf(res.name, res.equip) }), P) || 1, editW: !!e.editW,
        repsText: res.inputMode === 'cardio' ? (def.reps + ' 分钟') : res.inputMode === 'sets' && s.scheme ? (res.sets + '×' + s.scheme.repMin + '–' + s.scheme.repMax) : (res.loads ? res.loads.map(function (ld) { return (ld.pct ? Math.round(ld.pct * 100) + '%×' : '') + ld.reps + (ld.amrap ? '+' : ''); }).join(' · ') : showSets + '×' + def.reps + (res.inputMode === 'linear' || (s.tier !== 'T2' && !deload && !res.inputMode) ? '+' : '')),
        inputType: res.inputMode || (deload ? 'deload' : s.tier === 'T2' ? 'done' : 'amrap'),
        loads: res.loads || null,
        scheme: s.scheme || null,
        amrapHint: res.inputMode === 'cardio' ? ('填实际分钟，达到 ' + def.reps + ' 分钟算完成') : res.inputMode === 'sets' && s.scheme ? ('全部做到 ' + s.scheme.repMax + ' 次加重，有一组 ≤ ' + (s.scheme.repMin - 2) + ' 次减轻') : res.inputMode === 'linear' && s.scheme ? ('末组至少 ' + s.scheme.reps + ' 次加重，连续 3 次失败减 10%') : res.inputMode === 'wave' ? '规定次数没完成，这一轮不加训练最大重量' : res.inputMode === 'fixed' ? '重量固定为训练最大重量的 50%，不自动加重' : (s.tier === 'T1' ? ('≥' + def.add + ' 加重' + (def.next ? ' · <' + def.hold + ' 预警' : ' · <' + def.add + ' 重置')) : s.tier === 'T3' ? ('≥' + P.t3Threshold + (equipOf(res.name, res.equip) === '自重' ? ' 建议切换负重版' : ' 加重')) : ''),
        amrapTarget: res.inputMode === 'cardio' ? def.reps : deload ? null : s.tier === 'T1' ? def.add : s.tier === 'T3' ? P.t3Threshold : null,
        value: e.v, setsIn: e.sets || null, miss: !!e.miss, logged: doneLog, reps2: e.reps, skip: !!e.skip, new5RM: e.new5RM || '', done: e.done || 0, dots: dots,
        need5RM: s.tier === 'T1' && P.ruleMode !== 'excel' && st.stage === '10×1+',
        rest: REST[s.tier],
        preview: (doneLog || (deload && !s0.prog)) ? {
          judgment: res.judgment, color: JUDGE_COLORS[res.judgment] || '#6C6C70', icon: JUDGE_ICON[res.judgment] || '',
          nextStage: res.nextStage, nextWeight: fmtW(res.barNext != null ? res.barNext : res.nextWeight), stageChanged: res.nextStage !== st.stage,
          delta: res.delta > 0 ? '+' + fmtW(res.delta) : res.delta < 0 ? fmtW(res.delta) : '±0', boost: !!res.boost, adaptNote: res.adaptNote || '',
          e1rm: res.e1rm ? fmtW(Math.round(res.e1rm * 10) / 10) : '', volume: Math.round(res.volume), sub: !!res.sub, origName: res.origName || ''
        } : null
      };
    });
    var cyc = cycleOf(week, P);
    var curProg = progressionOf(db);
    var deloadTip = '';
    if (deload) {
      if (curProg.id === 'gzclp') deloadTip = 'T1 −50% · T2 −40% · T3 少 1 组';
      else if (curProg.id === 'w531') deloadTip = '第 4 周减载 · 40% / 50% / 60% 恢复周';
      else deloadTip = '减载周 · 降低工作负荷，促进身体恢复';
    }
    return {
      progression: curProg.id, progressionName: curProg.name,
      day: dayId, dayName: day.name, week: week, totalWeeks: P.totalWeeks, recommended: rec.day,
      cycle: cyc.cycle, weekInCycle: cyc.wc, weeksPerCycle: cyc.N, weekText: weekText(week, P),
      deload: deload, deloadSuggest: deloadSuggest, deloadTip: deloadTip, items: items, filled: filled, total: total,
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
    var maxCycle = Math.max(curCycle, dataCycle) + 2; // 向后可看第二轮、第三轮
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
            w: fmtW(it.deload ? it.dWeight : it.weight), j: it.judgment, color: JUDGE_COLORS[it.judgment] || '#6C6C70', deload: !!s.rec.deload };
        }
        var cnt = rp.counts[d.id] || 0, ahead = w - cnt - 1; // 0 = 下一次
        var st = rp.states[t1.id], proj;
        if (t1.prog === 'w531') {
          var waveN = ((w - 1) % 4) + 1, pctW = { 1: 0.85, 2: 0.9, 3: 0.95, 4: 0.6 }[waveN];
          var tmW = st.weight + (t1.scheme.step || 0) * Math.max(0, Math.floor((w - 1) / 4) - Math.floor(cnt / 4));
          proj = ceilTo(tmW * pctW, (t1.scheme && t1.scheme.inc) || 2.5);
        } else if (t1.prog === 'linear') {
          proj = st.weight + (t1.scheme.step || 0) * Math.max(0, w - cnt - 1);
        } else if (t1.prog) {
          proj = st.weight;
        } else {
          // 理想推演：每次正常训练都加重；减载周不推进
          var adds = 0;
          for (var k = cnt + 1; k < w; k++) if (!isDeloadWeek(k, P)) adds++;
          proj = st.weight + (P.steps[t1.step] || 0) * adds;
          if (isDeloadWeek(w, P)) proj = roundTo(proj * 0.5, P.rounding);
        }
        return { day: d.id, week: w, status: (d.id === rec.day && ahead === 0) ? 'next' : (ahead === 0 && w === rec.week ? 'ready' : 'todo'),
          w: fmtW(fix(proj)), j: ahead === 0 ? '计划' : '理想', color: '#6C6C70', deload: isDeloadWeek(w, P) };
      });
      rows.push({ week: w, wc: i + 1, deload: isDeloadWeek(w, P), cells: cells });
    }
    var overview = db.days.map(function (d) {
      var nw = (rp.counts[d.id] || 0) + 1;
      return { day: d.id, name: d.name, slots: d.slots.map(function (s0) {
        var ef = effectiveSlot(db, s0, nw, rp.hist), s = ef.slot;
        var st = startState(s0, rp.states[s0.id], ef, nw, progressionOf(db)), last = null;
        for (var i = rp.sessions.length - 1; i >= 0; i--) {
          if (rp.sessions[i].rec.day === d.id) {
            var f = rp.sessions[i].items.filter(function (x) { return x.slotId === s.id; })[0];
            if (f && f.judgment !== '跳过' && !f.sub && f.name === s.name) { last = f; break; }
          }
        }
        var start = ef.change ? ef.change.weight : initWeight(s, P);
        var showW = st.weight;
        if (s.prog === 'w531') {
          var wkOv = ((nw - 1) % 4) + 1, pctOv = { 1: 0.85, 2: 0.9, 3: 0.95, 4: 0.6 }[wkOv];
          showW = ceilTo(st.weight * pctOv, (s.scheme && s.scheme.inc) || 2.5);
        } else if (s.scheme && s.scheme.link && rp.states[s.scheme.link]) {
          showW = ceilTo(rp.states[s.scheme.link].weight * (s.scheme.pct || 0.5), (s.scheme && s.scheme.inc) || 2.5);
        }
        return { id: s.id, changed: !!ef.change, tier: s.tier, badge: slotBadge(s), tierColor: TIER_COLORS[s.tier], name: s.name, stage: st.stage, isCardio: s.prog === 'cardio', weight: s.prog === 'cardio' ? st.stage : fmtW(showW),
          gain: s.prog !== 'cardio' && st.weight - start > 0 ? '+' + fmtW(fix(st.weight - start)) : '', fail: st.fail,
          last: last ? last.judgment : '—', lastColor: last ? JUDGE_COLORS[last.judgment] : '#C7C7CC' };
      }) };
    });
    var done = rp.sessions.length, nd = db.days.length;
    // 本轮进度：始终统计「当前进行中那一轮」的训练次数（不随浏览的轮次变化）
    var curBase = cycleStartWeek(curCycle, P);
    var cycDone = rp.sessions.filter(function (s) { return s.week >= curBase && s.week < curBase + N; }).length;
    var cycPlanned = N * nd;
    var recCyc = cycleOf(rec.week, P);
    var curProg = progressionOf(db);
    var rot = buildRotation(db, cycle, rp);
    return { progression: curProg.id, progressionName: curProg.name, mainLabel: tierLabel(curProg.id, 'T1'), assistLabel: tierLabel(curProg.id, 'T2'), rotation: rot, rows: rows, overview: overview, days: db.days.map(function (d) { return { id: d.id, name: d.name }; }),
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
    var curProg = progressionOf(db);
    var isGZ = curProg.id === 'gzclp';
    var plan = isGZ ? planCycles(db, cycle) : null;
    var act = plan ? plan.actual[cycle] : null;
    var prev = (plan && cycle > 1) ? plan.actual[cycle - 1] : null;
    var changed = 0;
    var isCur = cycle === cur;
    var days = db.days.map(function (d) {
      var items = {};
      if (isCur) buildTrain(db, { day: d.id }).items.forEach(function (it) { items[it.slotId] = it; });
      return { id: d.id, name: d.name, slots: d.slots.map(function (s) {
        var it0 = items[s.id];
        var ef = effectiveSlot(db, s, isGZ ? cycleStartWeek(cycle, P) : 1, rp.hist);
        var name = it0 ? it0.name : (act && act[s.id] ? act[s.id] : ef.slot.name);
        var eq = equipOf(name, s.equip);
        var def = isGZ ? ROTATION[s.id] : null;
        var b = slotBadge(s, curProg.id);
        var role = isGZ ? (s.tier === 'T1' ? 'T1 · 四大项不轮换' : (def ? def.role : s.tier)) : (b + ' · ' + (s.prog === 'cardio' ? '有氧' : s.prog === 'linear' ? '线性加重' : s.prog === 'w531' ? '5/3/1波浪' : s.prog === 'fixed' ? 'BBB固定' : '双重进阶'));
        var pv = prev ? prev[s.id] : '';
        var isNew = isGZ && !!prev && name !== pv;
        if (isNew) changed++;
        return {
          id: s.id, tier: s.tier, badge: b, name: name, equip: eq, prev: pv, isNew: isNew,
          locked: isGZ ? !rotationOn(P, s) : false, fixed: isGZ && s.tier === 'T1',
          role: role, why: def ? def.why : '', startW: '',
          cur: it0 ? (it0.canAdjust ? it0.weightText + ' ' + it0.unitText : (s.prog === 'cardio' ? it0.weightText + ' 分钟' : '自重')) + ' · ' + it0.repsText : ''
        };
      }) };
    });
    return {
      cycle: cycle, curCycle: cur, enabled: isGZ && P.autoRotate !== false, changed: changed, total: isGZ ? rotationSlots(db).length : 0,
      isFuture: cycle > cur, isCur: isCur, days: days, principles: isGZ ? ROTATION_PRINCIPLES : []
    };
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
          if (s2.rec.day === d.id) { var it = s2.items[si]; if (!it.sub && it.judgment !== '跳过' && it.inputMode !== 'cardio') arr[s2.week - 1] = it.weight; }
        });
        var cnt = rp.counts[d.id] || 0, ef = effectiveSlot(db, s, cnt + 1, rp.hist);
        if (cnt < arr.length && s.prog !== 'cardio') arr[cnt] = startState(s, rp.states[s.id], ef, cnt + 1, progressionOf(db)).weight; // 下一次计划重量
        return { name: ef.slot.name, tier: s.tier, badge: slotBadge(ef.slot.prog ? ef.slot : s), data: arr };
      });
      return { day: d.id, name: d.name, cols: cols, nextIdx: rp.counts[d.id] || 0 };
    });

    // 体重
    var bw = S.filter(function (s) { return s.rec.bw; }).map(function (s) { return { date: s.rec.date, v: Number(s.rec.bw) }; });

    // 个人纪录
    // 个人纪录：按实际做过的动作统计（含替换、更换后的动作）
    var prMap = {}, prs = [];
    S.forEach(function (s2) { s2.items.forEach(function (it) {
      if (it.deload || it.judgment === '跳过' || it.inputMode === 'cardio' || !(it.weight > 0)) return;
      var cur = prMap[it.name];
      if (!cur || it.weight > cur.weight) prMap[it.name] = { weight: it.weight, tier: it.tier, badge: it.badge, day: s2.rec.day, date: s2.rec.date };
    }); });
    Object.keys(prMap).forEach(function (n) { var x = prMap[n]; prs.push({ day: x.day, tier: x.tier, badge: x.badge, tierColor: TIER_COLORS[x.tier], name: n, w: fmtW(x.weight), wn: x.weight, date: x.date.slice(5) }); });
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
      volume: { labels: labels, stacks: (function () {
        var pid = progressionOf(db).id;
        var volName = function (tier) {
          if (pid === 'w531' && tier === 'T2') return tierLabel('fixed', tier);
          if (pid === 'w531' && tier === 'T3') return tierLabel('dual', tier);
          return tierLabel(pid, tier);
        };
        return [
          { name: volName('T1'), color: TIER_COLORS.T1, data: v1 },
          { name: volName('T2'), color: TIER_COLORS.T2, data: v2 },
          { name: volName('T3'), color: TIER_COLORS.T3, data: v3 }];
      })() },
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

    // 主项进度表：每个 T1 主项一行（起始 → 下次、最近末组、当前阶段、最佳 e1RM）
    var liftTable = [], lifts0 = liftSlots(db);
    Object.keys(lifts0).forEach(function (key) {
      var info = lifts0[key], hist = [];
      S.forEach(function (s) { s.items.forEach(function (it) { if (it.slotId === info.slot.id && it.judgment !== '跳过' && !it.deload && !it.sub && it.name === info.name) hist.push(it); }); });
      var st0 = rp.states[info.slot.id], start = hist.length ? hist[0].weight : initWeight(info.slot, P), last = hist[hist.length - 1];
      var best = null; hist.forEach(function (it) { if (it.e1rm && (!best || it.e1rm > best)) best = it.e1rm; });
      var gain = fix(st0.weight - start);
      liftTable.push({ key: key, name: info.name, day: info.day.id, stage: st0.stage, n: hist.length,
        start: fmtW(start), next: fmtW(st0.weight), gain: gain > 0 ? '+' + fmtW(gain) : gain < 0 ? fmtW(gain) : '±0', up: gain > 0,
        last: last ? String(last.input) : '—', lastJ: last ? last.judgment : '', lastColor: last ? JUDGE_COLORS[last.judgment] || '#6C6C70' : '#AEAEB2',
        best: best ? fmtW(Math.round(best * 10) / 10) : '—', fail: st0.fail || 0 });
    });

    // 总结洞察（教练口吻）
    var insights = [];
    var k = stats.kpi;
    var curProg = progressionOf(db);
    var isGZ = curProg.id === 'gzclp';
    var firstDayName = (db.days[0] && db.days[0].name) || '第一次';
    if (!S.length) insights.push({ type: 'info', text: '还没有训练记录。去「训练」页完成' + firstDayName + '，数据会自动长出来。' });
    else {
      insights.push({ type: 'info', text: '已完成 ' + k.sessions + '/' + k.planned + ' 次训练（' + k.progress + '%），累计容量 ' + k.volume + '，共 ' + k.adds + ' 次加重。' + (k.warns ? '' : '目前没有预警，节奏正常。') });
      var lifts = liftSlots(db);
      Object.keys(lifts).forEach(function (key) {
        var info = lifts[key], hist = [];
        S.forEach(function (s) { s.items.forEach(function (it) { if (it.slotId === info.slot.id && it.judgment !== '跳过' && !it.deload && !it.sub && it.name === info.name) hist.push(it); }); });
        if (!hist.length) return;
        var first = hist[0], lastIt = hist[hist.length - 1], streak = 0;
        for (var i = hist.length - 1; i >= 0 && hist[i].judgment === '加重'; i--) streak++;
        var gain = fix(lastIt.nextWeight - first.weight);
        if (streak >= 2) insights.push({ type: 'up', text: info.name + ' 连续 ' + streak + ' 次加重，' + fmtW(first.weight) + '→' + fmtW(lastIt.nextWeight) + 'kg，节奏在线。' });
        // 单次加重已在「主项进度」表里展示，这里不再重复
        if (lastIt.judgment === '建议降阶') {
          var hold = isGZ ? curProg.stageDef('T1', lastIt.stage).hold : 3;
          insights.push({ type: 'warn', text: info.name + ' 末组没到 ' + hold + ' 次。下次同重量再冲，先睡好吃好。' });
        }
        if (lastIt.judgment === '降阶') {
          insights.push({ type: 'warn', text: info.name + ' 已切到 ' + lastIt.nextStage + '，重量保持 ' + fmtW(lastIt.nextWeight) + 'kg，用更少次数顶住强度。' });
        }
        if (lastIt.judgment === '重置') {
          insights.push({ type: 'warn', text: isGZ ? (info.name + ' 完成一轮三阶，已重置回 5×3+ @ ' + fmtW(lastIt.nextWeight) + 'kg。') : (info.name + ' 进入新一轮周期，重量重置为 ' + fmtW(lastIt.nextWeight) + 'kg。') });
        }
      });
      // 辅助退阶 / 阈值（仅 GZCLP 适用）
      if (isGZ) {
        var lastBySlot = {};
        S.forEach(function (s) { s.items.forEach(function (it) { if (it.judgment !== '跳过' && !it.deload && !it.sub) lastBySlot[it.slotId] = it; }); });
        Object.keys(lastBySlot).forEach(function (id) {
          var it = lastBySlot[id], dn = id.split('_')[0] + ' ';
          if (it.tier === 'T2' && it.judgment === '退阶') insights.push({ type: 'warn', text: dn + it.name + ' 没吃下 ' + it.stage + '，下次降到 ' + it.nextStage + '，重量不变。' });
          if (it.tier === 'T3' && it.judgment === '保持' && Number(it.input) >= P.t3Threshold - 4) insights.push({ type: 'tip', text: dn + it.name + ' 末组 ' + it.input + ' 次，距离 ' + P.t3Threshold + ' 次加重只差 ' + (P.t3Threshold - it.input) + ' 次，下次冲一把。' });
        });
      }
      stats.e1rm.forEach(function (e) {
        if (e.n >= 2 && e.slope !== '—') insights.push({ type: 'trend', text: e.name + ' e1RM 回归斜率 ' + e.slope + ' kg/周，按此趋势第 ' + P.totalWeeks + ' 周约 ' + e.predict + 'kg' + (e.n < 4 ? '（样本少，参考）' : '') + '。' });
      });
      if (weekCards.length >= 2) {
        var lw = weekCards[weekCards.length - 1];
        if (lw.dv) insights.push({ type: lw.dvUp ? 'up' : 'tip', text: '第 ' + lw.week + ' 周容量 ' + lw.volText + '，环比 ' + lw.dv + '。' });
      }
      var rec = recommend(db, rp);
      if (isDeloadWeek(rec.week, P)) {
        var dTip = isGZ ? '下一周是第 ' + rec.week + ' 周减载周：T1 −50%、T2 −40%、T3 少 1 组，不影响进阶链。' : curProg.id === 'w531' ? '下一周是第 4 周减载周（40%/50%/60%），促进恢复蓄力。' : '下一周是减载周，降低负荷与容量，促进充分恢复。';
        insights.push({ type: 'tip', text: dTip });
      }
    }

    var logs = S.slice().reverse().map(logView);
    insights.forEach(function (i) { i.icon = INS_ICON[i.type] || 'i'; });
    var pRules = progressionRules(curProg.id);
    return {
      progression: curProg.id, rules: pRules.rules, generalRules: pRules.general, ruleTitle: pRules.name, ruleSummary: pRules.summary,
      insights: insights, liftTable: liftTable, weeks: weekCards.reverse(), logs: logs, kpi: k
    };
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
    if (progressionOf(db, s).id === 'gzclp' && s.tier === 'T1' && (!lib || ['杠铃深蹲', '传统硬拉', '平板卧推', '站姿实力推'].indexOf(name) < 0)) return { error: '主项只在深蹲、卧推、硬拉、实力推之间更换' };
    var rp = replay(db), fromWeek = (rp.counts[dayId] || 0) + 1;
    var w = weight === null || weight === undefined || weight === '' || isNaN(Number(weight)) ? null : fix(Number(weight));
    s.changes = (s.changes || []).filter(function (c) { return c.fromWeek < fromWeek; });
    s.adjusts = (s.adjusts || []).filter(function (a) { return a.fromWeek < fromWeek; });
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
  /**
   * 调整某个位置的当前重量：从这个训练日的下一次训练起生效（本周还没练就是本周）。
   * 只改重量，不重置阶段，也不改动任何历史记录；之后照常按规则加重。
   */
  function adjustSlot(db, dayId, slotId, weight) {
    var d = dayById(db, dayId), s = null;
    d.slots.forEach(function (x) { if (x.id === slotId) s = x; });
    var w = Number(weight);
    if (!s || isNaN(w) || w < 0) return { error: '重量不正确' };
    var fromWeek = (replay(db).counts[dayId] || 0) + 1;
    s.adjusts = (s.adjusts || []).filter(function (a) { return a.fromWeek !== fromWeek; });
    s.adjusts.push({ fromWeek: fromWeek, weight: fix(w) });
    return { fromWeek: fromWeek };
  }
  /** 锁定 / 解锁某个位置的自动轮换 */
  function setNoRotate(db, dayId, slotId, v) {
    var d = dayById(db, dayId), s = null;
    d.slots.forEach(function (x) { if (x.id === slotId) s = x; });
    if (!s) return null;
    if (v) s.noRotate = true; else delete s.noRotate;
    return s;
  }
  /** 计划页动作面板：一个位置此刻的完整状态（与训练卡完全一致） */
  function slotInfo(db, dayId, slotId, rp) {
    rp = rp || replay(db);
    var P = db.params, d = dayById(db, dayId), s = null;
    d.slots.forEach(function (x) { if (x.id === slotId) s = x; });
    if (!s) return null;
    var vm = buildTrain(db, { day: dayId }), it = vm.items.filter(function (x) { return x.slotId === slotId; })[0];
    var fromWeek = (rp.counts[dayId] || 0) + 1, roundWeek = roundInfo(db, rp).week;
    var cyc = cycleOf(fromWeek, P).cycle, plan = planCycles(db, cyc + 1), cat = slotCategory(db, s, it.name);
    return { dayId: dayId, dayName: d.name, slotId: slotId, tier: s.tier, name: it.name, equip: it.equip, unitText: it.unitText,
      weight: it.weight, weightText: it.weightText, repsText: it.repsText, stage: it.stage, canAdjust: it.canAdjust, wStep: it.wStep,
      role: cat.label, why: cat.hint, category: cat,
      rotTier: progressionOf(db, s).id === 'gzclp' && s.tier !== 'T1', autoRotate: P.autoRotate !== false, locked: !!s.noRotate,
      nextCycle: cyc + 1, nextName: s.tier === 'T1' ? '' : plan.actual[cyc + 1][s.id],
      fromWeek: fromWeek, when: fromWeek === roundWeek ? '本周' : '下周', weekText: weekText(fromWeek, P),
      adjusted: (s.adjusts || []).some(function (a) { return a.fromWeek === fromWeek; }) };
  }
  /** 这个槽位在当前计划里的分类。动作库本身不再使用 T1/T2/T3。 */
  function slotCategory(db, slot, name) {
    var prog = progressionOf(db, slot), ex = libFindIn(db, name || slot.name), part = ex ? ex.part : '';
    var rot = ROTATION[slot.id];
    if (prog.id === 'gzclp') {
      if (slot.tier === 'T1') return { key: 'main', label: 'T1', hint: '只在深蹲、卧推、硬拉、实力推之间换。', names: ['杠铃深蹲', '传统硬拉', '平板卧推', '站姿实力推'], part: part, locked: true };
      if (rot) {
        var head = libFindIn(db, rot.pool[0]);
        return { key: slot.id, label: rot.role, hint: rot.why, names: rot.pool.slice(), part: head ? head.part : part, locked: false };
      }
      return { key: roleOf(slot.tier), label: slot.tier || '动作', hint: '', names: null, part: part, locked: false };
    }
    if (prog.id === 'cardio') return { key: 'cardio', label: '有氧', hint: '只记分钟，不记重量。', names: null, part: part, locked: false };
    var label = tierLabel(prog.id, slot.tier);
    var hint = prog.id === 'fixed' ? '同一主动作的固定容量。' : prog.id === 'w531' ? '百分比波浪的主项。' : prog.id === 'linear' ? '完成规定次数就加重。' : '全部做到区间上限才加重。';
    return { key: prog.id + ':' + label, label: label, hint: hint, names: (prog.id === 'fixed' || prog.id === 'w531') ? [name || slot.name] : null, part: part, locked: false };
  }
  function libRow(db, x, cur, tierHint) {
    var rc = recommendWeight(db, x.name, tierHint || x.tier || 'T3', { preferLast: false });
    var pat = patternOfPart(x.part);
    return { name: x.name, tier: x.tier || '', pattern: pat.id, patternLabel: pat.label, part: x.part, equip: x.equip, desc: x.desc, custom: !!x.custom, current: x.name === cur,
      last: '', rec: rc.text, recUnit: rc.unit, recNote: rc.note, isBW: x.equip === '自重' };
  }
  function matchQuery(x, q) {
    if (!q) return true;
    return x.name.indexOf(q) >= 0 || (x.part || '').indexOf(q) >= 0 || (x.equip || '').indexOf(q) >= 0 || patternOfPart(x.part).label.indexOf(q) >= 0 || (x.desc || '').indexOf(q) >= 0;
  }
  function inPlanCategory(x, cat, fit) {
    if (!cat) return true;
    if (cat.locked) return (cat.names || []).indexOf(x.name) >= 0;
    if (fit === 'all') return true;
    if (fit === 'part') return !!cat.part && x.part === cat.part;
    if (cat.names && cat.names.indexOf(x.name) >= 0) return true;
    if (x.custom && cat.part && x.part === cat.part) return true;
    return !cat.names && !!cat.part && x.part === cat.part;
  }
  /** 动作库列表。传 tier 时保持旧的 T1/T2/T3 切页（小程序）；网页动作库用 catalog，计划内更换用 category。 */
  function buildLibrary(db, opts) {
    opts = opts || {};
    var q = String(opts.q || '').trim(), cur = opts.current || '', lastW = lastWeights(replay(db));
    if (!opts.catalog && !opts.category) {
      var tier = opts.tier || 'T1';
      var counts = { T1: 0, T2: 0, T3: 0 };
      var allTier = libAll(db);
      allTier.forEach(function (x) { if (x.tier) counts[x.tier] = (counts[x.tier] || 0) + 1; });
      var list0 = allTier.filter(function (x) {
        if (tier === 'C') {
          if (x.equip !== '有氧') return false;
          return !q || x.name.indexOf(q) >= 0 || (x.part || '').indexOf(q) >= 0 || (x.equip || '').indexOf(q) >= 0;
        }
        if (tier === 'T1' && x.tier !== 'T1') return false;
        if (q) return x.name.indexOf(q) >= 0 || (x.part || '').indexOf(q) >= 0 || (x.equip || '').indexOf(q) >= 0;
        return x.tier === tier;
      }).map(function (x) {
        var row = libRow(db, x, cur, x.tier);
        row.last = lastW[x.name] !== undefined ? fmtW(lastW[x.name]) : '';
        return row;
      });
      var eqCount = {}; EQUIPS.forEach(function (e) { eqCount[e] = 0; });
      allTier.filter(function (x) { return tier === 'C' ? x.equip === '有氧' : x.tier === tier; }).forEach(function (x) { eqCount[x.equip] = (eqCount[x.equip] || 0) + 1; });
      counts.C = allTier.filter(function (x) { return x.equip === '有氧'; }).length;
      return { tier: tier, q: q, list: list0, counts: counts, equipCounts: EQUIPS.map(function (e) { return { id: e, n: eqCount[e] || 0 }; }), tiers: [{ id: 'T1', label: 'T1' }, { id: 'T2', label: 'T2' }, { id: 'T3', label: 'T3' }, { id: 'C', label: '有氧' }].map(function (t) { return { id: t.id, label: t.label, n: counts[t.id] || 0 }; }),
        customCount: ((db && db.customLib) || []).length };
    }
    var all = libUnique(db), cat = opts.category || null, fit = opts.fit || 'plan';
    var pattern = opts.pattern || '', part = opts.part || '', equip = opts.equip || '';
    var list = all.filter(function (x) {
      if (cat) return inPlanCategory(x, cat, fit) && matchQuery(x, q);
      if (pattern && patternOfPart(x.part).id !== pattern) return false;
      if (part && x.part !== part) return false;
      if (equip && x.equip !== equip) return false;
      return matchQuery(x, q);
    }).map(function (x) {
      var row = libRow(db, x, cur, cat && cat.locked ? 'T1' : (x.tier || 'T3'));
      row.last = lastW[x.name] !== undefined ? fmtW(lastW[x.name]) : '';
      return row;
    });
    if (cat && cat.names) {
      list.sort(function (a, b) {
        var ia = cat.names.indexOf(a.name), ib = cat.names.indexOf(b.name);
        if (ia < 0 && ib < 0) return a.name < b.name ? -1 : 1;
        if (ia < 0) return 1;
        if (ib < 0) return -1;
        return ia - ib;
      });
    }
    var pCount = {}, partCount = {}, eCount = {};
    all.forEach(function (x) {
      var pid = patternOfPart(x.part).id;
      pCount[pid] = (pCount[pid] || 0) + 1;
      if (!pattern || pid === pattern) partCount[x.part] = (partCount[x.part] || 0) + 1;
      if ((!pattern || pid === pattern) && (!part || x.part === part)) eCount[x.equip] = (eCount[x.equip] || 0) + 1;
    });
    var partIds = pattern ? (PATTERNS.filter(function (p) { return p.id === pattern; })[0] || { parts: [] }).parts : Object.keys(partCount);
    var parts = [];
    partIds.forEach(function (id) { if (partCount[id]) parts.push({ id: id, label: id, n: partCount[id] }); });
    return { q: q, list: list, category: cat, fit: fit,
      patterns: PATTERNS.filter(function (p) { return pCount[p.id]; }).map(function (p) { return { id: p.id, label: p.label, n: pCount[p.id] }; }),
      parts: parts, equips: EQUIPS.filter(function (e) { return eCount[e]; }).map(function (e) { return { id: e, n: eCount[e] }; }),
      customCount: ((db && db.customLib) || []).length };
  }
  /** 某槽位“下一次”的更换上下文（弹层用） */
  function swapContext(db, dayId, slotId) {
    var d = dayById(db, dayId), s = null;
    d.slots.forEach(function (x) { if (x.id === slotId) s = x; });
    var rp = replay(db), wk = (rp.counts[dayId] || 0) + 1, ef = effectiveSlot(db, s, wk, rp.hist), lastW = lastWeights(rp);
    var curW = startState(s, rp.states[s.id], ef, wk, progressionOf(db)).weight;
    var cat = slotCategory(db, s, ef.slot.name);
    return { rotates: rotationOn(db.params, s), dayId: dayId, slotId: slotId, tier: s.tier, name: ef.slot.name, week: wk, weight: curW, weightText: fmtW(curW), lastW: lastW, base: wk === 1, category: cat };
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
      if (e.miss) entries[k].miss = true;
      if (e.sets && e.sets.length) entries[k].sets = e.sets.map(function (n) { return n === '' || n === undefined ? null : n; });
    });
    var r = { id: rec.id || uid(), date: rec.date || today(), day: rec.day, deload: !!rec.deload, note: rec.note || '', bw: rec.bw || null,
      entries: entries, createdAt: rec.createdAt || Date.now(), updatedAt: Date.now() };
    var idx = -1;
    db.records.forEach(function (x, i) { if (x.id === r.id) idx = i; });
    // 归属：显式指定 > 原记录的归属 > 当前计划。旧记录没有 programId 时保持「没有」（等价于第一个计划），不凭空改写
    var owner = rec.programId || (idx >= 0 ? recPid(db.records[idx]) : activePid(db));
    if (owner !== LEGACY_PID) r.programId = owner;
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
  function cfgPart(db) { return JSON.stringify([db.params, db.days, db.customLib || [], db.daysVersion, db.programs || null, db.activeProgramId || null, db.onboarding || null]); }
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
      programs: cfgSrc.programs, activeProgramId: cfgSrc.activeProgramId, onboarding: cfgSrc.onboarding,
      cfgAt: Math.max(a.cfgAt || 0, b.cfgAt || 0), records: records, tomb: tomb };
    // 旧版客户端推上来的数据没有 programs：沿用另一方的计划元数据，避免一次同步把计划列表冲掉
    if (!out.programs) { var other = cfgSrc === a ? b : a; out.programs = other.programs; out.activeProgramId = other.activeProgramId; }
    if (!out.onboarding) { var o2 = cfgSrc === a ? b : a; out.onboarding = o2.onboarding; }
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

  var PROGRESSION_RULES = {
    gzclp: {
      name: 'GZCLP · 线性三阶进阶',
      summary: 'T1 从 5×3+ 开始，失败则降阶到 6×2+ 与 10×1+；T2 每轮在同模式内轮换；T3 高次数积累。',
      rules: [
        { title: 'T1 · 三阶进阶', rows: [
          ['5×3+', '末组 AMRAP ≥ 6', '加重，继续 5×3+'], ['5×3+', '3 ≤ AMRAP < 6', '重量不变，巩固'], ['5×3+', '连续 2 次 AMRAP < 3', '进入 6×2+，重量不变'],
          ['6×2+', '末组 AMRAP ≥ 4', '加重，继续 6×2+'], ['6×2+', '2 ≤ AMRAP < 4', '重量不变，巩固'], ['6×2+', '连续 2 次 AMRAP < 2', '进入 10×1+，重量不变'],
          ['10×1+', '末组 AMRAP ≥ 2', '加重，继续 10×1+'], ['10×1+', 'AMRAP < 2', '测新 5RM，取 90% 为新 TM，重置 5×3+']] },
        { title: 'T2 · 退阶重置', rows: [
          ['3×10', '全部完成', '加重，继续 3×10'], ['3×10', '无法完成', '降为 3×8，重量不变'],
          ['3×8', '全部完成', '加重，回到 3×10（表格公式）'], ['3×8', '无法完成', '降为 3×6，重量不变'], ['3×6', '完成 / 未完成', '加重，重置回 3×10']] },
        { title: 'T3', rows: [['3×15+', '末组 AMRAP ≥ 阈值(25)', '加重，回到 3×15+'], ['3×15+', '末组 AMRAP < 阈值', '重量不变']] },
        { title: '减载周规则', rows: [['第 6 周', '计划内减载', 'T1 −50%，T2 −40%，T3 少 1 组，不打乱进阶链']] }
      ],
      general: [
        '循环顺序：A1 → B1 → A2 → B2 依次滚动，不固定星期几',
        '组间休息：T1 3~5 分钟，T2 2~3 分钟，T3 60~90 秒',
        '减载：每 6 周 1 次，T1 −50%，T2 −40%，T3 减 1 组（不改变进阶链）',
        'T1 降阶：需连续 2 次未达标，单次失败只预警',
        '推荐重量：T1=1RM×76.5%；T2≈1RM×动作系数×65%；T3≈1RM×动作系数×50%',
        '动作轮换：T1 四大项固定；T2/T3 每轮（8 周）在同一动作模式内自动换一次，不与上一轮重复，一轮内保持不变',
        '记录原则：只填 AMRAP 次数或完成情况，阶段与重量自动推算'
      ]
    },
    w531: {
      name: '5/3/1 · Wendler 经典百分比波浪',
      summary: '以训练最大重量（TM = 1RM × 90%）为计算基准。主项 4 周波浪，BBB 5×10 固定积累容量。',
      rules: [
        { title: '主项四周百分比波浪', rows: [
          ['第 1 周 (3×5+)', '65%×5, 75%×5, 85%×5+', '末组 AMRAP 尽量多做，突破次数'],
          ['第 2 周 (3×3+)', '70%×3, 80%×3, 90%×3+', '中高强度，冲刺大重量次数'],
          ['第 3 周 (5/3/1+)', '75%×5, 85%×3, 95%×1+', '极限周，冲 1+ 爆发力与信心'],
          ['第 4 周 (减载)', '40%×5, 50%×5, 60%×5', '减载恢复，不冲 AMRAP，促进神经修复']] },
        { title: '进阶与周期判定', rows: [
          ['深蹲 / 硬拉', '完成一轮 4 周', '下轮 TM +5 kg（下肢）'],
          ['卧推 / 实力推', '完成一轮 4 周', '下轮 TM +2.5 kg（上肢）'],
          ['未达标保护', 'W3 未能完成 1 次', 'TM 下调 10%（TM × 0.9），从头循环']] },
        { title: 'BBB 与孤立', rows: [
          ['BBB (Boring But Big)', '主项后同动作 5×10', '重量固定为当前 TM 的 50%，专注肌肉量'],
          ['孤立', '推、拉、单腿/核心', '每类每天 25~50 次总量，双重进阶（8–12 次）']] }
      ],
      general: [
        'TM 原则：永远不要高估 TM，宁轻勿重；慢速而持续的进步才是力量王道',
        '休息时间：主项重组 3~5 分钟，BBB 组 90~120 秒，孤立 60 秒',
        '第 4 周减载：必须严格减载，即使感觉良好也不要冲重量，为下一轮蓄力'
      ]
    },
    linear: {
      name: '线性加重进阶 (Linear Progression)',
      summary: '每次训练达标即加重。连续 3 次未能完成规定次数则卸重 10%，重新向上攀登。',
      rules: [
        { title: '主项线性进阶', rows: [
          ['规定组次全部完成', '达到目标次数（如 3×5+）', '下次训练加重（上肢 +2.5kg，下肢 +2.5~5kg）'],
          ['末组 AMRAP', '最后一组尽力多做', '次数多于 5 次记为巩固；自适应模式下可适当多加'],
          ['连续 3 次未达标', '同一重量 3 次失败', '卸重 10%（工作重量 × 0.9），重新线性累积']] },
        { title: '变式与孤立进阶', rows: [
          ['双重进阶', '区间 8–12 或 15–20 次', '所有组达到上限时加重回到下限；某组低于下限降重']] }
      ],
      general: [
        '加重步幅：上肢动作 2.5kg（哑铃 1~2kg），下肢深蹲硬拉 2.5~5kg',
        '安全与动作质量：末组 AMRAP 保持动作标准，保留 1 次余力（RPE 9），切忌力竭变形',
        '三大项高频：深蹲每周 2~3 次高频刺激，强化神经募集'
      ]
    },
    dual: {
      name: '双重进阶 (Dual Progression)',
      summary: '先在固定重量下增加次数（做满区间上限），再增加重量回到次数下限，持续循环。',
      rules: [
        { title: '双重进阶判定', rows: [
          ['满组满次', '所有组均达到次数上限（如 12/12/12）', '下次训练加重，次数回到区间下限（如 8 次）'],
          ['区间内累积', '各组在区间内（如 12/10/9）', '重量保持不变，下次继续争取多做 1~2 次'],
          ['跌破下限', '任一组低于次数下限 2 次以上', '下次降低一档重量，避免动作代偿变形']] },
        { title: '常用次数区间', rows: [
          ['大肌群复合 (6–10)', '主项、推胸、划船、深蹲变式', '兼顾机械张力与力量增长'],
          ['变式 (8–12)', '哑铃推举、引体、分腿蹲、下拉', '肌肥大黄金区间，代谢压力与泵感'],
          ['孤立 (10–15 / 12–20)', '侧平举、面拉、弯举、腿屈伸', '单关节孤立，保护关节，高泵感']] }
      ],
      general: [
        '加重不要激进：加重幅度越小（杠铃 2.5kg，哑铃 1~2kg，绳索 2.5kg），平台期越少',
        '控制离心：离心 2~3 秒下落，向心充分发力，最大化肌纤维破坏与机械张力',
        '各计划保持固定动作编排，不强制自动轮换，专注该周期的渐进超负荷'
      ]
    },
    cardio: {
      name: '有氧训练 (Cardio)',
      summary: '以目标分钟为单位。稳态有氧（LISS）或高低间歇（HIIT），记录运动时长与消耗。',
      rules: [
        { title: '判定与记录', rows: [
          ['完成判定', '实际运动时长 ≥ 目标分钟', '打勾完成；不计入力量吨位，不推算 1RM'],
          ['渐进超负荷', '体能适应后', '每周增加 2~5 分钟，或增加坡度/阻力/配速']] },
        { title: '常见健身房有氧模式', rows: [
          ['跑步机坡走', '坡度 8~12，速度 4.5~5.5 km/h', '低冲击、高燃脂、保护膝盖'],
          ['健身单车', '阻力中等，踏频 70~80 rpm', '下肢血液循环、关节友好'],
          ['椭圆机 / 楼梯机', '全身体能、核心稳定', '热量消耗大，适合高效减脂']] }
      ],
      general: [
        '力量优先：减脂期力量在前保住肌肉，有氧在后清空糖原加速燃脂',
        '心率区间：减脂推荐最大心率 60%~75%（能够连续说话但不喘）',
        '恢复与补水：有氧后补充水分与电解质，避免过度脱水'
      ]
    }
  };
  function progressionRules(progId) {
    return PROGRESSION_RULES[progId] || PROGRESSION_RULES.dual;
  }
  var RULES = PROGRESSION_RULES.gzclp.rules;
  var GENERAL_RULES = PROGRESSION_RULES.gzclp.general;

  function liftRM(db, lift) {
    var p = oneRMProfile(db)[lift] || {};
    return Math.max(Number(p.manual) || 0, p.latest && p.latest.v || 0) || (db.params.oneRM[lift] || 0);
  }
  function libSlot(id, tier, name, prog, scheme, lift) {
    var lb = libFind(name);
    return {
      id: id, tier: tier, name: name, equip: lb ? lb.equip : (scheme.equip || '杠铃'), lift: lift || null,
      init: { type: 'fixed', value: scheme.weight || 0 }, step: null, roundProg: false, noRotate: true,
      prog: prog, scheme: scheme
    };
  }
  function seedFixed(db, name, tier) {
    var rec = recommendWeight(db, name, tier, { preferLast: false });
    return rec && rec.weight > 0 ? rec.weight : (rec && rec.weight === 0 ? 0 : 20);
  }
  function dualSlot(db, id, tier, name, sets, lo, hi, step, lift) {
    var bw = equipOf(name) === '自重';
    return libSlot(id, tier, name, 'dual', { sets: sets, repMin: lo, repMax: hi, step: bw ? 0 : step, weight: seedFixed(db, name, tier) }, lift || null);
  }
  function cardioSlot(id, name, minutes) {
    return libSlot(id, 'C', name, 'cardio', { minutes: minutes, weight: 0 }, null);
  }
  function linSlot(db, id, tier, name, sets, reps, step, lift) {
    return libSlot(id, tier, name, 'linear', { sets: sets, reps: reps, step: step, inc: 2.5, weight: seedFixed(db, name, 'T1') }, lift || null);
  }
  function phulDays(db) {
    function d(id, tier, name, sets, lo, hi, step, lift, seedTier, equip) {
      return libSlot(id, tier, name, 'dual', { sets: sets, repMin: lo, repMax: hi, step: step, weight: seedFixed(db, name, seedTier || tier), equip: equip }, lift);
    }
    return [
      { id: 'UP', name: '上肢力量', slots: [
        d('UP1', 'T1', '平板卧推', 3, 3, 5, 2.5, 'bench', 'T1'),
        d('UP2', 'T2', '上斜哑铃卧推', 3, 6, 10, 2, null, 'T2'),
        d('UP3', 'T1', '杠铃划船', 3, 3, 5, 2.5, null, 'T1'),
        d('UP4', 'T2', '高位下拉', 3, 6, 10, 2.5, null, 'T2'),
        d('UP5', 'T2', '站姿实力推', 2, 5, 8, 2.5, 'ohp', 'T2'),
        d('UP6', 'T3', '杠铃弯举', 2, 6, 10, 1.25, null, 'T3'),
        d('UP7', 'T3', '仰卧臂屈伸', 2, 6, 10, 1.25, null, 'T3')
      ] },
      { id: 'LP', name: '下肢力量', slots: [
        d('LP1', 'T1', '杠铃深蹲', 3, 3, 5, 5, 'squat', 'T1'),
        d('LP2', 'T1', '传统硬拉', 3, 3, 5, 5, 'deadlift', 'T1'),
        d('LP3', 'T2', '腿举', 3, 10, 15, 5, null, 'T2'),
        d('LP4', 'T3', '俯卧腿弯举', 3, 6, 10, 2.5, null, 'T3'),
        d('LP5', 'T3', '提踵', 4, 6, 10, 5, null, 'T3')
      ] },
      { id: 'UH', name: '上肢肌肥大', slots: [
        d('UH1', 'T2', '上斜卧推', 3, 8, 12, 2.5, 'bench', 'T2'),
        d('UH2', 'T3', '平板哑铃飞鸟', 3, 8, 12, 2, null, 'T3', '哑铃'),
        d('UH3', 'T2', '坐姿划船', 3, 8, 12, 2.5, null, 'T2'),
        d('UH4', 'T2', '单臂哑铃划船', 3, 8, 12, 2, null, 'T2'),
        d('UH5', 'T3', '哑铃侧平举', 3, 8, 12, 1, null, 'T3'),
        d('UH6', 'T3', '上斜哑铃弯举', 3, 8, 12, 1, null, 'T3'),
        d('UH7', 'T3', '绳索三头屈伸', 3, 8, 12, 2.5, null, 'T3')
      ] },
      { id: 'LH', name: '下肢肌肥大', slots: [
        d('LH1', 'T2', '前蹲', 3, 8, 12, 2.5, 'squat', 'T2'),
        d('LH2', 'T2', '杠铃弓步', 3, 8, 12, 2.5, null, 'T2', '杠铃'),
        d('LH3', 'T3', '坐姿腿屈伸', 3, 10, 15, 2.5, null, 'T3'),
        d('LH4', 'T3', '俯卧腿弯举', 3, 10, 15, 2.5, null, 'T3'),
        d('LH5', 'T3', '提踵', 3, 8, 12, 5, null, 'T3'),
        d('LH6', 'T3', '腿举提踵', 3, 8, 12, 5, null, 'T3', '器械')
      ] }
    ];
  }
  function pplDays(db) {
    function lin(id, tier, name, sets, step, lift) {
      return libSlot(id, tier, name, 'linear', { sets: sets, reps: 5, step: step, inc: 2.5, weight: seedFixed(db, name, 'T1') }, lift);
    }
    function acc(id, tier, name, sets, lo, hi, step) {
      return libSlot(id, tier, name, 'dual', { sets: sets, repMin: lo, repMax: hi, step: step, weight: seedFixed(db, name, tier) }, null);
    }
    var pushAcc = [
      acc('PX2', 'T2', '上斜哑铃卧推', 3, 8, 12, 2),
      acc('PX3', 'T3', '绳索下压', 3, 8, 12, 2.5),
      acc('PX4', 'T3', '哑铃侧平举', 3, 15, 20, 1),
      acc('PX5', 'T3', '过头绳索臂屈伸', 3, 8, 12, 2.5),
      acc('PX6', 'T3', '哑铃侧平举', 3, 15, 20, 1)
    ];
    function push(id, heavyName, heavyLift, lightName) {
      var slots = [lin(id + '1', 'T1', heavyName, 5, 2.5, heavyLift), acc(id + 'L', 'T2', lightName, 3, 8, 12, heavyLift === 'bench' ? 2.5 : 2.5)];
      pushAcc.forEach(function (s, i) { var c = JSON.parse(JSON.stringify(s)); c.id = id + 'A' + i; slots.push(c); });
      return slots;
    }
    var pullAcc = [
      acc('LX2', 'T2', '高位下拉', 3, 8, 12, 2.5),
      acc('LX3', 'T2', '坐姿划船', 3, 8, 12, 2.5),
      acc('LX4', 'T3', '面拉', 5, 15, 20, 1.25),
      acc('LX5', 'T3', '锤式弯举', 4, 8, 12, 1),
      acc('LX6', 'T3', '哑铃弯举', 4, 8, 12, 1)
    ];
    function pull(id, heavy, sets, step, lift) {
      var slots = [lin(id + '1', 'T1', heavy, sets, step, lift)];
      pullAcc.forEach(function (s, i) { var c = JSON.parse(JSON.stringify(s)); c.id = id + 'A' + i; slots.push(c); });
      return slots;
    }
    var legsAcc = [
      acc('GX2', 'T2', '罗马尼亚硬拉', 3, 8, 12, 5),
      acc('GX3', 'T2', '腿举', 3, 8, 12, 5),
      acc('GX4', 'T3', '俯卧腿弯举', 3, 8, 12, 2.5),
      acc('GX5', 'T3', '提踵', 5, 8, 12, 5)
    ];
    function legs(id) {
      var slots = [lin(id + '1', 'T1', '杠铃深蹲', 3, 2.5, 'squat')];
      legsAcc.forEach(function (s, i) { var c = JSON.parse(JSON.stringify(s)); c.id = id + 'A' + i; slots.push(c); });
      return slots;
    }
    return [
      { id: 'PA', name: '推 · 卧推', slots: push('PA', '平板卧推', 'bench', '站姿实力推') },
      { id: 'LA', name: '拉 · 硬拉', slots: pull('LA', '传统硬拉', 1, 5, 'deadlift') },
      { id: 'GA', name: '腿', slots: legs('GA') },
      { id: 'PB', name: '推 · 推举', slots: push('PB', '站姿实力推', 'ohp', '平板卧推') },
      { id: 'LB', name: '拉 · 划船', slots: pull('LB', '杠铃划船', 5, 2.5, null) },
      { id: 'GB', name: '腿', slots: legs('GB') }
    ];
  }
  function fiveDays(db) {
    function main(id, name, lift, step) {
      var tm0 = ceilTo(liftRM(db, lift) * 0.9, 2.5);
      return libSlot(id, 'T1', name, 'w531', { step: step, inc: 2.5, weight: tm0 }, lift);
    }
    function bbb(id, name, link, lift) {
      return libSlot(id, 'T2', name, 'fixed', { sets: 5, reps: 10, pct: 0.5, inc: 2.5, link: link, halfOnDeload: true, weight: 0 }, lift);
    }
    function acc(id, tier, name, sets, lo, hi, step) {
      return dualSlot(db, id, tier, name, sets, lo, hi, step);
    }
    return [
      { id: 'F1', name: '实力推', slots: [
        main('F1M', '站姿实力推', 'ohp', 2.5),
        bbb('F1B', '站姿实力推', 'F1M', 'ohp'),
        acc('F1A1', 'T2', '高位下拉', 3, 8, 12, 2.5),
        acc('F1A2', 'T3', '绳索下压', 3, 10, 15, 2.5),
        acc('F1A3', 'T3', '悬垂举腿', 3, 10, 15, 0)
      ] },
      { id: 'F2', name: '硬拉', slots: [
        main('F2M', '传统硬拉', 'deadlift', 5),
        bbb('F2B', '传统硬拉', 'F2M', 'deadlift'),
        acc('F2A1', 'T2', '上斜哑铃卧推', 3, 8, 12, 2),
        acc('F2A2', 'T2', '单臂哑铃划船', 3, 8, 12, 2),
        acc('F2A3', 'T3', '卷腹', 3, 12, 15, 0)
      ] },
      { id: 'F3', name: '卧推', slots: [
        main('F3M', '平板卧推', 'bench', 2.5),
        bbb('F3B', '平板卧推', 'F3M', 'bench'),
        acc('F3A1', 'T2', '杠铃划船', 3, 8, 12, 2.5),
        acc('F3A2', 'T3', '哑铃侧平举', 3, 12, 15, 1),
        acc('F3A3', 'T3', '面拉', 3, 12, 15, 2.5)
      ] },
      { id: 'F4', name: '深蹲', slots: [
        main('F4M', '杠铃深蹲', 'squat', 5),
        bbb('F4B', '杠铃深蹲', 'F4M', 'squat'),
        acc('F4A1', 'T2', '高位下拉', 3, 8, 12, 2.5),
        acc('F4A2', 'T2', '保加利亚分腿蹲', 3, 8, 12, 2),
        acc('F4A3', 'T3', '卷腹', 3, 12, 15, 0)
      ] }
    ];
  }
  /** 新手全身力量：三个全身日，主项线性加重。 */
  function nsbDays(db) {
    return [
      { id: 'NA', name: '全身 A', slots: [
        linSlot(db, 'NA1', 'T1', '杠铃深蹲', 3, 5, 2.5, 'squat'),
        linSlot(db, 'NA2', 'T1', '平板卧推', 3, 5, 2.5, 'bench'),
        dualSlot(db, 'NA3', 'T2', '杠铃划船', 3, 6, 10, 2.5),
        dualSlot(db, 'NA4', 'T3', '哑铃侧平举', 3, 12, 15, 1),
        dualSlot(db, 'NA5', 'T3', '卷腹', 3, 12, 15, 0)
      ] },
      { id: 'NB', name: '全身 B', slots: [
        linSlot(db, 'NB1', 'T1', '传统硬拉', 1, 5, 5, 'deadlift'),
        linSlot(db, 'NB2', 'T1', '站姿实力推', 3, 5, 2.5, 'ohp'),
        dualSlot(db, 'NB3', 'T2', '高位下拉', 3, 6, 10, 2.5),
        dualSlot(db, 'NB4', 'T3', '俯卧腿弯举', 3, 10, 15, 2.5),
        dualSlot(db, 'NB5', 'T3', '面拉', 3, 12, 15, 2.5)
      ] },
      { id: 'NC', name: '全身 C', slots: [
        linSlot(db, 'NC1', 'T1', '杠铃深蹲', 3, 5, 2.5, 'squat'),
        dualSlot(db, 'NC2', 'T2', '上斜哑铃卧推', 3, 8, 12, 2),
        dualSlot(db, 'NC3', 'T2', '坐姿划船', 3, 8, 12, 2.5),
        dualSlot(db, 'NC4', 'T3', '哑铃弯举', 3, 10, 15, 1),
        dualSlot(db, 'NC5', 'T3', '绳索三头屈伸', 3, 10, 15, 2.5)
      ] }
    ];
  }
  /** 功能表现：蹲、铰链、推、拉，加上单腿与核心。 */
  function athDays(db) {
    return [
      { id: 'AA', name: '蹲与推', slots: [
        linSlot(db, 'AA1', 'T1', '杠铃深蹲', 3, 5, 2.5, 'squat'),
        linSlot(db, 'AA2', 'T1', '站姿实力推', 3, 5, 2.5, 'ohp'),
        dualSlot(db, 'AA3', 'T2', '引体向上', 3, 6, 10, 0),
        dualSlot(db, 'AA4', 'T2', '保加利亚分腿蹲', 3, 8, 10, 2),
        dualSlot(db, 'AA5', 'T3', '悬垂举腿', 3, 10, 15, 0)
      ] },
      { id: 'AB', name: '铰链与拉', slots: [
        linSlot(db, 'AB1', 'T1', '传统硬拉', 3, 5, 5, 'deadlift'),
        linSlot(db, 'AB2', 'T1', '平板卧推', 3, 5, 2.5, 'bench'),
        dualSlot(db, 'AB3', 'T2', '杠铃划船', 3, 6, 10, 2.5),
        dualSlot(db, 'AB4', 'T2', '臀推', 3, 8, 12, 2.5),
        dualSlot(db, 'AB5', 'T3', '山羊挺身', 3, 10, 15, 0)
      ] },
      { id: 'AC', name: '功能整合', slots: [
        dualSlot(db, 'AC1', 'T2', '罗马尼亚硬拉', 3, 6, 10, 2.5, 'deadlift'),
        dualSlot(db, 'AC2', 'T2', '上斜哑铃卧推', 3, 8, 12, 2),
        dualSlot(db, 'AC3', 'T2', '单臂哑铃划船', 3, 8, 12, 2),
        dualSlot(db, 'AC4', 'T2', '高脚杯深蹲', 3, 8, 12, 2),
        dualSlot(db, 'AC5', 'T3', '面拉', 3, 12, 15, 2.5)
      ] }
    ];
  }
  /** 减脂向全身：复合动作为主，中等次数，每周三次。 */
  function fb3Days(db) {
    return [
      { id: 'FA', name: '全身 A', slots: [
        dualSlot(db, 'FA1', 'T1', '杠铃深蹲', 3, 6, 10, 2.5, 'squat'),
        dualSlot(db, 'FA2', 'T1', '平板卧推', 3, 6, 10, 2.5, 'bench'),
        dualSlot(db, 'FA3', 'T2', '杠铃划船', 3, 8, 12, 2.5),
        dualSlot(db, 'FA4', 'T3', '卷腹', 3, 10, 15, 0)
      ] },
      { id: 'FB', name: '全身 B', slots: [
        dualSlot(db, 'FB1', 'T2', '罗马尼亚硬拉', 3, 8, 12, 2.5, 'deadlift'),
        dualSlot(db, 'FB2', 'T1', '站姿实力推', 3, 6, 10, 2.5, 'ohp'),
        dualSlot(db, 'FB3', 'T2', '高位下拉', 3, 8, 12, 2.5),
        dualSlot(db, 'FB4', 'T3', '提踵', 3, 10, 15, 5)
      ] },
      { id: 'FC', name: '全身 C', slots: [
        dualSlot(db, 'FC1', 'T2', '腿举', 3, 10, 15, 5),
        dualSlot(db, 'FC2', 'T2', '上斜哑铃卧推', 3, 8, 12, 2),
        dualSlot(db, 'FC3', 'T2', '单臂哑铃划船', 3, 8, 12, 2),
        dualSlot(db, 'FC4', 'T3', '哑铃侧平举', 3, 12, 15, 1)
      ] }
    ];
  }
  /** 力量后有氧：短的全身力量，最后 15 分钟有氧，约占一次训练的三分之一。 */
  function mix3Days(db) {
    return [
      { id: 'MA', name: '全身 A · 力量后有氧', slots: [
        dualSlot(db, 'MA1', 'T1', '杠铃深蹲', 3, 6, 10, 2.5, 'squat'),
        dualSlot(db, 'MA2', 'T1', '平板卧推', 3, 6, 10, 2.5, 'bench'),
        dualSlot(db, 'MA3', 'T2', '杠铃划船', 3, 8, 12, 2.5),
        cardioSlot('MA4', '单车', 15)
      ] },
      { id: 'MB', name: '全身 B · 力量后有氧', slots: [
        dualSlot(db, 'MB1', 'T2', '罗马尼亚硬拉', 3, 8, 12, 2.5, 'deadlift'),
        dualSlot(db, 'MB2', 'T1', '站姿实力推', 3, 6, 10, 2.5, 'ohp'),
        dualSlot(db, 'MB3', 'T2', '高位下拉', 3, 8, 12, 2.5),
        cardioSlot('MB4', '跑步机坡走', 15)
      ] },
      { id: 'MC', name: '全身 C · 力量后有氧', slots: [
        dualSlot(db, 'MC1', 'T2', '腿举', 3, 10, 15, 5),
        dualSlot(db, 'MC2', 'T2', '上斜哑铃卧推', 3, 8, 12, 2),
        dualSlot(db, 'MC3', 'T2', '单臂哑铃划船', 3, 8, 12, 2),
        cardioSlot('MC4', '椭圆机', 15)
      ] }
    ];
  }
  /** 有氧为主：四五个复合动作保住肌肉，再加 30 分钟有氧，有氧时间不少于力量。 */
  function cut3Days(db) {
    return [
      { id: 'CA', name: '全身 A · 有氧为主', slots: [
        dualSlot(db, 'CA1', 'T1', '杠铃深蹲', 3, 6, 10, 2.5, 'squat'),
        dualSlot(db, 'CA2', 'T1', '平板卧推', 3, 6, 10, 2.5, 'bench'),
        dualSlot(db, 'CA3', 'T2', '杠铃划船', 3, 8, 12, 2.5),
        dualSlot(db, 'CA4', 'T2', '臀推', 3, 8, 12, 2.5),
        cardioSlot('CA5', '跑步机坡走', 30)
      ] },
      { id: 'CB', name: '全身 B · 有氧为主', slots: [
        dualSlot(db, 'CB1', 'T2', '罗马尼亚硬拉', 3, 8, 12, 2.5, 'deadlift'),
        dualSlot(db, 'CB2', 'T1', '站姿实力推', 3, 6, 10, 2.5, 'ohp'),
        dualSlot(db, 'CB3', 'T2', '高位下拉', 3, 8, 12, 2.5),
        dualSlot(db, 'CB4', 'T2', '腿举', 3, 10, 15, 5),
        cardioSlot('CB5', '单车', 30)
      ] },
      { id: 'CC', name: '全身 C · 有氧为主', slots: [
        dualSlot(db, 'CC1', 'T2', '腿举', 3, 10, 15, 5),
        dualSlot(db, 'CC2', 'T2', '上斜哑铃卧推', 3, 8, 12, 2),
        dualSlot(db, 'CC3', 'T2', '单臂哑铃划船', 3, 8, 12, 2),
        dualSlot(db, 'CC4', 'T2', '臀推', 3, 8, 12, 2.5),
        cardioSlot('CC5', '椭圆机', 30)
      ] }
    ];
  }
  /** 有氧日：两天短力量、两天只做有氧，每次 40 分钟。 */
  function cut4Days(db) {
    return [
      { id: 'KA', name: '力量 A', slots: [
        dualSlot(db, 'KA1', 'T1', '杠铃深蹲', 3, 6, 10, 2.5, 'squat'),
        dualSlot(db, 'KA2', 'T1', '平板卧推', 3, 6, 10, 2.5, 'bench'),
        dualSlot(db, 'KA3', 'T2', '杠铃划船', 3, 8, 12, 2.5)
      ] },
      { id: 'KB', name: '有氧 A', slots: [
        cardioSlot('KB1', '跑步机坡走', 40)
      ] },
      { id: 'KC', name: '力量 B', slots: [
        dualSlot(db, 'KC1', 'T2', '罗马尼亚硬拉', 3, 8, 12, 2.5, 'deadlift'),
        dualSlot(db, 'KC2', 'T1', '站姿实力推', 3, 6, 10, 2.5, 'ohp'),
        dualSlot(db, 'KC3', 'T2', '高位下拉', 3, 8, 12, 2.5)
      ] },
      { id: 'KD', name: '有氧 B', slots: [
        cardioSlot('KD1', '单车', 40)
      ] }
    ];
  }
  /** 上肢下肢塑形：全程肥大区间，肩、臀、核心配件更多。 */
  function ul4Days(db) {
    return [
      { id: 'UA', name: '上肢 A', slots: [
        dualSlot(db, 'UA1', 'T1', '平板卧推', 3, 8, 12, 2.5, 'bench'),
        dualSlot(db, 'UA2', 'T2', '上斜哑铃卧推', 3, 8, 12, 2),
        dualSlot(db, 'UA3', 'T2', '杠铃划船', 3, 8, 12, 2.5),
        dualSlot(db, 'UA4', 'T3', '哑铃侧平举', 3, 12, 15, 1),
        dualSlot(db, 'UA5', 'T3', '绳索三头屈伸', 3, 10, 15, 2.5),
        dualSlot(db, 'UA6', 'T3', '哑铃弯举', 3, 10, 15, 1)
      ] },
      { id: 'LA', name: '下肢 A', slots: [
        dualSlot(db, 'LA1', 'T1', '杠铃深蹲', 3, 6, 10, 2.5, 'squat'),
        dualSlot(db, 'LA2', 'T2', '罗马尼亚硬拉', 3, 8, 12, 2.5, 'deadlift'),
        dualSlot(db, 'LA3', 'T2', '腿举', 3, 10, 15, 5),
        dualSlot(db, 'LA4', 'T3', '俯卧腿弯举', 3, 10, 15, 2.5),
        dualSlot(db, 'LA5', 'T3', '提踵', 3, 10, 15, 5),
        dualSlot(db, 'LA6', 'T3', '卷腹', 3, 10, 15, 0)
      ] },
      { id: 'UB', name: '上肢 B', slots: [
        dualSlot(db, 'UB1', 'T1', '站姿实力推', 3, 8, 12, 2.5, 'ohp'),
        dualSlot(db, 'UB2', 'T2', '哑铃卧推', 3, 8, 12, 2),
        dualSlot(db, 'UB3', 'T2', '高位下拉', 3, 8, 12, 2.5),
        dualSlot(db, 'UB4', 'T3', '面拉', 3, 12, 15, 2.5),
        dualSlot(db, 'UB5', 'T3', '反向飞鸟', 3, 12, 15, 1)
      ] },
      { id: 'LB', name: '下肢 B', slots: [
        dualSlot(db, 'LB1', 'T2', '臀推', 3, 8, 12, 2.5),
        dualSlot(db, 'LB2', 'T2', '保加利亚分腿蹲', 3, 8, 12, 2),
        dualSlot(db, 'LB3', 'T3', '坐姿腿屈伸', 3, 10, 15, 2.5),
        dualSlot(db, 'LB4', 'T3', '腿外展', 3, 12, 15, 5),
        dualSlot(db, 'LB5', 'T3', '坐姿腿弯举', 3, 10, 15, 2.5)
      ] }
    ];
  }
  /** 臀腿优先：下肢每周两次，臀推、铰链、外展放在前面。 */
  function gluteDays(db) {
    return [
      { id: 'G1', name: '下肢 · 臀优先', slots: [
        dualSlot(db, 'G11', 'T1', '臀推', 4, 6, 10, 2.5),
        dualSlot(db, 'G12', 'T1', '杠铃深蹲', 3, 6, 10, 2.5, 'squat'),
        dualSlot(db, 'G13', 'T2', '罗马尼亚硬拉', 3, 8, 12, 2.5, 'deadlift'),
        dualSlot(db, 'G14', 'T2', '保加利亚分腿蹲', 3, 8, 12, 2),
        dualSlot(db, 'G15', 'T3', '腿外展', 3, 12, 20, 5)
      ] },
      { id: 'G2', name: '上肢', slots: [
        dualSlot(db, 'G21', 'T2', '上斜卧推', 3, 8, 12, 2.5, 'bench'),
        dualSlot(db, 'G22', 'T2', '坐姿划船', 3, 8, 12, 2.5),
        dualSlot(db, 'G23', 'T3', '哑铃侧平举', 3, 12, 15, 1),
        dualSlot(db, 'G24', 'T3', '面拉', 3, 12, 15, 2.5)
      ] },
      { id: 'G3', name: '下肢 · 铰链', slots: [
        dualSlot(db, 'G31', 'T1', '罗马尼亚硬拉', 3, 6, 10, 2.5, 'deadlift'),
        dualSlot(db, 'G32', 'T2', '臀推', 3, 8, 12, 2.5),
        dualSlot(db, 'G33', 'T2', '高脚杯深蹲', 3, 8, 12, 2),
        dualSlot(db, 'G34', 'T3', '俯卧腿弯举', 3, 10, 15, 2.5),
        dualSlot(db, 'G35', 'T3', '提踵', 3, 12, 15, 5)
      ] },
      { id: 'G4', name: '上肢 · 姿态', slots: [
        dualSlot(db, 'G41', 'T2', '站姿实力推', 3, 8, 12, 2.5, 'ohp'),
        dualSlot(db, 'G42', 'T2', '高位下拉', 3, 8, 12, 2.5),
        dualSlot(db, 'G43', 'T3', '反向飞鸟', 3, 12, 15, 1),
        dualSlot(db, 'G44', 'T3', '卷腹', 3, 10, 15, 0)
      ] }
    ];
  }
  /** 三天里两天下肢，适合想练形体但每周只有三天。 */
  function lulDays(db) {
    return [
      { id: 'L1', name: '下肢 A', slots: [
        dualSlot(db, 'L11', 'T1', '杠铃深蹲', 3, 6, 10, 2.5, 'squat'),
        dualSlot(db, 'L12', 'T1', '臀推', 3, 8, 12, 2.5),
        dualSlot(db, 'L13', 'T2', '罗马尼亚硬拉', 3, 8, 12, 2.5, 'deadlift'),
        dualSlot(db, 'L14', 'T3', '腿外展', 3, 12, 20, 5)
      ] },
      { id: 'LU', name: '上肢', slots: [
        dualSlot(db, 'LU1', 'T1', '平板卧推', 3, 8, 12, 2.5, 'bench'),
        dualSlot(db, 'LU2', 'T2', '杠铃划船', 3, 8, 12, 2.5),
        dualSlot(db, 'LU3', 'T3', '哑铃侧平举', 3, 12, 15, 1),
        dualSlot(db, 'LU4', 'T3', '面拉', 3, 12, 15, 2.5),
        dualSlot(db, 'LU5', 'T3', '绳索下压', 3, 10, 15, 2.5)
      ] },
      { id: 'L2', name: '下肢 B', slots: [
        dualSlot(db, 'L21', 'T2', '保加利亚分腿蹲', 3, 8, 12, 2),
        dualSlot(db, 'L22', 'T2', '腿举', 3, 10, 15, 5),
        dualSlot(db, 'L23', 'T2', '臀推', 3, 10, 15, 2.5),
        dualSlot(db, 'L24', 'T3', '俯卧腿弯举', 3, 10, 15, 2.5),
        dualSlot(db, 'L25', 'T3', '卷腹', 3, 10, 15, 0)
      ] }
    ];
  }
  /** 五分化：胸、背、肩、腿、手臂，偏推拉与围度。 */
  function broDays(db) {
    return [
      { id: 'BC', name: '胸', slots: [
        dualSlot(db, 'BC1', 'T1', '平板卧推', 4, 6, 10, 2.5, 'bench'),
        dualSlot(db, 'BC2', 'T2', '上斜哑铃卧推', 3, 8, 12, 2),
        dualSlot(db, 'BC3', 'T3', '绳索夹胸', 3, 10, 15, 2.5),
        dualSlot(db, 'BC4', 'T3', '绳索下压', 3, 10, 15, 2.5)
      ] },
      { id: 'BK', name: '背', slots: [
        dualSlot(db, 'BK1', 'T1', '杠铃划船', 4, 6, 10, 2.5),
        dualSlot(db, 'BK2', 'T2', '高位下拉', 3, 8, 12, 2.5),
        dualSlot(db, 'BK3', 'T2', '单臂哑铃划船', 3, 8, 12, 2),
        dualSlot(db, 'BK4', 'T3', '面拉', 3, 12, 15, 2.5),
        dualSlot(db, 'BK5', 'T3', '杠铃弯举', 3, 8, 12, 1.25)
      ] },
      { id: 'BS', name: '肩', slots: [
        dualSlot(db, 'BS1', 'T1', '站姿实力推', 4, 6, 10, 2.5, 'ohp'),
        dualSlot(db, 'BS2', 'T3', '哑铃侧平举', 4, 10, 15, 1),
        dualSlot(db, 'BS3', 'T3', '反向飞鸟', 3, 12, 15, 1),
        dualSlot(db, 'BS4', 'T3', '哑铃耸肩', 3, 8, 12, 2)
      ] },
      { id: 'BL', name: '腿', slots: [
        dualSlot(db, 'BL1', 'T1', '杠铃深蹲', 4, 6, 10, 2.5, 'squat'),
        dualSlot(db, 'BL2', 'T1', '罗马尼亚硬拉', 3, 6, 10, 2.5, 'deadlift'),
        dualSlot(db, 'BL3', 'T2', '腿举', 3, 10, 15, 5),
        dualSlot(db, 'BL4', 'T3', '俯卧腿弯举', 3, 10, 15, 2.5),
        dualSlot(db, 'BL5', 'T3', '提踵', 4, 10, 15, 5)
      ] },
      { id: 'BA', name: '手臂', slots: [
        dualSlot(db, 'BA1', 'T2', '窄距卧推', 3, 8, 12, 2.5, 'bench'),
        dualSlot(db, 'BA2', 'T3', '杠铃弯举', 3, 8, 12, 1.25),
        dualSlot(db, 'BA3', 'T3', '锤式弯举', 3, 10, 15, 1),
        dualSlot(db, 'BA4', 'T3', '仰卧臂屈伸', 3, 8, 12, 1.25),
        dualSlot(db, 'BA5', 'T3', '绳索三头屈伸', 3, 10, 15, 2.5)
      ] }
    ];
  }
  /** 推拉四日：腿部动作并进推日和拉日。 */
  function pp4Days(db) {
    return [
      { id: 'P1', name: '推 A', slots: [
        dualSlot(db, 'P11', 'T1', '平板卧推', 4, 6, 10, 2.5, 'bench'),
        dualSlot(db, 'P12', 'T1', '站姿实力推', 3, 6, 10, 2.5, 'ohp'),
        dualSlot(db, 'P13', 'T2', '上斜哑铃卧推', 3, 8, 12, 2),
        dualSlot(db, 'P14', 'T3', '哑铃侧平举', 3, 12, 15, 1),
        dualSlot(db, 'P15', 'T3', '绳索下压', 3, 10, 15, 2.5),
        dualSlot(db, 'P16', 'T1', '杠铃深蹲', 3, 6, 10, 2.5, 'squat')
      ] },
      { id: 'D1', name: '拉 A', slots: [
        dualSlot(db, 'D11', 'T1', '传统硬拉', 3, 5, 8, 5, 'deadlift'),
        dualSlot(db, 'D12', 'T2', '杠铃划船', 4, 6, 10, 2.5),
        dualSlot(db, 'D13', 'T2', '高位下拉', 3, 8, 12, 2.5),
        dualSlot(db, 'D14', 'T3', '面拉', 3, 12, 15, 2.5),
        dualSlot(db, 'D15', 'T3', '杠铃弯举', 3, 8, 12, 1.25),
        dualSlot(db, 'D16', 'T2', '罗马尼亚硬拉', 3, 8, 12, 2.5, 'deadlift')
      ] },
      { id: 'P2', name: '推 B', slots: [
        dualSlot(db, 'P21', 'T2', '上斜卧推', 4, 8, 12, 2.5, 'bench'),
        dualSlot(db, 'P22', 'T2', '坐姿哑铃推肩', 3, 8, 12, 2),
        dualSlot(db, 'P23', 'T2', '双杠臂屈伸', 3, 6, 12, 0),
        dualSlot(db, 'P24', 'T3', '绳索侧平举', 3, 12, 15, 1.25),
        dualSlot(db, 'P25', 'T2', '腿举', 3, 10, 15, 5)
      ] },
      { id: 'D2', name: '拉 B', slots: [
        dualSlot(db, 'D21', 'T2', '俯身划船', 4, 8, 12, 2.5),
        dualSlot(db, 'D22', 'T2', '引体向上', 3, 5, 10, 0),
        dualSlot(db, 'D23', 'T2', '坐姿划船', 3, 8, 12, 2.5),
        dualSlot(db, 'D24', 'T3', '反向飞鸟', 3, 12, 15, 1),
        dualSlot(db, 'D25', 'T3', '俯卧腿弯举', 3, 10, 15, 2.5)
      ] }
    ];
  }
  function templateKey(id) { return id === 'gzclp-8w' ? 'gzclp' : (id || ''); }
  function schemeText(s) {
    var sc = s.scheme || {};
    if (s.prog === 'linear') return (sc.sets || 1) + '×' + (sc.reps || 5) + '+';
    if (s.prog === 'dual') return (sc.sets || 3) + '×' + sc.repMin + '–' + sc.repMax;
    if (s.prog === 'w531') return '百分比波浪 · 末组尽量多';
    if (s.prog === 'fixed') return (sc.sets || 5) + '×' + (sc.reps || 10) + (sc.pct ? ' · 训练最大重量 ' + Math.round(sc.pct * 100) + '%' : '');
    if (s.prog === 'cardio') return (sc.minutes || 20) + ' 分钟';
    if (s.tier === 'T1') return '5×3+ → 6×2+ → 10×1+';
    if (s.tier === 'T2') return '3×10 → 3×8 → 3×6';
    return '3×15+';
  }
  function templateCatalog() {
    return [
      { id: 'gzclp', name: 'GZCLP', days: '每周 4 练', daysFit: ['4'], lean: 'unisex', focus: 'strength', goals: ['strength'], blurb: '深蹲、卧推、硬拉、实力推。T1 从 5×3+ 开始，完不成就退阶；T2、T3 每轮在同一模式里轮换。' },
      { id: '531', name: '5/3/1', days: '每周 4 练', daysFit: ['4'], lean: 'unisex', focus: 'strength', goals: ['strength'], blurb: '四周一个循环。训练最大重量取 1RM 的 90%，主项按百分比波浪，BBB 同一动作 5×10、重量固定。' },
      { id: 'nsb', name: '新手全身力量', days: '每周 3 练', daysFit: ['2_3'], lean: 'unisex', focus: 'strength', goals: ['strength'], blurb: '三个全身日。深蹲、卧推、硬拉和实力推完成规定次数就加重，适合刚开始建立力量。' },
      { id: 'ath3', name: '功能表现 · 全身', days: '每周 3 练', daysFit: ['2_3'], lean: 'unisex', focus: 'function', goals: ['strength', 'recomp'], blurb: '蹲、髋铰链、推、拉，加上单腿和核心。练的是能用出来的力量，不只是单项最大重量。' },
      { id: 'ppl', name: 'Reddit PPL', days: '每周 6 练', daysFit: ['5_6'], lean: 'male', focus: 'physique', goals: ['muscle_gain'], blurb: '推、拉、腿各两次。主项完成规定次数就加重，变式全部组做到区间上限才加重。' },
      { id: 'phul', name: 'PHUL', days: '每周 4 练', daysFit: ['4'], lean: 'unisex', focus: 'physique', goals: ['muscle_gain', 'reshape'], blurb: '两天力量、两天肌肥大。上肢下肢分开，既加重量也加围度。' },
      { id: 'bro5', name: '五分化增肌', days: '每周 5 练', daysFit: ['5_6'], lean: 'male', focus: 'physique', goals: ['muscle_gain', 'reshape'], blurb: '胸、背、肩、腿、手臂各一天。次数偏中高，用来把推拉和手臂的容量做够。' },
      { id: 'pp4', name: '推拉分化', days: '每周 4 练', daysFit: ['4'], lean: 'male', focus: 'physique', goals: ['muscle_gain', 'reshape'], blurb: '推、拉各两次。腿部分别放进推日和拉日，适合想加厚上肢、每周能练四天的人。' },
      { id: 'ul4', name: '上肢下肢 · 塑形', days: '每周 4 练', daysFit: ['4'], lean: 'unisex', focus: 'physique', goals: ['reshape', 'muscle_gain', 'recomp'], blurb: '上肢、下肢各两次，全程用肥大次数。肩、臀和核心的孤立比力量计划更多。' },
      { id: 'glute4', name: '臀腿优先 · 塑形', days: '每周 4 练', daysFit: ['4'], lean: 'female', focus: 'physique', goals: ['reshape', 'muscle_gain'], blurb: '下肢每周两次，臀推、髋铰链和外展放在前面；上肢保持姿态和平衡，不把容量全压在卧推上。' },
      { id: 'lul3', name: '下 · 上 · 下', days: '每周 3 练', daysFit: ['2_3'], lean: 'female', focus: 'physique', goals: ['reshape', 'recomp'], blurb: '三天里两天练下肢。想优先臀腿体态、又只有三天时间时用。' },
      { id: 'fb3', name: '全身 · 减脂向', days: '每周 3 练', daysFit: ['2_3'], lean: 'unisex', focus: 'fat_loss', goals: ['fat_loss', 'recomp'], blurb: '三次全身训练，复合动作为主，用来在减脂时保住肌肉。这套只练力量，有氧另排。' },
      { id: 'mix3', name: '力量后有氧', days: '每周 3 练', daysFit: ['2_3'], lean: 'unisex', focus: 'fat_loss', goals: ['reshape', 'recomp'], blurb: '三次全身力量，最后加 15 分钟单车、坡走或椭圆机。有氧约占一次训练的三分之一，力量仍是主体。' },
      { id: 'cut3', name: '有氧为主', days: '每周 3 练', daysFit: ['2_3'], lean: 'unisex', focus: 'fat_loss', goals: ['fat_loss'], blurb: '每次四五个复合动作保住肌肉，再加 30 分钟有氧。有氧时间不少于力量，减脂优先。' },
      { id: 'cut4', name: '有氧日', days: '每周 4 练', daysFit: ['4'], lean: 'unisex', focus: 'fat_loss', goals: ['fat_loss'], blurb: '两天短力量、两天只做 40 分钟有氧。一周里有氧占大头，力量用来保住肌肉。' }
    ];
  }
  function recommendTemplates(db) {
    var dir = (db && db.onboarding && db.onboarding.direction) || {};
    var goal = dir.goal || '', days = dir.daysPerWeek || '';
    var gender = db && db.params && db.params.shareProfile ? db.params.shareProfile.gender : '';
    function score(c) {
      var s = 0;
      if (days && (c.daysFit || []).indexOf(days) >= 0) s += 10;
      if (goal === 'fat_loss' && (c.id === 'cut3' || c.id === 'cut4')) s += 4;
      if (gender === 'female' && c.lean === 'female') s += 3;
      if (gender === 'male' && c.lean === 'male') s += 3;
      return s;
    }
    return templateCatalog().filter(function (c) { return !goal || (c.goals || []).indexOf(goal) >= 0; }).sort(function (a, b) {
      return score(b) - score(a);
    });
  }
  /** 不开始计划也能看的编排：每天的动作、组次，以及按当前 1RM 估算的起始重量。 */
  function templatePreview(db, id) {
    var cat = templateCatalog().filter(function (x) { return x.id === id; })[0], def = templateDef(db, id);
    if (!cat || !def) return null;
    var P = Object.assign(defaultParams(), def.params || {}), byId = {};
    def.days.forEach(function (d) { d.slots.forEach(function (s) { byId[s.id] = s; }); });
    var tplProg = def.progression || (id === 'gzclp' ? 'gzclp' : 'dual');
    return { id: cat.id, name: cat.name, daysLabel: cat.days, blurb: cat.blurb, progression: tplProg, days: def.days.map(function (d) {
      return { id: d.id, name: d.name, slots: d.slots.map(function (s) {
        var w = initWeight(s, P), bw = equipOf(s.name, s.equip) === '自重';
        if (s.scheme && s.scheme.link && byId[s.scheme.link]) w = ceilTo(initWeight(byId[s.scheme.link], P) * (s.scheme.pct || 0.5), (s.scheme.inc) || 2.5);
        var weight = s.prog === 'cardio' ? ((s.scheme && s.scheme.minutes || 20) + ' 分钟') : bw ? '自重' : (s.prog === 'w531' && w > 0 ? 'TM ' + fmtW(w) + ' kg' : (w > 0 ? fmtW(w) + ' kg' : ''));
        return { tier: s.tier, badge: slotBadge(s, tplProg), name: s.name, equip: equipOf(s.name, s.equip), text: schemeText(s), weight: weight };
      }) };
    }) };
  }
  function templateDef(db, id) {
    var base = {
      autoRotate: false, adaptive: false, ruleMode: 'full',
      oneRM: { bench: liftRM(db, 'bench'), squat: liftRM(db, 'squat'), deadlift: liftRM(db, 'deadlift'), ohp: liftRM(db, 'ohp') }
    };
    if (id === 'gzclp') return { template: 'gzclp', name: 'GZCLP', progression: 'gzclp', days: defaultDays(), params: { oneRM: base.oneRM, autoRotate: true, deloadEnabled: true, weeksPerCycle: 8, totalWeeks: 8, progression: 'gzclp', ruleMode: 'full' } };
    var built = {
      phul: ['PHUL', 'dual', phulDays, 12],
      ppl: ['Reddit PPL', 'linear', pplDays, 8],
      nsb: ['新手全身力量', 'linear', nsbDays, 8],
      ath3: ['功能表现 · 全身', 'dual', athDays, 8],
      fb3: ['全身 · 减脂向', 'dual', fb3Days, 8],
      mix3: ['力量后有氧', 'dual', mix3Days, 8],
      cut3: ['有氧为主', 'dual', cut3Days, 8],
      cut4: ['有氧日', 'dual', cut4Days, 8],
      ul4: ['上肢下肢 · 塑形', 'dual', ul4Days, 8],
      glute4: ['臀腿优先 · 塑形', 'dual', gluteDays, 8],
      lul3: ['下 · 上 · 下', 'dual', lulDays, 8],
      bro5: ['五分化增肌', 'dual', broDays, 8],
      pp4: ['推拉分化', 'dual', pp4Days, 8]
    }[id];
    if (id === '531') return { template: '531', name: '5/3/1', progression: 'w531', days: fiveDays(db), params: Object.assign({}, base, { deloadEnabled: false, weeksPerCycle: 4, totalWeeks: 16, tmRatio: 0.9 }) };
    if (!built) return null;
    return { template: id, name: built[0], progression: built[1], days: built[2](db), params: Object.assign({}, base, { deloadEnabled: false, weeksPerCycle: built[3], totalWeeks: built[3], progression: built[1] }) };
  }

  return {
    VERSION: VERSION, LIFTS: LIFTS, LIFT_ORDER: LIFT_ORDER, STEP_KEYS: STEP_KEYS, STAGES: STAGES, FIRST_STAGE: FIRST_STAGE,
    REST: REST, LIB: LIB, JUDGE_COLORS: JUDGE_COLORS, JUDGE_ICON: JUDGE_ICON, dateLabel: dateLabel, backupLabel: backupLabel, TIER_COLORS: TIER_COLORS, RULES: RULES, GENERAL_RULES: GENERAL_RULES,
    defaults: defaults, defaultDays: defaultDays, defaultParams: defaultParams, excelSeedRecords: excelSeedRecords, normalize: normalize,
    roundTo: roundTo, tm: tm, recommendWeight: recommendWeight, equipOf: equipOf, unitOf: unitOf, incOf: incOf, stepOf: stepOf, EQUIP_NOTE: EQUIP_NOTE, EQUIP_RULE: EQUIP_RULE, normEquip: normEquip, initWeight: initWeight, fmtW: fmtW, platesFor: platesFor, linreg: linreg,
    evaluate: evaluate, replay: replay, recommend: recommend, isDeloadWeek: isDeloadWeek, dayById: dayById,
    blankDraft: blankDraft, buildTrain: buildTrain, buildPlan: buildPlan, buildStats: buildStats, buildReview: buildReview,
    saveRecord: saveRecord, deleteRecord: deleteRecord, clearRecords: clearRecords, replaceDb: replaceDb, mergeDb: mergeDb, sameDb: sameDb, stampConfig: stampConfig, cfgPart: cfgPart, getRecord: getRecord, sessionResult: sessionResult, swapSlot: swapSlot, buildLibrary: buildLibrary, swapContext: swapContext, effectiveSlot: effectiveSlot,
    libAll: libAll, libFindIn: libFindIn, addCustomEx: addCustomEx, removeCustomEx: removeCustomEx, PARTS: PARTS, EQUIPS: EQUIPS, PATTERNS: PATTERNS, patternOfPart: patternOfPart, slotCategory: slotCategory, roundInfo: roundInfo, logView: logView, today: today, uid: uid,
    cycleOf: cycleOf, cycleLen: cycleLen, cycleStartWeek: cycleStartWeek, weekText: weekText,
    adaptiveUp: adaptiveUp, ADAPT: ADAPT, adjustSlot: adjustSlot, slotInfo: slotInfo, setNoRotate: setNoRotate, startState: startState, planCycles: planCycles, buildRotation: buildRotation, rotationOn: rotationOn, rotationPool: rotationPool, autoStartWeight: autoStartWeight,
    ROTATION: ROTATION, ROTATION_PRINCIPLES: ROTATION_PRINCIPLES, modelWeight: modelWeight,
    PROGRESSIONS: PROGRESSIONS, registerProgression: registerProgression, progressionOf: progressionOf, roleOf: roleOf, ROLE_NAME: ROLE_NAME, TIER_LABELS: TIER_LABELS, tierLabel: tierLabel, slotBadge: slotBadge, templateDef: templateDef, templateCatalog: templateCatalog, templatePreview: templatePreview, templateKey: templateKey, recommendTemplates: recommendTemplates, ceilTo: ceilTo,
    PROGRESSION_RULES: PROGRESSION_RULES, progressionRules: progressionRules,
    LEGACY_PID: LEGACY_PID, BASE_KEYS: BASE_KEYS, PLAN_KEYS: PLAN_KEYS, PROGRAM_STATUS: PROGRAM_STATUS, recPid: recPid, activePid: activePid, activeProgram: activeProgram, programById: programById,
    canTrain: canTrain, planView: planView, switchProgram: switchProgram, pauseProgram: pauseProgram, resumeProgram: resumeProgram, endProgram: endProgram, startProgram: startProgram, programList: programList, replayAll: replayAll, oneRMProfile: oneRMProfile,
    ONBOARD_GENDER: ONBOARD_GENDER, ONBOARD_GOAL: ONBOARD_GOAL, ONBOARD_EXPERIENCE: ONBOARD_EXPERIENCE, ONBOARD_DAYS: ONBOARD_DAYS, ONBOARD_EQUIP: ONBOARD_EQUIP,
    profileReady: profileReady, directionReady: directionReady, onboardingComplete: onboardingComplete, needsOnboarding: needsOnboarding, directionSummary: directionSummary, hasAvatar: hasAvatar
  };
});
