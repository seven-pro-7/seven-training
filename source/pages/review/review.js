const GZ = require('../../utils/engine.js');
const store = require('../../utils/store.js');
const app = getApp();

Page({
  data: { tab: 0, vm: null, open: {}, showRules: false, rules: GZ.RULES, general: GZ.GENERAL_RULES },
  toggleRules() { this.setData({ showRules: !this.data.showRules }); },
  onShow() { this.refresh(); },
  refresh() {
    const vm = GZ.buildReview(store.load());
    this.setData({ vm, rules: vm.rules || GZ.RULES, general: vm.generalRules || GZ.GENERAL_RULES });
  },
  onTab(e) { this.setData({ tab: Number(e.currentTarget.dataset.t) }); },
  toggle(e) { const id = e.currentTarget.dataset.id; this.setData({ ['open.' + id]: !this.data.open[id] }); },
  edit(e) { app.globalData.editRecordId = e.currentTarget.dataset.id; wx.switchTab({ url: '/pages/train/train' }); },
  del(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这次训练？', content: '删除后，之后所有训练的重量与阶段会按规则重新推算。', confirmColor: '#FF3B30',
      success: (r) => { if (!r.confirm) return; const db = store.load(); GZ.deleteRecord(db, id); store.save(db); this.refresh(); wx.showToast({ title: '已删除', icon: 'none' }); }
    });
  },
  copySummary() {
    const v = this.data.vm;
    const lines = ['【' + (v.ruleTitle || '训练小结') + '】'].concat(v.insights.map((i) => '· ' + i.text));
    v.weeks.slice().reverse().forEach((w) => lines.push('W' + w.week + '：' + w.sessions + '/' + w.total + ' 次，容量 ' + w.volText + (w.dv ? '（' + w.dv + '）' : '') + '，加重 ' + w.adds + ' 项'));
    wx.setClipboardData({ data: lines.join('\n') });
  }
});
