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
    var trained = {};
    cur.forEach(function (f) { var d = +f.date.slice(8, 10); trained[d] = (trained[d] || 0) + 1; });
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
      n: t.n, days: t.days, daysInMonth: dim, volume: t.volume, volumeText: (t.volume / 1000).toFixed(2), reps: t.reps, sets: t.sets, adds: t.adds,
      prev: pt, prevMon: monText(pm), volDelta: volDelta, calendar: calendar, best: best ? { date: best.date, day: best.day, volume: Math.round(best.volume) } : null,
      topEx: topEx.slice(0, 3), prog: progRows, milestones: msShow, milestoneCount: milestoneCount, watch: watch, watchNote: watchNote, bodyLine: bodyLine,
      fun: fp.text, funEmoji: fp.e, funTag: fp.tag, funBasis: fp.basis, funIndex: fi, funTotal: nFun, copy: summary, caption: caption, months: ms };
  }

  // ---------- 绘制 ----------
  var WEEK = ['一', '二', '三', '四', '五', '六', '日'];
  async function draw(canvas, data, theme) {
    var avatar = await H.loadImage(data.profile.avatar), ctx = canvas.getContext('2d');
    var warm = theme === 'warm', bg = warm ? '#FFF6EE' : '#F5F6F3', ink = '#20251F', muted = '#66705F', faint = '#A4AC9C', card = '#FFFFFF', fill = warm ? '#FFE8D3' : '#E6EDDF', rust = '#C55A32';
    var W = 1080, text = H.text, font = H.font, rounded = H.rounded, wrap = H.wrap;
    function pass(H0, real) {
      if (real) { canvas.width = W; canvas.height = H0; } else { canvas.width = W; canvas.height = 6000; }
      ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, real ? H0 : 6000);
      if (real) { var glow = ctx.createRadialGradient(1010, 50, 10, 880, 70, 720); glow.addColorStop(0, warm ? '#FCD7B7' : '#E0E9D9'); glow.addColorStop(1, bg); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, 700); }
      var y = 72;
      // —— 一、名片 + 月份
      var pf = data.profile, nameSize = H.fit(ctx, data.name, 700, 44, 36);
      font(ctx, 26, 400); var sigLines = pf.signature ? wrap(ctx, pf.signature, 720).slice(0, 2) : [];
      var subLine = pf.handle || '';
      var profileH = Math.max(136, 10 + nameSize + 12 + (subLine ? 34 : 0) + sigLines.length * 36 + 8);
      var AV = 132, ax = 64, cy0 = y + Math.max(0, (profileH - AV) / 2);
      ctx.save(); ctx.beginPath(); ctx.arc(ax + AV / 2, cy0 + AV / 2, AV / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      ctx.fillStyle = warm ? '#F6DCC6' : '#DCE5D3'; ctx.fillRect(ax, cy0, AV, AV);
      if (avatar) { var side = Math.min(avatar.width, avatar.height); ctx.drawImage(avatar, (avatar.width - side) / 2, (avatar.height - side) / 2, side, side, ax, cy0, AV, AV); }
      else { font(ctx, 58, 700); ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.fillText(Array.from(data.name)[0], ax + AV / 2, cy0 + AV / 2 - 34); ctx.textAlign = 'left'; }
      ctx.restore();
      ctx.lineWidth = 4; ctx.strokeStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(ax + AV / 2, cy0 + AV / 2, AV / 2 - 2, 0, Math.PI * 2); ctx.stroke();
      var tx = ax + AV + 30, ty = y + Math.max(0, (profileH - (nameSize + 12 + (subLine ? 34 : 0) + sigLines.length * 36)) / 2);
      text(ctx, data.name, tx, ty, nameSize, ink, 700); ty += nameSize + 12;
      if (subLine) { text(ctx, subLine, tx, ty, 26, muted, 500); ty += 34; }
      sigLines.forEach(function (l) { text(ctx, l, tx, ty, 26, ink, 400); ty += 36; });
      y += profileH + 30;
      ctx.strokeStyle = '#DCE1D6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(64, y); ctx.lineTo(1016, y); ctx.stroke();
      y += 30;
      text(ctx, data.title, 64, y, 56, ink, 750);
      ctx.textAlign = 'right'; text(ctx, data.ongoing ? '月报 · 进行中' : '月报', 1016, y + 22, 26, muted, 500); ctx.textAlign = 'left';
      y += 56 + 46;
      // —— 二、纵览
      H.secLabel(ctx, y, '本月纵览', muted); y += 54;
      rounded(ctx, 64, y, 952, 250, 36, card);
      text(ctx, '累计训练容量', 100, y + 32, 26, muted, 500);
      text(ctx, data.volumeText, 92, y + 74, 100, ink, 750);
      font(ctx, 100, 750); var nw = ctx.measureText(data.volumeText).width;
      text(ctx, 't', 100 + nw, y + 122, 34, muted, 550);
      var sub = H.num(data.volume) + ' kg' + (data.volDelta === null ? ' · 这是第一个有记录的月份' : ' · 较 ' + data.prevMon);
      text(ctx, sub, 100, y + 172, 26, muted, 400);
      if (data.volDelta !== null) {
        var chip = (data.volDelta >= 0 ? '↑ ' : '↓ ') + Math.abs(data.volDelta) + '%';
        font(ctx, 34, 700); var cw = Math.ceil(ctx.measureText(chip).width) + 44;
        rounded(ctx, 1016 - 36 - cw, y + 36, cw, 60, 30, fill);
        text(ctx, chip, 1016 - 36 - cw + 22, y + 48, 34, data.volDelta >= 0 ? rust : muted, 700);
      }
      y += 250 + 34;
      [[data.n, '训练次数'], [data.days, '训练天数'], [data.adds, '达到加重条件']].forEach(function (m, k) { var x = 70 + k * 322; text(ctx, m[0], x, y, 56, ink, 700); text(ctx, m[1], x, y + 66, 26, muted, 400); });
      y += 96;
      if (data.bodyLine) { y += 22; text(ctx, data.bodyLine, 70, y, 26, muted, 500); y += 34; }
      y += 34;
      // 趣味卡
      var funText = (data.funEmoji ? data.funEmoji + ' ' : '') + data.fun, fs = 44, funLines;
      do { font(ctx, fs, 700); funLines = wrap(ctx, funText, 872); if (funLines.length <= 2) break; fs -= 2; } while (fs > 32);
      font(ctx, 26, 400); var basisLines = data.funBasis ? wrap(ctx, '算法：' + data.funBasis, 872).slice(0, 2) : [];
      var funH = 36 + 26 + 14 + funLines.length * (fs + 14) + (basisLines.length ? 10 + basisLines.length * 34 : 0) + 36;
      rounded(ctx, 64, y, 952, funH, 36, fill);
      var fy = y + 36; text(ctx, data.funTag, 100, fy, 26, muted, 650); fy += 26 + 14;
      funLines.forEach(function (l, k) { text(ctx, l, 100, fy + k * (fs + 14), fs, ink, 700); });
      fy += funLines.length * (fs + 14) + 10;
      basisLines.forEach(function (l, k) { text(ctx, l, 100, fy + k * 34, 26, muted, 400); });
      y += funH + 52;
      // —— 三、训练日历
      H.secLabel(ctx, y, '训练日历', muted);
      ctx.textAlign = 'right'; text(ctx, data.days + ' / ' + data.daysInMonth + ' 天', 1016, y + 2, 26, muted, 500); ctx.textAlign = 'left';
      y += 62;
      var rows = data.calendar.length, calH = 28 + 40 + rows * 80 + 20;
      rounded(ctx, 64, y, 952, calH, 36, card);
      var cw7 = 952 / 7;
      ctx.textAlign = 'center';
      WEEK.forEach(function (w, k) { text(ctx, w, 64 + cw7 * k + cw7 / 2, y + 28, 22, faint, 600); });
      data.calendar.forEach(function (row, ri) {
        row.forEach(function (c, k) {
          if (!c) return;
          var cx = 64 + cw7 * k + cw7 / 2, cy = y + 28 + 40 + ri * 80 + 36;
          if (c.n > 0) {
            ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fillStyle = rust; ctx.fill();
            if (c.n > 1) { ctx.beginPath(); ctx.arc(cx, cy, 36, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = rust; ctx.stroke(); }
            text(ctx, c.d, cx, cy - 15, 30, '#FFFFFF', 700);
          } else text(ctx, c.d, cx, cy - 15, 30, faint, 500);
        });
      });
      ctx.textAlign = 'left';
      y += calH + 52;
      // —— 四、估算 1RM 变化
      if (data.prog.length) {
        H.secLabel(ctx, y, '估算 1RM 变化', muted);
        ctx.textAlign = 'right'; text(ctx, data.prog.length + ' 项动作', 1016, y + 2, 26, muted, 500); ctx.textAlign = 'left';
        y += 62;
        data.prog.forEach(function (p) {
          ctx.strokeStyle = '#DCE1D6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(64, y - 18); ctx.lineTo(1016, y - 18); ctx.stroke();
          text(ctx, p.tier, 64, y + 4, 26, muted, 650);
          font(ctx, 34, 650); var nm = wrap(ctx, p.name, 420)[0];
          text(ctx, nm, 148, y, 34, ink, 650);
          var note = p.prior === null ? '本月首次记录' : (p.delta > 0 ? '较上月 +' + p.delta + ' kg' : p.delta < 0 ? '较上月 ' + p.delta + ' kg' : '与上月持平');
          text(ctx, note, 148, y + 44, 26, p.delta > 0 ? rust : muted, p.delta > 0 ? 650 : 400);
          ctx.textAlign = 'right'; text(ctx, p.e1 + ' kg', 1016, y + 2, 34, ink, 700); text(ctx, p.prior === null ? '基线' : (p.delta > 0 ? '+' + p.pct + '%' : p.pct + '%'), 1016, y + 44, 26, muted, 400); ctx.textAlign = 'left';
          y += 96 + 28;
        });
        y += 14;
      }
      // —— 五、里程碑
      if (data.milestones.length) {
        H.secLabel(ctx, y, '本月里程碑', muted);
        ctx.textAlign = 'right'; text(ctx, data.milestoneCount + ' 枚', 1016, y + 2, 26, muted, 500); ctx.textAlign = 'left';
        y += 62;
        var bx = 64, by = y;
        data.milestones.slice(0, 6).forEach(function (b) {
          var label = b.e + ' ' + b.title; font(ctx, 26, 650);
          var bw = Math.ceil(ctx.measureText(label).width) + 56;
          if (bx + bw > 1016) { bx = 64; by += 76; }
          rounded(ctx, bx, by, bw, 60, 30, warm ? '#FFDFC0' : '#DCE8D3');
          text(ctx, label, bx + 28, by + 17, 26, ink, 650);
          bx += bw + 16;
        });
        if (data.milestoneCount > Math.min(6, data.milestones.length)) text(ctx, '… 等 ' + data.milestoneCount + ' 枚', bx, by + 17, 26, muted, 500);
        y = by + 60 + 52;
      }
      // —— 六、小结
      H.secLabel(ctx, y, '本月小结', muted); y += 54;
      font(ctx, 34, 500); var sm = wrap(ctx, data.copy, 880);
      sm.forEach(function (l, k) { text(ctx, l, 84, y + k * 46, 34, ink, 500); });
      y += sm.length * 46 + 72;
      return y;
    }
    var total = pass(0, false);
    pass(total, true);
    return canvas;
  }

  return { months: months, build: build, draw: draw, ymText: ymText, prevYm: prevYm };
});
