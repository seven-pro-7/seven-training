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
  ].concat([
  {
    "id": "hanyu",
    "tone": "fire",
    "text": "业精于勤，荒于嬉；行成于思，毁于随。",
    "author": "韩愈",
    "work": "《进学解》",
    "source": "https://www.guwendao.net/shiwenv_94a69d56db65.aspx",
    "note": "古文节选",
    "context": "假托国子先生训示学生，谈勤学与修身；借作认真练习的自勉。"
  },
  {
    "id": "liuyuxi",
    "tone": "persist",
    "text": "千淘万漉虽辛苦，吹尽狂沙始到金。",
    "author": "刘禹锡",
    "work": "《浪淘沙词九首·其八》",
    "source": "https://wyb.chinawriter.com.cn/content/202301/13/content68367.html",
    "note": "唐诗节选",
    "context": "以淘沙取金寄寓磨炼与信念，不意味着过量训练必然更有效。"
  },
  {
    "id": "luyou-village",
    "tone": "calm",
    "text": "山重水复疑无路，柳暗花明又一村。",
    "author": "陆游",
    "work": "《游山西村》",
    "source": "https://nx.people.com.cn/n2/2021/0218/c192483-34581195.html",
    "note": "宋诗节选",
    "context": "山村游记中的景物转折；借作瓶颈期的耐心与希望。"
  },
  {
    "id": "luyou-practice",
    "tone": "fire",
    "text": "纸上得来终觉浅，绝知此事要躬行。",
    "author": "陆游",
    "work": "《冬夜读书示子聿》",
    "source": "https://culture.people.com.cn/n1/2018/0903/c1013-30269386.html",
    "note": "宋诗节选",
    "context": "教子诗强调实践；将所学付诸行动，而不是只看计划。"
  },
  {
    "id": "wangzhihuan",
    "tone": "fire",
    "text": "欲穷千里目，更上一层楼。",
    "author": "王之涣",
    "work": "《登鹳雀楼》",
    "source": "https://www.shicile.com/detail/710075560527",
    "note": "唐诗节选",
    "context": "登楼望远、由景入理，借作循序进阶的自勉。"
  },
  {
    "id": "wanganshi",
    "tone": "calm",
    "text": "不畏浮云遮望眼，自缘身在最高层。",
    "author": "王安石",
    "work": "《登飞来峰》",
    "source": "https://baike.baidu.com/item/登飞来峰/2581767",
    "note": "宋诗节选；采用“自缘”文本，另有“只缘”异文",
    "context": "借用登高后视野开阔的意象，提醒不为一时波动所困。"
  },
  {
    "id": "taoyuanming",
    "tone": "fire",
    "text": "及时当勉励，岁月不待人。",
    "author": "陶渊明",
    "work": "《杂诗十二首·其一》",
    "source": "https://www.guwendao.net/shiwenv_404930bd804c.aspx",
    "note": "晋诗节选",
    "context": "原诗感叹人生短暂，兼写邻里欢聚；此处借作珍惜今天。"
  },
  {
    "id": "caocao",
    "tone": "fire",
    "text": "老骥伏枥，志在千里。",
    "author": "曹操",
    "work": "《龟虽寿》",
    "source": "https://www.cnr.cn/jy/eduzt/ywkwsfsd/jdld/bnjsc/20181214/t20181214_524450350.html",
    "note": "乐府诗节选",
    "context": "以老骥自喻年长而志不衰；借作任何阶段都可重新出发。"
  },
  {
    "id": "zhengxie",
    "tone": "persist",
    "text": "千磨万击还坚劲，任尔东西南北风。",
    "author": "郑燮",
    "work": "《竹石》",
    "source": "https://www.gushiwen.cn/shiwenv.aspx?id=e5c9337524b7",
    "note": "清诗节选；采用“坚劲”文本",
    "context": "借岩竹咏坚韧；风雨是文学比喻，不鼓励忍痛训练。"
  },
  {
    "id": "laozi-step",
    "tone": "persist",
    "text": "千里之行，始于足下。",
    "author": "老子",
    "work": "《道德经》第六十四章",
    "source": "https://www.daodejing.org/64.html",
    "note": "古典著作节选",
    "context": "与合抱之木、九层之台并举，论积小成大。"
  },
  {
    "id": "laozi-finish",
    "tone": "persist",
    "text": "慎终如始，则无败事。",
    "author": "老子",
    "work": "《道德经》第六十四章",
    "source": "https://www.daodejing.org/64.html",
    "note": "古典著作节选",
    "context": "警惕临近完成时松懈；借作计划收尾时仍认真对待。"
  },
  {
    "id": "laozi-self",
    "tone": "persist",
    "text": "胜人者有力，自胜者强。",
    "author": "老子",
    "work": "《道德经》第三十三章",
    "source": "https://m.daodejing.org/33.htm",
    "note": "古典著作节选",
    "context": "关于修养与自知；借作与自己比较，而不是与他人攀比。"
  },
  {
    "id": "emerson-trust",
    "tone": "fire",
    "text": "相信自己：每颗心都会随着那根坚韧的弦共鸣。",
    "author": "拉尔夫·沃尔多·爱默生",
    "work": "《自立》（Self-Reliance）",
    "original": "Trust thyself: every heart vibrates to that iron string.",
    "translation": "本应用自译",
    "source": "https://www1.assumption.edu/ahc/Self-Reliance.html",
    "note": "1841年英文原作节选",
    "context": "强调自信与独立判断，不意味着忽视专业建议。"
  },
  {
    "id": "seneca-today",
    "tone": "fire",
    "text": "把握今天该做的事，就不必把那么多希望寄托在明天。",
    "author": "塞涅卡",
    "work": "《致卢基里乌斯书信》第1信",
    "original": "Lay hold of to-day’s task, and you will not need to depend so much upon to-morrow’s.",
    "translation": "本应用自译",
    "source": "https://latinitium.com/how-not-to-waste-time-according-to-seneca",
    "note": "据Richard M. Gummere 1917年英译本自译，非拉丁原文",
    "context": "珍惜当下，不是要求取消休息或补做过量训练。"
  },
  {
    "id": "marcus-action",
    "tone": "fire",
    "text": "别再谈论一个好人应当是什么样，去成为那样的人。",
    "author": "马可·奥勒留",
    "work": "《沉思录》10.16",
    "original": "No longer talk at all about the kind of man that a good man ought to be, but be such.",
    "translation": "本应用自译",
    "source": "https://classics.mit.edu/Antoninus/meditations.10.ten.html",
    "note": "据George Long 1862年英译本自译，非希腊原文",
    "context": "原意是践行品德，不是关于运动表现的论断。"
  },
  {
    "id": "whitman-road",
    "tone": "fire",
    "text": "我迈开双脚，怀着轻快的心，走上开阔的道路。",
    "author": "沃尔特·惠特曼",
    "work": "《大路之歌》第1节",
    "original": "Afoot and light-hearted I take to the open road,",
    "translation": "本应用自译",
    "source": "https://poets.org/poem/song-open-road-1/print",
    "note": "《草叶集》1891—1892年版节选",
    "context": "出发与自主选择的诗意表达，保留英文原行末逗号。"
  },
  {
    "id": "dickinson-hope",
    "tone": "persist",
    "text": "希望是那长着羽毛的小生灵，栖息在灵魂里。",
    "author": "艾米莉·狄金森",
    "work": "《诗集·第二辑》Hope，前两行",
    "original": "Hope is the thing with feathers\nThat perches in the soul,",
    "translation": "本应用自译",
    "source": "https://www.gutenberg.org/files/12242/12242-h/12242-h.htm",
    "note": "1891年早期编辑本；标点和标题不冒充手稿原貌",
    "context": "以鸟比喻希望，不承诺努力一定获得某种结果。"
  },
  {
    "id": "dickinson-dawn",
    "tone": "persist",
    "text": "不知道黎明何时到来，我便敞开每一扇门。",
    "author": "艾米莉·狄金森",
    "work": "《诗集·第三辑》Dawn，前两行",
    "original": "NOT knowing when the dawn will come\nI open every door;",
    "translation": "本应用自译",
    "source": "https://en.wikisource.org/wiki/Poems:_Third_Series/Dawn",
    "note": "1896年早期编辑本，Mabel Loomis Todd编",
    "context": "面对未知保持开放，并非承诺努力必有回报。"
  },
  {
    "id": "thoreau-awake",
    "tone": "persist",
    "text": "唯有我们醒着迎接的那一天，才真正破晓。",
    "author": "亨利·戴维·梭罗",
    "work": "《瓦尔登湖》结语",
    "original": "Only that day dawns to which we are awake.",
    "translation": "本应用自译",
    "source": "https://courses.lumenlearning.com/suny-americanlit1/?p=217",
    "note": "1854年英文原作节选",
    "context": "醒着是精神觉醒的比喻，不是鼓励少睡或早起硬练。"
  },
  {
    "id": "whitman-verse",
    "tone": "persist",
    "text": "这宏大的戏剧仍在继续，而你也将贡献一行诗。",
    "author": "沃尔特·惠特曼",
    "work": "《我啊！人生哟！》结句",
    "original": "That the powerful play goes on, and you will contribute a verse.",
    "translation": "本应用自译",
    "source": "https://www.waltwhitman.org/?p=943",
    "note": "《草叶集》英文原作节选",
    "context": "回答生命价值的疑问，不是保证训练成绩。"
  },
  {
    "id": "shakespeare-slow",
    "tone": "calm",
    "text": "审慎些，慢一些；急着奔跑的人容易绊倒。",
    "author": "威廉·莎士比亚",
    "work": "《罗密欧与朱丽叶》2.3",
    "original": "Wisely and slow; they stumble that run fast.",
    "translation": "本应用自译",
    "source": "https://shakespeare.mit.edu/romeo_juliet/romeo_juliet.2.3.html",
    "note": "劳伦斯修士台词；非作者的训练建议",
    "context": "原是劝罗密欧别仓促行事，不能据此断言快跑必然受伤。"
  },
  {
    "id": "emerson-peace",
    "tone": "calm",
    "text": "唯有你自己，才能带给自己安宁。",
    "author": "拉尔夫·沃尔多·爱默生",
    "work": "《自立》（Self-Reliance）结尾段",
    "original": "Nothing can bring you peace but yourself.",
    "translation": "本应用自译",
    "source": "https://www1.assumption.edu/ahc/Self-Reliance.html",
    "note": "1841年英文原作节选",
    "context": "强调内在原则，不否定他人支持的价值。"
  },
  {
    "id": "thoreau-rhythm",
    "tone": "calm",
    "text": "让他循着自己听见的乐声迈步，无论节拍多么舒缓，声音多么遥远。",
    "author": "亨利·戴维·梭罗",
    "work": "《瓦尔登湖》结语",
    "original": "Let him step to the music which he hears, however measured or far away.",
    "translation": "本应用自译",
    "source": "https://courses.lumenlearning.com/suny-americanlit1/?p=217",
    "note": "1854年英文原作节选",
    "context": "尊重个人节奏与人生方向，不是具体配速或训练周期建议。"
  },
  {
    "id": "whitman-enough",
    "tone": "calm",
    "text": "我以本来的样子存在，这就足够了。",
    "author": "沃尔特·惠特曼",
    "work": "《自我之歌》第20节",
    "original": "I exist as I am, that is enough,",
    "translation": "本应用自译",
    "source": "https://poets.org/poem/song-myself-20",
    "note": "《草叶集》英文原作节选",
    "context": "肯定自身价值，不以表现换取自我认可。"
  }
]);
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
    var q = chooseQuote(selected + pick.day, opts), tone = q.tone;
    var p = profile(db.params.shareProfile);
    var summary = '记录了 ' + rows.length + ' 项动作、' + Math.round(reps) + ' 次训练动作。' +
      (sessions.some(function(x){return x.rec.deload;}) ? '减载也是计划的一部分。认真练习，也认真恢复。' : adds > 0 ? adds + ' 个动作达到加重条件。把进步留在记录里，把恢复留给接下来的自己。' : '加重不是每次训练的唯一答案。保持节奏，每次认真练习都算数。');

    var fun = volume > 0 ? '约等于搬动 20 kg 行李箱 ' + Math.round(volume / 20) + ' 次' : '不靠配重片，也完成了 ' + Math.round(reps) + ' 次动作';
    var note = volume > 0 ? '趣味类比 = 累计训练容量 ÷ 20 kg，不是一次举起的重量。' : '自重动作按次数记录，不虚构重量。';
    var weekText = GZ.weekText(pick.week, db.params);
    return { recordId: pick.id, day: pick.day, dayName: pick.dayName, week: pick.week, weekText: weekText, seq: pick.seq, label: pick.label,
      date: selected, isToday: selected === GZ.today(), profile: p, name: p.name || '训练者', hasName: !!p.name, tone: tone,
      title: q.text, quote: q, attribution: attribution(q), copy: summary, volume: Math.round(volume * 100) / 100, volumeText: (volume / 1000).toFixed(2),
      reps: Math.round(reps), sets: sets, adds: adds, estimated: estimated, rows: rows,
      sessions: 1, days: pick.day + ' ' + pick.dayName, trainingDays: pick.seq, weight: p.showWeight && bw !== null ? bw : null, fun: fun, funNote: note,
      caption: (p.name || '训练者') + (p.handle ? ' ' + p.handle : '') + ' · ' + selected + ' · ' + pick.day + ' ' + pick.dayName + ' · 第 ' + pick.seq + ' 次训练\n' + '“' + q.text + '”\n——' + attribution(q) + (q.original ? '\n原文：' + q.original : '') + '\n' + rows.length + ' 项动作 / ' + (estimated ? '估算 ' : '') + Math.round(reps) + ' 次 / ' + (estimated ? '估算' : '累计') + '容量 ' + Math.round(volume) + ' kg\n' + fun + '（累计容量的趣味类比）\n' + '训练小结（本应用生成）：' + summary + '\n#训练打卡 #认真练习' };
  }

  function font(ctx, size, weight) { ctx.font = (weight || 400) + ' ' + size + 'px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'; }
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
  async function draw(canvas, data, theme) {
    var avatar = await loadImage(data.profile.avatar), ctx = canvas.getContext('2d');
    var warm = theme === 'warm', bg = warm ? '#FFF6EE' : '#F5F6F3', ink = '#20251F', muted = '#66705F', accent = '#C55A32';
    var W = 1080, q = data.quote, titleSize = 64, titleLines;
    var displayTitle = data.title.length > 14 ? data.title.replace(/，/g, '，\n') : data.title;
    do { font(ctx,titleSize,750); titleLines=wrap(ctx,displayTitle,952); if(titleLines.length<=3)break;titleSize-=4; } while(titleSize>40);
    var titleHeight=titleLines.length*(titleSize+18);
    var pf=data.profile, nameSize=fit(ctx,data.name,700,52,36);
    font(ctx,26,400); var sigLines=pf.signature?wrap(ctx,pf.signature,720).slice(0,2):[];
    var subLine=[pf.handle, data.weight!==null?'体重 '+data.weight+' kg':''].filter(Boolean).join('  ·  ');
    var profileH=Math.max(152, 12+nameSize+14+(subLine?36:0)+sigLines.length*38+10);
    var top=150+profileH+86; // 名片区下方：分隔线 + 训练信息 + 留白
    font(ctx,24,500); var originLines=q.original?wrap(ctx,q.original,952):[];
    font(ctx,23,500); var creditLines=wrap(ctx,data.attribution,952);
    var metadataY=top+titleHeight+22+originLines.length*32+creditLines.length*32;
    var offset=metadataY-510;
    font(ctx,29,500);var summaryLines=wrap(ctx,data.copy,880);
    var H = 1560 + offset + data.rows.length * 110 + Math.max(0,summaryLines.length-2)*42;
    canvas.width = W; canvas.height = H; ctx.textBaseline = 'top';
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);
    var glow = ctx.createRadialGradient(1010,50,10,880,70,720); glow.addColorStop(0,warm?'#FCD7B7':'#E0E9D9'); glow.addColorStop(1,bg);
    ctx.fillStyle = glow; ctx.fillRect(0,0,W,700);
    // ---- 顶部：日期 ----
    text(ctx,'训练手记',64,68,22,muted,650);
    ctx.textAlign='right';text(ctx,data.date.replace(/-/g,'.'),1016,68,22,muted,500);ctx.textAlign='left';
    // ---- 个人名片：大头像 + 昵称 + ID/体重 + 签名 ----
    var AV=136, ax=64, ay=150, cy0=ay+Math.max(0,(profileH-AV)/2);
    ctx.save(); ctx.beginPath(); ctx.arc(ax+AV/2,cy0+AV/2,AV/2,0,Math.PI*2); ctx.closePath(); ctx.clip();
    ctx.fillStyle=warm?'#F6DCC6':'#DCE5D3'; ctx.fillRect(ax,cy0,AV,AV);
    if (avatar) { var side=Math.min(avatar.width,avatar.height);ctx.drawImage(avatar,(avatar.width-side)/2,(avatar.height-side)/2,side,side,ax,cy0,AV,AV); }
    else { font(ctx,60,700); ctx.fillStyle=ink; ctx.textAlign='center'; ctx.fillText(Array.from(data.name)[0],ax+AV/2,cy0+AV/2-36); ctx.textAlign='left'; }
    ctx.restore();
    ctx.lineWidth=4; ctx.strokeStyle='#FFFFFF'; ctx.beginPath(); ctx.arc(ax+AV/2,cy0+AV/2,AV/2-2,0,Math.PI*2); ctx.stroke();
    var tx=ax+AV+32, ty=ay+Math.max(0,(profileH-(nameSize+14+(subLine?36:0)+sigLines.length*38))/2);
    text(ctx,data.name,tx,ty,nameSize,ink,700); ty+=nameSize+14;
    if (subLine) { text(ctx,subLine,tx,ty,24,muted,500); ty+=36; }
    sigLines.forEach(function(l){ text(ctx,l,tx,ty,26,ink,400); ty+=38; });
    // ---- 本次训练：哪一天 / 第几周 / 第几次 ----
    var infoY=150+profileH+24;
    ctx.strokeStyle='#DCE1D6'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(64,infoY); ctx.lineTo(1016,infoY); ctx.stroke();
    text(ctx,data.day+' '+data.dayName+'  ·  '+data.weekText+'  ·  第 '+data.seq+' 次训练',64,infoY+22,24,ink,600);
    titleLines.forEach(function(l,i){text(ctx,l,64,top+i*(titleSize+18),titleSize,ink,750);});
    var creditY=top+titleHeight+4;
    originLines.forEach(function(l,i){text(ctx,l,64,creditY+i*32,24,muted,400);});
    creditY+=originLines.length*32;
    creditLines.forEach(function(l,i){text(ctx,l,64,creditY+i*32,23,muted,500);});
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
    text(ctx,'本次训练清单',64,1160+offset,29,ink,650);ctx.textAlign='right';text(ctx,data.rows.length+' 项动作',1016,1166+offset,22,muted,500);ctx.textAlign='left';
    var y = 1222+offset;
    data.rows.forEach(function(r,i){
      ctx.strokeStyle='#DCE1D6';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(64,y-14);ctx.lineTo(1016,y-14);ctx.stroke();
      text(ctx,r.tier,64,y+2,23,muted,650);
      var rowName=r.name; font(ctx,30,650); var names=wrap(ctx,rowName,390);
      names.slice(0,2).forEach(function(l,j){text(ctx,l,144,y+j*33,30,ink,650);});
      text(ctx,r.result,144,y+72,21,muted,400);
      font(ctx,27,650);ctx.textAlign='right';text(ctx,r.load,1016,y+2,27,ink,650);text(ctx,r.stage+' · '+r.reps+' 次',1016,y+44,22,muted,400);ctx.textAlign='left';
      y += 110;
    });
    y += 26;ctx.strokeStyle='#DCE1D6';ctx.beginPath();ctx.moveTo(64,y);ctx.lineTo(1016,y);ctx.stroke();
    text(ctx,'训练小结 · 本应用生成',64,y+26,22,muted,500);
    summaryLines.forEach(function(l,i){text(ctx,l,64,y+66+i*42,29,ink,500);});
    text(ctx,'认真练习，也认真恢复。',64,H-103,22,muted,500);
    text(ctx,'容量沿用记录口径：哑铃按单只，自重不计 kg；次数按组次估算。',64,H-62,18,muted,400);
    return canvas;
  }
  return { PROFILE: PROFILE, profile: profile, dates: dates, sessionList: sessionList, build: build, draw: draw, QUOTES: QUOTES, TONES: TONES, quoteList: quoteList, chooseQuote: chooseQuote, attribution: attribution };
});
