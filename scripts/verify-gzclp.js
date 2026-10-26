/**
 * GZCLP 进阶与四天编排的回归检查。
 * 运行：node scripts/verify-gzclp.js
 */
var assert = require('assert');
var GZ = require('../source/utils/engine.js');

var failed = 0;
function check(name, fn) {
  try { fn(); console.log('ok  ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e && e.stack || e)); }
}
function slotOf(db, id) {
  var found = null;
  db.days.forEach(function (d) { d.slots.forEach(function (s) { if (s.id === id) found = s; }); });
  return found;
}
function P(extra) { return Object.assign(GZ.defaultParams(), extra || {}); }
function ev(slot, st, e, params) { return GZ.evaluate(slot, st, e, P(params), false); }

check('T1 full：做到目标次数就加重，4～5 次不再保持', function () {
  var db = GZ.defaults(false), s = slotOf(db, 'A2_1');
  [3, 4, 5].forEach(function (a) {
    var r = ev(s, { stage: '5×3+', weight: 50, fail: 2 }, { v: a });
    assert.strictEqual(r.judgment, '加重');
    assert.strictEqual(r.nextStage, '5×3+');
    assert.ok(r.nextWeight >= 52.5, a + ' → ' + r.nextWeight);
    assert.strictEqual(r.nextFail, 0);
  });
  var miss = ev(s, { stage: '5×3+', weight: 50, fail: 0 }, { v: 2 }, { t1FailLimit: 2 });
  assert.strictEqual(miss.judgment, '降阶');
  assert.strictEqual(miss.nextStage, '6×2+');
  assert.strictEqual(miss.nextWeight, 50);
  var six = ev(s, { stage: '6×2+', weight: 50, fail: 0 }, { v: 2 });
  assert.strictEqual(six.judgment, '加重');
  assert.strictEqual(six.nextStage, '6×2+');
  var drop = ev(s, { stage: '6×2+', weight: 50, fail: 0 }, { v: 1 });
  assert.strictEqual(drop.judgment, '降阶');
  assert.strictEqual(drop.nextStage, '10×1+');
  assert.strictEqual(drop.nextWeight, 50);
  var hit1 = ev(s, { stage: '10×1+', weight: 50, fail: 0 }, { v: 1 });
  assert.strictEqual(hit1.judgment, '加重');
  assert.strictEqual(hit1.nextStage, '10×1+');
  var reset = ev(s, { stage: '10×1+', weight: 40, fail: 0 }, { v: 0 });
  assert.strictEqual(reset.judgment, '重置');
  assert.strictEqual(reset.nextStage, '5×3+');
  assert.strictEqual(reset.nextWeight, 35);
});

check('T1 full：新 5RM 只乘 85%，不再乘 TM', function () {
  var db = GZ.defaults(false), s = slotOf(db, 'A2_1');
  var r = ev(s, { stage: '10×1+', weight: 40, fail: 0 }, { v: 0, new5RM: 80 });
  assert.strictEqual(r.judgment, '重置');
  assert.strictEqual(r.nextWeight, 67.5);
  assert.notStrictEqual(r.nextWeight, 60);
});

check('T1 full：高次数 AMRAP 会在步幅之上多加', function () {
  var db = GZ.defaults(false), s = slotOf(db, 'A2_1');
  var r = ev(s, { stage: '5×3+', weight: 50, fail: 0 }, { v: 12 });
  assert.strictEqual(r.judgment, '加重');
  assert.strictEqual(r.boost, true);
  assert.ok(r.nextWeight > 52.5 && r.nextWeight <= 57.5, String(r.nextWeight));
});

check('T1 excel：≥6 加重，3～5 保持，<3 切到 6×2+', function () {
  var db = GZ.defaults(false), s = slotOf(db, 'A2_1'), px = { ruleMode: 'excel' };
  var hold = ev(s, { stage: '5×3+', weight: 50, fail: 0 }, { v: 4 }, px);
  assert.strictEqual(hold.judgment, '保持');
  assert.strictEqual(hold.nextStage, '5×3+');
  assert.strictEqual(hold.nextWeight, 50);
  var up = ev(s, { stage: '5×3+', weight: 50, fail: 0 }, { v: 6 }, px);
  assert.strictEqual(up.judgment, '加重');
  assert.strictEqual(up.nextWeight, 52.5);
  var down = ev(s, { stage: '6×2+', weight: 50, fail: 0 }, { v: 2 }, px);
  assert.strictEqual(down.judgment, '建议降阶');
  assert.strictEqual(down.nextStage, '6×2+');
});

check('T2 full：完成留在当前组次并加重', function () {
  var db = GZ.defaults(false), s = slotOf(db, 'A1_2');
  ['3×10', '3×8', '3×6'].forEach(function (stage) {
    var r = ev(s, { stage: stage, weight: 40, fail: 0, last3x10: 40 }, { v: '完成' });
    assert.strictEqual(r.judgment, '加重', stage);
    assert.strictEqual(r.nextStage, stage);
    assert.strictEqual(r.nextWeight, 45);
  });
  var to8 = ev(s, { stage: '3×10', weight: 40, fail: 0, last3x10: 40 }, { v: '未完成' });
  assert.strictEqual(to8.judgment, '退阶');
  assert.strictEqual(to8.nextStage, '3×8');
  assert.strictEqual(to8.nextWeight, 40);
  var to6 = ev(s, { stage: '3×8', weight: 40, fail: 0, last3x10: 40 }, { v: '未完成' });
  assert.strictEqual(to6.nextStage, '3×6');
  assert.strictEqual(to6.nextWeight, 40);
});

check('T2 full：3×6 失败重置到上次 3×10 + 1～2 档，且低于失败重量', function () {
  var db = GZ.defaults(false), s = slotOf(db, 'A1_2');
  var two = ev(s, { stage: '3×6', weight: 62.5, fail: 0, last3x10: 42.5 }, { v: '未完成' });
  assert.strictEqual(two.judgment, '重置');
  assert.strictEqual(two.nextStage, '3×10');
  assert.strictEqual(two.nextWeight, 52.5);
  assert.ok(two.nextWeight < 62.5);
  var one = ev(s, { stage: '3×6', weight: 50, fail: 0, last3x10: 40 }, { v: '未完成' });
  assert.strictEqual(one.nextWeight, 45);
  var same = ev(s, { stage: '3×6', weight: 42.5, fail: 0, last3x10: 42.5 }, { v: '未完成' });
  assert.ok(same.nextWeight < 42.5, String(same.nextWeight));
  var manual = ev(s, { stage: '3×6', weight: 60, fail: 0, last3x10: 40 }, { v: '未完成', new10RM: 50 });
  assert.strictEqual(manual.nextWeight, 50);
  var none = ev(s, { stage: '3×6', weight: 60, fail: 0, last3x10: 0 }, { v: '未完成' });
  assert.strictEqual(none.nextWeight, 50);
  assert.ok(none.nextWeight < 60);
});

check('T2 excel：完成回到 3×10；3×6 失败也在失败重量上加重', function () {
  var db = GZ.defaults(false), s = slotOf(db, 'A1_2'), px = { ruleMode: 'excel' };
  var done8 = ev(s, { stage: '3×8', weight: 40, fail: 0, last3x10: 40 }, { v: '完成' }, px);
  assert.strictEqual(done8.judgment, '加重');
  assert.strictEqual(done8.nextStage, '3×10');
  assert.strictEqual(done8.nextWeight, 45);
  var fail6 = ev(s, { stage: '3×6', weight: 40, fail: 0, last3x10: 40 }, { v: '未完成' }, px);
  assert.strictEqual(fail6.judgment, '退阶');
  assert.strictEqual(fail6.nextStage, '3×10');
  assert.strictEqual(fail6.nextWeight, 45);
});

check('T2 自重完成 3×10 建议负重', function () {
  var db = GZ.defaults(false), s = slotOf(db, 'B1_3');
  var r = ev(s, { stage: '3×10', weight: 0, fail: 0, last3x10: 0 }, { v: '完成' });
  assert.strictEqual(r.judgment, '建议负重');
  assert.strictEqual(r.nextStage, '3×10');
  assert.strictEqual(r.nextWeight, 0);
  var mid = ev(s, { stage: '3×8', weight: 0, fail: 0, last3x10: 0 }, { v: '完成' });
  assert.strictEqual(mid.judgment, '加重');
  assert.strictEqual(mid.nextStage, '3×8');
});

check('T3 full：低于 15 次减轻，15～阈值保持，达到阈值加重；excel 低于 15 仍保持', function () {
  var db = GZ.defaults(false), s = slotOf(db, 'A1_5');
  var low = ev(s, { stage: '3×15+', weight: 20, fail: 0 }, { v: 14 });
  assert.strictEqual(low.judgment, '减轻');
  assert.strictEqual(low.nextWeight, 17.5);
  var mid = ev(s, { stage: '3×15+', weight: 20, fail: 0 }, { v: 18 });
  assert.strictEqual(mid.judgment, '保持');
  assert.strictEqual(mid.nextWeight, 20);
  var up = ev(s, { stage: '3×15+', weight: 20, fail: 0 }, { v: 25 });
  assert.strictEqual(up.judgment, '加重');
  assert.strictEqual(up.nextWeight, 22.5);
  var legacy = ev(s, { stage: '3×15+', weight: 20, fail: 0 }, { v: 14 }, { ruleMode: 'excel' });
  assert.strictEqual(legacy.judgment, '保持');
  assert.strictEqual(legacy.nextWeight, 20);
  var bw = ev(slotOf(db, 'A1_4'), { stage: '3×15+', weight: 0, fail: 0 }, { v: 30 });
  assert.notStrictEqual(bw.judgment, '建议负重');
  var curl = db.days[1].slots.filter(function (x) { return x.name === '面拉'; })[0];
  assert.ok(curl);
});

check('回放记住上次完成的 3×10，并在 3×6 失败时用它重置', function () {
  var db = GZ.defaults(false);
  var steps = ['完成', '未完成', '完成', '完成', '未完成', '完成', '未完成'];
  db.records = steps.map(function (v, i) {
    return { id: 't' + i, date: '2026-02-' + String(i + 1).padStart(2, '0'), day: 'A1', createdAt: i + 1,
      entries: { A1_2: { v: v }, A1_1: { v: 3 }, A1_3: { v: '完成' }, A1_4: { v: 20 }, A1_5: { v: 20 } } };
  });
  var rp = GZ.replay(GZ.normalize(db));
  var st = rp.states.A1_2;
  assert.strictEqual(st.stage, '3×10');
  assert.strictEqual(st.weight, 52.5);
  assert.strictEqual(st.last3x10, 52.5);
  var last = rp.sessions[rp.sessions.length - 1].items.filter(function (it) { return it.slotId === 'A1_2'; })[0];
  assert.strictEqual(last.judgment, '重置');
  assert.strictEqual(last.nextWeight, 52.5);
});

check('一轮结束时 3×8 会在新动作上从 3×10 重新开始；关闭轮换则接着练', function () {
  var db = GZ.normalize(GZ.defaults(false));
  db.records = [];
  for (var w = 1; w <= 8; w++) {
    db.records.push({ id: 'rot' + w, date: '2026-03-' + String(w).padStart(2, '0'), day: 'A2', createdAt: w,
      entries: { A2_1: { v: 4 }, A2_2: { v: '完成' }, A2_3: { v: w === 1 ? '未完成' : '完成' }, A2_4: { v: 16 }, A2_5: { v: 16 } } });
  }
  var rp = GZ.replay(db);
  assert.strictEqual(rp.states.A2_3.stage, '3×8');
  assert.ok(rp.states.A2_3.weight > rp.sessions[0].items.filter(function (it) { return it.slotId === 'A2_3'; })[0].weight);
  var s = slotOf(db, 'A2_3');
  var ef = GZ.effectiveSlot(db, s, 9, rp.hist);
  var st = GZ.startState(s, rp.states.A2_3, ef, 9, GZ.progressionOf(db, s));
  assert.strictEqual(ef.slot.name, '单臂哑铃划船');
  assert.strictEqual(ef.resetNow, true);
  assert.strictEqual(st.stage, '3×10');
  db.params.autoRotate = false;
  var rp2 = GZ.replay(db);
  var ef2 = GZ.effectiveSlot(db, s, 9, rp2.hist);
  var st2 = GZ.startState(s, rp2.states.A2_3, ef2, 9, GZ.progressionOf(db, s));
  assert.strictEqual(ef2.slot.name, '坐姿划船');
  assert.strictEqual(st2.stage, '3×8');
});

check('四天都有背部拉动，16 个 T2/T3 不重复，轮换池和槽位一致', function () {
  var db = GZ.normalize(GZ.defaults(false));
  var aux = [], pulls = { A1: 0, B1: 0, A2: 0, B2: 0 }, squatT2 = 0, hingeT2 = 0;
  db.days.forEach(function (d) {
    d.slots.forEach(function (s) {
      var lb = GZ.libFindIn(db, s.name);
      assert.ok(lb, s.name);
      if (s.tier !== 'T1') aux.push(s.name);
      if (lb.part === '上肢·水平拉' || lb.part === '上肢·垂直拉') pulls[d.id] += 1;
      if (s.tier === 'T2' && lb.part === '下肢·蹲') squatT2 += 1;
      if (s.tier === 'T2' && lb.part === '下肢·髋铰链') hingeT2 += 1;
      if (s.tier !== 'T1') {
        var pool = GZ.ROTATION[s.id];
        assert.ok(pool, 'missing rotation ' + s.id);
        assert.strictEqual(pool.pool[0], s.name, s.id + ' pool should start at ' + s.name);
      }
    });
  });
  assert.strictEqual(new Set(aux).size, 16);
  assert.deepStrictEqual(pulls, { A1: 1, B1: 1, A2: 1, B2: 1 });
  assert.strictEqual(squatT2, 1);
  assert.strictEqual(hingeT2, 1);
  assert.strictEqual(slotOf(db, 'A2_3').name, '坐姿划船');
  assert.strictEqual(slotOf(db, 'B2_3').name, '罗马尼亚硬拉');
  for (var c = 1; c <= 3; c++) {
    var plan = GZ.planCycles(db, c).actual[c], seen = {};
    Object.keys(plan).forEach(function (id) {
      assert.ok(!seen[plan[id]], 'cycle ' + c + ' repeats ' + plan[id]);
      seen[plan[id]] = 1;
    });
  }
});

check('旧模板升级：没练过直接换；练过则从下次训练起换', function () {
  var fresh = GZ.defaults(false);
  fresh.daysVersion = 4;
  var s = slotOf(fresh, 'A2_3');
  s.name = '箱式深蹲'; s.equip = '杠铃'; s.step = 't2l'; s.init = { type: 'pct', base: 'squat', pct: 0.65 };
  GZ.normalize(fresh);
  assert.strictEqual(fresh.daysVersion, 5);
  assert.strictEqual(slotOf(fresh, 'A2_3').name, '坐姿划船');

  var used = GZ.defaults(false);
  used.daysVersion = 4;
  var u = slotOf(used, 'A2_3');
  u.name = '箱式深蹲'; u.equip = '杠铃'; u.step = 't2l'; u.init = { type: 'pct', base: 'squat', pct: 0.65 };
  used.records = [{ id: 'old', date: '2026-10-01', day: 'A2', createdAt: 1, entries: { A2_1: { v: 5 } } }];
  GZ.normalize(used);
  assert.strictEqual(slotOf(used, 'A2_3').name, '箱式深蹲');
  assert.strictEqual(slotOf(used, 'A2_3').changes[0].fromWeek, 2);
  assert.strictEqual(slotOf(used, 'A2_3').changes[0].name, '坐姿划船');
});

check('规则文案和训练提示跟引擎一致', function () {
  var text = JSON.stringify(GZ.PROGRESSION_RULES.gzclp);
  assert.ok(text.indexOf('末组 AMRAP ≥ 3') >= 0);
  assert.ok(text.indexOf('留在当前组次') >= 0);
  assert.ok(text.indexOf('减轻一档') >= 0);
  assert.ok(text.indexOf('连续 2 次') < 0);
  assert.ok(text.indexOf('表格公式') < 0);
  assert.ok(GZ.ruleModeNote(P()).indexOf('85%') >= 0);
  assert.ok(GZ.ruleModeNote(P({ ruleMode: 'excel' })).indexOf('3×10') >= 0);
  var db = GZ.normalize(GZ.defaults(false));
  var card = GZ.buildTrain(db, { day: 'A1' }).items.filter(function (it) { return it.slotId === 'A1_1'; })[0];
  assert.ok(card.amrapHint.indexOf('≥3 加重') >= 0);
  assert.ok(card.amrapHint.indexOf('降阶') >= 0);
  var t3 = GZ.buildTrain(db, { day: 'A1' }).items.filter(function (it) { return it.slotId === 'A1_5'; })[0];
  assert.ok(t3.amrapHint.indexOf('减轻') >= 0);
  var pull = GZ.buildTrain(db, { day: 'B1' }).items.filter(function (it) { return it.slotId === 'B1_3'; })[0];
  assert.ok(pull.amrapHint.indexOf('负重') >= 0);
});

if (failed) {
  console.error('\n' + failed + ' failed');
  process.exit(1);
}
console.log('\nall passed');
