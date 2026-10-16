const GZ = require('../../utils/engine.js');
const store = require('../../utils/store.js');
const app = getApp();

Page({
  data: { vm: null, ovIdx: 0, detail: null, showWhy: false },
  onShow() { this.refresh(); },
  refresh() {
    const db = store.load();
    this.logs = GZ.buildReview(db).logs;
    this.setData({ vm: GZ.buildPlan(db, { cycle: this.cycle }) });
  },
  onCycle(e) {
    const d = Number(e.currentTarget.dataset.d), vm = this.data.vm;
    const next = vm.cycle + d;
    if (next < 1 || next > vm.maxCycle) return;
    this.cycle = next;
    this.setData({ vm: GZ.buildPlan(store.load(), { cycle: next }) });
  },
  goNext(e) { app.globalData.gotoDay = e.currentTarget.dataset.day; wx.switchTab({ url: '/pages/train/train' }); },
  toggleWhy() { this.setData({ showWhy: !this.data.showWhy }); },
  onOv(e) { this.setData({ ovIdx: Number(e.currentTarget.dataset.i) }); },
  onCell(e) {
    const c = e.currentTarget.dataset.c;
    if (c.status === 'done') {
      const d = this.logs.find((l) => l.id === c.recordId);
      if (d) this.setData({ detail: d });
      return;
    }
    if (c.status === 'next' || c.status === 'ready') {
      app.globalData.gotoDay = c.day;
      wx.switchTab({ url: '/pages/train/train' });
    } else {
      wx.showToast({ title: '理想推演：假设每次都加重', icon: 'none' });
    }
  },
  closeDetail() { this.setData({ detail: null }); },
  editRecord(e) {
    app.globalData.editRecordId = e.currentTarget.dataset.id;
    this.setData({ detail: null });
    wx.switchTab({ url: '/pages/train/train' });
  },
  noop() {}
});
