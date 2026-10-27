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
    var g = p.gender;
    if (g !== 'male' && g !== 'female' && g !== 'undisclosed') g = '';
    return { name: clean(p.name, 18), handle: clean(p.handle, 24), signature: clean(p.signature, 48),
      avatar: /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.avatar || '') && p.avatar.length < 180000 ? p.avatar : '',
      gender: g, showWeight: p.showWeight === true };
  }
  function hasEntry(e, deload) { return !!e && !e.skip && (!!deload || (e.v !== null && e.v !== undefined && e.v !== '')); }
  function cnDate(date) {
    if (!date || String(date).length < 10) return '';
    return (+String(date).slice(5, 7)) + '月' + (+String(date).slice(8, 10)) + '日';
  }
  function trimNum(n) {
    var x = Math.round(Number(n) * 100) / 100;
    if (!isFinite(x)) return '0';
    return (Math.abs(x - Math.round(x)) < 0.001) ? String(Math.round(x)) : String(x);
  }
  /** 海报上的推进徽章：加重写出公斤差，保持与降阶用原判定名 */
  function progMark(judgment, delta) {
    if (!judgment || judgment === '跳过') return '';
    if (judgment === '减载' || judgment === '减载完成') return '减载';
    if (judgment === '加重') return delta > 0 ? '↑ +' + trimNum(delta) + 'kg' : '加重';
    if (judgment === '保持') return '保持';
    if (judgment === '减轻') return delta < 0 ? '↓ ' + trimNum(delta) + 'kg' : '减轻';
    return judgment;
  }
  function volHero(kg) {
    kg = Number(kg) || 0;
    if (kg >= 1000) return { v: (kg / 1000).toFixed(2), u: 't' };
    return { v: trimNum(Math.round(kg)), u: 'kg' };
  }
  /** 对不上时说明原因：同一天已被另一次训练占用，或快照里根本没有这一天 */
  function watchGap(watch, date, matched) {
    if (matched || !watch || !(watch.workouts || []).length) return '';
    var same = (watch.workouts || []).some(function (w) { return w.date === date; });
    if (same) return '这次训练在手表里没有对应的力量训练记录。这一天的手表记录已经对应到另一次训练。';
    var edge = Badges.watchLatest(watch);
    var latest = edge ? cnDate(edge.date) : '';
    var mine = cnDate(date);
    if (latest && mine && latest !== mine) return '这次训练在手表里没有对应的力量训练记录。这次是 ' + mine + '，快照里最近一次是 ' + latest + '。';
    return '这次训练在手表里没有对应的力量训练记录';
  }
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
    return Badges.compute(facts.map(function (f) { return Object.assign({}, f); }), { params: db.params, today: GZ.today(), watch: db.params && db.params.watch });
  }
  /**
   * 终身口径的有效训练：所有计划（进行中、暂停、已结束）各自回放后合并，按日期先后重新编号。
   * 里程碑、手表对应都用它；「本计划累计 / 上次同训练日」仍只看当前计划。
   */
  function allFacts(db) {
    var out = [];
    (GZ.replayAll ? GZ.replayAll(db) : [{ program: { id: '' }, rp: GZ.replay(db) }]).forEach(function (x) {
      validSessions(x.rp).forEach(function (f) { f.programId = x.program.id; f.createdAt = 0; out.push(f); });
    });
    var ca = {}; (db.records || []).forEach(function (r) { ca[r.id] = r.createdAt || 0; });
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (ca[a.id] || 0) - (ca[b.id] || 0); });
    out.forEach(function (f, i) { f.order = i; delete f.createdAt; });
    return out;
  }
  /** 徽章墙与卡片用的完整状态（终身、跨计划） */
  function badgeState(db) { return badgeStateFrom(db, allFacts(db)); }
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
        else if (it.tier === 'T2') {
          nreps = it.actualReps;
          if (e.v !== '完成' && it.actualReps == null) nreps = 0;
        }
        else nreps = (nsets - 1) * it.reps + Number(it.input || 0);
        nreps = Math.max(0, Number(nreps) || 0);
        var equip = GZ.equipOf(it.name, it.equip), w = it.deload ? it.dWeight : it.weight;
        var load = equip === '自重' ? '自重' : GZ.fmtW(w) + ' ' + GZ.unitOf(equip);
        var result = it.deload ? '减载完成' : it.tier === 'T2' ? (e.v === '完成' ? '完成' : (it.actualReps == null ? '未完成 · 未记次数' : '实际 ' + it.actualReps + ' 次')) : '末组 ' + it.input + ' 次';
        if (it.judgment === '加重') adds++;
        var recordedVolume = Number(it.volume) || 0;
        volume += recordedVolume; reps += nreps; sets += nsets;
        var delta = 0;
        if (!it.deload && it.nextWeight != null && w !== '' && w != null && !isNaN(Number(it.nextWeight)) && !isNaN(Number(w))) {
          delta = Math.round((Number(it.nextWeight) - Number(w)) * 100) / 100;
        }
        rows.push({ day: s.rec.day, tier: it.tier, badge: it.badge || it.tier, name: it.name, load: load, stage: it.stage, result: result,
          reps: nreps, sets: nsets, judgment: it.judgment, volume: recordedVolume, delta: delta, mark: progMark(it.judgment, delta),
          work: load + (it.stage ? ' × ' + it.stage : '') });
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
    var life = allFacts(db), meLife = life.filter(function (f) { return f.id === pick.id; })[0] || me;
    var watch = db.params && db.params.watch;
    var wk = Badges.watchFor(watch, life, meLife);
    var watchNote = watchGap(watch, selected, !!wk);
    var state = badgeStateFrom(db, life), cands = state.bySession[pick.id] || [];
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
      badgeEarned: state.earnedCount, badgeAll: state.total, watchBody: wk ? { min: wk.min, sets: wk.sets, avgHr: wk.avgHr, kcal: wk.kcal } : null, watchNote: watchNote, bodyLine: bodyLine,
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
  // 日 / 周 / 月海报共用 Apple Health 圆角卡片。输出 PNG 与预览同源，高度随内容增长。
  function secLabel(ctx, y, txt, muted) {
    rounded(ctx, 64, y + 4, 6, 30, 3, '#C55A32');
    text(ctx, txt, 84, y, 26, muted, 650);
  }
  function ellipsis(ctx, str, width) {
    str = String(str || '');
    if (ctx.measureText(str).width <= width) return str;
    var s = str;
    while (s && ctx.measureText(s + '…').width > width) s = Array.from(s).slice(0, -1).join('');
    return (s || '') + '…';
  }
  function roundPath(ctx, x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  function fillRound(ctx, x, y, w, h, r, color) {
    roundPath(ctx, x, y, w, h, r);
    ctx.fillStyle = color;
    ctx.fill();
  }
  function palette(theme) {
    var warm = theme === 'warm';
    return {
      warm: warm,
      bg: warm ? '#F5EFE8' : '#EEF2EE',
      ink: '#1C1C1E',
      muted: warm ? '#6A5344' : '#3E5344',
      faint: warm ? '#A89280' : '#7E8E80',
      card: '#FFFFFF',
      line: warm ? 'rgba(90,60,30,0.10)' : 'rgba(30,50,35,0.10)',
      shadow: warm ? 'rgba(80,40,10,0.12)' : 'rgba(20,40,24,0.12)',
      accent: warm ? '#C45C28' : '#2E6B45',
      chip: warm ? '#F4E0D0' : '#E3EFE4',
      chipInk: warm ? '#8A3E16' : '#1E5A34',
      soft: warm ? '#FBF6F1' : '#F3F6F3',
      down: '#8A5A32',
      tier: { T1: warm ? '#C45C28' : '#E65A00', T2: '#2E6B45', T3: '#5C6B8A', C: '#5C6B8A' }
    };
  }
  var PW = 1080, PX = 56, PGAP = 20, PIN = 1080 - 112, PR = 28;
  function bentoCard(ctx, pal, x, y, w, h, r) {
    ctx.save();
    ctx.shadowColor = pal.shadow;
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    ctx.shadowOffsetX = 0;
    roundPath(ctx, x, y, w, h, r || PR);
    ctx.fillStyle = pal.card;
    ctx.fill();
    ctx.restore();
    roundPath(ctx, x, y, w, h, r || PR);
    ctx.lineWidth = 2;
    ctx.strokeStyle = pal.line;
    ctx.stroke();
  }
  function cardHead(ctx, pal, x, y, w, icon, title, trail) {
    font(ctx, 28, 650);
    text(ctx, ellipsis(ctx, (icon ? icon + '  ' : '') + title, trail ? w - 180 : w), x, y, 28, pal.muted, 650);
    if (trail) {
      ctx.textAlign = 'right';
      text(ctx, trail, x + w, y + 2, 24, pal.faint, 600);
      ctx.textAlign = 'left';
    }
    return 48;
  }
  function heroNum(ctx, pal, x, y, value, unit) {
    var size = 84;
    font(ctx, size, 700);
    while (size > 52 && ctx.measureText(String(value)).width > 300) { size -= 4; font(ctx, size, 700); }
    text(ctx, value, x, y, size, pal.ink, 700);
    var nw = ctx.measureText(String(value)).width;
    text(ctx, unit || '', x + nw + 12, y + Math.round(size * 0.46), 30, pal.muted, 600);
    return size + 16;
  }
  function chip(ctx, pal, x, y, label, tone) {
    if (!label) return { w: 0, h: 0 };
    font(ctx, 26, 650);
    var tw = ctx.measureText(String(label)).width, w = Math.ceil(tw) + 36, h = 46;
    fillRound(ctx, x, y, w, h, 23, tone === 'down' ? '#F3E6DC' : pal.chip);
    text(ctx, label, x + 18, y + 10, 26, tone === 'down' ? pal.down : pal.chipInk, 650);
    return { w: w, h: h };
  }
  function paintMini(ctx, pal, x, y, w, h, spec) {
    bentoCard(ctx, pal, x, y, w, h, PR);
    var ix = x + 32, iy = y + 28, iw = w - 64;
    cardHead(ctx, pal, ix, iy, iw, spec.icon, spec.title, spec.trail || '');
    iy += 58;
    heroNum(ctx, pal, ix, iy, spec.value, spec.unit || '');
    iy += 108;
    if (spec.chip) chip(ctx, pal, ix, iy, spec.chip, spec.tone || 'up');
    if (spec.paint) spec.paint(ctx, pal, ix, iy + (spec.chip ? 62 : 8), iw);
  }
  function paintSection(ctx, pal, y, spec) {
    var inner = spec.inner || 0;
    var h = 28 + 56 + inner + 28;
    bentoCard(ctx, pal, PX, y, PIN, h, PR);
    cardHead(ctx, pal, PX + 32, y + 28, PIN - 64, spec.icon, spec.title, spec.trail || '');
    if (spec.paint) spec.paint(ctx, pal, PX + 32, y + 28 + 52, PIN - 64);
    return y + h;
  }
  function paintIdentity(ctx, pal, y, avatar, spec) {
    var AV = 112, ax = PX;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + AV / 2, y + AV / 2, AV / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = pal.chip;
    ctx.fillRect(ax, y, AV, AV);
    if (avatar) {
      var side = Math.min(avatar.width, avatar.height);
      ctx.drawImage(avatar, (avatar.width - side) / 2, (avatar.height - side) / 2, side, side, ax, y, AV, AV);
    } else {
      font(ctx, 52, 700);
      ctx.fillStyle = pal.ink;
      ctx.textAlign = 'center';
      ctx.fillText(Array.from(spec.name || '我')[0] || '我', ax + AV / 2, y + AV / 2 - 30);
      ctx.textAlign = 'left';
    }
    ctx.restore();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(ax + AV / 2, y + AV / 2, AV / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    var tx = ax + AV + 28;
    font(ctx, 44, 700);
    text(ctx, ellipsis(ctx, spec.name, PIN - AV - 40), tx, y + 10, 44, pal.ink, 700);
    if (spec.sub) text(ctx, ellipsis(ctx, spec.sub, PIN - AV - 40), tx, y + 64, 26, pal.muted, 500);
    y += AV + 32;
    font(ctx, 46, 750);
    var titleW = spec.tag ? PIN - 280 : PIN;
    text(ctx, ellipsis(ctx, spec.title, titleW), PX, y, 46, pal.ink, 750);
    if (spec.tag) {
      font(ctx, 26, 650);
      var tw = Math.ceil(ctx.measureText(spec.tag).width) + 36;
      fillRound(ctx, PW - PX - tw, y + 6, tw, 44, 22, pal.card);
      ctx.lineWidth = 2; ctx.strokeStyle = pal.line; roundPath(ctx, PW - PX - tw, y + 6, tw, 44, 22); ctx.stroke();
      text(ctx, spec.tag, PW - PX - tw + 18, y + 16, 26, pal.muted, 650);
    }
    return y + 46 + 28;
  }
  function paintBackdrop(ctx, pal, height) {
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, PW, height || 6400);
  }
  function tierColor(pal, tier) { return pal.tier[tier] || pal.accent; }
  function paintFun(ctx, pal, y, spec) {
    var width = PIN - 64;
    var raw = (spec.emoji ? spec.emoji + '  ' : '') + (spec.text || '');
    var fs = 42, lines;
    do { font(ctx, fs, 700); lines = wrap(ctx, raw, width); if (lines.length <= 3) break; fs -= 2; } while (fs > 30);
    font(ctx, 24, 400);
    var basis = spec.basis ? wrap(ctx, spec.basis, width).slice(0, 2) : [];
    var inner = 8 + lines.length * (fs + 14) + (basis.length ? 10 + basis.length * 34 : 0);
    return paintSection(ctx, pal, y, {
      icon: spec.icon || '⚡', title: spec.title, trail: spec.trail || '', inner: inner,
      paint: function (c, p, x, yy) {
        lines.forEach(function (l, i) { text(c, l, x, yy + i * (fs + 14), fs, p.ink, 700); });
        var by = yy + lines.length * (fs + 14) + 10;
        basis.forEach(function (l, i) { text(c, l, x, by + i * 34, 24, p.muted, 400); });
      }
    });
  }
  function paintBadges(ctx, pal, y, spec) {
    var items = (spec.items || []).slice(0, spec.limit || 8);
    if (!items.length) return y;
    var max = PIN - 64, rowH = 64, gap = 14;
    font(ctx, 26, 650);
    var rows = 1, cx = 0;
    var placed = items.map(function (b) {
      var label = (b.e ? b.e + ' ' : '') + b.title;
      var bw = Math.ceil(ctx.measureText(label).width) + 48;
      if (cx > 0 && cx + bw > max) { cx = 0; rows += 1; }
      var slot = { label: label, x: cx, row: rows - 1, w: Math.min(bw, max) };
      cx += slot.w + gap;
      return slot;
    });
    var inner = rows * rowH + (rows - 1) * 12;
    return paintSection(ctx, pal, y, {
      icon: '🏅', title: spec.title, trail: spec.trail || '', inner: inner,
      paint: function (c, p, x, yy) {
        placed.forEach(function (slot) {
          var py = yy + slot.row * (rowH + 12);
          fillRound(c, x + slot.x, py, slot.w, rowH, 32, p.chip);
          font(c, 26, 650);
          text(c, ellipsis(c, slot.label, slot.w - 36), x + slot.x + 22, py + 18, 26, p.ink, 650);
        });
      }
    });
  }
  function openPoster(canvas, theme) {
    var ctx = canvas.getContext('2d');
    var pal = palette(theme);
    canvas.width = PW;
    canvas.height = 6400;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    paintBackdrop(ctx, pal, 6400);
    return { ctx: ctx, pal: pal };
  }
  function closePoster(canvas, ctx, pal, height) {
    canvas.width = PW;
    canvas.height = Math.max(480, Math.ceil(height));
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    paintBackdrop(ctx, pal, canvas.height);
    return canvas.height;
  }
  var Poster = {
    PW: PW, PX: PX, PGAP: PGAP, PIN: PIN, PR: PR,
    palette: palette, bentoCard: bentoCard, cardHead: cardHead, heroNum: heroNum, chip: chip,
    paintMini: paintMini, paintSection: paintSection, paintIdentity: paintIdentity, paintFun: paintFun,
    paintBadges: paintBadges, openPoster: openPoster, closePoster: closePoster, fillRound: fillRound,
    ellipsis: ellipsis, tierColor: tierColor, volHero: volHero, progMark: progMark, trimNum: trimNum, cnDate: cnDate,
    roundPath: roundPath
  };

  async function draw(canvas, data, theme) {
    var avatar = await loadImage(data.profile && data.profile.avatar);
    function pass(finalH) {
      var ctx, pal;
      if (!finalH) {
        var opened = openPoster(canvas, theme);
        ctx = opened.ctx; pal = opened.pal;
      } else {
        ctx = canvas.getContext('2d');
        pal = palette(theme);
        closePoster(canvas, ctx, pal, finalH);
      }
      var pf = data.profile || {};
      var sub = [pf.handle, data.weight != null ? '体重 ' + data.weight + ' kg' : '', !pf.handle && pf.signature ? pf.signature : ''].filter(Boolean).join(' · ');
      var y = 48;
      y = paintIdentity(ctx, pal, y, avatar, {
        name: data.name, sub: sub,
        title: data.day + ' · ' + data.dayName,
        tag: cnDate(data.date)
      });
      var colW = (PIN - PGAP) / 2, colH = 318;
      var hero = volHero(data.volume);
      var useWatch = !!(data.bodyLine && data.watchBody && data.watchBody.kcal);
      var right = useWatch
        ? { icon: '🎯', title: '训练推进', value: trimNum(data.watchBody.kcal), unit: 'kcal', chip: (data.watchBody.min || 0) + ' 分钟', tone: 'up' }
        : { icon: '🎯', title: '训练推进', value: String(data.rows.length), unit: '项', chip: data.adds ? '下次加重 ' + data.adds + ' 项' : '完成 ' + data.rows.length + ' 项', tone: 'up' };
      paintMini(ctx, pal, PX, y, colW, colH, { icon: '🔥', title: '本次容量', value: hero.v, unit: hero.u, chip: '有效 ' + (data.sets || 0) + ' 组', tone: 'up' });
      paintMini(ctx, pal, PX + colW + PGAP, y, colW, colH, right);
      y += colH + PGAP;
      var rowH = 100, rowGap = 14;
      var inner = data.rows.length ? data.rows.length * rowH + Math.max(0, data.rows.length - 1) * rowGap : 40;
      y = paintSection(ctx, pal, y, {
        icon: '🏋️', title: '动作明细', trail: data.rows.length + ' 项', inner: inner,
        paint: function (c, p, x, yy, w) {
          data.rows.forEach(function (r, i) {
            var ry = yy + i * (rowH + rowGap);
            fillRound(c, x, ry, w, rowH, 22, p.soft);
            var mark = r.badge || r.tier || '';
            font(c, 22, 700);
            var mw = Math.max(44, Math.ceil(c.measureText(mark).width) + 20);
            fillRound(c, x + 16, ry + 30, mw, 40, 12, tierColor(p, r.tier));
            c.textAlign = 'center'; c.fillStyle = '#FFFFFF';
            c.fillText(mark, x + 16 + mw / 2, ry + 40);
            c.textAlign = 'left';
            var nameX = x + 16 + mw + 16;
            font(c, 32, 650);
            text(c, ellipsis(c, r.name, w * 0.42), nameX, ry + 16, 32, p.ink, 650);
            text(c, ellipsis(c, r.stage || r.result || '', w * 0.42), nameX, ry + 56, 24, p.muted, 500);
            c.textAlign = 'right';
            font(c, 28, 700);
            text(c, ellipsis(c, r.work || r.load, w * 0.38), x + w - 18, ry + 16, 28, p.ink, 700);
            if (r.mark) {
              font(c, 24, 650);
              var bw = Math.ceil(c.measureText(r.mark).width) + 28;
              var up = r.judgment === '加重';
              fillRound(c, x + w - 18 - bw, ry + 54, bw, 36, 18, up ? p.chip : '#FFFFFF');
              text(c, r.mark, x + w - 32, ry + 62, 24, up ? p.chipInk : p.muted, 650);
            }
            c.textAlign = 'left';
          });
        }
      });
      y += PGAP;
      y = paintFun(ctx, pal, y, { icon: '⚡', title: '趣味能量换算', emoji: data.funEmoji, text: data.fun, basis: data.funBasis, trail: data.funTag || '' });
      if (data.badges && data.badges.length) {
        y += PGAP;
        y = paintBadges(ctx, pal, y, { title: '达成里程碑', items: data.badges, trail: '1 枚' });
      }
      if (data.bodyLine && !useWatch) {
        y += PGAP;
        font(ctx, 30, 600);
        var bl = wrap(ctx, data.bodyLine, PIN - 64);
        y = paintSection(ctx, pal, y, {
          icon: '⌚', title: '手表记录', inner: Math.max(40, bl.length * 42),
          paint: function (c, p, x, yy) { bl.forEach(function (l, i) { text(c, l, x, yy + i * 42, 30, p.ink, 600); }); }
        });
      }
      return y + 64;
    }
    pass(pass(0));
    return canvas;
  }
  return { PROFILE: PROFILE, profile: profile, dates: dates, sessionList: sessionList, build: build, draw: draw, chooseFun: chooseFun, funPool: funPool, THINGS: THINGS, FOODS: FOODS, badgeState: badgeState, validSessions: validSessions, allFacts: allFacts, sessionVolume: sessionVolume, progMark: progMark, volHero: volHero,
    H: { font: font, rounded: rounded, text: text, fit: fit, wrap: wrap, loadImage: loadImage, secLabel: secLabel, compare: compare, num: num, hashSeed: hashSeed, shuffled: shuffled, hasEntry: hasEntry, FOODS: FOODS, Poster: Poster, volHero: volHero, progMark: progMark, cnDate: cnDate, trimNum: trimNum } };
});
