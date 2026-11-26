/**
 * 单动作记组草稿。只决定「这一组记没记下」，不计算进阶和下次重量。
 * 次数沿用现有上限：力量 0–60，有氧 0–300。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SetLog = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function repCap(inputType) { return inputType === 'cardio' ? 300 : 60; }

  function clampReps(raw, inputType) {
    if (raw === null || raw === undefined || raw === '') return null;
    var n = Math.round(Number(raw));
    if (isNaN(n)) return null;
    return Math.max(0, Math.min(repCap(inputType), n));
  }

  function isAmrapIndex(it, index) {
    if (!it || index < 0) return false;
    if (it.inputType === 'done' || it.inputType === 'fixed' || it.inputType === 'deload') return false;
    if (it.dots && it.dots[index]) return !!it.dots[index].amrap;
    return index === (it.sets || 1) - 1 && it.inputType !== 'done';
  }

  function targetOf(it, index) {
    var reps = it && it.reps != null ? it.reps : 0;
    var amrap = isAmrapIndex(it, index);
    return { reps: reps, amrap: amrap, text: amrap ? (reps + '+') : String(reps) };
  }

  function groupsOf(en) { return (en && en.groups) || []; }

  /** 旧草稿只有 done 前缀时，用规定次数补出可显示的组，不另造一条训练记录。 */
  function migrate(en, it) {
    en = en || {};
    if (!en.groups) en.groups = [];
    var done = en.done || 0;
    if (!en.groups.length && done > 0 && it) {
      var weight = it.weight;
      for (var i = 0; i < done && i < (it.sets || done); i++) {
        var last = i === (it.sets || done) - 1;
        var reps = last && en.v != null && en.v !== '完成' && en.v !== '未完成' ? Number(en.v) : (it.reps || 0);
        en.groups.push({ reps: reps, weight: weight });
      }
    }
    en.done = en.groups.length;
    return en;
  }

  function syncEngine(en, it) {
    var n = groupsOf(en).length;
    en.done = n;
    var sets = it && it.sets || 0;
    if (n < sets) {
      if (it && (it.inputType === 'done' || it.inputType === 'fixed' || it.inputType === 'deload')) en.v = null;
      else if (!it || it.inputType !== 'cardio') en.v = null;
      return en;
    }
    var last = en.groups[n - 1];
    if (it && (it.inputType === 'done' || it.inputType === 'fixed' || it.inputType === 'deload')) en.v = '完成';
    else en.v = last ? last.reps : null;
    return en;
  }

  function defaultPending(en, it) {
    if (en && en.pending && en.pending.reps !== undefined && en.pending.reps !== null && en.pending.reps !== '') return en.pending;
    var index = groupsOf(en).length;
    var target = targetOf(it, index);
    var weight = en && en.w != null && en.w !== '' ? en.w : (it ? it.weight : 0);
    return { reps: target.reps, weight: weight };
  }

  /**
   * 纯计算。write 返回 false 时不采用新草稿。
   * 返回 { ok, reason, entry, index, last }
   */
  function commitGroup(en, it, pending, write) {
    en = migrate(Object.assign({}, en), it);
    var index = en.groups.length;
    if (!it || index >= it.sets) return { ok: false, reason: 'full', entry: en };
    var reps = clampReps(pending && pending.reps, it.inputType);
    if (reps == null) return { ok: false, reason: 'empty', entry: en };
    var weight = pending && pending.weight != null && pending.weight !== '' ? Number(pending.weight) : (it.weight || 0);
    if (isNaN(weight) || weight < 0) weight = it.weight || 0;
    var next = Object.assign({}, en, {
      groups: en.groups.concat([{ reps: reps, weight: weight }]),
      pending: null
    });
    if (weight !== it.weight) next.w = weight;
    syncEngine(next, it);
    if (write && write(next) === false) return { ok: false, reason: 'write', entry: en, pending: { reps: pending.reps, weight: weight } };
    return { ok: true, entry: next, index: index, last: index === it.sets - 1 };
  }

  function undoLast(en, it) {
    en = migrate(Object.assign({}, en, { groups: groupsOf(en).slice() }), it);
    if (!en.groups.length) return null;
    var removed = en.groups[en.groups.length - 1];
    var next = Object.assign({}, en, {
      groups: en.groups.slice(0, -1),
      pending: { reps: removed.reps, weight: removed.weight }
    });
    syncEngine(next, it);
    return { entry: next, removed: removed };
  }

  /** 只改这一组。后面的组原样保留。 */
  function correctGroup(en, it, index, reps, weight) {
    en = migrate(Object.assign({}, en, { groups: groupsOf(en).slice() }), it);
    if (index < 0 || index >= en.groups.length) return null;
    var clean = clampReps(reps, it && it.inputType);
    if (clean == null) return null;
    var w = weight != null && weight !== '' ? Number(weight) : en.groups[index].weight;
    if (isNaN(w) || w < 0) w = en.groups[index].weight;
    var prev = en.groups[index];
    var groups = en.groups.map(function (g, i) {
      if (i !== index) return g;
      return {
        reps: clean,
        weight: w,
        correctedFrom: prev.correctedFrom != null ? prev.correctedFrom : prev.reps
      };
    });
    var next = Object.assign({}, en, { groups: groups });
    if (index === groups.length - 1 && w !== (it && it.weight)) next.w = w;
    syncEngine(next, it);
    return next;
  }

  /** 换动作时把已记组留在原动作名下，不删，也不算到新动作上。 */
  /** 这一组的规定次数。波浪组用该组次数；区间组用达到上限的次数。不另算进阶。 */
  function prescribedReps(it, index) {
    var load = it && it.loads && it.loads[index];
    if (load && load.reps != null && load.reps !== '' && !isNaN(Number(load.reps))) return Number(load.reps);
    if (it && it.inputType === 'sets' && it.scheme && it.scheme.repMax != null && !isNaN(Number(it.scheme.repMax))) return Number(it.scheme.repMax);
    var n = Number(it && it.reps);
    return isNaN(n) ? null : n;
  }

  /** 这一组的工作重量。波浪组用该组重量，否则用本次调整重量或计划重量。 */
  function setWeight(it, en, index) {
    var load = it && it.loads && it.loads[index];
    if (load && load.weight != null && load.weight !== '' && !isNaN(Number(load.weight))) return Number(load.weight);
    if (en && en.w != null && en.w !== '' && !isNaN(Number(en.w))) return Number(en.w);
    return it && it.weight != null ? (Number(it.weight) || 0) : 0;
  }

  function mirrorShape(next, it) {
    if (it && it.inputType === 'sets') next.sets = (next.groups || []).map(function (g) { return g.reps; });
    return next;
  }

  /**
   * 一次补上若干尚未记下的组。已有组不改。write 返回 false 时整批不采用。
   * additions: [{ index, reps, weight }]，index 必须从当前组数连续接上。
   */
  function commitBatch(en, it, additions, write) {
    en = migrate(Object.assign({}, en), it);
    if (!it || !additions || !additions.length) return { ok: false, reason: 'empty', entry: en };
    var groups = groupsOf(en).slice();
    var start = groups.length;
    var i;
    for (i = 0; i < additions.length; i++) {
      if (additions[i].index !== start + i) return { ok: false, reason: 'order', entry: en };
      if (start + i >= it.sets) return { ok: false, reason: 'full', entry: en };
      var reps = clampReps(additions[i].reps, it.inputType);
      if (reps == null) return { ok: false, reason: 'empty', entry: en };
      var weight = additions[i].weight != null && additions[i].weight !== '' ? Number(additions[i].weight) : (it.weight || 0);
      if (isNaN(weight) || weight < 0) weight = it.weight || 0;
      groups.push({ reps: reps, weight: weight });
    }
    var next = Object.assign({}, en, { groups: groups, pending: null });
    var lastW = groups[groups.length - 1].weight;
    if (lastW !== (it.weight || 0)) next.w = lastW;
    syncEngine(next, it);
    mirrorShape(next, it);
    if (write && write(next) === false) return { ok: false, reason: 'write', entry: en, pending: additions };
    return { ok: true, entry: next, from: start, count: additions.length, last: groups.length >= it.sets };
  }

  /**
   * 按每组实际次数整段记下。空值拒绝，0 保留为 0。已记组只有次数变了才标更正。
   * opts.miss：完成类（T2 / 固定 / 减载）不写成「完成」，实际总次数交给引擎原有的未完成入口；
   * 线性与波浪沿用已有的 miss 标记。其余类型仍把末组次数交给引擎自行判定。
   */
  function commitActuals(en, it, actuals, opts, write) {
    en = migrate(Object.assign({}, en), it);
    opts = opts || {};
    if (!it || !actuals || actuals.length !== it.sets) return { ok: false, reason: 'empty', entry: en };
    var prev = groupsOf(en);
    var groups = [];
    var i;
    for (i = 0; i < it.sets; i++) {
      var reps = clampReps(actuals[i], it.inputType);
      if (reps == null) return { ok: false, reason: 'empty', entry: en };
      var weight = prev[i] && prev[i].weight != null ? prev[i].weight : setWeight(it, en, i);
      var g = { reps: reps, weight: weight };
      if (prev[i]) {
        if (prev[i].reps !== reps) g.correctedFrom = prev[i].correctedFrom != null ? prev[i].correctedFrom : prev[i].reps;
        else if (prev[i].correctedFrom != null) g.correctedFrom = prev[i].correctedFrom;
      }
      groups.push(g);
    }
    var next = Object.assign({}, en, { groups: groups, pending: null });
    syncEngine(next, it);
    mirrorShape(next, it);
    if (opts.miss) {
      if (it.inputType === 'done' || it.inputType === 'fixed' || it.inputType === 'deload') {
        var sum = 0;
        groups.forEach(function (g) { sum += g.reps; });
        next.v = '未完成';
        next.reps = sum;
      } else if (it.inputType === 'linear' || it.inputType === 'wave') {
        next.miss = true;
      }
    }
    if (write && write(next) === false) return { ok: false, reason: 'write', entry: en };
    return { ok: true, entry: next, last: true, miss: !!opts.miss };
  }

  function holdForSwap(en, fromName) {
    en = en || {};
    var held = Object.assign({}, en.held || {});
    if ((en.groups && en.groups.length) || en.v != null && en.v !== '' || en.done) {
      held[fromName] = {
        groups: (en.groups || []).slice(),
        done: en.done || 0,
        v: en.v,
        pending: en.pending || null,
        w: en.w
      };
    }
    var next = Object.assign({}, en, { held: held, groups: [], done: 0, v: null, pending: null });
    return next;
  }

  function restoreHeld(en, name) {
    var bag = en && en.held && en.held[name];
    if (!bag) return Object.assign({}, en, { groups: [], done: 0, v: null, pending: null });
    return Object.assign({}, en, {
      groups: (bag.groups || []).slice(),
      done: bag.done || (bag.groups || []).length,
      v: bag.v,
      pending: bag.pending || null,
      w: bag.w
    });
  }

  return {
    repCap: repCap,
    clampReps: clampReps,
    isAmrapIndex: isAmrapIndex,
    targetOf: targetOf,
    migrate: migrate,
    syncEngine: syncEngine,
    defaultPending: defaultPending,
    prescribedReps: prescribedReps,
    setWeight: setWeight,
    commitGroup: commitGroup,
    commitBatch: commitBatch,
    commitActuals: commitActuals,
    undoLast: undoLast,
    correctGroup: correctGroup,
    holdForSwap: holdForSwap,
    restoreHeld: restoreHeld
  };
});
