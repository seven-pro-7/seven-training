/**
 * 训练伙伴一期状态机。
 * 运行：node scripts/verify-companion.js
 */
var assert = require('assert');
var C = require('../source/utils/companion-core.js');

var failed = 0;
function check(name, fn) {
  try { fn(); console.log('ok  ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e && e.stack || e)); }
}
function clocked(extra) {
  var t = 0, bag = {};
  var m = C.createMachine(Object.assign({
    now: function () { return t; },
    shanghai: function () { return { hour: 12, minute: 0 }; },
    store: { get: function () { return bag; }, set: function (v) { bag = v; } }
  }, extra || {}));
  return { m: m, at: function (ms) { t = ms; return m.tick(); }, add: function (ms) { t += ms; return m.tick(); }, bag: function () { return bag; } };
}

check('六态可进入，think/reply 禁止', function () {
  assert.deepStrictEqual(Object.keys(C.ALLOWED).sort(), ['comfort', 'happy', 'idle', 'listen', 'sleep', 'surprise']);
  var c = clocked();
  assert.strictEqual(c.m.dispatch('think').reason, 'forbidden');
  assert.strictEqual(c.m.snapshot().state, 'idle');
  assert.strictEqual(c.m.dispatch('reply').reason, 'forbidden');
  ['listen', 'comfort', 'sleep'].forEach(function (s) {
    if (s === 'comfort') c.m.dispatch('support', { on: true });
    else if (s === 'sleep') { c.m.dispatch('support', { on: false }); c.m.dispatch('activity'); c.add(5 * 60 * 1000 + 1); }
    else c.m.dispatch('input');
    assert.strictEqual(c.m.snapshot().state, s, s);
    c.m.dispatch('activity');
  });
});

check('真实输入 listen，记组不听且立刻打断', function () {
  var c = clocked();
  c.m.dispatch('input');
  assert.strictEqual(c.m.snapshot().state, 'listen');
  c.m.dispatch('set');
  assert.strictEqual(c.m.snapshot().state, 'idle');
  assert.strictEqual(c.m.snapshot().listening, false);
});

check('600ms 内的记组立刻回 idle，不拖住业务', function () {
  var c = clocked();
  c.m.dispatch('complete', { persisted: true, eventId: 'a', levelUp: false });
  assert.strictEqual(c.m.snapshot().state, 'happy');
  c.at(100);
  var snap = c.m.dispatch('set');
  assert.strictEqual(snap.state, 'idle');
});

check('完成落盘播 happy；去重、撤销补录、失败不播', function () {
  var c = clocked();
  var ok = c.m.dispatch('complete', { persisted: true, eventId: 's1' });
  assert.strictEqual(ok.state, 'happy');
  c.m.dispatch('activity');
  var again = c.m.dispatch('complete', { persisted: true, eventId: 's1' });
  assert.strictEqual(again.reason, 'dedupe');
  assert.strictEqual(c.m.snapshot().state, 'idle');
  var redo = c.m.dispatch('complete', { persisted: true, eventId: 's2', redo: true });
  assert.strictEqual(redo.reason, 'not-live');
  var back = c.m.dispatch('complete', { persisted: true, eventId: 's3', backfill: true });
  assert.strictEqual(back.reason, 'not-live');
  var bad = c.m.dispatch('complete', { persisted: false, eventId: 's4' });
  assert.strictEqual(bad.reason, 'persist');
  assert.strictEqual(c.m.snapshot().state, 'idle');
});

check('完成并升级只播一次 surprise', function () {
  var c = clocked();
  var r = c.m.dispatch('complete', { persisted: true, eventId: 'up1', levelUp: true });
  assert.strictEqual(r.state, 'surprise');
  c.at(1700);
  assert.strictEqual(c.m.snapshot().state, 'idle');
  assert.notStrictEqual(c.m.snapshot().state, 'happy');
});

check('听的时候完成先排队，超过 3s 丢弃', function () {
  var c = clocked();
  c.m.dispatch('input');
  c.m.dispatch('complete', { persisted: true, eventId: 'q1' });
  assert.strictEqual(c.m.snapshot().state, 'listen');
  assert.strictEqual(c.m.snapshot().queued, 'happy');
  c.m.dispatch('inputEnd');
  c.add(3001);
  assert.strictEqual(c.m.snapshot().queued, null);
  assert.strictEqual(c.m.snapshot().state, 'idle');
});

check('组间休息和训练操作不会睡；空闲 5 分钟才睡', function () {
  var c = clocked();
  c.m.dispatch('rest', { on: true });
  c.at(6 * 60 * 1000);
  assert.strictEqual(c.m.snapshot().state, 'idle');
  c.m.dispatch('rest', { on: false });
  c.m.dispatch('activity');
  c.add(5 * 60 * 1000 - 1);
  assert.strictEqual(c.m.snapshot().state, 'idle');
  c.add(2);
  assert.strictEqual(c.m.snapshot().state, 'sleep');
  c.m.dispatch('activity');
  assert.strictEqual(c.m.snapshot().state, 'idle');
});

check('上海深夜空闲 1 分钟睡，后台不睡也不补播', function () {
  var c = clocked({ shanghai: function () { return { hour: 23, minute: 40 }; } });
  c.at(60 * 1000);
  assert.strictEqual(c.m.snapshot().state, 'sleep');
  var d = clocked({ shanghai: function () { return { hour: 23, minute: 40 }; } });
  d.m.dispatch('hide');
  d.at(10 * 60 * 1000);
  assert.notStrictEqual(d.m.snapshot().state, 'sleep');
  d.m.dispatch('complete', { persisted: true, eventId: 'hid1' });
  assert.strictEqual(d.m.snapshot().queued, 'happy');
  d.m.dispatch('show');
  assert.strictEqual(d.m.snapshot().queued, null);
  assert.strictEqual(d.m.snapshot().state, 'idle');
});

check('敏感标记挡住庆祝；安慰开关关掉就不进 comfort', function () {
  var c = clocked();
  c.m.dispatch('sensitive', { on: true });
  var r = c.m.dispatch('complete', { persisted: true, eventId: 'pain' });
  assert.strictEqual(r.reason, 'sensitive');
  var off = clocked({ comfortEnabled: false });
  var s = off.m.dispatch('support', { on: true });
  assert.strictEqual(s.reason, 'comfort-off');
  assert.strictEqual(off.m.snapshot().state, 'idle');
});

check('减弱动态标记为静帧，状态仍可切换', function () {
  var c = clocked({ reduceMotion: true });
  c.m.dispatch('input');
  var snap = c.m.snapshot();
  assert.strictEqual(snap.state, 'listen');
  assert.strictEqual(snap.frozen, true);
  var svg = C.staticInner('idle', 'M');
  assert.ok(svg.indexOf('#6CB6A0') >= 0);
  assert.ok(svg.indexOf('sparkle') < 0);
});

check('M 档静态帧不含回复文字行', function () {
  var svg = C.staticInner('happy', 'M');
  assert.ok(svg.indexOf('<rect') < 0);
});

check('点按预览不重复，到点回 idle，不写庆祝', function () {
  var c = clocked();
  var prev = '';
  for (var i = 0; i < 12; i++) {
    c.at(i * 500);
    var r = c.m.dispatch('preview', { random: Math.random });
    assert.strictEqual(r.ok, true, r.reason);
    assert.notStrictEqual(r.state, 'idle');
    assert.notStrictEqual(r.state, prev);
    assert.ok(C.ALLOWED[r.state]);
    prev = r.state;
  }
  assert.deepStrictEqual(c.bag(), {});
  var early = c.m.dispatch('preview', { random: function () { return 0; } });
  assert.strictEqual(early.reason, 'throttle');
  c.at(11 * 500 + 2000);
  assert.strictEqual(c.m.snapshot().preview, false);
  assert.strictEqual(c.m.snapshot().state, 'idle');
});

check('预览 happy / surprise 用原来的单次时长', function () {
  var c = clocked();
  assert.strictEqual(c.m.dispatch('preview', { random: function () { return 0.6; } }).state, 'happy');
  c.at(1999);
  assert.strictEqual(c.m.snapshot().state, 'happy');
  c.at(2000);
  assert.strictEqual(c.m.snapshot().state, 'idle');
  c.at(2400);
  assert.strictEqual(c.m.dispatch('preview', { random: function () { return 0.8; } }).state, 'surprise');
  c.at(2400 + 1699);
  assert.strictEqual(c.m.snapshot().state, 'surprise');
  c.at(2400 + 1700);
  assert.strictEqual(c.m.snapshot().state, 'idle');
  assert.deepStrictEqual(c.bag(), {});
});

check('记组、输入、保存打断预览，且不消耗去重', function () {
  var c = clocked();
  c.m.dispatch('preview', { random: function () { return 0.6; } });
  assert.strictEqual(c.m.snapshot().state, 'happy');
  c.m.dispatch('set');
  assert.strictEqual(c.m.snapshot().state, 'idle');
  assert.strictEqual(c.m.snapshot().preview, false);
  c.at(400);
  c.m.dispatch('preview', { random: function () { return 0; } });
  c.m.dispatch('input');
  assert.strictEqual(c.m.snapshot().listening, true);
  assert.strictEqual(c.m.snapshot().preview, false);
  var blocked = c.m.dispatch('preview', { random: function () { return 0.2; } });
  assert.strictEqual(blocked.reason, 'busy');
  c.m.dispatch('activity');
  var done = c.m.dispatch('complete', { persisted: true, eventId: 'live-1' });
  assert.strictEqual(done.state, 'happy');
  c.m.dispatch('activity');
  assert.strictEqual(c.m.dispatch('complete', { persisted: true, eventId: 'live-1' }).reason, 'dedupe');
  c.at(1000);
  c.m.dispatch('preview', { random: function () { return 0.6; } });
  var failedSave = c.m.dispatch('complete', { persisted: false, eventId: 'nope' });
  assert.strictEqual(failedSave.reason, 'persist');
  assert.notStrictEqual(c.m.snapshot().state, 'happy');
});

check('关掉情绪陪伴不抽 comfort，敏感不播庆祝预览', function () {
  var off = clocked({ comfortEnabled: false });
  var got = {};
  for (var i = 0; i < 8; i++) {
    off.at(i * 500);
    var r = off.m.dispatch('preview', { random: function () { return (i % 4) / 4; } });
    if (r.ok) got[r.state] = 1;
  }
  assert.ok(!got.comfort);
  assert.ok(got.listen || got.sleep);
  var sens = clocked();
  sens.m.dispatch('sensitive', { on: true });
  var mood = {};
  for (var j = 0; j < 10; j++) {
    sens.at(j * 500);
    var s = sens.m.dispatch('preview', { random: function () { return j / 10; } });
    if (s.ok) mood[s.state] = 1;
  }
  assert.ok(!mood.happy);
  assert.ok(!mood.surprise);
  sens.at(10 * 500);
  sens.m.dispatch('preview', { random: function () { return 0.6; } });
  assert.notStrictEqual(sens.m.snapshot().state, 'happy');
  sens.m.dispatch('hide');
  assert.strictEqual(sens.m.snapshot().preview, false);
  sens.m.dispatch('show');
  sens.at(10 * 500 + 50);
  assert.notStrictEqual(sens.m.snapshot().state, 'happy');
});

check('预览会叫醒睡眠，到点后空闲规则仍在', function () {
  var c = clocked();
  c.at(5 * 60 * 1000);
  assert.strictEqual(c.m.snapshot().state, 'sleep');
  c.m.dispatch('preview', { random: function () { return 0; } });
  assert.strictEqual(c.m.snapshot().state, 'listen');
  c.at(5 * 60 * 1000 + C.PREVIEW_LOOP_MS);
  assert.strictEqual(c.m.snapshot().state, 'idle');
  c.at(10 * 60 * 1000 - 1);
  assert.strictEqual(c.m.snapshot().state, 'idle');
  c.at(10 * 60 * 1000);
  assert.strictEqual(c.m.snapshot().state, 'sleep');
});

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('companion ok');
