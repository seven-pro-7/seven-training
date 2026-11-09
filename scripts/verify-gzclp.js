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
  var db = GZ.defaults(false), s = slotOf(db, 'A1_4');
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
    return { id: 't' + i, date: '2026-02-' + String(i + 1).padStart(2, '0'), day: 'B2', createdAt: i + 1,
      entries: { B2_2: { v: v }, B2_1: { v: 3 }, B2_3: { v: '完成' }, B2_4: { v: 20 }, B2_5: { v: 20 } } };
  });
  var rp = GZ.replay(GZ.normalize(db));
  var st = rp.states.B2_2;
  assert.strictEqual(st.stage, '3×10');
  assert.strictEqual(st.weight, 52.5);
  assert.strictEqual(st.last3x10, 52.5);
  var last = rp.sessions[rp.sessions.length - 1].items.filter(function (it) { return it.slotId === 'B2_2'; })[0];
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
  assert.strictEqual(ef.slot.name, '杠铃划船');
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
  assert.strictEqual(slotOf(db, 'A1_2').name, '罗马尼亚硬拉');
  assert.strictEqual(slotOf(db, 'A1_2').init.type, 'model');
  assert.strictEqual(GZ.initWeight(slotOf(db, 'A1_2'), db.params), GZ.modelWeight(db.params, GZ.libFindIn(db, '罗马尼亚硬拉'), 'T2').weight);
  assert.strictEqual(GZ.initWeight(slotOf(db, 'A1_2'), db.params), 50);
  assert.strictEqual(slotOf(db, 'A1_2').step, 't2l');
  assert.strictEqual(slotOf(db, 'B1_2').name, '上斜哑铃卧推');
  assert.strictEqual(slotOf(db, 'B1_2').init.type, 'model');
  assert.strictEqual(slotOf(db, 'A2_2').name, '坐姿哑铃推肩');
  assert.strictEqual(slotOf(db, 'A2_3').name, '坐姿划船');
  assert.strictEqual(slotOf(db, 'B2_2').name, '前蹲');
  assert.strictEqual(slotOf(db, 'B2_2').init.type, 'model');
  assert.strictEqual(slotOf(db, 'B2_2').step, 't2l');
  assert.strictEqual(slotOf(db, 'B2_3').name, '单臂哑铃划船');
  assert.strictEqual(slotOf(db, 'B2_3').init.type, 'model');
  assert.strictEqual(GZ.initWeight(slotOf(db, 'B2_3'), db.params), 16);
  assert.strictEqual(slotOf(db, 'B2_3').step, 't2u');
  ['A1', 'B1', 'A2', 'B2'].forEach(function (id) {
    var day = db.days.filter(function (d) { return d.id === id; })[0];
    var t1 = day.slots[0], t2 = day.slots[1];
    var p1 = GZ.libFindIn(db, t1.name).part, p2 = GZ.libFindIn(db, t2.name).part;
    assert.notStrictEqual(p1, p2, id + ' stacks ' + p1);
  });
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
  assert.strictEqual(fresh.daysVersion, 8);
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

function putSlot(db, id, fields) {
  var s = slotOf(db, id);
  Object.keys(fields).forEach(function (k) {
    if (fields[k] === undefined) delete s[k];
    else s[k] = fields[k];
  });
  return s;
}
function sess(id, date, day, entries) {
  return { id: id, date: date, day: day, createdAt: Date.parse(date), entries: entries };
}

