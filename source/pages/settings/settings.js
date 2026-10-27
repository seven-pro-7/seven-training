const GZ = require('../../utils/engine.js');
const store = require('../../utils/store.js');
const Share = require('../../utils/share.js');

function libNames(db) {
  const m = { T1: [], T2: [], T3: [] };
  GZ.libAll(db).forEach((x) => { if (!m[x.tier] || m[x.tier].indexOf(x.name) >= 0) return; m[x.tier].push(x.name); });
  return m;
}
const LIFT_NAMES = GZ.LIFT_ORDER.map((k) => GZ.LIFTS[k]);

function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = val;
}

Page({
  data: { p: null, profile: { name: '', handle: '', signature: '', showWeight: false }, lifts: [], steps: [], days: [], dIdx: 0, libNames: { T1: [], T2: [], T3: [] }, libCount: 0, customCount: 0, liftNames: LIFT_NAMES, showImport: false, recordCount: 0, tmPct: 90, backupText: '', ruleNote: '' },
  onShow() { this.refresh(); },

  refresh() {
    const db = store.load(), P = db.params, rp = GZ.replay(db), names = libNames(db);
    const curProg = GZ.progressionOf(db).id;
    const curCyc = GZ.cycleOf(GZ.recommend(db, rp).week, P).cycle, nextPlan = GZ.planCycles(db, curCyc + 1);
    const days = db.days.map((d) => ({
      id: d.id, name: d.name,
      slots: d.slots.map((s) => {
        const wk = (rp.counts[d.id] || 0) + 1, ef = GZ.effectiveSlot(db, s, wk);
        const list = names[s.tier].indexOf(ef.slot.name) < 0 ? [ef.slot.name].concat(names[s.tier]) : names[s.tier];
        const eq = GZ.equipOf(ef.slot.name, ef.slot.equip), rec = GZ.recommendWeight(db, ef.slot.name, s.tier, { preferLast: false });
        return {
        id: s.id, tier: s.tier, badge: GZ.slotBadge(s, curProg), name: ef.slot.name, equip: eq, equipLabel: eq + (eq === '哑铃' ? '·单只' : eq === '负重' ? '·外加' : ''),
        recText: rec.text + (rec.unit === '自重' ? '' : ' ' + rec.unit), recNote: rec.note, recWeight: rec.weight,
        init: s.init, opts: list, optIdx: list.indexOf(ef.slot.name),
        changeText: ef.auto ? '第 ' + ef.change.cycle + ' 轮自动轮换 · 上一轮 ' + ef.change.prev : ef.change ? '第 ' + ef.change.fromWeek + ' 周起更换 · 原 ' + s.name : '',
        rotTier: s.tier !== 'T1', locked: !!s.noRotate,
        nextName: s.tier === 'T1' ? '' : nextPlan.actual[curCyc + 1][s.id], nextCycle: curCyc + 1,
        initW: GZ.fmtW(GZ.initWeight(s, P)),
        baseIdx: s.init.type === 'pct' ? GZ.LIFT_ORDER.indexOf(s.init.base) : 0,
        baseName: s.init.type === 'pct' ? GZ.LIFTS[s.init.base] : '',
        pctText: s.init.type === 'pct' ? Math.round(s.init.pct * 100) : '',
        stepText: eq === '自重' ? '达阈值后改负重' : GZ.stepOf(Object.assign({}, s, { name: ef.slot.name, equip: eq }), P) + ' kg · 按 ' + GZ.incOf(Object.assign({}, s, { name: ef.slot.name, equip: eq }), P) + ' kg 档'
      }; })
    }));
    const isGz = curProg === 'gzclp';
    const pRules = GZ.progressionRules ? GZ.progressionRules(curProg) : { name: curProg, summary: '' };
    this.setData({
      p: P, profile: Share.profile(P.shareProfile), isGz, mainLabel: GZ.tierLabel(curProg, 'T1'), progName: pRules.name, progSummary: pRules.summary, ruleNote: GZ.ruleModeNote(P), days, libCount: GZ.libAll(db).length, customCount: db.customLib.length, recordCount: db.records.length, tmPct: Math.round(P.tmRatio * 100), backupText: GZ.backupLabel(store.lastBackup()),
      lifts: GZ.LIFT_ORDER.map((k) => ({ key: k, name: GZ.LIFTS[k], oneRM: P.oneRM[k], tm: GZ.fmtW(GZ.tm(P, k)) })),
      steps: GZ.STEP_KEYS.map((s) => ({ key: s.key, label: s.label, note: s.note, v: P.steps[s.key] }))
    });
  },
  mutate(fn, tip) { const db = store.load(); fn(db); store.save(db); this.refresh(); if (tip !== false) wx.showToast({ title: tip || '已更新，数据已重算', icon: 'none' }); },

  onProfile(e) {
    const k = e.currentTarget.dataset.k;
    this.mutate((db) => {
      const pp = Share.profile(db.params.shareProfile);
      pp[k] = e.detail.value;
      db.params.shareProfile = Share.profile(pp);
    }, '分享名片已保存');
  },
  onProfileWeight(e) {
    this.mutate((db) => {
      const pp = Share.profile(db.params.shareProfile);
      pp.showWeight = !!e.detail.value;
      db.params.shareProfile = Share.profile(pp);
    }, e.detail.value ? '卡片会显示已记录的当天体重' : '卡片不再公开体重');
  },
  onParam(e) {
    const k = e.currentTarget.dataset.k; let v = parseFloat(e.detail.value);
    if (isNaN(v) || v < 0) return this.refresh();
    if (e.currentTarget.dataset.pct) v = v / 100;
    this.mutate((db) => setPath(db.params, k, v));
  },
  onMode(e) { const v = e.currentTarget.dataset.v; this.mutate((db) => { db.params.ruleMode = v; }, v === 'full' ? '已切换：完整三阶规则' : '已切换：严格表格公式'); },
  onDeload(e) { this.mutate((db) => { db.params.deloadEnabled = e.detail.value; }); },
  onRotate(e) { this.mutate((db) => { db.params.autoRotate = e.detail.value; }, e.detail.value ? '已开启：每轮自动轮换 T2/T3' : '已关闭自动轮换'); },
  onAdaptive(e) { this.mutate((db) => { db.params.adaptive = e.detail.value; }, e.detail.value ? '已开启：按末组次数自适应加重' : '已关闭：固定步幅加重'); },
  onLock(e) { const si = Number(e.currentTarget.dataset.si); this.slotMut(si, (s) => { s.noRotate = !s.noRotate; }, false); },
  onDayTab(e) { this.setData({ dIdx: Number(e.currentTarget.dataset.i) }); },

  slotMut(si, fn, tip) { const di = this.data.dIdx; this.mutate((db) => fn(db.days[di].slots[si], db), tip); },
  onEx(e) {
    const si = Number(e.currentTarget.dataset.si), slot = this.data.days[this.data.dIdx].slots[si];
    const name = slot.opts[Number(e.detail.value)];
    if (!name || name === slot.name) return;
    const db = store.load(), r = GZ.swapSlot(db, this.data.days[this.data.dIdx].id, slot.id, name, null);
    if (r && r.error) return wx.showToast({ title: r.error, icon: 'none' });
    store.save(db); this.refresh();
    wx.showToast({ title: r && r.base ? '已更换为 ' + name : '第 ' + r.fromWeek + ' 周起改为 ' + name, icon: 'none' });
  },
  openLib() { wx.navigateTo({ url: '/pages/library/library' }); },
  onInitType(e) {
    const si = Number(e.currentTarget.dataset.si), v = e.currentTarget.dataset.v;
    this.slotMut(si, (s, db) => {
      if (s.init.type === v) return;
      const w = GZ.initWeight(s, db.params);
      s.init = v === 'fixed' ? { type: 'fixed', value: w } : { type: 'pct', base: s.lift || 'bench', pct: 0.5 };
    });
  },
  onBase(e) { const si = Number(e.currentTarget.dataset.si); this.slotMut(si, (s) => { s.init.base = GZ.LIFT_ORDER[Number(e.detail.value)]; }); },
  onPct(e) { const v = parseFloat(e.detail.value); if (isNaN(v)) return; this.slotMut(Number(e.currentTarget.dataset.si), (s) => { s.init.pct = v / 100; }); },
  onFixed(e) { const v = parseFloat(e.detail.value); if (isNaN(v)) return; this.slotMut(Number(e.currentTarget.dataset.si), (s) => { s.init.value = v; }); },
  onApplyRec(e) {
    const si = Number(e.currentTarget.dataset.si), di = this.data.dIdx, view = this.data.days[di].slots[si];
    const db = store.load(), day = db.days[di], s = day.slots[si], rec = GZ.recommendWeight(db, view.name, s.tier, { preferLast: false });
    const ef = GZ.effectiveSlot(db, s, (GZ.replay(db).counts[day.id] || 0) + 1);
    if (ef.change) GZ.swapSlot(db, day.id, s.id, view.name, rec.weight);
    else s.init = { type: 'fixed', value: rec.weight };
    store.save(db); this.refresh(); wx.showToast({ title: '已采用推荐 ' + rec.text + (rec.unit === '自重' ? '' : ' ' + rec.unit), icon: 'none' });
  },

  exportData() {
    wx.setClipboardData({ data: JSON.stringify(store.load()), success: () => { store.markBackup(); this.refresh(); wx.showToast({ title: '已复制，粘贴到文件传输助手保存', icon: 'none' }); } });
  },
  toggleImport() { this.setData({ showImport: !this.data.showImport }); },
  onImportText(e) { this.importText = e.detail.value; },
  doImport() {
    try {
      const db = GZ.normalize(JSON.parse(this.importText || ''));
      store.save(db); this.setData({ showImport: false }); this.refresh(); wx.showToast({ title: '导入成功', icon: 'success' });
    } catch (err) { wx.showToast({ title: 'JSON 格式不正确', icon: 'none' }); }
  },
  clearRecords() {
    wx.showModal({ title: '清空全部训练记录？', content: '参数与动作配置保留，记录无法恢复。建议先导出备份。', confirmColor: '#FF3B30',
      success: (r) => { if (r.confirm) this.mutate((db) => { GZ.clearRecords(db); }, '已清空'); } });
  },
  restore() {
    wx.showModal({ title: '恢复 Excel 默认？', content: '参数、动作配置与记录将恢复为表格初始状态（含第 1 周 A1/B1 记录）。', confirmColor: '#FF3B30',
      success: (r) => { if (r.confirm) { store.reset(true); this.refresh(); wx.showToast({ title: '已恢复', icon: 'none' }); } } });
  }
});
