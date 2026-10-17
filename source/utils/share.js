/* 训练分享：纯数据聚合 + Canvas 海报。不调用外部服务，不读取同步令牌。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine'));
  else root.GZShare = factory(root.GZ);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GZ) {
  'use strict';
  var PROFILE = { name: '', handle: '', signature: '', avatar: '', showWeight: false };
  // 公版作品节选。中文简体化、标点现代化；外文中文为本应用自译，原句另列。
  // source 为本次实际核验的原典/诗文页面，不使用网传无出处的名人语录。
  var QUOTES = [
    { id:'qian', tone:'fire', text:'天行健，君子以自强不息。', author:'《周易》', work:'乾卦·象传',
      source:'https://zh.wikisource.org/zh-hans/周易/乾', note:'古典著作节选；不署给某一位作者。', context:'取自乾卦象传，以天道运行勉励自强。不是要求无休止地训练。' },
    { id:'libai', tone:'fire', text:'长风破浪会有时，直挂云帆济沧海。', author:'李白', work:'《行路难·其一》',
      source:'https://m.gushiwen.org/shiwenv_870828ca8aaa.aspx', note:'唐诗节选', context:'前路艰难之中仍怀信心与希望。' },
    { id:'dufu', tone:'fire', text:'会当凌绝顶，一览众山小。', author:'杜甫', work:'《望岳》',
      source:'https://wenhua.youth.cn/whdj/201808/t20180822_11705212.htm', note:'唐诗节选', context:'望泰山而抒发登临之志；是一种向往，并非已经登顶。' },
    { id:'ulysses', tone:'fire', text:'去奋斗，去探寻，去发现，不屈服。', author:'阿尔弗雷德·丁尼生', work:'《尤利西斯》（Ulysses）',
      original:'To strive, to seek, to find, and not to yield.', translation:'本应用自译',
      source:'https://www.poetryfoundation.org/poems/45392/ulysses', note:'英文诗节选；中文为本应用自译', context:'诗中尤利西斯的独白结句；用于表达意志，不是作者的训练建议。' },
    { id:'qie', tone:'persist', text:'锲而不舍，金石可镂。', author:'荀子', work:'《荀子·劝学》',
      source:'https://m.gushiwen.org/shiwenv_9b5ed8061abe.aspx', note:'古文节选', context:'以雕刻金石为喻，强调学习中的持续积累。' },
    { id:'kuibu', tone:'persist', text:'不积跬步，无以至千里。', author:'荀子', work:'《荀子·劝学》',
      source:'https://m.gushiwen.org/shiwenv_9b5ed8061abe.aspx', note:'古文节选；采用通行的“至千里”文本', context:'积小步才能成远行；不把一次训练当作全部进步。' },
    { id:'numa', tone:'persist', text:'驽马十驾，功在不舍。', author:'荀子', work:'《荀子·劝学》',
      source:'https://m.gushiwen.org/shiwenv_9b5ed8061abe.aspx', note:'古文节选', context:'以驽马持续前行为喻，强调坚持而非天资。' },
    { id:'invictus', tone:'persist', text:'我是命运的主人，我是灵魂的船长。', author:'威廉·欧内斯特·亨利', work:'《不可征服》（Invictus）',
      original:'I am the master of my fate,\nI am the captain of my soul.', translation:'本应用自译',
      source:'https://www.poetryfoundation.org/poems/51642/invictus', note:'英文诗节选；中文为本应用自译', context:'诗的末两行表达主体意志；作者是亨利，不是后来引用它的人。' },
    { id:'sushi', tone:'calm', text:'莫听穿林打叶声，何妨吟啸且徐行。', author:'苏轼', work:'《定风波·莫听穿林打叶声》',
      source:'https://m.gushiwen.org/shiwenv_6b30455fdd3c.aspx', note:'宋词节选', context:'途中遇雨，仍然从容前行；保持节奏，不把一次失利看成全部。' },
    { id:'wangwei', tone:'calm', text:'行到水穷处，坐看云起时。', author:'王维', work:'《终南别业》',
      source:'https://www.chinaqw.com/zhwh/2016/01-13/76831.shtml', note:'唐诗节选', context:'游览中的随遇而安；停下来也能发现新的景致。' },
    { id:'yusu', tone:'calm', text:'欲速，则不达。', author:'孔子', work:'《论语·子路》13.17',
      source:'https://zh.wikisource.org/zh-hans/論語/子路第十三', note:'孔子答子夏；按核验文本保留逗号', context:'原为答子夏问政，告诫不可急于求成；此处仅借作心态提醒。' },
    { id:'longfellow', tone:'calm', text:'学会劳作，也学会等待。', author:'亨利·沃兹沃思·朗费罗', work:'《人生颂》（A Psalm of Life）',
      original:'Learn to labor and to wait.', translation:'本应用自译',
      source:'https://www.poetryfoundation.org/poems/44644/a-psalm-of-life', note:'英文诗结句；中文为本应用自译', context:'行动与耐心并重；不把等待和恢复看作浪费。' }
  ];
  var TONES = [{id:'fire',label:'奋进',desc:'把心气提起来'}, {id:'persist',label:'坚持',desc:'为每一步积累喝彩'}, {id:'calm',label:'从容',desc:'保持节奏，认真恢复'}];
  function quoteList(tone) { return QUOTES.filter(function(q){return q.tone===tone;}); }
  function quoteById(id) { return QUOTES.filter(function(q){return q.id===id;})[0] || null; }
  function chooseQuote(date, opts) {
    opts=opts || {}; var direct=quoteById(opts.quoteId); if(direct)return direct;
    var tone=TONES.some(function(t){return t.id===opts.tone;})?opts.tone:'fire', pool=quoteList(tone);
    var seed=Array.from(String(date)).reduce(function(n,c){return n+c.charCodeAt(0);},0);
    var v=Number(opts.variant)||0;v=Number.isFinite(v)?Math.trunc(v):0;
    return pool[((seed+v)%pool.length+pool.length)%pool.length];
  }
  function attribution(q) { return (q.author==='《周易》'?q.author+'·'+q.work:q.author+' · '+q.work) + (q.translation?' · '+q.translation:' · 节选'); }
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
    var q = chooseQuote(selected, opts), tone = q.tone;
    var p = profile(db.params.shareProfile);
    var summary = '记录了 ' + rows.length + ' 项动作、' + Math.round(reps) + ' 次训练动作。' +
      (sessions.some(function(x){return x.rec.deload;}) ? '减载也是计划的一部分。认真练习，也认真恢复。' : adds > 0 ? adds + ' 个动作达到加重条件。把进步留在记录里，把恢复留给接下来的自己。' : '加重不是每次训练的唯一答案。保持节奏，每次认真练习都算数。');

    var fun = volume > 0 ? '约等于搬动 20 kg 行李箱 ' + Math.round(volume / 20) + ' 次' : '不靠配重片，也完成了 ' + Math.round(reps) + ' 次动作';
    var note = volume > 0 ? '趣味类比 = 累计训练容量 ÷ 20 kg，不是一次举起的重量。' : '自重动作按次数记录，不虚构重量。';
    var totalDates = dates({ records: db.records.filter(function (r) { return r.date <= selected; }) }).length;
    return { date: selected, isToday: selected === GZ.today(), profile: p, name: p.name || '训练者', tone: tone,
      title: q.text, quote: q, attribution: attribution(q), copy: summary, volume: Math.round(volume * 100) / 100, volumeText: (volume / 1000).toFixed(2),
      reps: Math.round(reps), sets: sets, adds: adds, estimated: estimated, rows: rows,
      sessions: included.length,
      days: sessions.filter(function(s) { return included.indexOf(s.rec.id) >= 0; }).map(function (s) { return s.rec.day; }).filter(function (d, i, arr) { return arr.indexOf(d) === i; }).join(' / '),
      trainingDays: totalDates, weight: p.showWeight && bw !== null ? bw : null, fun: fun, funNote: note,
      caption: (p.name || '训练者') + ' · ' + selected + '\n' + '“' + q.text + '”\n——' + attribution(q) + (q.original ? '\n原文：' + q.original : '') + '\n' + rows.length + ' 项动作 / ' + (estimated ? '估算 ' : '') + Math.round(reps) + ' 次 / ' + (estimated ? '估算' : '累计') + '容量 ' + Math.round(volume) + ' kg\n' + fun + '（累计容量的趣味类比）\n' + '训练小结（本应用生成）：' + summary + '\n#GZCLP #训练打卡' };
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
    var W = 1080, q = data.quote, titleSize = 64, titleLines;
    var displayTitle = data.title.length > 14 ? data.title.replace(/，/g, '，\n') : data.title;
    do { font(ctx,titleSize,750); titleLines=wrap(ctx,displayTitle,952); if(titleLines.length<=3)break;titleSize-=4; } while(titleSize>40);
    var titleHeight=titleLines.length*(titleSize+18);
    font(ctx,24,500); var originLines=q.original?wrap(ctx,q.original,952):[];
    font(ctx,23,500); var creditLines=wrap(ctx,data.attribution,952);
    var metadataY=312+titleHeight+22+originLines.length*32+creditLines.length*32;
    var offset=metadataY-510;
    font(ctx,29,500);var summaryLines=wrap(ctx,data.copy,880);
    font(ctx,24,500);var signatureLines=data.profile.signature?wrap(ctx,data.profile.signature,952):[];
    var H = 1620 + offset + data.rows.length * 110 + Math.max(0,summaryLines.length-2)*42 + Math.max(0,signatureLines.length-1)*32;
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
    titleLines.forEach(function(l,i){text(ctx,l,64,312+i*(titleSize+18),titleSize,ink,750);});
    var creditY=312+titleHeight+4;
    originLines.forEach(function(l,i){text(ctx,l,64,creditY+i*32,24,muted,400);});
    creditY+=originLines.length*32;
    creditLines.forEach(function(l,i){text(ctx,l,64,creditY+i*32,23,muted,500);});
    text(ctx,data.days+'  ·  '+data.sessions+' 次训练',68,metadataY,24,muted,550);
    rounded(ctx,64,566+offset,952,256,38,'#FFFFFF');
    text(ctx,data.estimated ? '估算训练容量' : '累计训练容量',100,600+offset,25,muted,500);
    text(ctx,data.volumeText,92,642+offset,108,ink,750);
    font(ctx,108,750); var numWidth=ctx.measureText(data.volumeText).width;
    text(ctx,'t',106+numWidth,692+offset,35,muted,550);
    text(ctx,data.volume.toLocaleString('zh-CN')+' kg · 重量 × 次数之和',100,777+offset,22,muted,400);
    var metrics = [[data.rows.length,'训练动作'],[data.reps,(data.estimated?'估算':'累计')+'次数'],[data.adds,'达到加重条件']];
    metrics.forEach(function(m,i){var x=70+i*322;text(ctx,m[0],x,860+offset,54,ink,700);text(ctx,m[1],x,924+offset,23,muted,400);});
    rounded(ctx,64,992+offset,952,126,28,warm?'#FFE8D3':'#E6EDDF');
    text(ctx,data.fun,92,1018+offset,fit(ctx,data.fun,900,30,24),ink,650);
    text(ctx,data.funNote,92,1065+offset,20,muted,400);
    text(ctx,'今日训练清单',64,1160+offset,29,ink,650);text(ctx,'第 '+data.trainingDays+' 个训练日',784,1166+offset,22,muted,500);
    var y = 1222+offset;
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
    text(ctx,'训练小结 · 本应用生成',64,y+26,22,muted,500);
    summaryLines.forEach(function(l,i){text(ctx,l,64,y+66+i*42,29,ink,500);});
    var foot=y+88+summaryLines.length*42;
    signatureLines.forEach(function(l,i){text(ctx,l,64,foot+i*32,24,muted,500);});
    text(ctx,'GZCLP · 认真练习，也认真恢复',64,H-103,22,muted,500);
    text(ctx,'容量沿用记录口径：哑铃按单只，自重不计 kg；次数按组次估算。',64,H-62,18,muted,400);
    return canvas;
  }
  return { PROFILE: PROFILE, profile: profile, dates: dates, build: build, draw: draw, QUOTES: QUOTES, TONES: TONES, quoteList: quoteList, chooseQuote: chooseQuote, attribution: attribution };
});