check('模板 changes 不再挡住升级，两周历史照旧，第 3 周按统一编排', function () {
  var db = GZ.defaults(false);
  db.daysVersion = 5;
  db.cfgAt = 1000;
  db.params.oneRM.bench = 80;
  db.params.adaptive = true;
  db.params.ruleMode = 'full';
  putSlot(db, 'A1_1', { init: { type: 'fixed', value: 62.5 } });
  putSlot(db, 'A1_2', { name: '前蹲', equip: '杠铃', tier: 'T2', step: 't2l', init: { type: 'fixed', value: 37.5 }, lift: null });
  putSlot(db, 'A1_3', { name: '上斜卧推', equip: '杠铃', tier: 'T2', step: 't2u', init: { type: 'pct', base: 'bench', pct: 0.55 },
    changes: [{ fromWeek: 3, name: '高位下拉', equip: '器械', weight: 50, tier: 'T2', step: 't2u' }] });
  putSlot(db, 'A1_4', { name: '高位下拉', equip: '器械', tier: 'T3', step: 't3u', init: { type: 'fixed', value: 30 }, roundProg: true,
    changes: [{ fromWeek: 3, name: '坐姿腿屈伸', equip: '器械', weight: 25, tier: 'T3', step: 't3l' }] });
  putSlot(db, 'A1_5', { name: '俯卧腿弯举', equip: '器械', tier: 'T3', step: 't3l', init: { type: 'fixed', value: 10 }, roundProg: false });
  putSlot(db, 'B1_1', { init: { type: 'fixed', value: 30 } });
  putSlot(db, 'B1_2', { name: '坐姿哑铃推肩', equip: '哑铃', tier: 'T2', step: 't2u', init: { type: 'fixed', value: 22.5 } });
  putSlot(db, 'B1_3', { name: '罗马尼亚硬拉', equip: '杠铃', tier: 'T2', step: 't2l', init: { type: 'pct', base: 'deadlift', pct: 0.6 },
    changes: [{ fromWeek: 2, name: '引体向上', equip: '自重', weight: 0, tier: 'T2', step: 't2u' }] });
  putSlot(db, 'B1_4', { name: '引体向上', equip: '自重', tier: 'T3', step: 't3u', init: { type: 'fixed', value: 0 }, roundProg: true,
    changes: [{ fromWeek: 2, name: '面拉', equip: '器械', weight: 15, tier: 'T3', step: 't3u' }] });
  putSlot(db, 'B1_5', { name: '哑铃侧平举', equip: '哑铃', tier: 'T3', step: 't3u', init: { type: 'fixed', value: 8 }, roundProg: true });
  putSlot(db, 'A2_1', { init: { type: 'fixed', value: 62.5 } });
  putSlot(db, 'A2_2', { name: '窄距卧推', equip: '杠铃', tier: 'T2', step: 't2u', init: { type: 'fixed', value: 40 } });
  putSlot(db, 'A2_3', { name: '杠铃深蹲', equip: '杠铃', tier: 'T2', step: 't2l', init: { type: 'pct', base: 'squat', pct: 0.7 },
    changes: [{ fromWeek: 2, name: '箱式深蹲', equip: '杠铃', weight: 40 }] });
  putSlot(db, 'A2_4', { name: '杠铃弯举', equip: '杠铃', tier: 'T3', step: 't3u', init: { type: 'fixed', value: 20 }, roundProg: true });
  putSlot(db, 'A2_5', { name: '绳索三头屈伸', equip: '器械', tier: 'T3', step: 't3u', init: { type: 'fixed', value: 10 }, roundProg: true });
  putSlot(db, 'B2_1', { init: { type: 'fixed', value: 87.5 } });
  putSlot(db, 'B2_2', { name: '潘德雷划船', equip: '杠铃', tier: 'T2', step: 't2u', init: { type: 'fixed', value: 50 }, lift: null });
  putSlot(db, 'B2_3', { name: '坐姿划船', equip: '器械', tier: 'T2', step: 't2u', init: { type: 'fixed', value: 35 },
    changes: [{ fromWeek: 2, name: '罗马尼亚硬拉', equip: '杠铃', weight: 60, tier: 'T2', step: 't2l' }] });
  putSlot(db, 'B2_4', { name: '面拉', equip: '器械', tier: 'T3', step: 't3u', init: { type: 'fixed', value: 15 }, roundProg: true,
    changes: [{ fromWeek: 2, name: '坐姿腿弯举', equip: '器械', weight: 25, tier: 'T3', step: 't3l' }] });
  putSlot(db, 'B2_5', { init: { type: 'fixed', value: 8 } });
  db.records = [
    sess('a1w1', '2026-10-13', 'A1', { A1_1: { v: 3 }, A1_2: { v: '完成' }, A1_3: { v: '完成' } }),
    sess('b1w1', '2026-10-14', 'B1', { B1_1: { v: 3 }, B1_2: { v: '未完成' }, B1_3: { v: '完成' }, B1_5: { v: '完成', w: 35, ex: '上斜哑铃卧推' } }),
    sess('a2w1', '2026-10-15', 'A2', { A2_1: { v: 3 }, A2_2: { v: '完成' }, A2_3: { v: '完成' } }),
    sess('b2w1', '2026-10-16', 'B2', { B2_1: { v: 3 }, B2_2: { v: '完成' }, B2_3: { v: '完成' }, B2_5: { v: 25 } }),
    sess('a1w2', '2026-10-20', 'A1', { A1_1: { v: 3 }, A1_2: { v: '完成' }, A1_3: { v: '完成' } }),
    sess('b1w2', '2026-10-21', 'B1', { B1_1: { v: 3 }, B1_2: { v: '未完成' }, B1_3: { v: '完成' }, B1_4: { v: 25 } }),
    sess('a2w2', '2026-10-22', 'A2', { A2_1: { v: 3 }, A2_2: { v: '完成' }, A2_3: { v: '完成' } }),
    sess('b2w2', '2026-10-23', 'B2', { B2_1: { v: 3 }, B2_2: { v: '完成' }, B2_3: { v: '完成' }, B2_5: { v: 18 } })
  ];
  var before = GZ.replay(db).sessions.map(function (s) {
    return s.week + ' ' + s.rec.day + ' ' + s.items.map(function (it) { return it.name; }).join('/');
  });
  var pausedDays = JSON.parse(JSON.stringify(db.days));
  var otherDays = [{ id: 'X', name: '保持不动', slots: [{ id: 'X1', name: '跑步机匀速', tier: 'C' }] }];
  db.programs = [
    { id: 'p-gzclp-1', template: 'gzclp-8w', name: 'GZCLP', progression: 'gzclp', status: 'active', snap: null },
    { id: 'paused-gz', template: 'gzclp-8w', name: '暂停', progression: 'gzclp', status: 'paused', snap: { days: pausedDays, daysVersion: 5, params: {} } },
    { id: 'other', template: 'ppl', name: '其他', progression: 'dual', status: 'paused', snap: { days: otherDays, daysVersion: 1, params: {} } }
  ];
  db.activeProgramId = 'p-gzclp-1';
  GZ.normalize(db);
  assert.strictEqual(db.daysVersion, 8);
  assert.ok(db.cfgAt > 1000);
  var after = GZ.replay(db).sessions.filter(function (s) { return s.week <= 2; }).map(function (s) {
    return s.week + ' ' + s.rec.day + ' ' + s.items.map(function (it) { return it.name; }).join('/');
  });
  assert.deepStrictEqual(after, before);
  assert.strictEqual(slotOf(db, 'A2_3').name, '杠铃深蹲');
  assert.strictEqual(slotOf(db, 'A2_3').step, 't2l');
  assert.strictEqual(slotOf(db, 'A2_3').changes[0].name, '箱式深蹲');
  assert.strictEqual(slotOf(db, 'A2_3').changes[0].fromWeek, 2);
  assert.strictEqual(slotOf(db, 'A2_3').changes[1].name, '坐姿划船');
  assert.strictEqual(slotOf(db, 'A2_3').changes[1].fromWeek, 3);
  assert.strictEqual(slotOf(db, 'A2_3').changes[1].weight, 35);
  assert.strictEqual(slotOf(db, 'A2_3').changes[1].tpl, true);
  assert.strictEqual(slotOf(db, 'A1_2').name, '前蹲');
  assert.strictEqual(slotOf(db, 'A1_2').changes[0].name, '罗马尼亚硬拉');
  assert.strictEqual(slotOf(db, 'A1_2').changes[0].weight, 65);
  assert.strictEqual(slotOf(db, 'B2_2').name, '潘德雷划船');
  assert.strictEqual(slotOf(db, 'B2_2').changes[0].name, '前蹲');
  assert.strictEqual(slotOf(db, 'B2_2').changes[0].weight, 47.5);
  assert.strictEqual(slotOf(db, 'B2_3').name, '坐姿划船');
  assert.strictEqual(slotOf(db, 'B2_3').changes.filter(function (c) { return c.fromWeek === 2; })[0].name, '罗马尼亚硬拉');
  assert.strictEqual(slotOf(db, 'B2_3').changes.filter(function (c) { return c.fromWeek === 3; })[0].name, '单臂哑铃划船');
  assert.notStrictEqual(slotOf(db, 'B2_3').changes.filter(function (c) { return c.fromWeek === 3; })[0].weight, 35);
  var expect = {
    A1: [['杠铃深蹲', 72.5], ['罗马尼亚硬拉', 65], ['高位下拉', 50], ['坐姿腿屈伸', 25], ['哑铃侧平举', 6]],
    B1: [['站姿实力推', 35], ['上斜哑铃卧推', 16], ['引体向上', 0], ['绳索夹胸', 5], ['面拉', 17.5]],
    A2: [['平板卧推', 67.5], ['坐姿哑铃推肩', 22.5], ['坐姿划船', 35], ['绳索三头屈伸', 10], ['杠铃弯举', 20]],
    B2: [['传统硬拉', 97.5], ['前蹲', 47.5], ['单臂哑铃划船', 18], ['坐姿腿弯举', 25], ['哑铃弯举', 9]]
  };
  var plan = GZ.buildPlan(db);
  Object.keys(expect).forEach(function (day) {
    var train = GZ.buildTrain(db, { day: day }).items.map(function (it) { return [it.name, it.weight]; });
    assert.deepStrictEqual(train, expect[day], day + ' train ' + JSON.stringify(train));
    var ov = plan.overview.filter(function (d) { return d.day === day; })[0].slots.map(function (s) { return [s.name, s.weight]; });
    var ovExp = expect[day].map(function (x) { return [x[0], String(x[1])]; });
    assert.deepStrictEqual(ov, ovExp, day + ' plan ' + JSON.stringify(ov));
  });
  var paused = db.programs.filter(function (p) { return p.id === 'paused-gz'; })[0];
  assert.strictEqual(paused.snap.daysVersion, 8);
  var pausedA2 = null;
  paused.snap.days.forEach(function (d) { d.slots.forEach(function (s) { if (s.id === 'A2_3') pausedA2 = s; }); });
  assert.strictEqual(pausedA2.name, '坐姿划船');
  var other = db.programs.filter(function (p) { return p.id === 'other'; })[0];
  assert.strictEqual(other.snap.daysVersion, 1);
  assert.strictEqual(other.snap.days[0].name, '保持不动');
  var keep = slotOf(db, 'A2_3').changes.length;
  db.daysVersion = 5;
  GZ.normalize(db);
  assert.strictEqual(slotOf(db, 'A2_3').changes.length, keep);
  assert.strictEqual(GZ.buildTrain(db, { day: 'A2' }).items[2].name, '坐姿划船');
});

