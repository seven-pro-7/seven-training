const GZ = require('../../utils/engine.js');
const store = require('../../utils/store.js');
const Share = require('../../utils/share.js');
const Monthly = require('../../utils/monthly.js');
const app = getApp();

Page({
  data: { tab: 0, vm: null, open: {}, showRules: false, rules: GZ.RULES, general: GZ.GENERAL_RULES, bento: null, share: { show: false, kind: 'day', recordId: '', week: 0, ym: '' } },
  toggleRules() { this.setData({ showRules: !this.data.showRules }); },
  onShow() { this.refresh(); },
  refresh() {
    const db = store.load();
    const vm = GZ.buildReview(db);
    const bs = Share.badgeState(db);
    const mths = Monthly.months(db);
    const month = mths.length ? Monthly.build(db, mths[0], {}) : null;
    const week = vm.weeks[0] || null;
    const icons = Object.keys(bs.earned || {}).map((id) => bs.earned[id]).sort((a, b) => String(b.date || '') < String(a.date || '') ? -1 : 1).slice(0, 3).map((e) => (bs.byId[e.id] || {}).e).filter(Boolean);
    const bento = {
      weekLabel: week ? GZ.weekText(week.week, db.params) : '',
      week: week ? week.week : 0,
      sessions: week ? week.sessions : 0,
      total: week ? week.total : 0,
      volText: week ? week.volText : '',
      dv: week ? week.dv : '',
      dvUp: week ? week.dvUp : false,
      mon: month ? month.mon : '',
      ym: month ? month.ym : '',
      days: month ? month.days : 0,
      tons: month ? month.volumeText : '',
      earned: bs.earnedCount,
      badges: bs.total,
      icons
    };
    this.setData({ vm, bento, rules: vm.rules || GZ.RULES, general: vm.generalRules || GZ.GENERAL_RULES });
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
  openDay(e) { this.setData({ share: { show: true, kind: 'day', recordId: e.currentTarget.dataset.id, week: 0, ym: '' } }); },
  openWeek(e) { this.setData({ share: { show: true, kind: 'week', recordId: '', week: Number(e.currentTarget.dataset.week) || 0, ym: '' } }); },
  openMonth() { this.setData({ share: { show: true, kind: 'month', recordId: '', week: 0, ym: this.data.bento.ym } }); },
  closeShare() { this.setData({ 'share.show': false }); },
  copySummary() {
    const v = this.data.vm;
    const lines = ['【' + (v.ruleTitle || '训练小结') + '】'].concat(v.insights.map((i) => '· ' + i.text));
    v.weeks.slice().reverse().forEach((w) => lines.push('W' + w.week + '：' + w.sessions + '/' + w.total + ' 次，容量 ' + w.volText + (w.dv ? '（' + w.dv + '）' : '') + '，加重 ' + w.adds + ' 项'));
    wx.setClipboardData({ data: lines.join('\n') });
  }
});
