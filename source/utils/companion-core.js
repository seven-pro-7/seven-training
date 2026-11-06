/**
 * 训练伙伴一期：只允许 idle / listen / comfort / sleep / happy / surprise。
 * think、reply 不注册、不可进入。绘制与状态机都不依赖 DOM，网页动画层另接。
 * 小程序不能跑这套弹簧 SVG 时，用 staticDocument('idle') 做静态兜底。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CompanionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var CX = 200, BASE = 305, TAU = Math.PI * 2;
  var C = { body: '#6CB6A0', ink: '#2C5A52', yellow: '#F4C64E', acc: '#5FAA93', lav: '#8E92D6', glow: '#F7E3A6' };
  var ALLOWED = { idle: 'loop', listen: 'loop', comfort: 'loop', sleep: 'loop', happy: 'once', surprise: 'once' };
  var ONCE_MS = { happy: 2000, surprise: 1700 };
  var PREVIEW_LOOP_MS = 1600;
  var PREVIEW_THROTTLE_MS = 400;
  var COOLDOWN_MS = 30000;
  var QUEUE_MS = 3000;
  var LISTEN_GAP_MS = 800;
  var SLEEP_MS = 5 * 60 * 1000;
  var SLEEP_NIGHT_MS = 60 * 1000;
  var BASEP = { W: 116, H: 190, square: 0, pinch: 0, arm: 0, lean: 0, bulge: 0, wave: 0.06, flare: 1, eyeOpen: 1, eyeArc: 0, eyeR: 1, lookX: 0, lookY: 0, eyeGap: 1, eyeY: 0.66, smile: 1, mouthW: 1, mouthO: 0, mouthVis: 1, waves: 0, dots: 0, lines: 0, sparkle: 0, glow: 0, burst: 0, zzz: 0, shadow: 0 };
  var POSE = {
    idle: {},
    listen: { lean: 0.12, bulge: 0.1, lookX: 0.55, eyeR: 1.08, mouthO: 1, mouthW: 0.45, waves: 1 },
    comfort: { W: 124, H: 165, arm: 1, eyeOpen: 0, eyeArc: 0.55, smile: 0.9, mouthW: 0.8, glow: 1, lookY: 0.25 },
    sleep: { W: 148, H: 112, wave: 0.04, flare: 1.15, eyeOpen: 0, eyeArc: -1, smile: 0.3, mouthW: 0.45, eyeY: 0.5, zzz: 1 },
    happy: { eyeOpen: 0, eyeArc: 1, smile: 1.7, mouthW: 1.15, sparkle: 1, shadow: 1 },
    surprise: { W: 98, H: 215, pinch: 0.35, flare: 0.6, eyeR: 1.28, mouthO: 1, mouthW: 0.85, burst: 1, lookY: -0.25 }
  };
  var STATIC_T = { idle: 0, listen: 0.4, comfort: 0, sleep: 1, happy: 0.475, surprise: 0.42 };
  var KEYS = Object.keys(BASEP);

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, x) { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
  function easeOutBack(x) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
  function n1(v) { return Math.round(v * 10) / 10; }
  function targetOf(s) { var p = {}; KEYS.forEach(function (k) { p[k] = BASEP[k]; }); var extra = POSE[s] || {}; Object.keys(extra).forEach(function (k) { p[k] = extra[k]; }); return p; }

  function contour(p) {
    var W = p.W, H = p.H, s = clamp01(p.square);
    var DOME = [[0.34, 0.975], [0.58, 0.9], [0.72, 0.78], [0.79, 0.62], [0.83, 0.46], [0.88, 0.30], [1.0, 0.14], [0.78, 0]];
    var SQ = [[0.70, 0.995], [0.90, 0.97], [0.95, 0.85], [0.96, 0.65], [0.96, 0.45], [0.96, 0.30], [1.0, 0.08], [0.86, 0]];
    var PIN = [1, 0.85, 0.6, 0.4, 0.25, 0, 0, 0];
    var R = DOME.map(function (q, i) { return [lerp(q[0], SQ[i][0], s) * (1 - p.pinch * PIN[i]), lerp(q[1], SQ[i][1], s)]; });
    R[6][0] = R[5][0] + (R[6][0] - R[5][0]) * p.flare;
    var a = p.arm;
    R[6] = [R[6][0] + 0.2 * a, R[6][1] + 0.2 * a]; R[5][0] += 0.1 * a; R[5][1] += 0.04 * a; R[7][0] += 0.1 * a;
    var pt = function (dx, dy) { return [CX + dx * W + p.lean * dy * H, BASE - dy * H]; };
    var pts = [pt(0, 1)];
    R.forEach(function (q, i) { pts.push(pt(q[0] + ((i >= 3 && i <= 5) ? p.bulge : 0), q[1])); });
    pts.push(pt(0, p.wave));
    for (var i = R.length - 1; i >= 0; i--) pts.push(pt(-R[i][0], R[i][1]));
    return pts;
  }
  function crPath(P) {
    var n = P.length, d = 'M' + n1(P[0][0]) + ',' + n1(P[0][1]);
    for (var i = 0; i < n; i++) {
      var p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      d += 'C' + n1(p1[0] + (p2[0] - p0[0]) / 6) + ',' + n1(p1[1] + (p2[1] - p0[1]) / 6) + ' ' + n1(p2[0] - (p3[0] - p1[0]) / 6) + ',' + n1(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + n1(p2[0]) + ',' + n1(p2[1]);
    }
    return d + 'Z';
  }
  function computeFrame(st, t, base, isStatic) {
    var p = {}; KEYS.forEach(function (k) { p[k] = base[k]; });
    var jy = 0, op = 1, S = Math.sin;
    var blink = function (per, at) { if (isStatic) return; var ph = ((t % per) + per) % per, d = ph - at; if (d > 0 && d < 0.18) { var b = 1 - Math.abs(d - 0.09) / 0.09; p.eyeOpen *= 1 - 0.95 * b; } };
    var seg = function (a, b) { return clamp01((t - a) / (b - a)); };
    if (st === 'idle') { var b0 = S(TAU * t / 3.2); p.H *= 1 + 0.022 * b0; p.W *= 1 - 0.012 * b0; blink(6.4, 3.6); }
    else if (st === 'listen') { p.lean += 0.025 * S(TAU * t / 1.6); p.H *= 1 + 0.014 * S(TAU * t / 0.8); blink(4.2, 2.0); }
    else if (st === 'comfort') { var b1 = S(TAU * t / 3.6); p.lean += 0.03 * b1; p.arm *= 0.92 + 0.08 * S(TAU * t / 1.8); p.H *= 1 + 0.015 * b1; }
    else if (st === 'sleep') { var b2 = S(TAU * t / 4.8); p.H *= 1 + 0.05 * b2; p.W *= 1 - 0.02 * b2; }
    else if (st === 'happy') {
      if (t < 0.15) { var k = S(Math.PI * t / 0.15); p.W *= 1 + 0.14 * k; p.H *= 1 - 0.15 * k; }
      else if (t < 0.8) { var u = seg(0.15, 0.8); jy = -46 * 4 * u * (1 - u); var k2 = S(Math.PI * u); p.H *= 1 + 0.1 * k2; p.W *= 1 - 0.06 * k2; }
      else if (t < 0.95) { var k3 = S(Math.PI * seg(0.8, 0.95)); p.W *= 1 + 0.12 * k3; p.H *= 1 - 0.13 * k3; }
      else if (t < 1.4) { var u2 = seg(0.95, 1.4); jy = -22 * 4 * u2 * (1 - u2); var k4 = S(Math.PI * u2); p.H *= 1 + 0.05 * k4; p.W *= 1 - 0.03 * k4; }
      else if (t < 1.52) { var k5 = S(Math.PI * seg(1.4, 1.52)); p.W *= 1 + 0.06 * k5; p.H *= 1 - 0.06 * k5; }
    } else if (st === 'surprise') {
      if (t < 0.1) { var k6 = S(Math.PI * t / 0.1); p.H *= 1 - 0.1 * k6; p.W *= 1 + 0.08 * k6; }
      jy = -14 * S(Math.PI * seg(0.1, 0.6)); blink(10, 1.25);
    }
    p.eyeOpen = Math.max(0, p.eyeOpen);
    return { p: p, jy: jy, op: op, t: t, st: st, isStatic: isStatic };
  }
  function star(x, y, s, fill, rot) {
    return '<path transform="translate(' + n1(x) + ',' + n1(y) + ') rotate(' + n1(rot) + ') scale(' + (s / 10).toFixed(3) + ')" d="M0,-10Q0,0 10,0Q0,0 0,10Q0,0 -10,0Q0,0 0,-10Z" fill="' + fill + '"/>';
  }
  function buildSVG(f) {
    var p = f.p, t = f.t, st = f.st, S = Math.sin, stat = f.isStatic;
    var size = f.size || 'M';
    if (size !== 'L') { p.sparkle = 0; p.lines = 0; }
    if (size === 'S') { p.waves = 0; p.glow = 0; p.burst = 0; p.zzz = 0; p.shadow = 0; }
    var pts = contour(p), topY = BASE - p.H;
    var faceH = p.eyeY * p.H;
    var fx = CX + p.lean * faceH + p.bulge * p.W * 0.3;
    var ey = BASE - faceH + p.lookY * 6;
    var gap = 36 * p.eyeGap * (0.55 + 0.45 * p.W / 116);
    var r = 11.6 * p.eyeR, lx = p.lookX * 9, out = '';
    var sp = clamp01(p.sparkle);
    if (sp > 0.01) {
      [[-1.05, 0.92, 11, C.yellow], [1.02, 1.0, 13, C.acc], [-1.3, 0.55, 8, C.acc], [1.28, 0.5, 9, C.yellow], [0.6, 1.12, 7, C.yellow]].forEach(function (q, i) {
        var e = 1;
        if (st === 'happy' && !stat) e = Math.max(0, easeOutBack(clamp01((t - 0.28 - i * 0.05) / 0.3))) * (1 - clamp01((t - 1.55) / 0.4));
        var s = q[2] * e * sp;
        if (s > 0.3) out += star(CX + q[0] * 116, BASE - q[1] * 190, s, q[3], stat ? 0 : 12 * S(TAU * t / 1.5 + i));
      });
    }
    out += '<g transform="translate(0,' + n1(f.jy) + ')" opacity="' + f.op.toFixed(3) + '">';
    out += '<path d="' + crPath(pts) + '" fill="' + C.body + '"/>';
    var gl = clamp01(p.glow);
    if (gl > 0.01) {
      var g = stat ? 1 : 1 + 0.07 * S(TAU * t / 1.8), gy = BASE - p.H * 0.3;
      out += '<circle cx="' + n1(fx) + '" cy="' + n1(gy) + '" r="' + n1(27 * g) + '" fill="' + C.glow + '" opacity="' + (0.45 * gl).toFixed(3) + '"/>';
      out += '<circle cx="' + n1(fx) + '" cy="' + n1(gy) + '" r="' + n1(16 * g) + '" fill="#FBEFC6" opacity="' + gl.toFixed(3) + '"/>';
    }
    var eo = p.eyeOpen, ov = clamp01(eo / 0.12), av = 1 - ov;
    [-1, 1].forEach(function (sd) {
      var ex = fx + sd * gap + lx;
      if (ov > 0.01) {
        out += '<ellipse cx="' + n1(ex) + '" cy="' + n1(ey) + '" rx="' + n1(r) + '" ry="' + n1(Math.max(0.5, r * Math.min(eo, 1.2))) + '" fill="' + C.ink + '" opacity="' + ov.toFixed(3) + '"/>';
        if (eo > 0.45) out += '<circle cx="' + n1(ex - r * 0.32) + '" cy="' + n1(ey - r * 0.36 * Math.min(eo, 1)) + '" r="' + n1(r * 0.28) + '" fill="#fff" opacity="' + (0.92 * smooth(0.45, 0.8, eo)).toFixed(3) + '"/>';
      }
      if (av > 0.01) out += '<path d="M' + n1(ex - r) + ',' + n1(ey) + ' Q' + n1(ex) + ',' + n1(ey - 1.6 * r * p.eyeArc) + ' ' + n1(ex + r) + ',' + n1(ey) + '" fill="none" stroke="' + C.ink + '" stroke-width="5" stroke-linecap="round" opacity="' + av.toFixed(3) + '"/>';
    });
    var mo = clamp01(p.mouthO), mv = clamp01(p.mouthVis), my = ey + 25 + p.lookY * 2, mx = fx + lx * 0.6, hw = 19 * p.mouthW, dep = 7.5 * p.smile;
    if (mv * (1 - mo) > 0.01) out += '<path d="M' + n1(mx - hw) + ',' + n1(my) + ' Q' + n1(mx) + ',' + n1(my + dep * 2) + ' ' + n1(mx + hw) + ',' + n1(my) + '" fill="none" stroke="' + C.ink + '" stroke-width="5" stroke-linecap="round" opacity="' + (mv * (1 - mo)).toFixed(3) + '"/>';
    if (mv * mo > 0.01) out += '<ellipse cx="' + n1(mx) + '" cy="' + n1(my + 3) + '" rx="' + n1(4 + 5 * p.mouthW * mo) + '" ry="' + n1(4 + 6 * p.mouthW * mo) + '" fill="' + C.ink + '" opacity="' + (mv * mo).toFixed(3) + '"/>';
    var wv = clamp01(p.waves);
    if (wv > 0.01) {
      var x0 = CX + p.W * 0.72 + p.lean * faceH + p.bulge * p.W * 0.6 + 10;
      for (var i = 0; i < 3; i++) {
        var h = 9 + i * 7, ph = stat ? 1 : 0.5 + 0.5 * S(TAU * t / 1.2 - i * 0.9), x = x0 + i * 11;
        out += '<path d="M' + n1(x) + ',' + n1(ey - h) + ' Q' + n1(x + 8 + i * 2) + ',' + n1(ey) + ' ' + n1(x) + ',' + n1(ey + h) + '" fill="none" stroke="' + C.acc + '" stroke-width="4.5" stroke-linecap="round" opacity="' + (wv * (0.3 + 0.7 * ph)).toFixed(3) + '"/>';
      }
    }
    var bu = clamp01(p.burst);
    if (bu > 0.01) {
      var e = 1;
      if (st === 'surprise' && !stat) e = Math.max(0, easeOutBack(clamp01((t - 0.12) / 0.25))) * (1 - clamp01((t - 1.05) / 0.35));
      if (e > 0.01) {
        var ox = CX + p.lean * p.H, oy = topY - 6;
        [-155, -122, -90, -58, -25].forEach(function (dg) {
          var a = dg * Math.PI / 180, r1 = 14 + 6 * (1 - e), r2 = r1 + 20 * e;
          out += '<line x1="' + n1(ox + r1 * Math.cos(a)) + '" y1="' + n1(oy + r1 * Math.sin(a)) + '" x2="' + n1(ox + r2 * Math.cos(a)) + '" y2="' + n1(oy + r2 * Math.sin(a)) + '" stroke="' + C.yellow + '" stroke-width="5" stroke-linecap="round" opacity="' + (bu * Math.min(1, e * 1.5)).toFixed(3) + '"/>';
        });
      }
    }
    var zz = clamp01(p.zzz);
    if (zz > 0.01) {
      for (var z = 0; z < 3; z++) {
        var phz = stat ? [0.18, 0.48, 0.78][z] : ((t / 3.6) + z / 3) % 1;
        var xz = CX + p.W * 0.3 + phz * 52, yz = topY - 4 - phz * 78, sz = 6 + phz * 7, oz = zz * smooth(0, 0.15, phz) * (1 - smooth(0.75, 1, phz));
        if (oz > 0.01) out += '<path d="M' + n1(xz - sz) + ',' + n1(yz - sz) + ' L' + n1(xz + sz) + ',' + n1(yz - sz) + ' L' + n1(xz - sz) + ',' + n1(yz + sz) + ' L' + n1(xz + sz) + ',' + n1(yz + sz) + '" fill="none" stroke="' + C.lav + '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="' + oz.toFixed(3) + '"/>';
      }
    }
    out += '</g>';
    return out;
  }
  function frameInner(state, t, pose, opt) {
    opt = opt || {};
    var st = ALLOWED[state] ? state : 'idle';
    var base = pose || targetOf(st);
    var f = computeFrame(st, t, base, !!opt.frozen);
    f.size = opt.size || 'M';
    return buildSVG(f);
  }
  function staticInner(state, size) {
    var st = ALLOWED[state] ? state : 'idle';
    return frameInner(st, STATIC_T[st] || 0, targetOf(st), { frozen: true, size: size || 'M' });
  }
  function airLift(state, t, frozen) {
    if (frozen) return 0;
    var st = ALLOWED[state] ? state : 'idle';
    return computeFrame(st, t || 0, targetOf(st), false).jy;
  }
  function staticDocument(state, px) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="' + (px || 108) + '" height="' + (px || 108) + '">' + staticInner(state, 'M') + '</svg>';
  }

  function defaultShanghai(ms) {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
    var hour = 0, minute = 0;
    parts.forEach(function (p) { if (p.type === 'hour') hour = parseInt(p.value, 10) % 24; if (p.type === 'minute') minute = parseInt(p.value, 10); });
    return { hour: hour, minute: minute };
  }
  function isNight(ms, shanghai) {
    var p = (shanghai || defaultShanghai)(ms);
    var mins = p.hour * 60 + p.minute;
    return mins >= 23 * 60 + 30 || mins < 6 * 60;
  }

  function createMachine(opt) {
    opt = opt || {};
    var store = opt.store || { get: function () { return {}; }, set: function () {} };
    var seen = store.get() || {};
    var shanghai = opt.shanghai || defaultShanghai;
    var now = opt.now || function () { return Date.now(); };
    var state = 'idle';
    var since = now();
    var onceAt = null;
    var queue = null;
    var listening = false;
    var listenQuiet = null;
    var lastActivity = now();
    var hidden = false;
    var restOn = false;
    var sensitive = false;
    var comfortHold = false;
    var comfortOn = opt.comfortEnabled !== false;
    var motionOn = opt.motionEnabled !== false;
    var reduce = !!opt.reduceMotion;
    var lastKindAt = { happy: -1e15, surprise: -1e15 };
    var previewing = false;
    var previewUntil = null;
    var lastPreview = null;
    var lastPreviewAt = -1e15;

    function snap() {
      return { state: state, frozen: hidden || !motionOn || reduce, hidden: hidden, listening: listening, queued: queue ? queue.state : null, sensitive: sensitive, rest: restOn, comfortHold: comfortHold, preview: previewing };
    }
    function stopPreview() { previewing = false; previewUntil = null; }
    function previewDuration(kind) { return ALLOWED[kind] === 'once' ? ONCE_MS[kind] : PREVIEW_LOOP_MS; }
    function previewPool() {
      return ['listen', 'comfort', 'sleep', 'happy', 'surprise'].filter(function (s) {
        if (!ALLOWED[s]) return false;
        if (s === 'comfort' && !comfortOn) return false;
        if ((s === 'happy' || s === 'surprise') && sensitive) return false;
        return true;
      });
    }
    function loop(next) { state = next; since = now(); onceAt = null; }
    function remember(id) { if (!id) return; seen[id] = now(); store.set(seen); }
    function known(id) { return !!(id && Object.prototype.hasOwnProperty.call(seen, id)); }
    function dropQueue() { queue = null; }
    function enqueue(kind, eventId) {
      if (queue && queue.state === 'surprise' && kind === 'happy') return { ok: true, queued: false, reason: 'full' };
      queue = { state: kind, eventId: eventId, at: now() };
      return { ok: true, queued: true };
    }
    function startOnce(kind, eventId) {
      remember(eventId);
      state = kind;
      since = now();
      onceAt = now();
      lastKindAt[kind] = now();
      dropQueue();
      return { ok: true, state: kind };
    }
    function playOnce(kind, eventId, forceNew) {
      if (!ALLOWED[kind] || ALLOWED[kind] !== 'once') return { ok: false, reason: 'state' };
      if (sensitive) return { ok: false, reason: 'sensitive' };
      if (known(eventId)) return { ok: false, reason: 'dedupe' };
      if (!forceNew && !eventId && now() - lastKindAt[kind] < COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
      if (listening || hidden) return enqueue(kind, eventId);
      return startOnce(kind, eventId);
    }
    function wake() {
      if (state === 'sleep' || state === 'happy' || state === 'surprise') loop('idle');
    }
    function business() {
      lastActivity = now();
      listening = false;
      listenQuiet = null;
      dropQueue();
      var wasPreview = previewing;
      stopPreview();
      if (wasPreview) loop(comfortHold && comfortOn ? 'comfort' : 'idle');
      else if (state !== 'idle' && state !== 'comfort') loop(comfortHold ? 'comfort' : 'idle');
      else if (state === 'sleep') loop('idle');
      return snap();
    }
    function flushQueue() {
      if (!queue || listening || hidden) return;
      if (now() - queue.at > QUEUE_MS) { dropQueue(); return; }
      var q = queue; queue = null;
      startOnce(q.state, q.eventId);
    }
    function tick() {
      var t = now();
      if (queue && t - queue.at > QUEUE_MS) dropQueue();
      if (hidden) return snap();
      if (previewing && previewUntil != null && t >= previewUntil) {
        stopPreview();
        loop(comfortHold && comfortOn ? 'comfort' : 'idle');
        flushQueue();
      }
      if ((state === 'happy' || state === 'surprise') && onceAt != null && t - onceAt >= ONCE_MS[state]) {
        loop(comfortHold ? 'comfort' : 'idle');
        flushQueue();
      }
      if (listening && listenQuiet != null && t - listenQuiet >= LISTEN_GAP_MS) {
        listening = false;
        listenQuiet = null;
        if (state === 'listen') loop(comfortHold ? 'comfort' : 'idle');
        flushQueue();
      }
      var blocked = restOn || listening || state === 'listen' || state === 'happy' || state === 'surprise' || state === 'comfort';
      if (!blocked && !hidden && state === 'idle') {
        var idleFor = t - lastActivity;
        var need = isNight(t, shanghai) ? SLEEP_NIGHT_MS : SLEEP_MS;
        if (idleFor >= need) loop('sleep');
      }
      return snap();
    }
    function dispatch(type, payload) {
      payload = payload || {};
      if (type === 'think' || type === 'reply') return { ok: false, reason: 'forbidden', state: state };
      if (type === 'hide') {
        hidden = true;
        dropQueue();
        if (previewing) { stopPreview(); loop(comfortHold && comfortOn ? 'comfort' : 'idle'); }
        return snap();
      }
      if (type === 'show') { hidden = false; dropQueue(); lastActivity = now(); if (state === 'sleep') loop('idle'); return snap(); }
      if (type === 'rest') {
        restOn = !!payload.on;
        lastActivity = now();
        if (previewing) { stopPreview(); loop('idle'); }
        if (state === 'sleep') loop('idle');
        return snap();
      }
      if (type === 'preview') {
        if (listening || hidden) return { ok: false, reason: 'busy', state: state };
        if (now() - lastPreviewAt < PREVIEW_THROTTLE_MS) return { ok: false, reason: 'throttle', state: state };
        var pool = previewPool().filter(function (s) { return s !== lastPreview; });
        if (!pool.length) pool = previewPool();
        if (!pool.length) return { ok: false, reason: 'empty', state: state };
        var roll = typeof payload.random === 'function' ? payload.random() : Math.random();
        var kind = pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))];
        lastPreview = kind;
        lastPreviewAt = now();
        lastActivity = now();
        stopPreview();
        previewing = true;
        previewUntil = now() + previewDuration(kind);
        state = kind;
        since = now();
        onceAt = null;
        return { ok: true, state: kind, preview: true };
      }
      if (type === 'activity' || type === 'set' || type === 'edit' || type === 'navigate') return business();
      if (type === 'input') {
        lastActivity = now();
        listenQuiet = null;
        listening = true;
        stopPreview();
        if (state === 'sleep' || state === 'happy' || state === 'surprise' || state === 'comfort') loop('idle');
        if (state !== 'listen') loop('listen');
        return snap();
      }
      if (type === 'inputEnd') { if (listening) listenQuiet = now(); return snap(); }
      if (type === 'support') {
        if (!comfortOn) return { ok: false, reason: 'comfort-off', state: state };
        if (previewing) { stopPreview(); loop('idle'); }
        comfortHold = !!payload.on;
        lastActivity = now();
        if (payload.on) { if (state !== 'listen') loop('comfort'); }
        else if (state === 'comfort') loop('idle');
        return snap();
      }
      if (type === 'sensitive') {
        sensitive = !!payload.on;
        if (sensitive && (state === 'happy' || state === 'surprise')) {
          stopPreview();
          loop(comfortHold && comfortOn ? 'comfort' : 'idle');
        }
        return snap();
      }
      if (type === 'complete') {
        lastActivity = now();
        if (previewing) { stopPreview(); loop(comfortHold && comfortOn ? 'comfort' : 'idle'); }
        if (!payload.persisted) { wake(); return { ok: false, reason: 'persist', state: state }; }
        if (payload.backfill || payload.redo) { wake(); return { ok: false, reason: 'not-live', state: state }; }
        var kind = payload.levelUp ? 'surprise' : 'happy';
        var res = playOnce(kind, payload.eventId, true);
        res.state = state;
        return res;
      }
      if (type === 'once') {
        if (previewing) { stopPreview(); loop('idle'); }
        var r = playOnce(payload.state, payload.eventId, true);
        r.state = state;
        return r;
      }
      return snap();
    }
    function setFlags(flags) {
      if (!flags) return snap();
      if (flags.motionEnabled != null) motionOn = !!flags.motionEnabled;
      if (flags.comfortEnabled != null) {
        comfortOn = !!flags.comfortEnabled;
        if (!comfortOn && state === 'comfort') { comfortHold = false; stopPreview(); loop('idle'); }
      }
      if (flags.reduceMotion != null) reduce = !!flags.reduceMotion;
      return snap();
    }
    return { dispatch: dispatch, tick: tick, snapshot: snap, setFlags: setFlags, allowed: Object.keys(ALLOWED) };
  }

  return {
    ALLOWED: ALLOWED, ONCE_MS: ONCE_MS, PREVIEW_LOOP_MS: PREVIEW_LOOP_MS, PREVIEW_THROTTLE_MS: PREVIEW_THROTTLE_MS, COOLDOWN_MS: COOLDOWN_MS, QUEUE_MS: QUEUE_MS,
    createMachine: createMachine, frameInner: frameInner, staticInner: staticInner, staticDocument: staticDocument, airLift: airLift,
    targetOf: targetOf, isNight: isNight, defaultShanghai: defaultShanghai, KEYS: KEYS
  };
});
