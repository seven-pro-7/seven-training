const GZ = require('../../utils/engine.js');
const Chart = require('../../utils/chart.js');
const store = require('../../utils/store.js');
const { getCtx } = require('../../utils/canvas.js');

Page({
  data: { s: null, liftIdx: 0, dayIdx: 0, cur: null, palette: Chart.PALETTE },
  onShow() {
    const s = GZ.buildStats(store.load());
    this.setData({ s, cur: s.e1rm[this.data.liftIdx] || null }, () => this.drawAll());
  },
  onLift(e) { const i = Number(e.currentTarget.dataset.i); this.setData({ liftIdx: i, cur: this.data.s.e1rm[i] }, () => this.draw('c_e1')); },
  onDayTab(e) { this.setData({ dayIdx: Number(e.currentTarget.dataset.i) }, () => this.draw('c_w')); },

  drawAll() { ['c_e1', 'c_w', 'c_v', 'c_p', 'c_bw'].forEach((id) => this.draw(id)); },
  async draw(id) {
    const s = this.data.s;
    if (id === 'c_bw' && s.bw.length < 2) return;
    const c = await getCtx(this, id); if (!c) return;
    const P = Chart.presets;
    if (id === 'c_e1' && s.e1rm[this.data.liftIdx]) P.e1rm(c.ctx, c.w, c.h, s.e1rm[this.data.liftIdx], s.totalWeeks);
    if (id === 'c_w') P.weight(c.ctx, c.w, c.h, s.weightTrend[this.data.dayIdx], s.totalWeeks);
    if (id === 'c_v') P.volume(c.ctx, c.w, c.h, s.volume);
    if (id === 'c_p') P.pie(c.ctx, c.w, c.h, s);
    if (id === 'c_bw') P.bw(c.ctx, c.w, c.h, s.bw);
  }
});
