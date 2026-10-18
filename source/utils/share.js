/* 训练分享：纯数据聚合 + Canvas 海报。不调用外部服务，不读取同步令牌。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine'), require('./badges'));
  else root.GZShare = factory(root.GZ, root.GZBadges);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GZ, Badges) {
  'use strict';
  var PROFILE = { name: '', handle: '', signature: '', avatar: '', showWeight: false };
  // ---------- 趣味换算：诚实的算术对照 + 数据彩蛋 ----------
  // 对照物：[emoji, 质量 kg, 名称, 量词, 动词, 质量说明, 占比用语]
  // 质量取常见典型值，说明里写明「约」或「按」；换算只是累计容量 ÷ 质量，不代表一次举起。
  var THINGS = [
    ['🧱', 2.5, '红砖', '块', '垒起', '约 2.5 kg', '重量'],
    ['💻', 1.5, '笔记本电脑', '台', '叠起', '约 1.5 kg', '重量'],
    ['🐈', 4.5, '家猫', '只', '抱起', '约 4.5 kg', '体重'],
    ['🍉', 5, '大西瓜', '个', '抱起', '约 5 kg', '重量'],
    ['🎳', 6, '保龄球', '个', '搬起', '约 6 kg', '重量'],
    ['📦', 10, '快递箱', '件', '搬走', '约 10 kg', '重量'],
    ['🐕', 12, '柯基', '只', '举起', '约 12 kg', '体重'],
    ['🎒', 15, '登山包', '个', '背起', '约 15 kg', '重量'],
    ['🚲', 15, '山地车', '辆', '扛上楼', '约 15 kg', '重量'],
    ['🧳', 20, '行李箱', '个', '提起', '约 20 kg', '重量'],
    ['🛢️', 30, '满瓶液化气钢瓶', '罐', '扛起', '约 30 kg', '重量'],
    ['🧊', 60, '家用冰箱', '台', '抬起', '约 60 kg', '重量'],
    ['🧑', 70, '成年人', '位', '背起', '按 70 kg 计', '体重'],
    ['🐼', 100, '大熊猫', '只', '抱起', '约 100 kg', '体重'],
    ['🦁', 190, '雄狮', '头', '抱起', '约 190 kg', '体重'],
    ['🏍️', 200, '摩托车', '辆', '抬起', '约 200 kg', '重量'],
    ['🎹', 250, '三角钢琴', '架', '抬起', '约 250 kg', '重量'],
    ['🐻', 350, '棕熊', '头', '抱起', '约 350 kg', '体重'],
    ['🐎', 500, '骏马', '匹', '举起', '约 500 kg', '体重'],
    ['🚗', 1000, '小型车', '辆', '托起', '约 1 t', '重量'],
    ['🦛', 1500, '河马', '头', '托起', '约 1.5 t', '体重'],
    ['🐘', 5000, '非洲象', '头', '托起', '约 5 t', '体重'],
    ['🚌', 12000, '公交车', '辆', '托起', '约 12 t', '重量'],
    ['✈️', 41000, '波音 737 客机（空机）', '架', '托起', '约 41 t', '重量'],
    ['🐋', 150000, '蓝鲸', '头', '托起', '约 150 t', '体重'],
    ['🗼', 7300000, '埃菲尔铁塔钢铁结构', '座', '托起', '约 7300 t', '重量']
  ];
  function num(n, digits) { return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: digits === undefined ? 1 : digits }); }
  function hashSeed(s) { var h = 2166136261; Array.from(String(s)).forEach(function (c) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }); return h >>> 0; }
  /** 固定种子洗牌：同一次训练顺序稳定，翻页不会重复 */
  function shuffled(list, seed) {
    var a = list.slice(), s = seed || 1;
    function rnd() { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }
  /** 把一个重量按对照物换算成「相当于…」；不合适（太多或太少）返回 null */
  // 每条只带一个 emoji，且只出现一次；文案本身说清数字与单位。
  function compare(volume, t, lead) {
    var r = volume / t[1], pre = lead || '';
    if (r >= 2 && r <= 3000) {
      var n = Math.round(r);
      return { e: t[0], tag: '重量对照',
        text: pre + '相当于' + t[4] + ' ' + num(n, 0) + ' ' + t[3] + t[2],
        basis: num(volume) + ' kg ÷ ' + t[5].replace(/^约 |^按 /, '') + '（' + t[2] + '）≈ ' + num(n, 0) };
    }
    if (r >= 0.05 && r < 2 && t[1] >= 100) {
      var pct = r * 100;
      return { e: t[0], tag: '重量对照',
        text: pre + '相当于 1 ' + t[3] + t[2] + t[6] + '的 ' + num(pct, pct < 10 ? 1 : 0) + '%',
        basis: num(volume) + ' kg ÷ ' + t[5].replace(/^约 |^按 /, '') + '（' + t[2] + '）' };
    }
    return null;
  }
  // 能量对照：[emoji, 名称, 单份千卡, 量词, 份量说明]。千卡是手表估算，文案里会写明
  var FOODS = [
    ['🥚', '水煮蛋', 75, '个', '1 个约 50 g'],
    ['🍌', '香蕉', 90, '根', '中等大小一根'],
    ['🍎', '苹果', 95, '个', '中等大小一个'],
    ['🥤', '可乐', 140, '罐', '330 ml 一罐'],
    ['🍚', '白米饭', 230, '碗', '熟米饭约 200 g 一碗'],
    ['🍔', '汉堡', 250, '个', '普通汉堡一个'],
    ['🍕', '披萨', 285, '片', '一片约 100 g'],
    ['🧋', '奶茶', 300, '杯', '中杯约 500 ml']
  ];
  /** 手表数据派生的说法：只有这次训练对上了手表记录才会出现 */
  function watchEggs(d) {
    var w = d.watch, out = [];
    if (!w) return out;
    if (w.kcal > 0) FOODS.forEach(function (f) {
      var r = w.kcal / f[2];
      if (r < 0.8 || r > 40) return;
      var n = Math.max(1, Math.round(r));
      out.push({ e: f[0], tag: '能量对照', text: '手表估算消耗 ' + num(w.kcal, 0) + ' 千卡，约等于 ' + n + ' ' + f[3] + f[1],
        basis: num(w.kcal, 0) + ' kcal ÷ ' + f[2] + ' kcal（' + f[1] + '，' + f[4] + '）≈ ' + n + '；热量为手表估算，仅作趣味参考' });
    });
    if (w.min > 0 && d.volume > 0) out.push({ e: '⚡', tag: '训练密度', text: '平均每分钟搬运 ' + num(d.volume / w.min) + ' kg', basis: num(d.volume) + ' kg ÷ ' + w.min + ' 分钟（手表计时）' });
    return out;
  }
  /** 数据彩蛋：只用本次或历史记录里的真实数字，不编造 */
  function eggs(d) {
    var out = [], v = d.volume;
    if (d.reps > 0) out.push({ e: '💪', tag: '数据彩蛋', text: num(d.reps, 0) + ' 次发力，每一次都算数', basis: '本次记录的组次合计' });
    if (v > 0 && d.reps > 0) out.push({ e: '⚖️', tag: '数据彩蛋', text: '平均每次发力 ' + num(v / d.reps) + ' kg', basis: num(v) + ' kg ÷ ' + num(d.reps, 0) + ' 次' });
    if (d.reps > 0) {
      var sec = d.reps * 3;
      out.push({ e: '⏱️', tag: '数据彩蛋', text: '按每次约 3 秒计，累计发力约 ' + (sec < 90 ? sec + ' 秒' : num(sec / 60) + ' 分钟'), basis: num(d.reps, 0) + ' 次 × 3 秒（估算）' });
    }
    if (d.sets > 0) out.push({ e: '🔁', tag: '数据彩蛋', text: d.sets + ' 组、' + d.rows.length + ' 项动作，都记在了账上', basis: '每组都有记录' });
    if (d.adds > 0) out.push({ e: '🔥', tag: '数据彩蛋', text: d.adds + ' 个动作达到加重条件', basis: '按计划规则判定' });
    if (v > 0 && d.rows.length > 1) {
      var top = d.rows.slice().sort(function (a, b) { return b.volume - a.volume; })[0], share = top.volume / v * 100;
      if (share >= 20) out.push({ e: '🏆', tag: '数据彩蛋', text: top.name + ' 贡献了 ' + Math.round(share) + '% 的训练容量', basis: num(top.volume) + ' kg ÷ ' + num(v) + ' kg' });
    }
    if (v > 0 && d.prevVolume > 0) {
      var diff = v - d.prevVolume, pct = Math.abs(diff) / d.prevVolume * 100;
      out.push(diff >= 0
        ? { e: '📈', tag: '和上次比', text: '比上次 ' + d.day + ' 多举了 ' + num(diff) + ' kg', basis: num(d.prevVolume) + ' → ' + num(v) + ' kg' }
        : { e: '🌿', tag: '和上次比', text: '比上次 ' + d.day + ' 少了 ' + num(-diff) + ' kg，恢复也是训练', basis: num(d.prevVolume) + ' → ' + num(v) + ' kg' });
    }
    if (d.totalVolume > 0 && d.seq > 0) {
      var lead = '历史累计 ' + num(d.totalVolume / 1000, 2) + ' t，', big = null;
      THINGS.slice().reverse().some(function (t) { big = compare(d.totalVolume, t, lead); return !!big; });
      out.push(big ? { e: big.e, tag: '累计里程', text: big.text, basis: '累计 ' + num(d.totalVolume) + ' kg ÷ ' + big.basis.split(' ÷ ')[1] }
        : { e: '🎯', tag: '累计里程', text: '第 ' + d.seq + ' 次训练，历史累计 ' + num(d.totalVolume / 1000, 2) + ' t', basis: '累计 ' + num(d.totalVolume) + ' kg' });
    }
    return out;
  }
  /** 全部可用说法（洗牌后的稳定顺序）。每换一次就翻到下一条，一轮内不重复 */
  function funPool(seedKey, d) {
    var items = THINGS.map(function (t) { return compare(d.volume, t); }).filter(Boolean).concat(eggs(d)).concat(watchEggs(d));
    return shuffled(items, hashSeed(seedKey));
  }
  function chooseFun(seedKey, opts, d) {
    opts = opts || {};
    var pool = funPool(seedKey, d), n = pool.length;
    if (!n) return { e: '💪', tag: '数据彩蛋', text: '认真练习的一天', basis: '', index: 0, total: 1 };
    var v = Number(opts.funVariant) || 0; v = Number.isFinite(v) ? Math.trunc(v) : 0;
    var idx = ((v % n) + n) % n, pick = pool[idx];
    return { e: pick.e, tag: pick.tag, text: pick.text, basis: pick.basis, index: idx, total: n };
  }
  function clean(v, n) { return String(v || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n); }
  function profile(p) {
    p = p || {};
    return { name: clean(p.name, 18), handle: clean(p.handle, 24), signature: clean(p.signature, 48),
      avatar: /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.avatar || '') && p.avatar.length < 180000 ? p.avatar : '',
      showWeight: p.showWeight === true };
  }
  function hasEntry(e, deload) { return !!e && !e.skip && (!!deload || (e.v !== null && e.v !== undefined && e.v !== '')); }
  function dates(db) {
    var set = {};
    (db.records || []).forEach(function (r) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && Object.keys(r.entries || {}).some(function (id) { return hasEntry(r.entries[id], r.deload); })) set[r.date] = true;
    });
    return Object.keys(set).sort().reverse();
  }
  /** 可分享的训练记录（每次训练一条），最新在前。同一天练两次 = 两条，不合并 */
  function sessionList(db, rp) {
    rp = rp || GZ.replay(db);
    var out = [];
    rp.sessions.forEach(function (s, i) {
      var ok = s.items.some(function (it) { var e = (s.rec.entries || {})[it.slotId]; return hasEntry(e, s.rec.deload) && it.judgment !== '跳过'; });
      if (!ok || !/^\d{4}-\d{2}-\d{2}$/.test(s.rec.date || '')) return;
      out.push({ id: s.rec.id, date: s.rec.date, day: s.rec.day, dayName: s.dayName, week: s.week, order: i,
        label: s.rec.date.slice(5).replace('-', '月') + '日 · ' + s.rec.day + ' ' + s.dayName });
    });
    out.forEach(function (x, i) { x.seq = i + 1; });
    return out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.order - a.order; });
  }
  /** 有效训练（时间先后）：徽章计算的输入，口径与分享卡片一致 */
  function validSessions(rp) {
    var out = [];
    rp.sessions.forEach(function (s, i) {
      var ok = s.items.some(function (it) { var e = (s.rec.entries || {})[it.slotId]; return hasEntry(e, s.rec.deload) && it.judgment !== '跳过'; });
      if (!ok || !/^\d{4}-\d{2}-\d{2}$/.test(s.rec.date || '')) return;
      // adds：这次达到加重条件的动作数；lifts：T1 主项这次完成目标（加重/保持）的工作重量，失败或降阶不算
      var adds = 0, lifts = {};
      s.items.forEach(function (it) {
        var e = (s.rec.entries || {})[it.slotId];
        if (!hasEntry(e, s.rec.deload) || it.judgment === '跳过' || it.deload) return;
        if (it.judgment === '加重') adds++;
        if (it.tier === 'T1' && it.lift && (it.judgment === '加重' || it.judgment === '保持') && GZ.equipOf(it.name, it.equip) !== '自重') {
          lifts[it.lift] = Math.max(lifts[it.lift] || 0, Number(it.weight) || 0);
        }
      });
      out.push({ id: s.rec.id, date: s.rec.date, day: s.rec.day, week: s.week, order: i, volume: sessionVolume(s), adds: adds, lifts: lifts });
    });
    return out;
  }
  function badgeStateFrom(db, facts) {
    return Badges.compute(facts.map(function (f) { return Object.assign({}, f); }), { params: db.params, dayIds: (db.days || []).map(function (d) { return d.id; }), today: GZ.today(), watch: db.params && db.params.watch });
  }
  /** 徽章墙与卡片用的完整状态 */
  function badgeState(db) { var rp = GZ.replay(db); return badgeStateFrom(db, validSessions(rp)); }
  function badgeBrief(state, id) { var d = state.byId[id]; return { id: id, title: d.title, e: d.e, desc: d.desc, group: d.group }; }
  /**
   * key：训练记录 id（推荐）；兼容旧调用传日期——取那天最后一次训练。
   * 不传：今天有训练取今天最后一次，否则取最近一次。
   */
  function build(db, key, opts) {
    opts = opts || {};
    var rp = GZ.replay(db), list = sessionList(db, rp), pick = null;
    if (key) pick = list.filter(function (x) { return x.id === key; })[0] || list.filter(function (x) { return x.date === key; })[0] || null;
    if (!pick) pick = list[0] || null;
    if (!pick) return null;
    var selected = pick.date;
    var sessions = rp.sessions.filter(function (s) { return s.rec.id === pick.id; });
    var rows = [], volume = 0, reps = 0, sets = 0, adds = 0, estimated = false, bw = null, included = [];
    sessions.forEach(function (s) {
      if (Number(s.rec.bw) > 0) bw = Number(s.rec.bw);
      s.items.forEach(function (it) {
        var e = (s.rec.entries || {})[it.slotId];
        if (!hasEntry(e, s.rec.deload) || it.judgment === '跳过') return;
        if (included.indexOf(s.rec.id) < 0) included.push(s.rec.id);
        var nsets = it.deload ? it.dSets : it.sets, nreps;
        if (it.deload) { nreps = nsets * it.reps; estimated = true; }
        else if (it.tier === 'T2') { nreps = it.actualReps; if (e.v !== '完成' && (e.reps === undefined || e.reps === null || e.reps === '')) estimated = true; }
        else nreps = (nsets - 1) * it.reps + Number(it.input || 0);
        nreps = Math.max(0, Number(nreps) || 0);
        var equip = GZ.equipOf(it.name, it.equip), w = it.deload ? it.dWeight : it.weight;
        var load = equip === '自重' ? '自重' : GZ.fmtW(w) + ' ' + GZ.unitOf(equip);
        var result = it.deload ? '减载完成' : it.tier === 'T2' ? (e.v === '完成' ? '完成' : '部分完成') : '末组 ' + it.input + ' 次';
        if (it.judgment === '加重') adds++;
        var recordedVolume = equip === '自重' ? 0 : it.volume;
        volume += recordedVolume; reps += nreps; sets += nsets;
        rows.push({ day: s.rec.day, tier: it.tier, name: it.name, load: load, stage: it.stage, result: result,
          reps: nreps, sets: nsets, judgment: it.judgment, volume: recordedVolume });
      });
    });
    if (!rows.length) return null;
    var p = profile(db.params.shareProfile);
    var summary = '记录了 ' + rows.length + ' 项动作、' + Math.round(reps) + ' 次训练动作。' +
      (sessions.some(function(x){return x.rec.deload;}) ? '减载也是计划的一部分。认真练习，也认真恢复。' : adds > 0 ? adds + ' 个动作达到加重条件。把进步留在记录里，把恢复留给接下来的自己。' : '加重不是每次训练的唯一答案。保持节奏，每次认真练习都算数。');
    // 历史累计（到本次为止）与「上一次同训练日」容量：只读已有记录，不改数据
    var facts = validSessions(rp), me = facts.filter(function (f) { return f.id === pick.id; })[0];
    var totalVolume = 0, prevVolume = 0;
    facts.forEach(function (f) {
      if (f.order <= me.order) totalVolume += f.volume;
      if (f.order < me.order && f.day === pick.day && f.volume > 0) prevVolume = f.volume;
    });
    // 手表：同一天按先后与训练记录一一对应；没对上就不显示任何身体数据
    var wk = Badges.watchFor(db.params && db.params.watch, facts, me);
    var state = badgeStateFrom(db, facts), cands = state.bySession[pick.id] || [];
    // 卡片只展示一枚：用户手选优先（可取消为 0 枚）；否则按「训练 id + 换一个次数」稳定随机
    var chosen = [];
    if (Array.isArray(opts.badgePick)) chosen = opts.badgePick.filter(function (id) { return cands.indexOf(id) >= 0; }).slice(0, 1);
    else if (cands.length) chosen = [Badges.pickOne(cands, pick.id, opts.badgeVariant)];
    var bodyParts = [];
    if (wk) {
      bodyParts.push('用时 ' + wk.min + ' 分');
      if (wk.avgHr > 0) bodyParts.push('平均心率 ' + wk.avgHr);
      if (wk.kcal > 0) bodyParts.push('消耗 ' + wk.kcal + ' 千卡');
    }
    var bodyLine = opts.body === true && bodyParts.length ? '手表记录 · ' + bodyParts.join(' · ') : '';
    var fn = chooseFun(selected + pick.id, opts, { volume: volume, reps: reps, sets: sets, rows: rows, adds: adds,
      day: pick.day, seq: pick.seq, totalVolume: totalVolume, prevVolume: prevVolume, watch: wk });
    var fun = fn.text;
    var weekText = GZ.weekText(pick.week, db.params);
    return { recordId: pick.id, day: pick.day, dayName: pick.dayName, week: pick.week, weekText: weekText, seq: pick.seq, label: pick.label,
      date: selected, isToday: selected === GZ.today(), profile: p, name: p.name || '训练者', hasName: !!p.name,
      copy: summary, volume: Math.round(volume * 100) / 100, volumeText: (volume / 1000).toFixed(2),
      reps: Math.round(reps), sets: sets, adds: adds, estimated: estimated, rows: rows,
      sessions: 1, days: pick.day + ' ' + pick.dayName, trainingDays: pick.seq, weight: p.showWeight && bw !== null ? bw : null,
      fun: fun, funEmoji: fn.e, funTag: fn.tag, funBasis: fn.basis, funIndex: fn.index, funTotal: fn.total,
      badges: chosen.map(function (id) { return badgeBrief(state, id); }), badgeCands: cands.map(function (id) { return badgeBrief(state, id); }),
      badgeEarned: state.earnedCount, badgeAll: state.total, watchBody: wk ? { min: wk.min, sets: wk.sets, avgHr: wk.avgHr, kcal: wk.kcal } : null, bodyLine: bodyLine,
      caption: (p.name || '训练者') + (p.handle ? ' ' + p.handle : '') + ' · ' + selected + ' · ' + pick.day + ' ' + pick.dayName + ' · 第 ' + pick.seq + ' 次训练\n' +
        rows.length + ' 项动作 / ' + (estimated ? '估算 ' : '') + Math.round(reps) + ' 次 / ' + (estimated ? '估算' : '累计') + '容量 ' + Math.round(volume) + ' kg\n' +
        (chosen.length ? '里程碑：' + chosen.map(function (id) { return state.byId[id].title; }).join('、') + '\n' : '') + (bodyLine ? bodyLine + '\n' : '') +
        fn.e + ' ' + fun + '\n' + '训练小结：' + summary + '\n#训练打卡 #认真练习' };
  }
  /** 一次训练的计入容量（自重不计 kg，与卡片口径一致） */
  function sessionVolume(s) {
    var v = 0;
    s.items.forEach(function (it) {
      var e = (s.rec.entries || {})[it.slotId];
      if (!hasEntry(e, s.rec.deload) || it.judgment === '跳过') return;
      if (GZ.equipOf(it.name, it.equip) === '自重') return;
      v += Number(it.volume) || 0;
    });
    return v;
  }

  function font(ctx, size, weight) { ctx.font = (weight || 400) + ' ' + size + 'px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'; }
  function rounded(ctx, x, y, w, h, r, fill) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  function text(ctx, value, x, y, size, color, weight) { font(ctx, size, weight); ctx.fillStyle = color; ctx.fillText(String(value), x, y); }
  function fit(ctx, value, width, size, min) { for (var n = size; n > min; n -= 2) { font(ctx,n,600); if (ctx.measureText(value).width <= width) return n; } return min; }
  function wrap(ctx, str, width) {
    var out = [], line = '';
    var NOHEAD = /[。，、！？；：”’）》」』…,.!?;:)]/;
    Array.from(str).forEach(function (c) {
      if (c === '\n') { out.push(line); line = ''; }
      else if (ctx.measureText(line+c).width > width && line) {
        // 避头点：标点不能单独起行，把上一个字带到下一行
        if (NOHEAD.test(c) && line.length > 1) { var arr = Array.from(line), last = arr.pop(); out.push(arr.join('')); line = last + c; }
        else { out.push(line); line = c; }
      } else line += c;
    });
    if (line) out.push(line); return out;
  }
  function loadImage(src) { return new Promise(function (resolve) { if (!src || typeof Image === 'undefined') return resolve(null); var i = new Image(); i.onload = function () { resolve(i); }; i.onerror = function () { resolve(null); }; i.src = src; }); }
  // 输出的是实际 PNG，预览与保存始终同源；高度按动作数量变化，不能截掉训练内容。
  // 画布字号 = 网页规范字号 × 2：22/26/30/34/44/56/68，展示数字 100
  function secLabel(ctx, y, txt, muted) {
    rounded(ctx, 64, y + 4, 6, 30, 3, '#C55A32');
    text(ctx, txt, 84, y, 26, muted, 650);
  }
  async function draw(canvas, data, theme) {
    var avatar = await loadImage(data.profile.avatar), ctx = canvas.getContext('2d');
    var warm = theme === 'warm', bg = warm ? '#FFF6EE' : '#F5F6F3', ink = '#20251F', muted = '#66705F', card = '#FFFFFF', fill = warm ? '#FFE8D3' : '#E6EDDF';
    var W = 1080;
    // ---- 预量 ----
    var pf = data.profile, nameSize = fit(ctx, data.name, 700, 44, 36);
    font(ctx, 26, 400); var sigLines = pf.signature ? wrap(ctx, pf.signature, 720).slice(0, 2) : [];
    var subLine = [pf.handle, data.weight !== null ? '体重 ' + data.weight + ' kg' : ''].filter(Boolean).join('  ·  ');
    var profileH = Math.max(136, 10 + nameSize + 12 + (subLine ? 34 : 0) + sigLines.length * 36 + 8);
    font(ctx, 34, 500); var summaryLines = wrap(ctx, data.copy, 880);
    var funText = (data.funEmoji ? data.funEmoji + ' ' : '') + data.fun;
    var fs = 44, funLines;
    do { font(ctx, fs, 700); funLines = wrap(ctx, funText, 872); if (funLines.length <= 2) break; fs -= 2; } while (fs > 32);
    font(ctx, 26, 400); var basisLines = data.funBasis ? wrap(ctx, '算法：' + data.funBasis, 872).slice(0, 2) : [];
    var funH = 36 + 26 + 14 + funLines.length * (fs + 14) + (basisLines.length ? 10 + basisLines.length * 34 : 0) + 36;
    // ---- 纵向坐标 ----
    // 一、个人名片 + 训练阶段 + 日期
    var s1Top = 72, s1Div = s1Top + profileH + 30, s1Stage = s1Div + 26;
    var badges = data.badges || [], bRowTop = s1Stage + 34 + 26, bRowH = badges.length ? 60 : 0;
    var s2Top = s1Stage + 34 + (bRowH ? 26 + bRowH + 44 : 56);
    // 二、纵览：标签 + 容量卡 + 指标 + 趣味
    var vTop = s2Top + 54, mTop = vTop + 250 + 34, bodyTop = mTop + 96 + 22, fTop = mTop + 96 + 34 + (data.bodyLine ? 56 : 0);
    // 三、训练清单
    var lLbl = fTop + funH + 52, lTop = lLbl + 62;
    font(ctx, 34, 650);
    var lH = data.rows.reduce(function (a, r) { return a + Math.max(Math.min(2, wrap(ctx, r.name, 400).length) * 38 + 6 + 34, 96) + 30; }, 0);
    // 四、小结
    var smLbl = lTop + lH + 34, smTop = smLbl + 54;
    var H = smTop + summaryLines.length * 46 + 72;
    canvas.width = W; canvas.height = H; ctx.textBaseline = 'top';
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    var glow = ctx.createRadialGradient(1010, 50, 10, 880, 70, 720); glow.addColorStop(0, warm ? '#FCD7B7' : '#E0E9D9'); glow.addColorStop(1, bg);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, 700);
    // ==== 一、个人名片 · 阶段 · 日期 ====
    var AV = 132, ax = 64, ay = s1Top, cy0 = ay + Math.max(0, (profileH - AV) / 2);
    ctx.save(); ctx.beginPath(); ctx.arc(ax + AV / 2, cy0 + AV / 2, AV / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.fillStyle = warm ? '#F6DCC6' : '#DCE5D3'; ctx.fillRect(ax, cy0, AV, AV);
    if (avatar) { var side = Math.min(avatar.width, avatar.height); ctx.drawImage(avatar, (avatar.width - side) / 2, (avatar.height - side) / 2, side, side, ax, cy0, AV, AV); }
    else { font(ctx, 58, 700); ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.fillText(Array.from(data.name)[0], ax + AV / 2, cy0 + AV / 2 - 34); ctx.textAlign = 'left'; }
    ctx.restore();
    ctx.lineWidth = 4; ctx.strokeStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(ax + AV / 2, cy0 + AV / 2, AV / 2 - 2, 0, Math.PI * 2); ctx.stroke();
    var tx = ax + AV + 30, ty = ay + Math.max(0, (profileH - (nameSize + 12 + (subLine ? 34 : 0) + sigLines.length * 36)) / 2);
    text(ctx, data.name, tx, ty, nameSize, ink, 700); ty += nameSize + 12;
    if (subLine) { text(ctx, subLine, tx, ty, 26, muted, 500); ty += 34; }
    sigLines.forEach(function (l) { text(ctx, l, tx, ty, 26, ink, 400); ty += 36; });
    ctx.strokeStyle = '#DCE1D6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(64, s1Div); ctx.lineTo(1016, s1Div); ctx.stroke();
    text(ctx, data.day + ' ' + data.dayName, 64, s1Stage, 34, ink, 700);
    ctx.textAlign = 'right'; text(ctx, data.date.slice(5).replace('-', '月') + '日 · ' + data.weekText, 1016, s1Stage + 6, 26, muted, 500); ctx.textAlign = 'left';
    // 本次新获得的里程碑（最多 2 枚）：小胶囊，文字为主、每枚一个 emoji
    var bx = 64;
    badges.forEach(function (b) {
      var label = b.e + ' ' + b.title;
      font(ctx, 26, 650); var bw2 = Math.ceil(ctx.measureText(label).width) + 56;
      rounded(ctx, bx, bRowTop, bw2, bRowH, 30, warm ? '#FFDFC0' : '#DCE8D3');
      text(ctx, label, bx + 28, bRowTop + 17, 26, ink, 650);
      bx += bw2 + 16;
    });
    // ==== 二、纵览数据 + 趣味包装 ====
    secLabel(ctx, s2Top, '纵览数据', muted);
    rounded(ctx, 64, vTop, 952, 250, 36, card);
    text(ctx, data.estimated ? '估算训练容量' : '累计训练容量', 100, vTop + 32, 26, muted, 500);
    text(ctx, data.volumeText, 92, vTop + 74, 100, ink, 750);
    font(ctx, 100, 750); var numWidth = ctx.measureText(data.volumeText).width;
    text(ctx, 't', 100 + numWidth, vTop + 122, 34, muted, 550);
    text(ctx, data.volume.toLocaleString('zh-CN') + ' kg · 重量 × 次数之和', 100, vTop + 172, 26, muted, 400);
    var metrics = [[data.rows.length, '训练动作'], [data.reps, (data.estimated ? '估算' : '累计') + '次数'], [data.adds, '达到加重条件']];
    metrics.forEach(function (m, k) { var x = 70 + k * 322; text(ctx, m[0], x, mTop, 56, ink, 700); text(ctx, m[1], x, mTop + 66, 26, muted, 400); });
    if (data.bodyLine) text(ctx, data.bodyLine, 70, bodyTop, 26, muted, 500);
    // 趣味卡：标签 → emoji 行 → 一句话 → 算法
    rounded(ctx, 64, fTop, 952, funH, 36, fill);
    var fy = fTop + 36;
    text(ctx, data.funTag, 100, fy, 26, muted, 650); fy += 26 + 14;
    funLines.forEach(function (l, k) { text(ctx, l, 100, fy + k * (fs + 14), fs, ink, 700); });
    fy += funLines.length * (fs + 14) + 10;
    basisLines.forEach(function (l, k) { text(ctx, l, 100, fy + k * 34, 26, muted, 400); });
    // ==== 三、训练内容明细 ====
    secLabel(ctx, lLbl, '训练内容', muted);
    ctx.textAlign = 'right'; text(ctx, data.rows.length + ' 项动作', 1016, lLbl + 2, 26, muted, 500); ctx.textAlign = 'left';
    var y = lTop;
    var rowHs = data.rows.map(function (r) { font(ctx, 34, 650); return Math.min(2, wrap(ctx, r.name, 400).length) * 38; });
    data.rows.forEach(function (r, idx) {
      ctx.strokeStyle = '#DCE1D6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(64, y - 18); ctx.lineTo(1016, y - 18); ctx.stroke();
      text(ctx, r.tier, 64, y + 4, 26, muted, 650);
      font(ctx, 34, 650); var names = wrap(ctx, r.name, 400);
      names.slice(0, 2).forEach(function (l, k) { text(ctx, l, 148, y + k * 38, 34, ink, 650); });
      var resY = y + rowHs[idx] + 6;
      text(ctx, r.result, 148, resY, 26, muted, 400);
      font(ctx, 34, 650); ctx.textAlign = 'right';
      text(ctx, r.load, 1016, y + 2, 34, ink, 650);
      text(ctx, r.stage + ' · ' + r.reps + ' 次', 1016, y + 44, 26, muted, 400);
      ctx.textAlign = 'left';
      y += Math.max(rowHs[idx] + 6 + 34, 96) + 30;
    });
    // ==== 四、训练小结 ====
    secLabel(ctx, smLbl, '训练小结', muted);
    summaryLines.forEach(function (l, k) { text(ctx, l, 84, smTop + k * 46, 34, ink, 500); });
    return canvas;
  }
  return { PROFILE: PROFILE, profile: profile, dates: dates, sessionList: sessionList, build: build, draw: draw, chooseFun: chooseFun, funPool: funPool, THINGS: THINGS, FOODS: FOODS, badgeState: badgeState, validSessions: validSessions };
});
