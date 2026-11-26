/**
 * 无头浏览器走首页：矮屏滚到底最后一项不被挡住，以及完成、结算、改正、撤销、更换、跳过。
 * 用独立的 Chrome 配置，不读本机训练档案。
 * 运行：node scripts/verify-home-flow.js
 */
var http = require('http');
var fs = require('fs');
var path = require('path');
var { spawn } = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var OUT = '/opt/cursor/artifacts';
var PORT = 8779;
fs.mkdirSync(OUT, { recursive: true });

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function serve() {
  return http.createServer(function (req, res) {
    var url = decodeURIComponent(req.url.split('?')[0]);
    var file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, function (err, buf) {
      if (err) { res.writeHead(404); res.end('missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
  });
}

async function cdp(wsUrl) {
  var ws = new WebSocket(wsUrl);
  await new Promise(function (resolve, reject) {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  var seq = 0, pending = {};
  ws.addEventListener('message', function (ev) {
    var msg = JSON.parse(ev.data);
    if (msg.id && pending[msg.id]) pending[msg.id](msg);
  });
  function send(method, params, sessionId) {
    var id = ++seq;
    return new Promise(function (resolve) {
      pending[id] = resolve;
      ws.send(JSON.stringify({ id: id, method: method, params: params || {}, sessionId: sessionId }));
    });
  }
  return { send: send, close: function () { ws.close(); } };
}

var PAGE = `(async function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function click(sel) {
    var el = document.querySelector(sel);
    if (!el) throw new Error('找不到 ' + sel);
    el.click();
  }
  function records() {
    var raw = localStorage.getItem('training_db_v1');
    var db = raw ? JSON.parse(raw) : { records: [] };
    return db.records || [];
  }
  function text(sel) {
    var el = document.querySelector(sel);
    return el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
  }
  var report = { steps: [] };
  function note(name, extra) { report.steps.push(Object.assign({ name: name }, extra || {})); }
  function itemOf(name) {
    return [].filter.call(document.querySelectorAll('.qm-item'), function (el) { return el.textContent.indexOf(name) >= 0; })[0];
  }
  async function openDetail(name) {
    var item = itemOf(name);
    if (!item) throw new Error('找不到 ' + name);
    var row = item.querySelector('.qm-row');
    if (row) { row.click(); await wait(60); }
    var head = document.querySelector('.qm-item.is-open [data-act=qmopen]');
    if (!head) throw new Error(name + ' 没有进入记录的区域');
    head.click();
    await wait(80);
  }
  async function openMore() {
    if (!document.querySelector('.action-sheet')) {
      click('[data-act=logmore]');
      await wait(70);
    }
  }

  var body = document.getElementById('body');
  var scroller = document.querySelector('.home-scroll') || body;
  scroller.scrollTop = scroller.scrollHeight;
  await wait(60);
  var rows = document.querySelectorAll('.qm-item');
  var last = rows[rows.length - 1].getBoundingClientRect();
  var dock = document.querySelector('.tabbar').getBoundingClientRect();
  var cue = document.querySelector('.guide-title').getBoundingClientRect();
  var block = document.querySelector('.training-block').getBoundingClientRect();
  var midX = last.left + Math.min(120, last.width / 2);
  var midY = Math.max(last.top + 12, Math.min(last.bottom - 12, dock.top - 12));
  var hit = document.elementFromPoint(midX, midY);
  report.layout = {
    vw: window.innerWidth, vh: window.innerHeight,
    lastBottom: Math.round(last.bottom),
    gap: Math.round(dock.top - last.bottom),
    dockTop: Math.round(dock.top),
    cueGap: Math.round(block.top - cue.bottom),
    hit: hit ? (hit.closest('.qm-row') ? 'row' : hit.closest('.tabbar') ? 'tab' : (hit.className || hit.tagName)) : 'none',
    names: [].map.call(rows, function (el) { return el.querySelector('.qm-name').childNodes[0].textContent.trim(); })
  };
  if (report.layout.cueGap < 32) throw new Error('伙伴和训练模块间隙只有 ' + report.layout.cueGap + 'px');
  if (last.bottom > dock.top - 8) throw new Error('最后一项伸进了底栏');
  if (report.layout.hit === 'tab') throw new Error('最后一项的点击落在底栏上');

  var beforeRec = records().length;
  rows[rows.length - 1].querySelector('.qm-row').click();
  await wait(120);
  if (document.querySelector('.set-screen')) throw new Error('点收起行直接打开了详情');
  if (!document.querySelector('.qm-item.is-open')) throw new Error('点收起行没有展开');
  if (records().length !== beforeRec) throw new Error('点最后一项写入了训练记录');
  click('[data-act=qmopen]');
  await wait(120);
  if (!document.querySelector('.set-screen')) throw new Error('展开头部没有进入记组');
  if (document.querySelector('#companionSlot')) throw new Error('记组页出现了伙伴');
  var tab = document.querySelector('.tabbar');
  if (tab && getComputedStyle(tab).display !== 'none') throw new Error('记组页还有底栏');
  click('[data-act=logback]');
  await wait(80);
  if (document.querySelector('.set-screen')) throw new Error('返回后还在记组页');
  if (!document.querySelector('.qm-item.is-open')) throw new Error('返回后没有回到展开的动作');
  report.afterRow = { records: records().length };
  note('reach', report.afterRow);

  click('[data-act=adjust]');
  await wait(80);
  if (!document.querySelector('.session-sheet')) throw new Error('调整今天没有打开');
  click('[data-act=menuclose]');
  await wait(80);
  if (records().length !== beforeRec) throw new Error('调整今天写入了训练记录');

  var squatItem = itemOf('杠铃深蹲');
  if (!squatItem.querySelector('.qm-row')) squatItem.querySelector('[data-act=qmcollapse]').click();
  await wait(40);
  squatItem = itemOf('杠铃深蹲');
  squatItem.querySelector('.qm-row').click();
  await wait(80);
  if (document.querySelector('[data-act=qmall]')) throw new Error('AMRAP 列表出现了全部完成');
  var setBtns = document.querySelectorAll('.qm-item.is-open [data-act=qmset]');
  if (setBtns.length < 5) throw new Error('深蹲组点只有 ' + setBtns.length);
  var box0 = setBtns[0].getBoundingClientRect();
  if (box0.width < 44 || box0.height < 44) throw new Error('组点热区 ' + Math.round(box0.width) + '×' + Math.round(box0.height));
  var node = setBtns[0].querySelector('.qm-node').getBoundingClientRect();
  if (node.width > 36 || node.height > 36) throw new Error('组点视觉圆 ' + Math.round(node.width));
  var fold = document.querySelector('.qm-fold').getBoundingClientRect();
  var head = document.querySelector('.qm-head-content').getBoundingClientRect();
  if (head.height < 64) throw new Error('头部内容区高度 ' + Math.round(head.height));
  var gapHit = document.elementFromPoint((fold.right + head.left) / 2, fold.top + fold.height / 2);
  if (gapHit && (gapHit.closest('[data-act=qmopen]') || gapHit.closest('[data-act=qmcollapse]'))) throw new Error('收起和进入详情共用了命中区');
  var label = document.querySelector('.qm-stage-label').getBoundingClientRect();
  var labelHit = document.elementFromPoint(label.left + 10, label.top + label.height / 2);
  if (labelHit && (labelHit.closest('[data-act=qmopen]') || labelHit.closest('[data-act=qmset]'))) throw new Error('目标文字会导航或记组');
  setBtns[0].click();
  await wait(100);
  if (document.querySelector('.set-screen') || document.querySelector('.rest-clock')) throw new Error('列表记完非末组跳进了全屏休息');
  if (!document.querySelector('.qm-set.done')) throw new Error('写入成功后没有点亮');
  if (!document.querySelector('[data-act=qmrest]')) throw new Error('列表没有休息提示');
  var lit = document.querySelectorAll('.qm-set.done').length;
  document.querySelector('.qm-set.done').click();
  await wait(50);
  if (document.querySelectorAll('.qm-set.done').length !== lit) throw new Error('已记组可以在列表取消');
  document.querySelectorAll('.qm-item.is-open [data-act=qmset]')[4].click();
  await wait(60);
  var actual = document.querySelector('[data-act=qreps]');
  if (!actual) throw new Error('点末组没有出现实际次数');
  if (actual.value !== '') throw new Error('末组预填了目标：' + actual.value);
  if (actual.getAttribute('placeholder') && /\\d/.test(actual.getAttribute('placeholder'))) throw new Error('占位写成了目标次数');
  var confirmBtn = document.querySelector('[data-act=qmconfirm]');
  if (!confirmBtn || !confirmBtn.disabled) throw new Error('空的末组可以确认');
  click('[data-act=qmcancel]');
  await wait(40);
  if (document.querySelectorAll('.qm-set.done').length !== 1) throw new Error('取消末组仍写入了');
  click('[data-act=qmopen]');
  await wait(80);
  var fixesNow = document.querySelectorAll('[data-act=logfix]');
  if (!fixesNow.length) throw new Error('详情里看不到刚记下的组');
  fixesNow[fixesNow.length - 1].click();
  await wait(50);
  if (!document.querySelector('[data-act=logundo]')) throw new Error('最新一组的更正里没有撤销');
  click('[data-act=logundo]');
  await wait(80);
  if (document.querySelector('[data-act=logfix]')) throw new Error('撤销后组还在');
  if (!document.querySelector('[data-act=logsave]')) throw new Error('深蹲没有记下按钮：' + text('.home-cta'));
  function assertBack(where) {
    var b = document.querySelector('.set-top .back-btn');
    if (!b) throw new Error(where + '没有返回按钮');
    var box = b.getBoundingClientRect();
    var gear = document.querySelector('.set-top .gear-btn').getBoundingClientRect();
    if (box.width < 44 || box.height < 44) throw new Error(where + '返回按钮只有 ' + Math.round(box.width) + '×' + Math.round(box.height));
    if (box.right > gear.left - 4) throw new Error(where + '返回按钮和设置叠在一起');
    var hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (!hit || !hit.closest('.back-btn')) throw new Error(where + '返回按钮点不到');
  }
  assertBack('记组');
  var inside = [].map.call(document.querySelectorAll('.set-path .dot'), function (el) { return el.textContent.trim(); }).filter(Boolean);
  if (inside.length) throw new Error('圆点里还有数字：' + inside.join(','));
  var labs = [].map.call(document.querySelectorAll('.set-path .lab'), function (el) { return el.textContent.trim(); });
  if (labs.join(',') !== '1,2,3,4,5+') throw new Error('组次标签是 ' + labs.join(','));
  var reps = document.querySelector('[data-act=logreps]');
  reps.value = '7';
  reps.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(40);
  window.__SEVEN_FAIL_OPEN = true;
  click('[data-act=logsave]');
  await wait(80);
  if (!document.querySelector('.screen-fail')) throw new Error('本机写入失败没有留在失败页');
  if (document.querySelector('.rest-clock')) throw new Error('写入失败却开始了休息');
  if (document.querySelector('.sp.done')) throw new Error('写入失败却标成已记');
  assertBack('失败');
  click('.set-top .back-btn');
  await wait(80);
  if (document.querySelector('.set-screen')) throw new Error('失败后返回没有回到今日列表');
  if (records().length !== beforeRec) throw new Error('失败后返回写入了训练记录');
  await openDetail('杠铃深蹲');
  if (document.querySelector('[data-act=logreps]').value !== '7') throw new Error('返回后待记次数丢了：' + document.querySelector('[data-act=logreps]').value);
  if (document.querySelector('.sp.done')) throw new Error('返回后这一组被标成已记');
  window.__SEVEN_FAIL_OPEN = false;
  document.querySelector('[data-act=logreps]').value = '3';
  document.querySelector('[data-act=logreps]').dispatchEvent(new Event('input', { bubbles: true }));
  await wait(40);
  click('[data-act=logsave]');
  await wait(100);
  if (!document.querySelector('.rest-clock')) throw new Error('重试成功后没有休息');
  click('[data-act=logundo]');
  await wait(80);
  if (document.querySelector('.rest-clock')) throw new Error('撤销最近一组后休息还在');
  if (document.querySelector('[data-act=logfix]')) throw new Error('撤销后组还在');
  click('[data-act=logsave]');
  await wait(80);
  click('[data-act=logrestskip]');
  await wait(80);
  window.__confirms = 0;
  window.confirm = function () { window.__confirms += 1; return false; };
  await openMore();
  click('[data-act=openswap]');
  await wait(100);
  var squatPick = [].filter.call(document.querySelectorAll('[data-act=swappick]'), function (el) { return el.textContent.indexOf('杠铃深蹲') < 0; })[0];
  if (!squatPick) throw new Error('深蹲没有可更换的动作');
  squatPick.click();
  await wait(60);
  click('[data-act=swapok]');
  await wait(80);
  if (!window.__confirms) throw new Error('已有组时更换没有确认');
  if (text('.set-name').indexOf('杠铃深蹲') < 0) throw new Error('拒绝更换后动作变了：' + text('.set-name'));
  window.confirm = function () { window.__confirms += 1; return true; };
  click('[data-act=swapok]');
  await wait(120);
  if (text('.set-name').indexOf('杠铃深蹲') >= 0) throw new Error('确认更换后还是深蹲');
  if (document.querySelector('[data-act=logfix]')) throw new Error('新动作带上了深蹲的组');
  await openMore();
  click('[data-act=openswap]');
  await wait(100);
  var backSquat = [].filter.call(document.querySelectorAll('[data-act=swappick]'), function (el) { return el.textContent.indexOf('杠铃深蹲') >= 0; })[0];
  if (!backSquat) throw new Error('列表里换不回深蹲');
  backSquat.click();
  await wait(60);
  click('[data-act=swapok]');
  await wait(120);
  if (text('.set-name').indexOf('杠铃深蹲') < 0) throw new Error('换回后不是深蹲：' + text('.set-name'));
  if (!document.querySelector('[data-act=logfix]')) throw new Error('换回后原来的组没了');
  await openMore();
  if (text('.action-sheet').indexOf('恢复') >= 0 && text('.action-sheet').indexOf('跳过本动作') < 0) throw new Error('还没跳过就显示恢复');
  click('[data-act=skip]');
  await wait(100);
  if (document.querySelector('.set-screen')) throw new Error('跳过后还停在记组页');
  report.skipped = text('.qm-item.is-skip .qm-meta');
  if (report.skipped.indexOf('已跳过') < 0) throw new Error('跳过没有标成已跳过：' + report.skipped);
  var skippedRow = document.querySelector('.qm-item.is-skip .qm-row');
  if (skippedRow) { skippedRow.click(); await wait(50); }
  click('[data-act=qmopen]');
  await wait(50);
  await openMore();
  if (text('.action-sheet').indexOf('恢复') < 0) throw new Error('跳过没有切到恢复：' + text('.action-sheet'));
  click('[data-act=skip]');
  await wait(80);
  report.restored = text('.qm-item .qm-meta');
  if (document.querySelector('.qm-item.is-skip')) throw new Error('恢复后仍是跳过');
  note('skip', { skipped: report.skipped, restored: report.restored });

  await openDetail('罗马尼亚硬拉');
  await openMore();
  click('[data-act=openswap]');
  await wait(120);
  var pick = [].filter.call(document.querySelectorAll('[data-act=swappick]'), function (el) { return !el.querySelector('.lib-cur'); })[0];
  if (!pick) throw new Error('更换列表里没有其他动作');
  var pickedName = pick.querySelector('.lib-n').childNodes[0].textContent.trim();
  pick.click();
  await wait(80);
  click('[data-act=swapok]');
  await wait(120);
  if (document.querySelector('.set-screen')) { click('[data-act=logback]'); await wait(80); }
  report.swapped = [].map.call(document.querySelectorAll('.qm-name'), function (el) { return el.childNodes[0].textContent.trim(); });
  report.pickedName = pickedName;
  if (report.swapped.indexOf(pickedName) < 0) throw new Error('本次更换没有出现 ' + pickedName + '：' + report.swapped.join(','));
  if (report.swapped.indexOf('罗马尼亚硬拉') >= 0) throw new Error('更换后原动作还在列表里');
  note('swap', { names: report.swapped });
  await openDetail('杠铃深蹲');
  var undoRows = document.querySelectorAll('[data-act=logfix]');
  if (!undoRows.length) throw new Error('恢复后没有可更正的组');
  undoRows[undoRows.length - 1].click();
  await wait(60);
  if (!document.querySelector('[data-act=logundo]')) throw new Error('最新一组不能撤销');
  click('[data-act=logundo]');
  await wait(80);
  click('[data-act=logback]');
  await wait(80);
  report.undot = document.querySelector('.qm-mini') ? 'pips' : '';
  if (report.undot) throw new Error('撤销组次后仍显示进度点');
  note('undo-set', { undot: report.undot || '0' });

  async function finishOpen() {
    for (var i = 0; i < 8; i++) {
      if (document.querySelector('.done-kicker')) return;
      var save = document.querySelector('[data-act=logsave]');
      if (!save) throw new Error('没有记下按钮，当前 ' + text('.set-name') + ' / ' + text('.home-cta'));
      save.click();
      await wait(50);
      var skipRest = document.querySelector('[data-act=logrestskip]');
      if (skipRest) { skipRest.click(); await wait(40); }
    }
    if (!document.querySelector('.done-kicker')) throw new Error('动作没有记完：' + text('.set-name'));
  }
  for (var n = 0; n < 8; n++) {
    if (!document.querySelector('.set-screen') && text('.home-cta') === '完成训练') break;
    if (!document.querySelector('.set-screen')) {
      if (text('.home-cta') === '完成训练') break;
      var nextRow = document.querySelector('.qm-row');
      if (!nextRow) throw new Error('没有可以继续记的动作');
      nextRow.click();
      await wait(50);
      click('[data-act=qmopen]');
      await wait(50);
    }
    await finishOpen();
    var nextEx = document.querySelector('[data-act=lognext]');
    if (nextEx) { nextEx.click(); await wait(50); }
    else if (document.querySelector('[data-act=logback]')) { click('[data-act=logback]'); await wait(50); }
  }
  if (text('.home-cta') !== '完成训练') throw new Error('五项都填了仍不是完成训练：' + text('.home-cta') + ' ' + text('.guide-title'));
  var recBeforeFail = records().length;
  window.__SEVEN_FAIL_DB = true;
  click('.home-cta');
  await wait(120);
  if (records().length !== recBeforeFail) throw new Error('整次保存失败却多了记录');
  if (document.body.innerText.indexOf('还没记到本机') < 0) throw new Error('整次保存失败没有提示');
  if (text('.home-cta') !== '完成训练') throw new Error('失败后按钮变成了 ' + text('.home-cta'));
  window.__SEVEN_FAIL_DB = false;
  var happyBefore = window.CompanionView.machine.snapshot().state;
  click('.home-cta');
  await wait(150);
  report.settlement = {
    title: text('.sheet-title'),
    companion: window.CompanionView.machine.snapshot().state,
    before: happyBefore,
    records: records().length
  };
  if (report.settlement.title !== '训练完成') throw new Error('结算标题是 ' + report.settlement.title);
  if (report.settlement.companion !== 'happy') throw new Error('保存成功后伙伴是 ' + report.settlement.companion + '，保存前是 ' + happyBefore);
  if (report.settlement.records < 1) throw new Error('保存后没有记录');
  var saved = records()[records().length - 1];
  report.savedV = saved.entries.A1_1 && saved.entries.A1_1.v;
  note('save', report.settlement);

  click('[data-act=closeResult]');
  await wait(100);
  click('[data-act=adjust]');
  await wait(80);
  click('[data-act=day][data-day="A1"]');
  await wait(100);
  if (document.querySelector('.session-sheet')) click('[data-act=menuclose]');
  await wait(80);
  if (text('.lk-t').indexOf('已完成') < 0) throw new Error('回到 A1 没有完成卡：' + text('.lk-t'));
  click('[data-act=editLocked]');
  await wait(100);
  if (!document.querySelector('.set-screen')) {
    var editRow = document.querySelector('.qm-row');
    if (editRow) { editRow.click(); await wait(60); }
    var editHead = document.querySelector('[data-act=qmopen]');
    if (editHead) editHead.click();
  }
  await wait(100);
  var fixes = document.querySelectorAll('[data-act=logfix]');
  if (!fixes.length) throw new Error('修改这次没有可更正的组');
  fixes[0].click();
  await wait(60);
  if (document.querySelector('[data-act=logundo]')) throw new Error('更正前面的组不该出现撤销后续组');
  var early = document.querySelector('[data-act=correps]');
  early.value = '9';
  early.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(40);
  click('[data-act=logwork]');
  await wait(60);
  if (document.body.innerText.indexOf('60 kg × 9') >= 0) throw new Error('取消更正仍写进了第 1 组');
  fixes = document.querySelectorAll('[data-act=logfix]');
  fixes[fixes.length - 1].click();
  await wait(60);
  var edit = document.querySelector('[data-act=correps]');
  if (!edit) throw new Error('修改这次没有次数输入');
  edit.value = '4';
  edit.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(40);
  click('[data-act=logcorrectsave]');
  await wait(80);
  click('[data-act=logback]');
  await wait(80);
  if (text('.home-cta') !== '保存修改') throw new Error('改正时按钮是 ' + text('.home-cta'));
  click('.home-cta');
  await wait(150);
  var corrected = records().filter(function (r) { return r.day === 'A1'; }).pop();
  report.correctedV = corrected.entries.A1_1.v;
  if (String(report.correctedV) !== '4') throw new Error('改正没有落成 4，而是 ' + report.correctedV);
  if (text('.sheet-title') !== '训练完成') throw new Error('改正保存没有结算');
  note('correct', { v: report.correctedV });

  click('[data-act=closeResult]');
  await wait(80);
  click('[data-act=adjust]');
  await wait(60);
  click('[data-act=day][data-day="A1"]');
  await wait(80);
  if (document.querySelector('.session-sheet')) click('[data-act=menuclose]');
  await wait(60);
  click('[data-act=editLocked]');
  await wait(80);
  click('[data-act=cancelEdit]');
  await wait(80);
  var still = records().filter(function (r) { return r.day === 'A1'; }).pop();
  report.afterCancel = still.entries.A1_1.v;
  if (String(report.afterCancel) !== '4') throw new Error('取消编辑改写了已保存的记录：' + report.afterCancel);
  note('cancel-edit', { v: report.afterCancel });
  report.ok = true;
  return JSON.stringify(report);
})()`;

async function main() {
  var server = serve();
  await new Promise(function (r) { server.listen(PORT, '127.0.0.1', r); });
  var chrome = spawn('google-chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=/tmp/seven-flow-' + Date.now(), '--remote-debugging-port=9333', 'about:blank'
  ], { stdio: 'ignore' });
  var list = null;
  for (var i = 0; i < 30; i++) {
    await sleep(200);
    try { list = await fetch('http://127.0.0.1:9333/json/version').then(function (r) { return r.json(); }); break; }
    catch (e) {}
  }
  if (!list) throw new Error('chrome 没有起来');
  var browser = await cdp(list.webSocketDebuggerUrl);

  async function openAt(w, h) {
    var t = await browser.send('Target.createTarget', { url: 'about:blank' });
    var a = await browser.send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
    var s = a.result.sessionId;
    await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }, s);
    await browser.send('Page.enable', {}, s);
    await browser.send('Runtime.enable', {}, s);
    await browser.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' }, s);
    await sleep(1600);
    return { id: t.result.targetId, s: s };
  }
  async function shot(session, name) {
    var pic = await browser.send('Page.captureScreenshot', { format: 'png' }, session);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(pic.result.data, 'base64'));
  }
  async function run(session, expression) {
    var msg = await browser.send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true }, session);
    if (msg.result.exceptionDetails) {
      var ex = msg.result.exceptionDetails;
      throw new Error((ex.exception && ex.exception.description) || ex.text || '页面脚本失败');
    }
    return msg.result.result.value;
  }

  var narrow = [['390x640', 390, 640], ['360x640', 360, 640]];
  for (var n = 0; n < narrow.length; n++) {
    var tab = await openAt(narrow[n][1], narrow[n][2]);
    var layout = await run(tab.s, `(function(){var scroller=document.querySelector('.home-scroll')||document.getElementById('body');scroller.scrollTop=scroller.scrollHeight;var rows=document.querySelectorAll('.qm-item');var last=rows[rows.length-1].getBoundingClientRect();var dock=document.querySelector('.tabbar').getBoundingClientRect();var cue=document.querySelector('.guide-title').getBoundingClientRect();var block=document.querySelector('.training-block').getBoundingClientRect();var hit=document.elementFromPoint(last.left+40,Math.min(last.bottom-8,dock.top-12));return JSON.stringify({gap:Math.round(dock.top-last.bottom),cueGap:Math.round(block.top-cue.bottom),last:Math.round(last.bottom),dock:Math.round(dock.top),hit:hit&&hit.closest('.tabbar')?'tab':hit&&hit.closest('.qm-row')?'row':'other'});})()`);
    var info = JSON.parse(layout);
    console.log(narrow[n][0], 'gap', info.gap, 'cue', info.cueGap, 'hit', info.hit);
    if (info.gap < 8 || info.hit === 'tab' || info.cueGap < 32) throw new Error(narrow[n][0] + ' 仍被挡住 ' + layout);
    await shot(tab.s, 'home-scrolled-' + narrow[n][0] + '.png');
    await browser.send('Target.closeTarget', { targetId: tab.id });
  }

  var flow = await openAt(390, 844);
  var raw = await run(flow.s, PAGE);
  console.log(raw);
  await shot(flow.s, 'home-after-save.png');
  var report = JSON.parse(raw);
  if (!report.ok) throw new Error('流程没有完成');
  fs.writeFileSync(path.join(OUT, 'home-flow.json'), JSON.stringify(report, null, 2));
  browser.close();
  chrome.kill();
  server.close();
  console.log('home flow ok');
}

main().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
