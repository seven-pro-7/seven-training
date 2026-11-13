const GZ = require('../../utils/engine.js');
const Home = require('../../utils/home-copy.js');
const SL = require('../../utils/set-log.js');
const store = require('../../utils/store.js');
const app = getApp();

function fmtSec(s) { s = Math.max(0, s); const m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }

Page({
  data: { vm: null, date: '', dateText: '', bw: '', note: '', rest: { show: false }, result: null, swap: { show: false }, share: { show: false, kind: 'day', recordId: '', week: 0, ym: '' } },

  onLoad() {
    this.day = null; this.draft = null; this.drafts = {}; this.deloads = {}; this.recordId = null; this.deload = undefined;
    this.setDate(GZ.today());
    this.restoreOpen();
    this._openReady = true;
  },
  setDate(d) { this.date = d; this.setData({ date: d, dateText: GZ.dateLabel(d) }); },

  onShow() {
    if (this.restUntil) this.armRest();
    if (this.logOn && wx.hideTabBar) wx.hideTabBar({ animation: false });
    if (!this._openReady) { this.restoreOpen(); this._openReady = true; }
    const g = app.globalData;
    if (g.editRecordId) { this.startEdit(g.editRecordId); g.editRecordId = null; return; }
    if (g.gotoDay) { this.switchDay(g.gotoDay); g.gotoDay = null; return; }
    this.refresh();
  },
  onHide() { this.persistOpen(); },
  onUnload() { this.persistOpen(); this.clearTimer(); },

  openSnap() {
    // setData 是异步的，体重和备注以页面字段为准，避免切后台时把刚输入的内容写成空的
    return {
      day: this.day, draft: this.draft, drafts: this.drafts, deloads: this.deloads,
      date: this.date || this.data.date,
      bw: this.bw != null ? this.bw : (this.data.bw || ''),
      note: this.note != null ? this.note : (this.data.note || ''),
      recordId: this.recordId, createdAt: this.editCreatedAt, deload: this.deload
    };
  },
  persistOpen() {
    if (!this._openReady) return false;
    return store.saveOpen(GZ.packOpenSession(this.openSnap())) !== false;
  },
  restoreOpen() {
    const snap = store.loadOpen();
    if (!GZ.applyOpenSession(this, snap)) return;
    if (this.recordId && !GZ.getRecord(store.load(), this.recordId)) {
      this.recordId = null; this.editCreatedAt = null;
    } else this.editCreatedAt = this.createdAt;
    this.setDate(this.date || GZ.today());
    this.setData({ bw: this.bw || '', note: this.note || '' });
  },

  db() { return store.load(); },

  refresh() {
    const db = this.db();
    if (!this.day) this.day = GZ.recommend(db).day;
    if (!GZ.dayById(db, this.day)) this.day = db.days[0].id;
    if (!this.drafts) this.drafts = {};
    if (!this.draft) this.draft = this.drafts[this.day] || GZ.blankDraft(db, this.day);
    this.drafts[this.day] = this.draft;
    if (this.deload === undefined && this.deloads && this.deloads[this.day]) this.deload = true;
    const vm = GZ.buildTrain(db, { day: this.day, recordId: this.recordId, draft: this.draft, deload: this.deload });
    const items = vm.items || [];
    let focus = this.focus;
    if (!focus || !items.some((x) => x.slotId === focus)) {
      const open = items.find((x) => !x.skip && !x.preview);
      focus = open ? open.slotId : (items[0] && items[0].slotId);
      this.expanded = false;
      this.moreOpen = false;
    }
    this.focus = focus;
    const started = Home.sessionStarted(vm);
    const curItem = items.find((x) => x.slotId === focus) || items[0] || null;
    const pos = Home.positionOf(vm, curItem && curItem.slotId);
    const ready = vm.total > 0 && vm.filled === vm.total && !vm.locked;
    items.forEach((it, i) => {
      it.schemeText = Home.schemeLine(it);
      it.ord = (i < 9 ? '0' : '') + (i + 1);
      it.current = it.slotId === focus;
      it.doneLogged = !!(it.logged && it.value !== '未完成');
      it.pips = (it.dots || []).map((d) => ({ i: d.i, cls: d.on ? 'done' : (d.i === (it.done || 0) ? 'next' : 'todo') }));
    });
    const exBlocks = items.map((it) => ({ key: it.slotId, item: it }));
    const loggedCur = !!(curItem && curItem.doneLogged);
    const home = {
      prompt: Home.guidePrompt({
        dayName: vm.dayName, name: curItem && curItem.name, done: curItem && curItem.done, sets: curItem && curItem.sets,
        logged: loggedCur, skipped: curItem && curItem.skip, ready: ready, started: started, editing: vm.editing
      }),
      stamp: Home.sessionStamp(this.date || GZ.today(), vm.weekInCycle, vm.cycle, vm.day),
      index: pos.index, total: pos.total, started: started, ready: ready,
      cta: Home.ctaLabel({ ready: ready, editing: vm.editing, started: started, name: curItem && curItem.name }),
      live: started && !vm.locked,
      skipLabel: curItem && curItem.skip ? '恢复' : '跳过',
      slot: curItem ? curItem.slotId : ''
    };
    const sp = (db.params && db.params.shareProfile) || {};
    let goalStatus = '可开练';
    if (vm.editing) goalStatus = '编辑记录';
    else if (vm.locked) goalStatus = '已完成';
    else if (vm.filled > 0) goalStatus = '进行中';
    else if (vm.day === vm.recommended) goalStatus = '待开练';
    const log = this.logOn ? this.viewLog(vm) : null;
    if (this.logOn && !log) this.logOn = false;
    this.setData({
      vm, exBlocks, focus, goalStatus, home, log,
      saveFail: !!this.saveFail,
      profileName: (sp.name || '').trim() || 'Seven',
      profileAvatar: sp.avatar || '',
      expanded: !!this.expanded,
      moreOpen: !!this.moreOpen,
      menuOpen: !!this.menuOpen
    });
    this.persistOpen();
  },

  rememberDay() {
    if (!this.day || this.recordId) return;
    if (!this.drafts) this.drafts = {};
    if (this.draft) this.drafts[this.day] = this.draft;
    if (!this.deloads) this.deloads = {};
    if (this.deload) this.deloads[this.day] = true; else delete this.deloads[this.day];
  },
  switchDay(day) {
    if (this.recordId) return;
    if (day && day !== this.day) {
      this.rememberDay();
      this.day = day;
      if (!this.drafts) this.drafts = {};
      this.draft = this.drafts[day] || GZ.blankDraft(this.db(), day);
      this.drafts[day] = this.draft;
      this.deload = this.deloads && this.deloads[day] ? true : undefined;
      this.focus = null; this.expanded = false; this.moreOpen = false;
    }
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
    this.bw = ''; this.note = '';
    this.menuOpen = false; this.expanded = false;
    this.setDate(GZ.today()); this.setData({ bw: '', note: '' });
    this.refresh();
  },

  // ---- 交互 ----
  onDay(e) { this.switchDay(e.currentTarget.dataset.day); },
  onRow(e) {
    const slot = e.currentTarget.dataset.slot;
    if (!slot) return;
    this.openLog(slot);
  },
  onStart() {
    if (this.data.home && this.data.home.ready) return this.onSubmit();
    if (this.data.home && this.data.home.slot) this.openLog(this.data.home.slot);
  },
  onAdjust() { this.menuOpen = true; this.moreOpen = false; this.setData({ menuOpen: true, moreOpen: false }); },
  onFocus(e) {
    const slot = e.currentTarget.dataset.slot;
    if (!slot || slot === this.focus) return;
    this.focus = slot; this.expanded = false; this.moreOpen = false; this.refresh();
  },
  onExpand() { this.expanded = !this.expanded; this.moreOpen = false; this.refresh(); },
  onExpandOpen() { if (!this.expanded) { this.expanded = true; this.moreOpen = false; this.refresh(); } },
  onMore() { this.moreOpen = !this.moreOpen; this.setData({ moreOpen: this.moreOpen }); },
  onMenu() { this.moreOpen = false; this.menuOpen = !this.menuOpen; this.setData({ menuOpen: this.menuOpen, moreOpen: false }); },
  onMenuClose() { this.menuOpen = false; this.setData({ menuOpen: false }); },
  goOverview() { wx.switchTab({ url: '/pages/plan/plan' }); },
  goMe() { this.menuOpen = false; this.moreOpen = false; wx.switchTab({ url: '/pages/settings/settings' }); },
  onEditLocked(e) { this.startEdit(e.currentTarget.dataset.id); },
  onDate(e) { this.setDate(e.detail.value); },
  onDeload(e) { this.deload = e.detail.value; this.refresh(); },
  entry(slot) { return this.draft[slot] || (this.draft[slot] = { v: null, done: 0 }); },

  onStep(e) {
    const { slot, d } = e.currentTarget.dataset, en = this.entry(slot);
    const it = this.data.vm.items.find((x) => x.slotId === slot);
    const target = it.inputType === 'cardio' ? (it.amrapTarget || it.reps) : it.reps;
    let v = en.v === null || en.v === '' || en.v === undefined ? (Number(d) > 0 ? target : Math.max(0, target - 1)) : Number(en.v) + Number(d);
    en.v = Math.max(0, Math.min(it.inputType === 'cardio' ? 300 : 60, v));
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    this.refresh();
  },
  onAmrap(e) {
    const en = this.entry(e.currentTarget.dataset.slot), raw = e.detail.value;
    const it = this.data.vm.items.find((x) => x.slotId === e.currentTarget.dataset.slot);
    en.v = raw === '' ? null : Math.max(0, Math.min(it && it.inputType === 'cardio' ? 300 : 60, parseInt(raw, 10) || 0));
    this.refresh();
  },
  on5RM(e) { this.entry(e.currentTarget.dataset.slot).new5RM = e.detail.value; this.refresh(); },
  onDone(e) {
    const { slot, v } = e.currentTarget.dataset, en = this.entry(slot);
    en.v = en.v === v ? null : v;
    this.refresh();
  },
  onCardioDone(e) {
    const slot = e.currentTarget.dataset.slot, en = this.entry(slot);
    const it = this.data.vm.items.find((x) => x.slotId === slot);
    const goalMin = Number(it && (it.amrapTarget || it.reps)) || 0;
    en.v = en.v !== null && en.v !== '' && Number(en.v) >= goalMin ? null : goalMin;
    this.refresh();
  },
  onReps(e) { this.entry(e.currentTarget.dataset.slot).reps = e.detail.value; this.refresh(); },
  // ---- 更换动作 ----
  openSwap(e) {
    this.moreOpen = false;
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
    s.recText = rec.text; s.recUnit = rec.unit; s.recNote = rec.note; s.recSourceLabel = rec.sourceLabel || ''; s.selEquip = rec.equip;
    this.setData({ 'swap.sel': s.sel, 'swap.weight': s.weight, 'swap.recText': s.recText, 'swap.recUnit': s.recUnit, 'swap.recNote': s.recNote, 'swap.recSourceLabel': s.recSourceLabel, 'swap.selEquip': s.selEquip });
  },
  swapScope(e) { this.swapState.scope = e.currentTarget.dataset.s; this.setData({ 'swap.scope': this.swapState.scope }); },
  swapWeight(e) { this.swapState.weight = e.detail.value; },
  swapRestore() {
    const en = this.entry(this.swapState.slotId); delete en.ex; en.w = null;
    this.closeSwap(); this.refresh();
  },
  retargetLogged(en, fromName, toName) {
    const stashed = SL.holdForSwap(en, fromName);
    const back = SL.restoreHeld(stashed, toName);
    const keep = stashed.held;
    Object.keys(en).forEach((k) => { delete en[k]; });
    Object.assign(en, back, { held: keep });
  },
  applySwap(en, s) {
    if (s.scope === 'once' || s.editing) {
      this.retargetLogged(en, s.curName, s.sel);
      en.ex = s.sel; en.w = Number(s.weight) || 0;
      wx.showToast({ title: '本次改为 ' + s.sel, icon: 'none' });
      return true;
    }
    const w = parseFloat(s.weight);
    if (isNaN(w) || w < 0) { wx.showToast({ title: '请填写起始重量', icon: 'none' }); return false; }
    const db = this.db(), r = GZ.swapSlot(db, s.dayId, s.slotId, s.sel, w);
    if (r && r.error) { wx.showToast({ title: r.error, icon: 'none' }); return false; }
    if (!store.save(db)) { wx.showToast({ title: '这次更换还没记到本机', icon: 'none' }); return false; }
    this.retargetLogged(en, s.curName, s.sel);
    delete en.ex; en.w = null; en.editW = false;
    wx.showToast({ title: r && r.base ? '已更换为 ' + s.sel : '第 ' + r.fromWeek + ' 周起改为 ' + s.sel, icon: 'none' });
    return true;
  },
  swapConfirm() {
    const s = this.swapState, en = this.entry(s.slotId);
    const had = !!((en.groups && en.groups.length) || en.done || (en.v != null && en.v !== '') || (en.held && Object.keys(en.held).length));
    const go = () => { if (this.applySwap(en, s)) { this.closeSwap(); this.refresh(); } };
    if (had) {
      wx.showModal({
        title: '更换这个动作？',
        content: '已记下的组留在「' + s.curName + '」上，不会算进「' + s.sel + '」。换过去从它自己的组开始，换回来还能看到。',
        success: (r) => { if (r.confirm) go(); }
      });
      return;
    }
    go();
  },

  // ---- 手动调整重量 ----
  onEditW(e) { const en = this.entry(e.currentTarget.dataset.slot); en.editW = !en.editW; this.expanded = true; this.moreOpen = false; this.refresh(); },
  onWStep(e) {
    const { slot, d } = e.currentTarget.dataset, en = this.entry(slot);
    const it = this.data.vm.items.find((x) => x.slotId === slot);
    const next = GZ.nudgeWeight(it.name, it.equip, it.weight, Number(d), it.wStep);
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
  onSkip(e) {
    const slot = e.currentTarget.dataset.slot;
    const en = this.entry(slot);
    this.moreOpen = false;
    if (!en.skip && ((en.groups && en.groups.length) || en.done)) {
      wx.showModal({
        title: '跳过这个动作？',
        content: '已记下的组留在草稿里，这次不按这些组进阶。恢复后还能看到。',
        success: (r) => {
          if (!r.confirm) return;
          en.skip = true;
          this.logOn = false;
          this.logScreen = null;
          if (wx.showTabBar) wx.showTabBar({ animation: false });
          this.refresh();
        }
      });
      return;
    }
    en.skip = !en.skip;
    this.refresh();
  },
  onBw(e) { this.bw = e.detail.value; this.setData({ bw: e.detail.value }); this.persistOpen(); },
  onNote(e) { this.note = e.detail.value; this.setData({ note: e.detail.value }); this.persistOpen(); },

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
      wx.showModal({ title: '还有未填写的动作', content: missing.map((m) => m.name).join('、') + ' 将按“跳过”保存，状态保持不变。', confirmText: '继续保存', confirmColor: '#0064D4', success: (r) => { if (r.confirm) go(); } });
    } else go();
  },

  save() {
    const db = this.db();
    const bwRaw = this.bw != null ? this.bw : this.data.bw;
    const bw = bwRaw ? Number(bwRaw) : null;
    const rec = GZ.saveRecord(db, {
      id: this.recordId, date: this.date || this.data.date, day: this.day, deload: this.data.vm.deload,
      note: this.note != null ? this.note : this.data.note, bw, entries: this.draft,
      createdAt: this.recordId ? this.editCreatedAt : Date.now()
    });
    if (bw > 0) db.params.bodyWeight = bw; // 负重动作推荐重量以最近体重为基准
    if (!store.save(db)) {
      this.saveFail = true;
      wx.showToast({ title: '这次训练还没记到本机', icon: 'none' });
      this.refresh();
      return;
    }
    this.saveFail = false;
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
      logId: rec.id, adds: s.items.filter((x) => x.judgment === '加重').length,
      items: s.items.map((it) => ({
        tier: it.tier, badge: it.badge, tierColor: GZ.TIER_COLORS[it.tier], name: it.name, j: it.judgment, color: GZ.JUDGE_COLORS[it.judgment],
        next: it.deload || it.judgment === '跳过' ? '—' : it.sub ? GZ.fmtW(it.weight) + ' kg · 替代 ' + it.origName : it.inputMode === 'cardio' ? it.nextStage : GZ.fmtW(it.nextWeight) + ' kg · ' + it.nextStage
      }))
    } : null;
    // 重置为下一次推荐训练
    const doneDay = this.day;
    if (this.drafts) delete this.drafts[doneDay];
    if (this.deloads) delete this.deloads[doneDay];
    this.recordId = null; this.deload = undefined; this.editCreatedAt = null;
    this.day = GZ.recommend(db).day; this.draft = null;
    this.bw = ''; this.note = '';
    this.setDate(GZ.today()); this.setData({ result, bw: '', note: '' });
    this.refresh();
  },
  closeResult() { this.setData({ result: null }); },
  gotoStats() { this.setData({ result: null }); wx.switchTab({ url: '/pages/stats/stats' }); },
  openShare(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ result: null, share: { show: true, kind: 'day', recordId: id, week: 0, ym: '' } });
  },
  closeShare() { this.setData({ 'share.show': false }); },

  replaceEntry(slot, next) {
    const en = this.entry(slot);
    Object.keys(en).forEach((k) => { delete en[k]; });
    Object.assign(en, next);
  },
  openLog(slot) {
    this.logOn = true;
    this.logSlot = slot;
    this.logScreen = null;
    this.focus = slot;
    this.moreOpen = false;
    if (wx.hideTabBar) wx.hideTabBar({ animation: false });
    this.refresh();
  },
  closeLog() {
    this.logOn = false;
    this.logScreen = null;
    if (wx.showTabBar) wx.showTabBar({ animation: false });
    this.refresh();
  },
  viewLog(vm) {
    const it = (vm.items || []).find((x) => x.slotId === this.logSlot);
    if (!it) return null;
    const en = this.entry(it.slotId);
    SL.migrate(en, it);
    if (!en.pending) en.pending = SL.defaultPending(en, it);
    const groups = en.groups || [];
    const index = groups.length;
    let screen = this.logScreen;
    if (!screen) {
      if (index >= it.sets) screen = 'done';
      else if (this.restUntil && this.restSlot === it.slotId && this.restUntil > Date.now()) screen = 'rest';
      else screen = 'work';
      this.logScreen = screen;
    }
    const cur = Math.min(index, Math.max(it.sets - 1, 0));
    const target = SL.targetOf(it, cur);
    const amrap = SL.isAmrapIndex(it, cur);
    const pending = en.pending || SL.defaultPending(en, it);
    const dots = [];
    for (let i = 0; i < it.sets; i++) {
      const done = i < groups.length;
      const now = i === cur && screen !== 'done';
      const amrapDot = SL.isAmrapIndex(it, i) && !done;
      dots.push({ i, cls: done ? 'done' : (now ? 'now' : ''), lab: (i + 1) + (amrapDot ? '+' : '') });
    }
    const same = index > 0 && groups.every((g) => g.reps === groups[0].reps && g.weight === groups[0].weight);
    const rows = (amrap && same && screen === 'work') ? [] : groups.map((g, i) => ({
      i, label: '第 ' + (i + 1) + ' 组', text: g.weight + ' kg × ' + g.reps,
      note: g.correctedFrom != null ? '已更正（原 ' + g.correctedFrom + ' 次）' : '更正'
    }));
    const nxt = (vm.items || []).find((x) => x.slotId !== it.slotId && !x.skip && !(x.logged && x.value !== '未完成'));
    const left = this.restUntil ? Math.max(0, Math.ceil((this.restUntil - Date.now()) / 1000)) : 0;
    const ci = this.logCorrect || 0;
    const g = groups[ci] || { reps: 0, weight: it.weight };
    const bag = en.correctPending || {};
    const fail = this.logFail || { index, reps: pending.reps, weight: pending.weight };
    const p = it.preview;
    return {
      screen, slot: it.slotId, name: it.name, scheme: Home.schemeLine(it), badge: it.badge || '',
      stamp: Home.sessionStamp(this.date || GZ.today(), vm.weekInCycle, vm.cycle, vm.day),
      showWeight: !it.isBW && !it.isCardio,
      weight: pending.weight, unit: it.unitText || 'kg',
      dots, pathCap: '第 ' + (cur + 1) + ' / ' + it.sets + ' 组' + (amrap ? ' · 末组' : ''),
      rows, collapsed: amrap && same && screen === 'work' ? ('第 1–' + index + ' 组均 ' + groups[0].weight + ' kg × ' + groups[0].reps) : '',
      target: '目标 ' + (amrap ? target.text : target.reps) + (it.isCardio ? ' 分钟' : ' 次'),
      hint: amrap ? ('至少 ' + target.reps + ' 次。按实际完成填写，多做如实记录。') : '',
      reps: pending.reps, repsUnit: it.isCardio ? '分钟' : '次',
      canSave: pending.reps !== '' && pending.reps != null,
      cta: '记下第 ' + (cur + 1) + ' 组',
      restText: fmtSec(left),
      restPct: Math.max(0, Math.min(100, left / (this.restTotal || 1) * 100)),
      restKicker: '第 ' + index + ' 组已记在本机',
      restNext: '接着第 ' + (index + 1) + ' 组 · 目标 ' + target.text + (it.isCardio ? ' 分钟' : ' 次'),
      restMin: Math.round((it.rest || 0) / 60),
      origin: g.weight + ' kg × ' + (g.correctedFrom != null ? g.correctedFrom : g.reps) + ' 次',
      corTitle: '更正第 ' + (ci + 1) + ' 组',
      corReps: bag.reps != null ? bag.reps : g.reps,
      corW: bag.weight != null ? bag.weight : g.weight,
      showUndo: ci === groups.length - 1,
      failTitle: '第 ' + (fail.index + 1) + ' 组还没有记到本机',
      failKeep: (fail.weight != null ? fail.weight : '') + ' kg × ' + fail.reps + ' 次',
      nextLabel: nxt ? ('下一动作 · ' + Home.shortLift(nxt.name)) : '返回今日列表',
      nextSlot: nxt ? nxt.slotId : '',
      engineJudgment: p ? p.judgment : '',
      engineNext: p ? ('下次 ' + p.nextWeight + ' kg · ' + p.nextStage) : '',
      engineNote: p ? ('由进阶引擎计算。界面不另算下次重量。' + (p.adaptNote || '')) : ''
    };
  },
  armRest() {
    this.clearTimer();
    if (!this.restUntil) return;
    this.timer = setInterval(() => {
      const left = this.restUntil ? Math.ceil((this.restUntil - Date.now()) / 1000) : 0;
      if (left <= 0) {
        this.restUntil = 0;
        this.clearTimer();
        if (this.logScreen === 'rest') {
          this.logScreen = 'work';
          wx.showToast({ title: '休息结束', icon: 'none' });
          this.refresh();
        }
        return;
      }
      if (this.logScreen === 'rest') this.setData({ 'log.restText': fmtSec(left), 'log.restPct': Math.max(0, Math.min(100, left / (this.restTotal || 1) * 100)) });
    }, 250);
  },
  logBack() {
    if (this.logScreen === 'correct') {
      const en = this.entry(this.logSlot);
      en.correctPending = null;
      return this.logWork();
    }
    this.persistOpen();
    this.closeLog();
  },
  logWork() {
    const en = this.entry(this.logSlot);
    en.correctPending = null;
    const it = (this.data.vm.items || []).find((x) => x.slotId === this.logSlot);
    this.logScreen = it && (en.groups || []).length >= it.sets ? 'done' : 'work';
    this.refresh();
  },
  logNext(e) { this.openLog(e.currentTarget.dataset.slot); },
  logFix(e) {
    this.logScreen = 'correct';
    this.logCorrect = Number(e.currentTarget.dataset.i);
    this.entry(this.logSlot).correctPending = null;
    this.refresh();
  },
  onLogReps(e) {
    const en = this.entry(this.logSlot);
    const it = (this.data.vm.items || []).find((x) => x.slotId === this.logSlot);
    en.pending = en.pending || SL.defaultPending(en, it);
    en.pending.reps = e.detail.value;
    this.setData({ 'log.reps': e.detail.value, 'log.canSave': e.detail.value !== '' });
  },
  logStep(e) {
    const en = this.entry(this.logSlot);
    const it = (this.data.vm.items || []).find((x) => x.slotId === this.logSlot);
    const key = e.currentTarget.dataset.k === 'w' ? 'weight' : 'reps';
    const bag = en.pending || (en.pending = SL.defaultPending(en, it));
    if (key === 'reps') bag.reps = SL.clampReps((Number(bag.reps) || 0) + Number(e.currentTarget.dataset.d), it.inputType);
    else bag.weight = GZ.nudgeWeight(it.name, it.equip, Number(bag.weight) || 0, Number(e.currentTarget.dataset.d) < 0 ? -1 : 1, it.wStep);
    this.refresh();
  },
  corStep(e) {
    const en = this.entry(this.logSlot);
    const it = (this.data.vm.items || []).find((x) => x.slotId === this.logSlot);
    const g = (en.groups || [])[this.logCorrect || 0] || { reps: 0, weight: it.weight };
    const bag = en.correctPending || (en.correctPending = { reps: g.reps, weight: g.weight });
    if (e.currentTarget.dataset.k === 'w') bag.weight = GZ.nudgeWeight(it.name, it.equip, Number(bag.weight) || 0, Number(e.currentTarget.dataset.d) < 0 ? -1 : 1, it.wStep);
    else bag.reps = SL.clampReps((Number(bag.reps) || 0) + Number(e.currentTarget.dataset.d), it.inputType);
    this.refresh();
  },
  logSave() {
    if (this._writing) return;
    const it = (this.data.vm.items || []).find((x) => x.slotId === this.logSlot);
    const en = this.entry(this.logSlot);
    const pending = en.pending || SL.defaultPending(en, it);
    this._writing = true;
    const result = SL.commitGroup(en, it, pending, (next) => {
      const prev = JSON.parse(JSON.stringify(en));
      this.replaceEntry(this.logSlot, next);
      const ok = this.persistOpen();
      if (!ok) this.replaceEntry(this.logSlot, prev);
      return ok;
    });
    this._writing = false;
    if (!result.ok && result.reason === 'empty') { wx.showToast({ title: '填写本次次数', icon: 'none' }); return; }
    if (!result.ok && result.reason === 'write') {
      this.logScreen = 'fail';
      this.logFail = { index: (this.entry(this.logSlot).groups || []).length, reps: pending.reps, weight: pending.weight };
      this.refresh();
      return;
    }
    if (!result.ok) return;
    if (result.last) { this.logScreen = 'done'; this.restUntil = 0; this.clearTimer(); }
    else {
      this.restUntil = Date.now() + (it.rest || 60) * 1000;
      this.restTotal = it.rest || 60;
      this.restSlot = it.slotId;
      this.logScreen = 'rest';
      this.armRest();
    }
    this.refresh();
  },
  logUndo() {
    const it = (this.data.vm.items || []).find((x) => x.slotId === this.logSlot);
    const en = this.entry(this.logSlot);
    const undone = SL.undoLast(en, it);
    if (!undone) return;
    const prev = JSON.parse(JSON.stringify(en));
    this.replaceEntry(this.logSlot, undone.entry);
    if (!this.persistOpen()) { this.replaceEntry(this.logSlot, prev); wx.showToast({ title: '这一组还没从本机撤下', icon: 'none' }); return; }
    this.restUntil = 0;
    this.clearTimer();
    this.logScreen = 'work';
    this.refresh();
  },
  logCorrectSave() {
    if (this._writing) return;
    const it = (this.data.vm.items || []).find((x) => x.slotId === this.logSlot);
    const en = this.entry(this.logSlot);
    const bag = en.correctPending || {};
    const g = (en.groups || [])[this.logCorrect || 0] || {};
    const next = SL.correctGroup(en, it, this.logCorrect || 0, bag.reps != null ? bag.reps : g.reps, bag.weight != null ? bag.weight : g.weight);
    if (!next) { wx.showToast({ title: '填写本次次数', icon: 'none' }); return; }
    this._writing = true;
    const prev = JSON.parse(JSON.stringify(en));
    this.replaceEntry(this.logSlot, next);
    const ok = this.persistOpen();
    this._writing = false;
    if (!ok) {
      this.replaceEntry(this.logSlot, prev);
      this.logScreen = 'fail';
      this.logFail = { index: this.logCorrect || 0, reps: bag.reps, weight: bag.weight };
      this.refresh();
      return;
    }
    this.logScreen = (next.groups || []).length >= it.sets ? 'done' : 'work';
    this.refresh();
  },
  logRest(e) {
    if (!this.restUntil) return;
    const left = Math.max(5, Math.ceil((this.restUntil - Date.now()) / 1000) + Number(e.currentTarget.dataset.d));
    this.restUntil = Date.now() + left * 1000;
    this.restTotal = Math.max(this.restTotal || 0, left);
    this.setData({ 'log.restText': fmtSec(left), 'log.restPct': Math.max(0, Math.min(100, left / (this.restTotal || 1) * 100)) });
  },
  logSkipRest() {
    this.restUntil = 0;
    this.clearTimer();
    this.logScreen = 'work';
    this.refresh();
  },

  noop() {}
});