check('升级后的 daysVersion 会被认成新配置，同步不能把它和旧文件看成同一份', function () {
  var old = GZ.defaults(false);
  old.daysVersion = 5;
  old.cfgAt = 50;
  var rawRemote = JSON.parse(JSON.stringify(old));
  var remoteVer = rawRemote.daysVersion;
  var remote = GZ.normalize(rawRemote);
  var rawLocal = JSON.parse(JSON.stringify(old));
  var localVer = rawLocal.daysVersion;
  var local = GZ.normalize(rawLocal);
  assert.notStrictEqual(remoteVer, remote.daysVersion);
  assert.notStrictEqual(localVer, local.daysVersion);
  assert.strictEqual(remote.daysVersion, 8);
  assert.ok(remote.cfgAt > 50 && local.cfgAt > 50);
  var merged = GZ.mergeDb(local, remote);
  assert.strictEqual(merged.daysVersion, 8);
  assert.strictEqual(slotOf(merged, 'B2_2').name, '前蹲');
});

check('一次性替换的重量不会变成新模板槽位的起点', function () {
  var db = GZ.defaults(false);
  db.daysVersion = 6;
  function rename(id, name, init, step) {
    var s = slotOf(db, id), lb = GZ.libFindIn(db, name);
    s.name = name; s.equip = lb.equip; s.init = init; s.step = step; delete s.changes;
  }
  rename('A1_2', '前蹲', { type: 'pct', base: 'squat', pct: 0.6 }, 't2l');
  rename('A1_5', '俯卧腿弯举', { type: 'pct', base: 'squat', pct: 0.3 }, 't3l');
  rename('B1_2', '坐姿哑铃推肩', { type: 'pct', base: 'ohp', pct: 0.6 }, 't2u');
  rename('B1_4', '面拉', { type: 'fixed', value: 15 }, 't3u');
  rename('B1_5', '哑铃侧平举', { type: 'fixed', value: 8 }, 't3u');
  rename('A2_2', '窄距卧推', { type: 'pct', base: 'bench', pct: 0.65 }, 't2u');
  rename('A2_4', '杠铃弯举', { type: 'fixed', value: 20 }, 't3u');
  rename('A2_5', '绳索三头屈伸', { type: 'pct', base: 'bench', pct: 0.25 }, 't3u');
  rename('B2_2', '罗马尼亚硬拉', { type: 'pct', base: 'deadlift', pct: 0.6 }, 't2l');
  rename('B2_3', '潘德雷划船', { type: 'pct', base: 'deadlift', pct: 0.55 }, 't2u');
  db.records = [{ id: 'rmvaj5j6l5hq3', date: '2026-10-16', day: 'B2', deload: false, createdAt: 4,
    entries: { B2_1: { v: 11 }, B2_2: { v: '完成' }, B2_3: { v: '完成', w: 35, ex: '上斜哑铃卧推' }, B2_4: { v: 25 }, B2_5: { v: 25, w: 6 } } }];
  GZ.normalize(db);
  var fresh = GZ.buildTrain(GZ.defaults(false), { day: 'B1' }).items.filter(function (it) { return it.slotId === 'B1_2'; })[0];
  var incline = GZ.buildTrain(db, { day: 'B1' }).items.filter(function (it) { return it.slotId === 'B1_2'; })[0];
  var row = slotOf(db, 'B2_3').changes.filter(function (c) { return c.fromWeek === 2; })[0];
  assert.strictEqual(incline.name, '上斜哑铃卧推');
  assert.strictEqual(incline.weight, fresh.weight);
  assert.strictEqual(fresh.weight, 14);
  assert.notStrictEqual(incline.weight, 35);
  assert.strictEqual(row.name, '单臂哑铃划船');
  assert.strictEqual(row.weight, 16);
  assert.notStrictEqual(row.weight, 35);
  var fly = GZ.buildTrain(db, { day: 'B1' }).items.filter(function (it) { return it.slotId === 'B1_4'; })[0];
  assert.strictEqual(fly.name, '绳索夹胸');
  assert.strictEqual(fly.weight, 5);
  assert.strictEqual(GZ.buildTrain(db, { day: 'A1' }).items.filter(function (it) { return it.slotId === 'A1_2'; })[0].name, '罗马尼亚硬拉');
});

check('手动更换不因模板升级被盖掉', function () {
  var db = GZ.defaults(false);
  db.daysVersion = 5;
  var s = slotOf(db, 'A1_2');
  s.changes = [{ fromWeek: 2, name: '泽奇深蹲', equip: '杠铃', weight: 40 }];
  db.records = [sess('a1', '2026-10-13', 'A1', { A1_1: { v: 5 } }), sess('a1b', '2026-10-20', 'A1', { A1_1: { v: 5 } })];
  GZ.normalize(db);
  var ef = GZ.effectiveSlot(db, slotOf(db, 'A1_2'), 3, null);
  assert.strictEqual(ef.slot.name, '泽奇深蹲');
  assert.ok(!(slotOf(db, 'A1_2').changes || []).some(function (c) { return c.tpl && c.name === '前蹲'; }));
});

