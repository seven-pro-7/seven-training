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

  var body = document.getElementById('body');
  body.scrollTop = body.scrollHeight;
  await wait(60);
  var rows = document.querySelectorAll('.ex');
  var last = rows[rows.length - 1].getBoundingClientRect();
  var cta = document.querySelector('.home-cta').getBoundingClientRect();
  var dock = document.querySelector('.tabbar').getBoundingClientRect();
  var midX = last.left + Math.min(80, last.width / 2);
  var midY = last.top + last.height / 2;
  var hit = document.elementFromPoint(midX, midY);
  report.layout = {
    vw: window.innerWidth, vh: window.innerHeight,
    lastBottom: Math.round(last.bottom), ctaTop: Math.round(cta.top),
    gap: Math.round(cta.top - last.bottom),
    ctaBottom: Math.round(cta.bottom), dockTop: Math.round(dock.top),
    hit: hit ? (hit.closest('.home-cta') ? 'cta' : hit.closest('.ex-hit') ? 'row' : hit.className) : 'none',
    names: [].map.call(rows, function (el) { return el.querySelector('.name').childNodes[0].textContent.trim(); })
  };
  if (report.layout.gap < 8) throw new Error('滚到底后最后一项离按钮只有 ' + report.layout.gap + 'px');
  if (report.layout.hit === 'cta') throw new Error('最后一项的点击落在开始按钮上');
  if (last.bottom > cta.top) throw new Error('最后一项伸进了按钮');
  if (cta.bottom > dock.top + 1) throw new Error('按钮伸进了底栏');

  var beforeRec = records().length;
  rows[rows.length - 1].querySelector('.ex-hit').click();
  await wait(120);
  if (!document.querySelector('.set-screen')) throw new Error('点最后一项没有进入记组');
  if (document.querySelector('#companionSlot')) throw new Error('记组页出现了伙伴');
  var tab = document.querySelector('.tabbar');
  if (tab && getComputedStyle(tab).display !== 'none') throw new Error('记组页还有底栏');
  if (records().length !== beforeRec) throw new Error('点最后一项写入了训练记录');
  click('[data-act=logback]');
  await wait(80);
  if (document.querySelector('.set-screen')) throw new Error('返回后还在记组页');
  report.afterRow = { cta: text('.home-cta'), records: records().length };
  note('reach', report.afterRow);

  click('[data-act=adjust]');
  await wait(80);
  if (!document.querySelector('.session-sheet')) throw new Error('调整今天没有打开');
  click('[data-act=menuclose]');
  await wait(80);
  if (records().length !== beforeRec) throw new Error('调整今天写入了训练记录');

  var squat = [].filter.call(document.querySelectorAll('.ex-hit'), function (el) { return el.textContent.indexOf('杠铃深蹲') >= 0; })[0];
  squat.click();
  await wait(100);
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
  squat = [].filter.call(document.querySelectorAll('.ex-hit'), function (el) { return el.textContent.indexOf('杠铃深蹲') >= 0; })[0];
  squat.click();
  await wait(100);
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
  click('[data-act=skip]');
  await wait(100);
  if (document.querySelector('.set-screen')) throw new Error('跳过后还停在记组页');
  report.skipped = text('.ex.current .scheme') + ' / ' + text('.home-links');
  if (report.skipped.indexOf('已跳过') < 0 || report.skipped.indexOf('恢复') < 0) throw new Error('跳过没有切到恢复：' + report.skipped);
  click('[data-act=skip]');
  await wait(80);
  report.restored = text('.ex.current .scheme');
  if (report.restored.indexOf('已跳过') >= 0) throw new Error('恢复后仍是跳过');
  note('skip', { skipped: report.skipped, restored: report.restored });

  var rdl = [].filter.call(document.querySelectorAll('.ex-hit'), function (el) { return el.textContent.indexOf('罗马尼亚硬拉') >= 0; })[0];
  if (!rdl) throw new Error('找不到罗马尼亚硬拉');
  rdl.click();
  await wait(80);
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
  report.swapped = [].map.call(document.querySelectorAll('.ex .name'), function (el) { return el.childNodes[0].textContent.trim(); });
  report.pickedName = pickedName;
  if (report.swapped.indexOf(pickedName) < 0) throw new Error('本次更换没有出现 ' + pickedName + '：' + report.swapped.join(','));
  if (report.swapped.indexOf('罗马尼亚硬拉') >= 0) throw new Error('更换后原动作还在列表里');
  note('swap', { names: report.swapped });
  squat = [].filter.call(document.querySelectorAll('.ex-hit'), function (el) { return el.textContent.indexOf('杠铃深蹲') >= 0; })[0];
  squat.click();
  await wait(100);
  if (!document.querySelector('[data-act=logundo]')) throw new Error('恢复后没有可撤销的组');
  click('[data-act=logundo]');
  await wait(80);
  click('[data-act=logback]');
  await wait(80);
  report.undot = text('.sets-count');
  if (report.undot) throw new Error('撤销组次后仍显示 ' + report.undot);
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
      var start = document.querySelector('.home-cta');
      if (!start || start.getAttribute('data-act') === 'submit') break;
      start.click();
      await wait(80);
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
  if (!document.querySelector('.set-screen')) document.querySelector('.ex.current .ex-hit').click();
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
    '--user-data-dir=/tmp/seven-flow-profile', '--remote-debugging-port=9333', 'about:blank'
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
    var layout = await run(tab.s, `(function(){var body=document.getElementById('body');body.scrollTop=body.scrollHeight;var rows=document.querySelectorAll('.ex');var last=rows[rows.length-1].getBoundingClientRect();var cta=document.querySelector('.home-cta').getBoundingClientRect();var dock=document.querySelector('.tabbar').getBoundingClientRect();var hit=document.elementFromPoint(last.left+40,last.top+last.height/2);return JSON.stringify({gap:Math.round(cta.top-last.bottom),last:Math.round(last.bottom),cta:Math.round(cta.top),dock:Math.round(dock.top),ctaBottom:Math.round(cta.bottom),hit:hit&&hit.closest('.home-cta')?'cta':hit&&hit.closest('.ex-hit')?'row':'other'});})()`);
    var info = JSON.parse(layout);
    console.log(narrow[n][0], 'gap', info.gap, 'hit', info.hit, 'cta/dock', info.ctaBottom, info.dock);
    if (info.gap < 8 || info.hit === 'cta' || info.ctaBottom > info.dock + 1) throw new Error(narrow[n][0] + ' 仍被挡住 ' + layout);
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
