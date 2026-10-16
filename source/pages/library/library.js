const GZ = require('../../utils/engine.js');
const store = require('../../utils/store.js');

const TIER_TIP = {
  T1: 'T1 主项：大重量复合动作，按 5×3+ → 6×2+ → 10×1+ 进阶',
  T2: 'T2 次主项：中等重量，按 3×10 → 3×8 → 3×6 退阶',
  T3: 'T3 辅助项：小重量高次数，末组达阈值加重'
};

Page({
  data: { tier: 'T1', q: '', lib: null, tierTip: TIER_TIP, parts: GZ.PARTS, equips: GZ.EQUIPS, add: { show: false } },
  onShow() { this.refresh(); },
  refresh() { this.setData({ lib: GZ.buildLibrary(store.load(), { tier: this.data.tier, q: this.data.q }) }); },
  onTier(e) { this.setData({ tier: e.currentTarget.dataset.t }, () => this.refresh()); },
  onQ(e) { this.setData({ q: e.detail.value }, () => this.refresh()); },
  onDel(e) {
    const name = e.currentTarget.dataset.name;
    wx.showModal({
      title: '删除「' + name + '」？', content: '已经练过的记录会保留；正在使用它的训练位置仍按原名显示。', confirmColor: '#FF3B30',
      success: (r) => { if (!r.confirm) return; const db = store.load(); GZ.removeCustomEx(db, name); store.save(db); this.refresh(); }
    });
  },
  openAdd() { this.setData({ add: { show: true, name: '', desc: '', tier: this.data.q ? 'T3' : this.data.tier, partIdx: GZ.PARTS.length - 1, equipIdx: 0 } }); },
  closeAdd() { this.setData({ 'add.show': false }); },
  addName(e) { this.setData({ 'add.name': e.detail.value }); },
  addDesc(e) { this.setData({ 'add.desc': e.detail.value }); },
  addPart(e) { this.setData({ 'add.partIdx': Number(e.detail.value) }); },
  addEquip(e) { this.setData({ 'add.equipIdx': Number(e.detail.value) }); },
  addTier(e) { this.setData({ 'add.tier': e.currentTarget.dataset.t }); },
  doAdd() {
    const a = this.data.add, db = store.load();
    const err = GZ.addCustomEx(db, { name: a.name, tier: a.tier, part: GZ.PARTS[a.partIdx], equip: GZ.EQUIPS[a.equipIdx], desc: a.desc });
    if (err) return wx.showToast({ title: err, icon: 'none' });
    store.save(db);
    this.setData({ 'add.show': false, tier: a.tier, q: '' }, () => this.refresh());
    wx.showToast({ title: '已添加', icon: 'success' });
  },
  noop() {}
});