check('哑铃容量按单只 ×2，高脚杯不翻倍；自重看当次体重；T2 没填次数不计容量', function () {
  var db = GZ.defaults(false);
  var incline = ev(slotOf(db, 'B1_2'), { stage: '3×10', weight: 20, fail: 0, last3x10: 20 }, { v: '完成' });
  assert.strictEqual(incline.volume, 1200);
  assert.strictEqual(incline.loadFactor, 2);
  var row = ev(slotOf(db, 'B2_3'), { stage: '3×10', weight: 20, fail: 0, last3x10: 20 }, { v: '完成' });
  assert.strictEqual(row.volume, 1200);
  assert.strictEqual(row.loadFactor, 2);
  var goblet = ev({ id: 'x', tier: 'T2', name: '高脚杯深蹲', equip: '哑铃', step: 't2l' }, { stage: '3×10', weight: 24, fail: 0, last3x10: 24 }, { v: '完成' });
  assert.strictEqual(goblet.volume, 720);
  assert.strictEqual(goblet.loadFactor, 1);
  var bar = ev(slotOf(db, 'A1_2'), { stage: '3×10', weight: 40, fail: 0, last3x10: 40 }, { v: '完成' });
  assert.strictEqual(bar.volume, 1200);
  var miss = ev(slotOf(db, 'A1_2'), { stage: '3×10', weight: 40, fail: 0, last3x10: 40 }, { v: '未完成' });
  assert.strictEqual(miss.volume, 0);
  assert.strictEqual(miss.actualReps, null);
  var some = ev(slotOf(db, 'A1_2'), { stage: '3×10', weight: 40, fail: 0, last3x10: 40 }, { v: '未完成', reps: 22 });
  assert.strictEqual(some.volume, 880);
  db.records = [{ id: 'bw1', date: '2026-10-01', day: 'B1', bw: 75, createdAt: 1, entries: { B1_1: { v: 3 }, B1_3: { v: '完成' } } }];
  var withBw = GZ.replay(GZ.normalize(db)).sessions[0].items.filter(function (it) { return it.slotId === 'B1_3'; })[0];
  assert.strictEqual(withBw.name, '引体向上');
  assert.strictEqual(withBw.volume, 2250);
  assert.strictEqual(withBw.bodyweightUsed, true);
  var bwLine = GZ.logView(GZ.replay(db).sessions[0], db.params).items.filter(function (it) { return it.slotId === 'B1_3'; })[0];
  assert.ok(bwLine.detail.indexOf('自重') === 0, bwLine.detail);
  assert.ok(bwLine.detail.indexOf('0 ×') < 0, bwLine.detail);
  assert.ok(bwLine.detail.indexOf('容量 2250 kg') >= 0, bwLine.detail);
  assert.ok(bwLine.next.indexOf('0 kg') < 0, bwLine.next);
  var sideDb = GZ.defaults(false);
  sideDb.records = [{ id: 'db1', date: '2026-10-02', day: 'B2', createdAt: 1, entries: { B2_1: { v: 3 }, B2_3: { v: '完成', w: 20 } } }];
  var side = GZ.logView(GZ.replay(GZ.normalize(sideDb)).sessions[0], sideDb.params).items.filter(function (it) { return it.slotId === 'B2_3'; })[0];
  assert.strictEqual(side.name, '单臂哑铃划船');
  assert.ok(side.detail.indexOf('kg 单只') >= 0 && side.detail.indexOf('两侧') >= 0, side.detail);
  assert.ok(side.detail.indexOf('容量 1200 kg') >= 0, side.detail);
  assert.ok(side.next.indexOf('kg 单只') >= 0, side.next);
  db.records[0].bw = null;
  var noBw = GZ.replay(GZ.normalize(db)).sessions[0].items.filter(function (it) { return it.slotId === 'B1_3'; })[0];
  assert.strictEqual(noBw.volume, 0);
  assert.notStrictEqual(noBw.bodyweightUsed, true);
});

