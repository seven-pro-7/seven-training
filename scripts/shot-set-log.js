/**
 * 拍下记组六态，并检查矮屏按钮不挡内容、刷新后草稿还在、写入失败可重试。
 * node scripts/shot-set-log.js
 */
var http = require('http');
var fs = require('fs');
var path = require('path');
var { spawn } = require('child_process');
var ROOT = path.resolve(__dirname, '..');
var OUT = '/opt/cursor/artifacts';
var PORT = 8788;
fs.mkdirSync(OUT, { recursive: true });
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function serve() {
  return http.createServer(function (req, res) {
    var url = decodeURIComponent(req.url.split('?')[0]);
    var file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
    fs.readFile(file, function (err, buf) {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(buf);
    });
  });
}
async function cdp(wsUrl) {
  var ws = new WebSocket(wsUrl);
  await new Promise(function (res, rej) { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
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
  var server = serve();
  await new Promise(function (r) { server.listen(PORT, '127.0.0.1', r); });
  var chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', '--user-data-dir=/tmp/seven-setlog', '--remote-debugging-port=9344', 'about:blank'], { stdio: 'ignore' });
  var ver = null;
  for (var i = 0; i < 30; i++) { await sleep(200); try { ver = await fetch('http://127.0.0.1:9344/json/version').then(function (r) { return r.json(); }); break; } catch (e) {} }
  if (!ver) throw new Error('no chrome');
  var b = await cdp(ver.webSocketDebuggerUrl);
  async function tab(w, h) {
    var t = await b.send('Target.createTarget', { url: 'about:blank' });
    var a = await b.send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
    var s = a.result.sessionId;
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }, s);
    await b.send('Page.enable', {}, s);
    await b.send('Runtime.enable', {}, s);
    await b.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' }, s);
    await sleep(1500);
    return { id: t.result.targetId, s: s };
  }
  async function ev(s, expr) {
    var msg = await b.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s);
    if (msg.result.exceptionDetails) throw new Error(msg.result.exceptionDetails.exception && msg.result.exceptionDetails.exception.description || msg.result.exceptionDetails.text);
    return msg.result.result.value;
  }
  async function shot(s, name) {
    var pic = await b.send('Page.captureScreenshot', { format: 'png' }, s);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(pic.result.data, 'base64'));
  }
  if (process.argv[2] === 'short') {
    async function freshOnly(w, h, file) {
      var p = await tab(w, h);
      var cleared = await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:' + PORT, storageTypes: 'all' });
      console.log('clear', JSON.stringify(cleared.result || cleared.error || cleared));
      await b.send('Page.reload', {}, p.s);
      await sleep(1600);
      console.log(file, await ev(p.s, `(async function(){function wait(ms){return new Promise(function(r){setTimeout(r,ms);});} for (var n=0;n<8;n++){ var b=document.querySelector('.home-cta'); if(b && b.getAttribute('data-act')==='startlog'){ b.click(); await wait(300); if(document.querySelector('.set-screen')) return document.querySelector('.set-screen').className+' | '+document.querySelector('.home-cta').textContent; } await wait(250);} return 'home '+(document.querySelector('.home-cta')||{}).textContent;})()`));
      var gap = await ev(p.s, `(function(){var body=document.getElementById('body'); var last=document.querySelector('.rep-panel'); var cta=document.querySelector('.log-bottom .home-cta'); if(!last||!cta) return 'missing'; body.scrollTop=body.scrollHeight; var a=last.getBoundingClientRect(), c=cta.getBoundingClientRect(); return JSON.stringify({gap:Math.round(c.top-a.bottom), ctaBottom:Math.round(c.bottom), vh:innerHeight, overlap:a.bottom>c.top+1});})()`);
      console.log(file, gap);
      await shot(p.s, file);
    }
    await freshOnly(390, 640, 'log-work-390x640.png');
    await freshOnly(360, 640, 'log-work-360x640.png');
    b.close(); chrome.kill(); server.close();
    return;
  }
  var page = await tab(390, 844);
  var open = `(async function(){
    function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
    function text(sel){var el=document.querySelector(sel); return el?el.textContent.replace(/\\s+/g,' ').trim():'';}
    window.__errs=[];
    window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
    await wait(800);
    var seen=[];
    for (var n=0;n<6;n++) {
      var b=document.querySelector('.home-cta');
      seen.push(b?b.getAttribute('data-act')+':'+text('.home-cta'):'none');
      if (b && (b.getAttribute('data-act')==='startlog' || text('.home-cta').indexOf('开始')===0 || text('.home-cta').indexOf('继续')===0)) b.click();
      await wait(500);
      if (document.querySelector('.set-screen')) {
        if (document.querySelector('#companionSlot')) throw new Error('记组页不该有伙伴');
        var tab=document.querySelector('.tabbar');
        if (tab && getComputedStyle(tab).display!=='none') throw new Error('记组页不该有底栏');
        return text('.set-name')+' | '+text('.home-cta');
      }
    }
    throw new Error('没有进入记组 '+seen.join(' > ')+' errs '+window.__errs.join('|'));
  })()`;
  console.log('work', await ev(page.s, open));
  await shot(page.s, 'log-work-390x844.png');
  console.log('commit1', await ev(page.s, `(async function(){function wait(ms){return new Promise(function(r){setTimeout(r,ms);});} document.querySelector('[data-act=logsave]').click(); await wait(200); return document.querySelector('.rest-kicker').textContent; })()`));
  await shot(page.s, 'log-rest-390x844.png');
  await ev(page.s, `document.querySelector('[data-act=logrestskip]').click()`);
  await sleep(200);
  console.log('after skip rest', await ev(page.s, `document.querySelector('.home-cta').textContent`));
  await ev(page.s, `document.querySelector('[data-act=logfix]').click()`);
  await sleep(150);
  console.log('correct', await ev(page.s, `document.querySelector('.set-name').textContent+' '+(document.querySelector('.origin-card b')||{}).textContent`));
  await shot(page.s, 'log-correct-390x844.png');
  await ev(page.s, `document.querySelector('[data-act=logwork]').click()`);
  await sleep(120);
  await ev(page.s, `(async function(){function wait(ms){return new Promise(function(r){setTimeout(r,ms);});} for (var i=0;i<3;i++){ document.querySelector('[data-act=logsave]').click(); await wait(150); var skip=document.querySelector('[data-act=logrestskip]'); if(skip){skip.click(); await wait(120);} } return document.querySelector('.path-cap')?document.querySelector('.path-cap').textContent:document.querySelector('.home-cta').textContent; })()`);
  console.log('amrap', await ev(page.s, `document.body.innerText.indexOf('末组')>=0 ? 'yes '+document.querySelector('.home-cta').textContent : document.querySelector('.home-cta').textContent`));
  await shot(page.s, 'log-amrap-390x844.png');
  await ev(page.s, `window.__SEVEN_FAIL_OPEN=true; document.querySelector('[data-act=logsave]').click()`);
  await sleep(200);
  console.log('fail', await ev(page.s, `document.querySelector('.set-name').textContent`));
  await shot(page.s, 'log-fail-390x844.png');
  await ev(page.s, `window.__SEVEN_FAIL_OPEN=false; document.querySelector('[data-act=logretry]').click()`);
  await sleep(200);
  var beforeReload = await ev(page.s, `(function(){var open=JSON.parse(localStorage.getItem('training_open_v1')||'null'); var rec=JSON.parse(localStorage.getItem('training_db_v1')||'{}'); return JSON.stringify({groups: open && open.drafts && open.drafts.A1 && open.drafts.A1.A1_1 && open.drafts.A1.A1_1.groups && open.drafts.A1.A1_1.groups.length, records:(rec.records||[]).length});})()`);
  console.log('before reload', beforeReload);
  await b.send('Page.reload', {}, page.s);
  await sleep(1600);
  console.log('reopen', await ev(page.s, `(async function(){function wait(ms){return new Promise(function(r){setTimeout(r,ms);});} for (var n=0;n<8;n++){ var b=document.querySelector('.home-cta'); if(b) b.click(); await wait(400); if(document.querySelector('.set-screen')) return 'in'; } return 'home '+(document.querySelector('.home-cta')||{}).textContent; })()`));
  console.log('after reload', await ev(page.s, `(function(){var open=JSON.parse(localStorage.getItem('training_open_v1')||'null'); var rec=JSON.parse(localStorage.getItem('training_db_v1')||'{}'); var groups=open&&open.drafts&&open.drafts.A1&&open.drafts.A1.A1_1&&open.drafts.A1.A1_1.groups; return JSON.stringify({groups:groups&&groups.length, records:(rec.records||[]).length, screen:document.querySelector('.done-kicker')?document.querySelector('.done-kicker').textContent:(document.querySelector('.path-cap')||{}).textContent, rows:document.querySelectorAll('.set-log-row').length});})()`));
  console.log('done screen', await ev(page.s, `(function(){var k=document.querySelector('.done-kicker'), c=document.querySelector('.home-cta'), j=document.querySelector('.engine-j'); return (k?k.textContent:'')+' | '+(c?c.textContent:'')+' | '+(j?j.textContent:'');})()`));
  await shot(page.s, 'log-done-390x844.png');
  await b.send('Target.closeTarget', { targetId: page.id });
  async function freshWork(w, h, file) {
    var p = await tab(w, h);
    await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:' + PORT, storageTypes: 'all' }, p.s);
    await b.send('Page.reload', {}, p.s);
    await sleep(1600);
    console.log(file, 'open', await ev(p.s, `(async function(){function wait(ms){return new Promise(function(r){setTimeout(r,ms);});} for (var n=0;n<8;n++){ var b=document.querySelector('.home-cta'); if(b && b.getAttribute('data-act')==='startlog'){ b.click(); await wait(300); if(document.querySelector('.set-screen')) return document.querySelector('.set-name').textContent; } await wait(300);} return 'no '+(document.querySelector('.home-cta')||{}).textContent;})()`));
    var gap = await ev(p.s, `(function(){var body=document.getElementById('body'); var last=document.querySelector('.rep-panel'); var cta=document.querySelector('.log-bottom .home-cta'); var links=document.querySelector('.log-bottom .home-links')||document.querySelector('.text-link'); if(!last||!cta) return 'missing '+document.querySelector('.set-name').textContent; body.scrollTop=body.scrollHeight; var a=last.getBoundingClientRect(), c=cta.getBoundingClientRect(); var lb=links?links.getBoundingClientRect():c; return JSON.stringify({gap:Math.round(c.top-a.bottom), ctaTop:Math.round(c.top), ctaBottom:Math.round(c.bottom), linksBottom:Math.round(lb.bottom), vh:window.innerHeight, overlap:a.bottom>c.top+1, name:document.querySelector('.set-name').textContent, cta:cta.textContent});})()`);
    console.log(file, gap);
    await shot(p.s, file);
    await b.send('Target.closeTarget', { targetId: p.id });
  }
  await freshWork(390, 640, 'log-work-390x640.png');
  await freshWork(360, 640, 'log-work-360x640.png');
  b.close(); chrome.kill(); server.close();
  console.log('shots ok');
}
main().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
