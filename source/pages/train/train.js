const GZ = require('../../utils/engine.js');
const store = require('../../utils/store.js');
const app = getApp();

function fmtSec(s) { s = Math.max(0, s); const m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }

Page({
  data: { vm: null, date: '', dateText: '', bw: '', note: '', rest: { show: false }, result: null, swap: { show: false } },

  onLoad() { this.day = null; this.draft = null; this.recordId = null; this.deload = undefined; this.setDate(GZ.today()); },
  setDate(d) { this.setData({ date: d, dateText: GZ.dateLabel(d) }); },

  onShow() {
    const g = app.globalData;
    if (g.editRecordId) { this.startEdit(g.editRecordId); g.editRecordId = null; return; }
    if (g.gotoDay) { this.switchDay(g.gotoDay); g.gotoDay = null; return; }
    this.refresh();
  },
  onUnload() { this.clearTimer(); },

  db() { return store.load(); },

  refresh() {
    const db = this.db();
    if (!this.day) this.day = GZ.recommend(db).day;
    if (!GZ.dayById(db, this.day)) this.day = db.days[0].id;
    if (!this.draft) this.draft = GZ.blankDraft(db, this.day);
    const vm = GZ.buildTrain(db, { day: this.day, recordId: this.recordId, draft: this.draft, deload: this.deload });
    this.setData({ vm });
  },

  switchDay(day) {
    if (this.recordId) return;
    this.day = day; this.deload = undefined;
    this.draft = GZ.blankDraft(this.db(), day);
    this.refresh();
  },

  startEdit(id) {
    const db = this.db(), rec = GZ.getRecord(db, id);
    if (!rec) return this.refresh();
    this.recordId = id; this.day = rec.day; this.deload = !!rec.deload; this.editCreatedAt = rec.createdAt;
    const draft = GZ.blankDraft(db, rec.day);
    Object.keys(draft).forEach((k) => { if (rec.entries[k]) draft[k] = Object.assign({ done: 0 }, rec.entries[k]); });
    this.draft = draft;
    this.setDate(rec.date); this.setData({ bw: rec.bw || '', note: rec.note || '' });
    this.refresh();
  },
  cancelEdit() {
    this.recordId = null; this.day = null; this.draft = null; this.deload = undefined;
    this.setDate(GZ.today()); this.setData({ bw: '', note: '' });
    this.refresh();
  },

  // ---- 交互 ----
  onDay(e) { this.switchDay(e.currentTarget.dataset.day); },
  onEditLocked(e) { this.startEdit(e.currentTarget.dataset.id); },
  onDate(e) { this.setDate(e.detail.value); },
  onDeload(e) { this.deload = e.detail.value; this.refresh(); },
  entry(slot) { return this.draft[slot] || (this.draft[slot] = { v: null, done: 0 }); },

  onStep(e) {
    const { slot, d } = e.currentTarget.dataset, en = this.entry(slot);
    const it = this.data.vm.items.find((x) => x.slotId === slot);
    let v = en.v === null || en.v === '' || en.v === undefined ? (Number(d) > 0 ? it.reps : 0) : Number(en.v) + Number(d);
    en.v = Math.max(0, Math.min(60, v));
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    this.refresh();
  },
  onAmrap(e) {
    const en = this.entry(e.currentTarget.dataset.slot), raw = e.detail.value;
    en.v = raw === '' ? null : Math.max(0, Math.min(60, parseInt(raw, 10) || 0));
    this.refresh();
  },
  on5RM(e) { this.entry(e.currentTarget.dataset.slot).new5RM = e.detail.value; this.refresh(); },
  onDone(e) {
    const { slot, v } = e.currentTarget.dataset, en = this.entry(slot);
    en.v = en.v === v ? null : v;
    this.refresh();
  },
  onReps(e) { this.entry(e.currentTarget.dataset.slot).reps = e.detail.value; this.refresh(); },
  // ---- 更换动作 ----
  openSwap(e) {
    const slot = e.currentTarget.dataset.slot, it = this.data.vm.items.find((x) => x.slotId === slot);
    const db = this.db(), ctx = GZ.swapContext(db, this.day, slot);
    this.swapState = {
      show: true, slotId: slot, dayId: this.day, slotTier: it.tier, tier: it.tier, q: '', sel: '', scope: 'once',
      curName: it.name, planName: it.planName, isSub: it.sub, editing: !!this.recordId, rotates: ctx.rotates, week: ctx.week, weight: ctx.weightText, ctxW: ctx.weight, lastW: ctx.lastW
    };
    this.renderSwap();
  },
  renderSwap() {
    const s = this.swapState;
    s.lib = GZ.buildLibrary(this.db(), { tier: s.tier, q: s.q, current: s.curName });
    this.setData({ swap: s });
  },
  closeSwap() { this.setData({ 'swap.show': false }); },
  swapTier(e) { if (this.swapState.slotTier === 'T1') return; this.swapState.tier = e.currentTarget.dataset.t; this.renderSwap(); },
  swapQ(e) { this.swapState.q = e.detail.value; this.renderSwap(); },
  swapPick(e) {
    const s = this.swapState, name = e.currentTarget.dataset.name;
    if (name === s.curName) return this.closeSwap();
    s.sel = name;
    const rec = GZ.recommendWeight(this.db(), name, s.slotTier, { preferLast: true });
    s.weight = String(rec.weight);
    s.recText = rec.text; s.recUnit = rec.unit; s.recNote = rec.note; s.selEquip = rec.equip;
    this.setData({ 'swap.sel': s.sel, 'swap.weight': s.weight, 'swap.recText': s.recText, 'swap.recUnit': s.recUnit, 'swap.recNote': s.recNote, 'swap.selEquip': s.selEquip });
  },
  swapScope(e) { this.swapState.scope = e.currentTarget.dataset.s; this.setData({ 'swap.scope': this.swapState.scope }); },
  swapWeight(e) { this.swapState.weight = e.detail.value; },
  swapRestore() {
    const en = this.entry(this.swapState.slotId); delete en.ex; en.w = null;
    this.closeSwap(); this.refresh();
  },
  swapConfirm() {
    const s = this.swapState, en = this.entry(s.slotId);
    if (s.scope === 'once' || s.editing) {
      en.ex = s.sel; en.w = Number(s.weight) || 0; // 本次替换直接采用该动作的器械感知推荐重量
      wx.showToast({ title: '本次改为 ' + s.sel + ' · ' + s.recText + (s.recUnit === '自重' ? '' : ' ' + s.recUnit), icon: 'none' });
    } else {
      const w = parseFloat(s.weight);
      if (isNaN(w) || w < 0) return wx.showToast({ title: '请填写起始重量', icon: 'none' });
      const db = this.db(), r = GZ.swapSlot(db, s.dayId, s.slotId, s.sel, w);
      if (r && r.error) return wx.showToast({ title: r.error, icon: 'none' });
      store.save(db);
      delete en.ex; en.w = null; en.editW = false;
      wx.showToast({ title: r && r.base ? '已更换为 ' + s.sel : '第 ' + r.fromWeek + ' 周起改为 ' + s.sel, icon: 'none' });
    }
    this.closeSwap(); this.refresh();
  },

  // ---- 手动调整重量 ----
  onEditW(e) { const en = this.entry(e.currentTarget.dataset.slot); en.editW = !en.editW; this.refresh(); },
  onWStep(e) {
    const { slot, d } = e.currentTarget.dataset, en = this.entry(slot);
    const it = this.data.vm.items.find((x) => x.slotId === slot);
    const next = Math.max(0, Math.round((Number(it.weight) + Number(d) * it.wStep) * 100) / 100);
    en.w = next === it.autoWeight ? null : next;
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    this.refresh();
  },
  onWInput(e) {
    const en = this.entry(e.currentTarget.dataset.slot), raw = e.detail.value;
    const it = this.data.vm.items.find((x) => x.slotId === e.currentTarget.dataset.slot);
    const n = parseFloat(raw);
    en.w = raw === '' || isNaN(n) || n === it.autoWeight ? null : n;
    this.refresh();
  },
  onWReset(e) { const en = this.entry(e.currentTarget.dataset.slot); en.w = null; this.refresh(); },
  onSkip(e) { const en = this.entry(e.currentTarget.dataset.slot); en.skip = !en.skip; this.refresh(); },
  onBw(e) { this.setData({ bw: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },

  onDot(e) {
    const { slot, i, rest, name } = e.currentTarget.dataset, en = this.entry(slot);
    const it = this.data.vm.items.find((x) => x.slotId === slot);
    en.done = en.done === i + 1 ? i : i + 1;
    this.refresh();
    if (en.done === i + 1 && en.done < it.sets) this.beginRest(rest, name);
  },

  // ---- 组间休息 ----
  startRest(e) { this.beginRest(e.currentTarget.dataset.rest, e.currentTarget.dataset.name); },
  beginRest(sec, name) {
    this.clearTimer();
    this.restTotal = Number(sec); this.restLeft = Number(sec);
    this.setData({ rest: { show: true, name, text: fmtSec(this.restLeft), pct: 100 } });
    this.timer = setInterval(() => {
      this.restLeft -= 1;
      if (this.restLeft <= 0) {
        this.clearTimer(); wx.vibrateLong && wx.vibrateLong();
        this.setData({ rest: { show: false } });
        wx.showToast({ title: '休息结束，上！', icon: 'none' });
        return;
      }
      this.setData({ 'rest.text': fmtSec(this.restLeft), 'rest.pct': this.restLeft / this.restTotal * 100 });
    }, 1000);
  },
  adjRest(e) { this.restLeft = Math.max(5, this.restLeft + Number(e.currentTarget.dataset.d)); this.restTotal = Math.max(this.restTotal, this.restLeft); this.setData({ 'rest.text': fmtSec(this.restLeft) }); },
  stopRest() { this.clearTimer(); this.setData({ rest: { show: false } }); },
  clearTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

  // ---- 提交结算 ----
  onSubmit() {
    const vm = this.data.vm;
    if (vm.locked) return;
    const missing = vm.deload ? [] : vm.items.filter((it) => !it.skip && (it.value === null || it.value === undefined || it.value === ''));
    const go = () => {
      missing.forEach((it) => { this.entry(it.slotId).skip = true; });
      this.save();
    };
    if (missing.length === vm.items.length) return wx.showToast({ title: '至少填写一个动作', icon: 'none' });
    if (missing.length) {
      wx.showModal({ title: '还有未填写的动作', content: missing.map((m) => m.name).join('、') + ' 将按“跳过”保存，状态保持不变。', confirmText: '继续保存', confirmColor: '#FF6B1A', success: (r) => { if (r.confirm) go(); } });
    } else go();
  },

  save() {
    const db = this.db();
    const bw = this.data.bw ? Number(this.data.bw) : null;
    const rec = GZ.saveRecord(db, {
      id: this.recordId, date: this.data.date, day: this.day, deload: this.data.vm.deload,
      note: this.data.note, bw, entries: this.draft,
      createdAt: this.recordId ? this.editCreatedAt : Date.now()
    });
    if (bw > 0) db.params.bodyWeight = bw; // 负重动作推荐重量以最近体重为基准
    store.save(db);
    const s = GZ.sessionResult(db, rec.id), rd = GZ.roundInfo(db);
    const weekDone = !this.recordId && s && rd.week > s.week;
    const doneCyc = s ? GZ.cycleOf(s.week, db.params).cycle : 1;
    const nextCyc = GZ.cycleOf(rd.week, db.params).cycle;
    const cycleDone = weekDone && nextCyc > doneCyc;
    const rotated = cycleDone ? GZ.buildRotation(db, nextCyc).changed : 0;
    const result = s ? {
      day: s.rec.day, dayName: s.dayName, week: s.week, weekText: GZ.weekText(s.week, db.params),
      cycle: doneCyc, weeksPerCycle: GZ.cycleLen(db.params), volume: Math.round(s.volume),
      weekDone, cycleDone, rotated, nextWeekText: GZ.weekText(rd.week, db.params),
      leftText: this.recordId ? '' : rd.leftText, nextDeload: weekDone && GZ.isDeloadWeek(rd.week, db.params),
      adds: s.items.filter((x) => x.judgment === '加重').length,
      items: s.items.map((it) => ({
        tier: it.tier, tierColor: GZ.TIER_COLORS[it.tier], name: it.name, j: it.judgment, color: GZ.JUDGE_COLORS[it.judgment],
        next: it.deload || it.judgment === '跳过' ? '—' : it.sub ? GZ.fmtW(it.weight) + ' kg · 替代 ' + it.origName : GZ.fmtW(it.nextWeight) + ' kg · ' + it.nextStage
      }))
    } : null;
    // 重置为下一次推荐训练
    this.recordId = null; this.deload = undefined;
    this.day = GZ.recommend(db).day; this.draft = GZ.blankDraft(db, this.day);
    this.setDate(GZ.today()); this.setData({ result, bw: '', note: '' });
    this.refresh();
  },
  closeResult() { this.setData({ result: null }); },
  gotoStats() { this.setData({ result: null }); wx.switchTab({ url: '/pages/stats/stats' }); },
  noop() {}
});
