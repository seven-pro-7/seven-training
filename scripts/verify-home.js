/**
 * 首页文案、真实训练状态、记组落盘、换动作 / 跳过 / 撤销 / 完成。
 * 运行：node scripts/verify-home.js
 * 不读、不写浏览器里的用户档案。
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var GZ = require('../source/utils/engine.js');
var Home = require('../source/utils/home-copy.js');

var failed = 0;
function check(name, fn) {
  try { fn(); console.log('ok  ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e && e.stack || e)); }
}

function fresh() { return GZ.normalize(GZ.defaults(false)); }
function item(vm, id) { return vm.items.filter(function (it) { return it.slotId === id; })[0]; }

check('空白档案的 A1 来自引擎，不采用示例外观里的重量', function () {
  var vm = GZ.buildTrain(fresh(), { day: 'A1' });
  assert.deepStrictEqual(vm.items.map(function (it) { return it.name; }), ['杠铃深蹲', '罗马尼亚硬拉', '高位下拉', '坐姿腿屈伸', '哑铃侧平举']);
  assert.strictEqual(Home.schemeLine(vm.items[0]), 'T1 · 5 组 × 3+');
  assert.strictEqual(Home.schemeLine(vm.items[1]), 'T2 · 3 组 × 10');
  assert.strictEqual(Home.schemeLine(vm.items[2]), 'T2 · 3 组 × 10');
  assert.strictEqual(Home.schemeLine(vm.items[3]), 'T3 · 3 组 × 15+');
  assert.strictEqual(Home.schemeLine(vm.items[4]), 'T3 · 3 组 × 15+');
  assert.notStrictEqual(vm.items[0].weightText, '62.5');
  assert.strictEqual(vm.weekInCycle, 1);
  assert.strictEqual(vm.day, 'A1');
  assert.strictEqual(Home.sessionStamp('2026-11-13', vm.weekInCycle, vm.cycle, vm.day), '26.11.13 · 第1周 · A1');
});

check('日期行用计划周，第二轮不写成日历周', function () {
  assert.strictEqual(Home.sessionStamp('2026-11-13', 3, 1, 'B2'), '26.11.13 · 第3周 · B2');
  assert.strictEqual(Home.sessionStamp('2026-11-13', 3, 2, 'A1'), '26.11.13 · 第2轮第3周 · A1');
  var db = fresh();
  for (var w = 0; w < 8; w++) {
    ['A1', 'B1', 'A2', 'B2'].forEach(function (day) {
      var draft = GZ.blankDraft(db, day);
      Object.keys(draft).forEach(function (k) { draft[k].v = '完成'; draft[k].done = 3; });
      draft[day + '_1'].v = 5;
      GZ.saveRecord(db, { date: '2026-01-' + String(10 + w).padStart(2, '0'), day: day, entries: draft, createdAt: w * 10 });
    });
  }
  var vm = GZ.buildTrain(db, { day: 'A1' });
  assert.ok(vm.cycle >= 2, 'cycle ' + vm.cycle);
  assert.strictEqual(vm.weekInCycle, ((vm.week - 1) % vm.weeksPerCycle) + 1);
  var stamp = Home.sessionStamp('2026-11-13', vm.weekInCycle, vm.cycle, vm.day);
  assert.ok(stamp.indexOf('第' + vm.cycle + '轮第' + vm.weekInCycle + '周') >= 0, stamp);
  assert.ok(stamp.indexOf('W') < 0);
});

check('当前序号、开始前和训练中的一句话都跟焦点动作走', function () {
  var db = fresh();
  var vm = GZ.buildTrain(db, { day: 'A1' });
  var pos = Home.positionOf(vm, 'A1_1');
  assert.deepStrictEqual(pos, { index: 1, total: 5 });
  assert.strictEqual(Home.ctaLabel({ started: false, name: vm.items[0].name }), '开始深蹲');
  assert.strictEqual(Home.guidePrompt({ dayName: vm.dayName, name: vm.items[0].name }), '今天练下肢，先从深蹲开始。');
  var draft = GZ.blankDraft(db, 'A1');
  draft.A1_1.done = 2;
  var live = GZ.buildTrain(db, { day: 'A1', draft: draft });
  var squat = item(live, 'A1_1');
  assert.strictEqual(Home.sessionStarted(live), true);
  assert.strictEqual(Home.guidePrompt({
    dayName: live.dayName, name: squat.name, done: squat.done, sets: squat.sets, started: true
  }), '深蹲已记下 2 组，接着第 3 组。');
  assert.strictEqual(Home.ctaLabel({ started: true, name: squat.name }), '继续深蹲');
  assert.strictEqual(Home.positionOf(live, 'A1_3').index, 3);
  assert.strictEqual(Home.ctaLabel({ ready: true, name: squat.name }), '完成训练');
  assert.strictEqual(Home.guidePrompt({ ready: true, name: squat.name }), '今天的动作都记好了。');
});

check('记组落盘、跳过不加重、删除后重量回到记之前', function () {
  var db = fresh();
  var before = GZ.buildTrain(db, { day: 'A1' });
  var w0 = item(before, 'A1_1').weight;
  var skipped = GZ.blankDraft(db, 'A1');
  Object.keys(skipped).forEach(function (k) { skipped[k].skip = true; });
  var skipRec = GZ.saveRecord(db, { date: '2026-11-01', day: 'A1', entries: skipped, createdAt: 1 });
  var afterSkip = GZ.buildTrain(db, { day: 'A1' });
  assert.strictEqual(afterSkip.locked, true);
  GZ.deleteRecord(db, skipRec.id);
  var cleared = GZ.buildTrain(db, { day: 'A1' });
  assert.strictEqual(cleared.locked, false);
  assert.strictEqual(item(cleared, 'A1_1').weight, w0);
  var done = GZ.blankDraft(db, 'A1');
  Object.keys(done).forEach(function (k) { done[k].v = k === 'A1_1' ? 8 : (k.indexOf('_4') >= 0 || k.indexOf('_5') >= 0 ? 20 : '完成'); done[k].done = 5; });
  var rec = GZ.saveRecord(db, { date: '2026-11-02', day: 'A1', entries: done, createdAt: 2 });
  assert.ok(GZ.getRecord(db, rec.id));
  var replay = GZ.replay(db);
  var squat = replay.sessions[0].items.filter(function (it) { return it.slotId === 'A1_1'; })[0];
  assert.strictEqual(squat.judgment, '加重');
  assert.ok(squat.nextWeight > w0);
  GZ.deleteRecord(db, rec.id);
  var undone = GZ.buildTrain(db, { day: 'A1' });
  assert.strictEqual(item(undone, 'A1_1').weight, w0);
  assert.strictEqual(undone.filled, 0);
});

check('本次替换不改计划槽位，跳过判定不改下次重量', function () {
  var db = fresh();
  var base = item(GZ.buildTrain(db, { day: 'A1' }), 'A1_2');
  var once = GZ.blankDraft(db, 'A1');
  once.A1_2.ex = '前蹲';
  once.A1_2.w = base.weight;
  once.A1_2.v = '完成';
  Object.keys(once).forEach(function (k) { if (k !== 'A1_2') once[k].skip = true; });
  var rec = GZ.saveRecord(db, { date: '2026-11-03', day: 'A1', entries: once, createdAt: 3 });
  var viewed = GZ.buildReview(db).logs.filter(function (l) { return l.id === rec.id; })[0];
  assert.strictEqual(viewed.items.filter(function (it) { return it.slotId === 'A1_2'; })[0].name, '前蹲');
  GZ.deleteRecord(db, rec.id);
  assert.strictEqual(item(GZ.buildTrain(db, { day: 'A1' }), 'A1_2').name, '罗马尼亚硬拉');
  var skipDraft = GZ.blankDraft(db, 'A1');
  skipDraft.A1_1.skip = true;
  var res = GZ.buildTrain(db, { day: 'A1', draft: skipDraft });
  var sk = item(res, 'A1_1');
  assert.strictEqual(sk.skip, true);
  assert.strictEqual(sk.preview, null);
  var saved = GZ.saveRecord(db, { date: '2026-11-04', day: 'A1', entries: Object.assign(skipDraft, (function () {
    var d = GZ.blankDraft(db, 'A1');
    Object.keys(d).forEach(function (k) { d[k].skip = true; });
    return d;
  })()), createdAt: 4 });
  var row = GZ.replay(db).sessions[0].items.filter(function (it) { return it.slotId === 'A1_1'; })[0];
  assert.strictEqual(row.judgment, '跳过');
  assert.strictEqual(row.nextWeight, row.weight);
  GZ.deleteRecord(db, saved.id);
});

check('哑铃仍走阶梯，20kg 之后不是每档加 2kg', function () {
  var up = GZ.nudgeWeight('哑铃侧平举', '哑铃', 20, 1, 2);
  assert.strictEqual(up, 22.5);
  assert.notStrictEqual(up, 22);
});

check('首页样式保留锁定色、32px 间距、14/12 字号，并且随宽度伸缩', function () {
  var css = fs.readFileSync(path.join(__dirname, '../source/preview/muse-home.css'), 'utf8');
  var py = fs.readFileSync(path.join(__dirname, '../source/preview/build.py'), 'utf8');
  ['#F8F8F8', '#141414', '#5BB887', '#E06A3C', 'margin-top: 32px'].forEach(function (token) {
    assert.ok(css.indexOf(token) >= 0, token);
  });
  assert.ok(/\.guide-title \{[^}]*font-size: 14px/.test(css));
  assert.ok(/\.when-line,\s*\n\.app\.on-train \.session-position \{[^}]*font-size: 12px/.test(css));
  assert.ok(css.indexOf('max-width: 480px') >= 0);
  assert.ok(css.indexOf('max-height: 680px') >= 0);
  assert.ok(css.indexOf('min-height: 44px') >= 0);
  assert.ok(css.indexOf('--home-reserve: calc(var(--home-action-h) + 16px + var(--tabh) + var(--tabbottom))') >= 0);
  assert.ok(css.indexOf('padding-bottom: var(--home-reserve)') >= 0);
  assert.ok(css.indexOf('scroll-padding-bottom: var(--home-reserve)') >= 0);
  assert.ok(css.indexOf('env(safe-area-inset-bottom)') >= 0);
  assert.ok(css.indexOf('pointer-events: none') >= 0);
  assert.ok(css.indexOf('prefers-reduced-motion') >= 0);
  assert.ok(py.indexOf("('train', '今天')") >= 0);
  assert.ok(py.indexOf("('plan', '计划')") >= 0);
  assert.ok(py.indexOf("('stats', '趋势')") >= 0);
  assert.ok(py.indexOf('border-radius: 54px') < 0);
  assert.ok(py.indexOf('home-copy.js') >= 0);
});

if (failed) {
  console.error('\n' + failed + ' failed');
  process.exit(1);
}
console.log('\nall home checks passed');
