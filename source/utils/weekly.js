/* 周报：按计划周汇总训练，并绘制可分享的周度战报。只读已有记录。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine'), require('./share'), require('./badges'));
  else root.GZWeekly = factory(root.GZ, root.GZShare, root.GZBadges);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GZ, Share, Badges) {
  'use strict';
  var H = Share.H;

  function weeksOf(db, rp) {
    rp = rp || GZ.replay(db);
    var set = {};
    rp.sessions.forEach(function (s) { set[s.week] = 1; });
    return Object.keys(set).map(function (n) { return +n; }).sort(function (a, b) { return b - a; });
  }
  function sumVol(list) {
    var v = 0;
    list.forEach(function (s) { v += Share.sessionVolume(s); });
    return Math.round(v * 100) / 100;
  }
  function rangeText(list) {
    var dates = list.map(function (s) { return s.rec.date; }).filter(Boolean).sort();
    if (!dates.length) return '';
    var a = H.cnDate(dates[0]), b = H.cnDate(dates[dates.length - 1]);
    return a === b ? a : a + ' – ' + b;
  }

  function build(db, week, opts) {
    opts = opts || {};
    var rp = GZ.replay(db), weeks = weeksOf(db, rp);
    if (!weeks.length) return null;
    week = Number(week);
    if (!week || weeks.indexOf(week) < 0) week = weeks[0];
    var cur = rp.sessions.filter(function (s) { return s.week === week; });
    var prevSessions = rp.sessions.filter(function (s) { return s.week === week - 1; });
    var volume = sumVol(cur), prevVol = prevSessions.length ? sumVol(prevSessions) : 0;
    var volDelta = prevVol > 0 ? Math.round((volume - prevVol) / prevVol * 100) : null;
    var adds = 0, reps = 0, sets = 0;
    var mains = {};
    cur.forEach(function (s) {
      s.items.forEach(function (it) {
        var e = (s.rec.entries || {})[it.slotId];
        if (!H.hasEntry(e, s.rec.deload) || it.judgment === '跳过') return;
        if (it.judgment === '加重') adds++;
        sets += Number(it.deload ? it.dSets : it.sets) || 0;
        reps += Number(it.workReps) || 0;
        if (it.tier !== 'T1' || it.deload) return;
        var w = Number(it.weight) || 0;
        var row = mains[it.name] || { name: it.name, badge: it.badge || GZ.tierLabel(GZ.progressionOf(db).id, 'T1'), tier: it.tier, weight: 0, e1: 0, adds: 0 };
        if (w >= row.weight) row.weight = w;
        if (it.e1rm && it.e1rm > row.e1) row.e1 = Math.round(it.e1rm * 10) / 10;
        if (it.judgment === '加重') row.adds++;
        mains[it.name] = row;
      });
    });
    var mainRows = Object.keys(mains).map(function (k) { return mains[k]; });
    var days = (db.days || []).map(function (d) {
      return { id: d.id, on: cur.some(function (s) { return s.rec.day === d.id; }) };
    });
    var life = Share.allFacts(db);
    var watchSrc = db.params && db.params.watch;
    var watch = null;
    if (watchSrc) {
      var min = 0, kcal = 0, wsets = 0, n = 0, hrSum = 0, hrMin = 0;
      cur.forEach(function (s) {
        var fact = life.filter(function (f) { return f.id === s.rec.id; })[0];
        var wk = Badges.watchFor(watchSrc, life, fact || { id: s.rec.id, date: s.rec.date, order: 0 });
        if (!wk) return;
        n++; min += wk.min || 0; kcal += wk.kcal || 0; wsets += wk.sets || 0;
        if (wk.avgHr > 0 && wk.min) { hrSum += wk.avgHr * wk.min; hrMin += wk.min; }
      });
      if (n) watch = { n: n, min: min, kcal: kcal, sets: wsets, avgHr: hrMin ? Math.round(hrSum / hrMin) : 0 };
    }
    var bodyLine = opts.body === true && watch
      ? '手表记录 · ' + watch.min + ' 分钟' + (watch.kcal ? ' · ' + H.num(watch.kcal, 0) + ' 千卡' : '') + (watch.avgHr ? ' · 平均心率 ' + watch.avgHr : '')
      : '';
    var prog = GZ.progressionOf(db).id;
    var mainLabel = GZ.tierLabel(prog, 'T1');
    var weekText = GZ.weekText(week, db.params);
    var p = Share.profile(db.params.shareProfile);
    var volT = (volume / 1000).toFixed(2);
    var pool = Share.THINGS.map(function (th) { return H.compare(volume, th, '本周累计 ' + volT + ' t，'); }).filter(Boolean);
    var eggs = [];
    eggs.push({ e: '📅', tag: '数据彩蛋', text: '本周完成 ' + cur.length + ' / ' + (db.days || []).length + ' 次训练', basis: '计划周内已记录的训练日' });
    if (cur.length && volume > 0) eggs.push({ e: '⚖️', tag: '数据彩蛋', text: '平均每次 ' + H.num(volume / cur.length / 1000, 2) + ' t', basis: H.num(volume) + ' kg ÷ ' + cur.length + ' 次' });
    if (volDelta !== null) eggs.push(volDelta >= 0
      ? { e: '📈', tag: '和上周比', text: '比上周多举了 ' + H.num(volume - prevVol) + ' kg', basis: H.num(prevVol) + ' → ' + H.num(volume) + ' kg（+' + volDelta + '%）' }
      : { e: '🌿', tag: '和上周比', text: '比上周少了 ' + H.num(prevVol - volume) + ' kg，恢复也是训练', basis: H.num(prevVol) + ' → ' + H.num(volume) + ' kg（' + volDelta + '%）' });
    if (adds) eggs.push({ e: '🔥', tag: '数据彩蛋', text: '本周 ' + adds + ' 个动作达到加重条件', basis: '按计划规则判定' });
    if (opts.body === true && watch && watch.kcal > 0) H.FOODS.forEach(function (f) {
      var q = watch.kcal / f[2]; if (q < 0.8 || q > 80) return;
      var n = Math.max(1, Math.round(q));
      eggs.push({ e: f[0], tag: '能量对照', text: '手表估算本周消耗 ' + H.num(watch.kcal, 0) + ' 千卡，约等于 ' + n + ' ' + f[3] + f[1], basis: H.num(watch.kcal, 0) + ' kcal ÷ ' + f[2] + ' kcal（' + f[1] + '）' });
    });
    var items = H.shuffled(pool.concat(eggs), H.hashSeed('week|' + week));
    var nFun = items.length, fv = Number(opts.funVariant) || 0;
    var fi = nFun ? ((Math.trunc(fv) % nFun) + nFun) % nFun : 0;
    var fp = items[fi] || { e: '💪', tag: '数据彩蛋', text: '认真练习的一周', basis: '' };
    var summary = weekText + '完成 ' + cur.length + ' / ' + (db.days || []).length + ' 次，累计容量 ' + volT + ' t' +
      (volDelta === null ? '。' : '，较上周 ' + (volDelta >= 0 ? '+' : '') + volDelta + '%。') +
      (adds ? '有 ' + adds + ' 项达到加重条件。' : '本周没有动作达到加重条件。');
    var caption = (p.name || '训练者') + (p.handle ? ' ' + p.handle : '') + ' · ' + weekText + '训练周报\n' +
      cur.length + ' / ' + (db.days || []).length + ' 次 / 累计容量 ' + Math.round(volume) + ' kg' +
      (volDelta === null ? '' : '（较上周 ' + (volDelta >= 0 ? '+' : '') + volDelta + '%）') + '\n' +
      (bodyLine ? bodyLine + '\n' : '') + fp.e + ' ' + fp.text + '\n' + summary + '\n#训练打卡 #周度回顾';
    return {
      week: week, weeks: weeks, weekText: weekText, title: weekText + '训练周报', range: rangeText(cur),
      profile: p, name: p.name || '训练者', hasName: !!p.name,
      sessions: cur.length, total: (db.days || []).length, days: days, deload: GZ.isDeloadWeek(week, db.params),
      volume: volume, volumeText: volT, volDelta: volDelta, adds: adds, reps: reps, sets: sets,
      mains: mainRows, mainLabel: mainLabel, watch: watch, bodyLine: bodyLine,
      fun: fp.text, funEmoji: fp.e, funTag: fp.tag, funBasis: fp.basis, funIndex: fi, funTotal: nFun,
      copy: summary, caption: caption
    };
  }

  function paintDots(ctx, pal, x, y, w, days) {
    var n = days.length || 1, gap = 12;
    var r = Math.min(30, Math.floor((w - gap * (n - 1)) / n / 2));
    days.forEach(function (d, i) {
      var cx = x + i * (r * 2 + gap);
      ctx.beginPath();
      ctx.arc(cx + r, y + r, r, 0, Math.PI * 2);
      ctx.fillStyle = d.on ? pal.accent : pal.soft;
      ctx.fill();
      if (!d.on) { ctx.lineWidth = 2; ctx.strokeStyle = pal.line; ctx.stroke(); }
      ctx.textAlign = 'center';
      H.font(ctx, r > 22 ? 22 : 18, 700);
      ctx.fillStyle = d.on ? '#FFFFFF' : pal.muted;
      ctx.fillText(d.id, cx + r, y + r - (r > 22 ? 14 : 12));
      ctx.textAlign = 'left';
    });
  }

  async function draw(canvas, data, theme) {
    var Poster = H.Poster, avatar = await H.loadImage(data.profile && data.profile.avatar);
    function pass(finalH) {
      var ctx, pal;
      if (!finalH) {
        var opened = Poster.openPoster(canvas, theme);
        ctx = opened.ctx; pal = opened.pal;
      } else {
        ctx = canvas.getContext('2d');
        pal = Poster.palette(theme);
        Poster.closePoster(canvas, ctx, pal, finalH);
      }
      var y = 48;
      y = Poster.paintIdentity(ctx, pal, y, avatar, {
        name: data.name,
        sub: (data.profile && (data.profile.handle || data.profile.signature)) || '',
        title: data.title,
        tag: data.range || ''
      });
      var colW = (Poster.PIN - Poster.PGAP) / 2, colH = 392;
      var hero = Poster.volHero(data.volume);
      var deltaChip = data.volDelta === null ? '本周第一份对照' : '较上周 ' + (data.volDelta >= 0 ? '+' : '') + data.volDelta + '%';
      var attendChip = data.deload ? '减载周' : (data.sessions >= data.total ? '本周全勤' : '完成 ' + data.sessions + '/' + data.total + ' 次');
      Poster.paintMini(ctx, pal, Poster.PX, y, colW, colH, {
        icon: '📅', title: '本周出勤', value: data.sessions + ' / ' + data.total, unit: '次',
        chip: attendChip, tone: 'up',
        paint: function (c, p, x, yy, w) { paintDots(c, p, x, yy, w, data.days || []); }
      });
      Poster.paintMini(ctx, pal, Poster.PX + colW + Poster.PGAP, y, colW, colH, {
        icon: '🔥', title: '周总容量', value: hero.v, unit: hero.u,
        chip: deltaChip, tone: data.volDelta != null && data.volDelta < 0 ? 'down' : 'up'
      });
      y += colH + Poster.PGAP;
      var mains = data.mains || [];
      if (mains.length) {
        y = Poster.paintSection(ctx, pal, y, {
          icon: '📈', title: '本周' + data.mainLabel + '进展', trail: '本周加重 ' + data.adds + ' 项',
          inner: mains.length * 108,
          paint: function (c, p, x, yy, w) {
            mains.forEach(function (row, i) {
              var ry = yy + i * 108;
              Poster.fillRound(c, x, ry, w, 92, 20, p.soft);
              H.font(c, 30, 650);
              H.text(c, Poster.ellipsis(c, row.name, w * 0.55), x + 20, ry + 16, 30, p.ink, 650);
              H.text(c, '估算 1RM ' + (row.e1 ? row.e1 + ' kg' : '—'), x + 20, ry + 54, 24, p.muted, 500);
              c.textAlign = 'right';
              H.text(c, H.num(row.weight, row.weight % 1 ? 1 : 0) + ' kg', x + w - 20, ry + 16, 30, p.ink, 700);
              H.text(c, row.adds ? '加重 ' + row.adds + ' 次' : '本周保持', x + w - 20, ry + 54, 24, row.adds ? p.chipInk : p.muted, 650);
              c.textAlign = 'left';
            });
          }
        });
        y += Poster.PGAP;
      }
      y = Poster.paintFun(ctx, pal, y, { icon: '⚡', title: '本周累计相当于', emoji: data.funEmoji, text: data.fun, basis: data.funBasis, trail: data.funTag || '' });
      if (data.bodyLine) {
        y += Poster.PGAP;
        H.font(ctx, 30, 600);
        var bl = H.wrap(ctx, data.bodyLine, Poster.PIN - 64);
        y = Poster.paintSection(ctx, pal, y, {
          icon: '⌚', title: '手表周汇总', inner: Math.max(40, bl.length * 42),
          paint: function (c, p, x, yy) { bl.forEach(function (l, i) { H.text(c, l, x, yy + i * 42, 30, p.ink, 600); }); }
        });
      }
      return y + 64;
    }
    pass(pass(0));
    return canvas;
  }

  return { weeks: weeksOf, build: build, draw: draw };
});
