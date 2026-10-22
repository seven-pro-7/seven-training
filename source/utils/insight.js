/* 动作洞察：每个动作的历史曲线、容量与估算 1RM。纯数据，不改训练记录。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine'));
  else root.GZInsight = factory(root.GZ);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GZ) {
  'use strict';

  var REP_CAP = 12;          // T2/T3 估算时单组次数上限：Epley 在高次数下会明显高估，超过 12 次按 12 次计（偏保守）
  var TIER_ORDER = { T1: 1, T2: 2, T3: 3 };

  function r1(v) { return Math.round(v * 10) / 10; }
  function hasEntry(e, deload) { return !!e && !e.skip && (!!deload || (e.v !== null && e.v !== undefined && e.v !== '')); }
  function md(date) { return date.slice(5).replace('-', '/'); }

  /**
   * 单次估算 1RM（Epley：1RM = 重量 × (1 + 次数 / 30)）。
   *   T1：沿用引擎里末组 AMRAP 的估算，可信度最高
   *   T2：用「实际完成次数 ÷ 组数」当作每组次数，完成全部组数即至少做到了这么多，所以是偏保守的下限
   *   T3：用末组次数，超过 12 次按 12 次计
   * 自重动作没有外加重量，不估算。返回 null 表示这次不能估。
   */
  function estimate(it) {
    if (!it || it.deload || it.judgment === '跳过') return null;
    var equip = GZ.equipOf(it.name, it.equip), w = Number(it.weight) || 0;
    if (equip === '自重' || w <= 0) return null;
    if (it.tier === 'T1') {
      if (!(it.e1rm > 0)) return null;
      var a = Number(it.input) || 0;
      return { v: r1(it.e1rm), kind: '末组 AMRAP', conf: a <= 10 ? 'high' : 'mid', reps: a, capped: false };
    }
    if (it.tier === 'T2') {
      var per = (Number(it.actualReps) || 0) / (Number(it.sets) || 1);
      if (!(per > 0)) return null;
      var rr = Math.min(per, REP_CAP);
      return { v: r1(w * (1 + rr / 30)), kind: '完成次数折算', conf: 'mid', reps: r1(per), capped: per > REP_CAP };
    }
    var t = Number(it.input) || 0;
    if (!(t > 0)) return null;
    var rt = Math.min(t, REP_CAP);
    return { v: r1(w * (1 + rt / 30)), kind: '末组次数', conf: t > REP_CAP ? 'low' : 'mid', reps: t, capped: t > REP_CAP };
  }

  /** 一次动作的总次数 */
  function repsOf(it) {
    if (it.tier === 'T2') return Math.max(0, Number(it.actualReps) || 0);
    return Math.max(0, (Number(it.sets) - 1) * Number(it.reps) + (Number(it.input) || 0));
  }

  /**
   * 从回放结果里整理出每个动作的全部记录点（按训练先后）。
   * 口径与「最高重量」一致：以实际做过的动作名为准（含替换后的动作），跳过与减载不计。
   */
  function collect(rp) {
    var byName = {}, order = [];
    rp.sessions.forEach(function (s, idx) {
      s.items.forEach(function (it) {
        var e = (s.rec.entries || {})[it.slotId];
        if (!hasEntry(e, s.rec.deload) || it.deload || it.judgment === '跳过') return;
        var equip = GZ.equipOf(it.name, it.equip), bw = equip === '自重';
        var est = estimate(it);
        var last = it.tier === 'T2' ? null : (Number(it.input) || 0);
        var pt = {
          sid: s.rec.id, date: s.rec.date, md: md(s.rec.date), day: s.rec.day, week: s.week, order: idx,
          tier: it.tier, badge: it.badge || it.tier, stage: it.stage, equip: equip, bw: bw, weight: Number(it.weight) || 0,
          sets: Number(it.sets) || 0, reps: repsOf(it), last: last, volume: bw ? 0 : (Number(it.volume) || 0),
          e1rm: est ? est.v : null, e1kind: est ? est.kind : '', e1conf: est ? est.conf : '', e1capped: est ? est.capped : false,
          judgment: it.judgment, input: it.input, lift: it.lift || '', sub: !!it.sub
        };
        if (!byName[it.name]) { byName[it.name] = []; order.push(it.name); }
        byName[it.name].push(pt);
      });
    });
    return { byName: byName, order: order };
  }

  function dayNum(d) { var p = d.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }

  /** 动作清单：按档位（T1 → T3）、再按最近练的先后 */
  function list(db, rp) {
    rp = rp || GZ.replay(db);
    var c = collect(rp), out = [];
    c.order.forEach(function (name) {
      var pts = c.byName[name], lastPt = pts[pts.length - 1], bestW = 0, bestE = 0, vol = 0;
      pts.forEach(function (p) { if (p.weight > bestW) bestW = p.weight; if (p.e1rm && p.e1rm > bestE) bestE = p.e1rm; vol += p.volume; });
      out.push({ name: name, tier: lastPt.tier, equip: lastPt.equip, bw: lastPt.bw, n: pts.length, lastDate: lastPt.date,
        lastWeight: lastPt.weight, bestWeight: bestW, bestE1: bestE ? r1(bestE) : null, volume: Math.round(vol) });
    });
    out.sort(function (a, b) {
      if (a.tier !== b.tier) return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
      return a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0;
    });
    return out;
  }

  /** 单个动作的详情：曲线、容量、估算 1RM 趋势 */
  function detail(db, name, rp) {
    rp = rp || GZ.replay(db);
    var c = collect(rp), pts = c.byName[name];
    if (!pts || !pts.length) return null;
    var P = db.params || {}, first = pts[0], lastPt = pts[pts.length - 1];
    var bw = lastPt.bw, tiers = {}, days = {};
    var labelOf = {};
    pts.forEach(function (p) { if (!labelOf[p.tier]) labelOf[p.tier] = p.badge || p.tier; tiers[p.tier] = 1; days[p.day] = 1; });
    var tierList = Object.keys(tiers).sort();
    var allE1 = pts.filter(function (p) { return p.e1rm; });
    // 同一个动作可能同时出现在 T1 和 T2（如杠铃深蹲）。估算 1RM 以最可靠的档位为准：T1 末组 AMRAP > T2 > T3；
    // 其他档位的点仍画在图上做参考，但不参与最佳值、变化量与趋势线
    var primary = tierList.filter(function (t) { return allE1.some(function (p) { return p.tier === t; }); })[0] || lastPt.tier;
    var bestW = null, bestE = null, vol = 0, reps = 0, adds = 0, bestV = null;
    pts.forEach(function (p) {
      if (!bestW || p.weight >= bestW.weight) bestW = p;
      if (p.e1rm && p.tier === primary && (!bestE || p.e1rm >= bestE.e1rm)) bestE = p;
      if (!bestV || p.volume > bestV.volume) bestV = p;
      vol += p.volume; reps += p.reps; if (p.judgment === '加重') adds++;
    });
    var e1pts = allE1.filter(function (p) { return p.tier === primary; });
    // 趋势：以相隔天数（周）为横轴，至少 3 个点才给回归，避免两点连线被当成规律
    var reg = null;
    if (e1pts.length >= 3) {
      var d0 = dayNum(e1pts[0].date);
      reg = GZ.linreg(e1pts.map(function (p) { return [(dayNum(p.date) - d0) / 7, p.e1rm]; }));
      if (reg && dayNum(e1pts[e1pts.length - 1].date) === d0) reg = null;
    }
    var latestE = e1pts.length ? e1pts[e1pts.length - 1] : null, firstE = e1pts.length ? e1pts[0] : null;
    var lift = lastPt.lift, ref = lift && P.oneRM && P.oneRM[lift] ? P.oneRM[lift] : null;
    var tip = '';
    if (bw) tip = '自重动作没有外加重量，不估算 1RM；曲线显示' + (lastPt.tier === 'T2' ? '总次数' : '末组次数') + '。';
    else if (!e1pts.length) tip = '这个动作还没有可以估算 1RM 的记录。';
    else if (e1pts.length < 2) tip = '再练一次就能看到估算 1RM 的变化。';
    else if (e1pts.length < 4) tip = '样本较少，趋势仅供参考。';
    if (!bw && tierList.length > 1 && allE1.length) tip = (tip ? tip + ' ' : '') + '这个动作同时出现在 ' + tierList.map(function (t) { return labelOf[t] || t; }).join('、') + '，最佳值与趋势以 ' + (labelOf[primary] || primary) + ' 为准，其他档位的点仅作参考。';
    var capped = e1pts.some(function (p) { return p.e1capped; });
    function perfOf(p) { return bw ? (p.last !== null ? p.last : p.reps) : p.weight; }
    var byTier = {};
    tierList.forEach(function (t) {
      byTier[t] = {
        perf: pts.map(function (p) { return p.tier === t ? perfOf(p) : null; }),
        e1rm: pts.map(function (p) { return p.tier === t ? p.e1rm : null; }),
        volume: pts.map(function (p) { return p.tier === t ? Math.round(p.volume) : 0; })
      };
    });
    var series = {
      labels: pts.map(function (p) { return p.md; }), byTier: byTier, primary: primary,
      perf: pts.map(perfOf),
      volume: pts.map(function (p) { return Math.round(p.volume); }),
      e1rm: pts.map(function (p) { return p.e1rm; }),
      reg: reg ? pts.map(function (p) { return p.e1rm && p.tier === primary ? r1(reg.predict((dayNum(p.date) - dayNum(e1pts[0].date)) / 7)) : null; }) : null
    };
    return {
      name: name, tier: lastPt.tier, tierLabel: labelOf, tiers: Object.keys(tiers).sort(), days: Object.keys(days), equip: lastPt.equip, bw: bw,
      unit: GZ.unitOf(lastPt.equip), n: pts.length, firstDate: first.date, lastDate: lastPt.date,
      bestWeight: bestW ? { v: bestW.weight, date: bestW.date } : null,
      lastWeight: lastPt.weight,
      bestE1: bestE ? { v: bestE.e1rm, date: bestE.date } : null,
      latestE1: latestE ? { v: latestE.e1rm, date: latestE.date, kind: latestE.e1kind } : null,
      e1Delta: latestE && firstE && e1pts.length >= 2 ? r1(latestE.e1rm - firstE.e1rm) : null,
      e1Count: e1pts.length, e1Kind: latestE ? latestE.e1kind : '', primary: primary, e1Capped: capped,
      slope: reg ? Math.round(reg.slope * 100) / 100 : null, r2: reg ? Math.round(reg.r2 * 100) / 100 : null,
      ref: ref, vsRef: ref && bestE ? Math.round((bestE.e1rm / ref - 1) * 1000) / 10 : null,
      volume: Math.round(vol), avgVolume: Math.round(vol / pts.length), reps: reps, adds: adds,
      bestVolume: bestV && bestV.volume > 0 ? { v: Math.round(bestV.volume), date: bestV.date } : null,
      series: series, points: pts, recent: pts.slice(-8).reverse(), tip: tip
    };
  }

  return { REP_CAP: REP_CAP, estimate: estimate, collect: collect, list: list, detail: detail, repsOf: repsOf };
});
