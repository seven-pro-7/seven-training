/**
 * 首页文案。只从训练视图和日期推导，不写示例重量、组次或日期。
 * 计划周用周期内的 weekInCycle，不用日历周。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HomeCopy = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function shortLift(name) {
    var n = String(name || '').trim();
    var stripped = n.replace(/^(杠铃|哑铃|壶铃|史密斯|绳索|器械)/, '');
    return stripped || n || '这个动作';
  }

  /** 训练日名称里的方向，供伙伴一句话使用。 */
  function dayFocus(name) {
    var n = String(name || '').trim();
    if (!n) return '今天';
    var regions = ['下肢', '上肢', '全身', '核心'];
    for (var i = 0; i < regions.length; i++) {
      if (n.indexOf(regions[i]) === 0) return regions[i];
    }
    return n.replace(/[·•].*$/, '').replace(/(主导|优先)$/, '').trim() || n;
  }

  function sessionStamp(date, weekInCycle, cycle, dayId) {
    var p = String(date || '').split('-');
    if (p.length < 3 || !p[0] || !p[1] || !p[2]) return String(dayId || '');
    var week = Math.max(1, Number(weekInCycle) || 1);
    var cyc = Number(cycle) || 1;
    var weekText = cyc > 1 ? ('第' + cyc + '轮第' + week + '周') : ('第' + week + '周');
    return p[0].slice(-2) + '.' + p[1] + '.' + p[2] + ' · ' + weekText + ' · ' + (dayId || '');
  }

  function schemeLine(it) {
    if (!it) return '';
    var badge = it.badge || '';
    var repsText = String(it.repsText || '');
    var body;
    if (it.isCardio) body = repsText;
    else if (repsText.indexOf('–') >= 0 || repsText.indexOf('%') >= 0 || repsText.indexOf(' · ') >= 0) body = repsText;
    else {
      var plus = /\+$/.test(repsText);
      body = (it.sets != null ? it.sets : '') + ' 组 × ' + (it.reps != null ? it.reps : '') + (plus ? '+' : '');
    }
    return badge ? (badge + ' · ' + body) : body;
  }

  function sessionStarted(vm) {
    if (!vm || !vm.items) return false;
    if (vm.editing) return true;
    if (vm.filled > 0) return true;
    return vm.items.some(function (it) { return (it.done || 0) > 0 || it.logged || it.skip; });
  }

  function focusItem(vm, slotId) {
    if (!vm || !vm.items || !vm.items.length) return null;
    var hit = null;
    vm.items.forEach(function (it) { if (it.slotId === slotId) hit = it; });
    return hit || vm.items[0];
  }

  function positionOf(vm, slotId) {
    var items = (vm && vm.items) || [];
    var index = 1;
    items.forEach(function (it, i) { if (it.slotId === slotId) index = i + 1; });
    return { index: index, total: items.length };
  }

  /**
   * 伙伴一句话。单行、辅助，不重复训练日标题。
   * o: { dayName, name, done, sets, logged, skipped, ready, started, editing }
   */
  function guidePrompt(o) {
    o = o || {};
    var name = shortLift(o.name);
    if (o.skipped) return name + '先跳过，接着下一项。';
    if (o.ready) return '今天的动作都记好了。';
    if (o.logged) return name + '已经记完。';
    var done = Number(o.done) || 0;
    var sets = Number(o.sets) || 0;
    if (done > 0 && sets > 0 && done < sets) return name + '已记下 ' + done + ' 组，接着第 ' + (done + 1) + ' 组。';
    if (done > 0 && sets > 0 && done >= sets) return name + '的组数已点完，记下结果就能完成。';
    if (o.editing) return '正在修改这次记录。';
    if (o.started) return '接着练' + name + '。';
    return '今天练' + dayFocus(o.dayName) + '，先从' + name + '开始。';
  }

  function ctaLabel(o) {
    o = o || {};
    if (o.ready) return o.editing ? '保存修改' : '完成训练';
    return (o.started ? '继续' : '开始') + shortLift(o.name);
  }

  return {
    shortLift: shortLift,
    dayFocus: dayFocus,
    sessionStamp: sessionStamp,
    schemeLine: schemeLine,
    sessionStarted: sessionStarted,
    focusItem: focusItem,
    positionOf: positionOf,
    guidePrompt: guidePrompt,
    ctaLabel: ctaLabel
  };
});
