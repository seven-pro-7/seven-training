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
  await wait(80);
  report.afterRow = { cta: text('.home-cta'), sets: text('.sets-count'), records: records().length, prompt: text('.guide-title') };
  if (report.afterRow.records !== beforeRec) throw new Error('点最后一项写入了训练记录');
  if (report.afterRow.sets) throw new Error('点最后一项记了一组');
  if (/已记下/.test(report.afterRow.prompt)) throw new Error('点最后一项被当成记组');

  click('[data-act=adjust]');
  await wait(80);
  if (!document.querySelector('.session-sheet')) throw new Error('调整今天没有打开');
  click('[data-act=menuclose]');
  await wait(80);
  if (records().length !== beforeRec) throw new Error('调整今天写入了训练记录');
  note('reach', report.afterRow);

  var squat = [].filter.call(document.querySelectorAll('.ex-hit'), function (el) { return el.textContent.indexOf('杠铃深蹲') >= 0; })[0];
  squat.click();
  await wait(80);
  click('.home-cta');
  await wait(100);
  var firstDot = document.querySelector('.ex-log [data-act=dot][data-i="0"]');
  if (!firstDot) throw new Error('深蹲记组没有组次点');
  firstDot.click();
  await wait(80);
  report.dotted = text('.sets-count');
  if (report.dotted.indexOf('1 /') !== 0) throw new Error('点第 1 组后不是 1 组：' + report.dotted);
  var stop = document.querySelector('[data-rest-stop]');
  if (stop) stop.click();
  var skipBtn = document.querySelector('[data-act=skip]');
  if (!skipBtn) throw new Error('没有跳过按钮，链接是 ' + (document.querySelector('.home-links') ? document.querySelector('.home-links').innerHTML : '无') + ' 组次 ' + text('.sets-count'));
  skipBtn.click();
  await wait(80);
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
  report.swapped = [].map.call(document.querySelectorAll('.ex .name'), function (el) { return el.childNodes[0].textContent.trim(); });
  report.pickedName = pickedName;
  if (report.swapped.indexOf(pickedName) < 0) throw new Error('本次更换没有出现 ' + pickedName + '：' + report.swapped.join(','));
  if (report.swapped.indexOf('罗马尼亚硬拉') >= 0) throw new Error('更换后原动作还在列表里');
  note('swap', { names: report.swapped });
  squat = [].filter.call(document.querySelectorAll('.ex-hit'), function (el) { return el.textContent.indexOf('杠铃深蹲') >= 0; })[0];
  squat.click();
  await wait(80);
  if (!document.querySelector('.ex-log [data-act=dot]')) { click('.home-cta'); await wait(80); }
  firstDot = document.querySelector('.ex-log [data-act=dot][data-i="0"]');
  if (!firstDot) throw new Error('换回来后没有组次点可撤销');
  firstDot.click();
  await wait(80);
  stop = document.querySelector('[data-rest-stop]');
  if (stop) stop.click();
  report.undot = text('.sets-count');
  if (report.undot) throw new Error('撤销组次后仍显示 ' + report.undot);
  note('undo-set', { dotted: report.dotted, undot: report.undot || '0' });

  for (var n = 0; n < 8; n++) {
    if (text('.home-cta') === '完成训练') break;
    var pending = document.querySelector('.ex:not(.is-done) .ex-hit');
    if (!pending) break;
    var pendingEx = pending.closest('.ex');
    if (!pendingEx.classList.contains('current') || !pendingEx.querySelector('.ex-log')) {
      pending.click();
      await wait(100);
    }
    if (!document.querySelector('.ex.current .ex-log')) { click('.home-cta'); await wait(100); }
    var doneBtn = document.querySelector('.ex-log [data-act=done][data-v="完成"]');
    if (doneBtn) { doneBtn.click(); await wait(120); continue; }
    var amrap = document.querySelector('.ex-log [data-act=amrap]');
    if (!amrap) throw new Error('没有记组控件，按钮是 ' + text('.home-cta') + '，当前 ' + text('.ex.current .name'));
    var goal = parseInt(amrap.getAttribute('placeholder'), 10);
    amrap.value = String(goal > 0 ? goal : 8);
    amrap.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(40);
    var curHit = document.querySelector('.ex.current .ex-hit');
    if (curHit) curHit.click();
    await wait(100);
  }
  if (text('.home-cta') !== '完成训练') throw new Error('五项都填了仍不是完成训练：' + text('.home-cta'));
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
  if (!document.querySelector('.ex-log')) document.querySelector('.ex.current .ex-hit').click();
  await wait(80);
  var edit = document.querySelector('.ex-log [data-act=amrap]');
  if (!edit) throw new Error('修改这次没有末组输入');
  edit.value = '4';
  edit.dispatchEvent(new Event('input', { bubbles: true }));
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
