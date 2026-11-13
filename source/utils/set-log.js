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
    commitGroup: commitGroup,
    undoLast: undoLast,
    correctGroup: correctGroup,
    holdForSwap: holdForSwap,
    restoreHeld: restoreHeld
  };
});