check('第 1 周样例按当时的动作回放，不把旧重量写成新槽位的手动重量', function () {
  var seeded = GZ.normalize(GZ.defaults(true));
  var fresh = GZ.normalize(GZ.defaults(false));
  // 这些槽位在第 1 周样例里练的是另一个动作。下次重量必须仍是新模板的起点。
  ['A1_2', 'A1_3', 'A1_4', 'A1_5', 'B1_2', 'B1_3', 'B1_4', 'B1_5', 'A2_2', 'A2_3', 'A2_4', 'A2_5', 'B2_2', 'B2_3', 'B2_4'].forEach(function (id) {
    function pick(db) {
      var day = id.split('_')[0];
      return GZ.buildTrain(db, { day: day }).items.filter(function (it) { return it.slotId === id; })[0];
    }
    var got = pick(seeded), base = pick(fresh);
    assert.strictEqual(got.name, base.name, id);
    assert.strictEqual(got.weight, base.weight, id + ' ' + got.weight + ' vs ' + base.weight);
  });
  var curl = GZ.buildTrain(seeded, { day: 'B2' }).items.filter(function (it) { return it.slotId === 'B2_5'; })[0];
  assert.strictEqual(curl.name, '哑铃弯举');
  assert.notStrictEqual(curl.weight, 6);
  var logs = GZ.buildReview(seeded).logs;
  var a1 = logs.filter(function (l) { return l.id === 'xls_A1_w1'; })[0];
  assert.strictEqual(a1.weekText, '第 1 周');
  assert.ok(a1.weekText.indexOf('次') < 0);
  assert.strictEqual(a1.items[1].name, '泽奇深蹲');
  assert.ok(a1.items[1].context.indexOf('前蹲') >= 0);
  assert.ok(a1.items[1].context.indexOf('替换') >= 0);
  assert.notStrictEqual(a1.items[1].name, '罗马尼亚硬拉');
  assert.strictEqual(a1.items[3].name, '高位下拉');
  assert.ok(a1.items[3].detail.indexOf('50 kg') >= 0);
  assert.ok(a1.items[3].detail.indexOf('3×15+') >= 0);
  assert.ok(a1.items[3].detail.indexOf('末组 15 次') >= 0);
  assert.ok(a1.items[3].context.indexOf('手动') >= 0);
  assert.notStrictEqual(a1.items[3].name, '坐姿腿屈伸');
  assert.strictEqual(a1.items[0].detail.indexOf(' × '), -1);
  var b1 = logs.filter(function (l) { return l.id === 'xls_B1_w1'; })[0];
  assert.strictEqual(b1.items[2].name, '罗马尼亚硬拉');
  assert.ok(b1.items[2].detail.indexOf('自重') < 0);
  var pull = logs.filter(function (l) { return l.id === 'xls_B1_w1'; })[0].items[3];
  assert.strictEqual(pull.name, '俯身划船');
  assert.ok(pull.context.indexOf('引体向上') >= 0);
  var dbBw = GZ.normalize(GZ.defaults(true));
  dbBw.records.forEach(function (r) { if (r.id === 'xls_B1_w1') r.bw = 70; });
  var bwPull = GZ.buildReview(dbBw).logs.filter(function (l) { return l.id === 'xls_B1_w1'; })[0];
  assert.ok(bwPull.items.some(function (it) { return it.detail.indexOf('kg 单只') >= 0 && it.detail.indexOf('双手') >= 0; }));
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

check('零记录动作仍返回同一份趋势详情', function () {
  var Insight = require('../source/utils/insight.js');
  var db = GZ.normalize(GZ.defaults(true));
  var squat = Insight.detail(db, '杠铃深蹲');
  assert.ok(squat && squat.n > 0);
  assert.ok(squat.bestWeight && squat.series.labels.length === squat.n);
  assert.strictEqual(squat.sessions.length, squat.n);
  assert.strictEqual(GZ.exerciseDetail, Insight.detail);
  var row = Insight.detail(db, '单臂哑铃划船');
  assert.ok(row);
  assert.strictEqual(row.n, 0);
  assert.strictEqual(row.bestE1rm, null);
  assert.strictEqual(row.bestWeight, null);
  assert.strictEqual(row.bestVolume, null);
  assert.strictEqual(row.delta, null);
  assert.strictEqual(row.slope, null);
  assert.strictEqual(row.r2, null);
  assert.deepStrictEqual(row.sessions, []);
  assert.deepStrictEqual(row.labels, []);
  assert.deepStrictEqual(row.weights, []);
  assert.deepStrictEqual(row.e1rms, []);
  assert.deepStrictEqual(row.volumes, []);
  assert.ok(row.tiers.indexOf('T2') >= 0);
  assert.strictEqual(row.bw, false);
  assert.strictEqual(row.isCardio, false);
  assert.ok(row.series.byTier.T2);
  assert.strictEqual(Insight.detail(db, ''), null);
  assert.strictEqual(GZ.exerciseDetail(db, '单臂哑铃划船').n, 0);
});

check('个人基线：瀑布、回写、播种、旧客户端合并', function () {
  var db = GZ.normalize(GZ.defaults(false));
  assert.deepStrictEqual(db.exerciseBaselines, {});
  var model = GZ.recommendWeight(db, '平板卧推', 'T1', { preferLast: false });
  assert.strictEqual(model.source, 'model');
  assert.strictEqual(model.sourceLabel, '公式');
  var cardio = GZ.recommendWeight(db, '跑步机坡走', 'T3');
  assert.strictEqual(cardio.source, 'cardio');
  var bw = GZ.recommendWeight(db, '引体向上', 'T2');
  assert.strictEqual(bw.source, 'bodyweight');
  assert.ok(GZ.setBaseline(db, '引体向上', 10).error);
  assert.ok(GZ.setBaseline(db, '跑步机坡走', 10).error);

  GZ.setBaseline(db, '平板卧推', 82.5, { source: 'manual', date: '2026-10-01' });
  var base = GZ.recommendWeight(db, '平板卧推', 'T1', { preferLast: false });
  assert.strictEqual(base.source, 'baseline');
  assert.strictEqual(base.sourceLabel, '个人基线');
  assert.strictEqual(base.weight, 82.5);

  GZ.saveRecord(db, { date: '2026-10-20', day: 'A2', entries: { A2_1: { v: 5, w: 70 } } });
  assert.strictEqual(db.exerciseBaselines['平板卧推'].lastWeight, 70);
  assert.strictEqual(db.exerciseBaselines['平板卧推'].source, 'trained');
  assert.strictEqual(db.exerciseBaselines['平板卧推'].lastTier, 'T1');
  assert.strictEqual(db.exerciseBaselines['平板卧推'].lastDate, '2026-10-20');
  var last = GZ.recommendWeight(db, '平板卧推', 'T1', { preferLast: true });
  assert.strictEqual(last.source, 'last');
  assert.strictEqual(last.sourceLabel, '上次');
  assert.strictEqual(last.weight, 70);
  var seeded = GZ.recommendWeight(db, '平板卧推', 'T1', { preferLast: false });
  assert.strictEqual(seeded.source, 'baseline');
  assert.strictEqual(seeded.weight, 70);

  GZ.saveRecord(db, { date: '2026-10-02', day: 'A2', entries: { A2_1: { v: 3, w: 40 } } });
  assert.strictEqual(db.exerciseBaselines['平板卧推'].lastWeight, 70);
  GZ.saveRecord(db, { date: '2026-11-01', day: 'A2', deload: true, entries: { A2_1: { v: 5, w: 90 } } });
  assert.strictEqual(db.exerciseBaselines['平板卧推'].lastWeight, 70);
  GZ.saveRecord(db, { date: '2026-11-02', day: 'A2', entries: { A2_5: { v: 12, skip: true, w: 30 } } });
  assert.ok(!db.exerciseBaselines['杠铃弯举']);
  GZ.saveRecord(db, { date: '2026-11-02', day: 'B1', entries: { B1_3: { v: 8 } } });
  assert.ok(!db.exerciseBaselines['引体向上']);

  var phul = GZ.templateDef(db, 'phul');
  var bench = null;
  phul.days.forEach(function (d) { d.slots.forEach(function (s) { if (s.name === '平板卧推') bench = s; }); });
  assert.ok(bench);
  assert.strictEqual(bench.init.value, 70);
  GZ.startProgram(db, phul);
  var card = GZ.buildTrain(db).items.filter(function (it) { return it.name === '平板卧推'; })[0];
  assert.ok(card);
  assert.strictEqual(card.weight, 70);
  assert.strictEqual(card.recSourceLabel, '个人基线');

  db.exerciseBaselines['卷腹'] = { lastWeight: 20, lastTier: 'T3', equip: '自重', source: 'trained', lastDate: '2026-10-01', updatedAt: 1 };
  db = GZ.normalize(db);
  assert.ok(!db.exerciseBaselines['卷腹']);
  assert.strictEqual(db.exerciseBaselines['平板卧推'].lastWeight, 70);

  var old = JSON.parse(JSON.stringify(db));
  delete old.exerciseBaselines;
  old.cfgAt = (db.cfgAt || 0) + 10;
  old.params.bodyWeight = 71;
  var merged = GZ.mergeDb(db, old);
  assert.strictEqual(merged.exerciseBaselines['平板卧推'].lastWeight, 70);
  assert.strictEqual(merged.params.bodyWeight, 71);
  assert.ok(GZ.cfgPart(db).indexOf('平板卧推') >= 0);
});

check('个人基线不改 GZCLP 模型周，非 GZCLP 播种仍先用基线', function () {
  var db = GZ.normalize(GZ.defaults(false));
  GZ.saveRecord(db, { date: '2026-10-20', day: 'A2', entries: { A2_1: { v: 5, w: 60 } } });
  assert.strictEqual(db.exerciseBaselines['平板卧推'].lastWeight, 60);
  GZ.setBaseline(db, '平板卧推', 82.5, { source: 'manual', date: '2026-10-21' });
  var last = GZ.recommendWeight(db, '平板卧推', 'T1', { preferLast: true });
  assert.strictEqual(last.source, 'last');
  assert.strictEqual(last.weight, 60);
  var seeded = GZ.recommendWeight(db, '平板卧推', 'T1', { preferLast: false });
  assert.strictEqual(seeded.source, 'baseline');
  assert.strictEqual(seeded.weight, 82.5);
  var benchNow = GZ.buildTrain(db, { day: 'A2' }).items.filter(function (it) { return it.name === '平板卧推'; })[0];
  assert.notStrictEqual(benchNow.weight, 82.5);

  GZ.setBaseline(db, '罗马尼亚硬拉', 90, { source: 'manual', date: '2026-10-21' });
  GZ.setBaseline(db, '哑铃侧平举', 12, { source: 'manual', date: '2026-10-21' });
  var gz = GZ.templateDef(db, 'gzclp');
  gz.days.forEach(function (d) {
    d.slots.forEach(function (s) {
      if (s.tier === 'T1') {
        assert.strictEqual(s.init.type, 'pct', s.id);
        return;
      }
      assert.strictEqual(s.init.type, 'model', s.id);
      assert.strictEqual(GZ.initWeight(s, db.params), GZ.modelWeight(db.params, GZ.libFindIn(db, s.name), s.tier).weight, s.name);
    });
  });
  var rdl = GZ.buildTrain(db, { day: 'A1' }).items.filter(function (it) { return it.name === '罗马尼亚硬拉'; })[0];
  var rdlModel = GZ.modelWeight(db.params, GZ.libFindIn(db, '罗马尼亚硬拉'), 'T2').weight;
  assert.strictEqual(rdl.weight, rdlModel);
  assert.notStrictEqual(rdl.weight, 90);
  assert.strictEqual(rdl.recSourceLabel, '');

  var phul = GZ.templateDef(db, 'phul');
  var bench = null, incline = null;
  phul.days.forEach(function (d) { d.slots.forEach(function (s) {
    if (s.name === '平板卧推' && s.tier === 'T1') bench = s;
    if (s.name === '上斜哑铃卧推') incline = s;
  }); });
  assert.strictEqual(bench.init.value, 82.5);
  assert.strictEqual(incline.init.value, GZ.modelWeight(db.params, GZ.libFindIn(db, '上斜哑铃卧推'), 'T2').weight);

  GZ.setBaseline(db, '站姿实力推', 40, { source: 'manual', date: '2026-10-21' });
  GZ.setBaseline(db, '高位下拉', 55, { source: 'manual', date: '2026-10-21' });
  var five = GZ.templateDef(db, '531');
  var ohp = five.days[0].slots[0];
  var lat = five.days[0].slots.filter(function (s) { return s.name === '高位下拉'; })[0];
  assert.strictEqual(ohp.name, '站姿实力推');
  assert.strictEqual(ohp.init.value, 25);
  assert.notStrictEqual(ohp.init.value, 40);
  assert.strictEqual(lat.init.value, 55);

  GZ.startProgram(db, phul);
  var card = GZ.buildTrain(db).items.filter(function (it) { return it.name === '平板卧推'; })[0];
  assert.ok(card);
  assert.strictEqual(card.weight, 82.5);
  assert.strictEqual(card.recSourceLabel, '个人基线');
});

check('进行中的训练：空白草稿不算已填写', function () {
  var db = GZ.normalize(GZ.defaults(false));
  var blank = GZ.packOpenSession({ day: 'A1', draft: GZ.blankDraft(db, 'A1'), drafts: {}, date: GZ.today(), bw: '', note: '' });
  assert.strictEqual(GZ.sessionTouched(blank), false);
  assert.strictEqual(GZ.applyOpenSession({}, blank), false);
});

check('进行中的训练：次数、体重、备注、非今天的日期都会保留', function () {
  var t = { day: 'A1', draft: { A1_1: { v: 5, done: 1 } }, drafts: {}, date: GZ.today(), bw: '', note: '' };
  var snap = GZ.packOpenSession(t);
  assert.strictEqual(GZ.sessionTouched(snap), true);
  var back = {};
  assert.strictEqual(GZ.applyOpenSession(back, snap), true);
  assert.strictEqual(back.day, 'A1');
  assert.strictEqual(back.draft.A1_1.v, 5);
  assert.strictEqual(back.draft.A1_1.done, 1);
  assert.notStrictEqual(back.draft, t.draft);
  assert.strictEqual(GZ.sessionTouched(GZ.packOpenSession({ day: 'A1', draft: { A1_1: { v: 0, done: 0 } }, date: GZ.today() })), true);
  assert.strictEqual(GZ.sessionTouched({ bw: '70', date: GZ.today(), drafts: {} }), true);
  assert.strictEqual(GZ.sessionTouched({ note: '睡得少', date: GZ.today(), drafts: {} }), true);
  assert.strictEqual(GZ.sessionTouched({ date: '2000-01-01', drafts: {} }), true);
  assert.strictEqual(GZ.sessionTouched({ recordId: 'abc', date: GZ.today(), drafts: {} }), true);
  assert.strictEqual(GZ.sessionTouched({ deload: true, date: GZ.today(), drafts: {} }), true);
});

check('进行中的训练：本机和备份里留较新的一份', function () {
  var older = { day: 'A1', drafts: { A1: { A1_1: { v: 3, done: 0 } } }, date: GZ.today(), savedAt: 10 };
  var newer = { day: 'B1', drafts: { B1: { B1_1: { v: 8, done: 0 } } }, date: GZ.today(), savedAt: 20 };
  assert.strictEqual(GZ.pickOpenSession(older, newer).day, 'B1');
  assert.strictEqual(GZ.pickOpenSession(newer, null).day, 'B1');
  assert.strictEqual(GZ.pickOpenSession(null, { date: GZ.today(), drafts: {} }), null);
});

check('启动不把空档案写到已有数据上', function () {
  var full = GZ.normalize(GZ.defaults(false));
  full.records = [{ id: 'r1', date: '2026-10-01', day: 'A1', entries: {}, createdAt: 50, updatedAt: 50 }];
  var empty = GZ.normalize(GZ.defaults(false));
  assert.ok(GZ.dbStamp(full) > GZ.dbStamp(empty));
  assert.strictEqual(GZ.pickStoredDb(empty, full), full);
  assert.strictEqual(GZ.pickStoredDb(full, empty), full);
  var missing = GZ.storageDecision('missing', null, null);
  assert.strictEqual(missing.writeDefault, true);
  assert.strictEqual(missing.db, null);
  var wiped = GZ.storageDecision('missing', null, full);
  assert.strictEqual(wiped.writeDefault, false);
  assert.strictEqual(wiped.writeBack, true);
  assert.strictEqual(wiped.db, full);
  var unreadable = GZ.storageDecision('error', null, full);
  assert.strictEqual(unreadable.writeDefault, false);
  assert.strictEqual(unreadable.writeBack, true);
  var corruptOnly = GZ.storageDecision('corrupt', null, null);
  assert.strictEqual(corruptOnly.writeDefault, false);
  assert.strictEqual(corruptOnly.db, null);
  var keepLocal = GZ.storageDecision('ok', full, empty);
  assert.strictEqual(keepLocal.writeBack, false);
  assert.strictEqual(keepLocal.db, full);
  GZ.deleteRecord(full, 'r1');
  var afterDelete = GZ.storageDecision('ok', full, { params: empty.params, days: empty.days, records: [{ id: 'r1', createdAt: 50, updatedAt: 50 }] });
  assert.strictEqual(afterDelete.db, full);
  assert.strictEqual(afterDelete.writeBack, false);
});

check('计划模板：动作都在库里，起始重量走推荐模型', function () {
  var db = GZ.normalize(GZ.defaults(false));
  GZ.templateCatalog().forEach(function (c) {
    var def = GZ.templateDef(db, c.id);
    assert.ok(def && def.days && def.days.length, c.id);
    def.days.forEach(function (d) {
      var names = {};
      d.slots.forEach(function (s) {
        var key = s.name + ':' + (s.prog || s.tier);
        assert.ok(!names[key], c.id + ' ' + d.id + ' repeats ' + s.name);
        names[key] = 1;
        var lb = GZ.libFindIn(db, s.name);
        assert.ok(lb, c.id + ' missing ' + s.name);
        if (s.prog === 'cardio' || s.prog === 'fixed') return;
        if (lb.equip === '自重' || lb.equip === '有氧' || !(lb.ratio > 0)) {
          assert.strictEqual(Number(s.init && s.init.value) || 0, 0, s.name);
          return;
        }
        assert.ok(s.init && s.init.type === 'fixed' ? s.init.value > 0 : s.init.type === 'pct' || s.init.type === 'model', c.id + ' ' + s.name);
        if (s.init.type === 'fixed') assert.ok(s.init.value > 0, c.id + ' ' + s.name + ' ' + s.init.value);
      });
    });
  });
  var gz = GZ.templateDef(db, 'gzclp');
  gz.days.forEach(function (d) {
    d.slots.forEach(function (s) {
      if (s.tier === 'T1') {
        assert.strictEqual(s.init.type, 'pct');
        assert.strictEqual(s.init.pct, 0.85);
      } else {
        assert.strictEqual(s.init.type, 'model', s.id);
        assert.strictEqual(GZ.initWeight(s, db.params), GZ.modelWeight(db.params, GZ.libFindIn(db, s.name), s.tier).weight);
      }
    });
  });
  var phul = GZ.templateDef(db, 'phul');
  var fly = null, lunge = null, calf = null;
  phul.days.forEach(function (d) { d.slots.forEach(function (s) {
    if (s.name === '平板哑铃飞鸟') fly = s;
    if (s.name === '杠铃弓步') lunge = s;
    if (s.name === '腿举提踵') calf = s;
  }); });
  assert.ok(fly.init.value > 0 && lunge.init.value > 0 && calf.init.value > 0);
  var ppl = GZ.templateDef(db, 'ppl');
  ppl.days.forEach(function (d) {
    if (d.name.indexOf('推') !== 0) return;
    assert.strictEqual(d.slots.filter(function (s) { return s.name === '哑铃侧平举'; }).length, 1, d.id);
  });
  var fb = GZ.templateDef(db, 'fb3').days[0].slots[0];
  assert.strictEqual(fb.name, '杠铃深蹲');
  assert.strictEqual(fb.scheme.repMin, 6);
  assert.strictEqual(fb.init.value, GZ.modelWeight(db.params, GZ.libFindIn(db, '杠铃深蹲'), 'T2').weight);
  assert.notStrictEqual(fb.init.value, GZ.modelWeight(db.params, GZ.libFindIn(db, '杠铃深蹲'), 'T1').weight);
});

check('5/3/1：训练最大重量向下取整，工作组向上取整，两轮失败再 ×0.9', function () {
  var db = GZ.normalize(GZ.defaults(false));
  var def = GZ.templateDef(db, '531');
  var ohp = def.days[0].slots[0], bbb = def.days[0].slots[1];
  assert.strictEqual(ohp.name, '站姿实力推');
  assert.strictEqual(ohp.init.value, 25);
  assert.notStrictEqual(ohp.init.value, 27.5);
  GZ.startProgram(db, def);
  var card = GZ.buildTrain(db, { day: 'F1' });
  var main = card.items[0], supp = card.items[1];
  assert.deepStrictEqual(main.loads.map(function (ld) { return [ld.pct, ld.reps, ld.weight, ld.amrap]; }), [
    [0.65, 5, 17.5, false], [0.75, 5, 20, false], [0.85, 5, 22.5, true]
  ]);
  assert.strictEqual(main.weight, 22.5);
  assert.strictEqual(supp.name, '站姿实力推');
  assert.strictEqual(supp.weight, 12.5);
  assert.strictEqual(supp.sets, 5);
  assert.strictEqual(card.items[0].dots[2].amrap, true);
  assert.strictEqual(card.items[0].dots[0].amrap, false);
  var wave = GZ.PROGRESSIONS.w531.evaluate;
  var slot = { id: 'F1M', tier: 'T1', name: '站姿实力推', equip: '杠铃', prog: 'w531', scheme: { step: 2.5, inc: 2.5 }, lift: 'ohp' };
  var held = wave(slot, { stage: '第4周', weight: 87.5, fail: 0, cycleMiss: 0 }, { v: 4 }, db.params, false, 4);
  assert.strictEqual(held.judgment, '保持');
  assert.strictEqual(held.nextWeight, 87.5);
  var reset = wave(slot, { stage: '第4周', weight: 87.5, fail: 1, cycleMiss: 0 }, { v: 4 }, db.params, false, 4);
  assert.strictEqual(reset.judgment, '重置');
  assert.strictEqual(reset.nextWeight, 77.5);
  assert.notStrictEqual(reset.nextWeight, 80);
  var up = wave(slot, { stage: '第4周', weight: 100, fail: 0, cycleMiss: 0 }, { v: 5 }, db.params, false, 4);
  assert.strictEqual(up.judgment, '加重');
  assert.strictEqual(up.nextWeight, 102.5);
  var week4 = wave(slot, { stage: '第4周', weight: 25, fail: 0, cycleMiss: 0 }, { v: 5 }, db.params, false, 4);
  assert.strictEqual(week4.loads[2].amrap, false);
  assert.strictEqual(week4.loads.map(function (ld) { return ld.weight; }).join(','), '10,12.5,15');
});

check('双重进阶：自重做满上限建议负重，不再显示加重', function () {
  var s = { id: 'x', tier: 'T2', name: '引体向上', equip: '自重', prog: 'dual', scheme: { sets: 3, repMin: 6, repMax: 10, step: 0 } };
  var r = GZ.PROGRESSIONS.dual.evaluate(s, { stage: '6–10', weight: 0, fail: 0 }, { sets: [10, 10, 10] }, P(), false);
  assert.strictEqual(r.judgment, '建议负重');
  assert.strictEqual(r.nextWeight, 0);
  var mid = GZ.PROGRESSIONS.dual.evaluate(s, { stage: '6–10', weight: 0, fail: 0 }, { sets: [8, 8, 7] }, P(), false);
  assert.strictEqual(mid.judgment, '保持');
  var loaded = Object.assign({}, s, { name: '高位下拉', equip: '器械', scheme: { sets: 3, repMin: 8, repMax: 12, step: 2.5 } });
  var up = GZ.PROGRESSIONS.dual.evaluate(loaded, { stage: '8–12', weight: 40, fail: 0 }, { sets: [12, 12, 12] }, P(), false);
  assert.strictEqual(up.judgment, '加重');
  assert.strictEqual(up.nextWeight, 42.5);
});

check('没练过的出厂重量会换成模型，手改过的固定重量留着', function () {
  var db = GZ.defaults(false);
  db.daysVersion = 7;
  slotOf(db, 'A1_2').init = { type: 'pct', base: 'deadlift', pct: 0.6 };
  slotOf(db, 'A1_5').init = { type: 'fixed', value: 6 };
  slotOf(db, 'B1_5').init = { type: 'fixed', value: 15 };
  GZ.normalize(db);
  assert.strictEqual(db.daysVersion, 8);
  assert.strictEqual(slotOf(db, 'A1_2').init.type, 'model');
  assert.strictEqual(GZ.initWeight(slotOf(db, 'A1_2'), db.params), 50);
  assert.strictEqual(slotOf(db, 'A1_5').init.type, 'fixed');
  assert.strictEqual(slotOf(db, 'A1_5').init.value, 6);
  assert.strictEqual(slotOf(db, 'B1_5').init.type, 'model');
  var trained = GZ.defaults(false);
  trained.daysVersion = 7;
  slotOf(trained, 'A1_2').init = { type: 'pct', base: 'deadlift', pct: 0.6 };
  slotOf(trained, 'B1_5').init = { type: 'fixed', value: 15 };
  trained.records = [{ id: 'a1', date: '2026-10-13', day: 'A1', createdAt: 1, entries: { A1_1: { v: 3 }, A1_2: { v: '完成' } } }];
  GZ.normalize(trained);
  assert.strictEqual(slotOf(trained, 'A1_2').init.type, 'pct');
  assert.strictEqual(slotOf(trained, 'A1_2').init.pct, 0.6);
  assert.strictEqual(slotOf(trained, 'B1_5').init.type, 'model');
});

check('哑铃阶梯：10 kg 及以下保留细档，10–20 每 2 kg，20 kg 起每 2.5 kg', function () {
  function seq(fine, max) {
    return GZ.dumbbellWeights(fine, max).filter(function (w) { return w > 0 && w <= max + 1e-9; });
  }
  assert.deepStrictEqual(seq(1, 30), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22.5, 25, 27.5, 30]);
  assert.deepStrictEqual(seq(2, 30), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22.5, 25, 27.5, 30]);
  assert.strictEqual(GZ.dumbbellFineInc('哑铃弯举', '哑铃'), 1);
  assert.strictEqual(GZ.dumbbellFineInc('坐姿哑铃推肩', '哑铃'), 2);
  assert.strictEqual(GZ.dumbbellFineInc('哑铃侧平举', '哑铃'), 1);
  assert.strictEqual(GZ.dumbbellFineInc('上斜哑铃卧推', '哑铃'), 2);
  function climb(name, from, dir) { return GZ.nudgeWeight(name, '哑铃', from, dir, GZ.dumbbellFineInc(name, '哑铃')); }
  assert.strictEqual(climb('哑铃弯举', 8, 1), 9);
  assert.strictEqual(climb('哑铃弯举', 9, 1), 10);
  assert.strictEqual(climb('哑铃弯举', 10, 1), 12);
  assert.strictEqual(climb('哑铃弯举', 10, -1), 9);
  assert.strictEqual(climb('哑铃弯举', 12, -1), 10);
  assert.strictEqual(climb('坐姿哑铃推肩', 8, 1), 10);
  assert.strictEqual(climb('坐姿哑铃推肩', 10, -1), 8);
  assert.strictEqual(climb('坐姿哑铃推肩', 18, 1), 20);
  assert.strictEqual(climb('坐姿哑铃推肩', 20, 1), 22.5);
  assert.strictEqual(climb('坐姿哑铃推肩', 20, -1), 18);
  assert.strictEqual(climb('坐姿哑铃推肩', 22.5, 1), 25);
  assert.strictEqual(climb('坐姿哑铃推肩', 25, -1), 22.5);
  assert.strictEqual(climb('哑铃弯举', 11, 1), 12);
  assert.strictEqual(climb('哑铃弯举', 11, -1), 10);
  assert.strictEqual(climb('坐姿哑铃推肩', 21, 1), 22.5);
  assert.strictEqual(climb('坐姿哑铃推肩', 23, -1), 22.5);
  assert.strictEqual(GZ.dumbbellSnap(24.7, 2, 'round'), 25);
  assert.strictEqual(GZ.dumbbellSnap(13, 2, 'round'), 14);
  assert.strictEqual(GZ.dumbbellSnap(5.25, 1, 'round'), 5);

  var db = GZ.defaults(false);
  var shoulder = slotOf(db, 'A2_2');
  assert.strictEqual(shoulder.name, '坐姿哑铃推肩');
  var up20 = ev(shoulder, { stage: '3×10', weight: 20, fail: 0, last3x10: 20 }, { v: '完成' });
  assert.strictEqual(up20.nextWeight, 22.5);
  var up18 = ev(shoulder, { stage: '3×10', weight: 18, fail: 0, last3x10: 18 }, { v: '完成' });
  assert.strictEqual(up18.nextWeight, 20);
  var up22 = ev(shoulder, { stage: '3×10', weight: 22.5, fail: 0, last3x10: 22.5 }, { v: '完成' });
  assert.strictEqual(up22.nextWeight, 25);
  var curl = slotOf(db, 'B2_5');
  assert.strictEqual(curl.name, '哑铃弯举');
  assert.strictEqual(ev(curl, { stage: '3×15+', weight: 9, fail: 0 }, { v: 25 }).nextWeight, 10);
  assert.strictEqual(ev(curl, { stage: '3×15+', weight: 10, fail: 0 }, { v: 25 }).nextWeight, 12);
  assert.strictEqual(ev(curl, { stage: '3×15+', weight: 8, fail: 0 }, { v: 25 }).nextWeight, 9);
  assert.strictEqual(ev(curl, { stage: '3×15+', weight: 22.5, fail: 0 }, { v: 10 }).nextWeight, 20);
  var row = { id: 'x', tier: 'T2', name: '单臂哑铃划船', equip: '哑铃', prog: 'dual', scheme: { sets: 3, repMin: 8, repMax: 12, step: 2 } };
  var dualUp = GZ.PROGRESSIONS.dual.evaluate(row, { stage: '8–12', weight: 20, fail: 0 }, { sets: [12, 12, 12] });
  assert.strictEqual(dualUp.nextWeight, 22.5);
  var dualDown = GZ.PROGRESSIONS.dual.evaluate(row, { stage: '8–12', weight: 22.5, fail: 0 }, { sets: [6, 8, 8] });
  assert.strictEqual(dualDown.nextWeight, 20);
  var card = GZ.buildTrain(db, { day: 'A2' }).items.filter(function (it) { return it.slotId === 'A2_2'; })[0];
  var shown = GZ.nudgeWeight(card.name, card.equip, card.weight, 1, card.wStep);
  assert.strictEqual(card.wStep, Math.round((shown - card.weight) * 100) / 100);
  assert.ok(card.wStepText);
});

if (failed) {
  console.error('\n' + failed + ' failed');
  process.exit(1);
}
console.log('\nall passed');
