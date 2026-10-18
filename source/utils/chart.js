/**
 * 极简 Canvas2D 图表（小程序 canvas type="2d" 与 H5 canvas 共用）· Apple 浅色风格
 * 基础：line / bars(堆叠，圆角) / donut
 * 预设：e1rm / weight / volume / pie / bw —— 两端调用同一份配置，保证视觉一致
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GZChart = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var FONT = '-apple-system, "SF Pro Text", "PingFang SC", sans-serif';
  var THEME = {
    grid: 'rgba(60,60,67,0.10)', axis: '#8E8E93', text: '#3A3A3C', label: '#1C1C1E',
    hole: '#FFFFFF', track: 'rgba(118,118,128,0.12)', font: '10px ' + FONT
  };
  var ACCENT = '#FF6B1A', BLUE = '#0A84FF';
  var PALETTE = ['#FF6B1A', '#0A84FF', '#34C759', '#AF52DE', '#8E8E93'];

  function niceRange(min, max, ticks) {
    if (min === max) { min -= 5; max += 5; }
    var span = max - min, step = Math.pow(10, Math.floor(Math.log(span / ticks) / Math.LN10));
    var err = span / ticks / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step: step };
  }
  function fmt(v) {
    if (Math.abs(v) >= 10000) return (v / 1000).toFixed(0) + 'k';
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
    return Math.round(v * 10) / 10 + '';
  }
  function clear(ctx, W, H) { ctx.clearRect(0, 0, W, H); }
  function empty(ctx, W, H, text) {
    ctx.fillStyle = THEME.axis; ctx.font = '13px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text || '暂无数据', W / 2, H / 2);
  }
  function dash(ctx, d) { if (ctx.setLineDash) ctx.setLineDash(d); }

  // 网格在左，数值标签在右（Apple Health 风格）
  function axes(ctx, W, H, pad, r, labels, xAt) {
    ctx.font = THEME.font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (var v = r.lo; v <= r.hi + 1e-9; v += r.step) {
      var y = pad.t + (H - pad.t - pad.b) * (1 - (v - r.lo) / (r.hi - r.lo));
      ctx.strokeStyle = THEME.grid; ctx.lineWidth = 0.5; dash(ctx, v === r.lo ? [] : [2, 3]);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.fillStyle = THEME.axis; ctx.fillText(fmt(v), W - pad.r + 6, y);
    }
    dash(ctx, []);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    // 按最宽标签与相邻点间距决定隔几个显示一个，保证不挤在一起（点少时全显示）
    var maxW = 0; labels.forEach(function (lb) { maxW = Math.max(maxW, ctx.measureText(lb).width); });
    var gap = labels.length > 1 ? Math.abs(xAt(1) - xAt(0)) : 1e9;
    var every = Math.max(1, Math.ceil((maxW + 10) / Math.max(gap, 1)));
    labels.forEach(function (lb, i) {
      if (i % every !== 0) return;
      // 第一个标签居中会被左边缘截掉，夹在可见范围内
      var hw = ctx.measureText(lb).width / 2, x = Math.max(xAt(i), hw + 1);
      ctx.fillStyle = THEME.axis; ctx.fillText(lb, x, H - pad.b + 7);
    });
  }

  function line(ctx, W, H, o) {
    clear(ctx, W, H);
    var vals = [];
    o.series.forEach(function (s) { s.data.forEach(function (v) { if (v !== null && v !== undefined && !isNaN(v)) vals.push(v); }); });
    if (!vals.length) return empty(ctx, W, H, o.emptyText);
    var pad = { l: 6, r: 34, t: 14, b: 22 };
    var r = niceRange(Math.min.apply(null, vals), Math.max.apply(null, vals), 3);
    var n = o.labels.length, cw = (W - pad.l - pad.r - 12);
    var xAt = function (i) { return pad.l + 6 + (n <= 1 ? cw / 2 : cw * i / (n - 1)); };
    var yAt = function (v) { return pad.t + (H - pad.t - pad.b) * (1 - (v - r.lo) / (r.hi - r.lo)); };
    axes(ctx, W, H, pad, r, o.labels, xAt);
    o.series.forEach(function (s) {
      var pts = [];
      s.data.forEach(function (v, i) { if (v !== null && v !== undefined && !isNaN(v)) pts.push([xAt(i), yAt(v), i]); });
      if (s.fill && pts.length > 1) {
        var g = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
        g.addColorStop(0, s.fill); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath(); ctx.moveTo(pts[0][0], H - pad.b);
        pts.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
        ctx.lineTo(pts[pts.length - 1][0], H - pad.b); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      }
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      dash(ctx, s.dashed ? [4, 4] : []);
      ctx.beginPath(); var prev = -2;
      pts.forEach(function (p) {
        if (prev === -2 || (!s.connect && p[2] !== prev + 1)) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
        prev = p[2];
      });
      ctx.stroke(); dash(ctx, []);
      if (s.dots !== false) {
        pts.forEach(function (p) {
          var hollow = s.hollowFrom !== undefined && p[2] >= s.hollowFrom;
          ctx.beginPath(); ctx.arc(p[0], p[1], hollow ? 3.4 : 3.2, 0, Math.PI * 2);
          ctx.fillStyle = hollow ? THEME.hole : s.color; ctx.fill();
          ctx.strokeStyle = hollow ? s.color : THEME.hole; ctx.lineWidth = hollow ? 1.6 : 1.4; ctx.stroke();
        });
      }
      if (s.labelLast && pts.length) {
        var lp = pts[pts.length - 1];
        ctx.fillStyle = s.color; ctx.font = '600 10px ' + FONT; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(s.labelLast, lp[0], lp[1] - 6);
      }
    });
  }

  function topRound(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
  }
  function bars(ctx, W, H, o) {
    clear(ctx, W, H);
    var n = o.labels.length, sums = [];
    for (var i = 0; i < n; i++) sums.push(o.stacks.reduce(function (a, s) { return a + (s.data[i] || 0); }, 0));
    var mx = Math.max.apply(null, sums.concat([0]));
    if (mx <= 0) return empty(ctx, W, H, o.emptyText);
    var pad = { l: 6, r: 34, t: 16, b: 22 };
    var r = niceRange(0, mx, 3); r.lo = 0;
    var cw = (W - pad.l - pad.r) / n, bw = Math.min(18, cw * 0.5);
    var xAt = function (k) { return pad.l + cw * k + cw / 2; };
    var hAt = function (v) { return (H - pad.t - pad.b) * v / (r.hi - r.lo); };
    axes(ctx, W, H, pad, r, o.labels, xAt);
    for (var k = 0; k < n; k++) {
      var y = H - pad.b, top = -1;
      o.stacks.forEach(function (s, si) { if ((s.data[k] || 0) > 0) top = si; });
      o.stacks.forEach(function (s, si) {
        var h = hAt(s.data[k] || 0); if (h <= 0) return;
        ctx.fillStyle = s.color;
        if (si === top) topRound(ctx, xAt(k) - bw / 2, y - h, bw, h, 4); else ctx.fillRect(xAt(k) - bw / 2, y - h, bw, h);
        y -= h;
      });
      if (sums[k] > 0 && o.showTotal !== false) {
        ctx.fillStyle = THEME.text; ctx.font = '500 10px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(fmt(sums[k]), xAt(k), y - 3);
      }
    }
  }

  function donut(ctx, W, H, o) {
    clear(ctx, W, H);
    var total = o.items.reduce(function (a, b) { return a + b.value; }, 0);
    var cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 4, lw = R * 0.26, rr = R - lw / 2;
    ctx.lineWidth = lw; ctx.lineCap = 'butt';
    ctx.strokeStyle = THEME.track; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    if (total) {
      var a = -Math.PI / 2, gap = o.items.length > 1 ? 0.04 : 0;
      o.items.forEach(function (it) {
        var sweep = Math.PI * 2 * it.value / total;
        ctx.strokeStyle = it.color; ctx.beginPath(); ctx.arc(cx, cy, rr, a + gap / 2, a + sweep - gap / 2); ctx.stroke(); a += sweep;
      });
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.label; ctx.font = '700 24px ' + FONT;
    ctx.fillText(total ? (o.center || String(total)) : '0', cx, cy - 6);
    ctx.fillStyle = THEME.axis; ctx.font = '11px ' + FONT; ctx.fillText(o.sub || '', cx, cy + 15);
  }

  // ---------- 预设 ----------
  function weekLabels(n) { var a = []; for (var i = 1; i <= n; i++) a.push('W' + i); return a; }
  var presets = {
    e1rm: function (ctx, W, H, e, weeks) {
      var series = [];
      if (e.oneRM) series.push({ color: '#C7C7CC', data: e.series.map(function () { return e.oneRM; }), dashed: true, width: 1, dots: false });
      if (e.n >= 2) series.push({ color: BLUE, data: e.regLine, dashed: true, width: 1.5, dots: false, labelLast: e.predict });
      series.push({ color: ACCENT, data: e.series, width: 2.5, fill: 'rgba(255,107,26,0.22)' });
      line(ctx, W, H, { labels: weekLabels(weeks), series: series, emptyText: '完成 T1 AMRAP 后生成' });
    },
    weight: function (ctx, W, H, d, weeks) {
      line(ctx, W, H, { labels: weekLabels(weeks), series: d.cols.map(function (col, i) {
        return { color: PALETTE[i], data: col.data, width: i === 0 ? 2.5 : 1.6, hollowFrom: d.nextIdx, connect: true };
      }) });
    },
    volume: function (ctx, W, H, v) { bars(ctx, W, H, { labels: v.labels, stacks: v.stacks, emptyText: '还没有容量数据' }); },
    pie: function (ctx, W, H, s) { donut(ctx, W, H, { items: s.pie, center: String(s.pieTotal), sub: '次判定' }); },
    bw: function (ctx, W, H, bw) { line(ctx, W, H, { labels: bw.map(function (b) { return b.date.slice(5); }), series: [{ color: '#34C759', data: bw.map(function (b) { return b.v; }), width: 2, fill: 'rgba(52,199,89,0.18)' }] }); }
  };

  return { line: line, bars: bars, donut: donut, presets: presets, THEME: THEME, PALETTE: PALETTE };
});
