/* 训练分享：纯数据聚合 + Canvas 海报。不调用外部服务，不读取同步令牌。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine'));
  else root.GZShare = factory(root.GZ);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GZ) {
  'use strict';
  var PROFILE = { name: '', handle: '', signature: '', avatar: '', showWeight: false };
  var COPY = {
    fire: [
      ['今天的重量，\n明天的底气。', '不需要一次变得很强。把今天这一组认真做完，就已经在向前。'],
      ['把努力，\n练成看得见的数字。', '每一次规范动作，都在为下一次的自己积攒底气。'],
      ['又一次，\n说到做到。', '训练记录会记住：今天，我没有只停留在想法里。']
    ],
    calm: [
      ['进步不喧哗，\n但它有重量。', '有些变化暂时看不出来，但每一次认真练习，都算数。'],
      ['慢慢变强，\n也很了不起。', '不急着证明什么。完成今天的训练，让身体在练习和恢复中成长。'],
      ['今天的自己，\n值得一个肯定。', '加重是进步，巩固也是。认真练完，安心休息。']
    ],
    fun: [
      ['今日份的重，\n我先举为敬。', '今天搬的是重量，攒的是下一次出场的底气。练完，收工。'],
      ['举铁营业，\n今日已打烊。', '重量留在训练记录里，好心情带走。恢复也是训练的一部分。'],
      ['不是突然变强，\n是又练了一次。', '今日任务已交卷。主打一个：把计划变成了已完成。']
    ]
  };
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
  function build(db, date, opts) {
    opts = opts || {};
    var list = dates(db), selected = date || (list.indexOf(GZ.today()) >= 0 ? GZ.today() : list[0]);
    var sessions = GZ.replay(db).sessions.filter(function (s) { return s.rec.date === selected; });
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
    var tone = COPY[opts.tone] ? opts.tone : 'fire', variant = Math.abs(Number(opts.variant) || 0) % COPY[tone].length;
    var p = profile(db.params.shareProfile), c = COPY[tone][variant];
    var fun = volume > 0 ? '约等于搬动 20 kg 行李箱 ' + Math.round(volume / 20) + ' 次' : '不靠配重片，也完成了 ' + Math.round(reps) + ' 次动作';
    var note = volume > 0 ? '趣味类比 = 累计训练容量 ÷ 20 kg，不是一次举起的重量。' : '自重动作按次数记录，不虚构重量。';
    var totalDates = dates({ records: db.records.filter(function (r) { return r.date <= selected; }) }).length;
    return { date: selected, isToday: selected === GZ.today(), profile: p, name: p.name || '训练者', tone: tone,
      title: c[0], copy: c[1], volume: Math.round(volume * 100) / 100, volumeText: (volume / 1000).toFixed(2),
      reps: Math.round(reps), sets: sets, adds: adds, estimated: estimated, rows: rows,
      sessions: included.length,
      days: sessions.filter(function(s) { return included.indexOf(s.rec.id) >= 0; }).map(function (s) { return s.rec.day; }).filter(function (d, i, arr) { return arr.indexOf(d) === i; }).join(' / '),
      trainingDays: totalDates, weight: p.showWeight && bw !== null ? bw : null, fun: fun, funNote: note,
      caption: (p.name || '训练者') + ' · ' + selected + '\n' + c[0].replace(/\n/g, '') + '\n' + rows.length + ' 项动作 / ' + (estimated ? '估算 ' : '') + Math.round(reps) + ' 次 / ' + (estimated ? '估算' : '累计') + '容量 ' + Math.round(volume) + ' kg\n' + fun + '（累计容量的趣味类比）\n' + c[1] + '\n#GZCLP #训练打卡' };
  }

  function font(ctx, size, weight) { ctx.font = (weight || 400) + ' ' + size + 'px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'; }
  function rounded(ctx, x, y, w, h, r, fill) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  function text(ctx, value, x, y, size, color, weight) { font(ctx, size, weight); ctx.fillStyle = color; ctx.fillText(String(value), x, y); }
  function fit(ctx, value, width, size, min) { for (var n = size; n > min; n -= 2) { font(ctx,n,600); if (ctx.measureText(value).width <= width) return n; } return min; }
  function wrap(ctx, str, width) {
    var out = [], line = '';
    Array.from(str).forEach(function (c) { if (c === '\n') { out.push(line); line = ''; } else if (ctx.measureText(line+c).width > width && line) { out.push(line); line = c; } else line += c; });
    if (line) out.push(line); return out;
  }
  function loadImage(src) { return new Promise(function (resolve) { if (!src || typeof Image === 'undefined') return resolve(null); var i = new Image(); i.onload = function () { resolve(i); }; i.onerror = function () { resolve(null); }; i.src = src; }); }
  // 输出的是实际 PNG，预览与保存始终同源；高度按动作数量变化，不能截掉训练内容。
  async function draw(canvas, data, theme) {
    var avatar = await loadImage(data.profile.avatar), ctx = canvas.getContext('2d');
    var warm = theme === 'warm', bg = warm ? '#FFF6EE' : '#F5F6F3', ink = '#20251F', muted = '#66705F', accent = '#C55A32';
    var W = 1080, H = 1640 + data.rows.length * 110;
    canvas.width = W; canvas.height = H; ctx.textBaseline = 'top';
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);
    var glow = ctx.createRadialGradient(1010,50,10,880,70,720); glow.addColorStop(0,warm?'#FCD7B7':'#E0E9D9'); glow.addColorStop(1,bg);
    ctx.fillStyle = glow; ctx.fillRect(0,0,W,700);
    rounded(ctx,64,64,230,52,26,'#FFFFFF'); text(ctx,'GZCLP  /  TRAINING',82,80,22,muted,650);
    text(ctx,data.date.replace(/-/g,'.'),790,80,24,muted,500);
    ctx.save(); ctx.beginPath(); ctx.arc(112,210,48,0,Math.PI*2); ctx.clip(); ctx.fillStyle='#E0E6DA';ctx.fillRect(64,162,96,96);
    if (avatar) { var side=Math.min(avatar.width,avatar.height);ctx.drawImage(avatar,(avatar.width-side)/2,(avatar.height-side)/2,side,side,64,162,96,96); }
    else text(ctx,Array.from(data.name)[0],88,183,40,ink,650);
    ctx.restore(); text(ctx,data.name,184,174,fit(ctx,data.name,580,34,26),ink,650);
    text(ctx,data.profile.handle || '把计划，练成了已完成。',184,222,23,muted,400);
    if (data.weight !== null) text(ctx,'体重 '+data.weight+' kg',816,222,22,muted,400);
    font(ctx,64,750); var titleLines=wrap(ctx,data.title,952);
    titleLines.forEach(function(l,i){text(ctx,l,64,312+i*82,64,ink,750);});
    text(ctx,data.days+'  ·  '+data.sessions+' 次训练',68,510,24,muted,550);
    rounded(ctx,64,566,952,256,38,'#FFFFFF');
    text(ctx,data.estimated ? '估算训练容量' : '累计训练容量',100,600,25,muted,500);
    text(ctx,data.volumeText,92,642,108,ink,750);
    font(ctx,108,750); var numWidth=ctx.measureText(data.volumeText).width;
    text(ctx,'t',106+numWidth,692,35,muted,550);
    text(ctx,data.volume.toLocaleString('zh-CN')+' kg · 重量 × 次数之和',100,777,22,muted,400);
    var metrics = [[data.rows.length,'训练动作'],[data.reps,(data.estimated?'估算':'累计')+'次数'],[data.adds,'达到加重条件']];
    metrics.forEach(function(m,i){var x=70+i*322;text(ctx,m[0],x,860,54,ink,700);text(ctx,m[1],x,924,23,muted,400);});
    rounded(ctx,64,992,952,126,28,warm?'#FFE8D3':'#E6EDDF');
    text(ctx,data.fun,92,1018,fit(ctx,data.fun,900,30,24),ink,650);
    text(ctx,data.funNote,92,1065,20,muted,400);
    text(ctx,'今日训练清单',64,1160,29,ink,650);text(ctx,'第 '+data.trainingDays+' 个训练日',784,1166,22,muted,500);
    var y = 1222;
    data.rows.forEach(function(r,i){
      ctx.strokeStyle='#DCE1D6';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(64,y-14);ctx.lineTo(1016,y-14);ctx.stroke();
      text(ctx,r.tier,64,y+2,23,muted,650);
      var rowName=r.name; font(ctx,30,650); var names=wrap(ctx,rowName,390);
      names.slice(0,2).forEach(function(l,j){text(ctx,l,144,y+j*33,30,ink,650);});
      text(ctx,r.day+' · '+r.result,144,y+72,21,muted,400);
      font(ctx,27,650);ctx.textAlign='right';text(ctx,r.load,1016,y+2,27,ink,650);text(ctx,r.stage+' · '+r.reps+' 次',1016,y+44,22,muted,400);ctx.textAlign='left';
      y += 110;
    });
    y += 26;ctx.strokeStyle='#DCE1D6';ctx.beginPath();ctx.moveTo(64,y);ctx.lineTo(1016,y);ctx.stroke();
    text(ctx,'“',64,y+22,64,accent,700);font(ctx,29,500);var lines=wrap(ctx,data.copy,860);
    lines.forEach(function(l,i){text(ctx,l,114,y+36+i*42,29,ink,500);});
    var foot=y+144;
    if (data.profile.signature) text(ctx,data.profile.signature,64,foot,fit(ctx,data.profile.signature,952,24,20),muted,500);
    text(ctx,'GZCLP · 认真练习，也认真恢复',64,H-103,22,muted,500);
    text(ctx,'容量沿用记录口径：哑铃按单只，自重不计 kg；次数按组次估算。',64,H-62,18,muted,400);
    return canvas;
  }
  return { PROFILE: PROFILE, profile: profile, dates: dates, build: build, draw: draw, COPY: COPY };
});
