/**
 * 单动作草稿：写入失败不推进、撤销只退最近一组、更正不删后续、换动作不把旧组算到新动作上。
 * 运行：node scripts/verify-set-log.js
 */
var assert = require('assert');
var GZ = require('../source/utils/engine.js');
var SL = require('../source/utils/set-log.js');

var failed = 0;
function check(name, fn) {
  try { fn(); console.log('ok  ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e && e.stack || e)); }
}
function item(db, day, slot) { return GZ.buildTrain(db, { day: day }).items.filter(function (it) { return it.slotId === slot; })[0]; }

check('记下失败不推进，空次数不能记', function () {
  var db = GZ.normalize(GZ.defaults(false));
  var it = item(db, 'A1', 'A1_1');
  var en = { v: null, done: 0 };
  var empty = SL.commitGroup(en, it, { reps: '', weight: it.weight }, function () { return true; });
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(empty.reason, 'empty');
  var blocked = SL.commitGroup(en, it, { reps: 3, weight: it.weight }, function () { return false; });
  assert.strictEqual(blocked.reason, 'write');
  assert.strictEqual(blocked.entry.done || 0, 0);
  assert.strictEqual((blocked.entry.groups || []).length, 0);
  var ok = SL.commitGroup(en, it, { reps: 3, weight: it.weight }, function () { return true; });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.index, 0);
  assert.strictEqual(ok.last, false);
  assert.strictEqual(ok.entry.v, null);
  assert.strictEqual(ok.entry.groups[0].reps, 3);
});

check('末组才把次数交给引擎，撤销只退最近一组', function () {
  var db = GZ.normalize(GZ.defaults(false));
  var it = item(db, 'A1', 'A1_1');
  var en = { v: null, done: 0, groups: [] };
  for (var i = 0; i < it.sets - 1; i++) en = SL.commitGroup(en, it, { reps: it.reps, weight: it.weight }, function () { return true; }).entry;
  assert.strictEqual(en.v, null);
  var last = SL.commitGroup(en, it, { reps: 5, weight: it.weight }, function () { return true; });
  assert.strictEqual(last.last, true);
  assert.strictEqual(last.entry.v, 5);
  var undone = SL.undoLast(last.entry, it);
  assert.strictEqual(undone.entry.groups.length, it.sets - 1);
  assert.strictEqual(undone.entry.v, null);
  assert.strictEqual(undone.entry.pending.reps, 5);
  assert.strictEqual(undone.entry.groups[0].reps, it.reps);
});

check('更正前面的组不删后面的组，也不改进行中的次数上限', function () {
  var db = GZ.normalize(GZ.defaults(false));
  var it = item(db, 'A1', 'A1_1');
  var en = { v: null, done: 0, groups: [] };
  en = SL.commitGroup(en, it, { reps: 3, weight: 60 }, function () { return true; }).entry;
  en = SL.commitGroup(en, it, { reps: 3, weight: 60 }, function () { return true; }).entry;
  en = SL.commitGroup(en, it, { reps: 3, weight: 60 }, function () { return true; }).entry;
  var fixed = SL.correctGroup(en, it, 0, 4, 60);
  assert.strictEqual(fixed.groups.length, 3);
  assert.strictEqual(fixed.groups[0].reps, 4);
  assert.strictEqual(fixed.groups[0].correctedFrom, 3);
  assert.strictEqual(fixed.groups[2].reps, 3);
  assert.strictEqual(fixed.v, null);
  assert.strictEqual(SL.clampReps(99, 'amrap'), 60);
  assert.strictEqual(SL.clampReps(400, 'cardio'), 300);
  assert.strictEqual(SL.repCap('amrap'), 60);
});

check('换动作把已记组留在原名下，不写到新动作', function () {
  var en = { v: 5, done: 5, groups: [{ reps: 5, weight: 60 }], ex: null };
  var held = SL.holdForSwap(en, '杠铃深蹲');
  held.ex = '前蹲';
  assert.strictEqual(held.groups.length, 0);
  assert.strictEqual(held.v, null);
  assert.strictEqual(held.held['杠铃深蹲'].groups.length, 1);
  var back = SL.restoreHeld(held, '杠铃深蹲');
  assert.strictEqual(back.groups[0].reps, 5);
  assert.strictEqual(back.v, 5);
  var away = SL.holdForSwap({ groups: [{ reps: 3, weight: 60 }], done: 1, v: null, held: {} }, '杠铃深蹲');
  var other = SL.restoreHeld(away, '前蹲');
  other.ex = '前蹲';
  var backAgain = SL.holdForSwap(other, '前蹲');
  var home = SL.restoreHeld(backAgain, '杠铃深蹲');
  assert.strictEqual(home.groups[0].reps, 3);
  assert.strictEqual(home.groups.length, 1);
});

check('T2 完成前不把 v 写成完成，T3 末组才写入实际次数', function () {
  var db = GZ.normalize(GZ.defaults(false));
  var t2 = item(db, 'A1', 'A1_2');
  assert.strictEqual(t2.inputType, 'done');
  assert.strictEqual(SL.isAmrapIndex(t2, 0), false);
  assert.strictEqual(SL.isAmrapIndex(t2, t2.sets - 1), false);
  var en = { v: null, done: 0, groups: [] };
  en = SL.commitGroup(en, t2, { reps: t2.reps, weight: t2.weight }, function () { return true; }).entry;
  assert.strictEqual(en.v, null);
  while (en.groups.length < t2.sets) en = SL.commitGroup(en, t2, { reps: t2.reps, weight: t2.weight }, function () { return true; }).entry;
  assert.strictEqual(en.v, '完成');
  var t3 = item(db, 'A1', 'A1_4');
  assert.strictEqual(SL.isAmrapIndex(t3, t3.sets - 1), true);
  var e3 = { v: null, done: 0, groups: [] };
  while (e3.groups.length < t3.sets - 1) e3 = SL.commitGroup(e3, t3, { reps: t3.reps, weight: t3.weight }, function () { return true; }).entry;
  assert.strictEqual(e3.v, null);
  e3 = SL.commitGroup(e3, t3, { reps: 20, weight: t3.weight }, function () { return true; }).entry;
  assert.strictEqual(e3.v, 20);
});

check('草稿组次能让未完成训练在重开后被认出来，但不是一条训练记录', function () {
  var draft = { A1_1: { v: null, done: 0, groups: [{ reps: 3, weight: 60 }], pending: { reps: 3, weight: 60 } } };
  assert.strictEqual(GZ.sessionTouched({ day: 'A1', draft: draft, drafts: { A1: draft } }), true);
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nset-log ok');
