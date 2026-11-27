/**
 * 列表动效与末组「5+」露出。
 * 运行：node scripts/verify-motion.js
 * 不读、不写浏览器里的用户档案。截图写到 /opt/cursor/artifacts。
 */
var http = require('http');
var fs = require('fs');
var path = require('path');
var { spawn } = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var OUT = '/opt/cursor/artifacts';
var PORT = 8783;
fs.mkdirSync(OUT, { recursive: true });

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function serve() {
  return http.createServer(function (req, res) {
    var url = decodeURIComponent(req.url.split('?')[0]);
    var file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, function (err, buf) {
      if (err) { res.writeHead(404); res.end('missing'); return; }
      var ext = path.extname(file);
      var type = ext === '.js' ? 'text/javascript' : 'text/html; charset=utf-8';
      res.writeHead(200, { 'Content-Type': type });
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

function rgb(c) {
  var m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return c;
  return [m[1], m[2], m[3]].map(function (n) { return ('0' + Number(n).toString(16)).slice(-2); }).join('');
}

var MEASURE = `(function () {
  var card = document.querySelector('.qm-item.is-open');
  var sets = card && card.querySelector('.qm-sets');
  var nodes = card ? card.querySelectorAll('.qm-set') : [];
  var last = nodes[nodes.length - 1];
  var node = last && last.querySelector('.qm-node');
  var label = card && card.querySelector('.qm-stage-label');
  if (!card || !node || !label) return { missing: true };
  var cr = card.getBoundingClientRect();
  var nr = node.getBoundingClientRect();
  var lr = last.getBoundingClientRect();
  var lb = label.getBoundingClientRect();
  var inner = card.querySelector('.qm-body-inner');
  var ir = inner ? inner.getBoundingClientRect() : cr;
  var cs = getComputedStyle(sets);
  var confirmBtn = card.querySelector('.qm-confirm');
  var confirmCs = confirmBtn ? getComputedStyle(confirmBtn) : null;
  var widths = [].map.call(nodes, function (el) { return Math.round(el.getBoundingClientRect().width); });
  var nodeWidths = [].map.call(nodes, function (el) {
    var n = el.querySelector('.qm-node').getBoundingClientRect();
    return { w: Math.round(n.width), h: Math.round(n.height), t: el.querySelector('.qm-node').textContent };
  });
  return {
    inset: Math.round(lb.left - cr.left),
    clearance: Math.round((cr.right - nr.right) * 10) / 10,
    nodeInside: nr.left >= cr.left - 0.5 && nr.right <= cr.right + 0.5 && nr.top >= ir.top - 0.5 && nr.bottom <= ir.bottom + 0.5,
    glyph: node.textContent,
    overflowX: cs.overflowX,
    scrollGap: sets.scrollWidth - sets.clientWidth,
    btnWidths: widths,
    nodes: nodeWidths,
    confirm: confirmCs ? { bg: confirmCs.backgroundColor, color: confirmCs.color, disabled: confirmBtn.disabled } : null,
    rest: !!card.querySelector('[data-act=qmrest]'),
    transition: getComputedStyle(card.querySelector('.qm-body')).transitionProperty
  };
})()`;

async function main() {
  var css = fs.readFileSync(path.join(ROOT, 'source/preview/muse-home.css'), 'utf8');
  var js = fs.readFileSync(path.join(ROOT, 'source/preview/app-h5.js'), 'utf8');
  ['--duration-press: 90ms', '--duration-fast: 120ms', '--duration-default: 200ms', '--duration-layout: 240ms',
    '--duration-sheet-in: 260ms', '--duration-sheet-out: 200ms', '--ease-out: cubic-bezier(0, 0, 0.2, 1)',
    '--ease-in: cubic-bezier(0.4, 0, 1, 1)', '--motion-distance-sm: 6px', '--motion-distance-md: 8px',
    'grid-template-rows', 'scaleX(var(--logged, 0))', 'prefers-reduced-motion'].forEach(function (token) {
    if (css.indexOf(token) < 0) throw new Error('样式缺少 ' + token);
  });
  if (/transition:\s*all/.test(css)) throw new Error('出现了 transition: all');
  if (css.indexOf('padding: 8px 18px 4px 54px') < 0) throw new Error('训练区左内边不是 54px');
  if (css.indexOf('padding: 8px 18px 4px 62px') >= 0) throw new Error('训练区仍是 62px');
  ['kickMotion', 'spawnDetailGhost', 'spawnLayerGhost', '_expandSlot', '_restArm', '_gateArm'].forEach(function (token) {
    if (js.indexOf(token) < 0) throw new Error('脚本缺少 ' + token);
  });

  var server = serve();
  await new Promise(function (r) { server.listen(PORT, '127.0.0.1', r); });
  var chrome = spawn('google-chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=/tmp/seven-motion-' + Date.now(), '--remote-debugging-port=9344', 'about:blank'
  ], { stdio: 'ignore' });
  var list = null;
  for (var i = 0; i < 30; i++) {
    await sleep(200);
    try { list = await fetch('http://127.0.0.1:9344/json/version').then(function (r) { return r.json(); }); break; }
    catch (e) {}
  }
  if (!list) throw new Error('chrome 没有起来');
  var browser = await cdp(list.webSocketDebuggerUrl);

  async function openAt(w, h, reduce) {
    var t = await browser.send('Target.createTarget', { url: 'about:blank' });
    var a = await browser.send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
    var s = a.result.sessionId;
    await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true }, s);
    if (reduce) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
    }
    await browser.send('Page.enable', {}, s);
    await browser.send('Runtime.enable', {}, s);
    await browser.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' }, s);
    await sleep(1600);
    return { id: t.result.targetId, s: s };
  }
  async function run(session, expression) {
    var msg = await browser.send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true }, session);
    if (msg.result.exceptionDetails) {
      var ex = msg.result.exceptionDetails;
      throw new Error((ex.exception && ex.exception.description) || ex.text || '页面脚本失败');
    }
    return msg.result.result.value;
  }
  async function shot(session, name) {
    var pic = await browser.send('Page.captureScreenshot', { format: 'png' }, session);
    var file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(pic.result.data, 'base64'));
    return file;
  }

  var page = await openAt(390, 844, false);
  await shot(page.s, 'motion-collapsed.png');
  await run(page.s, `(function(){var row=document.querySelector('.qm-row'); if(!row) throw new Error('no row'); row.click();})()`);
  await sleep(400);
  await run(page.s, `(function(){document.querySelectorAll('.qm-item.is-open [data-act=qmset]')[1].click();})()`);
  await sleep(400);
  var mid = JSON.parse(await run(page.s, 'JSON.stringify(' + MEASURE + ')'));
  if (!mid.rest) throw new Error('非末组记下后没有休息提示 ' + JSON.stringify(mid));
  await shot(page.s, 'motion-mid-rest.png');

  await run(page.s, `(function(){document.querySelectorAll('.qm-item.is-open [data-act=qmset]')[3].click();})()`);
  await sleep(280);
  await run(page.s, `(function(){document.querySelectorAll('.qm-item.is-open [data-act=qmset]')[4].click();})()`);
  await sleep(400);
  var empty = JSON.parse(await run(page.s, 'JSON.stringify(' + MEASURE + ')'));
  await shot(page.s, 'motion-last-empty.png');

  await run(page.s, `(function(){var el=document.querySelector('[data-act=qreps]');el.value='6';el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(240);
  var filled = JSON.parse(await run(page.s, 'JSON.stringify(' + MEASURE + ')'));
  await shot(page.s, 'motion-last-filled.png');

  function assertFive(info, where) {
    if (info.missing) throw new Error(where + ' 没有展开卡');
    if (info.inset !== 54) throw new Error(where + ' 左内边是 ' + info.inset + '，不是 54');
    if (info.glyph !== '5+') throw new Error(where + ' 末组文字是 ' + info.glyph);
    if (info.overflowX === 'auto' || info.overflowX === 'scroll') throw new Error(where + ' 组序列仍可横滑 ' + info.overflowX);
    if (info.scrollGap > 1) throw new Error(where + ' 组序列出现滚动条 ' + info.scrollGap);
    if (!info.nodeInside) throw new Error(where + ' 「5+」圆被裁切');
    if (info.clearance < 14 || info.clearance > 28) throw new Error(where + ' 右侧空隙是 ' + info.clearance + 'px');
    info.nodes.forEach(function (n, i) {
      if (n.w < 30 || n.w > 34 || n.h < 30 || n.h > 34) throw new Error(where + ' 第 ' + (i + 1) + ' 圆是 ' + n.w + '×' + n.h);
    });
    info.btnWidths.forEach(function (w, i) {
      if (w < 44) throw new Error(where + ' 第 ' + (i + 1) + ' 热区只有 ' + w);
    });
  }
  assertFive(empty, '末组空');
  assertFive(filled, '末组已填');
  if (!empty.confirm || !empty.confirm.disabled) throw new Error('空末组确认键能点');
  if (rgb(empty.confirm.bg) !== 'ffffff') throw new Error('禁用确认底是 ' + empty.confirm.bg);
  if (rgb(empty.confirm.color) !== 'a0aaa4') throw new Error('禁用确认字是 ' + empty.confirm.color);
  if (!filled.confirm || filled.confirm.disabled) throw new Error('填了实际仍不能确认');
  if (rgb(filled.confirm.bg) !== '5bb887') throw new Error('可用确认底是 ' + filled.confirm.bg);
  if (rgb(filled.confirm.color) !== '141414') throw new Error('可用确认字是 ' + filled.confirm.color);
  if (filled.transition.indexOf('all') >= 0) throw new Error('展开体过渡了 all');

  await run(page.s, `(function(){document.querySelector('[data-act=qmopen]').click();})()`);
  await sleep(400);
  if (await run(page.s, `!!document.querySelector('#companionSlot')`)) throw new Error('详情里出现了伙伴');
  await shot(page.s, 'motion-detail.png');
  await run(page.s, `(function(){document.querySelector('[data-act=logmore]').click();})()`);
  await sleep(400);
  var sheet = JSON.parse(await run(page.s, `JSON.stringify((function(){var s=document.querySelector('.action-sheet');var m=document.querySelector('.qm-layer.mask');if(!s||!m)return{missing:true};var cs=getComputedStyle(s);var cm=getComputedStyle(m);return{transform:cs.transform,opacity:cm.opacity,bg:cm.backgroundColor,prop:cs.transitionProperty};})())`));
  if (sheet.missing) throw new Error('更多操作没有打开');
  if (sheet.prop.indexOf('all') >= 0) throw new Error('面板过渡了 all');
  if (sheet.transform !== 'none') throw new Error('面板打开后仍有位移 ' + sheet.transform);
  if (Number(sheet.opacity) < 0.9) throw new Error('遮罩没有显现');
  await shot(page.s, 'motion-more-sheet.png');
  await run(page.s, `(function(){document.querySelector('[data-act=logincomplete]').click();})()`);
  await sleep(400);
  await shot(page.s, 'motion-incomplete.png');
  var miss = JSON.parse(await run(page.s, `JSON.stringify((function(){var c=document.querySelector('.qm-miss');if(!c)return{missing:true};var cs=getComputedStyle(c);return{transform:cs.transform,opacity:cs.opacity,text:c.textContent.slice(0,24)};})())`));
  if (miss.missing) throw new Error('未完成层没有打开');
  if (Number(miss.opacity) < 0.9) throw new Error('未完成层没有显现');

  var narrow = await openAt(360, 700, false);
  await run(narrow.s, `(async function(){
    function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
    var row = null;
    for (var i = 0; i < 20 && !row; i++) { row = document.querySelector('.qm-row'); if (!row) await wait(100); }
    if (!row) throw new Error('360 没有列表');
    row.click();
    await wait(150);
    var sets = document.querySelectorAll('.qm-item.is-open [data-act=qmset]');
    if (!sets[4]) throw new Error('360 组点 ' + sets.length);
    sets[4].click();
    await wait(400);
  })()`);
  var narrowInfo = JSON.parse(await run(narrow.s, 'JSON.stringify(' + MEASURE + ')'));
  assertFive(narrowInfo, '360 宽');
  await shot(narrow.s, 'motion-last-360.png');

  var short = await openAt(390, 640, false);
  await run(short.s, `(async function(){function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}var row=null;for(var i=0;i<20&&!row;i++){row=document.querySelector('.qm-row');if(!row)await wait(100);}if(!row)throw new Error('短屏没有列表');row.click();})()`);
  await sleep(400);
  var gap = JSON.parse(await run(short.s, `JSON.stringify((function(){var cue=document.querySelector('.guide-title').getBoundingClientRect();var block=document.querySelector('.training-block').getBoundingClientRect();return{cueGap:Math.round(block.top-cue.bottom)};})())`));
  if (gap.cueGap < 32) throw new Error('短屏伙伴间隙只有 ' + gap.cueGap);
  await shot(short.s, 'motion-short-expanded.png');

  var reduce = await openAt(390, 844, true);
  await run(reduce.s, `(async function(){function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}var row=null;for(var i=0;i<20&&!row;i++){row=document.querySelector('.qm-row');if(!row)await wait(100);}if(!row)throw new Error('降低动效没有列表');row.click();})()`);
  await sleep(80);
  var reduced = JSON.parse(await run(reduce.s, `JSON.stringify((function(){var item=document.querySelector('.qm-item.is-open');var reveal=item.querySelector('.qm-reveal');var body=item.querySelector('.qm-body');var rs=getComputedStyle(reveal);var bs=getComputedStyle(body);return{transform:rs.transform,rows:bs.gridTemplateRows,delay:rs.transitionDelay,from:item.classList.contains('is-from')};})())`));
  if (reduced.transform !== 'none') throw new Error('降低动效仍有位移 ' + reduced.transform);
  if (reduced.from) throw new Error('降低动效展开还停在起始帧');
  await run(reduce.s, `(function(){document.querySelector('[data-act=qmopen]').click();})()`);
  await sleep(200);
  await run(reduce.s, `(function(){document.querySelector('[data-act=logmore]').click();})()`);
  await sleep(200);
  var reducedSheet = JSON.parse(await run(reduce.s, `JSON.stringify((function(){var s=document.querySelector('.action-sheet');return{transform:getComputedStyle(s).transform,opacity:getComputedStyle(s).opacity};})())`));
  if (reducedSheet.transform !== 'none') throw new Error('降低动效面板仍在滑入 ' + reducedSheet.transform);
  if (Number(reducedSheet.opacity) < 0.9) throw new Error('降低动效面板没有显现');
  await shot(reduce.s, 'motion-reduced.png');

  var report = { empty: empty, filled: filled, narrow: narrowInfo, short: gap, reduced: reduced, reducedSheet: reducedSheet, midRest: !!mid.rest };
  fs.writeFileSync(path.join(OUT, 'motion-measure.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  browser.close();
  chrome.kill();
  server.close();
  console.log('motion ok');
}

main().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
