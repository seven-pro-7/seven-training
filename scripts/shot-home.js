/**
 * 用隔离的 Chrome 配置打开本机构建页，写入演示档案后截图。
 * 不读取、不修改开发者自己的浏览器数据。
 * 运行：node scripts/shot-home.js [port]
 */
var http = require('http');
var fs = require('fs');
var path = require('path');
var { spawn } = require('child_process');
var GZ = require('../source/utils/engine.js');

var ROOT = path.resolve(__dirname, '..');
var OUT = '/opt/cursor/artifacts';
var PORT = Number(process.argv[2]) || 8765;
fs.mkdirSync(OUT, { recursive: true });

function fixture(live) {
  var db = GZ.normalize(GZ.defaults(false));
  var open = null;
  if (live) {
    var draft = GZ.blankDraft(db, 'A1');
    draft.A1_1.done = 2;
    open = GZ.packOpenSession({
      day: 'A1', draft: draft, drafts: { A1: draft }, date: '2026-11-13',
      focus: 'A1_1', focusKey: 'A1|'
    });
  }
  return { db: JSON.stringify(db), open: open ? JSON.stringify(open) : '' };
}

function page(name, live) {
  var fx = fixture(live);
  var html = '<!DOCTYPE html><meta charset="utf-8"><title>' + name + '</title><script>' +
    'localStorage.setItem("training_db_v1", ' + JSON.stringify(fx.db) + ');' +
    (fx.open ? 'localStorage.setItem("training_open_v1", ' + JSON.stringify(fx.open) + ');' : 'localStorage.removeItem("training_open_v1");') +
    'location.replace("./index.html");</script>';
  fs.writeFileSync(path.join(ROOT, name), html);
}

var server = http.createServer(function (req, res) {
  var url = decodeURIComponent(req.url.split('?')[0]);
  var file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404); res.end('missing'); return; }
    var ext = path.extname(file);
    var type = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(buf);
  });
});

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function cdp(wsUrl) {
  var ws = new WebSocket(wsUrl);
  await new Promise(function (resolve, reject) { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
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

async function main() {
  page('_shot_ready.html', false);
  page('_shot_live.html', true);
  await new Promise(function (resolve) { server.listen(PORT, '127.0.0.1', resolve); });
  var chrome = spawn('google-chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=/tmp/seven-shot-profile', '--remote-debugging-port=9223',
    'about:blank'
  ], { stdio: 'ignore' });
  var list = null;
  for (var attempt = 0; attempt < 20; attempt++) {
    await sleep(300);
    try { list = await fetch('http://127.0.0.1:9223/json/version').then(function (r) { return r.json(); }); break; }
    catch (e) {}
  }
  if (!list) throw new Error('chrome devtools did not start');
  var browser = await cdp(list.webSocketDebuggerUrl);
  var shots = [
    ['ready', 360, 780], ['ready', 390, 844], ['ready', 430, 900],
    ['ready', 1280, 800], ['ready', 390, 640],
    ['live', 360, 780], ['live', 390, 844], ['live', 430, 900],
    ['live', 1280, 800], ['live', 390, 640]
  ];
  var notes = [];
  for (var i = 0; i < shots.length; i++) {
    var mode = shots[i][0], w = shots[i][1], h = shots[i][2];
    var target = await browser.send('Target.createTarget', { url: 'about:blank' });
    var tid = target.result.targetId;
    var created = await new Promise(function (resolve) {
      var id = 0;
      var ws = browser;
      resolve(browser.send('Target.attachToTarget', { targetId: tid, flatten: true }));
    });
    var sessionId = created.result.sessionId;
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: w < 800
    }, sessionId);
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/_shot_' + mode + '.html' }, sessionId);
    await sleep(1600);
    var probe = await browser.send('Runtime.evaluate', {
      expression: '(function(){var t=document.querySelector(".guide-title");var cta=document.querySelector(".home-cta");var when=document.querySelector(".when-line");var pos=document.querySelector(".session-position");var rows=[].map.call(document.querySelectorAll(".ex .name"),function(n){return n.childNodes[0]?n.childNodes[0].textContent.trim():n.textContent.trim();});var dock=[].map.call(document.querySelectorAll(".tb-item"),function(n){return n.textContent.trim();});function box(el){if(!el)return null;var r=el.getBoundingClientRect();return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),r:Math.round(r.right),h:Math.round(r.height)};}var gear=document.querySelector(".gear-btn");var action=document.querySelector(".home-action");var block=document.querySelector(".training-block");var title=document.querySelector(".guide-title");var overlap=false;if(action&&block){var a=action.getBoundingClientRect(),b=block.getBoundingClientRect();var list=document.querySelector(".ex-list");if(list){var lr=list.getBoundingClientRect();overlap=a.top<lr.bottom-8&&a.bottom>lr.top+8&&lr.bottom>a.top+20;}}return JSON.stringify({title:t&&t.textContent,cta:cta&&cta.textContent,when:when&&when.textContent,pos:pos&&pos.textContent.replace(/\\s+/g," "),rows:rows,dock:dock,gear:box(gear),action:box(action),titleBox:box(title),block:box(block),vh:window.innerHeight,vw:window.innerWidth,gap:title&&block?Math.round(block.getBoundingClientRect().top-title.getBoundingClientRect().bottom):null});})()',
      returnByValue: true
    }, sessionId);
    var info = JSON.parse(probe.result.result.value);
    notes.push({ mode: mode, w: w, h: h, info: info });
    var shot = await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    var file = path.join(OUT, 'home-' + mode + '-' + w + 'x' + h + '.png');
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    await browser.send('Target.closeTarget', { targetId: tid });
    console.log(mode, w + 'x' + h, info.when, '|', info.title, '|', info.cta, '| gap', info.gap);
  }
  fs.writeFileSync(path.join(OUT, 'home-layout.json'), JSON.stringify(notes, null, 2));
  browser.close();
  chrome.kill();
  server.close();
  fs.unlinkSync(path.join(ROOT, '_shot_ready.html'));
  fs.unlinkSync(path.join(ROOT, '_shot_live.html'));
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
