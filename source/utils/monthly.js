/* 月报：按自然月汇总训练，并绘制可分享的月度战报。只读已有记录，不改任何数据。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine'), require('./share'), require('./badges'), require('./insight'));
  else root.GZMonthly = factory(root.GZ, root.GZShare, root.GZBadges, root.GZInsight);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GZ, Share, Badges, Insight) {
  'use strict';
  var H = Share.H;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymOf(date) { return date.slice(0, 7); }
  function prevYm(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1; if (m < 1) { m = 12; y -= 1; } return y + '-' + pad2(m); }
  function daysIn(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(); }
  function ymText(ym) { return ym.slice(0, 4) + ' 年 ' + (+ym.slice(5, 7)) + ' 月'; }
  function monText(ym) { return (+ym.slice(5, 7)) + ' 月'; }
  function r1(v) { return Math.round(v * 10) / 10; }

  /** 每次有效训练的事实（时间先后） */
  function facts(rp) {
    var out = [];
    rp.sessions.forEach(function (s, i) {
      var items = s.items.filter(function (it) { var e = (s.rec.entries || {})[it.slotId]; return H.hasEntry(e, s.rec.deload) && it.judgment !== '跳过'; });
      if (!items.length || !/^\d{4}-\d{2}-\d{2}$/.test(s.rec.date || '')) return;
      var reps = 0, sets = 0, adds = 0;
      items.forEach(function (it) {
        if (it.deload) { reps += (Number(it.dSets) || 0) * (Number(it.reps) || 0); sets += Number(it.dSets) || 0; return; }
        reps += Insight.repsOf(it); sets += Number(it.sets) || 0;
        if (it.judgment === '加重') adds++;
      });
      out.push({ id: s.rec.id, date: s.rec.date, day: s.rec.day, dayName: s.dayName, week: s.week, order: i, volume: Share.sessionVolume(s), reps: reps, sets: sets, adds: adds, deload: !!s.rec.deload });
    });
    return out;
  }
  function totalsOf(list) {
    var t = { n: list.length, days: 0, volume: 0, reps: 0, sets: 0, adds: 0 }, set = {};
    list.forEach(function (f) { set[f.date] = 1; t.volume += f.volume; t.reps += f.reps; t.sets += f.sets; t.adds += f.adds; });
    t.days = Object.keys(set).length; t.volume = Math.round(t.volume * 100) / 100;
    return t;
  }

  /** 有训练记录的月份，最新在前 */
  function months(db, rp) {
    var set = {};
    facts(rp || GZ.replay(db)).forEach(function (f) { set[ymOf(f.date)] = 1; });
    return Object.keys(set).sort().reverse();
  }

  function build(db, ym, opts) {
    opts = opts || {};
    var rp = GZ.replay(db), all = facts(rp), ms = months(db, rp);
    if (!ms.length) return null;
    if (!ym || ms.indexOf(ym) < 0) ym = ms[0];
    var cur = all.filter(function (f) { return ymOf(f.date) === ym; }), pm = prevYm(ym);
    var prev = all.filter(function (f) { return ymOf(f.date) === pm; });
    var t = totalsOf(cur), pt = prev.length ? totalsOf(prev) : null;
    var volDelta = pt && pt.volume > 0 ? Math.round((t.volume - pt.volume) / pt.volume * 100) : null;
    var today = GZ.today(), ongoing = ym === today.slice(0, 7);
    var dim = daysIn(ym);

    // 日历：周一为每周第一天
    var trained = {}, weekSet = {};
    cur.forEach(function (f) { var d = +f.date.slice(8, 10); trained[d] = (trained[d] || 0) + 1; weekSet[f.week] = 1; });
    var activeWeeks = Object.keys(weekSet).length;
    var lead = (new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).getDay() + 6) % 7, cells = [];
    for (var i = 0; i < lead; i++) cells.push(null);
    for (var d = 1; d <= dim; d++) cells.push({ d: d, n: trained[d] || 0 });
    while (cells.length % 7) cells.push(null);
    var calendar = []; for (var r = 0; r < cells.length; r += 7) calendar.push(cells.slice(r, r + 7));

    // 本月最佳一次
    var best = null; cur.forEach(function (f) { if (!best || f.volume > best.volume) best = f; });

    // 动作：本月容量排行 + 估算 1RM 变化
    var col = Insight.collect(rp), start = ym + '-01', topEx = [], prog = [];
    col.order.forEach(function (name) {
      var pts = col.byName[name], inM = pts.filter(function (p) { return ymOf(p.date) === ym; });
      if (!inM.length) return;
      var vol = 0; inM.forEach(function (p) { vol += p.volume; });
      if (vol > 0) topEx.push({ name: name, tier: inM[inM.length - 1].tier, volume: Math.round(vol), n: inM.length });
      var e = inM.filter(function (p) { return p.e1rm; });
      if (!e.length) return;
      var mBest = 0; e.forEach(function (p) { if (p.e1rm > mBest) mBest = p.e1rm; });
      var before = pts.filter(function (p) { return p.date < start && p.e1rm; }), pBest = 0;
      before.forEach(function (p) { if (p.e1rm > pBest) pBest = p.e1rm; });
      prog.push({ name: name, tier: inM[inM.length - 1].tier, badge: inM[inM.length - 1].badge, e1: r1(mBest), prior: pBest ? r1(pBest) : null,
        delta: pBest ? r1(mBest - pBest) : null, pct: pBest ? Math.round((mBest / pBest - 1) * 1000) / 10 : null });
    });
    topEx.sort(function (a, b) { return b.volume - a.volume; });
    // 进步行：T1 主项优先，不够 3 行时用涨幅最大的其他动作补齐，最多 4 行
    var tierRank = { T1: 1, T2: 2, T3: 3 };
    var t1 = prog.filter(function (p) { return p.tier === 'T1'; }), rest = prog.filter(function (p) { return p.tier !== 'T1'; });
    rest.sort(function (a, b) { return (b.pct === null ? -1 : b.pct) - (a.pct === null ? -1 : a.pct) || tierRank[a.tier] - tierRank[b.tier]; });
    var progRows = t1.concat(rest).slice(0, 4);

    // 本月里程碑
    var state = Share.badgeState(db), rank = {};
    Badges.GROUPS.forEach(function (g) { rank[g.id] = g.rank; });
    var ms2 = Object.keys(state.earned).map(function (id) { return state.earned[id]; })
      .filter(function (e) { return e.date && ymOf(e.date) === ym; })
      .map(function (e) { var df = state.byId[e.id]; return { id: e.id, title: df.title, e: df.e, desc: df.desc, group: df.group, date: e.date, tier: df.tier, m: df.m || '' }; })
      .sort(function (a, b) { return (rank[b.group] || 0) - (rank[a.group] || 0) || b.tier - a.tier; });
    // 同一系列在本月跨过多档（如累计 5 t 与 12 t）：卡片上只展示最高一档，数量仍按实际解锁计
    var milestoneCount = ms2.length, topOf = {};
    ms2.forEach(function (m) { if (m.m && (!topOf[m.m] || m.tier > topOf[m.m].tier)) topOf[m.m] = m; });
    var msShow = ms2.filter(function (m) { return !m.m || topOf[m.m] === m; });

    // 手表（只取时长、组数、心率、千卡；睡眠不进入月报）
    var wd = db.params && db.params.watch, first = all.length ? all[0].date : '', watch = null;
    if (wd && wd.workouts) {
      var ws = wd.workouts.filter(function (w) { return ymOf(w.date) === ym && w.date >= first; });
      if (ws.length) {
        var mins = 0, sets = 0, kcal = 0, hrSum = 0, hrMin = 0;
        ws.forEach(function (w) { mins += w.min; sets += w.sets; kcal += w.kcal || 0; if (w.avgHr > 0) { hrSum += w.avgHr * w.min; hrMin += w.min; } });
        watch = { n: ws.length, min: mins, hours: r1(mins / 60), sets: sets, kcal: kcal, avgHr: hrMin ? Math.round(hrSum / hrMin) : 0 };
      }
    }
    var watchNote = '';
    if (!watch && wd && (wd.workouts || []).length) {
      var edge = Badges.watchLatest ? Badges.watchLatest(wd) : null;
      var latest = edge && edge.date && edge.date.length >= 10 ? (+edge.date.slice(5, 7)) + '月' + (+edge.date.slice(8, 10)) + '日' : '';
      watchNote = latest ? '这个月在手表快照里没有对得上的力量训练，最近一次是 ' + latest + '。' : '这个月在手表里没有力量训练记录';
    }
    var bodyLine = opts.body === true && watch ? '手表记录 · 力量训练 ' + watch.hours + ' 小时 · ' + watch.sets + ' 组' + (watch.kcal ? ' · ' + H.num(watch.kcal, 0) + ' 千卡' : '') : '';

    // 趣味换算：本月容量对照 + 月度数据彩蛋，每条一个 emoji
    var pool = Share.THINGS.map(function (th) { return H.compare(t.volume * 1, th, '本月累计 ' + H.num(t.volume / 1000, 2) + ' t，'); }).filter(Boolean);
    var eggs = [];
    eggs.push({ e: '🗓️', tag: '数据彩蛋', text: (ongoing ? '到今天已经' : '这个月') + '有 ' + t.days + ' 天在训练', basis: t.days + ' 个有记录的日子 ÷ ' + dim + ' 天 ≈ ' + Math.round(t.days / dim * 100) + '%' });
    if (t.n > 0 && t.volume > 0) eggs.push({ e: '⚖️', tag: '数据彩蛋', text: '平均每次训练 ' + H.num(t.volume / t.n / 1000, 2) + ' t', basis: H.num(t.volume) + ' kg ÷ ' + t.n + ' 次' });
    if (t.reps > 0) eggs.push({ e: '💪', tag: '数据彩蛋', text: H.num(t.reps, 0) + ' 次发力，每一次都记在账上', basis: '本月各次训练的次数合计' });
    if (best && best.volume > 0 && t.n > 1) eggs.push({ e: '🏆', tag: '本月之最', text: '最猛的一次是 ' + best.date.slice(5).replace('-', '月') + '日 ' + best.day + '，' + H.num(best.volume / 1000, 2) + ' t', basis: '本月 ' + t.n + ' 次训练里容量最高' });
    if (volDelta !== null) eggs.push(volDelta >= 0
      ? { e: '📈', tag: '和上月比', text: '比 ' + monText(pm) + '多练了 ' + H.num(t.volume - pt.volume) + ' kg', basis: H.num(pt.volume) + ' → ' + H.num(t.volume) + ' kg（' + (volDelta >= 0 ? '+' : '') + volDelta + '%）' }
      : { e: '🌿', tag: '和上月比', text: '比 ' + monText(pm) + '少了 ' + H.num(pt.volume - t.volume) + ' kg，恢复也是训练', basis: H.num(pt.volume) + ' → ' + H.num(t.volume) + ' kg（' + volDelta + '%）' });
    if (t.adds > 0) eggs.push({ e: '🔥', tag: '数据彩蛋', text: '本月 ' + t.adds + ' 个动作达到加重条件', basis: '按计划规则判定' });
    if (milestoneCount) eggs.push({ e: '🏅', tag: '数据彩蛋', text: '本月解锁了 ' + milestoneCount + ' 枚里程碑', basis: '以首次达成的日期为准' });
    if (opts.body === true && watch && watch.kcal > 0) H.FOODS.forEach(function (f) {
      var q = watch.kcal / f[2]; if (q < 0.8 || q > 400) return; var n = Math.max(1, Math.round(q));
      eggs.push({ e: f[0], tag: '能量对照', text: '手表估算本月消耗 ' + H.num(watch.kcal, 0) + ' 千卡，约等于 ' + H.num(n, 0) + ' ' + f[3] + f[1], basis: H.num(watch.kcal, 0) + ' kcal ÷ ' + f[2] + ' kcal（' + f[1] + '，' + f[4] + '）≈ ' + H.num(n, 0) + '；热量为手表估算，仅作趣味参考' });
    });
    var items = H.shuffled(pool.concat(eggs), H.hashSeed('month|' + ym)), nFun = items.length;
    var fv = Number(opts.funVariant) || 0, fi = nFun ? ((Math.trunc(fv) % nFun) + nFun) % nFun : 0, fp = items[fi] || { e: '💪', tag: '数据彩蛋', text: '认真练习的一个月', basis: '' };

    var p = Share.profile(db.params.shareProfile), title = ymText(ym);
    var summary = (ongoing ? '到今天，' : '') + monText(ym) + '练了 ' + t.n + ' 次、' + t.days + ' 个训练日，累计容量 ' + H.num(t.volume / 1000, 2) + ' t' +
      (volDelta === null ? '。这是第一个有记录的月份。' : '，比 ' + monText(pm) + (volDelta >= 0 ? '多' : '少') + ' ' + Math.abs(volDelta) + '%。') +
      (t.adds ? t.adds + ' 个动作达到加重条件' : '没有动作达到加重条件') + (milestoneCount ? '，解锁 ' + milestoneCount + ' 枚里程碑。' : '。') +
      (ongoing ? '' : '保持节奏，下个月继续。');
    var caption = (p.name || '训练者') + (p.handle ? ' ' + p.handle : '') + ' · ' + title + '月报\n' +
      t.n + ' 次训练 / ' + t.days + ' 天 / 累计容量 ' + Math.round(t.volume) + ' kg' + (volDelta === null ? '' : '（较上月 ' + (volDelta >= 0 ? '+' : '') + volDelta + '%）') + '\n' +
      (milestoneCount ? '里程碑：' + msShow.slice(0, 3).map(function (m) { return m.title; }).join('、') + (milestoneCount > Math.min(3, msShow.length) ? ' 等 ' + milestoneCount + ' 枚' : '') + '\n' : '') +
      (bodyLine ? bodyLine + '\n' : '') + fp.e + ' ' + fp.text + '\n' + summary + '\n#训练打卡 #月度回顾';

    return { ym: ym, title: title, mon: monText(ym), ongoing: ongoing, profile: p, name: p.name || '训练者', hasName: !!p.name,
      n: t.n, days: t.days, daysInMonth: dim, activeWeeks: activeWeeks, volume: t.volume, volumeText: (t.volume / 1000).toFixed(2), reps: t.reps, sets: t.sets, adds: t.adds,
      prev: pt, prevMon: monText(pm), volDelta: volDelta, calendar: calendar, best: best ? { date: best.date, day: best.day, volume: Math.round(best.volume) } : null,
      topEx: topEx.slice(0, 3), prog: progRows, milestones: msShow, milestoneCount: milestoneCount, watch: watch, watchNote: watchNote, bodyLine: bodyLine,
      fun: fp.text, funEmoji: fp.e, funTag: fp.tag, funBasis: fp.basis, funIndex: fi, funTotal: nFun, copy: summary, caption: caption, months: ms };
  }

  function paintCal(ctx, pal, x, y, w, calendar) {
    if (!calendar || !calendar.length) return 0;
    var gap = 8, dot = Math.min(26, Math.floor((w - gap * 6) / 7));
    calendar.forEach(function (row, ri) {
      row.forEach(function (cell, k) {
        if (!cell) return;
        var cx = x + k * (dot + gap), cy = y + ri * (dot + gap);
        ctx.beginPath();
        ctx.arc(cx + dot / 2, cy + dot / 2, Math.max(4, dot / 2 - 1), 0, Math.PI * 2);
        ctx.fillStyle = cell.n ? pal.accent : pal.soft;
        ctx.fill();
        if (cell.n > 1) { ctx.lineWidth = 3; ctx.strokeStyle = pal.ink; ctx.stroke(); }
      });
    });
    return calendar.length * (dot + gap);
  }
  async function draw(canvas, data, theme) {
    var P = H.Poster, avatar = await H.loadImage(data.profile && data.profile.avatar);
    function pass(finalH) {
      var ctx, pal;
      if (!finalH) {
        var opened = P.openPoster(canvas, theme);
        ctx = opened.ctx; pal = opened.pal;
      } else {
        ctx = canvas.getContext('2d');
        pal = P.palette(theme);
        P.closePoster(canvas, ctx, pal, finalH);
      }
      var y = 48;
      y = P.paintIdentity(ctx, pal, y, avatar, {
        name: data.name,
        sub: (data.profile && (data.profile.handle || data.profile.signature)) || '',
        title: data.title + '训练月报',
        tag: data.ongoing ? '进行中' : '月报'
      });
      var colW = (P.PIN - P.PGAP) / 2;
      var calH = ((data.calendar || []).length || 1) * 34;
      var colH = 268 + calH;
      var hero = P.volHero(data.volume);
      var deltaChip = data.volDelta === null ? '第一个有记录的月份' : '较上月 ' + (data.volDelta >= 0 ? '+' : '') + data.volDelta + '%';
      P.paintMini(ctx, pal, P.PX, y, colW, colH, {
        icon: '📅', title: '本月出勤', value: String(data.n), unit: '次',
        chip: data.days + ' 天 · ' + (data.activeWeeks || 0) + ' 周', tone: 'up',
        paint: function (c, p, x, yy, w) { paintCal(c, p, x, yy, w, data.calendar); }
      });
      P.paintMini(ctx, pal, P.PX + colW + P.PGAP, y, colW, colH, {
        icon: '🔥', title: '月度总容量', value: hero.v, unit: hero.u,
        chip: deltaChip, tone: data.volDelta != null && data.volDelta < 0 ? 'down' : 'up'
      });
      y += colH + P.PGAP;
      if (data.prog && data.prog.length) {
        y = P.paintSection(ctx, pal, y, {
          icon: '🏋️', title: '主项月度进步', trail: data.prog.length + ' 项', inner: data.prog.length * 108,
          paint: function (c, p, x, yy, w) {
            var max = 1;
            data.prog.forEach(function (row) { if (row.e1 > max) max = row.e1; });
            data.prog.forEach(function (row, i) {
              var ry = yy + i * 108;
              H.font(c, 30, 650);
              H.text(c, P.ellipsis(c, row.name, w * 0.62), x, ry, 30, p.ink, 650);
              c.textAlign = 'right';
              H.text(c, row.e1 + ' kg', x + w, ry, 30, p.ink, 700);
              c.textAlign = 'left';
              var note = row.prior == null ? '本月首次记录' : (row.delta > 0 ? '较上月 +' + row.delta + ' kg' : row.delta < 0 ? '较上月 ' + row.delta + ' kg' : '与上月持平');
              H.text(c, note, x, ry + 40, 24, row.delta > 0 ? p.chipInk : p.muted, 500);
              P.fillRound(c, x, ry + 76, w, 14, 7, p.soft);
              P.fillRound(c, x, ry + 76, Math.max(10, w * (row.e1 / max)), 14, 7, row.delta < 0 ? p.down : p.accent);
            });
          }
        });
        y += P.PGAP;
      }
      if (data.milestones && data.milestones.length) {
        y = P.paintBadges(ctx, pal, y, { title: '本月解锁里程碑', items: data.milestones, trail: (data.milestoneCount || data.milestones.length) + ' 枚', limit: 6 });
        y += P.PGAP;
      }
      y = P.paintFun(ctx, pal, y, { icon: '⚡', title: '月度趣味换算', emoji: data.funEmoji, text: data.fun, basis: data.funBasis, trail: data.funTag || '' });
      if (data.bodyLine) {
        y += P.PGAP;
        H.font(ctx, 30, 600);
        var bl = H.wrap(ctx, data.bodyLine, P.PIN - 64);
        y = P.paintSection(ctx, pal, y, {
          icon: '⌚', title: '手表记录', inner: Math.max(40, bl.length * 42),
          paint: function (c, p, x, yy) { bl.forEach(function (l, i) { H.text(c, l, x, yy + i * 42, 30, p.ink, 600); }); }
        });
      }
      return y + 64;
    }
    pass(pass(0));
    return canvas;
  }

  return { months: months, build: build, draw: draw, ymText: ymText, prevYm: prevYm };
});
