/**
 * 网页端角色动画。只改伙伴 SVG，不重建训练页。
 * 离屏或后台暂停 rAF；减弱动态或关闭动画时画静态帧。
 */
(function () {
  'use strict';
  var Core = window.CompanionCore;
  if (!Core) return;
  var KEY = 'training_companion_v1';
  var host = null, svg = null, raf = 0, running = false, last = 0, watch = null;
  var reduce = false;
  function pref() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { motion: true, comfort: true }; }
    catch (e) { return { motion: true, comfort: true }; }
  }
  function savePref(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }
  reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var seen = {};
  try { seen = JSON.parse(localStorage.getItem(KEY + '_seen')) || {}; } catch (e) {}
  var machine = Core.createMachine({
    store: { get: function () { return seen; }, set: function (v) { seen = v; try { localStorage.setItem(KEY + '_seen', JSON.stringify(v)); } catch (e) {} } },
    motionEnabled: pref().motion !== false,
    comfortEnabled: pref().comfort !== false,
    reduceMotion: reduce
  });
  var pose = Core.targetOf('idle'), vel = {};
  Core.KEYS.forEach(function (k) { vel[k] = 0; });
  var shown = 'idle', tState = 0;

  function paint(frozen) {
    if (!svg) return;
    var snap = machine.snapshot();
    if (snap.state !== shown) { shown = snap.state; tState = 0; }
    var target = Core.targetOf(shown);
    var soft = !!(snap.auto && !snap.preview);
    if (frozen || snap.frozen) {
      pose = target;
      svg.innerHTML = Core.frameInner(shown, 0, pose, { frozen: true, size: 'M' });
      paintShadow(true);
      return;
    }
    var dt = 1 / 60, K = 170, D = 17;
    Core.KEYS.forEach(function (k) {
      var a = (target[k] - pose[k]) * K - vel[k] * D;
      vel[k] += a * dt;
      pose[k] += vel[k] * dt;
    });
    tState += dt;
    svg.innerHTML = Core.frameInner(shown, tState, pose, { frozen: false, size: 'M', soft: soft });
    paintShadow(false, soft);
  }
  function paintShadow(frozen, soft) {
    var sh = host && host.parentElement ? host.parentElement.querySelector('.ground-shadow') : null;
    if (!sh) return;
    var lift = frozen ? 0 : Math.max(0, -(Core.airLift ? Core.airLift(shown, tState, false, soft) : 0));
    var k = Math.min(1, lift / 46);
    var scale = 1 - 0.32 * k;
    sh.style.transform = 'translateX(-50%) scale(' + scale.toFixed(3) + ',' + (0.85 + 0.15 * scale).toFixed(3) + ')';
    sh.style.opacity = (1 - 0.45 * k).toFixed(3);
  }
  function loop(now) {
    raf = 0;
    if (!running) return;
    var dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    try {
      machine.tick();
      paint(machine.snapshot().frozen);
    } catch (e) {}
    if (running) raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function clearWatch() {
    if (watch) { watch.disconnect(); watch = null; }
  }
  function hostVisible() {
    if (!host || document.hidden) return false;
    var r = host.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }
  function setHome(on) { machine.dispatch('home', { on: !!on }); }
  function attach(el) {
    if (!el) {
      setHome(false);
      clearWatch();
      stop();
      svg = null;
      host = null;
      return;
    }
    host = el;
    if (!svg || !svg.isConnected) {
      host.innerHTML = '<svg viewBox="0 0 400 400" width="100%" height="100%" aria-hidden="true" focusable="false"></svg>';
      svg = host.querySelector('svg');
    }
    paint(machine.snapshot().frozen);
    clearWatch();
    if (window.IntersectionObserver) {
      watch = new IntersectionObserver(function (entries) {
        var on = entries.some(function (en) { return en.isIntersecting; });
        setHome(on && !document.hidden);
      }, { threshold: [0, 0.2] });
      watch.observe(host);
    }
    setHome(hostVisible());
    if (document.hidden) stop();
    else start();
  }
  function onHide() { machine.dispatch('hide'); setHome(false); stop(); paint(true); }
  function onShow() { machine.dispatch('show'); if (host) { setHome(hostVisible()); start(); } }
  document.addEventListener('visibilitychange', function () { if (document.hidden) onHide(); else onShow(); });
  document.addEventListener('pointerdown', function (e) {
    if (document.hidden) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, #companionSlot')) return;
    machine.dispatch('activity');
  }, true);
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest || !e.target.closest('#companionSlot')) return;
    machine.dispatch('preview');
    paint(machine.snapshot().frozen);
  });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    var apply = function () { reduce = !!mq.matches; machine.setFlags({ reduceMotion: reduce }); paint(machine.snapshot().frozen); };
    if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply);
  }
  window.CompanionView = {
    attach: attach,
    machine: machine,
    pref: pref,
    setMotion: function (on) { var p = pref(); p.motion = !!on; savePref(p); machine.setFlags({ motionEnabled: !!on }); paint(machine.snapshot().frozen); },
    setComfort: function (on) { var p = pref(); p.comfort = !!on; savePref(p); machine.setFlags({ comfortEnabled: !!on }); },
    destroy: function () { setHome(false); clearWatch(); stop(); if (host) host.innerHTML = ''; svg = null; host = null; }
  };
})();
